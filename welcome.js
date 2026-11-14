/* Главная страница для гостя: регистрация учителя, гостевой вход, контакты и живая страница —
   появление блоков при прокрутке, счётчики, подсказки к возможностям, наклон снимка, увеличение снимков */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Нет связи с сервером — попробуйте ещё раз');
    return d;
  };

  // ---- контакты
  fetch('api/public/offer', { cache: 'no-store' }).then(r => r.json()).then(o => {
    const c = o.contacts || {}, links = [];
    if (c.email) links.push(`<a href="mailto:${esc(c.email)}">✉️ ${esc(c.email)}</a>`);
    if (c.telegram) {
      const tg = c.telegram.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
      links.push(`<a href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">💬 Telegram @${esc(tg)}</a>`);
    }
    if (c.phone) links.push(`<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(c.phone)}</a>`);
    if (links.length) { $('#contacts-list').innerHTML = links.join(''); $('#contacts').hidden = false; }
  }).catch(() => { /* без контактов */ });

  // ---- воронка для «Статистики сайта»: какие кнопки нажимают (без личных данных; переход не ждёт ответа)
  const funnel = step => {
    const body = JSON.stringify({ step });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon('api/funnel', new Blob([body], { type: 'application/json' }))) return;
    } catch (x) { /* ниже — обычный запрос */ }
    fetch('api/funnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  document.addEventListener('click', e => {
    if (e.target.closest('[data-signup]')) funnel('teacher');
    else if (e.target.closest('a[href^="/?login"]')) funnel('student');
  }, true);

  // ---- регистрация учителя: условия пробного периода покажет панель сразу после входа
  const modal = $('#signupModal');
  const visit = on => { if (window.EgVisit) on ? EgVisit.start('teacher', 'signup') : EgVisit.stop(); };   // главный учитель видит, что кто-то регистрируется
  const open = () => { modal.hidden = false; visit(true); setTimeout(() => $('#suName').focus(), 30); };
  document.addEventListener('click', e => {
    if (e.target.closest('[data-signup]')) { e.preventDefault(); open(); }
    if (e.target.closest('[data-close]') || e.target === modal) { modal.hidden = true; visit(false); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) { modal.hidden = true; visit(false); } });
  if (location.hash === '#signup') open();
  $('#signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    $('#suErr').textContent = '';
    try {
      await post('api/teacher/signup', { name: $('#suName').value, email: $('#suEmail').value, password: $('#suPass').value, accept: $('#suAccept').checked });
      try { localStorage.setItem('egeshka.trialHello', '1'); } catch (x) { /* окно просто не покажется */ }
      visit(false);
      location.href = '/admin';
    } catch (err) { $('#suErr').textContent = err.message; btn.disabled = false; }
  });

  // ---- появление при прокрутке; у групп — по очереди
  $$('[data-stagger]').forEach(g => [...g.children].forEach((c, i) => c.style.setProperty('--i', i)));
  $$('.w-mini i').forEach((c, i) => c.style.setProperty('--i', i));
  const counted = new WeakSet();
  function countUp(el) {
    if (counted.has(el)) return;
    counted.add(el);
    const to = +el.dataset.count;
    if (calm || !to) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 1100;
    const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    el.textContent = '0';
    requestAnimationFrame(step);
  }
  function lightNums() {
    $$('#wNums span.full').forEach((s, i) => setTimeout(() => s.classList.add('lit'), calm ? 0 : 300 + i * 110));
  }
  const show = el => {
    el.classList.add('shown');
    el.querySelectorAll('[data-count]').forEach(countUp);
    if (el.contains($('#wNums'))) lightNums();
  };
  const targets = $$('[data-reveal], [data-stagger]');
  if ('IntersectionObserver' in window && !calm) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(t => io.observe(t));
  } else targets.forEach(show);

  // ---- прокрутка: полоса сверху, плотная шапка, нижняя панель на телефоне, «наверх», активный пункт меню, параллакс снимков
  const bar = $('#wProgress'), top = $('#wTop'), dock = $('#wDock'), up = $('#wUp');
  const links = $$('.w-nav a'), secs = links.map(a => $(a.getAttribute('href')));
  const para = $$('[data-parallax]');
  let ticking = false;
  function onScroll() {
    ticking = false;
    const y = window.scrollY, h = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? y / h : 0})`;
    top.classList.toggle('solid', y > 10);
    const past = y > innerHeight * 0.7;
    dock.classList.toggle('on', past && y < h - 260);
    up.classList.toggle('on', y > innerHeight * 1.5);
    let cur = -1;
    secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top < innerHeight * 0.4) cur = i; });
    links.forEach((a, i) => a.classList.toggle('on', i === cur));
    if (!calm) para.forEach(f => {
      const r = f.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const k = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
      f.style.transform = `translateY(${(k * -28).toFixed(1)}px)`;
    });
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
  up.addEventListener('click', () => window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' }));

  // ---- снимок на первом экране наклоняется за мышью
  const stage = $('#wStage'), tilt = $('#wTilt');
  if (!calm && window.matchMedia('(hover: hover)').matches) {
    stage.addEventListener('mousemove', e => {
      const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tilt.style.transform = `rotate(-3deg) rotateY(${(x * 10).toFixed(2)}deg) rotateX(${(-y * 8).toFixed(2)}deg) translateZ(20px)`;
    });
    stage.addEventListener('mouseleave', () => { tilt.style.transform = ''; });
    $$('[data-tilt]').forEach(c => {
      c.addEventListener('mousemove', e => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        c.style.transform = `rotateY(${(x * 14).toFixed(1)}deg) rotateX(${(-y * 14).toFixed(1)}deg) translateY(-4px)`;
      });
      c.addEventListener('mouseleave', () => { c.style.transform = ''; });
    });
  }

  // ---- подробность к пункту «Что есть на сайте»: наведение на компьютере, нажатие на телефоне
  const pop = $('#wPop');
  let popFor = null;
  let showPop = function (el) {
    popFor = el;
    $$('.w-ft.on').forEach(x => x.classList.toggle('on', x === el));
    el.classList.add('on');
    pop.textContent = el.dataset.more;
    pop.hidden = false;
    const r = el.getBoundingClientRect(), pw = Math.min(300, innerWidth - 32);
    pop.style.maxWidth = pw + 'px';
    const ph = pop.offsetHeight, left = Math.max(16, Math.min(innerWidth - pop.offsetWidth - 16, r.left + r.width / 2 - pop.offsetWidth / 2));
    const below = r.top - ph - 12 < 70;
    pop.classList.toggle('below', below);
    pop.style.left = left + 'px';
    pop.style.top = (below ? r.bottom + 12 : r.top - ph - 12) + 'px';
    pop.style.setProperty('--ax', (r.left + r.width / 2 - left) + 'px');
    requestAnimationFrame(() => pop.classList.add('on'));
  };
  function hidePop() { popFor?.classList.remove('on'); popFor = null; pop.classList.remove('on'); pop.hidden = true; }
  if (!window.matchMedia('(hover: hover)').matches) $('.w-feat-h p').textContent = 'Нажмите на пункт — появится подробность.';
  $$('.w-ft').forEach(el => {
    el.addEventListener('mouseenter', () => { if (window.matchMedia('(hover: hover)').matches) showPop(el); });
    el.addEventListener('mouseleave', () => { if (window.matchMedia('(hover: hover)').matches) hidePop(); });
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) showPop(el); });   // с клавиатуры; касание обрабатывает click
    el.addEventListener('blur', hidePop);
    el.addEventListener('click', () => { if (popFor === el && !window.matchMedia('(hover: hover)').matches) hidePop(); else showPop(el); });
  });
  let popY = 0;
  const _show = showPop;
  showPop = el => { popY = window.scrollY; _show(el); };
  window.addEventListener('scroll', () => { if (popFor && Math.abs(window.scrollY - popY) > 60) hidePop(); }, { passive: true });   // подсказка уходит, когда страницу заметно прокрутили

  // ---- снимок крупно
  const zoom = $('#wZoom');
  document.addEventListener('click', e => {
    const img = e.target.closest('img[data-zoom]');
    if (img) { zoom.querySelector('img').src = img.currentSrc || img.src; zoom.querySelector('img').alt = img.alt; zoom.hidden = false; return; }
    if (!zoom.hidden && e.target.closest('#wZoom')) zoom.hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    modal.hidden = true; zoom.hidden = true; hidePop();
  });
})();
