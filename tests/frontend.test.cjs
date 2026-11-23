const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function conditionLoader(fetcher, count = 60) {
  const tasks = Array.from({length:count}, (_,i) => ({id:'t'+i, n:5}));
  const timers = [];
  const c = vm.createContext({BANK:{lazyHtml:true}, byId:new Map(tasks.map(t=>[t.id,t])),
    fetch:fetcher, setTimeout:(fn,ms)=>{timers.push(ms); fn();}, Date});
  const source = fs.readFileSync('src/app/01-core.js','utf8');
  vm.runInContext(source.slice(source.indexOf('  const HTML_LAZY ='), source.indexOf('  /** Пока условие грузится')), c);
  return {tasks, timers, load:list=>c.loadHtml(list)};
}
function conditionsResponse(url) {
  const ids = new URL('https://example.invalid/'+url).searchParams.get('ids').split(',');
  return {ok:true, status:200, json:async()=>({html:Object.fromEntries(ids.map(id=>[id,'<p>'+id+'</p>']))})};
}
test('exam conditions load in bounded sequential batches with no whole-number prefetch', async()=>{
  const calls = []; let active=0, peak=0;
  const loader = conditionLoader(async url=>{
    calls.push(url); peak=Math.max(peak,++active);
    await Promise.resolve(); active--;
    return conditionsResponse(url);
  });
  await loader.load(loader.tasks.slice(0,27));
  assert.equal(calls.length,2);
  assert.equal(peak,1);
  assert.ok(calls.every(url=>new URL('https://e/'+url).searchParams.get('ids').split(',').length<=20));
  assert.ok(calls.every(url=>!url.includes('?n=')));
  assert.equal(loader.timers.length,0);
  assert.ok(loader.tasks.slice(0,27).every(t=>t.html));
  assert.ok(loader.tasks.slice(27).every(t=>t.html==null));
  await loader.load(loader.tasks.slice(0,27));
  assert.equal(calls.length,2);
});
test('overlapping condition requests and duplicate IDs are fetched once', async()=>{
  const calls=[];
  const loader=conditionLoader(async url=>{calls.push(url); return conditionsResponse(url);});
  await Promise.all([loader.load([loader.tasks[0],loader.tasks[0],loader.tasks[1]]),
    loader.load([loader.tasks[1],loader.tasks[2]])]);
  const ids=calls.flatMap(url=>new URL('https://e/'+url).searchParams.get('ids').split(','));
  assert.deepEqual(ids,['t0','t1','t2']);
});
test('429 stops retries and queued batches, while cached conditions remain usable', async()=>{
  let calls=0;
  const loader=conditionLoader(async()=>{calls++; return {ok:false,status:429,headers:{get:()=> '3600'}};});
  loader.tasks[0].html='<p>cached</p>';
  await assert.rejects(loader.load(loader.tasks), /приостановлена/);
  await assert.rejects(loader.load([loader.tasks[1]]), /60 мин/);
  await loader.load([loader.tasks[0]]);
  assert.equal(calls,1);
  assert.equal(loader.timers.length,0);
});
test('missing condition gives an actionable error instead of an infinite render loop', async()=>{
  const loader=conditionLoader(async()=>({ok:true,status:200,json:async()=>({html:{}})}));
  await assert.rejects(loader.load([loader.tasks[0]]), /Обновите страницу/);
  assert.equal(loader.tasks[0].html,undefined);
});
test('transient network failure retries, successful retry populates the condition', async()=>{
  let calls=0;
  const loader=conditionLoader(async url=>{if(++calls===1)throw Error('offline');return conditionsResponse(url);});
  await loader.load([loader.tasks[0]]);
  assert.equal(calls,2);
  assert.deepEqual(loader.timers,[700]);
  assert.equal(loader.tasks[0].html,'<p>t0</p>');
});
test('2.61 release notes contain no delivery policy details', ()=>{
  const c=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync('changelog.js','utf8'),c);
  for(const role of ['student','teacher']){
    const row=c.window.EGE_CHANGELOG[role].find(r=>r[0]==='2.61.0');
    assert.ok(row);
    assert.equal(JSON.stringify([row[2],row[3]]), '[[],["Техническое обновление"]]');
  }
});
test('help rewards distinguish historical payouts and implementation bonuses from base rates', () => {
  const rates = [['idea', '💡', 'Идея', 250], ['ux', '🎨', 'Удобство интерфейса', 500],
    ['done', '🚀', 'Бонус за реализацию', 100], ['critical', '🔥', 'Важная ошибка', 1000]];
  const ctx = vm.createContext({SERVER: true, student: {sid: 1}, TEACHER: false, RULES: {support_rewards: rates}, esc: String});
  vm.runInContext(sourceBetween('src/app/13c-hub.js', '  function hubPad()', '  function renderHub('), ctx);
  assert.match(ctx.hubPad(), /от 250 до 1000 ₿/);
  vm.runInContext(sourceBetween('admin.js', '  function spRewardHtml(', '  function supportHtml('), ctx);
  const buttons = ctx.spRewardHtml({id: 4}, {
    support_rewards: Object.fromEntries(rates.map(([kind, ...reward]) => [kind, reward])),
    support_given: {4: [{kind: 'idea', amount: 50}]}
  });
  assert.match(buttons, /data-sp-rw="idea" disabled[^>]*>[^<]*<b>✓ 50 ₿/);
  assert.match(buttons, /data-sp-rw="done"[^>]*>[^<]*<b>\+100 ₿/);
});
test('principal audit escapes account names and is never fetched for an ordinary teacher', async()=>{
  const box={innerHTML:''}; let calls=0;
  const c=vm.createContext({ME:{is_main:false}, $:()=>box, Date,
    esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    api:async()=>{calls++;return {events:[{name:'<img onerror=evil>',teacher_name:'<script>evil</script>',
      reason:'batch_size',last_ts:1000000,n:2,requested:80}]};}});
  vm.runInContext(sourceBetween('admin.js','  async function loadBankAudit()', '  async function loadErrors('),c);
  await c.loadBankAudit();
  assert.equal(calls,0);
  c.ME.is_main=true;
  await c.loadBankAudit();
  assert.equal(calls,1);
  assert.ok(box.innerHTML.includes('&lt;img'));
  assert.ok(!box.innerHTML.includes('<img'));
  assert.ok(!box.innerHTML.includes('<script>'));
});

