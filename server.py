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
import random
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import clusters                                   # noqa: E402  тип задания и сложность (clusters.py рядом с сервером)

HERE = Path(__file__).resolve().parent            # папка trainer
BIBLIO = HERE.parent                              # где обычно лежат банки: Biblio/trainer + Biblio/*_bank
BANKS_ROOT = None                                 # папка с банками, заданная вручную (--banks), хранится в базе
DATA_DIR = HERE / "server_data"
DB_PATH = DATA_DIR / "trainer.db"
BANK_JS = HERE / "data" / "bank.js"
EXTRA_BANK = HERE / "data" / "egeshka_bank.json"   # авторский банк Egeshka (tools/gen_egeshka.py) — подмешивается к bank.js

# что можно отдавать из папки trainer
SITE_FILES = {"index.html", "app.js", "style.css", "admin.html", "admin.js", "admin.css", "py-worker.js",
              "terms.html", "privacy.html", "consent.html", "legal.css"}
# редакция документов (соглашение, политика, согласие на обработку ПДн): сменилась — ученик подтверждает заново
LEGAL_VERSION = "2026-10-03"
SITE_DIRS = ("vendor/", "media/")
# расширения файлов к заданиям, которые можно отдавать из банков (json/html — никогда: там ответы)
BANK_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".emf", ".wmf", ".img",
            ".txt", ".csv", ".tsv", ".xlsx", ".xls", ".xlsm", ".ods", ".odt", ".docx", ".doc", ".rtf",
            ".pdf", ".zip", ".rar", ".7z", ".py", ".pas", ".cpp", ".dat"}
MAX_BODY = 4_000_000
ADMIN_SESSION_DAYS = 14
DEFAULT_INVITE = "16082001"        # пригласительный код для учеников (меняется в панели учителя)
STUDENT_COOKIE_DAYS = 30                 # вход живёт месяц с последнего захода
REG_PER_HOUR_IP = 60                     # регистраций в час с одного адреса (класс за одним школьным IP — влезает)
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
ACTIVITY_KINDS = {"away", "shot", "fs", "paste"}   # ушёл со вкладки; клавиши снимка экрана; вышел из полного экрана в варианте; вставил ответ в варианте
SUS_AWAY_SEC = 30                   # «подозрительный верный ответ»: ушёл со страницы хотя бы на столько секунд…
SUS_BACK_SEC = 60                   # …и ответил верно не позже чем через столько секунд после возвращения
ACTIVITY_PER_HOUR = 300
MAX_SOLUTION = 50_000                 # символов в решении (код или текст)
ATTEMPTS_PER_TASK = 2               # попыток на задание; считает сервер, а не страница
CHECKS_PER_TASK_DAY = 6             # ответов на одно задание за сутки (2 попытки × 3 захода): подбор ответа перебором не пройдёт
CHECKS_PER_10MIN = 60               # проверок ответа за 10 минут у ученика — против скриптов
REVEAL_PER_DAY = 40                 # показов ответа за сутки на ученика (кроме лимита в час)
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
def clean_ans(a):
    """Ответ из банка: в КомпЕГЭ перенос строки иногда записан двумя символами «\\n» — делаем настоящим.
    Иначе у №25 и 27 форма ответа строилась неверно, а верный ответ не засчитывался."""
    if not isinstance(a, str):
        return a
    return a.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "").replace("\r\n", "\n").strip()


def tokens(s):
    s = str(s or "").replace("\\n", " ").lower().replace("ё", "е")
    s = re.sub("[−–—]", "-", s)
    return [x for x in re.split(r"[\s;|,]+", s) if x]


# «13992 или 13993» — в банке ФИПИ несколько допустимых ответов: засчитываем любой
ALT_RE = re.compile(r"\s+или\s+", re.I)


def alternatives(ans):
    return [x for x in ALT_RE.split(str(ans or "")) if x.strip()] or [str(ans or "")]


def shape_of(ans, n=None):
    if n == 25 and len(tokens(alternatives(ans)[0])) > 1:
        return {"type": "grid", "rows": 10, "cols": 2}     # №25 на ЕГЭ — всегда таблица 10 × 2
    rows = [tokens(r) for r in alternatives(ans)[0].split("\n")]
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
    верна ровно одна половина — 0.5, на экзамене это 1 балл из 2. «A или B» — верен любой."""
    return max(_credit(n, alt, answer, cells) for alt in alternatives(expected))


def _credit(n, expected, answer, cells=None):
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
_REG_LOG = {}                              # ip -> время регистраций за последний час
_REG_LOCK = threading.Lock()


def reg_allowed(ip, add=False):
    now = time.time()
    with _REG_LOCK:
        if len(_REG_LOG) > 10000:
            for k in [k for k, v in _REG_LOG.items() if not v or v[-1] < now - 3600]:
                del _REG_LOG[k]
        arr = [t for t in _REG_LOG.get(ip, []) if t > now - 3600]
        if add:
            arr.append(now)
        _REG_LOG[ip] = arr
        return len(arr) < REG_PER_HOUR_IP or add


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


class CheckLimit:
    """Сколько ответов ученик отправил на проверку: за 10 минут всего и за сутки на одно задание."""

    def __init__(self):
        self.lock = threading.Lock()
        self.recent = {}                 # sid → [ts, …] за последние 10 минут
        self.per_task = {}               # (sid, task, день) → сколько ответов

    def hit(self, sid, tid):
        """Учесть ещё один ответ. None — можно; иначе текст отказа."""
        now = time.time()
        day = datetime.now().strftime("%Y-%m-%d")
        with self.lock:
            r = [x for x in self.recent.get(sid, []) if now - x < 600]
            if len(r) >= CHECKS_PER_10MIN:
                self.recent[sid] = r
                return "Слишком много ответов подряд — передохни пару минут и решай дальше"
            k = (sid, tid, day)
            if self.per_task.get(k, 0) >= CHECKS_PER_TASK_DAY:
                return "На это задание сегодня ответов уже достаточно — вернись к нему завтра"
            r.append(now)
            self.recent[sid] = r
            self.per_task[k] = self.per_task.get(k, 0) + 1
            if len(self.per_task) > 200000:      # чистим вчерашнее
                for kk in [kk for kk in self.per_task if kk[2] != day]:
                    del self.per_task[kk]
            return None


CHECKS = CheckLimit()


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
FIPI_ICON_RE = re.compile(r'<img\b[^>]*cursor:\s*pointer[^>]*>', re.I)
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


# ---------------------------------------------------------------- общий банк
# Одно правило «задание банка» для всего сайта: тренажёр (app.js: isOutdated), задание дня, турниры, подбор и поиск
# учителя, подборки курса. Менять — вместе с CFG.firstKegeYear и CFG.formatSince в app.js.
FIRST_KEGE_YEAR = 2021                                  # первый компьютерный ЕГЭ — более ранние задания другого формата
FORMAT_SINCE = {6: 2023, 22: 2023, 13: 2024, 27: 2025}  # с какого года номер на ЕГЭ в нынешнем виде


def task_outdated(t):
    """Задание старого формата ЕГЭ: помечено при сборке (fmt) или по году экзамена."""
    if t.get("fmt") == "cur":
        return False
    if t.get("fmt") == "old":
        return True
    y = t.get("y")
    return bool(y) and y < max(FIRST_KEGE_YEAR, FORMAT_SINCE.get(t.get("n"), 0))


def bank_ok(t, authored_ok=True, single=False):
    """Задание общего банка: целиком (вопросы 19–21 — только всей игрой), с ответом, актуального формата.
    single — нужен один ответ (без игры 19–21); authored_ok=False — без авторских задач."""
    if not t or t.get("group") or not t.get("n"):
        return False
    if t.get("parts"):
        if single:
            return False
    elif not t.get("ans"):
        return False
    if task_outdated(t):
        return False
    return authored_ok or not is_authored(t.get("src"), t.get("html"))


def n_key(n):
    """Номер для сводок: 19–21 — одна игра (как в тренажёре)."""
    return 19 if n in (20, 21) else n


def bank_pool(nums=None, **kw):
    """Id заданий общего банка (по номерам nums, если заданы)."""
    return [i for i, t in APP.bank.tasks.items() if (nums is None or t.get("n") in nums) and bank_ok(t, **kw)]

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


# ---------------- №9: таблица → текст, как если бы ученик скопировал её в .txt
try:
    import xlrd                     # старый формат .xls; на сервере: apt install python3-xlrd (необязательно)
except ImportError:
    xlrd = None
TABLE_EXT = (".xlsx", ".ods", ".xls", ".csv")
MAX_TABLE_CELLS = 2_000_000


def _num_text(v):
    """Число как в Excel при копировании: 12.0 → 12."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return str(int(f)) if f.is_integer() and abs(f) < 1e15 else repr(f)


def _xlsx_rows(data):
    import xml.etree.ElementTree as ET
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
        sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        if not sheets:
            return []
        first = "xl/worksheets/sheet1.xml" if "xl/worksheets/sheet1.xml" in sheets else sheets[0]
        root = ET.fromstring(z.read(first))
    rows = []
    for r in root.iter("{%s}row" % ns["m"]):
        row = {}
        for c in r.findall("m:c", ns):
            ref = c.get("r") or ""
            col = 0
            for ch in re.match(r"[A-Z]*", ref).group(0):
                col = col * 26 + ord(ch) - 64
            col = col - 1 if col else len(row)
            t, v = c.get("t"), c.find("m:v", ns)
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % ns["m"]))
            elif v is not None and v.text is not None:
                val = v.text if t in ("str", "e") else _num_text(v.text)
            else:
                val = ""
            row[col] = val
        rows.append([row.get(i, "") for i in range(max(row) + 1)] if row else [])
    return rows


def _ods_rows(data):
    import xml.etree.ElementTree as ET
    T = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    O = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    X = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        root = ET.fromstring(z.read("content.xml"))
    table = next(root.iter("{%s}table" % T), None)
    rows, cells_total = [], 0
    if table is None:
        return rows
    for r in table.iter("{%s}table-row" % T):
        row = []
        for c in r:
            if c.tag not in ("{%s}table-cell" % T, "{%s}covered-table-cell" % T):
                continue
            rep_n = min(int(c.get("{%s}number-columns-repeated" % T, "1")), 1000)
            if c.get("{%s}value" % O) is not None and c.get("{%s}value-type" % O) in ("float", "percentage", "currency"):
                val = _num_text(c.get("{%s}value" % O))
            else:
                val = "\n".join("".join(p.itertext()) for p in c.findall("{%s}p" % X))
            row += [val] * rep_n
        while row and row[-1] == "":
            row.pop()
        rep_r = min(int(r.get("{%s}number-rows-repeated" % T, "1")), 1000)
        rows += [row] * (rep_r if row else 1)
        cells_total += len(row) * rep_r
        if cells_total > MAX_TABLE_CELLS:
            break
    return rows


def _xls_rows(data):
    if xlrd is None:
        return None
    sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
    out = []
    for i in range(sh.nrows):
        out.append([_num_text(c.value) if c.ctype == xlrd.XL_CELL_NUMBER else str(c.value) for c in sh.row(i)])
    return out


