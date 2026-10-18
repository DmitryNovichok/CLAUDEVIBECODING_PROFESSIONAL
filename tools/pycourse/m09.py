from _dsl import *  # noqa: F403

ORDER = 9


def table(rows, width, lo, hi, rep=0.45):
    """Строки таблицы: по width чисел; в части строк нарочно есть повторы (в задачах 9 спрашивают именно про них)."""
    def gen(rng):
        out = []
        for _ in range(rows):
            r = [rng.randint(lo, hi) for _ in range(width)]
            if rng.random() < rep:                 # 1–3 значения повторяются
                for _ in range(rng.choice([1, 1, 2, 2, 3])):
                    i, j = rng.sample(range(width), 2)
                    r[j] = r[i]
            out.append('\t'.join(map(str, r)))
        return '\n'.join(out) + '\n'
    return gen


def grid(n, m, lo, hi):
    def gen(rng):
        return '\n'.join(' '.join(str(rng.randint(lo, hi)) for _ in range(m)) for _ in range(n)) + '\n'
    return gen


L1 = level('База: строка таблицы — список', 'чтение строк, split, сортировка, сумма и максимум, счётчик строк', [
    title('Задание 9', 'Электронная таблица — это текстовый файл: каждая строка таблицы — строка файла с числами через табуляцию',
          chips=['split', 'sorted', 'a.count(x)', 'set']),
    txt('Как перенести таблицу в Python', ol('Откройте файл задания (xlsx / csv) в Excel или LibreOffice.',
                                            'Выделите все данные (Ctrl + A или Ctrl + Shift + ↓) и скопируйте.',
                                            'Вставьте в текстовый файл 9.txt рядом с программой и сохраните.',
                                            'Каждая строка файла — одна строка таблицы, числа разделены табуляцией.')
        + callout('В курсе', 'Файлы задач уже в формате .txt — можно сразу открывать в Python.'), k='Уровень 1'),
    code('Строка → список чисел', '''
        for line in open('9.txt'):
            a = list(map(int, line.split()))
            a.sort()
            print(a, sum(a), a[0], a[-1])
    ''', cond=p('split() без аргументов режет и по пробелам, и по табуляциям. После sort() минимум — a[0], максимум — a[-1], '
                'а «три средних» — a[1], a[2], a[3].'),
         files={'9.txt': '5\t12\t7\t3\n40\t1\t9\t9\n'}, k='Уровень 1'),
    code('Счётчик и номер строки', '''
        k = 0
        for i, line in enumerate(open('9.txt'), start=1):
            a = sorted(map(int, line.split()))
            if a[-1] < a[0] + a[1] + a[2]:
                k += 1
                print('подошла строка', i)
        print(k)
    ''', cond=p('«Сколько строк» — счётчик. «Номер строки» — enumerate(…, start=1): строки таблицы нумеруются с 1.'),
         files={'9.txt': '5\t12\t7\t3\n40\t1\t9\t9\n'}, k='Уровень 1'),
], [
    task('sum2max', 'Сумма больше двух максимумов',
         p('В каждой строке файла <b>9.txt</b> — четыре натуральных числа. Сколько строк, в которых сумма всех чисел больше удвоенного максимального?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    if sum(a) > 2 * max(a):
        k += 1
print(k)''', files={'9.txt': table(3000, 4, 1, 200, rep=0)}),
    task('distinct5', 'Все разные и неравенство',
         p('В строках файла <b>9.txt</b> по пять натуральных чисел. Сколько строк, в которых все числа различны, а утроенная сумма максимального '
           'и минимального не меньше удвоенной суммы трёх оставшихся?'),
         '''
k = 0
for line in open('9.txt'):
    a = sorted(map(int, line.split()))
    if len(set(a)) == 5 and (a[0] + a[-1]) * 3 >= (a[1] + a[2] + a[3]) * 2:
        k += 1
print(k)''', files={'9.txt': table(3000, 5, 1, 150, rep=0.3)}),
    task('sorted', 'Уже по возрастанию',
         p('В строках файла <b>9.txt</b> по шесть чисел. Найдите сумму чисел всех строк, в которых числа идут строго по возрастанию.'),
         '''
total = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    if all(a[i] < a[i + 1] for i in range(len(a) - 1)):
        total += sum(a)
print(total)''', files={'9.txt': lambda rng: ''.join('\t'.join(map(str, sorted(rng.sample(range(1, 400), 6)) if rng.random() < .05
                                                              else [rng.randint(1, 400) for _ in range(6)])) + '\n' for _ in range(4000))},
         hint='Сортировать нельзя — проверяем исходный порядок: a[i] &lt; a[i+1] для всех соседей.'),
    task('firstrow', 'Номер первой строки',
         p('В строках файла <b>9.txt</b> по четыре числа. Найдите номер первой строки, в которой разность максимального и минимального числа '
           'равна сумме двух оставшихся.'),
         '''
for i, line in enumerate(open('9.txt'), start=1):
    a = sorted(map(int, line.split()))
    if a[-1] - a[0] == a[1] + a[2]:
        print(i)
        break''', files={'9.txt': table(3000, 4, 1, 300, rep=0)}),
    task('avg', 'Больше среднего',
         p('В строках файла <b>9.txt</b> по шесть чисел. Сколько строк, в которых ровно три числа больше среднего арифметического чисел этой строки?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    m = sum(a) / len(a)
    if sum(1 for x in a if x > m) == 3:
        k += 1
print(k)''', files={'9.txt': table(3000, 6, 1, 100)}),
])

L2 = level('Стандарт: повторяющиеся числа', 'списки повторяющихся и неповторяющихся, сколько раз и каких значений', [
    code('pov и ne_pov', '''
        a = [77, 65, 77, 65, 33, 33, 111]
        pov = [x for x in a if a.count(x) > 1]
        ne_pov = [x for x in a if a.count(x) == 1]
        print(pov, len(pov), set(pov), len(set(pov)))
        print(ne_pov)
    ''', cond=ul('pov — все повторяющиеся значения (каждое столько раз, сколько встречается)',
                 'len(pov) — сколько ячеек с повторами, len(set(pov)) — сколько РАЗНЫХ значений повторяется',
                 'ne_pov — числа, которые встречаются один раз'), k='Уровень 2'),
    txt('Словарь условий', tab(['В условии', 'В коде'], [
        ['ровно одно число повторяется дважды, остальные различны', 'len(pov) == 2'],
        ['три числа повторяются по два раза', 'len(set(pov)) == 3 and len(pov) == 6'],
        ['одно число повторяется трижды', 'len(pov) == 3 and len(set(pov)) == 1'],
        ['повторов нет', 'len(set(a)) == len(a)'],
        ['есть повторяющиеся числа', 'len(pov) > 0'],
        ['среднее неповторяющихся', 'sum(ne_pov) / len(ne_pov)']]), k='Уровень 2'),
    code('Проверка на маленьком примере', '''
        for a in ([5, 5, 1, 2, 3], [5, 5, 5, 1, 2], [4, 4, 7, 7, 9]):
            pov = [x for x in a if a.count(x) > 1]
            print(a, len(pov) == 2)
    ''', cond=p('Прежде чем запускать на файле — проверьте условие на трёх руками придуманных строках. Ошибки в pov ловятся сразу.'),
         k='Уровень 2'),
], [
    task('pair1', 'Одна пара повторов',
         p('В строках файла <b>9.txt</b> по шесть чисел. Сколько строк, в которых ровно одно число повторяется ровно дважды, остальные числа различны, '
           'а повторяющееся число больше среднего арифметического неповторяющихся?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    pov = [x for x in a if a.count(x) > 1]
    ne = [x for x in a if a.count(x) == 1]
    if len(pov) == 2 and pov[0] > sum(ne) / len(ne):
        k += 1
print(k)''', files={'9.txt': table(4000, 6, 1, 60)}),
    task('three2', 'Три пары',
         p('В строках файла <b>9.txt</b> по семь чисел. Сколько строк, в которых три числа повторяются ровно по два раза, седьмое не повторяется, '
           'а среднее арифметическое наибольшего и наименьшего из повторяющихся меньше неповторяющегося?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    pov = [x for x in a if a.count(x) > 1]
    ne = [x for x in a if a.count(x) == 1]
    if len(set(pov)) == 3 and len(pov) == 6 and len(ne) == 1 and (max(pov) + min(pov)) / 2 < ne[0]:
        k += 1
print(k)''', files={'9.txt': lambda rng: ''.join('\t'.join(map(str, rng.sample(
            [v for v in rng.sample(range(1, 300), 3) for _ in range(2)] + [rng.randint(1, 300)], 7) if rng.random() < .3
            else [rng.randint(1, 60) for _ in range(7)])) + '\n' for _ in range(4000))}, stars=2),
    task('triple', 'Тройной повтор',
         p('В строках файла <b>9.txt</b> по шесть чисел. Сколько строк, в которых одно число повторяется ровно три раза, остальные три различны, '
           'и повторяющееся число больше среднего остальных трёх?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    pov = [x for x in a if a.count(x) > 1]
    ne = [x for x in a if a.count(x) == 1]
    if len(pov) == 3 and len(set(pov)) == 1 and len(ne) == 3 and pov[0] > sum(ne) / 3:
        k += 1
print(k)''', files={'9.txt': table(4000, 6, 1, 40, rep=0.6)}),
    task('maxnot', 'Максимум не повторяется',
         p('В строках файла <b>9.txt</b> по семь чисел. Найдите сумму чисел той строки, в которой два значения повторяются по два раза, '
           'три числа не повторяются, а максимальное число строки встречается один раз. Если таких строк несколько, '
           'в ответ запишите сумму чисел последней из них.'),
         '''
ans = None
for line in open('9.txt'):
    a = list(map(int, line.split()))
    pov = [x for x in a if a.count(x) > 1]
    ne = [x for x in a if a.count(x) == 1]
    if len(set(pov)) == 2 and len(pov) == 4 and len(ne) == 3 and a.count(max(a)) == 1:
        ans = sum(a)
print(ans)''', files={'9.txt': table(3000, 7, 1, 90, rep=0.5)}, stars=2),
    task('avgpov', 'Среднее повторяющихся',
         p('В строках файла <b>9.txt</b> по семь чисел. Найдите номер первой строки, в которой ровно два значения повторяются по два раза, '
           'три числа не повторяются и среднее всех повторяющихся (с учётом повторов) меньше наибольшего неповторяющегося.'),
         '''
for i, line in enumerate(open('9.txt'), start=1):
    a = list(map(int, line.split()))
    pov = [x for x in a if a.count(x) > 1]
    ne = [x for x in a if a.count(x) == 1]
    if len(pov) == 4 and len(set(pov)) == 2 and len(ne) == 3 and sum(pov) / 4 < max(ne):
        print(i)
        break''', files={'9.txt': table(3000, 7, 1, 90, rep=0.5)}),
])

L3 = level('Профи: чётность и составные условия', 'чётные и нечётные, «ровно одно из условий», несколько списков сразу', [
    code('Ещё два списка', '''
        a = [12, -7, 3, 8, 8]
        chet = [x for x in a if x % 2 == 0]
        nechet = [x for x in a if x % 2 != 0]
        print(chet, nechet)
    ''', cond=p('Чётность в Python работает и для отрицательных: -7 % 2 == 1. Но «оканчивается на 5» — только через abs.'), k='Уровень 3'),
    code('Ровно одно из двух условий', '''
        a = [3, 5, 7, 2, 2, 9]
        pov = [x for x in a if a.count(x) > 1]
        nechet = [x for x in a if x % 2 != 0]
        c1 = len(pov) > 0
        c2 = len(nechet) == 3
        print(c1, c2, c1 != c2, (c1 + c2) == 1)
    ''', cond=p('«Выполнено ровно одно из условий» — исключающее ИЛИ: c1 != c2 (или c1 + c2 == 1). «Хотя бы одно» — or, «оба» — and.'),
         k='Уровень 3'),
    code('Средние с защитой от деления на ноль', '''
        a = [2, 4, 6]
        ev = [x for x in a if x % 2 == 0]
        od = [x for x in a if x % 2 != 0]
        m_ev = sum(ev) / len(ev) if ev else 0
        m_od = sum(od) / len(od) if od else 0
        print(m_ev, m_od)
    ''', cond=p('Если нечётных в строке нет, sum(od) / len(od) упадёт с ошибкой. Условное выражение … if od else 0 спасает.'),
         nk='warn', note='Прочитайте условие: иногда строка без нечётных просто не подходит — тогда проверьте это отдельно.', k='Уровень 3'),
], [
    task('xor', 'Ровно одно условие',
         p('В строках файла <b>9.txt</b> по шесть чисел. Сколько строк, в которых выполнено ровно одно из условий: '
           '«в строке есть повторяющиеся числа» и «в строке ровно три нечётных числа»?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    c1 = any(a.count(x) > 1 for x in a)
    c2 = sum(1 for x in a if x % 2 != 0) == 3
    if c1 != c2:
        k += 1
print(k)''', files={'9.txt': table(4000, 6, 1, 100)}),
    task('evodd', 'Средние чётных и нечётных',
         p('В строках файла <b>9.txt</b> по пять чисел. Сколько строк, в которых выполнено ровно одно из условий: «все числа различны» и '
           '«средние арифметические чётных и нечётных чисел строки отличаются больше чем на 50» (если чисел какой-то чётности нет, '
           'их среднее считается равным 0)?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    ev = [x for x in a if x % 2 == 0]
    od = [x for x in a if x % 2 != 0]
    m1 = sum(ev) / len(ev) if ev else 0
    m2 = sum(od) / len(od) if od else 0
    if (len(set(a)) == 5) + (abs(m1 - m2) > 50) == 1:
        k += 1
print(k)''', files={'9.txt': table(4000, 5, 1, 200)}, stars=2),
    task('negs', 'Отрицательные числа',
         p('В строках файла <b>9.txt</b> по шесть целых чисел (бывают отрицательные). Сколько строк, в которых положительных чисел больше, '
           'чем отрицательных, а сумма модулей отрицательных больше суммы положительных?'),
         '''
k = 0
for line in open('9.txt'):
    a = list(map(int, line.split()))
    pos = [x for x in a if x > 0]
    neg = [x for x in a if x < 0]
    if len(pos) > len(neg) and sum(abs(x) for x in neg) > sum(pos):
        k += 1
print(k)''', files={'9.txt': table(4000, 6, -100, 100)}),
    task('evensq', 'Квадраты крайних',
         p('В строках файла <b>9.txt</b> по пять чисел. Сколько строк, в которых ровно одно число повторяется дважды, остальные различны, '
           'и квадрат суммы наибольшего и наименьшего чисел меньше суммы квадратов трёх оставшихся?'),
         '''
k = 0
for line in open('9.txt'):
    a = sorted(map(int, line.split()))
    pov = [x for x in a if a.count(x) > 1]
    if len(pov) == 2 and (a[0] + a[-1]) ** 2 < a[1] ** 2 + a[2] ** 2 + a[3] ** 2:
        k += 1
print(k)''', files={'9.txt': table(4000, 5, 1, 100)}),
    task('rowsum', 'Наибольшая сумма',
         p('В строках файла <b>9.txt</b> по шесть чисел. Среди строк, в которых все числа чётные или все нечётные, найдите наибольшую сумму чисел строки.'),
         '''
best = None
for line in open('9.txt'):
    a = list(map(int, line.split()))
    if all(x % 2 == 0 for x in a) or all(x % 2 != 0 for x in a):
        if best is None or sum(a) > best:
            best = sum(a)
print(best)''', files={'9.txt': table(5000, 6, 1, 1000)}),
])

L4 = level('Максимум: двумерная таблица', 'вся таблица в памяти, столбцы через zip, соседи клетки по восьми направлениям', [
    code('Таблица целиком', '''
        a = [list(map(int, line.split())) for line in open('9.txt')]
        print(len(a), len(a[0]))
        print(a[1][2])
        cols = list(zip(*a))
        print(cols[0], [sum(c) for c in cols])
    ''', cond=p('a[i][j] — строка i, столбец j (с нуля). zip(*a) «поворачивает» таблицу: получаются столбцы.'),
         files={'9.txt': '1 2 3\n4 5 6\n7 8 9\n'}, k='Уровень 4'),
    code('Соседи клетки', '''
        a = [list(map(int, line.split())) for line in open('9.txt')]
        n, m = len(a), len(a[0])
        i, j = 0, 1
        nb = []
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if (di or dj) and 0 <= i + di < n and 0 <= j + dj < m:
                    nb.append(a[i + di][j + dj])
        print(nb)
    ''', cond=p('Восемь направлений — все пары di, dj из -1, 0, 1, кроме (0, 0). Соседи за краем таблицы не берутся — проверка границ.'),
         note='a[-1] в Python — последняя строка, а не «за краем». Без проверки границ угловая клетка получит чужих соседей.', nk='warn',
         files={'9.txt': '1 2 3\n4 5 6\n7 8 9\n'}, k='Уровень 4'),
], [
    task('peaks', 'Не меньше соседей',
         p('В файле <b>9.txt</b> — прямоугольная таблица чисел. Найдите сумму всех чисел, которые не меньше любого из своих соседей '
           '(по горизонтали, вертикали и диагоналям) и при этом среди соседей есть число, равное им.'),
         '''
a = [list(map(int, line.split())) for line in open('9.txt')]
n, m = len(a), len(a[0])
total = 0
for i in range(n):
    for j in range(m):
        nb = [a[i + di][j + dj] for di in (-1, 0, 1) for dj in (-1, 0, 1)
              if (di or dj) and 0 <= i + di < n and 0 <= j + dj < m]
        if a[i][j] >= max(nb) and a[i][j] in nb:
            total += a[i][j]
print(total)''', files={'9.txt': grid(60, 40, 1, 30)}, stars=2),
    task('colmax', 'Столбец с наибольшей суммой',
         p('В файле <b>9.txt</b> — таблица чисел. Найдите номер столбца (с 1) с наибольшей суммой; если таких несколько — наименьший номер.'),
         '''
a = [list(map(int, line.split())) for line in open('9.txt')]
sums = [sum(c) for c in zip(*a)]
print(sums.index(max(sums)) + 1)''', files={'9.txt': grid(500, 12, 1, 999)}),
    task('rowcol', 'Максимум строки и столбца',
         p('В файле <b>9.txt</b> — таблица чисел. Сколько клеток, число в которых одновременно наибольшее в своей строке и наибольшее в своём столбце '
           '(если наибольших несколько, подходит каждое)?'),
         '''
a = [list(map(int, line.split())) for line in open('9.txt')]
cols = [max(c) for c in zip(*a)]
k = 0
for i, row in enumerate(a):
    for j, x in enumerate(row):
        if x == max(row) and x == cols[j]:
            k += 1
print(k)''', files={'9.txt': grid(40, 40, 1, 25)}, stars=3),
    task('diag', 'Диагонали',
         p('В файле <b>9.txt</b> — квадратная таблица. Найдите модуль разности суммы главной диагонали (слева сверху вправо вниз) '
           'и суммы побочной диагонали.'),
         '''
a = [list(map(int, line.split())) for line in open('9.txt')]
n = len(a)
print(abs(sum(a[i][i] for i in range(n)) - sum(a[i][n - 1 - i] for i in range(n))))''', files={'9.txt': grid(70, 70, -500, 500)}),
])

MODULE = module('m09', 'Электронные таблицы на Python', '📊', 'Таблица из файла: строки, повторы, чётность, столбцы и соседи',
                [L1, L2, L3, L4], n=9)
