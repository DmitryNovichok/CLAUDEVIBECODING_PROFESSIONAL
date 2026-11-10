import assert from 'node:assert/strict';
import vm from 'node:vm';
import {progressStore,captureChange,restoreChange,persistProject} from '../src/persistence.js';
import {lessons,starter,checkCircuit,checkRuntime} from '../src/course.js';
import {juniorYear,seniorYear} from '../src/year.js';
import {verifyBlink} from '../src/circuit-check.js';
import {powerCheck,echoDuration} from '../src/power.js';
import {validatePacket} from '../src/exchange.js';
import {learningPath} from '../src/learning-path.js';
import {workerBody} from '../src/runtime.js';
class MemoryStorage { data=new Map();getItem(k){return this.data.get(k)??null}setItem(k,v){this.data.set(k,String(v))} }
const storage=new MemoryStorage(),ids=['first-light','blink'];
storage.setItem('microlab.academy.v1',JSON.stringify({'first-light':{theory:true,homework:'старый ответ'}}));
const a=progressStore(storage,ids),b=progressStore(storage,ids);
const stale=b.read();a.patch('first-light',{run:true});b.patch('blink',{theory:true});
assert.equal(a.read()['first-light'].run,true);assert.equal(a.read().blink.theory,true);
assert.equal(stale['first-light'].run,undefined,'tab B really held a stale snapshot');
a.patch('first-light',{homework:''});assert.equal(b.read()['first-light'].homework,'','empty answer overrides legacy');
b.patch('first-light',{homework:'новый ответ'});a.patch('first-light',{circuit:true});
assert.equal(a.read()['first-light'].homework,'новый ответ');
a.import({blink:{run:true,theory:false},'first-light':{homework:'не затирать'}});
assert.equal(a.read().blink.theory,true);assert.equal(a.read()['first-light'].homework,'новый ответ');

const l=lessons.find(x=>x.id==='external-led'),p=starter(l);p.diagram.connections=structuredClone(l.required);
const old=captureChange(p);p.diagram.parts.push({id:'extra',type:'wokwi-led',left:0,top:0,attrs:{}});p.code+='\n// latest code';
const undone=restoreChange(p,old);assert.equal(undone.code,p.code,'circuit undo preserves typed code');assert.equal(undone.diagram.parts.length,p.diagram.parts.length-1);
assert.ok(checkCircuit(l,undone).ok);
undone.diagram.connections=undone.diagram.connections.map(c=>c.map(v=>v==='uno:GND.1'?'uno:GND.2':v));
assert.ok(checkCircuit(l,undone).ok,'equivalent GND accepted');
undone.diagram.parts.push({type:'wokwi-breadboard-mini',id:'bb',left:0,top:0,attrs:{}});
undone.diagram.connections[2]=['led:C','bb:2t.a','black',[]];undone.diagram.connections.push(['bb:2t.e','uno:GND.3','black',[]]);
assert.ok(checkCircuit(l,undone).ok,'breadboard path accepted');
undone.diagram.connections.at(-1)[0]='bb:3t.e';assert.equal(checkCircuit(l,undone).ok,false,'unconnected breadboard row rejected');
const renamed=starter(l);renamed.diagram.connections=structuredClone(l.required);renamed.diagram.parts.find(x=>x.id==='led').id='lamp';renamed.diagram.connections=renamed.diagram.connections.map(c=>c.map(v=>typeof v==='string'?v.replace('led:','lamp:'):v));assert.ok(checkCircuit(l,renamed).ok,'component names are not electrical requirements');

const key='project',initial=JSON.stringify(p);storage.setItem(key,initial);
const changed={...p,name:'A'};assert.ok(!persistProject(storage,key,changed,initial).conflict);
const remote=storage.getItem(key);assert.ok(persistProject(storage,key,{...p,name:'B'},initial).conflict);assert.equal(storage.getItem(key),remote,'conflict preserves remote project');
persistProject(storage,key,p,initial);assert.equal(storage.getItem(key),remote,'stale unedited tab cannot overwrite newer version');
const quota={getItem:()=>null,setItem(){throw Error('quota')}};assert.throws(()=>persistProject(quota,key,p,null));

