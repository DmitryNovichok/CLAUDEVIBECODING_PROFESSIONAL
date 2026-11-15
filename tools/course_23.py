"""Архивный урок 23_old: ациклический взвешенный граф из файла (был №23 в проекте ЕГЭ-2027, в демоверсии-2027 его нет).
Запуск: python3 tools/course_23.py → course/28.json и course/data/28/ (номер 28 на сайте — архивное «23_old»)."""
import random

from course_lib import Lesson, answers, bad, callout, card, cards, cols, note, stats, steps, table

L = Lesson(28, 'Архив 23_old. Пути в графе из файла')

# ------------------------------------------------------------------ данные: один граф на весь урок
R = random.Random(2327)
V = R.sample(range(100, 1000), 46)                 # номера вершин идут не подряд; порядок списка — топологический
E = {}
for i in range(len(V) - 1):
    for j in R.sample(range(i + 1, min(len(V), i + 9)), min(R.randint(2, 5), len(V) - 1 - i, 8)):
        E[(V[i], V[j])] = round(R.uniform(1, 60), 1)
edges = list(E.items())
R.shuffle(edges)
assert len(edges) <= 200
L.file('23.txt', ''.join(f'{a}{R.choice([" ", "  ", chr(9)])}{b}{R.choice([" ", chr(9)])}{w}\n' for (a, b), w in edges))

