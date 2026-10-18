from _dsl import *  # noqa: F403

ORDER = 24


def letters(n, alpha, runs=0, run_len=(5, 40), weights=None):
    """Одна длинная строка из букв alpha; runs — сколько длинных серий одного символа вставить."""
    def gen(rng):
        s = rng.choices(alpha, weights=weights, k=n)
        for _ in range(runs):
            i = rng.randrange(n - run_len[1])
            ch = rng.choice(alpha)
            for j in range(i, i + rng.randint(*run_len)):
                s[j] = ch
        return ''.join(s) + '\n'
    return gen


def rare_letters(n):
    """Частые буквы A…T и редкие U…Z: каждая редкая встречается 1–5 раз."""
    def gen(rng):
        s = rng.choices('ABCDEFGHIJKLMNOPQRST', k=n)
        for ch in 'UVWXYZ':
            for _ in range(rng.randint(1, 5)):
                s[rng.randrange(n)] = ch
        return ''.join(s) + '\n'
    return gen


def expr_text(n):
    def gen(rng):
        out = []
        while len(out) < n:
            r = rng.random()
            if r < 0.55:
                out.append(rng.choice('0123456789'))
            elif r < 0.7:
                out.append(rng.choice('+*'))
            else:
                out.append(rng.choice('ABCDEF'))
        return ''.join(out[:n]) + '\n'
    return gen


L1 = level('База: строка из файла', 'readline и strip, самая длинная серия одинаковых символов, подсчёты', [
    title('Задание 24', 'Огромная строка из файла: серии, подстроки, окна и регулярные выражения',
          chips=['readline().strip()', 'cur / best', 'split', 're']),
    code('Читаем строку', '''
        s = open('24.txt').readline().strip()
        print(len(s), s[:20])
        print(s.count('X'), s.count('XY'))
    ''', cond=p('В файле одна строка. strip() убирает перевод строки в конце — иначе он попадёт в подсчёты.'),
         files={'24.txt': 'XXYZZZXYXXXX\n'}, k='Уровень 1'),
    code('Самая длинная серия', '''
        s = open('24.txt').readline().strip()
        best = cur = 1
        for i in range(1, len(s)):
            if s[i] == s[i - 1]:
                cur += 1
                best = max(best, cur)
            else:
                cur = 1
        print(best)
    ''', cond=p('cur — длина текущей серии, best — рекорд. Символ совпал с предыдущим — серия растёт, иначе начинается заново с 1.'),
         files={'24.txt': 'XXYZZZXYXXXX\n'}, k='Уровень 1'),
    code('Серия конкретного символа — через split', '''
        s = open('24.txt').readline().strip()
        print(max(len(part) for part in s.replace('Y', ' ').replace('Z', ' ').split()))
    ''', cond=p('Всё, что не X, заменяем пробелами и режем: кусочки — серии из X. Длиннейший кусок — ответ.'),
         files={'24.txt': 'XXYZZZXYXXXX\n'}, k='Уровень 1'),
], [
    task('run', 'Длиннейшая серия',
         p('В файле <b>24.txt</b> — строка из символов X, Y, Z. Найдите длину самой длинной последовательности одинаковых символов, идущих подряд.'),
         '''
s = open('24.txt').readline().strip()
best = cur = 1
for i in range(1, len(s)):
    cur = cur + 1 if s[i] == s[i - 1] else 1
    best = max(best, cur)
print(best)''', files={'24.txt': letters(120000, 'XYZ', runs=30)}),
    task('runz', 'Серия из Z',
         p('Файл <b>24.txt</b> — строка из символов X, Y, Z. Найдите длину самой длинной последовательности, состоящей только из символов Z.'),
         '''
s = open('24.txt').readline().strip()
print(max(len(p) for p in s.replace('X', ' ').replace('Y', ' ').split()))''', files={'24.txt': letters(120000, 'XYZ', runs=30)}),
    task('count', 'Сколько пар',
         p('Файл <b>24.txt</b> — строка из букв A…F. Сколько раз встречается пара символов «AB» (подряд)? И сколько раз — «BB» с учётом перекрытий '
           '(в BBB две пары)? Запишите два числа через пробел.'),
         '''
s = open('24.txt').readline().strip()
ab = s.count('AB')
bb = sum(1 for i in range(len(s) - 1) if s[i] == s[i + 1] == 'B')
print(ab, bb)''', files={'24.txt': letters(100000, 'ABCDEF')},
         hint="count не считает перекрытия: 'BBB'.count('BB') == 1. Для перекрывающихся — цикл по позициям."),
    task('most', 'Чаще всего после',
         p('Файл <b>24.txt</b> — строка из букв A…F. Определите, какая буква чаще всего встречается сразу после буквы A. '
           'Если таких несколько — укажите ближайшую к началу алфавита.'),
         '''
s = open('24.txt').readline().strip()
cnt = {}
for i in range(len(s) - 1):
    if s[i] == 'A':
        cnt[s[i + 1]] = cnt.get(s[i + 1], 0) + 1
best = max(cnt.values())
print(min(c for c in cnt if cnt[c] == best))''', files={'24.txt': letters(100000, 'ABCDEF', weights=[3, 2, 2, 1, 1, 1])}),
])

