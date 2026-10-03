#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Парсер заданий ЕГЭ по информатике с сайта OpenFIPI (https://openfipi.devinf.ru).

Скачивает актуальные задания ЕГЭ (№ 1–27) с ответами и складывает их в папку
openfipi_bank рядом с trainer — в том же формате, что ege_bank, поэтому
build.py подхватывает их без дополнительных настроек.

    Biblio/
      ege_bank/  kompege_bank/
      openfipi_bank/          <- сюда
        tasks/05/<ID>.json    задания
        assets/<ID>/…         картинки (вынуты из текста)
        files/ege/24/…        файлы к заданиям (txt, xlsx, ods, zip)
        raw/                  кэш скачанных страниц — повторный запуск идёт быстро
        report.txt            отчёт
      trainer/  openfipi_parser.py  build.py …

Запуск (нужен только Python 3.8+):
    python openfipi_parser.py                  # всё: задания, ответы, файлы
    python openfipi_parser.py --no-files       # без файлов к заданиям (их можно скачать потом)
    python openfipi_parser.py --user-answers   # для заданий без ответа брать ответ пользователей,
                                               # если его дали хотя бы двое одинаково
    python openfipi_parser.py --max-pages 3    # проба на первых 3 страницах списка

Первый запуск — около 40 минут (сайт небольшой, парсер делает паузу между запросами)
плюс время на файлы. Повторный запуск скачивает только новое: новые задания,
появившиеся ответы, недостающие файлы. Можно прервать Ctrl+C и запустить снова.
После парсинга: python build.py
"""
import argparse
import base64
import gzip
import hashlib
import html as H
import json
import os
import re
import sys
import time
import zlib
from collections import Counter, defaultdict
from datetime import datetime
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse, unquote
from urllib.request import HTTPCookieProcessor, Request, build_opener

HERE = Path(__file__).resolve().parent
BASE = "https://openfipi.devinf.ru"
# те же заголовки, что у разведчика (с ними сайт отдаёт обычные страницы)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")

DIV_TAG = re.compile(r"<(/?)div\b[^>]*>", re.I)
IMG_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif",
           "image/svg+xml": ".svg", "image/webp": ".webp", "image/bmp": ".bmp", "image/x-emf": ".emf",
           "image/x-wmf": ".wmf"}


# ================================================================ HTML-помощники
def div_at(s, start):
    """Для <div …> в позиции start вернуть (конец открывающего тега, начало </div>, конец </div>)."""
    depth = 0
    open_end = None
    for m in DIV_TAG.finditer(s, start):
        if m.group(1):
            depth -= 1
            if depth == 0:
                return open_end, m.start(), m.end()
        else:
            depth += 1
            if open_end is None:
                open_end = m.end()
    return None


def div_inner(s, pattern, start=0):
    """Внутренность первого div, открывающий тег которого совпадает с pattern."""
    m = re.compile(pattern, re.I | re.S).search(s, start)
    if not m:
        return None
    r = div_at(s, m.start())
    return s[r[0]:r[1]] if r else None


def html_to_text(h):
    h = re.sub(r"<br\s*/?>", "\n", h, flags=re.I)
    h = re.sub(r"</(p|div|tr|li|h\d)>", "\n", h, flags=re.I)
    h = re.sub(r"<[^>]+>", "", h)
    t = H.unescape(h).replace("\xa0", " ").replace("\r", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def safe_name(s):
    """Имя файла, не зависящее от регистра букв (Windows не различает Fc92eA и FC92EA)."""
    base = re.sub(r"[^\w.-]+", "_", s)
    return f"{base}-{hashlib.md5(s.encode()).hexdigest()[:6]}"


# ================================================================ сеть
class Net:
    def __init__(self, delay, verbose=False):
        self.delay = delay
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        self.last = 0.0
        self.requests = 0
        self.verbose = verbose
        self.last_meta = {}

    def _wait(self):
        dt = time.time() - self.last
        if dt < self.delay:
            time.sleep(self.delay - dt)
        self.last = time.time()

    def get(self, url, binary=False, tries=4):
        err = None
        for attempt in range(tries):
            self._wait()
            self.requests += 1
            try:
                req = Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate",
                                            "Accept-Language": "ru,en;q=0.8"})
                with self.opener.open(req, timeout=60) as r:
                    body = r.read()
                    self.last_meta = {"status": r.status, "url": r.geturl(),
                                      "type": r.headers.get("Content-Type", ""),
                                      "encoding": r.headers.get("Content-Encoding", "")}
                    enc = (r.headers.get("Content-Encoding") or "").lower()
                    if enc == "gzip":
                        body = gzip.decompress(body)
                    elif enc == "deflate":
                        body = zlib.decompress(body)
                    if binary:
                        return body
                    m = re.search(r"charset=([\w-]+)", r.headers.get("Content-Type") or "")
                    return body.decode(m.group(1) if m else "utf-8", errors="replace")
            except HTTPError as e:
                if e.code in (404, 403, 410):
                    raise
                err = e
            except (URLError, TimeoutError, OSError) as e:
                err = e
            wait = 5 * (attempt + 1)
            print(f"      сбой ({err}), повтор через {wait} с…", flush=True)
            time.sleep(wait)
        raise err

    def download(self, url, dest: Path):
        """Скачать файл потоково (файлы бывают по 10+ МБ), через временный файл."""
        err = None
        for attempt in range(4):
            self._wait()
            self.requests += 1
            tmp = dest.with_name(dest.name + ".part")
            try:
                req = Request(url, headers={"User-Agent": UA})
                with self.opener.open(req, timeout=120) as r, open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                os.replace(tmp, dest)
                return dest.stat().st_size
            except HTTPError as e:
                try:
                    tmp.unlink()
                except OSError:
                    pass
                if e.code in (404, 403, 410):
                    raise
                err = e
            except (URLError, TimeoutError, OSError) as e:
                try:
                    tmp.unlink()
                except OSError:
                    pass
                err = e
            wait = 5 * (attempt + 1)
            print(f"      сбой ({err}), повтор через {wait} с…", flush=True)
            time.sleep(wait)
        raise err


# ================================================================ разбор страниц
def parse_list_page(s):
    """-> (задания на странице, есть ли следующая страница, всего заданий)"""
    total = None
    m = re.search(r"из\s*<b>\s*([\d\s,.\xa0]+)\s*</b>", s)
    if m:
        total = int(re.sub(r"\D", "", m.group(1)) or 0) or None
    has_next = bool(re.search(r'class="pagination-next"[^>]*href="', s))
    start = s.find("<!-- Список заданий -->")
    if start < 0:
        start = 0
    items = []
    for m in re.finditer(r'<div class="box">', s[start:]):
        pos = start + m.start()
        r = div_at(s, pos)
        if not r:
            continue
        box = s[r[0]:r[1]]
        if "<!-- Текст задания -->" not in box:
            continue
        head, body = box.split("<!-- Текст задания -->", 1)
        idm = re.search(r'href="/task/([^"/?#]+)"', head) or \
            re.search(r'<span class="tag is-dark[^"]*">\s*([^<\s]+)\s*</span>', head)
        num = re.search(r"№\s*(\d+)", head)
        if not idm or not num:
            continue
        tags = [t.strip() for t in re.findall(r'<span class="tag[^"]*">\s*([^<]*?)\s*</span>', head)]
        date = re.search(r"(\d\d)\.(\d\d)\.(\d{4})\s+(\d\d):(\d\d):(\d\d)", head)
        content = div_inner(body, r'<div class="content"[^>]*>') or ""
        items.append({
            "id": H.unescape(idm.group(1)),
            "n": int(num.group(1)),
            "actual": any("Актуальн" in t for t in tags) or not any("Стар" in t for t in tags),
            "has_answer": any(t == "Есть ответ" for t in tags),
            "date": (f"{date.group(3)}-{date.group(2)}-{date.group(1)}T{date.group(4)}:{date.group(5)}:{date.group(6)}"
                     if date else None),
            "html": content.strip(),
        })
    return items, has_next, total


def parse_task_page(s):
    out = {}
    m = re.search(r'<span class="tag is-link is-medium">\s*([^<]*?)\s*</span>', s)
    if m:
        out["category"] = H.unescape(m.group(1)).strip()
    ans_block = div_inner(s, r'<div id="answerContent"[^>]*>')
    if ans_block is not None:
        inner = div_inner(ans_block, r'<div class="notification[^"]*"[^>]*>') or ans_block
        inner = re.sub(r"<strong>\s*Ответ:?\s*</strong>", "", inner, count=1, flags=re.I)
        out["answer"] = html_to_text(inner)
    sol_block = div_inner(s, r'<div id="solutionContent"[^>]*>')
    if sol_block is not None:
        inner = div_inner(sol_block, r'<div class="notification[^"]*"[^>]*>') or sol_block
        inner = re.sub(r"<strong>\s*Решение:?\s*</strong>", "", inner, count=1, flags=re.I).strip()
        inner = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", inner)
        if html_to_text(inner):
            out["solution_html"] = inner
    body = s.split("<!-- Текст задания -->", 1)
    if len(body) == 2:
        c = div_inner(body[1], r'<div class="content"[^>]*style="[^"]*"[^>]*>')
        if c:
            out["html"] = c.strip()
    return out


def parse_user_answers(s):
    res = []
    box = s.split("<!-- Ответы -->", 1)[-1]
    for m in re.finditer(r'<div class="notification is-white">', box):
        r = div_at(box, m.start())
        if not r:
            continue
        note = box[r[0]:r[1]]
        c = div_inner(note, r'<div class="content"[^>]*>')
        if c is not None:
            res.append(html_to_text(c))
    return res


ANSWER_OK = re.compile(r"^[\w\s.,;:+\-]{1,300}$")


def consensus(answers, min_votes):
    norm = lambda a: re.sub(r"\s+", " ", a.strip().lower().replace("ё", "е"))
    good = [a for a in answers if a and ANSWER_OK.match(a) and len(a.split()) <= 60]
    if not good:
        return None
    cnt = Counter(norm(a) for a in good)
    best, votes = cnt.most_common(1)[0]
    if votes < min_votes or votes * 2 <= len(good):     # нужна строгое большинство
        return None
    return next(a.strip() for a in good if norm(a) == best)


# ================================================================ парсер
class Parser:
    def __init__(self, args):
        self.a = args
        self.out = Path(args.out).resolve()
        self.net = Net(args.delay)
        self.raw = self.out / "raw"
        for d in (self.out / "tasks", self.out / "assets", self.out / "files", self.raw / "task", self.raw / "answers"):
            d.mkdir(parents=True, exist_ok=True)
        self.stats = Counter()
        self.problems = []
        self.file_sizes = 0
        self.file_names = {}          # имя в нижнем регистре -> путь (защита от совпадений на Windows)

    # ---------- кэш страниц
    def cached(self, kind, tid, url, refresh=False):
        p = self.raw / kind / (safe_name(tid) + ".html")
        if p.is_file() and not refresh:
            self.stats[f"{kind}: из кэша"] += 1
            return p.read_text(encoding="utf-8"), True
        s = self.net.get(url)
        p.write_text(s, encoding="utf-8")
        self.stats[f"{kind}: скачано"] += 1
        return s, False

    # ---------- картинки
    def extract_images(self, html, tid):
        adir_rel = f"assets/{safe_name(tid)}"
        adir = self.out / adir_rel

        def data_uri(m):
            q, mime, b64 = m.group(1), m.group(2).lower(), m.group(3)
            try:
                data = base64.b64decode(re.sub(r"\s+", "", b64))
            except Exception:
                self.problems.append((tid, "битая картинка base64"))
                return m.group(0)
            name = hashlib.sha1(data).hexdigest()[:16] + IMG_EXT.get(mime, ".img")
            adir.mkdir(parents=True, exist_ok=True)
            f = adir / name
            if not f.exists():
                f.write_bytes(data)
            self.stats["картинок сохранено"] += 1
            return f'src={q}{adir_rel}/{name}{q}'

        html = re.sub(r"""src=(["'])data:(image/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)\1""", data_uri, html)

        def remote(m):
            q, url = m.group(1), H.unescape(m.group(2))
            full = urljoin(BASE + "/", url)
            if urlparse(full).netloc != urlparse(BASE).netloc or self.a.no_images:
                return m.group(0)
            if "/static/img/download" in full:
                return m.group(0)
            ext = os.path.splitext(urlparse(full).path)[1][:6] or ".img"
            name = hashlib.sha1(full.encode()).hexdigest()[:16] + ext
            f = adir / name
            if not f.exists():
                try:
                    adir.mkdir(parents=True, exist_ok=True)
                    self.net.download(full, f)
                except Exception as e:
                    self.problems.append((tid, f"картинка {full}: {e}"))
                    return m.group(0)
            return f'src={q}{adir_rel}/{name}{q}'

        return re.sub(r"""src=(["'])((?:https?://[^"']+|/[^"']+))\1""", remote, html)

    # ---------- файлы к заданию
    def extract_files(self, html, tid):
        files = []

        def repl(m):
            href = H.unescape(m.group(2))
            full = urljoin(BASE + "/", href)
            path = urlparse(full).path
            if not path.startswith("/files/"):
                return m.group(0)
            name = unquote(path.rsplit("/", 1)[-1])
            rel = unquote(path.lstrip("/"))
            key = rel.lower()
            if key in self.file_names and self.file_names[key] != rel:      # совпадение без учёта регистра
                stem, ext = os.path.splitext(rel)
                rel = f"{stem}-{hashlib.md5(path.encode()).hexdigest()[:6]}{ext}"
            self.file_names[key] = rel
            entry = {"name": name, "url": full}
            dest = self.out / rel
            if not self.a.no_files:
                try:
                    if not dest.is_file() or dest.stat().st_size == 0:
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        size = self.net.download(full, dest)
                        self.file_sizes += size
                        self.stats["файлов скачано"] += 1
                        print(f"      файл {name}: {size / 1e6:.1f} МБ", flush=True)
                    else:
                        self.stats["файлов уже было"] += 1
                except Exception as e:
                    self.problems.append((tid, f"файл {full}: {e}"))
            if dest.is_file():
                entry["path"] = rel.replace(os.sep, "/")
            if not any(f["url"] == full for f in files):
                files.append(entry)
            return ""          # ссылку-картинку «скачать» убираем: тренажёр показывает файлы сам

        # <a href="/files/..."><img src=".../download.gif"></a> и обычные ссылки на /files/
        html = re.sub(r"""<a\b[^>]*href=(["'])([^"']*?/files/[^"']+)\1[^>]*>.*?</a>""", repl, html, flags=re.S | re.I)
        html = re.sub(r"<p[^>]*>\s*</p>", "", html)
        return html, files

    # ---------- основной проход
    def run(self):
        started = time.time()
        a = self.a
        print("Парсер OpenFIPI (не разведка)")
        print(f"Сохраняю в: {self.out}")
        print("1) Списки заданий ЕГЭ…", flush=True)
        items, page, total = {}, 1, None
        complete = False
        try:
            self.net.get(f"{BASE}/")          # как браузер: сначала главная (сайт может выдать cookie)
        except Exception as e:
            print(f"   главная страница не открылась: {e}", flush=True)
        while True:
            url = f"{BASE}/tasks_ege/" if page == 1 else f"{BASE}/tasks_ege/page/{page}"
            try:
                s = self.net.get(url)
            except Exception as e:
                if page == 1:
                    raise
                print(f"   страница {page} не открылась ({e}) — продолжаю с тем, что уже есть", flush=True)
                break
            got, has_next, t = parse_list_page(s)
            total = total or t
            if page == 1 and not got:
                dbg = self.raw / "debug_list_page1.html"
                dbg.write_text(s, encoding="utf-8")
                title = re.search(r"<title[^>]*>(.*?)</title>", s, re.S | re.I)
                print(f"   сайт ответил: {self.net.last_meta}", flush=True)
                print(f"   заголовок страницы: {html_to_text(title.group(1)) if title else '—'}; размер {len(s)} символов", flush=True)
                print(f"   начало текста: {html_to_text(s)[:300]!r}", flush=True)
                print(f"   страница сохранена: {dbg} — пришлите её в чат", flush=True)
            new = 0
            for it in got:
                if it["id"] not in items:
                    items[it["id"]] = it
                    new += 1
            if page == 1 or page % 20 == 0 or not has_next:
                print(f"   страница {page}: всего {len(items)}" + (f" из {total}" if total else ""), flush=True)
            if not got or not has_next or (a.max_pages and page >= a.max_pages):
                complete = not has_next and not a.max_pages
                break
            page += 1
        if total and len(items) < total * 0.97:
            complete = False
        if not items:
            print("Не удалось найти задания в списке — возможно, сайт изменил вёрстку.")
            sys.exit(1)

        self.fix_numbers(items)
        wanted = [it for it in items.values() if 1 <= it["n"] <= 27 and it["actual"]]
        if a.only:
            wanted = [it for it in wanted if it["n"] in a.only]
        self.stats["в списке"] = len(items)
        self.stats["актуальных ЕГЭ 1–27"] = len(wanted)
        with_ans = [it for it in wanted if it["has_answer"]]
        print(f"2) Ответы: у {len(with_ans)} из {len(wanted)} заданий есть ответ на сайте. "
              f"Страницы заданий берутся из кэша, если уже скачаны.", flush=True)

        done = 0
        for it in wanted:
            tid = it["id"]
            info = {}
            if it["has_answer"]:
                try:
                    page_html, from_cache = self.cached("task", tid, f"{BASE}/task/{tid}", refresh=a.refresh)
                    info = parse_task_page(page_html)
                    if not info.get("answer") and from_cache:   # в кэше старая версия без ответа — обновим
                        info = parse_task_page(self.cached("task", tid, f"{BASE}/task/{tid}", refresh=True)[0])
                    if not info.get("answer"):
                        self.problems.append((tid, "в списке «Есть ответ», а на странице задания ответа нет"))
                except Exception as e:
                    self.problems.append((tid, f"страница задания: {e}"))
            it.update({k: v for k, v in info.items() if k != "html"})
            if info.get("html"):
                it["html"] = info["html"]
            if it.get("answer"):
                it["answer_source"] = "site"
            elif a.user_answers:
                try:
                    ua = parse_user_answers(self.cached("answers", tid, f"{BASE}/task/{tid}/answers", refresh=a.refresh)[0])
                    c = consensus(ua, a.min_votes)
                    if c:
                        it["answer"], it["answer_source"] = c, "users"
                        self.stats["ответ от пользователей"] += 1
                except Exception as e:
                    self.problems.append((tid, f"ответы пользователей: {e}"))
            done += 1
            if done % 50 == 0 or done == len(wanted):
                el = time.time() - started
                print(f"   обработано {done} из {len(wanted)} · запросов {self.net.requests} · {el / 60:.0f} мин", flush=True)

        print("3) Картинки, файлы, связка заданий 19–21…", flush=True)
        by_id = {it["id"]: it for it in items.values()}
        written = Counter()
        existing = {f.name: f for f in (self.out / "tasks").rglob("*.json")}
        for i, it in enumerate(wanted, 1):
            tid = it["id"]
            h = it["html"]
            h = self.link_game_tasks(h, it, by_id)
            h = self.extract_images(h, tid)
            h, files = self.extract_files(h, tid)
            doc = {
                "id": tid,
                "number": it["n"],
                "source": "Открытый банк ФИПИ" + (" · ответ пользователей" if it.get("answer_source") == "users" else ""),
                "text_html": h.strip(),
                "text": html_to_text(h),
                "answer": it.get("answer"),
                "answer_source": it.get("answer_source"),
                "files": files,
                "images_original": [],
                "url": f"{BASE}/task/{tid}",
                "date": it.get("date"),
                "actual": it["actual"],
                "category": it.get("category"),
                "group": it.get("group"),
            }
            if it.get("solution_html"):
                sol = self.extract_images(it["solution_html"], tid)
                doc["solution_html"] = sol
            d = self.out / "tasks" / f"{it['n']:02d}"
            d.mkdir(parents=True, exist_ok=True)
            fname = f"{safe_name(tid)}.json"
            if fname in existing and existing[fname].parent != d:     # номер исправлен — старую копию убираем
                existing[fname].unlink(missing_ok=True)
            (d / fname).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
            written[it["n"]] += 1
            if doc["answer"]:
                written["с ответом"] += 1
            if i % 200 == 0:
                print(f"   записано {i} из {len(wanted)}", flush=True)

        # задания, которых больше нет среди актуальных на сайте, убираем (только при полном проходе)
        if complete and not a.only:
            keep = {safe_name(it["id"]) + ".json" for it in wanted}
            for f in (self.out / "tasks").rglob("*.json"):
                if f.name not in keep:
                    f.unlink()
                    self.stats["удалено (нет на сайте или стали неактуальными)"] += 1

        self.write_report(written, total, started)

    def fix_numbers(self, items):
        """Сайт иногда помечает задание 21 как «№ 20». Исправляем:
        1) по абзацу «Задание 21 <ссылка на это же задание>» в тексте;
        2) по тексту: в №21 спрашивают про выигрышную стратегию Вани."""
        for it in items.values():
            if it["n"] not in (19, 20, 21):
                continue
            own = None
            for m in re.finditer(r"Задание\s*(\d+)\s*(?:&nbsp;|\s)*<a\s[^>]*href=\"[^\"]*/task/([^\"/?#]+)\"", it["html"]):
                if H.unescape(m.group(2)) == it["id"]:
                    own = int(m.group(1))
            if own is None and it["n"] == 20:
                t = html_to_text(it["html"]).lower()
                if "у вани есть выигрышная стратегия" in t and "у пети есть выигрышная стратегия" not in t:
                    own = 21
            if own and own != it["n"] and own in (19, 20, 21):
                it["n_site"] = it["n"]
                it["n"] = own
                self.stats[f"номер исправлен {it['n_site']}→{own}"] += 1

    def find_game_base(self, it, by_id):
        """Задание 19 той же группы: по ссылке в тексте или добавленное на сайт перед этим (в пределах 3 минут)."""
        links = [H.unescape(x) for x in re.findall(r'href="(?:https?://[^"/]+)?/task/([^"/?#]+)"', it["html"])]
        for lid in links:
            other = by_id.get(lid)
            if other and other["n"] == 19 and other["id"] != it["id"]:
                return other, links
        if not re.search(r"задани[еия]\s*19", html_to_text(it["html"]), re.I) or not it.get("date"):
            return None, links
        t0 = datetime.fromisoformat(it["date"])
        best, best_dt = None, None
        for other in by_id.values():
            if other["n"] != 19 or not other.get("date"):
                continue
            dt = (t0 - datetime.fromisoformat(other["date"])).total_seconds()
            if 0 <= dt <= 180 and (best_dt is None or dt < best_dt):
                best, best_dt = other, dt
        if best:
            self.stats["№20–21 связаны с №19 по времени добавления"] += 1
        return best, links

    def link_game_tasks(self, h, it, by_id):
        """№20 и №21 ссылаются на игру из №19 — подставляем её условие прямо в задание."""
        base, links = (None, [])
        if it["n"] == 19:
            it["group"] = it["id"]
        if it["n"] in (20, 21):
            base, links = self.find_game_base(it, by_id)
            if base:
                it["group"] = base["id"]         # тренажёр покажет 19–21 одной страницей
        # абзацы «Задание 19 https://openfipi…/task/…» больше не нужны
        h2 = re.sub(r"<p[^>]*>\s*Задание\s*\d+\s*(?:&nbsp;|\s)*<a\s[^>]*href=\"[^\"]*/task/[^\"]+\"[^>]*>.*?</a>\s*</p>",
                    "", h, flags=re.S | re.I)
        if it["n"] in (20, 21) and not base and links:
            return h                     # задание 19 не нашлось — оставляем ссылки как есть
        if base:
            base_html = re.sub(r"<p[^>]*>\s*Задание\s*\d+\s*(?:&nbsp;|\s)*<a\s[^>]*href=\"[^\"]*/task/[^\"]+\"[^>]*>.*?</a>\s*</p>",
                               "", base["html"], flags=re.S | re.I)
            h2 = (f'<div class="linked-task"><p><b>Задание 19 (условие игры)</b></p>{base_html}</div>'
                  f'<hr class="subtask-sep">{h2}')
            self.stats["№20–21 с условием из №19"] += 1
        return h2

    def write_report(self, written, total, started):
        lines = [f"OpenFIPI: {datetime.now().isoformat(timespec='seconds')}",
                 f"Заданий ЕГЭ на сайте (актуальных): {total or '?'}",
                 f"Записано: {sum(v for k, v in written.items() if isinstance(k, int))}, из них с ответом: {written['с ответом']}",
                 "", "По номерам:"]
        lines.append("  " + ", ".join(f"№{n}: {written[n]}" for n in range(1, 28) if written[n]))
        lines += ["", "Статистика:"] + [f"  {k}: {v}" for k, v in sorted(self.stats.items())]
        lines.append(f"  скачано файлов: {self.file_sizes / 1e6:.0f} МБ")
        lines.append(f"  запросов к сайту: {self.net.requests}, время: {(time.time() - started) / 60:.0f} мин")
        if self.problems:
            lines += ["", f"Проблемы ({len(self.problems)}):"] + [f"  {t}: {p}" for t, p in self.problems[:200]]
        (self.out / "report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n" + "\n".join(lines[:6]))
        if self.problems:
            print(f"Проблем: {len(self.problems)} — подробно в {self.out / 'report.txt'}")
        print("\nДальше: python build.py")


def main():
    ap = argparse.ArgumentParser(description="Парсер заданий ЕГЭ с openfipi.devinf.ru")
    # скрипт может лежать и в Biblio/trainer, и прямо в Biblio — в обоих случаях пишем в Biblio/openfipi_bank
    biblio = HERE if any((HERE / b).is_dir() for b in ("ege_bank", "kompege_bank", "trainer")) else HERE.parent
    ap.add_argument("--out", default=str(biblio / "openfipi_bank"), help="куда сохранять (по умолчанию Biblio/openfipi_bank)")
    ap.add_argument("--delay", type=float, default=1.0, help="пауза между запросами, с (не меньше 0.5)")
    ap.add_argument("--no-files", action="store_true", help="не скачивать файлы к заданиям (останутся ссылки на сайт)")
    ap.add_argument("--no-images", action="store_true", help="не скачивать картинки, лежащие на сайте отдельными файлами")
    ap.add_argument("--user-answers", action="store_true", help="для заданий без ответа брать согласованный ответ пользователей")
    ap.add_argument("--min-votes", type=int, default=2, help="сколько пользователей должны дать одинаковый ответ (по умолчанию 2)")
    ap.add_argument("--refresh", action="store_true", help="перекачать страницы заданий, а не брать из кэша")
    ap.add_argument("--max-pages", type=int, default=0, help="сколько страниц списка пройти (для пробы)")
    ap.add_argument("--only", type=lambda s: {int(x) for x in s.split(",") if x.strip()}, default=None,
                    help="только эти номера, например --only 5,17,24")
    ap.add_argument("--base", default=None, help=argparse.SUPPRESS)
    args = ap.parse_args()
    global BASE
    if args.base:
        BASE = args.base.rstrip("/")
    args.delay = max(args.delay, 0.5) if not args.base else args.delay
    try:
        Parser(args).run()
    except KeyboardInterrupt:
        print("\nОстановлено. Уже скачанное сохранено в кэше — запустите снова, чтобы продолжить.")
        sys.exit(130)


if __name__ == "__main__":
    main()
