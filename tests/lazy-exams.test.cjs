const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const source = fs.readFileSync('src/app/12m-exam-loader.js', 'utf8');
function harness() {
  const scripts = [], opened = [], retries = [], timers = new Map();
  let next = 0;
  const trainer = {innerHTML:'', firstElementChild:{removeAttribute(){}},
    querySelector:() => ({addEventListener:(_event, callback) => retries.push(callback)})};
  const context = vm.createContext({Promise, Error, window:{scrollTo(){}},
    document:{currentScript:{dataset:{examsSrc:'app-exams.js?v=content-hash'}},
      head:{appendChild:script => scripts.push(script)}, createElement:() => ({remove(){this.removed=true;}})},
    setTimeout:fn => {timers.set(++next,fn);return next;}, clearTimeout:id => timers.delete(id),
    $:() => ({}), $$(){}, api(){}, esc:x => x, plural(){}, safeHtml(){}, toast(){}, trainerEl:trainer,
    hubRefresh(){}, renderMath(){}, toggleCalc(){}, courseShown:false, pageKind:'hub', student:{sid:5},
    leaveExam:() => true, isNarrow:() => false, setSideOpen(){}, abandonCurrent(){}, cur:null,
    navPush(){}, renderSidebar(){}});
  vm.runInContext(source,context);
  function loaded() {
    context.window.EgeExamSections = bridge => ({
      openMcko:() => opened.push(['mcko',bridge.appState.student.sid]),
      openIm:() => opened.push(['im',bridge.appState.student.sid]),
    });
    scripts.at(-1).onload();
  }
  return {context,scripts,opened,retries,trainer,timers,loaded};
}
test('optional sections make no startup request, share one request and initialize only once',async()=>{
  const h=harness(); assert.equal(h.scripts.length,0);
  const a=h.context.openMcko(), b=h.context.openMcko();
  assert.equal(h.scripts.length,1);assert.equal(h.scripts[0].src,'app-exams.js?v=content-hash');
  h.loaded();await Promise.all([a,b]);assert.deepEqual(h.opened,[['mcko',5]]);
  assert.equal(h.context.window.EgeExamSections,undefined);
  await h.context.openIm();assert.equal(h.scripts.length,1);assert.deepEqual(h.opened,[['mcko',5],['im',5]]);
});
test('a failed or timed out transfer leaves an explicit retry that makes a fresh request',async()=>{
  for(const failure of ['network','timeout']) {
    const h=harness(), pending=h.context.openMcko();
    if(failure==='network') h.scripts[0].onerror(); else [...h.timers.values()][0]();
    await pending;assert.equal(h.scripts[0].removed,true);assert.match(h.trainer.innerHTML,/Повторить загрузку/);
    const retry=h.retries[0]();assert.equal(h.scripts.length,2);
    h.loaded();await retry;assert.deepEqual(h.opened,[['mcko',5]]);
  }
});
test('late download cannot navigate back from another page or another pupil',async()=>{
  for(const change of [h=>{h.context.pageKind='hub';},h=>{h.context.student={sid:6};}]) {
    const h=harness(), pending=h.context.openMcko();change(h);h.loaded();await pending;
    assert.deepEqual(h.opened,[]);
  }
});
test('the built chunk runs with only its explicit bridge and renders both real empty states',async()=>{
  const built=execFileSync('python3',['-c','from tools.build_app import build_exams; print(build_exams())'],{encoding:'utf8'});
  const box={innerHTML:''}, state={courseShown:true,pageKind:'mcko',student:{sid:5}};
  const context=vm.createContext({window:{addEventListener(){}},document:{body:{classList:{remove(){}}}},
    MutationObserver:class{observe(){}},clearInterval(){},setInterval(){}});
  vm.runInContext(built,context);
  const sections=context.window.EgeExamSections({$:()=>null,$$:()=>[],esc:x=>x,plural:()=>'',
    trainerEl:{querySelector:()=>box,addEventListener(){}}, appState:state,
    api:async path=>path==='mcko'?{works:[],has_class:false}:{access:false,pw_set:false}});
  await sections.openMcko();assert.match(box.innerHTML,/Работ пока нет/);
  state.pageKind='im';await sections.openIm();assert.match(box.innerHTML,/Учитель ещё не открыл этот раздел/);
});
