"""«Интеллектуальный мегаполис. Потенциал» (ИТ-класс, теория): тренировка по 10 номерам и пробный вариант на 120 минут.

Банк — data/im_bank.json (tools/im_gen.py): номера с разбором и демо-заданием, тренировочные задания с ответами.
Ответы и решения уходят ученику только после его ответа (тренировка) или после сдачи варианта.
Раздел открывается своим паролем (settings.im_pw, students.im) — как лаборатория Arduino.
"""
import json
import random
import re
import time
from pathlib import Path

BANK_PATH = Path(__file__).resolve().parent / "data" / "im_bank.json"
TRIAL_GRACE = 60                      # на отправку после конца времени

_BANK = {"mtime": None, "data": None, "by_id": {}}


def bank():
    try:
        mt = BANK_PATH.stat().st_mtime
    except OSError:
        return None
    if _BANK["mtime"] != mt:
        data = json.loads(BANK_PATH.read_text(encoding="utf-8"))
        _BANK.update(mtime=mt, data=data, by_id={t["id"]: t for t in data["tasks"]})
    return _BANK["data"]


def task(tid):
    bank()
    return _BANK["by_id"].get(tid)


def slot_info(s, with_demo_answer=True):
    """Номер плана для страницы: тема, уровень, баллы, разбор и демо-задание (официальный демовариант — с ответом)."""
    out = {k: s[k] for k in ("n", "subj", "level", "points", "title", "topic", "idea", "steps", "mistakes")}
    d = s["demo"]
    out["demo"] = {"html": d["html"], "kind": d["kind"]}
    if with_demo_answer:
        out["demo"].update(ans=d.get("val") or d["ans"], key=d["ans"], sol=d["sol"])
    return out


def public(t):
    return {"id": t["id"], "slot": t["slot"], "kind": t["kind"], "html": t["html"]}


def overview(with_demo_answer=True):
    b = bank()
    if not b:
        return None
    return {"title": b["title"], "track": b["track"], "minutes": b["minutes"], "max": b["max"], "rules": b["rules"],
            "subjects": b["subjects"], "source": b["source"],
            "slots": [slot_info(s, with_demo_answer) for s in b["slots"]],
            "count": {s["n"]: sum(1 for t in b["tasks"] if t["slot"] == s["n"]) for s in b["slots"]}}


# ---------------------------------------------------------------- проверка ответа
_LETTERS = {"а": 1, "б": 2, "в": 3, "г": 4, "д": 5, "a": 1, "b": 2, "c": 3, "d": 4}


def _nums(s):
    return [x for x in re.split(r"[;,\s]+", str(s).strip()) if x]


def _num(x):
    try:
        return float(str(x).replace(",", "."))
    except ValueError:
        return None


def check(t, answer):
    """Совпал ли ответ с эталоном. Выбор: номер варианта, буква (А–Г) или само значение варианта."""
    a = str(answer or "").strip().lower().rstrip(".)")
    if not a:
        return False
    if t["kind"] == "choice":
        if a in _LETTERS:
            a = str(_LETTERS[a])
        return a == t["ans"] or (bool(t.get("val")) and a.replace(" ", "") == t["val"])
    if t["kind"] == "num":
        x, y = _num(a.replace(" ", "")), _num(t["ans"])
        return x is not None and y is not None and abs(x - y) < 1e-9
    want = _nums(t["ans"])
    got = _nums(a)
    if len(got) != len(want):
        return False
    return all(_num(g) is not None and abs(_num(g) - _num(w)) < 1e-9 for g, w in zip(got, want))


def shown_answer(t):
    return t.get("val") or t["ans"]


# ---------------------------------------------------------------- тренировка
def stats(db, sid):
    """По номерам: попыток, верных, последние 5 (1/0) — в тренировке и вариантах."""
    out = {}
    for r in db.q("SELECT slot, ok FROM im_attempts WHERE student_id=? ORDER BY ts, id", (sid,)):
        s = out.setdefault(str(r["slot"]), {"tries": 0, "ok": 0, "last": []})
        s["tries"] += 1
        s["ok"] += r["ok"]
        s["last"] = (s["last"] + [r["ok"]])[-5:]
    return out


def pick(db, sid, slot):
    """Следующее задание номера: сначала ещё не решённые верно, среди них — реже встречавшиеся."""
    b = bank()
    pool = [t for t in b["tasks"] if t["slot"] == slot]
    if not pool:
        return None
    seen = {}
    for r in db.q("SELECT task_id, ok FROM im_attempts WHERE student_id=? AND slot=?", (sid, slot)):
        cur = seen.setdefault(r["task_id"], [0, 0])
        cur[0] += 1
        cur[1] |= r["ok"]
    fresh = [t for t in pool if t["id"] not in seen]
    if fresh:
        return random.choice(fresh)
    unsolved = [t for t in pool if not seen[t["id"]][1]]
    return random.choice(unsolved or pool)


