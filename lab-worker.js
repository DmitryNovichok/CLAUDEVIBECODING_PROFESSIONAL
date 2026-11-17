/* Отдельный Python-поток лаборатории. Трассировка не меняет обычный редактор. */
'use strict';
// python-sandbox.js prepends py-worker.js before creating the opaque-origin worker.

// Тот же код проверяется в tests/test_lab_trace.py на обычном CPython.
const LAB_TRACE_PY = String.raw`
import sys as _lab_sys
import io as _lab_io
import json as _lab_json
import traceback as _lab_tb
import time as _lab_time

def _lab_run(source, stdin='', notify=None, record_seconds=25, total_seconds=300):
    filename = '<egeshka-lab>'
    steps = []
    limit = 200000          # пошагово записываются первые 200 000 шагов; дальше программа досчитывается без записи
    started = _lab_time.monotonic()
    deadline = started + record_seconds
    stop = {'why': ''}
    state = {'cut': False, 'n': 0, 'tick': started}
    class TraceLimit(BaseException):
        pass
    class Output(_lab_io.StringIO):
        truncated = False
        units = 0  # смещения JavaScript считаются в UTF-16, включая эмодзи
        def write(self, text):
            left = max(0, 20000 - self.tell())
            if len(text) > left:
                self.truncated = True
            piece = text[:left]
            self.units += len(piece) + sum(ord(ch) > 0xffff for ch in piece)
            super().write(piece)
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
    def light(frame, event, arg):
        # После записи: только следим за временем, чтобы бесконечный цикл не повесил страницу.
        if frame.f_code.co_filename != filename:
            return None
        state['n'] += 1
        if not state['n'] & 4095:
            now = _lab_time.monotonic()
            if now > started + total_seconds:
                stop['why'] = 'total'
                raise TraceLimit()
            if notify is not None and now - state['tick'] > 2:
                state['tick'] = now
                notify(_lab_json.dumps({'progress': round(now - started)}))
        return light
    def partial():
        return _lab_json.dumps({'steps': steps, 'output': out.getvalue(), 'outputTruncated': out.truncated, 'error': '',
                                'truncated': False, 'stop': 'steps', 'cut': True, 'pending': True}, ensure_ascii=False)
    def trace(frame, event, arg):
        if frame.f_code.co_filename != filename:
            return trace
        if event not in ('line', 'return', 'exception'):
            return trace
        if len(steps) >= limit:
            # Шаги для просмотра записаны. Отдаём их сразу и досчитываем программу до конца без записи.
            stop['why'] = 'steps'
            state['cut'] = True
            _lab_sys.settrace(light)
            current = frame
            while current is not None:
                if current.f_code.co_filename == filename:
                    current.f_trace = light
                current = current.f_back
            if notify is not None:
                notify(partial())
            return light
        if not len(steps) & 255 and _lab_time.monotonic() > deadline:
            stop['why'] = 'time'
            raise TraceLimit()
        stack = []
        current = frame
        while current and len(stack) < 8:
            if current.f_code.co_filename == filename:
                stack.append({'name': current.f_code.co_name, 'line': current.f_lineno})
            current = current.f_back
        step = {'event': event, 'line': frame.f_lineno, 'function': frame.f_code.co_name,
                'variables': variables(frame), 'stack': stack, 'out': out.units}
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
    if state['cut'] and not truncated:
        stop['why'] = 'steps'
    return _lab_json.dumps({'steps': [] if state['cut'] and notify is not None else steps, 'output': out.getvalue(),
                            'outputTruncated': out.truncated, 'error': error, 'truncated': truncated, 'stop': stop['why'],
                            'cut': state['cut'], 'finished': not truncated,
                            'seconds': round(_lab_time.monotonic() - started)}, ensure_ascii=False)
`;

