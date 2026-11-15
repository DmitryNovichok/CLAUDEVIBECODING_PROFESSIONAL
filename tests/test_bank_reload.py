"""Файл банка переписывают во время обновления сайта — сервер продолжает отдавать прежний банк."""
import os
import json
import tempfile
import time
import unittest
from unittest import mock
from pathlib import Path

import server


class BankReloadTest(unittest.TestCase):
    def test_missing_main_bank_keeps_previous_tasks(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(server, 'EXTRA_BANK', Path(d) / 'absent.json'):
            path = Path(d) / 'bank.js'
            path.write_text('window.EGE_BANK = {"tasks":[{"id":"t:1","n":1,"ans":"5"}]};')
            bank = server.Bank(path)
            self.assertTrue(bank.ensure())
            before = bank.public_raw
            path.unlink()
            self.assertTrue(bank.ensure())
            self.assertEqual(bank.public_raw, before)

    def test_broken_or_missing_extra_bank_keeps_both_banks_and_recovers(self):
        for broken in (None, '{', '[]', '{"bank":{},"tasks":[]}'):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as d:
                extra = Path(d) / 'extra.json'
                with mock.patch.object(server, 'EXTRA_BANK', extra):
                    path = Path(d) / 'bank.js'
                    path.write_text('window.EGE_BANK = {"tasks":[{"id":"t:1","n":1,"ans":"5"}]};')
                    valid = {'bank':{'id':'own','title':'Demo'}, 'tasks':[{'id':'own:1','n':1,'ans':'8'}]}
                    extra.write_text(json.dumps(valid))
                    bank = server.Bank(path)
                    self.assertTrue(bank.ensure())
                    before = (bank.public_raw, bank.etag, bank.extra_mtime)
                    if broken is None:
                        extra.unlink()
                    else:
                        extra.write_text(broken)
                        os.utime(extra, (time.time()+5, time.time()+5))
                    self.assertTrue(bank.ensure())
                    self.assertEqual((bank.public_raw, bank.etag, bank.extra_mtime), before)
                    self.assertIn('own:1', bank.tasks)
                    valid['tasks'][0]['ans'] = '9'
                    extra.write_text(json.dumps(valid))
                    os.utime(extra, (time.time()+10, time.time()+10))
                    self.assertTrue(bank.ensure())
                    self.assertEqual(bank.tasks['own:1']['ans'], '9')

    def test_empty_or_malformed_bank_never_replaces_working_tasks(self):
        for broken in ({'tasks':[]}, {'tasks':[{}]}, {'tasks':{}}, []):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as d:
                with mock.patch.object(server, 'EXTRA_BANK', Path(d) / 'absent.json'):
                    path = Path(d) / 'bank.js'
                    path.write_text('window.EGE_BANK = {"tasks":[{"id":"t:1","n":1,"ans":"5"}]};')
                    bank = server.Bank(path)
                    self.assertTrue(bank.ensure())
                    before = bank.public_raw
                    path.write_text('window.EGE_BANK = ' + json.dumps(broken) + ';')
                    os.utime(path, (time.time()+5, time.time()+5))
                    self.assertTrue(bank.ensure())
                    self.assertIn('t:1', bank.tasks)
                    self.assertEqual(bank.public_raw, before)

    def test_broken_bank_file_keeps_previous_tasks(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "bank.js"
            f.write_text('window.EGE_BANK = {"banks": [{"id": "t", "title": "T"}], "tasks": '
                         '[{"id": "t:1", "n": 1, "html": "<p>x</p>", "ans": "5"}]};\n', encoding="utf-8")
            old_extra = server.EXTRA_BANK
            server.EXTRA_BANK = Path(d) / "no-extra.json"
            try:
                b = server.Bank(f)
                self.assertTrue(b.ensure())
                self.assertIn("t:1", b.tasks)
                f.write_text('window.EGE_BANK = {"tasks": [', encoding="utf-8")       # файл обрезан посередине
                os.utime(f, (time.time() + 5, time.time() + 5))
                self.assertTrue(b.ensure())
                self.assertIn("t:1", b.tasks)
                self.assertTrue(b.public_raw.startswith(b"window.EGE_BANK = "))
            finally:
                server.EXTRA_BANK = old_extra


class LiveEvictTest(unittest.TestCase):
    def test_new_connection_pushes_out_oldest_instead_of_503(self):
        hub = server.LiveHub()
        hub.thread = True                       # фоновый поток в тесте не нужен
        qs = [hub.subscribe(77, 1) for _ in range(server.LIVE_PER_STUDENT)]
        newest = hub.subscribe(77, 1)           # ученик обновил страницу ещё раз
        self.assertIsNotNone(newest)
        self.assertIsNone(qs[0].get_nowait())   # самое старое соединение получило сигнал закрыться
        self.assertEqual(len(hub.subs[77]), server.LIVE_PER_STUDENT)
        self.assertIn(newest, hub.subs[77])


class VersionTest(unittest.TestCase):
    def test_app_version_is_newest_from_changelog(self):
        import re
        text = (server.HERE / "changelog.js").read_text(encoding="utf-8")
        newest = max(tuple(map(int, v)) for v in re.findall(r'\["(\d+)\.(\d+)\.(\d+)"', text))
        self.assertEqual(server.APP_VERSION, ".".join(map(str, newest)))

    def test_task10_bank_is_merged_and_keeps_kim2027_number(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'data').mkdir()
            path = root / 'data' / 'bank.js'
            path.write_text('window.EGE_BANK = {"banks":[{"id":"k","title":"K"}],"tasks":[{"id":"k:1","n":10,"ans":"255",'
                            '"html":"<p>IP-адрес и маска</p>"}]};', encoding='utf-8')
            t10 = {'bank': {'id': 'task10_bank', 'title': 'T10'},
                   'tasks': [{'id': 'task10_bank:kompege_1', 'n': 10, 'kim': 2027, 'ans': '42', 'bank': 'task10_bank',
                              'html': '<p>Сколько раз встречается слово «чай»?</p>',
                              'att': [{'name': '10.docx', 'href': '../task10_bank/files/kompege/1/10.docx'}]}]}
            (root / 'data' / 'task10_bank.json').write_text(json.dumps(t10, ensure_ascii=False), encoding='utf-8')
            with mock.patch.object(server, 'EXTRA_BANK', root / 'data' / 'egeshka_bank.json'):
                bank = server.Bank(path)
                self.assertTrue(bank.ensure())
                self.assertEqual(bank.tasks['k:1']['n'], 13)                       # IP-адреса 2026 → №13
                self.assertEqual(bank.tasks['task10_bank:kompege_1']['n'], 10)     # уже в нумерации 2027
                self.assertEqual(bank.titles.get('task10_bank'), 'T10')
                # файл задания пропал при обновлении — банк остаётся прежним
                before = bank.extra_mtime
                (root / 'data' / 'task10_bank.json').unlink()
                self.assertTrue(bank.ensure())
                self.assertEqual(bank.extra_mtime, before)
                self.assertIn('task10_bank:kompege_1', bank.tasks)

    def test_task10_bank_data_file(self):
        p = Path(server.HERE) / 'data' / 'task10_bank.json'
        data = json.loads(p.read_text(encoding='utf-8'))
        server.Bank.validate_data(data, extra=True)
        self.assertEqual(data['bank']['id'], 'task10_bank')
        self.assertGreaterEqual(len(data['tasks']), 200)
        for t in data['tasks']:
            self.assertEqual((t['n'], t['kim'], t['bank']), (10, 2027, 'task10_bank'), t['id'])
            self.assertRegex(t['ans'], r'^[0-9A-Za-zА-ЯЁа-яё]+$', t['id'])     # число, у пары заданий — слово
            self.assertTrue(t.get('att'), t['id'])
            for a in t['att']:
                self.assertTrue(a['href'].startswith('../task10_bank/files/'), a)
            self.assertNotIn('ege.fipi.ru', t['html'])


if __name__ == "__main__":
    unittest.main()
