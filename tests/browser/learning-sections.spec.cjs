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

function registerPupil(context, name, password = 'synthetic-account-password') {
  const invite = fixture.teachers.find(t => t.email_ok && t.moderation === 'approved').cookie;
  return post(context, '/api/login', {name, new_password: password, code: invite, mode: 'register', consent: true});
}

async function openEntry(page, group, entry) {
  await page.locator('[data-tile-key="' + group + '"]').click();
  await page.locator('[data-learning-entry="' + entry + '"]').click();
}

test('№24 grades Python re spans, explains a counterexample and opens the exam file', async ({page, context}) => {
  const pupil = await registerPupil(context, 'Регулярные Выражения');
  await seedBrowser(context, fixture, 'pupil', pupil);
  await post(context, '/api/pyc/unlock', {password: 'fixture-only-pyc-password'});
  await page.goto(fixture.origin + '/');
  await openEntry(page, 'courses', 'python');
  await page.locator('[data-pyc-lv="m24:0"]').first().click();
  await page.getByRole('button', {name: 'Открыть тренажёр регулярных выражений'}).click();
  const form = page.locator('[data-pyc-regex]');
  const input = form.locator('[data-re-pattern]');
  const result = form.locator('.pyc-msg');
  const check = () => form.getByRole('button', {name: 'Проверить шаблон'}).click();
  await input.fill('[');
  await check();
  await expect(result).toContainText('Ошибка шаблона');
  await input.fill('[0-9]');
  await check();
  await expect(result).toContainText('Проверь строку 1');
  await expect(result).toContainText('[1:4] 007');
  await input.fill(String.raw`\d+`);
  await form.getByText('Попробовать на своей строке').click();
  await form.locator('[data-re-text]').fill('B😀9A12');
  await form.getByRole('button', {name: 'Показать совпадения'}).click();
  await expect(result).toContainText('[2:3] 9');
  await expect(result).toContainText('[4:6] 12');
  const progress = async () => (await (await context.request.get(fixture.origin + '/api/pyc')).json()).progress;
  expect((await progress())['m33.digits'].tries).toBe(1);
  async function solve(key, pattern) {
    const target = page.locator('[data-pyc-regex="m33.' + key + '"]');
    if (!await target.count()) await page.locator('[data-pyc-focus="m33.' + key + '"]').click();
    await target.locator('[data-re-pattern]').fill(pattern);
    await target.getByRole('button', {name: 'Проверить шаблон'}).click();
    await expect(page.locator('.pyc-task.ok[data-pyc-task="m33.' + key + '"]')).toBeVisible();
  }
  await solve('digits', String.raw`\d+`);
  await solve('hex', '[A-F0-9]+');
  await page.locator('[data-pyc-lv="m33:1"]').first().click();
  await solve('blocks', '(AB)+');
  await solve('bounded', 'A[0-9]{2,4}B');
  await solve('overlap', '(?=(ABA))');
  await page.locator('[data-pyc-lv="m33:2"]').first().click();
  const num = '(?:[6789][06789]*|0)';
  await solve('number', num);
  await solve('expression', num + '(?:[-*]' + num + ')*');
  await page.locator('[data-pyc-focus="m33.file"]').click();
  const attachment = await page.locator('.pyc-files a').getAttribute('href');
  const file = await context.request.get(new URL(attachment, fixture.origin).href);
  expect(file.ok()).toBe(true);
  expect((await file.text()).trim()).toMatch(/^[06789*-]{12000}$/);
  await page.locator('.pyc-ans').fill('80');
  await page.locator('.pyc-form button').click();
  await expect(page.locator('.pyc-task.ok[data-pyc-task="m33.file"]')).toBeVisible();
  expect((await progress())['m33.file'].ok).toBe(1);
});

