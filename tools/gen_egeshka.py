#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Генератор банка «Egeshka» — авторские задания ЕГЭ по информатике (Egeshka Malevin D.), формат экзамена 2026 г.

Каждое задание решается здесь же перебором: ответ не придумывается, а вычисляется, и задание
попадает в банк, только если ответ единственный (например, в №1 — одинаковый при любом
соответствии номеров таблицы буквам схемы, в №2 — подходит ровно один порядок переменных).

    python tools/gen_egeshka.py            # data/egeshka_bank.json + media/egeshka_bank/…

Сервер подмешивает data/egeshka_bank.json к основному банку сам, пересобирать bank.js не нужно.
Сид фиксированный: повторный запуск даёт те же задания.
"""
import datetime as dt
import html
import itertools
import json
import random
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "data" / "egeshka_bank.json"
MEDIA = ROOT / "media" / "egeshka_bank"
SRC = "Egeshka Malevin D."
TODAY = "2026-10-08"
PER_NUM = 10

R = random.Random(20261008)
TASKS = []


def add(n, k, html_text, ans, topic, sol=None, att=None):
    t = {"id": f"egeshka_bank:e{n}-{k:02d}", "n": n, "bank": "egeshka_bank", "html": html_text,
         "ans": str(ans), "src": SRC, "y": 2026, "dt": TODAY, "topic": topic}
    if sol:
        t["sol"] = sol
    if att:
        t["att"] = att
    TASKS.append(t)


def code_block(src):
    return f'<pre class="py-sol"><code>{html.escape(src.strip())}</code></pre>'


def table_html(rows, head=True):
    out = ['<table border="1" style="border-collapse:collapse">']
    for i, r in enumerate(rows):
        tag = "th" if head and i == 0 else "td"
        out.append("<tr>" + "".join(f'<{tag} style="padding:2px 8px;text-align:center">{c}</{tag}>' for c in r) + "</tr>")
    out.append("</table>")
    return "".join(out)


# ============================================================ №1 — граф и весовая таблица
LET = "АБВГДЕЖЗ"


def iso_maps(adj_letters, adj_nums, n):
    """Все взаимно однозначные соответствия «буква → номер», сохраняющие рёбра."""
    deg_l = [len(adj_letters[i]) for i in range(n)]
    deg_n = [len(adj_nums[i]) for i in range(n)]
    res = []

    def go(i, used, mp):
        if i == n:
            res.append(mp[:])
            return
        for j in range(n):
            if j in used or deg_n[j] != deg_l[i]:
                continue
            if all((j in adj_nums[mp[a]]) == (a in adj_letters[i]) for a in range(i)):
                mp.append(j); used.add(j)
                go(i + 1, used, mp)
                mp.pop(); used.discard(j)
    go(0, set(), [])
    return res


def graph_svg(n, edges, pos, w=340, h=280):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">',
             f'<rect width="{w}" height="{h}" rx="10" fill="#ffffff"/>']
    for a, b in edges:
        (x1, y1), (x2, y2) = pos[a], pos[b]
        parts.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#1f2937" stroke-width="2.2"/>')
    for i in range(n):
        x, y = pos[i]
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="#ffffff" stroke="#1f2937" stroke-width="2.2"/>')
        parts.append(f'<text x="{x:.1f}" y="{y + 6:.1f}" text-anchor="middle" font-family="Arial, sans-serif" '
                     f'font-size="17" font-weight="700" fill="#111827">{LET[i]}</text>')
    parts.append("</svg>")
    return "".join(parts)


def gen1(k):
    import math
    while True:
        n = R.choice([7, 7, 8])
        # вершины на эллипсе: отрезок между двумя точками эллипса не проходит через третью
        # равномерно по эллипсу с небольшим разбросом — вершины не слипаются
        base = R.uniform(0, 2 * math.pi)
        ang = [base + 2 * math.pi * i / n + R.uniform(-0.18, 0.18) for i in range(n)]
        pos = [(170 + 138 * math.cos(a), 140 + 112 * math.sin(a)) for a in ang]
        order = list(range(n)); R.shuffle(order)                 # буквы по кругу вразнобой
        pos = [pos[order[i]] for i in range(n)]
        m = R.randint(n + 1, n + 4)
        allp = [(a, b) for a in range(n) for b in range(a + 1, n)]
        edges = R.sample(allp, m)
        adj = [set() for _ in range(n)]
        for a, b in edges:
            adj[a].add(b); adj[b].add(a)
        # связность и разнообразие степеней
        seen, st = {0}, [0]
        while st:
            v = st.pop()
            for u in adj[v]:
                if u not in seen:
                    seen.add(u); st.append(u)
        if len(seen) < n or min(len(a) for a in adj) < 1:
            continue
        num_of = list(range(n)); R.shuffle(num_of)               # буква i → номер num_of[i] в таблице
        wts = {}
        for a, b in edges:
            wts[frozenset((num_of[a], num_of[b]))] = R.randint(3, 49)
        adj_n = [set() for _ in range(n)]
        for a, b in edges:
            adj_n[num_of[a]].add(num_of[b]); adj_n[num_of[b]].add(num_of[a])
        maps = iso_maps(adj, adj_n, n)
        kind = k % 4
        if kind == 0:     # длина одной дороги
            a, b = R.choice(edges)
            q = f"Определите длину дороги из пункта {LET[a]} в пункт {LET[b]}."
            f = lambda mp: wts[frozenset((mp[a], mp[b]))]
        elif kind == 1:   # сумма двух дорог
            (a, b), (c, d) = R.sample(edges, 2)
            q = (f"Определите, какова сумма протяжённостей дорог из пункта {LET[a]} в пункт {LET[b]} "
                 f"и из пункта {LET[c]} в пункт {LET[d]}.")
            f = lambda mp: wts[frozenset((mp[a], mp[b]))] + wts[frozenset((mp[c], mp[d]))]
        elif kind == 2:   # разность
            (a, b), (c, d) = R.sample(edges, 2)
            q = (f"На сколько дорога из пункта {LET[a]} в пункт {LET[b]} длиннее дороги из пункта {LET[c]} "
                 f"в пункт {LET[d]}? Если короче — запишите отрицательное число.")
            f = lambda mp: wts[frozenset((mp[a], mp[b]))] - wts[frozenset((mp[c], mp[d]))]
        else:             # кратчайший путь
            a, b = R.sample(range(n), 2)
            if b in adj[a]:
                continue
            q = (f"Определите длину кратчайшего пути по дорогам из пункта {LET[a]} в пункт {LET[b]}. "
                 f"Передвигаться можно только по дорогам, указанным на схеме.")

            def f(mp, a=a, b=b):
                inv = {mp[i]: i for i in range(n)}
                dist = {mp[a]: 0}
                todo = set(range(n))
                while todo:
                    v = min((x for x in todo if x in dist), key=dist.get, default=None)
                    if v is None:
                        break
                    todo.discard(v)
                    for u in adj_n[v]:
                        nd = dist[v] + wts[frozenset((v, u))]
                        if nd < dist.get(u, 10 ** 9):
                            dist[u] = nd
                return dist[mp[b]]
        answers = {f(mp) for mp in maps}
        if len(answers) != 1:
            continue
        ans = answers.pop()
        if kind == 2 and ans == 0:
            continue
        break
    rows = [[""] + [f"П{j + 1}" for j in range(n)]]
    for i in range(n):
        rows.append([f"<b>П{i + 1}</b>"] + [
            ("" if i == j else str(wts.get(frozenset((i, j)), ""))) for j in range(n)])
    name = f"1/e1-{k:02d}.svg"
    (MEDIA / "1").mkdir(parents=True, exist_ok=True)
    (MEDIA / name).write_text(graph_svg(n, edges, pos), encoding="utf-8")
    body = (
        "<p>На рисунке справа схема дорог Н-ского района изображена в виде графа, в таблице содержатся сведения "
        "о протяжённости каждой из этих дорог (в километрах).</p>"
        f'<div><div>{table_html(rows)}</div><div><img src="media/egeshka_bank/{name}" alt="Схема дорог" width="340"></div></div>'
        "<p>Так как таблицу и схему рисовали независимо друг от друга, нумерация населённых пунктов в таблице "
        "никак не связана с буквенными обозначениями на графе.</p>"
        f"<p>{q}</p><p>В ответе запишите целое число.</p>")
    deg = {LET[i]: len(adj[i]) for i in range(n)}
    sol = ("<p>Сопоставьте пункты по числу дорог (степеням вершин): на схеме "
           + ", ".join(f"{c} — {d}" for c, d in deg.items())
           + ". Пункты с уникальной степенью находятся сразу, остальные — по соседям. "
           + f"Ответ: {ans}.</p>")
    add(1, k, body, ans, "Графы и весовые таблицы", sol)


# ============================================================ №2 — таблица истинности
VARS = "wxyz"
OPS = [("∧", "\\land", lambda a, b: a and b), ("∨", "\\lor", lambda a, b: a or b),
       ("→", "\\to", lambda a, b: (not a) or b), ("≡", "\\equiv", lambda a, b: a == b)]


def rand_expr(depth):
    if depth == 0 or R.random() < 0.15:
        v = R.choice(VARS)
        if R.random() < 0.3:
            return (f"\\neg {v}", f"(not {v})")
        return (v, v)
    op = R.choice(OPS)
    a, b = rand_expr(depth - 1), rand_expr(depth - 1)
    tex = f"({a[0]} {op[1]} {b[0]})"
    py = {"\\land": f"({a[1]} and {b[1]})", "\\lor": f"({a[1]} or {b[1]})",
          "\\to": f"((not {a[1]}) or {b[1]})", "\\equiv": f"({a[1]} == {b[1]})"}[op[1]]
    if R.random() < 0.2:
        tex, py = f"\\neg {tex}", f"(not {py})"
    return tex, py


def gen2(k):
    while True:
        tex, py = rand_expr(R.choice([2, 2, 3]))
        if not all(v in py for v in VARS):
            continue
        F = eval(f"lambda w, x, y, z: bool({py})")
        rows_all = list(itertools.product([0, 1], repeat=4))
        val = R.choice([0, 1])
        good = [r for r in rows_all if F(*r) == val]
        if not 3 <= len(good) <= 9:
            continue
        perm = R.sample(VARS, 4)                       # perm[c] — переменная столбца c
        frag = R.sample(good, 3)
        # строки фрагмента: значения в порядке столбцов
        cols = [[dict(zip(VARS, r))[perm[c]] for c in range(4)] for r in frag]
        mask = [[R.random() < 0.45 for _ in range(4)] for _ in range(3)]
        blanks = sum(m for row in mask for m in row)
        if not 4 <= blanks <= 7:
            continue
        # перебор: какие перестановки совместимы с фрагментом
        ok = []
        for p in itertools.permutations(VARS):
            opts = []
            for ri in range(3):
                cand = []
                for fill in itertools.product([0, 1], repeat=4):
                    if any(not mask[ri][c] and fill[c] != cols[ri][c] for c in range(4)):
                        continue
                    asg = dict(zip(p, fill))
                    if F(asg["w"], asg["x"], asg["y"], asg["z"]) == val:
                        cand.append(fill)
                opts.append(cand)
            if any(len(set(c)) == 3 for c in itertools.product(*opts)):
                ok.append("".join(p))
        if len(ok) == 1:
            break
    ans = ok[0]
    vals = [[("" if mask[ri][c] else str(cols[ri][c])) for c in range(4)] + [str(val)] for ri in range(3)]
    rows = [["Перем. 1", "Перем. 2", "Перем. 3", "Перем. 4", "Функция"]] + vals
    body = (f"<p>Миша заполнял таблицу истинности логической функции \\( F = {tex[1:-1] if tex.startswith('(') else tex} \\), "
            "но успел заполнить лишь фрагмент из трёх различных её строк, даже не указав, какому столбцу таблицы "
            "соответствует каждая из переменных \\( w, x, y, z \\).</p>" + table_html(rows) +
            "<p>Определите, какому столбцу таблицы соответствует каждая из переменных \\( w, x, y, z \\).</p>"
            "<p>В ответе напишите буквы \\( w, x, y, z \\) в том порядке, в котором идут соответствующие им столбцы "
            "(сначала буква, соответствующая первому столбцу; затем буква, соответствующая второму столбцу, и т. д.). "
            "Буквы в ответе пишите подряд, никаких разделителей между буквами ставить не нужно.</p>")
    code = f"""from itertools import product
