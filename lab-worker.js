/* Отдельный Python-поток лаборатории. Трассировка не меняет обычный редактор. */
'use strict';
importScripts('py-worker.js');

// Тот же код проверяется в tests/test_lab_trace.py на обычном CPython.
const LAB_TRACE_PY = String.raw`
import sys as _lab_sys
import io as _lab_io
import json as _lab_json
import traceback as _lab_tb

def _lab_run(source, stdin=''):
    filename = '<egeshka-lab>'
    steps = []
    limit = 600
    class TraceLimit(BaseException):
        pass
    class Output(_lab_io.StringIO):
        truncated = False
        def write(self, text):
            left = max(0, 6000 - self.tell())
            if len(text) > left:
                self.truncated = True
            super().write(text[:left])
            return len(text)
    out = Output()
    def describe(value, depth=0):
        t = type(value)
        if t is str:
            return repr(value[:100]) + ('…' if len(value) > 100 else '')
        if t in (int, float, bool, type(None), complex):
            if t is int and value.bit_length() > 512:
                return '<целое: ' + str(value.bit_length()) + ' бит>'
            return repr(value)
        if t in (list, tuple, dict, set, frozenset):
            if depth >= 2:
                return '<' + t.__name__ + ': ' + str(len(value)) + '>'
            import itertools
            items = list(itertools.islice(value.items() if t is dict else iter(value), 12))
            values = [describe(k, depth+1) + ': ' + describe(v, depth+1) for k, v in items] if t is dict else [describe(x, depth+1) for x in items]
            a, b = ('[', ']') if t is list else ('(', ')') if t is tuple else ('{', '}')
            return a + ', '.join(values) + (', …' if len(value) > 12 else '') + b
        # Не вызываем пользовательский __repr__: он может менять программу или зависнуть.
        return '<' + t.__name__ + '>'
    def variables(frame):
        result = []
        for name, value in list(frame.f_locals.items()):
            if name.startswith('__') or type(value).__name__ in ('module', 'function', 'type', 'builtin_function_or_method'):
                continue
            item = {'name': name, 'type': type(value).__name__, 'value': describe(value)[:400]}
            if type(value) in (list, tuple):
                item['items'] = [describe(x)[:100] for x in value[:12]]
                item['length'] = len(value)
            result.append(item)
            if len(result) >= 24:
                break
        return result
    def trace(frame, event, arg):
        if frame.f_code.co_filename != filename:
            return trace
        if event not in ('line', 'return', 'exception'):
            return trace
        if len(steps) >= limit:
            raise TraceLimit()
        stack = []
        current = frame
        while current and len(stack) < 8:
            if current.f_code.co_filename == filename:
                stack.append({'name': current.f_code.co_name, 'line': current.f_lineno})
            current = current.f_back
        step = {'event': event, 'line': frame.f_lineno, 'function': frame.f_code.co_name,
                'variables': variables(frame), 'stack': stack, 'output': out.getvalue()}
        if event == 'return':
            step['returnValue'] = describe(arg)
        if event == 'exception':
            step['exception'] = arg[0].__name__
        steps.append(step)
        return trace
    old_in, old_out, old_err = _lab_sys.stdin, _lab_sys.stdout, _lab_sys.stderr
    old_trace = _lab_sys.gettrace()
    error, truncated = '', False
    try:
        _lab_sys.stdin = _lab_io.StringIO(stdin)
        _lab_sys.stdout = _lab_sys.stderr = out
        program = compile(source, filename, 'exec')
        _lab_sys.settrace(trace)
        exec(program, {'__name__': '__main__'})
    except TraceLimit:
        truncated = True
    except BaseException as exc:
        error = ''.join(_lab_tb.format_exception_only(type(exc), exc))[:2000]
    finally:
        _lab_sys.settrace(old_trace)
        _lab_sys.stdin, _lab_sys.stdout, _lab_sys.stderr = old_in, old_out, old_err
    return _lab_json.dumps({'steps': steps, 'output': out.getvalue(), 'outputTruncated': out.truncated, 'error': error, 'truncated': truncated}, ensure_ascii=False)
`;

let labBusy = false;
self.onmessage = async ev => {
  const msg = ev.data;
  if (msg.type !== 'trace' || labBusy) return;
  labBusy = true;
  try {
    await ready;
    if (!pyodide) throw new Error('Python не загрузился. Проверьте подключение и повторите запуск.');
    for (const file of (msg.files || []).slice(0, 10)) {
      if (!/^[A-Za-z0-9_.-]{1,60}$/.test(file.name) || file.name === '.' || file.name === '..') throw Error('Недопустимое имя файла');
      const url = new URL(file.url, self.location.href);
      if (url.origin !== self.location.origin || !url.pathname.startsWith('/pyc-data/')) throw Error('Недопустимый файл урока');
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw Error('Не удалось загрузить файл ' + file.name);
      const data = new Uint8Array(await r.arrayBuffer());
      if (data.length > 10000000) throw Error('Файл слишком большой для пошагового разбора');
      pyodide.FS.writeFile('/home/pyodide/' + file.name, data);
    }
    pyodide.runPython("import os; os.chdir('/home/pyodide')");
    self.postMessage({ type: 'tracing' });
    pyodide.runPython(LAB_TRACE_PY);
    const run = pyodide.globals.get('_lab_run');
    try {
      const result = JSON.parse(run(String(msg.code || '').slice(0, 30000), String(msg.stdin || '').slice(0, 10000)));
      self.postMessage({ type: 'trace', result });
    } finally { run.destroy(); }
  } catch (e) {
    self.postMessage({ type: 'trace-error', text: String(e && e.message || e).slice(0, 2000) });
  } finally { labBusy = false; }
};
