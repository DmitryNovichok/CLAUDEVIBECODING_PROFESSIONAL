from _dsl import *  # noqa: F403

ORDER = 27


def clusters(centers, n_each, sd, anomalies=0, box=None):
    """Точки вокруг центров (нормальное распределение), координаты через запятую, разделитель — табуляция."""
    def gen(rng):
        pts = []
        for (cx, cy), n in zip(centers, n_each):
            for _ in range(n):
                pts.append((rng.gauss(cx, sd), rng.gauss(cy, sd)))
        if anomalies:
            (x0, y0, x1, y1) = box
            for _ in range(anomalies):
                pts.append((rng.uniform(x0, x1), rng.uniform(y0, y1)))
        rng.shuffle(pts)
        f = lambda v: f'{v:.6f}'.replace('.', ',')
        return '\n'.join(f'{f(x)}\t{f(y)}' for x, y in pts) + '\n'
    return gen


READ = '''from math import dist
pts = []
for line in open('27.txt'):
    x, y = map(float, line.replace(',', '.').split())
    pts.append((x, y))
'''
CENTR = '''
def centr(cl):
    return min(cl, key=lambda p: sum(dist(p, q) for q in cl))
'''

A = clusters([(2, 3), (7, 6)], [400, 450], 0.7)
B = clusters([(2, 2), (8, 3), (5, 8)], [700, 800, 650], 0.8)
C = clusters([(1, 1), (6, 2), (3, 7), (9, 8)], [500, 600, 550, 450], 0.6, anomalies=25, box=(-3, -3, 13, 12))

L1 = level('База: точки и центроид', 'чтение дробей с запятой, разделение на кластеры по прямой, центроид как точка с наименьшей суммой расстояний', [
    title('Задание 27', 'Кластеры: точки на плоскости, их центры и аномалии',
          chips=["replace(',', '.')", 'math.dist', 'центроид', 'BFS']),
    code('Читаем точки', READ + '''print(len(pts), pts[:2])''',
         cond=p('В файлах ЕГЭ дробная часть отделена запятой. float("1,5") — ошибка, поэтому сначала replace(\',\', \'.\').'),
         files={'27.txt': '1,5\t2,25\n-0,75\t3,0\n2,0\t2,0\n'}, k='Уровень 1'),
    code('Смотрим глазами', '''
        from turtle import *
        tracer(0)
        up()
        for line in open('27.txt'):
            x, y = map(float, line.replace(',', '.').split())
            goto(x * 30, y * 30)
            dot(4)
        update()
        done()
    ''', cond=p('Черепаха рисует все точки — сразу видно, сколько кластеров и где провести границу между ними. '
                'В редакторе на сайте точки появятся под кодом.'),
         note='Сначала посмотрите на картинку, потом пишите условие разделения: «y &gt; 4», «x &lt; 5 и y &lt; 5» и т. п.',
         files={'27.txt': B}, k='Уровень 1'),
    code('Центроид', READ + CENTR + '''
print(centr(pts))''', cond=p('Центр кластера по правилам задания — точка кластера, у которой сумма расстояний до всех остальных точек кластера наименьшая. '
                              'math.dist(p, q) — расстояние между точками.'),
         note='Это двойной цикл: на 3000 точек — 9 миллионов расстояний. Считайте центр каждого кластера отдельно, а не по всем точкам сразу.',
         files={'27.txt': '1,5\t2,25\n-0,75\t3,0\n2,0\t2,0\n'}, k='Уровень 1'),
], [
    task('a2', 'Два кластера',
         p('В файле <b>27.txt</b> — координаты точек двух кластеров (дробная часть через запятую). Кластеры можно разделить прямой y = 4,5. '
           'Найдите центроид каждого кластера. В ответе запишите два числа: целую часть произведения среднего арифметического абсцисс центроидов на 10 000 '
           'и целую часть произведения среднего арифметического ординат центроидов на 10 000.'),
         READ + CENTR + '''
cl = [[p for p in pts if p[1] > 4.5], [p for p in pts if p[1] <= 4.5]]
c = [centr(k) for k in cl]
print(int((c[0][0] + c[1][0]) / 2 * 10000), int((c[0][1] + c[1][1]) / 2 * 10000))''', files={'27.txt': A}),
    task('a2n', 'Размеры кластеров',
         p('Файл <b>27.txt</b> (два кластера, граница y = 4,5). Сколько точек в каждом кластере? В ответе — сначала количество в верхнем, затем в нижнем.'),
         READ + '''
print(sum(1 for p in pts if p[1] > 4.5), sum(1 for p in pts if p[1] <= 4.5))''', files={'27.txt': A}),
    task('a2d', 'Расстояние между центрами',
         p('Файл <b>27.txt</b> (два кластера, граница y = 4,5). Найдите расстояние между центроидами кластеров, умножьте на 10 000 и запишите целую часть.'),
         READ + CENTR + '''
c1 = centr([p for p in pts if p[1] > 4.5])
c2 = centr([p for p in pts if p[1] <= 4.5])
print(int(dist(c1, c2) * 10000))''', files={'27.txt': A}),
])

