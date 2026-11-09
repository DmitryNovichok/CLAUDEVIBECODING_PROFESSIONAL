const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

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
