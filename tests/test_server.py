"""Тесты сервера: python -m unittest discover tests

Поднимают server.py на свободном порту с временной базой и маленьким банком заданий.
"""
import http.client
import json
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

BANK = {
    "generated": "test",
    "banks": [{"id": "b", "title": "Тест", "count": 4}],
    "tasks": [
        {"id": "b:5", "n": 5, "bank": "b", "html": "<p>Пять</p>", "ans": "12", "sol": "<p>решение</p>"},
        {"id": "b:6", "n": 6, "bank": "b", "html": "<p>Шесть</p>", "ans": "7"},
        {"id": "b:27", "n": 27, "bank": "b", "html": "<p>Двадцать семь</p>", "ans": "10 20"},
        {"id": "b:g", "n": 19, "bank": "b", "html": "<p>Игра</p>",
         "parts": [{"id": "b:g19", "n": 19, "ans": "3"}, {"id": "b:g20", "n": 20, "ans": "4"}]},
    ],
}


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        (cls.tmp / "data").mkdir()
        (cls.tmp / "data" / "bank.js").write_text("window.EGE_BANK = " + json.dumps(BANK) + ";", encoding="utf-8")
        (cls.tmp / "server_data").mkdir()
        (cls.tmp / "server_data" / "secret.txt").write_text("secret")
        (cls.tmp / "vendor").mkdir()
        (cls.tmp / "vendor" / "ok.css").write_text("body{}")
        cls.saved = {k: getattr(server, k) for k in ("HERE", "DB_PATH", "BANK_JS", "THINK_SEC_DEFAULT", "THINK_SEC_HARD")}
        server.HERE = cls.tmp
        server.DB_PATH = cls.tmp / "server_data" / "trainer.db"
        server.BANK_JS = cls.tmp / "data" / "bank.js"
        server.APP = server.App()
        server.APP.db.setting("invite_code", "1234")
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        for k, v in cls.saved.items():
            setattr(server, k, v)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        server.THINK_SEC_DEFAULT = 0
        server.THINK_SEC_HARD = 0
        server.OPENED.m.clear()
        server.THROTTLE.fails.clear()
        server.APP.db.x("DELETE FROM reveal_log")
        server.APP.db.x("DELETE FROM exams")

    # ------------------------------------------------------------ помощники
    def req(self, method, path, body=None, token=None, raw_path=False):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Token"] = token
        c.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        r = c.getresponse()
        data = r.read()
        c.close()
        try:
            data = json.loads(data)
        except ValueError:
            pass
        return r.status, data

    def login(self, name="Иванов Иван"):
        st, d = self.req("POST", "/api/login", {"code": "1234", "name": name})
        self.assertEqual(st, 200, d)
        return d["token"]

    def check(self, tok, task, **kw):
        return self.req("POST", "/api/check", dict(task=task, **kw), tok)

    # ------------------------------------------------------------ файлы
    def test_path_traversal_blocked(self):
        for p in ("/vendor/../server_data/secret.txt", "/vendor/%2e%2e/server_data/secret.txt",
                  "/media/../server.py", "/vendor/../data/bank.js"):
            st, _ = self.req("GET", p)
            self.assertEqual(st, 404, p)
        self.assertEqual(self.req("GET", "/vendor/ok.css")[0], 200)

    def test_bank_has_no_answers(self):
        tok = self.login()
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/data/bank.js", headers={"Cookie": "egest=" + tok})
        body = c.getresponse().read().decode()
        c.close()
        self.assertIn("Пять", body)
        self.assertNotIn('"ans"', body)
        self.assertNotIn("решение", body)

    # ------------------------------------------------------------ попытки
    def test_attempts_counted_on_server(self):
        tok = self.login("Попытков Пётр")
        self.req("POST", "/api/open", {"task": "b:5"}, tok)
        st, d = self.check(tok, "b:5", answer="1")
        self.assertEqual((d["correct"], d["final"]), (False, False))
        self.assertNotIn("answer", d)
        st, d = self.check(tok, "b:5", answer="2")      # вторая неверная — итог, ответ показан
        self.assertTrue(d["final"])
        self.assertEqual(d["answer"], "12")
        st, d = self.check(tok, "b:5", answer="12")     # подобрать ответ дальше нельзя
        self.assertFalse(d["correct"])

    def test_second_try_and_solution(self):
        tok = self.login("Второй Попыткин")
        self.req("POST", "/api/open", {"task": "b:5"}, tok)
        self.check(tok, "b:5", answer="5")
        st, d = self.check(tok, "b:5", answer="12")
        self.assertEqual((d["correct"], d["score"]), (True, 0.5))
        self.assertIn("решение", d["sol"])

    def test_reopen_after_wrong_counts_as_abandoned(self):
        tok = self.login("Хитров Хитрец")
        self.req("POST", "/api/open", {"task": "b:6"}, tok)
        self.check(tok, "b:6", answer="1")
        self.req("POST", "/api/open", {"task": "b:6"}, tok)    # «перезагрузил», чтобы получить новые попытки
        rows = server.APP.db.q("SELECT abandoned, score FROM attempts WHERE task_id='b:6' AND abandoned=1")
        self.assertEqual(len(rows), 1)

    def test_skip_without_answer_is_free(self):
        tok = self.login("Пропусков Павел")
        self.req("POST", "/api/open", {"task": "b:6"}, tok)
        st, d = self.check(tok, "b:6", abandoned=True)
        self.assertTrue(d.get("skipped"))
        n = server.APP.db.q("SELECT COUNT(*) c FROM attempts a JOIN students s ON s.id=a.student_id "
                            "WHERE s.name='Пропусков Павел'", one=True)["c"]
        self.assertEqual(n, 0)

    # ------------------------------------------------------------ показ ответа
    def test_think_time_hides_answer(self):
        server.THINK_SEC_DEFAULT = 60
        tok = self.login("Торопыгин Тимур")
        self.req("POST", "/api/open", {"task": "b:5"}, tok)
        st, d = self.check(tok, "b:5", gave_up=True)
        self.assertNotIn("answer", d)
        self.assertEqual(d["hidden"]["why"], "think")
        st, d = self.req("POST", "/api/reveal", {"task": "b:5"}, tok)
        self.assertIn("hidden", d)
        server.OPENED.get(server.APP.db.q("SELECT id FROM students WHERE name='Торопыгин Тимур'", one=True)["id"],
                          "b:5")["ts"] -= 61                   # прошла минута
        st, d = self.req("POST", "/api/reveal", {"task": "b:5"}, tok)
        self.assertEqual(d["answer"], "12")

    def test_reveal_limit_per_hour(self):
        tok = self.login("Выкачкин Вадим")
        got = 0
        for i in range(server.REVEAL_PER_HOUR + 3):
            tid = ("b:5", "b:6")[i % 2]
            self.req("POST", "/api/open", {"task": tid}, tok)
            st, d = self.check(tok, tid, gave_up=True)
            if "answer" in d:
                got += 1
            else:
                self.assertEqual(d["hidden"]["why"], "limit")
        self.assertEqual(got, server.REVEAL_PER_HOUR)
        st, d = self.req("GET", "/api/admin/students")
        self.assertEqual(st, 401)                               # без входа учителя — нельзя

    # ------------------------------------------------------------ частичный балл
    def test_partial_credit_27(self):
        self.assertEqual(server.answer_credit(27, "10 20", "10 20"), 1.0)
        self.assertEqual(server.answer_credit(27, "10 20", "10 21"), 0.5)
        self.assertEqual(server.answer_credit(27, "10 20", "10", ["", "20"]), 0.5)
        self.assertEqual(server.answer_credit(27, "10 20", "1 2"), 0.0)
        self.assertEqual(server.answer_credit(17, "10 20", "10 21"), 0.0)   # №17 — только целиком
        self.assertEqual(server.answer_credit(26, "1 2 3 4", "1 2 9 9"), 0.5)
        tok = self.login("Половинкин Олег")
        self.req("POST", "/api/open", {"task": "b:27"}, tok)
        st, d = self.check(tok, "b:27", answer="10 99")
        self.assertTrue(d["half"])

    # ------------------------------------------------------------ история
    def test_history_rebuilds_progress(self):
        tok = self.login("Историков Илья")
        self.req("POST", "/api/open", {"task": "b:g"}, tok)
        self.check(tok, "b:g19", answer="3", rk="19|")
        st, d = self.req("GET", "/api/history", token=tok)
        self.assertEqual(st, 200)
        row = d["h"][-1]
        self.assertEqual((row[0], row[2], row[5], row[7]), ("b:g19", 1.0, "19|", "b:g"))

    def test_prefs_and_forecast(self):
        tok = self.login("Настроек Нил")
        st, d = self.req("POST", "/api/progress", {"forecast": 55, "prefs": {"fav": ["b:5"], "goal": 15}}, tok)
        self.assertEqual(st, 200)
        st, d = self.req("GET", "/api/me", token=tok)
        self.assertEqual(d["prefs"]["fav"], ["b:5"])
        self.assertEqual(d["fc"][-1]["s"], 55)
        self.assertIn("think", d["rules"])

    # ------------------------------------------------------------ вариант ЕГЭ
    def test_exam(self):
        tok = self.login("Экзаменов Эдуард")
        st, e = self.req("POST", "/api/exam/start", {}, tok)
        self.assertEqual(st, 200)
        answers = [{"task": "b:5", "answer": "12"}, {"task": "b:6", "answer": ""},
                   {"task": "b:27", "answer": "10 21"}, {"task": "b:5", "answer": "12"}]   # дубль не считается
        st, r = self.req("POST", "/api/exam/finish", {"exam_id": e["exam_id"], "answers": answers}, tok)
        self.assertEqual(st, 200, r)
        self.assertEqual(r["primary"], 2)                 # 1 за №5 + 1 из 2 за №27
        self.assertEqual(r["test"], server.EGE_SCALE[2])
        self.assertFalse(r["shown"])                      # решали меньше 20 минут — ответы не раскрываем
        self.assertTrue(all("answer" not in x for x in r["results"]))
        st, r2 = self.req("POST", "/api/exam/finish", {"exam_id": e["exam_id"], "answers": []}, tok)
        self.assertEqual(r2["primary"], 2)                # повторная отправка не пересчитывает
        for _ in range(server.EXAM_PER_DAY - 1):
            self.req("POST", "/api/exam/start", {}, tok)
        st, d = self.req("POST", "/api/exam/start", {}, tok)
        self.assertEqual(st, 429)

    # ------------------------------------------------------------ прочее
    def test_csv_cell(self):
        self.assertEqual(server.csv_cell("=HYPERLINK(1)"), "'=HYPERLINK(1)")
        self.assertEqual(server.csv_cell("-5"), "-5")
        self.assertEqual(server.csv_cell("Иванов"), "Иванов")

    def test_bad_content_length(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.putrequest("POST", "/api/ping")
        c.putheader("Content-Length", "-1")
        c.endheaders()
        r = c.getresponse()
        self.assertEqual(r.status, 400)
        r.read()
        c.close()


if __name__ == "__main__":
    unittest.main()
