# -*- coding: utf-8 -*-
"""Карты соответствия (source maps) для вкладки «Ошибки».

Посетитель получает сжатый и обфусцированный код (min/), где вся программа — в одной строке. Чтобы ошибка из браузера
показывала строку исходника, при сборке две карты (esbuild: исходник → сжатый код; обфускатор: сжатый → отданный)
сводятся в одну компактную таблицу maps/<имя>.json: для каждой строки отданного файла — пары «колонка, строка исходника».
Таблицы лежат вне min/ и посетителям не отдаются (сервер раздаёт только явно разрешённые файлы).
"""
import bisect
import json

_B64 = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}


def _vlq(seg):
    out, val, shift = [], 0, 0
    for ch in seg:
        d = _B64[ch]
        val += (d & 31) << shift
        if d & 32:
            shift += 5
            continue
        out.append(-(val >> 1) if val & 1 else val >> 1)
        val, shift = 0, 0
    return out


def decode(mappings):
    """mappings карты → по строкам отданного кода списки (колонка, строка исходника); всё с нуля."""
    lines, src_line = [], 0
    for text in mappings.split(";"):
        row, col = [], 0
        for seg in text.split(","):
            if not seg:
                continue
            v = _vlq(seg)
            col += v[0]
            if len(v) >= 4:
                src_line += v[2]
                row.append((col, src_line))
        lines.append(row)
    return lines


def _find(table, line, col):
    """Строка исходника для позиции (line, col) по таблице decode(); None — позиции нет в карте."""
    if not 0 <= line < len(table) or not table[line]:
        return None
    row = table[line]
    i = bisect.bisect_right([c for c, _ in row], col) - 1
    return row[max(i, 0)][1]


def compose(first, second, shift=0):
    """first: исходник → промежуточный код, second: промежуточный → отданный (обе — dict карты).
    → {"lines": [[колонка, строка исходника, колонка, строка, …], …]} для отданного кода; shift — строк сверху (баннер)."""
    a = decode(first["mappings"])                            # промежуточный код (строка, колонка) → строка исходника
    result = [[] for _ in range(shift)]
    for row in _decode_full(second["mappings"]):             # отданный код → (строка, колонка) промежуточного
        packed, last = [], None
        for col, mid_line, mid_col in row:
            src = _find(a, mid_line, mid_col)
            if src is None or src == last:                   # подряд та же строка исходника — одна точка
                continue
            packed += [col, src]
            last = src
        result.append(packed)
    return {"version": 1, "lines": result}


def single(first, shift=0):
    """Только одна карта (исходник → отданный код)."""
    result = [[] for _ in range(shift)]
    for row in _decode_full(first["mappings"]):
        packed, last = [], None
        for col, src, _sc in row:
            if src == last:
                continue
            packed += [col, src]
            last = src
        result.append(packed)
    return {"version": 1, "lines": result}


def _decode_full(mappings):
    """Как decode(), но с колонкой исходника: (колонка, строка исходника, колонка исходника)."""
    lines, src_line, src_col = [], 0, 0
    for text in mappings.split(";"):
        row, col = [], 0
        for seg in text.split(","):
            if not seg:
                continue
            v = _vlq(seg)
            col += v[0]
            if len(v) >= 4:
                src_line += v[2]
                src_col += v[3]
                row.append((col, src_line, src_col))
        lines.append(row)
    return lines


def lookup(table, line, col):
    """table — содержимое maps/<имя>.json; line, col — как в браузере (с единицы). → строка исходника с единицы или None."""
    rows = table.get("lines") or []
    i = line - 1
    if not 0 <= i < len(rows) or not rows[i]:
        return None
    flat = rows[i]
    cols = flat[0::2]
    k = bisect.bisect_right(cols, col - 1) - 1
    return flat[2 * max(k, 0) + 1] + 1


def dump(table):
    return json.dumps(table, separators=(",", ":")) + "\n"
