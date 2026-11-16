// Reproducible cold-load profile. It is a lab emulation, never a measured school PC.
const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');
let fixture;
const profiles = [
  {name:'school-desktop', width:1366, height:768, cpu:4, latency:100, downloadMbps:4, uploadMbps:1},
  {name:'narrow-phone', width:390, height:844, cpu:6, latency:150, downloadMbps:1.6, uploadMbps:0.75},
];
test.beforeAll(async () => { fixture = await startFixture({taskCount:15000}); });
test.afterAll(async () => { await fixture?.stop(); });

for (const profile of profiles) {
  test(`cold load performance: ${profile.name}`, async ({page, context}, testInfo) => {
    await seedBrowser(context, fixture, 'pupil');
    const changelogRequests = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/changelog.js') {
        changelogRequests.push({method:request.method(), type:request.resourceType()});
      }
    });
    await page.setViewportSize({width:profile.width, height:profile.height});
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('Network.setCacheDisabled', {cacheDisabled:true});
    await cdp.send('Network.emulateNetworkConditions', {
      offline:false, latency:profile.latency,
      downloadThroughput:profile.downloadMbps * 1e6 / 8,
      uploadThroughput:profile.uploadMbps * 1e6 / 8, connectionType:'wifi',
    });
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:profile.cpu});
    await page.addInitScript(() => {
      window.__loadProfile = {lcp:null, longTasks:[], cls:0};
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__loadProfile.lcp = entry.startTime;
      }).observe({type:'largest-contentful-paint', buffered:true});
      new PerformanceObserver(list => {
        window.__loadProfile.longTasks.push(...list.getEntries().map(e => e.duration));
      }).observe({type:'longtask', buffered:true});
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__loadProfile.cls += entry.value;
      }).observe({type:'layout-shift', buffered:true});
    });
    await page.goto(fixture.origin + '/', {waitUntil:'load'});
    await expect(page.locator('[data-hub-n="5"]').first()).toBeVisible({timeout:30000});
    const metrics = await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource').map(e => ({
        path:new URL(e.name).pathname, type:e.initiatorType, encodedBytes:e.encodedBodySize,
        decodedBytes:e.decodedBodySize, durationMs:e.duration,
      }));
      const longTasks = window.__loadProfile.longTasks;
      return {readyObservedMs:performance.now(), domContentLoadedMs:nav.domContentLoadedEventEnd,
        loadMs:nav.loadEventEnd, fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        lcpMs:window.__loadProfile.lcp, cls:window.__loadProfile.cls,
        longTaskCount:longTasks.length, longTaskTotalMs:longTasks.reduce((a,b) => a+b,0),
        blockingTimeMs:longTasks.reduce((a,b) => a+Math.max(0,b-50),0),
        scriptBytes:resources.filter(e=>e.type==='script').reduce((a,b)=>a+b.encodedBytes,0), resources};
    });
    const report = {profile, scope:'synthetic accounts/content; actual shipped assets/handlers; cold cache',
      taskCount:fixture.taskCount ?? null, browser:testInfo.project.name || 'chromium', metrics,
      changelogRequests:changelogRequests.slice(),
      limitations:['CPU multiplier is relative to the runner, not a physical device specification.',
        'HTTP cache is disabled; no warm-cache conclusion is made.',
        'No timing baseline/SLA is asserted until this profile has actually run and been reviewed.']};
    await testInfo.attach(`${profile.name}-performance.json`, {body:JSON.stringify(report,null,2),contentType:'application/json'});
    await testInfo.attach(`${profile.name}-first-screen.png`, {body:await page.screenshot(),contentType:'image/png'});
    // Transfer guards are independent of runner CPU speed. Timing is recorded,
    // not fabricated as a passing target before the first executable baseline.
    expect(metrics.scriptBytes).toBeLessThanOrEqual(650000);
    const app = metrics.resources.find(e=>e.path==='/app.js');
    expect(app).toBeTruthy();
    expect(app.encodedBytes).toBeGreaterThan(0);
    expect(app.encodedBytes).toBeLessThanOrEqual(320000);
    // The update detector checks ETag/Last-Modified with HEAD at startup; this
    // transfers no history body. Any GET/prefetch/script before a click is a regression.
    expect(changelogRequests.every(request => request.method === 'HEAD')).toBe(true);
    expect(await page.evaluate(() => window.EGE_CHANGELOG.student.length)).toBe(1);
    await cdp.detach();
    // Verify the lazy path as well: opening the real history control must fetch
    // and render the full history once, after the cold-load measurements above.
    const historyRequest = page.waitForRequest(request =>
      new URL(request.url()).pathname === '/changelog.js' && request.method() === 'GET');
    await page.locator('[data-hub-link="versionBtn"]').click();
    expect((await historyRequest).resourceType()).toBe('script');
    await expect.poll(() => page.evaluate(() => window.EGE_CHANGELOG.student.length)).toBeGreaterThan(1);
    expect(changelogRequests.filter(request => request.method === 'GET')).toHaveLength(1);
  });
}
