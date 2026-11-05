# -*- coding: utf-8 -*-
"""
Банк «Egeshka», четвёртая волна: только новые формулировки — те типы вопросов из банков ФИПИ / КомпЕГЭ /
«Банк ЕГЭ», которых не было у первых волн (разбор банка — в описании коммита). Сложность — уровень ЕГЭ:
задачи решаются обычными приёмами (перебор, рекурсия, таблица), но вопросы разные.

Каждое задание по-прежнему решается перебором здесь же, у каждого есть решение на Python, которое
tools/egeshka_check.py запускает и сверяет с ответом. Вызывается из egeshka_more.run() для последней волны.
"""
import heapq
import itertools
import math

import egeshka_more as M


def G():
    return M.G                        # gen_egeshka (или __main__, если генератор запущен скриптом)


def add(*a, **kw):
    M.add(*a, **kw)


code = M.code


def pl(n, one, few, many):
    """«1 символ», «3 символа», «11 символов»."""
    n = abs(n) % 100
    return one if n % 10 == 1 and n != 11 else few if 2 <= n % 10 <= 4 and not 12 <= n <= 14 else many
tab = lambda rows, head=True: G().table_html(rows, head)


# ============================================================ №1 — граф и таблица: номера пунктов, звёздочки, маршруты
def make_graph(R, n):
    while True:
        base = R.uniform(0, 2 * math.pi)
        ang = [base + 2 * math.pi * i / n + R.uniform(-0.18, 0.18) for i in range(n)]
        pos = [(170 + 138 * math.cos(a), 140 + 112 * math.sin(a)) for a in ang]
        order = list(range(n))
        R.shuffle(order)
        pos = [pos[order[i]] for i in range(n)]
        edges = R.sample([(a, b) for a in range(n) for b in range(a + 1, n)], R.randint(n + 1, n + 4))
        adj = [set() for _ in range(n)]
        for a, b in edges:
            adj[a].add(b)
            adj[b].add(a)
        seen, st = {0}, [0]
        while st:
            v = st.pop()
            for u in adj[v] - seen:
                seen.add(u)
                st.append(u)
        if len(seen) == n and min(map(len, adj)) >= 1:
            return pos, edges, adj


def gen1(R, k):
    kind = k % 4
    while True:
        n = R.choice([6, 7, 7, 8])
        pos, edges, adj = make_graph(R, n)
        num = list(range(n))
        R.shuffle(num)                                       # буква i → номер num[i]
        adj_n = [set() for _ in range(n)]
        for a, b in edges:
            adj_n[num[a]].add(num[b])
            adj_n[num[b]].add(num[a])
        maps = G().iso_maps(adj, adj_n, n)
        w = {frozenset((num[a], num[b])): R.randint(3, 60) for a, b in edges}
        L = G().LET
        if kind in (0, 1):            # какие номера у пунктов X и Y (звёздочки или веса)
            a, b = sorted(R.sample(range(n), 2))
            sets = {tuple(sorted((mp[a] + 1, mp[b] + 1))) for mp in maps}
            if len(sets) != 1:
                continue
            ans = "".join(map(str, sets.pop()))
            q = (f"Определите, какие номера в таблице могут соответствовать пунктам {L[a]} и {L[b]}. В ответе запишите эти "
                 "два номера в порядке возрастания без пробелов и знаков препинания.")
            stars = kind == 0
            sol = "Сопоставьте степени вершин и соседей: " + ", ".join(f"{L[i]} — {len(adj[i])}" for i in range(n)) + "."
        elif kind == 2:               # сумма всех дорог из пункта
            a = R.randrange(n)
            vals = {sum(w[frozenset((mp[a], u))] for u in adj_n[mp[a]]) for mp in maps}
            if len(vals) != 1:
                continue
            ans, stars = vals.pop(), False
            q = (f"Определите суммарную протяжённость всех дорог, которые ведут из пункта {L[a]} (в километрах).")
            sol = "Найдите пункт по числу дорог и сложите длины всех его дорог."
        else:                         # длина маршрута через три пункта
            a = R.randrange(n)
            nb = sorted(adj[a])
            if len(nb) < 2:
                continue
            x, y = R.sample(nb, 2)
            vals = {w[frozenset((mp[x], mp[a]))] + w[frozenset((mp[a], mp[y]))] for mp in maps}
            if len(vals) != 1:
                continue
            ans, stars = vals.pop(), False
            q = (f"Определите длину маршрута {L[x]} — {L[a]} — {L[y]}, если двигаться только по дорогам, указанным на схеме.")
            sol = "Найдите три пункта маршрута по числу дорог и соседям, сложите длины двух дорог."
        break
    rows = [[""] + [f"П{j + 1}" for j in range(n)]]
    for i in range(n):
        rows.append([f"<b>П{i + 1}</b>"] + [("" if i == j else ("*" if stars and frozenset((i, j)) in w else
                                                               "" if stars else str(w.get(frozenset((i, j)), ""))))
                                            for j in range(n)])
    name = f"1/e1-{k:02d}.svg"
    (G().MEDIA / "1").mkdir(parents=True, exist_ok=True)
    (G().MEDIA / name).write_text(G().graph_svg(n, edges, pos), encoding="utf-8")
    head = ("<p>На рисунке схема дорог Н-ского района изображена в виде графа, в таблице звёздочкой обозначено наличие "
            "дороги из одного населённого пункта в другой. Отсутствие звёздочки означает, что такой дороги нет.</p>" if stars else
            "<p>На рисунке справа схема дорог Н-ского района изображена в виде графа, в таблице содержатся сведения о "
            "протяжённости каждой из этих дорог (в километрах).</p>")
    body = (head + f'<div><div>{tab(rows)}</div><div><img src="media/egeshka_bank/{name}" alt="Схема дорог" width="340"></div></div>'
            "<p>Так как таблицу и схему рисовали независимо друг от друга, нумерация населённых пунктов в таблице никак не "
            f"связана с буквенными обозначениями на графе.</p><p>{q}</p>")
    add(1, k, body, ans, "Графы и весовые таблицы", f"<p>{sol} Ответ: {ans}.</p>", lv=1 if kind == 0 else 2,
        by_text=kind == 0)                       # в таблице со звёздочками нет чисел — сравниваем текст целиком


# ============================================================ №2 — таблица истинности: смешанные значения F, три переменные
def gen2(R, k):
    G().R = R
    while True:
        nv = 3 if k % 3 == 0 else 4
        vs = "xyz" if nv == 3 else "wxyz"
        tex, py = G().rand_expr(R.choice([2, 3]))
        if nv == 3:
            if "w" in py:
                continue
        if not all(v in py for v in vs):
            continue
        F = eval(f"lambda {', '.join(vs)}: bool({py})")
        rows_all = list(itertools.product([0, 1], repeat=nv))
        nr = R.choice([3, 4]) if nv == 4 else R.choice([2, 3])
        frag = R.sample(rows_all, nr)
        perm = R.sample(vs, nv)
        vals = [int(F(*r)) for r in frag]
        if len(set(vals)) < 2:                              # значения функции в строках разные
            continue
        cols = [[dict(zip(vs, r))[perm[c]] for c in range(nv)] for r in frag]
        mask = [[R.random() < 0.4 for _ in range(nv)] for _ in range(nr)]
        blanks = sum(map(sum, mask))
        if not nr <= blanks <= 2 * nr:
            continue
        ok = []
        for p in itertools.permutations(vs):
            opts = []
            for ri in range(nr):
                cand = [fl for fl in itertools.product([0, 1], repeat=nv)
                        if all(mask[ri][c] or fl[c] == cols[ri][c] for c in range(nv))
                        and int(F(**dict(zip(p, fl)))) == vals[ri]]
                opts.append(cand)
            if any(len(set(c)) == nr for c in itertools.product(*opts)):
                ok.append("".join(p))
        if len(ok) == 1:
            break
    ans = ok[0]
    rows = [[f"Перем. {i + 1}" for i in range(nv)] + ["Функция"]]
    rows += [[("" if mask[ri][c] else str(cols[ri][c])) for c in range(nv)] + [str(vals[ri])] for ri in range(nr)]
    letters = ", ".join(vs)
    body = (f"<p>Логическая функция F задаётся выражением \\( {tex[1:-1] if tex.startswith('(') else tex} \\). Ниже приведён "
            f"частично заполненный фрагмент таблицы истинности функции F, содержащий неповторяющиеся строки. Определите, "
            f"какому столбцу таблицы истинности функции F соответствует каждая из переменных \\( {letters} \\).</p>"
            + tab(rows) +
            f"<p>В ответе напишите буквы \\( {letters} \\) в том порядке, в котором идут соответствующие им столбцы (сначала "
            "буква, соответствующая первому столбцу; затем — второму и т. д.). Буквы в ответе пишите подряд, никаких "
            "разделителей между буквами ставить не нужно.</p>")
    frag_py = "[" + ", ".join("[" + ", ".join("None" if mask[ri][c] else str(cols[ri][c]) for c in range(nv)) + f", {vals[ri]}]"
                               for ri in range(nr)) + "]"
    sol = (f"from itertools import product, permutations\n\ndef F({', '.join(vs)}):\n    return {py}\n\n"
           f"frag = {frag_py}\nfor p in permutations('{vs}'):\n    opts = []\n    for row in frag:\n"
           f"        opts.append([fl for fl in product([0, 1], repeat={nv})\n"
           f"                     if all(row[c] is None or row[c] == fl[c] for c in range({nv}))\n"
           "                     and int(F(**dict(zip(p, fl)))) == row[-1]])\n"
           f"    if any(len(set(c)) == {nr} for c in product(*opts)):\n        print(''.join(p))")
    add(2, k, body, ans, "Таблицы истинности", code(sol), lv=3 if nv == 4 and nr == 4 else 2, by_text=True)


# ============================================================ №3 — база данных: товар-лидер, магазины, средняя цена
THEMES3 = [
    ("Канцтовары", [("Ручка шариковая синяя", 1), ("Ручка гелевая чёрная", 1), ("Тетрадь 48 листов", 1),
                    ("Тетрадь 96 листов", 1), ("Карандаш простой", 1), ("Карандаши цветные 12 шт", 12), ("Ластик белый", 1),
                    ("Линейка 30 см", 1)]),
    ("Бытовая химия", [("Мыло детское", 1), ("Мыло хозяйственное", 1), ("Порошок стиральный", 3), ("Гель для посуды", 1),
                       ("Средство для стёкол", 1), ("Губки для посуды 5 шт", 5), ("Салфетки влажные", 1),
                       ("Пакеты для мусора", 30)]),
    ("Овощи и фрукты", [("Яблоки красные", 1), ("Яблоки зелёные", 1), ("Бананы", 1), ("Картофель молодой", 3),
                        ("Морковь мытая", 1), ("Лук репчатый", 1), ("Апельсины", 1), ("Груши", 1)]),
]


