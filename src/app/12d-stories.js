  // ------------------------------------------------------------ истории (как в Instagram/Telegram): сейчас — поздравление с пробником
  // и анонс Хеллоуинского ивента. Один раз (STORIES_VER) — при первом входе (новичку — после знакомства с сайтом), потом — из «Что нового».
  // Слайд листается сам за STORY_MS; касание справа — дальше, слева — назад, удержание — пауза, свайп вниз, ✕ или Esc — закрыть.
  // На компьютере — в рамке iPhone с Dynamic Island (в нём на миг — номер слайда), на телефоне — на весь экран.
  const STORIES_VER = 'halloween-2026', STORY_MS = 7000;
  const HW_START = '2026-10-26';          // с этого дня — Хеллоуинский ивент: две лимитки
  const HW_UNTIL = '2026-11-01';          // до этого дня истории показываются сами
  const HW_END = '2026-11-03';            // до этого дня — хеллоуинская тема сайта
  // тема ивента: ночной (в светлой теме — сумеречный) фон с луной, кладбищем и тыквами, паутина, пролетающие летучие мыши;
  // заранее посмотреть — ?halloween=1 в адресе
  if ((d => d >= HW_START && d < HW_END)(dayKey(Date.now())) || /[?&]halloween=1/.test(location.search)) {
    document.body.classList.add('hw');
    const bats = document.createElement('div');
    bats.className = 'hw-bats';
    bats.setAttribute('aria-hidden', 'true');
    bats.innerHTML = '<img src="vendor/halloween/bat.svg" alt=""><img src="vendor/halloween/bat.svg" alt=""><img src="vendor/halloween/bat.svg" alt="">';
    document.body.appendChild(bats);
  }
  const HW_IMG = 'vendor/halloween/';
  // маски — готовые картинки (с рамкой и тыквой сверху): обычная — клоун, при улучшении — одна из страшных
  const HW_MASK = 'gift_clown.webp';
  const HW_PUMPKIN = 'gift_pumpkin.webp';
  const HW_OUTFITS = ['gift_p_witch.webp', 'gift_p_king.webp', 'gift_p_ghost.webp', 'gift_p_frank.webp'];
  const hwSoon = '<div class="sto-hw-soon">🗓 в продаже с 26 октября</div>';
  const hwRow = ks => `<div class="sto-hw-row">${ks.map((k, i) => `<span style="--i:${i}">${hwImg(k, 'raw')}</span>`).join('')}</div>`;
  const HW_MASKS = ['gift_scream.webp', 'gift_billy.webp', 'gift_skull.webp', 'gift_evilclown.webp'];
  let ST = null;                          // { k, list, paused } — открытые истории
  const storyKey = () => `egeshka.stories.${STORIES_VER}.${student ? student.sid : 'local'}`;
  const hwLeft = () => Math.max(0, Math.round((new Date(HW_START + 'T00:00') - new Date(new Date().toDateString())) / 86400000));
  const hwImg = (k, cls = '') => `<img class="${cls}" src="${HW_IMG}${/\.\w+$/.test(k) ? k : k + '.svg'}" alt="" loading="lazy" draggable="false">`;
  function storySlides() {
    const g = GAME || {}, left = hwLeft(), coins = g.coins || 0;
    const conf = Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 6) * .35}s;--c:${['#ffd54f', '#ff8a65', '#81d4fa', '#a5d6a7', '#ce93d8', '#fff'][i % 6]}"></i>`).join('');
    return [
      { cls: 'h1', ico: '🎓', head: 'Egeshka', title: 'С пробником! 🎉',
        text: 'Поздравляем всех, кто написал пробный ЕГЭ, — вы молодцы! Разбери свои ошибки: так баллы растут быстрее всего.',
        art: `<div class="sto-cong"><div class="conf">${conf}</div><div class="cap">🎓</div>
          <div class="card"><b>Пробный ЕГЭ</b><span>написан ✓</span><small>дальше — работа над ошибками</small></div></div>` },
      { cls: 'h2', ico: '🎃', head: left ? `через ${left} ${plural(left, 'день', 'дня', 'дней')}` : 'уже начался', title: 'Скоро Хеллоуин!',
        text: `С 26 октября — Хеллоуинский ивент: две лимитки, которые продаются только в эти дни.`,
        art: `<div class="sto-hw-duo"><span class="bat b1">🦇</span><span class="bat b2">🦇</span><span class="bat b3">🦇</span>
          ${hwImg(HW_PUMPKIN, 'l raw')}${hwImg(HW_MASK, 'r raw')}<div class="date"><b>26</b><small>октября</small></div></div>` },
      { cls: 'h3', ico: '🎃', head: 'Лимитка 1', title: 'Тыква и 10 нарядов',
        text: 'Тыква — ₿ 5 000. Улучши её за ₿ 1 000 — и она станет особенной: ведьма, золотой король, призрак, Франкенштейн и другие.',
        art: `<div class="sto-hw-one masks">${hwSoon}${hwImg(HW_PUMPKIN, 'main raw')}<div class="arr">✨ улучшение · ₿ 1 000</div>${hwRow(HW_OUTFITS)}</div>` },
      { cls: 'h4', ico: '🎭', head: 'Лимитка 2', title: 'Маска клоуна',
        text: 'Весёлый клоун? Улучши — и маска превратится в страшную: Крик, Пила, Череп, Злой клоун и другие.',
        art: `<div class="sto-hw-one masks">${hwSoon}${hwImg(HW_MASK, 'main raw')}<div class="arr">✨ улучшение — и он станет…</div>${hwRow(HW_MASKS)}</div>` },
      { cls: 'h5', ico: '₿', head: 'Готовься', title: 'Копи биткоины!',
        text: 'Тираж ограничен — кто первый, тот и успел. Решай задания, чтобы к 26-му хватило на тыкву.',
        art: `<div class="sto-hw-save"><div class="coin">₿</div><b>${num(coins)} <small>из 5 000</small></b>
          <div class="prog"><i style="width:${Math.min(100, Math.round(coins / 50))}%"></i></div>
          <small>${coins >= 5000 ? 'на тыкву уже хватает 🎃' : `ещё ₿ ${num(5000 - coins)}`}</small></div>` },
    ];
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
    ov.setAttribute('aria-label', 'Хеллоуин на Egeshka');
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
      ${last ? '<button type="button" class="sto-go" data-st="close">Ждём 26-го! 🎃</button>' : '<div class="sto-tap"><span>‹ назад</span><span>дальше ›</span></div>'}</div>`;
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
  /** Истории — один раз, пока ивент не начался и неделю после старта (в этот день — вместо объявления об акции). */
  function storiesAuto() {
    if (!SERVER || !student || TEACHER || dayKey(Date.now()) >= HW_UNTIL) return false;
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
    if (b) { ({ prev: stPrev, next: stNext, close: closeStories })[b.dataset.st](); return; }
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
