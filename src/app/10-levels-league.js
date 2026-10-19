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
    if (g.exam_coins > (old.exam_coins || 0)) toast(`🎓 +${g.exam_coins - (old.exam_coins || 0)} ₿ за вариант ЕГЭ`, 5000);
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
  /** Подарки у ника — маленькие значки после наград: уникальный — на своём цветном фоне, одинаковые обычные — числом. */
  const giftBadge = g => (g.u ? `<span class="bdg ugb r-${g.u.r}" style="--c1:${g.u.c1};--c2:${g.u.c2}" title="${esc(g.t)}"><i class="gfx-${g.u.fx}">${esc(g.i)}</i></span>`
    : badgeHtml(g));
  const giftsHtml = r => (r.gifts || []).length ? ` <span class="lb-gifts">${r.gifts.map(giftBadge).join('')}</span>` : '';
  const badgesHtml = r => ((r.badges || []).length ? ` <span class="lb-badges">${r.badges.map(badgeHtml).join('')}</span>` : '') + giftsHtml(r);
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
          <div class="pf-nick">У ника: ${nick.length || (P.gifts || []).length ? `<span class="lb-badges">${nick.map(badgeHtml).join('')}</span>${giftsHtml(P)}` : '<span class="fm-muted">пока ничего</span>'}</div>
          ${!P.me && !TEACHER && SERVER ? `<p><button type="button" class="btn small" data-gift-to="${P.sid}">🎁 Подарить подарок</button></p>` : ''}</div></div>
      ${tools}
      ${profGiftsHtml(P)}
      <h3 class="fm-sub">Награды — можно получать много раз</h3>
      <div class="ach-grid">${P.awards.map(a => profItem(a, 'award')).join('')}${P.extra.map(a => profItem(a, 'extra')).join('')}</div>
      <h3 class="fm-sub">Достижения · ${P.ach.length} из ${P.ach_total} — даются один раз</h3>
      ${P.ach.length ? `<div class="ach-grid">${P.ach.map(a => profItem(a, 'ach')).join('')}</div>` : '<p class="fm-muted">Пока ни одного.</p>'}`;
  }
  /** Витрина подарков в профиле: уникальные — плиткой со своим фоном, узором и номером, обычные — значком. */
  function profGiftsHtml(P) {
    const list = P.gift_list || [];
    if (!list.length) return P.me ? '<h3 class="fm-sub">🎁 Подарки</h3><p class="fm-muted">Пока ни одного — <button type="button" class="link-btn" data-gift-to="">открыть магазин подарков</button>.</p>' : '';
    const from = g => g.from === 'учитель' ? 'от учителя' : g.from === 'труд' ? 'за труд' : g.from === 'сам себе' ? 'купил себе' : g.from ? 'от ' + g.from : '';
    const tip = g => [g.t + (g.uniq ? ' #' + g.uniq.n : ''), gfRar(g) ? `${gfRar(g).t}: ${rarWhy(g)}` : '',
      g.uniq ? g.uniq.props.map(p => `${p.k}: ${p.t} (${String(p.p).replace('.', ',')}%)`).join(', ') : '', from(g)].filter(Boolean).join(' · ');
    const uniq = list.filter(g => g.uniq).length;
    return `<h3 class="fm-sub">🎁 Подарки · ${P.gifts_total}${uniq ? ` <span class="fm-muted">· уникальных ${uniq}</span>` : ''}</h3>
      <div class="pf-gifts">${list.map(g => `<div class="pf-gift${g.uniq ? ' uniq' : ''}" title="${esc(tip(g))}">${g.uniq ? uniqTile(g) : `<span class="ug plain r-${g.rar.k}"><span class="ug-ic">${g.i}</span></span>`}
        <small>${esc(g.t)}${g.uniq ? ' #' + g.uniq.n : ''}</small>${rarHtml(g)}</div>`).join('')}</div>
      ${P.me ? '<p class="fm-note">Улучшить подарок до уникального — в «Биткоины и подарки» (кнопка ₿ вверху).</p>' : ''}`;
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

