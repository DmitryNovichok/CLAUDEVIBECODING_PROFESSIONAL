  // ------------------------------------------------------------ сервер: вход и синхронизация
  let localWriteAt = 0;                 // когда эта вкладка сама отправила ответ или сдала работу — для живых обновлений
  async function api(path, body, method) {
    if (body && /^(check|reveal|asg\/(answer|finish)|exam|duel\/(finish|surrender)|tour\/(finish|surrender))/.test(path)) localWriteAt = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (student) headers['X-Token'] = student.token;
    if (isTemp()) headers['X-Temp'] = '1';
    const r = await fetch('api/' + path, {
      method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await r.json(); } catch (e) { /* пусто */ }
    if (!r.ok) {
      const err = new Error(data.error || r.statusText);
      err.status = r.status;
      throw err;
    }
    return data;
  }

  let syncTimer = null;
  function scheduleSync() {
    if (!SERVER || !student) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => flushSync(false), 3000);
  }
  function currentForecast() {
    try { return P.log.length >= CFG.forecast.minAnswers ? forecast().score : null; } catch (e) { return null; }
  }
  /** На сервер уходят только прогноз (для учителя) и настройки. Сам прогресс сервер знает
      из журнала попыток — его больше не нужно пересылать целиком. */
  function flushSync(useBeacon) {
    if (!SERVER || !student) return;
    clearTimeout(syncTimer);
    const body = { token: student.token };
    const fc = currentForecast();
    if (fc != null && fc !== sentForecast) body.forecast = fc;
    if (prefsDirty) body.prefs = prefs;
    if (body.forecast == null && !body.prefs) return;
    const done = () => {
      if (body.forecast != null) sentForecast = body.forecast;
      if (body.prefs) prefsDirty = false;
    };
    const json = JSON.stringify(body);
    if (useBeacon && navigator.sendBeacon && json.length < 60000) {
      if (navigator.sendBeacon('api/progress', new Blob([json], { type: 'text/plain' }))) done();
      return;
    }
    api('progress', body).then(done).catch(() => { /* повторим при следующем ответе */ });
  }

  /** Данные ученика с сервера: правила показа ответа, избранное и заметки. */
  function applyMe(me) {
    student = { sid: me.sid, name: me.name, token: me.token || (student && student.token) };
    writeStudent(student);
    if (me.rules) Object.assign(RULES, me.rules);
    ADMINS = new Set(me.admins || []);
    CONSENT_NEEDED = !!me.consent_needed;
    if (me.game) GAME = me.game;
    if (GAME && GAME.froze) setTimeout(() => toast(`❄️ Ты пропустил ${GAME.froze === 1 ? 'день' : `${GAME.froze} ${plural(GAME.froze, 'день', 'дня', 'дней')}`} — заморозка спасла огонёк`, 6000), 1500);
    COURSE_OK = !!me.course;
    TEACHER = !!me.teacher;                  // учитель решает как ученик: рейтинг видит, но сам в нём не участвует
    document.body.classList.toggle('teacher-mode', TEACHER);
    $('#courseCard')?.classList.toggle('locked', !COURSE_OK);
    pycSetAccess(me.pyc, me.pyc_pw);
    giftNotify(me.gifts_new);
    coinNotify(me.coin_news);
    const local = readJSON(prefsKey());
    prefs = normPrefs(me.prefs || local);
    writeJSON(prefsKey(), prefs);
    prefsDirty = !me.prefs && !!local;       // настройки были только в браузере — отправим на сервер
    sentForecast = me.fc && me.fc.length ? me.fc[me.fc.length - 1].s : null;
  }

  /** Прогресс — из журнала попыток на сервере: одинаковый на всех устройствах. */
  async function loadHistory() {
    try {
      const d = await api('history');
      rebuildFromHistory(d.h || []);
      writeJSON(storeKey(), P);
    } catch (e) {
      if (e.status === 401) throw e;
      const localP = readJSON(storeKey());   // нет связи — работаем с копией из браузера
      P = validProgress(localP) ? Object.assign(freshProgress(), localP) : freshProgress();
      toast('Нет связи с сервером — показан прогресс, сохранённый в этом браузере.', 4000);
    }
  }

  function renderWho() {
    const w = $('#who');
    if (!w) return;
    w.hidden = !(SERVER && student);
    if (!student) return;
    $('#whoName').textContent = student.name;
    const lbl = $('#who .who-label');
    if (lbl) lbl.textContent = TEACHER ? 'Учитель · решает как ученик' : 'Ученик';
    const ini = student.name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
    if ($('#avaTxt')) $('#avaTxt').textContent = ini || '?';
  }
  // меню профиля под кружком с инициалами
  function setWhoMenu(open) {
    const m = $('#whoMenu');
    if (!m) return;
    m.hidden = !open;
    $('#avaBtn').setAttribute('aria-expanded', String(open));
  }
  $('#avaBtn')?.addEventListener('click', () => setWhoMenu($('#whoMenu').hidden));
  $('#whoLvl')?.addEventListener('click', () => { setWhoMenu(false); openGame(); });
  $('#whoTheme')?.addEventListener('click', () => { setWhoMenu(false); openThemes(); });
  document.addEventListener('click', e => { if (!e.target.closest('#who')) setWhoMenu(false); });

  async function askName() {
    const r = await loginDialog();
    applyMe(r);
    await askConsent();
    await loadHistory();
  }
  // ---- согласие на обработку персональных данных: уже зарегистрированные подтверждают при входе
  let CONSENT_NEEDED = false;
  function askConsent() {
    if (!CONSENT_NEEDED) return Promise.resolve();
    return new Promise(resolve => {
      const m = $('#consentModal'), ok = $('#consentOk'), err = $('#consentErr');
      const upd = () => { ok.disabled = !($('#cnTerms').checked && $('#cnConsent').checked); };
      $('#cnTerms').onchange = upd;
      $('#cnConsent').onchange = upd;
      upd();
      m.hidden = false;
      $('#consentForm').onsubmit = async e => {
        e.preventDefault();
        ok.disabled = true;
        err.textContent = '';
        try { await api('consent', { accept: true }); } catch (x) { err.textContent = x.message || 'Нет связи с сервером — попробуйте ещё раз'; upd(); return; }
        CONSENT_NEEDED = false;
        m.hidden = true;
        resolve();
      };
      $('#consentOut').onclick = () => logout();
    });
  }

  // ---- пароль ученика: смена, а у старых учеников без пароля — задать его
  function openPasswordDialog(mustSet) {
    const m = $('#pwModal'), errEl = $('#pwErr');
    $('#pwTitle').textContent = mustSet ? 'Задайте пароль' : 'Сменить пароль';
    $('#pwNote').textContent = mustSet
      ? 'Теперь вход в тренажёр — по ФИО и паролю. Придумайте пароль: с ним вы войдёте с любого устройства, а браузер сможет его запомнить.'
      : 'После смены пароля вход на других устройствах сбросится — там нужно будет войти заново.';
    $('#pwOldField').hidden = !!mustSet;
    ['#pwOld', '#pwNew', '#pwNew2'].forEach(sel => { $(sel).value = ''; });
    errEl.textContent = '';
    m.hidden = false;
    setTimeout(() => $(mustSet ? '#pwNew' : '#pwOld').focus(), 30);
    $('#pwForm').onsubmit = async e => {
      e.preventDefault();
      const nw = $('#pwNew').value;
      if (nw.length < 6) { errEl.textContent = 'Пароль — не короче 6 символов.'; return; }
      if (nw !== $('#pwNew2').value) { errEl.textContent = 'Пароли не совпадают.'; $('#pwNew2').select(); return; }
      const btn = $('#pwForm button[type="submit"]');
      btn.disabled = true;
      try {
        const r = await api('password', { old: $('#pwOld').value, new: nw });
        student.token = r.token;
        writeStudent(student);
        m.hidden = true;
        toast('Пароль сохранён', 2500);
      } catch (err) {
        errEl.textContent = err.status ? err.message : 'Нет связи с сервером.';
      } finally {
        btn.disabled = false;
      }
    };
  }
  $('#pwModal').addEventListener('click', e => {
    if (e.target.id === 'pwModal' || e.target.closest('.fm-close')) $('#pwModal').hidden = true;
  });

  async function logout() {
    if (examShown) saveExamInputs();
    abandonCurrent();
    flushSync(false);
    try { await api('logout', {}); } catch (e) { /* cookie сотрётся при следующем входе */ }
    liveStop();
    forgetStudent();
    clearInterval(exTimer);
    EX = null;
    examShown = false;
    student = null;
    P = freshProgress();
    prefs = freshPrefs();
    cur = null;
    ui.currentId = null;
    writeJSON(UI_STORE, ui);
    renderWho();
    trainerEl.innerHTML = '';
    await askName();
    ui.currentId = null;
    start();
  }




