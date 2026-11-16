  // Course and laboratory UI share one optional script; ordinary Python and
  // permission updates stay synchronous and do not trigger a download.
  let PYC_OK = false, PYC_PW = false, PYC_PY = null;
  let LAB_OK = false, ARD_OK = false, ARD_PW = false;
  let learningSections = null, learningSectionsPromise = null, learningOpenGeneration = 0;
  const learningSectionsSrc = document.currentScript?.dataset.learningSrc || 'app-learning.js';
  function pycSetAccess(on, pw) {
    PYC_OK = !!on;
    if (pw !== undefined) PYC_PW = !!pw;
    $('#pycCard')?.classList.toggle('locked', !PYC_OK);
  }
  async function pycLive() {
    const sid = student?.sid;
    try {
      const me = await api('me');
      if (student?.sid !== sid) return;
      pycSetAccess(me.pyc, me.pyc_pw);
      COURSE_OK = !!me.course; $('#courseCard')?.classList.toggle('locked', !COURSE_OK);
      LAB_OK = !!me.lab; ARD_OK = !!me.ard; ARD_PW = !!me.ard_pw; IM_OK = !!me.im; IM_PW = !!me.im_pw;
      $('#labCard')?.classList.toggle('locked', !LAB_OK);
    } catch (error) { return; }
    learningSections?.refreshLearningAccess();
  }
  function pycStopTests() { learningSections?.pycStopTests(); }
  function labStop() { learningSections?.labStop(); }
  function pycDockTools(task) {
    if (learningSections) learningSections.pycDockTools(task);
    else { const tools = $('#pycDockTools'); if (tools) tools.hidden = true; }
  }
  function resetLearningSession() {
    ++learningOpenGeneration;
    learningSections?.resetLearningState();
    DECK = null; deckI = 0; PYC_PY = null;
  }
  function loadLearningSections() {
    if (learningSectionsPromise) return learningSectionsPromise;
    learningSectionsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); return; }
        try {
          if (typeof window.EgeLearningSections !== 'function') throw Error('Раздел не загрузился. Повторите открытие.');
          const sections = window.EgeLearningSections({ $, $$, ARCHIVE, COURSE, COURSE_SETS, COURSE_SET_NOTES, EgePythonWorker, MARK, MARK_BTN, NUM_TOPIC, PY, PY_KW, RULES, SERVER, TASKS, abandonCurrent, api, asgLeft, badgeCls, bdOpen, byId, codeKey, courseSet, esc, highlightPy, htmlWait, isNarrow, leaveExam, loadCourseSets, markAttach, navPush, needHtml, netError, numLabel, numStats, openSetTask, pct, plural, pyOpen, pySync, pycSetAccess, readCode, readJSON, renderMath, renderSidebar, safeHtml, setScope, setSideOpen, toast, toggleBoard, togglePy, trainerEl, visible, writeCode, writeJSON,
            appState: {
              get student() { return student; }, get P() { return P; },
              get courseShown() { return courseShown; }, set courseShown(value) { courseShown = value; },
              get pageKind() { return pageKind; }, set pageKind(value) { pageKind = value; },
              get cur() { return cur; }, set cur(value) { cur = value; },
              get COURSE_OK() { return COURSE_OK; }, set COURSE_OK(value) { COURSE_OK = value; },
              get PYC_OK() { return PYC_OK; }, set PYC_OK(value) { PYC_OK = value; },
              get PYC_PW() { return PYC_PW; }, set PYC_PW(value) { PYC_PW = value; },
              get PYC_PY() { return PYC_PY; }, set PYC_PY(value) { PYC_PY = value; },
              get DECK() { return DECK; }, set DECK(value) { DECK = value; },
              get deckI() { return deckI; }, set deckI(value) { deckI = value; },
              get LAB_OK() { return LAB_OK; }, set LAB_OK(value) { LAB_OK = value; },
              get ARD_OK() { return ARD_OK; }, set ARD_OK(value) { ARD_OK = value; },
              get ARD_PW() { return ARD_PW; }, set ARD_PW(value) { ARD_PW = value; },
              get IM_OK() { return IM_OK; }, set IM_OK(value) { IM_OK = value; },
              get IM_PW() { return IM_PW; }, set IM_PW(value) { IM_PW = value; },
            } });
          for (const name of ['openCourse', 'openLesson', 'openCourseSet', 'openPyc', 'openPycLevel', 'openLab', 'openArdGate', 'pycStopTests', 'labStop', 'pycDockTools', 'resetLearningState', 'refreshLearningAccess']) {
            if (typeof sections?.[name] !== 'function') throw Error('Раздел загрузился не полностью. Повторите открытие.');
          }
          learningSections = sections;
          delete window.EgeLearningSections;
          resolve(sections);
        } catch (error) { script.remove(); reject(error); }
      };
      const timer = setTimeout(() => finish(Error('Загрузка раздела заняла слишком долго. Повторите открытие.')), 20000);
      script.src = learningSectionsSrc;
      script.onload = () => finish();
      script.onerror = () => finish(Error('Не удалось загрузить раздел. Проверьте соединение и повторите.'));
      document.head.appendChild(script);
    }).catch(error => { learningSectionsPromise = null; throw error; });
    return learningSectionsPromise;
  }
  function openLearningSection(method, args, route, kind, title) {
    // Cached entry points run immediately, retaining the original navigation
    // semantics for history, Python tools and course -> lab -> lesson returns.
    if (learningSections) return learningSections[method](...args);
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent(); courseShown = true; pageKind = kind; cur = null;
    const generation = ++learningOpenGeneration, sid = student?.sid;
    const active = () => generation === learningOpenGeneration && courseShown && pageKind === kind && student?.sid === sid;
    navPush(route); renderSidebar();
    $('#scopeInfo').innerHTML = `<span class="scope-title">${title}</span>`;
    trainerEl.innerHTML = '<section class="fm-note" aria-busy="true"><p role="status">Загружаю раздел…</p></section>';
    window.scrollTo(0, 0);
    return loadLearningSections().then(sections => {
      if (!active()) return;
      return sections[method](...args);
    }).catch(error => {
      if (!active()) return;
      trainerEl.innerHTML = `<section class="fm-note"><p role="alert">${esc(error.message || 'Не удалось загрузить раздел.')}</p><button type="button" class="btn" data-learning-retry>Повторить загрузку</button></section>`;
      trainerEl.querySelector('[data-learning-retry]').addEventListener('click', () => openLearningSection(method, args, route, kind, title));
    });
  }
  function openCourse() { return openLearningSection('openCourse', [], { v: 'course' }, null, 'Курс ЕГЭ'); }
  function openLesson(n) { return openLearningSection('openLesson', [n], { v: 'lesson', n }, null, 'Курс ЕГЭ'); }
  function openCourseSet(id) { return openLearningSection('openCourseSet', [id], { v: 'set', id }, null, 'Подборка курса'); }
  function openPyc() { return openLearningSection('openPyc', [], { v: 'pyc' }, 'pyc', 'Курс Python'); }
  function openPycLevel(mid, li, keepScroll) { return openLearningSection('openPycLevel', [mid, li, keepScroll], { v: 'pycl', m: mid, l: li }, 'pyc', 'Курс Python'); }
  function openLab(view = '', context) {
    if (view === 'arduino') return openArdGate();
    return openLearningSection('openLab', [view, context], { v: 'lab', tab: view }, 'lab', 'Лаборатория');
  }
  function openArdGate() { return openLearningSection('openArdGate', [], { v: 'ardgate' }, 'ardgate', 'Лаборатория Arduino'); }
  $('#pycCard')?.addEventListener('click', () => openPyc());
  $('#labCard')?.addEventListener('click', () => openLab());
