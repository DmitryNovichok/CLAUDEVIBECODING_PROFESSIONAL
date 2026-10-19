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
