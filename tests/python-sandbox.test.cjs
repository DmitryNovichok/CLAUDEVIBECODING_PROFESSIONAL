const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');

function sandbox() {
  const frames = [], requests = [], sent = [], received = [];
  let child;
  const context = vm.createContext({ window: {}, URL, AbortController, MessageChannel,
    setTimeout, clearTimeout, Uint8Array, ArrayBuffer,
    location: { href: 'https://school.example/', origin: 'https://school.example' },
    document: {
      currentScript: { src: 'https://school.example/python-sandbox.js?v=build' },
      createElement() {
        const frame = { attributes: {}, setAttribute(k, v) { this.attributes[k] = v; },
          remove() { const i = frames.indexOf(this); if (i >= 0) frames.splice(i, 1); },
          contentWindow: { postMessage(message, target, ports) {
            child = ports[0];
            child.onmessage = e => sent.push(e.data);
            child.start(); child.postMessage({ type: 'sandbox-ready' });
          } } };
        return frame;
      },
      body: { appendChild(frame) { frames.push(frame); queueMicrotask(() => frame.onload()); } },
    },
    fetch: async (input, options) => {
      const url = new URL(input); requests.push({ url, options });
      if (url.pathname.endsWith('.js') || url.pathname.endsWith('.html'))
        return new Response(fs.readFileSync(url.pathname.slice(1), 'utf8'));
      return new Response('lesson bytes');
    },
  });
  vm.runInContext(fs.readFileSync('python-sandbox.js', 'utf8'), context);
  const worker = vm.runInContext("new window.EgePythonWorker('py-worker.js?local=1')", context);
  worker.onmessage = e => received.push(e.data);
  return { worker, frames, requests, sent, received, output: m => child.postMessage(m),
    close() { worker.terminate(); child?.close(); } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test('Python frame has opaque origin, runtime-only CSP and no broad same-origin grant', async () => {
  const h = sandbox();
  try {
    await h.worker.started;
    assert.equal(h.frames[0].attributes.sandbox, 'allow-scripts');
    const csp = h.frames[0].srcdoc.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.ok(csp.includes('connect-src https://school.example/vendor/pyodide/ https://cdn.jsdelivr.net/pyodide/v0.28.3/full/;'));
    assert.ok(!csp.includes("'self'"));
    assert.ok(!csp.includes("'unsafe-eval'"));
    assert.ok(!csp.includes('__EGE_RUNTIME__'));
  } finally { h.close(); }
});

test('parent sends file bytes, never URLs or cookies, and refuses arbitrary API attachments', async () => {
  const h = sandbox();
  try {
    await h.worker.started;
    h.worker.postMessage({ type: 'run', code: 'print(42)', files: [
      { name: 'lesson.txt', url: '/api/together/file?s=12&f=abc&as=t' },
      { name: 'secret.txt', url: '/api/admin/whoami' },
      { name: 'evil.txt', url: 'https://school.example.evil.invalid/files/01234567890123456789/1.txt' }
    ] });
    await h.worker.queue; await flush();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].files[0].url, undefined);
    assert.equal(new TextDecoder().decode(h.sent[0].files[0].data), 'lesson bytes');
    assert.ok(h.sent[0].files[1].error);
    assert.ok(h.sent[0].files[2].error);
    assert.equal(h.requests.filter(r => r.url.pathname.startsWith('/api/')).length, 1);
    assert.equal(h.requests.find(r => r.url.pathname === '/api/together/file').options.credentials, 'same-origin');
    assert.equal(h.requests.find(r => r.url.pathname === '/api/together/file').options.redirect, 'error');
  } finally { h.close(); }
});

test('untrusted worker messages cannot ask the parent to fetch or inject trace HTML', async () => {
  const h = sandbox();
  try {
    await h.worker.started;
    const before = h.requests.length;
    h.output({ type: 'fetch', url: '/api/admin/mutate', method: 'POST' });
    h.output({ type: 'trace', result: { output: 'ok', steps: [{ line: '<img onerror=attack()>',
      variables: [{ name: 'a', value: '1', length: '<svg onload=attack()>', items: ['1'] }] }] } });
    await flush();
    assert.equal(h.requests.length, before);
    assert.equal(h.received.length, 1);
    assert.equal(h.received[0].result.steps[0].line, 0);
    assert.equal(h.received[0].result.steps[0].variables[0].length, 0);
  } finally { h.close(); }
});

test('stop removes the entire sandbox and ignores late worker output', async () => {
  const h = sandbox();
  try {
    await h.worker.started;
    h.worker.terminate();
    h.output({ type: 'out', text: 'late' });
    await flush();
    assert.equal(h.frames.length, 0);
    assert.equal(h.worker.abort.signal.aborted, true);
    assert.deepEqual(h.received, []);
  } finally { h.close(); }
});

test('account switch destroys all Python contexts and clears previous pupil output', () => {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: 'private pupil code', textContent: 'private output', width: 100, hidden: false });
    return nodes.get(id);
  };
  const events = [], stopped = [], saved = [];
  const PY = { worker: { terminate: () => stopped.push('python') }, task: { id: 'task' }, ready: true, running: true };
  const LAB = { code: 'secret', stdin: 'input', result: { output: 'private' }, context: { files: ['secret'] }, owner: 7 };
  const context = vm.createContext({ PY, LAB, TT: { ops: ['private drawing'], drag: {} },
    clearTimeout: () => {}, $: get, $$: () => [],
    writeCode: (id, code) => saved.push([id, code]),
    pycStopTests: () => stopped.push('course'), labStop: () => stopped.push('lab'), resetBugLab: () => stopped.push('bugs'),
    document: { body: { classList: { remove() {} } } },
    Event: class { constructor(type) { this.type = type; } }, window: { dispatchEvent: e => events.push(e.type) },
  });
  const source = fs.readFileSync('src/app/09-python.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('  function pyDisposeSession()'), source.indexOf('  function pyFilesOf(')), context);
  context.pyDisposeSession();
  assert.deepEqual(stopped, ['python', 'course', 'lab', 'bugs']);
  assert.deepEqual(saved, [['task', 'private pupil code']]);
  assert.equal(PY.worker, null); assert.equal(PY.task, null); assert.equal(PY.running, false);
  assert.equal(LAB.context, null); assert.equal(LAB.code, ''); assert.equal(LAB.result, null);
  assert.equal(get('#pyCode').value, ''); assert.equal(get('#pyOut').textContent, ''); assert.equal(get('#pyDock').hidden, true);
  assert.deepEqual(events, ['egeshka:session-ended']);
});
