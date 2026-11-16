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

  // ---- модальные окна: изолируем фон, удерживаем фокус и возвращаем его к кнопке
  let activeOverlay = null, returnFocus = null, background = [], previousOverflow = '';
  const focusable = box => [...box.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && !el.closest('[hidden]') && el.getClientRects().length);
  function closeOverlay() {
    if (!activeOverlay) return;
    const old = activeOverlay;
    activeOverlay = null;
    old.hidden = true;
    background.forEach(([el, inert]) => { el.inert = inert; });
    background = [];
    document.body.style.overflow = previousOverflow;
    if (old.id === 'signupModal') visit(false);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function showOverlay(box, first) {
    if (activeOverlay) closeOverlay();
    returnFocus = document.activeElement;
    activeOverlay = box;
    previousOverflow = document.body.style.overflow;
    box.hidden = false;
    background = [...document.body.children].filter(el => el !== box && el.tagName !== 'SCRIPT').map(el => [el, el.inert]);
    background.forEach(([el]) => { el.inert = true; });
    document.body.style.overflow = 'hidden';
    (first || focusable(box)[0] || box).focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => {
    if (!activeOverlay) return;
    if (e.key === 'Escape') { e.preventDefault(); closeOverlay(); return; }
    if (e.key !== 'Tab') return;
    const items = focusable(activeOverlay), first = items[0], last = items[items.length - 1];
    if (!first) { e.preventDefault(); activeOverlay.querySelector('[role=dialog]')?.focus(); return; }
    if (e.shiftKey && (document.activeElement === first || !activeOverlay.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !activeOverlay.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  });

  // ---- регистрация учителя
  const modal = $('#signupModal');
  const visit = on => { if (window.EgVisit) on ? EgVisit.start('teacher', 'signup') : EgVisit.stop(); };   // главный учитель видит, что кто-то регистрируется
  const open = () => { showOverlay(modal, $('#suName')); visit(true); };
  document.addEventListener('click', e => {
    if (e.target.closest('[data-signup]')) { e.preventDefault(); open(); }
    if (e.target.closest('[data-close]') || e.target === modal) closeOverlay();
  });
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

  // ---- покрытие курса: только метаданные, без закрытых уроков
  fetch('api/course/coverage', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(data => {
    if (!Array.isArray(data.topics)) return;
    const topics = data.topics.filter(t => Number.isInteger(t.n) && t.n >= 1 && t.n <= 27 && !t.archive);
    const box = $('#wNums');
    box.replaceChildren(...topics.map(t => {
      const el = document.createElement('span');
      const full = t.kind === 'lesson';
      el.textContent = t.n;
      el.className = full ? 'full lit' : '';
      el.title = `№ ${t.n}: ${full ? 'подробный урок' : 'краткий разбор'}`;
      el.setAttribute('aria-label', el.title);
      return el;
    }));
    const full = topics.filter(t => t.kind === 'lesson').length;
    $('#courseFullCount').textContent = full;
    $('#courseCountNote').textContent = `номеров с подробными уроками; ещё ${topics.length - full} — с краткими разборами`;
    $('#courseCoverageNote').textContent = `Зелёным — подробные уроки (${full}), остальные — краткие разборы (${topics.length - full}). Архивные темы не входят в 27 номеров.`;
  }).catch(() => { /* Остаётся честное описание без неподтверждённых чисел. */ });

  // ---- автономный пример: только вымышленные данные, ни одного запроса кабинета
  const demoNames = ['Александра Демо', 'Борис Демо', 'Вера Демо', 'Глеб Демо', 'Дарья Демо'];
  let demoTopic = '', demoSelected = -1;
  const demoReasons = ['Проверить крайний случай', 'Вернуться к условию', 'Объяснить способ решения', 'Повторить алгоритм', 'Закрепить на новом примере'];
  function renderDemo() {
    const box = $('#demoResult');
    if (!demoTopic) {
      box.innerHTML = '<h3>Здесь появится журнал</h3><p>Выберите тему и выдайте пример. Затем откройте результат ученика, чтобы выбрать следующий шаг.</p>';
      return;
    }
    box.innerHTML = `<h3>Демо-подборка · № ${esc(demoTopic)}</h3><p>Синтетические результаты, не реальные ответы учеников.</p>
      <div class="w-demo-table"><table><caption>Пример журнала класса</caption><thead><tr><th scope="col">Ученик</th><th scope="col">Решено</th><th scope="col">Следующий шаг</th></tr></thead><tbody>
      ${demoNames.map((name, i) => `<tr><th scope="row">${name}</th><td>${[4, 2, 5, 3, 5][i]} из 5</td><td><button type="button" class="w-link" data-demo-student="${i}" aria-label="Разобрать: ${esc(name)}" aria-expanded="${demoSelected === i}" aria-controls="demoDetail">Разобрать<span class="w-sr">: ${name}</span></button></td></tr>`).join('')}</tbody></table></div>
      <div id="demoDetail" class="w-demo-detail">${demoSelected < 0 ? 'Нажмите «Разобрать» рядом с учеником.' : `<b>${demoNames[demoSelected]} · ${demoReasons[demoSelected]}</b><p>Пример действия учителя: попросить ученика объяснить первый шаг, разобрать похожий случай вместе, затем выдать самостоятельное задание по № ${esc(demoTopic)}.</p><a class="w-link" href="#python">Инструменты для разбора →</a>`}</div>`;
  }
  $('#demoAssign').addEventListener('click', () => {
    demoTopic = $('#demoTopic').value;
    demoSelected = -1;
    renderDemo();
    $('#demoAssign').textContent = 'Выдать другой пример';
    $('#demoReset').hidden = false;
  });
  $('#demoReset').addEventListener('click', () => {
    demoTopic = ''; demoSelected = -1; renderDemo();
    $('#demoAssign').textContent = 'Выдать демо-подборку';
    $('#demoAssign').focus(); $('#demoReset').hidden = true;
  });
  $('#demoResult').addEventListener('click', e => {
    const button = e.target.closest('[data-demo-student]');
    if (!button) return;
    demoSelected = Number(button.dataset.demoStudent);
    renderDemo();
    $(`[data-demo-student="${demoSelected}"]`).focus({ preventScroll: true });
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

  // ---- снимок крупно: мышь и клавиатура используют одно доступное окно
  const zoom = $('#wZoom');
  function openZoom(img) {
    zoom.querySelector('img').src = img.currentSrc || img.src;
    zoom.querySelector('img').alt = img.alt;
    showOverlay(zoom, zoom.querySelector('button'));
  }
  document.addEventListener('click', e => {
    const img = e.target.closest('img[data-zoom]');
    if (img) { openZoom(img); return; }
    if (!zoom.hidden && (e.target === zoom || e.target.closest('#wZoom button'))) closeOverlay();
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('img[data-zoom]')) { e.preventDefault(); openZoom(e.target); }
  });
})();
