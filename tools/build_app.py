#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Собирает app.js из модулей src/app/*.js (по порядку имён).

Модули — куски одной общей функции-обёртки: первый открывает её, последний
закрывает, поэтому переменные и функции видны во всех модулях, как раньше.
Править нужно src/app/*.js, затем запустить:

    python3 tools/build_app.py          # пересобрать app.js
    python3 tools/build_app.py --check  # только проверить, что app.js собран из текущих модулей

Готовый app.js хранится в репозитории: сайт работает и без сборки,
в том числе при открытии index.html двойным кликом.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "app"
OUT = ROOT / "app.js"
BANNER = "// Собрано из src/app/*.js командой python3 tools/build_app.py — правьте модули, а не этот файл.\n"


def build():
    parts = sorted(SRC.glob("*.js"))
    if not parts:
        raise SystemExit(f"нет модулей в {SRC}")
    out = [BANNER]
    for i, p in enumerate(parts):
        text = p.read_text(encoding="utf-8")
        if not text.endswith("\n"):
            text += "\n"
        if i:                                   # у первого модуля сначала идёт заголовок файла
            out.append(f"  // ═══════ {p.relative_to(ROOT).as_posix()}\n")
        out.append(text)
    return "".join(out)


def main():
    text = build()
    if "--check" in sys.argv:
        if OUT.read_text(encoding="utf-8") != text:
            raise SystemExit("app.js не совпадает с src/app/*.js — запустите python3 tools/build_app.py")
        print("app.js собран из текущих модулей")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"app.js: {text.count(chr(10))} строк из {len(sorted(SRC.glob('*.js')))} модулей")


if __name__ == "__main__":
    main()
