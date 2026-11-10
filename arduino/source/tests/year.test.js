import assert from 'node:assert/strict';
import vm from 'node:vm';
import {juniorYear,seniorYear,yearModules} from '../src/year.js';
import {verifyExperiment} from '../src/year-check.js';
import {starter,checkCircuit,unlocked} from '../src/course.js';
import {workerBody} from '../src/runtime.js';

async function runTrials(l,source){
 let now=0,outputs={},servo=null,lcd='',serial='',pending=[];
 const trace={samples:[],edges:[]};
 const ctx=vm.createContext({setTimeout:(cb,ms)=>pending.push({cb,ms}),postMessage:e=>{
  if(e.type==='pin'){if(outputs[e.pin]!==e.value)trace.edges.push({pin:e.pin,value:e.value,at:now});outputs[e.pin]=e.value;}
  if(e.type==='servo')servo=e.value;if(e.type==='lcd')lcd=e.text;if(e.type==='serial')serial+=e.text;
  if(e.type==='error')throw Error(l.id+': '+e.message);
 }});
 vm.runInContext(workerBody(source),ctx);
 const flush=()=>new Promise(r=>setImmediate(r));await flush();
 async function tick(){const t=pending.shift();assert.ok(t,l.id+' stalled');now+=t.ms;t.cb();await flush()}
 const {kind,cases,wave}=l.experiment;
 if(wave){for(let n=0;n<20;n++)await tick();return trace;}
 for(const [input] of cases){
  let raw=Number(input),temp=22,hum=50,button=false,second=false;
  if(kind==='pair'){[button,second]=input;}
  if(kind==='gate'){[button,raw]=input;}
  if(['button','servoButton'].includes(kind))button=input;
  if(kind==='climate'||kind==='screen')[temp,hum]=input;
  ctx.onmessage({data:{type:'inputs',digital:{2:button?0:1,3:second?0:1},analog:{14:raw,temp7:temp,humidity7:hum}}});
  for(let n=0;n<5;n++)await tick();
  trace.samples.push({adc:raw,serialLine:serial.trim().split('\n').at(-1),outputs:{...outputs},buttons:{button:!!button,second:!!second},temperatures:{dht:temp},humidities:{dht:hum},servo,lcd});
 }
 return trace;
}
const all=[...juniorYear,...seniorYear];
assert.equal(new Set(all.map(l=>l.id)).size,72);
for(const course of [juniorYear,seniorYear]){
 assert.equal(course.length,36);
 for(let m=0;m<yearModules.length;m++)assert.equal(course.filter(l=>l.module===m).length,4);
 assert.equal(course.filter(l=>l.milestone).length,9);
 for(const l of course.filter(x=>x.experiment)){
  const project=starter(l);if(l.toWire)assert.equal(checkCircuit(l,project).ok,false,l.id);project.diagram.connections=structuredClone(l.required);assert.ok(checkCircuit(l,project).ok,l.id);
  const accepted=verifyExperiment(l,await runTrials(l,l.solution));
  assert.ok(accepted.ok,l.id+' reference: '+accepted.message);
  assert.ok(!verifyExperiment(l,await runTrials(l,l.code)).ok,l.id+' blank program accepted');
 }
}
assert.ok(unlocked(juniorYear.findIndex(l=>l.id==='weather'),{weather:{theory:true}},juniorYear),'returning pupil keeps access');
console.log('PASS: 72 unique lessons; 9 milestones in each track; all 54 new labs accept running reference sketches and reject uncompleted starters.');
