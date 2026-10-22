  // ------------------------------------------------------------ «🎲 Случайный подарок» — открытие как кейс
  // Что выпало, решает сервер: покупка уходит сразу, пока коробка трясётся и светится по шву. Дальше — только показ: крышка
  // слетает со вспышкой, лента подарков бежит под чертой (черта и подсветка — цвета редкости подарка под ней, по краям лента
  // уходит в глубину), замедляется и встаёт на выпавшем; потом — лучи, искры и аккорд: чем реже подарок, тем ярче.
  // Подарки ленты — случайные с теми же шансами, что в 🎲 (дорогие реже); «чуть не выпавшее» нарочно не подставляем.
  // Тихие щелчки — WebAudio, выключаются 🔊 (запоминается в браузере). «Пропустить», Esc или касание ленты — сразу
  // к результату; при «уменьшить движение» в системе — сразу результат.
  const CASE_N = 60, CASE_WIN = 52, CASE_SHAKE_MS = 1300, CASE_OPEN_MS = 520, CASE_MS = 5800, CASE_SNAP_MS = 360, CASE_LAND_MS = 750;
  const CASE_RANK = ['common', 'uncommon', 'rare', 'epic', 'legend', 'myth'];
  const CASE_SPARKS = { common: 14, uncommon: 20, rare: 28, epic: 40, legend: 56, myth: 72 };
  const CASE_MUTE = 'egeshka.case.mute';
  let CR = null;                          // открытый кейс: { ov, got, who, done, raf, … }
  let crMuted = (() => { try { return localStorage.getItem(CASE_MUTE) === '1'; } catch (e) { return false; } })();
  let crAC = null;
  const crEase = t => 1 - Math.pow(1 - t, 4.2);
  const crEaseIO = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const crQuick = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ---- звук: создаётся по нажатию «Купить» — иначе браузер не даст
  function crAudio() {
    if (crMuted) return null;
    try {
      crAC = crAC || new (window.AudioContext || window.webkitAudioContext)();
      if (crAC.state === 'suspended') crAC.resume();
      return crAC;
    } catch (e) { return null; }
  }
  function crTone(freq, dur, vol, type = 'sine', at = 0, to = 0) {
    const ac = crAudio();
    if (!ac) return;
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const crTick = () => crTone(1500 + Math.random() * 300, 0.035, 0.03, 'triangle');
  /** Аккорд выпавшего: чем реже подарок, тем больше нот. */
  const crChime = k => [523, 659, 784, 1046, 1318, 1568].slice(0, Math.max(0, CASE_RANK.indexOf(k)) + 1)
    .forEach((f, i) => crTone(f, 0.7, 0.05, 'sine', i * 0.08));
  /** Случайный подарок для ленты — с шансами 🎲 (rar.p — шанс в процентах). */
  function crPick(cat) {
    let r = Math.random() * cat.reduce((s, x) => s + (x.rar.p || 0), 0);
    for (const x of cat) { r -= x.rar.p || 0; if (r <= 0) return x; }
    return cat[cat.length - 1];
  }
  const crTile = (x, cls = '') => `<span class="cr-it r-${x.rar.k} ${cls}"><span class="e">${x.i}</span></span>`;
  function openCase(who) {
    let ov = $('#caseOv');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'caseOv';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', 'Случайный подарок');
      document.body.appendChild(ov);
      document.body.classList.add('cr-open');
    }
    ov.className = 'cr-ov is-case';
    ov.style.removeProperty('--hc');
    const items = Array.from({ length: CASE_N }, () => crPick(GF.catalog));
    ov.innerHTML = `<div class="cr-box">
        <div class="cr-hd"><b>🎲 Случайный подарок</b>${who ? `<small>для ${esc(who)}</small>` : ''}
          <button type="button" class="cr-snd" data-cr="snd" aria-label="Звук" title="Звук">${crMuted ? '🔇' : '🔊'}</button></div>
        <div class="cr-stage">
          <div class="cr-case"><i class="cr-rays"></i><div class="cr-gift"><i class="cr-body"></i><i class="cr-lid"></i></div>
            <div class="cr-tease"><small>может выпасть</small>${GF.catalog.slice(-5).reverse().map(x => crTile(x, 'mini')).join('')}</div></div>
          <div class="cr-roll"><div class="cr-strip"><div class="cr-track">${items.map(x => crTile(x)).join('')}</div>
            <i class="cr-mark" aria-hidden="true"></i></div><b class="cr-now" aria-hidden="true"></b></div>
          <div class="cr-rev" aria-live="polite"></div>
          <i class="cr-flash"></i>
        </div>
        <div class="cr-acts"><button type="button" class="cr-btn ghost" data-cr="skip">Пропустить ⏭</button></div></div>`;
    CR = { ov, items, who, got: null, done: false, raf: 0, k: -1, buzz: 0 };
  }
  function closeCase() {
    if (CR) { cancelAnimationFrame(CR.raf); clearTimeout(CR.timer); }
    $('#caseOv')?.remove();
    document.body.classList.remove('cr-open');
    CR = null;
  }
  async function rollBox() {
    if (CR && !CR.done) return;
    crAudio();
    const who = gfTo ? gfMate(gfTo) : '';
    openCase(who);
    const C = CR, shaken = new Promise(res => setTimeout(res, crQuick() ? 0 : CASE_SHAKE_MS));
    let r;
    try { r = await api('gifts/buy', { gift: 'box', to: gfTo ? +gfTo : null }); } catch (e) {
      if (CR === C) closeCase();
      if (e.status !== 401) toast(e.message || 'Не получилось купить');
      return;
    }
    if (r.game) onGame(r.game);
    const got = GF.catalog.find(x => x.id === r.got) || { id: r.got, i: '🎁', t: 'Подарок', price: 0, rar: { k: 'common', t: 'Обычный' } };
    const ref = openGifts().catch(() => {});        // магазин и «Мои» под кейсом обновятся, пока он открывается
    if (CR !== C) { toast(`🎲 Выпало: ${got.i} ${got.t}!${who ? ` — подарено: ${who}` : ''}`, 5000); return; }
    Object.assign(C, { got, ref });
    crPlace();
    if (C.skip || crQuick()) { crEnd(); return; }
    await shaken;
    if (CR !== C || C.done) return;
    C.ov.classList.add('is-open');
    crTone(260, 0.35, 0.05, 'sine', 0, 900);
    C.timer = setTimeout(() => { if (CR === C && !C.done) crSpin(); }, CASE_OPEN_MS);
  }
  /** Выпавший — на своё место в ленте; размеры ленты для прокрутки. */
  function crPlace() {
    const strip = CR.ov.querySelector('.cr-strip'), track = strip.querySelector('.cr-track'), tiles = track.children;
    CR.items[CASE_WIN] = CR.got;
    tiles[CASE_WIN].outerHTML = crTile(CR.got);
    const w = tiles[CASE_WIN], half = w.offsetWidth / 2;
    Object.assign(CR, {
      track, tiles, now: CR.ov.querySelector('.cr-now'), tw: w.offsetWidth, mid: strip.clientWidth / 2, off0: tiles[0].offsetLeft, pitch: tiles[1].offsetLeft - tiles[0].offsetLeft,
      x1: strip.clientWidth / 2 - (w.offsetLeft + half),         // сдвиг ленты, при котором середина выпавшего — под чертой
      jit: (Math.random() * 2 - 1) * half * 0.7,                 // встаёт не ровно посередине — потом доезжает
    });
    crAt(0);
  }
  function crSpin() {
    CR.ov.classList.add('is-roll');
    CR.t0 = performance.now();
    CR.raf = requestAnimationFrame(crFrame);
  }
  /** Лента сдвинута на x: подарки у черты крупнее, к краям — уходят в глубину; черта и подпись под ней — редкость подарка у черты. */
  function crAt(x) {
    CR.track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
    const c = (CR.mid - x - CR.off0 - CR.tw / 2) / CR.pitch;
    for (let i = Math.max(0, Math.floor(c) - 6); i <= Math.min(CASE_N - 1, Math.ceil(c) + 6); i++) {
      const d = i - c, a = Math.min(Math.abs(d), 4), s = CR.tiles[i].style;
      s.transform = `perspective(700px) rotateY(${Math.max(-50, Math.min(50, -d * 12)).toFixed(1)}deg) scale(${(1.12 - a * 0.09).toFixed(3)})`;
      s.opacity = (1 - a * 0.15).toFixed(2);
    }
    const k = Math.round(c);
    if (!CR.t0 || k === CR.k || k < 0 || k >= CASE_N) return;   // до прокрутки — золотой, как коробка
    CR.k = k;
    CR.ov.style.setProperty('--hc', `var(--r-${CR.items[k].rar.k})`);
    CR.now.textContent = CR.items[k].rar.t;
    const now = performance.now();
    if (now - CR.buzz > 45) { CR.buzz = now; crTick(); }
  }
  function crFrame(now) {
    const C = CR;
    if (!C || C.done) return;
    const t = Math.min(1, (now - C.t0) / CASE_MS);
    crAt(crEase(t) * (C.x1 + C.jit));
    if (t < 1) { C.raf = requestAnimationFrame(crFrame); return; }
    const s0 = now, snap = n => {                                // доезжает до середины выпавшего
      if (CR !== C || C.done) return;
      const u = Math.min(1, (n - s0) / CASE_SNAP_MS);
      crAt(C.x1 + C.jit * (1 - crEaseIO(u)));
      if (u < 1) { C.raf = requestAnimationFrame(snap); return; }
      C.tiles[CASE_WIN].classList.add('win');                   // встал — выпавший вспыхивает, через миг — большой показ
      crTone(880, 0.25, 0.05, 'triangle');
      C.timer = setTimeout(crEnd, CASE_LAND_MS);
    };
    C.raf = requestAnimationFrame(snap);
  }
  async function crEnd() {
    const C = CR;
    if (!C || C.done) return;
    if (!C.got) { C.skip = true; return; }                       // сервер ещё не ответил — покажем сразу, как ответит
    cancelAnimationFrame(C.raf);
    clearTimeout(C.timer);
    C.done = true;
    crAt(C.x1);
    await C.ref;
    if (CR !== C) return;
    const g = GF.catalog.find(x => x.id === C.got.id) || C.got, k = g.rar.k;
    const more = !GF.teacher && GF.coins >= GF.box && GF.bought_today < GF.per_day;
    const sparks = Array.from({ length: CASE_SPARKS[k] || 14 }, () => {
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 190;
      return `<i style="--dx:${Math.round(Math.cos(a) * r)}px;--dy:${Math.round(Math.sin(a) * r)}px;--s:${(0.5 + Math.random()).toFixed(2)};--dl:${(Math.random() * 0.15).toFixed(2)}s"></i>`;
    }).join('');
    C.ov.style.setProperty('--hc', `var(--r-${k})`);
    C.ov.querySelector('.cr-rev').innerHTML = `<i class="cr-rays"></i><span class="cr-sparks">${sparks}</span>${crTile(g, 'hero')}
      <div class="cr-got"><small>${C.who ? `Выпало — и подарено: ${esc(C.who)}` : 'Тебе выпало'}</small><b class="nm">${esc(g.t)}</b>
        <span>${rarHtml(g)}${g.price ? ` <small>в магазине ₿ ${num(g.price)}</small>` : ''}</span></div>`;
    C.ov.classList.add('is-rev');
    if (CASE_RANK.indexOf(k) >= 3) C.ov.classList.add('is-big');
    crChime(k);
    C.ov.querySelector('.cr-acts').innerHTML = `<button type="button" class="cr-btn" data-cr="again"${more ? '' : ' disabled'}>🎲 Ещё раз<small>₿ ${num(GF.box)}</small></button>
      <button type="button" class="cr-btn pri" data-cr="close">${C.who ? 'Готово' : 'Забрать'}</button>`;
    C.ov.querySelector('[data-cr="close"]').focus({ preventScroll: true });
  }
  document.addEventListener('click', e => {
    if (!CR || !e.target.closest('#caseOv')) return;
    const b = e.target.closest('[data-cr]');
    if (!b) { if (e.target.closest('.cr-stage')) crEnd(); return; }
    if (b.disabled) return;
    const a = b.dataset.cr;
    if (a === 'skip') crEnd();
    else if (a === 'close') closeCase();
    else if (a === 'again') rollBox();
    else if (a === 'snd') {
      crMuted = !crMuted;
      try { localStorage.setItem(CASE_MUTE, crMuted ? '1' : '0'); } catch (err) { /* без памяти — только на этот раз */ }
      b.textContent = crMuted ? '🔇' : '🔊';
    }
  });
  window.addEventListener('keydown', e => {                       // раньше Esc окна «Биткоины»: сначала — кейс
    if (!CR || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (CR.done) closeCase(); else crEnd();
  }, true);
