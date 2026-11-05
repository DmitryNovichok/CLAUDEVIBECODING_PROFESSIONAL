# -*- coding: utf-8 -*-
"""
Банк «Egeshka», пятая волна: формулировки, которых нет ни в первых волнах (gen_egeshka.py, egeshka_more.py),
ни в четвёртой (egeshka_w4.py). Как и раньше: ответ — перебором, у каждого задания решение на Python,
которое tools/egeshka_check.py запускает и сверяет с ответом.
"""
import itertools
import math
from functools import lru_cache

import egeshka_more as M
import egeshka_w4 as W4

G, add, code, pl, tab = W4.G, W4.add, W4.code, W4.pl, W4.tab


# ============================================================ №1 — простые пути: самый длинный, сколько их, номер одного пункта
def gen1(R, k):
    kind = k % 4
    L = G().LET
    while True:
        n = R.choice([6, 7, 7])
        pos, edges, adj = W4.make_graph(R, n)
        num = list(range(n))
        R.shuffle(num)
        adj_n = [set() for _ in range(n)]
        for a, b in edges:
            adj_n[num[a]].add(num[b])
            adj_n[num[b]].add(num[a])
        maps = G().iso_maps(adj, adj_n, n)
        w = {frozenset((num[a], num[b])): R.randint(3, 40) for a, b in edges}

        def paths(adj_, a, b):
            out = []

            def go(v, seen, path):
                if v == b:
                    out.append(path[:])
                    return
                for u in adj_[v]:
                    if u not in seen:
                        seen.add(u)
                        path.append(u)
                        go(u, seen, path)
                        path.pop()
                        seen.discard(u)
            go(a, {a}, [a])
            return out
        a, b = R.sample(range(n), 2)
        if kind == 0:                 # длина самого длинного маршрута без повторов пунктов
            vals = set()
            for mp in maps:
                ps = paths(adj_n, mp[a], mp[b])
                vals.add(max(sum(w[frozenset((p[i], p[i + 1]))] for i in range(len(p) - 1)) for p in ps))
            if len(vals) != 1:
                continue
            ans = vals.pop()
            q = (f"Определите длину самого длинного маршрута из пункта {L[a]} в пункт {L[b]}, если по маршруту нельзя "
                 "проходить через один и тот же пункт дважды. Передвигаться можно только по дорогам, указанным на схеме.")
            lv = 3
        elif kind == 1:               # сколько маршрутов без повторов (только по схеме)
            ans = len(paths(adj, a, b))
            if ans < 3:
                continue
            q = (f"Сколько существует различных маршрутов из пункта {L[a]} в пункт {L[b]}, в которых ни один пункт не "
                 "встречается дважды? Передвигаться можно только по дорогам, указанным на схеме.")
            lv = 2
        elif kind == 2:               # номер одного пункта
            vals = {mp[a] + 1 for mp in maps}
            if len(vals) != 1:
                continue
            ans = vals.pop()
            q = f"Определите, какой номер в таблице соответствует пункту {L[a]}. В ответе запишите это число."
            lv = 1
        else:                         # кратчайший путь через обязательный пункт
            c = R.choice([x for x in range(n) if x not in (a, b)])

            def dist(mp, s, t):
                d = {mp[s]: 0}
                todo = set(range(n))
                while todo:
                    v = min((x for x in todo if x in d), key=d.get, default=None)
                    if v is None:
                        break
                    todo.discard(v)
                    for u in adj_n[v]:
                        if d[v] + w[frozenset((v, u))] < d.get(u, 10 ** 9):
                            d[u] = d[v] + w[frozenset((v, u))]
                return d.get(mp[t])
            vals = {dist(mp, a, c) + dist(mp, c, b) for mp in maps}
            if len(vals) != 1:
                continue
            ans = vals.pop()
            q = (f"Определите длину кратчайшего маршрута из пункта {L[a]} в пункт {L[b]}, который обязательно проходит через "
                 f"пункт {L[c]}. Передвигаться можно только по дорогам, указанным на схеме.")
            lv = 2
        break
    rows = [[""] + [f"П{j + 1}" for j in range(n)]]
    for i in range(n):
        rows.append([f"<b>П{i + 1}</b>"] + [("" if i == j else str(w.get(frozenset((i, j)), ""))) for j in range(n)])
    name = f"1/e1-{k:02d}.svg"
    (G().MEDIA / "1").mkdir(parents=True, exist_ok=True)
    (G().MEDIA / name).write_text(G().graph_svg(n, edges, pos), encoding="utf-8")
    body = ("<p>На рисунке справа схема дорог Н-ского района изображена в виде графа, в таблице содержатся сведения о "
            "протяжённости каждой из этих дорог (в километрах).</p>"
            f'<div><div>{tab(rows)}</div><div><img src="media/egeshka_bank/{name}" alt="Схема дорог" width="340"></div></div>'
            "<p>Так как таблицу и схему рисовали независимо друг от друга, нумерация населённых пунктов в таблице никак не "
            f"связана с буквенными обозначениями на графе.</p><p>{q}</p>")
    add(1, k, body, ans, "Графы и весовые таблицы", f"<p>Сопоставьте пункты по числу дорог, затем переберите маршруты. Ответ: {ans}.</p>",
        lv=lv, by_text=True)


# ============================================================ №2 — сколько наборов, наименьший набор, пять переменных
def gen2(R, k):
    G().R = R
    kind = k % 3
    while True:
        if kind in (0, 1):
            tex, py = G().rand_expr(R.choice([2, 3]))
            if not all(v in py for v in "wxyz"):
                continue
            F = eval(f"lambda w, x, y, z: bool({py})")
            rows = list(itertools.product([0, 1], repeat=4))
            if kind == 0:
                val = R.choice([0, 1])
                ans = sum(1 for r in rows if int(F(*r)) == val)
                if ans in (0, 16):
                    continue
                q = (f"Сколько существует различных наборов значений логических переменных w, x, y, z, при которых функция "
                     f"F принимает значение {val}?")
                tail = f"print(sum(1 for w, x, y, z in product([0, 1], repeat=4) if int(F(w, x, y, z)) == {val}))"
            else:
                val = R.choice([0, 1])
                good = [r for r in rows if int(F(*r)) == val]
                if not 2 <= len(good) <= 14:
                    continue
                big = R.random() < 0.5
                r = max(good) if big else min(good)
                ans = "".join(map(str, r))
                q = (f"Среди наборов (w, x, y, z), на которых F = {val}, найдите {'наибольший' if big else 'наименьший'}, если "
                     "читать набор как двоичное число wxyz. В ответе запишите четыре цифры набора подряд, без пробелов.")
                tail = (f"good = [''.join(map(str, r)) for r in product([0, 1], repeat=4) if int(F(*r)) == {val}]\n"
                        f"print({'max' if big else 'min'}(good))")
            body = (f"<p>Логическая функция F задаётся выражением \\( {tex[1:-1] if tex.startswith('(') else tex} \\).</p><p>{q}</p>")
            sol = f"from itertools import product\n\ndef F(w, x, y, z):\n    return {py}\n\n" + tail
            lv = 1 if kind == 0 else 2
            break
        else:                         # пять переменных, фрагмент из трёх строк, F = 1
            vs = "vwxyz"
            tex, py = G().rand_expr(3)
            py5 = py
            if not all(v in py5 for v in "wxyz"):
                continue
            op, lit = R.choice([("and", "\\land"), ("or", "\\lor")]), R.choice([("v", "v"), ("(not v)", "\\neg v")])
            py5 = f"({py5}) {op[0]} {lit[0]}"
            tex5 = f"({tex}) {op[1]} {lit[1]}"
            F = eval(f"lambda v, w, x, y, z: bool({py5})")
            good = [r for r in itertools.product([0, 1], repeat=5) if F(*r)]
            if not 3 <= len(good) <= 12:
                continue
            frag = R.sample(good, 3)
            perm = R.sample(vs, 5)
            cols = [[dict(zip(vs, r))[perm[c]] for c in range(5)] for r in frag]
            mask = [[R.random() < 0.4 for _ in range(5)] for _ in range(3)]
            if not 4 <= sum(map(sum, mask)) <= 8:
                continue
            ok = []
            for p in itertools.permutations(vs):
                opts = [[fl for fl in itertools.product([0, 1], repeat=5) if all(mask[ri][c] or fl[c] == cols[ri][c] for c in range(5))
                         and F(**dict(zip(p, fl)))] for ri in range(3)]
                if any(len(set(c)) == 3 for c in itertools.product(*opts)):
                    ok.append("".join(p))
                    if len(ok) > 1:
                        break
            if len(ok) != 1:
                continue
            ans = ok[0]
            rows = [[f"Перем. {i + 1}" for i in range(5)] + ["Функция"]] + \
                   [[("" if mask[ri][c] else str(cols[ri][c])) for c in range(5)] + ["1"] for ri in range(3)]
            body = (f"<p>Логическая функция F задаётся выражением \\( {tex5} \\). Ниже приведён частично заполненный фрагмент "
                    "таблицы истинности функции F, содержащий три различные строки, в которых F = 1. Определите, какому столбцу "
                    "таблицы соответствует каждая из переменных \\( v, w, x, y, z \\).</p>" + tab(rows) +
                    "<p>В ответе напишите буквы v, w, x, y, z в том порядке, в котором идут соответствующие им столбцы, подряд, "
                    "без разделителей.</p>")
            frag_py = "[" + ", ".join("[" + ", ".join("None" if mask[ri][c] else str(cols[ri][c]) for c in range(5)) + "]"
                                       for ri in range(3)) + "]"
            sol = (f"from itertools import product, permutations\n\ndef F(v, w, x, y, z):\n    return {py5}\n\n"
                   f"frag = {frag_py}\nfor p in permutations('vwxyz'):\n"
                   "    opts = [[fl for fl in product([0, 1], repeat=5) if all(row[c] is None or row[c] == fl[c] for c in range(5))\n"
                   "             and F(**dict(zip(p, fl)))] for row in frag]\n"
                   "    if any(len(set(c)) == 3 for c in product(*opts)):\n        print(''.join(p))")
            lv = 3
            break
    add(2, k, body, ans, "Таблицы истинности", code(sol), lv=lv, by_text=True)


