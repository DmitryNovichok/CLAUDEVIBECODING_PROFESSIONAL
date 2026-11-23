// Real routes + shipped application assets; no mocked auth, task or grading API.
const { test, expect } = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');
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

for (const width of [320, 375, 1366]) {
  test(`moderation keeps the sign-in brand, readable controls and trial explanation at ${width}px`, async ({page, context}, info) => {
    const {recordUI}=require('./ui-evidence.cjs');
    await page.setViewportSize({width,height:900});
    await page.goto(fixture.origin+'/admin');
    await expect(page.locator('#admLogin')).toBeVisible();
    const login = await page.locator('#admLogin').evaluate(el => {
      const s=getComputedStyle(el); return {font:s.fontFamily,radius:s.borderRadius,color:s.color};
    });
    await expect(page.locator('.adm-login-new')).toContainText('Доступ — после подтверждения почты и одобрения');
    const teacher=fixture.teachers.find(t=>!t.email_ok&&t.moderation==='pending');
    await context.addCookies([{name:'egeadm',value:teacher.cookie,url:fixture.origin,httpOnly:true,sameSite:'Strict'}]);
    await page.goto(fixture.origin+'/admin');
    await expect(page.locator('#emailBadge')).toHaveText('Нужно подтвердить');
    await expect(page.locator('.brand')).toHaveAccessibleName('Egeshka by Malevin');
    await expect(page.locator('.brand img')).toHaveAttribute('src','/favicon.svg');
    await expect(page.locator('main')).toContainText('Пройдите модерацию');
    await page.locator('#editEmail').click();
    const email=page.getByLabel('Адрес почты (станет логином)',{exact:true});
    await expect(email).toBeFocused();
    const gate=await email.evaluate(el=>{
      const s=getComputedStyle(el);return {font:s.fontFamily,radius:s.borderRadius,color:s.color,height:el.getBoundingClientRect().height};
    });
    expect(gate.font).toBe(login.font);expect(gate.radius).toBe(login.radius);expect(gate.color).toBe(login.color);
    expect(gate.height).toBeGreaterThanOrEqual(44);
    const submit=page.getByRole('button',{name:'Сохранить и отправить письмо',exact:true});
    const ratio=await submit.evaluate(el=>{
      const s=getComputedStyle(el),light=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      const a=light(s.color),b=light(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await submit.focus();
    expect(await submit.evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await recordUI(page,info,'teacher-gate-'+width);
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
    localStorage.setItem('egeshka.pad.rewards-2026-11.'+sid,'1');
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
    const {recordUI}=require('./ui-evidence.cjs');
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

for (const width of [375, 1366]) {
  test(`catalogue home button beside Egeshka returns to the dashboard at ${width}px`, async ({page, context}) => {
    await page.setViewportSize({width, height: 900});
    await seedBrowser(context, fixture);
    // Existing pupils may have saved the old collapsed icon strip.
    await context.addInitScript(() => localStorage.setItem('egeTrainer.sideMin', '1'));
    await page.goto(fixture.origin + '/');
    await page.locator('[data-hub-n="5"]').first().click();
    await expect(page.locator('#cond')).toContainText('Пять');

    const more = page.getByRole('button', {name: 'Ещё', exact: true});
    const menu = page.getByRole('dialog', {name: 'Разделы Egeshka'});
    if (width === 375) {
      await more.click();
      await menu.getByRole('button', {name: /Номера заданий/}).click();
    } else {
      await page.getByRole('button', {name: 'Номера', exact: true}).click();
    }

    const sidebar = page.locator('.sidebar');
    const home = sidebar.locator('#homeCard');
    const brand = sidebar.locator('.brand-title');
    await expect(sidebar.locator('.rail')).toHaveCount(0);
    await expect(home).toBeVisible();
    await expect(home).toHaveAccessibleName(/главн/i);
    await expect(brand).toHaveText('Egeshka');
    await expect(brand).toBeVisible();
    const icon = await home.boundingBox();
    const title = await brand.boundingBox();
    const gap = Math.max(icon.x - title.x - title.width, title.x - icon.x - icon.width);
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThan(24);
    expect(Math.min(icon.y + icon.height, title.y + title.height)).toBeGreaterThan(Math.max(icon.y, title.y));
    await home.press('Enter');
    await expect(page.getByRole('heading', {name: 'Все разделы'})).toBeVisible();
    await expect(home).toBeHidden();
    await expect(page.locator('#navShade')).toBeHidden();

    if (width === 375) {
      await more.click();
      await menu.getByRole('button', {name: /Вариант ЕГЭ/}).click();
      await expect(menu).toBeHidden();
      await expect(page.getByRole('heading', {name: 'Мои варианты'})).toBeVisible();
    }
  });
}