print('w x y z')
for w, x, y, z in product([0, 1], repeat=4):
    F = {py}
    if F == {val}:
        print(w, x, y, z)
# сопоставьте выведенные строки с фрагментом таблицы"""
    add(2, k, body, ans, "Таблицы истинности", code_block(code))


# ============================================================ №3 — база данных в Excel
def col_name(i):
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def write_xlsx(path, sheets):
    """Минимальный .xlsx без сторонних библиотек: строки — inlineStr, даты — числа со стилем даты."""
    def cell(ref, v):
        if isinstance(v, dt.date):
            return f'<c r="{ref}" s="1"><v>{(v - dt.date(1899, 12, 30)).days}</v></c>'
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{html.escape(str(v))}</t></is></c>'
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(len(sheets))) + '</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '</Relationships>')
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{html.escape(name)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
                             for i, (name, _) in enumerate(sheets)) + '</sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                             for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '</Relationships>')
        z.writestr("xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                   '<borders count="1"><border/></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
                   '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
                   '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
                   '</styleSheet>')
        for i, (_, rows) in enumerate(sheets):
            xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
            for r, row in enumerate(rows):
                xml.append(f'<row r="{r + 1}">' + "".join(cell(f"{col_name(c)}{r + 1}", v) for c, v in enumerate(row)) + "</row>")
            xml.append("</sheetData></worksheet>")
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", "".join(xml))


