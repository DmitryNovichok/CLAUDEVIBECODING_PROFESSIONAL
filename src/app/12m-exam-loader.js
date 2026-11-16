  // Less frequently opened exam sections load only after an explicit navigation.
  // The server fingerprints data-exams-src independently of the main bundle.
  let IM_OK = false, IM_PW = false;
  const examSectionsSrc = document.currentScript?.dataset.examsSrc || 'app-exams.js';
  let examSectionsPromise = null, examOpenGeneration = 0;
  function loadExamSections() {
    if (examSectionsPromise) return examSectionsPromise;
    examSectionsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); return; }
        try {
          if (typeof window.EgeExamSections !== 'function') throw Error('Раздел не загрузился. Повторите открытие.');
          const sections = window.EgeExamSections({ $, $$, api, esc, plural, safeHtml, toast,
            trainerEl, hubRefresh, renderMath, toggleCalc,
            appState: {
              get courseShown() { return courseShown; }, get pageKind() { return pageKind; },
              get student() { return student; },
              set imOk(value) { IM_OK = value; }, set imPw(value) { IM_PW = value; },
            } });
          if (typeof sections?.openMcko !== 'function' || typeof sections?.openIm !== 'function') {
            throw Error('Раздел загрузился не полностью. Повторите открытие.');
          }
          delete window.EgeExamSections;
          resolve(sections);
        } catch (error) { script.remove(); reject(error); }
      };
      const timer = setTimeout(() => finish(Error('Загрузка раздела заняла слишком долго. Повторите открытие.')), 20000);
      script.src = examSectionsSrc;
      script.onload = () => finish();
      script.onerror = () => finish(Error('Не удалось загрузить раздел. Проверьте соединение и повторите.'));
      document.head.appendChild(script);
    }).catch(error => { examSectionsPromise = null; throw error; });
    return examSectionsPromise;
  }
  async function openExamSection(kind) {
    if (!leaveExam()) return;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true; pageKind = kind; cur = null;
    const generation = ++examOpenGeneration, sid = student?.sid;
    const active = () => generation === examOpenGeneration && courseShown && pageKind === kind && student?.sid === sid;
    navPush({ v: kind }); renderSidebar();
    const title = kind === 'mcko' ? 'МЦКО' : 'Интеллектуальный мегаполис';
    $('#scopeInfo').innerHTML = `<span class="scope-title">${title}</span>`;
    trainerEl.innerHTML = `<div class="${kind === 'mcko' ? 'mk' : 'im'}" aria-busy="true"><p class="fm-note" role="status">Загружаю раздел…</p></div>`;
    window.scrollTo(0, 0);
    try {
      const sections = await loadExamSections();
      if (!active()) return;
      trainerEl.firstElementChild?.removeAttribute('aria-busy');
      await sections[kind === 'mcko' ? 'openMcko' : 'openIm']();
    } catch (error) {
      if (!active()) return;
      trainerEl.innerHTML = `<section class="fm-note"><p role="alert">${esc(error.message || 'Не удалось загрузить раздел.')}</p><button type="button" class="btn" data-exam-retry>Повторить загрузку</button></section>`;
      trainerEl.querySelector('[data-exam-retry]').addEventListener('click', () => openExamSection(kind));
    }
  }
  function openMcko() { return openExamSection('mcko'); }
  function openIm() { return openExamSection('im'); }
