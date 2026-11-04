"""Совместный сеанс учителя и учеников: общий код Python и общая доска в реальном времени.

Связь — WebSocket (одно постоянное соединение в обе стороны, без опроса): каждая буква и каждый кусок штриха уходит сразу,
сервер раздаёт его остальным участникам. Ничего не пишется на диск по ходу — состояние сеанса живёт в памяти
и сохраняется в базу раз в несколько секунд и при завершении.

Код: одновременная правка без потерь — операционные преобразования (как в ot.js): сервер выстраивает правки в общий порядок
(ревизии), правку, сделанную по старой ревизии, сдвигает поверх уже принятых. Операция — список:
  целое > 0 — пропустить столько символов, строка — вставить её, целое < 0 — удалить столько символов.
Доска: штрих — объект {id, c (цвет), w (толщина), k (p — ручка, l — прямая, t — текст), p: [[x, y], …], txt, fs};
координаты — в «листе» шириной BOARD_W, у всех одинаковые, браузер масштабирует под свой экран.
"""
import base64
import hashlib
import json
import queue
import socket
import struct
import threading
import time

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WS_MAX = 1 << 20                 # самое большое сообщение от браузера
BOARD_W = 1000                   # ширина листа доски в условных точках
BOARD_H_MAX = 12000              # лист растёт вниз до стольких точек
CODE_MAX = 50_000                # символов в общем коде
STROKES_MAX = 4000               # штрихов на одной доске
POINTS_MAX = 4000                # точек в одном штрихе
OUT_MAX = 300_000                # символов вывода программы, который видят все (и сохраняется со страницей)
HIST_KEEP = 400                  # сколько последних правок кода помнить для сдвига «опоздавших» правок
ANS_MAX = 200
CHECKS_PER_PAGE = 20             # проверок ответа на одно задание за сеанс
COLORS = ["#ff9600", "#ce82ff", "#ff4b9b", "#2ec27e", "#ffc800", "#ff6b4b"]   # ученики; учитель — синий
TEACHER_COLOR = "#1cb0f6"
SAVE_EVERY = 3.0
SEND_QUEUE_MAX = 5000            # отправка участнику не успевает — значит, связь у него оборвалась
PY_LOCAL = lambda: False         # Pyodide лежит на сервере (vendor/pyodide) — задаёт server.py


# ================================================================ правки текста (OT)
def op_ok(op, doc_len):
    """Правка корректна и рассчитана на текст длиной doc_len."""
    if not isinstance(op, list) or len(op) > 10_000:
        return False
    base = 0
    for c in op:
        if isinstance(c, bool):
            return False
        if isinstance(c, int):
            if c == 0:
                return False
            base += abs(c)
        elif isinstance(c, str):
            if not c:
                return False
        else:
            return False
    return base == doc_len


def op_apply(doc, op):
    out, i = [], 0
    for c in op:
        if isinstance(c, str):
            out.append(c)
        elif c > 0:
            out.append(doc[i:i + c])
            i += c
        else:
            i -= c
    if i != len(doc):
        raise ValueError("правка не по длине текста")
    return "".join(out)


def _push(ops, c):
    """Добавить кусок правки, склеивая с предыдущим; вставка всегда перед удалением (как в ot.js)."""
    if c == 0 or c == "":
        return
    if ops:
        last = ops[-1]
        if isinstance(c, str):
            if isinstance(last, str):
                ops[-1] = last + c
                return
            if last < 0:
                if len(ops) >= 2 and isinstance(ops[-2], str):
                    ops[-2] += c
                else:
                    ops.insert(len(ops) - 1, c)
                return
        elif isinstance(last, int) and (last > 0) == (c > 0):
            ops[-1] = last + c
            return
    ops.append(c)


def op_transform(a, b):
    """a и b сделаны над одним текстом. Возвращает (a', b'): применить a, затем b' — то же, что b, затем a'.
    При вставке в одно место вставка из a идёт первой."""
    a1, b1 = [], []
    ia, ib = iter(a), iter(b)
    x, y = next(ia, None), next(ib, None)
    while x is not None or y is not None:
        if isinstance(x, str):
            _push(a1, x)
            _push(b1, len(x))
            x = next(ia, None)
            continue
        if isinstance(y, str):
            _push(a1, len(y))
            _push(b1, y)
            y = next(ib, None)
            continue
        if x is None or y is None:
            raise ValueError("правки рассчитаны на разную длину текста")
        if x > 0 and y > 0:
            m = min(x, y)
            _push(a1, m)
            _push(b1, m)
            x, y = x - m, y - m
        elif x < 0 and y < 0:
            m = min(-x, -y)
            x, y = x + m, y + m
        elif x < 0 < y:
            m = min(-x, y)
            _push(a1, -m)
            x, y = x + m, y - m
        else:                          # x > 0 > y
            m = min(x, -y)
            _push(b1, -m)
            x, y = x - m, y + m
        if x == 0:
            x = next(ia, None)
        if y == 0:
            y = next(ib, None)
    return a1, b1


