const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const loader = fs.readFileSync('changelog-loader.js', 'utf8');
const history = fs.readFileSync('changelog.js', 'utf8');

function fixture() {
  const requests = [], timers = new Map(); let timerId = 0;
  const c = vm.createContext({window:{}, setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    document:{createElement:()=>({remove(){this.removed=true;}}),head:{append:script=>requests.push(script)}}});
  vm.runInContext(loader, c);
  return {c, requests, timers, load:()=>c.window.EgeLoadChangelog(), complete:()=>{
    vm.runInContext(history,c); requests.at(-1).onload();
  }};
}
test('current release is available immediately with no request for full history', () => {
  const f = fixture();
  assert.equal(f.requests.length,0);
  assert.equal(f.c.window.EGE_CHANGELOG.student.length,1);
  assert.equal(f.c.window.EGE_CHANGELOG.teacher.length,1);
});
test('concurrent clicks share one request and retain both existing array references', async () => {
  const f=fixture(), current=f.c.window.EGE_CHANGELOG, student=current.student, teacher=current.teacher;
  const first=f.load(),second=f.load();
  assert.equal(first,second); assert.equal(f.requests.length,1);
  f.complete();
  assert.equal(await first,current);
  assert.equal(current.student,student); assert.equal(current.teacher,teacher);
  assert.ok(student.length>20); assert.ok(teacher.length>20);
  assert.equal(f.timers.size,0);
  await f.load(); assert.equal(f.requests.length,1);
});
test('failed and timed-out loads keep the latest release and can be retried', async () => {
  const f=fixture(), current=f.c.window.EGE_CHANGELOG;
  const failed=f.load(); f.requests[0].onerror();
  await assert.rejects(failed,/историю версий/);
  assert.equal(f.c.window.EGE_CHANGELOG,current);
  const timedOut=f.load(); [...f.timers.values()][0]();
  await assert.rejects(timedOut,/историю версий/);
  const retried=f.load(); f.complete(); await retried;
  assert.equal(f.requests.length,3);
  assert.ok(current.student.length>20);
});
