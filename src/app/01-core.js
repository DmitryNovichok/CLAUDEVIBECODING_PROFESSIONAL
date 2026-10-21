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
  // пароли не должны сохраняться в браузере: за компьютерами класса сидят разные ученики.
  // Где браузер умеет прятать символы обычного поля (Chrome, Яндекс, Edge, Safari) — поле текстовое, с точками:
  // менеджер паролей его не распознаёт и не предлагает «Сохранить пароль»; в остальных — пароль без автозаполнения
  if (window.CSS && CSS.supports && CSS.supports('-webkit-text-security', 'disc')) {
    $$('input.secret').forEach(i => {
      i.type = 'text';
      Object.assign(i, { spellcheck: false });
      i.setAttribute('autocapitalize', 'off');
      i.setAttribute('autocorrect', 'off');
      i.setAttribute('data-lpignore', 'true');            // расширения-менеджеры паролей
      i.setAttribute('data-1p-ignore', '');
    });
  }
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
    // то же сообщение уже на экране — второй раз не показываем; больше трёх сразу — старые уходят
    if ([...box.children].some(x => x.textContent === msg && !x.classList.contains('out'))) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    const live = [...box.children].filter(x => !x.classList.contains('out'));
    for (const x of live.slice(0, Math.max(0, live.length - 3))) { x.classList.add('out'); setTimeout(() => x.remove(), 250); }
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
  // Компьютер в классе (сервер узнаёт школьную сеть) или «Чужой компьютер»: браузер не должен сохранять и подставлять пароль.
  // Поле пароля — обычный текст со звёздочками (-webkit-text-security): для браузера это не пароль, он его не запоминает
  // и сохранённый раньше не подставит. Где так нельзя (Firefox, телефон) — type=password с autocomplete="new-password".
  const PW_FIELDS = ['#loginPass', '#regPass', '#regPass2', '#pwOld', '#pwNew', '#pwNew2'];
  const PW_MASK_OK = (() => { try { return CSS.supports('-webkit-text-security', 'disc') && matchMedia('(pointer: fine)').matches; } catch (e) { return false; } })();
  let SCHOOL_NET = false;
  function pwNoSave(on) {
    PW_FIELDS.forEach(sel => {
      const el = $(sel);
      if (!el) return;
      const mask = on && PW_MASK_OK;
      el.type = mask ? 'text' : 'password';
      el.classList.toggle('pw-mask', mask);
      el.setAttribute('autocomplete', on && !mask ? 'new-password' : 'off');
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('autocapitalize', 'off');
      if (mask) el.name = 'f' + Math.random().toString(36).slice(2, 9);    // без «password» в имени — менеджер паролей не узнает поле
    });
  }

  /**
   * Окно входа: вкладки «Вход» (ФИО + пароль) и «Регистрация» (код + ФИО + пароль).
   * В школьной сети (сервер узнаёт её по адресу) вход временный, ФИО не подставляется, а пароль браузер не сохраняет.
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
      const tempBox = $('#loginTemp');
      tempBox.onchange = () => pwNoSave(SCHOOL_NET || tempBox.checked);
      pwNoSave(SCHOOL_NET || tempBox.checked);
      fetch('api/net', { cache: 'no-store' }).then(r => r.json()).then(n => {
        SCHOOL_NET = !!n.shared;
        $('#loginSchool').hidden = !SCHOOL_NET;
        tempBox.closest('label').hidden = SCHOOL_NET;
        pwNoSave(SCHOOL_NET || tempBox.checked);
        if (SCHOOL_NET && $('#loginName').value === last) {        // ФИО прошлого ученика за этим компьютером не показываем
          $('#loginName').value = '';
          try { localStorage.removeItem(LAST_NAME_STORE); } catch (e) { /* нет доступа */ }
          if (!forms.login.hidden) $('#loginName').focus();
        }
      }).catch(() => { /* нет связи — как обычно */ });
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
          if (r.shared) { try { sessionStorage.setItem(TEMP_KEY, '1'); } catch (e) { /* нет доступа */ } }   // компьютер в классе
          if (!temp && !r.shared) writeJSON(LAST_NAME_STORE, r.name);
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
        if (!$('#regTerms').checked || !$('#regConsent').checked) { errEl.textContent = 'Отметьте обе галочки: соглашение и согласие на обработку персональных данных.'; return; }
        run(forms.reg, { mode: 'register', code: $('#regCode').value.trim(), name, new_password: pw, consent: true });
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
        const r0 = await loginRequest(null, saved.token);   // сервер снова поставит cookie (прежний общий вход — новый токен устройства)
        writeStudent({ sid: r0.sid, name: r0.name, token: r0.token || saved.token });
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

