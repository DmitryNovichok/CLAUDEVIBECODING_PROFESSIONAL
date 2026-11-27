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

test('teacher publishes the MCKO score and reward from the class journal', async ({page, context, browser}) => {
  await seedBrowser(context, fixture);
  const teachers = await browser.newContext();
  try {
    await seedBrowser(teachers, fixture, 'teacher', fixture.principal);
    const teacher = await teachers.newPage();
    const post = async (client, path, data) => {
      const response = await client.request.post(fixture.origin + path, {headers: {Origin: fixture.origin}, data});
      expect(response.status()).toBe(200);
      return response.json();
    };
    const name = 'Практика диагностики';
    const cls = await post(teachers, '/api/admin/class/save', {name:'Учебный класс МЦКО'});
    await post(teachers, '/api/admin/class/members', {class_id:cls.id, students:[fixture.student.sid]});
    const work = await post(teachers, '/api/admin/mcko/work', {title:name, class_id:cls.id, mode:'fixed', variant:1, hide_result:true});
    const {run} = await post(context, '/api/mcko/start', {work:work.id, first_name:'Учебный', last_name:'Ученик', klass:'10'});
    const report = await (await teachers.request.get(fixture.origin + '/api/admin/mcko/results?id=' + work.id)).json();
    for (const task of report.rows[0].tasks.slice(0, 12)) {
      await post(context, '/api/mcko/save', {run, q:task.q, values:task.key});
    }
    await page.goto(fixture.origin + '/');
    await page.locator('[data-tile-key="mcko"]').click();
    await page.locator('[data-mk-open="' + work.id + '"]').click();
    await page.locator('[data-mkx-page="confirm"]').click();
    await page.locator('[data-mkx-finish]').click();
    await expect(page.locator('.mkx-proto')).toContainText('Результат сообщит учитель');
    await expect(page.locator('.mkx-total')).toHaveCount(0);

    await teacher.goto(fixture.origin + '/admin');
    await teacher.locator('#tabs [data-tab="classes"]').click();
    await teacher.locator('[data-class="' + cls.id + '"]').click();
    await teacher.locator('#clsTabs [data-pane="journal"]').click();
    await expect(teacher.locator('#clsJournal tbody')).toContainText('12/14');
    await teacher.locator('[data-jr-mcko="' + work.id + '"]').click();
    await expect(teacher.locator('#mkBody h3').first()).toContainText(name);
    await teacher.getByRole('button', {name:'Открыть баллы и начислить награды'}).click();
    await expect(teacher.locator('[data-mk-publish]')).toHaveCount(0);
    await page.getByRole('button', {name:'К списку работ'}).click();
    const card = page.locator('.mk-card').filter({hasText:name});
    await expect(card).toContainText('заработано 24 ₿');
    await card.getByRole('button', {name:'Протокол'}).click();
    await expect(page.locator('.mkx-total tr').filter({hasText:'Награда за попытку'})).toContainText('24 ₿');
  } finally {
    await teachers.close();
  }
});
