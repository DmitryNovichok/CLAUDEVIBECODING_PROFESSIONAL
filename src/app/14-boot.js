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
    renderSidebar();
    const saved = ui.currentId && byId.get(ui.currentId);
    if (saved && inScope(saved)) {
      const s = P.tasks[saved.id];
      show({ task: saved, why: { type: s ? 'repeat' : 'new' } });
    } else {
      next();
    }
    if (!P.log.length && !tourSeen()) setTimeout(openTour, 400);      // новичку — коротко о том, как всё устроено
    if (SERVER && student) {
      const ready = Promise.all([loadDaily(), loadDuels()]);
      liveStart();                                                     // живые обновления: одно соединение на браузер
      loadSupport();
      if (P.log.length || tourSeen()) ready.then(() => setTimeout(showDailyRating, 300));   // уже знакомым — сводка, раз в день
      setTimeout(loadRating, 900);                                     // место в лиге — на кнопку вверху
    }
  }

  // ------------------------------------------------------------ знакомство с сайтом
  const tourKey = () => `egeshka.tour.v1.${student ? student.sid : 'local'}`;
  function tourSeen() { try { return !!localStorage.getItem(tourKey()); } catch (e) { return true; } }
  function openTour() {
    try { localStorage.setItem(tourKey(), '1'); } catch (e) { /* не страшно */ }
    const items = [
      ['', 'Подбор под тебя', 'Тренажёр следит за точностью по каждому номеру и чаще даёт то, что пока получается хуже. Слабые места — красные полоски на плитках слева.'],
      ['', 'Работа над ошибками', 'Ошибся — через пару заданий придёт похожее, а само задание вернётся через несколько дней. Так тип задания запоминается надолго.'],
      ['', 'Прогноз балла', 'По твоим ответам считается ожидаемый балл ЕГЭ — он вверху слева, клик покажет график по дням.'],
      ['', 'Вариант ЕГЭ', '27 заданий, 3 ч 55 мин, проверка в конце — как на настоящем экзамене. В конце — первичный и тестовый балл.'],
      ['', 'Python прямо здесь', 'Кнопка «Python» рядом с номером: решай кодом, файлы задания открываются через open(), черепашка для №6 рисует на экране.'],
      ['', 'Опыт и достижения', 'За решённые задания и варианты — опыт, уровни, достижения и рейтинг класса за неделю.'],
      ['', 'Сначала подумай', 'На задание две попытки. Ответ можно открыть не сразу — через 40 секунд (у №24–27 — через 90). Учитель видит журнал ответов.'],
    ].filter(([, t]) => SERVER || !/Опыт|Python/.test(t));
    $('#forecastBody').innerHTML = `
      <h2 class="fm-title tour-title">Привет! Это <span class="brand-title"><b>Ege</b>shka</span></h2>
      <p class="fm-note">Тренажёр ЕГЭ по информатике, который подстраивается под тебя. Коротко о главном:</p>
      <div class="tour-grid">${items.map(([, t, d], k) => `<div class="tour-item"><span class="tour-ico" aria-hidden="true">${k + 1}</span>
        <div><b>${t}</b><p>${d}</p></div></div>`).join('')}</div>
      <div class="tour-foot"><button type="button" class="btn primary" id="tourGo">Начать решать</button>
        <span class="fm-muted">Это окно всегда можно открыть снова: «Как работает Egeshka» внизу левой панели.</span></div>`;
    $('#forecastModal').hidden = false;
    setTimeout(() => { const b = $('#tourGo'); if (b) b.focus(); }, 50);
  }
  $('#tourBtn').addEventListener('click', () => { if (isNarrow()) setSideOpen(false); openTour(); });

  // ------------------------------------------------------------ техподдержка: обращение уходит главному учителю, ответ — здесь
  let SUPPORT = { items: [], kinds: {}, unread: 0 };
  const SP_STATUS = { new: ['chip', 'ждёт ответа'], answered: ['chip good', 'есть ответ'], closed: ['chip', 'закрыто'] };
  async function loadSupport() {
    const b = $('#supportBtn');
    if (!SERVER || !student) { if (b) b.hidden = true; return; }
    try { SUPPORT = await api('support'); } catch (e) { return; }
    b.hidden = false;
    $('#supportDot').hidden = !SUPPORT.unread;
  }
  async function openSupport() {
    if (isNarrow()) setSideOpen(false);
    await loadSupport();
    const t = cur && cur.task && !courseShown ? cur.task : null;
    const kinds = Object.entries(SUPPORT.kinds || {}).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    const list = SUPPORT.items.map(x => {
      const st = SP_STATUS[x.status] || SP_STATUS.new;
      return `<div class="sp-item${x.answer && !x.seen ? ' unread' : ''}"><div class="sp-head"><span class="${st[0]}">${st[1]}</span>
        <span>${esc((SUPPORT.kinds || {})[x.kind] || '')}</span><span>${apTime(x.ts)}</span>${x.task ? `<span>задание ${esc(x.task)}</span>` : ''}</div>
        <div class="sp-text">${esc(x.text)}</div>
        ${x.answer ? `<div class="sp-ans"><b>Ответ · ${apTime(x.answered)}</b>${esc(x.answer)}</div>` : ''}</div>`;
    }).join('');
    $('#forecastBody').innerHTML = `<h2 class="fm-title">🛟 Техподдержка</h2>
      <p class="fm-note">Нашёл ошибку в задании, что-то не работает или есть вопрос — напиши. Обращение получит учитель, ответ появится здесь.</p>
      <form class="sp-form" id="spForm">
        <select class="inp" id="spKind">${kinds}</select>
        <textarea class="inp" id="spText" maxlength="2000" placeholder="Опиши, что случилось: что делал, что ожидал и что получилось" required></textarea>
        <div class="sp-row">${t ? `<label class="sp-att"><input type="checkbox" id="spTask" checked> приложить задание №${numLabel(t.n)} (${esc(t.id)})</label>` : '<span></span>'}
          <button type="submit" class="btn primary">Отправить</button></div>
      </form>
      ${list ? `<h3 class="fm-sub">Мои обращения</h3><div class="sp-list">${list}</div>` : ''}`;
    $('#forecastModal').hidden = false;
    if (t) $('#spKind').value = 'task';
    $('#spForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = { kind: $('#spKind').value, text: $('#spText').value, page: pageKind || (courseShown ? 'course' : ui.scope) };
      if (t && $('#spTask') && $('#spTask').checked) body.task = t.id;
      try { await api('support', body); } catch (err) { toast(err.message || 'Не получилось отправить', 3500); return; }
      toast('Обращение отправлено — ответ появится в «Техподдержке»', 3500);
      openSupport();
    });
    if (SUPPORT.unread) { try { await api('support/seen', {}); } catch (e) { /* не страшно */ } SUPPORT.unread = 0; $('#supportDot').hidden = true; }
  }
  $('#supportBtn').addEventListener('click', openSupport);

  // ------------------------------------------------------------ версия и что нового (новое — сверху)
  // Каждый коммит, который меняет что-то для учеников, — новая версия: новая возможность — второе число, исправление — третье.
  // история версий — в changelog.js (общая с панелью учителя): [версия, дата, добавлено[], изменено[]]
  const CHANGELOG = (window.EGE_CHANGELOG && window.EGE_CHANGELOG.student) || [['', '', [], []]];
  const versionBtn = $('#versionBtn');
  if (versionBtn) versionBtn.textContent = `Версия ${CHANGELOG[0][0]} · что нового`;
  versionBtn?.addEventListener('click', () => {
    if (isNarrow()) setSideOpen(false);
    $('#forecastBody').innerHTML = `<h2 class="fm-title">Что нового</h2>
      <div class="changelog">${CHANGELOG.map(([v, d, added, changed], i) => `<section class="cl-ver${i ? '' : ' cl-now'}">
        <h3><span class="cl-num">${v}</span><span class="fm-muted">${d}</span>${i ? '' : '<span class="chip good">сейчас</span>'}</h3>
        ${(added || []).length ? `<div class="cl-kind cl-add">✨ Добавлено</div><ul>${added.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${(changed || []).length ? `<div class="cl-kind cl-chg">🔧 Изменено</div><ul>${changed.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>`;
    $('#forecastModal').hidden = false;
  });
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
          mustSetPw = me.has_password === false;      // вошёл раньше, когда пароля ещё не было
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
        await askName();
      }
      window.addEventListener('pagehide', () => { if (examShown) saveExamInputs(); abandonCurrent(true); flushSync(true); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSync(true); });
      $('#logoutBtn').addEventListener('click', () => {
        if (confirm('Выйти? Прогресс сохранён на сервере, войти можно снова по ФИО и паролю.')) logout();
      });
      $('#pwBtn').addEventListener('click', () => openPasswordDialog(false));
      if (mustSetPw) setTimeout(() => openPasswordDialog(true), 400);
    } else {
      window.addEventListener('pagehide', () => { if (examShown) saveExamInputs(); });
    }
    start();
    if (!storage) toast('Браузер запретил сохранение — прогресс не сохранится после закрытия страницы.', 5000);
  }
  boot();
})();