def table_to_text(data, ext):
    """Первый лист таблицы — строками, ячейки через табуляцию (как при копировании из Excel). None — не умеем."""
    ext = ext.lower()
    try:
        if ext == ".xlsx":
            rows = _xlsx_rows(data)
        elif ext == ".ods":
            rows = _ods_rows(data)
        elif ext == ".xls":
            rows = _xls_rows(data)
        elif ext == ".csv":
            text = data.decode("utf-8-sig", errors="replace")
            dialect = csv.Sniffer().sniff(text[:4096], delimiters=";,\t") if text.strip() else csv.excel
            rows = list(csv.reader(io.StringIO(text), dialect))
        else:
            return None
    except Exception:
        return None
    if rows is None:
        return None
    while rows and not any(rows[-1]):
        rows.pop()
    for r in rows:
        while r and r[-1] == "":
            r.pop()
    return ("\n".join("\t".join(r) for r in rows) + "\n").encode("utf-8")


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
        self.extra_mtime = None
        self.lock = threading.Lock()
        self.tasks = {}
        self.public_gz = b""
        self.public_raw = b""
        self.etag = ""
        self._snips = {}
        self.missing_dirs = []     # папки банков, на которые ссылаются картинки, но которых нет рядом
        self.titles = {}           # id банка → название («Банк ЕГЭ», «КомпЕГЭ», …)

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
        if n == 9:
            self.add_txt_copy(out, uniq)
        return out

    def add_txt_copy(self, out, uniq):
        """№9: таблицу копируют в .txt и обрабатывают на Python — даём готовый 9.txt из xlsx/ods/xls/csv."""
        if any(o["name"].lower().endswith(".txt") for o in out):
            return
        order = {".xlsx": 0, ".ods": 1, ".xls": 2, ".csv": 3}
        best = None
        for o in out:
            ext = os.path.splitext(o["name"])[1].lower()
            if ext not in order or (ext == ".xls" and xlrd is None):
                continue
            tok = o["href"].split("/")[1] if o["href"].startswith("files/") else None
            target = self.files.get(tok)
            if target and (best is None or order[ext] < best[0]):
                best = (order[ext], ext, target)
        if not best:
            return
        _, ext, (href, member) = best
        nm = uniq("9.txt")
        out.append({"name": nm, "href": self.file_url(f"{href}#{member}#txt", nm, (href, member, ext))})

    def public_html(self, h):
        h = SOURCE_LINK_RE.sub(r"\1", h or "")
        h = REMOTE_ATTR_RE.sub("", h)
        # ссылки на распакованные архивы в тексте не нужны — файлы и так лежат под заданием
        h = LOCAL_ZIP_LINK_RE.sub(lambda m: m.group(2) if m.group(1) in self.zipped else m.group(0), h)
        # значок «скачать» с сайта ФИПИ (был внутри ссылки на архив) — без ссылки он не нужен
        h = FIPI_ICON_RE.sub("", h)

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
        try:
            xmt = EXTRA_BANK.stat().st_mtime
        except OSError:
            xmt = None
        if mt == self.mtime and xmt == self.extra_mtime:
            return True
        with self.lock:
            if mt == self.mtime and xmt == self.extra_mtime:
                return True
            text = self.path.read_text(encoding="utf-8")
            start = text.index("{")
            end = text.rindex("}")
            data = json.loads(text[start:end + 1])
            if xmt is not None:
                try:
                    extra = json.loads(EXTRA_BANK.read_text(encoding="utf-8"))
                    data["tasks"] = data.get("tasks", []) + extra.get("tasks", [])
                    data["banks"] = [b for b in data.get("banks", []) if b.get("id") != extra["bank"]["id"]] + [extra["bank"]]
                except (ValueError, KeyError, OSError) as e:
                    print(f"! Банк Egeshka не прочитан ({EXTRA_BANK.name}): {e}", flush=True)
            self.tasks = {}
            self._snips = {}
            self.files = {}
            self.zipped = set()
            self.broken = []
            self.authored = 0
            pub_tasks = []
            clusters.annotate(data.get("tasks", []))   # тип задания внутри номера (c) и сложность 1–5 (r)
            self.titles = {b.get("id"): b.get("title") for b in data.get("banks", [])}
            for t in data.get("tasks", []):
                if "ans" in t:
                    t["ans"] = clean_ans(t["ans"])
                for part in t.get("parts") or []:
                    if "ans" in part:
                        part["ans"] = clean_ans(part["ans"])
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
                    p["sh"] = shape_of(t.get("ans", ""), t.get("n"))
                    if t.get("sol"):
                        p["hasSol"] = True
                pub_tasks.append(p)
            pub = dict(data, tasks=pub_tasks, srv=True, clusters=clusters.catalog())
            raw = ("window.EGE_BANK = " + json.dumps(pub, ensure_ascii=False, separators=(",", ":")) + ";\n").encode("utf-8")
            self.public_raw = raw
            self.public_gz = gzip.compress(raw, 6)
            self.etag = '"%s"' % hashlib.md5(raw).hexdigest()[:16]   # меняется при любом изменении банка или его обработки
            self.mtime = mt
            self.extra_mtime = xmt
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
            CREATE TABLE IF NOT EXISTS asg_runs(
                asg_id INTEGER NOT NULL, student_id INTEGER NOT NULL, started REAL, finished REAL, last REAL,
                answers TEXT, result TEXT, correct REAL, total INTEGER, pct INTEGER, grade INTEGER,
                forced INTEGER DEFAULT 0, away INTEGER DEFAULT 0, fs INTEGER DEFAULT 0, xp INTEGER, PRIMARY KEY(asg_id, student_id));
            CREATE TABLE IF NOT EXISTS asg_events(
                id INTEGER PRIMARY KEY, asg_id INTEGER NOT NULL, student_id INTEGER NOT NULL, ts REAL NOT NULL, kind TEXT NOT NULL, info TEXT);
            CREATE INDEX IF NOT EXISTS asg_events_ts ON asg_events(ts);
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
            -- соревнования: лиги, задание дня, дуэли, переходы опыта
            CREATE TABLE IF NOT EXISTS leagues(
                student_id INTEGER PRIMARY KEY, league INTEGER NOT NULL DEFAULT 0, week TEXT,
                result TEXT, result_place INTEGER, result_league INTEGER, result_week TEXT);
            CREATE TABLE IF NOT EXISTS daily_results(
                day TEXT NOT NULL, student_id INTEGER NOT NULL, task_id TEXT, ms INTEGER, ts REAL, PRIMARY KEY(day, student_id));
            CREATE TABLE IF NOT EXISTS course_seen(
                student_id INTEGER NOT NULL, n INTEGER NOT NULL, slide INTEGER, total INTEGER, ts REAL, PRIMARY KEY(student_id, n));
            CREATE TABLE IF NOT EXISTS visits(
                day TEXT NOT NULL, vid TEXT NOT NULL, ts REAL, PRIMARY KEY(day, vid));
            CREATE TABLE IF NOT EXISTS daily_starts(
                day TEXT NOT NULL, student_id INTEGER NOT NULL, ts REAL, PRIMARY KEY(day, student_id));
            CREATE TABLE IF NOT EXISTS duels(
                id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL, tasks TEXT NOT NULL, created REAL,
                status TEXT NOT NULL DEFAULT 'pending', accepted REAL, a_start REAL, b_start REAL, a_done REAL, b_done REAL,
                a_solved INTEGER, b_solved INTEGER, winner INTEGER, stake INTEGER, finished REAL);
            CREATE TABLE IF NOT EXISTS awards(
                student_id INTEGER NOT NULL, kind TEXT NOT NULL, week TEXT NOT NULL, info INTEGER, PRIMARY KEY(student_id, kind, week));
            CREATE TABLE IF NOT EXISTS tournaments(
                id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL, size INTEGER NOT NULL, title TEXT, status TEXT NOT NULL,
                created REAL, started REAL, finished REAL, round INTEGER DEFAULT 0, round_ends REAL);
            CREATE INDEX IF NOT EXISTS tour_teacher ON tournaments(teacher_id, status);
            CREATE TABLE IF NOT EXISTS tour_players(
                tour_id INTEGER NOT NULL, student_id INTEGER NOT NULL, seed INTEGER, joined REAL, place INTEGER, xp INTEGER,
                PRIMARY KEY(tour_id, student_id));
            CREATE TABLE IF NOT EXISTS tour_matches(
                id INTEGER PRIMARY KEY, tour_id INTEGER NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL,
                a INTEGER, b INTEGER, tasks TEXT, a_start REAL, b_start REAL, a_done REAL, b_done REAL,
                a_solved INTEGER, b_solved INTEGER, a_sec REAL, b_sec REAL, winner INTEGER, tech INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'play', ends REAL);
            CREATE INDEX IF NOT EXISTS tour_match_t ON tour_matches(tour_id, round);
            CREATE TABLE IF NOT EXISTS support(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, ts REAL NOT NULL, kind TEXT, text TEXT NOT NULL,
                task TEXT, page TEXT, status TEXT NOT NULL DEFAULT 'new', answer TEXT, answered REAL, seen INTEGER DEFAULT 1);
            CREATE INDEX IF NOT EXISTS support_student ON support(student_id);
            CREATE TABLE IF NOT EXISTS xp_adjust(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, ts REAL NOT NULL, delta INTEGER NOT NULL, reason TEXT);
            CREATE INDEX IF NOT EXISTS xp_adjust_student ON xp_adjust(student_id);
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
                    ("attempts", "away_sec", "REAL"),      # сколько секунд всего был вне страницы, пока решал
                    ("attempts", "flags", "TEXT"),         # отметки через запятую: sus — ушёл и сразу верно, paste — ответ вставлен
                    ("students", "teacher_id", "INTEGER"), # учитель, по чьему коду зарегистрировался; NULL — главный
                    ("classes", "teacher_id", "INTEGER"),
                    ("admin_sessions", "teacher_id", "INTEGER"),
                    ("classes", "goal_tasks", "INTEGER"),  # цель класса на неделю (заданий) — битва классов
                    ("classes", "goal_reward", "TEXT"),    # награда за цель, её задаёт учитель
                    ("classes", "battle", "INTEGER DEFAULT 0"),    # участвует ли класс в битве классов (решает учитель)
                    ("students", "course", "INTEGER DEFAULT 0"),   # открыт ли курс (ввёл пароль курса)
                    ("students", "course_ts", "REAL"),
                    ("students", "is_teacher", "INTEGER DEFAULT 0"),
                    ("students", "badges", "TEXT"),
                    ("assignments", "strict", "INTEGER DEFAULT 0"),   # контрольная: одна попытка, результат — после сдачи
                    ("assignments", "closed", "REAL"),                # учитель завершил контрольную для всех
                    ("assignments", "grading", "TEXT"),              # пороги оценки в процентах {"5": 85, "4": 65, "3": 45}
                    ("asg_runs", "xp", "INTEGER"),
                    ("assignments", "kind", "TEXT"),
                    ("students", "dev", "INTEGER DEFAULT 0"),
                    ("exams", "tasks", "TEXT"),                       # задания варианта, выданные сервером
                    ("assignments", "student_id", "INTEGER"),         # личная подборка ученика; NULL — всему классу
                    ("students", "role", "TEXT"),                     # admin — золотая плашка 👑 admin рядом с именем
                    ("students", "consent_ver", "TEXT"),              # какую редакцию документов принял
                    ("students", "consent_ts", "REAL"),               # когда принял
                    ("students", "consent_ip", "TEXT"),               # с какого адреса
                    ("assignments", "batch", "TEXT"),                 # серия личных подборок: fix:<id> — работа над ошибками, weak:<ts>
                    ("tournaments", "fmt", "INTEGER DEFAULT 0"),      # 2 — с групповым этапом
                    ("tour_players", "grp", "TEXT"),
                    ("tour_matches", "kind", "TEXT"),                 # group, po, final, third
                    ("tour_matches", "grp", "TEXT")):        # открыл разделы «в разработке» (турнир) по коду                 # тип работы: self — самостоятельная, practice, home                    # сколько опыта принесла контрольная
                if col not in {r[1] for r in c.execute(f"PRAGMA table_info({table})")}:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
            # любая подборка учителя — контрольная (одна попытка, результат после сдачи); прежние тоже переводим
            # тип работы: прежние подборки — самостоятельные; «строгий» режим (проверка после сдачи) — только у них
            # турниры прежнего формата (без групп) закрываются, наборы — пересоздаются в новом
            c.execute("UPDATE tournaments SET status='void' WHERE COALESCE(fmt, 0) < 2 AND status IN ('reg', 'run')")
            # плашка admin владельцу сайта (Malevin D.) — один раз; дальше выдаёт и снимает главный учитель в карточке ученика
            if not c.execute("SELECT 1 FROM settings WHERE key='admin_badge_seeded'").fetchone():
                c.execute("""UPDATE students SET role='admin' WHERE COALESCE(is_teacher, 0) = 0
                             AND (name_key LIKE 'malevin d%' OR name_key LIKE 'малевин д%')""")
                c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('admin_badge_seeded', '1')")
            c.execute("DELETE FROM settings WHERE key='metrika_id'")     # Яндекс Метрика убрана с сайта
            c.execute("UPDATE assignments SET kind='self' WHERE kind IS NULL")
            c.execute("UPDATE assignments SET strict = CASE WHEN kind='self' THEN 1 ELSE 0 END")
            # «быстрее минуты — минус опыт» действует с первого запуска новой версии, задним числом опыт не отнимаем
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('fast_xp_since', ?)", (str(time.time()),))
            # «перерешал уже решённое — без опыта и огонька» действует на всю историю: нафармленное повторами снимаем
            c.execute("DELETE FROM settings WHERE key='repeat_rule_since'")
            # лазейка «подборка по кругу» закрыта этой версией: опыт нарушителей срезается до этого момента
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('asg_exploit_fixed', ?)", (str(time.time()),))
            # награды лиг до появления таблицы наград — из итогов последней недели
            c.execute("""INSERT OR IGNORE INTO awards(student_id, kind, week, info)
                         SELECT student_id, 'up', result_week, result_league FROM leagues WHERE result='up' AND result_week IS NOT NULL""")
            c.execute("""INSERT OR IGNORE INTO awards(student_id, kind, week, info)
                         SELECT student_id, 'league1', result_week, result_league FROM leagues
                         WHERE result_place=1 AND result IN ('up', 'stay') AND result_week IS NOT NULL""")
            # главный учитель: прежние пароль, код приглашения и настройка авторских заданий переходят к нему
            if not c.execute("SELECT 1 FROM teachers WHERE is_main=1").fetchone():
                get = lambda k: (c.execute("SELECT value FROM settings WHERE key=?", (k,)).fetchone() or [None])[0]
                c.execute("""INSERT INTO teachers(name, login, pw, invite, is_main, authored, created)
                             VALUES('Главный учитель', 'admin', ?, ?, 1, ?, ?)""",
                          (get("admin_password"), get("invite_code") or DEFAULT_INVITE, 0 if get("authored") == "0" else 1, time.time()))
                main_id = c.execute("SELECT id FROM teachers WHERE is_main=1").fetchone()[0]
                c.execute("INSERT OR IGNORE INTO tsolutions(teacher_id, task_id, text, ts) SELECT ?, task_id, text, ts FROM teacher_solutions",
                          (main_id,))
            # прежние версии записывали нетронутые задания варианта как ошибки — убираем их из журнала
            c.execute("DELETE FROM attempts WHERE reason='exam' AND answers='[]'")
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

    def xn(self, sql, args=()):
        """Как x, но возвращает число изменённых строк."""
        with self.lock:
            cur = self.conn.execute(sql, args)
            self.conn.commit()
            return cur.rowcount

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
        self.send_header("X-Frame-Options", "SAMEORIGIN")      # чужой сайт не встроит тренажёр в рамку (кликджекинг)
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
    def count_visit(self):
        """Посетитель сайта за день — обезличенно: хеш адреса и браузера с датой, сам адрес не храним."""
        try:
            day = datetime.now().strftime("%Y-%m-%d")
            raw = f"{day}|{self.client_ip()}|{self.headers.get('User-Agent') or ''}"
            APP.db.x("INSERT OR IGNORE INTO visits(day, vid, ts) VALUES(?,?,?)",
                     (day, hashlib.sha256(raw.encode()).hexdigest()[:20], time.time()))
        except Exception as e:           # счётчик не должен мешать открыть сайт
            self.log_error_safe(e)

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
        if rel == "index.html":
            self.count_visit()
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
        # путь на диске показываем только тому, кто открыл сайт на самом этом компьютере, — не в интернет
        local = self.client_address[0] in ("127.0.0.1", "::1") and not self.headers.get("X-Forwarded-For")
        where = (f"<p>Сервер искал его здесь: <code>{_h.escape(str(disk_path))}</code></p>"
                 if disk_path is not None and local else "")
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
        href, member = target[0], target[1]
        as_text = target[2] if len(target) > 2 else None      # №9: таблица, отдаём текстом
        p = APP.bank.ref_path(href)
        if not p or not p.is_file():
            return self.not_found(p or href)
        name = unquote(parts[-1])
        if member is None and not as_text:
            return self.serve_file(p.parent, p.name, download_name=name)
        try:
            if member is None:
                if p.stat().st_size > MAX_ZIP_MEMBER:
                    return self.not_found(p)
                body = p.read_bytes()
            else:
                with zipfile.ZipFile(p) as z:
                    info = z.getinfo(member)
                    if info.file_size > MAX_ZIP_MEMBER:
                        return self.not_found(p)
                    body = z.read(info)
        except (KeyError, zipfile.BadZipFile, OSError):
            return self.not_found(p)
        if as_text:
            body = table_to_text(body, as_text)
            if body is None:
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
        # «Чужой компьютер» (заголовок X-Temp): cookie без срока — сотрётся, когда закроют браузер
        life = "" if self.headers.get("X-Temp") == "1" else f"; Max-Age={STUDENT_COOKIE_DAYS * 86400}"
        return f"egest={token}; Path=/; HttpOnly; SameSite=Lax{life}{self.cookie_attrs()}"

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
                    part=None, revealed=0, spent=None, exam=None, away=None, st=None):
        away_sec = flags = None
        if st:
            away_sec = st.get("away_sec") or None
            fl = []
            if score > 0 and st.get("back_sec") is not None and st["back_sec"] <= SUS_BACK_SEC:
                fl.append("sus")
            if st.get("paste"):
                fl.append("paste")
            flags = ",".join(fl) or None
        return APP.db.x("""INSERT INTO attempts(student_id,ts,task_id,n,bank,answers,correct,score,gave_up,abandoned,
                                               spent_ms,reason,rk,part,grp,revealed,exam,ip,away,away_sec,flags)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (s["id"], time.time(), t["id"], t.get("n"), t.get("bank"), json.dumps(answers, ensure_ascii=False),
                         t.get("ans", ""), score, int(gave_up), int(abandoned), spent, reason, rk, part,
                         t.get("group"), int(revealed), exam, self.client_ip(), away or None, away_sec, flags))

    def daily_result(self, s, t, st):
        """Задание дня решено с первой попытки: в рейтинг — только первый заход за день,
        время — от первого открытия (зашёл, вышел и вернулся — часы не сбрасываются)."""
        now = datetime.now()
        day = now.strftime("%Y-%m-%d")
        since = datetime(now.year, now.month, now.day).timestamp()
        if APP.db.q("SELECT 1 FROM attempts WHERE student_id=? AND task_id=? AND ts>=? LIMIT 1",
                    (s["id"], t["id"], since), one=True):
            return                           # сегодня уже была попытка — это не первый заход
        start = APP.db.q("SELECT ts FROM daily_starts WHERE day=? AND student_id=?", (day, s["id"]), one=True)
        t0 = min(st["ts"], start["ts"]) if start else st["ts"]
        APP.db.x("INSERT OR IGNORE INTO daily_results(day, student_id, task_id, ms, ts) VALUES(?,?,?,?,?)",
                 (day, s["id"], t["id"], int((time.time() - t0) * 1000), time.time()))

    def reveal_block(self, s, t, st):
        """None — ответ можно показать; иначе {"why": "think"|"limit", "wait": секунд}."""
        now = time.time()
        wait = math.ceil(st["ts"] + think_sec(t.get("n")) - now)
        if wait > 0:
            return {"why": "think", "wait": wait}
        day = APP.db.q("SELECT COUNT(*) AS c, MIN(ts) AS t0 FROM reveal_log WHERE student_id=? AND granted=1 AND ts>?",
                       (s["id"], now - 86400), one=True)
        if day["c"] >= REVEAL_PER_DAY:
            return {"why": "limit", "wait": max(60, math.ceil(day["t0"] + 86400 - now)), "per_hour": REVEAL_PER_HOUR}
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
                "py_local": (HERE / "vendor" / "pyodide" / "pyodide.js").is_file(),
                "repeat_since": 0}

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
                "game": game_summary(APP.db, s["id"]), "class_id": s["class_id"], "course": course_open(s),
                "teacher": bool(s["is_teacher"]),
                "consent_needed": not s["is_teacher"] and s["consent_ver"] != LEGAL_VERSION,
                "admins": [r["id"] for r in APP.db.q("SELECT id FROM students WHERE role='admin'")]}

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
        """Каждый учитель — и главный тоже — видит только своих учеников; у главного по остальным — общая статистика."""
        r = APP.db.q("SELECT teacher_id, is_teacher FROM students WHERE id=?", (sid,), one=True)
        return bool(r) and not r["is_teacher"] and (r["teacher_id"] or main_teacher()["id"]) == self.T["id"]

    def sees_class(self, cid):
        """Классы — только свои: главный учитель тоже не видит классы других учителей."""
        r = APP.db.q("SELECT teacher_id FROM classes WHERE id=?", (cid,), one=True)
        return bool(r) and (r["teacher_id"] or main_teacher()["id"]) == self.T["id"]

    def student_scope(self, alias="s"):
        """Условие SQL на учеников этого учителя (без учительских аккаунтов) и его параметры."""
        return (f"COALESCE({alias}.teacher_id, ?) = ? AND COALESCE({alias}.is_teacher, 0) = 0",
                (main_teacher()["id"], self.T["id"]))

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
                if not data.get("consent"):
                    return self.err(400, "Чтобы зарегистрироваться, примите соглашение и дайте согласие на обработку персональных данных")
                if not s:
                    if not reg_allowed(ip):
                        return self.err(429, "С этого адреса за час зарегистрировалось слишком много учеников. Попробуйте позже.")
                    reg_allowed(ip, add=True)
                    db.x("INSERT INTO students(name,name_key,token,created,last_seen,pw,teacher_id) VALUES(?,?,?,?,?,?,?)",
                         (pretty, key, secrets.token_urlsafe(24), now, now, hash_pw(pw), teacher["id"]))
                    print(f"[ученик] новый: {pretty}", flush=True)
                else:                                  # старый ученик без пароля: журнал сохраняется
                    db.x("UPDATE students SET pw=?, teacher_id=COALESCE(teacher_id, ?) WHERE id=?", (hash_pw(pw), teacher["id"], s["id"]))
                    print(f"[ученик] задал пароль: {s['name']}", flush=True)
                s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
                db.x("UPDATE students SET consent_ver=?, consent_ts=?, consent_ip=? WHERE id=?", (LEGAL_VERSION, now, ip, s["id"]))
                s = db.q("SELECT * FROM students WHERE id=?", (s["id"],), one=True)
            db.x("UPDATE students SET last_seen=?, last_ip=? WHERE id=?", (now, ip, s["id"]))
            return self.send_json(self.me_payload(s), extra={"Set-Cookie": self.student_cookie(s["token"])})

        if path == "/api/consent" and method == "POST":
            # уже зарегистрированный ученик принимает (новую редакцию) документов
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not data.get("accept"):
                return self.err(400, "Отметьте обе галочки")
            db.x("UPDATE students SET consent_ver=?, consent_ts=?, consent_ip=? WHERE id=?",
                 (LEGAL_VERSION, time.time(), self.client_ip(), s["id"]))
            return self.send_json({"ok": True, "version": LEGAL_VERSION})

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
            # вход по сохранённому в браузере токену продлевает cookie; вход по одной cookie её срок не трогает
            # (иначе вкладка без «Чужого компьютера» сделала бы временный вход постоянным)
            extra = {"Set-Cookie": self.student_cookie(s["token"])} if self.headers.get("X-Token") else None
            return self.send_json(self.me_payload(s), extra=extra)

        if path == "/api/course/lesson":
            # презентация урока — только тем, у кого курс открыт паролем (файлы course/ напрямую не раздаются)
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not course_open(s):
                return self.err(403, "курс закрыт")
            n = to_int(qs.get("n"))
            f = HERE / "course" / f"{n}.json"
            if not (n and 1 <= n <= 27 and f.is_file()):
                return self.send_json({"n": n, "slides": []})
            try:
                return self.send_json(json.loads(f.read_text(encoding="utf-8")))
            except ValueError:
                return self.err(500, "презентация повреждена")

        if path == "/api/course/sets":
            # состав подборок курса (по 20 заданий) — собирает сервер по кластерам, одинаково для ученика и учителя
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not course_open(s):
                return self.err(403, "курс закрыт")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            sets = course_sets_all(bool(teacher_of(s)["authored"]))
            pid = APP.bank.pid
            return self.send_json({"sets": {n: {k: [pid(i) for i in ids] for k, ids in v.items()} for n, v in sets.items()}})

        if path == "/api/course/seen" and method == "POST":
            # докуда ученик долистал презентацию урока — учитель видит в прогрессе курса
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            n, sl, tot = to_int(data.get("n")), to_int(data.get("slide")), to_int(data.get("total"))
            if not (n and 1 <= n <= 27 and sl and 0 < sl <= (tot or 0) <= 200):
                return self.err(400, "неверные данные")
            db.x("""INSERT INTO course_seen(student_id, n, slide, total, ts) VALUES(?,?,?,?,?)
                    ON CONFLICT(student_id, n) DO UPDATE SET slide=MAX(slide, excluded.slide), total=excluded.total, ts=excluded.ts""",
                 (s["id"], n, sl, tot, time.time()))
            return self.send_json({"ok": True})

        if path == "/api/course/unlock" and method == "POST":
            # курс — по паролю от учителя; попыток немного, чтобы пароль не подбирали
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if course_open(s):
                return self.send_json({"ok": True})
            stored = db.setting("course_pw")
            if not stored:
                return self.err(403, "Учитель ещё не открыл курс")
            now = time.time()
            with _COURSE_LOCK:
                tries = [t for t in _COURSE_TRIES.get(s["id"], []) if now - t < COURSE_WINDOW]
                if len(tries) >= COURSE_TRIES:
                    return self.err(429, f"Слишком много попыток — попробуйте через {int((COURSE_WINDOW - (now - tries[0])) // 60) + 1} мин")
                tries.append(now)
                _COURSE_TRIES[s["id"]] = tries
            if not check_pw(str(data.get("password") or "")[:200], stored):
                return self.err(403, "Неверный пароль курса")
            db.x("UPDATE students SET course=1, course_ts=? WHERE id=?", (time.time(), s["id"]))
            return self.send_json({"ok": True})

        if path == "/api/history":
            # Прогресс ученика страница восстанавливает из журнала попыток — один источник правды
            # для всех устройств, и подправить его в браузере нельзя.
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            APP.bank.ensure()
            rows = db.q("""SELECT task_id, n, score, ts, reason, rk, part, grp, exam, answers, revealed, spent_ms FROM attempts
                           WHERE student_id=? ORDER BY ts, id""", (s["id"],))
            skips = reward_skips(rows, fast_xp_since(db))
            tasks, pid = APP.bank.tasks, APP.bank.pid
            # [id, n, score, ts, reason, rk, part, grp, exam, пустой ответ в варианте, не засчитан]; id — открытые коды
            h = []
            for r, skip in zip(rows, skips):
                grp = r["grp"] or (tasks.get(r["task_id"]) or {}).get("group") or ""
                h.append([pid(r["task_id"]), r["n"], r["score"], int(r["ts"] * 1000), r["reason"] or "",
                          r["rk"] or "", r["part"], pid(grp) if grp else "", 1 if r["exam"] else 0,
                          1 if r["exam"] and r["answers"] in (None, "", "[]") else 0, 1 if skip else 0])
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
            if path in ("/api/check", "/api/reveal") and strict_locked(db, s, t.get("group") or t["id"]):
                return self.err(403, "Это задание из самостоятельной работы — ответ сдаётся в ней")
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
                asg_expire(self, db, s["class_id"])
                for a in db.q("""SELECT * FROM assignments WHERE class_id=? AND (student_id IS NULL OR student_id=?)
                                 ORDER BY created DESC""", (s["class_id"], s["id"])):
                    real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
                    item = {"id": a["id"], "title": a["title"], "due": a["due"], "created": a["created"],
                            "kind": a["kind"] or "self", "tasks": [APP.bank.pid(i) for i in real],
                            "closed": a["closed"], "personal": a["batch"].split(":")[0] if a["batch"] else None}
                    if a["strict"]:
                        real = asg_order(real, a["id"], s["id"])      # у каждого ученика свой порядок заданий
                        item["tasks"] = [APP.bank.pid(i) for i in real]
                        item.update(asg_run_public(db, a, s["id"], real))
                    else:
                        done = assignment_done(db, s["id"], real, a["created"])
                        item["done"] = [APP.bank.pid(i) for i in real if i in done]
                        item["score"] = practice_score(db, a, s["id"], real)      # практическая и домашняя: оценка сама
                    out.append(item)
            return self.send_json({"assignments": out, "in_class": bool(s["class_id"])})

        if path.startswith("/api/asg/"):
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            APP.bank.ensure()
            return self.api_strict(s, path, method, data, qs)

        if path in ("/api/profile", "/api/profile/badges"):
            # профиль ученика: награды и достижения. Смотреть можно своих и учеников того же учителя
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            mates = {m["id"]: m for m in teacher_students(db, teacher_of(s)["id"])}
            ids = list(set(mates) | {s["id"]})
            if path == "/api/profile/badges":
                if method != "POST":
                    return self.err(405, "нужен POST")
                keys = data.get("keys")
                if keys is not None:
                    if not isinstance(keys, list):
                        return self.err(400, "неверный список")
                    g = game_summary(db, s["id"])
                    opts = badge_options(db, s["id"], g, league_row(db, s["id"])["league"], crown_counts(db, ids), g["ach"])
                    keys = list(dict.fromkeys(str(k) for k in keys))
                    if len(keys) > BADGES_MAX:
                        return self.err(400, f"не больше {BADGES_MAX} значков")
                    if any(k not in opts for k in keys):
                        return self.err(400, "такой награды у тебя нет")
                db.x("UPDATE students SET badges=? WHERE id=?", (None if keys is None else json.dumps(keys), s["id"]))
                with _GS_LOCK:
                    _LB_PEOPLE.pop(teacher_of(s)["id"], None)
                return self.send_json({"ok": True, "badges": keys})
            sid = to_int(qs.get("sid")) or s["id"]
            m = s if sid == s["id"] else mates.get(sid)
            if not m:
                return self.err(404, "Профиль не найден — смотреть можно только учеников своего учителя")
            g = game_summary(db, sid)
            lg = league_row(db, sid)["league"]
            crowns = crown_counts(db, ids)
            opts = badge_options(db, sid, g, lg, crowns, g["ach"])
            cnt = award_counts(db, sid, crowns)
            awards = [{"k": k, "i": i, "t": t, "d": d, "n": cnt.get(k, 0)} for k, i, t, d in AWARDS]
            ach = [{"k": "a:" + a["id"], "i": a["icon"], "t": a["title"], "d": a["desc"]} for a in g["ach"] if a["got"]]
            chosen = chosen_badges(m)
            return self.send_json({
                "sid": sid, "me": sid == s["id"], "name": short_name(m["name"]) if sid != s["id"] else m["name"],
                "level": g["level"], "title": g["title"], "xp": g["xp"], "fire": g["fire"],
                "league": {"idx": lg, "name": LEAGUES[lg][0], "icon": LEAGUES[lg][1]},
                "awards": awards, "ach": ach, "ach_total": len(ACHIEVEMENTS),
                "extra": [dict(opts[k], k=k) for k in ("fire", "diamond") if k in opts],
                "badges": nick_badges(db, m, game_summary(db, sid, brief=True), lg, daily_crown(db, ids), crowns),
                "chosen": chosen, "max": BADGES_MAX})

        if path == "/api/leaderboard":
            # рейтинги среди учеников того же учителя: лига недели, ТОП-10 за день/неделю/месяц, огонёк, классы
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            league_rollover(db)
            tid = teacher_of(s)["id"]
            # список учеников учителя собираем не чаще раза в LB_TTL секунд (рейтинг перезапрашивают после каждого ответа),
            # а свою строку ученик всегда видит свежей
            with _GS_LOCK:
                hit = _LB_PEOPLE.get(tid)
            if hit and time.time() - hit[0] < LB_TTL:
                base = hit[1]
            elif hit and not _LB_BUILD.acquire(blocking=False):
                base = hit[1]                   # список уже пересобирает другой запрос — пока отдаём прежний
            else:
                if not hit:
                    _LB_BUILD.acquire()         # первый раз — ждём, пока соберёт кто-то один (при hit замок уже взят выше)
                try:
                    with _GS_LOCK:
                        hit2 = _LB_PEOPLE.get(tid)
                    if hit2 and time.time() - hit2[0] < LB_TTL:
                        base = hit2[1]
                    else:
                        mates = teacher_students(db, tid)
                        crown = daily_crown(db, [m["id"] for m in mates])
                        crowns = crown_counts(db, [m["id"] for m in mates])
                        base = [lb_person(db, m, crown, crowns) for m in mates]
                        with _GS_LOCK:
                            _LB_PEOPLE[tid] = (time.time(), base)
                finally:
                    _LB_BUILD.release()
            ids = [p["sid"] for p in base if p["sid"] != s["id"]] + [s["id"]]
            mine = lb_person(db, s, daily_crown(db, ids), crown_counts(db, ids))
            spectator = bool(s["is_teacher"])          # учитель смотрит рейтинг, но сам в нём не участвует
            my_row = dict(mine, me=True)
            people = [dict(p, me=False) for p in base if p["sid"] != s["id"]] + ([] if spectator else [my_row])
            pub = lambda p, key, place: {"place": place, "sid": p["sid"], "name": p["name"], "me": p["me"], "level": p["level"],
                                         "badges": p["badges"], "value": p[key]}
            boards = {}
            for key in ("day", "week", "month", "fire"):
                ranked = sorted((p for p in people if p[key] > 0), key=lambda p: (-p[key], p["name"]))
                mine = next(({"place": i + 1, "value": p[key]} for i, p in enumerate(ranked) if p["me"]), None)
                boards[key] = {"top": [pub(p, key, i + 1) for i, p in enumerate(ranked[:10])], "me": mine, "total": len(ranked)}
            # лига: все из моей лиги, по опыту с понедельника
            me = next((p for p in people if p["me"]), dict(my_row, league=0))
            lr = league_row(db, s["id"])
            members = sorted((p for p in people if p["league"] == me["league"]), key=lambda p: (-p["wk"], p["name"]))
            n = len(members)
            result = None
            if lr["result"] and lr["result_week"] and lr["week"] == week_key():
                result = {"result": lr["result"], "place": lr["result_place"], "from": lr["result_league"],
                          "week": lr["result_week"]}
            boards["league"] = {
                "idx": me["league"], "name": LEAGUES[me["league"]][0], "icon": LEAGUES[me["league"]][1],
                "top": [pub(p, "wk", i + 1) for i, p in enumerate(members[:LEAGUE_SHOW])],
                "me": next(({"place": i + 1, "value": p["wk"]} for i, p in enumerate(members) if p["me"]), None),
                "total": n, "up": LEAGUE_UP[me["league"]],
                "down": LEAGUE_DOWN if me["league"] > 0 and n >= league_min_demote(me["league"]) else 0,
                "ends": week_start() + 7 * 86400, "result": result, "week": week_key()}
            # все лиги — посмотреть, кто в других и сколько опыта у лидеров (своя строка «me» — только в своей)
            others = []
            for i, (lname, licon) in enumerate(LEAGUES):
                mem = sorted((p for p in people if p["league"] == i), key=lambda p: (-p["wk"], p["name"]))
                others.append({"idx": i, "name": lname, "icon": licon, "total": len(mem),
                               "top": [pub(p, "wk", k + 1) for k, p in enumerate(mem[:LEAGUE_SHOW])],
                               "up": LEAGUE_UP[i],
                               "down": LEAGUE_DOWN if i > 0 and len(mem) >= league_min_demote(i) else 0})
            boards["leagues"] = others
            # битва классов: опыт класса с понедельника и цель по решённым заданиям
            wk0 = week_start()
            classes = []
            for c in db.q("SELECT id, name, goal_tasks, goal_reward FROM classes WHERE COALESCE(teacher_id, ?) = ? AND battle = 1",
                          (main_teacher()["id"], teacher_of(s)["id"])):
                cm = [p for p in people if p["class_id"] == c["id"]]
                if not cm:
                    continue
                ids = [p["sid"] for p in cm]
                solved = db.q(f"SELECT COUNT(*) AS c FROM attempts WHERE score>0 AND ts>=? AND student_id IN ({','.join('?' * len(ids))})",
                              (wk0, *ids), one=True)["c"]
                classes.append({"name": c["name"], "xp": sum(p["wk"] for p in cm), "members": len(cm), "solved": solved,
                                "goal": c["goal_tasks"] or 0, "reward": c["goal_reward"] or "", "mine": c["id"] == s["class_id"]})
            classes.sort(key=lambda c: -c["xp"])
            boards["classes"] = {"list": classes}
            return self.send_json({"boards": boards, "spectator": spectator})

        if path == "/api/daily":
            # задание дня: одно на всех; рейтинг по времени решения с первой попытки (время считает сервер)
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            day = datetime.now().strftime("%Y-%m-%d")
            tid = daily_task_id(day)
            if not tid:
                return self.send_json({"task": None})
            mates = teacher_students(db, teacher_of(s)["id"])
            names = {m["id"]: short_name(m["name"]) for m in mates}
            ids = list(names)
            rows = db.q(f"SELECT student_id, ms FROM daily_results WHERE day=? AND student_id IN ({','.join('?' * len(ids))}) "
                        "ORDER BY ms, ts", (day, *ids)) if ids else []
            crown = daily_crown(db, ids)
            mine = next((r["ms"] for r in rows if r["student_id"] == s["id"]), None)
            started = db.q("SELECT ts FROM daily_starts WHERE day=? AND student_id=?", (day, s["id"]), one=True)
            t = APP.bank.tasks[tid]
            return self.send_json({"task": APP.bank.pid(tid), "n": t.get("n"), "day": day, "count": len(rows),
                                   "mine": mine, "crown": names.get(crown), "started": started["ts"] if started else None,
                                   "top": [{"place": i + 1, "sid": r["student_id"], "name": names[r["student_id"]], "ms": r["ms"],
                                            "me": r["student_id"] == s["id"]} for i, r in enumerate(rows[:10])],
                                   "my_place": next((i + 1 for i, r in enumerate(rows) if r["student_id"] == s["id"]), None)})

        if path.startswith("/api/support"):
            # техподдержка: обращение ученика уходит главному учителю (в «Статистику сайта»), ответ виден ученику
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if path == "/api/support/seen" and method == "POST":
                db.x("UPDATE support SET seen=1 WHERE student_id=? AND answer IS NOT NULL", (s["id"],))
                return self.send_json({"ok": True})
            if path != "/api/support":
                return self.err(404, "нет такого метода")
            if method == "POST":
                text = str(data.get("text") or "").strip()[:SUPPORT_MAX]
                kind = str(data.get("kind") or "")
                if kind not in SUPPORT_KINDS:
                    kind = "other"
                if len(text) < 5:
                    return self.err(400, "Опиши проблему подробнее — хотя бы пару слов")
                recent = db.q("SELECT COUNT(*) AS c FROM support WHERE student_id=? AND ts>?", (s["id"], time.time() - 3600), one=True)["c"]
                if recent >= SUPPORT_PER_HOUR:
                    return self.err(429, "Слишком много обращений за час — подожди немного")
                db.x("INSERT INTO support(student_id, ts, kind, text, task, page) VALUES(?,?,?,?,?,?)",
                     (s["id"], time.time(), kind, text, str(data.get("task") or "")[:60] or None, str(data.get("page") or "")[:120] or None))
                return self.send_json({"ok": True})
            rows = db.q("SELECT * FROM support WHERE student_id=? ORDER BY id DESC LIMIT 20", (s["id"],))
            return self.send_json({"kinds": SUPPORT_KINDS, "unread": sum(1 for r in rows if not r["seen"]),
                                   "items": [{"id": r["id"], "ts": r["ts"], "kind": r["kind"], "text": r["text"], "task": r["task"],
                                              "status": r["status"], "answer": r["answer"], "answered": r["answered"],
                                              "seen": bool(r["seen"])} for r in rows]})

        if path == "/api/dev/unlock" and method == "POST":
            # раздел «в разработке» (турнир) — по коду доступа; попыток немного, чтобы код не подбирали
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            now = time.time()
            with _COURSE_LOCK:
                tries = [t for t in _DEV_TRIES.get(s["id"], []) if now - t < 3600]
                if len(tries) >= 10:
                    return self.err(429, "Слишком много попыток — попробуйте через час")
                tries.append(now)
                _DEV_TRIES[s["id"]] = tries
            if str(data.get("code") or "").strip() != DEV_CODE:
                return self.err(403, "Неверный код")
            db.x("UPDATE students SET dev=1 WHERE id=?", (s["id"],))
            return self.send_json({"ok": True})

        if path.startswith("/api/tour"):
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            return self.api_tour(s, path, method, data, qs)

        if path.startswith("/api/duel"):
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not s["dev"]:
                return self.send_json({"dev_locked": True, "error": "Турнир в разработке — вход по коду"}, code=403)
            return self.api_duels(s, path, method, data)

        if path == "/api/exam/start" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            return self.api_exam_start(s)

        if path in ("/api/exams", "/api/exam/view"):
            # история вариантов ученика: список и разбор одного (свой ответ, баллы, правильный — если его показывали)
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if path == "/api/exams":
                out = []
                for e in db.q("""SELECT id, started, finished, primary_score, test_score, items, result FROM exams
                                 WHERE student_id=? AND finished IS NOT NULL ORDER BY finished DESC LIMIT 100""", (s["id"],)):
                    r = json.loads(e["result"] or "{}")
                    res = r.get("results") or []
                    out.append({"id": e["id"], "started": e["started"], "finished": e["finished"], "primary": e["primary_score"] or 0,
                                "test": e["test_score"] or 0, "spent": r.get("spent"), "shown": bool(r.get("shown")),
                                "items": len(res), "full": sum(1 for x in res if x.get("points") == x.get("max") and x.get("max")),
                                "blank": sum(1 for x in res if x.get("blank"))})
                return self.send_json({"exams": out})
            e = db.q("SELECT * FROM exams WHERE id=? AND student_id=? AND finished IS NOT NULL", (str(qs.get("id") or ""), s["id"]), one=True)
            if not e:
                return self.err(404, "Вариант не найден")
            r = json.loads(e["result"] or "{}")
            mine = {}
            for a in db.q("SELECT task_id, answers FROM attempts WHERE student_id=? AND exam=?", (s["id"], e["id"])):
                try:
                    mine[APP.bank.pid(a["task_id"])] = (json.loads(a["answers"] or "[]") or [""])[0]
                except ValueError:
                    pass
            for x in r.get("results") or []:
                x["mine"] = mine.get(x.get("task"), "")
            return self.send_json(dict(r, id=e["id"], started=e["started"], finished=e["finished"]))

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
            if method == "POST":
                with _GS_LOCK:
                    _LB_PEOPLE.clear()          # учитель поменял классы, учеников, цели — рейтинг соберём заново
            return self.admin_api(method, path, qs, data)

        return self.err(404, "нет такого метода")

    # ---------- задание: открыть, проверить, показать ответ
    def api_tour(self, s, path, method, data, qs):
        """Турниры: наборы на 4 и 8 игроков; набрались — турнир начинается сам; сетка на выбывание,
        матч — одинаковые задания обоим, раунд — сутки; призы опытом и наградой «Победитель турнира»."""
        db = APP.db
        tid = teacher_of(s)["id"]
        if s["is_teacher"]:
            return self.err(403, "Учитель в турнирах не участвует")
        tour_lobbies(db, tid)
        for t in db.q("SELECT * FROM tournaments WHERE teacher_id=? AND status IN ('reg','run')", (tid,)):
            tour_tick(db, t)
        mine_active = db.q("""SELECT t.* FROM tournaments t JOIN tour_players p ON p.tour_id=t.id
                              WHERE p.student_id=? AND t.status IN ('reg','run')""", (s["id"],))
        if path == "/api/tour":
            lobbies = []
            for size, name in TOUR_SIZES.items():
                t = db.q("SELECT * FROM tournaments WHERE teacher_id=? AND size=? AND status='reg'", (tid, size), one=True)
                item = {"size": size, "name": name, "groups": TOUR_GROUPS[size], "qual": TOUR_QUAL[size],
                        "prizes": TOUR_PRIZES[size]}
                if t:
                    players = tour_people(db, t["id"])
                    item.update(id=t["id"], title=t["title"], players=players, me_in=any(p["sid"] == s["id"] for p in players))
                else:                            # сегодня такой турнир уже стартовал — следующий набор завтра
                    item.update(id=None, players=[], me_in=False, next_at=day_start() + 86400)
                lobbies.append(item)
            mine = None
            run = [t for t in mine_active if t["status"] == "run"]
            last = run[0] if run else db.q("""SELECT t.* FROM tournaments t JOIN tour_players p ON p.tour_id=t.id
                                               WHERE p.student_id=? AND t.status='done' AND t.finished>?
                                               ORDER BY t.finished DESC LIMIT 1""", (s["id"], time.time() - 3 * 86400), one=True)
            if last:
                mine = tour_view(db, last, s["id"])
            done = [tour_view(db, t, s["id"], brief=True) for t in
                    db.q("SELECT * FROM tournaments WHERE teacher_id=? AND status='done' ORDER BY finished DESC LIMIT 6", (tid,))]
            wins = db.q("SELECT COUNT(*) AS c FROM awards WHERE student_id=? AND kind='tour1'", (s["id"],), one=True)["c"]
            return self.send_json({"lobbies": lobbies, "mine": mine, "done": done, "wins": wins, "tasks": DUEL_TASKS,
                                   "group_hours": TOUR_GROUP_HOURS, "po_hours": TOUR_PO_HOURS, "busy": bool(mine_active)})
        if method != "POST":
            return self.err(405, "нужен POST")
        if path in ("/api/tour/join", "/api/tour/leave"):
            t = db.q("SELECT * FROM tournaments WHERE id=? AND teacher_id=?", (to_int(data.get("id")), tid), one=True)
            if not t or t["status"] != "reg":
                return self.err(409, "Набор в этот турнир уже закрыт")
            if path == "/api/tour/leave":
                db.x("DELETE FROM tour_players WHERE tour_id=? AND student_id=?", (t["id"], s["id"]))
                return self.send_json({"ok": True})
            if mine_active:
                return self.err(409, "Ты уже записан в турнир — сначала доиграй его или выйди из набора")
            db.x("INSERT OR IGNORE INTO tour_players(tour_id, student_id, joined) VALUES(?,?,?)", (t["id"], s["id"], time.time()))
            tour_tick(db, db.q("SELECT * FROM tournaments WHERE id=?", (t["id"],), one=True))     # набрались — старт
            st = db.q("SELECT status FROM tournaments WHERE id=?", (t["id"],), one=True)["status"]
            return self.send_json({"ok": True, "started": st == "run"})
        m = db.q("SELECT * FROM tour_matches WHERE id=? AND (a=? OR b=?)", (to_int(data.get("match")), s["id"], s["id"]), one=True)
        if not m:
            return self.err(404, "Матч не найден")
        side = "a" if m["a"] == s["id"] else "b"
        if path == "/api/tour/start":
            if m["status"] != "play" or (m["ends"] and time.time() > m["ends"]):
                return self.err(409, "Время на этот матч вышло")
            if not m[side + "_start"]:
                busy = db.q("""SELECT 1 FROM tour_matches WHERE id!=? AND status='play' AND
                               ((a=? AND a_start IS NOT NULL AND a_done IS NULL) OR (b=? AND b_start IS NOT NULL AND b_done IS NULL))""",
                            (m["id"], s["id"], s["id"]), one=True)
                if busy:
                    return self.err(409, "Сначала закончи начатый матч")
                db.x(f"UPDATE tour_matches SET {side}_start=? WHERE id=?", (time.time(), m["id"]))
            return self.send_json({"ok": True, "tasks": [APP.bank.pid(x) for x in json.loads(m["tasks"])], "ends": m["ends"]})
        if path == "/api/tour/finish":
            if m["status"] == "play" and m[side + "_start"] and not m[side + "_done"]:
                db.x(f"UPDATE tour_matches SET {side}_done=? WHERE id=?", (time.time(), m["id"]))
                tour_tick(db, db.q("SELECT * FROM tournaments WHERE id=?", (m["tour_id"],), one=True))
            return self.send_json({"ok": True})
        return self.err(404, "нет такого метода")

    def api_duels(self, s, path, method, data):
        db = APP.db
        tid = teacher_of(s)["id"]
        mates = {m["id"]: m for m in teacher_students(db, tid) if m["id"] != s["id"] and m["dev"]}   # турнир пока — по коду
        if s["is_teacher"]:
            mates = {}                           # учитель в дуэлях не участвует
        if path == "/api/duels":
            for d in db.q("SELECT * FROM duels WHERE (a=? OR b=?) AND status IN ('pending','active')", (s["id"], s["id"])):
                duel_settle(db, d)
            out = []
            for d in db.q("""SELECT * FROM duels WHERE (a=? OR b=?) AND (status IN ('pending','active') OR finished>?)
                             ORDER BY id DESC LIMIT 20""", (s["id"], s["id"], time.time() - 7 * 86400)):
                me, op = ("a", "b") if d["a"] == s["id"] else ("b", "a")
                opr = db.q("SELECT name FROM students WHERE id=?", (d[op],), one=True)
                item = {"id": d["id"], "status": d["status"], "mine": me == "a", "opponent": short_name(opr["name"] if opr else "?"),
                        "started": bool(d[me + "_start"]), "done": bool(d[me + "_done"]), "op_done": bool(d[op + "_done"]),
                        "ends": (d["accepted"] or d["created"]) + DUEL_HOURS * 3600}
                if d["status"] == "active" and d[me + "_start"]:
                    item["tasks"] = [APP.bank.pid(x) for x in json.loads(d["tasks"])]
                    item["since"] = d[me + "_start"]
                if d["status"] == "finished":
                    item.update(my_solved=d[me + "_solved"], op_solved=d[op + "_solved"], stake=d["stake"] or 0,
                                result="draw" if not d["winner"] else ("win" if d["winner"] == s["id"] else "lose"))
                out.append(item)
            lv = lambda sid: game_summary(db, sid, brief=True)["level"]
            return self.send_json({"duels": out, "stake": DUEL_STAKE, "tasks": DUEL_TASKS, "hours": DUEL_HOURS,
                                   "tournament": tournament_table(db, s, mates),
                                   "mates": sorted(({"sid": m["id"], "name": short_name(m["name"]), "level": lv(m["id"])}
                                                    for m in mates.values()), key=lambda x: x["name"])})
        if method != "POST":
            return self.err(405, "нужен POST")
        if path == "/api/duel/create":
            op = to_int(data.get("sid"))
            if op not in mates:
                return self.err(404, "Соперник не найден — вызвать можно только ученика своего учителя")
            if db.q("""SELECT 1 FROM duels WHERE status IN ('pending','active') AND ((a=? AND b=?) OR (a=? AND b=?))""",
                    (s["id"], op, op, s["id"]), one=True):
                return self.err(409, "С этим соперником матч уже идёт")
            if db.q("""SELECT 1 FROM duels WHERE status='finished' AND finished>=? AND ((a=? AND b=?) OR (a=? AND b=?))""",
                    (week_start(), s["id"], op, op, s["id"]), one=True):
                return self.err(409, "С этим соперником матч турнира на этой неделе уже сыгран")
            if db.q("SELECT COUNT(*) AS c FROM duels WHERE status IN ('pending','active') AND (a=? OR b=?)",
                    (s["id"], s["id"]), one=True)["c"] >= DUEL_MAX_OPEN:
                return self.err(429, f"Не больше {DUEL_MAX_OPEN} дуэлей одновременно — закончи начатые")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            tasks = duel_tasks()
            if not tasks:
                return self.err(503, "нет подходящих заданий")
            did = db.x("INSERT INTO duels(a, b, tasks, created, status) VALUES(?,?,?,?, 'pending')",
                       (s["id"], op, json.dumps(tasks), time.time()))
            return self.send_json({"ok": True, "id": did})
        d = db.q("SELECT * FROM duels WHERE id=? AND (a=? OR b=?)", (to_int(data.get("id")), s["id"], s["id"]), one=True)
        if not d:
            return self.err(404, "дуэль не найдена")
        me = "a" if d["a"] == s["id"] else "b"
        if path == "/api/duel/respond":
            if d["status"] != "pending" or me != "b":
                return self.err(409, "Вызов уже не ждёт ответа")
            if data.get("accept"):
                db.x("UPDATE duels SET status='active', accepted=? WHERE id=?", (time.time(), d["id"]))
            else:
                db.x("UPDATE duels SET status='declined', finished=? WHERE id=?", (time.time(), d["id"]))
            return self.send_json({"ok": True})
        if path == "/api/duel/start":
            if d["status"] != "active":
                return self.err(409, "Дуэль не идёт")
            if not d[me + "_start"]:
                db.x(f"UPDATE duels SET {me}_start=? WHERE id=?", (time.time(), d["id"]))
            return self.send_json({"ok": True, "tasks": [APP.bank.pid(x) for x in json.loads(d["tasks"])]})
        if path == "/api/duel/finish":
            if d["status"] == "active" and d[me + "_start"] and not d[me + "_done"]:
                db.x(f"UPDATE duels SET {me}_done=? WHERE id=?", (time.time(), d["id"]))
                duel_settle(db, db.q("SELECT * FROM duels WHERE id=?", (d["id"],), one=True))
            return self.send_json({"ok": True})
        return self.err(404, "нет такого метода")

    def api_open(self, s, t):
        """Ученик открыл задание: с этого момента идёт время на раздумье.
        Открыл заново, не закончив после неверной попытки, — засчитываем «ушёл после ошибки»,
        иначе перезагрузкой страницы можно было бы получать новые попытки без конца."""
        ids = [p["id"] for p in t["parts"]] if t.get("parts") else [t["id"]]
        if t["id"] == daily_task_id():
            # задание дня: заходить можно один раз в день — запоминаем первый вход, от него считается время
            APP.db.x("INSERT OR IGNORE INTO daily_starts(day, student_id, ts) VALUES(?,?,?)",
                     (datetime.now().strftime("%Y-%m-%d"), s["id"], time.time()))
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
        if st["reason"] == WORK_REASON:            # эту метку ставит только сервер при сдаче контрольной
            st["reason"] = "asg"
        st["rk"] = str(data.get("rk") or "")[:200] or None
        spent = data.get("spent_ms")
        spent = int(spent) if isinstance(spent, (int, float)) and 0 <= spent < 864e5 else None
        srv = (time.time() - st["ts"]) * 1000          # сколько прошло с открытия задания по часам сервера
        if srv >= 1000:
            spent = int(min(spent, srv)) if spent is not None else int(srv)
        away = to_int(data.get("away"))
        st["away"] = min(max(away or 0, st.get("away") or 0), 999)
        st["away_sec"] = min(max(to_float(data.get("away_sec")), st.get("away_sec") or 0, 0), 86400)
        # сколько секунд назад ученик вернулся после долгого (30+ с) ухода; None — долгих уходов не было
        back = data.get("back_sec")
        st["back_sec"] = round(min(max(float(back), 0), 86400), 1) if isinstance(back, (int, float)) else None
        st["paste"] = bool(st.get("paste") or data.get("paste"))
        n = t.get("n") or 0

        if data.get("abandoned"):
            if not st["tries"]:              # пропустил, не отвечая, — без штрафа
                OPENED.reset(s["id"], t["id"])
                return self.send_json({"ok": True, "skipped": True})
            self.log_attempt(s, t, st["tries"], 0.0, abandoned=True, reason=st["reason"], rk=st["rk"],
                             part=st.get("part"), spent=spent, away=st["away"], st=st)
            st["final"] = {"correct": False, "final": True, "score": 0.0}
            return self.send_json(st["final"])

        gave_up = bool(data.get("gave_up"))
        if not gave_up:
            ans = str(data.get("answer") or "")[:400]
            if not tokens(ans):
                return self.err(400, "Пустой ответ")
            stop = CHECKS.hit(s["id"], t["id"])
            if stop:
                return self.err(429, stop)
            cells = data.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            st["tries"].append(ans)
            credit = answer_credit(n, t.get("ans", ""), ans, cells)
            if len(st["tries"]) == 1:
                st["part"] = credit          # на экзамене попытка одна — частичный балл считаем по первой
            if credit == 1.0:
                score = 1.0 if len(st["tries"]) == 1 else 0.5
                if score == 1.0 and t["id"] == daily_task_id():
                    self.daily_result(s, t, st)
                self.log_attempt(s, t, st["tries"], score, reason=st["reason"], rk=st["rk"], part=st["part"],
                                 revealed=1, spent=spent, away=st["away"], st=st)
                st["final"] = self.with_answer_s(s, {"correct": True, "final": True, "score": score, "part": st["part"],
                                                     "fast": spent is not None and spent < FAST_XP_MS,
                                                     "nocount": last_attempt_skipped(APP.db, s["id"])}, t)
                return self.send_json(dict(st["final"], game=game_summary(APP.db, s["id"])))
            if len(st["tries"]) < ATTEMPTS_PER_TASK:
                return self.send_json({"correct": False, "final": False, "attempts_left": ATTEMPTS_PER_TASK - len(st["tries"]),
                                       "half": credit == 0.5})

        # итог «не решено»: исчерпаны попытки или «Показать ответ»
        block = self.reveal_block(s, t, st)
        part = st.get("part", 0.0) if st["tries"] else 0.0
        aid = self.log_attempt(s, t, st["tries"], 0.0, gave_up=gave_up, reason=st["reason"], rk=st["rk"],
                               part=part, revealed=0 if block else 1, spent=spent, away=st["away"], st=st)
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
        if not APP.bank.ensure():
            return self.err(503, "банк заданий не собран")
        tasks = exam_pick(db, s)
        if not tasks:
            return self.err(503, "В банке нет заданий для варианта")
        eid = secrets.token_urlsafe(9)
        db.x("INSERT INTO exams(id,student_id,ip,started,tasks) VALUES(?,?,?,?,?)", (eid, s["id"], ip, now, json.dumps(tasks)))
        return self.send_json({"exam_id": eid, "started": now, "limit": EXAM_LIMIT_SEC,
                               "min_for_answers": EXAM_MIN_SEC_FOR_ANSWERS,
                               "items": [{"id": APP.bank.pid(i), "n": n_key(APP.bank.tasks[i].get("n"))} for i in tasks]})

    def api_strict(self, s, path, method, data, qs):
        """Контрольная от учителя: ответ сдаётся один раз и не проверяется до конца, результат — после сдачи."""
        db = APP.db
        aid = to_int(data.get("id") or qs.get("id"))
        a = db.q("SELECT * FROM assignments WHERE id=? AND strict=1", (aid,), one=True)
        if not a or a["class_id"] != s["class_id"] or (a["student_id"] and a["student_id"] != s["id"]):
            return self.err(404, "Самостоятельная не найдена")
        if a["due"] and not a["closed"] and time.time() > a["due"]:
            asg_expire(self, db, a["class_id"])           # срок прошёл — работа закрывается, начатая сдаётся сама
            a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
        real = asg_order([i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks], aid, s["id"])
        run = db.q("SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?", (aid, s["id"]), one=True)
        now = time.time()
        if path == "/api/asg/state":
            return self.send_json(asg_run_public(db, a, s["id"], real))
        if path == "/api/asg/review":
            # разбор сданной контрольной: правильные ответы и решения — когда контрольная закончилась для всех
            if not run or not run["finished"]:
                return self.err(409, "Разбор откроется после того, как ты сдашь самостоятельную")
            why = asg_review_locked(db, a)
            if why:
                return self.send_json({"locked": why, "title": a["title"]})
            res = json.loads(run["result"] or "{}")
            answers = json.loads(run["answers"] or "{}")
            items = []
            for k in asg_items(real):
                t = APP.bank.tasks.get(k) or {}
                top = t.get("group") or k
                code = db.q("SELECT code FROM solutions WHERE student_id=? AND task_id=?", (s["id"], top), one=True)
                it = self.with_answer_s(s, {"task": APP.bank.pid(k), "top": APP.bank.pid(top), "n": t.get("n"),
                                            "mine": (answers.get(k) or {}).get("a") or "", "credit": res.get(k),
                                            "code": code["code"] if code else ""}, t)
                items.append(it)
            return self.send_json({"title": a["title"], "items": items, "result": asg_run_public(db, a, s["id"], real).get("result")})
        if method != "POST":
            return self.err(405, "нужен POST")
        if path == "/api/asg/start":
            if not run:
                if a["closed"]:
                    return self.err(409, "Срок прошёл — самостоятельная закрыта" if a["due"] and a["closed"] >= a["due"]
                                    else "Учитель уже завершил эту самостоятельную")
                db.x("INSERT INTO asg_runs(asg_id, student_id, started, last, answers) VALUES(?,?,?,?,?)", (aid, s["id"], now, now, "{}"))
                db.x("INSERT INTO asg_events(asg_id, student_id, ts, kind) VALUES(?,?,?,'start')", (aid, s["id"], now))
            return self.send_json(asg_run_public(db, a, s["id"], real))
        if not run:
            return self.err(409, "Сначала начните самостоятельную")
        if path == "/api/asg/away":
            # ушёл со вкладки или вышел из полного экрана — учителю в живую сводку и в ленту
            kind = "fs" if data.get("kind") == "fs" else "away"
            if not run["finished"] and not a["closed"]:
                recent = db.q("SELECT COUNT(*) AS c FROM asg_events WHERE student_id=? AND ts>?", (s["id"], now - 3600), one=True)["c"]
                if recent < 300:
                    db.x(f"UPDATE asg_runs SET {kind}=COALESCE({kind}, 0)+1, last=? WHERE asg_id=? AND student_id=?", (now, aid, s["id"]))
                    db.x("INSERT INTO asg_events(asg_id, student_id, ts, kind, info) VALUES(?,?,?,?,?)",
                         (aid, s["id"], now, kind, str(round(to_float(data.get("dur")))) if data.get("dur") else None))
            return self.send_json({"ok": True})
        if run["finished"] or a["closed"]:
            if not run["finished"]:
                asg_finish_run(self, db, a, s, real, forced=1)
            return self.send_json(dict(asg_run_public(db, a, s["id"], real), closed_now=True))
        if path == "/api/asg/answer":
            answers = json.loads(run["answers"] or "{}")
            tid = APP.bank.real(data.get("task")) or ""
            t = APP.bank.tasks.get(tid)
            if not t or (tid not in real and t.get("group") not in real):
                return self.err(404, "Такого задания в самостоятельной нет")
            if t.get("parts"):
                return self.err(400, "вопросы 19–21 сдаются по отдельности")
            ans = str(data.get("answer") or "")[:400]
            cells = data.get("cells")
            cells = [str(c)[:100] for c in cells[:40]] if isinstance(cells, list) else None
            if tid in answers:
                # сданный ответ можно один раз изменить — по кнопке «Изменить ответ»
                if answers[tid].get("ch"):
                    return self.err(409, "Ответ уже изменён один раз — больше изменить нельзя")
                if not data.get("change"):
                    return self.err(409, "Ответ на это задание уже сдан")
                old = answers[tid]
                answers[tid] = {"a": ans, "c": cells, "ts": now, "ms": old.get("ms"), "ch": 1, "prev": old.get("a")}
            else:
                answers[tid] = {"a": ans, "c": cells, "ts": now, "ms": to_int(data.get("spent_ms")) or None}
            db.x("UPDATE asg_runs SET answers=?, last=? WHERE asg_id=? AND student_id=?",
                 (json.dumps(answers, ensure_ascii=False), now, aid, s["id"]))
            return self.send_json(asg_run_public(db, a, s["id"], real))
        if path == "/api/asg/finish":
            asg_finish_run(self, db, a, s, real)
            return self.send_json(dict(asg_run_public(db, a, s["id"], real), game=game_summary(db, s["id"])))
        return self.err(404, "нет такого метода")

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
        issued = set(json.loads(e["tasks"])) if e["tasks"] else None    # задания, выданные сервером при старте
        results, primary, seen, nums = [], 0, set(), set()
        for it in items[:40]:
            if not isinstance(it, dict):
                continue
            tid = APP.bank.real(it.get("task")) or ""
            t = APP.bank.tasks.get(tid)
            if not t or t.get("parts") or tid in seen or t.get("n") in nums:
                continue                      # по одному заданию на номер, как на экзамене
            if issued is not None and (t.get("group") or tid) not in issued:
                continue                      # чужое задание в вариант не подставить — ни балла, ни ответа
            if issued is None and strict_locked(db, s, t.get("group") or tid):
                continue                      # вариант старого образца: задания идущей самостоятельной — без ответа
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
            if not blank:                     # нетронутое задание варианта — не ошибка: в журнал и статистику не идёт
                self.log_attempt(s, t, [ans], 1.0 if credit == 1.0 else 0.0, reason="exam",
                                 part=credit, revealed=int(show), exam=e["id"])
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
                d["cheat"] = g.get("cheat")                # пользовался лазейкой — опыт за этот период срезан
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
            exams = db.q("""SELECT id, started, finished, primary_score, test_score, items, result,
                                   (SELECT COUNT(*) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1 AND v.kind = 'away'
                                      AND v.ts BETWEEN e.started AND e.finished + 5) AS away,
                                   (SELECT COALESCE(SUM(v.dur), 0) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1
                                      AND v.kind = 'away' AND v.ts BETWEEN e.started AND e.finished + 5) AS away_sec,
                                   (SELECT COUNT(*) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1 AND v.kind = 'fs'
                                      AND v.ts BETWEEN e.started AND e.finished + 5) AS fs,
                                   (SELECT COUNT(*) FROM activity v WHERE v.student_id = e.student_id AND v.exam = 1 AND v.kind = 'paste'
                                      AND v.ts BETWEEN e.started AND e.finished + 5) AS paste
                            FROM exams e WHERE student_id=? AND finished IS NOT NULL ORDER BY finished DESC LIMIT 20""", (sid,))
            same_ip = []
            if s["last_ip"]:
                same_ip = [r["name"] for r in db.q("SELECT name FROM students WHERE last_ip=? AND id<>? ORDER BY last_seen DESC LIMIT 30",
                                                     (s["last_ip"], sid))]
            student = {k: s[k] for k in ("id", "name", "created", "last_seen", "forecast", "progress_ts", "last_ip")}
            extra_row = db.q("SELECT role, consent_ver, consent_ts, consent_ip FROM students WHERE id=?", (sid,), one=True)
            student.update({k: extra_row[k] for k in ("role", "consent_ver", "consent_ts", "consent_ip")} if extra_row else {})
            student["consent_ok"] = bool(extra_row and extra_row["consent_ver"] == LEGAL_VERSION)
            student["has_password"] = bool(db.q("SELECT pw FROM students WHERE id=?", (sid,), one=True)["pw"])
            coded = {r["task_id"] for r in db.q("SELECT task_id FROM solutions WHERE student_id=?", (sid,))}
            for d in out:
                d["has_code"] = 1 if d["task_id"] in coded or (d.get("grp") or "") in coded else 0
            act = db.q("""SELECT kind, COUNT(*) AS c, SUM(dur) AS dur, SUM(exam) AS in_exam FROM activity
                          WHERE student_id=? AND ts>=? GROUP BY kind""", (sid, frm))
            # каждый уход со страницы: когда, насколько, на каком задании (сводка «вне тренажёра»)
            away_log = []
            for r in db.q("""SELECT ts, kind, task_id, dur, exam FROM activity WHERE student_id=? AND ts>=?
                             ORDER BY ts DESC LIMIT 300""", (sid, frm)):
                d = dict(r)
                tk = APP.bank.tasks.get(d["task_id"]) if d["task_id"] else None
                d["n"] = tk.get("n") if tk else None
                d["snip"] = APP.bank.snippet(d["task_id"]) if tk else ""
                away_log.append(d)
            row = db.q("SELECT class_id, teacher_id FROM students WHERE id=?", (sid,), one=True)
            student["class_id"] = row["class_id"]
            student["teacher_id"] = row["teacher_id"] or main_teacher()["id"]
            return self.send_json({"student": student, "attempts": out, "forecast_history": fc_hist,
                                   "reveals": {k: rev[k] or 0 for k in ("granted", "blocked", "early")},
                                   "exams": [exam_brief(r) for r in exams], "same_ip": same_ip,
                                   "activity": {r["kind"]: {"count": r["c"], "sec": round(r["dur"] or 0), "exam": r["in_exam"] or 0} for r in act},
                                   "away_log": away_log,
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
            # события контрольных: начал, ушёл со вкладки, вышел из полного экрана, сдал
            ev = db.q(f"""SELECT e.*, s.name, g.title FROM asg_events e JOIN students s ON s.id = e.student_id
                          JOIN assignments g ON g.id = e.asg_id
                          WHERE e.ts > ? AND {cond} ORDER BY e.ts DESC LIMIT 300""", (since, *args))
            events = [dict(e) for e in ev]
            # сданные варианты ЕГЭ — тоже в уведомления
            for e in db.q(f"""SELECT x.id, x.student_id, x.finished, x.primary_score, x.test_score, s.name FROM exams x
                              JOIN students s ON s.id = x.student_id
                              WHERE x.finished > ? AND {cond} ORDER BY x.finished DESC LIMIT 100""", (since, *args)):
                events.append({"ts": e["finished"], "kind": "exam", "student_id": e["student_id"], "name": e["name"],
                               "title": "Вариант ЕГЭ", "exam": e["id"],
                               "info": json.dumps({"test": e["test_score"], "primary": e["primary_score"]})})
            events.sort(key=lambda x: -x["ts"])
            return self.send_json({"attempts": out, "events": events, "now": now})

        if path == "/api/admin/exam":
            # разбор варианта ученика для учителя: ответ ученика, правильный ответ, баллы по каждому заданию
            e = db.q("SELECT * FROM exams WHERE id=? AND finished IS NOT NULL", (str(qs.get("id") or ""),), one=True)
            if not e or not self.sees_student(e["student_id"]):
                return self.err(404, "вариант не найден")
            APP.bank.ensure()
            r = json.loads(e["result"] or "{}")
            mine = {}
            for a in db.q("SELECT task_id, answers FROM attempts WHERE student_id=? AND exam=?", (e["student_id"], e["id"])):
                try:
                    mine[a["task_id"]] = (json.loads(a["answers"] or "[]") or [""])[0]
                except ValueError:
                    pass
            rows = []
            for x in r.get("results") or []:
                real = APP.bank.real(x.get("task")) or ""
                t = APP.bank.tasks.get(real) or {}
                rows.append({"task": real, "n": x.get("n"), "points": x.get("points"), "max": x.get("max"), "blank": x.get("blank"),
                             "mine": mine.get(real, ""), "answer": t.get("ans", ""), "snip": APP.bank.snippet(real) if real else ""})
            st = db.q("SELECT name FROM students WHERE id=?", (e["student_id"],), one=True)
            return self.send_json({"id": e["id"], "student": st["name"] if st else "", "started": e["started"], "finished": e["finished"],
                                   "primary": e["primary_score"], "test": e["test_score"], "spent": r.get("spent"),
                                   "shown": bool(r.get("shown")), "rows": rows})

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

        if path == "/api/admin/student/role" and method == "POST":
            # плашка 👑 admin рядом с именем ученика — выдаёт и снимает только главный учитель
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            db.x("UPDATE students SET role=? WHERE id=?", ("admin" if data.get("admin") else None, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/delete" and method == "POST":
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            for table in ("attempts", "reveal_log", "exams", "activity", "solutions", "daily_starts", "daily_results"):
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

        if path == "/api/admin/course/list":
            # кто открыл курс паролем — список для главного учителя
            if not self.T["is_main"]:
                return self.err(403, "Список видит главный учитель")
            rows = db.q("""SELECT s.name, s.course_ts, c.name AS cls FROM students s LEFT JOIN classes c ON c.id = s.class_id
                           WHERE s.course=1 ORDER BY s.course_ts DESC, s.name""")
            return self.send_json({"students": [{"name": r["name"], "class": r["cls"], "ts": r["course_ts"]} for r in rows]})

        if path == "/api/admin/course/progress":
            # прогресс курса (главный учитель): кто открыл курс, сколько слайдов просмотрел, сколько решил в каждой подборке
            if not self.T["is_main"]:
                return self.err(403, "Прогресс курса видит главный учитель")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            sets = course_sets_all(True)
            lessons = []
            for n in range(1, 28):
                f = HERE / "course" / f"{n}.json"
                if f.is_file():
                    try:
                        slides = len(json.loads(f.read_text(encoding="utf-8")).get("slides", []))
                    except ValueError:
                        slides = 0
                    lessons.append({"n": n, "slides": slides, "sets": {k: len(v) for k, v in sets.get(n, {}).items()}})
            names = {t["id"]: t["name"] for t in db.q("SELECT id, name FROM teachers")}
            main_id = main_teacher()["id"]
            rows = db.q("""SELECT s.id, s.name, s.course_ts, s.last_seen, s.teacher_id, c.name AS cls FROM students s
                           LEFT JOIN classes c ON c.id = s.class_id WHERE s.course = 1 AND COALESCE(s.is_teacher, 0) = 0
                           ORDER BY s.name""")
            sid = qs.get("id")
            out = []
            for r in rows:
                if sid and str(r["id"]) != str(sid):
                    continue
                seen = {x["n"]: (x["slide"], x["total"]) for x in db.q("SELECT n, slide, total FROM course_seen WHERE student_id=?", (r["id"],))}
                st = {}
                for a in db.q("""SELECT COALESCE(grp, task_id) AS t, MAX(score > 0) AS ok, MAX(ts) AS ts FROM attempts
                                 WHERE student_id=? AND exam IS NULL GROUP BY COALESCE(grp, task_id)""", (r["id"],)):
                    st[a["t"]] = (a["ok"], a["ts"])
                ls, done_all, tot_all, last = {}, 0, 0, None
                for L in lessons:
                    per = {}
                    for k, ids in sets.get(L["n"], {}).items():
                        ok = [i for i in ids if st.get(i, (0,))[0]]
                        bad = [i for i in ids if i in st and not st[i][0]]
                        per[k] = {"done": len(ok), "bad": len(bad), "total": len(ids)}
                        if sid:
                            per[k]["tasks"] = [{"id": i, "snip": APP.bank.snippet(i), "c": (APP.bank.tasks.get(i) or {}).get("c"),
                                                "r": (APP.bank.tasks.get(i) or {}).get("r"),
                                                "st": "ok" if i in ok else "bad" if i in bad else ""} for i in ids]
                        done_all += len(ok)
                        tot_all += len(ids)
                        for i in ids:
                            if i in st and (last is None or st[i][1] > last):
                                last = st[i][1]
                    sl = seen.get(L["n"])
                    ls[L["n"]] = {"sets": per, "seen": sl[0] if sl else 0, "slides": L["slides"]}
                slides_seen = sum(v["seen"] for v in ls.values())
                slides_all = sum(v["slides"] for v in ls.values()) or 1
                out.append({"id": r["id"], "name": r["name"], "class": r["cls"], "teacher": names.get(r["teacher_id"] or main_id, ""),
                            "opened": r["course_ts"], "last_seen": r["last_seen"], "last_task": last, "lessons": ls,
                            "done": done_all, "total": tot_all,
                            # итог: 30% — презентации, 70% — решённые задания подборок
                            "pct": round(100 * (0.3 * min(1, slides_seen / slides_all) + 0.7 * (done_all / tot_all if tot_all else 0)))})
            return self.send_json({"lessons": lessons, "students": out,
                                   "set_names": {"warm": "Разминка", "base": "Базовый", "exam": "Как на ЕГЭ", "hard": "Сложные", "test": "Контрольная"}})

        if path == "/api/admin/course" and method == "POST":
            # пароль курса: задать или сменить; revoke — закрыть курс всем, кто уже вошёл
            if not self.T["is_main"]:
                return self.err(403, "Пароль курса задаёт главный учитель")
            pw = str(data.get("password") or "").strip()
            if pw:
                if len(pw) < 4:
                    return self.err(400, "Пароль курса — не короче 4 символов")
                db.setting("course_pw", hash_pw(pw[:200]))
            if data.get("off"):
                db.setting("course_pw", "")
            if data.get("revoke") or data.get("off"):
                db.x("UPDATE students SET course=0")
            n = db.q("SELECT COUNT(*) c FROM students WHERE course=1", one=True)["c"]
            return self.send_json({"ok": True, "set": bool(db.setting("course_pw")), "students": n})

        if path == "/api/admin/me":
            return self.send_json({k: self.T[k] for k in ("id", "name", "login", "is_main", "invite")})

        if path == "/api/admin/as-student" and method == "POST":
            # учитель решает тренажёр как ученик: свой аккаунт без кода и пароля, в рейтингах и списках его нет
            t = self.T
            s = db.q("SELECT * FROM students WHERE is_teacher=1 AND teacher_id=?", (t["id"],), one=True)
            if not s:
                db.x("""INSERT INTO students(name, name_key, token, created, last_seen, teacher_id, is_teacher)
                        VALUES(?,?,?,?,?,?,1)""", (t["name"] or "Учитель", f"teacher:{t['id']}", secrets.token_urlsafe(24),
                                                  time.time(), time.time(), t["id"]))
                s = db.q("SELECT * FROM students WHERE is_teacher=1 AND teacher_id=?", (t["id"],), one=True)
            return self.send_json({"ok": True, "sid": s["id"], "name": s["name"], "token": s["token"]},
                                  extra={"Set-Cookie": self.student_cookie(s["token"])})

        if path == "/api/admin/site-stats":
            # главный учитель: количественные метрики всего сайта (без имён учеников других учителей)
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            now = time.time()
            d0 = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            real = "COALESCE(is_teacher, 0) = 0"
            one = lambda sql, *a: db.q(sql, a, one=True)
            st = one(f"""SELECT COUNT(*) AS users, SUM(created >= ?) AS new_today, SUM(created >= ?) AS new_week,
                                SUM(last_seen >= ?) AS online, SUM(last_seen >= ?) AS seen_today, SUM(course = 1) AS course
                         FROM students WHERE {real}""", d0, now - 7 * 86400, now - 300, d0)
            act = lambda since: one(f"""SELECT COUNT(DISTINCT a.student_id) c FROM attempts a JOIN students s ON s.id = a.student_id
                                        WHERE a.ts >= ? AND COALESCE(s.is_teacher, 0) = 0""", since)["c"]
            att = one("""SELECT COUNT(*) AS answers, SUM(score > 0) AS solved, SUM(score = 1) AS first,
                                COUNT(DISTINCT COALESCE(grp, task_id)) AS tasks,
                                SUM(ts >= ? AND score > 0) AS solved_today, SUM(ts >= ? AND score > 0) AS solved_week,
                                SUM(COALESCE(spent_ms, 0)) AS spent
                         FROM attempts""", d0, now - 7 * 86400)
            vis = lambda since_day: one("SELECT COUNT(*) c FROM visits WHERE day >= ?", since_day)["c"]
            vis_u = lambda since_day: one("SELECT COUNT(DISTINCT vid) c FROM visits WHERE day >= ?", since_day)["c"]
            day = lambda k: (datetime.now() - timedelta(days=k)).strftime("%Y-%m-%d")
            series = []
            for k in range(13, -1, -1):
                dd = day(k)
                a0 = datetime.strptime(dd, "%Y-%m-%d").timestamp()
                r = one(f"""SELECT SUM(a.score > 0) AS solved, COUNT(DISTINCT a.student_id) AS active
                            FROM attempts a JOIN students s ON s.id = a.student_id
                            WHERE a.ts >= ? AND a.ts < ? AND COALESCE(s.is_teacher, 0) = 0""", a0, a0 + 86400)
                series.append({"day": dd, "solved": r["solved"] or 0, "active": r["active"] or 0,
                               "visitors": one("SELECT COUNT(*) c FROM visits WHERE day = ?", dd)["c"]})
            nums = [dict(r) for r in db.q("""SELECT n, COUNT(*) AS answers, SUM(score > 0) AS solved FROM attempts
                                             WHERE n IS NOT NULL AND exam IS NULL GROUP BY n ORDER BY n""")]
            main_id = main_teacher()["id"]
            teachers = [dict(r) for r in db.q(f"""SELECT t.id, t.name, t.is_main,
                    (SELECT COUNT(*) FROM students s WHERE COALESCE(s.teacher_id, ?) = t.id AND {real}) AS students,
                    (SELECT COUNT(DISTINCT a.student_id) FROM attempts a JOIN students s ON s.id = a.student_id
                       WHERE COALESCE(s.teacher_id, ?) = t.id AND COALESCE(s.is_teacher, 0) = 0 AND a.ts >= ?) AS active_week,
                    (SELECT COUNT(*) FROM attempts a JOIN students s ON s.id = a.student_id
                       WHERE COALESCE(s.teacher_id, ?) = t.id AND COALESCE(s.is_teacher, 0) = 0 AND a.ts >= ? AND a.score > 0) AS solved_week
                    FROM teachers t ORDER BY t.is_main DESC, t.name""", (main_id, main_id, now - 7 * 86400, main_id, now - 7 * 86400))]
            ex = one("SELECT COUNT(*) AS n, AVG(test_score) AS avg FROM exams WHERE finished IS NOT NULL")
            return self.send_json({
                "users": st["users"] or 0, "new_today": st["new_today"] or 0, "new_week": st["new_week"] or 0,
                "online": st["online"] or 0, "seen_today": st["seen_today"] or 0, "course": st["course"] or 0,
                "teachers": one("SELECT COUNT(*) c FROM teachers")["c"],
                "active_today": act(d0), "active_week": act(now - 7 * 86400), "active_month": act(now - 30 * 86400),
                "answers": att["answers"] or 0, "solved": att["solved"] or 0, "first": att["first"] or 0,
                "tasks": att["tasks"] or 0, "solved_today": att["solved_today"] or 0, "solved_week": att["solved_week"] or 0,
                "hours": round((att["spent"] or 0) / 3_600_000, 1),
                "visitors_today": vis(day(0)), "visitors_week": vis_u(day(6)), "visits_week": vis(day(6)),
                "exams": ex["n"] or 0, "exam_avg": round(ex["avg"], 1) if ex["avg"] is not None else None,
                "duels": one("SELECT COUNT(*) c FROM duels WHERE status = 'finished'")["c"],
                "bank": len(APP.bank.tasks) if APP.bank.ensure() else 0,
                "series": series, "nums": nums, "by_teacher": teachers, "support_kinds": SUPPORT_KINDS,
                "support": [dict(r) for r in db.q("""
                    SELECT p.*, s.name, COALESCE(t.name, '') AS teacher FROM support p JOIN students s ON s.id = p.student_id
                    LEFT JOIN teachers t ON t.id = COALESCE(s.teacher_id, ?)
                    ORDER BY (p.status = 'new') DESC, p.id DESC LIMIT 200""", (main_id,))]})

        if path == "/api/admin/support/delete" and method == "POST":
            # удалить обращение (или все закрытые разом) — только главный учитель
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            if data.get("closed"):
                n = db.xn("DELETE FROM support WHERE status='closed'")
            else:
                n = db.xn("DELETE FROM support WHERE id=?", (to_int(data.get("id")),))
            return self.send_json({"ok": True, "deleted": n})

        if path == "/api/admin/support/answer" and method == "POST":
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid = to_int(data.get("id"))
            r = db.q("SELECT * FROM support WHERE id=?", (sid,), one=True)
            if not r:
                return self.err(404, "Обращение не найдено")
            answer = str(data.get("answer") or "").strip()[:SUPPORT_MAX]
            status = "closed" if data.get("close") else ("answered" if answer else r["status"])
            if answer:
                db.x("UPDATE support SET answer=?, answered=?, status=?, seen=0 WHERE id=?", (answer, time.time(), status, sid))
            else:
                db.x("UPDATE support SET status=? WHERE id=?", (status, sid))
            return self.send_json({"ok": True})

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
            ccond = "COALESCE(c.teacher_id, ?) = ?"                 # только свои классы, и у главного тоже
            cargs = (main_id, self.T["id"])
            rows = db.q(f"""SELECT c.id, c.name, c.created, COALESCE(c.teacher_id, ?) AS teacher_id, t.name AS teacher,
                                  c.goal_tasks, c.goal_reward, COALESCE(c.battle, 0) AS battle,
                                  (SELECT COUNT(*) FROM attempts a JOIN students s2 ON s2.id = a.student_id
                                   WHERE s2.class_id = c.id AND a.score > 0 AND a.ts >= {week_start()}) AS week_solved,
                                  COUNT(s.id) AS students FROM classes c
                           LEFT JOIN students s ON s.class_id = c.id
                           LEFT JOIN teachers t ON t.id = COALESCE(c.teacher_id, ?)
                           WHERE {ccond} GROUP BY c.id ORDER BY t.is_main DESC, t.name, c.name""", (main_id, main_id, *cargs))
            cond, args = self.student_scope()
            free = db.q(f"SELECT COUNT(*) c FROM students s WHERE class_id IS NULL AND {cond}", args, one=True)["c"]
            return self.send_json({"classes": [dict(r) for r in rows], "unassigned": free})

        if path == "/api/admin/class/goal" and method == "POST":
            # битва классов: цель на неделю (сколько заданий решить) и награда, которую обещает учитель
            cid = to_int(data.get("id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            goal = max(0, min(to_int(data.get("goal_tasks")) or 0, 100000))
            reward = re.sub(r"\s+", " ", str(data.get("goal_reward") or "")).strip()[:120]
            battle = 1 if data.get("battle") else 0
            db.x("UPDATE classes SET goal_tasks=?, goal_reward=?, battle=? WHERE id=?", (goal or None, reward or None, battle, cid))
            return self.send_json({"ok": True, "goal_tasks": goal, "goal_reward": reward, "battle": bool(battle)})

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

        if path == "/api/admin/class/stats":
            # статистика класса за период (урок, день, неделя) — по всем заданиям или по одной подборке: для оценок
            cid = to_int(qs.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            try:
                t0, t1 = float(qs.get("from") or 0), float(qs.get("to") or now)
            except ValueError:
                return self.err(400, "неверный период")
            members = db.q("SELECT id, name FROM students WHERE class_id=? ORDER BY name", (cid,))
            asg_tasks = None
            aid = to_int(qs.get("asg"))
            if aid:
                a = db.q("SELECT tasks FROM assignments WHERE id=? AND class_id=?", (aid, cid), one=True)
                if not a:
                    return self.err(404, "подборка не найдена")
                asg_tasks = json.loads(a["tasks"] or "[]")
            rows = {}
            if members:
                ids = [m["id"] for m in members]
                cond, args = f"student_id IN ({','.join('?' * len(ids))}) AND ts>=? AND ts<? AND exam IS NULL", (*ids, t0, t1)
                if asg_tasks is not None:
                    qm = ",".join("?" * len(asg_tasks)) or "NULL"
                    cond += f" AND (task_id IN ({qm}) OR grp IN ({qm}))"
                    args += (*asg_tasks, *asg_tasks)
                for r in db.q(f"""SELECT student_id, COUNT(*) AS answers, COUNT(DISTINCT COALESCE(grp, task_id)) AS tasks,
                                         SUM(score = 1) AS ok1, SUM(score = 0.5) AS ok2, SUM(score = 0) AS bad,
                                         SUM(score = 0 AND gave_up = 1 AND revealed = 1) AS shown,
                                         COUNT(DISTINCT CASE WHEN score > 0 THEN COALESCE(grp, task_id) END) AS solved,
                                         SUM(COALESCE(spent_ms, 0)) AS spent, SUM(COALESCE(away, 0)) AS away,
                                         SUM(',' || COALESCE(flags, '') || ',' LIKE '%,sus,%') AS sus,
                                         SUM(',' || COALESCE(flags, '') || ',' LIKE '%,paste,%') AS paste,
                                         MIN(ts) AS first, MAX(ts) AS last, GROUP_CONCAT(DISTINCT n) AS nums
                                  FROM attempts WHERE {cond} GROUP BY student_id""", args):
                    rows[r["student_id"]] = dict(r)
                for r in db.q(f"""SELECT student_id, MAX(test_score) AS exam FROM exams WHERE finished>=? AND finished<?
                                  AND student_id IN ({','.join('?' * len(ids))}) GROUP BY student_id""", (t0, t1, *ids)):
                    rows.setdefault(r["student_id"], {})["exam"] = r["exam"]
                # вне тренажёра за период: все уходы со страницы (и в заданиях, и в варианте)
                for r in db.q(f"""SELECT student_id, COUNT(*) AS c, SUM(dur) AS sec FROM activity WHERE kind = 'away'
                                  AND ts>=? AND ts<? AND student_id IN ({','.join('?' * len(ids))}) GROUP BY student_id""", (t0, t1, *ids)):
                    rows.setdefault(r["student_id"], {}).update(out_n=r["c"], out_sec=round(r["sec"] or 0))
            out = []
            for m in members:
                r = rows.get(m["id"], {})
                nums = sorted({int(x) for x in str(r.get("nums") or "").split(",") if x.strip().isdigit()})
                out.append({"id": m["id"], "name": m["name"], "answers": r.get("answers") or 0, "tasks": r.get("tasks") or 0,
                            "solved": r.get("solved") or 0, "ok1": r.get("ok1") or 0, "ok2": r.get("ok2") or 0,
                            "bad": r.get("bad") or 0, "shown": r.get("shown") or 0, "spent": r.get("spent") or 0,
                            "away": r.get("away") or 0, "first": r.get("first"), "last": r.get("last"), "nums": nums,
                            "exam": r.get("exam"), "sus": r.get("sus") or 0, "paste": r.get("paste") or 0,
                            "out_n": r.get("out_n") or 0, "out_sec": r.get("out_sec") or 0})
            return self.send_json({"rows": out, "asg_total": len(asg_tasks) if asg_tasks is not None else None})

        if path == "/api/admin/assignments":
            cid = to_int(qs.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            APP.bank.ensure()
            members = db.q("SELECT id, name FROM students WHERE class_id=? ORDER BY name", (cid,))
            asg_expire(self, db, cid)
            out = []
            batches = {}
            for a in db.q("SELECT * FROM assignments WHERE class_id=? AND student_id IS NOT NULL ORDER BY created DESC", (cid,)):
                real = json.loads(a["tasks"] or "[]")
                b = batches.setdefault(a["batch"] or f"one:{a['id']}", {"batch": a["batch"] or f"one:{a['id']}", "title": batch_title(a),
                                                                       "kind": a["kind"], "created": a["created"], "due": a["due"],
                                                                       "students": 0, "done": 0, "tasks": 0})
                b["students"] += 1
                b["tasks"] += len(real)
                b["done"] += len(assignment_done(db, a["student_id"], real, a["created"])) >= len(real) > 0
            for a in db.q("SELECT * FROM assignments WHERE class_id=? AND student_id IS NULL ORDER BY created DESC", (cid,)):
                real = json.loads(a["tasks"] or "[]")
                prog = [{"id": m["id"], "name": m["name"], "done": len(assignment_done(db, m["id"], real, a["created"]))}
                        for m in members]
                out.append({"id": a["id"], "title": a["title"], "due": a["due"], "created": a["created"],
                            "strict": bool(a["strict"]), "kind": a["kind"] or "self", "closed": a["closed"], "grading": asg_grading(a),
                            "tasks": [{"id": i, "n": (APP.bank.tasks.get(i) or {}).get("n"),
                                       "c": (APP.bank.tasks.get(i) or {}).get("c"), "r": (APP.bank.tasks.get(i) or {}).get("r"),
                                       "cname": dict(clusters.labels((APP.bank.tasks.get(i) or {}).get("n"))).get((APP.bank.tasks.get(i) or {}).get("c"), ""),
                                       "snip": APP.bank.snippet(i), "missing": i not in APP.bank.tasks} for i in real],
                            "progress": prog})
            return self.send_json({"assignments": out, "batches": list(batches.values())})

        if path == "/api/admin/class/journal":
            # журнал класса: оценки по всем подборкам и точность по номерам ЕГЭ у каждого ученика
            cid = to_int(qs.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            APP.bank.ensure()
            members = db.q("""SELECT id, name, forecast, fc FROM students WHERE class_id=? AND COALESCE(is_teacher, 0) = 0
                              ORDER BY name""", (cid,))
            asg_expire(self, db, cid)
            cols, cells = [], {m["id"]: {} for m in members}
            by_batch = {}
            for a in db.q("SELECT * FROM assignments WHERE class_id=? ORDER BY created", (cid,)):
                real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
                if a["student_id"]:
                    # личные подборки одной серии (работа над ошибками, слабые места) — одна колонка
                    key = "b:" + (a["batch"] or str(a["id"]))
                    if key not in by_batch:
                        by_batch[key] = {"id": key, "title": batch_title(a), "kind": a["kind"] or "practice", "created": a["created"],
                                         "due": a["due"], "closed": a["closed"], "total": len(asg_items(real)), "personal": True}
                        cols.append(by_batch[key])
                    if a["student_id"] in cells:
                        cells[a["student_id"]][key] = dict(asg_cell(db, a, a["student_id"], real), asg=a["id"], total=len(asg_items(real)))
                    continue
                cols.append({"id": a["id"], "title": a["title"], "kind": a["kind"] or "self", "created": a["created"],
                             "due": a["due"], "closed": a["closed"], "total": len(asg_items(real))})
                for m in members:
                    cells[m["id"]][a["id"]] = asg_cell(db, a, m["id"], real)
            ids = [m["id"] for m in members]
            nums = {}
            if ids:
                # точность по номерам — первая попытка в тренажёре и подборках, без вариантов ЕГЭ
                for r in db.q(f"""SELECT student_id, n, COUNT(*) AS a, SUM(score = 1) AS ok FROM attempts
                                  WHERE student_id IN ({','.join('?' * len(ids))}) AND n IS NOT NULL AND exam IS NULL
                                  AND COALESCE(gave_up, 0) = 0 GROUP BY student_id, n""", ids):
                    cur = nums.setdefault(r["student_id"], {}).setdefault(n_key(r["n"]), [0, 0])
                    cur[0] += r["a"]
                    cur[1] += r["ok"] or 0
            return self.send_json({"assignments": cols, "students": [{"id": m["id"], "name": m["name"], "cells": cells[m["id"]],
                                                                      "nums": nums.get(m["id"], {}), "fc": forecast_trend(m),
                                                                      "exam": exam_summary(db, m["id"])}
                                                                     for m in members]})

        if path == "/api/admin/class/digest":
            # сводка недели: кто не занимался, у кого просели номера, кто не сдал работы, кто молодец
            cid = to_int(qs.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            APP.bank.ensure()
            asg_expire(self, db, cid)
            return self.send_json(class_digest(db, cid))

        if path == "/api/admin/class/weak" and method == "POST":
            # каждому ученику — своя практическая подборка: по N заданий на его K самых слабых номеров
            cid = to_int(data.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            per = min(max(to_int(data.get("per")) or 3, 1), 10)
            k = min(max(to_int(data.get("nums")) or 3, 1), 5)
            days = min(max(to_int(data.get("days")) or 7, 1), 60)
            made, skipped = weak_sets(db, cid, per, k, days, bool(self.T["authored"]))
            return self.send_json({"ok": True, "made": made, "skipped": skipped})

        if path == "/api/admin/batch/delete" and method == "POST":
            cid = to_int(data.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            batch = str(data.get("batch") or "")
            if batch.startswith("one:"):
                db.x("DELETE FROM assignments WHERE id=? AND class_id=? AND student_id IS NOT NULL", (to_int(batch[4:]), cid))
            else:
                db.x("DELETE FROM assignments WHERE batch=? AND class_id=? AND student_id IS NOT NULL", (batch, cid))
            return self.send_json({"ok": True})

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
                i = (APP.bank.tasks.get(i) or {}).get("group") or i      # вопрос 19–21 — в подборку идёт вся игра
                if i in APP.bank.tasks and i not in tasks:
                    tasks.append(i)
            if not tasks:
                return self.err(400, "В подборке нет ни одного задания")
            tasks = tasks[:100]
            due = to_float(data.get("due")) or None
            aid = to_int(data.get("id"))
            kind = data.get("kind") if data.get("kind") in ASG_KINDS else "self"
            strict = 1 if kind == "self" else 0      # самостоятельная — проверка после сдачи; практическая и домашняя — сразу
            g = data.get("grading") if isinstance(data.get("grading"), dict) else {}
            grading = json.dumps({k: max(0, min(100, to_int(g.get(k, v)))) for k, v in ASG_GRADES.items()})
            if aid:
                old = db.q("SELECT strict, kind, tasks FROM assignments WHERE id=? AND class_id=?", (aid, cid), one=True)
                if old and old["strict"] and db.q("SELECT 1 FROM asg_runs WHERE asg_id=? LIMIT 1", (aid,), one=True):
                    if kind != "self":
                        return self.err(409, "Самостоятельную уже начали писать — тип работы менять нельзя")
                    if json.loads(old["tasks"]) != tasks:
                        return self.err(409, "Самостоятельную уже начали писать — состав заданий менять нельзя")
                prev = db.q("SELECT closed, due FROM assignments WHERE id=?", (aid,), one=True)
                db.x("UPDATE assignments SET title=?, tasks=?, due=?, strict=?, grading=?, kind=? WHERE id=? AND class_id=?",
                     (title, json.dumps(tasks), due, strict, grading, kind, aid, cid))
                # продлили срок у работы, закрытой по сроку (closed = прежний срок), — она снова открыта;
                # закрытую учителем вручную не трогаем
                if prev and prev["closed"] and prev["due"] and prev["closed"] == prev["due"] and (not due or due > now):
                    db.x("UPDATE assignments SET closed=NULL WHERE id=?", (aid,))
            else:
                aid = db.x("INSERT INTO assignments(class_id,title,tasks,created,due,strict,grading,kind) VALUES(?,?,?,?,?,?,?,?)",
                           (cid, title, json.dumps(tasks), now, due, strict, grading, kind))
            return self.send_json({"ok": True, "id": aid})

        if path == "/api/admin/assignment/delete" and method == "POST":
            a = db.q("SELECT class_id FROM assignments WHERE id=?", (to_int(data.get("id")),), one=True)
            if not a or not self.sees_class(a["class_id"]):
                return self.err(404, "подборка не найдена")
            db.x("DELETE FROM assignments WHERE id=?", (to_int(data.get("id")),))
            db.x("DELETE FROM asg_runs WHERE asg_id=?", (to_int(data.get("id")),))
            return self.send_json({"ok": True})

        if path in ("/api/admin/asg/live", "/api/admin/asg/close"):
            # контрольная онлайн: кто пишет, сколько сдал, сколько верно; «Завершить для всех»
            aid = to_int(qs.get("id") or data.get("id"))
            a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
            if not a or not self.sees_class(a["class_id"]):
                return self.err(404, "подборка не найдена")
            APP.bank.ensure()
            real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
            if path == "/api/admin/asg/close":
                if method != "POST":
                    return self.err(405, "нужен POST")
                if data.get("reopen"):
                    # открыть снова: прошедший срок снимаем, иначе работа тут же закроется по сроку
                    db.x("UPDATE assignments SET closed=NULL, due=CASE WHEN due < ? THEN NULL ELSE due END WHERE id=?", (now, aid))
                    return self.send_json({"ok": True})
                db.x("UPDATE assignments SET closed=? WHERE id=?", (now, aid))
                a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
                n = 0
                for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (aid,)):
                    st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                    if st:
                        asg_finish_run(self, db, a, st, real, forced=1)
                        n += 1
                return self.send_json({"ok": True, "finished": n})
            items = asg_items(real)
            sols = {}                              # сколько решений (кода) прикреплено к заданиям работы
            if real:
                for x in db.q(f"""SELECT student_id, COUNT(*) AS c FROM solutions WHERE task_id IN ({','.join('?' * len(real))})
                                  AND ts >= ? GROUP BY student_id""", (*real, a["created"] or 0)):
                    sols[x["student_id"]] = x["c"]
            if not a["strict"]:
                rows = []
                for m in db.q("SELECT id, name, last_seen FROM students WHERE class_id=? AND (? IS NULL OR id=?) ORDER BY name",
                              (a["class_id"], a["student_id"], a["student_id"])):
                    sc = practice_score(db, a, m["id"], real)
                    rows.append({"id": m["id"], "name": m["name"], "total": len(items), "answered": sc["tried"],
                                 "status": "done" if sc["tried"] >= len(items) else "work" if sc["tried"] else "none",
                                 "ok": sc["ok"], "half": sc["half"], "bad": sc["bad"], "pct": sc["pct"], "grade": sc["grade"],
                                 "attempts": sc["attempts"], "online": bool(m["last_seen"] and now - m["last_seen"] < 60),
                                 "sol": sols.get(m["id"], 0), "tasks": len(real)})
                return self.send_json({"id": aid, "title": a["title"], "strict": False, "kind": a["kind"], "closed": a["closed"],
                                       "grading": asg_grading(a), "total": len(items), "rows": rows})
            runs = {r["student_id"]: r for r in db.q("SELECT * FROM asg_runs WHERE asg_id=?", (aid,))}
            rows = []
            for m in db.q("SELECT id, name, last_seen FROM students WHERE class_id=? AND (? IS NULL OR id=?) ORDER BY name",
                          (a["class_id"], a["student_id"], a["student_id"])):
                r = runs.get(m["id"])
                row = {"id": m["id"], "name": m["name"], "status": "none", "answered": 0, "total": len(items),
                       "sol": sols.get(m["id"], 0), "tasks": len(real)}
                if r:
                    answers = json.loads(r["answers"] or "{}")
                    res = json.loads(r["result"]) if r["finished"] else asg_score(answers, items)
                    got = [v for k, v in res.items() if k in answers]
                    row.update(status="done" if r["finished"] else "work", answered=len(answers), started=r["started"],
                               finished=r["finished"], last=r["last"], away=r["away"] or 0, fs=r["fs"] or 0, forced=bool(r["forced"]),
                               ok=sum(1 for v in got if v == 1), half=sum(1 for v in got if v == 0.5),
                               bad=sum(1 for v in got if v == 0 or v is None),
                               pct=r["pct"] if r["finished"] else int(100 * sum(v or 0 for v in res.values()) / len(items) + 0.5) if items else 0,
                               grade=r["grade"], online=bool(m["last_seen"] and now - m["last_seen"] < 60))
                rows.append(row)
            return self.send_json({"id": aid, "title": a["title"], "strict": bool(a["strict"]), "closed": a["closed"],
                                   "grading": asg_grading(a), "total": len(items), "rows": rows})

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
            pool = [tid for tid in bank_pool({n}, authored_ok=bool(self.T["authored"])) if tid not in skip]
            pick = secrets.SystemRandom().sample(pool, min(k, len(pool)))
            return self.send_json({"tasks": [{"id": i, "n": n, "snip": APP.bank.snippet(i)} for i in pick]})

        if path == "/api/admin/bank/catalog":
            # справочник для конструктора подборки: типы заданий по номерам, банки, годы
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            years = sorted({t.get("y") for t in APP.bank.tasks.values() if t.get("y")})
            banks = {}
            for t in APP.bank.tasks.values():
                if not t.get("group"):
                    banks[t.get("bank")] = banks.get(t.get("bank"), 0) + 1
            classes = [dict(r) for r in db.q("SELECT id, name FROM classes WHERE COALESCE(teacher_id, ?) = ? ORDER BY name",
                                             (main_teacher()["id"], self.T["id"]))]
            return self.send_json({"clusters": clusters.catalog(), "ranks": clusters.RANK_NAMES, "years": years,
                                   "banks": [{"id": b, "title": APP.bank.titles.get(b, b), "count": c} for b, c in sorted(banks.items())],
                                   "classes": classes})

        if path == "/api/admin/bank/search":
            # конструктор подборки: широкий фильтр по банку (номер, тип, сложность, банк, год, решаемость, текст)
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            lst = lambda k: [x for x in str(qs.get(k) or "").split(",") if x]
            nums = {to_int(x) for x in lst("n")}
            cls_keys, ranks, banks = set(lst("c")), {to_int(x) for x in lst("r")}, set(lst("bank"))
            y0, y1 = to_int(qs.get("y0")), to_int(qs.get("y1"))
            fmt, rate, q = qs.get("fmt") or "actual", qs.get("rate") or "", (qs.get("q") or "").strip().lower().replace("ё", "е")
            skip_class = to_int(qs.get("notsolved"))
            rates = task_rates(db)
            solved_by_class = set()
            if skip_class and self.sees_class(skip_class):
                ids = [r["id"] for r in db.q("SELECT id FROM students WHERE class_id=?", (skip_class,))]
                if ids:
                    solved_by_class = {r["t"] for r in db.q(
                        f"SELECT DISTINCT COALESCE(grp, task_id) AS t FROM attempts WHERE score > 0 AND student_id IN ({','.join('?' * len(ids))})", ids)}
            out, facet_c, facet_r = [], {}, {}
            for tid, t in APP.bank.tasks.items():
                if t.get("group"):
                    continue                     # части 19–21 — только игрой целиком
                n = t.get("n")
                if nums and n not in nums:
                    continue
                ok_c = not cls_keys or f"{n}:{t.get('c')}" in cls_keys
                ok_r = not ranks or t.get("r") in ranks
                if not ok_c and not ok_r:
                    continue
                if banks and t.get("bank") not in banks:
                    continue
                if (y0 and (t.get("y") or 0) < y0) or (y1 and (t.get("y") or 9999) > y1):
                    continue
                if fmt == "actual" and task_outdated(t) or fmt == "old" and not task_outdated(t):
                    continue
                if not self.T["authored"] and is_authored(t.get("src"), t.get("html")):
                    continue
                tries, ok = rates.get(tid, (0, 0))
                share = ok / tries if tries else None
                if rate == "none" and tries:
                    continue
                if rate in ("lo", "mid", "hi"):
                    if share is None or tries < RATE_MIN:
                        continue
                    if rate == "lo" and share >= 0.4 or rate == "mid" and not 0.4 <= share < 0.75 or rate == "hi" and share < 0.75:
                        continue
                if tid in solved_by_class:
                    continue
                if q and q not in clusters.plain(t.get("html")) and q not in tid.lower():
                    continue
                # счётчики у кнопок фильтра: сколько найдётся, если включить эту кнопку (без учёта своего же фильтра)
                if ok_r:
                    k = f"{n}:{t.get('c')}"
                    facet_c[k] = facet_c.get(k, 0) + 1
                if ok_c:
                    facet_r[t.get("r")] = facet_r.get(t.get("r"), 0) + 1
                if ok_c and ok_r:
                    out.append((t, tries, share))
            sort = qs.get("sort") or "rank"
            keyf = {"rank": lambda x: (x[0].get("n"), x[0].get("r") or 3, -(x[2] if x[2] is not None else 0.5)),
                    "hard": lambda x: (x[0].get("n"), -(x[0].get("r") or 3), x[2] if x[2] is not None else 0.5),
                    "rate": lambda x: (x[2] if x[2] is not None else 2, x[0].get("n")),
                    "new": lambda x: (-(x[0].get("y") or 0), x[0].get("n"))}.get(sort)
            if keyf:
                out.sort(key=keyf)
            else:
                secrets.SystemRandom().shuffle(out)
            page, per = max(0, to_int(qs.get("page")) or 0), 40
            names = {n: dict(v) for n, v in ((n, clusters.labels(n)) for n in range(1, 28))}
            row = lambda t, tries, share: {
                "id": t["id"], "n": t.get("n"), "c": t.get("c"), "cname": names.get(t.get("n"), {}).get(t.get("c"), ""),
                "r": t.get("r"), "bank": APP.bank.titles.get(t.get("bank"), t.get("bank")), "y": t.get("y"),
                "src": t.get("src"), "tries": tries, "rate": round(share, 2) if share is not None and tries >= RATE_MIN else None,
                "snip": APP.bank.snippet(t["id"]), "old": task_outdated(t)}
            rows = [row(*x) for x in out[page * per:(page + 1) * per]]
            pool = None
            if qs.get("pool"):
                # для «случайных из найденных» и «по N на номер»: случайные из ВСЕХ найденных, до 60 на каждый номер
                by_n = {}
                for x in out:
                    by_n.setdefault(x[0].get("n"), []).append(x)
                rnd = secrets.SystemRandom()
                pool = [row(*x) for lst in by_n.values() for x in rnd.sample(lst, min(60, len(lst)))]
            return self.send_json({"total": len(out), "page": page, "per": per, "tasks": rows, "pool": pool,
                                   "facets": {"c": facet_c, "r": facet_r}})

        if path == "/api/admin/info":
            n_tasks = len(APP.bank.tasks) if APP.bank.ensure() else 0
            cond, args = self.student_scope()
            return self.send_json({"tasks": n_tasks, "authored_tasks": APP.bank.authored, "authored_on": bool(self.T["authored"]),
                                   "bank_built": APP.bank.mtime, "missing_media": APP.bank.missing_dirs,
                                   "invite": self.T["invite"],
                                   "course_set": bool(db.setting("course_pw")),
                                   "course_students": db.q("SELECT COUNT(*) c FROM students WHERE course=1", one=True)["c"],
                                   "students": db.q(f"SELECT COUNT(*) c FROM students s WHERE {cond}", args, one=True)["c"],
                                   "attempts": db.q(f"SELECT COUNT(*) c FROM attempts a JOIN students s ON s.id=a.student_id WHERE {cond}",
                                                    args, one=True)["c"]})

        return self.err(404, "нет такого метода")


REASONS = {"exam": "вариант ЕГЭ", "search": "найдено поиском", "fav": "избранное", "history": "повтор из истории",
           "new": "новое", "review": "повторение после ошибки", "retry": "работа над ошибкой",
           "weak": "слабое место", "repeat": "повтор решённого", "asg": "подборка учителя", "work": "самостоятельная", "": ""}


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
# своё звание на каждом уровне; после последнего — «Абсолют II, III…»
LEVEL_NAMES = ["Новичок", "Стажёр", "Ученик", "Юный кодер", "Кодер", "Отладчик", "Программист", "Алгоритмист",
               "Повелитель циклов", "Мастер рекурсии", "Хакер", "Знаток графов", "Архитектор", "Олимпиадник", "Гуру",
               "Магистр алгоритмов", "Профи ЕГЭ", "Профессор", "Гроссмейстер", "Легенда", "Сверхразум", "Титан",
               "Император кода", "Бессмертный", "Абсолют"]
LEVEL_TITLES = list(enumerate(LEVEL_NAMES, 1))
ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]


def level_title(lvl):
    if lvl <= len(LEVEL_NAMES):
        return LEVEL_NAMES[max(1, lvl) - 1]
    k = lvl - len(LEVEL_NAMES) + 1
    return f"{LEVEL_NAMES[-1]} {ROMAN[k] if k < len(ROMAN) else k}"
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
    # смешные и пасхальные
    ("exam67", "67!", "SIX SEVEN на экзамене", "Набрать за вариант ровно 67 баллов", 1),
    ("turtle", "🐢", "Повелитель черепах", "Решить 15 заданий №6 с Черепахой", 15),
    ("bug", "BUG", "Это не баг, это фича", "Ошибиться 5 раз подряд — и всё равно решить следующее", 1),
    ("phoenix", "🔥", "Феникс", "Вернуться к занятиям после перерыва в неделю и больше", 1),
    ("cinderella", "00:00", "Золушка", "Решить задание ровно в полночь — с 00:00 до 00:05", 1),
    ("weekend", "ZZZ", "Выходной? Не слышал", "Решить 20 заданий за субботу или воскресенье", 20),
    ("fri13", "13", "Пятница, 13-е", "Решить задание в пятницу 13-го. Страшно? Нет, программист", 1),
    ("pi", "π", "День числа π", "Решить задание 14 марта", 1),
    ("newyear", "🎄", "Оливье подождёт", "Решить задание 31 декабря или 1 января", 1),
    ("stubborn", "🐏", "Упрямец", "Решить задание, которое до этого не вышло три раза", 1),
    ("peek", "👀", "Подглядыватель", "Посмотреть ответ 10 раз. Никто не видел… кроме сервера", 10),
    ("lunch", "🍕", "Обеденный перерыв", "Решить 5 заданий с 12:00 до 14:00 за один день", 5),
    ("snail", "🐌", "Медленно, но верно", "Решить задание, просидев над ним больше получаса", 1),
    ("rainbow", "🌈", "Радуга", "Решить 7 разных номеров за один день", 7),
    ("perfect", "💎", "Идеальный день", "10 ответов за день — и все верные с первой попытки", 1),
    ("binge", "📺", "Ещё одну серию", "Решить 15 заданий одного номера подряд", 15),
    ("speedrun", "🏎", "Спидран", "Завершить вариант быстрее чем за час и набрать 60+", 1),
    ("lucky", "🍀", "Новичкам везёт", "Самое первое задание №27 — и сразу верно", 1),
]
# опыт за достижение — по трудности: лёгкие 5–15, средние 20–40, трудные 50–100, редкие 150–300
ACH_XP = {
    "first": 5, "s10": 10, "s100": 50, "s500": 150, "s1000": 300, "row10": 30, "row25": 80, "hard10": 40,
    "all27": 60, "fix20": 40, "day50": 80, "days7": 50, "days30": 200, "night": 10, "early": 10,
    "exam1": 30, "exam80": 100, "exam100": 300, "exam67": 30, "turtle": 20, "flash": 15, "bug": 15,
    "phoenix": 20, "cinderella": 25, "weekend": 30, "fri13": 20, "pi": 20, "newyear": 30,
    "stubborn": 15, "peek": 5, "lunch": 15, "snail": 10, "rainbow": 30, "perfect": 40, "binge": 40,
    "speedrun": 80, "lucky": 25, "dejavu": 10,
}
EXAM_MIN_SEC_FOR_XP = 20 * 60          # вариант, сданный быстрее, опыта не даёт (иначе его «фармят»)


FAST_XP_MS = 60000          # верный ответ быстрее минуты с открытия задания…
FAST_XP_PENALTY = -1        # …даёт −1 XP вместо опыта
_FAST_SINCE = []


def fast_xp_since(db):
    """С какого момента действует правило «быстрее минуты — минус опыт» (раньше решённое не пересчитываем)."""
    if not _FAST_SINCE:
        _FAST_SINCE.append(to_float(db.setting("fast_xp_since")) or 0)
    return _FAST_SINCE[0]


WORK_REASON = "work"        # ответ, записанный сервером при сдаче контрольной


EXPLOIT_MIN = 10           # столько быстрых повторов уже решённого из подборки подряд — лазейка, а не повторение
EXPLOIT_FAST_MS = 30000    # «быстрый» повтор — меньше 30 секунд на задание
EXPLOIT_SPAN = 30 * 60     # и все они — в пределах получаса


def exploit_window(db, rows, skips):
    """Перерешивал подборку по кругу ради опыта (лазейка закрыта в 1.37.1): с начала такой серии и до исправления
    весь опыт срезается. Серия — EXPLOIT_MIN повторов уже решённого с «почему выдано: подборка», каждый быстрее
    30 секунд, в пределах получаса. Обычное повторение (подборки курса, «Повторить») под это не попадает.
    Возвращает (с, до) или None."""
    fixed = to_float(db.setting("asg_exploit_fixed")) or time.time()
    hits = [r["ts"] for r, sk in zip(rows, skips)
            if sk and r["reason"] == "asg" and (r["score"] or 0) > 0 and r["ts"] < fixed
            and r["spent_ms"] is not None and r["spent_ms"] < EXPLOIT_FAST_MS]
    for i in range(len(hits) - EXPLOIT_MIN + 1):
        if hits[i + EXPLOIT_MIN - 1] - hits[i] <= EXPLOIT_SPAN:
            return (hits[i], fixed)
    return None


def reward_skips(rows, fast_since):
    """Какие ответы журнала не дают ни опыта, ни огонька, ни серий, ни достижений (по всей истории):
    задание уже решено раньше или ученик уже видел правильный ответ (после ошибок, «Показать ответ»,
    в варианте ЕГЭ, в разборе контрольной). Иначе опыт «фармят»: ошибиться дважды, увидеть ответ,
    открыть задание из истории и ввести его. Контрольная и вариант ЕГЭ считаются по своим правилам."""
    solved, shown, out = set(), set(), []
    for r in rows:
        tid, sc = r["task_id"], r["score"] or 0
        if r["exam"]:
            out.append(False)
            if sc < 1 and r["revealed"]:
                shown.add(tid)
            continue
        # исключение — только ответы сданной контрольной (метку ставит сервер). «Почему выдано» из браузера
        # (например «asg») не в счёт: его можно подставить и перерешивать одно и то же за опыт
        skip = (tid in solved or tid in shown) and r["reason"] != WORK_REASON
        out.append(skip)
        if skip:
            continue
        if sc > 0 and not (r["spent_ms"] is not None and r["spent_ms"] < FAST_XP_MS and r["ts"] >= fast_since):
            solved.add(tid)
        if sc < 1 and (r["revealed"] or r["reason"] in (WORK_REASON, "asg")):
            shown.add(tid)
    return out


def last_attempt_skipped(db, sid):
    """Последний ответ ученика не засчитан (задание уже решено или ответ был показан)."""
    rows = db.q("""SELECT task_id, score, ts, exam, reason, revealed, spent_ms FROM attempts WHERE student_id=?
                   ORDER BY ts, id""", (sid,))
    return bool(rows) and reward_skips(rows, fast_xp_since(db))[-1]


def task_xp(n, r=None):
    """Опыт за задание, решённое впервые: №1–10 — 10 XP, №11–27 — столько, какой номер,
    и +5 XP за каждую ступень сложности выше первой (сложность 1–5: от +0 до +20)."""
    n = n or 0
    base = 10 if n <= 10 else n
    return base + 5 * (max(1, min(5, int(r or 1))) - 1)


def level_of(xp):
    """Уровень L достигается при 50·L·(L−1) опыта: 100 до 2-го, ещё 200 до 3-го и т. д."""
    lvl = 1
    while 50 * (lvl + 1) * lvl <= xp:
        lvl += 1
    lo, hi = 50 * lvl * (lvl - 1), 50 * (lvl + 1) * lvl
    title = level_title(lvl)
    return lvl, title, xp - lo, hi - lo


def week_start(ts=None):
    """Понедельник 00:00 (время сервера) недели, в которую попадает ts."""
    d = datetime.fromtimestamp(ts if ts is not None else time.time()).date()
    return time.mktime((d - timedelta(days=d.weekday())).timetuple())


def week_key(ts=None):
    return datetime.fromtimestamp(week_start(ts)).strftime("%Y-%m-%d")


# Краткая сводка (опыт, уровень, огонёк) нужна рейтингу для всех учеников сразу, а он перезапрашивается
# после каждого ответа. Пересчёт по всему журналу дорогой — кэшируем, пока у ученика не появилось новых
# ответов, поправок опыта или вариантов (и не дольше 5 минут: окна «неделя/месяц» скользят).
_GS_CACHE = {}
_GS_LOCK = threading.Lock()


def _gs_stamp(db, sid):
    a = db.q("SELECT MAX(id) m, COUNT(*) c FROM attempts WHERE student_id=?", (sid,), one=True)
    x = db.q("SELECT COUNT(*) c, COALESCE(SUM(delta), 0) s FROM xp_adjust WHERE student_id=?", (sid,), one=True)
    e = db.q("SELECT COUNT(*) c FROM exams WHERE student_id=? AND finished IS NOT NULL", (sid,), one=True)
    return (a["m"], a["c"], x["c"], x["s"], e["c"], time.strftime("%Y-%m-%d"), int(time.time() // 300))


COURSE_TRIES, COURSE_WINDOW = 8, 15 * 60  # попыток ввести пароль курса за 15 минут
_COURSE_TRIES = {}
_COURSE_LOCK = threading.Lock()


def course_open(s):
    """Курс открыт ученику, если он ввёл пароль, а учитель не выключил курс."""
    if s["is_teacher"]:
        return True                      # учителю курс открыт без пароля
    return bool(s["course"]) and bool(APP.db.setting("course_pw"))


_LB_PEOPLE = {}                         # учитель → (когда собран, строки рейтинга)
_LB_BUILD = threading.Lock()            # собирает один запрос, остальные не дублируют работу
LB_TTL = 15


def lb_person(db, m, crown, crowns=None):
    """Строка рейтинга: опыт за день/неделю/месяц, огонёк, лига, значки."""
    g = game_summary(db, m["id"], brief=True)
    lg = league_row(db, m["id"])["league"]
    return {"sid": m["id"], "name": short_name(m["name"]), "level": g["level"],
            "badges": nick_badges(db, m, g, lg, crown, crowns or {}), "league": lg,
            "class_id": m["class_id"], "crown": crown if m["id"] == crown else None,
            "day": g["day"], "week": g["week"], "month": g["month"], "fire": g["fire"], "wk": g["wk"]}


# ---------------------------------------------------------------- награды профиля
# повторяемые награды — со счётчиком; достижения (ACHIEVEMENTS) даются один раз
AWARDS = [("crown", "👑", "Корона дня", "Быстрее всех решил задание дня"),
          ("league1", "🏆", "Победитель лиги", "1-е место в своей лиге по итогам недели"),
          ("up", "🚀", "Повышение", "Перешёл в лигу выше"),
          ("duel", "⚔️", "Победа в дуэли", "Выиграл дуэль"),
          ("tour1", "🎖", "Победитель турнира", "1-е место в турнире")]
BADGES_MAX = 3


def crown_counts(db, ids):
    """Сколько раз у каждого была 👑: дни до сегодняшнего, когда он быстрее всех (из этих учеников) решил задание дня."""
    if not ids:
        return {}
    best = {}
    today = datetime.now().date().isoformat()
    for r in db.q(f"SELECT day, student_id, ms, ts FROM daily_results WHERE day<? AND student_id IN ({','.join('?' * len(ids))})",
                  (today, *ids)):
        k = (r["ms"] if r["ms"] is not None else 1e18, r["ts"] or 0)
        if r["day"] not in best or k < best[r["day"]][0]:
            best[r["day"]] = (k, r["student_id"])
    out = {}
    for _, sid in best.values():
        out[sid] = out.get(sid, 0) + 1
    return out


def award_counts(db, sid, crowns):
    n = {"crown": crowns.get(sid, 0)}
    for r in db.q("SELECT kind, COUNT(*) AS c FROM awards WHERE student_id=? GROUP BY kind", (sid,)):
        n[r["kind"]] = r["c"]
    n["duel"] = db.q("SELECT COUNT(*) AS c FROM duels WHERE status='finished' AND winner=?", (sid,), one=True)["c"]
    return n


def badge_options(db, sid, g, lg, crowns, ach=None):
    """Всё, что можно поставить у ника: ключ → {i, t, d, n}. n — сколько раз получена (у повторяемых)."""
    cnt = award_counts(db, sid, crowns)
    out = {}
    for k, i, t, d in AWARDS:
        if cnt.get(k):
            out[k] = {"i": i, "t": t, "d": d, "n": cnt[k]}
    if g["fire"] >= 1:
        out["fire"] = {"i": "🔥", "t": "Огонёк", "d": "Дней подряд с решёнными заданиями", "n": g["fire"]}
    if lg == len(LEAGUES) - 1:
        out["diamond"] = {"i": "💎", "t": "Алмазная лига", "d": "Сейчас в высшей лиге"}
    for a in (ach or []):
        if a["got"]:
            out["a:" + a["id"]] = {"i": a["icon"], "t": a["title"], "d": a["desc"]}
    return out


def chosen_badges(m):
    try:
        v = json.loads(m["badges"]) if m["badges"] else None
    except (ValueError, TypeError, IndexError, KeyError):
        v = None
    return [str(x) for x in v][:BADGES_MAX] if isinstance(v, list) else None


def badge_pub(key, o):
    """Значок у ника: число показываем у огонька и у повторяемых наград, полученных больше одного раза."""
    n = o.get("n") or 0
    return {"k": key, "i": o["i"], "t": o["t"], "n": n if key == "fire" or n > 1 else 0}


def nick_badges(db, m, g, lg, crown, crowns):
    chosen = chosen_badges(m)
    if chosen is None:                 # не выбирал сам — как раньше: огонёк 7+, корона сегодня, алмазная лига
        opts = badge_options(db, m["id"], g, lg, crowns)
        keys = ([k for k in ("fire",) if g["fire"] >= 7] + (["crown"] if m["id"] == crown and "crown" in opts else [])
                + (["diamond"] if "diamond" in opts else []))
    else:
        need_ach = any(k.startswith("a:") for k in chosen)
        opts = badge_options(db, m["id"], g, lg, crowns, game_summary(db, m["id"])["ach"] if need_ach else None)
        keys = [k for k in chosen if k in opts]
    return [badge_pub(k, opts[k]) for k in keys]


def game_summary(db, sid, brief=False, windows=None):
    if not brief or windows:
        return _game_summary(db, sid, brief, windows)
    stamp = _gs_stamp(db, sid)
    with _GS_LOCK:
        hit = _GS_CACHE.get(sid)
    if hit and hit[0] == stamp:
        return dict(hit[1])
    out = _game_summary(db, sid, True)
    with _GS_LOCK:
        if len(_GS_CACHE) > 20000:
            _GS_CACHE.clear()
        _GS_CACHE[sid] = (stamp, out)
    return dict(out)


def _game_summary(db, sid, brief=False, windows=None):
    """Опыт, уровень и достижения. windows — {имя: (с, до)}: опыт за произвольные промежутки (лиги, прошлая неделя)."""
    windows = windows or {}
    sums = {k: 0 for k in windows}
    rows = db.q("""SELECT task_id, grp, n, score, ts, exam, spent_ms, gave_up, reason, revealed FROM attempts WHERE student_id=? ORDER BY ts, id""", (sid,))
    exams = db.q("""SELECT started, finished, primary_score, test_score FROM exams
                    WHERE student_id=? AND finished IS NOT NULL ORDER BY finished""", (sid,))
    now = time.time()
    week0, month0 = now - 7 * 86400, now - 30 * 86400
    day0 = time.mktime(datetime.now().date().timetuple())          # сегодня с 00:00 (время сервера)
    xp = week = xp_day = xp_month = 0
    fire_days = {}                     # день → заданий (как огонёк на сайте: любые ответы, и в варианте тоже)
    solved, failed = set(), set()
    cnt = {k: 0 for k in ("solved", "row", "best_row", "hard", "fix", "night", "early",
                          "turtle", "flash", "fails", "bug", "phoenix", "cinderella", "fri13", "pi", "newyear",
                          "stubborn", "peek", "snail", "perfect", "binge", "best_binge", "lucky", "dejavu")}
    prev_day = None
    fails_of, solves_of = {}, {}        # задание → сколько раз не вышло / решено
    lunch_of, nums_of, ans_of, bad_of = {}, {}, {}, {}   # по дням
    binge_n, seen27 = None, False
    nums, per_day, days = set(), {}, set()
    got = {}

    wk0 = week_start(now)
    xp_wk = 0
    fast_since = fast_xp_since(db)

    xplog = []                                     # последние изменения опыта с причиной — показываем ученику

    def gain(v, ts, why=None):
        nonlocal xp, week, xp_day, xp_month, xp_wk
        if v > 0 and cheat and cheat[0] <= ts < cheat[1]:
            if why:
                xplog.append((ts, 0, why + " — срезано: накрутка"))
            return                                 # опыт, набранный пока пользовался лазейкой, — срезан целиком
        if why:
            xplog.append((ts, v, why))
        xp += v
        if ts >= wk0:
            xp_wk += v
        for k, (a, b) in windows.items():
            if a <= ts < b:
                sums[k] += v
        if ts >= week0:
            week += v
        if ts >= month0:
            xp_month += v
        if ts >= day0:
            xp_day += v

    skips = reward_skips(rows, fast_since)
    cheat = exploit_window(db, rows, skips)
    for r, skip in zip(rows, skips):
        # уже решённое или с подсмотренным ответом — ни опыта, ни огонька, ни серий, ни достижений (см. reward_skips)
        if skip:
            if (r["score"] or 0) > 0 and not brief:
                xplog.append((r["ts"], 0, f"№{r['n']} — уже решено или ответ был показан"))
            continue
        fd = time.strftime("%Y-%m-%d", time.localtime(r["ts"]))
        fire_days[fd] = fire_days.get(fd, 0) + 1
        if r["exam"]:
            continue
        ts, tid = r["ts"], r["task_id"]
        lt = time.localtime(ts)
        day = time.strftime("%Y-%m-%d", lt)
        if prev_day and day != prev_day and (datetime.strptime(day, "%Y-%m-%d") - datetime.strptime(prev_day, "%Y-%m-%d")).days >= 8:
            cnt["phoenix"] = 1                 # между днями занятий — неделя без единого ответа
        prev_day = day
        days.add(day)
        if r["gave_up"]:
            cnt["peek"] += 1
        if r["n"] == 27 and not seen27:
            seen27 = True
            if r["score"] == 1:
                cnt["lucky"] = 1
        ans_of[day] = ans_of.get(day, 0) + 1
        if r["score"] != 1:
            bad_of[day] = bad_of.get(day, 0) + 1
        if ans_of[day] >= 10 and not bad_of.get(day):
            cnt["perfect"] = 1
        if r["score"] and r["score"] > 0:
            if fails_of.get(tid, 0) >= 3 and tid not in solved:
                cnt["stubborn"] = 1
            solves_of[tid] = solves_of.get(tid, 0) + 1
            if solves_of[tid] >= 3:
                cnt["dejavu"] = 1
            if 12 <= lt.tm_hour < 14:
                lunch_of[day] = lunch_of.get(day, 0) + 1
            nums_of.setdefault(day, set()).add(r["n"])
            if r["spent_ms"] and r["spent_ms"] >= 30 * 60000:
                cnt["snail"] = 1
            cnt["binge"] = cnt["binge"] + 1 if r["n"] == binge_n else 1
            binge_n = r["n"]
            cnt["best_binge"] = max(cnt["best_binge"], cnt["binge"])
            if r["n"] == 6:
                cnt["turtle"] += 1
            if r["score"] == 1 and r["spent_ms"] is not None and 0 < r["spent_ms"] < 20000:
                cnt["flash"] = 1
            if cnt["fails"] >= 5:
                cnt["bug"] = 1
            cnt["fails"] = 0
            if lt.tm_hour == 0 and lt.tm_min < 5:
                cnt["cinderella"] = 1
            if lt.tm_wday == 4 and lt.tm_mday == 13:
                cnt["fri13"] = 1
            if lt.tm_mon == 3 and lt.tm_mday == 14:
                cnt["pi"] = 1
            if (lt.tm_mon, lt.tm_mday) in ((12, 31), (1, 1)):
                cnt["newyear"] = 1
            # решено быстрее минуты — похоже на подсмотренный ответ: вместо опыта −1 XP, задание не считается решённым
            fast = r["spent_ms"] is not None and r["spent_ms"] < FAST_XP_MS and ts >= fast_since
            first_time = tid not in solved and not fast
            if fast:
                gain(FAST_XP_PENALTY, ts, f"№{r['n']} — решено быстрее минуты")
            else:
                if tid not in solved:              # опыт — только за первое решение задания, откуда бы ни пришёл ответ
                    gain(round(task_xp(r["n"], (APP.bank.tasks.get(tid) or {}).get("r")) * (1 if r["score"] == 1 else 0.5)), ts,
                         f"№{r['n']} — решено" + ("" if r["score"] == 1 else " со 2-й попытки"))
            if first_time:
                cnt["solved"] += 1
                solved.add(tid)
                if tid in failed:
                    cnt["fix"] += 1
                if (r["n"] or 0) >= 24:
                    cnt["hard"] += 1
            if r["n"]:
                nums.add(r["n"])
            per_day[day] = per_day.get(day, 0) + (0 if fast else 1)
            if per_day[day] == 5 and not fast:
                gain(15, ts, "5 заданий за день")  # бонус за день: 5 решённых
            if lt.tm_hour >= 23:
                cnt["night"] = 1
            if lt.tm_hour < 7:
                cnt["early"] = 1
            cnt["row"] = cnt["row"] + 1 if r["score"] == 1 else 0
        else:
            failed.add(tid)
            cnt["row"] = 0
            cnt["fails"] += 1
            fails_of[tid] = fails_of.get(tid, 0) + 1
            cnt["binge"], binge_n = 0, None
        cnt["best_row"] = max(cnt["best_row"], cnt["row"])
        # отметки времени получения достижений
        for aid, val in (("first", cnt["solved"]), ("s10", cnt["solved"]), ("s100", cnt["solved"]), ("s500", cnt["solved"]),
                         ("s1000", cnt["solved"]), ("row10", cnt["best_row"]), ("row25", cnt["best_row"]),
                         ("hard10", cnt["hard"]), ("all27", len(nums)), ("fix20", cnt["fix"]),
                         ("day50", per_day.get(day, 0)), ("night", cnt["night"]), ("early", cnt["early"]),
                         ("turtle", cnt["turtle"]),
                         ("bug", cnt["bug"]), ("phoenix", cnt["phoenix"]), ("cinderella", cnt["cinderella"]),
                         ("weekend", per_day.get(day, 0) if lt.tm_wday >= 5 else 0), ("fri13", cnt["fri13"]),
                         ("pi", cnt["pi"]), ("newyear", cnt["newyear"]), ("stubborn", cnt["stubborn"]),
                         ("peek", cnt["peek"]), ("lunch", lunch_of.get(day, 0)), ("snail", cnt["snail"]),
                         ("rainbow", len(nums_of.get(day, ()))), ("perfect", cnt["perfect"]), ("binge", cnt["best_binge"]),
                         ("lucky", cnt["lucky"])):
            if aid not in got and val >= ACH_GOAL[aid]:
                got[aid] = ts
    ex_best = 0
    for e in exams:
        if (e["finished"] - e["started"]) >= EXAM_MIN_SEC_FOR_XP and (e["primary_score"] or 0) > 0:
            gain(30 + 3 * (e["primary_score"] or 0), e["finished"], "вариант ЕГЭ")
        got.setdefault("exam1", e["finished"])
        ex_best = max(ex_best, e["test_score"] or 0)
        if (e["test_score"] or 0) >= 80:
            got.setdefault("exam80", e["finished"])
        if (e["test_score"] or 0) >= 100:
            got.setdefault("exam100", e["finished"])
        if e["test_score"] == 67:
            got.setdefault("exam67", e["finished"])
        if (e["finished"] - e["started"]) < 3600 and (e["test_score"] or 0) >= 60:
            got.setdefault("speedrun", e["finished"])
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
    # опыт за достижения — в момент получения
    for aid, ts in got.items():
        gain(ACH_XP.get(aid, 0), ts, "достижение «" + next((t for a, _, t, _, _ in ACHIEVEMENTS if a == aid), aid) + "»")
    # поправки опыта: выигрыш и проигрыш в дуэлях
    for a in db.q("SELECT ts, delta, reason FROM xp_adjust WHERE student_id=?", (sid,)):
        why = (f"турнир — {(a['reason'] or '').split(':')[-1]}-е место" if (a["reason"] or "").startswith("tour:")
               else "дуэль — победа" if a["delta"] > 0 else "дуэль — поражение")
        gain(a["delta"], a["ts"], why)
    xp = max(0, xp)
    # огонёк: дни подряд, в каждый из которых решено не меньше FIRE_NEED заданий (сегодняшний ещё может идти)
    fire, d = 0, datetime.now().date()
    if fire_days.get(d.isoformat(), 0) < FIRE_NEED:
        d -= timedelta(days=1)
    while fire_days.get(d.isoformat(), 0) >= FIRE_NEED:
        fire += 1
        d -= timedelta(days=1)
    xp = max(0, xp)                    # штрафы за «быстрее минуты» не уводят опыт ниже нуля
    lvl, title, cur_xp, need = level_of(xp)
    out = {"xp": xp, "week": week, "day": xp_day, "month": xp_month, "fire": fire, "wk": max(0, xp_wk), "win": sums,
           "cheat": cheat,
           "level": lvl, "title": title, "cur": cur_xp, "need": need}
    if brief:
        return out
    out["xplog"] = [{"ts": t, "v": v, "why": w} for t, v, w in sorted(xplog, key=lambda x: -x[0])[:40]]
    prog = {"first": cnt["solved"], "s10": cnt["solved"], "s100": cnt["solved"], "s500": cnt["solved"],
            "s1000": cnt["solved"], "row10": cnt["best_row"], "row25": cnt["best_row"], "hard10": cnt["hard"],
            "all27": len(nums), "fix20": cnt["fix"], "day50": max(per_day.values(), default=0),
            "days7": best, "days30": best, "night": cnt["night"], "early": cnt["early"],
            "exam1": len(exams), "exam80": int(ex_best >= 80), "exam100": int(ex_best >= 100),
            "exam67": int(any(e["test_score"] == 67 for e in exams)),
            "speedrun": int(any(e["finished"] - e["started"] < 3600 and (e["test_score"] or 0) >= 60 for e in exams)),
            "lunch": max(lunch_of.values(), default=0), "rainbow": max(map(len, nums_of.values()), default=0),
            "binge": cnt["best_binge"],
            "weekend": max((v for k, v in per_day.items() if datetime.strptime(k, "%Y-%m-%d").weekday() >= 5), default=0)}
    for k in ("turtle", "flash", "bug", "phoenix", "cinderella", "fri13", "pi", "newyear",
              "stubborn", "peek", "snail", "perfect", "lucky", "dejavu"):
        prog[k] = cnt[k]
    out["ach"] = [{"id": a, "icon": i, "title": t, "desc": d, "goal": g, "have": min(prog.get(a, 0), g), "xp": ACH_XP.get(a, 0),
                   "got": int(got[a]) if a in got else 0} for a, i, t, d, g in ACHIEVEMENTS]
    return out


ACH_GOAL = {a: g for a, _, _, _, g in ACHIEVEMENTS}
FIRE_NEED = 3                          # заданий за день, чтобы огонёк продлился (как в app.js)

# ================================================================ соревнования
LEAGUES = [("Бронзовая лига", "🥉"), ("Серебряная лига", "🥈"), ("Золотая лига", "🥇"), ("Алмазная лига", "💎")]
LEAGUE_UP = [10, 5, 3, 0]  # сколько первых по опыту за неделю поднимаются: из бронзы 10, из серебра 5, из золота 3
LEAGUE_DOWN = 3            # последние трое — в лигу ниже


def league_min_demote(lg):
    """Опускаем, только если в лиге столько человек: иначе зоны подъёма и спуска пересекались бы."""
    return max(LEAGUE_UP[lg], LEAGUE_DOWN) + LEAGUE_DOWN


LEAGUE_SHOW = 20           # мест в таблице лиги
DAILY_NUMS = set(range(1, 19)) | {22, 23, 24, 25}
DUEL_TASKS = 5
DUEL_NUMS = list(range(1, 16))
DUEL_STAKE = 15            # столько опыта победитель дуэли забирает у проигравшего
DUEL_HOURS = 24
DUEL_MAX_OPEN = 3
_COMP_LOCK = threading.Lock()
_DAILY_CACHE = {}


def short_name(name):
    parts = str(name or "").split()
    return parts[0] + (" " + parts[1][0] + "." if len(parts) > 1 else "") if parts else ""


def teacher_students(db, tid):
    """Ученики учителя — без учительских аккаунтов: учитель решает тренажёр, но в рейтингах, лигах и дуэлях не участвует."""
    main_id = main_teacher()["id"]
    return [r for r in db.q("SELECT id, name, teacher_id, class_id, badges, dev FROM students WHERE COALESCE(is_teacher, 0) = 0")
            if (r["teacher_id"] or main_id) == tid]


def league_row(db, sid):
    r = db.q("SELECT * FROM leagues WHERE student_id=?", (sid,), one=True)
    if not r:
        db.x("INSERT OR IGNORE INTO leagues(student_id, league, week) VALUES(?,0,?)", (sid, week_key()))
        r = db.q("SELECT * FROM leagues WHERE student_id=?", (sid,), one=True)
    return r


def league_rollover(db):
    """В понедельник: первые LEAGUE_UP[лига] поднимаются, последние трое опускаются. Лениво, один раз за неделю."""
    cur = week_key()
    with _COMP_LOCK:
        prev = db.setting("league_week")
        if prev == cur:
            return
        db.setting("league_week", cur)
    if prev is None:                   # самый первый запуск лиг — все начинают в бронзе
        return
    w1 = week_start()
    w0 = week_start(w1 - 3 * 86400)    # начало прошлой недели (с учётом перевода часов)
    main_id = main_teacher()["id"]
    groups = {}
    for r in db.q("SELECT id, teacher_id FROM students WHERE COALESCE(is_teacher, 0) = 0"):
        groups.setdefault(r["teacher_id"] or main_id, []).append(r["id"])
    for ids in groups.values():
        by_league = {}
        for sid in ids:
            lg = league_row(db, sid)["league"]
            xpw = game_summary(db, sid, brief=True, windows={"prev": (w0, w1)})["win"]["prev"]
            by_league.setdefault(lg, []).append((xpw, sid))
        for lg, members in by_league.items():
            members.sort(key=lambda x: -x[0])
            n = len(members)
            for place, (xpw, sid) in enumerate(members, 1):
                new, res = lg, ("stay" if xpw > 0 else None)
                if place <= LEAGUE_UP[lg] and xpw > 0:
                    new, res = lg + 1, "up"
                elif n >= league_min_demote(lg) and place > n - LEAGUE_DOWN and lg > 0:
                    new, res = lg - 1, "down"
                db.x("""UPDATE leagues SET league=?, week=?, result=?, result_place=?, result_league=?, result_week=?
                        WHERE student_id=?""", (new, cur, res, place, lg, prev, sid))
                if place == 1 and xpw > 0:
                    db.x("INSERT OR IGNORE INTO awards(student_id, kind, week, info) VALUES(?,'league1',?,?)", (sid, prev, lg))
                if res == "up":
                    db.x("INSERT OR IGNORE INTO awards(student_id, kind, week, info) VALUES(?,'up',?,?)", (sid, prev, lg))


def daily_task_id(day=None):
    """Задание дня — одно на всех: по дате выбирается актуальное задание без автора (кроме 19–21, 26, 27)."""
    day = day or datetime.now().strftime("%Y-%m-%d")
    hit = _DAILY_CACHE.get(day)
    if hit and hit[1] == APP.bank.mtime:
        return hit[0]
    # выбранное на день запоминаем: смена правил отбора или пересборка банка не подменят задание посреди дня
    row = APP.db.q("SELECT value FROM settings WHERE key=?", ("daily:" + day,), one=True)
    tid = row["value"] if row and row["value"] in APP.bank.tasks else None
    if not tid:
        cands = sorted(bank_pool(DAILY_NUMS, single=True, authored_ok=False))
        if APP.db.q("SELECT 1 FROM daily_starts WHERE day=? LIMIT 1", (day,), one=True):
            # день начался до единого банка — задание выбирали из заданий с 2024 года, оставляем его
            cands = [i for i in cands if (APP.bank.tasks[i].get("y") or 2026) >= 2024]
        tid = cands[int(hashlib.sha256(("daily:" + day).encode()).hexdigest(), 16) % len(cands)] if cands else None
        if tid:
            APP.db.x("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)", ("daily:" + day, tid))
    _DAILY_CACHE[day] = (tid, APP.bank.mtime)
    return tid


def daily_crown(db, ids):
    """👑 на сутки — у самого быстрого вчера (из учеников одного учителя)."""
    if not ids:
        return None
    y = (datetime.now().date() - timedelta(days=1)).isoformat()
    r = db.q(f"SELECT student_id FROM daily_results WHERE day=? AND student_id IN ({','.join('?' * len(ids))}) "
             "ORDER BY ms, ts LIMIT 1", (y, *ids), one=True)
    return r["student_id"] if r else None


DEV_CODE = "20011608"       # код входа в разделы «в разработке» (турнир)
_DEV_TRIES = {}


def tournament_table(db, s, mates):
    """Турнир недели: каждый с каждым, матч — дуэль. Победа 3 очка, ничья 1, поражение 0; с одной парой — один матч
    за неделю (первый сыгранный). Таблица: очки, затем решённые задачи."""
    people = {s["id"]: s["name"], **{k: m["name"] for k, m in mates.items()}}
    rows = {sid: {"sid": sid, "name": short_name(n), "me": sid == s["id"], "games": 0, "w": 0, "d": 0, "l": 0, "pts": 0,
                  "solved": 0} for sid, n in people.items()}
    seen = set()
    for d in db.q("SELECT * FROM duels WHERE status='finished' AND finished>=? ORDER BY finished", (week_start(),)):
        pair = tuple(sorted((d["a"], d["b"])))
        if d["a"] not in rows or d["b"] not in rows or pair in seen:
            continue
        seen.add(pair)
        for me, op in (("a", "b"), ("b", "a")):
            r = rows[d[me]]
            r["games"] += 1
            r["solved"] += d[me + "_solved"] or 0
            if not d["winner"]:
                r["d"] += 1
                r["pts"] += 1
            elif d["winner"] == d[me]:
                r["w"] += 1
                r["pts"] += 3
            else:
                r["l"] += 1
    table = sorted(rows.values(), key=lambda r: (-r["pts"], -r["solved"], r["name"]))
    for i, r in enumerate(table, 1):
        r["place"] = i
    played = {op for pair in seen if s["id"] in pair for op in pair if op != s["id"]}
    return {"table": table, "played": sorted(played), "ends": week_start() + 7 * 86400}


def duel_tasks():
    """Задания для дуэли или матча турнира: по одному на разные номера, актуального формата, без авторских."""
    pool = {}
    for i in bank_pool(set(DUEL_NUMS), single=True, authored_ok=False):
        pool.setdefault(APP.bank.tasks[i]["n"], []).append(i)
    nums = random.sample(sorted(pool), min(DUEL_TASKS, len(pool)))
    return [random.choice(pool[n]) for n in sorted(nums)]


# Турнир «как в футболе»: жеребьёвка по корзинам → групповой этап (каждый с каждым, победа 3 очка, ничья 1) →
# плей-офф на выбывание с матчем за 3-е место. «Счёт» матча — сколько заданий решил каждый.
SUPPORT_KINDS = {"task": "Ошибка в задании", "bug": "Не работает сайт", "xp": "Опыт, рейтинг, турниры", "question": "Вопрос", "other": "Другое"}
SUPPORT_MAX = 2000
SUPPORT_PER_HOUR = 5


TOUR_SIZES = {4: "Мини-турнир", 8: "Кубок", 12: "Чемпионат"}
TOUR_GROUPS = {4: 1, 8: 2, 12: 3}          # группы по 4
TOUR_QUAL = {4: 2, 8: 4, 12: 8}            # сколько выходит в плей-офф (у 12 — по двое из группы и две лучшие третьи)
TOUR_GROUP_HOURS = 24                      # на весь групповой этап
TOUR_PO_HOURS = 12                         # на каждый раунд плей-офф
TOUR_PRIZES = {4: {1: 60, 2: 35, 3: 20}, 8: {1: 100, 2: 60, 3: 30}, 12: {1: 150, 2: 90, 3: 50}}
ROUND_NAMES = {1: "Финал", 2: "Полуфинал", 4: "Четвертьфинал"}
GROUP_NAMES = "ABCD"
TOUR_FMT = 2                               # формат с группами (прежние турниры на выбывание закрываются)


def day_start(ts=None):
    d = datetime.fromtimestamp(ts if ts is not None else time.time()).date()
    return time.mktime(d.timetuple())


def tour_lobbies(db, tid):
    """Набор на каждый размер открыт, пока сегодня турнир этого размера ещё не стартовал: один в сутки."""
    today = day_start()
    for size, name in TOUR_SIZES.items():
        if db.q("SELECT 1 FROM tournaments WHERE teacher_id=? AND size=? AND status='reg'", (tid, size), one=True):
            continue
        if db.q("SELECT 1 FROM tournaments WHERE teacher_id=? AND size=? AND started>=? AND status!='void'", (tid, size, today), one=True):
            continue
        n = db.q("SELECT COUNT(*) AS c FROM tournaments WHERE teacher_id=? AND size=? AND status!='void'", (tid, size), one=True)["c"] + 1
        db.x("INSERT INTO tournaments(teacher_id, size, title, status, created, fmt) VALUES(?,?,?,'reg',?,?)",
             (tid, size, f"{name} №{n}", time.time(), TOUR_FMT))


def tour_people(db, tour_id):
    out = []
    for r in db.q("""SELECT p.student_id, p.seed, p.place, p.xp, p.grp, s.name FROM tour_players p JOIN students s ON s.id=p.student_id
                     WHERE p.tour_id=? ORDER BY COALESCE(p.seed, 99), p.joined""", (tour_id,)):
        out.append({"sid": r["student_id"], "name": short_name(r["name"]), "seed": r["seed"], "place": r["place"], "xp": r["xp"],
                    "grp": r["grp"], "level": game_summary(db, r["student_id"], brief=True)["level"]})
    return out


def tour_match_new(db, tour_id, rnd, slot, a, b, ends, kind="po", grp=None):
    db.x("""INSERT INTO tour_matches(tour_id, round, slot, a, b, tasks, status, ends, kind, grp)
            VALUES(?,?,?,?,?,?, 'play', ?, ?, ?)""", (tour_id, rnd, slot, a, b, json.dumps(duel_tasks()), ends, kind, grp))


def tour_settle(db, m, seeds, now):
    """Итог матча. Больше решил — победа. Поровну: в группе ничья, в плей-офф проходит быстрейший («пенальти»).
    Не сыграл — техническое поражение; в группе, если не сыграли оба, поражение обоим."""
    tasks = json.loads(m["tasks"])
    res = {}
    for side in ("a", "b"):
        st, dn = m[side + "_start"], min(m[side + "_done"] or now, m["ends"] or now)    # после срока не считается
        res[side] = (duel_solved(db, m[side], tasks, st, dn) if st else -1, (dn - st) if st else None)
    (sa, ta), (sb, tb) = res["a"], res["b"]
    tech = int(sa < 0 or sb < 0)
    group = m["kind"] == "group"
    if sa < 0 and sb < 0:
        win = None if group else ("a" if seeds.get(m["a"], 99) <= seeds.get(m["b"], 99) else "b")
    elif sa != sb:
        win = "a" if sa > sb else "b"
    elif group:
        win = None                                                   # ничья
    elif ta != tb:
        win = "a" if ta < tb else "b"
    else:
        win = "a" if seeds.get(m["a"], 99) <= seeds.get(m["b"], 99) else "b"
    db.x("""UPDATE tour_matches SET status='done', a_solved=?, b_solved=?, a_sec=?, b_sec=?, winner=?, tech=? WHERE id=?""",
         (max(sa, 0), max(sb, 0), ta, tb, m[win] if win else None, tech, m["id"]))


def tour_tables(db, t, people=None):
    """Таблицы групп: И, В, Н, П, решено-пропущено (как голы), очки. Сортировка как в футболе."""
    people = people or {p["sid"]: p for p in tour_people(db, t["id"])}
    rows = {sid: {"sid": sid, "g": 0, "w": 0, "d": 0, "l": 0, "sf": 0, "sa": 0, "pts": 0, "sec": 0.0} for sid in people}
    for m in db.q("SELECT * FROM tour_matches WHERE tour_id=? AND kind='group' AND status='done'", (t["id"],)):
        for me, op in (("a", "b"), ("b", "a")):
            r = rows.get(m[me])
            if not r:
                continue
            r["g"] += 1
            r["sf"] += m[me + "_solved"] or 0
            r["sa"] += m[op + "_solved"] or 0
            r["sec"] += m[me + "_sec"] or 0
            if m["winner"] == m[me]:
                r["w"] += 1; r["pts"] += 3
            elif m["winner"] is None and not m["tech"]:
                r["d"] += 1; r["pts"] += 1
            else:
                r["l"] += 1
    key = lambda r: (-r["pts"], -(r["sf"] - r["sa"]), -r["sf"], r["sec"], people[r["sid"]]["seed"] or 99)
    groups = {}
    for sid, p in people.items():
        groups.setdefault(p["grp"], []).append(rows[sid])
    out = []
    for g in sorted(k for k in groups if k):
        tab = sorted(groups[g], key=key)
        for i, r in enumerate(tab, 1):
            r["place"] = i
        out.append({"name": g, "rows": tab})
    return out, key


def tour_pairs(qual, by_grp):
    """Пары плей-офф: сильнейший — со слабейшим из другой группы; первый и второй сеяные — в разных половинах сетки."""
    left, pairs = list(qual), []
    while left:
        a = left.pop(0)
        cand = [x for x in reversed(left) if by_grp[x] != by_grp[a]] or list(reversed(left))
        b = cand[0]
        left.remove(b)
        pairs.append((a, b))
    if len(pairs) == 4:
        pairs = [pairs[0], pairs[3], pairs[2], pairs[1]]
    return pairs


def tour_finish(db, t, now):
    if not db.xn("UPDATE tournaments SET status='done', finished=? WHERE id=? AND status='run'", (now, t["id"])):
        return
    ms = db.q("SELECT * FROM tour_matches WHERE tour_id=? AND kind!='group'", (t["id"],))
    places = {}
    for m in ms:
        lo = m["a"] if m["winner"] == m["b"] else m["b"]
        if m["kind"] == "final":
            places[m["winner"]], places[lo] = 1, 2
        elif m["kind"] == "third":
            places[m["winner"]], places[lo] = 3, 4
    for m in ms:                                     # проигравшие в четвертьфинале — 5-е
        if m["kind"] == "po":
            lo = m["a"] if m["winner"] == m["b"] else m["b"]
            places.setdefault(lo, 5)
    rest = TOUR_QUAL[t["size"]] + 1                  # не вышли из группы
    for r in db.q("SELECT student_id FROM tour_players WHERE tour_id=?", (t["id"],)):
        places.setdefault(r["student_id"], rest)
    prizes = TOUR_PRIZES.get(t["size"], {})
    for sid, pl in places.items():
        xp = prizes.get(pl, 0)
        db.x("UPDATE tour_players SET place=?, xp=? WHERE tour_id=? AND student_id=?", (pl, xp, t["id"], sid))
        if xp:
            db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?,?)", (sid, now, xp, f"tour:{t['id']}:{pl}"))
    champ = next((s for s, p in places.items() if p == 1), None)
    if champ:
        db.x("INSERT OR IGNORE INTO awards(student_id, kind, week, info) VALUES(?,'tour1',?,?)", (champ, str(t["id"]), t["size"]))


def tour_tick(db, t):
    """Ход турнира (лениво, при каждом запросе): старт при полном наборе, итоги матчей, следующая стадия, призы."""
    now = time.time()
    if t["status"] == "reg":
        ids = [r["student_id"] for r in db.q("SELECT student_id FROM tour_players WHERE tour_id=? ORDER BY joined", (t["id"],))]
        if len(ids) < t["size"]:
            return
        ends = now + TOUR_GROUP_HOURS * 3600
        if not db.xn("UPDATE tournaments SET status='run', started=?, round=1, round_ends=? WHERE id=? AND status='reg'",
                     (now, ends, t["id"])):
            return                               # стартовал параллельный запрос
        # жеребьёвка: корзины по опыту, в каждую группу — по одному из каждой корзины
        ranked = sorted(ids, key=lambda i: (-game_summary(db, i, brief=True)["xp"], i))
        ng = TOUR_GROUPS[t["size"]]
        groups = {GROUP_NAMES[g]: [] for g in range(ng)}
        for pot in range(0, len(ranked), ng):
            letters = list(groups)
            random.shuffle(letters)
            for sid, g in zip(ranked[pot:pot + ng], letters):
                groups[g].append(sid)
        for seed, sid in enumerate(ranked, 1):
            g = next(k for k, v in groups.items() if sid in v)
            db.x("UPDATE tour_players SET seed=?, grp=? WHERE tour_id=? AND student_id=?", (seed, g, t["id"], sid))
        slot = 0
        for g, members in groups.items():
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    tour_match_new(db, t["id"], 1, slot, members[i], members[j], ends, "group", g)
                    slot += 1
        return
    if t["status"] != "run":
        return
    seeds = {r["student_id"]: r["seed"] for r in db.q("SELECT student_id, seed FROM tour_players WHERE tour_id=?", (t["id"],))}
    cur = db.q("SELECT * FROM tour_matches WHERE tour_id=? AND round=? ORDER BY slot", (t["id"], t["round"]))
    for m in cur:
        if m["status"] == "play" and ((m["a_done"] and m["b_done"]) or now > (m["ends"] or now)):
            tour_settle(db, m, seeds, now)
    cur = db.q("SELECT * FROM tour_matches WHERE tour_id=? AND round=? ORDER BY slot", (t["id"], t["round"]))
    if any(m["status"] != "done" for m in cur):
        return
    if any(m["kind"] == "final" for m in cur):
        return tour_finish(db, t, now)
    nxt, ends = t["round"] + 1, now + TOUR_PO_HOURS * 3600
    if not db.xn("UPDATE tournaments SET round=?, round_ends=? WHERE id=? AND round=?", (nxt, ends, t["id"], t["round"])):
        return
    if t["round"] == 1:                          # группы сыграны — кто вышел в плей-офф
        tables, key = tour_tables(db, t)
        by_grp = {r["sid"]: g["name"] for g in tables for r in g["rows"]}
        need = TOUR_QUAL[t["size"]]
        qual = [r for g in tables for r in g["rows"] if r["place"] <= 2]
        thirds = sorted([r for g in tables for r in g["rows"] if r["place"] == 3], key=key)
        qual += thirds[:max(0, need - len(qual))]
        qual = [r["sid"] for r in sorted(qual[:need], key=lambda r: (r["place"], key(r)))]
        if need == 2:                            # мини-турнир: финал 1-го и 2-го, за 3-е место — 3-й и 4-й
            rest = [r["sid"] for r in tables[0]["rows"][2:4]]
            tour_match_new(db, t["id"], nxt, 0, qual[0], qual[1], ends, "final")
            tour_match_new(db, t["id"], nxt, 1, rest[0], rest[1], ends, "third")
            return
        for k, (a, b) in enumerate(tour_pairs(qual, by_grp)):
            tour_match_new(db, t["id"], nxt, k, a, b, ends, "po")
        return
    winners = [m["winner"] for m in cur if m["kind"] == "po"]
    losers = [m["a"] if m["winner"] == m["b"] else m["b"] for m in cur if m["kind"] == "po"]
    if len(winners) == 2:                        # после полуфиналов — финал и матч за 3-е место
        tour_match_new(db, t["id"], nxt, 0, winners[0], winners[1], ends, "final")
        tour_match_new(db, t["id"], nxt, 1, losers[0], losers[1], ends, "third")
        return
    for k in range(len(winners) // 2):
        tour_match_new(db, t["id"], nxt, k, winners[2 * k], winners[2 * k + 1], ends, "po")


def tour_match_view(m, people, me):
    side = "a" if m["a"] == me else "b" if m["b"] == me else None
    return {"id": m["id"], "slot": m["slot"], "kind": m["kind"], "grp": m["grp"], "status": m["status"], "ends": m["ends"],
            "tech": bool(m["tech"]), "a": people.get(m["a"]), "b": people.get(m["b"]), "a_solved": m["a_solved"],
            "b_solved": m["b_solved"], "winner": m["winner"], "mine": side, "started": bool(side and m[side + "_start"]),
            "done": bool(side and m[side + "_done"]),
            "tasks": [APP.bank.pid(x) for x in json.loads(m["tasks"])] if side and m[side + "_start"] else None,
            "since": m[side + "_start"] if side else None}


def tour_view(db, t, me, brief=False):
    """Турнир для страницы: группы с таблицами, сетка плей-офф, места."""
    people = {p["sid"]: p for p in tour_people(db, t["id"])}
    out = {"id": t["id"], "title": t["title"], "size": t["size"], "status": t["status"], "round": t["round"],
           "round_ends": t["round_ends"], "started": t["started"], "finished": t["finished"],
           "podium": sorted([p for p in people.values() if p["place"] and p["place"] <= 4], key=lambda p: p["place"])}
    if brief:
        return out
    ms = db.q("SELECT * FROM tour_matches WHERE tour_id=? ORDER BY round, slot", (t["id"],))
    tables, _ = tour_tables(db, t, people)
    for g in tables:
        for r in g["rows"]:
            r.update(name=people[r["sid"]]["name"], level=people[r["sid"]]["level"], me=r["sid"] == me)
        g["matches"] = [tour_match_view(m, people, me) for m in ms if m["kind"] == "group" and m["grp"] == g["name"]]
    # сетка плей-офф заранее: пустые места — «ждём»
    rounds, n, r = [], TOUR_QUAL[t["size"]] // 2, 2
    while n >= 1:
        kinds = ("final",) if n == 1 else ("po",)
        rounds.append({"round": r, "name": ROUND_NAMES.get(n, f"Раунд {r}"), "slots": n,
                       "matches": [tour_match_view(m, people, me) for m in ms if m["round"] == r and m["kind"] in kinds]})
        n, r = n // 2, r + 1
    third = next((tour_match_view(m, people, me) for m in ms if m["kind"] == "third"), None)
    out.update(groups=tables, playoff=rounds, third=third, qual=TOUR_QUAL[t["size"]], players=sorted(people.values(), key=lambda p: p["seed"] or 99),
               stage="Групповой этап" if t["round"] == 1 else next((x["name"] for x in rounds if x["round"] == t["round"]), ""))
    return out


def duel_solved(db, sid, tasks, t0, t1):
    if not t0:
        return 0
    rows = db.q(f"SELECT DISTINCT task_id FROM attempts WHERE student_id=? AND score>0 AND ts>=? AND ts<=? "
                f"AND task_id IN ({','.join('?' * len(tasks))})", (sid, t0, t1, *tasks))
    return len(rows)


def duel_settle(db, d):
    """Дуэль окончена, когда оба закончили или прошли сутки. Больше решённых — победа, поровну — быстрее."""
    now = time.time()
    if d["status"] == "pending" and now > (d["created"] or 0) + DUEL_HOURS * 3600:
        db.x("UPDATE duels SET status='expired', finished=? WHERE id=?", (now, d["id"]))
        return
    if d["status"] != "active":
        return
    deadline = (d["accepted"] or now) + DUEL_HOURS * 3600
    if not ((d["a_done"] and d["b_done"]) or now > deadline):
        return
    tasks = json.loads(d["tasks"])
    res = {}
    for side in ("a", "b"):
        st, dn = d[side + "_start"], d[side + "_done"] or min(now, deadline)
        res[side] = (duel_solved(db, d[side], tasks, st, dn), (dn - st) if st else float("inf"))
    (sa, ta), (sb, tb) = res["a"], res["b"]
    if sa != sb:
        win = "a" if sa > sb else "b"
    elif sa and ta != tb:
        win = "a" if ta < tb else "b"
    else:
        win = None
    stake = 0
    if win:
        lose = "b" if win == "a" else "a"
        stake = min(DUEL_STAKE, game_summary(db, d[lose], brief=True)["xp"])
        if stake:
            db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?,?)", (d[win], now, stake, f"duel:{d['id']}"))
            db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?,?)", (d[lose], now, -stake, f"duel:{d['id']}"))
    db.x("UPDATE duels SET status='finished', a_solved=?, b_solved=?, winner=?, stake=?, finished=? WHERE id=?",
         (sa, sb, d[win] if win else None, stake, now, d["id"]))


_CSETS = {}


def course_sets_all(authored_ok):
    """Подборки курса для всех номеров: {n: {warm|base|exam|hard|test: [id]}} — пересчёт при смене банка."""
    key = (APP.bank.etag, bool(authored_ok))
    if key not in _CSETS:
        tasks = [t for t in APP.bank.tasks.values() if bank_ok(t, authored_ok=authored_ok)]
        for k in [k for k in _CSETS if k[0] != APP.bank.etag]:
            del _CSETS[k]                # банк пересобрали — старые подборки не нужны
        _CSETS[key] = {n: clusters.course_sets(tasks, n) for n in range(1, 28) if n not in (20, 21)}
    return _CSETS[key]


RATE_MIN = 3                            # с какого числа ответов показываем долю верных
_RATES = {"ts": 0, "data": {}}


def task_rates(db):
    """Задание → (сколько ответов, сколько верных с первой попытки) у всех учеников. Пересчёт раз в 10 минут."""
    if time.time() - _RATES["ts"] > 600:
        data = {}
        for r in db.q("""SELECT COALESCE(grp, task_id) AS t, COUNT(*) AS n, SUM(score = 1) AS ok FROM attempts
                         WHERE gave_up = 0 OR gave_up IS NULL GROUP BY COALESCE(grp, task_id)"""):
            data[r["t"]] = (r["n"], r["ok"] or 0)
        _RATES.update(ts=time.time(), data=data)
    return _RATES["data"]


def assignment_done(db, sid, task_ids, since):
    """Задания подборки, которые ученик решил после того, как учитель её выдал (для 19–21 — любую часть)."""
    if not task_ids:
        return set()
    marks = ",".join("?" * len(task_ids))
    rows = db.q(f"""SELECT DISTINCT COALESCE(CASE WHEN grp IN ({marks}) THEN grp END, task_id) AS t FROM attempts
                    WHERE student_id=? AND ts>=? AND score>0 AND (task_id IN ({marks}) OR grp IN ({marks}))""",
                (*task_ids, sid, since or 0, *task_ids, *task_ids))
    return {r["t"] for r in rows}


ASG_GRADES = {"5": 85, "4": 65, "3": 45}


def asg_order(real, aid, sid):
    """Порядок заданий контрольной у ученика: случайный, но один и тот же при каждом входе."""
    out = list(real)
    random.Random(f"asg:{aid}:{sid}").shuffle(out)
    return out


ASG_KINDS = {"self": "Самостоятельная", "practice": "Практическая", "home": "Домашняя работа"}


def practice_score(db, a, sid, real):
    """Практическая и домашняя: оценка ставится сама по ответам после выдачи. За задание — первый итог:
    верно с 1-й попытки — 1, со 2-й — 0.5, неверно или «Показать ответ» — 0; не решал — 0 (пока работа идёт — не в счёт)."""
    items = asg_items(real)
    keys = set(items)
    first, attempts = {}, 0
    if items:
        for r in db.q(f"""SELECT task_id, score FROM attempts WHERE student_id=? AND ts>=? AND exam IS NULL
                          AND task_id IN ({','.join('?' * len(items))}) ORDER BY ts, id""", (sid, a["created"] or 0, *items)):
            attempts += 1
            if r["task_id"] in keys and r["task_id"] not in first:
                first[r["task_id"]] = r["score"] or 0
    vals = list(first.values())
    total = sum(vals)
    pct = int(100 * total / len(items) + 0.5) if items else 0
    final = bool(a["closed"]) or bool(a["due"] and time.time() > a["due"]) or len(first) >= len(items)
    return {"tried": len(first), "ok": sum(1 for v in vals if v == 1), "half": sum(1 for v in vals if v == 0.5),
            "bad": sum(1 for v in vals if v == 0), "pct": pct, "grade": asg_grade(pct, asg_grading(a)) if first else None,
            "final": final, "attempts": attempts, "total": len(items),
            "items": {APP.bank.pid(k): first.get(k) for k in items}}


def asg_items(real):
    """Что сдаётся в контрольной: задания, а у 19–21 — каждый вопрос отдельно."""
    out = []
    for i in real:
        t = APP.bank.tasks.get(i) or {}
        parts = [p.get("id") for p in (t.get("parts") or []) if p.get("id") in APP.bank.tasks]
        out += parts if t.get("parts") else [i]
    return out


def asg_grading(a):
    try:
        g = json.loads(a["grading"] or "null") or {}
    except (ValueError, TypeError):
        g = {}
    return {k: max(0, min(100, to_int(g.get(k, v)))) for k, v in ASG_GRADES.items()}


def asg_grade(pct, grading):
    return 5 if pct >= grading["5"] else 4 if pct >= grading["4"] else 3 if pct >= grading["3"] else 2


def asg_score(answers, items):
    """Проверка сданных ответов: по заданию 1 (верно), 0.5 (у №26–27 верна половина) или 0."""
    res = {}
    for k in items:
        t = APP.bank.tasks.get(k) or {}
        x = answers.get(k)
        if not x or not tokens(x.get("a") or ""):
            res[k] = None
            continue
        res[k] = answer_credit(t.get("n") or 0, t.get("ans", ""), x.get("a") or "", x.get("c"))
    return res


def asg_finish_run(handler, db, a, s, real, forced=0):
    """Сдать контрольную: проверить все ответы, поставить оценку, записать ответы в журнал."""
    run = db.q("SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?", (a["id"], s["id"]), one=True)
    if not run or run["finished"]:
        return
    answers = json.loads(run["answers"] or "{}")
    items = asg_items(real)
    res = asg_score(answers, items)
    correct = sum(v or 0 for v in res.values())
    pct = int(100 * correct / len(items) + 0.5) if items else 0
    grade = asg_grade(pct, asg_grading(a))
    now = time.time()
    xp0 = game_summary(db, s["id"])["xp"]
    if not db.xn("""UPDATE asg_runs SET finished=?, result=?, correct=?, total=?, pct=?, grade=?, forced=?
                    WHERE asg_id=? AND student_id=? AND finished IS NULL""",
                 (now, json.dumps(res), correct, len(items), pct, grade, forced, a["id"], s["id"])):
        return                                     # уже сдал (два запроса разом) — второй раз в журнал не пишем
    db.x("INSERT INTO asg_events(asg_id, student_id, ts, kind, info) VALUES(?,?,?,?,?)",
         (a["id"], s["id"], now, "forced" if forced else "finish", json.dumps({"grade": grade, "pct": pct})))
    for k, credit in res.items():                 # в журнал — как обычные ответы (опыт, повторения, статистика)
        if credit is None:
            continue
        t = APP.bank.tasks.get(k)
        x = answers[k]
        handler.log_attempt(s, t, [x.get("a") or ""], 1.0 if credit == 1 else 0.0, reason=WORK_REASON, part=credit,
                            spent=x.get("ms"))
    db.x("UPDATE asg_runs SET xp=? WHERE asg_id=? AND student_id=?", (game_summary(db, s["id"])["xp"] - xp0, a["id"], s["id"]))
    make_fix_set(db, a, s, res)                    # ошибки — сразу в личную «работу над ошибками»


def asg_run_public(db, a, sid, real):
    """Состояние контрольной для ученика: правильность — только после сдачи."""
    run = db.q("SELECT * FROM asg_runs WHERE asg_id=? AND student_id=?", (a["id"], sid), one=True)
    items = asg_items(real)
    out = {"strict": True, "closed": bool(a["closed"]), "items": len(items), "grading": asg_grading(a),
           "started": run["started"] if run else None, "finished": run["finished"] if run else None}
    answers = json.loads(run["answers"] or "{}") if run else {}
    sub = set(answers)
    # сдано: задание целиком (у 19–21 — все вопросы)
    done = []
    for i in real:
        t = APP.bank.tasks.get(i) or {}
        keys = [p.get("id") for p in (t.get("parts") or [])] if t.get("parts") else [i]
        if keys and all(k in sub for k in keys):
            done.append(APP.bank.pid(i))
    out["done"] = done
    out["answered"] = [APP.bank.pid(k) for k in items if k in sub]
    out["mine"] = {APP.bank.pid(k): v.get("a") or "" for k, v in answers.items()}
    out["changed"] = [APP.bank.pid(k) for k, v in answers.items() if v.get("ch")]
    if run and run["finished"]:
        res = json.loads(run["result"] or "{}")
        out["result"] = {"correct": run["correct"], "total": run["total"], "pct": run["pct"], "grade": run["grade"],
                         "forced": bool(run["forced"]), "xp": run["xp"],
                         "ok": sum(1 for v in res.values() if v == 1), "half": sum(1 for v in res.values() if v == 0.5),
                         "bad": sum(1 for v in res.values() if v == 0), "blank": sum(1 for v in res.values() if v is None),
                         "items": [{"task": APP.bank.pid(k), "n": (APP.bank.tasks.get(k) or {}).get("n"), "credit": res.get(k)}
                                   for k in items]}
    return out


def asg_review_locked(db, a):
    """Почему разбор (правильные ответы) пока закрыт; None — открыт: учитель завершил, прошёл срок или сдал весь класс."""
    if a["closed"] or (a["due"] and time.time() > a["due"]):
        return None
    members = [r["id"] for r in db.q("SELECT id FROM students WHERE class_id=? AND COALESCE(is_teacher, 0) = 0", (a["class_id"],))]
    done = {r["student_id"] for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NOT NULL", (a["id"],))}
    if members and all(m in done for m in members):
        return None
    return "Правильные ответы и решения откроются, когда самостоятельная закончится для всех: учитель её завершит, пройдёт срок или сдаст весь класс."


def exam_summary(db, sid):
    """Варианты ЕГЭ ученика для журнала: последний, лучший, сколько за 30 дней."""
    rows = db.q("""SELECT id, finished, test_score FROM exams WHERE student_id=? AND finished IS NOT NULL
                   ORDER BY finished DESC LIMIT 50""", (sid,))
    if not rows:
        return None
    return {"last": rows[0]["test_score"], "last_id": rows[0]["id"], "last_ts": rows[0]["finished"],
            "best": max(r["test_score"] or 0 for r in rows), "count": len(rows),
            "month": sum(1 for r in rows if r["finished"] > time.time() - 30 * 86400)}


def exam_brief(r):
    """Строка варианта для учителя: баллы, время, сколько заданий верно целиком и без ответа."""
    d = {k: r[k] for k in r.keys() if k != "result"}
    res = (json.loads(r["result"] or "{}") if "result" in r.keys() else {}).get("results") or []
    d.update(full=sum(1 for x in res if x.get("max") and x.get("points") == x.get("max")),
             blank=sum(1 for x in res if x.get("blank")), total=len(res))
    return d


def asg_cell(db, a, sid, real):
    """Клетка журнала: как ученик сделал работу. st: done | work | none | miss (срок прошёл, не сделал)."""
    if a["strict"]:
        r = db.q("SELECT finished, grade, pct FROM asg_runs WHERE asg_id=? AND student_id=?", (a["id"], sid), one=True)
        cell = ({"st": "done", "grade": r["grade"], "pct": r["pct"]} if r and r["finished"]
                else {"st": "work"} if r else {"st": "none"})
    else:
        sc = practice_score(db, a, sid, real)
        cell = ({"st": "done" if sc["final"] else "work", "grade": sc["grade"], "pct": sc["pct"], "tried": sc["tried"]}
                if sc["tried"] else {"st": "none"})
    if cell["st"] == "none" and (a["closed"] or (a["due"] and time.time() > a["due"])):
        cell = {"st": "miss"}
    return cell


def batch_title(a):
    """Название серии личных подборок для учителя."""
    b = a["batch"] or ""
    if b.startswith("fix:"):
        src = APP.db.q("SELECT title FROM assignments WHERE id=?", (to_int(b[4:]),), one=True)
        return "Работа над ошибками" + (f": {src['title']}" if src else "")
    if b.startswith("weak:"):
        return "Слабые места · " + datetime.fromtimestamp(to_int(b[5:]) or a["created"] or 0).strftime("%d.%m")
    return a["title"]


def asg_expire(handler, db, class_id):
    """Срок работы прошёл — она закрывается: начатые самостоятельные сдаются по уже данным ответам."""
    now = time.time()
    for a in db.q("SELECT * FROM assignments WHERE class_id=? AND closed IS NULL AND due IS NOT NULL AND due < ?", (class_id, now)):
        if not db.xn("UPDATE assignments SET closed=? WHERE id=? AND closed IS NULL", (a["due"], a["id"])):
            continue
        if a["strict"]:
            a = db.q("SELECT * FROM assignments WHERE id=?", (a["id"],), one=True)
            real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
            for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (a["id"],)):
                st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                if st:
                    asg_finish_run(handler, db, a, st, real, forced=1)


def similar_tasks(db, sid, src_ids, per, exclude, authored_ok):
    """Похожие задания: тот же номер и тот же тип (кластер), из общего банка, ещё не решённые учеником."""
    solved = {r["t"] for r in db.q("SELECT DISTINCT COALESCE(grp, task_id) AS t FROM attempts WHERE student_id=? AND score>0", (sid,))}
    rnd = secrets.SystemRandom()
    out, used = [], set(exclude)
    for k in src_ids:
        t = APP.bank.tasks.get(k) or {}
        top = t.get("group") or k
        tt = APP.bank.tasks.get(top) or t
        n, c = tt.get("n"), tt.get("c")
        pool = [i for i in bank_pool({n}, authored_ok=authored_ok) if i not in used]
        same = [i for i in pool if APP.bank.tasks[i].get("c") == c]
        for lst in ([i for i in same if i not in solved], same, [i for i in pool if i not in solved], pool):
            if lst:
                pick = rnd.sample(lst, min(per, len(lst)))
                out += pick
                used |= set(pick)
                break
    return out


FIX_PER_MISTAKE = 2                    # похожих заданий на каждую ошибку в работе над ошибками
FIX_DAYS = 4                           # срок работы над ошибками, дней


def make_fix_set(db, a, s, res):
    """После самостоятельной — личная практическая «работа над ошибками»: похожие задания на те, где ошибся."""
    if a["student_id"] or a["batch"]:
        return None                    # только после работ всему классу
    batch = f"fix:{a['id']}"
    if db.q("SELECT 1 FROM assignments WHERE batch=? AND student_id=?", (batch, s["id"]), one=True):
        return None
    wrong, seen = [], set()
    for k, v in res.items():
        if v == 1:
            continue
        top = (APP.bank.tasks.get(k) or {}).get("group") or k
        if top not in seen:
            seen.add(top)
            wrong.append(top)
    if not wrong:
        return None
    tasks = similar_tasks(db, s["id"], wrong, FIX_PER_MISTAKE, json.loads(a["tasks"] or "[]"),
                          bool(teacher_of(s)["authored"]))[:20]
    if not tasks:
        return None
    now = time.time()
    due = datetime.combine((datetime.now() + timedelta(days=FIX_DAYS)).date(), datetime.max.time()).timestamp()
    db.x("""INSERT INTO assignments(class_id, title, tasks, created, due, strict, kind, student_id, batch)
            VALUES(?,?,?,?,?,0,'practice',?,?)""",
         (a["class_id"], f"Работа над ошибками: {a['title']}"[:80], json.dumps(tasks), now, due, s["id"], batch))
    return len(tasks)


def weak_numbers(db, sid, k):
    """K самых слабых номеров ученика: меньше всего верных с первой попытки (без вариантов), хотя бы 2 ответа."""
    rows = db.q("""SELECT n, COUNT(*) AS a, SUM(score = 1) AS ok FROM attempts WHERE student_id=? AND n IS NOT NULL
                   AND exam IS NULL GROUP BY n""", (sid,))
    agg = {}
    for r in rows:
        x = agg.setdefault(n_key(r["n"]), [0, 0])
        x[0] += r["a"]
        x[1] += r["ok"] or 0
    cand = sorted((ok / a, -a, n) for n, (a, ok) in agg.items() if a >= 2)
    return [n for acc, _, n in cand if acc < 0.85][:k]          # уверенно решаемое (85%+) слабым не считаем


def weak_sets(db, cid, per, k, days, authored_ok):
    """Каждому ученику класса — своя подборка на его слабые номера. Возвращает (сколько выдано, у кого мало данных)."""
    now = time.time()
    batch = f"weak:{int(now)}"
    due = datetime.combine((datetime.now() + timedelta(days=days)).date(), datetime.max.time()).timestamp()
    made, skipped = 0, []
    rnd = secrets.SystemRandom()
    for m in db.q("SELECT id, name FROM students WHERE class_id=? AND COALESCE(is_teacher, 0) = 0", (cid,)):
        nums = weak_numbers(db, m["id"], k)
        if not nums:
            skipped.append(m["name"])
            continue
        solved = {r["t"] for r in db.q("SELECT DISTINCT COALESCE(grp, task_id) AS t FROM attempts WHERE student_id=? AND score>0",
                                         (m["id"],))}
        tasks = []
        for n in nums:
            pool = bank_pool({n}, authored_ok=authored_ok)
            fresh = [i for i in pool if i not in solved] or pool
            tasks += rnd.sample(fresh, min(per, len(fresh)))
        if not tasks:
            skipped.append(m["name"])
            continue
        title = "Слабые места: " + ", ".join("№" + ("19–21" if n == 19 else str(n)) for n in nums)
        db.x("""INSERT INTO assignments(class_id, title, tasks, created, due, strict, kind, student_id, batch)
                VALUES(?,?,?,?,?,0,'practice',?,?)""", (cid, title[:80], json.dumps(tasks), now, due, m["id"], batch))
        made += 1
    return made, skipped


def forecast_trend(m):
    """Прогноз балла: сейчас, месяц назад и по дням за 30 дней (для мини-графика в журнале)."""
    try:
        hist = json.loads(m["fc"] or "[]")
    except ValueError:
        hist = []
    cut = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    before = [h for h in hist if h.get("d", "") <= cut]
    month = [h for h in hist if h.get("d", "") > cut]
    then = before[-1]["s"] if before else (month[0]["s"] if month else None)
    return {"now": m["forecast"], "then": then, "series": [h["s"] for h in month][-30:]}


def class_digest(db, cid):
    """Сводка недели по классу: 7 дней против предыдущих 30."""
    now = time.time()
    w0, p0 = now - 7 * 86400, now - 37 * 86400
    members = db.q("SELECT id, name, last_seen FROM students WHERE class_id=? AND COALESCE(is_teacher, 0) = 0 ORDER BY name", (cid,))
    inactive, dropped, top, overdue = [], [], [], []
    asgs = db.q("SELECT * FROM assignments WHERE class_id=? AND due IS NOT NULL AND due < ? AND due > ?", (cid, now, now - 21 * 86400))
    for m in members:
        rows = db.q("""SELECT n, ts, score FROM attempts WHERE student_id=? AND ts>? AND exam IS NULL AND n IS NOT NULL""", (m["id"], p0))
        week = [r for r in rows if r["ts"] >= w0]
        if not week:
            last = db.q("SELECT MAX(ts) AS t FROM attempts WHERE student_id=?", (m["id"],), one=True)["t"]
            inactive.append({"id": m["id"], "name": m["name"], "last": last})
        else:
            top.append({"id": m["id"], "name": m["name"], "solved": sum(1 for r in week if (r["score"] or 0) > 0), "answers": len(week)})
        by = {}
        for r in rows:
            x = by.setdefault(n_key(r["n"]), {"w": [0, 0], "p": [0, 0]})["w" if r["ts"] >= w0 else "p"]
            x[0] += 1
            x[1] += r["score"] == 1
        for n, v in by.items():
            if v["w"][0] >= 3 and v["p"][0] >= 3:
                aw, ap = v["w"][1] / v["w"][0], v["p"][1] / v["p"][0]
                if ap - aw >= 0.25:
                    dropped.append({"id": m["id"], "name": m["name"], "n": n, "was": round(ap * 100), "now": round(aw * 100)})
        for a in asgs:
            if a["student_id"] and a["student_id"] != m["id"]:
                continue
            real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
            c = asg_cell(db, a, m["id"], real)
            if c["st"] in ("miss", "work") or (c["st"] == "done" and not a["strict"] and c.get("tried", 0) < len(asg_items(real))):
                overdue.append({"id": m["id"], "name": m["name"], "asg": a["id"], "title": a["title"], "due": a["due"],
                                "state": "не начинал" if c["st"] == "miss" else f"сделано {c.get('tried', 0)} из {len(asg_items(real))}"
                                if not a["strict"] else "не сдал"})
    top.sort(key=lambda x: -x["solved"])
    return {"from": w0, "to": now, "inactive": inactive, "dropped": dropped, "overdue": overdue,
            "top": top[:3], "active": len(members) - len(inactive), "total": len(members)}


def exam_pick(db, s):
    """Вариант ЕГЭ выбирает сервер: по заданию на номер (19–21 — одной игрой) из общего банка.
    Сначала нерешённые; верно решённые в последних 3 вариантах — пропускаем; задания идущей самостоятельной — никогда."""
    authored = bool(teacher_of(s)["authored"])
    solved = {r["t"] for r in db.q("""SELECT DISTINCT COALESCE(grp, task_id) AS t FROM attempts
                                      WHERE student_id=? AND score>0""", (s["id"],))}
    last = [r["id"] for r in db.q("""SELECT id FROM exams WHERE student_id=? AND finished IS NOT NULL
                                    ORDER BY finished DESC LIMIT 3""", (s["id"],))]
    recent = set()
    if last:
        recent = {r["t"] for r in db.q(f"""SELECT DISTINCT COALESCE(grp, task_id) AS t FROM attempts WHERE score>0
                                          AND exam IN ({','.join('?' * len(last))})""", last)}
    locked = set()
    if s["class_id"]:
        for a in db.q("SELECT id, tasks FROM assignments WHERE class_id=? AND strict=1 AND closed IS NULL", (s["class_id"],)):
            run = db.q("SELECT finished FROM asg_runs WHERE asg_id=? AND student_id=?", (a["id"], s["id"]), one=True)
            if not run or not run["finished"]:
                locked |= set(json.loads(a["tasks"] or "[]"))
    rnd = secrets.SystemRandom()
    groups = any(t.get("parts") for t in APP.bank.tasks.values())
    out = []
    for n in range(1, 28):
        if groups and n in (20, 21):
            continue
        cands = [i for i in bank_pool({n}, authored_ok=authored)
                 if i not in locked and (n != 19 or not groups or APP.bank.tasks[i].get("parts"))]
        if not cands:
            continue
        for pref in ([i for i in cands if i not in solved], [i for i in cands if i not in recent], cands):
            if pref:
                out.append(rnd.choice(pref))
                break
    return out


def strict_locked(db, s, real_id):
    """Задание из незавершённой контрольной класса: проверять его в тренировке нельзя, пока ученик её не сдал."""
    if not s["class_id"]:
        return False
    for a in db.q("""SELECT id, tasks FROM assignments WHERE class_id=? AND strict=1 AND closed IS NULL
                     AND (student_id IS NULL OR student_id=?)""", (s["class_id"], s["id"])):
        if real_id in json.loads(a["tasks"] or "[]"):
            run = db.q("SELECT finished FROM asg_runs WHERE asg_id=? AND student_id=?", (a["id"], s["id"]), one=True)
            if not run or not run["finished"]:
                return True
    return False


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

    ThreadingHTTPServer.request_queue_size = 128     # по умолчанию 5: в начале урока соединения отбрасывались бы
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
