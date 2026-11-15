"""КИМ ЕГЭ-2027: перенумерация банка (10→13, 13→23, 23 → архив 23_old), перенос номеров в базе,
опыт по старым ответам — по прежним номерам, новые задания №10 «поиск слова в тексте»."""
import json
import re
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import clusters  # noqa: E402
import kim  # noqa: E402


class RenumberTest(unittest.TestCase):
    def test_bank_tasks_move_once(self):
        tasks = [{"id": "a", "n": 10}, {"id": "b", "n": 13}, {"id": "c", "n": 23}, {"id": "d", "n": 5},
                 {"id": "e", "n": 10, "kim": 2027}]
        kim.renumber(tasks)
        self.assertEqual([t["n"] for t in tasks], [13, 23, 28, 5, 10])
        kim.renumber(tasks)                     # повторно (банк перечитан) — номера не «уезжают» дальше
        self.assertEqual([t["n"] for t in tasks], [13, 23, 28, 5, 10])
        self.assertEqual(kim.label(28), "23_old")
        self.assertEqual(kim.label(23), "23")

    def test_clusters_follow_new_numbers(self):
        ip = {"n": 13, "html": "<p>Сколько адресов в сети с маской 255.255.255.0?</p>"}
        prog = {"n": 23, "html": "<p>Сколько существует программ, которые преобразуют число 2 в число 20?</p>"}
        graph = {"n": 28, "html": "<p>В файле описан граф. Определите количество путей из вершины 1 в вершину 9.</p>"}
        text = {"n": 10, "html": "<p>Определите, сколько раз в тексте главы III встречается отдельное слово «лес».</p>"}
        self.assertEqual(clusters.classify(ip), "count")
        self.assertEqual(clusters.classify(prog), "programs")
        self.assertEqual(clusters.classify(graph), "count")
        self.assertEqual(clusters.classify(text), "chapter")
        self.assertIn(28, clusters.catalog())


class MigrateTest(unittest.TestCase):
    def db(self):
        c = sqlite3.connect(":memory:")
        c.row_factory = sqlite3.Row
        c.executescript("""
            CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE attempts(id INTEGER PRIMARY KEY, n INTEGER, rk TEXT, ts REAL);
            CREATE TABLE course_seen(student_id INTEGER, n INTEGER, slide INTEGER, total INTEGER, ts REAL, PRIMARY KEY(student_id, n));
            CREATE TABLE tour_votes(tour_id INTEGER, student_id INTEGER, n INTEGER, PRIMARY KEY(tour_id, student_id, n));
            CREATE TABLE attempts_void(id INTEGER PRIMARY KEY, row TEXT);
            CREATE TABLE tournaments(id INTEGER PRIMARY KEY, nums TEXT);
            CREATE TABLE duel_queue(student_id INTEGER PRIMARY KEY, nums TEXT);
        """)
        return c

    def test_numbers_move_without_mixing(self):
        c = self.db()
        c.executemany("INSERT INTO attempts(n, rk, ts) VALUES(?,?,1)",
                      [(10, "10|mask"), (13, "13|programs"), (23, "23|count"), (5, "5|bin"), (13, None)])
        c.executemany("INSERT INTO course_seen VALUES(1,?,3,10,1)", [(13,), (23,)])
        c.executemany("INSERT INTO tour_votes VALUES(1,1,?)", [(10,), (13,), (23,)])
        c.execute("INSERT INTO attempts_void(row) VALUES(?)", (json.dumps({"n": 13, "rk": "13|traj"}),))
        c.execute("INSERT INTO tournaments(nums) VALUES(?)", (json.dumps([10, 13, 23, 24]),))
        c.execute("INSERT INTO duel_queue VALUES(7, ?)", (json.dumps([23, 1]),))
        self.assertTrue(kim.migrate_db(c))
        rows = [(r["n"], r["rk"]) for r in c.execute("SELECT n, rk FROM attempts ORDER BY id")]
        self.assertEqual(rows, [(13, "13|mask"), (23, "23|programs"), (28, "28|count"), (5, "5|bin"), (23, None)])
        self.assertEqual(sorted(r["n"] for r in c.execute("SELECT n FROM course_seen")), [23, 28])
        self.assertEqual(sorted(r["n"] for r in c.execute("SELECT n FROM tour_votes")), [13, 23])   # архив в турнирах не голосуют
        row = json.loads(c.execute("SELECT row FROM attempts_void").fetchone()["row"])
        self.assertEqual((row["n"], row["rk"]), (23, "23|traj"))
        self.assertEqual(json.loads(c.execute("SELECT nums FROM tournaments").fetchone()["nums"]), [13, 23, 24])
        self.assertEqual(json.loads(c.execute("SELECT nums FROM duel_queue").fetchone()["nums"]), [1])
        # второй запуск ничего не трогает
        self.assertFalse(kim.migrate_db(c))
        self.assertEqual([r["n"] for r in c.execute("SELECT n FROM attempts ORDER BY id")], [13, 23, 28, 5, 23])

    def test_old_answers_keep_old_reward_numbers(self):
        c = self.db()
        kim.migrate_db(c)
        since = kim.SINCE
        self.assertGreater(since, 1.7e9)              # время перехода, а не номер из цикла переноса
        self.assertEqual(float(c.execute("SELECT value FROM settings WHERE key='kim2027'").fetchone()[0]), since)
        # ответ до перехода: IP (теперь №13) — опыт как за №10; программы (теперь №23) — как за №13; графы — как за №23
        self.assertEqual(kim.score_num(13, since - 5), 10)
        self.assertEqual(kim.score_num(23, since - 5), 13)
        self.assertEqual(kim.score_num(28, since - 5), 23)
        # после перехода — новые номера; архив 23_old по-прежнему как №23
        self.assertEqual(kim.score_num(13, since + 5), 13)
        self.assertEqual(kim.score_num(23, since + 5), 23)
        self.assertEqual(kim.score_num(28, since + 5), 23)
        self.assertEqual(kim.score_num(10, since + 5), 10)


