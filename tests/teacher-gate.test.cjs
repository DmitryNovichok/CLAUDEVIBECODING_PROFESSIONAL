const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('teacher-gate.js', 'utf8');
const ids = [...fs.readFileSync('teacher-gate.html', 'utf8').matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const tick = () => new Promise(resolve => setImmediate(resolve));
const profile = (email, moderation) => ({name: 'Тестовый Учитель', email: 'teacher@example.invalid', mail_on: true,
  onboarding: {ready: email && moderation === 'approved', email_confirmed: email, moderation, note: '', registration_required: false}});
function page(initial) {
  const nodes = Object.fromEntries(ids.map(id => [id, {hidden: false, disabled: false, textContent: '', value: '', listeners: {},
    classList: {toggle() {}}, addEventListener(event, cb) {this.listeners[event] = cb;}, focus() {},
    querySelector() {return this.button || (this.button = {disabled: false});},
    set innerHTML(_) {throw new Error('Untrusted profile must not be inserted as HTML');}}]));
  const redirects = [], calls = [];
  const state = {data: initial, status: 200, post: {ok: true}};
  const context = {document: {hidden: false, getElementById: id => nodes[id], addEventListener() {}},
    location: {replace: url => redirects.push(url)}, setInterval() {},
    fetch: async (url, options) => {calls.push({url, options}); return {status: state.status,
      ok: state.status < 400, json: async () => options.method === 'POST' ? state.post : state.data};}};
  vm.runInNewContext(source, context);
  const click = async id => {await nodes[id].listeners.click({currentTarget: nodes[id]}); await tick();};
  return {nodes, redirects, calls, state, click};
}

test('teacher gate opens only after BOTH requirements in either order', async () => {
  for (const first of [profile(true, 'pending'), profile(false, 'approved')]) {
    const p = page(first); await tick();
    assert.equal(p.redirects.length, 0);
    assert.equal(p.nodes.emailActions.hidden, first.onboarding.email_confirmed);
    p.state.data = profile(true, 'approved');
    await p.click('refresh');
    assert.deepEqual(p.redirects, ['/admin']);
    assert.equal(p.calls[0].options.cache, 'no-store');
    assert.ok(p.calls.every(c => c.url === '/api/admin/status'));
  }
});
test('rejection notes are literal text and mail outage remains visible', async () => {
  const data = profile(false, 'rejected');
  data.mail_on = false;
  data.onboarding.note = '<img src=x onerror=alert(1)>';
  const p = page(data); await tick();
  assert.equal(p.nodes.moderationBadge.textContent, 'Отклонено');
  assert.ok(p.nodes.reviewNote.textContent.includes(data.onboarding.note));
  assert.equal(p.nodes.reviewNote.hidden, false);
  assert.equal(p.nodes.resend.disabled, true);
  assert.equal(p.nodes.mailUnavailable.hidden, false);
  assert.equal(p.redirects.length, 0);
});
test('correcting email reports unsent mail honestly and supports logout', async () => {
  const p = page(profile(false, 'pending')); await tick();
  await p.click('editEmail');
  p.nodes.emailInput.value = 'new@example.invalid';
  p.state.post = {ok: true, email_sent: false};
  await p.nodes.emailForm.listeners.submit({preventDefault() {}, currentTarget: p.nodes.emailForm});
  assert.match(p.nodes.message.textContent, /недоступна/);
  const request = p.calls.find(c => c.url.endsWith('/email/change'));
  assert.deepEqual(JSON.parse(request.options.body), {email: 'new@example.invalid'});
  assert.equal(p.redirects.length, 0);
  await p.click('logout');
  assert.ok(p.calls.some(c => c.url === '/api/admin/logout'));
  assert.deepEqual(p.redirects, ['/admin']);
});
test('expired session returns to login and retry button is released', async () => {
  const p = page(profile(false, 'pending')); await tick();
  p.state.status = 401;
  await p.click('refresh');
  assert.deepEqual(p.redirects, ['/admin']);
  assert.equal(p.nodes.refresh.disabled, false);
});
