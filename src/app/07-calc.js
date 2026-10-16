  // ------------------------------------------------------------ калькулятор
  // Плавающее окно поверх задания: как калькулятор на телефоне — операции по очереди, «=», %, ±, ⌫.
  // Окно перетаскивается за верхнюю полосу (место запоминается), работает с клавиатуры.
  const CALC_BTN = '<button type="button" class="icon-btn calc-btn" id="calcBtn" title="Калькулятор">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="4" rx="1"/><path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/></svg><span>Калькулятор</span></button>';
  const CALC_POS = 'egeTrainer.calcPos';
  const CALC = { cur: '0', acc: null, op: null, fresh: true, expr: '' };
  const CALC_KEYS = [['back', '⌫', 'fn'], ['ac', 'AC', 'fn'], ['%', '%', 'fn'], ['/', '÷', 'op'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×', 'op'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', 'op'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op'],
    ['neg', '⁺∕₋', 'fn2'], ['0', '0'], ['.', ',', 'num calc-dec'], ['=', '=', 'eq']];
  const OP_SIGN = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  /** Число для экрана: до 12 значащих цифр, запятая, пробелы между тысячами. */
  function calcFmt(x) {
    if (typeof x === 'string') {
      const [i, f] = x.split('.');
      return (i.startsWith('-') ? '−' : '') + i.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') + (f !== undefined ? ',' + f : '');
    }
    if (!isFinite(x)) return 'Ошибка';
    let s = Math.abs(x) >= 1e15 || (x !== 0 && Math.abs(x) < 1e-9) ? x.toExponential(8).replace(/\.?0+e/, 'e') : String(+x.toPrecision(12));
    if (s.includes('e')) return s.replace('.', ',').replace('-', '−');
    return calcFmt(s);
  }
  const calcNum = () => parseFloat(CALC.cur) || 0;
  function calcApply(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return b === 0 ? NaN : a / b;
    return b;
  }
  function calcPress(k) {
    const C = CALC;
    if (C.cur === 'err' && k !== 'ac') calcPress('ac');
    if (/^[0-9]$/.test(k)) {
      if (C.fresh) { C.cur = k; C.fresh = false; }
      else if (C.cur.replace(/[-.]/g, '').length < 15) C.cur = C.cur === '0' ? k : C.cur === '-0' ? '-' + k : C.cur + k;
    } else if (k === '.') {
      if (C.fresh) { C.cur = '0.'; C.fresh = false; } else if (!C.cur.includes('.')) C.cur += '.';
    } else if (k === 'back') {
      if (!C.fresh) { C.cur = C.cur.slice(0, -1); if (C.cur === '' || C.cur === '-') { C.cur = '0'; C.fresh = true; } }
    } else if (k === 'ac') {
      Object.assign(C, { cur: '0', acc: null, op: null, fresh: true, expr: '' });
    } else if (k === 'neg') {
      C.cur = C.cur.startsWith('-') ? C.cur.slice(1) : C.cur === '0' ? '0' : '-' + C.cur;
    } else if (k === '%') {
      // как на телефоне: 200 + 10% → 200 + 20; одно число — делится на 100
      const v = C.op === '+' || C.op === '-' ? (C.acc || 0) * calcNum() / 100 : calcNum() / 100;
      C.cur = String(+v.toPrecision(12)); C.fresh = true;
    } else if (OP_SIGN[k]) {
      if (C.op && !C.fresh) C.acc = calcApply(C.acc, C.op, calcNum());
      else if (C.acc === null || !C.op) C.acc = calcNum();
      C.op = k; C.fresh = true;
      if (!isFinite(C.acc)) { C.cur = 'err'; C.acc = null; C.op = null; }
      else { C.cur = String(+C.acc.toPrecision(12)); C.expr = calcFmt(C.acc) + ' ' + OP_SIGN[k]; }
    } else if (k === '=') {
      if (C.op) {
        const b = calcNum(), r = calcApply(C.acc, C.op, b);
        C.expr = `${calcFmt(C.acc)} ${OP_SIGN[C.op]} ${calcFmt(b)} =`;
        C.acc = null; C.op = null; C.fresh = true;
        C.cur = isFinite(r) ? String(+r.toPrecision(12)) : 'err';
      }
    }
    calcRender(k);
  }
  function calcRender(k) {
    const box = $('#calcBox');
    if (!box) return;
    const shown = CALC.cur === 'err' ? 'Ошибка' : calcFmt(CALC.fresh ? +CALC.cur : CALC.cur);
    const out = box.querySelector('.calc-out');
    out.textContent = shown;
    out.style.fontSize = shown.length > 14 ? '26px' : shown.length > 10 ? '34px' : '';
    box.querySelector('.calc-expr').textContent = CALC.expr;
    box.querySelectorAll('[data-ck]').forEach(b => b.classList.toggle('on', b.dataset.ck === CALC.op && CALC.fresh));
    if (k) { const b = box.querySelector(`[data-ck="${CSS.escape(k)}"]`); if (b) { b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 120); } }
  }
  function toggleCalc(force) {
    let box = $('#calcBox');
    const open = force != null ? force : !box || box.hidden;
    if (!box) {
      box = document.createElement('div');
      box.id = 'calcBox';
      box.className = 'calc';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Калькулятор');
      box.innerHTML = `<div class="calc-bar" title="Перетащите, чтобы передвинуть"><span class="calc-dots"><button type="button" class="calc-x" aria-label="Закрыть калькулятор"></button><i></i><i></i></span>
          <b>Калькулятор</b></div>
        <div class="calc-screen" title="Нажмите, чтобы скопировать"><div class="calc-expr"></div><div class="calc-out">0</div></div>
        <div class="calc-keys">${CALC_KEYS.map(([k, t, c]) => `<button type="button" class="calc-k ${c || 'num'}" data-ck="${k}">${t}</button>`).join('')}</div>`;
      document.body.appendChild(box);
      try {
        const p = JSON.parse(localStorage.getItem(CALC_POS) || 'null');
        if (p) { box.style.left = Math.min(p.x, innerWidth - 260) + 'px'; box.style.top = Math.min(p.y, innerHeight - 200) + 'px'; box.style.right = 'auto'; }
      } catch (e) { /* по умолчанию — справа сверху */ }
      box.addEventListener('click', e => {
        if (e.target.closest('.calc-x')) return toggleCalc(false);
        const b = e.target.closest('[data-ck]');
        if (b) return calcPress(b.dataset.ck);
        if (e.target.closest('.calc-screen') && CALC.cur !== 'err') {
          navigator.clipboard?.writeText(String(calcNum()).replace('.', ',')).then(() => toast('Скопировано: ' + calcFmt(calcNum()), 1500), () => {});
        }
      });
      // перетаскивание за верхнюю полосу
      box.querySelector('.calc-bar').addEventListener('pointerdown', e => {
        if (e.target.closest('.calc-x')) return;
        const r = box.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
        const move = ev => {
          const x = Math.max(0, Math.min(innerWidth - r.width, ev.clientX - dx)), y = Math.max(0, Math.min(innerHeight - 60, ev.clientY - dy));
          Object.assign(box.style, { left: x + 'px', top: y + 'px', right: 'auto' });
        };
        const up = () => {
          removeEventListener('pointermove', move); removeEventListener('pointerup', up);
          try { localStorage.setItem(CALC_POS, JSON.stringify({ x: parseInt(box.style.left) || 0, y: parseInt(box.style.top) || 0 })); } catch (e) { /* нет места */ }
        };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
        e.preventDefault();
      });
    }
    box.hidden = !open;
    $$('#calcBtn').forEach(b => b.classList.toggle('on', open));
    if (open) calcRender();
  }
  document.addEventListener('keydown', e => {
    const box = $('#calcBox');
    if (!box || box.hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;   // печатают в поле — не перехватываем
    const map = { Enter: '=', '=': '=', Backspace: 'back', Escape: 'ac', Delete: 'ac', ',': '.', '.': '.', '%': '%',
      '+': '+', '-': '-', '*': '*', '/': '/', 'x': '*', 'х': '*', ':': '/' };
    const k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault();
    calcPress(k);
  });

