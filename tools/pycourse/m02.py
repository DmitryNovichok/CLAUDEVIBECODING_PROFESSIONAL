from itertools import permutations, product

from _dsl import *  # noqa: F403

ORDER = 2


def fragment(key, expr, nvars='xyzw', rows=3, value=1, blanks=3, mixed=False):
    """Фрагмент таблицы истинности с единственным ответом: строки функции, часть клеток пустая.
    Подбирается детерминированно (по ключу) — так, чтобы порядок столбцов восстанавливался однозначно."""
    f = eval('lambda ' + ','.join(nvars) + ': ' + expr)
    allrows = [r for r in product([0, 1], repeat=len(nvars))]
    base = [int(f(*r)) for r in allrows]
    if sum([int(f(*[r[i] for i in pm])) for r in allrows] == base for pm in permutations(range(len(nvars)))) > 1:
        raise SystemExit(f'{key}: функция симметрична — однозначного фрагмента не бывает')
    # если однозначного фрагмента такого размера нет — пробуем на строку больше или на пустую клетку меньше
    for rows_, blanks_ in [(rows + dr, blanks - db) for db in range(3) for dr in range(4)]:
        res = _fragment(key, f, nvars, allrows, rows_, value, max(0, blanks_), mixed)
        if res:
            return res
    raise SystemExit(f'{key}: не нашёлся однозначный фрагмент')


def _fragment(key, f, nvars, allrows, rows, value, blanks, mixed):
    rng = rng_for(f'frag:{key}:{rows}:{blanks}')
    for _ in range(400):
        perm = list(nvars)
        rng.shuffle(perm)
        pool = [r for r in allrows if mixed or int(f(*r)) == value]
        if len(pool) < rows:
            return None
        pick = rng.sample(pool, rows)
        # строка фрагмента: значения в порядке perm
        frag = [[dict(zip(nvars, r))[v] for v in perm] + [int(f(*r))] for r in pick]
        cells = [(i, j) for i in range(rows) for j in range(len(nvars))]
        for i, j in rng.sample(cells, blanks):
            frag[i][j] = None
        sols = solve(f, nvars, frag)
        if len(sols) == 1:
            return frag, sols[0]
    return None


def solve(f, nvars, frag):
    out = []
    holes = sum(x is None for r in frag for x in r[:-1])
    for p in permutations(nvars):
        for fill in product([0, 1], repeat=holes):
            it = iter(fill)
            rows = [[x if x is not None else next(it) for x in r[:-1]] + [r[-1]] for r in frag]
            if len({tuple(r[:-1]) for r in rows}) != len(rows):
                continue
            if all(int(f(**dict(zip(p, r[:-1])))) == r[-1] for r in rows):
                out.append(''.join(p))
                break
    return out


def frag_html(frag, n):
    head = ''.join(f'<th>?</th>' for _ in range(n)) + '<th>F</th>'
    body = ''.join('<tr>' + ''.join(f'<td>{"" if x is None else x}</td>' for x in r) + '</tr>' for r in frag)
    return f'<table><tr>{head}</tr>{body}</table>'


def frag_code(expr, nvars, frag):
    rows = ',\n    '.join('(' + ', '.join('None' if x is None else str(x) for x in r) + ')' for r in frag)
    return f'''from itertools import permutations, product

def F({', '.join(nvars)}):
    return {expr}

frag = [
    {rows},
]
holes = sum(x is None for r in frag for x in r[:-1])
for p in permutations('{nvars}'):
    for fill in product([0, 1], repeat=holes):
        it = iter(fill)
        rows = [[x if x is not None else next(it) for x in r[:-1]] + [r[-1]] for r in frag]
        if len(set(tuple(r[:-1]) for r in rows)) < len(rows):
            continue            # строки фрагмента должны быть разными
        if all(F(**dict(zip(p, r[:-1]))) == r[-1] for r in rows):
            print(''.join(p))
            break'''