def answer(db, sid, tid, ans, trial_id=None):
    t = task(tid)
    if not t:
        return None
    ok = check(t, ans)
    db.x("INSERT INTO im_attempts(student_id, task_id, slot, ok, answer, ts, trial_id) VALUES(?,?,?,?,?,?,?)",
         (sid, tid, t["slot"], int(ok), str(ans)[:120], time.time(), trial_id))
    return {"ok": ok, "ans": shown_answer(t), "sol": t["sol"]}


# ---------------------------------------------------------------- пробный вариант
def trial_row(db, sid, trial_id):
    return db.q("SELECT * FROM im_trials WHERE id=? AND student_id=?", (trial_id, sid), one=True)


def trial_active(db, sid):
    for r in db.q("SELECT * FROM im_trials WHERE student_id=? AND finished IS NULL ORDER BY id DESC", (sid,)):
        if r["deadline"] + TRIAL_GRACE > time.time():
            return r
        trial_finish(db, sid, r)                       # время вышло — сдаётся по сохранённым ответам
    return None


def trial_start(db, sid):
    cur = trial_active(db, sid)
    if cur:
        return cur
    b = bank()
    items = [random.choice([t for t in b["tasks"] if t["slot"] == s["n"]])["id"] for s in b["slots"]]
    now = time.time()
    tid = db.x("INSERT INTO im_trials(student_id, started, deadline, items, answers) VALUES(?,?,?,?,?)",
               (sid, now, now + b["minutes"] * 60, json.dumps(items), "{}"))
    return trial_row(db, sid, tid)


def trial_public(r):
    items = json.loads(r["items"])
    return {"id": r["id"], "started": r["started"], "deadline": r["deadline"], "finished": r["finished"],
            "items": [public(task(i)) for i in items if task(i)], "answers": json.loads(r["answers"] or "{}")}


def clean_answers(r, answers):
    items = set(json.loads(r["items"]))
    if not isinstance(answers, dict):
        return {}
    return {k: str(v)[:120] for k, v in answers.items() if k in items and str(v).strip()}


def trial_save(db, sid, r, answers):
    if r["finished"]:
        return False
    db.x("UPDATE im_trials SET answers=? WHERE id=?", (json.dumps(clean_answers(r, answers), ensure_ascii=False), r["id"]))
    return True


def trial_finish(db, sid, r, answers=None):
    """Сдать вариант: баллы по номерам (как в спецификации — задание засчитывается целиком), ответы в журнал тренировки."""
    if r["finished"]:
        return trial_result(r)
    late = time.time() > r["deadline"] + TRIAL_GRACE
    if answers is not None and not late:
        trial_save(db, sid, r, answers)
    r = db.q("SELECT * FROM im_trials WHERE id=?", (r["id"],), one=True)
    ans = json.loads(r["answers"] or "{}")
    b = bank()
    pts = {s["n"]: s["points"] for s in b["slots"]}
    score = 0
    for i in json.loads(r["items"]):
        t = task(i)
        if not t:
            continue
        given = ans.get(i, "")
        ok = check(t, given) if given else False
        score += pts[t["slot"]] if ok else 0
        db.x("INSERT INTO im_attempts(student_id, task_id, slot, ok, answer, ts, trial_id) VALUES(?,?,?,?,?,?,?)",
             (sid, i, t["slot"], int(ok), given[:120], time.time(), r["id"]))
    db.x("UPDATE im_trials SET finished=?, score=? WHERE id=? AND finished IS NULL", (min(time.time(), r["deadline"]), score, r["id"]))
    return trial_result(db.q("SELECT * FROM im_trials WHERE id=?", (r["id"],), one=True))


def trial_result(r):
    ans = json.loads(r["answers"] or "{}")
    b = bank()
    pts = {s["n"]: s["points"] for s in b["slots"]}
    rows = []
    for i in json.loads(r["items"]):
        t = task(i)
        if not t:
            continue
        given = ans.get(i, "")
        ok = check(t, given) if given else False
        rows.append({"id": i, "slot": t["slot"], "points": pts[t["slot"]], "got": pts[t["slot"]] if ok else 0, "ok": ok,
                     "answer": given, "ans": shown_answer(t), "sol": t["sol"], "html": t["html"], "kind": t["kind"]})
    return {"id": r["id"], "started": r["started"], "finished": r["finished"], "score": r["score"] or 0, "max": b["max"],
            "minutes": round(((r["finished"] or r["deadline"]) - r["started"]) / 60), "rows": rows}


def trials(db, sid):
    return [{"id": r["id"], "started": r["started"], "finished": r["finished"], "score": r["score"]}
            for r in db.q("SELECT id, started, finished, score FROM im_trials WHERE student_id=? AND finished IS NOT NULL ORDER BY id DESC LIMIT 30", (sid,))]
