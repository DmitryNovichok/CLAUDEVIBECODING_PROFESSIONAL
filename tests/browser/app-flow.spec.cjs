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

test('task marker draws and erases under the pointer at all saved interface sizes', async ({browser}) => {
  for (const [size, dpr] of [[0, 1], [1, 2], [2, 1.25], [3, 2]]) {
    const context = await browser.newContext({viewport: {width: 1170, height: 520}, deviceScaleFactor: dpr});
    try {
      await seedBrowser(context, fixture);
      await context.addInitScript(size => {
        if (window === window.top) localStorage.setItem('egeTrainer.view', JSON.stringify({size}));
      }, size);
      const page = await context.newPage();
      await page.goto(fixture.origin + '/');
      await page.locator('[data-hub-n="5"]').click();
      await page.locator('#markBtn').click();
      const canvas = page.locator('#cond .mark-canvas.active');
      await canvas.evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 140));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const rect = await canvas.boundingBox();
      const start = {x: Math.round(rect.x + rect.width * .28), y: Math.round(rect.y + rect.height * .25)};
      const end = {x: Math.round(rect.x + rect.width * .72), y: Math.round(rect.y + rect.height * .7)};
      const alphaAt = point => canvas.evaluate((el, p) => {
        const r = el.getBoundingClientRect();
        const x = Math.floor((p.x - r.left) * el.width / r.width);
        const y = Math.floor((p.y - r.top) * el.height / r.height);
        return el.getContext('2d').getImageData(x, y, 1, 1).data[3];
      }, point);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, {steps: 8});
      await page.mouse.up();
      for (const p of [start, {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2}, end]) {
        expect(await alphaAt(p), 'ink at pointer, size ' + size + ', DPR ' + dpr).toBeGreaterThan(32);
      }

      await page.setViewportSize({width: 1050, height: 520});
      await page.getByRole('button', {name: 'Ластик', exact: true}).click();
      await expect.poll(() => canvas.evaluate(el => el.clientWidth === el.parentElement.clientWidth)).toBe(true);
      const next = await canvas.boundingBox();
      const k = next.width / rect.width;
      const saved = {x: next.x + (end.x - rect.x) * k, y: next.y + (end.y - rect.y) * k};
      expect(await alphaAt(saved)).toBeGreaterThan(32);
      await page.mouse.click(saved.x, saved.y);
      expect(await alphaAt(saved)).toBe(0);
    } finally {
      await context.close();
    }
  }
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

test('automatic league summary is shared across browsers; the league still opens manually', async ({browser}) => {
  const pupil = fixture.participants[0];
  for (const first of [true, false]) {
    const context = await browser.newContext();
    try {
      await context.addCookies([{name: 'egest', value: pupil.token, url: fixture.origin}]);
      await context.addInitScript(sid => {
        if (window !== window.top) return;
        for (const prefix of ['egeshka.tour.v1.', 'egeshka.pad.rewards-2026-11.', 'egeshka.stories.labs-lessons-2026-11.'])
          localStorage.setItem(prefix + sid, '1');
      }, pupil.sid);
      const page = await context.newPage();
      const ranking = page.waitForResponse(r => new URL(r.url()).pathname === '/api/leaderboard' && r.request().method() === 'GET');
      await page.goto(fixture.origin);
      expect((await (await ranking).json()).summary_seen).toBe(!first);
      if (first) {
        await expect(page.locator('#forecastBody')).toContainText('Привет! Вот что нового');
        await page.locator('#tourGo').click();
      } else {
        await expect(page.locator('#forecastModal')).toBeHidden();
        await page.locator('[data-hub-go="league"]').click();
        await expect(page.locator('#forecastBody .fm-title')).toHaveText('Рейтинг');
      }
    } finally { await context.close(); }
  }
});

