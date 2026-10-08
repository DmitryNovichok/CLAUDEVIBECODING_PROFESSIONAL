#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сервер тренажёра ЕГЭ: ученики входят по ФИО, ответы проверяются на сервере,
каждая попытка пишется в журнал, учитель смотрит его в панели /admin.

Запуск (из папки trainer, нужен только Python 3.8+):
    python server.py                    # порт 8000, доступен из локальной сети
    python server.py --port 8080
    python server.py --password НОВЫЙ   # задать пароль учителя и выйти

При первом запуске сервер придумает пароль учителя и напечатает его.
Данные (ученики, журнал) лежат в trainer/server_data/trainer.db — это обычная
база SQLite, её можно копировать для резервной копии.

Банк заданий берётся из data/bank.js (собирается build.py). Ученикам он
отдаётся БЕЗ ответов и решений — их не подсмотреть в коде страницы.
Если пересобрать банк, сервер подхватит его сам, перезапуск не нужен.
"""
import argparse
import csv
import gzip
import hashlib
import hmac
import io
import json
import math
import mimetypes
import os
import posixpath
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import zipfile
from datetime import datetime, timedelta
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

HERE = Path(__file__).resolve().parent            # папка trainer
BIBLIO = HERE.parent                              # где обычно лежат банки: Biblio/trainer + Biblio/*_bank
BANKS_ROOT = None                                 # папка с банками, заданная вручную (--banks), хранится в базе
DATA_DIR = HERE / "server_data"
DB_PATH = DATA_DIR / "trainer.db"
BANK_JS = HERE / "data" / "bank.js"

# что можно отдавать из папки trainer
SITE_FILES = {"index.html", "app.js", "style.css", "admin.html", "admin.js", "admin.css", "py-worker.js"}
SITE_DIRS = ("vendor/", "media/")
# расширения файлов к заданиям, которые можно отдавать из банков (json/html — никогда: там ответы)
BANK_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".emf", ".wmf", ".img",
            ".txt", ".csv", ".tsv", ".xlsx", ".xls", ".xlsm", ".ods", ".odt", ".docx", ".doc", ".rtf",
            ".pdf", ".zip", ".rar", ".7z", ".py", ".pas", ".cpp", ".dat"}
MAX_BODY = 4_000_000
ADMIN_SESSION_DAYS = 14
DEFAULT_INVITE = "16082001"        # пригласительный код для учеников (меняется в панели учителя)
STUDENT_COOKIE_DAYS = 365
# защита от перебора: столько неудачных попыток с одного адреса за окно — и пауза
FAIL_WINDOW = 15 * 60
FAIL_LIMIT = {"invite": 30, "admin": 10, "find": 40,
              "login": 30,       # неверные пароли учеников с одного адреса
              "account": 10}     # …и для одного ученика (подбор пароля к конкретному ФИО)   # код вводит весь класс с одного адреса школы — ему запас больше
# «Показать ответ»: сначала нужно подумать, и показов в час не больше лимита.
# Иначе, зная код, можно под выдуманным ФИО выкачать ответы на весь банк.
THINK_SEC_DEFAULT = 40              # через сколько секунд после открытия задания можно открыть ответ
THINK_SEC_HARD = 90                 # …для длинных задач 24–27
REVEAL_PER_HOUR = 12                # показов ответа в час на ученика
REVEAL_PER_HOUR_IP = 150            # …и на один адрес: против выдуманных ФИО (весь класс сидит за одним адресом школы)
ACTIVITY_KINDS = {"away", "shot"}     # ушёл со вкладки; нажал клавиши снимка экрана
ACTIVITY_PER_HOUR = 300
MAX_SOLUTION = 50_000                 # символов в решении (код или текст)
ATTEMPTS_PER_TASK = 2               # попыток на задание; считает сервер, а не страница
OPEN_TTL = 6 * 3600                 # сколько помнить открытое задание
# Вариант ЕГЭ
EXAM_LIMIT_SEC = (3 * 60 + 55) * 60
EXAM_PER_DAY = 3                    # вариантов в сутки на ученика
EXAM_PER_DAY_IP = 60                # …и на адрес (класс за одним адресом)
EXAM_MIN_SEC_FOR_ANSWERS = 20 * 60  # правильные ответы варианта — если над ним сидели хотя бы 20 минут
# Перевод первичных баллов (0–29) в тестовые, ЕГЭ-2026 (как EGE.scale в app.js)
EGE_SCALE = [0, 7, 14, 20, 27, 34, 40, 43, 46, 48, 51, 54, 56, 59, 62, 64, 67, 70, 72, 75,
             78, 80, 83, 85, 88, 90, 93, 95, 98, 100]
LOCKED_BANK = b'window.EGE_BANK = {"srv":true,"locked":true,"banks":[],"tasks":[]};\n'

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/vnd.oasis.opendocument.spreadsheet", ".ods")
mimetypes.add_type("application/vnd.oasis.opendocument.text", ".odt")


# ================================================================ ответы (как в app.js)
def tokens(s):
    s = str(s or "").lower().replace("ё", "е")
    s = re.sub("[−–—]", "-", s)
    return [x for x in re.split(r"[\s;|,]+", s) if x]


def shape_of(ans):
    rows = [tokens(r) for r in str(ans).split("\n")]
    rows = [r for r in rows if r]
    total = sum(len(r) for r in rows)
    if total <= 1:
        return {"type": "single"}
    cols = max(len(r) for r in rows)
    nr = len(rows)
    if nr >= 3:
        nr = max(nr, 10)
    return {"type": "grid", "rows": nr, "cols": cols}


def think_sec(n):
    return THINK_SEC_HARD if (n or 0) >= 24 else THINK_SEC_DEFAULT


def ege_points(n):
    return 2 if (n or 0) >= 26 else 1


def answer_credit(n, expected, answer, cells=None):
    """1 — верно, 0 — неверно. У №26 и 27 ответ из двух половин (два числа или две пары):
    верна ровно одна половина — 0.5, на экзамене это 1 балл из 2."""
    a = tokens(expected)
    b = tokens(answer)
    if a and a == b:
        return 1.0
    if (n or 0) < 26 or len(a) < 2 or len(a) % 2:
        return 0.0
    if cells is not None and len(cells) == len(a):       # пустые ячейки сохраняют позиции чисел
        b = [(tokens(c) or [""])[0] for c in cells]
    if len(b) != len(a):
        return 0.0
    h = len(a) // 2
    return ((a[:h] == b[:h]) + (a[h:] == b[h:])) / 2


def norm_name(name):
    name = re.sub(r"\s+", " ", str(name or "")).strip()
    key = name.lower().replace("ё", "е")
    pretty = " ".join(w[:1].upper() + w[1:] for w in name.split(" "))
    pretty = "-".join(p[:1].upper() + p[1:] for p in pretty.split("-"))
    return pretty, key


NAME_RE = re.compile(r"^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’.\- ]{3,79}$")


def csv_cell(v):
    """Ячейка CSV для Excel: текст, начинающийся с = + - @, иначе выполнится как формула."""
    v = "" if v is None else str(v)
    if v[:1] in ("=", "+", "-", "@", "\t", "\r") and not re.fullmatch(r"-?\d+([.,]\d+)?", v):
        return "'" + v
    return v


class Throttle:
    """Счётчик неудачных попыток входа по адресу. После лимита — пауза до конца окна."""

    def __init__(self):
        self.lock = threading.Lock()
        self.fails = {}

    def _recent(self, key, now):
        arr = [t for t in self.fails.get(key, []) if now - t < FAIL_WINDOW]
        if arr:
            self.fails[key] = arr
        else:
            self.fails.pop(key, None)
        return arr

    def blocked(self, kind, ip):
        """Сколько секунд ещё ждать (0 — можно)."""
        now = time.time()
        with self.lock:
            arr = self._recent((kind, ip), now)
            if len(arr) < FAIL_LIMIT[kind]:
                return 0
            return int(FAIL_WINDOW - (now - arr[0])) + 1

    def fail(self, kind, ip):
        with self.lock:
            self.fails.setdefault((kind, ip), []).append(time.time())
            if len(self.fails) > 10000:          # не даём словарю расти бесконечно
                now = time.time()
                for k in list(self.fails):
                    self._recent(k, now)

    def ok(self, kind, ip):
        with self.lock:
            self.fails.pop((kind, ip), None)


THROTTLE = Throttle()


class Opened:
    """Задания, которые ученик сейчас решает: когда открыл и что уже отвечал.
    Число попыток и время на раздумье считает сервер — страница их подделать не может."""

    def __init__(self):
        self.lock = threading.Lock()
        self.m = {}

    def get(self, sid, tid, create=True):
        now = time.time()
        with self.lock:
            st = self.m.get((sid, tid))
            if st and now - st["ts"] > OPEN_TTL:
                st = None
            if st is None and create:
                st = self.m[(sid, tid)] = {"ts": now, "tries": [], "final": None}
                if len(self.m) > 50000:
                    for k in [k for k, v in self.m.items() if now - v["ts"] > OPEN_TTL]:
                        del self.m[k]
            return st

    def reset(self, sid, tid):
        with self.lock:
            self.m[(sid, tid)] = {"ts": time.time(), "tries": [], "final": None}


OPENED = Opened()


# ================================================================ где лежат банки с картинками
_bank_cache = {}


def report_roots():
    """build.py пишет в data/report.txt полные пути к заданиям — по ним видно, где лежат банки,
    даже если папку тренажёра потом перенесли или скачали заново."""
    roots = []
    try:
        txt = (HERE / "data" / "report.txt").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return roots
    for m in re.finditer(r"([A-Za-z]:\\[^\r\n]*?|/[^\r\n]*?)[\\/][A-Za-z0-9_\-]+_bank[\\/]", txt):
        p = Path(m.group(1).strip())
        if p not in roots:
            roots.append(p)
        if len(roots) >= 5:
            break
    return roots


def bank_roots():
    """Где искать папки *_bank: заданная вручную, рядом с тренажёром, выше по дереву (и в Biblio там),
    внутри самого тренажёра, по путям из отчёта сборки."""
    roots = []
    if BANKS_ROOT:
        roots.append(Path(BANKS_ROOT))
    roots.append(BIBLIO)
    a = HERE
    for _ in range(4):
        roots += [a.parent, a.parent / "Biblio"]
        a = a.parent
    roots.append(HERE)
    roots += report_roots()
    out = []
    for r in roots:
        if r not in out:
            out.append(r)
    return out


def find_bank(name):
    """Папка банка по имени (например kompege_bank) или None. Найденное запоминаем."""
    if not re.fullmatch(r"[A-Za-z0-9_\-]+_bank", name or ""):
        return None
    hit = _bank_cache.get(name)
    if hit and hit.is_dir():
        return hit
    for r in bank_roots():
        try:
            p = r / name
            if p.is_dir():
                _bank_cache[name] = p.resolve()
                return _bank_cache[name]
        except OSError:
            continue
    return None


# ================================================================ банк заданий
# Ссылки на задание на сайте источника внутри условия: там виден ответ — ученику показываем только текст ссылки
SOURCE_LINK_RE = re.compile(r'<a\b[^>]*href="https?://(?:[^"/]*\.)?(?:kompege\.ru|devinf\.ru)/[^"]*task[^"]*"[^>]*>(.*?)</a>',
                            re.I | re.S)


# Картинки и файлы из банков: в путях есть код задания ФИПИ (assets/0079D4-…/, files/ege/3/02143E.zip),
# по нему на openfipi находится ответ. Ученику они отдаются по безликим ссылкам files/<код>/<имя>.
LOCAL_REF_RE = re.compile(r'(\b(?:src|href)=")((?:\.\./|media/)[^"]+)(")', re.I)
LOCAL_ZIP_LINK_RE = re.compile(r'<a\b[^>]*href="((?:\.\./|media/)[^"]+\.zip)"[^>]*>(.*?)</a>', re.I | re.S)
REMOTE_ATTR_RE = re.compile(r'\sdata-remote="[^"]*devinf\.ru[^"]*"', re.I)
FIPI_CODE_RE = re.compile(r"(?<![0-9A-Za-z])(?=[0-9A-Fa-f]*\d)[0-9A-Fa-f]{6}(?![0-9A-Za-z])")
MAX_ZIP_MEMBER = 60 * 1024 * 1024


# Задания без автора: с экзаменов и из ФИПИ (демоверсии, апробации, волны, ЕГКР) или без указанного источника.
# Остальные — авторские (Джобс, /dev/inf, Danov, Статград…); учитель решает, давать ли их в подборках и вариантах.
OFFICIAL_SRC_RE = re.compile(
    r"фипи|openfipi|демоверси|апробаци|основн\w*\s+волн|досрочн|резерв|пере[сc]дач|егкр|открытый\s+вариант", re.I)
NO_AUTHOR_SRC = {"", "компегэ", "яндекс учебник"}


TEXT_AUTHOR_RE = re.compile(r"^[(\[]([^()\[\]]{2,60})[)\]]")


def is_authored(src, html_text=None):
    """Авторское задание: автор в источнике («КомпЕГЭ · Джобс 14.05.2022») или в начале условия
    («(Д. Бахтиев) В файле приведён…» — так подписаны задания КомпЕГЭ без источника)."""
    s = re.sub(r"^\s*КомпЕГЭ\s*·\s*", "", str(src or "")).strip()
    if s.lower() not in NO_AUTHOR_SRC and not OFFICIAL_SRC_RE.search(s):
        return True
    if html_text:
        import html as _h
        head = re.sub(r"\s+", " ", _h.unescape(re.sub(r"<[^>]+>", " ", html_text[:600]))).strip()
        m = TEXT_AUTHOR_RE.match(head)
        if m and re.search(r"[A-Za-zА-Яа-яЁё]{2}", m.group(1)) and not OFFICIAL_SRC_RE.search(m.group(1)):
            return True
    return False


def clean_file_name(name, n):
    """Имя файла для ученика: без номера задания КомпЕГЭ (длинные числа) и кода ФИПИ (6 шестнадцатеричных знаков)."""
    stem, ext = os.path.splitext(posixpath.basename(str(name or "").replace("\\", "/")))
    stem = FIPI_CODE_RE.sub("", stem)                  # сначала код ФИПИ (02143E), потом длинные числа
    stem = re.sub(r"[_\-\s]*\d{4,}", "", stem).strip(" _-.") or str(n or "файл")
    return stem + ext


def zip_display_name(info):
    """Имена в архивах без флага UTF-8 обычно в cp866 (архивы из Windows)."""
    if info.flag_bits & 0x800:
        return info.filename
    try:
        return info.filename.encode("cp437").decode("cp866")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return info.filename


class Bank:
    def __init__(self, path: Path, secret=None):
        self.path = path
        # Ученик видит не настоящие id (по ним задание находится на kompege.ru вместе с ответом),
        # а постоянные коды, которые знает только сервер
        self.secret = (secret or secrets.token_hex(16)).encode()
        self.pub_of = {}
        self.real_of = {}
        self.files = {}            # безликая ссылка -> (ссылка из банка, файл внутри zip или None)
        self.zipped = set()
        self.broken = []
        self.authored = 0          # сколько заданий с автором
        self.mtime = None
        self.lock = threading.Lock()
        self.tasks = {}
        self.public_gz = b""
        self.public_raw = b""
        self.etag = ""
        self._snips = {}
        self.missing_dirs = []     # папки банков, на которые ссылаются картинки, но которых нет рядом

    def pid(self, real):
        """Открытый код задания для страницы ученика."""
        p = self.pub_of.get(real)
        if p is None:
            p = "t" + hmac.new(self.secret, str(real).encode("utf-8"), hashlib.sha256).hexdigest()[:14]
            self.pub_of[real] = p
            self.real_of[p] = real
        return p

    def real(self, pub):
        """Настоящий id по открытому коду (настоящий id тоже принимается)."""
        pub = str(pub or "")
        if pub in self.real_of:
            return self.real_of[pub]
        return pub if pub in self.tasks else None

    # ---------- картинки и файлы заданий для ученика
    def ref_path(self, href):
        """Файл на диске для ссылки из банка (../ege_bank/…, media/…) или None."""
        rel = posixpath.normpath("/" + unquote(str(href).split("#")[0].split("?")[0])).lstrip("/")
        parts = rel.split("/")
        if parts[0] == "media":
            root, rest = HERE / "media", parts[1:]
        else:
            k = next((i for i, x in enumerate(parts[:-1]) if x.endswith("_bank")), None)
            root = find_bank(parts[k]) if k is not None else None
            if not root:
                return None
            rest = parts[k + 1:]
        if not rest or any(x in ("", ".", "..") for x in rest):
            return None
        root = root.resolve()
        p = (root / "/".join(rest)).resolve()
        try:
            p.relative_to(root)
        except ValueError:
            return None
        return p

    def file_url(self, key, name, target):
        tok = hmac.new(self.secret, ("f:" + key).encode("utf-8"), hashlib.sha256).hexdigest()[:20]
        self.files[tok] = target
        return f"files/{tok}/{quote(name)}"

    def zip_members(self, href):
        p = self.ref_path(href)
        if not p or not p.is_file():
            return []
        if not zipfile.is_zipfile(p):
            self.broken.append(str(p))         # вместо архива сохранилась, например, страница сайта
            return []
        try:
            with zipfile.ZipFile(p) as z:
                return [i for i in z.infolist()
                        if not i.is_dir() and not i.filename.startswith("__MACOSX/")
                        and not posixpath.basename(i.filename).startswith(".") and i.file_size <= MAX_ZIP_MEMBER][:30]
        except (zipfile.BadZipFile, OSError, ValueError):
            return []

    def public_att(self, att, n):
        """Файлы к заданию: безликие ссылки, имена без номеров, архивы ФИПИ — сразу файлами из архива."""
        out, used = [], set()

        def uniq(name):
            base, ext = os.path.splitext(name)
            k = 2
            while name.lower() in used:
                name = f"{base}_{k}{ext}"
                k += 1
            used.add(name.lower())
            return name

        for a in att or []:
            href = str(a.get("href") or "")
            if not href or re.match(r"^[a-z][a-z0-9+.-]*:", href, re.I):      # файл на другом сайте
                out.append(dict(a, name=uniq(clean_file_name(a.get("name") or href, n))))
                continue
            if href.lower().split("?")[0].endswith(".zip"):
                members = self.zip_members(href)
                if members:
                    self.zipped.add(href)
                    for m in members:
                        nm = uniq(clean_file_name(zip_display_name(m), n))
                        out.append({"name": nm, "href": self.file_url(href + "#" + m.filename, nm, (href, m.filename))})
                    continue
            nm = uniq(clean_file_name(a.get("name") or href, n))
            out.append({"name": nm, "href": self.file_url(href, nm, (href, None))})
        return out

    def public_html(self, h):
        h = SOURCE_LINK_RE.sub(r"\1", h or "")
        h = REMOTE_ATTR_RE.sub("", h)
        # ссылки на распакованные архивы в тексте не нужны — файлы и так лежат под заданием
        h = LOCAL_ZIP_LINK_RE.sub(lambda m: m.group(2) if m.group(1) in self.zipped else m.group(0), h)

        def sub(m):
            href = m.group(2)
            ext = posixpath.splitext(href.split("?")[0].split("#")[0])[1]
            return m.group(1) + self.file_url(href, "file" + ext, (href, None)) + m.group(3)
        return LOCAL_REF_RE.sub(sub, h)

    def find(self, q):
        """Задание по номеру КомпЕГЭ (или ссылке на него), коду ФИПИ, id. Возвращает настоящий id задания-страницы."""
        q = re.sub(r"^.*[?&]id=", "", str(q or "").strip().lstrip("№").strip()).lower()
        if not q:
            return None
        tail = lambda i: i.split(":", 1)[-1].lower()
        hits = [i for i in self.tasks if i.lower() == q or tail(i) == q]
        if not hits and len(q) >= 4:
            hits = [i for i in self.tasks if q in tail(i)]
        if not hits:
            return None
        hits.sort(key=lambda i: (not i.startswith("kompege_bank:"), i))
        t = self.tasks[hits[0]]
        return t.get("group") or t["id"]

    def snippet(self, task_id):
        """Начало условия без разметки — чтобы в журнале было видно, что за задание."""
        if task_id in self._snips:
            return self._snips[task_id]
        t = self.tasks.get(task_id)
        if not t:
            return ""
        h = t.get("html", "")
        if h.lstrip().startswith('<div class="linked-task">') and '<hr class="subtask-sep">' in h:
            h = h.split('<hr class="subtask-sep">', 1)[1]
        txt = re.sub(r"<[^>]+>", " ", h)
        import html as _h
        txt = re.sub(r"\s+", " ", _h.unescape(txt)).strip()
        snip = txt[:140]
        self._snips[task_id] = snip
        return snip

    def check_media(self, text):
        """Картинки и файлы заданий лежат в папках банков рядом с trainer (или в trainer/media после
        build.py --standalone). Если их нет, в заданиях будет «Рисунок не найден» — предупреждаем сразу."""
        names = set(re.findall(r'(?:\.\./)+(?:[^"\\\s<>]*?/)?([A-Za-z0-9_\-]+_bank)/', text))
        found = {d: find_bank(d) for d in sorted(names)}
        for d, path in found.items():
            if path:
                print(f"[банк] файлы {d}: {path}", flush=True)
        missing = [d for d, path in found.items() if not path]
        if '"media/' in text or "'media/" in text or 'src=\\"media/' in text:
            if not (HERE / "media").is_dir():
                missing.append("trainer/media")
        self.missing_dirs = missing
        if missing:
            print("! Не найдены папки с картинками и файлами заданий: " + ", ".join(missing), flush=True)
            print(f"  Искал рядом с тренажёром ({BIBLIO}), выше по папкам и по путям из data/report.txt.", flush=True)
            print('  Укажите папку, где лежат банки:  python server.py --banks "C:\\путь\\к\\Biblio"', flush=True)
            print("  Или соберите банк так, чтобы всё лежало внутри тренажёра:  python build.py --standalone", flush=True)

    def ensure(self):
        try:
            mt = self.path.stat().st_mtime
        except FileNotFoundError:
            return False
        if mt == self.mtime:
            return True
        with self.lock:
            if mt == self.mtime:
                return True
            text = self.path.read_text(encoding="utf-8")
            start = text.index("{")
            end = text.rindex("}")
            data = json.loads(text[start:end + 1])
            self.tasks = {}
            self._snips = {}
            self.files = {}
            self.zipped = set()
            self.broken = []
            self.authored = 0
            pub_tasks = []
            for t in data.get("tasks", []):
                self.tasks[t["id"]] = t
                # без ответа, решения и всего, что ведёт к ответу: ссылки на источник, видеоразбора, настоящего id
                p = {k: v for k, v in t.items() if k not in ("ans", "sol", "parts", "link", "video")}
                p["id"] = self.pid(t["id"])
                if t.get("att"):
                    p["att"] = self.public_att(t["att"], t.get("n"))
                p["html"] = self.public_html(t.get("html"))
                if is_authored(t.get("src"), t.get("html")):
                    p["au"] = 1
                    self.authored += 1
                if t.get("parts"):
                    # задание 19–21: каждую часть проверяем отдельно, в журнал она идёт под своим номером
                    p["parts"] = []
                    for part in t["parts"]:
                        full = {k: v for k, v in t.items() if k != "parts"}
                        full.update(part)
                        full["group"] = t["id"]
                        self.tasks[part["id"]] = full
                        p["parts"].append({"id": self.pid(part["id"]), "n": part["n"], "sh": shape_of(part.get("ans", ""))})
                else:
                    p["sh"] = shape_of(t.get("ans", ""))
                    if t.get("sol"):
                        p["hasSol"] = True
                pub_tasks.append(p)
            pub = dict(data, tasks=pub_tasks, srv=True)
            raw = ("window.EGE_BANK = " + json.dumps(pub, ensure_ascii=False, separators=(",", ":")) + ";\n").encode("utf-8")
            self.public_raw = raw
            self.public_gz = gzip.compress(raw, 6)
            self.etag = '"%x-%x"' % (int(mt), len(raw))
            self.mtime = mt
            print(f"[банк] загружено заданий: {len(pub_tasks)}", flush=True)
            if self.broken:
                print(f"! Повреждённых архивов к заданиям: {len(self.broken)} (не открываются). Например: {self.broken[0]}", flush=True)
                print("  Скачайте их заново: удалите эти файлы и запустите python openfipi_parser.py", flush=True)
            self.check_media(text)
        return True


# ================================================================ база
class DB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            c = self.conn
            c.execute("PRAGMA journal_mode=WAL")
            c.executescript("""
            CREATE TABLE IF NOT EXISTS students(
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL,
                token TEXT UNIQUE NOT NULL, created REAL, last_seen REAL,
                progress TEXT, progress_ts REAL, forecast INTEGER);
            CREATE TABLE IF NOT EXISTS attempts(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, ts REAL NOT NULL,
                task_id TEXT, n INTEGER, bank TEXT, answers TEXT, correct TEXT,
                score REAL, gave_up INTEGER DEFAULT 0, abandoned INTEGER DEFAULT 0,
                spent_ms INTEGER, reason TEXT);
            CREATE INDEX IF NOT EXISTS att_student ON attempts(student_id, ts);
            CREATE INDEX IF NOT EXISTS att_ts ON attempts(ts);
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY, expires REAL);
            CREATE TABLE IF NOT EXISTS reveal_log(
                id INTEGER PRIMARY KEY, student_id INTEGER, ip TEXT, ts REAL, task_id TEXT,
                granted INTEGER, why TEXT);
            CREATE INDEX IF NOT EXISTS rev_student ON reveal_log(student_id, ts);
            CREATE INDEX IF NOT EXISTS rev_ip ON reveal_log(ip, ts);
            CREATE TABLE IF NOT EXISTS exams(
                id TEXT PRIMARY KEY, student_id INTEGER, ip TEXT, started REAL, finished REAL,
                items INTEGER, primary_score INTEGER, test_score INTEGER, result TEXT);
            CREATE INDEX IF NOT EXISTS exams_student ON exams(student_id, started);
            CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY, name TEXT NOT NULL, created REAL);
            CREATE TABLE IF NOT EXISTS assignments(
                id INTEGER PRIMARY KEY, class_id INTEGER NOT NULL, title TEXT NOT NULL, tasks TEXT NOT NULL,
                created REAL, due REAL);
            CREATE INDEX IF NOT EXISTS asg_class ON assignments(class_id, created);
            CREATE TABLE IF NOT EXISTS activity(
                id INTEGER PRIMARY KEY, student_id INTEGER, ts REAL, kind TEXT, task_id TEXT, dur REAL,
                exam INTEGER DEFAULT 0, ip TEXT);
            CREATE INDEX IF NOT EXISTS act_student ON activity(student_id, ts);
            CREATE TABLE IF NOT EXISTS solutions(
                student_id INTEGER NOT NULL, task_id TEXT NOT NULL, code TEXT, ts REAL,
                PRIMARY KEY(student_id, task_id));
            CREATE TABLE IF NOT EXISTS teacher_solutions(task_id TEXT PRIMARY KEY, text TEXT, ts REAL);
            CREATE TABLE IF NOT EXISTS teachers(
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, login TEXT UNIQUE NOT NULL, pw TEXT,
                invite TEXT UNIQUE NOT NULL, is_main INTEGER DEFAULT 0, authored INTEGER DEFAULT 1, created REAL);
            CREATE TABLE IF NOT EXISTS tsolutions(
                teacher_id INTEGER NOT NULL, task_id TEXT NOT NULL, text TEXT, ts REAL, PRIMARY KEY(teacher_id, task_id));
            """)
            # новые поля в старых базах
            for table, col, decl in (
                    ("attempts", "rk", "TEXT"),            # ключ повторения, ради которого показано задание
                    ("attempts", "part", "REAL"),          # доля баллов с 1-й попытки (№26, 27: 0.5 — одна половина)
                    ("attempts", "grp", "TEXT"),           # задание 19–21, к которому относится вопрос
                    ("attempts", "revealed", "INTEGER DEFAULT 0"),
                    ("attempts", "exam", "TEXT"),
                    ("attempts", "ip", "TEXT"),
                    ("students", "prefs", "TEXT"),         # избранное, заметки, цель на день
                    ("students", "fc", "TEXT"),            # прогноз по дням
                    ("students", "last_ip", "TEXT"),
                    ("students", "pw", "TEXT"),            # пароль ученика (хеш); NULL — ещё не задан
                    ("students", "class_id", "INTEGER"),   # класс; NULL — ещё не распределён
                    ("attempts", "away", "INTEGER"),       # сколько раз уходил со вкладки, пока решал
                    ("students", "teacher_id", "INTEGER"), # учитель, по чьему коду зарегистрировался; NULL — главный
                    ("classes", "teacher_id", "INTEGER"),
                    ("admin_sessions", "teacher_id", "INTEGER")):
                if col not in {r[1] for r in c.execute(f"PRAGMA table_info({table})")}:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
            # главный учитель: прежние пароль, код приглашения и настройка авторских заданий переходят к нему
            if not c.execute("SELECT 1 FROM teachers WHERE is_main=1").fetchone():
                get = lambda k: (c.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone() or [None])[0]
                c.execute("""INSERT INTO teachers(name, login, pw, invite, is_main, authored, created)
                             VALUES('Главный учитель', 'admin', ?, ?, 1, ?, ?)""",
                          (get("admin_password"), get("invite_code") or DEFAULT_INVITE, 0 if get("authored") == "0" else 1, time.time()))
                main_id = c.execute("SELECT id FROM teachers WHERE is_main=1").fetchone()[0]
                c.execute("INSERT OR IGNORE INTO tsolutions(teacher_id, task_id, text, ts) SELECT ?, task_id, text, ts FROM teacher_solutions",
                          (main_id,))
            c.commit()

    def q(self, sql, args=(), one=False):
        with self.lock:
            cur = self.conn.execute(sql, args)
            rows = cur.fetchall()
        return (rows[0] if rows else None) if one else rows

    def x(self, sql, args=()):
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur.lastrowid

    def setting(self, key, value=None):
        if value is None:
            r = self.q("SELECT value FROM settings WHERE key=?", (key,), one=True)
            return r["value"] if r else None
        self.x("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def main_teacher():
    return APP.db.q("SELECT * FROM teachers WHERE is_main=1", one=True)


def teacher_of(s):
    """Учитель ученика (у старых учеников, зарегистрированных до появления учителей, — главный)."""
    t = APP.db.q("SELECT * FROM teachers WHERE id=?", (s["teacher_id"],), one=True) if s["teacher_id"] else None
    return t or main_teacher()


def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt.encode(), 200_000).hex()
    return f"{salt}${h}"


def check_pw(pw, stored):
    if not stored or "$" not in stored:
        return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(hash_pw(pw, salt), stored)


# ================================================================ HTTP
class App:
    def __init__(self):
        self.db = DB(DB_PATH)
        secret = self.db.setting("id_secret")
        if not secret:
            secret = secrets.token_hex(16)
            self.db.setting("id_secret", secret)
        self.bank = Bank(BANK_JS, secret)
        self.bank.ensure()


APP = None


class Handler(BaseHTTPRequestHandler):
    server_version = "EGETrainer/1.0"
    protocol_version = "HTTP/1.1"
    timeout = 60                      # медленный клиент не держит поток вечно

    def log_message(self, fmt, *args):
        pass

    # ---------- ответы
    def send_bytes(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, code=200, extra=None):
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        extra = dict({"Cache-Control": "no-store"}, **(extra or {}))
        if len(body) > 16384 and "gzip" in (self.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 6)
            extra["Content-Encoding"] = "gzip"
            extra["Vary"] = "Accept-Encoding"
        self.send_bytes(code, body, "application/json; charset=utf-8", extra)

    def err(self, code, msg):
        self.send_json({"error": msg}, code)

    def body_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ValueError("неверная длина запроса")
        if n < 0 or n > MAX_BODY:
            raise ValueError("слишком большой запрос")
        raw = self.rfile.read(n) if n else b""
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    # ---------- маршруты
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            u = urlparse(self.path)
            path = unquote(u.path)
            qs = {k: v[0] for k, v in parse_qs(u.query).items()}
            if path.startswith("/api/"):
                return self.api("GET", path, qs, {})
            return self.static(path)
        except Exception as e:
            self.log_error_safe(e)
            self.err(500, "ошибка сервера")

    def do_POST(self):
        try:
            u = urlparse(self.path)
            path = unquote(u.path)
            qs = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                data = self.body_json()
            except (ValueError, json.JSONDecodeError):
                return self.err(400, "неверный запрос")
            if not path.startswith("/api/"):
                return self.err(404, "нет такой страницы")
            return self.api("POST", path, qs, data if isinstance(data, dict) else {})
        except Exception as e:
            self.log_error_safe(e)
            self.err(500, "ошибка сервера")

    def log_error_safe(self, e):
        import traceback
        print(f"[ошибка] {self.command} {self.path}: {e!r}", flush=True)
        traceback.print_exc()

    def client_ip(self):
        """Адрес ученика. За Caddy/nginx (запрос пришёл с этого же компьютера) — из X-Forwarded-For."""
        ip = self.client_address[0]
        if ip in ("127.0.0.1", "::1"):
            fwd = (self.headers.get("X-Forwarded-For") or "").split(",")[-1].strip()
            if fwd:
                return fwd
        return ip

    def is_https(self):
        return (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"

    def cookie_attrs(self):
        return "; Secure" if self.is_https() else ""

    # ---------- статика
    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        if path in ("/admin", "/admin/"):
            path = "/admin.html"
        rel = path.lstrip("/")
        # «..», обратные слэши и пустые части пути не нужны ни одному честному запросу
        segs = rel.split("/")
        if "\\" in rel or "\0" in rel or any(x in ("..", ".") for x in segs) or (rel and "" in segs[:-1]):
            return self.err(404, "нет такого файла")
        if rel == "data/bank.js":
            return self.serve_bank()
        if rel.startswith("files/"):
            return self.serve_task_file(rel)
        # файлы сайта
        if rel in SITE_FILES:
            return self.serve_file(HERE, rel, html=rel.endswith(".html"))
        for d in SITE_DIRS:
            if rel.startswith(d):
                return self.serve_file(HERE / d.rstrip("/"), rel[len(d):])
        # картинки и файлы заданий из банков (../ege_bank/… превращается в /ege_bank/…;
        # если банк собирали из другой папки, перед именем банка бывают ещё папки: /Documents/Biblio/ege_bank/…)
        parts = rel.split("/")
        k = next((i for i, x in enumerate(parts[:-1]) if x.endswith("_bank")), None)
        if k:
            parts = parts[k:]
        if len(parts) >= 2 and parts[0].endswith("_bank"):
            ext = os.path.splitext(parts[-1])[1].lower()
            in_assets = len(parts) >= 3 and parts[1] in ("assets", "files")
            if ext in (".json", ".html", ".htm", ".js", ".py") and not (ext == ".py" and in_assets):
                return self.err(404, "нет такого файла")
            if parts[1] == "raw":
                return self.err(404, "нет такого файла")
            if in_assets or ext in BANK_EXT:
                bdir = find_bank(parts[0])
                if not bdir:
                    return self.not_found(f"папка {parts[0]} не найдена (см. python server.py --banks)")
                return self.serve_file(bdir, "/".join(parts[1:]))
        return self.not_found()

    def not_found(self, disk_path=None):
        """Файла нет. В окне сервера — полный путь на диске (чтобы было видно, где искали),
        в браузере — понятная страница, а не голый JSON."""
        if disk_path is not None:
            print(f"[нет файла] {unquote(urlparse(self.path).path)} → {disk_path}", flush=True)
        if "text/html" not in (self.headers.get("Accept") or ""):
            return self.err(404, "нет такого файла")
        import html as _h
        shown = _h.escape(unquote(urlparse(self.path).path))
        where = f"<p>Сервер искал его здесь: <code>{_h.escape(str(disk_path))}</code></p>" if disk_path is not None else ""
        body = f"""<!doctype html><meta charset="utf-8"><title>Файл не найден</title>
