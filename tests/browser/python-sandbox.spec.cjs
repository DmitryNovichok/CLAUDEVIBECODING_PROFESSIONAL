// Real Chromium + real pinned Pyodide. No network/CDN or production account needed.
// The mock principal API deliberately accepts cookies/requests: the browser
// boundary must stop even a no-cors POST from ever reaching that API.
const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const policyFor = require('./csp-policy.cjs');
const ROOT = path.resolve(__dirname, '../..');
let server, origin, apiRequests, files, policy;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', policy);
    const url = new URL(req.url, 'http://localhost');
    const send = (data, type = 'text/plain') => {
      // Match the production server: classic scripts inherit the page encoding.
      // Without UTF-8, Cyrillic adapter errors are decoded as Windows-1252.
      res.setHeader('Content-Type', type.startsWith('text/') ? type + '; charset=utf-8' : type);
      res.end(data);
    };
    if (url.pathname === '/') {
      res.setHeader('Set-Cookie', 'principal=secret-admin-session; Path=/; HttpOnly; SameSite=Lax');
      return send('<!doctype html><script src="/python-sandbox.js"></script>', 'text/html');
    }
    if (url.pathname.startsWith('/api/admin/')) {
      apiRequests.push({ path: url.pathname, method: req.method, cookie: req.headers.cookie });
      return send('principal-secret');
    }
    if (url.pathname === '/api/together/file' || url.pathname === '/files/01234567890123456789/sample.txt'
        || url.pathname === '/course-data/1/sample.txt') {
      files.push({ path: url.pathname, cookie: req.headers.cookie, origin: req.headers.origin });
      return send('10\n20\n12\n');
    }
    if (url.pathname.startsWith('/vendor/pyodide/')) {
      // Only runtime resources get anonymous CORS, exactly as in the app server.
      res.setHeader('Access-Control-Allow-Origin', '*');
      const name = path.basename(url.pathname);
      const file = path.join(__dirname, 'node_modules/pyodide', name);
      if (fs.existsSync(file) && fs.statSync(file).isFile())
        return send(fs.readFileSync(file), name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    }
    if (['/python-sandbox.js', '/python-sandbox.html', '/py-worker.js', '/lab-worker.js'].includes(url.pathname))
      return send(fs.readFileSync(path.join(ROOT, url.pathname.slice(1))), url.pathname.endsWith('.html') ? 'text/html' : 'text/javascript');
    res.statusCode = 404; send('missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  policy = policyFor(origin);
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
  apiRequests = []; files = [];
  await page.goto(origin);
  await page.evaluate(() => {
    window.executePython = (command, lab = false) => new Promise((resolve, reject) => {
      const worker = new EgePythonWorker((lab ? 'lab-worker.js' : 'py-worker.js') + '?local=1');
      window.activePython = worker;
      const messages = [];
      worker.onerror = e => reject(Error(e.message || 'sandbox worker failed'));
      worker.onmessage = e => {
        messages.push(e.data);
        if (['done', 'trace', 'trace-error', 'tests-done', 'tests-error'].includes(e.data.type)) resolve(messages);
      };
      worker.postMessage(command);
    });
  });
});
const stdout = messages => messages.filter(m => m.type === 'out').map(m => m.text).join('');

test('ordinary Python, stdin, task/course/Together files and turtle survive isolation', async ({ page }) => {
  const messages = await page.evaluate(() => executePython({ type: 'run', stdin: '8',
    files: [{ name: 'sample.txt', url: '/files/01234567890123456789/sample.txt' },
      { name: 'teacher.txt', url: '/api/together/file?s=1&f=abc&as=t' },
      { name: 'lesson.txt', url: '/course-data/1/sample.txt' }],
    code: "import math\nprint(math.factorial(5), int(input()))\nfor name in ['sample.txt','teacher.txt','lesson.txt']:\n print(name, sum(map(int, open(name))))\nimport turtle\nturtle.forward(20)"
  }));
  expect(stdout(messages)).toContain('120 8');
  expect(stdout(messages)).toContain('sample.txt 42');
  expect(stdout(messages)).toContain('teacher.txt 42');
  expect(stdout(messages)).toContain('lesson.txt 42');
  expect(messages.some(m => m.type === 'turtle' && m.ops.length > 0)).toBe(true);
  expect(messages.at(-1).ok).toBe(true);
  expect(files).toHaveLength(3);
  expect(files.every(f => f.cookie === 'principal=secret-admin-session')).toBe(true);
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
});