# ============================================================ №3 — номер магазина, процент продаж, разница выручки районов
def gen3(R, k):
    G().R = R
    dept, goods = W4.THEMES3[(k + 1) % len(W4.THEMES3)]
    month, mname = G().MONTHS[(k + 2) % len(G().MONTHS)]
    year = 2025
    products = [[i + 1, dept, name, "шт", q, R.randint(3, 60) * 10 + R.choice([0, 5])] for i, (name, q) in enumerate(goods)]
    shops = [[f"M{i + 1}", R.choice(G().DISTRICTS), f"ул. {R.choice(G().STREETS)}, {R.randint(1, 60)}"] for i in range(14)]
    moves, op = [], 1
    for day in range(1, 11):
        for sh in shops:
            for p in R.sample(products, 4):
                inc = R.randint(60, 250)
                moves.append([op, G().dt.date(year, month, day), sh[0], p[0], "Поступление", inc])
                moves.append([op + 1, G().dt.date(year, month, day), sh[0], p[0], "Продажа", R.randint(10, inc - 5)])
                op += 2
    pm, sm = {p[0]: p for p in products}, {s[0]: s for s in shops}
    kind = k % 3
    gen_d = lambda d: d[:-2] + "ого"
    while True:
        d1 = R.randint(1, 4)
        d2 = R.randint(d1 + 3, 10)
        sel = [m for m in moves if d1 <= m[1].day <= d2]
        if kind == 0:                 # номер магазина с наибольшим ростом запаса товара
            g = R.choice(products)
            grow = {}
            for m in sel:
                if m[3] == g[0]:
                    grow[m[2]] = grow.get(m[2], 0) + (m[5] if m[4] == "Поступление" else -m[5])
            if len(grow) < 3:
                continue
            top = sorted(grow.values())
            if top[-1] == top[-2]:
                continue
            best = max(grow, key=grow.get)
            ans = int(best[1:])
            q = (f"Используя информацию из приведённой базы данных, определите магазин, в котором за период с {d1} по {d2} "
                 f"{mname} включительно количество упаковок товара «{g[2]}» в наличии увеличилось больше всего. В ответе "
                 "запишите номер магазина — число после буквы M в его ID.")
        elif kind == 1:               # процент проданных упаковок от поступивших
            dist = R.choice(G().DISTRICTS)
            inc = sum(m[5] for m in sel if m[4] == "Поступление" and sm[m[2]][1] == dist)
            out = sum(m[5] for m in sel if m[4] == "Продажа" and sm[m[2]][1] == dist)
            if not inc:
                continue
            ans = out * 100 // inc
            q = (f"Используя информацию из приведённой базы данных, определите, какой процент составляет количество проданных "
                 f"упаковок товаров от количества поступивших в магазины {gen_d(dist)} района за период с {d1} по {d2} {mname} "
                 "включительно. В ответе запишите только целую часть числа.")
        else:                         # на сколько выручка одного района больше другого
            d_a, d_b = R.sample(G().DISTRICTS, 2)
            rev = lambda d: sum(m[5] * pm[m[3]][5] for m in sel if m[4] == "Продажа" and sm[m[2]][1] == d)
            ra, rb = rev(d_a), rev(d_b)
            if not ra or not rb:
                continue
            ans = ra - rb
            q = (f"Используя информацию из приведённой базы данных, определите, на сколько рублей выручка от продажи товаров в "
                 f"магазинах {gen_d(d_a)} района больше выручки в магазинах {gen_d(d_b)} района за период с {d1} по {d2} {mname} "
                 "включительно. Если меньше — запишите отрицательное число.")
        break
    name = f"3/e3-{k:02d}.xlsx"
    G().write_xlsx(G().MEDIA / name, [
        ("Движение товаров", [["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"]] + moves),
        ("Товар", [["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"]] + products),
        ("Магазин", [["ID магазина", "Район", "Адрес"]] + shops)])
    hdr = lambda cols: tab([cols])
    body = (f"<p>В файле приведён фрагмент базы данных «Магазины» о поставках и продажах товаров отдела «{dept}». База данных "
            "состоит из трёх таблиц.</p><p>Таблица «Движение товаров» содержит записи о поступлении товаров в магазины и об их "
            f"продаже в течение первой декады {mname} {year} г.</p>"
            + hdr(["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"])
            + "<p>Таблица «Товар» содержит информацию об основных характеристиках каждого товара.</p>"
            + hdr(["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"])
            + "<p>Таблица «Магазин» содержит информацию о местонахождении магазинов.</p>" + hdr(["ID магазина", "Район", "Адрес"])
            + '<p>На рисунке приведена схема указанной базы данных.</p><p><img src="media/egeshka_bank/3/schema.svg" '
              'alt="Схема базы данных" width="460"></p>' + f"<p>{q}</p>")
    sol = f"<p>Подтяните к операциям район и цену (ВПР), отфильтруйте даты и посчитайте сводной таблицей. Ответ: {ans}.</p>"
    add(3, k, body, ans, "Базы данных", sol, att=[{"name": "3.xlsx", "href": f"media/egeshka_bank/{name}"}], lv=2 if kind else 3)


# ============================================================ №4 — расшифровка, неравенство Крафта, кратчайшее с наибольшим значением
def gen4(R, k):
    kind = k % 3
    rus = G().RUS
    while True:
        nlet = R.randint(5, 8)
        letters = sorted(R.sample(rus, nlet), key=rus.index)
        pool = ["0", "1"]
        while len(pool) < nlet + (R.randint(1, 2) if kind == 2 else 0):     # для №4в — со свободными ветками
            c = pool.pop(R.randrange(len(pool)))
            pool += [c + "0", c + "1"]
        R.shuffle(pool)
        codes = dict(zip(letters, pool))
        if kind == 0:                 # расшифровать сообщение
            word = "".join(R.choice(letters) for _ in range(R.randint(6, 9)))
            bits = "".join(codes[c] for c in word)
            x = R.choice(letters)
            ans = word.count(x)
            if ans == 0:
                continue
            body = ("<p>Для кодирования букв используется неравномерный двоичный код, удовлетворяющий условию Фано (никакое "
                    "кодовое слово не является началом другого):</p>" + tab([["Буква", "Код"]] + [[l, codes[l]] for l in letters]) +
                    f"<p>Получено закодированное сообщение:</p><p><b>{bits}</b></p><p>Сколько раз в исходном сообщении встречается "
                    f"буква {x}?</p>")
            sol = ("codes = {" + ", ".join(f"'{l}': '{codes[l]}'" for l in letters) + "}\nback = {v: k for k, v in codes.items()}\n"
                   f"bits, cur, word = '{bits}', '', ''\nfor b in bits:\n    cur += b\n    if cur in back:\n        word += back[cur]\n"
                   f"        cur = ''\nprint(word.count('{x}'))")
            lv = 2
        elif kind == 1:               # сколько слов длины L ещё можно взять (неравенство Крафта)
            la = R.randint(1, 3)
            lc = R.randint(la + 1, la + 2)
            lb = R.randint(lc + 1, lc + 3)
            a = R.randint(1, 2 ** la - 1)
            c = R.randint(1, 6)
            ans = 2 ** lb - a * 2 ** (lb - la) - c * 2 ** (lb - lc)
            if ans <= 0 or c >= (2 ** la - a) * 2 ** (lc - la):
                continue
            body = (f"<p>Для кодирования некоторого алфавита используется неравномерный двоичный код, удовлетворяющий условию "
                    f"Фано. Уже выбрано {a} {pl(a, 'кодовое слово', 'кодовых слова', 'кодовых слов')} длины {la} и {c} "
                    f"{pl(c, 'кодовое слово', 'кодовых слова', 'кодовых слов')} длины {lc}. Остальные буквы решили кодировать "
                    f"словами длины {lb}. Какое наибольшее количество букв можно закодировать словами длины {lb}, чтобы код "
                    "по-прежнему удовлетворял условию Фано?</p>")
            sol = (f"# слово длины L «занимает» 2 ** ({lb} - L) слов длины {lb}\n"
                   f"print(2 ** {lb} - {a} * 2 ** ({lb} - {la}) - {c} * 2 ** ({lb} - {lc}))")
            lv = 2
        else:                         # кратчайшее слово для буквы — с наибольшим числовым значением
            x = R.choice(letters)
            known = {l: c for l, c in codes.items() if l != x}
            pool2 = list(known.values())
            cand = ["".join(b) for L_ in range(1, 7) for b in itertools.product("01", repeat=L_)]
            cand = [c for c in cand if all(not c.startswith(f) and not f.startswith(c) for f in pool2)]
            if not cand or len([c for c in cand if len(c) == min(map(len, cand))]) < 2:
                continue
            Lm = min(map(len, cand))
            ans = max((c for c in cand if len(c) == Lm), key=lambda c: int(c, 2))
            body = (f"<p>По каналу связи передаются сообщения из букв {', '.join(letters)}. Используется неравномерный двоичный "
                    "код, удовлетворяющий условию Фано. Известны кодовые слова всех букв, кроме буквы " + x + ":</p>"
                    + tab([["Буква", "Код"]] + [[l, known.get(l, "?")] for l in letters]) +
                    f"<p>Укажите кратчайшее кодовое слово для буквы {x}. Если таких слов несколько, укажите слово с "
                    "<b>наибольшим</b> числовым значением.</p>")
            sol = ("from itertools import product\nknown = [" + ", ".join(f"'{c}'" for c in pool2) + "]\n"
                   "for L in range(1, 8):\n    ok = [''.join(b) for b in product('01', repeat=L)\n"
                   "          if all(not ''.join(b).startswith(f) and not f.startswith(''.join(b)) for f in known)]\n"
                   "    if ok:\n        print(max(ok, key=lambda c: int(c, 2)))\n        break")
            lv = 2
        break
    add(4, k, body, ans, "Кодирование, условие Фано", code(sol), lv=lv)


# ============================================================ №5 — разность наибольшего и наименьшего, развёрнутая запись, 16-ричная
RULES5B = [
    ("Из цифр трёхзначного числа N составляются наибольшее и наименьшее трёхзначные числа (наименьшее не может начинаться "
     "с нуля; если это невозможно, берётся само N). Результат R — разность этих чисел.",
     "def R(n):\n    d = sorted(str(n))\n    big = int(''.join(d[::-1]))\n"
     "    small = next((int(''.join(p)) for p in sorted(set(__import__('itertools').permutations(d))) if p[0] != '0'), n)\n"
     "    return big - small", (100, 999), "трёхзначное"),
    ("Строится двоичная запись числа N, затем она переписывается в обратном порядке (ведущие нули отбрасываются). Если "
     "получившееся число чётное, к нему справа дописывается 1, иначе — 0. Результат — двоичная запись числа R.",
     "def R(n):\n    s = bin(n)[2:][::-1].lstrip('0')\n    s += '1' if int(s, 2) % 2 == 0 else '0'\n    return int(s, 2)",
     (1, 4095), "натуральное"),
    ("Строится шестнадцатеричная запись числа N. Если N делится на 3, к записи слева дописывается её последняя цифра, иначе "
     "справа дописывается цифра F. Результат — шестнадцатеричная запись числа R.",
     "def R(n):\n    s = format(n, 'X')\n    s = s[-1] + s if n % 3 == 0 else s + 'F'\n    return int(s, 16)", (1, 4095), "натуральное"),
    ("Строится восьмеричная запись числа N. Все чётные цифры записи заменяются на 7, нечётные остаются. Результат — "
     "восьмеричная запись числа R.",
     "def R(n):\n    s = format(n, 'o')\n    return int(''.join('7' if int(c) % 2 == 0 else c for c in s), 8)", (1, 4095), "натуральное"),
    ("Строится двоичная запись числа N. Если количество единиц в ней больше количества нулей, то запись повторяется дважды "
     "(дописывается сама к себе), иначе справа дописывается столько нулей, сколько в записи единиц. Результат — двоичная "
     "запись числа R.",
     "def R(n):\n    s = bin(n)[2:]\n    s = s + s if s.count('1') > s.count('0') else s + '0' * s.count('1')\n    return int(s, 2)",
     (1, 4095), "натуральное"),
]