<style>body{{font:16px/1.55 system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 16px;color:#1b1d22;background:#f6f7f9}}
code{{background:#e9ebf0;padding:1px 6px;border-radius:5px;word-break:break-all}}a{{color:#4b67e0}}
@media(prefers-color-scheme:dark){{body{{color:#ececef;background:#111113}}code{{background:#24242a}}a{{color:#7f98f7}}}}</style>
<h1>Файл не найден</h1><p>Запрошен <code>{shown}</code>.</p>{where}
<p>Если это картинка или файл к заданию: проверьте, что этот файл есть в папке банка. Если банк пересобирали
или переносили, пересоберите его (<code>python build.py</code>) и перезапустите сервер. Папку с банками можно указать:
<code>python server.py --banks "C:\\путь\\к\\Biblio"</code>.</p><p><a href="/">← В тренажёр</a></p>"""
        return self.send_bytes(404, body.encode("utf-8"), "text/html; charset=utf-8", {"Cache-Control": "no-store"})

    def serve_task_file(self, rel):
        """Картинка или файл задания по безликой ссылке files/<код>/<имя>; файл из архива ФИПИ — прямо из zip."""
        parts = rel.split("/")
        APP.bank.ensure()
        target = APP.bank.files.get(parts[1]) if len(parts) >= 3 else None
        if not target:
            return self.not_found()
        href, member = target
        p = APP.bank.ref_path(href)
        if not p or not p.is_file():
            return self.not_found(p or href)
        name = unquote(parts[-1])
        if member is None:
            return self.serve_file(p.parent, p.name, download_name=name)
        try:
            with zipfile.ZipFile(p) as z:
                info = z.getinfo(member)
                if info.file_size > MAX_ZIP_MEMBER:
                    return self.not_found(p)
                body = z.read(info)
        except (KeyError, zipfile.BadZipFile, OSError):
            return self.not_found(p)
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if ctype.startswith("text/"):
            ctype += "; charset=utf-8"
        return self.send_bytes(200, body, ctype, {
            "Cache-Control": "no-cache", "Content-Disposition": "attachment; filename*=UTF-8''" + quote_rfc(name)})

    def serve_file(self, root: Path, rel, html=False, download_name=None):
        root = root.resolve()
        p = (root / rel).resolve()
        try:
            p.relative_to(root)
        except ValueError:
            return self.err(404, "нет такого файла")
        if not p.is_file():
            return self.not_found(p)
        st = p.stat()
        etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
        if self.headers.get("If-None-Match") == etag:
            return self.send_bytes(304, b"", "text/plain", {"ETag": etag})
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        extra = {"ETag": etag, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}
        if html:
            extra["X-Frame-Options"] = "DENY"
            extra["Referrer-Policy"] = "same-origin"
        if p.suffix.lower() not in (".html", ".js", ".mjs", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".woff2", ".wasm"):
            name = download_name or p.name           # настоящее имя может содержать код задания
            extra["Content-Disposition"] = "attachment; filename*=UTF-8''" + quote_rfc(name)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(st.st_size))
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command == "HEAD":
            return
        with open(p, "rb") as f:
            while True:
                chunk = f.read(1 << 16)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def serve_bank(self):
        tok = self.cookie("egest")
        if not tok or not APP.db.q("SELECT 1 FROM students WHERE token=?", (tok,), one=True):
            # без входа (код приглашения + ФИО) задания не отдаём
            return self.send_bytes(200, LOCKED_BANK, "application/javascript; charset=utf-8", {"Cache-Control": "no-store"})
        if not APP.bank.ensure():
            return self.send_bytes(200, b"window.EGE_BANK = null;\n", "application/javascript; charset=utf-8",
                                   {"Cache-Control": "no-cache"})
        b = APP.bank
        if self.headers.get("If-None-Match") == b.etag:
            return self.send_bytes(304, b"", "text/plain", {"ETag": b.etag})
        extra = {"ETag": b.etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            extra["Content-Encoding"] = "gzip"
            return self.send_bytes(200, b.public_gz, "application/javascript; charset=utf-8", extra)
        return self.send_bytes(200, b.public_raw, "application/javascript; charset=utf-8", extra)

    # ---------- API
    def cookie(self, name):
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        return c[name].value if name in c else None

    def student_cookie(self, token):
        return f"egest={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={STUDENT_COOKIE_DAYS * 86400}{self.cookie_attrs()}"

    def wait_msg(self, sec):
        m = max(1, round(sec / 60))
        return f"Слишком много неверных попыток. Подождите {m} мин."

    def student(self, data=None):
        tok = self.headers.get("X-Token") or (data or {}).get("token") or self.cookie("egest")
        if not tok:
            return None
        s = APP.db.q("SELECT * FROM students WHERE token=?", (tok,), one=True)
        if s:
            APP.db.x("UPDATE students SET last_seen=?, last_ip=? WHERE id=?", (time.time(), self.client_ip(), s["id"]))
        return s

    # ---------- журнал и показ ответов
    def log_attempt(self, s, t, answers, score, *, gave_up=False, abandoned=False, reason="", rk=None,
                    part=None, revealed=0, spent=None, exam=None, away=None):
        return APP.db.x("""INSERT INTO attempts(student_id,ts,task_id,n,bank,answers,correct,score,gave_up,abandoned,
                                               spent_ms,reason,rk,part,grp,revealed,exam,ip,away)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (s["id"], time.time(), t["id"], t.get("n"), t.get("bank"), json.dumps(answers, ensure_ascii=False),
                         t.get("ans", ""), score, int(gave_up), int(abandoned), spent, reason, rk, part,
                         t.get("group"), int(revealed), exam, self.client_ip(), away or None))

    def reveal_block(self, s, t, st):
        """None — ответ можно показать; иначе {"why": "think"|"limit", "wait": секунд}."""
        now = time.time()
        wait = math.ceil(st["ts"] + think_sec(t.get("n")) - now)
        if wait > 0:
            return {"why": "think", "wait": wait}
        for col, val, lim in (("student_id", s["id"], REVEAL_PER_HOUR), ("ip", self.client_ip(), REVEAL_PER_HOUR_IP)):
            rows = APP.db.q(f"SELECT ts FROM reveal_log WHERE {col}=? AND granted=1 AND ts>? ORDER BY ts",
                            (val, now - 3600))
            if len(rows) >= lim:
                return {"why": "limit", "wait": max(1, math.ceil(rows[len(rows) - lim]["ts"] + 3600 - now)), "per_hour": lim}
        return None

    def log_reveal(self, s, t, block):
        APP.db.x("INSERT INTO reveal_log(student_id,ip,ts,task_id,granted,why) VALUES(?,?,?,?,?,?)",
                 (s["id"], self.client_ip(), time.time(), t["id"], 0 if block else 1, (block or {}).get("why", "")))

    def with_answer_s(self, s, res, t):
        return self.with_answer(res, t, s)

    @staticmethod
    def with_answer(res, t, s=None):
        res = dict(res)
        res.pop("hidden", None)
        res["answer"] = t.get("ans", "")
        if t.get("sol"):
            res["sol"] = t["sol"]
        ts = teacher_solution(t, teacher_of(s)["id"] if s else None)
        if ts:
            res["tsol"] = ts
        for k in ("link", "video"):           # ведут к ответу — отдаём только вместе с ним
            if t.get(k):
                res[k] = t[k]
        return res

    @staticmethod
    def rules(s=None):
        authored = bool(teacher_of(s)["authored"]) if s else authored_on()
        return {"think": THINK_SEC_DEFAULT, "think_hard": THINK_SEC_HARD, "reveal_per_hour": REVEAL_PER_HOUR,
                "attempts": ATTEMPTS_PER_TASK, "exam_sec": EXAM_LIMIT_SEC, "exam_per_day": EXAM_PER_DAY,
                "exam_min_for_answers": EXAM_MIN_SEC_FOR_ANSWERS, "authored": authored,
                "py_local": (HERE / "vendor" / "pyodide" / "pyodide.js").is_file()}

    def me_payload(self, s):
        def load(v, default):
            try:
                return json.loads(v) if v else default
            except ValueError:
                return default
        prefs = load(s["prefs"], None)
        if isinstance(prefs, dict) and APP.bank.ensure():
            pid, tasks = APP.bank.pid, APP.bank.tasks
            conv = lambda i: pid(i) if i in tasks else i
            if isinstance(prefs.get("fav"), list):
                prefs["fav"] = [conv(i) for i in prefs["fav"] if isinstance(i, str)]
            if isinstance(prefs.get("notes"), dict):
                prefs["notes"] = {conv(k): v for k, v in prefs["notes"].items()}
        return {"sid": s["id"], "name": s["name"], "token": s["token"], "prefs": prefs,
                "fc": load(s["fc"], []), "rules": self.rules(s), "has_password": bool(s["pw"]),
                "game": game_summary(APP.db, s["id"]), "class_id": s["class_id"]}

    def is_admin(self):
        """Вошёл ли учитель; запоминает его в self.T (сессии без учителя — от прежних версий — главного)."""
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        if "egeadm" not in c:
            return False
        r = APP.db.q("SELECT expires, teacher_id FROM admin_sessions WHERE token=?", (c["egeadm"].value,), one=True)
        if not (r and r["expires"] > time.time()):
            return False
        t = APP.db.q("SELECT * FROM teachers WHERE id=?", (r["teacher_id"],), one=True) if r["teacher_id"] else main_teacher()
        if not t:
            return False
        self.T = t
        return True

    # что видит учитель: главный — всех, остальные — только своих учеников и классы
    def sees_student(self, sid):
        if self.T["is_main"]:
            return bool(APP.db.q("SELECT 1 FROM students WHERE id=?", (sid,), one=True))
        r = APP.db.q("SELECT teacher_id FROM students WHERE id=?", (sid,), one=True)
        return bool(r) and (r["teacher_id"] or main_teacher()["id"]) == self.T["id"]

    def sees_class(self, cid):
        r = APP.db.q("SELECT teacher_id FROM classes WHERE id=?", (cid,), one=True)
        return bool(r) and (self.T["is_main"] or (r["teacher_id"] or main_teacher()["id"]) == self.T["id"])

    def student_scope(self, alias="s"):
        """Условие SQL на учеников этого учителя и его параметры."""
        if self.T["is_main"]:
            return "1=1", ()
        return f"COALESCE({alias}.teacher_id, ?) = ?", (main_teacher()["id"], self.T["id"])

    def api(self, method, path, qs, data):
        db = APP.db
        # ----- ученик
        if path == "/api/ping":
            return self.send_json({"ok": True, "server": True})

        if path == "/api/login" and method == "POST":
            # Вход: ФИО + пароль. Регистрация (и старый ученик без пароля): код приглашения + ФИО + новый пароль.
            ip = self.client_ip()
            for kind in ("invite", "login"):
                wait = THROTTLE.blocked(kind, ip)
                if wait:
                    return self.err(429, self.wait_msg(wait))
            pretty, key = norm_name(data.get("name"))
            if not NAME_RE.match(pretty) or len(pretty.split()) < 2:
                return self.err(400, "Введите фамилию и имя (можно с отчеством)")
            wait = THROTTLE.blocked("account", key)
            if wait:
                return self.err(429, self.wait_msg(wait))
            s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
            register = data.get("mode") == "register"
            now = time.time()
            if s and s["pw"]:
                if register:
                    return self.err(409, f"«{s['name']}» уже зарегистрирован(а). Войдите с паролем на вкладке «Вход».")
                if not check_pw(str(data.get("password") or ""), s["pw"]):
                    THROTTLE.fail("login", ip)
                    THROTTLE.fail("account", key)
                    time.sleep(1.0)
                    return self.err(403, "Неверный пароль. Забыли его — попросите учителя сбросить пароль.")
                THROTTLE.ok("account", key)
            else:
                code = re.sub(r"\s+", "", str(data.get("code") or ""))
                if not register and not code:
                    if s:
                        return self.send_json({"error": "Пароль ещё не задан", "need": "set_password"}, 409)
                    return self.err(404, "Такого ученика нет. Если вы здесь впервые — откройте вкладку «Регистрация».")
                teacher = next((t for t in db.q("SELECT id, invite FROM teachers")
                                if hmac.compare_digest(code.encode(), t["invite"].encode())), None)
                if not teacher:
                    THROTTLE.fail("invite", ip)
                    time.sleep(1.0)
                    return self.err(403, "Неверный код приглашения")
                pw = str(data.get("new_password") or data.get("password") or "")
                if len(pw) < 6:
                    return self.err(400, "Пароль — не короче 6 символов")
                if not s:
                    db.x("INSERT INTO students(name,name_key,token,created,last_seen,pw,teacher_id) VALUES(?,?,?,?,?,?,?)",
                         (pretty, key, secrets.token_urlsafe(24), now, now, hash_pw(pw), teacher["id"]))
                    print(f"[ученик] новый: {pretty}", flush=True)
                else:                                  # старый ученик без пароля: журнал сохраняется
                    db.x("UPDATE students SET pw=?, teacher_id=COALESCE(teacher_id, ?) WHERE id=?", (hash_pw(pw), teacher["id"], s["id"]))
                    print(f"[ученик] задал пароль: {s['name']}", flush=True)
                s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
            db.x("UPDATE students SET last_seen=?, last_ip=? WHERE id=?", (now, ip, s["id"]))
            return self.send_json(self.me_payload(s), extra={"Set-Cookie": self.student_cookie(s["token"])})

        if path == "/api/password" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            ip = self.client_ip()
            wait = THROTTLE.blocked("login", ip)
            if wait:
                return self.err(429, self.wait_msg(wait))
            if s["pw"] and not check_pw(str(data.get("old") or ""), s["pw"]):
                THROTTLE.fail("login", ip)
                time.sleep(1.0)
                return self.err(403, "Текущий пароль неверный")
            new = str(data.get("new") or "")
            if len(new) < 6:
                return self.err(400, "Пароль — не короче 6 символов")
            tok = secrets.token_urlsafe(24)            # вход на других устройствах сбрасывается
            db.x("UPDATE students SET pw=?, token=? WHERE id=?", (hash_pw(new), tok, s["id"]))
            return self.send_json({"ok": True, "token": tok}, extra={"Set-Cookie": self.student_cookie(tok)})

        if path == "/api/me":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            return self.send_json(self.me_payload(s), extra={"Set-Cookie": self.student_cookie(s["token"])})

        if path == "/api/history":
            # Прогресс ученика страница восстанавливает из журнала попыток — один источник правды
            # для всех устройств, и подправить его в браузере нельзя.
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            APP.bank.ensure()
            rows = db.q("""SELECT task_id, n, score, ts, reason, rk, part, grp, exam, answers FROM attempts
                           WHERE student_id=? ORDER BY ts, id""", (s["id"],))
            tasks, pid = APP.bank.tasks, APP.bank.pid
            # [id, n, score, ts, reason, rk, part, grp, exam, пустой ответ в варианте]; id — открытые коды
            h = []
            for r in rows:
                grp = r["grp"] or (tasks.get(r["task_id"]) or {}).get("group") or ""
                h.append([pid(r["task_id"]), r["n"], r["score"], int(r["ts"] * 1000), r["reason"] or "",
                          r["rk"] or "", r["part"], pid(grp) if grp else "", 1 if r["exam"] else 0,
                          1 if r["exam"] and r["answers"] in (None, "", "[]") else 0])
            return self.send_json({"h": h})

        if path == "/api/logout" and method == "POST":
            return self.send_json({"ok": True}, extra={"Set-Cookie": "egest=; Path=/; Max-Age=0" + self.cookie_attrs()})

        if path == "/api/progress" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            # сам прогресс больше не присылается (он строится из журнала) — только прогноз и настройки
            fc = data.get("forecast")
            if isinstance(fc, (int, float)) and not isinstance(fc, bool) and 0 <= fc <= 100:
                fc = int(fc)
                try:
                    hist = json.loads(s["fc"] or "[]")
                except ValueError:
                    hist = []
                day = datetime.now().strftime("%Y-%m-%d")
                if hist and hist[-1].get("d") == day:
                    hist[-1]["s"] = fc
                else:
                    hist.append({"d": day, "s": fc})
                db.x("UPDATE students SET forecast=?, fc=? WHERE id=?",
                     (fc, json.dumps(hist[-120:], separators=(",", ":")), s["id"]))
            prefs = data.get("prefs")
            if isinstance(prefs, dict):
                APP.bank.ensure()
                back = lambda i: APP.bank.real(i) or i
                if isinstance(prefs.get("fav"), list):
                    prefs["fav"] = [back(i) for i in prefs["fav"] if isinstance(i, str)][:2000]
                if isinstance(prefs.get("notes"), dict):
                    prefs["notes"] = {back(k): v for k, v in prefs["notes"].items()}
                raw = json.dumps(prefs, ensure_ascii=False, separators=(",", ":"))
                if len(raw) > 300_000:
                    return self.err(413, "Слишком много заметок")
                db.x("UPDATE students SET prefs=?, progress_ts=? WHERE id=?", (raw, time.time(), s["id"]))
            return self.send_json({"ok": True})

        if path in ("/api/open", "/api/check", "/api/reveal") and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            t = APP.bank.tasks.get(APP.bank.real(data.get("task")))
            if not t:
                return self.err(404, "задание не найдено — обновите страницу")
            if path == "/api/open":
                return self.api_open(s, t)
            if t.get("parts"):
                return self.err(400, "вопросы 19–21 проверяются по отдельности")
            if path == "/api/reveal":
                return self.api_reveal(s, t)
            return self.api_check(s, t, data)

        if path == "/api/find":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            key = f"s{s['id']}"
            if THROTTLE.blocked("find", key):
                return self.err(429, "Слишком много поисков подряд. Подождите несколько минут.")
            THROTTLE.fail("find", key)          # считаем каждый поиск: перебором номеров не узнать код задания
            APP.bank.ensure()
            rid = APP.bank.find(qs.get("q"))
            if not rid:
                return self.err(404, "Задание не найдено")
            return self.send_json({"task": APP.bank.pid(rid)})

        if path == "/api/activity" and method == "POST":
            # уход со вкладки и попытки сделать снимок экрана — учитель видит это в журнале
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            ev = data.get("events") if isinstance(data.get("events"), list) else []
            now, ip = time.time(), self.client_ip()
            recent = db.q("SELECT COUNT(*) c FROM activity WHERE student_id=? AND ts>?", (s["id"], now - 3600), one=True)["c"]
            for e in ev[:max(0, min(50, ACTIVITY_PER_HOUR - recent))]:
                if not isinstance(e, dict) or e.get("kind") not in ACTIVITY_KINDS:
                    continue
                dur = to_float(e.get("dur"))
                tid = APP.bank.real(str(e.get("task") or "")) if APP.bank.ensure() else None
                db.x("INSERT INTO activity(student_id,ts,kind,task_id,dur,exam,ip) VALUES(?,?,?,?,?,?,?)",
                     (s["id"], now, e["kind"], tid, min(max(dur, 0), 86400), 1 if e.get("exam") else 0, ip))
            return self.send_json({"ok": True})

        if path == "/api/solution":
            # своё решение к заданию (код из редактора Python или текст): видит учитель
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            APP.bank.ensure()
            tid = APP.bank.real(str((data or {}).get("task") or qs.get("task") or ""))
            if not tid or tid not in APP.bank.tasks:
                return self.err(404, "задание не найдено — обновите страницу")
            if method == "POST":
                code = str(data.get("code") or "")
                if len(code) > MAX_SOLUTION:
                    return self.err(413, "Решение слишком длинное (больше 50 000 символов)")
                if code.strip():
                    db.x("""INSERT INTO solutions(student_id, task_id, code, ts) VALUES(?,?,?,?)
                            ON CONFLICT(student_id, task_id) DO UPDATE SET code=excluded.code, ts=excluded.ts""",
                         (s["id"], tid, code, time.time()))
                else:
                    db.x("DELETE FROM solutions WHERE student_id=? AND task_id=?", (s["id"], tid))
                return self.send_json({"ok": True})
            r = db.q("SELECT code, ts FROM solutions WHERE student_id=? AND task_id=?", (s["id"], tid), one=True)
            return self.send_json({"code": r["code"] if r else "", "ts": r["ts"] if r else None})

        if path == "/api/assignments":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            APP.bank.ensure()
            out = []
            if s["class_id"]:
                for a in db.q("SELECT * FROM assignments WHERE class_id=? ORDER BY created DESC", (s["class_id"],)):
                    real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
                    done = assignment_done(db, s["id"], real, a["created"])
                    out.append({"id": a["id"], "title": a["title"], "due": a["due"], "created": a["created"],
                                "tasks": [APP.bank.pid(i) for i in real], "done": [APP.bank.pid(i) for i in real if i in done]})
            return self.send_json({"assignments": out})

        if path == "/api/leaderboard":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not s["class_id"]:
                return self.send_json({"rows": [], "class": None})
            c = db.q("SELECT name FROM classes WHERE id=?", (s["class_id"],), one=True)
            rows = []
            for m in db.q("SELECT id, name FROM students WHERE class_id=?", (s["class_id"],)):
                g = game_summary(db, m["id"], brief=True)
                parts = m["name"].split()
                short = parts[0] + (" " + parts[1][0] + "." if len(parts) > 1 else "")
                rows.append({"name": short, "me": m["id"] == s["id"], "level": g["level"], "xp": g["xp"], "week": g["week"]})
            rows.sort(key=lambda r: (-r["week"], -r["xp"]))
            return self.send_json({"rows": rows, "class": c["name"] if c else ""})

        if path == "/api/exam/start" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            return self.api_exam_start(s)

        if path == "/api/exam/finish" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            return self.api_exam_finish(s, data)

        # ----- учитель
        if path == "/api/admin/login" and method == "POST":
            ip = self.client_ip()
            wait = THROTTLE.blocked("admin", ip)
            if wait:
                return self.err(429, self.wait_msg(wait))
            login = str(data.get("login") or "").strip().lower()
            t = (db.q("SELECT * FROM teachers WHERE lower(login)=?", (login,), one=True) if login
                 else db.q("SELECT * FROM teachers WHERE is_main=1", one=True))
            if t and check_pw(str(data.get("password") or ""), t["pw"]):
                THROTTLE.ok("admin", ip)
                tok = secrets.token_urlsafe(32)
                db.x("INSERT INTO admin_sessions(token,expires,teacher_id) VALUES(?,?,?)",
                     (tok, time.time() + ADMIN_SESSION_DAYS * 86400, t["id"]))
                db.x("DELETE FROM admin_sessions WHERE expires<?", (time.time(),))
                return self.send_json({"ok": True}, extra={
                    "Set-Cookie": f"egeadm={tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age={ADMIN_SESSION_DAYS * 86400}{self.cookie_attrs()}"})
            THROTTLE.fail("admin", ip)
            time.sleep(1.0)
            return self.err(403, "Неверный логин или пароль")

        if path.startswith("/api/admin/"):
            if not self.is_admin():
                return self.err(401, "нужен вход учителя")
            return self.admin_api(method, path, qs, data)

        return self.err(404, "нет такого метода")

    # ---------- задание: открыть, проверить, показать ответ
    def api_open(self, s, t):
        """Ученик открыл задание: с этого момента идёт время на раздумье.
        Открыл заново, не закончив после неверной попытки, — засчитываем «ушёл после ошибки»,
        иначе перезагрузкой страницы можно было бы получать новые попытки без конца."""
        ids = [p["id"] for p in t["parts"]] if t.get("parts") else [t["id"]]
        for tid in ids:
            st = OPENED.get(s["id"], tid, create=False)
            if st and st["final"] is None and st["tries"]:
                self.log_attempt(s, APP.bank.tasks[tid], st["tries"], 0.0, abandoned=True,
                                 reason=st.get("reason", ""), rk=st.get("rk"), part=st.get("part"))
                OPENED.reset(s["id"], tid)
            elif st is None or st["final"] is not None:
                OPENED.reset(s["id"], tid)
            # открыто и ещё без ответа (например, перезагрузили страницу) — время открытия не сбрасываем
        st = OPENED.get(s["id"], ids[0])
        return self.send_json({"ok": True, "think": think_sec(t.get("n")),
                               "think_left": max(0, math.ceil(st["ts"] + think_sec(t.get("n")) - time.time()))})

    def api_check(self, s, t, data):
        st = OPENED.get(s["id"], t["id"])
        if st["final"] is not None:          # повтор того же запроса (например, после обрыва связи)
            return self.send_json(st["final"])
        st["reason"] = str(data.get("reason") or "")[:20]
        st["rk"] = str(data.get("rk") or "")[:200] or None
        spent = data.get("spent_ms")
        spent = int(spent) if isinstance(spent, (int, float)) and 0 <= spent < 864e5 else None
        away = to_int(data.get("away"))
        st["away"] = min(max(away or 0, st.get("away") or 0), 999)
        n = t.get("n") or 0

        if data.get("abandoned"):
            if not st["tries"]:              # пропустил, не отвечая, — без штрафа
                OPENED.reset(s["id"], t["id"])
                return self.send_json({"ok": True, "skipped": True})
            self.log_attempt(s, t, st["tries"], 0.0, abandoned=True, reason=st["reason"], rk=st["rk"],
                             part=st.get("part"), spent=spent, away=st["away"])
            st["final"] = {"correct": False, "final": True, "score": 0.0}
            return self.send_json(st["final"])

        gave_up = bool(data.get("gave_up"))
        if not gave_up:
            ans = str(data.get("answer") or "")[:400]
            if not tokens(ans):
                return self.err(400, "Пустой ответ")
            cells = data.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            st["tries"].append(ans)
            credit = answer_credit(n, t.get("ans", ""), ans, cells)
            if len(st["tries"]) == 1:
                st["part"] = credit          # на экзамене попытка одна — частичный балл считаем по первой
            if credit == 1.0:
                score = 1.0 if len(st["tries"]) == 1 else 0.5
                self.log_attempt(s, t, st["tries"], score, reason=st["reason"], rk=st["rk"], part=st["part"],
                                 revealed=1, spent=spent, away=st["away"])
                st["final"] = self.with_answer_s(s, {"correct": True, "final": True, "score": score, "part": st["part"]}, t)
                return self.send_json(dict(st["final"], game=game_summary(APP.db, s["id"])))
            if len(st["tries"]) < ATTEMPTS_PER_TASK:
                return self.send_json({"correct": False, "final": False, "attempts_left": ATTEMPTS_PER_TASK - len(st["tries"]),
                                       "half": credit == 0.5})

        # итог «не решено»: исчерпаны попытки или «Показать ответ»
        block = self.reveal_block(s, t, st)
        part = st.get("part", 0.0) if st["tries"] else 0.0
        aid = self.log_attempt(s, t, st["tries"], 0.0, gave_up=gave_up, reason=st["reason"], rk=st["rk"],
                               part=part, revealed=0 if block else 1, spent=spent, away=st["away"])
        self.log_reveal(s, t, block)
        res = {"correct": False, "final": True, "score": 0.0, "part": part}
        if block:
            res["hidden"] = block
        else:
            res = self.with_answer_s(s, res, t)
        st["final"] = res
        st["aid"] = aid
        return self.send_json(res)

    def api_reveal(self, s, t):
        """Ответ был скрыт (рано или исчерпан лимит) — показать, если теперь можно."""
        st = OPENED.get(s["id"], t["id"], create=False)
        if not st or not st["final"]:
            return self.err(409, "Ответ открывается после попыток или кнопки «Показать ответ»")
        if not st["final"].get("hidden"):
            return self.send_json(st["final"])
        block = self.reveal_block(s, t, st)
        self.log_reveal(s, t, block)
        if block:
            return self.send_json({"hidden": block})
        st["final"] = self.with_answer_s(s, st["final"], t)
        if st.get("aid"):
            APP.db.x("UPDATE attempts SET revealed=1 WHERE id=?", (st["aid"],))
        return self.send_json(st["final"])

    # ---------- вариант ЕГЭ
    def api_exam_start(self, s):
        db = APP.db
        now = time.time()
        ip = self.client_ip()
        if db.q("SELECT COUNT(*) c FROM exams WHERE student_id=? AND started>?", (s["id"], now - 86400), one=True)["c"] >= EXAM_PER_DAY:
            return self.err(429, f"Не больше {EXAM_PER_DAY} вариантов в сутки. Пока можно тренироваться по номерам.")
        if db.q("SELECT COUNT(*) c FROM exams WHERE ip=? AND started>?", (ip, now - 86400), one=True)["c"] >= EXAM_PER_DAY_IP:
            return self.err(429, "С этого адреса сегодня начато слишком много вариантов. Попробуйте завтра.")
        eid = secrets.token_urlsafe(9)
        db.x("INSERT INTO exams(id,student_id,ip,started) VALUES(?,?,?,?)", (eid, s["id"], ip, now))
        return self.send_json({"exam_id": eid, "started": now, "limit": EXAM_LIMIT_SEC,
                               "min_for_answers": EXAM_MIN_SEC_FOR_ANSWERS})

    def api_exam_finish(self, s, data):
        db = APP.db
        e = db.q("SELECT * FROM exams WHERE id=? AND student_id=?", (str(data.get("exam_id") or ""), s["id"]), one=True)
        if not e:
            return self.err(404, "Вариант не найден — начните новый")
        if e["finished"]:
            return self.send_json(json.loads(e["result"] or "{}"))
        now = time.time()
        spent = now - e["started"]
        show = spent >= EXAM_MIN_SEC_FOR_ANSWERS
        items = data.get("answers") if isinstance(data.get("answers"), list) else []
        results, primary, seen, nums = [], 0, set(), set()
        for it in items[:40]:
            if not isinstance(it, dict):
                continue
            tid = APP.bank.real(it.get("task")) or ""
            t = APP.bank.tasks.get(tid)
            if not t or t.get("parts") or tid in seen or t.get("n") in nums:
                continue                      # по одному заданию на номер, как на экзамене
            seen.add(tid)
            n = t.get("n") or 0
            nums.add(n)
            ans = str(it.get("answer") or "")[:400]
            cells = it.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            blank = not tokens(ans)
            credit = 0.0 if blank else answer_credit(n, t.get("ans", ""), ans, cells)
            pts = ege_points(n) if credit == 1.0 else (1 if credit == 0.5 else 0)
            primary += pts
            self.log_attempt(s, t, [] if blank else [ans], 1.0 if credit == 1.0 else 0.0, reason="exam",
                             part=credit, revealed=int(show and not blank), exam=e["id"])
            r = {"task": APP.bank.pid(tid), "n": n, "points": pts, "max": ege_points(n), "part": credit, "blank": blank}
            if show and not blank:
                r["answer"] = t.get("ans", "")
            results.append(r)
        test = EGE_SCALE[min(primary, len(EGE_SCALE) - 1)]
        out = {"results": results, "primary": primary, "test": test, "spent": int(spent), "shown": show,
               "min_for_answers": EXAM_MIN_SEC_FOR_ANSWERS}
        db.x("UPDATE exams SET finished=?, items=?, primary_score=?, test_score=?, result=? WHERE id=?",
             (now, len(results), primary, test, json.dumps(out, ensure_ascii=False), e["id"]))
        return self.send_json(dict(out, game=game_summary(db, s["id"])))

    # ---------- API учителя
    def admin_api(self, method, path, qs, data):
        db = APP.db
        now = time.time()
        day0 = datetime.combine(datetime.now().date(), datetime.min.time()).timestamp()

        if path == "/api/admin/logout" and method == "POST":
            c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
            if "egeadm" in c:
                db.x("DELETE FROM admin_sessions WHERE token=?", (c["egeadm"].value,))
            return self.send_json({"ok": True}, extra={"Set-Cookie": "egeadm=; Path=/; Max-Age=0" + self.cookie_attrs()})

        if path == "/api/admin/students":
            rows = db.q("""
              SELECT s.id, s.name, s.created, s.last_seen, s.forecast,
                     COUNT(a.id) AS total,
                     SUM(a.score = 1) AS ok1, SUM(a.score = 0.5) AS ok2, SUM(a.score = 0) AS bad,
                     SUM(a.ts >= ?) AS today, SUM(a.ts >= ?) AS week,
                     SUM(a.ts >= ? AND a.score = 0) AS bad_week,
                     MAX(a.ts) AS last_attempt,
                     (SELECT COUNT(*) FROM reveal_log r WHERE r.student_id = s.id AND r.granted = 1 AND r.ts >= ?) AS rev_week,
                     (SELECT COUNT(*) FROM reveal_log r WHERE r.student_id = s.id AND r.granted = 0 AND r.why = 'limit' AND r.ts >= ?) AS blocked_week,
                     (SELECT test_score FROM exams e WHERE e.student_id = s.id AND e.finished IS NOT NULL
                       ORDER BY e.finished DESC LIMIT 1) AS exam_last,
                     (SELECT COUNT(*) FROM activity v WHERE v.student_id = s.id AND v.ts >= ?) AS away_week,
                     s.class_id, s.teacher_id
              FROM students s LEFT JOIN attempts a ON a.student_id = s.id
              WHERE {scope}
              GROUP BY s.id ORDER BY COALESCE(MAX(a.ts), s.last_seen) DESC""".replace("{scope}", self.student_scope()[0]),
                        (day0, now - 7 * 86400, now - 7 * 86400, now - 7 * 86400, now - 7 * 86400, now - 7 * 86400)
                        + self.student_scope()[1])
            cid = qs.get("class_id")
            names = {t["id"]: t["name"] for t in db.q("SELECT id, name FROM teachers")}
            main_id = main_teacher()["id"]
            out = []
            for r in rows:
                if cid == "none" and r["class_id"] is not None or cid not in (None, "", "none", "all") and r["class_id"] != to_int(cid):
                    continue
                d = dict(r)
                g = game_summary(db, r["id"], brief=True)
                d["level"], d["xp"] = g["level"], g["xp"]
                d["teacher_id"] = r["teacher_id"] or main_id
                d["teacher"] = names.get(d["teacher_id"], "")
                out.append(d)
            return self.send_json({"students": out, "now": now})

        if path == "/api/admin/student":
            sid = to_int(qs.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            s = db.q("SELECT id,name,created,last_seen,forecast,progress_ts,last_ip,fc,progress FROM students WHERE id=?",
                     (sid,), one=True)
            if not s:
                return self.err(404, "ученик не найден")
            frm = to_float(qs.get("from"))
            att = db.q("SELECT * FROM attempts WHERE student_id=? AND ts>=? ORDER BY ts DESC LIMIT 5000", (sid, frm))
            APP.bank.ensure()
            out = []
            for a in att:
                d = dict(a)
                d["answers"] = json.loads(d["answers"] or "[]")
                d["snip"] = APP.bank.snippet(d["task_id"])
                out.append(d)
            fc_hist = []
            try:
                fc_hist = json.loads(s["fc"]) if s["fc"] else (json.loads(s["progress"] or "{}").get("fc") or [])
            except (ValueError, AttributeError):
                pass
            rev = db.q("""SELECT SUM(granted = 1) AS granted, SUM(granted = 0 AND why = 'limit') AS blocked,
                                 SUM(granted = 0 AND why = 'think') AS early
                          FROM reveal_log WHERE student_id=? AND ts>=?""", (sid, frm), one=True)
            exams = db.q("""SELECT started, finished, primary_score, test_score, items FROM exams
                            WHERE student_id=? AND finished IS NOT NULL ORDER BY finished DESC LIMIT 20""", (sid,))
            same_ip = []
            if s["last_ip"]:
                same_ip = [r["name"] for r in db.q("SELECT name FROM students WHERE last_ip=? AND id<>? ORDER BY last_seen DESC LIMIT 30",
                                                     (s["last_ip"], sid))]
            student = {k: s[k] for k in ("id", "name", "created", "last_seen", "forecast", "progress_ts", "last_ip")}
            student["has_password"] = bool(db.q("SELECT pw FROM students WHERE id=?", (sid,), one=True)["pw"])
            coded = {r["task_id"] for r in db.q("SELECT task_id FROM solutions WHERE student_id=?", (sid,))}
            for d in out:
                d["has_code"] = 1 if d["task_id"] in coded or (d.get("grp") or "") in coded else 0
            act = db.q("""SELECT kind, COUNT(*) AS c, SUM(dur) AS dur, SUM(exam) AS in_exam FROM activity
                          WHERE student_id=? AND ts>=? GROUP BY kind""", (sid, frm))
            row = db.q("SELECT class_id, teacher_id FROM students WHERE id=?", (sid,), one=True)
            student["class_id"] = row["class_id"]
            student["teacher_id"] = row["teacher_id"] or main_teacher()["id"]
            return self.send_json({"student": student, "attempts": out, "forecast_history": fc_hist,
                                   "reveals": {k: rev[k] or 0 for k in ("granted", "blocked", "early")},
                                   "exams": [dict(r) for r in exams], "same_ip": same_ip,
                                   "activity": {r["kind"]: {"count": r["c"], "sec": round(r["dur"] or 0), "exam": r["in_exam"] or 0} for r in act},
                                   "game": game_summary(db, sid), "rules": self.rules()})

        if path == "/api/admin/feed":
            since = to_float(qs.get("since"))
            cond, args = self.student_scope()
            rows = db.q(f"""SELECT a.*, s.name FROM attempts a JOIN students s ON s.id = a.student_id
                            WHERE a.ts > ? AND {cond} ORDER BY a.ts DESC LIMIT 300""", (since, *args))
            APP.bank.ensure()
            out = []
            for a in rows:
                d = dict(a)
                d["answers"] = json.loads(d["answers"] or "[]")
                d["snip"] = APP.bank.snippet(d["task_id"])
                out.append(d)
            return self.send_json({"attempts": out, "now": now})

        if path == "/api/admin/task":
            APP.bank.ensure()
            t = APP.bank.tasks.get(qs.get("id") or "")
            if not t:
                return self.err(404, "задание не найдено (банк мог быть пересобран)")
            own = db.q("SELECT text FROM tsolutions WHERE teacher_id=? AND task_id IN (?, ?)",
                       (self.T["id"], t["id"], t.get("group") or ""), one=True)
            return self.send_json(dict(t, teacher_sol=own["text"] if own else None))

        if path == "/api/admin/task-solution" and method == "POST":
            APP.bank.ensure()
            tid = str(data.get("task") or "")
            t = APP.bank.tasks.get(tid)
            if not t:
                return self.err(404, "задание не найдено")
            tid = t.get("group") or tid                    # у 19–21 решение одно на всю игру
            text = str(data.get("text") or "")
            if len(text) > MAX_SOLUTION:
                return self.err(413, "Решение слишком длинное")
            if text.strip():
                db.x("""INSERT INTO tsolutions(teacher_id, task_id, text, ts) VALUES(?,?,?,?)
                        ON CONFLICT(teacher_id, task_id) DO UPDATE SET text=excluded.text, ts=excluded.ts""",
                     (self.T["id"], tid, text, now))
            else:
                db.x("DELETE FROM tsolutions WHERE teacher_id=? AND task_id=?", (self.T["id"], tid))
            return self.send_json({"ok": True})

        if path == "/api/admin/solution":
            if not self.sees_student(to_int(qs.get("student"))):
                return self.err(404, "решение не прикреплено")
            r = db.q("SELECT code, ts FROM solutions WHERE student_id=? AND task_id=?",
                     (to_int(qs.get("student")), str(qs.get("task") or "")), one=True)
            if not r:
                return self.err(404, "решение не прикреплено")
            return self.send_json({"code": r["code"], "ts": r["ts"]})

        if path == "/api/admin/export.csv":
            sid = qs.get("student")
            frm = to_float(qs.get("from"))
            args = [frm]
            cond, sargs = self.student_scope()
            sql = f"""SELECT a.*, s.name FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.ts>=? AND {cond}"""
            args += list(sargs)
            if sid:
                sql += " AND a.student_id=?"
                args.append(to_int(sid))
            sql += " ORDER BY s.name, a.ts"
            rows = db.q(sql, args)
            buf = io.StringIO()
            w = csv.writer(buf, delimiter=";")
            w.writerow(["Ученик", "Дата", "Время", "№", "ID задания", "Банк", "Ответ ученика (1-я попытка)",
                        "2-я попытка", "Правильный ответ", "Результат", "Баллы", "Время на задание, с", "Почему выдано"])
            for a in rows:
                answers = json.loads(a["answers"] or "[]")
                dt = datetime.fromtimestamp(a["ts"])
                res = ("верно" if a["score"] == 1 else "верно со 2-й попытки" if a["score"] == 0.5
                       else "показал ответ" if a["gave_up"] else "ушёл после ошибки" if a["abandoned"]
                       else "нет ответа" if a["reason"] == "exam" and not answers else "неверно")
                if a["score"] == 0 and a["part"] == 0.5:
                    res += " (верна половина — 1 балл из 2)"
                w.writerow([csv_cell(x) for x in [a["name"], dt.strftime("%d.%m.%Y"), dt.strftime("%H:%M"), a["n"], a["task_id"].split(":", 1)[-1],
                            a["bank"], (answers[0] if answers else "").replace("\n", " "),
                            (answers[1] if len(answers) > 1 else "").replace("\n", " "),
                            (a["correct"] or "").replace("\n", " | "), res,
                            str(a["score"]).replace(".", ","), round((a["spent_ms"] or 0) / 1000), REASONS.get(a["reason"], a["reason"])]])
            body = ("﻿" + buf.getvalue()).encode("utf-8")
            name = "zhurnal.csv"
            return self.send_bytes(200, body, "text/csv; charset=utf-8",
                                   {"Content-Disposition": f"attachment; filename={name}", "Cache-Control": "no-store"})

        if path == "/api/admin/password" and method == "POST":
            ip = self.client_ip()
            wait = THROTTLE.blocked("admin", ip)
            if wait:
                return self.err(429, self.wait_msg(wait))
            if not check_pw(str(data.get("old") or ""), self.T["pw"]):
                THROTTLE.fail("admin", ip)
                time.sleep(1.0)
                return self.err(403, "Текущий пароль неверный")
            new = str(data.get("new") or "")
            if len(new) < 6:
                return self.err(400, "Новый пароль — не короче 6 символов")
            db.x("UPDATE teachers SET pw=? WHERE id=?", (hash_pw(new), self.T["id"]))
            if self.T["is_main"]:
                db.setting("admin_password", hash_pw(new))
            # остальные сессии этого учителя (например, на забытом компьютере) больше не действуют
            cur_tok = self.cookie("egeadm") or ""
            db.x("DELETE FROM admin_sessions WHERE token<>? AND COALESCE(teacher_id, ?)=?",
                 (cur_tok, main_teacher()["id"], self.T["id"]))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/rename" and method == "POST":
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            pretty, key = norm_name(data.get("name"))
            if not NAME_RE.match(pretty) or len(pretty.split()) < 2:
                return self.err(400, "Нужны фамилия и имя")
            other = db.q("SELECT id FROM students WHERE name_key=? AND id<>?", (key, sid), one=True)
            if other and not self.sees_student(other["id"]):
                return self.err(409, "Ученик с таким ФИО уже есть у другого учителя — добавьте отчество")
            if other:      # такое ФИО уже есть — объединяем журналы
                for table in ("attempts", "reveal_log", "exams", "activity"):
                    db.x(f"UPDATE {table} SET student_id=? WHERE student_id=?", (other["id"], sid))
                db.x("UPDATE OR IGNORE solutions SET student_id=? WHERE student_id=?", (other["id"], sid))
                db.x("DELETE FROM solutions WHERE student_id=?", (sid,))
                db.x("DELETE FROM students WHERE id=?", (sid,))
                return self.send_json({"ok": True, "merged_into": other["id"]})
            db.x("UPDATE students SET name=?, name_key=? WHERE id=?", (pretty, key, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/password-reset" and method == "POST":
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if not db.q("SELECT 1 FROM students WHERE id=?", (sid,), one=True):
                return self.err(404, "ученик не найден")
            # пароль стирается, вход на всех устройствах сбрасывается; ученик задаст новый с кодом приглашения
            db.x("UPDATE students SET pw=NULL, token=? WHERE id=?", (secrets.token_urlsafe(24), sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/delete" and method == "POST":
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            for table in ("attempts", "reveal_log", "exams", "activity", "solutions"):
                db.x(f"DELETE FROM {table} WHERE student_id=?", (sid,))
            db.x("DELETE FROM students WHERE id=?", (sid,))
            return self.send_json({"ok": True})

        if path == "/api/admin/invite" and method == "POST":
            code = re.sub(r"\s+", "", str(data.get("code") or ""))
            if not 4 <= len(code) <= 40:
                return self.err(400, "Код — от 4 до 40 символов без пробелов")
            if db.q("SELECT 1 FROM teachers WHERE invite=? AND id<>?", (code, self.T["id"]), one=True):
                return self.err(409, "Такой код уже у другого учителя — придумайте другой")
            db.x("UPDATE teachers SET invite=? WHERE id=?", (code, self.T["id"]))
            if self.T["is_main"]:
                db.setting("invite_code", code)
            return self.send_json({"ok": True, "code": code})

        if path == "/api/admin/authored" and method == "POST":
            on = 1 if data.get("on") else 0
            db.x("UPDATE teachers SET authored=? WHERE id=?", (on, self.T["id"]))
            return self.send_json({"ok": True, "on": bool(on)})

        if path == "/api/admin/me":
            return self.send_json({k: self.T[k] for k in ("id", "name", "login", "is_main", "invite")})

        if path == "/api/admin/teachers":
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            rows = db.q("""SELECT t.id, t.name, t.login, t.invite, t.is_main, t.created,
                                  (SELECT COUNT(*) FROM students s WHERE COALESCE(s.teacher_id, ?) = t.id) AS students,
                                  (SELECT COUNT(*) FROM classes c WHERE COALESCE(c.teacher_id, ?) = t.id) AS classes
                           FROM teachers t ORDER BY t.is_main DESC, t.name""", (main_teacher()["id"],) * 2)
            return self.send_json({"teachers": [dict(r) for r in rows]})

        if path == "/api/admin/teacher/save" and method == "POST":
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            tid = to_int(data.get("id"))
            name = re.sub(r"\s+", " ", str(data.get("name") or "")).strip()[:80]
            login = str(data.get("login") or "").strip().lower()
            invite = re.sub(r"\s+", "", str(data.get("invite") or "")) or secrets.token_hex(3).upper() + str(secrets.randbelow(90) + 10)
            pw = str(data.get("password") or "")
            if not name:
                return self.err(400, "Введите имя учителя")
            if not re.fullmatch(r"[a-z0-9._-]{3,32}", login):
                return self.err(400, "Логин — 3–32 латинские буквы, цифры, точка, дефис или подчёркивание")
            if not 4 <= len(invite) <= 40:
                return self.err(400, "Код приглашения — от 4 до 40 символов без пробелов")
            if db.q("SELECT 1 FROM teachers WHERE lower(login)=? AND id<>?", (login, tid or 0), one=True):
                return self.err(409, "Такой логин уже занят")
            if db.q("SELECT 1 FROM teachers WHERE invite=? AND id<>?", (invite, tid or 0), one=True):
                return self.err(409, "Такой код приглашения уже у другого учителя")
            if tid:
                if not db.q("SELECT 1 FROM teachers WHERE id=?", (tid,), one=True):
                    return self.err(404, "учитель не найден")
                db.x("UPDATE teachers SET name=?, login=?, invite=? WHERE id=?", (name, login, invite, tid))
                if pw:
                    if len(pw) < 6:
                        return self.err(400, "Пароль — не короче 6 символов")
                    db.x("UPDATE teachers SET pw=? WHERE id=?", (hash_pw(pw), tid))
                    db.x("DELETE FROM admin_sessions WHERE teacher_id=?", (tid,))      # старый пароль больше не действует
            else:
                if len(pw) < 6:
                    return self.err(400, "Пароль — не короче 6 символов")
                tid = db.x("INSERT INTO teachers(name, login, pw, invite, is_main, created) VALUES(?,?,?,?,0,?)",
                           (name, login, hash_pw(pw), invite, now))
            return self.send_json({"ok": True, "id": tid, "invite": invite})

        if path == "/api/admin/teacher/delete" and method == "POST":
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            tid = to_int(data.get("id"))
            t = db.q("SELECT * FROM teachers WHERE id=?", (tid,), one=True)
            if not t or t["is_main"]:
                return self.err(400, "Главного учителя удалить нельзя")
            main_id = main_teacher()["id"]
            # ученики, классы и подборки остаются — переходят главному учителю
            db.x("UPDATE students SET teacher_id=? WHERE teacher_id=?", (main_id, tid))
            db.x("UPDATE classes SET teacher_id=? WHERE teacher_id=?", (main_id, tid))
            db.x("DELETE FROM tsolutions WHERE teacher_id=?", (tid,))
            db.x("DELETE FROM admin_sessions WHERE teacher_id=?", (tid,))
            db.x("DELETE FROM teachers WHERE id=?", (tid,))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/teacher" and method == "POST":
            # главный передаёт ученика другому учителю (класс при этом снимается)
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid, tid = to_int(data.get("id")), to_int(data.get("teacher_id"))
            if not db.q("SELECT 1 FROM teachers WHERE id=?", (tid,), one=True) or not self.sees_student(sid):
                return self.err(404, "не найдено")
            db.x("UPDATE students SET teacher_id=?, class_id=NULL WHERE id=?", (tid, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/classes":
            main_id = main_teacher()["id"]
            ccond = "1=1" if self.T["is_main"] else "COALESCE(c.teacher_id, ?) = ?"
            cargs = () if self.T["is_main"] else (main_id, self.T["id"])
            rows = db.q(f"""SELECT c.id, c.name, c.created, COALESCE(c.teacher_id, ?) AS teacher_id, t.name AS teacher,
                                  COUNT(s.id) AS students FROM classes c
                           LEFT JOIN students s ON s.class_id = c.id
                           LEFT JOIN teachers t ON t.id = COALESCE(c.teacher_id, ?)
                           WHERE {ccond} GROUP BY c.id ORDER BY t.is_main DESC, t.name, c.name""", (main_id, main_id, *cargs))
            cond, args = self.student_scope()
            free = db.q(f"SELECT COUNT(*) c FROM students s WHERE class_id IS NULL AND {cond}", args, one=True)["c"]
            return self.send_json({"classes": [dict(r) for r in rows], "unassigned": free})

        if path == "/api/admin/class/save" and method == "POST":
            name = re.sub(r"\s+", " ", str(data.get("name") or "")).strip()[:40]
            if not name:
                return self.err(400, "Введите название класса, например «11А»")
            cid = to_int(data.get("id"))
            if cid:
                if not self.sees_class(cid):
                    return self.err(404, "класс не найден")
                db.x("UPDATE classes SET name=? WHERE id=?", (name, cid))
            else:
                cid = db.x("INSERT INTO classes(name, created, teacher_id) VALUES(?,?,?)", (name, now, self.T["id"]))
            return self.send_json({"ok": True, "id": cid})

        if path == "/api/admin/class/delete" and method == "POST":
            cid = to_int(data.get("id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            db.x("UPDATE students SET class_id=NULL WHERE class_id=?", (cid,))      # ученики возвращаются в «нераспределённые»
            db.x("DELETE FROM assignments WHERE class_id=?", (cid,))
            db.x("DELETE FROM classes WHERE id=?", (cid,))
            return self.send_json({"ok": True})

        if path == "/api/admin/class/members" and method == "POST":
            cid = to_int(data.get("class_id")) or None
            if cid and not self.sees_class(cid):
                return self.err(404, "класс не найден")
            ids = [to_int(i) for i in (data.get("students") or []) if to_int(i) and self.sees_student(to_int(i))][:500]
            # ученик в классе — ученик учителя этого класса (главный может так передать ученика другому учителю)
            owner = db.q("SELECT teacher_id FROM classes WHERE id=?", (cid,), one=True)["teacher_id"] if cid else None
            for sid in ids:
                if owner:
                    db.x("UPDATE students SET class_id=?, teacher_id=? WHERE id=?", (cid, owner, sid))
                else:
                    db.x("UPDATE students SET class_id=? WHERE id=?", (cid, sid))
            return self.send_json({"ok": True, "moved": len(ids)})

        if path == "/api/admin/assignments":
            cid = to_int(qs.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            APP.bank.ensure()
            members = db.q("SELECT id, name FROM students WHERE class_id=? ORDER BY name", (cid,))
            out = []
            for a in db.q("SELECT * FROM assignments WHERE class_id=? ORDER BY created DESC", (cid,)):
                real = json.loads(a["tasks"] or "[]")
                prog = [{"id": m["id"], "name": m["name"], "done": len(assignment_done(db, m["id"], real, a["created"]))}
                        for m in members]
                out.append({"id": a["id"], "title": a["title"], "due": a["due"], "created": a["created"],
                            "tasks": [{"id": i, "n": (APP.bank.tasks.get(i) or {}).get("n"),
                                       "snip": APP.bank.snippet(i), "missing": i not in APP.bank.tasks} for i in real],
                            "progress": prog})
            return self.send_json({"assignments": out})

        if path == "/api/admin/assignment/save" and method == "POST":
            cid = to_int(data.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            title = re.sub(r"\s+", " ", str(data.get("title") or "")).strip()[:80]
            if not title:
                return self.err(400, "Введите название подборки")
            APP.bank.ensure()
            tasks = []
            for i in data.get("tasks") or []:
                i = str(i)
                if i in APP.bank.tasks and i not in tasks:
                    tasks.append(i)
            if not tasks:
                return self.err(400, "В подборке нет ни одного задания")
            tasks = tasks[:100]
            due = to_float(data.get("due")) or None
            aid = to_int(data.get("id"))
            if aid:
                db.x("UPDATE assignments SET title=?, tasks=?, due=? WHERE id=? AND class_id=?",
                     (title, json.dumps(tasks), due, aid, cid))
            else:
                aid = db.x("INSERT INTO assignments(class_id,title,tasks,created,due) VALUES(?,?,?,?,?)",
                           (cid, title, json.dumps(tasks), now, due))
            return self.send_json({"ok": True, "id": aid})

        if path == "/api/admin/assignment/delete" and method == "POST":
            a = db.q("SELECT class_id FROM assignments WHERE id=?", (to_int(data.get("id")),), one=True)
            if not a or not self.sees_class(a["class_id"]):
                return self.err(404, "подборка не найдена")
            db.x("DELETE FROM assignments WHERE id=?", (to_int(data.get("id")),))
            return self.send_json({"ok": True})

        if path == "/api/admin/bank/find":
            # задание для подборки: по номеру КомпЕГЭ, коду ФИПИ или id из журнала
            APP.bank.ensure()
            q = str(qs.get("q") or "").strip()
            rid = q if q in APP.bank.tasks else APP.bank.find(q)
            if not rid:
                return self.err(404, "Задание не найдено")
            t = APP.bank.tasks[rid]
            return self.send_json({"id": rid, "n": t.get("n"), "snip": APP.bank.snippet(rid)})

        if path == "/api/admin/bank/pick":
            # случайные задания нужного номера (актуального формата, без частей 19–21 по отдельности)
            APP.bank.ensure()
            n = to_int(qs.get("n"))
            k = min(max(to_int(qs.get("count")) or 1, 1), 30)
            skip = set(str(qs.get("skip") or "").split(","))
            pool = [tid for tid, t in APP.bank.tasks.items()
                    if t.get("n") == n and not t.get("group") and tid not in skip and t.get("fmt") != "old"
                    and (self.T["authored"] or not is_authored(t.get("src"), t.get("html")))]
            pick = secrets.SystemRandom().sample(pool, min(k, len(pool)))
            return self.send_json({"tasks": [{"id": i, "n": n, "snip": APP.bank.snippet(i)} for i in pick]})

        if path == "/api/admin/info":
            n_tasks = len(APP.bank.tasks) if APP.bank.ensure() else 0
            cond, args = self.student_scope()
            return self.send_json({"tasks": n_tasks, "authored_tasks": APP.bank.authored, "authored_on": bool(self.T["authored"]),
                                   "bank_built": APP.bank.mtime, "missing_media": APP.bank.missing_dirs,
                                   "invite": self.T["invite"],
                                   "students": db.q(f"SELECT COUNT(*) c FROM students s WHERE {cond}", args, one=True)["c"],
                                   "attempts": db.q(f"SELECT COUNT(*) c FROM attempts a JOIN students s ON s.id=a.student_id WHERE {cond}",
                                                    args, one=True)["c"]})

        return self.err(404, "нет такого метода")


REASONS = {"exam": "вариант ЕГЭ", "search": "найдено поиском", "fav": "избранное", "history": "повтор из истории",
           "new": "новое", "review": "повторение после ошибки", "retry": "работа над ошибкой",
           "weak": "слабое место", "repeat": "повтор решённого", "": ""}


def teacher_solution(t, teacher_id=None):
    """Решение учителя к заданию (для вопросов 19–21 — к игре целиком): своего учителя, иначе главного."""
    ids = [teacher_id, main_teacher()["id"]] if teacher_id else [main_teacher()["id"]]
    for who in dict.fromkeys(ids):
        for tid in (t.get("id"), t.get("group")):
            if tid:
                r = APP.db.q("SELECT text FROM tsolutions WHERE teacher_id=? AND task_id=?", (who, tid), one=True)
                if r:
                    return r["text"]
    return None


def authored_on():
    """Давать ли авторские задания в подборках и вариантах (настройка главного учителя; по умолчанию — да)."""
    t = main_teacher()
    return bool(t["authored"]) if t else True


# ================================================================ уровни и достижения
# Опыт считается сервером по журналу попыток: подкрутить его в браузере нельзя.
LEVEL_TITLES = [(1, "Новичок"), (3, "Ученик"), (5, "Кодер"), (8, "Алгоритмист"), (11, "Хакер"), (15, "Гуру"), (20, "Легенда")]
ACHIEVEMENTS = [
    # id, значок, название, описание, цель
    ("first", "1", "Первый шаг", "Решить первое задание", 1),
    ("s10", "10", "Разогрев", "Решить 10 заданий", 10),
    ("s100", "100", "Сотня", "Решить 100 заданий", 100),
    ("s500", "500", "Пятьсот", "Решить 500 заданий", 500),
    ("s1000", "1K", "Тысячник", "Решить 1000 заданий", 1000),
    ("row10", "x10", "Снайпер", "10 верных ответов подряд с первой попытки", 10),
    ("row25", "x25", "Машина", "25 верных ответов подряд с первой попытки", 25),
    ("hard10", "HC", "Хардкор", "Решить 10 заданий №24–27", 10),
    ("all27", "27", "Полный набор", "Решить хотя бы по одному заданию каждого номера", 25),
    ("fix20", "FIX", "Работа над ошибками", "20 раз решить задание, которое раньше не вышло", 20),
    ("day50", "50", "Марафон", "Решить 50 заданий за один день", 50),
    ("days7", "7Д", "Неделя", "Заниматься 7 дней подряд", 7),
    ("days30", "30Д", "Месяц", "Заниматься 30 дней подряд", 30),
    ("night", "PM", "Ночная смена", "Решить задание после 23:00", 1),
    ("early", "AM", "Ранняя пташка", "Решить задание до 7:00", 1),
    ("exam1", "EX", "Первый вариант", "Завершить вариант ЕГЭ", 1),
    ("exam80", "80+", "Высокий балл", "Набрать 80+ баллов за вариант", 1),
    ("exam100", "100!", "Сотка", "Набрать 100 баллов за вариант", 1),
]
EXAM_MIN_SEC_FOR_XP = 20 * 60          # вариант, сданный быстрее, опыта не даёт (иначе его «фармят»)


def task_xp(n):
    """Опыт за задание, решённое впервые: чем сложнее номер, тем больше."""
    n = n or 0
    return 10 + (0 if n <= 10 else 3 if n <= 18 else 5 if n <= 23 else 8 if n <= 25 else 12)


def level_of(xp):
    """Уровень L достигается при 50·L·(L−1) опыта: 100 до 2-го, ещё 200 до 3-го и т. д."""
    lvl = 1
    while 50 * (lvl + 1) * lvl <= xp:
        lvl += 1
    lo, hi = 50 * lvl * (lvl - 1), 50 * (lvl + 1) * lvl
    title = [t for l, t in LEVEL_TITLES if lvl >= l][-1]
    return lvl, title, xp - lo, hi - lo


def game_summary(db, sid, brief=False):
    rows = db.q("""SELECT task_id, grp, n, score, ts, exam FROM attempts WHERE student_id=? ORDER BY ts, id""", (sid,))
    exams = db.q("""SELECT started, finished, primary_score, test_score FROM exams
                    WHERE student_id=? AND finished IS NOT NULL ORDER BY finished""", (sid,))
    week0 = time.time() - 7 * 86400
    xp = week = 0
    solved, failed = set(), set()
    cnt = {k: 0 for k in ("solved", "row", "best_row", "hard", "fix", "night", "early")}
    nums, per_day, days = set(), {}, set()
    got = {}

    def gain(v, ts):
        nonlocal xp, week
        xp += v
        if ts >= week0:
            week += v

    for r in rows:
        if r["exam"]:
            continue
        ts, tid = r["ts"], r["task_id"]
        lt = time.localtime(ts)
        day = time.strftime("%Y-%m-%d", lt)
        days.add(day)
        if r["score"] and r["score"] > 0:
            first_time = tid not in solved
            gain(round(task_xp(r["n"]) * (1 if r["score"] == 1 else 0.5)) if first_time else 2, ts)
            if first_time:
                cnt["solved"] += 1
                solved.add(tid)
                if tid in failed:
                    cnt["fix"] += 1
                if (r["n"] or 0) >= 24:
                    cnt["hard"] += 1
            if r["n"]:
                nums.add(r["n"])
            per_day[day] = per_day.get(day, 0) + 1
            if per_day[day] == 5:
                gain(15, ts)                   # бонус за день: 5 решённых
            if lt.tm_hour >= 23:
                cnt["night"] = 1
            if lt.tm_hour < 7:
                cnt["early"] = 1
            cnt["row"] = cnt["row"] + 1 if r["score"] == 1 else 0
        else:
            failed.add(tid)
            cnt["row"] = 0
        cnt["best_row"] = max(cnt["best_row"], cnt["row"])
        # отметки времени получения достижений
        for aid, val in (("first", cnt["solved"]), ("s10", cnt["solved"]), ("s100", cnt["solved"]), ("s500", cnt["solved"]),
                         ("s1000", cnt["solved"]), ("row10", cnt["best_row"]), ("row25", cnt["best_row"]),
                         ("hard10", cnt["hard"]), ("all27", len(nums)), ("fix20", cnt["fix"]),
                         ("day50", per_day.get(day, 0)), ("night", cnt["night"]), ("early", cnt["early"])):
            if aid not in got and val >= ACH_GOAL[aid]:
                got[aid] = ts
    ex_best = 0
    for e in exams:
        if (e["finished"] - e["started"]) >= EXAM_MIN_SEC_FOR_XP:
            gain(30 + 3 * (e["primary_score"] or 0), e["finished"])
        got.setdefault("exam1", e["finished"])
        ex_best = max(ex_best, e["test_score"] or 0)
        if (e["test_score"] or 0) >= 80:
            got.setdefault("exam80", e["finished"])
        if (e["test_score"] or 0) >= 100:
            got.setdefault("exam100", e["finished"])
    # дни подряд
    run = best = 0
    prev = None
    for d in sorted(days):
        cur = datetime.strptime(d, "%Y-%m-%d").date()
        run = run + 1 if prev and (cur - prev).days == 1 else 1
        prev = cur
        best = max(best, run)
        for aid in ("days7", "days30"):
            if aid not in got and run >= ACH_GOAL[aid]:
                got[aid] = time.mktime(cur.timetuple()) + 43200
    lvl, title, cur_xp, need = level_of(xp)
    out = {"xp": xp, "week": week, "level": lvl, "title": title, "cur": cur_xp, "need": need}
    if brief:
        return out
    prog = {"first": cnt["solved"], "s10": cnt["solved"], "s100": cnt["solved"], "s500": cnt["solved"],
            "s1000": cnt["solved"], "row10": cnt["best_row"], "row25": cnt["best_row"], "hard10": cnt["hard"],
            "all27": len(nums), "fix20": cnt["fix"], "day50": max(per_day.values(), default=0),
            "days7": best, "days30": best, "night": cnt["night"], "early": cnt["early"],
            "exam1": len(exams), "exam80": int(ex_best >= 80), "exam100": int(ex_best >= 100)}
    out["ach"] = [{"id": a, "icon": i, "title": t, "desc": d, "goal": g, "have": min(prog.get(a, 0), g),
                   "got": int(got[a]) if a in got else 0} for a, i, t, d, g in ACHIEVEMENTS]
    return out


ACH_GOAL = {a: g for a, _, _, _, g in ACHIEVEMENTS}


def assignment_done(db, sid, task_ids, since):
    """Задания подборки, которые ученик решил после того, как учитель её выдал (для 19–21 — любую часть)."""
    if not task_ids:
        return set()
    marks = ",".join("?" * len(task_ids))
    rows = db.q(f"""SELECT DISTINCT COALESCE(CASE WHEN grp IN ({marks}) THEN grp END, task_id) AS t FROM attempts
                    WHERE student_id=? AND ts>=? AND score>0 AND (task_id IN ({marks}) OR grp IN ({marks}))""",
                (*task_ids, sid, since or 0, *task_ids, *task_ids))
    return {r["t"] for r in rows}


def to_int(v):
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def to_float(v):
    try:
        x = float(v or 0)
        return x if x == x and abs(x) < 1e12 else 0.0     # без NaN и бесконечности
    except (TypeError, ValueError):
        return 0.0


def quote_rfc(name):
    from urllib.parse import quote
    return quote(name, safe="")


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))


def main():
    global APP
    ap = argparse.ArgumentParser(description="Сервер тренажёра ЕГЭ с журналом для учителя")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0", help="0.0.0.0 — доступен из сети, 127.0.0.1 — только с этого компьютера")
    ap.add_argument("--password", help="задать пароль учителя и выйти")
    ap.add_argument("--invite", help="задать код приглашения для учеников и выйти")
    ap.add_argument("--banks", help="папка, где лежат банки (ege_bank, kompege_bank, …); запоминается")
    args = ap.parse_args()

    db = DB(DB_PATH)
    if not db.setting("invite_code"):
        db.setting("invite_code", DEFAULT_INVITE)
    if args.invite:
        code = re.sub(r"\s+", "", args.invite)
        if not 4 <= len(code) <= 40:
            sys.exit("Код приглашения — от 4 до 40 символов без пробелов")
        db.setting("invite_code", code)
        db.x("UPDATE teachers SET invite=? WHERE is_main=1", (code,))
        print(f"Код приглашения: {code}")
        return
    if args.password:
        if len(args.password) < 6:
            sys.exit("Пароль должен быть не короче 6 символов")
        db.setting("admin_password", hash_pw(args.password))
        db.x("UPDATE teachers SET pw=? WHERE is_main=1", (hash_pw(args.password),))
        print("Пароль главного учителя сохранён (логин admin).")
        return
    global BANKS_ROOT
    if args.banks:
        root = Path(args.banks).expanduser()
        if not root.is_dir():
            sys.exit(f"Папка не найдена: {root}")
        if not any(p.is_dir() and p.name.endswith("_bank") for p in root.iterdir()):
            sys.exit(f"В папке {root} нет папок *_bank (ege_bank, kompege_bank, …). Укажите папку, где они лежат.")
        db.setting("banks_root", str(root.resolve()))
        print(f"Папка с банками запомнена: {root.resolve()}")
    BANKS_ROOT = db.setting("banks_root")
    first_pw = None
    if not db.setting("admin_password"):
        first_pw = secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")
        db.setting("admin_password", hash_pw(first_pw))
        db.x("UPDATE teachers SET pw=? WHERE is_main=1", (hash_pw(first_pw),))
    APP = App()
    if not APP.bank.tasks:
        print("! Банк заданий не найден (data/bank.js). Сначала выполните: python build.py")

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    httpd.daemon_threads = True
    port = args.port
    print("\nТренажёр запущен.")
    print(f"  На этом компьютере:     http://localhost:{port}/")
    if args.host == "0.0.0.0":
        for ip in lan_ips():
            print(f"  Для учеников в сети:    http://{ip}:{port}/")
    print(f"  Панель учителя:         http://localhost:{port}/admin")
    print(f"  Код приглашения:        {db.q('SELECT invite FROM teachers WHERE is_main=1', one=True)['invite']}")
    if first_pw:
        print(f"\n  Пароль учителя: {first_pw}")
        print("  (сохраните его; сменить можно в панели или командой: python server.py --password НОВЫЙ)")
    print("\nОстановить: Ctrl+C\n", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")


if __name__ == "__main__":
    main()
