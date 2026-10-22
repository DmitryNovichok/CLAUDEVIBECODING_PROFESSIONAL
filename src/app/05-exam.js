  // ------------------------------------------------------------ вариант ЕГЭ
  let EX = null;          // идущий вариант: { id, started, deadline, items: [{ id, n }], ans: { id: { answer, cells } }, cur }
  let examShown = false;
  let exTimer = null;

  /** По заданию на каждый номер: актуального формата, по возможности новое для ученика и свежее. */
  /** Задания, решённые верно в последних VARIANT_GAP вариантах: снова попадут в вариант не раньше, чем через столько вариантов.
   *  Ответы одного варианта записаны в журнал с общим временем окончания — по нему и различаем варианты. */
  const VARIANT_GAP = 3;
  function recentExamSolved() {
    const ends = [...new Set(P.log.filter(e => e.x).map(e => e.t))].sort((a, b) => b - a).slice(0, VARIANT_GAP);
    const from = ends.length ? ends[ends.length - 1] : Infinity;
    const out = new Set();
    for (const e of P.log) {
      if (!e.x || e.t < from || !(e.s > 0)) continue;
      out.add(e.id);
      const g = partToGroup.get(e.id);
      if (g) out.add(g);
    }
    return out;
  }
  function pickVariant() {
    const items = [];
    const skip = recentExamSolved();
    for (let n = 1; n <= 27; n++) {
      if (HAS_GROUPS && (n === 20 || n === 21)) continue;
      const fits = t => t.n === n && (n !== 19 || !HAS_GROUPS || t.parts) && authorOk(t);
      let cands = TASKS.filter(t => fits(t) && !isOutdated(t));
      if (!cands.length) cands = TASKS.filter(fits);
      if (!cands.length) continue;
      const fresh = cands.filter(t => !skip.has(t.id));
      if (fresh.length) cands = fresh;              // верно решённые в прошлых 3 вариантах — пропускаем
      const score = t => {
        let s = Math.random();
        if (!P.tasks[t.id]) s += 1.5;
        if (t.y) s += Math.min(Math.max(t.y - CFG.firstKegeYear, 0), 5) * 0.15;
        if (t.parts) s += t.parts.length * 0.5;       // игра со всеми тремя вопросами
        if (t.d === 2) s += 0.2;
        return s;
      };
      let best = cands[0], bs = -Infinity;
      for (const t of cands) { const sc = score(t); if (sc > bs) { bs = sc; best = t; } }
      items.push({ id: best.id, n });
    }
    return items;
  }
  const examKeys = t => (t.parts ? t.parts.map(p => p.id) : [t.id]);
  const answeredItem = x => { const t = byId.get(x.id); return !!t && examKeys(t).some(k => EX.ans[k] && EX.ans[k].answer); };
  const saveExam = () => writeJSON(examKey(), EX);

  function openExamIntro() {
    if (EX) { resumeExam(); return; }
    const body = $('#forecastBody');
    body.innerHTML = `<h2 class="fm-title">Вариант ЕГЭ</h2>
      <ul class="ex-rules">
        <li><b>27 заданий</b>, по одному на номер (19–21 — одна игра), время — <b>3 ч 55 мин</b>.</li>
        <li>Ответы не проверяются до конца, вторых попыток нет — как на экзамене. Между заданиями можно переходить.</li>
        <li>В конце — первичный и тестовый балл. За №26 и 27 засчитывается и половина ответа (1 балл из 2).</li>
        <li>Правильные ответы покажем, если над вариантом работать не меньше ${Math.round(RULES.exam_min_for_answers / 60)} минут. Ошибки сразу встанут на повторение.</li>
        ${SERVER ? `<li>Не больше ${RULES.exam_per_day} вариантов в сутки.</li>` : ''}
        ${SERVER ? '<li><b>Строгий режим:</b> вариант открывается на весь экран. Выход из полного экрана, переход на другие вкладки и программы и вставка ответа из буфера записываются — учитель видит это в результатах.</li>' : ''}
      </ul>
      <div class="actions">
        <button type="button" class="btn primary" id="exStart">Начать вариант</button>
        <button type="button" class="btn ghost" id="exCancel">Отмена</button>
      </div>`;
    $('#forecastModal').hidden = false;
    $('#exCancel').addEventListener('click', closeForecast);
    $('#exStart').addEventListener('click', async e => {
      e.target.disabled = true;
      try { await beginExam(); } finally { e.target.disabled = false; }
    });
  }

  async function beginExam() {
    let items = SERVER ? [] : pickVariant();
    let id = 'local-' + Date.now(), limit = RULES.exam_sec;
    if (SERVER) {
      try {
        const r = await api('exam/start', {});
        id = r.exam_id;
        limit = r.limit || limit;
        // вариант собирает сервер: проверяются и показываются ответы только выданных заданий
        items = (r.items || []).filter(x => byId.get(x.id)).map(x => ({ id: x.id, n: byId.get(x.id).n, trap: x.trap || null }));
      } catch (e) { netError(e); return; }
    }
    if (!items.length) { toast('В банке нет заданий для варианта'); return; }
    abandonCurrent();
    leaveCourse();                         // со страницы «Мои варианты» — прямо в вариант
    cur = null;
    EX = { id, started: Date.now(), deadline: Date.now() + limit * 1000, items, ans: {}, cur: 0 };
    saveExam();
    closeForecast();
    examShown = true;
    if (SERVER) exStrictEnter();
    startExamTimer();
    renderExam();
    renderSidebar();
  }

  function resumeExam() {
    if (!EX) return;
    if (!examShown) {
      abandonCurrent();
      cur = null;
      examShown = true;
    }
    if (SERVER) exStrictEnter();
    if (isNarrow()) setSideOpen(false);
    startExamTimer();
    renderExam();
    renderSidebar();
  }

  function startExamTimer() {
    clearInterval(exTimer);
    exTimer = setInterval(() => {
      if (!EX) { clearInterval(exTimer); return; }
      const left = (EX.deadline - Date.now()) / 1000;
      const c = $('#exClock');
      if (c) { c.textContent = fmtClock(left); c.classList.toggle('warn', left < 600); }
      const sub = $('#examSub');
      if (sub) sub.textContent = `идёт · ${fmtClock(left)}`;
      if (left <= 0) { toast('Время вышло — вариант завершён', 4000); finishExam(true); }
    }, 1000);
  }

  function examBarHtml() {
    const left = (EX.deadline - Date.now()) / 1000;
    const done = EX.items.filter(answeredItem).length;
    return `<span class="scope-title">Вариант ЕГЭ</span>
      <span class="ex-clock${left < 600 ? ' warn' : ''}" id="exClock" title="Осталось времени">${fmtClock(left)}</span>
      <span class="scope-stats">отвечено ${done} из ${EX.items.length}</span>
      <button type="button" class="link-btn danger" id="exQuit">Прервать</button>`;
  }

  function exPartHtml(p) {
    const sh = shapeOf(p);
    return `<div class="gpart"><div class="gpart-row">
      <span class="num-badge sm">${p.n}</span>
      <div class="answer-row gpart-inputs" data-key="${esc(p.id)}">${inputsHtml(sh, true)}</div>
      <span class="gpart-hint">${partHint(sh)}</span></div></div>`;
  }

  function fillRow(row, saved) {
    if (!saved) return;
    const single = row.querySelector('.inp-single');
    if (single) { single.value = saved.answer || ''; return; }
    $$('.cell', row).forEach((c, i) => { c.value = (saved.cells && saved.cells[i]) || ''; });
  }

  function saveExamInputs() {
    if (!EX || !examShown) return;
    $$('#trainer .answer-row[data-key]').forEach(row => {
      const t = byId.get(row.dataset.key) || TASKS.find(x => (x.parts || []).some(p => p.id === row.dataset.key));
      const obj = byId.get(row.dataset.key) || (t && t.parts.find(p => p.id === row.dataset.key));
      if (!obj) return;
      const sh = shapeOf(obj);
      const answer = readAnswerIn(row, sh).join(' ');
      if (answer) EX.ans[row.dataset.key] = { answer, cells: cellsIn(row, sh) };
      else delete EX.ans[row.dataset.key];
    });
    saveExam();
  }

  function exGo(i) {
    if (!EX) return;
    saveExamInputs();
    EX.cur = Math.max(0, Math.min(EX.items.length - 1, i));
    saveExam();
    renderExam();
  }

  function renderExam() {
    const it = EX.items[EX.cur];
    const t = byId.get(it.id);
    if (!t) { EX.items.splice(EX.cur, 1); EX.cur = 0; saveExam(); if (EX.items.length) renderExam(); return; }
    const last = EX.cur === EX.items.length - 1;
    const nav = EX.items.map((x, i) => `<button type="button" class="ex-nav-btn${i === EX.cur ? ' on' : ''}${answeredItem(x) ? ' done' : ''}${HAS_GROUPS && x.n === 19 ? ' wide' : ''}" data-i="${i}" title="Задание ${numLabel(x.n)}${answeredItem(x) ? ' — есть ответ' : ''}">${numLabel(x.n)}</button>`).join('');
    const answerHtml = t.parts
      ? t.parts.map(exPartHtml).join('')
      : `<div class="answer-row" data-key="${esc(t.id)}">${inputsHtml(shapeOf(t))}</div>`;
    trainerEl.innerHTML = `
      ${SERVER ? strictHtml() : ''}
      <nav class="ex-nav" aria-label="Задания варианта">${nav}</nav>
      <div class="task-head">
        <span class="num-badge">${numLabel(t.n)}</span>
        <div class="task-meta">Вариант ЕГЭ · ${EX.cur + 1} из ${EX.items.length}</div>
        <span class="task-tools">${PY_BTN}${BD_BTN}${CALC_BTN}${MARK_BTN}</span>
      </div>
      <article class="cond" id="cond">${safeHtml(t.html)}</article>
      ${filesHtml(t)}
      <div class="answer">
        <div class="answer-label">${t.parts ? 'Ответы на вопросы игры. Проверка — в конце варианта.' : answerLabel(shapeOf(t)).replace(/\.?$/, '. Проверка — в конце варианта.')}</div>
        ${answerHtml}
        <div class="actions">
          <button type="button" class="btn" id="exPrev"${EX.cur ? '' : ' disabled'}>← Назад</button>
          ${last ? '' : '<button type="button" class="btn primary" id="exNext">Далее →<kbd>Enter</kbd></button>'}
          <button type="button" class="btn${last ? ' primary' : ' ghost'}" id="exFinish">Завершить вариант</button>
        </div>
      </div>`;
    $$('#trainer .answer-row[data-key]').forEach(row => fillRow(row, EX.ans[row.dataset.key]));
    dropDuplicateFileLinks($('#cond'), t.att || []);
    decorateCondition($('#cond'), t);
    guardDecorate($('#cond'), it.trap);
    bindInputs(() => { if (!last) exGo(EX.cur + 1); });
    const first = $('#trainer .answer-row input');
    if (first && window.matchMedia('(min-width: 861px)').matches && !pyOpen()) first.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    renderTopbar();
    pySync();
    bdSync();
  }

  function localExamResult(list) {
    const results = list.map(it => {
      const t = byId.get(it.task) || TASKS.flatMap(x => x.parts || []).find(p => p.id === it.task);
      const blank = !tokens(it.answer).length;
      const credit = blank ? 0 : answerCredit(t.n, t.ans, it.answer, it.cells);
      const max = EGE.points(t.n);
      return { task: it.task, n: t.n, points: credit === 1 ? max : credit === 0.5 ? 1 : 0, max, part: credit, blank,
        answer: blank ? undefined : t.ans };
    });
    const primary = results.reduce((a, r) => a + r.points, 0);
    return { results, primary, test: testScore(primary), spent: Math.round((Date.now() - EX.started) / 1000), shown: true };
  }

  /** Ответы варианта — в статистику и повторения (на сервере они уже в журнале). */
  function recordExam(res) {
    const now = Date.now();
    const groups = new Map();
    for (const r of res.results) {
      const g = partToGroup.get(r.task);
      const t = byId.get(r.task) || (g && byId.get(g).parts.find(p => p.id === r.task));
      if (!t || r.blank) continue;      // задание не трогали — это не ошибка
      const score = r.part === 1 ? 1 : 0;
      if (g) {
        recordStats(t, score, now, { part: r.part, exam: true, blank: r.blank });
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(score);
      } else {
        record(t, score, null, { now, part: r.part, exam: true, blank: r.blank, silent: true });
      }
    }
    groups.forEach((scores, g) => recordGroupEnd(byId.get(g), scores, null, false, { now, silent: true }));
    save();
    afterAnswer();
  }

  async function finishExam(auto) {
    if (!EX || EX.finishing) return;
    if (!examShown) abandonCurrent();      // время вышло, пока решал задание в тренировке
    saveExamInputs();
    const left = EX.items.filter(x => !answeredItem(x)).length;
    if (!auto && !confirm(left ? `Без ответа заданий: ${left}. Завершить вариант и узнать результат?` : 'Завершить вариант и узнать результат?')) return;
    EX.finishing = true;
    const list = [];
    for (const x of EX.items) {
      const t = byId.get(x.id);
      if (!t) continue;
      for (const k of examKeys(t)) list.push({ task: k, answer: (EX.ans[k] || {}).answer || '', cells: (EX.ans[k] || {}).cells || null, bot: botPayload(x.id) });
    }
    let res;
    try {
      res = SERVER ? await api('exam/finish', { exam_id: EX.id, answers: list }) : localExamResult(list);
      if (res && res.game) setTimeout(() => onGame(res.game), 800);
    } catch (e) {
      EX.finishing = false;
      netError(e);
      return;
    }
    clearInterval(exTimer);
    const done = EX;
    EX = null;
    examShown = false;
    exStrictLeave();
    try { if (storage) storage.removeItem(examKey()); } catch (e) { /* не страшно */ }
    recordExam(res);
    renderExamResult(res, done);
  }

  function quitExam() {
    if (!EX || !confirm('Прервать вариант? Ответы не будут проверены, а вариант засчитается в дневной лимит.')) return;
    clearInterval(exTimer);
    EX = null;
    examShown = false;
    exStrictLeave();
    try { if (storage) storage.removeItem(examKey()); } catch (e) { /* не страшно */ }
    cur = null;
    renderSidebar();
    next();
  }

  function renderExamResult(res, ex) {
    cur = null;
    const full = res.results.filter(r => r.points === r.max).length;
    const rows = res.results.map(r => {
      const mine = (ex.ans[r.task] || {}).answer || '';
      const cls = r.points === r.max ? 'lv-good' : r.points ? 'lv-mid' : 'lv-weak';
      return `<tr class="${cls}">
        <td class="fm-n"><b>${r.n}</b></td>
        <td class="ans">${mine ? esc(mine) : '<span class="fm-muted">нет ответа</span>'}</td>
        <td class="ans">${r.answer != null ? esc(r.answer).replace(/\n/g, '<br>') : '<span class="fm-muted">скрыт</span>'}</td>
        <td><span class="ex-pts">${r.points} / ${r.max}</span></td>
      </tr>`;
    }).join('');
    trainerEl.innerHTML = `
      <div class="ex-result">
        <h2 class="fm-title">Результат варианта</h2>
        <div class="fm-head">
          <div class="fm-score band-${bandOf(res.test)}">
            <span class="fm-big">${res.test}</span>
            <span class="fm-sub">тестовых баллов<br>${res.primary} первичных из 29</span>
          </div>
          <div class="fm-facts">
            <div>Время: <b>${fmtClock(res.spent)}</b> из 3:55:00</div>
            <div>Полностью верно: <b>${full}</b> из ${res.results.length}</div>

            <div class="fm-chips">${res.test >= EGE.minScore ? `<span class="chip good">порог ${EGE.minScore} пройден</span>` : `<span class="chip weak">ниже порога ${EGE.minScore}</span>`}</div>
          </div>
        </div>
        <p class="fm-note">${res.shown ? 'Задания с ошибками поставлены на повторение: тренажёр вернёт похожие в ближайших заданиях.'
          : `Правильные ответы показываем, если над вариантом работали не меньше ${Math.round((res.min_for_answers || RULES.exam_min_for_answers) / 60)} минут. Ошибки уже поставлены на повторение — разберите их в тренировке.`}</p>
        <div class="fm-table-wrap"><table class="fm-table ex-table">
          <thead><tr><th>№</th><th>Ваш ответ</th><th>Правильный</th><th>Баллы</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <div class="actions"><button type="button" class="btn primary" id="exBack">Продолжить тренировку →</button>
          ${SERVER ? '<button type="button" class="btn" id="exAll">Все мои варианты</button>' : ''}</div>
      </div>`;
    $('#exBack').addEventListener('click', () => next());
    if ($('#exAll')) $('#exAll').addEventListener('click', () => { EXAMS = null; openExamsPage(); });
    window.scrollTo({ top: 0 });
    renderSidebar();
    renderTopbar();
  }

  // ------------------------------------------------------------ события
  $('#grid').addEventListener('click', e => {
    const b = e.target.closest('.num-card');
    if (b && !b.disabled) setScope(+b.dataset.n);
  });
  // Синие кубики — банк заданий: сворачивают и разворачивают панель номеров. Выбранный номер НЕ сбрасывают
  // (раньше кнопка заодно включала «Все задания», и «Пропустить» начинал выдавать любые номера).
  $('#allCard').addEventListener('click', () => {
    if (courseShown && !examShown) {                 // со страницы (курс, подборки, история…) — к заданиям того же номера
      leaveCourse();
      if (isNarrow()) setSideOpen(false); else setSideMin(false);
      next();
      renderSidebar();
      return;
    }
    if (isNarrow()) { setSideOpen(!$('.sidebar').classList.contains('open')); return; }   // на телефоне — открыть список номеров
    setSideMin(!document.body.classList.contains('side-min'));
  });
  // «Все номера» — задания всех номеров: тренажёр сам подбирает, что подтянуть
  $('#allNums')?.addEventListener('click', () => {
    if (courseShown && !examShown) leaveCourse();
    setScope('all');
    if (cur == null) next();
    renderSidebar();
  });
  $('#favCard').addEventListener('click', () => setScope('fav'));
  $('#examCard').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); if (EX || !SERVER) openExamIntro(); else openExamsPage(); });

  // ------------------------------------------------------------ мои варианты: история, как страница подборок
  let EXAMS = null;
  function openExamsPage() {
    if (!leaveExam()) return;
    abandonCurrent();
    courseShown = true;
    pageKind = 'exams';
    cur = null;
    navPush({ v: 'exams' });
    renderExamsPage();
    renderSidebar();
    window.scrollTo(0, 0);
    api('exams').then(d => { EXAMS = d.exams || []; renderExamsPage(); }).catch(() => {});
  }
  function examSpark(list) {
    const v = list.slice(0, 20).reverse().map(x => x.test);
    if (v.length < 2) return '';
    const w = 220, h = 54, lo = Math.min(...v, 40) - 4, hi = Math.max(...v, 60) + 4;
    const x = i => (i / (v.length - 1) * (w - 8) + 4).toFixed(1), y = t => (h - 4 - (t - lo) / (hi - lo) * (h - 8)).toFixed(1);
    return `<svg class="exh-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="Тестовый балл по вариантам">
      <line x1="0" x2="${w}" y1="${y(EGE.minScore)}" y2="${y(EGE.minScore)}" class="exh-min"/>
      <polyline points="${v.map((t, i) => `${x(i)},${y(t)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
      ${v.map((t, i) => `<circle cx="${x(i)}" cy="${y(t)}" r="3"><title>${t}</title></circle>`).join('')}</svg>`;
  }
  function renderExamsPage() {
    if (!courseShown || pageKind !== 'exams') return;
    $('#scopeInfo').innerHTML = '<span class="scope-title">Мои варианты</span>';
    document.body.classList.add('asg-wide');
    const L = EXAMS || [];
    const best = L.length ? Math.max(...L.map(x => x.test)) : null;
    const bestId = L.length > 1 && best > 0 ? (L.find(x => x.test === best) || {}).id : null;   // самый свежий из лучших
    const card = x => {
      const band = bandOf(x.test);
      return `<div class="ap-card exh-card">
        <div class="ap-main">
          <div class="ap-top"><span class="ap-ico exh-score band-${band}">${x.test}</span><div><span class="ap-kind">Вариант ЕГЭ</span>
            <b>${apTime(x.finished).replace(/<[^>]+>/g, '')}</b><small>${x.items} заданий · время ${fmtClock(x.spent || 0)}</small></div></div>
          <div class="ap-state">тестовый балл <b>${x.test}</b> · первичный ${x.primary} из 29 · полностью верно <b>${x.full}</b> из ${x.items}${x.blank ? ` · без ответа ${x.blank}` : ''}
            ${x.id === bestId ? ' · <span class="chip good">лучший</span>' : ''}</div>
          <i class="xp-bar"><b style="width:${pct(x.primary / 29)}%"></b></i></div>
        <div class="ap-dates"><div><span>Начат</span><b>${apTime(x.started)}</b></div><div><span>Сдан</span><b>${apTime(x.finished)}</b></div></div>
        <div class="ap-btns"><button type="button" class="btn primary" data-exam-view="${x.id}">Разбор</button></div></div>`;
    };
    trainerEl.innerHTML = `<div class="course asg-page">
      <div class="crs-hero"><div><div class="crs-kicker">Вариант ЕГЭ</div><h2>Мои варианты</h2>
        <p>27 заданий, 3 ч 55 мин, проверка — в конце, как на экзамене. Здесь все сданные варианты: к любому можно вернуться,
          посмотреть свои ответы и правильные (если над вариантом сидел 20+ минут) и перерешать ошибки.</p>
        <div class="exh-go">${EX ? '<button type="button" class="btn primary" id="exhResume">Продолжить начатый вариант</button>'
          : '<button type="button" class="btn primary" id="exhNew">Начать новый вариант</button>'}</div></div>
        <div class="crs-prog">${L.length ? `<b>${L[0].test}</b><span>последний балл${best != null ? ` · лучший ${best}` : ''}</span>${examSpark(L)}` : '<b>0</b><span>вариантов пока нет</span>'}</div></div>
      ${EXAMS == null ? '<p class="fm-note">Загружаю…</p>' : L.length ? `<h3 class="ap-h">Сданные варианты · ${L.length}</h3><div class="ap-grid">${L.map(card).join('')}</div>`
        : '<p class="fm-note">Вы ещё не решали вариант. Начните — результат и разбор появятся здесь.</p>'}
    </div>`;
  }
  async function openExamReview(id) {
    let r;
    try { r = await api('exam/view?id=' + encodeURIComponent(id)); } catch (e) { netError(e); return; }
    if (!courseShown || pageKind !== 'exams') { courseShown = true; pageKind = 'exams'; }
    navPush({ v: 'exam', id });
    const full = r.results.filter(x => x.points === x.max).length;
    const rows = r.results.map(x => {
      const cls = x.points === x.max ? 'lv-good' : x.points ? 'lv-mid' : 'lv-weak';
      return `<tr class="${cls}"><td class="fm-n"><b>${x.n}</b></td>
        <td class="ans">${x.mine ? esc(x.mine) : '<span class="fm-muted">нет ответа</span>'}</td>
        <td class="ans">${x.answer != null ? esc(x.answer).replace(/\n/g, '<br>') : '<span class="fm-muted">скрыт</span>'}</td>
        <td><span class="ex-pts">${x.points} / ${x.max}</span></td>
        <td><button type="button" class="btn ghost exh-open" data-open="${esc(x.task)}">${x.points === x.max ? 'Открыть' : 'Перерешать'}</button></td></tr>`;
    }).join('');
    $('#scopeInfo').innerHTML = '<span class="scope-title">Мои варианты</span>';
    trainerEl.innerHTML = `<div class="ex-result">
        <button type="button" class="btn ghost" id="exhBack">← Все варианты</button>
        <h2 class="fm-title">Вариант от ${apTime(r.finished).replace(/<[^>]+>/g, '')}</h2>
        <div class="fm-head">
          <div class="fm-score band-${bandOf(r.test)}"><span class="fm-big">${r.test}</span>
            <span class="fm-sub">тестовых баллов<br>${r.primary} первичных из 29</span></div>
          <div class="fm-facts"><div>Время: <b>${fmtClock(r.spent || 0)}</b> из 3:55:00</div>
            <div>Полностью верно: <b>${full}</b> из ${r.results.length}</div>
            <div class="fm-chips">${r.test >= EGE.minScore ? `<span class="chip good">порог ${EGE.minScore} пройден</span>` : `<span class="chip weak">ниже порога ${EGE.minScore}</span>`}</div></div>
        </div>
        ${r.shown ? '' : `<p class="fm-note">Правильные ответы скрыты: над вариантом работали меньше ${Math.round((r.min_for_answers || RULES.exam_min_for_answers) / 60)} минут.</p>`}
        <div class="fm-table-wrap"><table class="fm-table ex-table">
          <thead><tr><th>№</th><th>Ваш ответ</th><th>Правильный</th><th>Баллы</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </div>`;
    window.scrollTo({ top: 0 });
  }
  trainerEl.addEventListener('click', e => {
    if (pageKind !== 'exams' || !courseShown) return;
    const t = e.target;
    const v = t.closest('[data-exam-view]');
    if (v) return openExamReview(v.dataset.examView);
    if (t.closest('#exhBack')) return openExamsPage();
    if (t.closest('#exhNew') || t.closest('#exhResume')) return openExamIntro();
    const o = t.closest('.exh-open');
    if (o) { leaveCourse(); openPast(o.dataset.open); navPush({ v: 'past', id: o.dataset.open }); }
  });
  $('#period').addEventListener('change', e => setPeriod(e.target.value));
  $('#banks').addEventListener('click', e => {
    const b = e.target.closest('button[data-bank]');
    if (b) setBank(b.dataset.bank);
  });
  $('#searchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#searchInp').value;
    let t = null;
    if (SERVER) {        // настоящие номера заданий знает только сервер
      if (!q.trim()) return;
      try { t = byId.get((await api('find?q=' + encodeURIComponent(q))).task) || null; } catch (err) {
        if (err.status && err.status !== 404) { toast(err.message, 3500); return; }
      }
    } else {
      t = findTask(q);
    }
    if (!t) { toast('Задание не найдено. Введите номер с kompege.ru или код задания ФИПИ.', 3500); return; }
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    if (cur) lastNum = cur.task.n;
    $('#searchInp').value = '';
    show({ task: t, why: { type: 'search' } });
    renderSidebar();
  });

  trainerEl.addEventListener('click', e => {
    const id = e.target.closest('[id]') && e.target.closest('[id]').id;
    if (id === 'pyBtn') { togglePy(); return; }
    if (id === 'bdBtn') { toggleBoard(); return; }
    if (id === 'calcBtn') { toggleCalc(); return; }
    if (examShown && EX) {
      const nb = e.target.closest('.ex-nav-btn');
      if (nb) { exGo(+nb.dataset.i); return; }
      if (id === 'exFsBtn') { exStrictEnter(); return; }
      if (id === 'exPrev') exGo(EX.cur - 1);
      else if (id === 'exNext') exGo(EX.cur + 1);
      else if (id === 'exFinish') finishExam(false);
      return;
    }
    if (!cur) return;
    if (id === 'backBtn') { goBack(); return; }
    if (id === 'crsUpBtn') {
      const h = history.state;
      if (h && h.v === 'task' && h.set === ui.asg) history.back();   // вернёт к подборке через историю
      else { abandonCurrent(); openCourseSet(ui.asg); }
      return;
    }
    if (id === 'retryBtn') { show({ task: cur.task, why: cur.why, back: true }); return; }
    if (id === 'favBtn') toggleFav(cur.task.id);
    else if (id === 'noteBtn') {
      const box = $('#noteBox');
      box.hidden = !box.hidden;
      $('#noteBtn').setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) $('#noteText').focus();
    }
  });
  trainerEl.addEventListener('input', e => {
    if (examShown && EX && e.target.closest('.answer-row[data-key]')) {
      saveExamInputs();
      $$('.ex-nav-btn').forEach(b => b.classList.toggle('done', answeredItem(EX.items[+b.dataset.i])));
      const st = $('#scopeInfo .scope-stats');
      if (st) st.textContent = `отвечено ${EX.items.filter(answeredItem).length} из ${EX.items.length}`;
      return;
    }
    if (e.target.id === 'noteText' && cur) {
      const id = cur.task.id, text = e.target.value;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => saveNote(id, text), 600);
    }
  });
  trainerEl.addEventListener('focusout', e => {
    if (e.target.id === 'noteText' && cur) { clearTimeout(noteTimer); saveNote(cur.task.id, e.target.value); }
  });

  $('#scopeInfo').addEventListener('click', e => { if (e.target.id === 'exQuit') quitExam(); });
  $('#sessionInfo').addEventListener('click', e => {
    const sm = $('#streakMenu');
    if (e.target.closest('#streakBtn')) { sm.hidden = !sm.hidden; return; }
    if (e.target.closest('#rankBtn')) { sm.hidden = true; openRating(); return; }
    const g = e.target.closest('button[data-goal]');
    if (g) {
      prefs.goal = +g.dataset.goal;
      savePrefs();
      renderTopbar();
      toast(prefs.goal ? `Цель: ${prefs.goal} заданий в день` : 'Цель на день отключена', 2000);
    }
  });
  document.addEventListener('click', async e => {
    const fb = e.target.closest('#freezeBuy');
    if (fb && !fb.disabled) {
      fb.disabled = true;
      try {
        const r = await api('freeze/buy', {});
        if (r.game) onGame(r.game);
        renderTopbar();
        toast(`❄️ Заморозка куплена. В запасе: ${(GAME && GAME.freezes) || 0} из ${FREEZE_MAX}`, 3500);
      } catch (x) { toast(x.message || 'Не получилось — попробуйте ещё раз', 3500); renderTopbar(); }
      return;
    }
    const menu = $('#goalMenu');
    if (menu && !menu.hidden && !e.target.closest('#sessionInfo')) menu.hidden = true;
    const sm = $('#streakMenu');
    if (sm && !sm.hidden && !e.target.closest('#sessionInfo')) sm.hidden = true;
  });

  $('#forecastBtn').addEventListener('click', openForecast);
  $('#histCard').addEventListener('click', () => { histFilter = 'all'; histLimit = 100; if (isNarrow()) setSideOpen(false); openHistory(); });
  $('#forecastModal').addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-view]')) { setView(t.dataset.view, t.checked); return; }
    if (t.matches('[data-view-bright]')) { setView('bright', +t.value); openThemes(); }
  });
  $('#forecastModal').addEventListener('input', e => {
    if (e.target.matches('[data-view-bright]')) setView('bright', +e.target.value);   // видно сразу, пока тянешь
  });
  $('#forecastModal').addEventListener('click', e => {
    const th = e.target.closest('[data-theme-id]');
    if (th) { setThemePick(th.dataset.themeId); openThemes(); return; }
    const vs = e.target.closest('[data-view-size]');
    if (vs) { setView('size', +vs.dataset.viewSize); openThemes(); return; }
    const va = e.target.closest('[data-view-accent]');
    if (va) { setView('accent', va.dataset.viewAccent); openThemes(); return; }
    if (e.target.closest('[data-view-reset]')) { writeJSON(VIEW_STORE, VIEW_DEF); applyTheme(effectiveTheme()); applyView(); openThemes(); return; }
    const ho = e.target.closest('[data-open]');
    if (ho) { closeForecast(); openPast(ho.dataset.open); navPush({ v: 'past', id: ho.dataset.open }); return; }
    const hf = e.target.closest('[data-hf]');
    if (hf) { histFilter = hf.dataset.hf; histLimit = 100; openHistory(); return; }
    if (e.target.closest('[data-hmore]')) { histLimit += 100; openHistory(); return; }
    const go = e.target.closest('[data-go]');
    if (go && !go.disabled) { closeForecast(); setScope(+go.dataset.go); return; }
    if (e.target.id === 'forecastModal' || e.target.closest('.fm-close')) closeForecast();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      $('#lightbox').hidden = true;
      closeForecast();
      $('#pwModal').hidden = true;
      const menu = $('#goalMenu');
      if (menu) menu.hidden = true;
      const sm = $('#streakMenu');
      if (sm) sm.hidden = true;
      return;
    }
    if (!$('#forecastModal').hidden) return;
    if (e.key !== 'Enter' || !cur || !cur.done || courseShown) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'summary') return;
    e.preventDefault();
    next();
  });

  function openLightbox(src) {
    const lb = $('#lightbox');
    lb.querySelector('img').src = src;
    lb.hidden = false;
  }
  $('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

  $('#exportBtn').addEventListener('click', () => {
    const data = { app: 'ege-trainer', exported: new Date().toISOString(), progress: P, prefs };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ege-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f || SERVER) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        const p = d && d.progress;
        if (!p || p.v !== 1 || typeof p.tasks !== 'object') throw new Error('bad');
        if (!confirm('Заменить текущий прогресс загруженным?')) return;
        P = Object.assign(freshProgress(), p);
        if (d.prefs) { prefs = normPrefs(d.prefs); writeJSON(prefsKey(), prefs); }
        save();
        renderSidebar();
        renderTopbar();
        toast('Прогресс загружен');
      } catch (err) { toast('Не удалось прочитать файл прогресса'); }
    };
    rd.readAsText(f);
  });
  $('#resetBtn').addEventListener('click', () => {
    if (SERVER || !confirm('Сбросить весь прогресс? Это нельзя отменить.')) return;
    P = freshProgress();
    recent.length = 0;
    save();
    renderSidebar();
    next();
    toast('Прогресс сброшен');
  });

  // формулы, если KaTeX догрузился после первого показа
  document.addEventListener('DOMContentLoaded', () => renderMath($('#cond')));