class TextSearchTasksTest(unittest.TestCase):
    def test_hundred_tasks_with_files_and_correct_answers(self):
        data = json.loads((ROOT / "data" / "egeshka_bank.json").read_text(encoding="utf-8"))
        self.assertEqual(data["bank"]["count"], len(data["tasks"]))
        ts = [t for t in data["tasks"] if t["id"].startswith("egeshka_bank:e10t-")]
        self.assertEqual(len(ts), 100)
        texts = {}
        for t in ts:
            self.assertEqual((t["n"], t["kim"]), (10, 2027))
            names = [a["name"] for a in t["att"]]
            self.assertEqual(names, ["10.docx", "10.txt"])
            for a in t["att"]:
                self.assertTrue((ROOT / a["href"]).is_file(), a["href"])
            txt = t["att"][1]["href"]
            texts.setdefault(txt, (ROOT / txt).read_text(encoding="utf-8"))
        # ответ «отдельного слова в главе» проверяем независимо: слово целиком, без учёта регистра
        checked = 0
        for t in ts:
            q = clusters.plain(t["html"])
            m = re.search(r"отдельное слово «([^»]+)».*? в тексте главы ([ivx]+) ", q)
            if not m or "регистр" in q:
                continue
            word, ch = m.group(1), m.group(2).upper()
            parts = re.split(r"^Глава ([IVX]+)$", texts[t["att"][1]["href"]], flags=re.M)
            body = dict(zip(parts[1::2], parts[2::2]))[ch]
            n = len(re.findall(r"(?<![А-Яа-яЁёA-Za-z\-])" + re.escape(word) + r"(?![А-Яа-яЁёA-Za-z\-])", body, flags=re.I))
            self.assertEqual(str(n), t["ans"], t["id"])
            checked += 1
        self.assertGreater(checked, 20)


class ArchiveLessonTest(unittest.TestCase):
    def test_graph_lesson_is_archive(self):
        d = json.loads((ROOT / "course" / "28.json").read_text(encoding="utf-8"))
        self.assertEqual(d["n"], 28)
        self.assertIn("23_old", d["title"])
        self.assertFalse((ROOT / "course" / "23.json").exists())   # №23 — исполнитель: краткий разбор, не урок про графы
        for sl in d["slides"]:
            for f in sl.get("files") or []:
                self.assertTrue(f["url"].startswith("course-data/28/"))
                self.assertTrue((ROOT / "course" / "data" / f["url"][len("course-data/"):].split("?")[0]).is_file())


if __name__ == "__main__":
    unittest.main()
