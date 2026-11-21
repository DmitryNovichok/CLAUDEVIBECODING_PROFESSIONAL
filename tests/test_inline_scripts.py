"""Встроенные <script> страниц не объявляют глобальных переменных.

Обфускатор (tools/obfuscate, domainLock) добавляет в начало app.js и together.js константы верхнего уровня
с короткими именами (h, t, …). Если встроенный скрипт той же страницы объявит глобальную `var t`,
браузер не запустит весь файл: «Identifier 't' has already been declared». Поэтому код встроенных скриптов —
только внутри (function(){ … })().
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class InlineScriptsTest(unittest.TestCase):
    def test_inline_scripts_are_wrapped(self):
        for page in sorted(ROOT.glob("*.html")):
            if page.name == "python-sandbox.html":          # отдельная песочница без общих скриптов сайта
                continue
            html = page.read_text(encoding="utf-8")
            for body in re.findall(r"<script>(.*?)</script>", html, re.S):
                code = re.sub(r"/\*.*?\*/", "", body, flags=re.S).strip()
                if not code:
                    continue
                self.assertRegex(code, r"^\((function\s*\(|\(\)\s*=>)",
                                 f"{page.name}: встроенный скрипт без обёртки (function(){{…}})(): {code[:60]}")


if __name__ == "__main__":
    unittest.main()
