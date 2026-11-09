  // Подписанная навигация на телефоне. Действия используют существующие обработчики.
  const mobileIcon = body => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  document.body.insertAdjacentHTML('beforeend', `<nav class="mobile-nav" id="mobileNav" aria-label="Основные разделы" hidden>
    <button type="button" data-mobile="tasks">${mobileIcon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>')}<span>Задания</span></button>
    <button type="button" data-mobile="teacher">${mobileIcon('<path d="m2 9 10-5 10 5-10 5zM6 11v6c3 2 9 2 12 0v-6M22 9v7"/>')}<span>От учителя</span></button>
    <button type="button" data-mobile="progress">${mobileIcon('<path d="M5 20V12M12 20V4M19 20V8"/>')}<span>Прогресс</span></button>
    <button type="button" data-mobile="more" aria-haspopup="dialog">${mobileIcon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>')}<span>Ещё</span></button>
  </nav><dialog class="mobile-more" id="mobileMore" aria-labelledby="mobileMoreTitle"><div class="mobile-more-head"><h2 id="mobileMoreTitle">Разделы Egeshka</h2><button type="button" class="icon-btn" data-mobile-close aria-label="Закрыть меню">×</button></div><div id="mobileMoreLinks"></div></dialog>`);
  $('.topbar')?.insertAdjacentHTML('afterbegin', '<span class="mobile-brand" aria-label="Egeshka"><b>Ege</b>shka</span>');

  function renderMobileNav() {
    const nav = $('#mobileNav');
    if (!nav) return;
    nav.hidden = false;
    const teacher = courseShown && pageKind === 'asg';
    $$('[data-mobile]', nav).forEach(b => {
      const active = b.dataset.mobile === 'teacher' ? teacher : b.dataset.mobile === 'tasks' && !courseShown && !examShown;
      b.classList.toggle('on', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('[data-mobile="teacher"]', nav).classList.toggle('has-work', ASG.some(a => !a.duel && !a.course && !asgFinished(a) && asgLeft(a).length));
  }
  function openMobileMore() {
    const items = [
      ['labCard', 'Лаборатория'], ['numbers', 'Номера заданий'], ['examCard', 'Вариант ЕГЭ'], ['courseCard', 'Курс'], ['pycCard', 'Курс Python'],
      ['favCard', 'Избранное'], ['histCard', 'История заданий'], ['dailyCard', 'Задание дня'], ['duelCard', 'Дуэли'],
      ['togCard', 'Занятия вместе'], ['coinCard', 'Биткоины и подарки'], ['supportBtn', 'Техподдержка'],
      ['themeBtn', 'Светлая / тёмная тема'], ['sndBtn', 'Звуки для занятий'], ['tourBtn', 'Как работает Egeshka']
    ];
    $('#mobileMoreLinks').innerHTML = items.filter(([id]) => id === 'numbers' || ($('#' + id) && !$('#' + id).hidden)).map(([id, label]) =>
      `<button type="button" data-mobile-target="${id}">${esc(label)}<span aria-hidden="true">→</span></button>`).join('');
    $('#mobileMore').showModal();
  }
  $('#mobileNav').addEventListener('click', e => {
    const b = e.target.closest('[data-mobile]');
    if (!b) return;
    setSideOpen(false);
    if (b.dataset.mobile === 'tasks') $('#allCard').click();
    if (b.dataset.mobile === 'teacher') { asgTab = 'active'; openAsgPage(); }
    if (b.dataset.mobile === 'progress') $('#forecastBtn').click();
    if (b.dataset.mobile === 'more') openMobileMore();
    renderMobileNav();
  });
  $('#mobileMore').addEventListener('click', e => {
    const dialog = $('#mobileMore'), b = e.target.closest('[data-mobile-target]');
    if (e.target === dialog || e.target.closest('[data-mobile-close]') || b) dialog.close();
    if (!b) return;
    e.stopPropagation(); // исходный щелчок меню не закрывает только что открытый раздел или звуки
    if (b.dataset.mobileTarget === 'numbers') { setSideOpen(true); window.scrollTo(0, 0); $('#period').focus(); }
    else $('#' + b.dataset.mobileTarget)?.click();
  });
