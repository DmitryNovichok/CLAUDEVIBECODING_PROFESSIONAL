  // Account changes invalidate in-flight loads and stop private workers without
  // fetching this chunk when it has never been opened.
  let learningSessionEpoch = 0;
  function learningSessionGuard() {
    const epoch = learningSessionEpoch, sid = appState.student?.sid;
    return () => epoch === learningSessionEpoch && sid === appState.student?.sid;
  }
  function resetLearningState() {
    ++learningSessionEpoch; ++courseLessonRequest; ++pycLevelRequest; ++labLoadId;
    confirmedSlides.clear();
    pycStopTests(); labStop(); resetBugLab();
    PYC = null; PYC_L = null; PYC_FOCUS = null; PYC_PENDING_HELP.clear(); PYC_HELP = Promise.resolve();
    Object.assign(LAB, { context: null, owner: null, result: null, mode: 'net', code: '', stdin: '', index: 0, seen: null });
    appState.DECK = null; appState.deckI = 0; appState.PYC_PY = null;
  }
  let courseCoverage = null, courseCoverageLoading = null;
  function loadCourseCoverage() {
    if (courseCoverage) return Promise.resolve(courseCoverage);
    if (!SERVER) return Promise.resolve(null);
    if (courseCoverageLoading) return courseCoverageLoading;
    courseCoverageLoading = api('course/coverage').then(d => {
      if (!Array.isArray(d.topics)) return;
      courseCoverage = d;
      d.topics.forEach(t => { if (Number.isInteger(t.n) && t.title) NUM_TOPIC[t.n] = t.title; });
      if (appState.courseShown && appState.pageKind === null && trainerEl.querySelector('.crs-hero')) openCourse();
      return d;
    }).catch(() => null).finally(() => { courseCoverageLoading = null; });
    return courseCoverageLoading;
  }
  const courseKind = n => {
    const row = courseCoverage?.topics.find(t => t.n === n);
    return row ? `${row.kind === 'lesson' ? 'подробный урок' : 'краткий разбор'} · ${row.slides} слайдов${row.model ? ' · есть лаборатория' : ''}` : 'формат указан в открытом уроке';
  };
  function courseLock() {
    $('#scopeInfo').innerHTML = '<span class="scope-title">Курс</span>';
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock">
      <div class="crs-lock-ic">🔒</div>
      <h2>Курс доступен по паролю</h2>
      <p>Пароль выдаёт учитель. Ввести его нужно один раз — дальше курс будет открыт на любом устройстве.</p>
      <form class="login-form crs-lock-form" id="courseForm" autocomplete="off">
        <input class="inp" id="coursePw" type="password" maxlength="200" placeholder="Пароль курса" autocomplete="off" required>
        <button class="btn primary" type="submit">Открыть курс</button>
      </form>
      <div class="login-err" id="courseMsg"></div>
    </div></div>`;
    $('#coursePw').focus();
    $('#courseForm').addEventListener('submit', async e => {
      e.preventDefault();
      const current = learningSessionGuard(), msg = $('#courseMsg');
      msg.textContent = '';
      try {
        await api('course/unlock', { password: $('#coursePw').value });
        if (!current()) return;
        appState.COURSE_OK = true;
        await loadCourseSets();
        if (!current()) return;
        toast('Курс открыт 🎓', 2500);
        openCourse();
      } catch (err) { if (!current()) return; msg.textContent = err.message || 'Не получилось — попробуйте ещё раз'; }
    });
  }
  function lessonState(n) {
    const st = numStats(n);
    return st.lvl === 'good' ? 'done' : st.lvl === 'none' ? 'new' : 'go';
  }
  async function openCourse() {
    if (!leaveExam()) return;
    const request = ++courseLessonRequest, current = learningSessionGuard();
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    appState.courseShown = true;
    appState.pageKind = null;
    appState.cur = null;
    navPush({ v: 'course' });
    if (!appState.COURSE_OK && SERVER && appState.student) {
      const active = () => current() && request === courseLessonRequest && appState.courseShown && appState.pageKind === null;
      $('#scopeInfo').innerHTML = '<span class="scope-title">Курс</span>';
      trainerEl.innerHTML = '<p class="fm-note" role="status">Проверяю доступ к курсу…</p>';
      try {
        const me = await api('me');
        if (!active()) return;
        if (me.sid !== appState.student.sid) throw Error('Изменился аккаунт. Обнови страницу.');
        appState.COURSE_OK = !!me.course;
        if (appState.COURSE_OK) await loadCourseSets();
        if (!active()) return;
      } catch (err) {
        if (!active()) return;
        trainerEl.innerHTML = '<section class="fm-note"><p role="alert">Не удалось проверить доступ к курсу.</p><button type="button" class="btn" data-course-retry>Повторить</button></section>';
        trainerEl.querySelector('[data-course-retry]').addEventListener('click', openCourse);
        return;
      }
    }
    if (!appState.COURSE_OK) { courseLock(); window.scrollTo(0, 0); return; }
    loadCourseCoverage();
    const all = COURSE.filter(m => !m.archive).flatMap(m => m.lessons), done = all.filter(n => lessonState(n) === 'done').length;
    const savedN = learningMemory().course;
    const nextN = all.includes(savedN) || ARCHIVE[savedN] ? savedN : all.find(n => lessonState(n) !== 'done');
    $('#scopeInfo').innerHTML = '<span class="scope-title">Курс</span><span class="scope-stats">Все задания ЕГЭ</span>';
    trainerEl.innerHTML = `<div class="course">
      <div class="crs-hero">
        <div><h2>ЕГЭ по информатике: от №1 до №27</h2>
          <p>В каждой теме — разбор метода, пример и практика по уровням. Темы — по демоверсии ФИПИ ЕГЭ-2027.</p></div>
        <div class="crs-prog"><b>${done}</b><span>из ${all.length} тем освоено</span><i class="xp-bar"><b style="width:${pct(done / all.length)}%"></b></i></div>
      </div>
      ${learningFormat}
      ${nextN ? `<button type="button" class="crs-continue" data-lesson="${nextN}"><span>▶</span><span><b>Продолжить: №${numLabel(nextN)} · ${esc(NUM_TOPIC[nextN])}</b><small>последняя открытая тема или следующий шаг по плану</small></span></button>` : ''}
      ${COURSE.map((m, i) => `<section class="crs-mod">
        <div class="crs-mod-h"><span class="crs-mod-ic">${m.icon}</span><div><b>${m.archive ? '' : `Модуль ${i + 1}. `}${esc(m.title)}</b><small>${esc(m.sub)}</small></div>
          <span class="crs-mod-n">${m.lessons.filter(n => lessonState(n) === 'done').length}/${m.lessons.length}</span></div>
        <div class="crs-path">${m.lessons.map(n => {
          const stt = lessonState(n), p = numStats(n).s && numStats(n).s.a ? pct(numStats(n).s.m) : 0;
          return `<button type="button" class="crs-lesson ${stt}" data-lesson="${n}">
            <span class="ring crs-ring${numLabel(n).length > 2 ? ' wide' : ''}" style="--p:${p}"><span class="n">${numLabel(n)}</span></span>
            <span class="crs-l-txt"><b>${esc(NUM_TOPIC[n])}</b><small title="${esc(courseKind(n))}">${stt === 'done' ? '✓ освоено' : stt === 'go' ? `в процессе · ${p}%` : 'не начато'}</small></span>
            <span class="crs-go">›</span></button>`;
        }).join('')}</div></section>`).join('')}
    </div>`;
    window.scrollTo(0, 0);
  }
  function slideHtml(sl, i) {
    const kick = sl.k ? `<div class="sl-k ${sl.kc || ''}">${esc(sl.k)}</div>` : '';
    const runBtn = (k, ans, out) => `<div class="sl-btns"><button type="button" class="btn primary" data-py-slide="${i}:${k}">▶ Открыть в Python</button><button type="button" class="btn" data-learning-slide="${i}:${k}">По шагам в лаборатории</button>
        ${ans ? `<details class="sl-ansbox"><summary>Показать ответ</summary><span class="sl-ok"><i aria-hidden="true">✓</i>Ответ: <b>${esc(ans)}</b></span></details>` : ''}
        ${out ? `<details class="sl-ansbox sl-outbox"><summary>Что выведет программа</summary><pre class="sl-out">${esc(out)}</pre></details>` : ''}</div>`;
    const codeBox = (code, k, ans, out) => `<div class="sl-codecol"><pre class="sl-code">${highlightPy(code)}</pre>${runBtn(k, ans, out)}</div>`;
    if (sl.t === 'title') {
      return `<div class="sl sl-title"><div class="sl-title-main"><div class="crs-kicker">${esc(sl.k || 'Egeshka · курс ЕГЭ')}</div><h3>${esc(sl.h)}</h3><p>${esc(sl.sub || '')}</p>
        ${(sl.chips || []).length ? `<div class="sl-chips">${sl.chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>` : ''}</div>
        ${sl.aside ? `<div class="sl-title-aside">${safeHtml(sl.aside)}</div>` : ''}</div>`;
    }
    if (sl.t === 'section') {
      return `<div class="sl sl-section"><div class="sl-k ${sl.kc || ''}">${esc(sl.k)}</div><h3>${esc(sl.h)}</h3><p>${esc(sl.sub || '')}</p>
        ${sl.tag ? `<code class="sl-tag">${esc(sl.tag)}</code>` : ''}</div>`;
    }
    if (sl.t === 'code' && sl.cond != null) {
      return `<div class="sl">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-split${sl.wide ? ' wide' : ''}${sl.stack ? ' stack' : ''}">
        <div class="sl-left"><div class="sl-cond"><div class="sl-cond-h">${esc(sl.ch || 'Условие')}</div>${safeHtml(sl.cond)}</div>
          ${sl.note ? `<div class="sl-nuance ${sl.kc || ''} ${sl.nk ? 'nk-' + sl.nk : ''}">${sl.nk === 'warn' ? '<b class="nk">⚠ Осторожно.</b> ' : sl.nk === 'secret' ? '<b class="nk">💡 Секрет.</b> ' : ''}${safeHtml(sl.note)}</div>` : ''}</div>
        ${codeBox(sl.code, 0, sl.ans, sl.out)}</div></div>`;
    }
    if (sl.t === 'solve') {
      // задача без программы: условие → «Показать решение» (шаги) → «Показать ответ»
      const ans = sl.ans ? `<details class="sl-ansbox"><summary>Показать ответ</summary><span class="sl-ok"><i aria-hidden="true">✓</i>Ответ: <b>${esc(sl.ans)}</b></span></details>` : '';
      return `<div class="sl">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-split${sl.stack ? ' stack' : ''}">
        <div class="sl-left"><div class="sl-cond"><div class="sl-cond-h">${esc(sl.ch || 'Задание')}</div>${safeHtml(sl.cond)}</div>
          ${sl.note ? `<div class="sl-nuance ${sl.kc || ''} ${sl.nk ? 'nk-' + sl.nk : ''}">${sl.nk === 'warn' ? '<b class="nk">⚠ Осторожно.</b> ' : sl.nk === 'secret' ? '<b class="nk">💡 Секрет.</b> ' : ''}${safeHtml(sl.note)}</div>` : ''}</div>
        <div class="sl-solcol"><details class="sl-sol"${sl.open ? ' open' : ''}><summary>Показать решение</summary><div class="sl-sol-body">${safeHtml(sl.sol)}</div></details>${ans}</div></div></div>`;
    }
    if (sl.t === 'codes') {
      return `<div class="sl">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-blocks n${sl.blocks.length}">${sl.blocks.map((b, k) =>
        `<div class="sl-block"><p>${safeHtml(b.cond)}</p>${codeBox(b.code, k, b.ans, b.out)}</div>`).join('')}</div></div>`;
    }
    const code = sl.t === 'code' ? `<pre class="sl-code">${highlightPy(sl.code)}</pre>${runBtn(0, sl.ans, sl.out)}` : '';
    return `<div class="sl${sl.dark ? ' sl-dark' : ''}">${kick}<h3 class="sl-h">${esc(sl.h)}</h3><div class="sl-body">${safeHtml(sl.html || '')}${code}</div></div>`;
  }
  function renderDeck() {
    const box = $('#crsDeck');
    if (!box || !appState.DECK) return;
    const sl = appState.DECK.slides;
    appState.deckI = Math.max(0, Math.min(appState.deckI, sl.length - 1));
    box.querySelector('.crs-stage').innerHTML = slideHtml(sl[appState.deckI], appState.deckI);
    if (MARK.on || MARK.strokes.has(`deck:${appState.DECK.n}:${appState.deckI}`)) markAttach();   // рисунок этого слайда
    box.querySelector('.crs-count').textContent = `${appState.deckI + 1} / ${sl.length}`;
    const chapters = $('#crsChapter');
    if (chapters) {
      for (const option of chapters.options) {
        if (+option.value > appState.deckI) break;
        chapters.value = option.value;
      }
    }
    deckSeen(appState.deckI + 1, sl.length);
    learningRememberSlide();
    box.querySelector('[data-deck="-1"]').disabled = appState.deckI === 0;
    box.querySelector('[data-deck="1"]').disabled = appState.deckI === sl.length - 1;
    box.querySelectorAll('.crs-thumb').forEach((t, k) => t.classList.toggle('on', k === appState.deckI));
    box.querySelector('.crs-thumb.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderMath(box.querySelector('.crs-stage'));
    fitSlide();
  }
  function deckGo(d) { appState.deckI += d; renderDeck(); }
  // докуда долистал презентацию — учитель видит в прогрессе курса (отправляем только новый максимум)
  const confirmedSlides = new Map();
  function deckSeen(k, total) {
    if (!SERVER || !appState.student || !appState.DECK || appState.DECK.pyc) return;
    const n = appState.DECK.n, current = learningSessionGuard();
    if (k <= (confirmedSlides.get(n) || 0)) return;
    api('course/seen', { n, slide: k, total }).then(() => {
      if (current()) confirmedSlides.set(n, Math.max(k, confirmedSlides.get(n) || 0));
    }).catch(() => {});
  }
  // масштаб слайда: на весь экран — подгоняем под экран; кнопки − / + меняют размер вручную
  let DECK_SCALE = 1;
  try { DECK_SCALE = +localStorage.getItem('egeTrainer.deckScale') || 1; } catch (e) { /* нет доступа */ }
  const DECK_W = 960;                                    // «расчётная» ширина слайда для полноэкранного режима
  /** Размер слайда. Обычный вид — масштаб кнопками − / +; на весь экран — по ширине экрана, и масштаб больше 100 %
      не раздвигает слайд шире экрана: текст крупнее, а слайд уже и прокручивается вниз.
      data-w — сколько места у слайда в его собственных пикселях: по нему колонки складываются в одну (CSS ниже). */
  function fitSlide() {
    const deck = $('#crsDeck'), stage = deck && deck.querySelector('.crs-stage'), sl = stage && stage.querySelector('.sl');
    if (!sl) return;
    sl.style.zoom = '';
    sl.style.width = '';
    // раскладка под ширину inner (в «своих» пикселях слайда): data-w для колонок; код не помещается — пара колонок
    // складывается в одну, не хватает и так — код чуть мельче
    const layout = inner => {
      sl.dataset.w = inner < 520 ? 'xs' : inner < 840 ? 'sm' : inner < 1180 ? 'md' : 'lg';
      const wide = c => c.scrollWidth > c.clientWidth + 3;
      sl.querySelectorAll('.sl-split, .sl-blocks').forEach(g => g.classList.remove('one'));
      sl.querySelectorAll('.sl-code').forEach(c => c.classList.remove('tight'));
      sl.querySelectorAll('.sl-split, .sl-blocks').forEach(g => { if ([...g.querySelectorAll('.sl-code')].some(wide)) g.classList.add('one'); });
      sl.querySelectorAll('.sl-code').forEach(c => { if (wide(c)) c.classList.add('tight'); });
    };
    if (document.fullscreenElement !== deck) {
      if (DECK_SCALE !== 1) sl.style.zoom = DECK_SCALE;
      layout((stage.clientWidth - 4) / DECK_SCALE);
      return;
    }
    // на весь экран: масштаб меняет «расчётную» ширину слайда (130 % — слайд уже, текст крупнее),
    // а потом слайд целиком вписывается в экран и по ширине, и по высоте — ничего не уезжает за край
    const W = stage.clientWidth - 8, H = stage.clientHeight - 8;
    const fit = inner => { sl.style.width = inner + 'px'; layout(inner); return Math.min(W / inner, H / sl.scrollHeight); };
    // пробуем несколько ширин и берём ту, где текст крупнее всего: короткий слайд — узкий и крупный,
    // три программы рядом — широкий, чтобы они не встали столбиком и не уменьшились
    const base = Math.max(560, Math.min(1400, DECK_W / DECK_SCALE));
    let best = null;
    for (const w of [...new Set([base, 960, 1200, 1400].filter(w => w >= base))]) {
      const z = fit(w);
      if (!best || z > best.z * 1.04) best = { w, z };
    }
    fit(best.w);                                                     // раскладка — под выбранную ширину
    sl.style.zoom = Math.max(0.5, best.z);
  }
  function deckZoom(d) {
    DECK_SCALE = d ? Math.round(Math.min(1.8, Math.max(0.6, DECK_SCALE + d * 0.1)) * 10) / 10 : 1;
    try { localStorage.setItem('egeTrainer.deckScale', DECK_SCALE); } catch (e) { /* нет доступа */ }
    fitSlide();
    const lbl = $('#deckZoomLbl');
    if (lbl) lbl.textContent = Math.round(DECK_SCALE * 100) + '%';
  }
  document.addEventListener('fullscreenchange', () => setTimeout(fitSlide, 50));
  window.addEventListener('resize', () => { if ($('#crsDeck')) fitSlide(); });
  document.fonts?.ready.then(() => { if ($('#crsDeck')) fitSlide(); });   // моноширинный шрифт догрузился — ширина кода другая
  let courseLessonRequest = 0;
  async function openLesson(n, slide) {
    if (!appState.COURSE_OK) return openCourse();
    abandonCurrent();
    if (!leaveExam()) return;
    appState.courseShown = true; appState.pageKind = null; appState.cur = null;
    const request = ++courseLessonRequest, current = learningSessionGuard();
    learningMemory({ course: n });
    navPush({ v: 'lesson', n });
    appState.DECK = null;
    appState.deckI = 0;
    const counts = d => TASKS.filter(t => t.n === n && visible(t) && (!d || d.includes(t.d))).length;
    const mod = COURSE.findIndex(m => m.lessons.includes(n));
    $('#scopeInfo').innerHTML = `<span class="scope-title">Курс · №${numLabel(n)}</span>`;
    trainerEl.innerHTML = '<p class="fm-note" role="status">Загружаю урок…</p>';
    let lesson = null;
    try { lesson = await api('course/lesson?n=' + n); } catch (e) { if (!current() || request !== courseLessonRequest) return; if (e.status === 403) { appState.COURSE_OK = false; return openCourse(); } }
    if (!current() || !appState.courseShown || appState.pageKind !== null || request !== courseLessonRequest) return;
    const has = lesson && lesson.slides && lesson.slides.length;
    if (has) { appState.DECK = lesson; appState.deckI = Number.isInteger(slide) ? Math.max(0, Math.min(slide, has - 1)) : learningSlide(n); }
    const workshop = n === 24 ? 'm33' : n === 26 ? 'm26' : null;
    const chapters = has && workshop ? lesson.slides.flatMap((s, i) =>
      i === 0 || s.t === 'section' || s.chapter ? [{i, label: s.chapter || s.h}] : []) : [];
    const start = has ? lesson.slides.findIndex(s => s.startHere) : -1;
    const deck = has ? `<div class="crs-deck" id="crsDeck">
        <div class="crs-main"><div class="crs-stage"></div>
          <div class="crs-nav"><button type="button" class="btn ghost" data-deck="-1">← Назад</button><span class="crs-count"></span>
            ${MARK_BTN}
            <span class="crs-zoom"><button type="button" class="icon-btn" data-deck-zoom="-1" title="Мельче">−</button>
              <button type="button" class="link-btn" data-deck-zoom="0" id="deckZoomLbl" title="Обычный размер">${Math.round(DECK_SCALE * 100)}%</button>
              <button type="button" class="icon-btn" data-deck-zoom="1" title="Крупнее">+</button></span>
            <button type="button" class="btn ghost crs-full" data-deck-full title="На весь экран">⤢</button>
            <button type="button" class="btn primary" data-deck="1">Далее →</button></div></div>
        <div class="crs-thumbs">${lesson.slides.map((t, i) => `<button type="button" class="crs-thumb" data-slide="${i}"><span>${i + 1}. ${esc(t.h)}</span></button>`).join('')}</div>
      </div>` : '<p class="fm-note">Не удалось загрузить теорию. Открой тему ещё раз; практика ниже доступна.</p>';
    trainerEl.innerHTML = `<div class="course lesson">
      <button type="button" class="link-btn crs-back" data-course-back>← К плану курса</button>
      <div class="crs-l-head"><span class="num-badge${badgeCls(n)}">${numLabel(n)}</span><div>${COURSE[mod].archive ? '<div class="crs-kicker">Архив · нет в КИМ ЕГЭ-2027</div>' : ''}
        <h2>№${numLabel(n)}. ${esc(NUM_TOPIC[n])}</h2></div></div>
      ${learningFormat}
      ${[7, 10, 19].includes(n) ? `<div class="learning-return"><button type="button" class="btn" data-learning-lab="${{7:'image',10:'net',19:'game'}[n]}">Исследовать в лаборатории →</button><span>Измени условия, проверь предположение и вернись к этой теме.</span></div>` : ''}
      <div class="fm-h">1. Теория${has ? ` · ${lesson.slides.length} слайдов` : ''}</div>
      ${chapters.length ? `<div class="crs-chapters"><label>Раздел теории <select class="inp" id="crsChapter" data-course-chapter>${chapters.map(c =>
        `<option value="${c.i}">${esc(c.label)}</option>`).join('')}</select></label>
        ${start >= 0 ? `<button type="button" class="btn" data-slide="${start}">${esc(lesson.slides[start].startLabel || lesson.slides[start].h)}</button>` : ''}</div>` : ''}
      ${deck}
      <div class="fm-h">2. Практика по уровням</div>
      ${workshop ? `<p><button type="button" class="btn" data-pyc-lv="${workshop}:0">${n === 24 ? 'Практика Python · регулярные выражения' : 'Практика Python · задачи №26'}</button>
        ${n === 26 ? '<button type="button" class="btn ghost" data-pyc-lv="m35:0">Практикум · журнал событий</button>' : ''}</p>` : ''}
      <div class="crs-sets">${COURSE_SETS.map((st, i) => {
        const a = courseSet(`crs-${n}-${st.key}`), total = a ? a.tasks.length : 0, done = total - asgLeft(a).length;
        return `<div class="crs-set${total && done === total ? ' done' : ''}"><span class="crs-set-ic">${st.icon}</span>
          <span class="crs-set-txt"><b>${i + 1}. ${st.name}</b><small>${(COURSE_SET_NOTES[n] || {})[st.key] || st.note}</small>
            <i class="xp-bar"><b style="width:${total ? pct(done / total) : 0}%"></b></i></span>
          <span class="crs-set-n">${total ? `решено ${done} из ${total}` : 'нет заданий'}</span>
          <button type="button" class="btn ${total && done < total ? 'primary' : 'ghost'}" data-course-set="${a ? a.id : ''}" ${total ? '' : 'disabled'}>${!total ? '—' : done === total ? 'Повторить' : done ? 'Продолжить' : 'Решать'}</button></div>`;
      }).join('')}</div>
      <p class="fm-note">Задания внутри подборки идут по порядку, сначала нерешённые. Решённое засчитывается и в тренажёре.</p>
      <button type="button" class="btn ghost" data-go-num="${n}">Все задания №${numLabel(n)} в тренажёре</button>
    </div>`;
    if (has) renderDeck();
    window.scrollTo(0, 0);
  }
  /** Страница подборки курса: все задания списком, видно решённые, любое можно открыть. */
  function openCourseSet(id) {
    const a = courseSet(id);
    if (!a) return;
    const objs = a.tasks.map(x => byId.get(x)).filter(Boolean);
    const request = ++courseLessonRequest, current = learningSessionGuard();
    appState.courseShown = true; appState.pageKind = null;
    navPush({ v: 'set', id });
    if (needHtml(objs)) { htmlWait(objs, () => { if (current() && request === courseLessonRequest && appState.courseShown && appState.pageKind === null) openCourseSet(id); }); return; }   // в списке подборки — начало условий
    const left = new Set(asgLeft(a)), total = a.tasks.length, done = total - left.size;
    const st = COURSE_SETS.find(x => id.endsWith('-' + x.key)) || {};
    // красным — задания, где была попытка, но верного ответа нет: их можно решить заново
    const tried = new Set(appState.P.log.filter(e => !e.b).map(e => e.id));
    const bad = tid => left.has(tid) && (tried.has(tid) || ((appState.P.tasks[tid] || {}).a > 0));
    const nBad = a.tasks.filter(bad).length;
    // начало у заданий одинаковое («На вход алгоритма подаётся…») — показываем само правило
    const snip = t => String(t.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
      .replace(/^\([^)]{0,40}\)\s*/, '')
      .replace(/^(На вход алгоритма пода[её]тся|Алгоритм получает на вход|Автомат (получает на вход|обрабатывает)|На вход программ[еы] пода[её]тся)[\s\S]{0,200}?(следующим образом|по следующим правилам|по следующему алгоритму|следующему алгоритму|по следующему правилу)[.:]?\s*/i, '')
      .replace(/^1[.)]\s*Строится [^.]*?(запись|число)[^.]*\.\s*/i, '')
      .replace(/^2[.)]\s*Далее эта запись обрабатывается по следующему правилу:?\s*/i, '')
      .slice(0, 170);
    $('#scopeInfo').innerHTML = `<span class="scope-title">Курс · №${numLabel(a.course)}</span><span class="scope-stats">${esc(st.name || '')}</span>`;
    trainerEl.innerHTML = `<div class="course">
      <button type="button" class="link-btn crs-back" data-lesson="${a.course}">← К уроку №${numLabel(a.course)}</button>
      <div class="crs-set-head"><span class="crs-set-ic big">${st.icon || '📘'}</span><div>        <h2>${esc(a.title)}</h2><small>${esc((COURSE_SET_NOTES[a.course] || {})[st.key] || st.note || '')}</small></div>
        <div class="crs-set-prog"><b>${done}</b><span>из ${total}</span><i class="xp-bar"><b style="width:${total ? pct(done / total) : 0}%"></b></i></div></div>
      <div class="crs-legend"><span class="ok">✓ верно: ${done}</span><span class="bad">✗ с ошибкой: ${nBad}</span><span>не начато: ${total - done - nBad}</span></div>
      <button type="button" class="btn primary crs-set-start" data-set-start="${esc(id)}">${done === total ? 'Решать заново' : done ? 'Продолжить с нерешённого' : 'Начать подборку'}</button>
      <div class="crs-tasks">${a.tasks.map((tid, k) => { const t = byId.get(tid); if (!t) return '';
        const ok = !left.has(tid), no = bad(tid);
        return `<button type="button" class="crs-task${ok ? ' ok' : no ? ' bad' : ''}" data-set-task="${esc(tid)}" data-set="${esc(id)}">
          <span class="crs-task-n">${ok ? '✓' : no ? '✗' : k + 1}</span><span class="crs-task-txt">${esc(snip(t))}…</span>
          <span class="crs-task-st">${ok ? 'верно' : no ? 'исправить →' : 'решать →'}</span></button>`; }).join('')}</div>
    </div>`;
    window.scrollTo(0, 0);
  }
  /** Код со слайда — в окно Python: можно запустить и поменять. */
  function slideToPy(ref) {
    const [i, k] = String(ref).split(':').map(Number);
    const sl = appState.DECK && appState.DECK.slides[i];
    const code = sl && (sl.blocks ? (sl.blocks[k || 0] || {}).code : sl.code);
    if (!code) return;
    if (appState.DECK.pyc) {                       // пример курса программирования: его файлы — рядом с кодом
      appState.PYC_PY = { id: `pyc:${appState.DECK.n}:${i}:${k || 0}`, n: 0, pyc: true, label: appState.DECK.label + ' · пример',
        att: (sl.files || []).map(f => ({ name: f.name, href: f.url })) };
    }
    if (appState.DECK.pyc && pyOpen()) pySync(); else togglePy(true);
    const ta = $('#pyCode');
    ta.value = code;
    $('#pyTask').textContent = appState.DECK.pyc ? appState.DECK.label + ' · пример' : `курс · №${appState.DECK.n}`;
    if (!appState.DECK.pyc) {                      // урок курса: файлы данных слайда кладём рядом с кодом — open('24.txt') работает
      const files = (sl.blocks ? (sl.blocks[k || 0] || {}).files : null) || sl.files || [];
      PY.task = files.length ? { id: `course:${appState.DECK.n}:${i}:${k || 0}`, n: 0, pyc: true, label: `курс · №${appState.DECK.n}`,
        att: files.map(f => ({ name: f.name, href: f.url })) } : null;
      $('#pyFiles').innerHTML = files.length ? 'Файлы рядом с кодом: ' + files.map(f => `<code>open('${esc(f.name)}')</code>`).join(' ') : '';
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.addEventListener('keydown', e => {
    if (!appState.courseShown || !appState.DECK || !$('#crsDeck') || e.target.closest('input, textarea, select')) return;
    if (!$('#forecastModal').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); deckGo(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); deckGo(-1); }
  });
  trainerEl.addEventListener('change', e => {
    if (e.target.matches('[data-course-chapter]') && appState.DECK) {
      appState.deckI = +e.target.value;
      renderDeck();
    }
  });
  trainerEl.addEventListener('click', e => {
    if (!appState.courseShown) return;
    const l = e.target.closest('[data-lesson]');
    if (l) { openLesson(+l.dataset.lesson); return; }
    if (e.target.closest('[data-course-back]')) { openCourse(); return; }
    const dg = e.target.closest('[data-deck]');
    if (dg) { deckGo(+dg.dataset.deck); return; }
    const th = e.target.closest('[data-slide]');
    if (th) { appState.deckI = +th.dataset.slide; renderDeck(); return; }
    const py = e.target.closest('[data-py-slide]');
    if (py) { slideToPy(py.dataset.pySlide); return; }
    const dz = e.target.closest('[data-deck-zoom]');
    if (dz) { deckZoom(+dz.dataset.deckZoom); return; }
    if (e.target.closest('[data-deck-full]')) {
      const d = $('#crsDeck');
      if (document.fullscreenElement) document.exitFullscreen(); else d?.requestFullscreen?.().catch(() => {});
      return;
    }
    const g = e.target.closest('[data-go-num]');
    if (g) setScope(+g.dataset.goNum);
    const cs = e.target.closest('[data-course-set]');
    if (cs && cs.dataset.courseSet && courseSet(cs.dataset.courseSet)) { openCourseSet(cs.dataset.courseSet); return; }
    const ss = e.target.closest('[data-set-start]');
    if (ss) {
      const a = courseSet(ss.dataset.setStart);
      setScope('asg', ss.dataset.setStart);
      if (a && appState.cur) navPush({ v: 'task', set: a.id, id: appState.cur.task.id });
      return;
    }
    const stk = e.target.closest('[data-set-task]');
    if (stk) {
      const a = courseSet(stk.dataset.set), t = byId.get(stk.dataset.setTask);
      if (a && t) openSetTask(a, t);
    }
  });
