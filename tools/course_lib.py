"""Общий сборщик презентаций раздела «Курс» (№15, 23–27): tools/course_<n>.py → course/<n>.json и course/data/<n>/.

Каждая программа со слайда выполняется здесь же, рядом со своими файлами данных; в слайд попадает то, что она
действительно напечатала. Если автор урока указал ожидаемый ответ — сборка падает при расхождении."""
import contextlib
import hashlib
import io
import json
import os
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Lesson:
    def __init__(self, n, title):
        self.n, self.title = n, title
        self.codes = {}                 # ключ → (ответ, код, [файлы])
        self.data = {}                  # имя файла → текст

    # ---------------------------------------------------------------- данные и программы
    def file(self, name, text):
        """Файл данных урока: лежит рядом с кодом ученика, как на экзамене."""
        self.data[name] = text
        return name

    def code(self, key, src, want=None, files=()):
        """Запускает программу со слайда и запоминает её вывод как ответ."""
        src = src.strip('\n')
        tmp = tempfile.mkdtemp()
        old = os.getcwd()
        try:
            for name in files:
                Path(tmp, name).write_text(self.data[name], encoding='utf-8')
            os.chdir(tmp)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                exec(compile(src, f'<урок {self.n}: {key}>', 'exec'), {'__name__': '__main__'})
        finally:
            os.chdir(old)
            shutil.rmtree(tmp, ignore_errors=True)
        got = out.getvalue().strip()
        assert got, f'{key}: программа ничего не напечатала'
        assert len(got) < 400 and got.count('\n') < 12, f'{key}: слишком длинный вывод: {got[:120]}'
        if want is not None:
            assert got == str(want), f'{key}: ожидали {want}, программа даёт {got}'
        self.codes[key] = (got, src, list(files))
        return got

    def ans(self, key):
        return self.codes[key][0]

    def _files(self, key):
        out = []
        for name in self.codes[key][2]:
            h = hashlib.sha1(self.data[name].encode()).hexdigest()[:8]
            out.append({'name': name, 'url': f'course-data/{self.n}/{name}?v={h}'})
        return out

    # ---------------------------------------------------------------- слайды
    def cs(self, key, cond, note='', h='', k='', kc='t1', nk='secret', ch='Задание', wide=False):
        """Слайд «условие слева — программа справа»."""
        got, src, _ = self.codes[key]
        sl = {'t': 'code', 'k': k, 'kc': kc, 'h': h, 'ch': ch, 'cond': cond, 'note': note, 'nk': nk, 'code': src, 'sub': ''}
        sl['out' if '\n' in got else 'ans'] = got          # несколько строк — показываем как вывод программы
        if wide:
            sl['wide'] = True
        if self._files(key):
            sl['files'] = self._files(key)
        return sl

    def block(self, key, cond):
        got, src, _ = self.codes[key]
        b = {'cond': cond, 'code': src, ('out' if '\n' in got else 'ans'): got}
        if self._files(key):
            b['files'] = self._files(key)
        return b

    def write(self, slides):
        for sl in slides:
            assert sl.get('t') in ('title', 'section', 'text', 'code', 'codes', 'solve'), sl
            assert sl.get('h'), sl
        used = {f['name'] for sl in slides for f in sl.get('files', [])} | \
               {f['name'] for sl in slides for b in sl.get('blocks', []) for f in b.get('files', [])}
        ddir = ROOT / 'course' / 'data' / str(self.n)
        if ddir.exists():
            shutil.rmtree(ddir)
        if used:
            ddir.mkdir(parents=True)
            for name in sorted(used):
                (ddir / name).write_text(self.data[name], encoding='utf-8')
        dst = ROOT / 'course' / f'{self.n}.json'
        dst.write_text(json.dumps({'n': self.n, 'title': self.title, 'slides': slides}, ensure_ascii=False, indent=1), encoding='utf-8')
        print(f'№{self.n}: {len(slides)} слайдов, программ проверено: {len(self.codes)}, файлов: {len(used)} → {dst.name}')


# ---------------------------------------------------------------- готовые куски вёрстки
def card(title, body, tag='', cls='', code=''):
    return (f'<div class="sl-card {cls}">' + (f'<i class="{cls or "t1"}">{tag}</i>' if tag else '') + f'<b>{title}</b>'
            + (f'<code>{code}</code>' if code else '') + f'<p>{body}</p></div>')


def cards(items, cols=3, cls=''):
    return f'<div class="sl-cards c{cols} {cls}">' + ''.join(items) + '</div>'


def stats(*pairs):
    return '<div class="sl-stats">' + ''.join(f'<div><b>{b}</b><span>{s}</span></div>' for b, s in pairs) + '</div>'


def cols(*pairs):
    return '<div class="sl-cols">' + ''.join(f'<div><h4>{h}</h4><p>{p}</p></div>' for h, p in pairs) + '</div>'


def steps(*items, dark=None):
    return '<div class="sl-steps">' + ''.join(
        ('<div class="dark">' if i == dark else '<div>') + f'<i>{i + 1}</i><b>{b}</b><span>{s}</span></div>' for i, (b, s) in enumerate(items)) + '</div>'


def callout(title, body, dark=False):
    return f'<div class="sl-callout{" dark" if dark else ""}"><b>{title}</b><p>{body}</p></div>'


def table(head, rows):
    return ('<table class="sl-tab"><tr>' + ''.join(f'<th>{h}</th>' for h in head) + '</tr>'
            + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows) + '</table>')


def bad(*items):
    return '<ul class="sl-bad">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>'


def ul(*items):
    return '<ul class="sl-ul">' + ''.join(f'<li>{x}</li>' for x in items) + '</ul>'


def note(text):
    return f'<p class="sl-note">{text}</p>'


def answers(items):
    """Тёмный слайд с ответами: [(подпись, ответ, пояснение, цвет)]."""
    return '<div class="sl-cards c%d answers">' % min(5, len(items)) + ''.join(
        f'<div class="sl-card {c}"><i>{t}</i><b>{a}</b><p>{p}</p></div>' for t, a, p, c in items) + '</div>'
