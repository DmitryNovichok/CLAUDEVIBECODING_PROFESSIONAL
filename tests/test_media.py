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

    def tearDown(self):
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

    def test_server_warns_about_missing_bank_dirs(self):
        saved = server.BIBLIO, server.HERE
        try:
            server.BIBLIO = self.tmp
            server.HERE = self.tmp / "trainer"
            (self.tmp / "ege_bank").mkdir()
            b = server.Bank(self.tmp / "none.js")
            b.check_media('<img src=\\"../ege_bank/a.png\\"><img src=\\"../kompege_bank/assets/b.png\\">')
            self.assertEqual(b.missing_dirs, ["kompege_bank"])
            b.check_media('<img src=\\"media/kompege_bank/b.png\\">')
            self.assertEqual(b.missing_dirs, ["trainer/media"])
        finally:
            server.BIBLIO, server.HERE = saved


if __name__ == "__main__":
    unittest.main()
