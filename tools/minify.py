#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сжатые копии скриптов и стилей сайта для посетителей: min/<имя>.

Сервер (server.py, MIN_FILES) отдаёт их вместо исходников: без комментариев и пробелов, внутренние имена
функций и переменных заменены короткими. Исходники в репозитории остаются читаемыми — правьте их, затем:

    python3 tools/minify.py          # пересобрать min/
    python3 tools/minify.py --check  # проверить, что min/ собран из текущих файлов (CI)

Нужны esbuild (arduino/source/node_modules или PATH) и обфускатор скриптов (tools/obfuscate: npm ci --ignore-scripts).
Скрипты после сжатия обфусцируются: строки в зашифрованном массиве, имена — шестнадцатеричные, код привязан
к домену egeshka.online (а также localhost для разработки).
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
from tools.check_release import asset_names, write_manifest
OUT = ROOT / "min"
BANNER = ("/* © Egeshka (egeshka.online). Все права защищены. Копирование, переработка и использование кода "
          "без письменного разрешения правообладателя запрещены. */")


def files():
    return asset_names(ROOT)


def esbuild():
    local = ROOT / "arduino" / "source" / "node_modules" / ".bin" / "esbuild"
    if local.exists():
        return str(local)
    found = shutil.which("esbuild")
    if found:
        return found
    raise SystemExit("нет esbuild: выполните  cd arduino/source && npm ci --ignore-scripts")


OBF = ROOT / "tools" / "obfuscate"


def obfuscator():
    if not (OBF / "node_modules" / "javascript-obfuscator").is_dir():
        raise SystemExit("нет обфускатора: выполните  cd tools/obfuscate && npm ci --ignore-scripts")
    return ["node", str(OBF / "run.cjs")]


MAPS = ROOT / "maps"                            # таблицы мест для вкладки «Ошибки» — только на сервере, не отдаются


def build(dest, maps=MAPS):
    import json
    from tools import sourcemap
    exe, obf = esbuild(), obfuscator()
    dest.mkdir(parents=True, exist_ok=True)
    maps.mkdir(parents=True, exist_ok=True)
    for name in files():
        src = ROOT / name
        if not src.is_file():
            raise SystemExit(f"нет файла {name}")
        out = dest / name
        js = name.endswith(".js")
        subprocess.run([exe, str(src), "--minify", "--legal-comments=none", "--charset=utf8", "--log-level=warning",
                        "--target=es2020" if js else "--target=chrome90,firefox88,safari14", f"--outfile={out}"]
                       + (["--sourcemap=external"] if js else []), check=True)
        if js:                                  # скрипты — ещё и обфускация: зашифрованные строки, привязка к домену
            m1, m2 = Path(str(out) + ".map"), Path(str(out) + ".obf.map")
            subprocess.run(obf + [str(out), str(out), str(m2)], check=True)
            table = sourcemap.compose(json.loads(m1.read_text(encoding="utf-8")), json.loads(m2.read_text(encoding="utf-8")),
                                      shift=1)  # строка 1 — баннер с правами
            (maps / (name + ".json")).write_text(sourcemap.dump(table), encoding="utf-8")
            m1.unlink()
            m2.unlink()
        out.write_text(BANNER + "\n" + out.read_text(encoding="utf-8"), encoding="utf-8")
    for extra in dest.iterdir():                # лишнее (файл убрали из MIN_FILES) — удаляем, чтобы сервер его не отдавал
        if extra.name not in files():
            extra.unlink()
    for extra in maps.iterdir():
        if extra.name[:-5] not in files():
            extra.unlink()
    write_manifest(ROOT, dest)


def main():
    if "--check" in sys.argv:
        with tempfile.TemporaryDirectory() as tmp:
            build(Path(tmp) / "min", Path(tmp) / "maps")
            bad = [n for n in files() + ['manifest.json'] if not (OUT / n).is_file() or (OUT / n).read_bytes() != (Path(tmp) / "min" / n).read_bytes()]
            bad += ["maps/" + p.name for p in (Path(tmp) / "maps").iterdir()
                    if not (MAPS / p.name).is_file() or (MAPS / p.name).read_bytes() != p.read_bytes()]
        if bad:
            raise SystemExit("min/ устарел: " + ", ".join(bad) + " — запустите python3 tools/minify.py")
        print("min/ собран из текущих файлов")
        return
    build(OUT)
    print("min/: " + ", ".join(f"{n} {(OUT / n).stat().st_size // 1024} КБ" for n in files()))


if __name__ == "__main__":
    main()