THEMES = [
    ("Молочные продукты", [("Молоко 3,2%", "л", 1), ("Кефир 2,5%", "л", 1), ("Сметана 20%", "кг", 0.3),
                           ("Творог 9%", "кг", 0.2), ("Сыр российский", "кг", 0.5), ("Сыр плавленый", "кг", 0.1),
                           ("Йогурт клубничный", "кг", 0.125), ("Масло сливочное", "кг", 0.18)]),
    ("Бакалея", [("Рис круглозёрный", "кг", 0.9), ("Гречка ядрица", "кг", 0.8), ("Сахар песок", "кг", 1),
                 ("Мука пшеничная", "кг", 2), ("Макароны спагетти", "кг", 0.45), ("Овсяные хлопья", "кг", 0.5),
                 ("Пшено", "кг", 0.9), ("Соль поваренная", "кг", 1)]),
    ("Кондитерские изделия", [("Зефир ванильный", "кг", 0.25), ("Зефир в шоколаде", "кг", 0.25), ("Пастила яблочная", "кг", 0.2),
                              ("Печенье овсяное", "кг", 0.3), ("Печенье сахарное", "кг", 0.4), ("Конфеты шоколадные", "кг", 0.5),
                              ("Вафли лимонные", "кг", 0.2), ("Мармелад жевательный", "кг", 0.15)]),
    ("Напитки", [("Сок яблочный", "л", 1), ("Сок апельсиновый", "л", 1), ("Морс клюквенный", "л", 0.5),
                 ("Вода минеральная", "л", 1.5), ("Квас хлебный", "л", 2), ("Лимонад грушевый", "л", 0.5),
                 ("Чай зелёный", "шт", 25), ("Кофе молотый", "кг", 0.25)]),
]
DISTRICTS = ["Центральный", "Октябрьский", "Заречный", "Первомайский", "Ленинский"]
STREETS = ["Луговая", "Садовая", "Лесная", "Мартовская", "Победы", "Солнечная", "Колхозная", "Строителей"]
MONTHS = [(6, "июня"), (8, "августа"), (9, "сентября"), (10, "октября"), (3, "марта")]


