// Собрано из src/app/*.js командой python3 tools/build_app.py — правьте модули, а не этот файл.
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

  // ═══════ src/app/02-trainer.js
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
          line: 'У каждого своё задание того же типа и сложности. Решишь с первой попытки — попадёшь в рейтинг по времени.' };
      case 'asg': {
        const a = why.a;
        if (!a) return { chip: '<span class="chip accent">Задание учителя</span>', line: '' };
        if (a.duel) {
          const done = a.tasks.length - asgLeft(a).length;
          return { chip: `<span class="chip accent">${a.duelId ? '⚔️ Дуэль' : '🏆 Турнир'}</span>`,
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
          ${CALC_BTN}
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
    pkBar();
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
    if ($('#pkNav')) pkBar();
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
      if (cur !== c || !r) return;
      if (r.think_left != null) cur.thinkUntil = Date.now() + r.think_left * 1000;
      restoreTries(r.tries || {});
    }).catch(() => { /* проверка всё равно пройдёт: сервер начнёт отсчёт с первого ответа */ });
  }
  /** Вернулись к заданию после неверной попытки (ушли к другому заданию подборки): попытка не сгорела —
      продолжаем со второй. Сколько попыток было, знает сервер. */
  function restoreTries(used) {
    if (!cur || cur.done) return;
    const fill = n => new Array(n).fill('—');
    if (cur.group) {
      let any = false;
      cur.parts.forEach((x, i) => {
        const n = used[x.p.id];
        if (!n || n <= x.attempt || x.final) return;
        x.answers = fill(n);
        x.attempt = n;
        partRetry(i);
        any = true;
      });
      if (!any) return;
      cur.attempt = cur.parts.reduce((a, x) => a + x.attempt, 0);
    } else {
      const n = used[cur.task.id];
      if (!n || n <= cur.attempt) return;
      cur.answers = fill(n);
      cur.attempt = n;
      setFeedback('retry', 'Осталась одна попытка',
        '<div class="fb-note">Первая попытка по этому заданию уже была — исправь ответ и проверь ещё раз.</div>');
    }
    pkPending.add(cur.task.id);
    renderActions();
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
    autoAttach(cur.task.id);
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
    autoAttach(cur.task.id);
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
    if (res && res.daily_fast) toast('⚠ Задание дня решено слишком быстро — так его не прочитать. Результат в рейтинг не засчитан.', 6000);
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

  // ═══════ src/app/03-forecast-course.js
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
      else if (st.v === 'pyc') openPyc();
      else if (st.v === 'pycl') openPycLevel(st.m, st.l);
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
    const runBtn = (k, ans, out) => `<div class="sl-btns"><button type="button" class="btn primary" data-py-slide="${i}:${k}">▶ Открыть в Python</button>
        ${ans ? `<details class="sl-ansbox"><summary>Показать ответ</summary><span class="sl-ok"><i aria-hidden="true">✓</i>Отлично! Ответ: <b>${esc(ans)}</b></span></details>` : ''}
        ${out ? `<details class="sl-ansbox sl-outbox"><summary>Что выведет программа</summary><pre class="sl-out">${esc(out)}</pre></details>` : ''}</div>`;
    const codeBox = (code, k, ans, out) => `<div class="sl-codecol"><pre class="sl-code">${highlightPy(code)}</pre>${runBtn(k, ans, out)}</div>`;
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
        ${codeBox(sl.code, 0, sl.ans, sl.out)}</div></div>`;
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
        `<div class="sl-block"><p>${safeHtml(b.cond)}</p>${codeBox(b.code, k, b.ans, b.out)}</div>`).join('')}</div></div>`;
    }
    const code = sl.t === 'code' ? `<pre class="sl-code">${highlightPy(sl.code)}</pre>${runBtn(0, sl.ans, sl.out)}` : '';
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
    if (!SERVER || !student || !DECK || DECK.pyc) return;
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
    if (DECK.pyc) {                       // пример курса программирования: его файлы — рядом с кодом
      PYC_PY = { id: `pyc:${DECK.n}:${i}:${k || 0}`, n: 0, pyc: true, label: DECK.label + ' · пример',
        att: (sl.files || []).map(f => ({ name: f.name, href: f.url })) };
    }
    if (DECK.pyc && pyOpen()) pySync(); else togglePy(true);
    const ta = $('#pyCode');
    ta.value = code;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    $('#pyTask').textContent = DECK.pyc ? DECK.label + ' · пример' : `курс · №${DECK.n}`;
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

  // ═══════ src/app/04-stats-goals.js
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
  const FREEZE_MAX = 4, FREEZE_PRICE = 500;
  /** Дни, закрытые без трёх заданий: заморозка (freeze) или восстановление учителем (restore). Знает сервер. */
  const fireCover = () => (GAME && GAME.cover) || {};
  const dayOk = (m, k) => (m.get(k) || 0) >= fireNeed() || !!fireCover()[k];
  /** День прибавляет огоньку: выполнен или восстановлен учителем. День под заморозкой серию не рвёт, но и не прибавляет —
      заморозка сохраняет огонёк (было 10 — осталось 10), а не продлевает его. Так же считает сервер. */
  const dayAdds = (m, k) => (m.get(k) || 0) >= fireNeed() || fireCover()[k] === 'restore';
  /** Дней подряд с выполненной целью (сегодняшний день ещё может быть не закончен). */
  function dayStreak() {
    const m = dayCounts();
    const d = new Date();
    let s = dayAdds(m, dayKey(d.getTime())) ? 1 : 0;
    for (;;) {
      d.setDate(d.getDate() - 1);
      const k = dayKey(d.getTime());
      if (!dayOk(m, k)) break;
      if (dayAdds(m, k)) s++;
    }
    return s;
  }
  /** Самая длинная серия дней за всё время. */
  function bestDayStreak() {
    const m = dayCounts();
    const days = [...new Set([...m.keys(), ...Object.keys(fireCover())])].filter(k => dayOk(m, k)).sort();
    let best = 0, run = 0, prev = null;
    for (const k of days) {
      const t = new Date(k + 'T12:00').getTime();
      run = (prev != null && Math.round((t - prev) / 864e5) === 1 ? run : 0) + (dayAdds(m, k) ? 1 : 0);
      best = Math.max(best, run); prev = t;
    }
    return best;
  }
  const FLAME = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path class="fl-out" d="M12 1.8c.5 3.2 2.6 4.9 4.4 6.9 1.9 2.1 3.3 4.2 3.3 7.1 0 4.3-3.4 7.4-7.7 7.4S4.3 20.1 4.3 15.8c0-2.4 1-4.4 2.6-6 .3 1.6 1 2.8 2.2 3.5-.4-4.5 1-8.5 2.9-11.5z"/><path class="fl-in" d="M12.2 11.6c1.7 1.8 3.4 3.4 3.4 5.7 0 2.2-1.6 3.8-3.6 3.8s-3.6-1.6-3.6-3.8c0-1.2.5-2.2 1.3-3 .2.8.7 1.4 1.3 1.7-.2-1.6.3-3.1 1.2-4.4z"/></svg>';
  const SNOW = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M11 2h2v3.6l2.3-2.3 1.4 1.4-3.7 3.7v2.9l2.5-1.5 1.3-5.1 1.9.5-.8 3.1 3.1-1.8 1 1.7-3.1 1.8 3.1.8-.5 1.9-5.1-1.3-2.5 1.5 2.5 1.5 5.1-1.3.5 1.9-3.1.8 3.1 1.8-1 1.7-3.1-1.8.8 3.1-1.9.5-1.3-5.1-2.5-1.5v2.9l3.7 3.7-1.4 1.4-2.3-2.3V22h-2v-3.6l-2.3 2.3-1.4-1.4 3.7-3.7v-2.9l-2.5 1.5-1.3 5.1-1.9-.5.8-3.1-3.1 1.8-1-1.7 3.1-1.8-3.1-.8.5-1.9 5.1 1.3 2.5-1.5-2.5-1.5-5.1 1.3-.5-1.9 3.1-.8-3.1-1.8 1-1.7 3.1 1.8-.8-3.1 1.9-.5 1.3 5.1 2.5 1.5V8.4L7.3 4.7l1.4-1.4L11 5.6z"/></svg>';
  /** Заморозки огонька: сколько в запасе и кнопка «купить» (только на сервере, не учителю). */
  function freezeHtml() {
    if (!SERVER || !GAME || TEACHER) return '';
    const have = GAME.freezes || 0, full = have >= FREEZE_MAX, poor = (GAME.xp || 0) < FREEZE_PRICE;
    const slots = Array.from({ length: FREEZE_MAX }, (_, i) => `<i class="fz-slot${i < have ? ' on' : ''}">${SNOW}</i>`).join('');
    return `<div class="sm-freeze">
        <div class="fz-top"><span class="fz-slots" title="Заморозки в запасе: ${have} из ${FREEZE_MAX}">${slots}</span>
          <button type="button" class="btn fz-buy" id="freezeBuy"${full || poor ? ' disabled' : ''}
            title="${full ? 'Запас заполнен' : poor ? `Нужно ${FREEZE_PRICE} XP` : `Списать ${FREEZE_PRICE} XP`}">${full ? 'Запас полон' : `Купить · ${FREEZE_PRICE} XP`}</button></div>
        <div class="fz-note">Пропустишь день — заморозка сработает сама, и огонёк не погаснет. Запас — до ${FREEZE_MAX} штук.</div>
      </div>`;
  }
  function streakMenuHtml(days, todayDone, left) {
    const m = dayCounts(), need = fireNeed(), cover = fireCover();
    const d = new Date(); d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // понедельник этой недели
    const todayK = dayKey(Date.now());
    const week = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => {
      const k = dayKey(d.getTime()); d.setDate(d.getDate() + 1);
      const real = (m.get(k) || 0) >= need, frozen = !real && cover[k] === 'freeze', ok = real || !!cover[k];
      const tip = frozen ? ' title="День закрыт заморозкой"' : !real && ok ? ' title="Огонёк восстановлен"' : '';
      return `<span class="sw-day${ok ? ' ok' : ''}${frozen ? ' frozen' : ''}${k === todayK ? ' now' : ''}${k > todayK ? ' future' : ''}"${tip}><i>${frozen ? SNOW : ok ? FLAME : ''}</i>${w}</span>`;
    }).join('');
    const best = Math.max(bestDayStreak(), days);
    return `<div class="sm-head"><span class="sm-flame${todayDone ? ' on' : ''}">${FLAME}</span>
        <div><div class="sm-num">${days} ${plural(days, 'день', 'дня', 'дней')}</div>
        <div class="sm-sub">${todayDone ? 'Огонёк на сегодня горит — возвращайся завтра!'
          : days ? `Реши сегодня ещё ${left} ${plural(left, 'задание', 'задания', 'заданий')}, иначе серия сгорит`
          : `Реши ${left} ${plural(left, 'задание', 'задания', 'заданий')}, чтобы зажечь огонёк`}</div></div></div>
      <div class="sm-week">${week}</div>
      ${freezeHtml()}
      <div class="sm-foot">Лучшая серия: <b>${best} ${plural(best, 'день', 'дня', 'дней')}</b></div>`;
  }
  let goalToastDay = null, fireDay = null, fireBurst = false;
  /** После каждого засчитанного ответа: поздравить с целью дня, отправить прогноз учителю. */
  function afterAnswer() {
    if (false && prefs.goal) {                    // цель на день убрана из верхней панели
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
      h = `<span class="scope-title">${a.duelId ? '⚔️ Дуэль' : a.duel ? '🏆 Турнир' : a.course ? '🎓 Курс' : 'От учителя'}</span>
        ${a.personal ? '<span class="pers-tag">Персональная подборка</span>' : ''}
        <span class="scope-stats">«${esc(a.title)}» · решено ${a.tasks.length - left} из ${a.tasks.length}</span>
        ${a.due ? `<span class="chip ${a.due * 1000 < Date.now() && left ? 'weak' : ''}">срок до ${fmtDay(a.due * 1000)}</span>` : ''}
        ${a.ends ? `<span class="chip accent duel-timer" id="duelTimer">⏱ ${duelLeftText(a.ends)}</span>` : ''}
        ${a.duel ? '<button type="button" class="link-btn surrender-btn" id="surrenderBtn" title="Сдаться — матч сразу проигран, сопернику победа">🏳 Сдаться</button>' : ''}`;
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
      ${P.log.length ? `<span class="dots" title="Последние ответы">${lastDots}</span>` : ''}
`;
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
    $('#pycCard')?.classList.toggle('on', courseShown && pageKind === 'pyc');
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
    // выбрана сданная (или не начатая) самостоятельная — show() показал бы её экран результата вместо задания
    if (wkScope() && !wkLive()) { ui.scope = scopeOf(t.n); save(); }
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

  // ═══════ src/app/05-exam.js
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

  // ═══════ src/app/06-server-sync.js
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




  // ═══════ src/app/07-calc.js
  // ------------------------------------------------------------ калькулятор
  // Плавающее окно поверх задания: как калькулятор на телефоне — операции по очереди, «=», %, ±, ⌫.
  // Окно перетаскивается за верхнюю полосу (место запоминается), работает с клавиатуры.
  const CALC_BTN = '<button type="button" class="icon-btn calc-btn" id="calcBtn" title="Калькулятор">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="4" rx="1"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/></svg><span>Калькулятор</span></button>';
  const CALC_POS = 'egeTrainer.calcPos';
  const CALC = { cur: '0', acc: null, op: null, fresh: true, expr: '' };
  const CALC_KEYS = [['back', '⌫', 'fn'], ['ac', 'AC', 'fn'], ['%', '%', 'fn'], ['/', '÷', 'op'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×', 'op'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', 'op'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
    ['neg', '⁺∕₋', 'fn2'], ['0', '0'], ['.', ',', 'num calc-dec'], ['=', '=', 'eq']];
  const OP_SIGN = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  /** Число для экрана: до 12 значащих цифр, запятая, пробелы между тысячами. */
  function calcFmt(x) {
    if (typeof x === 'string') {
      const [i, f] = x.split('.');
      return (i.startsWith('-') ? '−' : '') + i.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') + (f !== undefined ? ',' + f : '');
    }
    if (!isFinite(x)) return 'Ошибка';
    let s = Math.abs(x) >= 1e15 || (x !== 0 && Math.abs(x) < 1e-9) ? x.toExponential(8).replace(/\.?0+e/, 'e') : String(+x.toPrecision(12));
    if (s.includes('e')) return s.replace('.', ',').replace('-', '−');
    return calcFmt(s);
  }
  const calcNum = () => parseFloat(CALC.cur) || 0;
  function calcApply(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b === 0 ? NaN : a / b;
    return b;
  }
  function calcPress(k) {
    const C = CALC;
    if (C.cur === 'err' && k !== 'ac') calcPress('ac');
    if (/^[0-9]$/.test(k)) {
      if (C.fresh) { C.cur = k; C.fresh = false; }
      else if (C.cur.replace(/[-.]/g, '').length < 15) C.cur = C.cur === '0' ? k : C.cur === '-0' ? '-' + k : C.cur + k;
    } else if (k === '.') {
      if (C.fresh) { C.cur = '0.'; C.fresh = false; } else if (!C.cur.includes('.')) C.cur += '.';
    } else if (k === 'back') {
      if (!C.fresh) { C.cur = C.cur.slice(0, -1); if (C.cur === '' || C.cur === '-') { C.cur = '0'; C.fresh = true; } }
    } else if (k === 'ac') {
      Object.assign(C, { cur: '0', acc: null, op: null, fresh: true, expr: '' });
    } else if (k === 'neg') {
      C.cur = C.cur.startsWith('-') ? C.cur.slice(1) : C.cur === '0' ? '0' : '-' + C.cur;
    } else if (k === '%') {
      // как на телефоне: 200 + 10% → 200 + 20; одно число — делится на 100
      const v = C.op === '+' || C.op === '-' ? (C.acc || 0) * calcNum() / 100 : calcNum() / 100;
      C.cur = String(+v.toPrecision(12)); C.fresh = true;
    } else if (OP_SIGN[k]) {
      if (C.op && !C.fresh) C.acc = calcApply(C.acc, C.op, calcNum());
      else if (C.acc === null || !C.op) C.acc = calcNum();
      C.op = k; C.fresh = true;
      if (!isFinite(C.acc)) { C.cur = 'err'; C.acc = null; C.op = null; }
      else { C.cur = String(+C.acc.toPrecision(12)); C.expr = calcFmt(C.acc) + ' ' + OP_SIGN[k]; }
    } else if (k === '=') {
      if (C.op) {
        const b = calcNum(), r = calcApply(C.acc, C.op, b);
        C.expr = `${calcFmt(C.acc)} ${OP_SIGN[C.op]} ${calcFmt(b)} =`;
        C.acc = null; C.op = null; C.fresh = true;
        C.cur = isFinite(r) ? String(+r.toPrecision(12)) : 'err';
      }
    }
    calcRender(k);
  }
  function calcRender(k) {
    const box = $('#calcBox');
    if (!box) return;
    const shown = CALC.cur === 'err' ? 'Ошибка' : calcFmt(CALC.fresh ? +CALC.cur : CALC.cur);
    const out = box.querySelector('.calc-out');
    out.textContent = shown;
    out.style.fontSize = shown.length > 14 ? '26px' : shown.length > 10 ? '34px' : '';
    box.querySelector('.calc-expr').textContent = CALC.expr;
    box.querySelectorAll('[data-ck]').forEach(b => b.classList.toggle('on', b.dataset.ck === CALC.op && CALC.fresh));
    if (k) { const b = box.querySelector(`[data-ck="${CSS.escape(k)}"]`); if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); } }
  }
  function toggleCalc(force) {
    let box = $('#calcBox');
    const open = force != null ? force : !box || box.hidden;
    if (!box) {
      box = document.createElement('div');
      box.id = 'calcBox';
      box.className = 'calc';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Калькулятор');
      box.innerHTML = `<div class="calc-bar" title="Перетащите, чтобы передвинуть"><span class="calc-dots"><button type="button" class="calc-x" aria-label="Закрыть калькулятор"></button><i></i><i></i></span>
          <b>Калькулятор</b></div>
        <div class="calc-screen" title="Нажмите, чтобы скопировать"><div class="calc-expr"></div><div class="calc-out">0</div></div>
        <div class="calc-keys">${CALC_KEYS.map(([k, t, c]) => `<button type="button" class="calc-k ${c || 'num'}" data-ck="${k}">${t}</button>`).join('')}</div>`;
      document.body.appendChild(box);
      try {
        const p = JSON.parse(localStorage.getItem(CALC_POS) || 'null');
        if (p) { box.style.left = Math.min(p.x, innerWidth - 260) + 'px'; box.style.top = Math.min(p.y, innerHeight - 200) + 'px'; box.style.right = 'auto'; }
      } catch (e) { /* по умолчанию — справа сверху */ }
      box.addEventListener('click', e => {
        if (e.target.closest('.calc-x')) return toggleCalc(false);
        const b = e.target.closest('[data-ck]');
        if (b) return calcPress(b.dataset.ck);
        if (e.target.closest('.calc-screen') && CALC.cur !== 'err') {
          navigator.clipboard?.writeText(String(calcNum()).replace('.', ',')).then(() => toast('Скопировано: ' + calcFmt(calcNum()), 1500), () => {});
        }
      });
      // перетаскивание за верхнюю полосу
      box.querySelector('.calc-bar').addEventListener('pointerdown', e => {
        if (e.target.closest('.calc-x')) return;
        const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = ev => {
          const x = Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx)), y = Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy));
          Object.assign(box.style, { left: x + 'px', top: y + 'px', right: 'auto' });
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          try { localStorage.setItem(CALC_POS, JSON.stringify({ x: parseInt(box.style.left) || 0, y: parseInt(box.style.top) || 0 })); } catch (e) { /* нет места */ }
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
        e.preventDefault();
      });
    }
    box.hidden = !open;
    $$('#calcBtn').forEach(b => b.classList.toggle('on', open));
    if (open) calcRender();
  }
  document.addEventListener('keydown', e => {
    const box = $('#calcBox');
    if (!box || box.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;   // печатают в поле — не перехватываем
    const map = { Enter: '=', '=': '=', Backspace: 'back', Escape: 'ac', Delete: 'ac', ',': '.', '.': '.', '%': '%',
      '+': '+', '-': '-', '*': '*', '/': '/', 'x': '*', 'х': '*', ':': '/' };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault();
    calcPress(k);
  });

  // ═══════ src/app/08-board.js
  // ------------------------------------------------------------ доска для решения
  // Панель справа от задания (вместо окна Python): ручка, прямая, текст, ластик. Штрихи хранятся в пикселях листа,
  // у каждого задания своя доска (в браузере ученика, последние BD_KEEP). Цвет «ink» — цвет текста темы.
  const BD_BTN = '<button type="button" class="icon-btn bd-btn" id="bdBtn" title="Доска — решать от руки рядом с задачей">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M7 13l3-3 2 2 4-4"/></svg><span>Доска</span></button>';
  const BD_KEEP = 40, BD_INDEX = 'egeTrainer.boards', bdKey = id => 'egeTrainer.board.' + id;
  const BD_BGS = ['grid', 'lines', 'plain'];
  const BD_FS = [16, 20, 26, 34, 44, 60];
  const BD = { task: null, strokes: [], undo: [], redo: [], tool: 'pen', color: 'ink', size: 2, fs: 20, bg: 'grid', drawing: null, text: null, ro: null, saveT: 0, minH: 0 };
  const bdOpen = () => !$('#bdDock').hidden;
  try { const v = readJSON('egeTrainer.boardPrefs'); if (v) Object.assign(BD, { bg: BD_BGS.includes(v.bg) ? v.bg : 'grid', size: v.size === 5 ? 5 : 2, fs: BD_FS.includes(v.fs) ? v.fs : 20 }); } catch (e) {}
  const bdPrefs = () => writeJSON('egeTrainer.boardPrefs', { bg: BD.bg, size: BD.size, fs: BD.fs });
  // размер текста: у старых надписей его нет — тогда по толщине, как раньше
  const bdFs = st => st.fs || (st.w > 3 ? 22 : 17);
  const bdFont = fs => `${fs}px ${getComputedStyle(document.body).fontFamily}`;

  function bdLoad(id) {
    const d = readJSON(bdKey(id));
    BD.strokes = d && Array.isArray(d.s) ? d.s : [];
    BD.minH = d && d.h > 0 ? d.h : 0;
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
      // с картинками доска весит больше: не помещается в память браузера — освобождаем место от самых старых досок
      const raw = JSON.stringify({ s: BD.strokes, t: Date.now(), h: BD.minH || undefined });
      for (;;) {
        try { storage && storage.setItem(bdKey(id), raw); break; } catch (e) {
          if (idx.length <= 1) { if (!BD.full) { BD.full = true; toast('Доска слишком большая, чтобы сохранить её в браузере: удалите часть картинок', 5000); } break; }
          try { storage.removeItem(bdKey(idx.shift())); } catch (x) { break; }
        }
      }
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
      if (st.k === 'img') maxY = Math.max(maxY, st.y + st.ih);
      else if (st.k === 'text') maxY = Math.max(maxY, st.y + String(st.t).split('\n').length * bdFs(st) * 1.24 + 10);
      else for (let i = 1; i < st.p.length; i += 2) if (st.p[i] > maxY) maxY = st.p[i];
    }
    const h = Math.max(sh.clientHeight - 1, maxY + 320, BD.minH);   // лист растёт вниз, пока решаешь; ⇣ — удлинить заранее
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    return dpr;
  }
  // картинки на доске: хранятся как data:-адрес (не зависят от сервера), рисуются под штрихами, нарисованными позже
  const BD_IMGS = new Map();
  function bdImg(src) {
    let im = BD_IMGS.get(src);
    if (!im) {
      im = new Image();
      im.onload = () => bdRedraw();
      im.src = src;
      BD_IMGS.set(src, im);
      if (BD_IMGS.size > 60) BD_IMGS.delete(BD_IMGS.keys().next().value);
    }
    return im;
  }
  function bdDrawStroke(g, st) {
    if (st.k === 'img') {
      const im = bdImg(st.src);
      g.fillStyle = '#fff';                             // картинки заданий — на белом, как в условии
      g.fillRect(st.x, st.y, st.iw, st.ih);
      if (im.complete && im.naturalWidth) g.drawImage(im, st.x, st.y, st.iw, st.ih);
      return;
    }
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
      if (st.k === 'img') return x >= st.x && x <= st.x + st.iw && y >= st.y && y <= st.y + st.ih;
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
      $('#bdDock').style.removeProperty('flex-basis');
      try { localStorage.removeItem(DOCK_W.bdDock); } catch (x) {}
      const on = document.body.classList.toggle('bd-wide');
      $('#bdWide').setAttribute('aria-pressed', String(on));
      setTimeout(bdRedraw, 30);
    } else if (id === 'bdImg') {
      const imgs = $$('#cond img').filter(i => i.complete && i.naturalWidth);
      if (!imgs.length) { toast('В условии этого задания нет картинок. Любую картинку можно скопировать и вставить на доску (Ctrl+V) или перетащить мышью.', 5000); return; }
      bdInsert(imgs.map(i => i.currentSrc || i.src));
    } else if (id === 'bdLonger') {
      const sh = $('#bdSheet');
      BD.minH = Math.max(BD.minH, $('#bdCanvas').clientHeight) + Math.max(400, sh.clientHeight);
      bdRedraw(); bdSaveSoon();
      sh.scrollTo({ top: sh.scrollHeight, behavior: 'smooth' });
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

  /** Картинку — в data:-адрес, уменьшенную до ширины листа: так она хранится вместе с доской и не пропадёт. */
  function bdImageData(src) {
    return new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => {
        const maxW = 1200, k = Math.min(1, maxW / im.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        let data;
        try { data = c.toDataURL('image/png'); if (data.length > 450000) data = c.toDataURL('image/jpeg', 0.82); }
        catch (e) { fail(e); return; }                  // чужой сайт не разрешил: картинку не прочитать
        ok({ data, w: c.width, h: c.height });
      };
      im.onerror = fail;
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) im.crossOrigin = 'anonymous';
      im.src = src;
    });
  }
  /** Вставить картинки на доску: в точку (x, y) или в верх видимой части листа, одну под другой. */
  async function bdInsert(srcs, x, y) {
    if (!bdOpen() || !srcs.length) return;
    bdTextCommit();
    const sh = $('#bdSheet');
    let px = x != null ? x : 10, py = y != null ? y : sh.scrollTop + 10;
    const added = [];
    for (const src of srcs.slice(0, 6)) {
      let d;
      try { d = await bdImageData(src); } catch (e) { toast('Эту картинку не получилось вставить — сохраните её на компьютер и перетащите файл на доску', 5000); continue; }
      const maxW = Math.max(60, sh.clientWidth - 20 - px);
      const k = Math.min(1, maxW / d.w);
      const st = { k: 'img', x: px, y: py, iw: Math.round(d.w * k), ih: Math.round(d.h * k), src: d.data };
      BD.strokes.push(st);
      added.push(st);
      py += st.ih + 12;
    }
    if (!added.length) return;
    bdDo({ add: added });
    if (BD.tool === 'eraser' || BD.tool === 'text') bdSetTool('pen');
    bdRedraw(); bdSaveSoon();
  }
  const bdFileData = f => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(f); });
  /** Буфер обмена и перетаскивание браузер даёт прочитать только сразу, внутри события: забираем всё заранее. */
  const bdGrab = dt => ({
    files: Array.from((dt && dt.files) || []).filter(f => /^image\//.test(f.type)),
    html: (dt && dt.getData && dt.getData('text/html')) || '',
    uri: ((dt && dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain'))) || '').trim(),
  });
  /** Картинки: файлы, картинка из HTML (например, скопированная из условия), ссылка на картинку. */
  async function bdSourcesOf(got) {
    const out = [];
    for (const f of got.files) { const d = await bdFileData(f); if (d) out.push(d); }
    if (out.length) return out;
    const m = got.html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) return [new URL(m[1].replace(/&amp;/g, '&'), location.href).href];
    const uri = got.uri;
    if (uri && /^(https?:|data:image\/)/i.test(uri) && /\.(png|jpe?g|gif|webp|svg)(\?|#|$)|^data:image/i.test(uri)) return [uri];
    return out;
  }
  document.addEventListener('paste', async e => {
    if (!bdOpen() || e.target.closest('input, textarea, [contenteditable]')) return;
    const got = bdGrab(e.clipboardData);
    if (!got.files.length && !/<img/i.test(got.html)) return;            // обычный текст — не наше дело
    e.preventDefault();
    const srcs = await bdSourcesOf(got);
    if (srcs.length) bdInsert(srcs);
  });
  $('#bdSheet').addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('#bdSheet').classList.add('drop'); });
  $('#bdSheet').addEventListener('dragleave', () => $('#bdSheet').classList.remove('drop'));
  $('#bdSheet').addEventListener('drop', async e => {
    e.preventDefault();
    $('#bdSheet').classList.remove('drop');
    const [x, y] = bdPos(e);
    const srcs = await bdSourcesOf(bdGrab(e.dataTransfer));
    if (srcs.length) bdInsert(srcs, Math.max(0, x - 20), Math.max(0, y - 20));
    else toast('Перетащите картинку — например, рисунок из условия задания', 3500);
  });

  // кнопки размера текста не забирают фокус у надписи, которую печатают, — она растёт прямо на глазах
  $('#bdDock').addEventListener('mousedown', e => { if (e.target.closest('[data-bd-fs]') && BD.text) e.preventDefault(); });
  // ------------------------------------------------------------ правые панели: ширина — тянуть левый край влево
  // Python и доска запоминают свою ширину; двойной щелчок по краю — обычная ширина. Задаче оставляем не меньше 340px.
  const DOCK_W = { pyDock: 'egeTrainer.dockW.py', bdDock: 'egeTrainer.dockW.bd' };
  const dockMax = () => Math.max(360, window.innerWidth - (document.body.classList.contains('side-min') ? 80 : 300) - 340);
  function dockSetW(dock, w) {
    if (w) dock.style.flexBasis = Math.round(Math.max(320, Math.min(dockMax(), w))) + 'px';
    else dock.style.removeProperty('flex-basis');
    if (dock.id === 'bdDock') setTimeout(bdRedraw, 30);
  }
  for (const [id, key] of Object.entries(DOCK_W)) {
    const dock = $('#' + id), grip = dock && dock.querySelector('[data-dock-grip]');
    if (!grip) continue;
    try { const v = +localStorage.getItem(key); if (v >= 320) dockSetW(dock, v); } catch (e) {}
    let drag = null;
    grip.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, w: dock.getBoundingClientRect().width };
      grip.classList.add('on');
      document.body.classList.add('dock-drag');
    });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      const w = Math.max(320, Math.min(dockMax(), drag.w + drag.x - e.clientX));
      dock.style.flexBasis = Math.round(w) + 'px';
      if (id === 'bdDock') bdRedraw();
    });
    const up = () => {
      if (!drag) return;
      drag = null;
      grip.classList.remove('on');
      document.body.classList.remove('dock-drag');
      if (id === 'bdDock') { document.body.classList.remove('bd-wide'); $('#bdWide')?.setAttribute('aria-pressed', 'false'); bdRedraw(); }
      try { localStorage.setItem(key, String(Math.round(dock.getBoundingClientRect().width))); } catch (e) {}
    };
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    grip.addEventListener('dblclick', () => { dockSetW(dock, 0); try { localStorage.removeItem(key); } catch (e) {} });
  }
  window.addEventListener('resize', () => {
    for (const id of Object.keys(DOCK_W)) {
      const dock = $('#' + id);
      if (dock && dock.style.flexBasis) dockSetW(dock, parseFloat(dock.style.flexBasis));
    }
  });

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

  // ═══════ src/app/09-python.js
  // ------------------------------------------------------------ Python в браузере
  // Настоящий CPython (Pyodide) в отдельном потоке: math, itertools, functools, ipaddress, re, string, collections…
  // Файлы задания лежат рядом с кодом — open('17.txt') работает. Черепашка для №6 рисует на холсте.
  const PY_BTN = '<button type="button" class="icon-btn py-btn" id="pyBtn" title="Решить на Python прямо здесь">Python</button>';
  const PY = { worker: null, ready: false, running: false, task: null, saveTimer: null };
  const pyOpen = () => !$('#pyDock').hidden;
  const pyTaskNow = () => (courseShown && pageKind === 'pyc' ? PYC_PY
    : (examShown && EX ? byId.get((EX.items[EX.cur] || {}).id) : cur && cur.task)) || null;

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
    $('#pyTask').textContent = t.pyc ? t.label : `задание ${numLabel(t.n)}`;
    $('#pyFiles').innerHTML = files.length
      ? 'Файлы рядом с кодом: ' + files.map(f => `<code>open('${esc(f.name)}')</code>`).join(' ')
      : (t.att || []).length ? 'Файлы этого задания лежат на другом сайте — скачайте их кнопкой под условием.' : '';
    $('#pyAttach').textContent = 'Прикрепить решение';
    $('#pyAttach').hidden = !SERVER || !student || !!t.pyc;     // в курсе программирования код уходит вместе с ответом
    let code = readCode(t.id);
    if (code == null && SERVER && student && !t.pyc) {
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
    pyPaint(true);
  }
  /** Раскраска под полем ввода; парная скобка у курсора подсвечивается рамкой (как в PyCharm). */
  let pyMarks = '';
  function pyPaint(force) {
    const ta = $('#pyCode');
    const marks = bracketMarks(ta.value, ta.selectionStart, ta.selectionEnd, document.activeElement === ta);
    const key = marks.map(m => m.join(':')).join(',');
    if (!force && key === pyMarks) return;
    pyMarks = key;
    $('#pyHl').innerHTML = '<div class="py-hl-in">' + highlightPy(ta.value, marks) + '\n</div>';
    syncScroll();
  }
  // раскрашенная копия сдвигается сдвигом, а не прокруткой: у прокрутки свой предел, и в конце длинной строки
  // копия «отставала» от поля ввода — часть кода становилась невидимой
  function syncScroll() {
    const ta = $('#pyCode'), inner = $('#pyHl').firstElementChild;
    $('#pyGutter').scrollTop = ta.scrollTop;
    if (inner) inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  }
  /** Скобка рядом с курсором (или выделенная) и её пара: [[позиция, 'ok'|'bad'], ...]. Скобки в строках и комментариях не в счёт. */
  const BR_OPEN = '([{', BR_CLOSE = ')]}';
  function bracketMarks(code, a, b, focused) {
    if (!focused || code.length > 200000) return [];
    let i = -1;
    if (b - a === 1 && (BR_OPEN + BR_CLOSE).includes(code[a])) i = a;
    else if (a === b) {
      if (a > 0 && (BR_OPEN + BR_CLOSE).includes(code[a - 1])) i = a - 1;
      else if ((BR_OPEN + BR_CLOSE).includes(code[a])) i = a;
    }
    if (i < 0) return [];
    // где строки и комментарии — там скобки не считаем
    const skip = new Uint8Array(code.length);
    PY_TOK.lastIndex = 0;
    for (let m; (m = PY_TOK.exec(code));) if (m[1] || m[2]) skip.fill(1, m.index, PY_TOK.lastIndex);
    if (skip[i]) return [];
    const ch = code[i], open = BR_OPEN.includes(ch);
    const pair = open ? BR_CLOSE[BR_OPEN.indexOf(ch)] : BR_OPEN[BR_CLOSE.indexOf(ch)];
    const step = open ? 1 : -1;
    let depth = 0;
    for (let j = i; j >= 0 && j < code.length; j += step) {
      if (skip[j]) continue;
      if (code[j] === ch) depth++;
      else if (code[j] === pair && --depth === 0) return [[Math.min(i, j), 'ok'], [Math.max(i, j), 'ok']];
    }
    return [[i, 'bad']];
  }

  // подсветка синтаксиса в цветах PyCharm: под прозрачным полем ввода лежит раскрашенная копия текста
  const PY_KW = new Set(('False None True and as assert async await break class continue def del elif else except finally for '
    + 'from global if import in is lambda nonlocal not or pass raise return try while with yield match case').split(' '));
  const PY_BI = new Set(('abs all any ascii bin bool bytes callable chr complex dict dir divmod enumerate eval exec filter float '
    + 'format frozenset getattr globals hasattr hash help hex id input int isinstance issubclass iter len list locals map max '
    + 'min next object oct open ord pow print range repr reversed round set setattr slice sorted str sum super tuple type vars zip '
    + 'Exception ValueError KeyError IndexError TypeError ZeroDivisionError RecursionError StopIteration NameError').split(' '));
  const PY_TOK = /(#[^\n]*)|((?:[rRbBuUfF]{1,2})?(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))|(@[A-Za-z_][\w.]*)|(\b(?:0[xXoObB][\da-fA-F_]+|\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?j?)\b|\.\d+\b)|([A-Za-z_\u0400-\u04FF][\w\u0400-\u04FF]*)/g;
  function highlightPy(code, marks) {
    let out = '', last = 0, prevWord = '';
    const mk = new Map((marks || []).map(([p, k]) => [p, k]));
    // обычный текст между словами и строками; в нём же стоят скобки — их и обводим
    const plain = (from, to) => {
      if (!mk.size) return esc(code.slice(from, to));
      let o = '';
      for (let k = from; k < to; k++) o += mk.has(k) ? `<span class="hl-br ${mk.get(k)}">${esc(code[k])}</span>` : esc(code[k]);
      return o;
    };
    PY_TOK.lastIndex = 0;
    for (let m; (m = PY_TOK.exec(code));) {
      out += plain(last, m.index);
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
    return out + plain(last, code.length);
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
    // парные скобки и кавычки: открыл — сразу закрылась, курсор внутри; закрывающую поверх такой же — просто перешагнуть
    const PAIR = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    if (!(e.ctrlKey && !e.altKey) && !e.metaKey && !e.isComposing && e.key.length === 1) {   // AltGr = Ctrl+Alt — тоже ввод символа
      const k = e.key, nx = v[b] || '', pv = v[a - 1] || '';
      const isQ = k === '"' || k === "'";
      if (a === b && (')]}'.includes(k) || isQ) && nx === k) { e.preventDefault(); ta.setSelectionRange(a + 1, a + 1); pyPaint(); return; }
      if (PAIR[k]) {
        if (a !== b) { e.preventDefault(); put(k + v.slice(a, b) + PAIR[k], a, b, a + 1, b + 1); return; }   // обернуть выделение
        const free = !nx || /[\s)\]},:;=]/.test(nx);
        if (free && !(isQ && (/\w/.test(pv) || pv === k))) { e.preventDefault(); put(k + PAIR[k], a, b, a + 1); return; }
      }
    }
    if (e.key === 'Backspace' && a === b && a > 0 && PAIR[v[a - 1]] && PAIR[v[a - 1]] === v[a]) {
      e.preventDefault(); put('', a - 1, a + 1, a - 1); return;          // пустая пара () — удалить обе
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
  $('#pyTtClose').addEventListener('click', () => {
    if ($('#pyTurtle').classList.contains('big')) $('#pyBig').click();
    $('#pyTurtle').hidden = true;
  });
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
  // курсор переехал — пересчитать подсветку парной скобки
  document.addEventListener('selectionchange', () => { if (document.activeElement === $('#pyCode')) pyPaint(); });
  $('#pyCode').addEventListener('blur', () => pyPaint());
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

  /** Код из редактора Python к этому заданию — прикрепить как решение (при «Сдать ответ»). true — прикрепили. */
  async function autoAttach(tid) {
    if (!SERVER || !student || !tid) return false;
    const code = PY.task && PY.task.id === tid ? $('#pyCode').value : readCode(tid);
    if (!code || !code.trim()) return false;
    try {
      await api('solution', { task: tid, code });
      if (PY.task && PY.task.id === tid) $('#pyAttach').textContent = 'Решение прикреплено ✓';
      return true;
    } catch (e) { return false; }
  }

  // ═══════ src/app/10-levels-league.js
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
    const c = $('#coinCard');
    if (c) {
      c.hidden = TEACHER;                    // учитель дарит из панели — биткоины ему не нужны
      $('#coinNum').textContent = GAME.coins || 0;
      c.title = `Биткоины: ${GAME.coins || 0} ₿ — магазин подарков`;
    }
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
    if (g.froze) toast(`❄️ Заморозка спасла огонёк`, 5000);
    if (g.gift_drop) setTimeout(giftLive, 1500);           // решил очередные 25 — подарок за труд
    if (g.btc_fast > (old.btc_fast || 0)) toast('−1 ₿: задание решено быстрее 30 секунд — биткоины даются за труд', 5000);
    if (g.exam_coins > (old.exam_coins || 0)) toast(`🎓 +${g.exam_coins - (old.exam_coins || 0)} ₿ — бонус за вариант`, 5000);
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
  const lbValue = (key, v) => key === 'fire' ? `${v} ${plural(v, 'день', 'дня', 'дней')}` : `${v} ${plural(v, 'очко', 'очка', 'очков')}`;
  /** Из чего сложились очки: опыт, заработанные ₿ и доля заданий без ошибок за период. */
  const lbParts = r => (r.xp == null ? '' : `${r.xp} XP · ${r.btc} ₿ · ${r.acc}%<span class="lp-noerr"> без ошибок</span>`);
  /** Значок у ника: строка (старый формат) или {i, t, n} — у повторяемых наград маленькое число, сколько раз получена. */
  const badgeHtml = b => typeof b === 'string' ? esc(b)
    : `<span class="bdg" title="${esc(b.t || '')}${b.n ? ' × ' + b.n : ''}">${esc(b.i)}${b.n ? `<sup>${b.n}</sup>` : ''}</span>`;
  /** Подарки у ника — маленькие значки после наград: уникальный — на своём цветном фоне, одинаковые обычные — числом. */
  const giftBadge = g => (g.u ? `<span class="bdg ugb r-${g.u.r}" style="--c1:${g.u.c1};--c2:${g.u.c2}" title="${esc(g.t)}"><i class="gfx-${g.u.fx}">${esc(g.i)}</i></span>`
    : badgeHtml(g));
  const giftsHtml = r => (r.gifts || []).length ? ` <span class="lb-gifts">${r.gifts.map(giftBadge).join('')}</span>` : '';
  const placeHtml = p => p <= 3 ? ['🥇', '🥈', '🥉'][p - 1] : p;
  // ---- подиум + список: тройка лидеров крупно, остальные строкой; аватар — самый редкий уникальный подарок
  const GIFT_RANK = { myth: 4, legend: 3, epic: 2, rare: 1 };
  const topGift = r => (r.gifts || []).filter(g => g.u).sort((a, b) => (GIFT_RANK[b.u.r] || 0) - (GIFT_RANK[a.u.r] || 0))[0];
  function lbAvatar(r, size) {
    const g = topGift(r);
    return g ? `<span class="lp-av r-${g.u.r}" style="--c1:${g.u.c1};--c2:${g.u.c2};--s:${size}px" title="${esc(g.t)}"><i class="gfx-${g.u.fx}">${esc(g.i)}</i></span>`
      : `<span class="lp-av plain" style="--s:${size}px" aria-hidden="true">${esc(((r.name || '?').trim()[0]) || '?')}</span>`;
  }
  /** Значки и подарки у ника: первые max — крупно, остальные — «+N» (все — в профиле). skip — подарок, который уже в аватаре. */
  function lbItems(r, skip) {
    return [...(r.badges || []).map(b => (typeof b === 'string' ? { i: b } : b)), ...(r.gifts || []).filter(g => g !== skip).map(g => Object.assign({ gift: 1 }, g))];
  }
  const lbIcon = x => {
    const tip = esc((x.t || '') + (x.n ? ' × ' + x.n : '')), sup = x.n ? `<sup>${x.n}</sup>` : '';
    if (x.gift && x.u) return `<span class="lp-ic lp-ug r-${x.u.r}" style="--c1:${x.u.c1};--c2:${x.u.c2}" title="${tip}"><i class="gfx-${x.u.fx}">${esc(x.i)}</i></span>`;
    return `<span class="lp-ic${/^[\x20-\x7e]{2,}$/.test(x.i) ? ' lp-txt' : ''}" title="${tip}">${esc(x.i)}${sup}</span>`;
  };
  function lbIcons(items, max, cls = 'lp-icons') {
    const rest = items.length - max;
    return `<span class="${cls}">${items.slice(0, max).map(lbIcon).join('')}${rest > 0           // пустой — тоже: держит колонку в строке
      ? `<span class="lp-more" title="${esc(items.slice(max).map(x => x.t || x.i).join(', '))}">+${rest}</span>` : ''}</span>`;
  }
  const lbNm = r => (r.sid ? `<button type="button" class="lb-name lp-nm" data-prof="${r.sid}" title="Открыть профиль">${esc(r.name)}</button>` : `<span class="lp-nm">${esc(r.name)}</span>`) + admTag(r.sid);
  /** rows — места по порядку; zoneOf(r) → 'up' | 'down' | ''; lines(r) — разделитель зоны перед строкой; tail — строки «…» и «ты». */
  function podiumHtml(rows, key, zoneOf = () => '', lines = () => '', tail = []) {
    const top = rows.filter(r => r.place <= 3), rest = rows.filter(r => r.place > 3);
    const pd = r => {
      const z = zoneOf(r);
      return `<div class="lp-pd lp-p${r.place}${r.me ? ' me' : ''}${z ? ' z-' + z : ''}">${r.place === 1 ? '<span class="lp-crown" aria-hidden="true">👑</span>' : ''}
        ${lbAvatar(r, r.place === 1 ? 64 : 52)}${lbNm(r)}${r.level ? `<small class="fm-muted">ур. ${r.level}</small>` : ''}
        <span class="lp-medal">${placeHtml(r.place)}</span><b class="lp-val">${lbValue(key, r.value)}</b>
        ${lbParts(r) ? `<small class="lp-parts">${lbParts(r)}</small>` : ''}${lbIcons(lbItems(r, topGift(r)), 2, 'lp-chips')}
        <i class="lp-step"></i></div>`;
    };
    const order = [top.find(r => r.place === 2), top.find(r => r.place === 1), top.find(r => r.place === 3)].filter(Boolean);
    const row = r => {
      const z = zoneOf(r);
      return `${lines(r)}<div class="lp-row${r.me ? ' me' : ''}${z ? ' z-' + z : ''}"><span class="lp-place">${r.place}</span>${lbAvatar(r, 36)}
        <span class="lp-who">${lbNm(r)}${r.level ? `<small>ур. ${r.level}</small>` : ''}</span>${lbIcons(lbItems(r), 3)}
        <span class="lp-val"><b>${lbValue(key, r.value)}</b>${lbParts(r) ? `<small>${lbParts(r)}</small>` : ''}</span></div>`;
    };
    return `${order.length ? `<div class="lp-podium n${order.length}">${order.map(pd).join('')}</div>` : ''}
      <div class="lp-list">${rest.map(row).join('')}${tail.length ? `<div class="lp-gap">…</div>${tail.map(row).join('')}` : ''}</div>`;
  }
  const daysLeft = endSec => Math.max(0, Math.ceil((endSec * 1000 - Date.now()) / 864e5));

  function leagueHtml(L) {
    const zoneOf = r => (r.value > 0 && r.place <= L.up ? 'up' : L.down && r.place > L.total - L.down ? 'down' : '');
    const lines = r => (L.up && r.place === L.up + 1 ? `<div class="lp-zone up">▲ ${L.up === 1 ? 'первый поднимется' : `топ-${L.up} поднимутся`}</div>` : '')
      + (L.down && r.place === L.total - L.down + 1 ? '<div class="lp-zone down">▼ опустятся</div>' : '');
    const mineOut = L.me && L.me.place > L.top.length;              // я ниже 20-го места — покажу свою строку отдельно
    const left = daysLeft(L.ends);
    return `<div class="lg-head"><span class="lg-icon">${L.icon}</span><div><b>${esc(L.name)}</b>
        <div class="fm-muted">Итоги в понедельник — ${left ? `через ${left} ${plural(left, 'день', 'дня', 'дней')}` : 'сегодня ночью'}.
        ${L.up ? `Первые ${L.up} поднимутся в ${LEAGUE_TO[L.idx + 1]} лигу.` : 'Это высшая лига — удержись в ней!'}
        ${L.down ? ` Последние ${L.down} опустятся.` : ''}</div></div></div>
      ${L.top.length ? podiumHtml(L.top, 'league', zoneOf, lines,
          mineOut ? [{ place: L.me.place, name: 'Ты', me: true, level: '', badges: [], value: L.me.value, sid: student && student.sid }] : [])
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
    const mine = b.me && b.me.place > 10
      ? `<p class="lb-mine">Твоё место: <b>${b.me.place}</b> из ${b.total} · ${lbValue(key, b.me.value)}${lbParts(b.me) ? ` (${lbParts(b.me).replace(/<[^>]+>/g, '')})` : ''}</p>`
      : (!b.me ? `<p class="lb-mine fm-muted">${key === 'fire' ? 'Зажги огонёк — и попадёшь в рейтинг' : 'Реши задание — и попадёшь в рейтинг'}</p>` : '');
    return `${podiumHtml(b.top, key)}${mine}`;
  }
  function boardsHtml(d, key) {
    const noClasses = !(d.boards && d.boards.classes && d.boards.classes.list.length);   // учитель не включил битву классов
    const tabs = LB_TABS.filter(([k]) => k !== 'classes' || !noClasses);
    return `<div class="lb-wrap" data-lb='${esc(JSON.stringify(d))}'>
      <div class="lb-tabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" data-lbtab="${k}" class="${k === key ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="lb-body">${boardHtml(d, key)}</div>
      <p class="fm-muted lb-legend"><b>Место — по очкам</b> за период: (XP + заработанные ₿) / 2 × доля заданий без ошибок. Например, 300 XP и 40 ₿,
        а ошибки были в 10% заданий: (300 + 40) / 2 × 0,9 = 153 очка. Ошибка — неверный ответ, решение со второй попытки или «Показать ответ».
        Огонёк — по дням подряд.</p>
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
  let profTab = 'gifts', profMore = false;      // вкладка профиля; показаны ли неполученные награды
  async function openProfile(sid, back) {
    profBack = back || null;
    profTab = 'gifts';
    profMore = false;
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
  /** 6,2к — коротко для плашки статистики. */
  const shortNum = v => (v >= 10000 ? Math.round(v / 1000) + 'к' : v >= 1000 ? String(Math.round(v / 100) / 10).replace('.', ',') + 'к' : String(v));
  function renderProfile() {
    const P = PROF;
    if (!P) return;
    const back = profBack === 'rating' ? '<button type="button" class="btn small ghost" id="profBack">← к рейтингу</button>' : '';
    const pick = profPick;
    const nick = (pick ? pick.map(k => [...P.awards, ...P.extra, ...P.ach].find(a => a.k === k)).filter(Boolean)
      .map(a => ({ i: a.i, t: a.t, n: a.k === 'fire' || a.n > 1 ? a.n : 0 })) : P.badges);
    const name = `${esc(P.name)}${admTag(P.sid)}${P.me ? ' <span class="chip good">это ты</span>' : ''}`;
    const sub = `${esc(P.title)} · ${P.league.icon} ${esc(P.league.name)} · ${P.xp.toLocaleString('ru-RU')} XP`;
    const xpLine = P.need ? `<div class="ph-xp">${P.cur.toLocaleString('ru-RU')} / ${P.need.toLocaleString('ru-RU')} XP до ${P.level + 1}-го уровня</div>` : '';
    const cnt = k => (P.awards.find(a => a.k === k) || {}).n || 0;
    const stat = (v, t) => `<div class="pf-stat"><b>${v}</b><small>${t}</small></div>`;
    const stats = `<div class="pf-stats">${stat('🔥 ' + (P.fire || 0), plural(P.fire || 0, 'день подряд', 'дня подряд', 'дней подряд'))}
      ${stat('👑 ' + cnt('crown'), plural(cnt('crown'), 'корона', 'короны', 'корон'))}${stat('⚔️ ' + cnt('duel'), plural(cnt('duel'), 'победа', 'победы', 'побед'))}
      ${stat('💎 ' + shortNum((P.gift_value || {}).sell || 0), '₿ подарки')}</div>`;
    const acts = P.me ? `<button type="button" class="btn" id="profEdit">🏅 Значки у ника</button>${SERVER && !TEACHER ? '<button type="button" class="btn" data-gift-to="">🛍 Магазин</button>' : ''}`
      : !TEACHER && SERVER ? `<button type="button" class="btn primary" data-gift-to="${P.sid}">🎁 Подарить подарок</button>` : '';
    const nickLine = `<div class="pf-nick">У ника: ${nick.length || (P.gifts || []).length ? `<span class="lb-badges">${nick.map(badgeHtml).join('')}</span>${giftsHtml(P)}` : '<span class="fm-muted">пока ничего</span>'}
      ${P.me && !pick ? `<small class="fm-muted" title="${P.chosen ? '' : 'Автоматически: огонёк 7+, корона дня, алмазная лига'}">· ${P.chosen ? 'выбраны тобой' : 'автоматически'}</small>` : ''}</div>`;
    const earned = [...P.awards.filter(a => a.n > 0), ...P.extra];
    let body;
    if (pick) {                      // выбор значков у ника — все полученные награды и достижения сразу
      body = `<div class="pf-tools"><span class="fm-muted">Выбрано ${pick.length} из ${P.max} — нажимай на полученные награды и достижения.</span>
          <button type="button" class="btn small" id="profSave">Сохранить</button>
          <button type="button" class="btn small ghost" id="profAuto">Автоматически</button>
          <button type="button" class="btn small ghost" id="profCancel">Отмена</button></div>
        ${earned.length || P.ach.length ? `<div class="ach-grid">${earned.map(a => profItem(a, a.k === 'fire' || a.k === 'diamond' ? 'extra' : 'award')).join('')}${P.ach.map(a => profItem(a, 'ach')).join('')}</div>`
          : '<p class="fm-muted">Пока нечего выбрать — значками становятся полученные награды и достижения.</p>'}`;
    } else {
      const tab = (k, t) => `<button type="button" class="pf-tab${profTab === k ? ' on' : ''}" data-ptab="${k}">${t}</button>`;
      const locked = P.awards.filter(a => !a.n);
      const more = (n, w) => n ? `<p class="pf-more">${w}</p>` : '';
      body = `<div class="pf-tabs" role="tablist">${tab('gifts', `🎁 Подарки ${P.gifts_total}`)}${tab('awards', `🏆 Награды ${earned.length}`)}${tab('ach', `⭐ ${P.ach.length}/${P.ach_total}`)}</div>
        ${profTab === 'gifts' ? profGiftsHtml(P)
          : profTab === 'awards' ? `${earned.length ? `<div class="ach-grid">${earned.map(a => profItem(a, a.k === 'fire' || a.k === 'diamond' ? 'extra' : 'award')).join('')}</div>` : '<p class="fm-muted">Пока ни одной — награды дают за корону дня, лиги, дуэли и турниры.</p>'}
            ${locked.length ? (profMore ? `<div class="ach-grid pf-locked">${locked.map(a => profItem(a, 'award')).join('')}</div>`
              : `<button type="button" class="pf-more" data-pmore>🔒 Ещё ${locked.length} ${plural(locked.length, 'награду', 'награды', 'наград')} можно получить — показать</button>`) : ''}`
          : `${P.ach.length ? `<div class="ach-grid">${P.ach.map(a => profItem(a, 'ach')).join('')}</div>` : '<p class="fm-muted">Пока ни одного.</p>'}
            ${more(P.ach_total - P.ach.length, `🔒 Ещё ${P.ach_total - P.ach.length} ${plural(P.ach_total - P.ach.length, 'достижение', 'достижения', 'достижений')} можно получить — каждое один раз`)}`}`;
    }
    $('#forecastBody').innerHTML = `${back}
      ${profHeroHtml(P, profFlyers(P), `<h2 class="fm-title">${name}</h2><span>${sub}</span>${xpLine}`)}
      ${stats}
      ${acts ? `<div class="pf-acts">${acts}</div>` : ''}
      ${nickLine}
      ${body}`;
  }
  const FLY_RANK = { myth: 0, legend: 1, epic: 2, rare: 3 };
  const byRank = (a, b) => (FLY_RANK[a.uniq.rar.k] ?? 9) - (FLY_RANK[b.uniq.rar.k] ?? 9) || a.uniq.n - b.uniq.n;
  /** Улучшенные подарки, которые летают в шапке профиля: сначала самые редкие (при равной редкости — меньший номер), до 6. */
  const profFlyers = P => (P.gift_list || []).filter(g => g.uniq).sort(byRank).slice(0, 6);
  /** Кольцо прогресса до следующего уровня вокруг круга с уровнем. */
  function xpRing(cur, need) {
    const r = 56, c = 2 * Math.PI * r, part = need ? Math.min(1, cur / need) : 0;
    return `<svg class="ph-ring" viewBox="0 0 118 118" aria-hidden="true"><circle cx="59" cy="59" r="${r}" class="ph-ring-bg"/>
      ${part > 0 ? `<circle cx="59" cy="59" r="${r}" class="ph-ring-xp" stroke-dasharray="${(c * part).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 59 59)"/>` : ''}</svg>`;
  }
  /** Шапка профиля: цвет и узор самого редкого улучшенного подарка (без них — цвета сайта), уровень с кольцом XP,
   *  вокруг летают уникальные подарки. */
  function profHeroHtml(P, fly, info) {
    const u = fly.length ? fly[0].uniq : null;
    const pat = u ? Array.from({ length: 12 }, (_, k) => `<i class="ph-p p${k}">${esc(u.ch)}</i>`).join('') : '';
    const items = fly.map((g, k) => {
      const tip = `${g.t} #${g.uniq.n} · ${g.uniq.rar.t}`, pose = g.uniq.pose || 'stand';
      return `<button type="button" class="ph-fly f${k}" data-fly="${esc(tip)}" title="${esc(tip)}" aria-label="${esc(tip)}" style="--glow:${g.uniq.c1}">
        <span class="ug-ic gfx-${g.uniq.fx}"><i class="ugp-${pose}">${g.i}${pose === 'twin' ? g.i : ''}</i></span></button>`;
    }).join('');
    return `<div class="pf-hero${u ? '' : ' plain'}"${u ? ` style="--c1:${u.c1};--c2:${u.c2}"` : ''}>${pat}
      <div class="ph-stage">${xpRing(P.cur || 0, P.need || 0)}<span class="ph-ava"><b>${P.level}</b><small>уровень</small></span>${items}</div>
      <div class="ph-name">${info}</div></div>`;
  }
  /** Вкладка «Подарки»: оценка коллекции одной строкой и плитки — уникальные (сначала редкие), потом обычные. */
  function profGiftsHtml(P) {
    const list = P.gift_list || [];
    if (!list.length) return `<p class="fm-muted">Пока ни одного подарка${P.me && !TEACHER ? ' — <button type="button" class="link-btn" data-gift-to="">открыть магазин подарков</button>' : ''}.</p>`;
    const from = g => g.from === 'учитель' ? 'от учителя' : g.from === 'труд' ? 'за труд' : g.from === 'сам себе' ? 'купил себе' : g.from ? 'от ' + g.from : '';
    const tip = g => [g.t + (g.uniq ? ' #' + g.uniq.n : ''), gfRar(g) ? `${gfRar(g).t}: ${rarWhy(g)}` : '',
      g.uniq ? g.uniq.props.map(p => `${p.k}: ${p.t} (${String(p.p).replace('.', ',')}%)`).join(', ') : '', from(g)].filter(Boolean).join(' · ');
    const V = P.gift_value;
    const sorted = [...list.filter(g => g.uniq).sort(byRank), ...list.filter(g => !g.uniq)];
    return `${V && V.n ? `<div class="pf-value" title="Столько дадут, если продать все подарки сейчас; в магазине такие стоят ${V.shop.toLocaleString('ru-RU')} ₿">
        <span class="fm-muted">💎 Оценка коллекции</span><b>≈ ${V.sell.toLocaleString('ru-RU')} ₿</b></div>` : ''}
      <div class="pf-gifts">${sorted.map(g => `<div class="pf-gift${g.uniq ? ' uniq' : ''}" title="${esc(tip(g))}">${g.uniq ? uniqTile(g) : `<span class="ug plain r-${g.rar.k}"><span class="ug-ic">${g.i}</span></span>`}
        <small>${esc(g.t)}${g.uniq ? ' #' + g.uniq.n : ''}</small>${rarHtml(g)}</div>`).join('')}</div>
      ${P.me ? '<p class="fm-note">Улучшить подарок до уникального — в «Биткоины и подарки» (кнопка ₿ вверху): уникальные летают в шапке профиля.</p>' : ''}`;
  }
  async function saveBadges(keys) {
    try { await api('profile/badges', { keys }); } catch (e) { toast(e.message || 'Не получилось сохранить'); return; }
    await openProfile('me', profBack);
    loadRating();
  }
  document.addEventListener('click', e => {
    const pr = e.target.closest('[data-prof]');
    if (pr) { openProfile(pr.dataset.prof, pr.closest('.lb-wrap') ? 'rating' : null); return; }
    const fl = e.target.closest('[data-fly]');
    if (fl) { toast(fl.dataset.fly, 2500); return; }      // летающий подарок: на телефоне подсказки нет — название всплывает
    if (!PROF || !e.target.closest('#forecastBody')) return;
    const tb = e.target.closest('[data-ptab]');
    if (tb) { profTab = tb.dataset.ptab; profMore = false; renderProfile(); return; }
    if (e.target.closest('[data-pmore]')) { profMore = true; renderProfile(); return; }
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
      <p class="fm-note">${LB.spectator ? 'Ваши ученики' : 'Ученики твоего учителя'}. Лига — очки с понедельника; день, неделя, месяц — ТОП-10.</p>${boardsHtml(LB, tab || 'league')}`;
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
        return `<b>${esc(passer.name)}</b> обогнал тебя на ${gap} ${plural(gap, 'очко', 'очка', 'очков')} — до ${me.place - 1}-го места ${k} ${plural(k, 'задание', 'задания', 'заданий')}. Отыграйся!`;
      }
    }
    if (!me.value) {                                         // ещё без опыта на этой неделе
      const last = L.top.filter(r => r.value > 0 && !r.me).pop();
      if (!last) return 'В лиге на этой неделе ещё никто не набрал очков — реши задание и стань первым!';
      const k = tasks(last.value);
      return `Реши ${k} ${plural(k, 'задание', 'задания', 'заданий')} — и обгонишь ${esc(last.name)} (${last.place}-е место в лиге)`;
    }
    if (above) {
      const gap = above.value - me.value;
      return `До ${me.place - 1}-го места ${gap + 1} ${plural(gap + 1, 'очко', 'очка', 'очков')} — примерно ${tasks(gap)} ${plural(tasks(gap), 'задание', 'задания', 'заданий')}. Впереди — ${esc(above.name)}`;
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
    card.hidden = !(DAILY && DAILY.ready);
    if (card.hidden) return;
    $('#dailySub').textContent = DAILY.my_place ? `${DAILY.my_place}-е место` : DAILY.fast ? 'не засчитано' : DAILY.started ? 'уже заходили' : DAILY.count ? `решили ${DAILY.count}` : `№${DAILY.n}`;
    card.classList.toggle('done', !!DAILY.my_place);
  }
  function dailyHtml() {
    if (!DAILY || !DAILY.ready) return '';
    const rows = DAILY.top.map(r => `<tr class="${r.me ? 'me' : ''}"><td class="lb-place">${placeHtml(r.place)}</td><td>${esc(r.name)}${admTag(r.sid)}</td><td class="num">${fmtMs(r.ms)}</td></tr>`).join('');
    return `<p class="fm-note">Задание дня — №${DAILY.n}: <b>у каждого своё</b>, но одного типа и одной сложности.
        Место — по времени решения <b>с первой попытки</b> (время считает сервер с момента открытия задания). Самый быстрый завтра весь день носит 👑.${DAILY.crown ? ` Сегодня корона у <b>${esc(DAILY.crown)}</b>.` : ''}</p>
      ${DAILY.my_place ? `<p class="lb-mine">Ты решил за <b>${fmtMs(DAILY.mine)}</b> — ${DAILY.my_place}-е место из ${DAILY.count}.</p>`
        : DAILY.fast ? `<p class="daily-used">⚠ Решено за ${fmtMs(DAILY.mine)} — так быстро задание не прочитать, ответ был известен заранее. Результат в рейтинг не засчитан.</p>`
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
  async function goDaily() {
    if (!DAILY || !DAILY.ready) return;
    closeForecast();
    if (dailyNow()) return;
    if (DAILY.started && !DAILY.my_place) { toast('Вы уже заходили выполнять задание дня сегодня — войти второй раз нельзя. Новое задание будет завтра.', 5000); return; }
    if (!leaveExam()) return;
    // какое задание — сервер скажет только сейчас: у каждого своё, время пошло
    let r;
    try { r = await api('daily/start', {}); } catch (e) { netError(e); return; }
    const t = byId.get(r.task);
    if (!t) { toast('Задание дня не найдено — обновите страницу'); return; }
    DAILY.task = r.task;
    DAILY.started = r.started;
    show({ task: t, why: { type: 'daily' } });
    renderDailyCard();
  }

  // ═══════ src/app/11-tours-duels.js
  // ------------------------------------------------------------ турниры
  /* Как в футболе: набор на 4, 8 или 12 игроков (каждого вида — один турнир в сутки) → жеребьёвка по корзинам →
     группы по 4, каждый с каждым (победа 3 очка, ничья 1, «счёт» — решённые задания) → плей-офф и матч за 3-е место. */
  let TOUR = null, DUELS = null, LIVE_SIG = '';
  async function loadDuels(quiet) {
    if (!SERVER || !student || TEACHER) return;
    const prevT = TOUR, prevD = DUELS;
    let T2, D2;
    try { [T2, D2] = await Promise.all([api('tour'), api('duels').catch(() => null)]); } catch (e) { return; }
    // ничего не поменялось — не перерисовываем (не сбиваем раскрытые списки и прокрутку)
    const sig = JSON.stringify([T2, D2 && { ...D2, seekers: 0 }]);
    if (quiet && sig === LIVE_SIG) return;
    LIVE_SIG = sig;
    TOUR = T2; DUELS = D2;
    if (prevT || prevD) liveNews(prevT, prevD);
    // начатые матчи и дуэли решаются как подборка: задания по порядку
    ASG = ASG.filter(a => !a.duel);
    for (const m of tourMyMatches()) {
      if (m.status !== 'play' || !m.tasks || m.done) continue;
      const op = m.mine === 'a' ? m.b : m.a;
      ASG.push({ id: 'tm-' + m.id, duel: 'tm' + m.id, tour: m.id, title: `${m.stage}: матч с ${op ? op.name : '?'}`, tasks: m.tasks, done: [], created: m.since,
        ends: m.cap && m.since ? m.since + m.cap : null });
    }
    for (const d of (DUELS && DUELS.duels) || []) {
      if (d.status !== 'active' || !d.tasks || d.done) continue;
      ASG.push({ id: 'du-' + d.id, duel: 'du' + d.id, duelId: d.id, title: `Дуэль с ${d.opponent}`, tasks: d.tasks, done: [], created: d.since,
        ends: d.cap ? d.since + d.cap : null });
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
    const call = duelCalls().length;
    $('#duelSub').textContent = !TOUR ? 'наборы открыты' : m ? 'твой матч!' : call ? 'тебя вызвали на дуэль!' : T && T.status === 'run' ? 'ждём соперников'
      : lob ? `набор ${lob.players.length}/${lob.size}` : 'наборы открыты';
    card.classList.toggle('alert', !!m || !!call);
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
        <td>${esc(r.name)}${r.me ? ' (ты)' : ''}${admTag(r.sid)}${(T.gone || []).includes(r.sid) ? ' <small class="fm-muted">не явился</small>' : ''}</td><td>${r.g}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.sf}–${r.sa}</td><td><b>${r.pts}</b></td></tr>`).join('')}
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
        const res = !m.winner ? (m.tech ? 'тех. поражение' : 'ничья') : m.winner === student.sid ? (m.surrender ? 'победа — соперник сдался' : 'победа')
          : (m.surrender === student.sid ? 'поражение — ты сдался' : 'поражение');
        st = `<b class="tm-res ${!m.winner ? (m.tech ? 'l' : 'd') : m.winner === student.sid ? 'w' : 'l'}">${res} ${my}:${his}</b>${m.tech ? ' <small>(кто-то не сыграл)</small>' : ''}`;
      } else if (m.done) st = 'ты сыграл — ждём соперника';
      else {
        st = `осталось ${tourLeft(m.ends)}`;
        btn = `<button type="button" class="btn primary" data-tour-go="${m.id}">${m.started ? 'Продолжить' : 'Играть'}</button>
          ${m.started ? `<button type="button" class="btn ghost" data-tour-fin="${m.id}">Закончить</button>` : ''}
          <button type="button" class="link-btn surrender-btn" data-tour-sur="${m.id}">🏳 Сдаться</button>`;
      }
      return `<div class="tm-row${m.status === 'play' && !m.done ? ' live' : ''}"><div><span class="ap-kind">${m.stage}</span>
        <b>ты — ${esc(op ? op.name : '?')}</b> <small class="fm-muted">${op ? `ур. ${op.level}` : ''}</small><div class="fm-muted">${st}</div></div>
        <div class="tm-btns">${btn}</div></div>`;
    }).join('');
    return `<h3 class="ap-h">Мои матчи</h3><p class="fm-muted">Матч — по ${TOUR.tasks} заданий тебе и сопернику (разные, но одного типа и сложности), время идёт с нажатия «Играть». Все играют одновременно: начинай матчи сразу, один за другим, — на весь этап времени ровно столько, сколько длятся матчи.</p>
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
      const btn = !l.id ? `<span class="fm-muted">Сегодня сыграно ${l.per_day} — новые наборы откроются завтра</span>`
        : l.me_in ? `<button type="button" class="btn" data-tour-leave="${l.id}">Выйти из набора</button>`
          : D.busy ? '<span class="fm-muted">ты уже в другом турнире</span>'
            : `<button type="button" class="btn primary" data-tour-join="${l.id}">Записаться</button>`;
      return `<div class="ap-card tl-card${l.me_in ? ' going' : ''}${l.id ? '' : ' done'}">
        <div class="ap-top"><span class="ap-ico">${l.icon || { 4: '⚡', 8: '🏆', 12: '🌍' }[l.size]}</span><div><span class="ap-kind">${l.size} игроков · ${l.about ? esc(l.about) : TOUR_FMT[l.size]}</span>
          <b>${esc(l.title || l.name)}</b><small>${l.id ? `набрано ${n} из ${l.size}${n < l.size ? ` — ещё ${l.size - n} и старт!` : ''}` : `${l.per_day} турнира в сутки`} · сегодня ${l.today} из ${l.per_day} · призы ${prizes} XP</small></div></div>
        ${l.id ? `<i class="xp-bar"><b style="width:${pct(n / l.size)}%"></b></i>
        <div class="tl-seats">${Array.from({ length: l.size }, (_, i) => l.players[i]
          ? `<span class="tl-seat on${isMe(l.players[i]) ? ' me' : ''}" title="ур. ${l.players[i].level}">${esc(l.players[i].name)}</span>`
          : '<span class="tl-seat">свободно</span>').join('')}</div>` : ''}
        ${l.fixed_nums ? `<div class="tour-nums">Задания: ${l.fixed_nums.map(n => `<b class="chip">№${n}</b>`).join(' ')}${l.cap_min ? ` <span class="chip accent">⏱ ${l.cap_min} мин на матч</span>` : ''}</div>`
          : l.id && (l.me_in || Object.keys(l.votes || {}).length) ? tourVotes(l) : ''}
        <div class="ap-btns">${btn}</div></div>`;
    };
    trainerEl.innerHTML = `<div class="course asg-page tour-page">
      <div class="tour-top">${eloHtml()}${seasonHtml()}</div>
      <div class="tour-about-bar"><button type="button" class="btn ghost" id="tourAbout" aria-expanded="${TOUR_ABOUT}">ℹ️ О турнире</button>
        <span class="fm-muted">🏆 ${D.wins} ${plural(D.wins, 'победа', 'победы', 'побед')} в турнирах</span></div>
      <div class="crs-hero tour-about"${TOUR_ABOUT ? '' : ' hidden'}><div><div class="crs-kicker">Турниры</div><h2>Как в футболе</h2>
        <p>Запишись в набор — как только наберутся все, турнир <b>начнётся сам</b>. Жеребьёвка по корзинам (по опыту) → <b>группы по 4</b>: каждый с каждым,
          победа — 3 очка, ничья — 1, «счёт» матча — сколько заданий решил каждый. Лучшие выходят в <b>плей-офф</b>: там при равном счёте проходит тот, кто решил быстрее, — как серия пенальти.
          Финал и матч за 3-е место. <b>Номера заданий выбирают участники голосованием</b> в наборе, а сложность растёт от этапа к этапу: в группах — попроще, в финале — самые трудные.
          <b>Все играют одновременно</b>: групповой этап — три матча подряд (время трёх матчей + ${D.buffer_min} минут), каждый раунд плей-офф — один матч
          (+ ${D.buffer_min} минут); следующий этап начинается сразу. Время на матч — №1–23 по 10 минут на задание, №24–27 по 30. Не сыграл — техническое поражение.</p>
        <p>Турнир начинается, как только набрались все: <b>в течение ${Math.round(D.noshow_sec / 60)} минут начни любой матч</b>, иначе засчитается поражение во всех матчах группы.</p>
        <p>Каждого вида — <b>до 3 турниров в сутки</b>. Чемпион получает награду <b>🎖 Победитель турнира</b> в профиль.</p>
        <p>Тематические: <b>🐍 Кубок по Python</b> (№24–27) и <b>⏱ Спринт</b> (№1–5, на матч — 15 минут).</p>
        <p><b>Сезон</b> — календарный месяц: за места в турнирах начисляются очки (чем больше турнир, тем дороже), за участие — 1.
          Тройка лучших сезона получает значок 🏅 / 🥈 / 🥉 в профиль.</p>
        <p><b>Рейтинг Эло</b> — сила в дуэлях: все начинают с 1000, за победу над сильным соперником очков больше, за проигрыш слабому — больше теряешь.
          «Найти соперника» подбирает того, у кого рейтинг ближе.</p>
        <p>Соперники в матче и дуэли получают <b>разные задания одного типа и сложности</b> — подсмотреть ответ у соседа не выйдет.</p></div></div>
      ${T ? `<h3 class="ap-h tour-h">${esc(T.title)} ${T.status === 'run' ? `<span class="chip accent" title="За это время нужно сыграть все матчи этапа; не сыгранные к сроку — техническое поражение">${esc(T.stage.toLowerCase())}: сыграть матчи — ещё ${tourLeft(T.round_ends)}</span>` : '<span class="chip good">завершён</span>'}
          ${T.match_min ? `<span class="chip" title="Время на один матч с нажатия «Играть»">⏱ на один матч — ${T.match_min} мин</span>` : ''}</h3>
        ${tourNoshowHtml(T)}
        ${tourNumsHtml(T)}
        ${T.status === 'done' ? tourPodium(T) : ''}
        ${T.status === 'run' ? tourMyList(T) : ''}
        <h3 class="ap-h">Групповой этап</h3>${tourGroups(T)}
        <h3 class="ap-h">Плей-офф</h3>${tourBracket(T)}` : ''}
      ${duelsHtml()}
      <h3 class="ap-h">Наборы</h3><div class="ap-grid tl-grid">${D.lobbies.map(lobby).join('')}</div>
      ${D.done.length ? `<h3 class="ap-h">История турниров</h3><div class="td-list">${D.done.map(t => `<details class="td-row" data-k="h${t.id}"${TOUR_OPEN.has('h' + t.id) ? ' open' : ''}>
        <summary><b>${esc(t.title)}</b> <small class="fm-muted">${t.finished ? apDay(t.finished) : ''}${t.my_place ? ` · ты — ${t.my_place}-е место` : ''}</small>${tourPodium(t)}</summary>
        <ol class="td-places">${(t.places || []).map(p => `<li class="${isMe(p) ? 'me' : ''}">${p.place ? `${MEDAL[p.place] || p.place + '.'}` : '—'} ${esc(p.name)}${p.gone ? ' <small class="fm-muted">не явился</small>' : ''}${p.xp ? ` <small>+${p.xp} XP</small>` : ''}</li>`).join('')}</ol>
        </details>`).join('')}</div>` : ''}
    </div>`;
  }
  let TOUR_ABOUT = false;
  const TOUR_OPEN = new Set();             // раскрытые строки истории — переживают автообновление
  trainerEl.addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches && d.matches('details[data-k]')) { if (d.open) TOUR_OPEN.add(d.dataset.k); else TOUR_OPEN.delete(d.dataset.k); }
  }, true);
  function eloHtml() {
    const E = TOUR.elo, me = E && E.me;
    if (!E) return '';
    const rows = E.top.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${r.place}</td><td>${esc(r.name)}${admTag(r.sid)}</td><td class="num"><b>${r.elo}</b></td><td class="num fm-muted">${r.games}</td></tr>`).join('');
    const mine = me && !E.top.some(r => r.me) ? `<tr class="me"><td>${me.place || '—'}</td><td>ты</td><td class="num"><b>${me.elo}</b></td><td class="num fm-muted">${me.games}</td></tr>` : '';
    return `<div class="tt-box"><div class="tt-h">⚔️ Рейтинг Эло <small class="fm-muted">дуэли</small></div>
      ${rows || mine ? `<table class="lb tt-tab"><tr><th></th><th>Игрок</th><th class="num">Эло</th><th class="num">Дуэлей</th></tr>${rows}${mine}</table>`
        : '<p class="fm-muted">Пока никто не сыграл дуэль — начни первым!</p>'}</div>`;
  }
  function seasonHtml() {
    const S = TOUR.season;
    if (!S) return '';
    const rows = S.top.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${MEDAL[r.place] || r.place}</td><td>${esc(r.name)}${admTag(r.sid)}</td><td class="num"><b>${r.pts}</b></td><td class="num fm-muted">${r.tours}</td></tr>`).join('');
    const mine = S.me && !S.top.some(r => r.me) ? `<tr class="me"><td>${S.me.place}</td><td>ты</td><td class="num"><b>${S.me.pts}</b></td><td class="num fm-muted">${S.me.tours}</td></tr>` : '';
    return `<div class="tt-box"><div class="tt-h">🏅 Сезон: ${esc(S.name)} <small class="fm-muted">осталось ${tourLeft(S.ends)}</small></div>
      ${rows ? `<table class="lb tt-tab"><tr><th></th><th>Игрок</th><th class="num">Очки</th><th class="num">Турниров</th></tr>${rows}${mine}</table>`
        : '<p class="fm-muted">В этом месяце турниров ещё не было. Тройка лучших сезона получит значок в профиль.</p>'}</div>`;
  }
  const TOUR_RANK_WORD = { 1: 'очень лёгкие', 2: 'лёгкие', 3: 'средние', 4: 'сложные', 5: 'очень сложные' };
  /** Голосование в наборе: каждый записавшийся выбирает до vote_max номеров; самые популярные будут в турнире. */
  function tourVotes(l) {
    const D = TOUR, votes = l.votes || {}, my = new Set(l.my_votes || []);
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1]).slice(0, D.tasks).map(([n]) => +n);
    const chips = D.vote_nums.map(n => {
      const c = votes[n] || 0;
      return `<button type="button" class="tv-n${my.has(n) ? ' on' : ''}${top.includes(n) ? ' top' : ''}"${l.me_in ? ` data-tour-vote="${l.id}:${n}"` : ' disabled'}
        title="№${n}${c ? ` — голосов: ${c}` : ''}">${n}${c ? `<small>${c}</small>` : ''}</button>`;
    }).join('');
    return `<div class="tv"><div class="tv-h">🗳 Голосование за задания${l.me_in ? ` — выбери до ${D.vote_max} номеров (${my.size}/${D.vote_max})` : ' — голосуют записавшиеся'}</div>
      <div class="tv-list">${chips}</div><small class="fm-muted">В турнир попадут ${D.tasks} самых популярных номеров; не хватит голосов — добавим случайные.</small></div>`;
  }
  /** Первые минуты турнира: кто не начал ни одного матча — сдаётся автоматически. */
  function tourNoshowHtml(T) {
    if (T.status !== 'run' || T.round !== 1 || !T.started) return '';
    const left = Math.round(T.started + TOUR.noshow_sec - Date.now() / 1000);
    if (left <= 0 || tourMyMatches().some(m => m.started)) return '';
    return `<div class="sum-note hot tour-noshow">⏱ Турнир начался! Начни любой матч в течение <b id="tnsLeft">${Math.floor(left / 60)}:${pad2(left % 60)}</b> — иначе засчитается поражение во всех матчах группы.</div>`;
  }
  setInterval(() => {
    const el = $('#tnsLeft'), T = TOUR && TOUR.mine;
    if (!el || !T) return;
    const left = Math.max(0, Math.round(T.started + TOUR.noshow_sec - Date.now() / 1000));
    el.textContent = `${Math.floor(left / 60)}:${pad2(left % 60)}`;
  }, 1000);
  // живое обновление дуэлей и турниров на любой странице. Есть живое соединение (13-live.js) — сервер сам скажет,
  // что поменялось, а опрос раз в 2 минуты — только страховка. Нет — на странице турниров и во время матча каждые 10 с,
  // иначе раз в 30 с; вкладка в фоне — не спрашиваем, вернулся на неё — сразу обновляем
  let liveAt = 0;
  function livePoll(force) {
    if (!SERVER || !student || TEACHER || document.hidden || DSEARCH.on) return;
    const a = ui.scope === 'asg' && asgOf(ui.asg);
    const hot = (courseShown && pageKind === 'tour') || (a && a.duel);
    if (!force && Date.now() - liveAt < (liveOn() ? 120000 : hot ? 10000 : 30000)) return;
    liveAt = Date.now();
    loadDuels(true);
  }
  setInterval(livePoll, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) livePoll(true); });
  window.addEventListener('focus', () => livePoll(true));
  /** Что изменилось с прошлого раза — сказать ученику, где бы он ни был. */
  function liveNews(pT, pD) {
    const me = student && student.sid;
    const oldD = new Map(((pD && pD.duels) || []).map(d => [d.id, d]));
    for (const d of (DUELS && DUELS.duels) || []) {
      const o = oldD.get(d.id);
      if (!o && d.status === 'pending' && !d.mine) toast(`${d.rematch ? '🔁 Реванш' : '⚔️ Вызов'}: ${d.opponent} зовёт на дуэль — ответь на странице турниров`, 6000);
      if (o && o.status === 'pending' && d.status === 'active' && d.mine) toast(`⚔️ ${d.opponent} принял вызов — жми «Играть»!`, 5000);
      if (o && o.status === 'active' && d.status === 'finished') {
        const w = { win: 'победа', lose: 'поражение', draw: 'ничья' }[d.result] || d.result;
        toast(`⚔️ Дуэль с ${d.opponent}: ${w}${d.surrender === 'op' ? ' — соперник сдался' : ''} ${d.my_solved}:${d.op_solved}${d.elo != null ? ` (${d.elo >= 0 ? '+' : '−'}${Math.abs(d.elo)} Эло)` : ''}`, 6000);
      }
      if (o && !o.op_done && d.op_done && d.status === 'active' && !d.done) toast(`⚔️ ${d.opponent} уже закончил дуэль — твоя очередь!`, 4000);
    }
    const a = pT && pT.mine, b = TOUR && TOUR.mine;
    const wasIn = pT && pT.lobbies.some(l => l.me_in);
    if (b && b.status === 'run' && (!a || a.id !== b.id) && wasIn) toast('🏆 Набор заполнен — турнир начался! За 3 минуты начни любой матч.', 7000);
    else if (a && b && a.id === b.id) {
      if (a.status === 'run' && b.status === 'done') {
        const pl = (b.podium || []).find(p => p.sid === me);
        toast(`🏆 ${b.title} завершён${pl ? ` — ты ${pl.place}-й${pl.xp ? `, +${pl.xp} XP` : ''}` : ''}`, 7000);
      } else if (a.round !== b.round && b.status === 'run') toast(`🏆 ${b.title}: новый этап — ${b.stage}`, 5000);
      const mm = ms => new Map(tourMatchesOf(ms).map(m => [m.id, m]));
      const om = mm(a);
      for (const m of tourMatchesOf(b)) {
        const o = om.get(m.id);
        if (m.mine && o && o.status === 'play' && m.status === 'done') {
          const my = m.mine === 'a' ? m.a_solved : m.b_solved, his = m.mine === 'a' ? m.b_solved : m.a_solved;
          toast(`🏆 Матч: ${!m.winner ? 'ничья' : m.winner === me ? 'победа' : 'поражение'} ${my}:${his}`, 5000);
        }
      }
    }
    // новые наборы и места: рядом с иконкой турниров
    renderDuelCard();
  }
  // новая версия сайта: раз в 2 минуты сверяем app.js и style.css с тем, что загружено; поменялись — предлагаем обновить
  const VER = { tags: null, shown: false };
  async function siteTags() {
    try {
      const rs = await Promise.all(['app.js', 'style.css', 'changelog.js'].map(f => fetch(f, { method: 'HEAD', cache: 'no-store' })));
      return rs.map(r => r.headers.get('ETag') || r.headers.get('Last-Modified') || '').join('|');
    } catch (e) { return null; }
  }
  async function checkVersion() {
    if (VER.shown || (document.hidden && VER.tags !== null)) return;
    const t = await siteTags();
    if (!t) return;
    if (VER.tags === null) { VER.tags = t; return; }
    if (t === VER.tags) return;
    VER.shown = true;
    const bar = document.createElement('div');
    bar.className = 'ver-bar';
    bar.innerHTML = '✨ Вышла новая версия сайта <button type="button" class="btn primary">Обновить</button>';
    bar.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(bar);
  }
  checkVersion();
  setInterval(checkVersion, 120000);
  /** Все матчи турнира списком (группы, плей-офф, за 3-е место). */
  function tourMatchesOf(T) {
    if (!T || !T.groups) return [];
    return [...T.groups.flatMap(g => g.matches), ...T.playoff.flatMap(r => r.matches), ...(T.third ? [T.third] : [])];
  }
  function tourNumsHtml(T) {
    if (!T.nums) return '';
    const names = ['Группы', ...T.playoff.map(r => r.name)];
    return `<p class="tour-nums">Задания турнира: ${T.nums.map(n => `<b class="chip">№${n}</b>`).join(' ')}</p>
      ${T.cap_min ? '' : `<p class="fm-muted tour-ranks">Время на матч — с нажатия «Играть»: №1–23 по 10 минут на задание, №24–27 по 30. Решённое позже не засчитается.</p>`}
      <p class="fm-muted tour-ranks">Сложность по этапам: ${T.ranks.map((r, i) => `${esc(names[i] || '')} — ${TOUR_RANK_WORD[r]}`).join(' → ')}</p>`;
  }
  /** Входящие вызовы на дуэль, которые ждут ответа. */
  const duelCalls = () => ((DUELS && DUELS.duels) || []).filter(d => d.status === 'pending' && !d.mine);
  function duelsHtml() {
    const D = DUELS;
    if (!D) return '';
    const RES = { win: ['w', 'победа'], lose: ['l', 'поражение'], draw: ['d', 'ничья'] };
    const rows = D.duels.map(d => {
      let st, btn = '';
      if (d.status === 'pending') {
        st = d.mine ? (d.rematch ? 'реванш: ждём ответа соперника' : 'ждём ответа соперника') : d.rematch ? '🔁 тебя зовут на реванш!' : '⚔️ тебя вызвали!';
        if (!d.mine) btn = `<button type="button" class="btn primary" data-duel-accept="${d.id}">Принять</button><button type="button" class="btn ghost" data-duel-decline="${d.id}">Отказаться</button>`;
      } else if (d.status === 'active') {
        st = d.done ? (d.op_done ? 'подводим итог…' : 'ты сыграл — ждём соперника') : `осталось ${tourLeft(d.ends)}`;
        if (!d.done) btn = `<button type="button" class="btn primary" data-duel-go="${d.id}">${d.started ? 'Продолжить' : 'Играть'}</button>
          ${d.started ? `<button type="button" class="btn ghost" data-duel-fin="${d.id}">Закончить</button>` : ''}
          <button type="button" class="link-btn surrender-btn" data-duel-sur="${d.id}">🏳 Сдаться</button>`;
      } else if (d.status === 'finished') {
        const [c, w0] = RES[d.result] || ['d', d.result];
        const w = d.surrender === 'me' ? `${w0} — ты сдался` : d.surrender === 'op' ? `${w0} — соперник сдался` : w0;
        st = `<b class="tm-res ${c}">${w} ${d.my_solved}:${d.op_solved}</b>${d.stake && d.result === 'win' ? ` <small>+${d.stake} XP</small>` : ''}`
          + (d.elo != null ? ` <small class="elo-d ${d.elo >= 0 ? 'up' : 'down'}">${d.elo >= 0 ? '+' : '−'}${Math.abs(d.elo)} Эло</small>` : '')
          + (d.bonus ? ` <small>🔥 +${d.bonus} XP за серию</small>` : '');
        if (d.can_rematch) btn = `<button type="button" class="btn ghost" data-duel-rematch="${d.id}">🔁 Реванш</button>`;
      } else st = d.status === 'declined' ? 'вызов отклонён' : d.status === 'void' ? 'отменена учителем' : 'вызов не принят вовремя';
      return `<div class="tm-row${d.status === 'active' && !d.done || (d.status === 'pending' && !d.mine) ? ' live' : ''}"><div><span class="ap-kind">Дуэль</span>
        <b>ты — ${esc(d.opponent)}</b><div class="fm-muted">${st}</div></div><div class="tm-btns">${btn}</div></div>`;
    }).join('');
    const search = DSEARCH.on
      ? `<div class="dq on"><div class="dq-spin" aria-hidden="true">⚔️</div><div><b>Ищем соперника… <span id="dqTime">${dqTime()}</span></b>
          <div class="fm-muted">${DSEARCH.seekers ? `Сейчас ищут ещё ${DSEARCH.seekers}` : 'Как только кто-то из класса тоже нажмёт «Найти», дуэль начнётся'}. Не закрывай страницу.</div></div>
          <button type="button" class="btn ghost" id="dqCancel">Отмена</button></div>`
      : D.today >= D.per_day ? `<div class="dq"><b>Сегодня сыграно ${D.today} дуэлей — это максимум.</b><div class="fm-muted">Новые дуэли — завтра.</div></div>`
      : `<div class="dq"><button type="button" class="btn primary dq-go" id="dqFind"${duelNums().length < D.min_nums ? ' disabled' : ''}>🔍 Найти соперника</button>
          <div class="fm-muted">Подберём того, кто тоже ищет дуэль прямо сейчас, — с рейтингом Эло поближе к твоему.${D.seekers ? ` <b>Сейчас ищут: ${D.seekers}</b>` : ''}</div>
          ${duelNumsHtml(D)}</div>`;
    const tab = (D.tournament && D.tournament.table || []).filter(r => r.games);
    return `<h3 class="ap-h" id="duelsH">⚔️ Дуэли</h3>
      <div class="duel-me"><span class="chip accent">Твой Эло: <b>${D.my_elo}</b></span>${D.streak >= 2 ? `<span class="chip hot">🔥 ${D.streak} ${plural(D.streak, 'победа', 'победы', 'побед')} подряд</span>` : ''}
        <small class="fm-muted">Эло меняется после каждой дуэли. Отдельно: 3 победы подряд и больше — бонус опыта (XP) 🔥</small></div>
      <p class="fm-muted">Нажми «Найти соперника» — подберём одноклассника с близким рейтингом, который тоже ищет дуэль. По ${D.tasks} заданий каждому (разные, но одного типа и сложности). Время с нажатия «Играть»: <b>№1–23 — 10 минут</b> на задание, <b>№24–27 — 30 минут</b>; начать дуэль нужно в течение ${D.hours} ч. Больше решил — победа, поровну — быстрее.
        Победителю — <b>+${D.stake} XP</b> за первые ${D.full_per_day} победы за день, дальше — +${D.stake_late} XP (проигравший ничего не теряет;
        если соперник сдался, а ты не решил ни одного задания — победа без опыта). С одним соперником — одна дуэль в неделю, всего — до ${D.per_day} в день (сегодня ${D.today}).</p>
      ${search}
      ${rows ? `<div class="tm-list">${rows}</div>` : ''}
      ${tab.length ? `<h4 class="dm-h">Таблица дуэлей недели</h4><table class="lb dm-tab"><tr><th></th><th>Игрок</th><th>И</th><th>В</th><th>Н</th><th>П</th><th>О</th></tr>
        ${tab.map(r => `<tr class="${r.me ? 'me' : ''}"><td>${r.place}</td><td>${esc(r.name)}</td><td>${r.games}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td><b>${r.pts}</b></td></tr>`).join('')}</table>` : ''}
`;
  }
  // таймер дуэли (и матча спринта): сколько осталось; вышло — дуэль заканчивается сама
  const duelLeftText = ends => { const sec = Math.max(0, Math.round(ends - Date.now() / 1000)); return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`; };
  let duelTimeUp = null;
  setInterval(async () => {
    const a = ui.scope === 'asg' && asgOf(ui.asg);
    if (!a || !a.ends) return;
    const el = $('#duelTimer');
    const left = a.ends - Date.now() / 1000;
    if (el) { el.textContent = '⏱ ' + duelLeftText(a.ends); el.classList.toggle('weak', left < 60); }
    if (left > 0 || duelTimeUp === a.id) return;
    duelTimeUp = a.id;
    if (a.duelId) { try { await api('duel/finish', { id: a.duelId }); } catch (e) { /* итог подведёт сервер */ } }
    else if (a.tour) await finishTourMatch(a.tour);
    toast('⏱ Время вышло — засчитаны задания, решённые вовремя. Итог — когда закончит соперник.', 5000);
    ui.scope = 'all';
    await loadDuels();
    tourOpen();
  }, 1000);
  // номера заданий для дуэли: по умолчанию все; снятые запоминаются в браузере
  const duelNumsKey = () => `egeTrainer.duelNums.${student ? student.sid : ''}`;
  function duelNums() {
    const all = (DUELS && DUELS.duel_nums) || [];
    let off = [];
    try { off = JSON.parse(localStorage.getItem(duelNumsKey()) || '[]'); } catch (e) { off = []; }
    return all.filter(n => !off.includes(n));
  }
  function duelNumsHtml(D) {
    const on = new Set(duelNums());
    return `<div class="dq-nums"><div class="dq-nums-h">Номера заданий: <b>${on.size}</b> из ${D.duel_nums.length}
        <small class="fm-muted">— сними те, по которым не хочешь соревноваться (нужно хотя бы ${D.min_nums})</small>
        <button type="button" class="link-btn" id="dqAll">${on.size === D.duel_nums.length ? '' : 'выбрать все'}</button></div>
      <div class="tv-list">${D.duel_nums.map(n => `<button type="button" class="tv-n${on.has(n) ? ' on' : ''}" data-dn="${n}" aria-pressed="${on.has(n)}">${n}</button>`).join('')}</div>
      <small class="fm-muted">Соперник подберётся среди тех, у кого хотя бы ${D.min_nums} номера совпадают с твоими; дуэль пройдёт только по общим номерам.</small></div>`;
  }
  function duelNumToggle(n) {
    const all = DUELS.duel_nums;
    const on = new Set(duelNums());
    if (on.has(n)) on.delete(n); else on.add(n);
    try { localStorage.setItem(duelNumsKey(), JSON.stringify(all.filter(x => !on.has(x)))); } catch (e) { /* нет места */ }
    if (on.size < DUELS.min_nums) toast(`Выбери хотя бы ${DUELS.min_nums} номера`, 2500);
    renderTourPage();
  }
  // подбор соперника: пока ищем, раз в 3 с спрашиваем сервер (это и «я ещё здесь»)
  const DSEARCH = { on: false, since: 0, seekers: 0, timer: null };
  const dqTime = () => { const sec = Math.max(0, Math.round(Date.now() / 1000 - DSEARCH.since)); return `${Math.floor(sec / 60)}:${pad2(sec % 60)}`; };
  async function duelFind() {
    let r;
    try { r = await api('duel/find', { nums: duelNums() }); } catch (e) { duelSearchStop(); toast(e.message || 'Не получилось', 3500); return; }
    if (r.matched) {
      duelSearchStop();
      toast('⚔️ Соперник найден — дуэль началась!', 4000);
      if (courseShown && pageKind === 'tour') return startDuel(r.matched);
      await loadDuels();
      return;
    }
    const first = !DSEARCH.on;
    Object.assign(DSEARCH, { on: true, since: r.since, seekers: r.seekers });
    clearTimeout(DSEARCH.timer);
    DSEARCH.timer = setTimeout(duelFind, liveOn() ? 15000 : 3000);   // есть живое соединение — о сопернике скажет сервер
    if (first) renderTourPage();
    else {
      const t = $('#dqTime');
      if (t) t.textContent = dqTime();
    }
  }
  function duelSearchStop() {
    clearTimeout(DSEARCH.timer);
    DSEARCH.on = false;
    renderTourPage();
  }
  setInterval(() => { const t = $('#dqTime'); if (t && DSEARCH.on) t.textContent = dqTime(); }, 1000);
  async function startDuel(id) {
    try { await api('duel/start', { id }); } catch (e) { toast(e.message, 3000); return; }
    await loadDuels();
    leaveCourse();
    setScope('asg', 'du-' + id);
  }
  function tourPodium(T) {
    return `<div class="tpod">${(T.podium || []).map(p => `<span class="tpod-i p${p.place}${isMe(p) ? ' me' : ''}">${MEDAL[p.place] || `${p.place}.`} ${esc(p.name)}${admTag(p.sid)}${p.xp ? ` <small>+${p.xp} XP</small>` : ''}</span>`).join('')}</div>`;
  }
  async function tourAction(path, body, msg) {
    let d;
    try { d = await api(path, body); } catch (e) { toast(e.message || 'Не получилось', 3000); return; }
    if (d && d.started) toast('Набор заполнен — турнир начался! Начни матч в течение 3 минут.', 5000);
    else if (msg) toast(msg, 2500);
    await loadDuels();
  }
  async function startTourMatch(id) {
    let r;
    try { r = await api('tour/start', { match: id }); } catch (e) { toast(e.message, 3000); return; }
    if (r && r.cap) toast(`⏱ На матч ${Math.round(r.cap / 60)} минут — таймер вверху, решённое позже не засчитается`, 5000);
    await loadDuels();
    leaveCourse();
    setScope('asg', 'tm-' + id);
  }
  async function finishTourMatch(id) {
    try { await api('tour/finish', { match: id }); } catch (e) { return false; }
    return true;
  }
  /** Сдаться: матч или дуэль сразу проиграны, сопернику — победа. */
  async function surrender(kind, id) {
    if (!confirm(kind === 'duel' ? 'Сдаться? Дуэль будет проиграна сразу, сопернику засчитается победа.'
      : 'Сдаться? Матч будет проигран сразу, сопернику засчитается победа.')) return;
    try { await api(kind === 'duel' ? 'duel/surrender' : 'tour/surrender', kind === 'duel' ? { id } : { match: id }); }
    catch (e) { toast(e.message || 'Не получилось', 3000); return; }
    toast('🏳 Ты сдался — победа засчитана сопернику', 3500);
    if (ui.scope === 'asg') ui.scope = 'all';
    await loadDuels();
    tourOpen();
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('#surrenderBtn')) return;
    const a = ui.scope === 'asg' && asgOf(ui.asg);
    if (a && a.duelId) surrender('duel', a.duelId);
    else if (a && a.tour) surrender('tour', a.tour);
  });
  /** Решил последнее задание матча — сообщаем серверу, итог — когда закончит и соперник. */
  async function checkDuelDone() {
    const a = ui.scope === 'asg' && asgOf(ui.asg);
    if (a && a.duelId && !asgLeft(a).length) {
      try { await api('duel/finish', { id: a.duelId }); } catch (e) { return; }
      toast('Дуэль сыграна! Итог — когда закончит соперник.', 4000);
      ui.scope = 'all';
      await loadDuels();
      return tourOpen();
    }
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
    if (t.closest('#tourAbout')) {
      TOUR_ABOUT = !TOUR_ABOUT;
      $('.tour-about').hidden = !TOUR_ABOUT;
      t.closest('#tourAbout').setAttribute('aria-expanded', TOUR_ABOUT);
      return;
    }
    const rm = t.closest('[data-duel-rematch]');
    if (rm) return tourAction('duel/rematch', { id: +rm.dataset.duelRematch }, 'Вызов на реванш отправлен! Ждём ответа соперника.');
    const v = t.closest('[data-tour-vote]');
    if (v) {
      const [id, n] = v.dataset.tourVote.split(':').map(Number);
      const l = TOUR.lobbies.find(x => x.id === id);
      const my = new Set(l.my_votes || []);
      if (my.has(n)) my.delete(n);
      else if (my.size >= TOUR.vote_max) { toast(`Можно выбрать не больше ${TOUR.vote_max} номеров — сначала сними один`, 3000); return; }
      else my.add(n);
      return tourAction('tour/vote', { id, nums: [...my] });
    }
    const ts = t.closest('[data-tour-sur]'), ds = t.closest('[data-duel-sur]');
    if (ts) return surrender('tour', +ts.dataset.tourSur);
    if (ds) return surrender('duel', +ds.dataset.duelSur);
    const da = t.closest('[data-duel-accept]'), dd = t.closest('[data-duel-decline]');
    const dg = t.closest('[data-duel-go]'), df = t.closest('[data-duel-fin]');
    if (t.closest('#dqFind')) return duelFind();
    const dn = t.closest('[data-dn]');
    if (dn) return duelNumToggle(+dn.dataset.dn);
    if (t.closest('#dqAll')) { try { localStorage.removeItem(duelNumsKey()); } catch (e) { /* */ } return renderTourPage(); }
    if (t.closest('#dqCancel')) { duelSearchStop(); api('duel/cancel', {}).catch(() => {}); return; }
    if (da) return tourAction('duel/respond', { id: +da.dataset.duelAccept, accept: true }, 'Вызов принят! Жми «Играть», когда будешь готов.');
    if (dd) return tourAction('duel/respond', { id: +dd.dataset.duelDecline, accept: false }, 'Вызов отклонён');
    if (dg) return startDuel(+dg.dataset.duelGo);
    if (df && confirm('Закончить дуэль? Засчитаются задания, решённые до этого момента.')) {
      try { await api('duel/finish', { id: +df.dataset.duelFin }); } catch (e) { toast(e.message, 3000); return; }
      toast('Дуэль закончена — ждём соперника', 3000);
      return loadDuels();
    }
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
      ${duelCalls().length ? `<div class="sum-note hot">⚔️ Тебя вызвали на дуэль: ${duelCalls().map(d => esc(d.opponent)).join(', ')}. <button type="button" class="btn ghost" id="sumDuels">Ответить</button></div>` : ''}
      ${inv.length ? `<div class="sum-note hot">🏆 Турнир: ${esc(tm.stage.toLowerCase())} — твой матч ждёт тебя — осталось ${tourLeft(tm.ends)}. <button type="button" class="btn ghost" id="sumDuels">К матчу</button></div>` : ''}
      ${DAILY && DAILY.ready && !DAILY.my_place && !DAILY.started ? `<div class="sum-note">👑 Задание дня ждёт: №${DAILY.n}${DAILY.count ? `, решили уже ${DAILY.count}` : ''}. <button type="button" class="btn ghost" id="dailyGo">Решать</button></div>` : ''}
      ${boardsHtml(d, 'league')}
      <div class="tour-foot"><button type="button" class="btn primary" id="tourGo">К заданиям</button></div>`;
    $('#forecastModal').hidden = false;
  }

  // ═══════ src/app/12-sets.js
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
    renderAsgPage();                      // открыта страница подборок — новая подборка появится на ней сразу
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
          : a.personal === 'own' ? `⭐ Учитель выдал тебе персональную подборку «${a.title}»`
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
  /** Подборка только для этого ученика (выдана учителем лично или собрана по его ошибкам) — зелёная надпись. */
  const persTag = a => a.personal ? '<span class="pers-tag">Персональная подборка</span>' : '';
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
          <div class="ap-top"><span class="ap-ico">${r ? '✓' : a.closed ? '⌛' : kindOf(a)[0]}</span><div><span class="ap-kind">${kindOf(a)[1]}</span>${persTag(a)}<b>${esc(a.title)}</b>
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
        <div class="ap-top"><span class="ap-ico">${sc.final && sc.tried ? '✓' : a.closed ? '⌛' : kindOf(a)[0]}</span><div><span class="ap-kind">${kindOf(a)[1]}</span>${persTag(a)}<b>${esc(a.title)}</b>
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
  let wkPoll = null, wkFsOn = false, wkAt = 0;
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
  // ------------------------------------------------------------ практическая и домашняя: номера заданий сверху
  // Как в варианте: можно перейти к любому заданию и вернуться. Ушёл после неверной попытки — она сохраняется
  // (сервер помнит), вернёшься — исправишь ответ со второй попытки. Оценка — по первому итогу задания.
  const pkPending = new Set();
  const pkScope = () => {
    if (ui.scope !== 'asg' || examShown || courseShown || !cur || (cur.why || {}).type !== 'asg') return null;
    const a = asgOf(ui.asg);
    return a && !a.strict && !a.duel && !a.course ? a : null;
  };
  /** Первый итог по каждому заданию (и по частям 19–21) после выдачи подборки — как считает оценку сервер. */
  function pkFirst(a) {
    const since = (a.created || 0) * 1000, first = new Map();
    for (const e of P.log) if (e.t >= since && !e.b && !e.x && !first.has(e.id)) first.set(e.id, e.s);
    const items = (a.score && a.score.items) || {};
    for (const k of Object.keys(items)) if (items[k] != null && !first.has(k)) first.set(k, items[k]);
    return first;
  }
  function pkState(id, first) {
    const t = byId.get(id);
    const mark = sc => (sc >= 1 ? ['ok', '✓ верно'] : sc > 0 ? ['half', '½ со 2-й'] : ['bad', '✗ неверно']);
    if (t && t.parts) {
      const v = t.parts.map(p => first.get(p.id));
      if (v.every(x => x != null)) return mark(Math.min(...v));
      if (v.some(x => x != null) || pkPending.has(id)) return ['pend', 'не до конца'];
      return null;
    }
    if (first.has(id)) return mark(first.get(id));
    return pkPending.has(id) ? ['pend', '1 попытка'] : null;
  }
  function pkNavHtml(a) {
    const first = pkFirst(a), now = cur ? cur.task.id : null;
    return `<nav class="ex-nav wk-nav pk-nav" id="pkNav" aria-label="Задания подборки">${a.tasks.map((id, i) => {
      const t = byId.get(id), st = pkState(id, first);
      const label = st ? st[1] : t ? '№' + numLabel(t.n) : '';
      return `<button type="button" class="ex-nav-btn${id === now ? ' on' : ''}${st ? ' ' + st[0] : ''}" data-pk-go="${esc(id)}"
        title="Задание ${i + 1}${t ? ` · №${numLabel(t.n)}` : ''}${st ? ' — ' + st[1] : ' — ещё не решено'}"><b>${i + 1}</b><small>${label}</small></button>`;
    }).join('')}<span class="pk-hint">Можно перейти к любому заданию и вернуться. Оценка — по первому результату задания.</span></nav>`;
  }
  function pkBar() {
    const a = pkScope(), nav = $('#pkNav');
    if (!a) { if (nav) nav.remove(); return; }
    if (nav) nav.outerHTML = pkNavHtml(a);
    else if (trainerEl) trainerEl.insertAdjacentHTML('afterbegin', pkNavHtml(a));
  }
  function pkGo(id) {
    const a = pkScope(), t = byId.get(id);
    if (!a || !t || (cur && cur.task.id === id)) return;
    // не «бросаем» задание: неверная попытка остаётся на сервере, вернёмся — продолжим с неё
    if (cur && !cur.done && cur.attempt > 0) pkPending.add(cur.task.id);
    if (cur && !cur.done && cur.group && cur.parts.some(x => x.final)) pkPending.add(cur.task.id);
    show({ task: t, why: { type: 'asg', a } });
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
    let hasSol = await autoAttach(cur.task.id);   // код из окна Python прикрепляется сам
    if (cur !== c) return;
    if (!hasSol) try { hasSol = !!(await api('solution?task=' + encodeURIComponent(cur.task.id))).code; } catch (e) { hasSol = true; }
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
      if (liveOn() && Date.now() - wkAt < 60000) return;       // завершение учителем придёт событием, опрос — страховка
      wkAt = Date.now();
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
    const pk = e.target.closest('[data-pk-go]');
    if (pk) { pkGo(pk.dataset.pkGo); return; }
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

  // ═══════ src/app/12b-pycourse.js
  // ------------------------------------------------------------ курс «Программирование для ЕГЭ» (закрытый)
  // Вход — по паролю курса, как у раздела «Курс» (пароль задаёт учитель). Модуль = тема, внутри лестница уровней:
  // следующий уровень открывается, когда в текущем решено need задач. Ответы проверяет сервер.
  let PYC_OK = false;
  let PYC_PW = false;                    // учитель задал пароль курса — на экране с замком есть поле для пароля
  let PYC = null;                        // план курса и прогресс с сервера
  let PYC_L = null;                      // открытый уровень
  let PYC_PY = null;                     // задача (или пример со слайда), с которой открыт редактор Python
  const PYC_STARS = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
  const pycDone = id => !!((PYC && PYC.progress[id]) || {}).ok;
  const pycModDone = m => m.levels.reduce((a, lv) => a + lv.tasks.filter(pycDone).length, 0);
  const pycModTotal = m => m.levels.reduce((a, lv) => a + lv.tasks.length, 0);
  const pycLabel = m => (m.n ? `№${m.n === 19 ? '19–21' : m.n}` : 'Старт');

  function pycSetAccess(on, pw) {
    PYC_OK = !!on;
    if (pw !== undefined) PYC_PW = !!pw;
    $('#pycCard')?.classList.toggle('locked', !PYC_OK);   // кнопка видна всем; без доступа — с замком
  }
  async function pycLoad() {
    PYC = await api('pyc');
    if (!PYC.access) { pycSetAccess(false, PYC.pw); return false; }
    pycSetAccess(true);
    return true;
  }
  function pycLock(msg) {
    $('#scopeInfo').innerHTML = '<span class="scope-title">Программирование</span>';
    if (msg || !PYC_PW) {
      trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><div class="crs-lock-ic">🔒</div>
        <h2>Курс «Программирование для ЕГЭ» — по паролю</h2>
        <p>${esc(msg || 'Учитель ещё не открыл курс. Как только откроет — здесь появится поле для пароля.')}</p></div></div>`;
      return;
    }
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock">
      <div class="crs-lock-ic">🐍</div>
      <h2>Курс «Программирование для ЕГЭ» — по паролю</h2>
      <p>Пароль выдаёт учитель. Ввести его нужно один раз — дальше курс будет открыт на любом устройстве.</p>
      <form class="login-form crs-lock-form" id="pycPwForm" autocomplete="off">
        <input class="inp" id="pycPw" type="password" maxlength="200" placeholder="Пароль курса" autocomplete="off" required>
        <button class="btn primary" type="submit">Открыть курс</button>
      </form>
      <div class="login-err" id="pycPwMsg"></div>
    </div></div>`;
    $('#pycPw').focus();
    $('#pycPwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const m = $('#pycPwMsg');
      m.textContent = '';
      try {
        await api('pyc/unlock', { password: $('#pycPw').value });
        pycSetAccess(true);
        toast('Курс открыт 🐍', 2500);
        openPyc();
      } catch (err) { m.textContent = err.message || 'Не получилось — попробуйте ещё раз'; }
    });
  }
  function pycEnter() {
    if (!leaveExam()) return false;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true;
    pageKind = 'pyc';
    cur = null;
    document.querySelectorAll('.rail-btn.on').forEach(b => b.classList.remove('on'));
    $('#pycCard')?.classList.add('on');
    document.body.classList.add('asg-wide');
    return true;
  }

  /** План курса: модули по группам, у каждого — лестница уровней. */
  async function openPyc() {
    if (!pycEnter()) return;
    navPush({ v: 'pyc' });
    PYC_L = null;
    try { await pycLoad(); } catch (e) { if (e.status !== 401) netError(e); return; }
    if (!courseShown || pageKind !== 'pyc') return;
    if (!PYC.access) { pycLock(); return; }
    const mods = PYC.modules;
    const all = mods.reduce((a, m) => a + pycModTotal(m), 0), done = mods.reduce((a, m) => a + pycModDone(m), 0);
    // «Продолжить»: первый модуль с нерешёнными задачами в открытом уровне (сначала тот, где уже начали)
    let cont = null;
    for (const m of [...mods].sort((a, b) => (pycModDone(b) > 0) - (pycModDone(a) > 0))) {
      const li = m.levels.findIndex((lv, i) => i < m.open && lv.tasks.some(t => !pycDone(t)));
      if (li >= 0 && (!cont || (pycModDone(m) > 0 && !pycModDone(cont.m)))) cont = { m, li };
      if (cont && pycModDone(cont.m) > 0) break;
    }
    const card = m => {
      const d = pycModDone(m), t = pycModTotal(m);
      return `<div class="pyc-mod${d === t && t ? ' done' : ''}">
        <div class="pyc-mod-h"><span class="pyc-mod-ic">${m.icon}</span><div><span class="pyc-num">${pycLabel(m)}</span><b>${esc(m.title)}</b>
          <small>${esc(m.sub)}</small></div></div>
        <div class="pyc-ladder">${m.levels.map((lv, i) => {
          const ld = lv.tasks.filter(pycDone).length, lock = i >= m.open, full = ld === lv.tasks.length;
          return `<button type="button" class="pyc-step${lock ? ' lock' : full ? ' done' : ld ? ' go' : ''}" data-pyc-lv="${m.id}:${i}"
              title="${esc(lv.goal)}"${lock ? ' disabled' : ''}><i>${lock ? '🔒' : full ? '✓' : i + 1}</i><span><b>${esc(lv.title)}</b>
              <small>${lock ? `откроется после ${m.levels[i - 1].need} задач уровня ${i}` : `${ld} из ${lv.tasks.length}`}</small></span></button>`;
        }).join('')}</div>
        <i class="xp-bar"><b style="width:${t ? pct(d / t) : 0}%"></b></i></div>`;
    };
    const groups = [['base', 'Старт: язык Python', 'Если программируете впервые — начните отсюда'],
      ['ege', 'Задания ЕГЭ', 'Каждый номер — от базы до максимума: все приёмы и ловушки']];
    $('#scopeInfo').innerHTML = `<span class="scope-title">Программирование</span><span class="scope-stats">${done} из ${all} задач</span>`;
    trainerEl.innerHTML = `<div class="course pyc">
      <div class="crs-hero pyc-hero"><div><div class="crs-kicker">Закрытый курс Egeshka</div><h2>Программирование для ЕГЭ</h2>
        <p>Python от первой строчки до самых сложных номеров. Каждая тема — лестница уровней: короткая теория с примерами, которые можно запустить,
          и задачи с проверкой. Ответ — то, что напечатала ваша программа.</p></div>
        <div class="crs-prog"><b>${done}</b><span>из ${all} задач решено</span><i class="xp-bar"><b style="width:${all ? pct(done / all) : 0}%"></b></i></div></div>
      ${cont ? `<button type="button" class="crs-continue" data-pyc-lv="${cont.m.id}:${cont.li}"><span>▶</span><span>
        <b>Продолжить: ${esc(pycLabel(cont.m))} · ${esc(cont.m.title)}</b><small>уровень ${cont.li + 1} · ${esc(cont.m.levels[cont.li].title)}</small></span></button>` : ''}
      ${groups.map(([g, h, sub]) => {
        const ms = mods.filter(m => (m.group || 'ege') === g);
        return ms.length ? `<div class="fm-h">${h}</div><p class="fm-note pyc-gsub">${sub}</p><div class="pyc-grid">${ms.map(card).join('')}</div>` : '';
      }).join('')}
    </div>`;
    window.scrollTo(0, 0);
  }

  /** Уровень: слайды (как в «Курсе») и задачи с проверкой. */
  async function openPycLevel(mid, li, keepScroll) {
    if (!(courseShown && pageKind === 'pyc') && !pycEnter()) return;
    navPush({ v: 'pycl', m: mid, l: li });
    let d;
    try {
      if (!PYC) await pycLoad();
      d = await api(`pyc/level?m=${encodeURIComponent(mid)}&l=${li}`);
    } catch (e) {
      if (e.status === 403) { if (PYC && PYC.access) { toast(e.message, 4000); return openPyc(); } pycLock(); return; }
      netError(e); return;
    }
    if (!courseShown || pageKind !== 'pyc') return;
    const y = window.scrollY;
    PYC_L = d;
    const m = PYC.modules.find(x => x.id === mid) || { levels: [], open: 1 };
    const lv = d.level, has = lv.slides.length;
    DECK = has ? { n: `pyc:${mid}:${li}`, label: `${pycLabel(d)} · уровень ${li + 1}`, pyc: true, slides: lv.slides } : null;
    if (!keepScroll) deckI = 0;
    const done = lv.tasks.filter(t => t.ok).length;
    $('#scopeInfo').innerHTML = `<span class="scope-title">Программирование · ${esc(pycLabel(d))}</span><span class="scope-stats">уровень ${li + 1} из ${d.levels}</span>`;
    trainerEl.innerHTML = `<div class="course lesson pyc">
      <button type="button" class="link-btn crs-back" data-pyc-home>← К плану курса</button>
      <div class="crs-l-head"><span class="pyc-mod-ic">${d.icon}</span><div><div class="crs-kicker">${esc(pycLabel(d))} · ${esc(d.title)}</div>
        <h2>Уровень ${li + 1}. ${esc(lv.title)}</h2><small class="pyc-goal">${esc(lv.goal)}</small></div></div>
      <div class="pyc-tabs">${m.levels.map((x, i) => `<button type="button" class="${i === li ? 'on' : ''}${i >= m.open ? ' lock' : ''}" data-pyc-lv="${mid}:${i}"
        ${i >= m.open ? 'disabled' : ''}>${i >= m.open ? '🔒 ' : ''}${i + 1}. ${esc(x.title)}</button>`).join('')}</div>
      ${has ? `<div class="fm-h">1. Теория · ${lv.slides.length} ${plural(lv.slides.length, 'слайд', 'слайда', 'слайдов')}</div>
      <div class="crs-deck" id="crsDeck">
        <div class="crs-main"><div class="crs-stage"></div>
          <div class="crs-nav"><button type="button" class="btn ghost" data-deck="-1">← Назад</button><span class="crs-count"></span>
            ${MARK_BTN}
            <span class="crs-zoom"><button type="button" class="icon-btn" data-deck-zoom="-1" title="Мельче">−</button>
              <button type="button" class="link-btn" data-deck-zoom="0" id="deckZoomLbl" title="Обычный размер">${Math.round(DECK_SCALE * 100)}%</button>
              <button type="button" class="icon-btn" data-deck-zoom="1" title="Крупнее">+</button></span>
            <button type="button" class="btn ghost crs-full" data-deck-full title="На весь экран">⤢</button>
            <button type="button" class="btn primary" data-deck="1">Далее →</button></div></div>
        <div class="crs-thumbs">${lv.slides.map((t, i) => `<button type="button" class="crs-thumb" data-slide="${i}"><span>${i + 1}. ${esc(t.h)}</span></button>`).join('')}</div>
      </div>` : ''}
      <div class="fm-h">${has ? '2. ' : ''}Задачи уровня · решено ${done} из ${lv.tasks.length}</div>
      ${li + 1 < d.levels ? `<p class="fm-note">${li + 1 < m.open ? '🔓 Следующий уровень уже открыт.' : `Решите ${lv.need} ${plural(lv.need, 'задачу', 'задачи', 'задач')} — откроется уровень ${li + 2}.`}</p>` : ''}
      <div class="pyc-tasks">${lv.tasks.map((t, i) => pycTaskHtml(t, i)).join('')}</div>
      ${li + 1 < d.levels && li + 1 < m.open ? `<button type="button" class="btn primary pyc-next" data-pyc-lv="${mid}:${li + 1}">Уровень ${li + 2}: ${esc(m.levels[li + 1].title)} →</button>` : ''}
    </div>`;
    if (has) renderDeck();
    $$('.pyc-task .cond').forEach(el => { try { renderMath(el); } catch (e) { /* без формул */ } });
    window.scrollTo(0, keepScroll ? y : 0);
  }
  function pycFilesHtml(files) {
    return (files || []).length ? `<div class="files pyc-files"><span>Файлы:</span>${files.map(f =>
      `<a class="file" href="${esc(f.url)}" download="${esc(f.name)}">${esc(f.name)}<small>${f.size > 1024 ? Math.round(f.size / 1024) + ' КБ' : f.size + ' Б'}</small></a>`).join('')}</div>` : '';
  }
  function pycTaskHtml(t, i) {
    const st = t.ok ? 'ok' : t.tries ? 'bad' : '';
    return `<div class="pyc-task ${st}" id="pt-${esc(t.id.replace('.', '-'))}" data-pyc-task="${esc(t.id)}">
      <div class="pyc-th"><span class="pyc-tn">${t.ok ? '✓' : i + 1}</span><b>${esc(t.h)}</b><span class="pyc-stars" title="сложность">${PYC_STARS(t.stars || 1)}</span>
        <span class="pyc-st">${t.ok ? 'решено' : t.tries ? `попыток: ${t.tries}` : ''}</span></div>
      <div class="cond pyc-cond">${safeHtml(t.cond)}</div>
      ${pycFilesHtml(t.files)}
      <div class="pyc-act">
        <button type="button" class="btn" data-pyc-py="${esc(t.id)}">▶ Решать в Python</button>
        <form class="pyc-form" data-pyc-form="${esc(t.id)}" autocomplete="off">
          <input class="inp pyc-ans" maxlength="300" placeholder="${t.ok ? 'Решено ✓' : 'Ответ'}" value="${t.ok && t.ans ? esc(t.ans) : ''}"${t.ok ? ' readonly' : ''}>
          ${t.ok ? '' : '<button type="submit" class="btn primary">Проверить</button>'}
        </form>
        <span class="pyc-msg" aria-live="polite"></span>
      </div>
      ${t.hint && !t.ok ? `<details class="pyc-more"><summary>💡 Подсказка</summary><div>${safeHtml(t.hint)}</div></details>` : ''}
      ${t.note && t.ok ? `<div class="sl-nuance nk-secret"><b class="nk">💡 Секрет.</b> ${safeHtml(t.note)}</div>` : ''}
      ${t.sol ? pycSolHtml(t) : ''}
    </div>`;
  }
  function pycSolHtml(t) {
    return `<details class="pyc-more pyc-sol"${t.ok ? '' : ''}><summary>${t.ok ? '📖 Эталонное решение' : '📖 Разбор (после трёх попыток)'}</summary>
      <pre class="sl-code">${highlightPy(t.sol)}</pre>
      <div class="sl-btns"><button type="button" class="btn ghost" data-pyc-sol="${esc(t.id)}">▶ Открыть разбор в Python</button>
        ${t.ok && t.ans ? `<span class="sl-ok"><i aria-hidden="true">✓</i>Ответ: <b>${esc(t.ans)}</b></span>` : ''}</div></details>`;
  }
  const pycTask = id => PYC_L && PYC_L.level.tasks.find(t => t.id === id);
  function pycPyTask(t, label) {
    return { id: 'pyc:' + t.id, n: PYC_L.n || 0, pyc: true, label, att: (t.files || []).map(f => ({ name: f.name, href: f.url })) };
  }
  /** Редактор Python для задачи курса: файлы задачи уже лежат рядом с кодом. */
  function pycOpenPy(id, code) {
    const t = pycTask(id);
    if (!t) return;
    const k = PYC_L.level.tasks.indexOf(t) + 1;
    PYC_PY = pycPyTask(t, `${pycLabel(PYC_L)} · ур. ${PYC_L.l + 1} · задача ${k}`);
    if (pyOpen()) pySync(); else togglePy(true);
    if (code != null) {
      const ta = $('#pyCode');
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  async function pycCheck(id, form) {
    const inp = form.querySelector('.pyc-ans'), box = form.closest('.pyc-task'), msg = box.querySelector('.pyc-msg');
    const answer = inp.value.trim();
    if (!answer) { inp.focus(); return; }
    const pid = 'pyc:' + id;
    const code = PY.task && PY.task.id === pid ? $('#pyCode').value : readCode(pid);
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    let r;
    try { r = await api('pyc/check', { task: id, answer, code: code || '' }); } catch (e) { if (btn) btn.disabled = false; netError(e); return; }
    if (btn) btn.disabled = false;
    const t = pycTask(id);
    if (!t) return;
    t.tries = r.tries;
    PYC.progress[id] = { ok: r.ok || t.ok, tries: r.tries };
    if (r.sol) t.sol = r.sol;
    if (r.ok) {
      t.ok = true;
      t.ans = r.ans;
      toast(r.opened ? '🔓 Верно! Открыт следующий уровень' : '✅ Верно!', r.opened ? 4000 : 2000);
      if (r.opened) { await pycLoad().catch(() => {}); }
      openPycLevel(PYC_L.id, PYC_L.l, true);
      return;
    }
    box.classList.add('bad');
    box.querySelector('.pyc-st').textContent = `попыток: ${r.tries}`;
    msg.textContent = 'Неверно — проверьте программу и вопрос задачи';
    msg.className = 'pyc-msg bad';
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    if (r.sol && !box.querySelector('.pyc-sol')) box.insertAdjacentHTML('beforeend', pycSolHtml(t));
  }

  trainerEl.addEventListener('click', e => {
    if (!courseShown || pageKind !== 'pyc') return;
    const lv = e.target.closest('[data-pyc-lv]');
    if (lv && !lv.disabled) { const [m, l] = lv.dataset.pycLv.split(':'); openPycLevel(m, +l); return; }
    if (e.target.closest('[data-pyc-home]')) { openPyc(); return; }
    const py = e.target.closest('[data-pyc-py]');
    if (py) { pycOpenPy(py.dataset.pycPy); return; }
    const sol = e.target.closest('[data-pyc-sol]');
    if (sol) { const t = pycTask(sol.dataset.pycSol); if (t) pycOpenPy(t.id, t.sol); }
  });
  trainerEl.addEventListener('submit', e => {
    const f = e.target.closest('[data-pyc-form]');
    if (!f) return;
    e.preventDefault();
    pycCheck(f.dataset.pycForm, f);
  });
  trainerEl.addEventListener('input', e => {
    if (e.target.matches('.pyc-ans')) { const m = e.target.closest('.pyc-task').querySelector('.pyc-msg'); m.textContent = ''; m.className = 'pyc-msg'; }
  });
  $('#pycCard')?.addEventListener('click', () => openPyc());
  /** Учитель задал пароль, закрыл курс всем или выключил его — замок и экран курса обновляются сразу. */
  async function pycLive() {
    try { const me = await api('me'); pycSetAccess(me.pyc, me.pyc_pw); } catch (e) { return; }
    if (courseShown && pageKind === 'pyc') { if (PYC_OK) { if (!PYC_L) openPyc(); } else pycLock(); }
  }
  // ═══════ src/app/12c-gifts.js
  // ------------------------------------------------------------ биткоины и подарки
  // Биткоины (₿) считает сервер (GAME.coins): 1 за каждые 10 XP опыта + начисления учителя − покупки. Подарок покупают
  // себе или однокласснику, «🎲 Случайный подарок» выпадает любой (дорогие — реже), учитель дарит из панели.
  // Свой подарок можно улучшить — он станет уникальным: номер и случайные фон, узор и эффект, у каждого своя редкость.
  // Редкость считает сервер: у обычного — шанс выпасть в «🎲», у уникального — шанс сочетания («1 из N»); видна на подарке.
  // Экономика: цены растут с инфляцией (средний кошелёк учеников), тираж уникальных каждого вида ограничен, проданный
  // подарок сгорает; биткоины и подарки — за труд: 1 ₿ за 10 XP, каждые 25 решённых — подарок.
  let GF = null;                          // магазин и свои подарки с сервера
  let gfTo = '';                          // кому дарим: '' — себе, иначе sid одноклассника
  let gfOpen = null;                      // открытая карточка подарка (id) или null — магазин
  let gfTab = 'shop';                     // магазин или рынок одноклассников
  const gfDate = ts => { const d = new Date(ts * 1000); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const gfMate = sid => (GF.mates.find(m => String(m.sid) === String(sid)) || {}).name || '';
  const btcWord = n => plural(n, 'биткоин', 'биткоина', 'биткоинов');
  const gfFrom = g => g.market ? 'с рынка · ' + g.market : g.from === 'учитель' ? 'от учителя' : g.from === 'труд' ? 'за труд'
    : g.from === 'сам себе' ? 'купил себе' : g.from ? 'от ' + g.from : '';
  const fee = p => Math.ceil(p * GF.market_fee);           // комиссия рынка сгорает
  const idxTxt = x => String(x).replace('.', ',');
  /** Уникальный подарок: фон-градиент, узор из символов, эффект и номер; рамка — цвета редкости. */
  function uniqTile(g, cls = '') {
    const u = g.uniq;
    const pat = Array.from({ length: 8 }, (_, k) => `<i class="ug-s s${k}">${esc(u.ch)}</i>`).join('');
    const pose = u.pose || 'stand';         // поза: наклон, великан, вверх ногами, близнецы (значок дважды), вихрь…
    return `<span class="ug r-${u.rar.k} ${cls}" style="--c1:${u.c1};--c2:${u.c2}">${pat}<span class="ug-ic gfx-${u.fx}"><i class="ugp-${pose}">${g.i}${pose === 'twin' ? g.i : ''}</i></span><b class="ug-n">#${u.n}</b></span>`;
  }
  /** Редкость подарка: уровень (у уникального — его сочетания) и шанс. */
  const gfRar = g => (g.uniq ? g.uniq.rar : g.rar);
  const rarHtml = g => { const r = gfRar(g); return r ? `<span class="rar r-${r.k}">${esc(r.t)}</span>` : ''; };
  const rarWhy = g => (g.uniq ? `шанс такого сочетания — 1 из ${g.uniq.rar.one_in.toLocaleString('ru-RU')}`
    : g.rar ? `шанс выпасть в 🎲 случайном подарке — ${String(g.rar.p).replace('.', ',')}%` : '');

  async function openGifts(to, open) {
    if (!SERVER) return;
    try { GF = await api('gifts'); } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось открыть подарки'); return; }
    if (to !== undefined) gfTo = to && gfMate(to) ? String(to) : '';
    gfOpen = open || null;
    renderGifts();
    $('#forecastModal').hidden = false;
  }
  function renderGifts() {
    const g = gfOpen && GF.mine.find(x => x.id === gfOpen);
    if (g) return renderGift(g);
    const G = GF, coins = G.coins, who = gfTo ? gfMate(gfTo) : '';
    const left = Math.max(0, G.per_day - G.bought_today);
    // спрос: подарок покупали за неделю заметно чаще среднего — дороже (▲), реже — дешевле (▼); мелкие колебания не показываем
    const trend = d => (d >= 1.05 ? `<em class="gf-trend up" title="Спрос растёт — цена ×${idxTxt(d)}">▲</em>`
      : d <= 0.95 ? `<em class="gf-trend down" title="Спрос падает — цена ×${idxTxt(d)}">▼</em>` : '');
    const item = (id, i, t, price, cls = '', rar = null, dem = 1) => `<button type="button" class="gf-item ${cls}${rar ? ' r-' + rar.k : ''}" data-gift="${id}"${price > coins || !left ? ' disabled' : ''}
        title="${esc(t)} — ${price} ₿${rar ? ` · ${rar.t}: ${rarWhy({ rar })}` : ''}"><span class="gf-ic">${i}</span><b>${esc(t)}</b><small>₿ ${price}${trend(dem)}</small>${rar ? rarHtml({ rar }) : ''}</button>`;
    const shop = G.teacher ? '<p class="fm-note">Учительский аккаунт дарит подарки из панели учителя — вкладка «Подарки».</p>'
      : `<div class="gf-to"><label>Кому <select class="inp" id="gfTo"><option value="">себе</option>${G.mates.map(m =>
          `<option value="${m.sid}"${String(m.sid) === gfTo ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          <span class="fm-muted">${left ? `Сегодня можно купить ещё ${left}` : 'На сегодня подарков хватит — завтра снова можно'}</span></div>
        <div class="gf-grid">${item('box', '🎲', 'Случайный подарок', G.box, 'gf-box')}${G.catalog.map(x => item(x.id, x.i, x.t, x.price, '', x.rar, x.demand)).join('')}</div>
        <p class="fm-note">🎲 Случайный подарок — может выпасть любой, даже Дракон; чем дороже подарок, тем реже он выпадает.
          ▲ — подарок покупают чаще других, он дорожает; ▼ — реже, он дешевеет.${G.econ.idx > 1 ? ` Сейчас инфляция: все цены ×${idxTxt(G.econ.idx)}.` : ''}</p>`;
    const mine = G.mine.length ? `<div class="gf-mine">${G.mine.map(x => `<button type="button" class="gf-own${x.uniq ? ' uniq' : ''} r-${gfRar(x).k}" data-gift-open="${x.id}"
          title="${esc(x.t)}${x.uniq ? ' #' + x.uniq.n : ''} · ${esc(gfRar(x).t)}: ${esc(rarWhy(x))}">${x.uniq ? uniqTile(x) : `<span class="gf-ic">${x.i}</span>`}
          <b>${esc(x.t)}${x.uniq ? ` <span class="ug-num">#${x.uniq.n}</span>` : ''}</b>${rarHtml(x)}<small>${x.listed != null ? `🏪 на рынке · ₿ ${x.listed}` : esc(gfFrom(x))}</small></button>`).join('')}</div>
        <p class="fm-note">Нажми на подарок — его можно улучшить до уникального (номер, фон, узор, эффект и поза; тираж — ${G.cap} штук каждого вида).
          Улучшение — от ₿ ${G.up_min}: чем дороже подарок, тем дороже, и +1% за каждый уже выпущенный уникальный этого вида.
          Подарок можно и продать — сразу или на рынке одноклассникам за свою цену. Редкость: у обычного подарка — шанс выпасть в 🎲, у уникального — шанс его сочетания.</p>`
      : '<p class="fm-muted">Пока ни одного — купи себе первый или дождись подарка от учителя.</p>';
    $('#forecastBody').innerHTML = `
      <div class="gm-head"><span class="gm-level gf-coin">₿</span>
        <div style="flex:1"><h2 class="fm-title" style="margin:0">${coins} ${btcWord(coins)}</h2>
          <span class="fm-muted">Только трудом: сейчас 1 ₿ = ${G.coin_xp} XP опыта${G.coin_xp > G.rate_base ? ` (решает много людей — биткоин дороже обычных ${G.rate_base} XP)` : ''},
            а за каждое решённое задание — ещё биткоины сверху: чем сложнее задание, тем больше. Каждые ${G.work_every} решённых — подарок в награду.
            Решено быстрее ${G.fine_sec} секунд — минус 1 ₿${G.fines ? ` (уже −${G.fines} ₿)` : ''}.
            За вариант ЕГЭ — бонус по тестовому баллу: ${examBtcTxt(G)}; самостоятельные от учителя — так же, как вариант.</span></div></div>
      ${giftValueHtml(G.value, true, true)}
      <div class="pf-tabs gf-tabs"><button type="button" class="pf-tab${gfTab === 'shop' ? ' on' : ''}" data-gftab="shop">🛍 Магазин${who ? ` — для ${esc(who)}` : ''}</button>
        <button type="button" class="pf-tab${gfTab === 'market' ? ' on' : ''}" data-gftab="market">🏪 Рынок · ${G.market.filter(x => !x.mine).length}</button></div>
      ${gfTab === 'market' ? marketHtml(G) : shop}
      <h3 class="fm-sub">Мои подарки · ${G.mine.length}</h3>
      ${mine}
      ${ledgerHtml(G)}
      <p class="fm-note">Подарки видны маленькими значками у ника — в рейтинге и в профиле: сначала уникальные, всего до ${G.show}.</p>`;
  }
  /** Рынок одноклассников: подарки, выставленные за свою цену; свои — с кнопкой «Снять». */
  function marketHtml(G) {
    const pct = Math.round(G.market_fee * 100);
    const list = G.market;
    const card = x => {
      const tile = x.uniq ? uniqTile(x) : `<span class="ug plain r-${x.rar.k}"><span class="ug-ic">${x.i}</span></span>`;
      const vs = x.price < x.shop ? `<span class="gf-plus">дешевле магазина (₿ ${x.shop})</span>` : `в магазине ₿ ${x.shop}`;
      return `<div class="mk-item${x.mine ? ' mine' : ''}">${tile}
        <div class="mk-t"><b>${esc(x.t)}${x.uniq ? ` <span class="ug-num">#${x.uniq.n}</span>` : ''}</b> ${rarHtml(x)}
          <small>${x.mine ? 'твой' : 'продаёт ' + esc(x.seller)} · ${vs}</small></div>
        ${x.mine ? `<button type="button" class="btn small ghost" data-gift-unlist="${x.id}">Снять</button>`
          : `<button type="button" class="btn small primary" data-mk-buy="${x.id}"${G.teacher || G.coins < x.price ? ' disabled' : ''}>₿ ${x.price}</button>`}</div>`;
    };
    return `${list.length ? `<div class="mk-list">${list.map(card).join('')}</div>` : '<p class="fm-muted">Пока никто ничего не продаёт.</p>'}
      <p class="fm-note">🏪 Рынок — подарки одноклассников за их цену. Уникальный переходит к покупателю со своим номером и свойствами.
        Чтобы продать свой — открой его в «Моих подарках» и нажми «Выставить на рынок»; продавец получает цену минус ${pct}% (комиссия сгорает).</p>`;
  }
  /** Оценка подарков: сколько дадут, если продать всё сейчас, сколько такие стоят в магазине и три самых ценных.
   *  open — в окне подарков: по самому ценному можно открыть его карточку. */
  function giftValueHtml(V, me, open) {
    if (!V || !V.n) return '';
    const num = v => v.toLocaleString('ru-RU');
    const top = V.top.map(g => {
      const name = esc(g.t) + (g.uniq ? ' #' + g.uniq.n : '');
      const tile = g.uniq ? uniqTile(g) : `<span class="ug plain r-${g.rar.k}"><span class="ug-ic">${g.i}</span></span>`;
      const tag = open ? 'button' : 'span';
      return `<${tag}${open ? ` type="button" data-gift-open="${g.id}"` : ''} class="gv-top" title="${name} · ${esc(gfRar(g).t)} · при продаже ${num(g.sell)} ₿">
        ${tile}<b>${name}</b><small>${num(g.sell)} ₿</small></${tag}>`;
    }).join('');
    return `<div class="gf-value">
      <div class="gv-main"><small>💎 Оценка ${me ? 'твоих ' : ''}подарков</small><b>≈ ${num(V.sell)} ₿</b>
        <span>столько дадут, если продать ${V.n === 1 ? 'его' : `все ${V.n}`} сейчас; в магазине такие стоят ${num(V.shop)} ₿</span></div>
      ${top ? `<div class="gv-tops"><small>Самые ценные</small>${top}</div>` : ''}</div>`;
  }
  /** «40+ — 15 ₿, 60+ — 30 ₿…» — бонусы за вариант ЕГЭ от меньшего балла к большему. */
  const examBtcTxt = G => G.exam_btc.slice().reverse().map(([low, b]) => `${low}+ — ${b} ₿`).join(', ');
  /** История биткоинов, кроме опыта: начисления и снятия учителем, покупки, улучшения, продажи, штрафы за спешку. */
  function ledgerHtml(G) {
    const why = { grant: '➕ Начислил учитель', take: '➖ Снял учитель', gift: '🎁 Покупка подарка', upgrade: '✨ Улучшение', sell: '💰 Продажа',
      mbuy: '🏪 Покупка на рынке у', msell: '🏪 Продажа на рынке —' };
    const rows = G.ledger.map(r => `<tr><td class="fm-muted">${gfDate(r.ts)}</td><td>${why[r.reason] || esc(r.reason)}${r.note ? (r.reason === 'mbuy' || r.reason === 'msell' ? ` ${esc(r.note)}` : ` <span class="fm-muted">«${esc(r.note)}»</span>`) : ''}</td>
      <td class="num ${r.delta > 0 ? 'xp-plus' : 'xp-minus'}">${r.delta > 0 ? '+' : '−'}${Math.abs(r.delta)} ₿</td></tr>`).join('');
    if (!rows && !G.fines && !G.exam_coins && !G.task_coins) return '';
    return `<details class="xp-log"><summary>История биткоинов</summary>
      ${G.task_coins ? `<p class="fm-note">🧩 Бонусы за решённые задания: <b class="xp-plus">+${G.task_coins} ₿</b> (чем сложнее задание, тем больше).</p>` : ''}
      ${G.exam_coins ? `<p class="fm-note">🎓 Бонусы за варианты ЕГЭ и самостоятельные: <b class="xp-plus">+${G.exam_coins} ₿</b> (${examBtcTxt(G)}).</p>` : ''}
      ${G.fines ? `<p class="fm-note">Штраф за ответы быстрее ${G.fine_sec} секунд: −${G.fines} ₿ (по 1 ₿ за задание).</p>` : ''}
      ${rows ? `<table class="fm-table">${rows}</table>` : ''}
      <p class="fm-note">Биткоины за опыт здесь не показаны — они приходят сами: 1 ₿ за каждые ${G.coin_xp} XP.</p></details>`;
  }
  /** Карточка подарка: свойства уникального или кнопка «Улучшить». */
  function renderGift(g, fresh) {
    const u = g.uniq;
    const big = u ? uniqTile(g, 'big' + (fresh ? ' reveal' : '')) : `<span class="ug plain big r-${g.rar.k}"><span class="ug-ic">${g.i}</span></span>`;
    const rarRow = `<div class="gf-rar">${rarHtml(g)} <span class="fm-muted">${esc(rarWhy(g))}</span></div>`;
    const meta = [gfFrom(g), gfDate(g.ts)].filter(Boolean).join(' · ');
    // продажа: сравнение с нынешней ценой улучшения — уникальный бывает дешевле улучшения (редкий) и в разы дороже (мифический)
    const diff = g.up_now ? g.sell - g.up_now : 0;
    const vs = !u ? '' : g.up_now == null ? ' · тираж закончился — таких больше не будет'
      : diff >= 0 ? ` · <b class="gf-plus">на ${diff} ₿ дороже</b> улучшения (₿ ${g.up_now})` : ` · <span class="gf-minus">на ${-diff} ₿ дешевле</span> улучшения (₿ ${g.up_now})`;
    const suggest = Math.max(GF.market_min, u ? Math.round(g.sell * 1.5 / 5) * 5 : ((GF.catalog.find(x => x.id === g.gift) || {}).price || g.sell));
    const market = g.listed != null
      ? `<p class="gf-sell"><b>🏪 На рынке за ₿ ${g.listed}</b> <span class="fm-muted">— получишь ${g.listed - fee(g.listed)} ₿, когда купят</span>
          <button type="button" class="btn small ghost" data-gift-unlist="${g.id}">Снять с продажи</button></p>`
      : `<p class="gf-sell mk-sell"><label>🏪 Продать одноклассникам за <input class="inp" id="mkPrice" type="number" min="${GF.market_min}" max="${GF.market_max}" value="${suggest}"> ₿</label>
          <button type="button" class="btn" data-gift-list="${g.id}">Выставить на рынок</button>
          <span class="fm-muted" id="mkGet">получишь ${suggest - fee(suggest)} ₿ (комиссия ${Math.round(GF.market_fee * 100)}% сгорает)</span></p>`;
    const sell = g.listed != null ? market : `<p class="gf-sell"><button type="button" class="btn" data-gift-sell="${g.id}">💰 Продать сразу за ₿ ${g.sell}</button>
        <span class="fm-muted">${vs ? vs.slice(3) : 'обычный подарок продаётся за половину цены'}</span></p>${market}`;
    const body = u
      ? `<table class="fm-table gf-props">${u.props.map(p => `<tr><td class="fm-muted">${p.k}</td><td><b>${esc(p.t)}</b></td>
          <td class="num"><span class="chip">${String(p.p).replace('.', ',')}%</span></td></tr>`).join('')}</table>
        ${sell}
        <p class="fm-note">Уникальный подарок: такого сочетания фона, узора, эффекта и позы больше нет ни у одного «${esc(g.t)}». Процент — как часто выпадает
          это свойство; редкость подарка — шанс всего сочетания (фон × узор × эффект × поза): ${GF.uniq_tiers.map(r => r.one_in
            ? `${r.t.toLowerCase()} — до 1 из ${r.one_in.toLocaleString('ru-RU')}` : `${r.t.toLowerCase()} — ещё реже`).join(', ')}.
          Выпущено уникальных «${esc(g.t)}»: ${g.issued} из ${g.cap}. Проданный подарок сгорает — его номер и сочетание больше никому не выпадут.</p>`
      : `<p>Улучши подарок — он станет <b>уникальным</b>: получит номер и случайные фон, узор, эффект и позу. Чем реже сочетание, тем дороже его можно продать:
          редкий — дешевле улучшения, легендарный и мифический — в разы дороже.</p>
        <p>${g.listed != null ? '<span class="fm-muted">Пока подарок на рынке, улучшить его нельзя.</span>' : g.up == null ? `<b>Тираж уникальных «${esc(g.t)}» закончился</b> — выпущено ${g.cap} из ${g.cap}.`
          : `<button type="button" class="btn primary" data-gift-up="${g.id}"${GF.coins < g.up ? ' disabled' : ''}>✨ Улучшить за ₿ ${g.up}</button>
          ${GF.coins < g.up ? `<span class="fm-muted"> — нужно ещё ${g.up - GF.coins} ₿</span>` : ''}
          <span class="fm-muted"> · выпущено уникальных: ${g.issued} из ${g.cap} — каждый следующий на 1% дороже</span>`}</p>
        ${sell}`;
    $('#forecastBody').innerHTML = `<button type="button" class="btn small ghost" id="gfBack">← к подаркам</button>
      <div class="gf-card">${big}
        <div><h2 class="fm-title" style="margin:6px 0 2px">${esc(g.t)}${u ? ` <span class="ug-num">#${u.n}</span>` : ''}</h2>
          ${rarRow}<div class="fm-muted">${esc(meta)}</div>${g.note ? `<div class="gf-note">«${esc(g.note)}»</div>` : ''}</div></div>
      ${body}`;
  }
  async function buyGift(id) {
    const box = id === 'box', g = box ? { i: '🎲', t: 'Случайный подарок', price: GF.box } : GF.catalog.find(x => x.id === id);
    const who = gfTo ? gfMate(gfTo) : '';
    if (!g || !confirm(`Купить ${g.i} ${g.t} за ${g.price} ₿ — ${who ? `в подарок: ${who}` : 'себе'}?`)) return;
    try {
      const r = await api('gifts/buy', { gift: id, to: gfTo ? +gfTo : null });
      if (r.game) onGame(r.game);
      const got = GF.catalog.find(x => x.id === r.got) || g;
      toast(box ? `🎲 Выпало: ${got.i} ${got.t}!${who ? ` — подарено: ${who}` : ''}` : who ? `🎁 ${got.i} ${got.t} — подарено: ${who}` : `🎁 ${got.i} ${got.t} — теперь у тебя`, 5000);
      await openGifts();
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось купить'); }
  }
  async function upgradeGift(id) {
    const g = GF.mine.find(x => x.id === id);
    if (!g || !confirm(`Улучшить ${g.i} ${g.t} за ${g.up} ₿? Подарок станет уникальным.`)) return;
    try {
      const r = await api('gifts/upgrade', { id });
      if (r.game) onGame(r.game);
      GF.coins = r.game ? r.game.coins : GF.coins;
      GF.mine = GF.mine.map(x => (x.id === id ? r.gift : x));
      renderGift(r.gift, true);
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось улучшить'); }
  }
  async function sellGift(id) {
    const g = GF.mine.find(x => x.id === id);
    if (!g || !confirm(`Продать ${g.i} ${g.t}${g.uniq ? ' #' + g.uniq.n : ''} за ${g.sell} ₿? Подарок сгорит — вернуть его будет нельзя.`)) return;
    try {
      const r = await api('gifts/sell', { id });
      if (r.game) onGame(r.game);
      toast(`💰 Продано за ${r.price} ₿`, 4000);
      await openGifts();
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось продать'); }
  }
  async function listGift(id) {
    const price = Math.round(+($('#mkPrice') || {}).value || 0);
    try {
      const r = await api('gifts/list', { id, price });
      toast(`🏪 Выставлено на рынок за ${r.price} ₿ — получишь ${r.get} ₿, когда купят`, 4500);
      await openGifts(undefined, id);
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось выставить'); }
  }
  async function unlistGift(id) {
    try { await api('gifts/unlist', { id }); toast('Снято с продажи', 3000); await openGifts(undefined, gfOpen); } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось снять'); }
  }
  async function marketBuy(id) {
    const x = GF.market.find(m => m.id === id);
    if (!x || !confirm(`Купить ${x.i} ${x.t}${x.uniq ? ' #' + x.uniq.n : ''} у ${x.seller} за ${x.price} ₿?`)) return;
    try {
      const r = await api('gifts/mbuy', { id, price: x.price });
      if (r.game) onGame(r.game);
      toast(`🏪 ${x.i} ${x.t}${x.uniq ? ' #' + x.uniq.n : ''} — теперь у тебя`, 5000);
      await openGifts();
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось купить'); await openGifts(); }
  }
  function giftToast(g) {
    const t = document.createElement('div');
    t.className = 'ach-toast gift-toast';
    const from = gfFrom(g);
    t.innerHTML = `<span class="ach-icon">${g.uniq ? uniqTile(g, 'mini') : esc(g.i)}</span><span><small>Тебе подарок${from && from !== 'купил себе' ? ' ' + esc(from) : ''}</small>
      <b>${esc(g.t)}${g.uniq ? ' #' + g.uniq.n : ''}</b>${g.note ? `<small>«${esc(g.note)}»</small>` : ''}</span>`;
    t.addEventListener('click', () => openGifts(undefined, g.id));
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 5200);
  }
  /** Учитель начислил или снял биткоины — короткое уведомление с причиной, один раз. */
  function coinNotify(list) {
    if (!list || !list.length || TEACHER) return;
    list.forEach((c, i) => setTimeout(() => toast(c.reason === 'msell' ? `🏪 Твой подарок купили на рынке: +${c.delta} ₿ (покупатель — ${c.note})`
      : `${c.delta > 0 ? `➕ Учитель начислил ${c.delta} ₿` : `➖ Учитель снял ${-c.delta} ₿`}${c.note ? ` — «${c.note}»` : ''}`, 6000), 400 + i * 1200));
    api('gifts/seen', { coin_ids: list.map(c => c.id) }).catch(() => {});
  }
  /** Новые подарки (от учителя или одноклассника) — карточкой в углу, один раз. */
  function giftNotify(list) {
    if (!list || !list.length || TEACHER) return;
    list.slice(0, 3).forEach((g, i) => setTimeout(() => giftToast(g), 700 + i * 1700));
    if (list.length > 3) setTimeout(() => toast(`🎁 И ещё ${list.length - 3} — в «Биткоины и подарки»`, 5000), 700 + 3 * 1700);
    api('gifts/seen', { ids: list.map(g => g.id) }).catch(() => {});
  }
  /** Подарили или начислили биткоины — уведомление и новый счёт сразу. */
  async function giftLive() {
    let me;
    try { me = await api('me'); } catch (e) { return; }
    if (me.game) onGame(me.game);
    giftNotify(me.gifts_new);
    coinNotify(me.coin_news);
    if (GF && !gfOpen && !$('#forecastModal').hidden && $('#forecastBody .gf-grid, #forecastBody .gf-mine')) openGifts();
  }
  $('#coinCard')?.addEventListener('click', () => openGifts());
  $('#whoGifts')?.addEventListener('click', () => { setWhoMenu(false); openGifts(); });
  document.addEventListener('click', e => {
    const to = e.target.closest('[data-gift-to]');
    if (to) { openGifts(to.dataset.giftTo); return; }
    if (!GF || !e.target.closest('#forecastBody')) return;
    const b = e.target.closest('[data-gift], [data-gift-open], [data-gift-up], [data-gift-sell], [data-gftab], [data-gift-list], [data-gift-unlist], [data-mk-buy], #gfBack');
    if (!b || b.disabled) return;
    if (b.id === 'gfBack') { gfOpen = null; renderGifts(); return; }
    if (b.dataset.gftab) { gfTab = b.dataset.gftab; renderGifts(); return; }
    if (b.dataset.giftList) { listGift(+b.dataset.giftList); return; }
    if (b.dataset.giftUnlist) { unlistGift(+b.dataset.giftUnlist); return; }
    if (b.dataset.mkBuy) { marketBuy(+b.dataset.mkBuy); return; }
    if (b.dataset.giftOpen) { gfOpen = +b.dataset.giftOpen; renderGifts(); return; }
    if (b.dataset.giftUp) { upgradeGift(+b.dataset.giftUp); return; }
    if (b.dataset.giftSell) { sellGift(+b.dataset.giftSell); return; }
    buyGift(b.dataset.gift);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'gfTo') { gfTo = e.target.value; renderGifts(); }
  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'mkPrice' || !GF) return;
    const p = Math.round(+e.target.value || 0), el = $('#mkGet');
    if (el) el.textContent = p >= GF.market_min && p <= GF.market_max ? `получишь ${p - fee(p)} ₿ (комиссия ${Math.round(GF.market_fee * 100)}% сгорает)`
      : `цена — от ${GF.market_min} до ${GF.market_max} ₿`;
  });
  // ═══════ src/app/13-live.js
  // ------------------------------------------------------------ живые обновления (SSE)
  /* Сервер сам сообщает «поменялось»: comp — дуэли и турниры, asg — подборки от учителя, support — ответ техподдержки,
     rate — рейтинг класса (кто-то получил опыт), mine — ученик ответил в другой вкладке или на другом устройстве;
     страница перезапрашивает нужное.
     Одно соединение на браузер: вкладки решают через Web Locks, какая ведущая. Она держит /api/live и пересылает
     события остальным через BroadcastChannel; закрыли её — соединение подхватывает другая вкладка.
     Нет связи или браузер старый — работает прежний опрос (livePoll), только чаще. */
  const LV = { up: false, upAt: 0, sentAt: 0, chan: null, started: false, dirty: new Set(), timers: {}, was: false, gen: 0, ctrl: null };
  const liveOn = () => LV.up && Date.now() - LV.upAt < 70000;
  function liveStart() {
    if (LV.started || !SERVER || !student || TEACHER || !window.fetch || !window.ReadableStream || !window.TextDecoder) return;
    LV.started = true;
    const key = 'egeshka-live-' + student.sid;
    if ('BroadcastChannel' in window) {
      LV.chan = new BroadcastChannel(key);
      LV.chan.onmessage = e => liveMsg(e.data || {});
    }
    const gen = ++LV.gen;
    if (navigator.locks && LV.chan) {
      LV.chan.postMessage({ t: 'hi' });                 // ведущая уже есть — пусть скажет, что связь жива
      navigator.locks.request(key, () => liveConnect(gen)).catch(() => {});
    } else liveConnect(gen);                           // без замков у каждой вкладки своё соединение
  }
  /** Выход из аккаунта: закрыть соединение и канал — следующий ученик в этой вкладке получит своё. */
  function liveStop() {
    LV.gen++;
    if (LV.ctrl) LV.ctrl.abort();
    if (LV.chan) LV.chan.close();
    Object.assign(LV, { up: false, chan: null, started: false, lead: false, was: false, ctrl: null });
    LV.dirty.clear();
  }
  function liveMsg(m) {
    if (m.t === 'up') { LV.up = true; LV.upAt = Date.now(); }
    else if (m.t === 'down') LV.up = false;
    else if (m.t === 'hi' && LV.lead && liveOn()) LV.chan.postMessage({ t: 'up' });
    else if (m.t === 'ev') liveEvent(m.topic);
  }
  function liveMark(up) {
    const was = LV.up;
    LV.up = up; LV.upAt = Date.now();
    // остальным вкладкам — не чаще раза в 20 с, пока ничего не меняется
    if (LV.chan && (up !== was || Date.now() - LV.sentAt > 20000)) { LV.sentAt = Date.now(); LV.chan.postMessage({ t: up ? 'up' : 'down' }); }
  }
  async function liveConnect(gen) {
    if (gen !== LV.gen) return;                        // пока ждали замок, ученик вышел
    LV.lead = true;
    let delay = 3000;
    while (SERVER && student && !TEACHER && gen === LV.gen) {
      let got = false;
      try {
        LV.ctrl = new AbortController();
        const r = await fetch('api/live', { headers: { 'X-Token': student.token }, cache: 'no-store', signal: LV.ctrl.signal });
        if (r.status === 401) break;
        if (!r.ok || !r.body) throw new Error('live ' + r.status);
        const rd = r.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          liveMark(true);
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = (/^event: (\w+)$/m.exec(buf.slice(0, i)) || [])[1];
            buf = buf.slice(i + 2);
            if (ev === 'hello') {
              got = true;
              if (LV.was) { liveSend('comp'); liveSend('asg'); checkVersion(); }   // переподключились (сервер перезапускали?) — догнать пропущенное и проверить версию
              LV.was = true;
            } else if (ev) liveSend(ev);
          }
        }
      } catch (e) { /* сеть пропала — переподключимся */ }
      if (gen !== LV.gen) return;                      // вышли из аккаунта — соединение закрыто намеренно
      liveMark(false);
      delay = got ? 3000 : Math.min(delay * 2, 120000);
      await new Promise(res => setTimeout(res, delay + Math.random() * 2000));
    }
    if (gen === LV.gen) LV.lead = false;
  }
  function liveSend(topic) {
    if (LV.chan) LV.chan.postMessage({ t: 'ev', topic });
    liveEvent(topic);
  }
  /** Событие пришло: вкладка на виду — обновляем (пачку подряд — один раз), в фоне — когда на неё вернутся. */
  function liveEvent(topic) {
    if (document.hidden) { LV.dirty.add(topic); return; }
    clearTimeout(LV.timers[topic]);
    LV.timers[topic] = setTimeout(() => liveRun(topic), 80 + Math.random() * 400);    // не все ученики класса в одну миллисекунду
  }
  function liveRun(topic) {
    if (topic === 'comp') {
      if (DSEARCH.on) { clearTimeout(DSEARCH.timer); duelFind(); return; }     // ищешь соперника — проверить сразу: возможно, нашёлся
      liveAt = Date.now(); loadDuels(true);
    }
    else if (topic === 'rate') liveRate();
    else if (topic === 'mine') liveMine();
    else if (topic === 'asg') {
      // новая подборка для класса — одно короткое уведомление (личные подборки объявляет asgNotices)
      const had = new Set(ASG.map(a => a.id));
      loadAssignments().then(() => {
        const fresh = ASG.filter(a => !a.duel && !a.course && !a.personal && !a.closed && !had.has(a.id));
        if (fresh.length) toast(fresh.length === 1 ? `📚 Учитель выдал подборку «${fresh[0].title}» — она в «Подборках»` : `📚 Учитель выдал подборки: ${fresh.length}`, 6000);
        if (wkLive()) wkRefresh(wkLive());           // пишешь самостоятельную — вдруг учитель её завершил
      }).catch(() => {});
    }
    else if (topic === 'support') liveSupport();
    else if (topic === 'pyc') pycLive();
    else if (topic === 'gift') giftLive();
  }
  /** Ученик ответил в другой вкладке или на телефоне — здесь подтянуть опыт, уровень и плитки номеров.
      Вкладка, где ответили, свои данные уже знает — её не трогаем. */
  async function liveMine() {
    if (Date.now() - localWriteAt < 4000) return;
    try { const me = await api('me'); if (me.game) { GAME = me.game; renderLevel(); } } catch (e) { return; }
    try { await loadHistory(); } catch (e) { return; }
    renderSidebar(); renderTopbar();
  }
  /** Рейтинг класса поменялся: открытое окно «Рейтинг» обновляется сразу (та же вкладка),
      место на кнопке вверху — не чаще раза в 2 минуты, чтобы класс не засыпал сервер запросами. */
  let rateAt = 0;
  async function liveRate() {
    const isOpen = () => !$('#forecastModal').hidden && $('#forecastBody .lb-wrap') && ($('#forecastBody .fm-title') || {}).textContent === 'Рейтинг';
    const open = isOpen();
    if (!open && Date.now() - rateAt < 120000) return;
    rateAt = Date.now();
    await loadRating();
    const w = $('#forecastBody .lb-wrap');
    if (open && isOpen() && LB) {
      const on = w.querySelector('.lb-tabs .on');
      w.outerHTML = boardsHtml(LB, on ? on.dataset.lbtab : 'league');
    }
  }
  /** Учитель ответил в техподдержке: точка на кнопке, уведомление; окно поддержки открыто и черновика нет — обновить. */
  async function liveSupport() {
    const was = (SUPPORT && SUPPORT.unread) || 0;
    await loadSupport();
    if (SUPPORT && SUPPORT.unread > was) toast('🛟 Пришёл ответ техподдержки — открой «Техподдержку»', 6000);
    if (!$('#forecastModal').hidden && $('#spForm') && [...$('#forecastBody').querySelectorAll('textarea')].every(t => !t.value.trim())
      && ![...$('#forecastBody').querySelectorAll('[data-sp-box]')].some(b => b.spImg)) openSupport();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !LV.dirty.size) return;
    const ts = [...LV.dirty];
    LV.dirty.clear();
    ts.forEach(liveEvent);
  });
  // ═══════ src/app/14-boot.js
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
      liveStart();                                                     // живые обновления: одно соединение на браузер
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
  // время в техподдержке — московское, где бы ни был ученик и его часовой пояс
  const MSK_FMT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const mskTime = sec => MSK_FMT.format(new Date(sec * 1000)).replace(',', '') + ' МСК';
  const SP_STATUS = { new: ['chip', 'ждёт ответа'], answered: ['chip good', 'есть ответ'], closed: ['chip', 'закрыто'] };
  async function loadSupport() {
    const b = $('#supportBtn');
    if (!SERVER || !student) { if (b) b.hidden = true; return; }
    try { SUPPORT = await api('support'); } catch (e) { return; }
    b.hidden = false;
    $('#supportDot').hidden = !SUPPORT.unread;
  }
  // картинки в техподдержке: скриншот ошибки — кнопкой 📎 или вставкой Ctrl+V в поле
  const SP_IMG = new Map();                          // имя файла на сервере → blob-ссылка (картинку отдают только автору)
  const spImgHtml = name => (name ? `<button type="button" class="sp-img" data-sp-img="${esc(name)}" title="Открыть картинку"><img alt="картинка"></button>` : '');
  async function spLoadImgs(root) {
    for (const b of root.querySelectorAll('[data-sp-img]')) {
      const f = b.dataset.spImg;
      let url = SP_IMG.get(f);
      if (!url) {
        try {
          const r = await fetch('api/support/img?f=' + encodeURIComponent(f), { headers: { 'X-Token': student.token } });
          if (!r.ok) continue;
          url = URL.createObjectURL(await r.blob());
          SP_IMG.set(f, url);
        } catch (e) { continue; }
      }
      b.querySelector('img').src = url;
    }
  }
  /** Картинка из файла или буфера → JPEG не больше 1600 точек по стороне и ~1,4 МБ (данные о месте съёмки отбрасываются). */
  function spShrink(file) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) { rej(new Error('Это не картинка')); return; }
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(u);
        let q = 0.85, side = 1600, out = '';
        for (let i = 0; i < 5; i++) {
          const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', q);
          if (out.length * 0.75 < 1.4e6) break;
          q = Math.max(0.5, q - 0.1); side = Math.round(side * 0.8);
        }
        res(out);
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Не получилось открыть картинку')); };
      img.src = u;
    });
  }
  /** У поля ввода: кнопка 📎, вставка картинки через Ctrl+V, превью с крестиком. Картинка — в box.spImg. */
  function spAttach(box) {
    const ta = box.querySelector('textarea'), prev = box.querySelector('.sp-prev');
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
    box.appendChild(inp);
    const set = async file => {
      try { box.spImg = await spShrink(file); } catch (e) { toast(e.message, 3000); return; }
      prev.innerHTML = `<img src="${box.spImg}" alt="прикреплённая картинка"><button type="button" class="sp-prev-x" title="Убрать картинку">×</button>`;
      prev.hidden = false;
    };
    box.querySelector('[data-sp-pick]').addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { if (inp.files[0]) set(inp.files[0]); inp.value = ''; });
    ta.addEventListener('paste', e => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      if (!e.clipboardData.getData('text')) e.preventDefault();
      set(f);
    });
    prev.addEventListener('click', e => { if (e.target.closest('.sp-prev-x')) { box.spImg = null; prev.innerHTML = ''; prev.hidden = true; } });
  }
  const SP_PICK = '<button type="button" class="btn ghost sp-pick" data-sp-pick title="Прикрепить картинку — или вставь скриншот в поле через Ctrl+V">📎 Картинка</button><span class="sp-prev" hidden></span>';
  async function openSupport() {
    if (isNarrow()) setSideOpen(false);
    await loadSupport();
    const t = cur && cur.task && !courseShown ? cur.task : null;
    const kinds = Object.entries(SUPPORT.kinds || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    const list = SUPPORT.items.map(x => {
      const st = SP_STATUS[x.status] || SP_STATUS.new;
      const thread = (x.thread || [{ who: 'student', ts: x.ts, text: x.text }]).map(m => m.who === 'teacher'
        ? `<div class="sp-ans"><b>Учитель · ${mskTime(m.ts)}</b>${esc(m.text)}${spImgHtml(m.img)}</div>`
        : `<div class="sp-msg"><b>Ты · ${mskTime(m.ts)}</b>${esc(m.text)}${spImgHtml(m.img)}</div>`).join('');
      return `<div class="sp-item${x.answer && !x.seen ? ' unread' : ''}" data-sp="${x.id}"><div class="sp-head"><span class="${st[0]}">${st[1]}</span>
        <span>${esc((SUPPORT.kinds || {})[x.kind] || '')}</span>${x.task ? `<span>задание ${esc(x.task)}</span>` : ''}</div>
        <div class="sp-thread">${thread}</div>
        ${x.status === 'closed' ? '<p class="sp-closed">Тема закрыта. Если вопрос остался — напиши новое обращение выше.</p>'
          : `<div class="sp-reply" data-sp-box><textarea class="inp" rows="2" maxlength="2000" placeholder="Ответить в этой теме"></textarea>
          <div class="sp-row">${SP_PICK}<button type="button" class="btn" data-sp-reply>Отправить</button></div></div>`}</div>`;
    }).join('');
    $('#forecastBody').innerHTML = `<h2 class="fm-title">🛟 Техподдержка</h2>
      <p class="fm-note">Нашёл ошибку в задании, что-то не работает или есть вопрос — напиши. Можно приложить скриншот: кнопка «📎 Картинка» или Ctrl+V в поле. Обращение получит учитель, ответ появится здесь.</p>
      <form class="sp-form" id="spForm" data-sp-box>
        <select class="inp" id="spKind">${kinds}</select>
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Опиши, что случилось: что делал, что ожидал и что получилось" required></textarea>
        <div class="sp-row">${t ? `<label class="sp-att"><input type="checkbox" id="spTask" checked> приложить задание №${numLabel(t.n)} (${esc(t.id)})</label>` : '<span></span>'}
          ${SP_PICK}<button type="submit" class="btn primary">Отправить</button></div>
      </form>
      ${list ? `<h3 class="fm-sub">Мои обращения</h3><div class="sp-list">${list}</div>` : ''}`;
    $('#forecastModal').hidden = false;
    if (t) $('#spKind').value = 'task';
    $('#forecastBody').querySelectorAll('[data-sp-box]').forEach(spAttach);
    spLoadImgs($('#forecastBody'));
    $('#forecastBody').querySelectorAll('[data-sp-reply]').forEach(b => b.addEventListener('click', async () => {
      const box = b.closest('[data-sp]'), rep = box.querySelector('[data-sp-box]'), text = rep.querySelector('textarea').value.trim();
      if (!text && !rep.spImg) { toast('Напиши сообщение'); return; }
      b.disabled = true;
      try { await api('support/reply', { id: +box.dataset.sp, text, img: rep.spImg || null }); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); b.disabled = false; return; }
      toast('Сообщение отправлено', 2500);
      rep.querySelector('textarea').value = ''; rep.spImg = null;
      openSupport();
    }));
    $('#spForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      const body = { kind: $('#spKind').value, text: $('#spText').value, page: pageKind || (courseShown ? 'course' : ui.scope), img: $('#spForm').spImg || null };
      if (t && $('#spTask') && $('#spTask').checked) body.task = t.id;
      btn.disabled = true;                              // двойной клик — одно обращение
      try { await api('support', body); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); btn.disabled = false; return; }
      toast('Обращение отправлено — ответ появится в «Техподдержке»', 3500);
      $('#spText').value = ''; $('#spForm').spImg = null;
      openSupport();
    });
    if (SUPPORT.unread) { try { await api('support/seen', {}); } catch (e) { /* не страшно */ } SUPPORT.unread = 0; $('#supportDot').hidden = true; }
  }
  $('#supportBtn').addEventListener('click', openSupport);
  $('#forecastBody').addEventListener('click', e => {                 // картинку в техподдержке — открыть целиком
    const b = e.target.closest('[data-sp-img]');
    if (b && SP_IMG.get(b.dataset.spImg)) window.open(SP_IMG.get(b.dataset.spImg), '_blank');
  });

  // ------------------------------------------------------------ версия и что нового (новое — сверху)
  // Каждый коммит, который меняет что-то для учеников, — новая версия: новая возможность — второе число, исправление — третье.
  // история версий — в changelog.js (общая с панелью учителя): [версия, дата, добавлено[], изменено[]]
  const CHANGELOG = (window.EGE_CHANGELOG && window.EGE_CHANGELOG.student) || [['', '', [], []]];
  const versionBtn = $('#versionBtn');
  if (versionBtn) versionBtn.textContent = `Версия ${CHANGELOG[0][0]} · что нового`;
  versionBtn?.addEventListener('click', () => {
    if (isNarrow()) setSideOpen(false);
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Что нового</h2>
      <div class="changelog">${CHANGELOG.map(([v, d, added, changed], i) => `<section class="cl-ver${i ? '' : ' cl-now'}">
        <h3><span class="cl-num">${v}</span><span class="fm-muted">${d}</span>${i ? '' : '<span class="chip good">сейчас</span>'}</h3>
        ${(added || []).length ? `<div class="cl-kind cl-add">✨ Добавлено</div><ul>${added.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${(changed || []).length ? `<div class="cl-kind cl-chg">🔧 Изменено</div><ul>${changed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>`;
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
          await askConsent();                          // новая редакция документов — подтвердить перед занятиями
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
