/* Панель учителя до входа. Сервер отдаёт этот файл по адресу admin.js, пока учитель не вошёл:
   код самой панели получает только вошедший учитель. После входа страница перезагружается — и приходит панель. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const err = $('#admLoginErr');
  $('#appView') && ($('#appView').hidden = true);
  $('#loginView').hidden = false;
  const focusCredentials = () => ($('#admLogin').value.trim() ? $('#admPassword') : $('#admLogin')).focus();
  setTimeout(focusCredentials, 30);
  if (location.protocol === 'file:') err.textContent = 'Панель работает только через сервер: запустите python server.py и откройте http://localhost:8000/admin';
  if (new URLSearchParams(location.search).has('switch')) history.replaceState(null, '', location.pathname);


  // вход главного учителя в два шага: пароль верный → код из письма на его почту
  let codeTicket = null;
  function loginErrorFields(invalid = false) {
    for (const id of ['admLogin', 'admPassword', 'admCode']) {
      const field = $('#' + id);
      if (invalid && !field.hidden) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
  }
  for (const id of ['admLogin', 'admPassword', 'admCode']) $('#' + id).addEventListener('input', () => {
    loginErrorFields();
    $('#admLoginErr').textContent = '';
  });
  function codeStep(d) {
    loginErrorFields();
    codeTicket = d ? d.ticket : null;
    $('#admLogin').hidden = !!d; $('#admPassword').hidden = !!d; $('#admPassword').required = !d;
    document.querySelectorAll('label[for="admLogin"], label[for="admPassword"]').forEach(label => { label.hidden = !!d; });
    $('#admCode').hidden = !d; $('#admCode').required = !!d; $('#admCodeBack').hidden = !d;
    $('#admCodeNote').hidden = !d;
    if (d) {
      $('#admCodeNote').textContent = d.backup_only
        ? 'Пароль верный, но отправка письма сейчас недоступна. Введите один из сохранённых резервных кодов. Каждый код работает один раз.'
        : `Пароль верный. Почтовый сервер принял письмо с кодом для ${d.to || 'вашей почты'}. Код действует ${d.minutes || 10} минут. Проверьте «Спам» или используйте сохранённый резервный код. Для повтора отправки вернитесь к входу через минуту.`;
      $('#admCode').value = '';
      setTimeout(() => $('#admCode').focus(), 30);
    } else { $('#admPassword').value = ''; setTimeout(focusCredentials, 30); }
  }
  $('#admCodeBack').addEventListener('click', () => { codeStep(null); $('#admLoginErr').textContent = ''; });
  const loginBody = () => (codeTicket ? { ticket: codeTicket, code: $('#admCode').value }
    : { login: $('#admLogin').value, password: $('#admPassword').value });
  $('#admLoginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    loginErrorFields();
    err.className = 'login-err';
    err.textContent = '';
    try {
      const r = await fetch('api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(loginBody())
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 410) codeStep(null);
      if (!r.ok) {
        loginErrorFields(r.status === 401 || r.status === 403);
        throw new Error(d.error || 'Ошибка входа');
      }
      if (d.need_code) { codeStep(d); btn.disabled = false; return; }
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
