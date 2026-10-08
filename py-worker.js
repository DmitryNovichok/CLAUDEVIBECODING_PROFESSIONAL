/* Egeshka: Python в браузере (Pyodide) в отдельном потоке — бесконечный цикл не вешает страницу,
   кнопка «Стоп» просто завершает поток.
   Сообщения: { type: 'run', code, files: [{ name, url }], stdin } → { type: 'out' | 'err', text },
   { type: 'turtle', ops }, { type: 'done', ok, ms }, { type: 'ready' }, { type: 'status', text }. */
/* global loadPyodide */
'use strict';

const PYODIDE_VERSION = '0.28.3';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
// ?local=1 — Pyodide лежит на самом сервере в vendor/pyodide (школьная сеть может не пускать на CDN)
const SOURCES = /[?&]local=1/.test(self.location.search) ? [new URL('vendor/pyodide/', self.location.href).href, CDN] : [CDN];

// Черепашка для №6: стандартный turtle требует tkinter, которого в браузере нет.
// Эта версия запоминает линии и точки, а рисует их страница.
const TURTLE_PY = String.raw`
import math as _m

_ops = []
_LIMIT = 400000
_state = {'tracer': 1}


def _add(op):
    if len(_ops) < _LIMIT:
        _ops.append(op)


class Turtle:
    def __init__(self, *a, **k):
        self._x = 0.0
        self._y = 0.0
        self._h = 0.0
        self._down = True
        self._color = '#2b6cff'
        self._fill = '#2b6cff'
        self._w = 1
        self._poly = None
        self._visible = True

    # движение
    def forward(self, d):
        self._move(self._x + d * _m.cos(_m.radians(self._h)), self._y + d * _m.sin(_m.radians(self._h)))
    fd = forward

    def backward(self, d):
        self.forward(-d)
    back = bk = backward

    def right(self, a):
        self._h = (self._h - a) % 360
    rt = right

    def left(self, a):
        self._h = (self._h + a) % 360
    lt = left

    def goto(self, x, y=None):
        if y is None:
            x, y = x
        self._move(float(x), float(y))
    setpos = setposition = goto

    def setx(self, x):
        self._move(float(x), self._y)

    def sety(self, y):
        self._move(self._x, float(y))

    def setheading(self, a):
        self._h = a % 360
    seth = setheading

    def home(self):
        self._move(0.0, 0.0)
        self._h = 0.0

    def circle(self, r, extent=360, steps=None):
        steps = steps or max(12, int(abs(extent) / 6))
        step = extent / steps
        length = 2 * _m.pi * abs(r) * abs(extent) / 360 / steps
        for _ in range(steps):
            self.left(step / 2 if r > 0 else -step / 2)
            self.forward(length)
            self.left(step / 2 if r > 0 else -step / 2)

    def _move(self, x, y):
        if self._down:
            _add(('l', self._x, self._y, x, y, self._color, self._w))
        if self._poly is not None:
            self._poly.append((x, y))
        self._x, self._y = x, y

    # перо
    def penup(self):
        self._down = False
    pu = up = penup

    def pendown(self):
        self._down = True
    pd = down = pendown

    def isdown(self):
        return self._down

    def pensize(self, w=None):
        if w is None:
            return self._w
        self._w = w
    width = pensize

    def pencolor(self, *c):
        if c:
            self._color = _col(c)
        return self._color

    def fillcolor(self, *c):
        if c:
            self._fill = _col(c)
        return self._fill

    def color(self, *c):
        if len(c) == 2:
            self._color, self._fill = _col((c[0],)), _col((c[1],))
        elif c:
            self._color = self._fill = _col(c)
        return self._color, self._fill

    def begin_fill(self):
        self._poly = [(self._x, self._y)]

    def end_fill(self):
        if self._poly and len(self._poly) > 2:
            _add(('f', self._poly, self._fill))
        self._poly = None

    def dot(self, size=None, *c):
        _add(('d', self._x, self._y, size or max(self._w + 4, 2 * self._w), _col(c) if c else self._color))

    def write(self, text, *a, **k):
        _add(('t', self._x, self._y, str(text), self._color))

    # состояние
    def position(self):
        return (round(self._x, 6), round(self._y, 6))
    pos = position

    def xcor(self):
        return self._x

    def ycor(self):
        return self._y

    def heading(self):
        return self._h

    def distance(self, x, y=None):
        if y is None:
            x, y = x
        return _m.hypot(self._x - x, self._y - y)

    # ничего не делают в браузере
    def speed(self, *a, **k): pass
    def hideturtle(self): self._visible = False
    ht = hideturtle
    def showturtle(self): self._visible = True
    st = showturtle
    def shape(self, *a, **k): pass
    def shapesize(self, *a, **k): pass
    def clear(self): _ops.clear()
    def reset(self):
        _ops.clear()
        self.__init__()


def _col(c):
    if not c:
        return '#2b6cff'
    if len(c) == 1:
        c = c[0]
    if isinstance(c, (tuple, list)):
        r, g, b = c[:3]
        if max(r, g, b) <= 1:
            r, g, b = r * 255, g * 255, b * 255
        return '#%02x%02x%02x' % (int(r), int(g), int(b))
    return str(c)


class _Screen:
    def tracer(self, *a, **k): pass
    def update(self): pass
    def screensize(self, *a, **k): pass
    def setup(self, *a, **k): pass
    def bgcolor(self, *a, **k): pass
    def title(self, *a, **k): pass
    def delay(self, *a, **k): pass
    def mainloop(self): pass
    done = exitonclick = mainloop
    def setworldcoordinates(self, *a, **k): pass
    def onclick(self, *a, **k): pass
    def listen(self): pass


_screen = _Screen()
_t = Turtle()


def Screen():
    return _screen


Pen = RawTurtle = Turtle
for _name in ('forward', 'fd', 'backward', 'back', 'bk', 'right', 'rt', 'left', 'lt', 'goto', 'setpos', 'setposition',
              'setx', 'sety', 'setheading', 'seth', 'home', 'circle', 'penup', 'pu', 'up', 'pendown', 'pd', 'down',
              'isdown', 'pensize', 'width', 'pencolor', 'fillcolor', 'color', 'begin_fill', 'end_fill', 'dot', 'write',
              'position', 'pos', 'xcor', 'ycor', 'heading', 'distance', 'speed', 'hideturtle', 'ht', 'showturtle', 'st',
              'shape', 'shapesize', 'clear', 'reset'):
    globals()[_name] = getattr(_t, _name)
for _name in ('tracer', 'update', 'screensize', 'setup', 'bgcolor', 'title', 'delay', 'mainloop', 'done',
              'exitonclick', 'setworldcoordinates', 'onclick', 'listen'):
    globals()[_name] = getattr(_screen, _name)
`;

