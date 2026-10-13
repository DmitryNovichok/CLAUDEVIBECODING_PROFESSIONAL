"""Слияние двух баз тренажёра после аварии сервера.

Сценарий: старый сервер упал; новый подняли из резервной копии и ученики продолжили заниматься на нём.
Потом старый сервер ожил — в его базе есть то, что было после копии (старое), а в базе нового — то, что
было после переезда (новое). Скрипт берёт базу старого сервера целиком и добавляет в неё всё новое
с нового сервера: учеников, попытки, варианты, подборки, обращения, дуэли и турниры.

    python3 merge_db.py СТАРАЯ.db НОВАЯ.db ИТОГ.db            # слить
    python3 merge_db.py СТАРАЯ.db НОВАЯ.db ИТОГ.db --dry-run  # только показать, что будет добавлено

Обе исходные базы не меняются — результат пишется в третий файл.
«Новым» считается всё, что на новом сервере появилось позже последней активности на старом
(эту границу скрипт находит сам; можно задать вручную: --since "2026-10-14 08:00").
Учеников сопоставляет по ФИО (а не по номеру): номера на двух серверах могли совпасть у разных людей.
"""
import argparse
import shutil
import sqlite3
import sys
from datetime import datetime


def cols(db, table):
    return [r[1] for r in db.execute(f"PRAGMA table_info({table})")]


