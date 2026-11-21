#!/usr/bin/env python3
"""Спокойное оформление рабочей зоны (по правилам U17–U20 скилла unslop-ui, см. .unslop-ui/taste.md).

Рабочая зона — экраны, где решают: задание, окно Python, варианты, курс, история (#trainer и #pyDock), кроме главной
(body.hub-on) и турниров/дуэлей (#trainer с .tour-page). Игровые окна — подарки, профиль, рейтинг — открываются в #forecastModal
и сюда не попадают.

Скрипт читает style.css и дописывает в конец блок между маркерами: для каждого правила с «тяжёлым» оформлением —
такое же правило внутри рабочей зоны с исправленным значением. Исходные правила не меняются, поэтому откатить —
удалить блок. Запуск: python3 tools/calm_css.py (повторный запуск заменяет блок), --check — только проверить.

  U19 font-weight 800/900 (и в сокращении font: 900 …) → 600
  U17 цветной градиент              → сплошной цвет (первый цвет градиента); прогресс (conic, var(--…), calc) не трогаем
  U17 цветное свечение 0 0 Npx      → убрано (остальные тени остаются)
  U17 text-shadow                   → none
  U20 transition: all               → только цвет, фон, рамка, тень, прозрачность, сдвиг
  U20 :hover … scale(>1)            → без увеличения
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "style.css"
BEGIN = "/* >>> calm-work-zone: сгенерировано tools/calm_css.py — не править руками */"
END = "/* <<< calm-work-zone */"
SCOPE = "body:not(.hub-on) :is(#trainer:not(:has(.tour-page)), #pyDock)"
TRANSITION = "color .15s ease-out, background-color .15s ease-out, border-color .15s ease-out, box-shadow .15s ease-out, opacity .15s ease-out, transform .15s ease-out"
COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|var\(--[\w-]+\)")


def strip_comments(text):
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def parse(text):
    """[(prelude, body_or_children)]: правило — строка тела, @media/@supports — список вложенных."""
    out, i, n = [], 0, len(text)
    while i < n:
        j = text.find("{", i)
        if j < 0:
            break
        prelude = text[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            depth += {"{": 1, "}": -1}.get(text[k], 0)
            k += 1
        body = text[j + 1:k - 1]
        if prelude.startswith("@media") or prelude.startswith("@supports"):
            out.append((prelude, parse(body)))
        elif not prelude.startswith("@"):
            out.append((prelude, body))
        i = k
    return out


def split_top(value, sep=","):
    """Разбить по запятым верхнего уровня (не внутри скобок)."""
    parts, depth, cur = [], 0, ""
    for ch in value:
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def decls(body):
    for d in split_top(body, ";"):
        if ":" in d:
            k, v = d.split(":", 1)
            yield k.strip().lower(), v.strip()


def neutral(color):
    m = re.match(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", color)
    return bool(m) and max(map(int, m.groups())) - min(map(int, m.groups())) < 16


def fixes(selector, body):
    out = []
    for k, v in decls(body):
        imp = " !important" if "!important" in v else ""
        if (k == "font-weight" and re.match(r"(800|900)\b", v)) or (k == "font" and re.search(r"(^|\s)(800|900)(\s|$)", v)):
            out.append(f"font-weight: 600{imp}")
        elif k in ("background", "background-image") and re.search(r"(?<!repeating-)(linear|radial)-gradient\(", v) \
                and not re.search(r"conic-gradient|var\(--p|calc\(|url\(", v):
            colors = COLOR.findall(v)
            if colors and not all(neutral(c) for c in colors):
                out.append("background-image: none" + imp)
                out.append(f"background-color: {colors[0]}{imp}")
        elif k == "box-shadow" and v != "none":
            parts = split_top(v.replace("!important", ""))
            keep = [p for p in parts if not (re.match(r"(inset\s+)?0(px)?\s+0(px)?\s+[1-9]\d*px", p) and not
                                            all(neutral(c) for c in COLOR.findall(p) or ["rgb(0,0,0)"]))]
            if len(keep) != len(parts):
                out.append(f"box-shadow: {', '.join(keep) or 'none'}{imp}")
        elif k == "text-shadow" and v != "none":
            out.append("text-shadow: none" + imp)
        elif k == "transition" and re.search(r"(^|,|\s)all(\s|,|$)", v):
            out.append(f"transition: {TRANSITION}{imp}")
        elif k == "transform" and ":hover" in selector and re.search(r"scale\(\s*1\.(0[3-9]|[1-9])", v):
            out.append("transform: none" + imp)
    return out


def scoped(selector):
    sels = [s for s in split_top(selector) if not re.match(r"(html|body|:root)\b", s)]
    return ",\n".join(f"{SCOPE} {s}" for s in sels)


def render(rules, indent=""):
    lines = []
    for prelude, body in rules:
        if isinstance(body, list):
            inner = render(body, indent + "  ")
            if inner:
                lines += [f"{indent}{prelude} {{", *inner, f"{indent}}}"]
            continue
        f = fixes(prelude, body)
        sel = scoped(prelude)
        if f and sel:
            lines.append(f"{indent}{sel} {{ {'; '.join(f)}; }}")
    return lines


def build(css):
    base = css.split(BEGIN)[0].rstrip() + "\n"
    block = render(parse(strip_comments(base)))
    return base + "\n" + BEGIN + "\n" + "\n".join(block) + "\n" + END + "\n", len(block)


def main():
    css = CSS.read_text(encoding="utf-8")
    new, n = build(css)
    if "--check" in sys.argv:
        if new != css:
            print("style.css: блок calm-work-zone устарел — запустите python3 tools/calm_css.py")
            sys.exit(1)
        print(f"calm-work-zone актуален ({n} правил)")
        return
    CSS.write_text(new, encoding="utf-8")
    print(f"calm-work-zone: {n} правил")


if __name__ == "__main__":
    main()
