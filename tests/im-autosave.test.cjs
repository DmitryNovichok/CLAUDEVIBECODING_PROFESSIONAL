const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/app/12o-im.js', 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; }
function memory() {
  const values = new Map();
  return {values, getItem:k => values.get(k) || null, setItem:(k, v) => values.set(k, v), removeItem:k => values.delete(k)};
}
function saver(options) {
  const context = vm.createContext({Date, Promise, Object, JSON});
  vm.runInContext(source.slice(source.indexOf('  function createImTrialSaver('), source.indexOf('  function imSaveStatus()')), context);
  return context.createImTrialSaver(options);
}
test('edits during a request are serialized; an older success never marks the new answer saved', async () => {
  const first = deferred(), second = deferred(), calls = [], states = [], storage = memory();
  const answers = {a: ''};
  const q = saver({id: 7, sid: 2, answers, storage, changed:s => states.push(plain(s)),
    send:data => {calls.push(plain(data)); return calls.length === 1 ? first.promise : second.promise;}});
  answers.a = 'old'; q.touch(); const pending = q.flush();
  answers.a = 'latest'; q.touch(); q.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].answers.a, 'old');
  first.resolve({ok: true}); await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].answers.a, 'latest');
  assert.notEqual(q.status().state, 'saved');
  assert.equal(q.status().pending, true);
  assert.equal(storage.values.size, 1);
  second.resolve({ok: true}); await pending;
  assert.equal(q.status().state, 'saved');
  assert.equal(storage.values.size, 0);
  assert.equal(states.filter(s => s.state === 'saved').length, 1);
});
test('offline failure preserves the latest draft and reconnect is bounded to one attempt', async () => {
  const storage = memory(), answers = {a: ''}, calls = [];
  let now = 100000, online = false;
  const q = saver({id: 8, sid: 2, answers, storage, clock:() => now,
    send:async data => {calls.push(plain(data)); if (!online) throw Error('offline'); return {ok:true};}});
  answers.a = 'first'; q.touch();
  assert.equal(await q.flush(), false);
  assert.equal(q.status().state, 'error');
  answers.a = 'latest'; q.touch();
  q.online(); q.online(); assert.equal(calls.length, 1);
  now += 10001; online = true;
  const retry = q.online(); q.online(); await retry;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].answers.a, 'latest');
  assert.equal(q.status().state, 'saved');
  assert.equal(storage.values.size, 0);
});
test('reload restores only dirty fields for the same pupil and trial', async () => {
  const storage = memory(), answers = {a: '', b: 'server-old'};
  const old = saver({id: 5, sid: 2, answers, storage, send:async () => {throw Error('offline');}});
  answers.a = 'local'; old.touch(); await old.flush();
  const fresh = {a:'', b:'server-new'};
  const restored = saver({id: 5, sid: 2, answers:fresh, storage, send:async () => ({ok:true})});
  assert.deepEqual(fresh, {a:'local', b:'server-new'});
  assert.equal(restored.status().pending, true);
  const anotherPupil = {a:'', b:''};
  saver({id:5, sid:3, answers:anotherPupil, storage, send:async () => ({ok:true})});
  assert.equal(anotherPupil.a, '');
  const anotherTrial = {a:'', b:''};
  saver({id:6, sid:2, answers:anotherTrial, storage, send:async () => ({ok:true})});
  assert.equal(anotherTrial.a, '');
});
test('blocked session storage is reported and does not break server saving', async () => {
  const answers = {a:''};
  const q = saver({id:1, sid:1, answers, send:async () => ({ok:true})});
  answers.a = '42'; q.touch();
  assert.equal(q.status().local, false);
  assert.equal(await q.flush(), true);
});
test('finish waits for autosave, ignores double clicks, keeps draft on an unconfirmed response', async () => {
  const activeSave = deferred(), requests = [], statuses = [];
  let clears = 0, pauses = 0;
  const IM = {trial:{id:7, items:[{id:'a'}], answers:{a:'42'}}, finishBusy:false,
    saver:{pause:() => {pauses++; return activeSave.promise;}, clear:() => {clears++;}}};
  const ctx = vm.createContext({IM, clearTimeout(){}, clearInterval(){}, confirm:() => true,
    $:() => ({setAttribute(){}}), $$:() => [], imSaveStatus:() => statuses.push(IM.finishError),
    api:async (path, data) => {requests.push({path, data}); throw Error('connection lost');}, imActive:() => false});
  vm.runInContext(source.slice(source.indexOf('  async function imTrialFinish('), source.indexOf("  window.addEventListener('online'")), ctx);
  const finish = ctx.imTrialFinish(false);
  await ctx.imTrialFinish(false);
  assert.equal(pauses, 1);
  assert.equal(requests.length, 0);
  activeSave.resolve(true); await finish;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, 'im/trial/finish');
  assert.equal(IM.finishPending, true);
  assert.equal(IM.finishBusy, false);
  assert.equal(IM.finishError, 'connection lost');
  assert.equal(clears, 0);
  await tick(); assert.equal(requests.length, 1, 'no automatic finish retry');
});
