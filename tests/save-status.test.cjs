const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function client(fetch) {
  const events=[], handlers={};
  const context=vm.createContext({fetch, student:null, isTemp:()=>false, Date,
    window:{dispatchEvent:e=>events.push(e.detail),addEventListener:(name, fn)=>{handlers[name]=fn;}}, CustomEvent:class{constructor(_, options){this.detail=options.detail;}}});
  const source=fs.readFileSync('src/app/06-server-sync.js','utf8');
  vm.runInContext(source.slice(0,source.indexOf('  let syncTimer')),context);
  return {api:context.api,events,endSession:()=>handlers['egeshka:session-ended']()};
}
test('answer saved only after complete successful JSON; uncertain response is not replayed',async()=>{
  let calls=0;
  const c=client(async()=>{calls++;return {ok:true,json:async()=>{throw Error('truncated');}};});
  await assert.rejects(c.api('check',{answer:'1'}), /не подтвердил/);
  assert.deepEqual(c.events.map(e=>e.state), ['pending','error']);
  assert.equal(calls,1);
});
test('offline then explicit retry preserves pending/error/saved order',async()=>{
  let calls=0;
  const c=client(async()=>{if(++calls===1)throw Error('offline');return {ok:true,json:async()=>({ok:true})};});
  await assert.rejects(c.api('mcko/save',{values:['1']}));
  await c.api('mcko/save',{values:['1']});
  assert.deepEqual(c.events.map(e=>e.state),['pending','error','pending','saved']);
  assert.ok(c.events[2].id>c.events[0].id);
});
test('background reads and non-answer updates do not show answer confirmation',async()=>{
  const c=client(async()=>({ok:true,json:async()=>({ok:true})}));
  await c.api('history');await c.api('progress',{prefs:{}});
  assert.equal(c.events.length,0);
});
test('intermediate wrong answer is accepted, without claiming durable save',async()=>{
  const c=client(async()=>({ok:true,json:async()=>({final:false})}));
  await c.api('check',{answer:'wrong'});
  assert.equal(c.events.at(-1).state,'accepted');
});
test('late response cannot show saved state after logout or account switch',async()=>{
  let release;
  const c=client(()=>new Promise(resolve=>{release=resolve;}));
  const pending=c.api('check',{answer:'1'});
  c.endSession();release({ok:true,json:async()=>({final:true})});await pending;
  assert.deepEqual(c.events.map(e=>e.state),['pending']);
});
