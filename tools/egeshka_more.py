# -*- coding: utf-8 -*-
"""
Банк «Egeshka», вторая волна: ещё по 30 заданий на каждый номер 1–23 (19–21 — одна игра на три вопроса).

Как и в gen_egeshka.py, ответ не придумывается, а вычисляется перебором. Кроме того, у каждого задания
№6–23 есть решение на Python (оно же показывается ученику как разбор): tools/egeshka_check.py запускает
эти решения на файлах к заданиям и сверяет вывод с ответом — так ловятся ошибки и в генераторе, и в решении.

Запускается из gen_egeshka.main(): первые 50 заданий (№1–5 по 10) не меняются, у каждого номера — свой
генератор случайных чисел с фиксированным сидом, поэтому повторный запуск даёт те же задания.
"""
import html
import itertools
import math
import random
from fractions import Fraction

import gen_egeshka as G
from gen_egeshka import zput

PER = 30
SEED = 20261104
LV = {1: "Простая", 2: "Средняя", 3: "Сложная"}


class Dup(Exception):
    """Такое задание уже есть в банке ФИПИ / КомпЕГЭ / «Банк ЕГЭ» или в этом же наборе — генерируем другое."""


_BANK = None
_SEEN_TEXT = set()


def _plain(h):
    import re
    h = re.sub(r"<[^>]+>", " ", h or "")
    return re.sub(r"\s+", " ", html.unescape(h)).strip()


def _sig(p):
    """Числа и слова заглавными (буквы алфавита, слово для перестановок, ВОЛНА…) — то, чем задания одного шаблона различаются."""
    import re
    return tuple(sorted(re.findall(r"\d+|\b[A-ZА-ЯЁ]{2,}\b", p)))


def _words(p):
    import re
    return frozenset(re.findall(r"[a-zа-яё]+", p.lower())) | frozenset("~" + c for c in re.findall(r"\b[A-ZА-ЯЁ]\b", p))


def bank_index():
    global _BANK
    if _BANK is None:
        import json
        _BANK = {}
        f = G.ROOT / "data" / "bank.js"
        if f.is_file():
            s = f.read_text(encoding="utf-8")
            for t in json.loads(s[s.index("{"):s.rindex("}") + 1])["tasks"]:
                p = _plain(t["html"])
                _BANK.setdefault((t["n"], _sig(p)), []).append(_words(p))
    return _BANK


def is_dup(n, body):
    """Те же числа в условии того же номера, что и у задания из банка (или уже сгенерированного) — дубль."""
    p = _plain(body)
    key = (n, _sig(p))
    w = _words(p)
    for q in bank_index().get(key, []):
        if len(w & q) >= 0.75 * len(w | q):         # те же числа и почти те же слова
            return True
    bank_index().setdefault(key, []).append(w)
    return False


def add(n, k, body, ans, topic, sol=None, att=None, lv=2, by_text=False):
    if by_text:                                # только нули и единицы — по числам не различить, сравниваем текст целиком
        if body in _SEEN_TEXT:
            raise Dup()
        _SEEN_TEXT.add(body)
    elif not att and is_dup(n, body):            # у заданий с файлом текст может совпадать — различаются данные
        raise Dup()
    G.add(n, k, body, ans, topic, sol, att)
    G.TASKS[-1]["lv"] = LV[lv]
    G.TASKS[-1]["dt"] = "2026-11-04"


def code(src):
    return G.code_block(src)


def media(n):
    d = G.MEDIA / str(n)
    d.mkdir(parents=True, exist_ok=True)
    return d


def esc(s):
    return html.escape(str(s))


# ============================================================ №6 — Черепаха
TURTLE_HEAD = (
    "<p>Исполнитель Черепаха действует на плоскости с декартовой системой координат. В начальный момент Черепаха "
    "находится в начале координат, её голова направлена вдоль положительного направления оси ординат, хвост опущен. "
    "При опущенном хвосте Черепаха оставляет на поле след в виде линии. В каждый конкретный момент известно "
    "положение исполнителя и направление его движения. У исполнителя существует {cnt} команд{ending}: "
    "<b>Вперёд n</b> (где n — целое число), вызывающая передвижение Черепахи на n единиц в том направлении, "
    "куда указывает её голова; <b>Направо m</b> (где m — целое число), вызывающая изменение направления движения "
    "на m градусов по часовой стрелке{extra}.</p>"
    "<p>Запись <b>Повтори k [Команда1 Команда2 … КомандаS]</b> означает, что последовательность из S команд "
    "повторится k раз.</p>")
TURTLE_EXTRA = ("; <b>Налево m</b> — поворот на m градусов против часовой стрелки; <b>Поднять хвост</b> — "
                "Черепаха перестаёт оставлять след; <b>Опустить хвост</b> — снова оставляет след")


def t_text(prog):
    out = []
    for c in prog:
        if c[0] == "F":
            out.append(f"Вперёд {c[1]}")
        elif c[0] == "R":
            out.append(f"Направо {c[1]}")
        elif c[0] == "L":
            out.append(f"Налево {c[1]}")
        elif c[0] == "U":
            out.append("Поднять хвост")
        elif c[0] == "D":
            out.append("Опустить хвост")
        else:
            out.append(f"Повтори {c[1]} [{t_text(c[2])}]")
    return " ".join(out)


def t_py(prog, ind="", out=None):
    out = [] if out is None else out
    for c in prog:
        if c[0] == "F":
            out.append(f"{ind}fd({c[1]})")
        elif c[0] == "R":
            out.append(f"{ind}rt({c[1]})")
        elif c[0] == "L":
            out.append(f"{ind}rt({-c[1]})")
        elif c[0] == "U":
            out.append(f"{ind}up()")
        elif c[0] == "D":
            out.append(f"{ind}down()")
        else:
            out.append(f"{ind}for _ in range({c[1]}):")
            t_py(c[2], ind + "    ", out)
    return out


def t_run(prog):
    """Отрезки следа по фигурам: каждая фигура — список вершин (ломаная при опущенном хвосте)."""
    st = {"x": 0.0, "y": 0.0, "a": 90.0, "pen": True}
    figs = [[(0.0, 0.0)]]

    def go(p):
        for c in p:
            if c[0] == "F":
                st["x"] += c[1] * math.cos(math.radians(st["a"]))
                st["y"] += c[1] * math.sin(math.radians(st["a"]))
                pt = (round(st["x"], 9), round(st["y"], 9))
                if st["pen"]:
                    figs[-1].append(pt)
                elif figs[-1] and len(figs[-1]) == 1:
                    figs[-1][0] = pt
            elif c[0] == "R":
                st["a"] -= c[1]
            elif c[0] == "L":
                st["a"] += c[1]
            elif c[0] == "U":
                st["pen"] = False
            elif c[0] == "D":
                st["pen"] = True
                figs.append([(round(st["x"], 9), round(st["y"], 9))])
            else:
                for _ in range(c[1]):
                    go(c[2])
    go(prog)
    polys = []
    for f in figs:
        if len(f) < 3:
            continue
        s = f[0]
        for i in range(1, len(f)):
            if abs(f[i][0] - s[0]) < 1e-6 and abs(f[i][1] - s[1]) < 1e-6:
                polys.append(f[:i])
                break
        else:
            return None                          # фигура не замкнулась
    return polys


def on_seg(px, py, a, b):
    (x1, y1), (x2, y2) = a, b
    cr = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
    L = math.hypot(x2 - x1, y2 - y1)
    if abs(cr) / L > 1e-7:
        return False
    return min(x1, x2) - 1e-7 <= px <= max(x1, x2) + 1e-7 and min(y1, y2) - 1e-7 <= py <= max(y1, y2) + 1e-7


def where(px, py, poly):
    """1 — внутри, 0 — на линии, -1 — снаружи."""
    n = len(poly)
    for i in range(n):
        if on_seg(px, py, poly[i], poly[(i + 1) % n]):
            return 0
    ins = False
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            xc = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if xc > px:
                ins = not ins
    return 1 if ins else -1


def box(polys):
    xs = [p[0] for q in polys for p in q]
    ys = [p[1] for q in polys for p in q]
    return math.floor(min(xs)) - 1, math.ceil(max(xs)) + 1, math.floor(min(ys)) - 1, math.ceil(max(ys)) + 1


T6_SOL = """import math
pts, x, y, a, pen = [], 0.0, 0.0, 90.0, True
figs = [[(0.0, 0.0)]]
def fd(n):
    global x, y
    x = round(x + n * math.cos(math.radians(a)), 9); y = round(y + n * math.sin(math.radians(a)), 9)
    if pen: figs[-1].append((x, y))
def rt(m):
    global a
    a -= m
def up():
    global pen
    pen = False
def down():
    global pen
    pen = True; figs.append([(x, y)])

{prog}

def where(px, py, f):          # 1 — внутри, 0 — на линии, -1 — снаружи
    ins = False
    for (x1, y1), (x2, y2) in zip(f, f[1:]):
        cr = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
        if abs(cr) < 1e-6 * math.hypot(x2 - x1, y2 - y1) and min(x1, x2) - 1e-6 <= px <= max(x1, x2) + 1e-6 \\
                and min(y1, y2) - 1e-6 <= py <= max(y1, y2) + 1e-6:
            return 0
        if (y1 > py) != (y2 > py) and x1 + (py - y1) * (x2 - x1) / (y2 - y1) > px:
            ins = not ins
    return 1 if ins else -1

def cut(f):                     # фигура обведена несколько раз — берём один обход
    for i in range(1, len(f)):
        if abs(f[i][0] - f[0][0]) < 1e-6 and abs(f[i][1] - f[0][1]) < 1e-6:
            return f[:i + 1]
    return f

figs = [cut(f) for f in figs if len(f) > 2]
cnt = 0
for px in range(-100, 101):
    for py in range(-100, 101):
        w = [where(px, py, f) for f in figs]
        if {cond}:
            cnt += 1
print(cnt)"""


def gen6(R, k):
    kind = k % 5
    while True:
        a, b = R.randint(6, 19), R.randint(6, 19)
        if kind == 0:     # треугольник / шестиугольник / ромб
            fam = R.choice(["tri", "hex", "rhomb", "par"])
            if fam == "tri":
                prog = [("REP", R.choice([3, 5, 6, 7, 9]), [("F", a), ("R", 120)])]
            elif fam == "hex":
                prog = [("REP", R.choice([6, 7, 9, 12]), [("F", R.randint(5, 11)), ("R", 60)])]
            elif fam == "rhomb":
                prog = [("R", 45), ("REP", R.choice([4, 6, 8]), [("F", a), ("R", 90)])]
            else:
                prog = [("REP", 2, [("F", a), ("R", R.choice([45, 135, 60, 120])), ("F", b),
                                    ("R", None)])]
                prog[0][2][3] = ("R", 180 - prog[0][2][1][1])
            strict = R.random() < 0.6
        elif kind == 1:   # как в ФИПИ: повороты по 45 внутри повтора
            n1 = R.choice([3, 5, 7])
            prog = [("R", 90 if R.random() < 0.5 else 45), ("REP", n1, [("R", 45), ("F", a), ("R", 45)])]
            if n1 == 3:
                prog = [("R", 45), ("REP", 3, [("R", 45), ("F", a), ("R", 45)]), ("R", 315), ("F", a), ("R", 90),
                        ("F", 2 * a), ("R", 90), ("REP", 2, [("F", a), ("R", 90)])]
            strict = True
        elif kind == 2:   # прямоугольник со «ступенькой»
            c, d = R.randint(2, a - 2), R.randint(2, b - 2)
            prog = [("F", a), ("R", 90), ("F", b), ("R", 90), ("F", c), ("R", 90), ("F", d), ("L", 90),
                    ("F", a - c), ("R", 90), ("F", b - d), ("R", 90)]
            strict = R.random() < 0.5
        else:             # две фигуры: пересечение или объединение
            c, d = R.randint(6, 19), R.randint(6, 19)
            sx, sy = R.randint(2, a - 2), R.randint(2, b - 2)
            rect = lambda p, q: ("REP", 2, [("F", p), ("R", 90), ("F", q), ("R", 90)])
            prog = [rect(a, b), ("U",), ("F", sx), ("R", 90), ("F", sy), ("L", 90), ("D",), rect(c, d)]
            strict = None
        polys = t_run(prog)
        if not polys:
            continue
        x0, x1, y0, y1 = box(polys)
        cnt = 0
        if kind >= 3:
            op = "inter" if kind == 3 else "union"
            incl = R.random() < 0.6
            for px in range(x0, x1 + 1):
                for py in range(y0, y1 + 1):
                    w = [where(px, py, p) for p in polys]
                    ok = (all(v >= 0 for v in w) if incl else all(v > 0 for v in w)) if op == "inter" else \
                        (any(v >= 0 for v in w) if incl else (any(v > 0 for v in w) and not any(v == 0 for v in w)))
                    cnt += ok
            if op == "inter":
                q = ("Определите, сколько точек с целочисленными координатами будут находиться внутри пересечения фигур, "
                     "ограниченных заданными алгоритмом линиями, " + ("включая точки на границах этого пересечения." if incl
                                                                       else "не включая точки на линиях."))
                cond = "all(v >= 0 for v in w)" if incl else "all(v > 0 for v in w)"
            else:
                q = ("Определите, сколько точек с целочисленными координатами будут находиться внутри объединения фигур, "
                     "ограниченных заданными алгоритмом линиями, " + ("включая точки на границах." if incl
                                                                       else "не включая точки на линиях."))
                cond = "any(v >= 0 for v in w)" if incl else "any(v > 0 for v in w) and 0 not in w"
        else:
            if len(polys) != 1:
                continue
            for px in range(x0, x1 + 1):
                for py in range(y0, y1 + 1):
                    v = where(px, py, polys[0])
                    cnt += v > 0 if strict else v >= 0
            q = ("Определите, сколько точек с целочисленными координатами находятся внутри области, которая ограничена "
                 "линией, заданной данным алгоритмом. " + ("Точки на линии учитывать не следует." if strict
                                                           else "Точки на линии следует учитывать."))
            cond = "w[0] > 0" if strict else "w[0] >= 0"
        if cnt > 5 and max(abs(v) for v in (x0, x1, y0, y1)) < 95:
            break
    two = any(c[0] in "LUD" for c in prog)
    body = (TURTLE_HEAD.format(cnt="пять" if two else "две", ending="" if two else "ы", extra=TURTLE_EXTRA if two else "")
            + f"<p>Черепахе был дан для исполнения следующий алгоритм:</p><p><b>{t_text(prog)}</b></p><p>{q}</p>")
    sol = code(T6_SOL.replace("{prog}", "\n".join(t_py(prog))).replace("{cond}", cond))
    add(6, k, body, cnt, "Черепашка", sol, lv=3 if kind in (1, 3, 4) else 2)