def gen3(k):
    theme_i = k % len(THEMES)
    dept, goods = THEMES[theme_i]
    month, mname = MONTHS[k % len(MONTHS)]
    year = 2025
    # Товар: свой отдел + немного соседнего
    other = THEMES[(theme_i + 1) % len(THEMES)]
    items = [(dept, *g) for g in goods] + [(other[0], *g) for g in other[1][:5]]
    products = []
    for i, (d, name, unit, qty) in enumerate(items):
        price = R.randint(4, 40) * 10 + R.choice([0, 9])
        products.append([i + 1, d, name, unit, qty, price])
    shops = []
    for i in range(16):
        shops.append([f"M{i + 1}", R.choice(DISTRICTS), f"ул. {R.choice(STREETS)}, {R.randint(1, 60)}"])
    moves = []
    op = 1
    for day in range(1, 11):
        for sh in shops:
            for p in R.sample(products, 4):
                inc = R.randint(80, 300)
                moves.append([op, dt.date(year, month, day), sh[0], p[0], "Поступление", inc]); op += 1
                moves.append([op, dt.date(year, month, day), sh[0], p[0], "Продажа", R.randint(10, inc - 5)]); op += 1
    pmap = {p[0]: p for p in products}
    smap = {s[0]: s for s in shops}
    kind = k % 4
    while True:
        d1 = R.randint(1, 5); d2 = R.randint(d1 + 3, 10)
        good_word = R.choice([g[0].split()[0] for g in goods])
        district = R.choice(DISTRICTS)
        street = R.choice(STREETS)
        def rows_of(typ, where):
            for m in moves:
                if m[4] == typ and d1 <= m[1].day <= d2 and where(m):
                    yield m
        if kind == 0:     # масса/объём поступившего товара в районе
            sel = list(rows_of("Поступление", lambda m: pmap[m[3]][2].split()[0] == good_word and smap[m[2]][1] == district))
            unit = pmap[sel[0][3]][3] if sel else "кг"
            if not sel or any(pmap[m[3]][3] != unit for m in sel) or unit == "шт":
                continue
            total = sum(m[5] * pmap[m[3]][4] for m in sel)
            what = f"общий {'вес (в кг)' if unit == 'кг' else 'объём (в литрах)'}"
            q = (f"Используя информацию из приведённой базы данных, определите {what} всех товаров, "
                 f"название которых начинается со слова «{good_word}», поступивших в магазины {district} района за период с {d1} по {d2} {mname} включительно.")
        elif kind == 1:   # прирост упаковок на улице
            def on_street(m):
                return pmap[m[3]][2].split()[0] == good_word and street in smap[m[2]][2]
            inc = sum(m[5] for m in rows_of("Поступление", on_street))
            dec = sum(m[5] for m in rows_of("Продажа", on_street))
            total = inc - dec
            if not inc:
                continue
            q = (f"Используя информацию из приведённой базы данных, определите, на сколько увеличилось количество "
                 f"упаковок всех товаров, название которых начинается со слова «{good_word}», имеющихся в наличии в магазинах на улице {street}, "
                 f"за период с {d1} по {d2} {mname} включительно.")
        elif kind == 2:   # выручка отдела в районе
            sel = list(rows_of("Продажа", lambda m: pmap[m[3]][1] == dept and smap[m[2]][1] == district))
            if not sel:
                continue
            total = sum(m[5] * pmap[m[3]][5] for m in sel)
            q = (f"Используя информацию из приведённой базы данных, определите общую выручку (в рублях) от продажи "
                 f"всех товаров отдела «{dept}» в магазинах {district} района за период с {d1} по {d2} {mname} включительно.")
        else:             # проданные упаковки товара
            sel = list(rows_of("Продажа", lambda m: pmap[m[3]][2].split()[0] == good_word))
            if not sel:
                continue
            total = sum(m[5] for m in sel)
            q = (f"Используя информацию из приведённой базы данных, определите, сколько упаковок всех товаров, "
                 f"название которых начинается со слова «{good_word}», было продано во всех магазинах города за период с {d1} по {d2} {mname} включительно.")
        if isinstance(total, float):
            total = round(total, 3)
            if abs(total - round(total)) > 1e-9:
                continue
            total = int(round(total))
        if total > 0:
            break
    q = q.replace(" района", "_района").replace("Центральный_", "Центрального ").replace("Октябрьский_", "Октябрьского ") \
         .replace("Заречный_", "Заречного ").replace("Первомайский_", "Первомайского ").replace("Ленинский_", "Ленинского ")
    name = f"3/e3-{k:02d}.xlsx"
    (MEDIA / "3").mkdir(parents=True, exist_ok=True)
    write_xlsx(MEDIA / name, [
        ("Движение товаров", [["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"]] + moves),
        ("Товар", [["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"]] + products),
        ("Магазин", [["ID магазина", "Район", "Адрес"]] + shops),
    ])
    hdr = lambda cols: table_html([cols])
    body = (f"<p>В файле приведён фрагмент базы данных «Продукты» о поставках товаров в магазины районов города. "
            "База данных состоит из трёх таблиц.</p>"
            f"<p>Таблица «Движение товаров» содержит записи о поставках товаров в магазины в течение первой декады "
            f"{mname} {year} г., а также информацию о проданных товарах. Поле «Тип операции» содержит значение "
            "«Поступление» или «Продажа», а в соответствующее поле «Количество упаковок, шт» внесена информация о том, "
            "сколько упаковок товара поступило в магазин или было продано в течение дня. Заголовок таблицы имеет следующий вид.</p>"
            + hdr(["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"]) +
            "<p>Таблица «Товар» содержит информацию об основных характеристиках каждого товара.</p>"
            + hdr(["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"]) +
            "<p>Таблица «Магазин» содержит информацию о местонахождении магазинов.</p>"
            + hdr(["ID магазина", "Район", "Адрес"]) +
            '<p>На рисунке приведена схема указанной базы данных.</p><p><img src="media/egeshka_bank/3/schema.svg" alt="Схема базы данных" width="460"></p>'
            f"<p>{q}</p><p>В ответе запишите только число.</p>")
    sol = ("<p>Добавьте в таблицу «Движение товаров» столбцы с отделом, наименованием, количеством в упаковке "
           "и ценой (ВПР по артикулу) и районом/адресом магазина (ВПР по ID магазина). Отфильтруйте по типу операции, "
           f"датам, товару и месту, затем просуммируйте нужный столбец. Ответ: {total}.</p>")
    add(3, k, body, total, "Базы данных", sol, att=[{"name": "3.xlsx", "href": f"media/egeshka_bank/{name}"}])


