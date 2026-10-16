  // ------------------------------------------------------------ живые обновления (SSE)
  /* Сервер сам сообщает «поменялось»: comp — дуэли и турниры, asg — подборки от учителя; страница перезапрашивает нужное.
     Одно соединение на браузер: вкладки решают через Web Locks, какая ведущая. Она держит /api/live и пересылает
     события остальным через BroadcastChannel; закрыли её — соединение подхватывает другая вкладка.
     Нет связи или браузер старый — работает прежний опрос (livePoll), только чаще. */
  const LV = { up: false, upAt: 0, sentAt: 0, chan: null, started: false, dirty: new Set(), timers: {}, was: false };
  const liveOn = () => LV.up && Date.now() - LV.upAt < 70000;
  function liveStart() {
    if (LV.started || !SERVER || !student || TEACHER || !window.fetch || !window.ReadableStream || !window.TextDecoder) return;
    LV.started = true;
    const key = 'egeshka-live-' + student.sid;
    if ('BroadcastChannel' in window) {
      LV.chan = new BroadcastChannel(key);
      LV.chan.onmessage = e => liveMsg(e.data || {});
    }
    if (navigator.locks && LV.chan) {
      LV.chan.postMessage({ t: 'hi' });                 // ведущая уже есть — пусть скажет, что связь жива
      navigator.locks.request(key, () => liveConnect()).catch(() => {});
    } else liveConnect();                              // без замков у каждой вкладки своё соединение
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
  async function liveConnect() {
    LV.lead = true;
    let delay = 3000;
    while (SERVER && student && !TEACHER) {
      let got = false;
      try {
        const r = await fetch('api/live', { headers: { 'X-Token': student.token }, cache: 'no-store' });
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
      liveMark(false);
      delay = got ? 3000 : Math.min(delay * 2, 120000);
      await new Promise(res => setTimeout(res, delay + Math.random() * 2000));
    }
    LV.lead = false;
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
    else if (topic === 'asg') loadAssignments().catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !LV.dirty.size) return;
    const ts = [...LV.dirty];
    LV.dirty.clear();
    ts.forEach(liveEvent);
  });
