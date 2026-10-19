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
  const gfDate = ts => { const d = new Date(ts * 1000); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const gfMate = sid => (GF.mates.find(m => String(m.sid) === String(sid)) || {}).name || '';
  const btcWord = n => plural(n, 'биткоин', 'биткоина', 'биткоинов');
  const gfFrom = g => g.from === 'учитель' ? 'от учителя' : g.from === 'труд' ? 'за труд' : g.from === 'сам себе' ? 'купил себе' : g.from ? 'от ' + g.from : '';
  const idxTxt = x => String(x).replace('.', ',');
  /** Уникальный подарок: фон-градиент, узор из символов, эффект и номер; рамка — цвета редкости. */
  function uniqTile(g, cls = '') {
    const u = g.uniq;
    const pat = Array.from({ length: 8 }, (_, k) => `<i class="ug-s s${k}">${esc(u.ch)}</i>`).join('');
    return `<span class="ug r-${u.rar.k} ${cls}" style="--c1:${u.c1};--c2:${u.c2}">${pat}<span class="ug-ic gfx-${u.fx}">${g.i}</span><b class="ug-n">#${u.n}</b></span>`;
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
    const item = (id, i, t, price, cls = '', rar = null) => `<button type="button" class="gf-item ${cls}${rar ? ' r-' + rar.k : ''}" data-gift="${id}"${price > coins || !left ? ' disabled' : ''}
        title="${esc(t)} — ${price} ₿${rar ? ` · ${rar.t}: ${rarWhy({ rar })}` : ''}"><span class="gf-ic">${i}</span><b>${esc(t)}</b><small>₿ ${price}</small>${rar ? rarHtml({ rar }) : ''}</button>`;
    const shop = G.teacher ? '<p class="fm-note">Учительский аккаунт дарит подарки из панели учителя — вкладка «Подарки».</p>'
      : `<div class="gf-to"><label>Кому <select class="inp" id="gfTo"><option value="">себе</option>${G.mates.map(m =>
          `<option value="${m.sid}"${String(m.sid) === gfTo ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          <span class="fm-muted">${left ? `Сегодня можно купить ещё ${left}` : 'На сегодня подарков хватит — завтра снова можно'}</span></div>
        <div class="gf-grid">${item('box', '🎲', 'Случайный подарок', G.box, 'gf-box')}${G.catalog.map(x => item(x.id, x.i, x.t, x.price, '', x.rar)).join('')}</div>
        <p class="fm-note">🎲 Случайный подарок — может выпасть любой, даже Дракон; чем дороже подарок, тем реже он выпадает.</p>`;
    const mine = G.mine.length ? `<div class="gf-mine">${G.mine.map(x => `<button type="button" class="gf-own${x.uniq ? ' uniq' : ''} r-${gfRar(x).k}" data-gift-open="${x.id}"
          title="${esc(x.t)}${x.uniq ? ' #' + x.uniq.n : ''} · ${esc(gfRar(x).t)}: ${esc(rarWhy(x))}">${x.uniq ? uniqTile(x) : `<span class="gf-ic">${x.i}</span>`}
          <b>${esc(x.t)}${x.uniq ? ` <span class="ug-num">#${x.uniq.n}</span>` : ''}</b>${rarHtml(x)}<small>${esc(gfFrom(x))}</small></button>`).join('')}</div>
        <p class="fm-note">Нажми на подарок — его можно улучшить до уникального (номер, фон, узор и эффект; тираж — ${G.cap} штук каждого вида)
          или продать. Редкость: у обычного подарка — шанс выпасть в 🎲, у уникального — шанс его сочетания.</p>`
      : '<p class="fm-muted">Пока ни одного — купи себе первый или дождись подарка от учителя.</p>';
    const E = G.econ;
    $('#forecastBody').innerHTML = `
      <div class="gm-head"><span class="gm-level gf-coin">₿</span>
        <div style="flex:1"><h2 class="fm-title" style="margin:0">${coins} ${btcWord(coins)}</h2>
          <span class="fm-muted">Только трудом: 1 ₿ за каждые ${G.coin_xp} XP опыта, а каждые ${G.work_every} решённых заданий — подарок в награду.</span></div></div>
      <div class="gf-econ${E.idx > 1 ? ' up' : ''}"><b>${E.idx > 1 ? `📈 Инфляция: цены ×${idxTxt(E.idx)}` : '📊 Цены по каталогу'}</b>
        <span>Средний кошелёк учеников — ${E.avg} ₿ (норма ${E.target} ₿). Копят все — цены растут, тратят — падают.</span></div>
      <h3 class="fm-sub">Магазин подарков${who ? ` — для ${esc(who)}` : ''}</h3>
      ${shop}
      <h3 class="fm-sub">Мои подарки · ${G.mine.length}</h3>
      ${mine}
      <p class="fm-note">Подарки видны маленькими значками у ника — в рейтинге и в профиле: сначала уникальные, всего до ${G.show}.</p>`;
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
    const sell = `<p class="gf-sell"><button type="button" class="btn" data-gift-sell="${g.id}">💰 Продать за ₿ ${g.sell}</button>
        <span class="fm-muted">${vs ? vs.slice(3) : 'обычный подарок продаётся за половину цены'}</span></p>`;
    const body = u
      ? `<table class="fm-table gf-props">${u.props.map(p => `<tr><td class="fm-muted">${p.k}</td><td><b>${esc(p.t)}</b></td>
          <td class="num"><span class="chip">${String(p.p).replace('.', ',')}%</span></td></tr>`).join('')}</table>
        ${sell}
        <p class="fm-note">Уникальный подарок: такого сочетания фона, узора и эффекта больше нет ни у одного «${esc(g.t)}». Процент — как часто выпадает
          это свойство; редкость подарка — шанс всего сочетания (фон × узор × эффект): редкий, эпический (реже 1 из 1 200), легендарный (1 из 4 000), мифический (1 из 12 000).
          Выпущено уникальных «${esc(g.t)}»: ${g.issued} из ${g.cap}. Проданный подарок сгорает — его номер и сочетание больше никому не выпадут.</p>`
      : `<p>Улучши подарок — он станет <b>уникальным</b>: получит номер и случайные фон, узор и эффект. Чем реже сочетание, тем дороже его можно продать:
          редкий — дешевле улучшения, легендарный и мифический — в разы дороже.</p>
        <p>${g.up == null ? `<b>Тираж уникальных «${esc(g.t)}» закончился</b> — выпущено ${g.cap} из ${g.cap}.`
          : `<button type="button" class="btn primary" data-gift-up="${g.id}"${GF.coins < g.up ? ' disabled' : ''}>✨ Улучшить за ₿ ${g.up}</button>
          ${GF.coins < g.up ? `<span class="fm-muted"> — нужно ещё ${g.up - GF.coins} ₿</span>` : ''}
          <span class="fm-muted"> · выпущено уникальных: ${g.issued} из ${g.cap}, каждый следующий дороже</span>`}</p>
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
    if (GF && !gfOpen && !$('#forecastModal').hidden && $('#forecastBody .gf-grid, #forecastBody .gf-mine')) openGifts();
  }
  $('#coinCard')?.addEventListener('click', () => openGifts());
  $('#whoGifts')?.addEventListener('click', () => { setWhoMenu(false); openGifts(); });
  document.addEventListener('click', e => {
    const to = e.target.closest('[data-gift-to]');
    if (to) { openGifts(to.dataset.giftTo); return; }
    if (!GF || !e.target.closest('#forecastBody')) return;
    const b = e.target.closest('[data-gift], [data-gift-open], [data-gift-up], [data-gift-sell], #gfBack');
    if (!b || b.disabled) return;
    if (b.id === 'gfBack') { gfOpen = null; renderGifts(); return; }
    if (b.dataset.giftOpen) { gfOpen = +b.dataset.giftOpen; renderGifts(); return; }
    if (b.dataset.giftUp) { upgradeGift(+b.dataset.giftUp); return; }
    if (b.dataset.giftSell) { sellGift(+b.dataset.giftSell); return; }
    buyGift(b.dataset.gift);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'gfTo') { gfTo = e.target.value; renderGifts(); }
  });
