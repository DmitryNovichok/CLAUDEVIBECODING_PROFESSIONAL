  // ------------------------------------------------------------ старт
  function start() {
    recent.length = 0;
    recent.push(...P.log.slice(-CFG.recentWindow * 3).map(x => partToGroup.get(x.id) || x.id));
    if (HAS_GROUPS) {                     // повторения по 20 и 21 теперь относятся к заданию 19–21
      for (const r of Object.values(P.reviews)) {
        if (r.n !== 20 && r.n !== 21) continue;
        const key = '19|' + (r.topic || '');
        if (!P.reviews[key]) P.reviews[key] = Object.assign({}, r, { key, n: 19 });
        delete P.reviews[r.key];
      }
    }
    if (ui.scope === 'fav' && !prefs.fav.length) ui.scope = 'all';
    if (ui.scope === 'asg' && !asgOf(ui.asg)) ui.scope = 'all';
    lastNum = null;
    renderWho();
    renderDailyCard();
    renderDuelCard();
    $('#supportBtn').hidden = !(SERVER && student);
    // незаконченный вариант ЕГЭ (например, после перезагрузки страницы)
    const ex = readJSON(examKey());
    if (ex && Array.isArray(ex.items) && ex.items.length && ex.deadline) {
      EX = Object.assign({ ans: {}, cur: 0 }, ex);
      delete EX.finishing;
      EX.fsOn = false;                     // после перезагрузки полный экран снят — над заданием будет кнопка вернуть
      examShown = true;
      renderSidebar();
      startExamTimer();
      if (Date.now() >= EX.deadline) { renderExam(); finishExam(true); return; }
      renderExam();
      return;
    }
    if (SERVER && student) hubNavOn();        // страницы без боковой панели — и когда входят сразу в раздел, минуя главную
    renderSidebar();
    const labRequested = location.hash === '#lab' || location.hash === '#lab-arduino';     // #lab-arduino — со страницы /arduino/ без доступа
    const saved = ui.currentId && byId.get(ui.currentId);
    if (labRequested) {
      openLab(location.hash === '#lab-arduino' ? 'arduino' : '');
    } else if (SERVER && student) {                  // ученик начинает с главной: план на сегодня и все разделы
      openHub(true);
    } else if (saved && inScope(saved)) {
      const s = P.tasks[saved.id];
      show({ task: saved, why: { type: s ? 'repeat' : 'new' }, resume: true });
    } else {
      next();
    }
    const fresh = !labRequested && !P.log.length && !tourSeen();
    if (fresh) { setTimeout(openTour, 400); promoNext = true; }       // новичку — коротко о том, как всё устроено (потом — акция)
    if (SERVER && student) {
      const ready = Promise.all([loadDaily(), loadDuels()]);
      liveStart();                                                     // живые обновления: одно соединение на браузер
      loadSupport();
      setTimeout(() => togCheck(true), 1200);                         // учитель ждёт в общем сеансе?
      if (!labRequested && !fresh) ready.then(() => setTimeout(loginSummary, 300));
      setTimeout(loadRating, 900);                                     // место в лиге — на кнопку вверху
    }
  }

  async function loginSummary() {
    const sid = student?.sid;
    if (await showWeeklyRating()) return;
    if (student?.sid === sid && courseShown && pageKind === 'hub' && $('#forecastModal').hidden) {
      if (!padAuto() && !storiesAuto()) promoAuto();
    }
  }

  // ------------------------------------------------------------ знакомство с сайтом
  const tourKey = () => `egeshka.tour.v1.${student ? student.sid : 'local'}`;
  function tourSeen() { try { return !!localStorage.getItem(tourKey()); } catch (e) { return true; } }
  /** Знакомство: 5 шагов со снимками сайта (onboard.js), в конце — «Показать на главной» (обучение на месте). */
  function openTour() {
    try { localStorage.setItem(tourKey(), '1'); } catch (e) { /* не страшно */ }
    if (!window.EgOnboard) return;
    const li = (ic, t, d) => `<li><i>${ic}</i><span>${t}${d ? `<small>${d}</small>` : ''}</span></li>`;
    const list = [
      { color: 'g', kicker: 'Привет! Это Egeshka', title: 'Каждый день — короткий план', img: 'promo/hub.jpg', imgAlt: 'Главная ученика: план на сегодня',
        html: `<p>Тренажёр ЕГЭ по информатике, который подстраивается под тебя. На главной — план на сегодня из 3–4 дел: тренировка по слабым номерам, повторение ошибок, задание дня.</p>
          <ul>${li('1', 'Начни с первого дела', 'кнопка справа от него')}${li('✓', 'Сделанное отмечается галочкой', 'полоска внизу показывает день')}</ul>` },
      { color: 'b', title: 'Задания всех 27 номеров', img: 'promo/task.jpg', imgAlt: 'Задание в тренажёре',
        html: `<p>Ответ проверяется сразу. Тренажёр чаще даёт те номера и типы, которые пока получаются хуже.</p>
          <ul>${li('💡', 'Подсказка в два шага', 'потом — разбор решения')}${li('🔁', 'Ошибка вернётся', 'через несколько дней — на похожем задании')}${li('🧮', 'Python, доска, калькулятор', 'прямо рядом с условием')}</ul>
          <p class="ob-note">Ответ можно открыть не сразу — сначала попробуй решить. Открытый ответ считается ошибкой.</p>` },
      { color: 'o', title: 'Прогноз балла', img: 'promo/forecast.jpg', imgAlt: 'Прогноз балла ЕГЭ',
        html: `<p>По твоим ответам считается ожидаемый балл ЕГЭ — он пересчитывается после каждого задания.</p>
          <ul>${li('📈', 'Нажми «Прогноз» на главной', 'график по дням и номера, которые тянут балл вниз')}${li('⏱️', 'Вариант ЕГЭ', '27 заданий на 3 ч 55 мин, проверка в конце — как на экзамене')}</ul>` },
      { color: 'v', title: 'Курсы и лаборатории', img: 'promo/lesson.jpg', imgAlt: 'Слайд урока курса ЕГЭ',
        html: `<ul>${li('🎓', 'Курсы', 'уроки по номерам ЕГЭ и курс программирования на Python')}${li('🧪', 'Лаборатории', 'модели ЕГЭ, разбор кода по шагам, исправление ошибок и схемы Arduino')}</ul>
          <p class="ob-note">Введи пароль от раздела один раз. На другом устройстве войди в тот же аккаунт.</p>` },
    ];
    if (SERVER) list.push({ color: 'r', title: 'Чтобы заниматься каждый день',
      emoji: [['🔥', 'Огонёк — 3 задания за день'], ['📅', 'Задание дня на скорость'], ['⚔️', 'Дуэли с одноклассниками'], ['🏆', 'Лиги недели'], ['₿', 'Монеты и подарки'], ['⭐', 'Уровни и награды']],
      html: `<p>За решённые задания — опыт, уровни и монеты. Огонёк горит, если за день решено хотя бы 3 задания.</p>
        <p>Всё, что есть на сайте, — <a href="/welcome#features" target="_blank" rel="noopener">одним списком</a>.</p>
        <p class="ob-note">Покажем на главной, где что находится, — это займёт полминуты.</p>` });
    window.EgOnboard.slides(list, { label: 'Как работает Egeshka', buttons: [
      { label: 'Начать решать' },
      { label: 'Показать на главной', primary: true, coach: true },
    ], onClose: b => { if (b && b.coach) coachHub(); else tourDone(); } });
  }
  /** Обучение на месте: подсветка настоящих элементов главной. */
  function coachHub() {
    if (!window.EgOnboard) return;
    if (!(courseShown && pageKind === 'hub')) openHub();
    setTimeout(() => window.EgOnboard.coach([
      { sel: '.hub-plan', title: 'План на сегодня', text: 'Начинай отсюда: 3–4 дела на день. Выполненное отмечается галочкой.' },
      { sel: '.hub-pill[data-hub-go="forecast"]', title: 'Прогноз балла', text: 'Нажми — увидишь график по дням и что подтянуть, чтобы балл вырос.' },
      { sel: '.hub-pill.fire-pill', title: 'Огонёк', text: 'Реши за день 3 задания — огонёк загорится. Дни подряд копятся.' },
      { sel: '.hub-tile[data-tile-key="courses"]', title: 'Курсы и лаборатории', text: 'Открой «Курсы», чтобы выбрать ЕГЭ или Python. Рядом находятся «Лаборатории».' },
      { sel: '#hubNums', title: 'Номера заданий', text: 'Быстрый переход к любому номеру 1–27 и поиск задания по номеру.' },
      { sel: '#supportBtn', title: 'Техподдержка', text: 'Что-то не работает или непонятно — напиши. Ответ придёт сюда же.' },
      { sel: '.hub-foot [data-hub-link="tourBtn"]', title: 'Повторить знакомство', text: 'Это обучение можно открыть снова здесь, внизу главной.' },
    ], { onClose: tourDone }), 450);
  }
  /** После знакомства новичку — истории «Что нового» или объявление об акции (как раньше после окна знакомства). */
  function tourDone() {
    if (!promoNext) return;
    promoNext = false;
    if (SERVER && student) loginSummary();
  }
  $('#tourBtn').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openTour(); });

  // ------------------------------------------------------------ техподдержка: обращение уходит главному учителю, ответ — здесь
  let SUPPORT = { unread: 0 };
  let spRequest = 0;
  // время в техподдержке — московское, где бы ни был ученик и его часовой пояс
  const MSK_FMT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const mskTime = sec => MSK_FMT.format(new Date(sec * 1000)).replace(',', '') + ' МСК';
  const SP_STATUS = { new: ['chip', 'ждёт ответа'], answered: ['chip good', 'есть ответ'], closed: ['chip', 'закрыто'] };
  function spBadge(d) {
    SUPPORT = { unread: d.unread };
    $('#supportBtn').hidden = false;
    $('#supportDot').hidden = !d.unread;
    for (const button of $$('#forecastBody [data-sp-tab]')) {
      button.querySelector('.sp-tab-dot').hidden = !d.unread_tabs[button.dataset.spTab];
    }
  }
  async function loadSupport() {
    const sid = student?.sid;
    if (!SERVER || !sid) { $('#supportBtn').hidden = true; return; }
    try {
      const d = await api('support?summary=1');
      if (student?.sid === sid) spBadge(d);
    } catch (e) { /* следующий запрос обновит счётчик */ }
  }
  // картинки в техподдержке: скриншот ошибки — кнопкой 📎 или вставкой Ctrl+V в поле
  const SP_IMG = new Map();                          // имя файла на сервере → blob-ссылка (картинку отдают только автору)
  const spImgHtml = name => (name ? `<button type="button" class="sp-img" data-sp-img="${esc(name)}" title="Открыть картинку"><img alt="картинка"></button>` : '');
  async function spLoadImgs(root) {
    for (const b of root.querySelectorAll('[data-sp-img]')) {
      const f = b.dataset.spImg;
      let url = SP_IMG.get(f);
      if (!url) {
        try {
          const r = await fetch('api/support/img?f=' + encodeURIComponent(f), { headers: { 'X-Token': student.token } });
          if (!r.ok) continue;
          url = URL.createObjectURL(await r.blob());
          SP_IMG.set(f, url);
        } catch (e) { continue; }
      }
      b.querySelector('img').src = url;
    }
  }
  /** Картинка из файла или буфера → JPEG не больше 1600 точек по стороне и ~1,4 МБ (данные о месте съёмки отбрасываются). */
  function spShrink(file) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) { rej(new Error('Это не картинка')); return; }
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(u);
        let q = 0.85, side = 1600, out = '';
        for (let i = 0; i < 5; i++) {
          const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          const g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', q);
          if (out.length * 0.75 < 1.4e6) break;
          q = Math.max(0.5, q - 0.1); side = Math.round(side * 0.8);
        }
        res(out);
      };
      img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Не получилось открыть картинку')); };
      img.src = u;
    });
  }
  /** У поля ввода: кнопка 📎, вставка картинки через Ctrl+V, превью с крестиком. Картинка — в box.spImg. */
  function spAttach(box) {
    const ta = box.querySelector('textarea'), prev = box.querySelector('.sp-prev');
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
    box.appendChild(inp);
    const set = async file => {
      try { box.spImg = await spShrink(file); } catch (e) { toast(e.message, 3000); return; }
      prev.innerHTML = `<img src="${box.spImg}" alt="прикреплённая картинка"><button type="button" class="sp-prev-x" title="Убрать картинку">×</button>`;
      prev.hidden = false;
    };
    box.querySelector('[data-sp-pick]').addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { if (inp.files[0]) set(inp.files[0]); inp.value = ''; });
    ta.addEventListener('paste', e => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type));
      if (!f) return;
      if (!e.clipboardData.getData('text')) e.preventDefault();
      set(f);
    });
    prev.addEventListener('click', e => { if (e.target.closest('.sp-prev-x')) { box.spImg = null; prev.innerHTML = ''; prev.hidden = true; } });
  }
  const SP_PICK = '<button type="button" class="btn ghost sp-pick" data-sp-pick title="Прикрепить картинку — или вставь скриншот в поле через Ctrl+V">📎 Картинка</button><span class="sp-prev" hidden></span>';
  // две вкладки: «🛟 Обращения» (ошибка, не работает, вопрос) и «💡 Пожелания» (свои идеи для сайта, kind = idea)
  let spTab = 'help';
  const SUPPORT_ICON = '<svg class="support-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6m5.6 5.6 3.6 3.6m0-12.8-3.6 3.6m-5.6 5.6-3.6 3.6"/></svg>';
  function spItemHtml(x, idea, kinds) {
    const st = SP_STATUS[x.status] || SP_STATUS.new;
    const thread = (x.thread || [{ who: 'student', ts: x.ts, text: x.text }]).map(m => m.who === 'teacher'
      ? `<div class="sp-ans"><b>Учитель · ${mskTime(m.ts)}</b>${esc(m.text)}${spImgHtml(m.img)}</div>`
      : `<div class="sp-msg"><b>Ты · ${mskTime(m.ts)}</b>${esc(m.text)}${spImgHtml(m.img)}</div>`).join('');
    return `<div class="sp-item${x.answer && !x.seen ? ' unread' : ''}" data-sp="${x.id}" tabindex="-1"><div class="sp-head"><span class="${st[0]}">${st[1]}</span>
      ${idea ? `<span>${mskTime(x.ts)}</span>` : `<span>${esc(kinds[x.kind] || '')}</span>`}${x.task ? `<span>задание ${esc(x.task)}</span>` : ''}</div>
      <div class="sp-thread">${thread}</div>
      ${x.status === 'closed' ? '<p class="sp-closed">Тема закрыта. Если вопрос остался — напиши новое обращение выше.</p>'
        : `<div class="sp-reply" data-sp-box><textarea class="inp" rows="2" maxlength="2000" placeholder="Ответить в этой теме"></textarea>
        <div class="sp-row">${SP_PICK}<button type="button" class="btn" data-sp-reply>Отправить</button></div></div>`}</div>`;
  }
  async function spMarkShown(items) {
    const sid = student?.sid;
    const shown = items.filter(x => x.answer && !x.seen).map(x => ({id: x.id, answered: x.answered}));
    if (!sid || !shown.length) return;
    try {
      const d = await api('support/seen', {shown});
      if (student?.sid === sid) spBadge(d);
    } catch (e) { /* непрочитанное останется отмеченным */ }
  }
  // Обновляем только затронутые темы. Ученик может продолжать печатать ответ и листать историю.
  function spPutItems(list, data, where, keepDraft = true) {
    const shown = [];
    for (const x of data.items) {
      const old = list.querySelector(`[data-sp="${x.id}"]`);
      // Ответ на прежний запрос может прийти уже после нового сообщения.
      if (old && old.querySelector('.sp-thread').childElementCount > x.thread.length) continue;
      shown.push(x);
      const template = document.createElement('template');
      template.innerHTML = spItemHtml(x, x.kind === 'idea', data.kinds);
      const card = template.content.firstElementChild;
      const reply = card.querySelector('[data-sp-box]'), prev = old?.querySelector('[data-sp-box]');
      if (prev && reply && keepDraft) {
        old.className = card.className;
        old.querySelector('.sp-head').replaceWith(card.querySelector('.sp-head'));
        old.querySelector('.sp-thread').replaceWith(card.querySelector('.sp-thread'));
        spLoadImgs(old);
      } else {
        if (reply) spAttach(reply);
        if (old) old.replaceWith(card); else list.insertAdjacentElement(where, card);
        spLoadImgs(card);
      }
    }
    spMarkShown(shown);
  }
  async function spRefreshHistory(onlyUnread = false) {
    const list = $('#forecastBody .sp-list');
    if (!list || $('#forecastModal').hidden) return;
    try {
      const d = await api('support?section=' + spTab + (onlyUnread ? '&unread=1' : ''));
      if (!list.isConnected || $('#forecastModal').hidden) return;
      const shownUnread = d.items.filter(x => x.answer && !x.seen).length;
      d.items.reverse();
      spPutItems(list, d, 'afterbegin');
      if (!onlyUnread && d.unread_tabs[spTab] > shownUnread) await spRefreshHistory(true);
    } catch (e) { /* история остаётся на экране */ }
  }
  /** Из уведомления открываем указанную тему, в том числе из давней переписки. */
  async function openSupport(tab, ticketId) {
    if (!SERVER || !student) return;
    if (isNarrow()) setSideOpen(false);
    const sid = student.sid, request = ++spRequest, key = 'egeshka.support.tab.' + sid;
    const prefer = readJSON(key) === 'idea' ? 'idea' : 'help';
    const modal = $('#forecastModal'), body = $('#forecastBody');
    body.innerHTML = '<p class="fm-note" data-sp-loading>Загружаю переписку…</p>';
    modal.hidden = false;
    const loading = body.firstElementChild;
    const current = () => request === spRequest && student?.sid === sid && loading.isConnected && !modal.hidden;
    let d, target;
    try {
      if (ticketId) {
        const single = await api('support?id=' + encodeURIComponent(ticketId));
        if (!current()) return;
        target = single.items[0];
        if (target) tab = target.kind === 'idea' ? 'idea' : 'help';
        else toast('Обращение больше недоступно');
      }
      d = await api('support?section=' + (tab || spTab) + '&prefer=' + prefer);
    } catch (e) {
      if (current()) loading.textContent = 'Не удалось загрузить переписку. Открой техподдержку ещё раз.';
      return;
    }
    if (!current()) return;
    spTab = d.section;
    writeJSON(key, spTab);
    const idea = spTab === 'idea';
    const t = !idea && cur && cur.task && !courseShown ? cur.task : null;
    const kinds = Object.entries(d.kinds).filter(([k]) => k !== 'idea').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    const dot = '<i class="sp-tab-dot" hidden></i>';
    const items = d.items.slice();
    if (target && !items.some(x => x.id === target.id)) items.unshift(target);

    const amounts = new Map((RULES.support_rewards || []).map(([kind, , , amount]) => [kind, amount]));
    const rewardLabels = idea
      ? [['idea', 'За полезную идею'], ['ux', 'За предложение по удобству интерфейса'], ['done', 'Бонус за реализацию идеи']]
      : [['bug', 'За найденную ошибку'], ['ux', 'За предложение по удобству интерфейса'], ['critical', 'За критическую уязвимость или другую важную ошибку']];
    const rewardText = rewardLabels.filter(([kind]) => amounts.has(kind))
      .map(([kind, label]) => `${label} — ${amounts.get(kind)} ₿`).join('. ');
    const form = idea ? `
      <p class="fm-note">Есть идея, как сделать Egeshka лучше? Новый режим, задания, подарки, что-то неудобно — напиши.
        Учитель прочитает и ответит здесь. Можно приложить картинку: «📎 Картинка» или Ctrl+V в поле.</p>
      <form class="sp-form" id="spForm" data-sp-box>
        <input type="hidden" id="spKind" value="idea">
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Моя идея: что добавить или улучшить и зачем" required></textarea>
        <div class="sp-row"><span></span>${SP_PICK}<button type="submit" class="btn primary">💡 Отправить идею</button></div>
      </form>` : `
      <p class="fm-note">Нашёл ошибку в задании, что-то не работает или есть вопрос — напиши. Можно приложить скриншот: кнопка «📎 Картинка» или Ctrl+V в поле. Обращение получит учитель, ответ появится здесь.</p>
      <form class="sp-form" id="spForm" data-sp-box>
        <select class="inp" id="spKind">${kinds}</select>
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Опиши, что случилось: что делал, что ожидал и что получилось" required></textarea>
        <div class="sp-row">${t ? `<label class="sp-att"><input type="checkbox" id="spTask" checked> приложить задание №${numLabel(t.n)} (${esc(t.id)})</label>` : '<span></span>'}
          ${SP_PICK}<button type="submit" class="btn primary">Отправить</button></div>
      </form>`;
    $('#forecastBody').innerHTML = `<h2 class="fm-title">${SUPPORT_ICON} Техподдержка</h2>
      <div class="sp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${!idea}" class="${idea ? '' : 'on'}" data-sp-tab="help">${SUPPORT_ICON} Обращения${dot}</button>
        <button type="button" role="tab" aria-selected="${idea}" class="${idea ? 'on' : ''}" data-sp-tab="idea">💡 Пожелания${dot}</button>
      </div>
      ${rewardText ? `<p class="fm-note sp-reward">🎁 ${rewardText}. <button type="button" class="link-btn" data-pad-open>За что и сколько</button></p>` : ''}
      ${form}
      <h3 class="fm-sub">${idea ? 'Мои пожелания' : 'Мои обращения'}</h3><div class="sp-list"></div>
      <button type="button" class="btn ghost" data-sp-more ${d.next_before ? '' : 'hidden'}>Показать более ранние обращения</button>`;
    if (t) $('#spKind').value = 'task';
    spAttach($('#spForm'));
    const list = body.querySelector('.sp-list');
    spBadge(d);
    spPutItems(list, {...d, items}, 'beforeend');
    const more = body.querySelector('[data-sp-more]');
    let before = d.next_before;
    more.addEventListener('click', async () => {
      more.disabled = true;
      try {
        const page = await api('support?section=' + spTab + '&before=' + before);
        if (!more.isConnected || modal.hidden) return;
        spPutItems(list, page, 'beforeend');
        before = page.next_before;
        more.hidden = !before;
      } catch (e) { toast('Не удалось загрузить историю'); } finally { more.disabled = false; }
    });
    if (target) list.querySelector(`[data-sp="${target.id}"]`)?.focus();
    if (d.unread_tabs[spTab] > items.filter(x => x.answer && !x.seen).length) spRefreshHistory(true);
    $('#spForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      const body = { kind: $('#spKind').value, text: $('#spText').value, page: pageKind || (courseShown ? 'course' : ui.scope), img: $('#spForm').spImg || null };
      if (t && $('#spTask') && $('#spTask').checked) body.task = t.id;
      btn.disabled = true;                              // двойной клик — одно обращение
      try { await api('support', body); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); btn.disabled = false; return; }
      toast(idea ? 'Пожелание отправлено учителю — ответ появится здесь' : 'Обращение отправлено — ответ появится в «Техподдержке»', 3500);
      if (btn.isConnected && !modal.hidden) openSupport();
    });
  }
  $('#forecastBody').addEventListener('click', async e => {
    const button = e.target.closest('[data-sp-reply]');
    if (!button) return;
    const box = button.closest('[data-sp]'), rep = button.closest('[data-sp-box]'), list = box.parentNode;
    const text = rep.querySelector('textarea').value.trim();
    if (!text && !rep.spImg) { toast('Напиши сообщение'); return; }
    button.disabled = true;
    try {
      const d = await api('support/reply', { id: +box.dataset.sp, text, img: rep.spImg || null });
      if (list.isConnected) spPutItems(list, d, 'afterbegin', false);
      toast('Сообщение отправлено', 2500);
    } catch (err) { toast(err.message || 'Не получилось отправить', 3500); }
    finally { button.disabled = false; }
  });
  $('#supportBtn').addEventListener('click', () => openSupport('auto'));
  $('#forecastBody').addEventListener('click', e => {                 // вкладки техподдержки
    const b = e.target.closest('[data-sp-tab]');
    if (b && b.dataset.spTab !== spTab) openSupport(b.dataset.spTab);
  });
  $('#forecastBody').addEventListener('click', e => {                 // картинку в техподдержке — открыть целиком
    const b = e.target.closest('[data-sp-img]');
    if (b && SP_IMG.get(b.dataset.spImg)) window.open(SP_IMG.get(b.dataset.spImg), '_blank');
  });

  // ------------------------------------------------------------ версия и что нового (новое — сверху)
  // Каждый коммит, который меняет что-то для учеников, — новая версия: новая возможность — второе число, исправление — третье.
  // история версий — в changelog.js (общая с панелью учителя): [версия, дата, добавлено[], изменено[]]
  const CHANGELOG = (window.EGE_CHANGELOG && window.EGE_CHANGELOG.student) || [['', '', [], []]];
  const versionBtn = $('#versionBtn');
  if (versionBtn) versionBtn.textContent = `Версия ${CHANGELOG[0][0]} · что нового`;
  let changelogLoading = false, changelogError = '';
  function renderChangelog() {
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Что нового</h2>
      ${changelogLoading ? '<p class="fm-muted" role="status">Загружаю предыдущие версии…</p>' : ''}${changelogError ? `<p role="alert">${esc(changelogError)} <button type="button" class="link-btn" data-changelog-retry>Повторить</button></p>` : ''}
      ${SERVER && student ? `<button type="button" class="sto-launch" id="storiesGo"><span class="sto-l-ic">🐞</span><span><b>Что нового: лаборатории и уроки</b>
        <small>исправление ошибок, отладчик, полные уроки курса, инструкция · ${storySlides().length} слайдов</small></span></button>` : ''}
      <div class="changelog">${CHANGELOG.map(([v, d, added, changed], i) => `<section class="cl-ver${i ? '' : ' cl-now'}">
        <h3><span class="cl-num">${v}</span><span class="fm-muted">${d}</span>${i ? '' : '<span class="chip good">сейчас</span>'}</h3>
        ${(added || []).length ? `<div class="cl-kind cl-add">✨ Добавлено</div><ul>${added.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${(changed || []).length ? `<div class="cl-kind cl-chg">🔧 Изменено</div><ul>${changed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>`;
  }
  async function openChangelog() {
    if (isNarrow()) setSideOpen(false);
    changelogLoading = !!window.EgeLoadChangelog; changelogError = '';
    renderChangelog(); $('#forecastModal').hidden = false;
    try { if (window.EgeLoadChangelog) await window.EgeLoadChangelog(); }
    catch (error) { changelogError = error.message; }
    finally {
      changelogLoading = false;
      if (!$('#forecastModal').hidden && $('#forecastBody .changelog')) renderChangelog();
    }
  }
  versionBtn?.addEventListener('click', openChangelog);
  $('#forecastBody').addEventListener('click', e => { if (e.target.closest('[data-changelog-retry]')) openChangelog(); });
  let promoNext = false;                                              // после знакомства с сайтом — объявление об акции
  // «Решать задания» в окне акции и «К заданиям» после матча — просто закрывают окно
  $('#forecastBody').addEventListener('click', e => { if (e.target.closest('#tourGo')) closeForecast(); });

  async function boot() {
    try { sessionStorage.removeItem('egeTrainer.relogin'); } catch (e) { /* нет доступа */ }
    if (SERVER) {
      const saved = readStudent();
      let ok = false;
      let mustSetPw = false;
      {                                            // записи в браузере нет, но cookie жив — тоже войдём
        student = saved && saved.token ? saved : null;
        // вход только по cookie (новая вкладка на «чужом компьютере»): токен в localStorage не кладём
        if (!student) { try { sessionStorage.setItem(TEMP_KEY, '1'); } catch (e) { /* нет доступа */ } }
        try {
          const me = await api('me');
          applyMe(me);
          await askConsent();                          // новая редакция документов — подтвердить перед занятиями
          mustSetPw = me.has_password === false && !me.teacher;   // учитель входит из панели — пароль ученика ему не нужен      // вошёл раньше, когда пароля ещё не было
          await loadHistory();
          await loadAssignments();
          await loadCourseSets();
          ok = true;
        } catch (e) {
          if (e.status === 401) {
            student = null;
          } else {                    // сервер временно недоступен — работаем с копией в браузере
            const localP = readJSON(storeKey());
            P = validProgress(localP) ? Object.assign(freshProgress(), localP) : freshProgress();
            prefs = normPrefs(readJSON(prefsKey()));
            ok = true;
          }
        }
      }
      if (!ok) {
        ui.currentId = null;
        if (await maybeWelcome()) return;
        await askName();
      }
      window.addEventListener('pagehide', () => { if (examShown) saveExamInputs(); abandonCurrent(true); flushSync(true); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSync(true); });
      $('#logoutBtn')?.addEventListener('click', () => {
        if (confirm('Выйти? Прогресс сохранён на сервере, войти можно снова по ФИО и паролю.')) logout();
      });
      $('#pwBtn')?.addEventListener('click', () => openPasswordDialog(false));
      $('#acctBtn')?.addEventListener('click', openAccount);
      if (mustSetPw) setTimeout(() => openPasswordDialog(true), 400);
    } else {
      window.addEventListener('pagehide', () => { if (examShown) saveExamInputs(); });
    }
    if (SERVER && student) await togHistory(false);   // наличие записей известно до первой отрисовки главной
    start();
    if (!storage) toast('Браузер запретил сохранение — прогресс не сохранится после закрытия страницы.', 5000);
  }
  boot().finally(() => document.body.classList.remove('app-loading'));
})();
