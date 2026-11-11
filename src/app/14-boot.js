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
    const labRequested = location.hash === '#lab';
    const saved = ui.currentId && byId.get(ui.currentId);
    if (labRequested) {
      openLab();
    } else if (SERVER && student) {                  // ученик начинает с главной: план на сегодня и все разделы
      openHub(true);
    } else if (saved && inScope(saved)) {
      const s = P.tasks[saved.id];
      show({ task: saved, why: { type: s ? 'repeat' : 'new' } });
    } else {
      next();
    }
    const fresh = !labRequested && !P.log.length && !tourSeen();
    if (fresh) { setTimeout(openTour, 400); promoNext = true; }       // новичку — коротко о том, как всё устроено (потом — акция)
    // после обновления — истории «Что нового» (один раз), иначе — объявление об акции (раз в день); сводка дня — в другой раз
    const promo = !labRequested && !fresh && SERVER && student && (storiesAuto() || promoAuto());
    if (SERVER && student) {
      const ready = Promise.all([loadDaily(), loadDuels()]);
      liveStart();                                                     // живые обновления: одно соединение на браузер
      loadSupport();
      setTimeout(() => togCheck(true), 1200);                         // учитель ждёт в общем сеансе?
      if (!labRequested && !fresh && !promo) ready.then(() => setTimeout(showDailyRating, 300));   // уже знакомым — сводка, раз в день
      setTimeout(loadRating, 900);                                     // место в лиге — на кнопку вверху
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
      { color: 'v', title: 'Курсы, Python и лаборатории', img: 'promo/lesson.jpg', imgAlt: 'Слайд урока курса ЕГЭ',
        html: `<p>Когда хочется разобраться в номере, а не просто решать:</p>
          <ul>${li('🎓', 'Курс ЕГЭ', 'уроки по номерам: типы задания, решение, программа')}${li('🐍', 'Курс Python', 'программирование с нуля и темы по номерам')}${li('🧪', 'Лаборатория', 'свой код по шагам, «Исправление ошибок», Arduino')}</ul>
          <p class="ob-note">Курсы и лаборатории открываются по паролю — его скажет учитель.</p>` },
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
      { sel: '.hub-tile[data-tile-key="trainer"]', title: 'Все разделы', text: 'Тренажёр, вариант ЕГЭ, задание дня, курсы и лаборатории — плитки на главной.' },
      { sel: '#hubNums', title: 'Номера заданий', text: 'Быстрый переход к любому номеру 1–27 и поиск задания по номеру.' },
      { sel: '#supportBtn', title: 'Техподдержка', text: 'Что-то не работает или непонятно — напиши. Ответ придёт сюда же.' },
      { sel: '.hub-foot [data-hub-link="tourBtn"]', title: 'Повторить знакомство', text: 'Это обучение можно открыть снова здесь, внизу главной.' },
    ], { onClose: tourDone }), 450);
  }
  /** После знакомства новичку — истории «Что нового» или объявление об акции (как раньше после окна знакомства). */
  function tourDone() {
    if (!promoNext) return;
    promoNext = false;
    if (!storiesAuto()) promoAuto();
  }
  $('#tourBtn').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openTour(); });

  // ------------------------------------------------------------ техподдержка: обращение уходит главному учителю, ответ — здесь
  let SUPPORT = { items: [], kinds: {}, unread: 0 };
  // время в техподдержке — московское, где бы ни был ученик и его часовой пояс
  const MSK_FMT = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const mskTime = sec => MSK_FMT.format(new Date(sec * 1000)).replace(',', '') + ' МСК';
  const SP_STATUS = { new: ['chip', 'ждёт ответа'], answered: ['chip good', 'есть ответ'], closed: ['chip', 'закрыто'] };
  async function loadSupport() {
    const b = $('#supportBtn');
    if (!SERVER || !student) { if (b) b.hidden = true; return; }
    try { SUPPORT = await api('support'); } catch (e) { return; }
    b.hidden = false;
    $('#supportDot').hidden = !SUPPORT.unread;
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
  const spIdea = x => x.kind === 'idea';
  const spNew = x => x.answer && !x.seen;
  const SUPPORT_ICON = '<svg class="support-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6m5.6 5.6 3.6 3.6m0-12.8-3.6 3.6m-5.6 5.6-3.6 3.6"/></svg>';
  /** tab: 'help' | 'idea' | 'auto' (кнопка «Техподдержка»: новый ответ только в пожеланиях — сразу туда); иначе — та же вкладка. */
  async function openSupport(tab) {
    if (isNarrow()) setSideOpen(false);
    await loadSupport();
    if (tab === 'auto') spTab = SUPPORT.items.some(x => spIdea(x) && spNew(x)) && !SUPPORT.items.some(x => !spIdea(x) && spNew(x)) ? 'idea' : 'help';
    else if (tab === 'help' || tab === 'idea') spTab = tab;
    const idea = spTab === 'idea';
    const t = !idea && cur && cur.task && !courseShown ? cur.task : null;
    const kinds = Object.entries(SUPPORT.kinds || {}).filter(([k]) => k !== 'idea').map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    const dot = ideas => (SUPPORT.items.some(x => spIdea(x) === ideas && spNew(x)) ? '<i class="sp-tab-dot"></i>' : '');
    const list = SUPPORT.items.filter(x => spIdea(x) === idea).map(x => {
      const st = SP_STATUS[x.status] || SP_STATUS.new;
      const thread = (x.thread || [{ who: 'student', ts: x.ts, text: x.text }]).map(m => m.who === 'teacher'
        ? `<div class="sp-ans"><b>Учитель · ${mskTime(m.ts)}</b>${esc(m.text)}${spImgHtml(m.img)}</div>`
        : `<div class="sp-msg"><b>Ты · ${mskTime(m.ts)}</b>${esc(m.text)}${spImgHtml(m.img)}</div>`).join('');
      return `<div class="sp-item${x.answer && !x.seen ? ' unread' : ''}" data-sp="${x.id}"><div class="sp-head"><span class="${st[0]}">${st[1]}</span>
        ${idea ? `<span>${mskTime(x.ts)}</span>` : `<span>${esc((SUPPORT.kinds || {})[x.kind] || '')}</span>`}${x.task ? `<span>задание ${esc(x.task)}</span>` : ''}</div>
        <div class="sp-thread">${thread}</div>
        ${x.status === 'closed' ? '<p class="sp-closed">Тема закрыта. Если вопрос остался — напиши новое обращение выше.</p>'
          : `<div class="sp-reply" data-sp-box><textarea class="inp" rows="2" maxlength="2000" placeholder="Ответить в этой теме"></textarea>
          <div class="sp-row">${SP_PICK}<button type="button" class="btn" data-sp-reply>Отправить</button></div></div>`}</div>`;
    }).join('');
    const form = idea ? `<p class="fm-note">Есть идея, как сделать Egeshka лучше? Новый режим, задания, подарки, что-то неудобно — напиши.
        Учитель прочитает и ответит здесь. Можно приложить картинку: «📎 Картинка» или Ctrl+V в поле.</p>
      <form class="sp-form" id="spForm" data-sp-box>
        <input type="hidden" id="spKind" value="idea">
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Моя идея: что добавить или улучшить и зачем" required></textarea>
        <div class="sp-row"><span></span>${SP_PICK}<button type="submit" class="btn primary">💡 Отправить идею</button></div>
      </form>` : `<p class="fm-note">Нашёл ошибку в задании, что-то не работает или есть вопрос — напиши. Можно приложить скриншот: кнопка «📎 Картинка» или Ctrl+V в поле. Обращение получит учитель, ответ появится здесь.</p>
      <form class="sp-form" id="spForm" data-sp-box>
        <select class="inp" id="spKind">${kinds}</select>
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Опиши, что случилось: что делал, что ожидал и что получилось" required></textarea>
        <div class="sp-row">${t ? `<label class="sp-att"><input type="checkbox" id="spTask" checked> приложить задание №${numLabel(t.n)} (${esc(t.id)})</label>` : '<span></span>'}
          ${SP_PICK}<button type="submit" class="btn primary">Отправить</button></div>
      </form>`;
    $('#forecastBody').innerHTML = `<h2 class="fm-title">${SUPPORT_ICON} Техподдержка</h2>
      <div class="sp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${!idea}" class="${idea ? '' : 'on'}" data-sp-tab="help">${SUPPORT_ICON} Обращения${dot(false)}</button>
        <button type="button" role="tab" aria-selected="${idea}" class="${idea ? 'on' : ''}" data-sp-tab="idea">💡 Пожелания${dot(true)}</button>
      </div>
      ${form}
      ${list ? `<h3 class="fm-sub">${idea ? 'Мои пожелания' : 'Мои обращения'}</h3><div class="sp-list">${list}</div>` : ''}`;
    $('#forecastModal').hidden = false;
    if (t) $('#spKind').value = 'task';
    $('#forecastBody').querySelectorAll('[data-sp-box]').forEach(spAttach);
    spLoadImgs($('#forecastBody'));
    $('#forecastBody').querySelectorAll('[data-sp-reply]').forEach(b => b.addEventListener('click', async () => {
      const box = b.closest('[data-sp]'), rep = box.querySelector('[data-sp-box]'), text = rep.querySelector('textarea').value.trim();
      if (!text && !rep.spImg) { toast('Напиши сообщение'); return; }
      b.disabled = true;
      try { await api('support/reply', { id: +box.dataset.sp, text, img: rep.spImg || null }); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); b.disabled = false; return; }
      toast('Сообщение отправлено', 2500);
      rep.querySelector('textarea').value = ''; rep.spImg = null;
      openSupport();
    }));
    $('#spForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      const body = { kind: $('#spKind').value, text: $('#spText').value, page: pageKind || (courseShown ? 'course' : ui.scope), img: $('#spForm').spImg || null };
      if (t && $('#spTask') && $('#spTask').checked) body.task = t.id;
      btn.disabled = true;                              // двойной клик — одно обращение
      try { await api('support', body); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); btn.disabled = false; return; }
      toast(idea ? '💡 Спасибо! Пожелание отправлено учителю — ответ появится здесь' : 'Обращение отправлено — ответ появится в «Техподдержке»', 3500);
      $('#spText').value = ''; $('#spForm').spImg = null;
      openSupport();
    });
    if (SUPPORT.unread) { try { await api('support/seen', {}); } catch (e) { /* не страшно */ } SUPPORT.unread = 0; $('#supportDot').hidden = true; }
  }
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
  versionBtn?.addEventListener('click', () => {
    if (isNarrow()) setSideOpen(false);
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Что нового</h2>
      ${SERVER && student ? `<button type="button" class="sto-launch" id="storiesGo"><span class="sto-l-ic">👥</span><span><b>Что нового: «Вместе» и дуэли</b>
        <small>световые мечи, занятия с учителем и их записи, дуэли вместо турниров · ${storySlides().length} слайда</small></span></button>` : ''}
      <div class="changelog">${CHANGELOG.map(([v, d, added, changed], i) => `<section class="cl-ver${i ? '' : ' cl-now'}">
        <h3><span class="cl-num">${v}</span><span class="fm-muted">${d}</span>${i ? '' : '<span class="chip good">сейчас</span>'}</h3>
        ${(added || []).length ? `<div class="cl-kind cl-add">✨ Добавлено</div><ul>${added.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${(changed || []).length ? `<div class="cl-kind cl-chg">🔧 Изменено</div><ul>${changed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>`;
    $('#forecastModal').hidden = false;
  });
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
      $('#logoutBtn').addEventListener('click', () => {
        if (confirm('Выйти? Прогресс сохранён на сервере, войти можно снова по ФИО и паролю.')) logout();
      });
      $('#pwBtn').addEventListener('click', () => openPasswordDialog(false));
      $('#acctBtn').addEventListener('click', openAccount);
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
