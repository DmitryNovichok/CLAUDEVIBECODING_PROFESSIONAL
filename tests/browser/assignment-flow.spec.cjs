// Complete two-role journey through shipped pages and the real synthetic HTTP app.
// No grading/auth API is mocked. One real answer response is held to distinguish
// a pending request from a server acknowledgement; the original bytes are released.
const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');
const {recordUI} = require('./ui-evidence.cjs');
let fixture;
test.use({reducedMotion: 'reduce'});
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture?.stop(); });

const posted = (page, path) => page.waitForResponse(response =>
  new URL(response.url()).pathname === path && response.request().method() === 'POST');

async function browserJson(page, path, body) {
  // Used only for persisted-state assertions and intentional transport replays.
  // The browser supplies its actual session cookie and same-origin POST header.
  return page.evaluate(async ({path, body}) => {
    const response = await fetch(path, {cache: 'no-store',
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  }, {path, body});
}

test('teacher invitation and assignment reach a new pupil, survive reload and produce one teacher result', async ({page: teacher, context, browser}, info) => {
  const className = 'Приёмочный класс';
  const pupilName = 'Приёмочный Ученик';
  const title = 'Проверка первого результата';
  const account = fixture.teachers.find(t => t.email_ok && t.moderation === 'approved');
  await seedBrowser(context, fixture, 'teacher', account);
  const pupilContext = await browser.newContext({reducedMotion: 'reduce'});
  await pupilContext.route('**/*', route => new URL(route.request().url()).origin === fixture.origin
    ? route.continue() : route.abort());
  const pupil = await pupilContext.newPage();
  let releaseAnswer;
  try {
    let classId, pupilId, assignmentId;
    await test.step('Teacher creates a class and obtains the invitation from the panel', async () => {
      await teacher.goto(fixture.origin + '/admin');
      await expect(teacher.locator('#stepsCard')).toBeVisible();
      const invitationText = (await teacher.locator('#stepsCard .inv-row code').innerText()).trim();
      const invitation = new URL('http://' + invitationText);
      expect(invitation.origin).toBe(fixture.origin);
      expect(invitation.searchParams.get('invite')).toBeTruthy();
      await teacher.locator('#tabs [data-tab="classes"]').click();
      await teacher.getByLabel('Название нового класса', {exact: true}).fill(className);
      const saving = posted(teacher, '/api/admin/class/save');
      await teacher.getByLabel('Название нового класса', {exact: true}).press('Enter');
      const saved = await saving;
      expect(saved.status()).toBe(200);
      classId = (await saved.json()).id;
      expect(classId).toBeGreaterThan(0);
      await expect(teacher.locator(`[data-class="${classId}"]`)).toContainText(className);

      // A fresh context has neither fixture pupil cookie nor local saved account.
      await pupil.goto(invitation.href);
      await expect(pupil.locator('#regForm')).toBeVisible();
      await expect(pupil.locator('#regCode')).toHaveValue(invitation.searchParams.get('invite'));
      await pupil.locator('#regName').fill(pupilName);
      await pupil.locator('#regLogin').fill('acceptance_pupil');
      await pupil.locator('#regPass').fill('synthetic-pupil-password');
      await pupil.locator('#regPass2').fill('synthetic-pupil-password');
      await pupil.locator('#regTerms').check();
      await pupil.locator('#regConsent').check();
      const registration = posted(pupil, '/api/login');
      // gate() reloads after registration. Chromium may discard the old response
      // body, so identify the pupil through the persisted session in the new page.
      const registeredPage = pupil.waitForEvent('domcontentloaded');
      await pupil.locator('#regForm button[type="submit"]').click();
      const registered = await registration;
      expect(registered.status()).toBe(200);
      await registeredPage;
      const registeredProfile = await browserJson(pupil, '/api/me');
      expect(registeredProfile.status).toBe(200);
      expect(registeredProfile.body.name).toBe(pupilName);
      pupilId = registeredProfile.body.sid;
      expect(pupilId).toBeGreaterThan(0);
      await expect(pupil.locator('#loginModal')).toBeHidden();
      // Suppress only introductory tours after real registration, not auth or work.
      await pupilContext.addInitScript(sid => {
        if (window !== window.top) return;
        localStorage.setItem('egeshka.tour.v1.' + sid, '1');
        localStorage.setItem('egeshka.stories.labs-lessons-2026-11.' + sid, '1');
        const d = new Date();
        localStorage.setItem('egeTrainer.lbShown.' + sid,
          `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
      }, pupilId);
      await pupil.reload();
      await expect(pupil.locator('[data-hub-n="5"]')).toBeVisible();
      const profile = await browserJson(pupil, '/api/me');
      expect(profile.status).toBe(200);
      expect(profile.body.sid).toBe(pupilId);
      expect(profile.body.name).toBe(pupilName);
    });

    await test.step('Teacher puts the invited pupil into the class and issues real work', async () => {
      await teacher.locator('#tabs [data-tab="students"]').click();
      const row = teacher.locator(`#studentsTable tr[data-id="${pupilId}"]`);
      await expect(row).toContainText(pupilName);
      await row.locator('[data-pick]').check();
      await teacher.getByLabel('Класс для выбранных учеников', {exact: true}).selectOption(String(classId));
      const moving = posted(teacher, '/api/admin/class/members');
      await teacher.locator('#bulkMove').click();
      expect((await moving).status()).toBe(200);
      const profile = await browserJson(pupil, '/api/me');
      expect(profile.body.class_id).toBe(classId);

      await teacher.locator('#tabs [data-tab="build"]').click();
      await teacher.locator('#bdClass').selectOption(String(classId));
      await teacher.locator(`#bldList [data-add="${fixture.teacherTask}"]`).click();
      await expect(teacher.locator('#bdSend')).toHaveText('Выдать 1 ученикам');
      await teacher.locator('#bdTitle').fill(title);
      await teacher.locator('#bdKind').selectOption('self');
      const issuing = posted(teacher, '/api/admin/assignment/save');
      await teacher.locator('#bdSend').click();
      const issued = await issuing;
      expect(issued.status()).toBe(200);
      assignmentId = (await issued.json()).id;
      expect(assignmentId).toBeGreaterThan(0);
      const assignments = await browserJson(pupil, '/api/assignments');
      expect(assignments.status).toBe(200);
      const assignment = assignments.body.assignments.find(a => a.id === assignmentId);
      expect(assignment).toMatchObject({title, strict: true, tasks: [fixture.task]});
      expect(assignment.started).toBeFalsy();
      // A different pupil cannot read or begin work just by learning its ID.
      const outsider = await context.request.get(fixture.origin + '/api/asg/state?id=' + assignmentId,
        {headers: {'X-Token': fixture.student.token}});
      expect([403, 404]).toContain(outsider.status());
    });

    await test.step('Pupil submits an answer; the UI waits for the real server acknowledgement', async () => {
      await pupil.reload();
      await pupil.locator('[data-tile-key="asg"]').click();
      const card = pupil.locator(`[data-assignment="${assignmentId}"]`);
      await expect(card).toContainText(title);
      await card.locator('[data-asg]').click();
      const starting = posted(pupil, '/api/asg/start');
      await pupil.locator('#wkStart').click();
      expect((await starting).status()).toBe(200);
      await expect(pupil.locator('#cond')).toContainText('Пять');
      await pupil.locator('#answerInputs input').fill('12');

      const held = new Promise(resolve => { releaseAnswer = resolve; });
      let markCommitted;
      const committed = new Promise(resolve => { markCommitted = resolve; });
      await pupil.route('**/api/asg/answer', async route => {
        const response = await route.fetch();
        markCommitted({status: response.status(), body: await response.json()});
        await held;
        await route.fulfill({response});
      });
      await pupil.locator('#checkBtn').click();
      await expect(pupil.locator('#wkYes')).toHaveText('Сдать без решения');
      const answering = posted(pupil, '/api/asg/answer');
      await pupil.locator('#wkYes').click();
      const stored = await committed;
      expect(stored.status).toBe(200);
      expect(stored.body.mine[fixture.task]).toBe('12');
      expect(stored.body).not.toHaveProperty('result');
      expect(stored.body).not.toHaveProperty('correct');
      await expect(pupil.locator('.lesson-save-status')).toHaveAttribute('data-state', 'pending');
      await expect(pupil.locator('#feedback')).not.toContainText('Ответ сдан');
      releaseAnswer();
      const answerResponse = await answering;
      expect(answerResponse.status()).toBe(200);
      await expect(pupil.locator('.lesson-save-status')).toHaveText('Сервер подтвердил сохранение');
      await expect(pupil.locator('#feedback')).toContainText('Ответ сдан');
      await pupil.unroute('**/api/asg/answer');

      const duplicate = await browserJson(pupil, '/api/asg/answer', answerResponse.request().postDataJSON());
      expect(duplicate.status).toBe(409);
      const state = await browserJson(pupil, '/api/asg/state?id=' + assignmentId);
      expect(state.body.mine[fixture.task]).toBe('12');
      expect(state.body.done).toEqual([fixture.task]);
      expect(state.body.changed).toEqual([]);
      expect(state.body).not.toHaveProperty('result');
    });

    await test.step('Reload restores the acknowledged answer; finishing is idempotent', async () => {
      await pupil.reload();
      await pupil.locator('[data-tile-key="asg"]').click();
      await pupil.locator(`[data-assignment="${assignmentId}"] [data-asg]`).click();
      await pupil.locator(`[data-wk-go="${fixture.task}"]`).click();
      await expect(pupil.locator('#answerInputs input')).toHaveValue('12');
      await expect(pupil.locator('#answerInputs input')).toBeDisabled();
      await expect(pupil.locator('#feedback')).toContainText('Ответ сдан');
      await expect(pupil.locator('#feedback')).not.toContainText('Верно!');
      await pupil.locator('#wkFinishBtn').click();
      const finishing = posted(pupil, '/api/asg/finish');
      await pupil.locator('#wkYes').click();
      const finished = await finishing;
      expect(finished.status()).toBe(200);
      const receipt = await finished.json();
      expect(receipt.result).toMatchObject({ok: 1, bad: 0, pct: 100, grade: 5, total: 1});
      await expect(pupil.locator('#trainer')).toContainText('Результат: 100%');
      const historyBefore = await browserJson(pupil, '/api/history');
      const profileBefore = await browserJson(pupil, '/api/me');
      const duplicates = await Promise.all([
        browserJson(pupil, '/api/asg/finish', {id: assignmentId}),
        browserJson(pupil, '/api/asg/finish', {id: assignmentId}),
      ]);
      for (const duplicate of duplicates) {
        expect(duplicate.status).toBe(200);
        expect(duplicate.body.result).toEqual(receipt.result);
        expect(duplicate.body.finished).toBe(receipt.finished);
      }
      const historyAfter = await browserJson(pupil, '/api/history');
      const profileAfter = await browserJson(pupil, '/api/me');
      expect(historyAfter.body).toEqual(historyBefore.body);
      expect(profileAfter.body.game.xp).toBe(profileBefore.body.game.xp);
      expect(profileAfter.body.game.coins).toBe(profileBefore.body.game.coins);
      await recordUI(pupil, info, 'pupil-finished-assignment');
    });

    await test.step('Teacher sees the same persisted result and the completed onboarding step', async () => {
      await teacher.reload();
      await teacher.locator('#tabs [data-tab="classes"]').click();
      await teacher.locator(`[data-class="${classId}"]`).click();
      await teacher.locator('#clsTabs [data-pane="asg"]').click();
      await teacher.locator(`[data-live="${assignmentId}"]`).click();
      const row = teacher.locator(`#live-${assignmentId} tbody tr`).filter({hasText: pupilName});
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('сдал');
      await expect(row).toContainText('1/1');
      await expect(row).toContainText('100%');
      await expect(row.locator('.cs-grade')).toHaveText('5');
      const live = await browserJson(teacher, '/api/admin/asg/live?id=' + assignmentId);
      expect(live.status).toBe(200);
      expect(live.body.rows).toHaveLength(1);
      expect(live.body.rows[0]).toMatchObject({id: pupilId, status: 'done', answered: 1, ok: 1, bad: 0, pct: 100, grade: 5});
      const profile = await browserJson(teacher, '/api/admin/me');
      expect(profile.body.journey.finished_students).toBe(1);
      expect(profile.body.journey.first_result_at).toBeGreaterThan(0);
      await recordUI(teacher, info, 'teacher-first-assignment-result');
      await teacher.locator('#tabs [data-tab="overview"]').click();
      await expect(teacher.locator('#stepsCard')).toContainText('Первый ученик уже завершил работу');
    });
  } finally {
    releaseAnswer?.();
    await pupilContext.close();
  }
});
