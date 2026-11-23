const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const loader = fs.readFileSync('src/app/12l-learning-loader.js', 'utf8');
const built = execFileSync('python3',['-c','from tools.build_app import build_learning; print(build_learning())'],{encoding:'utf8'});
const methods = 'openCourse openLesson openCourseSet openPyc openPycLevel openLab openArdGate pycStopTests labStop pycDockTools resetLearningState refreshLearningAccess'.split(' ');
function harness() {
  const scripts=[], opened=[], retries=[], timers=new Map(), nodes=new Map();let tick=0;
  const node = id => {if(!nodes.has(id)) nodes.set(id,{innerHTML:'',value:'',textContent:'',hidden:false,
    classList:{add(){},remove(){},toggle(){}},focus(){},addEventListener(){}});return nodes.get(id);};
  const trainer = {innerHTML:'',addEventListener(){},querySelector:()=>({addEventListener:(_event,cb)=>retries.push(cb)})};
  const c = vm.createContext({Promise,Error,console,
    window:{scrollTo(){},addEventListener(){}},MutationObserver:class{observe(){}},
    document:{currentScript:{dataset:{learningSrc:'app-learning.js?v=fingerprint'}},querySelectorAll:()=>[],
      addEventListener(){},body:{classList:{remove(){},add(){}}},
      createElement:()=>({remove(){this.removed=true}}),head:{appendChild:s=>scripts.push(s)}},
    setTimeout:fn=>{timers.set(++tick,fn);return tick},clearTimeout:id=>timers.delete(id),clearInterval(){},
    localStorage:{getItem:()=>null},$:node,$$:()=>[],ARCHIVE:{},COURSE:[],COURSE_SETS:[],COURSE_SET_NOTES:{},
    EgePythonWorker:class{},MARK:{},MARK_BTN:'',NUM_TOPIC:[],PY:{},PY_KW:new Set(),RULES:{},SERVER:true,TASKS:[],byId:new Map(),
    abandonCurrent(){},api:async path=>path==='pyc'?{access:false,pw:false}:path==='course/coverage'?{topics:[]}:path==='me'?{sid:5}:{access:false,pw:false},
    asgLeft:()=>[],badgeCls:()=>'',bdOpen:()=>false,codeKey:x=>x,courseSet:()=>null,esc:String,highlightPy:String,htmlWait(){},
    isNarrow:()=>false,leaveExam:()=>true,loadCourseSets(){},markAttach(){},navPush(){},needHtml:()=>false,netError(){},
    numLabel:String,numStats:()=>({lvl:'none'}),openSetTask(){},pct:x=>x,plural:()=>'',pyOpen:()=>false,pySync(){},
    readCode:()=>null,readJSON:()=>null,renderMath(){},renderSidebar(){},safeHtml:String,setScope(){},setSideOpen(){},
    refreshLearningDirectoryAccess(){},hubRefresh(){},toast(){},toggleBoard(){},togglePy(){},trainerEl:trainer,visible:()=>true,writeCode(){},writeJSON(){},
    courseShown:false,pageKind:'hub',cur:null,student:{sid:5},P:{log:[],tasks:{}},COURSE_OK:false,
    DECK:null,deckI:0,IM_OK:false,IM_PW:false});
  vm.runInContext(loader,c);
  function loaded(real=false) {
    if(real) vm.runInContext(built,c);
    else c.window.EgeLearningSections=bridge=>Object.fromEntries(methods.map(name=>[name,(...args)=>{opened.push([name,bridge.appState.student?.sid,...args]);return name}]));
    scripts.at(-1).onload();
  }
  return {c,scripts,opened,retries,timers,trainer,node,loaded};
}
test('optional learning UI stays unloaded for ordinary Python, access updates and account disposal',async()=>{
  const h=harness();h.c.pycDockTools({id:'normal'});h.c.pycStopTests();h.c.labStop();h.c.resetLearningSession();await h.c.pycLive();
  assert.equal(h.node('#pycDockTools').hidden,true);assert.equal(h.scripts.length,0);
});
test('first opens coalesce; most recent route wins; cached navigation remains synchronous',async()=>{
  const h=harness(),a=h.c.openCourse(),b=h.c.openLab('code');
  assert.equal(h.scripts.length,1);assert.equal(h.scripts[0].src,'app-learning.js?v=fingerprint');
  h.loaded();await Promise.all([a,b]);assert.deepEqual(h.opened,[['openLab',5,'code',undefined]]);
  assert.equal(h.c.openCourse(),'openCourse');assert.equal(h.opened.at(-1)[0],'openCourse');
  assert.equal(h.scripts.length,1);assert.equal(h.c.window.EgeLearningSections,undefined);
});
test('network, timeout and invalid factory failures allow a fresh successful retry',async()=>{
  for(const reason of ['network','timeout','invalid']) {
    const h=harness(),pending=h.c.openPyc();
    if(reason==='network') h.scripts[0].onerror();
    else if(reason==='timeout') [...h.timers.values()][0]();
    else {h.c.window.EgeLearningSections=()=>({});h.scripts[0].onload();}
    await pending;assert.equal(h.scripts[0].removed,true);assert.match(h.trainer.innerHTML,/Повторить загрузку/);
    const retry=h.retries[0]();h.loaded();await retry;
    assert.equal(h.scripts.length,2);assert.equal(h.opened[0][0],'openPyc');
  }
});
test('late download cannot replace another route or survive an account reset, including the same sid',async()=>{
  for(const change of [h=>{h.c.pageKind='hub'},h=>{h.c.student={sid:6}},h=>h.c.resetLearningSession()]) {
    const h=harness(),pending=h.c.openLesson(5);change(h);h.loaded();await pending;assert.deepEqual(h.opened,[]);
  }
});
test('real chunk initializes with only the bridge and renders course, Python and lab locked states',async()=>{
  const h=harness(),pending=h.c.openCourse();h.loaded(true);await pending;
  assert.match(h.trainer.innerHTML,/Курс доступен по паролю/);
  await h.c.openPyc();assert.match(h.trainer.innerHTML,/Учитель ещё не открыл курс/);
  await h.c.openLab();assert.match(h.trainer.innerHTML,/Учитель ещё не настроил доступ/);
  assert.equal(h.scripts.length,1);
});
test('real chunk discards pending plan, lesson and lab responses when the account is replaced',async()=>{
  for(const kind of ['openPyc','openLesson','openLab']) {
    let resolve;
    // Keep the explicit API callback stable while controlling response timing.
    const x=harness();let responder=async path=>path==='pyc'?{access:false,pw:false}:{access:false,pw:false};
    x.c.api=path=>responder(path);const first=x.c.openCourse();x.loaded(true);await first;
    responder=()=>new Promise(r=>{resolve=r});x.c.COURSE_OK=true;
    const pending=x.c[kind](5);const before=x.trainer.innerHTML;x.c.resetLearningSession();x.c.student={sid:6};
    resolve(kind==='openPyc'?{access:true,modules:[],progress:{}}:kind==='openLesson'?{slides:[]}:{access:true});
    await pending;assert.equal(x.trainer.innerHTML,before);assert.equal(x.c.DECK,null);
  }
});

