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


if __name__ == "__main__":
    unittest.main()
