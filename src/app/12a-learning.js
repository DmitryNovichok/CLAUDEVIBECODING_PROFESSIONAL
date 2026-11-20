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
