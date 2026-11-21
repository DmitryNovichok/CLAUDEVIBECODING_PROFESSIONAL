"""Защита от возврата «ИИ-следа» в интерфейсе (правила .unslop-ui/taste.md, версии 2.87–2.90).

Если тест упал — либо уберите добавленное, либо (если это осознанное исключение) расширьте список разрешённого здесь.
"""
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "src" / "app"


def read(p):
    return Path(p).read_text(encoding="utf-8")


class UnslopTest(unittest.TestCase):
    def test_calm_css_block_is_current(self):
        r = subprocess.run([sys.executable, "tools/calm_css.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_kickers_only_where_allowed(self):
        # Надпись над заголовком (U1) — только слайды урока, архивные темы и олимпиада ИМ
        allowed = {"03b-course-ui.js": 2, "12o-im.js": 1}
        for f in APP.glob("*.js"):
            n = read(f).count("crs-kicker")
            self.assertLessEqual(n, allowed.get(f.name, 0), f"{f.name}: новая надпись crs-kicker над заголовком")

    def test_welcome_has_no_decor(self):
        s = read(ROOT / "welcome.html")
        for bad in ("w-sticker", "w-chip", "data-tilt", "data-parallax"):
            self.assertNotIn(bad, s, f"welcome.html: вернулось {bad}")
        self.assertLessEqual(s.count('class="w-lbl"'), 1, "welcome.html: надписи над заголовками")

    def test_no_long_status_chains_in_headers(self):
        # Цепочка из 3+ фактов через «·» в шапке задания и строке статистики (U6)
        for f, marks in (("02-trainer.js", ("task-meta",)), ("04-stats-goals.js", ("scope-stats", "scopeInfo"))):
            for line in read(APP / f).splitlines():
                if any(m in line for m in marks):
                    self.assertLess(line.count(" · "), 3, f"{f}: длинная цепочка через «·»: {line.strip()[:120]}")

    def test_no_exclamations_in_hints_and_errors(self):
        # Восклицания в тостах вне игровых экранов (огонёк, лига, турниры, подарки, новости)
        games = {"04-stats-goals.js", "10-levels-league.js", "11-tours-duels.js", "12c-gifts.js", "12d-stories.js"}
        rx = re.compile(r"toast\(\s*['`]([^'`]*)['`]")
        for f in APP.glob("*.js"):
            if f.name in games:
                continue
            for m in rx.finditer(read(f)):
                text = m.group(1)
                if re.search(r"\w!(\s|$)", text) and not re.match(r"\W*Верно!", text):
                    self.fail(f"{f.name}: восклицание в сообщении: {text[:100]}")

    def test_admin_action_buttons_without_decor_emoji(self):
        s = read(ROOT / "admin.js")
        for bad in ("⚡ Запустить", "🎆 Запустить", "🎲 Выдать", "🔓 Открыть все", "➖ Снять монеты", "🎁 Подарить'"):
            self.assertNotIn(bad, s, f"admin.js: эмодзи на кнопке «{bad}»")

    def test_teacher_entry_screens(self):
        gate = read(ROOT / "teacher-gate.html")
        self.assertNotIn('class="eyebrow"', gate, "teacher-gate.html: надпись над заголовком")
        self.assertNotRegex(gate, r">0[1-9]<", "teacher-gate.html: нумерация 01/02")
        login = read(ROOT / "admin.html")
        self.assertNotIn("Egeshka и тарифы", login, "admin.html: ссылка на тарифы, которых на /welcome нет")
        for f in ("admin.css", "admin-theme.css", "teacher-gate.css"):
            self.assertNotRegex(read(ROOT / f), r"font(-weight)?:\s*(800|900)\b", f"{f}: вес 800/900")


if __name__ == "__main__":
    unittest.main()
