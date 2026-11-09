  // ------------------------------------------------------------ лаборатории
  // Модели не обращаются к API ответов: эксперименты не влияют на журнал и экономику.
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
  let LAB_OK = false, labLoadId = 0;
  function labLock(configured, view) {
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><h2>Лаборатории — по паролю</h2>
      <p>${configured ? 'Пароль выдаёт учитель. После ввода доступ сохранится в твоём аккаунте.' : 'Учитель ещё не настроил доступ к лабораториям.'}</p>
      ${LAB.context ? '<button class="link-btn" type="button" data-learning-return>← Вернуться к уроку</button>' : ''}
      ${configured ? '<form id="labPasswordForm" class="login-form crs-lock-form"><input id="labPassword" class="inp" type="password" maxlength="200" autocomplete="off" placeholder="Пароль лабораторий" aria-label="Пароль лабораторий" required><button class="btn primary">Открыть</button></form><p id="labPasswordError" role="alert"></p>' : ''}</div></div>`;
    $('#labPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const form = e.currentTarget, btn = form.querySelector('button'), msg = $('#labPasswordError'); btn.disabled = true;
      try { await api('lab/unlock', { password: $('#labPassword').value }); await openLab(view); }
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
    context: null, game: { start: 17, second: 29, heaps: 2, target: 133, add: 4, factor: 2, path: [[17, 29]] } };
  const labActive = () => courseShown && pageKind === 'lab' && !!$('#labRoot');
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
  async function openLab(view = '', context) {
    if (!leaveExam()) return;
    if (!['', 'tasks', 'code'].includes(view)) view = '';
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
    abandonCurrent(); cur = null;
    courseShown = true; pageKind = 'lab'; LAB.view = view;
    navPush({ v: 'lab', tab: view });
    const ticket = ++labLoadId;
    if (SERVER) {
      trainerEl.innerHTML = '<p class="fm-note">Проверяю доступ к лабораториям…</p>';
      try {
        const access = await api('lab');
        if (ticket !== labLoadId || pageKind !== 'lab' || !courseShown) return;
        LAB_OK = !!access.access; $('#labCard')?.classList.toggle('locked', !LAB_OK);
        if (!LAB_OK) { labLock(access.pw, view); return; }
      } catch (err) { if (ticket === labLoadId && pageKind === 'lab') { trainerEl.innerHTML = '<p class="fm-note">Не удалось проверить доступ. Открой лабораторию ещё раз.</p>'; netError(err); } return; }
    }
    if (context) { LAB.code = context.code || ''; LAB.stdin = context.stdin || ''; LAB.result = null; LAB.index = 0; }
    else if (LAB.context) { LAB.code = LAB.context.code || ''; LAB.stdin = LAB.context.stdin || ''; }

    document.body.classList.add('lab-open');
    document.body.classList.remove('asg-wide');
    renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория</span><span class="scope-stats">Исследуй и проверяй идеи</span>';
    $('#sessionInfo').textContent = '';
    const titles = { '': ['Лаборатория', 'Меняй условия, проверяй гипотезы и разбирайся, как всё работает.'], tasks: ['Лаборатории по заданиям ЕГЭ', 'Сначала предположи результат. Затем проверь его на модели.'], code: ['Лаборатория программирования', 'Свой Python-код, значения переменных и выполнение по шагам.'] };
    const [title, sub] = titles[view];
    trainerEl.innerHTML = `<div class="lab" id="labRoot">
      ${LAB.context ? `<div class="learning-return"><button class="btn" type="button" data-learning-return>← Вернуться к уроку</button><span>${esc(LAB.context.label || 'Код и условие урока')}</span>${LAB.context.condition ? `<div class="cond">${safeHtml(LAB.context.condition)}</div>` : ''}</div>` : ''}
      ${view ? '<button type="button" class="link-btn lab-back" data-lab-view="">← Все лаборатории</button>' : ''}
      <header class="lab-header"><span class="lab-mark">${labIcon}</span><div><h1>${title}</h1><p>${sub}</p></div></header>
      ${view === 'tasks' ? labTasksHtml() : view === 'code' ? labCodeHtml() : `<div class="lab-cards">
        <button type="button" class="lab-entry" data-lab-view="tasks"><span class="lab-kicker">№ 7 · 10 · 19–21</span><h2>По заданиям ЕГЭ</h2><p>Границы подсети, объём изображения и ходы в игре — на наглядных моделях.</p><b>Начать эксперимент →</b></button>
        <button type="button" class="lab-entry" data-lab-view="code"><span class="lab-kicker">Python</span><h2>Программирование</h2><p>Смотри, какая строка выполняется, как меняются переменные и что выводит программа.</p><b>Открыть лабораторию →</b></button></div>
        <p class="lab-note">Здесь можно пробовать и ошибаться: эксперименты не меняют оценки и награды за задания.</p>`}
      </div>`;
    if (view === 'tasks') labRenderModel();
    if (view === 'code') labRenderStep();
    window.scrollTo(0, 0);
  }
  function labTasksHtml() {
    return `<nav class="lab-tabs" aria-label="Эксперименты">${[['net', '№ 10 · IP-сети'], ['image', '№ 7 · Изображения'], ['game', '№ 19–21 · Игры']].map(([id, name]) => `<button type="button" class="btn${LAB.mode === id ? ' primary' : ''}" data-lab-model="${id}" aria-pressed="${LAB.mode === id}">${name}</button>`).join('')}</nav><p class="lab-note">Нумерация по проекту ФИПИ ЕГЭ-2027. IP-сети в ЕГЭ-2026 — №13. Модели тренируют отдельные навыки, а условия экзамена могут быть сложнее.</p><div id="labModel"></div>`;
  }
  function labPrediction(question) {
    return `<form class="lab-predict" id="labPredict"><div><b>Проверь предположение</b><p>${question}</p></div><label>Твой ответ<input class="inp" id="labGuess" required inputmode="numeric" autocomplete="off" maxlength="20"></label><button class="btn" type="submit">Проверить</button><p id="labFeedback" class="lab-feedback" role="status"></p></form>`;
  }
  function labRenderModel() {
    const box = $('#labModel'); if (!box) return;
    if (LAB.mode === 'net') {
      box.innerHTML = `<section class="lab-panel"><h2>Где заканчивается сеть и начинается адрес узла?</h2>
        <div class="lab-fields"><label>IPv4-адрес<input class="inp" id="labIp" value="${esc(LAB.net.ip)}" spellcheck="false" maxlength="15"></label><label>Маска /<span id="labPrefixLabel">${LAB.net.prefix}</span><input type="range" id="labPrefix" min="0" max="32" value="${LAB.net.prefix}"></label></div>
        <p class="lab-note">Голубые биты задают сеть, остальные — адрес внутри неё. Все адреса считаются вместе с адресом сети и широковещательным адресом.</p>
        <div id="labNetResult" aria-live="polite"></div>
        ${labPrediction('Сколько всего IPv4-адресов в этой подсети?')}</section>`;
      labUpdateNetwork();
    } else if (LAB.mode === 'image') {
      const p = LAB.picture;
      box.innerHTML = `<section class="lab-panel"><h2>Как глубина цвета влияет на объём?</h2><div class="lab-fields">
        <label>Ширина, пиксели<input class="inp" type="number" id="labWidth" min="1" max="8192" value="${p.w}"></label>
        <label>Высота, пиксели<input class="inp" type="number" id="labHeight" min="1" max="8192" value="${p.h}"></label>
        <label>Бит на пиксель: <span id="labDepthLabel">${p.depth}</span><input type="range" id="labDepth" min="1" max="24" value="${p.depth}"></label></div>
        <div class="lab-image-demo"><canvas id="labCanvas" width="256" height="128" aria-label="Пример изменения палитры изображения"></canvas><div id="labImageResult" aria-live="polite"></div></div>
        <p class="lab-note">Модель без сжатия, заголовков и выравнивания строк. Биты упакованы подряд; итог округляется вверх до целого байта. Иллюстрация показывает изменение палитры, её размер на экране условный.</p>
        ${labPrediction('Сколько байт занимает это изображение?')}</section>`;
      labUpdateImage();
    } else {
      const g = LAB.game;
      box.innerHTML = `<section class="lab-panel"><h2>Исследуй ходы Пети и Вани</h2><p class="lab-note">Одна или две кучи. Побеждает тот, кто первым доведёт общее число камней до цели. В демоверсии-2027: две кучи, +4 или ×2, цель 133. Просмотр ходов сам по себе не доказывает выигрышную стратегию.</p>
        <div class="lab-fields"><label>Куч<select class="inp" id="labHeaps"><option value="1" ${g.heaps === 1 ? 'selected' : ''}>Одна</option><option value="2" ${g.heaps === 2 ? 'selected' : ''}>Две</option></select></label><label>Первая куча<input type="number" class="inp" id="labStart" min="1" max="199" value="${g.start}"></label><label>Вторая куча (для двух)<input type="number" class="inp" id="labSecond" min="1" max="199" value="${g.second}"></label><label>Цель<input type="number" class="inp" id="labTarget" min="2" max="200" value="${g.target}"></label><label>Прибавить<input type="number" class="inp" id="labAdd" min="1" max="20" value="${g.add}"></label><label>Умножить на<input type="number" class="inp" id="labFactor" min="2" max="5" value="${g.factor}"></label><button class="btn" type="button" data-lab-action="game-reset">Начать заново</button></div>
        <div id="labGameResult" aria-live="polite"></div>
        <p class="lab-note">Выбери ход, чтобы перейти к новой позиции. Под каждым ходом показаны возможные ответы соперника.</p></section>`;
      labUpdateGame();
    }
  }
  function labResetFeedback() { if ($('#labFeedback')) $('#labFeedback').textContent = ''; }
  function labUpdateNetwork() {
    LAB.net.ip = $('#labIp').value; LAB.net.prefix = +$('#labPrefix').value;
    $('#labPrefixLabel').textContent = LAB.net.prefix; labResetFeedback();
    try {
      const n = labNetwork(LAB.net.ip, LAB.net.prefix);
      $('#labNetResult').innerHTML = `<div class="lab-bits" aria-label="Двоичная запись адреса">${[0, 8, 16, 24].map(start => `<span class="lab-octet">${n.bits.slice(start, start + 8).split('').map((bit, i) => `<b class="${start + i < n.prefix ? 'network' : 'host'}">${bit}</b>`).join('')}</span>`).join('')}</div>
        <dl class="lab-facts"><div><dt>Маска</dt><dd>${n.mask}</dd></div><div><dt>Первый адрес</dt><dd>${n.network}</dd></div><div><dt>Последний адрес</dt><dd>${n.last}</dd></div><div><dt>Битов для адреса внутри сети</dt><dd>32 − ${n.prefix} = ${32 - n.prefix}</dd></div></dl>`;
    } catch (e) { $('#labNetResult').textContent = e.message; }
  }
  function labUpdateImage() {
    LAB.picture = { w: +$('#labWidth').value, h: +$('#labHeight').value, depth: +$('#labDepth').value };
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
      <p class="lab-note">Код выполняется в браузере, затем запись можно листать вперёд и назад. Подсвеченная строка ещё не выполнена; переменные показаны перед ней. До 600 событий на запуск.</p>
      <p class="lab-status" id="labStatus" role="status">${LAB.result ? 'Запись выполнения готова.' : 'Вставь свой код или выбери пример. Ctrl+Enter — разобрать.'}</p>
      <div class="lab-controls" id="labControls" ${LAB.result && LAB.result.steps.length ? '' : 'hidden'}>
        <button type="button" class="btn" data-lab-action="prev" id="labPrev">← Назад</button><button type="button" class="btn primary" data-lab-action="next" id="labNext">Следующий шаг →</button><button type="button" class="btn" data-lab-action="play" id="labPlay">Воспроизвести</button>
        <label>Шаг <span id="labStepLabel"></span><input type="range" id="labStep" min="0" max="0" value="0" aria-label="Шаг выполнения"></label></div>
      <div class="lab-code-grid"><section class="lab-panel lab-editor"><h2>Код Python</h2>
        <textarea id="labCode" class="inp" spellcheck="false" autocapitalize="off" autocomplete="off" maxlength="30000" aria-label="Код Python" ${LAB.result ? 'hidden' : ''}>${esc(LAB.code)}</textarea>
        <div id="labTraceCode" class="lab-trace-code" tabindex="0" aria-label="Код с текущей строкой" ${LAB.result ? '' : 'hidden'}></div>
        <label class="lab-stdin">Входные данные для input()<textarea class="inp" id="labStdin" rows="3" maxlength="10000" spellcheck="false" ${LAB.result ? 'disabled' : ''}>${esc(LAB.stdin)}</textarea></label>
      </section><section class="lab-panel"><h2>Что происходит</h2><p id="labEvent">Здесь появятся значения переменных на каждом шаге.</p><div id="labStack" class="lab-stack"></div><div id="labVariables"></div><h3>Вывод программы</h3><pre class="lab-output" id="labOutput" aria-label="Вывод программы"></pre></section></div>
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
    $('#labCode').hidden = false; $('#labTraceCode').hidden = true; $('#labControls').hidden = true; $('#labEdit').hidden = true;
    $('#labVariables').textContent = ''; $('#labStack').textContent = ''; $('#labOutput').textContent = ''; $('#labEvent').textContent = 'Готовим запись выполнения…';
    try {
      const worker = new Worker('lab-worker.js' + (RULES.py_local ? '?local=1' : '')); LAB.worker = worker;
      labSetBusy(true); labSetStatus('Загружаю Python… При первом запуске это может занять около минуты.');
      const fail = text => { if (LAB.worker !== worker) return; labStop(); labSetBusy(false); labSetStatus(text); };
      LAB.timeout = setTimeout(() => fail('Python не успел загрузиться. Проверь интернет и повтори запуск.'), 90000);
      worker.onmessage = e => {
        if (LAB.worker !== worker || !labActive()) return;
        const m = e.data;
        if (m.type === 'tracing') {
          clearTimeout(LAB.timeout); LAB.timeout = setTimeout(() => fail('Выполнение остановлено через 15 секунд. Уменьши входные данные или проверь цикл.'), 15000);
          labSetStatus('Записываю выполнение…');
        } else if (m.type === 'trace') {
          labStop(); labSetBusy(false); LAB.result = m.result; LAB.index = 0;
          $('#labCode').hidden = true; $('#labTraceCode').hidden = false; $('#labEdit').hidden = false; $('#labStdin').disabled = true;
          labRenderStep();
        } else if (m.type === 'trace-error') fail(m.text);
        else if (m.type === 'done' && !m.ok) fail('Не удалось загрузить Python. Проверь интернет и повтори запуск.');
      };
      worker.onerror = () => fail('Не удалось запустить Python. Обнови страницу и попробуй ещё раз.');
      worker.postMessage({ type: 'trace', code: LAB.code, stdin: LAB.stdin, files: LAB.context?.files || [] });
    } catch (e) { labStop(); labSetBusy(false); labSetStatus('Браузер не смог запустить Python. Попробуй современную версию браузера.'); }
  }
  function labRenderStep() {
    if (!labActive() || LAB.view !== 'code' || !LAB.result) return;
    const r = LAB.result, s = r.steps[LAB.index], previous = r.steps[LAB.index - 1];
    $('#labControls').hidden = !r.steps.length;
    if (r.error) labSetStatus('Программа завершилась с ошибкой: ' + r.error);
    else if (r.truncated) labSetStatus('Запись остановлена на 600 событиях. Уменьши диапазон цикла, чтобы увидеть окончание.');
    else labSetStatus('Запись готова. Листай шаги и наблюдай за переменными.' + (r.outputTruncated ? ' Вывод сокращён до 6000 символов.' : ''));
    $('#labTraceCode').innerHTML = LAB.code.split('\n').map((line, i) => `<div class="lab-code-line${s && s.line === i + 1 ? ' current' : ''}" ${s && s.line === i + 1 ? 'aria-current="step"' : ''}><span>${i + 1}</span><code>${highlightPy(line) || ' '}</code></div>`).join('');
    if (!s) { $('#labEvent').textContent = 'Не удалось начать выполнение. Исправь код и повтори запуск.'; $('#labOutput').textContent = r.output; return; }
    $('#labEvent').textContent = s.event === 'line' ? `Следующая строка: ${s.line}` : s.event === 'exception' ? `Строка ${s.line}: исключение ${s.exception}` : s.function === '<module>' ? (r.error ? 'Выполнение завершилось с ошибкой' : 'Выполнение основного кода завершено') : `Выход из ${s.function}: ${s.returnValue}`;
    $('#labStack').textContent = 'Вызовы: ' + s.stack.slice().reverse().map(f => f.name === '<module>' ? 'основной код' : f.name).join(' → ');
    $('#labVariables').innerHTML = s.variables.length ? `<div class="lab-vars">${s.variables.map(v => {
      const old = previous && previous.function === s.function && previous.variables.find(x => x.name === v.name);
      const changed = !old || old.value !== v.value;
      return `<div class="lab-var${changed ? ' changed' : ''}"><div><b>${esc(v.name)}</b><small>${esc(v.type)}${changed ? ' · изменилось' : ''}</small></div><code>${esc(v.value)}</code>${v.items ? `<div class="lab-array">${v.items.map((x, i) => `<span><small>${i}</small><code>${esc(x)}</code></span>`).join('')}${v.length > v.items.length ? '<span>…</span>' : ''}</div>` : ''}</div>`;
    }).join('')}</div>` : '<p class="lab-note">Пока нет переменных.</p>';
    $('#labOutput').textContent = s.output;
    $('#labStep').max = r.steps.length - 1; $('#labStep').value = LAB.index;
    $('#labStepLabel').textContent = `${LAB.index + 1} из ${r.steps.length}`;
    $('#labPrev').disabled = LAB.index === 0; $('#labNext').disabled = LAB.index >= r.steps.length - 1;
    // Прокручиваем только код, не всю страницу: шаги и переменные остаются на месте.
    const panel = $('#labTraceCode'), line = $('#labTraceCode .current');
    if (line) {
      const p = panel.getBoundingClientRect(), l = line.getBoundingClientRect();
      if (l.top < p.top + 12) panel.scrollTop -= p.top + 12 - l.top;
      else if (l.bottom > p.bottom - 12) panel.scrollTop += l.bottom - p.bottom + 12;
    }
  }
  function labStep(delta) { if (!LAB.result) return; LAB.index = Math.max(0, Math.min(LAB.result.steps.length - 1, LAB.index + delta)); labRenderStep(); }
  $('#labCard')?.addEventListener('click', () => openLab());
  trainerEl.addEventListener('click', e => {
    if (!labActive()) return;
    const view = e.target.closest('[data-lab-view]'); if (view) { openLab(view.dataset.labView); return; }
    const model = e.target.closest('[data-lab-model]'); if (model) { LAB.mode = model.dataset.labModel; openLab('tasks'); return; }
    const move = e.target.closest('[data-lab-move]');
    if (move) { const g = LAB.game, m = labGamePositionMoves(g.path[g.path.length - 1], g.target, g.add, g.factor)[+move.dataset.labMove]; if (m) { g.path.push(m.value); labUpdateGame(); } return; }
    const a = e.target.closest('[data-lab-action]')?.dataset.labAction;
    if (a === 'run') labRun();
    if (a === 'stop') { labStop(); labSetBusy(false); labSetStatus('Остановлено. Код сохранён в этом браузере.'); }
    if (a === 'edit') { labStop(); LAB.result = null; openLab('code').then(() => $('#labCode')?.focus()); }
    if (a === 'prev' || a === 'next') { labPause(); labStep(a === 'prev' ? -1 : 1); }
    if (a === 'play' && LAB.result) {
      if (LAB.play) { labPause(); return; }
      if (LAB.index >= LAB.result.steps.length - 1) LAB.index = 0;
      $('#labPlay').textContent = 'Пауза'; labRenderStep();
      LAB.play = setInterval(() => { if (!labActive() || LAB.index >= LAB.result.steps.length - 1) { labPause(); return; } labStep(1); }, 850);
    }
    if (a === 'game-back') { if (LAB.game.path.length > 1) LAB.game.path.pop(); labUpdateGame(); }
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
    if (id === 'labIp' || id === 'labPrefix') labUpdateNetwork();
    if (['labWidth', 'labHeight', 'labDepth'].includes(id)) labUpdateImage();
    if (id === 'labStep') { labPause(); LAB.index = +e.target.value; labRenderStep(); }
  });
  trainerEl.addEventListener('change', e => {
    if (!labActive() || e.target.id !== 'labExample' || !LAB_EXAMPLES[e.target.value]) return;
    const code = LAB_EXAMPLES[e.target.value][1];
    if (LAB.code && LAB.code !== code && !confirm('Заменить текущий код выбранным примером?')) { e.target.value = ''; return; }
    labStop(); LAB.code = code; LAB.result = null; labSaveDraft(); openLab('code');
  });
  trainerEl.addEventListener('submit', e => {
    if (!labActive() || e.target.id !== 'labPredict') return;
    e.preventDefault();
    try {
      const expected = LAB.mode === 'net' ? labNetwork(LAB.net.ip, LAB.net.prefix).count : labImageSize(LAB.picture.w, LAB.picture.h, LAB.picture.depth).bytes;
      const answer = $('#labGuess').value.trim().replace(/\s/g, '');
      const right = /^\d+$/.test(answer) && +answer === expected;
      $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} ${LAB.mode === 'net' ? `2^(32 − ${LAB.net.prefix})` : `Округляем вверх: ${labFmt(LAB.picture.w)} × ${labFmt(LAB.picture.h)} × ${LAB.picture.depth} / 8`} = ${labFmt(expected)}${LAB.mode === 'net' ? ' адресов.' : ' байт.'}`;
    } catch (err) { $('#labFeedback').textContent = err.message; }
  });
  trainerEl.addEventListener('keydown', e => {
    if (!labActive() || LAB.view !== 'code') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); labRun(); return; }
    if (e.target.id === 'labCode' && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = e.target; t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  new MutationObserver(() => {
    if (!labActive()) { labStop(); document.body.classList.remove('lab-open'); $('#labCard')?.classList.remove('on'); }
  }).observe(trainerEl, { childList: true });
  window.addEventListener('pagehide', labStop);
