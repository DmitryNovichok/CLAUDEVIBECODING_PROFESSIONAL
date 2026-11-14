(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  // An old open admin page may request this script after its access was revoked.
  if (!$('teacherGateRoot')) { location.replace('/admin'); return; }
  let busy = false, state = null;
  function message(text, error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
  }
  async function request(path, body) {
    const response = await fetch('/api/admin/' + path, {credentials: 'same-origin', cache: 'no-store',
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body)});
    const data = await response.json();
    if (response.status === 401) { location.replace('/admin'); throw new Error('Войдите заново'); }
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
    return data;
  }
  function render(me) {
    state = me;
    const gate = me.onboarding;
    if (gate.ready) { location.replace('/admin'); return; }
    $('account').textContent = [me.name, me.email || me.login].filter(Boolean).join(' · ');
    $('emailCard').classList.toggle('done', gate.email_confirmed);
    $('emailBadge').textContent = gate.email_confirmed ? 'Подтверждена' : 'Нужно подтвердить';
    $('emailDetail').textContent = gate.email_confirmed ? 'Адрес подтверждён. Этот шаг пройден.' :
      me.email ? 'Откройте ссылку из письма на ' + me.email + '. Проверьте также папку «Спам».' : 'Укажите адрес, чтобы получить письмо с подтверждением.';
    $('emailActions').hidden = gate.email_confirmed || gate.registration_required;
    $('mailUnavailable').hidden = me.mail_on;
    $('resend').disabled = !me.mail_on || !me.email;
    $('moderationCard').classList.toggle('done', gate.moderation === 'approved');
    $('moderationCard').classList.toggle('rejected', gate.moderation === 'rejected');
    const status = {
      approved: ['Одобрено', 'Главный учитель одобрил аккаунт. Этот шаг пройден.'],
      pending: ['На рассмотрении', 'Заявка уже направлена главному учителю. Дождитесь решения; повторно регистрироваться не нужно.'],
      rejected: ['Отклонено', 'Главный учитель отклонил заявку. Доступ остаётся закрытым. Свяжитесь с ним для уточнения причины.']
    }[gate.moderation] || ['На рассмотрении', 'Дождитесь решения главного учителя.'];
    $('moderationBadge').textContent = status[0];
    $('moderationDetail').textContent = status[1];
    $('reviewNote').hidden = !gate.note;
    $('reviewNote').textContent = gate.note ? 'Комментарий главного учителя: ' + gate.note : '';
    $('legacyGuest').hidden = !gate.registration_required;
  }
  async function refresh(quiet = false) {
    if (busy) return;
    busy = true;
    $('refresh').disabled = true;
    try {
      render(await request('status'));
      if (!quiet) message('Статус обновлён. Доступ откроется после обеих проверок.');
    } catch (error) { message(error.message || 'Нет связи с сервером. Повторите проверку.', true); }
    finally { busy = false; $('refresh').disabled = false; }
  }
  $('refresh').addEventListener('click', () => refresh());
  $('resend').addEventListener('click', async () => {
    $('resend').disabled = true;
    try { const data = await request('email/resend', {}); message(data.confirmed ? 'Почта уже подтверждена.' : 'Письмо отправляется. Проверьте почту и папку «Спам».'); }
    catch (error) { message(error.message, true); }
    finally { await refresh(true); }
  });
  $('editEmail').addEventListener('click', () => {
    $('emailForm').hidden = !$('emailForm').hidden;
    if (!$('emailForm').hidden) { $('emailInput').value = state?.email || ''; $('emailInput').focus(); }
  });
  $('emailForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      const result = await request('email/change', {email: $('emailInput').value.trim()});
      $('emailForm').hidden = true;
      message(result.email_sent ? 'Адрес сохранён. Письмо отправляется на новую почту.' : 'Адрес сохранён. Отправка писем сейчас недоступна.', !result.email_sent);
      await refresh(true);
    } catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
  $('logout').addEventListener('click', async () => {
    try { await request('logout', {}); location.replace('/admin'); }
    catch (error) { message(error.message, true); }
  });
  setInterval(() => { if (!document.hidden) refresh(true); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
  refresh(true);
})();
