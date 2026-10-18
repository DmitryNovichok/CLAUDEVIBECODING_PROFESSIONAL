"""Сборка курса «Программирование для ЕГЭ»: tools/pycourse/m*.py → pycourse/*.json и pycourse/data/.

Запуск: python3 tools/build_pycourse.py [m05 m17 …]   (без аргументов — все модули)

Что делает:
  • генерирует файлы с данными задач (детерминированно: одно и то же при каждой сборке);
  • запускает эталонное решение каждой задачи — его вывод и есть ответ (если в описании задан ans, сверяет);
  • запускает примеры со слайдов и сохраняет их вывод;
  • пишет pycourse/index.json (план курса) и pycourse/<модуль>.json (уроки с ответами — их отдаёт только сервер).
"""
import concurrent.futures as cf
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'pycourse'
OUT = ROOT / 'pycourse'
DATA = OUT / 'data'
sys.path.insert(0, str(SRC))
from _dsl import rng_for  # noqa: E402

SLOW = 12.0        # дольше — предупреждение: в браузере (Pyodide) программа идёт в 2–5 раз медленнее
TIMEOUT = 120
FILE_RE = re.compile(r'^[A-Za-z0-9_.-]{1,60}$')

# заглушка turtle: примеры с черепахой на сервере запускаются без окна
TURTLE_STUB = '''
class _T:
    def __getattr__(self, name):
        return lambda *a, **k: None
_t = _T()
def __getattr__(name):
    return getattr(_t, name)
'''


def load_modules(only):
    mods = []
    for f in sorted(SRC.glob('m*.py')):
        spec = importlib.util.spec_from_file_location(f.stem, f)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        mod = m.MODULE
        if only and mod['id'] not in only:
            continue
        mod['_order'] = getattr(m, 'ORDER', 100)
        mods.append(mod)
    mods.sort(key=lambda x: (x['_order'], x['id']))
    return mods


def file_text(spec, key, name):
    if callable(spec):
        return spec(rng_for(f'{key}/{name}'))
    return spec


def run(src, files, stdin=''):
    """Запуск программы в отдельной папке с файлами. → (вывод, секунды)."""
    with tempfile.TemporaryDirectory() as d:
        for name, text in files.items():
            Path(d, name).write_text(text, encoding='utf-8')
        Path(d, 'turtle.py').write_text(TURTLE_STUB, encoding='utf-8')
        t0 = time.time()
        p = subprocess.run([sys.executable, '-c', src], cwd=d, input=stdin, capture_output=True, text=True,
                           timeout=TIMEOUT, env={**os.environ, 'PYTHONHASHSEED': '0'})
        dt = time.time() - t0
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip()[-1500:])
        return p.stdout, dt


def norm(ans):
    return ' '.join(str(ans).replace(',', ' ').split())


