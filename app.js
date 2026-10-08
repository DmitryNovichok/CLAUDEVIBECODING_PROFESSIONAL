/* Тренажёр ЕГЭ по информатике — адаптивный подбор заданий.
   Данные: window.EGE_BANK из data/bank.js (собирается build.py).
   Прогресс ученика хранится в localStorage этого браузера. */
(function () {
  'use strict';

  // ------------------------------------------------------------ настройки подбора
  const CFG = {
    alphaNum: 0.3,              // как быстро меняется «освоение» номера после ответа
    alphaTopic: 0.35,           // то же для темы внутри номера
    mastered: 0.8,              // порог «освоено»
    minAttemptsMastered: 5,     // …и не меньше стольких ответов по номеру
    weak: 0.5,                  // ниже — «слабо»
    attempts: 2,                // попыток на одно задание
    reviewAfterFail: 3,         // через сколько заданий вернуть тип после ошибки
    reviewAfterHalf: 5,         // …после верного ответа со второй попытки
    reviewIntervalsDays: [1, 3, 7], // затем повторить через 1, 3 и 7 дней
    retryTaskDays: { 0: 2, 0.5: 4 }, // само ошибочное задание вернуть через N дней
    recentWindow: 6,            // не показывать последние N заданий снова
    // актуальность: с какого года действует нынешний тип задания (документы ФИПИ об изменениях КИМ)
    firstKegeYear: 2021,        // первый компьютерный ЕГЭ — более ранние задания другого формата
    formatSince: { 6: 2023, 22: 2023, 13: 2024, 27: 2025 },
    outdatedWeight: 0.3,        // вес ответов на устаревшие задания в прогнозе
    forecast: {                 // прогноз балла ЕГЭ
      lastN: 20,                // сколько последних ответов по номеру учитывать
      recency: 0.9,             // вес каждого более старого ответа (0.9, 0.81, …)
      halfLifeDays: 30,         // через сколько дней вес ответа падает вдвое
      priorMean: 0.4,           // «сомнение» при малом числе ответов: тянет оценку к 40%…
      priorWeight: 1,           // …с силой одного ответа (подобрано на симуляции учеников)
      secondTry: 0.25,          // верно со 2-й попытки: на экзамене подсказки нет, засчитываем четверть
      minAnswers: 10,           // показывать прогноз после стольких ответов
      repeatWeight: 0.35,       // задание уже встречалось (ответ мог быть виден) — говорит о знаниях меньше
      examWeight: 1.5,          // ответ в варианте ЕГЭ — условия как на экзамене, весит больше
      chartDays: 30,            // график прогноза за столько дней
    },
    goal: 20,                   // цель на день по умолчанию (заданий)
  };
  // Правила показа ответа и варианта. В режиме сервера их присылает и соблюдает сервер.
  const RULES = {
    think: 40,                  // открыть ответ можно через столько секунд после показа задания…
    think_hard: 90,             // …у №24–27
    reveal_per_hour: 12,        // показов ответа в час
    attempts: 2,
    exam_sec: (3 * 60 + 55) * 60,
    exam_per_day: 3,
    exam_min_for_answers: 20 * 60,
    authored: true,             // давать ли авторские задания в подборках и вариантах
  };
  const thinkSec = n => (n >= 24 ? RULES.think_hard : RULES.think);
  const DAY = 864e5;
  const STORE = 'egeTrainer.progress.v1';
  const UI_STORE = 'egeTrainer.ui.v1';
  const STUDENT_STORE = 'egeTrainer.student.v1';
  const PREFS_STORE = 'egeTrainer.prefs.v1';
  const EXAM_STORE = 'egeTrainer.exam.v1';
  const REVEAL_STORE = 'egeTrainer.reveals.v1';

  // ------------------------------------------------------------ утилиты
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => Math.round(x * 100);
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function ago(ts) {
    const d = Math.floor((Date.now() - ts) / DAY);
    if (d <= 0) return 'сегодня';
    if (d === 1) return 'вчера';
    return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  }
  function groupBy(arr, fn) {
    const m = new Map();
    for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return m;
  }
  function weightedPick(items, wfn) {
    const ws = items.map(wfn);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (sum <= 0) return items[Math.floor(Math.random() * items.length)];
    let r = Math.random() * sum;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  const fmtClock = sec => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  };
  const fmtWait = sec => (sec >= 90 ? `${Math.ceil(sec / 60)} мин` : fmtClock(sec));

  function toast(msg, ms = 2600) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, ms);
  }

  /** Условие задания приходит из чужих банков: убираем всё, что может выполнить код. */
  const BAD_TAGS = 'script,iframe,object,embed,frame,frameset,link,meta,base,form';
  function safeHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    tpl.content.querySelectorAll(BAD_TAGS).forEach(n => n.remove());
    tpl.content.querySelectorAll('*').forEach(el => {
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') { el.removeAttribute(a.name); continue; }
        if (['href', 'src', 'xlink:href', 'action', 'poster', 'background'].includes(name)
            && /^\s*(javascript|vbscript|data:text\/html)/i.test(a.value.replace(/[\u0000-\u001f\s]+/g, ''))) {
          el.removeAttribute(a.name);
        }
      }
    });
    return tpl.innerHTML;
  }

  // ------------------------------------------------------------ хранилище
  const storage = (() => {
    try { const k = '__egeT'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  })();
  const readJSON = key => { if (!storage) return null; try { return JSON.parse(storage.getItem(key)); } catch (e) { return null; } };
  const writeJSON = (key, v) => { if (!storage) return; try { storage.setItem(key, JSON.stringify(v)); } catch (e) { /* переполнено */ } };
  // Вход ученика: в localStorage на 30 дней с последнего захода; «Чужой компьютер» — только до закрытия браузера
  const TEMP_KEY = 'egeTrainer.temp';
  const LOGIN_DAYS = 30;
  const isTemp = () => { try { return sessionStorage.getItem(TEMP_KEY) === '1'; } catch (e) { return false; } };
  function readStudent() {
    if (isTemp()) { try { return JSON.parse(sessionStorage.getItem(STUDENT_STORE)); } catch (e) { return null; } }
    const s = readJSON(STUDENT_STORE);
    return s && s.at && Date.now() - s.at > LOGIN_DAYS * 864e5 ? null : s;
  }
  function writeStudent(v) {
    const rec = Object.assign({}, v, { at: Date.now() });
    if (isTemp()) { try { sessionStorage.setItem(STUDENT_STORE, JSON.stringify(rec)); } catch (e) { /* нет доступа */ } return; }
    writeJSON(STUDENT_STORE, rec);
  }
  function forgetStudent() {
    try { localStorage.removeItem(STUDENT_STORE); } catch (e) { /* нет доступа */ }
    try { sessionStorage.removeItem(STUDENT_STORE); sessionStorage.removeItem(TEMP_KEY); } catch (e) { /* нет доступа */ }
  }
  const freshProgress = () => ({ v: 1, step: 0, tasks: {}, nums: {}, topics: {}, reviews: {}, log: [] });

  // ------------------------------------------------------------ тема и панель на телефоне
  const THEME_STORE = 'egeTrainer.theme';
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => document.documentElement.dataset.theme || (mqDark.matches ? 'dark' : 'light');
  function applyThemeColor() {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = effectiveTheme() === 'light' ? '#f6f7f9' : '#111113';
  }
  applyThemeColor();
  if (mqDark.addEventListener) mqDark.addEventListener('change', applyThemeColor);
  $('#themeBtn').addEventListener('click', () => {
    const next = effectiveTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    if (storage) try { storage.setItem(THEME_STORE, next); } catch (e) { /* не сохранится */ }
    applyThemeColor();
  });

  const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
  function setSideOpen(open) {
    $('.sidebar').classList.toggle('open', open);
    $('#sideToggle').setAttribute('aria-expanded', String(open));
  }
  $('#sideToggle').addEventListener('click', () => setSideOpen(!$('.sidebar').classList.contains('open')));

  // Свёрнутое меню на компьютере: остаётся узкая полоска со значком, задание получает всю ширину
  const SIDE_MIN_KEY = 'egeTrainer.sideMin';
  function setSideMin(on) {
    document.body.classList.toggle('side-min', on);
    const b = $('#sideMinBtn');
    b.setAttribute('aria-expanded', String(!on));
    b.title = on ? 'Развернуть меню' : 'Свернуть меню — больше места для задания';
    b.setAttribute('aria-label', on ? 'Развернуть меню' : 'Свернуть меню');
    try { localStorage.setItem(SIDE_MIN_KEY, on ? '1' : '0'); } catch (e) { /* нет доступа */ }
  }
  try { if (localStorage.getItem(SIDE_MIN_KEY) === '1') setSideMin(true); } catch (e) { /* нет доступа */ }
  $('#sideMinBtn').addEventListener('click', () => setSideMin(!document.body.classList.contains('side-min')));
  // в свёрнутом виде клик по значку тоже разворачивает
  $('.sidebar .brand-mark').addEventListener('click', () => { if (document.body.classList.contains('side-min')) setSideMin(false); });

  /** Цель в Яндекс Метрике (если счётчик включён в панели учителя). Объявлена до окна входа: оно работает раньше остального. */
  function goal(name) { try { if (window.ym && window.EGE_YM) window.ym(window.EGE_YM, 'reachGoal', name); } catch (e) { /* не мешаем занятию */ } }

  // ------------------------------------------------------------ вход до загрузки заданий
  async function loginRequest(body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Token'] = token;
    if (isTemp()) headers['X-Temp'] = '1';
    const r = await fetch('api/' + (body ? 'login' : 'me'), {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin',
    });
    let data = {};
    try { data = await r.json(); } catch (e) { /* пусто */ }
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
    return data;
  }

  const LAST_NAME_STORE = 'egeTrainer.lastName';
  const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim();

  /**
   * Окно входа: вкладки «Вход» (ФИО + пароль) и «Регистрация» (код + ФИО + пароль).
   * Поля размечены autocomplete — браузер предложит сохранить пароль и потом подставит его.
   * Возвращает ответ сервера после успешного входа.
   */
  function loginDialog(note) {
    return new Promise(resolve => {
      const m = $('#loginModal'), errEl = $('#loginErr');
      const forms = { login: $('#loginForm'), reg: $('#regForm') };
      const tabs = $$('#loginTabs button');
      const setTab = (k, msg, info) => {
        tabs.forEach(b => { b.classList.toggle('on', b.dataset.tab === k); b.setAttribute('aria-selected', String(b.dataset.tab === k)); });
        Object.entries(forms).forEach(([kk, f]) => { f.hidden = kk !== k; });
        errEl.textContent = msg || '';
        errEl.classList.toggle('info', !!info);
        setTimeout(() => {
          const empty = Array.from(forms[k].querySelectorAll('input')).find(i => !i.value);
          (empty || forms[k].querySelector('input')).focus();
        }, 30);
      };
      tabs.forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
      const last = readJSON(LAST_NAME_STORE);
      if (last) $('#loginName').value = last;
      m.hidden = false;
      setTab(last ? 'login' : 'reg', note || '');

      const run = async (form, body) => {
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        errEl.textContent = '';
        try {
          const temp = $('#loginTemp').checked;
          forgetStudent();                               // прежний вход на этом компьютере больше не нужен
          try { if (temp) sessionStorage.setItem(TEMP_KEY, '1'); } catch (e) { /* нет доступа */ }
          const r = await loginRequest(body);
          if (body.mode === 'register') goal('register');
          if (!temp) writeJSON(LAST_NAME_STORE, r.name);
          m.hidden = true;
          ['#loginPass', '#regPass', '#regPass2', '#regCode'].forEach(sel => { $(sel).value = ''; });
          resolve(r);
        } catch (err) {
          if (err.data && err.data.need === 'set_password') {
            $('#regName').value = body.name;
            setTab('reg', `У ученика «${body.name}» ещё нет пароля. Введите код приглашения и придумайте пароль — прогресс и журнал сохранятся.`, true);
          } else {
            errEl.classList.remove('info');
            errEl.textContent = err.status ? err.message : 'Нет связи с сервером. Проверьте адрес и попробуйте ещё раз.';
          }
        } finally {
          btn.disabled = false;
        }
      };
      forms.login.onsubmit = e => {
        e.preventDefault();
        const name = cleanName($('#loginName').value);
        if (name.split(' ').length < 2) { errEl.textContent = 'Введите фамилию и имя через пробел.'; $('#loginName').focus(); return; }
        run(forms.login, { mode: 'login', name, password: $('#loginPass').value });
      };
      forms.reg.onsubmit = e => {
        e.preventDefault();
        const name = cleanName($('#regName').value);
        const pw = $('#regPass').value;
        if (name.split(' ').length < 2) { errEl.textContent = 'Введите фамилию и имя через пробел.'; $('#regName').focus(); return; }
        if (pw.length < 6) { errEl.textContent = 'Пароль — не короче 6 символов.'; $('#regPass').focus(); return; }
        if (pw !== $('#regPass2').value) { errEl.textContent = 'Пароли не совпадают.'; $('#regPass2').select(); return; }
        run(forms.reg, { mode: 'register', code: $('#regCode').value.trim(), name, new_password: pw });
      };
    });
  }

  /** Задания закрыты: сначала вход, потом перезагрузка страницы. */
  async function gate() {
    $('#grid').innerHTML = Array.from({ length: 27 }, (_, i) =>
      `<button class="num-card" disabled><span class="n">${i + 1}</span><span class="c">·</span></button>`).join('');
    const saved = readStudent();
    let tried = null;
    try { tried = sessionStorage.getItem('egeTrainer.relogin'); } catch (e) { /* нет доступа */ }
    if (saved && saved.token && !tried) {
      try {
        await loginRequest(null, saved.token);         // сервер снова поставит cookie
        try { sessionStorage.setItem('egeTrainer.relogin', '1'); } catch (e) { /* нет доступа */ }
        location.reload();
        return;
      } catch (e) { /* токен устарел — войдём заново */ }
    }
    const r = await loginDialog(tried ? 'Браузер не сохранил вход. Разрешите cookie для этого сайта и войдите ещё раз.' : '');
    writeStudent({ sid: r.sid, name: r.name, token: r.token });
    try { sessionStorage.setItem('egeTrainer.relogin', '1'); } catch (e2) { /* нет доступа */ }
    location.reload();
  }

  // ------------------------------------------------------------ данные
  const BANK = window.EGE_BANK;
  const trainerEl = $('#trainer');

  // Сервер не отдал задания: нужен вход (код приглашения + ФИО)
  if (BANK && BANK.locked) {
    gate();
    return;
  }

  if (!BANK || !Array.isArray(BANK.tasks) || !BANK.tasks.length) {
    trainerEl.innerHTML = `
      <div class="empty">
        <h2>Банк заданий не найден</h2>
        <p>Положите папку <code>trainer</code> в <code>Biblio</code> (рядом с <code>ege_bank</code> и <code>kompege_bank</code>) и выполните в ней:</p>
        <pre>python build.py</pre>
        <p>После этого обновите страницу.</p>
      </div>`;
    $('#grid').innerHTML = Array.from({ length: 27 }, (_, i) =>
      `<button class="num-card" disabled><span class="n">${i + 1}</span><span class="c">0</span></button>`).join('');
    return;
  }

  // Режим сервера: сайт открыт через server.py — ответы проверяет сервер, результаты видит учитель
  const SERVER = !!BANK.srv;
  let student = null;                         // { sid, name, token }
  const TASKS = BANK.tasks;
  const byId = new Map(TASKS.map(t => [t.id, t]));
  const BANKS = BANK.banks || [];
  const bankTitle = id => (BANKS.find(b => b.id === id) || {}).title || id;

  // Задания 19–21 про одну игру собраны в одно задание с тремя частями (t.parts)
  const HAS_GROUPS = TASKS.some(t => t.parts);
  const partToGroup = new Map();
  TASKS.forEach(t => (t.parts || []).forEach(p => partToGroup.set(p.id, t.id)));
  const scopeOf = n => (HAS_GROUPS && (n === 20 || n === 21) ? 19 : n);
  const numLabel = n => (HAS_GROUPS && n === 19 ? '19–21' : String(n));
  /** Статистика номера; для 19–21 — средняя по трём номерам. */
  function statsFor(n) {
    if (!(HAS_GROUPS && n === 19)) return P.nums[n];
    const arr = [19, 20, 21].map(k => P.nums[k]).filter(x => x && x.a);
    if (!arr.length) return undefined;
    return { m: arr.reduce((a, x) => a + x.m, 0) / arr.length, a: arr.reduce((a, x) => a + x.a, 0), ok: arr.reduce((a, x) => a + x.ok, 0) };
  }

  const storeKey = () => (student ? `${STORE}.s${student.sid}` : STORE);
  const prefsKey = () => (student ? `${PREFS_STORE}.s${student.sid}` : PREFS_STORE);
  const examKey = () => (student ? `${EXAM_STORE}.s${student.sid}` : EXAM_STORE);
  // избранное, заметки, цель на день — отдельно от прогресса (его в режиме сервера строит журнал)
  const freshPrefs = () => ({ fav: [], notes: {}, goal: CFG.goal });
  function normPrefs(x) {
    const p = Object.assign(freshPrefs(), x && typeof x === 'object' ? x : {});
    if (!Array.isArray(p.fav)) p.fav = [];
    if (!p.notes || typeof p.notes !== 'object') p.notes = {};
    if (!(p.goal >= 0 && p.goal <= 500)) p.goal = CFG.goal;
    return p;
  }
  let prefs = normPrefs(readJSON(PREFS_STORE));
  let prefsDirty = false;
  function savePrefs() {
    writeJSON(prefsKey(), prefs);
    prefsDirty = true;
    scheduleSync();
  }
  const favSet = () => new Set(prefs.fav);
  const validProgress = p => p && p.v === 1 && typeof p.tasks === 'object';
  let P = SERVER ? freshProgress() : readJSON(STORE);
  if (!validProgress(P)) P = freshProgress();
  const ui = Object.assign({ scope: 'all', bank: 'all', period: 'actual', currentId: null }, readJSON(UI_STORE) || {});
  if (ui.bank !== 'all' && !BANKS.some(b => b.id === ui.bank)) ui.bank = 'all';
  const SPECIAL = ['all', 'fav', 'asg'];
  if (!SPECIAL.includes(ui.scope) && !(ui.scope >= 1 && ui.scope <= 27)) ui.scope = 'all';
  if (!SPECIAL.includes(ui.scope)) ui.scope = scopeOf(ui.scope);
  const save = () => { writeJSON(storeKey(), P); writeJSON(UI_STORE, ui); scheduleSync(); };

  // авторские задания (Джобс, /dev/inf, Статград…) учитель может убрать из подборок и вариантов
  const authorOk = t => RULES.authored !== false || !t.au;
  const inBank = t => authorOk(t) && (ui.bank === 'all' || t.bank === ui.bank);
  const formatSince = n => Math.max(CFG.firstKegeYear, CFG.formatSince[n] || 0);
  /** Устаревшее задание: старый тип (по тексту) или год экзамена раньше смены формата. */
  function isOutdated(t) {
    if (t.fmt === 'cur') return false;
    if (t.fmt === 'old') return true;
    return !!t.y && t.y < formatSince(t.n);
  }
  const inPeriod = t => ui.period === 'all' ? true
    : ui.period === 'actual' ? !isOutdated(t)
    : !isOutdated(t) && !!t.y && t.y >= +ui.period;
  const visible = t => inBank(t) && inPeriod(t);
  function pool() {
    if (ui.scope === 'fav') { const f = favSet(); return TASKS.filter(t => f.has(t.id)); }
    if (ui.scope === 'asg') { const a = asgOf(ui.asg); return a ? a.tasks.map(id => byId.get(id)).filter(Boolean) : []; }
    return TASKS.filter(t => visible(t) && (ui.scope === 'all' || t.n === ui.scope));
  }
  const inScope = t => (ui.scope === 'fav' ? favSet().has(t.id)
    : ui.scope === 'asg' ? !!asgOf(ui.asg) && asgOf(ui.asg).tasks.includes(t.id)
    : visible(t) && (ui.scope === 'all' || t.n === ui.scope));
  const topicKey = t => t.n + '|' + (t.topic || '');

  function countByNum() {
    const c = new Array(28).fill(0);
    for (const t of TASKS) if (visible(t)) c[t.n]++;
    return c;
  }
  function level(s) {
    if (!s || !s.a) return 'none';
    if (s.m >= CFG.mastered && s.a >= CFG.minAttemptsMastered) return 'good';
    if (s.m < CFG.weak) return 'weak';
    return 'mid';
  }
  const LEVEL_TEXT = { none: 'не начато', weak: 'слабо', mid: 'в процессе', good: 'освоено' };
  const isDue = (r, now) => (r.dueStep != null && P.step >= r.dueStep) || (r.dueTime != null && now >= r.dueTime);
  const reviewsOf = n => Object.values(P.reviews).filter(r => r.n === n);

  // недавно показанные — чтобы не крутить одно и то же
  const recent = P.log.slice(-CFG.recentWindow).map(x => x.id);
  let lastNum = null;

  // ------------------------------------------------------------ подбор задания
  function targetDifficulty(n) {
    const s = statsFor(n);
    if (!s || !s.a) return 1;
    return s.m < 0.45 ? 1 : s.m < 0.78 ? 2 : 3;
  }

  function numberWeight(n, list, recentSet) {
    const s = statsFor(n);
    let w = !s || !s.a ? 1.1 : 0.12 + 1.8 * Math.pow(1 - s.m, 2);
    if (n === lastNum) w *= 0.35;
    const inNum = list.filter(t => t.n === n);
    if (!inNum.some(t => !P.tasks[t.id])) w *= 0.4;              // новых заданий не осталось
    if (inNum.every(t => recentSet.has(t.id))) w *= 0.02;         // всё только что решали
    return w;
  }

  function topicWeight(k, arr, recentSet) {
    const s = P.topics[k];
    let w = !s || !s.a ? 1 : 0.15 + 1.6 * Math.pow(1 - s.m, 2);
    if (!arr.some(t => !P.tasks[t.id])) w *= 0.3;
    if (arr.every(t => recentSet.has(t.id))) w *= 0.05;
    return w;
  }

  function chooseTask(cands, n) {
    if (!cands.length) return null;
    const now = Date.now();
    const target = targetDifficulty(n);
    let best = null, bestScore = -Infinity;
    for (const t of cands) {
      const s = P.tasks[t.id];
      let sc = Math.random() * 0.6;
      if (!s) sc += 2;                                   // новое — в приоритете
      else {
        sc += Math.min((now - (s.last || 0)) / DAY / 7, 1) * 0.8; // давно не видели
        if (s.ls === 1) sc -= 0.6;                       // уже решено верно
      }
      sc += t.d ? 1 - 0.45 * Math.abs(t.d - target) : 0.7; // сложность под уровень
      sc += t.y ? Math.min(Math.max(t.y - CFG.firstKegeYear, 0), 5) * 0.1 : 0.25; // свежие — чаще
      if (isOutdated(t)) sc -= 0.8;                     // старый формат — только если выбрано «все»
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }

  function pickNext(excludeId) {
    const now = Date.now();
    const list = pool();
    if (!list.length) return null;
    if (ui.scope === 'asg') {               // подборка учителя: по порядку, сначала нерешённые
      const a = asgOf(ui.asg);
      const left = asgLeft(a).filter(id => id !== excludeId).map(id => byId.get(id)).filter(Boolean);
      if (left.length) return { task: left[0], why: { type: 'asg', a } };
      const rest = list.filter(t => t.id !== excludeId);
      return { task: rest.length ? rest[Math.floor(Math.random() * rest.length)] : list[0], why: { type: 'asg', a } };
    }
    const recentSet = new Set(recent.slice(-CFG.recentWindow));
    if (excludeId) recentSet.add(excludeId);
    const fresh = arr => arr.filter(t => !recentSet.has(t.id));
    const nums = new Set(list.map(t => t.n));

    // 1) повторение типа, в котором была ошибка
    const due = Object.values(P.reviews)
      .filter(r => nums.has(r.n) && isDue(r, now))
      .sort((a, b) => (a.stage - b.stage) || ((a.dueStep ?? 1e15) - (b.dueStep ?? 1e15)) || ((a.dueTime ?? 0) - (b.dueTime ?? 0)));
    for (const r of due) {
      let c = fresh(list.filter(t => topicKey(t) === r.key));
      if (!c.length) c = fresh(list.filter(t => t.n === r.n));
      if (!c.length) c = list.filter(t => t.n === r.n && t.id !== excludeId); // в номере мало заданий
      const t = chooseTask(c, r.n);
      if (t) return { task: t, why: { type: 'review', r } };
    }

    // 2) то же самое задание, решённое неверно несколько дней назад
    const retry = fresh(list)
      .filter(t => { const s = P.tasks[t.id]; return s && s.due && s.due <= now; })
      .sort((a, b) => P.tasks[a.id].due - P.tasks[b.id].due);
    if (retry.length) return { task: retry[0], why: { type: 'retry', last: P.tasks[retry[0].id].last } };

    // 3) номер — по слабости (в режиме «Все задания»), тема — по слабости внутри номера
    let n = ui.scope;
    if (n === 'all' || n === 'fav') n = weightedPick([...nums], x => numberWeight(x, list, recentSet));
    const inNum = list.filter(t => t.n === n);
    const groups = groupBy(inNum, topicKey);
    let cands = inNum;
    if (groups.size > 1) {
      const k = weightedPick([...groups.keys()], k => topicWeight(k, groups.get(k), recentSet));
      cands = groups.get(k);
    }
    const t = chooseTask(fresh(cands), n) || chooseTask(fresh(inNum), n)
      || chooseTask(inNum.filter(x => x.id !== excludeId), n) || inNum[0];
    const ns = statsFor(n);
    let type = 'new';
    if (P.tasks[t.id]) type = 'repeat';
    else if (ui.scope === 'all' && ns && ns.a && ns.m < CFG.weak) type = 'weak';
    return { task: t, why: { type } };
  }

  // ------------------------------------------------------------ учёт ответа
  function bump(map, key, score, alpha) {
    const s = map[key] || (map[key] = { m: 0.5, a: 0, ok: 0 });
    s.m += alpha * (score - s.m);
    s.a++;
    if (score === 1) s.ok++;
  }

  /** Статистика одного ответа (для 19–21 — одной части): задание, номер, журнал.
      o.part — доля баллов с 1-й попытки (№26, 27: 0.5 — верна половина), o.exam — ответ в варианте ЕГЭ. */
  function recordStats(t, score, now, o = {}) {
    P.step++;
    const repeat = !!P.tasks[t.id];
    const s = P.tasks[t.id] || (P.tasks[t.id] = { a: 0, c: 0 });
    s.a++;
    if (score === 1) s.c++;
    s.last = now;
    s.ls = score;
    s.due = score === 1 ? null : now + (CFG.retryTaskDays[score] || CFG.retryTaskDays[0]) * DAY;
    bump(P.nums, t.n, score, CFG.alphaNum);
    const e = { id: t.id, n: t.n, s: score, t: now };
    if (o.part != null && o.part !== score) e.p = o.part;
    if (repeat) e.r = 1;
    if (o.exam) e.x = 1;
    if (o.blank) e.b = 1;               // в варианте оставил без ответа: в цель дня не идёт
    P.log.push(e);
    if (P.log.length > 5000) P.log.splice(0, P.log.length - 5000);
  }

  /** Тема и повторение после ошибки. reviewWasDue — было ли повторение «к сроку» в момент показа. */
  function recordReview(t, score, rk, reviewWasDue, now) {
    const k = topicKey(t);
    const r = P.reviews[rk];
    bump(P.topics, k, score, CFG.alphaTopic);
    let note = '';
    if (score < 1) {
      const gap = score === 0 ? CFG.reviewAfterFail : CFG.reviewAfterHalf;
      // повторение по типу этого задания (и заново — по тому, ради которого оно было показано)
      for (const key of new Set([k, rk])) {
        const old = P.reviews[key];
        if (!old && key !== k) continue;
        const src = key === k ? t : old;
        P.reviews[key] = {
          key, n: src.n, topic: key === k ? (t.topic || '') : old.topic, stage: 0,
          fails: (old ? old.fails : 0) + 1, dueStep: P.step + gap, dueTime: null, since: old ? old.since : now,
        };
      }
      const rd = CFG.retryTaskDays[score];
      note = `Похожее задание вернётся через ${gap} ${plural(gap, 'задание', 'задания', 'заданий')}, а это — через ${rd} ${plural(rd, 'день', 'дня', 'дней')}.`;
    } else if (reviewWasDue && r) {
      r.stage++;
      const iv = CFG.reviewIntervalsDays[r.stage - 1];
      if (iv == null) {
        delete P.reviews[rk];
        note = 'Тип задания закреплён и снят с повторения.';
      } else {
        r.dueStep = null;
        r.dueTime = now + iv * DAY;
        note = `Повторение засчитано. Проверим ещё раз через ${iv} ${plural(iv, 'день', 'дня', 'дней')}.`;
      }
    }
    return note;
  }

  /** score: 1 — верно с первой попытки, 0.5 — со второй, 0 — не решено.
      reviewKey — ключ повторения, ради которого показано задание (если было). */
  function record(t, score, reviewKey, o = {}) {
    const now = o.now || Date.now();
    const rk = reviewKey || topicKey(t);
    const r = P.reviews[rk];
    const reviewWasDue = !!(r && isDue(r, now)); // проверяем до того, как счётчик шагов сдвинется
    recordStats(t, score, now, o);
    const note = recordReview(t, score, rk, reviewWasDue, now);
    if (!o.silent) { save(); afterAnswer(); }
    return note;
  }

  /** Итог по заданию 19–21 целиком (части уже записаны через recordStats). */
  function recordGroupEnd(t, scores, rk, revDue, o = {}) {
    const now = o.now || Date.now();
    const sc = scores.length ? Math.min(...scores) : 0;
    const s = P.tasks[t.id] || (P.tasks[t.id] = { a: 0, c: 0 });
    s.a++;
    if (sc === 1) s.c++;
    s.last = now;
    s.ls = sc;
    s.due = sc === 1 ? null : now + CFG.retryTaskDays[sc] * DAY;
    const note = recordReview(t, sc, rk || topicKey(t), revDue, now);
    if (!o.silent) { save(); afterAnswer(); }
    return note;
  }

  /**
   * Прогресс из журнала попыток на сервере: тот же учёт, что и при живых ответах, по порядку.
   * Строка: [id, n, score, ts, reason, rk, part, grp, exam].
   */
  function rebuildFromHistory(rows) {
    P = freshProgress();
    let pend = null, lastDay = null;
    const endGroup = () => {
      if (!pend) return;
      recordGroupEnd(byId.get(pend.g), pend.scores, pend.rk, pend.due, { now: pend.last, silent: true });
      pend = null;
    };
    for (const row of rows) {
      const [id, n, score, ts, , rk, part, grp, exam, blank] = row;
      const day = dayKey(ts);
      if (lastDay && day !== lastDay) { endGroup(); snapshotForecast(lastDay, ts - 1); }
      lastDay = day;
      const t = byId.get(id) || { id, n, topic: '' };   // задание могло пропасть из банка после пересборки
      const sc = score === 1 ? 1 : score === 0.5 ? 0.5 : 0;
      const o = { now: ts, part: part == null ? null : part, exam: !!exam, blank: !!blank, silent: true };
      const g = grp && byId.get(grp);
      if (g && g.parts) {
        if (pend && pend.g !== grp) endGroup();
        if (!pend) {
          const key = rk || topicKey(g), r = P.reviews[key];
          pend = { g: grp, scores: [], rk: key, due: !!(r && isDue(r, ts)), parts: new Set(), last: ts };
        }
        recordStats(t, sc, ts, o);
        pend.scores.push(sc);
        pend.parts.add(id);
        pend.last = ts;
        if (pend.parts.size >= g.parts.length) endGroup();
      } else {
        endGroup();
        record(t, sc, rk || null, o);
      }
    }
    endGroup();
    if (lastDay && lastDay !== dayKey(Date.now())) snapshotForecast(lastDay, Date.now());
  }

  // ------------------------------------------------------------ ответы
  const tokens = s => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е')
    .replace(/[−–—]/g, '-').split(/[\s;|,]+/).filter(Boolean);

  // «13992 или 13993» — несколько допустимых ответов: засчитываем любой
  const alternatives = ans => { const a = String(ans == null ? '' : ans).split(/\s+или\s+/i).filter(x => x.trim()); return a.length ? a : [String(ans == null ? '' : ans)]; };

  function shapeOf(t) {
    if (t.sh) return t.sh;                    // от сервера (ответа в странице нет)
    const ans = alternatives(t.ans)[0];
    const rows = String(ans).split('\n').map(tokens).filter(r => r.length);
    const total = rows.reduce((a, r) => a + r.length, 0);
    if (total <= 1) return { type: 'single' };
    const cols = Math.max(...rows.map(r => r.length));
    let nr = rows.length;
    if (nr >= 3) nr = Math.max(nr, 10); // таблица как в КЕГЭ — не подсказываем число строк
    return { type: 'grid', rows: nr, cols };
  }

  function readAnswerIn(box, shape) {
    if (shape.type === 'single') return tokens(box.querySelector('.inp-single').value);
    const out = [];
    $$('.cell', box).forEach(c => out.push(...tokens(c.value)));
    return out;
  }
  const readAnswer = () => readAnswerIn($('#answerInputs'), cur.shape);

  const sameAnswer = (expected, got) => {
    const a = tokens(expected);
    return a.length === got.length && a.every((x, i) => x === got[i]);
  };

  function answerView(ans) {
    const rows = String(ans).split('\n').map(r => r.trim()).filter(Boolean);
    if (rows.length <= 1 && tokens(ans).length <= 1) return `<span class="right-answer">${esc(ans)}</span>`;
    if (rows.length === 1) return `<span class="right-answer">${esc(rows[0])}</span>`;
    return `<table class="right-answer">${rows.map(r =>
      `<tr>${r.split(/[\s;|]+/).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  // ------------------------------------------------------------ отрисовка задания
  let cur = null; // { task, why, attempt, done, shape }

  const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15l3 3 3-3"/></svg>';

  function reasonHtml(t, why) {
    const topic = t.topic ? ` (тема «${esc(t.topic)}»)` : '';
    switch (why.type) {
      case 'review':
        return why.r.stage === 0
          ? { chip: '<span class="chip review">Повторение</span>',
              line: `Недавно была ошибка в задании <b>№${numLabel(t.n)}</b>${topic}. Закрепляем на похожем задании.` }
          : { chip: `<span class="chip review">Повторение ${why.r.stage}/${CFG.reviewIntervalsDays.length}</span>`,
              line: `Интервальное повторение: проверяем, что тип <b>№${numLabel(t.n)}</b>${topic} не забылся.` };
      case 'retry':
        return { chip: '<span class="chip review">Работа над ошибкой</span>',
          line: `Это задание было решено неверно ${ago(why.last)}. Попробуйте ещё раз.` };
      case 'weak':
        return { chip: '<span class="chip weak">Слабое место</span>',
          line: `Задание <b>№${numLabel(t.n)}</b> пока получается хуже остальных — тренируем его чаще.` };
      case 'repeat':
        return { chip: '<span class="chip">Повтор</span>',
          line: 'Новые задания этого типа закончились — повторяем решённые ранее.' };
      case 'new':
        return { chip: '<span class="chip accent">Новое</span>', line: '' };
      case 'search':
        return { chip: '<span class="chip">Найдено поиском</span>', line: '' };
      case 'asg': {
        const a = why.a;
        if (!a) return { chip: '<span class="chip accent">Задание учителя</span>', line: '' };
        const done = a.tasks.length - asgLeft(a).length;
        return { chip: '<span class="chip accent">Задание учителя</span>',
          line: `Подборка «${esc(a.title)}»: решено <b>${done}</b> из ${a.tasks.length}${a.due ? ` · срок — до ${fmtDay(a.due * 1000)}` : ''}.` };
      }
      case 'history':
        return { chip: '<span class="chip">Повтор из истории</span>',
          line: why.last ? `Вы уже решали это задание ${ago(why.last)}. Попробуйте ещё раз — без подсказок.` : '' };
      default:
        return { chip: '', line: '' };
    }
  }

  function inputsHtml(shape, inGroup) {
    if (shape.type === 'single') {
      return `<input class="inp inp-single"${inGroup ? '' : ' id="ans-single"'} autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${inGroup ? 'Ответ' : 'Ваш ответ'}">`;
    }
    const labels = shape.rows > 1;
    let h = `<div class="grid-inp" style="grid-template-columns:${labels ? 'auto ' : ''}repeat(${shape.cols}, auto)">`;
    for (let r = 0; r < shape.rows; r++) {
      if (labels) h += `<span class="rowlab">${r + 1}</span>`;
      for (let c = 0; c < shape.cols; c++) {
        h += `<input class="inp cell" data-r="${r}" data-c="${c}" autocomplete="off" spellcheck="false">`;
      }
    }
    return h + '</div>';
  }

  function partHint(shape) {
    if (shape.type === 'single') return 'одно значение';
    if (shape.rows === 1) return `${shape.cols} ${plural(shape.cols, 'значение', 'значения', 'значений')} — по одному в ячейку`;
    return 'таблица — строки по порядку';
  }
  function partAnswerHtml(x, i, withNumber) {
    return `<div class="gpart" data-i="${i}">
      <div class="gpart-row">
        ${withNumber ? `<span class="num-badge sm">${x.p.n}</span>` : ''}
        <span class="gpart-label">Ответ${withNumber ? '' : ' на ' + x.p.n}</span>
        <div class="answer-row gpart-inputs">${inputsHtml(x.shape, true)}</div>
        <span class="gpart-hint">${partHint(x.shape)}</span>
      </div>
      <div class="gpart-fb"></div>
    </div>`;
  }

  function answerLabel(shape) {
    if (shape.type === 'single') return 'Ответ';
    if (shape.rows === 1) return `Ответ — ${shape.cols} ${plural(shape.cols, 'значение', 'значения', 'значений')}, по одному в ячейку`;
    return 'Ответ — таблица: заполняйте строки по порядку, лишние оставьте пустыми. Можно вставить сразу весь ответ из буфера.';
  }

  function filesHtml(t) {
    return (t.att || []).length
      ? `<div class="files"><span>Файлы к заданию:</span>${t.att.map(a =>
          `<a class="file" href="${esc(a.href)}" download="${esc(a.name)}" target="_blank" rel="noopener">${FILE_ICON}${esc(a.name)}</a>`).join('')}</div>`
      : '';
  }

  function renderTask() {
    const t = cur.task;
    const meta = [];
    if (t.topic) meta.push(esc(t.topic));
    if (t.lv) meta.push(esc(t.lv));
    if (t.src) meta.push(esc(t.src) + (t.au ? ' (авторское)' : ''));
    else if (BANKS.length > 1) meta.push(esc(bankTitle(t.bank)));
    if (t.y && !(t.src || '').includes(String(t.y))) {
      meta.push(`<span title="${t.dt ? 'Добавлено ' + esc(t.dt.split('-').reverse().join('.')) : 'Год экзамена'}">${t.y} г.</span>`);
    }
    let { chip, line } = reasonHtml(t, cur.why);
    if (isOutdated(t)) {
      const since = formatSince(t.n);
      chip = '<span class="chip weak">Старый формат</span>' + chip;
      const why = t.fmt === 'old' ? 'Это задание старого типа' : `Задание рассчитано на экзамен ${t.y} года`;
      line = `${why}: с ${since} года задание №${t.n} на ЕГЭ ${since === CFG.firstKegeYear ? 'выглядит иначе' : 'другого типа'}. В прогноз балла оно идёт с малым весом.` + (line ? '<br>' + line : '');
    }
    const files = filesHtml(t);
    const fav = favSet().has(t.id);
    const note = prefs.notes[t.id] || '';

    trainerEl.innerHTML = `
      <div class="task-head">
        ${backStack.length ? '<button type="button" class="icon-btn back-btn" id="backBtn" title="Вернуться к предыдущему заданию" aria-label="Предыдущее задание">←</button>' : ''}
        <span class="num-badge">${numLabel(t.n)}</span>
        <div class="task-meta">${meta.join('<span class="sep">·</span>')}</div>
        <span class="head-chips">${chip}</span>
        <span class="task-tools">
          ${PY_BTN}
          <button type="button" class="icon-btn fav-btn${fav ? ' on' : ''}" id="favBtn" aria-pressed="${fav}" title="${fav ? 'Убрать из избранного' : 'В избранное'}">${fav ? '★' : '☆'}</button>
          <button type="button" class="icon-btn note-btn${note ? ' on' : ''}" id="noteBtn" aria-expanded="${!!note}" title="Заметка к заданию">✎<span>Заметка</span></button>
        </span>
      </div>
      ${line ? `<p class="reason">${line}</p>` : ''}
      ${cur.group ? '<div class="gq-list" id="cond"></div>' : `<article class="cond" id="cond">${safeHtml(t.html)}</article>`}
      ${files}
      ${cur.group ? `<div class="answer answer-group">
        <div class="answer-label">На каждый вопрос — две попытки. Проверить можно все сразу или по одному.</div>
        <div class="feedback" id="feedback"></div>
        <div class="actions" id="actions"></div>
      </div>` : `<div class="answer">
        <div class="answer-label">${answerLabel(cur.shape)}</div>
        <div class="answer-row" id="answerInputs">${inputsHtml(cur.shape)}</div>
        <div class="feedback" id="feedback"></div>
        <div class="actions" id="actions"></div>
      </div>`}
      <div class="note-box" id="noteBox"${note ? '' : ' hidden'}>
        <label for="noteText">Заметка к заданию <span>сохраняется сама${SERVER ? ' и видна на любом устройстве' : ''}</span></label>
        <textarea class="inp" id="noteText" maxlength="2000" rows="3" placeholder="Идея решения, где ошиблись, что повторить…">${esc(note)}</textarea>
      </div>`;

    if (cur.group) buildGroupLayout(t);
    dropDuplicateFileLinks($('#cond'), t.att || []);
    decorateCondition($('#cond'), cur.task);
    if (!t.parts && markQuestions($('#cond'), t.n)) {
      const lab = $('.answer-label');
      lab.innerHTML = `<b>Ответ на задание ${t.n}</b>` + (cur.shape.type === 'single' ? '' : ' — ' + esc(answerLabel(cur.shape).replace(/^Ответ — /, '')));
    }
    renderActions();
    bindInputs();
    const first = $('#answerInputs input');
    if (first && window.matchMedia('(min-width: 861px)').matches && !pyOpen()) first.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    pySync();
  }

  /**
   * В банке ЕГЭ задания 19–21 идут одним текстом («Задание 19 … Задание 20 … Задание 21 …»),
   * а ответ ждётся только на вопрос своего номера. Подсвечиваем его, остальные вопросы приглушаем.
   * Возвращает true, если разметка нашлась.
   */
  const Q_MARK = /^\s*Задание\s*№?\s*(19|20|21)(?![\d])/i;
  /**
   * Разбить текст игры на разделы «Задание 19 / 20 / 21».
   * Возвращает { lca, sections: [{ q, nodes, marker }] } или null. q = 0 — общее условие перед заголовком 19.
   */
  function findSections(el) {
    const BLOCK = /^(P|DIV|H[1-6]|LI|SECTION|B|STRONG|SPAN|TD|EM)$/;
    const found = [];
    for (const node of el.querySelectorAll('*')) {
      if (!BLOCK.test(node.tagName)) continue;
      const txt = node.textContent;
      if (txt.length > 4000 || !Q_MARK.test(txt)) continue;
      found.push(node);
    }
    // самые внутренние элементы, с которых начинается «Задание N»
    const marks = found.filter(a => !found.some(b => b !== a && a.contains(b)));
    if (!marks.length) return null;
    const lca = (() => {
      for (let x = marks[0].parentNode; x && x !== el.parentNode; x = x.parentNode) {
        if (marks.every(m => x !== m && x.contains(m))) return x;
      }
      return null;
    })();
    if (!lca) return null;
    const starts = new Map();
    for (const m of marks) {
      let x = m;
      while (x.parentNode && x.parentNode !== lca) x = x.parentNode;
      if (x.parentNode !== lca || starts.has(x)) return null;
      starts.set(x, { q: +m.textContent.match(Q_MARK)[1], marker: m });
    }
    const nums = [...starts.values()].map(v => v.q);
    const sections = [];
    let cur0 = { q: nums.includes(19) ? 0 : 19, nodes: [], marker: null }; // до первого заголовка — условие игры (оно же вопрос 19)
    for (const k of Array.from(lca.childNodes)) {
      if (starts.has(k)) {
        sections.push(cur0);
        cur0 = { q: starts.get(k).q, nodes: [], marker: starts.get(k).marker };
      }
      cur0.nodes.push(k);
    }
    sections.push(cur0);
    return { lca, sections: sections.filter(sec => sec.nodes.some(nd => nd.nodeType === 1 || nd.textContent.trim())) };
  }

  /**
   * Одно задание из общего текста 19–21 (если игры не собраны в одну страницу):
   * подсвечиваем вопрос своего номера, остальные приглушаем.
   */
  function markQuestions(el, n) {
    if (n < 19 || n > 21) return false;
    const r = findSections(el);
    if (!r) return false;
    const nums = r.sections.map(sec => sec.q);
    if (nums.filter(q => q).length < 2 || (!nums.includes(n))) return false;
    for (const sec of r.sections) {
      if (!sec.q) continue;
      const w = document.createElement('div');
      w.className = 'q-section ' + (sec.q === n ? 'q-own' : sec.q === 19 ? 'q-base' : 'q-other');
      w.dataset.q = sec.q;
      r.lca.insertBefore(w, sec.nodes[0]);
      sec.nodes.forEach(x => w.appendChild(x));
      if (sec.q === n) {
        const tag = document.createElement('div');
        tag.className = 'q-tag';
        tag.textContent = `Ваш вопрос — задание ${n}`;
        w.insertBefore(tag, w.firstChild);
      }
    }
    return true;
  }

  /** Страница 19–21: карточка вопроса → под ней поле ответа, и так для каждого номера. */
  function buildGroupLayout(t) {
    const list = $('#cond');
    const tmp = document.createElement('div');
    tmp.innerHTML = safeHtml(t.html);
    const r = findSections(tmp);
    const parts = cur.parts.map((x, i) => ({ x, i, n: x.p.n }));
    const byQ = new Map();
    let preamble = [];
    if (r) {
      for (const sec of r.sections) {
        // заголовок «Задание 20» сам по себе больше не нужен — номер стоит на карточке
        if (sec.marker && /^\s*Задание\s*№?\s*\d+\s*[.:]?\s*$/i.test(sec.marker.textContent)) {
          const parent = sec.marker.parentNode;
          sec.marker.remove();
          if (parent && parent !== r.lca && !parent.textContent.trim() && !parent.querySelector('img,table')) parent.remove();
          sec.nodes = sec.nodes.filter(nd => nd.isConnected || nd.parentNode);
        }
        if (sec.q === 0) preamble = preamble.concat(sec.nodes);
        else byQ.set(sec.q, (byQ.get(sec.q) || []).concat(sec.nodes));
      }
    }
    const card = (label, nodes, i) => {
      const c = document.createElement('article');
      c.className = 'cond gq-card';
      if (i != null) c.dataset.i = i;
      if (label) {
        const h = document.createElement('div');
        h.className = 'gq-num';
        h.innerHTML = `<span class="num-badge sm">${label}</span>`;
        c.appendChild(h);
      }
      nodes.forEach(nd => c.appendChild(nd));
      return c;
    };
    const sectioned = r && parts.every(o => byQ.has(o.n) || (o.n === 19 && preamble.length));
    if (!sectioned) {
      // не удалось разрезать текст — весь текст одной карточкой, поля ответов под ней
      list.appendChild(card('19–21', Array.from(tmp.childNodes)));
      parts.forEach(o => list.insertAdjacentHTML('beforeend', partAnswerHtml(o.x, o.i, true)));
      return;
    }
    const has19 = parts.some(o => o.n === 19);
    if (preamble.length && !has19) list.appendChild(card('', preamble));
    for (const o of parts) {
      const nodes = (o.n === 19 ? preamble : []).concat(byQ.get(o.n) || []);
      list.appendChild(card(String(o.n), nodes, o.i));
      list.insertAdjacentHTML('beforeend', partAnswerHtml(o.x, o.i, false));
    }
  }

  /** «Скачать 9.xlsСкачать 9.ods» в тексте дублирует кнопки файлов под условием — убираем из текста. */
  function dropDuplicateFileLinks(el, att) {
    if (!el || !att.length) return;
    const norm = h => {
      try {
        const path = decodeURIComponent(new URL(h, location.href).pathname);
        const m = path.match(/\/files\/([0-9a-f]+)\//);     // безликая ссылка сервера: сравниваем по коду
        return m ? m[1] : path;
      } catch (e) { return h; }
    };
    const hrefs = new Set(att.map(a => norm(a.href)));
    $$('a[href]', el).forEach(a => {
      if (!hrefs.has(norm(a.getAttribute('href')))) return;
      const parent = a.parentElement;
      a.remove();
      if (parent && parent !== el && !parent.textContent.trim() && !parent.querySelector('img,table')) parent.remove();
    });
  }

  /** Картинка не загрузилась: пробуем исходную ссылку (data-remote), иначе — понятная плашка. */
  function onImageError(img, task) {
    const alt = img.getAttribute('data-remote');
    if (alt && /^https?:/i.test(alt) && img.getAttribute('src') !== alt) { img.src = alt; return; }
    const s = document.createElement('span');
    s.className = 'img-missing';
    s.title = 'Нет файла ' + (img.getAttribute('src') || '');
    s.innerHTML = `<b>Рисунок не загрузился.</b> ${task && task.link
      ? `Он есть в <a href="${esc(task.link)}" target="_blank" rel="noopener">задании на сайте источника</a>.`
      : 'Сообщите учителю.'}`;
    img.replaceWith(s);
  }

  function decorateCondition(el, task) {
    $$('table', el).forEach(tb => {
      if (tb.parentElement && tb.parentElement.classList.contains('table-wrap')) return;
      const w = document.createElement('div');
      w.className = 'table-wrap';
      tb.parentNode.insertBefore(w, tb);
      w.appendChild(tb);
    });
    sideBySide(el);
    $$('img', el).forEach(img => {
      img.addEventListener('click', () => openLightbox(img.currentSrc || img.src));
      img.addEventListener('error', () => onImageError(img, task));
      if (img.complete && !img.naturalWidth && img.getAttribute('src')) onImageError(img, task);   // ошибка случилась раньше
    });
    $$('a', el).forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    renderMath(el);
  }

  /**
   * «На рисунке справа…»: в Яндекс Учебнике таблица и схема лежат в одном блоке, который на их сайте
   * выстроен в строку их стилями. Стили при сборке банка вычищаются, и картинка падает вниз —
   * находим такие блоки (таблица + картинка без текста) и ставим их рядом.
   */
  function sideBySide(el) {
    const onlyImage = n => n.querySelector('img') && !n.querySelector('table')
      && !n.textContent.replace(/[\s\u00a0]+/g, '');
    $$('div, p, td', el).forEach(box => {
      const kids = [...box.children];
      if (kids.length < 2 || kids.length > 3) return;
      const tables = kids.filter(k => k.querySelector('table') && !k.querySelector('img'));
      const imgs = kids.filter(onlyImage);
      if (tables.length !== 1 || !imgs.length || tables.length + imgs.length !== kids.length) return;
      box.classList.add('cond-side');
      tables[0].classList.add('side-table');
      imgs.forEach(k => k.classList.add('side-img'));
      // отступ неразрывными пробелами перед картинкой в исходнике не нужен
      imgs.forEach(k => [...k.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); }));
    });
  }

  function renderMath(el) {
    if (!el || typeof window.renderMathInElement !== 'function') return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* формула останется текстом */ }
  }

  let thinkTimer = null;
  function renderActions() {
    const a = $('#actions');
    if (!a) return;
    clearInterval(thinkTimer);
    if (cur.done) {
      a.innerHTML = `<button class="btn primary" id="nextBtn" type="button">Следующее задание →<kbd>Enter</kbd></button>`;
      $('#nextBtn').addEventListener('click', next);
      setTimeout(() => $('#nextBtn') && $('#nextBtn').focus({ preventScroll: true }), 0);
      return;
    }
    a.innerHTML = `
      <button class="btn primary" id="checkBtn" type="button">Проверить<kbd>Enter</kbd></button>
      <button class="btn" id="giveUpBtn" type="button">Показать ответ</button>
      ${cur.attempt === 0 ? '<button class="btn ghost" id="skipBtn" type="button" title="Пропустить без штрафа">Пропустить →</button>' : ''}`;
    $('#checkBtn').addEventListener('click', check);
    $('#giveUpBtn').addEventListener('click', giveUp);
    const sk = $('#skipBtn');
    if (sk) sk.addEventListener('click', next);
    // «Показать ответ» доступна не сразу: сначала нужно попробовать решить
    const tick = () => {
      const b = $('#giveUpBtn');
      if (!b) { clearInterval(thinkTimer); return; }
      const left = thinkLeft();
      b.disabled = left > 0 || busy;
      b.textContent = left > 0 ? `Показать ответ · ${fmtClock(left)}` : 'Показать ответ';
      b.title = left > 0 ? 'Сначала попробуйте решить — ответ можно будет открыть чуть позже'
        : 'Показать правильный ответ (засчитается как ошибка)';
      if (!left) clearInterval(thinkTimer);
    };
    tick();
    thinkTimer = setInterval(tick, 1000);
  }

  function bindInputs(onEnter) {
    onEnter = onEnter || (() => (cur.done ? next() : check()));
    $$('#trainer .answer-row').forEach(box => {
      const cells = $$('input', box);
      cells.forEach(inp => {
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
          else if (e.key === ' ' && inp.classList.contains('cell')) {
            e.preventDefault();
            const i = cells.indexOf(inp);
            if (cells[i + 1]) cells[i + 1].focus();
          }
        });
        inp.addEventListener('input', () => inp.classList.remove('bad'));
        // вставка сразу всего ответа в таблицу
        if (inp.classList.contains('cell')) {
          inp.addEventListener('paste', e => {
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (!/[\s;|]/.test(text.trim())) return;
            e.preventDefault();
            const r0 = +inp.dataset.r, c0 = +inp.dataset.c;
            text.trim().split(/\r?\n/).forEach((line, i) => {
              line.trim().split(/[\s;|]+/).filter(Boolean).forEach((v, j) => {
                const cell = box.querySelector(`.cell[data-r="${r0 + i}"][data-c="${c0 + j}"]`);
                if (cell) cell.value = v;
              });
            });
          });
        }
      });
    });
  }

  function setFeedback(kind, title, body) {
    const f = $('#feedback');
    f.className = `feedback show ${kind}`;
    f.innerHTML = `<div class="fb-title">${title}</div>${body || ''}`;
  }

  // ---- проверка: на сервере (ответов в странице нет) или локально — по тем же правилам
  let busy = false;

  /** Доля баллов: 1 — верно; у №26, 27 верна ровно одна половина ответа — 0.5 (1 балл из 2). */
  function answerCredit(n, expected, answer, cells) {
    return Math.max(...alternatives(expected).map(alt => credit1(n, alt, answer, cells)));
  }
  function credit1(n, expected, answer, cells) {
    const a = tokens(expected);
    let b = tokens(answer);
    const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    if (a.length && eq(a, b)) return 1;
    if (n < 26 || a.length < 2 || a.length % 2) return 0;
    if (cells && cells.length === a.length) b = cells.map(c => tokens(c)[0] || '');
    if (b.length !== a.length) return 0;
    const h = a.length / 2;
    return ((eq(a.slice(0, h), b.slice(0, h)) ? 1 : 0) + (eq(a.slice(h), b.slice(h)) ? 1 : 0)) / 2;
  }
  const cellsIn = (box, shape) => (shape.type === 'single' ? null : $$('.cell', box).map(c => c.value.trim()));

  // локальный режим (без сервера): попытки, время на раздумье и лимит показов — как на сервере
  const localStates = new Map();
  function localOpen(t) {
    for (const id of t.parts ? t.parts.map(p => p.id) : [t.id]) {
      const st = localStates.get(id);
      if (!st || st.final || st.tries.length) localStates.set(id, { ts: Date.now(), tries: [], final: null });
    }
  }
  function localRevealBlock(obj, st) {
    const wait = Math.ceil((st.ts + thinkSec(obj.n) * 1000 - Date.now()) / 1000);
    if (wait > 0) return { why: 'think', wait };
    const hour = (readJSON(REVEAL_STORE) || []).filter(x => x > Date.now() - 36e5);
    if (hour.length >= RULES.reveal_per_hour) {
      return { why: 'limit', wait: Math.max(1, Math.ceil((hour[hour.length - RULES.reveal_per_hour] + 36e5 - Date.now()) / 1000)) };
    }
    return null;
  }
  function noteLocalReveal() {
    const arr = (readJSON(REVEAL_STORE) || []).filter(x => x > Date.now() - 36e5);
    arr.push(Date.now());
    writeJSON(REVEAL_STORE, arr);
  }
  const withAnswer = (res, obj) => { const r = Object.assign({}, res, { answer: obj.ans, sol: obj.sol }); delete r.hidden; return r; };
  function localCheck(obj, req) {
    let st = localStates.get(obj.id);
    if (!st) { st = { ts: Date.now(), tries: [], final: null }; localStates.set(obj.id, st); }
    if (st.final) return st.final;
    if (req.abandoned) {
      if (!st.tries.length) { localStates.delete(obj.id); return { skipped: true }; }
      return (st.final = { correct: false, final: true, score: 0 });
    }
    if (!req.gave_up) {
      st.tries.push(req.answer);
      const credit = answerCredit(obj.n, obj.ans, req.answer, req.cells);
      if (st.tries.length === 1) st.part = credit;
      if (credit === 1) return (st.final = withAnswer({ correct: true, final: true, score: st.tries.length === 1 ? 1 : 0.5, part: st.part }, obj));
      if (st.tries.length < RULES.attempts) return { correct: false, final: false };
    }
    const block = localRevealBlock(obj, st);
    let res = { correct: false, final: true, score: 0, part: st.tries.length ? st.part : 0 };
    if (block) res.hidden = block;
    else { res = withAnswer(res, obj); noteLocalReveal(); }
    return (st.final = res);
  }
  function localReveal(obj) {
    const st = localStates.get(obj.id);
    if (!st || !st.final) throw Object.assign(new Error('Ответ открывается после попыток'), { status: 409 });
    if (!st.final.hidden) return st.final;
    const block = localRevealBlock(obj, st);
    if (block) return { hidden: block };
    noteLocalReveal();
    return (st.final = withAnswer(st.final, obj));
  }

  /** Задание показано: пошло время на раздумье (сервер считает его сам). */
  function openTask(t) {
    cur.thinkUntil = Date.now() + thinkSec(t.n) * 1000;
    if (!SERVER) { localOpen(t); return; }
    const c = cur;
    api('open', { task: t.id }).then(r => {
      if (cur === c && r && r.think_left != null) cur.thinkUntil = Date.now() + r.think_left * 1000;
    }).catch(() => { /* проверка всё равно пройдёт: сервер начнёт отсчёт с первого ответа */ });
  }
  const thinkLeft = () => (cur && cur.thinkUntil ? Math.max(0, Math.ceil((cur.thinkUntil - Date.now()) / 1000)) : 0);

  function payloadFor(obj, extra) {
    const rk = cur.group ? cur.revKey : (cur.why.type === 'review' ? cur.why.r.key : '');
    return Object.assign({ task: obj.id, reason: cur.why.type, rk, spent_ms: Date.now() - cur.started, away: cur.away || 0 }, extra);
  }
  async function callCheck(obj, extra) {              // может выбросить ошибку сети
    if (!SERVER) return localCheck(obj, extra);
    const res = await api('check', payloadFor(obj, extra));
    if (res && res.game) onGame(res.game);
    return res;
  }
  function netError(e) {
    if (e && e.status === 401) { toast('Нужно войти заново'); logout(); return; }
    toast(e && e.status && e.message ? e.message : 'Нет связи с сервером — ответ не проверен. Попробуйте ещё раз.', 4000);
  }
  function setBusy(on) {
    busy = on;
    $$('#actions .btn').forEach(b => { b.disabled = on || (b.id === 'giveUpBtn' && thinkLeft() > 0); });
  }
  async function verify(extra) {
    setBusy(true);
    try { return await callCheck(cur.task, extra); } catch (e) { netError(e); return null; } finally { setBusy(false); }
  }

  // ---- ответ скрыт: рано (нужно подумать) или исчерпан лимит показов в час
  function hiddenHtml(h) {
    return `<div class="hidden-ans" data-until="${Date.now() + h.wait * 1000}" data-why="${esc(h.why)}">
      <div class="ha-text"></div><button type="button" class="btn ha-btn" disabled>Показать ответ</button></div>`;
  }
  /** Обратный отсчёт и кнопка «Показать ответ»; onShown(res) — когда сервер отдал ответ. */
  function armHidden(root, obj, onShown) {
    const el = root && root.querySelector('.hidden-ans');
    if (!el) return;
    const txt = el.querySelector('.ha-text'), btn = el.querySelector('.ha-btn');
    let iv = null;
    const tick = () => {
      if (!el.isConnected) { clearInterval(iv); return; }
      const left = Math.max(0, Math.ceil((+el.dataset.until - Date.now()) / 1000));
      const limit = el.dataset.why === 'limit';
      if (left) {
        txt.innerHTML = limit
          ? `Ответ пока скрыт: за час уже открыто ${RULES.reveal_per_hour} ответов. Лимит нужен, чтобы задания решались, а не подсматривались. Откроется через <b>${fmtWait(left)}</b>, а задание вернётся на повторение.`
          : `Ответ откроется через <b>${fmtClock(left)}</b>. Попробуйте ещё раз разобраться в условии — так тип задания запомнится лучше.`;
      } else {
        txt.textContent = 'Теперь ответ можно открыть.';
        clearInterval(iv);
      }
      btn.disabled = left > 0;
    };
    iv = setInterval(tick, 1000);
    tick();
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = SERVER ? await api('reveal', { task: obj.id }) : localReveal(obj);
        if (r.hidden) {
          el.dataset.until = Date.now() + r.hidden.wait * 1000;
          el.dataset.why = r.hidden.why;
          clearInterval(iv);
          iv = setInterval(tick, 1000);
          tick();
        } else {
          clearInterval(iv);
          onShown(r, el);
        }
      } catch (e) { netError(e); btn.disabled = false; }
    });
  }

  async function check() {
    if (!cur || cur.done || busy) return;
    if (cur.group) return checkGroup();
    const got = readAnswer();
    if (!got.length) {
      const i = $('#answerInputs input');
      if (i) { i.focus(); i.classList.add('bad'); }
      return;
    }
    const answer = got.join(' ');
    goal('answer');
    const res = await verify({ answer, cells: cellsIn($('#answerInputs'), cur.shape) });
    if (!res || !cur || cur.done) return;
    cur.answers = cur.answers.concat(answer);
    cur.attempt = cur.answers.length;
    if (res.correct) return finish(res.score != null ? res.score : (cur.attempt === 1 ? 1 : 0.5), false, res);
    if (!res.final) {
      $$('#answerInputs input').forEach(i => { if (i.value.trim()) i.classList.add('bad'); });
      setFeedback('retry', 'Неверно',
        `<div class="fb-note">Осталась ещё одна попытка. Перепроверьте решение — ответ можно будет открыть после неё.</div>`);
      renderActions();
      const i = $('#answerInputs input');
      if (i) { i.focus(); i.select && i.select(); }
      return;
    }
    finish(0, false, res);
  }

  async function giveUp() {
    if (!cur || cur.done || busy || thinkLeft() > 0) return;
    if (cur.group) return giveUpGroup();
    const res = await verify({ gave_up: true });
    if (res && cur && !cur.done) finish(0, true, res);
  }

  // ---- задания 19–21: три части на одной странице
  const partBox = i => $(`.gpart[data-i="${i}"]`);

  function partAnswerFill(res) {
    const sol = res.sol;
    return `${answerView(res.answer)}${sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(sol)}</div></details>` : ''}`;
  }

  function partFinal(i, score, res, gaveUp) {
    const x = cur.parts[i], box = partBox(i);
    x.final = true;
    x.score = score;
    x.res = res || {};
    recordStats(x.p, score, Date.now(), { part: x.res.part });
    save();
    $$('input', box).forEach(inp => {
      inp.disabled = true;
      inp.classList.remove('bad');
      if (inp.value.trim()) inp.classList.add(score > 0 ? 'ok' : 'bad');
    });
    box.classList.remove('retry');
    box.classList.add(score > 0 ? 'ok' : 'bad');
    const cardEl = $(`.gq-card[data-i="${i}"]`);
    if (cardEl) { cardEl.classList.remove('retry'); cardEl.classList.add(score > 0 ? 'ok' : 'bad'); }
    let html;
    if (score === 1) html = '<span class="gp-ok">Верно</span>';
    else if (score === 0.5) html = '<span class="gp-ok">Верно со второй попытки</span>';
    else html = `<span class="gp-bad">${gaveUp ? 'Ответ' : 'Неверно. Правильный ответ'}:</span> `;
    if (x.res.hidden) html += hiddenHtml(x.res.hidden);
    else if (score > 0) html += x.res.sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(x.res.sol)}</div></details>` : '';
    else html += partAnswerFill(x.res);
    const fb = box.querySelector('.gpart-fb');
    fb.innerHTML = html;
    $$('.solution .cond', fb).forEach(decorateCondition);
    armHidden(fb, x.p, (r, el) => {
      x.res = r;
      el.outerHTML = partAnswerFill(r);
      $$('.solution .cond', fb).forEach(decorateCondition);
    });
  }

  function partRetry(i) {
    const box = partBox(i);
    box.classList.add('retry');
    const cardEl = $(`.gq-card[data-i="${i}"]`);
    if (cardEl) cardEl.classList.add('retry');
    $$('input', box).forEach(inp => { if (inp.value.trim()) inp.classList.add('bad'); });
    box.querySelector('.gpart-fb').innerHTML = '<span class="gp-retry">Неверно — осталась ещё одна попытка</span>';
  }

  async function runParts(items, extraFor) {
    setBusy(true);
    let results;
    try {
      results = await Promise.allSettled(items.map(o => callCheck(cur.parts[o.i].p, extraFor(o))));
    } finally { setBusy(false); }
    const failed = results.find(r => r.status === 'rejected');
    if (failed) netError(failed.reason);
    return results.map(r => (r.status === 'fulfilled' ? r.value : null));
  }

  async function checkGroup() {
    const todo = cur.parts.map((x, i) => ({ x, i })).filter(o => !o.x.final);
    const filled = todo.map(o => Object.assign(o, { got: readAnswerIn(partBox(o.i), o.x.shape) })).filter(o => o.got.length);
    if (!filled.length) {
      const inp = todo.length && partBox(todo[0].i).querySelector('input');
      if (inp) { inp.focus(); inp.classList.add('bad'); }
      return;
    }
    const results = await runParts(filled, o => ({ answer: o.got.join(' '), cells: cellsIn(partBox(o.i), o.x.shape) }));
    if (!cur || cur.done) return;
    filled.forEach((o, k) => {
      const res = results[k];
      if (!res) return;
      o.x.answers = o.x.answers.concat(o.got.join(' '));
      o.x.attempt = o.x.answers.length;
      if (res.correct) partFinal(o.i, res.score != null ? res.score : (o.x.attempt === 1 ? 1 : 0.5), res);
      else if (res.final) partFinal(o.i, 0, res);
      else partRetry(o.i);
    });
    cur.attempt = cur.parts.reduce((a, x) => a + x.attempt, 0);
    if (cur.parts.every(x => x.final)) return finishGroup();
    renderActions();
    const firstOpen = cur.parts.findIndex(x => !x.final);
    const inp = firstOpen >= 0 && partBox(firstOpen).querySelector('input:not([disabled])');
    if (inp) { inp.focus(); inp.select && inp.select(); }
  }

  async function giveUpGroup() {
    const todo = cur.parts.map((x, i) => ({ x, i })).filter(o => !o.x.final);
    const results = await runParts(todo, () => ({ gave_up: true }));
    if (!cur || cur.done) return;
    todo.forEach((o, k) => { if (results[k]) partFinal(o.i, 0, results[k], true); });
    if (cur.parts.every(x => x.final)) finishGroup();
  }

  function taskLinks(t) {
    const links = [];
    if (t.video && t.video.yt) {
      links.push(`<a href="https://www.youtube.com/watch?v=${encodeURIComponent(t.video.yt)}${t.video.t ? `&t=${encodeURIComponent(t.video.t)}s` : ''}" target="_blank" rel="noopener">Видеоразбор</a>`);
    }
    if (t.link) links.push(`<a href="${esc(t.link)}" target="_blank" rel="noopener">Задание на сайте источника</a>`);
    return links.length ? `<div class="fb-links">${links.join('')}</div>` : '';
  }

  function finishGroup() {
    if (!cur || cur.done) return;
    cur.done = true;
    const t = cur.task;
    const scores = cur.parts.filter(x => x.final).map(x => x.score);
    const note = recordGroupEnd(t, scores, cur.revKey, cur.revDue);
    ui.currentId = null;
    save();
    const ok = scores.filter(x => x > 0).length;
    const anyHidden = cur.parts.some(x => x.res && x.res.hidden);
    const title = ok === scores.length ? `Все ${scores.length} верно!` : `Верно ${ok} из ${scores.length}`;
    const withLinks = cur.parts.map(x => x.res).find(r => r && (r.link || r.video)) || {};
    setFeedback(ok === scores.length ? 'ok' : ok ? 'retry' : 'bad', title,
      `<div class="fb-note">${note}</div>${anyHidden ? '' : taskLinks(SERVER ? withLinks : t)}`);
    renderActions();
    renderSidebar();
    renderTopbar();
  }

  /** Ушёл с задания после неверной попытки — засчитываем ошибку (и сообщаем серверу). */
  function sendAbandon(obj, useBeacon) {
    if (!SERVER) { localCheck(obj, { abandoned: true }); return; }
    if (!student) return;
    const body = payloadFor(obj, { abandoned: true, token: student.token });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('api/check', new Blob([JSON.stringify(body)], { type: 'text/plain' }));
    } else {
      api('check', body).catch(() => {});
    }
  }

  function abandonCurrent(useBeacon) {
    if (!cur || cur.done || cur.attempt === 0) return;
    cur.done = true;
    if (cur.group) {
      const now = Date.now();
      cur.parts.forEach(x => {
        if (x.final || !x.attempt) return;
        x.final = true;
        x.score = 0;
        recordStats(x.p, 0, now);
        sendAbandon(x.p, useBeacon);
      });
      recordGroupEnd(cur.task, cur.parts.filter(x => x.final).map(x => x.score), cur.revKey, cur.revDue);
    } else {
      record(cur.task, 0, cur.why.type === 'review' ? cur.why.r.key : null);
      sendAbandon(cur.task, useBeacon);
    }
    ui.currentId = null;
    save();
  }

  function finish(score, gaveUp, res) {
    if (!cur || cur.done) return;
    cur.done = true;
    const t = cur.task;
    res = res || {};
    const note = record(t, score, cur.why.type === 'review' ? cur.why.r.key : null, { part: res.part });
    ui.currentId = null;
    save();

    $$('#answerInputs input').forEach(i => {
      i.disabled = true;
      i.classList.remove('bad');
      if (i.value.trim()) i.classList.add(score > 0 ? 'ok' : 'bad');
    });

    const solHtml = (sol, tsol) => (sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(sol)}</div></details>` : '')
      + (tsol ? `<details class="solution" open><summary>Решение учителя</summary><pre class="tsol">${esc(tsol)}</pre></details>` : '');
    // ссылку на источник и видеоразбор сервер присылает только вместе с ответом
    const linksOf = r => taskLinks(SERVER ? { link: r.link, video: r.video } : t);
    const extra = res.hidden ? '' : linksOf(res) + solHtml(res.sol, res.tsol);
    const half = res.part === 0.5 && score < 1
      ? '<div class="fb-note">Одно из двух чисел с первой попытки было верным — на экзамене это 1 балл из 2.</div>' : '';

    const streak = currentStreak();
    if (score === 1) {
      setFeedback('ok', 'Верно!',
        `<div class="fb-note">${note || (streak >= 3 ? `Серия: ${streak} ${plural(streak, 'задание', 'задания', 'заданий')} подряд без ошибок.` : '')}</div>${extra}`);
    } else if (score === 0.5) {
      setFeedback('ok', 'Верно со второй попытки', `<div class="fb-note">${note}</div>${half}${extra}`);
    } else {
      const ans = res.hidden ? hiddenHtml(res.hidden) : `<div>${gaveUp ? '' : 'Правильный ответ: '}${answerView(res.answer)}</div>`;
      setFeedback('bad', res.hidden ? (gaveUp ? 'Ответ пока скрыт' : 'Неверно') : gaveUp ? 'Правильный ответ' : 'Неверно',
        `${ans}${half}<div class="fb-note">${note}</div>${extra}`);
      armHidden($('#feedback'), t, (r, el) => {
        el.outerHTML = `<div>Правильный ответ: ${answerView(r.answer)}</div>`;
        const fb = $('#feedback');
        if (fb) {
          fb.insertAdjacentHTML('beforeend', linksOf(r) + solHtml(r.sol, r.tsol));
          $$('.solution .cond', fb).forEach(decorateCondition);
        }
      });
    }
    $$('#feedback .solution .cond').forEach(decorateCondition);
    renderActions();
    renderSidebar();
    renderTopbar();
    asgAfterAnswer();
  }

  function show(pick) {
    if (!pick) {
      cur = null;
      trainerEl.innerHTML = `<div class="empty"><h2>Нет заданий</h2><p>В выбранном разделе нет заданий${ui.bank !== 'all' ? ' этого банка' : ''}${ui.period !== 'all' ? ' за выбранный период' : ''}. Попробуйте другой период в панели слева.</p></div>`;
      renderTopbar();
      return;
    }
    const t0 = pick.task;
    if (cur && cur.task && cur.task.id !== t0.id && !pick.back) {
      backStack.push(cur.task.id);
      if (backStack.length > 50) backStack.shift();
    }
    const revKey = pick.why.type === 'review' ? pick.why.r.key : topicKey(t0);
    const rv = P.reviews[revKey];
    cur = {
      task: t0, why: pick.why, attempt: 0, answers: [], done: false, started: Date.now(),
      revKey, revDue: !!(rv && isDue(rv, Date.now())),
      group: !!t0.parts,
      shape: t0.parts ? null : shapeOf(t0),
      parts: (t0.parts || []).map(p => ({ p, shape: shapeOf(p), answers: [], attempt: 0, final: false, score: null })),
    };
    recent.push(pick.task.id);
    if (recent.length > 50) recent.splice(0, recent.length - 50);
    ui.currentId = pick.task.id;
    save();
    openTask(t0);
    renderTask();
    renderTopbar();
  }

  function next() {
    abandonCurrent();
    if (cur) lastNum = cur.task.n;
    show(pickNext(cur && cur.task.id));
  }

  // ------------------------------------------------------------ прогноз балла ЕГЭ
  // ЕГЭ-2026: задания 1–25 — по 1 первичному баллу, 26 и 27 — по 2, всего 29.
  const EGE = {
    points: n => (n >= 26 ? 2 : 1),
    scale: [0, 7, 14, 20, 27, 34, 40, 43, 46, 48, 51, 54, 56, 59, 62, 64, 67, 70, 72, 75,
      78, 80, 83, 85, 88, 90, 93, 95, 98, 100],
    minScore: 40,     // минимальный балл Рособрнадзора
    admission: 46,    // минимальный балл для поступления в вуз
  };
  const testScore = primary => EGE.scale[Math.min(Math.max(primary, 0), EGE.scale.length - 1)];

  /**
   * Вероятности по номерам на момент now по истории ответов:
   * p — решить целиком с первой попытки; ph — у №26, 27 верна ровно половина ответа (1 балл из 2);
   * exp — ожидаемая доля баллов номера.
   */
  function solveProbs(now = Date.now()) {
    const F = CFG.forecast;
    const perNum = {};
    for (let i = P.log.length - 1; i >= 0; i--) {
      const e = P.log[i];
      if (e.t > now) continue;
      const arr = perNum[e.n] || (perNum[e.n] = []);
      if (arr.length < F.lastN) arr.push(e);
    }
    const res = {};
    for (let n = 1; n <= 27; n++) {
      const arr = perNum[n] || [];
      const st = P.nums[n];
      if (!arr.length) { res[n] = { p: 0, ph: 0, exp: 0, tried: false, a: 0, ok: 0 }; continue; }
      let sw = 0, ss = 0, sh = 0;
      arr.forEach((e, k) => {
        const t = byId.get(e.id);
        const d = t && t.d;
        const val = e.s === 1 ? 1 : e.s === 0.5 ? F.secondTry : 0;
        let w = Math.pow(F.recency, k) * Math.pow(0.5, Math.max(0, now - e.t) / DAY / F.halfLifeDays);
        // верный ответ на сложном задании и ошибка на простом говорят больше
        if (d) w *= val >= 0.5 ? [1, 0.8, 1, 1.25][d] : [1, 1.25, 1, 0.8][d];
        if (t && isOutdated(t)) w *= CFG.outdatedWeight; // старый тип задания мало говорит о нынешнем экзамене
        if (e.r) w *= F.repeatWeight;   // задание уже встречалось — ответ мог запомниться
        if (e.x && !e.b) w *= F.examWeight;   // вариант ЕГЭ: без подсказок и второй попытки
        sw += w;
        ss += w * val;
        if (e.s !== 1 && e.p === 0.5) sh += w;
      });
      const p = (ss + F.priorMean * F.priorWeight) / (sw + F.priorWeight);
      const ph = n >= 26 ? Math.min(sh / (sw + F.priorWeight), 1 - p) : 0;
      res[n] = { p, ph, exp: p + ph / 2, tried: true, a: st ? st.a : arr.length, ok: st ? st.ok : 0 };
    }
    return res;
  }

  /** Распределение первичных баллов → тестовые баллы, диапазон, шансы. */
  function forecast(now = Date.now()) {
    const probs = solveProbs(now);
    let dist = [1];
    for (let n = 1; n <= 27; n++) {
      const { p, ph } = probs[n], pts = EGE.points(n);
      const nd = new Array(dist.length + pts).fill(0);
      dist.forEach((q, k) => {
        nd[k] += q * (1 - p - ph);
        nd[k + pts] += q * p;
        if (ph) nd[k + 1] += q * ph;     // 26, 27: один балл из двух
      });
      dist = nd;
    }
    let exp = 0, primary = 0;
    dist.forEach((q, k) => { exp += q * testScore(k); primary += q * k; });
    const quant = x => {
      let c = 0;
      for (let k = 0; k < dist.length; k++) { c += dist[k]; if (c >= x - 1e-9) return testScore(k); }
      return 100;
    };
    const atLeast = score => dist.reduce((a, q, k) => a + (testScore(k) >= score ? q : 0), 0);
    const covered = Object.values(probs).filter(x => x.tried).length;
    return {
      probs, score: Math.round(exp), primary, lo: quant(0.1), hi: quant(0.9),
      pMin: atLeast(EGE.minScore), pAdm: atLeast(EGE.admission), p80: atLeast(80),
      answers: P.log.filter(e => e.t <= now).length, covered,
    };
  }

  const bandOf = s => (s < EGE.minScore ? 'weak' : s < 60 ? 'mid' : s < 80 ? 'accent' : 'good');
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayTs = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  const dayLabel = k => k.split('-').reverse().slice(0, 2).join('.');

  /** Прогноз на конец дня — для графика (при восстановлении из журнала). */
  function snapshotForecast(day, now) {
    if (P.log.filter(e => e.t <= now).length < CFG.forecast.minAnswers) return;
    if (!P.fc) P.fc = [];
    const s = forecast(now).score;
    const last = P.fc[P.fc.length - 1];
    if (last && last.d === day) last.s = s;
    else P.fc.push({ d: day, s });
    if (P.fc.length > 120) P.fc.splice(0, P.fc.length - 120);
  }

  /** Запоминаем прогноз на сегодня — чтобы показать динамику. */
  let sentForecast = null;
  function rememberForecast(f) {
    if (!P.fc) P.fc = [];
    const k = dayKey(Date.now());
    const last = P.fc[P.fc.length - 1];
    if (!(last && last.d === k && last.s === f.score)) {
      if (last && last.d === k) last.s = f.score;
      else P.fc.push({ d: k, s: f.score });
      if (P.fc.length > 120) P.fc.splice(0, P.fc.length - 120);
      writeJSON(storeKey(), P);
    }
    if (SERVER && f.score !== sentForecast) scheduleSync();
  }
  function weekAgo() {
    if (!P.fc || !P.fc.length) return null;
    const lim = dayKey(Date.now() - 7 * DAY);
    const today = dayKey(Date.now());
    let pick = null;
    for (const x of P.fc) { if (x.d <= lim) pick = x; }
    if (!pick) pick = P.fc.find(x => x.d !== today) || null;
    return pick && pick.d !== today ? pick : null;
  }

  function renderForecast() {
    const el = $('#forecastBtn');
    if (!el) return;
    const F = CFG.forecast;
    if (P.log.length < F.minAnswers) {
      const left = F.minAnswers - P.log.length;
      el.className = 'forecast fc-empty';
      el.innerHTML = `<span class="fc-label">Прогноз ЕГЭ</span>
        <span class="fc-main"><span class="fc-value">—</span></span>
        <span class="fc-range">ещё ${left} ${plural(left, 'задание', 'задания', 'заданий')}</span>`;
      return;
    }
    const f = forecast();
    rememberForecast(f);
    el.className = `forecast band-${bandOf(f.score)}`;
    const prelim = f.covered < 27;
    el.innerHTML = `<span class="fc-label">Прогноз ЕГЭ${prelim ? ' *' : ''}</span>
      <span class="fc-main"><span class="fc-value">${f.score}</span><span class="fc-max">/100</span></span>
      <span class="fc-range">${f.lo}–${f.hi}</span>`;
    el.title = prelim
      ? `Подробнее о прогнозе. * Данные есть по ${f.covered} из 27 номерам — остальные пока считаются нерешёнными.`
      : 'Подробнее о прогнозе';
  }

  /** График прогноза за последние дни: одна линия, порог 40 пунктиром, подсказка при наведении. */
  function forecastChart() {
    const days = CFG.forecast.chartDays;
    const from = dayKey(Date.now() - (days - 1) * DAY);
    const pts = (P.fc || []).filter(x => x.d >= from);
    if (pts.length < 2) {
      return { html: '<p class="fm-note fc-chart-empty">График появится, когда прогноз накопится хотя бы за два дня занятий.</p>', bind() {} };
    }
    const W = 640, H = 170, L = 34, R = 14, T = 12, B = 24;
    const span = (days - 1) * DAY;
    const x = k => L + (dayTs(k) - dayTs(from)) / span * (W - L - R);
    const vals = pts.map(p => p.s);
    const lo = Math.max(0, Math.floor((Math.min(...vals, EGE.minScore) - 5) / 10) * 10);
    const hi = Math.min(100, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const step = hi - lo > 50 ? 20 : 10;
    let grid = '';
    for (let v = lo; v <= hi; v += step) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="fc-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="fc-ax" text-anchor="end">${v}</text>`;
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.s).toFixed(1)}`).join('');
    const area = `${line}L${x(pts[pts.length - 1].d).toFixed(1)},${H - B}L${x(pts[0].d).toFixed(1)},${H - B}Z`;
    const last = pts[pts.length - 1];
    const thr = EGE.minScore >= lo ? `<line x1="${L}" x2="${W - R}" y1="${y(EGE.minScore)}" y2="${y(EGE.minScore)}" class="fc-thr"/>
      <text x="${W - R}" y="${y(EGE.minScore) - 5}" class="fc-ax" text-anchor="end">порог ${EGE.minScore}</text>` : '';
    const label = `Прогноз за ${days} дней: от ${pts[0].s} (${dayLabel(pts[0].d)}) до ${last.s} (${dayLabel(last.d)})`;
    const html = `<div class="fc-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
        ${grid}${thr}
        <path d="${area}" class="fc-area"/><path d="${line}" class="fc-line"/>
        <circle cx="${x(last.d)}" cy="${y(last.s)}" r="4.5" class="fc-dot"/>
        <line class="fc-cross" y1="${T}" y2="${H - B}" x1="0" x2="0" visibility="hidden"/>
        <circle class="fc-hover" r="4.5" cx="0" cy="0" visibility="hidden"/>
        <text x="${L}" y="${H - 6}" class="fc-ax">${dayLabel(from)}</text>
        <text x="${W - R}" y="${H - 6}" class="fc-ax" text-anchor="end">сегодня</text>
        <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="fc-hit"/>
      </svg>
      <div class="fc-tip" hidden></div>
    </div>`;
    const bind = root => {
      const box = root.querySelector('.fc-chart');
      if (!box) return;
      const svg = box.querySelector('svg'), tip = box.querySelector('.fc-tip');
      const cross = svg.querySelector('.fc-cross'), dot = svg.querySelector('.fc-hover');
      const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
      const move = ev => {
        const r = svg.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width * W;
        let best = pts[0];
        for (const p of pts) if (Math.abs(x(p.d) - px) < Math.abs(x(best.d) - px)) best = p;
        const cx = x(best.d), cy = y(best.s);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
        tip.innerHTML = `<b>${best.s}</b> баллов<span>${dayLabel(best.d)}</span>`;
        tip.hidden = false;
        const left = cx / W * r.width;
        tip.style.left = Math.min(Math.max(left, 40), r.width - 40) + 'px';
        tip.style.top = (cy / H * r.height) + 'px';
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerdown', move);
      svg.addEventListener('pointerleave', hide);
    };
    return { html, bind };
  }

  function openForecast() {
    const F = CFG.forecast;
    const box = $('#forecastModal');
    const body = $('#forecastBody');
    if (P.log.length < F.minAnswers) {
      body.innerHTML = `<h2 class="fm-title">Прогноз балла ЕГЭ</h2>
        <p class="fm-note">Прогноз появится после ${F.minAnswers} ответов. Сейчас: ${P.log.length}. Лучше всего начать с режима «Все задания» или с варианта ЕГЭ — так быстрее соберётся картина по всем номерам.</p>`;
      box.hidden = false;
      return;
    }
    const f = forecast();
    const wk = weekAgo();
    const delta = wk ? f.score - wk.s : null;
    const untried = [], weak = [];
    for (let n = 1; n <= 27; n++) {
      const x = f.probs[n];
      if (!x.tried) untried.push(n);
      else if (x.exp < 0.6) weak.push({ n, gain: EGE.points(n) * (1 - x.exp), p: x.exp });
    }
    weak.sort((a, b) => b.gain - a.gain || a.n - b.n);
    const counts = countByNum();
    const chipN = (n, extra) => `<button class="chip num-chip" type="button" data-go="${n}" ${counts[scopeOf(n)] ? '' : 'disabled'}>№${n}${extra || ''}</button>`;
    const pctOr = x => `${pct(x)}%`;
    const chart = forecastChart();

    const rows = Array.from({ length: 27 }, (_, i) => {
      const n = i + 1, x = f.probs[n], pts = EGE.points(n);
      const lvl = !x.tried ? 'none' : x.exp >= 0.8 ? 'good' : x.exp >= 0.5 ? 'mid' : 'weak';
      return `<tr class="lv-${lvl}">
        <td class="fm-n"><button type="button" class="link-btn" data-go="${n}" ${counts[scopeOf(n)] ? '' : 'disabled'}>${n}</button></td>
        <td>${pts}</td>
        <td>${x.tried ? `<span class="fm-bar-cell"><i class="fm-bar"><b style="width:${pct(x.exp)}%"></b></i><span>${pct(x.p)}%${x.ph >= 0.01 ? ` <span class="fm-muted" title="Верна половина ответа — 1 балл из 2">+ ½: ${pct(x.ph)}%</span>` : ''}</span></span>` : '<span class="fm-muted">не решали</span>'}</td>
        <td>${x.tried ? `${x.a} <span class="fm-muted">· верно ${x.ok}</span>` : '—'}</td>
        <td>${(pts * x.p + x.ph).toFixed(2).replace('.', ',')}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="fm-head">
        <div class="fm-score band-${bandOf(f.score)}">
          <span class="fm-big">${f.score}</span>
          <span class="fm-sub">тестовых баллов<br>≈ ${f.primary.toFixed(1).replace('.', ',')} первичных из 29</span>
        </div>
        <div class="fm-facts">
          <div>С вероятностью 80% — <b>от ${f.lo} до ${f.hi}</b></div>
          ${delta != null ? `<div>${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${delta > 0 ? '+' : ''}${delta} с ${dayLabel(wk.d)}</div>` : ''}
          <div class="fm-chips">
            <span class="chip ${f.pMin >= 0.9 ? 'good' : f.pMin >= 0.5 ? 'mid' : 'weak'}">порог ${EGE.minScore}: ${pctOr(f.pMin)}</span>
            <span class="chip ${f.pAdm >= 0.9 ? 'good' : f.pAdm >= 0.5 ? 'mid' : 'weak'}">вуз, ${EGE.admission}+: ${pctOr(f.pAdm)}</span>
            <span class="chip accent">80+: ${pctOr(f.p80)}</span>
          </div>
        </div>
      </div>

      <div class="fm-chart-wrap">
        <div class="fm-h">Прогноз за ${F.chartDays} дней</div>
        ${chart.html}
      </div>

      <p class="fm-note">По ${f.answers} ${plural(f.answers, 'ответу', 'ответам', 'ответам')}, данные есть по ${f.covered} из 27 номеров.
        ${untried.length ? 'Номера, которые ещё не решали, считаются нерешёнными — прогноз вырастет, когда вы их попробуете.' : ''}</p>

      ${untried.length || weak.length ? `<div class="fm-where">
        <div class="fm-h">Где быстрее всего добрать баллы</div>
        ${untried.length ? `<div class="fm-line"><span class="fm-muted">Ещё не решали:</span> ${untried.map(n => chipN(n, EGE.points(n) > 1 ? ' · 2 б.' : '')).join(' ')}</div>` : ''}
        ${weak.length ? `<div class="fm-line"><span class="fm-muted">Слабые места:</span> ${weak.slice(0, 6).map(w => chipN(w.n, ` · ${pct(w.p)}%`)).join(' ')}</div>` : ''}
      </div>` : ''}

      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr><th>№</th><th>Баллов</th><th>Шанс решить</th><th>Ответов</th><th>В прогноз</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <details class="fm-how"><summary>Как считается прогноз</summary>
        <p>Для каждого номера оценивается вероятность решить его на экзамене с первой попытки. Последние ответы весят больше старых, а через месяц без практики вес ответа падает вдвое. Верный ответ на сложном задании и ошибка на простом весят сильнее. Ответ со второй попытки засчитывается на четверть: на экзамене подсказки «неверно» не будет.</p>
        <p>Задание, которое уже встречалось, весит втрое меньше: его ответ мог запомниться. Ответы в варианте ЕГЭ весят в полтора раза больше — это экзаменационные условия. Пока ответов мало, оценка осторожная.</p>
        <p>У заданий 26 и 27 учитывается частичный балл: если с первой попытки верна половина ответа (одно из двух чисел), это 1 балл из 2. Из вероятностей складывается распределение первичных баллов (всего 29), и оно переводится в тестовые по шкале ЕГЭ‑2026. Диапазон покрывает 80% вероятных исходов.</p>
      </details>`;
    chart.bind(body);
    box.hidden = false;
  }

  function closeForecast() { $('#forecastModal').hidden = true; }

  // ------------------------------------------------------------ статистика
  function numStats(n) {
    const s = statsFor(n);
    let solved = 0;
    for (const id in P.tasks) {
      const t = byId.get(id);
      if (t && t.n === n && visible(t) && P.tasks[id].c > 0) solved++;
    }
    return { s, solved, lvl: level(s), acc: s && s.a ? s.ok / s.a : null };
  }

  function currentStreak() {
    let k = 0;
    for (let i = P.log.length - 1; i >= 0 && P.log[i].s === 1; i--) k++;
    return k;
  }

  // ------------------------------------------------------------ цель на день и серия дней
  function dayCounts() {
    const m = new Map();
    for (const e of P.log) { if (e.b) continue; const k = dayKey(e.t); m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }
  /** Сколько заданий нужно решить за день, чтобы огонёк продлился. */
  const fireNeed = () => 3;
  /** Дней подряд с выполненной целью (сегодняшний день ещё может быть не закончен). */
  function dayStreak() {
    const m = dayCounts(), need = fireNeed();
    const d = new Date();
    let s = (m.get(dayKey(d.getTime())) || 0) >= need ? 1 : 0;
    for (;;) {
      d.setDate(d.getDate() - 1);
      if ((m.get(dayKey(d.getTime())) || 0) >= need) s++;
      else break;
    }
    return s;
  }
  /** Самая длинная серия дней за всё время. */
  function bestDayStreak() {
    const need = fireNeed();
    const days = [...dayCounts()].filter(([, c]) => c >= need).map(([k]) => k).sort();
    let best = 0, run = 0, prev = null;
    for (const k of days) {
      const t = new Date(k + 'T12:00').getTime();
      run = prev != null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
      best = Math.max(best, run); prev = t;
    }
    return best;
  }
  const FLAME = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path class="fl-out" d="M12 1.8c.5 3.2 2.6 4.9 4.4 6.9 1.9 2.1 3.3 4.2 3.3 7.1 0 4.3-3.4 7.4-7.7 7.4S4.3 20.1 4.3 15.8c0-2.4 1-4.4 2.6-6 .3 1.6 1 2.8 2.2 3.5-.4-4.5 1-8.5 2.9-11.5z"/><path class="fl-in" d="M12.2 11.6c1.7 1.8 3.4 3.4 3.4 5.7 0 2.2-1.6 3.8-3.6 3.8s-3.6-1.6-3.6-3.8c0-1.2.5-2.2 1.3-3 .2.8.7 1.4 1.3 1.7-.2-1.6.3-3.1 1.2-4.4z"/></svg>';
  function streakMenuHtml(days, todayDone, left) {
    const m = dayCounts(), need = fireNeed();
    const d = new Date(); d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // понедельник этой недели
    const todayK = dayKey(Date.now());
    const week = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => {
      const k = dayKey(d.getTime()); d.setDate(d.getDate() + 1);
      const ok = (m.get(k) || 0) >= need;
      return `<span class="sw-day${ok ? ' ok' : ''}${k === todayK ? ' now' : ''}${k > todayK ? ' future' : ''}"><i>${ok ? FLAME : ''}</i>${w}</span>`;
    }).join('');
    const best = Math.max(bestDayStreak(), days);
    return `<div class="sm-head"><span class="sm-flame${todayDone ? ' on' : ''}">${FLAME}</span>
        <div><div class="sm-num">${days} ${plural(days, 'день', 'дня', 'дней')}</div>
        <div class="sm-sub">${todayDone ? 'Огонёк на сегодня горит — возвращайся завтра!'
          : days ? `Реши сегодня ещё ${left} ${plural(left, 'задание', 'задания', 'заданий')}, иначе серия сгорит`
          : `Реши ${left} ${plural(left, 'задание', 'задания', 'заданий')}, чтобы зажечь огонёк`}</div></div></div>
      <div class="sm-week">${week}</div>
      <div class="sm-foot">Лучшая серия: <b>${best} ${plural(best, 'день', 'дня', 'дней')}</b></div>`;
  }
  let goalToastDay = null, fireDay = null, fireBurst = false;
  /** После каждого засчитанного ответа: поздравить с целью дня, отправить прогноз учителю. */
  function afterAnswer() {
    if (prefs.goal) {
      const today = dayKey(Date.now());
      const c = (dayCounts().get(today) || 0);
      if (c >= prefs.goal && goalToastDay !== today && c - prefs.goal < 3) {
        goalToastDay = today;
        toast('Цель на сегодня выполнена!', 4000);
      }
    }
    const today = dayKey(Date.now());
    if ((dayCounts().get(today) || 0) === fireNeed() && fireDay !== today) {
      fireDay = today; fireBurst = true;
      const st = dayStreak();
      toast(st > 1 ? `Огонёк продлён: ${st} ${plural(st, 'день', 'дня', 'дней')} подряд!` : 'Огонёк зажжён! Возвращайся завтра, чтобы продлить серию', 3500);
    }
    scheduleSync();
  }

  function renderTopbar() {
    const counts = countByNum();
    let h;
    if (examShown && EX) {
      h = examBarHtml();
    } else if (ui.scope === 'all') {
      const total = counts.reduce((a, b) => a + b, 0);
      let solved = 0, a = 0, ok = 0, mastered = 0, present = 0;
      for (const id in P.tasks) { const t = byId.get(id); if (t && visible(t) && P.tasks[id].c > 0) solved++; }
      for (let n = 1; n <= 27; n++) {
        const s = P.nums[n];
        if (s) { a += s.a; ok += s.ok; }
        if (counts[n]) { present++; if (level(statsFor(n)) === 'good') mastered++; }
      }
      const rv = Object.keys(P.reviews).length;
      h = `<span class="scope-title">Все задания</span>
        <span class="scope-stats">${total} в банке · решено ${solved}${a ? ` · точность ${pct(ok / a)}%` : ''}</span>
        <span class="chip good">освоено номеров: ${mastered} из ${present}</span>
        ${rv ? `<span class="chip review">на повторении: ${rv}</span>` : ''}`;
    } else if (ui.scope === 'asg' && asgOf(ui.asg)) {
      const a = asgOf(ui.asg);
      const left = asgLeft(a).length;
      h = `<span class="scope-title">От учителя</span>
        <span class="scope-stats">«${esc(a.title)}» · решено ${a.tasks.length - left} из ${a.tasks.length}</span>
        ${a.due ? `<span class="chip ${a.due * 1000 < Date.now() && left ? 'weak' : ''}">срок до ${fmtDay(a.due * 1000)}</span>` : ''}`;
    } else if (ui.scope === 'fav') {
      const list = pool();
      const solved = list.filter(t => P.tasks[t.id] && P.tasks[t.id].c > 0).length;
      h = `<span class="scope-title">Избранное</span>
        <span class="scope-stats">${list.length} ${plural(list.length, 'задание', 'задания', 'заданий')} · решено ${solved}</span>`;
    } else {
      const n = ui.scope;
      const st = numStats(n);
      const rv = reviewsOf(n).length;
      h = `<span class="scope-title">${HAS_GROUPS && n === 19 ? 'Задания 19–21' : 'Задание ' + n}</span>
        <span class="scope-stats">${counts[n]} в банке · решено ${st.solved}${st.acc != null ? ` · точность ${pct(st.acc)}%` : ''}</span>
        <span class="chip ${st.lvl === 'none' ? '' : st.lvl}">${LEVEL_TEXT[st.lvl]}${st.s && st.s.a ? ` · ${pct(st.s.m)}%` : ''}</span>
        ${rv ? `<span class="chip review">на повторении: ${rv}</span>` : ''}`;
    }
    $('#scopeInfo').innerHTML = h;

    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const today = P.log.filter(x => x.t >= dayStart.getTime() && !x.b);
    const okToday = today.filter(x => x.s === 1).length;
    const lastDots = P.log.slice(-12).map(x => `<i class="s${String(x.s).replace('.', '')}"></i>`).join('');
    const streak = currentStreak();
    const goal = prefs.goal;
    const days = dayStreak();
    const need = fireNeed();
    const todayDone = today.length >= need;
    const left = Math.max(0, need - today.length);
    const menuOpen = $('#streakMenu') && !$('#streakMenu').hidden;
    $('#sessionInfo').innerHTML = `
      <button type="button" class="fire ${todayDone ? 'on' : days ? 'wait' : 'off'}${fireBurst ? ' burst' : ''}" id="streakBtn" aria-haspopup="true"
        title="${todayDone ? 'Огонёк на сегодня горит' : `Реши ещё ${left} ${plural(left, 'задание', 'задания', 'заданий')}, чтобы зажечь огонёк`}">
        ${FLAME}<b>${days}</b>
      </button>
      <div class="streak-menu" id="streakMenu"${menuOpen ? '' : ' hidden'}>${streakMenuHtml(days, todayDone, left)}</div>
      <button type="button" class="goal${goal && today.length >= goal ? ' done' : ''}" id="goalBtn" aria-haspopup="true"
        title="Цель на день — нажмите, чтобы изменить">
        <span class="goal-txt">Сегодня <b>${today.length}</b>${goal ? `<span class="goal-of"> / ${goal}</span>` : ''}${today.length ? ` · верно <b>${okToday}</b>` : ''}${streak >= 2 ? ` · серия <b>${streak}</b>` : ''}</span>
        ${goal ? `<i class="goal-bar"><b style="width:${Math.min(100, pct(today.length / goal))}%"></b></i>` : ''}
      </button>
      ${P.log.length ? `<span class="dots" title="Последние ответы">${lastDots}</span>` : ''}
      <div class="goal-menu" id="goalMenu" hidden>
        <div class="goal-menu-h">Цель на день</div>
        ${[10, 20, 30, 50, 0].map(g => `<button type="button" data-goal="${g}" class="${g === goal ? 'on' : ''}">${g ? `${g} заданий` : 'Без цели'}</button>`).join('')}
      </div>`;
    fireBurst = false;
    renderForecast();
  }

  function renderSidebar() {
    const counts = countByNum();
    const total = counts.reduce((a, b) => a + b, 0);
    $('#allCount').textContent = total;

    // средний уровень по всем номерам
    let sum = 0, present = 0, tried = 0;
    for (let n = 1; n <= 27; n++) {
      if (!counts[n]) continue;
      present++;
      const s = statsFor(n);
      if (s && s.a) { sum += s.m; tried++; }
    }
    const avg = present ? sum / present : 0;
    const all = $('#allCard');
    const inTrainer = !examShown;
    all.className = 'all-card' + (inTrainer && ui.scope === 'all' ? ' on' : '') + (tried ? ` has-progress lvl-${avg >= CFG.mastered ? 'good' : avg >= CFG.weak ? 'mid' : 'weak'}` : '');
    $('#allBar').style.width = tried ? pct(avg) + '%' : '0';
    $('#favCard').classList.toggle('on', inTrainer && ui.scope === 'fav');
    $('#favCount').textContent = prefs.fav.length;
    $('#histCount').textContent = P.log.filter(e => !e.b).length;
    $('#examCard').classList.toggle('on', examShown);
    $('#examSub').textContent = EX ? `идёт · ${fmtClock((EX.deadline - Date.now()) / 1000)}` : '3 ч 55 мин';

    const now = Date.now();
    $('#grid').innerHTML = Array.from({ length: 27 }, (_, i) => {
      const n = i + 1;
      if (HAS_GROUPS && (n === 20 || n === 21)) return '';
      const wide = HAS_GROUPS && n === 19;
      const st = numStats(n);
      const rv = reviewsOf(n);
      const dueNow = rv.some(r => isDue(r, now));
      const cls = ['num-card'];
      if (wide) cls.push('wide');
      if (inTrainer && ui.scope === n) cls.push('on');
      if (st.lvl !== 'none') cls.push('has-progress', 'lvl-' + st.lvl);
      if (dueNow) cls.push('has-review');
      const tip = [`Задание ${numLabel(n)}: ${counts[n]} ${plural(counts[n], 'задание', 'задания', 'заданий')}`,
        LEVEL_TEXT[st.lvl] + (st.s && st.s.a ? ` (${pct(st.s.m)}%)` : ''),
        st.solved ? `решено ${st.solved}` : '',
        st.acc != null ? `точность ${pct(st.acc)}%` : '',
        rv.length ? `на повторении: ${rv.length}` : ''].filter(Boolean).join(' · ');
      return `<button class="${cls.join(' ')}" data-n="${n}" type="button" title="${esc(tip)}" ${counts[n] ? '' : 'disabled'}>
        <span class="n">${numLabel(n)}</span><span class="c">${counts[n]}</span>
        <i class="bar"><b style="width:${st.s && st.s.a ? pct(st.s.m) : 0}%"></b></i><i class="dot"></i></button>`;
    }).join('');

    renderPeriod();
    $('#sideToggleLabel').textContent = examShown ? 'Вариант ЕГЭ' : ui.scope === 'all' ? 'Все задания' : ui.scope === 'fav' ? 'Избранное'
      : ui.scope === 'asg' ? 'От учителя' : `№ ${numLabel(ui.scope)}`;
    const asgOn = inTrainer && ui.scope === 'asg';
    $('#asgCard').classList.toggle('on', asgOn);
    renderAsgCard();
    renderLevel();

    // переключатель банков
    const bEl = $('#banks');
    if (BANKS.length > 1) {
      bEl.hidden = false;
      bEl.innerHTML = [{ id: 'all', title: BANKS.length > 2 ? 'Все' : 'Все банки' }, ...BANKS].map(b =>
        `<button type="button" data-bank="${esc(b.id)}" class="${ui.bank === b.id ? 'on' : ''}">${esc(b.title)}</button>`).join('');
    }
    // в режиме сервера прогресс — это журнал у учителя: сбросить или подменить его из файла нельзя
    $('#importBtn').hidden = SERVER;
    $('#resetBtn').hidden = SERVER;
  }

  /** Из варианта ЕГЭ в тренировку: спросить, ответы варианта сохраняются, время идёт. */
  function leaveExam() {
    if (!examShown) return true;
    if (!confirm('Выйти из варианта? Ответы сохранятся, но время идёт. Вернуться — кнопкой «Вариант ЕГЭ».')) return false;
    saveExamInputs();
    examShown = false;
    cur = null;
    return true;
  }

  function setScope(s, asgId) {
    if (!SPECIAL.includes(s)) s = scopeOf(s);
    if (s === 'asg') {
      if (!asgOf(asgId)) return;
      if (isNarrow()) setSideOpen(false);
      if (!leaveExam()) return;
      ui.scope = 'asg';
      ui.asg = asgId;
      save();
      renderSidebar();
      next();
      return;
    }
    if (s === 'fav' && !prefs.fav.length) {
      toast('В избранном пока пусто: отметьте задание звёздочкой ☆ рядом с номером.', 3500);
      return;
    }
    if (isNarrow()) setSideOpen(false);
    const wasExam = examShown;
    if (!leaveExam()) return;
    if (ui.scope === s && !wasExam) return;
    ui.scope = s;
    save();
    renderSidebar();
    if (!wasExam && cur && !cur.done && inScope(cur.task)) { renderTopbar(); return; }
    next();
  }

  function renderPeriod() {
    const sel = $('#period');
    if (!sel) return;
    const base = TASKS.filter(inBank);
    const cntAll = base.length;
    const actual = base.filter(t => !isOutdated(t));
    const years = [...new Set(actual.map(t => t.y).filter(Boolean))].sort((a, b) => b - a);
    const opts = [['actual', `Актуальные · ${actual.length}`]];
    for (const y of years) {
      if (y <= CFG.firstKegeYear) continue;
      const c = actual.filter(t => t.y && t.y >= y).length;
      opts.push([String(y), `С ${y} г. · ${c}`]);
    }
    opts.push(['all', `Все, со старыми · ${cntAll}`]);
    if (!opts.some(o => o[0] === String(ui.period))) ui.period = 'actual';
    sel.innerHTML = opts.map(([v, l]) => `<option value="${v}" ${String(ui.period) === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  }

  function setPeriod(v) {
    if (String(ui.period) === v) return;
    ui.period = v;
    save();
    renderSidebar();
    if (examShown) return;
    if (cur && !cur.done && inScope(cur.task)) { renderTopbar(); return; }
    next();
  }

  function setBank(b) {
    if (ui.bank === b) return;
    ui.bank = b;
    save();
    renderSidebar();
    if (examShown) return;
    if (cur && !cur.done && inScope(cur.task)) { renderTopbar(); return; }
    next();
  }

  // ------------------------------------------------------------ избранное, заметки, поиск
  function toggleFav(id) {
    const i = prefs.fav.indexOf(id);
    if (i >= 0) prefs.fav.splice(i, 1);
    else { prefs.fav.push(id); if (prefs.fav.length > 2000) prefs.fav.shift(); }
    savePrefs();
    const on = i < 0;
    const b = $('#favBtn');
    if (b) {
      b.classList.toggle('on', on);
      b.textContent = on ? '★' : '☆';
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Убрать из избранного' : 'В избранное';
    }
    toast(on ? 'Добавлено в избранное' : 'Убрано из избранного', 1800);
    renderSidebar();
  }

  let noteTimer = null;
  function saveNote(id, text) {
    text = text.slice(0, 2000);
    if (text.trim()) prefs.notes[id] = text;
    else delete prefs.notes[id];
    savePrefs();
    const b = $('#noteBtn');
    if (b) b.classList.toggle('on', !!text.trim());
  }

  /** Задание по номеру КомпЕГЭ (kompege.ru/task?id=…), коду ФИПИ или id из журнала учителя. */
  function findTask(q) {
    q = String(q || '').trim().replace(/^№\s*/, '').replace(/^.*[?&]id=/, '').toLowerCase();
    if (!q) return null;
    const tail = id => id.slice(id.indexOf(':') + 1).toLowerCase();
    const own = t => [t.id, ...(t.parts || []).map(p => p.id)];
    let hits = TASKS.filter(t => own(t).some(id => id.toLowerCase() === q || tail(id) === q));
    if (!hits.length && q.length >= 4) hits = TASKS.filter(t => own(t).some(id => tail(id).includes(q)));
    hits.sort((a, b) => (b.bank === 'kompege_bank') - (a.bank === 'kompege_bank'));
    return hits[0] || null;
  }

  // ------------------------------------------------------------ история: вернуться к прошлому заданию
  const backStack = [];           // задания, показанные в этот заход, — для кнопки «←»
  let histFilter = 'all', histLimit = 100;
  const pad2 = x => String(x).padStart(2, '0');
  const plainCache = new Map();
  function plainText(t) {
    if (!plainCache.has(t.id)) {
      const tpl = document.createElement('template');      // template не загружает картинки
      tpl.innerHTML = t.html || '';
      plainCache.set(t.id, tpl.content.textContent.replace(/\s+/g, ' ').trim().slice(0, 120));
    }
    return plainCache.get(t.id);
  }

  /** Открыть прошлое задание (из истории или кнопкой «←»), чтобы решить его ещё раз. */
  function openPast(id, back) {
    const gid = partToGroup.get(id) || id;
    const t = byId.get(gid);
    if (!t) { toast('Этого задания больше нет в банке'); return; }
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    if (cur) lastNum = cur.task.n;
    show({ task: t, why: { type: 'history', last: (P.tasks[gid] || {}).last }, back });
    renderSidebar();
  }
  function goBack() {
    while (backStack.length) {
      const id = backStack.pop();
      if (!cur || id !== cur.task.id) { openPast(id, true); return; }
    }
  }

  function histResult(e) {
    if (e.s === 1) return ['good', e.x ? 'верно · вариант' : 'верно'];
    if (e.s === 0.5) return ['mid', 'со 2-й попытки'];
    if (e.b) return ['', 'без ответа · вариант'];
    if (e.p === 0.5) return ['mid', 'верна половина'];
    return ['weak', e.x ? 'ошибка · вариант' : 'ошибка'];
  }

  function openHistory() {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const list = P.log.slice().reverse().filter(e => histFilter === 'all'
      || (histFilter === 'bad' ? e.s < 1 && !e.b : e.t >= dayStart.getTime()));
    const when = ts => { const d = new Date(ts); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
    const rows = list.slice(0, histLimit).map(e => {
      const t = byId.get(partToGroup.get(e.id) || e.id);
      const [cls, txt] = histResult(e);
      return `<div class="hist-row">
        <span class="hist-when">${when(e.t)}</span>
        <span class="num-badge sm">${e.n}</span>
        <span class="hist-snip">${t ? esc(plainText(t)) : '<span class="fm-muted">задание удалено из банка</span>'}</span>
        <span class="chip ${cls}">${txt}</span>
        ${t ? `<button type="button" class="btn hist-open" data-open="${esc(e.id)}">Открыть</button>` : '<span></span>'}
      </div>`;
    }).join('');
    $('#forecastBody').innerHTML = `
      <h2 class="fm-title">История заданий</h2>
      <p class="fm-note">«Открыть» — решить задание ещё раз. Повторное решение засчитывается, но в прогноз балла идёт с меньшим весом: ответ мог запомниться.</p>
      <div class="hist-filters">
        ${[['all', 'Все'], ['bad', 'Ошибки'], ['today', 'Сегодня']].map(([k, l]) =>
          `<button type="button" data-hf="${k}" class="${histFilter === k ? 'on' : ''}">${l}</button>`).join('')}
        <span class="fm-muted">${list.length} ${plural(list.length, 'ответ', 'ответа', 'ответов')}</span>
      </div>
      <div class="hist-list">${rows || '<p class="fm-note">Здесь пока пусто.</p>'}</div>
      ${list.length > histLimit ? '<button type="button" class="btn hist-more" data-hmore>Показать ещё</button>' : ''}`;
    $('#forecastModal').hidden = false;
  }

  // ------------------------------------------------------------ вариант ЕГЭ
  let EX = null;          // идущий вариант: { id, started, deadline, items: [{ id, n }], ans: { id: { answer, cells } }, cur }
  let examShown = false;
  let exTimer = null;

  /** По заданию на каждый номер: актуального формата, по возможности новое для ученика и свежее. */
  function pickVariant() {
    const items = [];
    for (let n = 1; n <= 27; n++) {
      if (HAS_GROUPS && (n === 20 || n === 21)) continue;
      const fits = t => t.n === n && (n !== 19 || !HAS_GROUPS || t.parts) && authorOk(t);
      let cands = TASKS.filter(t => fits(t) && !isOutdated(t));
      if (!cands.length) cands = TASKS.filter(fits);
      if (!cands.length) continue;
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
    const items = pickVariant();
    if (!items.length) { toast('В банке нет заданий для варианта'); return; }
    let id = 'local-' + Date.now(), limit = RULES.exam_sec;
    if (SERVER) {
      try {
        const r = await api('exam/start', {});
        id = r.exam_id;
        limit = r.limit || limit;
      } catch (e) { netError(e); return; }
    }
    abandonCurrent();
    cur = null;
    EX = { id, started: Date.now(), deadline: Date.now() + limit * 1000, items, ans: {}, cur: 0 };
    saveExam();
    closeForecast();
    examShown = true;
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
      <nav class="ex-nav" aria-label="Задания варианта">${nav}</nav>
      <div class="task-head">
        <span class="num-badge">${numLabel(t.n)}</span>
        <div class="task-meta">Вариант ЕГЭ · ${EX.cur + 1} из ${EX.items.length}</div>
        <span class="task-tools">${PY_BTN}</span>
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
    bindInputs(() => { if (!last) exGo(EX.cur + 1); });
    const first = $('#trainer .answer-row input');
    if (first && window.matchMedia('(min-width: 861px)').matches && !pyOpen()) first.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    renderTopbar();
    pySync();
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
      for (const k of examKeys(t)) list.push({ task: k, answer: (EX.ans[k] || {}).answer || '', cells: (EX.ans[k] || {}).cells || null });
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
    try { if (storage) storage.removeItem(examKey()); } catch (e) { /* не страшно */ }
    recordExam(res);
    goal('exam');
    renderExamResult(res, done);
  }

  function quitExam() {
    if (!EX || !confirm('Прервать вариант? Ответы не будут проверены, а вариант засчитается в дневной лимит.')) return;
    clearInterval(exTimer);
    EX = null;
    examShown = false;
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
        <div class="actions"><button type="button" class="btn primary" id="exBack">Продолжить тренировку →</button></div>
      </div>`;
    $('#exBack').addEventListener('click', () => next());
    window.scrollTo({ top: 0 });
    renderSidebar();
    renderTopbar();
  }

  // ------------------------------------------------------------ события
  $('#grid').addEventListener('click', e => {
    const b = e.target.closest('.num-card');
    if (b && !b.disabled) setScope(+b.dataset.n);
  });
  $('#allCard').addEventListener('click', () => setScope('all'));
  $('#favCard').addEventListener('click', () => setScope('fav'));
  $('#examCard').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openExamIntro(); });
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
    if (examShown && EX) {
      const nb = e.target.closest('.ex-nav-btn');
      if (nb) { exGo(+nb.dataset.i); return; }
      if (id === 'exPrev') exGo(EX.cur - 1);
      else if (id === 'exNext') exGo(EX.cur + 1);
      else if (id === 'exFinish') finishExam(false);
      return;
    }
    if (!cur) return;
    if (id === 'backBtn') { goBack(); return; }
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
    const menu = $('#goalMenu'), sm = $('#streakMenu');
    if (e.target.closest('#goalBtn')) { menu.hidden = !menu.hidden; sm.hidden = true; return; }
    if (e.target.closest('#streakBtn')) { sm.hidden = !sm.hidden; menu.hidden = true; return; }
    const g = e.target.closest('button[data-goal]');
    if (g) {
      prefs.goal = +g.dataset.goal;
      savePrefs();
      renderTopbar();
      toast(prefs.goal ? `Цель: ${prefs.goal} заданий в день` : 'Цель на день отключена', 2000);
    }
  });
  document.addEventListener('click', e => {
    const menu = $('#goalMenu');
    if (menu && !menu.hidden && !e.target.closest('#sessionInfo')) menu.hidden = true;
    const sm = $('#streakMenu');
    if (sm && !sm.hidden && !e.target.closest('#sessionInfo')) sm.hidden = true;
  });

  $('#forecastBtn').addEventListener('click', openForecast);
  $('#histCard').addEventListener('click', () => { histFilter = 'all'; histLimit = 100; if (isNarrow()) setSideOpen(false); openHistory(); });
  $('#forecastModal').addEventListener('click', e => {
    const ho = e.target.closest('[data-open]');
    if (ho) { closeForecast(); openPast(ho.dataset.open); return; }
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
    if (e.key !== 'Enter' || !cur || !cur.done) return;
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

  // ------------------------------------------------------------ сервер: вход и синхронизация
  async function api(path, body, method) {
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
    if (me.game) GAME = me.game;
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
    if (student) $('#whoName').textContent = student.name;
  }

  async function askName() {
    const r = await loginDialog();
    applyMe(r);
    await loadHistory();
  }

  // ---- пароль ученика: смена, а у старых учеников без пароля — задать его
  function openPasswordDialog(mustSet) {
    const m = $('#pwModal'), errEl = $('#pwErr');
    $('#pwTitle').textContent = mustSet ? 'Задайте пароль' : 'Сменить пароль';
    $('#pwNote').textContent = mustSet
      ? 'Теперь вход в тренажёр — по ФИО и паролю. Придумайте пароль: с ним вы войдёте с любого устройства, а браузер сможет его запомнить.'
      : 'После смены пароля вход на других устройствах сбросится — там нужно будет войти заново.';
    $('#pwOldField').hidden = !!mustSet;
    $('#pwUser').value = student ? student.name : '';
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



  // ------------------------------------------------------------ Python в браузере
  // Настоящий CPython (Pyodide) в отдельном потоке: math, itertools, functools, ipaddress, re, string, collections…
  // Файлы задания лежат рядом с кодом — open('17.txt') работает. Черепашка для №6 рисует на холсте.
  const PY_BTN = '<button type="button" class="icon-btn py-btn" id="pyBtn" title="Решить на Python прямо здесь">Python</button>';
  const PY = { worker: null, ready: false, running: false, task: null, saveTimer: null };
  const pyOpen = () => !$('#pyDock').hidden;
  const pyTaskNow = () => (examShown && EX ? byId.get((EX.items[EX.cur] || {}).id) : cur && cur.task) || null;
  const codeKey = id => `egeshka.code.${student ? student.sid : 'local'}.${id}`;
  function readCode(id) { try { return localStorage.getItem(codeKey(id)); } catch (e) { return null; } }
  function writeCode(id, code) { try { if (code.trim()) localStorage.setItem(codeKey(id), code); else localStorage.removeItem(codeKey(id)); } catch (e) { /* нет места */ } }
  function pyFilesOf(t) {
    return (t && t.att || []).map(a => ({ name: a.name, url: new URL(a.href, location.href).href }))
      .filter(f => f.url.startsWith(location.origin));       // внешние ссылки браузер не даст прочитать
  }
  function pyStarter(t) {
    const files = pyFilesOf(t).map(f => f.name);
    const txt = files.find(n => /\.(txt|csv|dat)$/i.test(n));
    if (t.n === 6) {
      return "from turtle import *\n\ntracer(0)\nk = 20          # масштаб\nleft(90)        # «смотрит» вверх, как в задании\n\n# команды из условия, например:\n# for i in range(2):\n#     forward(10 * k); right(90); forward(18 * k); right(90)\n\n# точки сетки, чтобы посчитать их внутри фигуры:\n# up()\n# for x in range(-30, 30):\n#     for y in range(-30, 30):\n#         goto(x * k, y * k); dot(3)\n\nupdate()\ndone()\n";
    }
    if (txt) return `with open('${txt}') as f:\n    data = f.read().split()\n\nprint(len(data))\n`;
    return '';
  }
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
    $('#pyTask').textContent = `задание ${numLabel(t.n)}`;
    $('#pyFiles').innerHTML = files.length
      ? 'Файлы рядом с кодом: ' + files.map(f => `<code>open('${esc(f.name)}')</code>`).join(' ')
      : (t.att || []).length ? 'Файлы этого задания лежат на другом сайте — скачайте их кнопкой под условием.' : '';
    $('#pyAttach').textContent = 'Прикрепить решение';
    $('#pyAttach').hidden = !SERVER || !student;
    let code = readCode(t.id);
    if (code == null && SERVER && student) {
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
    $('#pyHl').innerHTML = highlightPy(ta.value) + '\n';
    syncScroll();
  }
  function syncScroll() {
    const ta = $('#pyCode'), hl = $('#pyHl');
    $('#pyGutter').scrollTop = ta.scrollTop;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }

  // подсветка синтаксиса в цветах PyCharm: под прозрачным полем ввода лежит раскрашенная копия текста
  const PY_KW = new Set(('False None True and as assert async await break class continue def del elif else except finally for '
    + 'from global if import in is lambda nonlocal not or pass raise return try while with yield match case').split(' '));
  const PY_BI = new Set(('abs all any ascii bin bool bytes callable chr complex dict dir divmod enumerate eval exec filter float '
    + 'format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max '
    + 'min next object oct open ord pow print range repr reversed round set setattr slice sorted str sum super tuple type vars zip '
    + 'Exception ValueError KeyError IndexError TypeError ZeroDivisionError RecursionError StopIteration NameError').split(' '));
  const PY_TOK = /(#[^\n]*)|((?:[rRbBuUfF]{1,2})?(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))|(@[A-Za-z_][\w.]*)|(\b(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?)\b|\.\d+\b)|([A-Za-z_\u0400-\u04FF][\w\u0400-\u04FF]*)/g;
  function highlightPy(code) {
    let out = '', last = 0, prevWord = '';
    PY_TOK.lastIndex = 0;
    for (let m; (m = PY_TOK.exec(code));) {
      out += esc(code.slice(last, m.index));
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
    return out + esc(code.slice(last));
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
  // редактор: Tab — 4 пробела, Shift+Tab — убрать отступ, Enter — отступ как у строки выше (+4 после «:»)
  function editKey(e) {
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
  $('#pyCode').addEventListener('keydown', editKey);
  $('#pyCode').addEventListener('input', () => {
    updateGutter();
    $('#pyAttach').textContent = 'Прикрепить решение';
    clearTimeout(PY.saveTimer);
    const t = PY.task;
    PY.saveTimer = setTimeout(() => { if (t) writeCode(t.id, $('#pyCode').value); }, 500);
  });
  $('#pyCode').addEventListener('scroll', syncScroll);
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

  // ------------------------------------------------------------ уровни, опыт, достижения
  // Опыт считает сервер по журналу: за первое решение задания (сложнее номер — больше), за дневную пятёрку,
  // за вариант ЕГЭ. Страница только показывает и празднует.
  let GAME = null;
  function renderLevel() {
    const el = $('#lvlCard');
    if (!el) return;
    el.hidden = !SERVER || !GAME;
    if (el.hidden) return;
    $('#lvlNum').textContent = GAME.level;
    $('#lvlTitle').textContent = GAME.title;
    $('#lvlXp').textContent = `${GAME.cur} / ${GAME.need} XP`;
    $('#xpBar').style.width = pct(GAME.cur / GAME.need) + '%';
  }
  function xpPop(v) {
    const b = document.createElement('div');
    b.className = 'xp-pop';
    b.textContent = `+${v} XP`;
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 1500);
  }
  function levelUp(g) {
    const box = document.createElement('div');
    box.className = 'lvlup';
    box.innerHTML = `<div class="lvlup-box"><div class="lvlup-title">LEVEL UP!</div>
      <div class="lvlup-sub">Уровень ${g.level} · ${esc(g.title)}</div></div>`;
    box.addEventListener('click', () => box.remove());
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3200);
  }
  function achToast(a) {
    const t = document.createElement('div');
    t.className = 'ach-toast';
    t.innerHTML = `<span class="ach-icon">${esc(a.icon)}</span><span><small>Новое достижение</small><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></span>`;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 4200);
  }
  function onGame(g) {
    const old = GAME;
    GAME = g;
    renderLevel();
    if (!old) return;
    if (g.xp > old.xp) xpPop(g.xp - old.xp);
    if (g.level > old.level) setTimeout(() => levelUp(g), 900);
    const had = new Set((old.ach || []).filter(a => a.got).map(a => a.id));
    (g.ach || []).filter(a => a.got && !had.has(a.id))
      .forEach((a, i) => setTimeout(() => achToast(a), 1300 + i * 1500));
  }
  async function openGame() {
    if (!GAME) return;
    const g = GAME;
    const got = (g.ach || []).filter(a => a.got).length;
    const ach = (g.ach || []).map(a => `<div class="ach${a.got ? '' : ' locked'}" title="${esc(a.desc)}">
        <span class="ach-icon">${esc(a.icon)}</span>
        <span><b>${esc(a.title)}</b><small>${esc(a.desc)}${a.got ? '' : ` · ${a.have}/${a.goal}`}</small></span></div>`).join('');
    $('#forecastBody').innerHTML = `
      <div class="gm-head"><span class="gm-level">${g.level}</span>
        <div style="flex:1"><h2 class="fm-title" style="margin:0">${esc(g.title)}</h2>
          <i class="xp-bar"><b style="width:${pct(g.cur / g.need)}%"></b></i>
          <span class="fm-muted">${g.cur} / ${g.need} XP до ${g.level + 1}-го уровня · всего ${g.xp} XP · за неделю +${g.week}</span></div></div>
      <p class="fm-note">Опыт даётся за первое решение задания (№1–10 — 10 XP, сложные номера — до 22 XP), повторное — 2 XP,
        вторая попытка — половина. Ещё +15 XP за пять решённых за день и за вариант ЕГЭ — 30 XP и по 3 XP за первичный балл.</p>
      <h3 class="fm-sub">Достижения · ${got} из ${(g.ach || []).length}</h3>
      <div class="ach-grid">${ach}</div>
      <div id="lbBox"></div>`;
    $('#forecastModal').hidden = false;
    try {
      const d = await api('leaderboard');
      if (d.rows && d.rows.length > 1 && $('#lbBox')) {
        $('#lbBox').innerHTML = `<h3 class="fm-sub">Рейтинг класса ${esc(d.class || '')} · опыт за неделю</h3>
          <table class="lb">${d.rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td>
            <td>ур. ${r.level}</td><td class="num">+${r.week} XP</td></tr>`).join('')}</table>`;
      }
    } catch (e) { /* без рейтинга */ }
  }

  // ------------------------------------------------------------ задания от учителя
  let ASG = [];
  const fmtDay = ms => { const d = new Date(ms); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`; };
  function asgOf(id) { return ASG.find(a => a.id === id) || null; }
  /** Нерешённые задания подборки: по данным сервера и по ответам, данным уже на этой странице. */
  function asgLeft(a) {
    if (!a) return [];
    const done = new Set(a.done);
    const since = (a.created || 0) * 1000;
    for (const e of P.log) {
      if (e.s > 0 && e.t >= since && !e.b) { done.add(e.id); const g = partToGroup.get(e.id); if (g) done.add(g); }
    }
    return a.tasks.filter(id => !done.has(id));
  }
  async function loadAssignments() {
    if (!SERVER) return;
    try { ASG = (await api('assignments')).assignments || []; } catch (e) { if (e.status === 401) throw e; ASG = []; }
    renderAsgCard();
  }
  function renderAsgCard() {
    const card = $('#asgCard');
    if (!card) return;
    card.hidden = !ASG.length;
    if (!ASG.length) return;
    const open = ASG.filter(a => asgLeft(a).length);
    const left = open.reduce((s, a) => s + asgLeft(a).length, 0);
    $('#asgSub').textContent = open.length ? `${open.length} ${plural(open.length, 'подборка', 'подборки', 'подборок')} · осталось ${left}` : 'всё решено';
  }
  function openAssignments() {
    const rows = ASG.map(a => {
      const left = asgLeft(a).length, total = a.tasks.length;
      const late = a.due && a.due * 1000 < Date.now() && left;
      return `<div class="asg-row">
        <div><h3>${esc(a.title)}</h3><div class="asg-meta">${total - left} из ${total} решено${a.due ? ` · <span class="${late ? 'chip weak' : ''}">срок до ${fmtDay(a.due * 1000)}</span>` : ''}</div></div>
        <button type="button" class="btn ${left ? 'primary' : ''}" data-asg="${a.id}">${left ? 'Решать' : 'Повторить'}</button>
        <i class="xp-bar"><b style="width:${pct((total - left) / total)}%"></b></i></div>`;
    }).join('');
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Задания от учителя</h2>
      <p class="fm-note">Подборки, которые выдал учитель вашему классу. Учитель видит, сколько заданий решено.</p>
      ${rows || '<p class="fm-note">Пока ничего не задано.</p>'}`;
    $('#forecastModal').hidden = false;
  }
  let asgCelebrated = new Set();
  function asgAfterAnswer() {
    if (ui.scope !== 'asg') return;
    const a = asgOf(ui.asg);
    if (a && !asgLeft(a).length && !asgCelebrated.has(a.id)) {
      asgCelebrated.add(a.id);
      toast(`Подборка «${a.title}» решена полностью!`, 4000);
    }
  }

  // ------------------------------------------------------------ уход со вкладки и снимки экрана
  // Уход со страницы дольше пары секунд, пока открыто задание или вариант, и клавиши снимка экрана
  // записываются — учитель видит это в журнале. Страница при этом ничего не прячет.
  const awayQ = [];
  let awayFrom = 0, awayWarned = false;
  function openTaskId() {
    if (examShown && EX) { const it = EX.items[EX.cur]; return it ? it.id : null; }
    return cur && !cur.done ? cur.task.id : null;
  }
  function goneAway() { if (!awayFrom) awayFrom = Date.now(); }
  function cameBack() {
    if (!awayFrom) return;
    const sec = (Date.now() - awayFrom) / 1000;
    awayFrom = 0;
    const id = openTaskId();
    if (!SERVER || !student || !id || sec < 2) return;
    if (cur && !cur.done && !examShown) cur.away = (cur.away || 0) + 1;
    awayQ.push({ kind: 'away', dur: Math.round(sec), task: id, exam: examShown ? 1 : 0 });
    flushAway();
    if (!awayWarned) {
      awayWarned = true;
      toast('Переход на другую вкладку или программу записывается — учитель видит это в журнале.', 4500);
    }
  }
  function flushAway() {
    if (!awayQ.length || !SERVER || !student) return;
    api('activity', { events: awayQ.splice(0, awayQ.length) }).catch(() => {});
  }
  let shotAt = 0;
  function shotAttempt() {
    if (!SERVER || !student || Date.now() - shotAt < 3000) return;
    shotAt = Date.now();
    awayQ.push({ kind: 'shot', task: openTaskId() || '', exam: examShown ? 1 : 0 });
    flushAway();
  }
  window.addEventListener('blur', goneAway);
  window.addEventListener('focus', cameBack);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') goneAway();
    else if (document.hasFocus()) cameBack();
  });
  document.addEventListener('keydown', e => {
    // Win+Shift+S, Cmd+Shift+3/4/5
    if ((e.metaKey && e.shiftKey) || (e.key === 'Shift' && e.metaKey) || (e.key === 'Meta' && e.shiftKey)) shotAttempt();
  }, true);
  document.addEventListener('keyup', e => { if (e.key === 'PrintScreen') shotAttempt(); }, true);

  $('#lvlCard').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openGame(); });
  $('#asgCard').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openAssignments(); });
  $('#forecastBody').addEventListener('click', e => {
    const b = e.target.closest('[data-asg]');
    if (!b) return;
    $('#forecastModal').hidden = true;
    setScope('asg', +b.dataset.asg);
  });

  // ------------------------------------------------------------ старт
  function start() {
    recent.length = 0;
    recent.push(...P.log.slice(-CFG.recentWindow * 3).map(x => partToGroup.get(x.id) || x.id));
    if (HAS_GROUPS) {                     // повторения по 20 и 21 теперь относятся к заданию 19–21
      for (const r of Object.values(P.reviews)) {
        if (r.n !== 20 && r.n !== 21) continue;
        const key = '19|' + (r.topic || '');
        if (!P.reviews[key]) P.reviews[key] = Object.assign({}, r, { key, n: 19 });
        delete P.reviews[r.key];
      }
    }
    if (ui.scope === 'fav' && !prefs.fav.length) ui.scope = 'all';
    if (ui.scope === 'asg' && !asgOf(ui.asg)) ui.scope = 'all';
    lastNum = null;
    renderWho();
    // незаконченный вариант ЕГЭ (например, после перезагрузки страницы)
    const ex = readJSON(examKey());
    if (ex && Array.isArray(ex.items) && ex.items.length && ex.deadline) {
      EX = Object.assign({ ans: {}, cur: 0 }, ex);
      delete EX.finishing;
      examShown = true;
      renderSidebar();
      startExamTimer();
      if (Date.now() >= EX.deadline) { renderExam(); finishExam(true); return; }
      renderExam();
      return;
    }
    renderSidebar();
    const saved = ui.currentId && byId.get(ui.currentId);
    if (saved && inScope(saved)) {
      const s = P.tasks[saved.id];
      show({ task: saved, why: { type: s ? 'repeat' : 'new' } });
    } else {
      next();
    }
    if (!P.log.length && !tourSeen()) setTimeout(openTour, 400);      // новичку — коротко о том, как всё устроено
  }

  // ------------------------------------------------------------ знакомство с сайтом
  const tourKey = () => `egeshka.tour.v1.${student ? student.sid : 'local'}`;
  function tourSeen() { try { return !!localStorage.getItem(tourKey()); } catch (e) { return true; } }
  function openTour() {
    try { localStorage.setItem(tourKey(), '1'); } catch (e) { /* не страшно */ }
    const items = [
      ['', 'Подбор под тебя', 'Тренажёр следит за точностью по каждому номеру и чаще даёт то, что пока получается хуже. Слабые места — красные полоски на плитках слева.'],
      ['', 'Работа над ошибками', 'Ошибся — через пару заданий придёт похожее, а само задание вернётся через несколько дней. Так тип задания запоминается надолго.'],
      ['', 'Прогноз балла', 'По твоим ответам считается ожидаемый балл ЕГЭ — он вверху слева, клик покажет график по дням.'],
      ['', 'Вариант ЕГЭ', '27 заданий, 3 ч 55 мин, проверка в конце — как на настоящем экзамене. В конце — первичный и тестовый балл.'],
      ['', 'Python прямо здесь', 'Кнопка «Python» рядом с номером: решай кодом, файлы задания открываются через open(), черепашка для №6 рисует на экране.'],
      ['', 'Опыт и достижения', 'За решённые задания и варианты — опыт, уровни, достижения и рейтинг класса за неделю.'],
      ['', 'Сначала подумай', 'На задание две попытки. Ответ можно открыть не сразу — через 40 секунд (у №24–27 — через 90). Учитель видит журнал ответов.'],
    ].filter(([, t]) => SERVER || !/Опыт|Python/.test(t));
    $('#forecastBody').innerHTML = `
      <h2 class="fm-title tour-title">Привет! Это <span class="brand-title"><b>Ege</b>shka</span></h2>
      <p class="fm-note">Тренажёр ЕГЭ по информатике, который подстраивается под тебя. Коротко о главном:</p>
      <div class="tour-grid">${items.map(([, t, d], k) => `<div class="tour-item"><span class="tour-ico" aria-hidden="true">${k + 1}</span>
        <div><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>
      <div class="tour-foot"><button type="button" class="btn primary" id="tourGo">Начать решать</button>
        <span class="fm-muted">Это окно всегда можно открыть снова: «Как работает Egeshka» внизу левой панели.</span></div>`;
    $('#forecastModal').hidden = false;
    setTimeout(() => { const b = $('#tourGo'); if (b) b.focus(); }, 50);
  }
  $('#tourBtn').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openTour(); });
  $('#forecastBody').addEventListener('click', e => { if (e.target.closest('#tourGo')) closeForecast(); });

  async function boot() {
    try { sessionStorage.removeItem('egeTrainer.relogin'); } catch (e) { /* нет доступа */ }
    if (SERVER) {
      const saved = readStudent();
      let ok = false;
      let mustSetPw = false;
      {                                            // записи в браузере нет, но cookie жив — тоже войдём
        student = saved && saved.token ? saved : null;
        // вход только по cookie (новая вкладка на «чужом компьютере»): токен в localStorage не кладём
        if (!student) { try { sessionStorage.setItem(TEMP_KEY, '1'); } catch (e) { /* нет доступа */ } }
        try {
          const me = await api('me');
          applyMe(me);
          mustSetPw = me.has_password === false;      // вошёл раньше, когда пароля ещё не было
          await loadHistory();
          await loadAssignments();
          ok = true;
        } catch (e) {
          if (e.status === 401) {
            student = null;
          } else {                    // сервер временно недоступен — работаем с копией в браузере
            const localP = readJSON(storeKey());
            P = validProgress(localP) ? Object.assign(freshProgress(), localP) : freshProgress();
            prefs = normPrefs(readJSON(prefsKey()));
            ok = true;
          }
        }
      }
      if (!ok) {
        ui.currentId = null;
        await askName();
      }
      window.addEventListener('pagehide', () => { if (examShown) saveExamInputs(); abandonCurrent(true); flushSync(true); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSync(true); });
      $('#logoutBtn').addEventListener('click', () => {
        if (confirm('Выйти? Прогресс сохранён на сервере, войти можно снова по ФИО и паролю.')) logout();
      });
      $('#pwBtn').addEventListener('click', () => openPasswordDialog(false));
      if (mustSetPw) setTimeout(() => openPasswordDialog(true), 400);
    } else {
      window.addEventListener('pagehide', () => { if (examShown) saveExamInputs(); });
    }
    start();
    if (!storage) toast('Браузер запретил сохранение — прогресс не сохранится после закрытия страницы.', 5000);
  }
  boot();
})();
