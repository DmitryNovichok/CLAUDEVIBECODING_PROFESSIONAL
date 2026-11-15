"""Нумерация КИМ ЕГЭ по информатике на сайте — по демоверсии-2027 (ФИПИ).

Банк (data/bank.js) собран в нумерации 2026 года. При загрузке сервер переносит задания:
  №10 (IP-адреса и маски)          → №13;
  №13 (исполнитель, число программ) → №23;
  №23 (пути в графе из файла)       → архив, на сайте «23_old» (внутренний номер 28).
Новое №10 — поиск слова в тексте (авторские задания Egeshka, у них "kim": 2027 — их не трогаем).

Архивные номера не входят в вариант ЕГЭ, прогноз, ежедневные задачи, дуэли и турниры, но решать их можно.
"""

KIM_YEAR = 2027
REMAP_2026 = {10: 13, 13: 23, 23: 28}
ARCHIVE = {28: "23_old"}          # внутренний номер → как показывать
EXAM_NUMS = tuple(range(1, 28))
ALL_NUMS = EXAM_NUMS + tuple(ARCHIVE)


def label(n):
    return ARCHIVE.get(n, str(n))


INVERSE = {v: k for k, v in REMAP_2026.items()}
SINCE = 0.0                       # когда база перешла на нумерацию 2027 (settings.kim2027); ставит migrate_db


def score_num(n, ts):
    """Номер, по которому считаются опыт, ₿ и достижения ответа в момент ts. Ответы до перехода — по прежнему номеру
    (иначе у учеников задним числом изменились бы опыт и монеты); архивное 23_old — как №23, как и было."""
    if ts is not None and ts < SINCE:
        return INVERSE.get(n, n)
    return 23 if n in ARCHIVE else n


def remap(n):
    """Номер 2026 года → номер на сайте."""
    return REMAP_2026.get(n, n)


def renumber(tasks):
    """Переносит задания банка в нумерацию 2027 (на месте). Задания с "kim": 2027 уже в ней."""
    for t in tasks:
        if t.get("kim") == KIM_YEAR:
            continue
        n = t.get("n")
        if n in REMAP_2026:
            t["n"] = REMAP_2026[n]
            t["kim"] = KIM_YEAR
    return tasks


# Порядок обновлений базы: сначала освобождаем 23 (→ 28), потом 13 → 23, потом 10 → 13 — номера не смешиваются
MIGRATE_ORDER = ((23, 28), (13, 23), (10, 13))


def remap_rk(rk):
    """Ключ повторения «n|тип» → в новой нумерации."""
    if not rk or "|" not in rk:
        return rk
    head, tail = rk.split("|", 1)
    return f"{remap(int(head))}|{tail}" if head.isdigit() else rk


def migrate_db(c):
    """Один раз (флаг kim2027 в settings) переносит номера в базе: журнал попыток и его корзина, прогресс курса,
    голоса турниров, номера турниров и очереди дуэлей. c — соединение sqlite3 с row_factory = Row."""
    import json
    import time
    global SINCE
    row = c.execute("SELECT value FROM settings WHERE key='kim2027'").fetchone()
    if row:
        try:
            SINCE = float(row[0])
        except (TypeError, ValueError):
            SINCE = 0.0
        return False
    now = time.time()
    for was, new in MIGRATE_ORDER:
        c.execute("UPDATE attempts SET n=? WHERE n=?", (new, was))
        c.execute("UPDATE attempts SET rk=? || substr(rk, ?) WHERE rk LIKE ?", (f"{new}|", len(f"{was}|") + 1, f"{was}|%"))
        c.execute("UPDATE OR IGNORE course_seen SET n=? WHERE n=?", (new, was))
        c.execute("DELETE FROM course_seen WHERE n=?", (was,))
        c.execute("UPDATE OR IGNORE tour_votes SET n=? WHERE n=?", (new, was))
        c.execute("DELETE FROM tour_votes WHERE n=?", (was,))
    c.execute("DELETE FROM tour_votes WHERE n IN (%s)" % ",".join("?" * len(ARCHIVE)), tuple(ARCHIVE))
    for r in c.execute("SELECT id, row FROM attempts_void").fetchall():
        try:
            row = json.loads(r["row"])
        except ValueError:
            continue
        if isinstance(row, dict) and isinstance(row.get("n"), int) and row.get("kim") != KIM_YEAR:
            row["n"], row["rk"], row["kim"] = remap(row["n"]), remap_rk(row.get("rk")), KIM_YEAR
            c.execute("UPDATE attempts_void SET row=? WHERE id=?", (json.dumps(row, ensure_ascii=False), r["id"]))
    for table, key in (("tournaments", "id"), ("duel_queue", "student_id")):
        for r in c.execute(f"SELECT {key} k, nums FROM {table} WHERE nums IS NOT NULL AND nums != ''").fetchall():
            try:
                nums = json.loads(r["nums"])
            except ValueError:
                continue
            if not isinstance(nums, list):
                continue
            new = [x for x in (remap(x) if isinstance(x, int) else x for x in nums) if x not in ARCHIVE]
            if new != nums:
                c.execute(f"UPDATE {table} SET nums=? WHERE {key}=?", (json.dumps(new), r["k"]))
    c.execute("INSERT INTO settings(key, value) VALUES('kim2027', ?)", (repr(now),))
    SINCE = now
    return True
