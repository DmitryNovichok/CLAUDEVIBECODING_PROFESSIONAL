/* Python executes in an opaque-origin iframe + Blob worker, never in the logged-in
   document's origin. CSP is the network boundary; removing import/js/fetch is not.
   This adapter alone fetches attachments, and only before sending a run command.
   Messages from Python are display data; they cannot request parent-side fetches. */
(() => {
  'use strict';
  const script = new URL(document.currentScript.src, location.href);
  const base = new URL('.', script), version = script.search;
  const CDN = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
  const MAX_FILE = 60 * 1024 * 1024, MAX_TOTAL = 200 * 1024 * 1024;
  const assetText = new Map();
  const text = (v, max = 2000) => typeof v === 'string' ? v.slice(0, max) : '';
  const number = v => typeof v === 'number' && Number.isFinite(v) ? v : 0;
  function source(name) {
    if (!assetText.has(name)) {
      const request = fetch(new URL(name + version, base), { credentials: 'same-origin', redirect: 'error', cache: 'no-cache' })
        .then(r => { if (!r.ok) throw Error('Не удалось загрузить среду Python.'); return r.text(); })
        .catch(e => { assetText.delete(name); throw e; });
      assetText.set(name, request);
    }
    return assetText.get(name);
  }
  function fileURL(value) {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin || url.username || url.password || url.hash
        || !(/^\/(?:files\/[a-f0-9]{20}\/|(?:pyc|course)-data\/)/.test(url.pathname)
          || url.pathname === '/api/together/file')) throw Error('Недопустимый файл для Python.');
    return url;
  }
  async function bytes(response, limit) {
    if (!response.ok) throw Error('Не удалось загрузить файл (' + response.status + ').');
    if (Number(response.headers.get('Content-Length')) > limit) throw Error('Файл слишком большой для Python.');
    if (!response.body?.getReader) {
      const data = await response.arrayBuffer();
      if (data.byteLength > limit) throw Error('Файл слишком большой для Python.');
      return data;
    }
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { await reader.cancel(); throw Error('Файл слишком большой для Python.'); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  }
  // Python can forge its own stdout, trace and completion messages. Normalise every
  // value before the UI uses it (notably numeric values inserted into trace HTML).
  function output(m) {
    if (!m || typeof m !== 'object') return null;
    switch (m.type) {
      case 'out': case 'err': return { type: m.type, text: text(m.text, 300100) };
      case 'status': case 'trace-error': case 'tests-error': return { type: m.type, text: text(m.text) };
      case 'ready': return { type: 'ready', version: text(m.version, 40) };
      case 'done': return { type: 'done', ok: m.ok === true, ms: Math.max(0, number(m.ms)), fatal: m.fatal === true };
      case 'tracing': case 'tests-start': case 'tests-done': return { type: m.type };
      case 'test': return { type: 'test', i: number(m.i), result: { out: text(m.result?.out, 20000),
        err: text(m.result?.err), kind: text(m.result?.kind, 100), line: number(m.result?.line) } };
      case 'turtle': {
        if (!Array.isArray(m.ops)) return null;
        const ops = m.ops.slice(0, 400000).filter(Array.isArray).map(op => {
          if (op[0] === 'f') return ['f', Array.isArray(op[1]) ? op[1].slice(0, 400000)
            .filter(Array.isArray).map(p => [number(p[0]), number(p[1])]) : [], text(op[2], 100)];
          if (op[0] === 't') return ['t', number(op[1]), number(op[2]), text(op[3], 20000), text(op[4], 100)];
          return op.slice(0, 7).map(v => typeof v === 'number' ? number(v) : text(v, 100));
        });
        return { type: 'turtle', ops };
      }
      case 'trace-progress': return { type: 'trace-progress', seconds: Math.max(0, number(m.seconds)) };
      case 'trace': case 'trace-partial': {
        if (!Array.isArray(m.result?.steps)) return null;
        const r = m.result;
        return { type: m.type, result: { output: text(r.output, 20000), error: text(r.error),
          outputTruncated: r.outputTruncated === true, truncated: r.truncated === true, stop: text(r.stop, 20),
          cut: r.cut === true, finished: r.finished === true, pending: r.pending === true, seconds: Math.max(0, number(r.seconds)),
          steps: r.steps.slice(0, 200000).filter(s => s && typeof s === 'object').map(s => ({
            event: text(s.event, 20), line: number(s.line), function: text(s.function, 200), out: number(s.out),
            exception: text(s.exception, 200), returnValue: text(s.returnValue, 1000),
            stack: (Array.isArray(s.stack) ? s.stack : []).slice(0, 8).map(f => ({ name: text(f?.name, 200), line: number(f?.line) })),
            variables: (Array.isArray(s.variables) ? s.variables : []).slice(0, 24).map(v => ({
              name: text(v?.name, 200), type: text(v?.type, 200), value: text(v?.value, 400),
              ...(v?.length == null ? {} : { length: number(v.length) }),
              ...(Array.isArray(v?.items) ? { items: v.items.slice(0, 12).map(i => text(i, 100)) } : {})
            }))
          })) } };
      }
      default: return null;
    }
  }
  class EgePythonWorker {
    constructor(name) {
      const url = new URL(name, base);
      if (url.origin !== base.origin || !['py-worker.js', 'lab-worker.js'].some(n => url.pathname === new URL(n, base).pathname))
        throw Error('Неизвестная среда Python.');
      this.onmessage = null; this.onerror = null;
      this.closed = false; this.port = null; this.frame = null;
      this.abort = new AbortController();
      this.started = this.start(url.pathname.endsWith('/lab-worker.js'), url.searchParams.get('local') === '1');
      // A caller may only be waiting for `ready`, without posting a command yet.
      this.started.catch(() => {});
      this.queue = Promise.resolve();
    }
    emit(m) { if (!this.closed) this.onmessage?.({ data: m }); }
    async start(lab, local) {
      try {
        const [frameText, python, trace] = await Promise.all([
          source('python-sandbox.html'), source('py-worker.js'), lab ? source('lab-worker.js') : ''
        ]);
        if (this.closed) return;
        const roots = local ? [new URL('vendor/pyodide/', base).href, CDN] : [CDN];
        const bootstrap = 'self.EGE_PYODIDE_SOURCES=' + JSON.stringify(roots) + ';\n' + python + '\n' + trace;
        const frame = document.createElement('iframe');
        this.frame = frame;
        frame.hidden = true; frame.title = 'Изолированная среда Python';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.referrerPolicy = 'no-referrer';
        frame.srcdoc = frameText.replaceAll('__EGE_RUNTIME__', roots.join(' ').replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
        await new Promise((resolve, reject) => {
          this.rejectStart = reject;
          this.startTimer = setTimeout(() => reject(Error('Среда Python не запустилась.')), 20000);
          frame.onload = () => {
            if (this.closed) return;
            const channel = new MessageChannel();
            this.port = channel.port1;
            this.port.onmessage = event => {
              if (this.closed) return;
              if (event.data?.type === 'sandbox-ready') {
                clearTimeout(this.startTimer); this.rejectStart = null; resolve(); return;
              }
              if (event.data?.type === 'sandbox-error') {
                const error = Error('Не удалось запустить изолированную среду Python.');
                reject(error); this.onerror?.(error); this.terminate(); return;
              }
              const message = output(event.data);
              if (message) this.emit(message);
            };
            this.port.start();
            frame.contentWindow.postMessage({ type: 'ege-python-init', source: bootstrap }, '*', [channel.port2]);
          };
          document.body.appendChild(frame);
        });
      } catch (e) {
        clearTimeout(this.startTimer);
        if (!this.closed) {
          this.emit({ type: 'err', text: 'Не удалось загрузить Python: ' + e.message + '\n' });
          this.emit({ type: 'done', ok: false, ms: 0 });
          this.onerror?.(e);
          this.terminate();
        }
        throw e;
      }
    }
    postMessage(message) {
      if (this.closed || !['run', 'trace', 'tests'].includes(message?.type)) return;
      // Snapshot inputs before awaiting network; no caller-controlled object is
      // later substituted for a file URL or run command.
      const command = { type: message.type, code: String(message.code || ''), stdin: String(message.stdin || ''),
        inputs: Array.isArray(message.inputs) ? message.inputs.slice(0, 12).map(String) : [], files: [] };
      const files = (Array.isArray(message.files) ? message.files : []).slice(0, 40)
        .map(f => ({ name: String(f.name || ''), url: String(f.url || '') }));
      this.queue = this.queue.then(async () => {
        await this.started;
        if (this.closed) return;
        let total = 0;
        for (const file of files) {
          if (!file.name || file.name.length > 240 || /[/\\\x00-\x1f]/.test(file.name) || ['.', '..'].includes(file.name))
            throw Error('Недопустимое имя файла.');
          try {
            const url = fileURL(file.url);
            const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: this.abort.signal });
            const data = await bytes(response, Math.min(MAX_FILE, MAX_TOTAL - total));
            total += data.byteLength;
            command.files.push({ name: file.name, data });
          } catch (e) {
            if (this.closed) return;
            command.files.push({ name: file.name, error: text(e.message) });
          }
        }
        if (!this.closed) this.port.postMessage(command, command.files.filter(f => f.data).map(f => f.data));
      }).catch(e => {
        if (this.closed) return;
        if (command.type === 'run') {
          this.emit({ type: 'err', text: e.message + '\n' });
          this.emit({ type: 'done', ok: false, ms: 0 });
        } else this.emit({ type: command.type === 'trace' ? 'trace-error' : 'tests-error', text: e.message });
      });
    }
    terminate() {
      if (this.closed) return;
      this.closed = true;
      this.abort.abort(); clearTimeout(this.startTimer);
      this.rejectStart?.(Error('Python остановлен.')); this.rejectStart = null;
      this.port?.close(); this.frame?.remove();
      this.port = this.frame = null;
    }
  }
  window.EgePythonWorker = EgePythonWorker;
})();
