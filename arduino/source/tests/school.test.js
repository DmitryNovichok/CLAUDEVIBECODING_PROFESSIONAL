import assert from 'node:assert/strict';
import vm from 'node:vm';
import { seniorLessons, checkSenior } from '../src/senior.js';
import { juniorNotes } from '../src/school.js';
import { lessons, stats, unlocked } from '../src/course.js';
import { workerBody } from '../src/runtime.js';

const scenarios = {
 'hs-start':[{}],
 'hs-scale':[0,512,1023].map(value=>({14:value})),
 'hs-range':[299,300,700,701].map(value=>({14:value})),
 'hs-memory':[25,28,32,28,25].map(temp=>({temp7:temp})),
 'hs-drive':[0,512,1023].map(value=>({14:value})),
 'hs-station':[[28,65],[32,50],[22,70],[32,70]].map(([temp7,humidity7])=>({temp7,humidity7}))
};
async function observe(source, inputs){
 const pending=[];
 const trace={pins:{},modes:{},samples:[],analog:{14:[]},serial:''};
 const out={};let servo=null,lcd='';
 const ctx=vm.createContext({
  setTimeout:cb=>pending.push(cb),
  postMessage:event=>{
   if(event.type==='error')throw Error(event.message);
   if(event.type==='mode')trace.modes[event.pin]=event.value;
   if(event.type==='pin'){out[event.pin]=event.value;(trace.pins[event.pin]??=[]).push(event.value)}
   if(event.type==='serial')trace.serial+=event.text;
   if(event.type==='servo')servo=event.value;
   if(event.type==='lcd')lcd=event.text;
  }
 });
 vm.runInContext(workerBody(source),ctx);await new Promise(r=>setImmediate(r));
 for(const input of inputs){
  ctx.onmessage({data:{type:'inputs',digital:{},analog:input}});
  for(let tick=0;tick<6;tick++){pending.shift()?.();await new Promise(r=>setImmediate(r))}
  trace.analog[14].push(input[14]);
  trace.samples.push({adc:input[14],temperatures:{dht:input.temp7},humidities:{dht:input.humidity7},outputs:{...out},lcd,servo});
 }
 return trace;
}
for(const l of seniorLessons){
 const inputs=scenarios[l.id];
 assert.ok(checkSenior(l.id,await observe(l.solution,inputs)),l.id+' reference solution');
 assert.ok(!checkSenior(l.id,await observe(l.code,inputs)),l.id+' starter');
}
assert.ok(lessons.every(l=>juniorNotes[l.id]?.length===5));
const old={'first-light':{theory:true,circuit:true,run:true}};
assert.equal(stats(old,seniorLessons).points,0);
assert.ok(unlocked(0,old,seniorLessons));
assert.ok(!unlocked(1,old,seniorLessons));
console.log('PASS: 6 senior projects with actual worker output; all six unfinished starters rejected; independent track progress.');
