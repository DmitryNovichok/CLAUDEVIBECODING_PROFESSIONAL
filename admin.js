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
  const fmtDate = ts => { const d = new Date(ts * 1000); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; };
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
    showLogin();
  });

  // ------------------------------------------------------------ вкладки
  let tab = 'students';
  let backTab = 'students';            // куда вернуться из карточки ученика
  function go(t) {
    if (t !== 'student') backTab = t;
    tab = t;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (t === 'student' && b.dataset.tab === backTab)));
    ['students', 'classes', 'teachers', 'student', 'feed', 'settings'].forEach(v => { $('#view-' + v).hidden = v !== t; });
    if (t === 'teachers') loadTeachers();
    if (t === 'students') loadStudents();
    if (t === 'classes') loadClasses();
    if (t === 'feed') { $('#feedDot').hidden = true; renderFeed(); }
    if (t === 'settings') loadSettings();
    window.scrollTo({ top: 0 });
  }
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (b) go(b.dataset.tab);
  });

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
        <td class="num"><span class="lvl-mini" title="${s.xp || 0} XP">${s.level || 1}</span></td>
        <td class="main-only muted">${esc(s.teacher || '')}</td>
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
      curClass = { id, name: (classes.find(c => c.id === id) || {}).name || '', students: s.students, assignments: a.assignments };
    } catch (e) { if (e.status !== 401) toast(e.message); return; }
    renderClass();
  }
  function renderClass() {
    const c = curClass;
    const studs = c.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    const members = studs.map(s => {
      const acc = s.total ? s.ok1 / s.total : null;
      return `<tr class="click" data-id="${s.id}">
        <td class="name">${esc(s.name)}</td>
        <td class="num"><span class="lvl-mini" title="${s.xp || 0} XP">${s.level || 1}</span></td>
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
      return `<div class="adm-asg">
        <div class="adm-asg-head"><b>${esc(a.title)}</b>
          <span class="adm-hint">${total} ${plural(total, 'задание', 'задания', 'заданий')} · выдано ${fmtDate(a.created)}${a.due ? ` · срок <span style="${late ? 'color:var(--weak)' : ''}">${fmtDate(a.due)}</span>` : ''}</span>
          <span class="adm-actions"><button type="button" class="btn ghost" data-asg-edit="${a.id}">Изменить</button>
          <button type="button" class="btn ghost danger" data-asg-del="${a.id}">Удалить</button></span></div>
        <div class="adm-hint" style="margin:0 0 8px">Сделали всё: <b>${done}</b> из ${a.progress.length}${zero ? ` · не начинали: ${zero}` : ''}</div>
        <div class="adm-asg-prog">${a.progress.map(p => `<span class="adm-asg-st${p.done >= total ? ' full' : p.done ? '' : ' zero'}" data-open-st="${p.id}" title="${esc(p.name)}: ${p.done} из ${total}">
          <span>${esc(p.name)}</span><i><b style="width:${pct(p.done / total)}%"></b></i><small>${p.done}/${total}</small></span>`).join('') || '<span class="adm-hint">В классе нет учеников.</span>'}</div>
      </div>`;
    }).join('');
    $('#classBody').innerHTML = `
      <div class="adm-toolbar"><h2 class="adm-h">${esc(c.name)} <span class="adm-count">· ${studs.length}</span></h2>
        <span class="adm-actions"><button type="button" class="btn ghost" id="classRename">Переименовать</button>
        <button type="button" class="btn ghost danger" id="classDelete">Удалить класс</button></span></div>
      ${studs.length ? `<div class="adm-table-wrap"><table class="adm-table" id="classTable"><thead><tr>
        <th>Ученик</th><th class="num">Ур.</th><th>Был(а)</th><th class="num">За 7 дней</th><th class="num">Верно с 1-й</th>
        <th class="num" title="Уходил со вкладки за 7 дней">Уходил</th><th class="num">Прогноз</th><th></th></tr></thead><tbody>${members}</tbody></table></div>`
        : '<p class="adm-empty">В классе пока нет учеников. Отметьте их галочками на вкладке «Ученики» и нажмите «Перенести в класс».</p>'}
      <div class="adm-toolbar" style="margin-top:28px"><h2 class="adm-h">Подборки заданий</h2>
        <span class="adm-actions"><button type="button" class="btn primary" id="asgNew">Новая подборка</button></span></div>
      <div id="asgEditor"></div>
      ${asg || '<p class="adm-hint">Подборок пока нет. Соберите задания и отправьте классу — ученики увидят их в карточке «Задания от учителя».</p>'}`;
  }
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
    draft = a ? { id: a.id, title: a.title, due: a.due, tasks: a.tasks.filter(t => !t.missing).map(t => ({ id: t.id, n: t.n, snip: t.snip })) }
      : { id: null, title: '', due: null, tasks: [] };
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
        <label class="adm-hint">срок <input class="inp" type="date" id="dDue" value="${due}"></label>
      </div>
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
      await api('assignment/save', { id: draft.id, class_id: curClass.id, title: draft.title,
        due: due ? new Date(due + 'T23:59:00').getTime() / 1000 : null, tasks: draft.tasks.map(t => t.id) });
      toast(draft.id ? 'Подборка сохранена' : 'Подборка отправлена классу');
      draft = null;
      openClass(curClass.id);
    } catch (err) { if (err.status !== 401) toast(err.message); }
  });
  $('#classBody').addEventListener('click', async e => {
    if (!draft) return;
    const t = e.target;
    const keep = () => { draft.title = $('#dTitle').value; const d = $('#dDue').value; draft.due = d ? new Date(d + 'T23:59:00').getTime() / 1000 : null; };
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
    $('#stName').textContent = s.name;
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
      card('Уходил со вкладки', act.away ? act.away.count : 0, [
        act.away ? `всего ${fmtMinutes(act.away.sec * 1000)}` : 'ни разу за период',
        act.away && act.away.exam ? `<span style="color:var(--weak)">во время варианта: ${act.away.exam}</span>` : '',
        act.shot ? `<span style="color:var(--weak)">клавиши снимка экрана: ${act.shot.count}</span>` : ''].filter(Boolean).join(' · '),
        (act.shot && act.shot.count) || (act.away && act.away.exam) ? 'var(--weak)' : ''),
      card('Варианты ЕГЭ', exams.length ? exams[0].test_score : '—', exams.length
        ? `последний ${fmtDate(exams[0].finished)}: ${exams[0].primary_score} перв. · ${fmtMinutes((exams[0].finished - exams[0].started) * 1000)}${exams.length > 1 ? ` · всего ${exams.length}, лучший ${Math.max(...exams.map(e => e.test_score))}` : ''}`
        : 'ещё не решал'),
    ].join('');
    const ipLine = $('#stIp');
    if (ipLine) {
      ipLine.hidden = false;
      ipLine.innerHTML = (s.has_password ? 'Пароль задан. ' : '<b>Пароль не задан</b> — ученик задаст его при следующем входе с кодом приглашения. ')
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

    renderJournal();
  }

  function renderJournal() {
    const A = st.attempts.filter(a => (jNum == null || a.n === jNum) &&
      (jFilter === 'all' || (jFilter === 'bad' ? resultOf(a).bad : !resultOf(a).bad)));
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
        <td><span class="res ${r.cls}">${r.text}</span></td>
        <td class="num muted">${fmtSpent(a.spent_ms)}</td>
        <td class="num">${a.away ? `<span style="color:var(--review)" title="уходил со вкладки, пока решал">${a.away}</span>` : ''}</td>
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
  async function pollFeed() {
    try {
      const d = await api(`feed?since=${feedSince}`);
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
    feed = []; feedSince = 0;
    pollFeed();
    feedTimer = setInterval(pollFeed, 20000);
  }
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
        <td><span class="res ${r.cls}">${r.text}</span></td>
      </tr>`;
    }).join('');
    freshIds.clear();
  }
  $('#feedTable tbody').addEventListener('click', e => {
    const b = e.target.closest('[data-student]');
    if (b) openStudent(+b.dataset.student);
  });

  // ------------------------------------------------------------ решение ученика
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
      $('#metrikaId').value = d.metrika || '';
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
  $('#metrikaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#metrikaMsg');
    msg.className = 'login-err';
    msg.textContent = '';
    try {
      const r = await api('metrika', { id: $('#metrikaId').value });
      $('#metrikaId').value = r.id;
      msg.className = 'login-err ok';
      msg.textContent = r.id ? `Счётчик ${r.id} включён — ученики попадут в Метрику, когда обновят страницу` : 'Метрика выключена';
    } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
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
