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
