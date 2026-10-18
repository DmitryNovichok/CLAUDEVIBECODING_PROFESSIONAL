"""Описание курса «Программирование для ЕГЭ»: модуль → уровни → слайды и задачи.

Каждая задача несёт эталонное решение (code). Сборщик (tools/build_pycourse.py) запускает его
на сгенерированных файлах и берёт ответ из вывода — ответы в курсе не пишутся руками.
Примеры кода на слайдах тоже запускаются: их вывод показывается под кнопкой «Что выведет».
"""
import random
import textwrap


def _code(s):
    return textwrap.dedent(s).strip('\n')


# ------------------------------------------------------------ слайды
def title(h, sub='', chips=(), k='Программирование для ЕГЭ', aside=''):
    return {'t': 'title', 'k': k, 'h': h, 'sub': sub, 'chips': list(chips), 'aside': aside}


def sec(h, sub='', tag='', k='', kc='t1'):
    return {'t': 'section', 'k': k, 'h': h, 'sub': sub, 'tag': tag, 'kc': kc}


def txt(h, html, k='', dark=False, kc=''):
    return {'t': 'text', 'k': k, 'h': h, 'html': html, 'dark': dark, 'kc': kc}


def code(h, src, cond='', note='', nk='secret', k='', ch='Пример', files=None, run=True, stdin='', kc='t1',
         stack=False, wide=False):
    """Пример с кодом: слева пояснение и нюанс, справа программа. files — {имя: текст или функция(rng)}."""
    return {'t': 'code', 'k': k, 'kc': kc, 'h': h, 'ch': ch, 'cond': cond, 'note': note, 'nk': nk,
            'code': _code(src), 'files': files or {}, 'run': run, 'stdin': stdin, 'stack': stack, 'wide': wide}


def codes(h, blocks, k='', run=True):
    """Несколько коротких программ на одном слайде: blocks — [(пояснение, код), ...]."""
    return {'t': 'codes', 'k': k, 'h': h, 'blocks': [{'cond': c, 'code': _code(s)} for c, s in blocks], 'run': run}


# ------------------------------------------------------------ задачи
def task(key, h, cond, src, hint='', stars=1, files=None, ans=None, note='', stdin=''):
    """Задача уровня. key — постоянный ключ (по нему хранится прогресс, менять нельзя).
    src — эталонное решение: печатает ответ. ans — если задан, сборщик сверяет его с выводом."""
    return {'key': key, 'h': h, 'cond': cond, 'code': _code(src), 'hint': hint, 'stars': stars,
            'files': files or {}, 'ans': ans, 'note': note, 'stdin': stdin}


def level(title, goal, slides, tasks, need=None):
    """need — сколько задач уровня решить, чтобы открылся следующий (по умолчанию половина)."""
    return {'title': title, 'goal': goal, 'slides': slides, 'tasks': tasks, 'need': need}


def module(mid, title, icon, sub, levels, n=None, group='ege'):
    return {'id': mid, 'n': n, 'title': title, 'icon': icon, 'sub': sub, 'levels': levels, 'group': group}


# ------------------------------------------------------------ генераторы данных
def nums(count, lo, hi, seed):
    """Файл: по одному целому числу в строке."""
    def gen(rng):
        return '\n'.join(str(rng.randint(lo, hi)) for _ in range(count)) + '\n'
    gen.seed = seed
    return gen


def rng_for(key):
    return random.Random('egeshka-pyc:' + key)


# короткие куски HTML
def p(*parts):
    return ''.join(f'<p>{x}</p>' for x in parts)


def ol(*items):
    return '<ol class="sl-ol">' + ''.join(f'<li>{x}</li>' for x in items) + '</ol>'


def ul(*items):
    return '<ul class="sl-ul">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>'


def tab(head, rows):
    h = ''.join(f'<th>{x}</th>' for x in head)
    b = ''.join('<tr>' + ''.join(f'<td>{x}</td>' for x in r) + '</tr>' for r in rows)
    return f'<table class="sl-tab"><tr>{h}</tr>{b}</table>'


def cards(items, cols=3, cls=''):
    """items — [(заголовок, текст)] или [(заголовок, текст, код)]."""
    out = []
    for it in items:
        t, body = it[0], it[1]
        c = f'<code>{it[2]}</code>' if len(it) > 2 and it[2] else ''
        out.append(f'<div class="sl-card"><b>{t}</b>{c}<p>{body}</p></div>')
    return f'<div class="sl-cards c{cols} {cls}">' + ''.join(out) + '</div>'


def callout(head, body):
    return f'<div class="sl-callout"><b>{head}</b><p>{body}</p></div>'


def c(x):
    """Код в строке текста."""
    return f'<code>{x}</code>'
