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
  const PYC_WORKSHOPS = {
    m24: ['m33', 'Открыть тренажёр регулярных выражений'],
    m25: ['m34', 'Открыть тренажёр поиска чисел'],
    m26: ['m35', 'Открыть тренажёр журнала событий'],
    m27: ['m36', 'Открыть тренажёр кластеризации по энергии'],
    m32: ['m36', 'Открыть тренажёр кластеризации по энергии'],
  };
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
      ${PYC_WORKSHOPS[mid] ? `<button type="button" class="btn" data-pyc-lv="${PYC_WORKSHOPS[mid][0]}:0">${PYC_WORKSHOPS[mid][1]}</button>` : ''}
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
    const graded = t.practice?.graded;
    return `<div class="pyc-task ${st}" id="pt-${esc(t.id.replace('.', '-'))}" data-pyc-task="${esc(t.id)}">
      <div class="pyc-th"><span class="pyc-tn">${t.ok ? '✓' : i + 1}</span><b>${esc(t.h)}</b><span class="pyc-stars" title="сложность">${PYC_STARS(t.stars || 1)}</span>
        <span class="pyc-st">${t.ok ? (t.independent ? 'решено самостоятельно' : t.solution_seen ? 'решено после разбора' : t.hint_used ? 'решено с подсказкой' : 'решено') : t.tries ? `попыток: ${t.tries}` : ''}</span></div>
      <div class="cond pyc-cond">${safeHtml(t.cond)}</div>
      ${pycFilesHtml(t.files)}
      ${graded ? `<div class="learning-practice"><b>Пример ввода</b><pre>${esc(t.practice.stdin.trim())}</pre><b>Вывод</b><pre>${esc(t.practice.cases[0].output)}</pre>
        <p>Напиши программу в редакторе Python. Для зачёта она должна дать верный вывод на каждом наборе.</p></div>` :
        t.practice ? `<div class="learning-practice"><b>Программа должна работать на разных данных</b><p>Первый ввод: <code>${esc(t.practice.stdin.trim())}</code>. Напиши программу, открой Python и проверь тесты. В поле ответа отправь вывод для первого ввода.</p><pre>${esc(t.practice.cases.map((c, i) => `Пример ${i+1}: ввод ${JSON.stringify(c.input.trim())} → ${c.output}`).join('\n'))}</pre></div>` : ''}
      ${t.regex ? pycRegexHtml(t) : t.worksheet ? pycSheetHtml(t) : `<div class="pyc-act">
        <button type="button" class="btn" data-pyc-py="${esc(t.id)}">▶ Решать в Python</button>
        <button type="button" class="btn" data-learning-lab="task" data-task="${esc(t.id)}">По шагам в лаборатории</button>
        ${t.practice ? `<button type="button" class="btn" data-pyc-tests="${esc(t.id)}">Проверить код на ${t.practice.cases.length} примерах</button>` : ''}
        ${graded ? '' : `<form class="pyc-form" data-pyc-form="${esc(t.id)}" autocomplete="off">
          <input class="inp pyc-ans" maxlength="300" placeholder="${t.ok ? 'Решено ✓' : 'Ответ'}" value="${t.ok && t.ans ? esc(t.ans) : ''}"${t.ok ? ' readonly' : ''}>
          ${t.ok ? '' : '<button type="submit" class="btn primary">Проверить</button>'}
        </form>`}
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
        ${t.ok && t.ans && !t.regex && !t.worksheet && !t.practice?.graded ? `<span class="sl-ok"><i aria-hidden="true">✓</i>Ответ: <b>${esc(t.ans)}</b></span>` : ''}</div></details>`;
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
      if (data.outputs && PY.task?.id === 'pyc:' + id) $('#pycDockStatus').textContent = msg.textContent;
      netError(e); return;
    }
    if (!current() || !box.isConnected) return;
    if (btn) btn.disabled = false;
    const t = pycTask(id);
    if (!t) return;
    if (r.verified_rows) {
      pycSheetResult(t, form, data.rows);
      msg.className = 'pyc-msg'; msg.textContent = `Шаг ${r.verified_rows} принят.`;
      return;
    }
    t.tries = r.tries;
    PYC.progress[id] = { ok: r.ok || t.ok, tries: r.tries };
    if (r.sol) t.sol = r.sol;
    if (r.ok) {
      t.ok = true;
      t.ans = r.ans;
      if (t.worksheet) writeJSON(pycSheetKey(t), null);
      if (t.practice?.graded && PY.task?.id === 'pyc:' + id) $('#pycDockStatus').textContent = 'Все наборы пройдены. Задача зачтена.';
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
    if (r.cell && t.worksheet) {
      pycSheetResult(t, form, data.rows, r.cell);
      const field = t.worksheet.fields[r.cell.column];
      msg.textContent = `Шаг ${r.cell.row + 1}, поле «${field.label}». ${field.tip}`;
    } else if (r.case_error && t.practice?.graded) {
      const i = r.case_error.index;
      msg.textContent = `Набор ${i + 1}. Ввод:\n${t.practice.cases[i].input.trim()}\nОжидалось: ${r.case_error.expected}\nПолучено: ${data.outputs[i].trim() || '(пусто)'}`;
      if (PY.task?.id === 'pyc:' + id) $('#pycDockStatus').textContent = msg.textContent;
    } else if (r.mismatch && t.regex) msg.innerHTML = pycRegexMismatch(t, data.matches, r.mismatch);
    else msg.textContent = 'Неверно — проверьте программу и вопрос задачи';
    msg.className = 'pyc-msg bad';
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    if (r.sol && !box.querySelector('.pyc-sol')) box.insertAdjacentHTML('beforeend', pycSolHtml(t));
  }

  trainerEl.addEventListener('click', e => {
    if (!appState.courseShown || appState.pageKind !== 'pyc') return;
    const focus = e.target.closest('[data-pyc-focus]');
    if (focus && PYC_L) {
      if (PYC_FOCUS !== focus.dataset.pycFocus) {
        PYC_FOCUS = focus.dataset.pycFocus;
        openPycLevel(PYC_L.id, PYC_L.l, true);
      }
      return;
    }
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
    const outputs = [];
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
      if (task.practice.graded) outputs.push(output.trim());
      else if (norm(output) !== norm(test.output)) { finish(`Пример ${index+1}: ожидалось «${test.output}», получено «${output.trim()}». Исправь программу.`); return; }
      passed++; index++;
      if (index < task.practice.cases.length) { next(); return; }
      if (!task.practice.graded) { finish(`Учебная проверка: ${passed} из ${index} примеров пройдены. Для зачёта отправь ответ для первого ввода.`); return; }
      finish('Сверяю ответы…');
      button.disabled = true; $('#pycDockTests').disabled = true;
      pycSubmit(id, box, {outputs, code}).finally(() => { button.disabled = false; $('#pycDockTests').disabled = false; });
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
