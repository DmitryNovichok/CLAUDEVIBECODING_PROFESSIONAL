// Validate the real synthetic backend and lifecycle without needing a browser.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {startFixture}=require('./browser/fixture.cjs');
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
