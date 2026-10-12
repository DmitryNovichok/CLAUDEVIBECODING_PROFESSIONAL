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

  let ADMINS = new Set();                    // аккаунты с плашкой 👑 admin (выдаёт главный учитель)
  const admTag = sid => (sid && ADMINS.has(+sid) ? '<span class="adm-tag" title="Администратор Egeshka">👑 admin</span>' : '');
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
  // 10 тем: 5 тёмных и 5 светлых. Меняются только фон, карточки, рамки и серые оттенки —
  // цветные значки, кольца и кнопки остаются, поэтому подходят ко всем.
  const THEME_STORE = 'egeTrainer.theme';            // 'dark' | 'light' — какой режим включён
  const THEME_PICK = 'egeTrainer.themePick';         // {dark: id, light: id} — выбранная тема каждого режима
  const THEME_CSS = 'egeTrainer.themeCss';           // готовый CSS — его ставит скрипт в <head> до отрисовки
  const tDark = (bg, panel, card, hover, border, strong, text, muted, faint) => ({ bg, panel, card, 'card-hover': hover, border, 'border-strong': strong,
    text, muted, faint, track: border, 'input-bg': card, 'code-bg': panel, 'topbar-bg': bg, ink: border, linked: text, 'overlay-strong': bg + 'f0' });
  const tLight = (bg, panel, card, hover, border, strong, text, muted, faint) => ({ bg, panel, card, 'card-hover': hover, border, 'border-strong': strong,
    text, muted, faint, track: border, 'input-bg': hover, 'code-bg': hover, 'topbar-bg': panel, ink: border, linked: text, 'overlay-strong': panel + 'f0' });
  const THEMES = [
    { id: 'graphite', mode: 'dark', name: 'Графит', from: 'Egeshka', base: true, v: tDark('#16181d', '#1a1d23', '#22262e', '#2a2f38', '#343a45', '#4a5262', '#eef1f6', '#98a2b3', '#687183') },
    { id: 'github-dark', mode: 'dark', name: 'GitHub Dark', from: 'GitHub', v: tDark('#0d1117', '#10151c', '#161b22', '#1c232c', '#30363d', '#454c56', '#e6edf3', '#8d96a0', '#656c76') },
    { id: 'dracula', mode: 'dark', name: 'Dracula', from: 'редакторы кода', v: tDark('#282a36', '#21222c', '#313341', '#3a3d4e', '#44475a', '#5a5e78', '#f8f8f2', '#a9acc8', '#6f749a') },
    { id: 'nord', mode: 'dark', name: 'Nord', from: 'Linux и редакторы', v: tDark('#2e3440', '#2a303b', '#3b4252', '#434c5e', '#4c566a', '#5f6a82', '#eceff4', '#a7b1c4', '#737e94') },
    { id: 'mocha', mode: 'dark', name: 'Catppuccin Mocha', from: 'Catppuccin', v: tDark('#1e1e2e', '#181825', '#272738', '#313244', '#3d3e52', '#585b70', '#cdd6f4', '#a6adc8', '#6c7086') },
    { id: 'paper', mode: 'light', name: 'Бумага', from: 'Egeshka', base: true, v: tLight('#f5f2eb', '#fbf9f4', '#fffdf8', '#f7f3ea', '#e6dfd0', '#d3c9b5', '#2c2923', '#7a7264', '#aaa292') },
    { id: 'github-light', mode: 'light', name: 'GitHub Light', from: 'GitHub', v: tLight('#f6f8fa', '#ffffff', '#ffffff', '#f3f5f8', '#d0d7de', '#b6bfc8', '#1f2328', '#59636e', '#8c959f') },
    { id: 'macos', mode: 'light', name: 'macOS', from: 'Apple', v: tLight('#f5f5f7', '#fbfbfd', '#ffffff', '#f2f2f5', '#d9d9de', '#c4c4ca', '#1d1d1f', '#6e6e73', '#a1a1a6') },
    { id: 'solarized', mode: 'light', name: 'Solarized Light', from: 'редакторы кода', v: tLight('#fdf6e3', '#f8f0da', '#fffbee', '#f5edd6', '#e4dbc2', '#d3c7a8', '#073642', '#586e75', '#93a1a1') },
    { id: 'latte', mode: 'light', name: 'Catppuccin Latte', from: 'Catppuccin', v: tLight('#eff1f5', '#e6e9ef', '#f8f9fb', '#e9ecf2', '#ccd0da', '#bcc0cc', '#4c4f69', '#6c6f85', '#9ca0b0') },
  ];
  THEMES.forEach(t => { t.bg = t.v.bg; t.card = t.v.card; });
  // настройки вида: размер текста, яркость, контраст, акцент, анимации, режим «Фокус»
  const VIEW_STORE = 'egeTrainer.view';
  const VIEW_DEF = { size: 1, bright: 0, contrast: false, accent: 'blue', anim: true, focus: false };
  const SIZES = [['S', 0.9], ['M', 1], ['L', 1.1], ['XL', 1.2]];
  // акцент: основной, светлый (текст на тёмном), тёмный (текст на светлом)
  const ACCENTS = { blue: ['Синий', '#1cb0f6', '#49c0f8', '#1899d6'], purple: ['Фиолетовый', '#a560e8', '#bd88f0', '#8a43cf'],
    teal: ['Бирюзовый', '#14b8a6', '#3fd0bf', '#0f8f84'], pink: ['Розовый', '#ec4899', '#f472b6', '#cf2f7c'], orange: ['Оранжевый', '#ff9600', '#ffad33', '#d97a00'] };
  const viewPrefs = () => Object.assign({}, VIEW_DEF, readJSON(VIEW_STORE) || {});
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + hexRgb(a).map((x, i) => Math.round(x + (hexRgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
  const rgba = (h, a) => `rgba(${hexRgb(h).join(', ')}, ${a})`;
  /** Переменные темы с учётом яркости, контраста и акцента. */
  function themeVars(t, vp) {
    const v = Object.assign({}, t.v), dark = t.mode === 'dark';
    if (vp.bright) {
      const to = vp.bright > 0 ? '#ffffff' : '#000000', k = Math.abs(vp.bright) * (dark ? 0.045 : 0.03);
      for (const key of ['bg', 'panel', 'card', 'card-hover', 'border', 'border-strong', 'track', 'input-bg', 'code-bg', 'topbar-bg', 'ink']) v[key] = mix(v[key], to, k);
    }
    if (vp.contrast) {
      v.text = mix(v.text, dark ? '#ffffff' : '#000000', 0.6);
      v.muted = mix(v.muted, v.text, 0.4);
      v.faint = mix(v.faint, v.muted, 0.45);
      v.border = mix(v.border, v.text, 0.22);
      v['border-strong'] = mix(v['border-strong'], v.text, 0.3);
    }
    v['overlay-strong'] = (dark ? v.bg : v.panel) + 'f0';
    if (vp.accent !== 'blue' && ACCENTS[vp.accent]) {
      const [, a, lt, dk] = ACCENTS[vp.accent], txt = dark ? lt : dk;
      Object.assign(v, { accent: a, 'accent-strong': dark ? lt : dk, 'accent-soft': rgba(a, dark ? 0.18 : 0.14), 'accent-text': txt, link: txt,
        sel: dark ? rgba(a, 0.16) : mix(v.card, a, 0.14), 'sel-border': dark ? a : mix(a, '#ffffff', 0.35), 'sel-text': txt });
    }
    return v;
  }
  function applyView() {
    const vp = viewPrefs();
    const b = document.body;
    if (!b) return;
    const z = (SIZES[vp.size] || SIZES[1])[1];
    b.style.setProperty('--ui-zoom', z);
    b.style.setProperty('--ui-zoom-side', 1 + (z - 1) / 2);    // меню узкое — увеличиваем вдвое слабее
    b.classList.toggle('no-anim', !vp.anim);
    b.classList.toggle('focus-mode', !!vp.focus);
  }
  function setView(key, val) {
    const vp = viewPrefs();
    vp[key] = val;
    writeJSON(VIEW_STORE, vp);
    applyTheme(effectiveTheme());
    applyView();
  }
  const mqDark = window.matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => document.documentElement.dataset.theme || (mqDark.matches ? 'dark' : 'light');
  function themePick() {
    const p = readJSON(THEME_PICK) || {};
    return { dark: THEMES.some(t => t.id === p.dark) ? p.dark : 'graphite', light: THEMES.some(t => t.id === p.light) ? p.light : 'paper' };
  }
  const curTheme = () => THEMES.find(t => t.id === themePick()[effectiveTheme()]);
  function applyThemeColor() {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = curTheme().bg;
  }
  /** Ставит режим и выбранные темы. CSS сохраняем — его подхватит скрипт в <head> при следующем открытии. */
  function applyTheme(mode) {
    const pick = themePick();
    if (mode) document.documentElement.dataset.theme = mode;
    const vp = viewPrefs();
    const plain = !vp.bright && !vp.contrast && vp.accent === 'blue';
    const css = ['dark', 'light'].map(m => {
      const t = THEMES.find(x => x.id === pick[m]);
      if (!t || (t.base && plain)) return '';      // встроенная тема без настроек — хватает style.css
      return `:root:root[data-theme="${m}"]{${Object.entries(themeVars(t, vp)).map(([k, v]) => `--${k}:${v}`).join(';')}}`;
    }).join('');
    let st = document.getElementById('themeVars');
    if (!st) { st = document.createElement('style'); st.id = 'themeVars'; document.head.appendChild(st); }
    st.textContent = css;
    if (storage) try {
      if (mode) storage.setItem(THEME_STORE, mode);
      storage.setItem(THEME_CSS, css);
    } catch (e) { /* не сохранится */ }
    applyThemeColor();
  }
  function setThemePick(id) {
    const t = THEMES.find(x => x.id === id);
    if (!t) return;
    const pick = themePick();
    pick[t.mode] = id;
    writeJSON(THEME_PICK, pick);
    applyTheme(t.mode);
  }
  applyTheme(document.documentElement.dataset.theme || null);
  applyView();
  if (mqDark.addEventListener) mqDark.addEventListener('change', applyThemeColor);
  // кнопка ☀/☾ — между выбранной тёмной и выбранной светлой
  $('#themeBtn').addEventListener('click', () => applyTheme(effectiveTheme() === 'light' ? 'dark' : 'light'));
  function themeCard(t, on) {
    return `<button type="button" class="th-card${on ? ' on' : ''}" data-theme-id="${t.id}" style="--tb:${t.bg};--tc:${t.card};--tt:${t.v.text};--tm:${t.v.muted};--tr:${t.v.border}">
        <span class="th-prev"><span class="th-side"><i></i><i></i><i></i></span><span class="th-main"><b></b><span class="th-box"><i></i><i></i><em></em></span></span></span>
        <span class="th-name"><b>${esc(t.name)}</b><small>${esc(t.from)}</small></span></button>`;
  }
  function openThemes() {
    const pick = themePick(), mode = effectiveTheme();
    const sec = (m, title) => `<div class="fm-h">${title}</div><div class="th-grid">${THEMES.filter(t => t.mode === m)
      .map(t => themeCard(t, pick[m] === t.id && mode === m)).join('')}</div>`;
    const vp = viewPrefs();
    const tog = (key, title, sub) => `<label class="vw-row"><span><b>${title}</b><small>${sub}</small></span>
      <input type="checkbox" class="vw-switch" data-view="${key}"${vp[key] ? ' checked' : ''}></label>`;
    $('#forecastBody').innerHTML = `<h2 class="fm-title">🎨 Тема оформления</h2>
      <p class="fm-note">Кнопка ☀ в меню переключает между выбранной тёмной и выбранной светлой темой.</p>
      ${sec('dark', 'Тёмные')}${sec('light', 'Светлые')}
      <div class="fm-h">Вид</div>
      <div class="vw">
        <div class="vw-row"><span><b>Размер текста</b><small>условия, ответы и меню</small></span>
          <span class="vw-seg">${SIZES.map(([n], i) => `<button type="button" data-view-size="${i}" class="${vp.size === i ? 'on' : ''}">${n}</button>`).join('')}</span></div>
        <div class="vw-row"><span><b>Яркость фона</b><small>${vp.bright ? (vp.bright > 0 ? 'светлее' : 'темнее') + ' на ' + Math.abs(vp.bright) : 'как в теме'}</small></span>
          <span class="vw-range"><small>темнее</small><input type="range" min="-3" max="3" step="1" value="${vp.bright}" data-view-bright><small>светлее</small></span></div>
        <div class="vw-row"><span><b>Акцентный цвет</b><small>выделение, ссылки, выбранный номер</small></span>
          <span class="vw-acc">${Object.entries(ACCENTS).map(([id, [n, c]]) => `<button type="button" title="${n}" data-view-accent="${id}" class="${vp.accent === id ? 'on' : ''}" style="--sw:${c}"></button>`).join('')}</span></div>
        ${tog('contrast', 'Повышенная контрастность', 'текст темнее или ярче, рамки чётче — для слабых экранов и проектора')}
        ${tog('anim', 'Анимации', 'огонёк, всплывающий опыт, плавные переходы')}
        ${tog('focus', 'Режим «Фокус»', 'скрыть рейтинг, огонёк, уровень, цель дня, дуэли — только задания и прогноз')}
        <button type="button" class="link-btn vw-reset" data-view-reset>Сбросить вид</button>
      </div>`;
    $('#forecastModal').hidden = false;
  }

  const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
  function setSideOpen(open) {
    $('.sidebar').classList.toggle('open', open);
    $('#sideToggle').setAttribute('aria-expanded', String(open));
  }
  $('#sideToggle').addEventListener('click', () => setSideOpen(!$('.sidebar').classList.contains('open')));

  // Свёрнутое меню на компьютере: остаётся узкая полоска со значком, задание получает всю ширину
  const SIDE_MIN_KEY = 'egeTrainer.sideMin';
  // Сворачивает и разворачивает банк номеров синяя кнопка «Все задания» в полоске слева
  function setSideMin(on) {
    document.body.classList.toggle('side-min', on);
    const b = $('#allCard');
    if (b) {
      b.setAttribute('aria-expanded', String(!on));
      b.title = on ? 'Показать банк заданий' : 'Скрыть банк заданий — больше места для задания';
    }
    try { localStorage.setItem(SIDE_MIN_KEY, on ? '1' : '0'); } catch (e) { /* нет доступа */ }
  }
  try { if (localStorage.getItem(SIDE_MIN_KEY) === '1') setSideMin(true); } catch (e) { /* нет доступа */ }
  // ?. — страница могла остаться от прошлой версии сайта (index.html не обновили): не падаем
  $('#sideMinBtn')?.addEventListener('click', () => setSideMin(!document.body.classList.contains('side-min')));
  // в свёрнутом виде клик по значку тоже разворачивает
  $('.sidebar .brand-mark')?.addEventListener('click', () => { if (document.body.classList.contains('side-min')) setSideMin(false); });

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
          const temp = !!($('#loginTemp') && $('#loginTemp').checked);
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
  // «Тема» для подбора и повторения — тип задания внутри номера (кластер c считает сервер по тексту условия),
  // у банков без кластеров — тема из банка
  const topicKey = t => t.n + '|' + (t.c || t.topic || '');
  const CLUSTERS = (BANK && BANK.clusters) || {};
  /** Название типа задания: «Двоичная запись» и т.п. */
  function clusterName(t) {
    const list = CLUSTERS[t.n] || [];
    const hit = list.find(x => x[0] === t.c);
    return hit ? hit[1] : (t.topic || '');
  }
  const RANK_WORD = ['', 'очень лёгкое', 'лёгкое', 'среднее', 'сложное', 'очень сложное'];

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
  /** Сложность 1–5, которую сейчас стоит давать в этом типе задания: по успехам в типе, а если их мало — в номере.
   *  Начинаем с лёгких; решаешь уверенно — сложность растёт, ошибаешься — опускается. */
  function targetRank(n, key) {
    const k = key && P.topics[key];
    const s = k && k.a >= 2 ? k : statsFor(n);
    if (!s || !s.a) return 2;
    return s.m < 0.4 ? 2 : s.m < 0.65 ? 3 : s.m < 0.85 ? 4 : 5;
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
    const rankOf = new Map();                          // целевая сложность — своя для каждого типа задания
    const want = t => { const k = topicKey(t); if (!rankOf.has(k)) rankOf.set(k, targetRank(n, k)); return rankOf.get(k); };
    let best = null, bestScore = -Infinity;
    for (const t of cands) {
      const s = P.tasks[t.id];
      let sc = Math.random() * 0.6;
      if (!s) sc += 2;                                   // новое — в приоритете
      else {
        sc += Math.min((now - (s.last || 0)) / DAY / 7, 1) * 0.8; // давно не видели
        if (s.ls === 1) sc -= 0.6;                       // уже решено верно
      }
      sc += t.r ? 1.1 - 0.4 * Math.abs(t.r - want(t))     // сложность 1–5 под уровень в этом типе
        : t.d ? 1 - 0.45 * Math.abs(t.d - target) : 0.7;
      sc += t.y ? Math.min(Math.max(t.y - CFG.firstKegeYear, 0), 5) * 0.1 : 0.25; // свежие — чаще
      if (isOutdated(t)) sc -= 0.8;                     // старый формат — только если выбрано «все»
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }

  /** Следующее задание; в выбранном номере — только задания этого номера, что бы ни подсказал подбор. */
  function pickNext(excludeId) {
    const r = pickNextRaw(excludeId);
    if (!r || ui.scope === 'asg' || ui.scope === 'all' || inScope(r.task)) return r;
    const list = pool().filter(t => t.id !== excludeId);
    return list.length ? { task: chooseTask(list, ui.scope) || list[0], why: { type: 'new' } } : r;
  }
  function pickNextRaw(excludeId) {
    const now = Date.now();
    const list = pool();
    if (!list.length) return null;
    if (ui.scope === 'asg') {               // подборка учителя: по порядку, сначала нерешённые
      const a = asgOf(ui.asg);
      // следующее нерешённое ПОСЛЕ текущего по порядку подборки (по кругу): иначе «Пропустить»
      // возвращало бы первое нерешённое, и два задания сменяли бы друг друга без конца
      const leftSet = new Set(asgLeft(a));
      const at = excludeId ? a.tasks.indexOf(excludeId) : -1;
      const order = at >= 0 ? a.tasks.slice(at + 1).concat(a.tasks.slice(0, at)) : a.tasks;
      const left = order.filter(id => id !== excludeId && leftSet.has(id)).map(id => byId.get(id)).filter(Boolean);
      if (left.length) return { task: left[0], why: { type: 'asg', a } };
      if (a.strict) return null;            // самостоятельная: всё сдано — экран «Завершить»
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
    // уже решённое задание решают снова: в огонёк, цель дня и серию не идёт (так же считает сервер)
    // уже решённое или с показанным ответом: в огонёк, цель дня и серию не идёт (так же считает сервер)
    const again = o.skip != null ? o.skip
      : !!(P.tasks[t.id] && P.tasks[t.id].c > 0) && !o.exam && !o.asg && RULES.repeat_since != null && now >= RULES.repeat_since;
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
    if (again) e.ra = 1;
    if (o.asg) e.k = 1;                 // ответ из самостоятельной учителя
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
      const [id, n, score, ts, reason, rk, part, grp, exam, blank, skip] = row;
      const day = dayKey(ts);
      if (lastDay && day !== lastDay) { endGroup(); snapshotForecast(lastDay, ts - 1); }
      lastDay = day;
      const t = byId.get(id) || { id, n, topic: '' };   // задание могло пропасть из банка после пересборки
      const sc = score === 1 ? 1 : score === 0.5 ? 0.5 : 0;
      const o = { now: ts, part: part == null ? null : part, exam: !!exam, blank: !!blank, silent: true, asg: reason === 'asg' || reason === 'work', skip: !!skip };
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
    const topic = clusterName(t) ? ` (тип «${esc(clusterName(t))}»)` : '';
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
      case 'daily':
        return { chip: '<span class="chip accent">👑 Задание дня</span>',
          line: 'Одно задание для всех. Решишь с первой попытки — попадёшь в рейтинг по времени.' };
      case 'asg': {
        const a = why.a;
        if (!a) return { chip: '<span class="chip accent">Задание учителя</span>', line: '' };
        if (a.duel) {
          const done = a.tasks.length - asgLeft(a).length;
          return { chip: '<span class="chip accent">🏆 Турнир</span>',
            line: `${esc(a.title)}: задание ${Math.min(done + 1, a.tasks.length)} из ${a.tasks.length}. Решай точно — важны и число верных, и время.` };
        }
        if (a.strict) {
          return { chip: `<span class="chip accent">📝 Самостоятельная</span>`,
            line: `«${esc(a.title)}»: сдано <b>${(a.done || []).length}</b> из ${a.tasks.length}. Сданный ответ можно <b>один раз</b> изменить, верно или нет — узнаешь после завершения.` };
        }
        const done = a.tasks.length - asgLeft(a).length;
        if (!a.course && a.kind) {
          const sc = a.score || {};
          return { chip: `<span class="chip accent">${kindOf(a)[0]} ${kindOf(a)[1]}</span>`,
            line: `«${esc(a.title)}»: решено <b>${done}</b> из ${a.tasks.length}${sc.grade ? ` · оценка сейчас <b>${sc.grade}</b> (${sc.pct}%)` : ''}. Оценка ставится сама: верно с 1-й попытки — полный балл, со 2-й — половина.${a.due ? ` Срок — до ${fmtDay(a.due * 1000)}.` : ''}` };
        }
        return { chip: `<span class="chip accent">${a.course ? '🎓 Курс' : 'Задание учителя'}</span>`,
          line: `Подборка «${esc(a.title)}»: решено <b>${done}</b> из ${a.tasks.length}${a.due ? ` · срок — до ${fmtDay(a.due * 1000)}` : ''}.` };
      }
      case 'history': {
        const solved = (P.tasks[t.id] || {}).c > 0 || (t.parts || []).some(p => (P.tasks[p.id] || {}).c > 0);
        return { chip: '<span class="chip">Повтор из истории</span>',
          line: (why.last ? `Вы уже решали это задание ${ago(why.last)}. Попробуйте ещё раз — без подсказок.` : '')
            + (solved ? `${why.last ? '<br>' : ''}<b>Это задание уже решено</b> — повторное решение для тренировки: опыта, огонька, серии и достижений за него нет.` : '') };
      }
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

  /** Опыт за первое верное решение — как считает сервер: №1–10 по 10, №11–27 по номеру, +5 за ступень сложности. */
  const xpFor = t => (t.n <= 10 ? 10 : t.n) + 5 * (Math.max(1, Math.min(5, t.r || 1)) - 1);
  function renderTask() {
    const t = cur.task;
    const meta = [];
    const cl = clusterName(t);
    if (cl) meta.push(esc(cl));
    if (t.lv) meta.push(esc(t.lv));
    else if (t.r) meta.push(`<span title="Сложность ${t.r} из 5">${RANK_WORD[t.r]}</span>`);
    if (t.src) meta.push(esc(t.src) + (t.au ? ' (авторское)' : ''));
    else if (BANKS.length > 1) meta.push(esc(bankTitle(t.bank)));
    if (!(P.tasks[t.id] || {}).c) meta.push(`<span class="xp-tag" title="Столько опыта за первое верное решение: ${t.n <= 10 ? '10 XP за №1–10' : `${t.n} XP за №${t.n}`}${(t.r || 1) > 1 ? ` и +${5 * ((t.r || 1) - 1)} за сложность` : ''}">+${xpFor(t)} XP</span>`);
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
        ${inCourseSet() ? '<button type="button" class="btn ghost crs-up" id="crsUpBtn" title="Вернуться к списку заданий подборки">← К подборке</button>' : ''}
        ${backStack.length && !wkLive() ? '<button type="button" class="icon-btn back-btn" id="backBtn" title="Вернуться к предыдущему заданию" aria-label="Предыдущее задание">←</button>' : ''}
        <span class="num-badge">${numLabel(t.n)}</span>
        <div class="task-meta">${meta.join('<span class="sep">·</span>')}</div>
        <span class="head-chips">${chip}</span>
        <span class="task-tools">
          ${PY_BTN}
          ${BD_BTN}
          ${MARK_BTN}
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
    wkDecorate();
    bindInputs();
    const first = $('#answerInputs input');
    if (first && window.matchMedia('(min-width: 861px)').matches && !pyOpen()) first.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    pySync();
    bdSync();
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
    // «Банк ЕГЭ» хранит формулы уже нарисованными, но без классов KaTeX — степени и дроби «плющатся».
    // Исходный TeX лежит в data-math: рисуем заново.
    if (window.katex) {
      el.querySelectorAll('[data-math]').forEach(n => {
        try { window.katex.render(n.getAttribute('data-math'), n, { throwOnError: false, displayMode: false }); } catch (e) { /* оставим как есть */ }
      });
    }
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
    if (wkTask()) { wkActions(a); return; }
    if (cur.done) {
      a.innerHTML = `<button class="btn primary" id="nextBtn" type="button">Следующее задание →<kbd>Enter</kbd></button>`
        + (inCourseSet() && cur.score === 0 && !cur.group ? '<button class="btn" id="retryBtn" type="button" title="Решить это задание ещё раз">↻ Решить заново</button>' : '')
        + (inCourseSet() ? '<button class="btn ghost" id="crsUpBtn" type="button">К подборке</button>' : '');
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
    return Object.assign({ task: obj.id, reason: cur.why.type, rk, spent_ms: Date.now() - cur.started, away: cur.away || 0,
      away_sec: Math.round(cur.awaySec || 0), back_sec: cur.backAt ? (Date.now() - cur.backAt) / 1000 : null, paste: cur.paste ? 1 : 0 }, extra);
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
    try { return await callCheck(cur.task, extra); } catch (e) {
      // учитель сделал подборку самостоятельной, пока страница была открыта: подтянем подборки и покажем старт
      if (e.status === 403 && SERVER) { toast(e.message, 4500); loadAssignments().then(() => { if (wkScope()) show(null); }).catch(() => {}); return null; }
      netError(e); return null;
    } finally { setBusy(false); }
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
    if (wkTask()) return wkSubmit();
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
    cur.score = score;
    const t = cur.task;
    res = res || {};
    const note = record(t, score, cur.why.type === 'review' ? cur.why.r.key : null, { part: res.part, skip: res.nocount });
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
    const noCount = res.nocount ? '<div class="fb-note fb-fast">Это задание уже решено или его ответ тебе уже показывали — решение засчитано для тренировки, но <b>без опыта, огонька, серии и достижений</b>.</div>' : '';
    const fastNote = noCount || !res.fast ? noCount : '<div class="fb-note fb-fast">⏱ Решено быстрее чем за минуту — это похоже на подсмотренный ответ, поэтому <b>−1 XP</b> вместо опыта. Задание не засчитано решённым: реши его ещё раз позже, вдумчиво.</div>';
    if (score === 1) {
      setFeedback('ok', 'Верно!',
        `<div class="fb-note">${note || (streak >= 3 ? `Серия: ${streak} ${plural(streak, 'задание', 'задания', 'заданий')} подряд без ошибок.` : '')}</div>${fastNote}${extra}`);
    } else if (score === 0.5) {
      setFeedback('ok', 'Верно со второй попытки', `<div class="fb-note">${note}</div>${fastNote}${half}${extra}`);
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
    leaveCourse();
    // самостоятельная ещё не начата (или уже сдана): задания в обычном виде не показываем — только старт или результат
    if (wkScope() && !wkLive() && !examShown) { cur = null; wkGate(wkScope()); return; }
    // идёт самостоятельная: её задание открывается только в её режиме, откуда бы ни пришли (←, поиск, история)
    const wl = wkLive();
    if (wl && pick && (pick.why || {}).type !== 'asg') {
      if (!wl.tasks.includes(pick.task.id)) pick = pickNext();
      if (pick) pick = Object.assign({}, pick, { why: { type: 'asg', a: wl } });
    }
    if (!pick && wkScope()) { cur = null; wkDoneScreen(); return; }
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
  /** Распределение первичных баллов по вероятностям решить каждый номер. */
  function primaryDist(probs) {
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
    return dist;
  }
  const expScore = probs => primaryDist(probs).reduce((a, q, k) => a + q * testScore(k), 0);
  function forecast(now = Date.now()) {
    const probs = solveProbs(now);
    const dist = primaryDist(probs);
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

  /** Значок прогноза: три «объёмных» столбика, горят 1–3 в зависимости от балла. */
  function fcIcon(lit) {
    const bars = [[2.5, 13, 8.5], [9.3, 8.5, 13], [16.1, 3, 18.5]];
    return `<svg class="fc-ico" viewBox="0 0 24 25" aria-hidden="true">${bars.map(([x, y, h], i) =>
      `<g class="${i < lit ? 'on' : ''}"><rect x="${x}" y="${y + 1.6}" width="5.4" height="${h}" rx="1.6"/><rect x="${x}" y="${y + 1.6}" width="5.4" height="${h}" rx="1.6" class="sh"/><rect x="${x}" y="${y}" width="5.4" height="${h}" rx="1.6"/></g>`).join('')}</svg>`;
  }
  function renderForecast() {
    const el = $('#forecastBtn');
    if (!el) return;
    const F = CFG.forecast;
    if (P.log.length < F.minAnswers) {
      const left = F.minAnswers - P.log.length;
      el.className = 'forecast fc-empty';
      el.innerHTML = `${fcIcon(0)}<span class="fc-txt"><span class="fc-label">Прогноз ЕГЭ</span>
        <span class="fc-value">ещё ${left} ${plural(left, 'задание', 'задания', 'заданий')}</span></span>`;
      el.title = 'Прогноз появится, когда наберётся немного ответов';
      return;
    }
    const f = forecast();
    rememberForecast(f);
    el.className = `forecast band-${bandOf(f.score)}`;
    const prelim = f.covered < 27;
    el.innerHTML = `${fcIcon(f.score >= 70 ? 3 : f.score >= EGE.minScore ? 2 : 1)}<span class="fc-txt"><span class="fc-label">Прогноз ЕГЭ${prelim ? ' *' : ''}</span>
      <span class="fc-value">${f.score} ${plural(f.score, 'балл', 'балла', 'баллов')}</span></span>`;
    el.title = `Скорее всего ${f.lo}–${f.hi} баллов. Нажмите — что подтянуть, чтобы поднять балл`
      + (prelim ? `\n* Данные есть по ${f.covered} из 27 номерам — остальные пока считаются нерешёнными.` : '');
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

      ${trainPlan(f)}

      <div class="fm-chart-wrap">
        <div class="fm-h">Прогноз за ${F.chartDays} дней</div>
        ${chart.html}
      </div>

      <p class="fm-note">По ${f.answers} ${plural(f.answers, 'ответу', 'ответам', 'ответам')}, данные есть по ${f.covered} из 27 номеров.
        ${untried.length ? 'Номера, которые ещё не решали, считаются нерешёнными — прогноз вырастет, когда вы их попробуете.' : ''}</p>

      ${untried.length || weak.length ? `<div class="fm-where">
        <div class="fm-h">Ещё можно добрать</div>
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

  // ------------------------------------------------------------ курс по плану (пока структура, наполнение — по ходу)
  // Порядок не 1→27, а по темам: сначала без программирования, потом логика, системы счисления, программирование, сложные.
  const COURSE = [
    { title: 'Старт без программирования', icon: '🧭', sub: 'Графы, кодирование, объёмы, базы данных, таблицы, IP-адреса',
      lessons: [1, 4, 7, 11, 3, 9, 10] },
    { title: 'Логика', icon: '🧩', sub: 'Таблицы истинности и логические выражения', lessons: [2, 15] },
    { title: 'Системы счисления и исполнители', icon: '🔢', sub: 'Анализ алгоритмов, Черепаха, машина Тьюринга, траектории, комбинаторика',
      lessons: [5, 14, 6, 12, 13, 8] },
    { title: 'Программирование', icon: '🐍', sub: 'Рекурсия, последовательности, строки, делители и маски', lessons: [16, 17, 24, 25] },
    { title: 'Финишная прямая', icon: '🏁', sub: 'Теория игр, процессы, динамика, графы, задачи 26–27', lessons: [19, 22, 18, 23, 26, 27] },
  ];
  // подборки урока: одинаковые для всех номеров; d — сложность в банке (1 — простая, 2 — средняя, 3 — сложная)
  // описания подборок №5 — по системам счисления
  const COURSE_SET_NOTES = { 5: { warm: 'самые простые задания из всех банков', base: 'двоичная запись', exam: 'двоичная и троичная системы — как на ЕГЭ',
    hard: 'другие системы счисления и десятичные цифры', test: 'по 5 заданий каждого вида: 2-я, 3-я, другие системы, десятичные цифры' } };
  const COURSE_SETS = [
    { key: 'warm', name: 'Разминка', icon: '🌱', d: [1], note: 'простые задания, чтобы понять идею' },
    { key: 'base', name: 'Базовый уровень', icon: '📘', d: [1, 2], note: 'типовые задания как в демоверсии' },
    { key: 'exam', name: 'Как на ЕГЭ', icon: '🎯', d: [2], note: 'формат и сложность реального экзамена' },
    { key: 'hard', name: 'Сложные', icon: '🔥', d: [3], note: 'для тех, кто идёт на 90+' },
    { key: 'test', name: 'Контрольная', icon: '🏆', d: null, note: '20 заданий разных видов — проверка темы' },
  ];
  // подборки урока — из банка, по сложности; состав постоянный (сортировка по хешу id), по 10 заданий
  const EXAM_SRC = /Демоверсия|Апробация|Резерв|Основная|ЕГКР|Пересдача|Досрочн/;
  const idHash = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return h >>> 0; };
  const SET_SIZE = 20;
  // №5: какая система счисления в задании — по тексту условия
  const sysCache = new Map();
  function sysOf(t) {
    if (sysCache.has(t.id)) return sysCache.get(t.id);
    const x = String(t.html || '').replace(/<[^>]+>/g, ' ').toLowerCase();
    const v = /двоичн/.test(x) ? 2 : /троичн/.test(x) ? 3
      : /(четвер|пятер|шестер|семер|восьмер|девятер|шестнадцатер)ичн/.test(x) ? 'other' : /значн|цифр/.test(x) ? 10 : 'other';
    sysCache.set(t.id, v);
    return v;
  }
  // Состав подборок курса собирает сервер (по кластерам заданий) — тот же, что видит учитель в прогрессе курса.
  // Без связи с сервером подборки собираются здесь, по старым правилам.
  let COURSE_SRV = {};
  async function loadCourseSets() {
    if (!SERVER || !COURSE_OK) return;
    try { COURSE_SRV = (await api('course/sets')).sets || {}; } catch (e) { return; }
    ASG = ASG.filter(a => !a.course);                // подборки курса пересоберутся из нового состава
  }
  function courseSetTasks(n) {
    const srv = COURSE_SRV[n];
    if (srv) return Object.fromEntries(Object.entries(srv).map(([k, ids]) => [k, ids.filter(id => byId.has(id))]));
    // все задания номера (без фильтра «Актуальные»: подборки курса собраны заранее), порядок постоянный
    const pool = TASKS.filter(t => t.n === n && !t.parts).sort((a, b) => idHash(a.id) - idHash(b.id));
    const used = new Set();
    const take = (list, k) => { const out = list.filter(t => !used.has(t.id)).slice(0, Math.max(0, k)); out.forEach(t => used.add(t.id)); return out; };
    // набрать k заданий: сначала из первого списка, не хватило — из следующих
    const fill = (k, ...lists) => { const out = []; for (const l of lists) out.push(...take(l, k - out.length)); return out; };
    const easy = t => t.d === 1 || /Прост|Проще/.test(t.lv || '');
    const hard = t => t.d === 3 || /Сложн/.test(t.lv || '');
    const real = t => EXAM_SRC.test(t.src || '');
    const short = list => list.slice().sort((a, b) => String(a.html || '').length - String(b.html || '').length);
    const first = (list, f) => list.filter(f).concat(list.filter(t => !f(t)));
    const sets = {};
    if (n === 5) {
      const sys = (...v) => pool.filter(t => v.includes(sysOf(t)));
      sets.warm = fill(SET_SIZE, pool.filter(easy), short(sys(2)), short(pool));                       // самые простые
      sets.base = fill(SET_SIZE, first(sys(2), t => !hard(t)));                                        // двоичная
      sets.exam = [...fill(SET_SIZE / 2, first(sys(2), real)), ...fill(SET_SIZE / 2, first(sys(3), real))];   // 2-я и 3-я
      sets.exam.push(...fill(SET_SIZE - sets.exam.length, sys(3), sys(2)));
      sets.hard = fill(SET_SIZE, first(sys('other', 10), hard), first(sys(3), hard), pool);           // остальные + 10-я
      sets.test = [2, 3, 'other', 10].flatMap(v => fill(SET_SIZE / 4, first(sys(v), t => !easy(t))));  // по всем видам
    } else {
      sets.warm = fill(SET_SIZE, pool.filter(easy), short(pool));
      sets.base = fill(SET_SIZE, pool.filter(t => !easy(t) && !hard(t)), pool);
      sets.exam = fill(SET_SIZE, pool.filter(real), pool);
      sets.hard = fill(SET_SIZE, pool.filter(hard), pool);
      sets.test = [];
    }
    sets.test.push(...fill(SET_SIZE - sets.test.length, pool));
    return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.map(t => t.id)]));
  }
  /** Подборка курса как «подборка учителя»: решается по порядку, прогресс считается по журналу. */
  function courseSet(id) {
    const m = /^crs-(\d+)-(\w+)$/.exec(id || '');
    if (!m) return null;
    const n = +m[1], st = COURSE_SETS.find(x => x.key === m[2]);
    if (!st) return null;
    let a = ASG.find(x => x.id === id);
    if (!a) {
      a = { id, course: n, title: `№${numLabel(n)} · ${st.name}`, tasks: courseSetTasks(n)[st.key] || [], done: [], created: 0 };
      ASG.push(a);
    }
    return a;
  }
  let courseShown = false;
  let pageKind = null;                   // открыта страница вместо задания: null — курс, 'asg' — задания от учителя
  let TEACHER = false;
  // Окна курса (план → урок → подборка → задание) пишутся в историю браузера: кнопка «Назад» ведёт по ним
  let navSilent = false;
  function navPush(st) {
    if (navSilent) return;
    try {
      const was = history.state;
      if (!was) history.replaceState({ v: 'main' }, '');
      else if (JSON.stringify(was) === JSON.stringify(st)) return;
      history.pushState(st, '');
    } catch (e) {}
  }
  function inCourseSet() { return ui.scope === 'asg' && !!(asgOf(ui.asg) || {}).course; }
  /** Задание из подборки курса: подборка становится текущим разделом. */
  function openSetTask(a, t) {
    abandonCurrent();
    leaveExam();
    ui.scope = 'asg';
    ui.asg = a.id;
    save();
    renderSidebar();
    if (!cur || cur.done || cur.task.id !== t.id || courseShown) show({ task: t, why: { type: 'asg', a } });
    navPush({ v: 'task', set: a.id, id: t.id });
  }
  window.addEventListener('popstate', e => {
    const st = e.state || { v: 'main' };
    navSilent = true;
    try {
      if (examShown) return;
      if (st.v === 'course') openCourse();
      else if (st.v === 'asgpage') openAsgPage();
      else if (st.v === 'tourpage') tourOpen();
      else if (st.v === 'exams') openExamsPage();
      else if (st.v === 'history') openHistory();
      else if (st.v === 'exam' && st.id) openExamReview(st.id);
      else if (st.v === 'lesson') openLesson(st.n);
      else if (st.v === 'set' && courseSet(st.id)) { abandonCurrent(); openCourseSet(st.id); }
      else if (st.v === 'task' && courseSet(st.set) && byId.get(st.id)) openSetTask(courseSet(st.set), byId.get(st.id));
      else if (courseShown || inCourseSet()) {
        leaveCourse();
        if (inCourseSet()) { ui.scope = 'all'; save(); renderSidebar(); }
        next();
      }
    } finally { navSilent = false; }
  });
  let COURSE_OK = false;                 // курс открыт паролем от учителя (проверяет сервер)
  function courseLock() {
    $('#scopeInfo').innerHTML = '<span class="scope-title">Курс</span>';
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock">
      <div class="crs-lock-ic">🔒</div>
      <h2>Курс доступен по паролю</h2>
      <p>Пароль выдаёт учитель. Ввести его нужно один раз — дальше курс будет открыт на любом устройстве.</p>
      <form class="login-form crs-lock-form" id="courseForm" autocomplete="off">
        <input class="inp" id="coursePw" type="password" maxlength="200" placeholder="Пароль курса" autocomplete="off" required>
        <button class="btn primary" type="submit">Открыть курс</button>
      </form>
      <div class="login-err" id="courseMsg"></div>
    </div></div>`;
    $('#coursePw').focus();
    $('#courseForm').addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('#courseMsg');
      msg.textContent = '';
      try {
        await api('course/unlock', { password: $('#coursePw').value });
        COURSE_OK = true;
        await loadCourseSets();
        $('#courseCard')?.classList.remove('locked');
        toast('Курс открыт 🎓', 2500);
        openCourse();
      } catch (err) { msg.textContent = err.message || 'Не получилось — попробуйте ещё раз'; }
    });
  }
  function leaveCourse() {
    if (!courseShown) return;
    courseShown = false;
    pageKind = null;
    document.body.classList.remove('asg-wide');
    $('#courseCard')?.classList.remove('on');
  }
  function lessonState(n) {
    const st = numStats(n);
    return st.lvl === 'good' ? 'done' : st.lvl === 'none' ? 'new' : 'go';
  }
  function openCourse() {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true;
    pageKind = null;
    cur = null;
    navPush({ v: 'course' });
    document.querySelectorAll('.rail-btn.on').forEach(b => b.classList.remove('on'));
    $('#courseCard')?.classList.add('on');
    if (!COURSE_OK) { courseLock(); window.scrollTo(0, 0); return; }
    const all = COURSE.flatMap(m => m.lessons), done = all.filter(n => lessonState(n) === 'done').length;
    const nextN = all.find(n => lessonState(n) !== 'done');
    $('#scopeInfo').innerHTML = '<span class="scope-title">Курс</span><span class="scope-stats">27 тем по плану</span>';
    trainerEl.innerHTML = `<div class="course">
      <div class="crs-hero">
        <div><div class="crs-kicker">Курс Egeshka</div><h2>ЕГЭ по информатике: от №1 до №27</h2>
          <p>Уроки идут по плану: от простых тем к сложным. В каждом — презентация с разбором и подборки заданий по уровням.</p></div>
        <div class="crs-prog"><b>${done}</b><span>из ${all.length} тем освоено</span><i class="xp-bar"><b style="width:${pct(done / all.length)}%"></b></i></div>
      </div>
      ${nextN ? `<button type="button" class="crs-continue" data-lesson="${nextN}"><span>▶</span><span><b>Продолжить: №${numLabel(nextN)} · ${esc(NUM_TOPIC[nextN])}</b><small>следующая тема по плану</small></span></button>` : ''}
      ${COURSE.map((m, i) => `<section class="crs-mod">
        <div class="crs-mod-h"><span class="crs-mod-ic">${m.icon}</span><div><b>Модуль ${i + 1}. ${esc(m.title)}</b><small>${esc(m.sub)}</small></div>
          <span class="crs-mod-n">${m.lessons.filter(n => lessonState(n) === 'done').length}/${m.lessons.length}</span></div>
        <div class="crs-path">${m.lessons.map(n => {
          const stt = lessonState(n), p = numStats(n).s && numStats(n).s.a ? pct(numStats(n).s.m) : 0;
          return `<button type="button" class="crs-lesson ${stt}" data-lesson="${n}">
            <span class="ring crs-ring${numLabel(n).length > 2 ? ' wide' : ''}" style="--p:${p}"><span class="n">${numLabel(n)}</span></span>
            <span class="crs-l-txt"><b>${esc(NUM_TOPIC[n])}</b><small>${stt === 'done' ? '✓ освоено' : stt === 'go' ? `в процессе · ${p}%` : 'не начато'} · презентация · ${COURSE_SETS.length} подборок</small></span>
            <span class="crs-go">›</span></button>`;
        }).join('')}</div></section>`).join('')}
    </div>`;
    window.scrollTo(0, 0);
  }
  let DECK = null, deckI = 0;
  function slideHtml(sl, i) {
    const kick = sl.k ? `<div class="sl-k ${sl.kc || ''}">${esc(sl.k)}</div>` : '';
    const runBtn = (k, ans) => `<div class="sl-btns"><button type="button" class="btn primary" data-py-slide="${i}:${k}">▶ Открыть в Python</button>
        ${ans ? `<details class="sl-ansbox"><summary>Показать ответ</summary><span class="sl-ok"><i aria-hidden="true">✓</i>Отлично! Ответ: <b>${esc(ans)}</b></span></details>` : ''}</div>`;
    const codeBox = (code, k, ans) => `<div class="sl-codecol"><pre class="sl-code">${highlightPy(code)}</pre>${runBtn(k, ans)}</div>`;
    if (sl.t === 'title') {
      return `<div class="sl sl-title"><div class="sl-title-main"><div class="crs-kicker">${esc(sl.k || 'Egeshka · курс ЕГЭ')}</div><h3>${esc(sl.h)}</h3><p>${esc(sl.sub || '')}</p>
        ${(sl.chips || []).length ? `<div class="sl-chips">${sl.chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div>
        ${sl.aside ? `<div class="sl-title-aside">${safeHtml(sl.aside)}</div>` : ''}</div>`;
    }
    if (sl.t === 'section') {
      return `<div class="sl sl-section"><div class="sl-k ${sl.kc || ''}">${esc(sl.k)}</div><h3>${esc(sl.h)}</h3><p>${esc(sl.sub || '')}</p>
        ${sl.tag ? `<code class="sl-tag">${esc(sl.tag)}</code>` : ''}</div>`;
    }
    if (sl.t === 'code' && sl.cond != null) {
      return `<div class="sl">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-split${sl.wide ? ' wide' : ''}${sl.stack ? ' stack' : ''}">
        <div class="sl-left"><div class="sl-cond"><div class="sl-cond-h">${esc(sl.ch || 'Условие')}</div>${safeHtml(sl.cond)}</div>
          ${sl.note ? `<div class="sl-nuance ${sl.kc || ''} ${sl.nk ? 'nk-' + sl.nk : ''}">${sl.nk === 'warn' ? '<b class="nk">⚠ Осторожно!</b> ' : sl.nk === 'secret' ? '<b class="nk">💡 Секрет.</b> ' : ''}${safeHtml(sl.note)}</div>` : ''}</div>
        ${codeBox(sl.code, 0, sl.ans)}</div></div>`;
    }
    if (sl.t === 'solve') {
      // задача без программы: условие → «Показать решение» (шаги) → «Показать ответ»
      const ans = sl.ans ? `<details class="sl-ansbox"><summary>Показать ответ</summary><span class="sl-ok"><i aria-hidden="true">✓</i>Отлично! Ответ: <b>${esc(sl.ans)}</b></span></details>` : '';
      return `<div class="sl">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-split${sl.stack ? ' stack' : ''}">
        <div class="sl-left"><div class="sl-cond"><div class="sl-cond-h">${esc(sl.ch || 'Задание')}</div>${safeHtml(sl.cond)}</div>
          ${sl.note ? `<div class="sl-nuance ${sl.kc || ''} ${sl.nk ? 'nk-' + sl.nk : ''}">${sl.nk === 'warn' ? '<b class="nk">⚠ Осторожно!</b> ' : sl.nk === 'secret' ? '<b class="nk">💡 Секрет.</b> ' : ''}${safeHtml(sl.note)}</div>` : ''}</div>
        <div class="sl-solcol"><details class="sl-sol"${sl.open ? ' open' : ''}><summary>Показать решение</summary><div class="sl-sol-body">${safeHtml(sl.sol)}</div></details>${ans}</div></div></div>`;
    }
    if (sl.t === 'codes') {
      return `<div class="sl">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-blocks n${sl.blocks.length}">${sl.blocks.map((b, k) =>
        `<div class="sl-block"><p>${safeHtml(b.cond)}</p>${codeBox(b.code, k, b.ans)}</div>`).join('')}</div></div>`;
    }
    const code = sl.t === 'code' ? `<pre class="sl-code">${highlightPy(sl.code)}</pre>${runBtn(0, sl.ans)}` : '';
    return `<div class="sl${sl.dark ? ' sl-dark' : ''}">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-body">${safeHtml(sl.html || '')}${code}</div></div>`;
  }
  function renderDeck() {
    const box = $('#crsDeck');
    if (!box || !DECK) return;
    const sl = DECK.slides;
    deckI = Math.max(0, Math.min(deckI, sl.length - 1));
    box.querySelector('.crs-stage').innerHTML = slideHtml(sl[deckI], deckI);
    if (MARK.on || MARK.strokes.has(`deck:${DECK.n}:${deckI}`)) markAttach();   // рисунок этого слайда
    box.querySelector('.crs-count').textContent = `${deckI + 1} / ${sl.length}`;
    deckSeen(deckI + 1, sl.length);
    box.querySelector('[data-deck="-1"]').disabled = deckI === 0;
    box.querySelector('[data-deck="1"]').disabled = deckI === sl.length - 1;
    box.querySelectorAll('.crs-thumb').forEach((t, k) => t.classList.toggle('on', k === deckI));
    box.querySelector('.crs-thumb.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderMath(box.querySelector('.crs-stage'));
    fitSlide();
  }
  function deckGo(d) { deckI += d; renderDeck(); }
  // докуда долистал презентацию — учитель видит в прогрессе курса (отправляем только новый максимум)
  let seenT = 0;
  function deckSeen(k, total) {
    if (!SERVER || !student || !DECK) return;
    const key = `egeTrainer.seen.${student.sid}.${DECK.n}`;
    let max = 0;
    try { max = +localStorage.getItem(key) || 0; } catch (e) { /* нет доступа */ }
    if (k <= max) return;
    try { localStorage.setItem(key, k); } catch (e) { /* нет доступа */ }
    const n = DECK.n;
    clearTimeout(seenT);
    seenT = setTimeout(() => api('course/seen', { n, slide: k, total }).catch(() => {}), 800);
  }
  // масштаб слайда: на весь экран — подгоняем под экран; кнопки − / + меняют размер вручную
  let DECK_SCALE = 1;
  try { DECK_SCALE = +localStorage.getItem('egeTrainer.deckScale') || 1; } catch (e) { /* нет доступа */ }
  const DECK_W = 960;                                    // «расчётная» ширина слайда для полноэкранного режима
  function fitSlide() {
    const deck = $('#crsDeck'), stage = deck && deck.querySelector('.crs-stage'), sl = stage && stage.querySelector('.sl');
    if (!sl) return;
    sl.style.zoom = '';
    sl.style.width = '';
    if (document.fullscreenElement !== deck) {
      if (DECK_SCALE !== 1) sl.style.zoom = DECK_SCALE;
      return;
    }
    sl.style.width = DECK_W + 'px';
    const h = sl.scrollHeight, W = stage.clientWidth - 8, H = stage.clientHeight - 8;
    sl.style.zoom = Math.max(0.4, Math.min(W / DECK_W, H / h) * DECK_SCALE);
  }
  function deckZoom(d) {
    DECK_SCALE = d ? Math.round(Math.min(1.8, Math.max(0.6, DECK_SCALE + d * 0.1)) * 10) / 10 : 1;
    try { localStorage.setItem('egeTrainer.deckScale', DECK_SCALE); } catch (e) { /* нет доступа */ }
    fitSlide();
    const lbl = $('#deckZoomLbl');
    if (lbl) lbl.textContent = Math.round(DECK_SCALE * 100) + '%';
  }
  document.addEventListener('fullscreenchange', () => setTimeout(fitSlide, 50));
  window.addEventListener('resize', () => { if (document.fullscreenElement) fitSlide(); });
  async function openLesson(n) {
    if (!COURSE_OK) return openCourse();
    abandonCurrent();
    courseShown = true;
    navPush({ v: 'lesson', n });
    DECK = null;
    deckI = 0;
    const counts = d => TASKS.filter(t => t.n === n && visible(t) && (!d || d.includes(t.d))).length;
    const mod = COURSE.findIndex(m => m.lessons.includes(n));
    $('#scopeInfo').innerHTML = `<span class="scope-title">Курс · №${numLabel(n)}</span>`;
    let lesson = null;
    try { lesson = await api('course/lesson?n=' + n); } catch (e) { if (e.status === 403) { COURSE_OK = false; return openCourse(); } }
    if (!courseShown) return;                       // пока грузили, ученик ушёл к заданию
    const has = lesson && lesson.slides && lesson.slides.length;
    if (has) DECK = lesson;
    const plan = ['Что проверяет задание', 'Разбор типового задания', 'Как решать руками', 'Как решать на Python', 'Частые ошибки', 'Итоги и шпаргалка'];
    const deck = has ? `<div class="crs-deck" id="crsDeck">
        <div class="crs-main"><div class="crs-stage"></div>
          <div class="crs-nav"><button type="button" class="btn ghost" data-deck="-1">← Назад</button><span class="crs-count"></span>
            ${MARK_BTN}
            <span class="crs-zoom"><button type="button" class="icon-btn" data-deck-zoom="-1" title="Мельче">−</button>
              <button type="button" class="link-btn" data-deck-zoom="0" id="deckZoomLbl" title="Обычный размер">${Math.round(DECK_SCALE * 100)}%</button>
              <button type="button" class="icon-btn" data-deck-zoom="1" title="Крупнее">+</button></span>
            <button type="button" class="btn ghost crs-full" data-deck-full title="На весь экран">⤢</button>
            <button type="button" class="btn primary" data-deck="1">Далее →</button></div></div>
        <div class="crs-thumbs">${lesson.slides.map((t, i) => `<button type="button" class="crs-thumb" data-slide="${i}"><span>${i + 1}. ${esc(t.h)}</span></button>`).join('')}</div>
      </div>` : `<div class="crs-deck">
        <div class="crs-slide"><span class="crs-slide-no">1 / ${plan.length}</span>
          <div class="crs-slide-body"><div class="crs-kicker">Egeshka · урок ${numLabel(n)}</div><h3>${esc(NUM_TOPIC[n])}</h3>
            <p>Презентация с разбором появится здесь</p></div>
          <span class="crs-soon">скоро</span></div>
        <div class="crs-thumbs">${plan.map((t, i) => `<div class="crs-thumb${i ? '' : ' on'}"><i></i><i></i><span>${i + 1}. ${t}</span></div>`).join('')}</div>
      </div>`;
    trainerEl.innerHTML = `<div class="course lesson">
      <button type="button" class="link-btn crs-back" data-course-back>← К плану курса</button>
      <div class="crs-l-head"><span class="num-badge">${numLabel(n)}</span><div><div class="crs-kicker">Модуль ${mod + 1} · ${esc(COURSE[mod].title)}</div>
        <h2>№${numLabel(n)}. ${esc(NUM_TOPIC[n])}</h2></div></div>
      <div class="fm-h">1. Теория${has ? ` · ${lesson.slides.length} слайдов` : ''}</div>
      ${deck}
      <div class="fm-h">2. Практика по уровням</div>
      <div class="crs-sets">${COURSE_SETS.map((st, i) => {
        const a = courseSet(`crs-${n}-${st.key}`), total = a ? a.tasks.length : 0, done = total - asgLeft(a).length;
        return `<div class="crs-set${total && done === total ? ' done' : ''}"><span class="crs-set-ic">${st.icon}</span>
          <span class="crs-set-txt"><b>${i + 1}. ${st.name}</b><small>${(COURSE_SET_NOTES[n] || {})[st.key] || st.note}</small>
            <i class="xp-bar"><b style="width:${total ? pct(done / total) : 0}%"></b></i></span>
          <span class="crs-set-n">${total ? `решено ${done} из ${total}` : 'нет заданий'}</span>
          <button type="button" class="btn ${total && done < total ? 'primary' : 'ghost'}" data-course-set="${a ? a.id : ''}" ${total ? '' : 'disabled'}>${!total ? '—' : done === total ? 'Повторить' : done ? 'Продолжить' : 'Решать'}</button></div>`;
      }).join('')}</div>
      <p class="fm-note">Задания внутри подборки идут по порядку, сначала нерешённые. Решённое засчитывается и в тренажёре.</p>
      <button type="button" class="btn ghost" data-go-num="${n}">Все задания №${numLabel(n)} в тренажёре</button>
    </div>`;
    if (has) renderDeck();
    window.scrollTo(0, 0);
  }
  /** Страница подборки курса: все задания списком, видно решённые, любое можно открыть. */
  function openCourseSet(id) {
    const a = courseSet(id);
    if (!a) return;
    courseShown = true;
    navPush({ v: 'set', id });
    const left = new Set(asgLeft(a)), total = a.tasks.length, done = total - left.size;
    const st = COURSE_SETS.find(x => id.endsWith('-' + x.key)) || {};
    // красным — задания, где была попытка, но верного ответа нет: их можно решить заново
    const tried = new Set(P.log.filter(e => !e.b).map(e => e.id));
    const bad = tid => left.has(tid) && (tried.has(tid) || ((P.tasks[tid] || {}).a > 0));
    const nBad = a.tasks.filter(bad).length;
    // начало у заданий одинаковое («На вход алгоритма подаётся…») — показываем само правило
    const snip = t => String(t.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
      .replace(/^\([^)]{0,40}\)\s*/, '')
      .replace(/^(На вход алгоритма пода[её]тся|Алгоритм получает на вход|Автомат (получает на вход|обрабатывает)|На вход программ[еы] пода[её]тся)[\s\S]{0,200}?(следующим образом|по следующим правилам|по следующему алгоритму|следующему алгоритму|по следующему правилу)[.:]?\s*/i, '')
      .replace(/^1[.)]\s*Строится [^.]*?(запись|число)[^.]*\.\s*/i, '')
      .replace(/^2[.)]\s*Далее эта запись обрабатывается по следующему правилу:?\s*/i, '')
      .slice(0, 170);
    $('#scopeInfo').innerHTML = `<span class="scope-title">Курс · №${numLabel(a.course)}</span><span class="scope-stats">${esc(st.name || '')}</span>`;
    trainerEl.innerHTML = `<div class="course">
      <button type="button" class="link-btn crs-back" data-lesson="${a.course}">← К уроку №${numLabel(a.course)}</button>
      <div class="crs-set-head"><span class="crs-set-ic big">${st.icon || '📘'}</span><div><div class="crs-kicker">Подборка · ${total} заданий</div>
        <h2>${esc(a.title)}</h2><small>${esc((COURSE_SET_NOTES[a.course] || {})[st.key] || st.note || '')}</small></div>
        <div class="crs-set-prog"><b>${done}</b><span>из ${total}</span><i class="xp-bar"><b style="width:${total ? pct(done / total) : 0}%"></b></i></div></div>
      <div class="crs-legend"><span class="ok">✓ верно: ${done}</span><span class="bad">✗ с ошибкой: ${nBad}</span><span>не начато: ${total - done - nBad}</span></div>
      <button type="button" class="btn primary crs-set-start" data-set-start="${esc(id)}">${done === total ? 'Решать заново' : done ? 'Продолжить с нерешённого' : 'Начать подборку'}</button>
      <div class="crs-tasks">${a.tasks.map((tid, k) => { const t = byId.get(tid); if (!t) return '';
        const ok = !left.has(tid), no = bad(tid);
        return `<button type="button" class="crs-task${ok ? ' ok' : no ? ' bad' : ''}" data-set-task="${esc(tid)}" data-set="${esc(id)}">
          <span class="crs-task-n">${ok ? '✓' : no ? '✗' : k + 1}</span><span class="crs-task-txt">${esc(snip(t))}…</span>
          <span class="crs-task-st">${ok ? 'верно' : no ? 'исправить →' : 'решать →'}</span></button>`; }).join('')}</div>
    </div>`;
    window.scrollTo(0, 0);
  }
  /** Код со слайда — в окно Python: можно запустить и поменять. */
  function slideToPy(ref) {
    const [i, k] = String(ref).split(':').map(Number);
    const sl = DECK && DECK.slides[i];
    const code = sl && (sl.blocks ? (sl.blocks[k || 0] || {}).code : sl.code);
    if (!code) return;
    togglePy(true);
    const ta = $('#pyCode');
    ta.value = code;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    $('#pyTask').textContent = `курс · №${DECK.n}`;
  }
  document.addEventListener('keydown', e => {
    if (!courseShown || !DECK || !$('#crsDeck') || e.target.closest('input, textarea, select')) return;
    if (!$('#forecastModal').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); deckGo(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); deckGo(-1); }
  });
  trainerEl.addEventListener('click', e => {
    if (!courseShown) return;
    const l = e.target.closest('[data-lesson]');
    if (l) { openLesson(+l.dataset.lesson); return; }
    if (e.target.closest('[data-course-back]')) { openCourse(); return; }
    const dg = e.target.closest('[data-deck]');
    if (dg) { deckGo(+dg.dataset.deck); return; }
    const th = e.target.closest('[data-slide]');
    if (th) { deckI = +th.dataset.slide; renderDeck(); return; }
    const py = e.target.closest('[data-py-slide]');
    if (py) { slideToPy(py.dataset.pySlide); return; }
    const dz = e.target.closest('[data-deck-zoom]');
    if (dz) { deckZoom(+dz.dataset.deckZoom); return; }
    if (e.target.closest('[data-deck-full]')) {
      const d = $('#crsDeck');
      if (document.fullscreenElement) document.exitFullscreen(); else d?.requestFullscreen?.().catch(() => {});
      return;
    }
    const g = e.target.closest('[data-go-num]');
    if (g) setScope(+g.dataset.goNum);
    const cs = e.target.closest('[data-course-set]');
    if (cs && cs.dataset.courseSet && courseSet(cs.dataset.courseSet)) { openCourseSet(cs.dataset.courseSet); return; }
    const ss = e.target.closest('[data-set-start]');
    if (ss) {
      const a = courseSet(ss.dataset.setStart);
      setScope('asg', ss.dataset.setStart);
      if (a && cur) navPush({ v: 'task', set: a.id, id: cur.task.id });
      return;
    }
    const stk = e.target.closest('[data-set-task]');
    if (stk) {
      const a = courseSet(stk.dataset.set), t = byId.get(stk.dataset.setTask);
      if (a && t) openSetTask(a, t);
    }
  });

  const NUM_TOPIC = ['', 'Графы и таблицы', 'Таблицы истинности', 'Базы данных', 'Кодирование, условие Фано', 'Алгоритмы-автоматы',
    'Черепаха', 'Изображения и звук', 'Комбинаторика', 'Электронные таблицы', 'IP-адреса и маски', 'Объём информации',
    'Машина Тьюринга', 'Исполнитель: траектории программ', 'Системы счисления', 'Логические выражения', 'Рекурсия',
    'Обработка последовательностей', 'Динамика: Робот', 'Теория игр', 'Теория игр', 'Теория игр', 'Параллельные процессы',
    'Граф: поиск пути', 'Обработка строк', 'Делители и маски', 'Сортировка, жадные алгоритмы', 'Анализ данных'];

  /** «Что потренировать»: номера, которые дадут больше всего тестовых баллов, если довести их до 85%. */
  function trainPlan(f) {
    const TARGET = 0.85;
    const base = expScore(f.probs);
    const now = Date.now();
    const cand = [];
    for (let n = 1; n <= 27; n++) {
      if (HAS_GROUPS && (n === 20 || n === 21)) continue;
      const x = f.probs[n];
      if (x.exp >= TARGET) continue;
      const ns = HAS_GROUPS && n === 19 ? [19, 20, 21] : [n];
      const pr = Object.assign({}, f.probs);
      for (const k of ns) pr[k] = { ...pr[k], p: Math.max(pr[k].p, TARGET), ph: 0 };
      const gain = expScore(pr) - base;
      if (gain < 0.5) continue;
      const why = !x.tried ? 'ещё не решали' : `сейчас решаете на ${pct(x.exp)}%`;
      cand.push({ n, gain, why, pts: ns.reduce((a, k) => a + EGE.points(k), 0) });
    }
    cand.sort((a, b) => b.gain - a.gain || a.n - b.n);
    const top = cand.slice(0, 3);
    // ближайшая цель: следующий рубеж и сколько первичных до него
    const goals = [EGE.minScore, 60, 70, 80, 90, 100].filter(g => g > f.score);
    let goalHtml = '';
    if (goals.length) {
      const g = goals[0];
      let k = 0;
      while (k < EGE.scale.length - 1 && testScore(k) < g) k++;
      const need = Math.max(1, Math.ceil(k - f.primary));
      goalHtml = `<div class="tp-goal">🎯 До <b>${g} баллов</b> не хватает примерно <b>${need}</b> ${plural(need, 'первичного балла', 'первичных баллов', 'первичных баллов')}${
        top.length ? ` — это ${top.slice(0, Math.min(3, need)).map(c => `№${numLabel(c.n)}`).join(' и ').replace(/ и (?=.* и )/, ', ')}` : ''}.</div>`;
    }
    const strong = [];
    for (let n = 1; n <= 27; n++) if (f.probs[n].tried && f.probs[n].exp >= TARGET) strong.push(n);
    const due = [];
    for (let n = 1; n <= 27; n++) if (reviewsOf(n).some(r => isDue(r, now))) due.push(n);
    const counts = countByNum();
    const card = c => `<div class="tp-card">
        <span class="tp-n">${numLabel(c.n)}</span>
        <span class="tp-main"><b>${esc(NUM_TOPIC[c.n])}</b><small>${c.why}${c.pts > 1 ? ` · ${c.pts} перв. балла` : ''}</small></span>
        <span class="tp-gain">+${Math.round(c.gain)}<small>${plural(Math.round(c.gain), 'балл', 'балла', 'баллов')}</small></span>
        <button type="button" class="btn primary tp-go" data-go="${c.n}" ${counts[scopeOf(c.n)] ? '' : 'disabled'}>Тренировать</button>
      </div>`;
    if (!top.length && !due.length) {
      return `<div class="tp"><div class="fm-h">Что потренировать</div><p class="fm-note">Все номера решаются уверенно — держите форму вариантами ЕГЭ 💪</p></div>`;
    }
    return `<div class="tp">
      <div class="fm-h">Что потренировать — больше всего баллов</div>
      ${goalHtml}
      ${top.map(card).join('')}
      ${top.length ? '<p class="fm-note tp-note">«+N баллов» — насколько вырастет прогноз, если решать этот номер на 85%.</p>' : ''}
      ${due.length ? `<div class="fm-line"><span class="fm-muted">🔁 Пора повторить:</span> ${due.slice(0, 10).map(n => `<button class="chip num-chip" type="button" data-go="${n}">№${numLabel(n)}</button>`).join(' ')}</div>` : ''}
      ${strong.length ? `<div class="fm-line"><span class="fm-muted">💪 Сильные стороны:</span> ${strong.map(n => `<span class="chip good">№${n}</span>`).join(' ')}</div>` : ''}
    </div>`;
  }

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
    for (let i = P.log.length - 1; i >= 0; i--) {
      if (P.log[i].ra) continue;                 // перерешанное уже решённое — серию не продлевает и не рвёт
      if (P.log[i].s !== 1) break;
      k++;
    }
    return k;
  }

  // ------------------------------------------------------------ цель на день и серия дней
  function dayCounts() {
    const m = new Map();
    for (const e of P.log) { if (e.b || e.ra) continue; const k = dayKey(e.t); m.set(k, (m.get(k) || 0) + 1); }
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
    if (SERVER) {
      clearTimeout(lbTimer);
      lbTimer = setTimeout(() => { loadRating(); if (DAILY && cur && cur.task && cur.task.id === DAILY.task) loadDaily(); }, 1500);
      checkDuelDone();
    }
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
      h = `<span class="scope-title">${a.duel ? '🏆 Турнир' : a.course ? '🎓 Курс' : 'От учителя'}</span>
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
    const today = P.log.filter(x => x.t >= dayStart.getTime() && !x.b && !x.ra);   // перерешанное уже решённое — не в счёт
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
      ${SERVER && student ? rankBtnHtml() : ''}
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
    const inTrainer = !examShown && !courseShown;
    all.className = 'rail-btn' + (inTrainer && ui.scope !== 'fav' && ui.scope !== 'asg' ? ' on' : '');
    if ($('#allNums')) {                       // index.html прошлой версии мог остаться в кэше — тогда кнопки нет
      $('#allNums').classList.toggle('on', ui.scope === 'all');
      $('#allNumsCount').textContent = countByNum().reduce((x, y) => x + y, 0);
    }
    $('#allBar').style.width = tried ? pct(avg) + '%' : '0';
    $('#favCard').classList.toggle('on', inTrainer && ui.scope === 'fav');
    $('#favCount').textContent = prefs.fav.length;
    $('#histCount').textContent = P.log.filter(e => !e.b).length;
    $('#examCard').classList.toggle('on', examShown || (courseShown && pageKind === 'exams'));
    $('#histCard')?.classList.toggle('on', courseShown && pageKind === 'history');
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
      const p = st.s && st.s.a ? pct(st.s.m) : 0;
      // кольцо освоения вокруг номера; у широкой плитки 19–21 — полоска
      const body = wide ? `<span class="n">${numLabel(n)}</span><span class="c">${counts[n]}</span><i class="bar"><b style="width:${p}%"></b></i>`
        : `<span class="ring" style="--p:${p}"><span class="n">${numLabel(n)}</span></span><span class="c">${counts[n]}</span>`;
      return `<button class="${cls.join(' ')}" data-n="${n}" type="button" title="${esc(tip)}" ${counts[n] ? '' : 'disabled'}>
        ${body}<i class="dot"></i></button>`;
    }).join('');

    renderPeriod();
    $('#sideToggleLabel').textContent = examShown ? 'Вариант ЕГЭ' : ui.scope === 'all' ? 'Все задания' : ui.scope === 'fav' ? 'Избранное'
      : ui.scope === 'asg' ? (asgOf(ui.asg) && asgOf(ui.asg).duel ? 'Турнир' : asgOf(ui.asg) && asgOf(ui.asg).course ? 'Курс' : 'От учителя') : `№ ${numLabel(ui.scope)}`;
    const asgOn = inTrainer && ui.scope === 'asg' && !(asgOf(ui.asg) || {}).course;
    $('#duelCard')?.classList.toggle('on', (courseShown && pageKind === 'tour') || (inTrainer && ui.scope === 'asg' && !!(asgOf(ui.asg) || {}).tour));
    $('#courseCard')?.classList.toggle('on', (courseShown && !pageKind) || (inTrainer && ui.scope === 'asg' && !!(asgOf(ui.asg) || {}).course));
    $('#asgCard').classList.toggle('on', asgOn || (courseShown && pageKind === 'asg'));
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
    exStrictLeave();
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
    const wasExam = examShown, wasPage = courseShown;       // открыта страница (курс, турниры, подборки) — уходим с неё к заданиям
    if (!leaveExam()) return;
    if (ui.scope === s && !wasExam && !wasPage) return;
    ui.scope = s;
    save();
    renderSidebar();
    if (!wasExam && !wasPage && cur && !cur.done && inScope(cur.task) && (cur.why || {}).type !== 'asg') { renderTopbar(); return; }
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
    if (e.k) return e.s === 1 ? ['good', 'верно · самостоятельная'] : e.p === 0.5 ? ['mid', 'половина · самостоятельная'] : ['weak', 'ошибка · самостоятельная'];
    if (e.s === 1) return ['good', e.x ? 'верно · вариант' : 'верно'];
    if (e.s === 0.5) return ['mid', 'со 2-й попытки'];
    if (e.b) return ['', 'без ответа · вариант'];
    if (e.p === 0.5) return ['mid', 'верна половина'];
    return ['weak', e.x ? 'ошибка · вариант' : 'ошибка'];
  }

  async function openReview(id, from) {
    let d;
    try { d = await api('asg/review?id=' + id); } catch (e) { netError(e); return; }
    const back = `<button type="button" class="btn ghost" data-review-back="${from || ''}">← Назад</button>`;
    if (d.locked) {
      $('#forecastBody').innerHTML = `${back}<h2 class="fm-title">Разбор: «${esc(d.title)}»</h2><p class="fm-note">${esc(d.locked)}</p>`;
      $('#forecastModal').hidden = false;
      return;
    }
    const mark = c => (c === 1 ? '<span class="chip good">верно</span>' : c === 0.5 ? '<span class="chip">половина</span>' : c === 0 ? '<span class="chip weak">неверно</span>' : '<span class="chip">нет ответа</span>');
    const rows = d.items.map((x, i) => `<div class="rv-item">
      <div class="rv-head"><span class="num-badge sm">${numLabel(x.n)}</span><b>Задание ${i + 1}</b> ${mark(x.credit)}
        ${byId.get(x.top) ? `<button type="button" class="link-btn" data-open="${esc(x.top)}">открыть задание</button>` : ''}</div>
      <div class="rv-ans"><span>Твой ответ: <b>${x.mine ? esc(x.mine) : '—'}</b></span><span>Правильный: ${answerView(x.answer)}</span></div>
      ${x.sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(x.sol)}</div></details>` : ''}
      ${x.tsol ? `<details class="solution"><summary>Решение учителя</summary><pre class="tsol">${esc(x.tsol)}</pre></details>` : ''}
      ${x.code ? `<details class="solution"><summary>Твоё решение (код)</summary><pre class="tsol">${esc(x.code)}</pre></details>` : '<div class="fm-muted">Решение (код) не прикреплено.</div>'}
      <div class="rv-links">${taskLinks({ link: x.link, video: x.video })}</div></div>`).join('');
    const r = d.result || {};
    $('#forecastBody').innerHTML = `${back}<h2 class="fm-title">Разбор: «${esc(d.title)}»</h2>
      ${r.grade ? `<p class="fm-note">Оценка <b>${r.grade}</b> · ${r.pct}% · верно ${r.ok}${r.half ? `, наполовину ${r.half}` : ''}, неверно ${r.bad}${r.blank ? `, без ответа ${r.blank}` : ''}.</p>` : ''}
      <div class="rv-list">${rows}</div>`;
    $$('#forecastBody .solution .cond').forEach(decorateCondition);
    $('#forecastModal').hidden = false;
  }
  document.addEventListener('click', e => {
    const rv = e.target.closest('[data-review]');
    if (rv) { openReview(+rv.dataset.review, rv.dataset.from || ''); return; }
    const bk = e.target.closest('[data-review-back]');
    if (bk) { if (bk.dataset.reviewBack === 'asg') openAssignments(); else closeForecast(); }
  });

  /** История заданий — страница в основной области (как подборки и варианты), а не всплывающее окно. */
  function openHistory() {
    if (!leaveExam()) return;
    if (!(courseShown && pageKind === 'history')) {
      abandonCurrent();
      courseShown = true;
      pageKind = 'history';
      cur = null;
      navPush({ v: 'history' });
      renderSidebar();
      window.scrollTo(0, 0);
    }
    renderHistory();
  }
  function renderHistory() {
    if (!courseShown || pageKind !== 'history') return;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const all = P.log.filter(e => !e.k);                       // самостоятельные — на странице подборок
    const list = all.slice().reverse().filter(e => histFilter === 'all'
      || (histFilter === 'bad' ? e.s < 1 && !e.b : e.t >= dayStart.getTime()));
    const today = all.filter(e => e.t >= dayStart.getTime());
    const bad = all.filter(e => e.s < 1 && !e.b).length;
    const hm = ts => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
    const dayName = ts => {
      const d = new Date(ts), y = new Date(dayStart.getTime() - 864e5);
      if (d >= dayStart) return 'Сегодня';
      if (d >= y) return 'Вчера';
      return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} · ${WD[d.getDay()]}`;
    };
    let lastDay = '';
    const rows = list.slice(0, histLimit).map(e => {
      const t = byId.get(partToGroup.get(e.id) || e.id);
      const [cls, txt] = histResult(e);
      const dn = dayName(e.t);
      const head = dn !== lastDay ? `<h4 class="hist-day">${dn}</h4>` : '';
      lastDay = dn;
      return `${head}<div class="hist-row">
        <span class="hist-when">${hm(e.t)}</span>
        <span class="num-badge sm">${e.n}</span>
        <span class="hist-snip">${t ? esc(plainText(t)) : '<span class="fm-muted">задание удалено из банка</span>'}</span>
        <span class="chip ${cls}">${txt}</span>
        ${t ? `<button type="button" class="btn hist-open" data-open="${esc(e.id)}">Открыть</button>` : '<span></span>'}
      </div>`;
    }).join('');
    $('#scopeInfo').innerHTML = '<span class="scope-title">История</span>';
    document.body.classList.add('asg-wide');
    trainerEl.innerHTML = `<div class="course asg-page hist-page">
      <div class="crs-hero"><div><div class="crs-kicker">История</div><h2>Мои задания</h2>
        <p>Все твои ответы по порядку. «Открыть» — решить задание ещё раз. Уже решённое перерешивается для тренировки:
          без опыта, огонька, серии и достижений. Самостоятельные — на странице «Задания от учителя», варианты — в «Моих вариантах».</p></div>
        <div class="crs-prog"><b>${today.length}</b><span>${plural(today.length, 'ответ', 'ответа', 'ответов')} сегодня · ошибок всего ${bad}</span></div></div>
      <div class="hist-filters">
        ${[['all', 'Все'], ['bad', 'Ошибки'], ['today', 'Сегодня']].map(([k, l]) =>
          `<button type="button" data-hf="${k}" class="${histFilter === k ? 'on' : ''}">${l}</button>`).join('')}
        <span class="fm-muted">${list.length} ${plural(list.length, 'ответ', 'ответа', 'ответов')}</span>
      </div>
      <div class="hist-list">${rows || '<p class="fm-note">Здесь пока пусто.</p>'}</div>
      ${list.length > histLimit ? '<button type="button" class="btn hist-more" data-hmore>Показать ещё</button>' : ''}
    </div>`;
  }
  trainerEl.addEventListener('click', e => {
    if (pageKind !== 'history' || !courseShown) return;
    const hf = e.target.closest('[data-hf]');
    if (hf) { histFilter = hf.dataset.hf; histLimit = 100; renderHistory(); return; }
    if (e.target.closest('[data-hmore]')) { histLimit += 100; renderHistory(); return; }
    const ho = e.target.closest('[data-open]');
    if (ho) { openPast(ho.dataset.open); navPush({ v: 'past', id: ho.dataset.open }); }   // «Назад» вернёт в историю
  });

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
        items = (r.items || []).filter(x => byId.get(x.id)).map(x => ({ id: x.id, n: byId.get(x.id).n }));
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
        <span class="task-tools">${PY_BTN}${BD_BTN}${MARK_BTN}</span>
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
    exStrictLeave();
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
    const menu = $('#goalMenu'), sm = $('#streakMenu');
    if (e.target.closest('#goalBtn')) { menu.hidden = !menu.hidden; sm.hidden = true; return; }
    if (e.target.closest('#streakBtn')) { sm.hidden = !sm.hidden; menu.hidden = true; return; }
    if (e.target.closest('#rankBtn')) { menu.hidden = true; sm.hidden = true; openRating(); return; }
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
    ADMINS = new Set(me.admins || []);
    if (me.game) GAME = me.game;
    COURSE_OK = !!me.course;
    TEACHER = !!me.teacher;                  // учитель решает как ученик: рейтинг видит, но сам в нём не участвует
    document.body.classList.toggle('teacher-mode', TEACHER);
    $('#courseCard')?.classList.toggle('locked', !COURSE_OK);
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




  // ------------------------------------------------------------ доска для решения
  // Панель справа от задания (вместо окна Python): ручка, прямая, текст, ластик. Штрихи хранятся в пикселях листа,
  // у каждого задания своя доска (в браузере ученика, последние BD_KEEP). Цвет «ink» — цвет текста темы.
  const BD_BTN = '<button type="button" class="icon-btn bd-btn" id="bdBtn" title="Доска — решать от руки рядом с задачей">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M7 13l3-3 2 2 4-4"/></svg><span>Доска</span></button>';
  const BD_KEEP = 40, BD_INDEX = 'egeTrainer.boards', bdKey = id => 'egeTrainer.board.' + id;
  const BD_BGS = ['grid', 'lines', 'plain'];
  const BD_FS = [16, 20, 26, 34, 44, 60];
  const BD = { task: null, strokes: [], undo: [], redo: [], tool: 'pen', color: 'ink', size: 2, fs: 20, bg: 'grid', drawing: null, text: null, ro: null, saveT: 0 };
  const bdOpen = () => !$('#bdDock').hidden;
  try { const v = readJSON('egeTrainer.boardPrefs'); if (v) Object.assign(BD, { bg: BD_BGS.includes(v.bg) ? v.bg : 'grid', size: v.size === 5 ? 5 : 2, fs: BD_FS.includes(v.fs) ? v.fs : 20 }); } catch (e) {}
  const bdPrefs = () => writeJSON('egeTrainer.boardPrefs', { bg: BD.bg, size: BD.size, fs: BD.fs });
  // размер текста: у старых надписей его нет — тогда по толщине, как раньше
  const bdFs = st => st.fs || (st.w > 3 ? 22 : 17);
  const bdFont = fs => `${fs}px ${getComputedStyle(document.body).fontFamily}`;

  function bdLoad(id) {
    const d = readJSON(bdKey(id));
    BD.strokes = d && Array.isArray(d.s) ? d.s : [];
    BD.undo = [];
    BD.redo = [];
  }
  function bdSave() {
    clearTimeout(BD.saveT);
    BD.saveT = 0;
    if (!BD.task) return;
    const id = BD.task.id;
    let idx = (readJSON(BD_INDEX) || []).filter(x => x !== id);
    if (BD.strokes.length) {
      idx.push(id);
      while (idx.length > BD_KEEP) { const old = idx.shift(); try { storage && storage.removeItem(bdKey(old)); } catch (e) {} }
      writeJSON(bdKey(id), { s: BD.strokes, t: Date.now() });
    } else {
      try { storage && storage.removeItem(bdKey(id)); } catch (e) {}
    }
    writeJSON(BD_INDEX, idx);
  }
  const bdSaveSoon = () => { clearTimeout(BD.saveT); BD.saveT = setTimeout(bdSave, 400); };
  const bdInk = c => (c === 'ink' ? getComputedStyle(document.body).getPropertyValue('--text').trim() || '#888' : c);

  function bdSize() {
    const cv = $('#bdCanvas'), sh = $('#bdSheet');
    // целые пиксели и на 1px меньше листа: иначе дробная ширина даёт полосы прокрутки, они сужают лист — и так по кругу
    const w = Math.max(50, sh.clientWidth - 1);
    let maxY = 0;
    for (const st of BD.strokes) {
      if (st.k === 'text') maxY = Math.max(maxY, st.y + String(st.t).split('\n').length * bdFs(st) * 1.24 + 10);
      else for (let i = 1; i < st.p.length; i += 2) if (st.p[i] > maxY) maxY = st.p[i];
    }
    const h = Math.max(sh.clientHeight - 1, maxY + 320);      // лист растёт вниз, пока решаешь
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    return dpr;
  }
  function bdDrawStroke(g, st) {
    g.strokeStyle = g.fillStyle = bdInk(st.c);
    if (st.k === 'text') {
      const fs = bdFs(st);
      g.font = bdFont(fs);
      g.textBaseline = 'top';
      String(st.t).split('\n').forEach((ln, i) => g.fillText(ln, st.x, st.y + i * fs * 1.24));
      return;
    }
    const p = st.p;
    g.lineWidth = st.w;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    if (p.length === 2) { g.lineTo(p[0] + 0.1, p[1]); }
    else if (st.k === 'line' || p.length === 4) { g.lineTo(p[p.length - 2], p[p.length - 1]); }
    else {
      for (let i = 2; i < p.length - 2; i += 2) {        // сглаживание: кривые через середины отрезков
        const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
        g.quadraticCurveTo(p[i], p[i + 1], mx, my);
      }
      g.lineTo(p[p.length - 2], p[p.length - 1]);
    }
    g.stroke();
  }
  function bdRedraw() {
    if (!bdOpen()) return;
    const cv = $('#bdCanvas'), dpr = bdSize(), g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const st of BD.strokes) bdDrawStroke(g, st);
    if (BD.drawing && BD.drawing.p) bdDrawStroke(g, BD.drawing);
    cv.dataset.bg = BD.bg;
    cv.dataset.tool = BD.tool;
    $('#bdUndo').disabled = !BD.undo.length;
    $('#bdRedo').disabled = !BD.redo.length;
  }
  function bdPos(e) {
    const r = $('#bdCanvas').getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  }
  function bdEraseAt(x, y) {
    const R = 10;
    const hit = st => {
      if (st.k === 'text') {
        const fs = bdFs(st), lines = String(st.t).split('\n'), lh = fs * 1.24;
        const g = $('#bdCanvas').getContext('2d');
        g.font = bdFont(fs);
        const w = Math.max(...lines.map(l => g.measureText(l).width));
        return x >= st.x - R && x <= st.x + w + R && y >= st.y - R && y <= st.y + lines.length * lh + R;
      }
      const p = st.p;
      for (let i = 0; i < p.length; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2] != null ? p[i + 2] : ax, by = p[i + 3] != null ? p[i + 3] : ay;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= (R + st.w / 2) ** 2) return true;
      }
      return false;
    };
    const keep = BD.strokes.filter(st => !hit(st));
    if (keep.length !== BD.strokes.length) {
      bdDo({ del: BD.strokes.filter(st => !keep.includes(st)) });
      BD.strokes = keep;
      bdRedraw();
      bdSaveSoon();
    }
  }
  function bdTextCommit() {
    const ta = BD.text;
    if (!ta) return;
    BD.text = null;
    const t = ta.value.replace(/\s+$/, '');
    if (t) { const st = { k: 'text', c: BD.color, w: BD.size, fs: +ta.dataset.fs || BD.fs, x: +ta.dataset.x, y: +ta.dataset.y, t: bdWrap(t.slice(0, 2000), +ta.dataset.fs || BD.fs, +ta.dataset.w || 1e9) }; BD.strokes.push(st); bdDo({ add: [st] }); bdSaveSoon(); }
    ta.remove();
    bdRedraw();
  }
  /** Переносим длинные строки по ширине доски — как они переносились в поле ввода. */
  function bdWrap(text, fs, maxW) {
    const g = $('#bdCanvas').getContext('2d');
    g.font = bdFont(fs);
    return text.split('\n').map(line => {
      const out = [];
      let cur = '';
      for (const word of line.split(/(\s+)/)) {
        if (cur && g.measureText(cur + word).width > maxW) { out.push(cur.trimEnd()); cur = word.trimStart(); }
        else cur += word;
        while (cur.length > 1 && g.measureText(cur).width > maxW) {          // слово длиннее строки — режем по буквам
          let k = cur.length - 1;
          while (k > 1 && g.measureText(cur.slice(0, k)).width > maxW) k--;
          out.push(cur.slice(0, k)); cur = cur.slice(k);
        }
      }
      out.push(cur);
      return out.join('\n');
    }).join('\n');
  }
  function bdTextAt(x, y) {
    bdTextCommit();
    const ta = document.createElement('textarea');
    ta.className = 'bd-text';
    // поле не шире свободного места до правого края: иначе лист уезжает вбок и справа остаются «следы» рисования
    const avail = Math.max(40, $('#bdSheet').clientWidth - x - 10);
    ta.style.width = avail + 'px';
    ta.style.minWidth = '0';
    ta.dataset.w = avail - 6;
    ta.dataset.x = x; ta.dataset.y = y;
    ta.style.left = x + 'px'; ta.style.top = y + 'px';
    ta.style.color = bdInk(BD.color);
    ta.dataset.fs = BD.fs;
    ta.style.fontSize = BD.fs + 'px';
    ta.rows = 1;
    ta.placeholder = 'текст…';
    ta.addEventListener('blur', bdTextCommit);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
      e.stopPropagation();
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    $('#bdSheet').appendChild(ta);
    BD.text = ta;
    ta.focus({ preventScroll: true });
  }
  $('#bdCanvas').addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    const [x, y] = bdPos(e);
    if (BD.tool === 'text') { bdTextAt(x, y); return; }
    bdTextCommit();
    $('#bdCanvas').setPointerCapture(e.pointerId);
    if (BD.tool === 'eraser') { BD.drawing = { erasing: true }; bdEraseAt(x, y); return; }
    BD.drawing = { k: BD.tool === 'line' ? 'line' : 'pen', c: BD.color, w: BD.size, p: [x, y] };
    bdRedraw();
  });
  $('#bdCanvas').addEventListener('pointermove', e => {
    const d = BD.drawing;
    if (!d) return;
    const [x, y] = bdPos(e);
    if (d.erasing) { bdEraseAt(x, y); return; }
    if (d.k === 'line') { d.p = [d.p[0], d.p[1], x, y]; }
    else {
      const lx = d.p[d.p.length - 2], ly = d.p[d.p.length - 1];
      if ((x - lx) ** 2 + (y - ly) ** 2 < 2.5) return;
      d.p.push(x, y);
    }
    bdRedraw();
  });
  const bdUp = () => {
    const d = BD.drawing;
    BD.drawing = null;
    if (!d || d.erasing) return;
    if (d.p.length > 200000) return;
    BD.strokes.push(d);
    bdDo({ add: [d] });
    bdRedraw();
    bdSaveSoon();
  };
  $('#bdCanvas').addEventListener('pointerup', bdUp);
  $('#bdCanvas').addEventListener('pointercancel', bdUp);

  // история: {add: [штрихи]} — нарисовал, {del: [штрихи]} — стёр ластиком или очистил
  function bdDo(act) {
    BD.undo.push(act);
    if (BD.undo.length > 200) BD.undo.shift();
    BD.redo = [];
  }
  function bdApply(act, back) {
    const add = back ? act.del : act.add, del = back ? act.add : act.del;
    if (del) BD.strokes = BD.strokes.filter(st => !del.includes(st));
    if (add) BD.strokes.push(...add);
    bdRedraw(); bdSaveSoon();
  }
  function bdUndo() {
    bdTextCommit();
    const act = BD.undo.pop();
    if (!act) return;
    BD.redo.push(act);
    bdApply(act, true);
  }
  function bdRedoAct() {
    const act = BD.redo.pop();
    if (!act) return;
    BD.undo.push(act);
    bdApply(act, false);
  }
  /** Размер текста: шаг вверх/вниз. Меняет и надпись, которую сейчас печатают. */
  function bdSetFs(dir) {
    const i = BD_FS.indexOf(BD.fs);
    BD.fs = BD_FS[Math.max(0, Math.min(BD_FS.length - 1, (i < 0 ? 1 : i) + dir))];
    bdPrefs();
    bdFsLabel();
    if (BD.text) {
      BD.text.dataset.fs = BD.fs;
      BD.text.style.fontSize = BD.fs + 'px';
      BD.text.dispatchEvent(new Event('input'));
      BD.text.focus();
    } else if (BD.tool !== 'text') bdSetTool('text');
  }
  function bdFsLabel() {
    const l = $('#bdFsVal');
    if (l) l.textContent = BD.fs;
    const i = BD_FS.indexOf(BD.fs);
    const dn = $('#bdDock [data-bd-fs="-1"]'), up = $('#bdDock [data-bd-fs="1"]');
    if (dn) dn.disabled = i <= 0;
    if (up) up.disabled = i >= BD_FS.length - 1;
  }
  function bdSetTool(t) {
    bdTextCommit();
    BD.tool = t;
    $$('#bdDock [data-bd-tool]').forEach(b => { const on = b.dataset.bdTool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#bdCanvas').dataset.tool = t;
  }
  $('#bdDock').addEventListener('click', e => {
    const tl = e.target.closest('[data-bd-tool]');
    if (tl) { bdSetTool(tl.dataset.bdTool); return; }
    const c = e.target.closest('[data-bd-color]');
    if (c) {
      BD.color = c.dataset.bdColor;
      $$('#bdDock [data-bd-color]').forEach(b => b.classList.toggle('on', b === c));
      if (BD.tool === 'eraser') bdSetTool('pen');
      return;
    }
    const fz = e.target.closest('[data-bd-fs]');
    if (fz) { bdSetFs(+fz.dataset.bdFs); return; }
    const sz = e.target.closest('[data-bd-size]');
    if (sz) {
      BD.size = +sz.dataset.bdSize;
      $$('#bdDock [data-bd-size]').forEach(b => b.classList.toggle('on', b === sz));
      bdPrefs();
      return;
    }
    const id = e.target.closest('button') && e.target.closest('button').id;
    if (id === 'bdUndo') bdUndo();
    else if (id === 'bdRedo') bdRedoAct();
    else if (id === 'bdClose') toggleBoard(false);
    else if (id === 'bdToPy') { toggleBoard(false); togglePy(true); }
    else if (id === 'bdWide') {
      const on = document.body.classList.toggle('bd-wide');
      $('#bdWide').setAttribute('aria-pressed', String(on));
      setTimeout(bdRedraw, 30);
    } else if (id === 'bdBg') {
      BD.bg = BD_BGS[(BD_BGS.indexOf(BD.bg) + 1) % BD_BGS.length];
      bdPrefs();
      bdRedraw();
    } else if (id === 'bdClear') {
      if (!BD.strokes.length || !confirm('Очистить доску этого задания? Вернуть можно кнопкой ↶')) return;
      bdDo({ del: BD.strokes });
      BD.strokes = [];
      bdRedraw(); bdSave();
    }
  });
  document.addEventListener('keydown', e => {
    if (!bdOpen() || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (!$('#forecastModal').hidden) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'я') && !e.shiftKey) { e.preventDefault(); bdUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'н' || ((k === 'z' || k === 'я') && e.shiftKey))) { e.preventDefault(); bdRedoAct(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = { p: 'pen', з: 'pen', l: 'line', д: 'line', t: 'text', е: 'text', e: 'eraser', у: 'eraser' }[k];
    if (tool) bdSetTool(tool);
  });

  // кнопки размера текста не забирают фокус у надписи, которую печатают, — она растёт прямо на глазах
  $('#bdDock').addEventListener('mousedown', e => { if (e.target.closest('[data-bd-fs]') && BD.text) e.preventDefault(); });
  function toggleBoard(force) {
    const open = force != null ? force : !bdOpen();
    if (open && pyOpen()) togglePy(false);             // справа одна панель: или Python, или доска
    if (!open) { bdTextCommit(); bdSave(); }
    $('#bdDock').hidden = !open;
    document.body.classList.toggle('bd-open', open);
    $$('#bdBtn').forEach(b => b.classList.toggle('on', open));
    if (!open) return;
    if (isNarrow()) setSideOpen(false);
    BD.task = null;
    $$('#bdDock [data-bd-size]').forEach(b => b.classList.toggle('on', +b.dataset.bdSize === BD.size));
    bdFsLabel();
    bdSync();
    if (!BD.ro && window.ResizeObserver) {
      let last = '';
      BD.ro = new ResizeObserver(([en]) => {                // перерисовка только при настоящей смене размера
        const k = Math.round(en.contentRect.width) + 'x' + Math.round(en.contentRect.height);
        if (k !== last) { last = k; requestAnimationFrame(bdRedraw); }
      });
      BD.ro.observe($('#bdSheet'));
      // по горизонтали лист не прокручивается никогда (браузер может сдвинуть его к курсору в поле текста)
      $('#bdSheet').addEventListener('scroll', e => { if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0; });
    }
  }
  /** Доска следует за открытым заданием: у каждого своя. */
  function bdSync() {
    if (!bdOpen()) return;
    $$('#bdBtn').forEach(b => b.classList.add('on'));
    const t = pyTaskNow();
    const id = t ? t.id : 'free';
    if (BD.task && BD.task.id === id) { bdRedraw(); return; }
    bdTextCommit();
    if (BD.task) bdSave();
    BD.task = t ? { id: t.id, n: t.n } : { id: 'free' };
    bdLoad(id);
    $('#bdTask').textContent = t ? `задание ${numLabel(t.n)}` : 'черновик';
    $('#bdSheet').scrollTop = 0;
    bdRedraw();
  }
  window.addEventListener('beforeunload', () => { if (BD.saveT) bdSave(); });

  // ------------------------------------------------------------ Python в браузере
  // Настоящий CPython (Pyodide) в отдельном потоке: math, itertools, functools, ipaddress, re, string, collections…
  // Файлы задания лежат рядом с кодом — open('17.txt') работает. Черепашка для №6 рисует на холсте.
  const PY_BTN = '<button type="button" class="icon-btn py-btn" id="pyBtn" title="Решить на Python прямо здесь">Python</button>';
  const PY = { worker: null, ready: false, running: false, task: null, saveTimer: null };
  const pyOpen = () => !$('#pyDock').hidden;
  const pyTaskNow = () => (examShown && EX ? byId.get((EX.items[EX.cur] || {}).id) : cur && cur.task) || null;

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
    el.title = `Уровень ${GAME.level} · ${GAME.title} — опыт и достижения`;
  }
  function xpPop(v) {
    if (viewPrefs().focus || !viewPrefs().anim) return;
    const b = document.createElement('div');
    b.className = 'xp-pop';
    b.textContent = v < 0 ? `−${-v} XP` : `+${v} XP`;
    if (v < 0) b.classList.add('minus');
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
    t.innerHTML = `<span class="ach-icon">${esc(a.icon)}</span><span><small>Новое достижение${a.xp ? ` · +${a.xp} XP` : ''}</small><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></span>`;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 4200);
  }
  function onGame(g) {
    const old = GAME;
    GAME = g;
    renderLevel();
    if (!old) return;
    if (g.xp !== old.xp) xpPop(g.xp - old.xp);
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
        <span><b>${esc(a.title)}</b><small>${esc(a.desc)}${a.got ? '' : ` · ${a.have}/${a.goal}`}</small></span>
        ${a.xp ? `<span class="ach-xp${a.xp >= 150 ? ' epic' : a.xp >= 50 ? ' hard' : ''}">+${a.xp}</span>` : ''}</div>`).join('');
    $('#forecastBody').innerHTML = `
      <div class="gm-head"><span class="gm-level">${g.level}</span>
        <div style="flex:1"><h2 class="fm-title" style="margin:0">${esc(g.title)}</h2>
          <i class="xp-bar"><b style="width:${pct(g.cur / g.need)}%"></b></i>
          <span class="fm-muted">${g.cur} / ${g.need} XP до ${g.level + 1}-го уровня · всего ${g.xp} XP · за неделю +${g.week}</span></div></div>
      <p class="fm-note">Опыт даётся за первое верное решение задания: №1–10 — 10 XP, №11–27 — столько, какой номер, и +5 XP за каждую ступень сложности выше первой (до +20); со второй попытки — половина; перерешать уже решённое (из истории) можно для тренировки, но без опыта, огонька, серии и достижений;
        вторая попытка — половина. Ещё +15 XP за пять решённых за день и за вариант ЕГЭ — 30 XP и по 3 XP за первичный балл.
        За достижения — от 5 до 300 XP: чем труднее получить, тем больше.
        <b>Верный ответ быстрее чем за минуту</b> с открытия задания — <b>−1 XP</b>: так быстро задания обычно не решают, а подсматривают.</p>
      <p><button type="button" class="btn small" data-prof="me">🏅 Мой профиль: награды и значки у ника</button></p>
      ${(g.xplog || []).length ? `<details class="xp-log"><summary>Откуда опыт: последние изменения</summary><table class="fm-table">${g.xplog.map(x => {
        const d = new Date(x.ts * 1000);
        return `<tr><td class="fm-muted">${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}</td>
          <td>${esc(x.why)}</td><td class="num ${x.v > 0 ? 'xp-plus' : x.v < 0 ? 'xp-minus' : 'fm-muted'}">${x.v > 0 ? '+' : x.v < 0 ? '−' : ''}${Math.abs(x.v)} XP</td></tr>`;
      }).join('')}</table>
        <p class="fm-note">Минус — только за верный ответ быстрее минуты (−1) и проигранную дуэль. Ноль — за уже решённое задание или задание, ответ на которое уже показывали.</p></details>` : ''}
      <h3 class="fm-sub">Достижения · ${got} из ${(g.ach || []).length}</h3>
      <div class="ach-grid">${ach}</div>
      <p class="fm-note">Рейтинг — кнопка с кубком в верхней панели.</p>`;
    $('#forecastModal').hidden = false;
  }

  // ------------------------------------------------------------ соревнования: лига, рейтинги, классы, значки
  const LB_TABS = [['league', 'Лига'], ['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['fire', 'Огонёк'], ['classes', 'Классы']];
  const LEAGUE_ICONS = ['🥉', '🥈', '🥇', '💎'];
  const LEAGUE_NAMES = ['Бронзовая', 'Серебряная', 'Золотая', 'Алмазная'];
  const LEAGUE_TO = ['бронзовую', 'серебряную', 'золотую', 'алмазную'];      // «поднимутся в … лигу»
  const lbValue = (key, v) => key === 'fire' ? `${v} ${plural(v, 'день', 'дня', 'дней')}` : `+${v} XP`;
  /** Значок у ника: строка (старый формат) или {i, t, n} — у повторяемых наград маленькое число, сколько раз получена. */
  const badgeHtml = b => typeof b === 'string' ? esc(b)
    : `<span class="bdg" title="${esc(b.t || '')}${b.n ? ' × ' + b.n : ''}">${esc(b.i)}${b.n ? `<sup>${b.n}</sup>` : ''}</span>`;
  const badgesHtml = r => (r.badges || []).length ? ` <span class="lb-badges">${r.badges.map(badgeHtml).join('')}</span>` : '';
  const nameHtml = r => (r.sid ? `<button type="button" class="lb-name" data-prof="${r.sid}" title="Открыть профиль">${esc(r.name)}</button>` : esc(r.name)) + admTag(r.sid);
  const placeHtml = p => p <= 3 ? ['🥇', '🥈', '🥉'][p - 1] : p;
  const daysLeft = endSec => Math.max(0, Math.ceil((endSec * 1000 - Date.now()) / 864e5));

  function leagueHtml(L) {
    const row = r => {
      const zone = r.value > 0 && r.place <= L.up ? 'up' : L.down && r.place > L.total - L.down ? 'down' : '';
      return `<tr class="${r.me ? 'me' : ''} ${zone ? 'z-' + zone : ''}"><td class="lb-place">${placeHtml(r.place)}</td>
        <td>${nameHtml(r)}${badgesHtml(r)}</td><td class="fm-muted">ур. ${r.level}</td>
        <td class="num">${zone === 'up' ? '<span class="z-mark up" title="Поднимется в лигу выше">▲</span>' : zone === 'down' ? '<span class="z-mark down" title="Опустится в лигу ниже">▼</span>' : ''} +${r.value} XP</td></tr>`;
    };
    const mineOut = L.me && L.me.place > L.top.length;              // я ниже 20-го места — покажу свою строку отдельно
    const left = daysLeft(L.ends);
    return `<div class="lg-head"><span class="lg-icon">${L.icon}</span><div><b>${esc(L.name)}</b>
        <div class="fm-muted">Итоги в понедельник — ${left ? `через ${left} ${plural(left, 'день', 'дня', 'дней')}` : 'сегодня ночью'}.
        ${L.up ? `Первые ${L.up} поднимутся в ${LEAGUE_TO[L.idx + 1]} лигу.` : 'Это высшая лига — удержись в ней!'}
        ${L.down ? ` Последние ${L.down} опустятся.` : ''}</div></div></div>
      ${L.top.length ? `<table class="lb">${L.top.map(row).join('')}${mineOut ? `<tr class="lb-gap"><td colspan="4">…</td></tr>${row({ place: L.me.place, name: 'Ты', me: true, level: '', badges: [], value: L.me.value, sid: student && student.sid })}` : ''}</table>`
        : '<p class="fm-muted lb-empty">В лиге пока никого — реши задание, и ты в игре.</p>'}
      ${L.total > L.top.length ? `<p class="fm-muted lb-mine">Показаны первые ${L.top.length} из ${L.total}.</p>` : ''}`;
  }
  function classesHtml(C) {
    if (!C.list.length) return '<p class="fm-muted lb-empty">Классов пока нет: битва начнётся, когда учитель распределит учеников по классам.</p>';
    return C.list.map((c, i) => {
      const goal = c.goal ? `<div class="cl-goal"><i class="xp-bar"><b style="width:${Math.min(100, pct(c.solved / c.goal))}%"></b></i>
        <span>${c.solved} / ${c.goal} заданий${c.reward ? ` — ${esc(c.reward)}` : ''}${c.solved >= c.goal ? ' ✅' : ''}</span></div>` : '';
      return `<div class="cl-row${c.mine ? ' me' : ''}"><span class="lb-place">${placeHtml(i + 1)}</span>
        <div class="cl-main"><b>${esc(c.name)}</b>${c.mine ? ' <span class="chip good">твой класс</span>' : ''}
          <span class="fm-muted"> · ${c.members} ${plural(c.members, 'ученик', 'ученика', 'учеников')}</span>${goal}</div>
        <span class="num">+${c.xp} XP</span></div>`;
    }).join('') + '<p class="fm-muted lb-mine">Опыт всех учеников класса с понедельника. Цель и награду задаёт учитель.</p>';
  }
  /** Переключатель лиг: своя — по умолчанию, остальные можно посмотреть (без своей строки). */
  function leaguesHtml(B, view) {
    const own = B.league, all = B.leagues || [];
    const idx = view == null ? (own ? own.idx : 0) : view;
    const sw = all.length ? `<div class="lg-switch" role="tablist">${all.map(L => `<button type="button" data-lgview="${L.idx}" class="${L.idx === idx ? 'on' : ''}">
        <span>${L.icon}</span>${esc(LEAGUE_NAMES[L.idx])}<small>${L.total}${own && L.idx === own.idx ? ' · твоя' : ''}</small></button>`).join('')}</div>` : '';
    if (!all.length || (own && idx === own.idx)) return sw + (own ? leagueHtml(own) : '');
    const L = Object.assign({}, all[idx], { ends: own ? own.ends : 0, me: null });
    const note = own ? (idx === own.idx + 1 ? `Ты в лиге «${esc(LEAGUE_NAMES[own.idx])}». Попасть сюда — войти в первые ${own.up} своей лиги по итогам недели.`
      : idx > own.idx ? `Ты в лиге «${esc(LEAGUE_NAMES[own.idx])}». Сюда ведут лиги по очереди: каждую неделю — на одну ступень выше.`
      : `Ты выше — в лиге «${esc(LEAGUE_NAMES[own.idx])}».`) : '';
    return sw + leagueHtml(L) + (note ? `<p class="fm-muted lb-mine">${note}</p>` : '');
  }
  function boardHtml(d, key, view) {
    const B = d.boards || {};
    if (key === 'league') return B.league || B.leagues ? leaguesHtml(B, view) : '';
    if (key === 'classes') return B.classes ? classesHtml(B.classes) : '';
    const b = B[key] || { top: [] };
    if (!b.top.length) {
      return `<p class="fm-muted lb-empty">${key === 'day' ? 'Сегодня ещё никто не решал — стань первым!'
        : key === 'fire' ? 'Пока ни у кого не горит огонёк. Реши 3 задания за день, чтобы зажечь его.' : 'Пока пусто.'}</p>`;
    }
    const rows = b.top.map(r => `<tr class="${r.me ? 'me' : ''}"><td class="lb-place">${placeHtml(r.place)}</td>
      <td>${nameHtml(r)}${badgesHtml(r)}</td><td class="fm-muted">ур. ${r.level}</td><td class="num">${lbValue(key, r.value)}</td></tr>`).join('');
    const mine = b.me && b.me.place > 10
      ? `<p class="lb-mine">Твоё место: <b>${b.me.place}</b> из ${b.total} · ${lbValue(key, b.me.value)}</p>`
      : (!b.me ? `<p class="lb-mine fm-muted">${key === 'fire' ? 'Зажги огонёк — и попадёшь в рейтинг' : 'Реши задание — и попадёшь в рейтинг'}</p>` : '');
    return `<table class="lb">${rows}</table>${mine}`;
  }
  function boardsHtml(d, key) {
    const noClasses = !(d.boards && d.boards.classes && d.boards.classes.list.length);   // учитель не включил битву классов
    const tabs = LB_TABS.filter(([k]) => k !== 'classes' || !noClasses);
    return `<div class="lb-wrap" data-lb='${esc(JSON.stringify(d))}'>
      <div class="lb-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" data-lbtab="${k}" class="${k === key ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="lb-body">${boardHtml(d, key)}</div>
      <p class="fm-muted lb-legend">Нажми на имя — откроется профиль с наградами. Значки у ника (до трёх) каждый выбирает сам в своём профиле;
        число у значка — сколько раз награда получена: 👑 — быстрее всех решил задание дня, 🏆 — 1-е место в лиге за неделю, 🚀 — повышение, ⚔️ — победа в дуэли.</p></div>`;
  }
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-lbtab]');
    if (!tab) return;
    const wrap = tab.closest('.lb-wrap');
    let d = {};
    try { d = JSON.parse(wrap.dataset.lb); } catch (err) { return; }
    $$('[data-lbtab]', wrap).forEach(b => b.classList.toggle('on', b === tab));
    $('.lb-body', wrap).innerHTML = boardHtml(d, tab.dataset.lbtab);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-lgview]');
    if (!b) return;
    const wrap = b.closest('.lb-wrap');
    let d = {};
    try { d = JSON.parse(wrap.dataset.lb); } catch (err) { return; }
    $('.lb-body', wrap).innerHTML = boardHtml(d, 'league', +b.dataset.lgview);
  });

  // ------------------------------------------------------------ профиль: награды, достижения, значки у ника
  let PROF = null, profPick = null, profBack = null;
  async function openProfile(sid, back) {
    profBack = back || null;
    $('#forecastBody').innerHTML = '<h2 class="fm-title">Профиль</h2><p class="fm-muted">Загружаю…</p>';
    $('#forecastModal').hidden = false;
    try { PROF = await api('profile' + (sid && sid !== 'me' ? '?sid=' + encodeURIComponent(sid) : '')); } catch (e) {
      $('#forecastBody').innerHTML = `<h2 class="fm-title">Профиль</h2><p class="fm-muted">${esc(e.message || 'Нет связи с сервером.')}</p>`;
      return;
    }
    profPick = null;
    renderProfile();
  }
  function profItem(a, kind) {
    const has = kind === 'ach' || a.n > 0 || kind === 'extra';
    const on = profPick && profPick.includes(a.k);
    const count = a.n && kind !== 'extra' ? `<span class="pf-n">×${a.n}</span>` : a.n ? `<span class="pf-n">${a.n} ${plural(a.n, 'день', 'дня', 'дней')}</span>` : '';
    const tag = profPick && has ? 'button type="button"' : 'div';
    return `<${tag} class="ach pf-item${has ? '' : ' locked'}${on ? ' on' : ''}"${profPick && has ? ` data-pick="${esc(a.k)}" aria-pressed="${on}"` : ''} title="${esc(a.d)}">
      <span class="ach-icon">${esc(a.i)}</span><span><b>${esc(a.t)}</b><small>${esc(a.d)}</small></span>${count}${on ? '<span class="pf-check">✓</span>' : ''}</${tag.split(' ')[0]}>`;
  }
  function renderProfile() {
    const P = PROF;
    if (!P) return;
    const back = profBack === 'rating' ? '<button type="button" class="btn small ghost" id="profBack">← к рейтингу</button>' : '';
    const pick = profPick;
    const nick = (pick ? pick.map(k => [...P.awards, ...P.extra, ...P.ach].find(a => a.k === k)).filter(Boolean)
      .map(a => ({ i: a.i, t: a.t, n: a.k === 'fire' || a.n > 1 ? a.n : 0 })) : P.badges);
    const tools = !P.me ? '' : pick
      ? `<div class="pf-tools"><span class="fm-muted">Выбрано ${pick.length} из ${P.max} — нажимай на полученные награды и достижения.</span>
          <button type="button" class="btn small" id="profSave">Сохранить</button>
          <button type="button" class="btn small ghost" id="profAuto">Автоматически</button>
          <button type="button" class="btn small ghost" id="profCancel">Отмена</button></div>`
      : `<div class="pf-tools"><button type="button" class="btn small" id="profEdit">Выбрать значки у ника</button>
          <span class="fm-muted">${P.chosen ? 'Выбраны тобой.' : 'Сейчас — автоматически: огонёк 7+, корона дня, алмазная лига.'}</span></div>`;
    $('#forecastBody').innerHTML = `${back}
      <div class="gm-head"><span class="gm-level">${P.level}</span>
        <div style="flex:1"><h2 class="fm-title" style="margin:0">${esc(P.name)}${admTag(P.sid)}${P.me ? ' <span class="chip good">это ты</span>' : ''}</h2>
          <span class="fm-muted">${esc(P.title)} · ${P.league.icon} ${esc(P.league.name)} · ${P.xp} XP</span>
          <div class="pf-nick">У ника: ${nick.length ? `<span class="lb-badges">${nick.map(badgeHtml).join('')}</span>` : '<span class="fm-muted">пока ничего</span>'}</div></div></div>
      ${tools}
      <h3 class="fm-sub">Награды — можно получать много раз</h3>
      <div class="ach-grid">${P.awards.map(a => profItem(a, 'award')).join('')}${P.extra.map(a => profItem(a, 'extra')).join('')}</div>
      <h3 class="fm-sub">Достижения · ${P.ach.length} из ${P.ach_total} — даются один раз</h3>
      ${P.ach.length ? `<div class="ach-grid">${P.ach.map(a => profItem(a, 'ach')).join('')}</div>` : '<p class="fm-muted">Пока ни одного.</p>'}`;
  }
  async function saveBadges(keys) {
    try { await api('profile/badges', { keys }); } catch (e) { toast(e.message || 'Не получилось сохранить'); return; }
    await openProfile('me', profBack);
    loadRating();
  }
  document.addEventListener('click', e => {
    const pr = e.target.closest('[data-prof]');
    if (pr) { openProfile(pr.dataset.prof, pr.closest('.lb-wrap') ? 'rating' : null); return; }
    if (!PROF || !e.target.closest('#forecastBody')) return;
    const t = e.target.closest('#profBack, #profEdit, #profSave, #profAuto, #profCancel, [data-pick]');
    if (!t) return;
    if (t.id === 'profBack') return openRating();
    if (t.id === 'profEdit') { profPick = (PROF.chosen || PROF.badges.map(b => b.k)).slice(0, PROF.max); return renderProfile(); }
    if (t.id === 'profCancel') { profPick = null; return renderProfile(); }
    if (t.id === 'profSave') return saveBadges(profPick);
    if (t.id === 'profAuto') return saveBadges(null);
    const k = t.dataset.pick;
    if (profPick.includes(k)) profPick = profPick.filter(x => x !== k);
    else if (profPick.length < PROF.max) profPick.push(k);
    else toast(`Не больше ${PROF.max} значков — сначала сними один`);
    renderProfile();
  });

  // кнопка в верхней панели: лига и место в ней; по клику — все рейтинги
  let LB = null, lbTimer = null;
  const CUP = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path class="cup-b" d="M7 3h10v2h3a1 1 0 0 1 1 1v2a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 13 5 5 0 0 1 3 8V6a1 1 0 0 1 1-1h3V3Zm10 4v3.9A3 3 0 0 0 19 8V7h-2ZM5 7v1a3 3 0 0 0 2 2.9V7H5Z"/></svg>';
  function rankBtnHtml() {
    const L = LB && LB.boards && LB.boards.league;
    const me = L && L.me;
    const top3 = me && me.value > 0 && me.place <= 3;
    return `<button type="button" class="rank-btn${me && me.value ? '' : ' none'}${top3 ? ' top' : ''}" id="rankBtn" title="${L ? esc(L.name) + ' · ' : ''}рейтинги: лига, день, неделя, месяц, огонёк, классы">
      ${L ? `<span class="rank-lg">${L.icon}</span>` : CUP}<span>${me && me.value ? `<b>${me.place}</b> место` : 'Рейтинг'}</span></button>`;
  }
  async function loadRating() {
    try { LB = await api('leaderboard'); } catch (e) { return; }
    const b = $('#rankBtn');
    if (b) b.outerHTML = rankBtnHtml();
    saveLeagueSnap();
  }
  async function openRating(tab) {
    if (isNarrow()) setSideOpen(false);
    $('#forecastBody').innerHTML = '<h2 class="fm-title">Рейтинг</h2><p class="fm-muted">Загружаю…</p>';
    $('#forecastModal').hidden = false;
    await loadRating();
    if (!LB) { $('#forecastBody').innerHTML = '<h2 class="fm-title">Рейтинг</h2><p class="fm-muted">Нет связи с сервером.</p>'; return; }
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Рейтинг</h2>
      ${LB.spectator ? '<p class="daily-used">🎓 Вы учитель: рейтинг ваших учеников виден, но вы сами в нём не участвуете — ни в лиге, ни в ТОП-10, ни в дуэлях.</p>' : ''}
      <p class="fm-note">${LB.spectator ? 'Ваши ученики' : 'Ученики твоего учителя'}. Лига — опыт с понедельника; день, неделя, месяц — ТОП-10.</p>${boardsHtml(LB, tab || 'league')}`;
  }

  // «Тебя обогнали!»: сравниваем лигу с тем, что видели в прошлый раз
  const snapKey = () => `egeTrainer.lgSnap.${student ? student.sid : ''}`;
  function saveLeagueSnap() {
    const L = LB && LB.boards && LB.boards.league;
    if (!L || !L.me) return;
    writeJSON(snapKey(), { week: L.week, place: L.me.place, xp: L.me.value, above: L.top.filter(r => r.place < L.me.place).map(r => r.name) });
  }
  function overtakeNote(L) {
    if (!L || !L.me || !L.me.value && !L.top.length) return '';
    const prev = readJSON(snapKey());
    const me = L.me, above = L.top.find(r => r.place === me.place - 1);
    const tasks = gap => Math.max(1, Math.ceil((gap + 1) / 10));
    if (prev && prev.week === L.week && me.place > prev.place) {
      const passer = L.top.find(r => r.place < me.place && !(prev.above || []).includes(r.name));
      if (passer) {
        const gap = passer.value - me.value;
        const k = tasks(above ? above.value - me.value : 0);
        return `<b>${esc(passer.name)}</b> обогнал тебя на ${gap} XP — до ${me.place - 1}-го места ${k} ${plural(k, 'задание', 'задания', 'заданий')}. Отыграйся!`;
      }
    }
    if (!me.value) {                                         // ещё без опыта на этой неделе
      const last = L.top.filter(r => r.value > 0 && !r.me).pop();
      if (!last) return 'В лиге на этой неделе ещё никто не набрал опыт — реши задание и стань первым!';
      const k = tasks(last.value);
      return `Реши ${k} ${plural(k, 'задание', 'задания', 'заданий')} — и обгонишь ${esc(last.name)} (${last.place}-е место в лиге)`;
    }
    if (above) {
      const gap = above.value - me.value;
      return `До ${me.place - 1}-го места ${gap + 1} XP — примерно ${tasks(gap)} ${plural(tasks(gap), 'задание', 'задания', 'заданий')}. Впереди — ${esc(above.name)}`;
    }
    return 'Ты первый в лиге — держи отрыв!';
  }

  // ------------------------------------------------------------ задание дня
  let DAILY = null;
  async function loadDaily() {
    try { DAILY = await api('daily'); } catch (e) { DAILY = null; }
    renderDailyCard();
  }
  const fmtMs = ms => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${pad2(s % 60)}` : `${s} с`; };
  function renderDailyCard() {
    const card = $('#dailyCard');
    if (!card) return;
    card.hidden = !(DAILY && DAILY.task && byId.get(DAILY.task));
    if (card.hidden) return;
    $('#dailySub').textContent = DAILY.my_place ? `${DAILY.my_place}-е место` : DAILY.started ? 'уже заходили' : DAILY.count ? `решили ${DAILY.count}` : `№${DAILY.n}`;
    card.classList.toggle('done', !!DAILY.my_place);
  }
  function dailyHtml() {
    if (!DAILY || !DAILY.task) return '';
    const rows = DAILY.top.map(r => `<tr class="${r.me ? 'me' : ''}"><td class="lb-place">${placeHtml(r.place)}</td><td>${esc(r.name)}${admTag(r.sid)}</td><td class="num">${fmtMs(r.ms)}</td></tr>`).join('');
    return `<p class="fm-note">Одно задание для всех на сегодня, №${DAILY.n}. Место — по времени решения <b>с первой попытки</b>
        (время считает сервер с момента открытия задания). Самый быстрый завтра весь день носит 👑.${DAILY.crown ? ` Сегодня корона у <b>${esc(DAILY.crown)}</b>.` : ''}</p>
      ${DAILY.my_place ? `<p class="lb-mine">Ты решил за <b>${fmtMs(DAILY.mine)}</b> — ${DAILY.my_place}-е место из ${DAILY.count}.</p>`
        : dailyNow() ? '<p class="lb-mine">Вы сейчас решаете задание дня — время идёт. <button type="button" class="btn ghost" id="dailyBack">Вернуться к заданию</button></p>'
        : DAILY.started ? `<p class="daily-used">🔒 Вы уже заходили выполнять задание дня сегодня в ${new Date(DAILY.started * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}. Войти второй раз нельзя — новое задание появится завтра.</p>`
        : '<p><button type="button" class="btn primary" id="dailyGo">Решать задание дня</button></p><p class="fm-note">Войти в задание можно <b>один раз</b>: время пойдёт сразу, а выйти и вернуться уже не получится.</p>'}
      ${rows ? `<table class="lb">${rows}</table>` : '<p class="fm-muted lb-empty">Пока никто не решил — стань первым!</p>'}`;
  }
  async function openDaily() {
    if (isNarrow()) setSideOpen(false);
    await loadDaily();
    $('#forecastBody').innerHTML = `<h2 class="fm-title">👑 Задание дня</h2>${dailyHtml()}`;
    $('#forecastModal').hidden = false;
  }
  /** Ученик сейчас на открытом задании дня. */
  const dailyNow = () => !!(DAILY && cur && !cur.done && cur.task && cur.task.id === DAILY.task);
  function goDaily() {
    const t = DAILY && byId.get(DAILY.task);
    if (!t) return;
    closeForecast();
    if (dailyNow()) return;
    if (DAILY.started && !DAILY.my_place) { toast('Вы уже заходили выполнять задание дня сегодня — войти второй раз нельзя. Новое задание будет завтра.', 5000); return; }
    if (!leaveExam()) return;
    show({ task: t, why: { type: 'daily' } });
    DAILY.started = DAILY.started || Date.now() / 1000;
    renderDailyCard();
  }

  // ------------------------------------------------------------ турниры
  /* Как в футболе: набор на 4, 8 или 12 игроков (каждого вида — один турнир в сутки) → жеребьёвка по корзинам →
     группы по 4, каждый с каждым (победа 3 очка, ничья 1, «счёт» — решённые задания) → плей-офф и матч за 3-е место. */
  let TOUR = null;
  async function loadDuels() {
    if (!SERVER || !student || TEACHER) return;
    try { TOUR = await api('tour'); } catch (e) { return; }
    // начатые матчи решаются как подборка: задания по порядку
    ASG = ASG.filter(a => !a.duel);
    for (const m of tourMyMatches()) {
      if (m.status !== 'play' || !m.tasks || m.done) continue;
      const op = m.mine === 'a' ? m.b : m.a;
      ASG.push({ id: 'tm-' + m.id, duel: 'tm' + m.id, tour: m.id, title: `${m.stage}: матч с ${op ? op.name : '?'}`, tasks: m.tasks, done: [], created: m.since });
    }
    renderDuelCard();
    renderAsgCard();
    renderTourPage();
  }
  /** Все мои матчи текущего турнира (группа, плей-офф, за 3-е место) с названием стадии. */
  function tourMyMatches() {
    const T = TOUR && TOUR.mine;
    if (!T || !T.groups) return [];
    const out = [];
    for (const g of T.groups) for (const m of g.matches) if (m.mine) out.push({ ...m, stage: `Группа ${g.name}` });
    for (const r of T.playoff) for (const m of r.matches) if (m.mine) out.push({ ...m, stage: r.name });
    if (T.third && T.third.mine) out.push({ ...T.third, stage: 'Матч за 3-е место' });
    return out;
  }
  /** Матч, который ждёт меня сейчас: начатый, иначе любой несыгранный. */
  function tourMyMatch() {
    const T = TOUR && TOUR.mine;
    if (!T || T.status !== 'run') return null;
    const open = tourMyMatches().filter(m => m.status === 'play' && !m.done);
    return open.find(m => m.started) || open[0] || null;
  }
  function renderDuelCard() {
    const card = $('#duelCard');
    if (!card) return;
    card.hidden = !SERVER || !student || TEACHER;
    const m = tourMyMatch(), T = TOUR && TOUR.mine;
    const lob = TOUR && TOUR.lobbies.find(l => l.me_in);
    $('#duelSub').textContent = !TOUR ? 'наборы открыты' : m ? 'твой матч!' : T && T.status === 'run' ? 'ждём соперников'
      : lob ? `набор ${lob.players.length}/${lob.size}` : 'наборы открыты';
    card.classList.toggle('alert', !!m);
  }
  const tourLeft = sec => {
    const ms = sec * 1000 - Date.now();
    if (ms <= 0) return 'время вышло';
    const h = Math.floor(ms / 3600e3), mi = Math.floor(ms % 3600e3 / 60e3);
    return h ? `${h} ч ${pad2(mi)} мин` : `${mi} мин`;
  };
  const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const TOUR_FMT = { 4: '1 группа → финал и матч за 3-е место', 8: '2 группы → полуфиналы → финал', 12: '3 группы → 1/4 финала → 1/2 → финал' };
  function tourOpen() {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true;
    pageKind = 'tour';
    cur = null;
    navPush({ v: 'tourpage' });
    renderTourPage();
    renderSidebar();
    window.scrollTo(0, 0);
    loadDuels();                                        // наборы и сетка могли измениться
  }
  const isMe = p => !!(p && student && p.sid === student.sid);
  function tourPlayer(p, m, side) {
    if (!p) return `<div class="tb-p empty"><span class="tb-seed"></span><span class="tb-name">ждём</span></div>`;
    const done = m && m.status === 'done';
    const won = done && m.winner === p.sid, lost = done && m.winner && m.winner !== p.sid;
    const sc = done ? `<b class="tb-sc">${m[side + '_solved']}</b>` : '';
    return `<div class="tb-p${isMe(p) ? ' me' : ''}${won ? ' won' : ''}${lost ? ' lost' : ''}"><span class="tb-seed">${p.grp || ''}</span>
      <span class="tb-name">${esc(p.name)}${isMe(p) ? ' (ты)' : ''}${admTag(p.sid)}</span><small>ур. ${p.level}</small>${sc}</div>`;
  }
  function tourBox(m, label) {
    const note = !m ? '' : m.status === 'done' ? (m.tech ? 'тех. результат' : 'сыгран') : `идёт · ${tourLeft(m.ends)}`;
    return `<div class="tb-m${m && m.mine ? ' mine' : ''}${m && m.status === 'play' ? ' live' : ''}">${label ? `<div class="tb-lbl">${label}</div>` : ''}
      ${tourPlayer(m && m.a, m, 'a')}${tourPlayer(m && m.b, m, 'b')}${note ? `<div class="tb-note">${note}</div>` : ''}</div>`;
  }
  function tourBracket(T) {
    const cols = T.playoff.map(r => {
      const boxes = [];
      for (let k = 0; k < r.slots; k++) boxes.push(tourBox(r.matches.find(x => x.slot === k)));
      if (r.slots === 1) boxes.push(tourBox(T.third, '🥉 Матч за 3-е место'));
      return `<div class="tb-col"><div class="tb-h">${r.name}</div><div class="tb-list">${boxes.join('')}</div></div>`;
    });
    return `<div class="tb">${cols.join('')}</div>`;
  }
  function tourGroups(T) {
    const n = T.groups.length;
    return `<div class="tg-grid">${T.groups.map(g => `<div class="tg"><div class="tg-h">Группа ${g.name}</div>
      <table class="tg-t"><thead><tr><th></th><th>Участник</th><th title="Игры">И</th><th title="Победы">В</th><th title="Ничьи">Н</th><th title="Поражения">П</th>
        <th title="Решено — пропущено (как голы)">Задачи</th><th>О</th></tr></thead><tbody>
      ${g.rows.map(r => `<tr class="${r.me ? 'me' : ''}${r.place <= 2 ? ' q' : n === 3 && r.place === 3 ? ' q3' : ''}"><td>${r.place}</td>
        <td>${esc(r.name)}${r.me ? ' (ты)' : ''}${admTag(r.sid)}</td><td>${r.g}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.sf}–${r.sa}</td><td><b>${r.pts}</b></td></tr>`).join('')}
      </tbody></table>
      <div class="tg-ms">${g.matches.map(m => `<div class="tg-m${m.mine ? ' mine' : ''}"><span>${esc(m.a.name)}</span>
        <b>${m.status === 'done' ? `${m.a_solved} : ${m.b_solved}` : '– : –'}</b><span>${esc(m.b.name)}</span></div>`).join('')}</div></div>`).join('')}</div>
      <p class="fm-muted tg-legend">В плей-офф выходят двое лучших из группы${n === 3 ? ' и две лучшие команды с 3-х мест' : ''}. Порядок: очки → разница задач → решено → время.</p>`;
  }
  function tourMyList(T) {
    const ms = tourMyMatches();
    if (!ms.length) return '';
    const rows = ms.map(m => {
      const meA = m.mine === 'a', op = meA ? m.b : m.a;
      let st, btn = '';
      if (m.status === 'done') {
        const my = meA ? m.a_solved : m.b_solved, his = meA ? m.b_solved : m.a_solved;
        const res = !m.winner ? (m.tech ? 'тех. поражение' : 'ничья') : m.winner === student.sid ? 'победа' : 'поражение';
        st = `<b class="tm-res ${!m.winner ? (m.tech ? 'l' : 'd') : m.winner === student.sid ? 'w' : 'l'}">${res} ${my}:${his}</b>${m.tech ? ' <small>(кто-то не сыграл)</small>' : ''}`;
      } else if (m.done) st = 'ты сыграл — ждём соперника';
      else {
        st = `осталось ${tourLeft(m.ends)}`;
        btn = `<button type="button" class="btn primary" data-tour-go="${m.id}">${m.started ? 'Продолжить' : 'Играть'}</button>
          ${m.started ? `<button type="button" class="btn ghost" data-tour-fin="${m.id}">Закончить</button>` : ''}`;
      }
      return `<div class="tm-row${m.status === 'play' && !m.done ? ' live' : ''}"><div><span class="ap-kind">${m.stage}</span>
        <b>ты — ${esc(op ? op.name : '?')}</b> <small class="fm-muted">${op ? `ур. ${op.level}` : ''}</small><div class="fm-muted">${st}</div></div>
        <div class="tm-btns">${btn}</div></div>`;
    }).join('');
    return `<h3 class="ap-h">Мои матчи</h3><p class="fm-muted">Матч — ${TOUR.tasks} одинаковых заданий тебе и сопернику, время идёт с нажатия «Играть». Матчи играются по одному.</p>
      <div class="tm-list">${rows}</div>`;
  }
  function renderTourPage() {
    if (!courseShown || pageKind !== 'tour') return;
    $('#scopeInfo').innerHTML = '<span class="scope-title">Турниры</span>';
    document.body.classList.add('asg-wide');
    if (!TOUR) { trainerEl.innerHTML = '<div class="course"><p class="fm-muted">Загружаем турниры…</p></div>'; return; }
    const D = TOUR, T = D.mine;
    const lobby = l => {
      const n = l.players.length;
      const prizes = Object.entries(l.prizes).map(([pl, xp]) => `${MEDAL[pl]} ${xp}`).join(' · ');
      const btn = !l.id ? `<span class="fm-muted">Сегодня уже разыгран — новый набор откроется завтра</span>`
        : l.me_in ? `<button type="button" class="btn" data-tour-leave="${l.id}">Выйти из набора</button>`
          : D.busy ? '<span class="fm-muted">ты уже в другом турнире</span>'
            : `<button type="button" class="btn primary" data-tour-join="${l.id}">Записаться</button>`;
      return `<div class="ap-card tl-card${l.me_in ? ' going' : ''}${l.id ? '' : ' done'}">
        <div class="ap-top"><span class="ap-ico">${{ 4: '⚡', 8: '🏆', 12: '🌍' }[l.size]}</span><div><span class="ap-kind">${l.size} игроков · ${TOUR_FMT[l.size]}</span>
          <b>${esc(l.title || l.name)}</b><small>${l.id ? `набрано ${n} из ${l.size}${n < l.size ? ` — ещё ${l.size - n} и старт!` : ''}` : 'один турнир в сутки'} · призы ${prizes} XP</small></div></div>
        ${l.id ? `<i class="xp-bar"><b style="width:${pct(n / l.size)}%"></b></i>
        <div class="tl-seats">${Array.from({ length: l.size }, (_, i) => l.players[i]
          ? `<span class="tl-seat on${isMe(l.players[i]) ? ' me' : ''}" title="ур. ${l.players[i].level}">${esc(l.players[i].name)}</span>`
          : '<span class="tl-seat">свободно</span>').join('')}</div>` : ''}
        <div class="ap-btns">${btn}</div></div>`;
    };
    trainerEl.innerHTML = `<div class="course asg-page tour-page">
      <div class="crs-hero"><div><div class="crs-kicker">Турниры</div><h2>Как в футболе</h2>
        <p>Запишись в набор — как только наберутся все, турнир <b>начнётся сам</b>. Жеребьёвка по корзинам (по опыту) → <b>группы по 4</b>: каждый с каждым,
          победа — 3 очка, ничья — 1, «счёт» матча — сколько заданий решил каждый. Лучшие выходят в <b>плей-офф</b>: там при равном счёте проходит тот, кто решил быстрее, — как серия пенальти.
          Финал и матч за 3-е место. На групповой этап — ${D.group_hours} ч, на каждый раунд плей-офф — ${D.po_hours} ч, не сыграл — техническое поражение.</p>
        <p>Каждого вида — <b>один турнир в сутки</b>. Чемпион получает награду <b>🎖 Победитель турнира</b> в профиль.</p></div>
        <div class="crs-prog"><b>${D.wins}</b><span>${plural(D.wins, 'победа', 'победы', 'побед')} в турнирах</span></div></div>
      ${T ? `<h3 class="ap-h tour-h">${esc(T.title)} ${T.status === 'run' ? `<span class="chip accent">${esc(T.stage.toLowerCase())} · осталось ${tourLeft(T.round_ends)}</span>` : '<span class="chip good">завершён</span>'}</h3>
        ${T.status === 'done' ? tourPodium(T) : ''}
        ${T.status === 'run' ? tourMyList(T) : ''}
        <h3 class="ap-h">Групповой этап</h3>${tourGroups(T)}
        <h3 class="ap-h">Плей-офф</h3>${tourBracket(T)}` : ''}
      <h3 class="ap-h">Наборы</h3><div class="ap-grid tl-grid">${D.lobbies.map(lobby).join('')}</div>
      ${D.done.length ? `<h3 class="ap-h">Завершённые турниры</h3><div class="td-list">${D.done.map(t => `<div class="td-row"><b>${esc(t.title)}</b>
        <small class="fm-muted">${t.finished ? apDay(t.finished) : ''}</small>${tourPodium(t)}</div>`).join('')}</div>` : ''}
    </div>`;
  }
  function tourPodium(T) {
    return `<div class="tpod">${(T.podium || []).map(p => `<span class="tpod-i p${p.place}${isMe(p) ? ' me' : ''}">${MEDAL[p.place] || `${p.place}.`} ${esc(p.name)}${admTag(p.sid)}${p.xp ? ` <small>+${p.xp} XP</small>` : ''}</span>`).join('')}</div>`;
  }
  async function tourAction(path, body, msg) {
    let d;
    try { d = await api(path, body); } catch (e) { toast(e.message || 'Не получилось', 3000); return; }
    if (d && d.started) toast('Набор заполнен — турнир начался! Сыграй свой матч.', 4000);
    else if (msg) toast(msg, 2500);
    await loadDuels();
  }
  async function startTourMatch(id) {
    try { await api('tour/start', { match: id }); } catch (e) { toast(e.message, 3000); return; }
    await loadDuels();
    leaveCourse();
    setScope('asg', 'tm-' + id);
  }
  async function finishTourMatch(id) {
    try { await api('tour/finish', { match: id }); } catch (e) { return false; }
    return true;
  }
  /** Решил последнее задание матча — сообщаем серверу, итог — когда закончит и соперник. */
  async function checkDuelDone() {
    const a = ui.scope === 'asg' && asgOf(ui.asg);
    if (!a || !a.tour || asgLeft(a).length) return;
    if (!await finishTourMatch(a.tour)) return;
    toast('Матч сыгран! Итог — когда закончит соперник.', 4000);
    ui.scope = 'all';
    await loadDuels();
    tourOpen();
  }
  trainerEl.addEventListener('click', async e => {
    if (pageKind !== 'tour' || !courseShown) return;
    const t = e.target;
    const j = t.closest('[data-tour-join]'), l = t.closest('[data-tour-leave]'), go = t.closest('[data-tour-go]'), fin = t.closest('[data-tour-fin]');
    if (j) return tourAction('tour/join', { id: +j.dataset.tourJoin }, 'Ты в наборе! Турнир начнётся, когда наберутся все игроки.');
    if (l) return tourAction('tour/leave', { id: +l.dataset.tourLeave }, 'Ты вышел из набора');
    if (go) return startTourMatch(+go.dataset.tourGo);
    if (fin && confirm('Закончить матч? Засчитаются задания, решённые до этого момента.')) {
      if (await finishTourMatch(+fin.dataset.tourFin)) { toast('Матч закончен — ждём соперника', 3000); await loadDuels(); }
    }
  });
  $('#forecastBody').addEventListener('click', e => {
    const t = e.target;
    if (t.closest('#dailyGo')) return goDaily();
    if (t.closest('#dailyBack')) return closeForecast();
    if (t.closest('#sumDuels')) { closeForecast(); return tourOpen(); }
  });
  $('#dailyCard').addEventListener('click', openDaily);
  $('#courseCard')?.addEventListener('click', openCourse);
  $('#duelCard').addEventListener('click', () => tourOpen());

  /** При входе (не в первый раз) — раз в день сводка: итоги недели, кто обогнал, задание дня, вызовы, лига. */
  async function showDailyRating() {
    if (viewPrefs().focus) return;                 // режим «Фокус» — без соревнований
    const key = `egeTrainer.lbShown.${student ? student.sid : ''}`;
    const today = dayKey(Date.now());
    let shown = null;
    try { shown = localStorage.getItem(key); } catch (e) { return; }
    let d;
    try { d = await api('leaderboard'); } catch (e) { return; }
    LB = d;
    const rb = $('#rankBtn');
    if (rb) rb.outerHTML = rankBtnHtml();
    const L = d.boards.league;
    const note = overtakeNote(L);
    const passed = /обогнал/.test(note);
    saveLeagueSnap();
    if (shown === today && !passed) {                         // сводку сегодня уже видел — но про обгон скажем
      return;
    }
    if (!$('#forecastModal').hidden) { if (passed) toast(note.replace(/<[^>]+>/g, ''), 6000); return; }
    try { localStorage.setItem(key, today); } catch (e) { /* не страшно */ }
    const R = L.result;
    const resKey = `egeTrainer.lgRes.${student ? student.sid : ''}`;
    const showRes = R && readJSON(resKey) !== R.week;
    if (showRes) writeJSON(resKey, R.week);
    const res = !showRes ? '' : R.result === 'up' ? `<div class="sum-res up">🎉 Неделя завершена: ${R.place}-е место — ты поднялся в <b>${esc(L.name.toLowerCase())}</b>!</div>`
      : R.result === 'down' ? `<div class="sum-res down">Неделя завершена: ${R.place}-е место — ты опустился в ${esc(L.name.toLowerCase())}. Новая неделя — новый шанс!</div>`
        : `<div class="sum-res">Неделя завершена: ${R.place}-е место, ты остаёшься в ${esc(L.name.toLowerCase())}.</div>`;
    const tm = tourMyMatch();
    const inv = tm && !tm.done ? [tm] : [];
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Привет! Вот что нового</h2>${res}
      ${note ? `<div class="sum-note${passed ? ' hot' : ''}">${note}</div>` : ''}
      ${inv.length ? `<div class="sum-note hot">🏆 Турнир: ${esc(tm.stage.toLowerCase())} — твой матч ждёт тебя — осталось ${tourLeft(tm.ends)}. <button type="button" class="btn ghost" id="sumDuels">К матчу</button></div>` : ''}
      ${DAILY && DAILY.task && !DAILY.my_place && !DAILY.started ? `<div class="sum-note">👑 Задание дня ждёт: №${DAILY.n}${DAILY.count ? `, решили уже ${DAILY.count}` : ''}. <button type="button" class="btn ghost" id="dailyGo">Решать</button></div>` : ''}
      ${boardsHtml(d, 'league')}
      <div class="tour-foot"><button type="button" class="btn primary" id="tourGo">К заданиям</button></div>`;
    $('#forecastModal').hidden = false;
  }

  // ------------------------------------------------------------ задания от учителя
  let ASG = [], ASG_IN_CLASS = false;
  const fmtDay = ms => { const d = new Date(ms); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`; };
  function asgOf(id) { return ASG.find(a => a.id === id) || (COURSE_OK && courseSet(id)) || null; }
  /** Нерешённые задания подборки: по данным сервера и по ответам, данным уже на этой странице. */
  function asgLeft(a) {
    if (!a) return [];
    if (a.strict) { const d = new Set(a.done || []); return a.finished || a.closed ? [] : a.tasks.filter(id => !d.has(id)); }
    const done = new Set(a.done);
    const since = (a.created || 0) * 1000;
    for (const e of P.log) {
      if ((e.s > 0 || a.duel) && e.t >= since && !e.b) { done.add(e.id); const g = partToGroup.get(e.id); if (g) done.add(g); }
    }
    return a.tasks.filter(id => !done.has(id));
  }
  async function loadAssignments() {
    if (!SERVER) return;
    const duels = ASG.filter(a => a.duel || a.course);
    try { const d = await api('assignments'); ASG = d.assignments || []; ASG_IN_CLASS = !!d.in_class; } catch (e) { if (e.status === 401) throw e; ASG = []; }
    ASG = ASG.concat(duels);
    renderAsgCard();
    if (wkLive()) wkWatch();
    asgNotices();
  }
  /** Напоминания: срок работы — сегодня или завтра; новая личная подборка (работа над ошибками, слабые места). */
  function asgNotices() {
    const key = `egeTrainer.asgNote.${student ? student.sid : ''}`, today = dayKey(Date.now());
    const seen = readJSON(key) || {};
    const say = [];
    for (const a of ASG) {
      if (a.duel || a.course || a.closed) continue;
      const left = a.strict ? (a.finished ? 0 : a.tasks.length - (a.done || []).length) : asgLeft(a).length;
      if (a.personal && !seen['new' + a.id]) {
        seen['new' + a.id] = today;
        say.push(a.personal === 'fix' ? `🔧 Работа над ошибками: ${a.tasks.length} ${plural(a.tasks.length, 'похожее задание', 'похожих задания', 'похожих заданий')} на твои ошибки`
          : `🎯 Учитель выдал подборку по твоим слабым местам: ${a.title.replace('Слабые места: ', '')}`);
        continue;
      }
      if (!a.due || !left) continue;
      const ms = a.due * 1000 - Date.now();
      if (ms <= 0 || ms > 36 * 3600e3 || seen['due' + a.id] === today) continue;
      seen['due' + a.id] = today;
      const when = new Date(a.due * 1000).toDateString() === new Date().toDateString() ? 'сегодня' : 'завтра';
      say.push(`⏰ Срок «${a.title}» — ${when}: осталось ${left} ${plural(left, 'задание', 'задания', 'заданий')}. После срока работа закроется.`);
    }
    writeJSON(key, seen);
    say.slice(0, 3).forEach((t, i) => setTimeout(() => toast(t, 6000), 1200 + i * 6200));
  }
  function renderAsgCard() {
    const card = $('#asgCard');
    if (!card) return;
    const own = ASG.filter(a => !a.duel && !a.course);
    card.hidden = !own.length && !ASG_IN_CLASS;           // ученик в классе — значок подборок есть всегда
    if (card.hidden) return;
    const open = own.filter(a => asgLeft(a).length);
    const left = open.reduce((s, a) => s + asgLeft(a).length, 0);
    card.classList.toggle('alert', !!left);
    $('#asgSub').textContent = open.length ? `${open.length} ${plural(open.length, 'подборка', 'подборки', 'подборок')} · осталось ${left}` : 'всё решено';
  }
  const KINDS = { self: ['📝', 'Самостоятельная'], practice: ['🛠', 'Практическая'], home: ['🏠', 'Домашняя работа'] };
  const PERSONAL = { fix: ['🔧', 'Работа над ошибками'], weak: ['🎯', 'Слабые места'] };
  const kindOf = a => PERSONAL[a.personal] || KINDS[a.kind] || KINDS.self;
  /** Страница «Задания от учителя» в основной области (как «Курс»): карточки текущих и пройденных подборок. */
  function openAsgPage() {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true;
    pageKind = 'asg';
    cur = null;
    navPush({ v: 'asgpage' });
    renderAsgPage();
    renderSidebar();
    window.scrollTo(0, 0);
  }
  function renderAsgPage() {
    if (!courseShown || pageKind !== 'asg') return;
    const list = ASG.filter(a => !a.duel && !a.course);
    const isDone = a => (a.strict ? !!(a.result || a.closed) : !!(a.score && a.score.final));
    const active = list.filter(a => !isDone(a)), done = list.filter(isDone);
    const left = active.reduce((n, a) => n + asgLeft(a).length, 0);
    const card = a => {
      if (!a.strict) return practiceCard(a);
      const n = (a.done || []).length, total = a.tasks.length, r = a.result;
      const nums = [...new Set(a.tasks.map(id => (byId.get(id) || {}).n).filter(Boolean))].sort((x, y) => x - y);
      const late = a.due && a.due * 1000 < Date.now() && !r;
      const state = r ? `оценка <b>${r.grade}</b> · ${r.pct}% · верно ${r.ok} из ${r.total}${r.xp ? ` · +${r.xp} XP` : ''}`
        : a.closed ? (a.due && a.closed >= a.due ? 'срок прошёл — <b class="ap-late">не сдана</b>' : 'завершена учителем')
          : a.started ? `идёт · сдано ${n} из ${total}` : 'ещё не начата';
      const btns = r ? `<button type="button" class="btn" data-asg="${a.id}">Результат</button><button type="button" class="btn" data-review="${a.id}">Разбор</button>`
        : a.closed ? '' : `<button type="button" class="btn primary" data-asg="${a.id}">${a.started ? 'Продолжить' : 'Начать'}</button>`;
      return `<div class="ap-card${r || a.closed ? ' done' : ''}${a.started && !r ? ' going' : ''}${late ? ' late' : ''}">
        <div class="ap-main">
          <div class="ap-top"><span class="ap-ico">${r ? '✓' : a.closed ? '⌛' : kindOf(a)[0]}</span><div><span class="ap-kind">${kindOf(a)[1]}</span><b>${esc(a.title)}</b>
            <small>${total} ${plural(total, 'задание', 'задания', 'заданий')}${nums.length ? ` · №${nums.map(numLabel).join(', ')}` : ''}</small></div></div>
          <div class="ap-state">${state}</div>
          ${r ? '' : `<i class="xp-bar"><b style="width:${pct(n / total)}%"></b></i>`}</div>
        ${apDates(a, a.finished, !!(r || a.closed))}
        <div class="ap-btns">${btns}</div></div>`;
    };
    $('#scopeInfo').innerHTML = '<span class="scope-title">Задания от учителя</span>';
    document.body.classList.add('asg-wide');
    trainerEl.innerHTML = `<div class="course asg-page">
      <div class="crs-hero"><div><div class="crs-kicker">Задания от учителя</div><h2>Подборки твоего класса</h2>
        <p>Новые подборки появляются здесь сами. <b>Самостоятельная</b> — проверка после сдачи, ответ можно изменить один раз. <b>Практическая</b> и <b>домашняя</b> — верно или нет видно сразу, оценка ставится сама по попыткам.</p></div>
        <div class="crs-prog"><b>${active.length}</b><span>${active.length ? `${plural(active.length, 'подборка', 'подборки', 'подборок')} · осталось ${left}` : 'новых подборок нет'}</span></div></div>
      <h3 class="ap-h">Сейчас</h3>
      ${active.length ? `<div class="ap-grid">${active.map(card).join('')}</div>` : '<p class="fm-note">Новых подборок нет — когда учитель выдаст, они появятся здесь.</p>'}
      ${done.length ? `<h3 class="ap-h">Пройденные</h3><div class="ap-grid">${done.map(card).join('')}</div>` : ''}
    </div>`;
  }
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const apDay = sec => { const d = new Date(sec * 1000); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} <small>${WD[d.getDay()]}</small>`; };
  const apTime = sec => { const d = new Date(sec * 1000); return `${apDay(sec)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  /** Даты работы: выдана, сдать до (сколько осталось), сдана. */
  function apDates(a, doneAt, finished) {
    const out = [`<div><span>Выдана</span><b>${a.created ? apDay(a.created) : '—'}</b></div>`];
    if (a.due) {
      const left = Math.ceil((a.due * 1000 - Date.now()) / 864e5);
      const note = finished ? '' : left < 0 ? '<em class="late">срок прошёл</em>' : left === 0 ? '<em class="soon">сегодня</em>'
        : left === 1 ? '<em class="soon">завтра</em>' : `<em>осталось ${left} ${plural(left, 'день', 'дня', 'дней')}</em>`;
      out.push(`<div><span>Сдать до</span><b>${apDay(a.due)}</b>${note}</div>`);
    } else out.push('<div><span>Сдать до</span><b>без срока</b></div>');
    if (doneAt) out.push(`<div><span>Сдана</span><b>${apTime(doneAt)}</b></div>`);
    return `<div class="ap-dates">${out.join('')}</div>`;
  }
  /** Карточка практической или домашней: решено, текущая оценка (ставится сама по попыткам). */
  function practiceCard(a) {
    const sc = a.score || {}, total = a.tasks.length, solved = (a.done || []).length;
    const nums = [...new Set(a.tasks.map(id => (byId.get(id) || {}).n).filter(Boolean))].sort((x, y) => x - y);
    const late = a.due && a.due * 1000 < Date.now() && !sc.final;
    const grade = sc.grade ? `${sc.final ? 'оценка' : 'оценка сейчас'} <b>${sc.grade}</b> · ${sc.pct}%`
      : a.closed ? 'срок прошёл — <b class="ap-late">не сделана</b>' : 'ещё не начата';
    return `<div class="ap-card${sc.final ? ' done' : ''}${sc.tried && !sc.final ? ' going' : ''}${late ? ' late' : ''}">
      <div class="ap-main">
        <div class="ap-top"><span class="ap-ico">${sc.final && sc.tried ? '✓' : a.closed ? '⌛' : kindOf(a)[0]}</span><div><span class="ap-kind">${kindOf(a)[1]}</span><b>${esc(a.title)}</b>
          <small>${total} ${plural(total, 'задание', 'задания', 'заданий')}${nums.length ? ` · №${nums.map(numLabel).join(', ')}` : ''}</small></div></div>
        <div class="ap-state">${grade}${sc.tried ? ` · сделано ${sc.tried} из ${sc.total}: верно ${sc.ok}${sc.half ? `, со 2-й попытки ${sc.half}` : ''}${sc.bad ? `, неверно ${sc.bad}` : ''}` : ''}</div>
        <i class="xp-bar"><b style="width:${pct((sc.tried || 0) / (sc.total || total))}%"></b></i>
        ${a.personal === 'fix' ? '<p class="ap-note">Похожие задания того же типа на те, где ты ошибся в самостоятельной. Разберись — и закрепи.</p>' : ''}
        ${a.personal === 'weak' ? '<p class="ap-note">Подборка только для тебя — по номерам, где у тебя пока меньше всего верных ответов.</p>' : ''}</div>
      ${apDates(a, null, sc.final)}
      <div class="ap-btns"><button type="button" class="btn ${sc.final || a.closed ? '' : 'primary'}" data-asg="${a.id}">${sc.final || a.closed ? 'Потренироваться' : sc.tried ? 'Продолжить' : 'Начать'}</button></div></div>`;
  }
  function openAssignments() {
    const list = ASG.filter(a => !a.duel && !a.course);
    const isDone = a => a.strict && (a.result || a.closed);
    const active = list.filter(a => !isDone(a)), done = list.filter(isDone);
    const doneRows = done.map(a => {
      const r = a.result;
      return `<div class="asg-row done">
        <div><h3>✓ ${esc(a.title)}</h3><div class="asg-meta">${r ? `оценка <b>${r.grade}</b> · ${r.pct}% · верно ${r.ok} из ${r.total}${r.xp ? ` · +${r.xp} XP` : ''}` : 'завершена учителем — не начата'}</div></div>
        <span class="asg-btns">${r ? `<button type="button" class="btn" data-asg="${a.id}">Результат</button>
          <button type="button" class="btn" data-review="${a.id}" data-from="asg">Разбор</button>` : ''}</span></div>`;
    }).join('');
    const rows = active.map(a => {
      if (a.strict) return wkRowHtml(a);
      const left = asgLeft(a).length, total = a.tasks.length;
      const late = a.due && a.due * 1000 < Date.now() && left;
      return `<div class="asg-row">
        <div><h3>${esc(a.title)}</h3><div class="asg-meta">${total - left} из ${total} решено${a.due ? ` · <span class="${late ? 'chip weak' : ''}">срок до ${fmtDay(a.due * 1000)}</span>` : ''}</div></div>
        <button type="button" class="btn ${left ? 'primary' : ''}" data-asg="${a.id}">${left ? 'Решать' : 'Повторить'}</button>
        <i class="xp-bar"><b style="width:${pct((total - left) / total)}%"></b></i></div>`;
    }).join('');
    $('#forecastBody').innerHTML = `<h2 class="fm-title" id="asgWin">Задания от учителя</h2>
      <p class="fm-note">Подборки, которые учитель выдал твоему классу. Новые появляются здесь сами.</p>
      <h3 class="fm-sub">Сейчас</h3>
      ${rows || '<p class="fm-note">Новых подборок нет — когда учитель выдаст, они появятся здесь.</p>'}
      ${doneRows ? `<h3 class="fm-sub">Пройденные</h3>${doneRows}` : ''}`;
    $('#forecastModal').hidden = false;
  }
  let asgCelebrated = new Set();
  function asgAfterAnswer() {
    if (ui.scope !== 'asg') return;
    const a = asgOf(ui.asg);
    // практическая и домашняя: оценка считается на сервере — подтянем свежую
    if (a && !a.strict && !a.course && !a.duel && SERVER) loadAssignments().then(() => renderTopbar()).catch(() => {});
    if (a && !asgLeft(a).length && !asgCelebrated.has(a.id)) {
      asgCelebrated.add(a.id);
      toast(`Подборка «${a.title}» решена полностью!`, 4000);
    }
  }

  // ------------------------------------------------------------ уход со вкладки и снимки экрана
  // Уход со страницы дольше пары секунд, пока открыто задание или вариант, и клавиши снимка экрана
  // записываются — учитель видит это в журнале. Страница при этом ничего не прячет.
  const awayQ = [];
  let awayFrom = 0;
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
    if (!SERVER || !student || sec < 2) return;
    if (!id) { wkCameBack(sec); return; }
    if (cur && !cur.done && !examShown) {
      cur.away = (cur.away || 0) + 1;
      cur.awaySec = (cur.awaySec || 0) + sec;
      if (sec >= 30) cur.backAt = Date.now();      // долгий уход: верный ответ сразу после него отметится ⚠
    }
    awayQ.push({ kind: 'away', dur: Math.round(sec), task: id, exam: examShown ? 1 : 0 });
    flushAway();
    if (wkCameBack(sec)) return;
    if (examShown && EX) {
      EX.away = (EX.away || 0) + 1;
      saveExam();
    }
    // ученику ничего не показываем — уход только записывается для учителя
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
  // Вставка ответа: отмечаем, если текст скопирован не на этой же странице (вывод Python, условие — не в счёт)
  let lastCopy = '', pasteWarned = false;
  const normCopy = x => String(x || '').replace(/\s+/g, ' ').trim();
  document.addEventListener('copy', e => {
    const t = e.target;
    const inField = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') && t.selectionEnd > t.selectionStart;
    lastCopy = normCopy(inField ? t.value.slice(t.selectionStart, t.selectionEnd) : window.getSelection());
  }, true);
  document.addEventListener('paste', e => {
    if (!SERVER || !student || !e.target.closest || !e.target.closest('#trainer .answer-row')) return;
    const text = normCopy((e.clipboardData || window.clipboardData).getData('text'));
    if (!text || (lastCopy && lastCopy.includes(text))) return;
    if (examShown && EX) {
      EX.paste = (EX.paste || 0) + 1;
      saveExam();
      awayQ.push({ kind: 'paste', task: openTaskId() || '', exam: 1 });
      flushAway();
      updStrict();
    } else if (cur && !cur.done) cur.paste = true;
    else return;
    if (!pasteWarned) {
      pasteWarned = true;
      toast('Вставленный ответ отмечается в журнале учителя. Скопированное из окна Python тренажёра — не отмечается.', 5000);
    }
  }, true);

  // Строгий режим варианта: на весь экран; выход из него и уход со страницы записываются и видны
  const canFs = () => !!document.documentElement.requestFullscreen;
  function exStrictEnter() {
    if (!canFs() || document.fullscreenElement) return;
    document.documentElement.requestFullscreen().catch(() => {}).finally(updStrict);
  }
  function strictHtml() {
    return '';                                   // плашку строгого режима ученику не показываем — не отвлекаем
  }
  function updStrict() {
    const el = $('#exStrict');
    if (el && examShown && EX) el.outerHTML = strictHtml();
  }
  document.addEventListener('fullscreenchange', () => {
    if (!examShown || !EX) return;
    if (document.fullscreenElement) { EX.fsOn = true; updStrict(); return; }
    if (!EX.fsOn) { updStrict(); return; }
    EX.fsOn = false;
    EX.fsExits = (EX.fsExits || 0) + 1;
    saveExam();
    awayQ.push({ kind: 'fs', task: openTaskId() || '', exam: 1 });
    flushAway();
  });
  function exStrictLeave() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
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
  $('#asgCard').addEventListener('click', () => {
    openAsgPage();
    loadAssignments().then(renderAsgPage).catch(() => {});
  });
  $('#forecastBody').addEventListener('click', e => {
    const b = e.target.closest('[data-asg]');
    if (!b) return;
    $('#forecastModal').hidden = true;
    const a = asgOf(+b.dataset.asg);
    if (a && a.strict) { wkOpen(a); return; }
    setScope('asg', +b.dataset.asg);
  });

  // ------------------------------------------------------------ самостоятельная от учителя
  // Ответ на задание сдаётся один раз и не проверяется до конца; итог и оценка — после «Завершить».
  // Пишется в полном экране; уход со вкладки и выход из полного экрана сразу уходят учителю.
  let wkPoll = null, wkFsOn = false;
  const wkScope = () => { const a = ui.scope === 'asg' && asgOf(ui.asg); return a && a.strict ? a : null; };
  const wkLive = () => { const a = wkScope(); return a && a.started && !a.finished && !a.closed && !examShown && !courseShown ? a : null; };
  const wkTask = () => (cur && cur.why && cur.why.type === 'asg' ? wkLive() : null);
  const gradeWord = g => ({ 5: 'отлично', 4: 'хорошо', 3: 'удовлетворительно', 2: 'неудовлетворительно' })[g] || '';
  function wkApply(a, r) {
    if (!r) return;
    ['started', 'finished', 'closed', 'done', 'answered', 'mine', 'changed', 'result', 'items', 'grading'].forEach(k => { if (k in r) a[k] = r[k]; });
  }
  function wkRowHtml(a) {
    const n = (a.done || []).length, total = a.tasks.length;
    const res = a.result;
    const state = res ? `сдана · оценка <b>${res.grade}</b> (${res.pct}%)` : a.closed ? 'завершена учителем' : a.started ? `идёт · сдано ${n} из ${total}` : 'ещё не начата';
    const btn = res ? 'Результат' : a.closed ? '' : a.started ? 'Продолжить' : 'Начать';
    return `<div class="asg-row">
      <div><h3>📝 ${esc(a.title)}</h3><div class="asg-meta">Самостоятельная · ${total} ${plural(total, 'задание', 'задания', 'заданий')} · ${state}${a.due ? ` · срок до ${fmtDay(a.due * 1000)}` : ''}</div></div>
      ${btn ? `<button type="button" class="btn ${res ? '' : 'primary'}" data-asg="${a.id}">${btn}</button>` : '<span></span>'}
      <i class="xp-bar"><b style="width:${pct(n / total)}%"></b></i></div>`;
  }
  function wkOpen(a) {
    if (a.result || a.closed) { wkEnter(a); return; }
    if (a.started) { wkFullscreen(); wkEnter(a); return; }
    const g = a.grading || { 5: 85, 4: 65, 3: 45 };
    $('#forecastBody').innerHTML = `<h2 class="fm-title">📝 Самостоятельная «${esc(a.title)}»</h2>
      <ul class="ex-rules">
        <li><b>${a.tasks.length} ${plural(a.tasks.length, 'задание', 'задания', 'заданий')}</b>. Сданный ответ на каждое можно <b>изменить один раз</b>, потом — уже нельзя.</li>
        <li>Верно или нет, не показываем до конца. Когда сдашь всё или нажмёшь «Завершить», увидишь, сколько верных и неверных, и оценку.</li>
        <li>Оценка: «5» от ${g[5]}%, «4» от ${g[4]}%, «3» от ${g[3]}%. Учитель может завершить самостоятельную для всех — тогда оценка ставится по уже сданным ответам.</li>
        <li><b>Полный экран.</b> Самостоятельная открывается на весь экран. Выход из полного экрана и переход на другие вкладки и программы сразу видит учитель.</li>
      </ul>
      <div class="actions"><button type="button" class="btn primary" id="wkStart">Начать самостоятельную</button>
        <button type="button" class="btn ghost" id="wkCancel">Отмена</button></div>`;
    $('#forecastModal').hidden = false;
    $('#wkCancel').addEventListener('click', closeForecast);
    $('#wkStart').addEventListener('click', async e => {
      e.target.disabled = true;
      wkFullscreen();                         // полный экран — только по нажатию пользователя
      try { wkApply(a, await api('asg/start', { id: a.id })); } catch (err) { e.target.disabled = false; netError(err); return; }
      closeForecast();
      wkEnter(a);
    });
  }
  function wkEnter(a) {
    if (!leaveExam()) return;
    leaveCourse();
    if (isNarrow()) setSideOpen(false);
    ui.scope = 'asg';
    ui.asg = a.id;
    save();
    renderSidebar();
    if (a.result || a.closed) { abandonCurrent(); cur = null; wkDoneScreen(); return; }
    next();
    wkWatch();
    wkPop('Ответ можно изменить один раз. <b>Прикрепляй решение</b> к каждому: Python → «Прикрепить решение».');
  }
  function wkFullscreen() {
    if (!canFs() || document.fullscreenElement) return;
    document.documentElement.requestFullscreen().then(() => { wkFsOn = true; wkBar(); }).catch(() => {});
  }
  /** Над заданием — только номера заданий и две кнопки; сводка — во всплывающем окне, которое пропадает само. */
  function wkBarHtml(a) { return wkNavHtml(a); }
  let wkPopT = null;
  function wkPop(msg, warn) {
    const a = wkLive();
    if (!a) return;
    let el = $('#wkPop');
    if (!el) { el = document.createElement('div'); el.id = 'wkPop'; el.className = 'wk-pop'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.classList.toggle('warn', !!warn);
    el.innerHTML = `<div>📝 <b>Самостоятельная</b> · сдано ${(a.done || []).length} из ${a.tasks.length}</div>
      ${msg ? `<div class="wk-pop-msg">${msg}</div>` : ''}`;
    el.classList.remove('out');
    el.hidden = false;
    clearTimeout(wkPopT);
    wkPopT = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 350); }, 5000);
  }
  /** Номера заданий сверху, как в варианте: можно перейти к любому, сданные отмечены. */
  function wkNavHtml(a) {
    const done = new Set(a.done || []), now = cur && !examShown ? cur.task.id : null;
    return `<nav class="ex-nav wk-nav" id="wkNav" aria-label="Задания самостоятельной">${a.tasks.map((id, i) => {
      const t = byId.get(id);
      return `<button type="button" class="ex-nav-btn${id === now ? ' on' : ''}${done.has(id) ? ' done' : ''}" data-wk-go="${esc(id)}"
        title="Задание ${i + 1}${t ? ` · №${numLabel(t.n)}` : ''}${done.has(id) ? ' — ответ сдан' : ' — ответа ещё нет'}"><b>${i + 1}</b><small>${done.has(id) ? '✓ сдано' : t ? '№' + numLabel(t.n) : ''}</small></button>`;
    }).join('')}<span class="wk-nav-tools"><button type="button" class="btn ghost" id="wkFinishTop">Завершить</button></span></nav>`;
  }
  function wkBar() {
    const a = wkLive(), nav = $('#wkNav');
    if (!a) { if (nav) nav.remove(); const pop = $('#wkPop'); if (pop) pop.hidden = true; return; }
    if (nav) nav.outerHTML = wkBarHtml(a);
    else if (trainerEl && cur) trainerEl.insertAdjacentHTML('afterbegin', wkBarHtml(a));
  }
  function wkDecorate() {
    if (!wkTask()) return;
    wkBar();
    const lab = $('#trainer .answer-label');
    if (lab) lab.insertAdjacentHTML('beforeend', ' <b class="wk-note">Проверка — после завершения самостоятельной; сданный ответ можно изменить один раз.</b>');
    if (cur.group) $$('#trainer .gpart-fb').forEach(x => { x.textContent = ''; });
    const a = wkTask();
    if ((a.done || []).includes(cur.task.id)) {
      const fill = (box, shape, v) => {
        if (!box || v == null) return;
        if (shape.type === 'single') { const i = box.querySelector('.inp-single'); if (i) i.value = v; return; }
        const tk = tokens(v);
        $$('.cell', box).forEach((c, k) => { c.value = tk[k] || ''; });
      };
      if (cur.group) cur.parts.forEach((x, i) => fill(partBox(i), x.shape, (a.mine || {})[x.p.id]));
      else fill($('#answerInputs'), cur.shape, (a.mine || {})[cur.task.id]);
      cur.done = true;
      $$('#trainer .answer input').forEach(i => { i.disabled = true; });
      wkSentFeedback(a);
      renderActions();
    }
  }
  /** Ключи ответов задания (у 19–21 — вопросы) и можно ли ещё изменить сданный ответ (один раз). */
  const wkKeys = () => (cur.group ? cur.parts.map(x => x.p.id) : [cur.task.id]);
  const wkCanChange = a => !wkKeys().some(k => (a.changed || []).includes(k));
  function wkSentFeedback(a) {
    const can = wkCanChange(a);
    setFeedback('sent', 'Ответ сдан', `<div class="fb-note">${can
      ? 'Его можно <b>один раз</b> изменить. Верно или нет — узнаешь, когда завершишь самостоятельную.'
      : 'Ответ уже изменён — больше изменить нельзя. Верно или нет — узнаешь, когда завершишь самостоятельную.'}</div>
      ${can ? '<button type="button" class="btn" id="wkChangeBtn">✎ Изменить ответ</button>' : ''}`);
  }
  function wkActions(box) {
    const a = wkTask();
    const left = asgLeft(a).filter(id => id !== cur.task.id).length;
    if (cur.done) {
      box.innerHTML = (left ? '<button class="btn primary" id="nextBtn" type="button">Следующее задание →<kbd>Enter</kbd></button>' : '')
        + `<button class="btn ${left ? 'ghost' : 'primary'}" id="wkFinishBtn" type="button">Завершить самостоятельную${left ? '' : ' и узнать результат'}</button>`;
      const nb = $('#nextBtn');
      if (nb) { nb.addEventListener('click', next); setTimeout(() => nb.focus({ preventScroll: true }), 0); }
      return;
    }
    box.innerHTML = `<button class="btn primary" id="checkBtn" type="button">${cur.changing ? 'Сдать новый ответ' : 'Сдать ответ'}<kbd>Enter</kbd></button>
      ${left ? '<button class="btn ghost" id="skipBtn" type="button" title="Вернёшься к нему позже">Пропустить →</button>' : ''}
      <button class="btn ghost" id="wkFinishBtn" type="button">Завершить самостоятельную</button>`;
    $('#checkBtn').addEventListener('click', check);
    const sk = $('#skipBtn');
    if (sk) sk.addEventListener('click', next);
  }
  /** Подтверждение внутри страницы: окно confirm() браузера выкидывает из полного экрана. */
  function wkAsk(title, text, ok, extra) {
    return new Promise(res => {
      $('#forecastBody').innerHTML = `<h2 class="fm-title">${title}</h2><p class="fm-note">${text}</p>
        <div class="actions">${extra ? `<button type="button" class="btn primary" id="wkExtra">${extra}</button>` : ''}
        <button type="button" class="btn ${extra ? '' : 'primary'}" id="wkYes">${ok}</button>
        <button type="button" class="btn ghost" id="wkNo">Отмена</button></div>`;
      $('#forecastModal').hidden = false;
      const done = v => { closeForecast(); res(v); };
      $('#wkYes').addEventListener('click', () => done(true));
      $('#wkNo').addEventListener('click', () => done(false));
      if (extra) $('#wkExtra').addEventListener('click', () => done('extra'));
      setTimeout(() => $('#wkYes') && $('#wkYes').focus(), 0);
    });
  }
  async function wkSubmit() {
    const a = wkTask();
    const items = [];
    if (cur.group) {
      cur.parts.forEach((x, i) => {
        const box = partBox(i);
        const got = readAnswerIn(box, x.shape);
        items.push({ task: x.p.id, answer: got.join(' '), cells: cellsIn(box, x.shape) });
      });
      if (!items.some(x => x.answer)) { const inp = $('#trainer .gpart input'); if (inp) { inp.focus(); inp.classList.add('bad'); } return; }
    } else {
      const got = readAnswer();
      if (!got.length) { const i = $('#answerInputs input'); if (i) { i.focus(); i.classList.add('bad'); } return; }
      items.push({ task: cur.task.id, answer: got.join(' '), cells: cellsIn($('#answerInputs'), cur.shape) });
    }
    const blank = items.filter(x => !x.answer).length;
    const c = cur;
    let hasSol = false;                      // прикреплено ли решение к заданию — напомним, если нет
    try { hasSol = !!(await api('solution?task=' + encodeURIComponent(cur.task.id))).code; } catch (e) { hasSol = true; }
    const ans = await wkAsk(cur.changing ? (cur.group ? 'Изменить ответы?' : `Изменить ответ на «${esc(items[0].answer)}»?`)
      : cur.group ? 'Сдать ответы?' : `Сдать ответ «${esc(items[0].answer)}»?`,
      (cur.changing ? 'Это единственное изменение — потом поменять будет нельзя.'
        : `Его можно будет изменить ещё <b>один раз</b>.`) + `${blank ? ` Без ответа вопросов: ${blank}.` : ''}`
      + (hasSol ? '' : '<br><br><b class="wk-sol-warn">⚠ Решение не прикреплено.</b> Учитель хочет видеть, как ты решал: открой Python, вставь или напиши код и нажми «Прикрепить решение».'),
      hasSol ? 'Сдать' : 'Сдать без решения', hasSol ? null : '📎 Прикрепить решение');
    if (ans === 'extra') { togglePy(true); toast('Вставь код в окно Python и нажми «Прикрепить решение», затем сдай ответ.', 5000); return; }
    if (!ans) return;
    if (cur !== c || cur.done) return;
    setBusy(true);
    let r = null;
    try {
      for (const x of items) r = await api('asg/answer', Object.assign({ id: a.id, spent_ms: Date.now() - cur.started, change: !!cur.changing }, x));
    } catch (e) {
      setBusy(false);
      if (e.status === 409) { await wkRefresh(a); if (!wkLive()) return; toast(e.message, 4000); next(); return; }
      netError(e);
      return;
    }
    setBusy(false);
    wkApply(a, r);
    if (r && r.closed_now) { wkClosed(a); return; }
    if (r && r.changed) a.changed = r.changed;
    cur.done = true;
    cur.changing = false;
    ui.currentId = null;
    $$('#trainer .answer input').forEach(i => { i.disabled = true; i.classList.remove('bad'); });
    wkSentFeedback(a);
    renderActions();
    wkBar();
    wkPop('Ответ сдан.');
    renderAsgCard();
  }
  async function wkRefresh(a) {
    try { wkApply(a, await api('asg/state?id=' + a.id)); } catch (e) { /* попробуем позже */ }
    if (a.result && !a.finishedShown) wkClosed(a);
  }
  function wkWatch() {
    clearInterval(wkPoll);
    wkPoll = setInterval(() => {
      const a = wkLive();
      if (!a) { if (!wkScope()) clearInterval(wkPoll); return; }
      wkRefresh(a);
    }, 10000);
  }
  function wkClosed(a) {
    clearInterval(wkPoll);
    const pop = $('#wkPop');
    if (pop) pop.hidden = true;
    if (SERVER) loadHistory().then(() => { renderSidebar(); renderTopbar(); }).catch(() => {});
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    wkFsOn = false;
    if (a.result && a.result.forced) toast('Учитель завершил самостоятельную — оценка поставлена по сданным ответам.', 5000);
    if (wkScope() === a) { abandonCurrent(); cur = null; wkDoneScreen(); }
    renderAsgCard();
  }
  async function wkFinish() {
    const a = wkLive();
    if (!a) return;
    const left = asgLeft(a).length;
    if (!await wkAsk('Завершить самостоятельную?', left ? `Не сдано заданий: <b>${left}</b> — они засчитаются как неверные.` : 'Все ответы сданы — увидишь результат и оценку.', 'Завершить')) return;
    try {
      const r = await api('asg/finish', { id: a.id });
      wkApply(a, r);
      if (r.game) setTimeout(() => onGame(r.game), 800);
    } catch (e) { netError(e); return; }
    wkClosed(a);
  }
  function wkGate(a) {
    if (a.result || a.closed) { wkDoneScreen(); return; }
    trainerEl.innerHTML = `<div class="empty"><h2>📝 Самостоятельная «${esc(a.title)}»</h2>
      <p>${a.tasks.length} ${plural(a.tasks.length, 'задание', 'задания', 'заданий')} · одна попытка на каждое · результат и оценка — после сдачи. Пишется в полном экране.</p>
      <div class="actions" style="justify-content:center"><button type="button" class="btn primary" data-asg="${a.id}">${a.started ? 'Продолжить самостоятельную' : 'Начать самостоятельную'}</button></div></div>`;
    renderTopbar();
  }
  function wkDoneScreen() {
    const a = wkScope();
    if (!a) return;
    const res = a.result;
    if (!res) {                                     // всё сдано, но ещё не завершена
      if (a.closed) { trainerEl.innerHTML = `<div class="empty"><h2>Самостоятельная завершена</h2><p>Учитель завершил самостоятельную «${esc(a.title)}» до того, как ты её начал.</p></div>`; renderTopbar(); return; }
      if (!wkLive()) { wkGate(a); return; }
      trainerEl.innerHTML = `${wkBarHtml(a)}<div class="empty"><h2>Все ответы сданы</h2>
        <p>Можно завершить самостоятельную «${esc(a.title)}» и узнать результат.</p>
        <div class="actions" style="justify-content:center"><button type="button" class="btn primary" id="wkFinishBtn">Завершить и узнать результат</button></div></div>`;
      renderTopbar();
      return;
    }
    a.finishedShown = true;
    const mark = c => (c === 1 ? '<span class="chip good">верно</span>' : c === 0.5 ? '<span class="chip">половина</span>' : c === 0 ? '<span class="chip weak">неверно</span>' : '<span class="chip">нет ответа</span>');
    const rows = res.items.map((x, i) => `<tr><td class="fm-n">${i + 1}</td><td><b>№${x.n || '?'}</b></td>
      <td class="ans">${a.mine && a.mine[x.task] ? esc(a.mine[x.task]) : '<span class="fm-muted">—</span>'}</td><td>${mark(x.credit)}</td></tr>`).join('');
    trainerEl.innerHTML = `<div class="ex-result">
      <h2 class="fm-title">📝 Самостоятельная «${esc(a.title)}»</h2>
      <div class="fm-head">
        <div class="fm-score band-${res.grade >= 5 ? 'top' : res.grade >= 4 ? 'good' : res.grade >= 3 ? 'mid' : 'low'}">
          <span class="fm-big">${res.grade}</span><span class="fm-sub">оценка<br>${gradeWord(res.grade)}</span></div>
        <div class="fm-facts">
          <div>Верно: <b>${res.ok}</b>${res.half ? ` · наполовину: <b>${res.half}</b>` : ''} · неверно: <b>${res.bad}</b>${res.blank ? ` · без ответа: <b>${res.blank}</b>` : ''}</div>
          <div>Результат: <b>${res.pct}%</b> (${String(res.correct).replace('.', ',')} из ${res.total})</div>
          ${res.xp ? `<div>Опыт: <b>+${res.xp} XP</b></div>` : ''}
          ${res.forced ? '<div>Самостоятельную завершил учитель.</div>' : ''}
        </div></div>
      <p class="fm-note">Разбор с правильными ответами и решениями — кнопкой ниже и в окне «Задания от учителя» (раздел «Пройденные»): он откроется, когда самостоятельная закончится для всех. Задания самостоятельной теперь можно решать в тренировке.</p>
      <div class="fm-table-wrap"><table class="fm-table ex-table"><thead><tr><th>#</th><th>Номер</th><th>Твой ответ</th><th>Итог</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="actions"><button type="button" class="btn primary" id="wkBack">Продолжить тренировку →</button>
        <button type="button" class="btn" data-review="${a.id}">Разбор с решениями</button></div></div>`;
    $('#wkBack').addEventListener('click', () => setScope('all'));
    window.scrollTo({ top: 0 });
    renderTopbar();
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-wk-go]');
    if (go) {
      const a = wkLive(), t = byId.get(go.dataset.wkGo);
      if (a && t && !(cur && cur.task.id === t.id)) { abandonCurrent(); show({ task: t, why: { type: 'asg', a } }); }
      return;
    }
    if (e.target.closest('#wkChangeBtn')) {
      const a = wkTask();
      if (!a || !cur || !wkCanChange(a)) return;
      cur.done = false;
      cur.changing = true;
      $$('#trainer .answer input').forEach(i => { i.disabled = false; });
      setFeedback('retry', 'Изменение ответа', '<div class="fb-note">Введи новый ответ и нажми «Сдать новый ответ». Изменить можно только один раз.</div>');
      renderActions();
      const f = $('#trainer .answer input');
      if (f) f.focus();
      return;
    }
    const st = e.target.closest('#trainer [data-asg]');
    if (st) { const a = asgOf(+st.dataset.asg); if (a && a.strict) wkOpen(a); else if (a) { leaveCourse(); setScope('asg', a.id); } return; }
    if (e.target.closest('#wkFinishBtn, #wkFinishTop')) wkFinish();
    else if (e.target.closest('#wkFsBtn')) wkFullscreen();
  });
  document.addEventListener('fullscreenchange', () => {
    const a = wkLive();
    if (!a) return;
    if (document.fullscreenElement) { wkFsOn = true; wkBar(); return; }
    if (!wkFsOn) { wkBar(); return; }
    wkFsOn = false;
    a.fsExits = (a.fsExits || 0) + 1;
    api('asg/away', { id: a.id, kind: 'fs' }).catch(() => {});
    wkBar();
  });
  /** Вернулся на вкладку во время самостоятельной: учителю — уход, ученику — напоминание. */
  function wkCameBack(sec) {
    const a = wkLive();
    if (!a) return false;
    a.away = (a.away || 0) + 1;
    api('asg/away', { id: a.id, kind: 'away', dur: Math.round(sec) }).catch(() => {});
    wkBar();
    return true;                                 // уход записан для учителя; ученика не отвлекаем

  }

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
      EX.fsOn = false;                     // после перезагрузки полный экран снят — над заданием будет кнопка вернуть
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
    if (SERVER && student) {
      const ready = Promise.all([loadDaily(), loadDuels()]);
      loadSupport();
      if (P.log.length || tourSeen()) ready.then(() => setTimeout(showDailyRating, 300));   // уже знакомым — сводка, раз в день
      setTimeout(loadRating, 900);                                     // место в лиге — на кнопку вверху
    }
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

  // ------------------------------------------------------------ техподдержка: обращение уходит главному учителю, ответ — здесь
  let SUPPORT = { items: [], kinds: {}, unread: 0 };
  const SP_STATUS = { new: ['chip', 'ждёт ответа'], answered: ['chip good', 'есть ответ'], closed: ['chip', 'закрыто'] };
  async function loadSupport() {
    const b = $('#supportBtn');
    if (!SERVER || !student) { if (b) b.hidden = true; return; }
    try { SUPPORT = await api('support'); } catch (e) { return; }
    b.hidden = false;
    $('#supportDot').hidden = !SUPPORT.unread;
  }
  async function openSupport() {
    if (isNarrow()) setSideOpen(false);
    await loadSupport();
    const t = cur && cur.task && !courseShown ? cur.task : null;
    const kinds = Object.entries(SUPPORT.kinds || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    const list = SUPPORT.items.map(x => {
      const st = SP_STATUS[x.status] || SP_STATUS.new;
      return `<div class="sp-item${x.answer && !x.seen ? ' unread' : ''}"><div class="sp-head"><span class="${st[0]}">${st[1]}</span>
        <span>${esc((SUPPORT.kinds || {})[x.kind] || '')}</span><span>${apTime(x.ts)}</span>${x.task ? `<span>задание ${esc(x.task)}</span>` : ''}</div>
        <div class="sp-text">${esc(x.text)}</div>
        ${x.answer ? `<div class="sp-ans"><b>Ответ · ${apTime(x.answered)}</b>${esc(x.answer)}</div>` : ''}</div>`;
    }).join('');
    $('#forecastBody').innerHTML = `<h2 class="fm-title">🛟 Техподдержка</h2>
      <p class="fm-note">Нашёл ошибку в задании, что-то не работает или есть вопрос — напиши. Обращение получит учитель, ответ появится здесь.</p>
      <form class="sp-form" id="spForm">
        <select class="inp" id="spKind">${kinds}</select>
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Опиши, что случилось: что делал, что ожидал и что получилось" required></textarea>
        <div class="sp-row">${t ? `<label class="sp-att"><input type="checkbox" id="spTask" checked> приложить задание №${numLabel(t.n)} (${esc(t.id)})</label>` : '<span></span>'}
          <button type="submit" class="btn primary">Отправить</button></div>
      </form>
      ${list ? `<h3 class="fm-sub">Мои обращения</h3><div class="sp-list">${list}</div>` : ''}`;
    $('#forecastModal').hidden = false;
    if (t) $('#spKind').value = 'task';
    $('#spForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = { kind: $('#spKind').value, text: $('#spText').value, page: pageKind || (courseShown ? 'course' : ui.scope) };
      if (t && $('#spTask') && $('#spTask').checked) body.task = t.id;
      try { await api('support', body); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); return; }
      toast('Обращение отправлено — ответ появится в «Техподдержке»', 3500);
      openSupport();
    });
    if (SUPPORT.unread) { try { await api('support/seen', {}); } catch (e) { /* не страшно */ } SUPPORT.unread = 0; $('#supportDot').hidden = true; }
  }
  $('#supportBtn').addEventListener('click', openSupport);

  // ------------------------------------------------------------ версия и что нового (новое — сверху)
  // Каждый коммит, который меняет что-то для учеников, — новая версия: новая возможность — второе число, исправление — третье.
  const CHANGELOG = [
    ['1.47.3', '12.10.2026', ['Синие кубики теперь только сворачивают и разворачивают банк номеров — выбранный номер не сбрасывается. «Все номера» — отдельной кнопкой над сеткой']],
    ['1.47.2', '12.10.2026', ['Золотая плашка 👑 admin у администратора сайта — в рейтинге, профиле, турнирах и задании дня']],
    ['1.47.1', '12.10.2026', ['История заданий открывается страницей, как подборки и варианты, — с разбивкой по дням']],
    ['1.47.0', '12.10.2026', ['«Мои варианты» — история вариантов ЕГЭ на отдельной странице, как подборки: балл, время, график по вариантам, разбор каждого с твоими и правильными ответами и кнопкой «Перерешать»']],
    ['1.46.1', '12.10.2026', ['Убраны напоминания об уходе со страницы и выходе из полного экрана, а в варианте — плашка строгого режима: ничего не отвлекает от заданий']],
    ['1.46.0', '12.10.2026', ['🔧 Работа над ошибками: после самостоятельной сразу появляется твоя личная подборка — похожие задания того же типа на те, где ты ошибся',
      '🎯 Учитель может выдать каждому подборку по его слабым номерам — у каждого своя',
      'Сроки: за день до срока придёт напоминание, после срока работа закрывается (начатая самостоятельная сдаётся сама)']],
    ['1.45.1', '12.10.2026', ['Вариант ЕГЭ собирает сервер: ответы показываются только к выданным заданиям, задания идущей самостоятельной в вариант не попадают',
      'Защита от подбора ответов: не больше 6 ответов на одно задание в сутки и 60 проверок за 10 минут; «Показать ответ» — не больше 40 раз в сутки']],
    ['1.45.0', '12.10.2026', ['Единый банк заданий: задание дня, турниры, подборки курса и подборки учителя собираются из того же банка, что и тренажёр, — только актуальные задания с ответом',
      'Задание дня и матчи турниров теперь берутся из всех актуальных заданий, а не только с 2024 года']],
    ['1.44.1', '12.10.2026', ['Исправлено: после страниц «Курс», «Турниры» или «Задания от учителя» нажатие на номер не открывало его задания',
      'В выбранном номере теперь гарантированно выпадают только задания этого номера']],
    ['1.44.0', '12.10.2026', ['Техподдержка: кнопка «🛟 Техподдержка» в меню слева — напиши об ошибке в задании, проблеме с сайтом или задай вопрос. К обращению можно приложить текущее задание, ответ учителя появится там же']],
    ['1.43.0', '12.10.2026', ['Турниры как в футболе: жеребьёвка по корзинам, групповой этап (победа — 3 очка, ничья — 1, счёт — решённые задания), затем плей-офф и матч за 3-е место',
      'Три вида турниров: на 4, 8 и 12 игроков — каждого вида по одному в сутки',
      'Турниры открыты для всех — код больше не нужен']],
    ['1.42.0', '12.10.2026', ['Турниры: наборы на 4 и 8 игроков — как только набралось нужное число, турнир начинается сам',
      'Сетка на выбывание (четвертьфинал, полуфинал, финал): матч — 5 одинаковых заданий тебе и сопернику, больше решил — проходишь дальше, поровну — кто быстрее; на раунд сутки',
      'Призы: 100, 60 и 30 XP и награда «🎖 Победитель турнира» в профиль. Раздел пока в разработке — вход по коду']],
    ['1.41.0', '12.10.2026', ['Дуэли превращаются в «Турнир недели» с турнирной таблицей: каждый с каждым, победа — 3 очка, ничья — 1. Раздел в разработке — вход по коду',
      'У каждого уровня теперь своё звание: Новичок, Стажёр, Ученик, Юный кодер, Кодер… Легенда, Сверхразум, Титан, Абсолют']],
    ['1.40.0', '12.10.2026', ['Страница «Задания от учителя» шире: каждая работа — отдельная строка с датами — когда выдана, до какого числа сдать и сколько дней осталось, когда сдана']],
    ['1.39.1', '12.10.2026', ['В окне опыта — «Откуда опыт»: последние изменения с причиной (задание, бонус, достижение, −1 за слишком быстрый ответ, дуэль)',
      'Исправлено: честное повторение подборок (в том числе подборок курса) ошибочно считалось накруткой и срезало опыт — опыт возвращён']],
    ['1.39.0', '12.10.2026', ['У работ от учителя появились типы: самостоятельная (бывшая «контрольная»: проверка после сдачи), практическая и домашняя',
      'В практической и домашней верно или нет видно сразу, две попытки; оценка ставится сама — верно с 1-й попытки полный балл, со 2-й половина, ошибка — 0']],
    ['1.38.0', '12.10.2026', ['«Задания от учителя» — теперь отдельная страница, а не всплывающее окно: карточки подборок «Сейчас» и «Пройденные» с номерами заданий, сроком, оценкой и разбором']],
    ['1.37.2', '12.10.2026', ['Кто перерешивал подборку по кругу ради опыта, лишился всего опыта, набранного с первого такого повтора до закрытия лазейки']],
    ['1.37.1', '12.10.2026', ['Закрыта лазейка: одно и то же задание по кругу из подборки давало опыт каждый раз. Опыт пересчитан — за задание только первое решение']],
    ['1.37.0', '12.10.2026', ['Контрольная: сданный ответ можно один раз изменить — кнопкой «Изменить ответ»',
      'Значок «Задания от учителя» всегда на месте, если ты в классе; новые подборки появляются в нём сами, сданные — в разделе «Пройденные» с результатом и разбором (в истории их больше нет)']],
    ['1.36.0', '12.10.2026', ['Новая шкала опыта: №1–10 — 10 XP, №11–27 — столько, какой номер задания, и +5 XP за каждую ступень сложности выше первой. Опыт пересчитан',
      'Над заданием видно, сколько опыта оно даст; на экране результата контрольной — сколько опыта она принесла']],
    ['1.35.0', '12.10.2026', ['Если правильный ответ на задание уже показывали (после ошибок или «Показать ответ»), его решение потом засчитывается для тренировки, но без опыта, огонька, серии и достижений — пересчитано по всей истории',
      'Достижение «Флэш» (решить быстрее 20 секунд) убрано: так быстро задания не решают',
      'Вариант ЕГЭ даёт опыт, только если в нём есть хотя бы один верный ответ']],
    ['1.34.0', '12.10.2026', ['Сданная контрольная — в «Истории заданий»: ответы с пометкой «контрольная» и кнопка «Разбор» с правильными ответами, решениями и твоим кодом',
      'Разбор открывается, когда контрольная закончилась для всех: учитель её завершил, прошёл срок или сдал весь класс']],
    ['1.33.1', '12.10.2026', ['Опыт пересчитан: за каждое задание засчитывается только первое решение — повторы из истории больше не дают ни опыта, ни огонька, ни достижений, и раньше тоже',
      'Достижение «Дежавю» (решить одно задание трижды) убрано']],
    ['1.33.0', '12.10.2026', ['Уже решённое задание можно перерешать из истории для тренировки, но опыта, огонька, серии и достижений за повтор нет']],
    ['1.32.0', '12.10.2026', ['Контрольная: сводка (сколько сдано, уходы, выходы из полного экрана) теперь всплывает и сама пропадает, а не висит над заданием',
      'Если сдаёшь ответ без прикреплённого решения, сайт напомнит и предложит прикрепить код — учитель видит, у кого решения есть']],
    ['1.31.1', '12.10.2026', ['Контрольная: кнопка «←» больше не выбрасывает из контрольной — между заданиями переходи по номерам сверху']],
    ['1.31.0', '12.10.2026', ['Все подборки от учителя — контрольные: одна попытка на задание, результат и оценка после сдачи, полный экран']],
    ['1.30.1', '12.10.2026', ['Подборка, которую учитель сделал контрольной, больше не открывается в старом виде: сначала экран «Начать контрольную»']],
    ['1.30.0', '12.10.2026', ['Верный ответ быстрее чем за минуту с открытия задания — −1 XP вместо опыта, и задание не засчитывается решённым',
      'Номера заданий контрольной стали нагляднее: сданные — зелёные с ✓, под номером — номер задания ЕГЭ']],
    ['1.29.0', '12.10.2026', ['Контрольная: у каждого ученика свой случайный порядок заданий',
      'Сверху — номера всех заданий контрольной, как в варианте: можно перейти к любому, сданные отмечены']],
    ['1.28.0', '12.10.2026', ['Контрольные от учителя: на каждое задание одна попытка, ответ сдаётся без проверки — сколько верно и оценку узнаешь после завершения',
      'Контрольная пишется в полном экране; уход со вкладки и выход из полного экрана сразу видит учитель — сайт напомнит не покидать вкладку',
      'Учитель может завершить контрольную для всех — тогда оценка ставится по уже сданным ответам']],
    ['1.27.1', '12.10.2026', ['Доска: крупный текст у правого края больше не сдвигает лист вбок (из-за этого справа оставались «следы» линий) — длинный текст переносится по ширине доски']],
    ['1.27.0', '12.10.2026', ['Профиль: нажми на имя в рейтинге — увидишь награды и достижения ученика',
      'Сам выбираешь до трёх значков у своего ника — награды или достижения (кнопка «Мой профиль» в окне опыта)',
      'Повторяемые награды со счётчиком: 👑 корона дня, 🏆 победа в лиге, 🚀 повышение, ⚔️ победа в дуэли — у значка маленькое число, сколько раз получена. Достижения даются один раз',
      'Лиги: из бронзовой в серебряную выходят первые 10, из серебряной в золотую — первые 5, из золотой в алмазную — первые 3']],
    ['1.26.0', '12.10.2026', ['В рейтинге можно посмотреть все лиги — бронзовую, серебряную, золотую и алмазную: кто в них и сколько опыта у лидеров']],
    ['1.25.1', '11.10.2026', ['В подборках «Пропустить» ведёт к следующему заданию по порядку — раньше два задания сменяли друг друга по кругу']],
    ['1.25.0', '11.10.2026', ['Задания внутри номера разбиты по типам и сложности (от 1 до 5): тип и сложность видны над условием',
      'Тренажёр подбирает задания под тебя точнее: следит за успехами в каждом типе задания, начинает с лёгких и повышает сложность, когда решаешь уверенно',
      'После ошибки на повторение приходит задание того же типа, а не просто того же номера',
      'В варианте ЕГЭ задание, решённое верно, снова попадётся не раньше чем через 3 варианта',
      'В окне Python: Ctrl+/ закомментировать или раскомментировать строку или выделение']],
    ['1.24.0', '11.10.2026', ['Доска для решения: кнопка «Доска» рядом с «Python» открывает лист в клетку справа от задачи — ручка, прямая, текст, ластик, отмена. У каждого задания своя доска',
      'Верхняя панель больше не наезжает на рейтинг, когда открыто окно Python',
      'Синяя кнопка «Все задания» слева теперь показывает и скрывает банк номеров — отдельная кнопка со стрелками больше не нужна',
      'На доске можно менять размер текста: кнопки A− и A+',
      'В задание дня можно зайти только один раз в день: время идёт с первого входа, повторно войти нельзя']],
    ['1.23.0', '10.10.2026', ['За достижения теперь дают опыт: от 5 XP за лёгкие до 300 XP за самые трудные']],
    ['1.22.3', '10.10.2026', ['Исправлены формулы в «Банке ЕГЭ»: снова видны степени и индексы (около 1100 заданий, в том числе №14)', 'Верхняя панель больше не наезжает на окно Python']],
    ['1.22.2', '10.10.2026', ['Сервер выдерживает больше учеников одновременно: рейтинг собирается один раз на всех, соединения в начале урока не теряются']],
    ['1.22.1', '10.10.2026', ['Рейтинг и дуэли открываются заметно быстрее, когда учеников много']],
    ['1.22.0', '10.10.2026', ['Настройки вида в «Тема оформления»: размер текста, яркость фона, повышенная контрастность, акцентный цвет, отключение анимаций',
      'Режим «Фокус»: без рейтинга, огонька, уровня и дуэлей — только задания и прогноз']],
    ['1.21.0', '10.10.2026', ['10 тем оформления на выбор: тёмные Графит, GitHub Dark, Dracula, Nord, Catppuccin Mocha и светлые Бумага, GitHub Light, macOS, Solarized Light, Catppuccin Latte — в меню профиля «Тема оформления»',
      'Кнопка ☀ переключает между выбранной тёмной и светлой темой']],
    ['1.20.0', '10.10.2026', ['Новые цвета тем: тёмная «Графит» — нейтральная, без зеленоватого оттенка; светлая «Бумага» — тёплая и мягкая для глаз']],
    ['1.19.4', '10.10.2026', ['Верхняя панель стала тоньше, а прогноз, рейтинг, огонёк и уровень в ней — крупнее']],
    ['1.19.3', '10.10.2026', ['Кнопки темы и сворачивания меню — сразу под значками разделов']],
    ['1.19.2', '10.10.2026', ['Достижения: длинные названия и описания больше не вылезают за карточку', 'Верхняя панель стала чуть крупнее на широких экранах']],
    ['1.19.1', '10.10.2026', ['10 новых достижений: «Упрямец», «Подглядыватель», «Обеденный перерыв», «Медленно, но верно», «Радуга», «Идеальный день», «Ещё одну серию», «Спидран», «Новичкам везёт», «Дежавю»',
      'Убраны достижения SIX SEVEN за №6 и №7, «Ответ на всё» и «1337 h4x0r»']],
    ['1.19.0', '10.10.2026', ['Новый вид прогноза ЕГЭ: столбики загораются по мере роста балла',
      'В окне прогноза — «Что потренировать»: три номера, которые дадут больше всего баллов, сколько не хватает до следующего рубежа, что пора повторить и сильные стороны',
      'Новые смешные достижения: «Золушка», «Пятница, 13-е», «Оливье подождёт», «Феникс» и другие — ищи в меню уровня']],
    ['1.18.1', '10.10.2026', ['Новые объёмные значки в панели слева', 'Плитка 19–21 стала компактной и встала рядом с 17 и 18']],
    ['1.18.0', '10.10.2026', ['Новое меню: слева панель иконок — все задания, избранное, история, вариант, задание дня, дуэли; при наведении — подсказка',
      'Вокруг каждого номера кольцо освоения: чем больше решено, тем полнее круг',
      'Уровень и опыт — в верхней панели; имя, тема, пароль и выход — в меню под кружком с инициалами',
      'Свёрнутое меню оставляет полоску иконок — разделы всегда под рукой']],
    ['1.17.1', '09.10.2026', ['Лига: в таблице 20 мест, в лигу выше выходят первые 10', 'Битва классов — только для классов, которые выбрал учитель',
      'Поправлены карточки «Задание дня» и «Дуэли» в меню']],
    ['1.17.0', '09.10.2026', ['Лиги на неделю: бронза → серебро → золото → алмаз; в понедельник тройка лидеров поднимается, последние трое опускаются',
      '«Тебя обогнали!» — при входе видно, кто тебя обошёл и сколько заданий до места выше',
      'Задание дня: одно на всех, рейтинг по скорости решения с первой попытки, самый быстрый носит 👑',
      'Дуэли: вызови одноклассника — 5 одинаковых заданий, победитель забирает опыт',
      'Битва классов: опыт классов за неделю и цель от учителя', 'Значки в рейтинге: 🔥 огонёк, 👑 задание дня, 💎 алмазная лига']],
    ['1.16.0', '09.10.2026', ['Рейтинг переехал в верхнюю панель: кубок с твоим местом за неделю рядом с огоньком']],
    ['1.15.0', '09.10.2026', ['Рейтинг ТОП-10 за день, неделю и месяц и рейтинг огонька',
      'Раз в день при входе — окно «Рейтинг дня»', 'Задание 9: к таблице добавлен 9.txt — сразу открывается в Python',
      'Редактор Python открывается пустым, без вспомогательного кода']],
    ['1.14.0', '08.10.2026', ['Новый банк Egeshka: 50 авторских заданий №1–5 (Egeshka Malevin D.) с файлами и решениями']],
    ['1.13.2', '08.10.2026', ['Подпись by Malevin — фамилия в цветах логотипа']],
    ['1.13.1', '08.10.2026', ['Под названием Egeshka — подпись автора: by Malevin']],
    ['1.13.0', '08.10.2026', ['Внизу меню — версия сайта и список изменений', 'Подсказки про Enter и Esc убраны из меню']],
    ['1.12.0', '08.10.2026', ['Маркер поверх условия: красный, синий и зелёный цвета, ластик и «стереть всё»']],
    ['1.11.1', '08.10.2026', ['Кнопки темы и сворачивания меню больше не наезжают на название']],
    ['1.11.0', '08.10.2026', ['Меню слева можно свернуть кнопкой «» — заданию достаётся больше места']],
    ['1.10.0', '08.10.2026', ['Вход запоминается на 30 дней', 'Галочка «Чужой компьютер» — вход только до закрытия браузера',
      'Исправлено: регистрация и вход иногда писали «Нет связи с сервером»']],
    ['1.9.6', '08.10.2026', ['Ответ вида «13992 или 13993» — одна ячейка, засчитывается любое из чисел']],
    ['1.9.5', '08.10.2026', ['В заданиях ФИПИ под условием больше нет надписи «Рисунок не загрузился»']],
    ['1.9.4', '08.10.2026', ['Задания варианта, которые не трогал, больше не считаются ошибками']],
    ['1.9.3', '08.10.2026', ['Заголовок вверху не сжимается в узкий столбик при открытом Python']],
    ['1.9.2', '08.10.2026', ['Огонёк продлевают 3 решённых задания за день']],
    ['1.9.1', '08.10.2026', ['Огонёк больше не зависит от цели на день']],
    ['1.9.0', '08.10.2026', ['Огонёк: серия дней подряд и календарь недели в верхней панели']],
    ['1.8.1', '08.10.2026', ['Новый значок Egeshka во вкладке браузера и рядом с названием']],
    ['1.8.0', '08.10.2026', ['Новый игровой дизайн: скруглённые карточки, объёмные кнопки, шрифт Nunito']],
    ['1.7.0', '08.10.2026', ['Окно знакомства с сайтом для новых учеников']],
    ['1.6.2', '08.10.2026', ['Большая схема графа помещается справа от таблицы, а не уходит вниз']],
    ['1.6.1', '08.10.2026', ['Таблица и рисунок стоят рядом в заданиях «на рисунке справа»']],
    ['1.6.0', '08.10.2026', ['Python: подсветка кода как в PyCharm, размер шрифта, черепашку видно лучше']],
    ['1.5.0', '07.10.2026', ['Python прямо на сайте: open() для файлов задания, черепашка для №6', 'Решения к заданиям',
      'Автор задания показывается в условии']],
    ['1.4.0', '07.10.2026', ['Сайт стал Egeshka: опыт, уровни, достижения и рейтинг класса', 'Подборки заданий от учителя']],
    ['1.3.1', '07.10.2026', ['Файлы к заданиям ФИПИ скачиваются и открываются']],
    ['1.3.0', '07.10.2026', ['Вход по паролю', 'История заданий и возврат к прошлому заданию']],
    ['1.2.3', '03.10.2026', ['Понятная страница, если файл к заданию не найден']],
    ['1.2.2', '03.10.2026', ['Картинки к заданиям находятся надёжнее']],
    ['1.2.1', '03.10.2026', ['Если картинка не загрузилась — понятное сообщение и запасная ссылка']],
    ['1.2.0', '03.10.2026', ['Вариант ЕГЭ на 3 ч 55 мин с баллами в конце', 'Избранное и прогноз балла', 'Прогресс одинаковый на всех устройствах']],
    ['1.1.0', '03.10.2026', ['Светлая тема', 'Удобная версия для телефона']],
    ['1.0.0', '03.10.2026', ['Первый выпуск: все 27 номеров ЕГЭ по информатике из банков ЕГЭ и КомпЕГЭ',
      'Подборка под ученика: чаще то, что получается хуже, и повторение ошибок']],
  ];
  const versionBtn = $('#versionBtn');
  if (versionBtn) versionBtn.textContent = `Версия ${CHANGELOG[0][0]} · что нового`;
  versionBtn?.addEventListener('click', () => {
    if (isNarrow()) setSideOpen(false);
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Что нового</h2>
      <div class="changelog">${CHANGELOG.map(([v, d, items], i) => `<section class="cl-ver${i ? '' : ' cl-now'}">
        <h3><span class="cl-num">${v}</span><span class="fm-muted">${d}</span>${i ? '' : '<span class="chip good">сейчас</span>'}</h3>
        <ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>`).join('')}</div>`;
    $('#forecastModal').hidden = false;
  });
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
          await loadCourseSets();
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
