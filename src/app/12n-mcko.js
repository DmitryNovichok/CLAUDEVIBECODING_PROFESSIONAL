  // ------------------------------------------------------------ МЦКО: тренировочные работы, которые учитель выдаёт классу
  // Главная раздела — список работ класса (пусто, пока учитель ничего не выдал). Работа: ФИО и класс → задания по номерам,
  // ответ сохраняется кнопкой (и сам при уходе с поля), время считает сервер, по истечении работа сдаётся сама.
  const MK = { list: null, run: null, i: 0, timer: 0, intro: null, dirty: new Set() };
  async function openMcko() {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true; pageKind = 'mcko'; cur = null;
    navPush({ v: 'mcko' });
    renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">МЦКО</span>';
    trainerEl.innerHTML = '<div class="mk"><p class="fm-note">Загружаю…</p></div>';
    window.scrollTo(0, 0);
    await mkList();
  }
  const mkActive = () => courseShown && pageKind === 'mcko';
  const mkFmt = t => new Date(t * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const mkBox = () => trainerEl.querySelector('.mk');
  function mkStop() { clearInterval(MK.timer); MK.timer = 0; }
  async function mkList() {
    mkStop(); MK.run = null; MK.intro = null;
    try { MK.list = await api('mcko'); } catch (e) { if (mkActive()) mkBox().innerHTML = `<p class="fm-note">${esc(e.message || 'Нет связи с сервером')}</p>`; return; }
    if (!mkActive()) return;
    const d = MK.list;
    const card = w => {
      const last = w.results[w.results.length - 1];
      const st = w.active ? `<span class="mk-st go">идёт · до ${mkFmt(w.deadline)}</span>`
        : last ? `<span class="mk-st done">сдана${last.score != null ? ` · ${last.score} из ${last.max}` : ''}</span>`
          : w.open ? '<span class="mk-st new">новая</span>' : '<span class="mk-st">закрыта</span>';
      const can = w.active || (w.open && w.used < w.tries);
      return `<article class="mk-card"><div><h3>${esc(w.title)}</h3>
        <p>${w.tasks} ${plural(w.tasks, 'задание', 'задания', 'заданий')} · ${w.minutes} мин · максимум ${w.max} ${plural(w.max, 'балл', 'балла', 'баллов')}${w.closes ? ` · принимается до ${mkFmt(w.closes)}` : ''}${w.tries > 1 ? ` · попыток: ${w.used} из ${w.tries}` : ''}</p></div>
        ${st}${can ? `<button type="button" class="btn primary" data-mk-open="${w.id}">${w.active ? 'Продолжить' : 'Приступить'}</button>` : ''}</article>`;
    };
    mkBox().innerHTML = `<header class="mk-head"><h1>МЦКО</h1><p>Тренировочные работы по типам диагностики МЦКО от вашего учителя. Это тренировка, а не официальная диагностика.</p></header>
      ${d.works.length ? `<div class="mk-list">${d.works.map(card).join('')}</div>`
        : `<div class="mk-empty"><div class="mk-empty-ic" aria-hidden="true">📋</div><h2>Работ пока нет</h2>
          <p>${d.has_class ? 'Когда учитель выдаст работу вашему классу, она появится здесь.' : 'Вы пока не в классе. Попросите учителя добавить вас в класс — тогда здесь появятся работы.'}</p></div>`}`;
  }
  function mkIntro(w) {
    MK.intro = w;
    const f = w.used ? w.fio : MK.list.me;
    const val = k => esc((w.fio && w.fio[k]) || f[k] || '');
    mkBox().innerHTML = `<button type="button" class="link-btn" data-mk-back>← Все работы</button>
      <div class="mk-intro"><h1>${esc(w.title)}</h1>
        <ul class="mk-facts"><li><b>${w.tasks}</b> ${plural(w.tasks, 'задание', 'задания', 'заданий')}</li><li><b>${w.minutes}</b> мин</li><li>максимум <b>${w.max}</b> ${plural(w.max, 'балл', 'балла', 'баллов')}</li></ul>
        <form class="mk-form" id="mkStart"><h2>Данные участника</h2>
          <label>Фамилия<input class="inp" id="mkLast" maxlength="60" required autocomplete="family-name" value="${val('last_name')}"></label>
          <label>Имя<input class="inp" id="mkFirst" maxlength="60" required autocomplete="given-name" value="${val('first_name')}"></label>
          <label>Отчество <small>если есть</small><input class="inp" id="mkMiddle" maxlength="60" autocomplete="additional-name" value="${val('middle_name')}"></label>
          <label>Класс<input class="inp" id="mkKlass" maxlength="20" required placeholder="например, 10А" value="${val('klass')}"></label>
          <p class="fm-note">ФИО, класс и результаты работы увидит ваш учитель.</p>
          <div class="mk-rules"><h3>Перед началом</h3><ul>
            <li>На работу даётся <b>${w.minutes} минут</b>. Время идёт с нажатия «Начать» и не останавливается, даже если закрыть страницу.</li>
            <li>Задания можно решать в любом порядке: номера — вверху. Ответ записывайте в поле и нажимайте <b>«Сохранить ответ»</b>.</li>
            <li>Числа пишите цифрами, дробную часть — через запятую. Если полей несколько, заполните каждое.</li>
            <li>Когда закончите, нажмите <b>«Завершить работу»</b>. Когда время выйдет, работа сдастся сама с сохранёнными ответами.</li></ul></div>
          <button type="submit" class="btn primary btn-block">${w.active ? 'Продолжить работу' : 'Начать тестирование'}</button>
          <p class="login-err" id="mkErr" role="alert"></p></form></div>`;
    if (w.active) $$('#mkStart input').forEach(i => { i.readOnly = true; });
  }
  async function mkLoadRun(id) {
    try { MK.run = await api('mcko/run?run=' + id); } catch (e) { toast(e.message || 'Нет связи с сервером'); return mkList(); }
    if (!mkActive()) return;
    MK.skew = MK.run.now * 1000 - Date.now();               // часы сервера: таймер не зависит от часов компьютера
    MK.i = Math.min(MK.i, MK.run.tasks.length - 1);
    MK.dirty.clear();
    if (MK.run.finished) return mkDone();
    mkRender();
    mkStop(); MK.timer = setInterval(mkTick, 1000); mkTick();
  }
  const mkHas = q => (MK.run.answers[q.id] || []).some(x => String(x).trim());
  function mkRender() {
    const r = MK.run, q = r.tasks[MK.i];
    const done = r.tasks.filter(mkHas).length;
    mkBox().innerHTML = `<div class="mk-run">
      <header class="mk-bar"><div><b>${esc(r.title)}</b><small>${esc(r.fio)} · ${esc(r.klass)}</small></div>
        <span class="mk-time" id="mkTime" aria-live="off"></span>
        <button type="button" class="btn" data-mk-finish>Завершить работу</button></header>
      <nav class="mk-nums" aria-label="Задания">${r.tasks.map((t, k) => `<button type="button" class="${k === MK.i ? 'on' : ''} ${mkHas(t) ? 'has' : ''}" data-mk-go="${k}" aria-label="Задание ${t.n}${mkHas(t) ? ', ответ сохранён' : ''}">${t.n}</button>`).join('')}
        <span class="mk-count">сохранено ${done} из ${r.tasks.length}</span></nav>
      <section class="mk-task"><h2>Задание ${q.n} <small>${q.points} ${plural(q.points, 'балл', 'балла', 'баллов')}</small></h2>
        <div class="mk-q" id="mkQ">${q.html}</div>
        ${q.file ? `<p class="mk-file">Файл к заданию: <a href="api/mcko/file?run=${r.run}&amp;q=${encodeURIComponent(q.id)}" download="${esc(q.file)}">${esc(q.file)}</a></p>` : ''}
        <div class="mk-act"><button type="button" class="btn" data-mk-step="-1" ${MK.i ? '' : 'disabled'}>← Назад</button>
          <button type="button" class="btn primary" data-mk-save>Сохранить ответ</button><span class="mk-saved" id="mkSaved" role="status"></span>
          <button type="button" class="btn" data-mk-step="1" ${MK.i < r.tasks.length - 1 ? '' : 'disabled'}>Далее →</button></div></section></div>`;
    // поля ответа — из условия (a0, a1…): подставляем сохранённое; ссылка на файл в тексте — на сервер с проверкой доступа
    const vals = r.answers[q.id] || [];
    $$('#mkQ input').forEach((inp, j) => { inp.value = vals[j] || ''; inp.dataset.mkField = j; inp.setAttribute('inputmode', 'text'); inp.spellcheck = false; });
    $$('#mkQ a[href*="api/mcko/file"]').forEach(a => a.setAttribute('download', q.file || ''));
    $('#mkQ input')?.focus({ preventScroll: true });
  }
  function mkTick() {
    if (!mkActive() || !MK.run) return mkStop();
    const left = Math.max(0, Math.round((MK.run.deadline * 1000 - (Date.now() + MK.skew)) / 1000));
    const el = $('#mkTime');
    if (el) { el.textContent = `осталось ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; el.classList.toggle('low', left < 300); }
    if (left <= 0) { mkStop(); mkSave(true).finally(() => mkFinish(true)); }
  }
  async function mkSave(quiet) {
    const r = MK.run; if (!r || r.finished) return;
    const q = r.tasks[MK.i], inputs = $$('#mkQ input');
    if (!q || !inputs.length) return;
    const values = inputs.map(i => i.value.trim());
    const old = r.answers[q.id] || [];
    if (quiet && values.join('\u0001') === old.join('\u0001')) return;
    try {
      await api('mcko/save', { run: r.run, q: q.id, values });
      r.answers[q.id] = values;
      MK.dirty.delete(q.id);
      if (!quiet) { const s = $('#mkSaved'); if (s) { s.textContent = '✓ Ответ сохранён'; setTimeout(() => { if (s.isConnected) s.textContent = ''; }, 2500); } }
      const btn = $(`[data-mk-go="${MK.i}"]`); if (btn) btn.classList.toggle('has', mkHas(q));
      const c = trainerEl.querySelector('.mk-count'); if (c) c.textContent = `сохранено ${r.tasks.filter(mkHas).length} из ${r.tasks.length}`;
    } catch (e) {
      if (e.status === 409) return mkLoadRun(r.run);            // работа уже сдана (время вышло) — показываем итог
      toast(e.message || 'Ответ не сохранён — нет связи с сервером');
    }
  }
  async function mkFinish(auto) {
    const r = MK.run; if (!r) return;
    try { MK.run = await api('mcko/finish', { run: r.run }); } catch (e) { toast(e.message || 'Нет связи с сервером'); return; }
    mkStop();
    if (auto) toast('Время вышло — работа сдана с сохранёнными ответами');
    mkDone();
  }
  function mkDone() {
    mkStop();
    const r = MK.run;
    mkBox().innerHTML = `<div class="mk-done"><div class="mk-empty-ic" aria-hidden="true">✅</div><h1>Работа сдана</h1>
      <p>${esc(r.title)} · ${esc(r.fio)}${r.reason === 'time' ? ' · сдана автоматически по окончании времени' : ''}</p>
      ${r.score != null ? `<p class="mk-score"><b>${r.score}</b> из ${r.max} ${plural(r.max, 'балла', 'баллов', 'баллов')}</p>` : '<p>Результат сообщит учитель.</p>'}
      <button type="button" class="btn primary" data-mk-back>К списку работ</button></div>`;
  }
  trainerEl.addEventListener('click', async e => {
    if (!mkActive()) return;
    const t = e.target;
    if (t.closest('[data-mk-back]')) { await mkSave(true); return mkList(); }
    const op = t.closest('[data-mk-open]');
    if (op) { const w = MK.list.works.find(x => x.id === +op.dataset.mkOpen); if (w) mkIntro(w); return; }
    const go = t.closest('[data-mk-go]');
    if (go) { await mkSave(true); MK.i = +go.dataset.mkGo; mkRender(); return; }
    const st = t.closest('[data-mk-step]');
    if (st) { await mkSave(true); MK.i = Math.max(0, Math.min(MK.run.tasks.length - 1, MK.i + +st.dataset.mkStep)); mkRender(); return; }
    if (t.closest('[data-mk-save]')) { await mkSave(false); return; }
    if (t.closest('[data-mk-finish]')) {
      await mkSave(true);
      const r = MK.run, empty = r.tasks.filter(q => !mkHas(q)).length;
      if (!confirm(`Завершить работу?${empty ? `\nБез ответа: ${empty} ${plural(empty, 'задание', 'задания', 'заданий')}.` : ''}\nПосле этого изменить ответы будет нельзя.`)) return;
      mkFinish(false);
    }
  });
  trainerEl.addEventListener('submit', async e => {
    if (!mkActive() || e.target.id !== 'mkStart') return;
    e.preventDefault();
    const w = MK.intro, btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; $('#mkErr').textContent = '';
    try {
      const r = await api('mcko/start', { work: w.id, last_name: $('#mkLast').value, first_name: $('#mkFirst').value, middle_name: $('#mkMiddle').value, klass: $('#mkKlass').value });
      MK.i = 0; await mkLoadRun(r.run);
    } catch (err) { $('#mkErr').textContent = err.message || 'Нет связи с сервером'; btn.disabled = false; }
  });
  // уход с поля ответа — сохраняем сами; Enter в поле — тоже
  trainerEl.addEventListener('change', e => { if (mkActive() && e.target.closest('#mkQ')) mkSave(true); });
  trainerEl.addEventListener('keydown', e => { if (mkActive() && e.key === 'Enter' && e.target.closest('#mkQ input')) { e.preventDefault(); mkSave(false); } });
  new MutationObserver(() => { if (!mkActive()) mkStop(); }).observe(trainerEl, { childList: true });
