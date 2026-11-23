const {test,expect}=require('@playwright/test');
const {startFixture,seedBrowser}=require('./fixture.cjs');
let fixture;
test.beforeAll(async()=>{fixture=await startFixture();});
test.afterAll(async()=>{await fixture?.stop();});

async function openLearningEntry(page, group, entry) {
  await page.locator('[data-tile-key="' + group + '"]').click();
  await page.locator('[data-learning-entry="' + entry + '"]').click();
}

test('learning UI downloads only on navigation, retries failure and shares one cached script',async({page,context})=>{
  await seedBrowser(context,fixture);let transfers=0;
  await page.route('**/app-learning.js*',route=>++transfers===1?route.abort():route.continue());
  await page.goto(fixture.origin+'/');await expect(page.locator('[data-tile-key="courses"]')).toBeVisible();
  expect(transfers).toBe(0);
  await page.locator('[data-hub-n="5"]').first().click();await page.locator('#pyBtn').click();
  await expect(page.locator('#pyCode')).toBeEditable();expect(transfers).toBe(0);
  await page.locator('#hubBack').click();await openLearningEntry(page, 'courses', 'course');
  await expect(page.getByRole('button',{name:'Повторить загрузку'})).toBeVisible();
  await page.getByRole('button',{name:'Повторить загрузку'}).click();
  await expect(page.locator('.crs-hero')).toBeVisible();expect(transfers).toBe(2);
  await page.locator('#hubBack').click();await openLearningEntry(page, 'labs', 'tasks');
  await expect(page.locator('#labRoot')).toBeVisible();expect(transfers).toBe(2);
  expect(await page.evaluate(()=>typeof window.EgeLearningSections)).toBe('undefined');
});

test('delayed learning download cannot overwrite a task opened afterward',async({page,context})=>{
  await seedBrowser(context,fixture);let resume, requested;
  const waiting=new Promise(resolve=>{requested=resolve;});
  await page.route('**/app-learning.js*',async route=>{requested();await new Promise(resolve=>{resume=resolve;});await route.continue();});
  await page.goto(fixture.origin+'/');await openLearningEntry(page, 'courses', 'course');await waiting;
  await page.locator('#hubBack').click();await page.locator('[data-hub-n="5"]').first().click();
  await expect(page.locator('#cond')).toContainText('Пять');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/app-learning.js');
  resume();expect((await response).status()).toBe(200);
  await expect.poll(()=>page.evaluate(()=>typeof window.EgeLearningSections)).toBe('undefined');
  await expect(page.locator('#cond')).toContainText('Пять');await expect(page.locator('#answerInputs input').first()).toBeEditable();
});

test('real course and Python level retain slides, editor drafts and lab return context after extraction',async({page,context})=>{
  await seedBrowser(context,fixture);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.origin+'/');await openLearningEntry(page, 'courses', 'course');
  await page.locator('[data-lesson="7"]').click();await expect(page.locator('#crsDeck .crs-stage')).not.toBeEmpty();
  await page.locator('[data-deck="1"]').click();const slide=await page.locator('.crs-count').textContent();
  await page.locator('[data-learning-lab="image"]').click();await expect(page.locator('#labRoot')).toBeVisible();
  await page.locator('[data-learning-return]').click();await expect(page.locator('.crs-count')).toHaveText(slide);
  await page.goBack();await expect(page.locator('#labRoot')).toBeVisible();
  await page.goForward();await expect(page.locator('.crs-count')).toHaveText(slide);
  await page.locator('#hubBack').click();await openLearningEntry(page, 'courses', 'python');
  await page.locator('[data-pyc-lv="m01:0"]').first().click();
  await expect(page.locator('.pyc-task')).toBeVisible();
  await page.locator('[data-pyc-py]').first().click();await expect(page.locator('#pyCode')).toBeEditable();
  await page.locator('#pyCode').fill('print("draft stays in this pupil session")');
  await page.locator('#pycDockLab').click();await expect(page.locator('#labCode')).toHaveValue('print("draft stays in this pupil session")');
  await page.locator('[data-learning-return]').click();await expect(page.locator('.pyc-task')).toBeVisible();
  await page.locator('[data-pyc-py]').first().click();await expect(page.locator('#pyCode')).toHaveValue('print("draft stays in this pupil session")');
  expect(errors).toEqual([]);
});
