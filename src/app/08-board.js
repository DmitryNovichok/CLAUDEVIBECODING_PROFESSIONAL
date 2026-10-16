  // ------------------------------------------------------------ доска для решения
  // Панель справа от задания (вместо окна Python): ручка, прямая, текст, ластик. Штрихи хранятся в пикселях листа,
  // у каждого задания своя доска (в браузере ученика, последние BD_KEEP). Цвет «ink» — цвет текста темы.
  const BD_BTN = '<button type="button" class="icon-btn bd-btn" id="bdBtn" title="Доска — решать от руки рядом с задачей">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M7 13l3-3 2 2 4-4"/></svg><span>Доска</span></button>';
  const BD_KEEP = 40, BD_INDEX = 'egeTrainer.boards', bdKey = id => 'egeTrainer.board.' + id;
  const BD_BGS = ['grid', 'lines', 'plain'];
  const BD_FS = [16, 20, 26, 34, 44, 60];
  const BD = { task: null, strokes: [], undo: [], redo: [], tool: 'pen', color: 'ink', size: 2, fs: 20, bg: 'grid', drawing: null, text: null, ro: null, saveT: 0, minH: 0 };
  const bdOpen = () => !$('#bdDock').hidden;
  try { const v = readJSON('egeTrainer.boardPrefs'); if (v) Object.assign(BD, { bg: BD_BGS.includes(v.bg) ? v.bg : 'grid', size: v.size === 5 ? 5 : 2, fs: BD_FS.includes(v.fs) ? v.fs : 20 }); } catch (e) {}
  const bdPrefs = () => writeJSON('egeTrainer.boardPrefs', { bg: BD.bg, size: BD.size, fs: BD.fs });
  // размер текста: у старых надписей его нет — тогда по толщине, как раньше
  const bdFs = st => st.fs || (st.w > 3 ? 22 : 17);
  const bdFont = fs => `${fs}px ${getComputedStyle(document.body).fontFamily}`;

  function bdLoad(id) {
    const d = readJSON(bdKey(id));
    BD.strokes = d && Array.isArray(d.s) ? d.s : [];
    BD.minH = d && d.h > 0 ? d.h : 0;
    BD.undo = [];
    BD.redo = [];
  }
  function bdSave() {
    clearTimeout(BD.saveT);
    BD.saveT = 0;
    if (!BD.task) return;
    const id = BD.task.id;
    let idx = (readJSON(BD_INDEX) || []).filter(x => x !== id);
    if (BD.strokes.length) {
      idx.push(id);
      while (idx.length > BD_KEEP) { const old = idx.shift(); try { storage && storage.removeItem(bdKey(old)); } catch (e) {} }
      // с картинками доска весит больше: не помещается в память браузера — освобождаем место от самых старых досок
      const raw = JSON.stringify({ s: BD.strokes, t: Date.now(), h: BD.minH || undefined });
      for (;;) {
        try { storage && storage.setItem(bdKey(id), raw); break; } catch (e) {
          if (idx.length <= 1) { if (!BD.full) { BD.full = true; toast('Доска слишком большая, чтобы сохранить её в браузере: удалите часть картинок', 5000); } break; }
          try { storage.removeItem(bdKey(idx.shift())); } catch (x) { break; }
        }
      }
    } else {
      try { storage && storage.removeItem(bdKey(id)); } catch (e) {}
    }
    writeJSON(BD_INDEX, idx);
  }
  const bdSaveSoon = () => { clearTimeout(BD.saveT); BD.saveT = setTimeout(bdSave, 400); };
  const bdInk = c => (c === 'ink' ? getComputedStyle(document.body).getPropertyValue('--text').trim() || '#888' : c);

  function bdSize() {
    const cv = $('#bdCanvas'), sh = $('#bdSheet');
    // целые пиксели и на 1px меньше листа: иначе дробная ширина даёт полосы прокрутки, они сужают лист — и так по кругу
    const w = Math.max(50, sh.clientWidth - 1);
    let maxY = 0;
    for (const st of BD.strokes) {
      if (st.k === 'img') maxY = Math.max(maxY, st.y + st.ih);
      else if (st.k === 'text') maxY = Math.max(maxY, st.y + String(st.t).split('\n').length * bdFs(st) * 1.24 + 10);
      else for (let i = 1; i < st.p.length; i += 2) if (st.p[i] > maxY) maxY = st.p[i];
    }
    const h = Math.max(sh.clientHeight - 1, maxY + 320, BD.minH);   // лист растёт вниз, пока решаешь; ⇣ — удлинить заранее
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
    }
    return dpr;
  }
  // картинки на доске: хранятся как data:-адрес (не зависят от сервера), рисуются под штрихами, нарисованными позже
  const BD_IMGS = new Map();
  function bdImg(src) {
    let im = BD_IMGS.get(src);
    if (!im) {
      im = new Image();
      im.onload = () => bdRedraw();
      im.src = src;
      BD_IMGS.set(src, im);
      if (BD_IMGS.size > 60) BD_IMGS.delete(BD_IMGS.keys().next().value);
    }
    return im;
  }
  function bdDrawStroke(g, st) {
    if (st.k === 'img') {
      const im = bdImg(st.src);
      g.fillStyle = '#fff';                             // картинки заданий — на белом, как в условии
      g.fillRect(st.x, st.y, st.iw, st.ih);
      if (im.complete && im.naturalWidth) g.drawImage(im, st.x, st.y, st.iw, st.ih);
      return;
    }
    g.strokeStyle = g.fillStyle = bdInk(st.c);
    if (st.k === 'text') {
      const fs = bdFs(st);
      g.font = bdFont(fs);
      g.textBaseline = 'top';
      String(st.t).split('\n').forEach((ln, i) => g.fillText(ln, st.x, st.y + i * fs * 1.24));
      return;
    }
    const p = st.p;
    g.lineWidth = st.w;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    if (p.length === 2) { g.lineTo(p[0] + 0.1, p[1]); }
    else if (st.k === 'line' || p.length === 4) { g.lineTo(p[p.length - 2], p[p.length - 1]); }
    else {
      for (let i = 2; i < p.length - 2; i += 2) {        // сглаживание: кривые через середины отрезков
        const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
        g.quadraticCurveTo(p[i], p[i + 1], mx, my);
      }
      g.lineTo(p[p.length - 2], p[p.length - 1]);
    }
    g.stroke();
  }
  function bdRedraw() {
    if (!bdOpen()) return;
    const cv = $('#bdCanvas'), dpr = bdSize(), g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const st of BD.strokes) bdDrawStroke(g, st);
    if (BD.drawing && BD.drawing.p) bdDrawStroke(g, BD.drawing);
    cv.dataset.bg = BD.bg;
    cv.dataset.tool = BD.tool;
    $('#bdUndo').disabled = !BD.undo.length;
    $('#bdRedo').disabled = !BD.redo.length;
  }
  function bdPos(e) {
    const r = $('#bdCanvas').getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  }
  function bdEraseAt(x, y) {
    const R = 10;
    const hit = st => {
      if (st.k === 'img') return x >= st.x && x <= st.x + st.iw && y >= st.y && y <= st.y + st.ih;
      if (st.k === 'text') {
        const fs = bdFs(st), lines = String(st.t).split('\n'), lh = fs * 1.24;
        const g = $('#bdCanvas').getContext('2d');
        g.font = bdFont(fs);
        const w = Math.max(...lines.map(l => g.measureText(l).width));
        return x >= st.x - R && x <= st.x + w + R && y >= st.y - R && y <= st.y + lines.length * lh + R;
      }
      const p = st.p;
      for (let i = 0; i < p.length; i += 2) {
        const ax = p[i], ay = p[i + 1], bx = p[i + 2] != null ? p[i + 2] : ax, by = p[i + 3] != null ? p[i + 3] : ay;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        const ex = ax + t * dx - x, ey = ay + t * dy - y;
        if (ex * ex + ey * ey <= (R + st.w / 2) ** 2) return true;
      }
      return false;
    };
    const keep = BD.strokes.filter(st => !hit(st));
    if (keep.length !== BD.strokes.length) {
      bdDo({ del: BD.strokes.filter(st => !keep.includes(st)) });
      BD.strokes = keep;
      bdRedraw();
      bdSaveSoon();
    }
  }
  function bdTextCommit() {
    const ta = BD.text;
    if (!ta) return;
    BD.text = null;
    const t = ta.value.replace(/\s+$/, '');
    if (t) { const st = { k: 'text', c: BD.color, w: BD.size, fs: +ta.dataset.fs || BD.fs, x: +ta.dataset.x, y: +ta.dataset.y, t: bdWrap(t.slice(0, 2000), +ta.dataset.fs || BD.fs, +ta.dataset.w || 1e9) }; BD.strokes.push(st); bdDo({ add: [st] }); bdSaveSoon(); }
    ta.remove();
    bdRedraw();
  }
  /** Переносим длинные строки по ширине доски — как они переносились в поле ввода. */
  function bdWrap(text, fs, maxW) {
    const g = $('#bdCanvas').getContext('2d');
    g.font = bdFont(fs);
    return text.split('\n').map(line => {
      const out = [];
      let cur = '';
      for (const word of line.split(/(\s+)/)) {
        if (cur && g.measureText(cur + word).width > maxW) { out.push(cur.trimEnd()); cur = word.trimStart(); }
        else cur += word;
        while (cur.length > 1 && g.measureText(cur).width > maxW) {          // слово длиннее строки — режем по буквам
          let k = cur.length - 1;
          while (k > 1 && g.measureText(cur.slice(0, k)).width > maxW) k--;
          out.push(cur.slice(0, k)); cur = cur.slice(k);
        }
      }
      out.push(cur);
      return out.join('\n');
    }).join('\n');
  }
  function bdTextAt(x, y) {
    bdTextCommit();
    const ta = document.createElement('textarea');
    ta.className = 'bd-text';
    // поле не шире свободного места до правого края: иначе лист уезжает вбок и справа остаются «следы» рисования
    const avail = Math.max(40, $('#bdSheet').clientWidth - x - 10);
    ta.style.width = avail + 'px';
    ta.style.minWidth = '0';
    ta.dataset.w = avail - 6;
    ta.dataset.x = x; ta.dataset.y = y;
    ta.style.left = x + 'px'; ta.style.top = y + 'px';
    ta.style.color = bdInk(BD.color);
    ta.dataset.fs = BD.fs;
    ta.style.fontSize = BD.fs + 'px';
    ta.rows = 1;
    ta.placeholder = 'текст…';
    ta.addEventListener('blur', bdTextCommit);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
      e.stopPropagation();
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    $('#bdSheet').appendChild(ta);
    BD.text = ta;
    ta.focus({ preventScroll: true });
  }
  $('#bdCanvas').addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    const [x, y] = bdPos(e);
    if (BD.tool === 'text') { bdTextAt(x, y); return; }
    bdTextCommit();
    $('#bdCanvas').setPointerCapture(e.pointerId);
    if (BD.tool === 'eraser') { BD.drawing = { erasing: true }; bdEraseAt(x, y); return; }
    BD.drawing = { k: BD.tool === 'line' ? 'line' : 'pen', c: BD.color, w: BD.size, p: [x, y] };
    bdRedraw();
  });
  $('#bdCanvas').addEventListener('pointermove', e => {
    const d = BD.drawing;
    if (!d) return;
    const [x, y] = bdPos(e);
    if (d.erasing) { bdEraseAt(x, y); return; }
    if (d.k === 'line') { d.p = [d.p[0], d.p[1], x, y]; }
    else {
      const lx = d.p[d.p.length - 2], ly = d.p[d.p.length - 1];
      if ((x - lx) ** 2 + (y - ly) ** 2 < 2.5) return;
      d.p.push(x, y);
    }
    bdRedraw();
  });
  const bdUp = () => {
    const d = BD.drawing;
    BD.drawing = null;
    if (!d || d.erasing) return;
    if (d.p.length > 200000) return;
    BD.strokes.push(d);
    bdDo({ add: [d] });
    bdRedraw();
    bdSaveSoon();
  };
  $('#bdCanvas').addEventListener('pointerup', bdUp);
  $('#bdCanvas').addEventListener('pointercancel', bdUp);

  // история: {add: [штрихи]} — нарисовал, {del: [штрихи]} — стёр ластиком или очистил
  function bdDo(act) {
    BD.undo.push(act);
    if (BD.undo.length > 200) BD.undo.shift();
    BD.redo = [];
  }
  function bdApply(act, back) {
    const add = back ? act.del : act.add, del = back ? act.add : act.del;
    if (del) BD.strokes = BD.strokes.filter(st => !del.includes(st));
    if (add) BD.strokes.push(...add);
    bdRedraw(); bdSaveSoon();
  }
  function bdUndo() {
    bdTextCommit();
    const act = BD.undo.pop();
    if (!act) return;
    BD.redo.push(act);
    bdApply(act, true);
  }
  function bdRedoAct() {
    const act = BD.redo.pop();
    if (!act) return;
    BD.undo.push(act);
    bdApply(act, false);
  }
  /** Размер текста: шаг вверх/вниз. Меняет и надпись, которую сейчас печатают. */
  function bdSetFs(dir) {
    const i = BD_FS.indexOf(BD.fs);
    BD.fs = BD_FS[Math.max(0, Math.min(BD_FS.length - 1, (i < 0 ? 1 : i) + dir))];
    bdPrefs();
    bdFsLabel();
    if (BD.text) {
      BD.text.dataset.fs = BD.fs;
      BD.text.style.fontSize = BD.fs + 'px';
      BD.text.dispatchEvent(new Event('input'));
      BD.text.focus();
    } else if (BD.tool !== 'text') bdSetTool('text');
  }
  function bdFsLabel() {
    const l = $('#bdFsVal');
    if (l) l.textContent = BD.fs;
    const i = BD_FS.indexOf(BD.fs);
    const dn = $('#bdDock [data-bd-fs="-1"]'), up = $('#bdDock [data-bd-fs="1"]');
    if (dn) dn.disabled = i <= 0;
    if (up) up.disabled = i >= BD_FS.length - 1;
  }
  function bdSetTool(t) {
    bdTextCommit();
    BD.tool = t;
    $$('#bdDock [data-bd-tool]').forEach(b => { const on = b.dataset.bdTool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('#bdCanvas').dataset.tool = t;
  }
  $('#bdDock').addEventListener('click', e => {
    const tl = e.target.closest('[data-bd-tool]');
    if (tl) { bdSetTool(tl.dataset.bdTool); return; }
    const c = e.target.closest('[data-bd-color]');
    if (c) {
      BD.color = c.dataset.bdColor;
      $$('#bdDock [data-bd-color]').forEach(b => b.classList.toggle('on', b === c));
      if (BD.tool === 'eraser') bdSetTool('pen');
      return;
    }
    const fz = e.target.closest('[data-bd-fs]');
    if (fz) { bdSetFs(+fz.dataset.bdFs); return; }
    const sz = e.target.closest('[data-bd-size]');
    if (sz) {
      BD.size = +sz.dataset.bdSize;
      $$('#bdDock [data-bd-size]').forEach(b => b.classList.toggle('on', b === sz));
      bdPrefs();
      return;
    }
    const id = e.target.closest('button') && e.target.closest('button').id;
    if (id === 'bdUndo') bdUndo();
    else if (id === 'bdRedo') bdRedoAct();
    else if (id === 'bdClose') toggleBoard(false);
    else if (id === 'bdToPy') { toggleBoard(false); togglePy(true); }
    else if (id === 'bdWide') {
      $('#bdDock').style.removeProperty('flex-basis');
      try { localStorage.removeItem(DOCK_W.bdDock); } catch (x) {}
      const on = document.body.classList.toggle('bd-wide');
      $('#bdWide').setAttribute('aria-pressed', String(on));
      setTimeout(bdRedraw, 30);
    } else if (id === 'bdImg') {
      const imgs = $$('#cond img').filter(i => i.complete && i.naturalWidth);
      if (!imgs.length) { toast('В условии этого задания нет картинок. Любую картинку можно скопировать и вставить на доску (Ctrl+V) или перетащить мышью.', 5000); return; }
      bdInsert(imgs.map(i => i.currentSrc || i.src));
    } else if (id === 'bdLonger') {
      const sh = $('#bdSheet');
      BD.minH = Math.max(BD.minH, $('#bdCanvas').clientHeight) + Math.max(400, sh.clientHeight);
      bdRedraw(); bdSaveSoon();
      sh.scrollTo({ top: sh.scrollHeight, behavior: 'smooth' });
    } else if (id === 'bdBg') {
      BD.bg = BD_BGS[(BD_BGS.indexOf(BD.bg) + 1) % BD_BGS.length];
      bdPrefs();
      bdRedraw();
    } else if (id === 'bdClear') {
      if (!BD.strokes.length || !confirm('Очистить доску этого задания? Вернуть можно кнопкой ↶')) return;
      bdDo({ del: BD.strokes });
      BD.strokes = [];
      bdRedraw(); bdSave();
    }
  });
  document.addEventListener('keydown', e => {
    if (!bdOpen() || e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (!$('#forecastModal').hidden) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'я') && !e.shiftKey) { e.preventDefault(); bdUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'н' || ((k === 'z' || k === 'я') && e.shiftKey))) { e.preventDefault(); bdRedoAct(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tool = { p: 'pen', з: 'pen', l: 'line', д: 'line', t: 'text', е: 'text', e: 'eraser', у: 'eraser' }[k];
    if (tool) bdSetTool(tool);
  });

  /** Картинку — в data:-адрес, уменьшенную до ширины листа: так она хранится вместе с доской и не пропадёт. */
  function bdImageData(src) {
    return new Promise((ok, fail) => {
      const im = new Image();
      im.onload = () => {
        const maxW = 1200, k = Math.min(1, maxW / im.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        let data;
        try { data = c.toDataURL('image/png'); if (data.length > 450000) data = c.toDataURL('image/jpeg', 0.82); }
        catch (e) { fail(e); return; }                  // чужой сайт не разрешил: картинку не прочитать
        ok({ data, w: c.width, h: c.height });
      };
      im.onerror = fail;
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) im.crossOrigin = 'anonymous';
      im.src = src;
    });
  }
  /** Вставить картинки на доску: в точку (x, y) или в верх видимой части листа, одну под другой. */
  async function bdInsert(srcs, x, y) {
    if (!bdOpen() || !srcs.length) return;
    bdTextCommit();
    const sh = $('#bdSheet');
    let px = x != null ? x : 10, py = y != null ? y : sh.scrollTop + 10;
    const added = [];
    for (const src of srcs.slice(0, 6)) {
      let d;
      try { d = await bdImageData(src); } catch (e) { toast('Эту картинку не получилось вставить — сохраните её на компьютер и перетащите файл на доску', 5000); continue; }
      const maxW = Math.max(60, sh.clientWidth - 20 - px);
      const k = Math.min(1, maxW / d.w);
      const st = { k: 'img', x: px, y: py, iw: Math.round(d.w * k), ih: Math.round(d.h * k), src: d.data };
      BD.strokes.push(st);
      added.push(st);
      py += st.ih + 12;
    }
    if (!added.length) return;
    bdDo({ add: added });
    if (BD.tool === 'eraser' || BD.tool === 'text') bdSetTool('pen');
    bdRedraw(); bdSaveSoon();
  }
  const bdFileData = f => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(f); });
  /** Буфер обмена и перетаскивание браузер даёт прочитать только сразу, внутри события: забираем всё заранее. */
  const bdGrab = dt => ({
    files: Array.from((dt && dt.files) || []).filter(f => /^image\//.test(f.type)),
    html: (dt && dt.getData && dt.getData('text/html')) || '',
    uri: ((dt && dt.getData && (dt.getData('text/uri-list') || dt.getData('text/plain'))) || '').trim(),
  });
  /** Картинки: файлы, картинка из HTML (например, скопированная из условия), ссылка на картинку. */
  async function bdSourcesOf(got) {
    const out = [];
    for (const f of got.files) { const d = await bdFileData(f); if (d) out.push(d); }
    if (out.length) return out;
    const m = got.html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m) return [new URL(m[1].replace(/&amp;/g, '&'), location.href).href];
    const uri = got.uri;
    if (uri && /^(https?:|data:image\/)/i.test(uri) && /\.(png|jpe?g|gif|webp|svg)(\?|#|$)|^data:image/i.test(uri)) return [uri];
    return out;
  }
  document.addEventListener('paste', async e => {
    if (!bdOpen() || e.target.closest('input, textarea, [contenteditable]')) return;
    const got = bdGrab(e.clipboardData);
    if (!got.files.length && !/<img/i.test(got.html)) return;            // обычный текст — не наше дело
    e.preventDefault();
    const srcs = await bdSourcesOf(got);
    if (srcs.length) bdInsert(srcs);
  });
  $('#bdSheet').addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('#bdSheet').classList.add('drop'); });
  $('#bdSheet').addEventListener('dragleave', () => $('#bdSheet').classList.remove('drop'));
  $('#bdSheet').addEventListener('drop', async e => {
    e.preventDefault();
    $('#bdSheet').classList.remove('drop');
    const [x, y] = bdPos(e);
    const srcs = await bdSourcesOf(bdGrab(e.dataTransfer));
    if (srcs.length) bdInsert(srcs, Math.max(0, x - 20), Math.max(0, y - 20));
    else toast('Перетащите картинку — например, рисунок из условия задания', 3500);
  });

  // кнопки размера текста не забирают фокус у надписи, которую печатают, — она растёт прямо на глазах
  $('#bdDock').addEventListener('mousedown', e => { if (e.target.closest('[data-bd-fs]') && BD.text) e.preventDefault(); });
  // ------------------------------------------------------------ правые панели: ширина — тянуть левый край влево
  // Python и доска запоминают свою ширину; двойной щелчок по краю — обычная ширина. Задаче оставляем не меньше 340px.
  const DOCK_W = { pyDock: 'egeTrainer.dockW.py', bdDock: 'egeTrainer.dockW.bd' };
  const dockMax = () => Math.max(360, window.innerWidth - (document.body.classList.contains('side-min') ? 80 : 300) - 340);
  function dockSetW(dock, w) {
    if (w) dock.style.flexBasis = Math.round(Math.max(320, Math.min(dockMax(), w))) + 'px';
    else dock.style.removeProperty('flex-basis');
    if (dock.id === 'bdDock') setTimeout(bdRedraw, 30);
  }
  for (const [id, key] of Object.entries(DOCK_W)) {
    const dock = $('#' + id), grip = dock && dock.querySelector('[data-dock-grip]');
    if (!grip) continue;
    try { const v = +localStorage.getItem(key); if (v >= 320) dockSetW(dock, v); } catch (e) {}
    let drag = null;
    grip.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, w: dock.getBoundingClientRect().width };
      grip.classList.add('on');
      document.body.classList.add('dock-drag');
    });
    grip.addEventListener('pointermove', e => {
      if (!drag) return;
      const w = Math.max(320, Math.min(dockMax(), drag.w + drag.x - e.clientX));
      dock.style.flexBasis = Math.round(w) + 'px';
      if (id === 'bdDock') bdRedraw();
    });
    const up = () => {
      if (!drag) return;
      drag = null;
      grip.classList.remove('on');
      document.body.classList.remove('dock-drag');
      if (id === 'bdDock') { document.body.classList.remove('bd-wide'); $('#bdWide')?.setAttribute('aria-pressed', 'false'); bdRedraw(); }
      try { localStorage.setItem(key, String(Math.round(dock.getBoundingClientRect().width))); } catch (e) {}
    };
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    grip.addEventListener('dblclick', () => { dockSetW(dock, 0); try { localStorage.removeItem(key); } catch (e) {} });
  }
  window.addEventListener('resize', () => {
    for (const id of Object.keys(DOCK_W)) {
      const dock = $('#' + id);
      if (dock && dock.style.flexBasis) dockSetW(dock, parseFloat(dock.style.flexBasis));
    }
  });

  function toggleBoard(force) {
    const open = force != null ? force : !bdOpen();
    if (open && pyOpen()) togglePy(false);             // справа одна панель: или Python, или доска
    if (!open) { bdTextCommit(); bdSave(); }
    $('#bdDock').hidden = !open;
    document.body.classList.toggle('bd-open', open);
    $$('#bdBtn').forEach(b => b.classList.toggle('on', open));
    if (!open) return;
    if (isNarrow()) setSideOpen(false);
    BD.task = null;
    $$('#bdDock [data-bd-size]').forEach(b => b.classList.toggle('on', +b.dataset.bdSize === BD.size));
    bdFsLabel();
    bdSync();
    if (!BD.ro && window.ResizeObserver) {
      let last = '';
      BD.ro = new ResizeObserver(([en]) => {                // перерисовка только при настоящей смене размера
        const k = Math.round(en.contentRect.width) + 'x' + Math.round(en.contentRect.height);
        if (k !== last) { last = k; requestAnimationFrame(bdRedraw); }
      });
      BD.ro.observe($('#bdSheet'));
      // по горизонтали лист не прокручивается никогда (браузер может сдвинуть его к курсору в поле текста)
      $('#bdSheet').addEventListener('scroll', e => { if (e.currentTarget.scrollLeft) e.currentTarget.scrollLeft = 0; });
    }
  }
  /** Доска следует за открытым заданием: у каждого своя. */
  function bdSync() {
    if (!bdOpen()) return;
    $$('#bdBtn').forEach(b => b.classList.add('on'));
    const t = pyTaskNow();
    const id = t ? t.id : 'free';
    if (BD.task && BD.task.id === id) { bdRedraw(); return; }
    bdTextCommit();
    if (BD.task) bdSave();
    BD.task = t ? { id: t.id, n: t.n } : { id: 'free' };
    bdLoad(id);
    $('#bdTask').textContent = t ? `задание ${numLabel(t.n)}` : 'черновик';
    $('#bdSheet').scrollTop = 0;
    bdRedraw();
  }
  window.addEventListener('beforeunload', () => { if (BD.saveT) bdSave(); });

