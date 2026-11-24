#!/usr/bin/env node
// Run after `npm ci --ignore-scripts` in tools/obfuscate (pinned lockfile).
// Check actual generated closures: a missing bridge member is otherwise a
// runtime ReferenceError only after the corresponding optional UI is opened.
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const acorn=require('./obfuscate/node_modules/acorn');
const scope=require('./obfuscate/node_modules/eslint-scope');
const root=path.resolve(__dirname,'..');
const browserGlobals=new Set(`AbortController Array Blob Boolean BroadcastChannel CSS CustomEvent Date Error Event FileReader Image Infinity Intl JSON Map Math MouseEvent MutationObserver NaN Number Object Promise RegExp ResizeObserver Set String TextDecoder URL URLSearchParams Uint8Array Uint16Array WeakMap Worker addEventListener cancelAnimationFrame clearInterval clearTimeout confirm decodeURIComponent document encodeURIComponent fetch getComputedStyle history innerHeight innerWidth isFinite isNaN localStorage location matchMedia navigator parseFloat parseInt performance queueMicrotask removeEventListener requestAnimationFrame sessionStorage setInterval setTimeout undefined window`.split(' '));
for(const [name,method,external] of [['app.js','build',['EgVisit','EgePythonWorker']],['app-learning.js','build_learning',[]],['app-exams.js','build_exams',[]]]) {
  const code=execFileSync('python3',['-c',`from tools.build_app import ${method}; print(${method}())`],{cwd:root,encoding:'utf8'});
  const ast=acorn.parse(code,{ecmaVersion:2022,ranges:true,locations:true});
  const free=scope.analyze(ast,{ecmaVersion:2022}).globalScope.through;
  const unexpected=free.filter(ref=>!browserGlobals.has(ref.identifier.name)&&!external.includes(ref.identifier.name));
  if(unexpected.length) throw Error(name+' has undeclared references: '+[...new Set(unexpected.map(ref=>`${ref.identifier.name}:${ref.identifier.loc.start.line}`))].join(', '));
  console.log(`${name}: only declared bindings, explicit bridge imports and approved browser globals`);
}
