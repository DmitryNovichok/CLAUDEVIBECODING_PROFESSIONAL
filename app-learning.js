// Собрано из src/app/*.js командой python3 tools/build_app.py — правьте модули, а не этот файл.
window.EgeLearningSections = function (bridge) {
  'use strict';
  const { $, $$, ARCHIVE, COURSE, COURSE_SETS, COURSE_SET_NOTES, EgePythonWorker, MARK, MARK_BTN, NUM_TOPIC, PY, PY_KW, RULES, SERVER, TASKS, abandonCurrent, api, appState, asgLeft, badgeCls, bdOpen, byId, codeKey, courseSet, esc, highlightPy, htmlWait, isNarrow, leaveExam, loadCourseSets, markAttach, navPush, needHtml, netError, numLabel, numStats, openSetTask, pct, plural, pyOpen, pySync, pycSetAccess, readCode, readJSON, renderMath, renderSidebar, safeHtml, setScope, setSideOpen, toast, toggleBoard, togglePy, trainerEl, visible, writeCode, writeJSON } = bridge;
  // ═══════ src/app/03b-course-ui.js
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
      ${deck}
      <div class="fm-h">2. Практика по уровням</div>
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
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    $('#pyTask').textContent = appState.DECK.pyc ? appState.DECK.label + ' · пример' : `курс · №${appState.DECK.n}`;
    if (!appState.DECK.pyc) {                      // урок курса: файлы данных слайда кладём рядом с кодом — open('24.txt') работает
      const files = (sl.blocks ? (sl.blocks[k || 0] || {}).files : null) || sl.files || [];
      PY.task = files.length ? { id: `course:${appState.DECK.n}:${i}:${k || 0}`, n: 0, pyc: true, label: `курс · №${appState.DECK.n}`,
        att: files.map(f => ({ name: f.name, href: f.url })) } : null;
      $('#pyFiles').innerHTML = files.length ? 'Файлы рядом с кодом: ' + files.map(f => `<code>open('${esc(f.name)}')</code>`).join(' ') : '';
    }
  }
  document.addEventListener('keydown', e => {
    if (!appState.courseShown || !appState.DECK || !$('#crsDeck') || e.target.closest('input, textarea, select')) return;
    if (!$('#forecastModal').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); deckGo(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); deckGo(-1); }
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

  // ═══════ src/app/12a-learning.js
  // Shared lesson navigation; drafts and cursor are scoped to the current account on this device.
  function learningMemory(patch) {
    const key = codeKey('learning-position'), raw = readJSON(key);
    const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (patch) { Object.assign(saved, patch); writeJSON(key, saved); }
    return saved;
  }
  function learningRememberSlide() {
    if (!appState.DECK) return;
    const saved = learningMemory(), slides = saved.slides || {};
    slides[appState.DECK.n] = appState.deckI; learningMemory({ slides });
  }
  function learningSlide(n) { const i = (learningMemory().slides || {})[n]; return Number.isInteger(i) && i >= 0 ? i : 0; }
  const learningFormat = '';   // служебная заметка о формате тем убрана со страниц (unslop U5); источник тем — в шапке курса
  function learningLabContext() {
    return appState.pageKind === 'pyc' && PYC_L ? { kind: 'pyc', m: PYC_L.id, l: PYC_L.l, task: PYC_FOCUS,
      label: PYC_L.title, code: '', stdin: '' } : { kind: 'course', n: appState.DECK?.n, label: appState.DECK?.label || 'Урок ЕГЭ', code: '', stdin: '' };
  }
  async function learningReturn() {
    const ctx = LAB.context; if (!ctx) return;
    labSaveDraft(); labStop(); LAB.context = null; LAB.owner = null;
    if (ctx.kind === 'pyc') { PYC_FOCUS = ctx.task; await openPycLevel(ctx.m, ctx.l, true); }
    else if (Number.isInteger(ctx.n)) await openLesson(ctx.n);
    else openCourse();
  }
  trainerEl.addEventListener('click', e => {
    if (e.target.closest('[data-learning-return]')) { learningReturn(); return; }
    const btn = e.target.closest('[data-learning-lab]');
    if (btn) {
      const ctx = learningLabContext();
      if (btn.dataset.learningLab === 'task') {
        const t = pycTask(btn.dataset.task); if (!t) return;
        ctx.task = t.id; ctx.label = t.h; ctx.condition = t.cond;
        ctx.code = PY.task?.id === 'pyc:' + t.id ? $('#pyCode').value : readCode('pyc:' + t.id) || t.practice?.starter || '';
        ctx.stdin = t.practice?.stdin || ''; ctx.files = t.files || [];
        openLab('code', ctx);
      } else { LAB.mode = btn.dataset.learningLab; openLab('tasks', ctx); }
      return;
    }
    const slide = e.target.closest('[data-learning-slide]');
    if (slide && appState.DECK) {
      const [i, k] = slide.dataset.learningSlide.split(':').map(Number), sl = appState.DECK.slides[i];
      const block = sl.t === 'codes' ? sl.blocks[k] : sl;
      const ctx = learningLabContext(); ctx.task = null; ctx.code = block.code; ctx.files = block.files || sl.files || []; ctx.label = sl.h;
      openLab('code', ctx);
    }
  });

  // ═══════ src/app/12b-pycourse.js
  // ------------------------------------------------------------ курс «Программирование для ЕГЭ» (закрытый)
  // Вход — по паролю курса, как у раздела «Курс» (пароль задаёт учитель). Модуль = тема, внутри лестница уровней:
  // следующий уровень открывается, когда в текущем решено need задач. Ответы проверяет сервер.
  let PYC_FOCUS = null, PYC_HELP = Promise.resolve(), pycLevelRequest = 0;
  const PYC_PENDING_HELP = new Map();
  let PYC = null;                        // план курса и прогресс с сервера
  let PYC_L = null;                      // открытый уровень
  const PYC_STARS = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
  const pycDone = id => !!((PYC && PYC.progress[id]) || {}).ok;
  const pycModDone = m => m.levels.reduce((a, lv) => a + lv.tasks.filter(pycDone).length, 0);
  const pycModTotal = m => m.levels.reduce((a, lv) => a + lv.tasks.length, 0);
  const pycLabel = m => (m.archive || ARCHIVE[m.n] ? `Архив · ${numLabel(m.n)}` : m.n ? `№${m.n === 19 ? '19–21' : m.n}` : m.id === 'm12' ? 'Архивная тема' : 'Старт');

  async function pycLoad() {
    const current = learningSessionGuard(), result = await api('pyc');
    if (!current()) return false;
    PYC = result;
    if (!PYC.access) { pycSetAccess(false, PYC.pw); return false; }
    pycSetAccess(true);
    return true;
  }
  function pycLock(msg) {
    $('#scopeInfo').innerHTML = '<span class="scope-title">Программирование</span>';
    if (msg || !appState.PYC_PW) {
      trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><div class="crs-lock-ic">🔒</div>
        <h2>Курс «Программирование для ЕГЭ» — по паролю</h2>
        <p>${esc(msg || 'Учитель ещё не открыл курс. Как только откроет — здесь появится поле для пароля.')}</p></div></div>`;
      return;
    }
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock">
      <div class="crs-lock-ic">🐍</div>
      <h2>Курс «Программирование для ЕГЭ» — по паролю</h2>
      <p>Пароль выдаёт учитель. Ввести его нужно один раз — дальше курс будет открыт на любом устройстве.</p>
      <form class="login-form crs-lock-form" id="pycPwForm" autocomplete="off">
        <input class="inp" id="pycPw" type="password" maxlength="200" placeholder="Пароль курса" autocomplete="off" required>
        <button class="btn primary" type="submit">Открыть курс</button>
      </form>
      <div class="login-err" id="pycPwMsg"></div>
    </div></div>`;
    $('#pycPw').focus();
    $('#pycPwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const current = learningSessionGuard(), m = $('#pycPwMsg');
      m.textContent = '';
      try {
        await api('pyc/unlock', { password: $('#pycPw').value });
        if (!current()) return;
        pycSetAccess(true);
        toast('Курс открыт 🐍', 2500);
        openPyc();
      } catch (err) { if (!current()) return; m.textContent = err.message || 'Не получилось — попробуйте ещё раз'; }
    });
  }
  function pycEnter() {
    if (!leaveExam()) return false;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    appState.courseShown = true;
    appState.pageKind = 'pyc';
    appState.cur = null;
    document.body.classList.add('asg-wide');
    return true;
  }

  /** План курса: модули по группам, у каждого — лестница уровней. */
  async function openPyc() {
    if (!pycEnter()) return;
    const request = ++pycLevelRequest, current = learningSessionGuard();
    navPush({ v: 'pyc' });
    PYC_L = null;
    try { await pycLoad(); } catch (e) { if (!current() || request !== pycLevelRequest) return; if (e.status !== 401) netError(e); return; }
    if (!current() || request !== pycLevelRequest || !appState.courseShown || appState.pageKind !== 'pyc') return;
    if (!PYC.access) { pycLock(); return; }
    const mods = PYC.modules;
    const all = mods.reduce((a, m) => a + pycModTotal(m), 0), done = mods.reduce((a, m) => a + pycModDone(m), 0);
    // «Продолжить»: первый модуль с нерешёнными задачами в открытом уровне (сначала тот, где уже начали)
    let cont = null;
    for (const m of [...mods].sort((a, b) => (pycModDone(b) > 0) - (pycModDone(a) > 0))) {
      const li = m.levels.findIndex((lv, i) => i < m.open && lv.tasks.some(t => !pycDone(t)));
      if (li >= 0 && (!cont || (pycModDone(m) > 0 && !pycModDone(cont.m)))) cont = { m, li };
      if (cont && pycModDone(cont.m) > 0) break;
    }
    const remembered = learningMemory().pyc;
    const rm = remembered && mods.find(m => m.id === remembered.m);
    if (rm && remembered.l < rm.open) cont = { m: rm, li: remembered.l };
    const card = m => {
      const d = pycModDone(m), t = pycModTotal(m);
      return `<div class="pyc-mod${d === t && t ? ' done' : ''}">
        <div class="pyc-mod-h"><span class="pyc-mod-ic">${m.icon}</span><div><span class="pyc-num">${pycLabel(m)}</span><b>${esc(m.title)}</b>
          <small>${esc(m.sub)}</small></div></div>
        <div class="pyc-ladder">${m.levels.map((lv, i) => {
          const ld = lv.tasks.filter(pycDone).length, lock = i >= m.open, full = ld === lv.tasks.length;
          return `<button type="button" class="pyc-step${lock ? ' lock' : full ? ' done' : ld ? ' go' : ''}" data-pyc-lv="${m.id}:${i}"
              title="${esc(lv.goal)}"${lock ? ' disabled' : ''}><i>${lock ? '🔒' : full ? '✓' : i + 1}</i><span><b>${esc(lv.title)}</b>
              <small>${lock ? `откроется после ${m.levels[i - 1].need} задач уровня ${i}` : `${ld} из ${lv.tasks.length}`}</small></span></button>`;
        }).join('')}</div>
        <i class="xp-bar"><b style="width:${t ? pct(d / t) : 0}%"></b></i></div>`;
    };
    const groups = [['base', 'Старт: язык Python', 'Если программируете впервые — начните отсюда'],
      ['ege', 'Задания ЕГЭ', 'Короткие разборы и практика по темам утверждённой демоверсии ЕГЭ-2027'],
      ['extra', 'Дополнительная практика', 'Архивные форматы: полезны для программирования, но не заменяют актуальную тему экзамена']];
    $('#scopeInfo').innerHTML = `<span class="scope-title">Программирование</span><span class="scope-stats">${done} из ${all} задач</span>`;
    trainerEl.innerHTML = `<div class="course pyc">
      <div class="crs-hero pyc-hero"><div><h2>Программирование для ЕГЭ</h2>
        <p>Python от первой строчки до сложных номеров: теория с примерами, которые можно запустить, и задачи с проверкой ответа.</p></div>
        <div class="crs-prog"><b>${done}</b><span>из ${all} задач решено</span><i class="xp-bar"><b style="width:${all ? pct(done / all) : 0}%"></b></i></div></div>
      ${learningFormat}
      ${cont ? `<button type="button" class="crs-continue" data-pyc-lv="${cont.m.id}:${cont.li}"><span>▶</span><span>
        <b>Продолжить: ${esc(pycLabel(cont.m))} · ${esc(cont.m.title)}</b><small>уровень ${cont.li + 1} · ${esc(cont.m.levels[cont.li].title)}</small></span></button>` : ''}
      ${groups.map(([g, h, sub]) => {
        const ms = mods.filter(m => (m.group || 'ege') === g);
        return ms.length ? `<div class="fm-h">${h}</div><p class="fm-note pyc-gsub">${sub}</p><div class="pyc-grid">${ms.map(card).join('')}</div>` : '';
      }).join('')}
    </div>`;
    window.scrollTo(0, 0);
  }

  /** Уровень: слайды (как в «Курсе») и задачи с проверкой. */
  async function openPycLevel(mid, li, keepScroll, task) {
    if (!pycEnter()) return;
    const request = ++pycLevelRequest, current = learningSessionGuard();
    navPush({ v: 'pycl', m: mid, l: li });
    let d;
    try {
      if (!PYC) await pycLoad();
      if (!current() || request !== pycLevelRequest) return;
      d = await api(`pyc/level?m=${encodeURIComponent(mid)}&l=${li}`);
    } catch (e) {
      if (!current() || request !== pycLevelRequest) return;
      if (e.status === 403) { if (PYC && PYC.access) { toast(e.message, 4000); return openPyc(); } pycLock(); return; }
      netError(e); return;
    }
    if (!current() || !appState.courseShown || appState.pageKind !== 'pyc' || request !== pycLevelRequest) return;
    const y = window.scrollY;
    PYC_L = d;
    const m = PYC.modules.find(x => x.id === mid) || { levels: [], open: 1 };
    const lv = d.level, has = lv.slides.length;
    appState.DECK = has ? { n: `pyc:${mid}:${li}`, label: `${pycLabel(d)} · уровень ${li + 1}`, pyc: true, slides: lv.slides } : null;
    if (!keepScroll) appState.deckI = learningSlide(`pyc:${mid}:${li}`);
    const saved = learningMemory().pyc;
    if (task && lv.tasks.some(t => t.id === task && !t.ok)) PYC_FOCUS = task;
    if (!lv.tasks.some(t => t.id === PYC_FOCUS)) PYC_FOCUS = saved?.m === mid && saved.l === li && lv.tasks.some(t => t.id === saved.task) ? saved.task : (lv.tasks.find(t => !t.ok) || lv.tasks[0]).id;
    learningMemory({ pyc: { m: mid, l: li, task: PYC_FOCUS } });
    const done = lv.tasks.filter(t => t.ok).length;
    $('#scopeInfo').innerHTML = `<span class="scope-title">Программирование · ${esc(pycLabel(d))}</span><span class="scope-stats">уровень ${li + 1} из ${d.levels}</span>`;
    trainerEl.innerHTML = `<div class="course lesson pyc">
      <button type="button" class="link-btn crs-back" data-pyc-home>← К плану курса</button>
      <div class="crs-l-head"><span class="pyc-mod-ic">${d.icon}</span><div>        <h2>Уровень ${li + 1}. ${esc(lv.title)}</h2><small class="pyc-goal">${esc(lv.goal)}</small></div></div>
      <div class="pyc-tabs">${m.levels.map((x, i) => `<button type="button" class="${i === li ? 'on' : ''}${i >= m.open ? ' lock' : ''}" data-pyc-lv="${mid}:${i}"
        ${i >= m.open ? 'disabled' : ''}>${i >= m.open ? '🔒 ' : ''}${i + 1}. ${esc(x.title)}</button>`).join('')}</div>
      ${mid === 'm24' ? '<button type="button" class="btn" data-pyc-lv="m33:0">Открыть тренажёр регулярных выражений</button>' : ''}
      ${has ? `<div class="fm-h">1. Теория · ${lv.slides.length} ${plural(lv.slides.length, 'слайд', 'слайда', 'слайдов')}</div>
      <div class="crs-deck" id="crsDeck">
        <div class="crs-main"><div class="crs-stage"></div>
          <div class="crs-nav"><button type="button" class="btn ghost" data-deck="-1">← Назад</button><span class="crs-count"></span>
            ${MARK_BTN}
            <span class="crs-zoom"><button type="button" class="icon-btn" data-deck-zoom="-1" title="Мельче">−</button>
              <button type="button" class="link-btn" data-deck-zoom="0" id="deckZoomLbl" title="Обычный размер">${Math.round(DECK_SCALE * 100)}%</button>
              <button type="button" class="icon-btn" data-deck-zoom="1" title="Крупнее">+</button></span>
            <button type="button" class="btn ghost crs-full" data-deck-full title="На весь экран">⤢</button>
            <button type="button" class="btn primary" data-deck="1">Далее →</button></div></div>
        <div class="crs-thumbs">${lv.slides.map((t, i) => `<button type="button" class="crs-thumb" data-slide="${i}"><span>${i + 1}. ${esc(t.h)}</span></button>`).join('')}</div>
      </div>` : ''}
      <div class="fm-h">${has ? '2. ' : ''}Задачи уровня · решено ${done} из ${lv.tasks.length}</div>
      ${li + 1 < d.levels ? `<p class="fm-note">${li + 1 < m.open ? '🔓 Следующий уровень уже открыт.' : `Решите ${lv.need} ${plural(lv.need, 'задачу', 'задачи', 'задач')} — откроется уровень ${li + 2}.`}</p>` : ''}
      <nav class="learning-tasks" aria-label="Задачи урока">${lv.tasks.map((t, i) => `<button type="button" class="btn${t.id === PYC_FOCUS ? ' primary' : ''}" data-pyc-focus="${esc(t.id)}" aria-pressed="${t.id === PYC_FOCUS}">${t.ok ? '✓ ' : ''}${i + 1}. ${esc(t.h)}</button>`).join('')}</nav>
      <div class="pyc-tasks">${lv.tasks.filter(t => t.id === PYC_FOCUS).map(t => pycTaskHtml(t, lv.tasks.indexOf(t))).join('')}</div>
      <p class="fm-note">Прогресс задач хранится в аккаунте. Код и место остановки — в этом браузере.</p>
      ${li + 1 < d.levels && li + 1 < m.open ? `<button type="button" class="btn primary pyc-next" data-pyc-lv="${mid}:${li + 1}">Уровень ${li + 2}: ${esc(m.levels[li + 1].title)} →</button>` : ''}
    </div>`;
    if (has) renderDeck();
    $$('.pyc-task .cond').forEach(el => { try { renderMath(el); } catch (e) { /* без формул */ } });
    window.scrollTo(0, keepScroll ? y : 0);
  }
  function pycFilesHtml(files) {
    return (files || []).length ? `<div class="files pyc-files"><span>Файлы:</span>${files.map(f =>
      `<a class="file" href="${esc(f.url)}" download="${esc(f.name)}">${esc(f.name)}<small>${f.size > 1024 ? Math.round(f.size / 1024) + ' КБ' : f.size + ' Б'}</small></a>`).join('')}</div>` : '';
  }
  function pycTaskHtml(t, i) {
    const st = t.ok ? 'ok' : t.tries ? 'bad' : '';
    return `<div class="pyc-task ${st}" id="pt-${esc(t.id.replace('.', '-'))}" data-pyc-task="${esc(t.id)}">
      <div class="pyc-th"><span class="pyc-tn">${t.ok ? '✓' : i + 1}</span><b>${esc(t.h)}</b><span class="pyc-stars" title="сложность">${PYC_STARS(t.stars || 1)}</span>
        <span class="pyc-st">${t.ok ? (t.independent ? 'решено самостоятельно' : t.solution_seen ? 'решено после разбора' : t.hint_used ? 'решено с подсказкой' : 'решено') : t.tries ? `попыток: ${t.tries}` : ''}</span></div>
      <div class="cond pyc-cond">${safeHtml(t.cond)}</div>
      ${pycFilesHtml(t.files)}
      ${t.practice ? `<div class="learning-practice"><b>Программа должна работать на разных данных</b><p>Первый ввод: <code>${esc(t.practice.stdin.trim())}</code>. Напиши программу, открой Python и проверь тесты. В поле ответа отправь вывод для первого ввода.</p><pre>${esc(t.practice.cases.map((c, i) => `Пример ${i+1}: ввод ${JSON.stringify(c.input.trim())} → ${c.output}`).join('\n'))}</pre></div>` : ''}
      ${t.regex ? pycRegexHtml(t) : `<div class="pyc-act">
        <button type="button" class="btn" data-pyc-py="${esc(t.id)}">▶ Решать в Python</button>
        <button type="button" class="btn" data-learning-lab="task" data-task="${esc(t.id)}">По шагам в лаборатории</button>
        ${t.practice ? `<button type="button" class="btn" data-pyc-tests="${esc(t.id)}">Проверить код на ${t.practice.cases.length} примерах</button>` : ''}
        <form class="pyc-form" data-pyc-form="${esc(t.id)}" autocomplete="off">
          <input class="inp pyc-ans" maxlength="300" placeholder="${t.ok ? 'Решено ✓' : 'Ответ'}" value="${t.ok && t.ans ? esc(t.ans) : ''}"${t.ok ? ' readonly' : ''}>
          ${t.ok ? '' : '<button type="submit" class="btn primary">Проверить</button>'}
        </form>
        <span class="pyc-msg" aria-live="polite"></span>
      </div>`}
      ${t.hint && !t.ok ? `<details class="pyc-more" data-pyc-help="hint" data-task="${esc(t.id)}"><summary>💡 Подсказка</summary><div>${safeHtml(t.hint)}</div></details>` : ''}
      ${t.note && t.ok ? `<div class="sl-nuance nk-secret"><b class="nk">💡 Секрет.</b> ${safeHtml(t.note)}</div>` : ''}
      ${t.sol ? pycSolHtml(t) : ''}
    </div>`;
  }
  function pycSolHtml(t) {
    return `<details class="pyc-more pyc-sol" data-pyc-help="solution" data-task="${esc(t.id)}"${t.ok ? '' : ''}><summary>${t.ok ? '📖 Эталонное решение' : '📖 Разбор (после трёх попыток)'}</summary>
      <pre class="sl-code">${highlightPy(t.sol)}</pre>
      <div class="sl-btns"><button type="button" class="btn ghost" data-pyc-sol="${esc(t.id)}">▶ Открыть разбор в Python</button>
        ${t.ok && t.ans && !t.regex ? `<span class="sl-ok"><i aria-hidden="true">✓</i>Ответ: <b>${esc(t.ans)}</b></span>` : ''}</div></details>`;
  }
  const pycTask = id => PYC_L && PYC_L.level.tasks.find(t => t.id === id);
  function pycPyTask(t, label) {
    return { id: 'pyc:' + t.id, n: PYC_L.n || 0, pyc: true, label, att: (t.files || []).map(f => ({ name: f.name, href: f.url })) };
  }
  /** Редактор Python для задачи курса: файлы задачи уже лежат рядом с кодом. */
  function pycOpenPy(id, code) {
    const t = pycTask(id);
    if (!t) return;
    const alreadyEditing = pyOpen() && PY.task?.id === 'pyc:' + id;
    const k = PYC_L.level.tasks.indexOf(t) + 1;
    appState.PYC_PY = pycPyTask(t, `${pycLabel(PYC_L)} · ур. ${PYC_L.l + 1} · задача ${k}`);
    if (pyOpen()) pySync(); else togglePy(true);
    if (t.practice && !alreadyEditing) {
      $('#pyIn').value = t.practice.stdin;
      if (code == null && readCode('pyc:' + id) == null) code = t.practice.starter || '';
    }
    if (code != null) {
      const ta = $('#pyCode');
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  async function pycCheck(id, form) {
    const inp = form.querySelector('.pyc-ans');
    const answer = inp.value.trim();
    if (!answer) { inp.focus(); return; }
    const pid = 'pyc:' + id;
    const code = PY.task && PY.task.id === pid ? $('#pyCode').value : readCode(pid);
    return pycSubmit(id, form, { answer, code: code || '' });
  }
  async function pycSubmit(id, form, data) {
    const box = form.closest('.pyc-task'), msg = box.querySelector('.pyc-msg');
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    const current = learningSessionGuard();
    let r;
    try {
      await pycFlushHelp();
      if (!current()) return;
      r = await api('pyc/check', { task: id, ...data });
    } catch (e) {
      if (!current() || !box.isConnected) return;
      if (btn) btn.disabled = false;
      msg.textContent = e.message || 'Не удалось сохранить ответ. Повтори попытку.';
      netError(e); return;
    }
    if (!current() || !box.isConnected) return;
    if (btn) btn.disabled = false;
    const t = pycTask(id);
    if (!t) return;
    t.tries = r.tries;
    PYC.progress[id] = { ok: r.ok || t.ok, tries: r.tries };
    if (r.sol) t.sol = r.sol;
    if (r.ok) {
      t.ok = true;
      t.ans = r.ans;
      toast(r.opened ? 'Верно. Открыт следующий уровень' : '✅ Верно!', r.opened ? 4000 : 2000);
      if (r.opened) { await pycLoad().catch(() => {}); }
      if (!current() || !PYC_L) return;
      openPycLevel(PYC_L.id, PYC_L.l, true);
      return;
    }
    if (!t.ok) {
      box.classList.add('bad');
      box.querySelector('.pyc-st').textContent = `попыток: ${r.tries}`;
    }
    if (r.mismatch && t.regex) msg.innerHTML = pycRegexMismatch(t, data.matches, r.mismatch);
    else msg.textContent = 'Неверно — проверьте программу и вопрос задачи';
    msg.className = 'pyc-msg bad';
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    if (r.sol && !box.querySelector('.pyc-sol')) box.insertAdjacentHTML('beforeend', pycSolHtml(t));
  }

  trainerEl.addEventListener('click', e => {
    if (!appState.courseShown || appState.pageKind !== 'pyc') return;
    const focus = e.target.closest('[data-pyc-focus]');
    if (focus && PYC_L) { PYC_FOCUS = focus.dataset.pycFocus; openPycLevel(PYC_L.id, PYC_L.l, true); return; }
    const tests = e.target.closest('[data-pyc-tests]');
    if (tests) { pycTestCode(tests.dataset.pycTests, tests); return; }
    const lv = e.target.closest('[data-pyc-lv]');
    if (lv && !lv.disabled) { const [m, l] = lv.dataset.pycLv.split(':'); openPycLevel(m, +l); return; }
    if (e.target.closest('[data-pyc-home]')) { openPyc(); return; }
    const py = e.target.closest('[data-pyc-py]');
    if (py) { pycOpenPy(py.dataset.pycPy); return; }
    const sol = e.target.closest('[data-pyc-sol]');
    if (sol) { const t = pycTask(sol.dataset.pycSol); if (t) pycOpenPy(t.id, t.sol); }
  });
  trainerEl.addEventListener('submit', e => {
    const f = e.target.closest('[data-pyc-form]');
    if (!f) return;
    e.preventDefault();
    pycCheck(f.dataset.pycForm, f);
  });
  trainerEl.addEventListener('input', e => {
    if (e.target.matches('.pyc-ans')) { const m = e.target.closest('.pyc-task').querySelector('.pyc-msg'); m.textContent = ''; m.className = 'pyc-msg'; }
  });
  /** Учитель задал пароль, закрыл курс всем или выключил его — замок и экран курса обновляются сразу. */
  function refreshLearningAccess(changed, pythonSettings) {
    if (!appState.courseShown) return;
    if (appState.pageKind === null && changed.course) {
      if (appState.COURSE_OK) openCourse();
      else { ++courseLessonRequest; appState.DECK = null; courseLock(); }
    }
    if (appState.pageKind === 'lab' && changed.lab) openLab(LAB.view);
    if (appState.pageKind === 'ardgate' && changed.arduino) openArdGate();
    if (appState.pageKind === 'pyc' && (changed.python || pythonSettings)) {
      if (!appState.PYC_OK) {
        if (changed.python) { ++pycLevelRequest; PYC_L = null; pycStopTests(); pycLock(); }
      } else if (!PYC_L || changed.python) openPyc();
    }
  }

  trainerEl.addEventListener('toggle', e => {
    const el = e.target;
    if (!el.open || !el.dataset.pycHelp || !el.dataset.task) return;
    const task = pycTask(el.dataset.task); if (!task) return;
    const field = el.dataset.pycHelp === 'hint' ? 'hint_used' : 'solution_seen';
    if (task[field]) return;
    PYC_PENDING_HELP.set(task.id + ':' + field, { sid: appState.student?.sid, task, kind: el.dataset.pycHelp, field });
    pycFlushHelp().catch(() => toast('Не удалось сохранить использование подсказки. Проверь подключение.', 4000));
  }, true);
  function pycFlushHelp() {
    const current = learningSessionGuard();
    PYC_HELP = PYC_HELP.catch(() => {}).then(async () => {
      if (!current()) return;
      for (const [key, item] of PYC_PENDING_HELP) {
        if (item.sid !== appState.student?.sid) { PYC_PENDING_HELP.delete(key); continue; }
        await api('pyc/help', { task: item.task.id, kind: item.kind });
        if (!current()) return;
        if (item.sid !== appState.student?.sid || PYC_PENDING_HELP.get(key) !== item) continue;
        item.task[item.field] = true; PYC_PENDING_HELP.delete(key);
      }
    });
    return PYC_HELP;
  }
  let PYC_TEST = null;
  function pycStopTests() { if (PYC_TEST) PYC_TEST.cancel(); }
  async function pycTestCode(id, button) {
    if (PYC_TEST) { toast('Дождись завершения текущей проверки.', 2500); return; }
    const task = pycTask(id); if (!task?.practice) return;
    pycOpenPy(id);
    const code = $('#pyCode').value, box = button.closest('.pyc-task'), msg = box.querySelector('.pyc-msg');
    if (!code.trim()) { msg.textContent = 'Сначала напиши программу в редакторе Python.'; return; }
    const status = text => { msg.textContent = text; if (PY.task?.id === 'pyc:' + id) $('#pycDockStatus').textContent = text; };
    button.disabled = true; $('#pycDockTests').disabled = true; $('#pycDockStop').hidden = false; status('Загружаю Python для учебной проверки…');
    let worker;
    try { worker = new EgePythonWorker('py-worker.js' + (RULES.py_local ? '?local=1' : '')); }
    catch (err) { button.disabled = false; $('#pycDockTests').disabled = false; $('#pycDockStop').hidden = true; status('Браузер не смог запустить проверку Python.'); return; }
    let timer, index = 0, passed = 0, output = '', error = '', finished = false;
    const finish = text => {
      if (finished) return; finished = true; clearTimeout(timer); worker.terminate(); PYC_TEST = null;
      $('#pycDockTests').disabled = false; $('#pycDockStop').hidden = true;
      if (button.isConnected) { button.disabled = false; status(text); }
    };
    PYC_TEST = { button, cancel: () => finish('Проверка остановлена.') };
    const norm = value => String(value).trim().replace(/\s+/g, ' ');
    const next = () => {
      if (!button.isConnected) { finish('Проверка остановлена.'); return; }
      const test = task.practice.cases[index]; output = ''; error = '';
      clearTimeout(timer); timer = setTimeout(() => finish(`Пример ${index+1}: остановлено через 5 секунд. Проверь цикл.`), 5000);
      worker.postMessage({ type: 'run', code, files: (task.files || []).map(f => ({ name: f.name, url: f.url })), stdin: test.input });
      status(`Проверяю пример ${index+1} из ${task.practice.cases.length}…`);
    };
    timer = setTimeout(() => finish('Не удалось загрузить Python. Проверь интернет и повтори.'), 90000);
    worker.onmessage = e => {
      const m = e.data; if (finished) return;
      if (m.type === 'ready') { next(); return; }
      if (m.type === 'out') output += m.text;
      if (m.type === 'err') error += m.text;
      if (output.length + error.length > 8000) { finish('Слишком много вывода. Проверь цикл и print().'); return; }
      if (m.type !== 'done') return;
      const test = task.practice.cases[index];
      if (!m.ok || error) { finish(`Пример ${index+1}: ошибка. ${error.slice(0, 700) || 'Python не загрузился или выполнение прервано.'}`); return; }
      if (norm(output) !== norm(test.output)) { finish(`Пример ${index+1}: ожидалось «${test.output}», получено «${output.trim()}». Исправь программу.`); return; }
      passed++; index++;
      if (index === task.practice.cases.length) finish(`Учебная проверка: ${passed} из ${index} примеров пройдены. Для зачёта отправь ответ для первого ввода.`);
      else next();
    };
    worker.onerror = () => finish('Не удалось запустить Python. Повтори проверку.');
  }
  new MutationObserver(() => { if (PYC_TEST && !PYC_TEST.button.isConnected) pycStopTests(); }).observe(trainerEl, { childList: true });
  window.addEventListener('pagehide', pycStopTests);

  function pycDockTools(t) {
    const task = t?.pyc && pycTask(t.id.slice(4)), tools = $('#pycDockTools');
    if (!tools) return;
    tools.hidden = !task;
    if (!task) return;
    $('#pycDockTests').hidden = !task.practice;
    $('#pycDockStatus').textContent = '';
  }
  $('#pycDockTests')?.addEventListener('click', () => { if (PY.task?.pyc) trainerEl.querySelector(`[data-pyc-tests="${CSS.escape(PY.task.id.slice(4))}"]`)?.click(); });
  $('#pycDockLab')?.addEventListener('click', () => { if (PY.task?.pyc) trainerEl.querySelector(`[data-learning-lab="task"][data-task="${CSS.escape(PY.task.id.slice(4))}"]`)?.click(); });
  $('#pycDockBack')?.addEventListener('click', () => togglePy(false));
  $('#pycDockStop')?.addEventListener('click', pycStopTests);
  $('#pyCode')?.addEventListener('input', () => {
    if (PYC_TEST) pycStopTests();
    if ($('#pycDockStatus')?.textContent) $('#pycDockStatus').textContent = 'Код изменён. Запусти проверку ещё раз.';
  });

  // ═══════ src/app/12c-regex.js
  // Python runs inside the existing disposable browser worker. Only match ranges reach the course grader.
  const PYC_REGEX_RUN = `import json, re
data = json.loads(input())
try:
    regex = re.compile(data['pattern'])
    rows = []
    for text in data['texts']:
        if data['mode'] == 'fullmatch':
            m = regex.fullmatch(text)
            spans = [m.span()] if m else []
        elif data['mode'] == 'overlap':
            if not regex.groups:
                raise ValueError('Помести фрагмент в первую захватывающую группу (…).')
            spans = [m.span(1) for m in regex.finditer(text)]
            if any(start < 0 for start, end in spans):
                raise ValueError('Первая группа должна захватывать фрагмент в каждом совпадении.')
        else:
            spans = [m.span() for m in regex.finditer(text)]
        rows.append(spans)
    print(json.dumps({'rows': rows}))
except (re.error, ValueError, OverflowError, RecursionError) as exc:
    print(json.dumps({'error': str(exc)}))`;

  function pycRegexRanges(text, spans) {
    const chars = [...text]; // Python indexes Unicode code points.
    const cuts = [...new Set([0, chars.length, ...spans.flat()])].sort((a, b) => a - b);
    const marked = cuts.slice(1).map((end, i) => {
      const start = cuts[i], part = esc(chars.slice(start, end).join(''));
      return spans.some(([a, b]) => a <= start && end <= b) ? `<mark>${part}</mark>` : part;
    }).join('');
    const parts = spans.slice(0, 16).map(([a, b]) =>
      `<code>[${a}:${b}] ${a === b ? '∅' : esc(chars.slice(a, b).join(''))}</code>`);
    if (spans.length > parts.length) parts.push(`… ещё ${spans.length - parts.length}`);
    return `<samp class="pyc-re-text">${marked || '∅'}</samp>
      <div class="pyc-re-spans">${parts.join(' ') || 'Совпадений нет'}</div>`;
  }

  function pycRegexHtml(t) {
    const spec = t.regex, example = spec.samples[0];
    const method = {finditer: 're.finditer · m.span()', overlap: 're.finditer · m.span(1)', fullmatch: 're.fullmatch'}[spec.mode];
    return `<form class="pyc-re" data-pyc-regex="${esc(t.id)}" autocomplete="off">
      <div class="pyc-re-example"><b>Ожидаемые совпадения</b>${pycRegexRanges(example, spec.example_spans)}</div>
      <fieldset><label>Шаблон Python re <small>${method}</small>
        <input class="inp" data-re-pattern maxlength="240" spellcheck="false" autocapitalize="off" required
          aria-describedby="re-pattern-help" value="${esc(readCode('pyc-re:' + t.id) || '')}"></label>
        <small id="re-pattern-help">Введи содержимое строки <code>r'…'</code> без кавычек.</small>
        <div class="pyc-re-actions"><button type="submit" class="btn primary">Проверить шаблон</button>
          <button class="btn" type="button" data-re-stop hidden>Остановить</button></div>
        <details class="pyc-more"><summary>Попробовать на своей строке</summary>
          <label>Строка для поиска<input class="inp" data-re-text maxlength="160" spellcheck="false" autocapitalize="off" value="${esc(example)}"></label>
          <button class="btn" type="button" data-re-preview>Показать совпадения</button></details>
      </fieldset>
      <div class="pyc-msg" aria-live="polite">${t.ok ? 'Задача зачтена. Можно попробовать другой шаблон.' : ''}</div>
    </form>`;
  }

  function pycRegexMismatch(t, actual, mismatch) {
    const index = mismatch.index, text = t.regex.samples[index];
    return `<b>Проверь строку ${index + 1} из ${t.regex.samples.length}</b>
      <div>Твой шаблон</div>${pycRegexRanges(text, actual[index])}
      <div>Ожидалось</div>${pycRegexRanges(text, mismatch.expected)}`;
  }

  function pycRunRegex(form, preview) {
    const id = form.dataset.pycRegex, t = pycTask(id);
    if (!t?.regex || !form.reportValidity()) return;
    if (PYC_TEST) { toast('Дождись завершения текущей проверки.', 2500); return; }
    const msg = form.querySelector('.pyc-msg'), pattern = form.querySelector('[data-re-pattern]').value;
    const texts = preview ? [form.querySelector('[data-re-text]').value] : t.regex.samples;
    const submit = form.querySelector('[type=submit]'), custom = form.querySelector('[data-re-preview]'), stop = form.querySelector('[data-re-stop]');
    let worker;
    try { worker = new EgePythonWorker('py-worker.js' + (RULES.py_local ? '?local=1' : '')); }
    catch { msg.textContent = 'Не удалось открыть Python в браузере. Повтори проверку.'; return; }
    submit.disabled = custom.disabled = true;
    stop.hidden = false;
    msg.className = 'pyc-msg'; msg.textContent = 'Загружаю Python…';
    const current = learningSessionGuard();
    let output = '', error = '', finished = false;
    let timer = setTimeout(() => finish('Не удалось загрузить Python. Повтори попытку.'), 90000);
    function finish(message) {
      if (finished) return;
      finished = true; clearTimeout(timer); worker.terminate(); PYC_TEST = null;
      submit.disabled = custom.disabled = false; stop.hidden = true;
      if (message) msg.textContent = message;
    }
    PYC_TEST = { button: submit, cancel: () => finish('Проверка остановлена.') };
    worker.onerror = () => finish('Не удалось запустить Python. Повтори попытку.');
    worker.onmessage = e => {
      if (finished) return;
      if (!form.isConnected || !current()) { finish(); return; }
      const m = e.data;
      if (m.type === 'ready') {
        clearTimeout(timer);
        timer = setTimeout(() => finish('Поиск остановлен по времени. Упрости вложенные повторы и попробуй снова.'), 5000);
        msg.textContent = 'Проверяю совпадения…';
        worker.postMessage({type: 'run', code: PYC_REGEX_RUN, stdin: JSON.stringify({pattern, mode: t.regex.mode, texts})});
      } else if (m.type === 'out') output += m.text;
      else if (m.type === 'err') error += m.text;
      else if (m.type === 'done') {
        finish();
        if (!m.ok || error) { msg.textContent = error.trim().slice(0, 400) || 'Не удалось выполнить поиск.'; return; }
        let r;
        try { r = JSON.parse(output); } catch { msg.textContent = 'Python вернул неполный результат. Повтори проверку.'; return; }
        if (r.error) { msg.textContent = 'Ошибка шаблона: ' + r.error; return; }
        if (preview) {
          const spans = r.rows[0], longest = Math.max(0, ...spans.map(([a, b]) => b - a));
          msg.innerHTML = `<b>Совпадений: ${spans.length}. Максимальная длина: ${longest}.</b>${pycRegexRanges(texts[0], spans)}`;
        } else {
          const fields = form.querySelector('fieldset');
          fields.disabled = true;
          msg.textContent = 'Сохраняю результат…';
          pycSubmit(id, form, { matches: r.rows, code: 'import re\npattern = re.compile(' + JSON.stringify(pattern) + ')' })
            .finally(() => { fields.disabled = false; });
        }
      }
    };
  }

  trainerEl.addEventListener('submit', e => {
    if (!e.target.matches('[data-pyc-regex]')) return;
    e.preventDefault(); pycRunRegex(e.target, false);
  });
  trainerEl.addEventListener('click', e => {
    const form = e.target.closest('[data-pyc-regex]');
    if (!form) return;
    if (e.target.closest('[data-re-stop]')) pycStopTests();
    if (e.target.closest('[data-re-preview]')) pycRunRegex(form, true);
  });
  trainerEl.addEventListener('input', e => {
    const form = e.target.closest('[data-pyc-regex]');
    if (!form) return;
    if (form.contains(PYC_TEST?.button || null)) pycStopTests();
    form.querySelector('.pyc-msg').textContent = '';
    if (e.target.matches('[data-re-pattern]')) writeCode('pyc-re:' + form.dataset.pycRegex, e.target.value);
  });

  // ═══════ src/app/12j-labs.js
  // ------------------------------------------------------------ лаборатории
  // Свободные эксперименты не влияют на журнал. В назначенной работе сохраняется первый прогноз.
  function labNetwork(address, prefix) {
    const parts = String(address).trim().split('.');
    if (parts.length !== 4 || parts.some(x => !/^\d{1,3}$/.test(x) || +x > 255) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw Error('Введите IPv4 из четырёх чисел 0–255 и маску от /0 до /32.');
    const ip = parts.reduce((n, x) => n * 256 + +x, 0), count = 2 ** (32 - prefix);
    const start = Math.floor(ip / count) * count;
    const format = n => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
    return { ip, prefix, count, start, end: start + count - 1, mask: format(2 ** 32 - count), network: format(start), last: format(start + count - 1), bits: ip.toString(2).padStart(32, '0') };
  }
  function labImageSize(width, height, depth) {
    if (![width, height, depth].every(Number.isInteger) || width < 1 || height < 1 || width > 8192 || height > 8192 || depth < 1 || depth > 24) throw Error('Размеры — целые числа от 1 до 8192, глубина цвета — от 1 до 24 бит.');
    const bits = width * height * depth;
    return { bits, bytes: Math.ceil(bits / 8), colors: 2 ** depth };
  }
  function labGameMoves(stones, target, add, factor) {
    if (![stones, target, add, factor].every(Number.isInteger) || stones < 1 || target < 2 || target > 200 || stones > 1000 || add < 1 || add > 20 || factor < 2 || factor > 5) throw Error('Проверьте параметры игры: цель 2–200, прибавление 1–20, множитель 2–5.');
    return stones >= target ? [] : [{ label: `+${add}`, value: stones + add }, { label: `×${factor}`, value: stones * factor }];
  }
  function labGamePositionMoves(position, target, add, factor) {
    if (!Array.isArray(position) || ![1, 2].includes(position.length)) throw Error('Нужна одна или две кучи.');
    position.forEach(n => labGameMoves(n, target, add, factor));
    if (position.reduce((a, b) => a + b, 0) >= target) return [];
    return position.flatMap((n, i) => labGameMoves(n, target, add, factor).map(m => ({
      label: `${position.length === 2 ? `Куча ${i + 1}: ` : ''}${m.label}`,
      value: position.map((v, j) => j === i ? m.value : v)
    })));
  }
  // ---- №15: логическое выражение с параметром A. Клетка x красная — при этом A выражение ложно (контрпример)
  const labImp = (a, b) => !a || b;
  const LAB_LOGIC = {
    div: { name: 'Делимость', expr: '¬ДЕЛ(x, A) → (ДЕЛ(x, 6) → ¬ДЕЛ(x, 4))', ask: 'max', a0: 5, aMax: 60, xMax: 120,
      note: 'ДЕЛ(x, A) — «x делится на A без остатка». Ищем наибольшее A, при котором нет ни одной красной клетки.',
      f: (x, a) => labImp(x % a !== 0, labImp(x % 6 === 0, x % 4 !== 0)),
      parts: (x, a) => [[`ДЕЛ(x, ${a})`, x % a === 0], ['ДЕЛ(x, 6)', x % 6 === 0], ['ДЕЛ(x, 4)', x % 4 === 0]] },
    bit: { name: 'Биты', expr: '(x & 53 ≠ 0) → ((x & 41 = 0) → (x & A ≠ 0))', ask: 'min', a0: 1, aMax: 63, xMax: 127,
      note: '& — поразрядная конъюнкция. Наведите на клетку — увидите x в двоичной записи. Ищем наименьшее A без красных клеток.',
      f: (x, a) => labImp((x & 53) !== 0, labImp((x & 41) === 0, (x & a) !== 0)),
      parts: (x, a) => [['x & 53 ≠ 0', (x & 53) !== 0], ['x & 41 = 0', (x & 41) === 0], [`x & ${a} ≠ 0`, (x & a) !== 0]] },
    seg: { name: 'Отрезки', expr: '((x ∈ P) ∧ ¬(x ∈ Q)) → (x ∈ A)', ask: 'len', P: [10, 35], Q: [25, 50], xMax: 60,
      note: 'P = [10; 35], Q = [25; 50], x — любое число, не только целое. Подберите концы отрезка A так, чтобы красных точек не осталось, и найдите наименьшую длину A.',
      f: (x, a, b) => labImp(x >= 10 && x <= 35 && !(x >= 25 && x <= 50), x >= a && x <= b) },
  };
  /** Ответ к модели №15 — тем же перебором, что в уроке курса (x — с запасом). */
  function labLogicAnswer(kind) {
    const m = LAB_LOGIC[kind];
    if (kind === 'seg') {
      const xs = Array.from({ length: 241 }, (_, i) => i / 4);
      let best = Infinity;
      for (let a = 0; a <= 60; a++) for (let b = a; b <= 60; b++) if (b - a < best && xs.every(x => m.f(x, a, b))) best = b - a;
      return best;
    }
    const ok = a => { for (let x = 1; x <= 2000; x++) if (!m.f(x, a)) return false; return true; };
    if (m.ask === 'min') { for (let a = 1; a <= 1000; a++) if (ok(a)) return a; return null; }
    let best = null; for (let a = 1; a <= 1000; a++) if (ok(a)) best = a; return best;
  }

  // ---- №23: ациклический граф. Значение в вершине — ответ «отсюда до конца»: количество путей, кратчайший или самый длинный путь
  const LAB_G = {
    v: { A: [0, 1], B: [1, 0], D: [1, 2], C: [2, 1], E: [3, 0], F: [3, 2], G: [4, 1], H: [5, 1] },
    e: [['A', 'B', 3], ['A', 'C', 5], ['A', 'D', 2], ['B', 'C', 1], ['B', 'E', 4], ['D', 'C', 2], ['D', 'F', 7], ['C', 'E', 2],
        ['C', 'F', 6], ['E', 'G', 3], ['E', 'H', 8], ['F', 'G', 1], ['F', 'H', 2], ['G', 'H', 4]],
    order: ['A', 'B', 'D', 'C', 'E', 'F', 'G', 'H'],          // топологический порядок: стрелки идут только вперёд
  };
  /** Значения «из вершины до end» в обратном топологическом порядке; banned — вершины, через которые нельзя. */
  function labGraphTo(kind, end, banned) {
    const val = {}, next = {}, steps = [];
    for (const v of [...LAB_G.order].reverse()) {
      if (banned.has(v)) { val[v] = null; steps.push(v); continue; }
      if (v === end) { val[v] = kind === 'count' ? 1 : 0; steps.push(v); continue; }
      let best = null;
      for (const [a, b, w] of LAB_G.e) {
        if (a !== v || val[b] == null || (kind === 'count' && val[b] === 0)) continue;
        if (kind === 'count') best = (best || 0) + val[b];
        else { const c = w + val[b]; if (best == null || (kind === 'short' ? c < best : c > best)) { best = c; next[v] = b; } }
      }
      val[v] = kind === 'count' ? best || 0 : best;
      steps.push(v);
    }
    return { val, next, steps };
  }
  /** Ответ: из start в end, через via (если задана), в обход banned. Для min/max — сам путь. */
  function labGraphSolve(kind, start, end, banned, via) {
    const seg = (a, b) => { const r = labGraphTo(kind, b, banned); const path = [a]; if (kind !== 'count' && r.val[a] != null) while (path[path.length - 1] !== b) path.push(r.next[path[path.length - 1]]); return { r, v: r.val[a], path }; };
    if (!via || via === start || via === end) { const s1 = seg(start, end); return { answer: s1.v, path: s1.path, table: s1.r }; }
    const s1 = seg(start, via), s2 = seg(via, end);
    if (s1.v == null || s2.v == null || (kind === 'count' && (!s1.v || !s2.v))) return { answer: kind === 'count' ? 0 : null, path: [], table: s2.r, parts: [s1.v, s2.v] };
    return { answer: kind === 'count' ? s1.v * s2.v : s1.v + s2.v, path: [...s1.path, ...s2.path.slice(1)], table: s2.r, parts: [s1.v, s2.v] };
  }

  let labLoadId = 0;
  // Лаборатория Arduino — отдельное приложение (/arduino/) со своим паролем: пароль лабораторий его не открывает
  async function openArdGate() {
    if (!leaveExam()) return;
    const ticket = ++labLoadId, current = learningSessionGuard();
    if (isNarrow()) setSideOpen(false);
    abandonCurrent(); appState.cur = null;
    appState.courseShown = true; appState.pageKind = 'ardgate';
    navPush({ v: 'ardgate' });
    renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория Arduino</span>';
    trainerEl.innerHTML = '<p class="fm-note">Проверяю доступ к лаборатории Arduino…</p>';
    try { const me = await api('me'); if (!current() || ticket !== labLoadId) return; appState.ARD_OK = !!me.ard; appState.ARD_PW = !!me.ard_pw; }
    catch (err) { if (!current() || ticket !== labLoadId) return; if (appState.pageKind === 'ardgate') { trainerEl.innerHTML = '<p class="fm-note">Не удалось проверить доступ. Попробуй ещё раз.</p>'; netError(err); } return; }
    if (!current() || ticket !== labLoadId || appState.pageKind !== 'ardgate' || !appState.courseShown) return;
    if (appState.ARD_OK) { location.replace('arduino/'); return; }
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><h2>Лаборатория Arduino — по паролю</h2>
      <p>${appState.ARD_PW ? 'Это отдельный раздел: пароль выдаёт учитель, он не совпадает с паролем лабораторий. После ввода доступ сохранится в твоём аккаунте.' : 'Учитель ещё не открыл лабораторию Arduino.'}</p>
      ${appState.ARD_PW ? '<form id="ardPasswordForm" class="login-form crs-lock-form"><input id="ardPassword" class="inp" type="password" maxlength="200" autocomplete="off" placeholder="Пароль лаборатории Arduino" aria-label="Пароль лаборатории Arduino" required><button class="btn primary">Открыть</button></form><p id="ardPasswordError" role="alert"></p>' : ''}</div></div>`;
    $('#ardPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.currentTarget.querySelector('button'), msg = $('#ardPasswordError'); btn.disabled = true;
      try { await api('arduino/unlock', { password: $('#ardPassword').value }); if (!current()) return; appState.ARD_OK = true; location.replace('arduino/'); }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  }
  function labLock(configured, view) {
    trainerEl.innerHTML = `<div class="course"><div class="crs-lock"><h2>Лаборатории — по паролю</h2>
      <p>${configured ? 'Пароль выдаёт учитель. После ввода доступ сохранится в твоём аккаунте.' : 'Учитель ещё не настроил доступ к лабораториям.'}</p>
      ${LAB.context ? '<button class="link-btn" type="button" data-learning-return>← Вернуться к уроку</button>' : ''}
      ${configured ? '<form id="labPasswordForm" class="login-form crs-lock-form"><input id="labPassword" class="inp" type="password" maxlength="200" autocomplete="off" placeholder="Пароль лабораторий" aria-label="Пароль лабораторий" required><button class="btn primary">Открыть</button></form><p id="labPasswordError" role="alert"></p>' : ''}</div></div>`;
    $('#labPasswordForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const current = learningSessionGuard(), form = e.currentTarget, btn = form.querySelector('button'), msg = $('#labPasswordError'); btn.disabled = true;
      try { await api('lab/unlock', { password: $('#labPassword').value }); if (current()) await openLab(view); }
      catch (err) { msg.textContent = err.message; btn.disabled = false; }
    });
  }
  const LAB_EXAMPLES = {
    sum: ['Сумма чисел', 'numbers = [4, 7, 2]\ntotal = 0\nfor x in numbers:\n    total += x\nprint(total)'],
    branch: ['Условие и цикл', 'for n in range(1, 6):\n    if n % 2 == 0:\n        result = n * n\n        print(n, result)'],
    list: ['Изменение списка', 'numbers = [3, 1, 4]\nfor i in range(len(numbers)):\n    numbers[i] *= 2\nprint(numbers)'],
    function: ['Вызовы функций', 'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nanswer = factorial(4)\nprint(answer)']
  };
  const LAB = { view: '', mode: 'net', worker: null, timeout: null, play: null, running: false, result: null, index: 0,
    code: '', stdin: '', owner: null, net: { ip: '192.168.1.130', prefix: 26 }, picture: { w: 640, h: 480, depth: 8 },
    context: null, bps: new Set(), seen: null, game: { start: 17, second: 29, heaps: 2, target: 133, add: 4, factor: 2, path: [[17, 29]] },
    logic: { kind: 'div', a: 5, segA: 5, segB: 20 },
    graph: { kind: 'count', start: 'A', end: 'H', via: '', banned: new Set(), shown: 99 } };
  const labActive = () => appState.courseShown && appState.pageKind === 'lab' && !!$('#labRoot');
  const labFmt = n => n.toLocaleString('ru-RU');
  const labIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg>';
  function labSaveDraft() { if (LAB.context) { LAB.context.code = LAB.code; LAB.context.stdin = LAB.stdin; if (LAB.context.task) writeCode('pyc:' + LAB.context.task, LAB.code); } else writeJSON(codeKey('laboratory'), { code: LAB.code, stdin: LAB.stdin }); }
  function labPause() { clearInterval(LAB.play); LAB.play = null; const b = $('#labPlay'); if (b) b.textContent = 'Воспроизвести'; }
  function labStop() {
    labPause();
    clearTimeout(LAB.timeout); LAB.timeout = null;
    if (LAB.worker) LAB.worker.terminate();
    LAB.worker = null; LAB.running = false;
  }
  async function openLab(view = '', context, target) {
    if (!leaveExam()) return;
    if (view === 'arduino') return openArdGate();       // у лаборатории Arduino — свой пароль
    if (!['', 'tasks', 'code', 'bugs'].includes(view)) view = '';
    labStop();
    if (LAB.owner && LAB.owner !== codeKey('laboratory')) LAB.context = null;
    if (context) LAB.context = context;
    if (LAB.owner !== codeKey('laboratory')) {
      const saved = readJSON(codeKey('laboratory'));
      LAB.code = saved && typeof saved.code === 'string' ? saved.code.slice(0, 30000) : LAB_EXAMPLES.sum[1];
      LAB.stdin = saved && typeof saved.stdin === 'string' ? saved.stdin.slice(0, 10000) : '';
      LAB.result = null; LAB.index = 0; LAB.owner = codeKey('laboratory');
    }
    if (isNarrow()) setSideOpen(false);
    if (pyOpen()) togglePy(false);
    if (bdOpen()) toggleBoard(false);
    abandonCurrent(); appState.cur = null;
    appState.courseShown = true; appState.pageKind = 'lab'; LAB.view = view;
    navPush({ v: 'lab', tab: view });
    const ticket = ++labLoadId, current = learningSessionGuard();
    if (SERVER) {
      trainerEl.innerHTML = '<p class="fm-note">Проверяю доступ к лабораториям…</p>';
      try {
        const access = await api('lab');
        if (!current() || ticket !== labLoadId || appState.pageKind !== 'lab' || !appState.courseShown) return;
        appState.LAB_OK = !!access.access;
        if (!appState.LAB_OK) { labLock(access.pw, view); return; }
        await loadCourseCoverage();
        if (!current() || ticket !== labLoadId || appState.pageKind !== 'lab' || !appState.courseShown) return;
      } catch (err) { if (current() && ticket === labLoadId && appState.pageKind === 'lab') { trainerEl.innerHTML = '<p class="fm-note">Не удалось проверить доступ. Открой лабораторию ещё раз.</p>'; netError(err); } return; }
    }
    if (context) { LAB.code = context.code || ''; LAB.stdin = context.stdin || ''; LAB.result = null; LAB.index = 0; }
    else if (LAB.context) { LAB.code = LAB.context.code || ''; LAB.stdin = LAB.context.stdin || ''; }

    if (view === 'tasks' && target && courseCoverage?.labs?.some(m => m.id === target)) LAB.mode = target;
    document.body.classList.add('lab-open');
    document.body.classList.remove('asg-wide');
    renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория</span><span class="scope-stats">Исследуй и проверяй идеи</span>';
    $('#sessionInfo').textContent = '';
    const titles = { '': ['Лаборатория', 'Меняй условия, проверяй гипотезы и разбирайся, как всё работает.'], tasks: ['Лаборатории по заданиям ЕГЭ', 'Сначала предположи результат. Затем проверь его на модели.'], code: ['Лаборатория программирования', 'Свой Python-код, значения переменных и выполнение по шагам.'] , bugs: ['Лаборатория исправления ошибок', 'Чужое решение не работает. Найди, что в нём не так, и почини.'] };
    const [title, sub] = titles[view];
    trainerEl.innerHTML = `<div class="lab" id="labRoot">
      ${LAB.context ? `<div class="learning-return"><button class="btn" type="button" data-learning-return>← Вернуться к уроку</button><span>${esc(LAB.context.label || 'Код и условие урока')}</span>${LAB.context.condition ? `<div class="cond">${safeHtml(LAB.context.condition)}</div>` : ''}</div>` : ''}
      ${view ? '<button type="button" class="link-btn lab-back" data-open-learning-group="labs">← Все лаборатории</button>' : ''}
      <header class="lab-header"><span class="lab-mark">${labIcon}</span><div><h1>${title}</h1><p>${sub}</p></div></header>
      ${view === 'tasks' ? labTasksHtml() : view === 'code' ? labCodeHtml() : view === 'bugs' ? bugLabHtml() : `<div class="lab-cards">
        <button type="button" class="lab-entry" data-lab-view="tasks"><span class="lab-kicker">${courseCoverage?.labs ? '№ ' + courseCoverage.labs.filter(m => !m.archive).map(m => esc(m.label)).join(' · ') : 'Модели заданий'}</span><h2>По заданиям ЕГЭ</h2><p>Алгоритмы над числами, изображения, подсети, логика, пары, игры, строки, маски, сортировка и кластеры — на наглядных моделях.</p><b>Начать эксперимент →</b></button>
        <button type="button" class="lab-entry" data-lab-view="code"><span class="lab-kicker">Python</span><h2>Программирование</h2><p>Смотри, какая строка выполняется, как меняются переменные и что выводит программа.</p><b>Открыть лабораторию →</b></button>
        ${SERVER ? '<button type="button" class="lab-entry" data-lab-view="bugs"><span class="lab-kicker">Python · поиск ошибок</span><h2>Исправление ошибок</h2><p>Задача и чужое решение: в нём ошибки, пропуск или оно слишком медленное. Почини код так, чтобы он прошёл все тесты.</p><b>Искать ошибки →</b></button>' : ''}</div>
        <p class="lab-note">Здесь можно пробовать и ошибаться: эксперименты не меняют оценки и награды за задания.</p>`}
      </div>`;
    if (view === 'tasks') labRenderModel();
    if (view === 'code') { if (LAB.result && !LAB.seen) labIndexSteps(); labPaintEditor(); labRenderStep(); }
    if (view === 'bugs') bugLabInit(target);
    if (SERVER && (view === 'tasks' || view === 'code')) {
      const activity = view === 'tasks' ? { section: 'model', model: LAB.mode } : { section: 'code' };
      api('lab/activity', activity).catch(() => {});  // статистика просмотра не блокирует работу модели
    }
    window.scrollTo(0, 0);
  }
  function labTasksHtml() {
    const models = courseCoverage?.labs || [['alg', 'Алгоритмы'], ['image', 'Изображения'], ['net', 'IP-сети'], ['logic', 'Логика'], ['pairs', 'Пары'], ['game', 'Игры'], ['str', 'Строки'], ['mask', 'Маски и делители'], ['sort', 'Сортировка'], ['clust', 'Кластеры'], ['graph', 'Графы']].map(([id, title]) => ({id, title}));
    return `<nav class="lab-tabs" aria-label="Эксперименты">${models.map(m => `<button type="button" class="btn${LAB.mode === m.id ? ' primary' : ''}" data-lab-model="${esc(m.id)}" aria-pressed="${LAB.mode === m.id}">${m.label ? `${m.archive ? 'Архив · ' : '№ '}${esc(m.label)} · ` : ''}${esc(m.title)}</button>`).join('')}</nav><p class="lab-note">${courseCoverage?.edition ? esc(courseCoverage.edition.label) + '. Архивные модели помечены отдельно.' : 'Справочник номеров сейчас недоступен; модели можно использовать без номера экзамена.'} Модели тренируют отдельные навыки, а условия экзамена могут быть сложнее.</p><div id="labModel"></div>`;
  }
  function recordLabPrediction(right) {
    if (right && SERVER && !appState.teacher) api('lab/activity', { section: 'model', model: LAB.mode, prediction: true }).catch(() => {});
  }
  function labPrediction(question) {
    return `<form class="lab-predict" id="labPredict"><div><b>Проверь предположение</b><p>${question}</p></div><label>Твой ответ<input class="inp" id="labGuess" aria-describedby="labFeedback" required inputmode="numeric" autocomplete="off" maxlength="20"></label><button class="btn" type="submit">Проверить</button><p id="labFeedback" class="lab-feedback" role="status"></p></form>`;
  }
  // ---------- Модели №5, 17, 24, 25, 26, 27. Каждая: html() — разметка, update() — пересчёт, answer() — ответ на «Проверь предположение».
  const lxRand = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const lxVal = id => $('#' + id)?.value ?? '';
  const lxNum = (id, lo, hi, def) => { const v = Math.round(+lxVal(id)); const ok = lxVal(id) !== '' && Number.isFinite(v) && v >= lo && v <= hi; $('#' + id)?.toggleAttribute('aria-invalid', !ok); return ok ? v : def; };
  const lxSel = (id, opts, cur) => `<select class="inp" id="${id}" data-lx>${opts.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const LX_RULES5 = {
    ones: { name: 'Чётность единиц', text: 'Строится двоичная запись N. Дважды: справа дописывается остаток от деления количества единиц на 2. Результат R переводится в десятичную систему.',
      run(n) { let b = n.toString(2); const parts = [[b, '']]; for (let i = 0; i < 2; i++) { const d = String([...b].filter(c => c === '1').length % 2); b += d; parts.push([b, d]); } return { bits: b, steps: parts.slice(1).map(([s, d], i) => `${i + 1}) единиц в ${s.slice(0, -1)}: ${[...s.slice(0, -1)].filter(c => c === '1').length} → дописываем ${d}`) }; } },
    parity: { name: 'Чётное / нечётное N', text: 'Строится двоичная запись N. Если N чётное — слева дописывается 10; если нечётное — слева 1 и справа 01. Результат R переводится в десятичную систему.',
      run(n) { const b = n.toString(2); return n % 2 === 0 ? { bits: '10' + b, steps: [`N = ${n} чётное → 10 + ${b}`] } : { bits: '1' + b + '01', steps: [`N = ${n} нечётное → 1 + ${b} + 01`] }; } },
    mod3: { name: 'Остаток от деления на 3', text: 'Строится двоичная запись N. Если N делится на 3 — справа дописываются три последние двоичные цифры; иначе — остаток от деления на 3, умноженный на 3, в двоичной записи.',
      run(n) { const b = n.toString(2); if (n % 3 === 0) return { bits: b + b.slice(-3), steps: [`N = ${n} делится на 3 → дописываем ${b.slice(-3)}`] }; const t = ((n % 3) * 3).toString(2); return { bits: b + t, steps: [`N = ${n}: остаток ${n % 3}, ${n % 3} × 3 = ${(n % 3) * 3} = ${t}₂ → дописываем`] }; } },
  };
  const LX_KINDS17 = { one: 'хотя бы одно делится на K', exactly: 'ровно одно делится на K', both: 'оба делятся на K' };
  const LX_TASKS24 = { same: 'Самая длинная цепочка одинаковых символов', alt: 'Самая длинная цепочка без двух одинаковых соседей', only: 'Самая длинная цепочка только из X и Y' };
  function lxLongest(s, kind) {
    let best = [0, 0], start = 0;
    for (let i = 0; i < s.length; i++) {
      const ok = kind === 'same' ? i > start && s[i] === s[i - 1] || i === start : kind === 'alt' ? i === start || s[i] !== s[i - 1] : /[XY]/.test(s[i]);
      if (!ok) start = kind === 'only' ? i + 1 : i;
      if (kind !== 'only' || ok) { const len = i - start + 1; if (len > best[1] - best[0]) best = [start, i + 1]; }
    }
    return best;
  }
  function lxMask(mask, d, limit) {
    // ? — ровно одна цифра, * — любая последовательность цифр, в том числе пустая. Перебор кандидатов по маске, затем проверка делимости.
    if (!/^[\d?*]{1,12}$/.test(mask) || (mask.match(/\*/g) || []).length > 1) throw Error('Маска: цифры, знаки ? и не больше одной *, до 12 символов.');
    const q = (mask.match(/\?/g) || []).length, star = mask.includes('*'), free = 10 - mask.replace(/[?*]/g, '').length - q;
    if (q > 4 || (star && q > 2)) throw Error('Слишком широкая маска для модели: не больше 4 знаков ? (с * — не больше 2).');
    const out = [], fill = (s, i) => {
      if (i === s.length) { if (s[0] !== '0' || s === '0') { const n = +s; if (n <= limit && n % d === 0) out.push(n); } return; }
      if (s[i] === '?') { for (let c = 0; c < 10; c++) fill(s.slice(0, i) + c + s.slice(i + 1), i + 1); return; }
      if (s[i] === '*') { for (let len = 0; len <= Math.min(q >= 2 ? 3 : 4, Math.max(0, free)); len++) for (let k = 0; k < 10 ** len; k++) fill(s.slice(0, i) + (len ? String(k).padStart(len, '0') : '') + s.slice(i + 1), i + (len ? len : 0)); return; }
      fill(s, i + 1);
    };
    fill(mask, 0);
    return [...new Set(out)].sort((a, b) => a - b);
  }
  function lxClusters(pts, eps) {
    const id = pts.map(() => -1); let k = 0;
    pts.forEach((_, s) => { if (id[s] >= 0) return; const st = [s]; id[s] = k;
      while (st.length) { const a = st.pop(); pts.forEach((p, b) => { if (id[b] < 0 && Math.hypot(p[0] - pts[a][0], p[1] - pts[a][1]) <= eps) { id[b] = k; st.push(b); } }); } k++; });
    const groups = Array.from({ length: k }, (_, c) => pts.filter((_, i) => id[i] === c));
    const centers = groups.map(g => g.reduce((best, p) => { const s = g.reduce((t, q) => t + Math.hypot(p[0] - q[0], p[1] - q[1]), 0); return s < best[1] ? [p, s] : best; }, [g[0], Infinity])[0]);
    return { id, groups, centers };
  }
  const LAB_EXTRA = {
    alg: {
      state: { rule: 'ones', n: 13, t: 100 },
      html() { const s = this.state; return `<section class="lab-panel"><h2>Как алгоритм превращает N в R?</h2>
        <div class="lab-tabs lab-subtabs">${Object.entries(LX_RULES5).map(([k, r]) => `<button type="button" class="btn${k === s.rule ? ' primary' : ''}" data-lx-act="rule" data-v="${k}">${r.name}</button>`).join('')}</div>
        <p class="lab-expr">${LX_RULES5[s.rule].text}</p>
        <div class="lab-fields"><label>N = <span id="lxNLabel">${s.n}</span><input type="range" id="lxN" data-lx min="1" max="128" value="${s.n}"></label><label>Порог для вопроса: R &gt;<input class="inp" type="number" id="lxT" data-lx min="1" max="100000" value="${s.t}"></label></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Какое наименьшее N даёт R больше порога?')}</section>`; },
      update() { const s = this.state; s.n = lxNum('lxN', 1, 128, s.n); s.t = lxNum('lxT', 1, 100000, s.t); $('#lxNLabel').textContent = s.n;
        const r = LX_RULES5[s.rule].run(s.n), b0 = s.n.toString(2);
        $('#lxOut').innerHTML = `<div class="lab-bits"><span class="lab-octet">${[...r.bits].map((c, i) => `<b class="${s.rule === 'parity' && s.n % 2 === 0 ? (i < 2 ? 'network' : 'host') : s.rule === 'parity' ? (i === 0 || i >= r.bits.length - 2 ? 'network' : 'host') : (i < b0.length ? 'host' : 'network')}">${c}</b>`).join('')}</span></div>
          <p class="lab-path">${r.steps.join('<br>')}</p>
          <dl class="lab-facts"><div><dt>N в двоичной</dt><dd>${s.n} = ${b0}₂</dd></div><div><dt>Результат R</dt><dd>${r.bits}₂ = ${parseInt(r.bits, 2)}</dd></div></dl>
          <p class="lab-note">Голубые цифры дописаны алгоритмом. В задании ЕГЭ обычно спрашивают наименьшее N, при котором R больше заданного числа: программа перебирает N подряд.</p>`; },
      answer() { const s = this.state; for (let n = 1; n < 1e6; n++) if (parseInt(LX_RULES5[s.rule].run(n).bits, 2) > s.t) return { expected: n, why: `При N = ${n}: R = ${parseInt(LX_RULES5[s.rule].run(n).bits, 2)} > ${s.t}, а при меньших N результат не больше порога.` }; return { expected: null, why: 'Подходящего N не нашлось.' }; },
    },
    pairs: {
      state: { seed: 17, kind: 'one', k: 3 },
      nums() { const r = lxRand(this.state.seed); return Array.from({ length: 14 }, () => 1 + Math.floor(r() * 99)); },
      html() { const s = this.state; return `<section class="lab-panel"><h2>Пары соседних чисел</h2>
        <p class="lab-note">Пара — два элемента, стоящие рядом. В файле ЕГЭ чисел тысячи, условие то же: перебрать i от 0 до n − 2 и проверить a[i], a[i + 1].</p>
        <div class="lab-fields"><label>Условие${lxSel('lxKind', Object.entries(LX_KINDS17), s.kind)}</label><label>K =<input class="inp" type="number" id="lxK" data-lx min="2" max="20" value="${s.k}"></label><button class="btn ghost" type="button" data-lx-act="new">Новые числа</button></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Сколько пар удовлетворяют условию?')}</section>`; },
      calc() { const s = this.state, a = this.nums(), d = x => x % s.k === 0;
        const ok = a.slice(1).map((y, i) => { const c = d(a[i]) + d(y); return s.kind === 'one' ? c >= 1 : s.kind === 'exactly' ? c === 1 : c === 2; }); return { a, ok }; },
      update() { const s = this.state; s.kind = lxVal('lxKind') || s.kind; s.k = lxNum('lxK', 2, 20, s.k);
        const { a, ok } = this.calc(), sums = a.slice(1).map((y, i) => a[i] + y).filter((_, i) => ok[i]);
        $('#lxOut').innerHTML = `<div class="lx-seq">${a.map((x, i) => `<span class="${x % s.k === 0 ? 'div' : ''}">${x}</span>${i < a.length - 1 ? `<i class="${ok[i] ? 'ok' : 'no'}" title="пара ${x} и ${a[i + 1]}">${ok[i] ? '✓' : '·'}</i>` : ''}`).join('')}</div>
          <dl class="lab-facts"><div><dt>Числа, кратные ${s.k}</dt><dd>${a.filter(x => x % s.k === 0).join(', ') || 'нет'}</dd></div><div><dt>Наибольшая сумма подходящей пары</dt><dd>${sums.length ? Math.max(...sums) : '—'}</dd></div></dl>
          <p class="lab-note">Выделены числа, кратные K. Галочка между числами — пара подходит.</p>`; },
      answer() { const { ok } = this.calc(), n = ok.filter(Boolean).length; return { expected: n, why: `Подходящих пар: ${n} из ${ok.length}. Всего пар на одну меньше, чем чисел.` }; },
    },
    str: {
      state: { task: 'same', s: 'XYZZZYXYXYYXZZZZYXYZYXXYXYXYZZYX' },
      html() { const st = this.state; return `<section class="lab-panel"><h2>Самая длинная подходящая цепочка</h2>
        <div class="lab-fields"><label>Что ищем${lxSel('lxTask', Object.entries(LX_TASKS24), st.task)}</label><button class="btn ghost" type="button" data-lx-act="new">Случайная строка</button></div>
        <label class="lx-wide">Строка из букв X, Y, Z<input class="inp" id="lxS" data-lx maxlength="80" spellcheck="false" value="${esc(st.s)}"></label>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Какова длина самой длинной подходящей цепочки?')}</section>`; },
      update() { const st = this.state; st.task = lxVal('lxTask') || st.task; const raw = lxVal('lxS').toUpperCase().replace(/[^XYZ]/g, ''); st.s = raw || st.s;
        $('#lxS').toggleAttribute('aria-invalid', !raw);
        const [a, b] = lxLongest(st.s, st.task);
        $('#lxOut').innerHTML = `<div class="lx-chars">${[...st.s].map((c, i) => `<b class="${i >= a && i < b ? 'on' : ''}">${c}</b>`).join('')}</div>
          <dl class="lab-facts"><div><dt>Найденная цепочка</dt><dd>${st.s.slice(a, b) || '—'}</dd></div><div><dt>Длина</dt><dd>${b - a}</dd></div></dl>
          <p class="lab-note">Один проход слева направо: держим длину текущей цепочки и обнуляем её, когда условие нарушено; максимум запоминаем. Так решают и для строки в миллион символов.</p>`; },
      answer() { const [a, b] = lxLongest(this.state.s, this.state.task); return { expected: b - a, why: `Цепочка ${this.state.s.slice(a, b)} начинается с позиции ${a + 1}.` }; },
    },
    mask: {
      state: { sub: 'mask', mask: '12??36*1', d: 317, n: 360 },
      html() { const st = this.state; return `<section class="lab-panel"><h2>${st.sub === 'mask' ? 'Числа по маске, кратные D' : 'Делители числа: перебор до корня'}</h2>
        <div class="lab-tabs lab-subtabs"><button type="button" class="btn${st.sub === 'mask' ? ' primary' : ''}" data-lx-act="sub" data-v="mask">Маска</button><button type="button" class="btn${st.sub === 'div' ? ' primary' : ''}" data-lx-act="sub" data-v="div">Делители</button></div>
        ${st.sub === 'mask' ? `<p class="lab-note">? — ровно одна цифра; * — любая последовательность цифр, возможно пустая. Числа не больше 10<sup>10</sup>, без ведущего нуля.</p>
          <div class="lab-fields"><label>Маска<input class="inp" id="lxM" data-lx maxlength="12" spellcheck="false" value="${esc(st.mask)}"></label><label>D =<input class="inp" type="number" id="lxD" data-lx min="2" max="100000" value="${st.d}"></label></div>`
        : `<p class="lab-note">Делители идут парами: d и N / d. Достаточно проверить d до √N — вторую половину даёт деление.</p>
          <div class="lab-fields"><label>N =<input class="inp" type="number" id="lxDN" data-lx min="2" max="1000000" value="${st.n}"></label></div>`}
        <div id="lxOut" aria-live="polite"></div>${labPrediction(st.sub === 'mask' ? 'Сколько чисел подходят под маску и делятся на D?' : 'Сколько делителей у числа N (включая 1 и N)?')}</section>`; },
      update() { const st = this.state;
        if (st.sub === 'div') { st.n = lxNum('lxDN', 2, 1000000, st.n); const r = Math.floor(Math.sqrt(st.n)), pairs = [];
          for (let d = 1; d <= r; d++) if (st.n % d === 0) pairs.push(d * d === st.n ? [d] : [d, st.n / d]);
          $('#lxOut').innerHTML = `<div class="lx-seq">${pairs.map(p => `<span class="div">${p.join(' · ')}</span>`).join('')}</div>
            <dl class="lab-facts"><div><dt>Проверено кандидатов</dt><dd>${r} (до √${st.n} ≈ ${Math.sqrt(st.n).toFixed(2)}) вместо ${st.n}</dd></div><div><dt>Все делители по возрастанию</dt><dd>${pairs.flatMap(p => [p[0]]).concat(pairs.slice().reverse().filter(p => p[1]).map(p => p[1])).join(', ')}</dd></div></dl>`; return; }
        st.mask = lxVal('lxM').trim() || st.mask; st.d = lxNum('lxD', 2, 100000, st.d); $('#lxM').removeAttribute('aria-invalid');
        try { const r = lxMask(st.mask, st.d, 1e10);
          $('#lxOut').innerHTML = `<div class="lx-chars">${[...st.mask].map(c => `<b class="${c === '?' || c === '*' ? 'on' : ''}">${c}</b>`).join('')}</div>
            <dl class="lab-facts"><div><dt>Найдено чисел</dt><dd>${r.length}</dd></div><div><dt>Первые числа и частные</dt><dd>${r.slice(0, 6).map(n => `${n} (${n / st.d})`).join('<br>') || 'нет'}${r.length > 6 ? '<br>…' : ''}</dd></div></dl>`;
        } catch (e) { $('#lxM').setAttribute('aria-invalid', 'true'); $('#lxOut').textContent = e.message; } },
      answer() { const st = this.state; if (st.sub === 'div') { let c = 0; for (let d = 1; d * d <= st.n; d++) if (st.n % d === 0) c += d * d === st.n ? 1 : 2; return { expected: c, why: 'Каждый делитель d ≤ √N даёт пару N / d; квадратный корень считается один раз.' }; }
        const r = lxMask(st.mask, st.d, 1e10); return { expected: r.length, why: r.length ? `Наименьшее: ${r[0]} = ${st.d} × ${r[0] / st.d}.` : 'Подходящих чисел нет.' }; },
    },
    sort: {
      state: { seed: 26, cap: 100 },
      sizes() { const r = lxRand(this.state.seed); return Array.from({ length: 12 }, () => 5 + Math.floor(r() * 40)); },
      solve() { const cap = this.state.cap, a = this.sizes().slice().sort((x, y) => x - y), take = []; let used = 0;
        for (const x of a) { if (used + x > cap) break; take.push(x); used += x; }
        // улучшаем: самый большой файл, который можно поставить вместо последнего взятого
        let big = take.length ? take[take.length - 1] : 0;
        if (take.length) { const rest = used - big, cand = a.filter((x, i) => i >= take.length - 1 && rest + x <= cap); big = Math.max(...cand); }
        return { a, take, used, count: take.length, big, total: take.length ? used - take[take.length - 1] + big : 0 }; },
      html() { const st = this.state; return `<section class="lab-panel"><h2>Сколько файлов поместится на диск?</h2>
        <p class="lab-note">Жадный приём из №26: чтобы файлов было больше всего, берём самые маленькие. Потом последний взятый файл заменяем самым большим, который ещё помещается, — так находят наибольший возможный размер файла при максимальном количестве.</p>
        <div class="lab-fields"><label>Объём диска: <span id="lxCapLabel">${st.cap}</span><input type="range" id="lxCap" data-lx min="20" max="250" value="${st.cap}"></label><button class="btn ghost" type="button" data-lx-act="new">Другие файлы</button></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Какое наибольшее количество файлов поместится на диск?')}</section>`; },
      update() { const st = this.state; st.cap = lxNum('lxCap', 20, 250, st.cap); $('#lxCapLabel').textContent = st.cap; const r = this.solve();
        const pct = x => (x / st.cap * 100).toFixed(2) + '%';
        $('#lxOut').innerHTML = `<div class="lx-seq">${r.a.map((x, i) => `<span class="${i < r.count ? 'div' : ''}">${x}</span>`).join('')}</div>
          <div class="lx-disk" role="img" aria-label="Занято ${r.used} из ${st.cap}">${r.take.map(x => `<i style="width:${pct(x)}">${x}</i>`).join('')}</div>
          <dl class="lab-facts"><div><dt>Файлов поместилось</dt><dd>${r.count} (занято ${r.used} из ${st.cap})</dd></div><div><dt>Наибольший возможный файл при этом</dt><dd>${r.count ? `${r.big}: замена ${r.take[r.count - 1]} → ${r.big}, итого ${r.total}` : '—'}</dd></div></dl>`; },
      answer() { const r = this.solve(); return { expected: r.count, why: `После сортировки по возрастанию помещаются ${r.take.join(' + ') || '0'} = ${r.used}; следующий файл уже не влезает.` }; },
    },
    clust: {
      state: { seed: 27, eps: 1.2 },
      points() { const r = lxRand(this.state.seed), c = [[2.5, 2.5], [7, 3], [4.5, 7.2]], pts = [];
        c.forEach(([x, y], k) => { for (let i = 0; i < 9 + k * 2; i++) pts.push([+(x + (r() - .5) * 2.6).toFixed(2), +(y + (r() - .5) * 2.4).toFixed(2)]); });
        return pts; },
      html() { const st = this.state; return `<section class="lab-panel"><h2>Кластеры и центроиды</h2>
        <p class="lab-note">Точки одного кластера соединены цепочкой соседей на расстоянии не больше R. Центроид — точка кластера с наименьшей суммой расстояний до остальных его точек (как в №27).</p>
        <div class="lab-fields"><label>R = <span id="lxEpsLabel">${st.eps}</span><input type="range" id="lxEps" data-lx min="0.3" max="4" step="0.1" value="${st.eps}"></label><button class="btn ghost" type="button" data-lx-act="new">Другие точки</button></div>
        <div id="lxOut" aria-live="polite"></div>${labPrediction('Сколько кластеров получится при этом R?')}</section>`; },
      update() { const st = this.state; st.eps = Math.max(.3, Math.min(4, +lxVal('lxEps') || st.eps)); $('#lxEpsLabel').textContent = st.eps.toFixed(1);
        const pts = this.points(), c = lxClusters(pts, st.eps), X = x => 20 + x * 46, Y = y => 470 - y * 46, col = i => `hsl(${(i * 137) % 360} 70% 45%)`;
        const avg = c.centers.length ? c.centers.reduce((s, p) => s + p[0], 0) / c.centers.length : 0;
        $('#lxOut').innerHTML = `<svg class="lx-plot" viewBox="0 0 500 490" role="img" aria-label="Точки на плоскости: ${c.groups.length} кластеров">
            ${[0, 2, 4, 6, 8, 10].map(t => `<line x1="${X(t)}" y1="${Y(0)}" x2="${X(t)}" y2="${Y(10)}"/><line x1="${X(0)}" y1="${Y(t)}" x2="${X(10)}" y2="${Y(t)}"/><text x="${X(t)}" y="${Y(0) + 16}">${t}</text>${t ? `<text x="${X(0) - 10}" y="${Y(t) + 4}">${t}</text>` : ''}`).join('')}
            ${pts.map((p, i) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="6" fill="${col(c.id[i])}"><title>(${p[0]}; ${p[1]})</title></circle>`).join('')}
            ${c.centers.map((p, i) => `<circle class="cen" cx="${X(p[0])}" cy="${Y(p[1])}" r="12" style="stroke:${col(i)}"/>`).join('')}</svg>
          <dl class="lab-facts"><div><dt>Кластеров</dt><dd>${c.groups.length}</dd></div><div><dt>Центроиды</dt><dd>${c.centers.map((p, i) => `(${p[0]}; ${p[1]}) — ${c.groups[i].length} точ.`).join('<br>')}</dd></div>
            <div><dt>Среднее X центроидов × 10000, целая часть</dt><dd>${Math.trunc(avg * 10000)}</dd></div></dl>
          <p class="lab-note">Маленький R дробит кластеры, большой — сливает их. В задании расстояние подбирают так, чтобы группы разделились так, как видно на графике.</p>`; },
      answer() { const n = lxClusters(this.points(), this.state.eps).groups.length; return { expected: n, why: `При R = ${this.state.eps.toFixed(1)} точки распадаются на ${n} групп${n === 1 ? 'у' : n < 5 ? 'ы' : ''}.` }; },
    },
  };
  function labRenderModel() {
    const box = $('#labModel'); if (!box) return;
    if (LAB_EXTRA[LAB.mode]) { box.innerHTML = LAB_EXTRA[LAB.mode].html(); LAB_EXTRA[LAB.mode].update(); return; }
    if (LAB.mode === 'net') {
      box.innerHTML = `<section class="lab-panel"><h2>Где заканчивается сеть и начинается адрес узла?</h2>
        ${appState.teacher ? '<p><a class="btn" href="/admin?assign=lab13">Назначить классу</a></p>' : ''}
        <div class="lab-fields"><label>IPv4-адрес<input class="inp" id="labIp" aria-describedby="labNetResult" value="${esc(LAB.net.ip)}" spellcheck="false" maxlength="15"></label><label>Маска /<span id="labPrefixLabel">${LAB.net.prefix}</span><input type="range" id="labPrefix" min="0" max="32" value="${LAB.net.prefix}"></label></div>
        <p class="lab-note">Голубые биты задают сеть, остальные — адрес внутри неё. Все адреса считаются вместе с адресом сети и широковещательным адресом.</p>
        <div id="labNetResult" aria-live="polite"></div>
        ${labPrediction('Сколько всего IPv4-адресов в этой подсети?')}</section>`;
      labUpdateNetwork();
    } else if (LAB.mode === 'image') {
      const p = LAB.picture;
      box.innerHTML = `<section class="lab-panel"><h2>Как глубина цвета влияет на объём?</h2><div class="lab-fields">
        <label>Ширина, пиксели<input class="inp" type="number" id="labWidth" aria-describedby="labImageResult" min="1" max="8192" value="${p.w}"></label>
        <label>Высота, пиксели<input class="inp" type="number" id="labHeight" aria-describedby="labImageResult" min="1" max="8192" value="${p.h}"></label>
        <label>Бит на пиксель: <span id="labDepthLabel">${p.depth}</span><input type="range" id="labDepth" aria-describedby="labImageResult" min="1" max="24" value="${p.depth}"></label></div>
        <div class="lab-image-demo"><canvas id="labCanvas" width="256" height="128" aria-label="Пример изменения палитры изображения"></canvas><div id="labImageResult" aria-live="polite"></div></div>
        <p class="lab-note">Модель без сжатия, заголовков и выравнивания строк. Биты упакованы подряд; итог округляется вверх до целого байта. Иллюстрация показывает изменение палитры, её размер на экране условный.</p>
        ${labPrediction('Сколько байт занимает это изображение?')}</section>`;
      labUpdateImage();
    } else if (LAB.mode === 'logic') {
      const L = LAB.logic, m = LAB_LOGIC[L.kind];
      box.innerHTML = `<section class="lab-panel"><h2>При каком A выражение истинно для любого x?</h2>
        <div class="lab-tabs lab-subtabs">${Object.entries(LAB_LOGIC).map(([k, x]) => `<button type="button" class="btn${k === L.kind ? ' primary' : ''}" data-lab-logic="${k}">${x.name}</button>`).join('')}</div>
        <p class="lab-expr">${m.expr}</p><p class="lab-note">${m.note}</p>
        <div class="lab-fields">${L.kind === 'seg'
          ? `<label>Начало A: <span id="labSegALabel">${L.segA}</span><input type="range" id="labSegA" min="0" max="60" value="${L.segA}"></label><label>Конец A: <span id="labSegBLabel">${L.segB}</span><input type="range" id="labSegB" min="0" max="60" value="${L.segB}"></label>`
          : `<label>A = <span id="labALabel">${L.a}</span><input type="range" id="labA" min="1" max="${m.aMax}" value="${L.a}"></label>`}</div>
        <div id="labLogicResult" aria-live="polite"></div>
        ${labPrediction(L.kind === 'seg' ? 'Какова наименьшая возможная длина отрезка A?' : `Какое ${m.ask === 'max' ? 'наибольшее' : 'наименьшее'} натуральное A подходит?`)}</section>`;
      labUpdateLogic();
    } else if (LAB.mode === 'graph') {
      const G = LAB.graph, opt = sel => LAB_G.order.map(v => `<option${v === sel ? ' selected' : ''}>${v}</option>`).join('');
      box.innerHTML = `<section class="lab-panel"><h2>Как программа считает пути в графе</h2>
        <p class="lab-note">Граф ациклический: стрелки ведут только вперёд. Число в вершине — ответ «отсюда до конца». Программа из урока считает его так же: от конечной вершины назад, складывая (или выбирая min / max) ответы соседей. Щёлкните вершину: первый щелчок — «обязательно через неё», второй — «запрещена», третий — как было.</p>
        <div class="lab-fields"><label>Вопрос<select class="inp" id="labGKind">${[['count', 'Сколько путей'], ['short', 'Кратчайший путь'], ['long', 'Самый длинный путь']].map(([k, t]) => `<option value="${k}"${k === G.kind ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Откуда<select class="inp" id="labGStart">${opt(G.start)}</select></label><label>Куда<select class="inp" id="labGEnd">${opt(G.end)}</select></label>
          <button class="btn" type="button" data-lab-action="graph-step">По шагам от конца</button><button class="btn ghost" type="button" data-lab-action="graph-reset">Сбросить</button></div>
        <div id="labGraphResult" aria-live="polite"></div>
        ${labPrediction('Чему равен ответ для выбранных вершин? Сначала посчитайте сами, потом нажмите «По шагам от конца».')}</section>`;
      labUpdateGraph();
    } else {
      const g = LAB.game;
      box.innerHTML = `<section class="lab-panel"><h2>Исследуй ходы Пети и Вани</h2><p class="lab-note">Одна или две кучи. Побеждает тот, кто первым доведёт общее число камней до цели. В демоверсии-2027: две кучи, +4 или ×2, цель 133. Просмотр ходов сам по себе не доказывает выигрышную стратегию.</p>
        <div class="lab-fields"><label>Куч<select class="inp" id="labHeaps"><option value="1" ${g.heaps === 1 ? 'selected' : ''}>Одна</option><option value="2" ${g.heaps === 2 ? 'selected' : ''}>Две</option></select></label><label>Первая куча<input type="number" class="inp" id="labStart" min="1" max="199" value="${g.start}"></label><label>Вторая куча (для двух)<input type="number" class="inp" id="labSecond" min="1" max="199" value="${g.second}"></label><label>Цель<input type="number" class="inp" id="labTarget" min="2" max="200" value="${g.target}"></label><label>Прибавить<input type="number" class="inp" id="labAdd" min="1" max="20" value="${g.add}"></label><label>Умножить на<input type="number" class="inp" id="labFactor" min="2" max="5" value="${g.factor}"></label><button class="btn" type="button" data-lab-action="game-reset">Начать заново</button></div>
        <div id="labGameResult" aria-live="polite"></div>
        <p class="lab-note">Выбери ход, чтобы перейти к новой позиции. Под каждым ходом показаны возможные ответы соперника.</p></section>`;
      labUpdateGame();
    }
  }
  function labUpdateLogic() {
    const L = LAB.logic, m = LAB_LOGIC[L.kind], box = $('#labLogicResult'); if (!box) return;
    if (L.kind === 'seg') {
      L.segA = +$('#labSegA').value; L.segB = +$('#labSegB').value;
      if (L.segB < L.segA) { L.segB = L.segA; $('#labSegB').value = L.segB; }
      $('#labSegALabel').textContent = L.segA; $('#labSegBLabel').textContent = L.segB;
      const xs = Array.from({ length: 241 }, (_, i) => i / 4), bad = xs.filter(x => !m.f(x, L.segA, L.segB));
      const pos = x => (x / 60 * 100).toFixed(2) + '%', bar = (a, b, cls, t) => `<i class="${cls}" style="left:${pos(a)};width:${pos(b - a)}"><span>${t}</span></i>`;
      box.innerHTML = `<div class="lab-line">${bar(10, 35, 'p', 'P')}${bar(25, 50, 'q', 'Q')}${bar(L.segA, Math.max(L.segB, L.segA + 0.4), 'a', 'A')}
          ${bad.map(x => `<b style="left:${pos(x)}" title="x = ${String(x).replace('.', ',')}"></b>`).join('')}
          <div class="lab-ticks">${[0, 10, 20, 30, 40, 50, 60].map(t => `<span style="left:${pos(t)}">${t}</span>`).join('')}</div></div>
        <dl class="lab-facts"><div><dt>Отрезок A</dt><dd>[${L.segA}; ${L.segB}], длина ${L.segB - L.segA}</dd></div>
          <div><dt>Контрпримеров</dt><dd class="${bad.length ? 'lab-bad' : 'lab-good'}">${bad.length ? `${bad.length} точек, например x = ${String(bad[0]).replace('.', ',')}` : 'нет — выражение истинно при любом x'}</dd></div></dl>`;
      return;
    }
    L.a = +$('#labA').value; $('#labALabel').textContent = L.a;
    const xs = Array.from({ length: m.xMax }, (_, i) => i + 1), bad = xs.filter(x => !m.f(x, L.a));
    const why = bad.length ? m.parts(bad[0], L.a).map(([t, v]) => `<span class="${v ? 'lab-good' : 'lab-bad'}">${t}: ${v ? 'да' : 'нет'}</span>`).join(' · ') : '';
    box.innerHTML = `<div class="lab-xgrid">${xs.map(x => `<i class="${m.f(x, L.a) ? 'ok' : 'no'}" title="x = ${x}${L.kind === 'bit' ? ' = ' + x.toString(2).padStart(7, '0') + '₂' : ''}">${x}</i>`).join('')}</div>
      <dl class="lab-facts"><div><dt>Проверено x</dt><dd>от 1 до ${m.xMax}</dd></div>
        <div><dt>Контрпримеров</dt><dd class="${bad.length ? 'lab-bad' : 'lab-good'}">${bad.length ? `${bad.length}, первый x = ${bad[0]}${L.kind === 'bit' ? ' = ' + bad[0].toString(2) + '₂' : ''}` : 'нет на этом отрезке'}</dd></div></dl>
      ${bad.length ? `<p class="lab-note">Почему при x = ${bad[0]} выражение ложно: ${why}. Импликация ложна, только когда слева «да», а справа «нет».</p>`
        : '<p class="lab-note">Красных клеток нет. Но «при любом x» — это бесконечно много чисел: программа в уроке проверяет x до нескольких тысяч, а здесь видна лишь часть.</p>'}`;
  }
  function labUpdateGraph() {
    const G = LAB.graph, box = $('#labGraphResult'); if (!box) return;
    G.kind = $('#labGKind').value; G.start = $('#labGStart').value; G.end = $('#labGEnd').value;
    const r = labGraphSolve(G.kind, G.start, G.end, G.banned, G.via), t = r.table;
    const shown = new Set(t.steps.slice(0, G.shown)), onPath = new Set(G.kind === 'count' ? [] : r.path);
    const edgeOn = (a, b) => { const i = r.path.indexOf(a); return i >= 0 && r.path[i + 1] === b; };
    const X = c => 40 + c * 108, Y = r_ => 52 + r_ * 96, fmt = v => v == null ? '∞' : v;
    const cur = G.shown < t.steps.length ? t.steps[G.shown - 1] : null;
    const svg = `<svg class="lab-graph" viewBox="0 0 620 300" role="group" aria-label="Граф с вершинами A–H">
      <defs><marker id="labArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
      ${LAB_G.e.map(([a, b, w]) => { const [x1, y1] = [X(LAB_G.v[a][0]), Y(LAB_G.v[a][1])], [x2, y2] = [X(LAB_G.v[b][0]), Y(LAB_G.v[b][1])];
        const k = 24 / Math.hypot(x2 - x1, y2 - y1), sx = x1 + (x2 - x1) * k, sy = y1 + (y2 - y1) * k, ex = x2 - (x2 - x1) * k, ey = y2 - (y2 - y1) * k;
        const dim = G.banned.has(a) || G.banned.has(b);
        return `<g class="e${edgeOn(a, b) ? ' on' : ''}${dim ? ' dim' : ''}"><line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" marker-end="url(#labArr)"/>${G.kind === 'count' ? '' : `<text x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 5}">${w}</text>`}</g>`; }).join('')}
      ${LAB_G.order.map(v => { const [c, r_] = LAB_G.v[v], cls = [G.banned.has(v) ? 'ban' : '', v === G.via ? 'via' : '', v === G.start || v === G.end ? 'end' : '', onPath.has(v) ? 'on' : '', v === cur ? 'cur' : ''].filter(Boolean).join(' ');
        return `<g class="v ${cls}" data-lab-gv="${v}" tabindex="0" role="button" aria-disabled="${v === G.start || v === G.end}" aria-label="Вершина ${v}${G.banned.has(v) ? ", запрещена" : v === G.via ? ", обязательная" : ""}"><circle cx="${X(c)}" cy="${Y(r_)}" r="22"/><text x="${X(c)}" y="${Y(r_) + 6}">${v}</text>
          ${shown.has(v) ? `<text class="val" x="${X(c)}" y="${Y(r_) + (r_ === 0 ? -30 : 42)}">${fmt(t.val[v])}</text>` : ''}</g>`; }).join('')}</svg>`;
    const kindTxt = { count: 'сколько путей ведёт отсюда в конец', short: 'длина кратчайшего пути отсюда до конца', long: 'длина самого длинного пути отсюда до конца' }[G.kind];
    const how = G.kind === 'count' ? 'в конце пути — 1, иначе сумма чисел соседей' : `в конце пути — 0, иначе ${G.kind === 'short' ? 'min' : 'max'}(вес ребра + число соседа)`;
    const allShown = G.shown >= t.steps.length;
    box.innerHTML = svg + `<dl class="lab-facts"><div><dt>Число в вершине</dt><dd class="lab-small">${kindTxt}; ${how}</dd></div>
      <div><dt>Ответ ${G.start} → ${G.end}${G.via ? ` через ${G.via}` : ''}${G.banned.size ? ` в обход ${[...G.banned].join(', ')}` : ''}</dt>
        <dd>${allShown ? (r.answer == null ? 'пути нет' : `${r.answer}${r.parts ? ` = ${r.parts[0]} ${G.kind === 'count' ? '×' : '+'} ${r.parts[1]}` : ''}`) : '…'}</dd></div></dl>
      ${allShown && G.kind !== 'count' && r.path.length > 1 ? `<p class="lab-path">Путь: ${r.path.join(' → ')}</p>` : ''}
      ${G.via && allShown ? `<p class="lab-note">Через вершину ${G.via} путь собирается из двух кусков: ${G.start} → ${G.via} и ${G.via} → ${G.end}. Количества путей ${G.kind === 'count' ? 'перемножаются' : '— нет, тут длины складываются'}. Числа на графе показаны для второго куска.</p>` : ''}
      ${!allShown ? `<p class="lab-note">Шаг ${G.shown} из ${t.steps.length}: считаем вершину <b>${cur}</b>. Порядок — от конца к началу, чтобы у соседей ответ уже был.</p>` : ''}`;
  }
  function labResetFeedback() { if ($('#labFeedback')) $('#labFeedback').textContent = ''; }
  function labNetworkFacts(n) {
    return `<div class="lab-bits" aria-label="Двоичная запись адреса">${[0, 8, 16, 24].map(start => `<span class="lab-octet">${n.bits.slice(start, start + 8).split('').map((bit, i) => `<b class="${start + i < n.prefix ? 'network' : 'host'}">${bit}</b>`).join('')}</span>`).join('')}</div>
        <dl class="lab-facts"><div><dt>Маска</dt><dd>${n.mask}</dd></div><div><dt>Первый адрес</dt><dd>${n.network}</dd></div><div><dt>Последний адрес</dt><dd>${n.last}</dd></div><div><dt>Битов для адреса внутри сети</dt><dd>32 − ${n.prefix} = ${32 - n.prefix}</dd></div></dl>`;
  }
  function labUpdateNetwork() {
    LAB.net.ip = $('#labIp').value; LAB.net.prefix = +$('#labPrefix').value;
    $('#labPrefixLabel').textContent = LAB.net.prefix; labResetFeedback();
    $('#labIp').removeAttribute('aria-invalid');
    try {
      const n = labNetwork(LAB.net.ip, LAB.net.prefix);
      $('#labNetResult').innerHTML = labNetworkFacts(n);
    } catch (e) { $('#labIp').setAttribute('aria-invalid', 'true'); $('#labNetResult').textContent = e.message; }
  }
  async function openLabAssignment(id, sync, back) {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    if (pyOpen()) togglePy(false);
    if (bdOpen()) toggleBoard(false);
    labStop(); abandonCurrent();
    appState.cur = null; appState.courseShown = true; appState.pageKind = 'lab13';
    document.body.classList.remove('asg-wide', 'hub-on', 'lab-open');
    navPush({ v: 'lab13', id }); renderSidebar();
    $('#scopeInfo').innerHTML = '<span class="scope-title">Лаборатория №13</span>';
    $('#sessionInfo').textContent = '';
    trainerEl.innerHTML = `<article class="lab" id="labAsgRoot"><button type="button" class="link-btn lab-back" data-lab-asg-back>← Задания от учителя</button>
      <header class="lab-header"><span class="lab-mark">${labIcon}</span><div><h1>Лаборатория №13</h1><p>Подсети IPv4</p></div></header>
      <section class="lab-panel" id="labAsgWork" aria-busy="true"><p role="status">Открываем назначение…</p></section></article>`;
    window.scrollTo(0, 0);
    const root = $('#labAsgRoot'), panel = $('#labAsgWork'), session = learningSessionGuard();
    const active = () => session() && root.isConnected && appState.courseShown && appState.pageKind === 'lab13';
    let done = false;
    root.querySelector('[data-lab-asg-back]').onclick = () => back(done);
    const start = async () => {
      panel.setAttribute('aria-busy', 'true');
      panel.innerHTML = '<p role="status">Открываем назначение…</p>';
      try {
        const state = await api('asg/lab13/start', { id });
        if (!active()) return;
        if (state.id !== id || !state.ip || !Number.isInteger(state.prefix)) throw Error('Сервер не подтвердил открытие назначения.');
        done = !!state.finished;
        sync(state);
        render(state);
      } catch (err) {
        if (!active()) return;
        const blocked = err.status === 403 || err.status === 404 || err.status === 409;
        done = err.status === 409;
        panel.innerHTML = `<p role="alert">${blocked ? esc(err.message) : 'Не удалось загрузить назначение. Проверь соединение и попробуй снова.'}</p>
          ${blocked ? '' : '<button class="btn" type="button" id="labAsgRetry">Повторить загрузку</button>'}`;
        if (!blocked) $('#labAsgRetry').onclick = start;
      } finally { if (active()) panel.removeAttribute('aria-busy'); }
    };
    function render(state) {
      const title = `<h2>${esc(state.title)}</h2><p>IPv4-адрес и префикс из задания <strong id="labAsgSubnet">${esc(state.ip)}/${state.prefix}</strong></p>`;
      if (state.finished) {
        panel.innerHTML = title + `<div id="labAsgFeedback" role="status" tabindex="-1"><h3>${state.correct ? 'Прогноз верный' : 'В прогнозе ошибка'}</h3>
          <dl class="lab-facts"><div><dt>Твой прогноз</dt><dd>${labFmt(state.prediction)}</dd></div>
          <div><dt>Адресов в подсети</dt><dd>${labFmt(state.expected)}</dd></div></dl>
          <p>Первый прогноз сохранён в журнале.</p></div>
          <section id="labAsgModel"><h3>Проверка на модели</h3><p class="lab-note">Меняй адрес и префикс, чтобы исследовать границы подсети.</p>
            <div class="lab-fields"><label>IPv4-адрес<input class="inp" id="labAsgIp" maxlength="15" spellcheck="false" value="${esc(state.ip)}"></label>
            <label for="labAsgPrefix"><span>Префикс /<output for="labAsgPrefix" id="labAsgPrefixLabel">${state.prefix}</output></span><input id="labAsgPrefix" type="range" min="0" max="32" value="${state.prefix}"></label></div>
            <div id="labAsgFacts" aria-live="polite"></div></section>`;
        const ip = $('#labAsgIp'), prefix = $('#labAsgPrefix'), output = $('#labAsgFacts');
        const update = () => {
          $('#labAsgPrefixLabel').textContent = prefix.value;
          try {
            const n = labNetwork(ip.value, +prefix.value);
            ip.removeAttribute('aria-invalid');
            output.innerHTML = labNetworkFacts(n) + `<p>Адресов в подсети: 2<sup>${32 - n.prefix}</sup> = <strong id="labAsgModelCount">${labFmt(n.count)}</strong></p>`;
          } catch (error) { ip.setAttribute('aria-invalid', 'true'); output.textContent = error.message; }
        };
        ip.oninput = prefix.oninput = update;
        update(); $('#labAsgFeedback').focus({ preventScroll: true });
        return;
      }
      panel.innerHTML = title + `<form id="labAsgForm" class="lab-predict"><div><strong>Сколько всего IPv4-адресов в этой подсети?</strong>
        <p>Учитывай адрес сети и широковещательный адрес. Первый отправленный прогноз попадёт в журнал.</p></div>
        <label>Твой прогноз<input class="inp" type="number" id="labAsgPrediction" min="0" max="4294967296" step="1" inputmode="numeric" required></label>
        <button class="btn primary" id="labAsgCheck">Проверить в модели</button><p class="lab-feedback" id="labAsgStatus" role="status"></p></form>`;
      const input = $('#labAsgPrediction'), button = $('#labAsgCheck'), status = $('#labAsgStatus');
      $('#labAsgForm').onsubmit = async event => {
        event.preventDefault();
        if (button.disabled || !input.validity.valid) return;
        const prediction = Number(input.value);
        button.disabled = true; input.readOnly = true;
        status.textContent = 'Сохраняем прогноз…';
        try {
          const result = await api('asg/lab13/answer', { id, prediction });
          if (!session()) return;
          if (result.id !== id || !result.finished || !Number.isInteger(result.prediction) || !Number.isInteger(result.expected)) throw Error('Ответ не подтверждён.');
          sync(result);
          if (!active()) return;
          done = true;
          render(result);
        } catch (err) {
          if (!active()) return;
          const blocked = [403, 404, 409].includes(err.status);
          done = err.status === 409;
          status.textContent = blocked || err.status === 400 ? err.message : 'Не удалось получить подтверждение. Проверь соединение и отправь прогноз ещё раз.';
          if (err.status === 400) input.readOnly = false;
          if (!blocked) { button.disabled = false; button.textContent = 'Отправить ещё раз'; }
        }
      };
    }
    await start();
  }
  function labUpdateImage() {
    LAB.picture = { w: +$('#labWidth').value, h: +$('#labHeight').value, depth: +$('#labDepth').value };
    for (const id of ['labWidth', 'labHeight', 'labDepth']) {
      const field = $('#' + id);
      if (field.value === '' || !field.validity.valid) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
    const p = LAB.picture; $('#labDepthLabel').textContent = p.depth; labResetFeedback();
    try {
      const v = labImageSize(p.w, p.h, p.depth);
      $('#labImageResult').innerHTML = `<dl class="lab-facts"><div><dt>Возможных цветов</dt><dd>2<sup>${p.depth}</sup> = ${labFmt(v.colors)}</dd></div><div><dt>Пикселей</dt><dd>${labFmt(p.w * p.h)}</dd></div></dl><p>Объём в битах = ширина × высота × глубина цвета.</p>`;
      const c = $('#labCanvas').getContext('2d');
      const levels = [Math.ceil(p.depth / 3), Math.floor((p.depth + 1) / 3), Math.floor(p.depth / 3)].map(b => 2 ** b - 1);
      const quant = (x, max) => max ? Math.round(x * max) * 255 / max : 0;
      for (let y = 0; y < 128; y += 4) for (let x = 0; x < 256; x += 4) {
        c.fillStyle = `rgb(${quant(x / 252, levels[0])},${quant(y / 124, levels[1])},${quant(1 - x / 252, levels[2])})`; c.fillRect(x, y, 4, 4);
      }
    } catch (e) { $('#labImageResult').textContent = e.message; }
  }
  function labUpdateGame() {
    const g = LAB.game, n = g.path[g.path.length - 1], box = $('#labGameResult');
    const sum = p => p.reduce((a, b) => a + b, 0), label = p => p.join(' + ');
    try {
      const moves = labGamePositionMoves(n, g.target, g.add, g.factor), petya = g.path.length % 2 === 1;
      box.innerHTML = `<div class="lab-position"><b>${label(n)}</b><span>${moves.length ? `камней · ходит ${petya ? 'Петя' : 'Ваня'}` : `Победил ${petya ? 'Ваня' : 'Петя'}`}</span></div>
        <p class="lab-path">${g.path.map(p => '(' + label(p) + ')').join(' → ')}</p>
        <div class="lab-moves">${moves.map((m, i) => `<div><button class="btn" type="button" data-lab-move="${i}">${m.label} → ${label(m.value)}${sum(m.value) >= g.target ? ' · победа' : ''}</button><p>${sum(m.value) >= g.target ? 'Игра завершится' : 'Далее: ' + labGamePositionMoves(m.value, g.target, g.add, g.factor).map(x => `${x.label} → ${label(x.value)}${sum(x.value) >= g.target ? ' (победа соперника)' : ''}`).join(' · ')}</p></div>`).join('')}</div>
        <button type="button" class="btn ghost" data-lab-action="game-back" ${g.path.length < 2 ? 'disabled' : ''}>← Отменить ход</button>`;
    } catch (e) { box.textContent = e.message; }
  }
  function labCodeHtml() {
    return `<div class="lab-code-tools"><label>Готовый пример<select class="inp" id="labExample"><option value="">Выбрать пример…</option>${Object.entries(LAB_EXAMPLES).map(([id, [name]]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <button type="button" class="btn primary" id="labRun" data-lab-action="run">Разобрать по шагам</button><button type="button" class="btn" id="labStop" data-lab-action="stop" hidden>Остановить</button>
      <button type="button" class="btn ghost" data-lab-action="edit" id="labEdit" ${LAB.result ? '' : 'hidden'}>Редактировать код</button></div>
      <p class="lab-note">Код выполняется в браузере, затем запись можно листать вперёд и назад. Подсвеченная строка ещё не выполнена; переменные показаны перед ней. Пошагово записываются первые 200 000 шагов, а программа досчитывается до конца — до 5 минут.</p>
      <p class="lab-status" id="labStatus" role="status">${LAB.result ? 'Запись выполнения готова.' : 'Вставь свой код или выбери пример. Ctrl+Enter — разобрать.'}</p>
      <div class="lab-controls" id="labControls" ${LAB.result && LAB.result.steps.length ? '' : 'hidden'}>
        <button type="button" class="btn" data-lab-action="prev" id="labPrev" title="Шаг назад (F7)">← Назад</button><button type="button" class="btn primary" data-lab-action="next" id="labNext" title="Следующий шаг (F8)">Следующий шаг →</button><button type="button" class="btn" data-lab-action="resume" id="labResume" title="До следующей точки останова (F9)">До точки останова ▶▶</button><button type="button" class="btn" data-lab-action="play" id="labPlay">Воспроизвести</button><button type="button" class="btn" data-lab-action="end" id="labEnd">В конец ⇥</button>
        <label>Шаг <span id="labStepLabel"></span><input type="range" id="labStep" min="0" max="0" value="0" aria-label="Шаг выполнения"></label></div>
      <div class="lab-code-grid"><section class="lab-panel lab-editor"><h2>Код Python</h2>
        <div class="ide">
          <div class="ide-tabs"><span class="ide-tab"><i class="ide-pyico" aria-hidden="true"></i>main.py</span><span class="ide-mode" id="labIdeMode">${LAB.result ? 'Отладка' : 'Редактор'}</span></div>
          <div class="ide-ed" id="labEd" ${LAB.result ? 'hidden' : ''}><div class="ide-gutter" id="labGutter" role="group" aria-label="Точки останова"></div>
            <div class="ide-area"><pre class="ide-hl" id="labCodeHl" aria-hidden="true"></pre>
              <textarea id="labCode" class="ide-code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" maxlength="30000" aria-label="Код Python">${esc(LAB.code)}</textarea></div></div>
          <div id="labTraceCode" class="lab-trace-code ide-trace" tabindex="0" aria-label="Код с текущей строкой" ${LAB.result ? '' : 'hidden'}></div>
          <div class="ide-foot">Нажми номер строки или Enter на нём — поставишь точку останова <i class="ide-bp-dot" aria-hidden="true"></i></div>
        </div>
        <label class="lab-stdin">Входные данные для input()<textarea class="inp" id="labStdin" rows="3" maxlength="10000" spellcheck="false" ${LAB.result ? 'disabled' : ''}>${esc(LAB.stdin)}</textarea></label>
      </section><section class="lab-panel"><h2>Что происходит</h2><p id="labEvent">Здесь появятся значения переменных на каждом шаге.</p><div id="labStack" class="lab-stack"></div><div id="labVariables"></div><h3>Вывод программы</h3><pre class="lab-output ide-out" id="labOutput" aria-label="Вывод программы"></pre></section></div>
      <p class="lab-note">Списки и значения показаны сокращённо. Python загружается при первом запуске; кнопка «Остановить» прерывает и загрузку, и выполнение.</p>`;
  }
  function labSetStatus(text) { if (labActive() && $('#labStatus')) $('#labStatus').textContent = text; }
  function labSetBusy(busy) {
    LAB.running = busy;
    for (const id of ['labRun', 'labExample', 'labCode', 'labStdin']) if ($('#' + id)) $('#' + id).disabled = busy;
    if ($('#labStop')) $('#labStop').hidden = !busy;
  }
  function labRun() {
    if (LAB.running) return;
    if (!LAB.code.trim()) { labSetStatus('Сначала напиши код или выбери пример.'); return; }
    labStop(); LAB.result = null; LAB.index = 0; labSaveDraft();
    const example = !LAB.context && Object.keys(LAB_EXAMPLES).find(id => LAB_EXAMPLES[id][1] === LAB.code);
    $('#labEd').hidden = false; $('#labTraceCode').hidden = true; $('#labControls').hidden = true; $('#labEdit').hidden = true; $('#labIdeMode').textContent = 'Редактор';
    $('#labVariables').textContent = ''; $('#labStack').textContent = ''; $('#labOutput').textContent = ''; $('#labEvent').textContent = 'Готовим запись выполнения…';
    try {
      const worker = new EgePythonWorker('lab-worker.js' + (RULES.py_local ? '?local=1' : '')); LAB.worker = worker;
      labSetBusy(true); labSetStatus('Загружаю Python… При первом запуске это может занять около минуты.');
      const fail = text => { if (LAB.worker !== worker) return; labStop(); labSetBusy(false); labSetStatus(text); };
      LAB.timeout = setTimeout(() => fail('Python не успел загрузиться. Проверь интернет и повтори запуск.'), 90000);
      worker.onmessage = e => {
        if (LAB.worker !== worker || !labActive()) return;
        const m = e.data;
        if (m.type === 'tracing') {
          clearTimeout(LAB.timeout); LAB.timeout = setTimeout(() => fail('Выполнение остановлено через минуту. Уменьши входные данные или проверь цикл.'), 60000);
          labSetStatus('Записываю выполнение…');
        } else if (m.type === 'trace-partial') {
          // Первые 200 000 шагов записаны — их можно листать, пока программа досчитывается без записи.
          clearTimeout(LAB.timeout);
          LAB.timeout = setTimeout(() => {
            if (LAB.worker !== worker) return;
            labStop(); labSetBusy(false);
            if (LAB.result) { LAB.result.pending = false; LAB.result.timedOut = true; labRenderStep(); }
          }, 330000);
          LAB.result = m.result; LAB.result.progress = 0; LAB.index = 0; labIndexSteps();
          $('#labEd').hidden = true; $('#labTraceCode').hidden = false; $('#labEdit').hidden = false; $('#labStdin').disabled = true; $('#labIdeMode').textContent = 'Отладка';
          labRenderStep();
        } else if (m.type === 'trace-progress') {
          if (LAB.result?.pending) { LAB.result.progress = m.seconds; labRenderStatus(); }
        } else if (m.type === 'trace') {
          if (SERVER && !appState.teacher && example && m.result.finished && !m.result.error) api('lab/activity', { section: 'code', example }).catch(() => {});
          const recorded = LAB.result?.pending ? LAB.result : null;
          clearTimeout(LAB.timeout); LAB.timeout = null; worker.terminate(); LAB.worker = null; labSetBusy(false);
          if (recorded) {                                    // досчитали: шаги — прежние, вывод и итог — полные
            Object.assign(recorded, { output: m.result.output, error: m.result.error, outputTruncated: m.result.outputTruncated,
              truncated: m.result.truncated, stop: m.result.stop, finished: m.result.finished, seconds: m.result.seconds, pending: false });
            labRenderStep();
            return;
          }
          LAB.result = m.result; LAB.index = 0; labIndexSteps();
          $('#labEd').hidden = true; $('#labTraceCode').hidden = false; $('#labEdit').hidden = false; $('#labStdin').disabled = true; $('#labIdeMode').textContent = 'Отладка';
          labRenderStep();
        } else if (m.type === 'trace-error') fail(m.text);
        else if (m.type === 'done' && !m.ok) fail('Не удалось загрузить Python. Проверь интернет и повтори запуск.');
      };
      worker.onerror = () => fail('Не удалось запустить Python. Обнови страницу и попробуй ещё раз.');
      worker.postMessage({ type: 'trace', code: LAB.code, stdin: LAB.stdin, files: LAB.context?.files || [] });
    } catch (e) { labStop(); labSetBusy(false); labSetStatus('Браузер не смог запустить Python. Попробуй современную версию браузера.'); }
  }
  function labRenderStatus() {
    const r = LAB.result;
    if (!r) return;
    const n = r.steps.length.toLocaleString('ru-RU'), cut = ' Пошагово записаны первые ' + n + ' шагов — их можно листать.';
    const tail = r.outputTruncated ? ' Вывод сокращён до 20000 символов.' : '';
    if (r.pending) labSetStatus(`Шагов больше ${n}.${cut} Программа продолжает считаться без записи, чтобы получить полный вывод${r.progress ? ` — идёт ${r.progress} с` : ''}… Можно остановить кнопкой «Остановить».`);
    else if (r.userStopped) labSetStatus(`Досчёт остановлен вручную.${cut} Вывод — только до места остановки.`);
    else if (r.timedOut || (r.cut && r.stop === 'total')) labSetStatus(`Программа не закончилась за 5 минут — похоже на бесконечный цикл или слишком долгий расчёт.${cut} Проверь условие цикла.`);
    else if (r.error) labSetStatus('Программа завершилась с ошибкой: ' + r.error + (r.cut ? cut : ''));
    else if (r.truncated) labSetStatus('Программа выполнялась дольше 25 секунд ещё до первых 200 000 шагов — запись остановлена. Похоже на бесконечный цикл или слишком большие данные.');
    else if (r.cut) labSetStatus(`Программа выполнена до конца${r.seconds ? ` за ${r.seconds} с` : ''}: шагов больше ${n}.${cut} Полный вывод программы — на последнем шаге («В конец»).` + tail);
    else labSetStatus(`Программа выполнена до конца: ${n} ${plural(r.steps.length, 'шаг', 'шага', 'шагов')}. Листай шаги и наблюдай за переменными.` + tail);
  }
  function labRenderStep() {
    if (!labActive() || LAB.view !== 'code' || !LAB.result) return;
    const r = LAB.result, s = r.steps[LAB.index], previous = r.steps[LAB.index - 1];
    $('#labControls').hidden = !r.steps.length;
    labRenderStatus();
    const vals = new Map((s ? s.variables : []).map(v => [v.name, v]));
    $('#labTraceCode').innerHTML = LAB.code.split('\n').map((line, i) => {
      const n = i + 1, cur = s && s.line === n, bp = LAB.bps.has(n);
      // значения переменных прямо в строке — только для уже выполненных строк текущей функции (как в PyCharm)
      let inline = '';
      if (s && LAB.seen && LAB.seen.first.get(n) <= LAB.index && LAB.seen.func.get(n) === s.function) {
        const names = [...new Set(line.replace(/#.*$/, '').replace(/(['"])(?:\\.|(?!\1).)*\1/g, '').match(/[A-Za-z_][\w]*/g) || [])].filter(w => vals.has(w) && !PY_KW.has(w));
        if (names.length) inline = `<em class="ide-inline">${names.slice(0, 5).map(w => `${esc(w)}: ${esc(labShort(vals.get(w).value))}`).join('&nbsp;&nbsp; ')}</em>`;
      }
      return `<div class="lab-code-line${cur ? ' current' : ''}${bp ? ' bp' : ''}" ${cur ? 'aria-current="step"' : ''}><span class="ide-ln" data-lab-bp="${n}" role="button" tabindex="0" aria-label="Точка останова: строка ${n}" aria-pressed="${bp}">${n}</span><code>${highlightPy(line) || ' '}</code>${inline}</div>`;
    }).join('');
    if (!s) { $('#labEvent').textContent = 'Не удалось начать выполнение. Исправь код и повтори запуск.'; $('#labOutput').textContent = r.output; return; }
    $('#labEvent').textContent = s.event === 'line' ? `Следующая строка: ${s.line}` : s.event === 'exception' ? `Строка ${s.line}: исключение ${s.exception}` : s.function === '<module>' ? (r.error ? 'Выполнение завершилось с ошибкой' : 'Выполнение основного кода завершено') : `Выход из ${s.function}: ${s.returnValue}`;
    $('#labStack').textContent = 'Вызовы: ' + s.stack.slice().reverse().map(f => f.name === '<module>' ? 'основной код' : f.name).join(' → ');
    $('#labVariables').innerHTML = s.variables.length ? `<div class="lab-vars ide-vars">${s.variables.map(v => {
      const old = previous && previous.function === s.function && previous.variables.find(x => x.name === v.name);
      const changed = !old || old.value !== v.value;
      const kind = v.type === 'str' ? 'str' : ['int', 'float', 'complex'].includes(v.type) ? 'num' : ['bool', 'NoneType'].includes(v.type) ? 'kw' : '';
      return `<div class="lab-var${changed ? ' changed' : ''}"><div class="ide-var-row"><i class="ide-var-ic ${kind || 'obj'}" aria-hidden="true"></i><b>${esc(v.name)}</b><span class="ide-eq">=</span><small>{${esc(v.type)}}</small>${v.length != null ? `<small>len ${v.length}</small>` : ''}<code class="${kind ? 'hl-' + kind : ''}">${esc(v.value)}</code>${changed ? '<span class="ide-chg" title="Значение изменилось на этом шаге">изменилось</span>' : ''}</div>${v.items ? `<div class="lab-array">${v.items.map((x, i) => `<span><small>${i}</small><code>${esc(x)}</code></span>`).join('')}${v.length > v.items.length ? '<span>…</span>' : ''}</div>` : ''}</div>`;
    }).join('')}</div>` : '<p class="lab-note">Пока нет переменных.</p>';
    // После досчёта на последнем записанном шаге показываем весь вывод программы.
    const whole = r.cut && !r.pending && LAB.index >= r.steps.length - 1;
    $('#labOutput').textContent = whole ? r.output : s.out != null ? r.output.slice(0, s.out) : (s.output || '');
    $('#labStep').max = r.steps.length - 1; $('#labStep').value = LAB.index;
    $('#labStepLabel').textContent = `${LAB.index + 1} из ${r.steps.length}`;
    $('#labPrev').disabled = LAB.index === 0; $('#labNext').disabled = $('#labEnd').disabled = LAB.index >= r.steps.length - 1;
    $('#labResume').disabled = LAB.index >= r.steps.length - 1;
    // Прокручиваем только код, не всю страницу: шаги и переменные остаются на месте.
    const panel = $('#labTraceCode'), line = $('#labTraceCode .current');
    if (line) {
      const p = panel.getBoundingClientRect(), l = line.getBoundingClientRect();
      if (l.top < p.top + 12) panel.scrollTop -= p.top + 12 - l.top;
      else if (l.bottom > p.bottom - 12) panel.scrollTop += l.bottom - p.bottom + 12;
    }
  }
  /** Для каждой строки: первый шаг, на котором она выполнялась, и в какой функции — по ним показываем значения в строках. */
  function labIndexSteps() {
    const first = new Map(), func = new Map();
    (LAB.result?.steps || []).forEach((st, i) => { if (!first.has(st.line)) { first.set(st.line, i); func.set(st.line, st.function); } });
    LAB.seen = { first, func };
  }
  const labShort = v => (v.length > 28 ? v.slice(0, 26) + '…' : v);
  /** «До точки останова» (F9): следующий шаг на строке с точкой; если точек нет или дальше их нет — в конец. */
  function labResume() {
    const st = LAB.result?.steps || [];
    let i = LAB.index + 1;
    while (i < st.length && !(st[i].event === 'line' && LAB.bps.has(st[i].line))) i++;
    LAB.index = Math.min(i, st.length - 1);
    if (i >= st.length && LAB.bps.size) labSetStatus('Дальше точек останова нет — программа дошла до конца.');
    labRenderStep();
  }
  /** Редактор: раскрашенная копия под прозрачным полем и номера строк с точками останова. */
  function labPaintEditor() {
    const ta = $('#labCode'), hl = $('#labCodeHl');
    if (!ta || !hl) return;
    hl.innerHTML = '<div class="ide-hl-in">' + highlightPy(ta.value) + '\n</div>';
    const n = ta.value.split('\n').length;
    $('#labGutter').innerHTML = '<div class="ide-gutter-in">' + Array.from({ length: n }, (_, i) => `<span class="ide-ln${LAB.bps.has(i + 1) ? ' bp' : ''}" data-lab-bp="${i + 1}" role="button" tabindex="0" aria-label="Точка останова: строка ${i + 1}" aria-pressed="${LAB.bps.has(i + 1)}">${i + 1}</span>`).join('') + '</div>';
    labFitCode();
    labScrollEditor();
  }
  /** Код целиком по ширине: самая длинная строка не помещается в колонку рядом с переменными — колонки друг под другом. */
  let labCharW = 0;
  function labFitCode() {
    const grid = trainerEl.querySelector('.lab-code-grid'), hl = $('#labCodeHl');
    if (!grid || !hl) return;
    if (!labCharW) { const c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(hl).font; labCharW = c.measureText('M'.repeat(40)).width / 40 || 8.5; }
    const longest = Math.max(0, ...String(LAB.code || '').split('\n').map(l => l.replace(/\t/g, '    ').length));
    const need = longest * labCharW + 28 + 54 + 6;                  // текст + отступы + номера строк
    const col = (grid.clientWidth - 20) * 1.45 / 2.45;               // ширина редактора, когда колонки рядом
    grid.classList.toggle('one', innerWidth > 1100 && need > col);
  }
  window.addEventListener('resize', () => { if (labActive()) labFitCode(); });
  document.fonts?.ready.then(() => { labCharW = 0; if (labActive()) labFitCode(); });   // моноширинный шрифт догрузился
  function labScrollEditor() {
    const ta = $('#labCode'), inner = $('#labCodeHl')?.firstElementChild, g = $('#labGutter')?.firstElementChild;
    if (!ta || !inner) return;
    inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    if (g) g.style.transform = `translateY(${-ta.scrollTop}px)`;
  }
  function labStep(delta) { if (!LAB.result) return; LAB.index = Math.max(0, Math.min(LAB.result.steps.length - 1, LAB.index + delta)); labRenderStep(); }
  trainerEl.addEventListener('click', e => {
    if (!labActive()) return;
    const view = e.target.closest('[data-lab-view]'); if (view) { openLab(view.dataset.labView); return; }
    const model = e.target.closest('[data-lab-model]'); if (model) { LAB.mode = model.dataset.labModel; openLab('tasks'); return; }
    const move = e.target.closest('[data-lab-move]');
    if (move) { const g = LAB.game, m = labGamePositionMoves(g.path[g.path.length - 1], g.target, g.add, g.factor)[+move.dataset.labMove]; if (m) { g.path.push(m.value); labUpdateGame(); } return; }
    const a = e.target.closest('[data-lab-action]')?.dataset.labAction;
    if (a === 'run') labRun();
    if (a === 'stop') {
      labStop(); labSetBusy(false);
      if (LAB.result?.pending) { LAB.result.pending = false; LAB.result.userStopped = true; labRenderStep(); }
      else labSetStatus('Остановлено. Код сохранён в этом браузере.');
    }
    if (a === 'edit') { labStop(); LAB.result = null; openLab('code').then(() => $('#labCode')?.focus()); }
    if (a === 'prev' || a === 'next') { labPause(); labStep(a === 'prev' ? -1 : 1); }
    if (a === 'end' && LAB.result) { labPause(); LAB.index = LAB.result.steps.length - 1; labRenderStep(); }
    if (a === 'resume' && LAB.result) { labPause(); labResume(); }
    const bp = e.target.closest('[data-lab-bp]');
    if (bp) {
      const n = +bp.dataset.labBp, hadFocus = document.activeElement === bp;
      if (LAB.bps.has(n)) LAB.bps.delete(n); else LAB.bps.add(n);
      if (LAB.result) labRenderStep(); else labPaintEditor();
      if (hadFocus) trainerEl.querySelector((LAB.result ? '#labTraceCode ' : '#labGutter ') + '[data-lab-bp="' + n + '"]').focus();
    }
    if (a === 'play' && LAB.result) {
      if (LAB.play) { labPause(); return; }
      if (LAB.index >= LAB.result.steps.length - 1) LAB.index = 0;
      $('#labPlay').textContent = 'Пауза'; labRenderStep();
      LAB.play = setInterval(() => { if (!labActive() || LAB.index >= LAB.result.steps.length - 1) { labPause(); return; } labStep(1); }, 850);
    }
    if (a === 'game-back') { if (LAB.game.path.length > 1) LAB.game.path.pop(); labUpdateGame(); }
    if (a === 'graph-step') {                     // первый щелчок — только конечная вершина, дальше по одной к началу
      const G = LAB.graph, n = labGraphTo(G.kind, G.end, G.banned).steps.length;
      G.shown = G.shown >= n ? 1 : G.shown + 1; labUpdateGraph();
      const b = trainerEl.querySelector('[data-lab-action="graph-step"]'); if (b) b.textContent = G.shown >= n ? 'По шагам от конца' : 'Следующий шаг →';
    }
    if (a === 'graph-reset') { Object.assign(LAB.graph, { via: '', banned: new Set(), shown: 99 }); labRenderModel(); }
    const lx = e.target.closest('[data-lx-act]');
    if (lx && LAB_EXTRA[LAB.mode]) {             // переключатели и «новые данные» новых моделей
      const st = LAB_EXTRA[LAB.mode].state, act = lx.dataset.lxAct;
      if (act === 'rule') st.rule = lx.dataset.v; else if (act === 'sub') st.sub = lx.dataset.v;
      else if (act === 'new') { if ('seed' in st) st.seed = 1 + Math.floor(Math.random() * 1e6); else st.s = Array.from({ length: 36 }, () => 'XYZ'[Math.floor(Math.random() * 3)]).join(''); }
      labRenderModel(); return;
    }
    const lg = e.target.closest('[data-lab-logic]');
    if (lg) { LAB.logic.kind = lg.dataset.labLogic; labRenderModel(); return; }
    const gv = e.target.closest('[data-lab-gv]');
    if (gv) {                                     // обычная → обязательная → запрещённая → обычная
      const G = LAB.graph, v = gv.dataset.labGv;
      if (v === G.start || v === G.end) return;
      if (G.banned.has(v)) G.banned.delete(v);
      else if (G.via === v) { G.via = ''; G.banned.add(v); }
      else G.via = v;
      const hadFocus = document.activeElement === gv;
      labResetFeedback(); labUpdateGraph();
      if (hadFocus) trainerEl.querySelector('[data-lab-gv="' + v + '"]').focus();
      return;
    }
    if (a === 'game-reset') {
      const g = { start: +$('#labStart').value, second: +$('#labSecond').value, heaps: +$('#labHeaps').value, target: +$('#labTarget').value, add: +$('#labAdd').value, factor: +$('#labFactor').value };
      try { const pos = g.heaps === 2 ? [g.start, g.second] : [g.start]; labGamePositionMoves(pos, g.target, g.add, g.factor); if (pos.reduce((a, b) => a + b, 0) >= g.target) throw Error('Сумма камней в начале должна быть меньше цели.'); LAB.game = { ...g, path: [pos] }; labUpdateGame(); }
      catch (err) { $('#labGameResult').textContent = err.message; }
    }
  });
  trainerEl.addEventListener('input', e => {
    if (!labActive()) return;
    const id = e.target.id;
    if (id === 'labCode' || id === 'labStdin') { LAB[id === 'labCode' ? 'code' : 'stdin'] = e.target.value; labSaveDraft(); }
    if (id === 'labCode') labPaintEditor();
    if (id === 'labIp' || id === 'labPrefix') labUpdateNetwork();
    if (['labWidth', 'labHeight', 'labDepth'].includes(id)) labUpdateImage();
    if (['labA', 'labSegA', 'labSegB'].includes(id)) { labResetFeedback(); labUpdateLogic(); }
    if (e.target.matches?.('[data-lx]') && LAB_EXTRA[LAB.mode]) { labResetFeedback(); LAB_EXTRA[LAB.mode].update(); }
    if (id === 'labStep') { labPause(); LAB.index = +e.target.value; labRenderStep(); }
  });
  trainerEl.addEventListener('change', e => {
    if (labActive() && e.target.matches?.('select[data-lx]') && LAB_EXTRA[LAB.mode]) { labResetFeedback(); LAB_EXTRA[LAB.mode].update(); return; }
    if (labActive() && ['labGKind', 'labGStart', 'labGEnd'].includes(e.target.id)) {
      const G = LAB.graph; G.shown = 99;
      if (e.target.id !== 'labGKind') { G.via = ''; G.banned.clear(); }
      labResetFeedback(); labUpdateGraph(); return;
    }
    if (!labActive() || e.target.id !== 'labExample' || !LAB_EXAMPLES[e.target.value]) return;
    const code = LAB_EXAMPLES[e.target.value][1];
    if (LAB.code && LAB.code !== code && !confirm('Заменить текущий код выбранным примером?')) { e.target.value = ''; return; }
    labStop(); LAB.code = code; LAB.result = null; labSaveDraft(); openLab('code');
  });
  trainerEl.addEventListener('submit', e => {
    if (!labActive() || e.target.id !== 'labPredict') return;
    e.preventDefault();
    try {
      const answer = $('#labGuess').value.trim().replace(/\s/g, '');
      if (LAB_EXTRA[LAB.mode]) {
        const { expected, why } = LAB_EXTRA[LAB.mode].answer(), right = /^-?\d+$/.test(answer) && expected != null && +answer === expected;
        recordLabPrediction(right);
        $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} Ответ: ${expected == null ? 'нет' : expected}. ${why}`;
        return;
      }
      if (LAB.mode === 'logic' || LAB.mode === 'graph') {
        let expected, why;
        if (LAB.mode === 'logic') {
          const k = LAB.logic.kind, m = LAB_LOGIC[k]; expected = labLogicAnswer(k);
          why = k === 'seg' ? 'Отрезок A должен накрыть [10; 25): точки P, которых нет в Q. Длина 25 − 10 = 15.'
            : `Перебор A с проверкой x до 2000 — как программа в уроке «Курс ЕГЭ · №15» (${m.ask === 'max' ? 'последнее' : 'первое'} подходящее A).`;
        } else {
          const G = LAB.graph, r = labGraphSolve(G.kind, G.start, G.end, G.banned, G.via); expected = r.answer;
          G.shown = 99; labUpdateGraph();
          why = expected == null ? 'Пути нет.' : G.kind === 'count' ? 'Числа на графе — сколько путей из каждой вершины.' : `Путь: ${r.path.join(' → ')}.`;
        }
        const right = /^-?\d+$/.test(answer) && expected != null && +answer === expected;
        recordLabPrediction(right);
        $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} Ответ: ${expected == null ? 'пути нет' : expected}. ${why}`;
        return;
      }
      const expected = LAB.mode === 'net' ? labNetwork(LAB.net.ip, LAB.net.prefix).count : labImageSize(LAB.picture.w, LAB.picture.h, LAB.picture.depth).bytes;
      const right = /^\d+$/.test(answer) && +answer === expected;
      recordLabPrediction(right);
      $('#labFeedback').textContent = `${right ? 'Верно!' : 'Пока не совпало.'} ${LAB.mode === 'net' ? `2^(32 − ${LAB.net.prefix})` : `Округляем вверх: ${labFmt(LAB.picture.w)} × ${labFmt(LAB.picture.h)} × ${LAB.picture.depth} / 8`} = ${labFmt(expected)}${LAB.mode === 'net' ? ' адресов.' : ' байт.'}`;
    } catch (err) { $('#labFeedback').textContent = err.message; }
  });
  trainerEl.addEventListener('scroll', e => { if (e.target.id === 'labCode') labScrollEditor(); }, true);
  // клавиши отладчика PyCharm: F7 — шаг назад, F8 — шаг, F9 — до точки останова
  document.addEventListener('keydown', e => {
    if (!labActive() || LAB.view !== 'code' || !LAB.result || !['F7', 'F8', 'F9'].includes(e.key) || e.target.closest?.('input, select, textarea')) return;
    e.preventDefault(); labPause();
    if (e.key === 'F9') labResume(); else labStep(e.key === 'F7' ? -1 : 1);
  });
  trainerEl.addEventListener('keydown', e => {
    if (!labActive()) return;
    const control = e.target.closest('[data-lab-gv], [data-lab-bp]');
    if (control && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); control.dispatchEvent(new MouseEvent('click', { bubbles: true })); return;
    }
    if (LAB.view !== 'code') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); labRun(); return; }
    if (e.target.id === 'labCode' && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = e.target; t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  new MutationObserver(() => {
    if (!labActive()) {
      labStop();
      if ((appState.pageKind !== 'lab' || !appState.courseShown) && LAB.context) { labSaveDraft(); LAB.context = null; LAB.owner = null; }
      document.body.classList.remove('lab-open');
    }
  }).observe(trainerEl, { childList: true });
  window.addEventListener('pagehide', labStop);

  // ═══════ src/app/12k-buglab.js
  // ------------------------------------------------------------ лаборатория исправления ошибок
  /* Даётся задача и чужое «решение»: в нём ошибки, пропуск или оно слишком медленное. Ученик правит код и нажимает
     «Проверить»: код выполняется в браузере на входных данных тестов, выводы уходят на сервер, сервер сравнивает их
     с ожидаемыми. Это самопроверка по присланным выводам, не независимое выполнение кода и не основание для оценки. */
  const BUG = { cases: null, levels: {}, kinds: {}, cur: null, filter: 0, worker: null, timer: null, busy: false,
    results: {}, hints: {}, explain: {}, owner: null, loadId: 0, runId: 0, cancel: null };
  const bugActive = () => labActive() && LAB.view === 'bugs' && !!$('#bugRoot');
  const bugCase = () => (BUG.cases || []).find(c => c.id === BUG.cur) || null;
  const bugDraftKey = id => codeKey('bug:' + id);
  const bugCode = c => { const d = readJSON(bugDraftKey(c.id)); return d && typeof d.code === 'string' ? d.code.slice(0, 20000) : c.code; };
  const BUG_ERR = {
    ZeroDivisionError: 'деление на ноль', IndexError: 'обращение к элементу, которого нет в списке или строке',
    NameError: 'используется имя, которое нигде не задано', TypeError: 'операция с неподходящим типом данных',
    ValueError: 'значение нельзя преобразовать (например, int() от нечисла)', RecursionError: 'рекурсия не останавливается',
    SyntaxError: 'ошибка в записи программы', IndentationError: 'неверный отступ', EOFError: 'программа читает больше данных, чем есть во входе',
    KeyError: 'в словаре нет такого ключа', AttributeError: 'у значения нет такого метода', MemoryError: 'не хватило памяти',
    OverflowError: 'слишком большое число', UnboundLocalError: 'переменная используется до присваивания',
  };
  const bugErrText = r => `${BUG_ERR[r.kind] ? BUG_ERR[r.kind][0].toUpperCase() + BUG_ERR[r.kind].slice(1) : 'Ошибка выполнения'}${r.line ? ` — строка ${r.line}` : ''}`;
  /** Номера строк текущего кода, которых нет в исходном решении (наибольшая общая подпоследовательность строк). */
  function bugChanged(orig, now) {
    const a = orig.replace(/\s+$/, '').split('\n').map(x => x.replace(/\s+$/, '')), b = now.split('\n').map(x => x.replace(/\s+$/, ''));
    const n = a.length, m = b.length, d = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) d[i][j] = a[i] === b[j] ? d[i + 1][j + 1] + 1 : Math.max(d[i + 1][j], d[i][j + 1]);
    const out = new Set();
    for (let i = 0, j = 0; j < m;) {
      if (i < n && a[i] === b[j]) { i++; j++; } else if (i < n && d[i + 1][j] >= d[i][j + 1]) i++; else { if (b[j].trim()) out.add(j); j++; }
    }
    return out;
  }
  function bugReleaseWorker() {
    clearTimeout(BUG.timer); BUG.timer = null;
    if (BUG.worker) BUG.worker.terminate();
    BUG.worker = null; BUG.cancel = null;
  }
  function bugStop() {
    const cancel = BUG.cancel;
    ++BUG.runId;
    bugReleaseWorker(); BUG.busy = false;
    if (cancel) cancel(Error('stopped'));
  }
  function resetBugLab() {
    bugStop(); ++BUG.loadId;
    Object.assign(BUG, { cases: null, levels: {}, kinds: {}, cur: null, filter: 0,
      results: {}, hints: {}, explain: {}, owner: null });
  }
  const bugCurrent = (c, run, sid) => bugActive() && bugCase() === c && BUG.runId === run && appState.student?.sid === sid;
  function bugLabHtml() { return '<div id="bugRoot"><p class="fm-note">Загружаю задачи…</p></div>'; }
  async function bugLabInit(target) {
    const sid = appState.student?.sid;
    if (BUG.owner !== sid) { resetBugLab(); BUG.owner = sid; }
    const load = ++BUG.loadId;
    if (!BUG.cases) {
      try {
        const d = await api('lab/bugs');
        if (load !== BUG.loadId || appState.student?.sid !== sid) return;
        BUG.cases = d.cases || []; BUG.levels = d.levels || {}; BUG.kinds = d.kinds || {};
      } catch (e) {
        if (load === BUG.loadId && appState.student?.sid === sid && bugActive()) $('#bugRoot').innerHTML = '<p class="fm-note">Не удалось загрузить задачи. Открой лабораторию ещё раз.</p>';
        return;
      }
    }
    if (!bugActive()) return;
    if (target && BUG.cases.some(c => c.id === target)) BUG.cur = target;
    if (bugCase()) bugRenderCase(); else bugRenderList();
  }
  const bugStatus = c => (c.my.verified ? ['good', 'есть проверенное решение'] : c.my.ok ? ['good', 'самопроверка пройдена'] : c.my.tries ? ['review', `${c.my.tries} ${plural(c.my.tries, 'попытка', 'попытки', 'попыток')}`] : ['', 'новая']);
  function bugRenderList() {
    const all = BUG.cases, done = all.filter(c => c.my.ok).length;
    const list = all.filter(c => !BUG.filter || c.level === BUG.filter);
    const next = all.find(c => !c.my.ok);
    $('#bugRoot').innerHTML = `
      <div class="bug-top"><div class="bug-prog"><b>${done} из ${all.length}</b><span>самопроверок пройдено</span>
          <i class="bug-track"><b style="width:${all.length ? Math.round(done / all.length * 100) : 0}%"></b></i></div>
        ${next ? `<button type="button" class="btn primary" data-bug-open="${esc(next.id)}">${done ? 'Продолжить' : 'Начать'}: «${esc(next.title)}» →</button>` : '<span class="chip good">Все самопроверки пройдены</span>'}</div>
      <p class="lab-note">В каждой задаче — условие и чужое решение. Где-то в нём ошибки, где-то оно не дописано, а где-то работает слишком долго.
        Исправь код и проверь его на примерах. Это самопроверка: программа запускается в твоём браузере. Она не даёт оценку, звёзды или подтверждение самостоятельного решения; код можно затем обсудить с учителем. Кнопка «Проверить на сервере» отдельно запускает присланный код и подтверждает результат тестов.</p>
      <nav class="lab-tabs bug-filter" aria-label="Уровень">${[[0, 'Все'], ...Object.entries(BUG.levels).map(([k, v]) => [+k, v])].map(([k, v]) =>
        `<button type="button" class="${BUG.filter === k ? 'on' : ''}" data-bug-level="${k}">${esc(v)}</button>`).join('')}</nav>
      <div class="bug-grid">${list.map(c => { const [cls, txt] = bugStatus(c); return `<button type="button" class="bug-card${c.my.ok ? ' done' : ''}" data-bug-open="${esc(c.id)}">
        <span class="bug-card-top"><span class="lab-kicker">${esc(c.topic)}</span><span class="chip ${cls}">${txt}</span></span>
        <b>${esc(c.title)}</b><span class="bug-card-sub">${esc(BUG.kinds[c.kind] || '')} · ${esc(BUG.levels[c.level] || '')}</span></button>`; }).join('')}</div>`;
  }
  const bugIntro = c => (c.kind === 'fill' ? 'Решение не дописано — закончи его.' : c.kind === 'speed' ? 'Решение верное, но слишком медленное — ускорь его.'
    : `В решении ${c.bugs} ${plural(c.bugs, 'ошибка', 'ошибки', 'ошибок')} — найди и исправь.`);
  function bugRenderCase() {
    const c = bugCase(), code = bugCode(c), idx = BUG.cases.indexOf(c);
    const [cls, txt] = bugStatus(c);
    const openTests = c.tests.filter(t => t.open);
    $('#bugRoot').innerHTML = `
      <div class="bug-nav"><button type="button" class="link-btn" data-bug-open="">← Все задачи</button>
        <span class="fm-muted">Задача ${idx + 1} из ${BUG.cases.length}</span><span class="chip ${cls}" id="bugChip">${txt}</span></div>
      <div class="bug-work">
        <section class="lab-panel bug-task"><span class="lab-kicker">${esc(c.topic)} · ${esc(BUG.levels[c.level] || '')}</span>
          <h2>${esc(c.title)}</h2><div class="bug-stmt">${safeHtml(c.stmt)}</div>
          <p class="bug-intro"><b>Автор решения — ${esc(c.who)}.</b> ${bugIntro(c)}</p>
          <h3>Примеры</h3>
          <div class="bug-samples">${openTests.map(t => `<div><div><span>Ввод</span><pre>${esc(t.in)}</pre></div><div><span>Должно получиться</span><pre>${esc(t.exp)}</pre></div></div>`).join('')}</div>
          <p class="fm-muted">Всего тестов: ${c.tests.length}. У остальных виден только результат — прошёл или нет.</p>
          <div class="bug-hints" id="bugHints"></div>
        </section>
        <section class="lab-panel bug-editor"><div class="bug-ed-head"><h2>Решение · ${esc(c.who)}</h2><span class="fm-muted" id="bugDiff"></span></div>
          <div class="bug-code ide"><pre class="bug-gutter" id="bugGutter" aria-hidden="true"></pre>
            <div class="ide-area"><pre class="ide-hl bug-hl" id="bugCodeHl" aria-hidden="true"></pre>
            <textarea id="bugCode" class="inp" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" maxlength="20000" aria-label="Код решения">${esc(code)}</textarea></div></div>
          <div class="bug-actions"><button type="button" class="btn primary" id="bugCheck" data-bug-act="check">Самопроверка</button>
            <button type="button" class="btn" id="bugVerify" data-bug-act="verify">Проверить на сервере</button>
            <button type="button" class="btn" id="bugStop" data-bug-act="stop" hidden>Остановить</button>
            <button type="button" class="btn" data-bug-act="hint" id="bugHintBtn"></button>
            <button type="button" class="btn ghost" data-bug-act="reset">Сбросить код</button>
            <button type="button" class="btn ghost" data-bug-act="explain" id="bugExplainBtn" hidden>Показать разбор</button></div>
          <p class="lab-status" id="bugStatus" role="status">Ctrl+Enter — самопроверка. Код выполняется в браузере; это не независимая проверка решения.</p>
          <details class="bug-own"><summary>Запустить на своих данных</summary>
            <textarea class="inp" id="bugStdin" rows="3" maxlength="10000" spellcheck="false" placeholder="Входные данные для input()"></textarea>
            <button type="button" class="btn" data-bug-act="run" id="bugOwnRun">Запустить</button><pre id="bugOwnOut" class="bug-out" hidden></pre></details>
          <div id="bugResult"></div>
        </section></div>`;
    bugSyncEditor(); bugRenderHints(); bugRenderResult();
  }
  function bugSyncEditor() {
    const c = bugCase(), ta = $('#bugCode');
    if (!c || !ta) return;
    const lines = ta.value.split('\n'), ch = bugChanged(c.code, ta.value);
    $('#bugGutter').innerHTML = lines.map((_, i) => `<span class="${ch.has(i) ? 'ch' : ''}">${i + 1}</span>`).join('\n');
    $('#bugGutter').scrollTop = ta.scrollTop;
    $('#bugCodeHl').innerHTML = '<div class="ide-hl-in">' + highlightPy(ta.value) + '\n</div>';
    bugScrollHl();
    ta.style.height = Math.max(180, Math.min(620, lines.length * 22 + 24)) + 'px';
    $('#bugDiff').textContent = ta.value.replace(/\s+$/, '') === c.code.replace(/\s+$/, '') ? 'код не менялся' : `изменено строк: ${ch.size}`;
  }
  function bugRenderHints() {
    const c = bugCase(), n = BUG.hints[c.id] || 0;
    $('#bugHints').innerHTML = n ? `<h3>Подсказки</h3><ol>${c.hints.slice(0, n).map(h => `<li>${safeHtml(h)}</li>`).join('')}</ol>` : '';
    const b = $('#bugHintBtn');
    b.textContent = n >= c.hints.length ? 'Подсказок больше нет' : `Подсказка ${n + 1} из ${c.hints.length}`;
    b.disabled = n >= c.hints.length;
    $('#bugExplainBtn').hidden = !(c.my.ok || c.my.tries >= 3) || !!BUG.explain[c.id];
  }
  const bugExplainHtml = list => `<div class="bug-explain"><h3>Что было не так</h3><ul>${list.map(x => `<li>${safeHtml(x)}</li>`).join('')}</ul></div>`;
  function bugRenderResult() {
    const c = bugCase(), r = BUG.results[c.id], box = $('#bugResult');
    if (!box) return;
    if (!r) { box.innerHTML = BUG.explain[c.id] ? bugExplainHtml(BUG.explain[c.id]) : ''; return; }
    const rows = r.tests.map((t, i) => {
      const run = r.runs?.[i] || {}, src = c.tests[i];
      const got = r.verified ? (t.ok ? 'тест пройден' : 'тест не пройден') : run.timeout ? (run.skipped ? 'не запускался' : 'не дождались ответа — программа работает слишком долго')
        : run.err ? bugErrText(run) : (run.out || '').trim() || '(пусто)';
      return `<tr class="${t.ok ? 'ok' : 'bad'}"><td>${t.ok ? '✓' : '✗'}</td><td>${i + 1}</td>
        <td>${t.open ? `<pre>${esc(src.in)}</pre>` : '<span class="fm-muted">скрытый тест</span>'}</td>
        <td>${t.open ? `<pre>${esc(t.exp)}</pre>` : '<span class="fm-muted">—</span>'}</td>
        <td>${t.ok && !t.open ? '<span class="fm-muted">верно</span>' : `<pre>${esc(String(got).slice(0, 400))}</pre>`}</td></tr>`;
    }).join('');
    const pass = r.tests.filter(t => t.ok).length;
    const idx = BUG.cases.indexOf(c), nxt = BUG.cases.slice(idx + 1).concat(BUG.cases.slice(0, idx)).find(x => !x.my.ok);
    const head = r.ok ? `<div class="bug-win"><b>${r.verified ? 'Код проверен на сервере' : 'Самопроверка пройдена'}</b>
        <span>${r.verified ? 'Присланный код прошёл все тесты при отдельном запуске.' : 'По выводам из браузера все примеры совпали. Независимая проверка кода не проводилась.'} Изменено строк: ${r.changed}.</span>
        <span class="bug-win-btns">${nxt ? `<button type="button" class="btn primary" data-bug-open="${esc(nxt.id)}">Следующая задача →</button>` : ''}<button type="button" class="btn" data-bug-open="">К списку задач</button></span></div>`
      : `<div class="bug-fail"><b>Пройдено тестов: ${pass} из ${r.tests.length}</b><span>Посмотри, на каком примере ответ расходится, и найди строку, которая за это отвечает.</span></div>`;
    box.innerHTML = `${head}${(r.explain || BUG.explain[c.id]) ? bugExplainHtml(r.explain || BUG.explain[c.id]) : ''}
      <div class="bug-table"><table><thead><tr><th></th><th>№</th><th>Ввод</th><th>Ожидалось</th><th>Получено</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function bugSetBusy(on, text) {
    BUG.busy = on;
    for (const id of ['bugCheck', 'bugVerify', 'bugCode', 'bugOwnRun']) if ($('#' + id)) $('#' + id).disabled = on;
    if ($('#bugStop')) $('#bugStop').hidden = !on;
    if (text && $('#bugStatus')) $('#bugStatus').textContent = text;
  }
  /** Выполнить код на наборе входных данных. Возвращает [{out, err, kind, line} | {timeout, skipped}] по каждому входу. */
  function bugRunAll(code, inputs) {
    return new Promise((resolve, reject) => {
      const runs = [];
      let worker;
      try { worker = new EgePythonWorker('lab-worker.js' + (RULES.py_local ? '?local=1' : '')); } catch (e) { reject(Error('Браузер не смог запустить Python.')); return; }
      BUG.worker = worker;
      BUG.cancel = reject;
      const fail = message => { bugReleaseWorker(); reject(Error(message)); };
      const finish = () => {
        bugReleaseWorker();
        const missing = runs.length;
        for (let i = missing; i < inputs.length; i++) runs.push({ timeout: true, skipped: i > missing });
        resolve(runs);
      };
      BUG.timer = setTimeout(() => fail('Python не успел загрузиться. Проверь интернет и повтори.'), 90000);
      worker.onmessage = e => {
        if (BUG.worker !== worker) return;
        const m = e.data;
        if (m.type === 'tests-start') { clearTimeout(BUG.timer); BUG.timer = setTimeout(finish, 12000); bugSetBusy(true, 'Выполняю программу на тестах…'); }
        else if (m.type === 'test') { runs[m.i] = m.result; clearTimeout(BUG.timer); BUG.timer = setTimeout(finish, 12000); }   // на каждый тест — до 12 секунд
        else if (m.type === 'tests-done') finish();
        else if (m.type === 'tests-error') fail(m.text);
        else if (m.type === 'done' && !m.ok) fail('Не удалось загрузить Python. Проверь интернет и повтори.');
      };
      worker.onerror = () => { if (BUG.worker === worker) fail('Не удалось запустить Python. Обнови страницу и попробуй ещё раз.'); };
      worker.postMessage({ type: 'tests', code, inputs });
    });
  }
  async function bugCheck() {
    const c = bugCase();
    if (!c || BUG.busy) return;
    const code = $('#bugCode').value;
    if (!code.trim()) { $('#bugStatus').textContent = 'Код пустой — нажми «Сбросить код», чтобы вернуть исходное решение.'; return; }
    bugStop();
    const run = BUG.runId, sid = appState.student?.sid;
    bugSetBusy(true, 'Загружаю Python… При первом запуске это может занять около минуты.');
    let runs;
    try { runs = await bugRunAll(code, c.tests.map(t => t.in)); }
    catch (e) { if (bugCurrent(c, run, sid)) bugSetBusy(false, e.message === 'stopped' ? 'Остановлено.' : e.message); return; }
    if (!bugCurrent(c, run, sid)) return;
    let r;
    try { r = await api('lab/bugs/check', { id: c.id, code, runs: runs.map(x => ({ out: String(x.out || '').slice(0, 6000), err: x.err ? 1 : 0, timeout: x.timeout ? 1 : 0 })) }); }
    catch (e) { if (bugCurrent(c, run, sid)) bugSetBusy(false, e.message || 'Не удалось проверить — попробуй ещё раз.'); return; }
    if (!bugCurrent(c, run, sid)) return;
    c.my = r.my;
    BUG.results[c.id] = { ok: r.ok, tests: r.tests, runs, changed: r.changed, par: r.par, star: r.ok && r.changed <= r.par && !!r.my.star, explain: r.explain };
    if (r.explain) BUG.explain[c.id] = r.explain;
    bugSetBusy(false, r.ok ? 'Самопроверка: примеры совпали. Это не оценка за решение.' : 'Есть тесты, которые не прошли. Таблица — ниже.');
    const [cls, txt] = bugStatus(c);
    $('#bugChip').className = 'chip ' + cls; $('#bugChip').textContent = txt;
    bugRenderHints(); bugRenderResult();
    $('#bugResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  async function bugVerify() {
    const c = bugCase();
    if (!c || BUG.busy) return;
    const code = $('#bugCode').value;
    if (!code.trim()) { $('#bugStatus').textContent = 'Сначала введи код решения.'; return; }
    bugStop();
    const run = BUG.runId, sid = appState.student?.sid;
    bugSetBusy(true, 'Проверяю код на сервере… Это может занять до двух минут.');
    // Closing the exercise only detaches its view; it does not pretend to cancel the server job.
    $('#bugStop').hidden = true;
    try {
      const r = await api('lab/bugs/verify', { id: c.id, code });
      if (!bugCurrent(c, run, sid)) return;
      if (r.verified !== true || r.provenance !== 'server_python') throw Error('Сервер не подтвердил независимую проверку. Результат не засчитан.');
      c.my = r.my;
      BUG.results[c.id] = { ...r, runs: [] };
      if (r.explain) BUG.explain[c.id] = r.explain;
      bugSetBusy(false, r.ok ? 'Код прошёл независимую проверку на сервере.' : 'Код проверен на сервере: есть непройденные тесты.');
      const [cls, txt] = bugStatus(c);
      $('#bugChip').className = 'chip ' + cls; $('#bugChip').textContent = txt;
      bugRenderHints(); bugRenderResult();
      $('#bugResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      if (bugCurrent(c, run, sid)) bugSetBusy(false, e.message || 'Не удалось проверить код. Результат не засчитан.');
    }
  }
  async function bugRunOwn() {
    const c = bugCase(), out = $('#bugOwnOut');
    if (!c || BUG.busy) return;
    bugStop();
    const run = BUG.runId, sid = appState.student?.sid;
    bugSetBusy(true, 'Загружаю Python…');
    out.hidden = false; out.textContent = 'Выполняю…';
    try {
      const [r] = await bugRunAll($('#bugCode').value, [$('#bugStdin').value]);
      if (!bugCurrent(c, run, sid)) return;
      out.textContent = r.timeout ? 'Не дождались ответа — программа работает слишком долго.' : `${r.out || ''}${r.err ? `${r.out ? '\n' : ''}${bugErrText(r)}\n${r.err.trim()}` : ''}` || '(программа ничего не вывела)';
      bugSetBusy(false, 'Запуск завершён.');
    } catch (e) { if (bugCurrent(c, run, sid)) { out.textContent = e.message; bugSetBusy(false, e.message); } }
  }
  trainerEl.addEventListener('click', async e => {
    if (!bugActive()) return;
    const open = e.target.closest('[data-bug-open]');
    if (open) { bugStop(); BUG.cur = open.dataset.bugOpen || null; if (BUG.cur) bugRenderCase(); else bugRenderList(); window.scrollTo(0, 0); return; }
    const lvl = e.target.closest('[data-bug-level]');
    if (lvl) { BUG.filter = +lvl.dataset.bugLevel; bugRenderList(); return; }
    const act = e.target.closest('[data-bug-act]')?.dataset.bugAct, c = bugCase();
    if (!act || !c) return;
    if (act === 'check') bugCheck();
    if (act === 'verify') bugVerify();
    if (act === 'run') bugRunOwn();
    if (act === 'stop') { bugStop(); bugSetBusy(false, 'Остановлено.'); }
    if (act === 'hint') { BUG.hints[c.id] = Math.min(c.hints.length, (BUG.hints[c.id] || 0) + 1); bugRenderHints(); }
    if (act === 'reset') {
      if ($('#bugCode').value !== c.code && !confirm('Вернуть исходное решение? Твои правки пропадут.')) return;
      bugStop(); bugSetBusy(false);
      $('#bugCode').value = c.code; try { localStorage.removeItem(bugDraftKey(c.id)); } catch (x) { /* не страшно */ }
      delete BUG.results[c.id]; bugSyncEditor(); bugRenderResult(); $('#bugStatus').textContent = 'Код возвращён к исходному.';
    }
    if (act === 'explain') {
      if (!c.my.ok && !confirm('Показать разбор ошибок? Сначала попробуй объяснить, почему исходная программа ошибалась.')) return;
      const run = BUG.runId, sid = appState.student?.sid;
      try { const r = await api('lab/bugs/explain', { id: c.id }); if (!bugCurrent(c, run, sid)) return; BUG.explain[c.id] = r.explain; if (!c.my.ok) c.my.seen = 1; bugRenderHints(); bugRenderResult(); }
      catch (x) { if (bugCurrent(c, run, sid)) toast(x.message || 'Не получилось открыть разбор', 3500); }
    }
  });
  trainerEl.addEventListener('input', e => {
    if (!bugActive() || e.target.id !== 'bugCode') return;
    const c = bugCase();
    writeJSON(bugDraftKey(c.id), { code: e.target.value });
    bugSyncEditor();
  });
  function bugScrollHl() {
    const ta = $('#bugCode'), inner = $('#bugCodeHl')?.firstElementChild;
    if (ta && inner) inner.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  }
  trainerEl.addEventListener('scroll', e => { if (e.target.id === 'bugCode' && $('#bugGutter')) { $('#bugGutter').scrollTop = e.target.scrollTop; bugScrollHl(); } }, true);
  trainerEl.addEventListener('keydown', e => {
    if (!bugActive() || !bugCase()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); bugCheck(); return; }
    if (e.target.id === 'bugCode' && e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); const t = e.target; t.setRangeText('    ', t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  new MutationObserver(() => { if (!bugActive()) bugStop(); }).observe(trainerEl, { childList: true });
  window.addEventListener('pagehide', bugStop);

  return { openCourse, openLesson, openCourseSet, openPyc, openPycLevel, openLab, openLabAssignment, openArdGate, pycStopTests, labStop, pycDockTools, resetLearningState, refreshLearningAccess };
};