# ============================================================ №7 — изображения, звук, передача
def raz(n):
    return f"в {n} раз" + ("а" if n in (2, 3, 4) else "")


def kb_round(bits):
    return math.ceil(bits / 8 / 1024)


def gen7(R, k):
    kind = k % 6
    while True:
        if kind == 0:     # объём изображения
            w, h = R.choice([(640, 480), (800, 600), (1024, 768), (1280, 1024), (512, 512), (1024, 512), (2048, 1536),
                             (320, 240), (1600, 1200), (256, 128)])
            colors = R.choice([16, 64, 256, 1024, 4096, 65536, 100, 200, 1000, 3000, 30])
            bits = math.ceil(math.log2(colors))
            ans = kb_round(w * h * bits)
            q = (f"Какой минимальный объём памяти (в Кбайт) нужно зарезервировать, чтобы можно было сохранить любое "
                 f"растровое изображение размером {w}×{h} пикселей при условии, что в изображении могут использоваться "
                 f"{colors} различных цветов? В ответе запишите только целое число, единицу измерения писать не нужно.")
            sol = f"import math\nbits = math.ceil(math.log2({colors}))\nprint(math.ceil({w} * {h} * bits / 8 / 1024))"
            lv = 1
        elif kind == 1:   # наибольшее число цветов
            w, h = R.choice([(640, 480), (800, 600), (1024, 768), (512, 512), (1024, 512), (256, 256), (320, 240)])
            bits = R.randint(3, 16)
            mem = math.ceil(w * h * bits / 8 / 1024) + R.randint(0, max(1, w * h // 8 // 1024 // 2))
            ans_bits = mem * 1024 * 8 // (w * h)
            ans = 2 ** ans_bits
            q = (f"Для хранения произвольного растрового изображения размером {w}×{h} пикселей отведено {mem} Кбайт "
                 "памяти без учёта размера заголовка файла. Для кодирования цвета каждого пикселя используется одинаковое "
                 "количество бит, коды пикселей записываются в файл один за другим без промежутков. Какое максимальное "
                 "количество цветов можно использовать в изображении?")
            sol = f"bits = {mem} * 1024 * 8 // ({w} * {h})\nprint(2 ** bits)"
            lv = 2
        elif kind == 2:   # фотокамера: серия снимков
            w, h = R.choice([(1024, 768), (1280, 960), (640, 480), (2048, 1536), (1600, 1200), (800, 600)])
            colors = R.choice([256, 4096, 65536, 1024, 2 ** 24])
            bits = int(math.log2(colors))
            per = R.choice([10, 15, 20, 30, 60])
            hours = R.choice([1, 2, 3, 4, 6])
            total = w * h * bits * (hours * 3600 // per)
            ans = math.ceil(total / 8 / 2 ** 20)
            q = (f"Автоматическая фотокамера каждые {per} с создаёт растровое изображение размером {w}×{h} пикселей, "
                 f"содержащее {colors} цветов. Коды цветов пикселей записываются без сжатия и без дополнительной информации. "
                 + (f"Каждые {hours} ч" if hours > 1 else "Каждый час") + " все снимки за этот период переписываются на сервер. Какой минимальный объём памяти "
                 "(в Мбайт) нужно отвести на сервере под один такой набор снимков? В ответе запишите только целое число.")
            sol = (f"import math\nn = {hours} * 3600 // {per}\nprint(math.ceil(n * {w} * {h} * {bits} / 8 / 2 ** 20))")
            lv = 2
        elif kind == 3:   # оцифровка звука
            ch, chw = R.choice([(1, "моно (одноканальная)"), (2, "стерео (двухканальная)"), (4, "квадро (четырёхканальная)")])
            f = R.choice([8, 11, 16, 22, 24, 32, 44, 48])
            bits = R.choice([8, 16, 24, 32])
            mins = R.choice([1, 2, 3, 4, 5, 8, 10])
            size = ch * f * 1000 * bits * mins * 60 / 8 / 2 ** 20
            ans = round(size)
            if abs(size - ans) > 0.45 or ans < 2:
                continue
            q = (f"Производится {chw} звукозапись с частотой дискретизации {f} кГц и {bits}-битным разрешением. Запись "
                 f"длится {mins} мин, её результаты записываются в файл, сжатие данных не производится. Определите "
                 "приблизительно размер полученного файла (в Мбайт). В качестве ответа укажите ближайшее к размеру файла "
                 "целое число.")
            sol = f"size = {ch} * {f} * 1000 * {bits} * {mins} * 60 / 8 / 2 ** 20\nprint(round(size))"
            lv = 1
        elif kind == 4:   # повторная оцифровка и передача
            t1 = R.choice([12, 15, 16, 20, 24, 30, 36, 40, 45, 48, 60, 64, 72, 90, 96])
            r_up = R.choice([2, 3, 4])
            f_dn = R.choice([2, 3, 4, 1.5])
            ch = R.choice([1, 2])
            sp = R.choice([2, 3, 4, 6])
            ratio = Fraction(r_up) / Fraction(f_dn).limit_denominator(4) * (2 if ch == 2 else 1) * sp
            t2 = Fraction(t1) * ratio
            if t2.denominator != 1 or t2 > 1000:
                continue
            ans = int(t2)
            fd = {2: "в 2 раза", 3: "в 3 раза", 4: "в 4 раза", 1.5: "в 1,5 раза"}[f_dn]
            q = ("Музыкальный фрагмент был записан в формате " + ("моно" if ch == 1 else "моно") +
                 ", оцифрован и сохранён в виде файла без использования сжатия данных. Получившийся файл был передан в "
                 f"город А по каналу связи за {t1} секунд. Затем тот же музыкальный фрагмент был повторно записан в формате "
                 + ("моно" if ch == 1 else "стерео") +
                 f" и оцифрован с разрешением в {r_up} раза выше и частотой дискретизации {fd} меньше, чем в первый раз. "
                 f"Сжатие данных не производилось. Полученный файл был передан в город Б; пропускная способность канала "
                 f"связи с городом Б {raz(sp)} ниже, чем канала связи с городом А. Сколько секунд длилась передача файла "
                 "в город Б? В ответе запишите только целое число, единицу измерения писать не нужно.")
            sol = (f"from fractions import Fraction\nt = Fraction({t1}) * {r_up} / Fraction('{f_dn}') * {ch} * {sp}\n"
                   "print(t)")
            lv = 2
        else:             # архиватор или без сжатия
            mb = R.choice([10, 20, 25, 40, 50, 64, 80, 100])
            p = R.choice([20, 25, 40, 50, 60, 75, 80])
            tz, tu = R.randint(5, 25), R.randint(2, 10)
            sp = R.choice([2 ** 18, 2 ** 19, 2 ** 20, 2 ** 21, 2 ** 22, 2 ** 23])
            ta = Fraction(mb * 2 ** 23 * (100 - p), 100 * sp) + tz + tu
            tb = Fraction(mb * 2 ** 23, sp)
            d = ta - tb
            if d.denominator != 1 or d == 0 or abs(d) > 2000:
                continue
            ans = ("А" if ta < tb else "Б") + str(abs(int(d)))
            q = (f"Документ объёмом {mb} Мбайт можно передать с одного компьютера на другой двумя способами.<br>"
                 f"А. Сжать архиватором, передать архив по каналу связи, распаковать.<br>Б. Передать по каналу связи без "
                 f"использования архиватора.<br>Какой способ быстрее и насколько, если средняя скорость передачи данных по "
                 f"каналу связи составляет 2<sup>{int(math.log2(sp))}</sup> бит в секунду; объём сжатого архиватором "
                 f"документа равен {100 - p}% исходного; время, требуемое на сжатие документа, — {tz} секунд, на "
                 f"распаковку — {tu} секунд?</p><p>В ответе напишите букву А, если быстрее способ А, или Б, если быстрее "
                 f"способ Б. Сразу после буквы напишите число, обозначающее, на сколько секунд один способ быстрее "
                 f"другого. Так, например, если способ Б быстрее способа А на 23 секунды, в ответе нужно написать Б23. "
                 f"Единицы измерения «секунд», «сек.», «с» к ответу добавлять не нужно.")
            sol = (f"a = {mb} * 2 ** 23 * {100 - p} / 100 / 2 ** {int(math.log2(sp))} + {tz} + {tu}\n"
                   f"b = {mb} * 2 ** 23 / 2 ** {int(math.log2(sp))}\nprint(('А' if a < b else 'Б') + str(round(abs(a - b))))")
            lv = 2
        break
    topic = ["Кодирование изображений", "Кодирование изображений", "Кодирование изображений", "Кодирование звуков",
             "Кодирование звуков", "Архивирование и передача данных"][kind]
    add(7, k, f"<p>{q}</p>", ans, topic, code(sol), lv=lv)


# ============================================================ №8 — комбинаторика
NAMES = ["Петя", "Вася", "Маша", "Аня", "Игорь", "Оля", "Кирилл", "Даша", "Миша", "Света"]
WORDS = ["МАРТ", "КОРА", "ЛИСА", "ВОЛНА", "ПАРУС", "СОКОЛ", "ГРОЗА", "РАДУГА", "ВЕСНА", "КАТЕР", "ОКЕАН", "ТРОПА",
         "ЗЕБРА", "КОМЕТА", "ЛАМПА", "ГИТАРА", "РАКЕТА", "СЛОВАРЬ", "ДОРОГА", "МОСКВА"]
VOW = set("АЕЁИОУЫЭЮЯ")


def gen8(R, k):
    kind = k % 5
    while True:
        if kind == 0:     # список слов в алфавитном порядке
            lets = sorted(set(R.choice(WORDS)))[:R.choice([4, 5])]
            if len(lets) < 4:
                continue
            L = R.choice([4, 5]) if len(lets) == 4 else 4
            words = ["".join(p) for p in itertools.product(lets, repeat=L)]
            sub = R.randint(0, 2)
            if sub == 0:
                x = R.choice(lets[1:])
                ans = next(i for i, w in enumerate(words, 1) if w[0] == x)
                q = f"Под каким номером в списке идёт первое слово, которое начинается с буквы {x}?"
                tail = f"print(next(i for i, w in enumerate(words, 1) if w[0] == '{x}'))"
            elif sub == 1:
                N = R.randint(len(words) // 4, len(words) - 5)
                ans = words[N - 1]
                q = f"Какое слово стоит в списке под номером {N}?"
                tail = f"print(words[{N} - 1])"
            else:
                x, y = R.sample(lets, 2)
                cond = lambda w: w.count(x) == 0 and w[-1] != y
                xs = [i for i, w in enumerate(words, 1) if cond(w)]
                ans = xs[-1]
                q = (f"Под каким номером в списке стоит последнее слово, которое не содержит букву {x} и не "
                     f"заканчивается буквой {y}?")
                tail = f"print([i for i, w in enumerate(words, 1) if '{x}' not in w and w[-1] != '{y}'][-1])"
            nm = R.choice(NAMES)
            start = words[:4]
            q = (f"<p>{nm} составляет {L}-буквенные слова из букв {', '.join(lets)}. Каждая буква может встречаться в слове "
                 "любое количество раз (или не встречаться совсем). Все слова записаны в алфавитном порядке и "
                 "пронумерованы, начиная с 1. Ниже приведено начало списка.</p><p>"
                 + "<br>".join(f"{i}. {w}" for i, w in enumerate(start, 1)) + "<br>…</p>" + f"<p>{q}</p>")
            sol = (f"from itertools import product\nwords = [''.join(p) for p in product('{''.join(lets)}', repeat={L})]\n"
                   + tail)
            topic, lv = "Упорядоченный список", 1 + (sub > 0)
        elif kind == 1:   # слова с ограничениями
            w = R.choice(WORDS)
            lets = "".join(sorted(set(w)))
            L = R.choice([5, 6]) if len(lets) <= 5 else R.choice([4, 5])
            x = R.choice(lets)
            y = R.choice([c for c in lets if c != x])
            rules = R.sample([
                (f"буква {x} встречается ровно 1 раз", lambda s: s.count(x) == 1, f"s.count('{x}') == 1"),
                (f"слово не начинается с буквы {y}", lambda s: s[0] != y, f"s[0] != '{y}'"),
                ("никакие две гласные не стоят рядом",
                 lambda s: not any(a in VOW and b in VOW for a, b in zip(s, s[1:])),
                 "not any(a in 'АЕИОУЫЭЮЯ' and b in 'АЕИОУЫЭЮЯ' for a, b in zip(s, s[1:]))"),
                (f"буква {y} встречается не менее 2 раз", lambda s: s.count(y) >= 2, f"s.count('{y}') >= 2"),
                ("соседние буквы различны", lambda s: all(a != b for a, b in zip(s, s[1:])),
                 "all(a != b for a, b in zip(s, s[1:]))"),
            ], 2)
            if not any(c in VOW for c in lets) and "гласные" in rules[0][0] + rules[1][0]:
                continue
            ans = sum(1 for p in itertools.product(lets, repeat=L) if all(r[1]("".join(p)) for r in rules))
            nm = R.choice(NAMES)
            q = (f"<p>{nm} составляет {L}-буквенные слова, в которых встречаются только буквы {', '.join(lets)}, причём "
                 f"{rules[0][0]} и {rules[1][0]}. Каждая из других допустимых букв может встречаться в слове любое "
                 f"количество раз или не встречаться совсем. Словом считается любая допустимая последовательность букв, "
                 f"не обязательно осмысленная. Сколько существует таких слов, которые может написать {nm}?</p>")
            sol = (f"from itertools import product\ncnt = 0\nfor p in product('{lets}', repeat={L}):\n    s = ''.join(p)\n"
                   f"    if {rules[0][2]} and {rules[1][2]}:\n        cnt += 1\nprint(cnt)")
            topic, lv = "Подсчёт комбинаций", 2
        elif kind == 2:   # перестановки букв слова
            w = R.choice([x for x in WORDS if 5 <= len(x) <= 7])
            sub = R.randint(0, 2)
            perms = set(itertools.permutations(w))
            if sub == 0:
                cond = lambda s: not any(a in VOW and b in VOW for a, b in zip(s, s[1:]))
                txt = "в которых никакие две гласные не стоят рядом"
                pc = "not any(a in 'АЕИОУЫЭЮЯ' and b in 'АЕИОУЫЭЮЯ' for a, b in zip(s, s[1:]))"
            elif sub == 1:
                cond = lambda s: s[0] not in VOW and s[-1] not in VOW
                txt = "которые начинаются и заканчиваются согласной буквой"
                pc = "s[0] not in 'АЕИОУЫЭЮЯ' and s[-1] not in 'АЕИОУЫЭЮЯ'"
            else:
                cond = lambda s: not any(a not in VOW and b not in VOW for a, b in zip(s, s[1:]))
                txt = "в которых никакие две согласные не стоят рядом"
                pc = "not any(a not in 'АЕИОУЫЭЮЯ' and b not in 'АЕИОУЫЭЮЯ' for a, b in zip(s, s[1:]))"
            ans = sum(1 for p in perms if cond(p))
            if ans == 0:
                continue
            q = (f"<p>Сколько существует различных слов, которые можно получить перестановкой букв слова {w}, {txt}? "
                 "Словом считается любая последовательность букв, не обязательно осмысленная. Буква «Ь» не является ни "
                 "гласной, ни согласной и в подсчёте не участвует как гласная.</p>" if "Ь" in w else
                 f"<p>Сколько существует различных слов, которые можно получить перестановкой букв слова {w}, {txt}? "
                 "Словом считается любая последовательность букв, не обязательно осмысленная.</p>")
            if "Ь" in w:
                continue
            sol = (f"from itertools import permutations\nprint(len({{s for s in permutations('{w}') if {pc}}}))")
            topic, lv = "Подсчёт комбинаций", 2
        else:             # числа в системе счисления
            b = R.choice([5, 6, 7, 8, 9, 12, 16])
            L = R.choice([4, 5]) if b >= 8 else R.choice([5, 6])
            digs = "0123456789ABCDEF"[:b]
            bad = R.choice(digs[1:])
            rules = R.sample([
                (f"не содержащих цифру {bad}", lambda s: bad not in s, f"'{bad}' not in s"),
                ("в которых все цифры различны", lambda s: len(set(s)) == L, f"len(set(s)) == {L}"),
                ("в которых никакие две чётные или две нечётные цифры не стоят рядом",
                 lambda s: all(int(a, 16) % 2 != int(c, 16) % 2 for a, c in zip(s, s[1:])),
                 "all(int(a, 16) % 2 != int(c, 16) % 2 for a, c in zip(s, s[1:]))"),
                ("в которых цифры идут в неубывающем порядке", lambda s: list(s) == sorted(s, key=lambda c: int(c, 16)),
                 "list(s) == sorted(s, key=lambda c: int(c, 16))"),
                (f"в которых ровно одна цифра {bad}", lambda s: s.count(bad) == 1, f"s.count('{bad}') == 1"),
            ], 2)
            both = rules[0][0] + rules[1][0]
            if "ровно одна" in both and ("не содержащих" in both or "различны" in both):
                continue                         # противоречие или лишнее условие
            ans = sum(1 for p in itertools.product(digs, repeat=L) if p[0] != "0" and all(r[1]("".join(p)) for r in rules))
            if ans < 10:
                continue
            bname = {5: "пятеричных", 6: "шестеричных", 7: "семеричных", 8: "восьмеричных", 9: "девятеричных",
                     12: "двенадцатеричных", 16: "шестнадцатеричных"}[b]
            lname = {4: "четырёхзначных", 5: "пятизначных", 6: "шестизначных"}[L]
            q = (f"<p>Определите количество {lname} {bname} чисел, {rules[0][0]} и {rules[1][0]}.</p>"
                 + ("<p>Цифры A, B, C, D, E, F обозначают числа от 10 до 15.</p>" if b > 10 else ""))
            sol = (f"from itertools import product\ncnt = 0\nfor p in product('{digs}', repeat={L}):\n    s = ''.join(p)\n"
                   f"    if s[0] != '0' and {rules[0][2]} and {rules[1][2]}:\n        cnt += 1\nprint(cnt)")
            topic, lv = "Подсчёт комбинаций", 3 if b > 10 or "неубывающ" in q else 2
        break
    add(8, k, q, ans, topic, code(sol), lv=lv)


# волны: (сид, сколько заданий на номер). Новая волна — новая строка в конце: прежние задания не меняются,
# номера заданий продолжаются (у №1–5 до волн уже было 10 заданий первого выпуска)
WAVES = [(SEED, PER), (20261105, 50), (20261106, 50), (20261107, 50)]
# волны с собственными генераторами новых формулировок: сид → модуль
NEW_FORMS = {20261106: "egeshka_w4", 20261107: "egeshka_w5"}


def run(nums=None):
    """По каждой волне — задания на каждый номер; у номера в волне свой генератор случайных чисел."""
    seen2 = {t["html"] for t in G.TASKS if t["n"] == 2}
    for n in nums or [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 22, 23]:
        k = G.PER_NUM if n <= 5 else 0
        for seed, cnt in WAVES:
            R = random.Random(seed + n)
            for _ in range(cnt):
                k += 1
                for tries in range(5000):
                    try:
                        if seed in NEW_FORMS:
                            import importlib
                            getattr(importlib.import_module(NEW_FORMS[seed]), f"gen{n}")(R, k)
                            if n == 19:                   # игры не проходят через add(): повторы ловим по тексту здесь
                                if G.TASKS[-1]["html"] in _SEEN_TEXT:
                                    G.TASKS.pop()
                                    continue
                                _SEEN_TEXT.add(G.TASKS[-1]["html"])
                            G.TASKS[-1]["dt"] = "2026-11-05"
                        elif n <= 5:
                            G.R = R                       # №1–5 — генераторы первой волны, но со своим сидом
                            before = len(G.TASKS)
                            getattr(G, f"gen{n}")(k)
                            t = G.TASKS[-1]
                            # №2: в условии только нули и единицы таблицы — по числам задания не различить,
                            # сравниваем текст целиком (формула + таблица); вторая волна — как была выпущена
                            dup = (t["html"] in seen2) if n == 2 and seed != SEED else is_dup(n, t["html"])
                            seen2.add(t["html"])
                            if len(G.TASKS) == before + 1 and not t.get("att") and dup:
                                G.TASKS.pop()
                                continue
                            t["dt"] = "2026-11-04"
                        else:
                            globals()[f"gen{n}"](R, k)
                        break
                    except Dup:
                        continue
                else:
                    raise RuntimeError(f"№{n}, задание {k}: не удаётся получить новое (одни повторы)")


# ============================================================ №9 — электронная таблица (решается по 9.txt, его даёт сайт)
def gen9(R, k):
    kind = k % 6
    rows_n = R.randint(28, 50) * 100
    if kind == 0:     # шесть чисел: одна пара повторов
        cols, hi = 6, R.choice([60, 80, 100])
        txt = ("в строке только одно число повторяется ровно два раза, остальные четыре числа различны; "
               "среднее арифметическое четырёх неповторяющихся чисел строки не больше суммы повторяющихся чисел")
        test = """    c = {x: r.count(x) for x in r}
    if sorted(c.values()) == [1, 1, 1, 1, 2]:
        rep = [x for x in c if c[x] == 2][0]
        other = [x for x in r if c[x] == 1]
        if sum(other) / 4 <= rep * 2:
            cnt += 1"""
    elif kind == 1:   # четыре числа: треугольник и пары
        cols, hi = 4, R.choice([50, 100, 200])
        txt = ("наибольшее из четырёх чисел меньше суммы трёх других; четыре числа нельзя разбить на две пары "
               "с равными суммами")
        test = """    a = sorted(r)
    if a[3] < a[0] + a[1] + a[2] and not (a[0] + a[3] == a[1] + a[2] or a[0] + a[1] == a[2] + a[3] or a[0] + a[2] == a[1] + a[3]):
        cnt += 1"""
    elif kind == 2:   # пять чисел: квадрат суммы крайних
        cols, hi = 5, R.choice([100, 150, 200])
        txt = ("квадрат суммы максимального и минимального чисел в строке больше суммы квадратов трёх оставшихся чисел")
        test = """    a = sorted(r)
    if (a[0] + a[4]) ** 2 > a[1] ** 2 + a[2] ** 2 + a[3] ** 2:
        cnt += 1"""
    elif kind == 3:   # семь чисел: тройной повтор
        cols, hi = 7, R.choice([20, 25, 30])
        txt = ("в строке есть число, которое повторяется ровно три раза, а остальные четыре числа различны; "
               "сумма повторяющихся чисел больше суммы неповторяющихся")
        test = """    c = {x: r.count(x) for x in r}
    if sorted(c.values()) == [1, 1, 1, 1, 3]:
        rep = [x for x in c if c[x] == 3][0]
        if rep * 3 > sum(x for x in r if c[x] == 1):
            cnt += 1"""
    elif kind == 4:   # шесть чисел: все различны, чётные и нечётные
        cols, hi = 6, R.choice([100, 300, 500])
        txt = ("все числа в строке различны; сумма чётных чисел строки больше суммы нечётных, а количество "
               "нечётных чисел больше количества чётных")
        test = """    if len(set(r)) == 6:
        ev = [x for x in r if x % 2 == 0]
        od = [x for x in r if x % 2]
        if sum(ev) > sum(od) and len(od) > len(ev):
            cnt += 1"""
    else:             # три числа: тупоугольный треугольник
        cols, hi = 3, R.choice([60, 100, 150])
        txt = ("из чисел строки можно составить стороны тупоугольного треугольника (квадрат наибольшей стороны больше "
               "суммы квадратов двух других, и треугольник существует)")
        test = """    a, b, c = sorted(r)
    if a + b > c and c * c > a * a + b * b:
        cnt += 1"""
    rows = [[R.randint(1, hi) for _ in range(cols)] for _ in range(rows_n)]
    src = "cnt = 0\nfor r in rows:\n" + test
    g = {"rows": rows}
    exec(src, g)
    ans = g["cnt"]
    if ans < 5:
        return gen9(R, k)
    words = {3: "три натуральных числа", 4: "четыре натуральных числа", 5: "пять натуральных чисел",
             6: "шесть натуральных чисел", 7: "семь натуральных чисел"}[cols]
    name = f"9/e9-{k:02d}.xlsx"
    G.write_xlsx(media(9) / f"e9-{k:02d}.xlsx", [("Лист1", rows)])
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            f"<p>Откройте файл электронной таблицы, содержащей в каждой строке {words}. Определите "
            f"количество строк таблицы, для чисел которых выполнены оба условия:</p><p>— {txt.split('; ')[0]};<br>— "
            f"{txt.split('; ')[1] if '; ' in txt else ''}.</p><p>В ответе запишите только число.</p>")
    if "; " not in txt:
        body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
                f"<p>Откройте файл электронной таблицы, содержащей в каждой строке {words}. Определите "
                f"количество строк таблицы, в которых {txt}.</p><p>В ответе запишите только число.</p>")
    sol = ("rows = [list(map(int, s.split())) for s in open('9.txt') if s.strip()]\n" + src + "\nprint(cnt)")
    add(9, k, body, ans, "Обработка числовой информации в электронных таблицах", code(sol),
        att=[{"name": "9.xlsx", "href": f"media/egeshka_bank/{name}"}], lv=2 if kind in (2, 4, 5) else 3)


# ============================================================ №10 — IP-адреса и маски
IP_HEAD = ("<p>В терминологии сетей TCP/IP маской сети называют двоичное число, которое показывает, какая часть "
           "IP-адреса узла сети относится к адресу сети, а какая — к адресу узла в этой сети. Адрес сети получается "
           "в результате применения поразрядной конъюнкции к заданному адресу узла и маске сети.</p>")
IP_BCAST = ("<p>Широковещательным адресом называется адрес, в котором на месте нулей маски стоят единицы. Адрес сети "
            "и широковещательный адрес не могут быть использованы для адресации сетевых устройств.</p>")


def ip_s(v):
    return ".".join(str(v >> s & 255) for s in (24, 16, 8, 0))


def mask_of(p):
    return (2 ** 32 - 1) ^ (2 ** (32 - p) - 1)


def gen10(R, k):
    kind = k % 5
    while True:
        ip = R.choice([R.randint(1, 223), 10, 172, 192]) << 24 | R.getrandbits(24)
        if kind == 0:     # сколько адресов с условием на единицы
            p = R.randint(16, 26)
            net = ip & mask_of(p)
            m, rel, name = R.choice([(2, "кратно", "чётно"), (3, "кратно", ""), (5, "не кратно", ""), (4, "кратно", ""),
                                     (3, "не кратно", "")])
            cnt = sum(1 for a in range(net, net + 2 ** (32 - p))
                      if (bin(a).count("1") % m == 0) == (rel == "кратно"))
            ans = cnt
            q = (f"Сеть задана IP-адресом {ip_s(net)} и маской сети {ip_s(mask_of(p))}. Сколько в этой сети IP-адресов, "
                 f"для которых количество единиц в двоичной записи IP-адреса {rel} {m}? В ответе укажите только число.")
            sol = (f"from ipaddress import ip_network\nnet = ip_network('{ip_s(net)}/{ip_s(mask_of(p))}')\n"
                   f"print(sum(1 for a in net if (bin(int(a)).count('1') % {m} == 0) == {rel == 'кратно'}))")
            head, lv = IP_HEAD, 2
        elif kind == 1:   # третий байт маски
            p = R.randint(17, 23)
            net = ip & mask_of(p)
            ok = [q_ for q_ in range(33) if ip & mask_of(q_) == net]
            byte = R.choice([2, 3])
            vals = {mask_of(q_) >> (8 * (4 - byte)) & 255 for q_ in ok}
            if len(vals) != 1:
                continue
            ans = vals.pop()
            q = (f"Для узла с IP-адресом {ip_s(ip)} адрес сети равен {ip_s(net)}. Чему равен "
                 f"{'второй' if byte == 2 else 'третий'} слева байт маски? Ответ запишите в виде десятичного числа.")
            sol = (f"from ipaddress import ip_network, ip_address\nip = int(ip_address('{ip_s(ip)}'))\nfor p in range(33):\n"
                   f"    m = (2 ** 32 - 1) ^ (2 ** (32 - p) - 1)\n    if ip & m == int(ip_address('{ip_s(net)}')):\n"
                   f"        print(m >> {8 * (4 - byte)} & 255)\n        break")
            if byte == 3 and p <= 16 or byte == 2 and p >= 24:
                continue
            head, lv = IP_HEAD, 1
        elif kind == 2:   # наименьшее / наибольшее число единиц в маске
            p = R.randint(18, 28)
            net = ip & mask_of(p)
            ok = [q_ for q_ in range(1, 32) if ip & mask_of(q_) == net]
            if len(ok) < 2:
                continue
            big = R.random() < 0.5
            ans = max(ok) if big else 32 - max(ok) if R.random() < 0.5 else min(ok)
            what = ("наибольшее возможное количество единиц в разрядах маски" if big else
                    "наименьшее возможное количество нулей в разрядах маски" if ans == 32 - max(ok) else
                    "наименьшее возможное количество единиц в разрядах маски")
            q = (f"Для узла с IP-адресом {ip_s(ip)} адрес сети равен {ip_s(net)}. Каково {what}?")
            fn = "max(ok)" if big else "32 - max(ok)" if "нулей" in what else "min(ok)"
            sol = (f"from ipaddress import ip_address\nip, net = int(ip_address('{ip_s(ip)}')), int(ip_address('{ip_s(net)}'))\n"
                   "ok = [p for p in range(1, 32) if ip & ((2 ** 32 - 1) ^ (2 ** (32 - p) - 1)) == net]\n"
                   f"print({fn})")
            head, lv = IP_HEAD, 2
        elif kind == 3:   # наибольший адрес для компьютера
            p = R.randint(9, 27)
            net = ip & mask_of(p)
            top = net + 2 ** (32 - p) - 2
            if top == ip:
                continue
            ans = "".join(ip_s(top).split("."))
            low = R.random() < 0.4
            if low:
                top = net + 1
                ans = "".join(ip_s(top).split("."))
            q = (f"Сеть задана IP-адресом одного из входящих в неё узлов {ip_s(ip)} и сетевой маской {ip_s(mask_of(p))}. "
                 f"Найдите в данной сети {'наименьший' if low else 'наибольший'} IP-адрес, который может быть назначен "
                 "компьютеру. В ответе укажите найденный IP-адрес без разделителей. Например, если бы найденный адрес был "
                 "равен 111.22.3.44, то в ответе следовало бы записать: 11122344.")
            sol = (f"from ipaddress import ip_network\nnet = ip_network('{ip_s(ip)}/{ip_s(mask_of(p))}', strict=False)\n"
                   f"hosts = list(net.hosts())\nprint(str(hosts[{0 if low else -1}]).replace('.', ''))")
            head, lv = IP_HEAD + IP_BCAST, 2
        else:             # два узла в одной сети: сколько масок
            p = R.randint(20, 28)
            ip2 = (ip & mask_of(p)) | R.getrandbits(32 - p)
            if ip2 == ip:
                continue
            ok = [q_ for q_ in range(1, 31) if ip & mask_of(q_) == ip2 & mask_of(q_)
                  and all(x & ~mask_of(q_) & 0xFFFFFFFF not in (0, 2 ** (32 - q_) - 1) for x in (ip, ip2))]
            if not ok:
                continue
            ans = len(ok)
            q = (f"Два узла, находящиеся в одной сети, имеют IP-адреса {ip_s(ip)} и {ip_s(ip2)}. Сколько существует "
                 f"различных значений маски этой сети, при которых такая ситуация возможна? Учтите, что адрес сети и "
                 f"широковещательный адрес не могут быть адресами узлов.")
            sol = (f"from ipaddress import ip_address\na, b = int(ip_address('{ip_s(ip)}')), int(ip_address('{ip_s(ip2)}'))\n"
                   "cnt = 0\nfor p in range(1, 31):\n    m = (2 ** 32 - 1) ^ (2 ** (32 - p) - 1)\n"
                   "    host = lambda x: x & ~m & (2 ** 32 - 1)\n"
                   "    if a & m == b & m and all(host(x) not in (0, 2 ** (32 - p) - 1) for x in (a, b)):\n"
                   "        cnt += 1\nprint(cnt)")
            head, lv = IP_HEAD + IP_BCAST, 3
        break
    add(10, k, head + f"<p>{q}</p>", ans, "Маска подсети", code(sol), lv=lv)


# ============================================================ №11 — объём информации
# им., род. ед., род. мн., кому, кого мн., о ком ед., им. мн., о ком мн.
OBJ = [("пароль", "пароля", "паролей", "пользователю", "пользователей", "пользователе", "пароли", "пользователях"),
       ("идентификатор", "идентификатора", "идентификаторов", "сотруднику", "сотрудников", "сотруднике", "идентификаторы",
        "сотрудниках"),
       ("серийный номер", "серийного номера", "серийных номеров", "изделию", "изделий", "изделии", "серийные номера",
        "изделиях"),
       ("пропуск", "пропуска", "пропусков", "посетителю", "посетителей", "посетителе", "пропуска", "посетителях")]


def gen11(R, k):
    kind = k % 4
    while True:
        o = R.choice(OBJ)
        L = R.randint(7, 260)
        m = R.choice([10, 12, 26, 33, 36, 52, 62, 64, 100, 128, 300, 500, 1000, 2000])
        alpha = {10: "десятичных цифр", 12: "двенадцати различных символов", 26: "26 прописных латинских букв",
                 33: "33 прописных букв русского алфавита", 36: "26 прописных латинских букв и 10 десятичных цифр",
                 52: "строчных и прописных латинских букв (всего 52 символа)",
                 62: "десятичных цифр, строчных и прописных латинских букв (всего 62 символа)"}.get(m, f"{m} различных символов")
        bits = math.ceil(math.log2(m))
        per = math.ceil(L * bits / 8)
        N = R.choice([15, 20, 30, 40, 50, 64, 100, 128, 200, 250, 500, 1000, 2048, 4096])
        intro = (f"При регистрации в компьютерной системе каждому {o[3]} выдаётся {o[0]}, состоящий из {L} символов и "
                 f"содержащий только символы из набора {alpha}. В базе данных для хранения каждого {o[1]} отведено "
                 "одинаковое и минимально возможное целое число байт. При этом используют посимвольное кодирование, все "
                 "символы кодируют одинаковым и минимально возможным количеством бит.")
        if kind == 0:     # сколько байт / Кбайт
            total = N * per
            kb = total % 1024 == 0 and R.random() < 0.5
            ans = total // 1024 if kb else total
            q = (intro + f" Определите объём памяти (в {'Кбайт' if kb else 'байтах'}), необходимый для хранения {N} "
                 f"{o[2]}. В ответе запишите только целое число — количество {'Кбайт' if kb else 'байт'}.")
            sol = (f"import math\nbits = math.ceil(math.log2({m}))\nper = math.ceil({L} * bits / 8)\n"
                   f"print({N} * per{' // 1024' if kb else ''})")
            lv = 1
        elif kind == 1:   # дополнительные сведения
            extra = R.randint(5, 60)
            total = N * (per + extra)
            ans = extra
            q = (intro + f" Кроме собственно {o[1]}, для каждого из {o[4]} в системе хранятся дополнительные сведения, для "
                 f"чего выделено целое число байт; это число одно и то же для всех {o[4]}. Для хранения сведений о {N} "
                 f"{o[7]} потребовалось {total} байт. Сколько байт выделено для хранения дополнительных сведений об одном "
                 f"{o[5]}? В ответе запишите только целое число — количество байт.")
            sol = (f"import math\nper = math.ceil({L} * math.ceil(math.log2({m})) / 8)\nprint({total} // {N} - per)")
            lv = 2
        elif kind == 2:   # наименьшая мощность алфавита
            L = R.randint(100, 3000)
            N = R.randint(10 ** 5, 5 * 10 ** 6)
            b = R.randint(5, 10)
            need = N * math.ceil(L * b / 8)
            unit, us = R.choice([(2 ** 30, "Гбайт"), (2 ** 20, "Мбайт")])
            lim = need // unit
            if lim < 2:
                continue
            bb = next(x for x in range(1, 20) if N * math.ceil(L * x / 8) >= lim * unit)
            ans = 2 ** (bb - 1) + 1
            q = (f"На предприятии каждому изготовленному изделию присваивают серийный номер, состоящий из {L} символов. В "
                 "базе данных каждый серийный номер занимает одинаковое и минимально возможное число байт. При этом "
                 "используется посимвольное кодирование серийных номеров, все символы кодируются одинаковым и минимально "
                 f"возможным числом бит. Известно, что для хранения {N} серийных номеров требуется не менее {lim} {us} "
                 "памяти. Определите минимально возможную мощность алфавита, используемого для записи серийных номеров. "
                 "В ответе запишите только целое число.")
            sol = (f"import math\nfor b in range(1, 20):\n    if {N} * math.ceil({L} * b / 8) >= {lim} * {unit}:\n"
                   "        print(2 ** (b - 1) + 1)\n        break")
            lv = 3
        else:             # наибольшая длина
            Kb = R.choice([1, 2, 4, 8, 16, 32, 64])
            lim = Kb * 1024
            N = R.choice([20, 32, 50, 64, 100, 128, 256])
            Ls = [x for x in range(1, 5000) if N * math.ceil(x * bits / 8) <= lim]
            if not Ls or Ls[-1] < 5:
                continue
            ans = Ls[-1]
            q = (f"При регистрации в компьютерной системе каждому {o[3]} выдаётся {o[0]}, содержащий только символы из "
                 f"набора {alpha}. Все {o[6]} имеют одинаковую длину. В базе данных "
                 f"для хранения каждого {o[1]} отведено одинаковое и минимально возможное целое число байт, используется "
                 "посимвольное кодирование, все символы кодируются одинаковым и минимально возможным количеством бит. "
                 f"Для хранения {N} {o[2]} отведено не более {Kb} Кбайт. Какова наибольшая возможная длина {o[1]}? "
                 "В ответе запишите только целое число.")
            sol = (f"import math\nbits = math.ceil(math.log2({m}))\n"
                   f"print(max(x for x in range(1, 5000) if {N} * math.ceil(x * bits / 8) <= {lim}))")
            lv = 2
        break
    add(11, k, f"<p>{q}</p>", ans, "Равномерное кодирование текстовой информации", code(sol), lv=lv)


# ============================================================ №12 — машина Тьюринга
TM_HEAD = (
    "<p>Исполнитель МТ представляет собой читающую и записывающую головку, которая может передвигаться вдоль бесконечной "
    "горизонтальной ленты, разделённой на равные ячейки. В каждой ячейке находится ровно один символ из алфавита "
    "исполнителя, включая специальный пустой символ «λ». На каждом такте головка находится в одном из состояний "
    "q<sub>0</sub>, q<sub>1</sub>, …; в начальный момент — в состоянии q<sub>0</sub>. За один такт головка может "
    "изменить символ в текущей ячейке и переместиться в соседнюю ячейку слева или справа, после чего переходит в новое "
    "состояние или остаётся в прежнем.</p>"
    "<p>Программа работы задаётся таблицей: в первой строке — символы, в первом столбце — состояния головки. На "
    "пересечении находится команда, которую выполняет МТ, когда головка в этом состоянии обозревает этот символ. Если "
    "пара «символ — состояние» невозможна, клетка остаётся пустой. Команда состоит из трёх элементов через запятую: "
    "записываемый в текущую ячейку символ (может совпадать с прежним); один из символов «L», «R», «S» — сдвиг влево, "
    "вправо или завершение работы после выполнения команды (сдвиг происходит после записи символа); новое состояние "
    "головки. Например, команда «0, L, q<sub>3</sub>»: в ячейку записывается 0, головка сдвигается влево и переходит в "
    "состояние q<sub>3</sub>.</p>")


def tm_run(prog, tape, limit=2000):
    tape = dict(enumerate(tape))
    pos, st, used = len(tape), 0, set()
    for _ in range(limit):
        sym = tape.get(pos, "λ")
        if (st, sym) not in prog:
            return None
        used.add((st, sym))
        w, mv, nx = prog[(st, sym)]
        tape[pos] = w
        st = nx
        if mv == "S":
            cells = [tape[i] for i in sorted(tape)]
            s = "".join(cells).strip("λ")
            return s, used
        pos += 1 if mv == "R" else -1
    return None


def tm_table(prog, ns):
    cell = lambda c: f"{c[0]}, {c[1]}, q<sub>{c[2]}</sub>" if c else ""
    rows = [["", "λ", "0", "1"]] + [[f"q<sub>{s}</sub>"] + [cell(prog.get((s, y))) for y in "λ01"] for s in range(ns)]
    return G.table_html(rows)


def gen12(R, k):
    while True:
        ns = R.choice([3, 4, 4, 5])
        prog = {(0, "λ"): ("λ", "L", 1)}
        for s in range(1, ns):
            for y in "λ01":
                w = R.choice("01" if y != "λ" else "λ01")
                if R.random() < 0.5:
                    w = y
                mv = R.choice("LLRS" if s == ns - 1 else "LLLR")
                nx = R.randrange(1, ns)
                prog[(s, y)] = (w, mv, nx)
        X = R.randint(100, 9000)
        res = tm_run(prog, bin(X)[2:])
        if not res:
            continue
        s, used = res
        if len(used) < 5 or not s or "λ" in s or s.lstrip("0") == bin(X)[2:] or len({u[0] for u in used}) < 3:
            continue
        prog = {u: prog[u] for u in used}
        states = sorted({u[0] for u in used} | {v[2] for v in prog.values()})
        if states != list(range(len(states))):
            continue
        val = int(s, 2) if s.strip("0") else 0
        kind = R.random()
        if kind < 0.7:
            ans = val
            q = "Определите результат выполнения программы. В ответе запишите получившееся число в десятичной системе счисления."
            tail = "print(int(s, 2))"
        else:
            ans = s.count("1")
            q = "Сколько единиц будет записано на ленте после выполнения программы?"
            tail = "print(s.count('1'))"
        break
    body = (TM_HEAD + "<p><u>Выполните задание.</u></p>"
            f"<p>На ленте в соседних ячейках записано двоичное представление числа {X} без ведущих нулей. Ячейки справа и "
            "слева от последовательности заполнены пустыми символами «λ». В начальный момент времени головка расположена в "
            "ближайшей справа к последовательности ячейке.</p><p>Программа работы исполнителя:</p>"
            + tm_table(prog, len(states)) + f"<p>{q}</p>")
    sol = ("prog = {\n" + "".join(f"    ({s}, '{y}'): ('{w}', '{m}', {n}),\n" for (s, y), (w, m, n) in sorted(prog.items()))
           + "}\n" f"tape = dict(enumerate('{bin(X)[2:]}'))\npos, st = len(tape), 0\nwhile True:\n"
           "    w, mv, st = prog[(st, tape.get(pos, 'λ'))]\n    tape[pos] = w\n    if mv == 'S':\n        break\n"
           "    pos += 1 if mv == 'R' else -1\ns = ''.join(tape[i] for i in sorted(tape)).strip('λ')\n" + tail)
    add(12, k, body, ans, "Машина Тьюринга", code(sol), lv=2 if len(used) < 8 else 3)


# ============================================================ №13 — количество программ исполнителя
OPS13 = [("Прибавить 1", "+1", lambda x: x + 1), ("Прибавить 2", "+2", lambda x: x + 2),
         ("Прибавить 3", "+3", lambda x: x + 3), ("Умножить на 2", "*2", lambda x: x * 2),
         ("Умножить на 3", "*3", lambda x: x * 3), ("Прибавить 4", "+4", lambda x: x + 4)]
EXEC = ["Калькулятор", "Вычислитель", "Альфа", "Омега", "Плюсик", "Сигма", "Бета", "Счётчик"]


def gen13(R, k):
    kind = k % 4
    while True:
        ops = sorted(R.sample(OPS13[:3], R.choice([1, 2])) + R.sample(OPS13[3:5], 1), key=lambda o: o[0])
        if len(ops) < 2:
            continue
        ops = [o for o in OPS13 if o in ops]
        a = R.randint(1, 12)
        b = R.randint(25, 70)

        name = R.choice(EXEC)
        if kind == 3:     # различные результаты
            L = R.randint(5, 9)
            cur = {a}
            for _ in range(L):
                cur = {o[2](v) for v in cur for o in ops}
            ans = len(cur)
            q = (f"Сколько существует различных результатов выполнения программ, содержащих ровно {L} команд, для "
                 f"исполнителя {name} при исходном числе {a}?")
            sol = (f"cur = {{{a}}}\nfor _ in range({L}):\n    cur = {{y for x in cur for y in ("
                   + ", ".join(f"x {o[1][0]} {o[1][1:]}" for o in ops) + ")}\nprint(len(cur))")
            if ans > 5000:
                continue
            lv = 2
        else:
            mids = list(range(a + 1, b))
            must = tuple(sorted(R.sample(mids, 1 if kind != 2 else R.choice([1, 2])))) if kind != 1 else ()
            avoid = tuple(R.sample([m for m in mids if m not in must], 1)) if kind >= 1 else ()

            def count(v, y, av):
                memo = {}

                def f(x):
                    if x > y or x in av:
                        return 0
                    if x == y:
                        return 1
                    if x not in memo:
                        memo[x] = sum(f(o[2](x)) for o in ops)
                    return memo[x]
                return f(v)
            pts = [a] + list(must) + [b]
            ans = 1
            for i in range(len(pts) - 1):
                ans *= count(pts[i], pts[i + 1], avoid)
            if not 10 <= ans <= 10 ** 7:
                continue
            parts = []
            if must:
                parts.append("траектория вычислений содержит " + (f"число {must[0]}" if len(must) == 1 else
                                                                   f"числа {must[0]} и {must[1]}"))
            if avoid:
                parts.append(f"траектория вычислений не содержит числа {avoid[0]}")
            q = (f"Сколько существует программ, для которых при исходном числе {a} результатом является число {b}, и при "
                 f"этом {' и '.join(parts)}?")
            sol = ("def f(x, y):\n    if x > y" + (f" or x == {avoid[0]}" if avoid else "") + ":\n        return 0\n"
                   "    if x == y:\n        return 1\n    return " + " + ".join(f"f(x {o[1][0]} {o[1][1:]}, y)" for o in ops) +
                   "\n\nprint(" + " * ".join(f"f({pts[i]}, {pts[i + 1]})" for i in range(len(pts) - 1)) + ")")
            lv = 2 if len(parts) == 1 else 3
        break
    lst = "<br>".join(f"{i + 1}. {o[0]}" for i, o in enumerate(ops))
    desc = "; ".join(("первая" if i == 0 else "вторая" if i == 1 else "третья") + " " +
                     ("увеличивает число на экране на " + o[1][1:] if o[1][0] == "+" else "умножает его на " + o[1][1:])
                     for i, o in enumerate(ops))
    ex = "".join(str(i + 1) for i in R.sample(range(len(ops)), len(ops)))
    x0 = R.randint(2, 9)
    tr = []
    v = x0
    for ch in ex:
        v = ops[int(ch) - 1][2](v)
        tr.append(str(v))
    body = (f"<p>Исполнитель {name} преобразует число на экране. У исполнителя есть {['', '', 'две', 'три'][len(ops)]} команды, которым присвоены "
            f"номера:</p><p>{lst}</p><p>Команды: {desc}.</p><p>Программа для исполнителя {name} — это последовательность "
            "команд. Траектория вычислений программы — это последовательность результатов выполнения всех команд "
            f"программы. Например, для программы {ex} при исходном числе {x0} траектория будет состоять из чисел "
            f"{', '.join(tr)}.</p><p>{q}</p>")
    add(13, k, body, ans, "Подсчёт количества программ", code(sol), lv=lv)


# ============================================================ №14 — системы счисления
DIG = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def to_base(v, b):
    s = ""
    while v:
        s = DIG[v % b] + s
        v //= b
    return s or "0"


def gen14(R, k):
    kind = k % 4
    while True:
        if kind in (0, 1):    # значение выражения в системе с основанием p
            p = R.choice([2, 3, 4, 5, 6, 7, 8, 9, 16])
            bases = [b for b in (2, 3, 4, 5, 6, 7, 8, 9, 16, 25, 27, 49, 64, 81) if
                     any(b == p ** i for i in range(1, 5)) or (p == 4 and b == 2) or (p == 9 and b == 3)
                     or (p == 16 and b in (2, 4)) or (p == 8 and b == 2)]
            nt = R.choice([2, 3])
            terms = []
            for _ in range(nt):
                terms.append((R.choice(bases), R.randint(40, 2030)))
            sub = R.randint(1, 3000)
            sign = [R.choice(["+", "-"]) for _ in range(nt - 1)]
            v = terms[0][0] ** terms[0][1]
            for (b, e), sg in zip(terms[1:], sign):
                v = v + b ** e if sg == "+" else v - b ** e
            v -= sub
            if v <= 0:
                continue
            s = to_base(v, p)
            if kind == 0:
                d = R.choice(DIG[:p])
                ans = s.count(d)
                what = f"Сколько цифр «{d}» содержится в этой записи?"
                tail = f"print(s.count('{d}'))"
            else:
                ans = sum(DIG.index(c) for c in s)
                what = "Найдите сумму цифр этой записи. Ответ запишите в десятичной системе счисления."
                tail = "print(sum(int(c, 36) for c in s))"
            if ans == 0:
                continue
            expr = f"{terms[0][0]}<sup>{terms[0][1]}</sup>" + "".join(
                f" {'+' if sg == '+' else '−'} {b}<sup>{e}</sup>" for (b, e), sg in zip(terms[1:], sign)) + f" − {sub}"
            pyexpr = f"{terms[0][0]} ** {terms[0][1]}" + "".join(f" {sg} {b} ** {e}" for (b, e), sg in zip(terms[1:], sign)) + f" - {sub}"
            q = (f"<p>Значение арифметического выражения</p><p>{expr}</p><p>записали в системе счисления с основанием {p}. "
                 f"{what}</p>")
            sol = (f"v = {pyexpr}\ns = ''\nwhile v:\n    s = '0123456789ABCDEF'[v % {p}] + s\n    v //= {p}\n" + tail)
            lv = 2
        else:                 # неизвестная цифра x
            p = R.randint(9, 30)
            m = R.choice([7, 9, 11, 12, 13, 14, 15, 17, 19, 21, 23, 26, 29, 31, 37])
            nums = []
            for _ in range(R.choice([2, 3])):
                L = R.randint(4, 6)
                digs = [R.choice(DIG[1:p])] + [R.choice(DIG[:p]) for _ in range(L - 1)]
                for _ in range(R.choice([1, 2])):
                    digs[R.randrange(len(digs))] = "x"
                if digs[0] == "x" and R.random() < 0.5:
                    digs[0] = R.choice(DIG[1:p])
                nums.append("".join(digs))
            if not any("x" in n_ for n_ in nums):
                continue
            ok = []
            for x in range(p):
                if x == 0 and any(n_[0] == "x" for n_ in nums):
                    continue
                val = sum(int(n_.replace("x", DIG[x]), p) for n_ in nums)
                if val % m == 0:
                    ok.append((x, val // m))
            if not ok:
                continue
            big = kind == 3
            x, ans = ok[-1] if big else ok[0]
            sub_ = lambda n_: n_.replace("x", "<i>x</i>")
            q = (f"<p>Операнды арифметического выражения записаны в системе счисления с основанием {p}:</p><p>"
                 + " + ".join(f"{sub_(n_)}<sub>{p}</sub>" for n_ in nums) +
                 f"</p><p>В записи чисел переменной <i>x</i> обозначена неизвестная цифра из алфавита {p}-ричной системы "
                 f"счисления. Определите {'наибольшее' if big else 'наименьшее'} значение <i>x</i>, при котором значение "
                 f"данного арифметического выражения кратно {m}. Для найденного значения <i>x</i> вычислите частное от "
                 f"деления значения арифметического выражения на {m} и укажите его в ответе в десятичной системе "
                 "счисления. Основание системы счисления в ответе указывать не нужно.</p>"
                 + ("<p>Цифры, большие 9, обозначаются латинскими буквами: A = 10, B = 11 и т. д.</p>" if p > 10 else ""))
            rng = "range(" + ("1" if any(n_[0] == "x" for n_ in nums) else "0") + f", {p})"
            sol = ("alph = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'\n"
                   f"for x in {'reversed(' + rng + ')' if big else rng}:\n"
                   "    v = " + " + ".join(f"int('{n_}'.replace('x', alph[x]), {p})" for n_ in nums) + "\n"
                   f"    if v % {m} == 0:\n        print(v // {m})\n        break")
            lv = 3 if len(nums) == 3 else 2
        break
    add(14, k, q, ans, "Длинная арифметика" if kind < 2 else "Выражение с неизвестными цифрами", code(sol), lv=lv)


# ============================================================ №15 — логика
def lcm(*xs):
    v = 1
    for x in xs:
        v = v * x // math.gcd(v, x)
    return v


def gen15(R, k):
    kind = k % 4
    while True:
        if kind == 0:     # ДЕЛ: тождественная истинность точно проверяется через НОК
            a, b = R.sample([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 18, 20, 21, 24, 25, 28, 30, 35, 36, 40, 42, 45], 2)
            form = R.randint(0, 2)
            if form == 0:     # ложно, только если A | x, a | x и b ∤ x
                tex = f"ДЕЛ(x, A) → (ДЕЛ(x, {a}) → ДЕЛ(x, {b}))"
                py = f"(not x % A == 0) or (not x % {a} == 0) or (x % {b} == 0)"
                good, big = (lambda A: lcm(A, a) % b == 0), False
            elif form == 1:   # ложно, только если a | x, b | x и A ∤ x
                tex = f"(ДЕЛ(x, {a}) ∧ ДЕЛ(x, {b})) → ДЕЛ(x, A)"
                py = f"(not (x % {a} == 0 and x % {b} == 0)) or (x % A == 0)"
                good, big = (lambda A: lcm(a, b) % A == 0), True
            else:             # ложно, только если A | x, b | x и a ∤ x
                tex = f"(ДЕЛ(x, A) ∧ ¬ДЕЛ(x, {a})) → ¬ДЕЛ(x, {b})"
                py = f"(not (x % A == 0 and x % {a} != 0)) or (x % {b} != 0)"
                good, big = (lambda A: lcm(A, b) % a == 0), False
            cands = [A for A in range(1, 1001) if good(A)]
            if not cands:
                continue
            ans = max(cands) if big else min(cands)
            if ans == 1:
                continue
            what = "наибольшего" if big else "наименьшего"
            q = (f"<p>Обозначим через ДЕЛ(n, m) утверждение «натуральное число n делится без остатка на натуральное число m». "
                 f"Для какого {what} натурального числа A формула</p><p>{tex}</p><p>тождественно истинна (то есть "
                 "принимает значение 1 при любом натуральном значении переменной x)?</p>")
            sol = (f"def ok(A):\n    return all({py} for x in range(1, 10000))\n\n"
                   + ("print(max(A for A in range(1, 1001) if ok(A)))" if big else
                      "A = 1\nwhile not ok(A):\n    A += 1\nprint(A)"))
            topic, lv = "Делимость", 2
        elif kind == 1:   # неравенства: перебираем x, y, на которых остальные скобки ложны
            form = R.randint(0, 2)
            if form == 0:
                c1, c2, a1, a2 = R.randint(10, 60), R.randint(10, 60), R.randint(1, 4), R.randint(1, 4)
                tex = f"({a1 if a1 > 1 else ''}x + {a2 if a2 > 1 else ''}y &lt; A) ∨ (x &gt; {c1}) ∨ (y &gt; {c2})"
                py = f"({a1} * x + {a2} * y < A) or (x > {c1}) or (y > {c2})"
                ans = max(a1 * x + a2 * y for x in range(c1 + 1) for y in range(c2 + 1)) + 1
                big, D = False, 2 * max(c1, c2) + 2
            elif form == 1:
                a1, c3 = R.randint(2, 4), R.randint(30, 160)
                tex = f"({a1}x + y ≠ {c3}) ∨ (x &lt; y) ∨ (A &lt; x)"
                py = f"({a1} * x + y != {c3}) or (x < y) or (A < x)"
                xs = [x for x in range(c3 + 1) for y in range(c3 + 1) if a1 * x + y == c3 and x >= y]
                if not xs:
                    continue
                ans = min(xs) - 1
                big, D = True, c3 + 2
            else:
                c1 = R.randint(8, 30)
                tex = f"(x · y &lt; A) ∨ (y &lt; x) ∨ (y &gt; {c1})"
                py = f"(x * y < A) or (y < x) or (y > {c1})"
                ans = max(x * y for y in range(c1 + 1) for x in range(y + 1)) + 1
                big, D = False, 2 * c1 + 2
            if ans < 1:
                continue
            what = "наибольшего" if big else "наименьшего"
            q = (f"<p>Для какого {what} целого неотрицательного числа A выражение</p><p>{tex}</p><p>тождественно истинно, "
                 "то есть принимает значение 1 при любых целых неотрицательных x и y?</p>")
            sol = (f"def ok(A):\n    return all({py} for x in range({D}) for y in range({D}))\n\n"
                   + ("A = 1000\nwhile not ok(A):\n    A -= 1\nprint(A)" if big else "A = 0\nwhile not ok(A):\n    A += 1\nprint(A)"))
            topic, lv = "Графики", 2
        elif kind == 2:   # отрезки: точки, где выражение ложно без A, должны лежать в A
            P = sorted(R.sample(range(5, 90), 2))
            Q = sorted(R.sample(range(5, 90), 2))
            inP = lambda x: P[0] <= x <= P[1]
            inQ = lambda x: Q[0] <= x <= Q[1]
            form = R.randint(0, 2)
            if form == 0:
                tex = "(x ∈ P) → (((x ∈ Q) ∧ ¬(x ∈ A)) → ¬(x ∈ P))"
                py = "(not inP(x)) or (not (inQ(x) and not inA)) or (not inP(x))"
                F = lambda x, inA: (not inP(x)) or (not (inQ(x) and not inA))
            elif form == 1:
                tex = "((x ∈ P) ∨ (x ∈ Q)) → (x ∈ A)"
                py = "(not (inP(x) or inQ(x))) or inA"
                F = lambda x, inA: (not (inP(x) or inQ(x))) or inA
            else:
                tex = "¬(x ∈ A) → ((x ∈ P) → (x ∈ Q))"
                py = "inA or (not inP(x)) or inQ(x)"
                F = lambda x, inA: inA or (not inP(x)) or inQ(x)
            need = [i / 4 for i in range(400) if not F(i / 4, False)]
            if not need or need[-1] == need[0]:
                continue
            ans = need[-1] - need[0]
            if ans != int(ans):
                continue
            ans = int(ans)
            q = (f"<p>На числовой прямой даны два отрезка: P = [{P[0]}; {P[1]}] и Q = [{Q[0]}; {Q[1]}]. Какова наименьшая "
                 "возможная длина отрезка A, для которого логическое выражение</p>"
                 f"<p>{tex}</p><p>истинно (то есть принимает значение 1) при любом значении переменной x?</p>")
            sol = (f"inP = lambda x: {P[0]} <= x <= {P[1]}\ninQ = lambda x: {Q[0]} <= x <= {Q[1]}\n"
                   "# A должен накрыть все точки, где выражение ложно, если x не в A; шаг 0,25 ловит и концы отрезков\n"
                   f"inA = False\nneed = [i / 4 for i in range(400) if not (lambda x: {py})(i / 4)]\n"
                   "print(round(need[-1] - need[0]))")
            topic, lv = "Отрезки", 2
        else:             # поразрядная конъюнкция: важны только биты чисел до 255
            a, b = R.sample([5, 7, 9, 12, 13, 14, 19, 21, 22, 25, 26, 28, 29, 35, 37, 41, 44, 45, 49, 52, 56, 58, 60, 74,
                             76, 83, 92, 105, 112, 117, 125], 2)
            form = R.randint(0, 2)
            if form == 0:
                tex = f"(x &amp; {a} = 0) → ((x &amp; {b} ≠ 0) → (x &amp; A ≠ 0))"
                py = f"(x & {a} != 0) or (x & {b} == 0) or (x & A != 0)"
                big = False
            elif form == 1:
                tex = f"(x &amp; A = 0) → ((x &amp; {a} ≠ 0) → (x &amp; {b} = 0))"
                py = f"(x & A != 0) or (x & {a} == 0) or (x & {b} == 0)"
                big = False
            else:
                tex = f"(x &amp; A ≠ 0) → ((x &amp; {a} ≠ 0) ∨ (x &amp; {b} ≠ 0))"
                py = f"(x & A == 0) or (x & {a} != 0) or (x & {b} != 0)"
                big = True
            F = eval(f"lambda x, A: {py}")
            cands = [A for A in range(256) if all(F(x, A) for x in range(256))]
            if not cands:
                continue
            ans = max(cands) if big else min(cands)
            if ans == 0:
                continue
            what = "наибольшего" if big else "наименьшего"
            q = (f"<p>Обозначим через m &amp; n поразрядную конъюнкцию неотрицательных целых чисел m и n. Так, например, "
                 f"14 &amp; 5 = 1110<sub>2</sub> &amp; 0101<sub>2</sub> = 0100<sub>2</sub> = 4.</p><p>Для какого {what} "
                 f"неотрицательного целого числа A формула</p><p>{tex}</p><p>тождественно истинна (то есть принимает "
                 "значение 1 при любом неотрицательном целом значении переменной x)?</p>")
            sol = (f"def ok(A):\n    return all({py} for x in range(1024))\n\n"
                   f"print({'max' if big else 'min'}(A for A in range(1024) if ok(A)))")
            topic, lv = "Битовые операции", 3
        break
    add(15, k, q, ans, topic, code(sol), lv=lv)


# ============================================================ №16 — рекурсия
def gen16(R, k):
    kind = k % 5
    while True:
        if kind == 0:     # F(n) = n + F(n-1), разность больших значений
            c = R.randint(5, 20)
            a1 = R.choice([1, 2, 3])
            N = R.randint(2000, 9000)
            d = R.randint(2, 6)
            F = {}
            for n in range(1, N + 1):
                F[n] = n if n < c else a1 * n + F[n - 1]
            ans = F[N] - F[N - d]
            tex = f"F(n) = n при n &lt; {c};<br>F(n) = {str(a1) + ' · ' if a1 > 1 else ''}n + F(n − 1) при n ≥ {c}."
            ask = f"Чему равно значение выражения F({N}) − F({N - d})?"
            sol = (f"import sys\nsys.setrecursionlimit(20000)\ndef F(n):\n    if n < {c}:\n        return n\n"
                   f"    return {a1} * n + F(n - 1)\n\nprint(F({N}) - F({N - d}))")
            lv = 2
        elif kind == 1:   # факториал — отношение
            N = R.randint(2020, 2030)
            a, b = R.randint(1, 4), R.randint(1, 4)
            tex = "F(n) = 1 при n = 1;<br>F(n) = n · F(n − 1) при n &gt; 1."
            fact = math.factorial
            num = a * fact(N) + b * fact(N - 1)
            ans = num // fact(N - 2)
            if num % fact(N - 2):
                continue
            ask = (f"Чему равно значение выражения ({str(a) + ' · ' if a > 1 else ''}F({N}) + "
                   f"{str(b) + ' · ' if b > 1 else ''}F({N - 1})) / F({N - 2})?")
            sol = (f"import sys\nsys.setrecursionlimit(10000)\ndef F(n):\n    return 1 if n == 1 else n * F(n - 1)\n\n"
                   f"print(({a} * F({N}) + {b} * F({N - 1})) // F({N - 2}))")
            lv = 2
        elif kind == 2:   # вперёд до границы
            T = R.randint(2020, 2030)
            m = R.choice([2, 3])
            st = R.choice([2, 3])
            x = R.randint(10, 200)
            F = {}
            for n in range(T + 10, 0, -1):
                F[n] = n if n >= T else m * n + F[n + st]
            ans = F[x] - F[x + 1] if st > 1 else None
            if ans is None:
                continue
            tex = f"F(n) = n при n ≥ {T};<br>F(n) = n · {m} + F(n + {st}) при n &lt; {T}."
            ask = f"Чему равно значение выражения F({x}) − F({x + 1})?"
            sol = (f"import sys\nsys.setrecursionlimit(10000)\ndef F(n):\n    if n >= {T}:\n        return n\n"
                   f"    return n * {m} + F(n + {st})\n\nprint(F({x}) - F({x + 1}))")
            lv = 3
        elif kind == 3:   # чётные/нечётные — сколько n
            lim = R.choice([500, 1000, 2000])
            a1 = R.randint(1, 3)
            tgt = None
            F = {0: 0}
            for n in range(1, lim + 1):
                F[n] = F[n // 2] + (n % 2) * a1 if n % 2 else F[n // 2] + 1
            vals = [F[n] for n in range(1, lim + 1)]
            tgt = R.choice(sorted(set(vals)))
            ans = vals.count(tgt)
            if ans < 3:
                continue
            tex = (f"F(0) = 0;<br>F(n) = F(n / 2) + 1, если n &gt; 0 и n чётно;<br>"
                   f"F(n) = F((n − 1) / 2) + {a1}, если n нечётно.")
            ask = f"Сколько существует натуральных значений n, не превышающих {lim}, для которых F(n) = {tgt}?"
            sol = (f"def F(n):\n    if n == 0:\n        return 0\n    if n % 2 == 0:\n        return F(n // 2) + 1\n"
                   f"    return F((n - 1) // 2) + {a1}\n\nprint(sum(1 for n in range(1, {lim + 1}) if F(n) == {tgt}))")
            lv = 2
        else:             # две функции
            c = R.randint(2, 5)
            n = R.randint(12, 18)
            p1, p2 = R.randint(1, 3), R.randint(1, 3)
            Fv, Gv = {}, {}
            for i in range(1, n + 1):
                if i <= c:
                    Fv[i], Gv[i] = 1, 1
                else:
                    Fv[i] = Fv[i - 1] + p1 * Gv[i - 1]
                    Gv[i] = Fv[i - 1] - Gv[i - 1] + p2
            ask_f = R.choice(["F", "G"])
            ans = (Fv if ask_f == "F" else Gv)[n]
            tex = (f"F(n) = 1, G(n) = 1 при n ≤ {c};<br>F(n) = F(n − 1) + {str(p1) + ' · ' if p1 > 1 else ''}G(n − 1) при n &gt; {c};"
                   f"<br>G(n) = F(n − 1) − G(n − 1) + {p2} при n &gt; {c}.")
            ask = f"Чему равно значение {ask_f}({n})?"
            sol = (f"def F(n):\n    return 1 if n <= {c} else F(n - 1) + {p1} * G(n - 1)\n\n"
                   f"def G(n):\n    return 1 if n <= {c} else F(n - 1) - G(n - 1) + {p2}\n\nprint({ask_f}({n}))")
            lv = 1
        break
    fn = "функций F(n) и G(n)" if kind == 4 else "функции F(n)"
    body = (f"<p>Алгоритм вычисления значения {fn}, где n — {'целое неотрицательное' if kind == 3 else 'натуральное'} число, "
            f"задан следующими соотношениями:</p><p>{tex}</p><p>{ask}</p>")
    add(16, k, body, ans, "Рекурсия", code(sol), lv=lv)


# ============================================================ №17 — последовательность чисел в файле
def gen17(R, k):
    kind = k % 4
    while True:
        neg = R.random() < 0.4
        lo, hi = (-100000, 100000) if neg else (1, 100000)
        N = R.randint(5000, 10000)
        # побольше двух-, трёх- и четырёхзначных, чтобы условия срабатывали
        seq = [R.choice([R.randint(lo, hi), R.randint(10, 9999) * (R.choice([-1, 1]) if neg else 1)]) for _ in range(N)]
        end = R.choice(["13", "15", "21", "17", "32", "7", "9", "25"])
        ref_kind = R.choice(["max", "min"])
        refs = [x for x in seq if abs(x) % 10 ** len(end) == int(end)]
        if not refs:
            continue
        ref = max(refs) if ref_kind == "max" else min(refs)
        ref_txt = (f"{'максимального' if ref_kind == 'max' else 'минимального'} элемента последовательности, "
                   f"который оканчивается на {end}")
        ref_py = f"{ref_kind}(x for x in a if abs(x) % {10 ** len(end)} == {end})"
        if kind == 0:     # пары: ровно один трёхзначный, сумма ≥ ref
            size, word = 2, "пар"
            cond_t = (f"в которых только один из двух элементов является {R.choice(['трёхзначным', 'четырёхзначным'])} числом, "
                      f"а сумма элементов пары не меньше {ref_txt}")
            dig = 3 if "трёхзнач" in cond_t else 4
            cond = lambda g: sum(len(str(abs(x))) == dig for x in g) == 1 and sum(g) >= ref
            cond_py = f"sum(len(str(abs(x))) == {dig} for x in g) == 1 and sum(g) >= ref"
            val, val_t, val_py = sum, "максимальную из сумм элементов таких пар", "sum(g)"
            agg = max
        elif kind == 1:   # пары: кратность и квадрат
            m = R.choice([3, 5, 7, 9, 11, 13, 17])
            size, word = 2, "пар"
            cond_t = (f"в которых хотя бы один из двух элементов делится на {m}, а сумма квадратов элементов пары не меньше "
                      f"квадрата {ref_txt}")
            cond = lambda g: any(x % m == 0 for x in g) and g[0] ** 2 + g[1] ** 2 >= ref ** 2
            cond_py = f"any(x % {m} == 0 for x in g) and g[0] ** 2 + g[1] ** 2 >= ref ** 2"
            mn = R.random() < 0.5
            val, val_t, val_py = (lambda g: g[0] ** 2 + g[1] ** 2), (
                f"{'минимальную' if mn else 'максимальную'} из сумм квадратов элементов таких пар"), "g[0] ** 2 + g[1] ** 2"
            agg = min if mn else max
        elif kind == 2:   # тройки: ровно два трёхзначных
            size, word = 3, "троек"
            cond_t = f"в которых ровно два из трёх элементов являются трёхзначными числами, а сумма элементов тройки не больше {ref_txt}"
            cond = lambda g: sum(len(str(abs(x))) == 3 for x in g) == 2 and sum(g) <= ref
            cond_py = "sum(len(str(abs(x))) == 3 for x in g) == 2 and sum(g) <= ref"
            mn = R.random() < 0.5
            val, val_t, val_py = sum, f"{'минимальную' if mn else 'максимальную'} из сумм элементов таких троек", "sum(g)"
            agg = min if mn else max
        else:             # тройки: все одного знака / произведение крайних
            size, word = 3, "троек"
            if neg:
                cond_t = (f"в которых все числа одного знака, при этом произведение минимального и максимального элементов "
                          f"тройки больше квадрата {ref_txt}")
                cond = lambda g: (all(x > 0 for x in g) or all(x < 0 for x in g)) and min(g) * max(g) > ref ** 2
                cond_py = "(all(x > 0 for x in g) or all(x < 0 for x in g)) and min(g) * max(g) > ref ** 2"
            else:
                cond_t = (f"в которых сумма двух наименьших элементов тройки больше наибольшего, а наибольший элемент "
                          f"тройки больше {ref_txt}")
                cond = lambda g: sum(sorted(g)[:2]) > max(g) and max(g) > ref
                cond_py = "sum(sorted(g)[:2]) > max(g) and max(g) > ref"
            val, val_t, val_py = (lambda g: min(g) * max(g)), "минимальное из произведений минимального и максимального элементов таких троек", "min(g) * max(g)"
            agg = min
        groups = [seq[i:i + size] for i in range(N - size + 1)]
        good = [g for g in groups if cond(g)]
        if not 2 <= len(good) <= N - 100:
            continue
        ans = f"{len(good)} {agg(val(g) for g in good)}"
        break
    name = f"17/e17-{k:02d}.txt"
    (media(17) / f"e17-{k:02d}.txt").write_text("\n".join(map(str, seq)) + "\n", encoding="utf-8")
    rng = "от −100 000 до 100 000" if neg else "от 1 до 100 000"
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            f"<p>В файле содержится последовательность целых чисел. Её элементы могут принимать целые значения {rng} "
            f"включительно. Определите количество {word} последовательности, {cond_t}. В ответе запишите количество "
            f"найденных {word}, затем {val_t}.</p><p>В данной задаче под {'парой' if size == 2 else 'тройкой'} "
            f"подразумевается {'два' if size == 2 else 'три'} идущих подряд элемента последовательности.</p>")
    sol = (f"a = [int(s) for s in open('17.txt')]\nref = {ref_py}\nres = []\nfor i in range(len(a) - {size - 1}):\n"
           f"    g = a[i:i + {size}]\n    if {cond_py}:\n        res.append({val_py})\nprint(len(res), {agg.__name__}(res))")
    add(17, k, body, ans, "Обработка числовой последовательности в файле", code(sol),
        att=[{"name": "17.txt", "href": f"media/egeshka_bank/{name}"}], lv=2 if size == 2 else 3)


# ============================================================ №18 — Робот в электронной таблице (стены — толстые границы)
def write_xlsx_grid(path, grid, walls_r, walls_b):
    """Поле N×N: числа в клетках, стены — толстые границы (справа/снизу от клетки), внешняя рамка — тоже толстая."""
    import zipfile
    n = len(grid)
    # стиль ячейки — по маске толстых границ: 1 — слева, 2 — справа, 4 — сверху, 8 — снизу
    borders = []
    for m in range(16):
        side = lambda bit, tag: f'<{tag} style="thick"><color auto="1"/></{tag}>' if m & bit else f"<{tag}/>"
        borders.append(f"<border>{side(1, 'left')}{side(2, 'right')}{side(4, 'top')}{side(8, 'bottom')}<diagonal/></border>")

    def mask(r, c):
        m = 0
        if c == 0 or walls_r.get((r, c - 1)):
            m |= 1
        if c == n - 1 or walls_r.get((r, c)):
            m |= 2
        if r == 0 or walls_b.get((r - 1, c)):
            m |= 4
        if r == n - 1 or walls_b.get((r, c)):
            m |= 8
        return m
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        zput(z, "[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                   '</Types>')
        zput(z, "_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '</Relationships>')
        zput(z, "xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   '<sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        zput(z, "xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
                   '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '</Relationships>')
        zput(z, "xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                   f'<borders count="16">{"".join(borders)}</borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="16">' + "".join(
                       f'<xf numFmtId="0" fontId="0" fillId="0" borderId="{m}" xfId="0" applyBorder="1"/>' for m in range(16))
                   + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
        xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
               '<sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="%d" width="5" customWidth="1"/></cols><sheetData>' % n]
        for r in range(n):
            xml.append(f'<row r="{r + 1}">' + "".join(
                f'<c r="{G.col_name(c)}{r + 1}" s="{mask(r, c)}"><v>{grid[r][c]}</v></c>' for c in range(n)) + "</row>")
        xml.append("</sheetData></worksheet>")
        zput(z, "xl/worksheets/sheet1.xml", "".join(xml))


def gen18(R, k):
    while True:
        n = R.randint(10, 20)
        grid = [[R.randint(1, 100) for _ in range(n)] for _ in range(n)]
        walls_r, walls_b = {}, {}
        for _ in range(R.randint(2, 5)):          # стенки — отрезки вдоль линий сетки
            if R.random() < 0.5:
                c = R.randrange(n - 1)
                r0 = R.randrange(n)
                for r in range(r0, min(n, r0 + R.randint(2, n // 2))):
                    walls_r[(r, c)] = True
            else:
                r = R.randrange(n - 1)
                c0 = R.randrange(n)
                for c in range(c0, min(n, c0 + R.randint(2, n // 2))):
                    walls_b[(r, c)] = True
        up = R.random() < 0.35                       # вариант: из левой нижней в правую верхнюю, вверх и вправо
        best = {}
        cells = [(r, c) for r in (range(n - 1, -1, -1) if up else range(n)) for c in range(n)]
        for r, c in cells:
            if (r, c) == ((n - 1, 0) if up else (0, 0)):
                best[(r, c)] = (grid[r][c], grid[r][c])
                continue
            opts = []
            if c > 0 and not walls_r.get((r, c - 1)) and (r, c - 1) in best:
                opts.append(best[(r, c - 1)])
            if up:
                if r < n - 1 and not walls_b.get((r, c)) and (r + 1, c) in best:
                    opts.append(best[(r + 1, c)])
            elif r > 0 and not walls_b.get((r - 1, c)) and (r - 1, c) in best:
                opts.append(best[(r - 1, c)])
            if opts:
                best[(r, c)] = (max(o[0] for o in opts) + grid[r][c], min(o[1] for o in opts) + grid[r][c])
        fin = (0, n - 1) if up else (n - 1, n - 1)
        if fin not in best or len(best) < n * n * 0.7:
            continue
        mx, mn = best[fin]
        order = R.random() < 0.5
        ans = f"{mx} {mn}" if order else f"{mn} {mx}"
        break
    name = f"18/e18-{k:02d}.xlsx"
    write_xlsx_grid(media(18) / f"e18-{k:02d}.xlsx", grid, walls_r, walls_b)
    mv = "вправо или вверх" if up else "вправо или вниз"
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            f"<p>Квадрат разлинован на N × N клеток (1 &lt; N &lt; 30). Исполнитель Робот может перемещаться по клеткам, "
            f"выполняя за одно перемещение одну из двух команд: <b>{mv.split(' или ')[0]}</b> или <b>{mv.split(' или ')[1]}</b>. "
            f"По команде <b>вправо</b> Робот перемещается в соседнюю правую клетку, по команде <b>{mv.split(' или ')[1]}</b> — "
            f"в соседнюю {'верхнюю' if up else 'нижнюю'}. Робот разрушается при попытке выхода за границу квадрата или при "
            "попытке пересечения стены. В таблице стены отмечены толстыми границами ячеек.</p>"
            "<p>Перед каждым запуском Робота в каждой клетке квадрата лежит монета достоинством от 1 до 100. Посетив клетку, "
            "Робот забирает монету с собой; это также относится к начальной и конечной клеткам маршрута Робота.</p>"
            f"<p>Определите максимальную и минимальную денежные суммы, которые может собрать Робот, пройдя из "
            f"{'левой нижней' if up else 'левой верхней'} клетки в {'правую верхнюю' if up else 'правую нижнюю'}. В ответе "
            f"укажите два числа — сначала {'максимальную' if order else 'минимальную'} сумму, затем "
            f"{'минимальную' if order else 'максимальную'}.</p>"
            "<p>Исходные данные представляют собой электронную таблицу размером N × N, каждая ячейка которой соответствует "
            "клетке квадрата.</p>")
    sol = ("import openpyxl\nws = openpyxl.load_workbook('18.xlsx').active\nn = ws.max_row\n"
           "v = [[ws.cell(r + 1, c + 1).value for c in range(n)] for r in range(n)]\n"
           "thick = lambda s: s in ('thick', 'medium')\n"
           "def wall_right(r, c):   # между (r, c) и (r, c + 1)\n"
           "    return thick(ws.cell(r + 1, c + 1).border.right.style) or thick(ws.cell(r + 1, c + 2).border.left.style)\n"
           "def wall_below(r, c):   # между (r, c) и (r + 1, c)\n"
           "    return thick(ws.cell(r + 1, c + 1).border.bottom.style) or thick(ws.cell(r + 2, c + 1).border.top.style)\n"
           "best = {}\n"
           + ("rows = range(n - 1, -1, -1)\nstart, fin = (n - 1, 0), (0, n - 1)\n" if up else
              "rows = range(n)\nstart, fin = (0, 0), (n - 1, n - 1)\n")
           + "for r in rows:\n    for c in range(n):\n        if (r, c) == start:\n            best[r, c] = (v[r][c], v[r][c])\n"
           "            continue\n        prev = []\n        if c > 0 and not wall_right(r, c - 1) and (r, c - 1) in best:\n"
           "            prev.append(best[r, c - 1])\n"
           + ("        if r < n - 1 and not wall_below(r, c) and (r + 1, c) in best:\n            prev.append(best[r + 1, c])\n" if up else
              "        if r > 0 and not wall_below(r - 1, c) and (r - 1, c) in best:\n            prev.append(best[r - 1, c])\n")
           + "        if prev:\n            best[r, c] = (max(p[0] for p in prev) + v[r][c], min(p[1] for p in prev) + v[r][c])\n"
           + ("print(*best[fin])" if order else "print(best[fin][1], best[fin][0])"))
    add(18, k, body, ans, "Робот в электронных таблицах", code(sol),
        att=[{"name": "18.xlsx", "href": f"media/egeshka_bank/{name}"}], lv=3 if up else 2)


# ============================================================ №19–21 — теория игр (одна игра — три вопроса)
GAME_OPS = [("+1", "добавить в кучу один камень", lambda x: x + 1), ("+2", "добавить в кучу два камня", lambda x: x + 2),
            ("+3", "добавить в кучу три камня", lambda x: x + 3), ("+4", "добавить в кучу четыре камня", lambda x: x + 4),
            ("*2", "увеличить количество камней в куче в два раза", lambda x: x * 2),
            ("*3", "увеличить количество камней в куче в три раза", lambda x: x * 3)]


def game_solver(moves, W, two=None):
    """moves(pos) → позиции после хода; конец — сумма ≥ W. Возвращает f(pos, m, strategy)."""
    from functools import lru_cache

    @lru_cache(None)
    def f(pos, m, strat):
        if sum(pos) >= W:
            return m % 2 == 0
        if m == 0:
            return False
        h = [f(p, m - 1, strat) for p in moves(pos)]
        return any(h) if (m % 2 == 1 or not strat) else all(h)
    return f


def gen19(R, k):
    two = k % 2 == 0
    while True:
        if two:
            add_op = R.choice(GAME_OPS[:2])
            mul_op = R.choice(GAME_OPS[4:])
            K = R.randint(3, 12)
            W = R.randint(40, 130)
            ops = [add_op, mul_op]
            moves = lambda pos: tuple(tuple(o[2](v) if i == j else u for j, u in enumerate(pos)) for i, v in enumerate(pos) for o in ops)
            rng = range(1, W - K)
            start = lambda s: (K, s)
        else:
            ops = sorted(R.sample(GAME_OPS[:4], R.choice([1, 2])) + [R.choice(GAME_OPS[4:])], key=GAME_OPS.index)
            W = R.randint(25, 140)
            moves = lambda pos: tuple((o[2](pos[0]),) for o in ops)
            rng = range(1, W)
            start = lambda s: (s,)
        f = game_solver(moves, W)
        q19 = [s for s in rng if f(start(s), 2, False)]
        q20 = [s for s in rng if f(start(s), 3, True) and not f(start(s), 1, True)]
        q21 = [s for s in rng if f(start(s), 4, True) and not f(start(s), 2, True)]
        if not q19 or not q20 or not q21:
            continue
        a19 = min(q19)
        a20 = " ".join(map(str, q20)) if len(q20) == 2 else str(min(q20))
        a21 = str(min(q21))
        break
    P, V = R.choice([("Петя", "Ваня"), ("Аня", "Боря"), ("Маша", "Саша"), ("Алиса", "Боб")])
    gen_ = lambda w: (w[:-1] + ("и" if w[-1] == "я" or w[-2] in "шжчщкгх" else "ы")) if w[-1] in "ая" else w + "а"
    Pf, Vf = gen_(P), gen_(V)                    # родительный падеж: Пети, Маши, Алисы, Боба
    if two:
        rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежат две кучи камней. Игроки ходят по "
                 f"очереди, первый ход делает {P}. За один ход игрок может в одну из куч (по своему выбору) "
                 f"{ops[0][1].replace('добавить в кучу ', 'добавить ')} или {ops[1][1].replace('в куче', 'в этой куче')}. "
                 f"Например, пусть в одной куче 10 камней, а в другой 7; такую позицию будем обозначать (10, 7). За один ход из "
                 f"позиции (10, 7) можно получить любую из четырёх позиций: "
                 + ", ".join(f"({a}, {b})" for a, b in moves((10, 7))) +
                 f".</p><p>Игра завершается в тот момент, когда суммарное количество камней в кучах становится не менее {W}. "
                 f"Победителем считается игрок, сделавший последний ход, то есть первым получивший такую позицию, при которой в "
                 f"кучах будет {W} или больше камней.</p><p>В начальный момент в первой куче было {K} "
                 f"{'камня' if K % 10 in (2, 3, 4) and K % 100 not in (12, 13, 14) else 'камней'}, во второй — "
                 f"S камней; 1 ≤ S ≤ {W - K - 1}.</p>")
        mv_py = ("def moves(a, b):\n    return [" + ", ".join(
            [f"(a {ops[0][0][0]} {ops[0][0][1:]}, b)", f"(a {ops[1][0][0]} {ops[1][0][1:]}, b)",
             f"(a, b {ops[0][0][0]} {ops[0][0][1:]})", f"(a, b {ops[1][0][0]} {ops[1][0][1:]})"]) + "]\n")
        f_py = (mv_py + f"def f(a, b, m, strat):\n    if a + b >= {W}:\n        return m % 2 == 0\n    if m == 0:\n        return False\n"
                "    h = [f(x, y, m - 1, strat) for x, y in moves(a, b)]\n"
                "    return any(h) if m % 2 == 1 or not strat else all(h)\n\n")
        call = lambda m, st: f"f({K}, s, {m}, {st})"
        rng_py = f"range(1, {W - K})"
    else:
        rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежит куча камней. Игроки ходят по "
                 f"очереди, первый ход делает {P}. За один ход игрок может "
                 + (", ".join(o[1] for o in ops[:-1]) + " или " + ops[-1][1]) +
                 ". Например, имея кучу из 10 камней, за один ход можно получить кучу из "
                 + (", ".join(str(o[2](10)) for o in ops[:-1]) + " или " + str(ops[-1][2](10))) +
                 f" камней. У каждого игрока, чтобы делать ходы, есть неограниченное количество камней.</p>"
                 f"<p>Игра завершается в тот момент, когда количество камней в куче становится не менее {W}. Победителем "
                 f"считается игрок, сделавший последний ход, то есть первым получивший кучу, в которой будет {W} или больше "
                 f"камней.</p><p>В начальный момент в куче было S камней; 1 ≤ S ≤ {W - 1}.</p>")
        f_py = ("def moves(a):\n    return [" + ", ".join(f"a {o[0][0]} {o[0][1:]}" for o in ops) + "]\n"
                f"def f(a, m, strat):\n    if a >= {W}:\n        return m % 2 == 0\n    if m == 0:\n        return False\n"
                "    h = [f(x, m - 1, strat) for x in moves(a)]\n    return any(h) if m % 2 == 1 or not strat else all(h)\n\n")
        call = lambda m, st: f"f(s, {m}, {st})"
        rng_py = f"range(1, {W})"
    rules += ("<p>Будем говорить, что игрок имеет выигрышную стратегию, если он может выиграть при любых ходах противника. "
              "Описать стратегию игрока — значит описать, какой ход он должен сделать в любой ситуации, которая ему может "
              "встретиться при различной игре противника.</p>")
    t20 = (f"Найдите два таких значения S, при которых у {Pf} есть выигрышная стратегия, причём одновременно выполняются "
           f"два условия:</p><ul><li>{P} не может выиграть за один ход;</li><li>{P} может выиграть своим вторым ходом "
           f"независимо от того, как будет ходить {V}.</li></ul><p>Найденные значения запишите в ответе в порядке возрастания.</p>"
           if len(a20.split()) == 2 else
           f"Найдите минимальное значение S, при котором у {Pf} есть выигрышная стратегия, причём одновременно выполняются "
           f"два условия:</p><ul><li>{P} не может выиграть за один ход;</li><li>{P} может выиграть своим вторым ходом "
           f"независимо от того, как будет ходить {V}.</li></ul>")
    body = (rules + '<h3 class="gq-title">Задание 19</h3>'
            f"<p>Известно, что {V} выиграл своим первым ходом после неудачного первого хода {Pf}. Укажите минимальное "
            "значение S, когда такая ситуация возможна.</p>"
            '<h3 class="gq-title">Задание 20</h3><p>' + t20 +
            '<h3 class="gq-title">Задание 21</h3>'
            f"<p>Найдите минимальное значение S, при котором одновременно выполняются два условия:</p><ul><li>у {Vf} есть "
            f"выигрышная стратегия, позволяющая ему выиграть первым или вторым ходом при любой игре {Pf};</li><li>у {Vf} "
            "нет стратегии, которая позволит ему гарантированно выиграть первым ходом.</li></ul>")
    sol = ("from functools import lru_cache\n" + f_py.replace("def f(", "@lru_cache(None)\ndef f(") +
           f"print(min(s for s in {rng_py} if {call(2, False)}))\n"
           + (f"print(*[s for s in {rng_py} if {call(3, True)} and not {call(1, True)}])\n" if len(a20.split()) == 2 else
              f"print(min(s for s in {rng_py} if {call(3, True)} and not {call(1, True)}))\n")
           + f"print(min(s for s in {rng_py} if {call(4, True)} and not {call(2, True)}))")
    tid = f"egeshka_bank:e19-{k:02d}"
    G.TASKS.append({"id": tid, "n": 19, "bank": "egeshka_bank", "html": body, "src": G.SRC, "y": 2026, "dt": "2026-11-04",
                    "topic": "Две кучи камней" if two else "Одна куча камней", "lv": LV[3 if two else 2], "sol": code(sol),
                    "parts": [{"id": f"{tid}-19", "n": 19, "ans": str(a19)}, {"id": f"{tid}-20", "n": 20, "ans": a20},
                              {"id": f"{tid}-21", "n": 21, "ans": a21}]})


# ============================================================ №22 — параллельные процессы
def gen22(R, k):
    kind = k % 4
    while True:
        n = R.randint(12, 45)
        tm = [R.randint(1, 25) for _ in range(n)]
        deps = []
        for i in range(n):
            if i == 0 or R.random() < 0.25:
                deps.append([])
            else:
                deps.append(sorted(R.sample(range(i), min(i, R.choice([1, 1, 2, 2, 3])))))
        start, end = [0] * n, [0] * n
        for i in range(n):
            start[i] = max((end[d] for d in deps[i]), default=0)
            end[i] = start[i] + tm[i]
        if kind == 0:
            ans = max(end)
            q = ("Определите минимальное время, через которое завершится выполнение всей совокупности процессов, при условии, "
                 "что все независимые друг от друга процессы могут выполняться параллельно.")
            tail = "print(max(end.values()))"
        elif kind == 1:
            ans = max(sum(1 for i in range(n) if start[i] < t + 0.5 < end[i]) for t in range(max(end)))
            q = ("Определите максимальное количество процессов, которые выполнялись одновременно, при условии, что все "
                 "независимые друг от друга процессы стартовали одновременно, а зависимые процессы стартовали сразу после "
                 "завершения всех процессов, от которых они зависят.")
            tail = ("print(max(sum(1 for i in end if end[i] - t_[i] < t + 0.5 < end[i]) for t in range(max(end.values()))))")
        elif kind == 2:
            T = R.randint(max(end) // 4, max(end) * 3 // 4)
            ans = sum(1 for i in range(n) if end[i] <= T)
            q = (f"Определите, сколько процессов завершится за первые {T} мс, при условии, что все независимые друг от друга "
                 "процессы могут выполняться параллельно, а каждый зависимый процесс стартует сразу после завершения всех "
                 "процессов, от которых он зависит.")
            tail = f"print(sum(1 for i in end if end[i] <= {T}))"
        else:
            x = R.randrange(n // 2, n)
            add_t = R.randint(3, 15)
            tm2 = tm[:]
            tm2[x] += add_t
            e2 = [0] * n
            for i in range(n):
                e2[i] = max((e2[d] for d in deps[i]), default=0) + tm2[i]
            ans = max(e2)
            q = (f"Определите минимальное время, через которое завершится выполнение всей совокупности процессов, если время "
                 f"выполнения процесса с ID {x + 1} увеличится на {add_t} мс. Все независимые друг от друга процессы могут "
                 "выполняться параллельно.")
            tail = "print(max(end.values()))"
        if ans and (kind != 1 or ans >= 3):
            break
    rows = [["ID процесса B", "Время выполнения процесса B (мс)", "ID процесса(-ов) A"]]
    for i in range(n):
        rows.append([i + 1, tm[i], ";".join(str(d + 1) for d in deps[i]) if deps[i] else 0])
    G.write_xlsx(media(22) / f"e22-{k:02d}.xlsx", [("Лист1", rows)])
    ex = G.table_html([["ID процесса B", "Время выполнения процесса B (мс)", "ID процесса(-ов) A"],
                       [1, 4, 0], [2, 3, 0], [3, 1, "1; 2"], [4, 7, 3]])
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            "<p>В файле содержится информация о совокупности N вычислительных процессов, которые могут выполняться "
            "параллельно или последовательно. Будем говорить, что процесс B зависит от процесса A, если для выполнения "
            "процесса B необходимы результаты выполнения процесса A. В этом случае процессы могут выполняться только "
            "последовательно.</p><p>Информация о процессах представлена в файле в виде таблицы. В первом столбце таблицы "
            "указан идентификатор процесса (ID), во втором столбце таблицы — время его выполнения в миллисекундах, в третьем "
            "столбце перечислены с разделителем «;» ID процессов, от которых зависит данный процесс. Если процесс является "
            "независимым, то в таблице указано значение 0.</p>"
            f"<p>{q}</p><p>Типовой пример организации данных в файле:</p>{ex}<p>Типовой пример имеет иллюстративный "
            "характер. Для выполнения задания используйте данные из прилагаемого файла.</p>")
    extra = f"t_[{x + 1}] += {add_t}\n" if kind == 3 else ""
    sol = ("import openpyxl\nws = openpyxl.load_workbook('22.xlsx').active\nt_, dep = {}, {}\n"
           "for pid, t, d in ws.iter_rows(min_row=2, values_only=True):\n    if pid is None:\n        continue\n"
           "    t_[pid] = t\n    dep[pid] = [int(x) for x in str(d).split(';') if int(x)]\n" + extra +
           "end = {}\ndef fin(p):\n    if p not in end:\n        end[p] = max((fin(d) for d in dep[p]), default=0) + t_[p]\n"
           "    return end[p]\nfor p in t_:\n    fin(p)\n" + tail)
    add(22, k, body, ans, "Параллельные процессы", code(sol),
        att=[{"name": "22.xlsx", "href": f"media/egeshka_bank/22/e22-{k:02d}.xlsx"}], lv=3 if kind in (1, 3) else 2)


# ============================================================ №23 — ациклический взвешенный граф из файла
def gen23(R, k):
    kind = k % 4
    while True:
        nv = R.randint(60, 110)
        ids = R.sample(range(1, 1000), nv)
        order = ids[:]                       # топологический порядок — рёбра только «вперёд»
        edges = {}
        for i in range(nv - 1):
            for _ in range(R.choice([1, 2, 2, 3])):
                j = R.randint(i + 1, min(nv - 1, i + 12))
                edges[(order[i], order[j])] = R.randint(10, 20000)          # вес в десятых: 1,0 … 2000,0
            if len(edges) >= 200:
                break
        adj = {}
        for (a, b), w in edges.items():
            adj.setdefault(a, []).append((b, w))
        pos = {v: i for i, v in enumerate(order)}

        def best(src, dst, agg, avoid=()):
            memo = {}

            def go(v):
                if v == dst:
                    return 0
                if v in memo:
                    return memo[v]
                res = None
                for u, w in adj.get(v, []):
                    if u in avoid or pos[u] > pos[dst]:
                        continue
                    r = go(u)
                    if r is not None:
                        res = r + w if res is None else agg(res, r + w)          # всё в десятых — целые числа
                memo[v] = res
                return res
            return None if src in avoid else go(src)

        def count(src, dst):
            memo = {}

            def go(v):
                if v == dst:
                    return 1
                if v not in memo:
                    memo[v] = sum(go(u) for u, _ in adj.get(v, []) if pos[u] <= pos[dst])
                return memo[v]
            return go(src)
        a = order[R.randint(0, nv // 5)]
        b = order[R.randint(nv * 3 // 5, nv - 1)]
        if kind == 0:
            r = best(a, b, min)
            if r is None or r % 10 == 0:
                continue
            ans = r // 10
            q = (f"Найдите и запишите в ответе целую часть длины кратчайшего пути из вершины с номером {a} в вершину с "
                 f"номером {b}.")
            tail = f"print(int(short({a}, {b})))"
        elif kind == 1:
            mids = [(x, y) for (x, y) in edges if pos[a] < pos[x] and pos[y] < pos[b]]
            if not mids:
                continue
            x, y = R.choice(mids)
            bad = R.choice([v for v in order if pos[a] < pos[v] < pos[b] and v not in (x, y)])
            r1, r2 = best(a, x, min, (bad,)), best(y, b, min, (bad,))
            if r1 is None or r2 is None or (r1 + edges[(x, y)] + r2) % 10 == 0:
                continue
            ans = (r1 + edges[(x, y)] + r2) // 10
            q = (f"Найдите и запишите в ответ целую часть длины кратчайшего пути из вершины с номером {a} в вершину с "
                 f"номером {b}, проходящего по ребру из вершины с номером {x} в вершину с номером {y} и не проходящего через "
                 f"вершину с номером {bad}.")
            tail = f"print(int(short({a}, {x}, {bad}) + w[{x}, {y}] + short({y}, {b}, {bad})))"
        elif kind == 2:
            c = count(a, b)
            if not 5 <= c <= 10 ** 12:
                continue
            ans = c
            q = f"Найдите количество различных путей из вершины с номером {a} в вершину с номером {b}."
            tail = f"print(cnt({a}, {b}))"
        else:
            r = best(a, b, max)
            if r is None or r % 10 == 0:
                continue
            ans = r // 10
            q = (f"Найдите и запишите в ответе целую часть длины самого длинного пути из вершины с номером {a} в вершину с "
                 f"номером {b}.")
            tail = f"print(int(long_({a}, {b})))"
        break
    lines = []
    el = list(edges.items())
    R.shuffle(el)
    for (x, y), w in el:
        sep = lambda: R.choice([" ", "  ", "\t", " \t", "   "])
        lines.append(f"{x}{sep()}{y}{sep()}{w // 10}.{w % 10}")
    (media(23) / f"e23-{k:02d}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    body = ("<p>В текстовом файле содержится описание ациклического ориентированного взвешенного графа. В каждой строке "
            "файла записаны два натуральных числа (L, M) и одно положительное вещественное число (W). L и M — номера вершин "
            "графа, W — вес ребра, ведущего из вершины L в вершину M. Таким образом, количество строк в файле равно "
            "количеству рёбер в графе. Две вершины графа не могут быть соединены более чем одним ребром.</p>"
            f"<p>{q} Существование хотя бы одного такого пути гарантируется."
            + (" Под длиной пути понимается сумма весов рёбер, составляющих путь." if kind != 2 else "") +
            "</p><p>Для выполнения этого задания следует написать программу. Вершины графа могут быть пронумерованы не "
            "подряд. L ≤ 1000, M ≤ 1000; W ≤ 10 000. Количество строк в файле не превосходит 200. Числа в строках "
            "разделены произвольным ненулевым количеством пробелов и/или табуляций.</p>")
    sol = ("from functools import lru_cache\nw, nxt = {}, {}\nfor s in open('23.txt'):\n    if s.split():\n"
           "        a, b, c = s.split()\n        w[int(a), int(b)] = float(c)\n        nxt.setdefault(int(a), []).append(int(b))\n\n"
           "def short(a, b, bad=None):\n    @lru_cache(None)\n    def go(v):\n        if v == bad:\n            return float('inf')\n"
           "        if v == b:\n            return 0\n        return min((w[v, u] + go(u) for u in nxt.get(v, [])), default=float('inf'))\n"
           "    return go(a)\n\n"
           "def long_(a, b):\n    @lru_cache(None)\n    def go(v):\n        if v == b:\n            return 0\n"
           "        return max((w[v, u] + go(u) for u in nxt.get(v, [])), default=float('-inf'))\n    return go(a)\n\n"
           "def cnt(a, b):\n    @lru_cache(None)\n    def go(v):\n        return 1 if v == b else sum(go(u) for u in nxt.get(v, []))\n"
           "    return go(a)\n\n" + tail)
    add(23, k, body, ans, "Графы", code(sol), att=[{"name": "23.txt", "href": f"media/egeshka_bank/23/e23-{k:02d}.txt"}],
        lv=3 if kind in (1, 3) else 2)
