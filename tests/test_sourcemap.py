"""Таблица мест для вкладки «Ошибки»: ошибка в сжатом и обфусцированном коде указывает на строку исходника.
Нужны esbuild (arduino/source) и обфускатор (tools/obfuscate) — без них тест пропускается (в CI они ставятся)."""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from tools import sourcemap  # noqa: E402

ESBUILD = ROOT / "arduino" / "source" / "node_modules" / ".bin" / "esbuild"
OBF = ROOT / "tools" / "obfuscate"

SAMPLE = """(function () {
  'use strict';
  const greet = name => 'Привет, ' + name;
  function first(x) {
    return x * 2;
  }
  function boom(list) {
    const total = list.reduce((a, b) => a + b, 0);
    return total.missing.value;          // строка 9: TypeError
  }
  globalThis.__run = () => boom([first(1), first(2), greet('мир').length]);
})();
"""


@unittest.skipUnless(ESBUILD.exists() and (OBF / "node_modules" / "javascript-obfuscator").is_dir() and shutil.which("node"),
                     "нет esbuild или обфускатора")
class SourceMapTest(unittest.TestCase):
    def test_error_position_maps_to_source_line(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src, out = tmp / "sample.js", tmp / "out.js"
            src.write_text(SAMPLE, encoding="utf-8")
            subprocess.run([str(ESBUILD), str(src), "--minify", "--target=es2020", "--log-level=warning",
                            f"--outfile={out}", "--sourcemap=external"], check=True)
            subprocess.run(["node", str(OBF / "run.cjs"), str(out), str(out), str(tmp / "obf.map")], check=True)
            code = out.read_text(encoding="utf-8")
            self.assertNotIn("sourceMappingURL", code)                 # посетителю карта не указывается
            table = sourcemap.compose(json.loads((tmp / "out.js.map").read_text()), json.loads((tmp / "obf.map").read_text()), shift=1)
            served = tmp / "served.js"
            served.write_text("/* баннер */\n" + code, encoding="utf-8")
            # домен проверяется только в браузере (location); в node — globalThis без location
            run = subprocess.run(["node", "-e", f"require({json.dumps(str(served))}); try {{ __run(); }} catch (e) {{ console.log(e.stack); }}"],
                                 capture_output=True, text=True, check=True)
            m = re.search(r"served\.js:(\d+):(\d+)", run.stdout)
            self.assertTrue(m, run.stdout)
            # карта обфускатора отмечает границы функций и вызовов, а не каждое выражение: место — внутри нужной функции
            # (boom — строки 7–10), а не в соседних first/greet
            self.assertIn(sourcemap.lookup(table, int(m.group(1)), int(m.group(2))), range(7, 11))

    def test_lookup_bounds(self):
        table = {"lines": [[], [0, 4, 10, 7]]}
        self.assertIsNone(sourcemap.lookup(table, 1, 5))
        self.assertEqual(sourcemap.lookup(table, 2, 1), 5)
        self.assertEqual(sourcemap.lookup(table, 2, 11), 8)
        self.assertEqual(sourcemap.lookup(table, 2, 999), 8)
        self.assertIsNone(sourcemap.lookup(table, 9, 1))


if __name__ == "__main__":
    unittest.main()


class JsErrWhereTest(unittest.TestCase):
    """Сервер переводит место ошибки в сжатом app.js в модуль src/app — только для текущей версии сайта."""
    def setUp(self):
        import server
        self.server = server
        self.tmp = Path(tempfile.mkdtemp())
        self.old_here = server.HERE
        server.HERE = self.tmp
        server._APPJS.update(mtime=None, marks=[])
        server._JSMAPS.clear()
        server._CL_TOPS.update(mtime=None, tops=set())
        (self.tmp / "app.js").write_text("// заголовок\n(function () {\n  const a = 1;\n  // ═══════ src/app/02-x.js\n  f();\n"
                                         "  g();\n})();\n", encoding="utf-8")
        (self.tmp / "min").mkdir()
        (self.tmp / "min" / "app.js").write_text("/* баннер */\n(function(){...})();\n", encoding="utf-8")
        (self.tmp / "maps").mkdir()
        # строка 2 отданного файла: колонки 0–99 — строка 3 исходника, с 100 — строка 6
        (self.tmp / "maps" / "app.js.json").write_text(json.dumps({"version": 1, "lines": [[], [0, 2, 100, 5]]}), encoding="utf-8")
        (self.tmp / "changelog.js").write_text('window.EGE_CHANGELOG = {\n  student: [\n    ["3.0.0", "1.1.2027", [], []],\n'
                                               '  ],\n  teacher: [\n    ["3.0.0", "1.1.2027", [], []],\n  ],\n};\n', encoding="utf-8")

    def tearDown(self):
        self.server.HERE = self.old_here
        self.server._APPJS.update(mtime=None, marks=[])
        self.server._JSMAPS.clear()
        self.server._CL_TOPS.update(mtime=None, tops=set())
        shutil.rmtree(self.tmp)

    def test_minified_position_becomes_module_line(self):
        s = self.server
        self.assertEqual(s.jserr_where("https://egeshka.online/app.js?v=1a2b:2:150", s.jserr_fresh("3.0.0")), "src/app/02-x.js:≈2")
        self.assertEqual(s.jserr_where("https://egeshka.online/app.js?v=1a2b:2:10"), "src/app/01-core.js:≈2")
        self.assertEqual(s.jserr_where("app.js:2:150", s.jserr_fresh("2.9.0")), "app.js:2:150 (старая версия в кэше)")
        self.assertEqual(s.jserr_stack("at x (https://egeshka.online/app.js?v=9:2:150)\nat y (https://egeshka.online/app.js?v=9:2:5)"),
                         "at x (src/app/02-x.js:≈2)\nat y (src/app/01-core.js:≈2)")
        self.assertEqual(s.jserr_where("https://egeshka.online/admin-login.js:12:3"), "admin-login.js:12:3")   # не сжатый — как есть

    def test_without_min_copy_line_is_exact(self):
        (self.tmp / "min" / "app.js").unlink()
        self.assertEqual(self.server.jserr_where("app.js:6:1"), "src/app/02-x.js:2")

    def test_optional_bundle_error_maps_to_its_own_module(self):
        # The two chunks deliberately share their mtime and generated position;
        # neither may reuse the main bundle's or the other chunk's marker cache.
        import os
        for name, module in (("app-exams.js", "12n-mcko.js"),
                             ("app-learning.js", "12j-labs.js")):
            (self.tmp / name).write_text(
                "// banner\nwindow.factory = function () {\n"
                f"  // ═══════ src/app/{module}\n"
                "  fail();\n};\n", encoding="utf-8")
            os.utime(self.tmp / name, (1000, 1000))
            (self.tmp / "min" / name).write_text("/* banner */\nfail();\n")
            (self.tmp / "maps" / (name + ".json")).write_text(
                json.dumps({"version": 1, "lines": [[], [0, 3]]}))
            self.assertEqual(self.server.jserr_where(name + "?v=123:2:1"),
                             "src/app/" + module + ":≈1")
            self.assertEqual(self.server.jserr_where(name + ":2:1", False),
                             name + ":2:1 (старая версия в кэше)")
        self.assertEqual(self.server.jserr_where("app-exams.js:2:1"), "src/app/12n-mcko.js:≈1")