def schema_svg():
    def box(x, y, title, fields, key):
        h = 34 + 22 * len(fields)
        s = [f'<rect x="{x}" y="{y}" width="170" height="{h}" rx="6" fill="#ffffff" stroke="#64748b" stroke-width="1.5"/>',
             f'<rect x="{x}" y="{y}" width="170" height="26" rx="6" fill="#dbeafe"/>',
             f'<text x="{x + 10}" y="{y + 18}" font-family="Arial" font-size="13" font-weight="700" fill="#1e293b">{title}</text>']
        for i, f in enumerate(fields):
            s.append(f'<text x="{x + 12}" y="{y + 46 + 22 * i}" font-family="Arial" font-size="12.5" fill="#111827">'
                     f'{"🔑 " if f == key else ""}{f}</text>')
        return "".join(s)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 290" width="460" height="290">'
            '<rect width="460" height="290" fill="#f1f5f9"/>'
            + box(10, 50, "Движение товаров", ["ID операции", "Дата", "ID магазина", "Артикул", "Тип операции", "Количество упаковок, шт"], "ID операции")
            + box(280, 10, "Магазин", ["ID магазина", "Район", "Адрес"], "ID магазина")
            + box(280, 112, "Товар", ["Артикул", "Отдел", "Наименование товара", "Ед. изм.", "Количество в упаковке", "Цена за упаковку"], "Артикул")
            + '<path d="M180 128 H230 V58 H280" fill="none" stroke="#334155" stroke-width="1.5"/>'
            + '<path d="M180 150 H230 V160 H280" fill="none" stroke="#334155" stroke-width="1.5"/>'
            + '</svg>')


