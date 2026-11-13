import {accountLocalStorage as localStorage} from './account-storage.js';
import {powerCheck,powered,echoDuration} from './power.js';
import {wireNets} from './circuit-check.js';
import {captureChange, restoreChange, saveVersion, persistProject} from './persistence.js';
import {symbolElement} from "./parts-library.js";
import {buttons, pots, signals, externalIO, evaluateNet} from "./io-parts.js";
import {initAcademy, icon} from './academy.js';
import {catalog, blink, examples} from './catalog.js';
import {runAVR, runPico, runEducational} from './runtime.js';

/* ───────────── helpers ───────────── */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const plural = (n, [one, few, many]) => { const a = Math.abs(n) % 100, b = a % 10; return `${n} ${a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`; };
const isLocal = ['127.0.0.1', 'localhost'].includes(location.hostname);
const BOARDS_RUNNABLE = ['wokwi-arduino-uno', 'wokwi-arduino-nano', 'wokwi-pi-pico'];
const SVG = 'http://www.w3.org/2000/svg';
const HINT = 'Вывод → вывод — провод · двойной щелчок — свойства';
const hydrateIcons = (root = document) => root.querySelectorAll('i[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });

/* ───────────── state ───────────── */
const emptyProject = () => ({name: 'Мой первый проект', code: blink, libraries: [], diagram: {version: 1, author: 'MicroLab', editor: 'microlab', parts: [{type: 'wokwi-arduino-uno', id: 'uno', top: 180, left: 160, attrs: {}}], connections: []}});
let project = emptyProject();
try {
  const active = localStorage.getItem('microlab.activeLesson');
  const saved = localStorage.getItem(active ? 'microlab.lesson.' + active : 'microlab.project');
  if (saved) project = validate(JSON.parse(saved)).project;
} catch {}

const projectKey=()=>project.lessonId?'microlab.lesson.'+project.lessonId:'microlab.project';
const projectBases=new Map([[projectKey(),localStorage.getItem(projectKey())]]);
let tab = 'code', selected = null, selectedWire = null, pending = null, wireColor = '#2f9e74', zoom = 1, pan = {x: 0, y: 0};
let engine = null, firmware = null, running = false, started = 0, logs = [], serial = '', consoleTab = 'serial';
let viewTouched = false, outputs = {}, pinModes = {}, history = [], future = [], audio = null, oscillators = {}, lastSave, tick, errorLine = null, consoleFrame = 0;
let telemetry = freshTelemetry();
const elements = new Map();
const heldButtons = new Set();
let renderGeneration = 0;
function pressed(id) {
  return heldButtons.has(id) || !!elements.get(id)?.el.pressed;
}

function signatureDiagram(d) {
  return { ...d, parts: d.parts.map((p) => ({ ...p, attrs: { ...p.attrs, value: void 0, temperature: void 0, humidity: void 0, distance: void 0 } })) };
}
function freshTelemetry() {
  return { started: false, signature: "", pins: {}, modes: {}, events: [], frames: [], edges: [], analog: {}, serial: "", samples: [], error: null };
}

/**
 * Validate a MicroLab project or a bare Wokwi diagram.json.
 * Unknown parts are skipped (with a warning) instead of rejecting the whole file.
 */
function validate(p) {
  if (!p || typeof p !== 'object') throw Error('Ожидается проект MicroLab или diagram.json');
  if (p.parts) p = {name: 'Импортированная схема', code: blink, libraries: [], diagram: p};
  if (!p.diagram || !Array.isArray(p.diagram.parts) || !Array.isArray(p.diagram.connections)) throw Error('Ожидается проект MicroLab или diagram.json');
  if (p.diagram.parts.length > 200 || p.diagram.connections.length > 1000) throw Error('Не более 200 компонентов и 1000 проводов');
  const warnings = [], ids = new Set(), parts = [];
  for (const part of p.diagram.parts) {
    if (!part || !catalog.some(c => c.type === part.type)) { warnings.push(`пропущен неизвестный компонент ${part?.type ?? '?'}`); continue; }
    if (!/^[\w-]+$/.test(part.id) || ids.has(part.id)) throw Error('Некорректные или повторяющиеся ID компонентов');
    const left = Number(part.left), top = Number(part.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) throw Error('Некорректные координаты компонента ' + part.id);
    ids.add(part.id);
    parts.push({...part, left, top, attrs: part.attrs && typeof part.attrs === 'object' ? part.attrs : {}});
  }
  const connections = [];
  for (const c of p.diagram.connections) {
    if (!Array.isArray(c) || typeof c[0] !== 'string' || typeof c[1] !== 'string') throw Error('Некорректное соединение');
    if (!ids.has(c[0].split(':')[0]) || !ids.has(c[1].split(':')[0])) { warnings.push(`пропущен провод ${c[0]} → ${c[1]}`); continue; }
    const color = /^#[0-9a-f]{3,8}$/i.test(c[2]) || /^[a-z]+$/i.test(c[2]) ? c[2] : '#2f9e74';
    connections.push([c[0], c[1], color, Array.isArray(c[3]) ? c[3] : []]);
  }
  const project = {...p, diagram: {...p.diagram, parts, connections}, name: String(p.name || 'Проект').slice(0, 100), code: String(p.code ?? blink), libraries: Array.isArray(p.libraries) ? p.libraries.filter(x => typeof x === 'string') : []};
  return {project, warnings};
}
const validated = p => validate(p).project;

/* ───────────── feedback ───────────── */
function toast(s, kind = '') {
  const t = $('#toast');
  t.textContent = s; t.className = 'show ' + kind;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3600);
}
function log(s) { logs.push(`[${new Date().toLocaleTimeString('ru-RU')}] ${s}`); logs = logs.slice(-300); showConsole(); }
function showConsole() {
  if (consoleFrame) return;
  consoleFrame = requestAnimationFrame(() => {
    consoleFrame = 0;
    const out = $('#consoleOutput');
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 30;
    const text = consoleTab === 'serial' ? serial : logs.join('\n');
    out.classList.toggle('placeholder', !text);
    out.textContent = text || (consoleTab === 'serial' ? 'Здесь появится вывод Serial.print(). Запустите симуляцию.' : 'Журнал событий пуст.');
    if (stick) out.scrollTop = out.scrollHeight;
  });
}

/* ───────────── persistence & history ───────────── */
function checkpoint(scope = 'diagram') { history.push(captureChange(project,scope)); if (history.length > 60) history.shift(); future = []; }
function changed() {
  document.dispatchEvent(new Event('microlab-change'));
  clearTimeout(lastSave);
  setSaveState('saving');
  lastSave = setTimeout(save, 500);
}
function setSaveState(state) {
  const el = $('#saveState');
  el.dataset.state = state;
  el.lastChild.textContent = state === 'saving' ? 'Сохранение…' : state === 'error' ? 'Не сохранено' : 'Сохранено';
}
function commitDiagram(report = true) {
  if (tab !== 'diagram') return true;
  try {
    const {project:p,warnings} = validate({...project,diagram:JSON.parse($('#code').value)});
    if(JSON.stringify(p.diagram)!==JSON.stringify(project.diagram)){
      checkpoint(); project.diagram=p.diagram; renderParts();
    }
    if(report && warnings.length) toast(warnings.join('; '));
    return true;
  } catch(e) { setSaveState('error'); if(report)toast('Схема не сохранена: '+e.message,'error'); return false; }
}
function save(report = false) {
  clearTimeout(lastSave);
  if(!commitDiagram(report))return false;
  try {
    const key=projectKey();if(!projectBases.has(key))projectBases.set(key,localStorage.getItem(key));
    const result=persistProject(localStorage,key,project,projectBases.get(key));
    if(result.conflict){setSaveState('error');if(report)conflictDialog(key,result.value);return false;}
    projectBases.set(key,result.value);
    localStorage.setItem('microlab.activeLesson', project.lessonId || '');
    setSaveState('saved'); return true;
  } catch { setSaveState('error'); toast('Не удалось сохранить: скачайте проект кнопкой «Экспорт»', 'error'); return false; }
}
function conflictDialog(key,remote){
  $('#modalTitle').textContent='Проект изменён в другой вкладке';$('#modalKicker').textContent='ОБЕ ВЕРСИИ МОЖНО СОХРАНИТЬ';
  $('#modalBody').innerHTML='<p>Текущие правки остаются в редакторе. Скачайте их отдельным файлом перед открытием сохранённой версии.</p><button id="downloadConflict" class="btn solid">Скачать мои правки</button><button id="loadRemote" class="btn outline">Открыть сохранённую версию</button>';
  $('#downloadConflict').onclick=()=>download('microlab-local-changes.json',JSON.stringify(project,null,2));
  $('#loadRemote').onclick=()=>{try{const next=validated(JSON.parse(remote));stop();checkpoint('project');project=next;projectBases.set(key,remote);renderAll();setSaveState('saved');$('#modal').close()}catch{toast('Не удалось прочитать сохранённую версию','error')}};
  if(!$('#modal').open)$('#modal').showModal();
}
function undo(redo = false) {
  if(!commitDiagram())return;
  const from = redo ? future : history, to = redo ? history : future;
  if (!from.length) { toast(redo ? 'Нечего повторять' : 'Нечего отменять'); return; }
  const change=from.pop();
  stop(); to.push(captureChange(project,change.scope)); project=restoreChange(project,change); renderAll(); changed();
}
function versionsDialog(){
  const key=project.lessonId?'microlab.lesson.'+project.lessonId:'microlab.project';
  let versions=[];try{versions=JSON.parse(localStorage.getItem(key+'.versions')||'[]')}catch{}
  $('#modalTitle').textContent='История сохранений';$('#modalKicker').textContent='ПОСЛЕДНИЕ 12 ВЕРСИЙ НА ЭТОМ УСТРОЙСТВЕ';
  $('#modalBody').innerHTML=versions.length?versions.map((v,i)=>`<button class="version-row" data-version="${i}"><b>${esc(new Date(v.at).toLocaleString('ru-RU'))}</b><span>${v.project.diagram.parts.length} компонентов · ${v.project.code.split('\n').length} строк кода</span></button>`).join(''):'<p>Предыдущие версии появятся после изменений и сохранения проекта.</p>';
  $$('[data-version]').forEach(button=>button.onclick=()=>{if(!save(true))return;stop();checkpoint('project');project=validated(versions[Number(button.dataset.version)].project);renderAll();changed();$('#modal').close();toast('Версия восстановлена. Отменить: Ctrl+Z вне редактора.');});
  $('#modal').showModal();
}
function board() { return project.diagram.parts.find(p => catalog.find(c => c.type === p.type)?.category === 'Платы'); }

