  // ------------------------------------------------------------ монеты и подарки
  // Монеты считает сервер (GAME.coins): 1 за каждые 10 XP опыта + начисления учителя − покупки. Подарок покупают
  // себе или однокласснику, учитель дарит из панели. Подарки видны маленькими значками у ника (giftsHtml).
  let GF = null;                          // магазин и свои подарки с сервера
  let gfTo = '';                          // кому дарим: '' — себе, иначе sid одноклассника
  const gfDate = ts => { const d = new Date(ts * 1000); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`; };
  const gfMate = sid => (GF.mates.find(m => String(m.sid) === String(sid)) || {}).name || '';
  const coinWord = n => plural(n, 'монета', 'монеты', 'монет');

  async function openGifts(to) {
    if (!SERVER) return;
    try { GF = await api('gifts'); } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось открыть подарки'); return; }
    gfTo = to && gfMate(to) ? String(to) : '';
    renderGifts();
    $('#forecastModal').hidden = false;
  }
  function renderGifts() {
    const G = GF, coins = G.coins, who = gfTo ? gfMate(gfTo) : '';
    const left = Math.max(0, G.per_day - G.bought_today);
    const shop = G.teacher ? '<p class="fm-note">Учительский аккаунт дарит подарки из панели учителя — вкладка «Подарки».</p>'
      : `<div class="gf-to"><label>Кому <select class="inp" id="gfTo"><option value="">себе</option>${G.mates.map(m =>
          `<option value="${m.sid}"${String(m.sid) === gfTo ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
          <span class="fm-muted">${left ? `Сегодня можно купить ещё ${left}` : 'На сегодня подарков хватит — завтра снова можно'}</span></div>
        <div class="gf-grid">${G.catalog.map(g => `<button type="button" class="gf-item" data-gift="${g.id}"${g.price > coins || !left ? ' disabled' : ''}
            title="${esc(g.t)} — ${g.price} ${coinWord(g.price)}"><span class="gf-ic">${g.i}</span><b>${esc(g.t)}</b><small>🪙 ${g.price}</small></button>`).join('')}</div>`;
    const from = g => g.from === 'учитель' ? 'от учителя' : g.from === 'сам себе' ? 'купил себе' : g.from ? 'от ' + esc(g.from) : '';
    const mine = G.mine.length ? `<div class="gf-mine">${G.mine.map(g => `<div class="gf-row"><span class="gf-ic">${g.i}</span>
        <span><b>${esc(g.t)}</b><small>${from(g)} · ${gfDate(g.ts)}${g.note ? ` · «${esc(g.note)}»` : ''}</small></span></div>`).join('')}</div>`
      : '<p class="fm-muted">Пока ни одного — купи себе первый или дождись подарка от учителя.</p>';
    $('#forecastBody').innerHTML = `
      <div class="gm-head"><span class="gm-level gf-coin">🪙</span>
        <div style="flex:1"><h2 class="fm-title" style="margin:0">${coins} ${coinWord(coins)}</h2>
          <span class="fm-muted">1 монета за каждые ${G.coin_xp} XP опыта — решай задания, и монеты придут сами. Учитель тоже может начислить монеты.</span></div></div>
      <h3 class="fm-sub">Магазин подарков${who ? ` — для ${esc(who)}` : ''}</h3>
      ${shop}
      <h3 class="fm-sub">Мои подарки · ${G.mine.length}</h3>
      ${mine}
      <p class="fm-note">Подарки видны маленькими значками у ника — в рейтинге и в профиле: до ${G.show} разных, последние — первыми.</p>`;
  }
  async function buyGift(id) {
    const g = GF.catalog.find(x => x.id === id), who = gfTo ? gfMate(gfTo) : '';
    if (!g || !confirm(`Купить ${g.i} ${g.t} за ${g.price} ${coinWord(g.price)} — ${who ? `в подарок: ${who}` : 'себе'}?`)) return;
    try {
      const r = await api('gifts/buy', { gift: id, to: gfTo ? +gfTo : null });
      if (r.game) onGame(r.game);
      toast(who ? `🎁 ${g.i} ${g.t} — подарено: ${who}` : `🎁 ${g.i} ${g.t} — теперь у тебя у ника`, 4000);
      await openGifts(gfTo);
    } catch (e) { if (e.status !== 401) toast(e.message || 'Не получилось купить'); }
  }
  function giftToast(g) {
    const t = document.createElement('div');
    t.className = 'ach-toast gift-toast';
    const from = g.from === 'учитель' ? 'от учителя' : g.from ? 'от ' + g.from : '';
    t.innerHTML = `<span class="ach-icon">${esc(g.i)}</span><span><small>Тебе подарок${from ? ' ' + esc(from) : ''}</small><b>${esc(g.t)}</b>${g.note ? `<small>«${esc(g.note)}»</small>` : ''}</span>`;
    t.addEventListener('click', () => openGifts());
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 5200);
  }
  /** Новые подарки (от учителя или одноклассника) — карточкой в углу, один раз. */
  function giftNotify(list) {
    if (!list || !list.length || TEACHER) return;
    list.slice(0, 3).forEach((g, i) => setTimeout(() => giftToast(g), 700 + i * 1700));
    if (list.length > 3) setTimeout(() => toast(`🎁 И ещё ${list.length - 3} — в «Монеты и подарки»`, 5000), 700 + 3 * 1700);
    api('gifts/seen', { ids: list.map(g => g.id) }).catch(() => {});
  }
  /** Подарили или начислили монеты — уведомление и новый счёт монет сразу. */
  async function giftLive() {
    let me;
    try { me = await api('me'); } catch (e) { return; }
    if (me.game) onGame(me.game);
    giftNotify(me.gifts_new);
    if (GF && !$('#forecastModal').hidden && $('#forecastBody .gf-mine, #forecastBody .gf-grid')) openGifts(gfTo);
  }
  $('#coinCard')?.addEventListener('click', () => openGifts());
  $('#whoGifts')?.addEventListener('click', () => { setWhoMenu(false); openGifts(); });
  document.addEventListener('click', e => {
    const to = e.target.closest('[data-gift-to]');
    if (to) { openGifts(to.dataset.giftTo); return; }
    const b = GF && e.target.closest('#forecastBody [data-gift]');
    if (b && !b.disabled) buyGift(b.dataset.gift);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'gfTo') { gfTo = e.target.value; renderGifts(); }
  });