// functools.lru_cache написан на C: в браузере его рекурсия съедает стек уже на нескольких сотнях уровней
// и роняет Python. Та же функция на чистом Python держит 10 000+ уровней — как обычная рекурсия (№16, 23).
const CACHE_PY = String.raw`
import functools as _ft

_MARK = object()


def lru_cache(maxsize=128, typed=False):
    def deco(f):
        memo = {}

        def wrapper(*a, **k):
            key = a + (_MARK,) + tuple(sorted(k.items())) if k else a
            try:
                return memo[key]
            except KeyError:
                pass
            r = memo[key] = f(*a, **k)
            return r
        wrapper.cache_clear = memo.clear
        wrapper.cache_info = lambda: 'CacheInfo(currsize=%d)' % len(memo)
        wrapper.__wrapped__ = f
        for attr in ('__name__', '__qualname__', '__doc__', '__module__'):
            try:
                setattr(wrapper, attr, getattr(f, attr))
            except AttributeError:
                pass
        return wrapper
    if callable(maxsize) and not isinstance(maxsize, bool):     # @lru_cache без скобок
        return deco(maxsize)
    return deco


def cache(f):
    return lru_cache(None)(f)


_ft.lru_cache = lru_cache
_ft.cache = cache
`;

let pyodide = null;
let broken = false;
const fileCache = new Map();          // url → байты (файлы задания скачиваем один раз)

