// Browser regressions for the real landing/login assets. Only synthetic local data.
const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
let server, origin, adminRequests = [];
test.use({ reducedMotion: 'reduce' });

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname.startsWith('/api/admin/')) adminRequests.push(url.pathname);
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/course/coverage') return res.end(JSON.stringify({topics:
        Array.from({length:27}, (_, i) => ({n:i+1,kind:[7,13,17].includes(i+1)?'lesson':'guide',archive:false}))}));
      if (url.pathname === '/api/admin/login') return res.end(JSON.stringify({need_code:true,ticket:'synthetic-only',to:'demo@example.invalid'}));
      return res.end('{}');
    }
    let name = url.pathname.replace(/^\//, '');
    if (name === 'welcome') name = 'welcome.html';
    if (name === 'admin') name = 'admin.html';
    if (name === 'admin.js') name = 'admin-login.js';
    const file = path.resolve(ROOT, name);
    if (!file.startsWith(ROOT + path.sep) || !/\.(html|js|css|svg|png|jpg|woff2|ico)$/.test(file) || !fs.existsSync(file)) {
      res.writeHead(404); return res.end('not found');
    }
    const type = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
  adminRequests = [];
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

test('signup keeps keyboard focus, makes background inert and restores its trigger', async ({ page }) => {
  await page.goto(origin + '/welcome');
  const trigger = page.getByRole('button', {name:'Я учитель', exact:true}).first();
  await trigger.click();
  await expect(page.getByLabel('Фамилия, имя и отчество')).toBeFocused();
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(true);
  for (let i=0;i<14;i++) {
    await page.keyboard.press(i<3 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#signupModal'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#signupModal')).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(false);
});

test('synthetic demo works without accessing teacher accounts', async ({ page }) => {
  await page.goto(origin + '/welcome#demo');
  await page.getByLabel('Тема первой подборки').selectOption('13');
  await page.getByRole('button', {name:'Выдать демо-подборку', exact:true}).click();
  await expect(page.locator('#demoResult')).toContainText('Демо-подборка · № 13');
  await expect(page.locator('#demoResult tbody tr')).toHaveCount(5);
  await page.getByRole('button', {name:'Разобрать: Борис Демо', exact:true}).click();
  await expect(page.locator('#demoDetail')).toContainText('Вернуться к условию');
  await expect(page.locator('#demoDetail')).toContainText('самостоятельное задание по № 13');
  expect(adminRequests).toEqual([]);
  await page.getByRole('button', {name:'Начать пример заново', exact:true}).click();
  await expect(page.locator('#demoResult')).toContainText('Здесь появится журнал');
});

test('coverage uses actual metadata and makes no all-27-full-lesson promise', async ({ page }) => {
  await page.goto(origin + '/welcome');
  await expect(page.locator('#courseFullCount')).toHaveText('3');
  await expect(page.locator('#wNums .full')).toHaveCount(3);
  await expect(page.locator('#courseCoverageNote')).toContainText('краткие разборы (24)');
  await expect(page.getByText('уроки по всем 27 номерам', {exact:true})).toHaveCount(0);
});

test('teacher login has persistent labels, login-first focus and accessible code step', async ({ page }) => {
  await page.goto(origin + '/admin');
  const login = page.getByLabel('Почта или логин', {exact:true});
  await expect(login).toBeFocused();
  await login.fill('demo@example.invalid');
  await page.getByLabel('Пароль', {exact:true}).fill('synthetic-local-password');
  await page.getByRole('button', {name:'Войти',exact:true}).click();
  await expect(page.getByLabel('Код из письма или резервный код', {exact:true})).toBeFocused();
  await expect(page.locator('label[for=admLogin]')).toBeHidden();
  await expect(page.locator('label[for=admPassword]')).toBeHidden();
  await expect(page.locator('#admCodeNote')).toContainText('Почтовый сервер принял письмо');
  await page.getByRole('button', {name:'← Ввести пароль заново',exact:true}).click();
  await expect(page.getByLabel('Пароль', {exact:true})).toBeFocused();
});

test('mail outage offers backup factor and submits its complete one-use code', async ({ page }) => {
  const submitted = [];
  await page.route('**/api/admin/login', async route => {
    const body = route.request().postDataJSON(); submitted.push(body);
    await route.fulfill({status: body.ticket ? 403 : 200, contentType:'application/json', body:JSON.stringify(body.ticket
      ? {error:'Синтетическая проверка: код принят полностью'}
      : {need_code:true,ticket:'backup-only-synthetic',backup_only:true,delivery:'unavailable'})});
  });
  await page.goto(origin + '/admin');
  await page.getByLabel('Почта или логин', {exact:true}).fill('owner@example.invalid');
  await page.getByLabel('Пароль', {exact:true}).fill('synthetic-local-password');
  await page.getByRole('button', {name:'Войти',exact:true}).click();
  await expect(page.locator('#admCodeNote')).toContainText('отправка письма сейчас недоступна');
  const code = '1234abcd-1234abcd-1234abcd-1234abcd';
  await page.getByLabel('Код из письма или резервный код', {exact:true}).fill(code);
  await page.getByRole('button', {name:'Войти',exact:true}).click();
  await expect(page.locator('#admLoginErr')).toContainText('код принят полностью');
  expect(submitted[1]).toEqual({ticket:'backup-only-synthetic', code});
});

test('primary action text contrast and mobile layout remain readable', async ({ page }) => {
  await page.setViewportSize({width:320,height:750});
  await page.goto(origin + '/welcome#demo');
  const ratio = await page.locator('#demoAssign').evaluate(el => {
    const style = getComputedStyle(el);
    const luminance = rgb => rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v/255).map(v => v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const a=luminance(style.color),b=luminance(style.backgroundColor);
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.locator('#demoAssign').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('login binds rejected credentials to fields but keeps transport errors general',async({page})=>{
  let status=403;
  await page.route('**/api/admin/login',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:status===403?'Неверный логин или пароль':'Отправка почты временно недоступна'})}));
  await page.goto(origin+'/admin');
  const login=page.getByLabel('Почта или логин',{exact:true}),password=page.getByLabel('Пароль',{exact:true});
  await login.fill('synthetic@example.invalid');await password.fill('synthetic-password');
  await page.getByRole('button',{name:'Войти',exact:true}).click();
  for(const field of [login,password]) {
    await expect(field).toHaveAttribute('aria-invalid','true');
    await expect(field).toHaveAccessibleDescription('Неверный логин или пароль');
  }
  await password.fill('new-synthetic-password');
  await expect(password).not.toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#admLoginErr')).toBeEmpty();
  status=503;await page.getByRole('button',{name:'Войти',exact:true}).click();
  await expect(page.locator('#admLoginErr')).toHaveText('Отправка почты временно недоступна');
  for(const field of [login,password]) await expect(field).not.toHaveAttribute('aria-invalid','true');
});
for(const width of [320,375,1366]) {
  test(`guest signup and teacher login keep shared readable controls at ${width}px`,async({page},info)=>{
    const {recordUI}=require('./ui-evidence.cjs');
    await page.setViewportSize({width,height:900});
    await page.goto(origin+'/welcome#signup');
    await expect(page.locator('#signupModal')).toBeVisible();
    const signup=await page.locator('#suPass').evaluate(el=>{const s=getComputedStyle(el);return{height:el.getBoundingClientRect().height,radius:s.borderRadius,color:s.color};});
    await page.route('**/api/teacher/signup',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Сервис временно недоступен, повторите позже'})}));
    await page.locator('#suName').fill('Пример Учитель');await page.locator('#suEmail').fill('synthetic@example.invalid');
    await page.locator('#suPass').fill('synthetic-password');await page.locator('#suAccept').check();
    await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
    await expect(page.locator('#suEmail')).toHaveAccessibleDescription('Сервис временно недоступен, повторите позже');
    await expect(page.getByRole('alert')).toHaveText('Сервис временно недоступен, повторите позже');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await recordUI(page,info,'signup-'+width);
    await page.goto(origin+'/admin');
    await expect(page.locator('#admLogin')).toBeFocused();
    const login=await page.locator('#admPassword').evaluate(el=>{const s=getComputedStyle(el);return{height:el.getBoundingClientRect().height,radius:s.borderRadius,color:s.color};});
    expect(login.height).toBeGreaterThanOrEqual(44);expect(signup.height).toBeGreaterThanOrEqual(44);
    expect(login.radius).toBe(signup.radius);expect(login.color).toBe(signup.color);
    await expect(page.locator('#admPassword')).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await recordUI(page,info,'login-'+width);
  });
}

test('screenshot preview opens by keyboard and returns focus after Escape',async({page})=>{
  await page.goto(origin+'/welcome');
  const image=page.locator('img[data-zoom]').first();await image.focus();await page.keyboard.press('Enter');
  const modal=page.getByRole('dialog',{name:'Снимок экрана крупно'});await expect(modal).toBeVisible();
  for(let i=0;i<4;i++) {await page.keyboard.press(i%2?'Tab':'Shift+Tab');expect(await page.evaluate(()=>!!document.activeElement.closest('#wZoom'))).toBe(true);}
  await page.keyboard.press('Escape');await expect(modal).toBeHidden();await expect(image).toBeFocused();
});
test('main pupil action keeps contrast in normal, hover and keyboard focus states',async({page})=>{
  await page.goto(origin+'/welcome');
  const action=page.getByRole('link',{name:'Я ученик',exact:true}).first();
  const ratio=()=>action.evaluate(el=>{
    const s=getComputedStyle(el),light=rgb=>rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const a=light(s.color),b=light(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  expect(await ratio()).toBeGreaterThanOrEqual(4.5);await action.hover();expect(await ratio()).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Tab');await action.focus();expect(await ratio()).toBeGreaterThanOrEqual(4.5);
  const focus=await action.evaluate(el=>({width:getComputedStyle(el).outlineWidth,style:getComputedStyle(el).outlineStyle}));
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);expect(focus.style).not.toBe('none');
});
