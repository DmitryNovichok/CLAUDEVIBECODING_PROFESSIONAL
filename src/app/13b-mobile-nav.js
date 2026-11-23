  // Подписанная навигация на телефоне. Действия используют существующие обработчики.
  const mobileIcon = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  document.body.insertAdjacentHTML('beforeend', `<nav class="mobile-nav" id="mobileNav" aria-label="Основные разделы" hidden>
    <button type="button" data-mobile="home">${mobileIcon('<path d="M3.5 10.6 12 3.5l8.5 7.1V19a2 2 0 0 1-2 2H15v-6.2H9V21H5.5a2 2 0 0 1-2-2z"/>')}<span>Главная</span></button>
    <button type="button" data-mobile="tasks">${mobileIcon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>')}<span>Задания</span></button>
    <button type="button" data-mobile="teacher">${mobileIcon('<path d="m2 9 10-5 10 5-10 5zM6 11v6c3 2 9 2 12 0v-6M22 9v7"/>')}<span>От учителя</span></button>
    <button type="button" data-mobile="progress">${mobileIcon('<path d="M5 20V12M12 20V4M19 20V8"/>')}<span>Прогресс</span></button>
    <button type="button" data-mobile="more" aria-haspopup="dialog">${mobileIcon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')}<span>Ещё</span></button>
  </nav>`);
  $('.topbar')?.insertAdjacentHTML('afterbegin', '<span class="mobile-brand" aria-label="Egeshka"><b>Ege</b>shka</span>');

  function renderMobileNav() {
    // прогноз в шапке — только у тренажёра номеров; на страницах разделов он лишний (на главной есть свой)
    document.body.classList.toggle('sect-on', !!(courseShown || examShown));
    const nav = $('#mobileNav');
    if (!nav) return;
    nav.hidden = false;
    const teacher = courseShown && pageKind === 'asg';
    $$('[data-mobile]', nav).forEach(b => {
      const active = b.dataset.mobile === 'teacher' ? teacher : b.dataset.mobile === 'home' ? courseShown && pageKind === 'hub'
        : b.dataset.mobile === 'tasks' && !courseShown && !examShown;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('[data-mobile="teacher"]', nav).classList.toggle('has-work', ASG.some(a => !a.duel && !a.course && asgPending(a)));
  }
  function openMobileMore() {
    for (const button of $$('#mobileMore [data-mobile-target]')) {
      const target = $('#' + button.dataset.mobileTarget);
      button.hidden = !target || target.hidden;
    }
    $('#mobileMore').showModal();
  }
  $('#mobileNav').addEventListener('click', e => {
    const b = e.target.closest('[data-mobile]');
    if (!b) return;
    const numbersOpen = $('.sidebar').classList.contains('open');
    setSideOpen(false);
    if (b.dataset.mobile === 'home') openHub();
    if (b.dataset.mobile === 'tasks') {
      if (courseShown && !examShown) { leaveCourse(); next(); renderSidebar(); }
      else setSideOpen(!numbersOpen);
    }
    if (b.dataset.mobile === 'teacher') { asgTab = 'active'; openAsgPage(); }
    if (b.dataset.mobile === 'progress') $('#forecastBtn').click();
    if (b.dataset.mobile === 'more') openMobileMore();
    renderMobileNav();
  });
  const mobileMore = $('#mobileMore');
  mobileMore.addEventListener('click', e => {
    if (!mobileMore.open) return;
    const button = e.target.closest('button');
    if (button || e.target === mobileMore) mobileMore.close();
  }, true);
  mobileMore.addEventListener('click', e => {
    const button = e.target.closest('button');
    if (!button) return;
    // Документ не должен закрыть только что открытое окно или меню звуков.
    e.stopPropagation();
    if (button.hasAttribute('data-mobile-numbers')) openNumbers();
    else if (button.dataset.mobileGroup) openLearningDirectory(button.dataset.mobileGroup);
    else if (button.dataset.mobileTarget) $('#' + button.dataset.mobileTarget)?.click();
  });