L2 = level('Стандарт: подстроки с условием', 'без определённых символов, чередование, длина через split и замены', [
    code('Не содержит пары', '''
        s = open('24.txt').readline().strip()
        best = cur = 1
        for i in range(1, len(s)):
            if s[i - 1:i + 1] == 'XZ':
                cur = 1                # пара XZ — подстроку надо разорвать между X и Z
            else:
                cur += 1
            best = max(best, cur)
        print(best)
    ''', cond=p('«Подстрока не содержит XZ»: идём по строке и рвём текущую подстроку ровно между X и Z — Z начинает новую с длиной 1.'),
         note='Типичная ошибка: разорвать перед X. Тогда X потеряется у одной из подстрок и длина выйдет на 1 меньше.', nk='warn',
         files={'24.txt': 'YXZZYXXZY\n'}, k='Уровень 2'),
    code('Чередование', '''
        s = open('24.txt').readline().strip()
        best = cur = 1
        for i in range(1, len(s)):
            ok = (s[i - 1] in 'AEIOU') != (s[i] in 'AEIOU')
            cur = cur + 1 if ok else 1
            best = max(best, cur)
        print(best)
    ''', cond=p('«Гласные и согласные чередуются» — соседи разного типа. Та же схема cur/best, меняется только условие продолжения.'),
         files={'24.txt': 'BABEKOTTAPI\n'}, k='Уровень 2'),
], [
    task('noxz', 'Без XZ',
         p('Файл <b>24.txt</b> — строка из X, Y, Z. Найдите максимальную длину подстроки, не содержащей подстроку XZ.'),
         '''
s = open('24.txt').readline().strip()
best = cur = 1
for i in range(1, len(s)):
    cur = 1 if s[i - 1:i + 1] == 'XZ' else cur + 1
    best = max(best, cur)
print(best)''', files={'24.txt': letters(120000, 'XYZ', weights=[1, 8, 1])}),
    task('alt', 'Чередование гласных',
         p('Файл <b>24.txt</b> — строка из заглавных латинских букв. Найдите длину самой длинной подстроки, в которой гласные (A, E, I, O, U, Y) '
           'и согласные чередуются.'),
         '''
s = open('24.txt').readline().strip()
V = set('AEIOUY')
best = cur = 1
for i in range(1, len(s)):
    cur = cur + 1 if (s[i - 1] in V) != (s[i] in V) else 1
    best = max(best, cur)
print(best)''', files={'24.txt': letters(120000, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')}),
    task('nod', 'Без буквы D',
         p('Файл <b>24.txt</b> — строка из A…F. Найдите длину самой длинной подстроки, в которой нет буквы D, но есть хотя бы одна буква A.'),
         '''
s = open('24.txt').readline().strip()
print(max(len(p) for p in s.split('D') if 'A' in p))''', files={'24.txt': letters(150000, 'ABCDEF', weights=[1, 4, 4, 2, 4, 4])},
         hint="split('D') — куски без D. Отбираем куски с A."),
    task('xyz', 'Повтор XYZ',
         p('Файл <b>24.txt</b> — строка из X, Y, Z. Найдите длину самой длинной подстроки вида XYZXYZXYZ… — '
           'то есть подстроки, где за X всегда идёт Y, за Y — Z, за Z — X (начинаться она может с любого из трёх символов).'),
         '''
s = open('24.txt').readline().strip()
nxt = {'X': 'Y', 'Y': 'Z', 'Z': 'X'}
best = cur = 1
for i in range(1, len(s)):
    cur = cur + 1 if s[i] == nxt[s[i - 1]] else 1
    best = max(best, cur)
print(best)''', files={'24.txt': letters(120000, 'XYZ')}, stars=2),
])

L3 = level('Профи: окно и позиции', 'два указателя: не больше K символов; ровно K вхождений; списки позиций', [
    code('Не больше K букв A — окно', '''
        s = open('24.txt').readline().strip()
        K = 2
        left = cnt = best = 0
        for right, ch in enumerate(s):
            cnt += ch == 'A'
            while cnt > K:
                cnt -= s[left] == 'A'
                left += 1
            best = max(best, right - left + 1)
        print(best)
    ''', cond=p('Окно [left; right] двигаем вправо. Стало слишком много A — сдвигаем левый край, пока снова не станет можно. '
                'Каждый символ входит и выходит из окна один раз — это быстро даже для миллиона символов.'),
         files={'24.txt': 'BAACABBBACAB\n'}, k='Уровень 3'),
    code('Через позиции символа', '''
        s = open('24.txt').readline().strip()
        pos = [-1] + [i for i, ch in enumerate(s) if ch == 'A'] + [len(s)]
        K = 2
        best = max(pos[i + K + 1] - pos[i] - 1 for i in range(len(pos) - K - 1))
        print(best)
    ''', cond=p('Самая длинная подстрока ровно с K буквами A тянется от позиции после одной A до позиции перед (K + 1)-й следующей. '
                'Фиктивные позиции −1 и len(s) — края строки.'),
         files={'24.txt': 'BAACABBBACAB\n'}, k='Уровень 3'),
], [
    task('k3', 'Не больше трёх',
         p('Файл <b>24.txt</b> — строка из A…F. Найдите длину самой длинной подстроки, в которой буква E встречается не более 3 раз.'),
         '''
s = open('24.txt').readline().strip()
left = cnt = best = 0
for right, ch in enumerate(s):
    cnt += ch == 'E'
    while cnt > 3:
        cnt -= s[left] == 'E'
        left += 1
    best = max(best, right - left + 1)
print(best)''', files={'24.txt': letters(150000, 'ABCDEF')}),
    task('exact', 'Ровно 90',
         p('Файл <b>24.txt</b> — строка из символов W, 2, 0, 5. Найдите длину самой длинной подстроки, которая содержит ровно 90 букв W.'),
         '''
s = open('24.txt').readline().strip()
pos = [-1] + [i for i, ch in enumerate(s) if ch == 'W'] + [len(s)]
K = 90
print(max(pos[i + K + 1] - pos[i] - 1 for i in range(len(pos) - K - 1)))''', files={'24.txt': letters(150000, 'W205', weights=[1, 6, 6, 6])},
         stars=2),
    task('two', 'Два условия',
         p('Файл <b>24.txt</b> — строка из символов W, 2, 0, 5. Найдите длину самой длинной подстроки, которая содержит ровно 20 букв W '
           'и не меньше 60 цифр 0.'),
         '''
s = open('24.txt').readline().strip()
pos = [-1] + [i for i, ch in enumerate(s) if ch == 'W'] + [len(s)]
pre = [0]
for ch in s:
    pre.append(pre[-1] + (ch == '0'))
best = 0
K = 20
for i in range(len(pos) - K - 1):
    l, r = pos[i] + 1, pos[i + K + 1] - 1      # самое длинное окно ровно с K буквами W
    if pre[r + 1] - pre[l] >= 60:
        best = max(best, r - l + 1)
print(best)''', files={'24.txt': letters(150000, 'W205', weights=[1, 5, 5, 5])},
         hint='Префиксные суммы pre[i] — сколько нулей до позиции i. Количество нулей в s[l:r+1] = pre[r+1] − pre[l].', stars=3),
    task('dist', 'Далёкие одинаковые',
         p('Файл <b>24.txt</b> — строка из A…Z. Для каждой буквы найдите расстояние между её первым и последним вхождением (разность позиций). '
           'Найдите наибольшее такое расстояние среди букв, которые встречаются в строке не больше 3 раз.'),
         '''
s = open('24.txt').readline().strip()
first, last, cnt = {}, {}, {}
for i, ch in enumerate(s):
    first.setdefault(ch, i)
    last[ch] = i
    cnt[ch] = cnt.get(ch, 0) + 1
print(max(last[c] - first[c] for c in cnt if cnt[c] <= 3))''',
         files={'24.txt': rare_letters(50000)}, stars=2),
])

L4 = level('Максимум: регулярные выражения', 're: числа без ведущих нулей, арифметические выражения, сопоставление с каждой позиции', [
    code('Регулярное выражение', '''
        import re
        s = '0045+12*7AA300'
        print(re.findall(r'[1-9]\\d*|0', s))
        print(re.fullmatch(r'([1-9]\\d*|0)([+*]([1-9]\\d*|0))*', '12*7+0'))
    ''', cond=ul('[1-9]\\d* — число без ведущих нулей (или просто 0)', '([+*]число)* — «знак и число» сколько угодно раз',
                 'fullmatch — строка целиком подходит под шаблон'), k='Уровень 4'),
    code('Самое длинное корректное выражение', '''
        import re
        s = open('24.txt').readline().strip()
        num = r'(?:[1-9]\\d*|0)'
        pat = re.compile(num + r'(?:[+*]' + num + r')*')
        best = 0
        for i in range(len(s)):
            if s[i].isdigit():
                m = pat.match(s, i)
                if m:
                    best = max(best, m.end() - i)
        print(best)
    ''', cond=p('findall находит не обязательно самые длинные куски: из «00012» он возьмёт «0», «0», «0», «12». Надёжнее — пробовать начало с каждой '
                'позиции: pat.match(s, i) жадно берёт самое длинное выражение от i.'),
         note='Выражение заканчивается на число: «12+» без числа после знака — не выражение. Шаблон это учитывает.', nk='warn',
         files={'24.txt': '0045+12*7AA300+05*0+1\n'}, k='Уровень 4'),
], [
    task('expr', 'Арифметическое выражение',
         p('Файл <b>24.txt</b> содержит строку из цифр, знаков + и * и латинских букв A…F. Найдите длину самой длинной подстроки, '
           'которая является корректным арифметическим выражением: натуральные числа без ведущих нулей или 0, между ними по одному знаку + или *, '
           'начинается и заканчивается числом.'),
         '''
import re
s = open('24.txt').readline().strip()
num = r'(?:[1-9]\\d*|0)'
pat = re.compile(num + r'(?:[+*]' + num + r')*')
best = 0
for i in range(len(s)):
    if s[i].isdigit():
        m = pat.match(s, i)
        if m:
            best = max(best, m.end() - i)
print(best)''', files={'24.txt': expr_text(100000)}, stars=3),
    task('nums', 'Наибольшее число',
         p('Файл <b>24.txt</b> (тот же формат). Найдите наибольшее число без ведущих нулей, которое является подстрокой строки и делится на 5. '
           'В ответ запишите количество цифр в нём.'),
         '''
s = open('24.txt').readline().strip()
best = 0
for block in ''.join(ch if ch.isdigit() else ' ' for ch in s).split():
    i = 0
    while i < len(block) and block[i] == '0':
        i += 1
    rest = block[i:]
    for j in range(len(rest), 0, -1):          # самый длинный префикс, оканчивающийся на 0 или 5
        if rest[j - 1] in '05':
            best = max(best, j)
            break
    if '0' in block[:i + 1]:
        best = max(best, 1)
print(best)''', files={'24.txt': expr_text(100000)}, hint='Внутри блока цифр число начинается с первой ненулевой цифры и должно кончаться на 0 или 5.', stars=3),
    task('evenexpr', 'Только сложение',
         p('Файл <b>24.txt</b> (тот же формат). Найдите длину самой длинной подстроки — корректного выражения, в котором есть только знаки +.'),
         '''
import re
s = open('24.txt').readline().strip()
num = r'(?:[1-9]\\d*|0)'
pat = re.compile(num + r'(?:\\+' + num + r')*')
best = 0
for i in range(len(s)):
    if s[i].isdigit():
        m = pat.match(s, i)
        if m:
            best = max(best, m.end() - i)
print(best)''', files={'24.txt': expr_text(100000)}, stars=2),
])

MODULE = module('m24', 'Обработка строк', '🧵', 'Строка из файла: серии, подстроки с условием, окна, регулярные выражения',
                [L1, L2, L3, L4], n=24)
