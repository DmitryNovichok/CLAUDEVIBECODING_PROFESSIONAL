  // ------------------------------------------------------------ спокойные звуки для занятий
  // Кнопка 🎧 в левой панели: дождь, море, тихий шум или спокойная музыка — всё синтезируется в браузере (WebAudio, без файлов).
  // Выбор и громкость запоминаются; после перезагрузки звук продолжится с первым касанием страницы (раньше браузер не даст).
  // Учитель может выключить звуки своим ученикам на уроке (RULES.sounds = false, событие sound): фон и звуки кейса замолкают сразу.
  const SND_KEY = 'egeshka.snd';
  const SND_KINDS = [['rain', '🌧', 'Дождь'], ['sea', '🌊', 'Море'], ['noise', '🌫', 'Тихий шум'], ['music', '🎹', 'Спокойная музыка']];
  const SND = { kind: '', vol: 0.5, ac: null, out: null, nodes: [], timer: 0, wait: false };
  try { const v = JSON.parse(localStorage.getItem(SND_KEY) || '{}'); SND.kind = v.kind || ''; SND.vol = v.vol != null ? +v.vol : 0.5; } catch (e) { /* по умолчанию */ }
  const sndAllowed = () => RULES.sounds !== false;
  function sndSave() {
    try { localStorage.setItem(SND_KEY, JSON.stringify({ kind: SND.kind, vol: SND.vol })); } catch (e) { /* только на этот раз */ }
  }
  function sndCtx() {
    if (!SND.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      SND.ac = new AC();
    }
    if (SND.ac.state === 'suspended') SND.ac.resume();
    return SND.ac;
  }
  /** Шум на 8 секунд по кругу: белый или «коричневый» (мягче, как далёкий прибой); конец сведён с началом — без щелчка на стыке. */
  function sndNoise(ac, brown) {
    const n = ac.sampleRate * 8, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w * 0.5;
    }
    const gap = d[n - 1] - d[0];
    for (let i = 0; i < n; i++) d[i] -= gap * i / (n - 1);
    return b;
  }
  function sndStop() {
    clearTimeout(SND.timer);
    const ac = SND.ac, out = SND.out, old = SND.nodes;
    SND.out = null;
    SND.nodes = [];
    if (!ac || !out) return;
    out.gain.setTargetAtTime(0, ac.currentTime, 0.25);                // затихает, а не обрывается
    setTimeout(() => {
      old.forEach(n => { try { if (n.stop) n.stop(); } catch (e) { /* уже остановлен */ } try { n.disconnect(); } catch (e) { /* уже отключён */ } });
      out.disconnect();
    }, 1500);
  }
  function sndPlay(kind) {
    sndStop();
    if (!kind || !sndAllowed()) return;
    const ac = sndCtx();
    if (!ac) return;
    const out = ac.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(SND.vol * 0.6, ac.currentTime, 0.8);    // нарастает плавно
    out.connect(ac.destination);
    SND.out = out;
    const keep = n => { SND.nodes.push(n); return n; };
    const noise = brown => { const s = keep(ac.createBufferSource()); s.buffer = sndNoise(ac, brown); s.loop = true; s.start(); return s; };
    const filter = (type, f) => { const x = keep(ac.createBiquadFilter()); x.type = type; x.frequency.value = f; return x; };
    const gain = v => { const g = keep(ac.createGain()); g.gain.value = v; return g; };
    const lfo = (freq, depth, param) => {                              // медленное «дыхание» звука
      const o = keep(ac.createOscillator()), g = gain(depth);
      o.frequency.value = freq;
      o.connect(g);
      g.connect(param);
      o.start();
    };
    if (kind === 'rain') {
      const g = gain(0.5);
      noise(false).connect(filter('highpass', 400)).connect(filter('lowpass', 3200)).connect(g).connect(out);
      lfo(0.07, 0.12, g.gain);
      const drop = () => {                                             // отдельные капли по подоконнику
        if (SND.out !== out) return;
        const t = ac.currentTime, o = ac.createOscillator(), e = ac.createGain();
        o.frequency.setValueAtTime(1600 + Math.random() * 1800, t);
        o.frequency.exponentialRampToValueAtTime(500, t + 0.07);
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(0.025 + Math.random() * 0.03, t + 0.006);
        e.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(e);
        e.connect(out);
        o.start(t);
        o.stop(t + 0.12);
        SND.timer = setTimeout(drop, 90 + Math.random() * 450);
      };
      drop();
    } else if (kind === 'sea') {
      const lp = filter('lowpass', 650), g = gain(0.5);
      noise(true).connect(lp).connect(g).connect(out);
      lfo(0.085, 0.42, g.gain);                                        // волна накатывает и отходит (~12 с)
      lfo(0.085, 380, lp.frequency);                                   // на гребне — шумнее
    } else if (kind === 'noise') {
      noise(true).connect(filter('lowpass', 420)).connect(gain(0.7)).connect(out);
    } else if (kind === 'music') {
      // тихие ноты до-мажорной пентатоники с мягкой атакой и эхом; под ними — медленный бас
      const dl = keep(ac.createDelay(2)), fb = gain(0.35), wet = gain(0.45);
      dl.delayTime.value = 0.48;
      dl.connect(fb);
      fb.connect(dl);
      dl.connect(wet);
      wet.connect(out);
      const NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25], BASS = [130.81, 110.0, 174.61, 196.0];
      const note = (f, t, dur, vol, type) => {
        const o = ac.createOscillator(), e = ac.createGain();
        o.type = type || 'sine';
        o.frequency.value = f;
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(vol, t + 0.4);
        e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(e);
        e.connect(out);
        e.connect(dl);
        o.start(t);
        o.stop(t + dur + 0.1);
      };
      let step = 0;
      const tick = () => {
        if (SND.out !== out) return;
        const t = ac.currentTime + 0.05, pick = () => NOTES[Math.floor(Math.random() * NOTES.length)];
        if (step % 4 === 0) note(BASS[(step / 4) % 4], t, 7, 0.06, 'triangle');
        if (Math.random() < 0.85) note(pick(), t, 3.2, 0.07);
        if (Math.random() < 0.3) note(pick() / 2, t + 0.9, 3, 0.045);
        step++;
        SND.timer = setTimeout(tick, 1600 + Math.random() * 700);
      };
      tick();
    }
  }
  /** Выбрать звук ('' — тишина); играет сразу — выбор кнопкой уже разрешает браузеру звук. */
  function sndChoose(kind) {
    SND.kind = kind;
    SND.wait = false;
    sndSave();
    sndPlay(kind);
    sndRender();
  }
  function sndRender() {
    const b = $('#sndBtn');
    if (!b) return;
    const on = !!SND.kind && sndAllowed();
    b.classList.toggle('on', on);
    b.classList.toggle('off', !sndAllowed());
    b.title = sndAllowed() ? (on ? `Звуки: ${(SND_KINDS.find(k => k[0] === SND.kind) || [])[2]}` : 'Спокойные звуки для занятий') : 'Учитель выключил звуки на время урока';
    const m = $('#sndMenu');
    if (!m || m.hidden) return;
    m.innerHTML = `<div class="snd-h">🎧 Звуки для занятий</div>
      ${sndAllowed() ? `<div class="snd-list">${SND_KINDS.map(([k, i, t]) => `<button type="button" class="snd-it${SND.kind === k ? ' on' : ''}" data-snd="${k}"><span>${i}</span>${t}</button>`).join('')}
        <button type="button" class="snd-it${SND.kind ? '' : ' on'}" data-snd=""><span>🔇</span>Тишина</button></div>
      <label class="snd-vol"><span>🔈</span><input type="range" id="sndVol" min="0" max="1" step="0.05" value="${SND.vol}" aria-label="Громкость"><span>🔊</span></label>`
        : '<p class="snd-off">🔇 Учитель выключил звуки — на уроке тишина. Включит — снова можно будет слушать.</p>'}`;
  }
  function sndMenu(open) {
    const m = $('#sndMenu'), b = $('#sndBtn');
    m.hidden = !open;
    b.setAttribute('aria-expanded', String(open));
    if (!open) return;
    sndRender();
    const r = b.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;   // рядом с кнопкой, но целиком на экране
    m.style.left = Math.max(8, Math.min(r.right + 10, innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(r.bottom - h, innerHeight - h - 8)) + 'px';
  }
  /** Учитель переключил звуки (или пришли правила при входе): выключил — тишина сразу, включил — выбранный звук снова. */
  function sndRules(notify) {
    const was = !!SND.out;
    if (!sndAllowed()) {
      sndStop();
      if (notify && was) toast('🔇 Учитель выключил звуки на время урока', 4000);
    } else if (SND.kind && !SND.out && SND.ac && SND.ac.state !== 'closed') {
      sndPlay(SND.kind);
      if (notify) toast('🔊 Учитель снова включил звуки', 3000);
    }
    sndRender();
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('#sndBtn, [data-snd]');
    if (b && b.id === 'sndBtn') { sndMenu($('#sndMenu').hidden); return; }
    if (b) { sndChoose(b.dataset.snd); return; }
    if (!e.target.closest('#sndMenu') && $('#sndMenu') && !$('#sndMenu').hidden) sndMenu(false);
  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'sndVol') return;
    SND.vol = +e.target.value;
    sndSave();
    if (SND.out && SND.ac) SND.out.gain.setTargetAtTime(SND.vol * 0.6, SND.ac.currentTime, 0.1);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sndMenu') && !$('#sndMenu').hidden) sndMenu(false); });
  // звук, выбранный раньше, — с первым касанием страницы (без него браузер звук не включит)
  if (SND.kind) {
    SND.wait = true;
    const go = () => {
      ['pointerdown', 'keydown'].forEach(t => document.removeEventListener(t, go, true));
      if (SND.wait && SND.kind && sndAllowed()) { SND.wait = false; sndPlay(SND.kind); sndRender(); }
    };
    ['pointerdown', 'keydown'].forEach(t => document.addEventListener(t, go, true));
  }
  sndRender();