test('Python cannot read or mutate the principal API or delegate a credentialed fetch', async ({ page }) => {
  const code = `import js\nfrom pyodide.ffi import to_js\nprint('origin', js.location.origin)\n` +
    `for route,method,mode in [('/api/admin/whoami','GET','cors'),('/api/admin/mutate','POST','cors'),('/api/admin/mutate','POST','no-cors')]:\n` +
    ` try:\n  opts=to_js({'method':method,'credentials':'include','mode':mode},dict_converter=js.Object.fromEntries)\n` +
    `  response=await js.fetch(${JSON.stringify(origin)}+route,opts)\n  print('LEAK',await response.text())\n except Exception:\n  print('blocked',method,mode)\n` +
    `try:\n x=js.XMLHttpRequest.new()\n x.open('POST',${JSON.stringify(origin + '/api/admin/mutate')},False)\n x.withCredentials=True\n x.send('attack')\n print('XHR LEAK')\nexcept Exception:\n print('blocked XHR')\n` +
    `try:\n print(js.document.cookie)\nexcept Exception:\n print('no document')\n` +
    `js.postMessage(to_js({'type':'fetch','url':${JSON.stringify(origin + '/api/admin/mutate')},'credentials':'include'},dict_converter=js.Object.fromEntries))\nprint('finished')`;
  const messages = await page.evaluate(code => executePython({ type: 'run', code }), code);
  expect(stdout(messages)).toContain('origin null');
  expect(stdout(messages)).toContain('blocked GET cors');
  expect(stdout(messages)).toContain('blocked POST cors');
  expect(stdout(messages)).toContain('blocked POST no-cors');
  expect(stdout(messages)).toContain('blocked XHR');
  expect(stdout(messages)).toContain('no document');
  expect(stdout(messages)).toContain('finished');
  expect(stdout(messages)).not.toContain('LEAK');
  expect(messages.some(m => m.type === 'fetch')).toBe(false);
  expect(apiRequests).toEqual([]);
});

test('arbitrary principal API URLs cannot be disguised as input attachments', async ({ page }) => {
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
  const messages = await page.evaluate(() => executePython({ type: 'run',
    files: [{ name: 'stolen.txt', url: '/api/admin/whoami' },
      { name: 'escape.txt', url: location.origin + '.evil.invalid/files/01234567890123456789/a.txt' }],
    code: "import os\nprint(os.path.exists('stolen.txt'),os.path.exists('escape.txt'))"
  }));
  expect(stdout(messages)).toContain('False False');
  expect(messages.some(m => m.type === 'err' && m.text.includes('Недопустимый файл'))).toBe(true);
  expect(apiRequests).toEqual([]);
});

test('trace and test runner execute real Python with byte attachments', async ({ page }) => {
  const trace = await page.evaluate(() => executePython({ type: 'trace',
    files: [{ name: 'sample.txt', url: '/course-data/1/sample.txt' }],
    code: "a = sum(map(int, open('sample.txt')))\nprint(a)" }, true));
  const result = trace.find(m => m.type === 'trace')?.result;
  expect(result.error).toBe(''); expect(result.output).toBe('42\n');
  expect(result.steps.length).toBeGreaterThan(1);
  expect(result.steps.some(s => s.variables.some(v => v.name === 'a' && v.value === '42'))).toBe(true);
  await page.evaluate(() => activePython.terminate());
  const tests = await page.evaluate(() => executePython({ type: 'tests', code: 'print(int(input()) * 2)', inputs: ['3', '8'] }, true));
  expect(tests.filter(m => m.type === 'test').map(m => m.result.out)).toEqual(['6\n', '16\n']);
});

test('stop destroys an infinite Python run and a new worker starts cleanly', async ({ page }) => {
  await page.evaluate(() => {
    window.runReady = false;
    const worker = new EgePythonWorker('py-worker.js?local=1');
    window.activePython = worker;
    worker.onmessage = e => { if (e.data.type === 'out' && e.data.text.includes('running')) window.runReady = true; };
    // Enough output flushes the worker's buffered stdout before the infinite loop.
    worker.postMessage({ type: 'run', code: "print('running' * 800)\nwhile True:\n pass" });
  });
  await expect.poll(() => page.evaluate(() => runReady), { timeout: 90000 }).toBe(true);
  await page.evaluate(() => activePython.terminate());
  await expect(page.locator('iframe')).toHaveCount(0);
  const messages = await page.evaluate(() => executePython({ type: 'run', code: 'print(6 * 7)' }));
  expect(stdout(messages)).toBe('42\n');
});

test('direct same-origin worker startup is rejected before any Python runs', async ({ page }) => {
  const error = await page.evaluate(() => new Promise(resolve => {
    const worker = new Worker('/py-worker.js');
    worker.onerror = event => { event.preventDefault(); worker.terminate(); resolve(event.message); };
    worker.postMessage({ type: 'run', code: "print('unsafe')" });
  }));
  expect(error).toContain('изолированную среду');
});