for (const [exam, mid, name] of [[25, 'm34', 'Делители Практикум'], [26, 'm35', 'События Практикум'], [27, 'm36', 'Частицы Практикум']]) {
  test('№' + exam + ' completes guided steps, Python tests and independent work', async ({page, context}) => {
    const module = require('../../pycourse/' + mid + '.json');
    const pupil = await registerPupil(context, name);
    await seedBrowser(context, fixture, 'pupil', pupil);
    await post(context, '/api/pyc/unlock', {password: 'fixture-only-pyc-password'});
    await page.goto(fixture.origin + '/');
    await openEntry(page, 'courses', 'python');
    await expect(page.locator('[data-pyc-lv="' + mid + ':1"]').first()).toBeDisabled();
    await page.locator('[data-pyc-lv="m' + exam + ':0"]').first().click();
    await page.getByRole('button', {name: /Открыть тренажёр/}).click();
    const progress = async () => (await (await context.request.get(fixture.origin + '/api/pyc')).json()).progress;
    for (const [levelIndex, level] of module.levels.entries()) {
      if (levelIndex) await page.locator('[data-pyc-lv="' + mid + ':' + levelIndex + '"]').first().click();
      for (const [taskIndex, t] of level.tasks.entries()) {
        if (taskIndex) await page.locator('[data-pyc-focus="' + t.id + '"]').click();
        const task = page.locator('[data-pyc-task="' + t.id + '"]');
        await expect(task).toBeVisible();
        if (t.worksheet) {
          const form = task.locator('[data-pyc-sheet]'), cells = form.locator('[data-cell]');
          const rows = t.ans.split('\n').map(s => s.split(/\s+/));
          for (const [i, row] of rows.entries()) {
            await expect(form.locator('legend')).toHaveText('Шаг ' + (i + 1) + ' из ' + rows.length);
            for (const [j, answer] of row.entries()) {
              if (t.worksheet.fields[j].choices.length) await cells.nth(j).selectOption(answer);
              else await cells.nth(j).fill(answer.replace('.', ','));
            }
            if (!levelIndex && !taskIndex && !i) {
              await cells.first().fill('999');
              await form.getByRole('button').click();
              await expect(cells.first()).toHaveAttribute('aria-invalid', 'true');
              await expect(task.locator('.pyc-msg')).toContainText(t.worksheet.fields[0].tip);
              await cells.first().fill(row[0]);
            }
            await form.getByRole('button').click();
            if (!i && rows.length > 1) {
              await expect(form.locator('[data-checked]')).toHaveCount(1);
              expect((await progress())[t.id]?.ok).toBeFalsy();
              if (t.worksheet.meter) await expect(form.locator('meter')).toHaveAttribute('value', row[t.worksheet.meter.field]);
              if (t.worksheet.axis) await expect(form.locator('.pyc-energy li').first()).toHaveAttribute('data-group', row[0]);
            }
          }
        } else if (t.practice) {
          await task.locator('[data-pyc-py]').click();
          if (!taskIndex) {
            await page.locator('#pyCode').fill('print(-1)');
            await page.locator('#pycDockTests').click();
            await expect(page.locator('#pycDockStatus')).toContainText('Получено: -1', {timeout: 30000});
            expect((await progress())[t.id].ok).toBe(0);
          }
          await page.locator('#pyCode').fill(t.sol);
          await page.locator('#pycDockTests').click();
          await expect(page.locator('#pycDockStatus')).toContainText('Задача зачтена', {timeout: 30000});
          await page.locator('#pycDockBack').click();
        } else {
          for (const attachment of t.files || []) {
            const href = await task.getByRole('link', {name: new RegExp(attachment.name)}).getAttribute('href');
            const file = await context.request.get(new URL(href, fixture.origin).href);
            expect(file.ok()).toBe(true);
            expect((await file.body()).length).toBe(attachment.size);
          }
          await task.locator('.pyc-ans').fill(t.ans.split(/\s+/).join(' '));
          await task.locator('.pyc-form button').click();
        }
        await expect(task).toHaveClass(/\bok\b/);
      }
    }
    const saved = await progress();
    expect(module.levels.flatMap(l => l.tasks).every(t => saved[t.id]?.ok === 1)).toBe(true);
  });
}