def frag_task(key, h, formula, expr, stars=2, nvars='xyzw', rows=3, value=1, blanks=3, mixed=False, hint=''):
    frag, ans = fragment(key, expr, nvars, rows, value, blanks, mixed)
    what = 'Все строки фрагмента различны.' if blanks else ''
    cond = p(f'Логическая функция F задаётся выражением <b>{formula}</b>. Дан частично заполненный фрагмент, содержащий '
             f'неповторяющиеся строки таблицы истинности функции F. Определите, какому столбцу соответствует каждая из переменных '
             f'{", ".join(nvars)}.') + frag_html(frag, len(nvars)) + p(f'В ответе напишите буквы {", ".join(nvars)} в том порядке, '
                                                                        f'в котором идут соответствующие им столбцы. {what}')
    return task(key, h, cond, frag_code(expr, nvars, frag), ans=ans, stars=stars, hint=hint)


L1 = level('База: логика в Python', 'and, or, not, импликация через <=, эквивалентность через ==, перебор всех наборов', [
    title('Задание 2', 'Таблицы истинности: Python перебирает все наборы переменных и сам находит нужные строки',
          chips=['and or not', 'a <= b', 'a == b', 'product']),
    txt('Логические операции на Python', tab(['Операция', 'Обозначение', 'Python'], [
        ['Конъюнкция (И)', 'a ∧ b', 'a and b'], ['Дизъюнкция (ИЛИ)', 'a ∨ b', 'a or b'], ['Отрицание', '¬a', 'not a'],
        ['Импликация', 'a → b', 'a <= b'], ['Эквивалентность', 'a ≡ b', 'a == b'], ['Исключающее ИЛИ', 'a ⊕ b', 'a != b']])
        + callout('Почему a → b — это a <= b', 'Импликация ложна только при a = 1, b = 0. Для чисел 0 и 1 ровно в этом случае a &lt;= b ложно.'),
        k='Уровень 1'),
    code('Перебор всех наборов', '''
        print('x y z w F')
        for x in range(2):
            for y in range(2):
                for z in range(2):
                    for w in range(2):
                        F = (x <= y) and (not z or w)
                        if F == 0:
                            print(x, y, z, w, int(F))
    ''', cond=p('Четыре вложенных цикла по 0 и 1 — все 16 наборов. Печатаем только строки, где F равна нужному значению.'),
         note='Скобки ставьте щедро: в Python not сильнее and, and сильнее or, а сравнения (&lt;=, ==) слабее арифметики, но сильнее not. '
              'Выражение «x &lt;= y and z» читается как «(x &lt;= y) and z».', nk='warn', k='Уровень 1'),
    code('То же через product', '''
        from itertools import product
        for x, y, z, w in product([0, 1], repeat=4):
            F = (x == y) or not (z <= w)
            if F:
                print(x, y, z, w)
    ''', cond=p('product([0, 1], repeat=4) выдаёт все наборы из четырёх нулей и единиц — без вложенных циклов.'), k='Уровень 1'),
    code('Не перепутать == и =', '''
        x, y = 1, 0
        print(x == y, x <= y, x != y)
        print(not x == y)      # not (x == y)
        print((not x) == y)
    ''', cond=p('= — присваивание, == — сравнение (эквивалентность). not x == y — это not (x == y): сравнение выполняется раньше not.'),
         nk='warn', note='Пишите отрицание со скобками: (not x). Так безопаснее всего.', k='Уровень 1'),
], [
    task('cnt1', 'Сколько единиц',
         p('Сколько существует наборов значений переменных x, y, z, w, при которых выражение (x → y) ∧ (¬z ∨ w) истинно?'),
         '''
from itertools import product
print(sum(1 for x, y, z, w in product([0, 1], repeat=4) if (x <= y) and (not z or w)))'''),
    task('cnt0', 'Сколько нулей',
         p('Сколько существует наборов значений x, y, z, w, при которых выражение ((x ≡ y) ∨ ¬(z ≡ w)) ∧ (y → ¬z) ложно?'),
         '''
from itertools import product
k = 0
for x, y, z, w in product([0, 1], repeat=4):
    if not (((x == y) or not (z == w)) and (y <= (not z))):
        k += 1
print(k)'''),
    task('xor', 'Исключающее ИЛИ',
         p('Сколько наборов x, y, z, w делают истинным выражение (x ⊕ y) ∧ (z ∨ ¬w) ∧ ¬(x ∧ z)?'),
         '''
from itertools import product
print(sum(1 for x, y, z, w in product([0, 1], repeat=4) if (x != y) and (z or not w) and not (x and z)))'''),
    task('five', 'Пять переменных',
         p('Сколько существует наборов значений переменных a, b, c, d, e, при которых истинно выражение (a → b) ∧ (b → c) ∧ (c → d) ∧ (d → e)?'),
         '''
from itertools import product
print(sum(1 for a, b, c, d, e in product([0, 1], repeat=5) if (a <= b) and (b <= c) and (c <= d) and (d <= e)))''',
         hint='Ответ подсказывает идею: цепочка импликаций истинна, только если единицы идут «хвостом» в конце.'),
    task('first', 'Первая подходящая строка',
         p('Строки таблицы истинности выражения ¬(y → (x ≡ w)) ∧ (z → x) упорядочены по возрастанию двоичного числа xyzw '
           '(0000, 0001, …). Запишите значения x, y, z, w первой строки, в которой выражение истинно, — четыре цифры подряд.'),
         '''
from itertools import product
for x, y, z, w in product([0, 1], repeat=4):
    if (not (y <= (x == w))) and (z <= x):
        print(f'{x}{y}{z}{w}')
        break''', hint='product перебирает наборы как раз по возрастанию двоичного числа.'),
])

