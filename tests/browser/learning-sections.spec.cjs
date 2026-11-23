const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');

let fixture;
test.use({reducedMotion: 'reduce'});
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture?.stop(); });

async function post(context, path, data) {
  const response = await context.request.post(fixture.origin + path, {
    headers: {Origin: fixture.origin}, data,
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function openEntry(page, group, entry) {
  await page.locator('[data-tile-key="' + group + '"]').click();
  await page.locator('[data-learning-entry="' + entry + '"]').click();
}

test('course and laboratory passwords unlock their sections on another device of the same pupil', async ({browser, context, page}) => {
  const second = await browser.newContext({viewport: {width: 375, height: 900}});
  const otherPupil = await browser.newContext();
  try {
    const name = 'Синтетический Доступ';
    const password = 'synthetic-account-password';
    const invite = fixture.teachers.find(t => t.email_ok && t.moderation === 'approved').cookie;
    const firstLogin = await post(context, '/api/login', {name, new_password: password, code: invite, mode: 'register', consent: true});
    const secondLogin = await post(second, '/api/login', {name, password});
    expect(secondLogin.sid).toBe(firstLogin.sid);
    expect(secondLogin.token).not.toBe(firstLogin.token);
    await seedBrowser(context, fixture, 'pupil', firstLogin);
    await seedBrowser(second, fixture, 'pupil', secondLogin);
    const mobile = await second.newPage();

    for (const section of [
      {group: 'courses', entry: 'course', passwordField: '#coursePw', password: 'fixture-only-course-password', opened: '.crs-hero', endpoint: '/api/course/unlock'},
      {group: 'courses', entry: 'python', passwordField: '#pycPw', password: 'fixture-only-pyc-password', opened: '.pyc-hero', endpoint: '/api/pyc/unlock'},
      {group: 'labs', entry: 'tasks', passwordField: '#labPassword', password: 'fixture-only-lab-password', opened: '[data-lab-model=net]', endpoint: '/api/lab/unlock'},
      {group: 'labs', entry: 'arduino', passwordField: '#ardPassword', password: 'fixture-only-arduino-password', opened: '#appShell', endpoint: '/api/arduino/unlock'},
    ]) {
      for (const device of [page, mobile]) {
        await device.goto(fixture.origin + '/');
        await openEntry(device, section.group, section.entry);
        await expect(device.locator(section.passwordField)).toBeVisible();
      }
      await page.locator(section.passwordField).fill(section.password);
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === section.endpoint);
      await page.locator(section.passwordField).press('Enter');
      expect((await saved).status()).toBe(200);
      await expect(page.locator(section.opened)).toBeVisible();

      await mobile.bringToFront();
      await expect(mobile.locator(section.opened)).toBeVisible();
      await expect(mobile.locator(section.passwordField)).toHaveCount(0);
    }
    await mobile.goto(fixture.origin + '/');
    await mobile.locator('[data-tile-key="labs"]').click();
    await expect(mobile.locator('.learning-summary')).toHaveText('Все лаборатории доступны');
    await expect(mobile.locator('.learning-availability:visible')).toHaveCount(0);
    await mobile.locator('#hubBack').click();
    await openEntry(mobile, 'courses', 'course');
    await expect(mobile.locator('[data-lesson="7"]')).toBeVisible();
    await mobile.locator('[data-lesson="7"]').click();
    await expect(mobile.locator('#crsDeck')).toBeVisible();

    const otherLogin = await post(otherPupil, '/api/login', {name: 'Совместный Ученик Два', password: 'synthetic-student-password'});
    expect(otherLogin.sid).not.toBe(firstLogin.sid);
    await seedBrowser(otherPupil, fixture, 'pupil', otherLogin);
    const otherPage = await otherPupil.newPage();
    await otherPage.goto(fixture.origin + '/');
    await otherPage.locator('[data-tile-key="courses"]').click();
    await expect(otherPage.locator('.learning-summary')).toHaveText('Доступ у учителя');
    await expect(otherPage.locator('.learning-availability:visible')).toHaveCount(0);
    await otherPage.locator('[data-learning-entry="course"]').click();
    await expect(otherPage.locator('#coursePw')).toBeVisible();
    expect((await otherPupil.request.get(fixture.origin + '/api/course/lesson?n=7')).status()).toBe(403);
  } finally {
    await otherPupil.close();
    await second.close();
  }
});

for (const width of [375, 1366]) {
  test('grouped learning navigation and per-section teacher reports at ' + width + 'px', async ({context, page, browser}) => {
    await page.setViewportSize({width, height: 900});
    const participant = fixture.participants[0];
    await seedBrowser(context, fixture, 'pupil', participant);
    const me = await (await context.request.get(fixture.origin + '/api/me')).json();
    await post(context, '/api/course/unlock', {password: 'fixture-only-course-password'});
    await page.goto(fixture.origin + '/');
    for (const [group, title, entries] of [
      ['courses', 'Курсы', ['course', 'python']],
      ['labs', 'Лаборатории', ['tasks', 'code', 'bugs', 'arduino']],
    ]) {
      const tile = page.locator('[data-tile-key="' + group + '"]');
      await expect(tile).toBeVisible();
      await expect(page.locator('[data-tile-key="course"], [data-tile-key="python"], [data-tile-key="lab"], [data-tile-key="arduino"]')).toHaveCount(0);
      if (width === 375) {
        await page.getByRole('button', {name: 'Ещё', exact: true}).click();
        const more = page.getByRole('dialog', {name: 'Разделы Egeshka'});
        await more.locator('[data-mobile-group="' + group + '"]').press('Enter');
        await expect(more).toBeHidden();
      } else {
        await tile.press('Enter');
      }
      const heading = page.getByRole('heading', {name: title, exact: true});
      await expect(heading).toBeFocused();
      await expect(heading).toHaveCSS('box-shadow', 'none');
      for (const entry of entries) await expect(page.locator('[data-learning-entry="' + entry + '"]')).toBeVisible();
      const buttons = page.locator('[data-learning-entry]');
      const first = await buttons.nth(0).boundingBox(), next = await buttons.nth(1).boundingBox();
      if (width === 375) expect(next.y).toBeGreaterThanOrEqual(first.y + first.height);
      else {
        expect(next.y).toBeCloseTo(first.y, 0);
        expect(next.x).toBeGreaterThanOrEqual(first.x + first.width);
      }
      await page.keyboard.press('Tab');
      await expect(buttons.first()).toBeFocused();
      await expect(buttons.first()).toHaveCSS('outline-style', 'solid');
      const locked = group === 'labs' ? 'arduino' : 'python';
      await expect(page.locator('.learning-summary')).toHaveText(group === 'labs' ? 'Доступно 3 из 4' : 'Доступно 1 из 2');
      await expect(page.locator('.learning-availability:visible')).toHaveCount(1);
      await expect(page.locator('[data-learning-entry="' + locked + '"]')).toHaveAccessibleDescription(/Доступ у учителя/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (group === 'labs') {
        const recorded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/lab/activity');
        await page.locator('[data-learning-entry="tasks"]').click();
        expect((await recorded).status()).toBe(200);
        await expect(page.locator('[data-lab-model=net]')).toBeVisible();
        await page.goBack();
        await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
      }
      await page.locator('#hubBack').click();
    }

    const teacher = await browser.newContext({viewport: {width, height: 900}});
    try {
      await seedBrowser(teacher, fixture, 'teacher');
      const panel = await teacher.newPage();
      await panel.goto(fixture.origin + '/admin');
      const nav = panel.locator('#tabs [data-tab="learning"]');
      await expect(nav).toHaveAccessibleName(/Лаборатории и курсы/);
      await nav.click();
      const view = panel.locator('#view-learning');
      await expect(view.getByRole('heading', {name: 'Лаборатории и курсы'})).toBeVisible();
      for (const [key, title] of [
        ['course', 'Курс ЕГЭ'], ['pyc', 'Курс Python'], ['models', 'Модели заданий ЕГЭ'],
        ['trace', 'Пошаговый Python'], ['bugs', 'Исправление ошибок'], ['ard', 'Лаборатория Arduino'],
      ]) {
        const report = view.locator('[data-learning-report="' + key + '"]');
        const toggle = report.locator('summary');
        await expect(toggle).toHaveText(title);
        await expect(report).toHaveJSProperty('open', false);
        await toggle.press('Enter');
        await expect(report).toHaveJSProperty('open', true);
        await expect(report.getByRole('button', {name: 'Обновить'})).toBeVisible();
        await expect(report.locator('table').first()).toBeVisible();
        if (key === 'course' || key === 'models') {
          const row = report.locator('tbody tr').filter({hasText: me.name}).first();
          await expect(row).toBeVisible();
          if (key === 'models') await expect(row.locator('td').nth(1)).toHaveText(/^1 \/ \d+$/);
          await expect(report).not.toContainText('Учебный Ученик');
        }
        await toggle.press('Enter');
        await expect(report).toHaveJSProperty('open', false);
      }
      expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await teacher.close();
    }
  });
}