function labModels() {
  const code = fs.readFileSync('src/app/12j-labs.js', 'utf8');
  const c = vm.createContext({});
  vm.runInContext(code.slice(code.indexOf('  function labNetwork('), code.indexOf('  const LAB_EXAMPLES')), c);
  return c;
}
test('IP laboratory handles every prefix without signed overflow', () => {
  const c = labModels();
  for (let p = 0; p <= 32; p++) {
    const n = c.labNetwork('192.168.1.130', p);
    assert.equal(n.count, 2 ** (32 - p));
    assert.ok(n.start <= n.ip && n.end >= n.ip);
    assert.equal(n.end - n.start + 1, n.count);
  }
  const n = c.labNetwork('192.168.1.130', 26);
  assert.equal(n.network, '192.168.1.128');
  assert.equal(n.last, '192.168.1.191');
  assert.equal(n.mask, '255.255.255.192');
  assert.equal(c.labNetwork('255.255.255.255', 0).last, '255.255.255.255');
  assert.equal(c.labNetwork('255.255.255.255', 32).count, 1);
  for (const ip of ['', '1.2.3', '1.2.3.256', '-1.2.3.4', '1e2.2.3.4', '<script>']) assert.throws(() => c.labNetwork(ip, 24));
  assert.throws(() => c.labNetwork('1.2.3.4', 24.5));
});
test('image laboratory rounds packed bits to bytes, validates dimensions', () => {
  const c = labModels();
  assert.equal(c.labImageSize(1, 1, 1).bytes, 1);
  assert.equal(c.labImageSize(3, 3, 1).bytes, 2);
  assert.equal(c.labImageSize(640, 480, 8).bytes, 307200);
  assert.equal(c.labImageSize(8192, 8192, 24).bytes, 201326592);
  for (const args of [[0,1,8], [1,1,25], [1.5,1,8], [9000,1,8], [NaN,1,8]]) assert.throws(() => c.labImageSize(...args));
});
test('game laboratory stops at victory, including an overshooting move', () => {
  const c = labModels();
  assert.equal(c.labGameMoves(7,30,2,2)[0].value, 9);
  assert.equal(c.labGameMoves(7,30,2,2)[1].value, 14);
  assert.equal(c.labGameMoves(30,30,2,2).length, 0);
  assert.equal(c.labGameMoves(199,200,1,5)[1].value, 995);
  assert.equal(c.labGameMoves(995,200,1,5).length, 0);
  assert.throws(() => c.labGameMoves(7,30,2,1));
});

function bankRetryContext(storage, bank) {
  const box = {innerHTML:''}, timers = [], button = {};
  let reloads = 0;
  const c = vm.createContext({window:{EGE_BANK:bank}, sessionStorage:storage,
    $:s=>s === '#trainer' ? box : button, location:{reload:()=>reloads++},
    setTimeout:(fn,ms)=>timers.push({fn,ms})});
  vm.runInContext(sourceBetween('src/app/01-core.js', '  function bankRetry(', '  const BANK ='), c);
  return {c, box, timers, button, reloads:()=>reloads};
}

test('empty task bank stops after three automatic reloads', () => {
  const data = new Map(), storage = {getItem:k=>data.get(k), setItem:(k,v)=>data.set(k,v), removeItem:k=>data.delete(k)};
  for (let attempt=0; attempt<4; attempt++) {
    const page = bankRetryContext(storage, {tasks:[]});
    vm.runInContext('bankRetry(true)', page.c);
    if (attempt<3) {
      assert.equal(page.timers.length, 1);
      assert.equal(page.timers[0].ms, 2000 * 2 ** attempt);
      page.timers[0].fn();
      assert.equal(page.reloads(), 1);
    } else {
      assert.equal(page.timers.length, 0);
      assert.match(page.box.innerHTML, /Обновить страницу/);
      page.button.onclick();
      assert.equal(data.has('egeTrainer.bankTry'), false);
    }
  }
  data.set('egeTrainer.bankTry', '2');
  bankRetryContext(storage, {tasks:[{id:'demo'}]});
  assert.equal(data.has('egeTrainer.bankTry'), false);
});

test('blocked browser storage cannot trigger endless bank reloads', () => {
  for (const denied of ['getItem', 'setItem']) {
    const storage = {getItem:()=>null, setItem:()=>{}, removeItem:()=>{}};
    storage[denied] = () => { throw Error('storage denied'); };
    const page = bankRetryContext(storage, null);
    vm.runInContext('bankRetry(true)', page.c);
    for (const timer of page.timers) timer.fn();
    assert.equal(page.reloads(), 0);
    assert.match(page.box.innerHTML, /Обновить страницу/);
  }
});

test('Together closes a socket that stops replying to pings', () => {
  let tick, now=1000, closed=0;
  const sent=[];
  const c=vm.createContext({ws:{readyState:1,close:()=>closed++}, pingTs:0, pongAt:0,
    performance:{now:()=>now},send:m=>sent.push(m),setInterval:fn=>{tick=fn;}});
  vm.runInContext(sourceBetween('together.js', '  setInterval(() => {\n    if (!ws', '  function onMsg('), c);
  tick();
  for (now=4000; now<=13000; now+=3000) tick();
  assert.ok(closed>0, 'a stalled connection must reconnect');
  assert.equal(sent.length,1, 'retain the first unanswered ping deadline');
});

test('Together keeps a responsive socket open', () => {
  let tick, now=1000, closed=0;
  const sent=[];
  const c=vm.createContext({ws:{readyState:1,close:()=>closed++}, pingTs:0, pongAt:0,
    performance:{now:()=>now},send:m=>sent.push(m),setInterval:fn=>{tick=fn;}});
  vm.runInContext(sourceBetween('together.js', '  setInterval(() => {\n    if (!ws', '  function onMsg('), c);
  for (; now<20000; now+=3000) { tick(); c.pongAt=now+20; }
  assert.equal(closed,0);
  assert.equal(sent.length,7);
});

test('Together read-only mode prevents deleting selected board text', () => {
  let keydown;
  const strokes=new Map([['text',{id:'text'}]]), sent=[];
  const c=vm.createContext({TS:{id:'text'}, S:{strokes,page:'p1'}, canWrite:()=>false,
    document:{addEventListener:(_,fn)=>{keydown=fn;}}, selectText:()=>{}, redraw:()=>{}, send:m=>sent.push(m)});
  vm.runInContext(sourceBetween('together.js', "  document.addEventListener('keydown', e => {                // Delete", '  // ---------- указатели'),c);
  keydown({key:'Delete',target:{closest:()=>null},preventDefault:()=>{}});
  assert.equal(strokes.has('text'),true);
  assert.equal(sent.length,0);
});

// Run the production helpers in a small browser-like environment.
const examSource = fs.readFileSync('src/app/05-exam.js', 'utf8');
const completionSource = examSource.slice(examSource.indexOf('  const examKeys'), examSource.indexOf('  const saveExam'));
function examContext(tasks, ans) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const c = vm.createContext({ byId, EX: { ans }, shapeOf: t => t.sh || { type: 'single' } });
  vm.runInContext(completionSource, c);
  return id => vm.runInContext(`answeredItem({id: ${JSON.stringify(id)}})`, c);
}

test('a 19–21 group needs every part', () => {
  const tasks = [{ id:'group', parts:[{id:'p19'}, {id:'p20'}, {id:'p21'}] }];
  const ans = { p19:{answer:'1'}, p20:{answer:''} };
  const complete = examContext(tasks, ans);
  assert.equal(complete('group'), false);
  ans.p20 = {answer:'2'}; ans.p21 = {answer:'3'};
  assert.equal(complete('group'), true);
});

test('fixed-size answers require every cell; zero is a valid answer', () => {
  const ans = { x:{answer:'0', cells:['0','']} };
  const complete = examContext([{id:'x', sh:{type:'grid',rows:1,cols:2}}], ans);
  assert.equal(complete('x'), false);
  ans.x = {answer:'0 2', cells:['0','2']};
  assert.equal(complete('x'), true);
});

test('variable-length tables allow trailing empty rows, but not a half row', () => {
  const ans = { x:{answer:'1 2', cells:['1','2','','','','']} };
  const complete = examContext([{id:'x', sh:{type:'grid',rows:10,cols:2}}], ans);
  assert.equal(complete('x'), true);
  ans.x.cells[2] = '3';
  assert.equal(complete('x'), false);
});

