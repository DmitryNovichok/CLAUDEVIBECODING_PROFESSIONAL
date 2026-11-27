const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');

let fixture;
test.use({reducedMotion: 'reduce'});
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture?.stop(); });

async function post(context, path, data) {
  const response = await context.request.post(fixture.origin + path, {headers: {Origin: fixture.origin}, data});
  expect(response.status()).toBe(200);
  return response.json();
}

async function enroll(context, teacher, name) {
  const pupil = await post(context, '/api/login', {
    name, code: teacher.cookie, mode: 'register', consent: true, new_password: 'synthetic-pupil-password',
  });
  await seedBrowser(context, fixture, 'pupil', pupil);
  return pupil.sid;
}

async function openJournal(page, classId) {
  await page.goto(fixture.origin + '/admin');
  await page.locator('#tabs [data-tab="classes"]').click();
  await page.locator(`[data-class="${classId}"]`).click();
  await page.locator('#clsTabs [data-pane="journal"]').click();
}

function labCell(page, name) {
  return page.locator('#clsJournal .jr-table tbody tr').filter({hasText: name}).locator('td.jr-lab');
}

async function countForAssignedSubnet(page) {
  const subnet = page.locator('#labAsgSubnet');
  await expect(subnet).toHaveText(/^\s*(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}\s*$/);
  const prefix = Number((await subnet.innerText()).split('/')[1]);
  return 2 ** (32 - prefix);
}

