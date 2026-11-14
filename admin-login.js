/* Панель учителя до входа. Сервер отдаёт этот файл по адресу admin.js, пока учитель не вошёл:
   код самой панели получает только вошедший учитель. После входа страница перезагружается — и приходит панель. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const err = $('#admLoginErr');
  $('#appView') && ($('#appView').hidden = true);
  $('#loginView').hidden = false;
  setTimeout(() => $('#admPassword') && $('#admPassword').focus(), 30);
  if (location.protocol === 'file:') err.textContent = 'Панель работает только через сервер: запустите python server.py и откройте http://localhost:8000/admin';
  if (new URLSearchParams(location.search).has('switch')) history.replaceState(null, '', location.pathname);

  $('#admLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    err.className = 'login-err';
    err.textContent = '';
    try {
      const r = await fetch('api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ login: $('#admLogin').value, password: $('#admPassword').value })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Ошибка входа');
      $('#admPassword').value = '';
      location.reload();
    } catch (x) {
      err.textContent = x.message === 'Failed to fetch' ? 'Нет связи с сервером' : x.message;
      btn.disabled = false;
    }
  });
  $('#admForgot').addEventListener('click', async () => {
    const who = ($('#admLogin').value.trim() || prompt('Почта или логин, с которыми вы входите:') || '').trim();
    if (!who) return;
    try {
      const r = await fetch('api/pw/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who, kind: 't' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Не получилось');
      err.className = 'login-err ok';
      err.textContent = 'Если у этого аккаунта есть почта — письмо со ссылкой уже в пути (проверьте «Спам»). Ссылка действует 1 час.';
    } catch (x) { err.className = 'login-err'; err.textContent = x.message; }
  });
})();
