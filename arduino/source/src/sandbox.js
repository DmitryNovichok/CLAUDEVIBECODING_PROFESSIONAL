/* Educational sketches are untrusted code, including projects opened by a
   teacher. The worker belongs to an opaque frame with no network permission.
   There is no credential, fetch, navigation or application-command bridge. */
export function normaliseArduinoEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const pin = n => Number.isInteger(n) && n >= 0 && n <= 255;
  switch (value.type) {
    case 'pin': return pin(value.pin) && finite(value.value) && value.value >= 0 && value.value <= 1
      ? {type:'pin',pin:value.pin,value:value.value} : null;
    case 'mode': return pin(value.pin) && [0,1,2].includes(value.value)
      ? {type:'mode',pin:value.pin,value:value.value} : null;
    case 'servo': return pin(value.pin) && finite(value.value)
      ? {type:'servo',pin:value.pin,value:Math.max(0,Math.min(180,value.value))} : null;
    case 'tone': return pin(value.pin) && finite(value.hz) && value.hz >= 0 && value.hz <= 20000
      ? {type:'tone',pin:value.pin,hz:value.hz} : null;
    case 'lcd': return Array.isArray(value.pins) && value.pins.length === 6 && value.pins.every(pin) && typeof value.text === 'string'
      ? {type:'lcd',pins:value.pins.slice(),text:value.text.slice(0,512)} : null;
    case 'serial': return typeof value.text === 'string' ? {type:'serial',text:value.text.slice(0,30000)} : null;
    case 'error': return typeof value.message === 'string' ? {type:'error',message:value.message.slice(0,2000)} : null;
    default: return null;
  }
}

function frameBootstrap(normalise) {
  'use strict';
  let worker, port, stopped = false;
  function stop() { stopped = true; worker?.terminate(); port?.close(); }
  addEventListener('unload', stop);
  addEventListener('message', function initialise(event) {
    if (event.source !== parent || event.data?.type !== 'ege-arduino-init' || !event.ports[0]) return;
    removeEventListener('message', initialise);
    port = event.ports[0];
    function fail(message) { if (!stopped) port.postMessage({kind:'failure',message}); stop(); }
    try {
      const url = URL.createObjectURL(new Blob([event.data.source], {type:'text/javascript'}));
      worker = new Worker(url); URL.revokeObjectURL(url);
      let start = Date.now(), count = 0, bytes = 0, costly = 0, serial = 0;
      const hardware = new Map();
      worker.onmessage = event => {
        if (stopped) return;
        if (Date.now() - start >= 1000) { start = Date.now(); count = bytes = costly = serial = 0; }
        if (++count > 10000) return fail('Скетч отправляет слишком много событий. Добавьте delay() в цикл.');
        const message = normalise(event.data);
        if (!message) return;
        if (!['serial','error'].includes(message.type)) {
          const key = message.type + ':' + (message.pins ? message.pins.join(',') : message.pin);
          const signature = JSON.stringify(message);
          if (hardware.get(key) === signature) return; // repeated state needs no UI/oscillator rebuild
          hardware.set(key,signature);
          if (hardware.size > 1024 || (message.type !== 'pin' && ++costly > 200))
            return fail('Скетч слишком часто меняет периферию. Добавьте delay() в цикл.');
        }
        if (message.type === 'serial' && ++serial > 200)
          return fail('Слишком частый вывод. Добавьте delay() между сообщениями Serial.print().');
        bytes += (message.text || message.message || '').length;
        if (bytes > 1000000) return fail('Слишком много вывода. Уменьшите частоту Serial.print().');
        // Transport control is outside the worker payload, so a sketch cannot
        // forge readiness or ask the parent to fetch a URL using its cookies.
        port.postMessage({kind:'event',event:message});
      };
      worker.onerror = event => { event.preventDefault?.(); fail(String(event.message || 'Ошибка выполнения').slice(0,2000)); };
      port.onmessage = event => {
        if (event.data?.type === 'stop') return stop();
        if (!stopped && ['inputs','serial'].includes(event.data?.type)) worker.postMessage(event.data);
      };
      port.start(); port.postMessage({kind:'ready'});
    } catch (_) { fail('Не удалось запустить изолированную среду Arduino.'); }
  });
}

export function arduinoFrameSource() {
  return '<!doctype html><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; worker-src blob:; child-src blob:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
    '<title>Arduino</title><script>(' + frameBootstrap.toString() + ')(' + normaliseArduinoEvent.toString() + ');</script>';
}

export function startEducationalSandbox(source, callbacks, environment = globalThis) {
  if (!environment.document?.body || !environment.MessageChannel)
    throw Error('Для изолированной среды Arduino нужен современный браузер.');
  const frame = environment.document.createElement('iframe');
  frame.hidden = true; frame.title = 'Изолированная среда Arduino'; frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('sandbox','allow-scripts');
  frame.srcdoc = arduinoFrameSource(); // The sketch is NEVER interpolated into HTML.
  let closed = false, ready = false, port = null, latestInputs = null, pendingSerial = '', timer;
  const stop = () => {
    if (closed) return;
    closed = true; environment.clearTimeout(timer);
    try { port?.postMessage({type:'stop'}); } catch (_) { /* port already closed */ }
    port?.close(); frame.onload = null; frame.remove();
    latestInputs = null; pendingSerial = '';
  };
  const fail = message => { if (!closed) { stop(); callbacks.error(message); } };
  const flush = () => {
    if (!ready || closed) return;
    if (latestInputs) { port.postMessage(latestInputs); latestInputs = null; }
    if (pendingSerial) { port.postMessage({type:'serial',text:pendingSerial}); pendingSerial = ''; }
  };
  frame.onload = () => {
    if (closed) return;
    frame.onload = null;
    const channel = new environment.MessageChannel(); port = channel.port1;
    port.onmessage = event => {
      if (closed) return;
      const packet = event.data;
      if (packet?.kind === 'ready') { ready = true; environment.clearTimeout(timer); flush(); return; }
      if (packet?.kind === 'failure') return fail(typeof packet.message === 'string' ? packet.message.slice(0,2000) : 'Ошибка среды Arduino');
      if (packet?.kind === 'event') {
        const message = normaliseArduinoEvent(packet.event);
        if (message) callbacks.event(message);
      }
    };
    port.start();
    try {
      frame.contentWindow.postMessage({type:'ege-arduino-init',
        source:'if (self.location.origin !== "null") throw Error("Arduino requires an opaque worker origin");\n' + source}, '*', [channel.port2]);
    } catch (_) { fail('Не удалось запустить изолированную среду Arduino.'); }
  };
  timer = environment.setTimeout(() => fail('Среда Arduino не запустилась. Обновите страницу и повторите запуск.'),10000);
  environment.document.body.appendChild(frame);
  const numbers = value => {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    for (const [key,n] of Object.entries(value).slice(0,256))
      if (/^(?:(?:temp|humidity|pulse|trigger)?\d{1,3})$/.test(key) && typeof n === 'number' && Number.isFinite(n)) result[key] = n;
    return result;
  };
  return {
    stop,
    inputs(digital,analog) { if (!closed) { latestInputs = {type:'inputs',digital:numbers(digital),analog:numbers(analog)}; flush(); } },
    serial(text) { if (!closed) { pendingSerial = (pendingSerial + String(text)).slice(-4096); flush(); } },
  };
}
