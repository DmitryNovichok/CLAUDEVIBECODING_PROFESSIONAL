#!/usr/bin/env node
// Report only what Playwright executed. Never convert a browser launch failure to a pass.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {summarize}=require('./summarize.cjs');
const argv=process.argv.slice(2), marker=argv.indexOf('--profile');
let profile='all';
if(marker>=0) {profile=argv[marker+1];argv.splice(marker,2);}
const filters={all:[],ui:['app-flow.spec.cjs','assignment-flow.spec.cjs','welcome.spec.cjs','labs.spec.cjs','together.spec.cjs'],python:['python-sandbox.spec.cjs','readiness.spec.cjs'],performance:['performance.spec.cjs']};
if(!Object.hasOwn(filters,profile)) {console.error('Profile: all | ui | python | performance');process.exit(2);}
const cli=require.resolve('@playwright/test/cli');
const listing=argv.includes('--list');
const resultPath=path.join(__dirname,'results.json');
if(!listing) fs.rmSync(resultPath,{force:true});
const startedAt=new Date().toISOString();
const run=spawnSync(process.execPath,[cli,'test',...filters[profile],...argv],{cwd:__dirname,stdio:'inherit',env:process.env});
if(!listing) {
  let report=null;try{report=JSON.parse(fs.readFileSync(resultPath,'utf8'));}catch{}
  const summary=summarize(report,{profile,startedAt,exitCode:run.status,signal:run.signal,error:run.error?.message});
  fs.writeFileSync(path.join(__dirname,'audit-summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('\nExecution summary: tests/browser/audit-summary.json; visual review is still required.');
}
if(run.error) console.error(run.error.message);
process.exit(run.status===null?1:run.status);
