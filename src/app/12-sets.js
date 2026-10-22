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
    if (!text || guardMasked(text) || (lastCopy && lastCopy.includes(text))) return;   // заглушка — условие с этой же страницы
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

