"""Слияние баз после аварии: старый сервер (до аварии) + новый, поднятый из копии."""
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server  # noqa: E402


def student(db, name, ts, cls=None):
    return db.execute("INSERT INTO students(name, name_key, token, created, last_seen, pw, class_id) VALUES(?,?,?,?,?,?,?)",
                      (name, name.lower(), f"tok-{name}-{ts}", ts, ts, "hash", cls)).lastrowid


def attempt(db, sid, ts, task="b:5"):
    db.execute("INSERT INTO attempts(student_id, ts, task_id, n, score) VALUES(?,?,?,5,1)", (sid, ts, task))


class MergeTest(unittest.TestCase):
    def test_merge_after_failover(self):
        tmp = Path(tempfile.mkdtemp())
        base = tmp / "base.db"
        server.DB(base).conn.close()                     # настоящая схема базы
        db = sqlite3.connect(base)
        cls = db.execute("INSERT INTO classes(name, created) VALUES('11А', 100)").lastrowid
        a = student(db, "Аистов Антон", 100, cls)
        b = student(db, "Бобров Борис", 100, cls)
        attempt(db, a, 150)
        db.commit()
        db.close()
        shutil.copy(base, tmp / "backup.db")             # резервная копия «9 октября»

        old = sqlite3.connect(base)                      # старый сервер работал ещё «до 13-го»
        c = student(old, "Воронов Виктор", 2000, cls)
        attempt(old, a, 2100)
        attempt(old, c, 2200)
        old.execute("DELETE FROM students WHERE id=?", (b,))   # учитель удалил Боброва
        old.commit()
        old.close()

        new = sqlite3.connect(tmp / "backup.db")         # новый сервер из копии, «с 14-го»
        d = student(new, "Голубев Глеб", 5000, cls)     # получит тот же номер, что Воронов на старом
        self.assertEqual(d, c)
        attempt(new, a, 5100)
        attempt(new, d, 5200)
        attempt(new, b, 5300)                            # Бобров ещё успел позаниматься на новом
        aid = new.execute("INSERT INTO assignments(class_id, title, tasks, created, kind) VALUES(?, 'ДЗ', '[]', 5050, 'home')",
                          (cls,)).lastrowid
        new.execute("INSERT INTO asg_runs(asg_id, student_id, started, last) VALUES(?,?,5060,5070)", (aid, d))
        new.execute("INSERT INTO support(student_id, ts, text) VALUES(?, 5400, 'не грузится 27')", (d,))
        new.execute("INSERT INTO duels(a, b, tasks, created, status) VALUES(?,?, '[]', 5500, 'pending')", (d, a))
        new.execute("UPDATE students SET last_seen=5600, pw='newhash' WHERE id=?", (a,))
        new.commit()
        new.close()

        out = tmp / "merged.db"
        r = subprocess.run([sys.executable, str(ROOT / "merge_db.py"), str(base), str(tmp / "backup.db"), str(out)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        m = sqlite3.connect(out)
        names = {n: i for i, n in m.execute("SELECT id, name FROM students")}
        self.assertEqual(set(names), {"Аистов Антон", "Воронов Виктор", "Голубев Глеб"})   # удалённый не вернулся
        self.assertNotEqual(names["Голубев Глеб"], names["Воронов Виктор"])
        per = dict(m.execute("SELECT student_id, COUNT(*) FROM attempts GROUP BY student_id").fetchall())
        self.assertEqual(per[names["Аистов Антон"]], 3)          # копия + старый + новый
        self.assertEqual(per[names["Воронов Виктор"]], 1)
        self.assertEqual(per[names["Голубев Глеб"]], 1)          # не приклеился к Воронову
        self.assertEqual(m.execute("SELECT COUNT(*) FROM attempts").fetchone()[0], 5)   # попытка Боброва не перенесена
        g = names["Голубев Глеб"]
        new_aid = m.execute("SELECT id FROM assignments WHERE title='ДЗ'").fetchone()[0]
        self.assertEqual(m.execute("SELECT student_id FROM asg_runs WHERE asg_id=?", (new_aid,)).fetchone()[0], g)
        self.assertEqual(m.execute("SELECT student_id FROM support").fetchone()[0], g)
        self.assertEqual(m.execute("SELECT a, b FROM duels").fetchone(), (g, names["Аистов Антон"]))
        self.assertEqual(m.execute("SELECT pw FROM students WHERE id=?", (names["Аистов Антон"],)).fetchone()[0], "newhash")
        # исходные базы не изменились
        self.assertEqual(sqlite3.connect(base).execute("SELECT COUNT(*) FROM attempts").fetchone()[0], 3)
        # проверка без записи
        r = subprocess.run([sys.executable, str(ROOT / "merge_db.py"), str(base), str(tmp / "backup.db"), str(tmp / "x.db"),
                            "--dry-run"], capture_output=True, text=True)
        self.assertIn("attempts: +2", r.stdout)     # Аистов и Голубев; попытка удалённого Боброва — нет
        self.assertFalse((tmp / "x.db").exists())


if __name__ == "__main__":
    unittest.main()
