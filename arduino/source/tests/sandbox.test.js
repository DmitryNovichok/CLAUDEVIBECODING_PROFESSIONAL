import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normaliseArduinoEvent,arduinoFrameSource,startEducationalSandbox} from '../src/sandbox.js';
import {sandboxHarness} from './sandbox-harness.js';
import {build} from 'esbuild';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('the frame is opaque with no network, and sketch text is transferred outside HTML',async()=>{
  const h=sandboxHarness(),events=[],errors=[];
  const attack='postMessage({type:"serial",text:'+JSON.stringify('</script><script>parent.fetch("/api/admin")</script>')+'});';
  const run=startEducationalSandbox(attack,{event:e=>events.push(e),error:e=>errors.push(e)},h.environment);
  await tick();
  const frame=h.frames[0];
  assert.equal(frame.attributes.sandbox,'allow-scripts');
  assert.ok(!frame.attributes.sandbox.includes('allow-same-origin'));
  assert.ok(frame.srcdoc.includes("connect-src 'none'"));
  assert.ok(frame.srcdoc.includes("frame-src 'none'"));
  assert.ok(!frame.srcdoc.includes('parent.fetch'));
  assert.ok(h.messages[0].data.source.includes(attack));
  assert.ok(h.messages[0].data.source.includes('self.location.origin !== "null"'));
  assert.equal(h.messages[0].target,'*');
  assert.deepEqual(errors,[]);
  run.stop();
});
test('pending IO keeps latest input and serial, then uses only the private port',async()=>{
  const h=sandboxHarness({autoLoad:false});
  const run=startEducationalSandbox('/* sketch */',{event(){},error:assert.fail},h.environment);
  run.inputs({2:0},{14:12});run.inputs({2:1},{14:321,temp3:25});run.serial('A');run.serial('B');
  assert.equal(h.workers.length,0);
  h.frames[0].onload();await tick();
  assert.deepEqual(h.workers[0].inputs,[{type:'inputs',digital:{2:1},analog:{14:321,temp3:25}},{type:'serial',text:'AB'}]);
  run.inputs({2:0},{14:123});await tick();
  assert.equal(h.workers[0].inputs.at(-1).analog[14],123);
  run.stop();
});
test('only normalized hardware/serial events pass; forged application commands never do',async()=>{
  const h=sandboxHarness(),events=[];
  const run=startEducationalSandbox('/* sketch */',{event:e=>events.push(e),error:assert.fail},h.environment);
  await tick();const worker=h.workers[0];
  for(const message of [{type:'fetch',url:'/api/admin/login'}, {kind:'ready'},
    {type:'pin',pin:'__proto__',value:1}, {type:'tone',pin:3,hz:Infinity},
    {type:'lcd',pins:[],text:'bad'}, {type:'mode',pin:3,value:'<script>'}])worker.emit(message);
  worker.emit({type:'pin',pin:13,value:1,token:'not forwarded'});
  worker.emit({type:'serial',text:'42'});
  worker.emit({type:'lcd',pins:[1,2,3,4,5,6],text:'Hello'});
  await tick();
  assert.deepEqual(events,[{type:'pin',pin:13,value:1},{type:'serial',text:'42'},{type:'lcd',pins:[1,2,3,4,5,6],text:'Hello'}]);
  run.stop();
});
test('stop destroys the frame/worker and ignores delayed messages and queued input',async()=>{
  const h=sandboxHarness(),events=[];
  const run=startEducationalSandbox('/* sketch */',{event:e=>events.push(e),error:assert.fail},h.environment);
  await tick();const worker=h.workers[0];
  worker.emit({type:'serial',text:'late'});
  run.stop();run.stop();run.inputs({2:1},{14:2});run.serial('after stop');await tick();
  assert.equal(worker.stopped,true);assert.equal(h.frames[0].removed,true);
  assert.deepEqual(events,[]);assert.deepEqual(worker.inputs,[]);assert.equal(h.timers.size,0);
});
test('missing, failed or stalled isolation fails closed without a same-origin fallback',async()=>{
  assert.throws(()=>startEducationalSandbox('',{},{document:{body:{}}}),/современный браузер/);
  const failed=sandboxHarness({workerFails:true}),errors=[];
  startEducationalSandbox('',{event:assert.fail,error:e=>errors.push(e)},failed.environment);await tick();
  assert.equal(errors.length,1);assert.equal(failed.frames[0].removed,true);assert.equal(failed.workers.length,0);
  const stalled=sandboxHarness({autoLoad:false});
  startEducationalSandbox('',{event:assert.fail,error:e=>errors.push(e)},stalled.environment);
  [...stalled.timers.values()][0]();
  assert.equal(stalled.frames[0].removed,true);assert.equal(stalled.workers.length,0);
});
test('serial and peripheral payloads are bounded before crossing into application state',()=>{
  assert.equal(normaliseArduinoEvent({type:'serial',text:'x'.repeat(90000)}).text.length,30000);
  assert.equal(normaliseArduinoEvent({type:'servo',pin:2,value:1000}).value,180);
  assert.equal(normaliseArduinoEvent({type:'pin',pin:2,value:NaN}),null);
  assert.equal(normaliseArduinoEvent({type:'lcd',pins:Array(1000).fill(1),text:'x'}),null);
  assert.ok(arduinoFrameSource().includes('Скетч отправляет слишком много событий'));
});
test('repeated hardware state is coalesced and excessive UI work stops the worker',async()=>{
  const h=sandboxHarness(),events=[],errors=[];
  startEducationalSandbox('/* sketch */',{event:e=>events.push(e),error:e=>errors.push(e)},h.environment);
  await tick();const worker=h.workers[0];
  for(let i=0;i<100;i++)worker.emit({type:'tone',pin:4,hz:440});
  await tick();assert.deepEqual(events,[{type:'tone',pin:4,hz:440}]);
  for(let i=0;i<201;i++)worker.emit({type:'servo',pin:3,value:i%180});
  await tick();
  assert.equal(errors.length,1);assert.match(errors[0],/часто меняет периферию/);
  assert.equal(worker.stopped,true);assert.equal(h.frames[0].removed,true);
});
test('the minified shipped adapter still embeds a self-contained frame bootstrap',async()=>{
  const result=await build({entryPoints:['src/sandbox.js'],bundle:true,format:'esm',minify:true,write:false});
  const built=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
  const h=sandboxHarness(),events=[];
  const run=built.startEducationalSandbox('/* sketch */',{event:e=>events.push(e),error:assert.fail},h.environment);
  await tick();h.workers[0].emit({type:'serial',text:'compiled bridge works'});await tick();
  assert.deepEqual(events,[{type:'serial',text:'compiled bridge works'}]);run.stop();
});
