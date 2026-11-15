#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Парсер заданий №10 ЕГЭ по информатике с трёх сайтов: Яндекс ЕГЭ (education.yandex.ru/ege),
КомпЕГЭ (kompege.ru) и открытого банка ФИПИ (openfipi.devinf.ru). Остальные номера не трогает.

На сайте Egeshka №10 по КИМ-2027 — «поиск слова в тексте» (файл .docx, «Найти», «Только слово целиком»).
На сайтах-источниках №10 может быть ещё по нумерации 2026 года (IP-адреса и маски), а «поиск в тексте» —
в архиве. Поэтому парсер смотрит №10 (и архив КомпЕГЭ «110») и раскладывает задания по тексту условия:
    поиск в тексте → tasks/10/  с меткой "kim": 2027 — на сайте остаётся №10;
    IP-адреса      → tasks/13/  с меткой "kim": 2027 — на сайте №13 (берутся только с --kind ip или all).
Задания, которые не похожи ни на то, ни на другое, не сохраняются — они перечислены в report.txt.

Результат — папка task10_bank рядом с ege_bank / kompege_bank (формат как у ege_bank, build.py её подхватывает):
    Biblio/
      task10_bank/
        tasks/10/<источник>_<id>.json   задания
        files/<источник>/<id>/…        файлы к заданиям (.docx, .txt …)
        assets/<источник>/<id>/…       картинки из условия
        raw/                            кэш ответов сайтов — повторный запуск идёт быстро
        report.txt                      отчёт
      trainer/  parse_task10.py  build.py …

Запуск (Python 3.9+; для Яндекса нужен Playwright: pip install playwright && python -m playwright install chromium):
    python parse_task10.py                         # все три сайта, только «поиск в тексте»
    python parse_task10.py --source kompege,fipi   # без Яндекса (без браузера)
    python parse_task10.py --kind all              # и «поиск в тексте», и IP-адреса
    python parse_task10.py --headless              # Яндекс без окна браузера
    python parse_task10.py --refresh               # перекачать списки и страницы, а не брать из кэша
    python parse_task10.py --fipi-max-pages 3      # проба: первые 3 страницы списка ФИПИ
Потом: python build.py   (или python build.py --bank ege_bank --bank kompege_bank --bank openfipi_bank --bank task10_bank)