async function boot() {
  let lastErr = null;
  for (const base of SOURCES) {
    try {
      importScripts(base + 'pyodide.js');
      self.postMessage({ type: 'status', text: 'Загружаю Python…' });
      pyodide = await loadPyodide({ indexURL: base });
      break;
    } catch (e) { lastErr = e; }
  }
  if (!pyodide) throw lastErr || new Error('Pyodide не загрузился');
  pyodide.FS.mkdirTree('/egeshka');
  pyodide.FS.writeFile('/egeshka/turtle.py', TURTLE_PY);
  pyodide.runPython("import sys, os; sys.path.insert(0, '/egeshka'); os.makedirs('/home/pyodide', exist_ok=True); os.chdir('/home/pyodide')");
  pyodide.runPython(CACHE_PY);
}
const ready = boot().then(() => self.postMessage({ type: 'ready', version: pyodide.version }),
  e => { self.postMessage({ type: 'err', text: 'Не удалось загрузить Python: ' + (e && e.message || e) + '\n' }); self.postMessage({ type: 'done', ok: false, ms: 0 }); });

function chunker(type) {
  let buf = '', size = 0, cut = false;
  const flush = () => { if (buf) { self.postMessage({ type, text: buf }); buf = ''; } };
  return {
    write(s) {
      if (cut) return;
      size += s.length;
      if (size > 300000) { cut = true; buf += '\n… вывод обрезан (больше 300 000 символов)\n'; flush(); return; }
      buf += s;
      if (buf.length > 4000) flush();
    },
    flush,
  };
}

self.onmessage = async ev => {
  const msg = ev.data;
  if (msg.type !== 'run') return;
  await ready;
  if (!pyodide || broken) return;
  const t0 = performance.now();
  const out = chunker('out'), err = chunker('err');
  pyodide.setStdout({ batched: s => out.write(s + '\n') });
  pyodide.setStderr({ batched: s => err.write(s + '\n') });
  const lines = String(msg.stdin || '').split('\n');
  let li = 0;
  pyodide.setStdin({ stdin: () => (li < lines.length ? lines[li++] : undefined), autoEOF: true });
  let ok = true;
  try {
    for (const f of msg.files || []) {
      if (!fileCache.has(f.url)) {
        try {
          const r = await fetch(f.url, { credentials: 'same-origin' });
          if (!r.ok) throw new Error(String(r.status));
          fileCache.set(f.url, new Uint8Array(await r.arrayBuffer()));
        } catch (e) {
          err.write(`Файл ${f.name} не удалось загрузить (${e.message}) — open('${f.name}') не сработает.\n`);
          continue;
        }
      }
      pyodide.FS.writeFile('/home/pyodide/' + f.name, fileCache.get(f.url));
    }
    // каждый запуск — с чистого листа: свои переменные, своя черепашка
    pyodide.runPython("import os, sys; os.chdir('/home/pyodide'); sys.modules.pop('turtle', None)");
    const ns = pyodide.globals.get('dict')();
    ns.set('__name__', '__main__');
    await pyodide.runPythonAsync(msg.code, { globals: ns, filename: 'solution.py' });
    ns.destroy();
  } catch (e) {
    ok = false;
    if (!(e && e.type)) {                       // не ошибка Python, а падение самого интерпретатора
      broken = true;
      out.flush();
      err.write('Python аварийно остановился: ' + String(e && e.message || e) + '\n'
        + (/stack/i.test(String(e && e.message)) ? 'Скорее всего, рекурсия слишком глубокая для браузера. Помогает заполнить кеш '
          + 'снизу вверх: for i in range(1, N): f(i) — и только потом print(f(N)).\n' : ''));
      err.flush();
      self.postMessage({ type: 'done', ok: false, ms: Math.round(performance.now() - t0), fatal: true });
      return;
    }
    const text = String(e && e.message || e);
    // из трассировки убираем внутренности Pyodide — остаётся то, что относится к коду ученика
    const i = text.indexOf('File "solution.py"');
    err.write(i >= 0 ? 'Traceback (most recent call last):\n  ' + text.slice(i) : text + '\n');
  }
  out.flush();
  err.flush();
  try {
    const t = pyodide.runPython("import sys; m = sys.modules.get('turtle'); m._ops if m and hasattr(m, '_ops') else None");
    if (t) {
      const ops = t.toJs({ create_proxies: false });
      t.destroy();
      if (ops.length) self.postMessage({ type: 'turtle', ops });
    }
  } catch (e) { /* черепашки не было */ }
  self.postMessage({ type: 'done', ok, ms: Math.round(performance.now() - t0) });
};