test('teacher drafts are isolated across accounts and reused IDs', () => {
  const source = fs.readFileSync('admin.js','utf8');
  const block = source.slice(source.indexOf('  const bldKey'), source.indexOf('  const rankDots'));
  const storage = new Map([['egeAdmin.bldDraft', JSON.stringify({title:'legacy private',tasks:[]})]]);
  const c = vm.createContext({ ME:{id:10,created:100}, localStorage:{
    getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k)
  } });
  vm.runInContext(block, c);
  vm.runInContext("bldLoad(); BLD.d.title='teacher one'; BLD.d.tasks=[{id:'synthetic'}]; bldSave();", c);
  c.ME = {id:11,created:200}; vm.runInContext('bldLoad()',c);
  assert.equal(vm.runInContext('BLD.d.title',c),'');
  assert.equal(vm.runInContext('BLD.d.tasks.length',c),0);
  c.ME = {id:10,created:100}; vm.runInContext('bldLoad()',c);
  assert.equal(vm.runInContext('BLD.d.title',c),'teacher one');
  c.ME = {id:10,created:300}; vm.runInContext('bldLoad()',c);
  assert.equal(vm.runInContext('BLD.d.title',c),'');
});

function sourceBetween(file, start, end) {
  const source = fs.readFileSync(file, 'utf8');
  const pos = source.indexOf(start);
  assert.ok(pos >= 0 && source.indexOf(end, pos) > pos);
  return source.slice(pos, source.indexOf(end, pos));
}

test('assigned work is ordered by deadline, then started work, without mutating input', () => {
  const c = vm.createContext({});
  vm.runInContext(sourceBetween('src/app/12-sets.js', '  function asgOrder(', '  function asgDueBadge('), c);
  c.items = [{id:1,created:100}, {id:2,due:400,created:90}, {id:3,due:200}, {id:4,score:{tried:1}}, {id:5,due:400,started:1}];
  assert.equal(vm.runInContext('items.slice().sort(asgOrder).map(x => x.id).join(",")', c), '3,5,2,4,1');
  assert.equal(c.items[0].id, 1);
});

test('closed work has no urgent badge, tomorrow uses a calendar day', () => {
  const now = new Date(2026,10,8,23,30).getTime();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const c = vm.createContext({Date:Clock,asgFinished:a=>!!a.closed});
  vm.runInContext(sourceBetween('src/app/12-sets.js', '  function asgDueBadge(', '  let asgTab'), c);
  c.a = {due:(now+3600000)/1000};
  assert.match(vm.runInContext('asgDueBadge(a)',c),/Сдать завтра/);
  c.a.closed = now/1000;
  assert.equal(vm.runInContext('asgDueBadge(a)',c),'');
  c.a = {due:(now-60000)/1000};
  assert.match(vm.runInContext('asgDueBadge(a)',c),/Срок прошёл/);
});

test('slow builder search does not overwrite a newer filter result', async () => {
  const pending = [], rendered = [];
  const c = vm.createContext({URLSearchParams,BLD:{page:0,f:{n:[],c:[],r:[],bank:[],q:'old'}},
    api:()=>new Promise(resolve=>pending.push(resolve)),toast:()=>{},renderBldFilters:()=>{},
    renderBldList:()=>rendered.push(c.BLD.res.total)});
  vm.runInContext(sourceBetween('admin.js','  let bldSearchVersion','  function renderBldList()'),c);
  const old = vm.runInContext('bldSearch()',c);
  c.BLD.f.q = 'new';
  const fresh = vm.runInContext('bldSearch()',c);
  pending[1]({total:2}); await fresh;
  pending[0]({total:1}); await old;
  assert.deepEqual(rendered,[2]);
  assert.equal(c.BLD.res.total,2);
});

test('closed practice is finished and does not absorb later training', () => {
  const c = vm.createContext({P:{log:[{id:'second',s:1,t:3000}]},partToGroup:new Map(),byId:new Map()});
  vm.runInContext(sourceBetween('src/app/12-sets.js','  function asgLeft','  async function loadAssignments'),c);
  c.a = {tasks:['first','second'],done:['first'],created:1,closed:2,score:{final:true}};
  assert.equal(vm.runInContext('asgLeft(a).length',c),1);
  assert.equal(vm.runInContext('asgFinished(a)',c),true);
});

test('homework game progress requires all questions and ignores exam answers', () => {
  const c=vm.createContext({P:{log:[{id:'p19',s:1,t:2000},{id:'plain',s:1,t:2000,x:1}]},
    partToGroup:new Map([['p19','game'],['p20','game']]),byId:new Map([['game',{parts:[{id:'p19'},{id:'p20'}]}]])});
  vm.runInContext(sourceBetween('src/app/12-sets.js','  function asgLeft','  async function loadAssignments'),c);
  c.a={tasks:['game','plain'],done:[],created:1};
  assert.equal(vm.runInContext('asgLeft(a).length',c),2);
  c.P.log.push({id:'p20',s:1,t:2500});
  assert.equal(vm.runInContext('asgLeft(a).length',c),1);
});

test('practice answer markers keep the result at closing time', () => {
  const c=vm.createContext({P:{log:[{id:'late',t:3000,s:1}]}});
  vm.runInContext(sourceBetween('src/app/12-sets.js','  function pkFirst(a)', '  function pkState('),c);
  c.a={created:1,closed:2,score:{items:{early:0.5,late:null}}};
  assert.equal(vm.runInContext('pkFirst(a).has("late")',c),false);
  assert.equal(vm.runInContext('pkFirst(a).get("early")',c),0.5);
});

test('assignment due labels use calendar days and exact expiry', () => {
  const now = new Date(2026, 10, 8, 12).getTime();
  class Clock extends Date { static now() { return now; } }
  const c = vm.createContext({Date:Clock,pad2:x=>String(x).padStart(2,'0'),plural:()=> 'дня'});
  vm.runInContext(sourceBetween('src/app/12-sets.js',"  const WD =",'  /** Карточка практической'),c);
  for (const [due,word] of [[now+3600000,'сегодня'],[now+13*3600000,'завтра'],[now-60000,'срок прошёл']]) {
    c.a = {created:now/1000-86400,due:due/1000};
    assert.match(vm.runInContext('apDates(a,null,false)',c),new RegExp(word));
  }
});

test('late Together search cannot overwrite the selected assignment tab', async () => {
  const nodes = {'#tgPickL':{innerHTML:''},'#tgPickQ':{value:''}};
  const requests=[];
  const c = vm.createContext({$:s=>nodes[s],S:{pages:[]},SID:1,esc:String,
    adminGet:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject}))});
  vm.runInContext("let pickKind='recent', pickAsg=0, pickVersion=0;",c);
  vm.runInContext(sourceBetween('together.js','  async function loadPick()',"  $('#tgPickL').addEventListener"),c);
  const first=vm.runInContext('loadPick()',c);
  const last=vm.runInContext("pickKind='sets'; loadPick()",c);
  requests[1].resolve({sets:[{id:2,title:'Нужная подборка',class_name:'Демо',tasks:1,created:1}]});
  await last;
  requests[0].resolve({tasks:[{id:'old',label:'5',snip:'Устаревшее задание'}]});
  await first;
  assert.match(nodes['#tgPickL'].innerHTML,/Нужная подборка/);
  assert.doesNotMatch(nodes['#tgPickL'].innerHTML,/Устаревшее/);
});

