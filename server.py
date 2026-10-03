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
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
from datetime import datetime, timedelta
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent            # папка trainer
BIBLIO = HERE.parent
DATA_DIR = HERE / "server_data"
DB_PATH = DATA_DIR / "trainer.db"
BANK_JS = HERE / "data" / "bank.js"

# что можно отдавать из папки trainer
SITE_FILES = {"index.html", "app.js", "style.css", "admin.html", "admin.js", "admin.css"}
SITE_DIRS = ("vendor/", "media/")
# расширения файлов к заданиям, которые можно отдавать из банков (json/html — никогда: там ответы)
BANK_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".emf", ".wmf", ".img",
            ".txt", ".csv", ".tsv", ".xlsx", ".xls", ".xlsm", ".ods", ".odt", ".docx", ".doc", ".rtf",
            ".pdf", ".zip", ".rar", ".7z", ".py", ".pas", ".cpp", ".dat"}
MAX_BODY = 4_000_000
ADMIN_SESSION_DAYS = 14
DEFAULT_INVITE = "16082001"        # пригласительный код для учеников (меняется в панели учителя)
STUDENT_COOKIE_DAYS = 365
LOCKED_BANK = b'window.EGE_BANK = {"srv":true,"locked":true,"banks":[],"tasks":[]};\n'

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("font/woff2", ".woff2")
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


def norm_name(name):
    name = re.sub(r"\s+", " ", str(name or "")).strip()
    key = name.lower().replace("ё", "е")
    pretty = " ".join(w[:1].upper() + w[1:] for w in name.split(" "))
    pretty = "-".join(p[:1].upper() + p[1:] for p in pretty.split("-"))
    return pretty, key


NAME_RE = re.compile(r"^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’.\- ]{3,79}$")


