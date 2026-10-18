"""Курс «Программирование для ЕГЭ»: собранная папка pycourse/ согласована с описаниями tools/pycourse/."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYC = ROOT / "pycourse"


class PycourseTest(unittest.TestCase):
    def test_index_matches_modules(self):
        idx = json.loads((PYC / "index.json").read_text(encoding="utf-8"))
        sources = {f.stem.split("_")[0] for f in (ROOT / "tools" / "pycourse").glob("m*.py")}
        self.assertEqual({m["id"] for m in idx}, sources)              # каждая тема собрана, лишних нет
        ids = set()
        for m in idx:
            doc = json.loads((PYC / f"{m['id']}.json").read_text(encoding="utf-8"))
            self.assertEqual([lv["title"] for lv in doc["levels"]], [lv["title"] for lv in m["levels"]])
            for lv, ilv in zip(doc["levels"], m["levels"]):
                self.assertEqual([t["id"] for t in lv["tasks"]], ilv["tasks"])
                self.assertTrue(1 <= lv["need"] <= len(lv["tasks"]), (m["id"], lv["title"]))
                for t in lv["tasks"]:
                    self.assertNotIn(t["id"], ids)                     # ключ задачи — ключ прогресса, повторяться не может
                    ids.add(t["id"])
                    self.assertTrue(str(t["ans"]).strip() and t["sol"].strip(), t["id"])
                    for f in t.get("files", []):
                        path = f["url"].split("?")[0][len("pyc-data/"):]
                        self.assertTrue((PYC / "data" / path).is_file(), f["url"])
                for sl in lv["slides"]:
                    for f in sl.get("files", []):
                        self.assertTrue((PYC / "data" / f["url"].split("?")[0][len("pyc-data/"):]).is_file(), f["url"])
        self.assertGreater(len(ids), 300)


if __name__ == "__main__":
    unittest.main()