test('an open course gate picks up another device grant and an unchanged snapshot leaves the lesson alone',async()=>{
  const h=harness();let course=false;
  h.c.api=async path=>path==='me'?{sid:5,course}:path==='course/coverage'?{topics:[]}:{};
  const first=h.c.openCourse();h.loaded(true);await first;
  assert.match(h.trainer.innerHTML,/Курс доступен по паролю/);
  course=true;
  await h.c.pycLive(false);
  assert.match(h.trainer.innerHTML,/ЕГЭ по информатике: от №1 до №27/);
  h.trainer.innerHTML='<div>Урок · слайд 3</div>';
  await h.c.pycLive(false);
  assert.equal(h.trainer.innerHTML,'<div>Урок · слайд 3</div>');
});

test('a delayed grant cannot cross an account reset, even when the same pupil logs back in',async()=>{
  const h=harness();let resolve;
  h.c.api=()=>new Promise(r=>{resolve=r});
  const pending=h.c.pycLive();
  h.c.resetLearningSession();
  h.c.student={sid:5};
  resolve({sid:5,course:true,lab:true,ard:true,pyc:true,im:true});
  await pending;
  assert.deepEqual(Array.from(vm.runInContext('[COURSE_OK, LAB_OK, ARD_OK, PYC_OK, IM_OK]',h.c)),[false,false,false,false,false]);
});

test('a newer access snapshot takes precedence over a delayed older response',async()=>{
  const h=harness(),replies=[];
  h.c.api=()=>new Promise(resolve=>replies.push(resolve));
  const old=h.c.pycLive(),current=h.c.pycLive();
  replies[1]({sid:5,lab:true});await current;
  replies[0]({sid:5,lab:false});await old;
  assert.equal(vm.runInContext('LAB_OK',h.c),true);
});

test('a help response from a disposed login cannot delete a new request with the same sid and key',async()=>{
  const responses=[], oldTask={}, newTask={};
  const c=vm.createContext({Promise,learningSessionEpoch:0,appState:{student:{sid:5}},
    PYC_HELP:Promise.resolve(),PYC_PENDING_HELP:new Map(),api:()=>new Promise(resolve=>responses.push(resolve))});
  const course=fs.readFileSync('src/app/03b-course-ui.js','utf8');
  vm.runInContext(course.slice(course.indexOf('  function learningSessionGuard('),course.indexOf('  function resetLearningState(')),c);
  const pyc=fs.readFileSync('src/app/12b-pycourse.js','utf8');
  vm.runInContext(pyc.slice(pyc.indexOf('  function pycFlushHelp('),pyc.indexOf('  let PYC_TEST')),c);
  c.PYC_PENDING_HELP.set('task:hint_used',{sid:5,task:oldTask,field:'hint_used',kind:'hint'});
  const first=c.pycFlushHelp();await Promise.resolve();await Promise.resolve();assert.equal(responses.length,1);
  c.learningSessionEpoch++;c.PYC_PENDING_HELP.clear();c.PYC_HELP=Promise.resolve();
  const current={sid:5,task:newTask,field:'hint_used',kind:'hint'};c.PYC_PENDING_HELP.set('task:hint_used',current);
  const second=c.pycFlushHelp();await Promise.resolve();await Promise.resolve();assert.equal(responses.length,2);
  responses[0]({});await first;
  assert.equal(c.PYC_PENDING_HELP.get('task:hint_used'),current);assert.equal(oldTask.hint_used,undefined);assert.equal(newTask.hint_used,undefined);
  responses[1]({});await second;assert.equal(newTask.hint_used,true);assert.equal(c.PYC_PENDING_HELP.size,0);
});
