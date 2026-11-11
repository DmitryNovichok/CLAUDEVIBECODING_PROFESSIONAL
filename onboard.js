/* Знакомство с сайтом — общее для страницы ученика (index.html) и панели учителя (admin.html).
   EgOnboard.slides(list, opts) — несколько ярких шагов со снимками экрана: «Назад / Далее», точки, стрелки, свайп, Esc.
   EgOnboard.coach(steps, opts) — краткое обучение на месте: затемнение, «окошко» вокруг настоящего элемента и подсказка рядом. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let active = null;                         // одно окно знакомства за раз
  const closeActive = () => { if (active) active(); };

  /** Слайды. list: [{ color: 'g'|'b'|'v'|'o'|'r'|'n', kicker, title, html, img, imgAlt, emoji: [[иконка, подпись]] }].
      opts: { buttons: [{ label, primary, onClick }] — на последнем шаге, onClose(кнопка или null), label } */
  function slides(list, opts = {}) {
    closeActive();
    let i = 0, startX = null;
    const ov = document.createElement('div');
    ov.className = 'ob-ov';
    ov.innerHTML = `<div class="ob-card" role="dialog" aria-modal="true" aria-label="${esc(opts.label || 'Знакомство с сайтом')}">
      <button type="button" class="ob-x" aria-label="Закрыть">×</button>
      <div class="ob-track"></div>
      <div class="ob-nav"><button type="button" class="ob-back">← Назад</button><div class="ob-dots"></div><div class="ob-act"></div></div></div>`;
    document.body.appendChild(ov);
    document.body.classList.add('ob-lock');
    const track = ov.querySelector('.ob-track');
    track.innerHTML = list.map((s, k) => `<section class="ob-slide c-${s.color || 'g'}" data-k="${k}" aria-hidden="true">
      <div class="ob-vis">${s.img ? `<figure class="ob-shot"><img src="${esc(s.img)}" alt="${esc(s.imgAlt || '')}" loading="${k ? 'lazy' : 'eager'}"></figure>`
        : `<div class="ob-emo">${(s.emoji || []).map(([e, t], j) => `<div style="--j:${j}"><span>${e}</span><b>${esc(t)}</b></div>`).join('')}</div>`}</div>
      <div class="ob-txt"><span class="ob-kick">${esc(s.kicker || `Шаг ${k + 1} из ${list.length}`)}</span><h2>${s.title}</h2>${s.html}</div></section>`).join('');
    ov.querySelector('.ob-dots').innerHTML = list.map((_, k) => `<button type="button" aria-label="Шаг ${k + 1}" data-go="${k}"></button>`).join('');
    const show = n => {
      i = Math.max(0, Math.min(list.length - 1, n));
      ov.querySelectorAll('.ob-slide').forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); el.setAttribute('aria-hidden', String(k !== i)); });
      ov.querySelectorAll('.ob-dots button').forEach((d, k) => d.classList.toggle('on', k === i));
      ov.querySelector('.ob-back').style.visibility = i ? 'visible' : 'hidden';
      const last = i === list.length - 1;
      ov.querySelector('.ob-act').innerHTML = last
        ? (opts.buttons || [{ label: 'Начать', primary: true }]).map((b, k) => `<button type="button" class="ob-btn${b.primary ? ' primary' : ''}" data-fin="${k}">${esc(b.label)}</button>`).join('')
        : `<button type="button" class="ob-skip">Пропустить</button><button type="button" class="ob-btn primary ob-next">Далее →</button>`;
      const f = ov.querySelector('.ob-act .primary'); if (f) f.focus({ preventScroll: true });
    };
    const close = btn => {
      if (active !== close) return;
      active = null;
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('ob-lock');
      ov.classList.add('out');
      setTimeout(() => ov.remove(), calm() ? 0 : 260);
      if (opts.onClose) opts.onClose(btn || null);                 // какой кнопкой закрыли (или null — крестиком, Esc)
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
    };
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('.ob-x') || e.target.closest('.ob-skip')) { close(); return; }
      if (e.target.closest('.ob-next')) { show(i + 1); return; }
      if (e.target.closest('.ob-back')) { show(i - 1); return; }
      const d = e.target.closest('[data-go]'); if (d) { show(+d.dataset.go); return; }
      const f = e.target.closest('[data-fin]');
      if (f) { const b = (opts.buttons || [])[+f.dataset.fin]; close(b); if (b && b.onClick) setTimeout(b.onClick, calm() ? 0 : 280); }
    });
    track.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend', e => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX; startX = null;
      if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    });
    document.addEventListener('keydown', onKey, true);
    active = close;
    show(0);
    requestAnimationFrame(() => ov.classList.add('in'));
    return close;
  }

  /** Обучение на месте. steps: [{ sel, title, text }] — шаги без видимого элемента пропускаются. opts: { onClose } */
  function coach(steps, opts = {}) {
    closeActive();
    const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    const list = steps.map(s => ({ ...s, el: document.querySelector(s.sel) })).filter(s => visible(s.el));
    if (!list.length) { if (opts.onClose) opts.onClose(); return () => {}; }
    let i = 0;
    const ov = document.createElement('div');
    ov.className = 'ob-coach';
    ov.innerHTML = '<div class="ob-hole"></div><div class="ob-tip" role="dialog" aria-live="polite"></div>';
    document.body.appendChild(ov);
    const hole = ov.querySelector('.ob-hole'), tip = ov.querySelector('.ob-tip');
    const place = () => {
      const s = list[i]; if (!s) return;
      const r = s.el.getBoundingClientRect(), pad = 8, vw = innerWidth, vh = innerHeight;
      hole.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
      const tw = Math.min(340, vw - 24); tip.style.width = tw + 'px';
      const th = tip.offsetHeight;
      let top = r.bottom + pad + 14, below = true;
      if (top + th > vh - 10) { top = r.top - pad - 14 - th; below = false; }
      if (top < 10) { top = Math.min(vh - th - 10, Math.max(10, r.top + r.height / 2 - th / 2)); }
      let left = Math.max(12, Math.min(vw - tw - 12, r.left + r.width / 2 - tw / 2));
      // широкий элемент у левого края (меню панели) — подсказка справа от него
      if (r.width < vw * 0.35 && r.left < vw * 0.2 && r.right + tw + 30 < vw) { left = r.right + pad + 16; top = Math.max(10, Math.min(vh - th - 10, r.top - 6)); below = null; }
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      tip.classList.toggle('below', below === true); tip.classList.toggle('side', below === null);
      tip.style.setProperty('--ax', Math.max(18, Math.min(tw - 18, r.left + r.width / 2 - left)) + 'px');
    };
    const show = n => {
      i = n;
      const s = list[i], last = i === list.length - 1;
      s.el.scrollIntoView({ block: 'center', inline: 'center', behavior: calm() ? 'auto' : 'smooth' });
      tip.innerHTML = `<span class="ob-step">${i + 1} из ${list.length}</span><b>${esc(s.title)}</b><p>${s.text}</p>
        <div class="ob-tip-act"><button type="button" class="ob-skip">${last ? '' : 'Пропустить'}</button>
        <span>${i ? '<button type="button" class="ob-btn ob-prev">←</button>' : ''}<button type="button" class="ob-btn primary ob-next">${last ? 'Готово' : 'Далее →'}</button></span></div>`;
      tip.classList.remove('pop'); void tip.offsetWidth; tip.classList.add('pop');
      place(); setTimeout(place, calm() ? 0 : 380);       // после плавной прокрутки — ещё раз точно
      tip.querySelector('.ob-next').focus({ preventScroll: true });
    };
    const close = () => {
      if (active !== close) return;
      active = null;
      document.removeEventListener('keydown', onKey, true);
      removeEventListener('resize', place); removeEventListener('scroll', place, true);
      ov.classList.add('out');
      setTimeout(() => ov.remove(), calm() ? 0 : 220);
      if (opts.onClose) opts.onClose();
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); i < list.length - 1 ? show(i + 1) : close(); }
      else if (e.key === 'ArrowLeft' && i) { e.preventDefault(); show(i - 1); }
    };
    ov.addEventListener('click', e => {
      if (e.target.closest('.ob-skip')) { close(); return; }
      if (e.target.closest('.ob-next')) { i < list.length - 1 ? show(i + 1) : close(); return; }
      if (e.target.closest('.ob-prev')) show(i - 1);
    });
    addEventListener('resize', place); addEventListener('scroll', place, true);
    document.addEventListener('keydown', onKey, true);
    active = close;
    show(0);
    requestAnimationFrame(() => ov.classList.add('in'));
    return close;
  }

  window.EgOnboard = { slides, coach, close: closeActive };
})();