L2 = level('Стандарт: три кластера', 'разделение по нескольким условиям, средние и расстояния до точки, количество в радиусе', [
    code('Три кластера', READ + '''
cl = [[], [], []]
for x, y in pts:
    if y > 5.5:
        cl[2].append((x, y))
    elif x < 5:
        cl[0].append((x, y))
    else:
        cl[1].append((x, y))
print([len(k) for k in cl])''', cond=p('Границу подбираем по картинке: сначала отделяем верхний кластер, потом оставшиеся два — по x.'),
         files={'27.txt': B}, k='Уровень 2'),
    code('Точки в радиусе', READ + CENTR + '''
cl = [p for p in pts if p[1] > 5.5]
c = centr(cl)
print(sum(1 for p in cl if p != c and dist(p, c) <= 1.2))''', cond=p('«Сколько точек кластера на расстоянии не больше R от центроида» — фильтр по dist. Сам центроид обычно не считают.'),
         files={'27.txt': B}, k='Уровень 2'),
], [
    task('b3', 'Три центроида',
         p('В файле <b>27.txt</b> — три кластера (посмотрите на картинку: верхний отделяется прямой y = 5,5, нижние два — прямой x = 5). '
           'Найдите центроиды. В ответе — целые части величин 10 000·Px и 10 000·Py, где Px и Py — средние арифметические абсцисс и ординат центроидов.'),
         READ + CENTR + '''
cl = [[], [], []]
for x, y in pts:
    if y > 5.5:
        cl[2].append((x, y))
    elif x < 5:
        cl[0].append((x, y))
    else:
        cl[1].append((x, y))
c = [centr(k) for k in cl]
print(int(sum(p[0] for p in c) / 3 * 10000), int(sum(p[1] for p in c) / 3 * 10000))''', files={'27.txt': B}, stars=2),
    task('b3o', 'Ближе всех к началу координат',
         p('Файл <b>27.txt</b> (те же три кластера). Найдите расстояния от начала координат до каждого центроида. В ответе — целые части величин '
           '10 000·Q1 и 10 000·Q2, где Q1 — наименьшее, Q2 — наибольшее из этих расстояний.'),
         READ + CENTR + '''
cl = [[], [], []]
for x, y in pts:
    cl[2 if y > 5.5 else 0 if x < 5 else 1].append((x, y))
d = [dist(centr(k), (0, 0)) for k in cl]
print(int(min(d) * 10000), int(max(d) * 10000))''', files={'27.txt': B}, stars=2),
    task('b3r', 'Точки в радиусе',
         p('Файл <b>27.txt</b> (три кластера). Для кластера с наименьшим количеством точек найдите количество точек (кроме центроида), лежащих на расстоянии '
           'не больше 1 от его центроида, и целую часть 10 000·d, где d — наименьшее расстояние от центроида до другой точки этого кластера.'),
         READ + CENTR + '''
cl = [[], [], []]
for x, y in pts:
    cl[2 if y > 5.5 else 0 if x < 5 else 1].append((x, y))
k = min(cl, key=len)
c = centr(k)
print(sum(1 for p in k if p != c and dist(p, c) <= 1), int(min(dist(p, c) for p in k if p != c) * 10000))''', files={'27.txt': B}, stars=2),
])