test('version notice expires over Python and the update button dismisses it before reload', async ({page, context}) => {
  await seedBrowser(context, fixture);
  // Advance only the two-minute release check. The notice itself uses its real timeout.
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const interval = window.setInterval;
    window.setInterval = function(callback, ms, ...args) {
      if (ms === 120000) window.pollRelease = callback;
      return interval.call(this, callback, ms, ...args);
    };
  });
  let build = 'one', broken = false;
  await page.route(/\/(app\.js|style\.css|changelog\.js)(\?|$)/, route => {
    if (route.request().method() !== 'HEAD') return route.continue();
    return route.fulfill({status: broken ? 503 : 200, headers: broken ? {} : {ETag: '"' + build + '"'}, body: ''});
  });
  await page.goto(fixture.origin);
  await page.locator('[data-hub-n="5"]').click();
  await page.locator('#pyBtn').click();
  await page.locator('#pyCode').fill('print(42)');
  const poll = () => page.evaluate(() => window.pollRelease());
  const bar = page.locator('.ver-bar');
  broken = true;
  await poll();
  await expect(bar).toHaveCount(0);
  broken = false;
  build = 'two';
  await poll();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCount(0, {timeout: 4500});
  await expect(page.locator('#pyCode')).toHaveValue('print(42)');
  await poll();
  await expect(bar).toHaveCount(0);
  build = 'three';
  await poll();
  await expect(bar).toBeVisible();
  // Inspect the old document on its way out, before a new page can hide a persistent bar.
  await page.evaluate(() => addEventListener('pagehide', () =>
    sessionStorage.setItem('test.noticeStillPresent', String(!!document.querySelector('.ver-bar'))), {once: true}));
  await Promise.all([page.waitForEvent('domcontentloaded'), bar.getByRole('button', {name: 'Обновить'}).click()]);
  expect(await page.evaluate(() => sessionStorage.getItem('test.noticeStillPresent'))).toBe('false');
  await expect(bar).toHaveCount(0);
});

test('support keeps the conversation after an answer, reward and reload for both accounts', async ({page, context, browser}) => {
  const registration = await context.request.post(fixture.origin + '/api/login', {data: {
    mode: 'register', consent: true, code: '1234', name: 'Ученик Поддержки', new_password: 'fixture-password'
  }});
  expect(registration.ok()).toBe(true);
  const pupil = await registration.json();
  await seedBrowser(context, fixture, 'pupil', pupil);
  const staff = await browser.newContext();
  try {
    await seedBrowser(staff, fixture, 'teacher', fixture.principal);
    await page.goto(fixture.origin);
    const open = () => page.locator('#hubSupport:visible, #supportBtn:visible').first().click();
    await open();
    await page.locator('#spKind').selectOption('bug');
    const question = 'После запуска пустое окно вывода';
    await page.locator('#spText').fill(question);
    await page.locator('#spForm [type=submit]').click();
    const mine = page.locator('.sp-item').filter({hasText: question});
    await expect(mine).toBeVisible();
    const id = await mine.getAttribute('data-sp');
    const teacher = await staff.newPage();
    teacher.on('dialog', dialog => dialog.accept());
    await teacher.goto(fixture.origin + '/admin');
    const tab = teacher.locator('[data-tab="site"]');
    await tab.click();
    const card = teacher.locator('.sp-a[data-sp="' + id + '"]');
    await expect(card).toContainText(question);
    const answer = 'Исправили вывод, проверь ещё раз';
    await card.locator('textarea').fill(answer);
    await card.locator('[data-sp-send]').click();
    await expect(card.locator('.sp-a-ans')).toHaveText(new RegExp(answer));
    await card.locator('textarea').fill('Черновик уточнения');
    await card.locator('summary').click();
    await card.locator('[data-sp-rw="bug"]').click();
    await expect(card.locator('[data-sp-rw="bug"]')).toBeDisabled();
    await expect(card.locator('textarea')).toHaveValue('Черновик уточнения');
    await expect(card).toContainText('Начислено +250 ₿');
    await teacher.reload();
    await tab.click();
    await expect(card).toContainText(answer);
    await expect(card).toContainText('Начислено +250 ₿');
    await expect(card.locator('[data-sp-rw="bug"]')).toBeDisabled();

    await page.reload();
    await open();
    await expect(mine.locator('.sp-thread > *')).toHaveCount(3);
    await expect(mine).toContainText(answer);
    await expect(mine).toContainText('Начислено +250 ₿');
    // Убираем прочитанную тему со стартовой страницы архива.
    for (let i = 0; i < 21; i++) {
      const res = await context.request.post(fixture.origin + '/api/support',
        {headers: {'X-Token': pupil.token}, data: {kind:'bug', text:'Следующая тема ' + i}});
      expect(res.ok()).toBe(true);
    }
    await page.reload();
    await open();
    await expect(page.locator('.sp-item')).toHaveCount(20);
    await expect(mine).toHaveCount(0);
    await page.locator('#forecastBody [data-sp-more]').click();
    await expect(mine).toContainText(answer);
    await expect(mine).toContainText('Начислено +250 ₿');
    await page.locator('#forecastModal .fm-close').click();
    await page.locator('#bellBtn').click();
    await page.locator('[data-nt-go="support"][data-nt-id="' + id + '"]').first().click();
    await expect(mine).toBeFocused();
    await expect(mine).toContainText(answer);
  } finally {
    await staff.close();
  }
});