def tables(db):
    return {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


class Merge:
    def __init__(self, out, new, since, dry):
        self.out, self.new, self.since, self.dry = out, new, since, dry
        self.both = tables(out) & tables(new)
        self.sid, self.tid, self.cid, self.aid, self.tour = {}, {}, {}, {}, {}
        self.report = {}

    # ---------------------------------------------------------------- общие помощники
    def common(self, table):
        have = set(cols(self.out, table))
        return [c for c in cols(self.new, table) if c in have]

    def rows(self, table, where="1", args=()):
        if table not in self.both:
            return []
        return self.new.execute(f"SELECT * FROM {table} WHERE {where}", args).fetchall()

    def insert(self, table, row, fix=None, mode="INSERT", drop_id=True):
        """Строку с нового сервера — в итоговую базу; fix — замены значений (уже пересчитанные номера)."""
        names = [c for c in self.common(table) if not (drop_id and c == "id")]
        vals = dict(row)
        for c, v in (fix or {}).items():
            # ученик, подборка или класс без пары в итоговой базе (например, удалён учителем) — строку не переносим
            if v is None and vals.get(c) is not None and c in ("student_id", "asg_id", "class_id", "tour_id", "a", "b"):
                return None
        vals.update(fix or {})
        cur = self.out.execute(f"{mode} INTO {table}({','.join(names)}) VALUES({','.join('?' * len(names))})",
                               [vals.get(c) for c in names])
        if cur.rowcount > 0:
            self.report[table] = self.report.get(table, 0) + 1
        return cur.lastrowid

    def m(self, mp, v):
        """Номер с нового сервера → номер в итоговой базе; нет пары — None."""
        return None if v is None else mp.get(v)

    # ---------------------------------------------------------------- по таблицам
    def teachers(self):
        if "teachers" not in self.both:
            return
        for t in self.rows("teachers"):
            old = self.out.execute("SELECT id FROM teachers WHERE login=?", (t["login"],)).fetchone()
            if old:
                self.tid[t["id"]] = old[0]
            else:
                inv = t["invite"]
                if self.out.execute("SELECT 1 FROM teachers WHERE invite=?", (inv,)).fetchone():
                    inv = f"{inv}-2"
                self.tid[t["id"]] = self.insert("teachers", t, {"invite": inv})

    def classes(self):
        for c in self.rows("classes"):
            if (c["created"] or 0) > self.since:
                self.cid[c["id"]] = self.insert("classes", c, {"teacher_id": self.m(self.tid, c["teacher_id"])}
                                                if "teacher_id" in c.keys() else None)
            elif self.out.execute("SELECT 1 FROM classes WHERE id=?", (c["id"],)).fetchone():
                self.cid[c["id"]] = c["id"]          # класс из копии: номер тот же, что на старом сервере

    def students(self):
        for s in self.rows("students"):
            old = self.out.execute("SELECT * FROM students WHERE name_key=?", (s["name_key"],)).fetchone()
            if old:
                self.sid[s["id"]] = old["id"]
                if (s["last_seen"] or 0) > self.since:
                    # ученик заходил на новый сервер: там его действующий пароль и вход; последний визит — свежий
                    keep = {k: s[k] for k in ("pw", "token", "consent_ver", "consent_ts", "consent_ip", "prefs",
                                              "forecast", "fc", "badges", "last_seen") if k in s.keys()}
                    if "class_id" in s.keys() and old["class_id"] is None and s["class_id"] is not None:
                        keep["class_id"] = self.m(self.cid, s["class_id"])
                    names = [k for k in keep if k in self.common("students")]
                    if names:
                        try:
                            self.out.execute(f"UPDATE students SET {', '.join(k + '=?' for k in names)} WHERE id=?",
                                             [keep[k] for k in names] + [old["id"]])
                            self.report["students (обновлены)"] = self.report.get("students (обновлены)", 0) + 1
                        except sqlite3.IntegrityError:   # такой же токен уже у кого-то — оставляем старый вход
                            pass
            elif (s["created"] or 0) > self.since:
                fix = {"class_id": self.m(self.cid, s["class_id"]) if "class_id" in s.keys() else None,
                       "teacher_id": self.m(self.tid, s["teacher_id"]) if "teacher_id" in s.keys() else None}
                self.sid[s["id"]] = self.insert("students", s, fix)
            # ученик есть в копии, но не на старом сервере — его там удалил учитель; не возвращаем

    def assignments(self):
        for a in self.rows("assignments"):
            if (a["created"] or 0) > self.since:
                fix = {"class_id": self.m(self.cid, a["class_id"])}
                if "student_id" in a.keys():
                    fix["student_id"] = self.m(self.sid, a["student_id"])
                self.aid[a["id"]] = self.insert("assignments", a, fix)
            elif self.out.execute("SELECT 1 FROM assignments WHERE id=?", (a["id"],)).fetchone():
                self.aid[a["id"]] = a["id"]          # подборка из копии: номер тот же
                if "closed" in a.keys() and a["closed"] and a["closed"] > self.since:
                    self.out.execute("UPDATE assignments SET closed=COALESCE(closed, ?) WHERE id=?", (a["closed"], a["id"]))

    def log_table(self, table, tcol, extra=None):
        """Журналы с автономером: добавляем строки новее границы, номера ученика (и подборки) пересчитываем."""
        if table not in self.both:
            return
        for r in self.rows(table, f"{tcol} > ?", (self.since,)):
            fix = {"student_id": self.m(self.sid, r["student_id"])} if "student_id" in r.keys() else {}
            for col, mp in (extra or {}).items():
                fix[col] = self.m(mp, r[col])
            self.insert(table, r, fix)

    def keyed(self, table, tcol, key_fix, mode="INSERT OR IGNORE"):
        """Таблицы с составным ключом: новые строки (или более свежие — mode='INSERT OR REPLACE')."""
        if table not in self.both:
            return
        for r in self.rows(table, f"{tcol} > ?", (self.since,)):
            self.insert(table, r, {c: self.m(mp, r[c]) for c, mp in key_fix.items()}, mode=mode, drop_id=False)

    def exams(self):
        for r in self.rows("exams", "started > ?", (self.since,)):
            self.insert("exams", r, {"student_id": self.m(self.sid, r["student_id"])}, mode="INSERT OR IGNORE",
                        drop_id=False)

    def asg_runs(self):
        for r in self.rows("asg_runs", "COALESCE(last, finished, started, 0) > ?", (self.since,)):
            self.insert("asg_runs", r, {"asg_id": self.m(self.aid, r["asg_id"]), "student_id": self.m(self.sid, r["student_id"])},
                        mode="INSERT OR REPLACE", drop_id=False)

    def solutions(self):
        for table, key in (("solutions", "student_id"), ("tsolutions", "teacher_id")):
            for r in self.rows(table, "ts > ?", (self.since,)):
                mp = self.sid if key == "student_id" else self.tid
                self.insert(table, r, {key: self.m(mp, r[key])}, mode="INSERT OR REPLACE", drop_id=False)
        for r in self.rows("teacher_solutions", "ts > ?", (self.since,)):
            self.insert("teacher_solutions", r, mode="INSERT OR REPLACE", drop_id=False)

    def leagues(self):
        for r in self.rows("leagues"):
            me = self.m(self.sid, r["student_id"])
            if me is None:
                continue
            old = self.out.execute("SELECT week FROM leagues WHERE student_id=?", (me,)).fetchone()
            if old is None or (r["week"] or "") > (old[0] or ""):
                self.insert("leagues", r, {"student_id": me}, mode="INSERT OR REPLACE", drop_id=False)

    def support(self):
        for r in self.rows("support"):
            me = self.m(self.sid, r["student_id"])
            if me is None:
                continue
            if r["ts"] > self.since:
                self.insert("support", r, {"student_id": me})
            elif r["answered"] and r["answered"] > self.since:     # на старое обращение ответили на новом сервере
                self.out.execute("""UPDATE support SET answer=?, answered=?, status=?, seen=? WHERE student_id=? AND ts=?""",
                                 (r["answer"], r["answered"], r["status"], r["seen"], me, r["ts"]))

    def duels(self):
        for r in self.rows("duels", "created > ?", (self.since,)):
            self.insert("duels", r, {c: self.m(self.sid, r[c]) for c in ("a", "b", "winner")})

    def tournaments(self):
        for t in self.rows("tournaments", "created > ?", (self.since,)):
            self.tour[t["id"]] = self.insert("tournaments", t, {"teacher_id": self.m(self.tid, t["teacher_id"])})
        for r in self.rows("tour_players"):
            if r["tour_id"] in self.tour:
                self.insert("tour_players", r, {"tour_id": self.tour[r["tour_id"]], "student_id": self.m(self.sid, r["student_id"])},
                            drop_id=False)
        for r in self.rows("tour_matches"):
            if r["tour_id"] in self.tour:
                self.insert("tour_matches", r, {"tour_id": self.tour[r["tour_id"]],
                                                **{c: self.m(self.sid, r[c]) for c in ("a", "b", "winner")}})

    def settings(self):
        for r in self.rows("settings"):
            self.insert("settings", r, mode="INSERT OR IGNORE", drop_id=False)   # у старого сервера — приоритет

    def run(self):
        self.out.execute("BEGIN")
        self.teachers()
        self.classes()
        self.students()
        self.assignments()
        self.log_table("attempts", "ts")
        self.log_table("reveal_log", "ts")
        self.log_table("activity", "ts")
        self.log_table("xp_adjust", "ts")
        self.log_table("asg_events", "ts", {"asg_id": self.aid})
        self.exams()
        self.asg_runs()
        self.solutions()
        self.leagues()
        self.keyed("daily_results", "ts", {"student_id": self.sid})
        self.keyed("daily_starts", "ts", {"student_id": self.sid})
        self.keyed("course_seen", "ts", {"student_id": self.sid}, mode="INSERT OR REPLACE")
        self.keyed("visits", "ts", {})
        for r in self.rows("awards"):
            self.insert("awards", r, {"student_id": self.m(self.sid, r["student_id"])}, mode="INSERT OR IGNORE", drop_id=False)
        self.support()
        self.duels()
        self.tournaments()
        self.settings()
        if self.dry:
            self.out.execute("ROLLBACK")
        else:
            self.out.execute("COMMIT")


def last_activity(db):
    """Последняя активность на сервере — всё на другом сервере позже неё считается новым."""
    best = 0.0
    for table, col in (("attempts", "ts"), ("activity", "ts"), ("students", "last_seen"), ("students", "created"),
                       ("support", "ts"), ("exams", "started"), ("asg_runs", "last"), ("reveal_log", "ts")):
        try:
            v = db.execute(f"SELECT MAX({col}) FROM {table}").fetchone()[0]
        except sqlite3.OperationalError:
            continue
        best = max(best, v or 0)
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("old", help="база старого сервера (в ней — всё до аварии)")
    ap.add_argument("new", help="база нового сервера (копия + то, что было после переезда)")
    ap.add_argument("out", help="куда записать итог")
    ap.add_argument("--since", help='граница «нового», например "2026-10-14 08:00"; по умолчанию — последняя активность на старом')
    ap.add_argument("--dry-run", action="store_true", help="ничего не записывать, только показать")
    a = ap.parse_args()

    src = sqlite3.connect(f"file:{a.old}?mode=ro", uri=True)
    if a.dry_run:
        out = sqlite3.connect(":memory:")
        src.backup(out)
    else:
        if a.out in (a.old, a.new):
            sys.exit("Итог нужно писать в отдельный файл — исходные базы не трогаем")
        out = sqlite3.connect(a.out)
        src.backup(out)                     # копия старой базы вместе с журналом WAL
    out.isolation_level = None
    out.row_factory = sqlite3.Row
    new = sqlite3.connect(f"file:{a.new}?mode=ro", uri=True)
    new.row_factory = sqlite3.Row

    since = datetime.strptime(a.since, "%Y-%m-%d %H:%M").timestamp() if a.since else last_activity(src)
    print(f"Новым считается всё после {datetime.fromtimestamp(since):%d.%m.%Y %H:%M}")
    mg = Merge(out, new, since, a.dry_run)
    mg.run()
    if not mg.report:
        print("На новом сервере нет ничего нового — итог совпадает со старой базой.")
    for k, v in sorted(mg.report.items()):
        print(f"  {k}: +{v}")
    print("Проверка без записи — файл не создан." if a.dry_run else f"Готово: {a.out}")


if __name__ == "__main__":
    main()
