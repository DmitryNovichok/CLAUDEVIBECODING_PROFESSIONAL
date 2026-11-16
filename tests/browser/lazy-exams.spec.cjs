const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');
let fixture;
test.beforeAll(async()=>{fixture=await startFixture();});
test.afterAll(async()=>{await fixture?.stop();});

test('exam sections download on demand, recover from a failed transfer and reuse their code',async({page,context})=>{
  await seedBrowser(context,fixture);
  let transfers=0;
  await page.route('**/app-exams.js*',route=>++transfers===1?route.abort():route.continue());
  await page.goto(fixture.origin+'/');
  await expect(page.locator('[data-tile-key="mcko"]')).toBeVisible();
  expect(transfers).toBe(0);
  await page.locator('[data-tile-key="mcko"]').click();
  await expect(page.getByRole('button',{name:'Повторить загрузку'})).toBeVisible();
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await expect(page.getByRole('heading',{name:'Работ пока нет'})).toBeVisible();
  expect(transfers).toBe(2);
  await page.locator('#hubBack').click();
  await page.locator('[data-tile-key="mcko"]').click();
  await expect(page.getByRole('heading',{name:'Работ пока нет'})).toBeVisible();
  expect(transfers).toBe(2);
  expect(await page.evaluate(()=>typeof window.EgeExamSections)).toBe('undefined');
});

test('a delayed optional download cannot replace the task opened in the meantime',async({page,context})=>{
  await seedBrowser(context,fixture);
  let resume, requested;
  const waiting=new Promise(resolve=>{requested=resolve;});
  await page.route('**/app-exams.js*',async route=>{
    requested();await new Promise(resolve=>{resume=resolve;});await route.continue();
  });
  await page.goto(fixture.origin+'/');
  await page.locator('[data-tile-key="mcko"]').click();await waiting;
  await page.locator('#hubBack').click();
  await page.locator('[data-hub-n="5"]').first().click();
  await expect(page.locator('#cond')).toContainText('Пять');
  const script=page.waitForResponse(r=>new URL(r.url()).pathname==='/app-exams.js');
  resume();expect((await script).status()).toBe(200);
  await expect.poll(()=>page.evaluate(()=>typeof window.EgeExamSections)).toBe('undefined');
  await expect(page.locator('#cond')).toContainText('Пять');
  await expect(page.locator('#answerInputs input').first()).toBeEditable();
});
