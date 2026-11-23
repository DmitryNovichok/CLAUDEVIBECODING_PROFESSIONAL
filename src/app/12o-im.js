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
    const account = appState.student, box = imBox();
    const active = () => account === appState.student && imActive() && box && box === imBox();
    let d;
    try { d = await api('im'); } catch (e) { if (active()) box.innerHTML = `<p class="fm-note">${esc(e.message || 'Нет связи с сервером')}</p>`; return; }
    if (!active()) return;
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
      e.preventDefault(); const account = appState.student, form = e.currentTarget;
      const btn = form.querySelector('button'), msg = $('#imPasswordError'); btn.disabled = true;
      try {
        await api('im/unlock', { password: $('#imPassword').value });
        if (account !== appState.student || !form.isConnected) return;
        appState.imOk = true; IM.view = 'home'; await imLoad(); hubRefresh();
      }
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