const edges=[0,500,1000,1500,2000].map((at,i)=>({pin:13,value:i%2?0:1,at}));
assert.ok(verifyBlink(edges).ok);assert.equal(verifyBlink(edges.map(x=>({...x,at:0}))).ok,false);
assert.equal(verifyBlink(edges.slice(0,4)).ok,false,'two complete periods required');
assert.equal(verifyBlink(edges.map(x=>({...x,at:x.at*2}))).ok,false,'wrong duration rejected');
const blink=lessons.find(x=>x.id==='blink'),bp=starter(blink),trace={started:true,signature:JSON.stringify({code:bp.code,diagram:bp.diagram}),pins:{13:[1,0,1,0]},modes:{13:1},events:[],frames:[],samples:[],edges:edges.map(e=>({...e,at:0}))};
assert.equal(checkRuntime(blink,bp,trace,true).ok,false,'instant setup toggles cannot earn credit');

const dht=starter(lessons.find(x=>x.id==='climate'));assert.deepEqual(powerCheck(dht.diagram,dht.diagram.parts[0]),{short:false,unpowered:[]});
dht.diagram.connections=dht.diagram.connections.filter(c=>!c.includes('dht:VCC'));assert.deepEqual(powerCheck(dht.diagram,dht.diagram.parts[0]).unpowered,['dht']);
dht.diagram.connections.push(['uno:5V','uno:GND.2']);assert.ok(powerCheck(dht.diagram,dht.diagram.parts[0]).short);
assert.equal(echoDuration(100),5800);
const events=[],ctx=vm.createContext({postMessage:e=>events.push(e),setTimeout:fn=>{setImmediate(fn);return 1},Date,Math});
// Stop after setup; the harness supplies real input messages and collects API output.
vm.runInContext(workerBody('void setup(){pinMode(2,OUTPUT);delay(1);digitalWrite(2,HIGH);digitalWrite(2,LOW);Serial.println(pulseIn(3,HIGH));} void loop(){delay(1000);}').replace('while(true)','while(false)'),ctx);
ctx.onmessage({data:{type:'inputs',digital:{},analog:{pulse3:5800,trigger3:2}}});
for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
assert.ok(events.some(e=>e.type==='serial'&&e.text==='5800\n'),JSON.stringify(events));

const all=[...juniorYear,...seniorYear];
assert.ok(all.every(l=>learningPath(l).steps.length===5&&learningPath(l).criteria.length===4));
const assignment={version:1,type:'assignment',id:'a1',title:'Урок',group:'7А',lessonIds:['blink']};
assert.equal(validatePacket(assignment,all,x=>x).group,'7А');
assert.throws(()=>validatePacket({...assignment,lessonIds:['not-a-lesson']},all,x=>x));
const submission={version:1,type:'submission',id:'s1',lessonId:'blink',student:'Дима',project:bp,homework:'ответ'};
assert.equal(validatePacket(submission,all,x=>x).homework,'ответ');
assert.throws(()=>validatePacket({...submission,project:null},all,()=>{throw Error('invalid project')}));
assert.throws(()=>validatePacket({version:1,type:'review',id:'r1',lessonId:'blink',submissionId:'s1',status:'admin'},all,x=>x));
const journal={version:1,type:'classroom-backup',id:'j1',groups:[{id:'g1',name:'7А',roster:['Ученик']}],assignments:[assignment],submissions:[submission],reviews:[]};
assert.equal(validatePacket(journal,all,x=>x).submissions[0].project.lessonId,'blink');
assert.throws(()=>validatePacket({...journal,groups:[{id:'g1',name:'7А',roster:'bad'}]},all,x=>x));
assert.ok(learningPath(juniorYear[0]).criteria[0].includes('загорается'),'first lesson tests steady light, not blinking');
console.log('PASS: cross-tab progress, legacy migration, scoped undo, version conflicts, equivalent circuits, timed assessment, power diagnostics, sonar and classroom packets.');