L3 = level('Профи: кластеры без прямой границы', 'автоматическая кластеризация: точки ближе ε — в одном кластере (обход в ширину); аномалии', [
    code('Соседи на расстоянии ε', READ + '''
from collections import deque
eps = 0.6
left = set(range(len(pts)))
groups = []
while left:
    s = left.pop()
    g = [s]
    q = deque([s])
    while q:
        i = q.popleft()
        near = [j for j in left if dist(pts[i], pts[j]) <= eps]
        for j in near:
            left.remove(j)
            g.append(j)
            q.append(j)
    groups.append(g)
print(sorted(len(g) for g in groups)[-6:])''',
         cond=p('Кластер — все точки, до которых можно «дошагать» шагами не длиннее ε. Берём любую точку и обходом в ширину собираем всех её соседей, '
                'соседей соседей и так далее. Повторяем, пока точки не кончатся.'),
         note='Маленькие группы из 1–3 точек — аномалии: они далеко от всех кластеров. Обычно их отбрасывают.', nk='secret',
         files={'27.txt': C}, k='Уровень 3'),
], [
    task('c4', 'Четыре кластера и аномалии',
         p('В файле <b>27.txt</b> — точки четырёх кластеров и несколько аномалий (точек вдали от всех кластеров). Точки, между которыми можно пройти шагами '
           'не длиннее 0,6, относятся к одному кластеру; группы меньше 30 точек — аномалии. Сколько точек в самом большом кластере и сколько всего аномальных точек?'),
         READ + '''
from collections import deque
eps = 0.6
left = set(range(len(pts)))
groups = []
while left:
    s = left.pop()
    g, q = [s], deque([s])
    while q:
        i = q.popleft()
        near = [j for j in left if dist(pts[i], pts[j]) <= eps]
        for j in near:
            left.remove(j)
            g.append(j)
            q.append(j)
    groups.append(g)
big = [g for g in groups if len(g) >= 30]
print(max(len(g) for g in big), sum(len(g) for g in groups if len(g) < 30))''', files={'27.txt': C}, stars=3),
    task('c4c', 'Центроиды без аномалий',
         p('Файл <b>27.txt</b> (четыре кластера, аномалии — группы меньше 30 точек при шаге 0,6). Для каждого кластера найдите центроид. '
           'В ответе — целые части 10 000·Px и 10 000·Py (средние арифметические координат четырёх центроидов).'),
         READ + CENTR + '''
from collections import deque
eps = 0.6
left = set(range(len(pts)))
groups = []
while left:
    s = left.pop()
    g, q = [s], deque([s])
    while q:
        i = q.popleft()
        near = [j for j in left if dist(pts[i], pts[j]) <= eps]
        for j in near:
            left.remove(j)
            g.append(j)
            q.append(j)
    groups.append(g)
cs = [centr([pts[i] for i in g]) for g in groups if len(g) >= 30]
print(int(sum(c[0] for c in cs) / len(cs) * 10000), int(sum(c[1] for c in cs) / len(cs) * 10000))''', files={'27.txt': C}, stars=3),
])

L4 = level('Максимум: скорость', 'центроид за разумное время, сетка-решётка для поиска соседей, проверка ответа', [
    code('Быстрые соседи: решётка', '''
        from collections import defaultdict
        from math import dist
        pts = [(0.1, 0.2), (0.5, 0.4), (3.0, 3.1), (0.45, 0.1)]
        eps = 0.6
        grid = defaultdict(list)
        for i, (x, y) in enumerate(pts):
            grid[(int(x // eps), int(y // eps))].append(i)

        def near(i):
            x, y = pts[i]
            gx, gy = int(x // eps), int(y // eps)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for j in grid[(gx + dx, gy + dy)]:
                        if j != i and dist(pts[i], pts[j]) <= eps:
                            yield j

        print(list(near(0)))
    ''', cond=p('Разбиваем плоскость на клетки размером ε. Соседи точки — только в её клетке и восьми соседних. Вместо n² проверок — почти линейно.'),
         k='Уровень 4'),
], [
    task('fast', 'Большой файл',
         p('В файле <b>27.txt</b> — 8000 точек нескольких кластеров и аномалии. Используя шаг 0,5 (точки ближе 0,5 — в одном кластере) и считая аномалиями '
           'группы меньше 30 точек, найдите количество кластеров и количество точек в самом маленьком кластере.'),
         READ + '''
from collections import defaultdict, deque
eps = 0.5
grid = defaultdict(list)
for i, (x, y) in enumerate(pts):
    grid[(int(x // eps), int(y // eps))].append(i)

seen = [False] * len(pts)
groups = []
for s in range(len(pts)):
    if seen[s]:
        continue
    seen[s] = True
    g, q = [s], deque([s])
    while q:
        i = q.popleft()
        x, y = pts[i]
        gx, gy = int(x // eps), int(y // eps)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid[(gx + dx, gy + dy)]:
                    if not seen[j] and dist(pts[i], pts[j]) <= eps:
                        seen[j] = True
                        g.append(j)
                        q.append(j)
    groups.append(g)
big = [g for g in groups if len(g) >= 30]
print(len(big), min(len(g) for g in big))''',
         files={'27.txt': clusters([(0, 0), (6, 1), (2, 7), (9, 9), (12, 3)], [1800, 1500, 1700, 1600, 1350], 0.7, anomalies=50, box=(-4, -4, 16, 14))},
         stars=3),
    task('far', 'Самая удалённая точка',
         p('Файл <b>27.txt</b> (три кластера; граница — как в уровне 2: y = 5,5 и x = 5). Для каждого кластера найдите точку, наиболее удалённую от центроида. '
           'В ответе — целая часть 10 000·D, где D — наибольшее из этих трёх расстояний.'),
         READ + CENTR + '''
cl = [[], [], []]
for x, y in pts:
    cl[2 if y > 5.5 else 0 if x < 5 else 1].append((x, y))
D = 0
for k in cl:
    c = centr(k)
    D = max(D, max(dist(p, c) for p in k))
print(int(D * 10000))''', files={'27.txt': B}, stars=2),
])

MODULE = module('m27', 'Анализ данных: кластеры', '📍', 'Точки на плоскости: центроиды, разделение кластеров, аномалии, быстрые алгоритмы',
                [L1, L2, L3, L4], n=27)