Парсер делает паузу между запросами (по умолчанию 1 с), повторный запуск скачивает только новое.
Права на задания принадлежат авторам сайтов — для публикации на своём сайте согласуйте это с ними.
"""
import argparse
import base64
import gzip
import hashlib
import html as H
import json
import os
import re
import time
import zlib
from collections import Counter
from datetime import datetime
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

HERE = Path(__file__).resolve().parent
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
KIM = 2027
SITE_NUM = {"text": 10, "ip": 13}             # номер на сайте Egeshka (КИМ-2027)

YANDEX_URL = "https://education.yandex.ru/ege/inf/tasks?sort_by=newFirst&level=0&source=all"
YANDEX_BASE = "https://education.yandex.ru/"
KOMPEGE = "https://kompege.ru"
FIPI = "https://openfipi.devinf.ru"

SRC_TITLE = {"yandex": "Яндекс Учебник", "kompege": "КомпЕГЭ", "fipi": "Открытый банк ФИПИ"}
DOC_EXT = {".docx", ".doc", ".odt", ".rtf", ".txt"}
FILE_EXT_RE = re.compile(r"\.(txt|xlsx?|xlsm|csv|docx?|odt|ods|rtf|zip|rar|7z|pdf)(\?|$)", re.I)
IMG_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif",
           "image/svg+xml": ".svg", "image/webp": ".webp", "image/bmp": ".bmp"}


# ================================================================ какой это тип №10
TEXT_RE = re.compile(r"текстов\w*\s+(?:редактор|процессор)|слово\s+целиком|только\s+слово|учитыва\w*\s+регистр"
                     r"|не\s+считая\s+сносок|средств\w*\s+поиска|функци\w*\s+(?:поиска|«?найти)", re.I)
TEXT_WEAK_RE = re.compile(r"встреча\w*[^.]{0,80}(?:слов|сочетани|буквосочетани)|(?:слов|сочетани)\w*[^.]{0,80}встреча", re.I)
IP_RE = re.compile(r"IP-?\s*адрес|TCP\s*/\s*IP|маск\w*\s+(?:сети|подсети)|адрес\w*\s+(?:сети|узла)", re.I)


def kind_of(text, file_names=()):
    """'text' — поиск слова в тексте, 'ip' — IP-адреса и маски, None — что-то другое."""
    t = (text or "").replace("\xa0", " ")
    if TEXT_RE.search(t):
        return "text"
    has_doc = any(Path(str(n).split("?")[0]).suffix.lower() in DOC_EXT for n in file_names)
    if has_doc and TEXT_WEAK_RE.search(t):
        return "text"
    if IP_RE.search(t):
        return "ip"
    return None


# ================================================================ помощники
DIV_TAG = re.compile(r"<(/?)div\b[^>]*>", re.I)


def div_at(s, start):
    depth, open_end = 0, None
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
    m = re.compile(pattern, re.I | re.S).search(s, start)
    if not m:
        return None
    r = div_at(s, m.start())
    return s[r[0]:r[1]] if r else None


def html_to_text(h):
    h = re.sub(r"<br\s*/?>", "\n", h or "", flags=re.I)
    h = re.sub(r"</(p|div|tr|li|h\d|pre)>", "\n", h, flags=re.I)
    h = re.sub(r"</t[dh]>", "\t", h, flags=re.I)
    h = re.sub(r"<[^>]+>", "", h)
    t = H.unescape(h).replace("\xa0", " ").replace("\r", "")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    return "\n".join(ln for ln in lines if ln)


def safe(s, limit=80):
    """Имя файла/папки: без запрещённых в Windows символов, не зависит от регистра букв."""
    s = str(s)
    base = re.sub(r"[^\w.\-]+", "_", unquote(s)).strip("._")[:limit] or "x"
    if base.lower() != base or base != s:
        base += "-" + hashlib.md5(s.encode()).hexdigest()[:6]
    return base


def file_name(url, fallback="file"):
    name = unquote(urlsplit(url).path.rsplit("/", 1)[-1]) or fallback
    name = re.sub(r'[\\/:*?"<>|]+', "_", name).strip(" .")
    return name[:120] or fallback


def write_json(path, value, indent=1):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=indent), encoding="utf-8")
    os.replace(tmp, path)


# ================================================================ сеть
class Net:
    def __init__(self, delay):
        self.delay = delay
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()))
        self.last = 0.0
        self.requests = 0

    def _wait(self):
        dt = time.time() - self.last
        if dt < self.delay:
            time.sleep(self.delay - dt)
        self.last = time.time()

    def _open(self, url, timeout):
        self._wait()
        self.requests += 1
        req = Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate",
                                    "Accept-Language": "ru,en;q=0.8"})
        return self.opener.open(req, timeout=timeout)

    def get(self, url, tries=4):
        err = None
        for attempt in range(tries):
            try:
                with self._open(url, 60) as r:
                    body = r.read()
                    enc = (r.headers.get("Content-Encoding") or "").lower()
                    if enc == "gzip":
                        body = gzip.decompress(body)
                    elif enc == "deflate":
                        body = zlib.decompress(body)
                    m = re.search(r"charset=([\w-]+)", r.headers.get("Content-Type") or "")
                    return body.decode(m.group(1) if m else "utf-8", errors="replace")
            except HTTPError as e:
                if e.code in (401, 403, 404, 410):
                    raise
                err = e
                if e.code == 429:
                    time.sleep(30)
            except (URLError, TimeoutError, OSError) as e:
                err = e
            wait = 5 * (attempt + 1)
            print(f"      сбой ({err}), повтор через {wait} с…", flush=True)
            time.sleep(wait)
        raise err

    def download(self, url, dest: Path):
        """Скачать файл (через временный .part). Уже скачанный не качает повторно."""
        if dest.is_file() and dest.stat().st_size > 0:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        err = None
        for attempt in range(4):
            try:
                with self._open(url, 120) as r, open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                os.replace(tmp, dest)
                return True
            except HTTPError as e:
                tmp.unlink(missing_ok=True)
                if e.code in (401, 403, 404, 410):
                    raise
                err = e
            except (URLError, TimeoutError, OSError) as e:
                tmp.unlink(missing_ok=True)
                err = e
            time.sleep(5 * (attempt + 1))
        raise err


# ================================================================ общая часть: картинки, файлы, запись
class Bank:
    def __init__(self, args):
        self.a = args
        self.out = Path(args.out).resolve()
        self.raw = self.out / "raw"
        self.net = Net(args.delay)
        self.stats = Counter()
        self.problems = []
        self.skipped = []           # (источник, id, начало текста) — не поиск в тексте и не IP
        self.written = set()        # пути записанных заданий (для чистки устаревших)

    def note(self, src, tid, msg):
        self.problems.append(f"{src} {tid}: {msg}")

    def images(self, h, src, tid, base):
        """Картинки условия → assets/<источник>/<id>/, ссылки в HTML — относительно папки банка."""
        rel_dir = f"assets/{src}/{safe(tid)}"

        def data_uri(m):
            q, mime, b64 = m.group(1), m.group(2).lower(), m.group(3)
            try:
                data = base64.b64decode(re.sub(r"\s+", "", b64))
            except Exception:
                self.note(src, tid, "битая картинка base64")
                return m.group(0)
            name = hashlib.sha1(data).hexdigest()[:16] + IMG_EXT.get(mime, ".img")
            f = self.out / rel_dir / name
            if not f.exists():
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(data)
            self.stats["картинок"] += 1
            return f"src={q}{rel_dir}/{name}{q}"

        h = re.sub(r"""src=(["'])data:(image/[\w.+-]+);base64,([A-Za-z0-9+/=\s]+)\1""", data_uri, h or "")

        def remote(m):
            q, url = m.group(1), H.unescape(m.group(2))
            if url.startswith(("data:", "assets/")):
                return m.group(0)
            full = urljoin(base, url)
            if urlsplit(full).scheme not in ("http", "https") or self.a.no_images:
                return m.group(0)
            ext = os.path.splitext(urlsplit(full).path)[1][:6].lower()
            if not re.fullmatch(r"\.[a-z0-9]{2,5}", ext):
                ext = ".img"
            name = hashlib.sha1(full.encode()).hexdigest()[:16] + ext
            try:
                if self.net.download(full, self.out / rel_dir / name):
                    self.stats["картинок"] += 1
            except Exception as e:
                self.note(src, tid, f"картинка {full}: {e}")
                return f"src={q}{full}{q}"
            return f"src={q}{rel_dir}/{name}{q}"

        return re.sub(r"""src=(["'])([^"']+)\1""", remote, h)

    def files(self, entries, src, tid):
        """entries: [(url, имя)] → [{"name", "path", "url"}] с файлами в files/<источник>/<id>/."""
        out, seen = [], set()
        for url, name in entries:
            if not url or url in seen:
                continue
            seen.add(url)
            name = (name or "").strip() or file_name(url)
            if not Path(name).suffix and Path(file_name(url)).suffix:
                name += Path(file_name(url)).suffix
            name = re.sub(r'[\\/:*?"<>|]+', "_", name)[:120]
            rel = f"files/{src}/{safe(tid)}/{name}"
            e = {"name": name, "url": url}
            if not self.a.no_files:
                try:
                    if self.net.download(url, self.out / rel):
                        self.stats["файлов скачано"] += 1
                        print(f"      файл {name}", flush=True)
                except Exception as ex:
                    self.note(src, tid, f"файл {url}: {ex}")
            if (self.out / rel).is_file():
                e["path"] = rel
            out.append(e)
        return out

    def save(self, src, tid, html, answer, files=(), **extra):
        """Классифицирует задание и пишет tasks/NN/<источник>_<id>.json (формат ege_bank)."""
        text = html_to_text(html)
        names = [f[1] or f[0] for f in files]
        kind = kind_of(text, names)
        self.stats[f"{src}: просмотрено"] += 1
        if kind is None:
            self.skipped.append((src, tid, text[:90].replace("\n", " ")))
            self.stats[f"{src}: не №10 нужного типа"] += 1
            return None
        if self.a.kind != "all" and kind != self.a.kind:
            self.stats[f"{src}: {'IP-адреса' if kind == 'ip' else 'поиск в тексте'} (пропущено, --kind)"] += 1
            return None
        if not answer:
            self.stats[f"{src}: без ответа (пропущено)"] += 1
            self.note(src, tid, "нет ответа")
            return None
        base = {"yandex": YANDEX_BASE, "kompege": KOMPEGE + "/", "fipi": FIPI + "/"}[src]
        h = self.images(html, src, tid, base)
        att = self.files(files, src, tid)
        if kind == "text" and not att:
            self.note(src, tid, "поиск в тексте, но к заданию нет файла")
        n = SITE_NUM[kind]
        doc = {
            "id": f"{src}_{tid}",
            "number": n,
            "kim": KIM,
            "kind": kind,
            "source": extra.pop("source", None) or SRC_TITLE[src],
            "text_html": h.strip(),
            "text": html_to_text(h),
            "answer": str(answer).strip(),
            "files": att,
            "images_original": [],
            "actual": True,            # для КИМ-2027 тип актуален, даже если сайт пометил его «старым»
        }
        sol = extra.pop("solution_html", None)
        if sol and html_to_text(sol):
            doc["solution_html"] = self.images(sol, src, tid, base)
        doc.update({k: v for k, v in extra.items() if v not in (None, "", [], {})})
        p = self.out / "tasks" / f"{n:02d}" / f"{safe(src + '_' + str(tid), 120)}.json"
        write_json(p, doc)
        self.written.add(p)
        self.stats[f"{src}: записано №{n}"] += 1
        return doc

    def cleanup(self, sources_done):
        """Задания источника, которых больше нет на сайте, убираем — только после полного прохода по источнику
        и только того типа, что собирали в этот раз (--kind text не трогает собранные раньше IP-адреса)."""
        kinds = ("text", "ip") if self.a.kind == "all" else (self.a.kind,)
        folders = {f"{SITE_NUM[k]:02d}" for k in kinds}
        for p in (self.out / "tasks").rglob("*.json"):
            src = p.name.split("_", 1)[0]
            if p.parent.name in folders and src in sources_done and p not in self.written:
                p.unlink()
                self.stats[f"{src}: удалено (нет на сайте)"] += 1

    def report(self, started):
        by_num = Counter(p.parent.name for p in (self.out / "tasks").rglob("*.json"))
        lines = [f"Задания №10: {datetime.now().isoformat(timespec='seconds')}",
                 "В папке: " + (", ".join(f"№{int(k)} — {v}" for k, v in sorted(by_num.items())) or "пусто"),
                 "", "Статистика:"] + [f"  {k}: {v}" for k, v in sorted(self.stats.items())]
        lines.append(f"  запросов: {self.net.requests}, время: {(time.time() - started) / 60:.1f} мин")
        if self.skipped:
            lines += ["", f"Не похожи на №10 (не сохранены), {len(self.skipped)}:"] + \
                     [f"  {s} {t}: {x}" for s, t, x in self.skipped[:300]]
        if self.problems:
            lines += ["", f"Проблемы ({len(self.problems)}):"] + [f"  {x}" for x in self.problems[:300]]
        (self.out / "report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n" + "\n".join(lines[:2]))
        for k, v in sorted(self.stats.items()):
            print(f"  {k}: {v}")
        print(f"Отчёт: {self.out / 'report.txt'}")


# ================================================================ КомпЕГЭ (открытый API)
def run_kompege(bank):
    a = bank.a
    sections = a.kompege_sections
    print(f"КомпЕГЭ: разделы {', '.join(map(str, sections))}", flush=True)
    ok = True
    seen = set()
    for sec in sections:
        cache = bank.raw / "kompege" / f"number_{sec}.json"
        try:
            if cache.is_file() and not a.refresh:
                tasks = json.loads(cache.read_text(encoding="utf-8"))
            else:
                tasks = json.loads(bank.net.get(f"{KOMPEGE}/api/v1/task/number/{sec}"))
                write_json(cache, tasks, indent=None)
        except HTTPError as e:
            if e.code == 404:
                print(f"   раздел {sec}: нет на сайте", flush=True)
                continue
            print(f"   раздел {sec}: {e}", flush=True)
            bank.note("kompege", sec, str(e))
            ok = False
            continue
        except Exception as e:
            print(f"   раздел {sec}: {e}", flush=True)
            bank.note("kompege", sec, str(e))
            ok = False
            continue
        if not isinstance(tasks, list):
            bank.note("kompege", sec, "ответ API — не список (сайт изменил формат?)")
            ok = False
            continue
        print(f"   раздел {sec}: {len(tasks)} заданий", flush=True)
        for t in tasks:
            if not isinstance(t, dict) or "taskId" not in t:
                continue
            tid = str(t["taskId"])
            if tid in seen:
                continue
            seen.add(tid)
            h = t.get("text") or ""
            for st in t.get("subTask") or []:         # у №10 подзадач обычно нет; если есть — вопрос целиком
                if isinstance(st, dict) and st.get("text"):
                    h += f'<hr class="subtask-sep"><div class="subtask">{st["text"]}</div>'
            ans = html_to_text(t.get("key") or "")
            subs = [html_to_text(st.get("key") or "") for st in t.get("subTask") or [] if isinstance(st, dict)]
            if subs and any(subs):
                ans = "\n".join(x for x in [ans] + subs if x)
            files = [(urljoin(KOMPEGE + "/", f["url"]), f.get("name")) for f in t.get("files") or []
                     if isinstance(f, dict) and f.get("url")]
            video = None
            if t.get("video") and t.get("videotype") in (None, "", "yt", "youtube"):
                video = {"yt": str(t["video"]), "t": int(re.sub(r"\D", "", str(t.get("timecode") or 0)) or 0)}
            dates = {k: v for k, v in t.items() if re.search(r"creat|date|publish|updat", k, re.I) and v}
            bank.save("kompege", tid, h, ans, files,
                      source="КомпЕГЭ" + (f" · {t['comment']}" if t.get("comment") else ""),
                      level=t.get("difficulty"), url=f"{KOMPEGE}/task?id={tid}", video=video,
                      solution_html=t.get("solve_text"), site_section=sec, **dates)
    return ok


# ================================================================ открытый банк ФИПИ (openfipi.devinf.ru)
def fipi_list_page(s):
    """-> (задания на странице, есть ли следующая страница, всего)"""
    total = None
    m = re.search(r"из\s*<b>\s*([\d\s,.\xa0]+)\s*</b>", s)
    if m:
        total = int(re.sub(r"\D", "", m.group(1)) or 0) or None
    has_next = bool(re.search(r'class="pagination-next"[^>]*href="', s))
    start = max(s.find("<!-- Список заданий -->"), 0)
    items = []
    for m in re.finditer(r'<div class="box">', s[start:]):
        r = div_at(s, start + m.start())
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
        tags = [x.strip() for x in re.findall(r'<span class="tag[^"]*">\s*([^<]*?)\s*</span>', head)]
        date = re.search(r"(\d\d)\.(\d\d)\.(\d{4})\s+(\d\d):(\d\d):(\d\d)", head)
        items.append({
            "id": H.unescape(idm.group(1)), "n": int(num.group(1)),
            "site_actual": any("Актуальн" in x for x in tags) or not any("Стар" in x for x in tags),
            "has_answer": any(x == "Есть ответ" for x in tags),
            "date": (f"{date.group(3)}-{date.group(2)}-{date.group(1)}T{date.group(4)}:{date.group(5)}:{date.group(6)}"
                     if date else None),
            "html": (div_inner(body, r'<div class="content"[^>]*>') or "").strip(),
        })
    return items, has_next, total


def fipi_task_page(s):
    out = {}
    blk = div_inner(s, r'<div id="answerContent"[^>]*>')
    if blk is not None:
        inner = div_inner(blk, r'<div class="notification[^"]*"[^>]*>') or blk
        out["answer"] = html_to_text(re.sub(r"<strong>\s*Ответ:?\s*</strong>", "", inner, count=1, flags=re.I))
    blk = div_inner(s, r'<div id="solutionContent"[^>]*>')
    if blk is not None:
        inner = div_inner(blk, r'<div class="notification[^"]*"[^>]*>') or blk
        inner = re.sub(r"<strong>\s*Решение:?\s*</strong>", "", inner, count=1, flags=re.I).strip()
        out["solution_html"] = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", inner)
    body = s.split("<!-- Текст задания -->", 1)
    if len(body) == 2:
        c = div_inner(body[1], r'<div class="content"[^>]*style="[^"]*"[^>]*>')
        if c:
            out["html"] = c.strip()
    return out


def fipi_take_files(h):
    """Ссылки на /files/… → список файлов; сами ссылки (картинку «скачать») из условия убираем."""
    files = []

    def repl(m):
        full = urljoin(FIPI + "/", H.unescape(m.group(2)))
        if not urlsplit(full).path.startswith("/files/"):
            return m.group(0)
        files.append((full, file_name(full)))
        return ""

    h = re.sub(r"""<a\b[^>]*href=(["'])([^"']*?/files/[^"']+)\1[^>]*>.*?</a>""", repl, h, flags=re.S | re.I)
    return re.sub(r"<p[^>]*>\s*</p>", "", h), files


def run_fipi(bank):
    a = bank.a
    wanted_nums = set(a.numbers)
    print("ФИПИ: списки заданий (берутся задания с номерами " + ", ".join(map(str, sorted(wanted_nums))) + ")…",
          flush=True)
    items, page, total, complete = {}, 1, None, False
    try:
        bank.net.get(f"{FIPI}/")
    except Exception as e:
        print(f"   главная не открылась: {e}", flush=True)
    while True:
        url = f"{FIPI}/tasks_ege/" if page == 1 else f"{FIPI}/tasks_ege/page/{page}"
        try:
            s = bank.net.get(url)
        except Exception as e:
            if page == 1:
                bank.note("fipi", "список", str(e))
                print(f"   список не открылся: {e}", flush=True)
                return False
            print(f"   страница {page} не открылась ({e}) — дальше с тем, что есть", flush=True)
            break
        got, has_next, t = fipi_list_page(s)
        total = total or t
        if page == 1 and not got:
            dbg = bank.raw / "fipi" / "debug_list_page1.html"
            dbg.parent.mkdir(parents=True, exist_ok=True)
            dbg.write_text(s, encoding="utf-8")
            print(f"   на первой странице заданий не нашлось — сохранил её: {dbg}", flush=True)
            return False
        for it in got:
            if it["n"] in wanted_nums:
                items.setdefault(it["id"], it)
        if page == 1 or page % 20 == 0 or not has_next:
            print(f"   страница {page}: №{'/'.join(map(str, sorted(wanted_nums)))} — {len(items)}"
                  + (f" (всего на сайте {total})" if total else ""), flush=True)
        if not has_next or (a.fipi_max_pages and page >= a.fipi_max_pages):
            complete = not has_next and not a.fipi_max_pages
            break
        page += 1

    print(f"   заданий №10 в списке: {len(items)}; с ответом: {sum(1 for x in items.values() if x['has_answer'])}",
          flush=True)
    cache = bank.raw / "fipi" / "task"
    cache.mkdir(parents=True, exist_ok=True)
    for i, it in enumerate(items.values(), 1):
        info = {}
        k = kind_of(html_to_text(it["html"]), [u for u, _ in fipi_take_files(it["html"])[1]])
        if a.kind != "all" and k and k != a.kind:         # другой тип — страницу задания не качаем
            bank.stats["fipi: просмотрено"] += 1
            bank.stats[f"fipi: {'IP-адреса' if k == 'ip' else 'поиск в тексте'} (пропущено, --kind)"] += 1
            continue
        if it["has_answer"]:
            p = cache / (safe(it["id"]) + ".html")
            try:
                if p.is_file() and not a.refresh:
                    info = fipi_task_page(p.read_text(encoding="utf-8"))
                if not info.get("answer"):
                    s = bank.net.get(f"{FIPI}/task/{it['id']}")
                    p.write_text(s, encoding="utf-8")
                    info = fipi_task_page(s)
            except Exception as e:
                bank.note("fipi", it["id"], f"страница задания: {e}")
        h, files = fipi_take_files(info.get("html") or it["html"])
        bank.save("fipi", it["id"], h, info.get("answer"), files,
                  url=f"{FIPI}/task/{it['id']}", date=it["date"], site_actual=it["site_actual"],
                  solution_html=info.get("solution_html"))
        if i % 50 == 0:
            print(f"   обработано {i} из {len(items)}", flush=True)
    return complete


# ================================================================ Яндекс ЕГЭ (через браузер)
TITLE_RE = re.compile(r"^\s*Задание\s+(\d{1,2})\s*$")
SERVICE_RE = re.compile(r"\s*(Показать|Скрыть)\s+(ответ|решение|разбор)\s*|\s*Решать в тренаж[её]ре\s*")
LEVEL_RE = re.compile(r"(ЕГЭ|Проще|Сложнее|Базов|Повышен|Высок|уровень)", re.I)

# Помечает новые карточки атрибутом data-sid. Карточка — наименьший блок с заголовком «Задание N»
# и кнопкой «Решать в тренажере».
JS_MARK_CARDS = r"""
() => {
  const isTitle = el => /^\s*Задание\s+\d{1,2}\s*$/.test(el.textContent || '');
  const anchors = [...document.querySelectorAll('button, a, [role=button], span, div')]
      .filter(e => e.children.length <= 1 && /Решать в тренаж[её]ре/.test(e.textContent || '')
                   && (e.textContent || '').trim().length < 40);
  let next = document.querySelectorAll('[data-sid]').length;
  const fresh = [], seen = new Set();
  for (const a of anchors) {
    let card = a.parentElement;
    while (card && card !== document.body) {
      if ([...card.querySelectorAll('h1,h2,h3,h4,div,span,p')].some(isTitle)) break;
      card = card.parentElement;
    }
    if (!card || card === document.body || seen.has(card)) continue;
    seen.add(card);
    if (!card.hasAttribute('data-sid')) { card.setAttribute('data-sid', String(next++)); fresh.push(card.getAttribute('data-sid')); }
  }
  return fresh;
}
"""

# Условие карточки: HTML без кнопок и заголовка, картинки, ссылки.
JS_EXTRACT = r"""
(card) => {
  const titleEl = [...card.querySelectorAll('h1,h2,h3,h4,div,span,p')]
      .find(e => /^\s*Задание\s+\d{1,2}\s*$/.test(e.textContent || ''));
  const links = [...card.querySelectorAll('a[href]')].map(a => ({href: a.href, text: a.innerText.trim(), download: a.hasAttribute('download')}));
  const c = card.cloneNode(true);
  c.querySelectorAll('button, [role=button], script, style, noscript').forEach(e => e.remove());
  c.querySelectorAll('*').forEach(e => {
    if (/^\s*(Показать|Скрыть)\s+(ответ|решение|разбор)\s*$|^\s*Решать в тренаж[её]ре\s*$/.test(e.textContent || '') && e.children.length <= 2) e.remove();
  });
  const t = [...c.querySelectorAll('h1,h2,h3,h4,div,span,p')].find(e => /^\s*Задание\s+\d{1,2}\s*$/.test(e.textContent || ''));
  if (t) { const row = t.parentElement && t.parentElement !== c && t.parentElement.innerText.length < 60 ? t.parentElement : t; row.remove(); }
  c.querySelectorAll('img').forEach((im, k) => { const real = card.querySelectorAll('img')[k]; if (real) im.setAttribute('src', real.currentSrc || real.src); im.removeAttribute('srcset'); });
  c.querySelectorAll('[class]').forEach(e => { if (!/katex/.test(e.className)) e.removeAttribute('class'); });
  c.removeAttribute('data-sid');
  return {title: titleEl ? titleEl.textContent.trim() : '', text: card.innerText, html: c.innerHTML, links};
}
"""


def clean_lines(text):
    out = []
    for ln in (text or "").replace("\xa0", " ").splitlines():
        ln = SERVICE_RE.sub(" ", ln).strip()
        if ln:
            out.append(ln)
    return out


def yandex_card(d, before_text, number):
    lines = clean_lines(d["text"])
    before = clean_lines(before_text)
    bs = set(before)
    answer = "\n".join(ln for ln in lines if ln not in bs).strip()
    m = re.search(r"(?:Правильный\s+)?[Оо]твет\s*[:：]?\s*(.*)", answer, re.S)
    if m:
        answer = m.group(1).strip()
    head = [ln for ln in before if not TITLE_RE.match(ln)][:3]
    level = next((ln for ln in head if LEVEL_RE.search(ln) and len(ln) < 40), None)
    if level:
        level = re.sub(r"^[^\wА-Яа-яЁё]+", "", level).strip()
    source = next((ln for ln in head if ln != level and len(ln) < 120 and
                   re.search(r"\(|Учебник|Поляков|ФИПИ|Демо|Апробац|Крылов|Джобс|вариант", ln, re.I)), None)
    task_id = next((mm.group(1) for ln in d["links"]
                    for mm in [re.search(r"task_id=([0-9a-f\-]{36})", ln["href"])] if mm), None)
    files = [{"url": ln["href"], "name": ln["text"] or None} for ln in d["links"]
             if ln["download"] or FILE_EXT_RE.search(ln["href"])]
    uid = task_id or hashlib.sha1(f"{number}|{'|'.join(before)}".encode()).hexdigest()[:16]
    return {"id": uid, "taskId": task_id, "number": number, "level": level, "source": source,
            "html": d["html"], "answer": answer or None, "files": files}


def yandex_first_title(page):
    try:
        return page.evaluate(r"""() => {
            const e = [...document.querySelectorAll('h1,h2,h3,h4,div,span,p')]
              .find(x => /^\s*Задание\s+\d{1,2}\s*$/.test(x.textContent||'') && x.getBoundingClientRect().left > 300);
            return e ? e.textContent.trim() : '';
        }""")
    except Exception:
        return ""


def yandex_select(page, n):
    """В левой колонке открывает список «Задание» и выбирает «Задание n»."""
    from playwright.sync_api import TimeoutError as PWTimeout
    page.keyboard.press("Escape")
    page.evaluate("window.scrollTo(0, 0)")
    time.sleep(0.5)
    name = f"Задание {n}"
    if yandex_first_title(page) == name:
        return True
    opener = None
    loc = page.get_by_text(re.compile(r"^\s*Задание\s+\d{1,2}\s*$"))
    for i in range(min(loc.count(), 80)):
        el = loc.nth(i)
        try:
            box = el.bounding_box()
            if box and box["x"] < 350 and box["y"] > 100 and el.is_visible():
                opener = el
                break
        except Exception:
            pass
    if opener is None:
        return False
    obox = opener.bounding_box()
    opener_bottom = obox["y"] + obox["height"] - 2
    opener.click()
    time.sleep(0.6)
    option = None
    for cand in [page.get_by_role("option", name=name, exact=True),
                 page.locator("[role=listbox]").get_by_text(name, exact=True)]:
        try:
            if cand.count():
                option = cand.first
                break
        except Exception:
            pass
    if option is None:
        loc = page.get_by_text(name, exact=True)
        for i in range(loc.count()):
            el = loc.nth(i)
            try:
                el.scroll_into_view_if_needed(timeout=2000)
                box = el.bounding_box()
                if box and box["x"] < 350 and box["y"] > opener_bottom:
                    option = el
                    break
            except Exception:
                pass
    if option is None:
        page.keyboard.press("Escape")
        return False
    option.scroll_into_view_if_needed(timeout=3000)
    option.click()
    for _ in range(40):
        time.sleep(0.5)
        if yandex_first_title(page) == name:
            try:
                page.wait_for_load_state("networkidle", timeout=5000)
            except PWTimeout:
                pass
            return True
    return yandex_first_title(page) == name


def yandex_scrape(bank, n):
    """Карточки «Задание n» → raw/yandex/number_n.json (продолжает с уже собранного)."""
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright
    a = bank.a
    raw = bank.raw / "yandex" / f"number_{n}.json"
    cards = {}
    if raw.is_file() and not a.refresh:
        cards = {c["id"]: c for c in json.loads(raw.read_text(encoding="utf-8"))}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=a.headless)
        page = browser.new_context(locale="ru-RU", viewport={"width": 1400, "height": 1000}).new_page()
        print("   открываю банк заданий…", flush=True)
        page.goto(YANDEX_URL, wait_until="domcontentloaded", timeout=90_000)
        try:
            page.wait_for_load_state("networkidle", timeout=20_000)
        except PWTimeout:
            pass
        time.sleep(2)
        if not yandex_select(page, n):
            page.goto(YANDEX_URL, wait_until="domcontentloaded", timeout=90_000)
            time.sleep(3)
            if not yandex_select(page, n):
                browser.close()
                raise RuntimeError(f"не удалось выбрать «Задание {n}» в списке")
        idle, before_count = 0, len(cards)
        while idle < 6:
            new = 0
            for sid in page.evaluate(JS_MARK_CARDS):
                card = page.locator(f'[data-sid="{sid}"]')
                try:
                    d0 = card.evaluate(JS_EXTRACT)
                    after = d0["text"]
                    if not a.no_answers:
                        btn = card.get_by_text(re.compile(r"^\s*Показать ответ\s*$"))
                        if btn.count():
                            try:
                                btn.first.click(timeout=3000)
                                page.wait_for_timeout(250)
                                after = card.inner_text(timeout=5000)
                            except Exception:
                                page.keyboard.press("Escape")
                    tm = TITLE_RE.match(d0["title"] or "")
                    if tm and int(tm.group(1)) != n:
                        continue
                    c = yandex_card({**d0, "text": after}, d0["text"], n)
                    if c["id"] not in cards:
                        new += 1
                    cards[c["id"]] = c
                except Exception as e:
                    print(f"   карточка {sid}: {e}", flush=True)
            if new:
                write_json(raw, list(cards.values()))
                print(f"   собрано {len(cards)}", flush=True)
            page.mouse.move(800, 500)
            page.mouse.wheel(0, 6000)
            page.evaluate("window.scrollBy(0, 6000)")
            try:
                page.wait_for_load_state("networkidle", timeout=4000)
            except PWTimeout:
                pass
            time.sleep(0.8)
            idle = 0 if new else idle + 1
        browser.close()
    write_json(raw, list(cards.values()))
    print(f"   Задание {n}: {len(cards)} карточек (новых {len(cards) - before_count})", flush=True)
    return list(cards.values())


