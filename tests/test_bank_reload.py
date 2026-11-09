"""Файл банка переписывают во время обновления сайта — сервер продолжает отдавать прежний банк."""
import os
import tempfile
import time
import unittest
from pathlib import Path

import server


class BankReloadTest(unittest.TestCase):
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