test('late archive filter cannot restore the previous class', async () => {
  const nodes={'#arcClass':{value:'1'},'#arcQ':{value:''},'#arcBody':{innerHTML:''}};
  const requests=[];
  const c=vm.createContext({$:s=>nodes[s],classes:[{id:1,name:'Демо А'},{id:2,name:'Демо Б'}],esc:String,
    api:()=>new Promise(resolve=>requests.push(resolve)),fmtDate:String,toast:()=>{},ARC_KIND:{self:'Самостоятельная'}});
  vm.runInContext('let arcVersion=0;',c);
  vm.runInContext(sourceBetween('admin.js','  async function loadArchive()',"  $('#arcQ').addEventListener"),c);
  const first=vm.runInContext('loadArchive()',c);
  nodes['#arcClass'].value='2';
  const last=vm.runInContext('loadArchive()',c);
  const item=(id,title)=>({id,ids:[id],title,class_name:title,tasks:1,kind:'self',created:1});
  requests[1]({items:[item(2,'Демо Б')]}); await last;
  requests[0]({items:[item(1,'Демо А')]}); await first;
  assert.match(nodes['#arcBody'].innerHTML,/Демо Б/);
  assert.doesNotMatch(nodes['#arcBody'].innerHTML,/Демо А/);
});

test('builder ignores pupils and assignments loaded for an earlier class', async () => {
  const requests=[];
  const c=vm.createContext({BLD:{d:{class_id:'1'}},renderBldDraft:()=>{},
    api:url=>new Promise(resolve=>requests.push({url,resolve}))});
  vm.runInContext('let bldLoadVersion=0;',c);
  vm.runInContext(sourceBetween('admin.js','  async function loadBldAsg()', '  function renderBldDraft()'),c);
  const first=vm.runInContext('loadBldAsg()',c);
  const last=vm.runInContext("BLD.d.class_id='2'; loadBldAsg()",c);
  requests[2].resolve({assignments:[{id:2}]});requests[3].resolve({students:[{id:2,name:'Макетов Второй'}]});await last;
  requests[0].resolve({assignments:[{id:1}]});requests[1].resolve({students:[{id:1,name:'Макетов Первый'}]});await first;
  assert.equal(c.BLD.members[0].id,2);
  assert.equal(c.BLD.asg[0].id,2);
});

test('double send creates one assignment and preserves a newer draft', async () => {
  let handler;
  const requests=[];
  const c=vm.createContext({BLD:{d:{class_id:'1',id:null,title:'Старая',kind:'practice',tasks:[{id:'test'}],students:[],to:'class'},cat:{classes:[{id:1,name:'Демо'}]}},
    $:()=>({addEventListener:(_,h)=>{handler=h;}}),toast:()=>{},kindChangeOk:()=>true,grades:()=>({}),
    bldSave:()=>{},renderBldDraft:()=>{},loadBldAsg:()=>{},renderBldList:()=>{},
    api:()=>new Promise(resolve=>requests.push(resolve))});
  vm.runInContext('let bldSending=false;',c);
  vm.runInContext(sourceBetween('admin.js',"  $('#bldDraft').addEventListener('click'",'  // ------------------------------------------------------------ прогресс курса'),c);
  const event={target:{closest:s=>s==='#bdSend'?{}:null}};
  const first=handler(event), second=handler(event);
  c.BLD.d.title='Новый черновик';
  const count=requests.length;
  for(const resolve of requests)resolve({id:42});
  await Promise.all([first,second]);
  assert.equal(count,1);
  assert.equal(c.BLD.d.title,'Новый черновик');
});
test('two-heap lab uses total, changes one heap and keeps four command choices', () => {
  const c = labModels();
  const moves = c.labGamePositionMoves([17, 29], 133, 4, 2);
  assert.equal(moves.length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(moves.map(m => m.value))), [[21,29],[34,29],[17,33],[17,58]]);
  assert.equal(c.labGamePositionMoves([60,73],133,4,2).length,0);
  assert.equal(c.labGamePositionMoves([7],13,2,2)[1].value[0],14);
  assert.throws(() => c.labGamePositionMoves([1,0],133,4,2));
  assert.throws(() => c.labGamePositionMoves([1,2,3],133,4,2));
});
test('checking an active beginner task preserves code that has not been autosaved yet', () => {
  const source = fs.readFileSync('src/app/12b-pycourse.js','utf8');
  const task = {id:'m01.example',practice:{stdin:'7\n',starter:'# start'}};
  const editor={value:'print(14)',dispatchEvent(){}}, input={value:'custom input'};
  const c=vm.createContext({pycTask:()=>task,pyOpen:()=>true,PY:{task:{id:'pyc:m01.example'}},
    PYC_L:{n:0,l:1,level:{tasks:[task]}},pycPyTask:()=>({id:'pyc:m01.example'}),pycLabel:()=>'',
    pySync(){},readCode:()=>null,$:id=>id==='#pyCode'?editor:input,Event:class{}});
  c.appState = c;
  vm.runInContext(source.slice(source.indexOf('  function pycOpenPy('),source.indexOf('  async function pycCheck(')),c);
  c.pycOpenPy(task.id);
  assert.equal(editor.value,'print(14)');assert.equal(input.value,'custom input');
  c.pycOpenPy(task.id,'print(99)');assert.equal(editor.value,'print(99)');
});
test('leaving a lesson lab detaches its draft; loading a protected lab keeps the return context', () => {
  const code=fs.readFileSync('src/app/12j-labs.js','utf8'); let callback, saved=0;
  const c=vm.createContext({MutationObserver:class{constructor(fn){callback=fn}observe(){}},trainerEl:{},labActive:()=>false,labStop(){},
    pageKind:'lab',courseShown:true,LAB:{context:{task:'m01.example'},owner:'student'},labSaveDraft(){saved++},
    document:{body:{classList:{remove(){}}}},$:()=>({classList:{remove(){}}})});
  c.appState = c;
  vm.runInContext(code.slice(code.indexOf('  new MutationObserver'),code.indexOf("  window.addEventListener('pagehide'")),c);
  callback();assert.equal(c.LAB.context.task,'m01.example');assert.equal(saved,0);
  c.pageKind='pyc';callback();assert.equal(saved,1);assert.equal(c.LAB.context,null);assert.equal(c.LAB.owner,null);
  callback();assert.equal(saved,1);
});