L2 = level('Стандарт: фрагмент таблицы', 'печатаем строки нужного значения и сопоставляем столбцы — вручную и с проверкой кодом', [
    txt('Как читается задание', ol('Python печатает все строки, где F равна значению из фрагмента (обычно все строки фрагмента — с F = 1 или с F = 0).',
                                   'Смотрим на строки фрагмента: в каком столбце сколько единиц, какие столбцы совпадают.',
                                   'Ищем переменную, которая в напечатанных строках ведёт себя так же: например, всегда равна 1.',
                                   'Записываем порядок переменных по столбцам фрагмента.')
        + callout('Хитрость', 'Сначала найдите «особенную» переменную — ту, что во всех нужных строках постоянна. Её столбец во фрагменте виден сразу.'),
        k='Уровень 2'),
    code('Печатаем строки с F = 0', '''
        print('x y z w')
        for x in range(2):
            for y in range(2):
                for z in range(2):
                    for w in range(2):
                        if ((x and not y) or (y == z) or not w) == 0:
                            print(x, y, z, w)
    ''', cond=p('Выражение (x ∧ ¬y) ∨ (y ≡ z) ∨ ¬w ложно в трёх строках. По ним видно: w всегда 1, а y и z всегда разные.'),
         k='Уровень 2'),
    code('Проверяем догадку программой', frag_code('(x and not y) or (y == z) or (not w)', 'xyzw',
                                                   fragment('s2', '(x and not y) or (y == z) or (not w)', value=0, rows=2, blanks=2)[0]),
         cond=p('Догадку о порядке столбцов можно проверить перебором всех перестановок — так работает и автоматическое решение (уровень 3). '
                'Пустые клетки фрагмента перебираются отдельно.'), k='Уровень 2', wide=True),
], [
    frag_task('f1', 'Фрагмент: импликация', '(x → y) ∨ (¬z ∧ w)', '(x <= y) or ((not z) and w)', value=0, rows=2, blanks=2, stars=1),
    frag_task('f2', 'Фрагмент: эквивалентность', '((x ≡ y) ∨ ¬(z ≡ w)) ∧ (y → ¬z)', '((x == y) or not (z == w)) and (y <= (not z))', value=0, rows=3, blanks=4),
    frag_task('f3', 'Фрагмент с нулями', '(x ∧ ¬y) ∨ (y ≡ z) ∨ ¬w', '(x and not y) or (y == z) or (not w)', value=0, rows=2, blanks=3),
    frag_task('f4', 'Фрагмент с единицами', '¬(y → (x ≡ w)) ∧ (z → x)', '(not (y <= (x == w))) and (z <= x)', value=1, rows=3, blanks=3),
    frag_task('f5', 'Три множителя', '(w → z) ∧ ¬(x ∨ y) ∨ (z ≡ x)', '((w <= z) and not (x or y)) or (z == x)', value=0, rows=3, blanks=4),
])

