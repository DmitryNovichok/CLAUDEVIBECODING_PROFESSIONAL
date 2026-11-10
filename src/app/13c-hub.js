  // ------------------------------------------------------------ главная-пульт ученика
  /* Отдельная страница, с которой ученик начинает: сверху — уровень, биткоины, лига, огонёк; в центре — «План на сегодня»
     (что делать сейчас, по порядку); ниже — все разделы плитками. Разделы открываются своими страницами,
     вернуться — кнопкой «Главная» слева или «Назад» в браузере. */

  // Иконки разделов: основа — цветом текста, смысловая деталь — цветом раздела. Слои: m — основа, a — акцент,
  // d — приглушённая основа, k — вырез (цвет карточки), s/sa/ks — линии. Сетка 48×48.
  const HUB_IC = {
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
    return (weak.length ? weak : out).slice(0, k).map(x => x[0]);
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
    const own = ASG.filter(a => !a.duel && !a.course && !asgFinished(a) && asgLeft(a).length).sort(asgOrder)[0];
    if (own) {
      const left = asgLeft(own).length, total = own.tasks.length;
      const late = own.due && own.due * 1000 < Date.now();
      items.push({ key: 'asg:' + own.id, ic: 'asg', title: `Задание от учителя: «${own.title}»`,
        meta: [own.due ? `<span class="${late ? 'hub-late' : 'hub-due'}">${late ? 'срок прошёл' : 'до ' + fmtDay(own.due * 1000)}</span>` : '',
          `осталось ${left} из ${total}`, hubMins(left * 3)],
        btn: own.started || left < total ? 'Продолжить' : 'Начать', go: () => (own.strict ? openAsgPage() : setScope('asg', own.id)) });
    } else {
      const weak = hubWeakNums(2);
      if (weak.length) {
        const s = statsFor(weak[0]);
        items.push({ key: 'weak', ic: 'trainer', title: `Тренировка слабых номеров: ${weak.map(n => '№' + numLabel(n)).join(', ')}`,
          meta: [`освоено №${numLabel(weak[0])} на ${pct(s.m)}%`, 'задания подбираются под тебя', hubMins(12)],
          btn: 'Тренировать', go: () => setScope(weak[0]) });
      } else {
        items.push({ key: 'start', ic: 'trainer', title: 'Начни тренировку — тренажёр подберёт задания',
          meta: ['все номера по очереди', 'через 5–10 ответов станут видны слабые места', hubMins(10)],
          btn: 'Начать', go: () => setScope('all') });
      }
    }
    // 2. Ошибки, которые пора повторить
    const due = hubDueCount();
    if (due) items.push({ key: 'due', ic: 'history', title: 'Повторить ошибки',
      meta: [`${due} ${plural(due, 'задание ждёт', 'задания ждут', 'заданий ждут')} повторения${due > 10 ? ' — на сегодня хватит 10' : ' — иначе забудутся'}`, hubMins(Math.min(due, 10) * 2)],
      btn: 'Повторить', go: () => setScope('all') });
    // 3. Задание дня
    if (DAILY && DAILY.ready) {
      const done = !!DAILY.my_place || (!!DAILY.started && !dailyNow());
      items.push({ key: 'daily', ic: 'daily', title: `Задание дня · №${numLabel(DAILY.n)}`, done,
        meta: DAILY.my_place ? [`решено за ${fmtMs(DAILY.mine)} · ${DAILY.my_place}-е место`] : DAILY.started ? ['сегодня уже заходили'] : ['одно задание на скорость', 'место — по времени', hubMins(4)],
        btn: done ? 'Рейтинг' : 'Решить', go: () => openDaily() });   // сначала правила: войти можно один раз, время идёт сразу
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
    return items.slice(0, 4);
  }

  // ------------------------------------------------------------ разделы
  function hubTiles() {
    const vis = id => { const el = $('#' + id); return !!el && !el.hidden; };
    const allDone = [...P.log].filter(e => !e.b).length;
    const bad = P.log.filter(e => e.s < 1 && !e.b && !e.k).length;
    const own = ASG.filter(a => !a.duel && !a.course), ownOpen = own.filter(a => !asgFinished(a) && asgLeft(a).length);
    const T = [];
    T.push({ k: 'trainer', name: 'Тренажёр', sub: `номера 1–27 · освоено ${hubMastered()}`, big: true, extra: hubMap(), btn: 'Решать подряд', go: () => setScope('all') });
    T.push({ k: 'exam', name: 'Вариант ЕГЭ', sub: EX ? 'вариант идёт — время не ждёт' : '27 заданий · 3 ч 55 мин', btn: EX ? 'Продолжить вариант' : 'Начать', hot: !!EX, go: () => $('#examCard').click() });
    if (vis('dailyCard') && DAILY) T.push({ k: 'daily', name: 'Задание дня', sub: DAILY.my_place ? `${DAILY.my_place}-е место` : `№${numLabel(DAILY.n)} · ${DAILY.started ? 'уже заходили' : 'не решено'}`,
      badge: DAILY.my_place || DAILY.started ? '' : 'сегодня', btn: DAILY.my_place || DAILY.started ? 'Рейтинг' : 'Решить', hot: !DAILY.started, go: () => openDaily() });
    if (vis('asgCard')) T.push({ k: 'asg', name: 'Задания от учителя', sub: ownOpen.length ? `${ownOpen.length} ${plural(ownOpen.length, 'подборка', 'подборки', 'подборок')} · осталось ${ownOpen.reduce((s, a) => s + asgLeft(a).length, 0)}` : 'всё решено',
      badge: ownOpen.length ? String(ownOpen.length) : '', btn: 'Открыть', go: () => openAsgPage() });
    T.push({ k: 'course', name: 'Курс ЕГЭ', sub: '27 тем по плану', btn: 'Открыть курс', go: () => $('#courseCard').click() });
    if (vis('labCard')) T.push({ k: 'lab', name: 'Лаборатория', sub: 'задания ЕГЭ и программирование', btn: 'Открыть', go: () => $('#labCard').click() });
    if (vis('pycCard')) T.push({ k: 'python', name: 'Курс Python', sub: 'программирование с нуля', btn: 'Открыть', go: () => $('#pycCard').click() });
    T.push({ k: 'history', name: 'История', sub: `${allDone} ${plural(allDone, 'ответ', 'ответа', 'ответов')}`, extra: hubWeekBars(), badge: bad ? `${bad} ${plural(bad, 'ошибка', 'ошибки', 'ошибок')}` : '',
      btn: bad ? 'Разобрать ошибки' : 'Открыть', go: () => { histFilter = bad ? 'bad' : 'all'; histLimit = 100; openHistory(); } });
    T.push({ k: 'fav', name: 'Избранное', sub: prefs.fav.length ? `${prefs.fav.length} ${plural(prefs.fav.length, 'задание', 'задания', 'заданий')}` : 'отмечай задания звёздочкой',
      btn: prefs.fav.length ? 'Решать' : 'Как добавить', go: () => setScope('fav') });
    if (vis('coinCard')) T.push({ k: 'world', name: 'Мой мир', sub: `${(GAME && GAME.coins) || 0} ₿ · магазин и подарки`, btn: 'В магазин', go: () => $('#coinCard').click() });
    if (vis('duelCard')) { const c = typeof duelCalls === 'function' ? duelCalls().length : 0;
      T.push({ k: 'duel', name: 'Соревнования', sub: c ? 'тебя вызвали на дуэль' : $('#duelSub').textContent, badge: c ? `${c} ${plural(c, 'вызов', 'вызова', 'вызовов')}` : '', btn: c ? 'Ответить' : 'Вызвать', go: () => $('#duelCard').click() }); }
    if (vis('togCard')) T.push({ k: 'together', name: 'Вместе с учителем', sub: $('#togSub').textContent || 'записи занятий', btn: 'Открыть записи', go: () => $('#togCard').click() });
    return T;
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
  const hubFirstName = () => { const p = String((student && student.name) || '').trim().split(/\s+/); return p[1] || p[0] || ''; };
  function hubHello() {
    const h = new Date().getHours(), nm = hubFirstName();
    const w = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
    return nm ? `${w}, ${esc(nm)}!` : `${w}!`;
  }
  function hubPills() {
    const L = LB && LB.boards && LB.boards.league, me = L && L.me;
    const fcOk = P.log.length >= CFG.forecast.minAnswers, fc = fcOk ? forecast().score : null;
    const days = dayStreak(), lit = hubTodayCount() >= fireNeed();
    const up = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--good)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>';
    const star = '<svg viewBox="0 0 24 24"><path fill="#ffc21a" d="m12 2.5 2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"/></svg>';
    const out = [`<button type="button" class="hub-pill" data-hub-go="forecast" title="Прогноз балла ЕГЭ">${up}Прогноз <b data-count="fc">${fc == null ? '—' : fc}</b></button>`];
    if (SERVER && GAME) {
      out.push(`<button type="button" class="hub-pill" data-hub-go="level" title="Уровень ${GAME.level} · ${esc(GAME.title)} — ${GAME.cur} / ${GAME.need} XP">${star}<b data-count="lvl">${GAME.level}</b><small>уровень</small><i class="hub-xp"><b data-bar="xp" data-w="${pct(GAME.cur / GAME.need)}"></b></i></button>`);
      if (!TEACHER) out.push(`<button type="button" class="hub-pill" data-hub-go="coins" title="Биткоины и подарки"><span class="btc" aria-hidden="true">₿</span><b data-count="coins">${GAME.coins || 0}</b></button>`);
    }
    if (me && me.value) out.push(`<button type="button" class="hub-pill" data-hub-go="league" title="${esc(L.name || 'Лига')}">${hubIcon('duel', 22)}Лига <b data-count="place">${me.place}</b>${L.top ? `<small>/${Math.max(L.top.length, me.place)}</small>` : ''}</button>`);
    out.push(`<button type="button" class="hub-pill fire-pill${lit ? ' lit' : ''}" data-hub-go="fire" title="${lit ? 'Огонёк на сегодня горит' : 'Реши задания сегодня — огонёк не погаснет'}">${FLAME}<b data-count="days">${days}</b><small>${plural(days, 'день', 'дня', 'дней')}</small></button>`);
    return out.join('');
  }
  function renderHub(enter) {
    if (!courseShown || pageKind !== 'hub') return;
    const plan = hubPlan(), tiles = hubTiles();
    const doneN = plan.filter(x => x.done).length, nowIdx = plan.findIndex(x => !x.done);
    const prevDone = hubPrev ? hubPrev.done : null;
    const mins = plan.filter(x => !x.done).length;
    const sub = !mins ? 'План на сегодня выполнен — можно решать дальше или отдохнуть' : doneN ? `Хорошее начало — ${mins === 1 ? 'осталось одно дело' : `осталось ${mins} ${plural(mins, 'дело', 'дела', 'дел')}`}`
      : `Сегодня ${plan.length} ${plural(plan.length, 'дело', 'дела', 'дел')} — начни с первого`;
    const stepHtml = (it, i) => {
      const cls = ['hub-step', it.done ? 'done' : '', i === nowIdx ? 'now' : '', it.done && prevDone && !prevDone.has(it.key) ? 'just' : ''].filter(Boolean).join(' ');
      const ic = it.ic === 'fire' ? `<span class="hub-fire-ic">${FLAME}</span>` : hubIcon(it.ic, 30);
      return `<div class="${cls}" data-step="${i}" style="--i:${i}"><span class="hub-num">${it.done ? '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : i + 1}</span>
        <div class="hub-step-body"><b>${ic}<span class="hub-tt">${esc(it.title)}</span></b><span class="hub-meta">${it.meta.filter(Boolean).map(x => `<span>${x}</span>`).join('')}</span></div>
        <button type="button" class="btn${i === nowIdx ? ' primary' : ''}" data-step-go="${i}">${esc(it.btn)}${i === nowIdx ? ' →' : ''}</button></div>`;
    };
    const tileHtml = (t, i) => `<div class="hub-tile${t.big ? ' big' : ''}" role="button" tabindex="0" data-tile="${i}" style="--sec:${hubColor(t.k)};--i:${i}">
      ${t.badge ? `<span class="hub-badge">${esc(t.badge)}</span>` : ''}${hubIcon(t.k, 52)}<b>${esc(t.name)}</b><span class="hub-sub">${esc(t.sub)}</span>${t.extra || ''}
      <span class="btn hub-act${t.hot ? ' hot' : ''}">${esc(t.btn)}</span></div>`;
    $('#scopeInfo').innerHTML = '<span class="scope-title">Главная</span>';
    const html = `
      <div class="hub-hello"><div><h1>${hubHello()}</h1><p>${sub}</p></div><div class="hub-pills">${hubPills()}</div></div>
      <section class="hub-plan" aria-label="План на сегодня"><h2>План на сегодня <small>${doneN} из ${plan.length} сделано</small></h2>
        ${plan.map(stepHtml).join('')}
        <div class="hub-day"><span>День</span><i class="hub-track"><b data-bar="day" data-w="${plan.length ? Math.round(doneN / plan.length * 100) : 0}"></b></i>
          <span>${doneN === plan.length ? 'всё сделано — так держать!' : `сделано ${doneN} из ${plan.length}`}</span></div></section>
      <h2 class="hub-h2">Все разделы</h2>
      <div class="hub-tiles">${tiles.map(tileHtml).join('')}</div>`;
    HUB_ACT = { plan, tiles };
    if (!enter && html.replace(/hg\d+/g, '') === hubSig && trainerEl.querySelector('.hub')) return;
    hubSig = html.replace(/hg\d+/g, '');
    trainerEl.innerHTML = `<div class="hub${enter ? ' hub-enter' : ''}">${html}</div>`;
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
    window.scrollTo(0, 0);
    renderHub(true);
    clearTimeout(hubTimer);
  }
  trainerEl.addEventListener('click', e => {
    if (!courseShown || pageKind !== 'hub') return;
    const n = e.target.closest('[data-hub-n]');
    if (n) { e.stopPropagation(); setScope(+n.dataset.hubN); return; }
    const s = e.target.closest('[data-step-go]');
    if (s) { const it = HUB_ACT.plan[+s.dataset.stepGo]; if (it) it.go(); return; }
    const p = e.target.closest('[data-hub-go]');
    if (p) {
      const k = p.dataset.hubGo;
      if (k === 'forecast') openForecast();
      else if (k === 'level') openGame();
      else if (k === 'coins') $('#coinCard').click();
      else if (k === 'league') openRating('league');
      else if (k === 'fire') setScope('all');
      return;
    }
    const t = e.target.closest('[data-tile]');
    if (t) { const it = HUB_ACT.tiles[+t.dataset.tile]; if (it) it.go(); }
  });
  trainerEl.addEventListener('keydown', e => {
    if (!courseShown || pageKind !== 'hub' || (e.key !== 'Enter' && e.key !== ' ')) return;
    const t = e.target.closest('[data-tile]');
    if (t && e.target === t) { e.preventDefault(); t.click(); }
  });
  // уход с главной: вернуть боковую панель и верхнюю строку
  // с главной ушли к заданиям — запись в истории браузера, чтобы «Назад» вернул на главную, а не увёл с сайта
  new MutationObserver(() => {
    if (courseShown && pageKind === 'hub') return;
    if (!hubLeft) return;
    hubLeft = false;
    document.body.classList.remove('hub-on');
    if (!courseShown && history.state && history.state.v === 'hub') navPush({ v: 'main' });
  }).observe(trainerEl, { childList: true });
  $('#homeCard')?.addEventListener('click', openHub);

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
    <button type="button" class="hub-back hub-nums" id="hubNums" aria-haspopup="true" aria-expanded="false" title="Номера заданий, поиск по номеру, банки и настройки"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/></svg>Номера</button></span>`);
  document.body.insertAdjacentHTML('beforeend', '<div class="nav-shade" id="navShade" hidden></div>');
  function hubDrawer(open) {
    if (!hubNav() || isNarrow()) return;
    setSideOpen(open);
    $('#navShade').hidden = !open;
    $('#hubNums')?.setAttribute('aria-expanded', String(open));
  }
  function hubNavOn() {
    document.body.classList.add('hubnav');
    document.body.classList.remove('side-min');           // в выезжающей панели банк номеров всегда развёрнут
  }
  $('#hubBack')?.addEventListener('click', () => { hubDrawer(false); openHub(); });
  $('#hubNums')?.addEventListener('click', () => {
    if (isNarrow()) { setSideOpen(!$('.sidebar').classList.contains('open')); window.scrollTo(0, 0); return; }
    hubDrawer(!$('.sidebar').classList.contains('open'));
  });
  $('#navShade').addEventListener('click', () => hubDrawer(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && hubNav() && !$('#navShade').hidden) hubDrawer(false); });
  // выбрали номер, раздел или нашли задание — панель сама уезжает
  $('.sidebar').addEventListener('click', e => {
    if (!hubNav() || isNarrow() || $('#navShade').hidden) return;
    if (e.target.closest('.num-card, .rail-btn, #allNums, #supportBtn, .side-actions .link-btn, #versionBtn')) setTimeout(() => hubDrawer(false), 0);
  });
  $('#searchForm')?.addEventListener('submit', () => setTimeout(() => hubDrawer(false), 0));

  // окно как страница: открылось — запись в истории браузера, «Назад» закрывает его
  let hubModalState = false, hubSkipPop = false;
  new MutationObserver(() => {
    const open = !$('#forecastModal').hidden;
    if (!hubNav() || open === hubModalState) return;
    hubModalState = open;
    if (open) { try { if (!history.state) history.replaceState({ v: 'main' }, ''); history.pushState({ v: 'modal' }, ''); } catch (e) { /* не страшно */ } }
    else if (history.state && history.state.v === 'modal') { hubSkipPop = true; history.back(); }   // закрыли кнопкой — убрать запись
  }).observe($('#forecastModal'), { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('popstate', () => {
    if (hubModalState && !$('#forecastModal').hidden) { hubModalState = false; closeForecast(); }
  });