function hubHistoryContext() {
  const microtasks = [], traversals = [], entries = [{v:'hub'}], rendered = [];
  let at = 0, observer, pop, hidden = true;
  const modal = {};
  Object.defineProperty(modal, 'hidden', {get:()=>hidden, set:v=>{hidden=v; microtasks.push(()=>observer());}});
  const clone = x => JSON.parse(JSON.stringify(x));
  const history = {get state(){return entries[at];},
    pushState:s=>{entries.splice(++at); entries.push(clone(s));},
    replaceState:s=>{entries[at]=clone(s);}, back:()=>traversals.push(-1)};
  const c = vm.createContext({history, navSilent:false, $:()=>modal,
    hubNav:()=>true, queueMicrotask:fn=>microtasks.push(fn),
    MutationObserver:class {constructor(cb){observer=cb;} observe(){}},
    window:{addEventListener:(_,cb)=>{pop=cb;}}, closeForecast:()=>{modal.hidden=true;},
    examShown:false, courseShown:true, inCourseSet:()=>false,
    openHub:()=>rendered.push('hub'), openCourse:()=>rendered.push('course'),
    openLesson:n=>rendered.push('lesson:'+n), leaveCourse:()=>rendered.push('leave'), next:()=>rendered.push('task')});
  vm.runInContext(sourceBetween('src/app/03-forecast-course.js', '  function navPush(', '  function inCourseSet('), c);
  const hub = fs.readFileSync('src/app/13c-hub.js','utf8');
  const start = hub.indexOf('  let hubModalState');
  vm.runInContext(hub.slice(start,hub.indexOf('  // ------------------------------------------------------------ рядом',start)),c);
  vm.runInContext(sourceBetween('src/app/03-forecast-course.js', "  window.addEventListener('popstate'", '  let COURSE_OK'),c);
  const flush = () => {let i=0;while(microtasks.length){assert.ok(++i<50);microtasks.shift()();}};
  const go = delta => {at+=delta;assert.ok(at>=0 && at<entries.length);pop({state:history.state});flush();};
  return {c,modal,history,rendered,traversals,entries,flush,go,
    navigate:s=>c.navPush(s), open:()=>{modal.hidden=false;flush();}, close:()=>{modal.hidden=true;flush();},
    settle:()=>{while(traversals.length)go(traversals.shift());}};
}

test('hub modal Back preserves its page and Forward restores the window', () => {
  const h=hubHistoryContext();h.open();
  assert.equal(h.history.state.v,'modal');const id=h.history.state.id;
  h.go(-1);
  assert.equal(h.modal.hidden,true);
  assert.deepEqual(h.rendered,[], 'closing an overlay must not restart a task');
  h.go(1);
  assert.equal(h.modal.hidden,false);
  assert.equal(h.history.state.id,id);
  assert.deepEqual(h.rendered,['hub']);
  assert.equal(h.entries.length,2,'restoring does not push another window');
});

test('navigation from a modal replaces it and Back returns to the hub', () => {
  const h=hubHistoryContext();h.open();
  h.modal.hidden=true;h.navigate({v:'course'});h.flush();
  assert.deepEqual(h.entries.map(x=>x.v),['hub','course']);
  assert.deepEqual(h.traversals,[]);
  h.go(-1);assert.deepEqual(h.rendered,['hub']);
});

test('trainer navigation in a mutation observer wins over closing the modal', () => {
  const h=hubHistoryContext();h.open();h.modal.hidden=true;
  // The modal observer runs first, then the trainer observer, then the queued close.
  h.c.queueMicrotask(()=>h.navigate({v:'main'}));h.flush();
  assert.equal(h.history.state.v,'main');assert.deepEqual(h.traversals,[]);
  h.go(-1);assert.deepEqual(h.rendered,['hub']);
});

test('a delayed navigation survives the browser pending Back event', () => {
  const h=hubHistoryContext();h.open();h.close();
  assert.deepEqual(h.traversals,[-1]);
  h.navigate({v:'lesson',n:5});h.settle();
  assert.deepEqual(h.entries.map(x=>x.v),['hub','lesson']);
  assert.deepEqual(h.rendered,[],'the action already rendered its destination');
  h.go(-1);assert.deepEqual(h.rendered,['hub']);
});

test('another modal opened while Back is pending retains the original page', () => {
  const h=hubHistoryContext();h.open();h.close();h.open();h.settle();
  assert.equal(h.history.state.v,'modal');
  assert.equal(h.history.state.base.v,'hub');
  h.go(-1);assert.equal(h.modal.hidden,true);
  assert.deepEqual(h.rendered,[]);
});

test('jumping over a modal restores the target route, including Forward', () => {
  const h=hubHistoryContext();h.navigate({v:'course'});h.open();
  h.go(-2);assert.deepEqual(h.rendered,['hub']);assert.equal(h.modal.hidden,true);
  h.go(2);assert.deepEqual(h.rendered,['hub','course']);assert.equal(h.modal.hidden,false);
});

function hubPlanContext() {
  const c=vm.createContext({SERVER:false,student:null,DAILY_STATE:'loading',dailyNotice:()=> 'Загружаем задание…',ASG:[], asgOrder:()=>0, DAILY:null, hubWeakNums:()=>[],
    hubDueCount:()=>0, fireNeed:()=>3, hubTodayCount:()=>0, hubMins:()=>'',
    numLabel:n=>String(n), plural:()=>'', fmtMs:()=>'', viewPrefs:()=>({focus:false})});
  vm.runInContext(sourceBetween('src/app/13c-hub.js', '  function hubPlan()', '  // ------------------------------------------------------------ разделы'),c);
  return c;
}

test('daily challenge completion requires an accepted result, not merely opening it', () => {
  const c=hubPlanContext();
  for(const daily of [{ready:true,n:5},{ready:true,n:5,started:123},{ready:true,n:5,started:123,fast:true}]) {
    c.DAILY=daily;const item=c.hubPlan().find(x=>x.key==='daily');
    assert.equal(item.done,false);
    assert.equal(item.btn,daily.started?'Рейтинг':'Решить');
  }
  c.DAILY={ready:true,n:5,started:123,my_place:2,mine:20000};
  assert.equal(c.hubPlan().find(x=>x.key==='daily').done,true);
});

test('Focus mode removes game objectives from the hub plan', () => {
  const c=hubPlanContext();c.DAILY={ready:true,n:5};c.duelCalls=()=>[{id:1,opponent:'Макетов Пример'}];
  assert.ok(c.hubPlan().some(x=>x.ic==='daily'));
  c.viewPrefs=()=>({focus:true});
  assert.ok(c.hubPlan().length>0);
  assert.ok(c.hubPlan().every(x=>!['daily','duel','fire'].includes(x.ic)));
});

