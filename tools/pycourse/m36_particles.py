"""Авторский практикум №27. Кластеры по энергии и расстояния по координатам."""
from _dsl import code, field, level, module, p, practice, task, worksheet

ORDER = 27.25
SPEEDS = [(2, 0, '1'), (0, 3, '1'), (1, -2, '2'), (-2, -2, '0,5')]
POINTS = [(0, 0, 3, 4), (-3, 1, 0, 5), (2, 2, 2, 2), (1, -2, 1, 8)]
ENERGIES = [1, 2, 3, 4, 5, 6]
CANDIDATES = [2, 2.5, 4]
PAIRS = [(1, 'II', 1, 'II', 5), (1, 'II', 2, 'II', 20), (2, 'II', 2, 'I', 15), (2, 'II', 2, 'II', 8)]


def particles(rng):
    rows = []
    speeds = [(1, 0), (0, -1), (1, -1), (-2, 0), (2, 2), (0, 4), (-4, 4)]
    for base, count in zip((1, 4, 7, 10), (101, 121, 141, 161)):
        # Both endpoints fix each band's width. All energies are distinct, including its median.
        for i, tick in enumerate([0, 256] + rng.sample(range(1, 256), count - 2)):
            energy = base + tick / 128
            vx, vy = rng.choice(speeds)
            mass = 2 * energy / (vx * vx + vy * vy)
            x, y = rng.randint(-120, 120) / 4, rng.randint(-120, 120) / 4
            kind = 'II' if i < 2 else rng.choice(('I', 'II', 'III', 'IV'))
            rows.append(f'{x} {y} {vx} {vy} {mass} {kind}'.replace('.', ','))
    rng.shuffle(rows)
    return '\n'.join(rows) + '\n'


L1 = level('Энергия и расстояние', 'Вычислить два разных признака одной и той же частицы или пары.', [
    code('Какие столбцы брать?', """
        from math import hypot
        vx, vy, mass = 3, 4, 2
        print(mass * (vx**2 + vy**2) / 2)
        print(hypot(7 - 1, 4 - 4))
    """, cond=p('Энергия одной частицы равна m·(Vx² + Vy²)/2. Для расстояния между двумя частицами берут разности их координат x и y.')),
], [
    worksheet('energy', 'Вычисли энергию', 'Для каждой частицы вычисли кинетическую энергию. Дробный ответ можно ввести с точкой или запятой.',
              ['Vx', 'Vy', 'Масса'], SPEEDS, [field('Энергия', 'Возведи обе скорости в квадрат, сложи, умножь на массу и раздели на 2.')],
              f'for vx, vy, raw in {SPEEDS!r}:\n    mass = float(raw.replace(",", "."))\n    print(mass * (vx**2 + vy**2) / 2)',
              'После возведения в квадрат знак компоненты скорости исчезает.'),
    worksheet('distance', 'Расстояние между частицами', 'Для каждой пары вычисли евклидово расстояние. Все ответы в этой таблице целые.',
              ['x₁', 'y₁', 'x₂', 'y₂'], POINTS, [field('Расстояние', 'Возьми корень из суммы квадратов разностей координат.')],
              f'from math import hypot\nfor x1, y1, x2, y2 in {POINTS!r}:\n    print(hypot(x2 - x1, y2 - y1))',
              'Совпадающие точки имеют нулевое расстояние.'),
], need=2)

