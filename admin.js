/* Панель учителя: ученики, журнал попыток, лента, настройки. Работает только через server.py. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = x => Math.round(x * 100);
  const DAY = 864e5;
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  const pad = n => String(n).padStart(2, '0');
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  // дата: ДД.ММ, а если год не текущий — ДД.ММ.ГГ (иначе срок «05.04» не отличить от прошлогоднего)
  const fmtDate = ts => { const d = new Date(ts * 1000); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}${d.getFullYear() !== new Date().getFullYear() ? '.' + String(d.getFullYear()).slice(2) : ''}`; };
  // время обращений в техподдержку — московское
  const MSK_FMT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const mskTime = ts => MSK_FMT.format(new Date(ts * 1000)).replace(',', '') + ' МСК';
  const fmtTime = ts => { const d = new Date(ts * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtWhen = ts => {
    if (!ts) return '—';
    const d = new Date(ts * 1000), now = new Date();
    const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
    const mins = (Date.now() - ts * 1000) / 60000;
    if (mins < 2) return 'только что';
    if (mins < 60) return `${Math.round(mins)} мин назад`;
    if (days === 0) return `сегодня в ${fmtTime(ts)}`;
    if (days === 1) return `вчера в ${fmtTime(ts)}`;
    return `${fmtDate(ts)} в ${fmtTime(ts)}`;
  };
  const fmtSpent = ms => {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s} с` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
  };
  const fmtMinutes = ms => (ms < 60000 ? 'меньше минуты' : ms < 3600000 ? `${Math.round(ms / 60000)} мин`
    : `${Math.floor(ms / 3600000)} ч ${Math.round((ms % 3600000) / 60000)} мин`);
  const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  function toast(msg) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 2600);
  }

  /** Текст задания из чужих банков: без скриптов и обработчиков событий. */
  function safeHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    tpl.content.querySelectorAll('script,iframe,object,embed,frame,frameset,link,meta,base,form').forEach(n => n.remove());
    tpl.content.querySelectorAll('*').forEach(el => {
      for (const a of Array.from(el.attributes)) {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') el.removeAttribute(a.name);
        else if (['href', 'src', 'xlink:href', 'action'].includes(name)
          && /^(javascript|vbscript|data:text\/html)/i.test(a.value.replace(/[\u0000-\u001f\s]+/g, ''))) el.removeAttribute(a.name);
      }
    });
    return tpl.innerHTML;
  }

  // тема — общая с тренажёром
  (() => {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    btn.addEventListener('click', () => {
      const curTheme = document.documentElement.dataset.theme || (mq.matches ? 'dark' : 'light');
      const next = curTheme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('egeTrainer.theme', next); } catch (e) { /* не сохранится */ }
    });
  })();

  async function api(path, body) {
    const r = await fetch('api/admin/' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await r.json(); } catch (e) { /* пусто */ }
    if (r.status === 401) { showLogin(); throw Object.assign(new Error('auth'), { status: 401 }); }
    if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status });
    return data;
  }

  // ------------------------------------------------------------ результат попытки
  function resultOf(a) {
    const exam = a.reason === 'exam';
    const half = a.score === 0 && a.part === 0.5 ? ' · ½' : '';
    if (a.score === 1) return { cls: 'res-ok', text: exam ? 'вариант: верно' : 'верно', bad: false };
    if (a.score === 0.5) return { cls: 'res-half', text: 'со 2-й попытки', bad: false };
    if (exam) return { cls: 'res-bad', text: (a.answers && a.answers.length ? 'вариант: неверно' : 'вариант: нет ответа') + half, bad: true };
    if (a.gave_up) return { cls: 'res-gave', text: (a.revealed ? 'показал ответ' : 'сдался, ответ скрыт') + half, bad: true };
    if (a.abandoned) return { cls: 'res-bad', text: 'ушёл после ошибки' + half, bad: true };
    return { cls: 'res-bad', text: 'неверно' + half, bad: true };
  }
  /** Отметки попытки: ⚠ — ушёл со страницы на 30+ с и сразу ответил верно; 📋 — ответ вставлен из буфера. */
  const flagsOf = a => String(a.flags || '').split(',').filter(Boolean);
  function flagsHtml(a) {
    const f = flagsOf(a);
    return (f.includes('sus') ? ' <span class="flag sus" title="Ушёл со страницы на 30 секунд или дольше и сразу после возвращения ответил верно">⚠ ушёл и сразу верно</span>' : '')
      + (f.includes('paste') ? ' <span class="flag paste" title="Ответ не набран, а вставлен из буфера обмена (не из окна Python тренажёра)">📋 вставлен</span>' : '');
  }
  /** Подозрительно много показанных ответов: так выкачивают ответы, а не решают. */
  function suspicion(s) {
    const why = [];
    if (s.blocked_week) why.push(`упирался в лимит показа ответов ${s.blocked_week} ${plural(s.blocked_week, 'раз', 'раза', 'раз')}`);
    if (s.rev_week >= 30) why.push(`открыл ${s.rev_week} ответов за неделю`);
    else if (s.week >= 10 && s.rev_week / s.week >= 0.5) why.push(`ответ открыт в ${pct(s.rev_week / s.week)}% заданий`);
    return why;
  }
  function answersCell(a) {
    const arr = a.answers || [];
    if (!arr.length) return '<span class="muted">—</span>';
    return arr.map((x, i) => {
      const wrong = i < arr.length - 1 || a.score === 0;
      return wrong ? `<s>${esc(x)}</s>` : esc(x);
    }).join(' → ');
  }
  const idOf = taskId => String(taskId || '').split(':').slice(1).join(':') || taskId;
  const BANK_NAMES = { ege_bank: 'Банк ЕГЭ', kompege_bank: 'КомпЕГЭ', openfipi_bank: 'ФИПИ', egeshka_bank: 'Egeshka' };

  // ------------------------------------------------------------ вход
  function showLogin() {
    $('#appView').hidden = true;
    $('#loginView').hidden = false;
    setTimeout(() => $('#admPassword').focus(), 30);
  }
  // кто вошёл: главный учитель видит всех учеников и управляет учителями
  let ME = { is_main: 1 };
  let teachers = [];
  async function loadMe() {
    ME = await api('me');
    document.body.classList.toggle('is-main', !!ME.is_main);
    $('#admWho').textContent = ME.name + (ME.is_main ? ' · главный' : '');
    if (ME.is_main) { try { teachers = (await api('teachers')).teachers; } catch (e) { teachers = []; } }
    await askConsent();
  }
  // новая редакция документов: учитель тоже подтверждает согласие, иначе панель не открывается
  function askConsent() {
    if (!ME.consent_needed) return Promise.resolve();
    return new Promise(resolve => {
      const m = $('#admConsentModal'), ok = $('#acOk'), err = $('#acErr');
      const upd = () => { ok.disabled = !($('#acTerms').checked && $('#acConsent').checked); };
      $('#acTerms').onchange = upd;
      $('#acConsent').onchange = upd;
      upd();
      m.hidden = false;
      $('#admConsentForm').onsubmit = async e => {
        e.preventDefault();
        ok.disabled = true;
        err.textContent = '';
        try { await api('consent', { accept: true }); } catch (x) { err.textContent = x.message || 'Нет связи с сервером'; upd(); return; }
        ME.consent_needed = false;
        m.hidden = true;
        resolve();
      };
      $('#acOut').onclick = async () => {
        try { await api('logout', {}); } catch (x) { /* всё равно выходим */ }
        location.reload();
      };
    });
  }
  function showApp() {
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
  }
  $('#admLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    $('#admLoginErr').textContent = '';
    try {
      const r = await fetch('api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: $('#admLogin').value, password: $('#admPassword').value }), credentials: 'same-origin',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Ошибка входа');
      $('#admPassword').value = '';
      await loadMe();
      showApp();
      go('students');
      startFeed();
      api('info').then(showMediaWarning).catch(() => {});
    } catch (err) {
      $('#admLoginErr').textContent = err.message === 'Failed to fetch' ? 'Нет связи с сервером' : err.message;
    } finally {
      btn.disabled = false;
    }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('logout', {}); } catch (e) { /* всё равно выходим */ }
    location.reload();                 // с нуля: остановить опрос ленты и живое соединение прежнего учителя
  });

  // ------------------------------------------------------------ учитель решает как ученик
  // Сервер выдаёт учительский аккаунт ученика (без кода и пароля) и ставит его cookie — тренажёр открывается уже с входом
  $('#asStudentBtn').addEventListener('click', async () => {
    const w = window.open('', '_blank');
    try {
      const d = await api('as-student', {});
      try { localStorage.setItem('egeTrainer.student.v1', JSON.stringify({ sid: d.sid, name: d.name, token: d.token, at: Date.now() })); } catch (e) { /* нет доступа */ }
      if (w) w.location.href = './'; else location.href = './';
    } catch (err) { if (w) w.close(); if (err.status !== 401) toast(err.message); }
  });

  // ------------------------------------------------------------ статистика всего сайта (главный учитель)
  async function loadSite() {
    let d;
    try { d = await api('site-stats'); } catch (err) { if (err.status !== 401) $('#siteBody').innerHTML = `<p class="adm-empty">${esc(err.message)}</p>`; return; }
    const n = v => Number(v || 0).toLocaleString('ru-RU');
    const card = (k, v, sub, color) => `<div class="adm-card"><div class="k">${k}</div><div class="v"${color ? ` style="color:${color}"` : ''}>${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const maxS = Math.max(1, ...d.series.map(x => Math.max(x.solved, x.visitors, x.active)));
    const bars = d.series.map(x => {
      const [y, m, dd] = x.day.split('-');
      return `<div class="st-col" title="${dd}.${m}: решено ${x.solved}, занимались ${x.active}, посетителей ${x.visitors}">
        <div class="st-bars"><i class="b-solved" style="height:${x.solved / maxS * 100}%"></i><i class="b-active" style="height:${x.active / maxS * 100}%"></i><i class="b-vis" style="height:${x.visitors / maxS * 100}%"></i></div>
        <span>${dd}.${m}</span></div>`;
    }).join('');
    const maxN = Math.max(1, ...d.nums.map(x => x.answers));
    const nums = d.nums.map(x => `<div class="st-num" title="№${x.n}: ответов ${x.answers}, верных ${x.solved}">
        <b>${x.n}</b><i><s style="width:${x.answers / maxN * 100}%"></s><u style="width:${x.solved / maxN * 100}%"></u></i>
        <small>${n(x.answers)} · ${x.answers ? Math.round(x.solved / x.answers * 100) : 0}%</small></div>`).join('');
    $('#siteBody').innerHTML = `
      <div class="adm-cards">
        ${card('Онлайн сейчас', n(d.online), 'за последние 5 минут', d.online ? 'var(--good)' : '')}
        ${card('Пользователей', n(d.users), `+${n(d.new_today)} сегодня · +${n(d.new_week)} за неделю`)}
        ${card('Посетителей сегодня', n(d.visitors_today), `за 7 дней — ${n(d.visitors_week)} разных`)}
        ${card('Занимались', n(d.active_today), `сегодня · за неделю ${n(d.active_week)} · за месяц ${n(d.active_month)}`)}
        ${card('Решено заданий', n(d.solved), `за всё время · из ${n(d.answers)} ответов`)}
        ${card('Решено сегодня', n(d.solved_today), `за неделю — ${n(d.solved_week)}`)}
        ${card('С первой попытки', d.answers ? Math.round(d.first / d.answers * 100) + '%' : '—', `разных заданий решали: ${n(d.tasks)} из ${n(d.bank)}`)}
        ${card('Время на задания', n(d.hours) + ' ч', 'всего у всех учеников')}
        ${card('Варианты ЕГЭ', n(d.exams), d.exam_avg != null ? `средний балл ${d.exam_avg}` : 'ещё не решали')}
        ${card('Учителей', n(d.teachers), `курс открыт у ${n(d.course)} учеников · дуэлей ${n(d.duels)}`)}
      </div>
      <h3 class="adm-h3">По дням <span class="adm-hint"><i class="lg b-solved"></i> решено <i class="lg b-active"></i> занимались <i class="lg b-vis"></i> посетители</span></h3>
      <div class="st-chart">${bars}</div>
      <h3 class="adm-h3">По номерам ЕГЭ <span class="adm-hint">ответов за всё время · доля верных</span></h3>
      <div class="st-nums">${nums || '<p class="adm-empty">Ещё нет ответов.</p>'}</div>
      <h3 class="adm-h3">По учителям</h3>
      <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Учитель</th><th class="num">Учеников</th><th class="num">Занимались за неделю</th><th class="num">Решено за неделю</th></tr></thead>
        <tbody>${d.by_teacher.map(t => `<tr><td class="name">${esc(t.name)}${t.is_main ? ' <span class="muted">· главный</span>' : ''}</td><td class="num">${n(t.students)}</td><td class="num">${n(t.active_week)}</td><td class="num">${n(t.solved_week)}</td></tr>`).join('')}</tbody></table></div>
      ${supportHtml(d)}`;
  }
  // картинки в техподдержке: показываются по ссылке (только главному учителю); свою — кнопкой 📎 или Ctrl+V
  const spImg = name => (name ? `<a class="sp-a-img" href="api/admin/support/img?f=${encodeURIComponent(name)}" target="_blank" rel="noopener" title="Открыть картинку"><img src="api/admin/support/img?f=${encodeURIComponent(name)}" alt="картинка" loading="lazy"></a>` : '');
  /** Картинка → JPEG не больше 1600 точек и ~1,4 МБ (без данных о месте съёмки). */
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
  async function spSetImg(box, file) {
    try { box.spImg = await spShrink(file); } catch (e) { toast(e.message); return; }
    const prev = box.querySelector('.sp-prev');
    prev.innerHTML = `<img src="${box.spImg}" alt="прикреплённая картинка"><button type="button" class="sp-prev-x" title="Убрать картинку">×</button>`;
    prev.hidden = false;
  }
  $('#siteBody').addEventListener('paste', e => {
    const box = e.target.closest('[data-sp]');
    const f = box && [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type));
    if (!f) return;
    if (!e.clipboardData.getData('text')) e.preventDefault();
    spSetImg(box, f);
  });
  /** Обращения в техподдержку от учеников: новые сверху, ответ виден ученику на сайте. */
  const SP_ST = { new: ['new', 'новое'], answered: ['ans', 'отвечено'], closed: ['closed', 'закрыто'] };
  function supportHtml(d) {
    const list = d.support || [];
    const fresh = list.filter(x => x.status === 'new').length;
    const dt = mskTime;
    const items = list.map(x => `<div class="sp-a ${SP_ST[x.status] ? SP_ST[x.status][0] : ''}" data-sp="${x.id}">
      <div class="sp-a-head"><span class="sp-st">${(SP_ST[x.status] || SP_ST.new)[1]}</span><b>${esc(x.name)}</b>
        <span class="muted">${esc(x.teacher ? 'учитель: ' + x.teacher : '')}</span><span class="muted">${esc((d.support_kinds || {})[x.kind] || '')}</span>
        <span class="muted">${dt(x.ts)}</span>${x.task ? `<span class="muted">задание <button type="button" class="task-link" data-task="${esc(x.task)}"><code>${esc(x.task)}</code></button></span>` : ''}${x.page ? `<span class="muted">раздел: ${esc(x.page)}</span>` : ''}</div>
      ${(x.thread || [{ who: 'student', ts: x.ts, text: x.text }]).map(m => m.who === 'teacher'
        ? `<div class="sp-a-ans"><b>Ответ учителя · ${dt(m.ts)}</b>${esc(m.text)}${spImg(m.img)}</div>`
        : `<div class="sp-a-text"><b class="sp-a-who">${esc(x.name)} · ${dt(m.ts)}</b>${esc(m.text)}${spImg(m.img)}</div>`).join('')}
      ${x.status === 'closed' ? `<div class="sp-a-btns"><span class="muted">Тема закрыта — ученик может только создать новое обращение.</span>
          <button type="button" class="btn ghost" data-sp-reopen>Открыть снова</button><button type="button" class="btn ghost danger" data-sp-del>Удалить</button></div>`
        : `<div class="sp-a-form"><textarea class="inp" rows="2" maxlength="2000" placeholder="Ответ ученику (увидит в «Техподдержке» и сможет ответить в этой теме). Скриншот — Ctrl+V или 📎"></textarea>
        <div class="sp-a-btns"><button type="button" class="btn" data-sp-send>Ответить</button><button type="button" class="btn ghost" data-sp-pick title="Приложить картинку — или вставьте скриншот в поле через Ctrl+V">📎 Картинка</button><span class="sp-prev" hidden></span><button type="button" class="btn ghost" data-sp-close title="Ученик больше не сможет писать в эту тему">Закрыть тему</button>
          <button type="button" class="btn ghost danger" data-sp-del>Удалить</button></div></div>`}
    </div>`).join('');
    const closed = list.filter(x => x.status === 'closed').length;
    return `<h3 class="adm-h3">Обращения в техподдержку ${fresh ? `<span class="sp-badge">${fresh} ${fresh === 1 ? 'новое' : 'новых'}</span>` : ''}
        <span class="adm-hint">от учеников: кнопка «🛟 Техподдержка» на сайте</span>
        ${closed ? `<button type="button" class="btn ghost danger sp-clear" data-sp-clear>Удалить закрытые (${closed})</button>` : ''}</h3>
      <div class="sp-admin">${items || '<p class="adm-empty">Обращений пока нет.</p>'}</div>`;
  }
  $('#siteBody').addEventListener('click', async e => {
    const del = e.target.closest('[data-sp-del]'), clear = e.target.closest('[data-sp-clear]');
    if (del || clear) {
      const box = del && e.target.closest('[data-sp]');
      if (!confirm(clear ? 'Удалить все закрытые обращения? Это нельзя отменить.' : 'Удалить это обращение? Ученик его тоже больше не увидит.')) return;
      try { const r = await api('support/delete', clear ? { closed: true } : { id: +box.dataset.sp }); toast(clear ? `Удалено: ${r.deleted}` : 'Обращение удалено'); }
      catch (err) { toast(err.message); return; }
      loadSite();
      return;
    }
    const pick = e.target.closest('[data-sp-pick]'), unpick = e.target.closest('.sp-prev-x');
    if (pick) {
      const box = e.target.closest('[data-sp]'), inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', () => { if (inp.files[0]) spSetImg(box, inp.files[0]); });
      inp.click();
      return;
    }
    if (unpick) { const box = e.target.closest('[data-sp]'); box.spImg = null; const p = box.querySelector('.sp-prev'); p.innerHTML = ''; p.hidden = true; return; }
    const send = e.target.closest('[data-sp-send]'), close = e.target.closest('[data-sp-close]'), reopen = e.target.closest('[data-sp-reopen]');
    if (!send && !close && !reopen) return;
    const box = e.target.closest('[data-sp]');
    const ta = box.querySelector('textarea'), answer = ta ? ta.value.trim() : '';
    if (send && !answer && !box.spImg) { toast('Напишите ответ'); return; }
    if (close && !confirm(answer ? 'Отправить ответ и закрыть тему? Ученик больше не сможет писать в неё.' : 'Закрыть тему? Ученик больше не сможет писать в неё.')) return;
    try { await api('support/answer', { id: +box.dataset.sp, answer, img: box.spImg || null, close: !!close, reopen: !!reopen }); } catch (err) { toast(err.message); return; }
    toast(reopen ? 'Тема снова открыта' : close ? 'Тема закрыта' : 'Ответ отправлен');
    loadSite();
  });
  $('#siteReload').addEventListener('click', loadSite);


  // ------------------------------------------------------------ конструктор подборки
  // Слева — широкий фильтр по банку (номер, тип задания, сложность, банк, годы, решаемость, текст), справа — черновик.
  // Черновик живёт в браузере, пока его не отправят классу.
  const BLD_KEY = 'egeAdmin.bldDraft';
  const RANK_SHORT = ['', 'очень лёгкое', 'лёгкое', 'среднее', 'сложное', 'очень сложное'];
  const BLD = { cat: null, page: 0, res: null, timer: 0, asg: [],
    f: { n: [], c: [], r: [], bank: [], y0: '', y1: '', fmt: 'actual', rate: '', notsolved: '', q: '', sort: 'rank' },
    d: { class_id: '', id: null, title: '', due: '', tasks: [] } };
  try { const v = JSON.parse(localStorage.getItem(BLD_KEY)); if (v && Array.isArray(v.tasks)) BLD.d = Object.assign(BLD.d, v); } catch (e) { /* пусто */ }
  const bldSave = () => { try { localStorage.setItem(BLD_KEY, JSON.stringify(BLD.d)); } catch (e) { /* нет доступа */ } };
  const rankDots = r => r ? `<span class="rk rk${r}" title="Сложность ${r} из 5 — ${RANK_SHORT[r]}">${'●'.repeat(r)}${'○'.repeat(5 - r)}</span>` : '';
  const rateHtml = x => x.rate == null ? `<span class="muted" title="Ответов у учеников: ${x.tries || 0}">решают: мало данных</span>`
    : `<span class="bld-rate ${x.rate < 0.4 ? 'lo' : x.rate < 0.75 ? 'mid' : 'hi'}" title="${x.tries} ответов">решают ${Math.round(x.rate * 100)}%</span>`;

  async function openBuilder() {
    if (!BLD.cat) {
      try { BLD.cat = await api('bank/catalog'); } catch (err) { if (err.status !== 401) $('#bldFilters').innerHTML = `<p class="adm-empty">${esc(err.message)}</p>`; return; }
    }
    renderBldFilters();
    renderBldDraft();
    if (BLD.d.class_id) loadBldAsg();
    bldSearch();
  }
  function chip(group, val, label, on, count) {
    return `<button type="button" class="bld-chip${on ? ' on' : ''}" data-f="${group}" data-v="${esc(String(val))}">${label}${count != null ? ` <small>${count}</small>` : ''}</button>`;
  }
  function renderBldFilters() {
    const C = BLD.cat, f = BLD.f, fc = (BLD.res && BLD.res.facets) || { c: {}, r: {} };
    const nums = [];
    for (let n = 1; n <= 27; n++) if (n !== 20 && n !== 21) nums.push(chip('n', n, n === 19 ? '19–21' : n, f.n.includes(String(n))));
    const types = f.n.length ? f.n.map(n => `<div class="bld-types"><b>№${n === '19' ? '19–21' : n}</b>${(C.clusters[n] || []).map(([k, lbl]) => {
      const key = `${n}:${k}`;
      return chip('c', key, esc(lbl), f.c.includes(key), fc.c[key] || 0);
    }).join('')}</div>`).join('') : '<span class="adm-hint">Выберите номер — появятся типы заданий внутри него.</span>';
    const sel = (id, opts, val) => `<select class="adm-select" id="${id}">${opts.map(([v, t]) => `<option value="${esc(String(v))}"${String(v) === String(val) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const years = [['', 'любой']].concat(C.years.map(y => [y, y]));
    $('#bldFilters').innerHTML = `
      <div class="bld-row"><span class="bld-lbl">Номер</span><div class="bld-chips">${nums.join('')}</div></div>
      <div class="bld-row"><span class="bld-lbl">Тип</span><div class="bld-chips col">${types}</div></div>
      <div class="bld-row"><span class="bld-lbl">Сложность</span><div class="bld-chips">${[1, 2, 3, 4, 5].map(r => chip('r', r, `${rankDots(r)} ${RANK_SHORT[r]}`, f.r.includes(String(r)), fc.r[r] || 0)).join('')}</div></div>
      <div class="bld-row"><span class="bld-lbl">Банк</span><div class="bld-chips">${C.banks.map(b => chip('bank', b.id, esc(b.title), f.bank.includes(b.id), b.count)).join('')}</div></div>
      <div class="bld-row bld-sel">
        <label>Годы ${sel('bldY0', years, f.y0)} — ${sel('bldY1', years, f.y1)}</label>
        <label>Формат ${sel('bldFmt', [['actual', 'актуальный'], ['old', 'только старый'], ['all', 'любой']], f.fmt)}</label>
        <label>Решают ${sel('bldRate', [['', 'любые'], ['lo', 'трудные: < 40%'], ['mid', 'средние: 40–75%'], ['hi', 'простые: ≥ 75%'], ['none', 'ещё никто не решал']], f.rate)}</label>
        <label>Класс ещё не решал ${sel('bldNot', [['', '—']].concat(C.classes.map(c => [c.id, c.name])), f.notsolved)}</label>
        <input class="inp" id="bldQ" placeholder="Текст условия, например «Черепаха» или «маска»" value="${esc(f.q)}">
      </div>`;
  }
  async function bldSearch(keepPage, pool) {
    const f = BLD.f;
    if (!keepPage) BLD.page = 0;
    const p = new URLSearchParams({ n: f.n.join(','), c: f.c.join(','), r: f.r.join(','), bank: f.bank.join(','), y0: f.y0, y1: f.y1,
      fmt: f.fmt, rate: f.rate, notsolved: f.notsolved, q: f.q, sort: f.sort, page: BLD.page });
    if (pool) p.set('pool', '1');
    let d;
    try { d = await api('bank/search?' + p.toString()); } catch (err) { if (err.status !== 401) toast(err.message); return null; }
    if (pool) return d.pool || [];
    BLD.res = d;
    renderBldFilters();
    renderBldList();
    return d;
  }
  function renderBldList() {
    const d = BLD.res, inDraft = new Set(BLD.d.tasks.map(t => t.id));
    $('#bldBar').innerHTML = `<b>Найдено: ${d.total}</b>
      <label class="adm-hint">порядок <select class="adm-select" id="bldSort">${[['rank', 'по номеру и сложности ↑'], ['hard', 'по номеру, сначала сложные'], ['rate', 'сначала трудные для учеников'], ['new', 'сначала новые'], ['random', 'случайно']]
        .map(([v, t]) => `<option value="${v}"${BLD.f.sort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <span class="bld-bar-act"><input class="inp" type="number" id="bldK" min="1" max="50" value="5"> <button type="button" class="btn" id="bldRand"${d.total ? '' : ' disabled'}>+ случайных из найденных</button>
      <button type="button" class="btn" id="bldPerN"${d.total ? '' : ' disabled'} title="Из найденных — столько случайных заданий каждого номера">+ по стольку на каждый номер</button>
      <button type="button" class="btn ghost" id="bldAddPage"${d.tasks.length ? '' : ' disabled'}>+ все на странице</button>
      <button type="button" class="btn ghost" id="bldVariant" title="По одному случайному заданию на каждый номер 1–27 из общего банка (актуальные)">Вариант ЕГЭ</button></span>`;
    $('#bldList').innerHTML = d.tasks.length ? d.tasks.map(x => `<div class="bld-item${inDraft.has(x.id) ? ' in' : ''}">
        <span class="num-badge sm">${x.n === 19 ? '19–21' : x.n}</span>
        <div class="bld-item-main"><div class="bld-meta"><b>${esc(x.cname)}</b> ${rankDots(x.r)} ${rateHtml(x)}
          <span class="muted">${esc(x.bank || '')}${x.y ? ' · ' + x.y : ''}${x.old ? ' · старый формат' : ''}</span></div>
          <div class="bld-snip">${esc(x.snip)}</div></div>
        <span class="bld-item-act"><button type="button" class="link-btn" data-task="${esc(x.id)}">открыть</button>
          <button type="button" class="btn ${inDraft.has(x.id) ? 'ghost' : 'primary'} bld-add" data-add="${esc(x.id)}">${inDraft.has(x.id) ? '✓ в подборке' : '+ добавить'}</button></span>
      </div>`).join('') : '<p class="adm-empty">Ничего не найдено — ослабьте фильтры.</p>';
    const pages = Math.ceil(d.total / d.per);
    $('#bldPages').innerHTML = pages > 1 ? `<button type="button" class="btn ghost" data-page="${d.page - 1}"${d.page ? '' : ' disabled'}>← назад</button>
      <span class="adm-hint">страница ${d.page + 1} из ${pages}</span>
      <button type="button" class="btn ghost" data-page="${d.page + 1}"${d.page + 1 < pages ? '' : ' disabled'}>дальше →</button>` : '';
  }
  const slim = x => ({ id: x.id, n: x.n, c: x.c, cname: x.cname, r: x.r, snip: x.snip, rate: x.rate });
  function bldAdd(list) {
    const have = new Set(BLD.d.tasks.map(t => t.id));
    let k = 0;
    for (const x of list) {
      if (have.has(x.id) || BLD.d.tasks.length >= 100) continue;
      BLD.d.tasks.push(slim(x)); have.add(x.id); k++;
    }
    bldSave(); renderBldDraft(); if (BLD.res) renderBldList();
    return k;
  }
  async function loadBldAsg() {
    BLD.asg = [];
    BLD.members = [];
    if (!BLD.d.class_id) return;
    try {
      const [a, m] = await Promise.all([api('assignments?class_id=' + BLD.d.class_id), api('students?class_id=' + BLD.d.class_id)]);
      BLD.asg = a.assignments || [];
      BLD.members = (m.students || []).map(x => ({ id: x.id, name: x.name })).sort((x, y) => x.name.localeCompare(y.name, 'ru'));
    } catch (e) { BLD.asg = []; }
    renderBldDraft();
  }
  function renderBldDraft() {
    const D = BLD.d, C = BLD.cat;
    if (!C) return;
    const byN = {}, byR = [0, 0, 0, 0, 0, 0];
    D.tasks.forEach(t => { byN[t.n] = (byN[t.n] || 0) + 1; if (t.r) byR[t.r]++; });
    const total = D.tasks.length;
    $('#bldDraft').innerHTML = `<h3 class="adm-h3" style="margin:0">${D.id ? 'Изменить подборку' : 'Новая подборка'}</h3>
      <label class="bld-f">Класс <select class="adm-select" id="bdClass"><option value="">— выберите —</option>${C.classes.map(c => `<option value="${c.id}"${String(c.id) === String(D.class_id) ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      ${D.class_id && BLD.asg.length ? `<label class="bld-f">Изменить готовую <select class="adm-select" id="bdLoad"><option value="">— новая подборка —</option>${BLD.asg.map(a => `<option value="${a.id}"${a.id === D.id ? ' selected' : ''}>${esc(a.title)} (${a.tasks.length})</option>`).join('')}</select></label>` : ''}
      <input class="inp" id="bdTitle" maxlength="80" placeholder="Название, например «№5: двоичная запись»" value="${esc(D.title)}">
      <label class="bld-f">Срок <input class="inp" type="date" id="bdDue" value="${esc(D.due || '')}"${D.id ? '' : ` min="${todayIso()}"`}></label>
      ${D.class_id && !D.id ? `<div class="bld-to"><span class="bld-f">Кому</span>
        <label><input type="radio" name="bdTo" value="class"${D.to !== 'some' ? ' checked' : ''}> всему классу</label>
        <label><input type="radio" name="bdTo" value="some"${D.to === 'some' ? ' checked' : ''}> <b class="pers-tag">персонально</b> — выбранным ученикам</label>
        ${D.to === 'some' ? `<div class="bld-who">${(BLD.members || []).map(m => `<label><input type="checkbox" data-who="${m.id}"${(D.students || []).includes(m.id) ? ' checked' : ''}> ${esc(m.name)}</label>`).join('') || '<span class="adm-hint">В классе нет учеников</span>'}</div>
          <p class="adm-hint">Подборку увидят только выбранные — у них она отмечена зелёной надписью «Персональная подборка». В журнале класса — отдельная колонка.</p>` : ''}</div>` : ''}
<label class="adm-hint">Тип работы <select class="adm-select" id="bdKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${(D.kind || 'self') === k ? ' selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <p class="adm-hint" id="bdKindHint">${KINDS[D.kind || 'self'].hint}</p>
      <div class="bld-sum"><b>${total} ${plural(total, 'задание', 'задания', 'заданий')}</b>
        ${Object.keys(byN).sort((a, b) => a - b).map(n => `<span class="chip">№${n}${byN[n] > 1 ? ' ×' + byN[n] : ''}</span>`).join('')}</div>
      ${total ? `<div class="bld-rbar" title="Распределение по сложности">${byR.map((c, r) => r && c ? `<i class="rk${r}" style="flex:${c}" title="${RANK_SHORT[r]}: ${c}"></i>` : '').join('')}</div>` : ''}
      <ol class="bld-dlist">${D.tasks.map((t, i) => `<li><span class="num-badge sm">${t.n === 19 ? '19–21' : t.n}</span>
        <button type="button" class="task-link" data-task="${esc(t.id)}" title="${esc(t.snip || '')}">${esc(t.cname || '')} ${rankDots(t.r)}<small>${esc((t.snip || '').slice(0, 70))}…</small></button>
        <span class="bld-dtools"><button type="button" class="link-btn" data-mv="${i}:-1" title="Выше">↑</button><button type="button" class="link-btn" data-mv="${i}:1" title="Ниже">↓</button>
        <button type="button" class="link-btn danger" data-del="${i}" title="Убрать">×</button></span></li>`).join('')}</ol>
      ${total ? '' : '<p class="adm-hint">Добавляйте задания слева: по одному, все со страницы или случайные из найденного.</p>'}
      ${total > 1 ? `<div class="bld-tools"><button type="button" class="link-btn" data-sortd="rank">по сложности ↑</button>
        <button type="button" class="link-btn" data-sortd="num">по номерам</button><button type="button" class="link-btn" data-sortd="shuffle">перемешать</button>
        <button type="button" class="link-btn danger" data-sortd="clear">очистить</button></div>` : ''}
      <button type="button" class="btn primary bld-send" id="bdSend"${total && D.class_id && (D.to !== 'some' || D.id || (D.students || []).length) ? '' : ' disabled'}>${D.id ? 'Сохранить изменения' : D.to === 'some' ? `Отправить персонально (${(D.students || []).length})` : 'Отправить классу'}</button>
      ${D.class_id ? '' : '<p class="adm-hint">Выберите класс, которому отправить подборку.</p>'}`;
  }
  $('#bldFilters').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const arr = BLD.f[b.dataset.f], v = b.dataset.v, i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    if (b.dataset.f === 'n') BLD.f.c = BLD.f.c.filter(k => BLD.f.n.includes(k.split(':')[0]));   // типы — только выбранных номеров
    bldSearch();
  });
  $('#bldFilters').addEventListener('change', e => {
    const m = { bldY0: 'y0', bldY1: 'y1', bldFmt: 'fmt', bldRate: 'rate', bldNot: 'notsolved' }[e.target.id];
    if (m) { BLD.f[m] = e.target.value; bldSearch(); }
  });
  $('#bldFilters').addEventListener('input', e => {
    if (e.target.id !== 'bldQ') return;
    BLD.f.q = e.target.value;
    clearTimeout(BLD.timer);
    BLD.timer = setTimeout(() => { bldSearch().then(() => { const q = $('#bldQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }); }, 400);
  });
  $('#bldReset').addEventListener('click', () => {
    BLD.f = { n: [], c: [], r: [], bank: [], y0: '', y1: '', fmt: 'actual', rate: '', notsolved: '', q: '', sort: BLD.f.sort };
    bldSearch();
  });
  $('#bldBar').addEventListener('change', e => { if (e.target.id === 'bldSort') { BLD.f.sort = e.target.value; bldSearch(); } });
  $('#bldBar').addEventListener('click', async e => {
    if (e.target.closest('#bldAddPage')) { toast(`Добавлено: ${bldAdd(BLD.res.tasks)}`); return; }
    if (e.target.closest('#bldPerN') || e.target.closest('#bldVariant')) {
      const variant = !!e.target.closest('#bldVariant');
      const k = variant ? 1 : Math.max(1, Math.min(20, +$('#bldK').value || 1));
      let pool;
      if (variant) {                       // вариант — из всего актуального банка, без фильтров
        const saved = BLD.f;
        BLD.f = { n: [], c: [], r: [], bank: [], y0: '', y1: '', fmt: 'actual', rate: '', notsolved: saved.notsolved, q: '', sort: 'random' };
        pool = await bldSearch(true, true);
        BLD.f = saved;
      } else pool = await bldSearch(true, true);
      if (!pool) return;
      const have = new Set(BLD.d.tasks.map(t => t.id)), byN = {};
      for (const x of pool) if (!have.has(x.id)) (byN[x.n] = byN[x.n] || []).push(x);
      const add = [];
      for (const n of Object.keys(byN).sort((a, b) => a - b)) {
        const l = byN[n];
        for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
        add.push(...l.slice(0, k));
      }
      const n = bldAdd(add);
      if (variant && !BLD.d.title) { BLD.d.title = 'Вариант ЕГЭ'; bldSave(); renderBldDraft(); }
      toast(n ? `Добавлено: ${n}${variant ? ' — по одному на номер' : ` — по ${k} на номер`}` : 'Все подходящие задания уже в подборке');
      return;
    }
    if (e.target.closest('#bldRand')) {
      const k = Math.max(1, Math.min(50, +$('#bldK').value || 5));
      const pool = await bldSearch(true, true);
      if (!pool) return;
      const have = new Set(BLD.d.tasks.map(t => t.id));
      const free = pool.filter(x => !have.has(x.id));
      for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
      const n = bldAdd(free.slice(0, k));
      toast(n ? `Добавлено случайных: ${n}` : 'Все найденные задания уже в подборке');
    }
  });
  $('#bldList').addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const id = b.dataset.add;
    const i = BLD.d.tasks.findIndex(t => t.id === id);
    if (i >= 0) { BLD.d.tasks.splice(i, 1); bldSave(); renderBldDraft(); renderBldList(); return; }
    bldAdd([BLD.res.tasks.find(x => x.id === id)]);
  });
  $('#bldPages').addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) { BLD.page = +b.dataset.page; bldSearch(true); window.scrollTo({ top: 0 }); }
  });
  $('#bldDraft').addEventListener('input', e => {
    if (e.target.id === 'bdTitle') { BLD.d.title = e.target.value; bldSave(); }
    if (e.target.id === 'bdDue') { BLD.d.due = e.target.value; bldSave(); }
  });
  $('#bldDraft').addEventListener('change', e => {
    if (e.target.id === 'bdClass') { BLD.d.class_id = e.target.value; BLD.d.id = null; BLD.d.students = []; bldSave(); renderBldDraft(); loadBldAsg(); }
    if (e.target.name === 'bdTo') { BLD.d.to = e.target.value; bldSave(); renderBldDraft(); }
    if (e.target.dataset.who) {
      const id = +e.target.dataset.who, l = BLD.d.students = (BLD.d.students || []).filter(x => x !== id);
      if (e.target.checked) l.push(id);
      bldSave(); renderBldDraft();
    }
    if (e.target.id === 'bdLoad') {
      const a = BLD.asg.find(x => String(x.id) === e.target.value);
      if (!a) { Object.assign(BLD.d, { id: null, title: '', due: '', tasks: [] }); }
      else {
        Object.assign(BLD.d, { id: a.id, title: a.title, kind: a.kind || 'self', due: a.due ? new Date(a.due * 1000).toISOString().slice(0, 10) : '',
          tasks: a.tasks.filter(t => !t.missing).map(t => ({ id: t.id, n: t.n, c: t.c, cname: t.cname || '', r: t.r, snip: t.snip })) });
      }
      bldSave(); renderBldDraft(); if (BLD.res) renderBldList();
    }
  });
  $('#bldDraft').addEventListener('click', async e => {
    const D = BLD.d;
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const [i, dir] = mv.dataset.mv.split(':').map(Number), j = i + dir;
      if (j >= 0 && j < D.tasks.length) { [D.tasks[i], D.tasks[j]] = [D.tasks[j], D.tasks[i]]; bldSave(); renderBldDraft(); }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { D.tasks.splice(+del.dataset.del, 1); bldSave(); renderBldDraft(); if (BLD.res) renderBldList(); return; }
    const so = e.target.closest('[data-sortd]');
    if (so) {
      const k = so.dataset.sortd;
      if (k === 'rank') D.tasks.sort((a, b) => (a.r || 3) - (b.r || 3) || a.n - b.n);
      if (k === 'num') D.tasks.sort((a, b) => a.n - b.n || (a.r || 3) - (b.r || 3));
      if (k === 'shuffle') for (let i = D.tasks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [D.tasks[i], D.tasks[j]] = [D.tasks[j], D.tasks[i]]; }
      if (k === 'clear' && confirm('Убрать все задания из черновика?')) D.tasks = [];
      bldSave(); renderBldDraft(); if (BLD.res) renderBldList();
      return;
    }
    if (e.target.closest('#bdSend')) {
      if (!D.title.trim()) { toast('Введите название подборки'); $('#bdTitle').focus(); return; }
      try {
        const pers = !D.id && D.to === 'some';
        const prevKind = D.id && ((BLD.asg || []).find(x => x.id === D.id) || {}).kind;
        if (!kindChangeOk(prevKind, D.kind || 'self')) return;
        const r = await api('assignment/save', { id: D.id, class_id: +D.class_id, title: D.title, kind: D.kind || 'self', grading: grades(),
          due: D.due ? new Date(D.due + 'T23:59:00').getTime() / 1000 : null, tasks: D.tasks.map(t => t.id),
          students: pers ? D.students : null });
        const cls = (BLD.cat.classes.find(c => String(c.id) === String(D.class_id)) || {}).name || '';
        toast(D.id ? 'Подборка сохранена' + keptNote(r) : pers ? `Персональная подборка отправлена: ${D.students.length} ${plural(D.students.length, 'ученику', 'ученикам', 'ученикам')}` : `Подборка отправлена классу ${cls}`);
        BLD.d = { class_id: D.class_id, id: null, title: '', due: '', tasks: [], to: D.to, students: [] };
        bldSave(); renderBldDraft(); loadBldAsg(); if (BLD.res) renderBldList();
      } catch (err) { if (err.status !== 401) toast(err.message); }
    }
  });


  // ------------------------------------------------------------ прогресс курса (главный учитель)
  const CP = { d: null, open: null, detail: {} };
  const CP_SETS = ['warm', 'base', 'exam', 'hard', 'test'];
  const pctColor = p => p >= 75 ? 'var(--good)' : p >= 40 ? 'var(--mid)' : p > 0 ? 'var(--weak)' : 'var(--muted)';
  async function loadCourseProgress() {
    try { CP.d = await api('course/progress'); } catch (err) { if (err.status !== 401) $('#cpBody').innerHTML = `<p class="adm-empty">${esc(err.message)}</p>`; return; }
    CP.detail = {};
    renderCourseProgress();
  }
  function cpBar(done, total, bad) {
    const w = total ? done / total * 100 : 0, wb = total ? (bad || 0) / total * 100 : 0;
    return `<span class="cp-bar" title="решено ${done} из ${total}${bad ? `, с ошибкой ${bad}` : ''}"><i style="width:${w}%"></i><u style="left:${w}%;width:${wb}%"></u></span>`;
  }
  function renderCourseProgress() {
    const d = CP.d, q = ($('#cpFind').value || '').trim().toLowerCase();
    if (!d.lessons.length) { $('#cpBody').innerHTML = '<p class="adm-empty">В курсе пока нет уроков с презентацией (папка course/).</p>'; return; }
    const S = d.students.filter(s => !q || s.name.toLowerCase().includes(q));
    const week = Date.now() / 1000 - 7 * 86400;
    const avg = d.students.length ? Math.round(d.students.reduce((a, s) => a + s.pct, 0) / d.students.length) : 0;
    const finished = d.students.filter(s => d.lessons.every(L => { const t = s.lessons[L.n].sets.test; return t && t.total && t.done === t.total; })).length;
    const card = (k, v, sub, color) => `<div class="adm-card"><div class="k">${k}</div><div class="v"${color ? ` style="color:${color}"` : ''}>${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const heads = d.lessons.map(L => `<th class="cp-l">№${L.n}: презентация</th>${CP_SETS.map(k => `<th class="num">${esc(d.set_names[k])}</th>`).join('')}`).join('');
    const rows = S.map(s => {
      const cells = d.lessons.map(L => {
        const x = s.lessons[L.n];
        return `<td class="cp-l">${cpBar(x.seen, x.slides)} <small>${x.seen}/${x.slides}</small></td>` + CP_SETS.map(k => {
          const v = x.sets[k] || { done: 0, bad: 0, total: 0 };
          return `<td class="num"><b style="color:${pctColor(v.total ? v.done / v.total * 100 : 0)}">${v.done}</b><small>/${v.total}</small>${v.bad ? `<em class="cp-bad" title="с ошибкой">${v.bad}</em>` : ''}</td>`;
        }).join('');
      }).join('');
      const last = Math.max(s.last_task || 0, 0);
      return `<tr class="cp-row${CP.open === s.id ? ' on' : ''}" data-cp="${s.id}"><td class="name">${esc(s.name)}<small>${esc(s.class || 'без класса')} · ${esc(s.teacher)}</small></td>
        <td class="muted">${s.opened ? fmtDate(s.opened) : ''}</td>${cells}
        <td class="num"><b class="cp-pct" style="color:${pctColor(s.pct)}">${s.pct}%</b></td>
        <td class="muted">${last ? fmtWhen(last) : '—'}</td></tr>
        ${CP.open === s.id ? `<tr class="cp-detail"><td colspan="${4 + d.lessons.length * 6}">${cpDetailHtml(s.id)}</td></tr>` : ''}`;
    }).join('');
    $('#cpBody').innerHTML = `<div class="adm-cards">
        ${card('В курсе', d.students.length, 'учеников открыли курс паролем')}
        ${card('Средний прогресс', avg + '%', 'презентации + подборки', pctColor(avg))}
        ${card('Прошли контрольную', finished, 'решили все 20 заданий контрольной')}
        ${card('Занимались за неделю', d.students.filter(s => (s.last_task || 0) >= week).length, 'решали задания из подборок курса')}
      </div>
      <div class="adm-table-wrap" style="margin-top:12px"><table class="adm-table cp-table"><thead><tr><th>Ученик</th><th>Открыл курс</th>${heads}<th class="num">Итог</th><th>Последнее решение</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${4 + d.lessons.length * 6}" class="adm-empty">${d.students.length ? 'Никого не найдено' : 'Курс пока никто не открыл — сообщите ученикам пароль курса (вкладка «Настройки»).'}</td></tr>`}</tbody></table></div>`;
  }
  function cpDetailHtml(sid) {
    const x = CP.detail[sid];
    if (!x) return '<p class="adm-hint">Загружаю…</p>';
    return CP.d.lessons.map(L => {
      const l = x.lessons[L.n];
      return `<div class="cp-lesson"><b>Урок №${L.n}</b> <span class="adm-hint">презентация: ${l.seen} из ${l.slides} слайдов</span>
        <div class="cp-sets">${CP_SETS.map(k => {
          const v = l.sets[k];
          if (!v) return '';
          return `<div class="cp-set"><div class="cp-set-h"><b>${esc(CP.d.set_names[k])}</b> <span>${v.done}/${v.total}${v.bad ? ` · <em class="cp-bad">${v.bad} с ошибкой</em>` : ''}</span></div>
            <div class="cp-sqs">${(v.tasks || []).map((t, i) => `<button type="button" class="cp-sq ${t.st}" data-task="${esc(t.id)}" title="${i + 1}. ${esc(t.snip)}">${i + 1}</button>`).join('')}</div></div>`;
        }).join('')}</div></div>`;
    }).join('');
  }
  $('#cpBody').addEventListener('click', async e => {
    if (e.target.closest('[data-task]')) return;            // клик по квадратику открывает задание
    const r = e.target.closest('[data-cp]');
    if (!r) return;
    const id = +r.dataset.cp;
    CP.open = CP.open === id ? null : id;
    renderCourseProgress();
    if (CP.open && !CP.detail[id]) {
      try { CP.detail[id] = (await api('course/progress?id=' + id)).students[0]; } catch (err) { if (err.status !== 401) toast(err.message); return; }
      if (CP.open === id) renderCourseProgress();
    }
  });
  $('#cpFind').addEventListener('input', () => { if (CP.d) renderCourseProgress(); });
  $('#cpReload').addEventListener('click', loadCourseProgress);

  // ------------------------------------------------------------ турниры и дуэли: архив
  let COMP = null;
  async function loadComp() {
    try { COMP = await api('competitions'); } catch (err) { if (err.status !== 401) $('#compBody').innerHTML = `<p class="adm-empty">${esc(err.message)}</p>`; return; }
    renderComp();
  }
  function renderComp() {
    if (!COMP) return;
    const q = $('#compFind').value.trim().toLowerCase();
    const has = (...names) => !q || names.some(n => String(n || '').toLowerCase().includes(q));
    const when = ts => ts ? new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const MED = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const sus = f => f && f.length ? ` <span class="comp-sus" title="${esc(f.join(', '))}">⚠ ${esc(f.join(', '))}</span>` : '';
    const tours = COMP.tournaments.filter(t => has(...t.players.map(p => p.name)));
    const tourHtml = tours.map(t => {
      const anySus = t.matches.some(m => (m.sus_a || []).length || (m.sus_b || []).length);
      const pod = t.players.filter(p => p.place && p.place <= 3).map(p => `${MED[p.place]} ${esc(p.name)}${p.xp ? ` <span class="muted">+${p.xp} XP</span>` : ''}`).join(' · ');
      const ms = t.matches.map(m => `<tr><td>${esc(m.stage)}</td><td${m.winner === m.a ? ' class="ok"' : ''}>${esc(m.a)}${sus(m.sus_a)}</td>
        <td class="num">${m.status === 'done' ? `${m.a_solved ?? 0} : ${m.b_solved ?? 0}` : 'идёт'}</td><td${m.winner === m.b ? ' class="ok"' : ''}>${esc(m.b)}${sus(m.sus_b)}</td>
        <td class="muted">${m.admin ? `✋ ${esc(m.admin)}` : m.status !== 'done' ? '' : m.tech ? 'тех. результат' : m.winner ? '' : 'ничья'}</td>
        <td class="comp-act">${m.cur ? `<button type="button" class="link-btn" data-cm="${m.id}:a" title="Засчитать техническую победу">победа ${esc(m.a.split(' ')[0])}</button>
          <button type="button" class="link-btn" data-cm="${m.id}:b" title="Засчитать техническую победу">победа ${esc(m.b.split(' ')[0])}</button>
          <button type="button" class="link-btn" data-cm="${m.id}:replay" title="Обнулить матч и выдать новые задания">переиграть</button>` : ''}</td></tr>`).join('');
      const places = t.players.map(p => `<li>${p.place ? `${p.place}.` : '—'} ${esc(p.name)}${p.grp ? ` <span class="muted">гр. ${esc(p.grp)}</span>` : ''}${p.xp ? ` <span class="muted">+${p.xp} XP</span>` : ''}</li>`).join('');
      return `<details class="adm-box comp-t"><summary><b>${esc(t.title)}</b> <span class="muted">${t.size} игроков · ${t.status === 'done' ? `завершён ${when(t.finished)}` : `идёт с ${when(t.started)}`}</span>
          ${t.nums ? `<span class="muted"> · задания №${t.nums.join(', ')}</span>` : ''}${anySus ? ' <span class="comp-sus">⚠ есть подозрительные ответы</span>' : ''}<div>${pod || '<span class="muted">итогов пока нет</span>'}</div></summary>
        <div class="comp-in"><div><h4>Места</h4><ol class="comp-pl">${places}</ol>
            ${t.status === 'run' ? `<button type="button" class="btn ghost" data-ct-restart="${t.id}" title="Отменить турнир и начать заново с теми же игроками">↻ Перезапустить турнир</button>` : ''}</div>
          <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Стадия</th><th>Игрок</th><th class="num">Счёт</th><th>Игрок</th><th></th><th></th></tr></thead><tbody>${ms}</tbody></table></div></div></details>`;
    }).join('');
    const duels = COMP.duels.filter(d => has(d.a, d.b));
    const eloD = v => v == null ? '' : ` <span class="muted">${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))} Эло</span>`;
    const duelRows = duels.map(d => `<tr class="${d.status === 'void' ? 'comp-void' : ''}"><td>${when(d.ts)}</td><td${d.winner === d.a ? ' class="ok"' : ''}>${esc(d.a)}${eloD(d.a_elo)}${sus(d.sus_a)}</td>
      <td class="num">${d.status === 'active' ? 'идёт' : `${d.a_solved ?? 0} : ${d.b_solved ?? 0}`}</td><td${d.winner === d.b ? ' class="ok"' : ''}>${esc(d.b)}${eloD(d.b_elo)}${sus(d.sus_b)}</td>
      <td>${d.status === 'void' ? '<span class="muted">отменена</span>' : d.status !== 'finished' ? '<span class="muted">идёт</span>' : d.winner ? `🏆 ${esc(d.winner)}${d.stake ? ` <span class="muted">+${d.stake} XP</span>` : ''}` : 'ничья'}</td>
      <td class="muted">${d.rematch ? 'реванш' : d.quick ? 'подбор' : 'вызов'}</td>
      <td>${d.status !== 'void' ? `<button type="button" class="link-btn" data-cd="${d.id}" title="Отменить дуэль: опыт и рейтинг вернутся">отменить</button>` : ''}</td></tr>`).join('');
    $('#compBody').innerHTML = `<h3 class="adm-h3">Турниры <span class="muted">${tours.length}</span></h3>
      ${tourHtml || '<p class="adm-empty">Турниров пока не было.</p>'}
      <h3 class="adm-h3">Дуэли <span class="muted">${duels.length}</span></h3>
      ${duelRows ? `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Когда</th><th>Игрок</th><th class="num">Счёт</th><th>Игрок</th><th>Итог</th><th>Как</th><th></th></tr></thead>
        <tbody>${duelRows}</tbody></table></div>` : '<p class="adm-empty">Дуэлей пока не было.</p>'}`;
  }
  $('#compFind').addEventListener('input', renderComp);
  $('#compBody').addEventListener('click', async e => {
    const cm = e.target.closest('[data-cm]'), cr = e.target.closest('[data-ct-restart]'), cd = e.target.closest('[data-cd]');
    let path, body, ask;
    if (cm) {
      const [id, action] = cm.dataset.cm.split(':');
      path = 'tour/match'; body = { id: +id, action };
      ask = action === 'replay' ? 'Переиграть матч? Результаты обнулятся, игроки получат новые задания.' : 'Засчитать техническую победу?';
    } else if (cr) {
      path = 'tour/restart'; body = { id: +cr.dataset.ctRestart };
      ask = 'Перезапустить турнир? Все матчи отменятся, турнир начнётся заново с теми же игроками.';
    } else if (cd) {
      path = 'duel/cancel'; body = { id: +cd.dataset.cd };
      ask = 'Отменить дуэль? Ставка опыта, бонус и рейтинг Эло вернутся как было.';
    } else return;
    if (!confirm(ask)) return;
    try { await api(path, body); } catch (err) { toast(err.message); return; }
    toast('Готово');
    loadComp();
  });

  // ------------------------------------------------------------ уведомления: сдал работу, техподдержка, подозрительный ответ
  // Колокольчик со счётчиком непрочитанных; прочитанным считается всё до момента, когда учитель открыл список
  // (момент хранится в браузере). Счётчики и на вкладках: «Лента» — работы и ответы, «Статистика сайта» — техподдержка.
  const NTF_KINDS = { finish: '📝', forced: '📝', exam: '🎯', support: '🛟', sus: '⚠' };
  const NTF_KEY = 'egeAdm.ntfSeen';
  let NTF = [];
  let ntfSeen = (() => { try { return +localStorage.getItem(NTF_KEY) || 0; } catch (e) { return 0; } })();
  if (!ntfSeen) { ntfSeen = Date.now() / 1000; try { localStorage.setItem(NTF_KEY, ntfSeen); } catch (e) { /* */ } }   // первый раз — старое не считаем
  function ntfAdd(items) {
    const have = new Set(NTF.map(x => x.kind + x.ts + x.sid));
    const add = items.filter(x => !have.has(x.kind + x.ts + x.sid));
    if (!add.length) return;
    NTF = add.concat(NTF).sort((a, b) => b.ts - a.ts).slice(0, 80);
    ntfRender();
  }
  function ntfRender() {
    const fresh = NTF.filter(x => x.ts > ntfSeen);
    const n = $('#ntfN');
    if (n) { n.hidden = !fresh.length; n.textContent = fresh.length > 99 ? '99+' : fresh.length; }
    const tabCount = (tab, kinds) => {
      const b = $(`#tabs [data-tab="${tab}"]`);
      if (!b) return;
      const c = fresh.filter(x => kinds.includes(x.kind)).length;
      let t = b.querySelector('.tab-n');
      if (!c) { if (t) t.remove(); return; }
      if (!t) { t = document.createElement('b'); t.className = 'tab-n'; b.appendChild(t); }
      t.textContent = c;
    };
    tabCount('feed', ['finish', 'forced', 'exam', 'sus']);
    tabCount('site', ['support']);
    const pop = $('#ntfPop');
    if (pop && !pop.hidden) ntfList();
  }
  function ntfList() {
    const when = ts => new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    $('#ntfPop').innerHTML = `<div class="ntf-h"><b>Уведомления</b><button type="button" class="link-btn" id="ntfRead">прочитать все</button></div>
      ${NTF.length ? `<ul class="ntf-list">${NTF.slice(0, 40).map((x, i) => `<li class="${x.ts > ntfSeen ? 'new' : ''}${x.kind === 'sus' ? ' warn' : ''}" data-ntf="${i}">
        <span class="ntf-ico">${NTF_KINDS[x.kind]}</span><div><b>${esc(x.name)}</b> ${esc(x.text)}<small>${when(x.ts)}</small></div></li>`).join('')}</ul>`
        : '<p class="adm-hint">Пока ничего нового. Здесь появятся сданные работы, обращения в техподдержку и подозрительные ответы.</p>'}`;
  }
  function ntfReadAll() {
    ntfSeen = Math.max(ntfSeen, ...NTF.map(x => x.ts), Date.now() / 1000);
    try { localStorage.setItem(NTF_KEY, ntfSeen); } catch (e) { /* */ }
    ntfRender();
  }
  $('#ntfBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('#ntfPop');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) ntfList();
  });
  $('#ntfPop')?.addEventListener('click', e => {
    e.stopPropagation();
    if (e.target.closest('#ntfRead')) { ntfReadAll(); ntfList(); return; }
    const li = e.target.closest('[data-ntf]');
    if (!li) return;
    const x = NTF[+li.dataset.ntf];
    $('#ntfPop').hidden = true;
    ntfReadAll();
    if (x.kind === 'support') go('site');
    else if (x.sid && typeof openStudent === 'function') openStudent(x.sid);
    else go('feed');
  });
  document.addEventListener('click', () => { const p = $('#ntfPop'); if (p) p.hidden = true; });

  // ------------------------------------------------------------ история версий (changelog.js): для учителя и для учеников
  const CL = window.EGE_CHANGELOG || { student: [], teacher: [] };
  const CL_NOW = (CL.student[0] || [''])[0];
  if ($('#admVerBtn')) $('#admVerBtn').textContent = `Версия ${CL_NOW} · что нового`;
  function renderVer(kind) {
    const list = CL[kind] || [];
    $$('#verModal [data-ver]').forEach(b => b.classList.toggle('on', b.dataset.ver === kind));
    const ul = arr => `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    $('#verBody').innerHTML = `<p class="adm-hint">${kind === 'teacher' ? 'Что менялось в панели учителя и на сервере — с версии 1.0.0.' : 'Что видят ученики в «Что нового» на сайте.'}</p>
      <div class="ver-list">${list.map(([v, d, added, changed], i) => `<section class="ver-item">
        <h3><b>${esc(v)}</b> <span class="muted">${esc(d)}</span>${v === CL_NOW ? ' <span class="ver-now">сейчас</span>' : ''}</h3>
        ${(added || []).length ? `<div class="ver-k ver-add">✨ Добавлено</div>${ul(added)}` : ''}
        ${(changed || []).length ? `<div class="ver-k ver-chg">🔧 Изменено</div>${ul(changed)}` : ''}</section>`).join('')}</div>`;
  }
  $('#admVerBtn')?.addEventListener('click', () => { renderVer('teacher'); $('#verModal').hidden = false; });
  $('#verModal').addEventListener('click', e => {
    const b = e.target.closest('[data-ver]');
    if (b) return renderVer(b.dataset.ver);
    if (e.target.id === 'verModal' || e.target.closest('.fm-close')) $('#verModal').hidden = true;
  });

  // ------------------------------------------------------------ вкладки
  let tab = 'students';
  let backTab = 'students';            // куда вернуться из карточки ученика
  function go(t) {
    if (t !== 'student') backTab = t;
    tab = t;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (t === 'student' && b.dataset.tab === backTab)));
    ['students', 'classes', 'teachers', 'student', 'feed', 'settings', 'site', 'build', 'course', 'comp'].forEach(v => { $('#view-' + v).hidden = v !== t; });
    if (t === 'course') loadCourseProgress();
    if (t === 'site') loadSite();
    if (t === 'build') openBuilder();
    if (t === 'teachers') loadTeachers();
    if (t === 'students') loadStudents();
    if (t === 'classes') loadClasses();
    if (t === 'feed') { $('#feedDot').hidden = true; renderFeed(); }
    if (t === 'settings') loadSettings();
    if (t === 'comp') loadComp();
    window.scrollTo({ top: 0 });
  }
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });
  /** Из класса — в конструктор: черновик для этого класса, по номеру n (если задан). */
  function openBuilderFor(classId, n) {
    if (String(BLD.d.class_id) !== String(classId)) { BLD.d.class_id = String(classId); BLD.d.id = null; }
    if (n) { BLD.f.n = [String(n)]; BLD.f.c = []; BLD.page = 0; }
    bldSave();
    go('build');
  }

  // ------------------------------------------------------------ ученики
  let students = [];
  let sortKey = 'last', sortAsc = false;
  const picked = new Set();
  async function loadStudents() {
    try {
      if (!classes.length) await fetchClasses();
      const d = await api('students?class_id=' + $('#studentsScope').value);
      students = d.students.map(s => Object.assign(s, {
        last: s.last_attempt || s.last_seen || 0,
        acc: s.total ? (s.ok1 || 0) / s.total : -1,
      }));
      renderStudents();
    } catch (e) { if (e.status !== 401) toast('Не удалось загрузить учеников: ' + e.message); }
  }
  function renderStudents() {
    const q = $('#studentSearch').value.trim().toLowerCase().replace(/ё/g, 'е');
    let list = students.filter(s => !q || s.name.toLowerCase().replace(/ё/g, 'е').includes(q));
    list.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const r = typeof va === 'string' ? va.localeCompare(vb, 'ru') : (va ?? -1) - (vb ?? -1);
      return sortAsc ? r : -r;
    });
    const scope = $('#studentsScope').value;
    $('#studentsTitle').textContent = scope === 'none' ? 'Новые ученики' : 'Все ученики';
    $('#studentsCount').textContent = students.length ? `· ${students.length}` : '';
    $('#studentsEmpty').hidden = students.length > 0;
    $('#studentsTable').hidden = students.length === 0;
    $$('#studentsTable th').forEach(th => {
      th.classList.toggle('sorted', th.dataset.sort === sortKey);
      th.classList.toggle('asc', th.dataset.sort === sortKey && sortAsc);
    });
    $('#studentsTable tbody').innerHTML = list.map(s => {
      const acc = s.total ? s.ok1 / s.total : null;
      const color = acc == null ? '' : acc >= 0.8 ? 'var(--good)' : acc >= 0.5 ? 'var(--mid)' : 'var(--weak)';
      const susp = suspicion(s);
      const cls = classes.find(c => c.id === s.class_id);
      return `<tr class="click${susp.length ? ' susp-row' : ''}" data-id="${s.id}">
        <td class="chk"><input type="checkbox" data-pick="${s.id}" ${picked.has(s.id) ? 'checked' : ''}></td>
        <td class="name">${esc(s.name)}${cls ? ` <span class="chip">${esc(cls.name)}</span>` : ''}</td>
        <td class="num"><span class="lvl-mini" title="${s.xp || 0} XP">${s.level || 1}</span>${s.cheat ? `<span class="chip weak cheat-chip" title="Перерешивал подборку по кругу ради опыта (лазейка, закрыта). Опыт, набранный с ${fmtWhen(s.cheat[0])} по ${fmtWhen(s.cheat[1])}, срезан.">накрутка</span>` : ''}</td>
        <td class="adm-off muted">${esc(s.teacher || '')}</td>
        <td class="muted">${fmtWhen(s.last)}</td>
        <td class="num">${s.today || ''}</td>
        <td class="num">${s.week || ''}</td>
        <td class="num">${s.total || 0}</td>
        <td class="num">${acc == null ? '<span class="muted">—</span>' : `<span class="acc-bar"><i><b style="width:${pct(acc)}%;background:${color}"></b></i>${pct(acc)}%</span>`}</td>
        <td class="num">${s.bad_week ? `<span style="color:var(--weak)">${s.bad_week}</span>` : ''}</td>
        <td class="num">${s.rev_week || ''}${susp.length ? ` <span class="chip weak susp" title="${esc('Подозрительно: ' + susp.join('; '))}">⚠</span>` : ''}</td>
        <td class="num">${s.away_week ? `<span style="color:var(--review)">${s.away_week}</span>` : ''}</td>
        <td class="num">${s.exam_last != null ? s.exam_last : '<span class="muted">—</span>'}</td>
        <td class="num">${s.forecast != null ? `<b>${s.forecast}</b>` : '<span class="muted">—</span>'}</td>
      </tr>`;
    }).join('');
    renderBulk();
  }
  function renderBulk() {
    $('#bulkBar').hidden = !picked.size;
    $('#bulkCount').textContent = `Выбрано: ${picked.size}`;
    $('#bulkClass').innerHTML = classes.length
      ? classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '<option value="0">— без класса —</option>'
      : '<option value="">сначала создайте класс</option>';
  }
  $('#studentsScope').addEventListener('change', () => { picked.clear(); loadStudents(); });
  $('#chkAll').addEventListener('change', e => {
    $$('#studentsTable tbody [data-pick]').forEach(c => { c.checked = e.target.checked; picked[e.target.checked ? 'add' : 'delete'](+c.dataset.pick); });
    renderBulk();
  });
  $('#bulkClear').addEventListener('click', () => { picked.clear(); $('#chkAll').checked = false; renderStudents(); });
  $('#bulkMove').addEventListener('click', async () => {
    const cid = $('#bulkClass').value;
    if (cid === '') { go('classes'); return; }
    try {
      await api('class/members', { class_id: +cid || null, students: [...picked] });
      const c = classes.find(x => x.id === +cid);
      toast(c ? `Перенесено в ${c.name}: ${picked.size}` : 'Ученики без класса');
      picked.clear();
      $('#chkAll').checked = false;
      await fetchClasses();
      loadStudents();
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#studentSearch').addEventListener('input', renderStudents);
  $('#studentsTable thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    if (sortKey === th.dataset.sort) sortAsc = !sortAsc;
    else { sortKey = th.dataset.sort; sortAsc = th.dataset.sort === 'name'; }
    renderStudents();
  });
  $('#studentsTable tbody').addEventListener('click', e => {
    const box = e.target.closest('[data-pick]');
    if (box) { picked[box.checked ? 'add' : 'delete'](+box.dataset.pick); renderBulk(); return; }
    if (e.target.closest('td.chk')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) openStudent(+tr.dataset.id);
  });


  // ------------------------------------------------------------ учителя (главный)
  let editTeacher = null;
  async function loadTeachers() {
    try { teachers = (await api('teachers')).teachers; } catch (e) { if (e.status !== 401) toast(e.message); return; }
    $('#teachersTable tbody').innerHTML = teachers.map(t => `<tr>
      <td class="name">${esc(t.name)}${t.is_main ? ' <span class="chip">главный</span>' : ''}</td>
      <td><code>${esc(t.login)}</code></td>
      <td><code>${esc(t.invite)}</code></td>
      <td class="num">${t.students}</td>
      <td class="num">${t.classes}</td>
      <td class="num" style="white-space:nowrap">${t.is_main ? '' : `<button type="button" class="link-btn" data-tedit="${t.id}">изменить</button>
        <button type="button" class="link-btn danger" data-tdel="${t.id}">удалить</button>`}</td></tr>`).join('');
  }
  function fillTeacherForm(t) {
    editTeacher = t;
    $('#teacherFormTitle').textContent = t ? `Изменить: ${t.name}` : 'Добавить учителя';
    $('#tSave').textContent = t ? 'Сохранить' : 'Добавить';
    $('#tCancel').hidden = !t;
    $('#tName').value = t ? t.name : '';
    $('#tLogin').value = t ? t.login : '';
    $('#tPass').value = '';
    $('#tPass').placeholder = t ? 'Новый пароль (пусто — не менять)' : 'Пароль (от 6 символов)';
    $('#tInvite').value = t ? t.invite : '';
    $('#tMsg').textContent = '';
  }
  $('#teachersTable tbody').addEventListener('click', async e => {
    const ed = e.target.closest('[data-tedit]');
    if (ed) { fillTeacherForm(teachers.find(t => t.id === +ed.dataset.tedit)); $('#tName').focus(); return; }
    const del = e.target.closest('[data-tdel]');
    if (!del) return;
    const t = teachers.find(x => x.id === +del.dataset.tdel);
    if (!confirm(`Удалить учителя «${t.name}»? Его ученики, классы и подборки перейдут к вам, результаты сохранятся.`)) return;
    try { await api('teacher/delete', { id: t.id }); loadTeachers(); fetchClasses(); } catch (err) { toast(err.message); }
  });
  $('#tCancel').addEventListener('click', () => fillTeacherForm(null));
  $('#teacherForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#tMsg');
    msg.className = 'login-err';
    try {
      const r = await api('teacher/save', { id: editTeacher && editTeacher.id, name: $('#tName').value, login: $('#tLogin').value,
        password: $('#tPass').value, invite: $('#tInvite').value });
      const login = $('#tLogin').value.trim().toLowerCase(), pw = $('#tPass').value;
      fillTeacherForm(null);
      msg.className = 'login-err ok';
      msg.textContent = `Сохранено. Логин: ${login}${pw ? ', пароль: ' + pw : ''}, код для учеников: ${r.invite}`;
      loadTeachers();
    } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
  });

  // ------------------------------------------------------------ классы
  let classes = [];
  let curClass = null;            // { id, name, students, assignments }
  async function fetchClasses() {
    const d = await api('classes');
    classes = d.classes || [];
    $('#unassignedHint').textContent = d.unassigned ? `Без класса: ${d.unassigned} — на вкладке «Ученики».` : '';
    return d;
  }
  async function loadClasses() {
    try { await fetchClasses(); } catch (e) { if (e.status !== 401) toast(e.message); return; }
    if (curClass && !classes.some(c => c.id === curClass.id)) curClass = null;
    if (!curClass && classes.length) curClass = { id: classes[0].id };
    renderClassList();
    if (curClass) openClass(curClass.id); else $('#classBody').innerHTML = '<p class="adm-empty">Создайте класс слева, затем перенесите в него учеников со вкладки «Ученики».</p>';
  }
  function renderClassList() {
    $('#classList').innerHTML = classes.map(c => `<button type="button" class="adm-class${curClass && curClass.id === c.id ? ' on' : ''}" data-class="${c.id}">
      <b>${esc(c.name)}${ME.is_main && c.teacher_id !== ME.id ? `<small>${esc(c.teacher || '')}</small>` : ''}</b><span>${c.students} ${plural(c.students, 'ученик', 'ученика', 'учеников')}</span></button>`).join('')
      || '<p class="adm-hint">Классов пока нет.</p>';
  }
  $('#classList').addEventListener('click', e => {
    const b = e.target.closest('[data-class]');
    if (b) { curClass = { id: +b.dataset.class }; renderClassList(); openClass(curClass.id); }
  });
  $('#classNewForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await api('class/save', { name: $('#classNewName').value });
      $('#classNewName').value = '';
      curClass = { id: r.id };
      loadClasses();
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  async function openClass(id) {
    try {
      const [s, a] = await Promise.all([api('students?class_id=' + id), api('assignments?class_id=' + id)]);
      const cl = classes.find(c => c.id === id) || {};
      curClass = { id, name: cl.name || '', goal: cl.goal_tasks || 0, reward: cl.goal_reward || '', weekSolved: cl.week_solved || 0, battle: !!cl.battle,
        students: s.students, assignments: a.assignments, batches: a.batches || [] };
    } catch (e) { if (e.status !== 401) toast(e.message); return; }
    renderClass();
    setCsPreset('today');
  }
  function renderClass() {
    const c = curClass;
    const studs = c.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const members = studs.map(s => {
      const acc = s.total ? s.ok1 / s.total : null;
      return `<tr class="click" data-id="${s.id}">
        <td class="name">${esc(s.name)}</td>
        <td class="num"><span class="lvl-mini" title="${s.xp || 0} XP">${s.level || 1}</span>${s.cheat ? `<span class="chip weak cheat-chip" title="Перерешивал подборку по кругу ради опыта (лазейка, закрыта). Опыт, набранный с ${fmtWhen(s.cheat[0])} по ${fmtWhen(s.cheat[1])}, срезан.">накрутка</span>` : ''}</td>
        <td class="muted">${fmtWhen(s.last_attempt || s.last_seen)}</td>
        <td class="num">${s.week || ''}</td>
        <td class="num">${acc == null ? '<span class="muted">—</span>' : pct(acc) + '%'}</td>
        <td class="num">${s.away_week ? `<span style="color:var(--review)">${s.away_week}</span>` : ''}</td>
        <td class="num">${s.forecast != null ? `<b>${s.forecast}</b>` : '<span class="muted">—</span>'}</td>
        <td class="num"><button type="button" class="link-btn" data-unclass="${s.id}" title="Вернуть в «Новые ученики»">убрать</button></td>
      </tr>`;
    }).join('');
    const asg = c.assignments.map(a => {
      const total = a.tasks.length;
      const done = a.progress.filter(p => p.done >= total).length;
      const zero = a.progress.filter(p => !p.done).length;
      const late = a.due && a.due * 1000 < Date.now();
      return strictAsgHtml(a);
      return `<div class="adm-asg">
        <div class="adm-asg-head"><b>${esc(a.title)}</b>
          <span class="adm-hint">${total} ${plural(total, 'задание', 'задания', 'заданий')} · выдано ${fmtDate(a.created)}${a.due ? ` · срок <span style="${late ? 'color:var(--weak)' : ''}">${fmtDate(a.due)}</span>` : ''}</span>
          <span class="adm-actions">
          <button type="button" class="btn ghost" data-asg-edit="${a.id}">Изменить</button>
          <button type="button" class="btn ghost danger" data-asg-del="${a.id}">Удалить</button></span></div>
        <div class="adm-hint" style="margin:0 0 8px">Обычная подборка: ответ проверяется сразу, две попытки. Сделали всё: <b>${done}</b> из ${a.progress.length}${zero ? ` · не начинали: ${zero}` : ''}</div>
        <div class="adm-asg-prog">${a.progress.map(p => `<span class="adm-asg-st${p.done >= total ? ' full' : p.done ? '' : ' zero'}" data-open-st="${p.id}" title="${esc(p.name)}: ${p.done} из ${total}">
          <span>${esc(p.name)}</span><i><b style="width:${pct(p.done / total)}%"></b></i><small>${p.done}/${total}</small></span>`).join('') || '<span class="adm-hint">В классе нет учеников.</span>'}</div>
      </div>`;
    }).join('');
    $('#classBody').innerHTML = `
      <div class="adm-toolbar"><h2 class="adm-h">${esc(c.name)} <span class="adm-count">· ${studs.length}</span></h2>
        <span class="adm-actions"><button type="button" class="btn ghost" id="classRename">Переименовать</button>
        <button type="button" class="btn ghost danger" id="classDelete">Удалить класс</button></span></div>
      <nav class="cls-tabs" id="clsTabs">${CLS_PANES.map(([k, l]) => `<button type="button" data-pane="${k}" class="${clsPane === k ? 'on' : ''}">${l}</button>`).join('')}</nav>
      <div class="cls-pane" data-pane="digest"${clsPane === 'digest' ? '' : ' hidden'}><div id="clsDigest"><p class="adm-hint">Собираю сводку…</p></div></div>
      <div class="cls-pane" data-pane="members"${clsPane === 'members' ? '' : ' hidden'}>
      ${studs.length ? `<div class="adm-table-wrap"><table class="adm-table" id="classTable"><thead><tr>
        <th>Ученик</th><th class="num">Ур.</th><th>Был(а)</th><th class="num">За 7 дней</th><th class="num">Верно с 1-й</th>
        <th class="num" title="Уходил со вкладки за 7 дней">Уходил</th><th class="num">Прогноз</th><th></th></tr></thead><tbody>${members}</tbody></table></div>`
        : '<p class="adm-empty">В классе пока нет учеников. Отметьте их галочками на вкладке «Ученики» и нажмите «Перенести в класс».</p>'}
      </div>
      <div class="cls-pane" data-pane="journal"${clsPane === 'journal' ? '' : ' hidden'}><div id="clsJournal"><p class="adm-hint">Загружаю журнал…</p></div></div>
      <div class="cls-pane" data-pane="nums"${clsPane === 'nums' ? '' : ' hidden'}><div id="clsNums"><p class="adm-hint">Загружаю…</p></div></div>
      <div class="cls-pane" data-pane="period"${clsPane === 'period' ? '' : ' hidden'}>
      <div class="adm-box cls-stats" id="clsStats">
        <h3 class="adm-h3">Статистика класса за период — для оценок</h3>
        <div class="cls-stats-bar">
          <span class="cs-seg" id="csPreset">
            <button type="button" data-cs="lesson">Последний час</button><button type="button" data-cs="today" class="on">Сегодня</button>
            <button type="button" data-cs="yesterday">Вчера</button><button type="button" data-cs="week">7 дней</button>
          </span>
          <label>с <input class="inp" type="datetime-local" id="csFrom"></label>
          <label>по <input class="inp" type="datetime-local" id="csTo"></label>
          <select class="adm-select" id="csAsg"><option value="">Все задания</option>
            ${c.assignments.map(a => `<option value="${a.id}">Подборка «${esc(a.title)}» (${a.tasks.length})</option>`).join('')}</select>
          <button type="button" class="btn primary" id="csShow">Показать</button>
          <button type="button" class="btn ghost" id="csCsv">Скачать для Excel</button>
        </div>
        <div class="adm-hint cls-grade-cfg">Подсказка оценки по проценту: «5» от <input type="number" min="0" max="100" data-g="5">%,
          «4» от <input type="number" min="0" max="100" data-g="4">%, «3» от <input type="number" min="0" max="100" data-g="3">%.
          Процент — доля верно решённых среди начатых заданий, а для подборки — решённых из всех заданий подборки.</div>
        <div id="csTable"></div>
      </div>
      </div>
      <div class="cls-pane" data-pane="battle"${clsPane === 'battle' ? '' : ' hidden'}>
      <form class="adm-box adm-goal" id="goalForm">
        <h3 class="adm-h3">Битва классов · цель на неделю</h3>
        <label class="adm-switch"><input type="checkbox" id="goalBattle"${c.battle ? ' checked' : ''}> Класс участвует в битве классов</label>
        <p class="adm-hint">Ученики видят классы-участники, их опыт за неделю, цель и прогресс во вкладке «Классы» рейтинга.
          Если ни один класс не участвует, вкладки нет. Считаются верно решённые задания с понедельника.
          Сейчас: <b>${c.weekSolved}</b>${c.goal ? ` из ${c.goal}` : ''}.</p>
        <div class="login-form">
          <input class="inp" id="goalTasks" type="number" min="0" max="100000" placeholder="Заданий, например 300" value="${c.goal || ''}" style="max-width:190px">
          <input class="inp" id="goalReward" maxlength="120" placeholder="Награда, например «отменю домашку»" value="${esc(c.reward)}">
          <button class="btn primary" type="submit">Сохранить</button>
        </div>
      </form>
      </div>
      <div class="cls-pane" data-pane="asg"${clsPane === 'asg' ? '' : ' hidden'}>
      <div class="adm-toolbar"><h2 class="adm-h">Подборки заданий</h2>
        <span class="adm-actions"><button type="button" class="btn ghost" id="asgToBuilder" title="Конструктор с фильтром по всему банку">Собрать в конструкторе</button>
        <button type="button" class="btn primary" id="asgNew">Новая подборка</button></span></div>
      <div id="asgEditor"></div>
      ${asg || '<p class="adm-hint">Подборок пока нет. Соберите задания и отправьте классу — ученики увидят их в карточке «Задания от учителя».</p>'}
      ${c.batches.length ? `<h3 class="adm-h3">Личные подборки</h3>
        <p class="adm-hint">У каждого ученика своя: 🔧 работа над ошибками создаётся сама после самостоятельной, 🎯 слабые места — кнопкой в журнале или сводке, ⭐ персональная — в «Создать подборку» → «Кому: персонально». Результаты по каждому ученику — кнопка «📊 Результаты».</p>
        ${c.batches.map(b => `<div class="adm-asg"><div class="adm-asg-head"><b>${b.batch.startsWith('fix') ? '🔧' : b.batch.startsWith('own') ? '⭐' : '🎯'} ${esc(b.title)}</b>
          <span class="adm-hint">учеников: ${b.students} · сделали всё: ${b.done}${b.due ? ` · срок ${fmtDate(b.due)}` : ''}</span>
          <span class="adm-actions"><button type="button" class="btn${batchOpen === b.batch ? ' primary' : ''}" data-batch-stats="${esc(b.batch)}" data-ids="${(b.ids || []).join(',')}">📊 Результаты</button>
          <select class="adm-select" data-batch-kind="${esc(b.batch)}" data-was="${esc(b.kind || 'self')}" title="Тип работы — сразу у всех учеников этой подборки">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${(b.kind || 'self') === k ? ' selected' : ''}>${v.ico} ${v.name}</option>`).join('')}</select>
          <button type="button" class="btn ghost danger" data-batch-del="${esc(b.batch)}">Удалить</button></span></div>
          <div class="adm-live" data-batch-box="${esc(b.batch)}"></div></div>`).join('')}` : ''}
      </div>`;
    if (clsPane === 'journal' || clsPane === 'nums') loadGradebook();
    if (clsPane === 'digest') loadDigest();
  }
  // ---------- вкладки класса: ученики, журнал оценок, номера ЕГЭ, статистика за период, подборки, битва
  const CLS_PANES = [['digest', 'Сводка недели'], ['members', 'Ученики'], ['journal', 'Журнал'], ['nums', 'По номерам'], ['period', 'За период'], ['asg', 'Подборки'], ['battle', 'Битва классов']];
  let clsPane = (() => { try { return localStorage.getItem('egeAdmin.clsPane') || 'digest'; } catch (e) { return 'digest'; } })();
  if (!CLS_PANES.some(p => p[0] === clsPane)) clsPane = 'digest';
  function showClsPane(k) {
    clsPane = k;
    try { localStorage.setItem('egeAdmin.clsPane', k); } catch (e) { /* не страшно */ }
    $$('#clsTabs [data-pane]').forEach(b => b.classList.toggle('on', b.dataset.pane === k));
    $$('#classBody .cls-pane').forEach(p => { p.hidden = p.dataset.pane !== k; });
    if (k === 'journal' || k === 'nums') loadGradebook();
    if (k === 'digest') loadDigest();
  }
  // ---------- сводка недели: кто не занимался, кто просел, кто не сдал, кто молодец
  async function loadDigest() {
    const id = curClass && curClass.id;
    let d;
    try { d = await api('class/digest?class_id=' + id); } catch (e) { if (e.status !== 401) toast(e.message); return; }
    const box = $('#clsDigest');
    if (!box || !curClass || curClass.id !== id) return;
    const who = (sid, name) => `<button type="button" class="task-link" data-open-st="${sid}">${esc(name)}</button>`;
    const nl = n => n === 19 ? '19–21' : n;
    const sec = (ico, title, cls, body, empty) => `<div class="dg-card ${cls}"><h4>${ico} ${title}</h4>${body || `<p class="adm-hint">${empty}</p>`}</div>`;
    const drop = {};
    d.dropped.forEach(x => (drop[x.id] = drop[x.id] || { name: x.name, list: [] }).list.push(x));
    box.innerHTML = `<p class="adm-hint">${fmtDate(d.from)} — ${fmtDate(d.to)} · занимались <b>${d.active}</b> из ${d.total}. Сравнение — с предыдущими 30 днями.</p>
      <div class="dg-grid">
        ${sec('😴', 'Не занимались за неделю', d.inactive.length ? 'warn' : 'ok', d.inactive.length ? `<ul>${d.inactive.map(x => `<li>${who(x.id, x.name)} <span class="muted">${x.last ? 'последний раз ' + fmtWhen(x.last) : 'ни разу'}</span></li>`).join('')}</ul>` : '', 'Все занимались — отлично!')}
        ${sec('📉', 'Просели по номерам', Object.keys(drop).length ? 'warn' : 'ok', Object.keys(drop).length ? `<ul>${Object.entries(drop).map(([sid, v]) => `<li>${who(sid, v.name)}: ${v.list.map(x => `<b>№${nl(x.n)}</b> <span class="muted">${x.was}% → </span><b class="dg-bad">${x.now}%</b>`).join(', ')}</li>`).join('')}</ul>` : '', 'Ни у кого заметного спада нет.')}
        ${sec('⌛', 'Не сдали в срок', d.overdue.length ? 'warn' : 'ok', d.overdue.length ? `<ul>${d.overdue.map(x => `<li>${who(x.id, x.name)} — «${esc(x.title)}» <span class="muted">до ${fmtDate(x.due)}: ${esc(x.state)}</span></li>`).join('')}</ul>` : '', 'Все работы с прошедшим сроком сданы.')}
        ${sec('🏆', 'Молодцы недели', 'ok', d.top.length ? `<ol>${d.top.map(x => `<li>${who(x.id, x.name)} — решено <b>${x.solved}</b> из ${x.answers}</li>`).join('')}</ol>` : '', 'Пока никто не решал.')}
      </div>
      <div class="dg-actions"><button type="button" class="btn primary" data-weak>🎯 Выдать каждому подборку по его слабым местам</button>
        <span class="adm-hint">По 3 задания на 3 самых слабых номера у каждого ученика — у всех своя подборка, срок неделя.</span></div>`;
  }
  async function giveWeakSets() {
    if (!confirm('Выдать каждому ученику класса личную подборку: по 3 задания на его 3 самых слабых номера, срок — неделя?')) return;
    let r;
    try { r = await api('class/weak', { class_id: curClass.id, per: 3, nums: 3, days: 7 }); } catch (e) { toast(e.message); return; }
    toast(`Выдано подборок: ${r.made}${r.skipped.length ? ` · мало данных у: ${r.skipped.join(', ')}` : ''}`);
    gradebook = null;
    if (clsPane === 'journal') loadGradebook();
    refreshClassAsg();
  }
  let gradebook = null;
  async function loadGradebook() {
    const id = curClass && curClass.id;
    try { gradebook = await api('class/journal?class_id=' + id); } catch (e) { if (e.status !== 401) toast(e.message); return; }
    if (!curClass || curClass.id !== id) return;
    renderGradebook();
    renderNumsHeat();
  }
  const KIND_ICO = { self: '📝', practice: '🛠', home: '🏠' };
  /** Прогноз балла: сейчас, изменение за месяц и мини-график по дням. */
  function fcCell(f) {
    if (!f || f.now == null) return '<td class="jr-c none" title="прогноза пока нет — мало решённых заданий">—</td>';
    const d = f.then == null ? null : f.now - f.then;
    const sr = (f.series || []).slice(-30);
    let spark = '';
    if (sr.length > 1) {
      const lo = Math.min(...sr), hi = Math.max(...sr), w = 56, h = 18;
      const pts = sr.map((v, i) => `${(i / (sr.length - 1) * w).toFixed(1)},${(h - (hi === lo ? h / 2 : (v - lo) / (hi - lo) * h)).toFixed(1)}`).join(' ');
      spark = `<svg class="jr-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    }
    return `<td class="jr-c jr-fc" title="${f.then == null ? 'прогноз сейчас' : `месяц назад: ${f.then}, сейчас: ${f.now}`}"><b>${f.now}</b>
      ${d ? `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ '}${d}</small>` : ''}${spark}</td>`;
  }
  function journalCell(c, a) {
    if (!c && a.personal) return '<td class="jr-c none" title="этому ученику не выдавалась">—</td>';
    if (!c || c.st === 'none') return '<td class="jr-c none" title="не начинал">·</td>';
    if (c.st === 'miss') return '<td class="jr-c miss" title="срок прошёл — не сделал">н/с</td>';
    if (c.st === 'work') return `<td class="jr-c work" title="${a.kind === 'self' ? 'пишет' : `решает: сделано ${c.tried || 0} из ${a.total}, сейчас ${c.pct || 0}%`}">${c.grade ? `<b class="g${c.grade} soft">${c.grade}</b>` : '…'}</td>`;
    return `<td class="jr-c cs-grade" title="${c.pct}%"><b class="g${c.grade}">${c.grade || '—'}</b><small>${c.pct}%</small></td>`;
  }
  function renderGradebook() {
    const box = $('#clsJournal');
    if (!box || !gradebook) return;
    const w0 = box.querySelector('.jr-wrap'), sx = w0 ? w0.scrollLeft : 0;    // журнал обновляется сам — не сбивать прокрутку
    const A = gradebook.assignments, S = gradebook.students;
    if (!S.length) { box.innerHTML = '<p class="adm-empty">В классе нет учеников.</p>'; return; }
    if (!A.length) { box.innerHTML = '<p class="adm-empty">Подборок пока нет — когда выдадите, здесь появятся оценки за каждую.</p>'; return; }
    const avg = arr => arr.length ? (arr.reduce((x, y) => x + y, 0) / arr.length) : null;
    const rows = S.map(st => {
      const gs = A.map(a => st.cells[a.id]).filter(c => c && c.st === 'done' && c.grade).map(c => c.grade);
      const miss = A.filter(a => (st.cells[a.id] || {}).st === 'miss').length;
      const m = avg(gs);
      return `<tr><td class="name"><button type="button" class="task-link" data-open-st="${st.id}">${esc(st.name)}</button></td>
        ${fcCell(st.fc)}
        ${st.exam ? `<td class="jr-c" title="последний ${fmtWhen(st.exam.last_ts)} · лучший ${st.exam.best} · всего ${st.exam.count}, за 30 дней ${st.exam.month}">
          <button type="button" class="jr-asg" data-exam="${esc(st.exam.last_id)}"><b>${st.exam.last}</b></button><small>лучший ${st.exam.best} · ×${st.exam.count}</small></td>`
          : '<td class="jr-c none" title="вариантов не решал">—</td>'}
        ${A.map(a => journalCell(st.cells[a.id], a)).join('')}
        <td class="num jr-avg">${m == null ? '<span class="muted">—</span>' : `<b>${m.toFixed(1).replace('.', ',')}</b>`}${miss ? ` <span class="jr-miss" title="не сдано в срок">н/с ${miss}</span>` : ''}</td></tr>`;
    }).join('');
    const foot = A.map(a => {
      const cs = S.map(st => st.cells[a.id]).filter(Boolean);
      const done = cs.filter(c => c.st === 'done').length, gs = cs.filter(c => c.st === 'done' && c.grade).map(c => c.grade);
      const m = avg(gs);
      return `<td class="num jr-foot" title="сдали ${done} из ${S.length}">${m == null ? '' : `<b>${m.toFixed(1).replace('.', ',')}</b><br>`}<small>${done}/${S.length}</small></td>`;
    }).join('');
    box.innerHTML = `<p class="adm-hint">Оценки за все подборки класса. «·» — не начинал, «…» — решает сейчас, <span class="jr-miss">н/с</span> — срок прошёл, а работа не сделана.
        Нажмите на название подборки, чтобы открыть её результаты, на имя — карточку ученика.</p>
      <div class="dg-actions"><button type="button" class="btn" data-weak>🎯 Каждому — по 3 задания на его 3 слабых номера</button>
        <span class="adm-hint">У каждого ученика своя подборка; появится в журнале отдельной колонкой.</span></div>
      <div class="adm-table-wrap jr-wrap"><table class="adm-table jr-table"><thead><tr><th>Ученик</th><th class="jr-h" title="Прогноз балла ЕГЭ: сейчас и изменение за месяц">Прогноз<small>за 30 дней</small></th><th class="jr-h" title="Варианты ЕГЭ, которые ученик решил сам">Вариант ЕГЭ<small>последний</small></th>
        ${A.map(a => a.personal ? `<th class="jr-h jr-personal" title="${esc(a.title)} — у каждого своя подборка"><span>${a.title.startsWith('Работа') ? '🔧' : a.title.startsWith('Персональная') ? '⭐' : '🎯'} ${esc(a.title.length > 18 ? a.title.slice(0, 17) + '…' : a.title)}</span><small>личные · ${fmtDate(a.created)}</small></th>` : `<th class="jr-h"><button type="button" class="jr-asg" data-jr-asg="${a.id}" title="${esc(a.title)}">${KIND_ICO[a.kind] || ''} ${esc(a.title.length > 18 ? a.title.slice(0, 17) + '…' : a.title)}</button><small>${fmtDate(a.created)}${a.due ? ` → ${fmtDate(a.due)}` : ''}</small></th>`).join('')}
        <th class="num">Средняя</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td class="muted">По классу</td><td></td><td></td>${foot}<td></td></tr></tfoot></table></div>`;
    const w1 = box.querySelector('.jr-wrap');
    if (w1 && sx) w1.scrollLeft = sx;
  }
  function renderNumsHeat() {
    const box = $('#clsNums');
    if (!box || !gradebook) return;
    const S = gradebook.students;
    if (!S.length) { box.innerHTML = '<p class="adm-empty">В классе нет учеников.</p>'; return; }
    const NUMS = Array.from({ length: 27 }, (_, i) => i + 1).filter(n => n !== 20 && n !== 21);
    const label = n => n === 19 ? '19–21' : String(n);
    const cell = v => {
      if (!v || !v[0]) return '<td class="hm-c none" title="не решал">·</td>';
      const p = v[1] / v[0];
      const cls = v[0] < 3 ? 'few' : p >= 0.75 ? 'good' : p >= 0.4 ? 'mid' : 'weak';
      return `<td class="hm-c ${cls}" title="верно с 1-й попытки: ${v[1]} из ${v[0]}">${Math.round(p * 100)}</td>`;
    };
    const cls = NUMS.map(n => {
      let a = 0, ok = 0, who = 0;
      for (const st of S) { const v = st.nums[n]; if (v && v[0]) { a += v[0]; ok += v[1]; who++; } }
      return { n, a, ok, who };
    });
    const weak = cls.filter(x => x.a >= 3 && x.ok / x.a < 0.4).map(x => label(x.n));
    box.innerHTML = `<p class="adm-hint">Доля верных с первой попытки по каждому номеру ЕГЭ — тренажёр и подборки, без вариантов. Серым — меньше 3 ответов.
        Нажмите на номер, чтобы собрать по нему подборку.</p>
      ${weak.length ? `<p class="hm-weak">Слабые места класса: ${weak.map(n => `<b>№${n}</b>`).join(', ')}</p>` : ''}
      <div class="adm-table-wrap hm-wrap"><table class="adm-table hm-table"><thead><tr><th>Ученик</th>
        ${NUMS.map(n => `<th class="hm-h"><button type="button" class="jr-asg" data-hm-n="${n}" title="Собрать подборку по №${label(n)}">${label(n)}</button></th>`).join('')}</tr></thead>
        <tbody>${S.map(st => `<tr><td class="name"><button type="button" class="task-link" data-open-st="${st.id}">${esc(st.name)}</button></td>${NUMS.map(n => cell(st.nums[n])).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td class="muted">Класс</td>${cls.map(x => cell(x.a ? [x.a, x.ok] : null)).join('')}</tr></tfoot></table></div>`;
  }
  const KINDS = {
    self: { name: 'Самостоятельная', ico: '📝', hint: 'Ответ сдаётся без проверки (можно один раз изменить), результат и оценка — после сдачи. Полный экран, уходы со вкладки видны вам онлайн.' },
    practice: { name: 'Практическая', ico: '🛠', hint: 'Ученик сразу видит, верно или нет, — две попытки на задание. Оценка ставится сама: верно с 1-й попытки — полный балл, со 2-й — половина, ошибка — 0.' },
    home: { name: 'Домашняя работа', ico: '🏠', hint: 'Как практическая: проверка сразу, две попытки, оценка ставится сама по попыткам и ответам.' },
  };
  /** Тип уже выданной работы меняется — предупредить, что станет с теми, кто уже решает. */
  function kindChangeOk(was, now) {
    if (!was || was === now) return true;
    return confirm(was === 'self'
      ? `Сделать работу «${KINDS[now].name}»? Кто уже начал самостоятельную — она сдастся по уже данным ответам (в журнал), дальше ученики решают с проверкой сразу.`
      : 'Сделать работу самостоятельной? Ученики, которые ещё не решали, будут сдавать её без проверки; уже данные ответы остаются в журнале.');
  }
  const keptNote = r => (r && r.ended ? ` · сдано начатых самостоятельных: ${r.ended}` : '');
  document.addEventListener('change', async e => {
    const bk = e.target.closest('[data-batch-kind]');
    if (!bk || !curClass) return;
    if (!kindChangeOk(bk.dataset.was, bk.value)) { bk.value = bk.dataset.was; return; }
    try {
      const r = await api('batch/kind', { class_id: curClass.id, batch: bk.dataset.batchKind, kind: bk.value });
      bk.dataset.was = bk.value;
      toast(`Тип изменён: ${KINDS[bk.value].name}` + (r.changed > 1 ? ` · у ${r.changed} учеников` : '') + keptNote(r));
    } catch (err) { bk.value = bk.dataset.was; if (err.status !== 401) toast(err.message); }
  });
  document.addEventListener('change', e => {
    const k = e.target.closest('#dKind, #bdKind');
    if (!k) return;
    const h = $('#' + k.id + 'Hint');
    if (h) h.textContent = KINDS[k.value].hint;
    if (k.id === 'bdKind') { BLD.d.kind = k.value; bldSave(); }
  });
  // ---------- личная подборка: результаты всех учеников пачки (у каждого своя копия — собираем по одной)
  let batchOpen = null, batchIds = [];
  const batchBox = () => batchOpen && [...document.querySelectorAll('[data-batch-box]')].find(x => x.dataset.batchBox === batchOpen);
  async function batchLoad() {
    const box = batchBox();
    if (!box) { batchOpen = null; return; }
    let parts;
    try { parts = await Promise.all(batchIds.map(id => api('asg/live?id=' + id))); } catch (e) { if (e.status !== 401) box.innerHTML = `<p class="adm-hint">${esc(e.message)}</p>`; return; }
    const rows = parts.flatMap(d => d.rows.map(r => ({ ...r, strict: d.strict, title: d.title }))).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const st = r => (r.strict ? { none: 'не начинал', work: 'пишет', done: 'сдал' } : { none: 'не начинал', work: 'решает', done: 'сделал все' })[r.status];
    const done = rows.filter(r => r.status === 'done').length, work = rows.filter(r => r.status === 'work').length;
    const grades = rows.filter(r => r.grade).map(r => r.grade), avg = grades.length ? (grades.reduce((a, b) => a + b, 0) / grades.length).toFixed(1) : '—';
    box.innerHTML = `<div class="adm-live-bar"><span class="adm-hint">Сделали все: <b>${done}</b> · решают: <b>${work}</b> · не начинали: <b>${rows.length - done - work}</b> из ${rows.length} · средняя оценка: <b>${avg}</b> · обновляется само</span></div>
      <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Ученик</th><th>Статус</th><th class="num">Сдано</th><th class="num">Верно</th><th class="num">Неверно</th><th class="num">%</th><th class="num">Оценка</th><th class="num" title="Заданий с прикреплённым решением">Код</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.status === 'work' ? 'live-work' : ''}"><td class="name"><button type="button" class="task-link" data-open-st="${r.id}">${esc(r.name)}</button></td>
        <td>${r.status === 'work' && r.online ? '<span class="live-dot" title="на сайте"></span>' : ''}${st(r)}${r.forced ? ' <span class="adm-hint">(завершил учитель)</span>' : ''}</td>
        <td class="num">${r.answered}/${r.total}</td><td class="num" style="color:var(--good)">${r.status === 'none' ? '' : r.ok + (r.half ? ` +${r.half}½` : '')}</td>
        <td class="num" style="color:var(--weak)">${r.status === 'none' ? '' : r.bad}</td><td class="num">${r.status === 'none' ? '' : r.pct + '%'}</td>
        <td class="num cs-grade">${r.grade ? `<b class="g${r.grade}">${r.grade}</b>` : ''}</td><td class="num">${r.status === 'none' && !r.sol ? '' : `${r.sol}/${r.tasks}`}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  document.addEventListener('click', e => {
    const bs = e.target.closest('[data-batch-stats]');
    if (!bs) return;
    const was = batchOpen;
    document.querySelectorAll('[data-batch-box]').forEach(x => { x.innerHTML = ''; });
    document.querySelectorAll('[data-batch-stats]').forEach(x => x.classList.remove('primary'));
    batchOpen = was === bs.dataset.batchStats ? null : bs.dataset.batchStats;
    if (!batchOpen) return;
    bs.classList.add('primary');
    batchIds = bs.dataset.ids.split(',').filter(Boolean).map(Number);
    batchBox().innerHTML = '<p class="adm-hint">Загружаю…</p>';
    batchLoad();
  });
  // ---------- работа класса: онлайн-сводка, «Завершить для всех»
  let liveTimer = null, liveId = null;
  function strictAsgHtml(a) {
    const total = a.tasks.length;
    return `<div class="adm-asg strict" data-live-box="${a.id}">
      <div class="adm-asg-head"><b>${(KINDS[a.kind] || KINDS.self).ico} ${esc(a.title)}</b>
        <span class="adm-hint">${(KINDS[a.kind] || KINDS.self).name.toLowerCase()} · ${total} ${plural(total, 'задание', 'задания', 'заданий')} · выдано ${fmtDate(a.created)}${a.closed ? ` · <b style="color:var(--weak)">завершена ${fmtWhen(a.closed)}</b>` : ''}</span>
        <span class="adm-actions"><button type="button" class="btn${liveId === a.id ? ' primary' : ''}" data-live="${a.id}">${liveId === a.id ? 'Скрыть онлайн' : '● Онлайн'}</button>
        <button type="button" class="btn ghost" data-asg-edit="${a.id}">Изменить</button>
        <button type="button" class="btn ghost danger" data-asg-del="${a.id}">Удалить</button></span></div>
      <div class="adm-live" id="live-${a.id}">${liveId === a.id ? '<p class="adm-hint">Загружаю…</p>' : ''}</div>
    </div>`;
  }
  let liveLoadAt = 0;
  async function liveLoad() {
    liveLoadAt = Date.now();
    const box = liveId && $('#live-' + liveId);
    if (!box) { clearInterval(liveTimer); liveId = null; return; }
    let d;
    try { d = await api('asg/live?id=' + liveId); } catch (e) { if (e.status !== 401) box.innerHTML = `<p class="adm-hint">${esc(e.message)}</p>`; return; }
    const st = d.strict ? { none: 'не начинал', work: 'пишет', done: 'сдал' } : { none: 'не начинал', work: 'решает', done: 'сделал все' };
    const rows = d.rows.map(r => `<tr class="${r.status === 'work' ? 'live-work' : ''}">
      <td class="name"><button type="button" class="task-link" data-open-st="${r.id}">${esc(r.name)}</button></td>
      <td>${r.status === 'work' && r.online ? '<span class="live-dot" title="на сайте"></span>' : ''}${st[r.status]}${r.forced ? ' <span class="adm-hint">(завершил учитель)</span>' : ''}</td>
      <td class="num">${r.answered}/${r.total}</td>
      <td class="num" style="color:var(--good)">${r.status === 'none' ? '' : r.ok + (r.half ? ` +${r.half}½` : '')}</td>
      <td class="num" style="color:var(--weak)">${r.status === 'none' ? '' : r.bad}</td>
      <td class="num">${r.status === 'none' ? '' : r.pct + '%'}</td>
      <td class="num cs-grade">${r.grade ? `<b class="g${r.grade}">${r.grade}</b>` : ''}</td>
      <td class="num">${r.away ? `<b style="color:var(--review)">${r.away}</b>` : ''}</td>
      <td class="num">${r.fs ? `<b style="color:var(--weak)">${r.fs}</b>` : ''}</td>
      <td class="num" title="Заданий с прикреплённым решением (кодом)">${r.status === 'none' && !r.sol ? '' : `${r.sol}/${r.tasks}`}</td></tr>`).join('');
    const work = d.rows.filter(r => r.status === 'work').length, done = d.rows.filter(r => r.status === 'done').length;
    box.innerHTML = `<div class="adm-live-bar"><span class="adm-hint">${d.strict ? 'Пишут' : 'Решают'}: <b>${work}</b> · ${d.strict ? 'сдали' : 'сделали все'}: <b>${done}</b> из ${d.rows.length} · обновляется каждые 5 секунд.
        ${d.strict ? 'Верно/неверно видите только вы — ученик узнает результат после сдачи.' : 'Оценка ставится сама: верно с 1-й попытки — полный балл, со 2-й — половина.'}</span>
      ${d.closed ? `<button type="button" class="btn ghost" data-reopen="${d.id}">Открыть снова</button>`
        : `<button type="button" class="btn danger" data-close="${d.id}">Завершить для всех</button>`}</div>
      <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Ученик</th><th>Статус</th><th class="num">Сдано</th><th class="num">Верно</th>
        <th class="num">Неверно</th><th class="num">%</th><th class="num">Оценка</th><th class="num" title="Уходы со вкладки">Уходы</th><th class="num" title="Выходы из полного экрана">Выходы из полн. экрана</th><th class="num" title="Заданий с прикреплённым решением">Решения</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="10" class="adm-hint">В классе нет учеников.</td></tr>'}</tbody></table></div>`;
  }
  $('#classBody').addEventListener('click', async e => {
    const lv = e.target.closest('[data-live]');
    if (lv) {
      const id = +lv.dataset.live, prev = liveId;
      liveId = liveId === id ? null : id;
      clearInterval(liveTimer);
      [prev, id].forEach(asgCardRedraw);
      // живое соединение: сводка обновляется по событиям ленты, опрос раз в 30 с — страховка; без него — каждые 5 с
      if (liveId) { liveLoad(); liveTimer = setInterval(() => { if (!liveOn() || Date.now() - liveLoadAt > 30000) liveLoad(); }, 5000); }
      return;
    }
    const cl = e.target.closest('[data-close]');
    if (cl) {
      if (!confirm('Завершить работу для всех? Оценка ставится по уже сданным ответам. Начать её больше будет нельзя.')) return;
      try { const r = await api('asg/close', { id: +cl.dataset.close }); toast(`Работа завершена${r.finished ? ` · сдано за учеников: ${r.finished}` : ''}`); }
      catch (err) { toast(err.message); return; }
      await refreshClassAsg(); liveLoad();
      return;
    }
    const ro = e.target.closest('[data-reopen]');
    if (ro) {
      try { await api('asg/close', { id: +ro.dataset.reopen, reopen: true }); } catch (err) { toast(err.message); return; }
      await refreshClassAsg(); liveLoad();
    }
  });
  function asgCardRedraw(id) {
    const a = id && curClass.assignments.find(x => x.id === id), box = id && $(`[data-live-box="${id}"]`);
    if (a && box) box.outerHTML = strictAsgHtml(a);
  }
  async function refreshClassAsg() {
    try { curClass.assignments = (await api('assignments?class_id=' + curClass.id)).assignments; } catch (e) { return; }
    curClass.assignments.forEach(a => asgCardRedraw(a.id));
  }

  // ---------- статистика класса за период: урок, день, неделя — по всем заданиям или по подборке
  const GRADE_KEY = 'egeAdmin.grades';
  const grades = () => { try { return Object.assign({ 5: 85, 4: 65, 3: 45 }, JSON.parse(localStorage.getItem(GRADE_KEY)) || {}); } catch (e) { return { 5: 85, 4: 65, 3: 45 }; } };
  const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  let csData = null;
  function setCsPreset(kind) {
    if (!$('#csFrom')) return;
    const now = new Date(), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    let from = d0.getTime(), to = now.getTime() + 60e3;
    if (kind === 'lesson') from = now.getTime() - 3600e3;
    if (kind === 'yesterday') { to = d0.getTime(); from = to - 864e5; }
    if (kind === 'week') from = d0.getTime() - 6 * 864e5;
    $('#csFrom').value = toLocalInput(from);
    $('#csTo').value = toLocalInput(to);
    $$('#csPreset button').forEach(b => b.classList.toggle('on', b.dataset.cs === kind));
    const g = grades();
    $$('.cls-grade-cfg [data-g]').forEach(i => { i.value = g[i.dataset.g]; });
    loadClassStats();
  }
  async function loadClassStats() {
    if (!curClass) return;
    const from = new Date($('#csFrom').value).getTime() / 1000, to = new Date($('#csTo').value).getTime() / 1000;
    if (!(from < to)) { $('#csTable').innerHTML = '<p class="adm-hint">Начало периода должно быть раньше конца.</p>'; return; }
    try {
      csData = await api(`class/stats?class_id=${curClass.id}&from=${from}&to=${to}&asg=${$('#csAsg').value || ''}`);
    } catch (err) { if (err.status !== 401) toast(err.message); return; }
    csData.from = from; csData.to = to; csData.asgTitle = $('#csAsg').selectedOptions[0].textContent;
    renderClassStats();
  }
  function csPercent(r) {
    if (csData.asg_total != null) return csData.asg_total ? r.solved / csData.asg_total : 0;
    return r.tasks ? r.solved / r.tasks : 0;
  }
  function csGrade(r) {
    if (!r.tasks) return '';
    const p = pct(csPercent(r)), g = grades();
    return p >= g[5] ? 5 : p >= g[4] ? 4 : p >= g[3] ? 3 : 2;
  }
  function renderClassStats() {
    const asg = csData.asg_total != null;
    const rows = csData.rows.map(r => {
      const g = csGrade(r);
      return `<tr${r.tasks ? '' : ' class="muted-row"'}>
        <td class="name">${esc(r.name)}</td>
        <td class="num"><b>${asg ? `${r.solved} / ${csData.asg_total}` : r.solved}</b></td>
        <td class="num">${r.tasks}</td><td class="num">${r.ok1}</td><td class="num">${r.ok2}</td><td class="num">${r.bad}</td>
        <td class="num">${r.shown || ''}</td>
        <td class="num">${r.tasks ? pct(csPercent(r)) + '%' : '<span class="muted">—</span>'}</td>
        <td class="num">${r.spent ? fmtSpent(r.spent) : ''}</td>
        <td class="num">${r.out_n ? `<span style="color:var(--review)" title="уходов со страницы: ${r.out_n}">${r.out_n} · ${fmtSpent(r.out_sec * 1000) || '0 с'}</span>` : ''}</td>
        <td class="num">${r.sus || r.paste ? `<span style="color:var(--weak)" title="⚠ ушёл на 30+ с и сразу верно · 📋 вставил ответ">${r.sus ? '⚠' + r.sus : ''}${r.sus && r.paste ? ' ' : ''}${r.paste ? '📋' + r.paste : ''}</span>` : ''}</td>
        <td class="muted">${r.nums.join(', ')}</td>
        <td class="num">${r.exam != null ? r.exam : ''}</td>
        <td class="num cs-grade">${g ? `<b class="g${g}">${g}</b>` : ''}</td></tr>`;
    }).join('');
    const worked = csData.rows.filter(r => r.tasks).length;
    $('#csTable').innerHTML = `<p class="adm-hint">${fmtDate(csData.from)} ${fmtTime(csData.from)} — ${fmtDate(csData.to)} ${fmtTime(csData.to)} · ${esc(csData.asgTitle)} ·
        занимались ${worked} из ${csData.rows.length}. Вариант ЕГЭ в счёт заданий не идёт — его балл в отдельном столбце.</p>
      <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
        <th>Ученик</th><th class="num">${asg ? 'Решено из подборки' : 'Решено'}</th><th class="num" title="Разных заданий, к которым приступал">Начал</th>
        <th class="num">С 1-й</th><th class="num">Со 2-й</th><th class="num">Неверно</th><th class="num" title="Открыл ответ, не решив">Ответ показан</th>
        <th class="num">%</th><th class="num">Время</th><th class="num" title="Сколько раз уходил со страницы и сколько всего был вне тренажёра">Вне тренажёра</th>
        <th class="num" title="⚠ — ушёл со страницы на 30+ с и сразу ответил верно; 📋 — вставил ответ из буфера">Отметки</th><th>Номера</th>
        <th class="num">Вариант</th><th class="num">Оценка</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function csCsv() {
    if (!csData) return;
    const asg = csData.asg_total != null;
    const head = ['Ученик', asg ? 'Решено из подборки' : 'Решено', 'Начал', 'Верно с 1-й', 'Со 2-й', 'Неверно', 'Ответ показан', '%', 'Время, мин', 'Уходов со страницы', 'Вне тренажёра, мин', 'Ушёл и сразу верно', 'Вставил ответ', 'Номера', 'Вариант', 'Оценка (подсказка)'];
    const q = v => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [head, ...csData.rows.map(r => [r.name, asg ? `${r.solved} из ${csData.asg_total}` : r.solved, r.tasks, r.ok1, r.ok2, r.bad, r.shown,
      r.tasks ? pct(csPercent(r)) : '', Math.round(r.spent / 60000), r.out_n, Math.round(r.out_sec / 60), r.sus, r.paste, r.nums.join(' '), r.exam == null ? '' : r.exam, csGrade(r)])];
    const csv = '﻿' + lines.map(l => l.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${curClass.name} ${fmtDate(csData.from)}.csv`.replace(/[\\/:*?"<>|]/g, '-');
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  $('#classBody').addEventListener('click', e => {
    const p = e.target.closest('[data-cs]');
    if (p) return setCsPreset(p.dataset.cs);
    if (e.target.closest('#csShow')) { $$('#csPreset button').forEach(b => b.classList.remove('on')); return loadClassStats(); }
    if (e.target.closest('#csCsv')) return csCsv();
  });
  $('#classBody').addEventListener('change', e => {
    if (e.target.id === 'csAsg') return loadClassStats();
    if (e.target.matches('.cls-grade-cfg [data-g]')) {
      const g = grades(); g[e.target.dataset.g] = +e.target.value || 0;
      try { localStorage.setItem(GRADE_KEY, JSON.stringify(g)); } catch (err) { /* не страшно */ }
      if (csData) renderClassStats();
    }
  });
  $('#classBody').addEventListener('submit', async e => {
    if (e.target.id !== 'goalForm' || !curClass) return;
    e.preventDefault();
    try {
      const r = await api('class/goal', { id: curClass.id, goal_tasks: +$('#goalTasks').value || 0, goal_reward: $('#goalReward').value,
        battle: $('#goalBattle').checked });
      curClass.goal = r.goal_tasks; curClass.reward = r.goal_reward; curClass.battle = r.battle;
      await fetchClasses();
      toast(!r.battle ? 'Класс не участвует в битве классов' : r.goal_tasks ? `В битве · цель: ${r.goal_tasks} заданий за неделю` : 'Класс участвует в битве классов');
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#classBody').addEventListener('click', async e => {
    const c = curClass;
    if (!c) return;
    const t = e.target;
    if (t.closest('#classRename')) {
      const name = prompt('Название класса', c.name);
      if (!name) return;
      try { await api('class/save', { id: c.id, name }); loadClasses(); } catch (err) { toast(err.message); }
      return;
    }
    if (t.closest('#classDelete')) {
      if (!confirm(`Удалить класс «${c.name}»? Ученики вернутся в «Новые ученики», их результаты сохранятся. Подборки класса удалятся.`)) return;
      try { await api('class/delete', { id: c.id }); curClass = null; loadClasses(); } catch (err) { toast(err.message); }
      return;
    }
    const un = t.closest('[data-unclass]');
    if (un) {
      try { await api('class/members', { class_id: null, students: [+un.dataset.unclass] }); await fetchClasses(); renderClassList(); openClass(c.id); }
      catch (err) { toast(err.message); }
      return;
    }
    const pane = t.closest('#clsTabs [data-pane]');
    if (pane) { showClsPane(pane.dataset.pane); return; }
    const ja = t.closest('[data-jr-asg]');
    if (ja) {
      showClsPane('asg');
      const id = +ja.dataset.jrAsg;
      if (liveId !== id) { const b = $(`[data-live="${id}"]`); if (b) b.click(); }
      setTimeout(() => { const box = $(`[data-live-box="${id}"]`); if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
      return;
    }
    if (t.closest('[data-weak]')) { giveWeakSets(); return; }
    const bd = t.closest('[data-batch-del]');
    if (bd) {
      if (!confirm('Удалить эти личные подборки у всех учеников? Решённое останется в журнале.')) return;
      try { await api('batch/delete', { class_id: curClass.id, batch: bd.dataset.batchDel }); } catch (err) { toast(err.message); return; }
      openClass(curClass.id);
      return;
    }
    const hn = t.closest('[data-hm-n]');
    if (hn) { openBuilderFor(curClass.id, +hn.dataset.hmN); return; }
    if (t.closest('#asgToBuilder')) { openBuilderFor(curClass.id); return; }
    const openSt = t.closest('[data-open-st]') || (!t.closest('button') && t.closest('#classTable tr[data-id]'));
    if (openSt) { openStudent(+(openSt.dataset.openSt || openSt.dataset.id)); return; }
    if (t.closest('#asgNew')) { editAssignment(null); return; }
    const ed = t.closest('[data-asg-edit]');
    if (ed) { editAssignment(c.assignments.find(a => a.id === +ed.dataset.asgEdit)); return; }
    const del = t.closest('[data-asg-del]');
    if (del) {
      if (!confirm('Удалить подборку? Решённые задания останутся в журнале.')) return;
      try { await api('assignment/delete', { id: +del.dataset.asgDel }); openClass(c.id); } catch (err) { toast(err.message); }
    }
  });

  // ------------------------------------------------------------ конструктор подборки
  let draft = null;           // { id, title, due, tasks: [{ id, n, snip }] }
  function editAssignment(a) {
    draft = a ? { id: a.id, title: a.title, due: a.due, kind: a.kind || 'self', origKind: a.kind || 'self', tasks: a.tasks.filter(t => !t.missing).map(t => ({ id: t.id, n: t.n, snip: t.snip })) }
      : { id: null, title: '', due: null, kind: 'self', tasks: [] };
    renderDraft();
    $('#asgEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderDraft() {
    const box = $('#asgEditor');
    if (!draft) { box.innerHTML = ''; return; }
    const due = draft.due ? new Date(draft.due * 1000).toISOString().slice(0, 10) : '';
    box.innerHTML = `<form class="adm-box adm-draft" id="draftForm">
      <h3 class="adm-h3" style="margin:0">${draft.id ? 'Изменить подборку' : 'Новая подборка'} для ${esc(curClass.name)}</h3>
      <div class="adm-draft-row">
        <input class="inp" id="dTitle" placeholder="Название, например «Графы: №1 и №15»" maxlength="80" value="${esc(draft.title)}" required>
        <label class="adm-hint">срок <input class="inp" type="date" id="dDue" value="${due}"${draft.id ? '' : ` min="${todayIso()}"`}></label>
      </div>
<label class="adm-hint">Тип работы <select class="adm-select" id="dKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${(draft.kind || 'self') === k ? ' selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <p class="adm-hint" id="dKindHint">${KINDS[draft.kind || 'self'].hint}</p>
      <div class="adm-draft-row">
        <span class="adm-hint">Добавить случайные:</span>
        <select class="adm-select" id="dNum">${Array.from({ length: 27 }, (_, i) => `<option value="${i + 1}">№${i + 1}</option>`).join('')}</select>
        <select class="adm-select" id="dCount">${[1, 2, 3, 5, 10].map(k => `<option>${k}</option>`).join('')}</select>
        <button type="button" class="btn" id="dPick">Добавить</button>
        <span class="adm-hint">или по номеру КомпЕГЭ / коду ФИПИ:</span>
        <input class="inp" id="dFind" placeholder="например 10009" style="width:150px">
        <button type="button" class="btn" id="dFindBtn">Найти</button>
      </div>
      <ol class="adm-draft-list">${draft.tasks.map((t, i) => `<li><span class="num-badge sm">${t.n || '?'}</span>
        <button type="button" class="task-link" data-task="${esc(t.id)}">${esc(t.snip || t.id)}</button>
        <span class="adm-draft-tools"><button type="button" class="link-btn" data-up="${i}" title="Выше">↑</button>
        <button type="button" class="link-btn danger" data-rm="${i}" title="Убрать">×</button></span></li>`).join('')}</ol>
      ${draft.tasks.length ? '' : '<p class="adm-hint">Заданий пока нет — добавьте случайные по номеру или найдите конкретные.</p>'}
      <div class="adm-draft-row">
        <button type="submit" class="btn primary">${draft.id ? 'Сохранить' : 'Отправить классу'} · ${draft.tasks.length} ${plural(draft.tasks.length, 'задание', 'задания', 'заданий')}</button>
        <button type="button" class="btn ghost" id="dCancel">Отмена</button>
      </div></form>`;
  }
  $('#classBody').addEventListener('submit', async e => {
    if (e.target.id !== 'draftForm') return;
    e.preventDefault();
    draft.title = $('#dTitle').value;
    const due = $('#dDue').value;
    try {
      if (!kindChangeOk(draft.id && draft.origKind, $('#dKind').value)) return;
      const r = await api('assignment/save', { id: draft.id, class_id: curClass.id, title: draft.title, kind: $('#dKind').value, grading: grades(),
        due: due ? new Date(due + 'T23:59:00').getTime() / 1000 : null, tasks: draft.tasks.map(t => t.id) });
      toast(draft.id ? 'Подборка сохранена' + keptNote(r) : 'Подборка отправлена классу');
      draft = null;
      openClass(curClass.id);
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#classBody').addEventListener('click', async e => {
    if (!draft) return;
    const t = e.target;
    const keep = () => { draft.kind = $('#dKind').value; draft.title = $('#dTitle').value; const d = $('#dDue').value; draft.due = d ? new Date(d + 'T23:59:00').getTime() / 1000 : null; };
    if (t.closest('#dCancel')) { draft = null; renderDraft(); return; }
    if (t.closest('#dPick')) {
      keep();
      const n = $('#dNum').value, k = $('#dCount').value;
      try {
        const d = await api(`bank/pick?n=${n}&count=${k}&skip=${encodeURIComponent(draft.tasks.map(x => x.id).join(','))}`);
        if (!d.tasks.length) toast('Заданий этого номера больше нет');
        draft.tasks.push(...d.tasks);
        renderDraft();
        $('#dNum').value = n; $('#dCount').value = k;
      } catch (err) { toast(err.message); }
      return;
    }
    if (t.closest('#dFindBtn')) {
      keep();
      const q = $('#dFind').value.trim();
      if (!q) return;
      try {
        const d = await api('bank/find?q=' + encodeURIComponent(q));
        if (draft.tasks.some(x => x.id === d.id)) toast('Это задание уже в подборке');
        else draft.tasks.push(d);
        renderDraft();
      } catch (err) { toast(err.message); }
      return;
    }
    const up = t.closest('[data-up]');
    if (up) { keep(); const i = +up.dataset.up; if (i > 0) [draft.tasks[i - 1], draft.tasks[i]] = [draft.tasks[i], draft.tasks[i - 1]]; renderDraft(); return; }
    const rm = t.closest('[data-rm]');
    if (rm) { keep(); draft.tasks.splice(+rm.dataset.rm, 1); renderDraft(); }
  });
  $('#classBody').addEventListener('keydown', e => {
    if (e.target.id === 'dFind' && e.key === 'Enter') { e.preventDefault(); $('#dFindBtn').click(); }
  });

  // ------------------------------------------------------------ карточка ученика
  let st = null;          // { student, attempts, forecast_history }
  let jFilter = 'all', jNum = null;
  async function openStudent(id) {
    const days = +$('#stPeriod').value;
    let from = 0;
    if (days) { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime() / 1000 - (days - 1) * 86400; }
    try {
      st = await api(`student?id=${id}&from=${from}`);
    } catch (e) { if (e.status !== 401) toast(e.message); return; }
    jNum = null;
    go('student');
    renderStudent();
  }
  $('#stPeriod').addEventListener('change', () => { if (st) openStudent(st.student.id); });
  $('#stTeacher').addEventListener('change', async e => {
    const t = teachers.find(x => x.id === +e.target.value);
    if (!confirm(`Передать ученика учителю «${t ? t.name : ''}»? Класс у ученика снимется.`)) { renderStudent(); return; }
    try {
      await api('student/teacher', { id: st.student.id, teacher_id: +e.target.value });
      st.student.teacher_id = +e.target.value;
      st.student.class_id = null;
      await fetchClasses();
      renderStudent();
      toast('Ученик передан');
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#stClass').addEventListener('change', async e => {
    try {
      await api('class/members', { class_id: +e.target.value || null, students: [st.student.id] });
      st.student.class_id = +e.target.value || null;
      await fetchClasses();
      toast('Класс изменён');
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#backBtn').addEventListener('click', () => { if (backTab === 'classes' && curClass) { go('classes'); } else go('students'); });

  function renderStudent() {
    const s = st.student, A = st.attempts;
    $('#stName').innerHTML = esc(s.name) + (s.role === 'admin' ? ' <span class="adm-tag">👑 admin</span>' : '');
    $('#stRole').textContent = s.role === 'admin' ? 'Снять плашку admin' : '👑 Плашка admin';
    const periodDays = +$('#stPeriod').value;
    let from = 0;
    if (periodDays) { const d = new Date(); d.setHours(0, 0, 0, 0); from = d.getTime() / 1000 - (periodDays - 1) * 86400; }
    $('#stExport').href = `api/admin/export.csv?student=${s.id}&from=${from}`;

    const ok1 = A.filter(a => a.score === 1).length;
    const ok2 = A.filter(a => a.score === 0.5).length;
    const bad = A.length - ok1 - ok2;
    const spent = A.reduce((x, a) => x + (a.spent_ms || 0), 0);
    const fh = st.forecast_history || [];
    let trend = '';
    if (fh.length > 1) {
      const lim = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
      const old = fh.filter(x => x.d <= lim).pop() || fh[0];
      const dlt = fh[fh.length - 1].s - old.s;
      trend = dlt ? `${dlt > 0 ? '▲ +' : '▼ '}${dlt} с ${old.d.split('-').reverse().slice(0, 2).join('.')}` : 'без изменений';
    }
    const rv = st.reveals || { granted: 0, blocked: 0, early: 0 };
    const act = st.activity || {};
    const nSus = A.filter(a => flagsOf(a).includes('sus')).length, nPaste = A.filter(a => flagsOf(a).includes('paste')).length;
    $('#stClass').innerHTML = '<option value="0">Без класса</option>' + classes
      .filter(c => !ME.is_main || c.teacher_id === s.teacher_id)
      .map(c => `<option value="${c.id}" ${c.id === s.class_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    $('#stTeacher').innerHTML = teachers.map(t =>
      `<option value="${t.id}" ${t.id === s.teacher_id ? 'selected' : ''}>Учитель: ${esc(t.name)}</option>`).join('');
    const exams = st.exams || [];
    const card = (k, v, sub, color) => `<div class="adm-card"><div class="k">${k}</div><div class="v"${color ? ` style="color:${color}"` : ''}>${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    $('#stCards').innerHTML = [
      card('Решено заданий', A.length, A.length ? `${ok1} верно · ${ok2} со 2-й · ${bad} ошибок` : 'за выбранный период'),
      card('Верно с 1-й попытки', A.length ? pct(ok1 / A.length) + '%' : '—', '',
        A.length ? (ok1 / A.length >= 0.8 ? 'var(--good)' : ok1 / A.length >= 0.5 ? 'var(--mid)' : 'var(--weak)') : ''),
      card('Прогноз ЕГЭ', s.forecast != null ? s.forecast : '—', s.forecast != null ? trend : 'появится после 10 ответов'),
      card('Время на задания', spent ? fmtMinutes(spent) : '—', A.length && spent ? `в среднем ${fmtSpent(spent / A.length)} на задание` : ''),
      card('Был(а) на сайте', `<span style="font-size:16px">${fmtWhen(s.last_seen)}</span>`, `в тренажёре с ${fmtDate(s.created)}`),
      card('Показал ответ', rv.granted, [
        rv.blocked ? `<span style="color:var(--weak)">упёрся в лимит: ${rv.blocked}</span>` : '',
        rv.early ? `просил раньше времени: ${rv.early}` : '',
        A.length ? `${pct(rv.granted / A.length)}% заданий` : ''].filter(Boolean).join(' · '),
        rv.blocked || (A.length >= 10 && rv.granted / A.length >= 0.5) ? 'var(--weak)' : ''),
      card('Уровень', st.game ? `${st.game.level}` : '—', st.game ? `${esc(st.game.title)} · ${st.game.xp} XP · за неделю +${st.game.week} · достижений ${(st.game.ach || []).filter(a => a.got).length}` : ''),
      card('Огонёк', st.game ? `🔥 ${st.game.fire}` : '—', st.game
        ? `заморозок ❄️ ${st.game.freezes || 0} из 4 · <button type="button" class="btn ghost" data-fire-restore title="Например, после сбоя сервера: недостающие дни засчитаются огоньку">Восстановить</button>` : ''),
      card('Уходил со вкладки', act.away ? act.away.count : 0, [
        act.away ? `всего ${fmtMinutes(act.away.sec * 1000)}` : 'ни разу за период',
        nSus ? `<span style="color:var(--weak)">⚠ ушёл и сразу верно: ${nSus}</span>` : '',
        nPaste ? `<span style="color:var(--weak)">📋 вставил ответ: ${nPaste}</span>` : '',
        act.away && act.away.exam ? `<span style="color:var(--weak)">во время варианта: ${act.away.exam}</span>` : '',
        act.shot ? `<span style="color:var(--weak)">клавиши снимка экрана: ${act.shot.count}</span>` : ''].filter(Boolean).join(' · '),
        (act.shot && act.shot.count) || (act.away && act.away.exam) || nSus || nPaste ? 'var(--weak)' : ''),
      card('Варианты ЕГЭ', exams.length ? exams[0].test_score : '—', exams.length
        ? `последний ${fmtDate(exams[0].finished)}: ${exams[0].primary_score} перв. · ${fmtMinutes((exams[0].finished - exams[0].started) * 1000)}${exams.length > 1 ? ` · всего ${exams.length}, лучший ${Math.max(...exams.map(e => e.test_score))}` : ''}`
          + (exams[0].away || exams[0].fs || exams[0].paste
            ? `<br><span style="color:var(--weak)">строгий режим: уходов ${exams[0].away}${exams[0].away_sec ? ` (${fmtMinutes(exams[0].away_sec * 1000)})` : ''}, выходов из полного экрана ${exams[0].fs}${exams[0].paste ? `, вставок ${exams[0].paste}` : ''}</span>`
            : '<br>строгий режим: без нарушений')
        : 'ещё не решал'),
    ].join('');
    $('#stExams').innerHTML = exams.length ? `<h3 class="adm-h3">Варианты ЕГЭ · ${exams.length}</h3>
      <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Сдан</th><th class="num">Тестовый</th><th class="num">Первичный</th>
        <th class="num">Верно целиком</th><th class="num">Без ответа</th><th class="num">Время</th><th class="num" title="Уходы со страницы / выходы из полного экрана во время варианта">Уходы</th><th></th></tr></thead>
      <tbody>${exams.map(x => `<tr><td>${fmtWhen(x.finished)}</td><td class="num"><b class="exs b${x.test_score >= 80 ? 'g' : x.test_score >= 60 ? 'a' : x.test_score >= 40 ? 'm' : 'w'}">${x.test_score}</b></td>
        <td class="num">${x.primary_score} / 29</td><td class="num">${x.full} из ${x.total}</td><td class="num">${x.blank || ''}</td>
        <td class="num">${fmtMinutes((x.finished - x.started) * 1000)}</td><td class="num">${x.away || x.fs ? `<span style="color:var(--weak)">${x.away}/${x.fs}</span>` : ''}</td>
        <td class="num"><button type="button" class="btn ghost" data-exam="${esc(x.id)}">Разбор</button></td></tr>`).join('')}</tbody></table></div>` : '';
    const ipLine = $('#stIp');
    if (ipLine) {
      ipLine.hidden = false;
      ipLine.innerHTML = (s.consent_ok ? `Документы приняты ${fmtWhen(s.consent_ts)}${s.consent_ip ? ` с адреса <code>${esc(s.consent_ip)}</code>` : ''}. `
          : '<b>Документы ещё не приняты</b> — ученик примет их при следующем входе. ')
        + (s.has_password ? 'Пароль задан. ' : '<b>Пароль не задан</b> — ученик задаст его при следующем входе с кодом приглашения. ')
        + (s.last_ip ? `Последний вход с адреса <code>${esc(s.last_ip)}</code>${(st.same_ip || []).length
        ? `. С него же входили: ${st.same_ip.map(esc).join(', ')}. Для класса за одним адресом школы это нормально; много новых ФИО с одного адреса — повод проверить.`
        : ''}` : '');
    }

    // по номерам
    const per = {};
    for (const a of A) {
      const x = per[a.n] || (per[a.n] = { t: 0, ok: 0, bad: 0 });
      x.t++;
      if (a.score === 1) x.ok++;
      if (a.score === 0) x.bad++;
    }
    $('#stNums').innerHTML = Array.from({ length: 27 }, (_, i) => {
      const n = i + 1, x = per[n];
      const acc = x ? x.ok / x.t : null;
      const lv = !x ? 'none' : acc >= 0.8 ? 'good' : acc >= 0.5 ? 'mid' : 'weak';
      return `<button type="button" class="adm-num lv-${lv}${lv === 'none' ? ' none' : ''}${jNum === n ? ' on' : ''}" data-n="${n}" ${x ? '' : 'disabled'}>
        <span class="nn">№${n}</span>
        <span class="nc">${x ? `${x.t} · ${pct(acc)}% верно` : 'не решал'}</span>
        ${x && x.bad ? `<span class="nb">ошибок: ${x.bad}</span>` : ''}
      </button>`;
    }).join('');

    // по дням
    const byDay = new Map();
    for (const a of A) {
      const d = new Date(a.ts * 1000);
      const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(a);
    }
    $('#stDays').innerHTML = byDay.size ? [...byDay.entries()].map(([k, arr]) => {
      const d = new Date(arr[0].ts * 1000);
      const o1 = arr.filter(a => a.score === 1).length, o2 = arr.filter(a => a.score === 0.5).length;
      const bads = arr.filter(a => a.score === 0);
      const nums = [...new Set(arr.map(a => a.n))].sort((a, b) => a - b);
      const badByN = {};
      bads.forEach(a => { badByN[a.n] = (badByN[a.n] || 0) + 1; });
      const spentDay = arr.reduce((x, a) => x + (a.spent_ms || 0), 0);
      return `<div class="adm-day">
        <div class="d">${pad(d.getDate())}.${pad(d.getMonth() + 1)}<span>${WEEKDAYS[d.getDay()]}</span></div>
        <div>
          <b>${arr.length}</b> ${plural(arr.length, 'задание', 'задания', 'заданий')}: ${o1} верно${o2 ? `, ${o2} со 2-й попытки` : ''}, <span style="color:${bads.length ? 'var(--weak)' : 'inherit'}">${bads.length} ${plural(bads.length, 'ошибка', 'ошибки', 'ошибок')}</span>${spentDay ? ` · ${fmtMinutes(spentDay)}` : ''}
          <div class="chips">
            <span class="muted" style="font-size:12px">Номера: ${nums.map(n => '№' + n).join(', ')}</span>
          </div>
          ${bads.length ? `<div class="chips">${Object.entries(badByN).sort((a, b) => a[0] - b[0]).map(([n, c]) =>
            `<span class="chip weak" data-n="${n}">ошибка в №${n}${c > 1 ? ' ×' + c : ''}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
    }).join('') : '<p class="adm-empty">За выбранный период ученик не решал.</p>';

    renderAway();
    renderJournal();
  }

  /** Сводка «вне тренажёра» по дням: сколько раз уходил, сколько всего и на каких заданиях. */
  const AWAY_KIND = { away: 'ушёл со страницы', fs: 'вышел из полного экрана', paste: 'вставил ответ', shot: 'клавиши снимка экрана' };
  function renderAway() {
    const L = st.away_log || [];
    if (!L.length) { $('#stAway').innerHTML = '<p class="adm-empty">За выбранный период со страницы не уходил.</p>'; return; }
    const days = new Map();
    for (const e of L) {
      const k = fmtDate(e.ts);
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(e);
    }
    $('#stAway').innerHTML = [...days].map(([day, arr]) => {
      const aw = arr.filter(e => e.kind === 'away');
      const sec = aw.reduce((x, e) => x + (e.dur || 0), 0);
      const by = new Map();
      for (const e of aw) {
        const k = e.exam ? 'Вариант ЕГЭ' : e.n ? '№' + e.n : 'задание';
        const x = by.get(k) || { c: 0, s: 0 };
        x.c++; x.s += e.dur || 0;
        by.set(k, x);
      }
      const other = arr.filter(e => e.kind !== 'away');
      const chips = [...by].map(([k, x]) => `<span class="chip${x.s >= 60 ? ' weak' : ''}">${k}${x.c > 1 ? ' ×' + x.c : ''} · ${fmtSpent(x.s * 1000) || '0 с'}</span>`).join('')
        + other.map(e => `<span class="chip weak">${AWAY_KIND[e.kind] || e.kind}${e.exam ? ' (вариант)' : ''}</span>`).join('');
      const rows = arr.map(e => `<tr><td class="muted">${fmtTime(e.ts)}</td><td>${AWAY_KIND[e.kind] || e.kind}</td>
        <td class="num">${e.kind === 'away' ? fmtSpent(e.dur * 1000) || '—' : ''}</td>
        <td>${e.exam ? '<b>вариант ЕГЭ</b> · ' : ''}${e.n ? `<button type="button" class="task-link" data-task="${esc(e.task_id)}">№${e.n}</button> <span class="task-snip">${esc(e.snip || '')}</span>` : ''}</td></tr>`).join('');
      return `<div class="adm-away-day"><div class="adm-away-sum"><b>${day}</b> · уходил ${aw.length} ${plural(aw.length, 'раз', 'раза', 'раз')}, всего ${sec ? (sec < 60 ? fmtSpent(sec * 1000) : fmtMinutes(sec * 1000)) : '—'}
          <div class="chips">${chips}</div></div>
        <details><summary>Подробно</summary><div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Время</th><th>Что</th><th class="num">Сколько</th><th>Задание</th></tr></thead>
          <tbody>${rows}</tbody></table></div></details></div>`;
    }).join('');
  }

  function renderJournal() {
    const A = st.attempts.filter(a => (jNum == null || a.n === jNum) &&
      (jFilter === 'all' || (jFilter === 'flag' ? flagsOf(a).length > 0 : jFilter === 'bad' ? resultOf(a).bad : !resultOf(a).bad)));
    $$('#stFilters button').forEach(b => b.classList.toggle('on', b.dataset.f === jFilter));
    const nf = $('#numFilter');
    nf.hidden = jNum == null;
    nf.innerHTML = jNum == null ? '' : `только №${jNum} <button type="button" class="link-btn" id="clearNum">× сбросить</button>`;
    $$('#stNums .adm-num').forEach(b => b.classList.toggle('on', +b.dataset.n === jNum));
    $('#journalTitle').textContent = `Журнал · ${A.length} ${plural(A.length, 'запись', 'записи', 'записей')}`;
    $('#journalEmpty').hidden = A.length > 0;
    $('#stJournal').hidden = A.length === 0;
    // одна подборка — смена 05:00–16:15 или 16:15–05:00 (ночь — к вечеру прошлого дня); вариант ЕГЭ — своей подборкой
    const groups = new Map();
    for (const a of A) {
      let key, label;
      if (a.exam) {
        key = 'x:' + a.exam;
        label = `Вариант ЕГЭ · ${fmtDate(a.ts)}`;
      } else {
        const d = new Date(a.ts * 1000);
        const mins = d.getHours() * 60 + d.getMinutes();
        const day = mins >= 16 * 60 + 15 ? 'pm' : mins >= 5 * 60 ? 'am' : 'pm';
        if (mins < 5 * 60) d.setDate(d.getDate() - 1);
        key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${day}`;
        label = `${fmtDate(d.getTime() / 1000)} · ${day === 'am' ? '05:00–16:15' : '16:15–05:00'}`;
      }
      if (!groups.has(key)) groups.set(key, { label, exam: !!a.exam, rows: [] });
      groups.get(key).rows.push(a);
    }
    const groupHead = g => {
      const ok = g.rows.filter(a => !resultOf(a).bad).length;
      const spent = g.rows.reduce((x, a) => x + (a.spent_ms || 0), 0);
      const tasks = new Set(g.rows.map(a => a.task_id)).size;
      return `<tr class="j-group${g.exam ? ' j-exam' : ''}"><td colspan="8"><b>${esc(g.label)}</b>
        <span class="muted"> · ${tasks} ${plural(tasks, 'задание', 'задания', 'заданий')} · верно ${ok}, ошибок ${g.rows.length - ok}${spent ? ` · ${fmtSpent(spent)}` : ''}</span></td></tr>`;
    };
    $('#stJournal tbody').innerHTML = [...groups.values()].map(g => groupHead(g) + g.rows.map(a => {
      const r = resultOf(a);
      return `<tr>
        <td class="muted" style="white-space:nowrap">${fmtDate(a.ts)} ${fmtTime(a.ts)}</td>
        <td class="num"><b>${a.n}</b></td>
        <td><button type="button" class="task-link" data-task="${esc(a.task_id)}">${esc(BANK_NAMES[a.bank] || a.bank)} · ${esc(idOf(a.task_id))}</button>
            <span class="task-snip">${esc(a.snip || '')}</span></td>
        <td class="ans">${answersCell(a)}${a.has_code ? ` <button type="button" class="link-btn code-link" data-code="${esc(a.task_id)}" title="Решение, которое ученик прикрепил к заданию">код</button>` : ''}</td>
        <td class="ans">${esc(a.correct)}</td>
        <td><span class="res ${r.cls}">${r.text}</span>${flagsHtml(a)}</td>
        <td class="num muted">${fmtSpent(a.spent_ms)}</td>
        <td class="num">${a.away ? `<span style="color:var(--review)" title="уходил со вкладки, пока решал${a.away_sec ? ' · всего ' + fmtSpent(a.away_sec * 1000) : ''}">${a.away}${a.away_sec ? `<small> · ${fmtSpent(a.away_sec * 1000)}</small>` : ''}</span>` : ''}</td>
      </tr>`;
    }).join('')).join('');
  }
  $('#stFilters').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (b) { jFilter = b.dataset.f; renderJournal(); }
    if (e.target.id === 'clearNum') { jNum = null; renderJournal(); }
  });
  $('#stNums').addEventListener('click', e => {
    const b = e.target.closest('.adm-num');
    if (!b || b.disabled) return;
    const n = +b.dataset.n;
    jNum = jNum === n ? null : n;
    renderJournal();
    $('#journalTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#stDays').addEventListener('click', e => {
    const c = e.target.closest('.chip[data-n]');
    if (!c) return;
    jNum = +c.dataset.n;
    jFilter = 'bad';
    renderJournal();
    $('#journalTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#stRename').addEventListener('click', async () => {
    const s = st.student;
    const name = prompt('Новое ФИО ученика. Если такое ФИО уже есть, журналы объединятся.', s.name);
    if (!name || name.trim() === s.name) return;
    try {
      const r = await api('student/rename', { id: s.id, name });
      toast(r.merged_into ? 'Журналы объединены' : 'Переименовано');
      openStudent(r.merged_into || s.id);
    } catch (e) { if (e.status !== 401) toast(e.message); }
  });
  $('#stRole').addEventListener('click', async () => {
    const s = st.student, on = s.role !== 'admin';
    if (!confirm(on ? `Выдать «${s.name}» золотую плашку «👑 admin» рядом с именем на сайте?` : `Снять плашку «👑 admin» у «${s.name}»?`)) return;
    try { await api('student/role', { id: s.id, admin: on }); toast(on ? 'Плашка выдана' : 'Плашка снята'); openStudent(s.id); }
    catch (e) { if (e.status !== 401) toast(e.message); }
  });
  $('#stCards').addEventListener('click', async e => {
    if (!e.target.closest('[data-fire-restore]')) return;
    const s = st.student, now = (st.game && st.game.fire) || 0;
    const v = prompt(`Сколько дней огонька должно быть у «${s.name}»? Сейчас: ${now}.\nНедостающие дни до сегодняшнего засчитаются как восстановленные.`, String(Math.max(now, 1)));
    if (v == null) return;
    const days = parseInt(v, 10);
    if (!(days >= 1 && days <= 365)) { toast('Нужно число от 1 до 365'); return; }
    try {
      const r = await api('student/fire', { id: s.id, days });
      toast(r.added ? `Огонёк восстановлен: ${r.fire} дн.` : `Огонёк уже ${r.fire} дн. — восстанавливать нечего`);
      openStudent(s.id);
    } catch (x) { if (x.status !== 401) toast(x.message); }
  });
  $('#stPwReset').addEventListener('click', async () => {
    const s = st.student;
    if (!confirm(`Сбросить пароль ученика «${s.name}»?\n\nОн войдёт через «Регистрацию» с тем же ФИО и кодом приглашения и придумает новый пароль. Журнал и прогресс сохранятся.`)) return;
    try {
      await api('student/password-reset', { id: s.id });
      toast('Пароль сброшен');
      openStudent(s.id);
    } catch (e) { if (e.status !== 401) toast(e.message); }
  });
  $('#stDelete').addEventListener('click', async () => {
    const s = st.student;
    if (!confirm(`Удалить ученика «${s.name}» и весь его журнал? Это нельзя отменить.`)) return;
    try {
      await api('student/delete', { id: s.id });
      toast('Ученик удалён');
      go('students');
    } catch (e) { if (e.status !== 401) toast(e.message); }
  });

  // ------------------------------------------------------------ лента
  let feed = [], feedSince = 0, feedTimer = null, freshIds = new Set();
  // уведомления контрольных: начал, ушёл со вкладки, вышел из полного экрана, сдал
  let feedEv = [], evSince = 0, evPolled = false;
  const EV_TEXT = {
    start: () => 'начал(а) самостоятельную', away: e => `ушёл(ла) со вкладки${e.info ? ` на ${e.info} с` : ''}`,
    fs: () => 'вышел(ла) из полного экрана', finish: e => `сдал(а) самостоятельную${gradeOf(e)}`, forced: e => `работа завершена учителем${gradeOf(e)}`,
    exam: e => { try { const g = JSON.parse(e.info || '{}'); return `решил(а) вариант ЕГЭ · ${g.test} тест. баллов (${g.primary} перв.)`; } catch (err) { return 'решил(а) вариант ЕГЭ'; } },
    support: e => `написал(а) в техподдержку: «${e.info}»`,
  };
  function gradeOf(e) { try { const g = JSON.parse(e.info || '{}'); return g.grade ? ` · оценка ${g.grade} (${g.pct}%)` : ''; } catch (err) { return ''; } }
  const evWarn = k => k === 'fs' || k === 'away';
  function feedEvents(list, first) {
    ntfAdd((list || []).filter(e => NTF_KINDS[e.kind]).map(e => ({ ts: e.ts, kind: e.kind, sid: e.student_id, name: e.name,
      text: EV_TEXT[e.kind](e) + (e.kind === 'support' ? ` · ${e.title}` : e.kind === 'exam' ? '' : ` — «${e.title}»`) })));
    if (!list || !list.length) return;
    const fresh = list.filter(e => e.ts > evSince);
    if (!fresh.length) return;
    evSince = Math.max(evSince, ...fresh.map(e => e.ts));
    feedEv = fresh.concat(feedEv).slice(0, 100);
    // новое обращение — сразу в списке (если вы не пишете ответ: черновик не стираем)
    if (!first && tab === 'site' && fresh.some(e => e.kind === 'support')
      && ![...$$('#siteBody [data-sp]')].some(b => b.spImg || (b.querySelector('textarea') && b.querySelector('textarea').value.trim()))) loadSite();
    if (!first) {
      fresh.filter(e => evWarn(e.kind) || e.kind === 'finish' || e.kind === 'exam').slice(0, 3)
        .forEach(e => toast(`${evWarn(e.kind) ? '⚠ ' : e.kind === 'exam' ? '🎯 ' : '📝 '}${e.name}: ${EV_TEXT[e.kind](e)}${e.kind === 'exam' ? '' : ` — «${e.title}»`}`));
      if (tab !== 'feed') $('#feedDot').hidden = false;
    }
    renderFeedEvents();
  }
  function renderFeedEvents() {
    const box = $('#feedEvents');
    if (!box) return;
    box.hidden = !feedEv.length;
    box.innerHTML = `<h3 class="adm-h3">Работы и варианты · уведомления</h3><ul class="adm-events">${feedEv.slice(0, 30).map(e => `<li class="${evWarn(e.kind) ? 'warn' : ''}">
      <span class="muted">${fmtWhen(e.ts)}</span> <button type="button" class="task-link" data-student="${e.student_id}">${esc(e.name)}</button>
      ${esc(EV_TEXT[e.kind] ? EV_TEXT[e.kind](e) : e.kind)} ${e.kind === 'support' ? `<span class="muted">· ${esc(e.title)}</span>` : e.kind === 'exam' ? `<button type="button" class="link-btn" data-exam="${esc(e.exam)}">разбор</button>` : `<span class="muted">· «${esc(e.title)}»</span>`}</li>`).join('')}</ul>`;
  }
  async function pollFeed() {
    try {
      const d = await api(`feed?since=${feedSince}`);
      feedEvents(d.events, !evPolled);
      evPolled = true;
      // подозрительные ответы (ушёл со страницы и сразу верно, вставка ответа) — тоже в уведомления
      ntfAdd(d.attempts.filter(a => /sus|paste/.test(a.flags || '')).map(a => ({ ts: a.ts, kind: 'sus', sid: a.student_id, name: a.name,
        text: `${/paste/.test(a.flags) ? 'вставил(а) ответ из буфера' : 'ушёл(ла) со страницы и сразу ответил(а) верно'} — №${a.n}${a.exam ? ', вариант ЕГЭ' : /asg/.test(a.reason || '') ? ', работа от учителя' : ''}` })));
      if (d.attempts.length) {
        const first = feedSince === 0;
        d.attempts.forEach(a => { if (!first) freshIds.add(a.id); });
        feed = d.attempts.concat(feed).slice(0, 300);
        feedSince = Math.max(feedSince, ...d.attempts.map(a => a.ts));
        if (!first && tab !== 'feed') $('#feedDot').hidden = false;
        if (tab === 'feed') renderFeed();
        if (!first && tab === 'students') loadStudents();
      }
    } catch (e) { /* сервер недоступен — попробуем позже */ }
  }
  function startFeed() {
    clearInterval(feedTimer);
    feed = []; feedSince = 0; feedEv = []; evSince = 0; evPolled = false;
    pollFeed();
    // есть живое соединение — сервер сам скажет «в ленте новое», опрос раз в 2 минуты только на всякий случай
    feedTimer = setInterval(() => { if (!liveOn() || Date.now() - feedAt > 120000) feedNow(); }, 10000);
    liveStart();
  }
  let feedAt = 0, feedT = null;
  /** Обновить ленту: не чаще раза в 2 с (класс отвечает пачкой — один запрос). */
  function feedNow() {
    if (feedT) return;
    const wait = Math.max(0, feedAt + 2000 - Date.now());
    feedT = setTimeout(() => { feedT = null; feedAt = Date.now(); pollFeed(); feedSide(); }, wait);
  }

  /** Вместе с лентой — то, что открыто сейчас: онлайн-сводка работы и журнал класса (не чаще раза в 10 с). */
  let jrAt = 0;
  function feedSide() {
    if (liveId && $('#live-' + liveId)) liveLoad();
    if (batchOpen && batchBox()) batchLoad();
    const jr = tab === 'classes' && curClass && (clsPane === 'journal' || clsPane === 'nums');
    if (jr && Date.now() - jrAt > 10000) { jrAt = Date.now(); loadGradebook(); }
  }
  // живые обновления: одно соединение на браузер (вкладки делят его через Web Locks и BroadcastChannel), как у учеников
  const LV = { up: false, upAt: 0, sentAt: 0, chan: null, started: false, lead: false, dirty: false };
  const liveOn = () => LV.up && Date.now() - LV.upAt < 70000;
  function liveStart() {
    if (LV.started || !window.fetch || !window.ReadableStream || !window.TextDecoder) return;
    LV.started = true;
    const key = 'egeshka-live-teacher';
    if ('BroadcastChannel' in window) {
      LV.chan = new BroadcastChannel(key);
      LV.chan.onmessage = e => {
        const m = e.data || {};
        if (m.t === 'up') { LV.up = true; LV.upAt = Date.now(); }
        else if (m.t === 'down') LV.up = false;
        else if (m.t === 'hi' && LV.lead && liveOn()) LV.chan.postMessage({ t: 'up' });
        else if (m.t === 'ev') liveEvent(m.topic);
      };
    }
    if (navigator.locks && LV.chan) {
      LV.chan.postMessage({ t: 'hi' });
      navigator.locks.request(key, () => liveConnect()).catch(() => {});
    } else liveConnect();
  }
  function liveMark(up) {
    const was = LV.up;
    LV.up = up; LV.upAt = Date.now();
    if (LV.chan && (up !== was || Date.now() - LV.sentAt > 20000)) { LV.sentAt = Date.now(); LV.chan.postMessage({ t: up ? 'up' : 'down' }); }
  }
  async function liveConnect() {
    LV.lead = true;
    let delay = 3000, again = false;
    for (;;) {
      let got = false;
      try {
        const r = await fetch('api/admin/live', { credentials: 'same-origin', cache: 'no-store' });
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
            if (ev === 'hello') { got = true; if (again) liveSend('feed'); again = true; }   // переподключились — догнать пропущенное
            else if (ev) liveSend(ev);
          }
        }
      } catch (e) { /* сеть пропала — переподключимся */ }
      liveMark(false);
      delay = got ? 3000 : Math.min(delay * 2, 120000);
      await new Promise(res => setTimeout(res, delay + Math.random() * 2000));
    }
    LV.lead = false;
  }
  function liveSend(topic) {
    if (LV.chan) LV.chan.postMessage({ t: 'ev', topic });
    liveEvent(topic);
  }
  function liveEvent(topic) {
    if (topic !== 'feed') return;
    if (document.hidden) { LV.dirty = true; return; }
    feedNow();
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && LV.dirty) { LV.dirty = false; feedNow(); } });
  function renderFeed() {
    $('#feedEmpty').hidden = feed.length > 0;
    $('#feedTable').hidden = feed.length === 0;
    $('#feedTable tbody').innerHTML = feed.map(a => {
      const r = resultOf(a);
      return `<tr class="${freshIds.has(a.id) ? 'fresh' : ''}">
        <td class="muted" style="white-space:nowrap">${fmtWhen(a.ts)}</td>
        <td><button type="button" class="task-link" data-student="${a.student_id}">${esc(a.name)}</button></td>
        <td class="num"><b>${a.n}</b></td>
        <td><button type="button" class="task-link" data-task="${esc(a.task_id)}">${esc(BANK_NAMES[a.bank] || a.bank)} · ${esc(idOf(a.task_id))}</button>
            <span class="task-snip">${esc(a.snip || '')}</span></td>
        <td class="ans">${answersCell(a)}</td>
        <td class="ans">${esc(a.correct)}</td>
        <td><span class="res ${r.cls}">${r.text}</span>${flagsHtml(a)}</td>
      </tr>`;
    }).join('');
    freshIds.clear();
  }
  $('#feedEvents').addEventListener('click', e => {
    const b = e.target.closest('[data-student]');
    if (b) openStudent(+b.dataset.student);
  });
  $('#feedTable tbody').addEventListener('click', e => {
    const b = e.target.closest('[data-student]');
    if (b) openStudent(+b.dataset.student);
  });

  // ------------------------------------------------------------ решение ученика
  document.addEventListener('click', async e => {
    const x = e.target.closest('[data-exam]');
    if (!x) return;
    let r;
    try { r = await api('exam?id=' + encodeURIComponent(x.dataset.exam)); } catch (err) { if (err.status !== 401) toast(err.message); return; }
    const full = r.rows.filter(q => q.points === q.max).length;
    $('#taskBody').innerHTML = `<div class="adm-task-meta">Вариант ЕГЭ · ${esc(r.student)} · ${fmtWhen(r.finished)} · ${fmtMinutes((r.finished - r.started) * 1000)}</div>
      <h3 style="margin:6px 0 4px">${r.test} тестовых баллов · ${r.primary} первичных из 29 · верно целиком ${full} из ${r.rows.length}</h3>
      ${r.shown ? '' : '<p class="adm-hint">Ученик решал меньше 20 минут — правильные ответы ему не показывались (вам видны).</p>'}
      <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>№</th><th>Задание</th><th>Ответ ученика</th><th>Правильный</th><th class="num">Баллы</th></tr></thead>
      <tbody>${r.rows.map(q => `<tr class="${q.points === q.max ? 'ex-ok' : q.points ? 'ex-half' : 'ex-bad'}"><td class="num"><b>${q.n}</b></td>
        <td><button type="button" class="task-link" data-task="${esc(q.task)}">открыть</button> <span class="task-snip">${esc((q.snip || '').slice(0, 70))}</span></td>
        <td class="ans">${q.blank ? '<span class="muted">нет ответа</span>' : esc(q.mine)}</td><td class="ans">${esc(q.answer).replace(/\n/g, '<br>')}</td>
        <td class="num">${q.points} / ${q.max}</td></tr>`).join('')}</tbody></table></div>`;
    $('#taskModal').hidden = false;
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-code]');
    if (!b || !st) return;
    try {
      const r = await api(`solution?student=${st.student.id}&task=${encodeURIComponent(b.dataset.code)}`);
      $('#taskBody').innerHTML = `<div class="adm-task-meta">Решение ученика · ${esc(st.student.name)} · ${esc(idOf(b.dataset.code))} · ${fmtWhen(r.ts)}</div>
        <pre class="tsol">${esc(r.code)}</pre>
        <button type="button" class="btn" data-task="${esc(b.dataset.code)}">Открыть задание</button>`;
      $('#taskModal').hidden = false;
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });

  // ------------------------------------------------------------ просмотр задания
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-task]');
    if (!b) return;
    try {
      const t = await api('task?id=' + encodeURIComponent(b.dataset.task));
      const rows = String(t.ans || '').split('\n').filter(Boolean);
      $('#taskBody').innerHTML = `
        <div class="adm-task-meta"><span class="num-badge">${t.n}</span>${esc(BANK_NAMES[t.bank] || t.bank)} · ${esc(idOf(t.id))}${t.src ? ' · ' + esc(t.src) : ''}${t.link ? ` · <a href="${esc(t.link)}" target="_blank" rel="noopener">на сайте источника</a>` : ''}</div>
        <article class="cond">${safeHtml(t.html)}</article>
        ${(t.att || []).length ? `<div class="files"><span>Файлы:</span>${t.att.map(a => `<a class="file" href="${esc(a.href)}" target="_blank" rel="noopener">${esc(a.name)}</a>`).join('')}</div>` : ''}
        <div class="feedback show ok adm-task-ans"><div class="fb-title">Ответ</div><div class="right-answer" style="display:inline-block">${rows.map(esc).join('<br>')}</div></div>
        ${t.sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(t.sol)}</div></details>` : ''}
        <form class="adm-box tsol-form" id="tsolForm" data-id="${esc(t.id)}">
          <h3 class="adm-h3" style="margin:0">Ваше решение</h3>
          <p class="fm-note">Код или объяснение. Ученики увидят его после того, как ответят на это задание.</p>
          <textarea class="inp" id="tsolText" rows="8" spellcheck="false" placeholder="например:&#10;with open('17.txt') as f:&#10;    a = [int(x) for x in f]">${esc(t.teacher_sol || '')}</textarea>
          <div class="adm-draft-row"><button type="submit" class="btn primary">Сохранить решение</button><span class="login-err" id="tsolMsg"></span></div>
        </form>`;
      $('#taskModal').hidden = false;
      $$('#taskBody .cond table').forEach(tb => {
        const w = document.createElement('div'); w.className = 'table-wrap';
        tb.parentNode.insertBefore(w, tb); w.appendChild(tb);
      });
      if (window.renderMathInElement) {
        try {
          window.renderMathInElement($('#taskBody'), {
            delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
            throwOnError: false,
          });
        } catch (err) { /* формулы останутся текстом */ }
      }
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#taskModal').addEventListener('click', e => {
    if (e.target.id === 'taskModal' || e.target.closest('.fm-close')) $('#taskModal').hidden = true;
  });
  $('#taskModal').addEventListener('submit', async e => {
    if (e.target.id !== 'tsolForm') return;
    e.preventDefault();
    const msg = $('#tsolMsg');
    try {
      await api('task-solution', { task: e.target.dataset.id, text: $('#tsolText').value });
      msg.className = 'login-err ok';
      msg.textContent = $('#tsolText').value.trim() ? 'Сохранено — ученики увидят после ответа' : 'Решение удалено';
    } catch (err) { if (err.status !== 401) { msg.className = 'login-err'; msg.textContent = err.message; } }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#taskModal').hidden = true; });

  // ------------------------------------------------------------ настройки
  async function loadSettings() {
    $('#siteUrl').textContent = location.origin + '/';
    try {
      const d = await api('info');
      showMediaWarning(d);
      $('#infoLine').textContent = `В банке ${d.tasks} заданий · учеников: ${d.students} · записей в журнале: ${d.attempts}. Резервная копия — файл trainer/server_data/trainer.db.`;
      $('#inviteCode').value = d.invite || '';
      courseState(d.course_set, d.course_students);
      $('#authoredOn').checked = d.authored_on !== false;
      $('#authoredNote').textContent = `Авторских в банке: ${d.authored_tasks || 0} из ${d.tasks}. Ученики увидят изменение, когда обновят страницу. Найти задание по номеру и открыть из избранного или истории можно в любом случае.`;
    } catch (e) { /* не страшно */ }
  }
  $('#authoredOn').addEventListener('change', async e => {
    const msg = $('#authoredMsg');
    msg.className = 'login-err';
    msg.textContent = '';
    try {
      const r = await api('authored', { on: e.target.checked });
      e.target.checked = r.on;
      msg.className = 'login-err ok';
      msg.textContent = r.on ? 'Авторские задания включены' : 'Авторские задания убраны из подборок и вариантов';
    } catch (err) {
      e.target.checked = !e.target.checked;
      if (err.status !== 401) msg.textContent = err.message;
    }
  });
  const pluralRu = (n, one, few, many) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; };
  function courseState(set, n) {
    const el = $('#courseState');
    if (el) el.textContent = set ? 'Курс включён' : 'Курс выключен: пароль не задан';
    if ($('#courseCount')) {
      $('#courseCount').textContent = n || 0;
      $('#courseCountTxt').textContent = `${pluralRu(n || 0, 'ученик открыл', 'ученика открыли', 'учеников открыли')} курс паролем`;
      if ($('#courseWho').open) loadCourseList();
    }
  }
  async function loadCourseList() {
    const box = $('#courseList');
    box.textContent = 'Загружаю…';
    try {
      const r = await api('course/list');
      box.innerHTML = r.students.length
        ? `<table class="adm-table course-table"><tr><th>Ученик</th><th>Класс</th><th>Когда открыл</th></tr>${r.students.map(x =>
            `<tr><td>${esc(x.name)}</td><td>${esc(x.class || '—')}</td><td>${x.ts ? `${fmtDate(x.ts)} ${fmtTime(x.ts)}` : '—'}</td></tr>`).join('')}</table>`
        : '<p class="fm-note">Пока никто не вводил пароль курса.</p>';
    } catch (err) { box.textContent = err.message; }
  }
  $('#courseWho')?.addEventListener('toggle', e => { if (e.target.open) loadCourseList(); });
  async function courseSave(body, okText) {
    const msg = $('#courseMsgAdm');
    msg.className = 'login-err';
    msg.textContent = '';
    try {
      const r = await api('course', body);
      courseState(r.set, r.students);
      $('#coursePwAdm').value = '';
      msg.className = 'login-err ok';
      msg.textContent = okText;
    } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
  }
  $('#courseForm')?.addEventListener('submit', e => {
    e.preventDefault();
    if ($('#coursePwAdm').value.trim()) courseSave({ password: $('#coursePwAdm').value }, 'Пароль курса сохранён');
  });
  $('#courseRevoke')?.addEventListener('click', () => {
    if (confirm('Закрыть курс всем ученикам? Им придётся снова ввести пароль.')) courseSave({ revoke: true }, 'Курс закрыт всем — нужен пароль');
  });
  $('#courseOff')?.addEventListener('click', () => {
    if (confirm('Выключить курс? Пароль сбросится, раздел будет закрыт у всех.')) courseSave({ off: true }, 'Курс выключен');
  });
  $('#inviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#inviteMsg');
    msg.className = 'login-err';
    msg.textContent = '';
    try {
      const r = await api('invite', { code: $('#inviteCode').value });
      $('#inviteCode').value = r.code;
      msg.className = 'login-err ok';
      msg.textContent = 'Код сохранён';
    } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
  });
  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#pwMsg');
    msg.className = 'login-err';
    msg.textContent = '';
    try {
      await api('password', { old: $('#pwOld').value, new: $('#pwNew').value });
      msg.className = 'login-err ok';
      msg.textContent = 'Пароль изменён';
      $('#pwOld').value = ''; $('#pwNew').value = '';
    } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
  });

  /** Нет папок с картинками заданий — ученики увидят «Рисунок не загрузился». */
  function showMediaWarning(info) {
    const el = $('#mediaWarn');
    const miss = (info && info.missing_media) || [];
    el.hidden = !miss.length;
    if (!miss.length) return;
    el.innerHTML = `<b>Картинки и файлы к заданиям не найдены:</b> нет ${miss.map(d => `<code>${esc(d)}</code>`).join(', ')}.
      Укажите, где они лежат, и перезапустите сервер: <code>python server.py --banks "C:\\путь\\к\\Biblio"</code>
      (папка, внутри которой ege_bank, kompege_bank…; запоминается). Для сервера в интернете проще собрать банк так, чтобы всё лежало
      внутри тренажёра: <code>python build.py --standalone</code> — и выложить папку <code>media</code> вместе с остальными файлами.`;
  }

  // ------------------------------------------------------------ старт
  (async () => {
    try {
      showMediaWarning(await api('info'));
      await loadMe();
      showApp();
      go('students');
      startFeed();
    } catch (e) {
      if (e.status !== 401) {
        showLogin();
        $('#admLoginErr').textContent = location.protocol === 'file:'
          ? 'Панель работает только через сервер: запустите python server.py и откройте http://localhost:8000/admin'
          : 'Нет связи с сервером';
      }
    }
  })();
})();
