  // ------------------------------------------------------------ истории (как в Instagram/Telegram): что нового на сайте —
  // световые мечи (лимитки до 9 ноября), занятия «Вместе» и их записи, дуэли вместо турниров. Один раз (STORIES_VER) —
  // при первом входе (новичку — после знакомства с сайтом), потом — из «Что нового».
  // Слайд листается сам за STORY_MS; касание справа — дальше, слева — назад, удержание — пауза, свайп вниз, ✕ или Esc — закрыть.
  // На компьютере — в рамке iPhone с Dynamic Island (в нём на миг — номер слайда), на телефоне — на весь экран.
  const STORIES_VER = 'sabers-together-2026-11', STORY_MS = 7000;    // новая версия — истории покажутся всем ещё раз
  const STORIES_UNTIL = '2026-11-17';     // до этого дня истории показываются сами
  const HW_START = '2026-10-26', HW_END = '2026-11-03';   // хеллоуинская тема сайта (прошла); посмотреть — ?halloween=1
  if ((d => d >= HW_START && d < HW_END)(dayKey(Date.now())) || /[?&]halloween=1/.test(location.search)) {
    document.body.classList.add('hw');
    const bats = document.createElement('div');
    bats.className = 'hw-bats';
    bats.setAttribute('aria-hidden', 'true');
    bats.innerHTML = '<img src="vendor/halloween/bat.svg" alt=""><img src="vendor/halloween/bat.svg" alt=""><img src="vendor/halloween/bat.svg" alt="">';
    document.body.appendChild(bats);
  }
  const SW_END = '2026-11-10', SW_N = 5, SW_PRICE = 10000;  // световые мечи: SW_END / cap / price в server.py
  let ST = null;                          // { k, list, paused, go } — открытые истории
  const storyKey = () => `egeshka.stories.${STORIES_VER}.${student ? student.sid : 'local'}`;
  function storySlides() {
    const g = GAME || {}, coins = g.coins || 0, swOn = dayKey(Date.now()) < SW_END;
    const saber = c => `<img class="sw-s sw-${c}" src="vendor/sabers/saber_${c}.svg" alt="" draggable="false">`;
    const list = [];
    if (swOn) list.push({ cls: 'n1', ico: '⚔️', head: 'Лимитки', title: 'Световые мечи',
      text: `В «Биткоинах» — синий и красный световые мечи: ₿ ${num(SW_PRICE)}, всего по ${SW_N} штук на весь сайт и только до 9 ноября включительно. Кто первый, тот и успел!`,
      art: `<div class="sto-sw"><div class="sw-pair">${saber('blue')}${saber('red')}</div>
        <div class="sw-tag">по ${SW_N} штук · до 9 ноября</div>
        <div class="sw-have">у тебя ₿ ${num(coins)}${coins >= SW_PRICE ? ' — хватает ✓' : ` · ещё ₿ ${num(SW_PRICE - coins)}`}</div></div>` });
    list.push(
      { cls: 'n2', ico: '👥', head: 'Новое', title: 'Занятия «Вместе»',
        text: 'Решай с учителем в одном редакторе: общий код и запуск программы, доска для рисунков и пометки прямо на условии задачи. Ответы, которые ты сдаёшь сам, засчитываются — с опытом и биткоинами.',
        art: `<div class="sto-tg"><div class="tg-w"><div class="tg-l"><i class="ln w1"></i><i class="ln w2"></i><i class="ln w3"></i><i class="ln w2"></i>
          <span class="cur t">Учитель</span><span class="cur s">Ты</span></div>
          <div class="tg-r"><svg viewBox="0 0 100 80" aria-hidden="true"><path d="M10 60 C 30 10, 55 10, 70 45 S 90 70, 92 30" /></svg></div></div>
          <div class="tg-ok">✓ решено с учителем · +XP · +₿</div></div>` },
      { cls: 'n3', ico: '📼', head: 'Записи', title: 'Занятие не пропадёт',
        text: 'После занятия всё сохраняется: код и рисунки по каждой задаче. Открой «Занятия вместе» 👥 в меню слева — и повтори всё, что разбирали.',
        art: `<div class="sto-rec"><div class="rc-h">👥 Занятия вместе</div>
          ${[['сегодня', '№ 9 · № 17 · № 24'], ['вчера', '№ 8 · № 25'], ['2 ноября', '№ 6 · № 15 · № 27']].map(([d, t], i) =>
            `<div class="rc-i" style="--i:${i}"><b>${d}</b><span>${t}</span><em>▶</em></div>`).join('')}</div>` },
      { cls: 'n4', ico: '🤺', head: 'Вместо турниров', title: 'Дуэли',
        text: 'Турниров больше нет — теперь дуэли один на один, и награды выше: за победу +300 XP и +50 ₿, за участие +50 XP и +1 ₿.',
        art: `<div class="sto-duel"><div class="dl-vs"><span>🧑‍🎓</span><b>VS</b><span>🧑‍💻</span></div>
          <div class="dl-pr"><div><small>победа</small><b>+300 XP</b><b>+50 ₿</b></div><div><small>участие</small><b>+50 XP</b><b>+1 ₿</b></div></div></div>`,
        go: ['⚔️ К дуэлям', 'duel'] });
    return list;
  }
  const stClock = () => { const d = new Date(); return `${d.getHours()}:${pad2(d.getMinutes())}`; };
  function openStories() {
    closeStories();
    ST = { k: 0, list: storySlides(), paused: false };
    const ov = document.createElement('div');
    ov.className = 'sto-ov';
    ov.id = 'storiesOv';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Что нового на Egeshka');
    ov.innerHTML = `<button type="button" class="sto-nav" data-st="prev" aria-label="Назад">‹</button>
      <div class="sto-phone"><div class="sto-bezel"><div class="sto-screen">
        <div class="sto-status"><span id="stClock">${stClock()}</span><span class="sto-ind" aria-hidden="true">
          <svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
          <svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 2.5c2.3 0 4.4.9 6 2.4l1.2-1.3A10.5 10.5 0 0 0 8 .7 10.5 10.5 0 0 0 .8 3.6L2 4.9a8.7 8.7 0 0 1 6-2.4Zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.8 6.8 0 0 0 8 4.3a6.8 6.8 0 0 0-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Zm0 3.5a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z"/></svg>
          <span class="sto-bat"><i></i></span></span></div>
        <div class="sto-island" aria-hidden="true"><span class="sto-isl"></span><i></i></div>
        <div class="sto-body"></div></div></div></div>
      <button type="button" class="sto-nav" data-st="next" aria-label="Дальше">›</button>`;
    document.body.appendChild(ov);
    document.body.classList.add('sto-open');
    stShow(0);
    setTimeout(() => { const x = ov.querySelector('.sto-x'); if (x) x.focus({ preventScroll: true }); }, 50);
  }
  function closeStories() {
    const ov = $('#storiesOv');
    if (ov) ov.remove();
    document.body.classList.remove('sto-open');
    ST = null;
  }
  function stShow(k) {
    const ov = $('#storiesOv');
    if (!ST || !ov) return;
    ST.k = Math.max(0, Math.min(ST.list.length - 1, k));
    const s = ST.list[ST.k], n = ST.list.length, last = ST.k === n - 1;
    ov.querySelector('.sto-body').innerHTML = `<div class="sto-scr ${s.cls}" style="--d:${STORY_MS}ms">
      <div class="sto-bars">${ST.list.map((_, j) => `<i class="${j < ST.k ? 'done' : ''}">${j === ST.k ? '<b></b>' : ''}</i>`).join('')}</div>
      <div class="sto-top"><b><em>${s.ico}</em>${esc(s.head)}</b><button type="button" class="sto-x" data-st="close" aria-label="Закрыть">✕</button></div>
      <div class="sto-art"><div class="sto-art-in">${s.art}</div></div>
      <h2 class="sto-ttl">${s.title}</h2><p class="sto-txt">${s.text}</p>
      ${last && s.go ? `<button type="button" class="sto-go" data-st="${s.go[1]}">${s.go[0]}</button>` : '<div class="sto-tap"><span>‹ назад</span><span>дальше ›</span></div>'}</div>`;
    ov.classList.toggle('paused', ST.paused);
    ov.querySelector('[data-st="prev"]').disabled = ST.k === 0;
    const isl = ov.querySelector('.sto-island');               // Dynamic Island на миг раскрывается: значок и номер слайда
    ov.querySelector('.sto-isl').textContent = `${s.ico} ${ST.k + 1} из ${n}`;
    isl.classList.add('wide');
    clearTimeout(ST.islT);
    ST.islT = setTimeout(() => isl.classList.remove('wide'), 1500);
    const c = $('#stClock');
    if (c) c.textContent = stClock();
  }
  function stNext() { if (!ST) return; if (ST.k < ST.list.length - 1) stShow(ST.k + 1); else closeStories(); }
  function stPrev() { if (ST) stShow(ST.k - 1); }
  function stPause(on) {
    if (!ST) return;
    ST.paused = on;
    const ov = $('#storiesOv');
    if (ov) ov.classList.toggle('paused', on);
  }
  /** Истории — один раз, до STORIES_UNTIL (в этот день — вместо объявления об акции). */
  function storiesAuto() {
    if (!SERVER || !student || TEACHER || dayKey(Date.now()) >= STORIES_UNTIL) return false;
    try {
      if (localStorage.getItem(storyKey())) return false;
      localStorage.setItem(storyKey(), '1');
    } catch (e) { return false; }
    openStories();
    promoMarkSeen();
    return true;
  }
  // касание: коротко — слева назад, справа дальше; удержание — пауза; свайп вниз — закрыть
  let stDown = null;
  document.addEventListener('pointerdown', e => {
    if (!ST || !e.target.closest('#storiesOv .sto-scr') || e.target.closest('button')) return;
    stDown = { x: e.clientX, y: e.clientY, t: Date.now(), hold: setTimeout(() => { stPause(true); stDown.held = true; }, 220) };
  });
  document.addEventListener('pointerup', e => {
    if (!stDown) return;
    const d = stDown;
    stDown = null;
    clearTimeout(d.hold);
    if (d.held) { stPause(false); return; }
    if (e.clientY - d.y > 90 && Math.abs(e.clientX - d.x) < 80) { closeStories(); return; }
    const scr = $('#storiesOv .sto-scr');
    if (!scr || Math.abs(e.clientX - d.x) > 30) return;
    const r = scr.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.3) stPrev(); else stNext();
  });
  document.addEventListener('pointercancel', () => { if (stDown) { clearTimeout(stDown.hold); if (stDown.held) stPause(false); stDown = null; } });
  document.addEventListener('click', e => {
    const b = e.target.closest('#storiesOv [data-st]');
    if (b) { ({ prev: stPrev, next: stNext, close: closeStories, shop: () => { closeStories(); openGifts(undefined, undefined, 'shop'); }, duel: () => { closeStories(); tourOpen(); } })[b.dataset.st](); return; }
    if (ST && e.target.id === 'storiesOv') closeStories();          // клик мимо телефона
    if (e.target.closest('#storiesGo')) { closeForecast(); openStories(); }
  });
  document.addEventListener('animationend', e => {          // полоска заполнилась — следующий слайд (последний ждёт кнопку)
    if (ST && e.target.matches && e.target.matches('#storiesOv .sto-bars b') && ST.k < ST.list.length - 1) stShow(ST.k + 1);
  });
  document.addEventListener('keydown', e => {
    if (!ST) return;
    const act = { ArrowRight: stNext, ArrowLeft: stPrev, Escape: closeStories, ' ': () => stPause(!ST.paused) }[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  }, true);
  document.addEventListener('visibilitychange', () => { if (ST && document.visibilityState === 'hidden') stPause(true); });