# ============================================================ №4 — условие Фано
RUS = "АБВГДЕИКЛМНОПРСТУ"


def prefix_free(codes):
    cs = sorted(codes)
    return all(not cs[i + 1].startswith(cs[i]) for i in range(len(cs) - 1)) and len(set(codes)) == len(codes)


def candidates(fixed, maxlen=6):
    out = []
    for L in range(1, maxlen + 1):
        for bits in itertools.product("01", repeat=L):
            c = "".join(bits)
            if all(not c.startswith(f) and not f.startswith(c) for f in fixed):
                out.append(c)
    return out


def gen4(k):
    while True:
        nlet = R.randint(7, 10)
        letters = sorted(R.sample(RUS, nlet), key=RUS.index)
        # строим случайный префиксный код и «прячем» часть слов
        codes = {}
        pool = ["0", "1"]
        while len(pool) < nlet + R.randint(1, 3):
            i = R.randrange(len(pool))
            c = pool.pop(i)
            pool += [c + "0", c + "1"]
        R.shuffle(pool)
        for l, c in zip(letters, pool):
            codes[l] = c
        kind = k % 4
        hide = R.sample(letters, 1 if kind in (0, 1) else R.choice([2, 3]))
        known = {l: c for l, c in codes.items() if l not in hide}
        if max(len(c) for c in known.values()) > 5:
            continue
        cand = candidates(known.values())
        if not cand:
            continue
        if kind == 0:     # кратчайшее слово, наименьшее значение
            L = min(len(c) for c in cand)
            ans = min((c for c in cand if len(c) == L), key=lambda c: int(c, 2))
            x = hide[0]
            q = (f"Укажите кратчайшее кодовое слово для буквы {x}, при котором код будет удовлетворять условию Фано. "
                 "Если таких кодов несколько, укажите код с наименьшим числовым значением.")
        elif kind == 1:   # длина кратчайшего слова
            x = hide[0]
            ans = min(len(c) for c in cand)
            q = (f"Какова наименьшая возможная длина кодового слова для буквы {x}, при которой код будет "
                 "удовлетворять условию Фано?")
        else:
            best = None
            word = None
            if kind == 3:
                word = "".join(R.choice(letters) for _ in range(R.randint(7, 10)))
                if not any(ch in hide for ch in word):
                    continue
            for combo in itertools.product(cand, repeat=len(hide)):
                if not prefix_free(list(known.values()) + list(combo)):
                    continue
                asg = dict(known, **dict(zip(hide, combo)))
                v = sum(len(asg[ch]) for ch in word) if word else sum(len(c) for c in combo)
                if best is None or v < best:
                    best = v
            if best is None:
                continue
            ans = best
            hs = ", ".join(hide)
            if kind == 2:
                q = (f"Какова наименьшая возможная суммарная длина всех кодовых слов для букв {hs}, при которой "
                     "код будет удовлетворять условию Фано?")
            else:
                q = (f"Кодовые слова для букв {hs} ещё не выбраны. Какое наименьшее количество двоичных знаков "
                     f"потребуется для кодирования слова {word}, если код должен удовлетворять условию Фано?")
        break
    rows = [["Буква", "Кодовое слово"]] + [[l, codes[l] if l not in hide else ""] for l in letters]
    body = (f"<p>По каналу связи передаются сообщения, содержащие только {nlet} букв: {', '.join(letters)}. "
            "Для передачи используется неравномерный двоичный код, удовлетворяющий условию Фано: никакое кодовое "
            "слово не является началом другого кодового слова. Известны кодовые слова для некоторых букв.</p>"
            + table_html(rows) + f"<p>{q}</p>")
    sol = ("<p>Нарисуйте двоичное дерево известных кодовых слов: свободные ветви — это слова, которые не являются "
           f"началом и продолжением уже занятых. Выберите самые короткие из них. Ответ: {ans}.</p>")
    add(4, k, body, ans, "Кодирование, условие Фано", sol)


