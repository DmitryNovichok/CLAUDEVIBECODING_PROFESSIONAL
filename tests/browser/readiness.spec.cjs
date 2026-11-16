// Real HTTP handlers, SQLite receipt and pinned local Pyodide; no production data.
const {test,expect}=require('@playwright/test');
const {startFixture} = require('./fixture.cjs');
let config;
test.beforeAll(async()=>{ config=await startFixture({script:'readiness_fixture.py',shutdown:'stdin'}); });
test.afterAll(async()=>{ await config?.stop(); });
async function open(page,context,index){
  await context.addCookies([{name:'egest',value:config.tokens[index],url:config.origin,httpOnly:true,sameSite:'Lax'}]);
  // The real diagnostic must honour the locally installed runtime. CDN is unavailable here.
  await page.route('**/*',route=>new URL(route.request().url()).origin===config.origin?route.continue():route.abort());
  await page.goto(config.origin);
  await page.getByRole('button',{name:'Проверить перед уроком',exact:true}).click();
}
test('all diagnostics use real backend and local Python without creating pupil attempts',async({page,context})=>{
  await open(page,context,0);
  const before=await (await page.request.get(config.origin+'/api/history')).json();
  await page.getByRole('button',{name:'Начать проверку',exact:true}).click();
  for(const key of ['network','storage','save','file','python'])
    await expect(page.locator('[data-check='+key+']')).toHaveAttribute('data-state','ok',{timeout:90000});
  await expect(page.locator('[data-check=save]')).toContainText('отдельным запросом');
  await expect(page.locator('[data-check=python]')).toContainText('чтение тестового файла');
  await expect(page.locator('iframe')).toHaveCount(0);
  const after=await (await page.request.get(config.origin+'/api/history')).json();
  expect(after.h).toEqual(before.h);
});
test('closing a running diagnostic cancels Python and returns keyboard focus',async({page,context})=>{
  await open(page,context,1);
  // Hold runtime startup so cancellation is deterministic, even with fast cached WASM.
  await page.route('**/vendor/pyodide/pyodide.js',route=>new Promise(resolve=>{
    page.once('close',()=>resolve());
  }));
  await page.getByRole('button',{name:'Начать проверку',exact:true}).click();
  await expect(page.locator('[data-check=python]')).toHaveAttribute('data-state','running');
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  const trigger=page.getByRole('button',{name:'Проверить перед уроком',exact:true});
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.locator('[data-run]')).toBeEnabled();
  await expect(page.locator('[data-check=python]')).toHaveAttribute('data-state','waiting');
  await expect(page.locator('[data-check=python]')).toContainText('остановлена');
});