const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject}; };
function answerRaceContext() {
  const pending=deferred(), finished=[];
  const task=id=>({task:{id},answers:[],shape:{},started:1,parts:[],why:{type:'new'}});
  const c=vm.createContext({cur:task('old'),busy:false,wkTask:()=>false,readAnswer:()=>['12'],
    autoAttach:()=>{},verify:()=>pending.promise,cellsIn:()=>[], $:()=>({}),thinkLeft:()=>0,
    finish:()=>finished.push(c.cur.task.id),runParts:()=>pending.promise,
    readAnswerIn:()=>['3'],partBox:()=>({}),partFinal:()=>finished.push(c.cur.task.id)});
  vm.runInContext(sourceBetween('src/app/02-trainer.js','  async function check()','  // ---- подсказки по шагам'),c);
  vm.runInContext(sourceBetween('src/app/02-trainer.js','  async function giveUp()','  // ---- задания 19'),c);
  vm.runInContext(sourceBetween('src/app/02-trainer.js','  async function checkGroup()','  function taskLinks('),c);
  return {c,pending,finished,task};
}
test('late answer or reveal response cannot finish another task, including a reopened ID', async()=>{
  for(const method of ['check','giveUp'])for(const id of ['new','old']) {
    const h=answerRaceContext();const request=h.c[method]();h.c.cur=h.task(id);
    h.pending.resolve({correct:true,final:true,score:1});await request;
    assert.deepEqual(h.finished,[]);assert.deepEqual(h.c.cur.answers,[]);
  }
});
test('late grouped answers cannot affect a different single task',async()=>{
  for(const method of ['checkGroup','giveUpGroup']) {
    const h=answerRaceContext();h.c.cur.group=true;h.c.cur.parts=[{p:{id:'part19'},shape:{},answers:[]}];
    const request=h.c[method]();h.c.cur=h.task('new');
    h.pending.resolve([{correct:true,final:true,score:1}]);await request;
    assert.deepEqual(h.finished,[]);assert.equal(h.c.cur.done,undefined);
  }
});
test('finishing an old request does not unlock a newer submission',async()=>{
  const pending=deferred(),old={task:{id:'old'}},c=vm.createContext({cur:old,busy:false,
    $$:()=>[],thinkLeft:()=>0,callCheck:()=>pending.promise});
  vm.runInContext(sourceBetween('src/app/02-trainer.js','  function setBusy(','  // ---- ответ скрыт'),c);
  const request=c.verify({});assert.equal(c.busy,true);
  c.cur={task:{id:'new'}};c.busy=true;pending.resolve({correct:true});
  assert.equal(await request,null);assert.equal(c.busy,true);
});
test('teacher profile keeps the latest student after reversed response order',async()=>{
  const responses=new Map(),rendered=[];
  const c=vm.createContext({st:null,studentLoadVersion:0,$:()=>({value:'0'}),
    api:path=>{const r=deferred();responses.set(path.split('&')[0],r);return r.promise;},
    go:()=>{},renderStudent:()=>rendered.push(c.st.student.id),toast:()=>{}});
  vm.runInContext(sourceBetween('admin.js','  async function openStudent(', '  $(\'#stPeriod\').addEventListener'),c);
  const first=c.openStudent(1),second=c.openStudent(2);
  responses.get('student?id=2').resolve({student:{id:2}});await second;
  responses.get('student?id=1').resolve({student:{id:1}});await first;
  assert.deepEqual(rendered,[2]);assert.equal(c.st.student.id,2);
  const third=c.openStudent(3);c.studentLoadVersion++;
  responses.get('student?id=3').resolve({student:{id:3}});await third;assert.deepEqual(rendered,[2]);
});
function assignmentLoadContext() {
  const requests=[];
  const c=vm.createContext({SERVER:true,student:{sid:1},ASG:[{id:'saved'}],ASG_IN_CLASS:true,ASG_ERROR:false,asgLoadVersion:0,
    api:()=>{const r=deferred();requests.push(r);return r.promise;},
    renderAsgCard:()=>{},renderAsgPage:()=>{},hubRefresh:()=>{},wkLive:()=>false,asgNotices:()=>{},noticesLoad:()=>{}});
  vm.runInContext(sourceBetween('src/app/12-sets.js','  function resetAssignments()', '  const fmtDay'),c);
  vm.runInContext(sourceBetween('src/app/12-sets.js','  async function loadAssignments()', '  /** Напоминания'),c);
  return {c,requests};
}
test('assignment network errors retain the last known work and recover',async()=>{
  const h=assignmentLoadContext();const first=h.c.loadAssignments();h.requests[0].reject(Error('offline'));await first;
  assert.equal(h.c.ASG[0].id,'saved');assert.equal(h.c.ASG_ERROR,true);assert.equal(h.c.ASG_IN_CLASS,true);
  const second=h.c.loadAssignments();h.requests[1].resolve({assignments:[{id:'fresh'}],in_class:true});await second;
  assert.equal(h.c.ASG[0].id,'fresh');assert.equal(h.c.ASG_ERROR,false);
});
test('assignment refresh rejects old responses and never keeps another account work',async()=>{
  const h=assignmentLoadContext();const first=h.c.loadAssignments(),second=h.c.loadAssignments();
  h.requests[1].resolve({assignments:[{id:'new'}]});await second;h.requests[0].resolve({assignments:[{id:'old'}]});await first;
  assert.equal(h.c.ASG[0].id,'new');
  const third=h.c.loadAssignments();h.c.student={sid:2};h.c.resetAssignments();
  h.requests[2].resolve({assignments:[{id:'private-old-account'}]});await third;
  assert.equal(h.c.ASG.length,0);
});
test('fully entered strict work stays pending until it is submitted',()=>{
  const c=vm.createContext({asgLeft:()=>[]});
  vm.runInContext(sourceBetween('src/app/12-sets.js','  function asgFinished(','  // Срок —'),c);
  assert.equal(vm.runInContext('asgPending({strict:true})',c),true);
  assert.equal(vm.runInContext('asgPending({strict:true,finished:123})',c),false);
  assert.equal(vm.runInContext('asgPending({strict:false})',c),false);
  const h=hubPlanContext();h.ASG=[{id:1,title:'Демо',strict:true,tasks:['a'],done:['a']}];
  h.asgPending=()=>true;h.asgLeft=()=>[];
  const item=h.hubPlan()[0];assert.equal(item.key,'asg:1');assert.equal(item.btn,'Завершить');
});
test('daily training has a finite goal and the plan can reach 100 percent',()=>{
  const c=hubPlanContext();c.hubTodayCount=()=>4;
  assert.equal(c.hubPlan().find(x=>x.key==='training').done,false);
  c.hubTodayCount=()=>5;
  assert.ok(c.hubPlan().every(x=>x.done));
  c.hubWeakNums=()=>[5];
  assert.equal(c.hubPlan().find(x=>x.key==='training').done,true);
});

