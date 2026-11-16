/* On-demand, synthetic checks. No pupil answers or scores are submitted. */
(function () {
  'use strict';
  let dialog, worker, generation = 0, running = false, lastFocus, localPython = false;
  let cancelPython;
  const requests = new Set();
  const labels = { network: 'Связь с сервером', storage: 'Черновики в этом браузере', save: 'Сохранение на сервере', file: 'Загрузка файлов', python: 'Python и работа с файлом' };
  async function request(url, options = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    requests.add(controller);
    try {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal });
      const content = await response.text();
      if (!response.ok) {
        let body = {}; try { body = JSON.parse(content); } catch (_) { /* non-JSON error */ }
        throw Error(body.error || (response.status === 401 ? 'Войдите в аккаунт и повторите проверку' : 'Не удалось выполнить проверку'));
      }
      return { json: async () => JSON.parse(content), text: async () => content };
    } finally { clearTimeout(timer); requests.delete(controller); }
  }
  function row(key, state, text) {
    const el = dialog.querySelector('[data-check="' + key + '"]');
    el.dataset.state = state;
    el.querySelector('b').textContent = (state === 'ok' ? '✓ ' : state === 'error' ? '! ' : '') + labels[key];
    el.querySelector('span').textContent = text;
  }
  function pythonCheck() {
    return new Promise((resolve, reject) => {
      if (!window.EgePythonWorker) return reject(Error('Обновите страницу: модуль Python не загрузился'));
      let output = '', settled = false, currentWorker;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); currentWorker?.terminate(); if (worker === currentWorker) worker = null;
        if (cancelPython === cancel) cancelPython = null;
        error ? reject(error) : resolve('Вычисление и чтение тестового файла работают');
      };
      const timer = setTimeout(() => finish(Error('Python не загрузился за минуту. Проверьте доступ к учебным ресурсам в сети школы')), 60000);
      const cancel = () => finish(Error('Проверка остановлена'));
      cancelPython = cancel;
      try { currentWorker = worker = new window.EgePythonWorker('py-worker.js' + (localPython ? '?local=1' : '')); }
      catch (error) { finish(error); return; }
      currentWorker.onerror = () => finish(Error('Не удалось запустить Python. Обновите браузер и повторите проверку'));
      currentWorker.onmessage = ({ data }) => {
        if (data.type === 'ready') currentWorker.postMessage({ type: 'run', code: "with open('readiness.txt', 'w') as f:\n    f.write('17\\n23\\n')\nwith open('readiness.txt') as f:\n    print(sum(map(int, f)))", files: [] });
        if (data.type === 'out') output += data.text;
        if (data.type === 'done') finish(data.ok && output.trim() === '40' ? null : Error('Python не завершил тест. Попробуйте повторить проверку'));
      };
    });
  }
  async function run() {
    if (running) return;
    running = true;
    const current = ++generation, start = dialog.querySelector('[data-run]');
    start.disabled = true;
    const checks = {
      network: async () => { const t = performance.now(); const result = await (await request('/api/readiness')).json(); localPython = result.py_local === true; return 'Сервер ответил за ' + Math.round(performance.now() - t) + ' мс'; },
      storage: async () => {
        const key = 'egeTrainer.readiness.' + Date.now();
        try { localStorage.setItem(key, 'ok'); if (localStorage.getItem(key) !== 'ok') throw Error(); }
        catch (_) { throw Error('Браузер не сохраняет черновики. Разрешите хранение данных сайта'); }
        finally { try { localStorage.removeItem(key); } catch (_) { /* unavailable */ } }
        return 'Тестовый черновик записан, прочитан и удалён';
      },
      save: async () => {
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
        await request('/api/readiness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce }) });
        const result = await (await request('/api/readiness?receipt=' + nonce)).json();
        if (!result.saved) throw Error('Запись не подтверждена. Повторите проверку');
        return 'Тестовая запись прочитана с сервера отдельным запросом';
      },
      file: async () => {
        const text = await (await request('/api/readiness?file=1')).text();
        if (text !== '17\n23\n') throw Error('Тестовый файл загружен не полностью');
        return 'Небольшой тестовый файл получен полностью';
      },
      python: pythonCheck,
    };
    for (const key of Object.keys(checks)) row(key, 'waiting', 'Ожидает проверки');
    for (const [key, check] of Object.entries(checks)) {
      if (generation !== current) break;
      row(key, 'running', key === 'python' ? 'Первая загрузка может занять до минуты…' : 'Проверяем…');
      try { const text = await check(); if (generation === current) row(key, 'ok', text); }
      catch (error) { if (generation === current) row(key, 'error', error.name === 'AbortError' ? 'Сервер не ответил. Проверьте сеть и повторите' : error.message); }
    }
    if (generation === current) { running = false; start.disabled = false; start.textContent = 'Повторить проверку'; }
  }
  function open() {
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'lesson-ready'; dialog.setAttribute('aria-labelledby', 'lessonReadyTitle');
      dialog.innerHTML = '<button type="button" class="lesson-ready-close" aria-label="Закрыть">×</button><h2 id="lessonReadyTitle">Готовность к уроку</h2><p>Проверим этот компьютер и соединение. Работы, ответы и оценки учеников не изменятся.</p><ol>' + Object.keys(labels).map(key => '<li data-check="' + key + '"><b>' + labels[key] + '</b><span>Ещё не проверено</span></li>').join('') + '</ol><div class="lesson-ready-actions"><button type="button" class="btn primary" data-run>Начать проверку</button></div><small>Это проверка базовых функций сейчас, а не гарантия связи на весь урок. Файлы конкретного задания и подключение каждого ученика проверьте отдельно.</small>';
      document.body.appendChild(dialog);
      dialog.querySelector('[data-run]').addEventListener('click', run);
      dialog.querySelector('.lesson-ready-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => {
        generation++; running = false; cancelPython?.(); worker?.terminate(); worker = null;
        for (const controller of requests) controller.abort();
        for (const el of dialog.querySelectorAll('[data-state=running]')) row(el.dataset.check, 'waiting', 'Проверка остановлена');
        dialog.querySelector('[data-run]').disabled = false; lastFocus?.focus();
      });
    }
    lastFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
  }
  const menu = document.querySelector('#whoMenu');
  if (menu) { const button = document.createElement('button'); button.type = 'button'; button.className = 'wm-item'; button.dataset.lessonReadiness = ''; button.textContent = 'Проверить перед уроком'; menu.insertBefore(button, menu.querySelector('#logoutBtn')); }
  document.addEventListener('click', event => { if (event.target.closest('[data-lesson-readiness]')) open(); });
  window.addEventListener('egeshka:session-ended', () => { if (dialog?.open) dialog.close(); clearTimeout(hideTimer); if (status) status.hidden = true; });

  // Only successful responses confirm a write. Never replay an answer automatically.
  let status, hideTimer, latest = 0;
  window.addEventListener('egeshka:answer-save', ({ detail }) => {
    if (detail.id < latest) return;
    latest = detail.id; clearTimeout(hideTimer);
    if (!status) { status = document.createElement('div'); status.className = 'lesson-save-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); document.body.appendChild(status); }
    status.hidden = false; status.dataset.state = detail.state;
    status.textContent = detail.state === 'pending' ? 'Отправляем ответ…' : detail.state === 'saved' ? 'Сервер подтвердил сохранение' : detail.state === 'accepted' ? 'Ответ сервера получен — продолжите в задании' : 'Сохранение не подтверждено. Проверьте связь и повторите отправку в задании.';
    if (detail.state === 'saved' || detail.state === 'accepted') hideTimer = setTimeout(() => { status.hidden = true; }, 3000);
  });
})();