test('course and laboratory passwords unlock their sections on another device of the same pupil', async ({browser, context, page}) => {
  const second = await browser.newContext({viewport: {width: 375, height: 900}});
  const otherPupil = await browser.newContext();
  try {
    const name = 'Синтетический Доступ';
    const password = 'synthetic-account-password';
    const firstLogin = await registerPupil(context, name, password);
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
    const pupil = await registerPupil(context, width === 375 ? 'Мобильный Каталог' : 'Настольный Каталог');
    await seedBrowser(context, fixture, 'pupil', pupil);
    await post(context, '/api/lab/unlock', {password: 'fixture-only-lab-password'});
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

test('pupil resumes saved course, model and bug work; daily task opens once from the plan', async ({page, context}) => {
  const account = await registerPupil(context, 'Каталог Прогресс');
  await seedBrowser(context, fixture, 'pupil', account);
  for (const section of ['course', 'pyc', 'lab', 'arduino']) {
    await post(context, '/api/' + section + '/unlock', {password: 'fixture-only-' + section + '-password'});
  }
  const lesson = await (await context.request.get(fixture.origin + '/api/course/lesson?n=13')).json();
  await post(context, '/api/course/seen', {n: 13, slide: 3, total: lesson.slides.length});
  await post(context, '/api/pyc/check', {task: 'm01.print_sum', answer: '10'});
  await post(context, '/api/arduino/progress', {tracks: {junior: [['first-light', 'Первый свет', 1, 0, 0]]}});
  await post(context, '/api/lab/activity', {section: 'model', model: 'image'});

  await page.goto(fixture.origin + '/');
  await expect(page.locator('[data-tile-key=daily]')).toHaveCount(0);
  await page.locator('[data-step-key=daily] button').click();
  await expect(page.locator('#dailyBody')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-tile-key=courses]').click();
  const card = key => page.locator('[data-learning-card="' + key + '"]');
  const resume = key => card(key).locator('[data-learning-resume]');
  await expect(card('course').locator('.learning-next')).toContainText('слайд 3');
  await expect(card('python').locator('progress')).toHaveAttribute('value', '1');
  await resume('course').click();
  await expect(page.locator('.crs-count')).toHaveText('3 / ' + lesson.slides.length);
  await page.goBack();
  await resume('python').click();
  await expect(page.locator('[data-pyc-focus="m01.change_value"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#hubBack').click();
  let failed = true;
  await page.route('**/api/learning/directory?group=labs', r => failed ? r.abort() : r.continue());
  await page.locator('[data-tile-key=labs]').click();
  await expect(page.locator('[data-directory-retry]')).toBeVisible();
  await expect(card('tasks').locator('progress')).toBeHidden();
  failed = false;
  await page.locator('[data-directory-retry]').click();
  await expect(card('tasks').locator('.learning-extra')).toContainText('1 из');
  await expect(card('tasks').locator('progress')).toHaveAttribute('value', '0');
  await resume('tasks').click();
  await expect(page.locator('[data-lab-model=image]')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Ширина, пиксели').fill('8');
  await page.getByLabel('Высота, пиксели').fill('8');
  await page.locator('#labDepth').press('Home');
  const saved = page.waitForResponse(r => r.url().endsWith('/api/lab/activity') && r.request().postDataJSON()?.prediction);
  await page.locator('#labGuess').fill('8');
  await page.locator('#labPredict button').click();
  expect((await saved).status()).toBe(200);
  await page.goBack();
  await expect(card('tasks').locator('progress')).toHaveAttribute('value', '1');
  const caseTitle = await card('bugs').locator('.learning-next').textContent();
  await resume('bugs').click();
  await expect(page.locator('.bug-task h2')).toHaveText(caseTitle);
  await page.goBack();
  await expect(card('arduino').locator('.learning-next')).toContainText('Первый свет');
  await resume('arduino').click();
  await expect(page).toHaveURL(/arduino\/#\/lesson\/first-light$/);
});