test('assignment submission stops when its task changes during attachment or confirmation',async()=>{
  for(const stage of ['solution','confirmation']) {
    const pending=deferred(),entered=deferred(),effects=[];
    const c=vm.createContext({cur:{task:{id:'old'},shape:{},started:1},wkTask:()=>({id:7}),
      readAnswer:()=>['12'],cellsIn:()=>[],$:()=>({}),esc:String,
      autoAttach:async()=>stage==='confirmation',
      api:()=>{entered.resolve();return pending.promise;},
      wkAsk:()=>{effects.push('ask');entered.resolve();return pending.promise;},
      togglePy:()=>effects.push('python'),toast:()=>{},setBusy:()=>effects.push('submit')});
    vm.runInContext(sourceBetween('src/app/12-sets.js','  async function wkSubmit()', '  async function wkRefresh('),c);
    const request=c.wkSubmit();await entered.promise;c.cur={task:{id:'new'}};
    pending.resolve(stage==='solution'?{code:'print(1)'}:'extra');await request;
    assert.deepEqual(effects,stage==='solution'?[]:['ask']);
  }
});
test('an accepted assignment answer does not lock a new task after navigation',async()=>{
  const pending=deferred(),entered=deferred(),a={id:7};
  const c=vm.createContext({cur:{task:{id:'old'},shape:{},started:1},wkTask:()=>a,
    readAnswer:()=>['12'],cellsIn:()=>[],$:()=>({}),esc:String,
    autoAttach:async()=>true,wkAsk:async()=>true,
    api:()=>{entered.resolve();return pending.promise;},setBusy:()=>{},
    wkApply:(work,r)=>{work.done=r.done;}});
  vm.runInContext(sourceBetween('src/app/12-sets.js','  async function wkSubmit()', '  async function wkRefresh('),c);
  const request=c.wkSubmit();await entered.promise;c.cur={task:{id:'new'}};
  pending.resolve({done:['old']});await request;
  assert.equal(c.cur.done,undefined);assert.deepEqual(a.done,['old']);
});
test('moving a student captures the selected destination and never changes another profile',async()=>{
  for(const field of ['#stClass','#stTeacher']) {
    const pending=deferred(),handlers={},requests=[],rendered=[];
    const elements=Object.fromEntries(['#stTeacher','#stClass','#backBtn'].map(id=>[id,{value:'7',addEventListener:(event,fn)=>handlers[id]=fn}]));
    const old={id:1,class_id:2,teacher_id:3},fresh={id:2,class_id:9,teacher_id:4};
    const c=vm.createContext({st:{student:old},tab:'student',studentLoadId:1,studentMoves:new Set(),
      teachers:[{id:7,name:'Макетов Учитель'}],confirm:()=>true,$:id=>elements[id],
      api:(path,body)=>{requests.push({path,body});return pending.promise;},
      fetchClasses:async()=>{},renderStudent:()=>rendered.push(c.st.student.id),toast:()=>{}});
    vm.runInContext(sourceBetween('admin.js','  const studentCurrent =','  let jFilter'),c);
    vm.runInContext(sourceBetween('admin.js',"  $('#stTeacher').addEventListener",'  function renderStudent()'),c);
    const event={target:elements[field]},request=handlers[field](event);
    await handlers[field](event);assert.equal(requests.length,1);
    c.st={student:fresh};event.target.value='99';pending.resolve({});await request;
    assert.equal(old[field==='#stClass'?'class_id':'teacher_id'],7);
    assert.deepEqual(fresh,{id:2,class_id:9,teacher_id:4});assert.deepEqual(rendered,[]);
    assert.equal(c.studentMoves.size,0);
  }
});
test('void preview cannot carry an old student date range into another profile or reopened panel',async()=>{
  for(const change of ['student','panel','pendingStudent']) {
    const pending=deferred(),button={disabled:false,isConnected:true};let handler,draws=0;
    const elements={'#stVoid':{addEventListener:(event,fn)=>handler=fn},'#voidFrom':{value:'100'},'#voidTo':{value:'200'}};
    const c=vm.createContext({st:{student:{id:1}},tab:'student',studentLoadId:1,voidOpen:true,voidPrev:null,
      $:id=>elements[id],api:()=>pending.promise,dtTs:Number,toast:()=>{},stVoidRender:()=>draws++});
    vm.runInContext(sourceBetween('admin.js','  const studentCurrent =','  let jFilter'),c);
    vm.runInContext(sourceBetween('admin.js',"  $('#stVoid')?.addEventListener", "  $('#stNoRank').addEventListener"),c);
    const request=handler({target:{closest:selector=>selector==='#voidPreview'?button:null}});
    if(change==='student')c.st={student:{id:2}};else if(change==='pendingStudent')c.studentLoadId=2;else button.isConnected=false;
    pending.resolve({n:3});await request;
    assert.equal(c.voidPrev,null);assert.equal(draws,0);
  }
});
test('teacher student list ignores the previous filter response',async()=>{
  const requests=[],scope={value:'none'},draws=[];
  const c=vm.createContext({studentsLoadVersion:0,students:[],classes:[{id:1}],$:()=>scope,
    api:path=>{const r=deferred();requests.push({path,...r});return r.promise;},
    renderStudents:()=>draws.push(c.students.map(x=>x.id)),toast:()=>{}});
  vm.runInContext(sourceBetween('admin.js','  async function loadStudents()', '  function renderStudents()'),c);
  const first=c.loadStudents();scope.value='all';const second=c.loadStudents();
  requests[1].resolve({students:[{id:2}]});await second;
  requests[0].resolve({students:[]});await first;
  assert.equal(c.students[0].id,2);assert.equal(draws.length,1);
});

test('daily and duel tiles keep their slots before data arrives and after a failed refresh',()=>{
  const nodes={};const c=vm.createContext({SERVER:true,student:{sid:1},TEACHER:false,DAILY:null,DAILY_STATE:'loading',
    P:{log:[]},ASG:[],asgPending:()=>false,GAME:{coins:0},EX:null,LAB_OK:true,ARD_OK:false,IM_OK:false,IM_PW:false,TOUR:null,prefs:{fav:[]},
    hubMastered:()=>'',hubMap:()=>'',hubWeekBars:()=>'',dailyNotice:()=> 'Загружаем задание…',
    numLabel:String,plural:()=>'',viewPrefs:()=>({focus:false}),$:id=>nodes[id]||{hidden:true,textContent:'вызови соперника'}});
  for(const id of ['#labCard','#pycCard','#coinCard'])nodes[id]={hidden:false};
  vm.runInContext(sourceBetween('src/app/13c-hub.js','  function hubTiles()', '  function hubMastered()'),c);
  const initial=Array.from(c.hubTiles(),x=>x.k);
  assert.ok(initial.includes('daily'));assert.ok(initial.includes('duel'));
  assert.equal(c.hubTiles().find(x=>x.k==='duel').name,'Дуэли');                 // турниры выключены — плитка только про дуэли
  c.TOUR={tours:true};assert.equal(c.hubTiles().find(x=>x.k==='duel').name,'Дуэли и турниры');c.TOUR=null;
  c.DAILY={ready:true,n:5,started:null};c.DAILY_STATE='ready';
  assert.deepEqual(Array.from(c.hubTiles(),x=>x.k),initial);
  c.DAILY=null;c.DAILY_STATE='error';
  assert.deepEqual(Array.from(c.hubTiles(),x=>x.k),initial);
  assert.equal(c.hubTiles().find(x=>x.k==='daily').btn,'Повторить загрузку');
  c.viewPrefs=()=>({focus:true});assert.ok(c.hubTiles().every(x=>!['daily','duel'].includes(x.k)));
  c.viewPrefs=()=>({focus:false});c.TEACHER=true;assert.ok(c.hubTiles().every(x=>x.k!=='duel'));
});
test('unloaded daily task reserves a plan row without blocking completed goals',()=>{
  const c=hubPlanContext();c.SERVER=true;c.student={sid:1};c.hubTodayCount=()=>5;
  const plan=c.hubPlan();assert.equal(plan.find(x=>x.key==='daily').pending,true);
  assert.ok(plan.filter(x=>!x.pending).every(x=>x.done));
  c.DAILY={ready:true,n:5};
  assert.equal(c.hubPlan().find(x=>x.key==='daily').pending,false);
});
test('daily refresh keeps accepted data on failure and rejects old account responses',async()=>{
  const requests=[],c=vm.createContext({SERVER:true,student:{sid:1},renderDailyCard:()=>{},
    api:()=>{const r=deferred();requests.push(r);return r.promise;}});
  vm.runInContext(sourceBetween('src/app/10-levels-league.js','  let DAILY =', '  const fmtMs'),c);
  const first=c.loadDaily();requests[0].resolve({ready:true,n:5,my_place:1});await first;
  const second=c.loadDaily();requests[1].reject(Error('offline'));await second;
  assert.equal(vm.runInContext('DAILY.my_place',c),1);assert.equal(vm.runInContext('DAILY_STATE',c),'error');
  const third=c.loadDaily();c.student={sid:2};c.resetDaily();requests[2].resolve({ready:true,my_place:9});await third;
  assert.equal(vm.runInContext('DAILY',c),null);
  const fourth=c.loadDaily(),fifth=c.loadDaily();requests[4].resolve({ready:true,n:6});await fifth;
  requests[3].resolve({ready:true,n:5});await fourth;assert.equal(vm.runInContext('DAILY.n',c),6);
});

