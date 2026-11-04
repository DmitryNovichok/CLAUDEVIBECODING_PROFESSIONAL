#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Проверка банка «Egeshka»: решение каждого задания (код из разбора) запускается на его файлах, вывод сверяется
с ответом; условия сравниваются с банком ФИПИ / КомпЕГЭ / «Банк ЕГЭ» — нет ли совпадающих заданий.

    python tools/egeshka_check.py            # все задания банка
    python tools/egeshka_check.py 6 17       # только номера 6 и 17
"""
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE_RE = re.compile(r'<pre class="py-sol"><code>(.*?)</code></pre>', re.S)


def plain(h):
    h = re.sub(r"<[^>]+>", " ", h or "")
    return re.sub(r"\s+", " ", html.unescape(h)).strip().lower()


def expected(t):
    if t.get("parts"):
        return " ".join(p["ans"] for p in t["parts"]).split()
    return str(t["ans"]).split()


def run_one(t):
    m = CODE_RE.search(t.get("sol") or "")
    if not m:
        return t["id"], None, "нет кода решения"
    src = html.unescape(m.group(1))
    with tempfile.TemporaryDirectory() as d:
        for a in t.get("att") or []:
            shutil.copy(ROOT / a["href"], Path(d) / a["name"])
            if t["n"] == 9 and a["name"].endswith(".xlsx"):        # 9.txt сайт делает сам — так же, через табуляцию
                import openpyxl
                ws = openpyxl.load_workbook(Path(d) / a["name"], read_only=True).worksheets[0]
                (Path(d) / "9.txt").write_text("\n".join("\t".join("" if v is None else str(v) for v in r)
                                                         for r in ws.iter_rows(values_only=True)) + "\n")
        try:
            r = subprocess.run([sys.executable, "-c", src], cwd=d, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired:
            return t["id"], False, "решение работает дольше 5 минут"
    got = r.stdout.split()
    if r.returncode:
        return t["id"], False, r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ошибка"
    return t["id"], got == expected(t), f"ждали {expected(t)}, решение вывело {got[:6]}"


def check_solutions(tasks, nums=None, jobs=8):
    # у №2 разбор печатает таблицу истинности для сопоставления со столбцами, а не сам ответ — его не сверяем
    todo = [t for t in tasks if (nums is None or t["n"] in nums) and t["n"] != 2]
    bad = 0
    with ThreadPoolExecutor(jobs) as ex:
        for tid, ok, msg in ex.map(run_one, todo):
            if ok is False or (ok is None and int(tid.split(":e")[1].split("-")[0]) >= 6):
                bad += 1
                print(f"✗ {tid}: {msg}")
    print(f"решения: проверено {len(todo)}, ошибок {bad}")
    return bad


def check_dups(tasks, nums=None):
    """Совпадение — те же числа и слова заглавными (тот же «вариант» шаблона) и почти тот же текст."""
    sys.path.insert(0, str(ROOT / "tools"))
    from egeshka_more import _plain, _sig, _words
    s = (ROOT / "data" / "bank.js").read_text(encoding="utf-8")
    bank = json.loads(s[s.index("{"):s.rindex("}") + 1])["tasks"]
    by = {}
    for t in bank:
        p = _plain(t["html"])
        by.setdefault((t["n"], _sig(p)), []).append((_words(p), p))
    seen, hits = {}, 0
    for t in tasks:
        if nums is not None and t["n"] not in nums:
            continue
        p = _plain(t["html"])
        key = p + "".join(str(hash((ROOT / a["href"]).read_bytes()))
                          for a in t.get("att") or [])
        if key in seen:
            hits += 1
            print(f"≡ {t['id']} совпадает с {seen[key]}")
        seen[key] = t["id"]
        if t.get("att"):
            continue
        w = _words(p)
        for q, txt in by.get((t["n"], _sig(p)), []):
            if len(w & q) >= 0.75 * len(w | q):
                hits += 1
                print(f"≈ {t['id']} почти совпадает с заданием банка: {txt[:120]}…")
                break
    print(f"совпадения с банком и между собой: {hits}")
    return hits


def main():
    nums = {int(x) for x in sys.argv[1:]} or None
    tasks = json.loads((ROOT / "data" / "egeshka_bank.json").read_text(encoding="utf-8"))["tasks"]
    bad = check_solutions(tasks, nums) + check_dups(tasks, nums)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