def run_yandex(bank):
    try:
        import playwright  # noqa: F401
    except ImportError:
        print("Яндекс: нужен Playwright — pip install playwright && python -m playwright install chromium. Пропускаю.",
              flush=True)
        bank.note("yandex", "-", "Playwright не установлен")
        return False
    ok = True
    for n in bank.a.numbers:
        print(f"Яндекс ЕГЭ: «Задание {n}»", flush=True)
        try:
            cards = yandex_scrape(bank, n)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"   ошибка: {e}", flush=True)
            bank.note("yandex", n, str(e))
            ok = False
            raw = bank.raw / "yandex" / f"number_{n}.json"
            cards = json.loads(raw.read_text(encoding="utf-8")) if raw.is_file() else []
            if cards:
                print(f"   беру то, что уже собрано: {len(cards)}", flush=True)
        for c in cards:
            files = [(urljoin(YANDEX_BASE, f["url"]), f.get("name")) for f in c.get("files") or []]
            bank.save("yandex", c["id"], c["html"], c.get("answer"), files,
                      source=("Яндекс Учебник · " + c["source"]) if c.get("source") else None,
                      level=c.get("level"),
                      url=f"https://education.yandex.ru/ege/inf/tasks?task_id={c['taskId']}" if c.get("taskId") else None)
    return ok


