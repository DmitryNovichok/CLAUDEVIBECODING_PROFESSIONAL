"""Тесты сервера: python -m unittest discover tests

Поднимают server.py на свободном порту с временной базой и маленьким банком заданий.
"""
import http.client
import datetime
import json
import math
import re
import shutil
import sys
import tempfile
import threading
import time
import unittest
from urllib.parse import quote
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
        cls.saved = {k: getattr(server, k) for k in ("HERE", "DB_PATH", "BANK_JS", "EXTRA_BANK", "THINK_SEC_DEFAULT", "THINK_SEC_HARD",
                                                     "ACH_CLOCK", "BTC_RATE_FREE")}
        server.BTC_RATE_FREE = 10 ** 9      # курс биткоина в тестах не плавает (кроме теста курса): учеников «онлайн» здесь много
        # «забавные» достижения (ночью, в обед, в выходные, 31 декабря…) зависят от часов — тесты идут в обычную среду, 10:00
        server.ACH_CLOCK = lambda ts: time.struct_time((2026, 3, 4, 10, 0, 0, 2, 63, -1))
        server.HERE = cls.tmp
        server.DB_PATH = cls.tmp / "server_data" / "trainer.db"
        server.BANK_JS = cls.tmp / "data" / "bank.js"
        server.EXTRA_BANK = cls.tmp / "data" / "egeshka_bank.json"   # своего авторского банка у тестов нет
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
        server.LIVE.subs.clear()            # закрытые тестами живые соединения не должны двигать турниры в фоне
        server.THINK_SEC_DEFAULT = 0
        server.THINK_SEC_HARD = 0
        server.OPENED.m.clear()
        server.THROTTLE.fails.clear()
        server.CHECKS.recent.clear()
        server.CHECKS.per_task.clear()
        server._REG_LOG.clear()            # лимит регистраций с адреса считается для каждого теста заново
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
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "1234", "name": name,
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
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "1234", "name": "Паролев Павел",
                                                "new_password": "другой1"})
        self.assertEqual(st, 409)                          # чужой аккаунт кодом приглашения не перехватить
        st, d = self.req("POST", "/api/login", {"mode": "login", "name": "Нет Такого", "password": "x"})
        self.assertEqual(st, 404)
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "0000", "name": "Новый Ученик",
                                                "new_password": "secret1"})
        self.assertEqual(st, 403)                          # без верного кода не зарегистрироваться
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "1234", "name": "Новый Ученик",
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
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "1234", "name": "Старый Степан",
                                                "new_password": "secret1"})
        self.assertEqual(st, 200, d)
        self.assertEqual(d["sid"], sid)                    # тот же ученик — журнал на месте
        st, h = self.req("GET", "/api/history", token=d["token"])
        self.assertEqual(len(h["h"]), 1)

    def test_registration_limit_per_ip(self):
        server._REG_LOG.clear()
        server._REG_LOG["127.0.0.1"] = [time.time()] * server.REG_PER_HOUR_IP
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "1234", "name": "Лимитов Лев",
                                                "new_password": "secret1"})
        self.assertEqual(st, 429, d)
        server._REG_LOG.clear()
        self.login("Лимитов Лев")                         # через час (здесь — после очистки) снова можно

    def test_student_cookie_lifetime(self):
        def cookie(headers):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            c.request("POST", "/api/login", body=json.dumps({"mode": "register", "consent": True, "code": "1234",
                      "name": headers.pop("name"), "new_password": "secret1"}),
                      headers=dict({"Content-Type": "application/json"}, **headers))
            r = c.getresponse(); r.read(); c.close()
            return r.getheader("Set-Cookie")
        self.assertIn("Max-Age=%d" % (30 * 86400), cookie({"name": "Куков Карл"}))
        self.assertNotIn("Max-Age", cookie({"name": "Чужаков Чеслав", "X-Temp": "1"}))   # «Чужой компьютер»

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
    def test_extra_bank_merged(self):
        # авторский банк Egeshka лежит отдельным файлом и подмешивается к bank.js без пересборки
        extra = {"bank": {"id": "egeshka_bank", "title": "Egeshka", "count": 1},
                 "tasks": [{"id": "egeshka_bank:e5-01", "n": 5, "bank": "egeshka_bank", "html": "<p>Задача</p>",
                            "ans": "657", "src": "Egeshka Malevin D.", "y": 2026}]}
        server.EXTRA_BANK.write_text(json.dumps(extra, ensure_ascii=False), encoding="utf-8")
        try:
            self.assertTrue(server.APP.bank.ensure())
            self.assertIn("egeshka_bank:e5-01", server.APP.bank.tasks)
            pub = server.APP.bank.public_raw.decode("utf-8")
            self.assertIn('"title":"Egeshka"', pub)
            self.assertNotIn('"657"', pub)                          # ответ ученику не уходит
        finally:
            server.EXTRA_BANK.unlink()
            server.APP.bank.ensure()

    def test_task9_gets_txt_copy_of_table(self):
        # №9 решают, скопировав таблицу в .txt: сервер сам даёт 9.txt (ячейки через табуляцию)
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
        import gen_egeshka
        media = self.tmp / "media" / "t9"
        media.mkdir(parents=True, exist_ok=True)
        gen_egeshka.write_xlsx(media / "9.xlsx", [("Лист1", [[12, 7, 33], [100, 8, "x"]])])
        extra = {"bank": {"id": "egeshka_bank", "title": "Egeshka", "count": 1},
                 "tasks": [{"id": "egeshka_bank:t9", "n": 9, "bank": "egeshka_bank", "html": "<p>9</p>", "ans": "1",
                            "att": [{"name": "9.xlsx", "href": "media/t9/9.xlsx"}]}]}
        server.EXTRA_BANK.write_text(json.dumps(extra, ensure_ascii=False), encoding="utf-8")
        try:
            server.APP.bank.ensure()
            pub = json.loads(server.APP.bank.public_raw.decode()[len("window.EGE_BANK = "):-2])
            att = next(t for t in pub["tasks"] if t["n"] == 9 and t["bank"] == "egeshka_bank")["att"]
            self.assertEqual([a["name"] for a in att], ["9.xlsx", "9.txt"])
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            c.request("GET", "/" + att[1]["href"])
            r = c.getresponse()
            self.assertEqual((r.status, r.read()), (200, b"12\t7\t33\n100\t8\tx\n"))
            c.close()
        finally:
            server.EXTRA_BANK.unlink()
            server.APP.bank.ensure()

    def test_answer_alternatives(self):
        # в банке ФИПИ бывает «13992 или 13993»: одна ячейка, засчитывается любой из ответов
        self.assertEqual(server.shape_of("13992 или 13993"), {"type": "single"})
        self.assertEqual(server.answer_credit(7, "13992 или 13993", "13993"), 1.0)
        self.assertEqual(server.answer_credit(7, "13992 или 13993", "13992"), 1.0)
        self.assertEqual(server.answer_credit(7, "13992 или 13993", "13992 13993"), 0.0)
        self.assertEqual(server.answer_credit(27, "1 2\n3 4", "1 2 3 5"), 0.5)

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
        pid5, pid6 = server.APP.bank.pid("b:5"), server.APP.bank.pid("b:6")
        self.assertEqual((a["title"], len(a["tasks"]), a["done"], a["strict"]), ("Графы", 2, [], True))   # любая подборка — контрольная
        self.assertNotIn("b:5", json.dumps(d))                             # настоящие id ученику не уходят
        self.assertEqual(self.check(tok, pid5, answer="12")[0], 403)       # задание подборки — только через контрольную
        self.req("POST", "/api/open", {"task": pid6}, tok)
        st, r = self.check(tok, pid6, answer="7", away=3)
        self.assertEqual(r["game"]["xp"], server.task_xp(server.APP.bank.tasks["b:6"]["n"], server.APP.bank.tasks["b:6"].get("r")) + 5)    # №6: опыт за задание + 5 за «Первый шаг»
        self.assertEqual(r["game"]["ach"][0]["id"], "first")
        self.assertTrue(r["game"]["ach"][0]["got"])
        row = server.APP.db.q("SELECT away FROM attempts WHERE student_id=? ORDER BY id DESC", (me["sid"],), one=True)
        self.assertEqual(row["away"], 3)                                   # уходы со вкладки — в журнале
        # уже решённое задание снова (из истории) — ни опыта, ни огонька, ни серии
        g0 = server.game_summary(server.APP.db, me["sid"])
        for _ in range(3):
            self.req("POST", "/api/open", {"task": pid6}, tok)
            st, r = self.check(tok, pid6, answer="7")
            self.assertEqual(r["game"]["xp"], server.task_xp(server.APP.bank.tasks["b:6"]["n"], server.APP.bank.tasks["b:6"].get("r")) + 5)
        g1 = server.game_summary(server.APP.db, me["sid"])
        self.assertEqual((g1["fire"], g1["day"]), (g0["fire"], g0["day"]))
        self.assertNotIn("dejavu", [a["id"] for a in g1["ach"]])            # «Дежавю» (решить одно задание трижды) убрано
        st, d = self.req("GET", "/api/leaderboard", token=tok)
        me_row = next(r for r in d["boards"]["day"]["top"] if r["me"])          # рейтинг дня: опыт за сегодня
        self.assertEqual((me_row["name"], me_row["value"]), ("Подборкин П.", server.task_xp(server.APP.bank.tasks["b:6"]["n"], server.APP.bank.tasks["b:6"].get("r")) + 5))
        self.assertEqual(d["boards"]["day"]["me"]["value"], server.task_xp(server.APP.bank.tasks["b:6"]["n"], server.APP.bank.tasks["b:6"].get("r")) + 5)
        self.assertLessEqual(len(d["boards"]["week"]["top"]), 10)
        self.assertIn("fire", d["boards"])
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_practice_assignment_grades_itself(self):
        # практическая (и домашняя): верно или нет — сразу, оценка — сама по ответам после выдачи
        tok = self.login("Практиков Пётр")
        me = self.req("GET", "/api/me", token=tok)[1]["sid"]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "11П"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me]})
        st, d = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Практика", "kind": "practice",
                                                                  "grading": {"5": 90, "4": 70, "3": 40}, "tasks": ["b:5", "b:6", "b:27"]})
        aid = d["id"]
        a = self.req("GET", "/api/assignments", token=tok)[1]["assignments"][0]
        self.assertEqual((a["kind"], a.get("strict"), a["score"]["tried"], a["score"]["grade"]), ("practice", None, 0, None))
        pid5, pid6, pid27 = (server.APP.bank.pid(x) for x in ("b:5", "b:6", "b:27"))
        self.req("POST", "/api/open", {"task": pid5}, tok)
        st, r = self.check(tok, pid5, answer="12", reason="asg")
        self.assertEqual(st, 200)
        self.assertTrue(r["correct"])                                       # проверка сразу — не как в самостоятельной
        self.req("POST", "/api/open", {"task": pid6}, tok)
        self.check(tok, pid6, answer="1", reason="asg")
        self.check(tok, pid6, answer="7", reason="asg")                     # со второй попытки — половина
        self.req("POST", "/api/open", {"task": pid27}, tok)
        self.check(tok, pid27, answer="1 1", reason="asg")
        self.check(tok, pid27, answer="2 2", reason="asg")                  # не решил — 0
        sc = self.req("GET", "/api/assignments", token=tok)[1]["assignments"][0]["score"]
        self.assertEqual((sc["tried"], sc["ok"], sc["half"], sc["bad"], sc["pct"], sc["grade"], sc["final"]), (3, 1, 1, 1, 50, 3, True))
        st, live = self.admin("GET", f"/api/admin/asg/live?id={aid}")
        row = next(x for x in live["rows"] if x["id"] == me)
        self.assertEqual((row["status"], row["grade"], row["pct"]), ("done", 3, 50))
        st, d = self.admin("GET", f"/api/admin/assignments?class_id={cid}")
        self.assertEqual(d["assignments"][0]["kind"], "practice")
        # журнал класса: оценка за подборку и точность по номерам
        st, j = self.admin("GET", f"/api/admin/class/journal?class_id={cid}")
        self.assertEqual(st, 200)
        self.assertEqual([a["title"] for a in j["assignments"]], ["Практика"])
        me_row = next(x for x in j["students"] if x["id"] == me)
        self.assertEqual((me_row["cells"][str(aid)]["st"], me_row["cells"][str(aid)]["grade"]), ("done", 3))
        self.assertEqual(me_row["nums"]["5"], [1, 1])
        self.assertEqual(self.admin("GET", "/api/admin/class/journal?class_id=999999")[0], 404)
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_fix_weak_due_digest(self):
        T = server.APP.bank.tasks
        extra = {"b:27x": dict(T["b:27"], id="b:27x", ans="1 2"), "b:5x": dict(T["b:5"], id="b:5x", ans="3"),
                 "b:6x": dict(T["b:6"], id="b:6x", ans="4")}
        T.update(extra)
        try:
            tok = self.login("Ошибкин Олег")
            me = self.req("GET", "/api/me", token=tok)[1]["sid"]
            cid = self.admin("POST", "/api/admin/class/save", {"name": "10Р"})[1]["id"]
            self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me]})
            aid = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "СР-1", "kind": "self",
                                                                    "tasks": ["b:5", "b:27"]})[1]["id"]
            self.req("POST", "/api/asg/start", {"id": aid}, tok)
            self.req("POST", "/api/asg/answer", {"id": aid, "task": server.APP.bank.pid("b:5"), "answer": "12"}, tok)
            self.req("POST", "/api/asg/answer", {"id": aid, "task": server.APP.bank.pid("b:27"), "answer": "1 1"}, tok)
            self.req("POST", "/api/asg/finish", {"id": aid}, tok)
            # работа над ошибками: ошибка в №27 — похожее задание №27 (того же типа), а №5 решён верно — его нет
            mine = self.req("GET", "/api/assignments", token=tok)[1]["assignments"]
            fix = next(x for x in mine if x.get("personal") == "fix")
            self.assertEqual(fix["kind"], "practice")
            self.assertEqual([server.APP.bank.real(i) for i in fix["tasks"]], ["b:27x"])
            self.assertTrue(fix["title"].startswith("Работа над ошибками"))
            # журнал: личная серия — одна колонка; прогноз
            server.APP.db.x("UPDATE students SET forecast=70, fc=? WHERE id=?",
                            (json.dumps([{"d": (datetime.datetime.now() - datetime.timedelta(days=40)).strftime("%Y-%m-%d"), "s": 55},
                                         {"d": datetime.datetime.now().strftime("%Y-%m-%d"), "s": 70}]), me))
            j = self.admin("GET", f"/api/admin/class/journal?class_id={cid}")[1]
            self.assertEqual([c["title"] for c in j["assignments"]], ["СР-1", "Работа над ошибками: СР-1"])
            row = j["students"][0]
            self.assertEqual((row["fc"]["now"], row["fc"]["then"]), (70, 55))
            self.assertEqual(row["cells"][f"b:fix:{aid}"]["st"], "none")
            # слабые места: по 1 заданию на 2 номера — свои у ученика
            for i in range(3):
                server.APP.db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)",
                                (me, time.time() - 100 + i, "b:6", 6, "[]", "7", 0.0))
            r = self.admin("POST", "/api/admin/class/weak", {"class_id": cid, "per": 1, "nums": 2})[1]
            self.assertEqual(r["made"], 1)
            weak = next(x for x in self.req("GET", "/api/assignments", token=tok)[1]["assignments"] if x.get("personal") == "weak")
            self.assertIn("№6", weak["title"])
            # срок: самостоятельная с прошедшим сроком закрывается, начатая — сдаётся сама; в журнале н/с
            aid2 = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "СР-2", "kind": "self",
                                                                     "tasks": ["b:6"], "due": time.time() + 3600})[1]["id"]
            self.req("POST", "/api/asg/start", {"id": aid2}, tok)
            server.APP.db.x("UPDATE assignments SET due=? WHERE id=?", (time.time() - 60, aid2))
            a2 = next(x for x in self.req("GET", "/api/assignments", token=tok)[1]["assignments"] if x["id"] == aid2)
            self.assertTrue(a2["closed"] and a2["finished"])
            self.assertEqual(self.req("POST", "/api/asg/start", {"id": aid2}, tok)[0], 200)      # уже сдана — просто состояние
            # новую работу с прошедшим сроком выдать нельзя — срок проходит потом
            self.assertEqual(self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "ДЗ", "kind": "home",
                                                                               "tasks": ["b:6x"], "due": time.time() - 60})[0], 400)
            aid3 = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "ДЗ", "kind": "home",
                                                                     "tasks": ["b:6x"], "due": time.time() + 3600})[1]["id"]
            server.APP.db.x("UPDATE assignments SET due=? WHERE id=?", (time.time() - 60, aid3))
            j = self.admin("GET", f"/api/admin/class/journal?class_id={cid}")[1]
            self.assertEqual(j["students"][0]["cells"][str(aid3)]["st"], "miss")
            d = self.admin("GET", f"/api/admin/class/digest?class_id={cid}")[1]
            self.assertIn("ДЗ", [x["title"] for x in d["overdue"]])
            self.assertEqual((d["total"], d["active"]), (1, 1))
            b = self.admin("GET", f"/api/admin/assignments?class_id={cid}")[1]["batches"]
            self.assertEqual(sorted(x["batch"].split(":")[0] for x in b), ["fix", "fix", "weak"])   # и СР-2, сданная по сроку
            self.admin("POST", "/api/admin/batch/delete", {"class_id": cid, "batch": next(x["batch"] for x in b if x["batch"].startswith("weak"))})
            self.assertEqual(len(self.admin("GET", f"/api/admin/assignments?class_id={cid}")[1]["batches"]), 2)
            self.admin("POST", "/api/admin/class/delete", {"id": cid})
        finally:
            for k in extra:
                T.pop(k, None)

    def test_personal_assignment_from_teacher(self):
        # учитель выдаёт подборку только выбранным ученикам: у них — «персональная», у остальных её нет
        t1, t2 = self.login("Персонов Пётр"), self.login("Персонова Полина")
        s1, s2 = (self.req("GET", "/api/me", token=t)[1]["sid"] for t in (t1, t2))
        cid = self.admin("POST", "/api/admin/class/save", {"name": "11П"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [s1, s2]})
        st, d = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Только Пете", "kind": "practice",
                                                                  "tasks": ["b:5", "b:6"], "students": [s1, 999999]})
        self.assertEqual((st, d.get("personal")), (200, 1), d)
        a1 = self.req("GET", "/api/assignments", token=t1)[1]["assignments"]
        self.assertEqual([(a["title"], a["personal"]) for a in a1], [("Только Пете", "own")])
        self.assertEqual(self.req("GET", "/api/assignments", token=t2)[1]["assignments"], [])
        b = self.admin("GET", f"/api/admin/assignments?class_id={cid}")[1]["batches"]
        self.assertEqual((b[0]["title"], b[0]["students"]), ("Персональная: Только Пете", 1))
        self.assertEqual(self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "x", "tasks": ["b:5"],
                                                                          "students": [999999]})[0], 400)
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_strict_assignment(self):
        # контрольная: ответ один раз, проверка — после сдачи, учитель видит онлайн и может завершить для всех
        tok = self.login("Контрольнов Костя")
        tok2 = self.login("Контрольнова Катя")
        me = self.req("GET", "/api/me", token=tok)[1]["sid"]
        me2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "11К"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me, me2]})
        st, d = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Контрольная", "strict": True,
                                                                  "grading": {"5": 90, "4": 60, "3": 30},
                                                                  "tasks": ["b:5", "b:27", "b:g"]})
        self.assertEqual(st, 200, d)
        aid = d["id"]
        a = self.req("GET", "/api/assignments", token=tok)[1]["assignments"][0]
        self.assertTrue(a["strict"])
        a2 = self.req("GET", "/api/assignments", token=tok2)[1]["assignments"][0]
        self.assertEqual(sorted(a["tasks"]), sorted(a2["tasks"]))                    # те же задания, порядок у каждого свой
        self.assertEqual(a["tasks"], self.req("GET", "/api/assignments", token=tok)[1]["assignments"][0]["tasks"])  # и не меняется
        self.assertEqual([server.asg_order(list("abcdefghij"), aid, me) for _ in range(2)][0], server.asg_order(list("abcdefghij"), aid, me))
        self.assertNotEqual(server.asg_order(list("abcdefghij"), aid, me), server.asg_order(list("abcdefghij"), aid, me2))
        self.assertEqual((a["items"], a["started"], a["done"]), (4, None, []))       # №19–21 — два вопроса отдельно
        pid5, pid27 = server.APP.bank.pid("b:5"), server.APP.bank.pid("b:27")
        p19, p20 = server.APP.bank.pid("b:g19"), server.APP.bank.pid("b:g20")
        # в обычной тренировке задание контрольной не проверить
        self.assertEqual(self.req("POST", "/api/check", {"task": pid5, "answer": "12"}, tok)[0], 403)
        self.assertEqual(self.req("POST", "/api/asg/answer", {"id": aid, "task": pid5, "answer": "12"}, tok)[0], 409)  # не начата
        st, r = self.req("POST", "/api/asg/start", {"id": aid}, tok)
        self.assertEqual(st, 200, r)
        st, r = self.req("POST", "/api/asg/answer", {"id": aid, "task": pid5, "answer": "12"}, tok)
        self.assertEqual(st, 200, r)
        self.assertNotIn("result", r)                                        # верно или нет — до сдачи не говорим
        self.assertNotIn("correct", json.dumps(r))
        self.assertEqual(self.req("POST", "/api/asg/answer", {"id": aid, "task": pid5, "answer": "13"}, tok)[0], 409)  # без «изменить» — нельзя
        st, r = self.req("POST", "/api/asg/answer", {"id": aid, "task": pid5, "answer": "13", "change": True}, tok)
        self.assertEqual((st, r["changed"], r["mine"][pid5]), (200, [pid5], "13"))                          # один раз — можно
        self.assertEqual(self.req("POST", "/api/asg/answer", {"id": aid, "task": pid5, "answer": "12", "change": True}, tok)[0], 409)  # второй — нет
        server.APP.db.x("UPDATE asg_runs SET answers=json_set(answers, '$.\"b:5\".a', '12') WHERE asg_id=? AND student_id=?", (aid, me))  # вернём верный для проверок ниже
        self.req("POST", "/api/asg/answer", {"id": aid, "task": pid27, "answer": "10 99"}, tok)      # половина №27
        self.req("POST", "/api/asg/answer", {"id": aid, "task": p19, "answer": "5"}, tok)
        st, r = self.req("POST", "/api/asg/answer", {"id": aid, "task": p20, "answer": "4"}, tok)
        self.assertEqual(sorted(r["done"]), sorted([pid5, pid27, server.APP.bank.pid("b:g")]))
        self.req("POST", "/api/asg/away", {"id": aid}, tok)
        self.req("POST", "/api/asg/away", {"id": aid, "kind": "fs"}, tok)
        self.req("POST", "/api/asg/away", {"id": aid, "kind": "fs"}, tok)
        ev = self.admin("GET", "/api/admin/feed?since=0")[1]["events"]                 # учителю — уведомления в ленте
        self.assertEqual(sorted(e["kind"] for e in ev if e["student_id"] == me), ["away", "fs", "fs", "start"])
        # учитель видит онлайн: сколько сдано и сколько верно
        self.assertEqual(self.req("POST", "/api/solution", {"task": pid5, "code": "print(12)"}, tok)[0], 200)   # решение прикреплено
        st, live = self.admin("GET", f"/api/admin/asg/live?id={aid}")
        self.assertEqual(st, 200, live)
        row = next(x for x in live["rows"] if x["id"] == me)
        self.assertEqual((row["sol"], row["tasks"]), (1, 3))
        self.assertEqual((row["status"], row["answered"], row["ok"], row["half"], row["bad"], row["away"], row["fs"]), ("work", 4, 2, 1, 1, 1, 2))
        self.assertEqual(next(x for x in live["rows"] if x["id"] == me2)["status"], "none")
        st, r = self.req("POST", "/api/asg/finish", {"id": aid}, tok)
        self.assertEqual(st, 200, r)
        self.assertEqual((r["result"]["ok"], r["result"]["half"], r["result"]["bad"], r["result"]["pct"], r["result"]["grade"]),
                         (2, 1, 1, 63, 4))                                    # 2.5 из 4 = 63% → «4» (порог 60)
        self.assertEqual(self.req("POST", "/api/asg/finish", {"id": aid}, tok)[1]["result"]["grade"], 4)   # повторно — то же
        n = server.APP.db.q("SELECT COUNT(*) AS c FROM attempts WHERE student_id=? AND reason='work'", (me,), one=True)["c"]
        self.assertEqual(n, 4)                                               # в журнал — один раз
        self.assertEqual(self.check(tok, pid5, answer="12")[0], 200)          # после сдачи — обычная тренировка
        st, rv = self.req("GET", f"/api/asg/review?id={aid}", token=tok)
        self.assertTrue(rv["locked"])                                       # одноклассница ещё не сдавала — ответов не видно
        self.assertNotIn("items", rv)
        self.assertEqual(self.req("GET", f"/api/asg/review?id={aid}", token=tok2)[0], 409)     # не сдала — разбора нет
        # вторая ученица начала, учитель завершает для всех — оценка ставится по сданному
        self.req("POST", "/api/asg/start", {"id": aid}, tok2)
        self.req("POST", "/api/asg/answer", {"id": aid, "task": pid5, "answer": "12"}, tok2)
        st, c = self.admin("POST", "/api/admin/asg/close", {"id": aid})
        self.assertEqual((st, c["finished"]), (200, 1))
        st, rv = self.req("GET", f"/api/asg/review?id={aid}", token=tok)    # завершена для всех — разбор открыт
        self.assertEqual(st, 200, rv)
        it5 = next(x for x in rv["items"] if x["task"] == pid5)
        self.assertEqual((it5["mine"], it5["answer"], it5["credit"], it5["code"]), ("12", "12", 1.0, "print(12)"))
        self.assertIn("решение", it5["sol"])
        st, r = self.req("POST", "/api/asg/answer", {"id": aid, "task": pid27, "answer": "10 20"}, tok2)
        self.assertTrue(r["closed"])
        self.assertEqual((r["result"]["ok"], r["result"]["blank"], r["result"]["grade"], r["result"]["forced"]), (1, 3, 2, True))
        tok3 = self.login("Опоздалов Олег")
        me3 = self.req("GET", "/api/me", token=tok3)[1]["sid"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me3]})
        self.assertEqual(self.req("POST", "/api/asg/start", {"id": aid}, tok3)[0], 409)          # закрыта — не начать
        # состав начатой контрольной не меняется
        st, d = self.admin("POST", "/api/admin/assignment/save", {"id": aid, "class_id": cid, "title": "К", "strict": True, "tasks": ["b:5"]})
        self.assertEqual(st, 409, d)
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_fast_solve_costs_xp(self):
        # верно, но быстрее минуты с открытия задания (по часам сервера) — −1 XP вместо опыта
        tok = self.login("Быстров Борис")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        pid5, pid6 = server.APP.bank.pid("b:5"), server.APP.bank.pid("b:6")
        self.req("POST", "/api/open", {"task": pid5}, tok)
        server.OPENED.get(sid, "b:5")["ts"] -= 20                            # открыл 20 секунд назад
        st, r = self.check(tok, pid5, answer="12", spent_ms=999999)            # клиент «сказал» больше — верим серверу
        self.assertTrue(r["correct"] and r["fast"])
        self.assertEqual(r["game"]["xp"], 0)                                   # −1, но ниже нуля опыт не уходит
        self.req("POST", "/api/open", {"task": pid6}, tok)
        server.OPENED.get(sid, "b:6")["ts"] -= 90                            # полторы минуты — честное решение
        st, r = self.check(tok, pid6, answer="7")
        self.assertFalse(r["fast"])
        self.assertEqual(r["game"]["xp"], server.task_xp(server.APP.bank.tasks["b:6"]["n"], server.APP.bank.tasks["b:6"].get("r")) + 5 - 1)                  # −1 за быстрое, задание, «Первый шаг»
        self.req("POST", "/api/open", {"task": pid5}, tok)                     # быстрое решение не засчитано решённым:
        server.OPENED.get(sid, "b:5")["ts"] -= 120                           # честный повтор даёт полный опыт
        st, r = self.check(tok, pid5, answer="12")
        self.assertEqual(r["game"]["xp"], server.task_xp(server.APP.bank.tasks["b:6"]["n"], server.APP.bank.tasks["b:6"].get("r")) + server.task_xp(server.APP.bank.tasks["b:5"]["n"], server.APP.bank.tasks["b:5"].get("r")) + 5 - 1)
        # решённое до появления правила задним числом не пересчитывается
        server.APP.db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score,spent_ms) VALUES(?,?,?,?,?,?,?,?)",
                        (sid, server.fast_xp_since(server.APP.db) - 100, "b:27", 27, "[]", "1", 1.0, 5000))
        self.assertGreaterEqual(server.game_summary(server.APP.db, sid)["xp"], 46)   # +22 за №27 (и достижения), без −1

    def test_reason_from_browser_gives_no_repeat_xp(self):
        # лазейка из журнала: одно и то же задание по кругу с «почему выдано: asg» — каждый раз опыт
        tok = self.login("Кругов Костя")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        pid5 = server.APP.bank.pid("b:5")
        xp = []
        for reason in ("new", "asg", "asg", "work", "asg"):
            self.req("POST", "/api/open", {"task": pid5}, tok)
            server.OPENED.get(sid, "b:5")["ts"] -= 120
            st, r = self.check(tok, pid5, answer="12", reason=reason)
            xp.append(r["game"]["xp"])
        self.assertEqual(len(set(xp)), 1, xp)                                # опыт — только за первое решение
        self.assertNotIn("work", {r["reason"] for r in server.APP.db.q("SELECT reason FROM attempts WHERE student_id=?", (sid,))})

    def test_exploit_window_cuts_all_xp(self):
        # пользовался лазейкой (5+ повторов с «подборка») — срезается весь опыт с первого повтора до исправления
        db = server.APP.db
        sid = db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES('Багов Борис','багов борис','tkbug',0,0)")
        t0 = time.time() - 3 * 3600
        add = lambda ts, tid, n, reason, ms=120000: db.x(
            "INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score,spent_ms,reason) VALUES(?,?,?,?,?,?,?,?,?)",
            (sid, ts, tid, n, "[]", "x", 1.0, ms, reason))
        add(t0, "b:5", 5, "new")                                            # честно, до лазейки
        for k in range(8):
            add(t0 + 300 + k * 20, "b:5", 5, "asg")                         # честное повторение подборки (по 2 минуты) — не лазейка
        for k in range(12):
            add(t0 + 600 + k * 30, "b:5", 5, "asg", 6000)                   # по кругу по 6 секунд — лазейка
        add(t0 + 1200, "b:6", 6, "new")                                     # пока пользовался — тоже срезается
        fixed = t0 + 3600
        old = db.setting("asg_exploit_fixed")
        db.setting("asg_exploit_fixed", str(fixed))
        add(fixed + 60, "b:27", 27, "new")                                  # после исправления — снова считается
        g = server.game_summary(db, sid)
        x5 = server.task_xp(5, server.APP.bank.tasks["b:5"].get("r"))
        x27 = server.task_xp(27, server.APP.bank.tasks["b:27"].get("r"))
        self.assertEqual(g["cheat"][0], t0 + 600)
        self.assertEqual(g["xp"], x5 + 5 + x27 + server.ACH_XP["lucky"])     # №5 и «Первый шаг» до; №27 и «Новичкам везёт» после; №6 срезан
        db.setting("asg_exploit_fixed", old)
        db.x("DELETE FROM attempts WHERE student_id=?", (sid,))
        db.x("DELETE FROM students WHERE id=?", (sid,))

    def test_task_xp_scale(self):
        # №1–10 — 10 XP, №11–27 — по номеру; +5 за каждую ступень сложности выше первой
        self.assertEqual([server.task_xp(n) for n in (1, 7, 10, 11, 17, 27)], [10, 10, 10, 11, 17, 27])
        self.assertEqual([server.task_xp(5, r) for r in (1, 2, 3, 4, 5)], [10, 15, 20, 25, 30])
        self.assertEqual(server.task_xp(27, 5), 47)
        self.assertEqual(server.task_xp(7, None) * 7, 70)                    # 7 заданий №1–10 → 70 XP

    def test_seen_answer_gives_no_xp(self):
        # лазейка: ошибиться дважды → увидеть правильный ответ → открыть задание снова и ввести его
        tok = self.login("Лазейкин Лёва")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        pid6 = server.APP.bank.pid("b:6")
        self.req("POST", "/api/open", {"task": pid6}, tok)
        server.OPENED.get(sid, "b:6")["ts"] -= 120
        self.check(tok, pid6, answer="1")
        st, r = self.check(tok, pid6, answer="2")
        self.assertEqual(r["answer"], "7")                                   # ответ показан
        server.OPENED.reset(sid, "b:6")
        server.OPENED.get(sid, "b:6")["ts"] -= 120                          # открыл снова, «подумал» две минуты
        st, r = self.check(tok, pid6, answer="7")
        self.assertTrue(r["correct"] and r["nocount"])
        self.assertEqual(r["game"]["xp"], 0)                                 # ни опыта, ни «Первого шага»
        h = self.req("GET", "/api/history", token=tok)[1]["h"]
        self.assertEqual([x[10] for x in h], [0, 1])                         # сайт тоже знает, что ответ не засчитан
        # а задание, ответ на которое не показывали, — как обычно
        pid5 = server.APP.bank.pid("b:5")
        self.req("POST", "/api/open", {"task": pid5}, tok)
        server.OPENED.get(sid, "b:5")["ts"] -= 120
        st, r = self.check(tok, pid5, answer="12")
        self.assertFalse(r["nocount"])
        self.assertEqual(r["game"]["xp"], server.task_xp(server.APP.bank.tasks["b:5"]["n"], server.APP.bank.tasks["b:5"].get("r")) + 5)
        self.assertNotIn("flash", [a["id"] for a in r["game"]["ach"]])       # «Флэш» за скорость убран

    def test_repeats_do_not_count_retroactively(self):
        # нафармленное раньше повторами снимается: засчитывается только первое решение задания
        db = server.APP.db
        sid = db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES('Фармов Фёдор','фармов фёдор','tkfarm',0,0)")
        t0 = time.time() - 30 * 86400
        for k in range(20):                                                 # одно задание №5 двадцать раз за месяц
            db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score,spent_ms) VALUES(?,?,?,?,?,?,?,?)",
                 (sid, t0 + k * 86400, "b:5", 5, "[]", "12", 1.0, 120000))
        g = server.game_summary(db, sid)
        self.assertEqual(g["fire"], 0)                                      # огонёк повторами не горел
        got = {a["id"] for a in g["ach"] if a["got"]}
        self.assertNotIn("days7", got)
        self.assertEqual(g["xp"], server.task_xp(server.APP.bank.tasks["b:5"]["n"], server.APP.bank.tasks["b:5"].get("r")) + 5)                               # №5 один раз + «Первый шаг»
        db.x("DELETE FROM attempts WHERE student_id=?", (sid,))
        db.x("DELETE FROM students WHERE id=?", (sid,))

    def test_fire_streak_on_server(self):
        db = server.APP.db
        sid = db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES('Огнев Олег','огнев олег','tkfire',0,0)")
        noon = time.mktime(datetime.date.today().timetuple()) + 12 * 3600
        for back, n in ((0, 3), (1, 4), (2, 3), (4, 5)):      # сегодня, вчера, позавчера; 3 дня назад — пропуск
            for i in range(n):
                db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)",
                     (sid, noon - back * 86400 + i, f"b:{i}", 5, "[]", "1", 0))
        self.assertEqual(server.game_summary(db, sid, brief=True)["fire"], 3)
        for t in ("attempts", "students"):
            db.x(f"DELETE FROM {t} WHERE {'student_id' if t == 'attempts' else 'id'}=?", (sid,))

    def test_brief_summary_cache_refreshes(self):
        db = server.APP.db
        sid = db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES('Кэшев Кирилл','кэшев кирилл','tkcache',0,0)")
        def add(i):
            db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)",
                 (sid, time.time() - 60 + i, f"cache:{i}", 2, "[]", "1", 1.0))
        add(0)
        xp1 = server.game_summary(db, sid, brief=True)["xp"]
        self.assertEqual(server.game_summary(db, sid, brief=True)["xp"], xp1)      # из кэша — то же самое
        add(1)                                                                     # новый ответ — кэш сбрасывается
        self.assertGreater(server.game_summary(db, sid, brief=True)["xp"], xp1)
        db.x("DELETE FROM attempts WHERE student_id=?", (sid,))
        db.x("DELETE FROM students WHERE id=?", (sid,))

    def test_course_password(self):
        tok = self.login("Курсовой Кирилл")
        self.assertFalse(self.req("GET", "/api/me", token=tok)[1]["course"])
        self.assertEqual(self.req("POST", "/api/course/unlock", {"password": "x"}, tok)[0], 403)      # пароль ещё не задан
        st, d = self.admin("POST", "/api/admin/course", {"password": "сова2026"})
        self.assertEqual((st, d["set"]), (200, True))
        self.assertEqual(self.req("POST", "/api/course/unlock", {"password": "неверно"}, tok)[0], 403)
        self.assertEqual(self.req("POST", "/api/course/unlock", {"password": "сова2026"}, tok)[0], 200)
        self.assertTrue(self.req("GET", "/api/me", token=tok)[1]["course"])
        who = self.admin("GET", "/api/admin/course/list")[1]["students"]                          # список для главного учителя
        self.assertEqual([w["name"] for w in who], ["Курсовой Кирилл"])
        self.assertTrue(who[0]["ts"])
        self.admin("POST", "/api/admin/course", {"revoke": True})                                 # закрыть всем
        self.assertFalse(self.req("GET", "/api/me", token=tok)[1]["course"])
        tok2 = self.login("Подборщик Пароля")
        codes = [self.req("POST", "/api/course/unlock", {"password": f"p{i}"}, tok2)[0] for i in range(server.COURSE_TRIES + 1)]
        self.assertEqual(codes[-1], 429)                                                          # подбор пароля — стоп
        self.assertEqual(self.req("POST", "/api/course/unlock", {"password": "сова2026"}, tok2)[0], 429)
        self.assertEqual(self.req("GET", "/api/course/lesson?n=5", token=tok)[0], 403)            # курс закрыт — слайдов нет
        self.admin("POST", "/api/admin/course", {"password": "сова2026"})
        self.req("POST", "/api/course/unlock", {"password": "сова2026"}, tok)
        (server.HERE / "course").mkdir(exist_ok=True)                                              # презентация из репозитория
        (server.HERE / "course" / "5.json").write_text((Path(__file__).resolve().parent.parent / "course" / "5.json").read_text(encoding="utf-8"), encoding="utf-8")
        st, d = self.req("GET", "/api/course/lesson?n=5", token=tok)
        self.assertEqual(st, 200)
        self.assertGreater(len(d["slides"]), 10)                                                  # презентация №5 на месте
        self.assertEqual(self.req("GET", "/api/course/lesson?n=99", token=tok)[1]["slides"], [])
        self.admin("POST", "/api/admin/course", {"off": True})
        self.assertFalse(self.admin("GET", "/api/admin/info")[1]["course_set"])

    def test_course_sets_and_progress(self):
        # подборки курса собирает сервер; главный учитель видит прогресс: слайды и решённые задания подборок
        self.admin("POST", "/api/admin/course", {"password": "лиса2026"})
        tok = self.login("Прогрессов Пётр")
        self.assertEqual(self.req("GET", "/api/course/sets", token=tok)[0], 403)                 # курс не открыт
        self.req("POST", "/api/course/unlock", {"password": "лиса2026"}, tok)
        st, d = self.req("GET", "/api/course/sets", token=tok)
        self.assertEqual(st, 200, d)
        p5 = server.APP.bank.pid("b:5")
        self.assertIn(p5, [i for v in d["sets"]["5"].values() for i in v])                     # задание №5 попало в подборки урока
        (server.HERE / "course").mkdir(exist_ok=True)
        (server.HERE / "course" / "5.json").write_text((Path(__file__).resolve().parent.parent / "course" / "5.json").read_text(encoding="utf-8"), encoding="utf-8")
        self.assertEqual(self.req("POST", "/api/course/seen", {"n": 5, "slide": 7, "total": 34}, tok)[0], 200)
        self.req("POST", "/api/course/seen", {"n": 5, "slide": 3, "total": 34}, tok)              # назад — максимум не уменьшается
        self.assertEqual(self.req("POST", "/api/course/seen", {"n": 5, "slide": 99, "total": 34}, tok)[0], 400)
        self.req("POST", "/api/open", {"task": p5}, tok)
        self.check(tok, p5, answer="12")
        st, d = self.admin("GET", "/api/admin/course/progress")
        self.assertEqual(st, 200, d)
        me = next(s for s in d["students"] if s["name"] == "Прогрессов Пётр")
        self.assertEqual(me["lessons"]["5"]["seen"], 7)
        self.assertGreaterEqual(sum(v["done"] for v in me["lessons"]["5"]["sets"].values()), 1)   # в маленьком банке контрольная повторяет задания
        self.assertGreater(me["pct"], 0)
        sid = me["id"]
        st, d = self.admin("GET", f"/api/admin/course/progress?id={sid}")
        tasks = [t for v in d["students"][0]["lessons"]["5"]["sets"].values() for t in v["tasks"]]
        self.assertEqual({t["st"] for t in tasks if t["id"] == "b:5"}, {"ok"})
        self.admin("POST", "/api/admin/course", {"off": True})

    def test_pycourse_access_levels_check(self):
        # курс программирования закрыт: открывает учитель; уровни по порядку; ответ проверяет сервер и не отдаёт заранее
        d = server.HERE / "pycourse"
        (d / "data" / "m90" / "t1").mkdir(parents=True, exist_ok=True)
        (d / "data" / "m90" / "t1" / "a.txt").write_text("1\n2\n", encoding="utf-8")
        lv = lambda i, ans: {"title": f"Уровень {i}", "goal": "", "need": 1, "slides": [{"t": "text", "h": "Слайд", "html": "<p>x</p>"}],
                             "tasks": [{"id": f"m90.t{i}", "h": "Задача", "cond": "<p>?</p>", "stars": 1, "ans": ans, "sol": "print(42)"}]}
        mod = {"id": "m90", "n": 5, "title": "Тест", "icon": "🐍", "sub": "", "levels": [lv(1, "2, 5"), lv(2, "abc")]}
        (d / "m90.json").write_text(json.dumps(mod, ensure_ascii=False), encoding="utf-8")
        (d / "index.json").write_text(json.dumps([{**{k: mod[k] for k in ("id", "n", "title", "icon", "sub")}, "group": "ege",
                                                   "levels": [{"title": x["title"], "goal": "", "need": 1, "tasks": [t["id"] for t in x["tasks"]],
                                                               "slides": 1} for x in mod["levels"]]}], ensure_ascii=False), encoding="utf-8")
        tok = self.login("Кодов Константин")
        me = self.req("GET", "/api/me", token=tok)[1]
        # курс — по паролю, как раздел «Курс»: пока пароль не задан, закрыт у всех учеников
        self.assertEqual((me["pyc"], me["pyc_pw"]), (False, False))
        self.assertEqual(self.req("GET", "/api/pyc", token=tok)[1], {"access": False, "pw": False})
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=0", token=tok)[0], 403)
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": "kod-2026"}, tok)[0], 403)
        self.assertEqual(self.admin("POST", "/api/admin/pyc/access", {"student_id": me["sid"], "on": True})[0], 404)  # галочек нет
        self.assertEqual(self.admin("POST", "/api/admin/pyc/password", {"password": "12"})[0], 400)    # слишком короткий
        st, r = self.admin("POST", "/api/admin/pyc/password", {"password": "kod-2026"})
        self.assertEqual((st, r["pw_set"], r["students"]), (200, True, 0))
        self.assertNotIn("kod-2026", json.dumps([dict(x) for x in server.APP.db.q("SELECT * FROM settings")]))  # в базе только хеш
        me = self.req("GET", "/api/me", token=tok)[1]
        self.assertEqual((me["pyc"], me["pyc_pw"]), (False, True))                                 # у ученика — замок и поле пароля
        self.assertEqual(self.req("GET", "/api/pyc", token=tok)[1], {"access": False, "pw": True})
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": "kod-2025"}, tok)[0], 403)
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": " kod-2026 "}, tok)[0], 200)
        st, plan = self.req("GET", "/api/pyc", token=tok)
        self.assertTrue(plan["access"])
        self.assertEqual(plan["modules"][0]["open"], 1)                                          # открыт только первый уровень
        st, L = self.req("GET", "/api/pyc/level?m=m90&l=0", token=tok)
        self.assertEqual(st, 200, L)
        self.assertNotIn("ans", L["level"]["tasks"][0])                                          # ответа и разбора заранее нет
        self.assertNotIn("sol", L["level"]["tasks"][0])
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=1", token=tok)[0], 403)          # второй уровень закрыт
        self.assertEqual(self.req("POST", "/api/pyc/check", {"task": "m90.t2", "answer": "abc"}, tok)[0], 403)
        st, r = self.req("POST", "/api/pyc/check", {"task": "m90.t1", "answer": "7"}, tok)
        self.assertEqual((r["ok"], r["tries"]), (False, 1))
        self.assertNotIn("sol", r)
        st, r = self.req("POST", "/api/pyc/check", {"task": "m90.t1", "answer": " 2 ;5 ", "code": "print(2, 5)"}, tok)
        self.assertTrue(r["ok"])                                                                  # «2, 5» = «2 ;5»
        self.assertTrue(r["opened"])                                                              # открылся следующий уровень
        self.assertEqual(r["sol"], "print(42)")
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=1", token=tok)[0], 200)
        self.assertEqual(self.req("GET", "/pyc-data/m90/t1/a.txt")[1], b"1\n2\n")              # файл задачи отдаётся как есть
        self.assertEqual(self.req("GET", "/pycourse/m90.json")[0], 404)                         # а уроки с ответами — нет
        st, a = self.admin("GET", "/api/admin/pyc")
        self.assertEqual([x["id"] for x in a["students"]], [me["sid"]])                            # в списке — только вошедшие
        row = a["students"][0]
        self.assertEqual((row["done"], row["mods"], row["free"]), (1, {"m90": {"done": 1, "bad": 0}}, False))
        self.assertTrue(row["since"])                                                             # учитель видит, когда вошёл
        st, det = self.admin("GET", f"/api/admin/pyc/student?id={me['sid']}")
        t1 = det["modules"][0]["levels"][0]["tasks"][0]
        self.assertEqual((t1["ok"], t1["tries"], t1["code"]), (True, 2, "print(2, 5)"))
        # другой ученик пароля не знает — курс ему закрыт; подбирать пароль не выйдет
        tok2 = self.login("Подборов Пётр")
        self.assertFalse(self.req("GET", "/api/pyc", token=tok2)[1]["access"])
        # учитель открывает ученику все уровни сразу: второй уровень доступен без решённых задач первого
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": "kod-2026"}, tok2)[0], 200)
        sid2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=1", token=tok2)[0], 403)
        self.assertEqual(self.admin("POST", "/api/admin/pyc/free", {"student_id": sid2, "on": True})[0], 200)
        self.assertEqual(self.req("GET", "/api/pyc", token=tok2)[1]["modules"][0]["open"], 2)
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=1", token=tok2)[0], 200)
        self.assertNotIn("sol", self.req("GET", "/api/pyc/level?m=m90&l=1", token=tok2)[1]["level"]["tasks"][0])  # разбор — нет
        self.assertTrue(next(x for x in self.admin("GET", "/api/admin/pyc")[1]["students"] if x["id"] == sid2)["free"])
        self.admin("POST", "/api/admin/pyc/free", {"student_id": sid2, "on": False})
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=1", token=tok2)[0], 403)
        tok2 = self.login("Переборов Павел")                                                      # этот пароль подбирает
        for _ in range(server.COURSE_TRIES):
            self.req("POST", "/api/pyc/unlock", {"password": "kod-0000"}, tok2)
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": "kod-2026"}, tok2)[0], 429)
        # «Закрыть всем» — снова нужен пароль; «Выключить курс» — пароль сброшен, закрыт у всех
        st, r = self.admin("POST", "/api/admin/pyc/password", {"revoke": True})
        self.assertEqual((r["pw_set"], r["students"]), (True, 0))
        self.assertFalse(self.req("GET", "/api/pyc", token=tok)[1]["access"])
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": "kod-2026"}, tok)[0], 200)
        self.admin("POST", "/api/admin/pyc/password", {"off": True})
        self.assertEqual(self.req("GET", "/api/pyc/level?m=m90&l=0", token=tok)[0], 403)
        self.assertEqual(self.req("POST", "/api/pyc/unlock", {"password": "kod-2026"}, tok)[0], 403)
        self.assertEqual(self.req("GET", "/api/me", token=tok)[1]["pyc_pw"], False)
        shutil.rmtree(d)

    def test_funny_achievements(self):
        db = server.APP.db
        sid = db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES('Шутов Шура','шутов шура','tkfun',0,0)")
        fri13 = time.mktime((2026, 3, 13, 12, 0, 0, 0, 0, -1))            # пятница, 13 марта 2026
        rows = [(fri13 - 30 * 86400, 2, 1, None)]                          # месяц назад — потом перерыв (Феникс)
        rows += [(fri13 + i, 3, 0, None) for i in range(1, 6)]             # пять ошибок подряд…
        rows += [(fri13 + 10, 6, 1, 15000), (fri13 + 11, 27, 1, 60000)]   # …и решено: №6 быстро, первое же №27 верно
        for i, (ts, n, sc, ms) in enumerate(rows):
            db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score,spent_ms) VALUES(?,?,?,?,?,?,?,?)",
                 (sid, ts, f"fun:{i}", n, "[]", "1", sc, ms))
        for k, sc in enumerate((0, 0, 0, 1)):                               # одно и то же задание: три раза мимо, потом верно
            db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score,spent_ms) VALUES(?,?,?,?,?,?,?,?)",
                 (sid, fri13 + 20 + k, "fun:stub", 8, "[]", "1", sc, 2000000))
        clock, server.ACH_CLOCK = server.ACH_CLOCK, time.localtime          # здесь нужны настоящие даты попыток
        try:
            got = {a["id"] for a in server.game_summary(db, sid)["ach"] if a["got"]}
        finally:
            server.ACH_CLOCK = clock
        self.assertTrue({"bug", "phoenix", "fri13", "lucky", "stubborn", "snail"} <= got, got)
        self.assertFalse({"pi", "newyear", "cinderella", "perfect", "dejavu", "rainbow"} & got)
        db.x("DELETE FROM attempts WHERE student_id=?", (sid,))
        db.x("DELETE FROM students WHERE id=?", (sid,))

    # ------------------------------------------------------------ соревнования
    def test_league_week_rollover(self):
        db = server.APP.db
        prev = server.week_start() - 4 * 86400                           # середина прошлой недели
        sids = []
        for i in range(16):                                               # 16 человек в серебряной лиге
            sid = db.x("INSERT INTO students(name,name_key,token,created,last_seen) VALUES(?,?,?,0,0)",
                       (f"Лигов{chr(1040 + i)} Л", f"лигов{i} л", f"tklg{i}"))
            db.x("INSERT INTO leagues(student_id, league, week) VALUES(?,1,?)", (sid, server.week_key(prev)))
            for k in range(i):                                            # i-й ученик решил i заданий
                db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)",
                     (sid, prev + k, f"lg:{i}:{k}", 2, "[]", "1", 1.0))
            sids.append(sid)
        db.setting("league_week", server.week_key(prev))
        server.league_rollover(db)
        got = {sid: db.q("SELECT league, result, result_place FROM leagues WHERE student_id=?", (sid,), one=True) for sid in sids}
        self.assertEqual([got[x]["league"] for x in sids], [0, 0, 0] + [1] * 8 + [2] * 5)   # трое вниз, из серебра — пятеро вверх
        aw = {(r["student_id"], r["kind"]) for r in db.q("SELECT student_id, kind FROM awards")}
        self.assertIn((sids[15], "league1"), aw)                          # победитель лиги и повышение — в награды профиля
        self.assertEqual({k for x, k in aw if x in sids}, {"league1", "up"})
        self.assertEqual(sum(1 for x, k in aw if x in sids and k == "up"), 5)
        self.assertEqual(got[sids[15]]["result"], "up")
        self.assertEqual(got[sids[15]]["result_place"], 1)
        self.assertEqual(got[sids[0]]["result"], "down")
        server.league_rollover(db)                                        # повторно в ту же неделю — ничего не меняется
        self.assertEqual(db.q("SELECT league FROM leagues WHERE student_id=?", (sids[15],), one=True)["league"], 2)
        for sid in sids:
            for t in ("attempts", "leagues", "awards"):
                db.x(f"DELETE FROM {t} WHERE student_id=?", (sid,))
            db.x("DELETE FROM students WHERE id=?", (sid,))

    def test_daily_task_and_crown(self):
        tok = self.login("Дневной Денис")
        st, d = self.req("GET", "/api/daily", token=tok)
        self.assertEqual(st, 200, d)
        self.assertIsNone(d["task"])                                      # какое задание — только после «Решать»
        d = self.req("POST", "/api/daily/start", {}, tok)[1]
        real = server.APP.bank.real(d["task"])
        ans = next(t for t in BANK["tasks"] if t["id"] == real)["ans"]
        self.req("POST", "/api/open", {"task": d["task"]}, tok)
        old_min, server.DAILY_MIN_SEC = server.DAILY_MIN_SEC, {n: 0 for n in range(1, 28)}
        try:
            self.check(tok, d["task"], answer=ans)
        finally:
            server.DAILY_MIN_SEC = old_min
        st, d = self.req("GET", "/api/daily", token=tok)
        mine = next(r for r in d["top"] if r["me"])                       # другие ученики тестов могли решить раньше
        self.assertEqual((mine["name"], mine["place"], d["my_place"]), ("Дневной Д.", d["my_place"], d["my_place"]))
        self.assertGreaterEqual(d["mine"], 0)
        # вчерашний самый быстрый носит корону
        me = self.req("GET", "/api/me", token=tok)[1]["sid"]
        y = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
        server.APP.db.x("INSERT INTO daily_results(day, student_id, task_id, ms, ts) VALUES(?,?,?,?,?)", (y, me, real, 5000, 0))
        self.assertEqual(self.req("GET", "/api/daily", token=tok)[1]["crown"], "Дневной Д.")
        board = self.req("GET", "/api/leaderboard", token=tok)[1]["boards"]
        self.assertIn("👑", [b["i"] for b in next(r for r in board["day"]["top"] if r["me"])["badges"]])
        self.assertEqual(board["league"]["name"], "Бронзовая лига")
        lgs = board.get("leagues") or self.req("GET", "/api/leaderboard", token=tok)[1]["boards"]["leagues"]
        self.assertEqual([x["name"] for x in lgs], ["Бронзовая лига", "Серебряная лига", "Золотая лига", "Алмазная лига"])
        self.assertTrue(any(r["me"] for r in lgs[0]["top"]))                # своя лига — со своей строкой
        # профиль: корона посчитана, значки у ника выбираются (до трёх и только полученные)
        st, pr = self.req("GET", "/api/profile", token=tok)
        self.assertEqual(st, 200, pr)
        self.assertTrue(pr["me"])
        self.assertEqual(next(a for a in pr["awards"] if a["k"] == "crown")["n"], 1)
        self.assertTrue(pr["ach"])                                          # первое задание решено — «Первый шаг»
        first = pr["ach"][0]["k"]
        self.assertEqual(self.req("POST", "/api/profile/badges", {"keys": ["duel"]}, tok)[0], 400)      # дуэлей не выигрывал
        self.assertEqual(self.req("POST", "/api/profile/badges", {"keys": ["crown", first, "x", "y"]}, tok)[0], 400)
        self.assertEqual(self.req("POST", "/api/profile/badges", {"keys": [first, "crown"]}, tok)[0], 200)
        board = self.req("GET", "/api/leaderboard", token=tok)[1]["boards"]
        mine = next(r for r in board["day"]["top"] if r["me"])
        self.assertEqual([b["k"] for b in mine["badges"]], [first, "crown"])
        self.assertEqual(mine["sid"], me)
        # повторная корона — у значка число
        y2 = (datetime.date.today() - datetime.timedelta(days=2)).isoformat()
        server.APP.db.x("INSERT INTO daily_results(day, student_id, task_id, ms, ts) VALUES(?,?,?,?,?)", (y2, me, real, 1, 0))
        pr = self.req("GET", "/api/profile", token=tok)[1]
        self.assertEqual(next(b for b in pr["badges"] if b["k"] == "crown")["n"], 2)
        # чужой профиль — только ученики того же учителя
        other = self.login("Соседов Сеня")
        st, pr2 = self.req("GET", f"/api/profile?sid={me}", token=other)
        self.assertEqual(st, 200, pr2)
        self.assertFalse(pr2["me"])
        self.assertEqual(pr2["name"], "Дневной Д.")
        self.assertEqual(self.req("GET", "/api/profile?sid=999999", token=other)[0], 404)
        self.assertEqual(self.req("POST", "/api/profile/badges", {"keys": None}, tok)[0], 200)     # сброс — значки автоматически

    def test_daily_once_per_day(self):
        # зашёл в задание дня — сервер это помнит; вторая попытка в рейтинг не идёт, время — от первого входа
        tok = self.login("Однодневов Олег")
        d = self.req("GET", "/api/daily", token=tok)[1]
        self.assertIsNone(d["started"])
        d = self.req("POST", "/api/daily/start", {}, tok)[1]
        self.assertEqual(self.req("POST", "/api/daily/start", {}, tok)[1], d)   # второй вход — то же задание и время
        real = server.APP.bank.real(d["task"])
        ans = next(t for t in BANK["tasks"] if t["id"] == real)["ans"]
        self.req("POST", "/api/open", {"task": d["task"]}, tok)
        started = self.req("GET", "/api/daily", token=tok)[1]["started"]
        self.assertIsNotNone(started)
        self.check(tok, d["task"], answer="неверно-1")
        self.check(tok, d["task"], answer="неверно-2")                     # попытки кончились
        self.req("POST", "/api/open", {"task": d["task"]}, tok)            # «зашёл второй раз»
        self.assertEqual(self.req("GET", "/api/daily", token=tok)[1]["started"], started)   # время первого входа
        self.check(tok, d["task"], answer=ans)
        d = self.req("GET", "/api/daily", token=tok)[1]
        self.assertIsNone(d["my_place"])                                   # в рейтинг не попал

    def test_daily_personal_and_too_fast(self):
        # у каждого своё задание дня того же номера и типа; ответ за пару секунд в рейтинг не идёт
        ta, tb = self.login("Личнов Лев"), self.login("Личнов Марк")
        da = self.req("POST", "/api/daily/start", {}, ta)[1]
        db_ = self.req("POST", "/api/daily/start", {}, tb)[1]
        base = server.APP.bank.tasks[server.daily_task_id()]
        for d in (da, db_):
            t = server.APP.bank.tasks[server.APP.bank.real(d["task"])]
            self.assertEqual((t["n"], t.get("c")), (base["n"], base.get("c")))
        real = server.APP.bank.real(da["task"])
        ans = next(t for t in BANK["tasks"] if t["id"] == real)["ans"]
        self.req("POST", "/api/open", {"task": da["task"]}, ta)
        st, r = self.check(ta, da["task"], answer=ans)
        self.assertEqual(st, 200, r)
        self.assertTrue(r.get("daily_fast"))
        d = self.req("GET", "/api/daily", token=ta)[1]
        self.assertTrue(d["fast"])
        self.assertIsNone(d["my_place"])
        self.assertFalse(any(x["me"] for x in d["top"]))

    def test_duel_full_cycle(self):
        ta, tb = self.login("Дуэлев Аркадий"), self.login("Дуэлев Борис")
        sb = self.req("GET", "/api/me", token=tb)[1]["sid"]
        server.APP.db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)",
                        (sb, time.time() - 100, "du:old", 5, "[]", "1", 1.0))   # у Бориса есть опыт — будет что забрать
        self.assertEqual(self.req("GET", "/api/duels", token=ta)[0], 200)   # дуэли открыты всем, без кода
        self.assertEqual(self.req("POST", "/api/duel/create", {"sid": sb}, ta)[0], 410)   # прямого вызова больше нет
        server.APP.db.x("DELETE FROM duel_queue")
        self.req("POST", "/api/duel/find", {}, tb)
        st, d = self.req("POST", "/api/duel/find", {}, ta)
        self.assertEqual(st, 200, d)
        did = d["matched"]
        inv = self.req("GET", "/api/duels", token=tb)[1]["duels"][0]
        self.assertEqual((inv["status"], inv["opponent"]), ("active", "Дуэлев А."))
        tasks = self.req("POST", "/api/duel/start", {"id": did}, ta)[1]["tasks"]
        for pid in tasks:                                                 # Аркадий решает всё верно
            real = server.APP.bank.real(pid)
            self.req("POST", "/api/open", {"task": pid}, ta)
            self.check(ta, pid, answer=next(t for t in BANK["tasks"] if t["id"] == real)["ans"])
        self.req("POST", "/api/duel/finish", {"id": did}, ta)
        self.req("POST", "/api/duel/start", {"id": did}, tb)
        self.req("POST", "/api/duel/finish", {"id": did}, tb)              # Борис ничего не решил
        res = {d["id"]: d for d in self.req("GET", "/api/duels", token=ta)[1]["duels"]}[did]
        self.assertEqual((res["status"], res["result"], res["my_solved"], res["op_solved"]), ("finished", "win", len(tasks), 0))
        self.assertEqual(res["stake"], 100)                               # за победу +100 XP
        self.assertGreater(self.req("GET", "/api/me", token=tb)[1]["game"]["xp"], 0)   # проигравший опыт не теряет
        # турнирная таблица недели: победа — 3 очка; второй матч той же пары за неделю — нельзя
        T = self.req("GET", "/api/duels", token=ta)[1]["tournament"]
        top = {r["name"]: r for r in T["table"]}
        self.assertEqual((top["Дуэлев А."]["pts"], top["Дуэлев А."]["w"], top["Дуэлев Б."]["pts"], top["Дуэлев Б."]["l"]), (3, 1, 0, 1))
        self.assertEqual(T["table"][0]["name"], "Дуэлев А.")
        arch = self.admin("GET", "/api/admin/competitions")[1]["duels"]
        self.assertEqual(next(x for x in arch if x["id"] == did)["winner"], "Дуэлев Аркадий")      # архив дуэлей у учителя
        self.req("POST", "/api/duel/find", {}, tb)                        # второй раз за неделю их не сведёт
        self.assertTrue(self.req("POST", "/api/duel/find", {}, ta)[1].get("searching"))
        self.req("POST", "/api/duel/cancel", {}, ta)
        self.req("POST", "/api/duel/cancel", {}, tb)

    def test_live_events(self):
        # живые обновления: без входа — 401; соперник нашёлся — обоим приходит «comp»; учитель выдал подборку — «asg»
        self.assertEqual(self.req("GET", "/api/live")[0], 401)
        server.APP.db.x("DELETE FROM duel_queue")
        ta, tb = self.login("Живой Андрей"), self.login("Живой Борис")
        sid_a = server.APP.db.q("SELECT id FROM students WHERE token=?", (ta,), one=True)["id"]
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/api/live", headers={"X-Token": ta})
        r = c.getresponse()
        self.assertEqual((r.status, r.getheader("Content-Type")), (200, "text/event-stream; charset=utf-8"))

        def next_event():
            ev = None
            while True:
                line = r.fp.readline().decode().strip()
                if line.startswith("event: "):
                    ev = line[7:]
                elif not line and ev:
                    return ev

        self.assertEqual(next_event(), "hello")
        time.sleep(0.5)                                  # сервер запомнил подпись дуэлей и турниров
        self.req("POST", "/api/duel/find", {}, ta)      # встал в очередь — это ещё не событие
        self.assertIn("matched", self.req("POST", "/api/duel/find", {}, tb)[1])
        self.assertEqual(next_event(), "comp")
        server.live_class(server.APP.db, None, [sid_a])
        self.assertEqual(next_event(), "asg")
        self.assertEqual(server.LIVE.count(), 1)
        c.close()
        for t in (ta, tb):
            self.req("POST", "/api/duel/cancel", {}, t)

    def test_live_teacher_and_support(self):
        # учитель: обращение ученика и его ответы — «feed»; учитель ответил — ученику «support»
        self.admin("GET", "/api/admin/me")                       # сессия учителя в базе
        tok = self.login("Живолентов Павел")

        def stream(headers):
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
            c.request("GET", "/api/admin/live" if "Cookie" in headers else "/api/live", headers=headers)
            r = c.getresponse()
            self.assertEqual(r.status, 200)

            def nxt():
                ev = None
                while True:
                    line = r.fp.readline().decode().strip()
                    if line.startswith("event: "):
                        ev = line[7:]
                    elif not line and ev:
                        return ev
            self.assertEqual(nxt(), "hello")
            return c, nxt

        self.assertEqual(self.req("GET", "/api/admin/live")[0], 401)
        ct, teacher = stream({"Cookie": "egeadm=admtest"})
        cs, pupil = stream({"X-Token": tok})
        self.assertEqual(self.req("POST", "/api/support", {"kind": "bug", "text": "Не открывается задание"}, tok)[0], 200)
        self.assertEqual(teacher(), "feed")
        self.check(tok, "b:5", answer="12")
        self.assertEqual(teacher(), "feed")
        got = {pupil(), pupil()}
        self.assertEqual(got, {"mine", "rate"})   # верный ответ: другим вкладкам ученика — «мои данные», классу — рейтинг
        sid = server.APP.db.q("SELECT id FROM support ORDER BY id DESC LIMIT 1", one=True)["id"]
        self.assertEqual(self.admin("POST", "/api/admin/support/answer", {"id": sid, "answer": "Починили"})[0], 200)
        self.assertEqual(pupil(), "support")
        ct.close()
        cs.close()

    def test_duel_matchmaking(self):
        # «Найти соперника»: первый ждёт в очереди, второй нажал — дуэль создана сразу, первый узнаёт о ней при следующем опросе
        ta, tb = self.login("Подборов Аркадий"), self.login("Подборов Борис")
        server.APP.db.x("DELETE FROM duel_queue")
        st, d = self.req("POST", "/api/duel/find", {}, ta)
        self.assertEqual((st, d.get("searching")), (200, True), d)
        self.assertTrue(self.req("GET", "/api/duels", token=ta)[1]["searching"])
        self.assertEqual(self.req("GET", "/api/duels", token=tb)[1]["seekers"], 1)
        st, d = self.req("POST", "/api/duel/find", {}, tb)
        self.assertEqual(st, 200, d)
        did = d["matched"]
        self.assertEqual(self.req("POST", "/api/duel/find", {}, ta)[1].get("matched"), did)
        duel = next(x for x in self.req("GET", "/api/duels", token=ta)[1]["duels"] if x["id"] == did)
        self.assertEqual((duel["status"], duel["quick"]), ("active", True))
        # номера заданий: меньше трёх — нельзя; без трёх общих номеров не сводим; дуэль — только по общим номерам
        server.APP.db.x("DELETE FROM duel_queue")
        td, te, tf = self.login("Номеров Дима"), self.login("Номеров Егор"), self.login("Номеров Фёдор")
        self.assertEqual(self.req("POST", "/api/duel/find", {"nums": [1, 2]}, td)[0], 400)
        self.req("POST", "/api/duel/find", {"nums": [1, 2, 3]}, td)
        self.assertTrue(self.req("POST", "/api/duel/find", {"nums": [4, 5, 6]}, te)[1].get("searching"))   # не совпали
        st, d = self.req("POST", "/api/duel/find", {"nums": [3, 5, 6, 7]}, tf)
        self.assertTrue(d.get("searching"))                                  # общих с Димой 1, с Егором 2 — мало
        self.req("POST", "/api/duel/cancel", {}, tf)
        st, d = self.req("POST", "/api/duel/find", {"nums": [1, 2, 3, 5]}, tf)
        self.assertIn("matched", d)                                          # с Димой три общих номера
        row = server.APP.db.q("SELECT * FROM duels WHERE id=?", (d["matched"],), one=True)
        self.assertTrue({server.APP.bank.tasks[x]["n"] for x in json.loads(row["tasks"])} <= {1, 2, 3})
        for t in (td, te, tf):
            self.req("POST", "/api/duel/cancel", {}, t)
        # лимит времени: №1–23 — 10 минут на задание, №24–27 — 30; оба вышли за лимит — дуэль закрывается сама
        self.assertEqual(server.duel_cap(["b:5", "b:6"]), 1200)
        self.assertEqual(server.duel_cap(["b:5", "b:27"]), 600 + 1800)
        st, d = self.req("POST", "/api/duel/start", {"id": did}, ta)
        self.assertEqual(d["cap"], server.duel_cap(server.side_tasks(server.APP.db.q("SELECT * FROM duels WHERE id=?", (did,), one=True), "a")))
        long_ago = time.time() - 4 * 3600
        server.APP.db.x("UPDATE duels SET a_start=?, b_start=? WHERE id=?", (long_ago, long_ago, did))
        duel = next(x for x in self.req("GET", "/api/duels", token=ta)[1]["duels"] if x["id"] == did)
        self.assertEqual(duel["status"], "finished")
        # отмена поиска
        tc = self.login("Подборов Виктор")
        self.req("POST", "/api/duel/find", {}, tc)
        self.req("POST", "/api/duel/cancel", {}, tc)
        self.assertFalse(self.req("GET", "/api/duels", token=tc)[1]["searching"])

    def test_duel_elo_streak_rematch_twins_cancel(self):
        db = server.APP.db
        ta, tb = self.login("Эловский Антон"), self.login("Эловский Борис")
        sa, sb = (self.req("GET", "/api/me", token=t)[1]["sid"] for t in (ta, tb))
        db.x("DELETE FROM duel_queue")
        self.req("POST", "/api/duel/find", {}, tb)
        did = self.req("POST", "/api/duel/find", {}, ta)[1]["matched"]
        row = db.q("SELECT * FROM duels WHERE id=?", (did,), one=True)
        ta_tasks, tb_tasks = server.side_tasks(row, "a"), server.side_tasks(row, "b")
        self.assertEqual(len(ta_tasks), len(tb_tasks))
        for x, y in zip(ta_tasks, tb_tasks):                                   # у соперника — свои задания того же номера
            self.assertEqual(server.APP.bank.tasks[x]["n"], server.APP.bank.tasks[y]["n"])
        # Антон (b в дуэли) решает всё, Борис (a) — ничего
        tasks = self.req("POST", "/api/duel/start", {"id": did}, ta)[1]["tasks"]
        self.assertEqual([server.APP.bank.real(p) for p in tasks], tb_tasks)
        for pid in tasks:
            real = server.APP.bank.real(pid)
            self.req("POST", "/api/open", {"task": pid}, ta)
            self.check(ta, pid, answer=next(t for t in BANK["tasks"] if t["id"] == real)["ans"])
        self.req("POST", "/api/duel/finish", {"id": did}, ta)
        self.req("POST", "/api/duel/start", {"id": did}, tb)
        self.req("POST", "/api/duel/finish", {"id": did}, tb)
        da = self.req("GET", "/api/duels", token=ta)[1]
        x = next(d for d in da["duels"] if d["id"] == did)
        self.assertEqual(x["result"], "win")
        self.assertGreater(x["elo"], 0)
        self.assertGreater(da["my_elo"], 1000)
        self.assertEqual(da["streak"], 1)
        tour = self.req("GET", "/api/tour", token=ta)[1]
        self.assertEqual(tour["elo"]["top"][0]["name"], "Эловский А.")              # рейтинг Эло сверху
        # реванш: только проигравший, один раз; принимается как вызов
        db_ = self.req("GET", "/api/duels", token=tb)[1]
        self.assertTrue(next(d for d in db_["duels"] if d["id"] == did)["can_rematch"])
        self.assertEqual(self.req("POST", "/api/duel/rematch", {"id": did}, ta)[0], 409)
        st, r = self.req("POST", "/api/duel/rematch", {"id": did}, tb)
        self.assertEqual(st, 200, r)
        self.assertEqual(self.req("POST", "/api/duel/rematch", {"id": did}, tb)[0], 409)
        inv = next(d for d in self.req("GET", "/api/duels", token=ta)[1]["duels"] if d["id"] == r["id"])
        self.assertEqual((inv["status"], inv["rematch"]), ("pending", True))
        # учитель отменяет первую дуэль — опыт и Эло возвращаются
        xp_before = self.req("GET", "/api/me", token=ta)[1]["game"]["xp"]
        st, _ = self.admin("POST", "/api/admin/duel/cancel", {"id": did})
        self.assertEqual(st, 200)
        self.assertEqual(round(server.elo_of(db, sa)), 1000)
        self.assertLessEqual(self.req("GET", "/api/me", token=ta)[1]["game"]["xp"], xp_before)
        arch = self.admin("GET", "/api/admin/competitions")[1]["duels"]
        self.assertEqual(next(d for d in arch if d["id"] == did)["status"], "void")
        # серия побед: считается подряд с последней дуэли
        for i in range(3):
            db.x("INSERT INTO duels(a, b, tasks, created, status, winner, finished) VALUES(?,?,?,?, 'finished', ?, ?)",
                 (sa, sb, "[]", time.time(), sa, time.time() + i))
        self.assertGreaterEqual(server.duel_streak(db, sa), 3)

    def test_themed_tournament_and_season_and_admin(self):
        db = server.APP.db
        db.x("DELETE FROM tournaments")
        db.x("DELETE FROM tour_players")
        db.x("DELETE FROM tour_matches")
        toks = [self.login(f"Спринтов {n}") for n in ("Антон", "Борис", "Виктор", "Глеб")]
        sids = [self.req("GET", "/api/me", token=t)[1]["sid"] for t in toks]
        lobs = self.req("GET", "/api/tour", token=toks[0])[1]["lobbies"]
        sprint = next(l for l in lobs if l["theme"] == "sprint")
        self.assertEqual((sprint["fixed_nums"], sprint["cap_min"]), ([1, 2, 3, 4, 5], 15))
        self.assertEqual(self.req("POST", "/api/tour/join", {"id": sprint["id"]}, toks[0])[0], 200)
        self.assertEqual(self.req("POST", "/api/tour/vote", {"id": sprint["id"], "nums": [7]}, toks[0])[0], 409)   # номера заданы
        for t in toks[1:]:
            self.req("POST", "/api/tour/join", {"id": sprint["id"]}, t)
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual((T["theme"], T["cap_min"], T["nums"]), ("sprint", 15, [1, 2, 3, 4, 5]))
        m = next(x for x in T["groups"][0]["matches"] if x["mine"])
        st, r = self.req("POST", "/api/tour/start", {"match": m["id"]}, toks[0])
        self.assertEqual(r["cap"], 900)
        # учитель: победа одному, переигровка, перезапуск
        self.assertEqual(self.admin("POST", "/api/admin/tour/match", {"id": m["id"], "action": "replay"})[0], 200)
        row = db.q("SELECT * FROM tour_matches WHERE id=?", (m["id"],), one=True)
        self.assertEqual((row["status"], row["a_start"], row["admin"]), ("play", None, "переигровка"))
        self.assertEqual(self.admin("POST", "/api/admin/tour/match", {"id": m["id"], "action": "a"})[0], 200)
        row = db.q("SELECT * FROM tour_matches WHERE id=?", (m["id"],), one=True)
        self.assertEqual((row["status"], row["winner"]), ("done", row["a"]))
        st, r = self.admin("POST", "/api/admin/tour/restart", {"id": T["id"]})
        self.assertEqual(st, 200, r)
        T2 = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual((T2["id"], T2["status"], T2["theme"]), (r["id"], "run", "sprint"))
        self.assertEqual(db.q("SELECT status FROM tournaments WHERE id=?", (T["id"],), one=True)["status"], "void")
        # сезон: места в завершённых турнирах этого месяца дают очки; прошлый месяц — значки тройке
        self.tour_expire(T2["id"])
        for _ in range(3):
            self.req("GET", "/api/tour", token=toks[0])
            self.tour_expire(T2["id"])
        d = self.req("GET", "/api/tour", token=toks[0])[1]
        self.assertEqual(d["mine"]["status"], "done")
        self.assertEqual(len(d["season"]["top"]), 4)
        self.assertEqual(d["season"]["top"][0]["pts"], 6)
        tid = server.main_teacher()["id"]
        first = datetime.datetime.fromtimestamp(server.season_bounds(server.season_key())[0])
        prev = (first - datetime.timedelta(days=1)).strftime("%Y-%m")
        db.x("DELETE FROM settings WHERE key=?", (f"season:{tid}:{prev}",))
        old = server.season_bounds(prev)[0] + 3600
        db.x("UPDATE tournaments SET finished=? WHERE id=?", (old, T2["id"]))
        self.req("GET", "/api/tour", token=toks[0])
        self.assertEqual(db.q("SELECT COUNT(*) c FROM awards WHERE kind LIKE 'season%' AND week=?", (prev,), one=True)["c"], 3)

    def test_surrender_duel_and_match(self):
        db = server.APP.db
        db.x("DELETE FROM duel_queue")
        ta, tb = self.login("Сдавалов Антон"), self.login("Сдавалов Борис")
        sa, sb = (self.req("GET", "/api/me", token=t)[1]["sid"] for t in (ta, tb))
        self.req("POST", "/api/duel/find", {}, tb)
        did = self.req("POST", "/api/duel/find", {}, ta)[1]["matched"]
        self.req("POST", "/api/duel/start", {"id": did}, ta)
        self.assertEqual(self.req("POST", "/api/duel/surrender", {"id": did}, ta)[0], 200)   # Антон сдался — сразу итог
        x = next(d for d in self.req("GET", "/api/duels", token=tb)[1]["duels"] if d["id"] == did)
        self.assertEqual((x["status"], x["result"], x["surrender"], x["stake"]), ("finished", "win", "op", 0))   # сдался — опыт победителю, только если он что-то решил
        # полная награда — за первые 3 победы в сутки, дальше — меньше
        db = server.APP.db
        for _ in range(3):
            db.x("INSERT INTO duels(a, b, tasks, created, status, winner, stake, finished) VALUES(?,?,?,?, 'finished', ?, 100, ?)",
                 (sa, sb, "[]", time.time(), sa, time.time()))
        now = time.time()
        task = next(t["id"] for t in BANK["tasks"] if t.get("ans") and not t.get("parts"))
        did2 = db.x("""INSERT INTO duels(a, b, tasks, created, status, accepted, a_start, b_start, a_done, b_done)
                       VALUES(?,?,?,?, 'active', ?, ?, ?, ?, ?)""", (sa, sb, json.dumps([task]), now, now, now - 50, now - 50, now + 5, now + 5))
        db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)", (sa, now, task, 5, "[]", "1", 1.0))
        server.duel_settle(db, db.q("SELECT * FROM duels WHERE id=?", (did2,), one=True))
        r = db.q("SELECT winner, stake FROM duels WHERE id=?", (did2,), one=True)
        self.assertEqual((r["winner"], r["stake"]), (sa, server.DUEL_STAKE_LATE))
        self.assertEqual(self.req("POST", "/api/duel/surrender", {"id": did}, tb)[0], 409)   # уже закончена
        # турнир: сдался в матче группы — сопернику победа (3 очка), не техническое поражение
        db.x("DELETE FROM tournaments"); db.x("DELETE FROM tour_players"); db.x("DELETE FROM tour_matches")
        toks = [ta, tb, self.login("Сдавалов Виктор"), self.login("Сдавалов Глеб")]
        quick = {l["size"]: l["id"] for l in self.req("GET", "/api/tour", token=ta)[1]["lobbies"] if not l["theme"]}[4]
        for t in toks:
            self.req("POST", "/api/tour/join", {"id": quick}, t)
        T = self.req("GET", "/api/tour", token=ta)[1]["mine"]
        m = next(x for x in T["groups"][0]["matches"] if x["mine"])
        self.assertEqual(self.req("POST", "/api/tour/surrender", {"match": m["id"]}, ta)[0], 200)
        row = db.q("SELECT * FROM tour_matches WHERE id=?", (m["id"],), one=True)
        op = row["b"] if row["a"] == sa else row["a"]
        self.assertEqual((row["status"], row["winner"], row["tech"], row["surrender"]), ("done", op, 0, sa))
        self.assertEqual(self.req("POST", "/api/tour/surrender", {"match": m["id"]}, ta)[0], 409)

    def test_xls_to_txt_builtin(self):
        # старый .xls (КомпЕГЭ, №9) → 9.txt без сторонних библиотек: числа как в Excel, текст — как есть
        import base64, gzip
        data = gzip.decompress(base64.b64decode("H4sIAHDo0WoC/+1YTWgTQRT+ZjL5pU03NRWbQggBo9YeLF6K0KwtaE6W6kVRQVObg7SkErzoxdqaoyB4UrwUevFS9eIP/qA3D0JFD4IgJHoUBEHBQ5v1zcuuTX8ODWhQmW+Zb96+mTfzknnzdmdfL8Yqc/cSVaxBFj7UnDACDTpBJezdWKB2x9GiV4eoOAb/FMIhWsiAH4/bXwX1Gur1rkLirnpBDHykchLnMDJVLKRaiGH2IS+0D4PEArdIE0U3e9XJfIZ5C/Md7vmEeT9rrjIPUt+KOI5Fe6R3wI3iYzLNbVHocR+wzXvW9KMLL3UUX7om6n39GCqdzU/+nQ1J1YZ50LrlCsVCKT9ZQZwWcB7fnRTwzdupz1NG31q9AOl/rNYHN9BflwqYhnOaA7xMofrMp1v8okcNqCE1rPqxRIsv3OTrh0irrMqpfWqPiuhszLvXWrV72zmq24jH0cFyjGPbovy8dPvrm0Njo/Yp1kxzxq4PvV27AgeXtQUZR7nF94t72WI38wyP2sNygjlOrlGdGe1yhYOz3OcKt2Zonr2Mt/aOBnknyeXPhx8my5/sXSQv5KoX4wvv7Dmk6TkzTvb6mkWf6BM3b2g8sr1auDngA3P3unwQkpbru+M+vDrwlGw0Yogyf6H8J7AM/U9KuodrJ9bZbWNdDCek5gjLM4kAWen+coP+kvskmdPMGZ4lKztxXzdSllpBBAYGBgYGBgYGBgatgOC30vo7vuIjRv0UEXS/6yxTqZnPJP8tjmCKrvN0MD2AItUlXGgqfrbSYdUbS2zSxvteqHGUZi9hAmPsx0TT8UunQNH4ezZtaP2+LdTs/LVm/PzD8/8EouSJWQAWAAA="))
        self.assertEqual(server._xls_rows_builtin(data), [["3", "-5", "Точка"], ["1.5", "2", "100000"], ["7", "8", "9"]])
        self.assertEqual(server.table_to_text(data, ".xls"), "3\t-5\tТочка\n1.5\t2\t100000\n7\t8\t9\n".encode())

    def tour_play(self, tok, mid, solve):
        tasks = self.req("POST", "/api/tour/start", {"match": mid}, tok)[1]["tasks"]
        for pid in tasks[:solve]:
            real = server.APP.bank.real(pid)
            self.req("POST", "/api/open", {"task": pid}, tok)
            self.check(tok, pid, answer=next(t for t in BANK["tasks"] if t["id"] == real)["ans"])
        self.req("POST", "/api/tour/finish", {"match": mid}, tok)

    def tour_expire(self, tour_id):
        server.APP.db.x("UPDATE tour_matches SET ends=? WHERE tour_id=? AND status='play'", (time.time() - 1, tour_id))

    def test_tournament_groups_playoff_prizes(self):
        server.APP.db.x("DELETE FROM tournaments")
        server.APP.db.x("DELETE FROM tour_players")
        server.APP.db.x("DELETE FROM tour_matches")
        toks = [self.login(f"Турниров {n}") for n in ("Антон", "Борис", "Виктор", "Глеб", "Денис")]
        sids = [self.req("GET", "/api/me", token=t)[1]["sid"] for t in toks]
        st, d = self.req("GET", "/api/tour", token=toks[0])
        self.assertEqual(st, 200)                                                      # без кода
        lob = {l["size"]: l for l in d["lobbies"] if not l["theme"]}
        self.assertEqual(sorted(lob), [4, 8, 12])
        quick, big = lob[4]["id"], lob[8]["id"]
        server.APP.db.x("INSERT INTO attempts(student_id,ts,task_id,n,answers,correct,score) VALUES(?,?,?,?,?,?,?)",
                        (sids[0], time.time() - 100, "tr:old", 5, "[]", "1", 1.0))
        self.assertEqual(self.req("POST", "/api/tour/join", {"id": quick}, toks[0])[1]["started"], False)
        self.assertEqual(self.req("POST", "/api/tour/join", {"id": big}, toks[0])[0], 409)   # один турнир за раз
        self.req("POST", "/api/tour/leave", {"id": quick}, toks[0])
        self.assertEqual(self.req("POST", "/api/tour/join", {"id": big}, toks[0])[0], 200)
        self.req("POST", "/api/tour/leave", {"id": big}, toks[0])
        for t in toks[:3]:
            self.req("POST", "/api/tour/join", {"id": quick}, t)
        # голосование за номера: только записавшиеся, не больше трёх номеров
        self.assertEqual(self.req("POST", "/api/tour/vote", {"id": quick, "nums": [5]}, toks[4])[0], 403)
        self.assertEqual(self.req("POST", "/api/tour/vote", {"id": quick, "nums": [1, 2, 3, 4]}, toks[0])[0], 400)
        for t in toks[:3]:
            self.assertEqual(self.req("POST", "/api/tour/vote", {"id": quick, "nums": [5, 6]}, t)[0], 200)
        lob4 = {l["size"]: l for l in self.req("GET", "/api/tour", token=toks[0])[1]["lobbies"] if not l["theme"]}[4]
        self.assertEqual((lob4["votes"], lob4["my_votes"]), ({"5": 3, "6": 3}, [5, 6]))
        st, d = self.req("POST", "/api/tour/join", {"id": quick}, toks[3])
        self.assertEqual((st, d["started"]), (200, True))                               # набрались — турнир пошёл
        d = self.req("GET", "/api/tour", token=toks[0])[1]
        lob = {l["size"]: l for l in d["lobbies"] if not l["theme"]}
        self.assertNotEqual(lob[4]["id"], quick)                                        # сразу открыт следующий набор
        self.assertEqual((lob[4]["today"], lob[4]["per_day"]), (1, 3))
        T = d["mine"]
        self.assertEqual((T["status"], T["stage"], len(T["groups"]), len(T["groups"][0]["matches"])), ("run", "Групповой этап", 1, 6))
        self.assertTrue({5, 6} <= set(T["nums"]))                                        # выигравшие голосование номера
        self.assertEqual(T["ranks"], [2, 5])                                             # группы проще, финал — сложнее
        row = server.APP.db.q("SELECT * FROM tournaments WHERE id=?", (T["id"],), one=True)
        stage = server.tour_stage_sec(row, T["nums"], group=True)                       # все играют одновременно:
        self.assertEqual(stage, sum(server.DUEL_TASK_SEC[n] for n in T["nums"]) * 3 + 600)   # три матча подряд + 10 минут
        self.assertAlmostEqual(T["round_ends"] - T["started"], stage, delta=2)
        mine = [m for m in T["groups"][0]["matches"] if m["mine"]]
        self.assertEqual(len(mine), 3)
        # Антон решает по 2 в каждом матче группы — он первый; второй матч, пока первый не закончен, начать нельзя
        self.req("POST", "/api/tour/start", {"match": mine[0]["id"]}, toks[0])
        self.assertEqual(self.req("POST", "/api/tour/start", {"match": mine[1]["id"]}, toks[0])[0], 409)
        self.req("POST", "/api/tour/finish", {"match": mine[0]["id"]}, toks[0])
        for m in mine[1:]:
            self.tour_play(toks[0], m["id"], 2)
        # Борис решает по 1 в каждом из своих матчей (кроме матча с Антоном) — второй
        tb = {s: t for s, t in zip(sids, toks)}
        for m in T["groups"][0]["matches"]:
            if sids[1] in (m["a"]["sid"], m["b"]["sid"]) and sids[0] not in (m["a"]["sid"], m["b"]["sid"]):
                self.tour_play(toks[1], m["id"], 1)
        self.tour_expire(T["id"])
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        rows = T["groups"][0]["rows"]
        self.assertEqual([r["sid"] for r in rows[:2]], [sids[0], sids[1]])
        self.assertEqual((rows[0]["pts"], rows[0]["w"], rows[1]["pts"]), (9, 3, 6))      # не пришёл на матч — техническое поражение
        self.assertEqual(T["stage"], "Финал")
        final = T["playoff"][0]["matches"][0]
        self.assertEqual({final["a"]["sid"], final["b"]["sid"]}, {sids[0], sids[1]})
        third = T["third"]
        self.assertEqual({third["a"]["sid"], third["b"]["sid"]}, {sids[2], sids[3]})
        self.tour_play(toks[1], final["id"], 2)
        self.tour_play(toks[0], final["id"], 0)
        self.tour_play(toks[3], third["id"], 1)
        self.tour_expire(T["id"])
        d = self.req("GET", "/api/tour", token=toks[1])[1]
        T = d["mine"]
        self.assertEqual((T["status"], d["busy"], d["wins"]), ("done", False, 1))
        self.assertEqual([(p["sid"], p["place"], p["xp"]) for p in T["podium"]],
                         [(sids[1], 1, 200), (sids[0], 2, 100), (sids[3], 3, 67), (sids[2], 4, 0)])
        self.assertTrue(server.APP.db.q("SELECT 1 FROM awards WHERE student_id=? AND kind='tour1'", (sids[1],), one=True))
        self.assertEqual(self.req("POST", "/api/tour/join", {"id": big}, toks[1])[0], 200)    # доиграл — можно в новый
        # у учителя — архив: турнир с местами и матчами
        st, c = self.admin("GET", "/api/admin/competitions")
        self.assertEqual(st, 200, c)
        ct = next(x for x in c["tournaments"] if x["id"] == T["id"])
        self.assertEqual((ct["status"], ct["players"][0]["place"], ct["players"][0]["name"]), ("done", 1, "Турниров Борис"))
        self.assertEqual(len(ct["matches"]), 8)                                        # 6 в группе + финал + за 3-е

    def test_tournament_noshow_and_daily_limit(self):
        # не начал ни одного матча за 3 минуты после старта — сдался: его матчи группы проиграны
        db = server.APP.db
        db.x("DELETE FROM tournaments")
        db.x("DELETE FROM tour_players")
        db.x("DELETE FROM tour_matches")
        toks = [self.login(f"Неявкин {n}") for n in ("Антон", "Борис", "Виктор", "Глеб")]
        sids = [self.req("GET", "/api/me", token=t)[1]["sid"] for t in toks]
        quick = {l["size"]: l["id"] for l in self.req("GET", "/api/tour", token=toks[0])[1]["lobbies"] if not l["theme"]}[4]
        for t in toks:
            self.req("POST", "/api/tour/join", {"id": quick}, t)
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        mine = [m for m in T["groups"][0]["matches"] if m["mine"]]
        self.req("POST", "/api/tour/start", {"match": mine[0]["id"]}, toks[0])          # Антон на месте, остальные — нет
        db.x("UPDATE tournaments SET started=? WHERE id=?", (time.time() - 200, T["id"]))
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual(sorted(T["gone"]), sorted(sids[1:]))
        ms = {m["id"]: m for m in T["groups"][0]["matches"]}
        self.assertEqual(ms[mine[0]["id"]]["status"], "play")                           # пришедший доигрывает спокойно
        self.assertTrue(all(m["status"] == "done" for m in ms.values() if m["id"] not in {x["id"] for x in mine}))
        self.assertEqual(self.req("POST", "/api/tour/start", {"match": mine[1]["id"]}, toks[0])[0], 409)   # сначала закончи начатый
        assert T["match_min"] > 0                                                       # время на матч — по заданиям
        db.x("UPDATE tour_matches SET a_start=a_start-36000 WHERE id=? AND a_start IS NOT NULL", (mine[0]["id"],))
        db.x("UPDATE tour_matches SET b_start=b_start-36000 WHERE id=? AND b_start IS NOT NULL", (mine[0]["id"],))
        self.assertEqual(self.req("POST", "/api/tour/start", {"match": mine[1]["id"]}, toks[0])[0], 200)   # время вышло — можно дальше
        late = db.q("SELECT id, a FROM tour_matches WHERE tour_id=? AND status='play' AND a!=? AND b=?",
                    (T["id"], sids[0], sids[0]), one=True) or db.q(
                    "SELECT id, b AS a FROM tour_matches WHERE tour_id=? AND status='play' AND a=? AND b!=?",
                    (T["id"], sids[0], sids[0]), one=True)
        self.assertEqual(self.req("POST", "/api/tour/start", {"match": late["id"]}, toks[sids.index(late["a"])])[0], 409)   # опоздавший не играет
        self.req("POST", "/api/tour/finish", {"match": mine[0]["id"]}, toks[0])
        for m in mine[1:]:
            self.req("POST", "/api/tour/start", {"match": m["id"]}, toks[0])
            self.req("POST", "/api/tour/finish", {"match": m["id"]}, toks[0])
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        rows = {r["sid"]: r for r in T["groups"][0]["rows"]}
        self.assertEqual((rows[sids[0]]["w"], rows[sids[0]]["pts"]), (3, 9))           # все три матча — победы
        self.assertTrue(all(rows[x]["pts"] == 0 for x in sids[1:]))
        self.assertEqual(T["stage"], "Финал")
        fin = T["playoff"][0]["matches"][0]
        loser_tok = toks[sids.index(fin["b"]["sid"] if fin["a"]["sid"] == sids[0] else fin["a"]["sid"])]
        self.assertEqual(self.req("POST", "/api/tour/start", {"match": fin["id"]}, loser_tok)[0], 200)   # в плей-офф — снова можно
        # не больше трёх турниров каждого вида в сутки
        for _ in range(2):
            db.x("INSERT INTO tournaments(teacher_id, size, title, status, created, started, fmt) VALUES(?,?,?,?,?,?,2)",
                 (server.main_teacher()["id"], 4, "x", "done", time.time(), time.time()))
        db.x("DELETE FROM tournaments WHERE size=4 AND status='reg'")
        lob = {l["size"]: l for l in self.req("GET", "/api/tour", token=toks[0])[1]["lobbies"] if not l["theme"]}[4]
        self.assertIsNone(lob["id"])
        # дуэлей — не больше 10 в сутки
        for _ in range(10):
            db.x("INSERT INTO duels(a, b, tasks, created, status) VALUES(?,?,?,?, 'finished')", (sids[2], sids[3], "[]", time.time()))
        self.assertEqual(self.req("POST", "/api/duel/find", {}, toks[2])[0], 429)
        self.assertEqual(self.req("GET", "/api/duels", token=toks[2])[1]["today"], 10)

    def test_tournament_12_groups_thirds_bracket(self):
        server.APP.db.x("DELETE FROM tournaments")
        server.APP.db.x("DELETE FROM tour_players")
        server.APP.db.x("DELETE FROM tour_matches")
        toks = [self.login(f"Чемпионов {chr(0x410 + i)}") for i in range(12)]
        tid = self.req("GET", "/api/tour", token=toks[0])[1]
        cid = {l["size"]: l["id"] for l in tid["lobbies"] if not l["theme"]}[12]
        for t in toks:
            self.req("POST", "/api/tour/join", {"id": cid}, t)
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual([len(g["rows"]) for g in T["groups"]], [4, 4, 4])
        self.assertEqual(T["ranks"], [2, 3, 4, 5])                                      # от групп к финалу сложнее
        self.assertEqual(sum(len(g["matches"]) for g in T["groups"]), 18)
        seeds = {p["sid"]: p for p in T["players"]}
        for g in T["groups"]:                       # корзины: в каждой группе по одному из каждой четвёрки сеяных
            self.assertEqual(sorted((seeds[r["sid"]]["seed"] - 1) // 3 for r in g["rows"]), [0, 1, 2, 3])
        self.tour_expire(T["id"])                    # никто не сыграл — всем поражения, решает посев
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        qf = T["playoff"][0]
        self.assertEqual((qf["name"], len(qf["matches"]), T["stage"]), ("Четвертьфинал", 4, "Четвертьфинал"))
        grp = {p["sid"]: p["grp"] for p in T["players"]}
        for m in qf["matches"]:
            self.assertNotEqual(grp[m["a"]["sid"]], grp[m["b"]["sid"]])               # в 1/4 — из разных групп
        self.tour_expire(T["id"])
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual((T["playoff"][1]["name"], len(T["playoff"][1]["matches"])), ("Полуфинал", 2))
        self.tour_expire(T["id"])
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual(T["stage"], "Финал")
        self.assertTrue(T["third"])
        self.tour_expire(T["id"])
        T = self.req("GET", "/api/tour", token=toks[0])[1]["mine"]
        self.assertEqual(T["status"], "done")
        self.assertEqual([p["place"] for p in T["podium"]], [1, 2, 3, 4])
        self.assertEqual(T["podium"][0]["xp"], 600)

    def test_support_ticket_flow(self):
        tok = self.login("Поддержкин Павел")
        self.assertEqual(self.req("POST", "/api/support", {"text": "ой"}, tok)[0], 400)            # слишком коротко
        st, d = self.req("POST", "/api/support", {"kind": "task", "text": "В задании неверный ответ", "task": "kp:1"}, tok)
        self.assertEqual(st, 200, d)
        st, d = self.admin("GET", "/api/admin/site-stats")
        x = next(r for r in d["support"] if r["text"] == "В задании неверный ответ")
        self.assertEqual((x["status"], x["kind"], x["task"], x["name"]), ("new", "task", "kp:1", "Поддержкин Павел"))
        self.admin("POST", "/api/admin/support/answer", {"id": x["id"], "answer": "Исправили, спасибо!"})
        d = self.req("GET", "/api/support", token=tok)[1]
        self.assertEqual((d["unread"], d["items"][0]["answer"], d["items"][0]["status"]), (1, "Исправили, спасибо!", "answered"))
        self.req("POST", "/api/support/seen", {}, tok)
        self.assertEqual(self.req("GET", "/api/support", token=tok)[1]["unread"], 0)
        self.admin("POST", "/api/admin/support/answer", {"id": x["id"], "close": True})
        self.assertEqual(self.req("GET", "/api/support", token=tok)[1]["items"][0]["status"], "closed")
        for i in range(4):
            self.req("POST", "/api/support", {"text": f"ещё обращение {i}"}, tok)
        self.assertEqual(self.req("POST", "/api/support", {"text": "шестое за час"}, tok)[0], 429)
        self.assertEqual(self.req("GET", "/api/support")[0], 401)
        # удаляет только главный учитель — обращение стирается из базы, ученик его тоже больше не видит
        mine = self.req("GET", "/api/support", token=tok)[1]["items"]
        self.assertEqual(self.req("POST", "/api/support/delete", {"id": mine[0]["id"]}, tok)[0], 404)   # ученику — нельзя
        self.admin("POST", "/api/admin/support/delete", {"id": mine[0]["id"]})
        self.assertEqual(len(self.req("GET", "/api/support", token=tok)[1]["items"]), len(mine) - 1)
        self.assertIsNone(server.APP.db.q("SELECT 1 FROM support WHERE id=?", (mine[0]["id"],), one=True))
        self.assertEqual(self.admin("POST", "/api/admin/support/delete", {"closed": True})[1]["deleted"], 1)   # закрытое ранее

    def test_support_dialog_and_close(self):
        # переписка в теме: ученик отвечает, учитель отвечает ещё раз; закрытая тема — писать нельзя, можно открыть снова
        tok = self.login("Диалогов Денис")
        self.req("POST", "/api/support", {"kind": "bug", "text": "Не грузится задание"}, tok)
        sid = server.APP.db.q("SELECT id FROM support ORDER BY id DESC LIMIT 1", one=True)["id"]
        self.admin("POST", "/api/admin/support/answer", {"id": sid, "answer": "Какое именно?"})
        self.assertEqual(self.req("POST", "/api/support/reply", {"id": sid, "text": "№7 из подборки"}, tok)[0], 200)
        x = next(r for r in self.admin("GET", "/api/admin/site-stats")[1]["support"] if r["id"] == sid)
        self.assertEqual(x["status"], "new")                                  # ученик ответил — снова ждёт учителя
        self.assertEqual([m["who"] for m in x["thread"]], ["student", "teacher", "student"])
        self.admin("POST", "/api/admin/support/answer", {"id": sid, "answer": "Починили", "close": True})
        item = self.req("GET", "/api/support", token=tok)[1]["items"][0]
        self.assertEqual((item["status"], [m["text"] for m in item["thread"]]),
                         ("closed", ["Не грузится задание", "Какое именно?", "№7 из подборки", "Починили"]))
        self.assertEqual(self.req("POST", "/api/support/reply", {"id": sid, "text": "спасибо"}, tok)[0], 409)
        other = self.login("Чужаков Чарли")
        self.assertEqual(self.req("POST", "/api/support/reply", {"id": sid, "text": "я не автор"}, other)[0], 404)
        self.admin("POST", "/api/admin/support/answer", {"id": sid, "reopen": True})
        self.assertEqual(self.req("GET", "/api/support", token=tok)[1]["items"][0]["status"], "answered")
        self.assertEqual(self.req("POST", "/api/support/reply", {"id": sid, "text": "спасибо"}, tok)[0], 200)
        self.admin("POST", "/api/admin/support/delete", {"id": sid})
        self.assertIsNone(server.APP.db.q("SELECT 1 FROM support_msgs WHERE support_id=?", (sid,), one=True))

    def test_support_images(self):
        # картинка в обращении: только настоящая картинка, видна автору и главному учителю, удаляется вместе с обращением
        import base64
        jpg = b"\xff\xd8\xff\xe0" + b"0" * 100
        url = "data:image/jpeg;base64," + base64.b64encode(jpg).decode()
        tok, other = self.login("Скриншотов Семён"), self.login("Подсмотров Пётр")
        bad = "data:image/png;base64," + base64.b64encode(b"<script>alert(1)</script>").decode()
        self.assertEqual(self.req("POST", "/api/support", {"kind": "bug", "text": "Белый экран", "img": bad}, tok)[0], 400)
        big = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff" + b"0" * 1_600_000).decode()
        self.assertEqual(self.req("POST", "/api/support", {"kind": "bug", "text": "Белый экран", "img": big}, tok)[0], 400)
        self.assertEqual(self.req("POST", "/api/support", {"kind": "bug", "text": "Белый экран", "img": url}, tok)[0], 200)
        item = self.req("GET", "/api/support", token=tok)[1]["items"][0]
        name = item["thread"][0]["img"]
        self.assertRegex(name, r"^[0-9a-f]{32}\.jpg$")
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/api/support/img?f=" + name, headers={"X-Token": tok})
        r = c.getresponse()
        self.assertEqual((r.status, r.getheader("Content-Type"), r.read()), (200, "image/jpeg", jpg))
        c.close()
        self.assertEqual(self.req("GET", "/api/support/img?f=" + name, token=other)[0], 404)       # чужую — нельзя
        self.assertEqual(self.req("GET", "/api/support/img?f=../trainer.db", token=tok)[0], 404)
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request("GET", "/api/admin/support/img?f=" + name, headers={"Cookie": "egeadm=admtest"})
        r = c.getresponse()
        self.assertEqual((r.status, r.read()), (200, jpg))                                       # главному учителю — можно
        c.close()
        # ответ учителя с картинкой и ответ ученика картинкой без текста
        self.admin("POST", "/api/admin/support/answer", {"id": item["id"], "img": url})
        self.assertEqual(self.req("POST", "/api/support/reply", {"id": item["id"], "text": "", "img": url}, tok)[0], 200)
        thread = self.req("GET", "/api/support", token=tok)[1]["items"][0]["thread"]
        self.assertEqual([bool(m["img"]) for m in thread], [True, True, True])
        self.assertTrue(all((server.DB_PATH.parent / "support_img" / m["img"]).is_file() for m in thread))
        self.admin("POST", "/api/admin/support/delete", {"id": item["id"]})
        self.assertFalse(any((server.DB_PATH.parent / "support_img" / m["img"]).exists() for m in thread))

    def test_change_kind_of_personal_batch(self):
        # персональная подборка: тип меняется сразу у всех учеников пачки
        t1, t2 = self.login("Пачкин Пётр"), self.login("Пачкина Полина")
        ids = [self.req("GET", "/api/me", token=t)[1]["sid"] for t in (t1, t2)]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "10П"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": ids})
        self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Лично", "kind": "self", "tasks": ["b:5"], "students": ids})
        b = self.admin("GET", f"/api/admin/assignments?class_id={cid}")[1]["batches"][0]
        self.assertEqual((b["kind"], b["students"]), ("self", 2))
        aid = server.APP.db.q("SELECT id FROM assignments WHERE student_id=? AND class_id=?", (ids[0], cid), one=True)["id"]
        self.req("POST", "/api/asg/start", {"id": aid}, t1)
        st, d = self.admin("POST", "/api/admin/batch/kind", {"class_id": cid, "batch": b["batch"], "kind": "home"})
        self.assertEqual((st, d["changed"], d["ended"]), (200, 2, 1))
        kinds = {r["kind"] + str(r["strict"]) for r in server.APP.db.q("SELECT kind, strict FROM assignments WHERE class_id=?", (cid,))}
        self.assertEqual(kinds, {"home0"})
        self.assertEqual(self.admin("POST", "/api/admin/batch/kind", {"class_id": cid, "batch": b["batch"], "kind": "zzz"})[0], 400)

    def test_change_kind_of_started_work(self):
        # самостоятельную уже пишут — тип всё равно можно сменить: начатые сдаются по уже данным ответам
        tok = self.login("Типов Тимур")
        me = self.req("GET", "/api/me", token=tok)[1]["sid"]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "10Т"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me]})
        aid = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "СР-тип", "kind": "self", "tasks": ["b:5", "b:6"]})[1]["id"]
        self.req("POST", "/api/asg/start", {"id": aid}, tok)
        self.req("POST", "/api/asg/answer", {"id": aid, "task": server.APP.bank.pid("b:5"), "answer": "12"}, tok)
        st, d = self.admin("POST", "/api/admin/assignment/save", {"id": aid, "class_id": cid, "title": "СР-тип", "kind": "practice", "tasks": ["b:5", "b:6"]})
        self.assertEqual((st, d.get("ended")), (200, 1), d)
        row = server.APP.db.q("SELECT kind, strict FROM assignments WHERE id=?", (aid,), one=True)
        self.assertEqual((row["kind"], row["strict"]), ("practice", 0))
        run = server.APP.db.q("SELECT finished, forced FROM asg_runs WHERE asg_id=? AND student_id=?", (aid, me), one=True)
        self.assertTrue(run["finished"] and run["forced"])
        # состав заданий у начатой самостоятельной менять по-прежнему нельзя
        aid2 = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "СР-2", "kind": "self", "tasks": ["b:5"]})[1]["id"]
        self.req("POST", "/api/asg/start", {"id": aid2}, tok)
        self.assertEqual(self.admin("POST", "/api/admin/assignment/save", {"id": aid2, "class_id": cid, "title": "СР-2", "kind": "self", "tasks": ["b:6"]})[0], 409)

    def test_common_bank_rule(self):
        ok = lambda **t: server.bank_ok(dict({"n": 5, "ans": "1"}, **t))
        self.assertTrue(ok(y=2022))
        self.assertFalse(ok(y=2019))                         # до первого компьютерного ЕГЭ
        self.assertFalse(ok(n=13, y=2023))                   # №13 в нынешнем виде — с 2024 года
        self.assertTrue(ok(n=13, y=2023, fmt="cur"))         # помечено при сборке как актуальное
        self.assertFalse(ok(fmt="old"))
        self.assertFalse(ok(ans=""))                         # без ответа — не в банке
        self.assertFalse(ok(group="g1"))                     # вопрос 19–21 — только всей игрой
        self.assertTrue(ok(n=19, ans="", parts=[{"id": "p"}]))
        self.assertFalse(server.bank_ok({"n": 19, "parts": [{"id": "p"}]}, single=True))
        for i in server.bank_pool():
            self.assertFalse(server.task_outdated(server.APP.bank.tasks[i]))

    def test_class_battle_goal(self):
        tok = self.login("Классный Карл")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "9Ц"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [sid]})
        self.assertEqual(self.req("GET", "/api/leaderboard", token=tok)[1]["boards"]["classes"]["list"], [])   # пока не участвует
        st, d = self.admin("POST", "/api/admin/class/goal", {"id": cid, "goal_tasks": 300, "goal_reward": "отменю домашку",
                                                             "battle": True})
        self.assertEqual((st, d["goal_tasks"]), (200, 300))
        self.req("POST", "/api/open", {"task": server.APP.bank.pid("b:5")}, tok)
        self.check(tok, server.APP.bank.pid("b:5"), answer="12")
        cl = next(c for c in self.req("GET", "/api/leaderboard", token=tok)[1]["boards"]["classes"]["list"] if c["mine"])
        self.assertEqual((cl["name"], cl["goal"], cl["reward"], cl["solved"]), ("9Ц", 300, "отменю домашку", 1))
        self.assertGreater(cl["xp"], 0)
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_class_stats_for_grades(self):
        tok = self.login("Оценкин Олег")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "8Ж"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [sid]})
        p5, p6 = server.APP.bank.pid("b:5"), server.APP.bank.pid("b:6")
        self.req("POST", "/api/open", {"task": p5}, tok)
        self.check(tok, p5, answer="12")                                  # верно с 1-й
        self.req("POST", "/api/open", {"task": p6}, tok)
        self.check(tok, p6, answer="1")
        self.check(tok, p6, answer="7")                                   # со 2-й
        st, a = self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Урок", "tasks": ["b:5"]})
        aid = self.admin("GET", f"/api/admin/assignments?class_id={cid}")[1]["assignments"][0]["id"]
        now = time.time()
        st, d = self.admin("GET", f"/api/admin/class/stats?class_id={cid}&from={now - 3600}&to={now + 60}")
        r = d["rows"][0]
        self.assertEqual((r["name"], r["tasks"], r["solved"], r["ok1"], r["ok2"], r["nums"]), ("Оценкин Олег", 2, 2, 1, 1, [5, 6]))
        self.assertIsNone(d["asg_total"])
        st, d = self.admin("GET", f"/api/admin/class/stats?class_id={cid}&from={now - 3600}&to={now + 60}&asg={aid}")
        self.assertEqual((d["asg_total"], d["rows"][0]["solved"], d["rows"][0]["tasks"]), (1, 1, 1))   # только задания подборки
        st, d = self.admin("GET", f"/api/admin/class/stats?class_id={cid}&from={now - 7200}&to={now - 3600}")
        self.assertEqual(d["rows"][0]["tasks"], 0)                                                   # вне периода — пусто
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

    def test_integrity_flags(self):
        # ⚠ — вернулся после долгого ухода и сразу верно; 📋 — ответ вставлен; сводка «вне тренажёра» и строгий режим варианта
        tok = self.login("Честнов Чеслав")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        p5, p6 = server.APP.bank.pid("b:5"), server.APP.bank.pid("b:6")
        self.req("POST", "/api/open", {"task": p5}, tok)
        self.check(tok, p5, answer="12", away=1, away_sec=95, back_sec=8)
        self.req("POST", "/api/open", {"task": p6}, tok)
        self.check(tok, p6, answer="1", paste=1)
        self.check(tok, p6, answer="2", back_sec=5)                # неверный ответ не бывает «подозрительным»
        self.req("POST", "/api/activity", {"events": [{"kind": "away", "dur": 95, "task": p5},
                                                      {"kind": "fs", "task": p6, "exam": 1},
                                                      {"kind": "paste", "task": p6, "exam": 1}]}, tok)
        st, d = self.admin("GET", f"/api/admin/student?id={sid}&from=0")
        by = {a["task_id"]: a for a in d["attempts"]}
        self.assertEqual((by["b:5"]["flags"], by["b:5"]["away_sec"]), ("sus", 95))
        self.assertEqual(by["b:6"]["flags"], "paste")
        self.assertEqual({e["kind"] for e in d["away_log"]}, {"away", "fs", "paste"})
        self.assertEqual(next(e for e in d["away_log"] if e["kind"] == "away")["n"], 5)
        # без долгого ухода и без вставки — без отметок
        tok2 = self.login("Чистов Чеслав")
        self.req("POST", "/api/open", {"task": p5}, tok2)
        self.check(tok2, p5, answer="12", back_sec=None)
        sid2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        self.assertIsNone(self.admin("GET", f"/api/admin/student?id={sid2}&from=0")[1]["attempts"][0]["flags"])
        # статистика класса: отметки и время вне тренажёра
        cid = self.admin("POST", "/api/admin/class/save", {"name": "Честный класс"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [sid]})
        now = time.time()
        st, d = self.admin("GET", f"/api/admin/class/stats?class_id={cid}&from={now - 3600}&to={now + 60}")
        r = d["rows"][0]
        self.assertEqual((r["sus"], r["paste"], r["out_n"], r["out_sec"]), (1, 1, 1, 95))
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

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
        st, d = self.req("POST", "/api/login", {"mode": "register", "consent": True, "code": "MARIA1", "name": "Машин Михаил",
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
        self.assertNotIn(her, ids)                                           # главный тоже видит только своих…
        self.assertIn(mine, ids)
        self.assertEqual(self.admin("GET", f"/api/admin/student?id={her}")[0], 404)
        st, d = self.admin("GET", "/api/admin/site-stats")                   # …а по всему сайту — только цифры
        self.assertEqual(st, 200, d)
        self.assertEqual(next(t for t in d["by_teacher"] if t["name"] == "Мария Ивановна")["students"], 1)
        self.assertEqual(self.teacher_req(cookie, "GET", "/api/admin/site-stats")[0], 403)
        # свои классы: чужой класс учитель не видит
        st, d, _ = self.teacher_req(cookie, "POST", "/api/admin/class/save", {"name": "9В"})
        her_class = d["id"]
        st, d = self.admin("POST", "/api/admin/class/save", {"name": "11Г"})
        main_class = d["id"]
        st, d, _ = self.teacher_req(cookie, "GET", "/api/admin/classes")
        self.assertEqual([c["id"] for c in d["classes"]], [her_class])
        self.assertEqual(self.teacher_req(cookie, "POST", "/api/admin/class/members",
                                          {"class_id": main_class, "students": [her]})[0], 404)
        # и главный учитель не видит классы других учителей
        st, d = self.admin("GET", "/api/admin/classes")
        self.assertNotIn(her_class, [c["id"] for c in d["classes"]])
        self.assertEqual(self.admin("GET", f"/api/admin/assignments?class_id={her_class}")[0], 404)
        # своя настройка авторских заданий — у её учеников
        self.teacher_req(cookie, "POST", "/api/admin/authored", {"on": False})
        tok = self.req("POST", "/api/login", {"mode": "login", "name": "Машин Михаил", "password": "secret1"})[1]["token"]
        self.assertFalse(self.req("GET", "/api/me", token=tok)[1]["rules"]["authored"])
        self.assertTrue(self.req("GET", "/api/me", token=self.login("Главнов Гордей"))[1]["rules"]["authored"])
        # удалили учителя — ученики и классы переходят главному, вход по её сессии больше не работает
        self.admin("POST", "/api/admin/teacher/delete", {"id": tid})
        self.assertEqual(self.teacher_req(cookie, "GET", "/api/admin/me")[0], 401)
        st, d = self.admin("GET", "/api/admin/students?class_id=all")
        self.assertEqual({x["id"]: x["teacher"] for x in d["students"]}[her], "Главный учитель")   # теперь её ученик — свой
        self.assertEqual(self.admin("POST", "/api/admin/teacher/delete", {"id": server.main_teacher()["id"]})[0], 400)
        for c in (her_class, main_class):
            self.admin("POST", "/api/admin/class/delete", {"id": c})

    def test_teacher_solves_as_student(self):
        # учитель решает тренажёр своим аккаунтом: без кода и пароля, в рейтингах и списках учеников его нет
        st, d = self.admin("POST", "/api/admin/as-student", {})
        self.assertEqual(st, 200, d)
        tok, tsid = d["token"], d["sid"]
        self.assertEqual(self.admin("POST", "/api/admin/as-student", {})[1]["sid"], tsid)   # тот же аккаунт
        me = self.req("GET", "/api/me", token=tok)[1]
        self.assertTrue(me["teacher"])
        self.assertTrue(me["course"])                                        # курс учителю открыт без пароля
        pid = server.APP.bank.pid("b:5")
        self.req("POST", "/api/open", {"task": pid}, tok)
        self.assertEqual(self.check(tok, pid, answer="12")[0], 200)
        lb = self.req("GET", "/api/leaderboard", token=tok)[1]
        self.assertTrue(lb["spectator"])
        self.assertIsNone(lb["boards"]["week"]["me"])
        stud = self.login("Рейтингов Роман")
        lb = self.req("GET", "/api/leaderboard", token=stud)[1]
        self.assertNotIn(me["name"], [r["name"] for r in lb["boards"]["week"]["top"]])
        for t in (stud, tok):
            self.req("POST", "/api/dev/unlock", {"code": "20011608"}, t)
        self.assertNotIn(tsid, [m["sid"] for m in self.req("GET", "/api/duels", token=stud)[1]["mates"]])
        self.assertEqual(self.req("GET", "/api/duels", token=tok)[1]["mates"], [])
        st, d = self.admin("GET", "/api/admin/students?class_id=all")
        self.assertNotIn(tsid, [x["id"] for x in d["students"]])
        self.assertEqual(self.admin("GET", f"/api/admin/student?id={tsid}")[0], 404)
        # по имени войти в учительский аккаунт нельзя
        self.assertNotEqual(self.req("POST", "/api/login", {"mode": "login", "name": me["name"], "password": ""})[0], 200)

    def test_site_stats_counts(self):
        self.req("GET", "/")
        tok = self.login("Статистиков Сергей")
        pid = server.APP.bank.pid("b:6")
        self.req("POST", "/api/open", {"task": pid}, tok)
        self.check(tok, pid, answer="7")
        st, d = self.admin("GET", "/api/admin/site-stats")
        self.assertGreaterEqual(d["users"], 1)
        self.assertGreaterEqual(d["solved"], 1)
        self.assertGreaterEqual(d["online"], 1)
        self.assertGreaterEqual(d["visitors_today"], 1)
        self.assertEqual(len(d["series"]), 14)
        self.assertGreaterEqual(d["series"][-1]["solved"], 1)

    def test_clusters_classify(self):
        import clusters
        T = [{"n": 5, "html": "<p>Строится двоичная запись числа N. Какое наименьшее число…</p>", "lv": "Простая"},
             {"n": 5, "html": "<p>Строится троичная запись числа N…</p>", "d": 3},
             {"n": 17, "html": "<p>Определите количество пар, затем максимальную из сумм…</p>"},
             {"n": 1, "html": "<p>Определите длину кратчайшего пути из пункта А в пункт Г.</p>"},
             {"n": 8, "html": "<p>Все слова записаны в алфавитном порядке. Под каким номером в списке…</p>"},
             {"n": 7, "html": "<p>Ничего похожего</p>"}]
        clusters.annotate(T)
        self.assertEqual([t["c"] for t in T], ["bin", "ter", "pairs", "path", "list", "misc"])
        self.assertEqual((T[0]["r"], T[1]["r"]), (2, 4))                 # «Простая» → 2, d=3 → 4
        self.assertTrue(all(1 <= t["r"] <= 5 for t in T))
        self.assertIn(["bin", "Двоичная запись"], clusters.catalog()[5])

    def test_bank_search_for_builder(self):
        st, d = self.admin("GET", "/api/admin/bank/catalog")
        self.assertEqual(st, 200, d)
        self.assertIn("5", {str(k) for k in d["clusters"]})
        st, d = self.admin("GET", "/api/admin/bank/search?n=5,6&sort=rank")
        self.assertEqual(st, 200, d)
        self.assertEqual(sorted(t["id"] for t in d["tasks"]), ["b:5", "b:6"])
        self.assertTrue(all(t["c"] and t["r"] for t in d["tasks"]))
        key = f"5:{d['tasks'][[t['n'] for t in d['tasks']].index(5)]['c']}"
        st, d = self.admin("GET", f"/api/admin/bank/search?c={key}")
        self.assertEqual([t["id"] for t in d["tasks"]], ["b:5"])
        st, d = self.admin("GET", "/api/admin/bank/search?q=" + quote("двадцать"))
        self.assertEqual([t["id"] for t in d["tasks"]], ["b:27"])
        st, d = self.admin("GET", "/api/admin/bank/search?n=19")
        self.assertEqual([t["id"] for t in d["tasks"]], ["b:g"])         # игра целиком, без частей
        st, d = self.admin("GET", "/api/admin/bank/search?r=9")
        self.assertEqual(d["total"], 0)

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

    def test_reopen_after_wrong_keeps_tries(self):
        # ушёл к другому заданию подборки или перезагрузил — попытка не сгорает, но и новых не появляется
        tok = self.login("Хитров Хитрец")
        self.req("POST", "/api/open", {"task": "b:6"}, tok)
        self.check(tok, "b:6", answer="1")
        st, d = self.req("POST", "/api/open", {"task": "b:6"}, tok)
        self.assertEqual(d["tries"], {server.APP.bank.pid("b:6"): 1})
        self.assertIsNone(server.APP.db.q("""SELECT 1 FROM attempts a JOIN students s ON s.id=a.student_id
                                             WHERE a.task_id='b:6' AND s.name='Хитров Хитрец'""", one=True))
        st, d = self.check(tok, "b:6", answer="7")            # верно со второй попытки — половина
        self.assertEqual((d["correct"], d["score"]), (True, 0.5))

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
        self.assertTrue(any(x["blank"] for x in r["results"]))
        logged = [x["n"] for x in server.APP.db.q("SELECT n FROM attempts WHERE exam=?", (e["exam_id"],))]
        self.assertEqual(sorted(logged), [5, 27])          # нетронутое №6 — не ошибка, в журнал не попало
        st, r2 = self.req("POST", "/api/exam/finish", {"exam_id": e["exam_id"], "answers": []}, tok)
        self.assertEqual(r2["primary"], 2)                # повторная отправка не пересчитывает
        for _ in range(server.EXAM_PER_DAY - 1):
            self.req("POST", "/api/exam/start", {}, tok)
        st, d = self.req("POST", "/api/exam/start", {}, tok)
        self.assertEqual(st, 429)

    def test_teacher_sees_exams(self):
        tok = self.login("Вариантова Валерия")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        since = time.time() - 1
        st, e = self.req("POST", "/api/exam/start", {}, tok)
        self.req("POST", "/api/exam/finish", {"exam_id": e["exam_id"], "answers": [
            {"task": server.APP.bank.pid("b:5"), "answer": "12"}, {"task": server.APP.bank.pid("b:6"), "answer": "1"}]}, tok)
        d = self.admin("GET", f"/api/admin/student?id={sid}")[1]
        x = d["exams"][0]
        self.assertEqual((x["id"], x["full"], x["primary_score"]), (e["exam_id"], 1, 1))
        r = self.admin("GET", f"/api/admin/exam?id={e['exam_id']}")[1]
        row = {q["task"]: q for q in r["rows"]}
        self.assertEqual((row["b:5"]["mine"], row["b:5"]["answer"], row["b:6"]["mine"], row["b:6"]["answer"]), ("12", "12", "1", "7"))
        ev = [x for x in self.admin("GET", f"/api/admin/feed?since={since}")[1]["events"] if x["kind"] == "exam"]
        self.assertEqual(ev[0]["exam"], e["exam_id"])
        cid = self.admin("POST", "/api/admin/class/save", {"name": "11Вар"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [sid]})
        j = self.admin("GET", f"/api/admin/class/journal?class_id={cid}")[1]
        self.assertEqual((j["students"][0]["exam"]["last_id"], j["students"][0]["exam"]["count"]), (e["exam_id"], 1))
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_admin_badge(self):
        tok = self.login("Malevin Dmitry")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        self.assertNotIn(sid, self.req("GET", "/api/me", token=tok)[1]["admins"])     # новым — только через панель
        self.assertEqual(self.admin("POST", "/api/admin/student/role", {"id": sid, "admin": True})[0], 200)
        self.assertIn(sid, self.req("GET", "/api/me", token=tok)[1]["admins"])
        self.assertEqual(self.admin("GET", f"/api/admin/student?id={sid}")[1]["student"]["role"], "admin")
        self.admin("POST", "/api/admin/student/role", {"id": sid, "admin": False})
        self.assertNotIn(sid, self.req("GET", "/api/me", token=tok)[1]["admins"])

    def test_exam_history(self):
        tok = self.login("Вариантов Виктор")
        st, e = self.req("POST", "/api/exam/start", {}, tok)
        self.req("POST", "/api/exam/finish", {"exam_id": e["exam_id"], "answers": [
            {"task": server.APP.bank.pid("b:5"), "answer": "12"}, {"task": server.APP.bank.pid("b:6"), "answer": "1"}]}, tok)
        lst = self.req("GET", "/api/exams", token=tok)[1]["exams"]
        self.assertEqual((len(lst), lst[0]["id"], lst[0]["primary"], lst[0]["full"]), (1, e["exam_id"], 1, 1))
        v = self.req("GET", f"/api/exam/view?id={e['exam_id']}", token=tok)[1]
        mine = {server.APP.bank.real(x["task"]): x["mine"] for x in v["results"]}
        self.assertEqual((mine["b:5"], mine["b:6"]), ("12", "1"))
        self.assertTrue(all("answer" not in x for x in v["results"]))         # меньше 20 минут — правильные скрыты
        other = self.login("Чужаков Чен")
        self.assertEqual(self.req("GET", f"/api/exam/view?id={e['exam_id']}", token=other)[0], 404)   # чужой вариант не открыть

    def test_exam_cannot_leak_foreign_or_strict_answers(self):
        tok = self.login("Взломов Вадим")
        me = self.req("GET", "/api/me", token=tok)[1]["sid"]
        cid = self.admin("POST", "/api/admin/class/save", {"name": "9Взл"})[1]["id"]
        self.admin("POST", "/api/admin/class/members", {"class_id": cid, "students": [me]})
        self.admin("POST", "/api/admin/assignment/save", {"class_id": cid, "title": "Сам", "kind": "self", "tasks": ["b:5"]})
        st, e = self.req("POST", "/api/exam/start", {}, tok)
        issued = {server.APP.bank.real(x["id"]) for x in e["items"]}
        self.assertNotIn("b:5", issued)                        # задание идущей самостоятельной в вариант не попадёт
        self.assertIn("b:6", issued)
        server.APP.db.x("UPDATE exams SET started=? WHERE id=?", (time.time() - 3600, e["exam_id"]))   # «сидел» час
        st, r = self.req("POST", "/api/exam/finish", {"exam_id": e["exam_id"], "answers": [
            {"task": server.APP.bank.pid("b:5"), "answer": "1"}, {"task": server.APP.bank.pid("b:6"), "answer": "1"}]}, tok)
        self.assertTrue(r["shown"])
        got = {server.APP.bank.real(x["task"]): x.get("answer") for x in r["results"]}
        self.assertNotIn("b:5", got)                           # подставленное задание — ни балла, ни ответа
        self.assertEqual(got["b:6"], "7")
        self.admin("POST", "/api/admin/class/delete", {"id": cid})

    def test_check_bruteforce_limited(self):
        tok = self.login("Переборов Пётр")
        pid = server.APP.bank.pid("b:6")
        codes = []
        for guess in range(1, 12):
            if guess % 2:
                self.req("POST", "/api/open", {"task": pid}, tok)
            codes.append(self.check(tok, pid, answer=str(100 + guess))[0])
        self.assertEqual(codes[:server.CHECKS_PER_TASK_DAY], [200] * server.CHECKS_PER_TASK_DAY)
        self.assertEqual(set(codes[server.CHECKS_PER_TASK_DAY:]), {429})   # перебором ответ не подобрать

    # ------------------------------------------------------------ прочее
    def test_kompege_escaped_newlines(self):
        # в КомпЕГЭ перенос строки в ответе бывает записан двумя символами «\\n»
        ans = server.clean_ans("597 432\\n408 352")
        self.assertEqual(ans, "597 432\n408 352")
        self.assertEqual(server.shape_of(ans, 27), {"type": "grid", "rows": 2, "cols": 2})
        self.assertEqual(server.answer_credit(27, ans, "597 432\n408 352", ["597", "432", "408", "352"]), 1.0)
        self.assertEqual(server.answer_credit(27, "597 432\\n408 352", "597 432 408 352"), 1.0)   # и без очистки
        self.assertEqual(server.shape_of("1 2\n3 4\n5 6", 25), {"type": "grid", "rows": 10, "cols": 2})
        self.assertEqual(server.shape_of("100\n200\n300", 25), {"type": "grid", "rows": 10, "cols": 2})   # №25 — всегда 10 × 2

    def test_legal_consent(self):
        # без галочек не зарегистрироваться; при регистрации согласие записывается
        st, d = self.req("POST", "/api/login", {"mode": "register", "code": "1234", "name": "Согласнов Семён", "new_password": "secret1"})
        self.assertEqual(st, 400)
        tok = self.login("Согласнов Семён")
        me = self.req("GET", "/api/me", token=tok)[1]
        self.assertFalse(me["consent_needed"])
        sid = me["sid"]
        st, c = self.admin("GET", f"/api/admin/student?id={sid}")
        self.assertEqual((c["student"]["consent_ver"], c["student"]["consent_ok"]), (server.LEGAL_VERSION, True))
        # уже зарегистрированный до документов — подтверждает при входе
        server.APP.db.x("UPDATE students SET consent_ver=NULL WHERE id=?", (sid,))
        self.assertTrue(self.req("GET", "/api/me", token=tok)[1]["consent_needed"])
        self.assertEqual(self.req("POST", "/api/consent", {}, tok)[0], 400)
        self.assertEqual(self.req("POST", "/api/consent", {"accept": True}, tok)[0], 200)
        self.assertFalse(self.req("GET", "/api/me", token=tok)[1]["consent_needed"])
        for page in ("terms.html", "privacy.html", "consent.html", "legal.css"):
            shutil.copy(Path(__file__).resolve().parent.parent / page, server.HERE / page)
            c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
            c.request("GET", "/" + page)
            r = c.getresponse()
            self.assertEqual(r.status, 200, page)
            r.read(); c.close()
        # учитель тоже принимает документы
        db = server.APP.db
        db.x("UPDATE teachers SET consent_ver=NULL")
        self.assertTrue(self.admin("GET", "/api/admin/me")[1]["consent_needed"])
        self.assertEqual(self.admin("POST", "/api/admin/consent", {})[0], 400)
        self.assertEqual(self.admin("POST", "/api/admin/consent", {"accept": True})[0], 200)
        self.assertFalse(self.admin("GET", "/api/admin/me")[1]["consent_needed"])
        # удаление ученика стирает все его данные
        self.req("POST", "/api/support", {"text": "удалите меня", "kind": "other"}, tok)
        db.x("INSERT INTO awards(student_id, kind, week, info) VALUES(?, 'x', 'w', 1)", (sid,))
        db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?, 1, 5, 'x')", (sid,))
        self.assertEqual(self.admin("POST", "/api/admin/student/delete", {"id": sid})[0], 200)
        for table in ("students", "support", "awards", "xp_adjust", "attempts", "leagues", "assignments"):
            col = "id" if table == "students" else "student_id"
            self.assertIsNone(db.q(f"SELECT 1 FROM {table} WHERE {col}=?", (sid,), one=True), table)

    def test_fire_freezes_and_restore(self):
        db = server.APP.db
        tok = self.login("Морозов Матвей")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        # купить нельзя без опыта; с опытом — не больше FREEZE_MAX, опыт списывается
        self.assertEqual(self.req("POST", "/api/freeze/buy", {}, tok)[0], 400)
        db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?, 'duel:1')", (sid, time.time() - 30 * 86400, 2600))
        xp0 = server.game_summary(db, sid)["xp"]
        for _ in range(server.FREEZE_MAX):
            self.assertEqual(self.req("POST", "/api/freeze/buy", {}, tok)[0], 200)
        st, d = self.req("POST", "/api/freeze/buy", {}, tok)
        self.assertEqual(st, 409)
        g = server.game_summary(db, sid)
        self.assertEqual((g["freezes"], g["xp"]), (server.FREEZE_MAX, xp0 - server.FREEZE_MAX * server.FREEZE_PRICE))
        # огонёк два дня назад и три дня назад, вчера пропуск — заморозка закрывает вчера сама
        today = datetime.datetime.now().date()
        ids = [t["id"] for t in BANK["tasks"]]
        k = 0
        for back in (3, 2):
            day = today - datetime.timedelta(days=back)
            noon = time.mktime(day.timetuple()) + 12 * 3600
            for j in range(3):
                db.x("INSERT INTO attempts(student_id, ts, task_id, n, score) VALUES(?,?,?,5,1)", (sid, noon + j, ids[k % len(ids)] + f"#{k}"))
                k += 1
        g = server.game_summary(db, sid)
        # заморозка сохраняет огонёк, но не прибавляет: было 2 — осталось 2 (а не 3)
        self.assertEqual((g["fire"], g["froze"], g["freezes"]), (2, 1, server.FREEZE_MAX - 1))
        self.assertEqual(g["cover"][(today - datetime.timedelta(days=1)).isoformat()], "freeze")
        self.assertEqual(server.game_summary(db, sid)["froze"], 0)      # второй раз не тратится
        dawn = time.mktime(today.timetuple()) + 1                      # начало сегодняшнего дня — всегда уже в прошлом
        for j in range(3):                                             # сегодня решил — огонёк +1 за сегодня
            db.x("INSERT INTO attempts(student_id, ts, task_id, n, score) VALUES(?,?,?,5,1)", (sid, dawn + j, ids[k % len(ids)] + f"#{k}"))
            k += 1
        self.assertEqual(server.game_summary(db, sid)["fire"], 3)
        # восстановление учителем через замороженный день: замороженный день не считается, восстановленные — считаются
        st, d = self.admin("POST", "/api/admin/student/fire", {"id": sid, "days": 5})
        self.assertEqual((st, d["fire"], d["added"]), (200, 5, 2))
        # учитель восстанавливает огонёк ученику без истории
        tok2 = self.login("Огоньков Олег")
        sid2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        st, d = self.admin("POST", "/api/admin/student/fire", {"id": sid2, "days": 5})
        self.assertEqual((st, d["fire"], d["added"]), (200, 5, 5))
        self.assertEqual(server.game_summary(db, sid2)["fire"], 5)
        self.assertEqual(self.admin("POST", "/api/admin/student/fire", {"id": sid2, "days": 3})[1]["added"], 0)

    def test_coins_and_gifts(self):
        db = server.APP.db
        tok = self.login("Монеткин Михаил")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        tok2 = self.login("Подарков Пётр")
        sid2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        # монеты: 1 за каждые COIN_XP опыта; покупка заморозки монет не отнимает
        db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?, 'duel:1')", (sid, time.time() - 86400, 1000))
        st, d = self.req("GET", "/api/gifts", token=tok)
        self.assertEqual(d["coins"], 1000 // server.COIN_XP)
        self.assertIn(sid2, [m["sid"] for m in d["mates"]])
        self.assertEqual(self.req("POST", "/api/freeze/buy", {}, tok)[0], 200)
        self.assertEqual(self.req("GET", "/api/gifts", token=tok)[1]["coins"], 1000 // server.COIN_XP)
        # купить подарок однокласснику: монеты списаны, у него — подарок у ника и уведомление
        price = next(c["price"] for c in self.req("GET", "/api/gifts", token=tok)[1]["catalog"] if c["id"] == "teddy")   # со спросом
        st, r = self.req("POST", "/api/gifts/buy", {"gift": "teddy", "to": sid2}, tok)
        self.assertEqual(st, 200, r)
        self.assertEqual(r["game"]["coins"], 1000 // server.COIN_XP - price)
        me2 = self.req("GET", "/api/me", token=tok2)[1]
        self.assertEqual([(g["gift"], g["from"]) for g in me2["gifts_new"]], [("teddy", "Монеткин М.")])
        self.req("POST", "/api/gifts/seen", {"ids": [g["id"] for g in me2["gifts_new"]]}, tok2)
        self.assertEqual(self.req("GET", "/api/me", token=tok2)[1]["gifts_new"], [])
        self.assertEqual(server.gift_icons(db, sid2), [{"i": "🧸", "t": "Подарок: Мишка · Редкий", "n": 0}])
        # не хватает монет, нет такого подарка, чужой ученик
        self.assertEqual(self.req("POST", "/api/gifts/buy", {"gift": "dragon"}, tok)[0], 400)
        self.assertEqual(self.req("POST", "/api/gifts/buy", {"gift": "nope"}, tok)[0], 400)
        self.assertEqual(self.req("POST", "/api/gifts/buy", {"gift": "cookie", "to": 999999}, tok)[0], 404)
        # у второго монет нет — купить нельзя
        self.assertEqual(self.req("POST", "/api/gifts/buy", {"gift": "cookie"}, tok2)[0], 400)
        # учитель: монеты и случайный подарок всем; один подарок ученику с подписью
        st, r = self.admin("POST", "/api/admin/gifts/give", {"all": True, "gift": "random", "coins": 50})
        self.assertEqual(st, 200, r)
        self.assertGreaterEqual(r["count"], 2)
        self.assertEqual(self.req("GET", "/api/gifts", token=tok2)[1]["coins"], 50)
        st, r = self.admin("POST", "/api/admin/gifts/give", {"student_id": sid2, "gift": "rocket", "note": "За №27!"})
        self.assertEqual((st, r["count"]), (200, 1))
        mine = self.req("GET", "/api/gifts", token=tok2)[1]["mine"]
        self.assertEqual((mine[0]["gift"], mine[0]["from"], mine[0]["note"]), ("rocket", "учитель", "За №27!"))
        self.assertEqual(len(mine), 3)
        self.assertEqual(self.admin("POST", "/api/admin/gifts/give", {"student_id": sid2})[0], 400)          # ни подарка, ни монет
        self.assertEqual(self.admin("POST", "/api/admin/gifts/give", {"student_id": sid2, "coins": 5000})[0], 400)
        self.assertEqual(self.admin("GET", "/api/admin/gifts")[1]["recent"][0]["t"], "Ракета")
        # подарки видны у ника в рейтинге
        rows = self.req("GET", "/api/leaderboard", token=tok)[1]["boards"]["league"]["top"]
        self.assertIn("🧸", [g["i"] for g in next(r for r in rows if r["sid"] == sid2)["gifts"]])
        # «случайный подарок» — выпадает подарок из каталога за GIFT_BOX_PRICE
        have = self.req("GET", "/api/gifts", token=tok)[1]["coins"]
        st, r = self.req("POST", "/api/gifts/buy", {"gift": "box"}, tok)
        self.assertEqual(st, 200, r)
        self.assertIn(r["got"], server.GIFT_BY)
        self.assertEqual(r["game"]["coins"], have - server.GIFT_BOX_PRICE)
        # улучшение: подарок становится уникальным — номер, фон, узор, эффект с редкостью; второй раз нельзя
        db.x("INSERT INTO coins(student_id, ts, delta, reason) VALUES(?,?,?, 'grant')", (sid2, time.time(), 500))
        teddy = next(g for g in self.req("GET", "/api/gifts", token=tok2)[1]["mine"] if g["gift"] == "teddy")
        self.assertIsNone(teddy["uniq"])
        self.assertEqual(teddy["rar"]["t"], "Редкий")                                                   # шанс в 🎲 ~3%
        have2 = self.req("GET", "/api/gifts", token=tok2)[1]["coins"]
        st, r = self.req("POST", "/api/gifts/upgrade", {"id": teddy["id"]}, tok2)
        self.assertEqual(st, 200, r)
        self.assertEqual(r["game"]["coins"], have2 - server.GIFT_UP_PRICE)                              # улучшение — 500 ₿
        u = r["gift"]["uniq"]
        self.assertEqual(u["n"], 1)
        self.assertIn(u["rar"]["t"], ["Редкий", "Эпический", "Легендарный", "Мифический"])
        raw = json.loads(db.q("SELECT uniq FROM gifts WHERE id=?", (teddy["id"],), one=True)["uniq"])
        prod = 1                                                                                       # точный шанс: проценты на экране округлены
        for key, xs, w in (("bg", server.UNIQ_BG, 4), ("sym", server.UNIQ_SYM, 3), ("fx", server.UNIQ_FX, 2), ("pose", server.UNIQ_POSE, 2)):
            prod *= next(x[w] for x in xs if x[0] == raw[key]) / sum(x[w] for x in xs)
        self.assertEqual(u["rar"]["one_in"], round(1 / prod))                                          # 1 из N = фон × узор × эффект × поза
        self.assertEqual([x["k"] for x in u["props"]], ["Фон", "Узор", "Эффект", "Поза"])
        self.assertTrue(all(0 < x["p"] <= 100 for x in u["props"]))
        self.assertEqual(self.req("POST", "/api/gifts/upgrade", {"id": teddy["id"]}, tok2)[0], 409)
        self.assertEqual([server.gift_rarity(k)["t"] for k in ("cookie", "tulip", "teddy", "robot", "dragon")],
                         ["Обычный", "Необычный", "Редкий", "Эпический", "Легендарный"])
        self.assertEqual(self.req("POST", "/api/gifts/upgrade", {"id": teddy["id"]}, tok)[0], 404)       # чужой подарок
        self.assertTrue(server.gift_icons(db, sid2)[0]["u"])                                            # уникальный — первым у ника
        # учитель дарит сразу уникальные: номера идут подряд, сочетания свойств не повторяются
        self.admin("POST", "/api/admin/gifts/give", {"all": True, "gift": "teddy", "unique": True})
        combos = [json.loads(r["uniq"]) for r in db.q("SELECT uniq FROM gifts WHERE gift='teddy' AND uniq IS NOT NULL")]
        self.assertEqual(sorted(c["n"] for c in combos), list(range(1, len(combos) + 1)))
        self.assertEqual(len({(c["bg"], c["sym"], c["fx"]) for c in combos}), len(combos))

    def test_gift_catalog_and_rarity(self):
        # 70 подарков: ключи и значки не повторяются и не путаются с наградами профиля
        self.assertEqual(len(server.GIFTS), 70)
        self.assertEqual(len({g[0] for g in server.GIFTS}), 70)
        self.assertEqual(len({g[1] for g in server.GIFTS}), 70)
        self.assertEqual({g[1] for g in server.GIFTS} & {a[1] for a in server.AWARDS}, {"🚀"})   # «Ракета» была раньше наград — оставлена
        tiers = {}
        for g in server.GIFTS:
            k = server.gift_rarity(g[0])["k"]
            tiers[k] = tiers.get(k, 0) + 1
        self.assertEqual(set(tiers), {"common", "uncommon", "rare", "epic", "legend"})
        self.assertTrue(all(n >= 8 for n in tiers.values()), tiers)
        # уникальные: при улучшении примерно 58 / 30 / 10 / 2 %
        import itertools
        tot = [sum(x[i] for x in xs) for xs, i in ((server.UNIQ_BG, 4), (server.UNIQ_SYM, 3), (server.UNIQ_FX, 2), (server.UNIQ_POSE, 2))]
        acc = {}
        for b, sy, f, po in itertools.product(server.UNIQ_BG, server.UNIQ_SYM, server.UNIQ_FX, server.UNIQ_POSE):
            c = b[4] / tot[0] * sy[3] / tot[1] * f[2] / tot[2] * po[2] / tot[3]
            k = server.rarity_tier(c, server.UNIQ_RARITY)[0]
            acc[k] = acc.get(k, 0) + c
        self.assertAlmostEqual(acc["myth"], 0.02, delta=0.01)
        self.assertAlmostEqual(acc["legend"], 0.10, delta=0.02)
        self.assertAlmostEqual(acc["epic"], 0.30, delta=0.03)

    def test_btc_rate_demand_site(self):
        db = server.APP.db
        # курс: много верно решающих сейчас — биткоин дороже (но не дороже BTC_RATE_MAX XP); прошлое не пересчитывается
        tok = self.login("Курсов Кирилл")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?, 'duel:1')", (sid, time.time() - 7200, 1000))
        self.assertEqual(server.game_summary(db, sid)["mined"], 100)
        free, step = server.BTC_RATE_FREE, server.BTC_RATE_STEP
        try:
            server.BTC_RATE_FREE, server.BTC_RATE_STEP = 0, 1
            other = self.req("GET", "/api/me", token=self.login("Онлайнов Олег"))[1]["sid"]
            db.x("INSERT INTO attempts(student_id, ts, task_id, n, score, spent_ms) VALUES(?,?,?,5,1,?)",
                 (other, time.time() - 600, BANK["tasks"][0]["id"] + "#rate", 120000))       # сейчас занимается хотя бы один
            server._BTC_RATES["tick"] = 0
            k, active = server.btc_rate_now(db)
            self.assertEqual(k, min(server.BTC_RATE_MAX, server.COIN_XP + active))
            self.assertGreater(k, server.COIN_XP)
            time.sleep(0.01)
            db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?, 'duel:1')", (sid, time.time(), 200))
            self.assertEqual(server.game_summary(db, sid)["mined"], 100 + 200 // k)          # старые 1000 XP — по 10, новые — по k
            server.BTC_RATE_FREE = 10 ** 9
            server._BTC_RATES["tick"] = 0
            self.assertEqual(server.btc_rate_now(db)[0], server.COIN_XP)                    # народ разошёлся — курс обычный
            self.assertEqual(server.game_summary(db, sid)["mined"], 100 + 200 // k)
        finally:
            server.BTC_RATE_FREE, server.BTC_RATE_STEP = free, step
            server._BTC_RATES["tick"] = 0
        # спрос: покупают чаще других — дорожает; «случайный подарок» — 60 ₿; цены каталога выше на 10 %
        self.assertEqual((server.GIFT_BOX_PRICE, server.GIFT_BY["cookie"][3], server.GIFT_BY["dragon"][3]), (60, 11, 770))
        db.x("INSERT INTO coins(student_id, ts, delta, reason) VALUES(?,?,?, 'grant')", (sid, time.time(), 2000))
        for _ in range(6):
            self.req("POST", "/api/gifts/buy", {"gift": "donut"}, tok)
        d = self.req("GET", "/api/gifts", token=tok)[1]
        donut = next(c for c in d["catalog"] if c["id"] == "donut")
        self.assertGreater(donut["demand"], 1)
        self.assertGreater(donut["price"], donut["base"])
        self.assertEqual(d["box"], 60)
        self.assertEqual([c["base"] for c in d["catalog"]], sorted(c["base"] for c in d["catalog"]))   # витрина — по цене
        # статистика всего сайта — главному учителю
        st, e = self.admin("GET", "/api/admin/econ")
        site = e["site"]
        self.assertGreaterEqual(site["gifts"]["bought"], 6)
        self.assertEqual(site["popular"][0]["t"], "Пончик") if site["popular"][0]["n"] >= 6 else None
        self.assertGreater(site["spent"], 0)
        self.assertGreaterEqual(site["coins"]["mined"], 100)

    def test_gift_economy(self):
        # инфляция, тираж уникальных, продажа (подарок сгорает), подарки за труд
        db = server.APP.db
        server._ECON.update(t=0, v=None)
        tok = self.login("Экономов Эдуард")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        db.x("INSERT INTO coins(student_id, ts, delta, reason) VALUES(?,?,?, 'grant')", (sid, time.time(), 5000))
        d = self.req("GET", "/api/gifts", token=tok)[1]
        self.assertEqual(d["econ"]["idx"], 1.0)
        ck = next(c for c in d["catalog"] if c["id"] == "cookie")
        self.assertEqual(ck["price"], math.ceil(11 * ck["demand"]))                               # каталог × инфляция (×1) × спрос
        # продажа обычного — за половину цены; второй раз — нельзя: подарок сгорел
        self.req("POST", "/api/gifts/buy", {"gift": "cat"}, tok)
        cat = next(g for g in self.req("GET", "/api/gifts", token=tok)[1]["mine"] if g["gift"] == "cat")
        half = math.floor(server.GIFT_BY["cat"][3] * 0.5 * server.gift_demand(db)["cat"])       # половина нынешней цены
        self.assertEqual((cat["sell"], cat["up"]), (half, server.gift_up_price("cat", {"idx": 1.0}, server.uniq_issued(db))))
        coins = self.req("GET", "/api/gifts", token=tok)[1]["coins"]
        st, r = self.req("POST", "/api/gifts/sell", {"id": cat["id"]}, tok)
        self.assertEqual((st, r["price"], r["game"]["coins"]), (200, half, coins + half))
        self.assertEqual(self.req("POST", "/api/gifts/sell", {"id": cat["id"]}, tok)[0], 404)
        self.assertNotIn(cat["id"], [g["id"] for g in self.req("GET", "/api/gifts", token=tok)[1]["mine"]])
        # уникальный: цена продажи — по редкости, сочетание проданного больше не выдаётся
        self.req("POST", "/api/gifts/buy", {"gift": "robot"}, tok)
        robot = next(g for g in self.req("GET", "/api/gifts", token=tok)[1]["mine"] if g["gift"] == "robot")
        st, r = self.req("POST", "/api/gifts/upgrade", {"id": robot["id"]}, tok)
        self.assertEqual(st, 200, r)
        u = r["gift"]["uniq"]
        k = u["rar"]["k"]
        self.assertEqual(r["gift"]["sell"], math.floor(server.GIFT_BY["robot"][3] * 0.5 * server.gift_demand(db)["robot"]
                                                       + server.GIFT_UP_PRICE * server.SELL_UNIQ[k]))          # уникальная часть — от ровных 500 ₿
        self.req("POST", "/api/gifts/sell", {"id": robot["id"]}, tok)
        burned = json.loads(db.q("SELECT uniq FROM gifts WHERE id=?", (robot["id"],), one=True)["uniq"])
        with server._GIFT_LOCK:
            for _ in range(30):
                n = server.gift_uniq(db, "robot")
                self.assertNotEqual((n["bg"], n["sym"], n["fx"]), (burned["bg"], burned["sym"], burned["fx"]))
                self.assertGreater(n["n"], burned["n"])
        # тираж: кончился — улучшить нельзя; цена улучшения растёт с выпуском
        cap = server.UNIQ_CAP
        try:
            server.UNIQ_CAP = server.uniq_issued(db).get("robot", 0)
            self.req("POST", "/api/gifts/buy", {"gift": "robot"}, tok)
            robot2 = next(g for g in self.req("GET", "/api/gifts", token=tok)[1]["mine"] if g["gift"] == "robot")
            self.assertIsNone(robot2["up"])
            self.assertEqual(self.req("POST", "/api/gifts/upgrade", {"id": robot2["id"]}, tok)[0], 409)
        finally:
            server.UNIQ_CAP = cap
        # улучшение — ровно 500 ₿: без надбавки за тираж и без инфляции
        for issued, idx in (({}, 1.0), ({"cake": 50}, 1.0), ({}, 3.0)):
            self.assertEqual(server.gift_up_price("cake", {"idx": idx}, issued), 500)
        # инфляция: копят все — цены выше
        target = server.ECON_TARGET
        try:
            server.ECON_TARGET = 1
            db.x("INSERT INTO attempts(student_id, ts, task_id, n, score) VALUES(?,?,?,5,1)", (sid, time.time() - 60, "econ:1"))
            e = server.econ(db, fresh=True)
            self.assertGreater(e["idx"], 1)
            c0 = self.req("GET", "/api/gifts", token=tok)[1]["catalog"][0]
            self.assertGreater(c0["price"], math.ceil(c0["base"] * c0["demand"]))
        finally:
            server.ECON_TARGET = target
            server._ECON.update(t=0, v=None)
        # за труд: каждые WORK_GIFT_EVERY впервые решённых — случайный подарок, один раз за рубеж
        tok2 = self.login("Трудов Тимур")
        sid2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        ids = [t["id"] for t in BANK["tasks"]]
        base = time.time() - 7200
        for j in range(server.WORK_GIFT_EVERY):
            db.x("INSERT INTO attempts(student_id, ts, task_id, n, score, spent_ms) VALUES(?,?,?,5,1,90000)",
                 (sid2, base + j * 100, f"{ids[j % len(ids)]}#w{j}"))
        g = server.game_summary(db, sid2)
        self.assertEqual(g["gift_drop"], 1)
        me2 = self.req("GET", "/api/me", token=tok2)[1]
        self.assertEqual([(x["from"], x["note"]) for x in me2["gifts_new"]], [("труд", f"За труд: {server.WORK_GIFT_EVERY} решённых заданий")])
        self.assertEqual(server.game_summary(db, sid2)["gift_drop"], 0)

    def test_btc_fine_take_and_remove(self):
        db = server.APP.db
        tok = self.login("Спешкин Семён")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        ids = [t["id"] for t in BANK["tasks"]]
        # быстрее 30 секунд — минус биткоин (как «быстрее минуты — минус опыт»)
        db.x("INSERT INTO coins(student_id, ts, delta, reason) VALUES(?,?,?, 'grant')", (sid, time.time() - 600, 100))
        g0 = server.game_summary(db, sid)
        db.x("INSERT INTO attempts(student_id, ts, task_id, n, score, spent_ms) VALUES(?,?,?,5,1,?)", (sid, time.time(), ids[0] + "#f1", 9000))
        g1 = server.game_summary(db, sid)
        self.assertEqual((g1["btc_fast"], g1["coins"]), (1, g0["coins"] - 1))
        db.x("INSERT INTO attempts(student_id, ts, task_id, n, score, spent_ms) VALUES(?,?,?,5,1,?)", (sid, time.time() + 0.001, ids[1] + "#f2", 45000))
        self.assertEqual(server.game_summary(db, sid)["btc_fast"], 1)          # 45 секунд: минус опыт, но не биткоин
        self.assertEqual(self.req("GET", "/api/gifts", token=tok)[1]["fines"], 1)
        # учитель снимает: не больше, чем есть; ученик видит уведомление с причиной
        have = server.game_summary(db, sid)["coins"]
        st, r = self.admin("POST", "/api/admin/gifts/give", {"student_id": sid, "coins": -(have + 50), "note": "Нечестные ответы"})
        self.assertEqual((st, r["taken"]), (200, have))
        self.assertEqual(server.game_summary(db, sid)["coins"], 0)
        news = self.req("GET", "/api/me", token=tok)[1]["coin_news"]
        self.assertEqual([(c["delta"], c["note"]) for c in news], [(-have, "Нечестные ответы")])
        self.req("POST", "/api/gifts/seen", {"coin_ids": [c["id"] for c in news]}, tok)
        self.assertEqual(self.req("GET", "/api/me", token=tok)[1]["coin_news"], [])
        self.assertEqual(self.req("GET", "/api/gifts", token=tok)[1]["ledger"][0]["reason"], "take")
        self.assertEqual(self.admin("POST", "/api/admin/gifts/give", {"student_id": sid, "coins": -5, "gift": "cat"})[0], 400)
        # учитель удаляет подарок из профиля: сгорает, у ника пропадает
        self.admin("POST", "/api/admin/gifts/give", {"student_id": sid, "gift": "teddy"})
        st, d = self.admin("GET", f"/api/admin/gifts/student?id={sid}")
        gid = next(g["id"] for g in d["gifts"] if g["gift"] == "teddy")
        self.assertEqual(self.admin("POST", "/api/admin/gifts/remove", {"id": gid})[0], 200)
        self.assertNotIn(gid, [g["id"] for g in self.admin("GET", f"/api/admin/gifts/student?id={sid}")[1]["gifts"]])
        self.assertNotIn("🧸", [g["i"] for g in server.gift_icons(db, sid)])
        self.assertEqual(self.admin("POST", "/api/admin/gifts/remove", {"id": gid})[0], 404)

    def test_econ_overview_and_feed(self):
        db = server.APP.db
        tok = self.login("Журналов Жора")
        sid = self.req("GET", "/api/me", token=tok)[1]["sid"]
        tok2 = self.login("Получаев Пётр")
        sid2 = self.req("GET", "/api/me", token=tok2)[1]["sid"]
        db.x("INSERT INTO xp_adjust(student_id, ts, delta, reason) VALUES(?,?,?, 'duel:1')", (sid, time.time() - 3600, 10000))
        teddy_price = next(c["price"] for c in self.req("GET", "/api/gifts", token=tok)[1]["catalog"] if c["id"] == "teddy")
        self.req("POST", "/api/gifts/buy", {"gift": "teddy", "to": sid2}, tok)                       # подарок однокласснику
        self.req("POST", "/api/gifts/buy", {"gift": "cat"}, tok)
        cat = next(g for g in self.req("GET", "/api/gifts", token=tok)[1]["mine"] if g["gift"] == "cat")
        self.req("POST", "/api/gifts/upgrade", {"id": cat["id"]}, tok)
        self.req("POST", "/api/gifts/sell", {"id": cat["id"]}, tok)
        self.admin("POST", "/api/admin/gifts/give", {"student_id": sid, "coins": 30, "note": "Молодец"})
        self.admin("POST", "/api/admin/gifts/give", {"student_id": sid2, "gift": "rocket", "note": "Так держать"})
        teddy = next(g["id"] for g in self.admin("GET", f"/api/admin/gifts/student?id={sid2}")[1]["gifts"] if g["gift"] == "teddy")
        self.admin("POST", "/api/admin/gifts/remove", {"id": teddy})
        st, d = self.admin("GET", "/api/admin/econ")
        self.assertEqual(st, 200, d)
        mine = [e for e in d["feed"] if e["sid"] in (sid, sid2)]
        kinds = [e["kind"] for e in sorted(mine, key=lambda e: e["ts"])]
        for k in ("gift", "upgrade", "sell", "grant", "teacher_gift", "removed"):
            self.assertIn(k, kinds)
        buy = next(e for e in mine if e["kind"] == "gift" and e["gift"]["t"] == "Мишка")
        self.assertEqual((buy["to"], buy["delta"]), ("Получаев П.", -teddy_price))
        up = next(e for e in mine if e["kind"] == "upgrade")
        self.assertTrue(up["gift"]["uniq"]["n"] >= 1)
        self.assertGreaterEqual(d["total"]["mined"], 1000)
        self.assertGreater(d["total"]["upgrade"], 0)
        # кошелёк и история одного ученика
        st, s1 = self.admin("GET", f"/api/admin/gifts/student?id={sid}")
        w = s1["wallet"]
        self.assertEqual((w["mined"], w["grant"]), (1000, 30))
        self.assertEqual(w["balance"], w["mined"] + w["grant"] + w["sell"] - w["gift"] - w["upgrade"] - w["take"] - w["fines"])
        self.assertTrue(all(e["sid"] == sid for e in s1["feed"]))

    def test_answer_fix(self):
        # исправленный вручную ответ банка подменяется при загрузке: верный засчитывается, ответ из банка — нет
        bank = server.APP.bank
        tid = BANK["tasks"][0]["id"]
        server.ANS_FIX[tid] = "011"
        try:
            bank.mtime = None
            bank.ensure()
            self.assertEqual(bank.tasks[tid]["ans"], "011")
            self.assertEqual(server.answer_credit(4, bank.tasks[tid]["ans"], "011"), 1.0)
            self.assertEqual(server.answer_credit(4, bank.tasks[tid]["ans"], "11"), 0.0)
        finally:
            del server.ANS_FIX[tid]
            bank.mtime = None
            bank.ensure()
        self.assertNotEqual(bank.tasks[tid]["ans"], "011")

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


class NumberFixTest(unittest.TestCase):
    def test_turtle_moves_to_6(self):
        import clusters
        tasks = [{"id": "x:1", "n": 2, "html": "<p>Исполнитель Черепаха действует на плоскости… Повтори 7 [Вперёд 5 Направо 90]</p>"},
                 {"id": "x:2", "n": 3, "html": "<p>Магазины района Черепахино: сколько плинтуса продано?</p>"},
                 {"id": "x:3", "n": 6, "html": "<p>Черепаха: Повтори 4 [Вперёд 10 Направо 90]</p>"}]
        self.assertEqual(clusters.fix_numbers(tasks), [("x:1", 2, 6)])
        self.assertEqual([t["n"] for t in tasks], [6, 3, 6])


class AppBuildTest(unittest.TestCase):
    def test_app_js_built_from_modules(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
        import build_app
        self.assertEqual(build_app.OUT.read_text(encoding="utf-8"), build_app.build(),
                         "app.js не собран из src/app/*.js — запустите python3 tools/build_app.py")


if __name__ == "__main__":
    unittest.main()
