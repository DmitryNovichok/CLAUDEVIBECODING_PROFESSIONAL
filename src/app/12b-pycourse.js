  // ------------------------------------------------------------ курс «Программирование для ЕГЭ» (закрытый)
  // Вход — по паролю курса, как у раздела «Курс» (пароль задаёт учитель). Модуль = тема, внутри лестница уровней:
  // следующий уровень открывается, когда в текущем решено need задач. Ответы проверяет сервер.
  let PYC_OK = false;
  let PYC_PW = false;                    // учитель задал пароль курса — на экране с замком есть поле для пароля
  let PYC = null;                        // план курса и прогресс с сервера
  let PYC_L = null;                      // открытый уровень
  let PYC_PY = null;                     // задача (или пример со слайда), с которой открыт редактор Python
  const PYC_STARS = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));
  const pycDone = id => !!((PYC && PYC.progress[id]) || {}).ok;
  const pycModDone = m => m.levels.reduce((a, lv) => a + lv.tasks.filter(pycDone).length, 0);
  const pycModTotal = m => m.levels.reduce((a, lv) => a + lv.tasks.length, 0);
  const pycLabel = m => (m.n ? `№${m.n === 19 ? '19–21' : m.n}` : 'Старт');

  function pycSetAccess(on, pw) {
    PYC_OK = !!on;
    if (pw !== undefined) PYC_PW = !!pw;
    $('#pycCard')?.classList.toggle('locked', !PYC_OK);   // кнопка видна всем; без доступа — с замком
  }
  async function pycLoad() {
    PYC = await api('pyc');
    if (!PYC.access) { pycSetAccess(false, PYC.pw); return false; }
    pycSetAccess(true);
    return true;
  }
  function pycLock(msg) {
    $('#scopeInfo').innerHTML = '<span class="scope-title">Программирование</span>';
    if (msg || !PYC_PW) {
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
      const m = $('#pycPwMsg');
      m.textContent = '';
      try {
        await api('pyc/unlock', { password: $('#pycPw').value });
        pycSetAccess(true);
        toast('Курс открыт 🐍', 2500);
        openPyc();
      } catch (err) { m.textContent = err.message || 'Не получилось — попробуйте ещё раз'; }
    });
  }
  function pycEnter() {
    if (!leaveExam()) return false;
    if (isNarrow()) setSideOpen(false);
    abandonCurrent();
    courseShown = true;
    pageKind = 'pyc';
    cur = null;
    document.querySelectorAll('.rail-btn.on').forEach(b => b.classList.remove('on'));
    $('#pycCard')?.classList.add('on');
    document.body.classList.add('asg-wide');
    return true;
  }

  /** План курса: модули по группам, у каждого — лестница уровней. */
  async function openPyc() {
    if (!pycEnter()) return;
    navPush({ v: 'pyc' });
    PYC_L = null;
    try { await pycLoad(); } catch (e) { if (e.status !== 401) netError(e); return; }
    if (!courseShown || pageKind !== 'pyc') return;
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
      ['ege', 'Задания ЕГЭ', 'Каждый номер — от базы до максимума: все приёмы и ловушки']];
    $('#scopeInfo').innerHTML = `<span class="scope-title">Программирование</span><span class="scope-stats">${done} из ${all} задач</span>`;
    trainerEl.innerHTML = `<div class="course pyc">
      <div class="crs-hero pyc-hero"><div><div class="crs-kicker">Закрытый курс Egeshka</div><h2>Программирование для ЕГЭ</h2>
        <p>Python от первой строчки до самых сложных номеров. Каждая тема — лестница уровней: короткая теория с примерами, которые можно запустить,
          и задачи с проверкой. Ответ — то, что напечатала ваша программа.</p></div>
        <div class="crs-prog"><b>${done}</b><span>из ${all} задач решено</span><i class="xp-bar"><b style="width:${all ? pct(done / all) : 0}%"></b></i></div></div>
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
  async function openPycLevel(mid, li, keepScroll) {
    if (!(courseShown && pageKind === 'pyc') && !pycEnter()) return;
    navPush({ v: 'pycl', m: mid, l: li });
    let d;
    try {
      if (!PYC) await pycLoad();
      d = await api(`pyc/level?m=${encodeURIComponent(mid)}&l=${li}`);
    } catch (e) {
      if (e.status === 403) { if (PYC && PYC.access) { toast(e.message, 4000); return openPyc(); } pycLock(); return; }
      netError(e); return;
    }
    if (!courseShown || pageKind !== 'pyc') return;
    const y = window.scrollY;
    PYC_L = d;
    const m = PYC.modules.find(x => x.id === mid) || { levels: [], open: 1 };
    const lv = d.level, has = lv.slides.length;
    DECK = has ? { n: `pyc:${mid}:${li}`, label: `${pycLabel(d)} · уровень ${li + 1}`, pyc: true, slides: lv.slides } : null;
    if (!keepScroll) deckI = 0;
    const done = lv.tasks.filter(t => t.ok).length;
    $('#scopeInfo').innerHTML = `<span class="scope-title">Программирование · ${esc(pycLabel(d))}</span><span class="scope-stats">уровень ${li + 1} из ${d.levels}</span>`;
    trainerEl.innerHTML = `<div class="course lesson pyc">
      <button type="button" class="link-btn crs-back" data-pyc-home>← К плану курса</button>
      <div class="crs-l-head"><span class="pyc-mod-ic">${d.icon}</span><div><div class="crs-kicker">${esc(pycLabel(d))} · ${esc(d.title)}</div>
        <h2>Уровень ${li + 1}. ${esc(lv.title)}</h2><small class="pyc-goal">${esc(lv.goal)}</small></div></div>
      <div class="pyc-tabs">${m.levels.map((x, i) => `<button type="button" class="${i === li ? 'on' : ''}${i >= m.open ? ' lock' : ''}" data-pyc-lv="${mid}:${i}"
        ${i >= m.open ? 'disabled' : ''}>${i >= m.open ? '🔒 ' : ''}${i + 1}. ${esc(x.title)}</button>`).join('')}</div>
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
      <div class="pyc-tasks">${lv.tasks.map((t, i) => pycTaskHtml(t, i)).join('')}</div>
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
        <span class="pyc-st">${t.ok ? 'решено' : t.tries ? `попыток: ${t.tries}` : ''}</span></div>
      <div class="cond pyc-cond">${safeHtml(t.cond)}</div>
      ${pycFilesHtml(t.files)}
      <div class="pyc-act">
        <button type="button" class="btn" data-pyc-py="${esc(t.id)}">▶ Решать в Python</button>
        <form class="pyc-form" data-pyc-form="${esc(t.id)}" autocomplete="off">
          <input class="inp pyc-ans" maxlength="300" placeholder="${t.ok ? 'Решено ✓' : 'Ответ'}" value="${t.ok && t.ans ? esc(t.ans) : ''}"${t.ok ? ' readonly' : ''}>
          ${t.ok ? '' : '<button type="submit" class="btn primary">Проверить</button>'}
        </form>
        <span class="pyc-msg" aria-live="polite"></span>
      </div>
      ${t.hint && !t.ok ? `<details class="pyc-more"><summary>💡 Подсказка</summary><div>${safeHtml(t.hint)}</div></details>` : ''}
      ${t.note && t.ok ? `<div class="sl-nuance nk-secret"><b class="nk">💡 Секрет.</b> ${safeHtml(t.note)}</div>` : ''}
      ${t.sol ? pycSolHtml(t) : ''}
    </div>`;
  }
  function pycSolHtml(t) {
    return `<details class="pyc-more pyc-sol"${t.ok ? '' : ''}><summary>${t.ok ? '📖 Эталонное решение' : '📖 Разбор (после трёх попыток)'}</summary>
      <pre class="sl-code">${highlightPy(t.sol)}</pre>
      <div class="sl-btns"><button type="button" class="btn ghost" data-pyc-sol="${esc(t.id)}">▶ Открыть разбор в Python</button>
        ${t.ok && t.ans ? `<span class="sl-ok"><i aria-hidden="true">✓</i>Ответ: <b>${esc(t.ans)}</b></span>` : ''}</div></details>`;
  }
  const pycTask = id => PYC_L && PYC_L.level.tasks.find(t => t.id === id);
  function pycPyTask(t, label) {
    return { id: 'pyc:' + t.id, n: PYC_L.n || 0, pyc: true, label, att: (t.files || []).map(f => ({ name: f.name, href: f.url })) };
  }
  /** Редактор Python для задачи курса: файлы задачи уже лежат рядом с кодом. */
  function pycOpenPy(id, code) {
    const t = pycTask(id);
    if (!t) return;
    const k = PYC_L.level.tasks.indexOf(t) + 1;
    PYC_PY = pycPyTask(t, `${pycLabel(PYC_L)} · ур. ${PYC_L.l + 1} · задача ${k}`);
    if (pyOpen()) pySync(); else togglePy(true);
    if (code != null) {
      const ta = $('#pyCode');
      ta.value = code;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  async function pycCheck(id, form) {
    const inp = form.querySelector('.pyc-ans'), box = form.closest('.pyc-task'), msg = box.querySelector('.pyc-msg');
    const answer = inp.value.trim();
    if (!answer) { inp.focus(); return; }
    const pid = 'pyc:' + id;
    const code = PY.task && PY.task.id === pid ? $('#pyCode').value : readCode(pid);
    const btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    let r;
    try { r = await api('pyc/check', { task: id, answer, code: code || '' }); } catch (e) { if (btn) btn.disabled = false; netError(e); return; }
    if (btn) btn.disabled = false;
    const t = pycTask(id);
    if (!t) return;
    t.tries = r.tries;
    PYC.progress[id] = { ok: r.ok || t.ok, tries: r.tries };
    if (r.sol) t.sol = r.sol;
    if (r.ok) {
      t.ok = true;
      t.ans = r.ans;
      toast(r.opened ? '🔓 Верно! Открыт следующий уровень' : '✅ Верно!', r.opened ? 4000 : 2000);
      if (r.opened) { await pycLoad().catch(() => {}); }
      openPycLevel(PYC_L.id, PYC_L.l, true);
      return;
    }
    box.classList.add('bad');
    box.querySelector('.pyc-st').textContent = `попыток: ${r.tries}`;
    msg.textContent = 'Неверно — проверьте программу и вопрос задачи';
    msg.className = 'pyc-msg bad';
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    if (r.sol && !box.querySelector('.pyc-sol')) box.insertAdjacentHTML('beforeend', pycSolHtml(t));
  }

  trainerEl.addEventListener('click', e => {
    if (!courseShown || pageKind !== 'pyc') return;
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
  $('#pycCard')?.addEventListener('click', () => openPyc());
  /** Учитель задал пароль, закрыл курс всем или выключил его — замок и экран курса обновляются сразу. */
  async function pycLive() {
    try { const me = await api('me'); pycSetAccess(me.pyc, me.pyc_pw); } catch (e) { return; }
    if (courseShown && pageKind === 'pyc') { if (PYC_OK) { if (!PYC_L) openPyc(); } else pycLock(); }
  }
