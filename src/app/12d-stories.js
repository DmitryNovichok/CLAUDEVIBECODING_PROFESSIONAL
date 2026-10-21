  // ------------------------------------------------------------ истории «Что нового» (как в Instagram/Telegram)
  // Один раз после обновления (STORIES_VER) — при первом входе (новичку — после знакомства с сайтом), потом — из «Что нового».
  // Слайд листается сам за STORY_MS; касание справа — дальше, слева — назад, удержание — пауза, свайп вниз, ✕ или Esc — закрыть.
  // На компьютере — в рамке iPhone с Dynamic Island (в нём на миг — номер слайда), на телефоне — на весь экран.
  // Последний слайд — акция, пока она идёт (PROMO); имена в рейтинге на картинке — для примера, кроме «это ты».
  const STORIES_VER = '2.7.1', STORY_MS = 6000;
  let ST = null;                          // { k, list, paused } — открытые истории
  const storyKey = () => `egeshka.stories.${STORIES_VER}.${student ? student.sid : 'local'}`;
  const meShort = () => {
    const p = String((student && student.name) || '').trim().split(/\s+/).filter(Boolean);
    return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0] || 'Ты';
  };
  function storySlides() {
    const g = GAME || {}, P = PROMO;
    const list = [
      { cls: 's1', ico: '✨', head: 'Egeshka · что нового', title: 'Egeshka обновился!',
        text: 'Новый вид, биткоины за труд, подарки, рынок и Forbes класса. Листай — это 30 секунд.',
        art: `<div class="sto-mini"><div class="hd"><span class="pl">★ Ур. ${g.level || 1}</span>${P ? `<span class="pl p">⚡ ${xTxt(Math.max(P.task, P.exam))}</span>` : ''}
          <span class="pl">₿ ${num(g.coins || 0)}</span></div>
          <div class="bd"><div class="rl"><i>▦</i><i>🎓</i><i>⭐</i><i>📝</i><i>⚔️</i></div><div class="tk"><b>Задание №8</b><div class="ln"></div>
          <div class="ln" style="width:80%"></div><div class="ln" style="width:60%"></div><div class="ok"><span>Проверить</span><em>+3 ₿</em></div></div></div></div>` },
      { cls: 's2', ico: '₿', head: 'Биткоины', title: 'Биткоины — только трудом',
        text: 'Решаешь задания и варианты — получаешь ₿. Купить или «нафармить» их нельзя.',
        art: `<div class="sto-earn"><div class="c"><span>🧩</span><div><b>Решил задание</b><small>чем сложнее — тем больше</small></div><em class="pop">+3 ₿</em></div>
          <div class="c"><span>📝</span><div><b>Написал вариант ЕГЭ</b><small>бонус по тестовому баллу</small></div><em class="pop">+30 ₿</em></div>
          <div class="c bad"><span>⏱</span><div><b>Решил за 10 секунд</b><small>похоже на списанный ответ</small></div><em class="pop">−1 ₿</em></div></div>` },
      { cls: 's3', ico: '🎁', head: 'Подарки', title: 'Магазин подарков',
        text: '70 подарков — себе или однокласснику. В 🎲 может выпасть даже Замок.',
        art: `<div><div class="sto-shop"><div class="t"><span>🍪</span>₿ 11</div><div class="t r2"><span>🐸</span>₿ 39</div><div class="t r3"><span>🐱</span>₿ 55</div>
          <div class="t box"><span>🎲</span>₿ 60<small>Случайный</small></div><div class="t r5"><span>🚀</span>₿ 275</div><div class="t r5"><span>🏰</span>₿ 1100</div></div>
          <div class="sto-to"><span>🎁 Подарить: Ким Д.</span></div></div>` },
      { cls: 's4', ico: '💎', head: 'Уникальные', title: 'Улучшай и собирай редкие',
        text: 'От 100 ₿ подарок станет единственным в своём роде — с номером и своим видом.',
        art: `<div class="sto-up"><div class="fl"><div class="pn">🦊</div><span class="ar">→</span>
          <div class="uq"><div class="pt">${'<i>✦</i>'.repeat(8)}</div><span class="ic">🦊</span><b class="n">#7</b></div></div>
          <div class="lb"><span class="sto-rar">Мифический</span>1 из 4 120</div>
          <div class="pr"><span>фон · Закат</span><span>узор · Звёзды</span><span>эффект · Сияние</span><span>поза · Великан</span></div></div>` },
      { cls: 's5', ico: '🏆', head: 'Рынок и Forbes', title: 'Рынок и Forbes класса',
        text: 'Продавай подарки одноклассникам и поднимайся в Forbes — самые богатые и самые редкие.',
        art: `<div><div class="sto-fb"><div class="h">FORBES <i>Egeshka</i></div><div class="hs">самые богатые в классе</div>
          <div class="r"><span class="n">👑</span><span class="av" style="--c1:#ffe08a;--c2:#ff9a5a">🦄</span><span class="nm">Соколова А.<small>6 подарков</small></span><span class="v">₿ 1 240<em>▲</em></span></div>
          <div class="r"><span class="n">2</span><span class="av" style="--c1:#cfe9ff;--c2:#4f9dff">🐉</span><span class="nm">Ким Д.<small>🚀 рывок недели</small></span><span class="v">₿ 980<em>▲</em></span></div>
          <div class="r me"><span class="n">…</span><span class="av" style="--c1:#c9f7e4;--c2:#4cc9a0">🐸</span><span class="nm">${esc(meShort())}<small>это ты</small></span><span class="v">₿ ${num(g.coins || 0)}</span></div></div>
          <div class="sto-lot"><span class="uq"><span class="ic">🚀</span></span><div>Ракета #3<small>продаёт Лебедева В.</small></div><span class="p">₿ 450</span></div></div>` },
    ];
    if (P) {
      list.push({ cls: 's6', ico: '⚡', head: `До ${promoDay(P)}`, title: esc(P.title),
        text: 'Решай задания и пиши варианты — биткоинов больше.',
        art: `<div class="sto-bonus"><div class="bolt">⚡</div>
          ${P.task > 1 ? `<div class="t"><span>🧩</span><div><b>${xTxt(P.task)}</b><small>₿ за задания</small></div></div>` : ''}
          ${P.exam > 1 ? `<div class="t hot"><span>📝</span><div><b>${xTxt(P.exam)}</b><small>₿ за вариант ЕГЭ</small></div></div>` : ''}</div>` });
    }
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
      ${last ? '<button type="button" class="sto-go" data-st="close">Поехали!</button>' : '<div class="sto-tap"><span>‹ назад</span><span>дальше ›</span></div>'}</div>`;
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
  /** Истории после обновления — один раз (и вместо объявления об акции в этот день: она — последний слайд). */
  function storiesAuto() {
    if (!SERVER || !student || TEACHER) return false;
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
  document.addEventListener('animationend', e => {          // полоска заполнилась — следующий слайд (последний ждёт «Поехали!»)
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
