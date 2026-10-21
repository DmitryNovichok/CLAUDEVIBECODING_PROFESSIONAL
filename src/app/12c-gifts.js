  // ------------------------------------------------------------ биткоины и подарки
  // Биткоины (₿) считает сервер (GAME.coins): 1 за каждые 10 XP опыта + начисления учителя − покупки. Подарок покупают
  // себе или однокласснику, «🎲 Случайный подарок» выпадает любой (дорогие — реже), учитель дарит из панели.
  // Свой подарок можно улучшить — он станет уникальным: номер и случайные фон, узор и эффект, у каждого своя редкость.
  // Редкость считает сервер: у обычного — шанс выпасть в «🎲», у уникального — шанс сочетания («1 из N»); видна на подарке.
  // Экономика саморегулируется: термостат на сервере раз в сутки двигает цены, заработок и комиссию рынка к норме среднего
  // кошелька; комиссия и плата за хранение больших сумм уходят в банк рынка, из него — стипендии и начисления учителей.
  // Комиссии и проценты ученику не показываем: только итоговые суммы («получишь N ₿», «продать сразу за N ₿»).
  // Тираж уникальных каждого вида ограничен, проданный подарок сгорает; каждые 25 решённых — подарок.
  let GF = null;                          // магазин и свои подарки с сервера
  let gfTo = '';                          // кому дарим: '' — себе, иначе sid одноклассника
  let gfTab = 'shop';                     // вкладка окна: shop, market, mine, forbes, log
  const gfDate = ts => { const d = new Date(ts * 1000); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const gfMate = sid => (GF.mates.find(m => String(m.sid) === String(sid)) || {}).name || '';
  const btcWord = n => plural(n, 'биткоин', 'биткоина', 'биткоинов');
  const gfFrom = g => (g.market ? 'с рынка · ' + g.market : g.from === 'учитель' ? 'от учителя' : g.from === 'труд' ? 'за труд'
    : g.from === 'сам себе' ? 'купил себе' : g.from ? 'от ' + g.from : '') + (g.box ? ' · выпал в 🎲' : '');
  // комиссия рынка — в банк; у выпавшего в «🎲» (g.fee) при первой продаже — 50 %
  const feeRate = g => (g && g.fee != null ? g.fee : GF.market_fee);
  const fee = (p, g) => Math.ceil(p * feeRate(g));
  const mkGetTxt = (p, g) => `получишь ${p - fee(p, g)} ₿, когда купят`;
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
    : g.rar && g.rar.k === 'limited' ? 'продавался одну неделю ограниченным тиражом, в 🎲 не выпадает'
    : g.rar ? `шанс выпасть в 🎲 случайном подарке — ${String(g.rar.p).replace('.', ',')}%` : '');
  // Окно «Биткоины» как приложение: вкладки снизу (Магазин / Рынок / Мои / Forbes / История), нажал на подарок — снизу шторка
  // с крупными кнопками; правила и экономика — под «?». Текста на экране — минимум: суммы и действия.
  let gfSheet = null;                     // шторка: { k: 'mine' | 'shop' | 'mk' | 'help', id } или null
  let gfMkOpen = false;                   // в шторке своего подарка открыта строка «выставить на рынок»
  let gfFresh = 0;                        // только что улучшенный подарок — плитка «раскрывается»
  let FB = null, fbTab = 'rich';          // Forbes класса и его вкладка
  const num = v => Number(v || 0).toLocaleString('ru-RU');
  const gfTile = (g, s = 52, extra = '') => `<span class="bx-t s${s}">${g.uniq ? uniqTile(g, extra) : `<span class="ug plain r-${g.rar.k} ${extra}"><span class="ug-ic">${g.i}</span></span>`}</span>`;
  const gfName = g => esc(g.t) + (g.uniq ? ` <span class="ug-num">#${g.uniq.n}</span>` : '');

  async function openGifts(to, open, tab) {
    if (!SERVER) return;
    try { GF = await api('gifts'); } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось открыть подарки'); return; }
    if (to !== undefined) { gfTo = to && gfMate(to) ? String(to) : ''; if (gfTo) gfTab = 'shop'; }
    gfSheet = open ? { k: 'mine', id: open } : null;
    if (open) gfTab = 'mine';
    if (tab) gfTab = tab;
    gfMkOpen = false;
    if (gfTab === 'forbes') loadForbes();
    const fresh = $('#forecastModal').hidden;
    renderGifts();
    $('#forecastModal').hidden = false;
    if (fresh) {                                  // только что открыли — с начала (на телефоне окно само уезжало вниз)
      const m = $('#forecastModal');
      m.scrollTop = 0;
      requestAnimationFrame(() => { m.scrollTop = 0; });
    }
  }
  async function loadForbes() {
    try { FB = await api('forbes'); } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось открыть Forbes'); return; }
    if (gfTab === 'forbes' && GF && !$('#forecastModal').hidden) renderGifts();
  }
  function renderGifts() {
    if (gfSheet && gfSheet.k === 'mine' && !GF.mine.find(x => x.id === gfSheet.id)) gfSheet = null;
    const G = GF, tabs = [['shop', '🛍', 'Магазин'], ['market', '🏪', 'Рынок', G.market.filter(x => !x.mine).length],
      ['mine', '🎁', 'Мои', G.mine.length], ['forbes', '🏆', 'Forbes'], ['log', '📜', 'История']];
    const body = { shop: shopTab, market: marketTab, mine: mineTab, forbes: forbesTab, log: logTab }[gfTab] || shopTab;
    $('#forecastBody').innerHTML = `<div class="bx${gfSheet ? ' has-sheet' : ''}">
      <div class="bx-top"><h2>Биткоины</h2><span class="bx-pill" title="${num(G.coins)} ${btcWord(G.coins)}">₿ ${num(G.coins)}</span>
        <button type="button" class="bx-q" data-bx-help title="Как заработать и как всё устроено">?</button></div>
      <div class="bx-body">${body(G)}</div>
      ${gfSheet ? `<div class="bx-sheet" role="dialog"><button type="button" class="bx-grab" data-bx-close aria-label="Закрыть"></button>${sheetHtml(G)}</div>` : ''}
      <nav class="bx-tabs">${tabs.map(([k, i, t, n]) => `<button type="button" class="${gfTab === k ? 'on' : ''}" data-bx-tab="${k}"><span>${i}</span>${t}${n ? `<b>${n}</b>` : ''}</button>`).join('')}</nav>
    </div>`;
  }
  // ---- вкладки
  function shopTab(G) {
    const lim = G.limited, who = gfTo ? gfMate(gfTo) : '';
    const left = Math.max(0, G.per_day - G.bought_today);
    const trend = d => (d >= 1.05 ? '<em class="gf-trend up">▲</em>' : d <= 0.95 ? '<em class="gf-trend down">▼</em>' : '');
    const item = (id, i, t, price, cls, rar, dem) => `<button type="button" class="bx-it ${cls || ''}${rar ? ' r-' + rar.k : ''}${price > G.coins ? ' dim' : ''}" data-bx-shop="${id}" title="${esc(t)}">
      <span class="e">${i}</span><b>₿ ${num(price)}${trend(dem || 1)}</b>${cls === 'box' ? '<small>Случайный</small>' : ''}</button>`;
    return `${who ? `<div class="bx-for">🎁 Подарок для <b>${esc(who)}</b><button type="button" class="bx-x" data-bx-to="" title="Покупать себе">✕</button></div>` : ''}
      ${G.mine.length ? `<div class="bx-sec">🎁 Мои подарки <small>${G.mine.length}</small><button type="button" class="bx-more" data-bx-tab="mine">все →</button></div>
        <div class="bx-shelf">${G.mine.slice(0, 12).map(x => `<button type="button" class="bx-own" data-bx-mine="${x.id}" title="${esc(x.t)}">${gfTile(x, 64)}${x.listed != null ? '<i>🏪</i>' : ''}</button>`).join('')}</div>` : ''}
      ${lim && lim.left ? `<button type="button" class="bx-lim" data-bx-shop="${lim.gift}"><span class="e">${lim.i}</span><span><b>Лимитка недели · ${esc(lim.t)}</b>
        <small>осталось ${lim.left} из ${lim.cap} · до ${gfDate(lim.stop).slice(0, 5)}</small></span><span class="bx-price">₿ ${num(lim.price)}</span></button>` : ''}
      <div class="bx-sec">🛍 Магазин${left < 5 ? ` <small>${left ? `сегодня можно ещё ${left}` : 'на сегодня всё — завтра снова'}</small>` : ''}</div>
      ${G.teacher ? '<p class="fm-muted">Учительский аккаунт дарит подарки из панели учителя.</p>' : ''}
      <div class="bx-grid">${item('box', '🎲', 'Случайный подарок', G.box, 'box')}${G.catalog.map(x => item(x.id, x.i, x.t, x.price, '', x.rar, x.demand)).join('')}</div>`;
  }
  function marketTab(G) {
    if (!G.market.length) return `<div class="bx-empty"><span>🏪</span><b>Пока никто ничего не продаёт</b><small>Свой подарок — во вкладке «Мои» → «На рынок»</small></div>`;
    return `<div class="bx-list">${G.market.map(x => `<button type="button" class="bx-row${x.mine ? ' mine' : ''}" data-bx-mk="${x.id}">${gfTile(x, 52)}
      <span class="bx-rt"><b>${gfName(x)}</b> ${rarHtml(x)}<small>${x.mine ? 'твой' : esc(x.seller)}${x.price < x.shop ? ' · дешевле магазина' : ''}</small></span>
      <span class="bx-price${x.mine ? ' ghost' : ''}">₿ ${num(x.price)}</span></button>`).join('')}</div>`;
  }
  function mineTab(G) {
    if (!G.mine.length) return `<div class="bx-empty"><span>🎁</span><b>Пока ни одного подарка</b><small>Купи себе первый в «Магазине»</small>
      <button type="button" class="btn primary" data-bx-tab="shop">🛍 В магазин</button></div>`;
    const V = G.value;
    return `${V && V.n ? `<div class="bx-worth"><small>💎 Твои подарки стоят</small><b>≈ ₿ ${num(V.sell)}</b></div>` : ''}
      <div class="bx-mine">${G.mine.map(x => `<button type="button" class="bx-card r-${gfRar(x).k}" data-bx-mine="${x.id}">${gfTile(x, 64)}
        <b>${gfName(x)}</b><small>${x.listed != null ? `🏪 ₿ ${num(x.listed)}` : `≈ ₿ ${num(x.sell)}`}</small></button>`).join('')}</div>`;
  }
  function logTab(G) {
    const why = { grant: '➕ Учитель', take: '➖ Учитель', gift: '🎁 Покупка', upgrade: '✨ Улучшение', sell: '💰 Продажа',
      mbuy: '🏪 Купил у', msell: '🏪 Продал —', storage: '📦 Хранение', stipend: '🎓 Стипендия' };
    const sum = [G.task_coins ? `🧩 за задания <b class="xp-plus">+${num(G.task_coins)}</b>` : '', G.exam_coins ? `🎓 за варианты <b class="xp-plus">+${num(G.exam_coins)}</b>` : '',
      G.fines ? `⏱ штрафы <b class="xp-minus">−${num(G.fines)}</b>` : ''].filter(Boolean);
    const rows = G.ledger.map(r => `<tr><td class="fm-muted">${gfDate(r.ts).slice(0, 5)}</td><td>${why[r.reason] || esc(r.reason)}${r.note ? (r.reason === 'mbuy' || r.reason === 'msell' ? ` ${esc(r.note)}` : ` <span class="fm-muted">«${esc(r.note)}»</span>`) : ''}</td>
      <td class="num ${r.delta > 0 ? 'xp-plus' : 'xp-minus'}">${r.delta > 0 ? '+' : '−'}${num(Math.abs(r.delta))}</td></tr>`).join('');
    return `${sum.length ? `<div class="bx-sum">${sum.map(x => `<span>${x}</span>`).join('')}</div>` : ''}
      ${rows ? `<table class="fm-table bx-log">${rows}</table>` : '<div class="bx-empty"><span>📜</span><b>Пока пусто</b><small>Биткоины за опыт приходят сами — их здесь нет</small></div>'}`;
  }
  // ---- Forbes класса: обложка журнала, список и вкладки
  const fbAv = (r, s) => (r.avatar ? `<span class="fb-av r-${r.avatar.uniq.rar.k}" style="--c1:${r.avatar.uniq.c1};--c2:${r.avatar.uniq.c2};--s:${s}px">${r.avatar.i}</span>`
    : `<span class="fb-av plain" style="--s:${s}px">${esc(r.name[0] || '?')}</span>`);
  const fbDelta = w => (w == null ? '' : `<em class="fb-dl ${w > 0 ? 'up' : w < 0 ? 'dn' : ''}">${w > 0 ? '▲' : w < 0 ? '▼' : '='} ${w ? num(Math.abs(w)) : ''}</em>`);
  const fbTags = r => [r.rocket ? '<span class="fb-tag rocket">🚀 рывок недели</span>' : '', r.new ? '<span class="fb-tag new">новичок</span>' : '',
    r.me ? '<span class="fb-tag me">это ты</span>' : ''].join('');
  const RK_T = { 'u:myth': 'мифич.', 'u:legend': 'легенд.', 'u:epic': 'эпич.', 'u:rare': 'редк.', limited: 'лимитка' };
  function forbesTab() {
    const subs = [['rich', '💰 Состояние'], ['gift', '🎁 Подарок'], ['coll', '🖼 Коллекция'], ['rare', '💎 Редкость']];
    const head = `<div class="fb-head"><div class="fb-title">FORBES <i>Egeshka</i></div><small>Самые богатые в классе · ${FB ? FB.month : ''}</small></div>
      <div class="fb-subs">${subs.map(([k, t]) => `<button type="button" class="${fbTab === k ? 'on' : ''}" data-fb-tab="${k}">${t}</button>`).join('')}</div>`;
    if (!FB) return head + '<p class="fm-muted">Загружаю…</p>';
    const gap = (list, i) => (i && list[i].rank > list[i - 1].rank + 1 ? '<div class="fb-gap">…</div>' : '');
    const row = (r, i, list, val, sub) => `${gap(list, i)}<button type="button" class="fb-row${r.me ? ' me' : ''}" data-prof="${r.sid}" data-fb-prof>
      <span class="fb-pl">${r.rank}</span>${fbAv(r, 40)}<span class="fb-who"><b>${esc(r.name)} ${fbTags(r)}</b>${sub}</span><span class="fb-val">${val}</span></button>`;
    const shelf = r => `<span class="fb-shelf">${r.tops.slice(0, 4).map(g => gfTile(g, 24)).join('')}</span>`;
    if (fbTab === 'gift') {
      if (!FB.gifts.length) return head + '<div class="bx-empty"><span>🎁</span><b>Подарков пока нет</b></div>';
      return head + `<div class="fb-list">${FB.gifts.map((g, i) => `<button type="button" class="fb-row${g.me ? ' me' : ''}" data-prof="${g.sid}" data-fb-prof>
        <span class="fb-pl">${i + 1}</span>${gfTile(g, i ? 40 : 56)}<span class="fb-who"><b>${gfName(g)}</b><small>${rarHtml(g)} ${esc(g.owner)}${g.me ? ' · это ты' : ''}</small></span>
        <span class="fb-val"><b><span class="coin">₿</span> ${num(g.sell)}</b></span></button>`).join('')}</div>`;
    }
    if (fbTab === 'coll') {
      if (!FB.coll.length) return head + '<div class="bx-empty"><span>🖼</span><b>Коллекций пока нет</b></div>';
      return head + `<div class="fb-list">${FB.coll.map((r, i, l) => row(r, i, l, `<b><span class="coin">₿</span> ${num(r.value)}</b><small>${r.n} ${plural(r.n, 'подарок', 'подарка', 'подарков')}</small>`, shelf(r))).join('')}</div>`;
    }
    if (fbTab === 'rare') {
      if (!FB.rare.length) return head + '<div class="bx-empty"><span>💎</span><b>Коллекций пока нет</b></div>';
      const tiers = r => Object.entries(r.tiers).filter(([k]) => RK_T[k]).sort((a, b) => Object.keys(RK_T).indexOf(a[0]) - Object.keys(RK_T).indexOf(b[0]))
        .map(([k, c]) => `<span class="fb-tier r-${k.replace('u:', '')}">${c} ${RK_T[k]}</span>`).join('');
      return head + `<div class="fb-list">${FB.rare.map((r, i, l) => row(r, i, l, `${r.rarest ? gfTile(r.rarest, 40) : ''}`,
        `<span class="fb-tiers">${tiers(r) || '<small>обычные подарки</small>'}</span>`)).join('')}</div>`;
    }
    const L = FB.rich;
    if (!L.length) return head + '<div class="bx-empty"><span>💰</span><b>Пока пусто</b><small>Решай задания — биткоины приходят сами</small></div>';
    const h = L[0];
    const hero = `<button type="button" class="fb-hero" data-prof="${h.sid}" data-fb-prof><span class="crown">👑</span>${fbAv(h, 64)}
      <span class="fb-hm"><b class="nm">${esc(h.name)} ${fbTags(h)}</b><b class="big"><span>₿</span> ${num(h.total)}</b>
        <small>кошелёк ${num(h.wallet)} · подарки ${num(h.value)}${h.week ? ` · за неделю ${h.week > 0 ? '+' : '−'}${num(Math.abs(h.week))}` : ''}</small>
        <span class="fb-bar"><i style="width:${h.total ? Math.round(100 * h.wallet / h.total) : 0}%"></i></span></span>
      <span class="fb-tops">${h.tops.slice(0, 2).map(g => gfTile(g, 46)).join('')}</span></button>`;
    return head + hero + `<div class="fb-list">${L.slice(1).map((r, i, l) => row(r, i, l, `<b><span class="coin">₿</span> ${num(r.total)}</b>${fbDelta(r.week)}`, shelf(r))).join('')}</div>
      <p class="fb-foot">Состояние — биткоины и подарки вместе · у всех вместе ₿ ${num(FB.sum)}</p>`;
  }
  // ---- шторки
  function sheetHtml(G) {
    const S = gfSheet;
    if (S.k === 'help') return helpSheet(G);
    if (S.k === 'shop') {
      const box = S.id === 'box', lim = G.limited && G.limited.gift === S.id ? G.limited : null;
      const g = box ? { i: '🎲', t: 'Случайный подарок', price: G.box, rar: null } : lim ? { ...lim, rar: { k: 'limited', t: 'Лимитка' } } : G.catalog.find(x => x.id === S.id);
      if (!g) return '';
      const short = Math.max(0, g.price - G.coins), who = gfTo ? gfMate(gfTo) : '';
      return `<div class="bx-sh">${box ? '<span class="bx-t s76"><span class="ug plain gf-boxt"><span class="ug-ic">🎲</span></span></span>' : gfTile(g, 76)}
          <div><b class="nm">${esc(g.t)}</b>${g.rar ? rarHtml(g) : ''}<small>${box ? 'выпадет любой — дорогие реже' : lim ? `осталось ${lim.left} из ${lim.cap}` : ''}</small></div></div>
        ${G.teacher ? '' : `<label class="bx-who">Кому <select class="inp" id="bxTo"><option value="">себе</option>${G.mates.map(m => `<option value="${m.sid}"${String(m.sid) === gfTo ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>`}
        <div class="bx-acts one"><button type="button" class="bx-btn pri" data-bx-buy="${esc(S.id)}"${short || G.teacher ? ' disabled' : ''}>
          <span>${who ? '🎁' : '🛍'}</span>${who ? 'Подарить' : 'Купить'}<small>${short ? `не хватает ₿ ${num(short)}` : `₿ ${num(g.price)}`}</small></button></div>`;
    }
    if (S.k === 'mk') {
      const x = G.market.find(m => m.id === S.id);
      if (!x) return '';
      return `<div class="bx-sh">${gfTile(x, 76)}<div><b class="nm">${gfName(x)}</b>${rarHtml(x)}<small>${x.mine ? 'твой' : 'продаёт ' + esc(x.seller)} · в магазине ₿ ${num(x.shop)}</small></div></div>
        <div class="bx-acts one">${x.mine ? `<button type="button" class="bx-btn" data-bx-unlist="${x.id}"><span>↩</span>Снять с продажи<small>₿ ${num(x.price)}</small></button>`
          : `<button type="button" class="bx-btn org" data-bx-mbuy="${x.id}"${G.teacher || G.coins < x.price ? ' disabled' : ''}><span>🏪</span>Купить<small>${G.coins < x.price ? `не хватает ₿ ${num(x.price - G.coins)}` : `₿ ${num(x.price)}`}</small></button>`}</div>`;
    }
    const g = G.mine.find(x => x.id === S.id);
    if (!g) return '';
    const u = g.uniq, listed = g.listed != null;
    const up = u ? `<button type="button" class="bx-btn pri" disabled><span>✨</span>Уникальный<small>1 из ${num(u.rar.one_in)}</small></button>`
      : g.limited ? '<button type="button" class="bx-btn pri" disabled><span>✨</span>Улучшить<small>лимитку нельзя</small></button>'
      : g.up == null ? '<button type="button" class="bx-btn pri" disabled><span>✨</span>Улучшить<small>тираж кончился</small></button>'
      : listed ? '<button type="button" class="bx-btn pri" disabled><span>✨</span>Улучшить<small>сначала сними с рынка</small></button>'
      : `<button type="button" class="bx-btn pri" data-bx-up="${g.id}"${GF.coins < g.up ? ' disabled' : ''}><span>✨</span>Улучшить<small>${GF.coins < g.up ? `не хватает ₿ ${num(g.up - GF.coins)}` : `₿ ${num(g.up)}`}</small></button>`;
    const sell = `<button type="button" class="bx-btn" data-bx-sell="${g.id}"${listed ? ' disabled' : ''}><span>💰</span>Продать<small>₿ ${num(g.sell)}</small></button>`;
    const mk = listed ? `<button type="button" class="bx-btn org" data-bx-unlist="${g.id}"><span>↩</span>Снять с рынка<small>₿ ${num(g.listed)}</small></button>`
      : `<button type="button" class="bx-btn org${gfMkOpen ? ' on' : ''}" data-bx-mkopen><span>🏪</span>На рынок<small>своя цена</small></button>`;
    const suggest = Math.max(GF.market_min, u ? Math.round(g.sell * 1.5 / 5) * 5 : ((GF.catalog.find(x => x.id === g.gift) || {}).price || g.sell));
    const props = u ? `<div class="bx-props">${u.props.map(p => `<span><small>${p.k}</small>${esc(p.t)}</span>`).join('')}</div>` : '';
    return `<div class="bx-sh">${gfTile(g, 76, gfFresh === g.id ? 'reveal' : '')}<div><b class="nm">${gfName(g)}</b>${rarHtml(g)}
        <small>${esc([gfFrom(g), gfDate(g.ts).slice(0, 5)].filter(Boolean).join(' · '))}</small>${g.note ? `<small class="bx-note">«${esc(g.note)}»</small>` : ''}</div></div>
      ${props}
      <div class="bx-acts">${up}${sell}${mk}</div>
      ${gfMkOpen && !listed ? `<div class="bx-mkrow"><label>₿ <input class="inp" id="mkPrice" type="number" min="${GF.market_min}" max="${GF.market_max}" value="${suggest}"></label>
        <button type="button" class="btn primary" data-bx-list="${g.id}">Выставить</button><span class="fm-muted" id="mkGet">${mkGetTxt(suggest, g)}</span></div>` : ''}`;
  }
  function helpSheet(G) {
    return `<h3 class="bx-h">Как это устроено</h3>
      <ul class="bx-help">
        <li>⚒ Биткоины — только трудом: 1 ₿ за ${G.coin_xp} XP опыта${G.econ.earn !== 1 ? ` (сейчас весь заработок ×${idxTxt(G.econ.earn)})` : ''} и ещё сверху за каждое решённое задание — чем сложнее, тем больше.</li>
        <li>🎓 Вариант ЕГЭ — бонус по тестовому баллу: ${examBtcTxt(G)}. Самостоятельные от учителя — так же.</li>
        <li>🎁 Каждые ${G.work_every} решённых заданий — подарок в награду.</li>
        <li>⏱ Решено слишком быстро — минус 1 ₿: быстрее ${G.fine_sec} секунд, №24–27 — быстрее ${Object.entries(G.hard_min || {}).map(([n, m]) => `${m} мин (№${n})`).join(', ')}.</li>
        <li>✨ Улучшение делает подарок уникальным: номер, фон, узор, эффект и поза. Тираж — ${G.cap} штук каждого вида.</li>
        <li>🏪 Свой подарок можно продать сразу или выставить на рынок одноклассникам за свою цену.</li>
        <li>🏷 Цены и заработок меняются раз в сутки сами — по тому, сколько биткоинов у всех. Копить очень много невыгодно.</li>
      </ul>
      <div class="bx-sum"><span>⚒ заработок <b>×${idxTxt(G.econ.earn)}</b></span><span>🏷 цены <b>×${idxTxt(G.econ.idx)}</b></span><span>🏦 банк <b>₿ ${num(G.econ.bank)}</b></span></div>`;
  }
  // ---- действия
  async function buyGift(id) {
    const box = id === 'box', g = box ? { i: '🎲', t: 'Случайный подарок', price: GF.box }
      : GF.limited && GF.limited.gift === id ? GF.limited : GF.catalog.find(x => x.id === id);
    const who = gfTo ? gfMate(gfTo) : '';
    if (!g) return;
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
      gfFresh = id;
      await openGifts(undefined, id);
      setTimeout(() => { gfFresh = 0; }, 2500);
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось улучшить'); }
  }
  async function sellGift(id) {
    const g = GF.mine.find(x => x.id === id);
    if (!g || !confirm(`Продать ${g.i} ${g.t}${g.uniq ? ' #' + g.uniq.n : ''} за ${g.sell} ₿? Подарок сгорит — вернуть его будет нельзя.`)) return;
    try {
      const r = await api('gifts/sell', { id });
      if (r.game) onGame(r.game);
      toast(`💰 Продано за ${r.price} ₿`, 4000);
      await openGifts(undefined, undefined, 'mine');
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось продать'); }
  }
  async function listGift(id) {
    const price = Math.round(+($('#mkPrice') || {}).value || 0);
    try {
      const r = await api('gifts/list', { id, price });
      toast(`🏪 На рынке за ${r.price} ₿ — получишь ${r.get} ₿, когда купят`, 4500);
      await openGifts(undefined, id);
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось выставить'); }
  }
  async function unlistGift(id) {
    const tab = gfTab;
    try { await api('gifts/unlist', { id }); toast('Снято с продажи', 3000); await openGifts(undefined, tab === 'mine' ? id : undefined, tab); }
    catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось снять'); }
  }
  async function marketBuy(id) {
    const x = GF.market.find(m => m.id === id);
    if (!x) return;
    try {
      const r = await api('gifts/mbuy', { id, price: x.price });
      if (r.game) onGame(r.game);
      toast(`🏪 ${x.i} ${x.t}${x.uniq ? ' #' + x.uniq.n : ''} — теперь у тебя`, 5000);
      await openGifts(undefined, undefined, 'mine');
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось купить'); await openGifts(undefined, undefined, 'market'); }
  }
  /** «40+ — 15 ₿, 60+ — 30 ₿…» — бонусы за вариант ЕГЭ от меньшего балла к большему. */
  const examBtcTxt = G => G.exam_btc.slice().reverse().map(([low, b]) => `${low}+ — ${b} ₿`).join(', ');
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
      : c.reason === 'storage' ? `📦 Плата за хранение большой суммы: −${-c.delta} ₿. Биткоины выгоднее тратить, чем копить`
      : c.reason === 'stipend' ? `🎓 Стипендия из банка рынка: +${c.delta} ₿ — ${c.note}`
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
    if (GF && !gfSheet && !$('#forecastModal').hidden && $('#forecastBody .bx')) openGifts(undefined, undefined, gfTab);
  }
  $('#coinCard')?.addEventListener('click', () => openGifts(undefined, undefined, 'shop'));
  $('#whoGifts')?.addEventListener('click', () => { setWhoMenu(false); openGifts(undefined, undefined, 'shop'); });
  /** Forbes класса — вкладка окна «Биткоины» (и возврат к ней из профиля). */
  const openForbes = () => openGifts(undefined, undefined, 'forbes');
  document.addEventListener('click', e => {
    const to = e.target.closest('[data-gift-to]');
    if (to) { openGifts(to.dataset.giftTo, undefined, 'shop'); return; }
    if (!GF || !e.target.closest('#forecastBody .bx')) return;
    const b = e.target.closest(`[data-bx-tab], [data-bx-help], [data-bx-close], [data-bx-shop], [data-bx-mine], [data-bx-mk], [data-bx-to], [data-bx-buy],
      [data-bx-up], [data-bx-sell], [data-bx-mkopen], [data-bx-list], [data-bx-unlist], [data-bx-mbuy], [data-fb-tab]`);
    if (gfSheet && !e.target.closest('.bx-sheet')) {      // нажал мимо шторки — закрыть (вкладка снизу и «?» — ещё и сработать)
      gfSheet = null;
      gfMkOpen = false;
      if (!b || (b.dataset.bxTab == null && b.dataset.bxHelp == null)) { renderGifts(); return; }
    }
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.bxClose != null) { gfSheet = null; gfMkOpen = false; renderGifts(); return; }
    if (d.bxHelp != null) { gfSheet = { k: 'help' }; renderGifts(); return; }
    if (d.bxTab != null) {
      gfTab = d.bxTab;
      if (gfTab === 'forbes') loadForbes();
      renderGifts();
      $('#forecastModal').scrollTop = 0;
      return;
    }
    if (d.fbTab) { fbTab = d.fbTab; renderGifts(); return; }
    if (d.bxShop) { gfSheet = { k: 'shop', id: d.bxShop }; renderGifts(); return; }
    if (d.bxMine) { gfSheet = { k: 'mine', id: +d.bxMine }; gfMkOpen = false; renderGifts(); return; }
    if (d.bxMk) { gfSheet = { k: 'mk', id: +d.bxMk }; renderGifts(); return; }
    if (d.bxTo != null) { gfTo = ''; renderGifts(); return; }
    if (d.bxMkopen != null) { gfMkOpen = !gfMkOpen; renderGifts(); if (gfMkOpen) { const i = $('#mkPrice'); if (i) { i.focus(); i.select(); } } return; }
    if (d.bxBuy) { buyGift(d.bxBuy); return; }
    if (d.bxUp) { upgradeGift(+d.bxUp); return; }
    if (d.bxSell) { sellGift(+d.bxSell); return; }
    if (d.bxList) { listGift(+d.bxList); return; }
    if (d.bxUnlist) { unlistGift(+d.bxUnlist); return; }
    if (d.bxMbuy) { marketBuy(+d.bxMbuy); }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'bxTo') { gfTo = e.target.value; renderGifts(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && gfSheet && !$('#forecastModal').hidden && $('#forecastBody .bx')) { e.stopPropagation(); gfSheet = null; gfMkOpen = false; renderGifts(); }
  }, true);
  document.addEventListener('input', e => {
    if (e.target.id !== 'mkPrice' || !GF) return;
    const p = Math.round(+e.target.value || 0), el = $('#mkGet');
    if (el) el.textContent = p >= GF.market_min && p <= GF.market_max ? mkGetTxt(p, GF.mine.find(x => x.id === (gfSheet || {}).id))
      : `цена — от ${GF.market_min} до ${GF.market_max} ₿`;
  });
