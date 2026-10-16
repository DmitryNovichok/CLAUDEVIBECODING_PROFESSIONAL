  // ------------------------------------------------------------ живые обновления (SSE)
  /* Сервер сам сообщает «поменялось»: comp — дуэли и турниры, asg — подборки от учителя, support — ответ техподдержки; страница перезапрашивает нужное.
     Одно соединение на браузер: вкладки решают через Web Locks, какая ведущая. Она держит /api/live и пересылает
     события остальным через BroadcastChannel; закрыли её — соединение подхватывает другая вкладка.
     Нет связи или браузер старый — работает прежний опрос (livePoll), только чаще. */
  const LV = { up: false, upAt: 0, sentAt: 0, chan: null, started: false, dirty: new Set(), timers: {}, was: false, gen: 0, ctrl: null };
  const liveOn = () => LV.up && Date.now() - LV.upAt < 70000;
  function liveStart() {
    if (LV.started || !SERVER || !student || TEACHER || !window.fetch || !window.ReadableStream || !window.TextDecoder) return;
    LV.started = true;
    const key = 'egeshka-live-' + student.sid;
    if ('BroadcastChannel' in window) {
      LV.chan = new BroadcastChannel(key);
      LV.chan.onmessage = e => liveMsg(e.data || {});
    }
    const gen = ++LV.gen;
    if (navigator.locks && LV.chan) {
      LV.chan.postMessage({ t: 'hi' });                 // ведущая уже есть — пусть скажет, что связь жива
      navigator.locks.request(key, () => liveConnect(gen)).catch(() => {});
    } else liveConnect(gen);                           // без замков у каждой вкладки своё соединение
  }
  /** Выход из аккаунта: закрыть соединение и канал — следующий ученик в этой вкладке получит своё. */
  function liveStop() {
    LV.gen++;
    if (LV.ctrl) LV.ctrl.abort();
    if (LV.chan) LV.chan.close();
    Object.assign(LV, { up: false, chan: null, started: false, lead: false, was: false, ctrl: null });
    LV.dirty.clear();
  }
  function liveMsg(m) {
    if (m.t === 'up') { LV.up = true; LV.upAt = Date.now(); }
    else if (m.t === 'down') LV.up = false;
    else if (m.t === 'hi' && LV.lead && liveOn()) LV.chan.postMessage({ t: 'up' });
    else if (m.t === 'ev') liveEvent(m.topic);
  }
  function liveMark(up) {
    const was = LV.up;
    LV.up = up; LV.upAt = Date.now();
    // остальным вкладкам — не чаще раза в 20 с, пока ничего не меняется
    if (LV.chan && (up !== was || Date.now() - LV.sentAt > 20000)) { LV.sentAt = Date.now(); LV.chan.postMessage({ t: up ? 'up' : 'down' }); }
  }
  async function liveConnect(gen) {
    if (gen !== LV.gen) return;                        // пока ждали замок, ученик вышел
    LV.lead = true;
    let delay = 3000;
    while (SERVER && student && !TEACHER && gen === LV.gen) {
      let got = false;
      try {
        LV.ctrl = new AbortController();
        const r = await fetch('api/live', { headers: { 'X-Token': student.token }, cache: 'no-store', signal: LV.ctrl.signal });
        if (r.status === 401) break;
        if (!r.ok || !r.body) throw new Error('live ' + r.status);
        const rd = r.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          liveMark(true);
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const ev = (/^event: (\w+)$/m.exec(buf.slice(0, i)) || [])[1];
            buf = buf.slice(i + 2);
            if (ev === 'hello') {
              got = true;
              if (LV.was) { liveSend('comp'); liveSend('asg'); }    // переподключились — вдруг что-то пропустили
              LV.was = true;
            } else if (ev) liveSend(ev);
          }
        }
      } catch (e) { /* сеть пропала — переподключимся */ }
      if (gen !== LV.gen) return;                      // вышли из аккаунта — соединение закрыто намеренно
      liveMark(false);
      delay = got ? 3000 : Math.min(delay * 2, 120000);
      await new Promise(res => setTimeout(res, delay + Math.random() * 2000));
    }
    if (gen === LV.gen) LV.lead = false;
  }
  function liveSend(topic) {
    if (LV.chan) LV.chan.postMessage({ t: 'ev', topic });
    liveEvent(topic);
  }
  /** Событие пришло: вкладка на виду — обновляем (пачку подряд — один раз), в фоне — когда на неё вернутся. */
  function liveEvent(topic) {
    if (document.hidden) { LV.dirty.add(topic); return; }
    clearTimeout(LV.timers[topic]);
    LV.timers[topic] = setTimeout(() => liveRun(topic), 200 + Math.random() * 800);   // не все ученики класса в одну миллисекунду
  }
  function liveRun(topic) {
    if (topic === 'comp') { liveAt = Date.now(); loadDuels(true); }
    else if (topic === 'asg') {
      // новая подборка для класса — одно короткое уведомление (личные подборки объявляет asgNotices)
      const had = new Set(ASG.map(a => a.id));
      loadAssignments().then(() => {
        const fresh = ASG.filter(a => !a.duel && !a.course && !a.personal && !a.closed && !had.has(a.id));
        if (fresh.length) toast(fresh.length === 1 ? `📚 Учитель выдал подборку «${fresh[0].title}» — она в «Подборках»` : `📚 Учитель выдал подборки: ${fresh.length}`, 6000);
      }).catch(() => {});
    }
    else if (topic === 'support') liveSupport();
  }
  /** Учитель ответил в техподдержке: точка на кнопке, уведомление; окно поддержки открыто и черновика нет — обновить. */
  async function liveSupport() {
    const was = (SUPPORT && SUPPORT.unread) || 0;
    await loadSupport();
    if (SUPPORT && SUPPORT.unread > was) toast('🛟 Пришёл ответ техподдержки — открой «Техподдержку»', 6000);
    if (!$('#forecastModal').hidden && $('#spForm') && [...$('#forecastBody').querySelectorAll('textarea')].every(t => !t.value.trim())
      && ![...$('#forecastBody').querySelectorAll('[data-sp-box]')].some(b => b.spImg)) openSupport();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !LV.dirty.size) return;
    const ts = [...LV.dirty];
    LV.dirty.clear();
    ts.forEach(liveEvent);
  });
