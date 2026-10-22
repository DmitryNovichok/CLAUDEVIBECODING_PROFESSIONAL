  // ------------------------------------------------------------ подбор задания
  function targetDifficulty(n) {
    const s = statsFor(n);
    if (!s || !s.a) return 1;
    return s.m < 0.45 ? 1 : s.m < 0.78 ? 2 : 3;
  }
  /** Сложность 1–5, которую сейчас стоит давать в этом типе задания: по успехам в типе, а если их мало — в номере.
   *  Начинаем с лёгких; решаешь уверенно — сложность растёт, ошибаешься — опускается. */
  function targetRank(n, key) {
    const k = key && P.topics[key];
    const s = k && k.a >= 2 ? k : statsFor(n);
    if (!s || !s.a) return 2;
    return s.m < 0.4 ? 2 : s.m < 0.65 ? 3 : s.m < 0.85 ? 4 : 5;
  }

  function numberWeight(n, list, recentSet) {
    const s = statsFor(n);
    let w = !s || !s.a ? 1.1 : 0.12 + 1.8 * Math.pow(1 - s.m, 2);
    if (n === lastNum) w *= 0.35;
    const inNum = list.filter(t => t.n === n);
    if (!inNum.some(t => !P.tasks[t.id])) w *= 0.4;              // новых заданий не осталось
    if (inNum.every(t => recentSet.has(t.id))) w *= 0.02;         // всё только что решали
    return w;
  }

  function topicWeight(k, arr, recentSet) {
    const s = P.topics[k];
    let w = !s || !s.a ? 1 : 0.15 + 1.6 * Math.pow(1 - s.m, 2);
    if (!arr.some(t => !P.tasks[t.id])) w *= 0.3;
    if (arr.every(t => recentSet.has(t.id))) w *= 0.05;
    return w;
  }

  function chooseTask(cands, n) {
    if (!cands.length) return null;
    const now = Date.now();
    const target = targetDifficulty(n);
    const rankOf = new Map();                          // целевая сложность — своя для каждого типа задания
    const want = t => { const k = topicKey(t); if (!rankOf.has(k)) rankOf.set(k, targetRank(n, k)); return rankOf.get(k); };
    let best = null, bestScore = -Infinity;
    for (const t of cands) {
      const s = P.tasks[t.id];
      let sc = Math.random() * 0.6;
      if (!s) sc += 2;                                   // новое — в приоритете
      else {
        sc += Math.min((now - (s.last || 0)) / DAY / 7, 1) * 0.8; // давно не видели
        if (s.ls === 1) sc -= 0.6;                       // уже решено верно
      }
      sc += t.r ? 1.1 - 0.4 * Math.abs(t.r - want(t))     // сложность 1–5 под уровень в этом типе
        : t.d ? 1 - 0.45 * Math.abs(t.d - target) : 0.7;
      sc += t.y ? Math.min(Math.max(t.y - CFG.firstKegeYear, 0), 5) * 0.1 : 0.25; // свежие — чаще
      if (isOutdated(t)) sc -= 0.8;                     // старый формат — только если выбрано «все»
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best;
  }

  /** Следующее задание; в выбранном номере — только задания этого номера, что бы ни подсказал подбор. */
  function pickNext(excludeId) {
    const r = pickNextRaw(excludeId);
    if (!r || ui.scope === 'asg' || ui.scope === 'all' || inScope(r.task)) return r;
    const list = pool().filter(t => t.id !== excludeId);
    return list.length ? { task: chooseTask(list, ui.scope) || list[0], why: { type: 'new' } } : r;
  }
  function pickNextRaw(excludeId) {
    const now = Date.now();
    const list = pool();
    if (!list.length) return null;
    if (ui.scope === 'asg') {               // подборка учителя: по порядку, сначала нерешённые
      const a = asgOf(ui.asg);
      // следующее нерешённое ПОСЛЕ текущего по порядку подборки (по кругу): иначе «Пропустить»
      // возвращало бы первое нерешённое, и два задания сменяли бы друг друга без конца
      const leftSet = new Set(asgLeft(a));
      const at = excludeId ? a.tasks.indexOf(excludeId) : -1;
      const order = at >= 0 ? a.tasks.slice(at + 1).concat(a.tasks.slice(0, at)) : a.tasks;
      const left = order.filter(id => id !== excludeId && leftSet.has(id)).map(id => byId.get(id)).filter(Boolean);
      if (left.length) return { task: left[0], why: { type: 'asg', a } };
      if (a.strict) return null;            // самостоятельная: всё сдано — экран «Завершить»
      const rest = list.filter(t => t.id !== excludeId);
      return { task: rest.length ? rest[Math.floor(Math.random() * rest.length)] : list[0], why: { type: 'asg', a } };
    }
    const recentSet = new Set(recent.slice(-CFG.recentWindow));
    if (excludeId) recentSet.add(excludeId);
    const fresh = arr => arr.filter(t => !recentSet.has(t.id));
    const nums = new Set(list.map(t => t.n));

    // 1) повторение типа, в котором была ошибка
    const due = Object.values(P.reviews)
      .filter(r => nums.has(r.n) && isDue(r, now))
      .sort((a, b) => (a.stage - b.stage) || ((a.dueStep ?? 1e15) - (b.dueStep ?? 1e15)) || ((a.dueTime ?? 0) - (b.dueTime ?? 0)));
    for (const r of due) {
      let c = fresh(list.filter(t => topicKey(t) === r.key));
      if (!c.length) c = fresh(list.filter(t => t.n === r.n));
      if (!c.length) c = list.filter(t => t.n === r.n && t.id !== excludeId); // в номере мало заданий
      const t = chooseTask(c, r.n);
      if (t) return { task: t, why: { type: 'review', r } };
    }

    // 2) то же самое задание, решённое неверно несколько дней назад
    const retry = fresh(list)
      .filter(t => { const s = P.tasks[t.id]; return s && s.due && s.due <= now; })
      .sort((a, b) => P.tasks[a.id].due - P.tasks[b.id].due);
    if (retry.length) return { task: retry[0], why: { type: 'retry', last: P.tasks[retry[0].id].last } };

    // 3) номер — по слабости (в режиме «Все задания»), тема — по слабости внутри номера
    let n = ui.scope;
    if (n === 'all' || n === 'fav') n = weightedPick([...nums], x => numberWeight(x, list, recentSet));
    const inNum = list.filter(t => t.n === n);
    const groups = groupBy(inNum, topicKey);
    let cands = inNum;
    if (groups.size > 1) {
      const k = weightedPick([...groups.keys()], k => topicWeight(k, groups.get(k), recentSet));
      cands = groups.get(k);
    }
    const t = chooseTask(fresh(cands), n) || chooseTask(fresh(inNum), n)
      || chooseTask(inNum.filter(x => x.id !== excludeId), n) || inNum[0];
    const ns = statsFor(n);
    let type = 'new';
    if (P.tasks[t.id]) type = 'repeat';
    else if (ui.scope === 'all' && ns && ns.a && ns.m < CFG.weak) type = 'weak';
    return { task: t, why: { type } };
  }

  // ------------------------------------------------------------ учёт ответа
  function bump(map, key, score, alpha) {
    const s = map[key] || (map[key] = { m: 0.5, a: 0, ok: 0 });
    s.m += alpha * (score - s.m);
    s.a++;
    if (score === 1) s.ok++;
  }

  /** Статистика одного ответа (для 19–21 — одной части): задание, номер, журнал.
      o.part — доля баллов с 1-й попытки (№26, 27: 0.5 — верна половина), o.exam — ответ в варианте ЕГЭ. */
  function recordStats(t, score, now, o = {}) {
    P.step++;
    const repeat = !!P.tasks[t.id];
    // уже решённое задание решают снова: в огонёк, цель дня и серию не идёт (так же считает сервер)
    // уже решённое или с показанным ответом: в огонёк, цель дня и серию не идёт (так же считает сервер)
    const again = o.skip != null ? o.skip
      : !!(P.tasks[t.id] && P.tasks[t.id].c > 0) && !o.exam && !o.asg && RULES.repeat_since != null && now >= RULES.repeat_since;
    const s = P.tasks[t.id] || (P.tasks[t.id] = { a: 0, c: 0 });
    s.a++;
    if (score === 1) s.c++;
    s.last = now;
    s.ls = score;
    s.due = score === 1 ? null : now + (CFG.retryTaskDays[score] || CFG.retryTaskDays[0]) * DAY;
    bump(P.nums, t.n, score, CFG.alphaNum);
    const e = { id: t.id, n: t.n, s: score, t: now };
    if (o.part != null && o.part !== score) e.p = o.part;
    if (repeat) e.r = 1;
    if (again) e.ra = 1;
    if (o.asg) e.k = 1;                 // ответ из самостоятельной учителя
    if (o.exam) e.x = 1;
    if (o.blank) e.b = 1;               // в варианте оставил без ответа: в цель дня не идёт
    P.log.push(e);
    if (P.log.length > 5000) P.log.splice(0, P.log.length - 5000);
  }

  /** Тема и повторение после ошибки. reviewWasDue — было ли повторение «к сроку» в момент показа. */
  function recordReview(t, score, rk, reviewWasDue, now) {
    const k = topicKey(t);
    const r = P.reviews[rk];
    bump(P.topics, k, score, CFG.alphaTopic);
    let note = '';
    if (score < 1) {
      const gap = score === 0 ? CFG.reviewAfterFail : CFG.reviewAfterHalf;
      // повторение по типу этого задания (и заново — по тому, ради которого оно было показано)
      for (const key of new Set([k, rk])) {
        const old = P.reviews[key];
        if (!old && key !== k) continue;
        const src = key === k ? t : old;
        P.reviews[key] = {
          key, n: src.n, topic: key === k ? (t.topic || '') : old.topic, stage: 0,
          fails: (old ? old.fails : 0) + 1, dueStep: P.step + gap, dueTime: null, since: old ? old.since : now,
        };
      }
      const rd = CFG.retryTaskDays[score];
      note = `Похожее задание вернётся через ${gap} ${plural(gap, 'задание', 'задания', 'заданий')}, а это — через ${rd} ${plural(rd, 'день', 'дня', 'дней')}.`;
    } else if (reviewWasDue && r) {
      r.stage++;
      const iv = CFG.reviewIntervalsDays[r.stage - 1];
      if (iv == null) {
        delete P.reviews[rk];
        note = 'Тип задания закреплён и снят с повторения.';
      } else {
        r.dueStep = null;
        r.dueTime = now + iv * DAY;
        note = `Повторение засчитано. Проверим ещё раз через ${iv} ${plural(iv, 'день', 'дня', 'дней')}.`;
      }
    }
    return note;
  }

  /** score: 1 — верно с первой попытки, 0.5 — со второй, 0 — не решено.
      reviewKey — ключ повторения, ради которого показано задание (если было). */
  function record(t, score, reviewKey, o = {}) {
    const now = o.now || Date.now();
    const rk = reviewKey || topicKey(t);
    const r = P.reviews[rk];
    const reviewWasDue = !!(r && isDue(r, now)); // проверяем до того, как счётчик шагов сдвинется
    recordStats(t, score, now, o);
    const note = recordReview(t, score, rk, reviewWasDue, now);
    if (!o.silent) { save(); afterAnswer(); }
    return note;
  }

  /** Итог по заданию 19–21 целиком (части уже записаны через recordStats). */
  function recordGroupEnd(t, scores, rk, revDue, o = {}) {
    const now = o.now || Date.now();
    const sc = scores.length ? Math.min(...scores) : 0;
    const s = P.tasks[t.id] || (P.tasks[t.id] = { a: 0, c: 0 });
    s.a++;
    if (sc === 1) s.c++;
    s.last = now;
    s.ls = sc;
    s.due = sc === 1 ? null : now + CFG.retryTaskDays[sc] * DAY;
    const note = recordReview(t, sc, rk || topicKey(t), revDue, now);
    if (!o.silent) { save(); afterAnswer(); }
    return note;
  }

  /**
   * Прогресс из журнала попыток на сервере: тот же учёт, что и при живых ответах, по порядку.
   * Строка: [id, n, score, ts, reason, rk, part, grp, exam].
   */
  function rebuildFromHistory(rows) {
    P = freshProgress();
    let pend = null, lastDay = null;
    const endGroup = () => {
      if (!pend) return;
      recordGroupEnd(byId.get(pend.g), pend.scores, pend.rk, pend.due, { now: pend.last, silent: true });
      pend = null;
    };
    for (const row of rows) {
      const [id, n, score, ts, reason, rk, part, grp, exam, blank, skip] = row;
      const day = dayKey(ts);
      if (lastDay && day !== lastDay) { endGroup(); snapshotForecast(lastDay, ts - 1); }
      lastDay = day;
      const t = byId.get(id) || { id, n, topic: '' };   // задание могло пропасть из банка после пересборки
      const sc = score === 1 ? 1 : score === 0.5 ? 0.5 : 0;
      const o = { now: ts, part: part == null ? null : part, exam: !!exam, blank: !!blank, silent: true, asg: reason === 'asg' || reason === 'work', skip: !!skip };
      const g = grp && byId.get(grp);
      if (g && g.parts) {
        if (pend && pend.g !== grp) endGroup();
        if (!pend) {
          const key = rk || topicKey(g), r = P.reviews[key];
          pend = { g: grp, scores: [], rk: key, due: !!(r && isDue(r, ts)), parts: new Set(), last: ts };
        }
        recordStats(t, sc, ts, o);
        pend.scores.push(sc);
        pend.parts.add(id);
        pend.last = ts;
        if (pend.parts.size >= g.parts.length) endGroup();
      } else {
        endGroup();
        record(t, sc, rk || null, o);
      }
    }
    endGroup();
    if (lastDay && lastDay !== dayKey(Date.now())) snapshotForecast(lastDay, Date.now());
  }

  // ------------------------------------------------------------ ответы
  const tokens = s => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е')
    .replace(/[−–—]/g, '-').split(/[\s;|,]+/).filter(Boolean);

  // «13992 или 13993» — несколько допустимых ответов: засчитываем любой
  const alternatives = ans => { const a = String(ans == null ? '' : ans).split(/\s+или\s+/i).filter(x => x.trim()); return a.length ? a : [String(ans == null ? '' : ans)]; };

  function shapeOf(t) {
    if (t.sh) return t.sh;                    // от сервера (ответа в странице нет)
    const ans = alternatives(t.ans)[0];
    const rows = String(ans).split('\n').map(tokens).filter(r => r.length);
    const total = rows.reduce((a, r) => a + r.length, 0);
    if (total <= 1) return { type: 'single' };
    const cols = Math.max(...rows.map(r => r.length));
    let nr = rows.length;
    if (nr >= 3) nr = Math.max(nr, 10); // таблица как в КЕГЭ — не подсказываем число строк
    return { type: 'grid', rows: nr, cols };
  }

  function readAnswerIn(box, shape) {
    if (shape.type === 'single') return tokens(box.querySelector('.inp-single').value);
    const out = [];
    $$('.cell', box).forEach(c => out.push(...tokens(c.value)));
    return out;
  }
  const readAnswer = () => readAnswerIn($('#answerInputs'), cur.shape);

  const sameAnswer = (expected, got) => {
    const a = tokens(expected);
    return a.length === got.length && a.every((x, i) => x === got[i]);
  };

  function answerView(ans) {
    const rows = String(ans).split('\n').map(r => r.trim()).filter(Boolean);
    if (rows.length <= 1 && tokens(ans).length <= 1) return `<span class="right-answer">${esc(ans)}</span>`;
    if (rows.length === 1) return `<span class="right-answer">${esc(rows[0])}</span>`;
    return `<table class="right-answer">${rows.map(r =>
      `<tr>${r.split(/[\s;|]+/).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`;
  }

  // ------------------------------------------------------------ отрисовка задания
  let cur = null; // { task, why, attempt, done, shape }

  const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15l3 3 3-3"/></svg>';

  function reasonHtml(t, why) {
    const topic = clusterName(t) ? ` (тип «${esc(clusterName(t))}»)` : '';
    switch (why.type) {
      case 'review':
        return why.r.stage === 0
          ? { chip: '<span class="chip review">Повторение</span>',
              line: `Недавно была ошибка в задании <b>№${numLabel(t.n)}</b>${topic}. Закрепляем на похожем задании.` }
          : { chip: `<span class="chip review">Повторение ${why.r.stage}/${CFG.reviewIntervalsDays.length}</span>`,
              line: `Интервальное повторение: проверяем, что тип <b>№${numLabel(t.n)}</b>${topic} не забылся.` };
      case 'retry':
        return { chip: '<span class="chip review">Работа над ошибкой</span>',
          line: `Это задание было решено неверно ${ago(why.last)}. Попробуйте ещё раз.` };
      case 'weak':
        return { chip: '<span class="chip weak">Слабое место</span>',
          line: `Задание <b>№${numLabel(t.n)}</b> пока получается хуже остальных — тренируем его чаще.` };
      case 'repeat':
        return { chip: '<span class="chip">Повтор</span>',
          line: 'Новые задания этого типа закончились — повторяем решённые ранее.' };
      case 'new':
        return { chip: '<span class="chip accent">Новое</span>', line: '' };
      case 'search':
        return { chip: '<span class="chip">Найдено поиском</span>', line: '' };
      case 'daily':
        return { chip: '<span class="chip accent">👑 Задание дня</span>',
          line: 'У каждого своё задание того же типа и сложности. Решишь с первой попытки — попадёшь в рейтинг по времени.' };
      case 'asg': {
        const a = why.a;
        if (!a) return { chip: '<span class="chip accent">Задание учителя</span>', line: '' };
        if (a.duel) {
          const done = a.tasks.length - asgLeft(a).length;
          return { chip: `<span class="chip accent">${a.duelId ? '⚔️ Дуэль' : '🏆 Турнир'}</span>`,
            line: `${esc(a.title)}: задание ${Math.min(done + 1, a.tasks.length)} из ${a.tasks.length}. Решай точно — важны и число верных, и время.` };
        }
        if (a.strict) {
          return { chip: `<span class="chip accent">📝 Самостоятельная</span>`,
            line: `«${esc(a.title)}»: сдано <b>${(a.done || []).length}</b> из ${a.tasks.length}. Сданный ответ можно <b>один раз</b> изменить, верно или нет — узнаешь после завершения.` };
        }
        const done = a.tasks.length - asgLeft(a).length;
        if (!a.course && a.kind) {
          const sc = a.score || {};
          return { chip: `<span class="chip accent">${kindOf(a)[0]} ${kindOf(a)[1]}</span>`,
            line: `«${esc(a.title)}»: решено <b>${done}</b> из ${a.tasks.length}${sc.grade ? ` · оценка сейчас <b>${sc.grade}</b> (${sc.pct}%)` : ''}. Оценка ставится сама: верно с 1-й попытки — полный балл, со 2-й — половина.${a.due ? ` Срок — до ${fmtDay(a.due * 1000)}.` : ''}` };
        }
        return { chip: `<span class="chip accent">${a.course ? '🎓 Курс' : 'Задание учителя'}</span>`,
          line: `Подборка «${esc(a.title)}»: решено <b>${done}</b> из ${a.tasks.length}${a.due ? ` · срок — до ${fmtDay(a.due * 1000)}` : ''}.` };
      }
      case 'history': {
        const solved = (P.tasks[t.id] || {}).c > 0 || (t.parts || []).some(p => (P.tasks[p.id] || {}).c > 0);
        return { chip: '<span class="chip">Повтор из истории</span>',
          line: (why.last ? `Вы уже решали это задание ${ago(why.last)}. Попробуйте ещё раз — без подсказок.` : '')
            + (solved ? `${why.last ? '<br>' : ''}<b>Это задание уже решено</b> — повторное решение для тренировки: опыта, огонька, серии и достижений за него нет.` : '') };
      }
      default:
        return { chip: '', line: '' };
    }
  }

  function inputsHtml(shape, inGroup) {
    if (shape.type === 'single') {
      return `<input class="inp inp-single"${inGroup ? '' : ' id="ans-single"'} autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${inGroup ? 'Ответ' : 'Ваш ответ'}">`;
    }
    const labels = shape.rows > 1;
    let h = `<div class="grid-inp" style="grid-template-columns:${labels ? 'auto ' : ''}repeat(${shape.cols}, auto)">`;
    for (let r = 0; r < shape.rows; r++) {
      if (labels) h += `<span class="rowlab">${r + 1}</span>`;
      for (let c = 0; c < shape.cols; c++) {
        h += `<input class="inp cell" data-r="${r}" data-c="${c}" autocomplete="off" spellcheck="false">`;
      }
    }
    return h + '</div>';
  }

  function partHint(shape) {
    if (shape.type === 'single') return 'одно значение';
    if (shape.rows === 1) return `${shape.cols} ${plural(shape.cols, 'значение', 'значения', 'значений')} — по одному в ячейку`;
    return 'таблица — строки по порядку';
  }
  function partAnswerHtml(x, i, withNumber) {
    return `<div class="gpart" data-i="${i}">
      <div class="gpart-row">
        ${withNumber ? `<span class="num-badge sm">${x.p.n}</span>` : ''}
        <span class="gpart-label">Ответ${withNumber ? '' : ' на ' + x.p.n}</span>
        <div class="answer-row gpart-inputs">${inputsHtml(x.shape, true)}</div>
        <span class="gpart-hint">${partHint(x.shape)}</span>
      </div>
      <div class="gpart-fb"></div>
    </div>`;
  }

  function answerLabel(shape) {
    if (shape.type === 'single') return 'Ответ';
    if (shape.rows === 1) return `Ответ — ${shape.cols} ${plural(shape.cols, 'значение', 'значения', 'значений')}, по одному в ячейку`;
    return 'Ответ — таблица: заполняйте строки по порядку, лишние оставьте пустыми. Можно вставить сразу весь ответ из буфера.';
  }

  function filesHtml(t) {
    return (t.att || []).length
      ? `<div class="files"><span>Файлы к заданию:</span>${t.att.map(a =>
          `<a class="file" href="${esc(a.href)}" download="${esc(a.name)}" target="_blank" rel="noopener">${FILE_ICON}${esc(a.name)}</a>`).join('')}</div>`
      : '';
  }

  /** Опыт за первое верное решение — как считает сервер: №1–10 по 10, №11–27 по номеру, +5 за ступень сложности. */
  const xpFor = t => (t.n <= 10 ? 10 : t.n) + 5 * (Math.max(1, Math.min(5, t.r || 1)) - 1);
  function renderTask() {
    const t = cur.task;
    const meta = [];
    const cl = clusterName(t);
    if (cl) meta.push(esc(cl));
    if (t.lv) meta.push(esc(t.lv));
    else if (t.r) meta.push(`<span title="Сложность ${t.r} из 5">${RANK_WORD[t.r]}</span>`);
    if (t.src) meta.push(esc(t.src) + (t.au ? ' (авторское)' : ''));
    else if (BANKS.length > 1) meta.push(esc(bankTitle(t.bank)));
    const fb = (GAME && GAME.fire_bonus) || 0;      // огонёк: +1 % за день к опыту (сервер считает так же)
    if (!(P.tasks[t.id] || {}).c) meta.push(`<span class="xp-tag" title="Столько опыта за первое верное решение: ${t.n <= 10 ? '10 XP за №1–10' : `${t.n} XP за №${t.n}`}${(t.r || 1) > 1 ? ` и +${5 * ((t.r || 1) - 1)} за сложность` : ''}${fb ? ` и +${fb}% за огонёк` : ''}">+${fb ? Math.floor(xpFor(t) * (100 + fb) / 100 + 0.5) : xpFor(t)} XP${fb ? ' 🔥' : ''}</span>`);
    if (t.y && !(t.src || '').includes(String(t.y))) {
      meta.push(`<span title="${t.dt ? 'Добавлено ' + esc(t.dt.split('-').reverse().join('.')) : 'Год экзамена'}">${t.y} г.</span>`);
    }
    let { chip, line } = reasonHtml(t, cur.why);
    if (isOutdated(t)) {
      const since = formatSince(t.n);
      chip = '<span class="chip weak">Старый формат</span>' + chip;
      const why = t.fmt === 'old' ? 'Это задание старого типа' : `Задание рассчитано на экзамен ${t.y} года`;
      line = `${why}: с ${since} года задание №${t.n} на ЕГЭ ${since === CFG.firstKegeYear ? 'выглядит иначе' : 'другого типа'}. В прогноз балла оно идёт с малым весом.` + (line ? '<br>' + line : '');
    }
    const files = filesHtml(t);
    const fav = favSet().has(t.id);
    const note = prefs.notes[t.id] || '';

    trainerEl.innerHTML = `
      <div class="task-head">
        ${inCourseSet() ? '<button type="button" class="btn ghost crs-up" id="crsUpBtn" title="Вернуться к списку заданий подборки">← К подборке</button>' : ''}
        ${backStack.length && !wkLive() ? '<button type="button" class="icon-btn back-btn" id="backBtn" title="Вернуться к предыдущему заданию" aria-label="Предыдущее задание">←</button>' : ''}
        <span class="num-badge">${numLabel(t.n)}</span>
        <div class="task-meta">${meta.join('<span class="sep">·</span>')}</div>
        <span class="head-chips">${chip}</span>
        <span class="task-tools">
          ${PY_BTN}
          ${BD_BTN}
          ${CALC_BTN}
          ${MARK_BTN}
          <button type="button" class="icon-btn fav-btn${fav ? ' on' : ''}" id="favBtn" aria-pressed="${fav}" title="${fav ? 'Убрать из избранного' : 'В избранное'}">${fav ? '★' : '☆'}</button>
          <button type="button" class="icon-btn note-btn${note ? ' on' : ''}" id="noteBtn" aria-expanded="${!!note}" title="Заметка к заданию">✎<span>Заметка</span></button>
        </span>
      </div>
      ${line ? `<p class="reason">${line}</p>` : ''}
      ${cur.group ? '<div class="gq-list" id="cond"></div>' : `<article class="cond" id="cond">${safeHtml(t.html)}</article>`}
      ${files}
      ${cur.group ? `<div class="answer answer-group">
        <div class="answer-label">На каждый вопрос — две попытки. Проверить можно все сразу или по одному.</div>
        <div class="feedback" id="feedback"></div>
        <div class="actions" id="actions"></div>
      </div>` : `<div class="answer">
        <div class="answer-label">${answerLabel(cur.shape)}</div>
        <div class="answer-row" id="answerInputs">${inputsHtml(cur.shape)}</div>
        <div class="feedback" id="feedback"></div>
        <div class="actions" id="actions"></div>
      </div>`}
      <div class="note-box" id="noteBox"${note ? '' : ' hidden'}>
        <label for="noteText">Заметка к заданию <span>сохраняется сама${SERVER ? ' и видна на любом устройстве' : ''}</span></label>
        <textarea class="inp" id="noteText" maxlength="2000" rows="3" placeholder="Идея решения, где ошиблись, что повторить…">${esc(note)}</textarea>
      </div>`;

    if (cur.group) buildGroupLayout(t);
    dropDuplicateFileLinks($('#cond'), t.att || []);
    decorateCondition($('#cond'), cur.task);
    if (!t.parts && markQuestions($('#cond'), t.n)) {
      const lab = $('.answer-label');
      lab.innerHTML = `<b>Ответ на задание ${t.n}</b>` + (cur.shape.type === 'single' ? '' : ' — ' + esc(answerLabel(cur.shape).replace(/^Ответ — /, '')));
    }
    guardDecorate($('#cond'), cur.trap);             // после разметки вопросов 19–21 — записка для ИИ её не путает
    renderActions();
    wkDecorate();
    pkBar();
    bindInputs();
    const first = $('#answerInputs input');
    if (first && window.matchMedia('(min-width: 861px)').matches && !pyOpen()) first.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    pySync();
    bdSync();
  }

  /**
   * В банке ЕГЭ задания 19–21 идут одним текстом («Задание 19 … Задание 20 … Задание 21 …»),
   * а ответ ждётся только на вопрос своего номера. Подсвечиваем его, остальные вопросы приглушаем.
   * Возвращает true, если разметка нашлась.
   */
  const Q_MARK = /^\s*Задание\s*№?\s*(19|20|21)(?![\d])/i;
  /**
   * Разбить текст игры на разделы «Задание 19 / 20 / 21».
   * Возвращает { lca, sections: [{ q, nodes, marker }] } или null. q = 0 — общее условие перед заголовком 19.
   */
  function findSections(el) {
    const BLOCK = /^(P|DIV|H[1-6]|LI|SECTION|B|STRONG|SPAN|TD|EM)$/;
    const found = [];
    for (const node of el.querySelectorAll('*')) {
      if (!BLOCK.test(node.tagName)) continue;
      const txt = node.textContent;
      if (txt.length > 4000 || !Q_MARK.test(txt)) continue;
      found.push(node);
    }
    // самые внутренние элементы, с которых начинается «Задание N»
    const marks = found.filter(a => !found.some(b => b !== a && a.contains(b)));
    if (!marks.length) return null;
    const lca = (() => {
      for (let x = marks[0].parentNode; x && x !== el.parentNode; x = x.parentNode) {
        if (marks.every(m => x !== m && x.contains(m))) return x;
      }
      return null;
    })();
    if (!lca) return null;
    const starts = new Map();
    for (const m of marks) {
      let x = m;
      while (x.parentNode && x.parentNode !== lca) x = x.parentNode;
      if (x.parentNode !== lca || starts.has(x)) return null;
      starts.set(x, { q: +m.textContent.match(Q_MARK)[1], marker: m });
    }
    const nums = [...starts.values()].map(v => v.q);
    const sections = [];
    let cur0 = { q: nums.includes(19) ? 0 : 19, nodes: [], marker: null }; // до первого заголовка — условие игры (оно же вопрос 19)
    for (const k of Array.from(lca.childNodes)) {
      if (starts.has(k)) {
        sections.push(cur0);
        cur0 = { q: starts.get(k).q, nodes: [], marker: starts.get(k).marker };
      }
      cur0.nodes.push(k);
    }
    sections.push(cur0);
    return { lca, sections: sections.filter(sec => sec.nodes.some(nd => nd.nodeType === 1 || nd.textContent.trim())) };
  }

  /**
   * Одно задание из общего текста 19–21 (если игры не собраны в одну страницу):
   * подсвечиваем вопрос своего номера, остальные приглушаем.
   */
  function markQuestions(el, n) {
    if (n < 19 || n > 21) return false;
    const r = findSections(el);
    if (!r) return false;
    const nums = r.sections.map(sec => sec.q);
    if (nums.filter(q => q).length < 2 || (!nums.includes(n))) return false;
    for (const sec of r.sections) {
      if (!sec.q) continue;
      const w = document.createElement('div');
      w.className = 'q-section ' + (sec.q === n ? 'q-own' : sec.q === 19 ? 'q-base' : 'q-other');
      w.dataset.q = sec.q;
      r.lca.insertBefore(w, sec.nodes[0]);
      sec.nodes.forEach(x => w.appendChild(x));
      if (sec.q === n) {
        const tag = document.createElement('div');
        tag.className = 'q-tag';
        tag.textContent = `Ваш вопрос — задание ${n}`;
        w.insertBefore(tag, w.firstChild);
      }
    }
    return true;
  }

  /** Страница 19–21: карточка вопроса → под ней поле ответа, и так для каждого номера. */
  function buildGroupLayout(t) {
    const list = $('#cond');
    const tmp = document.createElement('div');
    tmp.innerHTML = safeHtml(t.html);
    const r = findSections(tmp);
    const parts = cur.parts.map((x, i) => ({ x, i, n: x.p.n }));
    const byQ = new Map();
    let preamble = [];
    if (r) {
      for (const sec of r.sections) {
        // заголовок «Задание 20» сам по себе больше не нужен — номер стоит на карточке
        if (sec.marker && /^\s*Задание\s*№?\s*\d+\s*[.:]?\s*$/i.test(sec.marker.textContent)) {
          const parent = sec.marker.parentNode;
          sec.marker.remove();
          if (parent && parent !== r.lca && !parent.textContent.trim() && !parent.querySelector('img,table')) parent.remove();
          sec.nodes = sec.nodes.filter(nd => nd.isConnected || nd.parentNode);
        }
        if (sec.q === 0) preamble = preamble.concat(sec.nodes);
        else byQ.set(sec.q, (byQ.get(sec.q) || []).concat(sec.nodes));
      }
    }
    const card = (label, nodes, i) => {
      const c = document.createElement('article');
      c.className = 'cond gq-card';
      if (i != null) c.dataset.i = i;
      if (label) {
        const h = document.createElement('div');
        h.className = 'gq-num';
        h.innerHTML = `<span class="num-badge sm">${label}</span>`;
        c.appendChild(h);
      }
      nodes.forEach(nd => c.appendChild(nd));
      return c;
    };
    const sectioned = r && parts.every(o => byQ.has(o.n) || (o.n === 19 && preamble.length));
    if (!sectioned) {
      // не удалось разрезать текст — весь текст одной карточкой, поля ответов под ней
      list.appendChild(card('19–21', Array.from(tmp.childNodes)));
      parts.forEach(o => list.insertAdjacentHTML('beforeend', partAnswerHtml(o.x, o.i, true)));
      return;
    }
    const has19 = parts.some(o => o.n === 19);
    if (preamble.length && !has19) list.appendChild(card('', preamble));
    for (const o of parts) {
      const nodes = (o.n === 19 ? preamble : []).concat(byQ.get(o.n) || []);
      list.appendChild(card(String(o.n), nodes, o.i));
      list.insertAdjacentHTML('beforeend', partAnswerHtml(o.x, o.i, false));
    }
  }

  /** «Скачать 9.xlsСкачать 9.ods» в тексте дублирует кнопки файлов под условием — убираем из текста. */
  function dropDuplicateFileLinks(el, att) {
    if (!el || !att.length) return;
    const norm = h => {
      try {
        const path = decodeURIComponent(new URL(h, location.href).pathname);
        const m = path.match(/\/files\/([0-9a-f]+)\//);     // безликая ссылка сервера: сравниваем по коду
        return m ? m[1] : path;
      } catch (e) { return h; }
    };
    const hrefs = new Set(att.map(a => norm(a.href)));
    $$('a[href]', el).forEach(a => {
      if (!hrefs.has(norm(a.getAttribute('href')))) return;
      const parent = a.parentElement;
      a.remove();
      if (parent && parent !== el && !parent.textContent.trim() && !parent.querySelector('img,table')) parent.remove();
    });
  }

  /** Картинка не загрузилась: пробуем исходную ссылку (data-remote), иначе — понятная плашка. */
  function onImageError(img, task) {
    const alt = img.getAttribute('data-remote');
    if (alt && /^https?:/i.test(alt) && img.getAttribute('src') !== alt) { img.src = alt; return; }
    const s = document.createElement('span');
    s.className = 'img-missing';
    s.title = 'Нет файла ' + (img.getAttribute('src') || '');
    s.innerHTML = `<b>Рисунок не загрузился.</b> ${task && task.link
      ? `Он есть в <a href="${esc(task.link)}" target="_blank" rel="noopener">задании на сайте источника</a>.`
      : 'Сообщите учителю.'}`;
    img.replaceWith(s);
  }

  function decorateCondition(el, task) {
    $$('table', el).forEach(tb => {
      if (tb.parentElement && tb.parentElement.classList.contains('table-wrap')) return;
      const w = document.createElement('div');
      w.className = 'table-wrap';
      tb.parentNode.insertBefore(w, tb);
      w.appendChild(tb);
    });
    sideBySide(el);
    $$('img', el).forEach(img => {
      img.addEventListener('click', () => openLightbox(img.currentSrc || img.src));
      img.addEventListener('error', () => onImageError(img, task));
      if (img.complete && !img.naturalWidth && img.getAttribute('src')) onImageError(img, task);   // ошибка случилась раньше
    });
    $$('a', el).forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    renderMath(el);
  }

  /**
   * «На рисунке справа…»: в Яндекс Учебнике таблица и схема лежат в одном блоке, который на их сайте
   * выстроен в строку их стилями. Стили при сборке банка вычищаются, и картинка падает вниз —
   * находим такие блоки (таблица + картинка без текста) и ставим их рядом.
   */
  function sideBySide(el) {
    const onlyImage = n => n.querySelector('img') && !n.querySelector('table')
      && !n.textContent.replace(/[\s\u00a0]+/g, '');
    $$('div, p, td', el).forEach(box => {
      const kids = [...box.children];
      if (kids.length < 2 || kids.length > 3) return;
      const tables = kids.filter(k => k.querySelector('table') && !k.querySelector('img'));
      const imgs = kids.filter(onlyImage);
      if (tables.length !== 1 || !imgs.length || tables.length + imgs.length !== kids.length) return;
      box.classList.add('cond-side');
      tables[0].classList.add('side-table');
      imgs.forEach(k => k.classList.add('side-img'));
      // отступ неразрывными пробелами перед картинкой в исходнике не нужен
      imgs.forEach(k => [...k.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); }));
    });
  }

  function renderMath(el) {
    if (!el || typeof window.renderMathInElement !== 'function') return;
    // «Банк ЕГЭ» хранит формулы уже нарисованными, но без классов KaTeX — степени и дроби «плющатся».
    // Исходный TeX лежит в data-math: рисуем заново.
    if (window.katex) {
      el.querySelectorAll('[data-math]').forEach(n => {
        try { window.katex.render(n.getAttribute('data-math'), n, { throwOnError: false, displayMode: false }); } catch (e) { /* оставим как есть */ }
      });
    }
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* формула останется текстом */ }
  }

  let thinkTimer = null;
  function renderActions() {
    const a = $('#actions');
    if (!a) return;
    if ($('#pkNav')) pkBar();
    clearInterval(thinkTimer);
    if (wkTask()) { wkActions(a); return; }
    if (cur.done) {
      a.innerHTML = `<button class="btn primary" id="nextBtn" type="button">Следующее задание →<kbd>Enter</kbd></button>`
        + (inCourseSet() && cur.score === 0 && !cur.group ? '<button class="btn" id="retryBtn" type="button" title="Решить это задание ещё раз">↻ Решить заново</button>' : '')
        + (inCourseSet() ? '<button class="btn ghost" id="crsUpBtn" type="button">К подборке</button>' : '');
      $('#nextBtn').addEventListener('click', next);
      setTimeout(() => $('#nextBtn') && $('#nextBtn').focus({ preventScroll: true }), 0);
      return;
    }
    a.innerHTML = `
      <button class="btn primary" id="checkBtn" type="button">Проверить<kbd>Enter</kbd></button>
      <button class="btn" id="giveUpBtn" type="button">Показать ответ</button>
      ${cur.attempt === 0 ? '<button class="btn ghost" id="skipBtn" type="button" title="Пропустить без штрафа">Пропустить →</button>' : ''}`;
    $('#checkBtn').addEventListener('click', check);
    $('#giveUpBtn').addEventListener('click', giveUp);
    const sk = $('#skipBtn');
    if (sk) sk.addEventListener('click', next);
    // «Показать ответ» доступна не сразу: сначала нужно попробовать решить
    const tick = () => {
      const b = $('#giveUpBtn');
      if (!b) { clearInterval(thinkTimer); return; }
      const left = thinkLeft();
      b.disabled = left > 0 || busy;
      b.textContent = left > 0 ? `Показать ответ · ${fmtClock(left)}` : 'Показать ответ';
      b.title = left > 0 ? 'Сначала попробуйте решить — ответ можно будет открыть чуть позже'
        : 'Показать правильный ответ (засчитается как ошибка)';
      if (!left) clearInterval(thinkTimer);
    };
    tick();
    thinkTimer = setInterval(tick, 1000);
  }

  function bindInputs(onEnter) {
    onEnter = onEnter || (() => (cur.done ? next() : check()));
    $$('#trainer .answer-row').forEach(box => {
      const cells = $$('input', box);
      cells.forEach(inp => {
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
          else if (e.key === ' ' && inp.classList.contains('cell')) {
            e.preventDefault();
            const i = cells.indexOf(inp);
            if (cells[i + 1]) cells[i + 1].focus();
          }
        });
        inp.addEventListener('input', () => inp.classList.remove('bad'));
        // вставка сразу всего ответа в таблицу
        if (inp.classList.contains('cell')) {
          inp.addEventListener('paste', e => {
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (!/[\s;|]/.test(text.trim())) return;
            e.preventDefault();
            const r0 = +inp.dataset.r, c0 = +inp.dataset.c;
            text.trim().split(/\r?\n/).forEach((line, i) => {
              line.trim().split(/[\s;|]+/).filter(Boolean).forEach((v, j) => {
                const cell = box.querySelector(`.cell[data-r="${r0 + i}"][data-c="${c0 + j}"]`);
                if (cell) cell.value = v;
              });
            });
          });
        }
      });
    });
  }

  function setFeedback(kind, title, body) {
    const f = $('#feedback');
    f.className = `feedback show ${kind}`;
    f.innerHTML = `<div class="fb-title">${title}</div>${body || ''}`;
  }

  // ---- проверка: на сервере (ответов в странице нет) или локально — по тем же правилам
  let busy = false;

  /** Доля баллов: 1 — верно; у №26, 27 верна ровно одна половина ответа — 0.5 (1 балл из 2). */
  function answerCredit(n, expected, answer, cells) {
    return Math.max(...alternatives(expected).map(alt => credit1(n, alt, answer, cells)));
  }
  function credit1(n, expected, answer, cells) {
    const a = tokens(expected);
    let b = tokens(answer);
    const eq = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    if (a.length && eq(a, b)) return 1;
    if (n < 26 || a.length < 2 || a.length % 2) return 0;
    if (cells && cells.length === a.length) b = cells.map(c => tokens(c)[0] || '');
    if (b.length !== a.length) return 0;
    const h = a.length / 2;
    return ((eq(a.slice(0, h), b.slice(0, h)) ? 1 : 0) + (eq(a.slice(h), b.slice(h)) ? 1 : 0)) / 2;
  }
  const cellsIn = (box, shape) => (shape.type === 'single' ? null : $$('.cell', box).map(c => c.value.trim()));

  // локальный режим (без сервера): попытки, время на раздумье и лимит показов — как на сервере
  const localStates = new Map();
  function localOpen(t) {
    for (const id of t.parts ? t.parts.map(p => p.id) : [t.id]) {
      const st = localStates.get(id);
      if (!st || st.final || st.tries.length) localStates.set(id, { ts: Date.now(), tries: [], final: null });
    }
  }
  function localRevealBlock(obj, st) {
    const wait = Math.ceil((st.ts + thinkSec(obj.n) * 1000 - Date.now()) / 1000);
    if (wait > 0) return { why: 'think', wait };
    const hour = (readJSON(REVEAL_STORE) || []).filter(x => x > Date.now() - 36e5);
    if (hour.length >= RULES.reveal_per_hour) {
      return { why: 'limit', wait: Math.max(1, Math.ceil((hour[hour.length - RULES.reveal_per_hour] + 36e5 - Date.now()) / 1000)) };
    }
    return null;
  }
  function noteLocalReveal() {
    const arr = (readJSON(REVEAL_STORE) || []).filter(x => x > Date.now() - 36e5);
    arr.push(Date.now());
    writeJSON(REVEAL_STORE, arr);
  }
  const withAnswer = (res, obj) => { const r = Object.assign({}, res, { answer: obj.ans, sol: obj.sol }); delete r.hidden; return r; };
  function localCheck(obj, req) {
    let st = localStates.get(obj.id);
    if (!st) { st = { ts: Date.now(), tries: [], final: null }; localStates.set(obj.id, st); }
    if (st.final) return st.final;
    if (req.abandoned) {
      if (!st.tries.length) { localStates.delete(obj.id); return { skipped: true }; }
      return (st.final = { correct: false, final: true, score: 0 });
    }
    if (!req.gave_up) {
      st.tries.push(req.answer);
      const credit = answerCredit(obj.n, obj.ans, req.answer, req.cells);
      if (st.tries.length === 1) st.part = credit;
      if (credit === 1) return (st.final = withAnswer({ correct: true, final: true, score: st.tries.length === 1 ? 1 : 0.5, part: st.part }, obj));
      if (st.tries.length < RULES.attempts) return { correct: false, final: false };
    }
    const block = localRevealBlock(obj, st);
    let res = { correct: false, final: true, score: 0, part: st.tries.length ? st.part : 0 };
    if (block) res.hidden = block;
    else { res = withAnswer(res, obj); noteLocalReveal(); }
    return (st.final = res);
  }
  function localReveal(obj) {
    const st = localStates.get(obj.id);
    if (!st || !st.final) throw Object.assign(new Error('Ответ открывается после попыток'), { status: 409 });
    if (!st.final.hidden) return st.final;
    const block = localRevealBlock(obj, st);
    if (block) return { hidden: block };
    noteLocalReveal();
    return (st.final = withAnswer(st.final, obj));
  }

  /** Задание показано: пошло время на раздумье (сервер считает его сам). */
  function openTask(t) {
    cur.thinkUntil = Date.now() + thinkSec(t.n) * 1000;
    if (!SERVER) { localOpen(t); return; }
    const c = cur;
    api('open', { task: t.id }).then(r => {
      if (cur !== c || !r) return;
      if (r.think_left != null) cur.thinkUntil = Date.now() + r.think_left * 1000;
      if (r.trap) { cur.trap = r.trap; guardDecorate($('#cond'), r.trap); }     // ловушка «+K» для нейросетей
      restoreTries(r.tries || {});
    }).catch(() => { /* проверка всё равно пройдёт: сервер начнёт отсчёт с первого ответа */ });
  }
  /** Вернулись к заданию после неверной попытки (ушли к другому заданию подборки): попытка не сгорела —
      продолжаем со второй. Сколько попыток было, знает сервер. */
  function restoreTries(used) {
    if (!cur || cur.done) return;
    const fill = n => new Array(n).fill('—');
    if (cur.group) {
      let any = false;
      cur.parts.forEach((x, i) => {
        const n = used[x.p.id];
        if (!n || n <= x.attempt || x.final) return;
        x.answers = fill(n);
        x.attempt = n;
        partRetry(i);
        any = true;
      });
      if (!any) return;
      cur.attempt = cur.parts.reduce((a, x) => a + x.attempt, 0);
    } else {
      const n = used[cur.task.id];
      if (!n || n <= cur.attempt) return;
      cur.answers = fill(n);
      cur.attempt = n;
      setFeedback('retry', 'Осталась одна попытка',
        '<div class="fb-note">Первая попытка по этому заданию уже была — исправь ответ и проверь ещё раз.</div>');
    }
    pkPending.add(cur.task.id);
    renderActions();
  }
  const thinkLeft = () => (cur && cur.thinkUntil ? Math.max(0, Math.ceil((cur.thinkUntil - Date.now()) / 1000)) : 0);

  function payloadFor(obj, extra) {
    const rk = cur.group ? cur.revKey : (cur.why.type === 'review' ? cur.why.r.key : '');
    return Object.assign({ task: obj.id, reason: cur.why.type, rk, spent_ms: Date.now() - cur.started, away: cur.away || 0,
      away_sec: Math.round(cur.awaySec || 0), back_sec: cur.backAt ? (Date.now() - cur.backAt) / 1000 : null, paste: cur.paste ? 1 : 0 }, extra);
  }
  async function callCheck(obj, extra) {              // может выбросить ошибку сети
    if (!SERVER) return localCheck(obj, extra);
    const res = await api('check', payloadFor(obj, extra));
    if (res && res.game) onGame(res.game);
    return res;
  }
  function netError(e) {
    if (e && e.status === 401) { toast('Нужно войти заново'); logout(); return; }
    toast(e && e.status && e.message ? e.message : 'Нет связи с сервером — ответ не проверен. Попробуйте ещё раз.', 4000);
  }
  function setBusy(on) {
    busy = on;
    $$('#actions .btn').forEach(b => { b.disabled = on || (b.id === 'giveUpBtn' && thinkLeft() > 0); });
  }
  async function verify(extra) {
    setBusy(true);
    try { return await callCheck(cur.task, extra); } catch (e) {
      // учитель сделал подборку самостоятельной, пока страница была открыта: подтянем подборки и покажем старт
      if (e.status === 403 && SERVER) { toast(e.message, 4500); loadAssignments().then(() => { if (wkScope()) show(null); }).catch(() => {}); return null; }
      netError(e); return null;
    } finally { setBusy(false); }
  }

  // ---- ответ скрыт: рано (нужно подумать) или исчерпан лимит показов в час
  function hiddenHtml(h) {
    return `<div class="hidden-ans" data-until="${Date.now() + h.wait * 1000}" data-why="${esc(h.why)}">
      <div class="ha-text"></div><button type="button" class="btn ha-btn" disabled>Показать ответ</button></div>`;
  }
  /** Обратный отсчёт и кнопка «Показать ответ»; onShown(res) — когда сервер отдал ответ. */
  function armHidden(root, obj, onShown) {
    const el = root && root.querySelector('.hidden-ans');
    if (!el) return;
    const txt = el.querySelector('.ha-text'), btn = el.querySelector('.ha-btn');
    let iv = null;
    const tick = () => {
      if (!el.isConnected) { clearInterval(iv); return; }
      const left = Math.max(0, Math.ceil((+el.dataset.until - Date.now()) / 1000));
      const limit = el.dataset.why === 'limit';
      if (left) {
        txt.innerHTML = limit
          ? `Ответ пока скрыт: за час уже открыто ${RULES.reveal_per_hour} ответов. Лимит нужен, чтобы задания решались, а не подсматривались. Откроется через <b>${fmtWait(left)}</b>, а задание вернётся на повторение.`
          : `Ответ откроется через <b>${fmtClock(left)}</b>. Попробуйте ещё раз разобраться в условии — так тип задания запомнится лучше.`;
      } else {
        txt.textContent = 'Теперь ответ можно открыть.';
        clearInterval(iv);
      }
      btn.disabled = left > 0;
    };
    iv = setInterval(tick, 1000);
    tick();
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = SERVER ? await api('reveal', { task: obj.id }) : localReveal(obj);
        if (r.hidden) {
          el.dataset.until = Date.now() + r.hidden.wait * 1000;
          el.dataset.why = r.hidden.why;
          clearInterval(iv);
          iv = setInterval(tick, 1000);
          tick();
        } else {
          clearInterval(iv);
          onShown(r, el);
        }
      } catch (e) { netError(e); btn.disabled = false; }
    });
  }

  async function check() {
    if (!cur || cur.done || busy) return;
    if (wkTask()) return wkSubmit();
    if (cur.group) return checkGroup();
    const got = readAnswer();
    if (!got.length) {
      const i = $('#answerInputs input');
      if (i) { i.focus(); i.classList.add('bad'); }
      return;
    }
    const answer = got.join(' ');
    autoAttach(cur.task.id);
    const res = await verify({ answer, cells: cellsIn($('#answerInputs'), cur.shape) });
    if (!res || !cur || cur.done) return;
    cur.answers = cur.answers.concat(answer);
    cur.attempt = cur.answers.length;
    if (res.correct) return finish(res.score != null ? res.score : (cur.attempt === 1 ? 1 : 0.5), false, res);
    if (!res.final) {
      $$('#answerInputs input').forEach(i => { if (i.value.trim()) i.classList.add('bad'); });
      setFeedback('retry', 'Неверно',
        `<div class="fb-note">Осталась ещё одна попытка. Перепроверьте решение — ответ можно будет открыть после неё.</div>`);
      renderActions();
      const i = $('#answerInputs input');
      if (i) { i.focus(); i.select && i.select(); }
      return;
    }
    finish(0, false, res);
  }

  async function giveUp() {
    if (!cur || cur.done || busy || thinkLeft() > 0) return;
    if (cur.group) return giveUpGroup();
    const res = await verify({ gave_up: true });
    if (res && cur && !cur.done) finish(0, true, res);
  }

  // ---- задания 19–21: три части на одной странице
  const partBox = i => $(`.gpart[data-i="${i}"]`);

  function partAnswerFill(res) {
    const sol = res.sol;
    return `${answerView(res.answer)}${sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(sol)}</div></details>` : ''}`;
  }

  function partFinal(i, score, res, gaveUp) {
    const x = cur.parts[i], box = partBox(i);
    x.final = true;
    x.score = score;
    x.res = res || {};
    recordStats(x.p, score, Date.now(), { part: x.res.part });
    save();
    $$('input', box).forEach(inp => {
      inp.disabled = true;
      inp.classList.remove('bad');
      if (inp.value.trim()) inp.classList.add(score > 0 ? 'ok' : 'bad');
    });
    box.classList.remove('retry');
    box.classList.add(score > 0 ? 'ok' : 'bad');
    const cardEl = $(`.gq-card[data-i="${i}"]`);
    if (cardEl) { cardEl.classList.remove('retry'); cardEl.classList.add(score > 0 ? 'ok' : 'bad'); }
    let html;
    if (score === 1) html = '<span class="gp-ok">Верно</span>';
    else if (score === 0.5) html = '<span class="gp-ok">Верно со второй попытки</span>';
    else html = `<span class="gp-bad">${gaveUp ? 'Ответ' : 'Неверно. Правильный ответ'}:</span> `;
    if (x.res.hidden) html += hiddenHtml(x.res.hidden);
    else if (score > 0) html += x.res.sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(x.res.sol)}</div></details>` : '';
    else html += partAnswerFill(x.res);
    const fb = box.querySelector('.gpart-fb');
    fb.innerHTML = html;
    $$('.solution .cond', fb).forEach(decorateCondition);
    armHidden(fb, x.p, (r, el) => {
      x.res = r;
      el.outerHTML = partAnswerFill(r);
      $$('.solution .cond', fb).forEach(decorateCondition);
    });
  }

  function partRetry(i) {
    const box = partBox(i);
    box.classList.add('retry');
    const cardEl = $(`.gq-card[data-i="${i}"]`);
    if (cardEl) cardEl.classList.add('retry');
    $$('input', box).forEach(inp => { if (inp.value.trim()) inp.classList.add('bad'); });
    box.querySelector('.gpart-fb').innerHTML = '<span class="gp-retry">Неверно — осталась ещё одна попытка</span>';
  }

  async function runParts(items, extraFor) {
    setBusy(true);
    let results;
    try {
      results = await Promise.allSettled(items.map(o => callCheck(cur.parts[o.i].p, extraFor(o))));
    } finally { setBusy(false); }
    const failed = results.find(r => r.status === 'rejected');
    if (failed) netError(failed.reason);
    return results.map(r => (r.status === 'fulfilled' ? r.value : null));
  }

  async function checkGroup() {
    const todo = cur.parts.map((x, i) => ({ x, i })).filter(o => !o.x.final);
    const filled = todo.map(o => Object.assign(o, { got: readAnswerIn(partBox(o.i), o.x.shape) })).filter(o => o.got.length);
    if (!filled.length) {
      const inp = todo.length && partBox(todo[0].i).querySelector('input');
      if (inp) { inp.focus(); inp.classList.add('bad'); }
      return;
    }
    autoAttach(cur.task.id);
    const results = await runParts(filled, o => ({ answer: o.got.join(' '), cells: cellsIn(partBox(o.i), o.x.shape) }));
    if (!cur || cur.done) return;
    filled.forEach((o, k) => {
      const res = results[k];
      if (!res) return;
      o.x.answers = o.x.answers.concat(o.got.join(' '));
      o.x.attempt = o.x.answers.length;
      if (res.correct) partFinal(o.i, res.score != null ? res.score : (o.x.attempt === 1 ? 1 : 0.5), res);
      else if (res.final) partFinal(o.i, 0, res);
      else partRetry(o.i);
    });
    cur.attempt = cur.parts.reduce((a, x) => a + x.attempt, 0);
    if (cur.parts.every(x => x.final)) return finishGroup();
    renderActions();
    const firstOpen = cur.parts.findIndex(x => !x.final);
    const inp = firstOpen >= 0 && partBox(firstOpen).querySelector('input:not([disabled])');
    if (inp) { inp.focus(); inp.select && inp.select(); }
  }

  async function giveUpGroup() {
    const todo = cur.parts.map((x, i) => ({ x, i })).filter(o => !o.x.final);
    const results = await runParts(todo, () => ({ gave_up: true }));
    if (!cur || cur.done) return;
    todo.forEach((o, k) => { if (results[k]) partFinal(o.i, 0, results[k], true); });
    if (cur.parts.every(x => x.final)) finishGroup();
  }

  function taskLinks(t) {
    const links = [];
    if (t.video && t.video.yt) {
      links.push(`<a href="https://www.youtube.com/watch?v=${encodeURIComponent(t.video.yt)}${t.video.t ? `&t=${encodeURIComponent(t.video.t)}s` : ''}" target="_blank" rel="noopener">Видеоразбор</a>`);
    }
    if (t.link) links.push(`<a href="${esc(t.link)}" target="_blank" rel="noopener">Задание на сайте источника</a>`);
    return links.length ? `<div class="fb-links">${links.join('')}</div>` : '';
  }

  function finishGroup() {
    if (!cur || cur.done) return;
    cur.done = true;
    const t = cur.task;
    const scores = cur.parts.filter(x => x.final).map(x => x.score);
    const note = recordGroupEnd(t, scores, cur.revKey, cur.revDue);
    ui.currentId = null;
    save();
    const ok = scores.filter(x => x > 0).length;
    const anyHidden = cur.parts.some(x => x.res && x.res.hidden);
    const title = ok === scores.length ? `Все ${scores.length} верно!` : `Верно ${ok} из ${scores.length}`;
    const withLinks = cur.parts.map(x => x.res).find(r => r && (r.link || r.video)) || {};
    setFeedback(ok === scores.length ? 'ok' : ok ? 'retry' : 'bad', title,
      `<div class="fb-note">${note}</div>${anyHidden ? '' : taskLinks(SERVER ? withLinks : t)}`);
    renderActions();
    renderSidebar();
    renderTopbar();
  }

  /** Ушёл с задания после неверной попытки — засчитываем ошибку (и сообщаем серверу). */
  function sendAbandon(obj, useBeacon) {
    if (!SERVER) { localCheck(obj, { abandoned: true }); return; }
    if (!student) return;
    const body = payloadFor(obj, { abandoned: true, token: student.token });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('api/check', new Blob([JSON.stringify(body)], { type: 'text/plain' }));
    } else {
      api('check', body).catch(() => {});
    }
  }

  function abandonCurrent(useBeacon) {
    if (!cur || cur.done || cur.attempt === 0) return;
    cur.done = true;
    if (cur.group) {
      const now = Date.now();
      cur.parts.forEach(x => {
        if (x.final || !x.attempt) return;
        x.final = true;
        x.score = 0;
        recordStats(x.p, 0, now);
        sendAbandon(x.p, useBeacon);
      });
      recordGroupEnd(cur.task, cur.parts.filter(x => x.final).map(x => x.score), cur.revKey, cur.revDue);
    } else {
      record(cur.task, 0, cur.why.type === 'review' ? cur.why.r.key : null);
      sendAbandon(cur.task, useBeacon);
    }
    ui.currentId = null;
    save();
  }

  function finish(score, gaveUp, res) {
    if (!cur || cur.done) return;
    if (res && res.daily_fast) toast('⚠ Задание дня решено слишком быстро — так его не прочитать. Результат в рейтинг не засчитан.', 6000);
    cur.done = true;
    cur.score = score;
    const t = cur.task;
    res = res || {};
    const note = record(t, score, cur.why.type === 'review' ? cur.why.r.key : null, { part: res.part, skip: res.nocount });
    ui.currentId = null;
    save();

    $$('#answerInputs input').forEach(i => {
      i.disabled = true;
      i.classList.remove('bad');
      if (i.value.trim()) i.classList.add(score > 0 ? 'ok' : 'bad');
    });

    const solHtml = (sol, tsol) => (sol ? `<details class="solution"><summary>Решение</summary><div class="cond">${safeHtml(sol)}</div></details>` : '')
      + (tsol ? `<details class="solution" open><summary>Решение учителя</summary><pre class="tsol">${esc(tsol)}</pre></details>` : '');
    // ссылку на источник и видеоразбор сервер присылает только вместе с ответом
    const linksOf = r => taskLinks(SERVER ? { link: r.link, video: r.video } : t);
    const extra = res.hidden ? '' : linksOf(res) + solHtml(res.sol, res.tsol);
    const half = res.part === 0.5 && score < 1
      ? '<div class="fb-note">Одно из двух чисел с первой попытки было верным — на экзамене это 1 балл из 2.</div>' : '';

    const streak = currentStreak();
    const noCount = res.nocount ? '<div class="fb-note fb-fast">Это задание уже решено или его ответ тебе уже показывали — решение засчитано для тренировки, но <b>без опыта, огонька, серии и достижений</b>.</div>' : '';
    const fastNote = noCount || !res.fast ? noCount : res.fast_min > 1
      ? `<div class="fb-note fb-fast">⏱ Задание №${t.n} засчитывается, только если над ним работать не меньше <b>${res.fast_min} минут</b> — так быстро его не решают.
          Поэтому <b>−1 XP и −1 ₿</b> вместо награды. Задание не засчитано решённым: реши его ещё раз позже, вдумчиво.</div>`
      : '<div class="fb-note fb-fast">⏱ Решено быстрее чем за минуту — это похоже на подсмотренный ответ, поэтому <b>−1 XP</b> вместо опыта. Задание не засчитано решённым: реши его ещё раз позже, вдумчиво.</div>';
    if (score === 1) {
      setFeedback('ok', 'Верно!',
        `<div class="fb-note">${note || (streak >= 3 ? `Серия: ${streak} ${plural(streak, 'задание', 'задания', 'заданий')} подряд без ошибок.` : '')}</div>${fastNote}${extra}`);
    } else if (score === 0.5) {
      setFeedback('ok', 'Верно со второй попытки', `<div class="fb-note">${note}</div>${fastNote}${half}${extra}`);
    } else {
      const ans = res.hidden ? hiddenHtml(res.hidden) : `<div>${gaveUp ? '' : 'Правильный ответ: '}${answerView(res.answer)}</div>`;
      setFeedback('bad', res.hidden ? (gaveUp ? 'Ответ пока скрыт' : 'Неверно') : gaveUp ? 'Правильный ответ' : 'Неверно',
        `${ans}${half}<div class="fb-note">${note}</div>${extra}`);
      armHidden($('#feedback'), t, (r, el) => {
        el.outerHTML = `<div>Правильный ответ: ${answerView(r.answer)}</div>`;
        const fb = $('#feedback');
        if (fb) {
          fb.insertAdjacentHTML('beforeend', linksOf(r) + solHtml(r.sol, r.tsol));
          $$('.solution .cond', fb).forEach(decorateCondition);
        }
      });
    }
    $$('#feedback .solution .cond').forEach(decorateCondition);
    renderActions();
    renderSidebar();
    renderTopbar();
    asgAfterAnswer();
  }

  function show(pick) {
    leaveCourse();
    // самостоятельная ещё не начата (или уже сдана): задания в обычном виде не показываем — только старт или результат
    if (wkScope() && !wkLive() && !examShown) { cur = null; wkGate(wkScope()); return; }
    // идёт самостоятельная: её задание открывается только в её режиме, откуда бы ни пришли (←, поиск, история)
    const wl = wkLive();
    if (wl && pick && (pick.why || {}).type !== 'asg') {
      if (!wl.tasks.includes(pick.task.id)) pick = pickNext();
      if (pick) pick = Object.assign({}, pick, { why: { type: 'asg', a: wl } });
    }
    if (!pick && wkScope()) { cur = null; wkDoneScreen(); return; }
    if (!pick) {
      cur = null;
      trainerEl.innerHTML = `<div class="empty"><h2>Нет заданий</h2><p>В выбранном разделе нет заданий${ui.bank !== 'all' ? ' этого банка' : ''}${ui.period !== 'all' ? ' за выбранный период' : ''}. Попробуйте другой период в панели слева.</p></div>`;
      renderTopbar();
      return;
    }
    const t0 = pick.task;
    if (cur && cur.task && cur.task.id !== t0.id && !pick.back) {
      backStack.push(cur.task.id);
      if (backStack.length > 50) backStack.shift();
    }
    const revKey = pick.why.type === 'review' ? pick.why.r.key : topicKey(t0);
    const rv = P.reviews[revKey];
    cur = {
      task: t0, why: pick.why, attempt: 0, answers: [], done: false, started: Date.now(),
      revKey, revDue: !!(rv && isDue(rv, Date.now())),
      group: !!t0.parts,
      shape: t0.parts ? null : shapeOf(t0),
      parts: (t0.parts || []).map(p => ({ p, shape: shapeOf(p), answers: [], attempt: 0, final: false, score: null })),
    };
    recent.push(pick.task.id);
    if (recent.length > 50) recent.splice(0, recent.length - 50);
    ui.currentId = pick.task.id;
    save();
    openTask(t0);
    renderTask();
    renderTopbar();
  }

  function next() {
    abandonCurrent();
    if (cur) lastNum = cur.task.n;
    show(pickNext(cur && cur.task.id));
  }

