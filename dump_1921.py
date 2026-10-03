#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Диагностика заданий 19–21: как они лежат в ваших банках и как сборщик склеил их в игры.

Запуск из папки trainer (рядом с build.py):
    python dump_1921.py

Результат — файл games_debug.zip рядом со скриптом. Пришлите его в чат.
Внутри только тексты заданий 19–21 (json/html) и итог склейки, без картинок и файлов,
обычно это несколько мегабайт.
"""
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build  # noqa: E402

ROOT = HERE.parent
BANKS = [b for b in build.DEFAULT_BANKS if (ROOT / b).is_dir()]
NUMS = {19, 20, 21}


def raw_sources(zf, bank_dir):
    """Исходные файлы заданий 19–21 (и любых заданий с подзадачами)."""
    n_files = 0
    tasks = bank_dir / "tasks"
    for p in sorted(tasks.rglob("*.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        items = d if isinstance(d, list) else [d]
        hit = False
        for it in items:
            if not isinstance(it, dict):
                continue
            num = build.to_int(it.get("number"))
            if num in NUMS or it.get("subTask") or it.get("group"):
                hit = True
        if not hit:
            continue
        rel = p.relative_to(ROOT)
        zf.write(p, "raw/" + rel.as_posix())
        n_files += 1
        for extra in ("condition.html", "answer.html", "attachments.json"):
            e = p.parent / extra
            if p.name == "task.json" and e.is_file():
                zf.write(e, "raw/" + e.relative_to(ROOT).as_posix())
    return n_files


def main():
    out = HERE / "games_debug.zip"
    b = build.Builder(HERE, standalone=False)
    all_tasks = []
    for name in BANKS:
        print(f"→ {name} …", flush=True)
        ts = b.build_bank(ROOT / name)
        all_tasks += [t for t in ts if t["n"] in NUMS]
    debug = []
    note = ""
    import inspect
    gg = getattr(build, "group_games", None)
    if gg is None:
        note = "build.py старый (без склейки 19–21) — замените его новым"
        games, sizes = [], Counter()
    elif "debug" in inspect.signature(gg).parameters:
        games, sizes = gg(all_tasks, debug)
    else:
        note = "build.py не последней версии — итог склейки без подробностей; лучше заменить его новым"
        games, sizes = gg(all_tasks)
    games = [g for g in games if g.get("parts")]
    if note:
        print("! " + note)

    summary = {
        "note": note,
        "build_py_size": (HERE / "build.py").stat().st_size,
        "banks": BANKS,
        "parts_by_bank_and_number": {bk: dict(Counter(t["n"] for t in all_tasks if t["bank"] == bk)) for bk in BANKS},
        "games_by_size": dict(sizes),
        "games_by_bank_and_size": {bk: dict(Counter(len(g["parts"]) for g in games if g["bank"] == bk)) for bk in BANKS},
        "how_grouped": dict(Counter(
            ("связь по id/подзадачам" if d["key"].split(":")[0] == d["bank"] else
             {"txt": "одинаковый текст", "base": "условие №19 в тексте", "seq": "номера подряд",
              "solo": "НЕ СКЛЕЕНО"}.get(d["key"].split(":")[0], d["key"].split(":")[0])) for d in debug)),
    }
    # примеры: по 15 игр каждого размера из каждого банка — с началом текста
    examples = defaultdict(list)
    if not debug:          # старый build.py: примеры прямо из игр
        for g in games:
            k = f'{g["bank"]} · {len(g["parts"])} вопр.'
            if len(examples[k]) < 15:
                examples[k].append({"game": g["id"], "kept": [(p["id"], p["n"]) for p in g["parts"]],
                                    "text": re.sub(r"\s+", " ", build.strip_tags(g["html"]))[:600]})
    for d in debug:
        k = f'{d["bank"]} · {len(d["kept"])} вопр.'
        if len(examples[k]) < 15:
            g = next(x for x in games if x["id"] == d["game"])
            d = dict(d, text=re.sub(r"\s+", " ", build.strip_tags(g["html"]))[:600])
            examples[k].append(d)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("summary.json", json.dumps(summary, ensure_ascii=False, indent=1))
        zf.writestr("grouping.json", json.dumps(debug, ensure_ascii=False, indent=1))
        zf.writestr("examples.json", json.dumps(examples, ensure_ascii=False, indent=1))
        # как это выглядит в тренажёре: первые 40 игр целиком
        zf.writestr("games_sample.json", json.dumps(games[:40], ensure_ascii=False, indent=1))
        n = 0
        for name in BANKS:
            n += raw_sources(zf, ROOT / name)
    print("\nИтог склейки:")
    for bk in BANKS:
        print(f"  {bk}: вопросов {summary['parts_by_bank_and_number'].get(bk)}, игр по размеру {summary['games_by_bank_and_size'].get(bk)}")
    print(f"\nГотово: {out} ({out.stat().st_size / 1e6:.1f} МБ, исходных файлов: {n}). Пришлите этот файл в чат.")


if __name__ == "__main__":
    main()
