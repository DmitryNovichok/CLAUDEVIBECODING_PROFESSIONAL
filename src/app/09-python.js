  // ------------------------------------------------------------ Python в браузере
  // Настоящий CPython (Pyodide) в отдельном потоке: math, itertools, functools, ipaddress, re, string, collections…
  // Файлы задания лежат рядом с кодом — open('17.txt') работает. Черепашка для №6 рисует на холсте.
  const PY_BTN = '<button type="button" class="icon-btn py-btn" id="pyBtn" title="Решить на Python прямо здесь">Python</button>';
  const PY = { worker: null, ready: false, running: false, task: null, saveTimer: null };
  const pyOpen = () => !$('#pyDock').hidden;
  const pyTaskNow = () => (courseShown && pageKind === 'pyc' ? PYC_PY
    : (examShown && EX ? byId.get((EX.items[EX.cur] || {}).id) : cur && cur.task)) || null;

  // ------------------------------------------------------------ маркер поверх условия
  // Рисунки — штрихи в долях ширины условия (при смене ширины окна не съезжают); у каждого задания свои,
  // живут до перезагрузки страницы. Ластик стирает штрих целиком.
  const MARK_BTN = '<button type="button" class="icon-btn mark-btn" id="markBtn" title="Маркер — рисовать поверх условия" aria-pressed="false">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Маркер</span></button>';
  const MARK_COLORS = [['#ef4444', 'Красный'], ['#3b82f6', 'Синий'], ['#22c55e', 'Зелёный']];
  const MARK = { on: false, tool: 'pen', color: MARK_COLORS[0][0], strokes: new Map(), cv: null, cond: null, key: null, ro: null, drawing: null };
  const markStrokes = () => { if (!MARK.strokes.has(MARK.key)) MARK.strokes.set(MARK.key, []); return MARK.strokes.get(MARK.key); };

  function markRedraw() {
    const cv = MARK.cv, cond = MARK.cond;
    if (!cv || !cond) return;
    const w = cond.clientWidth, h = cond.scrollHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of MARK.strokes.get(MARK.key) || []) {
      g.strokeStyle = s.c; g.lineWidth = 3; g.globalAlpha = .9;
      g.beginPath();
      s.p.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * w) : g.moveTo(x * w, y * w)));
      if (s.p.length === 1) g.lineTo(s.p[0][0] * w + .1, s.p[0][1] * w);
      g.stroke();
    }
  }
  /** Холст поверх условия текущего задания (после каждой перерисовки задания). */
  function markAttach() {
    // слайд курса или условие задания; у каждого слайда свой рисунок
    const stage = courseShown && DECK && $('#crsDeck .crs-stage');
    const cond = stage || $('#cond'), t = stage ? null : pyTaskNow();
    const key = stage ? `deck:${DECK.n}:${deckI}` : t && t.id;
    if (!cond || !key) { MARK.cv = MARK.cond = null; return; }
    if (MARK.cond === cond && MARK.cv && MARK.cv.isConnected && MARK.key === key) return;
    if (MARK.cv && MARK.cv.isConnected) MARK.cv.remove();
    MARK.key = key; MARK.cond = cond;
    cond.classList.add('mark-host');
    const cv = document.createElement('canvas');
    cv.className = 'mark-canvas';
    cond.appendChild(cv);
    MARK.cv = cv;
    if (MARK.ro) MARK.ro.disconnect();
    MARK.ro = new ResizeObserver(markRedraw);
    MARK.ro.observe(cond);
    cv.addEventListener('pointerdown', markDown);
    markRedraw();
    markSetOn(MARK.on);
  }
  function markPoint(e) {
    const r = MARK.cv.getBoundingClientRect(), w = MARK.cond.clientWidth;
    return [(e.clientX - r.left) / w, (e.clientY - r.top) / w];
  }
  function markErase(pt) {
    const list = markStrokes(), w = MARK.cond.clientWidth, R = 14 / w;
    const keep = list.filter(s => !s.p.some(([x, y]) => Math.hypot(x - pt[0], y - pt[1]) < R));
    if (keep.length !== list.length) { MARK.strokes.set(MARK.key, keep); markRedraw(); }
  }
  function markDown(e) {
    if (!MARK.on) return;
    e.preventDefault();
    MARK.cv.setPointerCapture(e.pointerId);
    const pt = markPoint(e);
    if (MARK.tool === 'eraser') { MARK.drawing = 'erase'; markErase(pt); }
    else { MARK.drawing = { c: MARK.color, p: [pt] }; markStrokes().push(MARK.drawing); markRedraw(); }
    const move = ev => {
      const p = markPoint(ev);
      if (MARK.drawing === 'erase') markErase(p);
      else if (MARK.drawing) { MARK.drawing.p.push(p); markRedraw(); }
    };
    const up = () => { MARK.drawing = null; MARK.cv.removeEventListener('pointermove', move); MARK.cv.removeEventListener('pointerup', up); MARK.cv.removeEventListener('pointercancel', up); };
    MARK.cv.addEventListener('pointermove', move);
    MARK.cv.addEventListener('pointerup', up);
    MARK.cv.addEventListener('pointercancel', up);
  }
  function markBarHtml() {
    return MARK_COLORS.map(([c, n]) => `<button type="button" class="mark-swatch${MARK.tool === 'pen' && MARK.color === c ? ' on' : ''}" data-mcolor="${c}" style="--sw:${c}" title="${n}" aria-label="${n}"></button>`).join('')
      + `<button type="button" class="mark-tool${MARK.tool === 'eraser' ? ' on' : ''}" data-mtool="eraser" title="Ластик — стирает линию целиком" aria-label="Ластик"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21"/><path d="M22 21H7M5 11l9 9"/></svg></button>`
      + '<button type="button" class="mark-tool" data-mtool="clear" title="Стереть всё на этом задании" aria-label="Стереть всё"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>';
  }
  function markSetOn(on) {
    MARK.on = on;
    const btn = $('#markBtn');
    if (btn) { btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
    if (MARK.cv) MARK.cv.classList.toggle('active', on);
    let bar = $('#markBar');
    if (on && btn && !bar) {
      bar = document.createElement('span');
      bar.className = 'mark-bar'; bar.id = 'markBar';
      btn.after(bar);
    }
    if (bar) { if (on) bar.innerHTML = markBarHtml(); else bar.remove(); }
  }
  document.addEventListener('click', e => {
    if (e.target.closest('#markBtn')) { markAttach(); markSetOn(!MARK.on); return; }
    const sw = e.target.closest('[data-mcolor]');
    if (sw) { MARK.color = sw.dataset.mcolor; MARK.tool = 'pen'; markSetOn(true); return; }
    const tl = e.target.closest('[data-mtool]');
    if (tl) {
      if (tl.dataset.mtool === 'clear') { MARK.strokes.set(MARK.key, []); markRedraw(); return; }
      MARK.tool = MARK.tool === 'eraser' ? 'pen' : 'eraser'; markSetOn(true);
    }
  });
  // задание перерисовалось (новое, проверка, вариант) — вернуть холст и рисунок
  new MutationObserver(() => { if ($('#cond') && (!MARK.cond || !MARK.cond.isConnected || MARK.cond !== $('#cond'))) markAttach(); })
    .observe(trainerEl, { childList: true });
  const codeKey = id => `egeshka.code.${student ? student.sid : 'local'}.${id}`;
  function readCode(id) { try { return localStorage.getItem(codeKey(id)); } catch (e) { return null; } }
  function writeCode(id, code) { try { if (code.trim()) localStorage.setItem(codeKey(id), code); else localStorage.removeItem(codeKey(id)); } catch (e) { /* нет места */ } }
  function pyFilesOf(t) {
    return (t && t.att || []).map(a => ({ name: a.name, url: new URL(a.href, location.href).href }))
      .filter(f => f.url.startsWith(location.origin));       // внешние ссылки браузер не даст прочитать
  }
  /** Редактор открывается пустым: заготовки для черепахи (№6) и файлов (№17 и др.) убраны — пишем сами. */
  function pyStarter() { return ''; }
  function setPyStatus(text, cls) {
    const el = $('#pyStatus');
    el.textContent = text;
    el.className = 'py-status' + (cls ? ' ' + cls : '');
  }
  function ensureWorker() {
    if (PY.worker) return;
    PY.ready = false;
    if (typeof Worker === 'undefined') { setPyStatus('Этот браузер не умеет запускать Python', 'bad'); return; }
    PY.worker = new Worker('py-worker.js' + (RULES.py_local ? '?local=1' : ''));
    setPyStatus('Загружаю Python… (в первый раз около 10 МБ, потом из кеша)');
    PY.worker.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'status') setPyStatus(m.text);
      else if (m.type === 'ready') { PY.ready = true; if (!PY.running) setPyStatus(`Python ${m.version ? '(Pyodide ' + m.version + ') ' : ''}готов. Ctrl+Enter — запустить.`); }
      else if (m.type === 'out' || m.type === 'err') pyPrint(m.text, m.type === 'err');
      else if (m.type === 'turtle') drawTurtle(m.ops);
      else if (m.type === 'done') {
        PY.running = false;
        $('#pyRun').hidden = false;
        $('#pyStop').hidden = true;
        setPyStatus(m.ok ? `Готово за ${(m.ms / 1000).toFixed(m.ms < 10000 ? 2 : 1)} с` : 'Ошибка — смотрите сообщение ниже', m.ok ? 'ok' : 'bad');
        if (m.fatal) { PY.worker.terminate(); PY.worker = null; ensureWorker(); }   // интерпретатор сломан — запускаем новый
      }
    };
    PY.worker.onerror = () => { setPyStatus('Python не загрузился. Проверьте интернет и обновите страницу.', 'bad'); };
  }
  function pyPrint(text, isErr) {
    const out = $('#pyOut');
    if (isErr) {
      const span = document.createElement('span');
      span.className = 'py-err';
      span.textContent = text;
      out.appendChild(span);
    } else {
      out.appendChild(document.createTextNode(text));
    }
    out.scrollTop = out.scrollHeight;
  }
  function pyRun() {
    if (PY.running) return;
    const t = PY.task;
    const code = $('#pyCode').value;
    if (t) writeCode(t.id, code);
    if (!code.trim()) { setPyStatus('Напишите код', 'bad'); return; }
    ensureWorker();
    $('#pyOut').textContent = '';
    $('#pyTurtle').hidden = true;
    PY.running = true;
    $('#pyRun').hidden = true;
    $('#pyStop').hidden = false;
    setPyStatus(PY.ready ? 'Выполняется…' : 'Загружаю Python… код запустится сразу после загрузки');
    PY.worker.postMessage({ type: 'run', code, files: pyFilesOf(t), stdin: $('#pyIn').value });
  }
  function pyStop() {
    if (PY.worker) PY.worker.terminate();
    PY.worker = null;
    PY.running = false;
    $('#pyRun').hidden = false;
    $('#pyStop').hidden = true;
    pyPrint('\n■ Остановлено\n', true);
    ensureWorker();                         // сразу готовим новый — следующий запуск будет быстрым
    setPyStatus('Остановлено. Python перезапускается…');
  }
  function togglePy(force) {
    const open = force != null ? force : !pyOpen();
    if (open && bdOpen()) toggleBoard(false);
    $('#pyDock').hidden = !open;
    document.body.classList.toggle('py-open', open);
    $$('#pyBtn').forEach(b => b.classList.toggle('on', open));
    if (!open) { if (PY.task) writeCode(PY.task.id, $('#pyCode').value); return; }
    ensureWorker();
    PY.task = null;
    pySync();
    $('#pyCode').focus();
  }
  async function pySync() {
    if (!pyOpen()) return;
    $$('#pyBtn').forEach(b => b.classList.add('on'));
    const t = pyTaskNow();
    if (!t || (PY.task && PY.task.id === t.id)) return;
    if (PY.task) writeCode(PY.task.id, $('#pyCode').value);
    PY.task = t;
    const files = pyFilesOf(t);
    $('#pyTask').textContent = t.pyc ? t.label : `задание ${numLabel(t.n)}`;
    $('#pyFiles').innerHTML = files.length
      ? 'Файлы рядом с кодом: ' + files.map(f => `<code>open('${esc(f.name)}')</code>`).join(' ')
      : (t.att || []).length ? 'Файлы этого задания лежат на другом сайте — скачайте их кнопкой под условием.' : '';
    $('#pyAttach').textContent = 'Прикрепить решение';
    $('#pyAttach').hidden = !SERVER || !student || !!t.pyc;     // в курсе программирования код уходит вместе с ответом
    let code = readCode(t.id);
    if (code == null && SERVER && student && !t.pyc) {
      try { const r = await api('solution?task=' + encodeURIComponent(t.id)); if (r.code) { code = r.code; $('#pyAttach').textContent = 'Решение прикреплено ✓'; } } catch (e) { /* нет решения */ }
      if (!PY.task || PY.task.id !== t.id) return;   // пока ждали, ученик ушёл на другое задание
    }
    $('#pyCode').value = code != null ? code : pyStarter(t);
    updateGutter();
    $('#pyOut').textContent = '';
    $('#pyTurtle').hidden = true;
  }
  function updateGutter() {
    const ta = $('#pyCode');
    const n = ta.value.split('\n').length;
    const g = $('#pyGutter');
    if (+g.dataset.n !== n) { g.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); g.dataset.n = n; }
    pyPaint(true);
  }
  /** Раскраска под полем ввода; парная скобка у курсора подсвечивается рамкой (как в PyCharm). */
  let pyMarks = '';
  function pyPaint(force) {
    const ta = $('#pyCode');
    const marks = bracketMarks(ta.value, ta.selectionStart, ta.selectionEnd, document.activeElement === ta);
    const key = marks.map(m => m.join(':')).join(',');
    if (!force && key === pyMarks) return;
    pyMarks = key;
    $('#pyHl').innerHTML = '<div class="py-hl-in">' + highlightPy(ta.value, marks) + '\n</div>';
    syncScroll();
  }
  // раскрашенная копия сдвигается сдвигом, а не прокруткой: у прокрутки свой предел, и в конце длинной строки
  // копия «отставала» от поля ввода — часть кода становилась невидимой
  function syncScroll() {
    const ta = $('#pyCode'), inner = $('#pyHl').firstElementChild;
    $('#pyGutter').scrollTop = ta.scrollTop;
    if (inner) inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  }
  /** Скобка рядом с курсором (или выделенная) и её пара: [[позиция, 'ok'|'bad'], ...]. Скобки в строках и комментариях не в счёт. */
  const BR_OPEN = '([{', BR_CLOSE = ')]}';
  function bracketMarks(code, a, b, focused) {
    if (!focused || code.length > 200000) return [];
    let i = -1;
    if (b - a === 1 && (BR_OPEN + BR_CLOSE).includes(code[a])) i = a;
    else if (a === b) {
      if (a > 0 && (BR_OPEN + BR_CLOSE).includes(code[a - 1])) i = a - 1;
      else if ((BR_OPEN + BR_CLOSE).includes(code[a])) i = a;
    }
    if (i < 0) return [];
    // где строки и комментарии — там скобки не считаем
    const skip = new Uint8Array(code.length);
    PY_TOK.lastIndex = 0;
    for (let m; (m = PY_TOK.exec(code));) if (m[1] || m[2]) skip.fill(1, m.index, PY_TOK.lastIndex);
    if (skip[i]) return [];
    const ch = code[i], open = BR_OPEN.includes(ch);
    const pair = open ? BR_CLOSE[BR_OPEN.indexOf(ch)] : BR_OPEN[BR_CLOSE.indexOf(ch)];
    const step = open ? 1 : -1;
    let depth = 0;
    for (let j = i; j >= 0 && j < code.length; j += step) {
      if (skip[j]) continue;
      if (code[j] === ch) depth++;
      else if (code[j] === pair && --depth === 0) return [[Math.min(i, j), 'ok'], [Math.max(i, j), 'ok']];
    }
    return [[i, 'bad']];
  }

  // подсветка синтаксиса в цветах PyCharm: под прозрачным полем ввода лежит раскрашенная копия текста
  const PY_KW = new Set(('False None True and as assert async await break class continue def del elif else except finally for '
    + 'from global if import in is lambda nonlocal not or pass raise return try while with yield match case').split(' '));
  const PY_BI = new Set(('abs all any ascii bin bool bytes callable chr complex dict dir divmod enumerate eval exec filter float '
    + 'format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max '
    + 'min next object oct open ord pow print range repr reversed round set setattr slice sorted str sum super tuple type vars zip '
    + 'Exception ValueError KeyError IndexError TypeError ZeroDivisionError RecursionError StopIteration NameError').split(' '));
  const PY_TOK = /(#[^\n]*)|((?:[rRbBuUfF]{1,2})?(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))|(@[A-Za-z_][\w.]*)|(\b(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?)\b|\.\d+\b)|([A-Za-z_\u0400-\u04FF][\w\u0400-\u04FF]*)/g;
  function highlightPy(code, marks) {
    let out = '', last = 0, prevWord = '';
    const mk = new Map((marks || []).map(([p, k]) => [p, k]));
    // обычный текст между словами и строками; в нём же стоят скобки — их и обводим
    const plain = (from, to) => {
      if (!mk.size) return esc(code.slice(from, to));
      let o = '';
      for (let k = from; k < to; k++) o += mk.has(k) ? `<span class="hl-br ${mk.get(k)}">${esc(code[k])}</span>` : esc(code[k]);
      return o;
    };
    PY_TOK.lastIndex = 0;
    for (let m; (m = PY_TOK.exec(code));) {
      out += plain(last, m.index);
      last = PY_TOK.lastIndex;
      const [tok, com, str, dec, num, word] = m;
      let cls = '';
      if (com) cls = 'com';
      else if (str) cls = 'str';
      else if (dec) cls = 'dec';
      else if (num) cls = 'num';
      else if (word) {
        cls = PY_KW.has(word) ? 'kw' : (prevWord === 'def' || prevWord === 'class') ? 'def' : word === 'self' ? 'self' : PY_BI.has(word) ? 'bi' : '';
        prevWord = word;
      }
      if (!word) prevWord = '';
      out += cls ? `<span class="hl-${cls}">${esc(tok)}</span>` : esc(tok);
    }
    return out + plain(last, code.length);
  }
  const FONT_KEY = 'egeshka.pyFont';
  function setPyFont(px) {
    px = Math.min(28, Math.max(10, px));
    $('#pyDock').style.setProperty('--py-fs', px + 'px');
    try { localStorage.setItem(FONT_KEY, String(px)); } catch (e) { /* нет места */ }
    syncScroll();
  }
  const pyFont = () => parseInt(getComputedStyle($('#pyDock')).getPropertyValue('--py-fs'), 10) || 14;
  try { const f = +localStorage.getItem(FONT_KEY); if (f) setPyFont(f); } catch (e) { /* нет доступа */ }
  // Клавиши Emacs в редакторе (кнопка «Emacs» включает и выключает, запоминается в браузере). Клавиши — по физическому месту:
  // работают и в русской раскладке. Ctrl+C/V/X/Z, Ctrl+Enter, Ctrl+/ — как раньше. Ctrl+N и Ctrl+W браузер странице не отдаёт
  // (новое окно, закрыть вкладку) — вместо них стрелка вниз и Ctrl+X. Выделить всё — Ctrl+X H (Ctrl+A — начало строки).
  const EMACS_KEY = 'egeshka.pyEmacs';
  const EM = { on: true, kill: '', last: '', col: null, mark: null, cx: false };
  try { EM.on = localStorage.getItem(EMACS_KEY) !== '0'; } catch (e) { /* по умолчанию — включены */ }
  function setEmacs(on) {
    EM.on = on;
    EM.mark = null;
    try { localStorage.setItem(EMACS_KEY, on ? '1' : '0'); } catch (e) { /* только на этот раз */ }
    const b = $('#pyEmacs');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
  /** Курсор p виден: строка — по вертикали, столбец — по горизонтали (строки не переносятся). */
  function emShow(ta, p, center) {
    const v = ta.value, cs = getComputedStyle(ta), lh = parseFloat(cs.lineHeight) || 20, pt = parseFloat(cs.paddingTop) || 0;
    const row = v.slice(0, p).split('\n').length - 1, top = pt + row * lh;
    if (center) ta.scrollTop = Math.max(0, top - (ta.clientHeight - lh) / 2);
    else if (top < ta.scrollTop) ta.scrollTop = top - pt;
    else if (top + lh > ta.scrollTop + ta.clientHeight) ta.scrollTop = top + lh + pt - ta.clientHeight;
    const cw = (EM.cw = EM.cw || (() => { const c = document.createElement('canvas').getContext('2d'); c.font = cs.font; return c.measureText('0').width; })());
    const x = (parseFloat(cs.paddingLeft) || 0) + (p - v.lastIndexOf('\n', p - 1) - 1) * cw;
    if (x < ta.scrollLeft + cw) ta.scrollLeft = Math.max(0, x - 4 * cw);
    else if (x > ta.scrollLeft + ta.clientWidth - 2 * cw) ta.scrollLeft = x - ta.clientWidth + 4 * cw;
  }
  /** Клавиша Emacs: обработана — true. */
  function emacsKey(e) {
    if (!EM.on || e.isComposing) return false;
    const ta = e.target, v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const modOnly = /^(Shift|Control|Alt|Meta|OS)$/.test(e.key);
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey, meta = e.altKey && !e.ctrlKey && !e.metaKey;
    const done = (cmd = '') => { e.preventDefault(); EM.last = cmd; EM.cx = false; return true; };
    if (EM.cx && !modOnly) {                                   // Ctrl+X, затем H — выделить всё
      EM.cx = false;
      if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey && !e.metaKey) { EM.mark = null; ta.setSelectionRange(0, v.length); return done(); }
    }
    if (!ctrl && !meta) { if (!modOnly) { EM.last = ''; EM.mark = null; } return false; }
    const p = ta.selectionDirection === 'backward' ? a : b;    // где курсор (у выделения — подвижный край)
    const ls = q => v.lastIndexOf('\n', q - 1) + 1;
    const le = q => { const i = v.indexOf('\n', q); return i < 0 ? v.length : i; };
    const W = /[\p{L}\p{N}_]/u;
    const wordF = q => { while (q < v.length && !W.test(v[q])) q++; while (q < v.length && W.test(v[q])) q++; return q; };
    const wordB = q => { while (q > 0 && !W.test(v[q - 1])) q--; while (q > 0 && W.test(v[q - 1])) q--; return q; };
    const go = (q, cmd, shift = e.shiftKey) => {              // курсор в q; с меткой (Ctrl+Пробел) или с Shift — выделение
      q = Math.max(0, Math.min(v.length, q));
      const m = EM.mark != null ? EM.mark : shift ? (p === a ? b : a) : null;
      if (m == null) ta.setSelectionRange(q, q);
      else ta.setSelectionRange(Math.min(m, q), Math.max(m, q), q < m ? 'backward' : 'forward');
      emShow(ta, q);
      return done(cmd);
    };
    const edit = (from, to, text, caret) => {
      EM.mark = null;
      ta.setRangeText(text, from, to, 'end');
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event('input'));
      emShow(ta, caret);
    };
    const kill = (from, to, back) => {                         // вырезать в свой буфер; Ctrl+K подряд — дописывать
      if (from < to) {
        const s = v.slice(from, to);
        EM.kill = EM.last === 'kill' ? (back ? s + EM.kill : EM.kill + s) : s;
        edit(from, to, '', from);
      }
      return done('kill');
    };
    if (ctrl) {
      switch (e.code) {
        case 'KeyA': return go(ls(p));
        case 'KeyE': return go(le(p));
        case 'KeyF': return go(p + 1);
        case 'KeyB': return go(p - 1);
        case 'KeyN': case 'KeyP': {                            // строка вниз / вверх — в тот же столбец
          const s0 = ls(p), col = EM.last === 'line' && EM.col != null ? EM.col : p - s0;
          let q;
          if (e.code === 'KeyN') q = le(p) >= v.length ? v.length : Math.min(le(p) + 1 + col, le(le(p) + 1));
          else q = s0 === 0 ? 0 : Math.min(ls(s0 - 1) + col, s0 - 1);
          EM.col = col;
          return go(q, 'line');
        }
        case 'KeyD': if (a !== b) edit(a, b, '', a); else if (p < v.length) edit(p, p + 1, '', p); return done();
        case 'KeyH': if (a !== b) edit(a, b, '', a); else if (p > 0) edit(p - 1, p, '', p - 1); return done();
        case 'KeyK': return kill(p, p === le(p) && p < v.length ? p + 1 : le(p));
        case 'KeyY': if (!EM.kill) return false; edit(a, b, EM.kill, a + EM.kill.length); return done();
        case 'KeyO': edit(a, b, '\n', a); return done();
        case 'KeyG': EM.mark = null; ta.setSelectionRange(p, p); return done();
        case 'Space': EM.mark = p; ta.setSelectionRange(p, p); return done('mark');
        case 'KeyL': emShow(ta, p, true); return done();
        case 'KeyX': if (a !== b) return false; EM.cx = true; e.preventDefault(); return true;     // с выделением — вырезать, как обычно
        default: return false;
      }
    }
    switch (e.code) {
      case 'KeyF': return go(wordF(p));
      case 'KeyB': return go(wordB(p));
      case 'KeyD': return kill(p, wordF(p));
      case 'Backspace': return kill(wordB(p), p, true);
      case 'Comma': return e.shiftKey ? go(0, '', false) : false;               // Alt+< (Shift — часть знака, не выделение)
      case 'Period': return e.shiftKey ? go(v.length, '', false) : false;       // Alt+>
      case 'KeyW':                                             // копировать выделенное в свой буфер и в буфер обмена
        if (a === b) return done();
        EM.kill = v.slice(a, b);
        try { navigator.clipboard.writeText(EM.kill).catch(() => {}); } catch (err) { /* нет доступа — только свой буфер */ }
        EM.mark = null;
        ta.setSelectionRange(p, p);
        return done();
      default: return false;
    }
  }
  // редактор: Tab — 4 пробела, Shift+Tab — убрать отступ, Enter — отступ как у строки выше (+4 после «:»)
  function editKey(e) {
    if (emacsKey(e)) return;
    const ta = e.target;
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    const put = (text, from, to, caretA, caretB) => {
      ta.setRangeText(text, from, to, 'end');
      if (caretA != null) ta.setSelectionRange(caretA, caretB == null ? caretA : caretB);
      ta.dispatchEvent(new Event('input'));
    };
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); pyRun(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); setPyFont(pyFont() + 1); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setPyFont(pyFont() - 1); return; }
    // Ctrl+/ — закомментировать строку или выделенные строки (повторно — снять), как в PyCharm.
    // По физической клавише: в русской раскладке на ней точка
    if ((e.ctrlKey || e.metaKey) && (e.code === 'Slash' || e.key === '/')) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      let le = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b);
      if (le < 0) le = v.length;
      const lines = v.slice(ls, le).split('\n');
      const code = lines.filter(l => l.trim());
      const off = code.length && code.every(l => /^\s*#/.test(l));
      const ind = Math.min(...code.map(l => l.match(/^ */)[0].length), Infinity);
      const out = lines.map(l => {
        if (!l.trim()) return l;
        return off ? l.replace(/^(\s*)# ?/, '$1') : l.slice(0, ind) + '# ' + l.slice(ind);
      }).join('\n');
      const d = out.length - (le - ls);
      if (a === b) {                              // без выделения — курсор остаётся на своём месте в строке
        const k = off ? Math.max(ls, a + d) : a + d;
        put(out, ls, le, k);
      } else put(out, ls, le, ls, ls + out.length);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      if (!e.shiftKey && a === b) { put('    ', a, b); return; }
      const le = b > a && v[b - 1] === '\n' ? b - 1 : b;
      const block = v.slice(ls, le);
      const lines = block.split('\n');
      const changed = lines.map(l => (e.shiftKey ? l.replace(/^ {1,4}/, '') : '    ' + l)).join('\n');
      put(changed, ls, le, ls, ls + changed.length);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      const line = v.slice(ls, a);
      let ind = (line.match(/^\s*/) || [''])[0];
      if (/:\s*(#.*)?$/.test(line)) ind += '    ';
      put('\n' + ind, a, b);
      return;
    }
    // парные скобки и кавычки: открыл — сразу закрылась, курсор внутри; закрывающую поверх такой же — просто перешагнуть
    const PAIR = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    if (!(e.ctrlKey && !e.altKey) && !e.metaKey && !e.isComposing && e.key && e.key.length === 1) {   // AltGr = Ctrl+Alt — тоже ввод символа
      const k = e.key, nx = v[b] || '', pv = v[a - 1] || '';
      const isQ = k === '"' || k === "'";
      if (a === b && (')]}'.includes(k) || isQ) && nx === k) { e.preventDefault(); ta.setSelectionRange(a + 1, a + 1); pyPaint(); return; }
      if (PAIR[k]) {
        if (a !== b) { e.preventDefault(); put(k + v.slice(a, b) + PAIR[k], a, b, a + 1, b + 1); return; }   // обернуть выделение
        const free = !nx || /[\s)\]},:;=]/.test(nx);
        if (free && !(isQ && (/\w/.test(pv) || pv === k))) { e.preventDefault(); put(k + PAIR[k], a, b, a + 1); return; }
      }
    }
    if (e.key === 'Backspace' && a === b && a > 0 && PAIR[v[a - 1]] && PAIR[v[a - 1]] === v[a]) {
      e.preventDefault(); put('', a - 1, a + 1, a - 1); return;          // пустая пара () — удалить обе
    }
    if (e.key === 'Backspace' && a === b && a > 0) {
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      const before = v.slice(ls, a);
      if (before.length && /^ +$/.test(before)) { e.preventDefault(); const k = (before.length - 1) % 4 + 1; put('', a - k, a); }
    }
  }

  // черепашка: рисунок на холсте. Сразу подгоняется под фигуру (а не под сетку точек), линии толще и ярче,
  // масштаб — колесом, щипком тачпада или кнопками, сдвиг — перетаскиванием или двумя пальцами
  const TT = { ops: null, s: 1, ox: 0, oy: 0, drag: null, step: 1 };
  function drawTurtle(ops) {
    TT.ops = ops;
    TT.step = gridStep(ops);
    $('#pyTurtle').hidden = false;
    fitTurtle(false);
  }
  /** Шаг сетки — масштаб k из кода (forward(10*k)): общий делитель координат линий. */
  function gridStep(ops) {
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    let g = 0, n = 0;
    for (const o of ops) {
      if (o[0] !== 'l') continue;
      for (const v of [o[1], o[2], o[3], o[4]]) {
        const r = Math.round(Math.abs(v));
        if (Math.abs(Math.abs(v) - r) > 1e-6) return 1;          // дробные координаты — сетка по единице
        if (r) { g = gcd(g, r); n++; }
      }
    }
    return n && g ? g : 1;
  }
  function ttCanvas() {
    const c = $('#pyCanvas');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    return { c, ctx: c.getContext('2d'), w, h, dpr };
  }
  function fitTurtle(all) {
    if (!TT.ops) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    const shape = TT.ops.some(o => o[0] === 'l' || o[0] === 'f');
    for (const o of TT.ops) {
      if (o[0] === 'l') { take(o[1], o[2]); take(o[3], o[4]); } else if (o[0] === 'f') o[1].forEach(p => take(p[0], p[1]));
      else if (all || !shape) take(o[1], o[2]);
    }
    if (!isFinite(x0)) { x0 = y0 = -100; x1 = y1 = 100; }
    const { w, h } = ttCanvas();
    const pad = 36;
    TT.s = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
    if (!isFinite(TT.s) || TT.s <= 0) TT.s = 1;
    TT.ox = w / 2 - TT.s * (x0 + x1) / 2;
    TT.oy = h / 2 + TT.s * (y0 + y1) / 2;
    renderTurtle();
  }
  function zoomAt(f, mx, my) {
    TT.ox = mx - (mx - TT.ox) * f; TT.oy = my - (my - TT.oy) * f; TT.s *= f;
    renderTurtle();
  }
  function renderTurtle() {
    if (!TT.ops) return;
    const { ctx, w, h, dpr } = ttCanvas();
    const css = getComputedStyle(document.documentElement);
    const v = name => css.getPropertyValue(name).trim();
    const light = v('color-scheme') === 'light';
    const LINE = light ? '#1c1a36' : '#ffcc00', DOT = light ? '#e8334f' : '#7fdbff';
    const col = (c, def) => (!c || c === 'default' ? def : (!light || !/^(white|#fff(fff)?)$/i.test(c)) && (light || !/^(black|#000(000)?)$/i.test(c)) ? c : def);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = light ? '#ffffff' : '#141229';
    ctx.fillRect(0, 0, w, h);
    const X = x => x * TT.s + TT.ox, Y = y => TT.oy - y * TT.s;
    // сетка: точки с целыми координатами в шагах k — по ним удобно считать точки внутри фигуры
    const px = TT.step * TT.s;
    if ($('#pyGrid').checked && px >= 6) {
      const ix0 = Math.ceil((0 - TT.ox) / px), ix1 = Math.floor((w - TT.ox) / px);
      const iy0 = Math.ceil((TT.oy - h) / px), iy1 = Math.floor(TT.oy / px);
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) < 60000) {
        ctx.fillStyle = light ? 'rgba(28,26,54,.28)' : 'rgba(255,255,255,.22)';
        const r = Math.min(2.2, Math.max(1, px / 10));
        for (let i = ix0; i <= ix1; i++) for (let j = iy0; j <= iy1; j++) ctx.fillRect(X(i * TT.step) - r / 2, Y(j * TT.step) - r / 2, r, r);
      }
    }
    ctx.strokeStyle = light ? 'rgba(28,26,54,.35)' : 'rgba(255,255,255,.3)';            // оси
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h); ctx.stroke();
    for (const o of TT.ops) {
      if (o[0] !== 'f') continue;
      ctx.fillStyle = col(o[2], LINE); ctx.globalAlpha = 0.3;
      ctx.beginPath(); o[1].forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const o of TT.ops) {
      if (o[0] === 'l') {
        ctx.strokeStyle = col(o[5], LINE); ctx.lineWidth = Math.max(2.5, o[6]);
        ctx.beginPath(); ctx.moveTo(X(o[1]), Y(o[2])); ctx.lineTo(X(o[3]), Y(o[4])); ctx.stroke();
      }
    }
    for (const o of TT.ops) {
      if (o[0] === 'd') {
        ctx.fillStyle = col(o[4], DOT);
        ctx.beginPath(); ctx.arc(X(o[1]), Y(o[2]), Math.max(2, o[3] / 2), 0, 2 * Math.PI); ctx.fill();
      } else if (o[0] === 't') {
        ctx.fillStyle = col(o[4], LINE); ctx.font = '13px sans-serif'; ctx.fillText(o[3], X(o[1]), Y(o[2]));
      }
    }
  }
  const pyCanvas = $('#pyCanvas');
  pyCanvas.addEventListener('wheel', e => {
    if (!TT.ops) return;
    e.preventDefault();
    const r = pyCanvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    // щипок тачпада (ctrlKey) и колесо мыши — масштаб; прокрутка двумя пальцами — сдвиг
    if (e.ctrlKey || (e.deltaX === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy))) {
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025)), mx, my);
    } else {
      TT.ox -= e.deltaX; TT.oy -= dy;
      renderTurtle();
    }
  }, { passive: false });
  pyCanvas.addEventListener('pointerdown', e => { TT.drag = { x: e.clientX, y: e.clientY, ox: TT.ox, oy: TT.oy }; pyCanvas.setPointerCapture(e.pointerId); });
  pyCanvas.addEventListener('pointermove', e => {
    const r = pyCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left - TT.ox) / TT.s, y = (TT.oy - (e.clientY - r.top)) / TT.s;
    const k = TT.step;
    $('#pyXY').textContent = k > 1 ? `x = ${(x / k).toFixed(1)}, y = ${(y / k).toFixed(1)} (в шагах k = ${k})` : `x = ${x.toFixed(1)}, y = ${y.toFixed(1)}`;
    if (!TT.drag) return;
    TT.ox = TT.drag.ox + e.clientX - TT.drag.x; TT.oy = TT.drag.oy + e.clientY - TT.drag.y;
    renderTurtle();
  });
  pyCanvas.addEventListener('pointerup', () => { TT.drag = null; });
  pyCanvas.addEventListener('dblclick', () => fitTurtle(false));
  const zoomCenter = f => { const { w, h } = ttCanvas(); zoomAt(f, w / 2, h / 2); };
  $('#pyZoomIn').addEventListener('click', () => zoomCenter(1.5));
  $('#pyZoomOut').addEventListener('click', () => zoomCenter(1 / 1.5));
  $('#pyFit').addEventListener('click', () => fitTurtle(false));
  $('#pyFitAll').addEventListener('click', () => fitTurtle(true));
  $('#pyGrid').addEventListener('change', renderTurtle);
  $('#pyTtClose').addEventListener('click', () => {
    if ($('#pyTurtle').classList.contains('big')) $('#pyBig').click();
    $('#pyTurtle').hidden = true;
  });
  $('#pyBig').addEventListener('click', () => {
    const box = $('#pyTurtle');
    box.classList.toggle('big');
    document.body.classList.toggle('tt-big', box.classList.contains('big'));
    $('#pyBig').textContent = box.classList.contains('big') ? '× свернуть' : '⤢ крупно';
    requestAnimationFrame(() => fitTurtle(false));
  });
  window.addEventListener('resize', () => { if (TT.ops && !$('#pyTurtle').hidden) renderTurtle(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#pyTurtle').classList.contains('big')) $('#pyBig').click(); });

  $('#pyRun').addEventListener('click', pyRun);
  $('#pyStop').addEventListener('click', pyStop);
  $('#pyClose').addEventListener('click', () => togglePy(false));
  $('#pyToBd').addEventListener('click', () => toggleBoard(true));
  $('#pyCode').addEventListener('keydown', editKey);
  $('#pyCode').addEventListener('input', () => {
    updateGutter();
    $('#pyAttach').textContent = 'Прикрепить решение';
    clearTimeout(PY.saveTimer);
    const t = PY.task;
    PY.saveTimer = setTimeout(() => { if (t) writeCode(t.id, $('#pyCode').value); }, 500);
  });
  $('#pyCode').addEventListener('scroll', syncScroll);
  // курсор переехал — пересчитать подсветку парной скобки
  document.addEventListener('selectionchange', () => { if (document.activeElement === $('#pyCode')) pyPaint(); });
  $('#pyCode').addEventListener('blur', () => pyPaint());
  $('#pyEmacs').addEventListener('click', () => { setEmacs(!EM.on); $('#pyCode').focus(); });
  setEmacs(EM.on);
  $('#pyFontUp').addEventListener('click', () => setPyFont(pyFont() + 1));
  $('#pyFontDown').addEventListener('click', () => setPyFont(pyFont() - 1));
  $('#pyLoad').addEventListener('click', () => $('#pyFile').click());
  $('#pyFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 200000) { toast('Файл слишком большой'); return; }
    $('#pyCode').value = await f.text();
    $('#pyCode').dispatchEvent(new Event('input'));
  });
  $('#pyAttach').addEventListener('click', async () => {
    const t = PY.task;
    if (!t || !SERVER) return;
    const code = $('#pyCode').value;
    if (!code.trim()) { toast('Сначала напишите решение'); return; }
    try {
      await api('solution', { task: t.id, code });
      $('#pyAttach').textContent = 'Решение прикреплено ✓';
      toast('Решение прикреплено — учитель увидит его в журнале рядом с ответом.', 3500);
    } catch (e) { netError(e); }
  });

  /** Код из редактора Python к этому заданию — прикрепить как решение (при «Сдать ответ»). true — прикрепили. */
  async function autoAttach(tid) {
    if (!SERVER || !student || !tid) return false;
    const code = PY.task && PY.task.id === tid ? $('#pyCode').value : readCode(tid);
    if (!code || !code.trim()) return false;
    try {
      await api('solution', { task: tid, code });
      if (PY.task && PY.task.id === tid) $('#pyAttach').textContent = 'Решение прикреплено ✓';
      return true;
    } catch (e) { return false; }
  }

