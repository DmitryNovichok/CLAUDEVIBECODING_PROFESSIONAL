  // ------------------------------------------------------------ лаборатории
  // Свободные эксперименты не влияют на журнал. В назначенной работе сохраняется первый прогноз.
  function labNetwork(address, prefix) {
    const parts = String(address).trim().split('.');
    if (parts.length !== 4 || parts.some(x => !/^\d{1,3}$/.test(x) || +x > 255) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw Error('Введите IPv4 из четырёх чисел 0–255 и маску от /0 до /32.');
    const ip = parts.reduce((n, x) => n * 256 + +x, 0), count = 2 ** (32 - prefix);
    const start = Math.floor(ip / count) * count;
    const format = n => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
    return { ip, prefix, count, start, end: start + count - 1, mask: format(2 ** 32 - count), network: format(start), last: format(start + count - 1), bits: ip.toString(2).padStart(32, '0') };
  }
  function labImageSize(width, height, depth) {
    if (![width, height, depth].every(Number.isInteger) || width < 1 || height < 1 || width > 8192 || height > 8192 || depth < 1 || depth > 24) throw Error('Размеры — целые числа от 1 до 8192, глубина цвета — от 1 до 24 бит.');
    const bits = width * height * depth;
    return { bits, bytes: Math.ceil(bits / 8), colors: 2 ** depth };
  }
  function labGameMoves(stones, target, add, factor) {
    if (![stones, target, add, factor].every(Number.isInteger) || stones < 1 || target < 2 || target > 200 || stones > 1000 || add < 1 || add > 20 || factor < 2 || factor > 5) throw Error('Проверьте параметры игры: цель 2–200, прибавление 1–20, множитель 2–5.');
    return stones >= target ? [] : [{ label: `+${add}`, value: stones + add }, { label: `×${factor}`, value: stones * factor }];
  }
  function labGamePositionMoves(position, target, add, factor) {
    if (!Array.isArray(position) || ![1, 2].includes(position.length)) throw Error('Нужна одна или две кучи.');
    position.forEach(n => labGameMoves(n, target, add, factor));
    if (position.reduce((a, b) => a + b, 0) >= target) return [];
    return position.flatMap((n, i) => labGameMoves(n, target, add, factor).map(m => ({
      label: `${position.length === 2 ? `Куча ${i + 1}: ` : ''}${m.label}`,
      value: position.map((v, j) => j === i ? m.value : v)
    })));
  }
  // ---- №15: логическое выражение с параметром A. Клетка x красная — при этом A выражение ложно (контрпример)
  const labImp = (a, b) => !a || b;
  const LAB_LOGIC = {
    div: { name: 'Делимость', expr: '¬ДЕЛ(x, A) → (ДЕЛ(x, 6) → ¬ДЕЛ(x, 4))', ask: 'max', a0: 5, aMax: 60, xMax: 120,
      note: 'ДЕЛ(x, A) — «x делится на A без остатка». Ищем наибольшее A, при котором нет ни одной красной клетки.',
      f: (x, a) => labImp(x % a !== 0, labImp(x % 6 === 0, x % 4 !== 0)),
      parts: (x, a) => [[`ДЕЛ(x, ${a})`, x % a === 0], ['ДЕЛ(x, 6)', x % 6 === 0], ['ДЕЛ(x, 4)', x % 4 === 0]] },
    bit: { name: 'Биты', expr: '(x & 53 ≠ 0) → ((x & 41 = 0) → (x & A ≠ 0))', ask: 'min', a0: 1, aMax: 63, xMax: 127,
      note: '& — поразрядная конъюнкция. Наведите на клетку — увидите x в двоичной записи. Ищем наименьшее A без красных клеток.',
      f: (x, a) => labImp((x & 53) !== 0, labImp((x & 41) === 0, (x & a) !== 0)),
      parts: (x, a) => [['x & 53 ≠ 0', (x & 53) !== 0], ['x & 41 = 0', (x & 41) === 0], [`x & ${a} ≠ 0`, (x & a) !== 0]] },
    seg: { name: 'Отрезки', expr: '((x ∈ P) ∧ ¬(x ∈ Q)) → (x ∈ A)', ask: 'len', P: [10, 35], Q: [25, 50], xMax: 60,
      note: 'P = [10; 35], Q = [25; 50], x — любое число, не только целое. Подберите концы отрезка A так, чтобы красных точек не осталось, и найдите наименьшую длину A.',
      f: (x, a, b) => labImp(x >= 10 && x <= 35 && !(x >= 25 && x <= 50), x >= a && x <= b) },
  };
  /** Ответ к модели №15 — тем же перебором, что в уроке курса (x — с запасом). */
  function labLogicAnswer(kind) {
    const m = LAB_LOGIC[kind];
    if (kind === 'seg') {
      const xs = Array.from({ length: 241 }, (_, i) => i / 4);
      let best = Infinity;
      for (let a = 0; a <= 60; a++) for (let b = a; b <= 60; b++) if (b - a < best && xs.every(x => m.f(x, a, b))) best = b - a;
      return best;
    }
    const ok = a => { for (let x = 1; x <= 2000; x++) if (!m.f(x, a)) return false; return true; };
    if (m.ask === 'min') { for (let a = 1; a <= 1000; a++) if (ok(a)) return a; return null; }
    let best = null; for (let a = 1; a <= 1000; a++) if (ok(a)) best = a; return best;
  }

  // ---- №23: ациклический граф. Значение в вершине — ответ «отсюда до конца»: количество путей, кратчайший или самый длинный путь
  const LAB_G = {
    v: { A: [0, 1], B: [1, 0], D: [1, 2], C: [2, 1], E: [3, 0], F: [3, 2], G: [4, 1], H: [5, 1] },
    e: [['A', 'B', 3], ['A', 'C', 5], ['A', 'D', 2], ['B', 'C', 1], ['B', 'E', 4], ['D', 'C', 2], ['D', 'F', 7], ['C', 'E', 2],
        ['C', 'F', 6], ['E', 'G', 3], ['E', 'H', 8], ['F', 'G', 1], ['F', 'H', 2], ['G', 'H', 4]],
    order: ['A', 'B', 'D', 'C', 'E', 'F', 'G', 'H'],          // топологический порядок: стрелки идут только вперёд
  };
  /** Значения «из вершины до end» в обратном топологическом порядке; banned — вершины, через которые нельзя. */
  function labGraphTo(kind, end, banned) {
    const val = {}, next = {}, steps = [];
    for (const v of [...LAB_G.order].reverse()) {
      if (banned.has(v)) { val[v] = null; steps.push(v); continue; }
      if (v === end) { val[v] = kind === 'count' ? 1 : 0; steps.push(v); continue; }
      let best = null;
      for (const [a, b, w] of LAB_G.e) {
        if (a !== v || val[b] == null || (kind === 'count' && val[b] === 0)) continue;
        if (kind === 'count') best = (best || 0) + val[b];
        else { const c = w + val[b]; if (best == null || (kind === 'short' ? c < best : c > best)) { best = c; next[v] = b; } }
      }
      val[v] = kind === 'count' ? best || 0 : best;
      steps.push(v);
    }
    return { val, next, steps };
  }
  /** Ответ: из start в end, через via (если задана), в обход banned. Для min/max — сам путь. */
  function labGraphSolve(kind, start, end, banned, via) {
    const seg = (a, b) => { const r = labGraphTo(kind, b, banned); const path = [a]; if (kind !== 'count' && r.val[a] != null) while (path[path.length - 1] !== b) path.push(r.next[path[path.length - 1]]); return { r, v: r.val[a], path }; };
    if (!via || via === start || via === end) { const s1 = seg(start, end); return { answer: s1.v, path: s1.path, table: s1.r }; }
    const s1 = seg(start, via), s2 = seg(via, end);
    if (s1.v == null || s2.v == null || (kind === 'count' && (!s1.v || !s2.v))) return { answer: kind === 'count' ? 0 : null, path: [], table: s2.r, parts: [s1.v, s2.v] };
    return { answer: kind === 'count' ? s1.v * s2.v : s1.v + s2.v, path: [...s1.path, ...s2.path.slice(1)], table: s2.r, parts: [s1.v, s2.v] };
  }

  let labLoadId = 0;
  // Лаборатория Arduino — отдельное приложение (/arduino/) со своим паролем: пароль лабораторий его не открывает
  async function openArdGate() {
    if (!leaveExam()) return;
    const ticket = ++labLoadId, current = learningSessionGuard();
    if (isNarrow()) setSideOpen(false);
    abandonCurrent(); appState.cur = null;
    appState.courseShown = true; appState.pageKind = 'ardgate';
    navPush({ v: 'ardgate' });
    renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория Arduino</span>';
    trainerEl.innerHTML = '<p class="fm-note">Проверяю доступ к лаборатории Arduino…</p>';
    try { const me = await api('me'); if (!current() || ticket !== labLoadId) return; appState.ARD_OK = !!me.ard; appState.ARD_PW = !!me.ard_pw; }
    catch (err) { if (!current() || ticket !== labLoadId) return; if (appState.pageKind === 'ardgate') { trainerEl.innerHTML = '<p class="fm-note">Не удалось проверить доступ. Попробуй ещё раз.</p>'; netError(err); } return; }
    if (!current() || ticket !== labLoadId || appState.pageKind !== 'ardgate' || !appState.courseShown) return;
    if (appState.ARD_OK) { location.replace('arduino/'); return; }
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><h2>Лаборатория Arduino — по паролю</h2>
      <p>${appState.ARD_PW ? 'Это отдельный раздел: пароль выдаёт учитель, он не совпадает с паролем лабораторий. После ввода доступ сохранится в твоём аккаунте.' : 'Учитель ещё не открыл лабораторию Arduino.'}</p>
      ${appState.ARD_PW ? '<form id="ardPasswordForm" class="login-form crs-lock-form"><input id="ardPassword" class="inp" type="password" maxlength="200" autocomplete="off" placeholder="Пароль лаборатории Arduino" aria-label="Пароль лаборатории Arduino" required><button class="btn primary">Открыть</button></form><p id="ardPasswordError" role="alert"></p>' : ''}</div></div>`;
    $('#ardPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.currentTarget.querySelector('button'), msg = $('#ardPasswordError'); btn.disabled = true;
      try { await api('arduino/unlock', { password: $('#ardPassword').value }); if (!current()) return; appState.ARD_OK = true; location.replace('arduino/'); }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  }
  function labLock(configured, view) {
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><h2>Лаборатории — по паролю</h2>
      <p>${configured ? 'Пароль выдаёт учитель. После ввода доступ сохранится в твоём аккаунте.' : 'Учитель ещё не настроил доступ к лабораториям.'}</p>
      ${LAB.context ? '<button class="link-btn" type="button" data-learning-return>← Вернуться к уроку</button>' : ''}
      ${configured ? '<form id="labPasswordForm" class="login-form crs-lock-form"><input id="labPassword" class="inp" type="password" maxlength="200" autocomplete="off" placeholder="Пароль лабораторий" aria-label="Пароль лабораторий" required><button class="btn primary">Открыть</button></form><p id="labPasswordError" role="alert"></p>' : ''}</div></div>`;
    $('#labPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const current = learningSessionGuard(), form = e.currentTarget, btn = form.querySelector('button'), msg = $('#labPasswordError'); btn.disabled = true;
      try { await api('lab/unlock', { password: $('#labPassword').value }); if (current()) await openLab(view); }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  }
  const LAB_EXAMPLES = {
    sum: ['Сумма чисел', 'numbers = [4, 7, 2]\ntotal = 0\nfor x in numbers:\n    total += x\nprint(total)'],
    branch: ['Условие и цикл', 'for n in range(1, 6):\n    if n % 2 == 0:\n        result = n * n\n        print(n, result)'],
    list: ['Изменение списка', 'numbers = [3, 1, 4]\nfor i in range(len(numbers)):\n    numbers[i] *= 2\nprint(numbers)'],
    function: ['Вызовы функций', 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nanswer = factorial(4)\nprint(answer)']
  };
  const LAB = { view: '', mode: 'net', worker: null, timeout: null, play: null, running: false, result: null, index: 0,
    code: '', stdin: '', owner: null, net: { ip: '192.168.1.130', prefix: 26 }, picture: { w: 640, h: 480, depth: 8 },
    context: null, bps: new Set(), seen: null, game: { start: 17, second: 29, heaps: 2, target: 133, add: 4, factor: 2, path: [[17, 29]] },
    logic: { kind: 'div', a: 5, segA: 5, segB: 20 },
    graph: { kind: 'count', start: 'A', end: 'H', via: '', banned: new Set(), shown: 99 } };
  const labActive = () => appState.courseShown && appState.pageKind === 'lab' && !!$('#labRoot');
  const labFmt = n => n.toLocaleString('ru-RU');
  const labIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>';
  function labSaveDraft() { if (LAB.context) { LAB.context.code = LAB.code; LAB.context.stdin = LAB.stdin; if (LAB.context.task) writeCode('pyc:' + LAB.context.task, LAB.code); } else writeJSON(codeKey('laboratory'), { code: LAB.code, stdin: LAB.stdin }); }
  function labPause() { clearInterval(LAB.play); LAB.play = null; const b = $('#labPlay'); if (b) b.textContent = 'Воспроизвести'; }
  function labStop() {
    labPause();
    clearTimeout(LAB.timeout); LAB.timeout = null;
    if (LAB.worker) LAB.worker.terminate();
    LAB.worker = null; LAB.running = false;
  }
  async function openLab(view = '', context, target) {
    if (!leaveExam()) return;
    if (view === 'arduino') return openArdGate();       // у лаборатории Arduino — свой пароль
    if (!['', 'tasks', 'code', 'bugs'].includes(view)) view = '';
    labStop();
    if (LAB.owner && LAB.owner !== codeKey('laboratory')) LAB.context = null;
    if (context) LAB.context = context;
    if (LAB.owner !== codeKey('laboratory')) {
      const saved = readJSON(codeKey('laboratory'));
      LAB.code = saved && typeof saved.code === 'string' ? saved.code.slice(0, 30000) : LAB_EXAMPLES.sum[1];
      LAB.stdin = saved && typeof saved.stdin === 'string' ? saved.stdin.slice(0, 10000) : '';
      LAB.result = null; LAB.index = 0; LAB.owner = codeKey('laboratory');
    }
    if (isNarrow()) setSideOpen(false);
    if (pyOpen()) togglePy(false);
    if (bdOpen()) toggleBoard(false);
    abandonCurrent(); appState.cur = null;
    appState.courseShown = true; appState.pageKind = 'lab'; LAB.view = view;
    navPush({ v: 'lab', tab: view });
    const ticket = ++labLoadId, current = learningSessionGuard();
    if (SERVER) {
      trainerEl.innerHTML = '<p class="fm-note">Проверяю доступ к лабораториям…</p>';
      try {
        const access = await api('lab');
        if (!current() || ticket !== labLoadId || appState.pageKind !== 'lab' || !appState.courseShown) return;
        appState.LAB_OK = !!access.access;
        if (!appState.LAB_OK) { labLock(access.pw, view); return; }
        await loadCourseCoverage();
        if (!current() || ticket !== labLoadId || appState.pageKind !== 'lab' || !appState.courseShown) return;
      } catch (err) { if (current() && ticket === labLoadId && appState.pageKind === 'lab') { trainerEl.innerHTML = '<p class="fm-note">Не удалось проверить доступ. Открой лабораторию ещё раз.</p>'; netError(err); } return; }
    }
    if (context) { LAB.code = context.code || ''; LAB.stdin = context.stdin || ''; LAB.result = null; LAB.index = 0; }
    else if (LAB.context) { LAB.code = LAB.context.code || ''; LAB.stdin = LAB.context.stdin || ''; }

    if (view === 'tasks' && target && courseCoverage?.labs?.some(m => m.id === target)) LAB.mode = target;
    document.body.classList.add('lab-open');
    document.body.classList.remove('asg-wide');
    renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория</span><span class="scope-stats">Исследуй и проверяй идеи</span>';
    $('#sessionInfo').textContent = '';
    const titles = { '': ['Лаборатория', 'Меняй условия, проверяй гипотезы и разбирайся, как всё работает.'], tasks: ['Лаборатории по заданиям ЕГЭ', 'Сначала предположи результат. Затем проверь его на модели.'], code: ['Лаборатория программирования', 'Свой Python-код, значения переменных и выполнение по шагам.'] , bugs: ['Лаборатория исправления ошибок', 'Чужое решение не работает. Найди, что в нём не так, и почини.'] };
    const [title, sub] = titles[view];
    trainerEl.innerHTML = `<div class="lab" id="labRoot">
      ${LAB.context ? `<div class="learning-return"><button class="btn" type="button" data-learning-return>← Вернуться к уроку</button><span>${esc(LAB.context.label || 'Код и условие урока')}</span>${LAB.context.condition ? `<div class="cond">${safeHtml(LAB.context.condition)}</div>` : ''}</div>` : ''}
      ${view ? '<button type="button" class="link-btn lab-back" data-open-learning-group="labs">← Все лаборатории</button>' : ''}
      <header class="lab-header"><span class="lab-mark">${labIcon}</span><div><h1>${title}</h1><p>${sub}</p></div></header>
      ${view === 'tasks' ? labTasksHtml() : view === 'code' ? labCodeHtml() : view === 'bugs' ? bugLabHtml() : `<div class="lab-cards">
        <button type="button" class="lab-entry" data-lab-view="tasks"><span class="lab-kicker">${courseCoverage?.labs ? '№ ' + courseCoverage.labs.filter(m => !m.archive).map(m => esc(m.label)).join(' · ') : 'Модели заданий'}</span><h2>По заданиям ЕГЭ</h2><p>Алгоритмы над числами, изображения, подсети, логика, пары, игры, строки, маски, сортировка и кластеры — на наглядных моделях.</p><b>Начать эксперимент →</b></button>
        <button type="button" class="lab-entry" data-lab-view="code"><span class="lab-kicker">Python</span><h2>Программирование</h2><p>Смотри, какая строка выполняется, как меняются переменные и что выводит программа.</p><b>Открыть лабораторию →</b></button>
        ${SERVER ? '<button type="button" class="lab-entry" data-lab-view="bugs"><span class="lab-kicker">Python · поиск ошибок</span><h2>Исправление ошибок</h2><p>Задача и чужое решение: в нём ошибки, пропуск или оно слишком медленное. Почини код так, чтобы он прошёл все тесты.</p><b>Искать ошибки →</b></button>' : ''}</div>
        <p class="lab-note">Здесь можно пробовать и ошибаться: эксперименты не меняют оценки и награды за задания.</p>`}
      </div>`;
    if (view === 'tasks') labRenderModel();
    if (view === 'code') { if (LAB.result && !LAB.seen) labIndexSteps(); labPaintEditor(); labRenderStep(); }
    if (view === 'bugs') bugLabInit(target);
    if (SERVER && (view === 'tasks' || view === 'code')) {
      const activity = view === 'tasks' ? { section: 'model', model: LAB.mode } : { section: 'code' };
      api('lab/activity', activity).catch(() => {});  // статистика просмотра не блокирует работу модели
    }
    window.scrollTo(0, 0);
  }
  function labTasksHtml() {
    const models = courseCoverage?.labs || [['alg', 'Алгоритмы'], ['image', 'Изображения'], ['net', 'IP-сети'], ['logic', 'Логика'], ['pairs', 'Пары'], ['game', 'Игры'], ['str', 'Строки'], ['mask', 'Маски и делители'], ['sort', 'Сортировка'], ['clust', 'Кластеры'], ['graph', 'Графы']].map(([id, title]) => ({id, title}));
    return `<nav class="lab-tabs" aria-label="Эксперименты">${models.map(m => `<button type="button" class="btn${LAB.mode === m.id ? ' primary' : ''}" data-lab-model="${esc(m.id)}" aria-pressed="${LAB.mode === m.id}">${m.label ? `${m.archive ? 'Архив · ' : '№ '}${esc(m.label)} · ` : ''}${esc(m.title)}</button>`).join('')}</nav><p class="lab-note">${courseCoverage?.edition ? esc(courseCoverage.edition.label) + '. Архивные модели помечены отдельно.' : 'Справочник номеров сейчас недоступен; модели можно использовать без номера экзамена.'} Модели тренируют отдельные навыки, а условия экзамена могут быть сложнее.</p><div id="labModel"></div>`;
  }
  function recordLabPrediction(right) {
    if (right && SERVER && !appState.teacher) api('lab/activity', { section: 'model', model: LAB.mode, prediction: true }).catch(() => {});
  }
  function labPrediction(question) {
    return `<form class="lab-predict" id="labPredict"><div><b>Проверь предположение</b><p>${question}</p></div><label>Твой ответ<input class="inp" id="labGuess" aria-describedby="labFeedback" required inputmode="numeric" autocomplete="off" maxlength="20"></label><button class="btn" type="submit">Проверить</button><p id="labFeedback" class="lab-feedback" role="status"></p></form>`;
  }
  // ---------- Модели №5, 17, 24, 25, 26, 27. Каждая: html() — разметка, update() — пересчёт, answer() — ответ на «Проверь предположение».
  const lxRand = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lxVal = id => $('#' + id)?.value ?? '';
  const lxNum = (id, lo, hi, def) => { const v = Math.round(+lxVal(id)); const ok = lxVal(id) !== '' && Number.isFinite(v) && v >= lo && v <= hi; $('#' + id)?.toggleAttribute('aria-invalid', !ok); return ok ? v : def; };
  const lxSel = (id, opts, cur) => `<select class="inp" id="${id}" data-lx>${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const LX_RULES5 = {
    ones: { name: 'Чётность единиц', text: 'Строится двоичная запись N. Дважды: справа дописывается остаток от деления количества единиц на 2. Результат R переводится в десятичную систему.',
      run(n) { let b = n.toString(2); const parts = [[b, '']]; for (let i = 0; i < 2; i++) { const d = String([...b].filter(c => c === '1').length % 2); b += d; parts.push([b, d]); } return { bits: b, steps: parts.slice(1).map(([s, d], i) => `${i + 1}) единиц в ${s.slice(0, -1)}: ${[...s.slice(0, -1)].filter(c => c === '1').length} → дописываем ${d}`) }; } },
    parity: { name: 'Чётное / нечётное N', text: 'Строится двоичная запись N. Если N чётное — слева дописывается 10; если нечётное — слева 1 и справа 01. Результат R переводится в десятичную систему.',
      run(n) { const b = n.toString(2); return n % 2 === 0 ? { bits: '10' + b, steps: [`N = ${n} чётное → 10 + ${b}`] } : { bits: '1' + b + '01', steps: [`N = ${n} нечётное → 1 + ${b} + 01`] }; } },
    mod3: { name: 'Остаток от деления на 3', text: 'Строится двоичная запись N. Если N делится на 3 — справа дописываются три последние двоичные цифры; иначе — остаток от деления на 3, умноженный на 3, в двоичной записи.',
      run(n) { const b = n.toString(2); if (n % 3 === 0) return { bits: b + b.slice(-3), steps: [`N = ${n} делится на 3 → дописываем ${b.slice(-3)}`] }; const t = ((n % 3) * 3).toString(2); return { bits: b + t, steps: [`N = ${n}: остаток ${n % 3}, ${n % 3} × 3 = ${(n % 3) * 3} = ${t}₂ → дописываем`] }; } },
  };
  const LX_KINDS17 = { one: 'хотя бы одно делится на K', exactly: 'ровно одно делится на K', both: 'оба делятся на K' };
  const LX_TASKS24 = { same: 'Самая длинная цепочка одинаковых символов', alt: 'Самая длинная цепочка без двух одинаковых соседей', only: 'Самая длинная цепочка только из X и Y' };
  function lxLongest(s, kind) {
    let best = [0, 0], start = 0;
    for (let i = 0; i < s.length; i++) {
      const ok = kind === 'same' ? i > start && s[i] === s[i - 1] || i === start : kind === 'alt' ? i === start || s[i] !== s[i - 1] : /[XY]/.test(s[i]);
      if (!ok) start = kind === 'only' ? i + 1 : i;
      if (kind !== 'only' || ok) { const len = i - start + 1; if (len > best[1] - best[0]) best = [start, i + 1]; }
    }
    return best;
  }
  function lxMask(mask, d, limit) {
    // ? — ровно одна цифра, * — любая последовательность цифр, в том числе пустая. Перебор кандидатов по маске, затем проверка делимости.
    if (!/^[\d?*]{1,12}$/.test(mask) || (mask.match(/\*/g) || []).length > 1) throw Error('Маска: цифры, знаки ? и не больше одной *, до 12 символов.');
    const q = (mask.match(/\?/g) || []).length, star = mask.includes('*'), free = 10 - mask.replace(/[?*]/g, '').length - q;
    if (q > 4 || (star && q > 2)) throw Error('Слишком широкая маска для модели: не больше 4 знаков ? (с * — не больше 2).');
    const out = [], fill = (s, i) => {
      if (i === s.length) { if (s[0] !== '0' || s === '0') { const n = +s; if (n <= limit && n % d === 0) out.push(n); } return; }
      if (s[i] === '?') { for (let c = 0; c < 10; c++) fill(s.slice(0, i) + c + s.slice(i + 1), i + 1); return; }
      if (s[i] === '*') { for (let len = 0; len <= Math.min(q >= 2 ? 3 : 4, Math.max(0, free)); len++) for (let k = 0; k < 10 ** len; k++) fill(s.slice(0, i) + (len ? String(k).padStart(len, '0') : '') + s.slice(i + 1), i + (len ? len : 0)); return; }
      fill(s, i + 1);
    };
    fill(mask, 0);
    return [...new Set(out)].sort((a, b) => a - b);
  }
  function lxClusters(pts, eps) {
    const id = pts.map(() => -1); let k = 0;
    pts.forEach((_, s) => { if (id[s] >= 0) return; const st = [s]; id[s] = k;
      while (st.length) { const a = st.pop(); pts.forEach((p, b) => { if (id[b] < 0 && Math.hypot(p[0] - pts[a][0], p[1] - pts[a][1]) <= eps) { id[b] = k; st.push(b); } }); } k++; });
    const groups = Array.from({ length: k }, (_, c) => pts.filter((_, i) => id[i] === c));
    const centers = groups.map(g => g.reduce((best, p) => { const s = g.reduce((t, q) => t + Math.hypot(p[0] - q[0], p[1] - q[1]), 0); return s < best[1] ? [p, s] : best; }, [g[0], Infinity])[0]);
    return { id, groups, centers };
  }
  const LAB_EXTRA = {
    alg: {
      state: { rule: 'ones', n: 13, t: 100 },
      html() { const s = this.state; return `<section class="lab-panel"><h2>Как алгоритм превращает N в R?</h2>
        <div class="lab-tabs lab-subtabs">${Object.entries(LX_RULES5).map(([k, r]) => `<button type="button" class="btn${k === s.rule ? ' primary' : ''}" data-lx-act="rule" data-v="${k}">${r.name}</button>`).join('')}</div>
        <p class="lab-expr">${LX_RULES5[s.rule].text}</p>
        <div class="lab-fields"><label>N = <span id="lxNLabel">${s.n}</span><input type="range" id="lxN" data-lx min="1" max="128" value="${s.n}"></label><label>Порог для вопроса: R &gt;<input class="inp" type="number" id="lxT" data-lx min="1" max="100000" value="${s.t}"></label></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Какое наименьшее N даёт R больше порога?')}</section>`; },
      update() { const s = this.state; s.n = lxNum('lxN', 1, 128, s.n); s.t = lxNum('lxT', 1, 100000, s.t); $('#lxNLabel').textContent = s.n;
        const r = LX_RULES5[s.rule].run(s.n), b0 = s.n.toString(2);
        $('#lxOut').innerHTML = `<div class="lab-bits"><span class="lab-octet">${[...r.bits].map((c, i) => `<b class="${s.rule === 'parity' && s.n % 2 === 0 ? (i < 2 ? 'network' : 'host') : s.rule === 'parity' ? (i === 0 || i >= r.bits.length - 2 ? 'network' : 'host') : (i < b0.length ? 'host' : 'network')}">${c}</b>`).join('')}</span></div>
          <p class="lab-path">${r.steps.join('<br>')}</p>
          <dl class="lab-facts"><div><dt>N в двоичной</dt><dd>${s.n} = ${b0}₂</dd></div><div><dt>Результат R</dt><dd>${r.bits}₂ = ${parseInt(r.bits, 2)}</dd></div></dl>
          <p class="lab-note">Голубые цифры дописаны алгоритмом. В задании ЕГЭ обычно спрашивают наименьшее N, при котором R больше заданного числа: программа перебирает N подряд.</p>`; },
      answer() { const s = this.state; for (let n = 1; n < 1e6; n++) if (parseInt(LX_RULES5[s.rule].run(n).bits, 2) > s.t) return { expected: n, why: `При N = ${n}: R = ${parseInt(LX_RULES5[s.rule].run(n).bits, 2)} > ${s.t}, а при меньших N результат не больше порога.` }; return { expected: null, why: 'Подходящего N не нашлось.' }; },
    },
    pairs: {
      state: { seed: 17, kind: 'one', k: 3 },
      nums() { const r = lxRand(this.state.seed); return Array.from({ length: 14 }, () => 1 + Math.floor(r() * 99)); },
      html() { const s = this.state; return `<section class="lab-panel"><h2>Пары соседних чисел</h2>
        <p class="lab-note">Пара — два элемента, стоящие рядом. В файле ЕГЭ чисел тысячи, условие то же: перебрать i от 0 до n − 2 и проверить a[i], a[i + 1].</p>
        <div class="lab-fields"><label>Условие${lxSel('lxKind', Object.entries(LX_KINDS17), s.kind)}</label><label>K =<input class="inp" type="number" id="lxK" data-lx min="2" max="20" value="${s.k}"></label><button class="btn ghost" type="button" data-lx-act="new">Новые числа</button></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Сколько пар удовлетворяют условию?')}</section>`; },
      calc() { const s = this.state, a = this.nums(), d = x => x % s.k === 0;
        const ok = a.slice(1).map((y, i) => { const c = d(a[i]) + d(y); return s.kind === 'one' ? c >= 1 : s.kind === 'exactly' ? c === 1 : c === 2; }); return { a, ok }; },
      update() { const s = this.state; s.kind = lxVal('lxKind') || s.kind; s.k = lxNum('lxK', 2, 20, s.k);
        const { a, ok } = this.calc(), sums = a.slice(1).map((y, i) => a[i] + y).filter((_, i) => ok[i]);
        $('#lxOut').innerHTML = `<div class="lx-seq">${a.map((x, i) => `<span class="${x % s.k === 0 ? 'div' : ''}">${x}</span>${i < a.length - 1 ? `<i class="${ok[i] ? 'ok' : 'no'}" title="пара ${x} и ${a[i + 1]}">${ok[i] ? '✓' : '·'}</i>` : ''}`).join('')}</div>
          <dl class="lab-facts"><div><dt>Числа, кратные ${s.k}</dt><dd>${a.filter(x => x % s.k === 0).join(', ') || 'нет'}</dd></div><div><dt>Наибольшая сумма подходящей пары</dt><dd>${sums.length ? Math.max(...sums) : '—'}</dd></div></dl>
          <p class="lab-note">Выделены числа, кратные K. Галочка между числами — пара подходит.</p>`; },
      answer() { const { ok } = this.calc(), n = ok.filter(Boolean).length; return { expected: n, why: `Подходящих пар: ${n} из ${ok.length}. Всего пар на одну меньше, чем чисел.` }; },
    },
    str: {
      state: { task: 'same', s: 'XYZZZYXYXYYXZZZZYXYZYXXYXYXYZZYX' },
      html() { const st = this.state; return `<section class="lab-panel"><h2>Самая длинная подходящая цепочка</h2>
        <div class="lab-fields"><label>Что ищем${lxSel('lxTask', Object.entries(LX_TASKS24), st.task)}</label><button class="btn ghost" type="button" data-lx-act="new">Случайная строка</button></div>
        <label class="lx-wide">Строка из букв X, Y, Z<input class="inp" id="lxS" data-lx maxlength="80" spellcheck="false" value="${esc(st.s)}"></label>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Какова длина самой длинной подходящей цепочки?')}</section>`; },
      update() { const st = this.state; st.task = lxVal('lxTask') || st.task; const raw = lxVal('lxS').toUpperCase().replace(/[^XYZ]/g, ''); st.s = raw || st.s;
        $('#lxS').toggleAttribute('aria-invalid', !raw);
        const [a, b] = lxLongest(st.s, st.task);
        $('#lxOut').innerHTML = `<div class="lx-chars">${[...st.s].map((c, i) => `<b class="${i >= a && i < b ? 'on' : ''}">${c}</b>`).join('')}</div>
          <dl class="lab-facts"><div><dt>Найденная цепочка</dt><dd>${st.s.slice(a, b) || '—'}</dd></div><div><dt>Длина</dt><dd>${b - a}</dd></div></dl>
          <p class="lab-note">Один проход слева направо: держим длину текущей цепочки и обнуляем её, когда условие нарушено; максимум запоминаем. Так решают и для строки в миллион символов.</p>`; },
      answer() { const [a, b] = lxLongest(this.state.s, this.state.task); return { expected: b - a, why: `Цепочка ${this.state.s.slice(a, b)} начинается с позиции ${a + 1}.` }; },
    },
    mask: {
      state: { sub: 'mask', mask: '12??36*1', d: 317, n: 360 },
      html() { const st = this.state; return `<section class="lab-panel"><h2>${st.sub === 'mask' ? 'Числа по маске, кратные D' : 'Делители числа: перебор до корня'}</h2>
        <div class="lab-tabs lab-subtabs"><button type="button" class="btn${st.sub === 'mask' ? ' primary' : ''}" data-lx-act="sub" data-v="mask">Маска</button><button type="button" class="btn${st.sub === 'div' ? ' primary' : ''}" data-lx-act="sub" data-v="div">Делители</button></div>
        ${st.sub === 'mask' ? `<p class="lab-note">? — ровно одна цифра; * — любая последовательность цифр, возможно пустая. Числа не больше 10<sup>10</sup>, без ведущего нуля.</p>
          <div class="lab-fields"><label>Маска<input class="inp" id="lxM" data-lx maxlength="12" spellcheck="false" value="${esc(st.mask)}"></label><label>D =<input class="inp" type="number" id="lxD" data-lx min="2" max="100000" value="${st.d}"></label></div>`
        : `<p class="lab-note">Делители идут парами: d и N / d. Достаточно проверить d до √N — вторую половину даёт деление.</p>
          <div class="lab-fields"><label>N =<input class="inp" type="number" id="lxDN" data-lx min="2" max="1000000" value="${st.n}"></label></div>`}
        <div id="lxOut" aria-live="polite"></div>${labPrediction(st.sub === 'mask' ? 'Сколько чисел подходят под маску и делятся на D?' : 'Сколько делителей у числа N (включая 1 и N)?')}</section>`; },
      update() { const st = this.state;
        if (st.sub === 'div') { st.n = lxNum('lxDN', 2, 1000000, st.n); const r = Math.floor(Math.sqrt(st.n)), pairs = [];
          for (let d = 1; d <= r; d++) if (st.n % d === 0) pairs.push(d * d === st.n ? [d] : [d, st.n / d]);
          $('#lxOut').innerHTML = `<div class="lx-seq">${pairs.map(p => `<span class="div">${p.join(' · ')}</span>`).join('')}</div>
            <dl class="lab-facts"><div><dt>Проверено кандидатов</dt><dd>${r} (до √${st.n} ≈ ${Math.sqrt(st.n).toFixed(2)}) вместо ${st.n}</dd></div><div><dt>Все делители по возрастанию</dt><dd>${pairs.flatMap(p => [p[0]]).concat(pairs.slice().reverse().filter(p => p[1]).map(p => p[1])).join(', ')}</dd></div></dl>`; return; }
        st.mask = lxVal('lxM').trim() || st.mask; st.d = lxNum('lxD', 2, 100000, st.d); $('#lxM').removeAttribute('aria-invalid');
        try { const r = lxMask(st.mask, st.d, 1e10);
          $('#lxOut').innerHTML = `<div class="lx-chars">${[...st.mask].map(c => `<b class="${c === '?' || c === '*' ? 'on' : ''}">${c}</b>`).join('')}</div>
            <dl class="lab-facts"><div><dt>Найдено чисел</dt><dd>${r.length}</dd></div><div><dt>Первые числа и частные</dt><dd>${r.slice(0, 6).map(n => `${n} (${n / st.d})`).join('<br>') || 'нет'}${r.length > 6 ? '<br>…' : ''}</dd></div></dl>`;
        } catch (e) { $('#lxM').setAttribute('aria-invalid', 'true'); $('#lxOut').textContent = e.message; } },
      answer() { const st = this.state; if (st.sub === 'div') { let c = 0; for (let d = 1; d * d <= st.n; d++) if (st.n % d === 0) c += d * d === st.n ? 1 : 2; return { expected: c, why: 'Каждый делитель d ≤ √N даёт пару N / d; квадратный корень считается один раз.' }; }
        const r = lxMask(st.mask, st.d, 1e10); return { expected: r.length, why: r.length ? `Наименьшее: ${r[0]} = ${st.d} × ${r[0] / st.d}.` : 'Подходящих чисел нет.' }; },
    },
    sort: {
      state: { seed: 26, cap: 100 },
      sizes() { const r = lxRand(this.state.seed); return Array.from({ length: 12 }, () => 5 + Math.floor(r() * 40)); },
      solve() { const cap = this.state.cap, a = this.sizes().slice().sort((x, y) => x - y), take = []; let used = 0;
        for (const x of a) { if (used + x > cap) break; take.push(x); used += x; }
        // улучшаем: самый большой файл, который можно поставить вместо последнего взятого
        let big = take.length ? take[take.length - 1] : 0;
        if (take.length) { const rest = used - big, cand = a.filter((x, i) => i >= take.length - 1 && rest + x <= cap); big = Math.max(...cand); }
        return { a, take, used, count: take.length, big, total: take.length ? used - take[take.length - 1] + big : 0 }; },
      html() { const st = this.state; return `<section class="lab-panel"><h2>Сколько файлов поместится на диск?</h2>
        <p class="lab-note">Жадный приём из №26: чтобы файлов было больше всего, берём самые маленькие. Потом последний взятый файл заменяем самым большим, который ещё помещается, — так находят наибольший возможный размер файла при максимальном количестве.</p>
        <div class="lab-fields"><label>Объём диска: <span id="lxCapLabel">${st.cap}</span><input type="range" id="lxCap" data-lx min="20" max="250" value="${st.cap}"></label><button class="btn ghost" type="button" data-lx-act="new">Другие файлы</button></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Какое наибольшее количество файлов поместится на диск?')}</section>`; },
      update() { const st = this.state; st.cap = lxNum('lxCap', 20, 250, st.cap); $('#lxCapLabel').textContent = st.cap; const r = this.solve();
        const pct = x => (x / st.cap * 100).toFixed(2) + '%';
        $('#lxOut').innerHTML = `<div class="lx-seq">${r.a.map((x, i) => `<span class="${i < r.count ? 'div' : ''}">${x}</span>`).join('')}</div>
          <div class="lx-disk" role="img" aria-label="Занято ${r.used} из ${st.cap}">${r.take.map(x => `<i style="width:${pct(x)}">${x}</i>`).join('')}</div>
          <dl class="lab-facts"><div><dt>Файлов поместилось</dt><dd>${r.count} (занято ${r.used} из ${st.cap})</dd></div><div><dt>Наибольший возможный файл при этом</dt><dd>${r.count ? `${r.big}: замена ${r.take[r.count - 1]} → ${r.big}, итого ${r.total}` : '—'}</dd></div></dl>`; },
      answer() { const r = this.solve(); return { expected: r.count, why: `После сортировки по возрастанию помещаются ${r.take.join(' + ') || '0'} = ${r.used}; следующий файл уже не влезает.` }; },
    },
    clust: {
      state: { seed: 27, eps: 1.2 },
      points() { const r = lxRand(this.state.seed), c = [[2.5, 2.5], [7, 3], [4.5, 7.2]], pts = [];
        c.forEach(([x, y], k) => { for (let i = 0; i < 9 + k * 2; i++) pts.push([+(x + (r() - .5) * 2.6).toFixed(2), +(y + (r() - .5) * 2.4).toFixed(2)]); });
        return pts; },
      html() { const st = this.state; return `<section class="lab-panel"><h2>Кластеры и центроиды</h2>
        <p class="lab-note">Точки одного кластера соединены цепочкой соседей на расстоянии не больше R. Центроид — точка кластера с наименьшей суммой расстояний до остальных его точек (как в №27).</p>
        <div class="lab-fields"><label>R = <span id="lxEpsLabel">${st.eps}</span><input type="range" id="lxEps" data-lx min="0.3" max="4" step="0.1" value="${st.eps}"></label><button class="btn ghost" type="button" data-lx-act="new">Другие точки</button></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Сколько кластеров получится при этом R?')}</section>`; },
      update() { const st = this.state; st.eps = Math.max(.3, Math.min(4, +lxVal('lxEps') || st.eps)); $('#lxEpsLabel').textContent = st.eps.toFixed(1);
        const pts = this.points(), c = lxClusters(pts, st.eps), X = x => 20 + x * 46, Y = y => 470 - y * 46, col = i => `hsl(${(i * 137) % 360} 70% 45%)`;
        const avg = c.centers.length ? c.centers.reduce((s, p) => s + p[0], 0) / c.centers.length : 0;
        $('#lxOut').innerHTML = `<svg class="lx-plot" viewBox="0 0 500 490" role="img" aria-label="Точки на плоскости: ${c.groups.length} кластеров">
            ${[0, 2, 4, 6, 8, 10].map(t => `<line x1="${X(t)}" y1="${Y(0)}" x2="${X(t)}" y2="${Y(10)}"/><line x1="${X(0)}" y1="${Y(t)}" x2="${X(10)}" y2="${Y(t)}"/><text x="${X(t)}" y="${Y(0) + 16}">${t}</text>${t ? `<text x="${X(0) - 10}" y="${Y(t) + 4}">${t}</text>` : ''}`).join('')}
            ${pts.map((p, i) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="6" fill="${col(c.id[i])}"><title>(${p[0]}; ${p[1]})</title></circle>`).join('')}
            ${c.centers.map((p, i) => `<circle class="cen" cx="${X(p[0])}" cy="${Y(p[1])}" r="12" style="stroke:${col(i)}"/>`).join('')}</svg>
          <dl class="lab-facts"><div><dt>Кластеров</dt><dd>${c.groups.length}</dd></div><div><dt>Центроиды</dt><dd>${c.centers.map((p, i) => `(${p[0]}; ${p[1]}) — ${c.groups[i].length} точ.`).join('<br>')}</dd></div>
            <div><dt>Среднее X центроидов × 10000, целая часть</dt><dd>${Math.trunc(avg * 10000)}</dd></div></dl>
          <p class="lab-note">Маленький R дробит кластеры, большой — сливает их. В задании расстояние подбирают так, чтобы группы разделились так, как видно на графике.</p>`; },
      answer() { const n = lxClusters(this.points(), this.state.eps).groups.length; return { expected: n, why: `При R = ${this.state.eps.toFixed(1)} точки распадаются на ${n} групп${n === 1 ? 'у' : n < 5 ? 'ы' : ''}.` }; },
    },
  };
  function labRenderModel() {
    const box = $('#labModel'); if (!box) return;
    if (LAB_EXTRA[LAB.mode]) { box.innerHTML = LAB_EXTRA[LAB.mode].html(); LAB_EXTRA[LAB.mode].update(); return; }
    if (LAB.mode === 'net') {
      box.innerHTML = `<section class="lab-panel"><h2>Где заканчивается сеть и начинается адрес узла?</h2>
        ${appState.teacher ? '<p><a class="btn" href="/admin?assign=lab13">Назначить классу</a></p>' : ''}
        <div class="lab-fields"><label>IPv4-адрес<input class="inp" id="labIp" aria-describedby="labNetResult" value="${esc(LAB.net.ip)}" spellcheck="false" maxlength="15"></label><label>Маска /<span id="labPrefixLabel">${LAB.net.prefix}</span><input type="range" id="labPrefix" min="0" max="32" value="${LAB.net.prefix}"></label></div>
        <p class="lab-note">Голубые биты задают сеть, остальные — адрес внутри неё. Все адреса считаются вместе с адресом сети и широковещательным адресом.</p>
        <div id="labNetResult" aria-live="polite"></div>
        ${labPrediction('Сколько всего IPv4-адресов в этой подсети?')}</section>`;
      labUpdateNetwork();
    } else if (LAB.mode === 'image') {
      const p = LAB.picture;
      box.innerHTML = `<section class="lab-panel"><h2>Как глубина цвета влияет на объём?</h2><div class="lab-fields">
        <label>Ширина, пиксели<input class="inp" type="number" id="labWidth" aria-describedby="labImageResult" min="1" max="8192" value="${p.w}"></label>
        <label>Высота, пиксели<input class="inp" type="number" id="labHeight" aria-describedby="labImageResult" min="1" max="8192" value="${p.h}"></label>
        <label>Бит на пиксель: <span id="labDepthLabel">${p.depth}</span><input type="range" id="labDepth" aria-describedby="labImageResult" min="1" max="24" value="${p.depth}"></label></div>
        <div class="lab-image-demo"><canvas id="labCanvas" width="256" height="128" aria-label="Пример изменения палитры изображения"></canvas><div id="labImageResult" aria-live="polite"></div></div>
        <p class="lab-note">Модель без сжатия, заголовков и выравнивания строк. Биты упакованы подряд; итог округляется вверх до целого байта. Иллюстрация показывает изменение палитры, её размер на экране условный.</p>
        ${labPrediction('Сколько байт занимает это изображение?')}</section>`;
      labUpdateImage();
    } else if (LAB.mode === 'logic') {
      const L = LAB.logic, m = LAB_LOGIC[L.kind];
      box.innerHTML = `<section class="lab-panel"><h2>При каком A выражение истинно для любого x?</h2>
        <div class="lab-tabs lab-subtabs">${Object.entries(LAB_LOGIC).map(([k, x]) => `<button type="button" class="btn${k === L.kind ? ' primary' : ''}" data-lab-logic="${k}">${x.name}</button>`).join('')}</div>
        <p class="lab-expr">${m.expr}</p><p class="lab-note">${m.note}</p>
        <div class="lab-fields">${L.kind === 'seg'
          ? `<label>Начало A: <span id="labSegALabel">${L.segA}</span><input type="range" id="labSegA" min="0" max="60" value="${L.segA}"></label><label>Конец A: <span id="labSegBLabel">${L.segB}</span><input type="range" id="labSegB" min="0" max="60" value="${L.segB}"></label>`
          : `<label>A = <span id="labALabel">${L.a}</span><input type="range" id="labA" min="1" max="${m.aMax}" value="${L.a}"></label>`}</div>
        <div id="labLogicResult" aria-live="polite"></div>
        ${labPrediction(L.kind === 'seg' ? 'Какова наименьшая возможная длина отрезка A?' : `Какое ${m.ask === 'max' ? 'наибольшее' : 'наименьшее'} натуральное A подходит?`)}</section>`;
      labUpdateLogic();
    } else if (LAB.mode === 'graph') {
      const G = LAB.graph, opt = sel => LAB_G.order.map(v => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');
      box.innerHTML = `<section class="lab-panel"><h2>Как программа считает пути в графе</h2>
        <p class="lab-note">Граф ациклический: стрелки ведут только вперёд. Число в вершине — ответ «отсюда до конца». Программа из урока считает его так же: от конечной вершины назад, складывая (или выбирая min / max) ответы соседей. Щёлкните вершину: первый щелчок — «обязательно через неё», второй — «запрещена», третий — как было.</p>
        <div class="lab-fields"><label>Вопрос<select class="inp" id="labGKind">${[['count', 'Сколько путей'], ['short', 'Кратчайший путь'], ['long', 'Самый длинный путь']].map(([k, t]) => `<option value="${k}"${k === G.kind ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Откуда<select class="inp" id="labGStart">${opt(G.start)}</select></label><label>Куда<select class="inp" id="labGEnd">${opt(G.end)}</select></label>
          <button class="btn" type="button" data-lab-action="graph-step">По шагам от конца</button><button class="btn ghost" type="button" data-lab-action="graph-reset">Сбросить</button></div>
        <div id="labGraphResult" aria-live="polite"></div>
        ${labPrediction('Чему равен ответ для выбранных вершин? Сначала посчитайте сами, потом нажмите «По шагам от конца».')}</section>`;
      labUpdateGraph();
    } else {
      const g = LAB.game;
      box.innerHTML = `<section class="lab-panel"><h2>Исследуй ходы Пети и Вани</h2><p class="lab-note">Одна или две кучи. Побеждает тот, кто первым доведёт общее число камней до цели. В демоверсии-2027: две кучи, +4 или ×2, цель 133. Просмотр ходов сам по себе не доказывает выигрышную стратегию.</p>
        <div class="lab-fields"><label>Куч<select class="inp" id="labHeaps"><option value="1" ${g.heaps === 1 ? 'selected' : ''}>Одна</option><option value="2" ${g.heaps === 2 ? 'selected' : ''}>Две</option></select></label><label>Первая куча<input type="number" class="inp" id="labStart" min="1" max="199" value="${g.start}"></label><label>Вторая куча (для двух)<input type="number" class="inp" id="labSecond" min="1" max="199" value="${g.second}"></label><label>Цель<input type="number" class="inp" id="labTarget" min="2" max="200" value="${g.target}"></label><label>Прибавить<input type="number" class="inp" id="labAdd" min="1" max="20" value="${g.add}"></label><label>Умножить на<input type="number" class="inp" id="labFactor" min="2" max="5" value="${g.factor}"></label><button class="btn" type="button" data-lab-action="game-reset">Начать заново</button></div>
        <div id="labGameResult" aria-live="polite"></div>
        <p class="lab-note">Выбери ход, чтобы перейти к новой позиции. Под каждым ходом показаны возможные ответы соперника.</p></section>`;
      labUpdateGame();
    }
  }
  function labUpdateLogic() {
    const L = LAB.logic, m = LAB_LOGIC[L.kind], box = $('#labLogicResult'); if (!box) return;
    if (L.kind === 'seg') {
      L.segA = +$('#labSegA').value; L.segB = +$('#labSegB').value;
      if (L.segB < L.segA) { L.segB = L.segA; $('#labSegB').value = L.segB; }
      $('#labSegALabel').textContent = L.segA; $('#labSegBLabel').textContent = L.segB;
      const xs = Array.from({ length: 241 }, (_, i) => i / 4), bad = xs.filter(x => !m.f(x, L.segA, L.segB));
      const pos = x => (x / 60 * 100).toFixed(2) + '%', bar = (a, b, cls, t) => `<i class="${cls}" style="left:${pos(a)};width:${pos(b - a)}"><span>${t}</span></i>`;
      box.innerHTML = `<div class="lab-line">${bar(10, 35, 'p', 'P')}${bar(25, 50, 'q', 'Q')}${bar(L.segA, Math.max(L.segB, L.segA + 0.4), 'a', 'A')}
          ${bad.map(x => `<b style="left:${pos(x)}" title="x = ${String(x).replace('.', ',')}"></b>`).join('')}
          <div class="lab-ticks">${[0, 10, 20, 30, 40, 50, 60].map(t => `<span style="left:${pos(t)}">${t}</span>`).join('')}</div></div>
        <dl class="lab-facts"><div><dt>Отрезок A</dt><dd>[${L.segA}; ${L.segB}], длина ${L.segB - L.segA}</dd></div>
          <div><dt>Контрпримеров</dt><dd class="${bad.length ? 'lab-bad' : 'lab-good'}">${bad.length ? `${bad.length} точек, например x = ${String(bad[0]).replace('.', ',')}` : 'нет — выражение истинно при любом x'}</dd></div></dl>`;
      return;
    }
    L.a = +$('#labA').value; $('#labALabel').textContent = L.a;
    const xs = Array.from({ length: m.xMax }, (_, i) => i + 1), bad = xs.filter(x => !m.f(x, L.a));
    const why = bad.length ? m.parts(bad[0], L.a).map(([t, v]) => `<span class="${v ? 'lab-good' : 'lab-bad'}">${t}: ${v ? 'да' : 'нет'}</span>`).join(' · ') : '';
    box.innerHTML = `<div class="lab-xgrid">${xs.map(x => `<i class="${m.f(x, L.a) ? 'ok' : 'no'}" title="x = ${x}${L.kind === 'bit' ? ' = ' + x.toString(2).padStart(7, '0') + '₂' : ''}">${x}</i>`).join('')}</div>
      <dl class="lab-facts"><div><dt>Проверено x</dt><dd>от 1 до ${m.xMax}</dd></div>
        <div><dt>Контрпримеров</dt><dd class="${bad.length ? 'lab-bad' : 'lab-good'}">${bad.length ? `${bad.length}, первый x = ${bad[0]}${L.kind === 'bit' ? ' = ' + bad[0].toString(2) + '₂' : ''}` : 'нет на этом отрезке'}</dd></div></dl>
      ${bad.length ? `<p class="lab-note">Почему при x = ${bad[0]} выражение ложно: ${why}. Импликация ложна, только когда слева «да», а справа «нет».</p>`
        : '<p class="lab-note">Красных клеток нет. Но «при любом x» — это бесконечно много чисел: программа в уроке проверяет x до нескольких тысяч, а здесь видна лишь часть.</p>'}`;
  }
  function labUpdateGraph() {
    const G = LAB.graph, box = $('#labGraphResult'); if (!box) return;
    G.kind = $('#labGKind').value; G.start = $('#labGStart').value; G.end = $('#labGEnd').value;
    const r = labGraphSolve(G.kind, G.start, G.end, G.banned, G.via), t = r.table;
    const shown = new Set(t.steps.slice(0, G.shown)), onPath = new Set(G.kind === 'count' ? [] : r.path);
    const edgeOn = (a, b) => { const i = r.path.indexOf(a); return i >= 0 && r.path[i + 1] === b; };
    const X = c => 40 + c * 108, Y = r_ => 52 + r_ * 96, fmt = v => v == null ? '∞' : v;
    const cur = G.shown < t.steps.length ? t.steps[G.shown - 1] : null;
    const svg = `<svg class="lab-graph" viewBox="0 0 620 300" role="group" aria-label="Граф с вершинами A–H">
      <defs><marker id="labArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
      ${LAB_G.e.map(([a, b, w]) => { const [x1, y1] = [X(LAB_G.v[a][0]), Y(LAB_G.v[a][1])], [x2, y2] = [X(LAB_G.v[b][0]), Y(LAB_G.v[b][1])];
        const k = 24 / Math.hypot(x2 - x1, y2 - y1), sx = x1 + (x2 - x1) * k, sy = y1 + (y2 - y1) * k, ex = x2 - (x2 - x1) * k, ey = y2 - (y2 - y1) * k;
        const dim = G.banned.has(a) || G.banned.has(b);
        return `<g class="e${edgeOn(a, b) ? ' on' : ''}${dim ? ' dim' : ''}"><line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" marker-end="url(#labArr)"/>${G.kind === 'count' ? '' : `<text x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 5}">${w}</text>`}</g>`; }).join('')}
      ${LAB_G.order.map(v => { const [c, r_] = LAB_G.v[v], cls = [G.banned.has(v) ? 'ban' : '', v === G.via ? 'via' : '', v === G.start || v === G.end ? 'end' : '', onPath.has(v) ? 'on' : '', v === cur ? 'cur' : ''].filter(Boolean).join(' ');
        return `<g class="v ${cls}" data-lab-gv="${v}" tabindex="0" role="button" aria-disabled="${v === G.start || v === G.end}" aria-label="Вершина ${v}${G.banned.has(v) ? ", запрещена" : v === G.via ? ", обязательная" : ""}"><circle cx="${X(c)}" cy="${Y(r_)}" r="22"/><text x="${X(c)}" y="${Y(r_) + 6}">${v}</text>
          ${shown.has(v) ? `<text class="val" x="${X(c)}" y="${Y(r_) + (r_ === 0 ? -30 : 42)}">${fmt(t.val[v])}</text>` : ''}</g>`; }).join('')}</svg>`;
    const kindTxt = { count: 'сколько путей ведёт отсюда в конец', short: 'длина кратчайшего пути отсюда до конца', long: 'длина самого длинного пути отсюда до конца' }[G.kind];
    const how = G.kind === 'count' ? 'в конце пути — 1, иначе сумма чисел соседей' : `в конце пути — 0, иначе ${G.kind === 'short' ? 'min' : 'max'}(вес ребра + число соседа)`;
    const allShown = G.shown >= t.steps.length;
    box.innerHTML = svg + `<dl class="lab-facts"><div><dt>Число в вершине</dt><dd class="lab-small">${kindTxt}; ${how}</dd></div>
      <div><dt>Ответ ${G.start} → ${G.end}${G.via ? ` через ${G.via}` : ''}${G.banned.size ? ` в обход ${[...G.banned].join(', ')}` : ''}</dt>
        <dd>${allShown ? (r.answer == null ? 'пути нет' : `${r.answer}${r.parts ? ` = ${r.parts[0]} ${G.kind === 'count' ? '×' : '+'} ${r.parts[1]}` : ''}`) : '…'}</dd></div></dl>
      ${allShown && G.kind !== 'count' && r.path.length > 1 ? `<p class="lab-path">Путь: ${r.path.join(' → ')}</p>` : ''}
      ${G.via && allShown ? `<p class="lab-note">Через вершину ${G.via} путь собирается из двух кусков: ${G.start} → ${G.via} и ${G.via} → ${G.end}. Количества путей ${G.kind === 'count' ? 'перемножаются' : '— нет, тут длины складываются'}. Числа на графе показаны для второго куска.</p>` : ''}
      ${!allShown ? `<p class="lab-note">Шаг ${G.shown} из ${t.steps.length}: считаем вершину <b>${cur}</b>. Порядок — от конца к началу, чтобы у соседей ответ уже был.</p>` : ''}`;
  }
  function labResetFeedback() { if ($('#labFeedback')) $('#labFeedback').textContent = ''; }
  function labNetworkFacts(n) {
    return `<div class="lab-bits" aria-label="Двоичная запись адреса">${[0, 8, 16, 24].map(start => `<span class="lab-octet">${n.bits.slice(start, start + 8).split('').map((bit, i) => `<b class="${start + i < n.prefix ? 'network' : 'host'}">${bit}</b>`).join('')}</span>`).join('')}</div>
        <dl class="lab-facts"><div><dt>Маска</dt><dd>${n.mask}</dd></div><div><dt>Первый адрес</dt><dd>${n.network}</dd></div><div><dt>Последний адрес</dt><dd>${n.last}</dd></div><div><dt>Битов для адреса внутри сети</dt><dd>32 − ${n.prefix} = ${32 - n.prefix}</dd></div></dl>`;
  }
  function labUpdateNetwork() {
    LAB.net.ip = $('#labIp').value; LAB.net.prefix = +$('#labPrefix').value;
    $('#labPrefixLabel').textContent = LAB.net.prefix; labResetFeedback();
    $('#labIp').removeAttribute('aria-invalid');
    try {
      const n = labNetwork(LAB.net.ip, LAB.net.prefix);
      $('#labNetResult').innerHTML = labNetworkFacts(n);
    } catch (e) { $('#labIp').setAttribute('aria-invalid', 'true'); $('#labNetResult').textContent = e.message; }
  }
  async function openLabAssignment(id, sync, back) {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    if (pyOpen()) togglePy(false);
    if (bdOpen()) toggleBoard(false);
    labStop(); abandonCurrent();
    appState.cur = null; appState.courseShown = true; appState.pageKind = 'lab13';
    document.body.classList.remove('asg-wide', 'hub-on', 'lab-open');
    navPush({ v: 'lab13', id }); renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория №13</span>';
    $('#sessionInfo').textContent = '';
    trainerEl.innerHTML = `<article class="lab" id="labAsgRoot"><button type="button" class="link-btn lab-back" data-lab-asg-back>← Задания от учителя</button>
      <header class="lab-header"><span class="lab-mark">${labIcon}</span><div><h1>Лаборатория №13</h1><p>Подсети IPv4</p></div></header>
      <section class="lab-panel" id="labAsgWork" aria-busy="true"><p role="status">Открываем назначение…</p></section></article>`;
    window.scrollTo(0, 0);
    const root = $('#labAsgRoot'), panel = $('#labAsgWork'), session = learningSessionGuard();
    const active = () => session() && root.isConnected && appState.courseShown && appState.pageKind === 'lab13';
    let done = false;
    root.querySelector('[data-lab-asg-back]').onclick = () => back(done);
    const start = async () => {
      panel.setAttribute('aria-busy', 'true');
      panel.innerHTML = '<p role="status">Открываем назначение…</p>';
      try {
        const state = await api('asg/lab13/start', { id });
        if (!active()) return;
        if (state.id !== id || !state.ip || !Number.isInteger(state.prefix)) throw Error('Сервер не подтвердил открытие назначения.');
        done = !!state.finished;
        sync(state);
        render(state);
      } catch (err) {
        if (!active()) return;
        const blocked = err.status === 403 || err.status === 404 || err.status === 409;
        done = err.status === 409;
        panel.innerHTML = `<p role="alert">${blocked ? esc(err.message) : 'Не удалось загрузить назначение. Проверь соединение и попробуй снова.'}</p>
          ${blocked ? '' : '<button class="btn" type="button" id="labAsgRetry">Повторить загрузку</button>'}`;
        if (!blocked) $('#labAsgRetry').onclick = start;
      } finally { if (active()) panel.removeAttribute('aria-busy'); }
    };
    function render(state) {
      const title = `<h2>${esc(state.title)}</h2><p>IPv4-адрес и префикс из задания <strong id="labAsgSubnet">${esc(state.ip)}/${state.prefix}</strong></p>`;
      if (state.finished) {
        panel.innerHTML = title + `<div id="labAsgFeedback" role="status" tabindex="-1"><h3>${state.correct ? 'Прогноз верный' : 'В прогнозе ошибка'}</h3>
          <dl class="lab-facts"><div><dt>Твой прогноз</dt><dd>${labFmt(state.prediction)}</dd></div>
          <div><dt>Адресов в подсети</dt><dd>${labFmt(state.expected)}</dd></div></dl>
          <p>Первый прогноз сохранён в журнале.</p></div>
          <section id="labAsgModel"><h3>Проверка на модели</h3><p class="lab-note">Меняй адрес и префикс, чтобы исследовать границы подсети.</p>
            <div class="lab-fields"><label>IPv4-адрес<input class="inp" id="labAsgIp" maxlength="15" spellcheck="false" value="${esc(state.ip)}"></label>
            <label for="labAsgPrefix"><span>Префикс /<output for="labAsgPrefix" id="labAsgPrefixLabel">${state.prefix}</output></span><input id="labAsgPrefix" type="range" min="0" max="32" value="${state.prefix}"></label></div>
            <div id="labAsgFacts" aria-live="polite"></div></section>`;
        const ip = $('#labAsgIp'), prefix = $('#labAsgPrefix'), output = $('#labAsgFacts');
        const update = () => {
          $('#labAsgPrefixLabel').textContent = prefix.value;
          try {
            const n = labNetwork(ip.value, +prefix.value);
            ip.removeAttribute('aria-invalid');
            output.innerHTML = labNetworkFacts(n) + `<p>Адресов в подсети: 2<sup>${32 - n.prefix}</sup> = <strong id="labAsgModelCount">${labFmt(n.count)}</strong></p>`;
          } catch (error) { ip.setAttribute('aria-invalid', 'true'); output.textContent = error.message; }
        };
        ip.oninput = prefix.oninput = update;
        update(); $('#labAsgFeedback').focus({ preventScroll: true });
        return;
      }
      panel.innerHTML = title + `<form id="labAsgForm" class="lab-predict"><div><strong>Сколько всего IPv4-адресов в этой подсети?</strong>
        <p>Учитывай адрес сети и широковещательный адрес. Первый отправленный прогноз попадёт в журнал.</p></div>
        <label>Твой прогноз<input class="inp" type="number" id="labAsgPrediction" min="0" max="4294967296" step="1" inputmode="numeric" required></label>
        <button class="btn primary" id="labAsgCheck">Проверить в модели</button><p class="lab-feedback" id="labAsgStatus" role="status"></p></form>`;
      const input = $('#labAsgPrediction'), button = $('#labAsgCheck'), status = $('#labAsgStatus');
      $('#labAsgForm').onsubmit = async event => {
        event.preventDefault();
        if (button.disabled || !input.validity.valid) return;
        const prediction = Number(input.value);
        button.disabled = true; input.readOnly = true;
        status.textContent = 'Сохраняем прогноз…';
        try {
          const result = await api('asg/lab13/answer', { id, prediction });
          if (!session()) return;
          if (result.id !== id || !result.finished || !Number.isInteger(result.prediction) || !Number.isInteger(result.expected)) throw Error('Ответ не подтверждён.');
          sync(result);
          if (!active()) return;
          done = true;
          render(result);
        } catch (err) {
          if (!active()) return;
          const blocked = [403, 404, 409].includes(err.status);
          done = err.status === 409;
          status.textContent = blocked || err.status === 400 ? err.message : 'Не удалось получить подтверждение. Проверь соединение и отправь прогноз ещё раз.';
          if (err.status === 400) input.readOnly = false;
          if (!blocked) { button.disabled = false; button.textContent = 'Отправить ещё раз'; }
        }
      };
    }
    await start();
  }
  function labUpdateImage() {
    LAB.picture = { w: +$('#labWidth').value, h: +$('#labHeight').value, depth: +$('#labDepth').value };
    for (const id of ['labWidth', 'labHeight', 'labDepth']) {
      const field = $('#' + id);
      if (field.value === '' || !field.validity.valid) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    const p = LAB.picture; $('#labDepthLabel').textContent = p.depth; labResetFeedback();
    try {
      const v = labImageSize(p.w, p.h, p.depth);
      $('#labImageResult').innerHTML = `<dl class="lab-facts"><div><dt>Возможных цветов</dt><dd>2<sup>${p.depth}</sup> = ${labFmt(v.colors)}</dd></div><div><dt>Пикселей</dt><dd>${labFmt(p.w * p.h)}</dd></div></dl><p>Объём в битах = ширина × высота × глубина цвета.</p>`;
      const c = $('#labCanvas').getContext('2d');
      const levels = [Math.ceil(p.depth / 3), Math.floor((p.depth + 1) / 3), Math.floor(p.depth / 3)].map(b => 2 ** b - 1);
      const quant = (x, max) => max ? Math.round(x * max) * 255 / max : 0;
      for (let y = 0; y < 128; y += 4) for (let x = 0; x < 256; x += 4) {
        c.fillStyle = `rgb(${quant(x / 252, levels[0])},${quant(y / 124, levels[1])},${quant(1 - x / 252, levels[2])})`; c.fillRect(x, y, 4, 4);
      }
    } catch (e) { $('#labImageResult').textContent = e.message; }
  }
  function labUpdateGame() {
    const g = LAB.game, n = g.path[g.path.length - 1], box = $('#labGameResult');
    const sum = p => p.reduce((a, b) => a + b, 0), label = p => p.join(' + ');
    try {
      const moves = labGamePositionMoves(n, g.target, g.add, g.factor), petya = g.path.length % 2 === 1;
      box.innerHTML = `<div class="lab-position"><b>${label(n)}</b><span>${moves.length ? `камней · ходит ${petya ? 'Петя' : 'Ваня'}` : `Победил ${petya ? 'Ваня' : 'Петя'}`}</span></div>
        <p class="lab-path">${g.path.map(p => '(' + label(p) + ')').join(' → ')}</p>
        <div class="lab-moves">${moves.map((m, i) => `<div><button class="btn" type="button" data-lab-move="${i}">${m.label} → ${label(m.value)}${sum(m.value) >= g.target ? ' · победа' : ''}</button><p>${sum(m.value) >= g.target ? 'Игра завершится' : 'Далее: ' + labGamePositionMoves(m.value, g.target, g.add, g.factor).map(x => `${x.label} → ${label(x.value)}${sum(x.value) >= g.target ? ' (победа соперника)' : ''}`).join(' · ')}</p></div>`).join('')}</div>
        <button type="button" class="btn ghost" data-lab-action="game-back" ${g.path.length < 2 ? 'disabled' : ''}>← Отменить ход</button>`;
    } catch (e) { box.textContent = e.message; }
  }
  function labCodeHtml() {
    return `<div class="lab-code-tools"><label>Готовый пример<select class="inp" id="labExample"><option value="">Выбрать пример…</option>${Object.entries(LAB_EXAMPLES).map(([id, [name]]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <button type="button" class="btn primary" id="labRun" data-lab-action="run">Разобрать по шагам</button><button type="button" class="btn" id="labStop" data-lab-action="stop" hidden>Остановить</button>
      <button type="button" class="btn ghost" data-lab-action="edit" id="labEdit" ${LAB.result ? '' : 'hidden'}>Редактировать код</button></div>
      <p class="lab-note">Код выполняется в браузере, затем запись можно листать вперёд и назад. Подсвеченная строка ещё не выполнена; переменные показаны перед ней. Пошагово записываются первые 200 000 шагов, а программа досчитывается до конца — до 5 минут.</p>
      <p class="lab-status" id="labStatus" role="status">${LAB.result ? 'Запись выполнения готова.' : 'Вставь свой код или выбери пример. Ctrl+Enter — разобрать.'}</p>
      <div class="lab-controls" id="labControls" ${LAB.result && LAB.result.steps.length ? '' : 'hidden'}>
        <button type="button" class="btn" data-lab-action="prev" id="labPrev" title="Шаг назад (F7)">← Назад</button><button type="button" class="btn primary" data-lab-action="next" id="labNext" title="Следующий шаг (F8)">Следующий шаг →</button><button type="button" class="btn" data-lab-action="resume" id="labResume" title="До следующей точки останова (F9)">До точки останова ▶▶</button><button type="button" class="btn" data-lab-action="play" id="labPlay">Воспроизвести</button><button type="button" class="btn" data-lab-action="end" id="labEnd">В конец ⇥</button>
        <label>Шаг <span id="labStepLabel"></span><input type="range" id="labStep" min="0" max="0" value="0" aria-label="Шаг выполнения"></label></div>
      <div class="lab-code-grid"><section class="lab-panel lab-editor"><h2>Код Python</h2>
        <div class="ide">
          <div class="ide-tabs"><span class="ide-tab"><i class="ide-pyico" aria-hidden="true"></i>main.py</span><span class="ide-mode" id="labIdeMode">${LAB.result ? 'Отладка' : 'Редактор'}</span></div>
          <div class="ide-ed" id="labEd" ${LAB.result ? 'hidden' : ''}><div class="ide-gutter" id="labGutter" role="group" aria-label="Точки останова"></div>
            <div class="ide-area"><pre class="ide-hl" id="labCodeHl" aria-hidden="true"></pre>
              <textarea id="labCode" class="ide-code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" maxlength="30000" aria-label="Код Python">${esc(LAB.code)}</textarea></div></div>
          <div id="labTraceCode" class="lab-trace-code ide-trace" tabindex="0" aria-label="Код с текущей строкой" ${LAB.result ? '' : 'hidden'}></div>
          <div class="ide-foot">Нажми номер строки или Enter на нём — поставишь точку останова <i class="ide-bp-dot" aria-hidden="true"></i></div>
        </div>
        <label class="lab-stdin">Входные данные для input()<textarea class="inp" id="labStdin" rows="3" maxlength="10000" spellcheck="false" ${LAB.result ? 'disabled' : ''}>${esc(LAB.stdin)}</textarea></label>
      </section><section class="lab-panel"><h2>Что происходит</h2><p id="labEvent">Здесь появятся значения переменных на каждом шаге.</p><div id="labStack" class="lab-stack"></div><div id="labVariables"></div><h3>Вывод программы</h3><pre class="lab-output ide-out" id="labOutput" aria-label="Вывод программы"></pre></section></div>
      <p class="lab-note">Списки и значения показаны сокращённо. Python загружается при первом запуске; кнопка «Остановить» прерывает и загрузку, и выполнение.</p>`;
  }
  function labSetStatus(text) { if (labActive() && $('#labStatus')) $('#labStatus').textContent = text; }
  function labSetBusy(busy) {
    LAB.running = busy;
    for (const id of ['labRun', 'labExample', 'labCode', 'labStdin']) if ($('#' + id)) $('#' + id).disabled = busy;
    if ($('#labStop')) $('#labStop').hidden = !busy;
  }
  function labRun() {
    if (LAB.running) return;
    if (!LAB.code.trim()) { labSetStatus('Сначала напиши код или выбери пример.'); return; }
    labStop(); LAB.result = null; LAB.index = 0; labSaveDraft();
    const example = !LAB.context && Object.keys(LAB_EXAMPLES).find(id => LAB_EXAMPLES[id][1] === LAB.code);
    $('#labEd').hidden = false; $('#labTraceCode').hidden = true; $('#labControls').hidden = true; $('#labEdit').hidden = true; $('#labIdeMode').textContent = 'Редактор';
    $('#labVariables').textContent = ''; $('#labStack').textContent = ''; $('#labOutput').textContent = ''; $('#labEvent').textContent = 'Готовим запись выполнения…';
    try {
      const worker = new EgePythonWorker('lab-worker.js' + (RULES.py_local ? '?local=1' : '')); LAB.worker = worker;
      labSetBusy(true); labSetStatus('Загружаю Python… При первом запуске это может занять около минуты.');
      const fail = text => { if (LAB.worker !== worker) return; labStop(); labSetBusy(false); labSetStatus(text); };
      LAB.timeout = setTimeout(() => fail('Python не успел загрузиться. Проверь интернет и повтори запуск.'), 90000);
      worker.onmessage = e => {
        if (LAB.worker !== worker || !labActive()) return;
        const m = e.data;
        if (m.type === 'tracing') {
          clearTimeout(LAB.timeout); LAB.timeout = setTimeout(() => fail('Выполнение остановлено через минуту. Уменьши входные данные или проверь цикл.'), 60000);
          labSetStatus('Записываю выполнение…');
        } else if (m.type === 'trace-partial') {
          // Первые 200 000 шагов записаны — их можно листать, пока программа досчитывается без записи.
          clearTimeout(LAB.timeout);
          LAB.timeout = setTimeout(() => {
            if (LAB.worker !== worker) return;
            labStop(); labSetBusy(false);
            if (LAB.result) { LAB.result.pending = false; LAB.result.timedOut = true; labRenderStep(); }
          }, 330000);
          LAB.result = m.result; LAB.result.progress = 0; LAB.index = 0; labIndexSteps();
          $('#labEd').hidden = true; $('#labTraceCode').hidden = false; $('#labEdit').hidden = false; $('#labStdin').disabled = true; $('#labIdeMode').textContent = 'Отладка';
          labRenderStep();
        } else if (m.type === 'trace-progress') {
          if (LAB.result?.pending) { LAB.result.progress = m.seconds; labRenderStatus(); }
        } else if (m.type === 'trace') {
          if (SERVER && !appState.teacher && example && m.result.finished && !m.result.error) api('lab/activity', { section: 'code', example }).catch(() => {});
          const recorded = LAB.result?.pending ? LAB.result : null;
          clearTimeout(LAB.timeout); LAB.timeout = null; worker.terminate(); LAB.worker = null; labSetBusy(false);
          if (recorded) {                                    // досчитали: шаги — прежние, вывод и итог — полные
            Object.assign(recorded, { output: m.result.output, error: m.result.error, outputTruncated: m.result.outputTruncated,
              truncated: m.result.truncated, stop: m.result.stop, finished: m.result.finished, seconds: m.result.seconds, pending: false });
            labRenderStep();
            return;
          }
          LAB.result = m.result; LAB.index = 0; labIndexSteps();
          $('#labEd').hidden = true; $('#labTraceCode').hidden = false; $('#labEdit').hidden = false; $('#labStdin').disabled = true; $('#labIdeMode').textContent = 'Отладка';
          labRenderStep();
        } else if (m.type === 'trace-error') fail(m.text);
        else if (m.type === 'done' && !m.ok) fail('Не удалось загрузить Python. Проверь интернет и повтори запуск.');
      };
      worker.onerror = () => fail('Не удалось запустить Python. Обнови страницу и попробуй ещё раз.');
      worker.postMessage({ type: 'trace', code: LAB.code, stdin: LAB.stdin, files: LAB.context?.files || [] });
    } catch (e) { labStop(); labSetBusy(false); labSetStatus('Браузер не смог запустить Python. Попробуй современную версию браузера.'); }
  }
  function labRenderStatus() {
    const r = LAB.result;
    if (!r) return;
    const n = r.steps.length.toLocaleString('ru-RU'), cut = ' Пошагово записаны первые ' + n + ' шагов — их можно листать.';
    const tail = r.outputTruncated ? ' Вывод сокращён до 20000 символов.' : '';
    if (r.pending) labSetStatus(`Шагов больше ${n}.${cut} Программа продолжает считаться без записи, чтобы получить полный вывод${r.progress ? ` — идёт ${r.progress} с` : ''}… Можно остановить кнопкой «Остановить».`);
    else if (r.userStopped) labSetStatus(`Досчёт остановлен вручную.${cut} Вывод — только до места остановки.`);
    else if (r.timedOut || (r.cut && r.stop === 'total')) labSetStatus(`Программа не закончилась за 5 минут — похоже на бесконечный цикл или слишком долгий расчёт.${cut} Проверь условие цикла.`);
    else if (r.error) labSetStatus('Программа завершилась с ошибкой: ' + r.error + (r.cut ? cut : ''));
    else if (r.truncated) labSetStatus('Программа выполнялась дольше 25 секунд ещё до первых 200 000 шагов — запись остановлена. Похоже на бесконечный цикл или слишком большие данные.');
    else if (r.cut) labSetStatus(`Программа выполнена до конца${r.seconds ? ` за ${r.seconds} с` : ''}: шагов больше ${n}.${cut} Полный вывод программы — на последнем шаге («В конец»).` + tail);
    else labSetStatus(`Программа выполнена до конца: ${n} ${plural(r.steps.length, 'шаг', 'шага', 'шагов')}. Листай шаги и наблюдай за переменными.` + tail);
  }
  function labRenderStep() {
    if (!labActive() || LAB.view !== 'code' || !LAB.result) return;
    const r = LAB.result, s = r.steps[LAB.index], previous = r.steps[LAB.index - 1];
    $('#labControls').hidden = !r.steps.length;
    labRenderStatus();
    const vals = new Map((s ? s.variables : []).map(v => [v.name, v]));
    $('#labTraceCode').innerHTML = LAB.code.split('\n').map((line, i) => {
      const n = i + 1, cur = s && s.line === n, bp = LAB.bps.has(n);
      // значения переменных прямо в строке — только для уже выполненных строк текущей функции (как в PyCharm)
      let inline = '';
      if (s && LAB.seen && LAB.seen.first.get(n) <= LAB.index && LAB.seen.func.get(n) === s.function) {
        const names = [...new Set(line.replace(/#.*$/, '').replace(/(['"])(?:\\.|(?!\1).)*\1/g, '').match(/[A-Za-z_][\w]*/g) || [])].filter(w => vals.has(w) && !PY_KW.has(w));
        if (names.length) inline = `<em class="ide-inline">${names.slice(0, 5).map(w => `${esc(w)}: ${esc(labShort(vals.get(w).value))}`).join('&nbsp;&nbsp; ')}</em>`;
      }
      return `<div class="lab-code-line${cur ? ' current' : ''}${bp ? ' bp' : ''}" ${cur ? 'aria-current="step"' : ''}><span class="ide-ln" data-lab-bp="${n}" role="button" tabindex="0" aria-label="Точка останова: строка ${n}" aria-pressed="${bp}">${n}</span><code>${highlightPy(line) || ' '}</code>${inline}</div>`;
    }).join('');
    if (!s) { $('#labEvent').textContent = 'Не удалось начать выполнение. Исправь код и повтори запуск.'; $('#labOutput').textContent = r.output; return; }
    $('#labEvent').textContent = s.event === 'line' ? `Следующая строка: ${s.line}` : s.event === 'exception' ? `Строка ${s.line}: исключение ${s.exception}` : s.function === '<module>' ? (r.error ? 'Выполнение завершилось с ошибкой' : 'Выполнение основного кода завершено') : `Выход из ${s.function}: ${s.returnValue}`;
    $('#labStack').textContent = 'Вызовы: ' + s.stack.slice().reverse().map(f => f.name === '<module>' ? 'основной код' : f.name).join(' → ');
    $('#labVariables').innerHTML = s.variables.length ? `<div class="lab-vars ide-vars">${s.variables.map(v => {
      const old = previous && previous.function === s.function && previous.variables.find(x => x.name === v.name);
      const changed = !old || old.value !== v.value;
      const kind = v.type === 'str' ? 'str' : ['int', 'float', 'complex'].includes(v.type) ? 'num' : ['bool', 'NoneType'].includes(v.type) ? 'kw' : '';
      return `<div class="lab-var${changed ? ' changed' : ''}"><div class="ide-var-row"><i class="ide-var-ic ${kind || 'obj'}" aria-hidden="true"></i><b>${esc(v.name)}</b><span class="ide-eq">=</span><small>{${esc(v.type)}}</small>${v.length != null ? `<small>len ${v.length}</small>` : ''}<code class="${kind ? 'hl-' + kind : ''}">${esc(v.value)}</code>${changed ? '<span class="ide-chg" title="Значение изменилось на этом шаге">изменилось</span>' : ''}</div>${v.items ? `<div class="lab-array">${v.items.map((x, i) => `<span><small>${i}</small><code>${esc(x)}</code></span>`).join('')}${v.length > v.items.length ? '<span>…</span>' : ''}</div>` : ''}</div>`;
    }).join('')}</div>` : '<p class="lab-note">Пока нет переменных.</p>';
    // После досчёта на последнем записанном шаге показываем весь вывод программы.
    const whole = r.cut && !r.pending && LAB.index >= r.steps.length - 1;
    $('#labOutput').textContent = whole ? r.output : s.out != null ? r.output.slice(0, s.out) : (s.output || '');
    $('#labStep').max = r.steps.length - 1; $('#labStep').value = LAB.index;
    $('#labStepLabel').textContent = `${LAB.index + 1} из ${r.steps.length}`;
    $('#labPrev').disabled = LAB.index === 0; $('#labNext').disabled = $('#labEnd').disabled = LAB.index >= r.steps.length - 1;
    $('#labResume').disabled = LAB.index >= r.steps.length - 1;
    // Прокручиваем только код, не всю страницу: шаги и переменные остаются на месте.
    const panel = $('#labTraceCode'), line = $('#labTraceCode .current');
    if (line) {
      const p = panel.getBoundingClientRect(), l = line.getBoundingClientRect();
      if (l.top < p.top + 12) panel.scrollTop -= p.top + 12 - l.top;
      else if (l.bottom > p.bottom - 12) panel.scrollTop += l.bottom - p.bottom + 12;
    }
  }
  /** Для каждой строки: первый шаг, на котором она выполнялась, и в какой функции — по ним показываем значения в строках. */
  function labIndexSteps() {
    const first = new Map(), func = new Map();
    (LAB.result?.steps || []).forEach((st, i) => { if (!first.has(st.line)) { first.set(st.line, i); func.set(st.line, st.function); } });
    LAB.seen = { first, func };
  }
  const labShort = v => (v.length > 28 ? v.slice(0, 26) + '…' : v);
  /** «До точки останова» (F9): следующий шаг на строке с точкой; если точек нет или дальше их нет — в конец. */
  function labResume() {
    const st = LAB.result?.steps || [];
    let i = LAB.index + 1;
    while (i < st.length && !(st[i].event === 'line' && LAB.bps.has(st[i].line))) i++;
    LAB.index = Math.min(i, st.length - 1);
    if (i >= st.length && LAB.bps.size) labSetStatus('Дальше точек останова нет — программа дошла до конца.');
    labRenderStep();
  }
  /** Редактор: раскрашенная копия под прозрачным полем и номера строк с точками останова. */
  function labPaintEditor() {
    const ta = $('#labCode'), hl = $('#labCodeHl');
    if (!ta || !hl) return;
    hl.innerHTML = '<div class="ide-hl-in">' + highlightPy(ta.value) + '\n</div>';
    const n = ta.value.split('\n').length;
    $('#labGutter').innerHTML = '<div class="ide-gutter-in">' + Array.from({ length: n }, (_, i) => `<span class="ide-ln${LAB.bps.has(i + 1) ? ' bp' : ''}" data-lab-bp="${i + 1}" role="button" tabindex="0" aria-label="Точка останова: строка ${i + 1}" aria-pressed="${LAB.bps.has(i + 1)}">${i + 1}</span>`).join('') + '</div>';
    labFitCode();
    labScrollEditor();
  }
  /** Код целиком по ширине: самая длинная строка не помещается в колонку рядом с переменными — колонки друг под другом. */
  let labCharW = 0;
  function labFitCode() {
    const grid = trainerEl.querySelector('.lab-code-grid'), hl = $('#labCodeHl');
    if (!grid || !hl) return;
    if (!labCharW) { const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(hl).font; labCharW = c.measureText('M'.repeat(40)).width / 40 || 8.5; }
    const longest = Math.max(0, ...String(LAB.code || '').split('\n').map(l => l.replace(/\t/g, '    ').length));
    const need = longest * labCharW + 28 + 54 + 6;                  // текст + отступы + номера строк
    const col = (grid.clientWidth - 20) * 1.45 / 2.45;               // ширина редактора, когда колонки рядом
    grid.classList.toggle('one', innerWidth > 1100 && need > col);
  }
  window.addEventListener('resize', () => { if (labActive()) labFitCode(); });
  document.fonts?.ready.then(() => { labCharW = 0; if (labActive()) labFitCode(); });   // моноширинный шрифт догрузился
  function labScrollEditor() {
    const ta = $('#labCode'), inner = $('#labCodeHl')?.firstElementChild, g = $('#labGutter')?.firstElementChild;
    if (!ta || !inner) return;
    inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (g) g.style.transform = `translateY(${-ta.scrollTop}px)`;
  }
  function labStep(delta) { if (!LAB.result) return; LAB.index = Math.max(0, Math.min(LAB.result.steps.length - 1, LAB.index + delta)); labRenderStep(); }
  trainerEl.addEventListener('click', e => {
    if (!labActive()) return;
    const view = e.target.closest('[data-lab-view]'); if (view) { openLab(view.dataset.labView); return; }
    const model = e.target.closest('[data-lab-model]'); if (model) { LAB.mode = model.dataset.labModel; openLab('tasks'); return; }
    const move = e.target.closest('[data-lab-move]');
    if (move) { const g = LAB.game, m = labGamePositionMoves(g.path[g.path.length - 1], g.target, g.add, g.factor)[+move.dataset.labMove]; if (m) { g.path.push(m.value); labUpdateGame(); } return; }
    const a = e.target.closest('[data-lab-action]')?.dataset.labAction;
    if (a === 'run') labRun();
    if (a === 'stop') {
      labStop(); labSetBusy(false);
      if (LAB.result?.pending) { LAB.result.pending = false; LAB.result.userStopped = true; labRenderStep(); }
      else labSetStatus('Остановлено. Код сохранён в этом браузере.');
    }
    if (a === 'edit') { labStop(); LAB.result = null; openLab('code').then(() => $('#labCode')?.focus()); }
    if (a === 'prev' || a === 'next') { labPause(); labStep(a === 'prev' ? -1 : 1); }
    if (a === 'end' && LAB.result) { labPause(); LAB.index = LAB.result.steps.length - 1; labRenderStep(); }
    if (a === 'resume' && LAB.result) { labPause(); labResume(); }
    const bp = e.target.closest('[data-lab-bp]');
    if (bp) {
      const n = +bp.dataset.labBp, hadFocus = document.activeElement === bp;
      if (LAB.bps.has(n)) LAB.bps.delete(n); else LAB.bps.add(n);
      if (LAB.result) labRenderStep(); else labPaintEditor();
      if (hadFocus) trainerEl.querySelector((LAB.result ? '#labTraceCode ' : '#labGutter ') + '[data-lab-bp="' + n + '"]').focus();
    }
    if (a === 'play' && LAB.result) {
      if (LAB.play) { labPause(); return; }
      if (LAB.index >= LAB.result.steps.length - 1) LAB.index = 0;
      $('#labPlay').textContent = 'Пауза'; labRenderStep();
      LAB.play = setInterval(() => { if (!labActive() || LAB.index >= LAB.result.steps.length - 1) { labPause(); return; } labStep(1); }, 850);
    }
    if (a === 'game-back') { if (LAB.game.path.length > 1) LAB.game.path.pop(); labUpdateGame(); }
    if (a === 'graph-step') {                     // первый щелчок — только конечная вершина, дальше по одной к началу
      const G = LAB.graph, n = labGraphTo(G.kind, G.end, G.banned).steps.length;
      G.shown = G.shown >= n ? 1 : G.shown + 1; labUpdateGraph();
      const b = trainerEl.querySelector('[data-lab-action="graph-step"]'); if (b) b.textContent = G.shown >= n ? 'По шагам от конца' : 'Следующий шаг →';
    }
    if (a === 'graph-reset') { Object.assign(LAB.graph, { via: '', banned: new Set(), shown: 99 }); labRenderModel(); }
    const lx = e.target.closest('[data-lx-act]');
    if (lx && LAB_EXTRA[LAB.mode]) {             // переключатели и «новые данные» новых моделей
      const st = LAB_EXTRA[LAB.mode].state, act = lx.dataset.lxAct;
      if (act === 'rule') st.rule = lx.dataset.v; else if (act === 'sub') st.sub = lx.dataset.v;
      else if (act === 'new') { if ('seed' in st) st.seed = 1 + Math.floor(Math.random() * 1e6); else st.s = Array.from({ length: 36 }, () => 'XYZ'[Math.floor(Math.random() * 3)]).join(''); }
      labRenderModel(); return;
    }
    const lg = e.target.closest('[data-lab-logic]');
    if (lg) { LAB.logic.kind = lg.dataset.labLogic; labRenderModel(); return; }
    const gv = e.target.closest('[data-lab-gv]');
    if (gv) {                                     // обычная → обязательная → запрещённая → обычная
      const G = LAB.graph, v = gv.dataset.labGv;
      if (v === G.start || v === G.end) return;
      if (G.banned.has(v)) G.banned.delete(v);
      else if (G.via === v) { G.via = ''; G.banned.add(v); }
      else G.via = v;
      const hadFocus = document.activeElement === gv;
      labResetFeedback(); labUpdateGraph();
      if (hadFocus) trainerEl.querySelector('[data-lab-gv="' + v + '"]').focus();
      return;
    }
    if (a === 'game-reset') {
      const g = { start: +$('#labStart').value, second: +$('#labSecond').value, heaps: +$('#labHeaps').value, target: +$('#labTarget').value, add: +$('#labAdd').value, factor: +$('#labFactor').value };
      try { const pos = g.heaps === 2 ? [g.start, g.second] : [g.start]; labGamePositionMoves(pos, g.target, g.add, g.factor); if (pos.reduce((a, b) => a + b, 0) >= g.target) throw Error('Сумма камней в начале должна быть меньше цели.'); LAB.game = { ...g, path: [pos] }; labUpdateGame(); }
      catch (err) { $('#labGameResult').textContent = err.message; }
    }
  });
  trainerEl.addEventListener('input', e => {
    if (!labActive()) return;
    const id = e.target.id;
    if (id === 'labCode' || id === 'labStdin') { LAB[id === 'labCode' ? 'code' : 'stdin'] = e.target.value; labSaveDraft(); }
    if (id === 'labCode') labPaintEditor();
    if (id === 'labIp' || id === 'labPrefix') labUpdateNetwork();
    if (['labWidth', 'labHeight', 'labDepth'].includes(id)) labUpdateImage();
    if (['labA', 'labSegA', 'labSegB'].includes(id)) { labResetFeedback(); labUpdateLogic(); }
    if (e.target.matches?.('[data-lx]') && LAB_EXTRA[LAB.mode]) { labResetFeedback(); LAB_EXTRA[LAB.mode].update(); }
    if (id === 'labStep') { labPause(); LAB.index = +e.target.value; labRenderStep(); }
  });
  trainerEl.addEventListener('change', e => {
    if (labActive() && e.target.matches?.('select[data-lx]') && LAB_EXTRA[LAB.mode]) { labResetFeedback(); LAB_EXTRA[LAB.mode].update(); return; }
    if (labActive() && ['labGKind', 'labGStart', 'labGEnd'].includes(e.target.id)) {
      const G = LAB.graph; G.shown = 99;
      if (e.target.id !== 'labGKind') { G.via = ''; G.banned.clear(); }
      labResetFeedback(); labUpdateGraph(); return;
    }
    if (!labActive() || e.target.id !== 'labExample' || !LAB_EXAMPLES[e.target.value]) return;
    const code = LAB_EXAMPLES[e.target.value][1];
    if (LAB.code && LAB.code !== code && !confirm('Заменить текущий код выбранным примером?')) { e.target.value = ''; return; }
    labStop(); LAB.code = code; LAB.result = null; labSaveDraft(); openLab('code');
  });
  trainerEl.addEventListener('submit', e => {
    if (!labActive() || e.target.id !== 'labPredict') return;
    e.preventDefault();
    try {
      const answer = $('#labGuess').value.trim().replace(/\s/g, '');
      if (LAB_EXTRA[LAB.mode]) {
        const { expected, why } = LAB_EXTRA[LAB.mode].answer(), right = /^-?\d+$/.test(answer) && expected != null && +answer === expected;
        recordLabPrediction(right);
        $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} Ответ: ${expected == null ? 'нет' : expected}. ${why}`;
        return;
      }
      if (LAB.mode === 'logic' || LAB.mode === 'graph') {
        let expected, why;
        if (LAB.mode === 'logic') {
          const k = LAB.logic.kind, m = LAB_LOGIC[k]; expected = labLogicAnswer(k);
          why = k === 'seg' ? 'Отрезок A должен накрыть [10; 25): точки P, которых нет в Q. Длина 25 − 10 = 15.'
            : `Перебор A с проверкой x до 2000 — как программа в уроке «Курс ЕГЭ · №15» (${m.ask === 'max' ? 'последнее' : 'первое'} подходящее A).`;
        } else {
          const G = LAB.graph, r = labGraphSolve(G.kind, G.start, G.end, G.banned, G.via); expected = r.answer;
          G.shown = 99; labUpdateGraph();
          why = expected == null ? 'Пути нет.' : G.kind === 'count' ? 'Числа на графе — сколько путей из каждой вершины.' : `Путь: ${r.path.join(' → ')}.`;
        }
        const right = /^-?\d+$/.test(answer) && expected != null && +answer === expected;
        recordLabPrediction(right);
        $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} Ответ: ${expected == null ? 'пути нет' : expected}. ${why}`;
        return;
      }
      const expected = LAB.mode === 'net' ? labNetwork(LAB.net.ip, LAB.net.prefix).count : labImageSize(LAB.picture.w, LAB.picture.h, LAB.picture.depth).bytes;
      const right = /^\d+$/.test(answer) && +answer === expected;
      recordLabPrediction(right);
      $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} ${LAB.mode === 'net' ? `2^(32 − ${LAB.net.prefix})` : `Округляем вверх: ${labFmt(LAB.picture.w)} × ${labFmt(LAB.picture.h)} × ${LAB.picture.depth} / 8`} = ${labFmt(expected)}${LAB.mode === 'net' ? ' адресов.' : ' байт.'}`;
    } catch (err) { $('#labFeedback').textContent = err.message; }
  });
  trainerEl.addEventListener('scroll', e => { if (e.target.id === 'labCode') labScrollEditor(); }, true);
  // клавиши отладчика PyCharm: F7 — шаг назад, F8 — шаг, F9 — до точки останова
  document.addEventListener('keydown', e => {
    if (!labActive() || LAB.view !== 'code' || !LAB.result || !['F7', 'F8', 'F9'].includes(e.key) || e.target.closest?.('input, select, textarea')) return;
    e.preventDefault(); labPause();
    if (e.key === 'F9') labResume(); else labStep(e.key === 'F7' ? -1 : 1);
  });
  trainerEl.addEventListener('keydown', e => {
    if (!labActive()) return;
    const control = e.target.closest('[data-lab-gv], [data-lab-bp]');
    if (control && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); control.dispatchEvent(new MouseEvent('click', { bubbles: true })); return;
    }
    if (LAB.view !== 'code') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); labRun(); return; }
    if (e.target.id === 'labCode' && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = e.target; t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  new MutationObserver(() => {
    if (!labActive()) {
      labStop();
      if ((appState.pageKind !== 'lab' || !appState.courseShown) && LAB.context) { labSaveDraft(); LAB.context = null; LAB.owner = null; }
      document.body.classList.remove('lab-open');
    }
  }).observe(trainerEl, { childList: true });
  window.addEventListener('pagehide', labStop);
