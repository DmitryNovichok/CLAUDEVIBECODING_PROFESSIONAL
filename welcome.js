/* Главная страница: тарифы и контакты с сервера, регистрация учителя, гостевой вход, снимки панели */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Нет связи с сервером — попробуйте ещё раз');
    return d;
  };
  const days = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней'}`;

  // ---- тарифы и контакты
  fetch('api/public/offer', { cache: 'no-store' }).then(r => r.json()).then(o => {
    $('#trialDays').textContent = o.trial_days;
    document.querySelectorAll('.trial-txt').forEach(e => { e.textContent = days(o.trial_days); });
    $('#guestMin').textContent = o.guest_minutes;
    $('#prices-list').innerHTML = (o.tariffs || []).map((t, i) => `<div class="w-price${i === 1 ? ' hl' : ''}">
        <h3>${esc(t.name)}</h3><div class="p">${esc(t.price)}${t.per ? ` <small>/ ${esc(t.per)}</small>` : ''}</div>
        <ul>${String(t.items || '').split('\n').filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${i === 0 ? '<button type="button" class="w-btn primary" data-signup>Попробовать</button>' : '<a class="w-btn" href="#contacts">Связаться</a>'}</div>`).join('');
    const c = o.contacts || {}, links = [];
    if (c.email) links.push(`<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>`);
    if (c.telegram) {
      const tg = c.telegram.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
      links.push(`<a href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">💬 Telegram @${esc(tg)}</a>`);
    }
    if (c.phone) links.push(`<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(c.phone)}</a>`);
    if (links.length) $('#contacts-list').innerHTML = links.join('');
  }).catch(() => { /* оставим то, что в разметке */ });

  // ---- регистрация учителя
  const modal = $('#signupModal');
  const open = () => { modal.hidden = false; setTimeout(() => $('#suName').focus(), 30); };
  document.addEventListener('click', e => {
    if (e.target.closest('[data-signup]')) { e.preventDefault(); open(); }
    if (e.target.closest('[data-close]') || e.target === modal) modal.hidden = true;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });
  if (location.hash === '#signup') open();
  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('#suErr').textContent = '';
    try {
      await post('api/teacher/signup', { name: $('#suName').value, email: $('#suEmail').value, password: $('#suPass').value, accept: $('#suAccept').checked });
      location.href = '/admin';
    } catch (err) { $('#suErr').textContent = err.message; btn.disabled = false; }
  });

  // ---- гостевой вход: час в панели с демо-классом
  $('#guestBtn').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true;
    $('#guestErr').textContent = '';
    try { await post('api/teacher/guest'); location.href = '/admin'; } catch (err) { $('#guestErr').textContent = err.message; b.disabled = false; }
  });

  // ---- снимки панели
  const caps = {
    digest: 'Сводка недели: средний прогноз, слабые номера класса, кто отстаёт и кто не занимался. Кнопка — подборка по слабым номерам.',
    journal: 'Журнал класса: оценка за каждую работу, прогноз балла с динамикой за месяц, варианты ЕГЭ.',
    build: 'Создать подборку: шаблоны в один клик — вариант ЕГЭ, 10 заданий на номер, работа над ошибками класса.',
    archive: 'Архив работ одним PDF: сводная таблица, КИМ с ответами, по каждому ученику — ответы, время и код программы.',
  };
  document.querySelector('.w-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-shot]');
    if (!b) return;
    document.querySelectorAll('.w-tabs button').forEach(x => x.classList.toggle('on', x === b));
    $('#shotImg').src = `promo/${b.dataset.shot}.png`;
    $('#shotImg').alt = b.textContent;
    $('#shotCap').textContent = caps[b.dataset.shot];
  });
})();
