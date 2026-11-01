  // ------------------------------------------------------------ совместный сеанс: приглашение от учителя
  /* Учитель позвал в общий сеанс (код и доска, together.html) — карточка «Учитель зовёт в общий сеанс» всплывает сразу
     (живое обновление together) и при входе на сайт, пока учитель не завершил сеанс. «Позже» — карточка сворачивается
     в кнопку 👥 внизу экрана. */
  const TOGI = { list: [], later: new Set(), rung: new Set() };
  async function togCheck(fresh) {
    if (!SERVER || !student || TEACHER) return;
    let d;
    try { d = await api('together/mine'); } catch (e) { return; }
    TOGI.list = d.sessions || [];
    togRender(fresh);
  }
  function togRing() {
    try {                                              // короткий «дзынь» — только если звук на странице уже разрешён
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !navigator.userActivation || !navigator.userActivation.hasBeenActive) return;
      const ac = new AC(), t = ac.currentTime;
      [880, 1320].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.5);
        o.connect(g).connect(ac.destination);
        o.start(t + i * 0.16);
        o.stop(t + i * 0.16 + 0.55);
      });
      setTimeout(() => ac.close(), 1200);
    } catch (e) { /* без звука */ }
  }
  function togRender(fresh) {
    let box = $('#togInv');
    const s = TOGI.list[0];
    if (!s) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'togInv';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Приглашение в совместный сеанс');
      document.body.appendChild(box);
    }
    const mini = TOGI.later.has(s.id);
    const what = { both: 'Код + доска', code: 'Общий код', board: 'Общая доска' }[s.mode] || 'Код + доска';
    box.className = 'tog-inv' + (mini ? ' mini' : '');
    box.innerHTML = mini
      ? `<button type="button" class="tog-pill" data-tog-join="${s.id}" title="Учитель ждёт в общем сеансе">👥 Сеанс с учителем</button>`
      : `<div class="tog-inv-h"><span class="tog-inv-ic"><span class="tog-bell">🔔</span></span>${esc(s.teacher || 'Учитель')} зовёт в общий сеанс</div>
         <div class="tog-inv-t">${esc(what)}${s.task ? ' · задание ' + esc(s.task) : ''}. Можно вместе писать код и рисовать — всё видно сразу у обоих.</div>
         <div class="tog-inv-a"><button type="button" class="btn" data-tog-later="${s.id}">Позже</button>
           <button type="button" class="btn primary" data-tog-join="${s.id}">Присоединиться</button></div>`;
    if (fresh && !mini && !TOGI.rung.has(s.id)) { TOGI.rung.add(s.id); togRing(); }
  }
  document.addEventListener('click', e => {
    const j = e.target.closest && e.target.closest('[data-tog-join]');
    if (j) {
      const url = 'together.html?id=' + j.dataset.togJoin;
      TOGI.later.add(+j.dataset.togJoin);
      togRender(false);
      if (!window.open(url, '_blank')) location.href = url;
      return;
    }
    const l = e.target.closest && e.target.closest('[data-tog-later]');
    if (l) { TOGI.later.add(+l.dataset.togLater); togRender(false); }
  });