# ================================================================ банк заданий
class Bank:
    def __init__(self, path: Path):
        self.path = path
        self.mtime = None
        self.lock = threading.Lock()
        self.tasks = {}
        self.public_gz = b""
        self.public_raw = b""
        self.etag = ""
        self._snips = {}

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
            pub_tasks = []
            for t in data.get("tasks", []):
                self.tasks[t["id"]] = t
                p = {k: v for k, v in t.items() if k not in ("ans", "sol", "parts")}
                if t.get("parts"):
                    # задание 19–21: каждую часть проверяем отдельно, в журнал она идёт под своим номером
                    p["parts"] = []
                    for part in t["parts"]:
                        full = {k: v for k, v in t.items() if k != "parts"}
                        full.update(part)
                        full["group"] = t["id"]
                        self.tasks[part["id"]] = full
                        p["parts"].append({"id": part["id"], "n": part["n"], "sh": shape_of(part.get("ans", ""))})
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
            """)
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
        self.bank = Bank(BANK_JS)
        self.bank.ensure()


APP = None


class Handler(BaseHTTPRequestHandler):
    server_version = "EGETrainer/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # ---------- ответы
    def send_bytes(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, code=200, extra=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_bytes(code, body, "application/json; charset=utf-8", dict({"Cache-Control": "no-store"}, **(extra or {})))

    def err(self, code, msg):
        self.send_json({"error": msg}, code)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
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

    # ---------- статика
    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        if path in ("/admin", "/admin/"):
            path = "/admin.html"
        rel = path.lstrip("/")
        if rel == "data/bank.js":
            return self.serve_bank()
        # файлы сайта
        if rel in SITE_FILES or any(rel.startswith(d) for d in SITE_DIRS):
            return self.serve_file(HERE, rel)
        # картинки и файлы заданий из банков (../ege_bank/… превращается в /ege_bank/…)
        parts = rel.split("/")
        if len(parts) >= 2 and parts[0].endswith("_bank"):
            ext = os.path.splitext(parts[-1])[1].lower()
            in_assets = len(parts) >= 3 and parts[1] in ("assets", "files")
            if ext in (".json", ".html", ".htm", ".js", ".py") and not (ext == ".py" and in_assets):
                return self.err(404, "нет такого файла")
            if parts[1] == "raw":
                return self.err(404, "нет такого файла")
            if in_assets or ext in BANK_EXT:
                return self.serve_file(BIBLIO, rel)
        return self.err(404, "нет такого файла")

    def serve_file(self, root: Path, rel):
        root = root.resolve()
        p = (root / rel).resolve()
        try:
            p.relative_to(root)
        except ValueError:
            return self.err(404, "нет такого файла")
        if not p.is_file():
            return self.err(404, "нет такого файла")
        st = p.stat()
        etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
        if self.headers.get("If-None-Match") == etag:
            return self.send_bytes(304, b"", "text/plain", {"ETag": etag})
        ctype = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        extra = {"ETag": etag, "Cache-Control": "no-cache"}
        if p.suffix.lower() not in (".html", ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".woff2"):
            name = p.name
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

    @staticmethod
    def student_cookie(token):
        return f"egest={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={STUDENT_COOKIE_DAYS * 86400}"

    def student(self, data=None):
        tok = self.headers.get("X-Token") or (data or {}).get("token") or self.cookie("egest")
        if not tok:
            return None
        s = APP.db.q("SELECT * FROM students WHERE token=?", (tok,), one=True)
        if s:
            APP.db.x("UPDATE students SET last_seen=? WHERE id=?", (time.time(), s["id"]))
        return s

    def is_admin(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        if "egeadm" not in c:
            return False
        r = APP.db.q("SELECT expires FROM admin_sessions WHERE token=?", (c["egeadm"].value,), one=True)
        return bool(r and r["expires"] > time.time())

    def api(self, method, path, qs, data):
        db = APP.db
        # ----- ученик
        if path == "/api/ping":
            return self.send_json({"ok": True, "server": True})

        if path == "/api/login" and method == "POST":
            code = re.sub(r"\s+", "", str(data.get("code") or ""))
            if not hmac.compare_digest(code, db.setting("invite_code") or DEFAULT_INVITE):
                time.sleep(1.0)
                return self.err(403, "Неверный код приглашения")
            pretty, key = norm_name(data.get("name"))
            if not NAME_RE.match(pretty) or len(pretty.split()) < 2:
                return self.err(400, "Введите фамилию и имя (можно с отчеством)")
            s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
            now = time.time()
            if not s:
                db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES(?,?,?,?,?)",
                     (pretty, key, secrets.token_urlsafe(24), now, now))
                s = db.q("SELECT * FROM students WHERE name_key=?", (key,), one=True)
                print(f"[ученик] новый: {pretty}", flush=True)
            else:
                db.x("UPDATE students SET last_seen=? WHERE id=?", (now, s["id"]))
            prog = json.loads(s["progress"]) if s["progress"] else None
            return self.send_json({"sid": s["id"], "name": s["name"], "token": s["token"],
                                   "progress": prog, "progress_ts": s["progress_ts"]},
                                  extra={"Set-Cookie": self.student_cookie(s["token"])})

        if path == "/api/me":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            prog = json.loads(s["progress"]) if s["progress"] else None
            return self.send_json({"sid": s["id"], "name": s["name"], "token": s["token"], "progress": prog},
                                  extra={"Set-Cookie": self.student_cookie(s["token"])})

        if path == "/api/logout" and method == "POST":
            return self.send_json({"ok": True}, extra={"Set-Cookie": "egest=; Path=/; Max-Age=0"})

        if path == "/api/progress" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            prog = data.get("progress")
            if not isinstance(prog, dict):
                return self.err(400, "нет данных")
            fc = data.get("forecast")
            fc = int(fc) if isinstance(fc, (int, float)) and 0 <= fc <= 100 else None
            db.x("UPDATE students SET progress=?, progress_ts=?, forecast=COALESCE(?, forecast) WHERE id=?",
                 (json.dumps(prog, ensure_ascii=False, separators=(",", ":")), time.time(), fc, s["id"]))
            return self.send_json({"ok": True})

        if path == "/api/check" and method == "POST":
            s = self.student(data)
            if not s:
                return self.err(401, "нужно войти")
            if not APP.bank.ensure():
                return self.err(503, "банк заданий не собран")
            t = APP.bank.tasks.get(str(data.get("task") or ""))
            if not t:
                return self.err(404, "задание не найдено — обновите страницу")
            answers = [str(a)[:400] for a in (data.get("answers") or [])][:3]
            gave_up = bool(data.get("gave_up"))
            abandoned = bool(data.get("abandoned"))
            last = answers[-1] if answers else ""
            correct = bool(answers) and not gave_up and tokens(last) == tokens(t.get("ans", ""))
            final = correct or len(answers) >= 2 or gave_up or abandoned
            res = {"correct": correct, "final": final}
            if final:
                score = (1.0 if len(answers) == 1 else 0.5) if correct else 0.0
                res["score"] = score
                res["answer"] = t.get("ans", "")
                if t.get("sol"):
                    res["sol"] = t["sol"]
                spent = data.get("spent_ms")
                spent = int(spent) if isinstance(spent, (int, float)) and 0 <= spent < 864e5 else None
                db.x("""INSERT INTO attempts(student_id,ts,task_id,n,bank,answers,correct,score,gave_up,abandoned,spent_ms,reason)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (s["id"], time.time(), t["id"], t.get("n"), t.get("bank"), json.dumps(answers, ensure_ascii=False),
                      t.get("ans", ""), score, int(gave_up), int(abandoned), spent, str(data.get("reason") or "")[:20]))
            return self.send_json(res)

        # ----- учитель
        if path == "/api/admin/login" and method == "POST":
            if check_pw(str(data.get("password") or ""), db.setting("admin_password")):
                tok = secrets.token_urlsafe(32)
                db.x("INSERT INTO admin_sessions(token,expires) VALUES(?,?)", (tok, time.time() + ADMIN_SESSION_DAYS * 86400))
                db.x("DELETE FROM admin_sessions WHERE expires<?", (time.time(),))
                return self.send_json({"ok": True}, extra={
                    "Set-Cookie": f"egeadm={tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age={ADMIN_SESSION_DAYS * 86400}"})
            time.sleep(1.0)
            return self.err(403, "Неверный пароль")

        if path.startswith("/api/admin/"):
            if not self.is_admin():
                return self.err(401, "нужен вход учителя")
            return self.admin_api(method, path, qs, data)

        return self.err(404, "нет такого метода")

    # ---------- API учителя
    def admin_api(self, method, path, qs, data):
        db = APP.db
        now = time.time()
        day0 = datetime.combine(datetime.now().date(), datetime.min.time()).timestamp()

        if path == "/api/admin/logout" and method == "POST":
            c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
            if "egeadm" in c:
                db.x("DELETE FROM admin_sessions WHERE token=?", (c["egeadm"].value,))
            return self.send_json({"ok": True}, extra={"Set-Cookie": "egeadm=; Path=/; Max-Age=0"})

        if path == "/api/admin/students":
            rows = db.q("""
              SELECT s.id, s.name, s.created, s.last_seen, s.forecast,
                     COUNT(a.id) AS total,
                     SUM(a.score = 1) AS ok1, SUM(a.score = 0.5) AS ok2, SUM(a.score = 0) AS bad,
                     SUM(a.ts >= ?) AS today, SUM(a.ts >= ?) AS week,
                     SUM(a.ts >= ? AND a.score = 0) AS bad_week,
                     MAX(a.ts) AS last_attempt
              FROM students s LEFT JOIN attempts a ON a.student_id = s.id
              GROUP BY s.id ORDER BY COALESCE(MAX(a.ts), s.last_seen) DESC""", (day0, now - 7 * 86400, now - 7 * 86400))
            return self.send_json({"students": [dict(r) for r in rows], "now": now})

        if path == "/api/admin/student":
            sid = int(qs.get("id") or 0)
            s = db.q("SELECT id,name,created,last_seen,forecast,progress_ts FROM students WHERE id=?", (sid,), one=True)
            if not s:
                return self.err(404, "ученик не найден")
            frm = float(qs.get("from") or 0)
            att = db.q("SELECT * FROM attempts WHERE student_id=? AND ts>=? ORDER BY ts DESC LIMIT 5000", (sid, frm))
            APP.bank.ensure()
            out = []
            for a in att:
                d = dict(a)
                d["answers"] = json.loads(d["answers"] or "[]")
                d["snip"] = APP.bank.snippet(d["task_id"])
                out.append(d)
            prog = db.q("SELECT progress FROM students WHERE id=?", (sid,), one=True)["progress"]
            fc_hist = []
            if prog:
                try:
                    fc_hist = json.loads(prog).get("fc") or []
                except Exception:
                    pass
            return self.send_json({"student": dict(s), "attempts": out, "forecast_history": fc_hist})

        if path == "/api/admin/feed":
            since = float(qs.get("since") or 0)
            rows = db.q("""SELECT a.*, s.name FROM attempts a JOIN students s ON s.id = a.student_id
                           WHERE a.ts > ? ORDER BY a.ts DESC LIMIT 300""", (since,))
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
            return self.send_json(t)

        if path == "/api/admin/export.csv":
            sid = qs.get("student")
            frm = float(qs.get("from") or 0)
            args = [frm]
            sql = """SELECT a.*, s.name FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.ts>=?"""
            if sid:
                sql += " AND a.student_id=?"
                args.append(int(sid))
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
                       else "показал ответ" if a["gave_up"] else "ушёл после ошибки" if a["abandoned"] else "неверно")
                w.writerow([a["name"], dt.strftime("%d.%m.%Y"), dt.strftime("%H:%M"), a["n"], a["task_id"].split(":", 1)[-1],
                            a["bank"], (answers[0] if answers else "").replace("\n", " "),
                            (answers[1] if len(answers) > 1 else "").replace("\n", " "),
                            (a["correct"] or "").replace("\n", " | "), res,
                            str(a["score"]).replace(".", ","), round((a["spent_ms"] or 0) / 1000), REASONS.get(a["reason"], a["reason"])])
            body = ("﻿" + buf.getvalue()).encode("utf-8")
            name = "zhurnal.csv"
            return self.send_bytes(200, body, "text/csv; charset=utf-8",
                                   {"Content-Disposition": f"attachment; filename={name}", "Cache-Control": "no-store"})

        if path == "/api/admin/password" and method == "POST":
            if not check_pw(str(data.get("old") or ""), db.setting("admin_password")):
                time.sleep(1.0)
                return self.err(403, "Текущий пароль неверный")
            new = str(data.get("new") or "")
            if len(new) < 6:
                return self.err(400, "Новый пароль — не короче 6 символов")
            db.setting("admin_password", hash_pw(new))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/rename" and method == "POST":
            sid = int(data.get("id") or 0)
            pretty, key = norm_name(data.get("name"))
            if not NAME_RE.match(pretty) or len(pretty.split()) < 2:
                return self.err(400, "Нужны фамилия и имя")
            other = db.q("SELECT id FROM students WHERE name_key=? AND id<>?", (key, sid), one=True)
            if other:      # такое ФИО уже есть — объединяем журналы
                db.x("UPDATE attempts SET student_id=? WHERE student_id=?", (other["id"], sid))
                db.x("DELETE FROM students WHERE id=?", (sid,))
                return self.send_json({"ok": True, "merged_into": other["id"]})
            db.x("UPDATE students SET name=?, name_key=? WHERE id=?", (pretty, key, sid))
            return self.send_json({"ok": True})

        if path == "/api/admin/student/delete" and method == "POST":
            sid = int(data.get("id") or 0)
            db.x("DELETE FROM attempts WHERE student_id=?", (sid,))
            db.x("DELETE FROM students WHERE id=?", (sid,))
            return self.send_json({"ok": True})

        if path == "/api/admin/invite" and method == "POST":
            code = re.sub(r"\s+", "", str(data.get("code") or ""))
            if not 4 <= len(code) <= 40:
                return self.err(400, "Код — от 4 до 40 символов без пробелов")
            db.setting("invite_code", code)
            return self.send_json({"ok": True, "code": code})

        if path == "/api/admin/info":
            n_tasks = len(APP.bank.tasks) if APP.bank.ensure() else 0
            return self.send_json({"tasks": n_tasks, "bank_built": APP.bank.mtime,
                                   "invite": db.setting("invite_code") or DEFAULT_INVITE,
                                   "students": db.q("SELECT COUNT(*) c FROM students", one=True)["c"],
                                   "attempts": db.q("SELECT COUNT(*) c FROM attempts", one=True)["c"]})

        return self.err(404, "нет такого метода")


REASONS = {"new": "новое", "review": "повторение после ошибки", "retry": "работа над ошибкой",
           "weak": "слабое место", "repeat": "повтор решённого", "": ""}


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
    args = ap.parse_args()

    db = DB(DB_PATH)
    if not db.setting("invite_code"):
        db.setting("invite_code", DEFAULT_INVITE)
    if args.invite:
        code = re.sub(r"\s+", "", args.invite)
        if not 4 <= len(code) <= 40:
            sys.exit("Код приглашения — от 4 до 40 символов без пробелов")
        db.setting("invite_code", code)
        print(f"Код приглашения: {code}")
        return
    if args.password:
        if len(args.password) < 6:
            sys.exit("Пароль должен быть не короче 6 символов")
        db.setting("admin_password", hash_pw(args.password))
        print("Пароль учителя сохранён.")
        return
    first_pw = None
    if not db.setting("admin_password"):
        first_pw = secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")
        db.setting("admin_password", hash_pw(first_pw))
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
    print(f"  Код приглашения:        {db.setting('invite_code')}")
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