L2 = level('Разделить частицы на группы', 'Провести границу, выбрать центр и отфильтровать пары.', [
    code('Размах группы', """
        energies = [1, 2.5, 4]
        print(energies[-1] - energies[0])
    """, cond=p('Если энергии любых двух частиц одной группы отличаются максимум на R, то размах группы max(E) − min(E) не превышает R. Для 1, 2.5 и 4 соседние разрывы равны 1.5, но полный размах равен 3.')),
    code('Центр по сумме отклонений', """
        energies = [3, 3.5, 5, 5.5, 6]
        for e in energies:
            print(e, sum(abs(e - other) for other in energies))
    """, cond=p('Центр — частица с минимальной суммой абсолютных отклонений по энергии. Для нечётного числа различных энергий это средний по порядку элемент отсортированного ряда — медиана.')),
], [
    worksheet('groups', 'Проведи границу на шкале', 'На шкале показаны энергии всех шести частиц. Разбей их ровно на две непустые группы с размахом не более 2. Нумеруй группы от меньших энергий к большим. Для каждой частицы выбери её группу.',
              ['Энергия'], [[e] for e in ENERGIES], [field('Группа', 'Сравни величину с первой энергией своей группы. Значение на расстоянии ровно 2 ещё помещается.', ['1', '2'])],
              f'group = 0\nfirst = None\nfor energy in {ENERGIES!r}:\n    if first is None or energy - first > 2:\n        group += 1\n        first = energy\n    print(group)',
              'Проверь крайние значения в каждой из двух групп.', axis=ENERGIES),
    worksheet('center', 'Найди центральную частицу', 'В одном кластере три частицы с энергиями 2, 2.5 и 4. Для каждого кандидата найди сумму абсолютных разностей со всеми тремя частицами и укажи, является ли он центром.',
              ['Энергия кандидата'], [[e] for e in CANDIDATES], [field('Сумма отклонений', 'Вычисли три модуля разностей. Расстояние до самого кандидата равно нулю.'),
              field('Центр?', 'Выбери частицу, у которой сумма минимальна.', ['да', 'нет'])],
              f'energies = {CANDIDATES!r}\ncost = [sum(abs(e - x) for x in energies) for e in energies]\nfor total in cost:\n    print(total, "да" if total == min(cost) else "нет")',
              'Для проверки отсортируй три энергии и найди среднюю по порядку.'),
    worksheet('eligible', 'Какая пара участвует в Q1?', 'Обрабатывай пары сверху вниз. В Q1 участвуют только две частицы признака II из одного кластера. После каждой строки укажи, подходит ли пара, и наибольшее допустимое расстояние с начала просмотра.',
              ['Группа A', 'Признак A', 'Группа B', 'Признак B', 'Расстояние'], PAIRS,
              [field('Учитывать?', 'Сверь номера кластеров и оба признака.', ['да', 'нет']),
               field('Максимум', 'Рекорд меняется только для допустимой пары с большим расстоянием.')],
              f'best = 0\nfor a, ka, b, kb, dist in {PAIRS!r}:\n    fits = a == b and ka == kb == "II"\n    if fits:\n        best = max(best, dist)\n    print("да" if fits else "нет", best)',
              'Даже очень большое расстояние пропусти, если частицы относятся к разным кластерам.'),
], need=3)

