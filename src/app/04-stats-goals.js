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
  /** Дней подряд с выполненной целью (сегодняшний день ещё может быть не закончен). */
  function dayStreak() {
    const m = dayCounts();
    const d = new Date();
    let s = dayOk(m, dayKey(d.getTime())) ? 1 : 0;
    for (;;) {
      d.setDate(d.getDate() - 1);
      if (dayOk(m, dayKey(d.getTime()))) s++;
      else break;
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
      run = prev != null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
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

