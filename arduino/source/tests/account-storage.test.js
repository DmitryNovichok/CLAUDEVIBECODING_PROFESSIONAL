import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scopedStorage, accountLocalStorage} from '../src/account-storage.js';
class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i] ?? null; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k,v) { this.data.set(k,String(v)); }
  removeItem(k) { this.data.delete(k); }
}
test('different pupils cannot inherit projects, progress or teacher packets', () => {
  const native = new MemoryStorage();
  native.setItem('microlab.project','legacy');
  native.setItem('egeTrainer.student.v1','unrelated');
  const a = scopedStorage(native,'egeshka.arduino.1.'), b = scopedStorage(native,'egeshka.arduino.2.');
  for (const key of ['microlab.project','microlab.progress.blink.run','microlab.group.demo']) {
    a.setItem(key,'student A');
    assert.equal(b.getItem(key),null);
    b.setItem(key,'student B');
    assert.equal(a.getItem(key),'student A');
  }
  assert.equal(a.length,3);
  assert.deepEqual(a.keys(),b.keys());
  a.clear();
  assert.equal(a.length,0);
  assert.equal(b.length,3);
  assert.equal(native.getItem('microlab.project'),'legacy');
  assert.equal(native.getItem('egeTrainer.student.v1'),'unrelated');
});
test('cross-tab events are accepted only for the same pupil', () => {
  const a = scopedStorage(new MemoryStorage(),'egeshka.arduino.1.');
  assert.equal(a.eventKey('egeshka.arduino.1.microlab.progress.blink.run'),'microlab.progress.blink.run');
  assert.equal(a.eventKey('egeshka.arduino.2.microlab.progress.blink.run'),undefined);
  assert.equal(a.eventKey('microlab.progress.blink.run'),undefined);
  assert.equal(a.eventKey(null),null);
});
test('site storage is unavailable before the server confirms a pupil', () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.EGE_ARDUINO_REQUIRE_AUTH = true;
  assert.throws(()=>accountLocalStorage.getItem('microlab.project'));
  globalThis.EGE_ARDUINO_SID = 7;
  accountLocalStorage.setItem('microlab.project','own');
  assert.equal(globalThis.localStorage.getItem('egeshka.arduino.7.microlab.project'),'own');
  delete globalThis.EGE_ARDUINO_REQUIRE_AUTH;
  delete globalThis.EGE_ARDUINO_SID;
  delete globalThis.localStorage;
});