L3 = level('Профи: автоматическое решение', 'перестановки столбцов, перебор пустых клеток, различные строки', [
    code('Полный перебор: столбцы и пустые клетки', frag_code('(x <= y) or ((not z) and w)', 'xyzw',
                                                             fragment('s3', '(x <= y) or ((not z) and w)', value=0, rows=3, blanks=3)[0]),
         cond=ol('permutations — все способы сопоставить переменные столбцам (24 для четырёх).',
                 'product([0, 1], repeat=holes) — все способы заполнить пустые клетки.',
                 'Строки после заполнения должны быть различными (фрагмент — из неповторяющихся строк таблицы).',
                 'Подходит, если во всех строках функция даёт указанное значение.'),
         note='Если программа напечатала несколько ответов — вы ошиблись в выражении или забыли условие «строки различны».', nk='warn',
         k='Уровень 3', wide=True),
    code('Как записать фрагмент', '''
        # пустая клетка — None, последнее число — значение F
        frag = [
            (None, 1, 0, None, 0),
            (0, None, 0, 1, 0),
        ]
        print(sum(x is None for r in frag for x in r[:-1]))
    ''', cond=p('Каждая строка — кортеж из значений столбцов и значения F. Число пустых клеток определяет, сколько вариантов заполнения перебрать.'),
         k='Уровень 3'),
], [
    frag_task('a1', 'Четыре пустые клетки', '(x ≡ ¬y) → ((x ∧ w) ≡ z)', '(x == (not y)) <= ((x and w) == z)', value=0, rows=3, blanks=4),
    frag_task('a2', 'Смешанные значения F', '((x ∨ ¬y) → z) ∧ ¬(w ∧ y)', '((x or not y) <= z) and not (w and y)', rows=4, blanks=5, mixed=True, stars=3,
              hint='Здесь у строк разные значения F — программа проверяет каждую строку со своим значением.'),
    frag_task('a3', 'Много пустых', '¬(x → z) ∨ (y ≡ w) ∨ y', '(not (x <= z)) or (y == w) or y', value=0, rows=3, blanks=5, stars=3),
    frag_task('a4', 'Импликация в импликации', '((x → y) → z) ∧ ¬w', '((x <= y) <= z) and not w', value=1, rows=3, blanks=4),
    frag_task('a5', 'Исключающее ИЛИ', '((x ⊕ y) → z) ∧ (w ∨ x)', '((x != y) <= z) and (w or x)', value=0, rows=2, blanks=3),
])

L4 = level('Максимум: пять переменных и сложные фрагменты', 'пять переменных, длинные выражения, фрагменты из одной-двух строк', [
    code('Пять переменных', frag_code('(not (a and b)) and (c <= d) and (e != a)', 'abcde',
                                      fragment('s4', '(not (a and b)) and (c <= d) and (e != a)', 'abcde', value=1, rows=5, blanks=3)[0]),
         cond=p('Тот же код: перестановок уже 120, а пустые клетки перебираются отдельно. Python справляется мгновенно.'), k='Уровень 4', wide=True),
    txt('Когда автоматическое решение спасает', cards([
        ('Мало строк', 'Фрагмент из двух строк вручную разбирать долго — программа перебирает всё сама.'),
        ('Много пустых', 'Пять и больше пустых клеток — 32+ вариантов заполнения, руками не перебрать.'),
        ('Пять переменных', '120 перестановок — только программой.'),
    ]) + callout('На экзамене', 'Держите шаблон в голове: F(...), frag, два цикла, проверка различных строк, all(...). Это 15 строк — 3 минуты.'),
        k='Уровень 4'),
], [
    frag_task('p1', 'Пять переменных', '(a → b) ∧ (b → c) ∧ (c ⊕ d) ∧ (d ∨ e)', '(a <= b) and (b <= c) and (c != d) and (d or e)', nvars='abcde', value=1, rows=4, blanks=4, stars=3),
    frag_task('p2', 'Пять переменных, F = 1', '¬(a ∧ b) ∧ (c → d) ∧ (e ⊕ a)', '(not (a and b)) and (c <= d) and (e != a)', nvars='abcde', value=1, rows=5, blanks=4, stars=3),
    frag_task('p3', 'Две строки', '(x ∧ y) ∨ ((x ∨ z) ≡ w)', '(x and y) or ((x or z) == w)', value=0, rows=2, blanks=3, stars=2),
    frag_task('p4', 'Эквивалентности и импликация', '((x ≡ y) → (z ≡ w)) ∧ (w → x)', '((x == y) <= (z == w)) and (w <= x)', value=0, rows=3, blanks=4, stars=3),
])

MODULE = module('m02', 'Таблицы истинности', '⚖️', 'Логика на Python: перебор наборов, фрагменты таблиц, автоматический подбор столбцов',
                [L1, L2, L3, L4], n=2)