def gen3(R, k):
    G().R = R
    dept, goods = THEMES3[k % len(THEMES3)]
    month, mname = G().MONTHS[k % len(G().MONTHS)]
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
    pm = {p[0]: p for p in products}
    sm = {s[0]: s for s in shops}
    kind = k % 3
    while True:
        d1 = R.randint(1, 4)
        d2 = R.randint(d1 + 3, 10)
        dist = R.choice(G().DISTRICTS)
        sel = lambda typ, f: [m for m in moves if m[4] == typ and d1 <= m[1].day <= d2 and f(m)]
        if kind == 0:                 # артикул товара с наибольшей выручкой в районе
            rev = {}
            for m in sel("Продажа", lambda m: sm[m[2]][1] == dist):
                rev[m[3]] = rev.get(m[3], 0) + m[5] * pm[m[3]][5]
            if len(rev) < 2 or sorted(rev.values())[-1] == sorted(rev.values())[-2]:
                continue
            ans = max(rev, key=rev.get)
            q = (f"Используя информацию из приведённой базы данных, определите артикул товара, который принёс наибольшую "
                 f"выручку в магазинах {dist}_района за период с {d1} по {d2} {mname} включительно.")
        elif kind == 1:               # сколько магазинов продали больше N упаковок
            tot = {}
            for m in sel("Продажа", lambda m: True):
                tot[m[2]] = tot.get(m[2], 0) + m[5]
            if not tot:
                continue
            thr = sorted(tot.values())[len(tot) // 2] + R.randint(-30, 30)
            ans = sum(1 for v in tot.values() if v > thr)
            if ans in (0, len(shops)):
                continue
            q = (f"Используя информацию из приведённой базы данных, определите, в скольких магазинах за период с {d1} по {d2} "
                 f"{mname} включительно было продано больше {thr} упаковок товаров отдела «{dept}» в сумме.")
        else:                         # целая часть средней цены проданной упаковки
            ms = sel("Продажа", lambda m: sm[m[2]][1] == dist)
            if not ms:
                continue
            money = sum(m[5] * pm[m[3]][5] for m in ms)
            cnt = sum(m[5] for m in ms)
            ans = money // cnt
            q = (f"Используя информацию из приведённой базы данных, определите среднюю цену (в рублях) одной проданной "
                 f"упаковки товаров в магазинах {dist}_района за период с {d1} по {d2} {mname} включительно: общую выручку "
                 "разделите на общее число проданных упаковок. В ответе запишите только целую часть числа.")
        break
    for d in G().DISTRICTS:
        q = q.replace(f"{d}_района", d[:-2] + "ого района")
    name = f"3/e3-{k:02d}.xlsx"
    G().write_xlsx(G().MEDIA / name, [
        ("Движение товаров", [["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"]] + moves),
        ("Товар", [["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"]] + products),
        ("Магазин", [["ID магазина", "Район", "Адрес"]] + shops)])
    hdr = lambda cols: tab([cols])
    body = (f"<p>В файле приведён фрагмент базы данных «Магазины» о поставках и продажах товаров отдела «{dept}». База данных "
            "состоит из трёх таблиц.</p><p>Таблица «Движение товаров» содержит записи о поступлении товаров в магазины и об их "
            f"продаже в течение первой декады {mname} {year} г. Заголовок таблицы имеет следующий вид.</p>"
            + hdr(["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"])
            + "<p>Таблица «Товар» содержит информацию об основных характеристиках каждого товара.</p>"
            + hdr(["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"])
            + "<p>Таблица «Магазин» содержит информацию о местонахождении магазинов.</p>" + hdr(["ID магазина", "Район", "Адрес"])
            + '<p>На рисунке приведена схема указанной базы данных.</p><p><img src="media/egeshka_bank/3/schema.svg" '
              'alt="Схема базы данных" width="460"></p>' + f"<p>{q}</p><p>В ответе запишите только число.</p>")
    sol = ("<p>Подставьте в «Движение товаров» цену (ВПР по артикулу) и район магазина (ВПР по ID магазина), отфильтруйте "
           f"продажи за нужные даты и посчитайте нужную величину сводной таблицей. Ответ: {ans}.</p>")
    add(3, k, body, ans, "Базы данных", sol, att=[{"name": "3.xlsx", "href": f"media/egeshka_bank/{name}"}], lv=2 if kind else 3)


# ============================================================ №4 — код Фано: обратное условие, Хаффман, сколько слов
def gen4(R, k):
    kind = k % 3
    rus = G().RUS
    while True:
        if kind == 0:                 # обратное условие Фано: никакое слово не является окончанием другого
            nlet = R.randint(6, 9)
            letters = sorted(R.sample(rus, nlet), key=rus.index)
            pool = ["0", "1"]
            while len(pool) < nlet + R.randint(1, 2):
                c = pool.pop(R.randrange(len(pool)))
                pool += [c + "0", c + "1"]
            R.shuffle(pool)
            codes = {l: c[::-1] for l, c in zip(letters, pool)}          # префиксный код задом наперёд — суффиксный
            x = R.choice(letters)
            known = {l: c for l, c in codes.items() if l != x}
            cand = [("".join(b)) for L in range(1, 7) for b in itertools.product("01", repeat=L)]
            cand = [c for c in cand if all(not c.endswith(f) and not f.endswith(c) for f in known.values())]
            if not cand or max(map(len, known.values())) > 5:
                continue
            Lm = min(map(len, cand))
            ans = min((c for c in cand if len(c) == Lm), key=lambda c: int(c, 2))
            body = (f"<p>Для кодирования некоторой последовательности, состоящей из букв {', '.join(letters)}, используется "
                    "неравномерный двоичный код, удовлетворяющий <b>обратному</b> условию Фано: никакое кодовое слово не "
                    "является окончанием другого кодового слова. Такой код позволяет однозначно декодировать сообщение, "
                    "читая его с конца. Известны кодовые слова для всех букв, кроме буквы " + x + ".</p>"
                    + tab([["Буква", "Кодовое слово"]] + [[l, known.get(l, "?")] for l in letters]) +
                    f"<p>Укажите кратчайшее кодовое слово для буквы {x}, при котором код будет удовлетворять обратному "
                    "условию Фано. Если таких кодов несколько, укажите код с наименьшим числовым значением.</p>")
            sol = ("from itertools import product\nknown = [" + ", ".join(f"'{c}'" for c in known.values()) + "]\n"
                   "for L in range(1, 8):\n    ok = [''.join(b) for b in product('01', repeat=L)\n"
                   "          if all(not ''.join(b).endswith(f) and not f.endswith(''.join(b)) for f in known)]\n"
                   "    if ok:\n        print(min(ok, key=lambda c: int(c, 2)))\n        break")
            lv = 3
        elif kind == 1:               # Хаффман: минимальная длина сообщения при известных частотах
            nlet = R.randint(5, 8)
            letters = sorted(R.sample(rus, nlet), key=rus.index)
            freq = {l: R.randint(1, 40) for l in letters}
            h = list(freq.values())
            heapq.heapify(h)
            total = 0
            while len(h) > 1:
                a, b = heapq.heappop(h), heapq.heappop(h)
                total += a + b
                heapq.heappush(h, a + b)
            ans = total
            body = (f"<p>Сообщение состоит только из букв {', '.join(letters)}; каждая буква встречается в нём столько раз, "
                    "сколько указано в таблице.</p>" + tab([["Буква"] + letters, ["Сколько раз"] + [freq[l] for l in letters]]) +
                    "<p>Сообщение кодируют неравномерным двоичным кодом, удовлетворяющим условию Фано (никакое кодовое слово не "
                    "является началом другого), — каждая буква заменяется своим кодовым словом. Какова наименьшая возможная "
                    "длина закодированного сообщения (в битах)?</p>")
            sol = ("import heapq\nh = [" + ", ".join(str(freq[l]) for l in letters) + "]\nheapq.heapify(h)\ntotal = 0\n"
                   "while len(h) > 1:               # код Хаффмана: дважды берём две самые редкие группы\n"
                   "    a, b = heapq.heappop(h), heapq.heappop(h)\n    total += a + b\n    heapq.heappush(h, a + b)\nprint(total)")
            lv = 3
        else:                         # сколько слов длины не больше L можно взять для новой буквы
            nlet = R.randint(5, 8)
            letters = sorted(R.sample(rus, nlet), key=rus.index)
            pool = ["0", "1"]
            while len(pool) < nlet + R.randint(1, 3):
                c = pool.pop(R.randrange(len(pool)))
                pool += [c + "0", c + "1"]
            R.shuffle(pool)
            known = dict(zip(letters, pool))
            L = R.randint(4, 6)
            cand = [("".join(b)) for n_ in range(1, L + 1) for b in itertools.product("01", repeat=n_)]
            cand = [c for c in cand if all(not c.startswith(f) and not f.startswith(c) for f in known.values())]
            if not 2 <= len(cand) <= 40:
                continue
            ans = len(cand)
            new = R.choice([c for c in rus if c not in letters])
            body = (f"<p>По каналу связи передаются сообщения из букв {', '.join(letters)}. Для передачи используется "
                    "неравномерный двоичный код, удовлетворяющий условию Фано (никакое кодовое слово не является началом "
                    "другого). Кодовые слова для всех этих букв известны:</p>"
                    + tab([["Буква", "Кодовое слово"]] + [[l, known[l]] for l in letters]) +
                    f"<p>В алфавит решили добавить букву {new}. Сколько существует различных кодовых слов длиной не более {L} "
                    f"символов, которые можно выбрать для буквы {new}, чтобы код по-прежнему удовлетворял условию Фано?</p>")
            sol = ("from itertools import product\nknown = [" + ", ".join(f"'{c}'" for c in known.values()) + "]\n"
                   f"print(sum(1 for L in range(1, {L + 1}) for b in product('01', repeat=L)\n"
                   "          if all(not ''.join(b).startswith(f) and not f.startswith(''.join(b)) for f in known)))")
            lv = 2
        break
    add(4, k, body, ans, "Кодирование, условие Фано", code(sol), lv=lv)


# ============================================================ №5 — алгоритмы над десятичными цифрами и другими системами
RULES5 = [
    ("dec", "По этому числу строится новое: вычисляются суммы первой и второй, а также второй и третьей цифр числа N. "
            "Полученные два числа записываются друг за другом в порядке неубывания (без разделителей). Это и есть число R.",
     "def R(n):\n    a, b, c = map(int, str(n))\n    x, y = sorted([a + b, b + c])\n    return int(str(x) + str(y))",
     (100, 999), "трёхзначное"),
    ("dec", "По этому числу строится новое: вычисляются произведения первой и второй, а также третьей и четвёртой цифр "
            "числа N. Полученные два числа записываются друг за другом в порядке невозрастания (без разделителей). Это и есть число R.",
     "def R(n):\n    a, b, c, d = map(int, str(n))\n    x, y = sorted([a * b, c * d], reverse=True)\n    return int(str(x) + str(y))",
     (1000, 9999), "четырёхзначное"),
    ("dec", "Число N записывается в десятичной системе. Если сумма его цифр чётна, справа дописывается последняя цифра числа, "
            "иначе слева дописывается первая цифра. Полученное число и есть R.",
     "def R(n):\n    s = str(n)\n    return int(s + s[-1]) if sum(map(int, s)) % 2 == 0 else int(s[0] + s)",
     (10, 99999), "натуральное"),
    ("b4", "Строится четверичная запись числа N. Если N делится на 4, к записи справа дописываются две последние цифры, "
           "иначе справа дописывается остаток от деления N на 4, умноженный на 2, в четверичной записи. Полученная запись — "
           "четверичная запись числа R.",
     "def b4(n):\n    s = ''\n    while n:\n        s = str(n % 4) + s\n        n //= 4\n    return s\n\n"
     "def R(n):\n    s = b4(n)\n    s = s + s[-2:] if n % 4 == 0 else s + b4(n % 4 * 2)\n    return int(s, 4)", (4, 99999), "натуральное"),
    ("b5", "Строится пятеричная запись числа N. Если количество чётных цифр в ней больше количества нечётных, слева "
           "дописывается 1, а справа 0; иначе справа дописываются две последние цифры записи. Полученная запись — пятеричная "
           "запись числа R.",
     "def b5(n):\n    s = ''\n    while n:\n        s = str(n % 5) + s\n        n //= 5\n    return s\n\n"
     "def R(n):\n    s = b5(n)\n    ev = sum(int(c) % 2 == 0 for c in s)\n"
     "    s = '1' + s + '0' if ev > len(s) - ev else s + s[-2:]\n    return int(s, 5)", (5, 99999), "натуральное"),
    ("bin", "Строится двоичная запись числа N. Затем в этой записи все единицы заменяются нулями, а нули — единицами, и к "
            "результату слева дописывается 1. Полученная запись — двоичная запись числа R.",
     "def R(n):\n    s = bin(n)[2:]\n    return int('1' + s.translate(str.maketrans('01', '10')), 2)", (1, 99999), "натуральное"),
]


def gen5(R, k):
    kind, text, src, (lo, hi), word = RULES5[k % len(RULES5)]
    ns = {}
    exec(src, ns)
    Rf = ns["R"]
    q_kind = (k // len(RULES5)) % 3
    while True:
        if kind == "dec" and word != "натуральное":
            dom = range(lo, hi + 1)
        else:
            dom = range(lo, min(hi, 5000) + 1)
        if q_kind == 0:
            vals = sorted({Rf(n) for n in dom})
            X = R.choice(vals[len(vals) // 5: len(vals) * 4 // 5])
            ans = min(v for v in vals if v > X)
            q = f"Укажите наименьшее число R, большее {X}, которое может быть получено в результате работы этого алгоритма."
            tail = f"print(min(R(n) for n in range({dom.start}, {dom.stop}) if R(n) > {X}))"
        elif q_kind == 1:
            vals = sorted({Rf(n) for n in dom})
            X = R.choice(vals[len(vals) // 5: len(vals) * 4 // 5])
            good = [n for n in dom if Rf(n) == X]
            if not good:
                continue
            ans = len(good)
            q = f"Сколько существует {('чисел N' if word == 'натуральное' else word[:-2] + 'ых чисел N')}, для которых результатом работы алгоритма будет число {X}?"
            if word == "натуральное":
                q = f"Сколько существует чисел N, не больших {dom.stop - 1}, для которых результатом работы алгоритма будет число {X}?"
            tail = f"print(sum(1 for n in range({dom.start}, {dom.stop}) if R(n) == {X}))"
        else:
            a = R.randint(dom.start, dom.stop - 200)
            b = a + R.randint(50, 150)
            ans = len({Rf(n) for n in range(a, b + 1)})
            q = f"Сколько различных чисел R может получиться в результате работы алгоритма для всех N из отрезка [{a}; {b}]?"
            tail = f"print(len({{R(n) for n in range({a}, {b + 1})}}))"
        break
    body = (f"<p>На вход алгоритма подаётся {word} число N. {text}</p>"
            f"<p>Пример: для N = {lo + 37 if lo + 37 <= hi else lo} получаем R = {Rf(lo + 37 if lo + 37 <= hi else lo)}.</p><p>{q}</p>")
    topic = {"dec": "Десятичная система счисления", "bin": "Двоичная система счисления"}.get(kind, "Алгоритмы обработки чисел")
    add(5, k, body, ans, topic, code(src + "\n\n" + tail), lv=2 if q_kind != 1 else 3)


# ============================================================ №6 — Черепаха: точки на линии, площадь, разность фигур, крест
AREA_SOL = M.T6_SOL.split("def where")[0] + """def cut(f):
    for i in range(1, len(f)):
        if abs(f[i][0] - f[0][0]) < 1e-6 and abs(f[i][1] - f[0][1]) < 1e-6:
            return f[:i + 1]
    return f

f = cut(figs[0])
print(round(abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(f, f[1:]))) / 2))"""


def gen6(R, k):
    kind = k % 4
    while True:
        a, b = R.randint(5, 16), R.randint(5, 16)
        rect = lambda p, q: ("REP", 2, [("F", p), ("R", 90), ("F", q), ("R", 90)])
        if kind == 0:                 # точки на самой линии
            fam = R.choice(["step", "rhomb", "cross"])
            if fam == "step":
                c, d = R.randint(2, a - 2), R.randint(2, b - 2)
                prog = [("F", a), ("R", 90), ("F", b), ("R", 90), ("F", c), ("R", 90), ("F", d), ("L", 90),
                        ("F", a - c), ("R", 90), ("F", b - d), ("R", 90)]
            elif fam == "rhomb":
                prog = [("R", 45), ("REP", R.choice([4, 5, 8]), [("F", a), ("R", 90)])]
            else:
                c = R.randint(3, 8)
                prog = [("REP", 4, [("F", c), ("R", 90), ("F", c), ("L", 90), ("F", c), ("R", 90)])]
            cond = "w[0] == 0"
            q = ("Определите, сколько точек с целочисленными координатами находятся <b>на линии</b>, заданной данным "
                 "алгоритмом (включая её вершины).")
        elif kind == 1:               # площадь
            fam = R.choice(["step", "rhomb", "cross"])
            if fam == "step":
                c, d = R.randint(2, a - 2), R.randint(2, b - 2)
                prog = [("F", a), ("R", 90), ("F", b), ("R", 90), ("F", c), ("R", 90), ("F", d), ("L", 90),
                        ("F", a - c), ("R", 90), ("F", b - d), ("R", 90)]
            elif fam == "rhomb":
                prog = [("R", 45), ("REP", R.choice([4, 6, 8]), [("F", a), ("R", 90)])]
            else:
                c = R.randint(3, 9)
                prog = [("REP", 4, [("F", c), ("R", 90), ("F", c), ("L", 90), ("F", c), ("R", 90)])]
            cond = None
            q = "Определите площадь фигуры, ограниченной линией, заданной данным алгоритмом."
        elif kind == 2:               # внутри первой, но вне второй
            c, d = R.randint(5, 16), R.randint(5, 16)
            sx, sy = R.randint(2, a - 2), R.randint(2, b - 2)
            prog = [rect(a, b), ("U",), ("F", sx), ("R", 90), ("F", sy), ("L", 90), ("D",), rect(c, d)]
            cond = "w[0] > 0 and w[1] < 0"
            q = ("Определите, сколько точек с целочисленными координатами находятся внутри фигуры, ограниченной первой линией, "
                 "но вне фигуры, ограниченной второй линией. Точки на линиях учитывать не следует.")
        else:                         # крест и «лесенка» внутри
            c = R.randint(3, 9)
            prog = [("REP", 4, [("F", c), ("R", 90), ("F", c), ("L", 90), ("F", c), ("R", 90)])]
            if R.random() < 0.5:
                prog = [("R", 45)] + prog
            cond = "w[0] > 0"
            q = ("Определите, сколько точек с целочисленными координатами находятся внутри области, ограниченной линией, "
                 "заданной данным алгоритмом. Точки на линии учитывать не следует.")
        polys = M.t_run(prog)
        if not polys:
            continue
        x0, x1, y0, y1 = M.box(polys)
        if max(abs(v) for v in (x0, x1, y0, y1)) >= 95:
            continue
        if cond is None:
            P = polys[0]
            ar = abs(sum(P[i][0] * P[(i + 1) % len(P)][1] - P[(i + 1) % len(P)][0] * P[i][1] for i in range(len(P)))) / 2
            if abs(ar - round(ar)) > 1e-6:
                continue
            ans = round(ar)
            sol = AREA_SOL.replace("{prog}", "\n".join(M.t_py(prog)))
        else:
            fn = eval("lambda w: " + cond)
            ans = sum(1 for px in range(x0, x1 + 1) for py in range(y0, y1 + 1) if fn([M.where(px, py, p) for p in polys]))
            sol = M.T6_SOL.replace("{prog}", "\n".join(M.t_py(prog))).replace("{cond}", cond)
        if ans > 3:
            break
    two = any(c[0] in "LUD" for c in prog)
    body = (M.TURTLE_HEAD.format(cnt="пять" if two else "две", ending="" if two else "ы", extra=M.TURTLE_EXTRA if two else "")
            + f"<p>Черепахе был дан для исполнения следующий алгоритм:</p><p><b>{M.t_text(prog)}</b></p><p>{q}</p>")
    add(6, k, body, ans, "Черепашка", code(sol), lv=3 if kind in (2, 3) else 2)


# ============================================================ №7 — снимки, длительность записи, глубина, экономия трафика
def gen7(R, k):
    kind = k % 5
    while True:
        if kind == 0:                 # сколько снимков поместится
            w, h = R.choice([(1024, 768), (640, 480), (1280, 1024), (800, 600), (2048, 1536)])
            colors = R.choice([256, 1024, 4096, 65536, 2 ** 24])
            bits = int(math.log2(colors))
            mb = R.choice([16, 32, 64, 100, 128, 256, 500])
            ans = mb * 2 ** 23 // (w * h * bits)
            if ans < 2:
                continue
            q = (f"Камера делает снимки размером {w}×{h} пикселей с палитрой из {colors} цветов. Снимки сохраняются без сжатия, "
                 f"коды пикселей записываются подряд, заголовков у файлов нет. На карту памяти выделено {mb} Мбайт. Каково "
                 "максимально возможное число снимков, которое можно сохранить на этой карте?")
            sol = f"bits = {bits}\nprint({mb} * 2 ** 23 // ({w} * {h} * bits))"
            lv = 1
        elif kind == 1:               # длительность записи в минутах
            ch = R.choice([1, 2, 4])
            f = R.choice([8, 16, 32, 48, 64])
            bits = R.choice([8, 16, 24, 32])
            mins = R.randint(2, 30)
            size = ch * f * 1000 * bits * mins * 60 // 8
            if size % 2 ** 10:
                continue
            mbs = size // 2 ** 10
            ans = mins
            chw = {1: "одноканальная (моно)", 2: "двухканальная (стерео)", 4: "четырёхканальная (квадро)"}[ch]
            q = (f"Производилась {chw} звукозапись с частотой дискретизации {f} кГц и {bits}-битным разрешением. В результате "
                 f"был получен файл размером {mbs} Кбайт, сжатие данных не производилось. Определите длительность звукозаписи "
                 "(в минутах). В ответе укажите целое число.")
            sol = f"size = {mbs} * 2 ** 13\nprint(size // ({ch} * {f} * 1000 * {bits} * 60))"
            lv = 2
        elif kind == 2:               # наибольшая глубина кодирования звука
            ch = R.choice([1, 2])
            f = R.choice([8, 11, 16, 22, 32, 44, 48])
            secs = R.choice([30, 45, 60, 90, 120, 180])
            bits = R.randint(5, 30)
            lim_mb = math.ceil(ch * f * 1000 * bits * secs / 8 / 2 ** 20 + R.uniform(0, 0.8))
            ans = lim_mb * 2 ** 23 // (ch * f * 1000 * secs)
            if ans < 2:
                continue
            q = (f"Музыкальный фрагмент длительностью {secs} секунд записали в формате {'стерео' if ch == 2 else 'моно'} с частотой "
                 f"дискретизации {f} кГц. Размер полученного файла без сжатия не превышает {lim_mb} Мбайт. Определите "
                 "максимальную битовую глубину кодирования звука (в битах), которая могла быть использована.")
            sol = f"print({lim_mb} * 2 ** 23 // ({ch} * {f} * 1000 * {secs}))"
            lv = 2
        elif kind == 3:               # экономия трафика при уменьшении палитры
            w, h = R.choice([(1024, 768), (640, 480), (800, 600), (512, 512), (1024, 1024), (2048, 1024)])
            c1 = R.choice([2 ** 24, 65536, 4096, 1024])
            c2 = R.choice([256, 64, 16, 4])
            n = R.choice([1, 5, 10, 20, 50])
            diff = n * w * h * (int(math.log2(c1)) - int(math.log2(c2)))
            if diff % (8 * 1024):
                continue
            ans = diff // 8192
            q = (f"Сайт передаёт посетителю {n} {'изображение' if n == 1 else 'изображений'} размером {w}×{h} пикселей. Раньше в "
                 f"изображениях использовалась палитра из {c1} цветов, теперь — из {c2} цветов; сжатие не применяется, служебная "
                 "информация не учитывается. Сколько Кбайт трафика экономится таким образом?")
            sol = f"import math\nb1, b2 = int(math.log2({c1})), int(math.log2({c2}))\nprint({n} * {w} * {h} * (b1 - b2) // 8 // 1024)"
            lv = 2
        else:                         # передача по двум каналам
            kb = R.choice([256, 512, 625, 1000, 1024, 2000, 2500, 4096])
            s1 = R.choice([2 ** 13, 2 ** 14, 2 ** 15, 2 ** 16, 2 ** 17])
            s2 = R.choice([256000, 128000, 64000, 512000, 2 ** 18, 2 ** 19])
            t1 = kb * 8192 / s1
            t2 = kb * 8192 / s2
            if t1 != int(t1) or abs(t1 - t2) < 1:
                continue
            ans = math.ceil(abs(t1 - t2))
            q = (f"Файл размером {kb} Кбайт передаётся через соединение со скоростью {s1} бит в секунду. На сколько секунд "
                 f"{'быстрее' if t2 < t1 else 'дольше'} можно передать этот же файл через соединение со скоростью {s2} бит в "
                 "секунду? В ответе укажите целое число секунд, округлив вверх.")
            sol = f"import math\nt1 = {kb} * 8192 / {s1}\nt2 = {kb} * 8192 / {s2}\nprint(math.ceil(abs(t1 - t2)))"
            lv = 1
        break
    topic = ["Кодирование изображений", "Кодирование звуков", "Кодирование звуков", "Кодирование изображений",
             "Архивирование и передача данных"][kind]
    add(7, k, f"<p>{q}</p>", ans, topic, code(sol), lv=lv)


# ============================================================ №8 — номер слова в списке, «соседство» букв, анаграммы
REP_WORDS = ["КОЛОКОЛ", "ПАРАБОЛА", "КАРАВАН", "ВОДОВОЗ", "МОЛОКО", "БАРАБАН", "ПАНАМА", "КАКАДУ", "ТАРАКАН", "ПОТОП",
             "БОЛОТО", "ЗАСАДА", "ДЕДУШКА", "КАНАВА", "СОРОКА"]


def gen8(R, k):
    kind = k % 4
    W = M.WORDS
    while True:
        if kind == 0:                 # под каким номером стоит слово
            lets = sorted(set(R.choice(W)))[:R.choice([4, 5, 6])]
            if len(lets) < 4:
                continue
            L = 5 if len(lets) <= 5 else 4
            words = ["".join(p) for p in itertools.product(lets, repeat=L)]
            w = R.choice(words[len(words) // 5:])
            ans = words.index(w) + 1
            nm = R.choice(M.NAMES)
            q = (f"<p>{nm} составляет {L}-буквенные слова из букв {', '.join(lets)} и записывает их в алфавитном порядке, "
                 "нумеруя с единицы. Каждая буква может встречаться в слове любое количество раз. Начало списка:</p><p>"
                 + "<br>".join(f"{i}. {x}" for i, x in enumerate(words[:3], 1)) + "<br>…</p>"
                 f"<p>Под каким номером в списке стоит слово {w}?</p>")
            sol = (f"from itertools import product\nwords = [''.join(p) for p in product('{''.join(lets)}', repeat={L})]\n"
                   f"print(words.index('{w}') + 1)")
            lv = 1
        elif kind == 1:               # буквы X и Y не стоят рядом / X стоит раньше Y
            w = R.choice([x for x in W if len(set(x)) == len(x) and 5 <= len(x) <= 7])
            x, y = R.sample(w, 2)
            sub = R.randint(0, 1)
            perms = ["".join(p) for p in itertools.permutations(w)]
            if sub == 0:
                cond = lambda s: abs(s.index(x) - s.index(y)) > 1
                txt, pc = f"в которых буквы {x} и {y} не стоят рядом", f"abs(s.index('{x}') - s.index('{y}')) > 1"
            else:
                cond = lambda s: s.index(x) < s.index(y) and s[0] not in M.VOW
                txt = f"в которых буква {x} стоит левее буквы {y}, а первая буква — согласная"
                pc = f"s.index('{x}') < s.index('{y}') and s[0] not in 'АЕИОУЫЭЮЯ'"
            ans = sum(1 for s in perms if cond(s))
            q = f"<p>Сколько существует различных слов, которые можно получить перестановкой букв слова {w}, {txt}?</p>"
            sol = f"from itertools import permutations\nprint(sum(1 for p in permutations('{w}') for s in [''.join(p)] if {pc}))"
            lv = 2
        elif kind == 2:               # анаграммы слова с повторяющимися буквами
            w = R.choice(REP_WORDS)
            sub = R.randint(0, 1)
            perms = set(itertools.permutations(w))
            if sub == 0:
                cond = lambda s: all(a != b for a, b in zip(s, s[1:]))
                txt, pc = "в которых никакие две одинаковые буквы не стоят рядом", "all(a != b for a, b in zip(s, s[1:]))"
            else:
                cond = lambda s: s[0] == s[-1]
                txt, pc = "которые начинаются и заканчиваются одной и той же буквой", "s[0] == s[-1]"
            ans = sum(1 for s in perms if cond(s))
            if ans == 0:
                continue
            q = (f"<p>Сколько существует различных слов, которые можно получить перестановкой всех букв слова {w}, {txt}? "
                 "Словом считается любая последовательность букв, не обязательно осмысленная.</p>")
            sol = f"from itertools import permutations\nprint(len({{s for s in permutations('{w}') if {pc}}}))"
            lv = 3
        else:                         # числа: две «семёрки» не рядом, сумма цифр
            b = R.choice([7, 8, 9, 11, 12])
            L = R.choice([5, 6]) if b <= 9 else 5
            digs = "0123456789AB"[:b]
            d = R.choice(digs[1:])
            m = R.choice([3, 4, 5, 6])
            cnt = 0
            for p in itertools.product(digs, repeat=L):
                if p[0] == "0":
                    continue
                s = "".join(p)
                if s.count(d) == 2 and d + d not in s and sum(int(c, 16) for c in s) % m == 0:
                    cnt += 1
            ans = cnt
            if ans < 5:
                continue
            bname = {7: "семеричных", 8: "восьмеричных", 9: "девятеричных", 11: "одиннадцатеричных", 12: "двенадцатеричных"}[b]
            q = (f"<p>Определите количество {L}-значных {bname} чисел, в записи которых цифра {d} встречается ровно два раза, "
                 f"причём эти две цифры {d} не стоят рядом, а сумма всех цифр числа делится на {m}.</p>"
                 + ("<p>Цифры A и B обозначают числа 10 и 11.</p>" if b > 10 else ""))
            sol = (f"from itertools import product\ncnt = 0\nfor p in product('{digs}', repeat={L}):\n    s = ''.join(p)\n"
                   f"    if s[0] != '0' and s.count('{d}') == 2 and '{d}{d}' not in s and sum(int(c, 16) for c in s) % {m} == 0:\n"
                   "        cnt += 1\nprint(cnt)")
            lv = 3
        break
    add(8, k, q, ans, "Упорядоченный список" if kind == 0 else "Подсчёт комбинаций", code(sol), lv=lv)


# ============================================================ №9 — номер строки, сумма чисел строки, сумма номеров
def gen9(R, k):
    kind = k % 4
    rows_n = R.randint(25, 45) * 100
    if kind == 0:     # наибольший номер строки: одно число равно сумме двух других (4 числа)
        cols, hi = 4, R.choice([30, 50, 80])
        test = "    a = sorted(r)\n    if any(a[i] + a[j] == a[m] for i in range(4) for j in range(i + 1, 4) for m in range(4) if m not in (i, j)) and len(set(r)) == 4:"
        ask = "наибольший номер строки таблицы, в которой все числа различны и одно из чисел равно сумме двух других"
        res = "best = num"
        out = "print(best)"
    elif kind == 1:   # сумма чисел первой подходящей строки
        cols, hi = 6, R.choice([100, 200])
        test = "    a = sorted(r)\n    if len(set(r)) == 6 and a[0] * a[5] > sum(a[1:5]) * 3 and sum(x % 2 for x in r) == 3:"
        ask = ("сумму чисел в строке таблицы с наименьшим номером, для которой выполнены условия: все шесть чисел различны, "
               "произведение наибольшего и наименьшего чисел больше утроенной суммы четырёх остальных, нечётных чисел в строке ровно три")
        res = "best = sum(r) if best is None else best"
        out = "print(best)"
    elif kind == 2:   # сумма номеров строк: числа после сортировки — арифметическая прогрессия
        cols, hi = 4, R.choice([20, 30, 40])
        test = "    a = sorted(r)\n    if a[1] - a[0] == a[2] - a[1] == a[3] - a[2] > 0:"
        ask = ("сумму номеров строк таблицы, числа в которых, если расположить их по возрастанию, образуют арифметическую "
               "прогрессию с ненулевой разностью")
        res = "best = (best or 0) + num"
        out = "print(best)"
    else:             # количество строк: ровно две пары повторов, среднее — целое
        cols, hi = 6, R.choice([15, 20, 25])
        test = ("    c = {x: r.count(x) for x in r}\n    if sorted(c.values()) == [1, 1, 2, 2] and sum(r) % 6 == 0:")
        ask = ("количество строк таблицы, в которых ровно два числа встречаются по два раза, а остальные два различны и не "
               "совпадают с ними, причём среднее арифметическое всех шести чисел строки — целое число")
        res = "best = (best or 0) + 1"
        out = "print(best)"
    src = "best = None\nfor num, r in enumerate(rows, 1):\n" + test + "\n        " + res
    rows = [[R.randint(1, hi) for _ in range(cols)] for _ in range(rows_n)]
    g = {"rows": rows}
    exec(src, g)
    if g["best"] is None or (kind == 3 and g["best"] < 5):
        return gen9(R, k)
    ans = g["best"]
    words = {4: "четыре натуральных числа", 6: "шесть натуральных чисел"}[cols]
    G().write_xlsx(M.media(9) / f"e9-{k:02d}.xlsx", [("Лист1", rows)])
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            f"<p>Откройте файл электронной таблицы, содержащей в каждой строке {words}. Строки нумеруются с единицы. "
            f"Определите {ask}.</p><p>В ответе запишите только число.</p>")
    sol = "rows = [list(map(int, s.split())) for s in open('9.txt') if s.strip()]\n" + src + "\n" + out
    add(9, k, body, ans, "Обработка числовой информации в электронных таблицах", code(sol),
        att=[{"name": "9.xlsx", "href": f"media/egeshka_bank/9/e9-{k:02d}.xlsx"}], lv=3 if kind in (1, 3) else 2)


# ============================================================ №10 — адрес сети, единицы по половинам, байт маски
def gen10(R, k):
    kind = k % 4
    ip_s, mask_of = M.ip_s, M.mask_of
    while True:
        ip = R.choice([R.randint(1, 223), 10, 172, 192]) << 24 | R.getrandbits(24)
        if kind == 0:                 # адрес сети
            p = R.randint(9, 29)
            net = ip & mask_of(p)
            if net == ip:
                continue
            ans = "".join(ip_s(net).split("."))
            q = (f"Узел с IP-адресом {ip_s(ip)} находится в сети с маской {ip_s(mask_of(p))}. Найдите адрес этой сети. В ответе "
                 "запишите адрес без точек, например для адреса 111.22.3.0 — 1112230.")
            sol = (f"from ipaddress import ip_network\nnet = ip_network('{ip_s(ip)}/{ip_s(mask_of(p))}', strict=False)\n"
                   "print(str(net.network_address).replace('.', ''))")
            head, lv = M.IP_HEAD, 1
        elif kind == 1:               # единиц в левых двух байтах больше, чем в правых
            p = R.randint(16, 24)
            net = ip & mask_of(p)
            cmp_ = R.choice([">", "<", "=="])
            f = {">": lambda a, b: a > b, "<": lambda a, b: a < b, "==": lambda a, b: a == b}[cmp_]
            ans = sum(1 for a in range(net, net + 2 ** (32 - p)) if f(bin(a >> 16).count("1"), bin(a & 0xFFFF).count("1")))
            if ans < 5:
                continue
            word = {">": "больше, чем", "<": "меньше, чем", "==": "столько же, сколько"}[cmp_]
            q = (f"Сеть задана IP-адресом {ip_s(net)} и маской сети {ip_s(mask_of(p))}. Сколько в этой сети IP-адресов, у "
                 f"которых в двоичной записи двух левых байтов единиц {word} в двоичной записи двух правых байтов?")
            sol = (f"from ipaddress import ip_network\ncnt = 0\nfor a in ip_network('{ip_s(net)}/{ip_s(mask_of(p))}'):\n"
                   "    a = int(a)\n    l, r = bin(a >> 16).count('1'), bin(a & 0xFFFF).count('1')\n"
                   f"    if l {cmp_} r:\n        cnt += 1\nprint(cnt)")
            head, lv = M.IP_HEAD, 2
        elif kind == 2:               # адресов с ровно K единицами, не считая адреса сети и широковещательного
            p = R.randint(18, 26)
            net = ip & mask_of(p)
            hosts = range(net + 1, net + 2 ** (32 - p) - 1)
            ones = [bin(a).count("1") for a in hosts]
            K = R.choice(ones)
            ans = ones.count(K)
            q = (f"Сеть задана IP-адресом {ip_s(net)} и маской сети {ip_s(mask_of(p))}. Сколько в этой сети адресов, которые "
                 f"можно назначить узлам, если в двоичной записи адреса должно быть ровно {K} единиц?")
            sol = (f"from ipaddress import ip_network\nnet = ip_network('{ip_s(net)}/{ip_s(mask_of(p))}')\n"
                   f"print(sum(1 for a in net.hosts() if bin(int(a)).count('1') == {K}))")
            head, lv = M.IP_HEAD + M.IP_BCAST, 2
        else:                         # наибольшее / наименьшее возможное значение третьего байта маски
            p = R.randint(17, 23)
            net = ip & mask_of(p)
            ok = [q_ for q_ in range(1, 32) if ip & mask_of(q_) == net]
            vals = sorted({mask_of(q_) >> 8 & 255 for q_ in ok})
            if len(vals) < 2:
                continue
            big = R.random() < 0.5
            ans = vals[-1] if big else vals[0]
            q = (f"Для узла с IP-адресом {ip_s(ip)} адрес сети равен {ip_s(net)}. Чему равно "
                 f"{'наибольшее' if big else 'наименьшее'} возможное значение третьего слева байта маски? Ответ запишите в виде "
                 "десятичного числа.")
            sol = (f"from ipaddress import ip_address\nip, net = int(ip_address('{ip_s(ip)}')), int(ip_address('{ip_s(net)}'))\n"
                   "vals = [((2 ** 32 - 1) ^ (2 ** (32 - p) - 1)) >> 8 & 255 for p in range(1, 32)\n"
                   "        if ip & ((2 ** 32 - 1) ^ (2 ** (32 - p) - 1)) == net]\n"
                   f"print({'max' if big else 'min'}(vals))")
            head, lv = M.IP_HEAD, 3
        break
    add(10, k, head + f"<p>{q}</p>", ans, "Маска подсети", code(sol), lv=lv)


# ============================================================ №11 — сколько пользователей, мощность алфавита, составные номера
def gen11(R, k):
    kind = k % 4
    while True:
        o = R.choice(M.OBJ)
        L = R.randint(8, 120)
        m = R.choice([10, 26, 33, 36, 52, 62, 100, 500, 1500])
        bits = math.ceil(math.log2(m))
        per = math.ceil(L * bits / 8)
        if kind == 0:                 # о скольких пользователях можно хранить сведения
            extra = R.randint(0, 40)
            kb = R.choice([1, 2, 4, 8, 16, 64, 128])
            ans = kb * 1024 // (per + extra)
            if ans < 3:
                continue
            q = (f"Каждому {o[3]} выдаётся {o[0]} из {L} {pl(L, 'символа', 'символов', 'символов')}, состоящий только из {m} различных символов. Для хранения "
                 f"каждого {o[1]} отводится одинаковое и минимально возможное целое число байт, символы кодируются "
                 f"одинаковым и минимально возможным числом бит." + (f" Кроме того, о каждом из {o[4]} хранится {extra} байт "
                 "дополнительных сведений." if extra else "") + f" О каком наибольшем количестве {o[4]} можно сохранить "
                 f"сведения в {kb} Кбайт памяти?")
            sol = (f"import math\nper = math.ceil({L} * math.ceil(math.log2({m})) / 8) + {extra}\nprint({kb} * 1024 // per)")
            lv = 2
        elif kind == 1:               # наибольшая мощность алфавита
            N = R.choice([100, 256, 500, 1000, 2048, 5000])
            lim = R.randint(N * L // 8, N * L * 2)
            bb = [b for b in range(1, 20) if N * math.ceil(L * b / 8) <= lim]
            if not bb:
                continue
            ans = 2 ** bb[-1]
            q = (f"Каждому {o[3]} выдаётся {o[0]} длиной {L} {pl(L, 'символ', 'символа', 'символов')}. В базе данных для хранения каждого {o[1]} отведено "
                 "одинаковое и минимально возможное целое число байт, все символы кодируются одинаковым и минимально "
                 f"возможным количеством бит. Известно, что для хранения {N} {o[2]} оказалось достаточно {lim} байт. "
                 "Определите максимально возможную мощность алфавита, из символов которого могут состоять "
                 f"{o[6]}.")
            sol = (f"import math\nfor b in range(19, 0, -1):\n    if {N} * math.ceil({L} * b / 8) <= {lim}:\n"
                   "        print(2 ** b)\n        break")
            lv = 3
        elif kind == 2:               # наименьшая длина
            N = R.choice([2 ** 12, 2 ** 15, 50000, 100000, 2 ** 17])
            lim_kb = R.randint(N * 2 // 1024, N * 20 // 1024)
            Ls = [x for x in range(1, 5000) if N * math.ceil(x * bits / 8) >= lim_kb * 1024]
            if not Ls:
                continue
            ans = Ls[0]
            q = (f"{o[0][0].upper() + o[0][1:]} состоит из символов {m}-символьного алфавита; все {o[6]} одинаковой длины. "
                 f"Для хранения каждого {o[1]} отводится одинаковое и минимально возможное целое число байт, символы кодируются "
                 f"одинаковым и минимально возможным числом бит. Известно, что для хранения {N} {o[2]} потребовалось не менее "
                 f"{lim_kb} Кбайт. Определите минимально возможную длину {o[1]}.")
            sol = (f"import math\nbits = math.ceil(math.log2({m}))\nL = 1\nwhile {N} * math.ceil(L * bits / 8) < {lim_kb} * 1024:\n"
                   "    L += 1\nprint(L)")
            lv = 3
        else:                         # номер из двух частей, каждая кодируется отдельно
            L1, L2 = R.randint(2, 8), R.randint(3, 12)
            m1 = R.choice([26, 33, 20, 12])
            N = R.choice([50, 100, 250, 1000, 4096])
            b1 = math.ceil(L1 * math.ceil(math.log2(m1)) / 8)
            b2 = math.ceil(L2 * 4 / 8)
            ans = N * (b1 + b2)
            q = (f"Номер участника олимпиады состоит из двух частей. Первая часть — {L1} заглавных {pl(L1, 'буква', 'буквы', 'букв')} из набора, "
                 f"содержащего {m1} различных букв, вторая — {L2} десятичных {pl(L2, 'цифра', 'цифры', 'цифр')}. Каждая часть хранится отдельно: под каждую отводится "
                 "минимально возможное целое число байт, символы каждой части кодируются одинаковым и минимально возможным для "
                 f"этой части количеством бит. Сколько байт потребуется для хранения номеров {N} участников?")
            sol = (f"import math\nb1 = math.ceil({L1} * math.ceil(math.log2({m1})) / 8)\nb2 = math.ceil({L2} * math.ceil(math.log2(10)) / 8)\n"
                   f"print({N} * (b1 + b2))")
            lv = 2
        break
    add(11, k, f"<p>{q}</p>", ans, "Равномерное кодирование текстовой информации", code(sol), lv=lv)


# ============================================================ №12 — машина Тьюринга: обратные задачи по многим числам
def tm_value(prog, n):
    r = M.tm_run(prog, bin(n)[2:], 600)
    if not r or not r[0] or "λ" in r[0]:
        return None
    return r[0]


def gen12(R, k):
    kind = k % 3
    while True:
        ns = R.choice([3, 4])
        prog = {(0, "λ"): ("λ", "L", 1)}
        for s in range(1, ns):
            for y in "λ01":
                w = y if R.random() < 0.5 else R.choice("01" if y != "λ" else "λ01")
                prog[(s, y)] = (w, R.choice("LLRS" if s == ns - 1 else "LLLR"), R.randrange(1, ns))
        outs = {}
        used = set()
        bad = False
        for n in range(1, 1024):
            r = M.tm_run(prog, bin(n)[2:], 600)
            if not r or not r[0] or "λ" in r[0]:
                bad = True
                break
            outs[n] = r[0]
            used |= r[1]
        if bad or len(used) < 5 or len({u[0] for u in used}) < 3:
            continue
        prog = {u: prog[u] for u in used}
        states = sorted({u[0] for u in used} | {v[2] for v in prog.values()})
        if states != list(range(len(states))):
            continue
        val = {n: int(s, 2) for n, s in outs.items()}
        if sum(val[n] != n for n in val) < 100:
            continue
        if kind == 0:                 # наименьшее N, результат которого больше X
            X = R.choice(sorted(val.values())[300:900])
            good = [n for n in range(1, 1024) if val[n] > X]
            if not good:
                continue
            ans = good[0]
            q = (f"Определите наименьшее натуральное N, при обработке двоичной записи которого результатом работы программы "
                 f"будет число, большее {X}. Результат прочитайте как двоичную запись числа (ведущие нули не учитываются).")
            tail = f"n = 1\nwhile run(n) <= {X}:\n    n += 1\nprint(n)"
        elif kind == 1:               # сколько N от 1 до 1023 программа не меняет
            same = sum(1 for n in val if val[n] == n)
            if same < 2:
                continue
            ans = same
            q = ("Для скольких натуральных чисел N от 1 до 1023 включительно число, записанное на ленте после выполнения "
                 "программы, равно исходному N? Результат прочитайте как двоичную запись числа (ведущие нули не учитываются).")
            tail = "print(sum(1 for n in range(1, 1024) if run(n) == n))"
        else:                         # наибольшее число нулей
            zeros = {n: outs[n].lstrip("0").count("0") for n in range(1, 256)}
            ans = max(zeros.values())
            q = ("Исходные данные — двоичные записи всех чисел N от 1 до 255. Определите максимально возможное число значащих "
                 "нулей в записи результата (ведущие нули не учитываются).")
            tail = "print(max(raw(n).lstrip('0').count('0') for n in range(1, 256)))"
        break
    body = (M.TM_HEAD + "<p><u>Выполните задание.</u></p>"
            "<p>На ленте в соседних ячейках записано двоичное представление натурального числа N без ведущих нулей. Ячейки "
            "справа и слева от последовательности заполнены пустыми символами «λ». В начальный момент времени головка "
            "расположена в ближайшей справа к последовательности ячейке.</p><p>Программа работы исполнителя:</p>"
            + M.tm_table(prog, len(states)) + f"<p>{q}</p>")
    sol = ("prog = {\n" + "".join(f"    ({s}, '{y}'): ('{w}', '{m}', {n}),\n" for (s, y), (w, m, n) in sorted(prog.items()))
           + "}\n\ndef raw(n):\n    tape = dict(enumerate(bin(n)[2:]))\n    pos, st = len(tape), 0\n    while True:\n"
           "        w, mv, st = prog[(st, tape.get(pos, 'λ'))]\n        tape[pos] = w\n        if mv == 'S':\n            break\n"
           "        pos += 1 if mv == 'R' else -1\n    return ''.join(tape[i] for i in sorted(tape)).strip('λ')\n\n"
           "def run(n):\n    return int(raw(n), 2)\n\n" + tail)
    add(12, k, body, ans, "Машина Тьюринга", code(sol), lv=3)


# ============================================================ №13 — программы без траектории, кратность, лимит команд
OPS13X = [("Прибавить 1", "x + 1", lambda x: x + 1), ("Прибавить 2", "x + 2", lambda x: x + 2),
          ("Прибавить 3", "x + 3", lambda x: x + 3), ("Умножить на 2", "x * 2", lambda x: x * 2),
          ("Умножить на 3", "x * 3", lambda x: x * 3), ("Дописать справа 1", "x * 10 + 1", lambda x: x * 10 + 1),
          ("Возвести в квадрат", "x * x", lambda x: x * x)]


def gen13(R, k):
    kind = k % 3
    while True:
        adds = R.sample(OPS13X[:3], R.choice([1, 2]))
        rest = R.sample(OPS13X[3:], 1)
        ops = [o for o in OPS13X if o in adds + rest]
        a = R.randint(2, 9)                    # от 1 «возвести в квадрат» зациклилось бы
        b = R.randint(25, 99)
        from functools import lru_cache
        if kind == 0:                 # просто количество программ
            @lru_cache(None)
            def f(x):
                return 1 if x == b else 0 if x > b else sum(f(o[2](x)) for o in ops)
            ans = f(a)
            q = f"Сколько существует программ, которые преобразуют исходное число {a} в число {b}?"
            sol = ("from functools import lru_cache\n\n@lru_cache(None)\ndef f(x):\n    if x == " + str(b) + ":\n        return 1\n"
                   f"    if x > {b}:\n        return 0\n    return " + " + ".join(f"f({o[1]})" for o in ops) + f"\n\nprint(f({a}))")
            lv = 1
        elif kind == 1:               # траектория без чисел, кратных m
            m = R.choice([3, 4, 5, 6, 7])
            if b % m == 0:
                continue

            @lru_cache(None)
            def f(x):
                return 1 if x == b else 0 if x > b or x % m == 0 else sum(f(o[2](x)) for o in ops)
            ans = f(a) if a % m else 0
            q = (f"Сколько существует программ, для которых при исходном числе {a} результатом является число {b}, и при этом "
                 f"траектория вычислений не содержит ни одного числа, кратного {m}?")
            sol = ("from functools import lru_cache\n\n@lru_cache(None)\ndef f(x):\n" f"    if x > {b} or x % {m} == 0:\n        return 0\n"
                   f"    if x == {b}:\n        return 1\n    return " + " + ".join(f"f({o[1]})" for o in ops) + f"\n\nprint(f({a}))")
            lv = 2
        else:                         # последняя команда использована ровно один раз / не более двух раз
            lim = R.choice([0, 1, 2])
            last = len(ops) - 1

            @lru_cache(None)
            def f(x, used):
                if x > b or used > lim:
                    return 0
                if x == b:
                    return 1 if used == lim or lim == 2 and used <= 2 else 0
                return sum(f(o[2](x), used + (i == last)) for i, o in enumerate(ops))
            ans = f(a, 0)
            word = {0: "ни разу не используется команда", 1: "ровно один раз используется команда",
                    2: "не более двух раз используется команда"}[lim]
            q = (f"Сколько существует программ, которые преобразуют исходное число {a} в число {b}, если в программе {word} "
                 f"{last + 1} («{ops[last][0]}»)?")
            cond = "used == " + str(lim) if lim < 2 else "used <= 2"
            sol = ("from functools import lru_cache\n\n@lru_cache(None)\ndef f(x, used):\n" f"    if x > {b} or used > {lim}:\n        return 0\n"
                   f"    if x == {b}:\n        return 1 if {cond} else 0\n    return "
                   + " + ".join(f"f({o[1]}, used + {int(i == last)})" for i, o in enumerate(ops)) + f"\n\nprint(f({a}, 0))")
            lv = 3
        if 5 <= ans <= 10 ** 7:
            break
    name = R.choice(M.EXEC)
    lst = "<br>".join(f"{i + 1}. {o[0]}" for i, o in enumerate(ops))
    ex = "".join(str(i + 1) for i in R.sample(range(len(ops)), len(ops)))
    v, tr = 2, []
    for ch in ex:
        v = ops[int(ch) - 1][2](v)
        tr.append(str(v))
    descr = {"Дописать справа 1": "приписывает к числу справа цифру 1", "Возвести в квадрат": "возводит число в квадрат"}
    desc = "; ".join(f"команда {i + 1} " + descr.get(o[0], o[0].lower().replace("прибавить", "увеличивает число на")
                                                     .replace("умножить на", "умножает число на")) for i, o in enumerate(ops))
    body = (f"<p>Исполнитель {name} преобразует число на экране. У исполнителя есть {['', '', 'две', 'три'][len(ops)]} "
            f"команды, которым присвоены номера:</p><p>{lst}</p><p>{desc[0].upper() + desc[1:]}.</p><p>Программа для исполнителя "
            f"{name} — это последовательность команд. Траектория вычислений — последовательность результатов выполнения всех "
            f"команд программы. Например, для программы {ex} при исходном числе 2 траектория будет состоять из чисел "
            f"{', '.join(tr)}.</p><p>{q}</p>")
    add(13, k, body, ans, "Подсчёт количества программ", code(sol), lv=lv)


# ============================================================ №14 — значащие нули, основания с заданным окончанием, наименьшее основание
def gen14(R, k):
    kind = k % 3
    DIG = M.DIG
    while True:
        if kind == 0:                 # значащие нули
            p = R.choice([2, 3, 4, 5, 6, 7, 8, 9, 16])
            pw = [b for b in (2, 3, 4, 5, 6, 7, 8, 9, 16, 25, 27, 32, 49, 64, 81, 125, 243, 256) if any(b == p ** i for i in range(1, 6))]
            t = [(R.choice(pw), R.randint(30, 900)) for _ in range(2)]
            sub = R.randint(2, 500)
            v = t[0][0] ** t[0][1] - t[1][0] ** t[1][1] + sub if R.random() < 0.5 else t[0][0] ** t[0][1] + t[1][0] ** t[1][1] - sub
            sign = "−" if v == t[0][0] ** t[0][1] - t[1][0] ** t[1][1] + sub else "+"
            if v <= 0:
                continue
            s = M.to_base(v, p)
            ans = s.count("0")
            if ans == 0:
                continue
            expr = (f"{t[0][0]}<sup>{t[0][1]}</sup> {sign} {t[1][0]}<sup>{t[1][1]}</sup> {'+' if sign == '−' else '−'} {sub}")
            pyexpr = (f"{t[0][0]} ** {t[0][1]} {'-' if sign == '−' else '+'} {t[1][0]} ** {t[1][1]} {'+' if sign == '−' else '-'} {sub}")
            q = (f"<p>Значение арифметического выражения</p><p>{expr}</p><p>записали в системе счисления с основанием {p}. "
                 "Сколько значащих нулей содержится в этой записи?</p>")
            sol = (f"v = {pyexpr}\ns = ''\nwhile v:\n    s = str(v % {p}) + s if {p} <= 10 else '0123456789ABCDEF'[v % {p}] + s\n"
                   f"    v //= {p}\nprint(s.count('0'))")
            lv = 2
        elif kind == 1:               # все основания, в которых запись числа оканчивается на d
            N = R.randint(30, 300)
            d = R.choice(["1", "2", "3", "11", "12", "21", "10"])
            dv = [int(c) for c in d]
            def conv(v, p):
                out = []
                while v:
                    out.append(v % p)
                    v //= p
                return out[::-1]
            bases = [p for p in range(2, N + 2) if conv(N, p)[-len(dv):] == dv]
            if not 2 <= len(bases) <= 8:
                continue
            ans = " ".join(map(str, bases))
            q = (f"<p>Укажите в порядке возрастания все основания систем счисления, в которых запись числа {N} оканчивается на "
                 f"{d}. Основания запишите через пробел.</p>")
            sol = (f"def conv(n, p):\n    s = []\n    while n:\n        s.append(n % p)\n        n //= p\n    return s[::-1]\n\n"
                   f"print(*[p for p in range(2, {N + 2}) if conv({N}, p)[-{len(d)}:] == {dv}])")
            lv = 2
        else:                         # наименьшее основание, при котором выражение кратно m
            a_s = "".join(R.choice("123456789") for _ in range(R.randint(3, 4)))
            b_s = "".join(R.choice("123456789") for _ in range(R.randint(2, 4)))
            m = R.choice([7, 11, 13, 17, 19, 23])
            lo = max(map(int, a_s + b_s)) + 1
            good = [p for p in range(lo, 37) if (int(a_s, p) + int(b_s, p)) % m == 0]
            if not good:
                continue
            ans = good[0]
            q = (f"<p>Значение выражения {a_s}<sub>p</sub> + {b_s}<sub>p</sub>, где оба числа записаны в системе счисления с "
                 f"основанием p, кратно {m}. Найдите наименьшее возможное основание p (p ≤ 36).</p>")
            sol = (f"for p in range({lo}, 37):\n    if (int('{a_s}', p) + int('{b_s}', p)) % {m} == 0:\n        print(p)\n        break")
            lv = 2
        break
    add(14, k, q, ans, "Длинная арифметика" if kind == 0 else "Системы счисления", code(sol), lv=lv)


# ============================================================ №15 — множества, наибольшая длина отрезка, неравенства с A дважды
def gen15(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # множества
            P = sorted(R.sample(range(1, 40), R.randint(5, 9)))
            Q = sorted(R.sample(range(1, 40), R.randint(5, 9)))
            forms = [
                ("((x ∈ A) → (x ∈ P)) ∧ ((x ∈ Q) → (x ∈ A))", lambda x, a: ((not a) or x in P) and ((x not in Q) or a),
                 "((not a) or x in P) and ((x not in Q) or a)"),
                ("((x ∈ P) ∧ (x ∈ Q)) → (x ∈ A)", lambda x, a: (not (x in P and x in Q)) or a,
                 "(not (x in P and x in Q)) or a"),
                ("(x ∈ A) → ((x ∈ P) ∨ (x ∈ Q))", lambda x, a: (not a) or x in P or x in Q, "(not a) or x in P or x in Q"),
                ("((x ∈ P) → (x ∈ A)) ∨ (x ∈ Q)", lambda x, a: (x not in P) or a or x in Q, "(x not in P) or a or x in Q"),
            ]
            tex, F, py = R.choice(forms)
            U = range(1, 200)
            must = [x for x in U if not F(x, False)]
            may = [x for x in U if F(x, True)]
            out_ok = F(10 ** 6, True)            # можно ли брать числа вне P и Q — тогда максимум бесконечен
            if R.random() < 0.5 and not out_ok and may:
                ans, what = len(may), "наибольшее"
            else:
                ans, what = len(must), "наименьшее"
            if ans == 0 or any(not F(x, True) and not F(x, False) for x in U):
                continue
            q = (f"<p>Элементами множеств A, P и Q являются натуральные числа, причём P = {{{', '.join(map(str, P))}}}, "
                 f"Q = {{{', '.join(map(str, Q))}}}. Известно, что выражение</p><p>{tex}</p><p>истинно (то есть принимает "
                 f"значение 1) при любом значении переменной x. Определите {what} возможное количество элементов в множестве A.</p>")
            sol = (f"P = {set(P)}\nQ = {set(Q)}\nF = lambda x, a: {py}\n"
                   + ("print(sum(1 for x in range(1, 1000) if not F(x, False)))   # обязаны лежать в A" if what == "наименьшее" else
                      "print(sum(1 for x in range(1, 1000) if F(x, True)))        # могут лежать в A"))
            topic, lv = "Множества", 2
        elif kind == 1:               # наибольшая длина отрезка A
            P = sorted(R.sample(range(5, 90), 2))
            Q = sorted(R.sample(range(5, 90), 2))
            inP = lambda x: P[0] <= x <= P[1]
            inQ = lambda x: Q[0] <= x <= Q[1]
            # A может лежать только там, где выражение истинно при x ∈ A; эта область должна быть ограниченной
            forms = [("(x ∈ A) → ((x ∈ P) ∨ (x ∈ Q))", lambda x, a: (not a) or inP(x) or inQ(x), "(not a) or inP(x) or inQ(x)"),
                     ("(x ∈ A) → ((x ∈ P) ∧ ¬(x ∈ Q))", lambda x, a: (not a) or (inP(x) and not inQ(x)),
                      "(not a) or (inP(x) and not inQ(x))"),
                     ("((x ∈ A) → (x ∈ P)) ∧ ((x ∈ A) → (x ∈ Q))", lambda x, a: ((not a) or inP(x)) and ((not a) or inQ(x)),
                      "((not a) or inP(x)) and ((not a) or inQ(x))")]
            tex, F, py = R.choice(forms)
            grid = [i / 4 for i in range(0, 400)]
            ok = [F(x, True) for x in grid]
            if ok[0] or ok[-1]:
                continue                         # область не ограничена — наибольшей длины нет
            # отрезок A — непрерывный кусок, где «x ∈ A» допустимо; длина бесконечна, если он выходит за [0; 100)
            best, cur, start = 0, 0, None
            runs = []
            for i, v in enumerate(ok):
                if v and start is None:
                    start = i
                if (not v or i == len(ok) - 1) and start is not None:
                    end = i - 1 if not v else i
                    runs.append((start, end))
                    start = None
            runs = [(a_, b_) for a_, b_ in runs if a_ > 0 and b_ < len(ok) - 1]
            if not runs:
                continue
            a_, b_ = max(runs, key=lambda r: r[1] - r[0])
            L = (b_ - a_) / 4
            if L != int(L) or L == 0:
                continue
            ans = int(L)
            q = (f"<p>На числовой прямой даны два отрезка: P = [{P[0]}; {P[1]}] и Q = [{Q[0]}; {Q[1]}]. Укажите наибольшую "
                 "возможную длину отрезка A, для которого логическое выражение</p>"
                 f"<p>{tex}</p><p>тождественно истинно (то есть принимает значение 1 при любом значении переменной x).</p>")
            sol = (f"inP = lambda x: {P[0]} <= x <= {P[1]}\ninQ = lambda x: {Q[0]} <= x <= {Q[1]}\n"
                   f"F = lambda x, a: {py}\n# отрезок A может лежать только там, где выражение истинно и при x ∈ A\n"
                   "best = run = 0\nfor i in range(1, 400):\n    x = i / 4\n    run = run + 1 if F(x, True) and F(x - 0.25, True) else 0\n"
                   "    best = max(best, run)\nprint(round(best / 4))")
            topic, lv = "Отрезки", 3
        else:                         # A с двух сторон: (x·y < c) ∨ (x ≥ A) ∨ (y ≥ A)
            c = R.randint(30, 400)
            form = R.randint(0, 1)
            if form == 0:
                tex = f"(x · y &lt; {c}) ∨ (x ≥ A) ∨ (y ≥ A)"
                F = lambda x, y, A: x * y < c or x >= A or y >= A
                py = f"x * y < {c} or x >= A or y >= A"
                big = True
            else:
                tex = f"(x + y ≤ {c // 4}) ∨ (y ≤ x + A) ∨ (x ≥ A)"
                F = lambda x, y, A: x + y <= c // 4 or y <= x + A or x >= A
                py = f"x + y <= {c // 4} or y <= x + A or x >= A"
                big = False
            D = range(0, 2 * c + 3)
            cands = [A for A in range(0, 2 * c + 3) if all(F(x, y, A) for x in D for y in D)] if form == 1 else \
                [A for A in range(0, 2 * c + 3) if all(x >= A or y >= A for x in D for y in D if x * y >= c)]
            if not cands:
                continue
            ans = max(cands) if big else min(cands)
            if ans <= 0:
                continue
            q = (f"<p>Для какого {'наибольшего' if big else 'наименьшего'} целого неотрицательного числа A выражение</p>"
                 f"<p>{tex}</p><p>тождественно истинно, то есть принимает значение 1 при любых целых неотрицательных x и y?</p>")
            sol = (f"def ok(A):\n    return all({py} for x in range({2 * c + 3}) for y in range({2 * c + 3}))\n\n"
                   + (f"A = {2 * c + 2}\nwhile not ok(A):\n    A -= 1\nprint(A)" if big else "A = 0\nwhile not ok(A):\n    A += 1\nprint(A)"))
            topic, lv = "Графики", 3
        break
    add(15, k, q, ans, topic, code(sol), lv=lv)


# ============================================================ №16 — чётные/нечётные ветви, нули в конце, F(n // 3)
def gen16(R, k):
    kind = k % 3
    while True:
        if kind == 0:                 # разные ветви для чётных и нечётных n
            c = R.randint(1, 3)
            p, q_ = R.randint(1, 3), R.randint(1, 4)
            N = R.randint(18, 40)
            F = {}
            for n in range(1, N + 1):
                F[n] = n if n <= c + 1 else (F[n - 1] + p * F[n - 2] if n % 2 == 0 else F[n - 1] - F[n - 2] + q_ * n)
            ans = F[N]
            tex = (f"F(n) = n при n ≤ {c + 1};<br>F(n) = F(n − 1) + {str(p) + ' · ' if p > 1 else ''}F(n − 2), если n &gt; {c + 1} и n чётно;"
                   f"<br>F(n) = F(n − 1) − F(n − 2) + {str(q_) + ' · ' if q_ > 1 else ''}n, если n &gt; {c + 1} и n нечётно.")
            ask = f"Чему равно значение функции F({N})?"
            sol = (f"def F(n):\n    if n <= {c + 1}:\n        return n\n    if n % 2 == 0:\n        return F(n - 1) + {p} * F(n - 2)\n"
                   f"    return F(n - 1) - F(n - 2) + {q_} * n\n\nprint(F({N}))")
            lv = 2
        elif kind == 1:               # сколько нулей в конце F(N)
            st = R.choice([1, 2, 3])
            N = R.randint(100, 3000)
            v = 1
            for n in range(N, 0, -st):
                v *= n
            ans = 0
            while v % 10 == 0:                 # без str(): у F(N) могут быть тысячи цифр
                v //= 10
                ans += 1
            if ans < 3:
                continue
            tex = f"F(n) = n при n ≤ {st};<br>F(n) = n · F(n − {st}) при n &gt; {st}." if st > 1 else "F(1) = 1;<br>F(n) = n · F(n − 1) при n &gt; 1."
            ask = f"Сколько нулей стоит в конце десятичной записи значения F({N})?"
            sol = (f"import sys\nsys.setrecursionlimit(10000)\ndef F(n):\n    return n if n <= {st} else n * F(n - {st})\n\n"
                   f"v = F({N})\nzeros = 0\nwhile v % 10 == 0:\n    v //= 10\n    zeros += 1\nprint(zeros)")
            lv = 2
        else:                         # F(n) = F(n // b) + цифра — сколько n с заданным значением
            b = R.choice([3, 4, 5])
            lim = R.choice([500, 1000, 2000])
            mul = R.randint(1, 3)
            F = {0: 0}
            for n in range(1, lim + 1):
                F[n] = F[n // b] + mul * (n % b)
            vals = [F[n] for n in range(1, lim + 1)]
            tgt = R.choice(sorted(set(vals)))
            ans = vals.count(tgt)
            if ans < 5:
                continue
            tex = (f"F(0) = 0;<br>F(n) = F(n div {b}) + {str(mul) + ' · ' if mul > 1 else ''}(n mod {b}) при n &gt; 0,<br>"
                   f"где div — целочисленное деление, mod — остаток от деления.")
            ask = f"Сколько существует натуральных значений n, не превышающих {lim}, для которых F(n) = {tgt}?"
            sol = (f"def F(n):\n    return 0 if n == 0 else F(n // {b}) + {mul} * (n % {b})\n\n"
                   f"print(sum(1 for n in range(1, {lim + 1}) if F(n) == {tgt}))")
            lv = 2
        break
    body = (f"<p>Алгоритм вычисления значения функции F(n), где n — {'целое неотрицательное' if kind == 2 else 'натуральное'} "
            f"число, задан следующими соотношениями:</p><p>{tex}</p><p>{ask}</p>")
    add(16, k, body, ans, "Рекурсия", code(sol), lv=lv)


# ============================================================ №17 — одиночные числа, средние, четвёрки, суммы цифр
def gen17(R, k):
    kind = k % 4
    while True:
        neg = kind in (2,) and R.random() < 0.6
        N = R.randint(5000, 10000)
        lo, hi = (-10000, 10000) if neg else (1, 100000)
        seq = [R.choice([R.randint(lo, hi), R.randint(10, 999) * (R.choice([-1, 1]) if neg else 1)]) for _ in range(N)]
        if kind == 0:                 # отдельные числа
            m = R.choice([3, 7, 9, 11, 13])
            b, d = R.choice([(8, 3), (8, 5), (6, 1), (5, 4), (16, 10), (7, 2)])
            good = [x for x in seq if x % m == 0 and x % b == d]
            if not good:
                continue
            ans = f"{len(good)} {max(good)}"
            dd = "A" if d == 10 else str(d)
            q = (f"Определите количество чисел последовательности, которые делятся на {m} и запись которых в системе счисления "
                 f"с основанием {b} оканчивается цифрой {dd}. В ответе запишите количество таких чисел, затем максимальное из них.")
            sol = (f"a = [int(s) for s in open('17.txt')]\ngood = [x for x in a if x % {m} == 0 and x % {b} == {d}]\nprint(len(good), max(good))")
            lv = 1
        elif kind == 1:               # пары: среднее пары больше среднего всей последовательности
            e = R.choice(["7", "3", "13", "21"])
            avg = sum(seq) / N
            good = [x + y for x, y in zip(seq, seq[1:]) if (x + y) / 2 > avg and (str(x).endswith(e) or str(y).endswith(e))]
            if not good:
                continue
            mn = R.random() < 0.5
            ans = f"{len(good)} {min(good) if mn else max(good)}"
            q = (f"Определите количество пар последовательности, в которых среднее арифметическое двух элементов больше среднего "
                 f"арифметического всех чисел последовательности, а хотя бы один элемент пары оканчивается на {e}. В ответе "
                 f"запишите количество найденных пар, затем {'минимальную' if mn else 'максимальную'} из сумм элементов таких пар. "
                 "Под парой подразумеваются два идущих подряд элемента последовательности.")
            sol = (f"a = [int(s) for s in open('17.txt')]\navg = sum(a) / len(a)\n"
                   f"good = [x + y for x, y in zip(a, a[1:]) if (x + y) / 2 > avg and (str(x).endswith('{e}') or str(y).endswith('{e}'))]\n"
                   f"print(len(good), {'min' if mn else 'max'}(good))")
            lv = 2
        elif kind == 2:               # четвёрки
            m = R.choice([3, 5, 7])
            if neg:
                cond = lambda g: sum(x > 0 for x in g) == 3 and sum(g) % m == 0
                txt = f"ровно три элемента положительны, а сумма всех четырёх элементов кратна {m}"
                pc = f"sum(x > 0 for x in g) == 3 and sum(g) % {m} == 0"
            else:
                cond = lambda g: sum(100 <= x <= 999 for x in g) == 2 and sum(g) % m == 0
                txt = f"ровно два элемента — трёхзначные числа, а сумма всех четырёх элементов кратна {m}"
                pc = f"sum(100 <= x <= 999 for x in g) == 2 and sum(g) % {m} == 0"
            good = [sum(seq[i:i + 4]) for i in range(N - 3) if cond(seq[i:i + 4])]
            if not good:
                continue
            ans = f"{len(good)} {max(good)}"
            q = (f"Определите количество четвёрок последовательности, в которых {txt}. В ответе запишите количество найденных "
                 "четвёрок, затем максимальную из сумм элементов таких четвёрок. Под четвёркой подразумеваются четыре идущих "
                 "подряд элемента последовательности.")
            sol = (f"a = [int(s) for s in open('17.txt')]\ngood = []\nfor i in range(len(a) - 3):\n    g = a[i:i + 4]\n"
                   f"    if {pc}:\n        good.append(sum(g))\nprint(len(good), max(good))")
            lv = 3
        else:                         # пары с равной суммой цифр
            ds = lambda x: sum(map(int, str(abs(x))))
            good = [x + y for x, y in zip(seq, seq[1:]) if ds(x) == ds(y)]
            if not good:
                continue
            ans = f"{len(good)} {max(good)}"
            q = ("Определите количество пар последовательности, у элементов которых одинаковая сумма цифр. В ответе запишите "
                 "количество найденных пар, затем максимальную из сумм элементов таких пар. Под парой подразумеваются два идущих "
                 "подряд элемента последовательности.")
            sol = ("a = [int(s) for s in open('17.txt')]\nds = lambda x: sum(map(int, str(abs(x))))\n"
                   "good = [x + y for x, y in zip(a, a[1:]) if ds(x) == ds(y)]\nprint(len(good), max(good))")
            lv = 2
        break
    (M.media(17) / f"e17-{k:02d}.txt").write_text("\n".join(map(str, seq)) + "\n", encoding="utf-8")
    rng = f"от {lo} до {hi}".replace("-", "−")
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            f"<p>В файле содержится последовательность целых чисел. Её элементы могут принимать целые значения {rng} "
            f"включительно. {q}</p>")
    add(17, k, body, ans, "Обработка числовой последовательности в файле", code(sol),
        att=[{"name": "17.txt", "href": f"media/egeshka_bank/17/e17-{k:02d}.txt"}], lv=lv)


# ============================================================ №18 — число маршрутов, диагональный ход, старт с любой клетки
def gen18(R, k):
    kind = k % 3
    while True:
        n = R.randint(8, 12) if kind == 0 else R.randint(10, 18)
        grid = [[R.randint(1, 100) for _ in range(n)] for _ in range(n)]
        walls_r, walls_b = {}, {}
        if kind != 2:
            for _ in range(R.randint(2, 4)):
                if R.random() < 0.5:
                    c, r0 = R.randrange(n - 1), R.randrange(n)
                    for r in range(r0, min(n, r0 + R.randint(2, n // 2))):
                        walls_r[(r, c)] = True
                else:
                    r, c0 = R.randrange(n - 1), R.randrange(n)
                    for c in range(c0, min(n, c0 + R.randint(2, n // 2))):
                        walls_b[(r, c)] = True
        INF = None
        if kind == 0:                 # сколько маршрутов из левой верхней в правую нижнюю
            ways = [[0] * n for _ in range(n)]
            for r in range(n):
                for c in range(n):
                    if r == c == 0:
                        ways[r][c] = 1
                        continue
                    ways[r][c] = (ways[r][c - 1] if c and not walls_r.get((r, c - 1)) else 0) + \
                                 (ways[r - 1][c] if r and not walls_b.get((r - 1, c)) else 0)
            ans = ways[n - 1][n - 1]
            if ans < 10:
                continue
            q = ("Определите количество различных маршрутов, по которым Робот может пройти из левой верхней клетки в правую "
                 "нижнюю. Числа в клетках в этом задании не нужны.")
            dp = ("ways = [[0] * n for _ in range(n)]\nfor r in range(n):\n    for c in range(n):\n        if r == c == 0:\n"
                  "            ways[r][c] = 1\n            continue\n"
                  "        ways[r][c] = (ways[r][c - 1] if c and not wall_right(r, c - 1) else 0) + \\\n"
                  "                     (ways[r - 1][c] if r and not wall_below(r - 1, c) else 0)\nprint(ways[n - 1][n - 1])")
            moves = "вправо или вниз"
        elif kind == 1:               # можно ходить и по диагонали вправо-вниз
            best = {}
            for r in range(n):
                for c in range(n):
                    if r == c == 0:
                        best[(0, 0)] = (grid[0][0], grid[0][0])
                        continue
                    opts = []
                    if c and not walls_r.get((r, c - 1)) and (r, c - 1) in best:
                        opts.append(best[(r, c - 1)])
                    if r and not walls_b.get((r - 1, c)) and (r - 1, c) in best:
                        opts.append(best[(r - 1, c)])
                    # по диагонали — если не мешают стены вокруг угла
                    if r and c and (r - 1, c - 1) in best and not walls_r.get((r - 1, c - 1)) and not walls_b.get((r - 1, c - 1)) \
                            and not walls_r.get((r, c - 1)) and not walls_b.get((r - 1, c)):
                        opts.append(best[(r - 1, c - 1)])
                    if opts:
                        best[(r, c)] = (max(o[0] for o in opts) + grid[r][c], min(o[1] for o in opts) + grid[r][c])
            if (n - 1, n - 1) not in best:
                continue
            mx, mn = best[(n - 1, n - 1)]
            ans = f"{mx} {mn}"
            q = ("Определите максимальную и минимальную денежные суммы, которые может собрать Робот, пройдя из левой верхней "
                 "клетки в правую нижнюю. В ответе укажите два числа — сначала максимальную сумму, затем минимальную.")
            dp = ("best = {}\nfor r in range(n):\n    for c in range(n):\n        if r == c == 0:\n            best[0, 0] = (v[0][0], v[0][0])\n"
                  "            continue\n        prev = []\n        if c and not wall_right(r, c - 1) and (r, c - 1) in best:\n"
                  "            prev.append(best[r, c - 1])\n        if r and not wall_below(r - 1, c) and (r - 1, c) in best:\n"
                  "            prev.append(best[r - 1, c])\n        if r and c and (r - 1, c - 1) in best and not wall_right(r - 1, c - 1) \\\n"
                  "                and not wall_below(r - 1, c - 1) and not wall_right(r, c - 1) and not wall_below(r - 1, c):\n"
                  "            prev.append(best[r - 1, c - 1])\n        if prev:\n"
                  "            best[r, c] = (max(p[0] for p in prev) + v[r][c], min(p[1] for p in prev) + v[r][c])\n"
                  "print(*best[n - 1, n - 1])")
            moves = "вправо, вниз или по диагонали вправо-вниз"
        else:                         # старт с любой клетки верхней строки, ходы вниз / вниз-влево / вниз-вправо
            mx = [row[:] for row in grid]
            mn = [row[:] for row in grid]
            for r in range(1, n):
                for c in range(n):
                    up = [mx[r - 1][cc] for cc in (c - 1, c, c + 1) if 0 <= cc < n]
                    dn = [mn[r - 1][cc] for cc in (c - 1, c, c + 1) if 0 <= cc < n]
                    mx[r][c] = max(up) + grid[r][c]
                    mn[r][c] = min(dn) + grid[r][c]
            ans = f"{max(mx[-1])} {min(mn[-1])}"
            q = ("Робот начинает движение в любой клетке верхней строки и заканчивает в любой клетке нижней строки. Определите "
                 "максимальную и минимальную денежные суммы, которые он может собрать. В ответе укажите два числа — сначала "
                 "максимальную сумму, затем минимальную.")
            dp = ("mx = [row[:] for row in v]\nmn = [row[:] for row in v]\nfor r in range(1, n):\n    for c in range(n):\n"
                  "        near = [cc for cc in (c - 1, c, c + 1) if 0 <= cc < n]\n"
                  "        mx[r][c] = max(mx[r - 1][cc] for cc in near) + v[r][c]\n"
                  "        mn[r][c] = min(mn[r - 1][cc] for cc in near) + v[r][c]\nprint(max(mx[-1]), min(mn[-1]))")
            moves = "вниз, вниз-влево или вниз-вправо (по диагонали)"
        break
    M.write_xlsx_grid(M.media(18) / f"e18-{k:02d}.xlsx", grid, walls_r, walls_b)
    walls_txt = (" Между соседними клетками могут быть стены (в таблице — толстые границы ячеек); сквозь стену Робот пройти не "
                 "может, а при ходе по диагонали он не может задеть стену в углу клетки." if kind == 1 else
                 " Между соседними клетками могут быть стены (в таблице — толстые границы ячеек); сквозь стену Робот пройти не "
                 "может." if kind == 0 else "")
    body = ("<p>Задание выполняется с использованием прилагаемых файлов.</p>"
            f"<p>Квадрат разлинован на N × N клеток (1 &lt; N &lt; 30). Исполнитель Робот за один ход перемещается в соседнюю "
            f"клетку: {moves}. Выход за границу квадрата запрещён.{walls_txt}</p>"
            "<p>В каждой клетке лежит монета достоинством от 1 до 100. Посетив клетку, Робот забирает монету; это относится и к "
            f"начальной, и к конечной клетке маршрута.</p><p>{q}</p><p>Исходные данные — электронная таблица размером N × N, "
            "каждая ячейка которой соответствует клетке квадрата.</p>")
    sol = ("import openpyxl\nws = openpyxl.load_workbook('18.xlsx').active\nn = ws.max_row\n"
           "v = [[ws.cell(r + 1, c + 1).value for c in range(n)] for r in range(n)]\n"
           "thick = lambda s: s in ('thick', 'medium')\n"
           "def wall_right(r, c):\n    return thick(ws.cell(r + 1, c + 1).border.right.style) or thick(ws.cell(r + 1, c + 2).border.left.style)\n"
           "def wall_below(r, c):\n    return thick(ws.cell(r + 1, c + 1).border.bottom.style) or thick(ws.cell(r + 2, c + 1).border.top.style)\n"
           + dp)
    add(18, k, body, ans, "Робот в электронных таблицах", code(sol),
        att=[{"name": "18.xlsx", "href": f"media/egeshka_bank/18/e18-{k:02d}.xlsx"}], lv=3 if kind else 2)


# ============================================================ №19–21 — убывающая куча; вопросы «максимальное S», «сколько значений»
def solver(moves, end):
    from functools import lru_cache

    @lru_cache(None)
    def f(pos, m, strat):
        if end(pos):
            return m % 2 == 0
        if m == 0:
            return False
        h = [f(p, m - 1, strat) for p in moves(pos)]
        return any(h) if (m % 2 == 1 or not strat) else all(h)
    return f


def gen19(R, k):
    kind = k % 3
    P, V = R.choice([("Петя", "Ваня"), ("Аня", "Боря"), ("Маша", "Саша"), ("Алиса", "Боб"), ("Лиза", "Гоша")])
    gen_ = lambda w: (w[:-1] + ("и" if w[-1] == "я" or w[-2] in "шжчщкгх" else "ы")) if w[-1] in "ая" else w + "а"
    Pf, Vf = gen_(P), gen_(V)
    while True:
        if kind == 0:                 # убывающая куча: забрать камни или уменьшить вдвое
            a, b = sorted(R.sample([1, 2, 3, 4, 5], 2))
            W = R.randint(10, 40)
            top = W + R.randint(60, 140)
            half = R.random() < 0.6
            mv = lambda s: tuple(x for x in ((s[0] - a,), (s[0] - b,)) + (((s[0] // 2,),) if half else ()) if x[0] >= 0)
            end = lambda s: s[0] <= W
            rng = range(W + 1, top + 1)
            start = lambda s: (s,)
            rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежит куча камней. Игроки ходят по "
                     f"очереди, первый ход делает {P}. За один ход игрок может убрать из кучи {a} или {b} "
                     f"{pl(b, 'камень', 'камня', 'камней')}" + (" либо уменьшить количество камней в куче в два раза (если "
                     "количество нечётно, остаётся на один камень меньше половины)" if half else "") + ". Например, из кучи в 15 "
                     f"камней за один ход можно получить кучу из {15 - a}, {15 - b}" + (" или 7" if half else "") + " камней.</p>"
                     f"<p>Игра завершается в тот момент, когда количество камней в куче становится не более {W}. Победителем "
                     f"считается игрок, сделавший последний ход, то есть первым получивший кучу из {W} или менее камней. В "
                     f"начальный момент в куче было S камней, {W + 1} ≤ S ≤ {top}.</p>")
            mv_py = (f"def moves(s):\n    return [x for x in (s - {a}, s - {b}" + (", s // 2" if half else "") + ") if x >= 0]\n")
            end_py = f"s <= {W}"
            topic = "Одна куча камней"
        elif kind == 1:               # растущая куча, вопросы «максимальное» и «сколько»
            adds = sorted(R.sample([1, 2, 3, 4], R.choice([1, 2])))
            mul = R.choice([2, 3])
            W = R.randint(30, 150)
            mv = lambda s: tuple((s[0] + x,) for x in adds) + ((s[0] * mul,),)
            end = lambda s: s[0] >= W
            rng = range(1, W)
            start = lambda s: (s,)
            word = {1: "один камень", 2: "два камня", 3: "три камня", 4: "четыре камня"}
            rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежит куча камней. Игроки ходят по "
                     f"очереди, первый ход делает {P}. За один ход игрок может "
                     + ", ".join(f"добавить в кучу {word[x]}" for x in adds) + f" или увеличить количество камней в куче в "
                     f"{mul} раза.</p><p>Игра завершается в тот момент, когда количество камней в куче становится не менее {W}. "
                     f"Победителем считается игрок, сделавший последний ход. В начальный момент в куче было S камней, "
                     f"1 ≤ S ≤ {W - 1}.</p>")
            mv_py = "def moves(s):\n    return [" + ", ".join(f"s + {x}" for x in adds) + f", s * {mul}]\n"
            end_py = f"s >= {W}"
            topic = "Одна куча камней"
        else:                         # две кучи: добавить камень, удвоить или перенести? — три хода
            K = R.randint(2, 10)
            W = R.randint(35, 110)
            plus = R.choice([1, 2])
            mv = lambda s: ((s[0] + plus, s[1]), (s[0], s[1] + plus), (s[0] * 2, s[1]), (s[0], s[1] * 2))
            end = lambda s: s[0] + s[1] >= W or max(s) >= W // 2 + 5
            lim1 = W // 2 + 5
            rng = range(1, min(W - K, lim1))
            start = lambda s: (K, s)
            rules = (f"<p>Два игрока, {P} и {V}, играют в следующую игру. Перед игроками лежат две кучи камней. Игроки ходят по "
                     f"очереди, первый ход делает {P}. За один ход игрок может в одну из куч (по своему выбору) добавить "
                     f"{'один камень' if plus == 1 else 'два камня'} или увеличить количество камней в ней в два раза.</p>"
                     f"<p>Игра завершается в тот момент, когда суммарное количество камней в кучах становится не менее {W} "
                     f"<b>или</b> в одной из куч оказывается не менее {lim1} камней. Победителем считается игрок, сделавший "
                     f"последний ход. В начальный момент в первой куче было {K} {pl(K, 'камень', 'камня', 'камней')}, во второй — "
                     f"S камней; 1 ≤ S ≤ {rng.stop - 1}.</p>")
            mv_py = (f"def moves(s):\n    a, b = s\n    return [(a + {plus}, b), (a, b + {plus}), (a * 2, b), (a, b * 2)]\n")
            end_py = f"s[0] + s[1] >= {W} or max(s) >= {lim1}"
            topic = "Две кучи камней"
        f = solver(mv, end)
        st = [s for s in rng if not end(start(s))]
        q19 = [s for s in st if f(start(s), 2, True)]                              # Ваня выигрывает первым ходом при любой игре
        q20 = [s for s in st if f(start(s), 3, True) and not f(start(s), 1, True)]
        q21 = [s for s in st if f(start(s), 4, True) and not f(start(s), 2, True)]
        if not q19 or not q20 or not q21:
            continue
        variant = R.randint(0, 1)
        if kind == 0:                 # у убывающей кучи «интересные» S — большие
            a19, a20, a21 = max(q19), (" ".join(map(str, q20[-2:])) if len(q20) >= 2 else str(q20[0])), len(q21)
            t19 = f"Укажите максимальное значение S, при котором {V} может выиграть своим первым ходом при любой игре {Pf}."
            t20 = (f"Найдите два наибольших значения S, при которых" if len(q20) >= 2 else "Найдите значение S, при котором")
            t20 += (f" у {Pf} есть выигрышная стратегия, причём {P} не может выиграть за один ход, но может выиграть своим "
                    f"вторым ходом независимо от того, как будет ходить {V}." + (" Найденные значения запишите в порядке "
                                                                                    "возрастания." if len(q20) >= 2 else ""))
            t21 = (f"Найдите количество значений S, при которых у {Vf} есть выигрышная стратегия, позволяющая ему выиграть "
                   f"первым или вторым ходом при любой игре {Pf}, но у {Vf} нет стратегии, которая позволит ему гарантированно "
                   "выиграть первым ходом.")
            out = (f"print(max(q19))\nprint(*q20[-2:])\nprint(len(q21))" if len(q20) >= 2 else "print(max(q19))\nprint(q20[0])\nprint(len(q21))")
        else:
            a19 = len(q19) if variant else min(q19)
            a20 = max(q20)
            a21 = max(q21) if variant else len(q21)
            t19 = ((f"Найдите количество значений S, при которых {V} может выиграть своим первым ходом при любой игре {Pf}."
                    if variant else f"Укажите минимальное значение S, при котором {V} может выиграть своим первым ходом при "
                    f"любой игре {Pf}."))
            t20 = (f"Найдите максимальное значение S, при котором у {Pf} есть выигрышная стратегия, причём {P} не может выиграть "
                   f"за один ход, но может выиграть своим вторым ходом независимо от того, как будет ходить {V}.")
            t21 = ((f"Найдите максимальное значение S" if variant else "Найдите количество значений S") +
                   f", при которых у {Vf} есть выигрышная стратегия, позволяющая ему выиграть первым или вторым ходом при любой "
                   f"игре {Pf}, но у {Vf} нет стратегии, которая позволит ему гарантированно выиграть первым ходом.")
            t21 = t21.replace("значение S, при которых", "значение S, при котором")
            out = (("print(len(q19))" if variant else "print(min(q19))") + "\nprint(max(q20))\n"
                   + ("print(max(q21))" if variant else "print(len(q21))"))
        break
    rules += ("<p>Будем говорить, что игрок имеет выигрышную стратегию, если он может выиграть при любых ходах противника.</p>")
    body = (rules + '<h3 class="gq-title">Задание 19</h3>' + f"<p>{t19}</p>" + '<h3 class="gq-title">Задание 20</h3>'
            + f"<p>{t20}</p>" + '<h3 class="gq-title">Задание 21</h3>' + f"<p>{t21}</p>")
    sv = "(K, s)".replace("K", str(K)) if kind == 2 else "s"
    sol = ("from functools import lru_cache\n\n" + mv_py.replace("def moves(s):", "def moves(s):") +
           f"\n@lru_cache(None)\ndef f(s, m, strat):\n    if {end_py}:\n        return m % 2 == 0\n    if m == 0:\n        return False\n"
           "    h = [f(x, m - 1, strat) for x in moves(s)]\n    return any(h) if m % 2 == 1 or not strat else all(h)\n\n"
           + (f"st = [s for s in range({rng.start}, {rng.stop})]\n" if kind != 2 else
              f"st = [s for s in range({rng.start}, {rng.stop}) if not ({end_py.replace('s[0]', str(K)).replace('max(s)', f'max({K}, s)').replace('s[1]', 's')})]\n")
           + f"q19 = [s for s in st if f({sv}, 2, True)]\nq20 = [s for s in st if f({sv}, 3, True) and not f({sv}, 1, True)]\n"
           f"q21 = [s for s in st if f({sv}, 4, True) and not f({sv}, 2, True)]\n" + out)
    if kind == 2:
        sol = sol.replace("def moves(s):\n    a, b = s", "def moves(s):\n    a, b = s")
    tid = f"egeshka_bank:e19-{k:02d}"
    G().TASKS.append({"id": tid, "n": 19, "bank": "egeshka_bank", "html": body, "src": G().SRC, "y": 2026, "dt": "2026-11-05",
                      "topic": topic, "lv": M.LV[3 if kind == 2 else 2], "sol": code(sol),
                      "parts": [{"id": f"{tid}-19", "n": 19, "ans": str(a19)}, {"id": f"{tid}-20", "n": 20, "ans": str(a20)},
                                {"id": f"{tid}-21", "n": 21, "ans": str(a21)}]})


# ============================================================ №22 — длительность максимальной параллельности, задержка процесса
def gen22(R, k):
    kind = k % 4
    while True:
        n = R.randint(12, 40)
        tm = [R.randint(1, 25) for _ in range(n)]
        deps = [[] if i == 0 or R.random() < 0.25 else sorted(R.sample(range(i), min(i, R.choice([1, 1, 2, 3])))) for i in range(n)]

        def ends(tm_, delay=None):
            e = [0] * n
            for i in range(n):
                st_ = max((e[d] for d in deps[i]), default=0) + (delay[1] if delay and delay[0] == i else 0)
                e[i] = st_ + tm_[i]
            return e
        end = ends(tm)
        start = [end[i] - tm[i] for i in range(n)]
        T = max(end)
        if kind == 0:                 # сколько мс шло максимальное число процессов
            cnt = [sum(1 for i in range(n) if start[i] <= t < end[i]) for t in range(T)]
            mx = max(cnt)
            ans = cnt.count(mx)
            q = ("Определите, сколько миллисекунд в общей сложности одновременно выполнялось максимальное количество процессов, "
                 "при условии, что все независимые друг от друга процессы стартовали одновременно, а каждый зависимый процесс "
                 "стартовал сразу после завершения всех процессов, от которых он зависит.")
            tail = ("T = max(end.values())\ncnt = [sum(1 for p in end if end[p] - t_[p] <= t < end[p]) for t in range(T)]\n"
                    "print(cnt.count(max(cnt)))")
        elif kind == 1:               # когда завершится процесс X
            x = R.randrange(n // 2, n)
            ans = end[x]
            q = (f"Через сколько миллисекунд после старта всей совокупности процессов завершится процесс с ID {x + 1}, если все "
                 "независимые друг от друга процессы стартовали одновременно, а зависимые — сразу после завершения нужных им?")
            tail = f"print(end[{x + 1}])"
        elif kind == 2:               # сколько процессов выполняется в момент t
            t0 = R.randint(T // 5, T * 4 // 5)
            ans = sum(1 for i in range(n) if start[i] <= t0 < end[i])
            if ans == 0:
                continue
            q = (f"Определите, сколько процессов выполнялось в момент времени {t0} мс после общего старта (процесс, стартовавший "
                 f"ровно в {t0} мс, учитывается, а завершившийся ровно в {t0} мс — нет), при условии, что независимые процессы "
                 "стартовали одновременно, а зависимые — сразу после завершения всех процессов, от которых они зависят.")
            tail = f"print(sum(1 for p in end if end[p] - t_[p] <= {t0} < end[p]))"
        else:                         # насколько можно задержать процесс, не увеличив общее время
            x = R.randrange(n)
            d = 0
            while max(ends(tm, (x, d + 1))) == T:
                d += 1
            if d == 0 or d > 500:
                continue
            ans = d
            q = (f"Процесс с ID {x + 1} решили запускать не сразу, когда он может стартовать, а с задержкой на t мс. Определите "
                 "максимально возможное целое t, при котором время завершения всей совокупности процессов не увеличится. Все "
                 "независимые друг от друга процессы могут выполняться параллельно.")
            tail = (f"def total(delay):\n    e = {{}}\n    def fin(p):\n        if p not in e:\n"
                    f"            e[p] = max((fin(d) for d in dep[p]), default=0) + (delay if p == {x + 1} else 0) + t_[p]\n"
                    "        return e[p]\n    return max(fin(p) for p in t_)\n\nT = total(0)\nd = 0\nwhile total(d + 1) == T:\n"
                    "    d += 1\nprint(d)")
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
        att=[{"name": "22.xlsx", "href": f"media/egeshka_bank/22/e22-{k:02d}.xlsx"}], lv=3 if kind in (0, 3) else 2)


# ============================================================ №23 — рёбра кратчайшего пути, лёгкое ребро, пути через вершину
def gen23(R, k):
    kind = k % 4
    while True:
        nv = R.randint(50, 90)
        order = R.sample(range(1, 1000), nv)
        edges = {}
        for i in range(nv - 1):
            for _ in range(R.choice([1, 2, 2, 3])):
                j = R.randint(i + 1, min(nv - 1, i + 10))
                edges[(order[i], order[j])] = R.randint(10, 20000)          # вес в десятых
            if len(edges) >= 190:
                break
        adj = {}
        for (a, b), w in edges.items():
            adj.setdefault(a, []).append((b, w))
        pos = {v: i for i, v in enumerate(order)}
        a = order[R.randint(0, nv // 6)]
        b = order[R.randint(nv * 3 // 5, nv - 1)]

        def best(src, dst, agg):
            """(длина, рёбер, самое лёгкое ребро) лучшего пути; None — пути нет."""
            memo = {}

            def go(v):
                if v == dst:
                    return (0, 0, None)
                if v in memo:
                    return memo[v]
                res = None
                for u, w in adj.get(v, []):
                    if pos[u] > pos[dst]:
                        continue
                    r = go(u)
                    if r is None:
                        continue
                    cand = (r[0] + w, r[1] + 1, w if r[2] is None else min(w, r[2]))
                    if res is None or agg(cand[0], res[0]) != res[0]:
                        res = cand
                memo[v] = res
                return res
            return go(src)

        def opt_ways(src, dst, agg):
            """Сколько путей дают лучшую длину — для «путь единственный»."""
            memo = {}

            def go(v):
                if v == dst:
                    return (0, 1)
                if v in memo:
                    return memo[v]
                res = None
                for u, w in adj.get(v, []):
                    if pos[u] > pos[dst]:
                        continue
                    r = go(u)
                    if r is None:
                        continue
                    val = r[0] + w
                    if res is None or agg(val, res[0]) != res[0]:
                        res = (val, r[1])
                    elif val == res[0]:
                        res = (val, res[1] + r[1])
                memo[v] = res
                return res
            r = go(src)
            return r[1] if r else 0

        def count(src, dst, via=None):
            memo = {}

            def go(v, t):
                if v == t:
                    return 1
                if (v, t) not in memo:
                    memo[(v, t)] = sum(go(u, t) for u, _ in adj.get(v, []) if pos[u] <= pos[t])
                return memo[(v, t)]
            return go(src, via) * go(via, dst) if via else go(src, dst)
        if kind == 0:                 # сколько рёбер в кратчайшем пути
            r = best(a, b, min)
            if r is None or r[1] < 2 or opt_ways(a, b, min) != 1:
                continue
            ans = r[1]
            q = (f"Укажите в ответе количество рёбер, составляющих кратчайший (по сумме весов) путь из вершины с номером {a} в "
                 f"вершину с номером {b}. Кратчайший путь единственный.")
            tail = f"print(short({a}, {b})[1])"
        elif kind == 1:               # самое лёгкое ребро самого длинного пути
            r = best(a, b, max)
            if r is None or r[1] < 2 or opt_ways(a, b, max) != 1:
                continue
            ans = f"{r[2] // 10}.{r[2] % 10}"
            q = (f"Найдите самый длинный (по сумме весов) путь из вершины с номером {a} в вершину с номером {b} и запишите в "
                 "ответе вес самого лёгкого ребра на этом пути — так, как он записан в файле. Самый длинный путь единственный.")
            tail = f"print(long_({a}, {b})[2])"
        elif kind == 2:               # пути через вершину
            mids = [v for v in order if pos[a] < pos[v] < pos[b]]
            c = R.choice(mids)
            cnt = count(a, b, c)
            if not 3 <= cnt <= 10 ** 12:
                continue
            ans = cnt
            q = f"Найдите количество различных путей из вершины с номером {a} в вершину с номером {b}, проходящих через вершину с номером {c}."
            tail = f"print(cnt({a}, {c}) * cnt({c}, {b}))"
        else:                         # путь с наибольшим числом рёбер
            memo = {}

            def most(v):
                if v == b:
                    return 0
                if v not in memo:
                    vals = [most(u) for u, _ in adj.get(v, []) if pos[u] <= pos[b]]
                    vals = [x for x in vals if x is not None]
                    memo[v] = max(vals) + 1 if vals else None
                return memo[v]
            r = most(a)
            if r is None or r < 3:
                continue
            ans = r
            q = f"Найдите наибольшее количество рёбер в пути из вершины с номером {a} в вершину с номером {b}."
            tail = f"print(most({a}, {b}))"
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
            f"Две вершины графа не могут быть соединены более чем одним ребром.</p><p>{q} Существование хотя бы одного такого "
            "пути гарантируется.</p><p>Для выполнения этого задания следует написать программу. Вершины графа могут быть "
            "пронумерованы не подряд. L ≤ 1000, M ≤ 1000; W ≤ 10 000. Количество строк в файле не превосходит 200. Числа в "
            "строках разделены произвольным ненулевым количеством пробелов и/или табуляций.</p>")
    sol = ("from functools import lru_cache\nw, nxt, txt = {}, {}, {}\nfor s in open('23.txt'):\n    if s.split():\n"
           "        a, b, c = s.split()\n        w[int(a), int(b)] = float(c)\n        txt[int(a), int(b)] = c\n"
           "        nxt.setdefault(int(a), []).append(int(b))\n\n"
           "def short(a, b):          # (длина, число рёбер) кратчайшего пути\n    @lru_cache(None)\n    def go(v):\n"
           "        if v == b:\n            return (0, 0)\n        best = None\n        for u in nxt.get(v, []):\n"
           "            r = go(u)\n            if r and (best is None or w[v, u] + r[0] < best[0]):\n"
           "                best = (w[v, u] + r[0], r[1] + 1)\n        return best\n    return go(a)\n\n"
           "def long_(a, b):          # (длина, рёбер, вес самого лёгкого ребра как в файле) самого длинного пути\n"
           "    @lru_cache(None)\n    def go(v):\n        if v == b:\n            return (0, 0, None)\n        best = None\n"
           "        for u in nxt.get(v, []):\n            r = go(u)\n            if r and (best is None or w[v, u] + r[0] > best[0]):\n"
           "                lite = txt[v, u] if r[2] is None or w[v, u] < float(r[2]) else r[2]\n"
           "                best = (w[v, u] + r[0], r[1] + 1, lite)\n        return best\n    return go(a)\n\n"
           "def cnt(a, b):\n    @lru_cache(None)\n    def go(v):\n        return 1 if v == b else sum(go(u) for u in nxt.get(v, []))\n"
           "    return go(a)\n\n"
           "def most(a, b):\n    @lru_cache(None)\n    def go(v):\n        if v == b:\n            return 0\n"
           "        vals = [go(u) for u in nxt.get(v, [])]\n        vals = [x for x in vals if x is not None]\n"
           "        return max(vals) + 1 if vals else None\n    return go(a)\n\n" + tail)
    add(23, k, body, ans, "Графы", code(sol), att=[{"name": "23.txt", "href": f"media/egeshka_bank/23/e23-{k:02d}.txt"}],
        lv=3 if kind in (1, 3) else 2)
