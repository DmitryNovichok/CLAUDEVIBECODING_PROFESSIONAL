  // ------------------------------------------------------------ главная-пульт ученика
  /* Отдельная страница, с которой ученик начинает: сверху — уровень, монеты, лига, огонёк; в центре — «План на сегодня»
     (что делать сейчас, по порядку); ниже — все разделы плитками. Разделы открываются своими страницами,
     вернуться — кнопкой «Главная» слева или «Назад» в браузере. */

  // Иконки разделов: основа — цветом текста, смысловая деталь — цветом раздела. Слои: m — основа, a — акцент,
  // d — приглушённая основа, k — вырез (цвет карточки), s/sa/ks — линии. Сетка 48×48.
  const HUB_IC = {
    arduino: ['#3fd3d6', '#00868b', '<rect class="d" x="5" y="13" width="6" height="3.4" rx="1.7"/><rect class="d" x="5" y="22.3" width="6" height="3.4" rx="1.7"/><rect class="d" x="5" y="31.6" width="6" height="3.4" rx="1.7"/><rect class="d" x="37" y="13" width="6" height="3.4" rx="1.7"/><rect class="d" x="37" y="22.3" width="6" height="3.4" rx="1.7"/><rect class="d" x="37" y="31.6" width="6" height="3.4" rx="1.7"/><rect class="m" x="10" y="6" width="28" height="36" rx="6"/><rect class="a" x="15.5" y="12" width="17" height="13" rx="3"/><circle class="k" cx="17.5" cy="33.5" r="2.4"/><circle class="a" cx="30" cy="33.5" r="3.2"/><path class="ks" d="M19.5 18.5h3.2M26 18.5h3.2M27.6 16.9v3.2" stroke-width="1.9"/>'],
    trainer: ['#5cc8ff', '#1f7ae0', '<rect class="a" x="6" y="6" width="10" height="10" rx="3"/><rect class="a" x="19" y="6" width="10" height="10" rx="3"/><rect class="a" x="32" y="6" width="10" height="10" rx="3"/><rect class="a" x="6" y="19" width="10" height="10" rx="3"/><rect class="a" x="19" y="19" width="10" height="10" rx="3"/><rect class="d" x="32" y="19" width="10" height="10" rx="3"/><rect class="a" x="6" y="32" width="10" height="10" rx="3"/><rect class="d" x="19" y="32" width="10" height="10" rx="3"/><rect class="m" x="32" y="32" width="10" height="10" rx="3"/><path class="ks" d="m34.6 37 1.9 1.9 3.3-3.6" stroke-width="2"/>'],
    exam: ['#c39bff', '#7c3aed', '<rect class="m" x="7" y="5" width="26" height="36" rx="5"/><rect class="k" x="12" y="12" width="12" height="3" rx="1.5"/><rect class="k" x="12" y="19" width="16" height="3" rx="1.5"/><rect class="k" x="12" y="26" width="9" height="3" rx="1.5"/><circle class="ks" cx="33.5" cy="33.5" r="10.5" stroke-width="3"/><circle class="a" cx="33.5" cy="33.5" r="9.5"/><rect class="a" x="31" y="20" width="5" height="3.5" rx="1.2"/><path class="ks" d="M33.5 28.5v5.2l3.2 2" stroke-width="2.4"/>'],
    daily: ['#ff8f7a', '#e11d48', '<rect class="m" x="6" y="9" width="36" height="33" rx="7"/><path class="a" d="M6 16a7 7 0 0 1 7-7h22a7 7 0 0 1 7 7v2H6z"/><rect class="ks" x="13.5" y="4.5" width="5" height="9" rx="2.5" stroke-width="2"/><rect class="a" x="13.5" y="4.5" width="5" height="9" rx="2.5"/><rect class="ks" x="29.5" y="4.5" width="5" height="9" rx="2.5" stroke-width="2"/><rect class="a" x="29.5" y="4.5" width="5" height="9" rx="2.5"/><path class="a" d="M26.5 21 17 32.5h6.2L21.5 40 31 28.5h-6.2z"/>'],
    course: ['#8b9cff', '#4338ca', '<path class="s" d="M10.5 37.5c7.5 0 6.5-10 14-11s8.5-6.5 9-12.5" stroke-width="4.2" stroke-dasharray=".1 7.4"/><circle class="a" cx="10" cy="38" r="6.5"/><circle class="k" cx="10" cy="38" r="2.4"/><rect class="m" x="32" y="4" width="3.4" height="24" rx="1.7"/><path class="a" d="M34 4.5h10.5l-3.6 5 3.6 5H34z"/>'],
    lab: ['#4fe3cf', '#0f9488', '<path class="m" d="M18.5 4.5h11a1.5 1.5 0 0 1 0 3H28v9.3l10.6 18.6A4.5 4.5 0 0 1 34.7 42H13.3a4.5 4.5 0 0 1-3.9-6.6L20 16.8V7.5h-1.5a1.5 1.5 0 0 1 0-3z"/><path class="a" d="M15 27.5h18l5.6 7.9A4.5 4.5 0 0 1 34.7 42H13.3a4.5 4.5 0 0 1-3.9-6.6z"/><circle class="k" cx="19.5" cy="35.5" r="2.3"/><circle class="k" cx="26.5" cy="32.5" r="1.6"/><circle class="k" cx="27" cy="38.5" r="1.3"/>'],
    python: ['#6fb1ff', '#2563eb', '<rect class="m" x="4" y="8" width="40" height="32" rx="7"/><circle class="k" cx="10.5" cy="14" r="1.7"/><circle class="k" cx="15.5" cy="14" r="1.7"/><circle class="k" cx="20.5" cy="14" r="1.7"/><path class="sa" d="m12 23 6.5 5L12 33" stroke-width="3.4"/><rect class="a" x="22" y="30.5" width="12" height="3.6" rx="1.8"/>'],
    history: ['#7dd3fc', '#0284c7', '<rect class="d" x="10.5" y="10" width="3" height="28" rx="1.5"/><circle class="ks" cx="12" cy="10.5" r="5.5" stroke-width="3"/><circle class="a" cx="12" cy="10.5" r="5"/><circle class="ks" cx="12" cy="24" r="5.5" stroke-width="3"/><circle class="a" cx="12" cy="24" r="5"/><circle class="ks" cx="12" cy="37.5" r="5.5" stroke-width="3"/><circle class="m" cx="12" cy="37.5" r="5"/><rect class="m" x="21" y="8" width="21" height="5" rx="2.5"/><rect class="m" x="21" y="21.5" width="16" height="5" rx="2.5"/><rect class="d" x="21" y="35" width="19" height="5" rx="2.5"/>'],
    fav: ['#ffd75e', '#d99000', '<path class="m" d="M13.5 5h21A3.5 3.5 0 0 1 38 8.5V43l-14-8.5L10 43V8.5A3.5 3.5 0 0 1 13.5 5z"/><path class="a" d="m24 11.5 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5-5.8-3.05-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/>'],
    world: ['#ffbe5c', '#ea580c', '<rect class="m" x="9" y="22" width="30" height="20" rx="4"/><rect class="m" x="6" y="14.5" width="36" height="8.5" rx="3.5"/><rect class="k" x="6" y="22.5" width="36" height="2"/><rect class="a" x="21" y="14.5" width="6" height="27.5"/><path class="a" d="M24 14.5c-1.6-5.8-9.5-9-11-5.2-1 2.6 2.4 5.2 11 5.2zM24 14.5c1.6-5.8 9.5-9 11-5.2 1 2.6-2.4 5.2-11 5.2z"/>'],
    duel: ['#ff86b4', '#db2777', '<rect class="m" x="17" y="23" width="14" height="19" rx="2.5"/><rect class="d" x="4" y="30" width="13" height="12" rx="2.5"/><rect class="d" x="31" y="33" width="13" height="9" rx="2.5"/><rect class="k" x="22.8" y="28" width="2.6" height="9" rx="1.3"/><path class="a" d="m24 4 3 6.1 6.7 1-4.85 4.7 1.15 6.7-6-3.15-6 3.15 1.15-6.7-4.85-4.7 6.7-1z"/>'],
    together: ['#5ee6a0', '#059669', '<rect class="m" x="4" y="6" width="40" height="28" rx="5"/><path class="s" d="M24 34v8M17 42h14" stroke-width="3"/><path class="sa" d="M10 26c3.5-7 6.5 1 10-5s6 2 8.5-2" stroke-width="2.8"/><path class="k" d="m30.5 15.5 9.5 3.8-4 1.6-1.6 4z"/><path class="a" d="m31.6 16.6 7 2.8-3.1 1.2-1.2 3.1z"/>'],
    asg: ['#86e04a', '#3f9a06', '<rect class="m" x="8" y="5" width="32" height="38" rx="6"/><rect class="k" x="16" y="2.5" width="16" height="7" rx="3.5"/><rect class="a" x="18" y="4" width="12" height="4" rx="2"/><path class="ks" d="m14.5 21 3 3 5.5-6M14.5 33l3 3 5.5-6" stroke-width="3"/><rect class="k" x="26" y="20" width="9" height="3.2" rx="1.6"/><rect class="k" x="26" y="32" width="9" height="3.2" rx="1.6"/>'],
    im: ['#ffa3c7', '#be185d', '<rect class="d" x="5" y="20" width="8" height="22" rx="2"/><rect class="m" x="15" y="8" width="10" height="34" rx="2"/><rect class="d" x="27" y="16" width="8" height="26" rx="2"/><rect class="m" x="36" y="24" width="7" height="18" rx="2"/><rect class="k" x="18" y="13" width="4" height="4" rx="1"/><rect class="k" x="18" y="21" width="4" height="4" rx="1"/><path class="a" d="M20 2l2.2 4.4 4.8.7-3.5 3.4.8 4.8L20 13l-4.3 2.3.8-4.8-3.5-3.4 4.8-.7z"/>'],
    mcko: ['#7cc8ff', '#1c74d9', '<rect class="m" x="7" y="4" width="28" height="38" rx="5"/><rect class="k" x="12" y="11" width="18" height="3.2" rx="1.6"/><rect class="k" x="12" y="18" width="13" height="3.2" rx="1.6"/><rect class="k" x="12" y="25" width="15" height="3.2" rx="1.6"/><circle class="a" cx="34" cy="34" r="10"/><path class="ks" d="M34 28.5V34l3.6 2.4" stroke-width="2.8"/>'],
  };
  let hubIcN = 0;
  function hubIcon(key, size = 56) {
    const [hl, hd, g] = HUB_IC[key] || HUB_IC.trainer, id = 'hg' + (++hubIcN);
    const body = g.replace(/class="m"/g, 'style="fill:var(--text)"').replace(/class="a"/g, `fill="url(#${id})"`)
      .replace(/class="d"/g, 'style="fill:var(--text);fill-opacity:.25"').replace(/class="k"/g, 'style="fill:var(--card)"')
      .replace(/class="s"/g, 'fill="none" style="stroke:var(--text)" stroke-linecap="round" stroke-linejoin="round"')
      .replace(/class="sa"/g, `fill="none" stroke="url(#${id})" stroke-linecap="round" stroke-linejoin="round"`)
      .replace(/class="ks"/g, 'fill="none" style="stroke:var(--card)" stroke-linecap="round" stroke-linejoin="round"');
    return `<svg class="hub-ic" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hl}"/><stop offset="1" stop-color="${hd}"/></linearGradient></defs>${body}</svg>`;
  }
  const hubColor = key => (HUB_IC[key] || HUB_IC.trainer)[1];

  // ------------------------------------------------------------ данные для плана дня
  /** Номера, которые сейчас слабее всего: сначала решённые с низким освоением, по возрастанию. */
  function hubWeakNums(k = 2) {
    const counts = countByNum(), out = [];
    for (let n = 1; n <= 27; n++) {
      if (!counts[n] || (HAS_GROUPS && (n === 20 || n === 21))) continue;
      const s = statsFor(n);
      if (s && s.a) out.push([n, s.m]);
    }
    out.sort((a, b) => a[1] - b[1]);
    const weak = out.filter(x => x[1] < CFG.weak);
    return weak.slice(0, k).map(x => x[0]);
  }
  /** Сколько заданий ждут повторения прямо сейчас: типы с ошибкой и сами задания, решённые неверно. */
  function hubDueCount() {
    const now = Date.now();
    let k = Object.values(P.reviews).filter(r => isDue(r, now)).length;
    for (const id in P.tasks) { const s = P.tasks[id]; if (s.due && s.due <= now && byId.get(id)) k++; }
    return k;
  }
  const hubTodayCount = () => dayCounts().get(dayKey(Date.now())) || 0;
  const hubMins = k => `≈ ${Math.max(2, Math.round(k))} мин`;

  /** План на сегодня: до 4 дел по порядку важности. Первое несделанное — «сейчас» (зелёная кнопка). */
  function hubPlan() {
    const items = [];
    // 1. Задание от учителя с ближайшим сроком; нет его — тренировка слабых номеров
    const own = ASG.filter(a => !a.duel && !a.course && asgPending(a)).sort(asgOrder)[0];
    if (own) {
      const lab = own.kind === 'lab13', left = asgRemaining(own), total = lab ? 1 : own.tasks.length;
      const late = own.due && own.due * 1000 < Date.now();
      items.push({ key: 'asg:' + own.id, ic: 'asg', title: `Задание от учителя: «${own.title}»`,
        meta: [own.due ? `<span class="${late ? 'hub-late' : 'hub-due'}">${late ? 'срок прошёл' : 'до ' + fmtDay(own.due * 1000)}</span>` : '',
          lab ? 'Лаборатория №13 · прогноз для подсети' : left ? `осталось ${left} из ${total}` : 'все ответы внесены — заверши работу', left ? hubMins(left * 3) : ''],
        btn: !left && own.strict ? 'Завершить' : own.started || left < total ? 'Продолжить' : 'Начать', go: () => (own.strict ? openAsgPage() : setScope('asg', own.id)) });
    } else {
      const weak = hubWeakNums(2), need = 5, count = hubTodayCount(), done = count >= need;
      items.push({ key: 'training', ic: 'trainer', title: `Тренировка: ${need} заданий за день`, done,
        meta: [`выполнено ${Math.min(count, need)} из ${need}`, weak.length ? `рекомендуем №${weak.map(numLabel).join(', ')}` : 'задания подбираются под тебя', done ? 'на сегодня выполнено' : hubMins((need - count) * 3)],
        btn: done ? 'Ещё задания' : count ? 'Продолжить' : 'Начать', go: () => setScope(weak[0] || 'all') });
    }
    // 2. Ошибки, которые пора повторить
    const due = hubDueCount();
    if (due) items.push({ key: 'due', ic: 'history', title: 'Повторить ошибки',
      meta: [`${due} ${plural(due, 'задание ждёт', 'задания ждут', 'заданий ждут')} повторения${due > 10 ? ' — на сегодня хватит 10' : ' — иначе забудутся'}`, hubMins(Math.min(due, 10) * 2)],
      btn: 'Повторить', go: () => setScope('all') });
    // 3. Задание дня
    if ((SERVER && student) || DAILY?.ready) {
      const ready = !!DAILY?.ready, done = !!DAILY?.my_place;
      items.push({ key: 'daily', ic: 'daily', title: ready ? `Задание дня · №${numLabel(DAILY.n)}` : 'Задание дня', done, pending: !ready,
        meta: !ready ? [dailyNotice()] : DAILY.my_place ? [`решено за ${fmtMs(DAILY.mine)} · ${DAILY.my_place}-е место`] : DAILY.started ? [DAILY.fast ? 'результат не засчитан' : 'попытка использована · результата нет'] : ['одно задание на скорость', 'место — по времени', hubMins(4)],
        btn: !ready ? DAILY_STATE === 'error' ? 'Повторить' : 'Открыть' : done || DAILY.started ? 'Рейтинг' : 'Решить', go: () => openDaily() });   // сначала правила: войти можно один раз, время идёт сразу
    }
    // 4. Вызов на дуэль или матч турнира
    const call = typeof duelCalls === 'function' ? duelCalls()[0] : null, match = typeof tourMyMatch === 'function' ? tourMyMatch() : null;
    if (call) items.push({ key: 'duel:' + call.id, ic: 'duel', title: `${call.opponent} вызывает на дуэль`, meta: ['задания на скорость', hubMins(6)], btn: 'Ответить', go: () => tourOpen() });
    else if (match) items.push({ key: 'match', ic: 'duel', title: 'Твой матч в турнире', meta: [esc(match.stage || 'матч ждёт')], btn: 'Играть', go: () => tourOpen() });
    // 5. Огонёк дня — если в плане есть место
    if (items.length < 4) {
      const k = hubTodayCount(), need = fireNeed();
      items.push({ key: 'fire', ic: 'fire', title: `Огонёк: реши ${need} ${plural(need, 'задание', 'задания', 'заданий')} за день`, done: k >= need,
        meta: [k >= need ? `сегодня уже ${k} — огонёк горит` : `сделано ${k} из ${need}`, k >= need ? '' : hubMins((need - k) * 3)],
        btn: k >= need ? 'Ещё задание' : 'Решать', go: () => setScope('all') });
    }
    return items.filter(it => !viewPrefs().focus || !['daily', 'duel', 'fire'].includes(it.ic)).slice(0, 4);
  }

  // ------------------------------------------------------------ разделы
  const HUB_LEARNING_GROUPS = {
    courses: { name: 'Курсы', icon: 'course', sub: 'ЕГЭ по информатике и программирование на Python', entries: [
      { key: 'course', name: 'Курс ЕГЭ', sub: 'Уроки и практика по номерам экзамена', access: () => COURSE_OK, go: openCourse },
      { key: 'python', name: 'Курс Python', sub: 'От основ языка до решения задач ЕГЭ', access: () => PYC_OK, go: openPyc },
    ] },
    labs: { name: 'Лаборатории', icon: 'lab', sub: 'Модели ЕГЭ, пошаговый Python и Arduino', entries: [
      { key: 'tasks', name: 'По заданиям ЕГЭ', sub: 'Эксперименты с моделями заданий', access: () => LAB_OK, go: () => openLab('tasks') },
      { key: 'code', name: 'Программирование', sub: 'Выполнение Python по шагам и значения переменных', access: () => LAB_OK, go: () => openLab('code') },
      { key: 'bugs', name: 'Исправление ошибок', sub: 'Поиск и исправление ошибок в чужом решении', visible: () => SERVER, access: () => LAB_OK, go: () => openLab('bugs') },
      { key: 'arduino', name: 'Лаборатория Arduino', sub: 'Схемы, скетчи и симулятор', visible: () => SERVER && student, access: () => ARD_OK,
        go: () => { if (ARD_OK) location.href = 'arduino/'; else openArdGate(); } },
    ] },
  };

  function refreshLearningDirectoryAccess() {
    const group = courseShown && HUB_LEARNING_GROUPS[pageKind];
    if (!group || !SERVER) return;
    for (const entry of group.entries) {
      const status = trainerEl.querySelector(`[data-learning-entry="${entry.key}"] .learning-availability`);
      if (status) status.textContent = entry.access() ? 'Доступ открыт' : 'Доступ у учителя';
    }
  }

  function openLearningDirectory(key) {
    const group = HUB_LEARNING_GROUPS[key];
    if (!group || !leaveExam()) return;
    if (pyOpen()) togglePy(false);
    if (bdOpen()) toggleBoard(false);
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    leaveCourse();
    courseShown = true;
    pageKind = key;
    cur = null;
    navPush({ v: key });
    renderSidebar();
    $('#scopeInfo').textContent = '';
    $('#sessionInfo').textContent = '';
    const entries = group.entries.filter(entry => !entry.visible || entry.visible());
    trainerEl.innerHTML = `<section class="learning-directory" aria-labelledby="learningGroupTitle">
      <h1 id="learningGroupTitle" tabindex="-1">${hubIcon(group.icon, 32)}${group.name}</h1>
      <div class="learning-entries">${entries.map(entry => `<button type="button" class="learning-entry" data-learning-entry="${entry.key}">
        <span><strong>${entry.name}</strong><small>${entry.sub}</small></span>
        ${SERVER ? '<span class="learning-availability"></span>' : ''}</button>`).join('')}</div></section>`;
    refreshLearningDirectoryAccess();
    if (SERVER && student) pycLive(false);
    window.scrollTo(0, 0);
    $('#learningGroupTitle').focus({ preventScroll: true });
  }

  function hubTiles() {
    const vis = id => { const el = $('#' + id); return !!el && !el.hidden; };
    const allDone = [...P.log].filter(e => !e.b).length;
    const bad = P.log.filter(e => e.s < 1 && !e.b && !e.k).length;
    const own = ASG.filter(a => !a.duel && !a.course), ownOpen = own.filter(asgPending);
    const ownLeft = ownOpen.reduce((s, a) => s + asgRemaining(a), 0);
    const T = [];
    T.push({ k: 'exam', name: 'Вариант ЕГЭ', sub: EX ? 'вариант идёт — время не ждёт' : '27 заданий · 3 ч 55 мин', btn: EX ? 'Продолжить вариант' : 'Начать', hot: !!EX, go: () => $('#examCard').click() });
    if (SERVER && student) T.push({ k: 'daily', name: 'Задание дня', sub: !DAILY?.ready || DAILY_STATE === 'error' ? dailyNotice()
      : DAILY.my_place ? `${DAILY.my_place}-е место` : `№${numLabel(DAILY.n)} · ${DAILY.started ? 'уже заходили' : 'не решено'}`,
      badge: DAILY?.my_place || DAILY?.started ? '' : 'сегодня', btn: !DAILY?.ready || DAILY_STATE === 'error' ? DAILY_STATE === 'error' ? 'Повторить загрузку' : 'Открыть' : DAILY.my_place || DAILY.started ? 'Рейтинг' : 'Решить',
      hot: !!DAILY?.ready && !DAILY.started && DAILY_STATE !== 'error', go: () => openDaily() });
    if (vis('asgCard')) T.push({ k: 'asg', name: 'Задания от учителя', sub: ASG_ERROR ? 'не удалось обновить список' : ownOpen.length ? (ownLeft ? `${ownOpen.length} ${plural(ownOpen.length, 'работа', 'работы', 'работ')} · осталось ${ownLeft}` : 'нужно завершить работу') : 'всё решено',
      badge: ownOpen.length ? String(ownOpen.length) : '', btn: 'Открыть', go: () => openAsgPage() });
    if (SERVER && student && !TEACHER) T.push({ k: 'mcko', name: 'МЦКО', sub: 'тренировочные работы от учителя', btn: 'Открыть', go: () => openMcko() });
    if (SERVER && student && (IM_OK || IM_PW)) T.push({ k: 'im', name: 'Интеллектуальный мегаполис', sub: 'ИТ-класс · теория: 10 заданий, 120 минут, 60 баллов',
      btn: IM_OK ? 'Готовиться' : 'Открыть по паролю', go: () => openIm() });
    for (const [key, group] of Object.entries(HUB_LEARNING_GROUPS)) {
      T.push({ k: key, icon: group.icon, name: group.name, sub: group.sub, btn: 'Открыть', go: () => openLearningDirectory(key) });
    }
    T.push({ k: 'history', name: 'История', sub: `${allDone} ${plural(allDone, 'ответ', 'ответа', 'ответов')}`, extra: hubWeekBars(), badge: bad ? `${bad} ${plural(bad, 'ошибка', 'ошибки', 'ошибок')}` : '',
      btn: bad ? 'Разобрать ошибки' : 'Открыть', go: () => { histFilter = bad ? 'bad' : 'all'; histLimit = 100; openHistory(); } });
    T.push({ k: 'fav', name: 'Избранное', sub: prefs.fav.length ? `${prefs.fav.length} ${plural(prefs.fav.length, 'задание', 'задания', 'заданий')}` : 'отмечай задания звёздочкой',
      btn: prefs.fav.length ? 'Решать' : 'Как добавить', go: () => setScope('fav') });
    if (vis('coinCard')) T.push({ k: 'world', name: 'Мой мир', sub: `${(GAME && GAME.coins) || 0} ₿ · магазин и подарки`, btn: 'В магазин', go: () => $('#coinCard').click() });
    if (SERVER && student && !TEACHER) { const c = typeof duelCalls === 'function' ? duelCalls().length : 0;
      T.push({ k: 'duel', name: TOUR && TOUR.tours ? 'Дуэли и турниры' : 'Дуэли',   // турниры выключены на сервере (TOURS_ON) — только дуэли
        sub: c ? 'тебя вызвали на дуэль' : $('#duelCard').title || 'вызови соперника', badge: c ? `${c} ${plural(c, 'вызов', 'вызова', 'вызовов')}` : '', btn: c ? 'Ответить' : 'Вызвать', go: () => $('#duelCard').click() }); }
    if (vis('togCard')) T.push({ k: 'together', name: 'Вместе с учителем', sub: $('#togCard').title || 'записи занятий', btn: 'Открыть записи', go: () => $('#togCard').click() });
    return T.filter(t => !viewPrefs().focus || !['daily', 'duel'].includes(t.k));
  }
  /** Тренажёр — главное на сайте: отдельный блок над планом на сегодня, номера крупно. */
  function hubTrain() {
    const total = kimTotal(countByNum());
    return `<section class="hub-train" aria-label="Тренажёр" style="--sec:${hubColor('trainer')}">
      <div class="ht-head">${hubIcon('trainer', 48)}<div class="ht-tt"><h2>Тренажёр</h2>
        <p>Номера 1–27 · освоено ${hubMastered()} · ${total.toLocaleString('ru-RU')} ${plural(total, 'задание', 'задания', 'заданий')} в банке</p></div>
        <div class="ht-acts"><button type="button" class="btn primary" data-train-go="all">Решать подряд →</button>
          <button type="button" class="btn" data-hub-numbers>Все номера</button></div></div>
      ${hubMap().replace('class="hub-map"', 'class="hub-map ht-map"')}
      <div class="ht-legend">${['none', 'weak', 'mid', 'good'].map(l => `<span><i class="lvl-${l}"></i>${LEVEL_TEXT[l]}</span>`).join('')}</div>
    </section>`;
  }
  function hubMastered() {
    const counts = countByNum();
    let k = 0, all = 0;
    for (let n = 1; n <= 27; n++) { if (!counts[n] || (HAS_GROUPS && (n === 20 || n === 21))) continue; all++; if (level(statsFor(n)) === 'good') k++; }
    return `${k} из ${all}`;
  }
  /** Мини-карта номеров: цвет — освоение, щелчок — сразу к номеру. */
  function hubMap() {
    const counts = countByNum();
    return `<span class="hub-map">${Array.from({ length: 27 }, (_, i) => {
      const n = i + 1;
      if (!counts[n] || (HAS_GROUPS && (n === 20 || n === 21))) return '';
      const st = numStats(n);
      return `<button type="button" class="hub-n lvl-${st.lvl}${HAS_GROUPS && n === 19 ? ' wide' : ''}" data-hub-n="${n}" title="№${numLabel(n)} · ${LEVEL_TEXT[st.lvl]}">${numLabel(n)}</button>`;
    }).join('')}</span>`;
  }
  /** Ответы по дням за последнюю неделю — столбики. */
  function hubWeekBars() {
    const m = dayCounts(), d = new Date(), out = [];
    for (let i = 6; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); out.push(m.get(dayKey(x.getTime())) || 0); }
    const max = Math.max(3, ...out);
    return `<span class="hub-bars" title="Ответы за 7 дней: ${out.join(', ')}">${out.map((v, i) => `<i class="${v ? '' : 'z'}" data-bar="w${i}" data-w="${Math.max(12, Math.round(v / max * 100))}"></i>`).join('')}</span>`;
  }

  // ------------------------------------------------------------ отрисовка
  let hubPrev = null;                     // что было в прошлый раз: для плавного роста чисел и «только что сделано»
  const hubMarkup = new WeakMap();
  const hubMarkupKey = html => html.replace(/hg\d+/g, 'hg');
  /** Фоновые ответы обновляют только изменившиеся блоки: доступные разделы не исчезают и не теряют фокус. */
  function hubPatch(current, fresh, tiles = false) {
    const key = el => tiles ? el.dataset.tileKey : el.classList[0];
    const old = new Map([...current.children].map(el => [key(el), el]));
    const keys = new Set([...fresh.children].map(key));
    old.forEach((el, id) => { if (!keys.has(id)) { el.remove(); old.delete(id); } });
    [...fresh.children].forEach((next, i) => {
      const id = key(next), prev = old.get(id);
      const el = prev || next;
      if (prev && next.classList.contains('hub-tiles')) {
        hubPatch(prev, next, true);
      } else if (prev && hubMarkup.get(prev) !== hubMarkupKey(next.innerHTML)) {
        prev.innerHTML = next.innerHTML;
        prev.className = next.className;
      }
      if (tiles) { el.dataset.tile = next.dataset.tile; el.style.cssText = next.style.cssText; }
      hubMarkup.set(el, hubMarkupKey(next.innerHTML));
      if (current.children[i] !== el) current.insertBefore(el, current.children[i] || null);
      old.delete(id);
    });
    old.forEach(el => el.remove());
  }
  /** Имя для приветствия: в «Фамилия Имя» — второе слово; если там инициал («Дмитрий Б.») — первое полное слово. */
  const hubFirstName = () => {
    const p = String((student && student.name) || '').trim().split(/\s+/).filter(Boolean);
    const full = w => !!w && w.replace(/[.,]/g, '').length > 1 && !/\.$/.test(w);
    return full(p[1]) ? p[1] : p.find(full) || p[1] || p[0] || '';
  };
  function hubHello() {
    const h = new Date().getHours(), nm = hubFirstName();
    const w = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    return nm ? `${w}, ${esc(nm)}!` : `${w}!`;
  }
  function hubPills() {
    const L = LB && LB.boards && LB.boards.league, me = L && L.me;
    const focus = viewPrefs().focus;
    const fcOk = forecastEvidence().count >= CFG.forecast.minAnswers, fc = fcOk ? forecast().score : null;
    const days = dayStreak(), lit = hubTodayCount() >= fireNeed();
    const up = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--good)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>';
    const star = '<svg viewBox="0 0 24 24"><path fill="#ffc21a" d="m12 2.5 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/></svg>';
    const out = [`<button type="button" class="hub-pill" data-hub-go="forecast" title="Прогноз балла ЕГЭ">${up}Прогноз <b data-count="fc">${fc == null ? '—' : fc}</b></button>`];
    if (SERVER && GAME) {
      if (!focus) out.push(`<button type="button" class="hub-pill" data-hub-go="level" title="Уровень ${GAME.level} · ${esc(GAME.title)} — ${GAME.cur} / ${GAME.need} XP">${star}<b data-count="lvl">${GAME.level}</b><small>уровень</small><i class="hub-xp"><b data-bar="xp" data-w="${pct(GAME.cur / GAME.need)}"></b></i></button>`);
      if (!TEACHER) out.push(`<button type="button" class="hub-pill" data-hub-go="coins" title="Монеты и подарки"><span class="btc" aria-hidden="true">₿</span><b data-count="coins">${GAME.coins || 0}</b></button>`);
    }
    if (!focus && me && me.value) out.push(`<button type="button" class="hub-pill" data-hub-go="league" title="${esc(L.name || 'Лига')} — рейтинги: лига, день, неделя, месяц">${hubIcon('duel', 22)}Лига <b data-count="place">${me.place}</b>${L.top ? `<small>/${Math.max(L.top.length, me.place)}</small>` : ''}</button>`);
    else if (!focus && SERVER && student) out.push(`<button type="button" class="hub-pill" data-hub-go="league" title="Рейтинги: лига, день, неделя, месяц">${hubIcon('duel', 22)}Рейтинг</button>`);
    if (typeof PROMO !== 'undefined' && PROMO && !TEACHER) out.push(`<button type="button" class="hub-pill promo-pill-h" data-hub-go="promo" title="${esc(PROMO.title)}">⚡ <b>${xTxt(Math.max(PROMO.task, PROMO.exam))} ₿</b></button>`);
    if (!focus) out.push(`<button type="button" class="hub-pill fire-pill${lit ? ' lit' : ''}${fireCls(days)}" data-hub-go="fire" title="${lit ? 'Огонёк на сегодня горит' : 'Реши задания сегодня — огонёк не погаснет'}">${FLAME}<b data-count="days">${days}</b><small>${plural(days, 'день', 'дня', 'дней')}</small></button>`);
    return out.join('');
  }
  /** Напоминание «подтверди почту»: аккаунт работает и без этого, но без подтверждения пароль можно не восстановить. */
  let hubMailLater = false;
  try { hubMailLater = sessionStorage.getItem('egeshka.mailLater') === '1'; } catch (e) { /* нет доступа */ }
  function hubMail() {
    if (!SERVER || !student || TEACHER || !EMAIL_NEED || hubMailLater) return '';
    return `<section class="hub-mail" aria-label="Подтверждение почты"><span class="hub-mail-ic" aria-hidden="true">✉️</span>
      <div><b>Подтверди почту</b><p>Адрес <b>${esc(EMAIL_NEED)}</b> ещё не подтверждён. Открой ссылку из письма — тогда по этой почте можно будет восстановить пароль. Нет письма? Загляни в «Спам» или отправь его заново.</p></div>
      <div class="hub-mail-act"><button type="button" class="btn" data-mail="resend">Отправить письмо</button>
        <button type="button" class="link-btn" data-mail="change">Изменить почту</button><button type="button" class="link-btn" data-mail="later">Позже</button></div></section>`;
  }
  /** Длинная кнопка над планом: открывает iPad-страницу «Монеты за помощь сайту» (12d-stories.js, data-pad-open). */
  function hubPad() {
    if (!SERVER || !student || TEACHER) return '';
    const amounts = (RULES.support_rewards || []).filter(([kind]) => kind !== 'done').map(row => row[3]);
    if (!amounts.length) return '';
    return `<button type="button" class="hub-pad" data-pad-open aria-label="Открыть страницу: за что дают монеты за помощь сайту и сколько">
      <span class="hub-pad-dev" aria-hidden="true"><i>🎁</i></span>
      <span class="hub-pad-tx"><b>Монеты за помощь сайту — от ${Math.min(...amounts)} до ${Math.max(...amounts)} ₿</b>
        <span>Награды за идеи, улучшения интерфейса и найденные ошибки</span></span>
      <span class="hub-pad-go" aria-hidden="true">Открыть<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span></button>`;
  }
  function renderHub(enter) {
    if (!courseShown || pageKind !== 'hub') return;
    const plan = hubPlan(), tiles = hubTiles();
    const goalN = plan.filter(x => !x.pending).length, doneN = plan.filter(x => x.done).length, nowIdx = plan.findIndex(x => !x.done && !x.pending);
    const prevDone = hubPrev ? hubPrev.done : null;
    const mins = plan.filter(x => !x.done && !x.pending).length;
    const sub = !mins ? 'План на сегодня выполнен — можно решать дальше или отдохнуть' : doneN ? `Хорошее начало — ${mins === 1 ? 'осталось одно дело' : `осталось ${mins} ${plural(mins, 'дело', 'дела', 'дел')}`}`
      : `Сегодня ${goalN} ${plural(goalN, 'дело', 'дела', 'дел')} — начни с первого`;
    const stepHtml = (it, i) => {
      const cls = ['hub-step', it.done ? 'done' : '', i === nowIdx ? 'now' : '', it.done && prevDone && !prevDone.has(it.key) ? 'just' : ''].filter(Boolean).join(' ');
      const ic = it.ic === 'fire' ? `<span class="hub-fire-ic${fireCls(dayStreak())}">${FLAME}</span>` : hubIcon(it.ic, 30);
      return `<div class="${cls}" data-step="${i}" data-step-key="${esc(it.key)}" style="--i:${i}"><span class="hub-num">${it.done ? '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : it.pending ? '—' : plan.slice(0, i + 1).filter(x => !x.pending).length}</span>
        <div class="hub-step-body"><b>${ic}<span class="hub-tt">${esc(it.title)}</span></b><span class="hub-meta">${it.meta.filter(Boolean).map(x => `<span>${x}</span>`).join('')}</span></div>
        <button type="button" class="btn${i === nowIdx ? ' primary' : ''}" data-step-go="${i}">${esc(it.btn)}${i === nowIdx ? ' →' : ''}</button></div>`;
    };
    const tileHtml = (t, i) => `<div class="hub-tile${t.big ? ' big' : ''}" role="button" tabindex="0" data-tile="${i}" data-tile-key="${t.k}" style="--sec:${hubColor(t.icon || t.k)};--i:${i}">
      ${t.badge ? `<span class="hub-badge">${esc(t.badge)}</span>` : ''}${hubIcon(t.icon || t.k, 52)}<b>${esc(t.name)}</b><span class="hub-sub">${esc(t.sub)}</span>${t.extra || ''}
      <span class="btn hub-act${t.hot ? ' hot' : ''}">${esc(t.btn)}</span></div>`;
    $('#scopeInfo').innerHTML = '<span class="scope-title">Главная</span>';
    const html = `
      <div class="hub-hello"><div><h1>${hubHello()}</h1><p>${sub}</p></div><div class="hub-pills">${hubPills()}</div></div>
      ${hubMail()}${hubTrain()}${hubPad()}<section class="hub-plan" aria-label="План на сегодня"><h2>План на сегодня <small>${doneN} из ${goalN} сделано</small></h2>
        ${plan.map(stepHtml).join('')}
        <div class="hub-day"><span>День</span><i class="hub-track"><b data-bar="day" data-w="${goalN ? Math.round(doneN / goalN * 100) : 0}"></b></i>
          <span>${doneN === goalN ? 'всё сделано — так держать!' : `сделано ${doneN} из ${goalN}`}</span></div></section>
      <h2 class="hub-h2">Все разделы</h2>
      <div class="hub-tiles">${tiles.map(tileHtml).join('')}</div>
      <footer class="hub-foot"><button type="button" class="link-btn" data-hub-link="tourBtn">Как работает Egeshka</button>
        <button type="button" class="link-btn" data-hub-link="versionBtn">${esc(($('#versionBtn') || {}).textContent || 'Что нового')}</button>
        ${SERVER ? '' : '<button type="button" class="link-btn" data-hub-link="exportBtn">Сохранить прогресс в файл</button>'}
        <a class="link-btn hub-help" href="help.html#student" target="_blank" rel="noopener">Инструкция</a>
        <span class="hub-docs"><a href="terms.html" target="_blank" rel="noopener">Соглашение</a> · <a href="privacy.html" target="_blank" rel="noopener">Персональные данные</a></span></footer>`;
    HUB_ACT = { plan, tiles };
    const current = trainerEl.querySelector('.hub');
    if (!enter && hubMarkupKey(html) === hubSig && current) return;
    hubSig = hubMarkupKey(html);
    if (!enter && current) {
      current.classList.remove('hub-enter');
      const fresh = document.createElement('div');
      fresh.innerHTML = html;
      hubPatch(current, fresh);
    } else {
      trainerEl.innerHTML = `<div class="hub${enter ? ' hub-enter' : ''}">${html}</div>`;
      trainerEl.querySelectorAll('.hub > *, .hub-tile').forEach(el => hubMarkup.set(el, hubMarkupKey(el.innerHTML)));
    }
    hubLeft = true;
    if (enter) hubEnterEnd = Date.now() + 900;
    hubAnimate(enter);
    hubPrev = { done: new Set(plan.filter(x => x.done).map(x => x.key)), bars: hubPrev ? hubPrev.bars : {}, nums: hubPrev ? hubPrev.nums : {} };
  }
  let HUB_ACT = { plan: [], tiles: [] }, hubLeft = false;   // hubLeft — главная была на экране, уход с неё ещё не обработан
  /** Полоски растут с прошлого значения до нового, числа «добегают» до нового значения. */
  function hubAnimate(enter) {
    const prev = hubPrev || { bars: {}, nums: {} }, bars = {}, nums = {};
    const anim = viewPrefs().anim && !viewPrefs().focus && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    trainerEl.querySelectorAll('[data-bar]').forEach(b => {
      const k = b.dataset.bar, w = +b.dataset.w || 0;
      bars[k] = w;
      const from = enter ? 0 : (prev.bars[k] ?? w);
      const prop = b.parentElement.classList.contains('hub-bars') ? 'height' : 'width';   // столбики растут вверх, полоски — вправо
      if (!anim) { b.style[prop] = w + '%'; return; }
      b.style[prop] = from + '%';
      requestAnimationFrame(() => requestAnimationFrame(() => { b.style[prop] = w + '%'; }));
    });
    trainerEl.querySelectorAll('[data-count]').forEach(el => {
      const k = el.dataset.count, to = parseInt(el.textContent, 10);
      if (isNaN(to)) return;
      nums[k] = to;
      const from = prev.nums[k];
      if (!anim || from == null || from === to) return;
      const t0 = performance.now(), dur = 700;
      el.textContent = from;
      const step = t => { const q = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - q, 3);
        el.textContent = Math.round(from + (to - from) * e); if (q < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
      el.classList.add('hub-bump'); setTimeout(() => el.classList.remove('hub-bump'), 900);
    });
    hubPrev = Object.assign(hubPrev || {}, { bars, nums });
  }
  let hubTimer = 0, hubEnterEnd = 0, hubSig = '';
  /** Данные поменялись (решено задание, пришёл вызов, загрузился рейтинг) — главная обновится сама, без мигания:
      после того как доиграет появление и только если что-то действительно изменилось. */
  function hubRefresh() {
    if (!courseShown || pageKind !== 'hub') return;
    clearTimeout(hubTimer);
    hubTimer = setTimeout(() => renderHub(false), Math.max(60, hubEnterEnd - Date.now()));
  }
  function openHub(initial) {
    if (!leaveExam()) return;
    if (pyOpen()) togglePy(false);            // сохраняет код до ухода с задания
    if (bdOpen()) toggleBoard(false);         // сохраняет рисунок и незавершённый текст
    if (isNarrow()) setSideOpen(false);
    if (!(courseShown && pageKind === 'hub')) {
      abandonCurrent();
      if (courseShown) leaveCourse();
      courseShown = true;
      pageKind = 'hub';
      cur = null;
      if (initial === true) { try { history.replaceState({ v: 'hub' }, ''); } catch (e) { /* не страшно */ } } else navPush({ v: 'hub' });
    }
    if (SERVER && student) hubNavOn();
    hubDrawer(false);
    document.body.classList.add('hub-on');
    hubSig = '';
    renderSidebar();
    renderTopbar();                          // прогноз, огонёк и рейтинг вверху — для страниц, куда уйдут с главной
    window.scrollTo(0, 0);
    renderHub(true);
    clearTimeout(hubTimer);
  }
  trainerEl.addEventListener('click', e => {
    const groupButton = e.target.closest('[data-open-learning-group]');
    if (groupButton) { openLearningDirectory(groupButton.dataset.openLearningGroup); return; }
    const entryButton = e.target.closest('[data-learning-entry]');
    if (entryButton && courseShown) {
      HUB_LEARNING_GROUPS[pageKind]?.entries.find(entry => entry.key === entryButton.dataset.learningEntry)?.go();
      return;
    }
    if (!courseShown || pageKind !== 'hub') return;
    const n = e.target.closest('[data-hub-n]');
    if (n) { e.stopPropagation(); setScope(+n.dataset.hubN); return; }
    if (e.target.closest('[data-train-go]')) { setScope('all'); return; }
    if (e.target.closest('[data-hub-numbers]')) { openNumbers(); return; }
    const hl = e.target.closest('[data-hub-link]');
    if (hl) { $('#' + hl.dataset.hubLink)?.click(); return; }
    const ml = e.target.closest('[data-mail]');
    if (ml) {
      if (ml.dataset.mail === 'change') openAccount();
      else if (ml.dataset.mail === 'later') { hubMailLater = true; try { sessionStorage.setItem('egeshka.mailLater', '1'); } catch (x) { /* до перезагрузки */ } renderHub(); }
      else {
        ml.disabled = true;
        api('email/resend', {}).then(r => {
          if (r.confirmed) { EMAIL_NEED = ''; renderHub(); toast('Почта уже подтверждена ✓'); } else toast(`Письмо отправлено на ${r.email}`);
        }).catch(err => toast(err.message || 'Не удалось отправить письмо')).finally(() => { ml.disabled = false; });
      }
      return;
    }
    const s = e.target.closest('[data-step-go]');
    if (s) { const it = HUB_ACT.plan[+s.dataset.stepGo]; if (it) it.go(); return; }
    const p = e.target.closest('[data-hub-go]');
    if (p) {
      const k = p.dataset.hubGo;
      if (k === 'forecast') openForecast();
      else if (k === 'level') openGame();
      else if (k === 'coins') $('#coinCard').click();
      else if (k === 'league') openRating('league');
      else if (k === 'fire') { const m = $('#hubFireMenu'); if (m && !m.hidden) hubFireClose(); else hubFire(p); }
      else if (k === 'promo') openPromo();
      return;
    }
    const t = e.target.closest('[data-tile]');
    if (t) { const it = HUB_ACT.tiles[+t.dataset.tile]; if (it) it.go(); }
  });
  /** Огонёк на главной — компактное окошко под кнопкой (как в верхней панели), а не отдельное окно. */
  function hubFire(anchor) {
    const days = dayStreak(), k = hubTodayCount(), need = fireNeed();
    let box = $('#hubFireMenu');
    if (!box) {
      box = document.createElement('div');
      box.id = 'hubFireMenu';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Огонёк');
      document.body.appendChild(box);
    }
    box.className = 'streak-menu hub-fire-pop' + fireCls(days);
    box.innerHTML = streakMenuHtml(days, k >= need, Math.max(0, need - k))
      + '<button type="button" class="btn primary btn-block hub-fire-go" id="hubFireGo">Решать задания</button>';
    box.hidden = false;
    const a = anchor || $('.hub-pill.fire-pill');
    if (a) {
      const r = a.getBoundingClientRect(), w = box.offsetWidth;
      box.style.top = Math.round(r.bottom + 8) + 'px';
      box.style.maxHeight = Math.max(240, Math.round(window.innerHeight - r.bottom - 24)) + 'px';
      box.style.left = Math.round(Math.max(16, Math.min(r.right - w, window.innerWidth - w - 16))) + 'px';
    }
  }
  function hubFireClose() { const m = $('#hubFireMenu'); if (m) m.hidden = true; }
  document.addEventListener('click', e => {
    const m = $('#hubFireMenu');
    if (!m || m.hidden) return;
    if (e.target.closest('#hubFireGo')) { hubFireClose(); setScope('all'); return; }
    if (!e.target.closest('#hubFireMenu, .hub-pill.fire-pill')) hubFireClose();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hubFireClose(); });
  window.addEventListener('resize', hubFireClose);
  window.addEventListener('scroll', e => { if (!(e.target.closest && e.target.closest('#hubFireMenu'))) hubFireClose(); }, true);
  trainerEl.addEventListener('keydown', e => {
    if (!courseShown || pageKind !== 'hub' || (e.key !== 'Enter' && e.key !== ' ')) return;
    const t = e.target.closest('[data-tile]');
    if (t && e.target === t) { e.preventDefault(); t.click(); }
  });
  // уход с главной: вернуть боковую панель и верхнюю строку
  // с главной ушли к заданиям — запись в истории браузера, чтобы «Назад» вернул на главную, а не увёл с сайта
  new MutationObserver(() => {
    if (courseShown && pageKind === 'hub') return;
    hubFireClose();
    if (!hubLeft) return;
    hubLeft = false;
    document.body.classList.remove('hub-on');
    const st = history.state;
    const base = st && st.v === 'modal' ? st.base : st;
    if (!courseShown && base && base.v === 'hub') navPush({ v: 'main' });
  }).observe(trainerEl, { childList: true });
  $('#homeCard').addEventListener('click', () => {
    openHub();
    if (courseShown && pageKind === 'hub') {
      const heading = $('.hub h1');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
  });

  // ------------------------------------------------------------ плавные переходы между страницами
  /* Новое содержимое центральной части (задание, страница раздела) мягко проявляется. Работает везде,
     отключается вместе с «Анимациями» в настройках вида и при «уменьшить движение» в системе. */
  new MutationObserver(muts => {
    if (!muts.some(m => m.addedNodes.length)) return;
    const el = trainerEl.firstElementChild;
    if (!el || el.classList.contains('pg-in') || el.classList.contains('hub')) return;
    el.classList.add('pg-in');
  }).observe(trainerEl, { childList: true });

  // ------------------------------------------------------------ навигация «от главной»
  /* Главная — отдельная страница. Всё остальное открывается с неё своей страницей: слева ничего нет,
     вверху — «← Главная» и «Номера» (банк номеров, поиск и настройки выезжают панелью слева и прячутся обратно).
     Окна (прогноз, рейтинг, подарки, уровень, техподдержка…) открываются во весь экран, «Назад» в браузере их закрывает. */
  const hubNav = () => document.body.classList.contains('hubnav');
  $('.topbar')?.insertAdjacentHTML('afterbegin', `<span class="hub-nav" id="hubNav">
    <button type="button" class="hub-back" id="hubBack" title="На главную: план на сегодня и все разделы"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>Главная</button>
    <button type="button" class="hub-back hub-nums" id="hubNums" aria-controls="sideBody" aria-expanded="false" title="Номера заданий, поиск по номеру, банки и настройки"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/></svg>Номера</button></span>`);
  document.body.insertAdjacentHTML('beforeend', '<div class="nav-shade" id="navShade" hidden></div>');
  function hubDrawer(open) {
    if (!hubNav()) return;
    setSideOpen(open);
    $('#navShade').hidden = !open || isNarrow();
  }
  function hubNavOn() {
    document.body.classList.add('hubnav');
  }
  function openNumbers() {
    if (hubNav() && !isNarrow()) hubDrawer(true);
    else {
      if (!hubNav() && courseShown && pageKind === 'hub') { leaveCourse(); next(); renderSidebar(); }
      setSideOpen(true);
      window.scrollTo(0, 0);
    }
    $('#period').focus({ preventScroll: true });
  }
  $('#hubBack')?.addEventListener('click', () => { hubDrawer(false); openHub(); });
  $('#hubNums')?.addEventListener('click', () => {
    if ($('.sidebar').classList.contains('open')) hubDrawer(false);
    else openNumbers();
  });
  window.matchMedia('(max-width: 860px)').addEventListener('change', () => hubDrawer(false));
  $('#navShade').addEventListener('click', () => hubDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && hubNav() && !$('#navShade').hidden) hubDrawer(false); }, true);
  // выбрали номер, раздел или нашли задание — панель сама уезжает
  $('.sidebar').addEventListener('click', e => {
    if (!hubNav() || isNarrow() || $('#navShade').hidden) return;
    if (e.target.closest('.num-card, #allNums, #supportBtn, .side-actions .link-btn:not(#sndBtn):not(#themeBtn), #versionBtn')) setTimeout(() => hubDrawer(false), 0);
  });
  $('#searchForm')?.addEventListener('submit', () => setTimeout(() => hubDrawer(false), 0));

  // окно как страница: открылось — запись в истории браузера, «Назад» закрывает его
  let hubModalState = false, hubModalId = 0, hubModalBase = null;
  let hubClosingHistory = false, hubPendingRoute = null;
  function hubQueueNavigation(st) {
    if (!hubClosingHistory) return false;
    hubPendingRoute = st;
    return true;
  }
  function hubModalPop(st) {
    if (hubClosingHistory) {
      hubClosingHistory = false;
      const next = hubPendingRoute;
      hubPendingRoute = null;
      if (next) navPush(next);               // действие успело открыть раздел, пока браузер закрывал окно
      return true;
    }
    if (!hubModalState) return false;
    hubModalState = false;
    closeForecast();
    // Обычный шаг назад только закрывает окно; history.go(-2) также меняет раздел.
    return JSON.stringify(st) === JSON.stringify(hubModalBase);
  }
  new MutationObserver(() => {
    const open = !$('#forecastModal').hidden;
    if (!hubNav() || open === hubModalState) return;
    hubModalState = open;
    if (open) {
      hubModalBase = (history.state?.v === 'modal' ? history.state.base : history.state) || { v: 'main' };
      navPush({ v: 'modal', id: ++hubModalId, base: hubModalBase });
    } else {
      const id = hubModalId;
      // Сначала обработать переход из окна в раздел (в том числе наблюдатель trainerEl).
      queueMicrotask(() => {
        if (!$('#forecastModal').hidden || history.state?.v !== 'modal' || history.state.id !== id) return;
        hubClosingHistory = true;
        history.back();
      });
    }
  }).observe($('#forecastModal'), { attributes: true, attributeFilter: ['hidden'] });

  // ------------------------------------------------------------ рядом с логотипом: «by Malevin» и техподдержка
  {
    const brand = $('.topbar .mobile-brand');
    brand?.insertAdjacentHTML('afterend', `<span class="hub-brand-x"><span class="hub-by">by <b>Malevin</b></span>
      <button type="button" class="hub-back hub-sup" id="hubSupport" hidden title="Ошибка, вопрос или идея — ответ придёт сюда же"><svg class="support-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6m5.6 5.6 3.6 3.6m0-12.8-3.6 3.6m-5.6 5.6-3.6 3.6"/></svg>Техподдержка<i class="dot" hidden></i></button></span>`);
    const sb = $('#supportBtn'), sd = $('#supportDot'), hs = $('#hubSupport');
    const sync = () => { if (!hs || !sb) return; hs.hidden = sb.hidden; hs.querySelector('.dot').hidden = !sd || sd.hidden; };
    if (sb) new MutationObserver(sync).observe(sb, { attributes: true, attributeFilter: ['hidden'] });
    if (sd) new MutationObserver(sync).observe(sd, { attributes: true, attributeFilter: ['hidden'] });
    sync();
    hs?.addEventListener('click', () => openSupport('auto'));
  }
