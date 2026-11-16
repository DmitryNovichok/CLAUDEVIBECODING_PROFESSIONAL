  // ------------------------------------------------------------ лаборатория исправления ошибок
  /* Даётся задача и чужое «решение»: в нём ошибки, пропуск или оно слишком медленное. Ученик правит код и нажимает
     «Проверить»: код выполняется в браузере на входных данных тестов, выводы уходят на сервер, сервер сравнивает их
     с ожидаемыми. Это самопроверка по присланным выводам, не независимое выполнение кода и не основание для оценки. */
  const BUG = { cases: null, levels: {}, kinds: {}, cur: null, filter: 0, worker: null, timer: null, busy: false,
    results: {}, hints: {}, explain: {}, owner: null, loadId: 0, runId: 0, cancel: null };
  const bugActive = () => labActive() && LAB.view === 'bugs' && !!$('#bugRoot');
  const bugCase = () => (BUG.cases || []).find(c => c.id === BUG.cur) || null;
  const bugDraftKey = id => codeKey('bug:' + id);
  const bugCode = c => { const d = readJSON(bugDraftKey(c.id)); return d && typeof d.code === 'string' ? d.code.slice(0, 20000) : c.code; };
  const BUG_ERR = {
    ZeroDivisionError: 'деление на ноль', IndexError: 'обращение к элементу, которого нет в списке или строке',
    NameError: 'используется имя, которое нигде не задано', TypeError: 'операция с неподходящим типом данных',
    ValueError: 'значение нельзя преобразовать (например, int() от нечисла)', RecursionError: 'рекурсия не останавливается',
    SyntaxError: 'ошибка в записи программы', IndentationError: 'неверный отступ', EOFError: 'программа читает больше данных, чем есть во входе',
    KeyError: 'в словаре нет такого ключа', AttributeError: 'у значения нет такого метода', MemoryError: 'не хватило памяти',
    OverflowError: 'слишком большое число', UnboundLocalError: 'переменная используется до присваивания',
  };
  const bugErrText = r => `${BUG_ERR[r.kind] ? BUG_ERR[r.kind][0].toUpperCase() + BUG_ERR[r.kind].slice(1) : 'Ошибка выполнения'}${r.line ? ` — строка ${r.line}` : ''}`;
  /** Номера строк текущего кода, которых нет в исходном решении (наибольшая общая подпоследовательность строк). */
  function bugChanged(orig, now) {
    const a = orig.replace(/\s+$/, '').split('\n').map(x => x.replace(/\s+$/, '')), b = now.split('\n').map(x => x.replace(/\s+$/, ''));
    const n = a.length, m = b.length, d = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) d[i][j] = a[i] === b[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
    const out = new Set();
    for (let i = 0, j = 0; j < m;) {
      if (i < n && a[i] === b[j]) { i++; j++; } else if (i < n && d[i + 1][j] >= d[i][j + 1]) i++; else { if (b[j].trim()) out.add(j); j++; }
    }
    return out;
  }
  function bugReleaseWorker() {
    clearTimeout(BUG.timer); BUG.timer = null;
    if (BUG.worker) BUG.worker.terminate();
    BUG.worker = null; BUG.cancel = null;
  }
  function bugStop() {
    const cancel = BUG.cancel;
    ++BUG.runId;
    bugReleaseWorker(); BUG.busy = false;
    if (cancel) cancel(Error('stopped'));
  }
  function resetBugLab() {
    bugStop(); ++BUG.loadId;
    Object.assign(BUG, { cases: null, levels: {}, kinds: {}, cur: null, filter: 0,
      results: {}, hints: {}, explain: {}, owner: null });
  }
  const bugCurrent = (c, run, sid) => bugActive() && bugCase() === c && BUG.runId === run && appState.student?.sid === sid;
  function bugLabHtml() { return '<div id="bugRoot"><p class="fm-note">Загружаю задачи…</p></div>'; }
  async function bugLabInit() {
    const sid = appState.student?.sid;
    if (BUG.owner !== sid) { resetBugLab(); BUG.owner = sid; }
    const load = ++BUG.loadId;
    if (!BUG.cases) {
      try {
        const d = await api('lab/bugs');
        if (load !== BUG.loadId || appState.student?.sid !== sid) return;
        BUG.cases = d.cases || []; BUG.levels = d.levels || {}; BUG.kinds = d.kinds || {};
      } catch (e) {
        if (load === BUG.loadId && appState.student?.sid === sid && bugActive()) $('#bugRoot').innerHTML = '<p class="fm-note">Не удалось загрузить задачи. Открой лабораторию ещё раз.</p>';
        return;
      }
    }
    if (!bugActive()) return;
    if (bugCase()) bugRenderCase(); else bugRenderList();
  }
  const bugStatus = c => (c.my.verified ? ['good', 'есть проверенное решение'] : c.my.ok ? ['good', 'самопроверка пройдена'] : c.my.tries ? ['review', `${c.my.tries} ${plural(c.my.tries, 'попытка', 'попытки', 'попыток')}`] : ['', 'новая']);
  function bugRenderList() {
    const all = BUG.cases, done = all.filter(c => c.my.ok).length;
    const list = all.filter(c => !BUG.filter || c.level === BUG.filter);
    const next = all.find(c => !c.my.ok);
    $('#bugRoot').innerHTML = `
      <div class="bug-top"><div class="bug-prog"><b>${done} из ${all.length}</b><span>самопроверок пройдено</span>
          <i class="bug-track"><b style="width:${all.length ? Math.round(done / all.length * 100) : 0}%"></b></i></div>
        ${next ? `<button type="button" class="btn primary" data-bug-open="${esc(next.id)}">${done ? 'Продолжить' : 'Начать'}: «${esc(next.title)}» →</button>` : '<span class="chip good">Все самопроверки пройдены</span>'}</div>
      <p class="lab-note">В каждой задаче — условие и чужое решение. Где-то в нём ошибки, где-то оно не дописано, а где-то работает слишком долго.
        Исправь код и проверь его на примерах. Это самопроверка: программа запускается в твоём браузере. Она не даёт оценку, звёзды или подтверждение самостоятельного решения; код можно затем обсудить с учителем. Кнопка «Проверить на сервере» отдельно запускает присланный код и подтверждает результат тестов.</p>
      <nav class="lab-tabs bug-filter" aria-label="Уровень">${[[0, 'Все'], ...Object.entries(BUG.levels).map(([k, v]) => [+k, v])].map(([k, v]) =>
        `<button type="button" class="${BUG.filter === k ? 'on' : ''}" data-bug-level="${k}">${esc(v)}</button>`).join('')}</nav>
      <div class="bug-grid">${list.map(c => { const [cls, txt] = bugStatus(c); return `<button type="button" class="bug-card${c.my.ok ? ' done' : ''}" data-bug-open="${esc(c.id)}">
        <span class="bug-card-top"><span class="lab-kicker">${esc(c.topic)}</span><span class="chip ${cls}">${txt}</span></span>
        <b>${esc(c.title)}</b><span class="bug-card-sub">${esc(BUG.kinds[c.kind] || '')} · ${esc(BUG.levels[c.level] || '')}</span></button>`; }).join('')}</div>`;
  }
  const bugIntro = c => (c.kind === 'fill' ? 'Решение не дописано — закончи его.' : c.kind === 'speed' ? 'Решение верное, но слишком медленное — ускорь его.'
    : `В решении ${c.bugs} ${plural(c.bugs, 'ошибка', 'ошибки', 'ошибок')} — найди и исправь.`);
  function bugRenderCase() {
    const c = bugCase(), code = bugCode(c), idx = BUG.cases.indexOf(c);
    const [cls, txt] = bugStatus(c);
    const openTests = c.tests.filter(t => t.open);
    $('#bugRoot').innerHTML = `
      <div class="bug-nav"><button type="button" class="link-btn" data-bug-open="">← Все задачи</button>
        <span class="fm-muted">Задача ${idx + 1} из ${BUG.cases.length}</span><span class="chip ${cls}" id="bugChip">${txt}</span></div>
      <div class="bug-work">
        <section class="lab-panel bug-task"><span class="lab-kicker">${esc(c.topic)} · ${esc(BUG.levels[c.level] || '')}</span>
          <h2>${esc(c.title)}</h2><div class="bug-stmt">${safeHtml(c.stmt)}</div>
          <p class="bug-intro"><b>Автор решения — ${esc(c.who)}.</b> ${bugIntro(c)}</p>
          <h3>Примеры</h3>
          <div class="bug-samples">${openTests.map(t => `<div><div><span>Ввод</span><pre>${esc(t.in)}</pre></div><div><span>Должно получиться</span><pre>${esc(t.exp)}</pre></div></div>`).join('')}</div>
          <p class="fm-muted">Всего тестов: ${c.tests.length}. У остальных виден только результат — прошёл или нет.</p>
          <div class="bug-hints" id="bugHints"></div>
        </section>
        <section class="lab-panel bug-editor"><div class="bug-ed-head"><h2>Решение · ${esc(c.who)}</h2><span class="fm-muted" id="bugDiff"></span></div>
          <div class="bug-code ide"><pre class="bug-gutter" id="bugGutter" aria-hidden="true"></pre>
            <div class="ide-area"><pre class="ide-hl bug-hl" id="bugCodeHl" aria-hidden="true"></pre>
            <textarea id="bugCode" class="inp" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" maxlength="20000" aria-label="Код решения">${esc(code)}</textarea></div></div>
          <div class="bug-actions"><button type="button" class="btn primary" id="bugCheck" data-bug-act="check">Самопроверка</button>
            <button type="button" class="btn" id="bugVerify" data-bug-act="verify">Проверить на сервере</button>
            <button type="button" class="btn" id="bugStop" data-bug-act="stop" hidden>Остановить</button>
            <button type="button" class="btn" data-bug-act="hint" id="bugHintBtn"></button>
            <button type="button" class="btn ghost" data-bug-act="reset">Сбросить код</button>
            <button type="button" class="btn ghost" data-bug-act="explain" id="bugExplainBtn" hidden>Показать разбор</button></div>
          <p class="lab-status" id="bugStatus" role="status">Ctrl+Enter — самопроверка. Код выполняется в браузере; это не независимая проверка решения.</p>
          <details class="bug-own"><summary>Запустить на своих данных</summary>
            <textarea class="inp" id="bugStdin" rows="3" maxlength="10000" spellcheck="false" placeholder="Входные данные для input()"></textarea>
            <button type="button" class="btn" data-bug-act="run" id="bugOwnRun">Запустить</button><pre id="bugOwnOut" class="bug-out" hidden></pre></details>
          <div id="bugResult"></div>
        </section></div>`;
    bugSyncEditor(); bugRenderHints(); bugRenderResult();
  }
  function bugSyncEditor() {
    const c = bugCase(), ta = $('#bugCode');
    if (!c || !ta) return;
    const lines = ta.value.split('\n'), ch = bugChanged(c.code, ta.value);
    $('#bugGutter').innerHTML = lines.map((_, i) => `<span class="${ch.has(i) ? 'ch' : ''}">${i + 1}</span>`).join('\n');
    $('#bugGutter').scrollTop = ta.scrollTop;
    $('#bugCodeHl').innerHTML = '<div class="ide-hl-in">' + highlightPy(ta.value) + '\n</div>';
    bugScrollHl();
    ta.style.height = Math.max(180, Math.min(620, lines.length * 22 + 24)) + 'px';
    $('#bugDiff').textContent = ta.value.replace(/\s+$/, '') === c.code.replace(/\s+$/, '') ? 'код не менялся' : `изменено строк: ${ch.size}`;
  }
  function bugRenderHints() {
    const c = bugCase(), n = BUG.hints[c.id] || 0;
    $('#bugHints').innerHTML = n ? `<h3>Подсказки</h3><ol>${c.hints.slice(0, n).map(h => `<li>${safeHtml(h)}</li>`).join('')}</ol>` : '';
    const b = $('#bugHintBtn');
    b.textContent = n >= c.hints.length ? 'Подсказок больше нет' : `Подсказка ${n + 1} из ${c.hints.length}`;
    b.disabled = n >= c.hints.length;
    $('#bugExplainBtn').hidden = !(c.my.ok || c.my.tries >= 3) || !!BUG.explain[c.id];
  }
  const bugExplainHtml = list => `<div class="bug-explain"><h3>Что было не так</h3><ul>${list.map(x => `<li>${safeHtml(x)}</li>`).join('')}</ul></div>`;
  function bugRenderResult() {
    const c = bugCase(), r = BUG.results[c.id], box = $('#bugResult');
    if (!box) return;
    if (!r) { box.innerHTML = BUG.explain[c.id] ? bugExplainHtml(BUG.explain[c.id]) : ''; return; }
    const rows = r.tests.map((t, i) => {
      const run = r.runs?.[i] || {}, src = c.tests[i];
      const got = r.verified ? (t.ok ? 'тест пройден' : 'тест не пройден') : run.timeout ? (run.skipped ? 'не запускался' : 'не дождались ответа — программа работает слишком долго')
        : run.err ? bugErrText(run) : (run.out || '').trim() || '(пусто)';
      return `<tr class="${t.ok ? 'ok' : 'bad'}"><td>${t.ok ? '✓' : '✗'}</td><td>${i + 1}</td>
        <td>${t.open ? `<pre>${esc(src.in)}</pre>` : '<span class="fm-muted">скрытый тест</span>'}</td>
        <td>${t.open ? `<pre>${esc(t.exp)}</pre>` : '<span class="fm-muted">—</span>'}</td>
        <td>${t.ok && !t.open ? '<span class="fm-muted">верно</span>' : `<pre>${esc(String(got).slice(0, 400))}</pre>`}</td></tr>`;
    }).join('');
    const pass = r.tests.filter(t => t.ok).length;
    const idx = BUG.cases.indexOf(c), nxt = BUG.cases.slice(idx + 1).concat(BUG.cases.slice(0, idx)).find(x => !x.my.ok);
    const head = r.ok ? `<div class="bug-win"><b>${r.verified ? 'Код проверен на сервере' : 'Самопроверка пройдена'}</b>
        <span>${r.verified ? 'Присланный код прошёл все тесты при отдельном запуске.' : 'По выводам из браузера все примеры совпали. Независимая проверка кода не проводилась.'} Изменено строк: ${r.changed}.</span>
        <span class="bug-win-btns">${nxt ? `<button type="button" class="btn primary" data-bug-open="${esc(nxt.id)}">Следующая задача →</button>` : ''}<button type="button" class="btn" data-bug-open="">К списку задач</button></span></div>`
      : `<div class="bug-fail"><b>Пройдено тестов: ${pass} из ${r.tests.length}</b><span>Посмотри, на каком примере ответ расходится, и найди строку, которая за это отвечает.</span></div>`;
    box.innerHTML = `${head}${(r.explain || BUG.explain[c.id]) ? bugExplainHtml(r.explain || BUG.explain[c.id]) : ''}
      <div class="bug-table"><table><thead><tr><th></th><th>№</th><th>Ввод</th><th>Ожидалось</th><th>Получено</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function bugSetBusy(on, text) {
    BUG.busy = on;
    for (const id of ['bugCheck', 'bugVerify', 'bugCode', 'bugOwnRun']) if ($('#' + id)) $('#' + id).disabled = on;
    if ($('#bugStop')) $('#bugStop').hidden = !on;
    if (text && $('#bugStatus')) $('#bugStatus').textContent = text;
  }
  /** Выполнить код на наборе входных данных. Возвращает [{out, err, kind, line} | {timeout, skipped}] по каждому входу. */
  function bugRunAll(code, inputs) {
    return new Promise((resolve, reject) => {
      const runs = [];
      let worker;
      try { worker = new EgePythonWorker('lab-worker.js' + (RULES.py_local ? '?local=1' : '')); } catch (e) { reject(Error('Браузер не смог запустить Python.')); return; }
      BUG.worker = worker;
      BUG.cancel = reject;
      const fail = message => { bugReleaseWorker(); reject(Error(message)); };
      const finish = () => {
        bugReleaseWorker();
        const missing = runs.length;
        for (let i = missing; i < inputs.length; i++) runs.push({ timeout: true, skipped: i > missing });
        resolve(runs);
      };
      BUG.timer = setTimeout(() => fail('Python не успел загрузиться. Проверь интернет и повтори.'), 90000);
      worker.onmessage = e => {
        if (BUG.worker !== worker) return;
        const m = e.data;
        if (m.type === 'tests-start') { clearTimeout(BUG.timer); BUG.timer = setTimeout(finish, 12000); bugSetBusy(true, 'Выполняю программу на тестах…'); }
        else if (m.type === 'test') { runs[m.i] = m.result; clearTimeout(BUG.timer); BUG.timer = setTimeout(finish, 12000); }   // на каждый тест — до 12 секунд
        else if (m.type === 'tests-done') finish();
        else if (m.type === 'tests-error') fail(m.text);
        else if (m.type === 'done' && !m.ok) fail('Не удалось загрузить Python. Проверь интернет и повтори.');
      };
      worker.onerror = () => { if (BUG.worker === worker) fail('Не удалось запустить Python. Обнови страницу и попробуй ещё раз.'); };
      worker.postMessage({ type: 'tests', code, inputs });
    });
  }
  async function bugCheck() {
    const c = bugCase();
    if (!c || BUG.busy) return;
    const code = $('#bugCode').value;
    if (!code.trim()) { $('#bugStatus').textContent = 'Код пустой — нажми «Сбросить код», чтобы вернуть исходное решение.'; return; }
    bugStop();
    const run = BUG.runId, sid = appState.student?.sid;
    bugSetBusy(true, 'Загружаю Python… При первом запуске это может занять около минуты.');
    let runs;
    try { runs = await bugRunAll(code, c.tests.map(t => t.in)); }
    catch (e) { if (bugCurrent(c, run, sid)) bugSetBusy(false, e.message === 'stopped' ? 'Остановлено.' : e.message); return; }
    if (!bugCurrent(c, run, sid)) return;
    let r;
    try { r = await api('lab/bugs/check', { id: c.id, code, runs: runs.map(x => ({ out: String(x.out || '').slice(0, 6000), err: x.err ? 1 : 0, timeout: x.timeout ? 1 : 0 })) }); }
    catch (e) { if (bugCurrent(c, run, sid)) bugSetBusy(false, e.message || 'Не удалось проверить — попробуй ещё раз.'); return; }
    if (!bugCurrent(c, run, sid)) return;
    c.my = r.my;
    BUG.results[c.id] = { ok: r.ok, tests: r.tests, runs, changed: r.changed, par: r.par, star: r.ok && r.changed <= r.par && !!r.my.star, explain: r.explain };
    if (r.explain) BUG.explain[c.id] = r.explain;
    bugSetBusy(false, r.ok ? 'Самопроверка: примеры совпали. Это не оценка за решение.' : 'Есть тесты, которые не прошли. Таблица — ниже.');
    const [cls, txt] = bugStatus(c);
    $('#bugChip').className = 'chip ' + cls; $('#bugChip').textContent = txt;
    bugRenderHints(); bugRenderResult();
    $('#bugResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function bugVerify() {
    const c = bugCase();
    if (!c || BUG.busy) return;
    const code = $('#bugCode').value;
    if (!code.trim()) { $('#bugStatus').textContent = 'Сначала введи код решения.'; return; }
    bugStop();
    const run = BUG.runId, sid = appState.student?.sid;
    bugSetBusy(true, 'Проверяю код на сервере… Это может занять до двух минут.');
    // Closing the exercise only detaches its view; it does not pretend to cancel the server job.
    $('#bugStop').hidden = true;
    try {
      const r = await api('lab/bugs/verify', { id: c.id, code });
      if (!bugCurrent(c, run, sid)) return;
      if (r.verified !== true || r.provenance !== 'server_python') throw Error('Сервер не подтвердил независимую проверку. Результат не засчитан.');
      c.my = r.my;
      BUG.results[c.id] = { ...r, runs: [] };
      if (r.explain) BUG.explain[c.id] = r.explain;
      bugSetBusy(false, r.ok ? 'Код прошёл независимую проверку на сервере.' : 'Код проверен на сервере: есть непройденные тесты.');
      const [cls, txt] = bugStatus(c);
      $('#bugChip').className = 'chip ' + cls; $('#bugChip').textContent = txt;
      bugRenderHints(); bugRenderResult();
      $('#bugResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (bugCurrent(c, run, sid)) bugSetBusy(false, e.message || 'Не удалось проверить код. Результат не засчитан.');
    }
  }
  async function bugRunOwn() {
    const c = bugCase(), out = $('#bugOwnOut');
    if (!c || BUG.busy) return;
    bugStop();
    const run = BUG.runId, sid = appState.student?.sid;
    bugSetBusy(true, 'Загружаю Python…');
    out.hidden = false; out.textContent = 'Выполняю…';
    try {
      const [r] = await bugRunAll($('#bugCode').value, [$('#bugStdin').value]);
      if (!bugCurrent(c, run, sid)) return;
      out.textContent = r.timeout ? 'Не дождались ответа — программа работает слишком долго.' : `${r.out || ''}${r.err ? `${r.out ? '\n' : ''}${bugErrText(r)}\n${r.err.trim()}` : ''}` || '(программа ничего не вывела)';
      bugSetBusy(false, 'Запуск завершён.');
    } catch (e) { if (bugCurrent(c, run, sid)) { out.textContent = e.message; bugSetBusy(false, e.message); } }
  }
  trainerEl.addEventListener('click', async e => {
    if (!bugActive()) return;
    const open = e.target.closest('[data-bug-open]');
    if (open) { bugStop(); BUG.cur = open.dataset.bugOpen || null; if (BUG.cur) bugRenderCase(); else bugRenderList(); window.scrollTo(0, 0); return; }
    const lvl = e.target.closest('[data-bug-level]');
    if (lvl) { BUG.filter = +lvl.dataset.bugLevel; bugRenderList(); return; }
    const act = e.target.closest('[data-bug-act]')?.dataset.bugAct, c = bugCase();
    if (!act || !c) return;
    if (act === 'check') bugCheck();
    if (act === 'verify') bugVerify();
    if (act === 'run') bugRunOwn();
    if (act === 'stop') { bugStop(); bugSetBusy(false, 'Остановлено.'); }
    if (act === 'hint') { BUG.hints[c.id] = Math.min(c.hints.length, (BUG.hints[c.id] || 0) + 1); bugRenderHints(); }
    if (act === 'reset') {
      if ($('#bugCode').value !== c.code && !confirm('Вернуть исходное решение? Твои правки пропадут.')) return;
      bugStop(); bugSetBusy(false);
      $('#bugCode').value = c.code; try { localStorage.removeItem(bugDraftKey(c.id)); } catch (x) { /* не страшно */ }
      delete BUG.results[c.id]; bugSyncEditor(); bugRenderResult(); $('#bugStatus').textContent = 'Код возвращён к исходному.';
    }
    if (act === 'explain') {
      if (!c.my.ok && !confirm('Показать разбор ошибок? Сначала попробуй объяснить, почему исходная программа ошибалась.')) return;
      const run = BUG.runId, sid = appState.student?.sid;
      try { const r = await api('lab/bugs/explain', { id: c.id }); if (!bugCurrent(c, run, sid)) return; BUG.explain[c.id] = r.explain; if (!c.my.ok) c.my.seen = 1; bugRenderHints(); bugRenderResult(); }
      catch (x) { if (bugCurrent(c, run, sid)) toast(x.message || 'Не получилось открыть разбор', 3500); }
    }
  });
  trainerEl.addEventListener('input', e => {
    if (!bugActive() || e.target.id !== 'bugCode') return;
    const c = bugCase();
    writeJSON(bugDraftKey(c.id), { code: e.target.value });
    bugSyncEditor();
  });
  function bugScrollHl() {
    const ta = $('#bugCode'), inner = $('#bugCodeHl')?.firstElementChild;
    if (ta && inner) inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  }
  trainerEl.addEventListener('scroll', e => { if (e.target.id === 'bugCode' && $('#bugGutter')) { $('#bugGutter').scrollTop = e.target.scrollTop; bugScrollHl(); } }, true);
  trainerEl.addEventListener('keydown', e => {
    if (!bugActive() || !bugCase()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); bugCheck(); return; }
    if (e.target.id === 'bugCode' && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = e.target; t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  new MutationObserver(() => { if (!bugActive()) bugStop(); }).observe(trainerEl, { childList: true });
  window.addEventListener('pagehide', bugStop);
