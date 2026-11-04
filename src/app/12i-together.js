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

  // ---------- записи занятий «Вместе»: слева кнопка 👥 — список уроков с учителем; у каждого задания сохранены код, доска и вывод
  async function togHistory(open) {
    if (!SERVER || !student || TEACHER) return;
    let d;
    try { d = await api('together/history'); } catch (e) { return; }
    TOGI.hist = d.sessions || [];
    const card = $('#togCard');
    if (card) {
      card.hidden = !TOGI.hist.length;
      const live = TOGI.hist.filter(x => !x.ended).length;
      $('#togSub').textContent = live ? 'идёт занятие — присоединиться' : `записей: ${TOGI.hist.length}`;
      card.classList.toggle('alert', !!live);
    }
    if (open) togHistoryOpen();
  }
  function togHistoryOpen() {
    const fmt = ts => { const d = new Date(ts * 1000); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} в ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const rows = (TOGI.hist || []).map(x => `<div class="tgh-row${x.ended ? '' : ' live'}">
        <div class="tgh-main"><b>${fmt(x.created)}</b> <small>${esc(x.teacher || 'Учитель')}${x.ended ? '' : ' · <span class="tgh-live">● идёт сейчас</span>'}</small>
          <div class="tgh-tasks">${(x.labels || []).map((l, i) => `<span class="chip">${i + 1}. ${esc(l)}</span>`).join('')}</div></div>
        <button type="button" class="btn ${x.ended ? 'ghost' : 'primary'}" data-tog-join="${x.id}">${x.ended ? '📼 Смотреть' : 'Присоединиться'}</button></div>`).join('');
    $('#forecastBody').innerHTML = `<h2 class="fm-title">👥 Занятия вместе с учителем</h2>
      <p class="fm-note">Всё, что решали вместе, сохраняется: у каждого задания — код, доска, пометки на условии и вывод программы. Открой запись и посмотри на досуге.</p>
      ${rows ? `<div class="tgh-list">${rows}</div>` : '<p class="fm-muted">Пока не было ни одного занятия.</p>'}`;
    $('#forecastModal').hidden = false;
  }
  $('#togCard')?.addEventListener('click', () => togHistory(true));