def gen5(R, k):
    text, src, (lo, hi), word = RULES5B[k % len(RULES5B)]
    ns = {}
    exec(src, ns)
    Rf = ns["R"]
    q_kind = (k // len(RULES5B)) % 3
    vals = {n: Rf(n) for n in range(lo, hi + 1)}
    while True:
        if q_kind == 0:               # наибольшее R, не превышающее X
            vs = sorted(set(vals.values()))
            X = R.choice(vs[len(vs) // 10: len(vs) * 9 // 10 + 1]) + R.randint(1, 50)
            cand = [v for v in vals.values() if v <= X]
            if not cand:
                continue
            ans = max(cand)
            q = f"Укажите наибольшее число R, не превышающее {X}, которое может быть получено в результате работы алгоритма."
            tail = f"print(max(R(n) for n in range({lo}, {hi + 1}) if R(n) <= {X}))"
        elif q_kind == 1:             # сколько N из отрезка дают R, кратное m
            a = R.randint(lo, max(lo, hi - 600))
            b = min(hi, a + R.randint(150, 500))
            m = R.choice([3, 4, 5, 7, 9])
            ans = sum(1 for n in range(a, b + 1) if vals[n] % m == 0)
            if ans == 0:
                continue
            q = f"Для скольких чисел N из отрезка [{a}; {b}] результат R кратен {m}?"
            tail = f"print(sum(1 for n in range({a}, {b + 1}) if R(n) % {m} == 0))"
        else:                         # наибольшее N, для которого R < X (или R == N в обратную сторону)
            vs = sorted(set(vals.values()))
            X = R.choice(vs[len(vs) // 5: len(vs) * 4 // 5 + 1])
            good = [n for n in vals if vals[n] < X]
            if not good:
                continue
            ans = max(good)
            q = f"Укажите наибольшее число N, для которого результат работы алгоритма меньше {X}."
            tail = f"print(max(n for n in range({lo}, {hi + 1}) if R(n) < {X}))"
        break
    ex = lo + 23 if lo + 23 <= hi else lo
    body = f"<p>На вход алгоритма подаётся {word} число N. {text}</p><p>Например, для N = {ex} получаем R = {Rf(ex)}.</p><p>{q}</p>"
    add(5, k, body, ans, "Алгоритмы обработки чисел", code(src + "\n\n" + tail), lv=2 if q_kind != 1 else 3)


# ============================================================ №6 — Чертёжник, правильные многоугольники, общие точки контуров
def gen6(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # Чертёжник: смещения на вектор
            vecs = []
            x = y = 0
            for _ in range(R.randint(3, 5)):
                dx, dy = R.randint(-12, 12), R.randint(-12, 12)
                if dx == dy == 0:
                    continue
                vecs.append((dx, dy))
                x += dx
                y += dy
            vecs.append((-x, -y))
            rep = R.choice([1, 2, 3])
            poly = [(0, 0)]
            for dx, dy in vecs:
                poly.append((poly[-1][0] + dx, poly[-1][1] + dy))
            poly = poly[:-1]
            if len(set(poly)) != len(poly):
                continue
            segs = [(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]

            def cross(p, q, r, s):
                d = lambda a, b, c: (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
                return d(p, q, r) * d(p, q, s) < 0 and d(r, s, p) * d(r, s, q) < 0
            if any(cross(*segs[i], *segs[j]) for i in range(len(segs)) for j in range(i + 2, len(segs))
                   if not (i == 0 and j == len(segs) - 1)):
                continue
            x0, x1 = min(p[0] for p in poly) - 1, max(p[0] for p in poly) + 1
            y0, y1 = min(p[1] for p in poly) - 1, max(p[1] for p in poly) + 1
            strict = R.random() < 0.5
            ans = sum(1 for px in range(x0, x1 + 1) for py in range(y0, y1 + 1)
                      if (M.where(px, py, poly) > 0 if strict else M.where(px, py, poly) >= 0))
            if ans < 4:
                continue
            prog = "".join(f"Сместиться на ({dx}, {dy}) " for dx, dy in vecs).strip()
            body = ("<p>Исполнитель Чертёжник перемещается на координатной плоскости, оставляя след в виде линии. Чертёжник "
                    "может выполнять команду <b>Сместиться на (a, b)</b>, где a, b — целые числа. Эта команда перемещает "
                    "Чертёжника из точки с координатами (x, y) в точку с координатами (x + a, y + b). Запись <b>Повтори k "
                    "[…]</b> означает, что команды в скобках повторяются k раз.</p>"
                    f"<p>Чертёжник находится в начале координат. Ему дан для исполнения алгоритм:</p><p><b>"
                    + (f"Повтори {rep} [{prog}]" if rep > 1 else prog) + "</b></p>"
                    "<p>Определите, сколько точек с целочисленными координатами находятся внутри области, ограниченной линией, "
                    "которую нарисовал Чертёжник. " + ("Точки на линии учитывать не следует." if strict else "Точки на линии "
                                                         "следует учитывать.") + "</p>")
            sol = ("import math\nvecs = " + str(vecs) + "\npts, x, y = [(0, 0)], 0, 0\nfor dx, dy in vecs:\n    x += dx\n    y += dy\n"
                   "    pts.append((x, y))\n\ndef where(px, py, f):          # 1 — внутри, 0 — на линии, -1 — снаружи\n"
                   "    ins = False\n    for (x1, y1), (x2, y2) in zip(f, f[1:]):\n"
                   "        cr = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)\n"
                   "        if cr == 0 and min(x1, x2) <= px <= max(x1, x2) and min(y1, y2) <= py <= max(y1, y2):\n"
                   "            return 0\n        if (y1 > py) != (y2 > py) and x1 + (py - y1) * (x2 - x1) / (y2 - y1) > px:\n"
                   "            ins = not ins\n    return 1 if ins else -1\n\n"
                   f"print(sum(1 for px in range(-100, 101) for py in range(-100, 101) if where(px, py, pts) {'>' if strict else '>='} 0))")
            lv = 2
        elif kind == 1:               # правильные пятиугольник / восьмиугольник
            m = R.choice([5, 8, 8, 6])
            a = R.randint(6, 16)
            prog = [("REP", R.choice([m, m + 1, 2 * m]), [("F", a), ("R", 360 // m)])]
            polys = M.t_run(prog)
            if not polys:
                continue
            x0, x1, y0, y1 = M.box(polys)
            ans = sum(1 for px in range(x0, x1 + 1) for py in range(y0, y1 + 1) if M.where(px, py, polys[0]) > 0)
            body = (M.TURTLE_HEAD.format(cnt="две", ending="ы", extra="")
                    + f"<p>Черепахе был дан для исполнения следующий алгоритм:</p><p><b>{M.t_text(prog)}</b></p>"
                    "<p>Определите, сколько точек с целочисленными координатами находятся внутри области, ограниченной линией, "
                    "заданной данным алгоритмом. Точки на линии учитывать не следует.</p>")
            sol = M.T6_SOL.replace("{prog}", "\n".join(M.t_py(prog))).replace("{cond}", "w[0] > 0")
            lv = 2
        else:                         # точки, лежащие на обеих линиях
            a, b = R.randint(5, 16), R.randint(5, 16)
            c, d = R.randint(5, 16), R.randint(5, 16)
            sx, sy = R.randint(1, a - 1), R.randint(1, b - 1)
            rect = lambda p, q: ("REP", 2, [("F", p), ("R", 90), ("F", q), ("R", 90)])
            prog = [rect(a, b), ("U",), ("F", sx), ("R", 90), ("F", sy), ("L", 90), ("D",), rect(c, d)]
            polys = M.t_run(prog)
            x0, x1, y0, y1 = M.box(polys)
            both = R.random() < 0.5
            if both:
                ans = sum(1 for px in range(x0, x1 + 1) for py in range(y0, y1 + 1)
                          if M.where(px, py, polys[0]) == 0 and M.where(px, py, polys[1]) == 0)
                cond, qq = "w[0] == 0 and w[1] == 0", "лежат одновременно на обеих линиях"
            else:
                ans = sum(1 for px in range(x0, x1 + 1) for py in range(y0, y1 + 1)
                          if M.where(px, py, polys[0]) == 0 or M.where(px, py, polys[1]) == 0)
                cond, qq = "w[0] == 0 or w[1] == 0", "лежат хотя бы на одной из линий"
            if ans < 2:
                continue
            body = (M.TURTLE_HEAD.format(cnt="пять", ending="", extra=M.TURTLE_EXTRA)
                    + f"<p>Черепахе был дан для исполнения следующий алгоритм:</p><p><b>{M.t_text(prog)}</b></p>"
                    f"<p>Определите, сколько точек с целочисленными координатами {qq}, нарисованных Черепахой.</p>")
            sol = M.T6_SOL.replace("{prog}", "\n".join(M.t_py(prog))).replace("{cond}", cond)
            lv = 2
        break
    add(6, k, body, ans, "Черепашка", code(sol), lv=lv)


# ============================================================ №7 — видео, исходная палитра, масштабирование, серия фото по каналу
def gen7(R, k):
    kind = k % 4
    while True:
        if kind == 0:                 # видео без сжатия
            w, h = R.choice([(320, 240), (640, 360), (640, 480), (800, 600), (1280, 720)])
            colors = R.choice([256, 65536, 2 ** 24])
            fps = R.choice([10, 12, 24, 25, 30])
            secs = R.randint(5, 40)
            size = w * h * int(math.log2(colors)) * fps * secs
            ans = math.ceil(size / 8 / 2 ** 20)
            q = (f"Видеофрагмент записан без сжатия и без звука: каждый кадр — растровое изображение {w}×{h} пикселей с "
                 f"палитрой из {colors} цветов, частота — {fps} кадров в секунду, длительность — {secs} с. Какой минимальный "
                 "объём памяти (в Мбайт) нужно отвести под этот видеофрагмент? В ответе запишите целое число.")
            sol = f"import math\nprint(math.ceil({w} * {h} * {int(math.log2(colors))} * {fps} * {secs} / 8 / 2 ** 20))"
            lv = 2
        elif kind == 1:               # какая была палитра
            w, h = R.choice([(1024, 768), (640, 480), (800, 600), (1024, 1024), (512, 512)])
            b1 = R.randint(5, 16)
            b2 = R.randint(1, b1 - 2)
            if (b1 - b2) * w * h % 8192:
                continue
            saved = (b1 - b2) * w * h // 8192
            ans = 2 ** b1
            q = (f"Растровое изображение размером {w}×{h} пикселей сохранили без сжатия. Затем количество цветов в палитре "
                 f"уменьшили до {2 ** b2}, и размер файла уменьшился на {saved} Кбайт. Сколько цветов было в палитре "
                 "изначально, если для кодирования цвета используется минимально возможное количество бит?")
            sol = f"b2 = {b2}\nb1 = b2 + {saved} * 8192 // ({w} * {h})\nprint(2 ** b1)"
            lv = 3
        elif kind == 2:               # увеличение размеров и уменьшение палитры
            kx = R.choice([2, 3, 4])
            c1 = R.choice([2 ** 24, 65536, 4096])
            c2 = R.choice([256, 16, 4])
            kb = R.choice([96, 192, 384, 768, 1536, 300, 600])
            b1, b2 = int(math.log2(c1)), int(math.log2(c2))
            new = kb * kx * kx * b2 / b1
            if new != int(new):
                continue
            ans = int(new)
            q = (f"Растровое изображение занимает {kb} Кбайт. Его ширину и высоту увеличили в {kx} раза, а палитру уменьшили с "
                 f"{c1} до {c2} цветов. Сколько Кбайт займёт новое изображение? Сжатие не используется, служебные данные не "
                 "учитываются.")
            sol = f"print({kb} * {kx} * {kx} * {b2} // {b1})"
            lv = 2
        else:                         # передача серии фотографий по каналу
            w, h = R.choice([(1024, 768), (800, 600), (640, 480), (2048, 1536)])
            colors = R.choice([256, 65536, 2 ** 24])
            nph = R.randint(5, 60)
            speed = R.choice([2 ** 20, 2 ** 21, 2 ** 22, 2 ** 23, 2 ** 24])
            bits = w * h * int(math.log2(colors)) * nph
            ans = math.ceil(bits / speed)
            q = (f"Нужно передать {nph} фотографий размером {w}×{h} пикселей с палитрой {colors} цветов по каналу связи со "
                 f"скоростью 2<sup>{int(math.log2(speed))}</sup> бит/с. Фотографии не сжимаются, служебные данные не "
                 "учитываются. Сколько секунд займёт передача? В ответе укажите целое число, округлив вверх.")
            sol = f"import math\nprint(math.ceil({w} * {h} * {int(math.log2(colors))} * {nph} / 2 ** {int(math.log2(speed))}))"
            lv = 1
        break
    topic = ["Кодирование изображений", "Кодирование изображений", "Кодирование изображений", "Архивирование и передача данных"][kind]
    add(7, k, f"<p>{q}</p>", ans, topic, code(sol), lv=lv)


# ============================================================ №8 — палиндромы, «счастливые» числа, букв X больше, чем Y
def gen8(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # палиндромы
            lets = sorted(set(R.choice(M.WORDS)))[:R.choice([4, 5, 6])]
            L = R.choice([5, 6, 7])
            x = R.choice(lets)
            words = ["".join(p) for p in itertools.product(lets, repeat=L)]
            cnd = R.choice([("в которых встречается буква " + x, lambda w: x in w, f"'{x}' in w"),
                             ("в которых нет буквы " + x, lambda w: x not in w, f"'{x}' not in w"),
                             ("в которых буква " + x + " встречается ровно два раза", lambda w: w.count(x) == 2, f"w.count('{x}') == 2")])
            adj = R.random() < 0.6
            good = [w for w in words if w == w[::-1] and cnd[1](w) and (not adj or not any(a == b for a, b in zip(w, w[1:])))]
            ans = len(good)
            if ans < 3:
                continue
            q = (f"<p>Сколько существует {L}-буквенных слов-палиндромов (читающихся одинаково слева направо и справа налево), "
                 f"составленных из букв {', '.join(lets)}, {cnd[0]}" + (" и никакие две соседние буквы не совпадают" if adj else "")
                 + "? Каждая буква может встречаться любое число раз.</p>")
            sol = (f"from itertools import product\ncnt = 0\nfor p in product('{''.join(lets)}', repeat={L}):\n    w = ''.join(p)\n"
                   f"    if w == w[::-1] and {cnd[2]}" + (" and all(a != b for a, b in zip(w, w[1:]))" if adj else "") + ":\n        cnt += 1\nprint(cnt)")
            lv = 2
        elif kind == 1:               # «счастливые» числа: сумма первой половины больше второй на d
            b = R.choice([5, 6, 7, 8, 9])
            L = R.choice([4, 6]) if b <= 7 else 4
            h = L // 2
            d = R.randint(0, 3)
            q_ = R.choice([h, h + 1])
            f0 = R.randint(1, 3)                       # первая цифра не меньше f0
            ans = sum(1 for p in itertools.product(range(b), repeat=L)
                      if p[0] >= f0 and sum(p[:h]) - sum(p[h:]) == d and len(set(p)) >= q_)
            if ans < 3:
                continue
            bname = {5: "пятеричных", 6: "шестеричных", 7: "семеричных", 8: "восьмеричных", 9: "девятеричных"}[b]
            lname = {4: "четырёхзначных", 6: "шестизначных"}[L]
            cond = "равна сумме второй половины" if d == 0 else f"больше суммы второй половины ровно на {d}"
            q = (f"<p>Определите количество {lname} {bname} чисел, у которых сумма цифр первой половины записи {cond}, а в "
                 f"записи числа не меньше {q_} различных цифр" + (f", причём первая цифра не меньше {f0}" if f0 > 1 else "") + ".</p>")
            sol = (f"from itertools import product\ncnt = 0\nfor p in product(range({b}), repeat={L}):\n"
                   f"    if p[0] >= {f0} and sum(p[:{h}]) - sum(p[{h}:]) == {d} and len(set(p)) >= {q_}:\n        cnt += 1\nprint(cnt)")
            lv = 2
        else:                         # букв X больше, чем букв Y
            w = R.choice(M.WORDS)
            lets = "".join(sorted(set(w)))
            if len(lets) > 6:
                continue
            L = R.choice([5, 6]) if len(lets) <= 5 else 5
            x, y = R.sample(lets, 2)
            ans = sum(1 for p in itertools.product(lets, repeat=L) if p.count(x) > p.count(y) and p[-1] != x)
            nm = R.choice(M.NAMES)
            q = (f"<p>{nm} составляет {L}-буквенные слова из букв {', '.join(lets)}; буквы могут повторяться. Сколько слов он "
                 f"может составить, если букв {x} в слове должно быть больше, чем букв {y}, а последняя буква — не {x}?</p>")
            sol = (f"from itertools import product\nprint(sum(1 for p in product('{lets}', repeat={L}) "
                   f"if p.count('{x}') > p.count('{y}') and p[-1] != '{x}'))")
            lv = 2
        break
    add(8, k, q, ans, "Подсчёт комбинаций", code(sol), lv=lv)


# ============================================================ №9 — две группы с равными суммами, «больше всех остальных», медиана
def gen9(R, k):
    kind = k % 3
    rows_n = R.randint(25, 45) * 100
    if kind == 0:
        cols, hi = 5, R.choice([20, 30, 50])
        test = ("    s = sum(r)\n    if s % 2 == 0 and any(sum(c) * 2 == s for m in range(1, 5) for c in combinations(r, m)):")
        ask = "количество строк таблицы, числа которых можно разбить на две группы с равными суммами (каждое число — ровно в одну группу)"
        res = "best = (best or 0) + 1"
    elif kind == 1:
        cols, hi = 5, R.choice([60, 100])
        test = "    if max(r) > sum(r) - max(r) and len(set(r)) == 5:"
        ask = ("сумму наибольших чисел всех строк таблицы, в которых все числа различны и наибольшее число строки больше суммы "
               "четырёх остальных")
        res = "best = (best or 0) + max(r)"
    else:
        cols, hi = 5, R.choice([100, 500, 1000])
        test = "    a = sorted(r)\n    if a[2] > sum(r) / 5 and a[4] - a[0] < 2 * a[2]:"
        ask = ("наибольшую сумму чисел строки среди строк, в которых медиана (среднее по величине из пяти чисел) больше "
               "среднего арифметического чисел строки, а разность наибольшего и наименьшего чисел меньше удвоенной медианы")
        res = "best = max(best or 0, sum(r))"
    src = "best = None\nfor num, r in enumerate(rows, 1):\n" + test + "\n        " + res
    rows = [[R.randint(1, hi) for _ in range(cols)] for _ in range(rows_n)]
    g = {"rows": rows, "combinations": itertools.combinations}
    exec(src, g)
    if g["best"] is None:
        return gen9(R, k)
    ans = g["best"]
    G().write_xlsx(M.media(9) / f"e9-{k:02d}.xlsx", [("Лист1", rows)])
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            "<p>Откройте файл электронной таблицы, содержащей в каждой строке пять натуральных чисел. "
            f"Определите {ask}.</p><p>В ответе запишите только число.</p>")
    sol = ("from itertools import combinations\nrows = [list(map(int, s.split())) for s in open('9.txt') if s.strip()]\n"
           + src + "\nprint(best)")
    add(9, k, body, ans, "Обработка числовой информации в электронных таблицах", code(sol),
        att=[{"name": "9.xlsx", "href": f"media/egeshka_bank/9/e9-{k:02d}.xlsx"}], lv=3 if kind == 0 else 2)


# ============================================================ №10 — сумма байтов, разные сети, «без 11», адрес сети по размеру
def gen10(R, k):
    kind = k % 4
    ip_s, mask_of = M.ip_s, M.mask_of
    while True:
        ip = R.choice([R.randint(1, 223), 10, 172, 192]) << 24 | R.getrandbits(24)
        if kind == 0:                 # сумма четырёх байтов кратна m
            p = R.randint(18, 24)
            net = ip & mask_of(p)
            m = R.choice([3, 4, 5, 7, 9])
            ans = sum(1 for a in range(net, net + 2 ** (32 - p)) if sum(a >> s & 255 for s in (0, 8, 16, 24)) % m == 0)
            q = (f"Сеть задана IP-адресом {ip_s(net)} и маской сети {ip_s(mask_of(p))}. Сколько в этой сети IP-адресов, у "
                 f"которых сумма четырёх байтов адреса (в десятичной записи) кратна {m}?")
            sol = (f"from ipaddress import ip_network\nnet = ip_network('{ip_s(net)}/{ip_s(mask_of(p))}')\n"
                   f"print(sum(1 for a in net if sum(map(int, str(a).split('.'))) % {m} == 0))")
            head, lv = M.IP_HEAD, 2
        elif kind == 1:               # наименьшее число единиц в маске, при котором узлы в разных сетях
            p = R.randint(12, 28)
            ip2 = ip ^ (1 << (31 - p)) ^ R.getrandbits(31 - p)
            same = [q_ for q_ in range(1, 33) if ip & mask_of(q_) == ip2 & mask_of(q_)]
            ans = max(same) + 1
            q = (f"Узлы с IP-адресами {ip_s(ip)} и {ip_s(ip2)} находятся в разных сетях. Каково наименьшее возможное количество "
                 "единиц в маске этих сетей (маска у обеих сетей одна и та же)?")
            sol = (f"from ipaddress import ip_address\na, b = int(ip_address('{ip_s(ip)}')), int(ip_address('{ip_s(ip2)}'))\n"
                   "for p in range(1, 33):\n    m = (2 ** 32 - 1) ^ (2 ** (32 - p) - 1)\n    if a & m != b & m:\n        print(p)\n        break")
            head, lv = M.IP_HEAD, 2
        elif kind == 2:               # без двух единиц подряд
            p = R.randint(18, 24)
            net = ip & mask_of(p)
            ans = sum(1 for a in range(net, net + 2 ** (32 - p)) if "11" not in format(a, "032b"))
            if ans == 0:
                continue
            q = (f"Сеть задана IP-адресом {ip_s(net)} и маской сети {ip_s(mask_of(p))}. Сколько в этой сети IP-адресов, в "
                 "32-битной двоичной записи которых нет двух единиц подряд?")
            sol = (f"from ipaddress import ip_network\nnet = ip_network('{ip_s(net)}/{ip_s(mask_of(p))}')\n"
                   "print(sum(1 for a in net if '11' not in format(int(a), '032b')))")
            if ans < 2:
                continue
            head, lv = M.IP_HEAD, 2
        else:                         # адрес сети по числу адресов в ней
            p = R.randint(16, 29)
            net = ip & mask_of(p)
            ans = "".join(ip_s(net).split("."))
            q = (f"Узел с IP-адресом {ip_s(ip)} находится в сети, в которой всего {2 ** (32 - p)} IP-адресов (включая адрес сети и "
                 "широковещательный адрес). Найдите адрес этой сети и запишите его в ответе без точек.")
            sol = (f"from ipaddress import ip_network\nimport math\np = 32 - int(math.log2({2 ** (32 - p)}))\n"
                   f"print(str(ip_network('{ip_s(ip)}/' + str(p), strict=False).network_address).replace('.', ''))")
            head, lv = M.IP_HEAD, 2
        break
    add(10, k, head + f"<p>{q}</p>", ans, "Маска подсети", code(sol), lv=lv)


# ============================================================ №11 — автомобильные номера, длиннее пароль, наименьший алфавит
def gen11(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # автомобильные номера
            nl = R.choice([12, 15, 20])
            reg = R.choice([2, 3])
            L = 6 + reg
            N = R.choice([30, 50, 100, 128, 200, 500, 1000])
            bits = math.ceil(math.log2(nl + 10))
            ans = N * math.ceil(L * bits / 8)
            q = (f"Автомобильный номер состоит из трёх букв (используется {nl} различных букв), трёх десятичных цифр и кода "
                 f"региона из {reg} десятичных цифр — всего {L} символов, записанных подряд. Номер кодируется посимвольно: все "
                 "символы (буквы и цифры) кодируются одинаковым и минимально возможным количеством бит, на номер отводится "
                 f"минимально возможное целое число байт. Сколько байт нужно для хранения {N} номеров?")
            sol = f"import math\nbits = math.ceil(math.log2({nl} + 10))\nprint({N} * math.ceil({L} * bits / 8))"
            lv = 2
        elif kind == 1:               # пароль удлинили
            m = R.choice([10, 26, 33, 52, 62, 64, 100])
            L = R.randint(6, 40)
            d = R.randint(1, 10)
            N = R.choice([50, 100, 256, 1000, 2048])
            b = math.ceil(math.log2(m))
            ans = N * (math.ceil((L + d) * b / 8) - math.ceil(L * b / 8))
            if ans == 0:
                continue
            q = (f"Пароли состоят из {L} символов {m}-символьного алфавита; каждый пароль хранится в минимально возможном целом "
                 f"числе байт, символы кодируются одинаковым и минимально возможным количеством бит. Пароли удлинили на {d} "
                 f"{pl(d, 'символ', 'символа', 'символов')}. На сколько байт больше памяти теперь нужно для хранения паролей "
                 f"{N} пользователей?")
            sol = f"import math\nb = math.ceil(math.log2({m}))\nprint({N} * (math.ceil({L + d} * b / 8) - math.ceil({L} * b / 8)))"
            lv = 2
        else:                         # наименьший алфавит для X различных паролей
            L = R.randint(3, 8)
            X = R.randint(10 ** 4, 10 ** 9)
            ans = next(m for m in range(2, 10 ** 6) if m ** L >= X)
            q = (f"Пароль состоит ровно из {L} символов. Какое наименьшее количество различных символов должно быть в алфавите, "
                 f"чтобы можно было составить не менее {X} различных паролей?")
            sol = f"m = 2\nwhile m ** {L} < {X}:\n    m += 1\nprint(m)"
            lv = 1
        break
    add(11, k, f"<p>{q}</p>", ans, "Равномерное кодирование текстовой информации", code(sol), lv=lv)


# ============================================================ №12 — число тактов, троичная лента, сумма результатов
def tm_steps(prog, tape, limit=2000):
    tape = dict(enumerate(tape))
    pos, st = len(tape), 0
    for step in range(1, limit + 1):
        sym = tape.get(pos, "λ")
        if (st, sym) not in prog:
            return None
        w, mv, nx = prog[(st, sym)]
        tape[pos] = w
        st = nx
        if mv == "S":
            return "".join(tape[i] for i in sorted(tape)).strip("λ"), step
        pos += 1 if mv == "R" else -1
    return None


def gen12(R, k):
    kind = k % 3
    syms = "012" if kind == 1 else "01"
    while True:
        ns = R.choice([3, 4])
        prog = {(0, "λ"): ("λ", "L", 1)}
        for s in range(1, ns):
            for y in "λ" + syms:
                w = y if R.random() < 0.5 else R.choice(syms if y != "λ" else "λ" + syms)
                prog[(s, y)] = (w, R.choice("LLRS" if s == ns - 1 else "LLLR"), R.randrange(1, ns))
        if kind == 1:
            X = R.randint(50, 3000)
            tape = ""
            v = X
            while v:
                tape = str(v % 3) + tape
                v //= 3
        else:
            X = R.randint(100, 5000)
            tape = bin(X)[2:]
        r = tm_steps(prog, tape)
        if not r or not r[0] or "λ" in r[0] or r[1] < 6:
            continue
        used = set()
        t2 = dict(enumerate(tape))
        pos, st = len(t2), 0
        while True:
            sym = t2.get(pos, "λ")
            used.add((st, sym))
            w, mv, st = prog[(st, sym)]
            t2[pos] = w
            if mv == "S":
                break
            pos += 1 if mv == "R" else -1
        if kind == 2:                 # программа должна работать на всех N от 1 до 100
            res = []
            for n in range(1, 101):
                rr = tm_steps(prog, bin(n)[2:])
                if not rr or not rr[0] or "λ" in rr[0]:
                    break
                res.append(int(rr[0], 2))
                tt = dict(enumerate(bin(n)[2:]))
                pos, st = len(tt), 0
                while True:
                    sym = tt.get(pos, "λ")
                    used.add((st, sym))
                    w, mv, st = prog[(st, sym)]
                    tt[pos] = w
                    if mv == "S":
                        break
                    pos += 1 if mv == "R" else -1
            if len(res) < 100:
                continue
        prog = {u: prog[u] for u in used}
        states = sorted({u[0] for u in used} | {v[2] for v in prog.values()})
        if states != list(range(len(states))) or len(states) < 3:
            continue
        if kind == 0:
            ans = r[1]
            q = ("Сколько тактов выполнит исполнитель МТ, прежде чем остановится? Такт, на котором выполняется команда с «S», "
                 "тоже считается.")
            start = f"двоичное представление числа {X}"
            tail = f"print(run('{tape}')[1])"
        elif kind == 1:
            ans = int(r[0], 3)
            q = "Определите результат выполнения программы — число, записанное на ленте в троичной системе. Ответ запишите в десятичной системе."
            start = f"троичное представление числа {X}"
            tail = f"print(int(run('{tape}')[0], 3))"
        else:
            ans = sum(res)
            q = ("Программу запустили по очереди для каждого натурального N от 1 до 100. Найдите сумму всех полученных "
                 "результатов, если каждый результат читать как двоичную запись числа.")
            start = "двоичное представление натурального числа N"
            tail = "print(sum(int(run(bin(n)[2:])[0], 2) for n in range(1, 101)))"
        break
    cell = lambda c: f"{c[0]}, {c[1]}, q<sub>{c[2]}</sub>" if c else ""
    table = tab([["", "λ"] + list(syms)] + [[f"q<sub>{s}</sub>"] + [cell(prog.get((s, y))) for y in "λ" + syms]
                                            for s in range(len(states))])
    body = (M.TM_HEAD + "<p><u>Выполните задание.</u></p>"
            f"<p>На ленте в соседних ячейках записано {start} без ведущих нулей. Ячейки справа и слева от последовательности "
            "заполнены пустыми символами «λ». В начальный момент времени головка расположена в ближайшей справа к "
            f"последовательности ячейке.</p><p>Программа работы исполнителя:</p>{table}<p>{q}</p>")
    sol = ("prog = {\n" + "".join(f"    ({s}, '{y}'): ('{w}', '{m}', {n}),\n" for (s, y), (w, m, n) in sorted(prog.items()))
           + "}\n\ndef run(tape):\n    tape = dict(enumerate(tape))\n    pos, st, steps = len(tape), 0, 0\n    while True:\n"
           "        w, mv, st = prog[(st, tape.get(pos, 'λ'))]\n        tape[pos] = w\n        steps += 1\n        if mv == 'S':\n"
           "            break\n        pos += 1 if mv == 'R' else -1\n"
           "    return ''.join(tape[i] for i in sorted(tape)).strip('λ'), steps\n\n" + tail)
    add(12, k, body, ans, "Машина Тьюринга", code(sol), lv=3 if kind else 2)


# ============================================================ №13 — длина программы, отрезок в траектории, убывающий исполнитель
def gen13(R, k):
    kind = k % 3
    while True:
        if kind == 2:                 # убывающий исполнитель
            ops = [("Вычесть 1", "x - 1", lambda x: x - 1), ("Вычесть 3", "x - 3", lambda x: x - 3),
                   ("Разделить нацело на 2", "x // 2", lambda x: x // 2)]
            if R.random() < 0.5:
                ops = [ops[0], ("Вычесть 2", "x - 2", lambda x: x - 2), ops[2]]
            a = R.randint(40, 120)
            b = R.randint(2, 15)

            @lru_cache(None)
            def f(x):
                return 1 if x == b else 0 if x < b else sum(f(o[2](x)) for o in ops)
            ans = f(a)
            q = f"Сколько существует программ, которые преобразуют исходное число {a} в число {b}?"
            sol = ("from functools import lru_cache\n\n@lru_cache(None)\ndef f(x):\n" f"    if x == {b}:\n        return 1\n"
                   f"    if x < {b}:\n        return 0\n    return " + " + ".join(f"f({o[1]})" for o in ops) + f"\n\nprint(f({a}))")
            lv = 2
        else:
            pick = R.sample(W4.OPS13X[:3], R.choice([1, 2])) + R.sample(W4.OPS13X[3:5], 1)
            ops = [o for o in W4.OPS13X if o in pick]
            a = R.randint(1, 9)
            if kind == 0:             # программ длины ровно L, результат больше X
                L = R.randint(5, 8)
                res = [a]
                for _ in range(L):
                    res = [o[2](v) for v in res for o in ops]
                X = sorted(res)[len(res) // 2] + R.randint(-5, 5)
                ans = sum(1 for v in res if v > X)
                q = f"Сколько существует программ, содержащих ровно {L} команд, которые преобразуют исходное число {a} в число, большее {X}?"
                lines = "\n".join(f"        {'if' if i == 0 else 'elif'} c == {i}:\n            x = {o[1]}" for i, o in enumerate(ops))
                sol = (f"from itertools import product\ncnt = 0\nfor prog in product(range({len(ops)}), repeat={L}):\n    x = {a}\n"
                       f"    for c in prog:\n{lines}\n    if x > {X}:\n        cnt += 1\nprint(cnt)")
                lv = 2
            else:                     # траектория содержит хотя бы одно число из отрезка
                b = R.randint(30, 80)
                p1 = R.randint(a + 3, b - 8)
                p2 = p1 + R.randint(2, 6)

                @lru_cache(None)
                def f(x, hit):
                    if x > b:
                        return 0
                    hit = hit or p1 <= x <= p2
                    if x == b:
                        return 1 if hit else 0
                    return sum(f(o[2](x), hit) for o in ops)
                ans = f(a, False)
                q = (f"Сколько существует программ, для которых при исходном числе {a} результатом является число {b}, и при этом "
                     f"траектория вычислений содержит хотя бы одно число из отрезка [{p1}; {p2}]?")
                sol = ("from functools import lru_cache\n\n@lru_cache(None)\ndef f(x, hit):\n" f"    if x > {b}:\n        return 0\n"
                       f"    hit = hit or {p1} <= x <= {p2}\n    if x == {b}:\n        return 1 if hit else 0\n    return "
                       + " + ".join(f"f({o[1]}, hit)" for o in ops) + f"\n\nprint(f({a}, False))")
                lv = 3
        if 5 <= ans <= 10 ** 7:
            break
    name = R.choice(M.EXEC)
    lst = "<br>".join(f"{i + 1}. {o[0]}" for i, o in enumerate(ops))
    body = (f"<p>Исполнитель {name} преобразует число на экране. У исполнителя есть {['', '', 'две', 'три'][len(ops)]} "
            f"команды, которым присвоены номера:</p><p>{lst}</p><p>Программа — это последовательность команд. Траектория "
            "вычислений — последовательность результатов выполнения всех команд программы"
            + (" (команда «Разделить нацело на 2» отбрасывает остаток: из 7 получается 3)" if kind == 2 else "") +
            f".</p><p>{q}</p>")
    add(13, k, body, ans, "Подсчёт количества программ", code(sol), lv=lv)


# ============================================================ №14 — две неизвестные цифры, буквы в 16-ричной записи, большие цифры
def gen14(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # две неизвестные цифры x и y
            p = R.randint(8, 20)
            m = R.choice([7, 9, 11, 13, 17, 19, 23])
            DIG = M.DIG
            a_s = R.choice(DIG[1:p]) + "x" + R.choice(DIG[:p]) + "y"
            b_s = "y" + R.choice(DIG[:p]) + "x" + R.choice(DIG[:p])
            ok = []
            for x in range(p):
                for y in range(1, p):
                    v = int(a_s.replace("x", DIG[x]).replace("y", DIG[y]), p) + int(b_s.replace("x", DIG[x]).replace("y", DIG[y]), p)
                    if v % m == 0:
                        ok.append((x * p + y, v // m))
            if not ok:
                continue
            ans = min(ok)[1]
            q = (f"<p>Операнды арифметического выражения записаны в системе счисления с основанием {p}:</p><p>"
                 f"{a_s.replace('x', '<i>x</i>').replace('y', '<i>y</i>')}<sub>{p}</sub> + "
                 f"{b_s.replace('x', '<i>x</i>').replace('y', '<i>y</i>')}<sub>{p}</sub></p>"
                 f"<p>В записи чисел <i>x</i> и <i>y</i> — неизвестные цифры {p}-ричной системы. Среди всех пар (<i>x</i>, <i>y</i>), "
                 f"при которых значение выражения кратно {m}, выберите ту, для которой двузначное число <i>xy</i><sub>{p}</sub> "
                 f"наименьшее. Для этой пары укажите частное от деления значения выражения на {m} в десятичной системе.</p>"
                 + ("<p>Цифры, большие 9, обозначаются латинскими буквами: A = 10, B = 11 и т. д.</p>" if p > 10 else ""))
            sol = ("alph = '0123456789ABCDEFGHIJ'\nbest = None\n"
                   f"for x in range({p}):\n    for y in range(1, {p}):\n"
                   f"        v = int('{a_s}'.replace('x', alph[x]).replace('y', alph[y]), {p}) + int('{b_s}'.replace('x', alph[x]).replace('y', alph[y]), {p})\n"
                   f"        if v % {m} == 0 and best is None:\n            best = v // {m}\nprint(best)")
            lv = 3
        else:
            p = 16 if kind == 1 else R.choice([7, 8, 9, 12])
            base_pw = [b for b in (2, 4, 8, 16, 32, 64, 256, 3, 9, 27, 81, 5, 25, 7, 49, 12, 144) if any(b == p ** i for i in range(1, 5))
                       or (p == 16 and b in (2, 4, 8, 32, 64, 256)) or (p == 8 and b in (2, 4, 32, 64)) or (p == 9 and b in (3, 27, 81))]
            t = [(R.choice(base_pw), R.randint(50, 600)) for _ in range(2)]
            sub = R.randint(1, 300)
            v = t[0][0] ** t[0][1] + t[1][0] ** t[1][1] - sub
            s = M.to_base(v, p)
            if kind == 1:
                ans = sum(1 for c in s if c in "ABCDEF")
                ask = "Сколько цифр, обозначаемых буквами (A, B, C, D, E, F), содержится в этой записи?"
                tail = "print(sum(1 for c in s if c in 'ABCDEF'))"
            else:
                d = R.randint(1, p - 2)
                ans = sum(1 for c in s if int(c, 36) > d)
                ask = f"Сколько цифр, больших {d}, содержится в этой записи?"
                tail = f"print(sum(1 for c in s if int(c, 36) > {d}))"
            if ans == 0:
                continue
            q = (f"<p>Значение арифметического выражения</p><p>{t[0][0]}<sup>{t[0][1]}</sup> + {t[1][0]}<sup>{t[1][1]}</sup> − {sub}</p>"
                 f"<p>записали в системе счисления с основанием {p}. {ask}</p>")
            sol = (f"v = {t[0][0]} ** {t[0][1]} + {t[1][0]} ** {t[1][1]} - {sub}\ns = ''\nwhile v:\n"
                   f"    s = '0123456789ABCDEF'[v % {p}] + s\n    v //= {p}\n" + tail)
            lv = 2
        break
    add(14, k, q, ans, "Выражение с неизвестными цифрами" if kind == 0 else "Длинная арифметика", code(sol), lv=lv)


# ============================================================ №15 — сколько A подходит, x² + y²
def gen15(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # сколько натуральных A из [1; 100] подходят (ДЕЛ)
            a, b = R.sample([2, 3, 4, 5, 6, 8, 9, 10, 12, 14, 15, 18, 20, 21, 24, 28, 30], 2)
            form = R.randint(0, 2)
            if form == 0:
                tex, py = f"ДЕЛ(x, A) → (ДЕЛ(x, {a}) → ДЕЛ(x, {b}))", f"(not x % A == 0) or (not x % {a} == 0) or (x % {b} == 0)"
                good = lambda A: M.lcm(A, a) % b == 0
            elif form == 1:
                tex, py = f"(ДЕЛ(x, {a}) ∧ ДЕЛ(x, {b})) → ДЕЛ(x, A)", f"(not (x % {a} == 0 and x % {b} == 0)) or (x % A == 0)"
                good = lambda A: M.lcm(a, b) % A == 0
            else:
                tex, py = f"(ДЕЛ(x, A) ∧ ¬ДЕЛ(x, {a})) → ¬ДЕЛ(x, {b})", f"(not (x % A == 0 and x % {a} != 0)) or (x % {b} != 0)"
                good = lambda A: M.lcm(A, b) % a == 0
            ans = sum(1 for A in range(1, 101) if good(A))
            if not 2 <= ans <= 98:
                continue
            q = (f"<p>Обозначим через ДЕЛ(n, m) утверждение «натуральное число n делится без остатка на натуральное число m». "
                 f"Сколько существует натуральных чисел A из отрезка [1; 100], для которых формула</p><p>{tex}</p><p>тождественно "
                 "истинна (то есть принимает значение 1 при любом натуральном значении переменной x)?</p>")
            sol = (f"def ok(A):\n    return all({py} for x in range(1, 10000))\n\nprint(sum(1 for A in range(1, 101) if ok(A)))")
            topic, lv = "Делимость", 2
        elif kind == 1:               # сколько A из [0; 255] подходят (поразрядная конъюнкция)
            a, b = R.sample([5, 7, 9, 12, 13, 14, 19, 21, 22, 25, 26, 28, 29, 35, 37, 41, 44, 45, 49, 52, 56, 58, 60], 2)
            form = R.randint(0, 1)
            if form == 0:
                tex, py = f"(x &amp; {a} = 0) → ((x &amp; {b} ≠ 0) → (x &amp; A ≠ 0))", f"(x & {a} != 0) or (x & {b} == 0) or (x & A != 0)"
            else:
                tex, py = f"(x &amp; A ≠ 0) → ((x &amp; {a} ≠ 0) ∨ (x &amp; {b} ≠ 0))", f"(x & A == 0) or (x & {a} != 0) or (x & {b} != 0)"
            F = eval(f"lambda x, A: {py}")
            ans = sum(1 for A in range(256) if all(F(x, A) for x in range(256)))
            if not 2 <= ans <= 250:
                continue
            q = (f"<p>Обозначим через m &amp; n поразрядную конъюнкцию неотрицательных целых чисел m и n. Сколько существует "
                 f"целых чисел A из отрезка [0; 255], для которых формула</p><p>{tex}</p><p>тождественно истинна (то есть принимает "
                 "значение 1 при любом неотрицательном целом x)?</p>")
            sol = f"def ok(A):\n    return all({py} for x in range(1024))\n\nprint(sum(1 for A in range(256) if ok(A)))"
            topic, lv = "Битовые операции", 3
        else:                         # x² + y²
            c1, c2 = R.randint(5, 30), R.randint(5, 30)
            tex = f"(x² + y² &lt; A) ∨ (x &gt; {c1}) ∨ (y &gt; {c2})"
            ans = c1 * c1 + c2 * c2 + 1
            q = (f"<p>Для какого наименьшего целого неотрицательного числа A выражение</p><p>{tex}</p><p>тождественно истинно, то "
                 "есть принимает значение 1 при любых целых неотрицательных x и y?</p>")
            D = max(c1, c2) + 3
            sol = (f"def ok(A):\n    return all(x * x + y * y < A or x > {c1} or y > {c2} for x in range({D}) for y in range({D}))\n\n"
                   "A = 0\nwhile not ok(A):\n    A += 1\nprint(A)")
            topic, lv = "Графики", 1
        break
    add(15, k, q, ans, topic, code(sol), lv=lv)


# ============================================================ №16 — сумма значений, наименьшее n с F(n) > X, F(n) кратно m
def gen16(R, k):
    kind = k % 3
    while True:
        a1, a2 = R.randint(1, 3), R.randint(1, 4)
        F = {1: 1}
        LIM = 2000
        for n in range(2, LIM + 1):
            F[n] = F[n - 1] + a1 * n if n % 2 else F[n // 2] + a2 * n
        tex = (f"F(1) = 1;<br>F(n) = F(n − 1) + {str(a1) + ' · ' if a1 > 1 else ''}n, если n &gt; 1 и n нечётно;<br>"
               f"F(n) = F(n / 2) + {str(a2) + ' · ' if a2 > 1 else ''}n, если n &gt; 1 и n чётно.")
        fdef = (f"def F(n):\n    if n == 1:\n        return 1\n    if n % 2:\n        return F(n - 1) + {a1} * n\n"
                f"    return F(n // 2) + {a2} * n\n\n")
        if kind == 0:
            N = R.randint(50, 300)
            ans = sum(F[n] for n in range(1, N + 1))
            ask = f"Чему равна сумма F(1) + F(2) + … + F({N})?"
            tail = f"print(sum(F(n) for n in range(1, {N + 1})))"
        elif kind == 1:
            X = R.randint(5000, 500000)
            good = [n for n in range(1, LIM + 1) if F[n] > X]
            if not good:
                continue
            ans = good[0]
            ask = f"Укажите наименьшее n, для которого F(n) &gt; {X}."
            tail = f"n = 1\nwhile F(n) <= {X}:\n    n += 1\nprint(n)"
        else:
            m = R.choice([3, 4, 5, 6, 7])
            lim = R.choice([500, 1000, 2000])
            ans = sum(1 for n in range(1, lim + 1) if F[n] % m == 0)
            ask = f"Сколько существует натуральных n, не превышающих {lim}, для которых значение F(n) кратно {m}?"
            tail = f"print(sum(1 for n in range(1, {lim + 1}) if F(n) % {m} == 0))"
        break
    body = f"<p>Алгоритм вычисления значения функции F(n), где n — натуральное число, задан следующими соотношениями:</p><p>{tex}</p><p>{ask}</p>"
    add(16, k, body, ans, "Рекурсия", code("import sys\nsys.setrecursionlimit(10000)\n" + fdef + tail), lv=2)


# ============================================================ №17 — произведение на цифру, «середина больше краёв», квадрат суммы
def gen17(R, k):
    kind = k % 3
    while True:
        N = R.randint(5000, 10000)
        seq = [R.choice([R.randint(1, 100000), R.randint(1, 999)]) for _ in range(N)]
        if kind == 0:
            d = R.choice([1, 3, 7, 9])
            avg = sum(seq) / N
            good = [x * y for x, y in zip(seq, seq[1:]) if (x * y) % 10 == d and abs(x - y) > avg]
            if not good:
                continue
            ans = f"{len(good)} {max(good)}"
            q = (f"Определите количество пар последовательности, в которых произведение элементов оканчивается на цифру {d}, а "
                 "модуль разности элементов больше среднего арифметического всех чисел последовательности. В ответе запишите "
                 "количество найденных пар, затем максимальное из произведений элементов таких пар.")
            sol = (f"a = [int(s) for s in open('17.txt')]\navg = sum(a) / len(a)\n"
                   f"good = [x * y for x, y in zip(a, a[1:]) if (x * y) % 10 == {d} and abs(x - y) > avg]\nprint(len(good), max(good))")
            lv = 2
        elif kind == 1:
            good = [y for x, y, z in zip(seq, seq[1:], seq[2:]) if y > x + z and (x % 2) != (z % 2)]
            if not good:
                continue
            ans = f"{len(good)} {max(good)}"
            q = ("Определите количество троек последовательности, в которых средний элемент больше суммы двух крайних, а крайние "
                 "элементы разной чётности. В ответе запишите количество найденных троек, затем максимальный из средних "
                 "элементов таких троек. Под тройкой подразумеваются три идущих подряд элемента последовательности.")
            sol = ("a = [int(s) for s in open('17.txt')]\n"
                   "good = [y for x, y, z in zip(a, a[1:], a[2:]) if y > x + z and x % 2 != z % 2]\nprint(len(good), max(good))")
            lv = 2
        else:
            good = [x + y for x, y in zip(seq, seq[1:]) if math.isqrt(x + y) ** 2 == x + y]
            if len(good) < 2:
                continue
            ans = f"{len(good)} {min(good)}"
            q = ("Определите количество пар последовательности, сумма элементов которых является квадратом натурального числа. "
                 "В ответе запишите количество найденных пар, затем минимальную из сумм элементов таких пар.")
            sol = ("from math import isqrt\na = [int(s) for s in open('17.txt')]\n"
                   "good = [x + y for x, y in zip(a, a[1:]) if isqrt(x + y) ** 2 == x + y]\nprint(len(good), min(good))")
            lv = 2
        break
    (M.media(17) / f"e17-{k:02d}.txt").write_text("\n".join(map(str, seq)) + "\n", encoding="utf-8")
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            "<p>В файле содержится последовательность натуральных чисел. Её элементы могут принимать значения от 1 до 100 000 "
            f"включительно. {q} Под парой подразумеваются два идущих подряд элемента последовательности.</p>"
            .replace(" Под парой подразумеваются два идущих подряд элемента последовательности.", "" if kind == 1 else
                     " Под парой подразумеваются два идущих подряд элемента последовательности."))
    add(17, k, body, ans, "Обработка числовой последовательности в файле", code(sol),
        att=[{"name": "17.txt", "href": f"media/egeshka_bank/17/e17-{k:02d}.txt"}], lv=lv)


# ============================================================ №18 — удвоение монеты, маршруты через клетку, финиш в правом столбце
def gen18(R, k):
    kind = k % 3
    while True:
        n = R.randint(8, 12) if kind == 1 else R.randint(10, 16)
        grid = [[R.randint(1, 100) for _ in range(n)] for _ in range(n)]
        walls_r, walls_b = {}, {}
        for _ in range(R.randint(2, 4)):
            if R.random() < 0.5:
                c, r0 = R.randrange(n - 1), R.randrange(n)
                for r in range(r0, min(n, r0 + R.randint(2, n // 2))):
                    walls_r[(r, c)] = True
            else:
                r, c0 = R.randrange(n - 1), R.randrange(n)
                for c in range(c0, min(n, c0 + R.randint(2, n // 2))):
                    walls_b[(r, c)] = True
        preds = lambda r, c: [(rr, cc) for rr, cc, ok in ((r, c - 1, c > 0 and not walls_r.get((r, c - 1))),
                                                          (r - 1, c, r > 0 and not walls_b.get((r - 1, c)))) if ok]
        if kind == 0:                 # монета удваивается, если значение больше, чем в предыдущей клетке
            best = {(0, 0): (grid[0][0], grid[0][0])}
            for r in range(n):
                for c in range(n):
                    if (r, c) == (0, 0):
                        continue
                    opts = []
                    for pr in preds(r, c):
                        if pr in best:
                            gain = grid[r][c] * (2 if grid[r][c] > grid[pr[0]][pr[1]] else 1)
                            opts.append((best[pr][0] + gain, best[pr][1] + gain))
                    if opts:
                        best[(r, c)] = (max(o[0] for o in opts), min(o[1] for o in opts))
            if (n - 1, n - 1) not in best:
                continue
            ans = f"{best[(n - 1, n - 1)][0]} {best[(n - 1, n - 1)][1]}"
            q = ("Если значение в клетке больше значения в клетке, из которой Робот в неё пришёл, Робот получает монету двойного "
                 "достоинства. Определите максимальную и минимальную суммы, которые может собрать Робот, пройдя из левой верхней "
                 "клетки в правую нижнюю. В ответе укажите два числа — сначала максимальную сумму, затем минимальную.")
            dp = ("best = {(0, 0): (v[0][0], v[0][0])}\nfor r in range(n):\n    for c in range(n):\n        if (r, c) == (0, 0):\n"
                  "            continue\n        opts = []\n        for pr, ok in (((r, c - 1), c > 0 and not wall_right(r, c - 1)),\n"
                  "                       ((r - 1, c), r > 0 and not wall_below(r - 1, c))):\n            if ok and pr in best:\n"
                  "                gain = v[r][c] * (2 if v[r][c] > v[pr[0]][pr[1]] else 1)\n"
                  "                opts.append((best[pr][0] + gain, best[pr][1] + gain))\n        if opts:\n"
                  "            best[r, c] = (max(o[0] for o in opts), min(o[1] for o in opts))\nprint(*best[n - 1, n - 1])")
        elif kind == 1:               # маршруты через заданную клетку
            ways = lambda sr, sc, er, ec: None
            fr, fc = R.randint(2, n - 3), R.randint(2, n - 3)

            def count(sr, sc, er, ec):
                w = {}
                for r in range(sr, er + 1):
                    for c in range(sc, ec + 1):
                        if (r, c) == (sr, sc):
                            w[(r, c)] = 1
                            continue
                        w[(r, c)] = sum(w.get(p, 0) for p in preds(r, c) if p[0] >= sr and p[1] >= sc)
                return w[(er, ec)]
            ans = count(0, 0, fr, fc) * count(fr, fc, n - 1, n - 1)
            if ans < 5:
                continue
            col = G().col_name(fc)
            q = (f"Определите количество различных маршрутов Робота из левой верхней клетки в правую нижнюю, проходящих через "
                 f"клетку {col}{fr + 1} (столбец {col}, строка {fr + 1} электронной таблицы).")
            dp = (f"def count(sr, sc, er, ec):\n    w = {{}}\n    for r in range(sr, er + 1):\n        for c in range(sc, ec + 1):\n"
                  "            if (r, c) == (sr, sc):\n                w[r, c] = 1\n                continue\n"
                  "            w[r, c] = (w.get((r, c - 1), 0) if c > sc and not wall_right(r, c - 1) else 0) + \\\n"
                  "                      (w.get((r - 1, c), 0) if r > sr and not wall_below(r - 1, c) else 0)\n"
                  f"    return w[er, ec]\n\nprint(count(0, 0, {fr}, {fc}) * count({fr}, {fc}, n - 1, n - 1))")
        else:                         # финиш в любой клетке правого столбца
            best = {(0, 0): (grid[0][0], grid[0][0])}
            for r in range(n):
                for c in range(n):
                    if (r, c) == (0, 0):
                        continue
                    opts = [best[p] for p in preds(r, c) if p in best]
                    if opts:
                        best[(r, c)] = (max(o[0] for o in opts) + grid[r][c], min(o[1] for o in opts) + grid[r][c])
            ends = [best[(r, n - 1)] for r in range(n) if (r, n - 1) in best]
            if len(ends) < n // 2:
                continue
            ans = f"{max(e[0] for e in ends)} {min(e[1] for e in ends)}"
            q = ("Робот начинает в левой верхней клетке, а закончить маршрут может в любой клетке правого столбца. Определите "
                 "максимальную и минимальную суммы, которые он может собрать. В ответе укажите два числа — сначала максимальную, "
                 "затем минимальную.")
            dp = ("best = {(0, 0): (v[0][0], v[0][0])}\nfor r in range(n):\n    for c in range(n):\n        if (r, c) == (0, 0):\n"
                  "            continue\n        opts = []\n        if c and not wall_right(r, c - 1) and (r, c - 1) in best:\n"
                  "            opts.append(best[r, c - 1])\n        if r and not wall_below(r - 1, c) and (r - 1, c) in best:\n"
                  "            opts.append(best[r - 1, c])\n        if opts:\n"
                  "            best[r, c] = (max(o[0] for o in opts) + v[r][c], min(o[1] for o in opts) + v[r][c])\n"
                  "ends = [best[r, n - 1] for r in range(n) if (r, n - 1) in best]\n"
                  "print(max(e[0] for e in ends), min(e[1] for e in ends))")
        break
    M.write_xlsx_grid(M.media(18) / f"e18-{k:02d}.xlsx", grid, walls_r, walls_b)
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            "<p>Квадрат разлинован на N × N клеток (1 &lt; N &lt; 30). Исполнитель Робот может перемещаться по клеткам, выполняя "
            "за одно перемещение одну из двух команд: <b>вправо</b> или <b>вниз</b>. Между соседними клетками могут быть стены "
            "(в таблице — толстые границы ячеек); сквозь стену и за границу квадрата Робот пройти не может.</p>"
            "<p>В каждой клетке лежит монета достоинством от 1 до 100. Посетив клетку, Робот забирает монету; это относится и к "
            f"начальной, и к конечной клетке маршрута.</p><p>{q}</p><p>Исходные данные — электронная таблица размером N × N.</p>")
    sol = ("import openpyxl\nws = openpyxl.load_workbook('18.xlsx').active\nn = ws.max_row\n"
           "v = [[ws.cell(r + 1, c + 1).value for c in range(n)] for r in range(n)]\n"
           "thick = lambda s: s in ('thick', 'medium')\n"
           "def wall_right(r, c):\n    return thick(ws.cell(r + 1, c + 1).border.right.style) or thick(ws.cell(r + 1, c + 2).border.left.style)\n"
           "def wall_below(r, c):\n    return thick(ws.cell(r + 1, c + 1).border.bottom.style) or thick(ws.cell(r + 2, c + 1).border.top.style)\n"
           + dp)
    add(18, k, body, ans, "Робот в электронных таблицах", code(sol),
        att=[{"name": "18.xlsx", "href": f"media/egeshka_bank/18/e18-{k:02d}.xlsx"}], lv=3 if kind != 2 else 2)


# ============================================================ №19–21 — две убывающие кучи, «в полтора раза», конец по одной куче
def gen19(R, k):
    kind = k % 3
    P, V = R.choice([("Петя", "Ваня"), ("Аня", "Боря"), ("Маша", "Саша"), ("Алиса", "Боб"), ("Лиза", "Гоша"), ("Катя", "Дима")])
    gen_ = lambda w: (w[:-1] + ("и" if w[-1] == "я" or w[-2] in "шжчщкгх" else "ы")) if w[-1] in "ая" else w + "а"
    Pf, Vf = gen_(P), gen_(V)
    while True:
        if kind == 0:                 # две кучи, камни убирают
            K = R.randint(8, 30)
            W = R.randint(6, 24)
            top = R.randint(40, 90)
            mv = lambda s: tuple(x for x in ((s[0] - 1, s[1]), (s[0], s[1] - 1), (s[0] // 2, s[1]), (s[0], s[1] // 2)))
            end = lambda s: s[0] + s[1] <= W
            rng = range(max(1, W - K + 1), top + 1)
            start = lambda s: (K, s)
            rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежат две кучи камней. Игроки ходят по "
                     f"очереди, первый ход делает {P}. За один ход игрок может убрать из одной из куч (по своему выбору) один "
                     "камень или уменьшить количество камней в этой куче в два раза (если количество нечётно, остаётся на один "
                     f"камень меньше половины).</p><p>Игра завершается в тот момент, когда суммарное количество камней в кучах "
                     f"становится не более {W}. Победителем считается игрок, сделавший последний ход. В начальный момент в первой "
                     f"куче было {K} {pl(K, 'камень', 'камня', 'камней')}, во второй — S камней; {rng.start} ≤ S ≤ {top}.</p>")
            mv_py = "def moves(s):\n    a, b = s\n    return [(a - 1, b), (a, b - 1), (a // 2, b), (a, b // 2)]\n"
            end_py = f"s[0] + s[1] <= {W}"
            topic = "Две кучи камней"
        elif kind == 1:               # одна куча: +1 или «в полтора раза»
            plus = R.choice([1, 2])
            W = R.randint(40, 160)
            mv = lambda s: ((s[0] + plus,), (s[0] + s[0] // 2,))
            end = lambda s: s[0] >= W
            rng = range(2, W)
            start = lambda s: (s,)
            rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежит куча камней. Игроки ходят по "
                     f"очереди, первый ход делает {P}. За один ход игрок может добавить в кучу {'один камень' if plus == 1 else 'два камня'} "
                     "или увеличить количество камней в куче в полтора раза (к куче добавляется половина имеющихся камней, "
                     "округлённая вниз: из 7 камней получается 10).</p>"
                     f"<p>Игра завершается в тот момент, когда количество камней в куче становится не менее {W}. Победителем "
                     f"считается игрок, сделавший последний ход. В начальный момент в куче было S камней; 2 ≤ S ≤ {W - 1}.</p>")
            mv_py = f"def moves(s):\n    return [s + {plus}, s + s // 2]\n"
            end_py = f"s >= {W}"
            topic = "Одна куча камней"
        else:                         # две кучи, конец — когда в одной из куч не меньше W
            K = R.randint(2, 12)
            W = R.randint(25, 70)
            mv = lambda s: ((s[0] + 1, s[1]), (s[0], s[1] + 1), (s[0] * 2, s[1]), (s[0], s[1] * 2))
            end = lambda s: max(s) >= W
            rng = range(1, W)
            start = lambda s: (K, s)
            rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежат две кучи камней. Игроки ходят по "
                     f"очереди, первый ход делает {P}. За один ход игрок может добавить в одну из куч (по своему выбору) один "
                     "камень или увеличить количество камней в ней в два раза.</p>"
                     f"<p>Игра завершается в тот момент, когда хотя бы в одной из куч становится не менее {W} камней. Победителем "
                     f"считается игрок, сделавший последний ход. В начальный момент в первой куче было {K} "
                     f"{pl(K, 'камень', 'камня', 'камней')}, во второй — S камней; 1 ≤ S ≤ {W - 1}.</p>")
            mv_py = "def moves(s):\n    a, b = s\n    return [(a + 1, b), (a, b + 1), (a * 2, b), (a, b * 2)]\n"
            end_py = f"max(s) >= {W}"
            topic = "Две кучи камней"
        f = W4.solver(mv, end)
        st = [s for s in rng if not end(start(s))]
        q19 = [s for s in st if f(start(s), 2, False)]
        q20 = [s for s in st if f(start(s), 3, True) and not f(start(s), 1, True)]
        q21 = [s for s in st if f(start(s), 4, True) and not f(start(s), 2, True)]
        if not q19 or not q20 or not q21:
            continue
        dec = kind == 0
        a19 = max(q19) if dec else min(q19)
        a20 = " ".join(map(str, q20)) if len(q20) == 2 else str(max(q20) if dec else min(q20))
        a21 = max(q21) if dec else min(q21)
        mm = "максимальное" if dec else "минимальное"
        break
    body = (rules + "<p>Будем говорить, что игрок имеет выигрышную стратегию, если он может выиграть при любых ходах противника.</p>"
            '<h3 class="gq-title">Задание 19</h3>'
            f"<p>Известно, что {V} выиграл своим первым ходом после неудачного первого хода {Pf}. Укажите {mm} значение S, когда "
            "такая ситуация возможна.</p>"
            '<h3 class="gq-title">Задание 20</h3>'
            + (f"<p>Найдите два значения S, при которых у {Pf} есть выигрышная стратегия, причём {P} не может выиграть за один ход, "
               f"но может выиграть своим вторым ходом независимо от того, как будет ходить {V}. Значения запишите в порядке "
               "возрастания.</p>" if len(q20) == 2 else
               f"<p>Найдите {mm} значение S, при котором у {Pf} есть выигрышная стратегия, причём {P} не может выиграть за один ход, "
               f"но может выиграть своим вторым ходом независимо от того, как будет ходить {V}.</p>")
            + '<h3 class="gq-title">Задание 21</h3>'
            f"<p>Найдите {mm} значение S, при котором у {Vf} есть выигрышная стратегия, позволяющая ему выиграть первым или вторым "
            f"ходом при любой игре {Pf}, и при этом у {Vf} нет стратегии, которая позволит ему гарантированно выиграть первым ходом.</p>")
    sv = f"({K}, s)" if kind != 1 else "s"
    endk = end_py if kind == 1 else end_py.replace("s[0]", str(K)).replace("max(s)", f"max({K}, s)").replace("s[1]", "s")
    agg = "max" if dec else "min"
    sol = ("from functools import lru_cache\n\n" + mv_py +
           f"\n@lru_cache(None)\ndef f(s, m, strat):\n    if {end_py}:\n        return m % 2 == 0\n    if m == 0:\n        return False\n"
           "    h = [f(x, m - 1, strat) for x in moves(s)]\n    return any(h) if m % 2 == 1 or not strat else all(h)\n\n"
           f"st = [s for s in range({rng.start}, {rng.stop}) if not ({endk})]\n"
           f"q19 = [s for s in st if f({sv}, 2, False)]\nq20 = [s for s in st if f({sv}, 3, True) and not f({sv}, 1, True)]\n"
           f"q21 = [s for s in st if f({sv}, 4, True) and not f({sv}, 2, True)]\n"
           f"print({agg}(q19))\n" + ("print(*q20)\n" if len(q20) == 2 else f"print({agg}(q20))\n") + f"print({agg}(q21))")
    tid = f"egeshka_bank:e19-{k:02d}"
    G().TASKS.append({"id": tid, "n": 19, "bank": "egeshka_bank", "html": body, "src": G().SRC, "y": 2026, "dt": "2026-11-05",
                      "topic": topic, "lv": M.LV[3 if kind != 1 else 2], "sol": code(sol),
                      "parts": [{"id": f"{tid}-19", "n": 19, "ans": str(a19)}, {"id": f"{tid}-20", "n": 20, "ans": a20},
                                {"id": f"{tid}-21", "n": 21, "ans": str(a21)}]})


# ============================================================ №22 — последний процесс, длинная цепочка, одновременный старт, ускорение
def gen22(R, k):
    kind = k % 4
    while True:
        n = R.randint(12, 40)
        tm = [R.randint(1, 25) for _ in range(n)]
        deps = [[] if i == 0 or R.random() < 0.25 else sorted(R.sample(range(i), min(i, R.choice([1, 1, 2, 3])))) for i in range(n)]
        end = [0] * n
        for i in range(n):
            end[i] = max((end[d] for d in deps[i]), default=0) + tm[i]
        start = [end[i] - tm[i] for i in range(n)]
        if kind == 0:                 # ID процесса, который завершится последним
            T = max(end)
            if end.count(T) != 1:
                continue
            ans = end.index(T) + 1
            q = "Определите ID процесса, который завершится последним, если все независимые процессы стартуют одновременно."
            tail = "print(max(end, key=end.get))"
        elif kind == 1:               # длина самой длинной цепочки зависимостей (в процессах)
            ch = [0] * n
            for i in range(n):
                ch[i] = max((ch[d] for d in deps[i]), default=0) + 1
            ans = max(ch)
            if ans < 3:
                continue
            q = ("Определите наибольшее количество процессов в цепочке, в которой каждый следующий процесс зависит от "
                 "предыдущего.")
            tail = ("chain = {}\ndef ch(p):\n    if p not in chain:\n        chain[p] = max((ch(d) for d in dep[p]), default=0) + 1\n"
                    "    return chain[p]\nprint(max(ch(p) for p in t_))")
        elif kind == 2:               # сколько процессов стартует одновременно с процессом X
            x = R.randrange(n // 3, n)
            ans = sum(1 for i in range(n) if i != x and start[i] == start[x])
            if ans == 0:
                continue
            q = (f"Сколько процессов (кроме самого процесса с ID {x + 1}) стартуют в тот же момент, что и процесс с ID {x + 1}, "
                 "если независимые процессы стартуют одновременно, а зависимые — сразу после завершения всех нужных им?")
            tail = f"st = {{p: end[p] - t_[p] for p in t_}}\nprint(sum(1 for p in t_ if p != {x + 1} and st[p] == st[{x + 1}]))"
        else:                         # каждый процесс ускорили на d мс
            d = R.randint(1, 4)
            e2 = [0] * n
            for i in range(n):
                e2[i] = max((e2[dd] for dd in deps[i]), default=0) + max(1, tm[i] - d)
            ans = max(e2)
            q = (f"Время выполнения каждого процесса сократили на {d} мс, но не меньше чем до 1 мс. Определите минимальное время, "
                 "через которое завершится выполнение всей совокупности процессов, если независимые процессы могут выполняться "
                 "параллельно.")
            tail = (f"e = {{}}\ndef fin2(p):\n    if p not in e:\n        e[p] = max((fin2(d) for d in dep[p]), default=0) + max(1, t_[p] - {d})\n"
                    "    return e[p]\nprint(max(fin2(p) for p in t_))")
        break
    rows = [["ID процесса B", "Время выполнения процесса B (мс)", "ID процесса(-ов) A"]]
    for i in range(n):
        rows.append([i + 1, tm[i], ";".join(str(d + 1) for d in deps[i]) if deps[i] else 0])
    G().write_xlsx(M.media(22) / f"e22-{k:02d}.xlsx", [("Лист1", rows)])
    ex = tab([["ID процесса B", "Время выполнения процесса B (мс)", "ID процесса(-ов) A"], [1, 4, 0], [2, 3, 0], [3, 1, "1; 2"], [4, 7, 3]])
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            "<p>В файле содержится информация о совокупности N вычислительных процессов, которые могут выполняться "
            "параллельно или последовательно. Будем говорить, что процесс B зависит от процесса A, если для выполнения "
            "процесса B необходимы результаты выполнения процесса A. В этом случае процессы могут выполняться только "
            "последовательно.</p><p>Информация о процессах представлена в файле в виде таблицы. В первом столбце таблицы "
            "указан идентификатор процесса (ID), во втором столбце — время его выполнения в миллисекундах, в третьем столбце "
            "перечислены с разделителем «;» ID процессов, от которых зависит данный процесс. Если процесс является "
            f"независимым, то в таблице указано значение 0.</p><p>{q}</p><p>Типовой пример организации данных в файле:</p>{ex}"
            "<p>Типовой пример имеет иллюстративный характер. Для выполнения задания используйте данные из прилагаемого файла.</p>")
    sol = ("import openpyxl\nws = openpyxl.load_workbook('22.xlsx').active\nt_, dep = {}, {}\n"
           "for pid, t, d in ws.iter_rows(min_row=2, values_only=True):\n    if pid is None:\n        continue\n"
           "    t_[pid] = t\n    dep[pid] = [int(x) for x in str(d).split(';') if int(x)]\n"
           "end = {}\ndef fin(p):\n    if p not in end:\n        end[p] = max((fin(d) for d in dep[p]), default=0) + t_[p]\n"
           "    return end[p]\nfor p in t_:\n    fin(p)\n" + tail)
    add(22, k, body, ans, "Параллельные процессы", code(sol),
        att=[{"name": "22.xlsx", "href": f"media/egeshka_bank/22/e22-{k:02d}.xlsx"}], lv=2)


# ============================================================ №23 — рёбра на путях A→B, достижимые вершины, чётные пути, лёгкие рёбра
def gen23(R, k):
    kind = k % 4
    while True:
        nv = R.randint(50, 90)
        order = R.sample(range(1, 1000), nv)
        edges = {}
        for i in range(nv - 1):
            for _ in range(R.choice([1, 2, 2, 3])):
                j = R.randint(i + 1, min(nv - 1, i + 10))
                edges[(order[i], order[j])] = R.randint(10, 20000)
            if len(edges) >= 190:
                break
        adj = {}
        radj = {}
        for (x, y), w in edges.items():
            adj.setdefault(x, []).append((y, w))
            radj.setdefault(y, []).append(x)
        a = order[R.randint(0, nv // 6)]
        b = order[R.randint(nv * 3 // 5, nv - 1)]

        def reach(src, g):
            seen, st = {src}, [src]
            while st:
                v = st.pop()
                for u in g.get(v, []):
                    u = u[0] if isinstance(u, tuple) else u
                    if u not in seen:
                        seen.add(u)
                        st.append(u)
            return seen
        fwd, back = reach(a, adj), reach(b, radj)
        if b not in fwd:
            continue
        if kind == 0:                 # сумма весов рёбер, лежащих хотя бы на одном пути A → B
            tot = sum(w for (x, y), w in edges.items() if x in fwd and y in back)
            ans = f"{tot // 10}.{tot % 10}"
            q = (f"Найдите сумму весов всех рёбер, которые лежат хотя бы на одном пути из вершины с номером {a} в вершину с номером "
                 f"{b}. Ответ запишите с одним знаком после запятой (точки).")
            tail = (f"fwd, back = reach({a}, nxt), reach({b}, prv)\n"
                    "print(round(sum(c for (x, y), c in w.items() if x in fwd and y in back), 1))")
        elif kind == 1:               # сколько вершин достижимо из A
            ans = len(fwd) - 1
            q = f"Сколько вершин графа достижимы из вершины с номером {a} (саму вершину {a} не считать)?"
            tail = f"print(len(reach({a}, nxt)) - 1)"
        elif kind == 2:               # кратчайший путь из чётного числа рёбер
            pos = {v: i for i, v in enumerate(order)}

            @lru_cache(None)
            def go(v, par):
                if v == b:
                    return 0 if par == 0 else None
                best = None
                for u, w in adj.get(v, []):
                    if pos[u] > pos[b]:
                        continue
                    r = go(u, 1 - par)
                    if r is not None and (best is None or r + w < best):
                        best = r + w
                return best
            r = go(a, 0)
            if r is None or r % 10 == 0:
                continue
            ans = r // 10
            q = (f"Найдите и запишите в ответе целую часть длины кратчайшего пути из вершины с номером {a} в вершину с номером {b}, "
                 "состоящего из чётного количества рёбер.")
            tail = (f"from functools import lru_cache\n@lru_cache(None)\ndef go(v, par):\n    if v == {b}:\n        return 0 if par == 0 else None\n"
                    "    best = None\n    for u in nxt.get(v, []):\n        r = go(u, 1 - par)\n        if r is not None and (best is None or r + w[v, u] < best):\n"
                    f"            best = r + w[v, u]\n    return best\n\nprint(int(go({a}, 0)))")
        else:                         # кратчайший путь только по рёбрам не тяжелее Wmax
            wl = sorted(edges.values())
            wmax = wl[len(wl) * 2 // 3]
            pos = {v: i for i, v in enumerate(order)}

            @lru_cache(None)
            def go(v):
                if v == b:
                    return 0
                best = None
                for u, w in adj.get(v, []):
                    if w > wmax or pos[u] > pos[b]:
                        continue
                    r = go(u)
                    if r is not None and (best is None or r + w < best):
                        best = r + w
                return best
            r = go(a)
            if r is None or r % 10 == 0:
                continue
            ans = r // 10
            lim = f"{wmax // 10}.{wmax % 10}"
            q = (f"Найдите и запишите в ответе целую часть длины кратчайшего пути из вершины с номером {a} в вершину с номером {b}, "
                 f"в котором вес каждого ребра не превышает {lim}.")
            tail = (f"from functools import lru_cache\n@lru_cache(None)\ndef go(v):\n    if v == {b}:\n        return 0\n    best = None\n"
                    f"    for u in nxt.get(v, []):\n        if w[v, u] > {lim}:\n            continue\n        r = go(u)\n"
                    "        if r is not None and (best is None or r + w[v, u] < best):\n            best = r + w[v, u]\n    return best\n\n"
                    f"print(int(go({a})))")
        break
    lines = []
    el = list(edges.items())
    R.shuffle(el)
    for (x, y), w in el:
        sep = lambda: R.choice([" ", "  ", "\t", " \t"])
        lines.append(f"{x}{sep()}{y}{sep()}{w // 10}.{w % 10}")
    (M.media(23) / f"e23-{k:02d}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    body = ("<p>В текстовом файле содержится описание ациклического ориентированного взвешенного графа. В каждой строке "
            "файла записаны два натуральных числа (L, M) и одно положительное вещественное число (W). L и M — номера вершин "
            "графа, W — вес ребра, ведущего из вершины L в вершину M. Количество строк в файле равно количеству рёбер в графе. "
            f"Две вершины графа не могут быть соединены более чем одним ребром.</p><p>{q}"
            + (" Существование хотя бы одного такого пути гарантируется." if kind in (2, 3) else "") +
            "</p><p>Для выполнения этого задания следует написать программу. Вершины графа могут быть пронумерованы не подряд. "
            "L ≤ 1000, M ≤ 1000; W ≤ 10 000. Количество строк в файле не превосходит 200. Числа в строках разделены "
            "произвольным ненулевым количеством пробелов и/или табуляций.</p>")
    sol = ("w, nxt, prv = {}, {}, {}\nfor s in open('23.txt'):\n    if s.split():\n        a, b, c = s.split()\n"
           "        a, b = int(a), int(b)\n        w[a, b] = float(c)\n        nxt.setdefault(a, []).append(b)\n"
           "        prv.setdefault(b, []).append(a)\n\ndef reach(v, g):\n    seen, st = {v}, [v]\n    while st:\n        x = st.pop()\n"
           "        for u in g.get(x, []):\n            if u not in seen:\n                seen.add(u)\n                st.append(u)\n"
           "    return seen\n\n" + tail)
    add(23, k, body, ans, "Графы", code(sol), att=[{"name": "23.txt", "href": f"media/egeshka_bank/23/e23-{k:02d}.txt"}],
        lv=3 if kind in (0, 2) else 2)
