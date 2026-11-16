// Real routes + shipped application assets; no mocked auth, task or grading API.
const { test, expect } = require('@playwright/test');
const {startFixture} = require('./fixture.cjs');
const fs = require('node:fs/promises');
let fixture;
test.use({ reducedMotion: 'reduce' });
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture?.stop(); });
test.beforeEach(async ({page}) => {
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
});

for(const combination of [{email_ok:false,moderation:'pending'},{email_ok:true,moderation:'pending'},{email_ok:false,moderation:'approved'}]){
  test(`teacher gate requires both checks: email=${combination.email_ok}, moderation=${combination.moderation}`,async({page,context})=>{
    const teacher=fixture.teachers.find(t=>t.email_ok===combination.email_ok&&t.moderation===combination.moderation);
    await context.addCookies([{name:'egeadm',value:teacher.cookie,url:fixture.origin,httpOnly:true,sameSite:'Strict'}]);
    await page.goto(fixture.origin+'/admin');
    await expect(page.locator('#teacherGateRoot')).toBeVisible();
    await expect(page.getByRole('heading',{name:/Осталось пройти/})).toBeVisible();
    const profile=await context.request.get(fixture.origin+'/api/admin/me');
    expect(profile.status()).toBe(200);
    const body=await profile.json();
    expect(body.onboarding.ready).toBe(false);
    expect(body).not.toHaveProperty('journey');
    expect(body).not.toHaveProperty('invite');
    expect((await context.request.get(fixture.origin+'/api/admin/classes')).status()).toBe(403);
    expect((await context.request.post(fixture.origin+'/api/admin/class/save',{data:{name:'Must remain closed'}})).status()).toBe(403);
  });
}

test('approved teacher with verified email opens the actual panel',async({page,context})=>{
  const teacher=fixture.teachers.find(t=>t.email_ok&&t.moderation==='approved');
  await context.addCookies([{name:'egeadm',value:teacher.cookie,url:fixture.origin,httpOnly:true,sameSite:'Strict'}]);
  await page.addInitScript(id=>localStorage.setItem('egeshka.atour.v1.'+id,'1'),teacher.id);
  await page.goto(fixture.origin+'/admin');
  await expect(page.locator('#appView')).toBeVisible();
  await expect(page.locator('#admWho')).toContainText('Учитель Пример');
  await expect(page.locator('#stepsCard')).toContainText('Первый результат класса');
  const profile=await context.request.get(fixture.origin+'/api/admin/me');
  const body=await profile.json();
  expect(body.onboarding.ready).toBe(true);
  expect(body.journey.finished_students).toBe(0);
  expect((await context.request.get(fixture.origin+'/api/admin/classes')).status()).toBe(200);
});

test('pupil opens first task, downloads its protected file and saves a correct answer',async({page,context})=>{
  await context.addCookies([{name:'egest',value:fixture.student.token,url:fixture.origin,httpOnly:true,sameSite:'Lax'}]);
  await page.addInitScript(sid=>{
    localStorage.setItem('egeshka.tour.v1.'+sid,'1');
    localStorage.setItem('egeshka.stories.labs-lessons-2026-11.'+sid,'1');
    const d=new Date(),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('egeTrainer.lbShown.'+sid,day);
  },fixture.student.sid);
  await page.goto(fixture.origin+'/');
  await page.locator('[data-hub-n="5"]').click();
  await expect(page.locator('#cond')).toContainText('Пять');
  const downloadPromise=page.waitForEvent('download');
  await page.locator('.files a.file').first().click();
  const download=await downloadPromise;
  expect(await fs.readFile(await download.path(),'utf8')).toBe('10\n20\n12\n');
  await page.locator('#answerInputs input').fill('12');
  const checkResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/check'&&r.request().method()==='POST');
  await page.locator('#checkBtn').click();
  const response=await checkResponse;
  expect(response.status()).toBe(200);
  expect((await response.json()).correct).toBe(true);
  await expect(page.locator('#feedback')).toContainText('Верно!');
  const history=await context.request.get(fixture.origin+'/api/history');
  expect(history.status()).toBe(200);
  expect(JSON.stringify(await history.json())).toContain(fixture.task);
});

for(const width of [320,375,1366]) {
  test(`approved teacher overview and class creation stay usable at ${width}px`,async({page,context},info)=>{
    const {seedBrowser}=require('./fixture.cjs');const {recordUI}=require('./ui-evidence.cjs');
    await page.setViewportSize({width,height:900});await seedBrowser(context,fixture,'teacher');
    await page.goto(fixture.origin+'/admin');await expect(page.locator('#overviewBody')).toBeVisible();
    await recordUI(page,info,'teacher-overview-'+width);
    // Use the first-run action where available, otherwise the same real navigation.
    const profile=await (await context.request.get(fixture.origin+'/api/admin/me')).json();
    const step=page.locator('#stepsCard [data-step-go=classes]');
    if(await step.count()) await step.click(); else await page.locator('#tabs [data-tab=classes]').click();
    const name=page.getByLabel('Название нового класса',{exact:true});
    await expect(name).toBeVisible();await name.fill('Синтетический '+width);
    const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/class/save'&&r.request().method()==='POST');
    await name.press('Enter');expect((await saved).status()).toBe(200);
    const classes=await context.request.get(fixture.origin+'/api/admin/classes');expect(classes.status()).toBe(200);
    expect(JSON.stringify(await classes.json())).toContain('Синтетический '+width);
    expect(profile.onboarding.ready).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await recordUI(page,info,'teacher-classes-'+width);
  });
}
