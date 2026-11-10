import assert from 'node:assert/strict';
import vm from 'node:vm';
import {lessons,starter,checkCircuit,checkRuntime,stats,unlocked} from '../src/course.js';
import {workerBody} from '../src/runtime.js';
const signature=p=>JSON.stringify({code:p.code,diagram:{...p.diagram,parts:p.diagram.parts.map(x=>({...x,attrs:{...x.attrs,value:undefined,temperature:undefined,humidity:undefined}}))}});
const telemetry=p=>({started:true,signature:signature(p),pins:{},modes:{},events:[],frames:[],analog:{},serial:'',samples:[],error:null});
assert.equal(lessons.length,12);assert.equal(new Set(lessons.map(l=>l.id)).size,12);
for(const l of lessons){
  new Function(workerBody(l.code));new Function(workerBody(l.solution||l.code));
  const p=starter(l);p.diagram.connections=structuredClone(l.required);
  assert.ok(checkCircuit(l,p).ok,l.id);if(l.required.length){p.diagram.connections.pop();assert.equal(checkCircuit(l,p).ok,false,l.id+' missing wire');p.diagram.connections=structuredClone(l.required);}
  assert.equal(checkRuntime(l,p,telemetry(p),false).ok,false,l.id+' cannot complete without running');
  assert.equal(checkRuntime(l,p,telemetry(p),true).ok,false,l.id+' empty execution cannot pass');
  const events=[];vm.runInNewContext(workerBody(l.solution||l.code),{postMessage:e=>events.push(e),setTimeout:()=>0,Date,Math});await new Promise(r=>setTimeout(r,2));assert.ok(!events.some(e=>e.type==='error'),l.id+JSON.stringify(events));
}
const l=lessons[0],p=starter(l),t=telemetry(p);t.modes[13]=1;t.pins[13]=[1];assert.ok(checkRuntime(l,p,t,true).ok);p.code+='\n// change';assert.equal(checkRuntime(l,p,t,true).ok,false,'old execution cannot pass edited code');
const lp=lessons.find(l=>l.rule==='button'),bp=starter(lp);bp.diagram.connections=lp.required;const bt=telemetry(bp);bt.modes[2]=2;bt.samples=[{buttons:{button:true},outputs:{13:0}},{buttons:{button:false},outputs:{13:1}}];assert.equal(checkRuntime(lp,bp,bt,true).ok,false,'inverted button rejected');bt.samples=[{buttons:{button:true},outputs:{13:1}},{buttons:{button:false},outputs:{13:0}}];assert.ok(checkRuntime(lp,bp,bt,true).ok);
const ct=lessons.find(l=>l.rule==='climate'),cp=starter(ct),ctt=telemetry(cp);cp.diagram.parts.find(p=>p.id==='dht').attrs.temperature='32';assert.equal(signature(cp),ctt.signature,'changing sensor must not invalidate execution');
const progress={};assert.equal(stats(progress).points,0);assert.ok(unlocked(0,progress));assert.equal(unlocked(1,progress),false);progress[l.id]={theory:true,circuit:true,run:true};assert.equal(stats(progress).points,100);assert.ok(unlocked(1,progress));assert.equal(unlocked(2,progress),false);for(const x of lessons)progress[x.id]={theory:true,circuit:true,run:true};assert.deepEqual(stats(progress),{points:1200,steps:36,completed:12,percent:100,level:'Создатель'});
console.log('PASS: all 12 lesson programs, wiring checks, incomplete/changed-run rejection, button polarity, sensor changes, sequential unlocks and progress totals.');
