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
import bisect
import base64
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
import queue
import random
import re
import secrets
import socket
import sqlite3
import struct
import sys
import threading
import time
import zipfile
from datetime import datetime, timedelta
from fractions import Fraction
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
SITE_FILES = {"index.html", "app.js", "style.css", "admin.html", "admin.js", "admin.css", "py-worker.js", "changelog.js",
              "terms.html", "privacy.html", "consent.html", "legal.css",
              # значок сайта: вкладка браузера, поиск Google/Яндекса, ярлык на телефоне
              "favicon.ico", "favicon.svg", "favicon-96.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "site.webmanifest"}
# редакция документов (соглашение, политика, согласие на обработку ПДн): сменилась — ученик подтверждает заново
LEGAL_VERSION = "2026-10-13"
SITE_DIRS = ("vendor/", "media/")
# расширения файлов к заданиям, которые можно отдавать из банков (json/html — никогда: там ответы)
BANK_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".emf", ".wmf", ".img",
            ".txt", ".csv", ".tsv", ".xlsx", ".xls", ".xlsm", ".ods", ".odt", ".docx", ".doc", ".rtf",
            ".pdf", ".zip", ".rar", ".7z", ".py", ".pas", ".cpp", ".dat"}
MAX_BODY = 4_000_000
ADMIN_SESSION_DAYS = 14
DEFAULT_INVITE = "16082001"        # пригласительный код для учеников (меняется в панели учителя)
STUDENT_COOKIE_DAYS = 30                 # вход живёт месяц с последнего захода
# Вход — свой на каждом устройстве (student_sessions): «Выйти» отзывает его на сервере, «Выйти везде» — все сразу.
# Школьная сеть: с адреса за SHARED_DAYS дней входили или решали SHARED_MIN+ разных учеников — компьютеры общие.
# Там вход временный: до закрытия браузера, не дольше конца дня и SHARED_IDLE без действий; пароль браузер не сохраняет.
SHARED_MIN, SHARED_DAYS = 3, 30
SHARED_IDLE = 3 * 3600
LEGACY_DAYS = 30                         # прежний общий вход (students.token) — вне школы ещё столько дней становится входом устройства
SESSION_KEEP_DAYS = 60                   # закрытые входы хранятся столько дней
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
mimetypes.add_type("image/x-icon", ".ico")
mimetypes.add_type("application/manifest+json", ".webmanifest")
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


# Ошибки в ответах банков, проверенные вручную: id задания → верный ответ. Банк на сервере собирается из папок,
# поэтому исправляем при загрузке — пересборка банка исправление не сотрёт.
ANS_FIX = {
    # №4, Фано: А 000, Б 001, В 10, Г 11. Д = 01 занял бы всё «01…» — для Е кода не осталось бы, значит Д трёхзначный:
    # 010 или 011, наибольший — 011. В банке ФИПИ стоит «11» — это код буквы Г
    "openfipi_bank:460D7D": "011",
}


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


_SHARED = {}                               # ip -> (когда проверено, школьная ли сеть)


def shared_ip(db, ip, fresh=False):
    """Школьная сеть: с адреса за SHARED_DAYS дней решали или входили SHARED_MIN+ разных учеников. Локальный адрес —
    не школа (запросы с самого сервера). Проверка — раз в 10 минут на адрес."""
    if not ip or ip in ("127.0.0.1", "::1"):
        return False
    now = time.time()
    hit = _SHARED.get(ip)
    if hit and not fresh and now - hit[0] < 600:
        return hit[1]
    since = now - SHARED_DAYS * 86400
    who = {r["student_id"] for r in db.q("""SELECT DISTINCT a.student_id FROM attempts a JOIN students s ON s.id = a.student_id
                                           WHERE a.ip=? AND a.ts>? AND COALESCE(s.is_teacher, 0) = 0""", (ip, since))}
    who |= {r["student_id"] for r in db.q("""SELECT DISTINCT x.student_id FROM student_sessions x JOIN students s ON s.id = x.student_id
                                            WHERE x.ip=? AND x.created>? AND COALESCE(s.is_teacher, 0) = 0""", (ip, since))}
    v = len(who) >= SHARED_MIN
    if len(_SHARED) > 20000:
        _SHARED.clear()
    _SHARED[ip] = (now, v)
    return v


def session_new(db, sid, ip, ua, shared):
    """Новый вход на устройстве → токен. Заодно — уборка давно закрытых."""
    tok = secrets.token_urlsafe(24)
    now = time.time()
    db.x("DELETE FROM student_sessions WHERE COALESCE(ended, last_seen, created) < ?", (now - SESSION_KEEP_DAYS * 86400,))
    db.x("INSERT INTO student_sessions(token, student_id, created, last_seen, ip, ua, shared) VALUES(?,?,?,?,?,?,?)",
         (tok, sid, now, now, ip, (ua or "")[:300], 1 if shared else 0))
    return tok


def session_alive(r, now):
    """Вход ещё действует: обычный — STUDENT_COOKIE_DAYS с последнего захода; в школе — тот же день и SHARED_IDLE без действий."""
    if r["ended"]:
        return False
    if r["shared"]:
        return (time.localtime(r["created"])[:3] == time.localtime(now)[:3]) and now - (r["last_seen"] or r["created"]) < SHARED_IDLE
    return now - (r["last_seen"] or r["created"]) < STUDENT_COOKIE_DAYS * 86400


def student_by_token(db, tok, ip):
    """Ученик по токену входа → (ученик, вход устройства или None для прежнего общего токена) или (None, None).
    Прежний общий токен (students.token) действует только вне школьной сети и LEGACY_DAYS дней после обновления."""
    if not tok:
        return None, None
    now = time.time()
    r = db.q("SELECT * FROM student_sessions WHERE token=?", (tok,), one=True)
    if r:
        if not session_alive(r, now):
            if not r["ended"]:
                db.x("UPDATE student_sessions SET ended=? WHERE id=?", (now, r["id"]))
            return None, None
        return db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True), r
    s = db.q("SELECT * FROM students WHERE token=?", (tok,), one=True)
    if s and now < (to_float(db.setting("sessions_since")) or now) + LEGACY_DAYS * 86400 and not shared_ip(db, ip):
        return s, None
    return None, None


def sessions_end(db, sid, keep=None):
    """Выйти на всех устройствах ученика (кроме входа keep); прежний общий токен — тоже. → сколько входов закрыто."""
    n = db.xn("UPDATE student_sessions SET ended=? WHERE student_id=? AND id<>? AND ended IS NULL", (time.time(), sid, keep or 0))
    db.x("UPDATE students SET token=? WHERE id=?", (secrets.token_urlsafe(24), sid))
    return n


# Ошибки JavaScript в браузерах (POST /api/jserr — без входа, но не больше JSERR_PER_IP с адреса за 10 минут): одна строка
# на ошибку, JSERR_HITS последних случаев; ошибки, которых не было JSERR_DAYS дней, удаляются. Видит главный учитель («Ошибки»).
JSERR_PER_IP, JSERR_HITS, JSERR_DAYS = 30, 50, 60
_JSERR_IP = {}
_JSERR_LOCK = threading.Lock()
_APPJS = {"mtime": None, "marks": []}


def jserr_where(src):
    """Где ошибка: без адреса сайта и ?v=…; строка собранного app.js — модулем src/app (по меткам сборки)."""
    s = re.sub(r"^[a-z-]+://[^/]+/", "", str(src or "")).strip()
    s = re.sub(r"\?[^:]*", "", s)[:200]
    m = re.match(r"^(?:.*/)?app\.js:(\d+)(?::\d+)?$", s)
    if not m:
        return s
    try:
        p = HERE / "app.js"
        mt = p.stat().st_mtime
        if _APPJS["mtime"] != mt:
            marks = [(1, "src/app/01-core.js")]                    # первый модуль — сразу после заголовка (строка 1)
            for k, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
                mm = re.match(r"^  // ═══════ (src/app/[\w.-]+\.js)$", line)
                if mm:
                    marks.append((k, mm.group(1)))
            _APPJS.update(mtime=mt, marks=marks)
    except OSError:
        return s
    line = int(m.group(1))
    start, name = max((x for x in _APPJS["marks"] if x[0] < line), default=(0, "app.js"))
    return f"{name}:{line - start}"


def jserr_add(db, d, ip, sid=None, tid=None, ua=""):
    """Записать ошибку из браузера (d — что прислал браузер). → False — с этого адреса уже слишком много."""
    now = time.time()
    with _JSERR_LOCK:
        arr = [t for t in _JSERR_IP.get(ip, []) if now - t < 600]
        if len(arr) >= JSERR_PER_IP:
            return False
        _JSERR_IP[ip] = arr + [now]
        if len(_JSERR_IP) > 5000:
            _JSERR_IP.clear()
    app = "admin" if d.get("app") == "admin" else "site"
    msg = re.sub(r"\s+", " ", str(d.get("msg") or "")).strip()[:300]
    if not msg:
        return True
    src = d.get("src")
    if not src:                                                   # ошибка в обещании — место берём из первой строки стека
        m = re.search(r"([\w./:-]+\.js(?:\?[^:\s)]*)?:\d+:\d+)", str(d.get("stack") or ""))
        src = m.group(1) if m else ""
    src = jserr_where(src)
    key = hashlib.sha1(f"{app}|{msg}|{src}".encode()).hexdigest()
    ver, page = str(d.get("ver") or "")[:20], str(d.get("page") or "")[:120]
    row = db.q("SELECT id FROM js_errors WHERE key=?", (key,), one=True)
    if row:
        eid = row["id"]
        db.x("UPDATE js_errors SET n = n + 1, last_ts=?, ver=? WHERE id=?", (now, ver, eid))
    else:
        eid = db.x("""INSERT INTO js_errors(key, app, msg, src, stack, first_ts, last_ts, n, ver) VALUES(?,?,?,?,?,?,?,1,?)""",
                   (key, app, msg, src, str(d.get("stack") or "")[:2000], now, now, ver))
    db.x("INSERT INTO js_error_hits(error_id, ts, student_id, teacher_id, device, ver, page) VALUES(?,?,?,?,?,?,?)",
         (eid, now, sid, tid, ua_label(ua), ver, page))
    db.x("""DELETE FROM js_error_hits WHERE error_id=? AND id NOT IN
            (SELECT id FROM js_error_hits WHERE error_id=? ORDER BY id DESC LIMIT ?)""", (eid, eid, JSERR_HITS))
    return True


def jserr_list(db):
    """Ошибки для главного учителя: новые сверху; у каждой — сколько раз, у скольких, на каких устройствах, последние случаи."""
    cut = time.time() - JSERR_DAYS * 86400
    db.x("DELETE FROM js_error_hits WHERE error_id IN (SELECT id FROM js_errors WHERE last_ts < ?)", (cut,))
    db.x("DELETE FROM js_errors WHERE last_ts < ?", (cut,))
    names = {r["id"]: short_name(r["name"]) for r in db.q("SELECT id, name FROM students")}
    tnames = {r["id"]: r["name"] for r in db.q("SELECT id, name FROM teachers")}
    out = []
    for e in db.q("SELECT * FROM js_errors ORDER BY last_ts DESC LIMIT 100"):
        hits = db.q("SELECT * FROM js_error_hits WHERE error_id=? ORDER BY id DESC", (e["id"],))
        dev = {}
        for h in hits:
            dev[h["device"] or "?"] = dev.get(h["device"] or "?", 0) + 1
        who = {(h["student_id"], h["teacher_id"]) for h in hits if h["student_id"] or h["teacher_id"]}
        out.append({"id": e["id"], "app": e["app"], "msg": e["msg"], "src": e["src"], "stack": e["stack"], "n": e["n"],
                    "first": e["first_ts"], "last": e["last_ts"], "ver": e["ver"], "fixed": bool(e["fixed_ts"] and e["fixed_ts"] >= e["last_ts"]),
                    "again": bool(e["fixed_ts"] and e["fixed_ts"] < e["last_ts"]), "people": len(who),
                    "devices": sorted(dev.items(), key=lambda x: -x[1]),
                    "hits": [{"ts": h["ts"], "who": names.get(h["student_id"]) or tnames.get(h["teacher_id"]) or "не вошёл",
                              "teacher": bool(h["teacher_id"]), "device": h["device"], "ver": h["ver"], "page": h["page"]} for h in hits[:10]]})
    return out


def jserr_new(db):
    """Сколько ошибок появилось или повторилось после того, как главный учитель смотрел список (и не отмечены исправленными)."""
    seen = to_float(db.setting("jserr_seen")) or 0
    return db.q("SELECT COUNT(*) c FROM js_errors WHERE last_ts > ? AND (fixed_ts IS NULL OR fixed_ts < last_ts)", (seen,), one=True)["c"]


def attempts_changed(sid):
    """Журнал ответов ученика sid изменили задним числом (учитель отменил или вернул ответы) — сбросить то, что посчитано по нему."""
    with _GS_LOCK:
        _GS_CACHE.pop(sid, None)
        _LB_PEOPLE.clear()                          # рейтинги и лиги — пересоберутся
    _FORBES.clear()
    _ECON["t"] = 0.0


def ua_label(ua):
    """«Chrome · Windows» из User-Agent — чтобы ученик узнал свой компьютер в списке входов."""
    ua = ua or ""
    br = next((t for k, t in (("YaBrowser", "Яндекс Браузер"), ("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox", "Firefox"),
                              ("Chrome", "Chrome"), ("Safari", "Safari")) if k in ua), "браузер")
    os_ = next((t for k, t in (("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Windows", "Windows"),
                               ("Mac OS", "Mac"), ("CrOS", "Chromebook"), ("Linux", "Linux")) if k in ua), "")
    return f"{br} · {os_}" if os_ else br


def sessions_list(db, sid, cur=None):
    """Входы ученика (действующие), новые сверху: устройство, адрес, когда вошёл и был, школьный ли, этот ли."""
    now = time.time()
    out = []
    for r in db.q("SELECT * FROM student_sessions WHERE student_id=? AND ended IS NULL ORDER BY COALESCE(last_seen, created) DESC", (sid,)):
        if not session_alive(r, now):
            continue
        out.append({"id": r["id"], "device": ua_label(r["ua"]), "ip": r["ip"] or "", "created": r["created"],
                    "last_seen": r["last_seen"] or r["created"], "shared": bool(r["shared"]), "current": r["id"] == cur})
    return out


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
    import xlrd                     # старый .xls; не обязателен — есть встроенный разбор (_xls_rows_builtin)
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


