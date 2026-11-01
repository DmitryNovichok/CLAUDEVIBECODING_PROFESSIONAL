  // ------------------------------------------------------------ детектор ботов (скрыто: ученику ничего не показываем)
  // Программа, которая сама управляет экраном (смотрит снимки экрана, двигает мышь и печатает), видит то же, что ученик, —
  // запретить её нельзя, но работает она иначе: курсор «прыгает» прямо на кнопку без промежуточных движений, буквы идут
  // с одинаковым до миллисекунды интервалом или ответ появляется в поле целиком, нажатия бывают созданы скриптом
  // (isTrusted = false), у браузера под автоматизацией — navigator.webdriver. По каждому заданию копим только счётчики
  // и интервалы — не что печатали — и отправляем с ответом (botPayload); решает сервер (bot_reasons), учитель видит 🦾.
  const BOT = { tasks: {}, dx: null, dy: null, since: 0, lastKey: 0 };     // dx, dy — где был прошлый клик; since — движений после него
  const botTask = () => { const id = openTaskId(); return id ? (BOT.tasks[id] = BOT.tasks[id] || { mv: 0, clk: 0, fclk: 0, tclk: 0, keys: 0, gaps: [], inst: 0, synth: 0, touch: 0, kt: 0 }) : null; };
  const botField = el => !!(el && el.closest && el.closest('#trainer .answer-row, #pyCode'));
  /** Счётчики задания id для отправки с ответом: разброс интервалов печати — в мс. */
  function botPayload(id) {
    const m = BOT.tasks[id];
    if (!m) return navigator.webdriver ? { wd: 1 } : null;
    const g = m.gaps, mean = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    const std = g.length ? Math.sqrt(g.reduce((a, b) => a + (b - mean) * (b - mean), 0) / g.length) : 0;
    return { mv: m.mv, clk: m.clk, fclk: m.fclk, tclk: m.tclk, keys: m.keys, kstd: Math.round(std * 10) / 10, inst: m.inst, synth: m.synth, touch: m.touch,
      wd: navigator.webdriver ? 1 : 0 };
  }
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const m = botTask();
    BOT.since++;
    if (m) m.mv++;
  }, { capture: true, passive: true });
  document.addEventListener('pointerdown', e => {
    const m = botTask();
    if (m && !e.isTrusted) { m.synth++; return; }
    if (e.pointerType !== 'mouse') { if (m) m.touch++; return; }
    // курсор оказался на новом месте, а движений после прошлого клика — одно-два: к кнопке не вели, он «прыгнул»
    const far = BOT.dx == null || Math.hypot(e.clientX - BOT.dx, e.clientY - BOT.dy) > 40;
    if (m) {
      m.clk++;
      if (far) m.fclk++;                                       // клик в новое место (тройной клик в одно — не в счёт)
      if (far && BOT.since <= 1) m.tclk++;
    }
    BOT.dx = e.clientX;                                          // и вне задания: следующий клик сравнивается с этим
    BOT.dy = e.clientY;
    BOT.since = 0;
  }, { capture: true, passive: true });
  document.addEventListener('keydown', e => {
    if (!botField(e.target)) return;
    const m = botTask();
    if (!m) return;
    if (!e.isTrusted) { m.synth++; return; }
    BOT.lastKey = performance.now();
    if (!e.key || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    m.keys++;
    if (m.kt && BOT.lastKey - m.kt < 600 && m.gaps.length < 60) m.gaps.push(BOT.lastKey - m.kt);   // паузы между словами — не в счёт
    m.kt = BOT.lastKey;
  }, { capture: true, passive: true });
  document.addEventListener('input', e => {
    if (!botField(e.target)) return;
    const m = botTask();
    if (!m) return;
    if (!e.isTrusted) { m.synth++; return; }
    // ответ появился целиком без нажатий (не вставка из буфера, не набор через IME) — так заполняет поле программа
    if (/^insert(Text|ReplacementText)$/.test(e.inputType || '') && (e.data || '').length >= 3 && performance.now() - BOT.lastKey > 80) m.inst++;
  }, { capture: true, passive: true });