# ============================================================ №5 — алгоритм над двоичной записью
RULES = [
    ("Строится двоичная запись числа N.<br>2. Далее эта запись обрабатывается по следующему правилу:<br>"
     "а) если число N делится на 3, то к этой записи дописываются три последние двоичные цифры;<br>"
     "б) если число N на 3 не делится, то остаток от деления умножается на 3, переводится в двоичную "
     "систему счисления и дописывается в конец двоичной записи.<br>3. Полученная таким образом запись является "
     "двоичной записью искомого числа R.",
     """def R(n):
    s = bin(n)[2:]
    if n % 3 == 0:
        s += s[-3:]
    else:
        s += bin(n % 3 * 3)[2:]
    return int(s, 2)""", 4),
    ("Строится двоичная запись числа N.<br>2. К этой записи дописываются справа ещё два разряда по следующему "
     "правилу: складываются все цифры двоичной записи, и остаток от деления суммы на 2 дописывается в конец числа "
     "(справа). Над этой записью производятся те же действия — справа дописывается остаток от деления суммы цифр на 2."
     "<br>3. Полученная таким образом запись является двоичной записью искомого числа R.",
     """def R(n):
    s = bin(n)[2:]
    for _ in range(2):
        s += str(s.count('1') % 2)
    return int(s, 2)""", 1),
    ("Строится двоичная запись числа N.<br>2. Далее эта запись обрабатывается по следующему правилу:<br>"
     "а) если число N чётное, то к двоичной записи числа слева дописывается 10;<br>"
     "б) если число N нечётное, то к двоичной записи числа слева дописывается 1 и справа дописывается 01."
     "<br>3. Полученная таким образом запись является двоичной записью искомого числа R.",
     """def R(n):
    s = bin(n)[2:]
    if n % 2 == 0:
        s = '10' + s
    else:
        s = '1' + s + '01'
    return int(s, 2)""", 1),
    ("Строится двоичная запись числа N.<br>2. Если количество единиц в двоичной записи чётное, то в конец "
     "записи дописывается 0, а в начало — 1; иначе в конец дописывается 11, а в начало — 10."
     "<br>3. Полученная таким образом запись является двоичной записью искомого числа R.",
     """def R(n):
    s = bin(n)[2:]
    if s.count('1') % 2 == 0:
        s = '1' + s + '0'
    else:
        s = '10' + s + '11'
    return int(s, 2)""", 1),
    ("Строится троичная запись числа N.<br>2. Далее эта запись обрабатывается по следующему правилу:<br>"
     "а) если число N делится на 3, то слева к нему приписывается «1», а справа «02»;<br>"
     "б) если число N на 3 не делится, то остаток от деления на 3 умножается на 4, переводится в троичную запись "
     "и дописывается в конец троичной записи.<br>3. Полученная таким образом запись является троичной записью "
     "искомого числа R.",
     """def tri(n):
    s = ''
    while n:
        s = str(n % 3) + s
        n //= 3
    return s

def R(n):
    s = tri(n)
    if n % 3 == 0:
        s = '1' + s + '02'
    else:
        s += tri(n % 3 * 4)
    return int(s, 3)""", 1),
]


