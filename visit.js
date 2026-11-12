/* «Я на сайте» для главного учителя: окно входа ученика, регистрация учителя, гостевая панель.
   EgVisit.start(role, stage) — отмечаться раз в 20 секунд; EgVisit.stop() — ушёл (вошёл, закрыл окно).
   Без ФИО и адресов: только случайный номер вкладки, роль и этап. */
(function () {
  'use strict';
  let vid = '', role = '', stage = '', timer = 0;
  try { vid = sessionStorage.getItem('egeshka.vid') || ''; } catch (e) { /* без хранилища — номер на эту страницу */ }
  if (!/^[a-z0-9]{12,40}$/.test(vid)) {
    vid = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join('');
    try { sessionStorage.setItem('egeshka.vid', vid); } catch (e) { /* нет доступа */ }
  }
  const send = leave => {
    if (!role) return;
    const body = JSON.stringify({ vid, role, stage, leave: !!leave });
    if (leave && navigator.sendBeacon) { navigator.sendBeacon('api/visit', new Blob([body], { type: 'application/json' })); return; }
    fetch('api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin', keepalive: !!leave }).catch(() => {});
  };
  function start(r, s) {
    const changed = r !== role || s !== stage;
    role = r; stage = s;
    if (changed) send();
    if (!timer) timer = setInterval(() => send(), 20000);
  }
  function stop() {
    if (!role) return;
    send(true);
    role = ''; stage = '';
    clearInterval(timer); timer = 0;
  }
  addEventListener('pagehide', () => { if (role) send(true); });
  addEventListener('pageshow', e => { if (e.persisted && role) send(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && role) send(); });
  window.EgVisit = { start, stop };
})();
