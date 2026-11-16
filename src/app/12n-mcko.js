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
      body = `<section class="mkx-box mkx-confirm"><h2>${missed.length ? 'Вы ответили не на все задания!' : 'Вы ответили на все задания.'}</h2>
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
