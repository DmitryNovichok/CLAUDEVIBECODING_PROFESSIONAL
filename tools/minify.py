#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сжатые копии скриптов и стилей сайта для посетителей: min/<имя>.

Сервер (server.py, MIN_FILES) отдаёт их вместо исходников: без комментариев и пробелов, внутренние имена
функций и переменных заменены короткими. Исходники в репозитории остаются читаемыми — правьте их, затем:

    python3 tools/minify.py          # пересобрать min/
    python3 tools/minify.py --check  # проверить, что min/ собран из текущих файлов (CI)

Нужен esbuild: берётся из arduino/source/node_modules (npm ci --ignore-scripts в arduino/source) или из PATH.
Код в браузере нельзя скрыть полностью — браузер должен его выполнить. Сжатие лишь делает копирование
и разбор заметно труднее; ответы, ключи и проверка остаются только на сервере.
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "min"
BANNER = ("/* © Egeshka (egeshka.online). Все права защищены. Копирование, переработка и использование кода "
          "без письменного разрешения правообладателя запрещены. */")


def files():
    import ast
    src = (ROOT / "server.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in tree.body:                      # список — из server.py, чтобы сервер и сборка не разошлись
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "MIN_FILES" for t in node.targets):
            return list(ast.literal_eval(node.value))
    raise SystemExit("в server.py нет MIN_FILES")


def esbuild():
    local = ROOT / "arduino" / "source" / "node_modules" / ".bin" / "esbuild"
    if local.exists():
        return str(local)
    found = shutil.which("esbuild")
    if found:
        return found
    raise SystemExit("нет esbuild: выполните  cd arduino/source && npm ci --ignore-scripts")


def build(dest):
    exe = esbuild()
    dest.mkdir(parents=True, exist_ok=True)
    for name in files():
        src = ROOT / name
        if not src.is_file():
            raise SystemExit(f"нет файла {name}")
        out = dest / name
        subprocess.run([exe, str(src), "--minify", "--legal-comments=none", "--charset=utf8", "--log-level=warning",
                        "--target=es2020" if name.endswith(".js") else "--target=chrome90,firefox88,safari14",
                        f"--banner:{'js' if name.endswith('.js') else 'css'}={BANNER}", f"--outfile={out}"], check=True)
    for extra in dest.iterdir():                # лишнее (файл убрали из MIN_FILES) — удаляем, чтобы сервер его не отдавал
        if extra.name not in files():
            extra.unlink()


def main():
    if "--check" in sys.argv:
        with tempfile.TemporaryDirectory() as tmp:
            build(Path(tmp))
            bad = [n for n in files() if not (OUT / n).is_file() or (OUT / n).read_bytes() != (Path(tmp) / n).read_bytes()]
        if bad:
            raise SystemExit("min/ устарел: " + ", ".join(bad) + " — запустите python3 tools/minify.py")
        print("min/ собран из текущих файлов")
        return
    build(OUT)
    print("min/: " + ", ".join(f"{n} {(OUT / n).stat().st_size // 1024} КБ" for n in files()))


if __name__ == "__main__":
    main()
