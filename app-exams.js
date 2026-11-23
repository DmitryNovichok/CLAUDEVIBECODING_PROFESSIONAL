// Собрано из src/app/*.js командой python3 tools/build_app.py — правьте модули, а не этот файл.
window.EgeExamSections = function (bridge) {
  'use strict';
  const { $, $$, api, esc, plural, safeHtml, toast, trainerEl, hubRefresh, renderMath, toggleCalc, appState } = bridge;
  // ═══════ src/app/12n-mcko.js
  // ------------------------------------------------------------ МЦКО: тренировочные работы, которые учитель выдаёт классу
  // Главная раздела — список работ класса (пусто, пока учитель ничего не выдал), затем ФИО и класс.
  // Само тестирование — отдельный экран в классическом формате компьютерного тестирования: ряд номеров
  // («Описание», задания, «закончить»), оставшееся время, ответ засчитывается только кнопкой «Сохранить ответ»,
  // подтверждение завершения и протокол. Это оформление Egeshka, а не копия официального сайта.
  const MK = { list: null, run: null, i: 0, timer: 0, intro: null, page: 'test', ov: null, skew: 0, pre: null };
  async function openMcko() {
    await mkList();
  }
  const mkActive = () => appState.courseShown && appState.pageKind === 'mcko';
  const mkFmt = t => new Date(t * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const mkBox = () => trainerEl.querySelector('.mk');
  function mkStop() { clearInterval(MK.timer); MK.timer = 0; }
  function mkClose() {
    mkStop();
    if (MK.ov) { MK.ov.remove(); MK.ov = null; }
    document.body.classList.remove('mkx-open');
  }
  async function mkList() {
    mkClose(); MK.run = null; MK.intro = null; MK.pre = null;
    try { MK.list = await api('mcko'); } catch (e) { if (mkActive()) mkBox().innerHTML = `<p class="fm-note">${esc(e.message || 'Нет связи с сервером')}</p>`; return; }
    if (!mkActive() || !mkBox()) return;
    const d = MK.list;
    const card = w => {
      const last = w.results[w.results.length - 1];
      const st = w.active ? `<span class="mk-st go">идёт · до ${mkFmt(w.deadline)}</span>`
        : last ? `<span class="mk-st done">сдана${last.score != null ? ` · ${last.score} из ${last.max}` : ''}</span>`
          : w.open ? '<span class="mk-st new">новая</span>' : '<span class="mk-st">закрыта</span>';
      const can = w.active || (w.open && w.used < w.tries);
      return `<article class="mk-card"><div><h3>${esc(w.title)}</h3>
        <p>${w.tasks} ${plural(w.tasks, 'задание', 'задания', 'заданий')} · ${w.minutes} мин · максимум ${w.max} ${plural(w.max, 'балл', 'балла', 'баллов')}${w.closes ? ` · принимается до ${mkFmt(w.closes)}` : ''}${w.tries > 1 ? ` · попыток: ${w.used} из ${w.tries}` : ''}</p></div>
        ${st}${last && !w.active ? `<button type="button" class="btn" data-mk-proto="${last.run}">Протокол</button>` : ''}${can ? `<button type="button" class="btn primary" data-mk-open="${w.id}">${w.active ? 'Продолжить' : 'Приступить'}</button>` : ''}</article>`;
    };
    mkBox().innerHTML = `<header class="mk-head"><h1>МЦКО</h1><p>Тренировочные работы по типам диагностики МЦКО от вашего учителя — в формате компьютерного тестирования. Это тренировка, а не официальная диагностика.</p></header>
      ${d.works.length ? `<div class="mk-list">${d.works.map(card).join('')}</div>`
        : `<div class="mk-empty"><div class="mk-empty-ic" aria-hidden="true">📋</div><h2>Работ пока нет</h2>
          <p>${d.has_class ? 'Когда учитель выдаст работу вашему классу, она появится здесь.' : 'Вы пока не в классе. Попросите учителя добавить вас в класс — тогда здесь появятся работы.'}</p></div>`}`;
  }
  function mkIntro(w) {
    MK.intro = w;
    if (w.active) return mkLoadRun(w.active, 'test');           // идущая работа — сразу к заданиям
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
          <p class="fm-note">ФИО, класс и результаты работы увидит ваш учитель. Дальше откроется экран тестирования с описанием работы — время пойдёт только после «Начать тестирование».</p>
          <button type="submit" class="btn primary btn-block">Далее — к описанию работы</button>
          <p class="login-err" id="mkErr" role="alert"></p></form></div>`;
  }
  // ---------- экран тестирования
  async function mkLoadRun(id, page) {
    let r;
    try { r = await api('mcko/run?run=' + id); } catch (e) { toast(e.message || 'Нет связи с сервером'); return mkList(); }
    if (!mkActive()) return;
    MK.run = r; MK.pre = null;
    MK.skew = r.now * 1000 - Date.now();               // часы сервера: таймер не зависит от часов компьютера
    MK.i = Math.max(0, Math.min(MK.i, r.tasks.length - 1));
    mkOpenOverlay();
    mkShow(r.finished ? 'result' : page || 'test');
  }
  function mkOpenOverlay() {
    if (MK.ov) return;
    MK.ov = document.createElement('div');
    MK.ov.className = 'mkx'; MK.ov.setAttribute('role', 'dialog'); MK.ov.setAttribute('aria-modal', 'true'); MK.ov.setAttribute('aria-label', 'Тренировочное тестирование');
    document.body.appendChild(MK.ov);
    document.body.classList.add('mkx-open');
    MK.ov.addEventListener('click', mkOvClick);
    MK.ov.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.mkx-q input')) { e.preventDefault(); mkSave(false); } });
    MK.ov.addEventListener('input', e => { if (e.target.closest('.mkx-q')) { const s = MK.ov.querySelector('#mkxSaved'); if (s) { s.textContent = 'Ответ не сохранён — нажмите «Сохранить ответ»'; s.className = 'mkx-status warn'; } } });
  }
  const mkHas = q => (MK.run.answers[q.id] || []).some(x => String(x).trim());
  function mkLeft() { return Math.max(0, Math.round((MK.run.deadline * 1000 - (Date.now() + MK.skew)) / 1000)); }
  function mkShow(page) {
    MK.page = page;
    const r = MK.run, done = !!r.finished, pre = !!r.pre;
    const nums = r.tasks.map((t, k) => `<button type="button" class="mkx-n${page === 'test' && k === MK.i ? ' cur' : ''}${!done && mkHas(t) ? ' has' : ''}" data-mkx-go="${k}" ${done || pre ? 'disabled' : ''} aria-label="Задание ${t.n}${mkHas(t) ? ', ответ сохранён' : ''}">${t.n}</button>`).join('');
    const bar = `<header class="mkx-top"><b>Тренировочное тестирование</b><span>${esc(r.title)}</span><span class="mkx-who">${esc(r.fio)}${r.klass ? ', ' + esc(r.klass) : ''}</span>
        <button type="button" class="mkx-exit" data-mkx-exit>${done || pre ? 'Закрыть' : 'Выйти (время идёт)'}</button></header>
      <nav class="mkx-pal" aria-label="Задания"><span class="mkx-lbl">Задания:</span>
        <button type="button" class="mkx-n wide${page === 'desc' ? ' cur' : ''}" data-mkx-page="desc" ${done ? 'disabled' : ''}>Описание</button>${nums}
        <button type="button" class="mkx-n wide${page === 'confirm' ? ' cur' : ''}" data-mkx-page="confirm" ${done || pre ? 'disabled' : ''}>закончить</button>
        <span class="mkx-time" id="mkxTime">${done ? 'Тестирование завершено' : pre ? `Время на работу — ${r.minutes} мин` : ''}</span></nav>`;
    let body = '';
    if (page === 'desc') {
      body = `<section class="mkx-box mkx-desc"><h2>Описание работы</h2>
        <p><b>${esc(r.title)}</b>: ${r.tasks.length} ${plural(r.tasks.length, 'задание', 'задания', 'заданий')}, на выполнение — ${r.minutes} мин, максимум ${r.max} ${plural(r.max, 'балл', 'балла', 'баллов')}.</p>
        <ol><li>Переходите между заданиями по номерам в строке «Задания». Порядок выполнения — любой.</li>
          <li>Ответ записывайте в поле под условием и <b>обязательно нажимайте «Сохранить ответ»</b>. Номер с сохранённым ответом подсвечивается жёлтым. Несохранённый ответ не засчитывается.</li>
          <li>Числа пишите цифрами, дробную часть — через запятую. Если полей несколько, заполните каждое.</li>
          <li>Оставшееся время показано в строке заданий. Время идёт на сервере и не останавливается, если выйти или закрыть страницу. Когда время выйдет, работа завершится сама с сохранёнными ответами.</li>
          <li>Чтобы сдать работу, нажмите «закончить». После завершения вернуться к заданиям нельзя.</li>
          <li>Делайте перерыв для глаз после 30–35 минут непрерывной работы за компьютером.</li></ol>
        ${pre ? '<button type="button" class="mkx-btn mkx-primary" data-mkx-start>Начать тестирование</button>' : `<button type="button" class="mkx-btn mkx-primary" data-mkx-go="${MK.i}">Продолжить тестирование</button>`}</section>`;
    } else if (page === 'test') {
      const q = r.tasks[MK.i];
      body = `<section class="mkx-box"><h2 class="mkx-h">Задание ${q.n} <small>(${q.points} ${plural(q.points, 'балл', 'балла', 'баллов')})</small></h2>
        <div class="mkx-q" id="mkxQ">${q.html}</div>
        ${q.file ? `<p class="mkx-file">Файл к заданию: <a href="api/mcko/file?run=${r.run}&amp;q=${encodeURIComponent(q.id)}" download="${esc(q.file)}">${esc(q.file)}</a></p>` : ''}
        <div class="mkx-act"><button type="button" class="mkx-btn mkx-primary" data-mkx-save>Сохранить ответ</button>
          <span class="mkx-status" id="mkxSaved" role="status">${mkHas(q) ? 'Ответ сохранён' : ''}</span>
          <span class="mkx-sp"></span>
          <button type="button" class="mkx-btn" data-mkx-step="-1" ${MK.i ? '' : 'disabled'}>← предыдущее</button>
          <button type="button" class="mkx-btn" data-mkx-step="1" ${MK.i < r.tasks.length - 1 ? '' : 'disabled'}>следующее →</button></div></section>`;
    } else if (page === 'confirm') {
      const missed = r.tasks.filter(t => !mkHas(t));
      body = `<section class="mkx-box mkx-confirm"><h2>${missed.length ? 'Вы ответили не на все задания.' : 'Вы ответили на все задания.'}</h2>
        ${missed.length ? `<p>Без сохранённого ответа: ${missed.map(t => `<button type="button" class="mkx-link" data-mkx-go="${t.n - 1}">№${t.n}</button>`).join(', ')}.</p>` : ''}
        <p><button type="button" class="mkx-btn" data-mkx-go="${MK.i}">продолжить отвечать</button> или <button type="button" class="mkx-btn mkx-primary" data-mkx-finish>закончить тестирование *</button></p>
        <p class="mkx-note">* после завершения тестирования вернуться к заданиям будет нельзя</p></section>`;
    } else {
      const d = new Date((r.finished || Date.now() / 1000) * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).replace(' г.', '');
      const rows = r.rows || [];
      body = `<section class="mkx-box mkx-proto"><h2>Протокол тренировочной работы</h2><h3>${esc(r.title)}</h3>
        <table class="mkx-who-t"><tr><td>тестируемый:</td><td>${esc(r.fio)}${r.klass ? ', ' + esc(r.klass) : ''}</td></tr><tr><td>дата:</td><td>${d}</td></tr>
          ${r.reason === 'time' ? '<tr><td>завершено:</td><td>по окончании времени</td></tr>' : ''}</table>
        ${r.score != null ? `<div class="mkx-proto-grid"><table class="mkx-res"><thead><tr><th>№ задания</th><th>ответ</th><th>балл за задание</th></tr></thead><tbody>
          ${rows.map(x => `<tr class="${!x.answered ? 'skip' : x.points >= x.max ? 'ok' : x.points ? 'part' : 'bad'}"><td>${x.n}</td><td>${!x.answered ? 'нет ответа' : x.points >= x.max ? 'верно' : x.points ? 'частично' : 'ошибка'}</td><td>${x.points}${x.max > 1 ? ' из ' + x.max : ''}</td></tr>`).join('')}</tbody></table>
          <table class="mkx-total"><tr class="ok"><th>Набрано баллов:</th><td>${r.score}</td></tr><tr><th>Максимум баллов:</th><td>${r.max}</td></tr><tr class="skip"><th>Пропущено ответов:</th><td>${rows.filter(x => !x.answered).length}</td></tr>
          <tr><td colspan="2" class="mkx-note">Оценка не ставится: это тренировочная работа.</td></tr></table></div>`
          : `<p>Работа сдана. Сохранено ответов: <b>${r.answered}</b> из ${r.tasks.length}. Результат сообщит учитель.</p>`}
        <p class="mkx-act"><button type="button" class="mkx-btn" data-mkx-print>Печать протокола</button><button type="button" class="mkx-btn mkx-primary" data-mkx-exit>К списку работ</button></p></section>`;
    }
    MK.ov.innerHTML = `<div class="mkx-in">${bar}${body}<footer class="mkx-foot">Тренировочное тестирование Egeshka по типам диагностики МЦКО · не официальный сервис МЦКО</footer></div>`;
    if (page === 'test') {
      const q = r.tasks[MK.i], vals = r.answers[q.id] || [];
      MK.ov.querySelectorAll('#mkxQ input').forEach((inp, j) => { inp.value = vals[j] || ''; inp.spellcheck = false; inp.autocomplete = 'off'; });
      MK.ov.querySelectorAll('#mkxQ a[href*="api/mcko/file"]').forEach(a => a.setAttribute('download', q.file || ''));
      MK.ov.querySelector('#mkxQ input')?.focus({ preventScroll: true });
    }
    MK.ov.scrollTop = 0;
    mkStop();
    if (!done && !pre) { MK.timer = setInterval(mkTick, 1000); mkTick(); }
  }
  function mkTick() {
    if (!MK.ov || !MK.run || MK.run.finished) return mkStop();
    const left = mkLeft(), el = MK.ov.querySelector('#mkxTime');
    if (el) { el.textContent = `Оставшееся время — ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; el.classList.toggle('low', left < 300); }
    if (left <= 0) { mkStop(); mkSave(true).finally(() => mkFinish(true)); }
  }
  async function mkSave(quiet) {
    const r = MK.run; if (!r || r.finished || MK.page !== 'test' || !MK.ov) return;
    const q = r.tasks[MK.i], inputs = [...MK.ov.querySelectorAll('#mkxQ input')];
    if (!q || !inputs.length) return;
    const values = inputs.map(i => i.value.trim());
    if (quiet && values.join('\u0001') === (r.answers[q.id] || []).join('\u0001')) return;
    if (quiet && !values.some(Boolean)) return;
    try {
      await api('mcko/save', { run: r.run, q: q.id, values });
      r.answers[q.id] = values;
      if (!MK.ov) return;
      const s = MK.ov.querySelector('#mkxSaved');
      if (s) { s.textContent = values.some(Boolean) ? 'Ответ сохранён' : 'Ответ удалён'; s.className = 'mkx-status ok'; }
      MK.ov.querySelector(`.mkx-n[data-mkx-go="${MK.i}"]`)?.classList.toggle('has', mkHas(q));
    } catch (e) {
      if (e.status === 409) return mkLoadRun(r.run, 'result');      // время вышло — работа уже сдана
      toast(e.message || 'Ответ не сохранён — нет связи с сервером');
    }
  }
  async function mkFinish(auto) {
    const r = MK.run; if (!r) return;
    let v;
    try { v = await api('mcko/finish', { run: r.run }); } catch (e) { toast(e.message || 'Нет связи с сервером'); return; }
    MK.run = v; mkStop();
    if (auto) toast('Время вышло — работа завершена с сохранёнными ответами');
    if (MK.ov) mkShow('result');
  }
  // Несохранённый ответ при переходе не записываем — как в настоящем тестировании; предупреждаем один раз
  function mkUnsaved() {
    if (MK.page !== 'test' || !MK.ov) return false;
    const q = MK.run.tasks[MK.i], vals = [...MK.ov.querySelectorAll('#mkxQ input')].map(i => i.value.trim());
    return vals.join('\u0001') !== (MK.run.answers[q.id] || []).map(String).join('\u0001') && (vals.some(Boolean) || mkHas(q));
  }
  function mkLeave(fn) {
    if (mkUnsaved() && !confirm('Ответ на это задание не сохранён. Перейти без сохранения?')) return;
    fn();
  }
  async function mkOvClick(e) {
    const t = e.target;
    if (t.closest('[data-mkx-exit]')) return mkLeave(() => mkList());
    if (t.closest('[data-mkx-print]')) return window.print();
    const sb = t.closest('[data-mkx-start]');
    if (sb) return mkStart(sb);
    const go = t.closest('[data-mkx-go]');
    if (go) return mkLeave(() => { MK.i = +go.dataset.mkxGo; mkShow('test'); });
    const pg = t.closest('[data-mkx-page]');
    if (pg) return mkLeave(() => mkShow(pg.dataset.mkxPage));
    const st = t.closest('[data-mkx-step]');
    if (st) return mkLeave(() => { MK.i = Math.max(0, Math.min(MK.run.tasks.length - 1, MK.i + +st.dataset.mkxStep)); mkShow('test'); });
    if (t.closest('[data-mkx-save]')) return mkSave(false);
    if (t.closest('[data-mkx-finish]')) { t.closest('[data-mkx-finish]').disabled = true; return mkFinish(false); }
  }
  trainerEl.addEventListener('click', async e => {
    if (!mkActive()) return;
    const t = e.target;
    if (t.closest('[data-mk-back]')) return mkList();
    const op = t.closest('[data-mk-open]');
    if (op) { const w = MK.list.works.find(x => x.id === +op.dataset.mkOpen); if (w) mkIntro(w); return; }
    const pr = t.closest('[data-mk-proto]');
    if (pr) return mkLoadRun(+pr.dataset.mkProto, 'result');
  });
  trainerEl.addEventListener('submit', e => {
    if (!mkActive() || e.target.id !== 'mkStart') return;
    e.preventDefault();
    const w = MK.intro, fio = { last_name: $('#mkLast').value.trim(), first_name: $('#mkFirst').value.trim(), middle_name: $('#mkMiddle').value.trim(), klass: $('#mkKlass').value.trim() };
    if (!fio.last_name || !fio.first_name || !fio.klass) { $('#mkErr').textContent = 'Заполните фамилию, имя и класс'; return; }
    // время ещё не идёт: экран «Описание», старт — кнопкой «Начать тестирование»
    MK.pre = { w, fio };
    MK.run = { pre: true, title: w.title, minutes: w.minutes, max: w.max, answers: {}, finished: null,
      fio: [fio.last_name, fio.first_name, fio.middle_name].filter(Boolean).join(' '), klass: fio.klass,
      tasks: Array.from({ length: w.tasks }, (_, k) => ({ n: k + 1, id: 'p' + k, points: 1 })) };
    MK.i = 0; mkOpenOverlay(); mkShow('desc');
  });
  async function mkStart(btn) {
    const { w, fio } = MK.pre; btn.disabled = true;
    try { const r = await api('mcko/start', Object.assign({ work: w.id }, fio)); MK.pre = null; MK.i = 0; await mkLoadRun(r.run, 'test'); }
    catch (err) { toast(err.message || 'Нет связи с сервером'); btn.disabled = false; }
  }
  // ушли со страницы раздела (назад, другое меню) — экран тестирования закрывается, время на сервере идёт дальше
  new MutationObserver(() => { if (!mkActive()) mkClose(); }).observe(trainerEl, { childList: true });
  window.addEventListener('popstate', () => { if (MK.ov) mkClose(); });

  // ═══════ src/app/12o-im.js
  // ------------------------------------------------------------ «Интеллектуальный мегаполис. Потенциал» (ИТ-класс, теория)
  /* Раздел по своему паролю учителя (как лаборатория Arduino). Главная раздела — план из 10 номеров конкурса
     (информатика, математика, физика) с прогрессом; у номера — разбор (идея, шаги, типичные ошибки, демо-задание)
     и тренировка без лимита; «Пробный вариант» — 10 заданий на 120 минут, баллы как на конкурсе (из 60). */
  const IM = { d: null, view: 'home', slot: 1, task: null, res: null, trial: null, result: null, timer: 0, saveT: 0, pos: 0, auto: false,
    saver: null, finishBusy: false, finishPending: false, finishError: '' };
  const IM_SUBJ = { inf: ['Информатика', 'inf'], mat: ['Математика', 'mat'], phy: ['Физика', 'phy'] };
  const imActive = () => appState.courseShown && appState.pageKind === 'im';
  const imBox = () => trainerEl.querySelector('.im');
  const imSlot = n => ((IM.d && IM.d.slots) || []).find(s => s.n === n);
  const imHint = k => (k === 'pair' ? 'два ответа через запятую или «;», например: 5, 2' : k === 'choice' ? 'номер варианта (или нажмите на вариант)' : 'число');

  async function openIm() {
    IM.view = 'home'; IM.auto = true;                 // идёт вариант — при входе в раздел сразу в него
    await imLoad();
  }
  async function imLoad(view) {
    let d;
    try { d = await api('im'); } catch (e) { if (imActive() && imBox()) imBox().innerHTML = `<p class="fm-note">${esc(e.message || 'Нет связи с сервером')}</p>`; return; }
    if (!imActive() || !imBox()) return;
    IM.d = d; appState.imOk = !!d.access; appState.imPw = d.access || !!d.pw_set;
    if (!d.access) return imLock(!!d.pw_set);
    if (view) IM.view = view;
    if (d.active && IM.auto) { IM.auto = false; await imTrialOpen(); return; }
    IM.auto = false;
    imRender();
  }
  function imLock(configured) {
    imBox().innerHTML = `<div class="crs-lock im-lock"><div class="im-logo" aria-hidden="true">ИМ</div>
      <h2>Интеллектуальный мегаполис — по паролю</h2>
      <p>${configured ? 'Подготовка к конкурсу «Интеллектуальный мегаполис. Потенциал» (ИТ-класс). Пароль выдаёт учитель — он свой, не совпадает с паролями курса и лабораторий. После ввода доступ сохранится в твоём аккаунте.'
        : 'Учитель ещё не открыл этот раздел.'}</p>
      ${configured ? '<form id="imPasswordForm" class="login-form crs-lock-form"><input id="imPassword" class="inp" type="password" maxlength="200" autocomplete="off" placeholder="Пароль раздела" aria-label="Пароль раздела «Интеллектуальный мегаполис»" required><button class="btn primary">Открыть</button></form><p id="imPasswordError" role="alert"></p>' : ''}</div>`;
    $('#imPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.currentTarget.querySelector('button'), msg = $('#imPasswordError'); btn.disabled = true;
      try { await api('im/unlock', { password: $('#imPassword').value }); appState.imOk = true; IM.view = 'home'; await imLoad(); hubRefresh(); }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  }

  // ---------- оценка готовности: номер «держится», если из последних 3 ответов верны хотя бы 2
  function imSlotState(n) {
    const s = (IM.d.stats || {})[n];
    if (!s || !s.tries) return { lvl: 'none', text: 'не начато', pct: 0 };
    const last = s.last.slice(-3), good = last.filter(Boolean).length;
    const lvl = last.length >= 2 && good >= Math.min(2, last.length) ? 'good' : good ? 'mid' : 'weak';
    return { lvl, text: `верно ${s.ok} из ${s.tries}`, pct: Math.round(100 * s.ok / s.tries) };
  }
  function imForecast() {
    return IM.d.slots.reduce((a, s) => a + (imSlotState(s.n).lvl === 'good' ? s.points : 0), 0);
  }

  function imRender() {
    clearInterval(IM.timer); IM.timer = 0;
    const box = imBox();
    if (!box) return;
    if (IM.view === 'slot') return imSlotView(box);
    if (IM.view === 'train') return imTrainView(box);
    if (IM.view === 'result') return imResultView(box);
    imHome(box);
  }
  function imHome(box) {
    const d = IM.d, fc = imForecast(), best = Math.max(0, ...(d.trials || []).map(t => t.score || 0));
    const bySubj = Object.keys(IM_SUBJ).map(k => [k, d.slots.filter(s => s.subj === k)]);
    box.innerHTML = `<section class="im-hero">
        <div class="im-hero-l"><div class="im-logo" aria-hidden="true">ИМ</div><div>
          <div class="crs-kicker">Московский конкурс межпредметных навыков и знаний</div>
          <h2>${esc(d.title)}</h2><p class="im-track">${esc(d.track)}</p></div></div>
        <div class="im-hero-r">
          <div class="im-gauge" style="--p:${Math.round(100 * fc / d.max)}"><b>${fc}</b><small>из ${d.max}</small></div>
          <p class="fm-note">уверенно решаешь номера на ${fc} ${plural(fc, 'балл', 'балла', 'баллов')}${best ? ` · лучший вариант — ${best}` : ''}</p></div>
      </section>
      <ul class="im-rules">${d.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      <div class="im-cta">
        <button type="button" class="btn primary" data-im-trial>${d.active ? `⏱ Продолжить вариант · осталось ${Math.max(0, Math.round((d.active_deadline - Date.now() / 1000) / 60))} мин` : `⏱ Пробный вариант · ${d.minutes} минут`}</button>
        <span class="fm-note">10 заданий по плану конкурса, проверка — после сдачи, баллы как на конкурсе. Калькулятор — кнопкой «Калькулятор» на странице задания.</span>
      </div>
      <h3 class="im-h">План конкурсных заданий</h3>
      <div class="im-legend">${bySubj.map(([k, list]) => `<span class="im-chip ${k}">${IM_SUBJ[k][0]} · ${list.reduce((a, s) => a + s.points, 0)} б.</span>`).join('')}</div>
      <div class="im-plan">${d.slots.map(s => {
        const st = imSlotState(s.n);
        return `<article class="im-card ${s.subj} lvl-${st.lvl}">
          <div class="im-card-top"><span class="im-num">${s.n}</span><span class="im-chip ${s.subj}">${IM_SUBJ[s.subj][0]}</span>
            <span class="im-lv" title="Уровень сложности: Б — базовый, П — повышенный">${esc(s.level)}</span><span class="im-pts">${s.points} б.</span></div>
          <h4>${esc(s.title)}</h4><p class="im-topic">${esc(s.topic)}</p>
          <div class="im-bar"><i style="width:${st.pct}%"></i></div><p class="im-st">${st.text}</p>
          <div class="im-card-a"><button type="button" class="btn" data-im-slot="${s.n}">Разбор</button>
            <button type="button" class="btn primary" data-im-train="${s.n}">Тренировка</button></div></article>`;
      }).join('')}</div>
      ${(d.trials || []).length ? `<h3 class="im-h">Мои пробные варианты</h3><div class="im-trials">${d.trials.map(t => `<button type="button" class="im-trial" data-im-result="${t.id}">
        <b>${t.score} / ${d.max}</b><span>${new Date(t.finished * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></button>`).join('')}</div>` : ''}
      <p class="im-src">${esc(d.source)}</p>`;
  }

  // ---------- разбор номера: идея, план, ошибки, демо-задание из демоварианта
  function imSlotView(box) {
    const s = imSlot(IM.slot);
    if (!s) { IM.view = 'home'; return imRender(); }
    box.innerHTML = `${imBack()}<section class="im-guide ${s.subj}">
        <div class="im-card-top"><span class="im-num">${s.n}</span><span class="im-chip ${s.subj}">${IM_SUBJ[s.subj][0]}</span><span class="im-lv">${esc(s.level)}</span><span class="im-pts">${s.points} б.</span></div>
        <h2>${esc(s.title)}</h2><p class="im-topic">${esc(s.topic)}</p>
        <div class="im-cols"><div class="im-box"><h4>💡 Главная идея</h4><p>${esc(s.idea)}</p></div>
          <div class="im-box"><h4>🧭 План решения</h4><ol>${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div></div>
        <div class="im-box warn"><h4>⚠️ Типичные ошибки</h4><ul>${s.mistakes.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <h3 class="im-h">Задание из демоварианта</h3>
        <div class="im-task">${imTaskHtml(s.demo.html)}</div>
        ${imAnswerForm(s.demo.kind, 'imDemoAns')}
        <div class="im-sol" id="imDemoSol" hidden></div>
        <div class="im-card-a"><button type="button" class="btn" id="imDemoShow">Показать решение</button>
          <button type="button" class="btn primary" data-im-train="${s.n}">Тренироваться: задания этого типа →</button></div>
      </section>`;
    const show = (ok) => {
      const sol = $('#imDemoSol');
      sol.hidden = false;
      sol.innerHTML = `${ok == null ? '' : ok ? '<p class="im-ok">✓ Верно!</p>' : '<p class="im-bad">✗ Не совпало с эталоном</p>'}
        <p><b>Ответ:</b> ${esc(s.demo.ans)}</p>${safeHtml(s.demo.sol)}`;
      renderMathIn(sol);
    };
    $('#imDemoShow').onclick = () => show(null);
    $('#imDemoAnsForm').onsubmit = e => { e.preventDefault(); show(imLocalCheck(s.demo, $('#imDemoAns').value)); };
    imBindOptions(box, 'imDemoAns');
    renderMathIn(box);
  }
  // демо-ответ проверяется на странице (официальный демовариант с ответами), тренировочные — на сервере
  function imLocalCheck(demo, v) {
    const n = x => String(x).toLowerCase().replace(/\s+/g, '').replace(/\./g, ',').replace(/;/g, ',');
    const L = { а: '1', б: '2', в: '3', г: '4', д: '5' };
    const a = L[n(v)] || n(v);
    return a === n(demo.ans) || a === n(demo.key || '');      // у выбора — номер варианта или само значение
  }

  // ---------- тренировка: задание за заданием одного номера; ответ проверяет сервер, после ответа — решение
  async function imTrain(n) {
    IM.slot = n; IM.view = 'train'; IM.res = null; IM.task = null;
    imRender();
    try { IM.task = (await api('im/task?slot=' + n)).task; } catch (e) { toast(e.message); IM.view = 'home'; return imRender(); }
    if (imActive()) imRender();
  }
  function imTrainView(box) {
    const s = imSlot(IM.slot), t = IM.task, st = imSlotState(IM.slot);
    if (!t) { box.innerHTML = `${imBack()}<p class="fm-note">Подбираю задание…</p>`; return; }
    box.innerHTML = `${imBack()}<section class="im-train ${s.subj}">
        <div class="im-card-top"><span class="im-num">${s.n}</span><span class="im-chip ${s.subj}">${IM_SUBJ[s.subj][0]}</span><span class="im-lv">${esc(s.level)}</span>
          <span class="im-pts">${s.points} б.</span><span class="im-st">${st.text}</span><button type="button" class="link-btn" data-im-slot="${s.n}">разбор номера</button>
          <button type="button" class="btn ghost im-calc" data-im-calc>🧮 Калькулятор</button></div>
        <h2>${esc(s.title)}</h2>
        <div class="im-task">${imTaskHtml(t.html)}</div>
        ${IM.res ? '' : imAnswerForm(t.kind, 'imAns')}
        ${IM.res ? `<div class="im-sol ${IM.res.ok ? 'ok' : 'bad'}">${IM.res.ok ? '<p class="im-ok">✓ Верно!</p>' : `<p class="im-bad">✗ Неверно. Твой ответ: ${esc(IM.res.given)}</p>`}
          <p><b>Ответ:</b> ${esc(IM.res.ans)}</p>${safeHtml(IM.res.sol)}</div>
          <div class="im-card-a"><button type="button" class="btn primary" data-im-train="${s.n}">Следующее задание →</button></div>` : ''}
      </section>`;
    if (!IM.res) {
      $('#imAnsForm').onsubmit = async e => {
        e.preventDefault();
        const v = $('#imAns').value.trim(), btn = e.currentTarget.querySelector('button');
        if (!v) return;
        btn.disabled = true;
        try {
          const r = await api('im/check', { id: t.id, answer: v });
          IM.res = { ...r, given: v };
          IM.d.stats = r.stats || IM.d.stats;
          imRender();
        } catch (err) { toast(err.message); btn.disabled = false; }
      };
      imBindOptions(box, 'imAns');
      setTimeout(() => $('#imAns')?.focus(), 30);
    }
    renderMathIn(box);
  }

  // ---------- пробный вариант: 10 заданий, 120 минут, ответы сохраняются на сервере, проверка — после сдачи
  function createImTrialSaver({ id, sid, answers, storage, send, changed = () => {}, clock = () => Date.now() }) {
    const key = `egeTrainer.imDraft.s${sid}.t${id}`;
    let revision = 0, savedRevision = 0, inFlight = null, paused = false, state = 'saved', error = '', nextOnline = 0;
    let baseline = { ...answers }, observed = { ...answers }, local = true;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const report = () => changed({ state, error, local, pending: revision !== savedRevision });
    const persist = () => {
      try {
        if (revision === savedRevision) storage.removeItem(key);
        else {
          // Restore only locally edited fields; newer answers in other fields remain on the server.
          const patch = Object.fromEntries(Object.keys(answers).filter(k => answers[k] !== baseline[k]).map(k => [k, answers[k]]));
          storage.setItem(key, JSON.stringify({ sid, id, patch, ts: clock() }));
        }
        local = true;
      } catch (_) { local = false; }
    };
    try {
      const draft = JSON.parse(storage.getItem(key) || 'null');
      if (draft && draft.sid === sid && draft.id === id && draft.patch && clock() - draft.ts < 86400000) {
        for (const [k, v] of Object.entries(draft.patch)) {
          if (Object.hasOwn(answers, k) && typeof v === 'string') answers[k] = v.slice(0, 120);
        }
        if (!same(answers, baseline)) { revision++; state = 'pending'; observed = { ...answers }; }
      }
    } catch (_) { local = false; }
    function touch() {
      if (!same(answers, observed)) {
        observed = { ...answers }; revision++; state = 'pending'; error = ''; persist(); report();
      }
    }
    function flush() {
      touch();
      if (paused) return Promise.resolve(false);
      if (inFlight) return inFlight;
      if (revision === savedRevision) return Promise.resolve(true);
      inFlight = (async () => {
        while (!paused && revision !== savedRevision) {
          const sentRevision = revision, snapshot = { ...answers };
          state = 'saving'; error = ''; report();
          try { await send({ id, answers: snapshot }); }
          catch (e) {
            state = 'error'; error = e.message || 'Нет связи с сервером'; nextOnline = clock() + 10000;
            persist(); report(); return false;
          }
          savedRevision = sentRevision; baseline = snapshot;
          state = revision === savedRevision ? 'saved' : 'pending'; persist(); report();
        }
        return revision === savedRevision;
      })().finally(() => { inFlight = null; });
      return inFlight;
    }
    return {
      id, sid, answers, touch, flush,
      status: () => ({ state, error, local, pending: revision !== savedRevision }),
      // A connectivity event is one attempt, never a timer retry loop or a finish retry.
      online() { if (!paused && revision !== savedRevision && clock() >= nextOnline) { nextOnline = clock() + 10000; return flush(); } },
      pause() { touch(); paused = true; return inFlight || Promise.resolve(true); },
      clear() { paused = true; savedRevision = revision; try { storage.removeItem(key); } catch (_) { /* no storage */ } },
    };
  }
  function imSaveStatus() {
    const box = $('#imSaveStatus'), retry = $('#imSaveRetry');
    if (!box || !IM.saver) return;
    const s = IM.saver.status();
    box.textContent = IM.finishBusy ? 'Отправляю вариант…' : IM.finishError ? `Сдача не подтверждена: ${IM.finishError}. Повтори сдачу кнопкой «Сдать вариант».`
      : s.state === 'saved' ? 'Сохранено на сервере' : s.state === 'saving' ? 'Сохраняю ответы…'
        : s.state === 'error' ? `Не сохранено на сервере: ${s.error}. ${s.local ? 'Черновик остался в этой вкладке.' : 'Ответы пока только в памяти вкладки — не закрывай её.'}`
          : 'Изменения ожидают отправки';
    if (retry) retry.hidden = IM.finishPending || !['error', 'pending'].includes(s.state);
  }
  async function imTrialOpen() {
    clearTimeout(IM.saveT);
    if (IM.saver) await IM.saver.pause();
    let r;
    try { r = await api('im/trial/start', {}); } catch (e) { toast(e.message); return; }
    if (!imActive()) return;
    r.answers = Object.fromEntries(r.items.map(it => [it.id, r.answers[it.id] || '']));
    IM.trial = r; IM.view = 'trial'; IM.pos = IM.pos < r.items.length ? IM.pos : 0;
    const sid = appState.student?.sid;
    IM.finishBusy = false; IM.finishPending = false; IM.finishError = '';
    let draftStorage;
    try { draftStorage = sessionStorage; } catch (_) { /* storage disabled: report memory-only draft */ }
    IM.saver = createImTrialSaver({ id: r.id, sid, answers: r.answers, storage: draftStorage, changed: imSaveStatus,
      send: data => appState.student?.sid === sid ? api('im/trial/save', data) : Promise.reject(new Error('Войди в свой аккаунт, чтобы сохранить ответы')) });
    imTrialRender();
    if (IM.saver.status().pending) IM.saver.flush();
  }
  function imTrialRender() {
    const box = imBox(), T = IM.trial;
    if (!box || !T) return;
    const it = T.items[IM.pos], s = imSlot(it.slot);
    const left = () => Math.max(0, T.deadline - Date.now() / 1000);
    const clock = () => { const x = left(); return `${Math.floor(x / 3600)}:${String(Math.floor(x % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(x % 60)).padStart(2, '0')}`; };
    box.innerHTML = `<section class="im-trialbar"><button type="button" class="link-btn" data-im-home title="Вариант не прервётся: время продолжает идти">← К номерам</button><b>Пробный вариант</b><span class="im-clock${left() < 600 ? ' warn' : ''}" id="imClock">${clock()}</span>
        <nav class="im-nav">${T.items.map((x, i) => `<button type="button" class="${i === IM.pos ? 'on' : ''}${(T.answers[x.id] || '').trim() ? ' done' : ''}" data-im-go="${i}" title="Задание ${i + 1} · ${esc(imSlot(x.slot).title)}">${i + 1}</button>`).join('')}</nav>
        <button type="button" class="btn ghost im-calc" data-im-calc>🧮</button>
        <button type="button" class="btn primary" data-im-finish>Сдать вариант</button></section>
      <p class="fm-note"><span id="imSaveStatus" role="status" aria-live="polite"></span> <button type="button" class="btn" id="imSaveRetry" hidden>Повторить сохранение</button></p>
      <section class="im-train ${s.subj}">
        <div class="im-card-top"><span class="im-num">${IM.pos + 1}</span><span class="im-chip ${s.subj}">${IM_SUBJ[s.subj][0]}</span><span class="im-lv">${esc(s.level)}</span><span class="im-pts">${s.points} б.</span></div>
        <div class="im-task">${imTaskHtml(it.html)}</div>
        <label class="im-ans">Ответ <input class="inp" id="imTAns" maxlength="120" autocomplete="off" spellcheck="false" placeholder="${esc(imHint(it.kind))}" value="${esc(T.answers[it.id] || '')}"></label>
        <div class="im-card-a">${IM.pos ? '<button type="button" class="btn" data-im-go="' + (IM.pos - 1) + '">← Назад</button>' : ''}
          ${IM.pos < T.items.length - 1 ? `<button type="button" class="btn primary" data-im-go="${IM.pos + 1}">Дальше →</button>` : '<button type="button" class="btn primary" data-im-finish>Сдать вариант</button>'}</div>
      </section>`;
    imBindOptions(box, 'imTAns');
    $('#imSaveRetry').onclick = () => IM.saver?.flush();
    $('#imTAns').disabled = IM.finishPending;
    $$('[data-im-finish]').forEach(btn => { btn.disabled = IM.finishBusy; });
    imSaveStatus();
    $('#imTAns').addEventListener('input', e => { T.answers[it.id] = e.target.value; imTrialSave(); $$('.im-nav button')[IM.pos].classList.toggle('done', !!e.target.value.trim()); });
    renderMathIn(box);
    clearInterval(IM.timer);
    IM.timer = setInterval(() => {
      const c = $('#imClock');
      if (!c || !imActive()) { clearInterval(IM.timer); return; }
      c.textContent = clock(); c.classList.toggle('warn', left() < 600);
      if (left() <= 0) { clearInterval(IM.timer); if (!IM.finishPending) { toast('Время вышло — отправляю вариант', 4000); imTrialFinish(true); } }
    }, 1000);
  }
  function imTrialSave(now) {
    clearTimeout(IM.saveT);
    const saver = IM.saver;
    if (!saver || !IM.trial || saver.id !== IM.trial.id || IM.finishPending) return;
    saver.touch();
    if (now) return saver.flush();
    IM.saveT = setTimeout(() => saver.flush(), 700);
  }
  async function imTrialFinish(force) {
    const T = IM.trial;
    if (!T || IM.finishBusy) return;
    const empty = T.items.filter(x => !(T.answers[x.id] || '').trim()).length;
    if (!force && !confirm(empty ? `Без ответа: ${empty}. Сдать вариант?` : 'Сдать вариант? Изменить ответы будет нельзя.')) return;
    clearTimeout(IM.saveT); clearInterval(IM.timer);
    IM.finishBusy = true; IM.finishPending = true; IM.finishError = '';
    $('#imTAns')?.setAttribute('disabled', '');
    $$('[data-im-finish]').forEach(btn => { btn.disabled = true; }); imSaveStatus();
    await IM.saver?.pause();
    try { IM.result = await api('im/trial/finish', { id: T.id, answers: { ...T.answers } }); }
    catch (e) {
      IM.finishError = e.message || 'Нет связи с сервером'; IM.finishBusy = false;
      $$('[data-im-finish]').forEach(btn => { btn.disabled = false; }); imSaveStatus(); return;
    }
    IM.saver?.clear(); IM.saver = null; IM.finishBusy = false; IM.finishPending = false;
    IM.trial = null; IM.view = 'result';
    try { IM.d = await api('im'); } catch (e) { /* итог уже есть */ }
    if (imActive()) imRender();
  }
  window.addEventListener('online', () => { if (IM.saver?.sid === appState.student?.sid) IM.saver.online(); });
  window.addEventListener('pagehide', () => { IM.saver?.touch(); });
  function imResultView(box) {
    const R = IM.result;
    if (!R) { IM.view = 'home'; return imRender(); }
    box.innerHTML = `${imBack()}<section class="im-result">
        <div class="im-gauge big" style="--p:${Math.round(100 * R.score / R.max)}"><b>${R.score}</b><small>из ${R.max}</small></div>
        <div><h2>Пробный вариант · ${R.score} из ${R.max}</h2><p class="fm-note">${R.rows.filter(r => r.ok).length} из ${R.rows.length} заданий верно · ${R.minutes} мин</p></div>
      </section>
      <div class="im-rows">${R.rows.map((r, i) => {
        const s = imSlot(r.slot);
        return `<details class="im-row ${r.ok ? 'ok' : 'bad'}"><summary><span class="im-num">${i + 1}</span><span class="im-chip ${s.subj}">${IM_SUBJ[s.subj][0]}</span>
          <b>${esc(s.title)}</b><span class="im-got">${r.got} / ${r.points}</span><span>${r.ok ? '✓' : r.answer ? '✗' : '—'}</span></summary>
          <div class="im-task">${imTaskHtml(r.html)}</div>
          <p>Твой ответ: <b>${esc(r.answer || 'нет')}</b> · верный: <b>${esc(r.ans)}</b></p><div class="im-sol">${safeHtml(r.sol)}</div>
          <button type="button" class="btn" data-im-train="${r.slot}">Потренировать этот номер</button></details>`;
      }).join('')}</div>`;
    renderMathIn(box);
  }

  // ---------- общие кусочки
  const imBack = () => '<button type="button" class="link-btn im-back" data-im-home>← Все номера</button>';
  const imTaskHtml = h => safeHtml(h);
  const imAnswerForm = (kind, id) => `<form class="im-ansform" id="${id}Form"><label class="im-ans">Ответ <input class="inp" id="${id}" maxlength="120" autocomplete="off" spellcheck="false" placeholder="${esc(imHint(kind))}"></label>
    <button class="btn primary">Проверить</button></form>`;
  /** Варианты ответа кликабельны: номер подставляется в поле; у двойного ответа — первая и вторая часть отдельно. */
  function imBindOptions(box, inputId) {
    box.querySelectorAll('.im-task .im-opts li[data-o]').forEach(li => li.addEventListener('click', () => {
      const inp = $('#' + inputId);
      if (!inp || inp.disabled) return;
      const two = li.closest('.im-two');
      if (two) {
        const which = [...two.querySelectorAll('.im-opts')].indexOf(li.closest('.im-opts'));
        const parts = (inp.value.split(/[,;\s]+/).filter(Boolean).concat(['', ''])).slice(0, 2);
        parts[which] = li.dataset.o;
        inp.value = parts.filter(Boolean).length === 2 ? parts.join(', ') : parts.find(Boolean) || '';
        li.closest('.im-opts').querySelectorAll('li').forEach(x => x.classList.toggle('pick', x === li));
      } else {
        inp.value = li.dataset.o;
        li.closest('.im-opts').querySelectorAll('li').forEach(x => x.classList.toggle('pick', x === li));
      }
      inp.dispatchEvent(new Event('input'));
    }));
  }
  function renderMathIn(el) { if (typeof renderMath === 'function') { try { renderMath(el); } catch (e) { /* без формул */ } } }

  trainerEl.addEventListener('click', e => {
    if (!imActive()) return;
    const t = e.target;
    if (t.closest('[data-im-home]')) { if (IM.trial) imTrialSave(true); IM.trial = null; IM.view = 'home'; clearInterval(IM.timer); window.scrollTo(0, 0); return imLoad('home'); }
    const sl = t.closest('[data-im-slot]');
    if (sl) { IM.slot = +sl.dataset.imSlot; IM.view = 'slot'; window.scrollTo(0, 0); return imRender(); }
    const tr = t.closest('[data-im-train]');
    if (tr) { window.scrollTo(0, 0); return imTrain(+tr.dataset.imTrain); }
    if (t.closest('[data-im-trial]')) { IM.pos = 0; return imTrialOpen(); }
    if (t.closest('[data-im-calc]')) { if (typeof toggleCalc === 'function') toggleCalc(); return; }
    const go = t.closest('[data-im-go]');
    if (go && IM.trial) { imTrialSave(true); IM.pos = +go.dataset.imGo; window.scrollTo(0, 0); return imTrialRender(); }
    if (t.closest('[data-im-finish]')) return imTrialFinish(false);
    const rs = t.closest('[data-im-result]');
    if (rs) {
      api('im/trial?id=' + rs.dataset.imResult).then(r => { IM.result = r; IM.view = 'result'; window.scrollTo(0, 0); imRender(); }).catch(err => toast(err.message));
    }
  });

  return { openMcko, openIm };
};