def _ole_stream(data, names=("Workbook", "Book")):
    """Поток из файла OLE2 (контейнер старого .xls) — без сторонних библиотек."""
    if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ValueError("не OLE2")
    ssz = 1 << struct.unpack_from("<H", data, 30)[0]
    msz = 1 << struct.unpack_from("<H", data, 32)[0]
    n_fat, dir_start, cutoff, mini_fat_start, n_mini, difat_start, n_difat = (
        struct.unpack_from("<I", data, 44)[0], struct.unpack_from("<I", data, 48)[0], struct.unpack_from("<I", data, 56)[0],
        struct.unpack_from("<I", data, 60)[0], struct.unpack_from("<I", data, 64)[0], struct.unpack_from("<I", data, 68)[0],
        struct.unpack_from("<I", data, 72)[0])
    sector = lambda i: data[512 + i * ssz: 512 + (i + 1) * ssz]
    difat = list(struct.unpack_from("<109I", data, 76))
    nxt, guard = difat_start, 0
    while nxt < 0xFFFFFFFA and guard < n_difat + 1:
        sec = sector(nxt)
        vals = struct.unpack("<%dI" % (ssz // 4), sec)
        difat += vals[:-1]
        nxt, guard = vals[-1], guard + 1
    fat = []
    for i in difat[:n_fat]:
        if i >= 0xFFFFFFFA:
            break
        fat += struct.unpack("<%dI" % (ssz // 4), sector(i))

    def chain(start, table, read, limit):
        out, i, seen = [], start, 0
        while i < 0xFFFFFFFA and i < len(table) and seen < limit:
            out.append(read(i))
            i, seen = table[i], seen + 1
        return b"".join(out)

    limit = len(data) // ssz + 2
    dirs = chain(dir_start, fat, sector, limit)
    entries = []
    for k in range(len(dirs) // 128):
        e = dirs[k * 128:(k + 1) * 128]
        nlen = struct.unpack_from("<H", e, 64)[0]
        name = e[:max(nlen - 2, 0)].decode("utf-16-le", errors="replace")
        entries.append((name, e[66], struct.unpack_from("<I", e, 116)[0], struct.unpack_from("<I", e, 120)[0]))
    root = next((x for x in entries if x[1] == 5), None)
    for want in names:
        for name, kind, start, size in entries:
            if kind == 2 and name == want:
                if size >= cutoff or root is None:
                    return chain(start, fat, sector, limit)[:size]
                # маленький поток — в мини-секторах
                mini_data = chain(root[2], fat, sector, limit)
                mini_fat = []
                raw = chain(mini_fat_start, fat, sector, limit)
                mini_fat = list(struct.unpack("<%dI" % (len(raw) // 4), raw))
                return chain(start, mini_fat, lambda i: mini_data[i * msz:(i + 1) * msz], len(mini_fat) + 1)[:size]
    raise ValueError("в файле нет листа Workbook")


def _biff_string(buf, pos, lenbytes=2):
    """Строка BIFF8: длина, флаги (сжатая 8-битная или UTF-16), без форматирования и фонетики (они пропускаются)."""
    n = struct.unpack_from("<H" if lenbytes == 2 else "<B", buf, pos)[0]
    pos += lenbytes
    fl = buf[pos]
    pos += 1
    rt = sz = 0
    if fl & 0x08:
        rt = struct.unpack_from("<H", buf, pos)[0]
        pos += 2
    if fl & 0x04:
        sz = struct.unpack_from("<I", buf, pos)[0]
        pos += 4
    if fl & 0x01:
        s = buf[pos:pos + 2 * n].decode("utf-16-le", errors="replace")
        pos += 2 * n
    else:
        s = buf[pos:pos + n].decode("latin-1")
        pos += n
    return s, pos + rt * 4 + sz


def _rk(v):
    if v & 2:
        x = v >> 2
        if x & 0x20000000:
            x -= 0x40000000
        val = float(x)
    else:
        val = struct.unpack("<d", struct.pack("<Q", (v & 0xFFFFFFFC) << 32))[0]
    return val / 100 if v & 1 else val


def _sst(chunks):
    """Общая таблица строк BIFF8; строки могут переходить через записи CONTINUE (там свой флаг ширины символов)."""
    out = []
    if not chunks:
        return out
    total = struct.unpack_from("<I", chunks[0], 4)[0]
    ci, pos, buf = 0, 8, chunks[0]
    while len(out) < total:
        if pos >= len(buf):
            ci += 1
            if ci >= len(chunks):
                break
            buf, pos = chunks[ci], 0
        n = struct.unpack_from("<H", buf, pos)[0]
        fl = buf[pos + 2]
        pos += 3
        rt = sz = 0
        if fl & 0x08:
            rt = struct.unpack_from("<H", buf, pos)[0]
            pos += 2
        if fl & 0x04:
            sz = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
        wide, parts, left = fl & 1, [], n
        while left > 0:
            if pos >= len(buf):                          # строка продолжается в следующей записи CONTINUE
                ci += 1
                if ci >= len(chunks):
                    break
                buf, pos = chunks[ci], 1
                wide = chunks[ci][0] & 1
            take = min(left, (len(buf) - pos) // (2 if wide else 1))
            if take <= 0:
                break
            if wide:
                parts.append(buf[pos:pos + 2 * take].decode("utf-16-le", errors="replace"))
                pos += 2 * take
            else:
                parts.append(buf[pos:pos + take].decode("latin-1"))
                pos += take
            left -= take
        out.append("".join(parts))
        skip = rt * 4 + sz                               # форматирование и фонетика — тоже могут переходить
        while skip > 0:
            if pos >= len(buf):
                ci += 1
                if ci >= len(chunks):
                    break
                buf, pos = chunks[ci], 0
            step = min(skip, len(buf) - pos)
            pos += step
            skip -= step
    return out


def _xls_rows_builtin(data):
    """Первый лист старого .xls (BIFF8): числа и строки ячеек — встроенный разбор, xlrd не нужен."""
    wb = _ole_stream(data)
    recs, pos = [], 0
    while pos + 4 <= len(wb):
        rid, ln = struct.unpack_from("<HH", wb, pos)
        recs.append((rid, pos, wb[pos + 4:pos + 4 + ln]))
        pos += 4 + ln
    sst_chunks, first_sheet = [], None
    for i, (rid, at, body) in enumerate(recs):
        if rid == 0x00FC:                                # SST + следующие CONTINUE
            sst_chunks = [body]
            j = i + 1
            while j < len(recs) and recs[j][0] == 0x003C:
                sst_chunks.append(recs[j][2])
                j += 1
        elif rid == 0x0085 and first_sheet is None:      # BOUNDSHEET: где начинается лист
            if len(body) >= 6 and body[5] == 0:          # обычный лист (не диаграмма, не макрос)
                first_sheet = struct.unpack_from("<I", body, 0)[0]
    sst = _sst(sst_chunks)
    if first_sheet is None:
        return []
    cells, cells_n, pending = {}, 0, None
    start = next((k for k, r in enumerate(recs) if r[1] == first_sheet), None)
    if start is None:
        return []
    for rid, at, b in recs[start + 1:]:
        if rid == 0x000A:                                # EOF листа
            break
        try:
            if rid == 0x0203:                            # NUMBER
                r, c = struct.unpack_from("<HH", b, 0)
                cells[(r, c)] = _num_text(struct.unpack_from("<d", b, 6)[0])
            elif rid == 0x027E:                          # RK
                r, c = struct.unpack_from("<HH", b, 0)
                cells[(r, c)] = _num_text(_rk(struct.unpack_from("<I", b, 6)[0]))
            elif rid == 0x00BD:                          # MULRK: несколько RK подряд
                r, c0 = struct.unpack_from("<HH", b, 0)
                k = (len(b) - 6) // 6
                for j in range(k):
                    cells[(r, c0 + j)] = _num_text(_rk(struct.unpack_from("<I", b, 4 + j * 6 + 2)[0]))
            elif rid == 0x00FD:                          # LABELSST
                r, c = struct.unpack_from("<HH", b, 0)
                idx = struct.unpack_from("<I", b, 6)[0]
                cells[(r, c)] = sst[idx] if idx < len(sst) else ""
            elif rid == 0x0204:                          # LABEL
                r, c = struct.unpack_from("<HH", b, 0)
                cells[(r, c)] = _biff_string(b, 6)[0]
            elif rid == 0x0205:                          # BOOLERR
                r, c = struct.unpack_from("<HH", b, 0)
                cells[(r, c)] = ("TRUE" if b[6] else "FALSE") if b[7] == 0 else ""
            elif rid == 0x0006:                          # FORMULA: берём сохранённый результат
                r, c = struct.unpack_from("<HH", b, 0)
                res = b[6:14]
                if res[6:8] == b"\xff\xff":
                    if res[0] == 0:
                        pending = (r, c)                 # строка — в следующей записи STRING
                    elif res[0] == 1:
                        cells[(r, c)] = "TRUE" if res[2] else "FALSE"
                else:
                    cells[(r, c)] = _num_text(struct.unpack("<d", res)[0])
            elif rid == 0x0207 and pending:              # STRING после формулы
                cells[pending] = _biff_string(b, 0)[0]
                pending = None
        except struct.error:
            continue
        cells_n = len(cells)
        if cells_n > MAX_TABLE_CELLS:
            break
    if not cells:
        return []
    nrows = max(r for r, _ in cells) + 1
    width = {}
    for r, c in cells:
        width[r] = max(width.get(r, 0), c + 1)
    return [[cells.get((r, c), "") for c in range(width.get(r, 0))] for r in range(nrows)]


def _xls_rows(data):
    if xlrd is not None:
        sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
        return [[_num_text(c.value) if c.ctype == xlrd.XL_CELL_NUMBER else str(c.value) for c in sh.row(i)]
                for i in range(sh.nrows)]
    return _xls_rows_builtin(data)


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
            if ext not in order:
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
            for tid, was, now_n in clusters.fix_numbers(data.get("tasks", [])):
                print(f"Банк: задание {tid} перенесено из №{was} в №{now_n}", flush=True)
            clusters.annotate(data.get("tasks", []))   # тип задания внутри номера (c) и сложность 1–5 (r)
            self.titles = {b.get("id"): b.get("title") for b in data.get("banks", [])}
            for t in data.get("tasks", []):
                if t.get("id") in ANS_FIX:
                    t["ans"] = ANS_FIX[t["id"]]
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
            -- входы учеников: свой на каждом устройстве; shared — в школьной сети (временный); ended — когда вышли
            -- (закрытые хранятся SESSION_KEEP_DAYS: по ним видно школьную сеть и историю входов)
            CREATE TABLE IF NOT EXISTS student_sessions(
                id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE, student_id INTEGER NOT NULL, created REAL NOT NULL,
                last_seen REAL, ip TEXT, ua TEXT, shared INTEGER DEFAULT 0, ended REAL);
            CREATE INDEX IF NOT EXISTS student_sessions_s ON student_sessions(student_id);
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
            CREATE TABLE IF NOT EXISTS duel_elo(
                student_id INTEGER PRIMARY KEY, elo REAL NOT NULL, games INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS duel_queue(
                student_id INTEGER PRIMARY KEY, teacher_id INTEGER NOT NULL, level INTEGER, since REAL, seen REAL);
            CREATE TABLE IF NOT EXISTS tour_votes(
                tour_id INTEGER NOT NULL, student_id INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(tour_id, student_id, n));
            CREATE TABLE IF NOT EXISTS support(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, ts REAL NOT NULL, kind TEXT, text TEXT NOT NULL,
                task TEXT, page TEXT, status TEXT NOT NULL DEFAULT 'new', answer TEXT, answered REAL, seen INTEGER DEFAULT 1);
            CREATE INDEX IF NOT EXISTS support_student ON support(student_id);
            CREATE TABLE IF NOT EXISTS xp_adjust(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, ts REAL NOT NULL, delta INTEGER NOT NULL, reason TEXT);
            CREATE INDEX IF NOT EXISTS xp_adjust_student ON xp_adjust(student_id);
            -- дни, засчитанные огоньку без трёх заданий: freeze — сработала заморозка, restore — восстановил учитель
            CREATE TABLE IF NOT EXISTS fire_cover(
                student_id INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, ts REAL, PRIMARY KEY(student_id, day));
            -- подарки: от учителя (from_teacher) или купленные учеником за биткоины (from_sid); seen — уведомление показано;
            -- uniq — улучшенный (уникальный) подарок
            CREATE TABLE IF NOT EXISTS gifts(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, gift TEXT NOT NULL, ts REAL NOT NULL,
                from_sid INTEGER, from_teacher INTEGER, note TEXT, seen INTEGER DEFAULT 0, uniq TEXT, kind TEXT, sold REAL);
            CREATE INDEX IF NOT EXISTS gifts_student ON gifts(student_id, ts);
            -- экономика по дням — для графиков в «Экономике»: индекс цен, кошельки, рычаги термостата и банк на последний пересчёт дня
            CREATE TABLE IF NOT EXISTS econ_hist(day TEXT PRIMARY KEY, idx REAL, avg REAL, total INTEGER, active INTEGER);
            -- банк рынка биткоинов: сюда — комиссия рынка, плата за хранение, снятое учителем; отсюда — начисления
            -- учителей и стипендии; главный учитель может пополнить или изъять
            CREATE TABLE IF NOT EXISTS bank(
                id INTEGER PRIMARY KEY, ts REAL NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, note TEXT,
                student_id INTEGER, teacher_id INTEGER);
            -- термостат экономики: с момента ts действуют такие рычаги — индекс цен, множитель заработка, комиссия рынка,
            -- плата за хранение; r, avg, med, active — по каким кошелькам решено; who — auto, start или кто из учителей
            CREATE TABLE IF NOT EXISTS thermo(
                ts REAL PRIMARY KEY, idx REAL NOT NULL, earn REAL NOT NULL, fee REAL NOT NULL, tax REAL NOT NULL,
                r REAL, avg REAL, med REAL, active INTEGER, who TEXT);
            -- Forbes класса: состояние ученика (кошелёк + оценка подарков) на конец дня — для роста за неделю
            CREATE TABLE IF NOT EXISTS forbes_hist(day TEXT NOT NULL, student_id INTEGER NOT NULL, total INTEGER, PRIMARY KEY(day, student_id));
            -- ошибки JavaScript у учеников и учителей: одна строка на ошибку (что и где), сколько раз; последние случаи —
            -- кто, когда, на каком устройстве и версии; fixed_ts — главный учитель отметил «исправлено» (повторится — снова в списке)
            CREATE TABLE IF NOT EXISTS js_errors(
                id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, app TEXT, msg TEXT, src TEXT, stack TEXT,
                first_ts REAL, last_ts REAL, n INTEGER DEFAULT 0, ver TEXT, fixed_ts REAL);
            CREATE TABLE IF NOT EXISTS js_error_hits(
                id INTEGER PRIMARY KEY, error_id INTEGER NOT NULL, ts REAL NOT NULL, student_id INTEGER, teacher_id INTEGER,
                device TEXT, ver TEXT, page TEXT);
            CREATE INDEX IF NOT EXISTS js_error_hits_e ON js_error_hits(error_id, ts);
            -- отменённые учителем ответы (кто-то зашёл в чужой аккаунт): строка попытки целиком (JSON) — чтобы вернуть;
            -- batch — одна отмена (промежуток), teacher_id — кто отменил
            CREATE TABLE IF NOT EXISTS attempts_void(
                id INTEGER PRIMARY KEY, batch TEXT NOT NULL, student_id INTEGER NOT NULL, ts REAL, row TEXT NOT NULL,
                void_ts REAL NOT NULL, teacher_id INTEGER, t_from REAL, t_to REAL);
            CREATE INDEX IF NOT EXISTS attempts_void_s ON attempts_void(student_id, batch);
            -- лимитированный подарок недели: продаётся с start до stop, тираж cap, цена price
            CREATE TABLE IF NOT EXISTS limited(
                id INTEGER PRIMARY KEY, gift TEXT NOT NULL, start REAL NOT NULL, stop REAL NOT NULL, cap INTEGER NOT NULL,
                price INTEGER NOT NULL, who TEXT);
            -- курс биткоина: с какого момента 1 ₿ стоит k XP (меняется, когда одновременно занимается много учеников)
            CREATE TABLE IF NOT EXISTS btc_rate(ts REAL PRIMARY KEY, k INTEGER NOT NULL, active INTEGER);
            -- биткоины сверх заработанных опытом: начислил учитель (grant, +), снял учитель (take, −), продал подарок (sell, +),
            -- потратил на подарок (gift, −) или улучшение (upgrade, −)
            CREATE TABLE IF NOT EXISTS coins(
                id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL, ts REAL NOT NULL, delta INTEGER NOT NULL, reason TEXT,
                note TEXT, seen INTEGER DEFAULT 1, gift_id INTEGER);
            CREATE INDEX IF NOT EXISTS coins_student ON coins(student_id);
            -- переписка в обращении техподдержки: первое сообщение — support.text, дальше — здесь
            CREATE TABLE IF NOT EXISTS support_msgs(
                id INTEGER PRIMARY KEY, support_id INTEGER NOT NULL, ts REAL NOT NULL, who TEXT NOT NULL, text TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS support_msgs_s ON support_msgs(support_id, ts);
            -- курс «Программирование для ЕГЭ»: решённые задачи и попытки
            CREATE TABLE IF NOT EXISTS pyc_progress(
                student_id INTEGER NOT NULL, task_id TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 0, tries INTEGER NOT NULL DEFAULT 0,
                first_ts REAL, ok_ts REAL, last_ts REAL, code TEXT, PRIMARY KEY(student_id, task_id));
            """)
            # новые поля в старых базах
            gift_cols = {r[1] for r in c.execute("PRAGMA table_info(gifts)")}
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
                    ("students", "freezes", "INTEGER DEFAULT 0"),     # заморозки огонька в запасе (до FREEZE_MAX)
                    ("daily_starts", "task_id", "TEXT"),              # личное задание дня ученика; NULL — общее (до 1.53)
                    ("students", "pyc", "INTEGER DEFAULT 0"),         # ученик ввёл пароль курса программирования
                    ("students", "pyc_ts", "REAL"),                   # когда ввёл
                    ("students", "pyc_free", "INTEGER DEFAULT 0"),    # учитель открыл все уровни курса (без замков)
                    ("gifts", "uniq", "TEXT"),                        # улучшенный подарок: номер, фон, узор, эффект (JSON)
                    ("gifts", "kind", "TEXT"),                        # work — подарок за труд (каждые WORK_GIFT_EVERY решённых)
                    ("gifts", "sold", "REAL"),                        # продан или удалён учителем (сгорел): номер и сочетание больше не выдаются
                    ("gifts", "listed", "INTEGER"),                   # выставлен на рынок за столько ₿ (NULL — не продаётся)
                    ("gifts", "listed_ts", "REAL"),
                    ("gifts", "market_from", "INTEGER"),              # куплен на рынке у этого ученика
                    ("gifts", "market_ts", "REAL"),
                    ("gifts", "first_sid", "INTEGER"),                # первый владелец (до перепродажи на рынке): подарки за труд, журнал
                    ("gifts", "paid", "INTEGER"),                     # за сколько ₿ достался владельцу: продажа сразу — не дороже
                    ("gifts", "up_base", "INTEGER"),                  # уникальный: база улучшения (без индекса цен и тиража) — от неё оценка
                    ("coins", "note", "TEXT"),                        # причина начисления или снятия учителем
                    ("coins", "seen", "INTEGER DEFAULT 1"),           # 0 — ученик ещё не видел уведомление (учитель начислил или снял)
                    ("coins", "gift_id", "INTEGER"),                  # какой подарок купили, улучшили или продали (журнал экономики)
                    ("daily_results", "fast", "INTEGER DEFAULT 0"),   # решено нереально быстро — в рейтинг и корону не идёт
                    ("teachers", "consent_ver", "TEXT"),              # учитель тоже принимает документы
                    ("teachers", "consent_ts", "REAL"),
                    ("teachers", "consent_ip", "TEXT"),
                    ("assignments", "batch", "TEXT"),                 # серия личных подборок: fix:<id> — работа над ошибками, weak:<ts>
                    ("tournaments", "fmt", "INTEGER DEFAULT 0"),      # 2 — с групповым этапом
                    ("tour_players", "grp", "TEXT"),
                    ("tour_matches", "kind", "TEXT"),                 # group, po, final, third
                    ("tour_matches", "grp", "TEXT"),
                    ("tournaments", "nums", "TEXT"),
                    ("duels", "quick", "INTEGER DEFAULT 0"),
                    ("tour_matches", "created", "REAL"),              # когда матч появился (начало стадии)
                    ("tour_players", "gone", "INTEGER DEFAULT 0"),
                    ("duels", "tasks_b", "TEXT"),                     # свои задания второму игроку (та же сложность)
                    ("tour_matches", "tasks_b", "TEXT"),
                    ("duels", "a_elo", "REAL"),                       # изменение рейтинга Эло за дуэль
                    ("duels", "b_elo", "REAL"),
                    ("duels", "bonus", "INTEGER DEFAULT 0"),          # бонус победителю за серию побед
                    ("duels", "rematch_of", "INTEGER"),               # реванш за дуэль
                    ("duel_queue", "elo", "REAL"),
                    ("duel_queue", "nums", "TEXT"),                   # номера заданий, по которым ученик готов играть
                    ("tournaments", "theme", "TEXT"),                 # тематический турнир: python, sprint
                    ("tour_matches", "admin", "TEXT"),                # что сделал учитель вручную
                    ("duels", "surrender", "INTEGER"),                # кто сдался — проиграл сразу
                    ("tour_matches", "surrender", "INTEGER"),
                    ("support", "img", "TEXT"),                       # картинка к обращению (файл в server_data/support_img)
                    ("support_msgs", "img", "TEXT"),
                    ("econ_hist", "med", "REAL"),                     # медиана кошельков, рычаги термостата и банк к концу дня
                    ("econ_hist", "earn", "REAL"),
                    ("econ_hist", "fee", "REAL"),
                    ("econ_hist", "tax", "REAL"),
                    ("econ_hist", "bank", "INTEGER"),
                    ("econ_hist", "r", "REAL"),
                    ("econ_hist", "s_avg", "REAL"),                   # среднее и медиана состояния (кошелёк + подарки) — по ним термостат
                    ("econ_hist", "s_med", "REAL")):
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
            c.execute("DELETE FROM settings WHERE key='metrika_id'")     # старая настройка стороннего счётчика больше не нужна
            c.execute("UPDATE assignments SET kind='self' WHERE kind IS NULL")
            # прежние ответы техподдержки (одно поле answer) — первым сообщением учителя в переписке
            c.execute("""INSERT INTO support_msgs(support_id, ts, who, text)
                         SELECT id, COALESCE(answered, ts), 'teacher', answer FROM support
                         WHERE answer IS NOT NULL AND answer <> '' AND id NOT IN (SELECT support_id FROM support_msgs)""")
            c.execute("UPDATE assignments SET strict = CASE WHEN kind='self' THEN 1 ELSE 0 END")
            # «быстрее минуты — минус опыт» действует с первого запуска новой версии, задним числом опыт не отнимаем
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('fast_xp_since', ?)", (str(time.time()),))
            # «быстрее 30 секунд — минус биткоин» — тоже с первого запуска версии, задним числом не штрафуем
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('btc_fast_since', ?)", (str(time.time()),))
            # биткоины за вариант ЕГЭ по тестовому баллу — за варианты после этой версии (старые не начисляем разом)
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('exam_btc_since', ?)", (str(time.time()),))
            # бонус ₿ за решённое задание и за самостоятельную — тоже с первого запуска версии (за прошлое разом не начисляем)
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('task_btc_since', ?)", (str(time.time()),))
            # минимальное время на №24–27 — с первого запуска версии: раньше решённое не пересчитываем
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('hard_min_since', ?)", (str(time.time()),))
            # подарки, купленные «🎲» до отметки kind='box', — один раз: заплачено меньше 60 % каталожной цены выпавшего
            # (обычная покупка не бывает дешевле ~64 %: индекс цен от ×0,8 и спрос от ×0,8) — значит, выпал в «🎲»
            if not c.execute("SELECT 1 FROM settings WHERE key='box_kind_backfill'").fetchone():
                for gid, gift, paid in c.execute("""SELECT g.id, g.gift, -c.delta FROM gifts g JOIN coins c ON c.gift_id = g.id AND c.reason = 'gift'
                                                    WHERE g.kind IS NULL AND g.from_sid IS NOT NULL""").fetchall():
                    if gift in GIFT_BY and paid < 0.6 * GIFT_BY[gift][3]:
                        c.execute("UPDATE gifts SET kind='box' WHERE id=?", (gid,))
                c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('box_kind_backfill', '1')")
            if "paid" not in gift_cols:
                # за сколько достались прежние подарки — по журналу: купленные в магазине (кроме «🎲» — там цена коробки) и на рынке;
                # от учителя, за труд и из «🎲» — NULL (продажа сразу — по нынешней цене, но не выше цены без спроса)
                c.execute("""UPDATE gifts SET paid = (SELECT -k.delta FROM coins k WHERE k.gift_id = gifts.id AND k.delta < 0
                                                      AND k.reason = CASE WHEN gifts.market_from IS NULL THEN 'gift' ELSE 'mbuy' END
                                                      ORDER BY k.id DESC LIMIT 1)
                             WHERE COALESCE(kind, '') <> 'box' OR market_from IS NOT NULL""")
            if "up_base" not in gift_cols:
                # уже улучшенные — с базы прежней формулы (350 + 60 % каталожной цены): их оценка не падает
                for gid, gift in c.execute("SELECT id, gift FROM gifts WHERE uniq IS NOT NULL").fetchall():
                    if gift in GIFT_BY:
                        c.execute("UPDATE gifts SET up_base=? WHERE id=?", (round(UP_OLD[0] + UP_OLD[1] * GIFT_BY[gift][3]), gid))
            # входы по устройствам: прежний общий токен ещё LEGACY_DAYS дней превращается во вход устройства (вне школы)
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('sessions_since', ?)", (str(time.time()),))
            c.execute("CREATE INDEX IF NOT EXISTS attempts_ip ON attempts(ip, ts)")
            # акция перед пробником — включается сама при первом запуске версии (дальше её меняет главный учитель)
            if not c.execute("SELECT 1 FROM settings WHERE key='promo_seeded'").fetchone():
                P = dict(PROMO_SEED, **{"from": time.time(), "to": day_end(PROMO_SEED["to"])})
                c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES('promo', ?)", (json.dumps(P, ensure_ascii=False),))
                c.execute("INSERT INTO settings(key, value) VALUES('promo_seeded', '1')")
            # банку — половина заработка учеников: с первого запуска версии, за прошлое не начисляем
            c.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('labor_bank_since', ?)", (str(time.time()),))
            # банк рынка биткоинов открывается со стартовым капиталом (один раз)
            c.execute("""INSERT INTO bank(ts, delta, reason, note) SELECT ?, ?, 'start', 'Стартовый капитал банка'
                         WHERE NOT EXISTS (SELECT 1 FROM bank)""", (time.time(), BANK_START))
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


# ---------- живые обновления (SSE)
# Браузер держит одно долгое соединение /api/live (вкладки одного браузера делят его между собой),
# сервер пишет туда короткое «поменялось: comp» или «поменялось: asg» — браузер сам перезапрашивает нужное.
# Сами данные по соединению не идут: событие — несколько байт, а права проверяют обычные запросы.
LIVE_PING_SEC = 25          # «я жив» раз в столько секунд: прокси и браузер не рвут молчащее соединение
LIVE_LIFE_SEC = 30 * 60     # соединение живёт полчаса, потом браузер переподключается сам
LIVE_TICK_SEC = 5           # раз в столько секунд — ход турниров и проверка, поменялось ли что-то в дуэлях и турнирах
LIVE_MAX = 1500             # всего соединений; больше — браузер опрашивает сервер по-старому
LIVE_PER_STUDENT = 4        # на одного ученика (разные браузеры и устройства)
LIVE_RATE_GAP = 3           # «рейтинг изменился» — одноклассникам не чаще раза в столько секунд (класс решает пачкой)


def comp_sig(db, tid):
    """Подпись состояния дуэлей и турниров учителя: поменялась — ученикам пора обновить страницу турниров."""
    now = time.time()
    tours = db.q("""SELECT id, status, round, round_ends FROM tournaments WHERE teacher_id=?
                    AND (status IN ('reg','run') OR finished > ?) ORDER BY id""", (tid, now - 3600))
    ids = [t["id"] for t in tours]
    marks = ",".join("?" * len(ids))
    rows = [tuple(t) for t in tours]
    if ids:
        rows += [tuple(r) for r in db.q(f"""SELECT tour_id, COUNT(*), MAX(joined), SUM(COALESCE(place, 0)) FROM tour_players
                                            WHERE tour_id IN ({marks}) GROUP BY tour_id""", ids)]
        rows += [tuple(r) for r in db.q(f"SELECT tour_id, COUNT(*) FROM tour_votes WHERE tour_id IN ({marks}) GROUP BY tour_id", ids)]
        rows += [tuple(r) for r in db.q(f"""SELECT id, status, a_start, b_start, a_done, b_done, winner FROM tour_matches
                                            WHERE tour_id IN ({marks}) ORDER BY id""", ids)]
    sids = {m["id"] for m in teacher_students(db, tid)}
    for d in db.q("""SELECT id, a, b, status, a_start, b_start, a_done, b_done, winner FROM duels
                     WHERE status IN ('pending','active') OR finished > ? ORDER BY id""", (now - 3600,)):
        if d["a"] in sids or d["b"] in sids:
            rows.append(tuple(d))
    return hashlib.sha1(repr(rows).encode()).hexdigest()


class LiveHub:
    def __init__(self):
        self.lock = threading.Lock()
        self.subs = {}               # ученик -> {очередь: учитель}
        self.sig = {}                # учитель -> подпись дуэлей и турниров
        self.rate_due = set()        # учителя, у чьих учеников поменялся рейтинг (ещё не разослано)
        self.rate_at = {}            # учитель -> когда последний раз рассылали «рейтинг изменился»
        self.wake = threading.Event()
        self.thread = None

    def count(self):
        with self.lock:
            return sum(len(v) for v in self.subs.values())

    def subscribe(self, sid, tid):
        with self.lock:
            if sum(len(v) for v in self.subs.values()) >= LIVE_MAX or len(self.subs.get(sid, ())) >= LIVE_PER_STUDENT:
                return None
            q = queue.SimpleQueue()
            self.subs.setdefault(sid, {})[q] = tid
            if not self.thread:
                self.thread = threading.Thread(target=self.ticker, name="live", daemon=True)
                self.thread.start()
        return q

    def unsubscribe(self, sid, q):
        with self.lock:
            mine = self.subs.get(sid)
            if mine is not None:
                mine.pop(q, None)
                if not mine:
                    del self.subs[sid]

    def send(self, sids, topic):
        with self.lock:
            qs = [q for sid in set(sids) for q in self.subs.get(sid, ())]
        for q in qs:
            q.put(topic)

    def poke(self):
        """Что-то поменялось в дуэлях или турнирах — проверить сразу, не дожидаясь очередного хода."""
        self.wake.set()

    def rate(self, tid):
        """Ученик учителя tid получил опыт — рейтинг класса поменялся; разошлём пачкой из фонового потока."""
        with self.lock:
            if tid in self.rate_due or not any(t == tid for qs in self.subs.values() for t in qs.values()):
                return                   # уже ждёт рассылки — или никого из этого класса нет на сайте
            self.rate_due.add(tid)
        self.wake.set()

    def ticker(self):
        while True:
            wait = LIVE_TICK_SEC
            with self.lock:
                if self.rate_due:        # рейтинг ждёт рассылки — проснуться, как только выйдет пауза
                    now = time.time()
                    wait = min(wait, max(0.3, min(self.rate_at.get(t, 0) + LIVE_RATE_GAP - now for t in self.rate_due)))
            self.wake.wait(wait)
            self.wake.clear()
            if self.rate_due:
                time.sleep(0.3)          # ответы одноклассников подряд — одна рассылка
            try:
                self.check()
            except Exception as e:
                print(f"[живые обновления] {e!r}", flush=True)

    def check(self):
        if not APP:
            return
        with self.lock:
            by_tid = {}
            for sid, qs in self.subs.items():
                for tid in qs.values():
                    if tid is not None:          # у учителя (ключ ("t", id)) дуэлей и турниров нет
                        by_tid.setdefault(tid, set()).add(sid)
        now = time.time()
        with self.lock:
            due = {t for t in self.rate_due if now - self.rate_at.get(t, 0) >= LIVE_RATE_GAP}
            self.rate_due -= due         # кому рано — дошлём, когда выйдет пауза (ticker проснётся сам)
        for tid in due:
            self.rate_at[tid] = now
            if tid in by_tid:
                self.send(by_tid[tid], "rate")
        db = APP.db
        for tid, sids in by_tid.items():
            # ход турниров идёт и без запросов: этап закончился, неявка — ученики узнают сразу
            for t in db.q("SELECT * FROM tournaments WHERE teacher_id=? AND status IN ('reg','run')", (tid,)):
                tour_tick(db, t)
            sig = comp_sig(db, tid)
            old = self.sig.get(tid)
            self.sig[tid] = sig
            if old is not None and old != sig:
                self.send(sids, "comp")
        for tid in list(self.sig):
            if tid not in by_tid:
                del self.sig[tid]


LIVE = LiveHub()


def live_teacher(s, main=False):
    """Учителю ученика (и главному, если main) — «в ленте новое»: ответ, сдача работы, вариант, обращение."""
    keys = [("t", s["teacher_id"] or main_teacher()["id"])]
    if main:
        keys.append(("t", main_teacher()["id"]))
    LIVE.send(keys, "feed")


def live_class(db, cid, sids=None):
    """Ученикам класса (или только выбранным) — «поменялись подборки»."""
    if sids is None:
        sids = [r["id"] for r in db.q("SELECT id FROM students WHERE class_id=?", (cid,))]
    LIVE.send(sids, "asg")


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
            if path == "/api/live":
                return self.live()
            if path == "/api/admin/live":
                return self.live_admin()
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
        if rel.startswith("pyc-data/"):           # файлы к задачам курса программирования (без ответов)
            return self.serve_file(HERE / "pycourse" / "data", rel[len("pyc-data/"):])
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
        if p.suffix.lower() not in (".html", ".js", ".mjs", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".woff2", ".wasm",
                                    ".ico", ".webmanifest"):
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
        if not student_by_token(APP.db, self.cookie("egest"), self.client_ip())[0]:
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

    def support_img(self, name, sid):
        """Картинка из техподдержки: автору обращения (sid) или главному учителю (sid=None)."""
        name = str(name or "")
        if not SUPPORT_IMG_RE.fullmatch(name):
            return self.err(404, "нет такой картинки")
        if sid is not None and not APP.db.q(
                """SELECT 1 FROM support p WHERE p.student_id=? AND (p.img=? OR EXISTS
                   (SELECT 1 FROM support_msgs m WHERE m.support_id=p.id AND m.img=?))""", (sid, name, name), one=True):
            return self.err(404, "нет такой картинки")
        f = support_img_dir() / name
        if not f.is_file():
            return self.err(404, "нет такой картинки")
        return self.send_bytes(200, f.read_bytes(), SUPPORT_IMG_MIME[name.rsplit(".", 1)[1]],
                               {"Cache-Control": "private, max-age=86400", "Content-Security-Policy": "default-src 'none'"})

    # ---------- живые обновления
    def live(self):
        s = self.student()
        if not s or s["is_teacher"]:
            return self.err(401, "нужно войти")
        return self.live_stream(s["id"], teacher_of(s)["id"])

    def live_admin(self):
        if not self.is_admin():
            return self.err(401, "нужно войти")
        return self.live_stream(("t", self.T["id"]), None)

    def live_stream(self, key, tid):
        q = LIVE.subscribe(key, tid)
        if q is None:
            return self.err(503, "много соединений — обновления придут обычными запросами")
        self.close_connection = True
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")    # прокси не копит и не сжимает поток
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command == "HEAD":
                return
            self.wfile.write(b"event: hello\ndata: {}\n\n")
            self.wfile.flush()
            LIVE.poke()                          # запомнить подпись дуэлей и турниров к первому событию
            end = time.time() + LIVE_LIFE_SEC
            while time.time() < end:
                try:
                    topics = {q.get(timeout=LIVE_PING_SEC)}
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                time.sleep(0.15)                 # пачка событий подряд — одно сообщение на тему
                while True:
                    try:
                        topics.add(q.get_nowait())
                    except queue.Empty:
                        break
                self.wfile.write("".join(f"event: {t}\ndata: {{}}\n\n" for t in sorted(topics)).encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
            pass                                 # вкладку закрыли или связь пропала — браузер переподключится сам
        finally:
            LIVE.unsubscribe(key, q)

    # ---------- API
    def cookie(self, name):
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        return c[name].value if name in c else None

    def student_cookie(self, token, temp=False):
        # «Чужой компьютер» (заголовок X-Temp) и школьная сеть: cookie без срока — сотрётся, когда закроют браузер
        life = "" if temp or self.headers.get("X-Temp") == "1" else f"; Max-Age={STUDENT_COOKIE_DAYS * 86400}"
        return f"egest={token}; Path=/; HttpOnly; SameSite=Lax{life}{self.cookie_attrs()}"

    def wait_msg(self, sec):
        m = max(1, round(sec / 60))
        return f"Слишком много неверных попыток. Подождите {m} мин."

    def student(self, data=None):
        """Ученик по токену входа (заголовок, тело запроса или cookie); self.sess — вход этого устройства (None — прежний
        общий токен), self.tok — токен, которым вошли."""
        tok = self.headers.get("X-Token") or (data or {}).get("token") or self.cookie("egest")
        ip = self.client_ip()
        s, sess = student_by_token(APP.db, tok, ip)
        self.sess, self.tok = sess, (tok if s else None)
        if s:
            now = time.time()
            APP.db.x("UPDATE students SET last_seen=?, last_ip=? WHERE id=?", (now, ip, s["id"]))
            if sess and (now - (sess["last_seen"] or 0) > 60 or sess["ip"] != ip):
                APP.db.x("UPDATE student_sessions SET last_seen=?, ip=? WHERE id=?", (now, ip, sess["id"]))
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
        aid = APP.db.x("""INSERT INTO attempts(student_id,ts,task_id,n,bank,answers,correct,score,gave_up,abandoned,
                                               spent_ms,reason,rk,part,grp,revealed,exam,ip,away,away_sec,flags)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (s["id"], time.time(), t["id"], t.get("n"), t.get("bank"), json.dumps(answers, ensure_ascii=False),
                         t.get("ans", ""), score, int(gave_up), int(abandoned), spent, reason, rk, part,
                         t.get("group"), int(revealed), exam, self.client_ip(), away or None, away_sec, flags))
        live_teacher(s)                          # учитель видит ответ в ленте сразу
        LIVE.send([s["id"]], "mine")             # другие вкладки и устройства ученика: опыт, уровень, плитки номеров
        if score > 0 and not s["is_teacher"]:
            LIVE.rate(s["teacher_id"] or main_teacher()["id"])     # одноклассники видят рейтинг без перезагрузки
        return aid

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
        ms = int((time.time() - t0) * 1000)
        fast = int(ms < DAILY_MIN_SEC.get(t.get("n"), 10) * 1000)
        APP.db.x("INSERT OR IGNORE INTO daily_results(day, student_id, task_id, ms, ts, fast) VALUES(?,?,?,?,?,?)",
                 (day, s["id"], t["id"], ms, time.time(), fast))
        return bool(fast)

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
        return {"sid": s["id"], "name": s["name"], "token": getattr(self, "tok", None) or s["token"], "prefs": prefs,
                "shared": bool(getattr(self, "sess", None) and self.sess["shared"]),
                "fc": load(s["fc"], []), "rules": self.rules(s), "has_password": bool(s["pw"]),
                "game": game_summary(APP.db, s["id"]), "class_id": s["class_id"], "course": course_open(s), "pyc": pyc_access(s),
                "pyc_pw": bool(APP.db.setting("pyc_pw")), "gifts_new": gift_rows(APP.db, s["id"], "AND g.seen = 0", 10),
                "coin_news": [dict(r) for r in APP.db.q("""SELECT id, delta, reason, note FROM coins
                                                            WHERE student_id=? AND seen=0 ORDER BY ts LIMIT 10""", (s["id"],))],
                "teacher": bool(s["is_teacher"]), "promo": promo_now(APP.db),
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

    def pyc_api(self, method, path, qs, data):
        """Курс программирования для ученика: план, уровень (слайды и задачи без ответов), проверка ответа."""
        db = APP.db
        s = self.student(data)
        if not s:
            return self.err(401, "нужно войти")
        if path == "/api/pyc/unlock" and method == "POST":
            # вход по паролю курса (как у раздела «Курс»): кто знает пароль — тому курс открыт
            if pyc_access(s):
                return self.send_json({"ok": True})
            stored = db.setting("pyc_pw")
            if not stored:
                return self.err(403, "Курс программирования открывает учитель")
            now = time.time()
            with _COURSE_LOCK:
                tries = [t for t in _PYC_PW_TRIES.get(s["id"], []) if now - t < COURSE_WINDOW]
                if len(tries) >= COURSE_TRIES:
                    return self.err(429, f"Слишком много попыток — попробуйте через {int((COURSE_WINDOW - (now - tries[0])) // 60) + 1} мин")
                tries.append(now)
                _PYC_PW_TRIES[s["id"]] = tries
            if not check_pw(str(data.get("password") or "").strip()[:200], stored):
                return self.err(403, "Неверный пароль курса")
            db.x("UPDATE students SET pyc=1, pyc_ts=? WHERE id=?", (now, s["id"]))
            live_teacher(s)                       # во вкладке «Программирование» у учителя ученик появится сразу
            return self.send_json({"ok": True})
        if not pyc_access(s):
            if path == "/api/pyc":
                return self.send_json({"access": False, "pw": bool(db.setting("pyc_pw"))})
            return self.err(403, "Курс программирования открывается по паролю от учителя")
        teacher = bool(s["is_teacher"])
        free = teacher or bool(s["pyc_free"])   # все уровни открыты: учителю и ученику, которому учитель так открыл
        prog = pyc_solved(db, s["id"])
        if path == "/api/pyc":
            mods = []
            for m in pyc_index():
                mods.append({**m, "open": pyc_open_levels(m, prog, free)})
            return self.send_json({"access": True, "teacher": teacher, "modules": mods,
                                   "progress": {k: v for k, v in prog.items()}})
        if path == "/api/pyc/level":
            mod = pyc_module(qs.get("m"))
            li = to_int(qs.get("l"))
            if not mod or li is None or not 0 <= li < len(mod["levels"]):
                return self.err(404, "нет такого уровня")
            if li >= pyc_open_levels(mod, prog, free):
                return self.err(403, "Уровень ещё закрыт: решите задачи предыдущего")
            lv = mod["levels"][li]
            tasks = []
            for t in lv["tasks"]:
                p = prog.get(t["id"]) or {}
                x = {k: t[k] for k in ("id", "h", "cond", "stars", "hint", "note", "files") if k in t}
                x.update(ok=bool(p.get("ok")), tries=p.get("tries", 0))
                if p.get("ok") or p.get("tries", 0) >= 3 or teacher:
                    x["sol"] = t["sol"]                 # разбор — после решения или трёх неудачных попыток
                if p.get("ok") or teacher:
                    x["ans"] = t["ans"]
                tasks.append(x)
            return self.send_json({"id": mod["id"], "n": mod["n"], "title": mod["title"], "icon": mod["icon"],
                                   "levels": len(mod["levels"]), "l": li,
                                   "level": {"title": lv["title"], "goal": lv["goal"], "need": lv["need"],
                                             "slides": lv["slides"], "tasks": tasks}})
        if path == "/api/pyc/check" and method == "POST":
            tid = str(data.get("task") or "")[:40]
            mod, li, t = pyc_task(tid)
            if not t:
                return self.err(404, "нет такой задачи")
            if li >= pyc_open_levels(mod, prog, free):
                return self.err(403, "Уровень ещё закрыт")
            ans = str(data.get("answer") or "").strip()[:300]
            if not ans:
                return self.err(400, "Введите ответ")
            now = time.time()
            with _PYC_LOCK:
                tries = [x for x in _PYC_TRIES.get(s["id"], []) if now - x < PYC_WINDOW]
                if len(tries) >= PYC_CHECKS:
                    return self.err(429, "Слишком много проверок подряд — подождите минуту")
                tries.append(now)
                _PYC_TRIES[s["id"]] = tries
            ok = pyc_norm(ans) == pyc_norm(t["ans"])
            code = str(data.get("code") or "")[:20000] or None
            was = prog.get(tid) or {}
            if was.get("ok"):
                return self.send_json({"ok": ok, "already": True, "tries": was.get("tries", 0), "ans": t["ans"], "sol": t["sol"]})
            db.x("""INSERT INTO pyc_progress(student_id, task_id, ok, tries, first_ts, ok_ts, last_ts, code) VALUES(?,?,?,?,?,?,?,?)
                    ON CONFLICT(student_id, task_id) DO UPDATE SET ok=excluded.ok, tries=tries + 1, last_ts=excluded.last_ts,
                      ok_ts=COALESCE(ok_ts, excluded.ok_ts), code=COALESCE(excluded.code, code)""",
                 (s["id"], tid, int(ok), 1, now, now if ok else None, now, code))
            prog = pyc_solved(db, s["id"])
            n_tries = prog[tid]["tries"]
            out = {"ok": ok, "tries": n_tries}
            if ok or n_tries >= 3 or teacher:
                out["sol"] = t["sol"]
            if ok:
                out["ans"] = t["ans"]
                before = li + 1
                out["opened"] = pyc_open_levels(mod, prog, free) > before and before < len(mod["levels"])
                live_teacher(s)                 # у учителя обновится прогресс курса
            return self.send_json(out)
        return self.err(404, "нет такого метода")

    def api(self, method, path, qs, data):
        try:
            return self.api_route(method, path, qs, data)
        finally:
            if method == "POST" and ("/tour" in path or "/duel" in path):
                LIVE.poke()                      # дуэль или турнир поменялись — соперники узнают сразу

    def api_route(self, method, path, qs, data):
        db = APP.db
        # ----- ученик
        if path == "/api/ping":
            return self.send_json({"ok": True, "server": True})

        if path == "/api/jserr" and method == "POST":
            # ошибка JavaScript в браузере — для вкладки «Ошибки» главного учителя; вход не нужен (ошибка могла быть до входа)
            s = self.student(data) if data.get("app") != "admin" else None
            tid = self.T["id"] if data.get("app") == "admin" and self.is_admin() else None
            ok = jserr_add(db, data, self.client_ip(), s["id"] if s else None, tid, self.headers.get("User-Agent") or "")
            return self.send_json({"ok": ok})

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
            # вход — свой на этом устройстве; в школьной сети (и «Чужой компьютер») — временный
            shared = shared_ip(db, ip) or self.headers.get("X-Temp") == "1"
            self.tok = session_new(db, s["id"], ip, self.headers.get("User-Agent"), shared)
            self.sess = db.q("SELECT * FROM student_sessions WHERE token=?", (self.tok,), one=True)
            _SHARED.pop(ip, None)                      # новый ученик с этого адреса — школьную сеть проверим заново
            return self.send_json(self.me_payload(s), extra={"Set-Cookie": self.student_cookie(self.tok, temp=shared)})

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

        if path == "/api/freeze/buy" and method == "POST":
            # заморозка огонька: до FREEZE_MAX в запасе, каждая за FREEZE_PRICE опыта
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if s["is_teacher"]:
                return self.err(403, "учительскому аккаунту заморозки не нужны")
            have = db.q("SELECT freezes FROM students WHERE id=?", (s["id"],), one=True)["freezes"] or 0
            if have >= FREEZE_MAX:
                return self.err(409, f"В запасе уже {FREEZE_MAX} заморозки — больше не поместится")
            if game_summary(db, s["id"])["xp"] < FREEZE_PRICE:
                return self.err(400, f"Нужно {FREEZE_PRICE} XP")
            db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?, 'freeze')", (s["id"], time.time(), -FREEZE_PRICE))
            db.x("UPDATE students SET freezes=COALESCE(freezes, 0) + 1 WHERE id=?", (s["id"],))
            return self.send_json({"ok": True, "game": game_summary(db, s["id"])})

        if path == "/api/forbes":
            # Forbes класса: самые богатые (кошелёк + подарки), самый дорогой подарок, самая дорогая и самая редкая коллекция
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            return self.send_json(forbes_view(forbes_data(db, teacher_of(s)["id"]), s["id"]))

        if path == "/api/gifts/price":
            # график цены подарка в магазине за PRICE_DAYS дней: по дням и сейчас, с числом покупок за неделю
            if not self.student(data):
                return self.err(401, "нужно войти")
            gid = str(qs.get("gift") or data.get("gift") or "")
            if gid not in GIFT_BY or gid in LIMITED_BY:
                return self.err(404, "У этого подарка нет цены в магазине")
            return self.send_json({"gift": gid, "pts": gift_price_points(db, gid, econ(db)), "week": DEMAND_DAYS})

        if path in ("/api/gifts", "/api/gifts/buy", "/api/gifts/seen", "/api/gifts/upgrade", "/api/gifts/sell",
                    "/api/gifts/list", "/api/gifts/unlist", "/api/gifts/mbuy"):
            # биткоины и подарки: магазин (цены по индексу термостата), свои подарки, подарить себе или однокласснику (ученику того же
            # учителя), улучшить до уникального (тираж ограничен) и продать — подарок сгорает, биткоины возвращаются;
            # рынок: выставить свой подарок за свою цену и купить у одноклассника (комиссия термостата — в банк рынка)
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            mates = [m for m in teacher_students(db, teacher_of(s)["id"]) if m["id"] != s["id"]]
            if path in ("/api/gifts", "/api/gifts/list", "/api/gifts/mbuy"):
                market_expire(db)                         # лоты старше недели — снять
            if path == "/api/gifts/seen":
                for table, key in (("gifts", "ids"), ("coins", "coin_ids")):
                    ids = [to_int(x) for x in (data.get(key) or []) if to_int(x)][:50]
                    if ids:
                        db.x(f"UPDATE {table} SET seen=1 WHERE student_id=? AND id IN ({','.join('?' * len(ids))})", (s["id"], *ids))
                return self.send_json({"ok": True})
            if path != "/api/gifts" and method != "POST":
                return self.err(405, "нужен POST")
            if path != "/api/gifts" and s["is_teacher"]:
                return self.err(403, "Учительскому аккаунту биткоины не нужны — дарите из панели учителя")
            e = econ(db)
            if path == "/api/gifts/buy":
                box = data.get("gift") == "box"           # «случайный подарок»: что выпадет — решает gift_random
                g = gift_random(random.SystemRandom()) if box else GIFT_BY.get(str(data.get("gift") or ""))
                if not g:
                    return self.err(400, "Нет такого подарка")
                price = gift_box_price(db, e) if box else gift_price(g[0], e, gift_demand(db))
                lim = g[0] in LIMITED_BY                  # лимитка недели: своя цена и тираж
                if lim:
                    L = limited_now(db)
                    if not L or L["gift"] != g[0]:
                        return self.err(409, "Этот лимитированный подарок больше не продаётся")
                    price = L["price"]
                to = to_int(data.get("to")) or s["id"]
                rcpt = s if to == s["id"] else next((m for m in mates if m["id"] == to), None)
                if not rcpt:
                    return self.err(404, "Дарить можно только себе и ученикам своего учителя")
                now = time.time()
                with _GIFT_LOCK:
                    day = db.q("SELECT COUNT(*) c FROM gifts WHERE from_sid=? AND ts>?", (s["id"], now - 86400), one=True)["c"]
                    if day >= GIFTS_PER_DAY:
                        return self.err(429, f"За сутки можно купить не больше {GIFTS_PER_DAY} подарков")
                    if lim and not (limited_now(db) or {}).get("left"):
                        return self.err(409, f"Лимитку «{g[2]}» уже раскупили — все {LIMITED_CAP} штук")
                    have = game_summary(db, s["id"])["coins"]
                    if have < price:
                        return self.err(400, f"Не хватает биткоинов: нужно {price} ₿, у тебя {have} ₿")
                    # за сколько достался: из «🎲» — нынешняя цена выпавшего (а не коробки), иначе — заплаченное
                    paid = gift_price(g[0], e, gift_demand(db)) if box else price
                    gid = db.x("INSERT INTO gifts(student_id, gift, ts, from_sid, seen, kind, paid) VALUES(?,?,?,?,?,?,?)",
                               (rcpt["id"], g[0], now, s["id"], 1 if rcpt["id"] == s["id"] else 0, "box" if box else None, paid))
                    db.x("INSERT INTO coins(student_id, ts, delta, reason, gift_id) VALUES(?,?,?, 'gift', ?)", (s["id"], now, -price, gid))
                    if box:                                       # «🎲»: вся цена — в банк рынка (не сгорает)
                        bank_move(db, price, "box", f"выпал {g[1]} {g[2]} за {price} ₿", sid=s["id"], ts=now)
                    else:
                        cut = op_cut(price, e)
                        if cut:
                            bank_move(db, cut, "ops", f"{g[1]} {g[2]}: покупка за {price} ₿", sid=s["id"], ts=now)
                with _GS_LOCK:
                    _LB_PEOPLE.pop(teacher_of(s)["id"], None)    # в рейтинге подарок у ника виден сразу
                _DEMAND["t"] = 0.0                               # спрос изменился — цены пересчитаются
                if rcpt["id"] != s["id"]:
                    LIVE.send([rcpt["id"]], "gift")
                return self.send_json({"ok": True, "got": g[0], "game": game_summary(db, s["id"])})
            if path in ("/api/gifts/upgrade", "/api/gifts/sell"):
                r = db.q("SELECT id, gift, uniq, listed, paid, up_base FROM gifts WHERE id=? AND student_id=? AND sold IS NULL",
                         (to_int(data.get("id")), s["id"]), one=True)
                if not r or r["gift"] not in GIFT_BY:
                    return self.err(404, "Нет такого подарка")
                if r["listed"] is not None:
                    return self.err(409, "Подарок выставлен на рынок — сначала сними его с продажи")
                now = time.time()
                with _GIFT_LOCK:
                    issued = uniq_issued(db)
                    if path == "/api/gifts/upgrade":
                        # улучшить свой подарок: он станет уникальным — номер и случайные фон, узор и эффект
                        if r["uniq"]:
                            return self.err(409, "Этот подарок уже уникальный")
                        if r["gift"] in LIMITED_BY:
                            return self.err(409, "Лимитированный подарок не улучшается — он и так редкий")
                        price = gift_up_price(r["gift"], e, issued)
                        if price is None:
                            return self.err(409, f"Тираж уникальных «{GIFT_BY[r['gift']][2]}» закончился: выпущено {UNIQ_CAP} из {UNIQ_CAP}")
                        have = game_summary(db, s["id"])["coins"]
                        if have < price:
                            return self.err(400, f"Не хватает биткоинов: нужно {price} ₿, у тебя {have} ₿")
                        db.x("INSERT INTO coins(student_id, ts, delta, reason, gift_id) VALUES(?,?,?, 'upgrade', ?)", (s["id"], now, -price, r["id"]))
                        db.x("UPDATE gifts SET uniq=?, up_base=? WHERE id=?", (json.dumps(gift_uniq(db, r["gift"])), gift_up_raw(r["gift"]), r["id"]))
                        cut = op_cut(price, e)
                    else:
                        # продать: подарок сгорает (номер и сочетание уникального больше не выдаются), ученику — 90 % цены,
                        # остальное — в банк рынка
                        u_now, dem_now = uniq_pub(r["uniq"]) if r["uniq"] else None, gift_demand(db)
                        gross = gift_sell_gross(r["gift"], u_now, e, issued, dem_now, r["paid"], r["up_base"])
                        price = gift_sell_price(r["gift"], u_now, e, issued, dem_now, r["paid"], r["up_base"])
                        cut = gross - price
                        db.x("UPDATE gifts SET sold=? WHERE id=?", (now, r["id"]))
                        db.x("INSERT INTO coins(student_id, ts, delta, reason, gift_id) VALUES(?,?,?, 'sell', ?)", (s["id"], now, price, r["id"]))
                    if cut:
                        what = "улучшение за" if path == "/api/gifts/upgrade" else "продажа сразу, выплачено"
                        bank_move(db, cut, "ops", f"{GIFT_BY[r['gift']][1]} {GIFT_BY[r['gift']][2]}: {what} {price} ₿", sid=s["id"], ts=now)
                with _GS_LOCK:
                    _LB_PEOPLE.pop(teacher_of(s)["id"], None)
                out = {"ok": True, "price": price, "fee": cut, "game": game_summary(db, s["id"])}
                if path == "/api/gifts/upgrade":
                    out["gift"] = gift_rows(db, s["id"], "AND g.id = %d" % r["id"], 1, (e, uniq_issued(db), gift_demand(db)))[0]
                return self.send_json(out)
            if path in ("/api/gifts/list", "/api/gifts/unlist"):
                # выставить свой подарок на рынок за свою цену (или поменять цену) и снять с продажи
                r = db.q("SELECT id, gift, listed, kind, market_from, uniq, up_base FROM gifts WHERE id=? AND student_id=? AND sold IS NULL",
                         (to_int(data.get("id")), s["id"]), one=True)
                if not r or r["gift"] not in GIFT_BY:
                    return self.err(404, "Нет такого подарка")
                if path == "/api/gifts/unlist":
                    db.x("UPDATE gifts SET listed=NULL, listed_ts=NULL WHERE id=?", (r["id"],))
                    return self.send_json({"ok": True})
                price = to_int(data.get("price"))
                cap = market_cap(r["gift"], uniq_pub(r["uniq"]) if r["uniq"] else None, e, gift_demand(db), r["up_base"])
                if not price or not MARKET_MIN <= price <= cap:
                    return self.err(400, f"Цена — от {MARKET_MIN} до {cap} ₿")
                if r["listed"] is None and db.q("SELECT COUNT(*) c FROM gifts WHERE student_id=? AND listed IS NOT NULL AND sold IS NULL",
                                                (s["id"],), one=True)["c"] >= MARKET_MAX_LISTED:
                    return self.err(429, f"На рынке может быть не больше {MARKET_MAX_LISTED} твоих подарков — сними какой-нибудь")
                db.x("UPDATE gifts SET listed=?, listed_ts=? WHERE id=?", (price, time.time(), r["id"]))
                fee = market_fee(e, r)
                return self.send_json({"ok": True, "price": price, "get": price - math.ceil(price * fee), "fee": fee})
            if path == "/api/gifts/mbuy":
                # купить подарок у одноклассника: он переходит к покупателю (номер и свойства уникального сохраняются),
                # продавцу — цена минус комиссия, комиссия — в банк рынка
                with _GIFT_LOCK:
                    r = db.q("""SELECT id, gift, listed, student_id, kind, market_from FROM gifts
                                WHERE id=? AND listed IS NOT NULL AND sold IS NULL""",
                             (to_int(data.get("id")),), one=True)
                    seller = next((m for m in mates if r and m["id"] == r["student_id"]), None)
                    if not r or r["gift"] not in GIFT_BY or not seller:
                        return self.err(404, "Этот подарок уже купили или сняли с продажи")
                    price = int(r["listed"])
                    if to_int(data.get("price")) and to_int(data.get("price")) != price:
                        return self.err(409, f"Продавец поменял цену: теперь {price} ₿")
                    have = game_summary(db, s["id"])["coins"]
                    if have < price:
                        return self.err(400, f"Не хватает биткоинов: нужно {price} ₿, у тебя {have} ₿")
                    fee, now = math.ceil(price * market_fee(e, r)), time.time()
                    if not db.xn("""UPDATE gifts SET student_id=?, listed=NULL, listed_ts=NULL, market_from=?, market_ts=?,
                                           first_sid=COALESCE(first_sid, ?), seen=1, paid=?
                                    WHERE id=? AND student_id=? AND listed=? AND sold IS NULL""",
                                 (s["id"], seller["id"], now, seller["id"], price, r["id"], seller["id"], price)):
                        return self.err(409, "Этот подарок уже купили")
                    db.x("INSERT INTO coins(student_id, ts, delta, reason, gift_id, note) VALUES(?,?,?, 'mbuy', ?, ?)",
                         (s["id"], now, -price, r["id"], short_name(seller["name"])))
                    db.x("INSERT INTO coins(student_id, ts, delta, reason, gift_id, note, seen) VALUES(?,?,?, 'msell', ?, ?, 0)",
                         (seller["id"], now, price - fee, r["id"], short_name(s["name"])))
                    if fee:
                        bank_move(db, fee, "fee", f"{GIFT_BY[r['gift']][1]} {GIFT_BY[r['gift']][2]} за {price} ₿", sid=seller["id"], ts=now)
                with _GS_LOCK:
                    _LB_PEOPLE.pop(teacher_of(s)["id"], None)
                LIVE.send([seller["id"]], "gift")               # продавцу — уведомление и новый счёт сразу
                return self.send_json({"ok": True, "price": price, "fee": fee, "game": game_summary(db, s["id"])})
            g = game_summary(db, s["id"])
            issued, dem = uniq_issued(db), gift_demand(db)
            rate, active = btc_rate_now(db)
            mine = gift_rows(db, s["id"], prices=(e, issued, dem))
            return self.send_json({
                "coins": g["coins"], "coin_xp": rate, "rate_active": active, "rate_base": COIN_XP, "rate_max": BTC_RATE_MAX,
                "rate_free": BTC_RATE_FREE, "rate_step": BTC_RATE_STEP, "teacher": bool(s["is_teacher"]),
                "fines": g["btc_fast"], "fine_sec": BTC_FAST_MS // 1000, "hard_min": {n: ms // 60000 for n, ms in HARD_MIN_MS.items()},
                "ledger": [dict(r) for r in db.q("""SELECT ts, delta, reason, note FROM coins WHERE student_id=?
                                                    ORDER BY ts DESC, id DESC LIMIT 40""", (s["id"],))],
                "econ": e, "cap": UNIQ_CAP, "work_every": WORK_GIFT_EVERY,
                "uniq_tiers": [{"k": k, "t": t, "one_in": round(1 / low) if low else None} for low, k, t in UNIQ_RARITY],
                "catalog": [{"id": k, "i": i, "t": t, "price": gift_price(k, e, dem), "base": pr, "rar": gift_rarity(k),
                             "demand": dem.get(k, 1.0), "issued": issued.get(k, 0)} for k, i, t, pr in sorted(GIFTS, key=lambda g: g[3])],
                "box": gift_box_price(db, e), "up_min": min(gift_up_base(g[0], e) for g in GIFTS), "limited": limited_now(db),
                "exam_btc": EXAM_BTC, "exam_coins": g["exam_coins"], "task_coins": g["task_coins"],
                "mine": mine, "value": gift_value(mine, e, dem),
                "market": market_rows(db, [s["id"]] + [m["id"] for m in mates], s["id"], e, issued, dem),
                "market_fee": e["fee"], "market_fee_box": MARKET_FEE_BOX, "market_min": MARKET_MIN, "market_max": MARKET_MAX, "market_max_listed": MARKET_MAX_LISTED,
                "market_days": MARKET_DAYS, "promo": promo_now(db),
                "mates": sorted(({"sid": m["id"], "name": short_name(m["name"])} for m in mates), key=lambda x: x["name"]),
                "bought_today": db.q("SELECT COUNT(*) c FROM gifts WHERE from_sid=? AND ts>?", (s["id"], time.time() - 86400), one=True)["c"],
                "per_day": GIFTS_PER_DAY, "show": GIFTS_SHOW})

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
            db.x("UPDATE students SET pw=? WHERE id=?", (hash_pw(new), s["id"]))
            # вход на других устройствах сбрасывается; это устройство остаётся (прежний общий токен — становится входом устройства)
            tok = self.tok if self.sess else session_new(db, s["id"], ip, self.headers.get("User-Agent"), False)
            sess = self.sess or db.q("SELECT * FROM student_sessions WHERE token=?", (tok,), one=True)
            sessions_end(db, s["id"], keep=sess["id"])
            return self.send_json({"ok": True, "token": tok}, extra={"Set-Cookie": self.student_cookie(tok, temp=bool(sess["shared"]))})

        if path == "/api/me":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            # вход по сохранённому в браузере токену продлевает cookie; вход по одной cookie её срок не трогает
            # (иначе вкладка без «Чужого компьютера» сделала бы временный вход постоянным)
            extra = {"Set-Cookie": self.student_cookie(self.tok, temp=bool(self.sess["shared"]))} if self.headers.get("X-Token") and self.sess else None
            if not self.sess:                          # прежний общий токен — теперь вход этого устройства, со своим токеном
                self.tok = session_new(db, s["id"], self.client_ip(), self.headers.get("User-Agent"), False)
                self.sess = db.q("SELECT * FROM student_sessions WHERE token=?", (self.tok,), one=True)
                extra = {"Set-Cookie": self.student_cookie(self.tok)}
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

        if path.startswith("/api/pyc"):
            return self.pyc_api(method, path, qs, data)

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
            # выйти: вход этого устройства отзывается на сервере (токен, оставшийся в браузере, больше не пустит)
            if self.student(data) and self.sess:
                db.x("UPDATE student_sessions SET ended=? WHERE id=?", (time.time(), self.sess["id"]))
            return self.send_json({"ok": True}, extra={"Set-Cookie": "egest=; Path=/; Max-Age=0" + self.cookie_attrs()})

        if path == "/api/net":
            # школьная ли сеть — окно входа не запоминает ФИО и не даёт браузеру сохранить пароль
            return self.send_json({"shared": shared_ip(db, self.client_ip())})

        if path in ("/api/sessions", "/api/sessions/end"):
            # где выполнен вход: свои устройства; «Выйти на других устройствах» — все, кроме этого
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if path == "/api/sessions/end" and method == "POST":
                keep = self.sess["id"] if self.sess else None
                if data.get("id"):
                    n = db.xn("UPDATE student_sessions SET ended=? WHERE id=? AND student_id=? AND id<>? AND ended IS NULL",
                              (time.time(), to_int(data.get("id")), s["id"], keep or 0))
                else:
                    n = sessions_end(db, s["id"], keep=keep)
                return self.send_json({"ok": True, "ended": n, "sessions": sessions_list(db, s["id"], keep)})
            return self.send_json({"sessions": sessions_list(db, s["id"], self.sess["id"] if self.sess else None)})

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
            ge, gdem = econ(db), gift_demand(db)            # оценка подарков — по нынешним ценам
            return self.send_json({
                "sid": sid, "me": sid == s["id"], "name": short_name(m["name"]) if sid != s["id"] else m["name"],
                "level": g["level"], "title": g["title"], "xp": g["xp"], "fire": g["fire"], "cur": g["cur"], "need": g["need"],
                "league": {"idx": lg, "name": LEAGUES[lg][0], "icon": LEAGUES[lg][1]},
                "awards": awards, "ach": ach, "ach_total": len(ACHIEVEMENTS),
                "extra": [dict(opts[k], k=k) for k in ("fire", "diamond") if k in opts],
                "badges": nick_badges(db, m, game_summary(db, sid, brief=True), lg, daily_crown(db, ids), crowns),
                "gifts": gift_icons(db, sid), "gifts_total": db.q("SELECT COUNT(*) c FROM gifts WHERE student_id=? AND sold IS NULL", (sid,), one=True)["c"],
                "gift_value": gift_value(gift_rows(db, sid, limit=100000, prices=(ge, uniq_issued(db), gdem)), ge, gdem),
                # все подарки — витриной в профиле: сначала уникальные; подпись учителя видит только сам ученик
                "gift_list": sorted(({k: v for k, v in g.items() if sid == s["id"] or k != "note"} for g in gift_rows(db, sid, limit=120)),
                                    key=lambda g: (g["uniq"] is None, -g["ts"])),
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
            # место — по очкам за период: (XP + заработанные ₿) / 2 × доля заданий без ошибок (огонёк — по дням подряд)
            score = lambda p, key: p["rank"][key]["score"] if key in p.get("rank", {}) else p[key]
            order = lambda key: (lambda p: (-score(p, key), -p[key], p["name"]))

            def stat(p, key, place):
                r = {"place": place, "value": score(p, key)}
                if key in p.get("rank", {}):
                    rk = p["rank"][key]
                    r.update(xp=rk["xp"], btc=rk["btc"], acc=rk["acc"], tasks=rk["tasks"], err=rk["err"])
                return r

            pub = lambda p, key, place: dict(stat(p, key, place), sid=p["sid"], name=p["name"], me=p["me"], level=p["level"],
                                             badges=p["badges"], gifts=p.get("gifts", []))
            boards = {}
            for key in ("day", "week", "month", "fire"):
                ranked = sorted((p for p in people if p[key] > 0 or score(p, key) > 0), key=order(key))
                mine = next((stat(p, key, i + 1) for i, p in enumerate(ranked) if p["me"]), None)
                boards[key] = {"top": [pub(p, key, i + 1) for i, p in enumerate(ranked[:10])], "me": mine, "total": len(ranked)}
            # лига: все из моей лиги, по опыту с понедельника
            me = next((p for p in people if p["me"]), dict(my_row, league=0))
            lr = league_row(db, s["id"])
            members = sorted((p for p in people if p["league"] == me["league"]), key=order("wk"))
            n = len(members)
            result = None
            if lr["result"] and lr["result_week"] and lr["week"] == week_key():
                result = {"result": lr["result"], "place": lr["result_place"], "from": lr["result_league"],
                          "week": lr["result_week"]}
            boards["league"] = {
                "idx": me["league"], "name": LEAGUES[me["league"]][0], "icon": LEAGUES[me["league"]][1],
                "top": [pub(p, "wk", i + 1) for i, p in enumerate(members[:LEAGUE_SHOW])],
                "me": next((stat(p, "wk", i + 1) for i, p in enumerate(members) if p["me"]), None),
                "total": n, "up": LEAGUE_UP[me["league"]],
                "down": LEAGUE_DOWN if me["league"] > 0 and n >= league_min_demote(me["league"]) else 0,
                "ends": week_start() + 7 * 86400, "result": result, "week": week_key()}
            # все лиги — посмотреть, кто в других и сколько опыта у лидеров (своя строка «me» — только в своей)
            others = []
            for i, (lname, licon) in enumerate(LEAGUES):
                mem = sorted((p for p in people if p["league"] == i), key=order("wk"))
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

        if path in ("/api/daily", "/api/daily/start"):
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
            if path == "/api/daily/start" and method == "POST":
                # «Решать задание дня»: у каждого своё задание того же типа и сложности, время пошло
                mine_tid = daily_task_for(s["id"], day)
                db.x("INSERT OR IGNORE INTO daily_starts(day, student_id, ts, task_id) VALUES(?,?,?,?)",
                     (day, s["id"], time.time(), mine_tid))
                row = db.q("SELECT ts, task_id FROM daily_starts WHERE day=? AND student_id=?", (day, s["id"]), one=True)
                return self.send_json({"task": APP.bank.pid(row["task_id"] or tid), "started": row["ts"]})
            mates = teacher_students(db, teacher_of(s)["id"])
            names = {m["id"]: short_name(m["name"]) for m in mates}
            ids = list(names)
            rows = db.q(f"SELECT student_id, ms FROM daily_results WHERE day=? AND COALESCE(fast, 0)=0 "
                        f"AND student_id IN ({','.join('?' * len(ids))}) ORDER BY ms, ts", (day, *ids)) if ids else []
            crown = daily_crown(db, ids)
            res = db.q("SELECT ms, fast FROM daily_results WHERE day=? AND student_id=?", (day, s["id"]), one=True)
            mine = res["ms"] if res else None
            started = db.q("SELECT ts, task_id FROM daily_starts WHERE day=? AND student_id=?", (day, s["id"]), one=True)
            t = APP.bank.tasks[tid]
            # какое задание у ученика — только после «Решать»: заранее его не найти и не решить
            return self.send_json({"task": APP.bank.pid(started["task_id"] or tid) if started else None, "ready": True,
                                   "n": t.get("n"), "day": day, "count": len(rows), "fast": bool(res and res["fast"]),
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
            if path == "/api/support/reply" and method == "POST":
                # продолжить переписку по своему обращению; закрытую тему — только новым обращением
                p = db.q("SELECT * FROM support WHERE id=? AND student_id=?", (to_int(data.get("id")), s["id"]), one=True)
                if not p:
                    return self.err(404, "Обращение не найдено")
                if p["status"] == "closed":
                    return self.err(409, "Тема закрыта — если вопрос остался, создай новое обращение")
                text = str(data.get("text") or "").strip()[:SUPPORT_MAX]
                if len(text) < 2 and not data.get("img"):
                    return self.err(400, "Напиши сообщение")
                recent = db.q("""SELECT COUNT(*) AS c FROM support_msgs m JOIN support p ON p.id = m.support_id
                                 WHERE p.student_id=? AND m.who='student' AND m.ts>?""", (s["id"], time.time() - 3600), one=True)["c"]
                if recent >= SUPPORT_PER_HOUR * 4:
                    return self.err(429, "Слишком много сообщений за час — подожди немного")
                try:
                    img = support_img_save(data.get("img"))
                except ValueError as e:
                    return self.err(400, str(e))
                db.x("INSERT INTO support_msgs(support_id, ts, who, text, img) VALUES(?,?,?,?,?)", (p["id"], time.time(), "student", text, img))
                db.x("UPDATE support SET status='new' WHERE id=?", (p["id"],))
                LIVE.send([("t", main_teacher()["id"])], "feed")
                return self.send_json({"ok": True})
            if path == "/api/support/img":
                return self.support_img(qs.get("f"), s["id"])
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
                try:
                    img = support_img_save(data.get("img"))
                except ValueError as e:
                    return self.err(400, str(e))
                # ученик видит задание под открытым кодом — учителю нужен настоящий номер из банка
                task = str(data.get("task") or "")[:60] or None
                if task and APP.bank.ensure():
                    task = APP.bank.real(task) or task
                db.x("INSERT INTO support(student_id, ts, kind, text, task, page, img) VALUES(?,?,?,?,?,?,?)",
                     (s["id"], time.time(), kind, text, task, str(data.get("page") or "")[:120] or None, img))
                LIVE.send([("t", main_teacher()["id"])], "feed")      # главному учителю — сразу
                return self.send_json({"ok": True})
            rows = db.q("SELECT * FROM support WHERE student_id=? ORDER BY id DESC LIMIT 20", (s["id"],))
            return self.send_json({"kinds": SUPPORT_KINDS, "unread": sum(1 for r in rows if not r["seen"]),
                                   "items": [{"id": r["id"], "ts": r["ts"], "kind": r["kind"], "text": r["text"], "task": r["task"],
                                              "status": r["status"], "answer": r["answer"], "answered": r["answered"],
                                              "seen": bool(r["seen"]), "thread": support_thread(db, r)} for r in rows]})

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
            for size, theme in TOUR_KINDS:
                t = db.q("SELECT * FROM tournaments WHERE teacher_id=? AND size=? AND COALESCE(theme, '')=? AND status='reg'",
                         (tid, size, theme), one=True)
                th = TOUR_THEMES.get(theme, {})
                item = {"size": size, "name": tour_kind_name(size, theme), "groups": TOUR_GROUPS[size], "qual": TOUR_QUAL[size],
                        "prizes": TOUR_PRIZES[size], "today": tour_started_today(db, tid, size, theme), "per_day": TOUR_PER_DAY,
                        "theme": theme, "icon": th.get("icon"), "about": th.get("about"), "fixed_nums": th.get("nums"),
                        "cap_min": (th.get("cap") or 0) // 60}
                if t:
                    players = tour_people(db, t["id"])
                    votes = {}
                    for r in db.q("SELECT n, COUNT(*) AS c FROM tour_votes WHERE tour_id=? GROUP BY n", (t["id"],)):
                        votes[r["n"]] = r["c"]
                    my = [r["n"] for r in db.q("SELECT n FROM tour_votes WHERE tour_id=? AND student_id=? ORDER BY n", (t["id"], s["id"]))]
                    item.update(id=t["id"], title=t["title"], players=players, me_in=any(p["sid"] == s["id"] for p in players),
                                votes=votes, my_votes=my)
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
                    db.q("SELECT * FROM tournaments WHERE teacher_id=? AND status='done' ORDER BY finished DESC LIMIT 30", (tid,))]
            wins = db.q("SELECT COUNT(*) AS c FROM awards WHERE student_id=? AND kind='tour1'", (s["id"],), one=True)["c"]
            season_close(db, tid)
            return self.send_json({"lobbies": lobbies, "mine": mine, "done": done, "wins": wins, "tasks": DUEL_TASKS,
                                   "elo": elo_board(db, tid, s["id"]), "season": season_view(db, tid, s["id"]),
                                   "vote_nums": sorted(TOUR_NUMS), "vote_max": TOUR_VOTE_MAX, "noshow_sec": TOUR_NOSHOW_SEC,
                                   "buffer_min": TOUR_BUFFER_SEC // 60, "busy": bool(mine_active)})
        if method != "POST":
            return self.err(405, "нужен POST")
        if path in ("/api/tour/join", "/api/tour/leave", "/api/tour/vote"):
            t = db.q("SELECT * FROM tournaments WHERE id=? AND teacher_id=?", (to_int(data.get("id")), tid), one=True)
            if not t or t["status"] != "reg":
                return self.err(409, "Набор в этот турнир уже закрыт")
            if path == "/api/tour/leave":
                db.x("DELETE FROM tour_players WHERE tour_id=? AND student_id=?", (t["id"], s["id"]))
                db.x("DELETE FROM tour_votes WHERE tour_id=? AND student_id=?", (t["id"], s["id"]))
                return self.send_json({"ok": True})
            if path == "/api/tour/vote":
                # голосование за номера заданий турнира: до TOUR_VOTE_MAX номеров, только у записавшихся
                if t["theme"]:
                    return self.err(409, "В тематическом турнире номера заданий уже заданы")
                if not db.q("SELECT 1 FROM tour_players WHERE tour_id=? AND student_id=?", (t["id"], s["id"]), one=True):
                    return self.err(403, "Голосовать могут только записавшиеся в турнир")
                nums = sorted({n for n in (to_int(x) for x in (data.get("nums") or [])[:30]) if n in TOUR_NUMS})
                if len(nums) > TOUR_VOTE_MAX:
                    return self.err(400, f"Можно выбрать не больше {TOUR_VOTE_MAX} номеров")
                db.x("DELETE FROM tour_votes WHERE tour_id=? AND student_id=?", (t["id"], s["id"]))
                for n in nums:
                    db.x("INSERT INTO tour_votes(tour_id, student_id, n) VALUES(?,?,?)", (t["id"], s["id"], n))
                return self.send_json({"ok": True, "my_votes": nums})
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
            if m["kind"] == "group" and db.q("SELECT 1 FROM tour_players WHERE tour_id=? AND student_id=? AND gone=1",
                                             (m["tour_id"], s["id"]), one=True):
                return self.err(409, "Ты не пришёл к началу турнира — матчи группы засчитаны поражением")
            if not m[side + "_start"]:
                # начатый матч, время которого вышло, считается законченным — не мешает начать следующий
                for x in db.q("""SELECT * FROM tour_matches WHERE id!=? AND status='play' AND
                                 ((a=? AND a_start IS NOT NULL AND a_done IS NULL) OR (b=? AND b_start IS NOT NULL AND b_done IS NULL))""",
                              (m["id"], s["id"], s["id"])):
                    sd = "a" if x["a"] == s["id"] else "b"
                    if time.time() > x[sd + "_start"] + match_cap(db, x, sd):
                        db.x(f"UPDATE tour_matches SET {sd}_done=? WHERE id=?", (x[sd + "_start"] + match_cap(db, x, sd), x["id"]))
                busy = db.q("""SELECT 1 FROM tour_matches WHERE id!=? AND status='play' AND
                               ((a=? AND a_start IS NOT NULL AND a_done IS NULL) OR (b=? AND b_start IS NOT NULL AND b_done IS NULL))""",
                            (m["id"], s["id"], s["id"]), one=True)
                if busy:
                    return self.err(409, "Сначала закончи начатый матч")
                db.x(f"UPDATE tour_matches SET {side}_start=? WHERE id=?", (time.time(), m["id"]))
            return self.send_json({"ok": True, "tasks": [APP.bank.pid(x) for x in side_tasks(m, side)], "ends": m["ends"],
                                   "cap": match_cap(db, m, side)})
        if path == "/api/tour/surrender":
            # сдаться в матче: матч сразу проигран, сопернику — победа
            if m["status"] != "play":
                return self.err(409, "Матч уже закончен")
            now = time.time()
            db.x(f"UPDATE tour_matches SET surrender=?, {side}_done=COALESCE({side}_done, ?) WHERE id=? AND surrender IS NULL",
                 (s["id"], now, m["id"]))
            seeds = {r["student_id"]: r["seed"] for r in db.q("SELECT student_id, seed FROM tour_players WHERE tour_id=?", (m["tour_id"],))}
            tour_settle(db, db.q("SELECT * FROM tour_matches WHERE id=?", (m["id"],), one=True), seeds, now)
            tour_tick(db, db.q("SELECT * FROM tournaments WHERE id=?", (m["tour_id"],), one=True))
            return self.send_json({"ok": True})
        if path == "/api/tour/finish":
            if m["status"] == "play" and m[side + "_start"] and not m[side + "_done"]:
                db.x(f"UPDATE tour_matches SET {side}_done=? WHERE id=?", (time.time(), m["id"]))
                tour_tick(db, db.q("SELECT * FROM tournaments WHERE id=?", (m["tour_id"],), one=True))
            return self.send_json({"ok": True})
        return self.err(404, "нет такого метода")

    def api_duels(self, s, path, method, data):
        db = APP.db
        tid = teacher_of(s)["id"]
        mates = {m["id"]: m for m in teacher_students(db, tid) if m["id"] != s["id"]}
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
                        "ends": (d["accepted"] or d["created"]) + DUEL_HOURS * 3600, "quick": bool(d["quick"])}
                if d["status"] == "active" and d[me + "_start"]:
                    item["tasks"] = [APP.bank.pid(x) for x in side_tasks(d, me)]
                    item["since"] = d[me + "_start"]
                    item["cap"] = duel_cap(side_tasks(d, me))
                item["rematch"] = bool(d["rematch_of"])
                item["surrender"] = None if not d["surrender"] else ("me" if d["surrender"] == s["id"] else "op")
                if d["status"] == "finished":
                    item.update(my_solved=d[me + "_solved"], op_solved=d[op + "_solved"], stake=d["stake"] or 0,
                                result="draw" if not d["winner"] else ("win" if d["winner"] == s["id"] else "lose"),
                                elo=round(d[me + "_elo"]) if d[me + "_elo"] is not None else None,
                                bonus=(d["bonus"] or 0) if d["winner"] == s["id"] else 0)
                    item["can_rematch"] = (d["winner"] is not None and d["winner"] != s["id"] and time.time() - (d["finished"] or 0) < 86400
                                           and not db.q("SELECT 1 FROM duels WHERE rematch_of=?", (d["id"],), one=True))
                out.append(item)
            lv = lambda sid: game_summary(db, sid, brief=True)["level"]
            q = db.q("SELECT since FROM duel_queue WHERE student_id=? AND seen>?", (s["id"], time.time() - DUEL_QUEUE_TTL), one=True)
            return self.send_json({"duels": out, "searching": bool(q), "search_since": q["since"] if q else None,
                                   "today": duels_today(db, s["id"]), "per_day": DUEL_PER_DAY,
                                   "full_per_day": DUEL_FULL_PER_DAY, "stake_late": DUEL_STAKE_LATE,
                                   "duel_nums": DUEL_NUMS, "min_nums": DUEL_MIN_NUMS,
                                   "my_elo": round(elo_of(db, s["id"])), "streak": duel_streak(db, s["id"]),
                                   "seekers": duel_seekers(db, tid, s["id"]), "stake": DUEL_STAKE, "tasks": DUEL_TASKS, "hours": DUEL_HOURS,
                                   "tournament": tournament_table(db, s, mates),
                                   "mates": sorted(({"sid": m["id"], "name": short_name(m["name"]), "level": lv(m["id"])}
                                                    for m in mates.values()), key=lambda x: x["name"])})
        if method != "POST":
            return self.err(405, "нужен POST")
        if path == "/api/duel/cancel":
            db.x("DELETE FROM duel_queue WHERE student_id=?", (s["id"],))
            return self.send_json({"ok": True})
        if path == "/api/duel/find":
            # подбор соперника: кто ищет одновременно (страница опрашивает раз в несколько секунд), ближайший по уровню
            if s["is_teacher"]:
                return self.err(403, "Учитель в дуэлях не участвует")
            raw = data.get("nums")
            my_nums = sorted({n for n in (to_int(x) for x in (raw or DUEL_NUMS)[:40]) if n in DUEL_NUMS})
            if len(my_nums) < DUEL_MIN_NUMS:
                return self.err(400, f"Выбери хотя бы {DUEL_MIN_NUMS} номера заданий")
            now = time.time()
            with _COMP_LOCK:
                # пока ждали, нас подобрал другой ищущий — дуэль уже создана
                hit = db.q("""SELECT id FROM duels WHERE status='active' AND a=? AND quick=1 AND accepted>=?
                              ORDER BY id DESC LIMIT 1""", (s["id"], now - DUEL_QUEUE_TTL * 2), one=True)
                if hit and not db.q("SELECT 1 FROM duel_queue WHERE student_id=?", (s["id"],), one=True):
                    return self.send_json({"matched": hit["id"]})
                if db.q("SELECT COUNT(*) AS c FROM duels WHERE status IN ('pending','active') AND (a=? OR b=?)",
                        (s["id"], s["id"]), one=True)["c"] >= DUEL_MAX_OPEN:
                    db.x("DELETE FROM duel_queue WHERE student_id=?", (s["id"],))
                    return self.err(429, f"Не больше {DUEL_MAX_OPEN} дуэлей одновременно — закончи начатые")
                if duels_today(db, s["id"]) >= DUEL_PER_DAY:
                    db.x("DELETE FROM duel_queue WHERE student_id=?", (s["id"],))
                    return self.err(429, f"Сегодня уже {DUEL_PER_DAY} дуэлей — это максимум. Новые — завтра!")
                me_lv = game_summary(db, s["id"], brief=True)["level"]
                me_elo = elo_of(db, s["id"])
                db.x("DELETE FROM duel_queue WHERE seen<?", (now - DUEL_QUEUE_TTL,))
                busy = {r["x"] for r in db.q("""SELECT CASE WHEN a=? THEN b ELSE a END AS x FROM duels
                                                WHERE (a=? OR b=?) AND (status IN ('pending','active')
                                                     OR (status='finished' AND finished>=?))""",
                                             (s["id"], s["id"], s["id"], week_start()))}
                common = lambda r: set(my_nums) & set(json.loads(r["nums"]) if r["nums"] else DUEL_NUMS)
                cands = [r for r in db.q("SELECT * FROM duel_queue WHERE teacher_id=? AND student_id!=? ORDER BY since",
                                         (tid, s["id"])) if r["student_id"] in mates and r["student_id"] not in busy
                         and len(common(r)) >= DUEL_MIN_NUMS]
                if cands:
                    op = min(cands, key=lambda r: (abs((r["elo"] if r["elo"] is not None else ELO_START) - me_elo), r["since"]))
                    tasks = duel_tasks(common(op))                # только номера, которые выбрали оба
                    if not tasks:
                        return self.err(503, "нет подходящих заданий")
                    db.x("DELETE FROM duel_queue WHERE student_id IN (?,?)", (s["id"], op["student_id"]))
                    did = db.x("""INSERT INTO duels(a, b, tasks, tasks_b, created, status, accepted, quick)
                                  VALUES(?,?,?,?,?, 'active', ?, 1)""",
                               (op["student_id"], s["id"], json.dumps(tasks), json.dumps(twin_tasks(tasks)), now, now))
                    return self.send_json({"matched": did})
                db.x("""INSERT INTO duel_queue(student_id, teacher_id, level, since, seen, elo, nums) VALUES(?,?,?,?,?,?,?)
                        ON CONFLICT(student_id) DO UPDATE SET seen=excluded.seen, level=excluded.level, elo=excluded.elo,
                        nums=excluded.nums""", (s["id"], tid, me_lv, now, now, me_elo, json.dumps(my_nums)))
            q = db.q("SELECT since FROM duel_queue WHERE student_id=?", (s["id"],), one=True)
            return self.send_json({"searching": True, "since": q["since"], "seekers": duel_seekers(db, tid, s["id"])})
        if path == "/api/duel/create":
            return self.err(410, "Вызов на дуэль убран — нажми «Найти соперника»")
        if path == "/api/duel/rematch":
            # реванш: проигравший зовёт победителя ещё раз (сверх правила «одна дуэль с соперником в неделю»)
            d = db.q("SELECT * FROM duels WHERE id=? AND (a=? OR b=?)", (to_int(data.get("id")), s["id"], s["id"]), one=True)
            if not d or d["status"] != "finished" or not d["winner"] or d["winner"] == s["id"]:
                return self.err(409, "Реванш можно попросить только после проигранной дуэли")
            if time.time() - (d["finished"] or 0) > 86400:
                return self.err(409, "Реванш можно попросить в течение суток после дуэли")
            if db.q("SELECT 1 FROM duels WHERE rematch_of=?", (d["id"],), one=True):
                return self.err(409, "Реванш за эту дуэль уже был")
            if duels_today(db, s["id"]) >= DUEL_PER_DAY:
                return self.err(429, f"Сегодня уже {DUEL_PER_DAY} дуэлей — это максимум. Новые — завтра!")
            op = d["winner"]
            tasks = duel_tasks({APP.bank.tasks[x]["n"] for x in json.loads(d["tasks"] or "[]") if x in APP.bank.tasks})
            did = db.x("""INSERT INTO duels(a, b, tasks, tasks_b, created, status, rematch_of) VALUES(?,?,?,?,?, 'pending', ?)""",
                       (s["id"], op, json.dumps(tasks), json.dumps(twin_tasks(tasks)), time.time(), d["id"]))
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
            d = db.q("SELECT * FROM duels WHERE id=?", (d["id"],), one=True)
            return self.send_json({"ok": True, "tasks": [APP.bank.pid(x) for x in side_tasks(d, me)],
                                   "since": d[me + "_start"], "cap": duel_cap(side_tasks(d, me))})
        if path == "/api/duel/surrender":
            # сдаться: дуэль сразу проиграна, сопернику — победа (вызов, который ещё не принят, просто отклоняется)
            if d["status"] == "pending":
                db.x("UPDATE duels SET status='declined', finished=? WHERE id=?", (time.time(), d["id"]))
                return self.send_json({"ok": True})
            if d["status"] != "active":
                return self.err(409, "Дуэль уже закончена")
            db.x(f"UPDATE duels SET surrender=?, {me}_done=COALESCE({me}_done, ?) WHERE id=? AND surrender IS NULL",
                 (s["id"], time.time(), d["id"]))
            duel_settle(db, db.q("SELECT * FROM duels WHERE id=?", (d["id"],), one=True))
            return self.send_json({"ok": True})
        if path == "/api/duel/finish":
            if d["status"] == "active" and d[me + "_start"] and not d[me + "_done"]:
                db.x(f"UPDATE duels SET {me}_done=? WHERE id=?", (time.time(), d["id"]))
                duel_settle(db, db.q("SELECT * FROM duels WHERE id=?", (d["id"],), one=True))
            return self.send_json({"ok": True})
        return self.err(404, "нет такого метода")

    def api_open(self, s, t):
        """Ученик открыл задание: с этого момента идёт время на раздумье.
        Открыл заново, не закончив после неверной попытки, — попытки не обнуляются: ученик продолжает
        с того же места (в подборке можно уйти к другому заданию и вернуться). Новых попыток так не получить."""
        ids = [p["id"] for p in t["parts"]] if t.get("parts") else [t["id"]]
        used = {}
        for tid in ids:
            st = OPENED.get(s["id"], tid, create=False)
            if st and st["final"] is None and st["tries"]:
                used[APP.bank.pid(tid)] = len(st["tries"])      # уже была неверная попытка — продолжаем с неё
            elif st is None or st["final"] is not None:
                OPENED.reset(s["id"], tid)
            # открыто и ещё без ответа (например, перезагрузили страницу) — время открытия не сбрасываем
        st = OPENED.get(s["id"], ids[0])
        return self.send_json({"ok": True, "think": think_sec(t.get("n")), "tries": used,
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
                daily_fast = score == 1.0 and is_daily_of(s["id"], t["id"]) and self.daily_result(s, t, st)
                self.log_attempt(s, t, st["tries"], score, reason=st["reason"], rk=st["rk"], part=st["part"],
                                 revealed=1, spent=spent, away=st["away"], st=st)
                st["final"] = self.with_answer_s(s, {"correct": True, "final": True, "score": score, "part": st["part"],
                                                     "fast": spent is not None and spent < answer_min_ms(n, time.time()),
                                                     "fast_min": answer_min_ms(n, time.time()) // 60000,
                                                     "nocount": last_attempt_skipped(APP.db, s["id"])}, t)
                if daily_fast:
                    st["final"]["daily_fast"] = True
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
                live_teacher(s)
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
                    live_teacher(s)
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
            live_teacher(s)                      # «● Онлайн» у учителя: сдано на одно задание больше
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
        live_teacher(s)
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

        if path == "/api/admin/competitions":
            # разыгранные турниры и дуэли учеников этого учителя — архив списком
            names = {m["id"]: m["name"] for m in teacher_students(db, self.T["id"])}
            stage = {"group": "Группа", "po": "Плей-офф", "final": "Финал", "third": "Матч за 3-е место"}
            tours = []
            for t in db.q("""SELECT * FROM tournaments WHERE teacher_id=? AND status IN ('run','done')
                             ORDER BY COALESCE(finished, started) DESC LIMIT 100""", (self.T["id"],)):
                players = [{"sid": r["student_id"], "name": names.get(r["student_id"], "?"), "place": r["place"], "xp": r["xp"] or 0,
                            "grp": r["grp"]}
                           for r in db.q("SELECT * FROM tour_players WHERE tour_id=? ORDER BY COALESCE(place, 99), seed", (t["id"],))]
                matches = []
                for m in db.q("SELECT * FROM tour_matches WHERE tour_id=? ORDER BY round, slot", (t["id"],)):
                    po = {2: "Полуфинал", 4: "Четвертьфинал"}.get(len([x for x in db.q(
                        "SELECT 1 FROM tour_matches WHERE tour_id=? AND round=? AND kind='po'", (t["id"], m["round"]))]) * 2)
                    matches.append({"id": m["id"], "cur": m["round"] == t["round"] and t["status"] == "run",
                                    "sus_a": comp_flags(db, m, "a"), "sus_b": comp_flags(db, m, "b"), "admin": m["admin"],
                                    "stage": (f"Группа {m['grp']}" if m["kind"] == "group" else po if m["kind"] == "po" else stage.get(m["kind"], "")),
                                    "a": names.get(m["a"], "?"), "b": names.get(m["b"], "?"), "a_solved": m["a_solved"],
                                    "b_solved": m["b_solved"], "winner": names.get(m["winner"]) if m["winner"] else None,
                                    "tech": bool(m["tech"]), "status": m["status"]})
                tours.append({"id": t["id"], "title": t["title"], "size": t["size"], "status": t["status"], "started": t["started"],
                              "theme": t["theme"] or "",
                              "finished": t["finished"], "nums": json.loads(t["nums"]) if t["nums"] else None,
                              "players": players, "matches": matches})
            duels = []
            ids = list(names)
            if ids:
                ph = ",".join("?" * len(ids))
                for d in db.q(f"""SELECT * FROM duels WHERE status IN ('finished','active','void') AND (a IN ({ph}) OR b IN ({ph}))
                                  ORDER BY COALESCE(finished, accepted, created) DESC LIMIT 500""", (*ids, *ids)):
                    duels.append({"id": d["id"], "status": d["status"], "ts": d["finished"] or d["accepted"] or d["created"],
                                  "a": names.get(d["a"], "?"), "b": names.get(d["b"], "?"), "a_solved": d["a_solved"],
                                  "b_solved": d["b_solved"], "winner": names.get(d["winner"]) if d["winner"] else None,
                                  "stake": d["stake"] or 0, "quick": bool(d["quick"]), "rematch": bool(d["rematch_of"]),
                                  "a_elo": d["a_elo"], "b_elo": d["b_elo"], "sus_a": comp_flags(db, d, "a"), "sus_b": comp_flags(db, d, "b")})
            return self.send_json({"tournaments": tours, "duels": duels})

        if path == "/api/admin/tour/match" and method == "POST":
            # ручное управление матчем текущей стадии: победа одному (тех.), переиграть заново
            m = db.q("""SELECT m.* FROM tour_matches m JOIN tournaments t ON t.id=m.tour_id
                        WHERE m.id=? AND t.teacher_id=? AND t.status='run' AND m.round=t.round""",
                     (to_int(data.get("id")), self.T["id"]), one=True)
            if not m:
                return self.err(404, "Матч не найден или его стадия уже закончилась")
            act = str(data.get("action") or "")
            if act in ("a", "b"):
                db.x("""UPDATE tour_matches SET status='done', winner=?, tech=1, a_solved=COALESCE(a_solved, 0),
                        b_solved=COALESCE(b_solved, 0), admin=? WHERE id=?""", (m[act], f"победа {act} (учитель)", m["id"]))
            elif act == "replay":
                t = db.q("SELECT * FROM tournaments WHERE id=?", (m["tour_id"],), one=True)
                tasks, tasks_b = tour_new_tasks(db, t, m["round"])
                ends = max(m["ends"] or 0, time.time() + tour_match_sec(t, json.loads(t["nums"] or "[]")) + TOUR_BUFFER_SEC)
                db.x("""UPDATE tour_matches SET status='play', a_start=NULL, b_start=NULL, a_done=NULL, b_done=NULL, a_solved=NULL,
                        b_solved=NULL, a_sec=NULL, b_sec=NULL, winner=NULL, tech=0, tasks=?, tasks_b=?, ends=?, admin='переигровка'
                        WHERE id=?""", (json.dumps(tasks), json.dumps(tasks_b), ends, m["id"]))
                db.x("UPDATE tournaments SET round_ends=MAX(COALESCE(round_ends, 0), ?) WHERE id=?", (ends, t["id"]))
            else:
                return self.err(400, "неизвестное действие")
            tour_tick(db, db.q("SELECT * FROM tournaments WHERE id=?", (m["tour_id"],), one=True))
            return self.send_json({"ok": True})

        if path == "/api/admin/tour/restart" and method == "POST":
            # перезапуск: турнир отменяется, те же игроки (и голоса) — в новом, он сразу стартует заново
            t = db.q("SELECT * FROM tournaments WHERE id=? AND teacher_id=? AND status IN ('reg','run')",
                     (to_int(data.get("id")), self.T["id"]), one=True)
            if not t:
                return self.err(404, "Турнир не найден или уже завершён")
            db.x("UPDATE tournaments SET status='void', finished=? WHERE id=?", (time.time(), t["id"]))
            db.x("DELETE FROM tournaments WHERE teacher_id=? AND size=? AND COALESCE(theme, '')=? AND status='reg' AND id!=?",
                 (self.T["id"], t["size"], t["theme"] or "", t["id"]))   # пустой набор того же вида уступает место
            nid = db.x("INSERT INTO tournaments(teacher_id, size, title, status, created, fmt, theme) VALUES(?,?,?,'reg',?,?,?)",
                       (self.T["id"], t["size"], t["title"], time.time(), TOUR_FMT, t["theme"]))
            for r in db.q("SELECT student_id, joined FROM tour_players WHERE tour_id=?", (t["id"],)):
                db.x("INSERT INTO tour_players(tour_id, student_id, joined) VALUES(?,?,?)", (nid, r["student_id"], r["joined"]))
            for r in db.q("SELECT student_id, n FROM tour_votes WHERE tour_id=?", (t["id"],)):
                db.x("INSERT OR IGNORE INTO tour_votes(tour_id, student_id, n) VALUES(?,?,?)", (nid, r["student_id"], r["n"]))
            tour_tick(db, db.q("SELECT * FROM tournaments WHERE id=?", (nid,), one=True))
            return self.send_json({"ok": True, "id": nid})

        if path == "/api/admin/duel/cancel" and method == "POST":
            # отмена дуэли: опыт (ставка, бонус серии) и рейтинг Эло возвращаются как было
            names = {m["id"] for m in teacher_students(db, self.T["id"])}
            d = db.q("SELECT * FROM duels WHERE id=?", (to_int(data.get("id")),), one=True)
            if not d or (d["a"] not in names and d["b"] not in names) or d["status"] == "void":
                return self.err(404, "Дуэль не найдена")
            db.x("DELETE FROM xp_adjust WHERE reason IN (?, ?)", (f"duel:{d['id']}", f"streak:{d['id']}"))
            for side in ("a", "b"):
                if d[side + "_elo"] is not None:
                    db.x("UPDATE duel_elo SET elo=elo-?, games=MAX(games-1, 0) WHERE student_id=?", (d[side + "_elo"], d[side]))
            db.x("UPDATE duels SET status='void', finished=?, a_elo=NULL, b_elo=NULL, bonus=0, stake=0 WHERE id=?", (time.time(), d["id"]))
            return self.send_json({"ok": True})

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
            voids = [dict(r) for r in db.q("""SELECT batch, MIN(void_ts) AS ts, COUNT(*) AS n, MIN(t_from) AS t_from, MAX(t_to) AS t_to
                                               FROM attempts_void WHERE student_id=? GROUP BY batch ORDER BY ts DESC LIMIT 20""", (sid,))]
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
                                   "exams": [exam_brief(r) for r in exams], "same_ip": same_ip, "sessions": sessions_list(db, sid),
                                   "voids": voids,
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
            if self.T["is_main"]:
                # обращения в техподдержку — главному учителю
                for t in db.q("""SELECT x.id, x.ts, x.kind, x.text, x.student_id, s.name FROM support x
                                 JOIN students s ON s.id = x.student_id WHERE x.ts > ? ORDER BY x.ts DESC LIMIT 50""", (since,)):
                    events.append({"ts": t["ts"], "kind": "support", "student_id": t["student_id"], "name": t["name"],
                                   "title": SUPPORT_KINDS.get(t["kind"], "Обращение"), "info": (t["text"] or "")[:160]})
                for t in db.q("""SELECT m.ts, m.text, p.kind, p.student_id, s.name FROM support_msgs m JOIN support p ON p.id = m.support_id
                                 JOIN students s ON s.id = p.student_id WHERE m.who='student' AND m.ts > ? ORDER BY m.ts DESC LIMIT 50""", (since,)):
                    events.append({"ts": t["ts"], "kind": "support", "student_id": t["student_id"], "name": t["name"],
                                   "title": "ответ в обращении", "info": (t["text"] or "")[:160]})
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
            t = APP.bank.tasks.get(APP.bank.real(qs.get("id")) or "")      # и открытый код из обращения ученика
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
            db.x("UPDATE students SET pw=NULL WHERE id=?", (sid,))
            sessions_end(db, sid)
            return self.send_json({"ok": True})

        if path in ("/api/admin/student/void", "/api/admin/student/void-undo") and method == "POST":
            # отменить ответы ученика за промежуток (в аккаунт зашёл кто-то другой): предпросмотр, затем — в корзину attempts_void;
            # опыт, биткоины за труд, точность, огонёк, прогноз и рейтинги пересчитываются сами — они считаются по журналу ответов
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if path == "/api/admin/student/void-undo":
                rows = db.q("SELECT * FROM attempts_void WHERE student_id=? AND batch=?", (sid, str(data.get("batch") or "")))
                if not rows:
                    return self.err(404, "Эта отмена уже возвращена")
                cols = {r[1] for r in db.q("PRAGMA table_info(attempts)")}
                for r in rows:
                    a = {k: v for k, v in json.loads(r["row"]).items() if k in cols}
                    db.x(f"INSERT OR IGNORE INTO attempts({','.join(a)}) VALUES({','.join('?' * len(a))})", tuple(a.values()))
                db.x("DELETE FROM attempts_void WHERE student_id=? AND batch=?", (sid, rows[0]["batch"]))
                attempts_changed(sid)
                return self.send_json({"ok": True, "restored": len(rows)})
            t_from, t_to = to_float(data.get("from")), to_float(data.get("to"))
            if not t_from or not t_to or t_to <= t_from or t_to - t_from > 7 * 86400:
                return self.err(400, "Укажите промежуток — не длиннее недели")
            att = db.q("SELECT * FROM attempts WHERE student_id=? AND ts>=? AND ts<=? ORDER BY ts", (sid, t_from, t_to))
            if data.get("preview"):
                APP.bank.ensure()
                coins = db.q("SELECT COUNT(*) c FROM coins WHERE student_id=? AND ts>=? AND ts<=? AND reason IN ('gift','upgrade','sell','mbuy')",
                             (sid, t_from, t_to), one=True)["c"]
                return self.send_json({"n": len(att), "ok": sum(1 for a in att if (a["score"] or 0) >= 1),
                                       "bad": sum(1 for a in att if (a["score"] or 0) <= 0), "exam": sum(1 for a in att if a["exam"]),
                                       "nums": sorted({a["n"] for a in att if a["n"]}), "gift_ops": coins,
                                       "list": [{"ts": a["ts"], "n": a["n"], "score": a["score"], "exam": bool(a["exam"]),
                                                 "answer": (json.loads(a["answers"] or "[]") or [""])[-1] if a["answers"] else ""}
                                                for a in att[:60]]})
            if not att:
                return self.err(400, "За этот промежуток ответов нет")
            batch, now = secrets.token_hex(6), time.time()
            for a in att:
                db.x("INSERT INTO attempts_void(batch, student_id, ts, row, void_ts, teacher_id, t_from, t_to) VALUES(?,?,?,?,?,?,?,?)",
                     (batch, sid, a["ts"], json.dumps(dict(a), ensure_ascii=False), now, self.T["id"], t_from, t_to))
            db.x(f"DELETE FROM attempts WHERE id IN ({','.join('?' * len(att))})", tuple(a["id"] for a in att))
            attempts_changed(sid)
            return self.send_json({"ok": True, "voided": len(att), "batch": batch})

        if path == "/api/admin/student/logout" and method == "POST":
            # выйти у ученика на всех устройствах (например, вошёл на чужом компьютере)
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            return self.send_json({"ok": True, "ended": sessions_end(db, sid)})

        if path == "/api/admin/logout-here" and method == "POST":
            # конец урока: выйти всем вашим ученикам на компьютерах этой сети (адрес — как у учителя сейчас)
            ip = self.client_ip()
            where, args = self.student_scope()
            sids = [r["id"] for r in db.q(f"SELECT s.id FROM students s WHERE {where}", args)]
            n = 0
            for i in range(0, len(sids), 500):
                part = sids[i:i + 500]
                n += db.xn(f"""UPDATE student_sessions SET ended=? WHERE ip=? AND ended IS NULL
                                AND student_id IN ({','.join('?' * len(part))})""", (time.time(), ip, *part))
                # прежний общий токен у тех, кто заходил с этого адреса, — тоже
                db.x(f"UPDATE students SET token=lower(hex(randomblob(18))) WHERE last_ip=? AND id IN ({','.join('?' * len(part))})", (ip, *part))
            LIVE.send(sids, "logout")
            return self.send_json({"ok": True, "ended": n, "ip": ip})

        if path == "/api/admin/student/role" and method == "POST":
            # плашка 👑 admin рядом с именем ученика — выдаёт и снимает только главный учитель
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            db.x("UPDATE students SET role=? WHERE id=?", ("admin" if data.get("admin") else None, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/fire" and method == "POST":
            # восстановить огонёк ученику (например, после сбоя сервера): серия станет не меньше days
            sid = to_int(data.get("id"))
            days = to_int(data.get("days"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            if not days or not 1 <= days <= 365:
                return self.err(400, "Сколько дней огонька — от 1 до 365")
            added, fire = restore_fire(db, sid, days)
            return self.send_json({"ok": True, "added": added, "fire": fire})

        if path == "/api/admin/student/delete" and method == "POST":
            sid = to_int(data.get("id"))
            if not self.sees_student(sid):
                return self.err(404, "ученик не найден")
            # удаление учётной записи стирает все данные ученика (152-ФЗ); в чужих турнирах и дуэлях
            # остаются только счёт и номер без имени — соперникам не ломаем таблицы
            for table in ("attempts", "reveal_log", "exams", "activity", "solutions", "daily_starts", "daily_results",
                          "asg_runs", "asg_events", "leagues", "course_seen", "awards", "support", "xp_adjust", "fire_cover", "tour_votes", "duel_queue"):
                db.x(f"DELETE FROM {table} WHERE student_id=?", (sid,))
            db.x("DELETE FROM support_msgs WHERE support_id NOT IN (SELECT id FROM support)")    # переписка и картинки техподдержки
            support_img_cleanup(db)
            for aid in [r["id"] for r in db.q("SELECT id FROM assignments WHERE student_id=?", (sid,))]:
                db.x("DELETE FROM asg_runs WHERE asg_id=?", (aid,))
                db.x("DELETE FROM asg_events WHERE asg_id=?", (aid,))
            db.x("DELETE FROM assignments WHERE student_id=?", (sid,))
            db.x("DELETE FROM duels WHERE (a=? OR b=?) AND status IN ('pending','active')", (sid, sid))
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

        if path == "/api/admin/pyc":
            # прогресс курса программирования (как «Прогресс курса»): ученики этого учителя, вошедшие по паролю, —
            # когда вошли, сколько решили по каждой теме, сколько задач с ошибкой
            where, args = self.student_scope()
            rows = db.q(f"""SELECT s.id, s.name, s.pyc_ts, COALESCE(s.pyc_free, 0) AS free, c.name AS cls
                            FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.pyc = 1 AND {where} ORDER BY s.name""", args)
            mods = pyc_index()
            owner = {t: m["id"] for m in mods for lv in m["levels"] for t in lv["tasks"]}
            stats = {}
            for r in db.q("""SELECT p.student_id, p.task_id, p.ok, p.tries, p.last_ts FROM pyc_progress p
                             JOIN students s ON s.id = p.student_id WHERE s.pyc = 1 AND """ + where, args):
                if r["task_id"] not in owner:
                    continue                     # задачу убрали из курса — в прогрессе не считаем
                st = stats.setdefault(r["student_id"], {"done": 0, "last": None, "mods": {}})
                st["last"] = max(st["last"] or 0, r["last_ts"] or 0) or None
                m = st["mods"].setdefault(owner[r["task_id"]], {"done": 0, "bad": 0})
                if r["ok"]:
                    st["done"] += 1
                    m["done"] += 1
                elif r["tries"]:
                    m["bad"] += 1                # пробовал, но пока не решил
            out = []
            for r in rows:
                st = stats.get(r["id"], {})
                out.append({"id": r["id"], "name": r["name"], "class": r["cls"], "since": r["pyc_ts"], "free": bool(r["free"]),
                            "done": st.get("done", 0), "last": st.get("last"), "mods": st.get("mods", {})})
            return self.send_json({"modules": [{"id": m["id"], "n": m["n"], "title": m["title"], "icon": m["icon"],
                                                "tasks": sum(len(lv["tasks"]) for lv in m["levels"]),
                                                "levels": [{"title": lv["title"], "tasks": len(lv["tasks"])} for lv in m["levels"]]}
                                               for m in mods],
                                   "students": out, "pw_set": bool(db.setting("pyc_pw"))})

        if path == "/api/admin/gifts":
            # подарки и биткоины: каталог, кому можно подарить (ученики этого учителя и классы), что дарили недавно
            where, args = self.student_scope()
            studs = db.q(f"""SELECT s.id, s.name, s.class_id, c.name AS cls FROM students s LEFT JOIN classes c ON c.id = s.class_id
                             WHERE {where} ORDER BY s.name""", args)
            cls = db.q("SELECT id, name FROM classes WHERE COALESCE(teacher_id, ?) = ? ORDER BY name", (main_teacher()["id"], self.T["id"]))
            recent = db.q(f"""SELECT g.gift, g.ts, g.note, g.uniq, s.name FROM gifts g JOIN students s ON s.id = g.student_id
                              WHERE g.from_teacher = ? AND {where} ORDER BY g.ts DESC LIMIT 60""", (self.T["id"],) + args)
            issued = uniq_issued(db)
            return self.send_json({
                "catalog": [{"id": k, "i": i, "t": t, "price": pr, "issued": issued.get(k, 0)} for k, i, t, pr in GIFTS],
                "coin_xp": btc_rate_now(db)[0], "econ": econ(db, fresh=True), "cap": UNIQ_CAP, "work_every": WORK_GIFT_EVERY,
                "box": {"set": to_int(db.setting("gift_box_price")) or None, "now": gift_box_price(db, econ(db)), "default": GIFT_BOX_PRICE,
                        "value": gift_box_value(), "min": GIFT_BOX_MIN, "max": GIFT_BOX_MAX},
                "is_main": bool(self.T["is_main"]), "exam_btc": EXAM_BTC,
                "uniq_total": sum(issued.values()),
                "students": [{"id": r["id"], "name": r["name"], "class_id": r["class_id"], "class": r["cls"]} for r in studs],
                "classes": [{"id": c["id"], "name": c["name"]} for c in cls],
                "recent": [{"i": GIFT_BY[r["gift"]][1], "t": GIFT_BY[r["gift"]][2], "ts": r["ts"], "note": r["note"] or "",
                            "uniq": uniq_pub(r["uniq"]) if r["uniq"] else None, "name": r["name"]} for r in recent if r["gift"] in GIFT_BY]})

        if path == "/api/admin/gifts/student":
            # подарки ученика — чтобы удалить лишние из его профиля
            where, args = self.student_scope()
            sid = to_int(qs.get("id"))
            st = db.q(f"SELECT s.id, s.name FROM students s WHERE s.id=? AND {where}", (sid,) + args, one=True)
            if not st:
                return self.err(404, "нет такого ученика")
            return self.send_json({"id": st["id"], "name": st["name"], "gifts": gift_rows(db, sid),
                                   "wallet": econ_wallet(db, sid), "feed": econ_feed(db, where, args, sid=sid, limit=100)})

        if path == "/api/admin/econ":
            # экономика учеников этого учителя: откуда пришли биткоины и куда ушли, кошельки, подарки по редкости, журнал
            where, args = self.student_scope()
            studs = db.q(f"SELECT s.id, s.name, c.name AS cls FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE {where}", args)
            wallets = [dict(econ_wallet(db, r["id"]), id=r["id"], name=r["name"], cls=r["cls"]) for r in studs]
            keys = ("balance", "mined", "exam", "task", "grant", "sell", "mkt_in", "mkt_out", "take", "gift", "upgrade", "fines",
                    "stipend", "storage")
            tot = {k: sum(w[k] for w in wallets) for k in keys}
            week = {r["reason"]: r["s"] for r in db.q(f"""SELECT c.reason, SUM(c.delta) s FROM coins c JOIN students s ON s.id = c.student_id
                                                         WHERE c.ts > ? AND {where} GROUP BY c.reason""", (time.time() - 7 * 86400,) + args)}
            tiers = {}
            for r in db.q(f"""SELECT g.gift, g.uniq FROM gifts g JOIN students s ON s.id = g.student_id
                              WHERE g.sold IS NULL AND {where}""", args):
                if r["gift"] not in GIFT_BY:
                    continue
                u = uniq_pub(r["uniq"]) if r["uniq"] else None
                k = ("u:" + u["rar"]["k"]) if u else gift_rarity(r["gift"])["k"]
                tiers[k] = tiers.get(k, 0) + 1
            rich = sorted((w for w in wallets if w["balance"] > 0), key=lambda w: -w["balance"])[:10]
            return self.send_json({"econ": econ(db), "students": len(wallets), "with_coins": sum(1 for w in wallets if w["balance"] > 0),
                                   "total": tot, "week": week, "tiers": tiers, "rich": rich,
                                   "charts": econ_charts(db, [r["id"] for r in studs], where, args, tot["balance"]),
                                   "rarity": {"plain": [[k, t] for _, k, t in RARITY] + [["limited", "Лимитка"]], "uniq": [[k, t] for _, k, t in UNIQ_RARITY]},
                                   "feed": econ_feed(db, where, args, limit=150),
                                   "rate": btc_rate_now(db)[0], "site": econ_site(db) if self.T["is_main"] else None,
                                   "thermo": thermo_info(db, self.T), "market": market_hist(db)})

        if path == "/api/admin/promo" and method == "POST":
            # акция: биткоины за задания и варианты в N раз больше до дня to включительно — главный учитель; stop — закончить
            if not self.T["is_main"]:
                return self.err(403, "Акции запускает главный учитель")
            now, P = time.time(), promo_get(db)
            if data.get("stop"):
                if P and P["to"] > now:
                    promo_set(db, dict(P, to=now))
            else:
                try:
                    task, exam = float(data.get("task") or 1), float(data.get("exam") or 1)
                    to = day_end(str(data.get("to") or ""))
                except ValueError:
                    return self.err(400, "Нужны множители и день окончания (ГГГГ-ММ-ДД)")
                if not (1 <= task <= PROMO_MAX and 1 <= exam <= PROMO_MAX) or task == exam == 1:
                    return self.err(400, f"Множители — от 1 до {PROMO_MAX:g}, хотя бы один больше 1")
                if to <= now:
                    return self.err(400, "День окончания уже прошёл")
                title = str(data.get("title") or "").strip()[:60] or "Бонус"
                start = P["from"] if P and P["from"] <= now <= P["to"] else now       # идёт — продлеваем, нет — с этой минуты
                promo_set(db, {"title": title, "task": round(task, 2), "exam": round(exam, 2), "from": start, "to": to})
            with _GS_LOCK:
                _GS_CACHE.clear()
            return self.send_json({"ok": True, "thermo": thermo_info(db, self.T)})

        if path == "/api/admin/thermo" and method == "POST":
            # термостат: режим (авто или ручной), норма кошелька, рычаги вручную, лимитка недели — главный учитель
            if not self.T["is_main"]:
                return self.err(403, "Термостат настраивает главный учитель")
            econ(db)                                    # термостат запущен: первая запись рычагов есть
            now, lv = time.time(), thermo_now(db)
            if data.get("limited") in ("start", "stop"):
                L = limited_now(db)
                if data["limited"] == "stop":
                    if L:
                        db.x("UPDATE limited SET stop=? WHERE id=?", (now, L["id"]))
                elif L:
                    return self.err(409, f"Лимитка уже продаётся: {L['i']} {L['t']}, осталось {L['left']} из {L['cap']}")
                else:
                    with _ECON_LOCK:
                        limited_start(db, now, lv["idx"], f"teacher:{self.T['id']}")
                _ECON["t"] = _MKT["t"] = 0.0
                return self.send_json({"ok": True, "thermo": thermo_info(db, self.T)})
            if "target" in data:
                v = to_int(data.get("target"))
                lo, hi = THERMO_SET["target"]
                if not v or not lo <= v <= hi:
                    return self.err(400, f"Норма состояния — от {lo} до {hi} ₿")
                db.setting("econ_target", str(v))
            mode = data.get("mode")
            if mode not in (None, "auto", "manual"):
                return self.err(400, "Режим — auto или manual")
            if mode:
                db.setting("thermo_mode", mode)
            new = {}
            for k in ("idx", "earn", "fee", "tax"):
                if data.get(k) is None:
                    continue
                v = to_float(data.get(k))
                lo, hi = THERMO_SET[k]
                if v is None or not lo <= v <= hi:
                    return self.err(400, f"{THERMO_NAMES[k]} — от {lo:g} до {hi:g}")
                new[k] = round(v, 3)
            if new:
                if db.setting("thermo_mode") != "manual":
                    return self.err(409, "Рычаги вручную — в ручном режиме термостата")
                with _ECON_LOCK:                           # не одновременно с суточным пересчётом
                    lv = thermo_now(db)
                    if any(new[k] != lv[k] for k in new):
                        thermo_add(db, now, f"teacher:{self.T['id']}", **{k: new.get(k, lv[k]) for k in ("idx", "earn", "fee", "tax")})
            _ECON["t"] = _MKT["t"] = 0.0
            return self.send_json({"ok": True, "thermo": thermo_info(db, self.T)})

        if path == "/api/admin/bank" and method == "POST":
            # пополнить банк рынка (новые биткоины в экономике) или изъять из него — главный учитель
            if not self.T["is_main"]:
                return self.err(403, "Пополнять банк и изымать из него может главный учитель")
            v = to_int(data.get("delta")) or 0
            note = re.sub(r"\s+", " ", str(data.get("note") or "")).strip()[:GIFT_NOTE_MAX]
            if not v or abs(v) > BANK_MOVE_MAX:
                return self.err(400, f"Сумма — от 1 до {BANK_MOVE_MAX} ₿ (минус — изъять)")
            with _GIFT_LOCK:
                have = bank_balance(db)
                if v < 0 and -v > have:
                    return self.err(409, f"В банке только {have} ₿")
                bank_move(db, v, "mint" if v > 0 else "burn", note, tid=self.T["id"])
            _ECON["t"] = _MKT["t"] = 0.0
            return self.send_json({"ok": True, "thermo": thermo_info(db, self.T)})

        if path == "/api/admin/gifts/box" and method == "POST":
            # цена «🎲 Случайного подарка» на весь сайт — главный учитель; reset — снова стандартная (60 ₿ × индекс цен)
            if not self.T["is_main"]:
                return self.err(403, "Цену случайного подарка задаёт главный учитель")
            if data.get("reset"):
                db.setting("gift_box_price", "")
            else:
                v = to_int(data.get("price"))
                if not v or not GIFT_BOX_MIN <= v <= GIFT_BOX_MAX:
                    return self.err(400, f"Цена — от {GIFT_BOX_MIN} до {GIFT_BOX_MAX} ₿")
                db.setting("gift_box_price", str(v))
            return self.send_json({"ok": True, "now": gift_box_price(db, econ(db)), "set": to_int(db.setting("gift_box_price")) or None})

        if path == "/api/admin/gifts/remove" and method == "POST":
            # удалить подарок из профиля ученика: он сгорает (как при продаже, но без биткоинов) — номер и сочетание
            # уникального больше не выдаются
            where, args = self.student_scope()
            r = db.q(f"""SELECT g.id, g.student_id FROM gifts g JOIN students s ON s.id = g.student_id
                         WHERE g.id=? AND g.sold IS NULL AND {where}""", (to_int(data.get("id")),) + args, one=True)
            if not r:
                return self.err(404, "Нет такого подарка")
            db.x("UPDATE gifts SET sold=?, kind=COALESCE(kind, 'removed') WHERE id=?", (time.time(), r["id"]))
            with _GS_LOCK:
                _LB_PEOPLE.clear()               # у ника в рейтинге пропадёт сразу
            LIVE.send([r["student_id"]], "gift")
            return self.send_json({"ok": True})

        if path == "/api/admin/gifts/give" and method == "POST":
            # подарок (один на всех или «случайный» — каждому свой, можно сразу уникальный) и/или биткоины: ученику, классу или всем
            where, args = self.student_scope()
            if data.get("student_id") is not None:
                rows = db.q(f"SELECT s.id FROM students s WHERE s.id=? AND {where}", (to_int(data.get("student_id")),) + args)
            elif data.get("class_id") is not None:
                rows = db.q(f"SELECT s.id FROM students s WHERE s.class_id=? AND {where}", (to_int(data.get("class_id")),) + args)
            elif data.get("all"):
                rows = db.q(f"SELECT s.id FROM students s WHERE {where}", args)
            else:
                return self.err(400, "Кому дарить?")
            sids = [r["id"] for r in rows]
            if not sids:
                return self.err(404, "Некому дарить: нет таких учеников")
            gift = str(data.get("gift") or "")
            if gift and gift != "random" and (gift not in GIFT_BY or gift in LIMITED_BY):
                return self.err(400, "Нет такого подарка")
            coins = to_int(data.get("coins")) or 0          # меньше нуля — снять (не больше, чем есть у ученика)
            if not -COINS_GRANT_MAX <= coins <= COINS_GRANT_MAX:
                return self.err(400, f"Биткоинов за раз — не больше {COINS_GRANT_MAX}")
            if not gift and not coins:
                return self.err(400, "Выберите подарок или сколько биткоинов начислить или снять")
            if coins < 0 and gift:
                return self.err(400, "Снимать биткоины — без подарка")
            uniq = bool(data.get("unique")) and bool(gift)
            note = re.sub(r"\s+", " ", str(data.get("note") or "")).strip()[:GIFT_NOTE_MAX]
            now, rnd, taken = time.time(), random.SystemRandom(), 0
            with _GIFT_LOCK:
                issued = uniq_issued(db)
                if uniq and gift != "random" and issued.get(gift, 0) + len(sids) > UNIQ_CAP:
                    return self.err(409, f"Тираж уникальных «{GIFT_BY[gift][2]}»: осталось {max(0, UNIQ_CAP - issued.get(gift, 0))} из {UNIQ_CAP}")
                # начисление — из банка рынка: биткоины не берутся из воздуха; снятое — возвращается в банк
                bank = bank_balance(db)
                if coins > 0 and coins * len(sids) > bank:
                    return self.err(409, f"В банке рынка {bank} ₿, а на начисление нужно {coins * len(sids)} ₿ "
                                         f"({coins} ₿ × {len(sids)}). Пополнить банк может главный учитель")
                for sid in sids:
                    if gift:
                        gid = gift_random(rnd)[0] if gift == "random" else gift
                        u = None
                        if uniq and issued.get(gid, 0) < UNIQ_CAP:       # случайный, у которого тираж кончился, — обычным
                            u = json.dumps(gift_uniq(db, gid, rnd))
                            issued[gid] = issued.get(gid, 0) + 1
                        db.x("INSERT INTO gifts(student_id, gift, ts, from_teacher, note, uniq, kind, up_base) VALUES(?,?,?,?,?,?,?,?)",
                             (sid, gid, now, self.T["id"], note, u, "box" if gift == "random" else None, gift_up_raw(gid) if u else None))
                    if coins > 0:
                        db.x("INSERT INTO coins(student_id, ts, delta, reason, note, seen) VALUES(?,?,?, 'grant', ?, 0)",
                             (sid, now, coins, note))
                    elif coins < 0:
                        take = min(-coins, game_summary(db, sid)["coins"])
                        if take:
                            db.x("INSERT INTO coins(student_id, ts, delta, reason, note, seen) VALUES(?,?,?, 'take', ?, 0)",
                                 (sid, now, -take, note))
                            taken += take
                one = sids[0] if len(sids) == 1 else None      # кому — имя покажет история банка (тем, кому видно ученика)
                if coins > 0:
                    bank_move(db, -coins * len(sids), "grant", f"по {coins} ₿ · учеников: {len(sids)}" + (f" — «{note}»" if note else ""),
                              sid=one, tid=self.T["id"], ts=now)
                if taken:
                    bank_move(db, taken, "take", f"учеников: {len(sids)}" + (f" — «{note}»" if note else ""), sid=one, tid=self.T["id"], ts=now)
            _ECON["t"] = 0.0                     # банк изменился — «Экономика» покажет сразу
            with _GS_LOCK:
                _LB_PEOPLE.clear()               # подарки у ников в рейтинге — сразу
            LIVE.send(sids, "gift")              # ученикам — уведомление сразу
            return self.send_json({"ok": True, "count": len(sids), "taken": taken})

        if path == "/api/admin/pyc/free" and method == "POST":
            # открыть ученику все уровни курса программирования сразу (без замков) — например, тестовому аккаунту
            where, args = self.student_scope()
            sid = to_int(data.get("student_id"))
            if not db.q(f"SELECT s.id FROM students s WHERE s.id=? AND {where}", (sid,) + args, one=True):
                return self.err(404, "нет такого ученика")
            db.x("UPDATE students SET pyc_free=? WHERE id=?", (1 if data.get("on") else 0, sid))
            LIVE.send([sid], "pyc")              # у ученика замки уровней пропадут (или вернутся) сразу
            return self.send_json({"ok": True})

        if path == "/api/admin/pyc/password" and method == "POST":
            # пароль курса программирования — как у раздела «Курс»: задать или сменить; revoke — закрыть всем, кто уже вошёл;
            # off — выключить курс (пароль сбрасывается, закрыт у всех)
            if not self.T["is_main"]:
                return self.err(403, "Пароль курса задаёт главный учитель")
            pw = str(data.get("password") or "").strip()
            if pw:
                if len(pw) < 4:
                    return self.err(400, "Пароль курса — не короче 4 символов")
                db.setting("pyc_pw", hash_pw(pw[:200]))
            if data.get("off"):
                db.setting("pyc_pw", "")
            if data.get("revoke") or data.get("off"):
                db.x("UPDATE students SET pyc=0")
            LIVE.send([r["id"] for r in db.q("SELECT id FROM students")], "pyc")   # у учеников сразу появится замок или поле пароля
            n = db.q("SELECT COUNT(*) c FROM students WHERE pyc=1", one=True)["c"]
            return self.send_json({"ok": True, "pw_set": bool(db.setting("pyc_pw")), "students": n})

        if path == "/api/admin/pyc/student":
            # подробно: каждая задача курса — решена ли, сколько попыток, код решения
            where, args = self.student_scope()
            sid = to_int(qs.get("id"))
            st = db.q(f"SELECT s.id, s.name FROM students s WHERE s.id=? AND {where}", (sid,) + args, one=True)
            if not st:
                return self.err(404, "нет такого ученика")
            prog = {r["task_id"]: r for r in db.q("SELECT * FROM pyc_progress WHERE student_id=?", (sid,))}
            mods = []
            for m in pyc_index():
                full = pyc_module(m["id"]) or {"levels": []}
                levels = []
                for lv in full["levels"]:
                    tasks = []
                    for t in lv["tasks"]:
                        p = prog.get(t["id"])
                        tasks.append({"id": t["id"], "h": t["h"], "stars": t["stars"], "ok": bool(p and p["ok"]),
                                      "tries": p["tries"] if p else 0, "ts": (p["ok_ts"] or p["last_ts"]) if p else None,
                                      "code": p["code"] if p else None, "ans": t["ans"]})
                    levels.append({"title": lv["title"], "need": lv["need"], "tasks": tasks})
                mods.append({"id": m["id"], "n": m["n"], "title": m["title"], "icon": m["icon"], "levels": levels})
            return self.send_json({"name": st["name"], "modules": mods})

        if path == "/api/admin/jserr":
            # ошибки JavaScript у учеников и учителей — только главному учителю
            if not self.T["is_main"]:
                return self.err(403, "Ошибки сайта видит главный учитель")
            seen = to_float(db.setting("jserr_seen")) or 0             # «новые» — с прошлого просмотра (до этого)
            if method == "POST":
                if data.get("seen"):
                    db.setting("jserr_seen", str(time.time()))
                elif to_int(data.get("id")):
                    db.x("UPDATE js_errors SET fixed_ts=? WHERE id=?", (time.time() if data.get("fixed") else None, to_int(data.get("id"))))
            return self.send_json({"errors": jserr_list(db), "new": jserr_new(db), "seen": seen})

        if path == "/api/admin/me":
            out = {k: self.T[k] for k in ("id", "name", "login", "is_main", "invite")}
            if self.T["is_main"]:
                out["jserr_new"] = jserr_new(db)
            row = db.q("SELECT consent_ver FROM teachers WHERE id=?", (self.T["id"],), one=True)
            out["consent_needed"] = not row or row["consent_ver"] != LEGAL_VERSION
            return self.send_json(out)

        if path == "/api/admin/consent" and method == "POST":
            if not data.get("accept"):
                return self.err(400, "Отметьте обе галочки")
            db.x("UPDATE teachers SET consent_ver=?, consent_ts=?, consent_ip=? WHERE id=?",
                 (LEGAL_VERSION, time.time(), self.client_ip(), self.T["id"]))
            return self.send_json({"ok": True, "version": LEGAL_VERSION})

        if path == "/api/admin/as-student" and method == "POST":
            # учитель решает тренажёр как ученик: свой аккаунт без кода и пароля, в рейтингах и списках его нет
            t = self.T
            s = db.q("SELECT * FROM students WHERE is_teacher=1 AND teacher_id=?", (t["id"],), one=True)
            if not s:
                db.x("""INSERT INTO students(name, name_key, token, created, last_seen, teacher_id, is_teacher)
                        VALUES(?,?,?,?,?,?,1)""", (t["name"] or "Учитель", f"teacher:{t['id']}", secrets.token_urlsafe(24),
                                                  time.time(), time.time(), t["id"]))
                s = db.q("SELECT * FROM students WHERE is_teacher=1 AND teacher_id=?", (t["id"],), one=True)
            tok = session_new(db, s["id"], self.client_ip(), self.headers.get("User-Agent"), False)
            return self.send_json({"ok": True, "sid": s["id"], "name": s["name"], "token": tok},
                                  extra={"Set-Cookie": self.student_cookie(tok)})

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
                "support": [dict(r, thread=support_thread(db, r)) for r in db.q("""
                    SELECT p.*, s.name, COALESCE(t.name, '') AS teacher,
                           COALESCE((SELECT MAX(ts) FROM support_msgs m WHERE m.support_id = p.id), p.ts) AS last
                    FROM support p JOIN students s ON s.id = p.student_id
                    LEFT JOIN teachers t ON t.id = COALESCE(s.teacher_id, ?)
                    ORDER BY (p.status = 'new') DESC, last DESC LIMIT 200""", (main_id,))]})

        if path == "/api/admin/support/img":
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            return self.support_img(qs.get("f"), None)

        if path == "/api/admin/support/delete" and method == "POST":
            # удалить обращение (или все закрытые разом) — только главный учитель
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            if data.get("closed"):
                n = db.xn("DELETE FROM support WHERE status='closed'")
            else:
                n = db.xn("DELETE FROM support WHERE id=?", (to_int(data.get("id")),))
            db.x("DELETE FROM support_msgs WHERE support_id NOT IN (SELECT id FROM support)")
            support_img_cleanup(db)
            return self.send_json({"ok": True, "deleted": n})

        if path == "/api/admin/support/answer" and method == "POST":
            if not self.T["is_main"]:
                return self.err(403, "только для главного учителя")
            sid = to_int(data.get("id"))
            r = db.q("SELECT * FROM support WHERE id=?", (sid,), one=True)
            if not r:
                return self.err(404, "Обращение не найдено")
            answer = str(data.get("answer") or "").strip()[:SUPPORT_MAX]
            try:
                img = support_img_save(data.get("img"))
            except ValueError as e:
                return self.err(400, str(e))
            if img and not answer:
                answer = "(картинка)"
            status = "closed" if data.get("close") else ("answered" if answer else r["status"])
            if data.get("reopen"):
                last = db.q("SELECT who FROM support_msgs WHERE support_id=? ORDER BY ts DESC, id DESC LIMIT 1", (sid,), one=True)
                status = "answered" if last and last["who"] == "teacher" else "new"
            if answer:
                db.x("INSERT INTO support_msgs(support_id, ts, who, text, img) VALUES(?,?,?,?,?)", (sid, time.time(), "teacher", answer, img))
                db.x("UPDATE support SET answer=?, answered=?, status=?, seen=0 WHERE id=?", (answer, time.time(), status, sid))
            else:
                db.x("UPDATE support SET status=? WHERE id=?", (status, sid))
            LIVE.send([r["student_id"]], "support")      # ответ появится у ученика сразу
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
                                                                       "students": 0, "done": 0, "tasks": 0, "ids": []})
                b["ids"].append(a["id"])
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

        if path == "/api/admin/batch/kind" and method == "POST":
            # тип личной подборки (персональной, работы над ошибками, слабых мест) — сразу у всех учеников пачки;
            # самостоятельная → практическая/домашняя: начатые сдаются по уже данным ответам, как у подборки класса
            cid = to_int(data.get("class_id"))
            if not self.sees_class(cid):
                return self.err(404, "класс не найден")
            kind = data.get("kind")
            if kind not in ASG_KINDS:
                return self.err(400, "неизвестный тип работы")
            batch = str(data.get("batch") or "")
            rows = (db.q("SELECT * FROM assignments WHERE id=? AND class_id=? AND student_id IS NOT NULL", (to_int(batch[4:]), cid))
                    if batch.startswith("one:") else
                    db.q("SELECT * FROM assignments WHERE batch=? AND class_id=? AND student_id IS NOT NULL", (batch, cid)))
            if not rows:
                return self.err(404, "подборка не найдена")
            APP.bank.ensure()
            ended = 0
            for a in rows:
                if a["strict"] and kind != "self":
                    real = [i for i in json.loads(a["tasks"] or "[]") if i in APP.bank.tasks]
                    for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (a["id"],)):
                        st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                        if st:
                            asg_finish_run(self, db, a, st, real, forced=1)
                            ended += 1
                db.x("UPDATE assignments SET kind=?, strict=? WHERE id=?", (kind, 1 if kind == "self" else 0, a["id"]))
            live_class(db, cid, [a["student_id"] for a in rows])
            return self.send_json({"ok": True, "changed": len(rows), "ended": ended})

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
            if due and not aid and due < now:
                return self.err(400, "Срок уже прошёл — выберите сегодняшнюю или более позднюю дату")
            kind = data.get("kind") if data.get("kind") in ASG_KINDS else "self"
            strict = 1 if kind == "self" else 0      # самостоятельная — проверка после сдачи; практическая и домашняя — сразу
            g = data.get("grading") if isinstance(data.get("grading"), dict) else {}
            grading = json.dumps({k: max(0, min(100, to_int(g.get(k, v)))) for k, v in ASG_GRADES.items()})
            if aid:
                old = db.q("SELECT strict, kind, tasks FROM assignments WHERE id=? AND class_id=?", (aid, cid), one=True)
                ended = 0
                if old and old["strict"] and db.q("SELECT 1 FROM asg_runs WHERE asg_id=? LIMIT 1", (aid,), one=True):
                    if json.loads(old["tasks"]) != tasks:
                        return self.err(409, "Самостоятельную уже начали писать — состав заданий менять нельзя")
                    if kind != "self":
                        # самостоятельная → практическая/домашняя: начатые сдаются по уже данным ответам (попадают в журнал),
                        # дальше ученики решают как обычную подборку
                        full = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
                        real = [i for i in tasks if i in APP.bank.tasks]
                        for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (aid,)):
                            st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                            if st:
                                asg_finish_run(self, db, full, st, real, forced=1)
                                ended += 1
                prev = db.q("SELECT closed, due FROM assignments WHERE id=?", (aid,), one=True)
                db.x("UPDATE assignments SET title=?, tasks=?, due=?, strict=?, grading=?, kind=? WHERE id=? AND class_id=?",
                     (title, json.dumps(tasks), due, strict, grading, kind, aid, cid))
                # продлили срок у работы, закрытой по сроку (closed = прежний срок), — она снова открыта;
                # закрытую учителем вручную не трогаем
                if prev and prev["closed"] and prev["due"] and prev["closed"] == prev["due"] and (not due or due > now):
                    db.x("UPDATE assignments SET closed=NULL WHERE id=?", (aid,))
                live_class(db, cid)
                return self.send_json({"ok": True, "id": aid, "ended": ended})
            elif data.get("students"):
                # персональная подборка: только выбранным ученикам класса (у каждого своя, в журнале — одна колонка)
                want = {to_int(x) for x in data.get("students") or []}
                members = [r["id"] for r in db.q("SELECT id FROM students WHERE class_id=? AND COALESCE(is_teacher, 0)=0", (cid,))
                           if r["id"] in want]
                if not members:
                    return self.err(400, "Выберите хотя бы одного ученика этого класса")
                batch = f"own:{int(now * 1000)}"
                for sid in members:
                    aid = db.x("""INSERT INTO assignments(class_id,title,tasks,created,due,strict,grading,kind,student_id,batch)
                                  VALUES(?,?,?,?,?,?,?,?,?,?)""", (cid, title, json.dumps(tasks), now, due, strict, grading, kind, sid, batch))
                live_class(db, cid, members)
                return self.send_json({"ok": True, "id": aid, "personal": len(members)})
            else:
                aid = db.x("INSERT INTO assignments(class_id,title,tasks,created,due,strict,grading,kind) VALUES(?,?,?,?,?,?,?,?)",
                           (cid, title, json.dumps(tasks), now, due, strict, grading, kind))
            live_class(db, cid)
            return self.send_json({"ok": True, "id": aid})

        if path == "/api/admin/assignment/delete" and method == "POST":
            a = db.q("SELECT class_id FROM assignments WHERE id=?", (to_int(data.get("id")),), one=True)
            if not a or not self.sees_class(a["class_id"]):
                return self.err(404, "подборка не найдена")
            db.x("DELETE FROM assignments WHERE id=?", (to_int(data.get("id")),))
            db.x("DELETE FROM asg_runs WHERE asg_id=?", (to_int(data.get("id")),))
            live_class(db, a["class_id"])
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
                    live_class(db, a["class_id"])
                    return self.send_json({"ok": True})
                db.x("UPDATE assignments SET closed=? WHERE id=?", (now, aid))
                a = db.q("SELECT * FROM assignments WHERE id=?", (aid,), one=True)
                n = 0
                for r in db.q("SELECT student_id FROM asg_runs WHERE asg_id=? AND finished IS NULL", (aid,)):
                    st = db.q("SELECT * FROM students WHERE id=?", (r["student_id"],), one=True)
                    if st:
                        asg_finish_run(self, db, a, st, real, forced=1)
                        n += 1
                live_class(db, a["class_id"])
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
# биткоины за вариант ЕГЭ по тестовому баллу: (не меньше баллов, ₿) — засчитывается самый высокий уровень
EXAM_BTC = [(90, 100), (80, 50), (60, 30), (40, 15)]


def exam_btc(test_score):
    return next((b for low, b in EXAM_BTC if (test_score or 0) >= low), 0)


_SINCE = {}                  # настройка → (база, время): с какого момента действует правило


def setting_since(db, key):
    """С какого момента действует правило (время первого запуска версии в настройке key); раньше — не считаем."""
    hit = _SINCE.get(key)
    if not hit or hit[0] is not db:
        hit = _SINCE[key] = (db, to_float(db.setting(key)) or 0)
    return hit[1]


def exam_btc_since(db):
    return setting_since(db, "exam_btc_since")


# Акция (например, перед пробником): с from по to биткоины за задания (опыт за решение, бонус за задание, самостоятельные) —
# × task, за вариант ЕГЭ (опыт и бонус за балл) — × exam. Хранится в настройке promo (JSON: title, task, exam, from, to — время),
# меняет главный учитель («Экономика»). PROMO_SEED включается сам при первом запуске версии — с этого момента и до конца дня to.
PROMO_SEED = {"title": "Бонус перед пробником", "task": 1.5, "exam": 2.0, "to": "2026-10-24"}
PROMO_MAX = 3.0
_PROMO = {"db": None, "v": None, "n": 0}


def promo_get(db):
    """Акция из настройки promo (кэш до promo_set) или None."""
    if _PROMO["db"] is not db:
        try:
            v = json.loads(db.setting("promo") or "null")
        except ValueError:
            v = None
        _PROMO.update(db=db, v=v if isinstance(v, dict) else None, n=_PROMO["n"] + 1)
    return _PROMO["v"]


def promo_set(db, v):
    db.setting("promo", json.dumps(v, ensure_ascii=False) if v else "")
    _PROMO.update(db=db, v=v, n=_PROMO["n"] + 1)


def promo_mult(db, ts, kind):
    """Множитель акции для заработка kind ('task' или 'exam') в момент ts; вне акции — 1."""
    P = promo_get(db)
    if not P or not P["from"] <= ts <= P["to"]:
        return 1
    return Fraction(round(float(P.get(kind) or 1) * 100), 100)


def promo_now(db, now=None):
    """Акция, которая идёт сейчас: название, множители, до какого дня (включительно); None — нет."""
    P, now = promo_get(db), now or time.time()
    if not P or not P["from"] <= now <= P["to"]:
        return None
    return {"title": P.get("title") or "Бонус", "task": P.get("task") or 1, "exam": P.get("exam") or 1, "from": P["from"], "to": P["to"],
            "day": time.strftime("%Y-%m-%d", time.localtime(P["to"]))}


def day_end(day):
    """Конец дня day ('ГГГГ-ММ-ДД') по времени сервера — 23:59:59."""
    return time.mktime(datetime.strptime(day, "%Y-%m-%d").timetuple()) + 86399


# бонус ₿ за впервые решённое задание (сверх биткоинов за опыт) по номеру; со 2-й попытки — половина.
# На сайте таблицу не показываем — ученику только «чем сложнее задание, тем больше».
TASK_BTC = {**{n: Fraction(n, 4) for n in range(1, 11)},                 # №1–10 — 25 % от номера
            **{n: Fraction(35 * n, 100) for n in range(11, 16)},          # №11–15 — 35 %
            16: Fraction(4), 17: Fraction(17, 2), 18: Fraction(63, 10),   # 25 %, 50 %, 35 %
            19: Fraction(5, 3), 20: Fraction(5, 3), 21: Fraction(5, 3),   # игра 19–21 — 5 ₿ за все три вопроса
            22: Fraction(7), 23: Fraction(10), 24: Fraction(25), 25: Fraction(10), 26: Fraction(50), 27: Fraction(40)}


def work_btc(items):
    """Бонус за самостоятельную от учителя — как за вариант ЕГЭ. items — [(номер, зачёт 1 / 0.5 / 0)].
    Полный вариант (по заданию на каждый номер 1–27) — по тестовому баллу; работа короче — по проценту решённого
    и пропорционально размеру (10 заданий из 27 — 10/27 бонуса)."""
    if not items:
        return 0
    if len(items) == 27 and {n for n, _ in items} == set(range(1, 28)):
        primary = sum(ege_points(n) if c == 1 else 1 if c == 0.5 else 0 for n, c in items)
        return exam_btc(EGE_SCALE[min(primary, len(EGE_SCALE) - 1)])
    pct = 100 * sum(c for _, c in items) / len(items)
    return math.floor(exam_btc(pct) * min(1, len(items) / 27))


FAST_XP_MS = 60000          # верный ответ быстрее минуты с открытия задания…
FAST_XP_PENALTY = -1        # …даёт −1 XP вместо опыта
BTC_FAST_MS = 30000         # а быстрее 30 секунд — ещё и −1 ₿: биткоины не даются просто так
BTC_FAST_FINE = 1
# №24–27 — долгие задачи: верный ответ быстрее этого с открытия задания не засчитывается — −1 XP и −1 ₿
HARD_MIN_MS = {24: 10 * 60000, 25: 5 * 60000, 26: 20 * 60000, 27: 25 * 60000}


def answer_min_ms(n, ts):
    """Сколько минимум нужно на задание, чтобы верный ответ засчитался: №24–27 — HARD_MIN_MS (для ответов после выхода
    правила), остальные — минута."""
    lim = HARD_MIN_MS.get(n or 0)
    return lim if lim and ts >= setting_since(APP.db, "hard_min_since") else FAST_XP_MS


def too_fast(r, fast_since):
    """Верный ответ дан слишком быстро — похоже на подсмотренный: без опыта и не засчитан решённым."""
    return r["spent_ms"] is not None and r["ts"] >= fast_since and r["spent_ms"] < answer_min_ms(r["n"], r["ts"])


def min_text(ms):
    return "минуты" if ms <= FAST_XP_MS else f"{ms // 60000} минут"
_FAST_SINCE = []


def btc_fast_since(db):
    """С какого момента действует «быстрее 30 секунд — минус биткоин» (раньше решённое не штрафуем)."""
    if not _BTC_SINCE:
        _BTC_SINCE.append(to_float(db.setting("btc_fast_since")) or 0)
    return _BTC_SINCE[0]


_BTC_SINCE = []


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
        if sc > 0 and not too_fast(r, fast_since):
            solved.add(tid)
        if sc < 1 and (r["revealed"] or r["reason"] in (WORK_REASON, "asg")):
            shown.add(tid)
    return out


def last_attempt_skipped(db, sid):
    """Последний ответ ученика не засчитан (задание уже решено или ответ был показан)."""
    rows = db.q("""SELECT task_id, n, score, ts, exam, reason, revealed, spent_ms FROM attempts WHERE student_id=?
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
    f = db.q("SELECT COUNT(*) c FROM fire_cover WHERE student_id=?", (sid,), one=True)
    z = db.q("SELECT freezes FROM students WHERE id=?", (sid,), one=True)
    c = db.q("SELECT COUNT(*) c, COALESCE(SUM(delta), 0) s FROM coins WHERE student_id=?", (sid,), one=True)
    thermo_load(db)                                # новые рычаги термостата — заработок с этого момента считается по-другому
    return (a["m"], a["c"], x["c"], x["s"], e["c"], f["c"], z["freezes"] if z else 0, c["c"], c["s"],
            time.strftime("%Y-%m-%d"), int(time.time() // 300), len(_THERMO["ts"]), promo_get(db) is not None and _PROMO["n"])


COURSE_TRIES, COURSE_WINDOW = 8, 15 * 60  # попыток ввести пароль курса за 15 минут
_COURSE_TRIES = {}
_COURSE_LOCK = threading.Lock()


def course_open(s):
    """Курс открыт ученику, если он ввёл пароль, а учитель не выключил курс."""
    if s["is_teacher"]:
        return True                      # учителю курс открыт без пароля
    return bool(s["course"]) and bool(APP.db.setting("course_pw"))


# ---------- курс «Программирование для ЕГЭ» (закрытый: вход по паролю, как у раздела «Курс»)
_PYC = {}                               # имя файла → (mtime, данные): курс пересобрали — перечитаем без перезапуска
_PYC_LOCK = threading.Lock()
PYC_CHECKS, PYC_WINDOW = 40, 60         # не больше 40 проверок ответа в минуту — перебор ответов не пройдёт
_PYC_TRIES = {}
_PYC_PW_TRIES = {}                      # попытки ввести пароль курса (лимит — как у раздела «Курс»)


def pyc_load(name):
    f = HERE / "pycourse" / name
    try:
        mt = f.stat().st_mtime
    except OSError:
        return None
    with _PYC_LOCK:
        hit = _PYC.get(str(f))
        if hit and hit[0] == mt:
            return hit[1]
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    with _PYC_LOCK:
        _PYC[str(f)] = (mt, data)
    return data


def pyc_index():
    return pyc_load("index.json") or []


def pyc_module(mid):
    if not re.fullmatch(r"m\d{2}", mid or ""):
        return None
    return pyc_load(f"{mid}.json")


def pyc_task(tid):
    """Задача по её id («m05.bin2») → (модуль, номер уровня, задача)."""
    mod = pyc_module(str(tid).split(".")[0])
    for li, lv in enumerate((mod or {}).get("levels", [])):
        for t in lv["tasks"]:
            if t["id"] == tid:
                return mod, li, t
    return None, None, None


def pyc_access(s):
    """Курс программирования открыт ученику, если он ввёл пароль, а учитель не выключил курс (как раздел «Курс»)."""
    if s["is_teacher"]:
        return True                      # учителю курс открыт без пароля
    return bool(s["pyc"]) and bool(APP.db.setting("pyc_pw"))


def pyc_solved(db, sid):
    return {r["task_id"]: {"ok": r["ok"], "tries": r["tries"]}
            for r in db.q("SELECT task_id, ok, tries FROM pyc_progress WHERE student_id=?", (sid,))}


def pyc_open_levels(mod, prog, all_open=False):
    """Сколько уровней модуля открыто: следующий — когда в предыдущем решено need задач (all_open — все сразу)."""
    lv = mod.get("levels", [])
    if all_open:
        return len(lv)
    k = 1
    while k < len(lv):
        prev = lv[k - 1]
        if sum(1 for t in prev["tasks"] if (prog.get(t if isinstance(t, str) else t["id"]) or {}).get("ok")) < prev["need"]:
            break
        k += 1
    return k


def pyc_norm(ans):
    """Ответ к сравнению: регистр, запятые и лишние пробелы не важны («2, 5» = «2 5»), числа — по значению («44.00» = «44»)."""
    from decimal import Decimal, InvalidOperation
    out = []
    for tok in str(ans).replace(",", " ").replace(";", " ").lower().split():
        if re.fullmatch(r"[-+]?\d+\.\d+", tok):
            try:
                tok = format(Decimal(tok).normalize(), "f")
            except InvalidOperation:
                pass
        out.append(tok)
    return " ".join(out)


_LB_PEOPLE = {}                         # учитель → (когда собран, строки рейтинга)
_LB_BUILD = threading.Lock()            # собирает один запрос, остальные не дублируют работу
LB_TTL = 15


def lb_person(db, m, crown, crowns=None):
    """Строка рейтинга: опыт за день/неделю/месяц, огонёк, лига, значки."""
    g = game_summary(db, m["id"], brief=True)
    lg = league_row(db, m["id"])["league"]
    return {"sid": m["id"], "name": short_name(m["name"]), "level": g["level"],
            "badges": nick_badges(db, m, g, lg, crown, crowns or {}), "gifts": gift_icons(db, m["id"]), "league": lg,
            "class_id": m["class_id"], "crown": crown if m["id"] == crown else None,
            "day": g["day"], "week": g["week"], "month": g["month"], "fire": g["fire"], "wk": g["wk"],
            "rank": {k: g["rank"][k] for k in ("day", "week", "month", "wk")}}


# ---------------------------------------------------------------- биткоины и подарки
COIN_XP = 10                           # обычный курс: 1 биткоин (₿) за 10 XP заработанного опыта
# Курс плавает: если верно решают сразу много учеников (за последние BTC_RATE_WINDOW), биткоин дорожает —
# до BTC_RATE_FREE человек курс обычный, каждые следующие BTC_RATE_STEP — ещё +1 XP за биткоин, но не больше BTC_RATE_MAX.
BTC_RATE_MAX = 20
BTC_RATE_FREE, BTC_RATE_STEP = 10, 5
BTC_RATE_WINDOW = 15 * 60
_BTC_RATES = {"db": None, "ts": [], "k": [], "tick": 0.0, "active": 0}
GIFTS = [                              # id, значок, название, цена в биткоинах
    ("cookie", "🍪", "Печенька", 11), ("candy", "🍬", "Конфета", 17), ("tea", "☕", "Чай", 22), ("tulip", "🌷", "Тюльпан", 28),
    ("balloon", "🎈", "Шарик", 33), ("pizza", "🍕", "Пицца", 44), ("cat", "🐱", "Котик", 55), ("dog", "🐶", "Пёсик", 55),
    ("panda", "🐼", "Панда", 66), ("teddy", "🧸", "Мишка", 83), ("cake", "🎂", "Торт", 99), ("guitar", "🎸", "Гитара", 121),
    ("gamepad", "🎮", "Геймпад", 143), ("robot", "🤖", "Робот", 176), ("python", "🐍", "Питон", 220), ("rocket", "🚀", "Ракета", 275),
    ("rainbow", "🌈", "Радуга", 330), ("unicorn", "🦄", "Единорог", 440), ("planet", "🪐", "Планета", 550), ("dragon", "🐉", "Дракон", 770),
    # вкусное
    ("donut", "🍩", "Пончик", 13), ("lollipop", "🍭", "Леденец", 13), ("strawberry", "🍓", "Клубника", 15), ("popcorn", "🍿", "Попкорн", 18),
    ("icecream", "🍦", "Мороженое", 20), ("croissant", "🥐", "Круассан", 22), ("chocolate", "🍫", "Шоколадка", 24), ("cupcake", "🧁", "Капкейк", 29),
    ("watermelon", "🍉", "Арбуз", 31), ("pastry", "🍰", "Пирожное", 35), ("burger", "🍔", "Бургер", 39), ("bubbletea", "🧋", "Бабл-ти", 50),
    ("sushi", "🍣", "Суши", 61),
    # школа и увлечения
    ("pencil", "✏️", "Карандаш", 11), ("books", "📚", "Книги", 44), ("abacus", "🧮", "Счёты", 50), ("puzzle", "🧩", "Пазл", 39),
    ("ball", "⚽", "Мяч", 44), ("kite", "🪁", "Воздушный змей", 64), ("palette", "🎨", "Палитра", 72), ("flask", "🧪", "Колба", 77),
    ("skate", "🛹", "Скейтборд", 143), ("keyboard", "⌨️", "Клавиатура", 165), ("headphones", "🎧", "Наушники", 187),
    ("camera", "📷", "Фотоаппарат", 209), ("laptop", "💻", "Ноутбук", 330), ("telescope", "🔭", "Телескоп", 385),
    # звери
    ("bee", "🐝", "Пчела", 33), ("frog", "🐸", "Лягушка", 39), ("bunny", "🐰", "Кролик", 50), ("butterfly", "🦋", "Бабочка", 61),
    ("turtle", "🐢", "Черепашка", 66), ("fox", "🦊", "Лиса", 72), ("penguin", "🐧", "Пингвин", 77), ("koala", "🐨", "Коала", 88),
    ("owl", "🦉", "Сова", 94), ("octopus", "🐙", "Осьминог", 105), ("flamingo", "🦩", "Фламинго", 132), ("lion", "🦁", "Лев", 154),
    ("tiger", "🐯", "Тигр", 154), ("shark", "🦈", "Акула", 198), ("whale", "🐳", "Кит", 242), ("dino", "🦖", "Динозавр", 286),
    ("peacock", "🦚", "Павлин", 418),
    # космос и волшебство
    ("moon", "🌙", "Луна", 308), ("comet", "☄️", "Комета", 495), ("crystal", "🔮", "Шар предсказаний", 605),
    ("wand", "🪄", "Волшебная палочка", 715), ("ufo", "🛸", "НЛО", 880), ("castle", "🏰", "Замок", 1100)]
GIFT_BY = {g[0]: g for g in GIFTS}
# лимитированные подарки недели: в каталоге и в «🎲» их нет — продаются только неделю, тиражом LIMITED_CAP (цена в GIFT_BY —
# базовая, без индекса); не улучшаются
LIMITED_PRICE = 300
LIMITED = [("lim_fireworks", "🎆", "Салют"), ("lim_shooting", "🌠", "Звездопад"), ("lim_volcano", "🌋", "Вулкан"),
           ("lim_genie", "🧞", "Джинн"), ("lim_carousel", "🎠", "Карусель"), ("lim_pinata", "🪅", "Пиньята"),
           ("lim_violin", "🎻", "Скрипка"), ("lim_wheel", "🎡", "Колесо обозрения")]
LIMITED_BY = {k: (k, i, t, LIMITED_PRICE) for k, i, t in LIMITED}
GIFT_BY.update(LIMITED_BY)
GIFT_BOX_PRICE = 60                    # «🎲 Случайный подарок»: выпадает любой, дорогие — реже (вес ∝ 1 / цена)
GIFTS_SHOW = 5                         # сколько подарков видно у ника
GIFTS_PER_DAY = 20                     # подарков, которые ученик может купить за сутки
GIFT_NOTE_MAX = 80
COINS_GRANT_MAX = 1000                 # биткоинов за одно начисление учителем
_GIFT_LOCK = threading.Lock()          # проверка баланса, покупка и номер уникального подарка — одним шагом

# Улучшение делает подарок уникальным: случайные фон, узор и эффект (у каждого — своя редкость) и номер среди
# улучшенных подарков этого вида. Сочетание «фон + узор + эффект» у одного вида не повторяется.
UNIQ_BG = [                            # id, название, два цвета градиента, вес: чем меньше — тем реже
    ("mint", "Мята", "#c9f7e4", "#4cc9a0", 14), ("sky", "Небо", "#cfe9ff", "#4f9dff", 14), ("peach", "Персик", "#ffe2cc", "#ff9a5a", 14),
    ("lilac", "Сирень", "#eadcff", "#9b6dff", 12), ("rose", "Роза", "#ffd9e6", "#ff5c8d", 12), ("lemon", "Лимон", "#fff6c2", "#f5c400", 12),
    ("ocean", "Океан", "#9be7ff", "#1565c0", 8), ("forest", "Лес", "#b9f6ca", "#2e7d32", 8), ("sunset", "Закат", "#ffcc80", "#d81b60", 6),
    ("night", "Полночь", "#5c6bc0", "#0d1137", 4), ("lava", "Лава", "#ff8a65", "#7f0000", 3), ("gold", "Золото", "#fff3b0", "#c99700", 2),
    ("aurora", "Северное сияние", "#a7ffeb", "#7c4dff", 1.5), ("cosmos", "Космос", "#7e57c2", "#000000", 1),
    ("sand", "Песок", "#fff3d6", "#d4a35a", 12), ("grass", "Луг", "#e6ffd0", "#7cb342", 12), ("candy", "Сахарная вата", "#ffd6f5", "#c86dd7", 10),
    ("sea", "Морская волна", "#b2fef7", "#00897b", 10), ("coral", "Коралл", "#ffd0c2", "#ff6f61", 10), ("glacier", "Ледник", "#e3f9ff", "#5ab3d8", 9),
    ("coffee", "Кофе", "#d7ccc8", "#5d4037", 9), ("cherry", "Вишня", "#ffc1c7", "#b0003a", 8), ("steel", "Сталь", "#cfd8dc", "#455a64", 8),
    ("berry", "Ягоды", "#e1bee7", "#6a1b9a", 7), ("plum", "Слива", "#d1b3ff", "#4a148c", 5), ("emerald", "Изумруд", "#b9f6ca", "#00695c", 3),
    ("silver", "Серебро", "#f5f5f5", "#9e9e9e", 3), ("ruby", "Рубин", "#ff8a80", "#880e4f", 2.5), ("sapphire", "Сапфир", "#82b1ff", "#0d47a1", 2.5),
    ("neon", "Неоновый город", "#ff00e5", "#2b00ff", 1.2), ("void", "Бездна", "#424242", "#000000", 0.8)]
UNIQ_SYM = [                           # id, название, символ, вес
    ("dot", "Точки", "•", 14), ("star", "Звёзды", "★", 12), ("heart", "Сердечки", "♥", 12), ("note", "Ноты", "♪", 10),
    ("plus", "Плюсы", "+", 10), ("code", "Код", "</>", 8), ("bit", "Биты", "01", 8), ("bolt", "Молнии", "⚡", 6),
    ("snow", "Снежинки", "❄", 6), ("leaf", "Клевер", "☘", 5), ("pi", "Пи", "π", 4), ("sigma", "Сигма", "Σ", 4),
    ("inf", "Бесконечность", "∞", 3), ("crown", "Короны", "♛", 2), ("btc", "Биткоины", "₿", 1),
    ("circle", "Кольца", "○", 10), ("square", "Квадраты", "■", 9), ("diamond", "Ромбы", "◆", 8), ("tri", "Треугольники", "▲", 8),
    ("arrow", "Стрелки", "➜", 7), ("check", "Галочки", "✓", 7), ("hash", "Решётки", "#", 6), ("cloud", "Облака", "☁", 6),
    ("flower", "Цветы", "✿", 6), ("brace", "Скобки", "{}", 5), ("sun", "Солнышки", "☀", 5), ("sqrt", "Корни", "√", 3),
    ("anchor", "Якоря", "⚓", 3), ("atom", "Атомы", "⚛", 2.5), ("lambda", "Лямбда", "λ", 2), ("yinyang", "Инь-ян", "☯", 2)]
UNIQ_FX = [                            # id, название, вес (как выглядит — класс gfx-<id> в style.css)
    ("classic", "Классика", 30), ("shine", "Блеск", 16), ("mirror", "Зеркало", 12), ("ice", "Лёд", 10), ("acid", "Кислота", 8),
    ("neon", "Неон", 7), ("noir", "Нуар", 6), ("gold", "Золотой", 4), ("ghost", "Призрак", 3), ("rainbow", "Радужный", 2),
    ("shadow", "Тень", 8), ("sepia", "Ретро", 8), ("pop", "Поп-арт", 5), ("fog", "Туман", 4), ("fire", "Пламя", 3),
    ("invert", "Негатив", 2.5), ("pulse", "Пульс", 2), ("glitch", "Глитч", 1.5)]
UNIQ_POSE = [                          # id, название, вес (как выглядит — класс ugp-<id> в style.css; twin — значок дважды)
    ("stand", "Ровно", 30), ("tilt", "Наклон влево", 14), ("tiltr", "Наклон вправо", 14), ("big", "Великан", 8), ("small", "Малыш", 8),
    ("jump", "Прыжок", 6), ("flip", "Вверх ногами", 3), ("twin", "Близнецы", 2), ("spin", "Вихрь", 1.5)]
_UNIQ = {"bg": {x[0]: x for x in UNIQ_BG}, "sym": {x[0]: x for x in UNIQ_SYM}, "fx": {x[0]: x for x in UNIQ_FX},
         "pose": {x[0]: x for x in UNIQ_POSE}}
# Улучшение до уникального: (350 + 60 % каталожной цены подарка) × (1 + 1 % за каждый уже выпущенный уникальный этого вида)
# × индекс цен, с шагом 5 ₿. Печенька — от 355 ₿, Дракон — от 810 ₿, Замок — от 1010 ₿; последний из тиража — почти вдвое дороже первого.
# Цена улучшения — как сам подарок по каталогу, но не меньше UP_MIN (× индекс цен × 1 % за каждый уже выпущенный уникальный
# этого вида). До 2.7.1 было 350 + 60 % каталожной цены (UP_OLD) — у уже улучшенных оценка считается от той базы.
UP_MIN, UP_PER_ISSUED = 100, 0.01
UP_OLD = (350, 0.6)
UNIQ_CAP = 100                         # тираж: уникальных подарков одного вида — не больше; проданные не возвращаются
WORK_GIFT_EVERY = 25                   # за каждые 25 впервые решённых заданий — случайный подарок «за труд»
# Термостат экономики. Раз в сутки сравнивает средний кошелёк учеников, решавших что-то за 30 дней, с нормой (ECON_TARGET,
# главный учитель может поменять) и сдвигает рычаги на THERMO_STEP пути к цели — за неделю примерно наполовину:
#   индекс цен — ×0,8…2,5 от каталога, по корню из (среднее + медиана) / 2 / норма: копят — дорожает, тратят — дешевеет;
#   заработок — множитель биткоинов за опыт, задания и варианты ×0,5…1,3: денег много — платим меньше, мало — больше;
#   комиссия рынка — 5…20 %, растёт вместе с кошельками; уходит в банк рынка.
# Раз в неделю: плата за хранение — TAX_RATE с суммы сверх TAX_FROM нормы (в банк); стипендия из банка старательным,
# когда денег у учеников мало; лимитированный подарок недели, когда много. В ручном режиме рычаги ставит главный учитель.
ECON_TARGET = 500
ECON_MAX = 10                          # прежнее правило (до термостата): индекс не выше ×10 — с него термостат стартует
THERMO_STEP = 0.1
IDX_MIN, IDX_MAX = 0.8, 2.5
EARN_MIN, EARN_MAX = 0.5, 1.3
FEE_MIN, FEE_MAX = 0.05, 0.20
TAX_RATE, TAX_FROM = 0.03, 1.6         # 3 % в неделю с суммы больше 800 ₿ (при норме 500)
STIPEND_R, STIPEND_MAX, STIPEND_SHARE, STIPEND_TASKS = 0.6, 40, 0.1, 10   # средний кошелёк < 0,6 нормы: до 40 ₿ решившим 10+ за неделю
LIMITED_R, LIMITED_CAP = 1.3, 30       # средний кошелёк > 1,3 нормы: лимитка недели — 30 штук по LIMITED_PRICE × индекс
# пределы ручного режима главного учителя
THERMO_SET = {"idx": (0.5, 5.0), "earn": (0.25, 2.0), "fee": (0.0, 0.5), "tax": (0.0, 0.1), "target": (100, 5000)}
THERMO_NAMES = {"idx": "Индекс цен", "earn": "Множитель заработка", "fee": "Комиссия рынка", "tax": "Плата за хранение"}
BANK_START = 10000                     # стартовый капитал банка рынка
# Банку — LABOR_BANK от заработка учеников трудом (опыт, бонусы за задания, варианты и самостоятельные — с множителем термостата),
# у учеников при этом ничего не списывается. Считается по дням с запуска версии; последние LABOR_DAYS дней досчитываются
# при каждом пересчёте экономики (поправки задним числом — срезанная накрутка), старше — окончательно.
LABOR_BANK, LABOR_DAYS = 0.5, 7
BANK_MOVE_MAX = 100000                 # пополнить или изъять за раз — не больше
_ECON = {"t": 0.0, "v": None, "db": None}
_ECON_LOCK = threading.Lock()
_THERMO = {"db": None, "ts": [], "earn": [], "last": None}
# Продажа сразу (подарок сгорает): цена — за сколько подарок достался, но не дороже, чем он сейчас в магазине (иначе выгодно
# скупить одинаковые, поднять спрос и сдать дороже); у уникального — плюс доля базовой цены улучшения (без надбавки за тираж)
# по редкости. Ученику — SELL_SHARE этой цены, остальное (10 %) — в банк рынка. В среднем улучшение убыточно (продажей
# возвращается ≈ 0,78 его цены) — биткоины уходят из оборота; редкий — дешевле улучшения, мифический — в разы дороже.
SELL_SHARE = 0.9
SELL_UNIQ = {"rare": 0.45, "epic": 0.9, "legend": 2.2, "myth": 6.0}
# Рынок: ученик выставляет свой подарок за свою цену, одноклассник (ученик того же учителя) покупает; подарок переходит
# к покупателю вместе с номером и свойствами, продавец получает цену минус комиссия — комиссия уходит в банк рынка.
# Комиссию ставит термостат (5–20 %); MARKET_FEE — с неё он стартует. Подарок, выпавший в «🎲 Случайном подарке» (kind='box'),
# при первой продаже на рынке — с комиссией MARKET_FEE_BOX: иначе выгодно покупать «🎲» и перепродавать дорогие выпадения;
# с перепродажи (уже куплен на рынке) — обычная.
MARKET_FEE = 0.10
MARKET_FEE_BOX = 0.5
# Рынок: не дороже MARKET_CAP оценок подарка (обычный — цена в магазине, уникальный — плюс улучшение или его уникальная часть);
# лот снимается сам через MARKET_DAYS дней; «обычно продают за» — медиана сделок за MARKET_TYP_DAYS (от двух сделок).
MARKET_CAP = 3
MARKET_DAYS = 7
MARKET_TYP_DAYS = 30
_MKT_TYP = {"t": 0.0, "v": None, "db": None}
# «🎲 Случайный подарок» — вся цена в банк рынка (bank.reason = 'box'). Комиссия с покупки, лимитки и улучшения — в банк рынка: четверть комиссии рынка, не больше OP_FEE_MAX (при комиссии
# 5–20 % — 1,25–5 %), с округлением вниз — с дешёвых подарков 0; для ученика они не дорожают (часть цены уходит в банк, а не
# сгорает). Продажа сразу — своя доля банка: 10 % цены (SELL_SHARE).
OP_FEE_MAX = 0.05
ECON_DAYS = 30                         # графики экономики — за столько дней
HIST_DAYS = 26 * 7                     # графики рынка «по неделям» — за 26 недель
MARKET_MIN, MARKET_MAX = 5, 20000
MARKET_MAX_LISTED = 10

# Редкость высчитывается из шансов. Обычный подарок — шанс выпасть в «🎲 Случайном подарке» (вес ∝ 1 / цена);
# уникальный — шанс его сочетания: фон × узор × эффект («1 из N»). Порог — наименьший шанс уровня.
_GIFT_W = sum(1 / g[3] for g in GIFTS)
# уровень обычного — по шансу относительно среднего (1 / число подарков): в 2 раза чаще среднего и больше — обычный и т. д.
RARITY = [(2.0, "common", "Обычный"), (1.0, "uncommon", "Необычный"), (0.45, "rare", "Редкий"),
          (0.2, "epic", "Эпический"), (0, "legend", "Легендарный")]


def _uniq_rarity():
    """Пороги уникальных — по всем сочетаниям фон × узор × эффект × поза, чтобы при улучшении выпадало примерно:
    редкий 58%, эпический 30%, легендарный 10%, мифический 2%. Считается один раз при запуске."""
    tot = [sum(x[i] for x in xs) for xs, i in ((UNIQ_BG, 4), (UNIQ_SYM, 3), (UNIQ_FX, 2), (UNIQ_POSE, 2))]
    ch = sorted(b[4] / tot[0] * s[3] / tot[1] * f[2] / tot[2] * p[2] / tot[3]
                for b in UNIQ_BG for s in UNIQ_SYM for f in UNIQ_FX for p in UNIQ_POSE)
    marks, cum, out = [0.02, 0.12, 0.42], 0.0, []
    for c in ch:                              # от самых редких: где набирается 2%, 12%, 42% всех улучшений
        cum += c
        while marks and cum >= marks[0]:
            out.append(c)
            marks.pop(0)
    return [(out[2], "rare", "Редкий"), (out[1], "epic", "Эпический"), (out[0], "legend", "Легендарный"), (0, "myth", "Мифический")]


UNIQ_RARITY = _uniq_rarity()


def rarity_tier(chance, tiers):
    return next((k, t) for low, k, t in tiers if chance >= low)


def gift_rarity(gid):
    """Редкость обычного подарка: шанс выпасть в «🎲 Случайном подарке» (в процентах) и уровень; лимитка — своя редкость."""
    if gid in LIMITED_BY:
        return {"k": "limited", "t": "Лимитка", "p": 0}
    ch = (1 / GIFT_BY[gid][3]) / _GIFT_W
    k, t = rarity_tier(ch * len(GIFTS), RARITY)
    return {"k": k, "t": t, "p": round(100 * ch, 2)}


def econ_target(db):
    """Норма среднего состояния (кошелёк + подарки): задал главный учитель — она, иначе ECON_TARGET."""
    return to_int(db.setting("econ_target")) or ECON_TARGET


def thermo_load(db):
    if _THERMO["db"] is not db:                    # другая база (тесты) — историю рычагов читаем заново
        rows = db.q("SELECT * FROM thermo ORDER BY ts")
        _THERMO.update(db=db, ts=[r["ts"] for r in rows], earn=[Fraction(round(r["earn"] * 1000), 1000) for r in rows],
                       last=dict(rows[-1]) if rows else None)


def earn_at(db, ts):
    """Множитель заработка в момент ts (до первого запуска термостата — ×1): смена рычага прошлое не трогает."""
    thermo_load(db)
    i = bisect.bisect_right(_THERMO["ts"], ts) - 1
    return _THERMO["earn"][i] if i >= 0 else Fraction(1)


def thermo_now(db):
    """Рычаги, которые действуют сейчас (последняя запись термостата); None — термостат ещё не запускался."""
    thermo_load(db)
    return _THERMO["last"]


def thermo_add(db, ts, who, **lv):
    """Новые рычаги с момента ts: idx, earn, fee, tax (+ r, avg, med, active — по какому состоянию учеников решено)."""
    thermo_load(db)
    ts = max(ts, (_THERMO["ts"] or [0])[-1] + 0.001)  # строго после прежних — история не переписывается
    row = {"ts": ts, "who": who, "r": None, "avg": None, "med": None, "active": None, **lv}
    db.x("""INSERT INTO thermo(ts, idx, earn, fee, tax, r, avg, med, active, who) VALUES(?,?,?,?,?,?,?,?,?,?)""",
         tuple(row[k] for k in ("ts", "idx", "earn", "fee", "tax", "r", "avg", "med", "active", "who")))
    _THERMO["ts"].append(ts)
    _THERMO["earn"].append(Fraction(round(row["earn"] * 1000), 1000))
    _THERMO["last"] = row
    return row


def thermo_goal(avg, med, target):
    """Куда тянет термостат при таком состоянии учеников (кошелёк + подарки): r — среднее к норме, m — полусумма среднего и медианы к норме
    (медиана — чтобы пара «копилок» не делала дорого всем)."""
    r, m = avg / target, (avg + med) / 2 / target
    return {"idx": min(IDX_MAX, max(IDX_MIN, m ** 0.5 if m > 0 else IDX_MIN)),
            "earn": min(EARN_MAX, max(EARN_MIN, r ** -0.7 if r > 0 else EARN_MAX)),
            "fee": round(FEE_MIN + (FEE_MAX - FEE_MIN) * min(1, max(0, (r - 0.6) / 1.4)), 3)}


def bank_balance(db):
    return db.q("SELECT COALESCE(SUM(delta), 0) s FROM bank", one=True)["s"]


def bank_move(db, delta, reason, note="", sid=None, tid=None, ts=None):
    """Движение банка рынка: + пришло (комиссия, хранение, снято учителем, пополнение), − ушло (начисления, стипендии)."""
    db.x("INSERT INTO bank(ts, delta, reason, note, student_id, teacher_id) VALUES(?,?,?,?,?,?)",
         (ts or time.time(), int(delta), reason, note, sid, tid))
    v = _ECON["v"]
    if v and _ECON["db"] is db and "bank" in v:      # банк в «Экономике сейчас» — сразу, не дожидаясь пересчёта
        v["bank"] += int(delta)


def limited_now(db, now=None):
    """Лимитированный подарок, который продаётся сейчас: что, почём, сколько осталось и до когда; None — нет."""
    now = now or time.time()
    r = db.q("SELECT * FROM limited WHERE start <= ? AND stop > ? ORDER BY id DESC LIMIT 1", (now, now), one=True)
    if not r or r["gift"] not in GIFT_BY:
        return None
    sold = db.q("SELECT COUNT(*) c FROM gifts WHERE gift=? AND from_sid IS NOT NULL AND ts >= ?", (r["gift"], r["start"]), one=True)["c"]
    g = GIFT_BY[r["gift"]]
    return {"id": r["id"], "gift": g[0], "i": g[1], "t": g[2], "price": r["price"], "cap": r["cap"], "sold": sold,
            "left": max(0, r["cap"] - sold), "start": r["start"], "stop": r["stop"]}


def limited_start(db, now, idx, who):
    """Выпустить лимитку на неделю: тот лимитированный подарок, что выходил реже всех."""
    used = {r["gift"]: r["c"] for r in db.q("SELECT gift, COUNT(*) c FROM limited GROUP BY gift")}
    gid = min(range(len(LIMITED)), key=lambda k: (used.get(LIMITED[k][0], 0), k))
    db.x("INSERT INTO limited(gift, start, stop, cap, price, who) VALUES(?,?,?,?,?,?)",
         (LIMITED[gid][0], now, now + 7 * 86400, LIMITED_CAP, round5(LIMITED_PRICE * idx), who))
    return limited_now(db, now)


def thermo_weekly(db, now, lv, r, target, auto):
    """Раз в неделю: плата за хранение больших сумм — в банк; стипендия из банка старательным, когда денег у учеников мало
    (авто-режим); лимитка недели, когда много (авто-режим). → кому изменился счёт."""
    touched = []
    with _GIFT_LOCK:
        studs = [x["id"] for x in db.q("SELECT id FROM students WHERE COALESCE(is_teacher, 0) = 0")]
        if lv["tax"] > 0:
            free, got = round(TAX_FROM * target), 0
            for sid in studs:
                bal = game_summary(db, sid, brief=True)["coins"]
                t = math.floor((bal - free) * lv["tax"]) if bal > free else 0
                if t >= 1:
                    db.x("INSERT INTO coins(student_id, ts, delta, reason, note, seen) VALUES(?,?,?, 'storage', ?, 0)",
                         (sid, now, -t, ""))
                    got += t
                    touched.append(sid)
            if got:
                bank_move(db, got, "storage", f"Плата за хранение · учеников: {len(touched)}", ts=now)
        if auto and r < STIPEND_R:
            busy = {x["student_id"] for x in db.q("""SELECT student_id FROM attempts WHERE ts > ? AND score > 0 AND COALESCE(exam, 0) = 0
                                                     GROUP BY student_id HAVING COUNT(DISTINCT task_id) >= ?""",
                                                  (now - 7 * 86400, STIPEND_TASKS))}
            who = [sid for sid in studs if sid in busy and game_summary(db, sid, brief=True)["coins"] < target]
            each = int(min(STIPEND_MAX, bank_balance(db) * STIPEND_SHARE // len(who))) if who else 0
            if each >= 1:
                for sid in who:
                    db.x("INSERT INTO coins(student_id, ts, delta, reason, note, seen) VALUES(?,?,?, 'stipend', ?, 0)",
                         (sid, now, each, f"за {STIPEND_TASKS}+ решённых заданий за неделю"))
                bank_move(db, -each * len(who), "stipend", f"Стипендия по {each} ₿ · учеников: {len(who)}", ts=now)
                touched += who
    if auto and r > LIMITED_R and not limited_now(db, now):
        limited_start(db, now, lv["idx"], "auto")
    return touched


def labor_accrue(db, sids, now):
    """Банку — LABOR_BANK от заработка учеников sids трудом по дням (btc_days): с запуска версии, последние LABOR_DAYS дней
    досчитываются до нужной суммы. У учеников ничего не списывается. → сколько добавлено сейчас."""
    since = setting_since(db, "labor_bank_since")
    if not since:
        return 0
    first = time.strftime("%Y-%m-%d", time.localtime(since))
    days = [d for d in ((datetime.fromtimestamp(now).date() - timedelta(days=k)).isoformat() for k in range(LABOR_DAYS - 1, -1, -1))
            if d >= first]
    if not days:
        return 0
    earned = dict.fromkeys(days, 0.0)
    for sid in sids:
        bd = game_summary(db, sid, brief=True).get("btc_days", {})
        for d in days:
            earned[d] += bd.get(d, (0, 0))[0]
    have = {r["note"]: r["s"] for r in db.q("SELECT note, SUM(delta) s FROM bank WHERE reason='labor' AND note >= ? GROUP BY note", (days[0],))}
    added = 0
    for d in days:
        diff = max(0, math.floor(earned[d] * LABOR_BANK)) - have.get(d, 0)
        if diff:
            bank_move(db, diff, "labor", d, ts=now)
            added += diff
    return added


def econ(db, fresh=False):
    """Экономика сейчас: состояние активных учеников (решали что-то за 30 дней; кошелёк + сколько дадут за подарки) и их кошельки,
    рычаги термостата, банк рынка и лимитка.
    Раз в сутки (авто-режим) термостат сдвигает рычаги к цели, раз в неделю — плата за хранение, стипендия, лимитка.
    Пересчёт — раз в 10 минут."""
    now = time.time()
    if not fresh and _ECON["v"] and _ECON["db"] is db and now - _ECON["t"] < 600:
        return _ECON["v"]
    with _ECON_LOCK:
        if not fresh and _ECON["v"] and _ECON["db"] is db and time.time() - _ECON["t"] < 600:
            return _ECON["v"]                      # пока ждали, посчитал другой запрос
        sids = [r["student_id"] for r in db.q("""SELECT DISTINCT a.student_id FROM attempts a JOIN students s ON s.id = a.student_id
                                                  WHERE a.ts > ? AND COALESCE(s.is_teacher, 0) = 0""", (now - 30 * 86400,))]
        coins = {sid: game_summary(db, sid, brief=True)["coins"] for sid in sids}
        wallets = sorted(coins.values())
        total, n = sum(wallets), len(wallets)
        mid = lambda v: (v[n // 2] + v[(n - 1) // 2]) / 2 if n else 0
        # термостат смотрит на состояние: кошелёк + сколько дадут за подарки (подарок продаётся почти за цену — почти деньги)
        lv0 = thermo_now(db)
        worth = gifts_worth(db, sids, {"idx": lv0["idx"] if lv0 else 1.0})
        states = sorted(coins[sid] + worth.get(sid, 0) for sid in sids)
        avg, med = sum(states) / n if n else 0, mid(states)
        w_avg, w_med = total / n if n else 0, mid(wallets)
        target = econ_target(db)
        r = avg / target
        auto = db.setting("thermo_mode") != "manual"
        lv, day = thermo_now(db), time.strftime("%Y-%m-%d", time.localtime(now))
        seen = {"r": round(r, 3), "avg": round(avg), "med": round(med), "active": n}
        if lv is None:
            # первый запуск: от нынешнего индекса по прежнему правилу, заработок ×1, комиссия — прежние 10 %;
            # недельные действия — со следующей недели
            lv = thermo_add(db, now, "start", idx=min(ECON_MAX, max(1.0, round(r * 20) / 20)), earn=1.0, fee=MARKET_FEE,
                            tax=TAX_RATE, **seen)
            db.setting("thermo_week", str(week_start(now)))
        elif auto and time.strftime("%Y-%m-%d", time.localtime(lv["ts"])) != day:
            t = thermo_goal(avg, med, target)
            lv = thermo_add(db, now, "auto", idx=round(lv["idx"] + THERMO_STEP * (t["idx"] - lv["idx"]), 2),
                            earn=round(lv["earn"] + THERMO_STEP * (t["earn"] - lv["earn"]), 3), fee=t["fee"], tax=TAX_RATE, **seen)
        if (to_float(db.setting("thermo_week")) or 0) < week_start(now):
            db.setting("thermo_week", str(week_start(now)))
            touched = thermo_weekly(db, now, lv, r, target, auto)
            if touched:
                LIVE.send(touched, "gift")         # плата за хранение и стипендия — уведомление сразу
        labor_accrue(db, sids, now)               # банку — половина заработка учеников за последние дни
        bank = bank_balance(db)
        v = {"idx": lv["idx"], "earn": lv["earn"], "fee": lv["fee"], "tax": lv["tax"], "since": lv["ts"], "who": lv["who"],
             "avg": round(avg), "med": round(med), "w_avg": round(w_avg), "w_med": round(w_med), "worth": sum(states) - total,
             "total": total, "active": n, "target": target, "r": round(r, 2),
             "mode": "auto" if auto else "manual", "bank": bank, "tax_from": round(TAX_FROM * target), "limited": limited_now(db, now),
             "op_fee": op_fee({"fee": lv["fee"]})}
        _ECON.update(t=now, v=v, db=db)
        if db.setting("forbes_day") != day:          # раз в день — снимок Forbes всех классов (для роста за неделю)
            db.setting("forbes_day", day)
            for t in db.q("SELECT id FROM teachers"):
                forbes_data(db, t["id"], e=v)
        db.x("""INSERT INTO econ_hist(day, idx, avg, total, active, med, earn, fee, tax, bank, r, s_avg, s_med) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(day) DO UPDATE SET idx=excluded.idx, avg=excluded.avg, total=excluded.total, active=excluded.active,
                med=excluded.med, earn=excluded.earn, fee=excluded.fee, tax=excluded.tax, bank=excluded.bank, r=excluded.r,
                s_avg=excluded.s_avg, s_med=excluded.s_med""",
             (day, lv["idx"], v["w_avg"], total, n, v["w_med"], lv["earn"], lv["fee"], lv["tax"], bank, v["r"], v["avg"], v["med"]))
        return v


def gifts_worth(db, sids, e):
    """Сколько дадут ученикам sids за все их подарки, если продать сразу (оценка для термостата), — без запроса на каждого."""
    out, dem = {}, gift_demand(db)
    for k in range(0, len(sids), 500):
        part = sids[k:k + 500]
        for r in db.q(f"""SELECT student_id, gift, uniq, paid, up_base FROM gifts
                          WHERE sold IS NULL AND student_id IN ({','.join('?' * len(part))})""", part):
            if r["gift"] in GIFT_BY:
                u = uniq_pub(r["uniq"]) if r["uniq"] else None
                out[r["student_id"]] = out.get(r["student_id"], 0) + gift_sell_price(r["gift"], u, e, None, dem, r["paid"], r["up_base"])
    return out


def price_now(base, e):
    return max(1, math.ceil(base * e["idx"]))


GIFT_BOX_MIN, GIFT_BOX_MAX = 5, 5000   # какую цену «🎲 Случайного подарка» может задать главный учитель


def gift_box_price(db, e):
    """Цена «🎲 Случайного подарка»: заданная главным учителем — ровно такая; не задана — GIFT_BOX_PRICE × индекс цен."""
    v = to_int(db.setting("gift_box_price"))
    return v if v else price_now(GIFT_BOX_PRICE, e)


def gift_box_value():
    """Средняя цена выпадающего подарка по каталогу (без индекса цен и спроса) — подсказка учителю, сколько брать за «🎲»."""
    return round(len(GIFTS) / sum(1 / g[3] for g in GIFTS), 1)


def _rates_load(db):
    if _BTC_RATES["db"] is not db:                 # другая база (тесты) — расписание курса читаем заново
        rows = db.q("SELECT ts, k FROM btc_rate ORDER BY ts")
        _BTC_RATES.update(db=db, ts=[r["ts"] for r in rows], k=[r["k"] for r in rows], tick=0.0)


def btc_rate_at(db, ts):
    """Сколько XP стоил 1 ₿ в момент ts (до первой записи курса — COIN_XP)."""
    _rates_load(db)
    i = bisect.bisect_right(_BTC_RATES["ts"], ts) - 1
    return _BTC_RATES["k"][i] if i >= 0 else COIN_XP


def btc_rate_now(db):
    """Курс сейчас: раз в минуту считает, сколько учеников верно решали за последние BTC_RATE_WINDOW; изменился — записывает.
    → (XP за 1 ₿, сколько занимается)."""
    _rates_load(db)
    now = time.time()
    if now - _BTC_RATES["tick"] >= 60:
        _BTC_RATES["tick"] = now
        active = db.q("""SELECT COUNT(DISTINCT a.student_id) c FROM attempts a JOIN students s ON s.id = a.student_id
                         WHERE a.ts > ? AND a.score > 0 AND COALESCE(s.is_teacher, 0) = 0""", (now - BTC_RATE_WINDOW,), one=True)["c"]
        _BTC_RATES["active"] = active
        k = min(BTC_RATE_MAX, COIN_XP + max(0, -(-(active - BTC_RATE_FREE) // BTC_RATE_STEP)))
        if k != btc_rate_at(db, now):
            db.x("INSERT OR REPLACE INTO btc_rate(ts, k, active) VALUES(?,?,?)", (now, k, active))
            _BTC_RATES["ts"].append(now)
            _BTC_RATES["k"].append(k)
    return btc_rate_at(db, now), _BTC_RATES["active"]


DEMAND_DAYS = 7
# Спрос — с поправкой на цену: подарок сравнивается только с подарками своей редкости (обычные с обычными, легендарные
# с легендарными) — дорогие покупают реже, и это нормально. Ожидаемо за неделю — среднее по его редкости; множитель =
# ((куплено + DEMAND_PRIOR) / (в среднем + DEMAND_PRIOR)) ^ DEMAND_POW — одна-две покупки редкого подарка цену не взвинчивают.
# Замок дешевеет, только если его берут реже других легендарных.
DEMAND_POW, DEMAND_PRIOR = 0.3, 2
DEMAND_MIN, DEMAND_MAX = 0.8, 1.5
PRICE_DAYS = 30                        # график цены подарка — за столько дней (последняя точка — сейчас)
_PRICE_HIST = {"t": 0.0, "v": None, "db": None}
_DEMAND = {"t": 0.0, "v": None, "db": None}


def gift_demand(db):
    """Спрос: множитель цены каждого подарка по покупкам за DEMAND_DAYS (пересчёт раз в 5 минут)."""
    now = time.time()
    if _DEMAND["v"] is not None and _DEMAND["db"] is db and now - _DEMAND["t"] < 300:
        return _DEMAND["v"]
    cnt = {r["gift"]: r["c"] for r in db.q("""SELECT gift, COUNT(*) c FROM gifts WHERE from_sid IS NOT NULL AND ts > ?
                                              GROUP BY gift""", (now - DEMAND_DAYS * 86400,))}
    v = demand_of(cnt)
    _DEMAND.update(t=now, v=v, db=db)
    return v


def demand_of(cnt):
    """Множители спроса по числу покупок каждого подарка за DEMAND_DAYS — к среднему по его редкости (см. DEMAND_POW)."""
    tier = {g[0]: gift_rarity(g[0])["k"] for g in GIFTS}           # лимитки — не в счёт: у них своя цена
    tot, size = {}, {}
    for g in GIFTS:
        tot[tier[g[0]]] = tot.get(tier[g[0]], 0) + cnt.get(g[0], 0)
        size[tier[g[0]]] = size.get(tier[g[0]], 0) + 1
    return {g[0]: round(min(DEMAND_MAX, max(DEMAND_MIN, ((cnt.get(g[0], 0) + DEMAND_PRIOR)
                                                       / (tot[tier[g[0]]] / size[tier[g[0]]] + DEMAND_PRIOR)) ** DEMAND_POW)), 2)
            for g in GIFTS}


def gift_price_hist(db):
    """Цены подарков на конец каждого из PRICE_DAYS − 1 прошедших дней (но не раньше открытия магазина — первой покупки):
    индекс цен термостата в тот момент (до термостата — из econ_hist) × спрос по покупкам за DEMAND_DAYS до него; и сколько
    каждого купили за эти дни. Пересчёт — раз в 5 минут."""
    now = time.time()
    if _PRICE_HIST["v"] is not None and _PRICE_HIST["db"] is db and now - _PRICE_HIST["t"] < 300:
        return _PRICE_HIST["v"]
    today = datetime.now().date()
    ends = [(today - timedelta(days=k), datetime.combine(today - timedelta(days=k - 1), datetime.min.time()).timestamp())
            for k in range(PRICE_DAYS - 1, 0, -1)]
    opened = db.q("SELECT MIN(ts) t FROM gifts WHERE from_sid IS NOT NULL", one=True)["t"]   # первая покупка — магазин открылся
    ends = [(d, t) for d, t in ends if opened and t >= opened]
    if not ends:
        _PRICE_HIST.update(t=now, v=[], db=db)
        return []
    buys = db.q("SELECT gift, ts FROM gifts WHERE from_sid IS NOT NULL AND ts > ? ORDER BY ts", (ends[0][1] - DEMAND_DAYS * 86400,))
    bts = [r["ts"] for r in buys]
    th = db.q("SELECT ts, idx FROM thermo ORDER BY ts")
    tts = [r["ts"] for r in th]
    old = {r["day"]: r["idx"] for r in db.q("SELECT day, idx FROM econ_hist WHERE idx IS NOT NULL")}
    out = []
    for d, t in ends:
        i = bisect.bisect_right(tts, t) - 1
        lo, hi = bisect.bisect_right(bts, t - DEMAND_DAYS * 86400), bisect.bisect_right(bts, t)
        cnt = {}
        for r in buys[lo:hi]:
            cnt[r["gift"]] = cnt.get(r["gift"], 0) + 1
        out.append({"d": d.isoformat(), "idx": th[i]["idx"] if i >= 0 else old.get(d.isoformat(), 1.0), "cnt": cnt, "dem": demand_of(cnt)})
    _PRICE_HIST.update(t=now, v=out, db=db)
    return out


def gift_price_points(db, gid, e):
    """График цены подарка gid: по дню — цена в магазине на конец дня и сколько его купили за DEMAND_DAYS; последняя точка — сейчас."""
    base = GIFT_BY[gid][3]
    pts = [{"d": h["d"], "p": max(1, math.ceil(base * h["idx"] * h["dem"][gid])), "n": h["cnt"].get(gid, 0)} for h in gift_price_hist(db)]
    n = db.q("SELECT COUNT(*) c FROM gifts WHERE gift=? AND from_sid IS NOT NULL AND ts > ?",
             (gid, time.time() - DEMAND_DAYS * 86400), one=True)["c"]
    return pts + [{"d": datetime.now().date().isoformat(), "p": gift_price(gid, e, gift_demand(db)), "n": n}]


def gift_price(gid, e, dem):
    """Цена подарка сейчас: каталог × индекс цен × спрос."""
    return max(1, math.ceil(GIFT_BY[gid][3] * e["idx"] * dem.get(gid, 1.0)))


def uniq_issued(db):
    """Сколько уникальных выпущено каждого вида — вместе с проданными: тираж не возвращается."""
    return {r["gift"]: r["c"] for r in db.q("SELECT gift, COUNT(*) c FROM gifts WHERE uniq IS NOT NULL GROUP BY gift")}


def round5(v):
    return max(5, 5 * round(v / 5))


def market_fee(e, g):
    """Комиссия рынка для подарка: выпавший в «🎲» и ещё не перепроданный — MARKET_FEE_BOX, остальные — комиссия термостата."""
    return MARKET_FEE_BOX if g["kind"] == "box" and g["market_from"] is None else e["fee"]


def market_cap(gid, u, e, dem, ub=None):
    """Самая высокая цена подарка на рынке: MARKET_CAP × его оценки (в пределах MARKET_MIN–MARKET_MAX)."""
    v = gift_price(gid, e, dem)
    if u:
        b = gift_up_base(gid, e, ub)
        v += max(b, math.floor(b * SELL_UNIQ.get(u["rar"]["k"], 0.45)))
    return min(MARKET_MAX, max(MARKET_MIN, MARKET_CAP * v))


def market_key(gid, u):
    """Ключ «обычно продают за»: обычный подарок — его вид, уникальный — вид и уровень редкости сочетания."""
    return f"{gid}:{u['rar']['k']}" if u else gid


def market_typical(db):
    """«Обычно продают за»: медиана цен сделок на рынке за MARKET_TYP_DAYS по ключам market_key (уникальный — если был им уже при
    сделке); только где сделок хотя бы две. Пересчёт — раз в 5 минут."""
    now = time.time()
    if _MKT_TYP["v"] is not None and _MKT_TYP["db"] is db and now - _MKT_TYP["t"] < 300:
        return _MKT_TYP["v"]
    deals = {}
    for r in db.q("""SELECT g.gift, g.uniq, -c.delta AS price,
                            NOT EXISTS(SELECT 1 FROM coins k WHERE k.gift_id = g.id AND k.reason = 'upgrade' AND k.ts > c.ts) AS was
                     FROM coins c JOIN gifts g ON g.id = c.gift_id WHERE c.reason = 'mbuy' AND c.ts > ?""", (now - MARKET_TYP_DAYS * 86400,)):
        if r["gift"] in GIFT_BY:
            u = uniq_pub(r["uniq"]) if r["uniq"] and r["was"] else None
            deals.setdefault(market_key(r["gift"], u), []).append(r["price"])
    v = {k: round((sorted(p)[len(p) // 2] + sorted(p)[(len(p) - 1) // 2]) / 2) for k, p in deals.items() if len(p) >= 2}
    _MKT_TYP.update(t=now, v=v, db=db)
    return v


def market_expire(db):
    """Лоты старше MARKET_DAYS дней снимаются с продажи сами; выставленные до потолка цены и дороже него — один раз тоже."""
    now = time.time()
    db.x("UPDATE gifts SET listed=NULL, listed_ts=NULL WHERE listed IS NOT NULL AND COALESCE(listed_ts, 0) < ?", (now - MARKET_DAYS * 86400,))
    if db.setting("market_cap_done"):
        return
    e, dem = econ(db), gift_demand(db)
    for r in db.q("SELECT id, gift, uniq, up_base, listed FROM gifts WHERE listed IS NOT NULL AND sold IS NULL"):
        if r["gift"] in GIFT_BY and r["listed"] > market_cap(r["gift"], uniq_pub(r["uniq"]) if r["uniq"] else None, e, dem, r["up_base"]):
            db.x("UPDATE gifts SET listed=NULL, listed_ts=NULL WHERE id=?", (r["id"],))
    db.setting("market_cap_done", "1")


def gift_up_raw(gid):
    """База улучшения подарка (без индекса цен и тиража): его каталожная цена, но не меньше UP_MIN."""
    return max(UP_MIN, GIFT_BY[gid][3])


def gift_up_base(gid, e, base=None):
    """Базовая цена улучшения сейчас: база × индекс цен; base — с какой базы улучшен уже уникальный подарок (gifts.up_base)."""
    return round5((base or gift_up_raw(gid)) * e["idx"])


def gift_up_price(gid, e, issued):
    """Цена улучшения сейчас: базовая × (1 + 1 % за каждый уже выпущенный уникальный этого вида); None — тираж закончился."""
    n = issued.get(gid, 0)
    if n >= UNIQ_CAP or gid in LIMITED_BY:            # лимитку не улучшают
        return None
    return round5(gift_up_raw(gid) * (1 + UP_PER_ISSUED * n) * e["idx"])


def op_fee(e):
    """Комиссия с операций с подарками сейчас (доля): четверть комиссии рынка, не больше OP_FEE_MAX."""
    return min(OP_FEE_MAX, round(e.get("fee", MARKET_FEE) / 4, 4))


def op_cut(amount, e):
    """Сколько ₿ с операции на amount уходит в банк (вниз до целого)."""
    return math.floor(amount * op_fee(e))


def gift_sell_gross(gid, uniq, e, issued, dem=None, paid=None, ub=None):
    """Цена продажи сразу (до доли банка): за сколько подарок достался (paid), но не дороже нынешней цены в магазине; без paid
    (от учителя, за труд, из «🎲» до 2.7.1) — нынешняя цена, но не выше цены без спроса. У уникального — плюс доля базовой
    цены улучшения по редкости (ub — с какой базы улучшен)."""
    v = min(gift_price(gid, e, dem or {}), paid if paid is not None else gift_price(gid, e, {}))
    if uniq:
        v += math.floor(gift_up_base(gid, e, ub) * SELL_UNIQ.get(uniq["rar"]["k"], 0.45))   # от базовой цены улучшения — иначе улучшать и продавать стало бы выгодно
    return max(1, v)


def gift_sell_price(gid, uniq, e, issued, dem=None, paid=None, ub=None):
    """Сколько ученик получит, продав сразу: SELL_SHARE цены (вниз до целого); остальное — в банк рынка."""
    return math.floor(gift_sell_gross(gid, uniq, e, issued, dem, paid, ub) * SELL_SHARE)


def work_gifts(db, sid, solved):
    """Подарки за труд: за каждые WORK_GIFT_EVERY впервые решённых — случайный подарок (один раз за каждый рубеж).
    Учительскому аккаунту — нет. Возвращает, сколько выдано сейчас."""
    due = solved // WORK_GIFT_EVERY
    if not due:
        return 0
    st = db.q("SELECT is_teacher FROM students WHERE id=?", (sid,), one=True)
    if not st or st["is_teacher"]:
        return 0
    have = db.q("SELECT COUNT(*) c FROM gifts WHERE COALESCE(first_sid, student_id)=? AND kind='work'", (sid,), one=True)["c"]
    rnd, now = random.SystemRandom(), time.time()
    for k in range(have + 1, due + 1):
        db.x("INSERT INTO gifts(student_id, gift, ts, note, kind) VALUES(?,?,?,?, 'work')",
             (sid, gift_random(rnd)[0], now, f"За труд: {k * WORK_GIFT_EVERY} решённых заданий"))
    return max(0, due - have)


def econ_feed(db, where, args, sid=None, limit=150):
    """Журнал экономики: движения биткоинов (покупки, улучшения, продажи, начисления и снятия учителем) и подарки
    без денег (от учителя, за труд, удалённые учителем). where/args — ученики этого учителя (alias s)."""
    one = " AND s.id = ?" if sid else ""
    a = args + ((sid,) if sid else ())
    pub = lambda gid, uq: {"i": GIFT_BY[gid][1], "t": GIFT_BY[gid][2], "uniq": uniq_pub(uq) if uq else None}
    out = []
    for r in db.q(f"""SELECT c.ts, c.delta, c.reason, c.note, s.id AS sid, s.name, g.gift, g.uniq,
                             COALESCE(g.first_sid, g.student_id) AS to_sid, t.name AS to_name
                      FROM coins c JOIN students s ON s.id = c.student_id LEFT JOIN gifts g ON g.id = c.gift_id
                      LEFT JOIN students t ON t.id = COALESCE(g.first_sid, g.student_id)
                      WHERE {where}{one} ORDER BY c.ts DESC LIMIT ?""", a + (limit,)):
        e = {"ts": r["ts"], "sid": r["sid"], "name": r["name"], "kind": r["reason"], "delta": r["delta"], "note": r["note"] or ""}
        if r["gift"] in GIFT_BY:
            e["gift"] = pub(r["gift"], r["uniq"] if r["reason"] != "gift" else None)
            if r["reason"] == "gift" and r["to_sid"] != r["sid"]:
                e["to"] = short_name(r["to_name"])
        if r["reason"] in ("mbuy", "msell"):              # сделка на рынке: в note — с кем
            e["to"], e["note"] = e["note"], ""
        out.append(e)
    # подарки без денег: от учителя и за труд — когда получены; удалённые учителем (сгорели без продажи) — когда удалены
    for r in db.q(f"""SELECT g.ts, g.sold, g.kind, g.gift, g.uniq, g.note, g.from_teacher, s.id AS sid, s.name,
                             EXISTS(SELECT 1 FROM coins c WHERE c.gift_id = g.id AND c.reason = 'sell') AS cashed
                      FROM gifts g JOIN students s ON s.id = COALESCE(g.first_sid, g.student_id)
                      WHERE (g.from_teacher IS NOT NULL OR g.kind IN ('work', 'removed') OR g.sold IS NOT NULL) AND {where}{one}
                      ORDER BY g.ts DESC LIMIT ?""", a + (limit,)):
        if r["gift"] not in GIFT_BY:
            continue
        base = {"sid": r["sid"], "name": r["name"], "delta": 0, "note": r["note"] or "", "gift": pub(r["gift"], r["uniq"])}
        if r["from_teacher"] or r["kind"] == "work":
            out.append(dict(base, ts=r["ts"], kind="teacher_gift" if r["from_teacher"] else "work"))
        if r["sold"] and not r["cashed"]:
            out.append(dict(base, ts=r["sold"], kind="removed", note=""))
    out.sort(key=lambda e: -e["ts"])
    return out[:limit]


_SITE_ECON = {"t": 0.0, "v": None, "db": None}


def econ_site(db, fresh=False):
    """Экономика всего сайта (главному учителю): подарки, биткоины, курс, популярное и редкое. Пересчёт раз в 5 минут."""
    now = time.time()
    if not fresh and _SITE_ECON["v"] and _SITE_ECON["db"] is db and now - _SITE_ECON["t"] < 300:
        return _SITE_ECON["v"]
    sids = [r["id"] for r in db.q("SELECT id FROM students WHERE COALESCE(is_teacher, 0) = 0")]
    sums = {"balance": 0, "mined": 0, "exam": 0, "task": 0, "fines": 0, "with_coins": 0}
    for sid in sids:
        g = game_summary(db, sid, brief=True)
        sums["balance"] += g["coins"]
        sums["mined"] += g["mined"]
        sums["exam"] += g["exam_coins"]
        sums["task"] += g["task_coins"]
        sums["fines"] += g["btc_fast"] * BTC_FAST_FINE
        sums["with_coins"] += g["coins"] > 0
    led = {r["reason"]: {"sum": r["s"], "n": r["c"]} for r in db.q("SELECT reason, SUM(delta) s, COUNT(*) c FROM coins GROUP BY reason")}
    q1 = lambda sql, *a: db.q(sql, a, one=True)["c"]
    week = now - 7 * 86400
    gifts = {
        "on_hand": q1("SELECT COUNT(*) c FROM gifts WHERE sold IS NULL"),
        "uniq_on_hand": q1("SELECT COUNT(*) c FROM gifts WHERE sold IS NULL AND uniq IS NOT NULL"),
        "owners": q1("SELECT COUNT(DISTINCT student_id) c FROM gifts WHERE sold IS NULL"),
        "bought": q1("SELECT COUNT(*) c FROM gifts WHERE from_sid IS NOT NULL"),
        "bought_week": q1("SELECT COUNT(*) c FROM gifts WHERE from_sid IS NOT NULL AND ts > ?", week),
        "to_mates": q1("SELECT COUNT(*) c FROM gifts WHERE from_sid IS NOT NULL AND from_sid <> student_id"),
        "from_teacher": q1("SELECT COUNT(*) c FROM gifts WHERE from_teacher IS NOT NULL"),
        "work": q1("SELECT COUNT(*) c FROM gifts WHERE kind = 'work'"),
        "sold": q1("SELECT COUNT(*) c FROM coins WHERE reason = 'sell'"),
        "burned": q1("SELECT COUNT(*) c FROM gifts WHERE sold IS NOT NULL"),
        "uniq_issued": q1("SELECT COUNT(*) c FROM gifts WHERE uniq IS NOT NULL"),
    }
    popular = [{"i": GIFT_BY[r["gift"]][1], "t": GIFT_BY[r["gift"]][2], "n": r["c"]} for r in db.q(
        """SELECT gift, COUNT(*) c FROM gifts WHERE from_sid IS NOT NULL GROUP BY gift ORDER BY c DESC, gift LIMIT 5""") if r["gift"] in GIFT_BY]
    rarest = []
    for r in db.q("""SELECT g.gift, g.uniq, s.name FROM gifts g JOIN students s ON s.id = g.student_id
                     WHERE g.sold IS NULL AND g.uniq IS NOT NULL"""):
        u = uniq_pub(r["uniq"]) if r["gift"] in GIFT_BY else None
        if u:
            rarest.append({"i": GIFT_BY[r["gift"]][1], "t": GIFT_BY[r["gift"]][2], "n": u["n"], "rar": u["rar"], "who": short_name(r["name"])})
    rarest.sort(key=lambda x: -x["rar"]["one_in"])
    rate, active = btc_rate_now(db)
    v = {"students": len(sids), "coins": sums, "gifts": gifts, "popular": popular, "rarest": rarest[:5],
         "spent": -(led.get("gift", {}).get("sum", 0) + led.get("upgrade", {}).get("sum", 0)),
         "ledger": {k: x["sum"] for k, x in led.items()}, "deals": sum(x["n"] for x in led.values()),
         "market": {"deals": led.get("mbuy", {}).get("n", 0), "volume": -led.get("mbuy", {}).get("sum", 0),
                    "burned": -(led.get("mbuy", {}).get("sum", 0) + led.get("msell", {}).get("sum", 0)),
                    "listed": db.q("SELECT COUNT(*) c FROM gifts WHERE listed IS NOT NULL AND sold IS NULL", one=True)["c"]},
         "rate": rate, "active": active, "rate_base": COIN_XP, "rate_max": BTC_RATE_MAX, "box": gift_box_price(db, econ(db)),
         "catalog": len(GIFTS)}
    _SITE_ECON.update(t=now, v=v, db=db)
    return v


def econ_charts(db, sids, where, args, balance):
    """Графики «Экономики» за ECON_DAYS дней: по дням — пришло (труд, бонусы, начисления, продажи) и ушло (покупки,
    улучшения, снятия, штрафы), биткоинов на руках (от нынешнего остатка назад), куплено и улучшено подарков, сделки
    на рынке, самый дорогой курс за день (индекс цен и кошельки всего сайта — в market_hist)."""
    now = time.time()
    days = [(datetime.now().date() - timedelta(days=i)).isoformat() for i in range(ECON_DAYS - 1, -1, -1)]
    row = {d: {"d": d, "work": 0.0, "fines": 0, "grant": 0, "sell": 0, "msell": 0, "gift": 0, "upgrade": 0, "take": 0, "mbuy": 0,
               "stipend": 0, "storage": 0, "n_gift": 0, "n_upgrade": 0, "n_market": 0} for d in days}
    for sid in sids:
        for d, (v, f) in game_summary(db, sid, brief=True).get("btc_days", {}).items():
            if d in row:
                row[d]["work"] += v
                row[d]["fines"] += f
    for r in db.q(f"""SELECT date(c.ts, 'unixepoch', 'localtime') AS d, c.reason, SUM(c.delta) AS s, COUNT(*) AS n
                      FROM coins c JOIN students s ON s.id = c.student_id WHERE c.ts > ? AND {where} GROUP BY d, c.reason""",
                  (now - (ECON_DAYS + 1) * 86400,) + args):
        x = row.get(r["d"])
        if x is None or r["reason"] not in x:
            continue
        x[r["reason"]] += abs(r["s"] or 0)
        if r["reason"] in ("gift", "upgrade"):
            x["n_" + r["reason"]] += r["n"]
        if r["reason"] == "mbuy":
            x["n_market"] += r["n"]
    _rates_load(db)
    out = []
    for d in days:
        x = row[d]
        x["in"] = round(x["work"] + x["grant"] + x["sell"] + x["msell"] + x["stipend"])
        x["out"] = round(x["gift"] + x["upgrade"] + x["take"] + x["mbuy"] + x["fines"] + x["storage"])
        t0 = time.mktime(datetime.strptime(d, "%Y-%m-%d").timetuple())
        x["rate"] = max(btc_rate_at(db, t0 + h * 3600) for h in range(24))
        out.append(x)
    bal = balance                                   # на руках к концу дня: от сегодняшнего остатка назад по дням
    for x in reversed(out):
        x["balance"] = max(0, round(bal))
        bal -= x["in"] - x["out"]
    return {"days": out}


_MKT = {"t": 0.0, "v": None, "db": None}
AVG_GIFT = sum(g[3] for g in GIFTS) / len(GIFTS)      # средняя каталожная цена подарка — «заданий на средний подарок»


def market_hist(db, fresh=False):
    """Графики рынка всего сайта (как в модели экономики): по дням за ECON_DAYS и по неделям за HIST_DAYS — средний и
    медианный кошелёк активных учеников (решали что-то за 30 дней), индекс цен и множитель заработка, заданий на средний
    подарок, покупки, комиссия рынка и банк; события — раздачи учителей, плата за хранение, стипендии, пополнения банка,
    ручные настройки, лимитки. Кошельки прошлых дней восстанавливаются от нынешних назад по движениям. Раз в 10 минут."""
    now = time.time()
    if not fresh and _MKT["v"] and _MKT["db"] is db and now - _MKT["t"] < 600:
        return _MKT["v"]
    today = datetime.now().date()
    days = [(today - timedelta(days=k)).isoformat() for k in range(HIST_DAYS - 1, -1, -1)]
    pos = {d: k for k, d in enumerate(days)}
    cut = time.mktime(datetime.strptime(days[0], "%Y-%m-%d").timetuple())
    end_ts = lambda d: time.mktime(datetime.strptime(d, "%Y-%m-%d").timetuple()) + 86399
    dq = lambda sql, *a: db.q(sql.replace("{D}", "date(ts, 'unixepoch', 'localtime')"), a)
    studs = [r["id"] for r in db.q("SELECT id FROM students WHERE COALESCE(is_teacher, 0) = 0")]
    teach = {r["id"] for r in db.q("SELECT id FROM students WHERE COALESCE(is_teacher, 0) = 1")}
    led, act = {}, {}
    for r in dq("SELECT student_id, {D} AS d, SUM(delta) AS s FROM coins WHERE ts >= ? GROUP BY student_id, d", cut):
        led.setdefault(r["student_id"], {})[r["d"]] = r["s"]
    for r in dq("SELECT student_id, {D} AS d FROM attempts WHERE ts >= ? GROUP BY student_id, d", cut - 30 * 86400):
        act.setdefault(r["student_id"], set()).add(r["d"])
    n = len(days)
    wallets = [[] for _ in days]
    earned = [0.0] * n
    for sid in studs:
        if sid not in act:
            continue                                   # ни разу не решал за полгода — в средний кошелёк не входит
        g = game_summary(db, sid, brief=True)
        bd, ld, mine = g.get("btc_days", {}), led.get(sid, {}), act[sid]
        bal = g.get("coins_raw", g["coins"])           # без обрезки нулём: штрафы могли увести счёт в минус
        alive = sorted(mine)
        for k in range(n - 1, -1, -1):
            d = days[k]
            e, f = bd.get(d, (0, 0))
            earned[k] += e
            # активен в день d: решал что-то за 30 дней по этот день включительно
            lo = (today - timedelta(days=n - 1 - k + 29)).isoformat()
            j = bisect.bisect_right(alive, d)
            if j and alive[j - 1] >= lo:
                wallets[k].append(max(0, bal))
            bal -= e - f + ld.get(d, 0)                 # к концу прошлого дня: минус всё, что пришло и ушло за этот
    tasks, buys, deals, ups = [0] * n, [0] * n, [0] * n, [0] * n
    for r in dq("SELECT student_id, {D} AS d, COUNT(*) AS c FROM attempts WHERE ts >= ? AND score > 0 AND COALESCE(exam, 0) = 0 GROUP BY student_id, d", cut):
        if r["d"] in pos and r["student_id"] not in teach:
            tasks[pos[r["d"]]] += r["c"]
    for r in dq("SELECT {D} AS d, COUNT(*) AS c FROM gifts WHERE ts >= ? AND from_sid IS NOT NULL GROUP BY d", cut):
        if r["d"] in pos:
            buys[pos[r["d"]]] = r["c"]
    for r in dq("SELECT {D} AS d, reason, COUNT(*) AS c FROM coins WHERE ts >= ? AND reason IN ('mbuy', 'upgrade') GROUP BY d, reason", cut):
        if r["d"] in pos:
            (deals if r["reason"] == "mbuy" else ups)[pos[r["d"]]] = r["c"]
    hist = {r["day"]: r for r in db.q("SELECT day, idx, s_avg, s_med FROM econ_hist WHERE day >= ?", (days[0],))}
    thermo_load(db)
    th = db.q("SELECT ts, idx, earn, fee FROM thermo ORDER BY ts")
    th_ts = [r["ts"] for r in th]
    bank_rows = db.q("SELECT ts, delta FROM bank ORDER BY ts")
    bank_ts, bank_sum, acc = [], [], 0
    for r in bank_rows:
        acc += r["delta"]
        bank_ts.append(r["ts"])
        bank_sum.append(acc)
    # события по дням: раздачи, хранение, стипендии, пополнение и изъятие банка, ручные настройки
    ev = {}
    add_ev = lambda d, t: ev.setdefault(d, []).append(t) if d in pos else None
    for r in dq("SELECT {D} AS d, SUM(delta) AS s, COUNT(DISTINCT student_id) AS c FROM coins WHERE ts >= ? AND reason='grant' GROUP BY d", cut):
        add_ev(r["d"], f"раздача +{r['s']} ₿ ({r['c']} уч.)")
    names = {"storage": "плата за хранение +{} ₿ в банк", "stipend": "стипендия −{} ₿ из банка", "mint": "банк пополнен на {} ₿",
             "burn": "из банка изъято {} ₿"}
    for r in dq("SELECT {D} AS d, reason, SUM(delta) AS s FROM bank WHERE ts >= ? AND reason IN ('storage', 'stipend', 'mint', 'burn') GROUP BY d, reason", cut):
        add_ev(r["d"], names[r["reason"]].format(abs(r["s"])))
    for r in dq("SELECT DISTINCT {D} AS d FROM thermo WHERE ts >= ? AND who LIKE 'teacher%'", cut):
        add_ev(r["d"], "ручная настройка рычагов")
    spans = []
    for r in db.q("SELECT gift, start, stop FROM limited WHERE stop >= ? ORDER BY start", (cut,)):
        if r["gift"] in GIFT_BY:
            a = time.strftime("%Y-%m-%d", time.localtime(max(r["start"], cut)))
            b = time.strftime("%Y-%m-%d", time.localtime(min(r["stop"], now)))
            spans.append({"a": a, "b": b, "t": f"лимитка {GIFT_BY[r['gift']][1]}"})
    rows = []
    for k, d in enumerate(days):
        w = sorted(wallets[k])
        m = len(w)
        avg = sum(w) / m if m else None
        med = (w[m // 2] + w[(m - 1) // 2]) / 2 if m else None
        t = end_ts(d)
        j = bisect.bisect_right(th_ts, t) - 1
        if d in hist and hist[d]["idx"] is not None:
            idx = hist[d]["idx"]
        elif j >= 0:
            idx = th[j]["idx"]
        else:                                          # до термостата и до истории индекса — по прежнему правилу
            idx = min(ECON_MAX, max(1.0, round((avg or 0) / ECON_TARGET * 20) / 20)) if m else None
        b = bisect.bisect_right(bank_ts, t) - 1
        rows.append({"d": d, "avg": avg, "med": med, "n": m, "idx": idx, "earn": th[j]["earn"] if j >= 0 else 1.0,
                     "savg": hist[d]["s_avg"] if d in hist else None, "smed": hist[d]["s_med"] if d in hist else None,
                     "fee": th[j]["fee"] if j >= 0 else MARKET_FEE, "bank": bank_sum[b] if b >= 0 else None,
                     "tasks": tasks[k], "earned": earned[k], "buys": buys[k], "deals": deals[k], "ups": ups[k], "ev": ev.get(d, [])})

    def pack(x, tasks_n, earned_n):
        per = earned_n / tasks_n if tasks_n else 0
        return {"d": x["d"], "avg": None if x["avg"] is None else round(x["avg"]), "med": None if x["med"] is None else round(x["med"]),
                "savg": None if x["savg"] is None else round(x["savg"]), "smed": None if x["smed"] is None else round(x["smed"]),
                "n": x["n"], "idx": x["idx"], "earn": x["earn"], "fee": x["fee"], "bank": x["bank"],
                "afford": round(AVG_GIFT * x["idx"] / per, 1) if per > 0 and x["idx"] else None,
                "tasks": tasks_n, "earned": round(earned_n)}

    day_rows = [dict(pack(x, x["tasks"], x["earned"]), buys=x["buys"], deals=x["deals"], ups=x["ups"], ev=x["ev"]) for x in rows[-ECON_DAYS:]]
    week_rows = []
    for k in range(0, n, 7):                          # недели — от сегодняшнего дня назад по 7 дней
        part = rows[max(0, n - k - 7):n - k]
        if not part:
            continue
        last = part[-1]
        week_rows.append(dict(pack(dict(last, d=part[0]["d"]), sum(x["tasks"] for x in part), sum(x["earned"] for x in part)),
                              to=last["d"], buys=sum(x["buys"] for x in part), deals=sum(x["deals"] for x in part),
                              ups=sum(x["ups"] for x in part), ev=[e for x in part for e in x["ev"]]))
    week_rows.reverse()
    target = econ_target(db)
    v = {"day": day_rows, "week": week_rows, "spans": spans, "target": target, "band": [round(0.8 * target), round(1.2 * target)],
         "avg_gift": round(AVG_GIFT)}
    _MKT.update(t=now, v=v, db=db)
    return v


BANK_WHY = {"start": "🏦 Стартовый капитал", "labor": "⚒ Половина заработка учеников", "fee": "🏪 Комиссия рынка",
            "ops": "🎁 Комиссия с подарков", "box": "🎲 Случайные подарки", "storage": "📦 Плата за хранение",
            "take": "➖ Снял учитель",
            "mint": "➕ Пополнение банка", "grant": "🎁 Начислил учитель", "stipend": "🎓 Стипендия", "burn": "🔥 Изъято из банка"}


def thermo_info(db, T):
    """Термостат и банк для панели учителя: рычаги сейчас и куда их тянет, история настроек, банк и его журнал.
    Имена учеников в журнале — только тех, кого учитель видит; другие учителя — без имён."""
    e = econ(db)
    main_id = main_teacher()["id"]
    is_main = bool(T["is_main"])
    bank_rows = []
    for r in db.q("""SELECT b.ts, b.delta, b.reason, b.note, b.teacher_id, s.name AS sname, s.teacher_id AS stid, t.name AS tname
                     FROM bank b LEFT JOIN students s ON s.id = b.student_id LEFT JOIN teachers t ON t.id = b.teacher_id
                     WHERE b.reason NOT IN ('ops', 'box', 'labor') ORDER BY b.ts DESC, b.id DESC LIMIT 80"""):
        mine_st = r["sname"] and (is_main or (r["stid"] or main_id) == T["id"])
        who = (r["tname"] if is_main else "вы" if r["teacher_id"] == T["id"] else "другой учитель") if r["teacher_id"] else ""
        bank_rows.append({"ts": r["ts"], "delta": r["delta"], "kind": r["reason"], "t": BANK_WHY.get(r["reason"], r["reason"]),
                          "note": r["note"] or "", "who": who, "student": short_name(r["sname"]) if mine_st else ""})
    # комиссия с подарков и «🎲» — с каждой покупки: в журнале одной строкой за день
    for r in db.q("""SELECT date(ts, 'unixepoch', 'localtime') AS d, reason, MAX(ts) AS ts, SUM(delta) AS s, COUNT(*) AS c FROM bank
                     WHERE reason IN ('ops', 'box') GROUP BY d, reason ORDER BY d DESC LIMIT 120"""):
        bank_rows.append({"ts": r["ts"], "delta": r["s"], "kind": r["reason"], "t": BANK_WHY[r["reason"]],
                          "note": f"за день, {'покупок' if r['reason'] == 'box' else 'операций'}: {r['c']}", "who": "", "student": ""})
    # половина заработка учеников — строкой за день (note — день, за который начислено)
    for r in db.q("""SELECT note AS d, MAX(ts) AS ts, SUM(delta) AS s FROM bank WHERE reason = 'labor'
                     GROUP BY note ORDER BY note DESC LIMIT 60"""):
        if r["s"]:
            bank_rows.append({"ts": r["ts"], "delta": r["s"], "kind": "labor", "t": BANK_WHY["labor"],
                              "note": f"за {r['d'][8:10]}.{r['d'][5:7]}: ученики заработали ≈ {round(r['s'] / LABOR_BANK)} ₿",
                              "who": "", "student": ""})
    bank_rows = sorted(bank_rows, key=lambda x: -x["ts"])[:80]
    sums = {r["reason"]: r["s"] for r in db.q("SELECT reason, SUM(delta) s FROM bank GROUP BY reason")}
    levers = [{"ts": r["ts"], "idx": r["idx"], "earn": r["earn"], "fee": r["fee"], "tax": r["tax"], "r": r["r"],
               "who": "термостат" if r["who"] == "auto" else "запуск" if r["who"] == "start" else "главный учитель"}
              for r in db.q("SELECT * FROM thermo ORDER BY ts DESC LIMIT 30")]
    return {"econ": e, "goal": thermo_goal(e["avg"], e["med"], e["target"]) if e["target"] else None, "is_main": is_main,
            "bank": {"balance": e["bank"], "sums": sums, "log": bank_rows}, "levers": levers, "set": THERMO_SET,
            "rules": {"step": THERMO_STEP, "idx": [IDX_MIN, IDX_MAX], "earn": [EARN_MIN, EARN_MAX], "fee": [FEE_MIN, FEE_MAX],
                      "tax": TAX_RATE, "tax_from": TAX_FROM, "stipend_r": STIPEND_R, "stipend_max": STIPEND_MAX, "labor": LABOR_BANK,
                      "stipend_tasks": STIPEND_TASKS, "limited_r": LIMITED_R, "limited_cap": LIMITED_CAP, "limited_price": LIMITED_PRICE},
            "limited": limited_now(db), "limited_all": [{"id": k, "i": i, "t": t} for k, i, t in LIMITED],
            "promo": promo_get(db), "promo_now": promo_now(db), "promo_max": PROMO_MAX}


def econ_wallet(db, sid):
    """Кошелёк ученика: откуда пришли биткоины и куда ушли."""
    g = game_summary(db, sid, brief=True)
    led = {r["reason"]: r["s"] for r in db.q("SELECT reason, SUM(delta) s FROM coins WHERE student_id=? GROUP BY reason", (sid,))}
    return {"balance": g["coins"], "mined": g["mined"], "exam": g["exam_coins"], "task": g["task_coins"],
            "grant": led.get("grant", 0), "sell": led.get("sell", 0), "mkt_in": led.get("msell", 0), "mkt_out": -led.get("mbuy", 0),
            "take": -led.get("take", 0), "gift": -led.get("gift", 0), "upgrade": -led.get("upgrade", 0),
            "stipend": led.get("stipend", 0), "storage": -led.get("storage", 0),
            "fines": g["btc_fast"] * BTC_FAST_FINE, "xp": g["xp"]}


def gift_random(rng=None):
    """Случайный подарок: выпасть может любой, но чем дороже — тем реже (вес ∝ 1 / цена)."""
    return (rng or random).choices(GIFTS, weights=[1 / g[3] for g in GIFTS])[0]


def gift_uniq(db, gid, rng=None):
    """Уникальный вид для подарка gid: номер по порядку и неповторимое для этого вида сочетание фона, узора и эффекта.
    Вызывать под _GIFT_LOCK — иначе два улучшения разом получили бы один номер."""
    rng = rng or random.SystemRandom()
    taken, n = set(), 0
    for r in db.q("SELECT uniq FROM gifts WHERE gift=? AND uniq IS NOT NULL", (gid,)):
        try:
            u = json.loads(r["uniq"])
            taken.add((u["bg"], u["sym"], u["fx"], u.get("pose", "stand")))
            n = max(n, int(u["n"]))
        except (ValueError, TypeError, KeyError):
            continue
    pick = lambda xs, w: rng.choices(xs, weights=[x[w] for x in xs])[0][0]
    for _ in range(300):
        combo = (pick(UNIQ_BG, 4), pick(UNIQ_SYM, 3), pick(UNIQ_FX, 2), pick(UNIQ_POSE, 2))
        if combo not in taken:
            break
    return {"n": n + 1, "bg": combo[0], "sym": combo[1], "fx": combo[2], "pose": combo[3], "ts": time.time()}


def uniq_pub(raw):
    """Уникальный подарок для страницы: номер и свойства с редкостью в процентах."""
    try:
        u = json.loads(raw) if isinstance(raw, str) else raw
        bg, sym, fx = _UNIQ["bg"][u["bg"]], _UNIQ["sym"][u["sym"]], _UNIQ["fx"][u["fx"]]
        pose = _UNIQ["pose"][u.get("pose", "stand")]          # у улучшенных до появления позы — классика
    except (ValueError, TypeError, KeyError):
        return None
    share = lambda w, xs, k: w / sum(x[k] for x in xs)
    parts = [("Фон", bg[1], share(bg[4], UNIQ_BG, 4)), ("Узор", sym[1], share(sym[3], UNIQ_SYM, 3)),
             ("Эффект", fx[1], share(fx[2], UNIQ_FX, 2)), ("Поза", pose[1], share(pose[2], UNIQ_POSE, 2))]
    chance = math.prod(x[2] for x in parts)                  # шанс именно такого сочетания при улучшении
    k, t = rarity_tier(chance, UNIQ_RARITY)
    return {"n": u["n"], "c1": bg[2], "c2": bg[3], "ch": sym[2], "fx": fx[0], "pose": pose[0],
            "rar": {"k": k, "t": t, "one_in": round(1 / chance)},
            "props": [{"k": a, "t": b, "p": round(100 * c, 1)} for a, b, c in parts]}


def gift_icons(db, sid):
    """Подарки у ника: сначала уникальные (каждый отдельно, с номером), потом обычные — разные, последний полученный первым,
    одинаковые — числом."""
    out = []
    for r in db.q("SELECT gift, uniq FROM gifts WHERE student_id=? AND uniq IS NOT NULL AND sold IS NULL ORDER BY ts DESC", (sid,)):
        g, u = GIFT_BY.get(r["gift"]), uniq_pub(r["uniq"])
        if g and u:
            out.append({"i": g[1], "t": f"{g[2]} #{u['n']} · {u['rar']['t']} · " + ", ".join(x["t"] for x in u["props"]), "n": 0,
                        "u": {"c1": u["c1"], "c2": u["c2"], "fx": u["fx"], "pose": u["pose"], "r": u["rar"]["k"]}})
    for r in db.q("""SELECT gift, COUNT(*) c, MAX(ts) t FROM gifts WHERE student_id=? AND uniq IS NULL AND sold IS NULL
                     GROUP BY gift ORDER BY t DESC""", (sid,)):
        g = GIFT_BY.get(r["gift"])
        if g:
            out.append({"i": g[1], "t": f"Подарок: {g[2]} · {gift_rarity(g[0])['t']}", "n": r["c"] if r["c"] > 1 else 0})
    return out[:GIFTS_SHOW]


def gift_rows(db, sid, where="", limit=200, prices=None):
    """Подарки ученика (непроданные) для страницы: что, от кого, когда, улучшен ли; prices=(econ, выпуск) — ещё и цены
    улучшения и продажи сейчас."""
    rows = db.q(f"""SELECT g.id, g.gift, g.ts, g.note, g.seen, g.from_sid, g.from_teacher, g.uniq, g.kind, g.listed, g.market_from,
                           g.paid, g.up_base, g.listed_ts, s.name AS sname, m.name AS mname
                    FROM gifts g LEFT JOIN students s ON s.id = g.from_sid LEFT JOIN students m ON m.id = g.market_from
                    WHERE g.student_id=? AND g.sold IS NULL {where} ORDER BY g.ts DESC LIMIT ?""", (sid, limit))
    out = []
    typ = market_typical(db) if prices else {}
    for r in rows:
        g = GIFT_BY.get(r["gift"])
        if not g:
            continue
        frm = ("учитель" if r["from_teacher"] else "труд" if r["kind"] == "work" else "сам себе" if r["from_sid"] == sid
               else short_name(r["sname"]) if r["sname"] else "")
        u = uniq_pub(r["uniq"]) if r["uniq"] else None
        row = {"id": r["id"], "gift": g[0], "i": g[1], "t": g[2], "ts": r["ts"], "note": r["note"] or "", "from": frm,
               "uniq": u, "rar": gift_rarity(g[0]), "listed": r["listed"], "limited": g[0] in LIMITED_BY,
               "box": r["kind"] == "box" and r["market_from"] is None,
               "market": short_name(r["mname"]) if r["market_from"] and r["mname"] else None}
        if prices:
            e, issued, dem = prices
            up_now = gift_up_price(g[0], e, issued)          # сколько сейчас стоит улучшение такого подарка (None — тираж кончился)
            row.update(up=None if u else up_now, up_now=up_now, sell=gift_sell_price(g[0], u, e, issued, dem, r["paid"], r["up_base"]),
                       fee=market_fee(e, r), issued=issued.get(g[0], 0), cap=UNIQ_CAP, ub=r["up_base"],
                       mk_max=market_cap(g[0], u, e, dem, r["up_base"]), mk_typ=typ.get(market_key(g[0], u)),
                       mk_until=r["listed_ts"] + MARKET_DAYS * 86400 if r["listed"] is not None and r["listed_ts"] else None)
        out.append(row)
    return out


def gift_value(rows, e, dem):
    """Оценка подарков (строки gift_rows с ценами): sell — сколько дадут, если продать всё сейчас; shop — сколько такие
    стоят в магазине (нынешняя цена, у уникального — плюс улучшение); top — три самых ценных."""
    top = sorted(rows, key=lambda r: -r["sell"])[:3]
    return {"n": len(rows), "sell": sum(r["sell"] for r in rows),
            "shop": sum(gift_price(r["gift"], e, dem) + (gift_up_base(r["gift"], e, r.get("ub")) if r["uniq"] else 0) for r in rows),
            "top": [{k: r[k] for k in ("id", "gift", "i", "t", "uniq", "rar", "sell")} for r in top]}


# Forbes класса: среди учеников одного учителя. Состояние = биткоины + оценка подарков (сколько дадут, если продать все сейчас);
# вкладки — самый дорогой подарок, самая дорогая коллекция (только подарки) и самая редкая коллекция (очки редкости).
FORBES_TOP = 10
FORBES_NEW_DAYS = 14                    # «новичок» — в тренажёре меньше двух недель
RARE_SCORE = {"common": 0, "uncommon": 0.5, "rare": 1, "epic": 2, "legend": 3, "limited": 8,
              "u:rare": 4, "u:epic": 10, "u:legend": 30, "u:myth": 100}
_FORBES = {}                            # учитель → (когда, база, данные)


def gift_rk(g):
    """Ключ редкости подарка: уникальный — «u:уровень», лимитка — limited, обычный — его уровень."""
    return ("u:" + g["uniq"]["rar"]["k"]) if g.get("uniq") else g["rar"]["k"]


def rare_score(g):
    """Очки редкости подарка: по уровню (RARE_SCORE); у уникального — ещё × √(каталожная цена / средняя по каталогу): мифическая
    печенька (улучшение — 100 ₿) весит меньше мифического замка."""
    s = RARE_SCORE.get(gift_rk(g), 0)
    return s * (GIFT_BY[g["gift"]][3] / AVG_GIFT) ** 0.5 if g.get("uniq") else s


def gift_tile(g):
    """Подарок для плитки (без свойств уникального — их видно в профиле): значок, название, номер, фон, редкость, оценка."""
    u = g.get("uniq")
    return {"gift": g["gift"], "i": g["i"], "t": g["t"], "rar": g["rar"], "sell": g.get("sell", 0),
            "uniq": {k: u[k] for k in ("n", "c1", "c2", "ch", "fx", "pose", "rar")} if u else None}


def forbes_data(db, tid, e=None):
    """Forbes учеников учителя tid (пересчёт раз в 10 минут): все с биткоинами или подарками — состояние, рост за неделю (по снимкам
    forbes_hist), лучшие подарки, редкость коллекции; сегодняшний снимок записывается."""
    now = time.time()
    hit = _FORBES.get(tid)
    if hit and hit[1] is db and now - hit[0] < 600:
        return hit[2]
    e = e or econ(db)
    issued, dem = uniq_issued(db), gift_demand(db)
    studs = teacher_students(db, tid)
    created = {r["id"]: r["created"] or 0 for r in db.q("SELECT id, created FROM students WHERE COALESCE(is_teacher, 0) = 0")}
    rows = []
    for m in studs:
        wallet = game_summary(db, m["id"], brief=True)["coins"]
        gifts = gift_rows(db, m["id"], prices=(e, issued, dem))
        if not wallet and not gifts:
            continue
        gifts.sort(key=lambda g: -g["sell"])
        rarest = max(gifts, key=lambda g: (rare_score(g), (g["uniq"] or {}).get("rar", {}).get("one_in", 0)), default=None)
        tiers = {}
        for g in gifts:
            tiers[gift_rk(g)] = tiers.get(gift_rk(g), 0) + 1
        value = sum(g["sell"] for g in gifts)
        rows.append({"sid": m["id"], "name": short_name(m["name"]), "wallet": wallet, "value": value, "total": wallet + value,
                     "n": len(gifts), "tops": [gift_tile(g) for g in gifts[:4]], "best": gift_tile(gifts[0]) if gifts else None,
                     "avatar": gift_tile(rarest) if rarest and rarest["uniq"] else None, "rarest": gift_tile(rarest) if rarest else None,
                     "score": round(sum(rare_score(g) for g in gifts), 1), "tiers": tiers,
                     "new": now - created.get(m["id"], 0) < FORBES_NEW_DAYS * 86400, "_gifts": gifts})
    # снимок сегодня и рост за неделю: от самого раннего снимка за последние 7 дней (без сегодняшнего)
    today = datetime.fromtimestamp(now).date()
    for r in rows:
        db.x("INSERT OR REPLACE INTO forbes_hist(day, student_id, total) VALUES(?,?,?)", (today.isoformat(), r["sid"], r["total"]))
    then = {}
    for h in db.q("SELECT day, student_id, total FROM forbes_hist WHERE day >= ? AND day < ? ORDER BY day DESC",
                  ((today - timedelta(days=7)).isoformat(), today.isoformat())):
        then[h["student_id"]] = h["total"]           # по убыванию дня — останется самый ранний
    for r in rows:
        r["week"] = r["total"] - then[r["sid"]] if r["sid"] in then else None
    rocket = max((r for r in rows if (r["week"] or 0) > 0), key=lambda r: r["week"], default=None)
    for r in rows:
        r["rocket"] = r is rocket
    gifts = sorted(({**gift_tile(g), "sid": r["sid"], "owner": r["name"]} for r in rows for g in r["_gifts"]), key=lambda g: -g["sell"])
    for r in rows:
        del r["_gifts"]
    v = {"rows": rows, "gifts": gifts[:FORBES_TOP], "sum": sum(r["total"] for r in rows), "count": len(rows),
         "month": ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"][today.month - 1]}
    _FORBES[tid] = (now, db, v)
    return v


def forbes_view(data, me):
    """Списки для ученика me: по состоянию, коллекции и редкости — первые FORBES_TOP и он сам, если ниже."""
    def top(key):
        ordered = sorted(data["rows"], key=lambda r: (-r[key], r["name"]))
        out = [dict(r, rank=k + 1, me=r["sid"] == me) for k, r in enumerate(ordered)]
        return out[:FORBES_TOP] + [r for r in out[FORBES_TOP:] if r["me"]]
    coll = [r for r in top("value") if r["n"]]
    rare = [r for r in top("score") if r["n"]]
    return {"rich": top("total"), "coll": coll, "rare": rare, "gifts": [dict(g, me=g["sid"] == me) for g in data["gifts"]],
            "sum": data["sum"], "count": data["count"], "month": data["month"]}


def market_rows(db, sids, me, e, issued, dem):
    """Подарки на рынке у учеников sids (одноклассники и сам): новые сверху. Для сравнения — цена в магазине
    (у уникального — с улучшением) и сколько дали бы при продаже сразу."""
    if not sids:
        return []
    rows = db.q(f"""SELECT g.id, g.gift, g.uniq, g.listed, g.listed_ts, g.student_id, g.paid, g.up_base, s.name FROM gifts g JOIN students s ON s.id = g.student_id
                    WHERE g.listed IS NOT NULL AND g.sold IS NULL AND g.student_id IN ({','.join('?' * len(sids))})
                    ORDER BY g.listed_ts DESC LIMIT 200""", sids)
    out, typ = [], market_typical(db)
    for r in rows:
        g = GIFT_BY.get(r["gift"])
        if not g:
            continue
        u = uniq_pub(r["uniq"]) if r["uniq"] else None
        out.append({"id": r["id"], "gift": g[0], "i": g[1], "t": g[2], "uniq": u, "rar": gift_rarity(g[0]), "price": r["listed"],
                    "ts": r["listed_ts"], "until": (r["listed_ts"] or 0) + MARKET_DAYS * 86400, "mine": r["student_id"] == me,
                    "seller": short_name(r["name"]), "shop": gift_price(g[0], e, dem) + (gift_up_base(g[0], e, r["up_base"]) if u else 0),
                    "typ": typ.get(market_key(g[0], u)), "quick": gift_sell_price(g[0], u, e, issued, dem, r["paid"], r["up_base"])})
    return out


# ---------------------------------------------------------------- награды профиля
# повторяемые награды — со счётчиком; достижения (ACHIEVEMENTS) даются один раз
AWARDS = [("crown", "👑", "Корона дня", "Быстрее всех решил задание дня"),
          ("league1", "🏆", "Победитель лиги", "1-е место в своей лиге по итогам недели"),
          ("up", "🚀", "Повышение", "Перешёл в лигу выше"),
          ("duel", "⚔️", "Победа в дуэли", "Выиграл дуэль"),
          ("tour1", "🎖", "Победитель турнира", "1-е место в турнире"),
          ("season1", "🏅", "Чемпион сезона", "1-е место в сезоне турниров (месяц)"),
          ("season2", "🥈", "Призёр сезона", "2-е место в сезоне турниров"),
          ("season3", "🥉", "Призёр сезона", "3-е место в сезоне турниров")]
BADGES_MAX = 3


def crown_counts(db, ids):
    """Сколько раз у каждого была 👑: дни до сегодняшнего, когда он быстрее всех (из этих учеников) решил задание дня."""
    if not ids:
        return {}
    best = {}
    today = datetime.now().date().isoformat()
    for r in db.q(f"SELECT day, student_id, ms, ts FROM daily_results WHERE day<? AND COALESCE(fast, 0)=0 "
                  f"AND student_id IN ({','.join('?' * len(ids))})",
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


def rank_score(xp, btc, tasks, err):
    """Очки рейтинга за период: (XP + заработанные ₿) / 2 × (1 − доля заданий с ошибками). Ошибка — неверный ответ,
    решение со 2-й попытки или «Показать ответ» хотя бы раз в этом задании за период."""
    btc = max(0, math.floor(btc))
    acc = 1 - err / tasks if tasks else 1.0
    return {"xp": max(0, xp), "btc": btc, "tasks": tasks, "err": err, "acc": round(100 * acc),
            "score": max(0, round((max(0, xp) + btc) / 2 * acc))}


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
    rate, _ = btc_rate_now(db)                     # курс биткоина: раз в минуту — сколько учеников занимается сейчас
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
                          "stubborn", "peek", "snail", "perfect", "binge", "best_binge", "lucky", "dejavu", "btc_fast")}
    prev_day = None
    fails_of, solves_of = {}, {}        # задание → сколько раз не вышло / решено
    lunch_of, nums_of, ans_of, bad_of = {}, {}, {}, {}   # по дням
    binge_n, seen27 = None, False
    nums, per_day, days = set(), {}, set()
    got = {}

    wk0 = week_start(now)
    xp_wk = 0
    fast_since = fast_xp_since(db)
    btc_since = btc_fast_since(db)

    xplog = []                                     # последние изменения опыта с причиной — показываем ученику

    mined_xp = {}                                  # (курс биткоина — XP за 1 ₿, множитель заработка) → опыт, заработанный так
    day_cut = now - (HIST_DAYS + 1) * 86400
    btc_days, fine_days = {}, {}                   # день → заработано ₿ (дробно) и штрафов — для графиков учителя
    dkey = lambda ts: time.strftime("%Y-%m-%d", time.localtime(ts))

    # рейтинг по периодам: заработанные ₿ и задания (всего и с ошибками) — очки = (XP + ₿) / 2 × доля заданий без ошибок
    rank_win = dict({"day": (day0, float("inf")), "week": (week0, float("inf")), "month": (month0, float("inf")),
                     "wk": (wk0, float("inf"))}, **windows)
    rank_btc = {k: Fraction(0) for k in rank_win}
    rank_seen, rank_err = {k: set() for k in rank_win}, {k: set() for k in rank_win}

    def earn(v, ts):
        if ts >= day_cut:
            btc_days[dkey(ts)] = btc_days.get(dkey(ts), 0) + v
        for k, (a, b) in rank_win.items():
            if a <= ts < b:
                rank_btc[k] += v

    def gain(v, ts, why=None, boost=None):
        nonlocal xp, week, xp_day, xp_month, xp_wk
        if v > 0 and cheat and cheat[0] <= ts < cheat[1]:
            if why:
                xplog.append((ts, 0, why + " — срезано: накрутка"))
            return                                 # опыт, набранный пока пользовался лазейкой, — срезан целиком
        if why:
            xplog.append((ts, v, why))
        xp += v
        k, m = btc_rate_at(db, ts), earn_at(db, ts)   # биткоины — по курсу и множителю термостата на момент заработка
        if boost and v > 0:
            m *= promo_mult(db, ts, boost)              # (и акции — за задания или вариант):
        mined_xp[(k, m)] = mined_xp.get((k, m), 0) + v  # их смена прошлое не трогает
        earn(Fraction(v, k) * m, ts)
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
    task_btc, task_since = Fraction(0), setting_since(db, "task_btc_since")
    for r, skip in zip(rows, skips):
        for k, (a, b) in rank_win.items():              # для рейтинга: каждое задание периода, ошибся ли в нём
            if a <= r["ts"] < b:
                rank_seen[k].add(r["task_id"])
                if (r["score"] or 0) < 1:
                    rank_err[k].add(r["task_id"])
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
        fun = ACH_CLOCK(ts)                    # час, день недели и дата — для «забавных» достижений
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
            if 12 <= fun.tm_hour < 14:
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
            if fun.tm_hour == 0 and fun.tm_min < 5:
                cnt["cinderella"] = 1
            if fun.tm_wday == 4 and fun.tm_mday == 13:
                cnt["fri13"] = 1
            if fun.tm_mon == 3 and fun.tm_mday == 14:
                cnt["pi"] = 1
            if (fun.tm_mon, fun.tm_mday) in ((12, 31), (1, 1)):
                cnt["newyear"] = 1
            # решено слишком быстро (быстрее минуты, №24–27 — быстрее HARD_MIN_MS) — похоже на подсмотренный ответ:
            # вместо опыта −1 XP, задание не считается решённым; быстрее 30 секунд, а у №24–27 — всегда, ещё и −1 ₿
            lim = answer_min_ms(r["n"], ts)
            fast = r["spent_ms"] is not None and r["spent_ms"] < lim and ts >= fast_since
            first_time = tid not in solved and not fast
            if fast:
                gain(FAST_XP_PENALTY, ts, f"№{r['n']} — решено быстрее {min_text(lim)}")
                if (r["spent_ms"] < BTC_FAST_MS or lim > FAST_XP_MS) and ts >= btc_since:
                    cnt["btc_fast"] += 1           # быстрее 30 секунд — ещё и −1 ₿
                    if ts >= day_cut:
                        fine_days[dkey(ts)] = fine_days.get(dkey(ts), 0) + BTC_FAST_FINE
                    for k, (a, b) in rank_win.items():
                        if a <= ts < b:
                            rank_btc[k] -= BTC_FAST_FINE
            else:
                if tid not in solved:              # опыт — только за первое решение задания, откуда бы ни пришёл ответ
                    gain(round(task_xp(r["n"], (APP.bank.tasks.get(tid) or {}).get("r")) * (1 if r["score"] == 1 else 0.5)), ts,
                         f"№{r['n']} — решено" + ("" if r["score"] == 1 else " со 2-й попытки"), "task")
                    # и бонус ₿ по номеру; самостоятельная считается целиком, как вариант (ниже)
                    if ts >= task_since and r["reason"] != WORK_REASON and not (cheat and cheat[0] <= ts < cheat[1]):
                        bonus = (TASK_BTC.get(r["n"] or 0, 0) * (1 if r["score"] == 1 else Fraction(1, 2)) * earn_at(db, ts)
                                 * promo_mult(db, ts, "task"))
                        task_btc += bonus
                        earn(bonus, ts)
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
                gain(15, ts, "5 заданий за день", "task")  # бонус за день: 5 решённых
            if fun.tm_hour >= 23:
                cnt["night"] = 1
            if fun.tm_hour < 7:
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
                         ("weekend", per_day.get(day, 0) if fun.tm_wday >= 5 else 0), ("fri13", cnt["fri13"]),
                         ("pi", cnt["pi"]), ("newyear", cnt["newyear"]), ("stubborn", cnt["stubborn"]),
                         ("peek", cnt["peek"]), ("lunch", lunch_of.get(day, 0)), ("snail", cnt["snail"]),
                         ("rainbow", len(nums_of.get(day, ()))), ("perfect", cnt["perfect"]), ("binge", cnt["best_binge"]),
                         ("lucky", cnt["lucky"])):
            if aid not in got and val >= ACH_GOAL[aid]:
                got[aid] = ts
    ex_best = 0
    exam_coins, exam_since = Fraction(0), exam_btc_since(db)
    for e in exams:
        if (e["finished"] - e["started"]) >= EXAM_MIN_SEC_FOR_XP and (e["primary_score"] or 0) > 0:
            gain(30 + 3 * (e["primary_score"] or 0), e["finished"], "вариант ЕГЭ", "exam")
            if e["finished"] >= exam_since and not (cheat and cheat[0] <= e["finished"] < cheat[1]):
                eb = exam_btc(e["test_score"]) * earn_at(db, e["finished"]) * promo_mult(db, e["finished"], "exam")   # 40+ — 15 ₿, 60+ — 30…
                exam_coins += eb
                earn(eb, e["finished"])
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
    # самостоятельные от учителя — бонус как за вариант (по результату сдачи), вместо бонуса за каждое задание
    for w in db.q("""SELECT r.finished, r.result FROM asg_runs r JOIN assignments a ON a.id = r.asg_id
                     WHERE r.student_id=? AND r.finished>=? AND a.kind='self'""", (sid, task_since)):
        if cheat and cheat[0] <= w["finished"] < cheat[1]:
            continue
        try:
            res = json.loads(w["result"] or "{}")
        except ValueError:
            continue
        wb = work_btc([((APP.bank.tasks.get(k) or {}).get("n") or 0, c or 0) for k, c in res.items()
                       if (APP.bank.tasks.get(k) or {}).get("n")]) * earn_at(db, w["finished"]) * promo_mult(db, w["finished"], "task")
        exam_coins += wb
        earn(wb, w["finished"])
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
    fz_spent = 0
    for a in db.q("SELECT ts, delta, reason FROM xp_adjust WHERE student_id=?", (sid,)):
        if (a["reason"] or "") == "freeze":
            xp += a["delta"]                       # купил заморозку огонька: опыт списан, лиги и рейтинги не трогаем
            fz_spent -= a["delta"]
            xplog.append((a["ts"], a["delta"], "заморозка огонька"))
            continue
        why = (f"турнир — {(a['reason'] or '').split(':')[-1]}-е место" if (a["reason"] or "").startswith("tour:")
               else "дуэль — победа" if a["delta"] > 0 else "дуэль — поражение")
        gain(a["delta"], a["ts"], why)
    xp = max(0, xp)
    # огонёк: дни подряд, в каждый из которых решено не меньше FIRE_NEED заданий (сегодняшний ещё может идти);
    # пропущенный день закрывает заморозка (тратится сама) или восстановление от учителя
    cover = fire_cover(db, sid)
    froze = use_freezes(db, sid, fire_days, cover)
    dropped = work_gifts(db, sid, cnt["solved"])       # каждые WORK_GIFT_EVERY решённых — подарок за труд
    fire = fire_streak(fire_days, cover)
    xp = max(0, xp)                    # штрафы за «быстрее минуты» не уводят опыт ниже нуля
    lvl, title, cur_xp, need = level_of(xp)
    # биткоины: заработанный опыт по курсу на момент заработка (покупка заморозок их не отнимает) + начисления − покупки
    mined = max(0, math.floor(sum((Fraction(v, k) * m for (k, m), v in mined_xp.items()), Fraction(0))))
    exam_coins = math.floor(exam_coins)
    extra = db.q("SELECT COALESCE(SUM(delta), 0) s FROM coins WHERE student_id=?", (sid,), one=True)["s"]
    task_btc = math.floor(task_btc)
    coins_raw = mined + exam_coins + task_btc + extra - cnt["btc_fast"] * BTC_FAST_FINE
    coins = max(0, coins_raw)
    zr = db.q("SELECT freezes FROM students WHERE id=?", (sid,), one=True)
    xp_of = dict({"day": xp_day, "week": week, "month": xp_month, "wk": xp_wk}, **sums)
    rank = {k: rank_score(xp_of[k], rank_btc[k], len(rank_seen[k]), len(rank_err[k])) for k in rank_win}
    out = {"xp": xp, "week": week, "day": xp_day, "month": xp_month, "fire": fire, "wk": max(0, xp_wk), "win": sums, "rank": rank,
           "freezes": (zr["freezes"] or 0) if zr else 0, "froze": froze, "coins": coins, "coins_raw": coins_raw, "mined": mined, "exam_coins": exam_coins, "task_coins": task_btc, "btc_rate": rate,
           "btc_days": {d: [round(float(btc_days.get(d, 0)), 2), fine_days.get(d, 0)] for d in set(btc_days) | set(fine_days)}, "btc_fast": cnt["btc_fast"], "gift_drop": dropped,
           "cover": {k: v for k, v in cover.items() if k >= (datetime.now().date() - timedelta(days=60)).isoformat()},
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
FREEZE_MAX = 4                         # заморозок огонька в запасе у ученика
FREEZE_PRICE = 500                     # цена заморозки в опыте


def fire_cover(db, sid):
    """Дни, засчитанные огоньку без трёх заданий: {день: freeze | restore}."""
    return {r["day"]: r["kind"] for r in db.q("SELECT day, kind FROM fire_cover WHERE student_id=?", (sid,))}


def fire_ok(fire_days, cover, d):
    return fire_days.get(d.isoformat(), 0) >= FIRE_NEED or d.isoformat() in cover


def fire_counts(fire_days, cover, d):
    """День прибавляет огоньку: выполнен или восстановлен учителем. День под заморозкой серию не рвёт, но и не прибавляет:
    заморозка сохраняет огонёк (было 10 — осталось 10), а не продлевает его."""
    return fire_days.get(d.isoformat(), 0) >= FIRE_NEED or cover.get(d.isoformat()) == "restore"


def fire_streak(fire_days, cover, today=None):
    """Огонёк — дней подряд с выполненным днём; сегодняшний ещё может идти, поэтому без него серия не рвётся."""
    d = today or datetime.now().date()
    if not fire_ok(fire_days, cover, d):
        d -= timedelta(days=1)
    n = 0
    while fire_ok(fire_days, cover, d):
        n += fire_counts(fire_days, cover, d)
        d -= timedelta(days=1)
    return n


def use_freezes(db, sid, fire_days, cover, today=None):
    """Пропущенные дни (до вчерашнего включительно) закрываются заморозками — если огонёк до пропуска горел
    и заморозок хватает на весь пропуск. Не хватает — серия сгорает, заморозки остаются. Возвращает, сколько потрачено."""
    row = db.q("SELECT freezes FROM students WHERE id=?", (sid,), one=True)
    have = (row["freezes"] or 0) if row else 0
    if not have:
        return 0
    d = (today or datetime.now().date()) - timedelta(days=1)
    gap = []
    while not fire_ok(fire_days, cover, d) and len(gap) <= have:
        gap.append(d)
        d -= timedelta(days=1)
    if not gap or len(gap) > have or not fire_ok(fire_days, cover, d):
        return 0
    now = time.time()
    for g in gap:
        db.x("INSERT OR IGNORE INTO fire_cover(student_id, day, kind, ts) VALUES(?,?, 'freeze', ?)", (sid, g.isoformat(), now))
        cover[g.isoformat()] = "freeze"
    db.x("UPDATE students SET freezes=MAX(0, COALESCE(freezes, 0) - ?) WHERE id=?", (len(gap), sid))
    return len(gap)


def restore_fire(db, sid, days, today=None):
    """Учитель восстанавливает огонёк (например, после сбоя сервера): недостающие дни до сегодняшнего
    помечаются «восстановлен», пока серия не станет days. Возвращает (сколько дней добавлено, огонёк теперь)."""
    rows = db.q("""SELECT task_id, grp, n, score, ts, exam, spent_ms, gave_up, reason, revealed FROM attempts
                   WHERE student_id=? ORDER BY ts, id""", (sid,))
    fire_days = {}
    for r, skip in zip(rows, reward_skips(rows, fast_xp_since(db))):    # как считает огонёк сводка
        if not skip:
            k = time.strftime("%Y-%m-%d", time.localtime(r["ts"]))
            fire_days[k] = fire_days.get(k, 0) + 1
    cover = fire_cover(db, sid)
    d = today or datetime.now().date()
    if not fire_ok(fire_days, cover, d):
        d -= timedelta(days=1)
    have, added, now = 0, 0, time.time()
    while have < days:
        if not fire_ok(fire_days, cover, d):
            db.x("INSERT OR IGNORE INTO fire_cover(student_id, day, kind, ts) VALUES(?,?, 'restore', ?)", (sid, d.isoformat(), now))
            cover[d.isoformat()] = "restore"
            added += 1
        have += fire_counts(fire_days, cover, d)      # день под заморозкой огоньку не прибавляет — его не считаем
        d -= timedelta(days=1)
    return added, fire_streak(fire_days, cover, today)

# ================================================================ соревнования
LEAGUES = [("Бронзовая лига", "🥉"), ("Серебряная лига", "🥈"), ("Золотая лига", "🥇"), ("Алмазная лига", "💎")]
LEAGUE_UP = [10, 5, 3, 0]  # сколько первых по опыту за неделю поднимаются: из бронзы 10, из серебра 5, из золота 3
LEAGUE_DOWN = 3            # последние трое — в лигу ниже


def league_min_demote(lg):
    """Опускаем, только если в лиге столько человек: иначе зоны подъёма и спуска пересекались бы."""
    return max(LEAGUE_UP[lg], LEAGUE_DOWN) + LEAGUE_DOWN


LEAGUE_SHOW = 20           # мест в таблице лиги
DAILY_NUMS = set(range(1, 19)) | {22, 23, 24, 25}
# быстрее этого задание дня не прочитать и не решить — значит, ответ был известен заранее (по номерам задания)
DAILY_MIN_SEC = {**{n: 10 for n in range(1, 9)}, **{n: 15 for n in range(9, 19)}, **{n: 25 for n in (22, 23, 24, 25)}}
DUEL_TASKS = 5
DUEL_NUMS = list(range(1, 19)) + [22, 23, 24, 25, 26, 27]   # 19–21 — игра из трёх вопросов, в дуэль не годится
DUEL_TASK_SEC = {n: (30 if n >= 24 else 10) * 60 for n in range(1, 28)}   # время на задание дуэли: №1–23 — 10 мин, №24–27 — 30
DUEL_MIN_NUMS = 3          # меньше общих номеров у двоих ищущих — их не сводим
DUEL_STAKE = 100           # опыт победителю дуэли (у проигравшего не отнимается)
DUEL_FULL_PER_DAY = 3      # полная награда — за первые 3 победы в сутки, дальше — DUEL_STAKE_LATE
DUEL_STAKE_LATE = 20
DUEL_HOURS = 24
DUEL_MAX_OPEN = 3
DUEL_PER_DAY = 10          # дуэлей в сутки на одного ученика
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
            xpw = game_summary(db, sid, brief=True, windows={"prev": (w0, w1)})["rank"]["prev"]["score"]   # очки, как в таблице
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


def daily_task_for(sid, day=None):
    """Личное задание дня: того же номера, типа (кластера) и сложности, что общее задание дня, но у каждого своё —
    ответ нельзя переслать однокласснику. Нерешённые учеником — в первую очередь."""
    day = day or datetime.now().strftime("%Y-%m-%d")
    base = daily_task_id(day)
    bt = APP.bank.tasks.get(base) or {}
    pool = sorted(i for i in bank_pool({bt.get("n")}, single=True, authored_ok=False) if APP.bank.tasks[i].get("c") == bt.get("c"))
    same = [i for i in pool if APP.bank.tasks[i].get("r") == bt.get("r")]
    pool = same if len(same) >= 5 else pool
    if len(pool) < 2:
        return base
    seen = {r["task_id"] for r in APP.db.q("SELECT DISTINCT task_id FROM attempts WHERE student_id=?", (sid,))}
    pool = [i for i in pool if i not in seen] or pool
    return pool[int(hashlib.sha256(f"daily:{day}:{sid}".encode()).hexdigest(), 16) % len(pool)]


def is_daily_of(sid, tid):
    """tid — сегодняшнее задание дня этого ученика (то, что он открыл кнопкой «Решать»)."""
    day = datetime.now().strftime("%Y-%m-%d")
    row = APP.db.q("SELECT task_id FROM daily_starts WHERE day=? AND student_id=?", (day, sid), one=True)
    return bool(row) and (row["task_id"] or daily_task_id(day)) == tid


def daily_crown(db, ids):
    """👑 на сутки — у самого быстрого вчера (из учеников одного учителя)."""
    if not ids:
        return None
    y = (datetime.now().date() - timedelta(days=1)).isoformat()
    r = db.q(f"SELECT student_id FROM daily_results WHERE day=? AND COALESCE(fast, 0)=0 "
             f"AND student_id IN ({','.join('?' * len(ids))}) ORDER BY ms, ts LIMIT 1", (y, *ids), one=True)
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


DUEL_QUEUE_TTL = 15        # сек: ищущий опрашивает сервер чаще; кто пропал дольше, тот уже не ищет


ELO_START = 1000
STREAK_BONUS = 5           # за серию побед в дуэлях: 3-я подряд +5 XP, 4-я +10 … не больше STREAK_BONUS_MAX
STREAK_BONUS_MAX = 25


def elo_of(db, sid):
    r = db.q("SELECT elo FROM duel_elo WHERE student_id=?", (sid,), one=True)
    return r["elo"] if r else ELO_START


def elo_apply(db, a, b, score_a):
    """Рейтинг Эло после дуэли: победа над сильным даёт больше; новичкам (до 10 дуэлей) коэффициент выше."""
    ra, rb = elo_of(db, a), elo_of(db, b)
    exp_a = 1 / (1 + 10 ** ((rb - ra) / 400))
    out = []
    for sid, r, sc, ex in ((a, ra, score_a, exp_a), (b, rb, 1 - score_a, 1 - exp_a)):
        g = (db.q("SELECT games FROM duel_elo WHERE student_id=?", (sid,), one=True) or {"games": 0})["games"]
        delta = (40 if g < 10 else 24) * (sc - ex)
        db.x("""INSERT INTO duel_elo(student_id, elo, games) VALUES(?,?,1)
                ON CONFLICT(student_id) DO UPDATE SET elo=excluded.elo, games=games+1""", (sid, r + delta))
        out.append(round(delta, 1))
    return out


def elo_board(db, tid, sid):
    """Рейтинг Эло учеников учителя: десятка лучших (сыгравшие хотя бы одну дуэль) и своя строка."""
    ids = [m["id"] for m in teacher_students(db, tid)]
    if not ids:
        return {"top": [], "me": None}
    rows = db.q(f"""SELECT e.student_id, e.elo, e.games, s.name FROM duel_elo e JOIN students s ON s.id=e.student_id
                    WHERE e.games>0 AND e.student_id IN ({','.join('?' * len(ids))}) ORDER BY e.elo DESC""", ids)
    out = [{"place": i + 1, "sid": r["student_id"], "name": short_name(r["name"]), "elo": round(r["elo"]), "games": r["games"],
            "me": r["student_id"] == sid} for i, r in enumerate(rows)]
    me = next((r for r in out if r["me"]), None)
    return {"top": out[:10], "me": me or {"place": None, "elo": ELO_START, "games": 0, "me": True}}


def duel_streak(db, sid):
    """Сколько дуэлей подряд выиграно (с последней)."""
    n = 0
    for r in db.q("SELECT winner FROM duels WHERE status='finished' AND (a=? OR b=?) ORDER BY finished DESC LIMIT 50", (sid, sid)):
        if r["winner"] != sid:
            break
        n += 1
    return n


SUS_FAST_MS = 5000         # верный ответ в соревновании быстрее 5 секунд — подозрительно


def comp_flags(db, row, side):
    """Что подозрительного у игрока в матче или дуэли: вставка ответа, верный ответ за секунды, уход со страницы."""
    sid, st = row[side], row[side + "_start"]
    tasks = side_tasks(row, side)
    if not st or not tasks:
        return []
    dn = row[side + "_done"] or time.time()
    out = set()
    for a in db.q(f"""SELECT score, spent_ms, flags FROM attempts WHERE student_id=? AND ts>=? AND ts<=?
                      AND task_id IN ({','.join('?' * len(tasks))})""", (sid, st, dn + 5, *tasks)):
        fl = a["flags"] or ""
        if "paste" in fl:
            out.add("вставка ответа")
        if "sus" in fl:
            out.add("уходил со страницы")
        if (a["score"] or 0) > 0 and a["spent_ms"] is not None and a["spent_ms"] < SUS_FAST_MS:
            out.add("ответ за секунды")
    return sorted(out)


def duels_today(db, sid):
    return db.q("""SELECT COUNT(*) AS c FROM duels WHERE (a=? OR b=?) AND created>=? AND status NOT IN ('declined','expired')""",
                (sid, sid, day_start()), one=True)["c"]


def duel_seekers(db, tid, sid):
    """Сколько одноклассников прямо сейчас ищут соперника."""
    return db.q("SELECT COUNT(*) AS c FROM duel_queue WHERE teacher_id=? AND student_id!=? AND seen>?",
                (tid, sid, time.time() - DUEL_QUEUE_TTL), one=True)["c"]


def duel_cap(tasks):
    """Время на дуэль (сек): сумма лимитов её заданий — №1–23 по 10 минут, №24–27 по 30."""
    return sum(DUEL_TASK_SEC.get((APP.bank.tasks.get(x) or {}).get("n"), 600) for x in tasks)


def duel_tasks(nums=None):
    """Задания для дуэли или матча турнира: по одному на разные номера (из nums, если заданы), без авторских."""
    allowed = set(nums or DUEL_NUMS)
    pool = {n: ids for n, ids in comp_pool().items() if n in allowed}
    nums = random.sample(sorted(pool), min(DUEL_TASKS, len(pool)))
    return [random.choice(pool[n]) for n in sorted(nums)]


# Турнир «как в футболе»: жеребьёвка по корзинам → групповой этап (каждый с каждым, победа 3 очка, ничья 1) →
# плей-офф на выбывание с матчем за 3-е место. «Счёт» матча — сколько заданий решил каждый.
SUPPORT_KINDS = {"task": "Ошибка в задании", "bug": "Не работает сайт", "xp": "Опыт, рейтинг, турниры", "question": "Вопрос", "other": "Другое"}
SUPPORT_MAX = 2000
ACH_CLOCK = time.localtime          # часы для достижений «ночью», «в обед», «пятница 13-е»… (тесты подменяют)


def support_thread(db, p):
    """Переписка по обращению: первое сообщение ученика и все ответы по порядку."""
    return [{"who": "student", "ts": p["ts"], "text": p["text"], "img": p["img"]}] + [
        {"who": r["who"], "ts": r["ts"], "text": r["text"], "img": r["img"]}
        for r in db.q("SELECT who, ts, text, img FROM support_msgs WHERE support_id=? ORDER BY ts, id", (p["id"],))]


# картинки в техподдержке (скриншот ошибки): браузер пересжимает их в JPEG без метаданных, сервер проверяет,
# что это правда картинка, и кладёт файлом рядом с базой; показывает только автору обращения и главному учителю
SUPPORT_IMG_MAX = 1_500_000
SUPPORT_IMG_RE = re.compile(r"[0-9a-f]{32}\.(jpg|png|webp)")
SUPPORT_IMG_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def support_img_dir():
    return DB_PATH.parent / "support_img"


def support_img_save(data_url):
    """data:image/…;base64 → имя файла; None — картинки нет; ValueError — не картинка или слишком большая."""
    if not data_url:
        return None
    m = re.fullmatch(r"data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)", str(data_url).strip())
    if not m:
        raise ValueError("Это не картинка")
    try:
        raw = base64.b64decode(m.group(1), validate=True)
    except ValueError:
        raise ValueError("Картинка повреждена")
    if len(raw) > SUPPORT_IMG_MAX:
        raise ValueError("Картинка слишком большая — до 1,5 МБ")
    ext = ("jpg" if raw[:3] == b"\xff\xd8\xff" else "png" if raw[:8] == b"\x89PNG\r\n\x1a\n"
           else "webp" if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" else None)
    if not ext:
        raise ValueError("Это не картинка")
    name = f"{secrets.token_hex(16)}.{ext}"
    d = support_img_dir()
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_bytes(raw)
    return name


def support_img_cleanup(db):
    """Удалить файлы картинок, на которые больше не ссылается ни одно обращение."""
    d = support_img_dir()
    if not d.is_dir():
        return
    used = {r["img"] for r in db.q("SELECT img FROM support WHERE img IS NOT NULL")}
    used |= {r["img"] for r in db.q("SELECT img FROM support_msgs WHERE img IS NOT NULL")}
    for f in d.iterdir():
        if SUPPORT_IMG_RE.fullmatch(f.name) and f.name not in used:
            f.unlink(missing_ok=True)
SUPPORT_PER_HOUR = 5


TOUR_SIZES = {4: "Мини-турнир", 8: "Кубок", 12: "Чемпионат"}
TOUR_GROUPS = {4: 1, 8: 2, 12: 3}          # группы по 4
TOUR_QUAL = {4: 2, 8: 4, 12: 8}            # сколько выходит в плей-офф (у 12 — по двое из группы и две лучшие третьи)
# все играют одновременно: этап длится столько, сколько его матчи, плюс запас на переходы между ними
TOUR_GROUP_MATCHES = 3                     # в группе из четырёх у каждого три матча — подряд
TOUR_BUFFER_SEC = 10 * 60
TOUR_WIN_XP = {4: 200, 8: 400, 12: 600}   # опыт за победу в турнире; 2-е место — половина, 3-е — треть
TOUR_PRIZES = {size: {1: xp, 2: round(xp / 2), 3: round(xp / 3)} for size, xp in TOUR_WIN_XP.items()}
ROUND_NAMES = {1: "Финал", 2: "Полуфинал", 4: "Четвертьфинал"}
GROUP_NAMES = "ABCD"
TOUR_PER_DAY = 3                           # турниров каждого вида в сутки
TOUR_NOSHOW_SEC = 180                      # не начал ни одного матча за 3 минуты после старта турнира — сдался
TOUR_FMT = 2                               # формат с группами (прежние турниры на выбывание закрываются)


def day_start(ts=None):
    d = datetime.fromtimestamp(ts if ts is not None else time.time()).date()
    return time.mktime(d.timetuple())


# тематические турниры: номера заданий заданы заранее (без голосования); у спринта на матч — 15 минут
TOUR_THEMES = {"python": {"name": "Кубок по Python", "nums": [24, 25, 26, 27], "size": 4, "icon": "🐍", "cap": 0,
                          "about": "Только задания с программированием: №24–27"},
               "sprint": {"name": "Спринт", "nums": [1, 2, 3, 4, 5], "size": 4, "icon": "⏱", "cap": 15 * 60,
                          "about": "Быстрые задания №1–5, на каждый матч — 15 минут"}}
TOUR_KINDS = [(4, ""), (8, ""), (12, ""), (4, "python"), (4, "sprint")]


def tour_cap(db, tour_id):
    """Ограничение времени на матч (сек) у тематического турнира (спринт — 15 минут); 0 — считается по заданиям."""
    r = db.q("SELECT theme FROM tournaments WHERE id=?", (tour_id,), one=True)
    return TOUR_THEMES.get((r and r["theme"]) or "", {}).get("cap") or 0


def tour_match_sec(t, nums):
    """Время одного матча турнира (сек): у спринта — общее, иначе по номерам — №1–23 по 10 мин, №24–27 по 30."""
    return (TOUR_THEMES.get(t["theme"] or "", {}).get("cap")
            or sum(DUEL_TASK_SEC.get(n, 600) for n in nums) or DUEL_TASKS * 600)


def tour_stage_sec(t, nums, group):
    """Срок этапа: группа — три матча подряд, раунд плей-офф — один матч; плюс 10 минут запаса."""
    return tour_match_sec(t, nums) * (TOUR_GROUP_MATCHES if group else 1) + TOUR_BUFFER_SEC


def match_cap(db, m, side):
    """Время на матч игроку (сек) с нажатия «Играть»: у спринта — общее, иначе как в дуэли —
    №1–23 по 10 минут на задание, №24–27 по 30."""
    return tour_cap(db, m["tour_id"]) or duel_cap(side_tasks(m, side))


# сезон — календарный месяц: очки за места в турнирах (чем больше турнир, тем дороже), за участие — 1
SEASON_PTS = {4: {1: 6, 2: 4, 3: 2, 4: 1}, 8: {1: 10, 2: 7, 3: 5, 4: 3}, 12: {1: 15, 2: 10, 3: 7, 4: 5}}
MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]


def season_key(ts=None):
    return datetime.fromtimestamp(ts if ts is not None else time.time()).strftime("%Y-%m")


def season_bounds(key):
    y, m = map(int, key.split("-"))
    a = datetime(y, m, 1).timestamp()
    b = datetime(y + (m == 12), m % 12 + 1, 1).timestamp()
    return a, b


def season_table(db, tid, key):
    a, b = season_bounds(key)
    pts = {}
    for r in db.q("""SELECT p.student_id, p.place, t.size FROM tour_players p JOIN tournaments t ON t.id=p.tour_id
                     WHERE t.teacher_id=? AND t.status='done' AND t.finished>=? AND t.finished<?""", (tid, a, b)):
        x = pts.setdefault(r["student_id"], {"pts": 0, "tours": 0, "wins": 0})
        x["pts"] += SEASON_PTS.get(r["size"], {}).get(r["place"], 1)
        x["tours"] += 1
        x["wins"] += r["place"] == 1
    return sorted(pts.items(), key=lambda kv: (-kv[1]["pts"], -kv[1]["wins"], kv[0]))


def season_view(db, tid, sid):
    key = season_key()
    names = {m["id"]: short_name(m["name"]) for m in teacher_students(db, tid)}
    rows = [{"place": i + 1, "sid": k, "name": names.get(k, "?"), **v, "me": k == sid}
            for i, (k, v) in enumerate(season_table(db, tid, key))]
    y, m = map(int, key.split("-"))
    return {"key": key, "name": f"{MONTHS[m - 1]} {y}", "ends": season_bounds(key)[1], "top": rows[:10],
            "me": next((r for r in rows if r["me"]), None)}


def season_close(db, tid):
    """Прошлый сезон закрыт — тройке лучших значки сезона (один раз)."""
    first = datetime.fromtimestamp(season_bounds(season_key())[0])
    prev = (first - timedelta(days=1)).strftime("%Y-%m")
    flag = f"season:{tid}:{prev}"
    if db.q("SELECT 1 FROM settings WHERE key=?", (flag,), one=True):
        return
    for i, (sid, _) in enumerate(season_table(db, tid, prev)[:3]):
        db.x("INSERT OR IGNORE INTO awards(student_id, kind, week, info) VALUES(?,?,?,?)", (sid, f"season{i + 1}", prev, tid))
    db.x("INSERT OR REPLACE INTO settings(key, value) VALUES(?,?)", (flag, "1"))


def tour_started_today(db, tid, size, theme=""):
    return db.q("""SELECT COUNT(*) AS c FROM tournaments WHERE teacher_id=? AND size=? AND COALESCE(theme, '')=?
                   AND started>=? AND status!='void'""", (tid, size, theme, day_start()), one=True)["c"]


def tour_kind_name(size, theme):
    return TOUR_THEMES[theme]["name"] if theme else TOUR_SIZES[size]


def tour_lobbies(db, tid):
    """Набор на каждый вид открыт, пока сегодня турниров этого вида стартовало меньше TOUR_PER_DAY."""
    for size, theme in TOUR_KINDS:
        if db.q("SELECT 1 FROM tournaments WHERE teacher_id=? AND size=? AND COALESCE(theme, '')=? AND status='reg'",
                (tid, size, theme), one=True):
            continue
        if tour_started_today(db, tid, size, theme) >= TOUR_PER_DAY:
            continue
        name = tour_kind_name(size, theme)
        n = db.q("SELECT COUNT(*) AS c FROM tournaments WHERE teacher_id=? AND size=? AND COALESCE(theme, '')=? AND status!='void'",
                 (tid, size, theme), one=True)["c"] + 1
        db.x("INSERT INTO tournaments(teacher_id, size, title, status, created, fmt, theme) VALUES(?,?,?,'reg',?,?,?)",
             (tid, size, f"{name} №{n}", time.time(), TOUR_FMT, theme or None))


def tour_people(db, tour_id):
    out = []
    for r in db.q("""SELECT p.student_id, p.seed, p.place, p.xp, p.grp, p.gone, s.name FROM tour_players p JOIN students s ON s.id=p.student_id
                     WHERE p.tour_id=? ORDER BY COALESCE(p.seed, 99), p.joined""", (tour_id,)):
        out.append({"sid": r["student_id"], "name": short_name(r["name"]), "seed": r["seed"], "place": r["place"], "xp": r["xp"],
                    "gone": bool(r["gone"]),
                    "grp": r["grp"], "level": game_summary(db, r["student_id"], brief=True)["level"]})
    return out


TOUR_NUMS = set(range(1, 19)) | {22, 23, 24, 25}     # за какие номера можно голосовать (один ответ, без игры 19–21)
TOUR_VOTE_MAX = 3                                     # сколько номеров выбирает каждый участник
TOUR_STAGES = {4: 2, 8: 3, 12: 4}                     # группы + раунды плей-офф до финала
_TOUR_POOL = {}


def tour_vote_nums(db, tour_id):
    """Номера заданий турнира: DUEL_TASKS самых популярных по голосам (поровну — жребий), не хватило — случайные."""
    votes = {r["n"]: r["c"] for r in db.q("SELECT n, COUNT(*) AS c FROM tour_votes WHERE tour_id=? GROUP BY n", (tour_id,))}
    voted = sorted(votes, key=lambda n: (-votes[n], random.random()))
    rest = [n for n in sorted(TOUR_NUMS) if n not in votes]
    random.shuffle(rest)
    return sorted((voted + rest)[:DUEL_TASKS])


def tour_rank(size, rnd):
    """Сложность заданий стадии (1–5 по кластерам): группы — 2, дальше растёт, финал и матч за 3-е место — 5."""
    stages = TOUR_STAGES.get(size, 2)
    return 2 + round((min(rnd, stages) - 1) * 3 / max(stages - 1, 1))


def comp_pool():
    """Задания для соревнований по номерам: целиком, с ответом, актуальные, без авторских (пересчёт при смене банка)."""
    if APP.bank.mtime not in _TOUR_POOL:
        _TOUR_POOL.clear()
        pool = {}
        for i in bank_pool(None, single=True, authored_ok=False):
            pool.setdefault(APP.bank.tasks[i]["n"], []).append(i)
        _TOUR_POOL[APP.bank.mtime] = pool
    return _TOUR_POOL[APP.bank.mtime]


def twin_tasks(tasks, used=()):
    """Задания второму игроку: того же номера, типа и сложности, но другие — ответ у соседа не подсмотреть."""
    pool, out, taken = comp_pool(), [], set(tasks) | set(used)
    for tid in tasks:
        t = APP.bank.tasks.get(tid) or {}
        same_n = [i for i in pool.get(t.get("n"), []) if i not in taken]
        cands = [i for i in same_n if APP.bank.tasks[i].get("c") == t.get("c")] or same_n
        if not cands:
            out.append(tid)                       # другого такого нет — то же задание
            continue
        best = min(abs((APP.bank.tasks[i].get("r") or 3) - (t.get("r") or 3)) for i in cands)
        pick = random.choice([i for i in cands if abs((APP.bank.tasks[i].get("r") or 3) - (t.get("r") or 3)) == best])
        taken.add(pick)
        out.append(pick)
    return out


def side_tasks(row, side):
    """Задания игрока a или b (у старых матчей и дуэлей — общие)."""
    raw = row["tasks_b"] if side == "b" and row["tasks_b"] else row["tasks"]
    return json.loads(raw or "[]")


def tour_tasks(nums, rank, used=()):
    """По заданию на каждый номер, сложность — как можно ближе к rank; уже выданные в этом турнире — не повторяем."""
    pool, out = comp_pool(), []
    for n in nums:
        cands = [i for i in pool.get(n, []) if i not in used] or pool.get(n, [])
        if not cands:
            continue
        best = min(abs((APP.bank.tasks[i].get("r") or 3) - rank) for i in cands)
        out.append(random.choice([i for i in cands if abs((APP.bank.tasks[i].get("r") or 3) - rank) == best]))
    return out


def tour_used(db, tour_id):
    return {x for r in db.q("SELECT tasks, tasks_b FROM tour_matches WHERE tour_id=?", (tour_id,))
            for x in json.loads(r["tasks"] or "[]") + json.loads(r["tasks_b"] or "[]")}


def tour_new_tasks(db, t, rnd):
    """Задания матча: игроку a — по номерам турнира и сложности стадии, игроку b — такие же по типу, но другие."""
    nums = json.loads(t["nums"]) if t["nums"] else None
    used = tour_used(db, t["id"])
    tasks = tour_tasks(nums, tour_rank(t["size"], rnd), used) if nums else []
    if not tasks:
        tasks = duel_tasks()                         # турнир начался до голосования
    return tasks, twin_tasks(tasks, used)


def tour_match_new(db, t, rnd, slot, a, b, ends, kind="po", grp=None):
    tasks, tasks_b = tour_new_tasks(db, t, rnd)
    db.x("""INSERT INTO tour_matches(tour_id, round, slot, a, b, tasks, tasks_b, status, ends, kind, grp, created)
            VALUES(?,?,?,?,?,?,?, 'play', ?, ?, ?, ?)""",
         (t["id"], rnd, slot, a, b, json.dumps(tasks), json.dumps(tasks_b), ends, kind, grp, time.time()))


def tour_settle(db, m, seeds, now, gone=frozenset()):
    """Итог матча. Больше решил — победа. Поровну: в группе ничья, в плей-офф проходит быстрейший («пенальти»).
    Не сыграл — техническое поражение; в группе, если не сыграли оба, поражение обоим."""
    res = {}
    for side in ("a", "b"):
        st, dn = m[side + "_start"], min(m[side + "_done"] or now, m["ends"] or now)    # после срока не считается
        if st:
            dn = min(dn, st + match_cap(db, m, side))  # решённое после лимита времени на матч не считается
        res[side] = (duel_solved(db, m[side], side_tasks(m, side), st, dn) if st else -1, (dn - st) if st else None)
    for side, op in (("a", "b"), ("b", "a")):          # не явился к старту — поражение, сопернику победа
        if m[side] in gone and m[op] not in gone:
            res[side] = (-1, None)
            if res[op][0] < 0:
                res[op] = (0, None)
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
    if m["surrender"]:
        win, tech = ("b" if m["surrender"] == m["a"] else "a"), 0      # сдался — проиграл
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
        nums = TOUR_THEMES[t["theme"]]["nums"] if t["theme"] in TOUR_THEMES else tour_vote_nums(db, t["id"])
        ends = now + tour_stage_sec(t, nums, group=True)
        if not db.xn("UPDATE tournaments SET status='run', started=?, round=1, round_ends=?, nums=? WHERE id=? AND status='reg'",
                     (now, ends, json.dumps(nums), t["id"])):
            return                               # стартовал параллельный запрос
        t = db.q("SELECT * FROM tournaments WHERE id=?", (t["id"],), one=True)
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
                    tour_match_new(db, t, 1, slot, members[i], members[j], ends, "group", g)
                    slot += 1
        return
    if t["status"] != "run":
        return
    seeds = {r["student_id"]: r["seed"] for r in db.q("SELECT student_id, seed FROM tour_players WHERE tour_id=?", (t["id"],))}
    cur = db.q("SELECT * FROM tour_matches WHERE tour_id=? AND round=? ORDER BY slot", (t["id"], t["round"]))
    if t["round"] == 1 and t["started"] and now > t["started"] + TOUR_NOSHOW_SEC:
        # к началу турнира не пришёл (за 3 минуты не начал ни одного матча) — сдался: все его матчи группы проиграны
        here = {}
        for m in cur:
            for side in ("a", "b"):
                here[m[side]] = here.get(m[side], False) or bool(m[side + "_start"])
        for sid in (x for x, ok in here.items() if not ok):
            db.x("UPDATE tour_players SET gone=1 WHERE tour_id=? AND student_id=?", (t["id"], sid))
    gone = {r["student_id"] for r in db.q("SELECT student_id FROM tour_players WHERE tour_id=? AND gone=1", (t["id"],))}
    # матч закрывается, когда оба закончили (не явившийся — уже «закончил»; вышло время на матч — тоже):
    # пришедший доигрывает свои задания спокойно
    over = lambda m, sd: m[sd] in gone or m[sd + "_done"] or (m[sd + "_start"] and now > m[sd + "_start"] + match_cap(db, m, sd))
    for m in cur:
        if m["status"] == "play" and ((over(m, "a") and over(m, "b")) or now > (m["ends"] or now)):
            tour_settle(db, m, seeds, now, gone)
    cur = db.q("SELECT * FROM tour_matches WHERE tour_id=? AND round=? ORDER BY slot", (t["id"], t["round"]))
    if any(m["status"] != "done" for m in cur):
        return
    if any(m["kind"] == "final" for m in cur):
        return tour_finish(db, t, now)
    nxt, ends = t["round"] + 1, now + tour_stage_sec(t, json.loads(t["nums"] or "[]"), group=False)
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
            tour_match_new(db, t, nxt, 0, qual[0], qual[1], ends, "final")
            tour_match_new(db, t, nxt, 1, rest[0], rest[1], ends, "third")
            return
        for k, (a, b) in enumerate(tour_pairs(qual, by_grp)):
            tour_match_new(db, t, nxt, k, a, b, ends, "po")
        return
    winners = [m["winner"] for m in cur if m["kind"] == "po"]
    losers = [m["a"] if m["winner"] == m["b"] else m["b"] for m in cur if m["kind"] == "po"]
    if len(winners) == 2:                        # после полуфиналов — финал и матч за 3-е место
        tour_match_new(db, t, nxt, 0, winners[0], winners[1], ends, "final")
        tour_match_new(db, t, nxt, 1, losers[0], losers[1], ends, "third")
        return
    for k in range(len(winners) // 2):
        tour_match_new(db, t, nxt, k, winners[2 * k], winners[2 * k + 1], ends, "po")


def tour_match_view(m, people, me):
    side = "a" if m["a"] == me else "b" if m["b"] == me else None
    cap = match_cap(APP.db, m, side) if side else None
    return {"id": m["id"], "slot": m["slot"], "kind": m["kind"], "grp": m["grp"], "status": m["status"], "ends": m["ends"],
            "tech": bool(m["tech"]), "a": people.get(m["a"]), "b": people.get(m["b"]), "a_solved": m["a_solved"],
            "b_solved": m["b_solved"], "winner": m["winner"], "mine": side, "started": bool(side and m[side + "_start"]),
            "done": bool(side and m[side + "_done"]),
            "tasks": [APP.bank.pid(x) for x in side_tasks(m, side)] if side and m[side + "_start"] else None,
            "since": m[side + "_start"] if side else None, "cap": cap, "surrender": m["surrender"]}


def tour_view(db, t, me, brief=False):
    """Турнир для страницы: группы с таблицами, сетка плей-офф, места."""
    people = {p["sid"]: p for p in tour_people(db, t["id"])}
    out = {"id": t["id"], "title": t["title"], "size": t["size"], "status": t["status"], "round": t["round"],
           "theme": t["theme"] or "", "cap_min": (TOUR_THEMES.get(t["theme"] or "", {}).get("cap") or 0) // 60,
           "match_min": ((TOUR_THEMES.get(t["theme"] or "", {}).get("cap") or 0)
                         or sum(DUEL_TASK_SEC.get(n, 600) for n in json.loads(t["nums"] or "[]"))) // 60,
           "nums": json.loads(t["nums"]) if t["nums"] else None,
           "ranks": [tour_rank(t["size"], r) for r in range(1, TOUR_STAGES.get(t["size"], 2) + 1)],
           "round_ends": t["round_ends"], "started": t["started"], "finished": t["finished"],
           "podium": sorted([p for p in people.values() if p["place"] and p["place"] <= 4], key=lambda p: p["place"]),
           "my_place": (people.get(me) or {}).get("place"), "gone": [sid for sid, p in people.items() if p.get("gone")]}
    if brief:
        out["places"] = sorted(people.values(), key=lambda p: (p["place"] or 99, p["seed"] or 99))
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
    over = lambda sd: d[sd + "_done"] or (d[sd + "_start"] and now > d[sd + "_start"] + duel_cap(side_tasks(d, sd)))
    if not ((over("a") and over("b")) or now > deadline or d["surrender"]):
        return
    res = {}
    for side in ("a", "b"):
        st, dn = d[side + "_start"], d[side + "_done"] or min(now, deadline)
        if st:
            dn = min(dn, st + duel_cap(side_tasks(d, side)))      # решённое после лимита времени не считается
        res[side] = (duel_solved(db, d[side], side_tasks(d, side), st, dn), (dn - st) if st else float("inf"))
    (sa, ta), (sb, tb) = res["a"], res["b"]
    if d["surrender"]:
        win = "b" if d["surrender"] == d["a"] else "a"     # сдался — проиграл, сколько бы ни решил
    elif sa != sb:
        win = "a" if sa > sb else "b"
    elif sa and ta != tb:
        win = "a" if ta < tb else "b"
    else:
        win = None
    stake = 0
    lose = ("b" if win == "a" else "a") if win else None
    if win:
        # против накрутки: победа сдачей соперника без единого решённого задания — без опыта;
        # полная награда — только за первые победы за сутки
        won = sa if win == "a" else sb
        if d["surrender"] and won <= 0:
            stake = 0
        else:
            full = db.q("""SELECT COUNT(*) AS c FROM duels WHERE status='finished' AND winner=? AND finished>=? AND stake>=?""",
                        (d[win], day_start(), DUEL_STAKE), one=True)["c"]
            stake = DUEL_STAKE if full < DUEL_FULL_PER_DAY else DUEL_STAKE_LATE
    if not db.xn("""UPDATE duels SET status='finished', a_solved=?, b_solved=?, winner=?, stake=?, finished=?
                    WHERE id=? AND status='active'""", (sa, sb, d[win] if win else None, stake, now, d["id"])):
        return                                     # итог уже подвёл параллельный запрос
    if stake:
        db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?,?)", (d[win], now, stake, f"duel:{d['id']}"))
    if d["a_start"] or d["b_start"]:               # рейтинг Эло: никто не начал — дуэль не в счёт
        da, db_ = elo_apply(db, d["a"], d["b"], 1.0 if win == "a" else 0.0 if win == "b" else 0.5)
        db.x("UPDATE duels SET a_elo=?, b_elo=? WHERE id=?", (da, db_, d["id"]))
    if win and stake:                              # серия побед: с третьей подряд — бонус опыта
        streak = duel_streak(db, d[win])
        bonus = min(STREAK_BONUS_MAX, STREAK_BONUS * (streak - 2)) if streak >= 3 else 0
        if bonus:
            db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?,?)", (d[win], now, bonus, f"streak:{d['id']}"))
            db.x("UPDATE duels SET bonus=? WHERE id=?", (bonus, d["id"]))

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
    live_teacher(s)
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
    if b.startswith("own:"):
        return "Персональная: " + a["title"]
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
    ap.add_argument("--fire", nargs=2, metavar=("ФАМИЛИЯ", "ДНЕЙ"),
                    help='восстановить огонёк ученику и выйти, например --fire "Мегрелидзе" 5')
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
    if args.fire:
        who, days = args.fire[0].strip(), to_int(args.fire[1])
        if not days or not 1 <= days <= 365:
            sys.exit("Дней огонька — от 1 до 365")
        key = norm_name(who)[1]
        found = db.q("""SELECT id, name FROM students WHERE COALESCE(is_teacher, 0) = 0
                        AND (name_key = ? OR name_key LIKE ?)""", (key, key + " %"))
        if len(found) != 1:
            print(f"Найдено учеников: {len(found)}" + "".join(f"\n  {r['name']}" for r in found))
            sys.exit("Укажите фамилию и имя полностью, чтобы ученик нашёлся один")
        added, fire = restore_fire(db, found[0]["id"], days)
        print(f"{found[0]['name']}: огонёк — {fire} дн. (восстановлено дней: {added})")
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