def build(only):
    mods = load_modules(only)
    OUT.mkdir(exist_ok=True)
    DATA.mkdir(exist_ok=True)
    jobs, seen = [], set()
    for mod in mods:
        mid = mod['id']
        for li, lv in enumerate(mod['levels']):
            for si, sl in enumerate(lv['slides']):
                if sl['t'] == 'code' and sl.get('run', True):
                    jobs.append(('slide', mod, li, si, None, sl))
                if sl['t'] == 'codes' and sl.get('run', True):
                    for bi, b in enumerate(sl['blocks']):
                        jobs.append(('block', mod, li, si, bi, b))
            for tk in lv['tasks']:
                tid = f"{mid}.{tk['key']}"
                if tid in seen:
                    raise SystemExit(f'повтор ключа задачи {tid}')
                seen.add(tid)
                jobs.append(('task', mod, li, None, None, tk))

    def work(job):
        kind, mod, li, si, bi, obj = job
        mid = mod['id']
        key = f"{mid}.{obj['key']}" if kind == 'task' else f'{mid}.L{li + 1}.S{si + 1}' + (f'.B{bi + 1}' if bi is not None else '')
        files = {name: file_text(spec, key, name) for name, spec in (obj.get('files') or {}).items()}
        if 'turtle' in obj['code'] and kind != 'task':
            return job, key, files, '', 0.0, None           # рисунок черепахи — вывода нет
        try:
            out, dt = run(obj['code'], files, obj.get('stdin', ''))
        except Exception as e:  # noqa: BLE001
            return job, key, files, None, 0.0, str(e)
        return job, key, files, out, dt, None

    errors, slow = [], []
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        results = list(ex.map(work, jobs))
    for job, key, files, out, dt, err in results:
        kind, mod, li, si, bi, obj = job
        if err:
            errors.append(f'{key}: {err}')
            continue
        if dt > SLOW:
            slow.append(f'{key}: {dt:.1f} с')
        if kind == 'task':
            got = out.strip()
            if not got:
                errors.append(f'{key}: эталон ничего не напечатал')
                continue
            if obj.get('ans') is not None and norm(obj['ans']) != norm(got):
                errors.append(f'{key}: ответ в описании {obj["ans"]!r}, а программа печатает {got!r}')
                continue
            obj['_ans'] = got
            obj['_sec'] = round(dt, 2)
            obj['_files'] = files
        else:
            o = out.rstrip('\n')
            if len(o) > 900:
                o = o[:900] + '\n…'
            obj['out'] = o
            obj['_files'] = files
    if errors:
        print('ОШИБКИ:\n  ' + '\n  '.join(errors))
        raise SystemExit(1)

    # файлы данных: pycourse/data/<ключ задачи или слайда>/<имя>
    index = []
    for mod in mods:
        mid = mod['id']
        mdir = DATA / mid
        if mdir.exists():
            shutil.rmtree(mdir)
        levels_out, idx_levels = [], []
        for li, lv in enumerate(mod['levels']):
            slides = []
            for si, sl in enumerate(lv['slides']):
                s = {k: v for k, v in sl.items() if k not in ('_files', 'files', 'run', 'stdin') and v not in ('', None, False, [], {})}
                if sl['t'] == 'code' and max(map(len, sl['code'].split('\n'))) > 44:
                    s['wide'] = True            # длинные строки кода — колонке с кодом нужно больше места
                if sl.get('_files'):
                    s['files'] = save_files(mdir, f'L{li + 1}S{si + 1}', sl['_files'], mid)
                if sl['t'] == 'codes':
                    s['blocks'] = [{k: v for k, v in b.items() if k not in ('_files',)} for b in sl['blocks']]
                slides.append(s)
            tasks = []
            for tk in lv['tasks']:
                tid = f"{mid}.{tk['key']}"
                t = {'id': tid, 'h': tk['h'], 'cond': tk['cond'], 'stars': tk['stars'], 'ans': tk['_ans'], 'sol': tk['code'],
                     'sec': tk['_sec']}
                if tk['hint']:
                    t['hint'] = tk['hint']
                if tk['note']:
                    t['note'] = tk['note']
                if tk['_files']:
                    t['files'] = save_files(mdir, tk['key'], tk['_files'], mid)
                tasks.append(t)
            need = lv['need'] if lv['need'] is not None else (len(tasks) + 1) // 2
            levels_out.append({'title': lv['title'], 'goal': lv['goal'], 'need': need, 'slides': slides, 'tasks': tasks})
            idx_levels.append({'title': lv['title'], 'goal': lv['goal'], 'need': need, 'tasks': [t['id'] for t in tasks],
                               'slides': len(slides)})
        doc = {'id': mid, 'n': mod['n'], 'title': mod['title'], 'icon': mod['icon'], 'sub': mod['sub'], 'levels': levels_out}
        (OUT / f'{mid}.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding='utf-8')
        index.append({'id': mid, 'n': mod['n'], 'title': mod['title'], 'icon': mod['icon'], 'sub': mod['sub'],
                      'group': mod['group'], 'levels': idx_levels})
    if only:                                    # частичная сборка: остальные модули в плане оставляем как были
        old = json.loads((OUT / 'index.json').read_text(encoding='utf-8')) if (OUT / 'index.json').exists() else []
        new = {m['id']: m for m in index}
        merged = [new.pop(m['id'], m) for m in old] + list(new.values())
        index = merged
    else:
        keep = {m['id'] for m in mods}
        for f in OUT.glob('m*.json'):
            if f.stem not in keep:
                f.unlink()
        for d in DATA.iterdir():
            if d.is_dir() and d.name not in keep:
                shutil.rmtree(d)
    (OUT / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding='utf-8')
    nt = sum(len(lv['tasks']) for m in index for lv in m['levels'])
    print(f'готово: {len(mods)} модулей, {nt} задач всего в плане, {time.time() - t0:.0f} с')
    for s in slow:
        print('  медленно:', s)


def save_files(mdir, sub, files, mid):
    out = []
    for name, text in files.items():
        if not FILE_RE.match(name):
            raise SystemExit(f'плохое имя файла {name!r}')
        d = mdir / sub
        d.mkdir(parents=True, exist_ok=True)
        (d / name).write_text(text, encoding='utf-8')
        h = hashlib.sha1(text.encode()).hexdigest()[:8]
        out.append({'name': name, 'url': f'pyc-data/{mid}/{sub}/{name}?v={h}', 'size': len(text.encode())})
    return out


if __name__ == '__main__':
    build(set(sys.argv[1:]))
