  // ------------------------------------------------------------ истории (как в Instagram/Telegram): что нового на сайте —
  // лаборатория «Исправление ошибок», отладчик, полные уроки курса, инструкция, мелочи. Один раз (STORIES_VER) —
  // при первом входе (новичку — после знакомства с сайтом), потом — из «Что нового».
  // Слайд листается сам за STORY_MS; касание справа — дальше, слева — назад, удержание — пауза, свайп вниз, ✕ или Esc — закрыть.
  // На компьютере — в рамке iPhone с Dynamic Island (в нём на миг — номер слайда), на телефоне — на весь экран.
  const STORIES_VER = 'labs-lessons-2026-11', STORY_MS = 8000;    // новая версия — истории покажутся всем ещё раз
  const STORIES_UNTIL = '2026-11-27';     // до этого дня истории показываются сами
  const HW_START = '2026-10-26', HW_END = '2026-11-03';   // хеллоуинская тема сайта (прошла); посмотреть — ?halloween=1
  if ((d => d >= HW_START && d < HW_END)(dayKey(Date.now())) || /[?&]halloween=1/.test(location.search)) {
    document.body.classList.add('hw');
    const bats = document.createElement('div');
    bats.className = 'hw-bats';
    bats.setAttribute('aria-hidden', 'true');
    bats.innerHTML = '<img src="vendor/halloween/bat.svg" alt=""><img src="vendor/halloween/bat.svg" alt=""><img src="vendor/halloween/bat.svg" alt="">';
    document.body.appendChild(bats);
  }
  let ST = null;                          // { k, list, paused, go } — открытые истории
  const storyKey = () => `egeshka.stories.${STORIES_VER}.${student ? student.sid : 'local'}`;
  function storySlides() {
    const row = (i, b, t, mark) => `<div class="rc-i" style="--i:${i}"><b>${b}</b><span>${t}</span><em>${mark}</em></div>`;
    return [
      { cls: 's4', ico: '🐞', head: 'Новая лаборатория', title: 'Исправление ошибок',
        text: 'Задача и чужое решение на Python — в нём ошибка, пропуск или оно слишком медленное. Почини код так, чтобы он прошёл все тесты. 16 задач трёх уровней, за точную правку — ★.',
        art: `<div class="sto-bug"><div class="bg-code"><i class="ln w2"></i><i class="ln bad"><s>range(1, n)</s></i><i class="ln fix">range(1, n + 1)</i><i class="ln w1"></i><i class="ln w3"></i></div>
          <div class="bg-tests">${[1, 2, 3, 4, 5].map(k => `<span style="--i:${k}">✓</span>`).join('')}<b>тесты 5 из 5</b></div></div>` },
      { cls: 'n2', ico: '🔍', head: 'Лаборатория', title: 'Отладчик как в PyCharm',
        text: 'Программа выполняется по шагам: синяя строка — где сейчас, значения переменных — прямо в коде. Щёлкни по номеру строки — поставишь точку останова. F8 — шаг, F7 — назад, F9 — до точки.',
        art: `<div class="sto-dbg"><div class="db-row"><u>1</u><code>s = 0</code><em>s: 0</em></div>
          <div class="db-row bp"><u>●</u><code>for i in range(4):</code><em>i: 2</em></div>
          <div class="db-row cur"><u>➜</u><code>&nbsp;&nbsp;s += i * i</code><em>s: 5</em></div>
          <div class="db-row"><u>4</u><code>print(s)</code></div>
          <div class="db-keys"><kbd>F7</kbd><kbd>F8</kbd><kbd>F9</kbd></div></div>` },
      { cls: 'n3', ico: '🎓', head: 'Курс ЕГЭ', title: 'Полные уроки: №15 и 24–27',
        text: 'Вместо кратких разборов — уроки по 18–25 слайдов: типы заданий, программы, ловушки, шпаргалка и задачи с ответами. №27 — в формате ЕГЭ-2027, урок про графы из файла — в архиве (23_old). Файлы к задачам сразу открываются в Python.',
        art: `<div class="sto-les"><div class="ls-nums">${[15, 24, 25, 26, 27].map((n, i) => `<b style="--i:${i}">№${n}</b>`).join('')}</div>
          <div class="ls-tag">18–25 слайдов в каждом уроке</div></div>` },
      { cls: 's3', ico: '🧭', head: 'Помощь', title: 'Инструкция и подсказки',
        text: 'Внизу главной — «Инструкция»: как устроен сайт, по шагам. А «Как работает Egeshka» подсветит разделы прямо на странице и объяснит каждый.',
        art: `<div class="sto-rec"><div class="rc-h">🧭 Внизу главной</div>
          ${row(0, 'Инструкция', 'вход, задания, курсы, вопросы', '📖')}${row(1, 'Как работает Egeshka', 'подсказки на главной', '💡')}${row(2, 'Техподдержка', 'ответ придёт туда же', '💬')}</div>` },
      { cls: 's5', ico: '✨', head: 'Ещё', title: 'Что ещё изменилось',
        text: 'Окно Python: границу между кодом и выводом можно тянуть. Забыл пароль — «Забыли пароль?» пришлёт ссылку на почту. А биткоины теперь называются монетами — значок ₿ и счёт те же.',
        art: `<div class="sto-rec"><div class="rc-h">✨ Что ещё изменилось</div>
          ${row(0, 'Окно Python', 'тяни границу кода и вывода', '↕')}${row(1, 'Пароль по почте', 'если указал почту', '🔑')}${row(2, 'Монеты', 'новое имя биткоинов', '₿')}</div>`,
        go: ['🧪 В лабораторию', 'lab'] }];
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
    stFitArt(ov);
    ov.querySelector('[data-st="prev"]').disabled = ST.k === 0;
    const isl = ov.querySelector('.sto-island');               // Dynamic Island на миг раскрывается: значок и номер слайда
    ov.querySelector('.sto-isl').textContent = `${s.ico} ${ST.k + 1} из ${n}`;
    isl.classList.add('wide');
    clearTimeout(ST.islT);
    ST.islT = setTimeout(() => isl.classList.remove('wide'), 1500);
    const c = $('#stClock');
    if (c) c.textContent = stClock();
  }
  /** Картинка слайда — целиком внутри экрана: на невысоком мониторе телефон узкий, картинку уменьшаем по месту. */
  function stFitArt(ov) {
    const box = ov.querySelector('.sto-art'), art = ov.querySelector('.sto-art-in');
    if (!box || !art) return;
    art.style.scale = '';                    // свойство scale не спорит с анимацией появления (она на transform)
    const w = art.scrollWidth, h = art.scrollHeight, k = Math.min(1, (box.clientWidth - 4) / w, (box.clientHeight - 4) / h);
    if (k < 1) art.style.scale = Math.max(0.5, k).toFixed(3);
  }
  window.addEventListener('resize', () => { const ov = $('#storiesOv'); if (ov) stFitArt(ov); });
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
    if (b) { ({ prev: stPrev, next: stNext, close: closeStories, shop: () => { closeStories(); openGifts(undefined, undefined, 'shop'); }, duel: () => { closeStories(); tourOpen(); }, lab: () => { closeStories(); openLearningDirectory('labs'); } })[b.dataset.st](); return; }
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
  // ------------------------------------------------------------ новость на «iPad»: монеты за помощь сайту.
  // Одна страница: за что и сколько ₿, как отправить. Закрыть можно не раньше чем через PAD_LOCK_S секунд (кнопка с обратным отсчётом;
  // Esc и щелчок мимо до этого не закрывают). Один раз до PAD_UNTIL; потом — из техподдержки («за что дают монеты»).
  const PAD_VER = 'rewards-2026-11', PAD_UNTIL = '2026-12-20', PAD_LOCK_S = 5;
  let PAD = null;                         // { left, timer } — открыта страница
  const padKey = () => `egeshka.pad.${PAD_VER}.${student ? student.sid : 'local'}`;
  function openRewardsPad() {
    closeRewardsPad(true);
    const rw = RULES.support_rewards || [];
    const cards = rw.map(([k, ic, t, a], i) => `<div class="pad-rw${k === 'critical' ? ' big' : k === 'done' ? ' bonus' : ''}" style="--i:${i}"><em aria-hidden="true">${ic}</em><span>${esc(t)}</span><b>+${a} ₿</b></div>`).join('');
    const ov = document.createElement('div');
    ov.className = 'pad-ov';
    ov.id = 'padOv';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', 'padTitle');
    ov.innerHTML = `<div class="pad"><div class="pad-screen">
        <div class="pad-status"><span>${stClock()}</span><span class="pad-cam" aria-hidden="true"></span><span class="pad-ind" aria-hidden="true">Wi-Fi <i class="pad-bat"><i></i></i> 100%</span></div>
        <div class="pad-body">
          <div class="pad-head"><span class="pad-ico" aria-hidden="true">🎁</span><div><small>Новое на Egeshka</small>
            <h2 id="padTitle">Монеты за помощь сайту</h2>
            <p>Предложи идею, сообщи об ошибке или расскажи, как сделать сайт удобнее.</p></div></div>
          <div class="pad-grid">${cards}</div>
          <div class="pad-how"><h3>Как получить</h3><ol>
            <li><b>Открой «🛟 Техподдержку»</b> — внизу главной.</li>
            <li><b>Ошибку или неудобство</b> — во вкладке «Обращения», выбери тип. <b>Идею</b> — во вкладке «💡 Пожелания».</li>
            <li><b>Опиши подробно:</b> где это, что делал, что ожидал. Скриншот — 📎 или Ctrl+V.</li>
            <li><b>Главный учитель проверит</b> и начислит монеты прямо в обращении — придёт уведомление.</li></ol>
            <p class="pad-rules">Награду получает тот, кто первым сообщил о находке. За реализованную идею начисляется отдельный бонус. Главный учитель определяет сумму и отклоняет повторы и спам.</p></div>
        </div>
        <div class="pad-foot"><button type="button" class="btn" data-pad="write" disabled>✍️ Написать в техподдержку</button>
          <button type="button" class="btn primary" data-pad="close" disabled>Понятно <span class="pad-cd">${PAD_LOCK_S}</span></button></div>
      </div></div>`;
    document.body.appendChild(ov);
    document.body.classList.add('pad-open');
    PAD = { left: PAD_LOCK_S };
    PAD.timer = setInterval(() => {
      if (!PAD) return;
      PAD.left -= 1;
      const cd = ov.querySelector('.pad-cd');
      if (PAD.left > 0) { if (cd) cd.textContent = PAD.left; return; }
      clearInterval(PAD.timer);
      ov.classList.add('open');
      ov.querySelectorAll('[data-pad]').forEach(b => { b.disabled = false; });
      if (cd) cd.remove();
      ov.querySelector('[data-pad="close"]').focus({ preventScroll: true });
    }, 1000);
  }
  /** force — закрыть сразу (например, при выходе); иначе — только когда прошли PAD_LOCK_S секунд. */
  function closeRewardsPad(force) {
    if (!PAD) return;
    if (!force && PAD.left > 0) return;
    clearInterval(PAD.timer);
    $('#padOv')?.remove();
    document.body.classList.remove('pad-open');
    PAD = null;
  }
  /** Один раз после обновления — раньше историй и объявлений. */
  function padAuto() {
    if (!SERVER || !student || TEACHER || dayKey(Date.now()) >= PAD_UNTIL || !(RULES.support_rewards || []).length) return false;
    try {
      if (localStorage.getItem(padKey())) return false;
      localStorage.setItem(padKey(), '1');
    } catch (e) { return false; }
    openRewardsPad();
    return true;
  }
  document.addEventListener('click', e => {
    if (e.target.closest('[data-pad-open]')) { openRewardsPad(); return; }
    if (!PAD) return;
    const b = e.target.closest('#padOv [data-pad]');
    if (b && !b.disabled) {
      closeRewardsPad();
      if (b.dataset.pad === 'write') openSupport('help');
      return;
    }
    if (e.target.id === 'padOv') closeRewardsPad();          // щелчок мимо iPad — только после отсчёта
  });
  document.addEventListener('keydown', e => {
    if (!PAD) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRewardsPad(); }
    if (e.key === 'Tab') {                                    // фокус не уходит со страницы
      const f = [...document.querySelectorAll('#padOv button:not([disabled])')];
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    }
  }, true);