# ================================================================ main
def main():
    ap = argparse.ArgumentParser(description="Парсер заданий №10 ЕГЭ по информатике (Яндекс ЕГЭ, КомпЕГЭ, ФИПИ)")
    biblio = HERE if any((HERE / b).is_dir() for b in ("ege_bank", "kompege_bank", "trainer")) else HERE.parent
    ap.add_argument("--out", default=str(biblio / "task10_bank"), help="куда сохранять (по умолчанию Biblio/task10_bank)")
    ap.add_argument("--source", default="yandex,kompege,fipi", help="какие сайты: yandex,kompege,fipi")
    ap.add_argument("--kind", choices=("text", "ip", "all"), default="text",
                    help="text — поиск слова в тексте (№10 КИМ-2027, по умолчанию), ip — IP-адреса, all — оба")
    ap.add_argument("--numbers", default="10", help="номер задания на сайтах-источниках (по умолчанию 10)")
    ap.add_argument("--kompege-sections", default=None,
                    help="разделы КомпЕГЭ (по умолчанию номер и его архив: 10,110)")
    ap.add_argument("--delay", type=float, default=1.0, help="пауза между запросами, с (не меньше 0.5)")
    ap.add_argument("--refresh", action="store_true", help="перекачать списки и страницы, а не брать из кэша")
    ap.add_argument("--no-files", action="store_true", help="не скачивать файлы к заданиям")
    ap.add_argument("--no-images", action="store_true", help="не скачивать картинки")
    ap.add_argument("--headless", action="store_true", help="Яндекс: браузер без окна")
    ap.add_argument("--no-answers", action="store_true", help="Яндекс: не нажимать «Показать ответ» (задания без ответа не сохраняются)")
    ap.add_argument("--fipi-max-pages", type=int, default=0, help="ФИПИ: сколько страниц списка пройти (для пробы)")
    ap.add_argument("--kompege-base", default=None, help=argparse.SUPPRESS)     # для проверки на локальной копии
    ap.add_argument("--fipi-base", default=None, help=argparse.SUPPRESS)
    a = ap.parse_args()
    global KOMPEGE, FIPI
    if a.kompege_base:
        KOMPEGE = a.kompege_base.rstrip("/")
    if a.fipi_base:
        FIPI = a.fipi_base.rstrip("/")
    a.delay = max(a.delay, 0.5) if not (a.kompege_base or a.fipi_base) else max(a.delay, 0)
    a.numbers = sorted({int(x) for x in a.numbers.split(",") if x.strip()})
    a.kompege_sections = ([int(x) for x in a.kompege_sections.split(",") if x.strip()] if a.kompege_sections
                          else [s for n in a.numbers for s in (n, 100 + n)])
    sources = [s.strip() for s in a.source.split(",") if s.strip()]
    bad = [s for s in sources if s not in SRC_TITLE]
    if bad:
        ap.error("неизвестный источник: " + ", ".join(bad) + " (можно yandex, kompege, fipi)")

    bank = Bank(a)
    bank.out.mkdir(parents=True, exist_ok=True)
    print(f"Сохраняю в: {bank.out}\nТип: " + {"text": "поиск слова в тексте", "ip": "IP-адреса", "all": "все №10"}[a.kind])
    started = time.time()
    done = []
    try:
        for s in sources:
            ok = {"kompege": run_kompege, "fipi": run_fipi, "yandex": run_yandex}[s](bank)
            if ok:
                done.append(s)
    except KeyboardInterrupt:
        print("\nОстановлено. Уже скачанное сохранено — запустите снова, чтобы продолжить.")
    bank.cleanup(done)
    bank.report(started)
    print("\nДальше: python build.py")


if __name__ == "__main__":
    main()