def gen5(k):
    text, code, nmin = RULES[k % len(RULES)]
    ns = {}
    exec(code, ns)
    Rf = ns["R"]
    kind = (k // len(RULES) + k) % 3
    while True:
        X = R.choice([R.randint(40, 400), R.randint(400, 3000)])
        if kind == 0:
            vals = [(Rf(n), n) for n in range(nmin, 4 * X + 10)]
            cand = [r for r, n in vals if r > X]
            ans = min(cand)
            q = f"Укажите минимальное число R, большее {X}, которое может быть получено с помощью описанного алгоритма. В ответе запишите это число в десятичной системе счисления."
            tail = f"print(min(R(n) for n in range({nmin}, {4 * X + 10}) if R(n) > {X}))"
        elif kind == 1:
            ns_ = [n for n in range(nmin, 4 * X + 10) if Rf(n) > X]
            ans = min(ns_)
            q = f"Укажите минимальное число N, после обработки которого с помощью этого алгоритма получается число R, большее {X}."
            tail = f"print(min(n for n in range({nmin}, {4 * X + 10}) if R(n) > {X}))"
        else:
            ns_ = [n for n in range(nmin, X + 1) if Rf(n) < X]
            if not ns_:
                continue
            ans = max(ns_)
            q = f"Укажите максимальное число N, после обработки которого с помощью этого алгоритма получается число R, меньшее {X}. В ответе запишите это число в десятичной системе счисления."
            tail = f"print(max(n for n in range({nmin}, {X + 1}) if R(n) < {X}))"
        break
    body = ("<p>На вход алгоритма подаётся натуральное число N. Алгоритм строит по нему новое число R следующим "
            f"образом.<br>1. {text}</p>"
            + (f"<p>Например, для исходного числа \\(4_{{10}} = {'11_3' if 'троичная' in text else '100_2'}\\) результатом является число \\({Rf(4)}_{{10}}\\).</p>" if nmin <= 4 else "")
            + f"<p>{q}</p>")
    add(5, k, body, ans, "Алгоритмы обработки чисел", code_block(code + "\n\n" + tail))


def main():
    MEDIA.mkdir(parents=True, exist_ok=True)
    (MEDIA / "3").mkdir(parents=True, exist_ok=True)
    (MEDIA / "3" / "schema.svg").write_text(schema_svg(), encoding="utf-8")
    for n, g in ((1, gen1), (2, gen2), (3, gen3), (4, gen4), (5, gen5)):
        for k in range(1, PER_NUM + 1):
            g(k)
    data = {"bank": {"id": "egeshka_bank", "title": "Egeshka", "count": len(TASKS)}, "tasks": TASKS}
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=0), encoding="utf-8")
    files = sorted(str(p.relative_to(ROOT)).replace("\\", "/") for p in MEDIA.rglob("*") if p.is_file())
    (ROOT / "data" / "egeshka_files.txt").write_text("\n".join(["data/egeshka_bank.json"] + files) + "\n", encoding="utf-8")
    print(f"заданий: {len(TASKS)}, файлов: {len(files)}")


if __name__ == "__main__":
    main()
