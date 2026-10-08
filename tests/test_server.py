"""Тесты сервера: python -m unittest discover tests

Поднимают server.py на свободном порту с временной базой и маленьким банком заданий.
"""
import http.client
import json
import re
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
        {"id": "b:5", "n": 5, "bank": "b", "html": "<p>Пять</p>", "ans": "12", "sol": "<p>решение</p>",
         "link": "https://kompege.ru/task?id=5", "video": {"yt": "abc"},
         "att": [{"name": "5_7831_1698406948.xlsx", "href": "media/b/assets/x.xlsx"}]},
        {"id": "b:6", "n": 6, "bank": "b", "ans": "7", "src": "КомпЕГЭ · Джобс 14.05.2022",
         "html": '<p>Шесть, как в <a href="https://openfipi.devinf.ru/task/B9FC0F">задании 19</a>, автор <a href="https://vk.com/a">А.</a></p>'},
        {"id": "b:27", "n": 27, "bank": "b", "html": "<p>Двадцать семь</p>", "ans": "10 20", "src": "КомпЕГЭ · Демоверсия 2025"},
        {"id": "fip:02143E", "n": 3, "bank": "fip_bank", "ans": "1",
         "html": '<p><img src="../fip_bank/assets/0079D4-08bc5d/a.gif"> <a href="../fip_bank/files/ege/3/02143E.zip">Скачать</a></p>',
         "att": [{"name": "02143E.zip", "href": "../fip_bank/files/ege/3/02143E.zip"},
                 {"name": "BAD001.zip", "href": "../fip_bank/files/ege/9/BAD001.zip"}]},
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
        # банк ФИПИ: картинка в папке с кодом задания, файлы — в zip, один архив битый
        fip = cls.tmp / "fip_bank"
        (fip / "assets" / "0079D4-08bc5d").mkdir(parents=True)
        (fip / "assets" / "0079D4-08bc5d" / "a.gif").write_bytes(b"GIF89a")
        (fip / "files" / "ege" / "3").mkdir(parents=True)
        (fip / "files" / "ege" / "9").mkdir(parents=True)
        import zipfile
        with zipfile.ZipFile(fip / "files" / "ege" / "3" / "02143E.zip", "w") as z:
            z.writestr("02143E.xls", b"XLSDATA")
            z.writestr("__MACOSX/._02143E.xls", b"junk")
            z.writestr("Задание 3.txt", b"1 2 3")
        (fip / "files" / "ege" / "9" / "BAD001.zip").write_text("<html>Ошибка</html>", encoding="utf-8")
        (cls.tmp / "vendor").mkdir()
        (cls.tmp / "vendor" / "ok.css").write_text("body{}")
        cls.saved = {k: getattr(server, k) for k in ("HERE", "DB_PATH", "BANK_JS", "THINK_SEC_DEFAULT", "THINK_SEC_HARD")}
        server.HERE = cls.tmp
        server.DB_PATH = cls.tmp / "server_data" / "trainer.db"
        server.BANK_JS = cls.tmp / "data" / "bank.js"
        server.APP = server.App()
        server.APP.db.x("UPDATE teachers SET invite=? WHERE is_main=1", ("1234",))
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
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "1234", "name": name,
                                                "new_password": "secret1"})
        self.assertEqual(st, 200, d)
        return d["token"]

    # ------------------------------------------------------------ аккаунты
    def test_register_and_login_with_password(self):
        tok = self.login("Паролев Павел")
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "паролев  павел", "password": "secret1"})
        self.assertEqual(st, 200, d)                       # регистр и пробелы в ФИО не важны
        self.assertEqual(d["token"], tok)
        self.assertTrue(d["has_password"])
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "Паролев Павел", "password": "wrong"})
        self.assertEqual(st, 403)
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "1234", "name": "Паролев Павел",
                                                "new_password": "другой1"})
        self.assertEqual(st, 409)                          # чужой аккаунт кодом приглашения не перехватить
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "Нет Такого", "password": "x"})
        self.assertEqual(st, 404)
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "0000", "name": "Новый Ученик",
                                                "new_password": "secret1"})
        self.assertEqual(st, 403)                          # без верного кода не зарегистрироваться
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "1234", "name": "Новый Ученик",
                                                "new_password": "123"})
        self.assertEqual(st, 400)

    def test_old_student_without_password_keeps_progress(self):
        db = server.APP.db
        db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES(?,?,?,?,?)",
             ("Старый Степан", "старый степан", "oldtok", time.time(), time.time()))
        sid = db.q("SELECT id FROM students WHERE name_key='старый степан'", one=True)["id"]
        db.x("INSERT INTO attempts(student_id,ts,task_id,n,score) VALUES(?,?,?,?,?)", (sid, time.time(), "b:5", 5, 1.0))
        st, d = self.req("GET", "/api/me", token="oldtok")
        self.assertFalse(d["has_password"])                # страница попросит задать пароль
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "Старый Степан", "password": ""})
        self.assertEqual((st, d.get("need")), (409, "set_password"))
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "1234", "name": "Старый Степан",
                                                "new_password": "secret1"})
        self.assertEqual(st, 200, d)
        self.assertEqual(d["sid"], sid)                    # тот же ученик — журнал на месте
        st, h = self.req("GET", "/api/history", token=d["token"])
        self.assertEqual(len(h["h"]), 1)

    def test_change_password_logs_out_other_devices(self):
        tok = self.login("Сменов Сергей")
        st, d = self.req("POST", "/api/password", {"old": "wrong", "new": "newpass1"}, tok)
        self.assertEqual(st, 403)
        st, d = self.req("POST", "/api/password", {"old": "secret1", "new": "newpass1"}, tok)
        self.assertEqual(st, 200)
        self.assertEqual(self.req("GET", "/api/me", token=tok)[0], 401)       # старый вход больше не действует
        self.assertEqual(self.req("GET", "/api/me", token=d["token"])[0], 200)
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "Сменов Сергей", "password": "newpass1"})
        self.assertEqual(st, 200)

    def test_password_guessing_is_limited(self):
        self.login("Подбиров Пётр")
        for _ in range(server.FAIL_LIMIT["account"]):
            self.req("POST", "/api/login", {"mode": "login", "name": "Подбиров Пётр", "password": "bad"})
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "Подбиров Пётр", "password": "secret1"})
        self.assertEqual(st, 429)

    def admin(self, method, path, body=None):
        """Запрос учителя: сессию кладём прямо в базу."""
        server.APP.db.x("INSERT OR IGNORE INTO admin_sessions(token, expires) VALUES('admtest', ?)", (time.time() + 3600,))
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path, body=json.dumps(body) if body is not None else None,
                  headers={"Content-Type": "application/json", "Cookie": "egeadm=admtest"})
        r = c.getresponse()
        data = json.loads(r.read() or b"null")
        c.close()
        return r.status, data

    def check(self, tok, task, **kw):
        return self.req("POST", "/api/check", dict(task=task, **kw), tok)

    # ------------------------------------------------------------ файлы
    def test_path_traversal_blocked(self):
        for p in ("/vendor/../server_data/secret.txt", "/vendor/%2e%2e/server_data/secret.txt",
                  "/media/../server.py", "/vendor/../data/bank.js"):
            st, _ = self.req("GET", p)
            self.assertEqual(st, 404, p)
        self.assertEqual(self.req("GET", "/vendor/ok.css")[0], 200)

    def test_bank_images_served_from_found_folder(self):
        bank = self.tmp / "img_bank" / "assets"
        bank.mkdir(parents=True)
        (bank / "a.png").write_bytes(b"\x89PNG")
        saved = server.BIBLIO
        server.BIBLIO = self.tmp
        server._bank_cache.clear()
        try:
            self.assertEqual(self.req("GET", "/img_bank/assets/a.png")[0], 200)
            # банк собран из другой папки: перед именем банка лишние папки — всё равно находим
            self.assertEqual(self.req("GET", "/Documents/Biblio/img_bank/assets/a.png")[0], 200)
            self.assertEqual(self.req("GET", "/img_bank/assets/../../server_data/secret.txt", raw_path=True)[0], 404)
            self.assertEqual(self.req("GET", "/img_bank/task.json")[0], 404)
        finally:
            server.BIBLIO = saved
            server._bank_cache.clear()

    def test_bank_hides_everything_that_leads_to_answer(self):
        tok = self.login("Скрытов Семён")
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/data/bank.js", headers={"Cookie": "egest=" + tok})
        body = c.getresponse().read().decode()
        c.close()
        for leak in ("kompege.ru/task", "devinf.ru/task", '"video"', '"link"', "b:5", "b:g19", "7831"):
            self.assertNotIn(leak, body, leak)
        self.assertIn("vk.com/a", body)                    # ссылки на авторов остаются
        self.assertIn("5.xlsx", body)                      # имя файла без номера задания
        pid = server.APP.bank.pid("b:5")
        self.assertIn(pid, body)
        # ссылка на источник приходит только вместе с ответом
        self.req("POST", "/api/open", {"task": pid}, tok)
        st, d = self.check(tok, pid, answer="1")
        self.assertNotIn("link", d)
        st, d = self.check(tok, pid, answer="12")
        self.assertEqual(d["link"], "https://kompege.ru/task?id=5")
        self.assertEqual(d["video"], {"yt": "abc"})

    def test_fipi_files_hide_code_and_unpack_zip(self):
        tok = self.login("Файлов Фёдор")
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/data/bank.js", headers={"Cookie": "egest=" + tok})
        body = c.getresponse().read().decode()
        c.close()
        bank = json.loads(body[body.index("{"):body.rindex("}") + 1])
        task = next(t for t in bank["tasks"] if t["n"] == 3)
        for leak in ("02143E", "0079D4", "../", "BAD001"):
            self.assertNotIn(leak, json.dumps(task, ensure_ascii=False), leak)
        names = [a["name"] for a in task["att"]]
        self.assertIn("3.xls", names)                       # файл из архива, имя без кода ФИПИ
        self.assertIn("Задание 3.txt", names)
        from types import SimpleNamespace                   # архив из Windows: имя в cp866 без флага UTF-8
        win = SimpleNamespace(flag_bits=0, filename="Задание 3.txt".encode("cp866").decode("cp437"))
        self.assertEqual(server.zip_display_name(win), "Задание 3.txt")
        self.assertEqual(server.clean_file_name("02143E.xls", 3), "3.xls")
        self.assertEqual(server.clean_file_name("3_7831_1698406948.xlsx", 3), "3.xlsx")
        self.assertEqual(server.clean_file_name("27_A.txt", 27), "27_A.txt")
        self.assertNotIn("Скачать</a>", task["html"])       # ссылка на распакованный архив убрана из текста
        self.assertEqual(server.APP.bank.broken[-1:], [str((self.tmp / "fip_bank/files/ege/9/BAD001.zip").resolve())])

        def get(href):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            c.request("GET", "/" + href)
            r = c.getresponse()
            out = (r.status, r.read(), r.headers.get("Content-Disposition") or "")
            c.close()
            return out
        xls = next(a for a in task["att"] if a["name"] == "3.xls")
        st, data, disp = get(xls["href"])
        self.assertEqual((st, data), (200, b"XLSDATA"))
        self.assertIn("3.xls", disp)
        self.assertNotIn("02143E", disp)
        img = re.search(r'src="([^"]+)"', task["html"]).group(1)
        self.assertEqual(get(img)[:2], (200, b"GIF89a"))
        self.assertEqual(get("files/0000000000000000aaaa/x.png")[0], 404)

    def test_authored_tasks_marked_and_switchable(self):
        for src, au in (("Джобс Е.", True), ("КомпЕГЭ · /dev/inf 11.22", True), ("КомпЕГЭ · Статград 08.02.2022", True),
                        ("КомпЕГЭ · Демоверсия 2025", False), ("КомпЕГЭ · Переcдача 04.07.24", False),
                        ("Открытый банк ФИПИ", False), ("КомпЕГЭ", False), ("", False), (None, False)):
            self.assertEqual(server.is_authored(src), au, src)
        tok = self.login("Авторов Антон")
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/data/bank.js", headers={"Cookie": "egest=" + tok})
        body = c.getresponse().read().decode()
        c.close()
        tasks = {t["id"]: t for t in json.loads(body[body.index("{"):body.rindex("}") + 1])["tasks"]}
        self.assertEqual(tasks[server.APP.bank.pid("b:6")].get("au"), 1)
        self.assertNotIn("au", tasks[server.APP.bank.pid("b:27")])
        self.assertTrue(self.req("GET", "/api/me", token=tok)[1]["rules"]["authored"])
        # переключатель — только у учителя
        self.assertEqual(self.req("POST", "/api/admin/authored", {"on": False})[0], 401)
        server.APP.db.x("INSERT INTO admin_sessions(token, expires) VALUES('admtok', ?)", (time.time() + 3600,))
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("POST", "/api/admin/authored", body=json.dumps({"on": False}),
                  headers={"Content-Type": "application/json", "Cookie": "egeadm=admtok"})
        r = c.getresponse()
        self.assertEqual((r.status, json.loads(r.read())["on"]), (200, False))
        c.close()
        try:
            self.assertFalse(self.req("GET", "/api/me", token=tok)[1]["rules"]["authored"])
        finally:
            server.APP.db.x("UPDATE teachers SET authored=1 WHERE is_main=1")
            server.APP.db.x("DELETE FROM admin_sessions WHERE token='admtok'")

    # ------------------------------------------------------------ классы, подборки, опыт
    def test_classes_and_unassigned_students(self):
        tok = self.login("Классов Кирилл")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        st, d = self.admin("GET", "/api/admin/students?class_id=none")
        self.assertIn(sid, [x["id"] for x in d["students"]])
        st, d = self.admin("POST", "/api/admin/class/save", {"name": "11А"})
        cid = d["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [sid]})
        st, d = self.admin("GET", "/api/admin/students?class_id=none")
        self.assertNotIn(sid, [x["id"] for x in d["students"]])          # в «новых» его больше нет
        st, d = self.admin("GET", f"/api/admin/students?class_id={cid}")
        self.assertEqual([x["id"] for x in d["students"]], [sid])
        st, d = self.admin("GET", "/api/admin/classes")
        self.assertEqual([(c["name"], c["students"]) for c in d["classes"] if c["id"] == cid], [("11А", 1)])
        self.admin("POST", "/api/admin/class/delete", {"id": cid})
        st, d = self.admin("GET", "/api/admin/students?class_id=none")
        self.assertIn(sid, [x["id"] for x in d["students"]])              # удалили класс — снова «новый»

    def test_assignment_progress_and_xp(self):
        tok = self.login("Подборкин Павел")
        me = self.req("GET", "/api/me", token=tok)[1]
        self.assertEqual((me["game"]["level"], me["game"]["xp"]), (1, 0))
        st, d = self.admin("POST", "/api/admin/class/save", {"name": "10Б"})
        cid = d["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me["sid"]]})
        st, d = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Графы", "tasks": ["b:5", "b:27", "нет:такого"]})
        self.assertEqual(st, 200, d)
        st, d = self.req("GET", "/api/assignments", token=tok)
        a = d["assignments"][0]
        pid5 = server.APP.bank.pid("b:5")
        self.assertEqual((a["title"], len(a["tasks"]), a["done"]), ("Графы", 2, []))
        self.assertNotIn("b:5", json.dumps(d))                             # настоящие id ученику не уходят
        self.req("POST", "/api/open", {"task": pid5}, tok)
        st, r = self.check(tok, pid5, answer="12", away=3)
        self.assertEqual(r["game"]["xp"], 10)                              # №5: 10 XP за первое решение
        self.assertEqual(r["game"]["ach"][0]["id"], "first")
        self.assertTrue(r["game"]["ach"][0]["got"])
        st, d = self.req("GET", "/api/assignments", token=tok)
        self.assertEqual(d["assignments"][0]["done"], [pid5])
        st, d = self.admin("GET", f"/api/admin/assignments?class_id={cid}")
        self.assertEqual(d["assignments"][0]["progress"][0]["done"], 1)
        row = server.APP.db.q("SELECT away FROM attempts WHERE student_id=? ORDER BY id DESC", (me["sid"],), one=True)
        self.assertEqual(row["away"], 3)                                   # уходы со вкладки — в журнале
        # повторное решение того же задания — только 2 XP
        self.req("POST", "/api/open", {"task": pid5}, tok)
        st, r = self.check(tok, pid5, answer="12")
        self.assertEqual(r["game"]["xp"], 12)
        st, d = self.req("GET", "/api/leaderboard", token=tok)
        self.assertEqual((d["class"], d["rows"][0]["name"], d["rows"][0]["me"]), ("10Б", "Подборкин П.", True))
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_bank_pick_and_find_for_teacher(self):
        st, d = self.admin("GET", "/api/admin/bank/pick?n=5&count=3")
        self.assertEqual([t["id"] for t in d["tasks"]], ["b:5"])
        st, d = self.admin("GET", "/api/admin/bank/find?q=b:27")
        self.assertEqual((d["id"], d["n"]), ("b:27", 27))
        self.assertEqual(self.req("GET", "/api/admin/bank/pick?n=5")[0], 401)

    def test_activity_logged_for_teacher(self):
        tok = self.login("Уходов Ульян")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        pid = server.APP.bank.pid("b:6")
        st, _ = self.req("POST", "/api/activity", {"events": [{"kind": "away", "dur": 42, "task": pid},
                                                              {"kind": "shot", "task": pid, "exam": 1},
                                                              {"kind": "hack"}]}, tok)
        self.assertEqual(st, 200)
        st, d = self.admin("GET", f"/api/admin/student?id={sid}&from=0")
        self.assertEqual(d["activity"]["away"], {"count": 1, "sec": 42, "exam": 0})
        self.assertEqual(d["activity"]["shot"]["exam"], 1)
        self.assertNotIn("hack", d["activity"])
        row = server.APP.db.q("SELECT task_id FROM activity WHERE student_id=? AND kind='away'", (sid,), one=True)
        self.assertEqual(row["task_id"], "b:6")

    def test_solutions_student_and_teacher(self):
        tok = self.login("Решалов Роман")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        pid = server.APP.bank.pid("b:5")
        st, _ = self.req("POST", "/api/solution", {"task": pid, "code": "print(12)"}, tok)
        self.assertEqual(st, 200)
        st, d = self.req("GET", "/api/solution?task=" + pid, token=tok)
        self.assertEqual(d["code"], "print(12)")
        self.assertEqual(self.req("POST", "/api/solution", {"task": pid, "code": "x" * 60000}, tok)[0], 413)
        # учитель видит код в журнале
        self.req("POST", "/api/open", {"task": pid}, tok)
        self.check(tok, pid, answer="1")
        st, d = self.admin("GET", f"/api/admin/student?id={sid}&from=0")
        self.assertEqual(d["attempts"], [])                                # попытка ещё не закончена — в журнале её нет
        self.check(tok, pid, answer="12")
        st, d = self.admin("GET", f"/api/admin/student?id={sid}&from=0")
        self.assertEqual(d["attempts"][0]["has_code"], 1)
        st, d = self.admin("GET", f"/api/admin/solution?student={sid}&task=b:5")
        self.assertEqual(d["code"], "print(12)")
        # решение учителя приходит ученику только вместе с ответом
        self.admin("POST", "/api/admin/task-solution", {"task": "b:6", "text": "ответ 7 — перебором"})
        st, d = self.admin("GET", "/api/admin/task?id=b:6")
        self.assertEqual(d["teacher_sol"], "ответ 7 — перебором")
        p6 = server.APP.bank.pid("b:6")
        self.req("POST", "/api/open", {"task": p6}, tok)
        st, r = self.check(tok, p6, answer="1")
        self.assertNotIn("tsol", r)
        st, r = self.check(tok, p6, answer="7")
        self.assertEqual(r["tsol"], "ответ 7 — перебором")
        self.admin("POST", "/api/admin/task-solution", {"task": "b:6", "text": ""})
        self.assertIsNone(self.admin("GET", "/api/admin/task?id=b:6")[1]["teacher_sol"])

    def test_author_in_task_text(self):
        self.assertTrue(server.is_authored("КомпЕГЭ", "<p>(Д. Бахтиев) В файле приведён фрагмент</p>"))
        self.assertTrue(server.is_authored("КомпЕГЭ", "<div><p><b>(PRO100 ЕГЭ)</b> Текст</p></div>"))
        self.assertFalse(server.is_authored("КомпЕГЭ", "<p>(Демоверсия 2025) Текст</p>"))
        self.assertFalse(server.is_authored("КомпЕГЭ", "<p>(1) Сначала…</p>"))
        self.assertFalse(server.is_authored("КомпЕГЭ", "<p>Текст (Д. Бахтиев) в середине</p>"))

    def teacher_req(self, cookie, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path, body=json.dumps(body) if body is not None else None,
                  headers={"Content-Type": "application/json", "Cookie": cookie})
        r = c.getresponse()
        data = json.loads(r.read() or b"null")
        c.close()
        return r.status, data, r.getheader("Set-Cookie") or ""

    def test_teachers_and_their_students(self):
        # главный создаёт учителя со своим кодом приглашения
        st, d = self.admin("POST", "/api/admin/teacher/save", {"name": "Мария Ивановна", "login": "maria",
                                                                "password": "secret77", "invite": "MARIA1"})
        self.assertEqual(st, 200, d)
        tid = d["id"]
        self.assertEqual(self.admin("POST", "/api/admin/teacher/save", {"name": "X", "login": "maria2",
                                                                        "password": "secret77", "invite": "MARIA1"})[0], 409)
        # учитель входит своим логином
        st, d, ck = self.teacher_req("", "POST", "/api/admin/login", {"login": "maria", "password": "wrong"})
        self.assertEqual(st, 403)
        server.THROTTLE.fails.clear()
        st, d, ck = self.teacher_req("", "POST", "/api/admin/login", {"login": "Maria", "password": "secret77"})
        self.assertEqual(st, 200)
        cookie = ck.split(";")[0]
        st, me, _ = self.teacher_req(cookie, "GET", "/api/admin/me")
        self.assertEqual((me["name"], me["is_main"], me["invite"]), ("Мария Ивановна", 0, "MARIA1"))
        # ученик по её коду попадает к ней
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "MARIA1", "name": "Машин Михаил",
                                                "new_password": "secret1"})
        self.assertEqual(st, 200, d)
        her = d["sid"]
        mine = self.req("GET", "/api/me", token=self.login("Главнов Глеб"))[1]["sid"]
        st, d, _ = self.teacher_req(cookie, "GET", "/api/admin/students?class_id=all")
        self.assertEqual([x["id"] for x in d["students"]], [her])              # видит только своего
        self.assertEqual(self.teacher_req(cookie, "GET", f"/api/admin/student?id={mine}")[0], 404)
        self.assertEqual(self.teacher_req(cookie, "POST", "/api/admin/student/delete", {"id": mine})[0], 404)
        self.assertEqual(self.teacher_req(cookie, "GET", "/api/admin/teachers")[0], 403)
        st, d = self.admin("GET", "/api/admin/students?class_id=all")
        ids = {x["id"]: x["teacher"] for x in d["students"]}
        self.assertEqual(ids[her], "Мария Ивановна")                         # главный видит всех
        self.assertIn(mine, ids)
        # свои классы: чужой класс учитель не видит
        st, d, _ = self.teacher_req(cookie, "POST", "/api/admin/class/save", {"name": "9В"})
        her_class = d["id"]
        st, d = self.admin("POST", "/api/admin/class/save", {"name": "11Г"})
        main_class = d["id"]
        st, d, _ = self.teacher_req(cookie, "GET", "/api/admin/classes")
        self.assertEqual([c["id"] for c in d["classes"]], [her_class])
        self.assertEqual(self.teacher_req(cookie, "POST", "/api/admin/class/members",
                                          {"class_id": main_class, "students": [her]})[0], 404)
        # своя настройка авторских заданий — у её учеников
        self.teacher_req(cookie, "POST", "/api/admin/authored", {"on": False})
        tok = self.req("POST", "/api/login", {"mode": "login", "name": "Машин Михаил", "password": "secret1"})[1]["token"]
        self.assertFalse(self.req("GET", "/api/me", token=tok)[1]["rules"]["authored"])
        self.assertTrue(self.req("GET", "/api/me", token=self.login("Главнов Гордей"))[1]["rules"]["authored"])
        # удалили учителя — ученики и классы переходят главному, вход по её сессии больше не работает
        self.admin("POST", "/api/admin/teacher/delete", {"id": tid})
        self.assertEqual(self.teacher_req(cookie, "GET", "/api/admin/me")[0], 401)
        st, d = self.admin("GET", "/api/admin/students?class_id=all")
        self.assertEqual({x["id"]: x["teacher"] for x in d["students"]}[her], "Главный учитель")
        self.assertEqual(self.admin("POST", "/api/admin/teacher/delete", {"id": server.main_teacher()["id"]})[0], 400)
        for c in (her_class, main_class):
            self.admin("POST", "/api/admin/class/delete", {"id": c})

    def test_levels(self):
        self.assertEqual(server.level_of(0)[:2], (1, "Новичок"))
        self.assertEqual(server.level_of(99)[0], 1)
        self.assertEqual(server.level_of(100)[0], 2)
        self.assertEqual(server.level_of(300)[0], 3)
        lvl, title, cur, need = server.level_of(350)
        self.assertEqual((lvl, title, cur, need), (3, "Ученик", 50, 300))

    def test_find_returns_code_and_is_limited(self):
        tok = self.login("Поисков Пётр")
        st, d = self.req("GET", "/api/find?q=g20", token=tok)
        self.assertEqual(d["task"], server.APP.bank.pid("b:g"))   # вопрос 20 открывает всю игру 19–21
        self.assertEqual(self.req("GET", "/api/find?q=nothing", token=tok)[0], 404)
        for _ in range(server.FAIL_LIMIT["find"]):
            self.req("GET", "/api/find?q=5", token=tok)
        self.assertEqual(self.req("GET", "/api/find?q=5", token=tok)[0], 429)

    def test_prefs_store_real_ids(self):
        tok = self.login("Избранов Иван")
        pid = server.APP.bank.pid("b:6")
        self.req("POST", "/api/progress", {"prefs": {"fav": [pid], "notes": {pid: "заметка"}}}, tok)
        raw = server.APP.db.q("SELECT prefs FROM students WHERE name='Избранов Иван'", one=True)["prefs"]
        self.assertIn('"b:6"', raw)                        # если банк пересоберут, коды не потеряются
        st, d = self.req("GET", "/api/me", token=tok)
        self.assertEqual(d["prefs"]["fav"], [pid])
        self.assertEqual(d["prefs"]["notes"], {pid: "заметка"})

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
        pid = server.APP.bank.pid
        self.assertEqual((row[0], row[2], row[5], row[7]), (pid("b:g19"), 1.0, "19|", pid("b:g")))

    def test_prefs_and_forecast(self):
        tok = self.login("Настроек Нил")
        st, d = self.req("POST", "/api/progress", {"forecast": 55, "prefs": {"fav": ["b:5"], "goal": 15}}, tok)
        self.assertEqual(st, 200)
        st, d = self.req("GET", "/api/me", token=tok)
        self.assertEqual(d["prefs"]["fav"], [server.APP.bank.pid("b:5")])
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
