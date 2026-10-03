"""Картинки заданий: исходная ссылка сохраняется при сборке, сервер предупреждает о пропавших папках."""
import hashlib
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build  # noqa: E402
import server  # noqa: E402


class MediaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        server._bank_cache.clear()
        self.saved = server.BIBLIO, server.HERE, server.BANKS_ROOT

    def tearDown(self):
        server.BIBLIO, server.HERE, server.BANKS_ROOT = self.saved
        server._bank_cache.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_build_keeps_remote_url(self):
        site = self.tmp / "trainer"
        bank = self.tmp / "kompege_bank"
        (bank / "assets").mkdir(parents=True)
        site.mkdir()
        url = "https://kompege.ru/images/graph.png"
        (bank / "assets" / (hashlib.sha256(url.encode()).hexdigest() + ".png")).write_bytes(b"png")
        b = build.Builder(site, standalone=False)
        html = b.rewrite_html(f'<p><img src="{url}" width="10"></p>', [bank], bank, "t1", remote_base=build.KOMPEGE_SITE)
        self.assertIn('src="../kompege_bank/assets/', html)
        self.assertIn(f'data-remote="{url}"', html)

    def test_build_standalone_has_no_remote(self):
        site = self.tmp / "trainer"
        bank = self.tmp / "kompege_bank"
        (bank / "assets").mkdir(parents=True)
        site.mkdir()
        url = "https://kompege.ru/images/graph.png"
        (bank / "assets" / (hashlib.sha256(url.encode()).hexdigest() + ".png")).write_bytes(b"png")
        html = build.Builder(site, standalone=True).rewrite_html(f'<img src="{url}">', [bank], bank, "t1")
        self.assertIn('src="media/kompege_bank/', html)
        self.assertNotIn("data-remote", html)

    def use_layout(self, trainer):
        server.HERE = trainer
        server.BIBLIO = trainer.parent
        server.BANKS_ROOT = None

    def test_server_warns_about_missing_bank_dirs(self):
        self.use_layout(self.tmp / "trainer")
        (self.tmp / "ege_bank").mkdir()
        b = server.Bank(self.tmp / "none.js")
        b.check_media('<img src=\\"../ege_bank/a.png\\"><img src=\\"../kompege_bank/assets/b.png\\">')
        self.assertEqual(b.missing_dirs, ["kompege_bank"])
        b.check_media('<img src=\\"media/kompege_bank/b.png\\">')
        self.assertEqual(b.missing_dirs, ["trainer/media"])

    def test_banks_found_higher_up(self):
        # скачали с GitHub в Biblio/Загрузки/CLAUDEVIBECODING_PROFESSIONAL-main — банки на два уровня выше
        (self.tmp / "Biblio" / "kompege_bank").mkdir(parents=True)
        self.use_layout(self.tmp / "Biblio" / "Загрузки" / "CLAUDEVIBECODING_PROFESSIONAL-main")
        self.assertEqual(server.find_bank("kompege_bank"), (self.tmp / "Biblio" / "kompege_bank").resolve())

    def test_banks_from_report_and_manual_root(self):
        far = self.tmp / "Documents" / "DmitryProject" / "Biblio"
        (far / "ege_bank").mkdir(parents=True)
        trainer = self.tmp / "elsewhere" / "trainer"
        (trainer / "data").mkdir(parents=True)
        self.use_layout(trainer)
        self.assertIsNone(server.find_bank("ege_bank"))
        (trainer / "data" / "report.txt").write_text(
            f"Пропущено:\n      {far}/ege_bank/tasks/1/task.json\n", encoding="utf-8")
        self.assertEqual(server.find_bank("ege_bank"), (far / "ege_bank").resolve())
        server._bank_cache.clear()
        (trainer / "data" / "report.txt").unlink()
        server.BANKS_ROOT = str(far)                       # python server.py --banks …
        self.assertEqual(server.find_bank("ege_bank"), (far / "ege_bank").resolve())
        self.assertIsNone(server.find_bank("../etc_bank"))

    def test_windows_report_path_parsed(self):
        trainer = self.tmp / "trainer"
        (trainer / "data").mkdir(parents=True)
        self.use_layout(trainer)
        (trainer / "data" / "report.txt").write_text(
            "      C:\\Users\\Dmitry\\Documents\\DmitryProject\\Biblio\\kompege_bank\\tasks\\100\\task.json\n", encoding="utf-8")
        self.assertIn(Path("C:\\Users\\Dmitry\\Documents\\DmitryProject\\Biblio"), server.report_roots())


if __name__ == "__main__":
    unittest.main()
