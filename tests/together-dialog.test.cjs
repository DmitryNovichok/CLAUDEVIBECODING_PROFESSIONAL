const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('together.js', 'utf8');
const helper = source.slice(source.indexOf('  function trapModalTab('), source.indexOf('  const modalTriggers'));

test('Together dialogs wrap Tab at visible enabled controls without trapping normal navigation', () => {
  const document = {activeElement: null};
  const context = vm.createContext({document});
  vm.runInContext(helper, context);
  const control = (options = {}) => ({
    tabIndex: 0, ...options,
    matches() { return !!this.disabled; },
    getClientRects() { return this.hiddenByParent ? [] : [{}]; },
    focus() { document.activeElement = this; },
  });
  const first = control(), middle = control(), last = control();
  const hidden = control({hiddenByParent: true}), disabled = control({disabled: true});
  const modal = {open: true, querySelectorAll: () => [disabled, first, middle, last, hidden], focus() { document.activeElement = this; }};
  function press(active, shiftKey = false, key = 'Tab') {
    document.activeElement = active;
    let prevented = false;
    context.trapModalTab(modal, {key, shiftKey, preventDefault() { prevented = true; }});
    return prevented;
  }
  assert.equal(press(first, true), true);
  assert.equal(document.activeElement, last);
  assert.equal(press(last), true);
  assert.equal(document.activeElement, first);
  assert.equal(press(middle), false);
  assert.equal(document.activeElement, middle);
  assert.equal(press(middle, true), false);
  assert.equal(press(modal), true);
  assert.equal(document.activeElement, first);
  assert.equal(press(last, false, 'Escape'), false);
  modal.open = false;
  assert.equal(press(first, true), false);
  modal.open = true;
  modal.querySelectorAll = () => [disabled, hidden];
  assert.equal(press(modal), true);
  assert.equal(document.activeElement, modal);
});

test('a queued Together dialog close preserves subsequent focus and a reopened dialog', () => {
  const body = {}, document = {body, activeElement: body};
  const context = vm.createContext({document});
  const lifecycle = source.slice(source.indexOf('  const modalTriggers'), source.indexOf("  $$('.tg-modal').forEach"));
  vm.runInContext(lifecycle, context);
  let restored = 0;
  const trigger = {isConnected: true, hidden: false, focus() { restored++; document.activeElement = this; }};
  const field = {}, splitter = {}, nextDialogField = {};
  const modal = {open: false, hidden: false, contains: element => element === field};
  context.modal = modal; context.trigger = trigger;
  const remember = () => vm.runInContext('modalTriggers.set(modal, trigger)', context);

  // close() already restored the trigger. The user then focuses a splitter
  // before the queued event runs; ArrowRight must still go to the splitter.
  for (const focused of [trigger, splitter, nextDialogField]) {
    remember(); document.activeElement = focused; restored = 0;
    context.finishModalClose(modal);
    assert.equal(document.activeElement, focused);
    assert.equal(restored, 0);
    assert.equal(modal.hidden, true);
  }

  // If native focus restoration did not find a target, restore our trigger.
  for (const focused of [body, modal, field]) {
    remember(); document.activeElement = focused; restored = 0;
    context.finishModalClose(modal);
    assert.equal(document.activeElement, trigger);
    assert.equal(restored, 1);
  }

  // The old queued event must neither hide a fresh opening nor clear its trigger.
  remember(); modal.open = true; modal.hidden = false; document.activeElement = field; restored = 0;
  context.finishModalClose(modal);
  assert.equal(modal.hidden, false);
  assert.equal(document.activeElement, field);
  assert.equal(restored, 0);
  modal.open = false; document.activeElement = body;
  context.finishModalClose(modal);
  assert.equal(document.activeElement, trigger);
  assert.equal(restored, 1);
});