# ================================================================ WebSocket
def ws_accept(key):
    return base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()


def _read_exact(rf, n):
    buf = rf.read(n)
    if buf is None or len(buf) < n:
        raise EOFError
    return buf


def _unmask(data, mask):
    if not data:
        return data
    n = len(data)
    m = (mask * (n // 4 + 1))[:n]
    return (int.from_bytes(data, "little") ^ int.from_bytes(m, "little")).to_bytes(n, "little")


def ws_read(rf):
    """Следующее сообщение: (opcode, данные). Склеивает продолжения; EOFError — соединение закрыто."""
    parts, first_op = [], None
    while True:
        h = _read_exact(rf, 2)
        fin, op = h[0] & 0x80, h[0] & 0x0F
        masked, n = h[1] & 0x80, h[1] & 0x7F
        if n == 126:
            n = struct.unpack(">H", _read_exact(rf, 2))[0]
        elif n == 127:
            n = struct.unpack(">Q", _read_exact(rf, 8))[0]
        if n > WS_MAX:
            raise EOFError
        mask = _read_exact(rf, 4) if masked else b""
        data = _read_exact(rf, n) if n else b""
        if masked:
            data = _unmask(data, mask)
        if op >= 8:                    # управляющие кадры приходят между частями — отдаём сразу
            return op, data
        if first_op is None:
            first_op = op
        parts.append(data)
        if sum(len(p) for p in parts) > WS_MAX:
            raise EOFError
        if fin:
            return first_op, b"".join(parts)


def ws_frame(data, op=1):
    n = len(data)
    if n < 126:
        head = struct.pack(">BB", 0x80 | op, n)
    elif n < 65536:
        head = struct.pack(">BBH", 0x80 | op, 126, n)
    else:
        head = struct.pack(">BBQ", 0x80 | op, 127, n)
    return head + data


class Conn:
    """Участник на одном соединении. Отправка — своим потоком из очереди: медленная связь одного участника
    не задерживает остальных, а порядок сообщений сохраняется."""

    def __init__(self, sock, rfile, who, name, color, cid):
        self.sock, self.rfile = sock, rfile
        self.who, self.name, self.color, self.cid = who, name, color, cid
        self.q = queue.SimpleQueue()
        self.n = 0
        self.alive = True
        self.thread = threading.Thread(target=self._writer, name="tog-send", daemon=True)
        self.thread.start()

    def send(self, msg):
        if not self.alive:
            return
        self.n += 1
        if self.n > SEND_QUEUE_MAX and self.q.qsize() > SEND_QUEUE_MAX:
            self.close()
            return
        self.q.put(msg if isinstance(msg, bytes) else json.dumps(msg, ensure_ascii=False, separators=(",", ":")).encode())

    def _writer(self):
        try:
            while True:
                m = self.q.get()
                if m is None:
                    break
                batch = [ws_frame(m)]
                while len(batch) < 64:         # пачка, что успела накопиться, — одной отправкой
                    try:
                        m = self.q.get_nowait()
                    except queue.Empty:
                        break
                    if m is None:
                        self.alive = False
                        break
                    batch.append(ws_frame(m))
                self.sock.sendall(b"".join(batch))
                if not self.alive:
                    break
        except OSError:
            pass
        self.alive = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass

    def close(self):
        if self.alive:
            self.alive = False
            self.q.put(None)


# ================================================================ сеанс
def _num(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    return round(min(max(float(v), lo), hi), 1)


def _points(p):
    out = []
    if not isinstance(p, list):
        return out
    for xy in p[:POINTS_MAX]:
        if isinstance(xy, list) and len(xy) == 2:
            x, y = _num(xy[0], -50, BOARD_W + 50), _num(xy[1], -50, BOARD_H_MAX)
            if x is not None and y is not None:
                out.append([x, y])
    return out


def _stroke(d):
    """Штрих из сообщения браузера — только известные поля в допустимых пределах."""
    sid = str(d.get("id") or "")[:40]
    if not sid:
        return None
    c = str(d.get("c") or "")
    if not (c == "ink" or (len(c) == 7 and c[0] == "#" and all(ch in "0123456789abcdefABCDEF" for ch in c[1:]))):
        c = "ink"
    k = d.get("k") if d.get("k") in ("p", "l", "t") else "p"
    st = {"id": sid, "c": c, "w": _num(d.get("w"), 1, 30) or 2, "k": k, "p": _points(d.get("p"))}
    if d.get("L") == "c":                    # слой «на условии задания» (лист условия — COND_W точек шириной у всех)
        st["L"] = "c"
    if k == "t":
        st["txt"] = str(d.get("txt") or "")[:500]
        st["fs"] = _num(d.get("fs"), 10, 80) or 20
        if not st["txt"].strip():
            return None
    if not st["p"]:
        return None
    return st


class Page:
    """Одна страница сеанса: задание (или чистая), общий код, доска, общий ответ, итоги проверок, вывод программы."""

    def __init__(self, d=None):
        d = d or {}
        self.task = d.get("task")              # настоящий id задания или None
        self.code = d.get("code") or ""
        self.rev = int(d.get("rev") or 0)
        self.hist = []                         # последние правки: (ревизия после правки, операция)
        self.strokes = {s["id"]: s for s in d.get("strokes") or [] if isinstance(s, dict) and s.get("id")}
        self.ans = d.get("ans") or ""
        self.res = d.get("res") or []
        self.out = d.get("out") or ""
        self.checks = int(d.get("checks") or 0)

    def dump(self):
        return {"task": self.task, "code": self.code, "rev": self.rev, "strokes": list(self.strokes.values()),
                "ans": self.ans, "res": self.res[-50:], "out": self.out, "checks": self.checks}


class Session:
    def __init__(self, row, state):
        self.id = row["id"]
        self.teacher = row["teacher_id"]
        self.students = set(json.loads(row["students"] or "[]"))
        self.ended = row["ended"]
        self.created = row["created"]
        st = state or {}
        self.mode = st.get("mode") if st.get("mode") in ("both", "code", "board") else "both"
        self.ro = bool(st.get("ro"))
        self.follow = st.get("follow", True) is not False
        self.view = st.get("view") or {}
        self.pages = {k: Page(v) for k, v in (st.get("pages") or {}).items()}
        self.cur = st.get("cur") if st.get("cur") in self.pages else None
        if self.cur is None:
            self.cur = "p1"
            self.pages.setdefault("p1", Page())
        self.next_page = max([int(k[1:]) for k in self.pages if k[1:].isdigit()] + [0]) + 1
        self.conns = []
        self.lock = threading.RLock()
        self.dirty = False
        self.colors = st.get("colors") or {}      # участник -> цвет (одинаковый во всех заходах)

    def dump(self):
        return {"mode": self.mode, "ro": self.ro, "follow": self.follow, "view": self.view, "cur": self.cur,
                "pages": {k: p.dump() for k, p in self.pages.items()}, "colors": self.colors}


class Hub:
    """Все открытые сеансы. Хозяин (server.py) даёт функции: load(id) -> (строка, состояние) | None, save(id, state),
    task(real_id, teacher) -> {…} | None — задание для показа, check(real_id, answer) -> 0..1, name(who) -> имя."""

    def __init__(self, load, save, task, check, name):
        self.load, self.save_fn, self.task_fn, self.check_fn, self.name_fn = load, save, task, check, name
        self.lock = threading.Lock()
        self.sessions = {}
        self.saver = None

    # ---------- сеансы в памяти
    def get(self, sid):
        with self.lock:
            s = self.sessions.get(sid)
            if s:
                return s
            got = self.load(sid)
            if not got:
                return None
            s = Session(*got)
            self.sessions[sid] = s
            if not self.saver:
                self.saver = threading.Thread(target=self._saver, name="tog-save", daemon=True)
                self.saver.start()
            return s

    def forget(self, sid):
        """Сеанс поменяли в базе (позвали ещё учеников, завершили) — перечитать при следующем заходе."""
        with self.lock:
            s = self.sessions.get(sid)
        if not s:
            return
        got = self.load(sid)
        with s.lock:
            if got:
                s.students = set(json.loads(got[0]["students"] or "[]"))
                s.ended = got[0]["ended"]
            if s.ended:
                self._bcast(s, {"t": "end"})        # соединения не рвём: запись занятия можно смотреть дальше (peek)
            else:
                self._people(s)

    def online(self, sid):
        with self.lock:
            s = self.sessions.get(sid)
        if not s:
            return []
        with s.lock:
            return sorted({c.who for c in s.conns if c.alive}, key=str)

    def _saver(self):
        while True:
            time.sleep(SAVE_EVERY)
            self.flush()

    def flush(self):
        with self.lock:
            ss = list(self.sessions.values())
        for s in ss:
            with s.lock:
                if not s.dirty:
                    if not s.conns:
                        with self.lock:
                            self.sessions.pop(s.id, None)       # никого нет и всё сохранено — из памяти долой
                    continue
                s.dirty = False
                state = s.dump()
            try:
                self.save_fn(s.id, state)
            except Exception as e:                               # база занята — попробуем в следующий раз
                s.dirty = True
                print(f"[сеанс] не сохранён: {e!r}", flush=True)

    # ---------- рассылка
    def _bcast(self, s, msg, skip=None):
        raw = json.dumps(msg, ensure_ascii=False, separators=(",", ":")).encode()
        for c in s.conns:
            if c is not skip:
                c.send(raw)

    def _people(self, s):
        s.conns = [c for c in s.conns if c.alive]
        seen, people = set(), []
        for who in [("t", s.teacher)] + [("s", x) for x in sorted(s.students)]:
            key = f"{who[0]}{who[1]}"
            on = [c for c in s.conns if c.who == who]
            if key in seen:
                continue
            seen.add(key)
            people.append({"key": key, "name": self.name_fn(who), "color": self._color(s, who), "on": bool(on),
                           "teacher": who[0] == "t", "cids": [c.cid for c in on]})
        self._bcast(s, {"t": "people", "people": people})

    def _color(self, s, who):
        if who[0] == "t":
            return TEACHER_COLOR
        key = f"s{who[1]}"
        if key not in s.colors:
            used = set(s.colors.values())
            s.colors[key] = next((c for c in COLORS if c not in used), COLORS[len(s.colors) % len(COLORS)])
            s.dirty = True
        return s.colors[key]

    def _page_msg(self, s, p, key, teacher):
        t = self.task_fn(p.task, teacher) if p.task else None
        return {"t": "page", "page": key, "task": t, "code": p.code, "rev": p.rev, "strokes": list(p.strokes.values()),
                "ans": p.ans, "res": p.res[-10:], "out": p.out,
                "pages": [{"key": k, "task": (self.task_fn(x.task, teacher) or {}).get("label") if x.task else None}
                          for k, x in s.pages.items()]}

    def _snap(self, s, c):
        teacher = c.who[0] == "t"
        return {"t": "snap", "me": {"cid": c.cid, "key": f"{c.who[0]}{c.who[1]}", "name": c.name, "color": c.color,
                                    "teacher": teacher},
                "mode": s.mode, "ro": s.ro, "follow": s.follow, "view": s.view, "ended": bool(s.ended), "created": s.created,
                "board_w": BOARD_W, "py_local": bool(PY_LOCAL()), "page": self._page_msg(s, s.pages[s.cur], s.cur, teacher)}

    # ---------- одно соединение: читаем сообщения, пока не закроют
    def run(self, s, who, sock, rfile, cid):
        with s.lock:
            c = Conn(sock, rfile, who, self.name_fn(who), self._color(s, who), cid)
            s.conns.append(c)
            c.send(self._snap(s, c))
            self._people(s)
        try:
            while c.alive:
                op, data = ws_read(rfile)
                if op == 8:
                    break
                if op != 1:
                    continue
                try:
                    msg = json.loads(data.decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(msg, dict):
                    self.handle(s, c, msg)
        except (EOFError, OSError, socket.timeout):
            pass
        finally:
            c.close()
            with s.lock:
                if c in s.conns:
                    s.conns.remove(c)
                self._bcast(s, {"t": "gone", "cid": c.cid})
                self._people(s)

    def handle(self, s, c, m):
        t = m.get("t")
        teacher = c.who[0] == "t"
        if t == "ping":
            c.send({"t": "pong", "ts": m.get("ts")})
            return
        with s.lock:
            if t == "peek":                          # посмотреть другую страницу занятия, не меняя её у остальных
                key = m.get("key")                  # (завершённое занятие — всем; идущее — только учителю)
                if key in s.pages and (s.ended or teacher):
                    c.send(dict(self._page_msg(s, s.pages[key], key, teacher), peek=True))
                return
            if s.ended:
                if t != "cur":
                    c.send({"t": "end"})
                return
            may_write = teacher or not s.ro
            p = s.pages[s.cur]
            if m.get("page") not in (None, s.cur) and t in ("op", "s+", "s.", "s~", "s-", "s!", "del", "clr", "ans", "chk", "out"):
                return                               # сообщение к прежней странице — браузер уже получил новую
            if t == "cur":
                d = {"t": "cur", "cid": c.cid, "key": f"{c.who[0]}{c.who[1]}", "name": c.name, "color": c.color}
                if m.get("where") == "code" and isinstance(m.get("pos"), int):
                    d.update(where="code", pos=max(0, min(m["pos"], len(p.code))))
                    if isinstance(m.get("a"), int) and m["a"] != m["pos"]:      # выделение в коде: от a до pos
                        d["a"] = max(0, min(m["a"], len(p.code)))
                elif m.get("where") == "cond" and isinstance(m.get("a"), int) and isinstance(m.get("b"), int):
                    d.update(where="cond", a=max(0, min(m["a"], 100_000)), b=max(0, min(m["b"], 100_000)))   # выделение в условии
                elif m.get("where") == "board":
                    x, y = _num(m.get("x"), -50, BOARD_W + 50), _num(m.get("y"), -50, BOARD_H_MAX)
                    if x is None or y is None:
                        return
                    d.update(where="board", x=x, y=y)
                else:
                    d["where"] = None
                self._bcast(s, d, skip=c)
            elif t == "op":
                if not may_write:
                    c.send({"t": "resync", "page": self._page_msg(s, p, s.cur, teacher), "why": "ro"})
                    return
                self._op(s, c, p, m)
            elif t in ("s+", "s!"):
                if not may_write:
                    return
                st = _stroke(m.get("s") or {})
                if not st or (st["id"] not in p.strokes and len(p.strokes) >= STROKES_MAX):
                    return
                st["by"] = f"{c.who[0]}{c.who[1]}"
                p.strokes[st["id"]] = st
                s.dirty = True
                self._bcast(s, {"t": "s+", "s": st, "cid": c.cid}, skip=c)
            elif t in ("s.", "s~"):
                if not may_write:
                    return
                st = p.strokes.get(str(m.get("id") or ""))
                pts = _points(m.get("p"))
                if not st or not pts:
                    return
                if t == "s~":
                    st["p"] = pts
                else:
                    st["p"] = (st["p"] + pts)[:POINTS_MAX]
                s.dirty = True
                self._bcast(s, {"t": t, "id": st["id"], "p": pts}, skip=c)
            elif t == "s-":                         # прямая дорисована
                if may_write and str(m.get("id") or "") in p.strokes:
                    self._bcast(s, {"t": "s-", "id": str(m["id"])}, skip=c)
            elif t == "del":
                if not may_write:
                    return
                ids = [str(i) for i in (m.get("ids") or [])[:2000] if str(i) in p.strokes]
                for i in ids:
                    del p.strokes[i]
                if ids:
                    s.dirty = True
                    self._bcast(s, {"t": "del", "ids": ids}, skip=c)
            elif t == "clr":
                if not may_write:
                    return
                cond = m.get("L") == "c"           # очистить пометки на условии или доску — по отдельности
                p.strokes = {k: v for k, v in p.strokes.items() if (v.get("L") == "c") != cond}
                s.dirty = True
                self._bcast(s, {"t": "clr", "by": c.name, "L": "c" if cond else None}, skip=c)
            elif t == "ans":
                if not may_write:
                    return
                p.ans = str(m.get("v") or "")[:ANS_MAX]
                s.dirty = True
                self._bcast(s, {"t": "ans", "v": p.ans, "name": c.name, "cid": c.cid}, skip=c)
            elif t == "chk":
                if not may_write or not p.task:
                    return
                ans = str(m.get("v") if m.get("v") is not None else p.ans)[:ANS_MAX].strip()
                if not ans:
                    return
                if p.checks >= CHECKS_PER_PAGE:
                    c.send({"t": "res", "limit": True})
                    return
                p.checks += 1
                credit = self.check_fn(p.task, ans)
                if credit is None:
                    return
                r = {"v": ans, "ok": credit >= 1, "half": 0 < credit < 1, "by": c.name, "ts": time.time()}
                p.ans = ans
                p.res.append(r)
                s.dirty = True
                self._bcast(s, dict(r, t="res"))
            elif t in ("run", "out", "done"):
                if not may_write:
                    return
                if t == "run":
                    p.out = ""
                    self._bcast(s, {"t": "run", "name": c.name, "cid": c.cid}, skip=c)
                elif t == "out":
                    txt = str(m.get("text") or "")[:OUT_MAX]
                    room = OUT_MAX - len(p.out)
                    if room <= 0:
                        return
                    txt = txt[:room]
                    p.out += txt
                    self._bcast(s, {"t": "out", "text": txt, "err": bool(m.get("err"))}, skip=c)
                else:
                    # итог запуска — весь вывод целиком: у всех ровно то же, что у запустившего (кусочки могли не дойти)
                    full = m.get("full")
                    if isinstance(full, str):
                        p.out = full[:OUT_MAX]
                    self._bcast(s, {"t": "done", "ok": bool(m.get("ok")), "ms": _num(m.get("ms"), 0, 1e7),
                                    "full": p.out if isinstance(full, str) else None}, skip=c)
                s.dirty = True
            elif t == "view":
                if not teacher:
                    return
                v = {}
                if m.get("mode") in ("both", "code", "board"):
                    s.mode = v["mode"] = m["mode"]
                for k, hi in (("by", BOARD_H_MAX), ("cy", 1e6)):
                    if m.get(k) is not None:
                        x = _num(m.get(k), 0, hi)
                        if x is not None:
                            v[k] = x
                if m.get("tab") in ("task", "code", "board", "out"):
                    v["tab"] = m["tab"]
                s.view.update(v)
                s.dirty = True
                if s.follow and v:
                    self._bcast(s, dict(v, t="view"), skip=c)
            elif t == "follow":
                if teacher:
                    s.follow = bool(m.get("on"))
                    s.dirty = True
                    self._bcast(s, {"t": "follow", "on": s.follow, "view": s.view})
            elif t == "ro":
                if teacher:
                    s.ro = bool(m.get("on"))
                    s.dirty = True
                    self._bcast(s, {"t": "ro", "on": s.ro})
            elif t == "task":
                if not teacher:
                    return
                key = m.get("key")
                if key in s.pages:                    # вернуться к прежней странице
                    s.cur = key
                else:
                    real = m.get("task")
                    if real is not None and not self.task_fn(real, True):
                        c.send({"t": "err", "msg": "Задание не найдено"})
                        return
                    same = next((k for k, x in s.pages.items() if real and x.task == real), None)
                    if same:
                        s.cur = same
                    else:
                        cur = s.pages[s.cur]
                        if not cur.task and not cur.code.strip() and not cur.strokes and real:
                            cur.task = real            # чистая страница без задания — просто ставим задание на неё
                        else:
                            s.cur = f"p{s.next_page}"
                            s.next_page += 1
                            s.pages[s.cur] = Page({"task": real})
                s.dirty = True
                for x in s.conns:
                    x.send(self._page_msg(s, s.pages[s.cur], s.cur, x.who[0] == "t"))

    def _op(self, s, c, p, m):
        rev, ops = m.get("rev"), m.get("ops")
        if not isinstance(rev, int) or rev > p.rev or rev < p.rev - len(p.hist):
            c.send({"t": "resync", "page": self._page_msg(s, p, s.cur, c.who[0] == "t")})
            return
        try:
            base = len(p.code)
            for r, h in p.hist:                       # правки, принятые после той ревизии, которую видел браузер
                if r > rev:
                    ops, _ = op_transform(ops, h)
            if not op_ok(ops, base):
                raise ValueError
            text = op_apply(p.code, ops)
        except (ValueError, TypeError):
            c.send({"t": "resync", "page": self._page_msg(s, p, s.cur, c.who[0] == "t")})
            return
        if len(text) > CODE_MAX:
            c.send({"t": "resync", "page": self._page_msg(s, p, s.cur, c.who[0] == "t"), "why": "long"})
            return
        p.code = text
        p.rev += 1
        p.hist.append((p.rev, ops))
        if len(p.hist) > HIST_KEEP:
            del p.hist[:len(p.hist) - HIST_KEEP]
        s.dirty = True
        c.send({"t": "ack", "rev": p.rev})
        self._bcast(s, {"t": "op", "rev": p.rev, "ops": ops, "cid": c.cid}, skip=c)
