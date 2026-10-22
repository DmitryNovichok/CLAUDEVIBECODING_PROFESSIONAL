  // ------------------------------------------------------------ спокойные звуки для занятий
  // Кнопка 🎧 в левой панели: дождь, море, камин, лес, тихий шум, спокойная музыка или космос — всё синтезируется в браузере
  // (WebAudio, без файлов) и идёт через мягкую шину: фильтр срезает резкие верха, компрессор — пики.
  // Выбор и громкость запоминаются; после перезагрузки звук продолжится с первым касанием страницы (раньше браузер не даст).
  // Учитель может выключить звуки своим ученикам на уроке (RULES.sounds = false, событие sound): фон и звуки кейса замолкают сразу.
  const SND_KEY = 'egeshka.snd';
  const SND_KINDS = [['rain', '🌧', 'Дождь'], ['sea', '🌊', 'Море'], ['fire', '🔥', 'Камин'], ['forest', '🍃', 'Лес'],
    ['noise', '🌫', 'Тихий шум'], ['music', '🎹', 'Музыка'], ['space', '🌌', 'Космос']];
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
    const out = ac.createGain(), lp = ac.createBiquadFilter(), comp = ac.createDynamicsCompressor();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    comp.threshold.value = -26;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    out.gain.value = 0;
    out.gain.setTargetAtTime(SND.vol * 0.55, ac.currentTime, 1.2);   // нарастает плавно, секунды за три
    out.connect(lp);
    lp.connect(comp);
    comp.connect(ac.destination);
    SND.out = out;
    const keep = n => { SND.nodes.push(n); return n; };
    keep(lp);
    keep(comp);
    const bufs = SND.bufs && SND.bufs.rate === ac.sampleRate ? SND.bufs : (SND.bufs = { rate: ac.sampleRate, w: sndNoise(ac, false), b: sndNoise(ac, true) });
    const noise = brown => { const x = keep(ac.createBufferSource()); x.buffer = brown ? bufs.b : bufs.w; x.loop = true; x.start(0, Math.random() * 7); return x; };
    const filter = (type, f, q) => { const x = keep(ac.createBiquadFilter()); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; return x; };
    const gain = v => { const g = keep(ac.createGain()); g.gain.value = v; return g; };
    const lfo = (freq, depth, param) => {                              // медленное «дыхание» звука
      const o = keep(ac.createOscillator()), g = gain(depth);
      o.frequency.value = freq;
      o.connect(g);
      g.connect(param);
      o.start();
    };
    /** Короткий всплеск шума (капля, треск, шелест): полоса f, длина dur, громкость vol. */
    const burst = (f, q, dur, vol, at = 0) => {
      const t = ac.currentTime + at, x = ac.createBufferSource(), bp = ac.createBiquadFilter(), e = ac.createGain();
      x.buffer = bufs.w;
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.005, dur / 3));
      e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      x.connect(bp);
      bp.connect(e);
      e.connect(out);
      x.start(t, Math.random() * 7);
      x.stop(t + dur + 0.05);
    };
    /** Тихая нота: мягкая атака и долгое затухание (dest — куда ещё, например в эхо). */
    const note = (f, t, attack, dur, vol, type, dest) => {
      const o = ac.createOscillator(), e = ac.createGain();
      o.type = type || 'sine';
      o.frequency.value = f;
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(vol, t + attack);
      e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(e);
      e.connect(out);
      if (dest) e.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.1);
    };
    const every = (fn, min, spread) => {                               // повторять fn через случайные промежутки, пока звук этот
      const go = () => { if (SND.out !== out) return; fn(); SND.timer = setTimeout(go, min + Math.random() * spread); };
      go();
    };
    if (kind === 'rain') {
      // мягкий дождь: тёплый шум без «шипения» сверху, далёкий гул и редкие тихие капли
      const g = gain(0.4);
      noise(false).connect(filter('lowpass', 1300, 0.5)).connect(filter('highpass', 160)).connect(g).connect(out);
      noise(true).connect(filter('lowpass', 700)).connect(gain(0.3)).connect(out);
      lfo(0.06, 0.08, g.gain);
      every(() => burst(900 + Math.random() * 900, 6, 0.05, 0.03 + Math.random() * 0.04), 120, 600);
    } else if (kind === 'sea') {
      const l = filter('lowpass', 560), g = gain(0.33);
      noise(true).connect(l).connect(g).connect(out);
      lfo(0.08, 0.2, g.gain);                                          // волна накатывает и отходит (~12 с)
      lfo(0.08, 260, l.frequency);                                     // на гребне — чуть шумнее
      noise(false).connect(filter('bandpass', 900, 0.6)).connect(gain(0.027)).connect(out);   // пена у берега
    } else if (kind === 'fire') {
      // камин: тёплый гул пламени и потрескивание поленьев — то чаще, то реже
      const g = gain(0.36);
      noise(true).connect(filter('lowpass', 320)).connect(g).connect(out);
      lfo(0.13, 0.08, g.gain);
      every(() => {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) burst(1200 + Math.random() * 2200, 2.5, 0.012 + Math.random() * 0.03, 0.04 + Math.random() * 0.1, i * (0.02 + Math.random() * 0.05));
        if (Math.random() < 0.08) burst(500, 1.5, 0.08, 0.15);         // изредка — полено «щёлкнет» погромче
      }, 60, 520);
    } else if (kind === 'forest') {
      // лес: ветер в листве то сильнее, то слабее, и далёкие птицы — редко и тихо
      const bp = filter('bandpass', 520, 0.8), g = gain(0.85);
      noise(false).connect(bp).connect(g).connect(out);
      lfo(0.045, 240, bp.frequency);
      lfo(0.07, 0.28, g.gain);
      noise(false).connect(filter('highpass', 2500)).connect(filter('lowpass', 4500)).connect(gain(0.03)).connect(out);   // шелест
      every(() => {
        const t = ac.currentTime + 0.05, n = 2 + Math.floor(Math.random() * 4), base = 2300 + Math.random() * 1200, up = Math.random() < 0.5;
        for (let i = 0; i < n; i++) {
          const o = ac.createOscillator(), e = ac.createGain(), t0 = t + i * (0.11 + Math.random() * 0.05);
          o.frequency.setValueAtTime(base * (up ? 0.85 : 1.15), t0);
          o.frequency.exponentialRampToValueAtTime(base, t0 + 0.07);
          e.gain.setValueAtTime(0.0001, t0);
          e.gain.exponentialRampToValueAtTime(0.025 + Math.random() * 0.02, t0 + 0.015);
          e.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
          o.connect(e);
          e.connect(out);
          o.start(t0);
          o.stop(t0 + 0.12);
        }
      }, 3500, 7000);
    } else if (kind === 'noise') {
      noise(true).connect(filter('lowpass', 380)).connect(gain(0.35)).connect(out);
    } else if (kind === 'music') {
      // тихие ноты до-мажорной пентатоники: мягкая атака, тёплое эхо, под ними — медленный бас
      const dl = keep(ac.createDelay(2)), fb = gain(0.28), wet = gain(0.45), warm = filter('lowpass', 1800);
      dl.delayTime.value = 0.52;
      dl.connect(warm);
      warm.connect(fb);
      fb.connect(dl);
      warm.connect(wet);
      wet.connect(out);
      const NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33], BASS = [130.81, 110.0, 174.61, 196.0];
      let step = 0;
      every(() => {
        const t = ac.currentTime + 0.05, pick = () => NOTES[Math.floor(Math.random() * NOTES.length)];
        if (step % 4 === 0) note(BASS[(step / 4) % 4], t, 1.2, 8, 0.14, 'sine');
        if (Math.random() < 0.8) note(pick(), t, 0.25, 3.5, 0.15, 'sine', dl);
        if (Math.random() < 0.3) note(pick() / 2, t + 0.9, 0.3, 3.5, 0.1, 'sine', dl);
        step++;
      }, 1800, 800);
    } else if (kind === 'space') {
      // космос: медленные аккорды-пэды — каждый звук из двух чуть расстроенных тонов, вступает и тает по несколько секунд
      const CH = [[130.81, 196.0, 246.94, 329.63], [110.0, 164.81, 261.63, 329.63], [87.31, 174.61, 261.63, 329.63], [98.0, 196.0, 293.66, 392.0]];
      const pad = filter('lowpass', 1100);
      pad.connect(out);
      let step = 0;
      every(() => {
        const t = ac.currentTime + 0.05;
        CH[step % CH.length].forEach(f => [-3, 3].forEach(c => {
          const o = ac.createOscillator(), e = ac.createGain();
          o.frequency.value = f;
          o.detune.value = c;
          e.gain.setValueAtTime(0.0001, t);
          e.gain.exponentialRampToValueAtTime(0.05, t + 3.5);
          e.gain.setValueAtTime(0.05, t + 6);
          e.gain.exponentialRampToValueAtTime(0.0001, t + 11);
          o.connect(e);
          e.connect(pad);
          o.start(t);
          o.stop(t + 11.2);
        }));
        step++;
      }, 8000, 0);
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
    if (SND.out && SND.ac) SND.out.gain.setTargetAtTime(SND.vol * 0.55, SND.ac.currentTime, 0.1);
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