A, B = V[0], V[-1]                                 # старт и финиш
MID = V[len(V) // 2]                               # обязательная вершина
BAN = V[len(V) // 2 + 3]                           # запрещённая вершина
(P, Q), PQW = next(((a, b), w) for (a, b), w in sorted(E.items()) if V.index(a) > 12 and V.index(b) < 34)   # обязательное ребро
SRC = V[30]                                        # откуда считаем достижимые

READ = '''g = {}
for line in open('23.txt'):
    a, b, w = line.split()
    g.setdefault(int(a), []).append((int(b), float(w)))
'''

L.code('small', '''
g = {'A': ['B', 'C'], 'B': ['C', 'D'], 'C': ['D'], 'D': []}

def ways(v):
    if v == 'D':
        return 1
    return sum(ways(u) for u in g[v])

print(ways('A'))
''', want=3)

L.code('read', READ + '''
print(len(g), sum(len(x) for x in g.values()))
''', files=['23.txt'])

L.code('count', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def ways(v, end):
    if v == end:
        return 1
    return sum(ways(u, end) for u, w in g.get(v, []))

print(ways({A}, {B}))
''', files=['23.txt'])

L.code('via', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def ways(v, end):
    if v == end:
        return 1
    return sum(ways(u, end) for u, w in g.get(v, []))

print(ways({A}, {MID}) * ways({MID}, {B}))
''', files=['23.txt'])

L.code('ban', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def ways(v, end):
    if v == {BAN}:
        return 0
    if v == end:
        return 1
    return sum(ways(u, end) for u, w in g.get(v, []))

print(ways({A}, {B}))
''', files=['23.txt'])

L.code('short', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == end:
        return 0
    return min([w + short(u, end) for u, w in g.get(v, [])],
               default=float('inf'))

print(int(short({A}, {B})))
''', files=['23.txt'])

L.code('long', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def long(v, end):
    if v == end:
        return 0
    return max([w + long(u, end) for u, w in g.get(v, [])],
               default=float('-inf'))

print(int(long({A}, {B})))
''', files=['23.txt'])

L.code('edge', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == {BAN}:
        return float('inf')
    if v == end:
        return 0
    return min([w + short(u, end) for u, w in g.get(v, [])],
               default=float('inf'))

w = dict(g[{P}])[{Q}]
print(int(short({A}, {P}) + w + short({Q}, {B})))
''', files=['23.txt'])

L.code('reach', f'''
{READ}
seen = set()

def go(v):
    for u, w in g.get(v, []):
        if u not in seen:
            seen.add(u)
            go(u)

go({SRC})
print(len(seen))
''', files=['23.txt'])

L.code('hops', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def hops(v, end):
    if v == end:
        return 0
    return max([1 + hops(u, end) for u, w in g.get(v, [])],
               default=float('-inf'))

print(hops({A}, {B}))
''', files=['23.txt'])

# ---- тип 4: путь с условием. Параметры подбираем так, чтобы условие меняло ответ (иначе задача ничему не учит)
INF = float('inf')


def _topo(start, edge_ok=lambda a, b, w: True):
    """Независимая динамика по топологическому порядку: для каждой вершины — (длина кратчайшего пути, его рёбра, самое лёгкое ребро)
    и то же для самого длинного; плюс кратчайшие пути с чётным и нечётным числом рёбер."""
    sh = {start: (0.0, 0)}
    lg = {start: (0.0, INF)}
    par = {start: [0.0, INF]}
    hop = {start: 0}
    for v in V:
        for (a, b), w in E.items():
            if a != v or not edge_ok(a, b, w):
                continue
            if v in sh:
                c = (sh[v][0] + w, sh[v][1] + 1)
                sh[b] = min(sh.get(b, (INF, 0)), c)
                lg[b] = max(lg.get(b, (-INF, 0)), (lg[v][0] + w, min(lg[v][1], w)))
                hop[b] = min(hop.get(b, INF), hop[v] + 1)
                e0, e1 = par[v]
                pb = par.setdefault(b, [INF, INF])
                pb[0], pb[1] = min(pb[0], e1 + w), min(pb[1], e0 + w)
    return sh, lg, par, hop


_SH, _LG, _PAR, _HOP = _topo(A)
# предел веса ребра: берём пару вершин, где кратчайший путь идёт по тяжёлому ребру, — тогда ограничение меняет ответ
LA, LB, LIM = next((V[i], V[j], k) for i in range(0, 12) for j in range(len(V) - 1, len(V) - 14, -1)
                   for base in [_topo(V[i])[0].get(V[j])] if base
                   for k in (20, 25, 30, 35, 40)
                   for d in [_topo(V[i], lambda a, b, w, k=k: w <= k)[0].get(V[j], (INF,))[0]]
                   if d < INF and int(d) != int(base[0]))
# пара вершин, у которой кратчайший путь состоит из нечётного числа рёбер — тогда «чётный» путь длиннее
EVA, EVB = next((V[i], V[j]) for i in range(0, 6) for j in range(len(V) - 1, len(V) - 8, -1)
                for sh, lg, par, hop in [_topo(V[i])]
                if sh.get(V[j], (INF, 0))[1] % 2 == 1 and par[V[j]][0] < INF and int(par[V[j]][0]) != int(sh[V[j]][0]))
ONA, ONB = V[8], V[30]                             # между ними лежит только часть графа
T1, T2 = V[14], V[29]                              # две обязательные вершины: сначала T1, потом T2
assert _topo(A)[0].get(T1) and _topo(T1)[0].get(T2) and _topo(T2)[0].get(B)

L.code('limit', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == end:
        return 0
    return min([w + short(u, end) for u, w in g.get(v, []) if w <= {LIM}],
               default=float('inf'))

print(int(short({LA}, {LB})))
""", files=['23.txt'])

L.code('even', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end, odd):
    if v == end:
        return float('inf') if odd else 0
    return min([w + short(u, end, not odd) for u, w in g.get(v, [])],
               default=float('inf'))

print(int(short({EVA}, {EVB}, False)))
""", files=['23.txt'])

L.code('nedges', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == end:
        return (0, 0)
    best = (float('inf'), 0)
    for u, w in g.get(v, []):
        d, k = short(u, end)
        best = min(best, (w + d, k + 1))
    return best

print(short({A}, {B})[1])
""", files=['23.txt'])

L.code('light', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def long(v, end):
    if v == end:
        return (0, float('inf'))
    best = (float('-inf'), 0)
    for u, w in g.get(v, []):
        d, m = long(u, end)
        best = max(best, (w + d, min(w, m)))
    return best

print(long({A}, {B})[1])
""", files=['23.txt'])

L.code('onpath', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def ways(v, end):
    if v == end:
        return 1
    return sum(ways(u, end) for u, w in g.get(v, []))

s = 0
for a in g:
    for b, w in g[a]:
        if ways({ONA}, a) > 0 and ways(b, {ONB}) > 0:
            s += w
print(round(s, 1))
""", files=['23.txt'])

L.code('two', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == end:
        return 0
    return min([w + short(u, end) for u, w in g.get(v, [])],
               default=float('inf'))

print(int(short({A}, {T1}) + short({T1}, {T2}) + short({T2}, {B})))
""", files=['23.txt'])

# ---- задачи для самостоятельного решения (ответы считает сборка)
S1A, S1B = V[4], V[40]
S2A, S2B, S2M = V[2], V[43], V[20]
S3A, S3B, S3X = V[1], V[44], V[25]
L.code('p1', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def ways(v, end):
    if v == end:
        return 1
    return sum(ways(u, end) for u, w in g.get(v, []))

print(ways({S1A}, {S1B}))
''', files=['23.txt'])
L.code('p2', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def long(v, end):
    if v == end:
        return 0
    return max([w + long(u, end) for u, w in g.get(v, [])],
               default=float('-inf'))

print(int(long({S2A}, {S2M}) + long({S2M}, {S2B})))
''', files=['23.txt'])
L.code('p3', f'''
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == {S3X}:
        return float('inf')
    if v == end:
        return 0
    return min([w + short(u, end) for u, w in g.get(v, [])],
               default=float('inf'))

print(int(short({S3A}, {S3B})))
''', files=['23.txt'])

S4A, S4B = V[3], V[42]
S5A, S5B, S5K = V[5], V[41], 40
assert _topo(S5A, lambda a, b, w: w <= S5K)[0].get(S5B, (INF,))[0] < INF
L.code('p4', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def short(v, end):
    if v == end:
        return (0, 0)
    best = (float('inf'), 0)
    for u, w in g.get(v, []):
        d, k = short(u, end)
        best = min(best, (w + d, k + 1))
    return best

print(short({S4A}, {S4B})[1])
""", files=['23.txt'])
L.code('p5', f"""
from functools import lru_cache

{READ}
@lru_cache(None)
def long(v, end):
    if v == end:
        return 0
    return max([w + long(u, end) for u, w in g.get(v, []) if w <= {S5K}],
               default=float('-inf'))

print(int(long({S5A}, {S5B})))
""", files=['23.txt'])

# независимая проверка: динамика по топологическому порядку без рекурсии
def _dp(start, end, kind, ban=None):
    val = {v: None for v in V}
    val[start] = 1 if kind == 'count' else 0
    for v in V:
        if val[v] is None or v == ban:
            continue
        for (a, b), w in E.items():
            if a != v or b == ban:
                continue
            if kind == 'count':
                val[b] = (val[b] or 0) + val[v]
            else:
                c = val[v] + (1 if kind == 'hops' else w)
                val[b] = c if val[b] is None else (min if kind == 'short' else max)(val[b], c)
    return val[end]


assert int(L.ans('count')) == _dp(A, B, 'count') > 100
assert int(L.ans('via')) == _dp(A, MID, 'count') * _dp(MID, B, 'count') > 0
assert int(L.ans('ban')) == _dp(A, B, 'count', BAN) and 0 < int(L.ans('ban')) < int(L.ans('count'))
assert int(L.ans('short')) == int(_dp(A, B, 'short')) and int(L.ans('long')) == int(_dp(A, B, 'long'))
assert int(L.ans('edge')) == int(_dp(A, P, 'short', BAN) + PQW + _dp(Q, B, 'short', BAN))
assert int(L.ans('hops')) == _dp(A, B, 'hops')
assert int(L.ans('p1')) == _dp(S1A, S1B, 'count') > 0
assert int(L.ans('p2')) == int(_dp(S2A, S2M, 'long') + _dp(S2M, S2B, 'long'))
assert int(L.ans('p3')) == int(_dp(S3A, S3B, 'short', S3X))
assert 3 < int(L.ans('reach')) < 16
# новые типы — сверяем с независимой динамикой
assert int(L.ans('limit')) == int(_topo(LA, lambda a, b, w: w <= LIM)[0][LB][0]) != int(_topo(LA)[0][LB][0])
assert int(L.ans('even')) == int(_topo(EVA)[2][EVB][0]) and _topo(EVA)[0][EVB][1] % 2 == 1
assert int(L.ans('nedges')) == _SH[B][1] and 2 < _SH[B][1] < int(L.ans('hops'))
assert float(L.ans('light')) == _LG[B][1] and int(_LG[B][0]) == int(L.ans('long'))
_fw, _bw = {ONA}, {ONB}
for v in V:
    for (a, b), w in E.items():
        if a == v and a in _fw:
            _fw.add(b)
for v in reversed(V):
    for (a, b), w in E.items():
        if b == v and b in _bw:
            _bw.add(a)
_on = [w for (a, b), w in E.items() if a in _fw and b in _bw]
assert float(L.ans('onpath')) == round(sum(_on), 1) and 5 < len(_on) < len(E) - 20
assert int(L.ans('two')) == int(_topo(A)[0][T1][0] + _topo(T1)[0][T2][0] + _topo(T2)[0][B][0]) > int(L.ans('short'))
assert int(L.ans('p4')) == _topo(S4A)[0][S4B][1] > 1
assert int(L.ans('p5')) == int(_topo(S5A, lambda a, b, w: w <= S5K)[1][S5B][0])

FILE = ('В файле <code>23.txt</code> — ациклический ориентированный взвешенный граф. В каждой строке: два натуральных числа L и M '
        '(ребро ведёт из L в M) и положительное вещественное число W — вес ребра. ')

SLIDES = [
    {'t': 'title', 'k': 'ЕГЭ · Информатика · архив', 'h': 'Задание 23_old',
     'sub': 'Граф из файла: сколько путей, кратчайший и самый длинный путь, обязательные и запрещённые участки, пути с условием',
     'aside': '<span class="mute">310 → 151</span><span class="b">151 → 816</span><span class="mute">816 → 559</span>'
              '<span><span class="o">@lru_cache</span></span><span class="w">ways · short · long</span>'},
    {'t': 'text', 'k': 'Введение', 'h': 'Что это за задание', 'html':
        stats(('1 балл', 'ответ — одно число'), ('Файл', 'до 200 рёбер'), ('Python', 'рекурсия с памятью'), ('6–8 мин', 'ориентир по времени'))
        + cols(('Что изменилось', 'Граф, заданный списком рёбер в текстовом файле, был №23 в проекте ЕГЭ-2027. '
                                  'В демоверсии-2027 его убрали: №23 снова про количество программ исполнителя. Урок оставлен в архиве.'),
               ('Что нужно уметь', 'Прочитать рёбра из файла, построить список соседей и написать одну рекурсивную функцию. '
                                   'Все варианты вопроса — это три-четыре изменения в этой функции.'))
        + note('Архивное задание: в КИМ ЕГЭ-2027 его нет. Навык — пути в графе из файла — пригодится в №1 и в задачах на программирование.')},
    {'t': 'text', 'k': 'Введение', 'h': 'Как выглядит файл', 'html':
        cols(('Строка файла — одно ребро', 'Три значения через пробелы или табуляции: откуда, куда, вес. Строк столько, сколько рёбер.'),
             ('Что обещает условие', 'Граф ациклический — по стрелкам нельзя вернуться в вершину. Вершины могут быть пронумерованы не подряд. '
                                     'Между двумя вершинами не больше одного ребра.'))
        + '<pre class="sl-mini">310   151\t17.4\n151\t816  3.25\n816 559   41.0\n310 665\t8.9\n...</pre>'
        + callout('Главная идея', 'Ациклический граф — значит, рекурсия «иди во всех соседей» обязательно закончится. '
                                  'Остаётся запоминать уже посчитанные вершины, чтобы не считать их заново.')},
    {'t': 'text', 'k': 'Введение', 'h': 'Карта урока: пять вопросов', 'html':
        cards([card('Сколько путей', 'Из A в B; через вершину; в обход вершины.', '1', 't1', 'sum(...)'),
               card('Кратчайший путь', 'Минимальная сумма весов, в ответе — целая часть.', '2', 't2', 'min(...)'),
               card('Самый длинный путь', 'Максимальная сумма весов или наибольшее число рёбер.', '3', 't3', 'max(...)'),
               card('Достижимость', 'Сколько вершин можно достичь из данной.', '4', 't1', 'set()'),
               card('Путь с условием', 'Предел веса ребра, чётное число рёбер, рёбра кратчайшего пути.', '5', 't2', '(длина, ещё что-то)')], cols=5)
        + callout('Одна функция на всё', 'Меняется только то, что возвращаем в конце (0 или 1) и как объединяем соседей: sum, min или max.')},
    {'t': 'text', 'k': 'Инструменты', 'h': 'Схема решения', 'html':
        steps(('Файл', 'читаем строки, split()'), ('g', 'словарь: вершина → список (сосед, вес)'), ('f(v, end)', 'рекурсия по соседям'),
              ('@lru_cache', 'память о посчитанном'), ('print', 'целая часть, если вес дробный'), dark=2)
        + table(['Вопрос', 'В конечной вершине', 'Объединяем соседей', 'Если соседей нет'],
                [['сколько путей', '<code>1</code>', '<code>sum(f(u))</code>', '<code>0</code> (сумма пустого)'],
                 ['кратчайший', '<code>0</code>', '<code>min(w + f(u))</code>', '<code>inf</code>'],
                 ['самый длинный', '<code>0</code>', '<code>max(w + f(u))</code>', '<code>-inf</code>'],
                 ['больше всего рёбер', '<code>0</code>', '<code>max(1 + f(u))</code>', '<code>-inf</code>'],
                 ['меньше всего рёбер', '<code>0</code>', '<code>min(1 + f(u))</code>', '<code>inf</code>']])},
    {'t': 'solve', 'k': 'Инструменты · Вручную', 'kc': 't1', 'h': 'Сначала поймём на маленьком графе', 'ch': 'Задание',
     'cond': '<p>Рёбра: A→B, A→C, B→C, B→D, C→D. Сколько путей из A в D?</p>'
             '<p>Посчитайте, двигаясь от конца: сколько путей до D из каждой вершины.</p>',
     'note': 'Число путей из вершины = сумма чисел путей из её соседей. Именно это и делает рекурсия.', 'nk': 'secret',
     'sol': '<ol class="sl-ol"><li>Из D в D — <b>1</b> путь (стоим на месте).</li><li>Из C: только в D → <b>1</b>.</li>'
            '<li>Из B: в C и в D → 1 + 1 = <b>2</b>.</li><li>Из A: в B и в C → 2 + 1 = <b>3</b>.</li></ol>'
            '<p>Пути: A-B-D, A-B-C-D, A-C-D.</p>', 'ans': '3'},
    L.cs('small', '<p>Тот же граф, но считает программа. Функция повторяет рассуждение: в конце пути возвращаем 1, иначе складываем ответы соседей.</p>',
         'Здесь граф крошечный, поэтому память не нужна. В файле на 200 рёбер путей бывают миллионы — без <code>@lru_cache</code> программа не дождётся ответа.',
         h='Та же задача — пять строк кода', k='Инструменты', kc='t1', nk='warn', ch='Разбор'),
    L.cs('read', '<h4>Чтение файла</h4><p><code>line.split()</code> без аргументов режет строку по любым пробелам и табуляциям — как раз то, что обещано в условии.</p>'
                 '<h4>Словарь соседей</h4><p><code>setdefault(a, [])</code> создаёт пустой список для новой вершины и сразу возвращает его.</p>'
                 '<p>Программа печатает, сколько вершин имеют исходящие рёбра и сколько всего рёбер, — удобная проверка, что файл прочитан.</p>',
         'Если в файле дробная часть отделена запятой, добавьте замену: <code>float(w.replace(\',\', \'.\'))</code>. '
         'У конечной вершины нет исходящих рёбер, её нет в словаре — поэтому дальше везде <code>g.get(v, [])</code>.',
         h='Читаем граф из файла', k='Инструменты', kc='t1', nk='warn', ch='Разбор'),

    {'t': 'section', 'k': 'Тип 1', 'kc': 't1', 'h': 'Количество путей', 'tag': 'sum(ways(u) for u in соседи)',
     'sub': 'Из вершины в вершину · через обязательную вершину · в обход запрещённой.'},
    L.cs('count', f'<p>{FILE}</p><p>Сколько существует различных путей из вершины <b>{A}</b> в вершину <b>{B}</b>?</p>',
         '<code>@lru_cache(None)</code> запоминает ответ для каждой пары (v, end). Каждая вершина считается один раз — программа работает мгновенно.',
         h='Сколько путей из одной вершины в другую', k='Тип 1 · Количество путей · 1 из 3', kc='t1'),
    L.cs('via', f'<p>{FILE}</p><p>Сколько путей из <b>{A}</b> в <b>{B}</b> проходят через вершину <b>{MID}</b>?</p>',
         f'Путь через {MID} — это любой путь до неё и любой путь после. Количества <b>перемножаются</b>, а не складываются.',
         h='Через обязательную вершину — умножаем', k='Тип 1 · Количество путей · 2 из 3', kc='t1'),
    L.cs('ban', f'<p>{FILE}</p><p>Сколько путей из <b>{A}</b> в <b>{B}</b> <b>не</b> проходят через вершину <b>{BAN}</b>?</p>',
         'Запрещённая вершина — тупик: из неё возвращаем 0. Эта проверка стоит <b>первой</b>, до проверки конца пути.',
         h='В обход запрещённой вершины', k='Тип 1 · Количество путей · 3 из 3', kc='t1', nk='warn'),

    {'t': 'section', 'k': 'Тип 2', 'kc': 't2', 'h': 'Длина пути', 'tag': 'min / max (w + f(u))',
     'sub': 'Кратчайший путь · самый длинный путь · путь через заданное ребро · наибольшее число рёбер.'},
    L.cs('short', f'<p>{FILE}</p><p>Найдите длину кратчайшего пути из <b>{A}</b> в <b>{B}</b>. В ответе запишите целую часть.</p>',
         '<code>default=float(\'inf\')</code> нужен для тупиков: из вершины без рёбер до цели не дойти, её «расстояние» бесконечно и минимум его отбросит.',
         h='Кратчайший путь', k='Тип 2 · Длина пути · 1 из 4', kc='t2'),
    L.cs('long', f'<p>{FILE}</p><p>Найдите длину самого длинного пути из <b>{A}</b> в <b>{B}</b>. В ответе запишите целую часть.</p>',
         'Зеркальная программа: <code>max</code> вместо <code>min</code> и <code>-inf</code> вместо <code>inf</code>. '
         'В графе с циклами так нельзя, но наш граф ациклический по условию.',
         h='Самый длинный путь', k='Тип 2 · Длина пути · 2 из 4', kc='t2'),
    L.cs('edge', f'<p>{FILE}</p><p>Найдите целую часть длины кратчайшего пути из <b>{A}</b> в <b>{B}</b>, который проходит по ребру '
                 f'<b>{P} → {Q}</b> и не проходит через вершину <b>{BAN}</b>.</p>',
         f'Путь через ребро собирается из трёх кусков: до {P}, само ребро, от {Q} до конца. '
         'Запрет вершины — та же первая строка в функции, только возвращаем бесконечность.',
         h='Через ребро и в обход вершины', k='Тип 2 · Длина пути · 3 из 4', kc='t2', nk='secret'),
    L.cs('hops', f'<p>{FILE}</p><p>Найдите наибольшее количество рёбер в пути из <b>{A}</b> в <b>{B}</b>.</p>',
         'Вес ребра здесь не нужен: каждое ребро добавляет 1. Ответ — целое число, <code>int()</code> не требуется.',
         h='Наибольшее количество рёбер', k='Тип 2 · Длина пути · 4 из 4', kc='t2'),

    {'t': 'section', 'k': 'Тип 3', 'kc': 't3', 'h': 'Достижимость', 'tag': 'seen = set()',
     'sub': 'Сколько вершин можно достичь, двигаясь по стрелкам.'},
    L.cs('reach', f'<p>{FILE}</p><p>Сколько вершин графа достижимы из вершины <b>{SRC}</b>? Саму вершину {SRC} не считать.</p>',
         'Множество <code>seen</code> хранит посещённые вершины. Стартовую вершину в него не кладём — условие просит её не считать.',
         h='Сколько вершин достижимо', k='Тип 3 · Достижимость', kc='t3'),

    {'t': 'section', 'k': 'Тип 4', 'kc': 't2', 'h': 'Путь с условием', 'tag': 'условие → в перебор соседей или в ответ функции',
     'sub': 'Предел веса ребра · чётное число рёбер · сколько рёбер в кратчайшем пути · самое лёгкое ребро · рёбра на путях · две вершины по порядку.'},
    L.cs('limit', f'<p>{FILE}</p><p>Найдите целую часть длины кратчайшего пути из <b>{LA}</b> в <b>{LB}</b>, в котором вес каждого ребра '
                  f'<b>не превышает {LIM}</b>.</p>',
         f'Слишком тяжёлые рёбра просто не берём: условие <code>if w &lt;= {LIM}</code> стоит в конце перебора соседей. '
         f'Без ограничения ответ был бы {int(_topo(LA)[0][LB][0])} — короткий путь шёл по тяжёлому ребру.',
         h='Вес каждого ребра не больше заданного', k='Тип 4 · Путь с условием · 1 из 6', kc='t2'),
    L.cs('even', f'<p>{FILE}</p><p>Найдите целую часть длины кратчайшего пути из <b>{EVA}</b> в <b>{EVB}</b>, состоящего из '
                 '<b>чётного</b> количества рёбер.</p>',
         'У функции третий параметр: <code>odd</code> — нечётно ли число пройденных рёбер. Каждое ребро его переворачивает. '
         'В конечной вершине путь годится, только если <code>odd</code> ложно; иначе возвращаем бесконечность.',
         h='Чётное количество рёбер', k='Тип 4 · Путь с условием · 2 из 6', kc='t2', nk='warn'),
    L.cs('nedges', f'<p>{FILE}</p><p>Сколько рёбер в кратчайшем (по сумме весов) пути из <b>{A}</b> в <b>{B}</b>?</p>',
         'Функция возвращает пару <b>(длина, число рёбер)</b>. Пары сравниваются по первому элементу, поэтому <code>min</code> '
         'выбирает самый короткий путь, а число рёбер «едет» вместе с ним. В ответ идёт второй элемент пары.',
         h='Сколько рёбер в кратчайшем пути', k='Тип 4 · Путь с условием · 3 из 6', kc='t2', wide=True),
    L.cs('light', f'<p>{FILE}</p><p>Найдите самый длинный путь из <b>{A}</b> в <b>{B}</b>. В ответе запишите вес самого лёгкого ребра '
                  'на этом пути — так, как он записан в файле.</p>',
         'Тот же приём: пара <b>(длина, самое лёгкое ребро)</b>. В конце пути лёгкого ребра ещё нет — ставим бесконечность, '
         'дальше берём <code>min(w, m)</code>. Ответ дробный: <code>int()</code> здесь не нужен.',
         h='Самое лёгкое ребро на самом длинном пути', k='Тип 4 · Путь с условием · 4 из 6', kc='t2', wide=True),
    L.cs('onpath', f'<p>{FILE}</p><p>Найдите сумму весов всех рёбер, которые лежат хотя бы на одном пути из <b>{ONA}</b> в <b>{ONB}</b>. '
                   'Ответ запишите с одним знаком после запятой.</p>',
         f'Ребро a → b лежит на каком-то пути, если до a можно дойти из {ONA}, а из b — дойти до {ONB}. '
         '«Можно дойти» — это «путей больше нуля», функция <code>ways</code> уже есть.',
         h='Рёбра, лежащие на путях', k='Тип 4 · Путь с условием · 5 из 6', kc='t2', wide=True),
    L.cs('two', f'<p>{FILE}</p><p>Найдите целую часть длины кратчайшего пути из <b>{A}</b> в <b>{B}</b>, проходящего сначала через вершину '
                f'<b>{T1}</b>, а затем через вершину <b>{T2}</b>.</p>',
         'Три куска складываются. Если порядок вершин не задан («через обе»), посчитайте оба порядка и возьмите меньший: '
         'в ациклическом графе один из них даст бесконечность.',
         h='Через две вершины по порядку', k='Тип 4 · Путь с условием · 6 из 6', kc='t2'),

    {'t': 'text', 'k': 'Ловушки', 'h': 'Восемь ошибок, которые стоят балла', 'html':
        bad('<b>Нет <code>@lru_cache</code>.</b> Программа считает одни и те же вершины миллионы раз и не успевает.',
            '<b><code>g[v]</code> вместо <code>g.get(v, [])</code>.</b> У конечных вершин нет исходящих рёбер — будет KeyError.',
            '<b>Сложили вместо умножения.</b> «Через вершину C» — это ways(A, C) × ways(C, B).',
            '<b>Запрет проверяется после конца пути.</b> Проверку запрещённой вершины ставим первой строкой функции.',
            '<b>Округлили вместо отбрасывания.</b> «Целая часть» — это <code>int(x)</code>, а не <code>round(x)</code>.',
            '<b>Перепутали направление.</b> В строке «L M W» ребро идёт из L в M, обратно пройти нельзя.',
            '<b>Посчитали рёбра не того пути.</b> «Сколько рёбер в кратчайшем пути» — это не «наименьшее число рёбер»: сначала длина, потом рёбра.',
            '<b>Не тот формат ответа.</b> Целая часть, один знак после запятой или число «как в файле» — перечитайте последнюю фразу условия.')
        + callout('Проверка за 20 секунд', 'Выведите <code>len(g)</code> и число рёбер и сравните с числом строк файла. '
                                           'Потом запустите функцию на паре соседних вершин — ответ должен совпасть с тем, что видно в файле.')},
    {'t': 'text', 'k': 'Шпаргалка', 'h': 'Весь 23_old на одном слайде', 'html':
        '<div class="sl-cheat">'
        '<div><b>Чтение</b><code>a, b, w = line.split()<br>g.setdefault(int(a), []).append((int(b), float(w)))</code></div>'
        '<div><b>Количество путей</b><code>if v == end: return 1<br>return sum(ways(u, end) for u, w in g.get(v, []))</code></div>'
        '<div><b>Кратчайший</b><code>if v == end: return 0<br>return min([w + f(u, end) ...], default=float(\'inf\'))</code></div>'
        '<div><b>Самый длинный</b><code>return max([w + f(u, end) ...], default=float(\'-inf\'))</code></div>'
        '<div><b>Через вершину C</b><code>f(A, C) * f(C, B)</code> — для количества<br><code>f(A, C) + f(C, B)</code> — для длины</div>'
        '<div><b>Запрет вершины X</b><code>if v == X: return 0</code> — количество<br><code>if v == X: return float(\'inf\')</code> — кратчайший</div>'
        '<div><b>Предел веса ребра</b><code>... for u, w in g.get(v, []) if w &lt;= K</code></div>'
        '<div><b>Чётное число рёбер</b><code>def f(v, end, odd):<br>if v == end: return inf if odd else 0</code></div>'
        '<div><b>Рёбра кратчайшего пути</b><code>best = min(best, (w + d, k + 1))</code> — пара (длина, рёбра)</div>'
        '<div><b>Ребро a→b на пути</b><code>ways(A, a) &gt; 0 and ways(b, B) &gt; 0</code></div>'
        '</div>'},
    {'t': 'text', 'k': 'Практика', 'h': 'Решите самостоятельно', 'html':
        cards([card('', f'Сколько путей ведёт из вершины <b>{S1A}</b> в вершину <b>{S1B}</b>?', '1 · количество', 't1'),
               card('', f'Найдите целую часть длины самого длинного пути из <b>{S2A}</b> в <b>{S2B}</b>, проходящего через вершину <b>{S2M}</b>.', '2 · самый длинный', 't2'),
               card('', f'Найдите целую часть длины кратчайшего пути из <b>{S3A}</b> в <b>{S3B}</b>, не проходящего через вершину <b>{S3X}</b>.', '3 · кратчайший', 't3'),
               card('', f'Сколько рёбер в кратчайшем пути из <b>{S4A}</b> в <b>{S4B}</b>?', '4 · рёбра пути', 't2'),
               card('', f'Найдите целую часть длины самого длинного пути из <b>{S5A}</b> в <b>{S5B}</b>, в котором вес каждого ребра не превышает <b>{S5K}</b>.', '5 · предел веса', 't2')], cols=3)
        + note('Файл тот же — 23.txt. Откройте любую программу урока в Python, измените номера вершин и функцию. Ответы и решения — на следующих слайдах.')},
    {'t': 'text', 'k': 'Урок пройден!', 'h': 'Ответы', 'dark': True, 'html':
        answers([('Задача 1', L.ans('p1'), 'sum и lru_cache', 't1'), ('Задача 2', L.ans('p2'), 'два куска складываем', 't2'),
                 ('Задача 3', L.ans('p3'), 'запрет — первой строкой', 't3'), ('Задача 4', L.ans('p4'), 'пара (длина, рёбра)', 't2'),
                 ('Задача 5', L.ans('p5'), 'if w <= K в переборе', 't2')])
        + callout('Не сошлось?', 'Проверьте три вещи: направление ребра, g.get(v, []) и порядок проверок в функции. '
                                 'Затем откройте программу «По шагам в лаборатории» и посмотрите, в какие вершины она заходит.', dark=True)},
    {'t': 'codes', 'k': 'Практика', 'h': 'Решения задач 1–3', 'blocks': [
        L.block('p1', '<b>Задача 1.</b> Количество путей.'),
        L.block('p2', '<b>Задача 2.</b> Через вершину: длины складываются.'),
        L.block('p3', '<b>Задача 3.</b> Запрещённая вершина даёт бесконечность.')]},
    {'t': 'codes', 'k': 'Практика', 'h': 'Решения задач 4–5', 'blocks': [
        L.block('p4', '<b>Задача 4.</b> Пара (длина, число рёбер): min выбирает по длине.'),
        L.block('p5', '<b>Задача 5.</b> Самый длинный путь по рёбрам не тяжелее предела.')]},
]

if __name__ == '__main__':
    L.write(SLIDES)
