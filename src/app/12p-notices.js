  // ------------------------------------------------------------ 🔔 уведомления ученика
  // Всё, что раньше только всплывало (подарки, монеты, ответы техподдержки, новые подборки), хранится здесь:
  // кнопка-колокольчик со счётчиком новых, окно со списком — любое можно открыть в любой момент.
  // Напоминания о сроках подборок считаются здесь же, по «Подборкам» ученика.
  let NOTICES = null, noticeTab = 'all', noticeTimer = 0;
  const NOTICE_TABS = [['all', 'Все'], ['remind', '⏰ Напоминания'], ['asg', '📚 Подборки'], ['gift', '🎁 Подарки'], ['coins', '₿ Монеты'], ['support', '💬 Поддержка']];
  const remindKey = () => `egeshka.remind.${student ? student.sid : ''}`;
  /** Напоминания: подборки со сроком в ближайшие 2 дня (или уже просрочено сегодня), где ещё есть нерешённое. */
  function noticeReminders() {
    if (typeof ASG === 'undefined') return [];
    const now = Date.now() / 1000;
    return ASG.filter(a => !a.duel && !a.course && a.due && !asgFinished(a) && a.due - now < 2 * 86400 && a.due - now > -86400)
      .map(a => {
        const left = asgLeft(a).length, hrs = Math.round((a.due - now) / 3600);
        if (!left) return null;
        const when = hrs <= 0 ? 'срок уже прошёл' : hrs < 24 ? `осталось ${hrs} ${plural(hrs, 'час', 'часа', 'часов')}` : 'срок завтра';
        return { k: 'remind', ts: Date.now() / 1000, ic: '⏰', title: `Не забудь: «${a.title}»`, text: `${when} · нерешённых заданий: ${left}`, go: 'asg', id: a.id, due: a.due };
      }).filter(Boolean);
  }
  /** Сколько новых: уведомления после последнего открытия + напоминания, которые сегодня ещё не видел. */
  function noticeUnread() {
    if (!NOTICES) return 0;
    let seenDay = '';
    try { seenDay = localStorage.getItem(remindKey()) || ''; } catch (e) { /* не страшно */ }
    const rem = seenDay === dayKey(Date.now()) ? 0 : noticeReminders().length;
    return NOTICES.items.filter(x => x.ts > NOTICES.read).length + rem;
  }
  function noticeBadge() {
    const b = $('#bellBtn'), n = $('#bellN');
    if (!b) return;
    b.hidden = !SERVER || !student || TEACHER;
    const k = noticeUnread();
    n.hidden = !k;
    n.textContent = k > 99 ? '99+' : String(k);
    b.classList.toggle('has', !!k);
    b.setAttribute('aria-label', k ? `Уведомления: новых ${k}` : 'Уведомления');
  }
  /** Перезапросить ленту (пачку событий подряд — одним запросом). */
  function noticesLoad(now) {
    if (!SERVER || !student || TEACHER) return;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(async () => {
      try { NOTICES = await api('notices'); } catch (e) { return; }
      noticeBadge();
      if ($('#forecastBody .nt-page')) renderNotices();
    }, now ? 0 : 700);
  }
  const ntDay = ts => {
    const d = new Date(ts * 1000), t = new Date(); t.setHours(0, 0, 0, 0);
    if (d >= t) return 'Сегодня';
    if (d >= new Date(t.getTime() - 864e5)) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  };
  const ntTime = ts => { const d = new Date(ts * 1000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const ntDue = due => (due ? ` · срок до ${new Date(due * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : '');
  const NT_GO = { gift: 'Открыть подарок', coins: 'Монеты', support: 'Открыть переписку', asg: 'К подборке' };
  function renderNotices() {
    const N = NOTICES || { items: [], read: 0 };
    const rem = noticeReminders();
    const all = rem.concat(N.items);
    const list = noticeTab === 'all' ? all : all.filter(x => x.k === noticeTab);
    const cnt = k => all.filter(x => x.k === k).length;
    let day = '';
    const rows = list.map(x => {
      const d = x.k === 'remind' ? 'Напоминания' : ntDay(x.ts);
      const head = d !== day ? `<h4 class="nt-day">${d}</h4>` : '';
      day = d;
      const fresh = x.k === 'remind' || x.ts > (N.shownRead != null ? N.shownRead : N.read);   // пока окно открыто — новые подсвечены
      return `${head}<button type="button" class="nt-item nt-${x.k}${fresh ? ' new' : ''}" data-nt-go="${x.go}" data-nt-id="${x.id}">
        <span class="nt-ic" aria-hidden="true">${esc(x.ic)}</span>
        <span class="nt-body"><b>${esc(x.title)}</b><span>${esc(x.text)}${x.k === 'asg' ? esc(ntDue(x.due)) : ''}</span>
          ${x.note ? `<span class="nt-note">💌 ${esc(x.note)}</span>` : ''}${x.sub ? `<small>на обращение: «${esc(x.sub)}»</small>` : ''}</span>
        <span class="nt-side">${x.k === 'remind' ? '' : `<small>${ntTime(x.ts)}</small>`}<em>${NT_GO[x.go] || ''} →</em></span></button>`;
    }).join('');
    $('#forecastBody').innerHTML = `<div class="nt-page">
      <h2 class="fm-title">🔔 Уведомления</h2>
      <p class="fm-note">За последние 2 месяца.</p>
      <div class="hist-filters nt-tabs">${NOTICE_TABS.map(([k, t]) => { const c = k === 'all' ? all.length : cnt(k); return (k === 'all' || c) ? `<button type="button" data-nt-tab="${k}" class="${noticeTab === k ? 'on' : ''}">${t}${k === 'all' ? '' : ` · ${c}`}</button>` : ''; }).join('')}</div>
      <div class="nt-list">${rows || '<p class="fm-note">Пока ничего нет — уведомления появятся здесь.</p>'}</div></div>`;
  }
  async function openNotices() {
    if (isNarrow()) setSideOpen(false);
    noticeTab = 'all';
    renderNotices();
    $('#forecastModal').hidden = false;
    if (!NOTICES) { noticesLoad(true); }
    const was = NOTICES ? NOTICES.read : 0;
    try { localStorage.setItem(remindKey(), dayKey(Date.now())); } catch (e) { /* не страшно */ }
    try { await api('notices/read', {}); } catch (e) { return; }
    // новые подсвечены, пока окно открыто; счётчик гаснет сразу
    if (NOTICES) { NOTICES = Object.assign({}, NOTICES, { read: Date.now() / 1000, shownRead: was }); }
    const b = $('#bellN'); if (b) b.hidden = true;
    $('#bellBtn')?.classList.remove('has');
  }
  $('#bellBtn')?.addEventListener('click', openNotices);
  document.addEventListener('click', e => {
    if (!e.target.closest('#forecastBody .nt-page')) return;
    const tb = e.target.closest('[data-nt-tab]');
    if (tb) { noticeTab = tb.dataset.ntTab; renderNotices(); return; }
    const it = e.target.closest('[data-nt-go]');
    if (!it) return;
    const go = it.dataset.ntGo, id = +it.dataset.ntId;
    closeForecast();
    if (go === 'gift') openGifts(undefined, id, 'mine');
    else if (go === 'coins') openGifts(undefined, undefined, 'shop');
    else if (go === 'support') openSupport('auto');
    else if (go === 'asg') {
      const a = typeof ASG !== 'undefined' && ASG.find(x => x.id === id);
      if (a && !asgFinished(a) && asgLeft(a).length && !a.strict) setScope('asg', id);
      else openAssignments();
    }
  });