GROUP_SIZES = """
    radius = float(input().replace(',', '.'))
    energies = sorted(map(float, input().replace(',', '.').split()))
    groups = []
    for energy in energies:
        if not groups or energy - groups[-1][0] > radius:
            groups.append([])
        groups[-1].append(energy)
    print(*(len(g) for g in groups))
"""
METRICS = """
    from math import hypot
    n = int(input())
    energies = []
    selected = []
    for _ in range(n):
        x, y, e, kind = input().replace(',', '.').split()
        energies.append(float(e))
        if kind == 'II':
            selected.append((float(x), float(y)))
    best = 0
    for i, (x, y) in enumerate(selected):
        for u, v in selected[i + 1:]:
            best = max(best, hypot(u - x, v - y))
    center = sorted(energies)[n // 2]
    print(int(best * 10000), int(center * 10000))
"""
L3 = level('Написать алгоритм', 'Проверить разбиение и расчёт двух ответов на небольших входах.', [
    code('Прочитать десятичные запятые', """
        row = '1,5 -2,25 3,0 II'
        x, y, energy, kind = row.replace(',', '.').split()
        print(float(x), float(y), float(energy), kind)
    """, cond=p('Числовые поля преобразуй по отдельности. Римская метка остаётся строкой.')),
], [
    practice('groupcode', 'Верни размеры групп', p('На первой строке R ≥ 0, на второй непустой список энергий в произвольном порядке. Возьми наименьшую оставшуюся энергию и отнеси к её группе все энергии в пределах R от неё. Повторяй до конца. Выведи размеры групп по возрастанию их минимальных энергий.'),
             GROUP_SIZES, ['2\n4 1 6 3 5 2', '1\n3 2 1', '0\n2 1 1 2 5', '1,5\n4 2,5 1', '2\n7'],
             'Если очередное значение превышает минимум группы больше чем на R, начни следующую группу.',
             "radius = float(input().replace(',', '.'))\nenergies = sorted(map(float, input().replace(',', '.').split()))\n", graded=True),
    practice('metricscode', 'Два результата одного кластера', p('Дано нечётное N, затем N строк вида x y энергия признак. Все частицы уже в одном кластере, энергии различны. Найди Q1 — максимальное расстояние между двумя частицами с признаком II (0, если пары нет), и Q2 — энергию центра. Выведи целые части Q1·10000 и Q2·10000.'),
             METRICS, ['3\n0 0 2 II\n3 4 4 II\n99 99 2,5 I', '1\n4 -2 1,75 I',
                       '3\n0 0 5 I\n0 2 4 II\n0 5 3 II', '3\n1 1 1,25 II\n2 2 1,125 II\n-12 -15 1 I'],
             'Энергии всех частиц участвуют в выборе центра. Метка II ограничивает только поиск расстояния.',
             "from math import hypot\nn = int(input())\n", graded=True),
], need=2)

FINAL = """
    from math import sqrt

    points = []
    with open('27.txt') as f:
        for line in f:
            x, y, vx, vy, mass, kind = line.replace(',', '.').split()
            vx, vy, mass = float(vx), float(vy), float(mass)
            points.append((mass * (vx**2 + vy**2) / 2, float(x), float(y), kind))
    groups = []
    for point in sorted(points):
        if not groups or point[0] - groups[-1][0][0] > 2:
            groups.append([])
        groups[-1].append(point)
    max_squared = 0
    centers = []
    for group in groups:
        centers.append(group[len(group) // 2][0])
        selected = [(x, y) for _, x, y, kind in group if kind == 'II']
        for i, (x, y) in enumerate(selected):
            for u, v in selected[i + 1:]:
                max_squared = max(max_squared, (x - u)**2 + (y - v)**2)
    print(int(sqrt(max_squared) * 10000), int(max(centers) * 10000))
"""
L4 = level('Разобрать файл частиц', 'Получить две величины из одного перемешанного набора исходных наблюдений.', [], [
    task('file', 'Четыре кластера в файле 27.txt',
         p('В <b>27.txt</b> каждая строка содержит x, y, Vx, Vy, массу m и признак. Заголовка нет. Дробные числа записаны с запятой. '
           'Энергия E = m·(Vx² + Vy²)/2. Частицы единственным образом делятся на четыре непустых кластера, в каждом разность любых двух энергий по модулю не превышает 2.',
           'Центр — частица с минимальной суммой абсолютных разностей энергий до остальных частиц её кластера. В каждом кластере нечётное число частиц с различными энергиями.',
           'Q1 — наибольшее евклидово расстояние между двумя частицами одного кластера с признаком II у обеих. Q2 — наибольшая энергия среди четырёх центров. Выведи целые части Q1·10000 и Q2·10000 в указанном порядке.'),
         FINAL, files={'27.txt': particles}, hint='Проверь число групп и размах каждой. Координаты нужны при вычислении Q1. Округление вниз делай после умножения.', stars=3),
], need=1)

MODULE = module('m36', 'Тренажёр кластеризации по энергии', 'E', 'Вычисли энергию, проведи границы и проверь обе части ответа на файле частиц.',
                [L1, L2, L3, L4], n=27)