// Обычный запуск на входных данных — для лаборатории исправления ошибок: вывод, ошибка и номер строки.
const LAB_PLAIN_PY = String.raw`
import sys as _lab_sys
import io as _lab_io
import json as _lab_json
import traceback as _lab_tb

def _lab_plain(source, stdin=''):
    filename = '<egeshka-lab>'
    class Output(_lab_io.StringIO):
        def write(self, text):
            super().write(text[:max(0, 6000 - self.tell())])
            return len(text)
    out = Output()
    old_in, old_out, old_err = _lab_sys.stdin, _lab_sys.stdout, _lab_sys.stderr
    error, kind, line = '', '', 0
    try:
        _lab_sys.stdin = _lab_io.StringIO(stdin)
        _lab_sys.stdout = _lab_sys.stderr = out
        exec(compile(source, filename, 'exec'), {'__name__': '__main__'})
    except SystemExit:
        pass
    except BaseException as exc:
        kind = type(exc).__name__
        error = ''.join(_lab_tb.format_exception_only(type(exc), exc))[:600]
        if isinstance(exc, SyntaxError):
            line = exc.lineno or 0
        else:
            tb = exc.__traceback__
            while tb:
                if tb.tb_frame.f_code.co_filename == filename:
                    line = tb.tb_lineno
                tb = tb.tb_next
    finally:
        _lab_sys.stdin, _lab_sys.stdout, _lab_sys.stderr = old_in, old_out, old_err
    return _lab_json.dumps({'out': out.getvalue(), 'err': error, 'kind': kind, 'line': line}, ensure_ascii=False)
`;

let labBusy = false;
self.onmessage = async ev => {
  const msg = ev.data;
  if (msg.type === 'tests' && !labBusy) {            // код на нескольких входах подряд; после каждого — сообщение с результатом
    labBusy = true;
    try {
      await ready;
      if (!pyodide) throw new Error('Python не загрузился. Проверьте подключение и повторите запуск.');
      self.postMessage({ type: 'tests-start' });
      pyodide.runPython(LAB_PLAIN_PY);
      const run = pyodide.globals.get('_lab_plain');
      try {
        const inputs = (msg.inputs || []).slice(0, 12);
        for (let i = 0; i < inputs.length; i++) {
          let r;
          try { r = JSON.parse(run(String(msg.code || '').slice(0, 30000), String(inputs[i] || '').slice(0, 10000))); }
          catch (e) { r = { out: '', err: String(e && e.message || e).slice(0, 600), kind: /stack|recursion/i.test(String(e)) ? 'RecursionError' : 'Error', line: 0 }; }
          self.postMessage({ type: 'test', i, result: r });
        }
        self.postMessage({ type: 'tests-done' });
      } finally { run.destroy(); }
    } catch (e) {
      self.postMessage({ type: 'tests-error', text: String(e && e.message || e).slice(0, 2000) });
    } finally { labBusy = false; }
    return;
  }
  if (msg.type !== 'trace' || labBusy) return;
  labBusy = true;
  try {
    await ready;
    if (!pyodide) throw new Error('Python не загрузился. Проверьте подключение и повторите запуск.');
    for (const file of (msg.files || []).slice(0, 10)) {
      if (!file.name || /[/\\\x00-\x1f]/.test(file.name) || ['.', '..'].includes(file.name)) throw Error('Недопустимое имя файла');
      if (file.error || !(file.data instanceof ArrayBuffer)) throw Error('Не удалось загрузить файл ' + file.name);
      const data = new Uint8Array(file.data);
      if (data.length > 10000000) throw Error('Файл слишком большой для пошагового разбора');
      pyodide.FS.writeFile('/home/pyodide/' + file.name, data);
    }
    pyodide.runPython("import os; os.chdir('/home/pyodide')");
    self.postMessage({ type: 'tracing' });
    pyodide.runPython(LAB_TRACE_PY);
    const run = pyodide.globals.get('_lab_run');
    try {
      // Записанные шаги и ход досчёта приходят раньше конца программы.
      const notify = text => {
        const data = JSON.parse(text);
        self.postMessage(data.progress != null ? { type: 'trace-progress', seconds: data.progress } : { type: 'trace-partial', result: data });
      };
      const result = JSON.parse(run(String(msg.code || '').slice(0, 30000), String(msg.stdin || '').slice(0, 10000), notify));
      self.postMessage({ type: 'trace', result });
    } finally { run.destroy(); }
  } catch (e) {
    self.postMessage({ type: 'trace-error', text: String(e && e.message || e).slice(0, 2000) });
  } finally { labBusy = false; }
};
