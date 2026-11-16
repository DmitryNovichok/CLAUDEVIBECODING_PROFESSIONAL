#!/usr/bin/env node
// Run ON the physical school computer. Only disposable local fixture accounts.
const {chromium} = require('../tests/browser/node_modules/@playwright/test');
const {startFixture} = require('../tests/browser/fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = key => {const i=args.indexOf(key);return i>=0?args[i+1]:null;};
const label=value('--device'), output=value('--output'), channel=value('--channel');
if(!label||!output||args.some((arg,i)=>i%2===0&&!['--device','--output','--channel'].includes(arg))) {
  console.error('node tools/measure_school_device.cjs --device "School PC model / CPU / RAM / OS" --output /private/device.json [--channel chrome]');
  process.exit(2);
}
if(fs.existsSync(output)) {console.error('Output already exists; choose a new file.');process.exit(2);}
(async()=>{
  let fixture,browser;
  try {
    fixture=await startFixture({taskCount:15000});
    browser=await chromium.launch({headless:false,chromiumSandbox:true,...(channel?{channel}:{})});
    const runs=[];
    // Separate contexts give independent cold starts. Each warm start reuses that
    // context/cache. No CPU throttling: this measures the actual computer's CPU.
    for(let trial=1;trial<=5;trial++) {
      const context=await browser.newContext({viewport:{width:1366,height:768}});
      // Do not install Playwright request routing: routing disables the HTTP
      // cache and would turn the reported warm runs into cold ones.
      await context.addCookies([{name:'egest',value:fixture.student.token,url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
      await context.addInitScript(sid=>{
        localStorage.setItem('egeshka.tour.v1.'+sid,'1');
        localStorage.setItem('egeshka.stories.labs-lessons-2026-11.'+sid,'1');
        const d=new Date(),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        localStorage.setItem('egeTrainer.lbShown.'+sid,day);
      },fixture.student.sid);
      const page=await context.newPage(), cdp=await context.newCDPSession(page);
      await cdp.send('Network.enable');await cdp.send('Network.clearBrowserCache');
      // A fixed, disclosed network profile isolates physical CPU/browser cost.
      // This is NOT a measurement of the school's actual Internet connection.
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,
        downloadThroughput:4e6/8,uploadThroughput:1e6/8,connectionType:'wifi'});
      await page.addInitScript(()=>{
        window.__deviceLongTasks=[];
        new PerformanceObserver(list=>window.__deviceLongTasks.push(...list.getEntries().map(e=>e.duration)))
          .observe({type:'longtask',buffered:true});
      });
      for(const cache of ['cold','warm']) {
        await page.goto(fixture.origin+'/',{waitUntil:'load'});
        await page.locator('[data-hub-n="5"]').first().waitFor({state:'visible'});
        const metrics=await page.evaluate(async()=>{
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const nav=performance.getEntriesByType('navigation')[0];
          return {readyMs:performance.now(),domContentLoadedMs:nav.domContentLoadedEventEnd,
            blockingMs:window.__deviceLongTasks.reduce((sum,d)=>sum+Math.max(0,d-50),0),
            scriptBytes:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script').reduce((sum,e)=>sum+e.encodedBodySize,0)};
        });
        const start=await page.evaluate(()=>performance.now());
        await page.locator('[data-hub-n="5"]').first().click();
        await page.locator('#answerInputs input').first().waitFor({state:'visible'});
        if(!await page.locator('#answerInputs input').first().isEditable()) throw Error('First task is not usable');
        metrics.firstTaskMs=await page.evaluate(t=>performance.now()-t,start);
        runs.push({trial,cache,...metrics});
        await page.locator('#hubBack').click();
      }
      await context.close();
    }
    const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const report={recordedUtc:new Date().toISOString(),device:label,browser:browser.version(),
      scope:'Physical computer running this command; headed Chromium; synthetic local accounts and 15000 tasks.',
      network:{kind:'emulated, not measured school network',latencyMs:100,downloadMbps:4,uploadMbps:1},
      limitations:['Does not measure the production server, real account history or Internet availability.',
        'Run at the normal power setting with other school apps open; record those conditions separately.'],
      summary:Object.fromEntries(['cold','warm'].map(cache=>[cache,Object.fromEntries(['readyMs','firstTaskMs','blockingMs'].map(key=>[key,{median:median(runs.filter(r=>r.cache===cache).map(r=>r[key])),max:Math.max(...runs.filter(r=>r.cache===cache).map(r=>r[key]))}]))])),runs};
    fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log('Saved physical-device measurement:',output);
  } finally {await browser?.close();await fixture?.stop();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
