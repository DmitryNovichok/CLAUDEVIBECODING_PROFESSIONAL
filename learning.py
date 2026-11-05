"""Нормализация и оценивание учебных ответов."""
import re
ALT_RE = re.compile(r"\s+или\s+", re.I)

def clean_ans(a):
    """Ответ из банка: в КомпЕГЭ перенос строки иногда записан двумя символами «\\n» — делаем настоящим.
    Иначе у №25 и 27 форма ответа строилась неверно, а верный ответ не засчитывался."""
    if not isinstance(a, str):
        return a
    return a.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "").replace("\r\n", "\n").strip()


def tokens(s):
    s = str(s or "").replace("\\n", " ").lower().replace("ё", "е")
    s = re.sub("[−–—]", "-", s)
    return [x for x in re.split(r"[\s;|,]+", s) if x]


def alternatives(ans):
    return [x for x in ALT_RE.split(str(ans or "")) if x.strip()] or [str(ans or "")]


def shape_of(ans, n=None):
    if n == 25 and len(tokens(alternatives(ans)[0])) > 1:
        return {"type": "grid", "rows": 10, "cols": 2}     # №25 на ЕГЭ — всегда таблица 10 × 2
    rows = [tokens(r) for r in alternatives(ans)[0].split("\n")]
    rows = [r for r in rows if r]
    total = sum(len(r) for r in rows)
    if total <= 1:
        return {"type": "single"}
    cols = max(len(r) for r in rows)
    nr = len(rows)
    if nr >= 3:
        nr = max(nr, 10)
    return {"type": "grid", "rows": nr, "cols": cols}


def ege_points(n):
    return 2 if (n or 0) >= 26 else 1


def answer_credit(n, expected, answer, cells=None):
    """1 — верно, 0 — неверно. У №26 и 27 ответ из двух половин (два числа или две пары):
    верна ровно одна половина — 0.5, на экзамене это 1 балл из 2. «A или B» — верен любой."""
    return max(_credit(n, alt, answer, cells) for alt in alternatives(expected))


def _credit(n, expected, answer, cells=None):
    a = tokens(expected)
    b = tokens(answer)
    if a and a == b:
        return 1.0
    if (n or 0) < 26 or len(a) < 2 or len(a) % 2:
        return 0.0
    if cells is not None and len(cells) == len(a):       # пустые ячейки сохраняют позиции чисел
        b = [(tokens(c) or [""])[0] for c in cells]
    if len(b) != len(a):
        return 0.0
    h = len(a) // 2
    return ((a[:h] == b[:h]) + (a[h:] == b[h:])) / 2
