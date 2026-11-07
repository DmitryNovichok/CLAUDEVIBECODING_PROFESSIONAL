const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the production helpers in a small browser-like environment.
const examSource = fs.readFileSync('src/app/05-exam.js', 'utf8');
const completionSource = examSource.slice(examSource.indexOf('  const examKeys'), examSource.indexOf('  const saveExam'));
function examContext(tasks, ans) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const c = vm.createContext({ byId, EX: { ans }, shapeOf: t => t.sh || { type: 'single' } });
  vm.runInContext(completionSource, c);
  return id => vm.runInContext(`answeredItem({id: ${JSON.stringify(id)}})`, c);
}

test('a 19–21 group needs every part', () => {
  const tasks = [{ id:'group', parts:[{id:'p19'}, {id:'p20'}, {id:'p21'}] }];
  const ans = { p19:{answer:'1'}, p20:{answer:''} };
  const complete = examContext(tasks, ans);
  assert.equal(complete('group'), false);
  ans.p20 = {answer:'2'}; ans.p21 = {answer:'3'};
  assert.equal(complete('group'), true);
});

test('fixed-size answers require every cell; zero is a valid answer', () => {
  const ans = { x:{answer:'0', cells:['0','']} };
  const complete = examContext([{id:'x', sh:{type:'grid',rows:1,cols:2}}], ans);
  assert.equal(complete('x'), false);
  ans.x = {answer:'0 2', cells:['0','2']};
  assert.equal(complete('x'), true);
});

test('variable-length tables allow trailing empty rows, but not a half row', () => {
  const ans = { x:{answer:'1 2', cells:['1','2','','','','']} };
  const complete = examContext([{id:'x', sh:{type:'grid',rows:10,cols:2}}], ans);
  assert.equal(complete('x'), true);
  ans.x.cells[2] = '3';
  assert.equal(complete('x'), false);
});

test('teacher drafts are isolated across accounts and reused IDs', () => {
  const source = fs.readFileSync('admin.js','utf8');
  const block = source.slice(source.indexOf('  const bldKey'), source.indexOf('  const rankDots'));
  const storage = new Map([['egeAdmin.bldDraft', JSON.stringify({title:'legacy private',tasks:[]})]]);
  const c = vm.createContext({ ME:{id:10,created:100}, localStorage:{
    getItem:k=>storage.get(k)||null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k)
  } });
  vm.runInContext(block, c);
  vm.runInContext("bldLoad(); BLD.d.title='teacher one'; BLD.d.tasks=[{id:'synthetic'}]; bldSave();", c);
  c.ME = {id:11,created:200}; vm.runInContext('bldLoad()',c);
  assert.equal(vm.runInContext('BLD.d.title',c),'');
  assert.equal(vm.runInContext('BLD.d.tasks.length',c),0);
  c.ME = {id:10,created:100}; vm.runInContext('bldLoad()',c);
  assert.equal(vm.runInContext('BLD.d.title',c),'teacher one');
  c.ME = {id:10,created:300}; vm.runInContext('bldLoad()',c);
  assert.equal(vm.runInContext('BLD.d.title',c),'');
});