/* ───────────── code editor ───────────── */
const KEYWORDS = 'if|else|for|while|do|switch|case|default|break|continue|return|const|static|volatile|unsigned|signed|struct|class|new|sizeof|true|false';
const TYPES = 'void|int|float|double|long|short|bool|boolean|char|byte|word|String|size_t|u?int(?:8|16|32|64)_t|Servo|LiquidCrystal|DHT|auto';
const CONSTS = 'HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|LED_BUILTIN|A[0-7]|DHT11|DHT22|DEC|HEX|BIN|OCT|RISING|FALLING|CHANGE|PI';
const TOKEN = new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)|"(?:\\\\.|[^"\\\\\\n])*"?|'(?:\\\\.|[^'\\\\\\n])*'?|^[ \\t]*#\\w+[^\\n]*|\\b(?:${KEYWORDS})\\b|\\b(?:${TYPES})\\b|\\b(?:${CONSTS})\\b|\\b(?:0x[0-9a-f]+|\\d+(?:\\.\\d+)?)\\w*|\\b[A-Za-z_]\\w*(?=\\s*\\())`, 'gmi');
const KW = new RegExp(`^(?:${KEYWORDS})$`), TY = new RegExp(`^(?:${TYPES})$`), CO = new RegExp(`^(?:${CONSTS})$`);
function tokenClass(t) {
  if (t.startsWith('//') || t.startsWith('/*')) return 'comment';
  if (t[0] === '"' || t[0] === "'") return 'str';
  if (/^\s*#/.test(t)) return 'pre';
  if (/^\d/.test(t)) return 'num';
  if (KW.test(t)) return 'kw';
  if (TY.test(t)) return 'type';
  if (CO.test(t)) return 'const';
  return 'fn';
}
function updateCode() {
  const code = $('#code').value;
  let out = '', last = 0;
  if (tab === 'code') {
    for (const m of code.matchAll(TOKEN)) {
      out += esc(code.slice(last, m.index)) + `<span class="${tokenClass(m[0])}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
  }
  $('#highlight').innerHTML = out + esc(code.slice(last)) + '\n';
  const lines = code.split('\n').length;
  $('#lineNumbers').innerHTML = Array.from({length: lines}, (_, i) => `<span${i + 1 === errorLine ? ' class="error"' : ''}>${i + 1}</span>`).join('');
  syncScroll();
}
function syncScroll() {
  const c = $('#code');
  $('#highlight').scrollTop = c.scrollTop; $('#highlight').scrollLeft = c.scrollLeft;
  $('#lineNumbers').scrollTop = c.scrollTop;
  const marker = $('#errorMarker');
  if (marker) marker.style.transform = `translateY(${-c.scrollTop}px)`;
}
function setError(message, line = null) {
  errorLine = line;
  const box = $('#editorError');
  if (!message) { box.hidden = true; $('#errorMarker').hidden = true; updateCode(); return; }
  box.hidden = false;
  box.innerHTML = `${icon('alert')}<div><strong>${line ? 'Строка ' + line : 'Ошибка программы'}</strong><span>${esc(message)}</span></div><button type="button" aria-label="Скрыть">${icon('x')}</button>`;
  box.querySelector('button').onclick = () => setError(null);
  const marker = $('#errorMarker');
  marker.hidden = !line;
  if (line) {
    const lh = parseFloat(getComputedStyle($('#code')).lineHeight) || 22;
    marker.style.top = (line - 1) * lh + parseFloat(getComputedStyle($('#code')).paddingTop) + 'px';
    const c = $('#code');
    if ((line - 1) * lh < c.scrollTop || (line - 1) * lh > c.scrollTop + c.clientHeight - lh * 2) c.scrollTop = Math.max(0, (line - 4) * lh);
  }
  updateCode();
}
function cursor() {
  const c = $('#code'), t = c.value.slice(0, c.selectionStart).split('\n');
  $('#cursor').textContent = `Стр. ${t.length}, стлб. ${t.at(-1).length + 1}`;
}
function editorKeys(e) {
  const el = e.target, {selectionStart: a, selectionEnd: b, value: v} = el;
  const lineStart = v.lastIndexOf('\n', a - 1) + 1;
  const insert = (text, from = a, to = b, mode = 'end') => { el.setRangeText(text, from, to, mode); el.dispatchEvent(new Event('input')); };
  if (e.key === 'Tab') {
    e.preventDefault();
    if (a === b && !e.shiftKey) return insert('  ');
    const end = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0)), blockEnd = end < 0 ? v.length : end;
    const block = v.slice(lineStart, blockEnd);
    const next = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
    insert(next, lineStart, blockEnd, 'select');
  } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const indent = /^[ \t]*/.exec(v.slice(lineStart, a))[0];
    const before = v.slice(lineStart, a).trimEnd(), after = v.slice(b);
    if (before.endsWith('{') && /^\s*\}/.test(after)) { insert('\n' + indent + '  ' + '\n' + indent); el.selectionStart = el.selectionEnd = a + indent.length + 3; return; }
    insert('\n' + indent + (before.endsWith('{') ? '  ' : ''));
  } else if (e.key === '}' && /^[ \t]+$/.test(v.slice(lineStart, a)) && a === b) {
    e.preventDefault();
    const indent = v.slice(lineStart, a);
    insert(indent.slice(0, Math.max(0, indent.length - 2)) + '}', lineStart, a);
  } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault();
    const end = v.indexOf('\n', b), blockEnd = end < 0 ? v.length : end;
    const block = v.slice(lineStart, blockEnd), lines = block.split('\n');
    const commented = lines.filter(l => l.trim()).every(l => /^\s*\/\//.test(l));
    insert(lines.map(l => commented ? l.replace(/^(\s*)\/\/ ?/, '$1') : l.trim() ? l.replace(/^(\s*)/, '$1// ') : l).join('\n'), lineStart, blockEnd, 'select');
  }
}
function switchTab(next) {
  if(tab === 'diagram' && next !== 'diagram' && !commitDiagram()) return false;
  tab = next;
  $$('[data-tab]').forEach(b => {b.classList.toggle('active', b.dataset.tab === tab);b.setAttribute('aria-selected',String(b.dataset.tab===tab));});
  $('#codePanel').hidden = tab === 'libraries';
  $('#libraryPanel').hidden = tab !== 'libraries';
  $('#codePanel').classList.toggle('json', tab === 'diagram');
  if (tab === 'libraries') renderLibraries();
  else { $('#code').value = tab === 'code' ? project.code : JSON.stringify(project.diagram, null, 2); $('#code').scrollTop = 0; if (tab !== 'code') setError(null); updateCode(); cursor(); }
}

/* ───────────── parts & wiring ───────────── */
function picoElement() {
  const el = document.createElement('div');
  el.className = 'pico';
  el.innerHTML = '<div class="pico-usb"></div><i class="pico-led"></i>';
  const names = ['GP0', 'GP1', 'GND.1', 'GP2', 'GP3', 'GP4', 'GP5', 'GND.2', 'GP6', 'GP7', 'GP8', 'GP9', 'GND.3', 'GP10', 'GP11', 'GP12', 'GP13', 'GND.4', 'GP14', 'GP15', 'GP16', 'GP17', 'GND.5', 'GP18', 'GP19', 'GP20', 'GP21', 'GND.6', 'GP22', 'RUN', 'GP26', 'GP27', 'GND.7', 'GP28', 'ADC_VREF', '3V3', '3V3_EN', 'GND.8', 'VSYS', 'VBUS'];
  el.pinInfo = names.map((name, i) => ({name, x: i < 20 ? 0 : 74, y: 7 + (i < 20 ? i : 39 - i) * 9.5}));
  for (const p of el.pinInfo) { const pin = document.createElement('i'); pin.className = 'pico-pin'; pin.style.left = p.x - 4 + 'px'; pin.style.top = p.y - 3 + 'px'; el.append(pin); }
  return el;
}
function createElement(p) {
  const definition = catalog.find((c) => c.type === p.type);
  const el = p.type === "wokwi-pi-pico" ? picoElement() : Array.isArray(definition?.pins) ? symbolElement(p, definition) : document.createElement(p.type);
  if (p.type === "wokwi-slide-potentiometer") el.max = 1023;
  for (const [k, v] of Object.entries(p.attrs || {})) {
    if (/^[a-zA-Z][\w-]*$/.test(k) && !/^on/i.test(k) && !["style", "id", "class", "src", "href"].includes(k)) el.setAttribute(k, String(v));
  }
  return el;
}
async function renderParts() {
  const generation = ++renderGeneration;
  elements.clear();
  $('#parts').replaceChildren();
  for (const p of project.diagram.parts) {
    const wrap = document.createElement('div');
    wrap.className = 'part'; wrap.dataset.id = p.id;
    wrap.style.left = p.left + 'px'; wrap.style.top = p.top + 'px';
    const el = createElement(p);
    wrap.append(el);
    const label = document.createElement('span');
    label.className = 'part-label';
    label.textContent = p.id;
    wrap.append(label);
    $('#parts').append(wrap);
    elements.set(p.id, {wrap, el});
    if (el.updateComplete) await el.updateComplete;
    if (generation !== renderGeneration) return;
    for (const pin of el.pinInfo || []) {
      const dot = document.createElement('button');
      dot.className = 'pin'; dot.dataset.ref = `${p.id}:${pin.name}`;
      dot.title = `${p.id}:${pin.name}`;
      dot.setAttribute('aria-label', `Вывод ${p.id}:${pin.name}`);
      dot.style.left = pin.x + 'px'; dot.style.top = pin.y + 'px';
      dot.onpointerdown = e => e.stopPropagation();
      dot.onclick = e => {e.stopPropagation();connect(p.id + ':' + pin.name);};
      wrap.append(dot);
    }
    wrap.onpointerdown = e => dragPart(e, p);
    wrap.ondblclick = () => inspect(p.id);
    for (const event of ['button-press', 'button-release', 'input', 'change']) el.addEventListener(event, () => setTimeout(updateInputs, 0));
  }
  drawWires(); updateCounts(); select(selected); updateBadge(); markPending();
  if (!viewTouched) requestAnimationFrame(fit);
  document.dispatchEvent(new Event('microlab-rendered'));
}
function updateCounts() {
  $('#partCount').textContent = plural(project.diagram.parts.length, ['компонент', 'компонента', 'компонентов']);
  $('#wireCount').textContent = plural(project.diagram.connections.length, ['соединение', 'соединения', 'соединений']);
}
function endpoint(ref) {
  const [id, name] = ref.split(':');
  const p = project.diagram.parts.find(p => p.id === id), pin = elements.get(id)?.el.pinInfo?.find(p => p.name === name);
  return p && pin ? {x: p.left + pin.x, y: p.top + pin.y} : null;
}
function route(a, b, lane = 0) {
  // Orthogonal route with softened corners; `lane` spreads parallel wires apart.
  const span = Math.abs(b.y - a.y);
  const mid = (a.y + b.y) / 2 + (span > 40 ? lane * 6 : 0), r = Math.min(8, Math.abs(b.x - a.x) / 2, Math.abs(mid - a.y));
  if (Math.abs(a.x - b.x) < 1 || r < 1) return `M ${a.x} ${a.y} L ${a.x} ${mid} L ${b.x} ${mid} L ${b.x} ${b.y}`;
  const sx = Math.sign(b.x - a.x), sy1 = Math.sign(mid - a.y), sy2 = Math.sign(b.y - mid) || sy1;
  return `M ${a.x} ${a.y} L ${a.x} ${mid - sy1 * r} Q ${a.x} ${mid} ${a.x + sx * r} ${mid} L ${b.x - sx * r} ${mid} Q ${b.x} ${mid} ${b.x} ${mid + sy2 * r} L ${b.x} ${b.y}`;
}
function drawWires() {
  const svg = $('#wires');
  svg.replaceChildren();
  project.diagram.connections.forEach((c, i) => {
    const a = endpoint(c[0]), b = endpoint(c[1]);
    if (!a || !b) return;
    const g = document.createElementNS(SVG, 'g');
    g.classList.add('wire-group');
    g.setAttribute('role','button');g.setAttribute('tabindex','0');
    g.setAttribute('aria-label',`Соединение ${c[0]} → ${c[1]}`);
    g.onkeydown=e=>{if(['Enter',' ','Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopPropagation();if(['Enter',' '].includes(e.key))selectWire(i);else removeWire(i);}};
    if (selectedWire === i) g.classList.add('selected');
    const hit = document.createElementNS(SVG, 'path'), path = document.createElementNS(SVG, 'path');
    const d = route(a, b, (i % 7) - 3);
    hit.setAttribute('d', d); hit.classList.add('wire-hit');
    path.setAttribute('d', d); path.setAttribute('stroke', c[2] || wireColor); path.classList.add('wire');
    const title = document.createElementNS(SVG, 'title');
    title.textContent = `${c[0]} → ${c[1]} · щелчок — выбрать, Delete — удалить`;
    g.append(title, hit, path);
    for (const end of [a, b]) { const dot = document.createElementNS(SVG, 'circle'); dot.setAttribute('cx', end.x); dot.setAttribute('cy', end.y); dot.setAttribute('r', 2.6); dot.setAttribute('fill', c[2] || wireColor); dot.classList.add('wire-end'); g.append(dot); }
    hit.onpointerdown = e => { e.stopPropagation(); selectWire(i); };
    hit.ondblclick = () => removeWire(i);
    svg.append(g);
  });
  const preview = document.createElementNS(SVG, 'path');
  preview.id = 'wirePreview';
  preview.setAttribute('stroke', wireColor);
  svg.append(preview);
}
function selectWire(i) { selectedWire = i; select(null); $('#inspector').hidden = true; drawWires(); }
function removeWire(i) {
  if (running) { toast('Остановите симуляцию, чтобы изменить схему'); return; }
  checkpoint(); project.diagram.connections.splice(i, 1); selectedWire = null;
  drawWires(); updateCounts(); changed(); toast('Провод удалён');
}
function markPending() { $$('.pin.pending').forEach(p => p.classList.remove('pending')); if (pending) $(`.pin[data-ref="${CSS.escape(pending)}"]`)?.classList.add('pending'); }
function cancelWire() { pending = null; markPending(); $('#wirePreview')?.removeAttribute('d'); $('#labView').dataset.mobilePanel='code';
$$('#mobileLabTabs button').forEach(b=>b.onclick=()=>{
  $('#labView').dataset.mobilePanel=b.dataset.panel;
  $$('#mobileLabTabs button').forEach(x=>x.classList.toggle('active',x===b));
  if(b.dataset.panel==='circuit')requestAnimationFrame(fit);
});
document.addEventListener('microlab-rendered',()=>{
  const task=$('#mobileLabTabs [data-panel="task"]');task.disabled=!project.lessonId;
  if(!project.lessonId&&$('#labView').dataset.mobilePanel==='task')$('#mobileLabTabs [data-panel="code"]').click();
});
$('#canvasHint').textContent = HINT; $('#canvas').classList.remove('wiring'); }
function connect(ref) {
  if (running) { toast('Остановите симуляцию, чтобы изменить схему'); return; }
  if (!pending) {
    pending = ref; markPending();
    $('#canvas').classList.add('wiring');
    $('#canvasHint').textContent = `Провод от ${ref} · выберите второй вывод · Esc — отмена`;
    return;
  }
  if (pending !== ref) {
    if (project.diagram.connections.some(c => [c[0], c[1]].includes(ref) && [c[0], c[1]].includes(pending))) toast('Эти выводы уже соединены');
    else {
      checkpoint();
      project.diagram.connections.push([pending, ref, wireColor, []]);
      drawWires(); updateCounts(); changed();
    }
  }
  cancelWire();
}
function worldPoint(e) { const r = $('#canvas').getBoundingClientRect(); return {x: (e.clientX - r.left - pan.x) / zoom, y: (e.clientY - r.top - pan.y) / zoom}; }
function select(id) { selected = id; for (const [k, {wrap}] of elements) wrap.classList.toggle('selected', k === id); }
function dragPart(e, p) {
  if (e.button !== 0) return;
  e.stopPropagation();
  if (selectedWire !== null) { selectedWire = null; drawWires(); }
  select(p.id);
  if (running) return;
  const x = e.clientX, y = e.clientY, start = {left: p.left, top: p.top};
  let moved = false;
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - x, ev.clientY - y) > 3) { checkpoint(); moved = true; elements.get(p.id).wrap.classList.add('dragging'); }
    if (!moved) return;
    p.left = Math.max(0, Math.round((start.left + (ev.clientX - x) / zoom) / 5) * 5);
    p.top = Math.max(0, Math.round((start.top + (ev.clientY - y) / zoom) / 5) * 5);
    const w = elements.get(p.id).wrap;
    w.style.left = p.left + 'px'; w.style.top = p.top + 'px';
    drawWires();
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    elements.get(p.id)?.wrap.classList.remove('dragging');
    if (moved) changed();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function inspect(id) {
  selectedWire = null; drawWires();
  select(id);
  const p = project.diagram.parts.find((p2) => p2.id === id);
  if (!p) return;
  const c = catalog.find((c2) => c2.type === p.type);
  $("#inspector").hidden = false;
  $("#inspector").innerHTML = `<div class="inspector-head"><div><small>${esc(p.id)}</small><h3>${esc(c.name)}</h3></div><button id="hideInspector" class="tool" aria-label="Закрыть свойства">${icon("x")}</button></div><p class="inspector-desc">${esc(c.description)}</p>${p.type === "wokwi-led" ? '<label>Цвет<input id="attrColor" type="color" value="' + esc({ red: "#ff0000", green: "#00ff00", blue: "#0000ff" }[p.attrs.color] || p.attrs.color || "#ff0000") + '"></label>' : ""}${p.type === "wokwi-resistor" ? '<label>Сопротивление, Ом<input id="attrValue" type="number" min="1" value="' + esc(p.attrs.value || 220) + '"></label>' : ""}${pots.has(p.type) ? '<label>Значение<input id="potRange" type="range" min="0" max="1023" value="' + esc(p.attrs.value ?? 512) + '"><input id="potValue" aria-label="Точное значение АЦП" type="number" min="0" max="1023" value="' + esc(p.attrs.value ?? 512) + '"></label>' : ""}${p.type === "wokwi-dht22" ? '<label>Температура, °C<input id="temperature" type="number" value="' + esc(p.attrs.temperature ?? 22) + '"></label><label>Влажность, %<input id="humidity" type="number" min="0" max="100" value="' + esc(p.attrs.humidity ?? 50) + '"></label>' : ""}<button id="deletePart" class="danger-btn">${icon("trash")} Удалить компонент</button>`;
  if (buttons.has(p.type) && running) {
    const row = document.createElement("label");
    row.textContent = "Удерживать кнопку";
    const hold = document.createElement("input");
    hold.type = "checkbox";
    hold.checked = heldButtons.has(id);
    hold.onchange = () => {
      if (hold.checked) heldButtons.add(id);
      else heldButtons.delete(id);
      updateInputs();
    };
    row.append(hold);
    $("#inspector").insertBefore(row, $("#deletePart"));
  }
  if(p.type==='wokwi-hc-sr04'){
    const row=document.createElement('label'),input=document.createElement('input');row.textContent='Расстояние, см (2–400)';input.type='number';input.min=2;input.max=400;input.value=p.attrs.distance??100;
    input.onchange=()=>{p.attrs.distance=String(Math.max(2,Math.min(400,Number(input.value)||100)));input.value=p.attrs.distance;changed();updateInputs()};row.append(input);$('#inspector').insertBefore(row,$('#deletePart'));
  }
  const sensor = signals[p.type];
  if (sensor) {
    const panel = $("#inspector");
    const addControl = (key, label, kind, initial) => {
      const row = document.createElement("label");
      row.textContent = label;
      const field = document.createElement("input");
      field.type = kind;
      if (kind === "number") {
        field.min = 0;
        field.max = 1023;
        field.value = p.attrs[key] ?? initial;
      } else field.checked = p.attrs[key] === "1";
      field.onchange = () => {
        p.attrs[key] = kind === "number" ? String(Math.round(Math.max(0, Math.min(1023, Number(field.value) || 0)))) : field.checked ? "1" : "0";
        if (kind === "number") field.value = p.attrs[key];
        changed();
        updateInputs();
      };
      row.append(field);
      panel.insertBefore(row, $("#deletePart"));
    };
    if (sensor.analog) addControl("value", "Выход " + sensor.analog + " · 0–1023", "number", 0);
    if (sensor.digital) addControl("digital", "Высокий уровень на " + sensor.digital, "checkbox", 0);
  }
  if (p.type === "wokwi-clock-generator" || p.type === "wokwi-text") {
    const clock = p.type === "wokwi-clock-generator", key = clock ? "frequency" : "text", row = document.createElement("label"), input = document.createElement("input");
    row.textContent = clock ? "Частота, Гц (0,1–10)" : "Подпись";
    input.type = clock ? "number" : "text";
    input.value = p.attrs[key] ?? (clock ? 1 : "Текст");
    if (clock) {
      input.min = 0.1;
      input.max = 10;
      input.step = 0.1;
    }
    input.onchange = () => {
      p.attrs[key] = clock ? String(Math.max(0.1, Math.min(10, Number(input.value) || 1))) : input.value.slice(0, 200);
      input.value = p.attrs[key];
      if (!clock) elements.get(id).el.querySelector("b").textContent = input.value;
      changed();
    };
    row.append(input);
    $("#inspector").insertBefore(row, $("#deletePart"));
  }
  if (["wokwi-rgb-led", "wokwi-7segment"].includes(p.type)) {
    const row = document.createElement('label');
    row.innerHTML = '<span>Общий вывод</span><select id="attrCommon"><option value="cathode">Катод → GND</option><option value="anode">Анод → 5V</option></select>';
    $('#inspector').insertBefore(row,$('#deletePart'));
    $('#attrCommon').value=p.attrs.common||'cathode';
    $('#attrCommon').onchange=e=>{checkpoint();p.attrs.common=e.target.value;elements.get(id).el.setAttribute('common',e.target.value);changed();updateOutputs();};
  }
  $("#hideInspector").onclick = () => $("#inspector").hidden = true;
  $("#deletePart").onclick = removeSelected;
  for (const [q, key] of [["#attrColor", "color"], ["#attrValue", "value"], ["#temperature", "temperature"], ["#humidity", "humidity"]]) {
    const input = $(q);
    if (input) input.onchange = () => {
      checkpoint();
      p.attrs[key] = input.value;
      elements.get(p.id).el.setAttribute(key, input.value);
      changed();
      updateInputs();
    };
  }
  if ($("#potValue")) $("#potValue").onchange = (e) => {
    const value = Math.max(0, Math.min(1023, Math.round(Number(e.target.value) || 0)));
    $("#potRange").value = value;
    $("#potRange").dispatchEvent(new Event("input"));
  };
  if ($("#potRange")) $("#potRange").oninput = (e) => {
    p.attrs.value = e.target.value;
    elements.get(p.id).el.value = Number(e.target.value);
    $("#potValue").value = e.target.value;
    changed();
    updateInputs();
  };
}
function removeSelected() {
  if (running) { toast('Сначала остановите симуляцию'); return; }
  if (selectedWire !== null) { removeWire(selectedWire); return; }
  if (!selected) return;
  checkpoint();
  project.diagram.parts = project.diagram.parts.filter(p => p.id !== selected);
  project.diagram.connections = project.diagram.connections.filter(c => !c[0].startsWith(selected + ':') && !c[1].startsWith(selected + ':'));
  toast(`Компонент ${selected} удалён · Ctrl+Z — вернуть`);
  selected = null; $('#inspector').hidden = true;
  renderParts(); changed();
}
function modal(title, html, kicker = 'MICROLAB') {
  $('#modalTitle').textContent = title; $('#modalKicker').textContent = kicker; $('#modalBody').innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
}
function addPart(type) {
  if (running) stop();
  const c = catalog.find(c => c.type === type);
  checkpoint();
  if (c.category === 'Платы') {
    const old = board();
    if (old) {
      project.diagram.parts = project.diagram.parts.filter(p => p.id !== old.id);
      project.diagram.connections = project.diagram.connections.filter(w => !w[0].startsWith(old.id + ':') && !w[1].startsWith(old.id + ':'));
    }
    firmware = null;
  }
  const prefix = type.replace('wokwi-', '').replace(/-/g, '');
  let n = 1;
  while (project.diagram.parts.some(p => p.id === prefix + n)) n++;
  const rect = $('#canvas').getBoundingClientRect();
  const p = {type, id: prefix + n, left: Math.max(25, Math.round(((rect.width || 600) / 2 - 60 - pan.x) / zoom / 5) * 5), top: Math.max(40, Math.round(((rect.height || 400) / 3 - pan.y) / zoom / 5) * 5), attrs: {}};
  project.diagram.parts.push(p);
  selected = p.id;
  renderParts();
  if ($('#modal').open) $('#modal').close();
  changed();
  toast(c.name + ' добавлен');
}

/* ───────────── electrical model (digital nets) ───────────── */
function graph() {
  const adj = /* @__PURE__ */ new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, /* @__PURE__ */ new Set());
    if (!adj.has(b)) adj.set(b, /* @__PURE__ */ new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const [a, b] of project.diagram.connections) link(a, b);
  for (const p of project.diagram.parts) {
    const pins = elements.get(p.id)?.el.pinInfo || [];
    const groups = /* @__PURE__ */ new Map();
    for (const pin of pins) {
      const group = pin.name.split(".")[0];
      if (groups.has(group)) link(p.id + ":" + groups.get(group), p.id + ":" + pin.name);
      else groups.set(group, pin.name);
    }
    if (p.type === "wokwi-dip-switch-8") {
      const values = elements.get(p.id)?.el.values || [];
      values.forEach((on, i) => {
        if (on) link(p.id + ":" + (i + 1) + "a", p.id + ":" + (i + 1) + "b");
      });
    }
    if (p.type === "wokwi-resistor") link(p.id + ":1", p.id + ":2");
    if (buttons.has(p.type) && pressed(p.id)) link(p.id + ":1.l", p.id + ":2.l");
    if (p.type === "wokwi-slide-switch") link(p.id + ":2", p.id + ":" + (elements.get(p.id)?.el.value ? "3" : "1"));
  }
  return (ref) => {
    const seen = /* @__PURE__ */ new Set([ref]), todo = [ref];
    while (todo.length) {
      for (const n of adj.get(todo.pop()) || []) if (!seen.has(n)) {
        seen.add(n);
        todo.push(n);
      }
    }
    return seen;
  };
}
function pinNumber(s) {
  if (/^A\d+$/.test(s)) return 14 + Number(s.slice(1));
  if (/^GP\d+$/.test(s)) return Number(s.slice(2));
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}
function isPowered(p,reach=graph()){ const b=board();return powered(p,b,(a,z)=>{const target=z.endsWith(':GND')?Array.from(reach(a)).some(x=>x.startsWith(b?.id+':GND')):reach(a).has(z);return target}); }
function baseVoltage(net) {
  const b = board();
  let value = null;
  for (const ref of net) {
    const [id, name] = ref.split(":");
    if (id !== b?.id) continue;
    if (name.startsWith("GND")) return 0;
    if (["5V", "3V3", "3.3V", "VCC", "VBUS", "VSYS"].includes(name)) value = 1;
    const pin = pinNumber(name);
    if (pin !== null && outputs[pin] !== void 0) value = outputs[pin];
  }
  return value;
}
function netValue(net, reach = graph()) {
  const parts = new Map(project.diagram.parts.map((p) => [p.id, p]));
  return evaluateNet(net, (nodes) => {
    const v = baseVoltage(nodes);
    if (v !== null) return v;
    for (const ref of nodes) {
      const [id, pin] = ref.split(":"), part = parts.get(id);
      if (part?.type === "wokwi-clock-generator" && pin === "CLK" && running) {
        const hz = Math.max(0.1, Math.min(10, Number(part.attrs.frequency) || 1));
        return Math.floor((Date.now() - started) * hz / 500) % 2;
      }
      if (part && isPowered(part,reach)) {
        const input = externalIO(part, pin, elements.get(id)?.el);
        if (input?.digital !== void 0) return input.digital;
      }
    }
    return null;
  }, parts, reach);
}
function updateOutputs() {
  const reach = graph(), b = board();
  if (b) {
    const el = elements.get(b.id)?.el;
    if (el) {
      el.led13 = !!outputs[13];
      el.ledPower = running;
      el.querySelector?.(".pico-led")?.classList.toggle("on", !!outputs[25]);
    }
  }
  for (const p of project.diagram.parts) {
    const element = elements.get(p.id)?.el;
    if (!element) continue;
    const level = (pin) => netValue(reach(p.id + ":" + pin), reach);
    if (p.type === "wokwi-rgb-led") {
      const common = level("COM"), anode = p.attrs.common === "anode";
      for (const [pin, prop] of [["R", "ledRed"], ["G", "ledGreen"], ["B", "ledBlue"]]) {
        const v = level(pin);
        element[prop] = !running || common === null || v === null ? 0 : Math.max(0, anode ? common - v : v - common);
      }
    }
    if (p.type === "wokwi-7segment") {
      const values = [];
      for (let digit = 1; digit <= element.digits; digit++) {
        const common = level(element.digits === 1 ? "COM.1" : "DIG" + digit);
        for (const pin of ["A", "B", "C", "D", "E", "F", "G", "DP"]) {
          const v = level(pin);
          values.push(Number(running && common !== null && v !== null && (p.attrs.common === "cathode" ? v > common : common > v)));
        }
      }
      element.values = values;
    }
    if (p.type === "wokwi-led-bar-graph") element.values = Array.from({ length: 10 }, (_, i) => {
      const a = level("A" + (i + 1)), c = level("C" + (i + 1));
      return Number(running && a !== null && c !== null && a > c);
    });
    if(p.type==='wokwi-lcd1602'&&!isPowered(p,reach))element.text='';
    if (p.type === "wokwi-led") {
      const el = element, a = netValue(reach(p.id + ":A"), reach), c = netValue(reach(p.id + ":C"), reach);
      el.value = running && a !== null && c !== null && a > c;
      el.brightness = el.value ? Math.max(0, a - c) : 0;
    }
  }
}
function updateInputs() {
  if (!engine) return;
  const reach = graph(), b = board();
  if (!b) return;
  const digital = {}, analog = {};
  for (const p of elements.get(b.id)?.el.pinInfo || []) {
    const n = pinNumber(p.name);
    if (n === null) continue;
    const net = reach(b.id + ":" + p.name);
    for (const ref of net) {
      const [id, name] = ref.split(":");
      if (name.startsWith("GND")) digital[n] = 0;
      if (id === b.id && ["5V", "3V3", "3.3V"].includes(name)) digital[n] = 1;
      const comp = project.diagram.parts.find((p2) => p2.id === id);
      if (comp && isPowered(comp,reach)) {
        const io = externalIO(comp, name, elements.get(id)?.el);
        if (io?.analog !== void 0) {
          analog[n] = io.analog;
          if (n >= 14) engine.analog?.(n - 14, io.analog);
        }
        if (io?.digital !== void 0) digital[n] = io.digital;
      }
      if (comp?.type === "wokwi-dht22" && name === "SDA" && isPowered(comp,reach)) {
        analog["temp" + n] = Number(comp.attrs.temperature ?? 22);
        analog["humidity" + n] = Number(comp.attrs.humidity ?? 50);
      }
    }
    for(const part of project.diagram.parts.filter(x=>x.type==='wokwi-hc-sr04'))if(net.has(part.id+':ECHO')&&isPowered(part,reach)){
      const trigger=[...reach(part.id+':TRIG')].find(x=>x.startsWith(b.id+':')&&pinNumber(x.split(':')[1])!==null);
      if(trigger){analog['pulse'+n]=echoDuration(part.attrs.distance??100);analog['trigger'+n]=pinNumber(trigger.split(':')[1]);}
    }
    const v = netValue(net, reach);
    if (v !== null && pinModes[n] !== 1) digital[n] = Number(v >= 0.5);
    if (digital[n] !== void 0) engine.input?.(n, digital[n]);
    else engine.input?.(n, 1);
  }
  engine.inputs?.(digital, analog);
  updateOutputs();
  for (const [pin, value] of Object.entries(analog)) {
    const a = telemetry.analog[pin] ??= [];
    if (!a.includes(value)) a.push(value);
  }
  const serialEnd = serial.lastIndexOf("\n");
  const serialLine = serialEnd < 0 ? "" : serial.slice(serial.lastIndexOf("\n", serialEnd - 1) + 1, serialEnd).trim();
  const sample = { serialLine, adc: analog[14], outputs: { ...outputs }, buttons: {}, temperatures: {}, humidities: {}, servo: null, lcd: "" };
  for (const p of project.diagram.parts) {
    const el = elements.get(p.id)?.el;
    if (p.type === "wokwi-pushbutton") sample.buttons[p.id] = pressed(p.id);
    if (p.type === "wokwi-dht22") {
      sample.temperatures[p.id] = Number(p.attrs.temperature ?? 22);
      sample.humidities[p.id] = Number(p.attrs.humidity ?? 50);
    }
    if (p.type === "wokwi-servo") sample.servo = el?.angle;
    if (p.type === "wokwi-lcd1602") sample.lcd = el?.text || "";
  }
  const inputSignature = JSON.stringify([sample.adc, sample.buttons, sample.temperatures, sample.humidities]);
  if (telemetry.inputSignature !== inputSignature) {
    telemetry.inputSignature = inputSignature;
    telemetry.inputChangedAt = Date.now();
  }
  const signature = JSON.stringify(sample);
  if (Date.now() - telemetry.inputChangedAt >= 600 && telemetry.lastSample !== signature) {
    telemetry.samples.push(sample);
    if (telemetry.samples.length > 500) telemetry.samples.shift();
    telemetry.lastSample = signature;
  }
}
function event(d) {
  telemetry.events.push({ ...d });
  if (telemetry.events.length > 1500) telemetry.events.shift();
  if (d.type === "mode") telemetry.modes[d.pin] = d.value;
  if (d.type === "mode") {
    pinModes[d.pin] = d.value;
    updateInputs();
  }
  if (d.type === "servo") {
    const reach = graph(), b = board();
    for (const p of project.diagram.parts.filter((p2) => p2.type === "wokwi-servo")) if (isPowered(p,reach) && reach(p.id + ":PWM").has(b.id + ":" + d.pin)) elements.get(p.id).el.angle = d.value;
  }
  if (d.type === "lcd") {
    const reach = graph(), b = board();
    for (const p of project.diagram.parts.filter((p2) => p2.type === "wokwi-lcd1602")) {
      const names = ["RS", "E", "D4", "D5", "D6", "D7"];
      if (isPowered(p,reach) && names.every((n, i) => reach(p.id + ":" + n).has(b.id + ":" + d.pins[i]))) elements.get(p.id).el.text = d.text.replace(/\n/g, "");
    }
  }
  if (d.type === "tone") {
    const reach = graph(), b = board();
    const connected = project.diagram.parts.some((p) => p.type === "wokwi-buzzer" && reach(p.id + ":1").has(b.id + ":" + d.pin) && netValue(reach(p.id + ":2")) === 0);
    if (!connected) return;
    oscillators[d.pin]?.stop();
    delete oscillators[d.pin];
    if (d.hz && audio) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      gain.gain.value = 0.05;
      osc.frequency.value = d.hz;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      oscillators[d.pin] = osc;
    }
  }
}

/* ───────────── run control ───────────── */
function updateBadge() {
  const b = board(), name = catalog.find(c => c.type === b?.type)?.name || 'Нет платы';
  $('#editorBoard').textContent = name;
  const badge = $('#engineBadge');
  badge.classList.toggle('firmware', !!firmware);
  badge.innerHTML = firmware
    ? `${icon('chip')}<span>${esc(firmware.name)}</span>${icon('x', 'badge-x')}`
    : `<span>${b?.type === 'wokwi-pi-pico' ? 'RP2040 · нужна UF2' : b && BOARDS_RUNNABLE.includes(b.type) ? 'Учебный Arduino API' : 'Только схема'}</span>`;
  badge.title = firmware ? 'Выгрузить прошивку и вернуться к коду из редактора' : 'Режим выполнения';
}
function setRunUi(on) {
  $('#run').classList.toggle('running', on);
  $('#run').innerHTML = on ? `${icon('stop')}<span>Стоп</span>` : `${icon('play')}<span>Запустить</span>`;
  $('#simState').textContent = on ? 'Симуляция идёт' : 'Готов к запуску';
  $('.status-pill').classList.toggle('live', on);
  $('#canvas').classList.toggle('live', on);
}
async function start() {
  if (running) { stop(); return; }
  if (tab === 'diagram') { switchTab('code'); if (tab === 'diagram') return; }
  const b = board();
  if (!b) { toast('Добавьте плату'); return; }
  if (!BOARDS_RUNNABLE.includes(b.type)) { openSupport(); return; }
  if (b.type === 'wokwi-pi-pico' && !firmware) { toast('Для Pico загрузите UF2-прошивку кнопкой «Прошивка»'); return; }
  if (firmware && (firmware.kind === 'uf2') !== (b.type === 'wokwi-pi-pico')) { toast('Формат прошивки не подходит к этой плате', 'error'); return; }
  const diagnostics=powerCheck(project.diagram,b),panel=$('#circuitDiagnostics');
  panel.hidden=!diagnostics.short&&!diagnostics.unpowered.length;
  panel.textContent=diagnostics.short?'Короткое соединение питания с GND. Исправьте провода перед запуском.':diagnostics.unpowered.length?'Нет питания: '+diagnostics.unpowered.join(', ')+'. Подключите питание и GND.':'';
  if(diagnostics.short){toast(panel.textContent,'error');return;}
  cancelWire(); setError(null);
  outputs = {}; pinModes = {}; serial = '';
  telemetry = freshTelemetry(); telemetry.started = true;
  telemetry.signature = JSON.stringify({code: project.code, diagram: signatureDiagram(project.diagram)});
  showConsole();
  running = true; started = Date.now();
  setRunUi(true);
  $('#timer').textContent = '00:00.0';
  if (project.diagram.parts.some(p => p.type === 'wokwi-buzzer')) { try { audio ??= new AudioContext(); await audio.resume(); } catch {} }
  const callbacks = {
    pin(p, v) {
      outputs[p] = v;
      const a = telemetry.pins[p] ??= [];
      if (a.at(-1) !== v) { telemetry.edges.push({pin:p,value:v,at:performance.now()}); if(telemetry.edges.length>512)telemetry.edges.shift(); a.push(v); if (a.length > 150) a.shift(); telemetry.frames.push({...outputs}); if (telemetry.frames.length > 600) telemetry.frames.shift(); }
    },
    serial(t) { serial = (serial + t).slice(-30000); telemetry.serial = serial; if (consoleTab === 'serial') showConsole(); },
    error(s, line) {
      telemetry.error = s;
      log('Ошибка' + (line ? ` (строка ${line})` : '') + ': ' + s);
      stop();
      if (tab !== 'code') switchTab('code');
      setError(s, line ?? null);
    },
    event
  };
  try {
    engine = firmware ? (firmware.kind === 'hex' ? runAVR(firmware.data, callbacks) : runPico(firmware.data, callbacks)) : runEducational(project.code, callbacks);
    log(firmware ? 'Запущена прошивка ' + firmware.name : 'Запуск скетча в учебном режиме Arduino API.');
    updateInputs();
    tick = setInterval(() => {
      const t = Date.now() - started;
      $('#timer').textContent = `${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')}.${Math.floor(t % 1000 / 100)}`;
      updateInputs();
    }, 40);
  } catch (e) { callbacks.error(e.message, e.line); }
}
function stop() {
  heldButtons.clear();
  const was = running;
  running = false;
  engine?.stop(); engine = null;
  clearInterval(tick);
  for (const o of Object.values(oscillators)) try { o.stop(); } catch {}
  oscillators = {};
  setRunUi(false);
  outputs = {};
  updateOutputs();
  if (was) { log('Симуляция остановлена.'); if (!$('#inspector').hidden && selected) inspect(selected); }
}

/* ───────────── panels & dialogs ───────────── */
function renderLibraries() {
  $("#libraryPanel").innerHTML = `<h3>Библиотеки проекта</h3><p class="note">В учебном режиме доступны упрощённые API Servo, LiquidCrystal и DHT. Остальные библиотеки можно включить в прошивку через локальный компилятор.</p>${["Servo", "LiquidCrystal", "DHT sensor library"].map((name) => `<div class="library-row"><div><b>${name}</b><small>Учебная модель API · не полная реализация</small></div><span class="badge">Встроено</span></div>`).join("")}<h3>Для локальной компиляции</h3><div id="libraryList">${project.libraries.map((l, i) => `<div class="library-row">${esc(l)}<button data-remove-lib="${i}">✕</button></div>`).join("")}</div><form id="libraryForm"><input id="libraryName" class="search-input" placeholder="Название установленной Arduino-библиотеки"><button class="primary" style="margin-top:12px">Добавить в список</button></form>`;
  $("#libraryForm").onsubmit = (e) => {
    e.preventDefault();
    const n = $("#libraryName").value.trim();
    if (n && !project.libraries.includes(n)) {
      checkpoint('libraries');
      project.libraries.push(n);
      changed();
      renderLibraries();
    }
  };
  $$("[data-remove-lib]").forEach((b) => b.onclick = () => {
    checkpoint('libraries');
    project.libraries.splice(Number(b.dataset.removeLib), 1);
    changed();
    renderLibraries();
  });
}
function openSupport() {
  modal("Возможности этой версии", `<p>MicroLab — самостоятельная среда, вдохновлённая Wokwi. Полной совместимости пока нет. Компоненты с пометкой «только схема» можно соединять, но они не моделируют периферию.</p><p>Провод: щёлкните по двум выводам. Щелчок по проводу выбирает его, Delete удаляет, Ctrl+Z возвращает. Колесо меняет масштаб у курсора, фон можно перетаскивать. Tab / Shift+Tab меняют отступ, Ctrl+/ переключает комментарий, Ctrl+Enter запускает симуляцию.</p><table class="support-table"><tr><th>Платформа / режим</th><th>Что работает</th></tr><tr><td>Arduino Uno / Nano</td><td>AVR8js: HEX, GPIO, таймеры, UART, ADC</td></tr><tr><td>Учебный Arduino API</td><td>setup / loop, переменные, условия, циклы, GPIO, delay, Serial, Servo, LCD, DHT</td></tr><tr><td>Raspberry Pi Pico</td><td>RP2040js: загрузка UF2, GPIO, UART / USB CDC. Экспериментально, не все прошивки проверены</td></tr><tr><td>ESP32 / Arduino Mega</td><td>Размещение и соединение. Выполнение прошивок не подключено</td></tr><tr><td>Raspberry Pi с Linux</td><td>Не реализовано: нужен отдельный системный эмулятор</td></tr><tr><td>Электрическая модель</td><td>Цифровые цепи; нет расчёта токов, напряжений и повреждений</td></tr></table><p><b>Управление:</b> вывод → вывод — провод; двойной щелчок по компоненту — свойства; по проводу — удаление. Перетаскивание фона — панорамирование. Колесо — масштаб.</p><p><kbd>Ctrl Enter</kbd> запуск / стоп &nbsp; <kbd>Ctrl S</kbd> сохранить &nbsp; <kbd>Ctrl Z</kbd> отменить схему &nbsp; <kbd>Delete</kbd> удалить &nbsp; <kbd>Esc</kbd> отменить провод</p><p>Проект сохраняется в этом браузере. Экспортируйте JSON для переноса. При импорте Wokwi поддерживаются перечисленные компоненты; форма проводов строится заново.</p><p>Открытые компоненты: <a href="https://github.com/wokwi/avr8js" target="_blank">AVR8js</a>, <a href="https://github.com/wokwi/rp2040js" target="_blank">RP2040js</a>, <a href="https://github.com/wokwi/wokwi-elements" target="_blank">Wokwi Elements</a>. <a href="licenses.txt" target="_blank">Лицензии</a>.</p>`, "СПРАВКА И СОВМЕСТИМОСТЬ");
}
function loadExample(e) {
  stop(); checkpoint('project'); firmware = null;
  project = {name: e.title, code: e.code, libraries: [], diagram: {version: 1, author: 'MicroLab', editor: 'microlab', parts: [{type: 'wokwi-arduino-uno', id: 'uno', left: 120, top: 210, attrs: {}}, ...structuredClone(e.parts)], connections: structuredClone(e.connections)}};
  selected = null; renderAll(); if ($('#modal').open) $('#modal').close(); changed();
  toast(`Открыт пример «${e.title}» · Ctrl+Z — вернуть прежний проект`);
}
function openExamples() {
  modal('Начните с эксперимента', `<p>Текущий проект можно вернуть через <kbd>Ctrl</kbd> <kbd>Z</kbd>.</p><div class="example-list">` + examples.map((e, i) => `<button class="example-card" data-example="${i}"><span class="example-icon">${icon(e.icon)}</span><div><strong>${esc(e.title)}</strong><small>${esc(e.desc)}</small></div>${icon('arrow')}</button>`).join('') + '</div>', 'ГОТОВЫЕ ПРОЕКТЫ');
  $$('[data-example]').forEach(b => b.onclick = () => loadExample(examples[Number(b.dataset.example)]));
}
let compilerStatus = null;
if (isLocal) fetch('/api/status').then(r => r.json()).then(s => { compilerStatus = s; $('#compile').classList.toggle('unavailable', !s.compiler); if (!s.compiler) $('#compile').title = 'Arduino CLI не найден — нажмите, чтобы узнать, как установить'; }).catch(() => {});
function compilerHelp() {
  modal('Нужен Arduino CLI', `<p>Сборка настоящей прошивки выполняется на вашем компьютере. MicroLab не нашёл <code>arduino-cli</code>.</p>
  <div class="note"><b>Самый простой путь:</b> установите <a href="https://www.arduino.cc/en/software" target="_blank" rel="noopener">Arduino IDE 2</a>, откройте её один раз и установите платы «Arduino AVR Boards». MicroLab найдёт встроенный в неё компилятор автоматически.</div>
  <p>Или установите <a href="https://arduino.github.io/arduino-cli/latest/installation/" target="_blank" rel="noopener">Arduino CLI</a> и выполните:</p>
  <pre class="solution-code">arduino-cli core update-index\narduino-cli core install arduino:avr</pre>
  <p>Затем перезапустите MicroLab (закройте окно сервера и снова запустите Start). Без компилятора доступны учебный режим и загрузка готовых HEX.</p>`, 'ЛОКАЛЬНАЯ СБОРКА');
}
async function compileLocal(button) {
  if (!isLocal) { toast('Компиляция доступна в локальной версии — инструкция в архиве'); return; }
  if (compilerStatus && !compilerStatus.compiler) { compilerHelp(); return; }
  const b = board();
  if (!b || !['wokwi-arduino-uno', 'wokwi-arduino-nano'].includes(b.type)) { toast('Локальная сборка поддерживает Arduino Uno и Nano'); return; }
  if (tab === 'diagram') { switchTab('code'); if(tab === 'diagram')return; }
  stop();
  const sourceSignature=JSON.stringify({code:project.code,board:b.type});
  const label = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = `${icon('hammer')}<span>Сборка…</span>`; }
  log('Сборка через Arduino CLI…');
  try {
    const resp = await fetch('/api/compile', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: project.code, board: b.type, libraries: project.libraries})});
    const data = await resp.json();
    if (!resp.ok) throw Error(data.error);
    if(sourceSignature!==JSON.stringify({code:project.code,board:board()?.type}))throw Error('Код или плата изменились во время сборки. Запустите сборку ещё раз.');
    firmware = {kind: 'hex', name: 'sketch.hex', data: data.hex};
    updateBadge();
    log(data.log?.trim() || 'Сборка завершена.');
    toast('Прошивка собрана — запускаю', 'success');
    start();
  } catch (e) {
    const m = /sketch\.ino:(\d+):\d+:\s*error:\s*([^\n]+)/.exec(e.message);
    if (m) setError(m[2], Number(m[1]));
    log(e.message); consoleTab = 'logs'; $$('[data-console]').forEach(x => x.classList.toggle('active', x.dataset.console === 'logs')); showConsole();
    toast('Сборка не удалась — подробности в журнале', 'error');
  } finally { if (button) { button.disabled = false; button.innerHTML = label; } }
}
function settings() {
  modal('Настройки симуляции', `<div class="settings-row"><label>Цвет нового провода</label><div class="swatches">${['#2f9e74', '#d24d4d', '#2b2f33', '#3d7dd8', '#e0a030', '#9a5cd0'].map(c => `<button class="swatch ${c === wireColor ? 'active' : ''}" data-color="${c}" style="--c:${c}" aria-label="Цвет ${c}"></button>`).join('')}<input id="wireColor" type="color" value="${wireColor}" aria-label="Свой цвет"></div></div>
  <div class="settings-row"><label>Что запускать</label><div class="mode-cards"><button class="mode-card ${firmware ? '' : 'active'}" data-mode="api">${icon('code')}<b>Код из редактора</b><small>Учебный Arduino API в браузере</small></button><button class="mode-card ${firmware ? 'active' : ''}" data-mode="firmware">${icon('chip')}<b>Прошивка HEX / UF2</b><small>${firmware ? esc(firmware.name) : 'Загрузить файл'}</small></button></div></div>
  <div class="note">Для полного C++ с любыми библиотеками соберите прошивку в Arduino IDE («Скетч → Экспорт бинарного файла») и загрузите HEX. ${isLocal ? 'Либо используйте кнопку «Собрать HEX» — она вызывает Arduino CLI на этом компьютере.' : 'Либо скачайте локальную версию со службой Arduino CLI.'}</div>
  <div class="settings-actions"><button id="nativeBlink" class="btn outline">${icon('play')} Готовый Blink (HEX)</button>${isLocal ? `<button id="compileLocal" class="btn solid">${icon('hammer')} Собрать HEX</button>` : '<a class="btn solid" href="local-compiler.zip" download>' + icon('download') + ' Локальная версия</a>'}</div>`, 'ЛАБОРАТОРИЯ');
  const setColor = c => { wireColor = c; $$('.swatch').forEach(s => s.classList.toggle('active', s.dataset.color === c)); };
  $$('.swatch').forEach(s => s.onclick = () => setColor(s.dataset.color));
  $('#wireColor').oninput = e => setColor(e.target.value);
  $$('[data-mode]').forEach(b => b.onclick = () => {
    if (b.dataset.mode === 'api') { stop(); firmware = null; updateBadge(); $$('[data-mode]').forEach(x => x.classList.toggle('active', x === b)); toast('Запуск кода из редактора'); }
    else $('#firmwareInput').click();
  });
  $('#nativeBlink').onclick = async () => {
    try {
      const resp = await fetch('blink-uno.hex');
      if (!resp.ok) throw Error('Не удалось загрузить HEX');
      const hex = await resp.text();
      stop(); checkpoint('project');
      project = {name: 'Blink — нативная AVR-прошивка', code: blink, libraries: [], diagram: {version: 1, author: 'MicroLab', parts: [{type: 'wokwi-arduino-uno', id: 'uno', left: 160, top: 180, attrs: {}}], connections: []}};
      firmware = {kind: 'hex', name: 'blink-uno.hex', data: hex};
      renderAll(); changed(); $('#modal').close(); start();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#compileLocal') && ($('#compileLocal').onclick = () => { $('#modal').close(); compileLocal($('#compile')); });
}
function transform() { $('#world').style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`; $('#zoomValue').textContent = Math.round(zoom * 100) + '%'; }
function zoomAt(z, x, y) {
  viewTouched = true;
  z = Math.max(.3, Math.min(2.5, z));
  if (x === undefined) { const r = $('#canvas').getBoundingClientRect(); x = r.width / 2; y = r.height / 2; }
  pan.x = x - (x - pan.x) * z / zoom; pan.y = y - (y - pan.y) * z / zoom; zoom = z; transform();
}
function fit() {
  const parts = project.diagram.parts, rect = $('#canvas').getBoundingClientRect();
  if (!parts.length || !rect.width) return;
  const bounds = parts.map(p => { const w = elements.get(p.id)?.wrap; return {x: p.left, y: p.top, w: w?.offsetWidth || 120, h: (w?.offsetHeight || 80) + 22}; });
  const minX = Math.min(...bounds.map(b => b.x)), minY = Math.min(...bounds.map(b => b.y));
  const maxX = Math.max(...bounds.map(b => b.x + b.w)), maxY = Math.max(...bounds.map(b => b.y + b.h));
  const padX = 60, padTop = 64, padBottom = 64;
  zoom = Math.max(.3, Math.min(1.3, (rect.width - padX * 2) / (maxX - minX), (rect.height - padTop - padBottom) / (maxY - minY)));
  pan = {x: (rect.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: padTop + (rect.height - padTop - padBottom - (maxY - minY) * zoom) / 2 - minY * zoom};
  viewTouched = false;
  transform();
}
function download(name, data) {
  const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderAll() { if(!projectBases.has(projectKey()))projectBases.set(projectKey(),localStorage.getItem(projectKey())); cancelWire(); serial='';logs=[];showConsole();$('#timer').textContent='00:00.0';setError(null);$('#projectName').value = project.name; tab = 'code'; selectedWire = null; switchTab('code'); renderParts(); $('#inspector').hidden = true; }

/* ───────────── wiring up the DOM ───────────── */
hydrateIcons();
const code = $('#code');
code.addEventListener('input', () => { if(tab === 'diagram') changed(); if (tab === 'code') { project.code = code.value; changed(); if (!$('#editorError').hidden) setError(null); } updateCode(); cursor(); });
code.addEventListener('scroll', syncScroll);
code.addEventListener('keydown', editorKeys);
code.addEventListener('click', cursor); code.addEventListener('keyup', cursor);
$$('[data-tab]').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
$$('[data-console]').forEach(b => b.onclick = () => { consoleTab = b.dataset.console; $$('[data-console]').forEach(x => x.classList.toggle('active', x === b)); showConsole(); });
$('#clearConsole').onclick = () => { if (consoleTab === 'serial') serial = ''; else logs = []; showConsole(); };
$('#serialForm').onsubmit = e => {
  e.preventDefault();
  if (!engine) { toast('Сначала запустите симуляцию'); return; }
  const text = $('#serialInput').value;
  engine.serial?.(text + $('#lineEnding').value);
  $('#serialInput').value = '';
};
$('#projectName').oninput = e => { project.name = e.target.value; changed(); };
$('#save').onclick = () => { if(save(true))toast('Проект сохранён на этом устройстве', 'success'); };
$('#versions').onclick=versionsDialog;
$('#run').onclick = start;
$('#restart').onclick = () => { stop(); start(); };
$('#help').onclick = openSupport;
$('#examples').onclick = openExamples;
$('#settings').onclick = settings;
$('#compile').hidden = !isLocal;
$('#compile').onclick = e => compileLocal(e.currentTarget);
$('#engineBadge').onclick = () => { if (firmware) { stop(); firmware = null; updateBadge(); toast('Прошивка выгружена — запускается код из редактора'); } else settings(); };
$('#closeModal').onclick = () => $('#modal').close();
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) $('#modal').close(); });
$('#export').onclick = () => {
  if (tab === 'diagram') { switchTab('code'); if (tab === 'diagram') return; }
  const name = (project.name || 'microlab-project').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'microlab-project';
  download(name + '.json', JSON.stringify(project, null, 2));
  toast('Проект экспортирован', 'success');
};
$('#import').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > 2e6) throw Error('Файл слишком большой');
    const {project: p, warnings} = validate(JSON.parse(await f.text()));
    stop(); checkpoint('project'); project = p; firmware = null; selected = null; renderAll(); changed();
    toast(warnings.length ? `Импортировано, ${warnings.length} элемент(ов) пропущено` : 'Проект импортирован', warnings.length ? '' : 'success');
    if (warnings.length) log('Импорт: ' + warnings.join('; '));
  } catch (err) { toast(err instanceof SyntaxError ? 'Файл не является корректным JSON' : err.message, 'error'); }
  e.target.value = '';
};
$('#firmware').onclick = () => $('#firmwareInput').click();
$('#firmwareInput').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > 8e6) throw Error('Слишком большая прошивка');
    const lower = f.name.toLowerCase(), kind = lower.endsWith('.hex') ? 'hex' : lower.endsWith('.uf2') ? 'uf2' : null;
    if (!kind) throw Error('Нужен файл .hex или .uf2');
    stop();
    firmware = {kind, name: f.name, data: kind === 'hex' ? await f.text() : await f.arrayBuffer()};
    updateBadge();
    if ($('#modal').open) $('#modal').close();
    toast('Загружено: ' + f.name + ' · нажмите «Запустить»', 'success');
  } catch (err) { toast(err.message, 'error'); }
  e.target.value = '';
};
$('#zoomIn').onclick = () => zoomAt(zoom * 1.15);
$('#zoomOut').onclick = () => zoomAt(zoom / 1.15);
$('#fit').onclick = fit;
$('#canvas').addEventListener('wheel', e => {
  if (e.target.closest('#inspector')) return;
  e.preventDefault();
  const r = $('#canvas').getBoundingClientRect();
  zoomAt(zoom * (e.deltaY > 0 ? .9 : 1.1), e.clientX - r.left, e.clientY - r.top);
}, {passive: false});
$('#canvas').addEventListener('pointermove', e => {
  if (!pending) return;
  const a = endpoint(pending), b = worldPoint(e), p = $('#wirePreview');
  if (a && p) { p.setAttribute('d', route(a, b)); p.setAttribute('stroke', wireColor); }
});
$('#canvas').onpointerdown = e => {
  if (e.target.closest('button,.part,#inspector,.wire-hit')) return;
  if (pending) { cancelWire(); return; }
  select(null); $('#inspector').hidden = true;
  if (selectedWire !== null) { selectedWire = null; drawWires(); }
  const x = e.clientX, y = e.clientY, old = {...pan};
  $('#canvas').classList.add('panning');
  const move = ev => { viewTouched = true; pan = {x: old.x + ev.clientX - x, y: old.y + ev.clientY - y}; transform(); };
  const up = () => { $('#canvas').classList.remove('panning'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
};
/* ───────────── layout: window sizes, focus on code or circuit, fullscreen ───────────── */
const LAYOUT_KEY = 'microlab.layout';
let layout = {};
try { layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch { layout = {}; }
const saveLayout = () => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isColumn = () => getComputedStyle($('#labMain')).flexDirection === 'column';
function applyLayout() {
  $('.editor-pane').style.width = !isColumn() && layout.w ? layout.w + '%' : '';
  $('.console').style.height = layout.ch ? layout.ch + 'px' : '';
}
function drag(e, move) {
  if (e.button > 0) return;
  e.preventDefault();
  document.body.classList.add('resizing');
  const up = () => { document.body.classList.remove('resizing'); saveLayout(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function setWidth(pct) { layout.w = Math.round(clamp(pct, 15, 85) * 10) / 10; $('.editor-pane').style.width = layout.w + '%'; }
$('#splitter').onpointerdown = e => drag(e, ev => {
  const r = $('#labMain').getBoundingClientRect();
  if (isColumn()) $('.editor-pane').style.height = clamp((ev.clientY - r.top) / r.height * 100, 20, 80) + '%';
  else setWidth((ev.clientX - r.left) / r.width * 100);
});
$('#splitter').ondblclick = () => { delete layout.w; $('.editor-pane').style.width = $('.editor-pane').style.height = ''; saveLayout(); };
$('#splitter').onkeydown = e => {
  const d = {ArrowLeft: -5, ArrowRight: 5, ArrowUp: -5, ArrowDown: 5}[e.key];
  if (!d || isColumn()) return;
  e.preventDefault();
  setWidth((layout.w || $('.editor-pane').getBoundingClientRect().width / $('#labMain').getBoundingClientRect().width * 100) + d); saveLayout();
};
function setConsole(h) {
  const pane = $('.editor-pane').getBoundingClientRect();
  layout.ch = Math.round(clamp(h, 70, Math.max(70, pane.height - 200)));
  $('.console').style.height = layout.ch + 'px';
}
$('#consoleSplitter').onpointerdown = e => drag(e, ev => setConsole($('.editor-pane').getBoundingClientRect().bottom - ev.clientY));
$('#consoleSplitter').ondblclick = () => { delete layout.ch; $('.console').style.height = ''; saveLayout(); };
$('#consoleSplitter').onkeydown = e => {
  const d = {ArrowUp: 30, ArrowDown: -30}[e.key];
  if (!d) return;
  e.preventDefault(); setConsole($('.console').getBoundingClientRect().height + d); saveLayout();
};
// «Развернуть код» / «Развернуть схему»: второе окно прячется, повторное нажатие возвращает оба
function setFocus(mode) {
  $('#labMain').dataset.focus = mode;
  for (const [id, m, on, off] of [['#codeMax', 'code', 'Вернуть схему рядом с кодом', 'Развернуть код на всю ширину'], ['#simMax', 'sim', 'Вернуть код рядом со схемой', 'Развернуть схему на всю ширину']]) {
    const b = $(id), active = mode === m;
    b.innerHTML = icon(active ? 'shrink' : 'expand'); b.title = active ? on : off; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', active);
  }
}
$('#codeMax').onclick = () => setFocus($('#labMain').dataset.focus === 'code' ? '' : 'code');
$('#simMax').onclick = () => setFocus($('#labMain').dataset.focus === 'sim' ? '' : 'sim');
// «На весь экран»: прячем меню сайта и курса, окно браузера — на весь экран (если браузер разрешает)
const isFull = () => document.body.classList.contains('lab-full');
function setFull(on) {
  document.body.classList.toggle('lab-full', on);
  const b = $('#labFull');
  b.innerHTML = icon(on ? 'shrink' : 'expand') + `<span>${on ? 'Свернуть' : 'На весь экран'}</span>`;
  b.title = on ? 'Выйти из полноэкранного режима (Esc)' : 'Лаборатория на весь экран'; b.setAttribute('aria-pressed', on);
  const el = document.documentElement;
  if (on && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
$('#labFull').onclick = () => setFull(!isFull());
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && isFull()) setFull(false); });
window.addEventListener('hashchange', () => setTimeout(() => { if (isFull() && $('#labView').hidden) setFull(false); }));
window.addEventListener('resize', applyLayout);
applyLayout();
window.addEventListener('keydown', e => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;
  const inLab = !$('#labView').hidden;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if(save(true))toast('Сохранено', 'success'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && inLab) { e.preventDefault(); start(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing && inLab) { e.preventDefault(); undo(e.shiftKey); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !typing && inLab) { e.preventDefault(); undo(true); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !$('#modal').open && inLab) { e.preventDefault(); removeSelected(); }
  if (e.key === 'Escape' && isFull() && !$('#modal').open && !pending && $('#inspector').hidden && selected === null && selectedWire === null) setFull(false);
  if (e.key === 'Escape' && !$('#modal').open) {
    if (pending) cancelWire();
    else { $('#inspector').hidden = true; select(null); if (selectedWire !== null) { selectedWire = null; drawWires(); } }
  }
});
// Keep the whole circuit in view when the canvas changes size, unless the user moved the view.
new ResizeObserver(() => { if (!$('#labView').hidden && !viewTouched) fit(); }).observe($('#canvas'));

$('#labView').dataset.mobilePanel='code';
$$('#mobileLabTabs button').forEach(b=>b.onclick=()=>{
  $('#labView').dataset.mobilePanel=b.dataset.panel;
  $$('#mobileLabTabs button').forEach(x=>x.classList.toggle('active',x===b));
  if(b.dataset.panel==='circuit')requestAnimationFrame(fit);
});
document.addEventListener('microlab-rendered',()=>{
  const task=$('#mobileLabTabs [data-panel="task"]');task.disabled=!project.lessonId;
  if(!project.lessonId&&$('#labView').dataset.mobilePanel==='task')$('#mobileLabTabs [data-panel="code"]').click();
});
$('#canvasHint').textContent = HINT;
setRunUi(false);
renderAll(); transform(); showConsole();
log('MicroLab готов. «?» — справка и точный список возможностей.');

initAcademy({
  getProject: () => structuredClone(project), validate: p => validated(structuredClone(p)), getTelemetry: () => telemetry, isRunning: () => running,
  persist: save, stop, toast, createElement, support: openSupport, settings, addPart,
  signature: p => JSON.stringify({code: p.code, diagram: signatureDiagram(p.diagram)}),
  load(p) { if(!save(true))return false; stop(); checkpoint('project'); project = validated(structuredClone(p)); firmware = null; selected = null; cancelWire(); telemetry = freshTelemetry(); renderAll(); changed(); },
  fit: () => requestAnimationFrame(fit),
  setCode(code) { if(!commitDiagram())return; stop(); checkpoint('code'); project.code = code; firmware = null; switchTab('code'); telemetry = freshTelemetry(); changed(); }
});
