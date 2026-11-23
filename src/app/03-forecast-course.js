  // ------------------------------------------------------------ прогноз балла ЕГЭ
  // ЕГЭ-2026: задания 1–25 — по 1 первичному баллу, 26 и 27 — по 2, всего 29.
  const EGE = {
    points: n => (n >= 26 ? 2 : 1),
    scale: [0, 7, 14, 20, 27, 34, 40, 43, 46, 48, 51, 54, 56, 59, 62, 64, 67, 70, 72, 75,
      78, 80, 83, 85, 88, 90, 93, 95, 98, 100],
    minScore: 40,     // минимальный балл Рособрнадзора
    admission: 46,    // минимальный балл для поступления в вуз
  };
  const testScore = primary => EGE.scale[Math.min(Math.max(primary, 0), EGE.scale.length - 1)];

  // Only first encounters with no recorded site assistance enter the model.
  // This is evidence from the site, not proof that outside help was absent.
  const forecastEligible = e => e.n >= 1 && e.n <= 27 && e.v === 'independent' && !e.w && !e.b && !e.r;
  function forecastEvidence(now = Date.now()) {
    const all = P.log.filter(e => e.t <= now);
    const independent = all.filter(forecastEligible);
    const recent = independent.filter(e => now - e.t <= 30 * DAY);
    const covered = new Set(recent.map(e => e.n));
    return { count: independent.length, recent: recent.length, excluded: all.length - independent.length,
      latest: independent.reduce((v, e) => Math.max(v, e.t), 0),
      missing: Array.from({length:27}, (_, i) => i + 1).filter(n => !covered.has(n)) };
  }

  /**
   * Вероятности по номерам на момент now по истории ответов:
   * p — решить целиком с первой попытки; ph — у №26, 27 верна ровно половина ответа (1 балл из 2);
   * exp — ожидаемая доля баллов номера.
   */
  function solveProbs(now = Date.now()) {
    const F = CFG.forecast;
    const perNum = {};
    for (let i = P.log.length - 1; i >= 0; i--) {
      const e = P.log[i];
      if (e.t > now || !forecastEligible(e)) continue;
      const arr = perNum[e.n] || (perNum[e.n] = []);
      if (arr.length < F.lastN) arr.push(e);
    }
    const res = {};
    for (let n = 1; n <= 27; n++) {
      const arr = perNum[n] || [];
      const st = P.nums[n];
      if (!arr.length) { res[n] = { p: 0, ph: 0, exp: 0, tried: false, a: 0, ok: 0 }; continue; }
      let sw = 0, ss = 0, sh = 0;
      arr.forEach((e, k) => {
        const t = byId.get(e.id);
        const d = t && t.d;
        const val = e.s === 1 ? 1 : e.s === 0.5 ? F.secondTry : 0;
        let w = Math.pow(F.recency, k) * Math.pow(0.5, Math.max(0, now - e.t) / DAY / F.halfLifeDays);
        // верный ответ на сложном задании и ошибка на простом говорят больше
        if (d) w *= val >= 0.5 ? [1, 0.8, 1, 1.25][d] : [1, 1.25, 1, 0.8][d];
        if (t && isOutdated(t)) w *= CFG.outdatedWeight; // старый тип задания мало говорит о нынешнем экзамене
        if (e.r) w *= F.repeatWeight;   // задание уже встречалось — ответ мог запомниться
        if (e.x && !e.b) w *= F.examWeight;   // вариант ЕГЭ: без подсказок и второй попытки
        sw += w;
        ss += w * val;
        if (e.s !== 1 && e.p === 0.5) sh += w;
      });
      const p = (ss + F.priorMean * F.priorWeight) / (sw + F.priorWeight);
      const ph = n >= 26 ? Math.min(sh / (sw + F.priorWeight), 1 - p) : 0;
      res[n] = { p, ph, exp: p + ph / 2, tried: true, a: arr.length, ok: arr.filter(e => e.s === 1).length };
    }
    return res;
  }

  /** Распределение первичных баллов → тестовые баллы, диапазон, шансы. */
  /** Распределение первичных баллов по вероятностям решить каждый номер. */
  function primaryDist(probs) {
    let dist = [1];
    for (let n = 1; n <= 27; n++) {
      const { p, ph } = probs[n], pts = EGE.points(n);
      const nd = new Array(dist.length + pts).fill(0);
      dist.forEach((q, k) => {
        nd[k] += q * (1 - p - ph);
        nd[k + pts] += q * p;
        if (ph) nd[k + 1] += q * ph;     // 26, 27: один балл из двух
      });
      dist = nd;
    }
    return dist;
  }
  const expScore = probs => primaryDist(probs).reduce((a, q, k) => a + q * testScore(k), 0);
  function forecast(now = Date.now()) {
    const probs = solveProbs(now);
    const dist = primaryDist(probs);
    let exp = 0, primary = 0;
    dist.forEach((q, k) => { exp += q * testScore(k); primary += q * k; });
    const quant = x => {
      let c = 0;
      for (let k = 0; k < dist.length; k++) { c += dist[k]; if (c >= x - 1e-9) return testScore(k); }
      return 100;
    };
    const atLeast = score => dist.reduce((a, q, k) => a + (testScore(k) >= score ? q : 0), 0);
    const covered = Object.values(probs).filter(x => x.tried).length;
    return {
      probs, score: Math.round(exp), primary, lo: quant(0.1), hi: quant(0.9),
      pMin: atLeast(EGE.minScore), pAdm: atLeast(EGE.admission), p80: atLeast(80),
      answers: forecastEvidence(now).count, evidence: forecastEvidence(now), covered,
    };
  }

  const bandOf = s => (s < EGE.minScore ? 'weak' : s < 60 ? 'mid' : s < 80 ? 'accent' : 'good');
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayTs = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  const dayLabel = k => k.split('-').reverse().slice(0, 2).join('.');

  /** Прогноз на конец дня — для графика (при восстановлении из журнала). */
  function snapshotForecast(day, now) {
    if (forecastEvidence(now).count < CFG.forecast.minAnswers) return;
    if (!P.fc) P.fc = [];
    const s = forecast(now).score;
    const last = P.fc[P.fc.length - 1];
    if (last && last.d === day) last.s = s;
    else P.fc.push({ d: day, s });
    if (P.fc.length > 120) P.fc.splice(0, P.fc.length - 120);
  }

  /** Запоминаем прогноз на сегодня — чтобы показать динамику. */
  let sentForecast = null;
  function rememberForecast(f) {
    if (!P.fc) P.fc = [];
    const k = dayKey(Date.now());
    const last = P.fc[P.fc.length - 1];
    if (!(last && last.d === k && last.s === f.score)) {
      if (last && last.d === k) last.s = f.score;
      else P.fc.push({ d: k, s: f.score });
      if (P.fc.length > 120) P.fc.splice(0, P.fc.length - 120);
      writeJSON(storeKey(), P);
    }
    if (SERVER && f.score !== sentForecast) scheduleSync();
  }
  function weekAgo() {
    if (!P.fc || !P.fc.length) return null;
    const lim = dayKey(Date.now() - 7 * DAY);
    const today = dayKey(Date.now());
    let pick = null;
    for (const x of P.fc) { if (x.d <= lim) pick = x; }
    if (!pick) pick = P.fc.find(x => x.d !== today) || null;
    return pick && pick.d !== today ? pick : null;
  }

  /** Значок прогноза: три «объёмных» столбика, горят 1–3 в зависимости от балла. */
  function fcIcon(lit) {
    const bars = [[2.5, 13, 8.5], [9.3, 8.5, 13], [16.1, 3, 18.5]];
    return `<svg class="fc-ico" viewBox="0 0 24 25" aria-hidden="true">${bars.map(([x, y, h], i) =>
      `<g class="${i < lit ? 'on' : ''}"><rect x="${x}" y="${y + 1.6}" width="5.4" height="${h}" rx="1.6"/><rect x="${x}" y="${y + 1.6}" width="5.4" height="${h}" rx="1.6" class="sh"/><rect x="${x}" y="${y}" width="5.4" height="${h}" rx="1.6"/></g>`).join('')}</svg>`;
  }
  function renderForecast() {
    const el = $('#forecastBtn');
    if (!el) return;
    const F = CFG.forecast;
    if (forecastEvidence().count < F.minAnswers) {
      const left = F.minAnswers - forecastEvidence().count;
      el.className = 'forecast fc-empty';
      el.innerHTML = `${fcIcon(0)}<span class="fc-txt"><span class="fc-label">Прогноз ЕГЭ</span>
        <span class="fc-value">ещё ${left} ${plural(left, 'задание', 'задания', 'заданий')}</span></span>`;
      el.title = 'Прогноз появится после новых заданий, решённых без подсказок на сайте';
      return;
    }
    const f = forecast();
    rememberForecast(f);
    el.className = `forecast band-${bandOf(f.score)}`;
    const prelim = f.covered < 27;
    el.innerHTML = `${fcIcon(f.score >= 70 ? 3 : f.score >= EGE.minScore ? 2 : 1)}<span class="fc-txt"><span class="fc-label">Прогноз ЕГЭ${prelim ? ' *' : ''}</span>
      <span class="fc-value">${f.score} ${plural(f.score, 'балл', 'балла', 'баллов')}</span></span>`;
    el.title = `Учебный ориентир: ${f.score} баллов. За 30 дней: ${f.evidence.recent} ответов без подсказок. Нажмите — посмотреть данные`
      + (prelim ? `\n* Данные есть по ${f.covered} из 27 номерам — остальные пока считаются нерешёнными.` : '');
  }

  /** График прогноза за последние дни: одна линия, порог 40 пунктиром, подсказка при наведении. */
  function forecastChart() {
    const days = CFG.forecast.chartDays;
    const from = dayKey(Date.now() - (days - 1) * DAY);
    const pts = (P.fc || []).filter(x => x.d >= from);
    if (pts.length < 2) {
      return { html: '<p class="fm-note fc-chart-empty">График появится, когда прогноз накопится хотя бы за два дня занятий.</p>', bind() {} };
    }
    const W = 640, H = 170, L = 34, R = 14, T = 12, B = 24;
    const span = (days - 1) * DAY;
    const x = k => L + (dayTs(k) - dayTs(from)) / span * (W - L - R);
    const vals = pts.map(p => p.s);
    const lo = Math.max(0, Math.floor((Math.min(...vals, EGE.minScore) - 5) / 10) * 10);
    const hi = Math.min(100, Math.ceil((Math.max(...vals) + 5) / 10) * 10);
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
    const step = hi - lo > 50 ? 20 : 10;
    let grid = '';
    for (let v = lo; v <= hi; v += step) {
      grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="fc-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="fc-ax" text-anchor="end">${v}</text>`;
    }
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.s).toFixed(1)}`).join('');
    const area = `${line}L${x(pts[pts.length - 1].d).toFixed(1)},${H - B}L${x(pts[0].d).toFixed(1)},${H - B}Z`;
    const last = pts[pts.length - 1];
    const thr = EGE.minScore >= lo ? `<line x1="${L}" x2="${W - R}" y1="${y(EGE.minScore)}" y2="${y(EGE.minScore)}" class="fc-thr"/>
      <text x="${W - R}" y="${y(EGE.minScore) - 5}" class="fc-ax" text-anchor="end">порог ${EGE.minScore}</text>` : '';
    const label = `Прогноз за ${days} дней: от ${pts[0].s} (${dayLabel(pts[0].d)}) до ${last.s} (${dayLabel(last.d)})`;
    const html = `<div class="fc-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="none">
        ${grid}${thr}
        <path d="${area}" class="fc-area"/><path d="${line}" class="fc-line"/>
        <circle cx="${x(last.d)}" cy="${y(last.s)}" r="4.5" class="fc-dot"/>
        <line class="fc-cross" y1="${T}" y2="${H - B}" x1="0" x2="0" visibility="hidden"/>
        <circle class="fc-hover" r="4.5" cx="0" cy="0" visibility="hidden"/>
        <text x="${L}" y="${H - 6}" class="fc-ax">${dayLabel(from)}</text>
        <text x="${W - R}" y="${H - 6}" class="fc-ax" text-anchor="end">сегодня</text>
        <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="fc-hit"/>
      </svg>
      <div class="fc-tip" hidden></div>
    </div>`;
    const bind = root => {
      const box = root.querySelector('.fc-chart');
      if (!box) return;
      const svg = box.querySelector('svg'), tip = box.querySelector('.fc-tip');
      const cross = svg.querySelector('.fc-cross'), dot = svg.querySelector('.fc-hover');
      const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
      const move = ev => {
        const r = svg.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width * W;
        let best = pts[0];
        for (const p of pts) if (Math.abs(x(p.d) - px) < Math.abs(x(best.d) - px)) best = p;
        const cx = x(best.d), cy = y(best.s);
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
        tip.innerHTML = `<b>${best.s}</b> баллов<span>${dayLabel(best.d)}</span>`;
        tip.hidden = false;
        const left = cx / W * r.width;
        tip.style.left = Math.min(Math.max(left, 40), r.width - 40) + 'px';
        tip.style.top = (cy / H * r.height) + 'px';
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerdown', move);
      svg.addEventListener('pointerleave', hide);
    };
    return { html, bind };
  }

  function openForecast() {
    const F = CFG.forecast;
    const box = $('#forecastModal');
    const body = $('#forecastBody');
    if (forecastEvidence().count < F.minAnswers) {
      body.innerHTML = `<h2 class="fm-title">Прогноз балла ЕГЭ</h2>
        <p class="fm-note">Прогноз появится после ${F.minAnswers} новых заданий без подсказок на сайте. Сейчас: ${forecastEvidence().count}. Лучше всего начать с режима «Все задания» или с варианта ЕГЭ — так быстрее соберётся картина по всем номерам.</p>`;
      box.hidden = false;
      return;
    }
    const f = forecast();
    const wk = weekAgo();
    const delta = wk ? f.score - wk.s : null;
    const untried = [], weak = [];
    for (let n = 1; n <= 27; n++) {
      const x = f.probs[n];
      if (!x.tried) untried.push(n);
      else if (x.exp < 0.6) weak.push({ n, gain: EGE.points(n) * (1 - x.exp), p: x.exp });
    }
    weak.sort((a, b) => b.gain - a.gain || a.n - b.n);
    const counts = countByNum();
    const chipN = (n, extra) => `<button class="chip num-chip" type="button" data-go="${n}" ${counts[scopeOf(n)] ? '' : 'disabled'}>№${n}${extra || ''}</button>`;
    const pctOr = x => `${pct(x)}%`;
    const chart = forecastChart();

    const rows = Array.from({ length: 27 }, (_, i) => {
      const n = i + 1, x = f.probs[n], pts = EGE.points(n);
      const lvl = !x.tried ? 'none' : x.exp >= 0.8 ? 'good' : x.exp >= 0.5 ? 'mid' : 'weak';
      return `<tr class="lv-${lvl}">
        <td class="fm-n"><button type="button" class="link-btn" data-go="${n}" ${counts[scopeOf(n)] ? '' : 'disabled'}>${n}</button></td>
        <td>${pts}</td>
        <td>${x.tried ? `<span class="fm-bar-cell"><i class="fm-bar"><b style="width:${pct(x.exp)}%"></b></i><span>${pct(x.p)}%${x.ph >= 0.01 ? ` <span class="fm-muted" title="Верна половина ответа — 1 балл из 2">+ ½: ${pct(x.ph)}%</span>` : ''}</span></span>` : '<span class="fm-muted">не решали</span>'}</td>
        <td>${x.tried ? `${x.a} <span class="fm-muted">· верно ${x.ok}</span>` : '—'}</td>
        <td>${(pts * x.p + x.ph).toFixed(2).replace('.', ',')}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="fm-head">
        <div class="fm-score band-${bandOf(f.score)}">
          <span class="fm-big">${f.score}</span>
          <span class="fm-sub">тестовых баллов<br>≈ ${f.primary.toFixed(1).replace('.', ',')} первичных из 29</span>
        </div>
        <div class="fm-facts">
          <div><b>Учебный ориентир, не обещание результата</b></div>
          ${delta != null ? `<div>${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${delta > 0 ? '+' : ''}${delta} с ${dayLabel(wk.d)}</div>` : ''}
          <div class="fm-chips"><span class="chip">${f.evidence.recent} ответов за 30 дней</span>
            <span class="chip">${27 - f.evidence.missing.length} из 27 номеров за 30 дней</span></div>
        </div>
      </div>

      ${trainPlan(f)}
      <div class="fm-note" id="mistakeSummary" role="status"></div>

      <div class="fm-chart-wrap">
        <div class="fm-h">Прогноз за ${F.chartDays} дней</div>
        ${chart.html}
      </div>

      <p class="fm-note">По ${f.answers} ${plural(f.answers, 'ответу', 'ответам', 'ответам')}, данные есть по ${f.covered} из 27 номеров.
        ${untried.length ? 'По непроверенным номерам модель пока не добавляет баллы; это не доказательство, что вы их не умеете.' : ''}</p>
      <p class="fm-note">В расчёте — первые встречи с заданиями без подсказок, повторов и занятия «Вместе».
        Исключено записей: ${f.evidence.excluded}. Последний подходящий ответ: ${f.evidence.latest ? new Date(f.evidence.latest).toLocaleDateString('ru-RU') : 'нет'}.
        ${f.evidence.missing.length ? `Нет свежих данных за 30 дней по номерам: ${f.evidence.missing.join(', ')}.` : 'По всем номерам есть свежие данные.'}
        Сайт не может проверить помощь вне платформы. Точность модели ещё не проверена на результатах настоящих экзаменов, поэтому вероятность и доверительный диапазон не показываются.</p>

      ${untried.length || weak.length ? `<div class="fm-where">
        <div class="fm-h">Ещё можно добрать</div>
        ${untried.length ? `<div class="fm-line"><span class="fm-muted">Ещё не решали:</span> ${untried.map(n => chipN(n, EGE.points(n) > 1 ? ' · 2 б.' : '')).join(' ')}</div>` : ''}
        ${weak.length ? `<div class="fm-line"><span class="fm-muted">Слабые места:</span> ${weak.slice(0, 6).map(w => chipN(w.n, ` · ${pct(w.p)}%`)).join(' ')}</div>` : ''}
      </div>` : ''}

      <div class="fm-table-wrap"><table class="fm-table">
        <thead><tr><th>№</th><th>Баллов</th><th>Оценка модели</th><th>Ответов</th><th>В прогноз</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <details class="fm-how"><summary>Как считается прогноз</summary>
        <p>Для каждого номера оценивается вероятность решить его на экзамене с первой попытки. Последние ответы весят больше старых, а через месяц без практики вес ответа падает вдвое. Верный ответ на сложном задании и ошибка на простом весят сильнее. В расчёт входят первые попытки на новых заданиях; подсказки, повторные задания и работа «Вместе» исключаются.</p>
        <p>Ответы на новые задания в варианте ЕГЭ весят в полтора раза больше. Для самопроверки кода в браузере баллы прогноза не начисляются. Пока ответов мало, оценка осторожная.</p>
        <p>У заданий 26 и 27 учитывается частичный балл: если с первой попытки верна половина ответа (одно из двух чисел), это 1 балл из 2. Из вероятностей складывается распределение первичных баллов (всего 29), и оно переводится в тестовые по шкале ЕГЭ‑2026. Это расчётная модель, а не измеренная вероятность результата на экзамене.</p>
      </details>`;
    chart.bind(body);
    box.hidden = false;
    const reflection = body.querySelector('#mistakeSummary');
    if (SERVER && reflection) api('learning/mistakes').then(d => {
      if (!reflection.isConnected || !d.items?.length) return;
      reflection.textContent = 'Твои отметки за 30 дней (не оценка учителя): ' + d.items.map(x => `${x.label} — ${x.count}${x.repeated_topics ? ` (повторилась в ${x.repeated_topics} номерах)` : ''}`).join('; ') + '. После нового решения проверь, повторилась ли та же причина.';
      if (d.followup) {
        const f = d.followup;
        reflection.textContent += f.evaluated
          ? ` Следующее новое задание того же номера и типа: ${f.recovered} из ${f.evaluated} решены с первой попытки без подсказок. Это признак закрепления навыка, а не доказательство исчезновения конкретной причины.`
          : ' Для оценки закрепления пока нет следующего самостоятельного решения нового задания того же типа.';
      }
    }).catch(() => { if (reflection.isConnected) reflection.textContent = 'Отметки причин пока не загрузились. Открой прогноз ещё раз.'; });
  }

  function closeForecast() { $('#forecastModal').hidden = true; }

  // ------------------------------------------------------------ курс по плану (пока структура, наполнение — по ходу)
  // Порядок не 1→27, а по темам: сначала без программирования, потом логика, системы счисления, программирование, сложные.
  const COURSE = [
    { title: 'Старт без программирования', icon: '🧭', sub: 'Графы, кодирование, объёмы, базы данных, таблицы, поиск в тексте, IP-адреса',
      lessons: [1, 4, 7, 11, 3, 9, 10, 13] },
    { title: 'Логика', icon: '🧩', sub: 'Таблицы истинности и логические выражения', lessons: [2, 15] },
    { title: 'Системы счисления и исполнители', icon: '🔢', sub: 'Анализ алгоритмов, Черепаха, машина Тьюринга, траектории, комбинаторика',
      lessons: [5, 14, 6, 12, 23, 8] },
    { title: 'Программирование', icon: '🐍', sub: 'Рекурсия, последовательности, строки, делители и маски', lessons: [16, 17, 24, 25] },
    { title: 'Финишная прямая', icon: '🏁', sub: 'Теория игр, процессы, динамика, задачи 26–27', lessons: [19, 22, 18, 26, 27] },
    { title: 'Архив', icon: '🗄️', sub: 'Задания, которых нет в КИМ ЕГЭ-2027: 23_old — пути в графе из файла', lessons: [28], archive: true },
  ];
  // подборки урока: одинаковые для всех номеров; d — сложность в банке (1 — простая, 2 — средняя, 3 — сложная)
  // описания подборок №5 — по системам счисления
  const COURSE_SET_NOTES = { 5: { warm: 'самые простые задания из всех банков', base: 'двоичная запись', exam: 'двоичная и троичная системы — как на ЕГЭ',
    hard: 'другие системы счисления и десятичные цифры', test: 'по 5 заданий каждого вида: 2-я, 3-я, другие системы, десятичные цифры' } };
  const COURSE_SETS = [
    { key: 'warm', name: 'Разминка', icon: '🌱', d: [1], note: 'простые задания, чтобы понять идею' },
    { key: 'base', name: 'Базовый уровень', icon: '📘', d: [1, 2], note: 'типовые задания как в демоверсии' },
    { key: 'exam', name: 'Как на ЕГЭ', icon: '🎯', d: [2], note: 'формат и сложность реального экзамена' },
    { key: 'hard', name: 'Сложные', icon: '🔥', d: [3], note: 'для тех, кто идёт на 90+' },
    { key: 'test', name: 'Контрольная', icon: '🏆', d: null, note: '20 заданий разных видов — проверка темы' },
  ];
  // подборки урока — из банка, по сложности; состав постоянный (сортировка по хешу id), по 10 заданий
  const EXAM_SRC = /Демоверсия|Апробация|Резерв|Основная|ЕГКР|Пересдача|Досрочн/;
  const idHash = id => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return h >>> 0; };
  const SET_SIZE = 20;
  // №5: какая система счисления в задании — по тексту условия
  const sysCache = new Map();
  function sysOf(t) {
    if (sysCache.has(t.id)) return sysCache.get(t.id);
    const x = String(t.html || '').replace(/<[^>]+>/g, ' ').toLowerCase();
    const v = /двоичн/.test(x) ? 2 : /троичн/.test(x) ? 3
      : /(четвер|пятер|шестер|семер|восьмер|девятер|шестнадцатер)ичн/.test(x) ? 'other' : /значн|цифр/.test(x) ? 10 : 'other';
    sysCache.set(t.id, v);
    return v;
  }
  // Состав подборок курса собирает сервер (по кластерам заданий) — тот же, что видит учитель в прогрессе курса.
  // Без связи с сервером подборки собираются здесь, по старым правилам.
  let COURSE_SRV = {};
  async function loadCourseSets() {
    if (!SERVER || !COURSE_OK) return;
    try { COURSE_SRV = (await api('course/sets')).sets || {}; } catch (e) { return; }
    ASG = ASG.filter(a => !a.course);                // подборки курса пересоберутся из нового состава
  }
  function courseSetTasks(n) {
    const srv = COURSE_SRV[n];
    if (srv) return Object.fromEntries(Object.entries(srv).map(([k, ids]) => [k, ids.filter(id => byId.has(id))]));
    // все задания номера (без фильтра «Актуальные»: подборки курса собраны заранее), порядок постоянный
    const pool = TASKS.filter(t => t.n === n && !t.parts).sort((a, b) => idHash(a.id) - idHash(b.id));
    const used = new Set();
    const take = (list, k) => { const out = list.filter(t => !used.has(t.id)).slice(0, Math.max(0, k)); out.forEach(t => used.add(t.id)); return out; };
    // набрать k заданий: сначала из первого списка, не хватило — из следующих
    const fill = (k, ...lists) => { const out = []; for (const l of lists) out.push(...take(l, k - out.length)); return out; };
    const easy = t => t.d === 1 || /Прост|Проще/.test(t.lv || '');
    const hard = t => t.d === 3 || /Сложн/.test(t.lv || '');
    const real = t => EXAM_SRC.test(t.src || '');
    const short = list => list.slice().sort((a, b) => String(a.html || '').length - String(b.html || '').length);
    const first = (list, f) => list.filter(f).concat(list.filter(t => !f(t)));
    const sets = {};
    if (n === 5) {
      const sys = (...v) => pool.filter(t => v.includes(sysOf(t)));
      sets.warm = fill(SET_SIZE, pool.filter(easy), short(sys(2)), short(pool));                       // самые простые
      sets.base = fill(SET_SIZE, first(sys(2), t => !hard(t)));                                        // двоичная
      sets.exam = [...fill(SET_SIZE / 2, first(sys(2), real)), ...fill(SET_SIZE / 2, first(sys(3), real))];   // 2-я и 3-я
      sets.exam.push(...fill(SET_SIZE - sets.exam.length, sys(3), sys(2)));
      sets.hard = fill(SET_SIZE, first(sys('other', 10), hard), first(sys(3), hard), pool);           // остальные + 10-я
      sets.test = [2, 3, 'other', 10].flatMap(v => fill(SET_SIZE / 4, first(sys(v), t => !easy(t))));  // по всем видам
    } else {
      sets.warm = fill(SET_SIZE, pool.filter(easy), short(pool));
      sets.base = fill(SET_SIZE, pool.filter(t => !easy(t) && !hard(t)), pool);
      sets.exam = fill(SET_SIZE, pool.filter(real), pool);
      sets.hard = fill(SET_SIZE, pool.filter(hard), pool);
      sets.test = [];
    }
    sets.test.push(...fill(SET_SIZE - sets.test.length, pool));
    return Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.map(t => t.id)]));
  }
  /** Подборка курса как «подборка учителя»: решается по порядку, прогресс считается по журналу. */
  function courseSet(id) {
    const m = /^crs-(\d+)-(\w+)$/.exec(id || '');
    if (!m) return null;
    const n = +m[1], st = COURSE_SETS.find(x => x.key === m[2]);
    if (!st) return null;
    let a = ASG.find(x => x.id === id);
    if (!a) {
      a = { id, course: n, title: `№${numLabel(n)} · ${st.name}`, tasks: courseSetTasks(n)[st.key] || [], done: [], created: 0 };
      ASG.push(a);
    }
    return a;
  }
  let courseShown = false;
  let pageKind = null;                   // открыта страница вместо задания: null — курс, 'asg' — задания от учителя
  let TEACHER = false;
  // Окна курса (план → урок → подборка → задание) пишутся в историю браузера: кнопка «Назад» ведёт по ним
  let navSilent = false;
  function navPush(st) {
    if (navSilent) return;
    if (hubQueueNavigation(st)) return;
    try {
      const was = history.state;
      if (!was) history.replaceState({ v: 'main' }, '');
      else if (JSON.stringify(was) === JSON.stringify(st)) return;
      // Действие в окне открыло раздел: окно занимает его место в истории.
      // Иначе «Назад» попадёт на уже закрытое окно или пропустит главную.
      if (was && was.v === 'modal' && $('#forecastModal').hidden && st.v !== 'modal') {
        history.replaceState(st, '');
        return;
      }
      history.pushState(st, '');
    } catch (e) {}
  }
  function inCourseSet() { return ui.scope === 'asg' && !!(asgOf(ui.asg) || {}).course; }
  /** Задание из подборки курса: подборка становится текущим разделом. */
  function openSetTask(a, t) {
    abandonCurrent();
    leaveExam();
    ui.scope = 'asg';
    ui.asg = a.id;
    save();
    renderSidebar();
    if (!cur || cur.done || cur.task.id !== t.id || courseShown) show({ task: t, why: { type: 'asg', a } });
    navPush({ v: 'task', set: a.id, id: t.id });
  }
  window.addEventListener('popstate', e => {
    let st = e.state || { v: 'main' };
    if (hubModalPop(st)) return;
    const restoreModal = st.v === 'modal' && st.id === hubModalId;
    if (st.v === 'modal') st = st.base || { v: 'main' };
    navSilent = true;
    try {
      if (examShown) return;
      if (st.v === 'hub') openHub();
      else if (st.v === 'course') openCourse();
      else if (st.v === 'lab') openLab(st.tab);
      else if (st.v === 'asgpage') openAsgPage();
      else if (st.v === 'mcko') openMcko();
      else if (st.v === 'ardgate') openArdGate();
      else if (st.v === 'im') openIm();
      else if (st.v === 'tourpage') tourOpen();
      else if (st.v === 'exams') openExamsPage();
      else if (st.v === 'history') openHistory();
      else if (st.v === 'exam' && st.id) openExamReview(st.id);
      else if (st.v === 'lesson') openLesson(st.n);
      else if (st.v === 'pyc') openPyc();
      else if (st.v === 'pycl') openPycLevel(st.m, st.l);
      else if (st.v === 'set' && courseSet(st.id)) { abandonCurrent(); openCourseSet(st.id); }
      else if (st.v === 'task' && courseSet(st.set) && byId.get(st.id)) openSetTask(courseSet(st.set), byId.get(st.id));
      else if (courseShown || inCourseSet()) {
        leaveCourse();
        if (inCourseSet()) { ui.scope = 'all'; save(); renderSidebar(); }
        next();
      }
    } finally {
      navSilent = false;
      if (restoreModal) { hubModalState = true; $('#forecastModal').hidden = false; }
    }
  });
  let COURSE_OK = false;                 // доступ обновляется без загрузки интерфейса курса
  let DECK = null, deckI = 0;             // текущий слайд нужен маркеру обычного Python
  function leaveCourse() {
    if (!courseShown) return;
    if (pageKind === 'lab') { labStop(); document.body.classList.remove('lab-open'); }
    courseShown = false;
    pageKind = null;
    document.body.classList.remove('asg-wide', 'hub-on');
    renderMobileNav();
  }

  const NUM_TOPIC = ['', 'Графы и таблицы', 'Таблицы истинности', 'Базы данных', 'Кодирование, условие Фано', 'Алгоритмы-автоматы',
    'Черепаха', 'Изображения и звук', 'Комбинаторика', 'Электронные таблицы', 'Поиск слова в тексте', 'Объём информации',
    'Машина Тьюринга', 'IP-адреса и маски', 'Системы счисления', 'Логические выражения', 'Рекурсия',
    'Обработка последовательностей', 'Динамика: Робот', 'Теория игр', 'Теория игр', 'Теория игр', 'Параллельные процессы',
    'Исполнитель: траектории программ', 'Обработка строк', 'Делители и маски', 'Сортировка, жадные алгоритмы', 'Анализ данных',
    'Архив: пути в графе из файла'];   // [28] — архивное 23_old

  /** «Что потренировать»: номера, которые дадут больше всего тестовых баллов, если довести их до 85%. */
  function trainPlan(f) {
    const TARGET = 0.85;
    const base = expScore(f.probs);
    const now = Date.now();
    const cand = [];
    for (let n = 1; n <= 27; n++) {
      if (HAS_GROUPS && (n === 20 || n === 21)) continue;
      const x = f.probs[n];
      if (x.exp >= TARGET) continue;
      const ns = HAS_GROUPS && n === 19 ? [19, 20, 21] : [n];
      const pr = Object.assign({}, f.probs);
      for (const k of ns) pr[k] = { ...pr[k], p: Math.max(pr[k].p, TARGET), ph: 0 };
      const gain = expScore(pr) - base;
      if (gain < 0.5) continue;
      const why = !x.tried ? 'ещё не решали' : `сейчас решаете на ${pct(x.exp)}%`;
      cand.push({ n, gain, why, pts: ns.reduce((a, k) => a + EGE.points(k), 0) });
    }
    cand.sort((a, b) => b.gain - a.gain || a.n - b.n);
    const top = cand.slice(0, 3);
    // ближайшая цель: следующий рубеж и сколько первичных до него
    const goals = [EGE.minScore, 60, 70, 80, 90, 100].filter(g => g > f.score);
    let goalHtml = '';
    if (goals.length) {
      const g = goals[0];
      let k = 0;
      while (k < EGE.scale.length - 1 && testScore(k) < g) k++;
      const need = Math.max(1, Math.ceil(k - f.primary));
      goalHtml = `<div class="tp-goal">🎯 До <b>${g} баллов</b> не хватает примерно <b>${need}</b> ${plural(need, 'первичного балла', 'первичных баллов', 'первичных баллов')}${
        top.length ? ` — это ${top.slice(0, Math.min(3, need)).map(c => `№${numLabel(c.n)}`).join(' и ').replace(/ и (?=.* и )/, ', ')}` : ''}.</div>`;
    }
    const strong = [];
    for (let n = 1; n <= 27; n++) if (f.probs[n].tried && f.probs[n].exp >= TARGET) strong.push(n);
    const due = [];
    for (let n = 1; n <= 27; n++) if (reviewsOf(n).some(r => isDue(r, now))) due.push(n);
    const counts = countByNum();
    const card = c => `<div class="tp-card">
        <span class="tp-n">${numLabel(c.n)}</span>
        <span class="tp-main"><b>${esc(NUM_TOPIC[c.n])}</b><small>${c.why}${c.pts > 1 ? ` · ${c.pts} перв. балла` : ''}</small></span>
        <span class="tp-gain">+${Math.round(c.gain)}<small>${plural(Math.round(c.gain), 'балл', 'балла', 'баллов')}</small></span>
        <button type="button" class="btn primary tp-go" data-go="${c.n}" ${counts[scopeOf(c.n)] ? '' : 'disabled'}>Тренировать</button>
      </div>`;
    if (!top.length && !due.length) {
      return `<div class="tp"><div class="fm-h">Что потренировать</div><p class="fm-note">Все номера решаются уверенно — держите форму вариантами ЕГЭ 💪</p></div>`;
    }
    return `<div class="tp">
      <div class="fm-h">Что потренировать — больше всего баллов</div>
      ${goalHtml}
      ${top.map(card).join('')}
      ${top.length ? '<p class="fm-note tp-note">«+N баллов» — насколько вырастет прогноз, если решать этот номер на 85%.</p>' : ''}
      ${due.length ? `<div class="fm-line"><span class="fm-muted">🔁 Пора повторить:</span> ${due.slice(0, 10).map(n => `<button class="chip num-chip" type="button" data-go="${n}">№${numLabel(n)}</button>`).join(' ')}</div>` : ''}
      ${strong.length ? `<div class="fm-line"><span class="fm-muted">💪 Сильные стороны:</span> ${strong.map(n => `<span class="chip good">№${n}</span>`).join(' ')}</div>` : ''}
    </div>`;
  }

