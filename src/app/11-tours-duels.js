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
  // живое обновление дуэлей и турниров на любой странице: на странице турниров и во время матча — каждые 10 с,
  // иначе — раз в 30 с; вкладка в фоне — не спрашиваем, вернулся на неё — сразу обновляем
  let liveAt = 0;
  function livePoll(force) {
    if (!SERVER || !student || TEACHER || document.hidden || DSEARCH.on) return;
    const a = ui.scope === 'asg' && asgOf(ui.asg);
    const hot = (courseShown && pageKind === 'tour') || (a && a.duel);
    if (!force && Date.now() - liveAt < (hot ? 10000 : 30000)) return;
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
    DSEARCH.timer = setTimeout(duelFind, 3000);
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

