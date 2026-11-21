// Validate the real synthetic backend and lifecycle without needing a browser.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startFixture,seedBrowser}=require('./browser/fixture.cjs');
const vm=require('node:vm');
test('browser fixture has real dual gate, local runtime, synthetic pupils and bounded teardown',async()=>{
  const fixture=await startFixture();
  try {
    assert.equal(fixture.participants.length,2);assert.ok(fixture.together.id);
    for(const teacher of fixture.teachers) {
      const headers={Cookie:'egeadm='+teacher.cookie};
      const r=await fetch(fixture.origin+'/api/admin/me',{headers});assert.equal(r.status,200);
      const profile=await r.json();const ready=teacher.email_ok&&teacher.moderation==='approved';
      assert.equal(profile.onboarding.ready,ready);
      const classes=await fetch(fixture.origin+'/api/admin/classes',{headers});assert.equal(classes.status,ready?200:403);
    }
    const headers={'X-Token':fixture.student.token};
    const profile=await (await fetch(fixture.origin+'/api/me',{headers})).json();assert.equal(profile.lab,true);
    // Runtime is optional for backend-only tests; browser npm ci installs it.
    assert.equal(typeof profile.rules.py_local,'boolean');
    const lab=await fetch(fixture.origin+'/api/lab/bugs',{headers});assert.equal(lab.status,200);
    const catalog=await lab.json();assert.ok(catalog.cases.length);
    const first=catalog.cases[0];
    const checked=await fetch(fixture.origin+'/api/lab/bugs/verify',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:first.id,code:'print(42)'})});
    assert.equal(checked.status,503);assert.match((await checked.json()).error,/недоступна/);
    const later=await (await fetch(fixture.origin+'/api/lab/bugs',{headers})).json();
    assert.deepEqual(later.cases.find(c=>c.id===first.id).my,first.my);
    const lesson=await fetch(fixture.origin+'/api/together/mine',{headers:{'X-Token':fixture.participants[0].token}});
    assert.equal(lesson.status,200);assert.ok((await lesson.json()).sessions.some(s=>s.id===fixture.together.id));
  } finally {await fixture.stop();}
  await assert.rejects(fetch(fixture.origin+'/api/me'));
});
test('synthetic fixtures refuse arbitrary executable paths and unbounded data',async()=>{
  await assert.rejects(startFixture({script:'../../server.py'}),/Unknown synthetic fixture/);
  await assert.rejects(startFixture({taskCount:20001}),/5..20000/);
});

for(const role of ['pupil','teacher']) {
  test(`browser ${role} seed initializes main windows without reading storage in sandbox frames`,async()=>{
    const initializers=[];
    const context={route:async()=>{},addCookies:async()=>{},addInitScript:async(fn,arg)=>initializers.push({fn,arg})};
    const fixture={origin:'http://127.0.0.1:12345',student:{sid:7,token:'synthetic'},
      teachers:[{id:9,cookie:'synthetic',email_ok:true,moderation:'approved'}]};
    await seedBrowser(context,fixture,role);assert.equal(initializers.length,1);
    const {fn,arg}=initializers[0],source=`(${fn.toString()})(__seedArg)`;
    let reads=0;
    const frame=vm.createContext({window:{top:{}},__seedArg:arg});
    Object.defineProperty(frame,'localStorage',{get(){reads++;throw Error('Opaque sandbox must not access storage');}});
    assert.doesNotThrow(()=>vm.runInContext(source,frame));assert.equal(reads,0);
    const writes=new Map(),mainWindow={};mainWindow.top=mainWindow;
    vm.runInNewContext(source,{window:mainWindow,__seedArg:arg,localStorage:{setItem:(key,value)=>writes.set(key,value)}});
    assert.equal(writes.get(role==='teacher'?'egeshka.atour.v1.9':'egeshka.tour.v1.7'),'1');
    if(role==='pupil') {assert.equal(writes.get('egeshka.stories.labs-lessons-2026-11.7'),'1');assert.ok(writes.has('egeTrainer.lbShown.7'));assert.equal(writes.get('egeshka.pad.rewards-2026-11.7'),'1');}
    assert.equal(writes.size,role==='teacher'?1:4);
  });
}