function bugLabContext() {
  const nodes = new Map(), workers = [], timers = new Map();
  let timerId=0, apiResolve, apiReject, apiCalls=0;
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector,{value:'print(1)',disabled:false,hidden:false,textContent:'',innerHTML:'',scrollIntoView(){}});
    return nodes.get(selector);
  };
  class Worker {
    constructor() { workers.push(this); this.terminated=false; }
    postMessage(m) { this.message=m; }
    terminate() { this.terminated=true; }
    emit(data) { this.onmessage({data}); }
  }
  const c=vm.createContext({$,EgePythonWorker:Worker,student:{sid:1},RULES:{},LAB:{view:'bugs'},labActive:()=>true,
    codeKey:id=>'code:'+id,readJSON:()=>null,writeJSON:()=>{},
    trainerEl:{addEventListener(){}},window:{addEventListener(){}},MutationObserver:class{observe(){}},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
    api:()=>{apiCalls++;return new Promise((resolve,reject)=>{apiResolve=resolve;apiReject=reject})},
    plural:()=>'',esc:String,safeHtml:String});
  c.appState = c;
  vm.runInContext(fs.readFileSync('src/app/12k-buglab.js','utf8'),c);
  vm.runInContext(`BUG.cases=[{id:'one',code:'print(1)',tests:[{in:'',open:true}],my:{},hints:[]}];BUG.cur='one';
    bugRenderHints=()=>{};bugRenderResult=()=>{};bugRenderList=()=>{};bugRenderCase=()=>{};`,c);
  return {c,$,workers,timers,apiCalls:()=>apiCalls,resolve:r=>apiResolve(r),reject:e=>apiReject(e)};
}
test('bug lab blocks duplicate checks during Python loading and server verification', async()=>{
  const x=bugLabContext();
  const check=x.c.bugCheck();
  await x.c.bugCheck();
  assert.equal(x.workers.length,1);
  assert.equal(x.$('#bugOwnRun').disabled,true);
  x.workers[0].emit({type:'test',i:0,result:{out:'1'}});
  x.workers[0].emit({type:'tests-done'});
  await Promise.resolve();
  assert.equal(x.apiCalls(),1);
  await x.c.bugCheck();
  assert.equal(x.workers.length,1,'server response is still pending');
  x.resolve({ok:true,my:{ok:1,star:1},tests:[],changed:1,par:1});
  await check;
  assert.equal(x.$('#bugCode').disabled,false);
});
test('bug lab ignores an old verification after stop and restart of the same exercise', async()=>{
  for (const fail of [false,true]) {
    const x=bugLabContext(), old=x.c.bugCheck();
    x.workers[0].emit({type:'test',i:0,result:{out:'1'}});x.workers[0].emit({type:'tests-done'});
    await Promise.resolve();
    x.c.bugStop();
    const next=x.c.bugCheck();
    if(fail)x.reject(Error('old request failed'));else x.resolve({ok:true,my:{ok:1},tests:[],changed:1,par:1});
    await old;
    assert.equal(x.$('#bugCode').disabled,true);
    assert.equal(vm.runInContext('BUG.cases[0].my.ok',x.c),undefined);
    assert.equal(x.workers[1].terminated,false);
    x.c.bugStop();await next;
  }
});
test('stopping bug lab settles its promise and ignores late worker errors',async()=>{
  const x=bugLabContext();
  const run=x.c.bugRunAll('while True: pass',['']);
  const stopped=assert.rejects(run,/stopped/);
  x.c.bugStop();await stopped;
  const next=x.c.bugRunAll('print(1)',['']);
  x.workers[0].onerror();
  assert.equal(x.workers[1].terminated,false);
  x.workers[1].emit({type:'test',i:0,result:{out:'1'}});x.workers[1].emit({type:'tests-done'});
  assert.equal((await next)[0].out,'1');
});
test('bug lab marks only the stalled test as timed out and the rest as unstarted',async()=>{
  const x=bugLabContext();
  const run=x.c.bugRunAll('while True: pass',['','','']);
  x.workers[0].emit({type:'tests-start'});
  [...x.timers.values()].find(t=>t.ms===12000).fn();
  const results=await run;
  assert.deepEqual(Array.from(results,r=>r.skipped),[false,true,true]);
});
test('bug lab never installs previous pupil progress from a delayed response',async()=>{
  const x=bugLabContext();
  vm.runInContext('BUG.cases=null;BUG.owner=1;',x.c);
  const pending=x.c.bugLabInit();
  x.c.student={sid:2};x.c.resetBugLab();
  x.resolve({cases:[{id:'private-old',my:{ok:1}}]});await pending;
  assert.equal(vm.runInContext('BUG.cases',x.c),null);
  assert.equal(vm.runInContext('BUG.cur',x.c),null);
});
test('admin.js and app.js do not declare the same function twice in one scope', () => {
  // повторное объявление молча заменяет первую функцию — так однажды сломался вход в панель учителя
  for (const f of ['admin.js', 'app.js']) {
    const names = {};
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^  (?:async )?function (\w+)\(/gm)) names[m[1]] = (names[m[1]] || 0) + 1;
    assert.deepEqual(Object.entries(names).filter(([, n]) => n > 1), [], f);
  }
});

test('independent bug verification submits code once without running browser Python', async()=>{
  const x=bugLabContext();
  const pending=x.c.bugVerify();
  await x.c.bugVerify();
  assert.equal(x.apiCalls(),1);assert.equal(x.workers.length,0);
  assert.equal(x.$('#bugVerify').disabled,true);assert.equal(x.$('#bugStop').hidden,true);
  x.resolve({ok:true,verified:true,provenance:'server_python',my:{ok:1,verified:true},tests:[],changed:1});
  await pending;
  assert.equal(vm.runInContext('BUG.cases[0].my.verified',x.c),true);
  assert.equal(x.$('#bugVerify').disabled,false);
});
test('unavailable verifier preserves prior progress and reports no new award',async()=>{
  const x=bugLabContext();
  const pending=x.c.bugVerify();x.reject(Error('Независимая проверка временно недоступна. Результат не засчитан.'));
  await pending;
  assert.equal(vm.runInContext('BUG.cases[0].my.verified',x.c),undefined);
  assert.match(x.$('#bugStatus').textContent,/не засчитан/);assert.equal(x.$('#bugCode').disabled,false);
});
test('independent verification rejects unconfirmed and old-account responses',async()=>{
  for (const switched of [false,true]) {
    const x=bugLabContext(),pending=x.c.bugVerify();
    if(switched)x.c.student={sid:2};
    x.resolve({ok:true,verified:switched,provenance:switched?'server_python':'self_check',my:{ok:1,verified:true}});
    await pending;
    assert.equal(vm.runInContext('BUG.cases[0].my.verified',x.c),undefined);
  }
});