test('assigned network laboratory keeps each first prediction and its model result in the class journal', async ({page: teacher, context, browser}) => {
  const account = fixture.teachers.find(t => t.email_ok && t.moderation === 'approved');
  await seedBrowser(context, fixture, 'teacher', account);
  const mobile = await browser.newContext({viewport: {width: 375, height: 812}, reducedMotion: 'reduce'});
  const desktop = await browser.newContext({viewport: {width: 1366, height: 900}, reducedMotion: 'reduce'});
  const mobileName = 'Практикум Ученик Первый';
  const desktopName = 'Практикум Ученик Второй';
  try {
    const mobileId = await enroll(mobile, account, mobileName);
    const desktopId = await enroll(desktop, account, desktopName);
    const {id: classId} = await post(context, '/api/admin/class/save', {name: 'Практикум №13'});
    await post(context, '/api/admin/class/members', {class_id: classId, students: [mobileId, desktopId]});
    const firstPupil = await mobile.newPage();
    const secondPupil = await desktop.newPage();
    let assignmentId, teacherJournal, firstExpected, secondExpected;

    await test.step('Teacher assigns the network model to this class from its laboratory', async () => {
      await teacher.goto(fixture.origin + '/admin');
      await teacher.locator('#tabs [data-tab="learning"]').click();
      const modelReport = teacher.locator('details[data-learning-report="models"]');
      await modelReport.locator('summary').click();
      await expect(modelReport.locator('#lab13AssignOpen')).toBeVisible();
      const popup = teacher.waitForEvent('popup');
      await teacher.locator('#adminLabBtn').click();
      teacherJournal = await popup;
      await teacherJournal.locator('[data-lab-view="tasks"]').click();
      await teacherJournal.locator('[data-lab-model="net"]').click();
      await teacherJournal.locator('[href="/admin?assign=lab13"]').click();
      await expect(teacherJournal.locator('#lab13AssignForm')).toBeVisible();
      await teacherJournal.locator('#lab13AssignClass').selectOption(String(classId));
      const saving = teacherJournal.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/assignment/lab13' && r.request().method() === 'POST');
      await teacherJournal.locator('#lab13AssignSubmit').click();
      const response = await saving;
      expect(response.status()).toBe(200);
      assignmentId = (await response.json()).id;
      expect(assignmentId).toBeGreaterThan(0);
      await teacherJournal.locator('#lab13AssignJournal').click();
      await expect(labCell(teacherJournal, mobileName)).toContainText('Не начинал');
      await expect(labCell(teacherJournal, desktopName)).toContainText('Не начинал');
    });

    await test.step('Mobile pupil opens the plan, predicts before seeing the model, then experiments', async () => {
      await firstPupil.goto(fixture.origin + '/');
      const step = firstPupil.locator(`[data-step-key="asg:${assignmentId}"]`);
      await expect(step).toContainText('13');
      await step.locator('[data-step-go]').click();
      firstExpected = await countForAssignedSubnet(firstPupil);
      await expect(firstPupil.locator('#labAsgModel')).toBeHidden();
      await expect(firstPupil.locator('#labAsgFeedback')).toBeHidden();
      const liveCell = labCell(teacherJournal, mobileName);
      // The teacher stays on the journal opened at assignment time.
      await expect(liveCell).toContainText('В работе', {timeout: 30000});
      await expect(labCell(teacherJournal, desktopName)).toContainText('Не начинал');

      await firstPupil.locator('#labAsgPrediction').fill(String(firstExpected + 1));
      await firstPupil.locator('#labAsgCheck').click();
      await expect(firstPupil.locator('#labAsgFeedback')).toContainText('В прогнозе ошибка');
      await expect(liveCell).toContainText('Ошибка в прогнозе', {timeout: 30000});
      await expect(liveCell).toContainText('Прогноз ' + (firstExpected + 1) + ' · Модель ' + firstExpected);
      const count = firstPupil.locator('#labAsgModelCount');
      await expect(count).toHaveText(firstExpected.toLocaleString('ru-RU'));
      await firstPupil.locator('#labAsgIp').fill('10.10.9.8');
      await firstPupil.locator('#labAsgPrefix').focus();
      await firstPupil.keyboard.press('End');
      await expect(count).toHaveText('1');
      await expect(firstPupil.locator('#labAsgPrediction')).toHaveCount(0);
      // Simulate a stale tab trying to submit the correct value after seeing the model.
      const repeated = await post(mobile, '/api/asg/lab13/answer', {id: assignmentId, prediction: firstExpected});
      expect(repeated).toMatchObject({correct: false, prediction: firstExpected + 1, expected: firstExpected});
      expect(await firstPupil.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    await test.step('A second pupil opens the assignment list and submits a correct first prediction', async () => {
      await secondPupil.goto(fixture.origin + '/');
      await secondPupil.locator('[data-tile-key="asg"]').click();
      await secondPupil.locator(`[data-asg="${assignmentId}"]`).click();
      secondExpected = await countForAssignedSubnet(secondPupil);
      await secondPupil.locator('#labAsgPrediction').fill(String(secondExpected));
      await secondPupil.locator('#labAsgCheck').click();
      await expect(secondPupil.locator('#labAsgFeedback')).toContainText('Прогноз верный');
      await expect(secondPupil.locator('#labAsgModelCount')).toHaveText(secondExpected.toLocaleString('ru-RU'));
    });

    await test.step('Result survives reopening and leaves the full lab password gate in place', async () => {
      await firstPupil.goto(fixture.origin + '/');
      await firstPupil.locator('[data-tile-key="asg"]').click();
      await firstPupil.locator('[data-asg-tab="done"]').click();
      await firstPupil.locator(`[data-asg="${assignmentId}"]`).click();
      await expect(firstPupil.locator('#labAsgFeedback')).toContainText('В прогнозе ошибка');
      await expect(firstPupil.locator('#labAsgFeedback')).toContainText((firstExpected + 1).toLocaleString('ru-RU'));
      await expect(firstPupil.locator('#labAsgModelCount')).toHaveText(firstExpected.toLocaleString('ru-RU'));
      await firstPupil.goto(fixture.origin + '/');
      await firstPupil.locator('[data-tile-key="labs"]').click();
      await firstPupil.locator('[data-learning-entry="tasks"]').click();
      await expect(firstPupil.locator('#labPassword')).toBeVisible();
    });

    await test.step('Fresh teacher journal shows both original predictions and the respective model counts', async () => {
      await openJournal(teacherJournal, classId);
      const first = labCell(teacherJournal, mobileName);
      const second = labCell(teacherJournal, desktopName);
      await expect(first).toContainText('Ошибка в прогнозе');
      await expect(second).toContainText('Верный прогноз');
      for (const [cell, prediction, expected] of [[first, firstExpected + 1, firstExpected], [second, secondExpected, secondExpected]]) {
        await expect(cell).toContainText('Прогноз ' + prediction);
        await expect(cell).toContainText('Модель ' + expected);
      }
      await teacherJournal.locator(`[data-jr-asg="${assignmentId}"]`).click();
      const report = teacherJournal.locator(`#live-${assignmentId}`);
      await expect(report).toContainText('Сдали прогноз: 2 из 2');
      await expect(report.getByRole('columnheader', {name: 'Первый прогноз'})).toBeVisible();
      const firstRow = report.locator('tbody tr').filter({hasText: mobileName});
      await expect(firstRow.getByRole('cell').nth(3)).toHaveText(String(firstExpected + 1));
      await expect(firstRow.getByRole('cell').nth(4)).toHaveText(String(firstExpected));
    });
  } finally {
    await desktop.close();
    await mobile.close();
  }
});
