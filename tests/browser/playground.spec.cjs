const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');

let fixture;
test.use({reducedMotion:'reduce'});
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture?.stop(); });

async function registerPupil(context, name) {
  const invite = fixture.teachers.find(t => t.email_ok && t.moderation === 'approved').cookie;
  const response = await context.request.post(fixture.origin + '/api/login', {
    headers: {Origin: fixture.origin},
    data: {mode:'register', consent:true, name, code:invite, new_password:'synthetic-account-password'},
  });
  expect(response.status()).toBe(200);
  return response.json();
}

test('home playground runs real C++17 and Python with stdin and a local file', async ({page,context}) => {
  await seedBrowser(context, fixture);
  const runtimeRequests = [];
  context.on('request', req => {
    if (req.url().includes('/vendor/clang-wasm-') || req.url().includes('/cpp-worker.js')) runtimeRequests.push(req.url());
  });
  await page.goto(fixture.origin+'/');
  const banner = page.locator('.hub-tiles + [data-open-playground]');
  await expect(banner).toHaveAccessibleName(/C\+\+ \/ Python/);
  await banner.press('Enter');
  await expect(page.getByRole('heading', {name:'Редактор кода'})).toBeFocused();
  expect(runtimeRequests).toHaveLength(0);
  const source = page.locator('#pg-source'), input = page.locator('#pg-stdin');
  const output = page.locator('.pg-output'), status = page.locator('.pg-status');
  const run = page.locator('[data-pg-run]');
  await input.fill('17 25');
  await run.click();
  await expect(output).toHaveText('42', {timeout:90000});
  await expect(status).toHaveText('Программа завершена.');
  await expect.poll(() => runtimeRequests.some(url => url.includes('clang.wasm.gz.part2'))).toBe(true);

  const cpp = '#include <fstream>\n#include <iostream>\n#include <vector>\nint main(){std::ifstream f("17.txt"); std::vector<int> a; int n; while(f>>n)a.push_back(n); std::cout<<a.size();}';
  await source.fill(cpp);
  await expect(page.getByRole('tab', {name:'Вывод', exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab', {name:'Ввод', exact:true}).click();
  await page.getByLabel('Добавить файл').setInputFiles({name:'17.txt',mimeType:'text/plain',buffer:Buffer.from('5 8 13')});
  await expect(page.locator('.pg-file-name')).toHaveText('17.txt');
  await page.getByRole('button', {name:'Свернуть консоль'}).click();
  await expect(input).toBeHidden();
  await source.press('Control+Enter');
  await expect(page.getByRole('button', {name:'Свернуть консоль'})).toHaveAttribute('aria-expanded','true');
  await expect(output).toHaveText('3', {timeout:90000});
  await expect(status).toHaveText('Программа завершена.');
  await page.getByRole('tab', {name:'solution.py (Python)', exact:true}).click();
  await input.fill('4'); await source.fill('print(int(input()) + sum(map(int, open("17.txt").read().split())))');
  await run.click();
  await expect(output).toHaveText('30', {timeout:90000});
  await page.getByRole('tab', {name:'main.cpp (C++)', exact:true}).click();
  await expect(source).toHaveValue(cpp);
  await expect(input).toHaveValue('17 25');
  const invalid = 'int main(){ missing_name; }';
  await source.fill(invalid); await run.click();
  await expect(output).toContainText('missing_name', {timeout:90000});
  await expect(status).toContainText('Ошибка');
  await source.fill('int main(){ volatile unsigned n = 0; for (;;) ++n; }');
  await run.click();
  await expect(status).toHaveText('Программа выполняется…');
  await page.locator('[data-pg-stop]').click();
  await expect(status).toHaveText('Выполнение остановлено.');
  await source.fill(invalid); await run.click();
  await expect(output).toContainText('main.cpp', {timeout:90000});
  await page.goBack();
  await expect(banner).toBeVisible();
  await expect(page.locator('iframe[title="Изолированная среда C++"]')).toHaveCount(0);
});

test('mobile banner, language drafts and input survive navigation within the pupil account', async ({page,context}) => {
  await page.setViewportSize({width:320,height:850});
  const first = await registerPupil(context, 'Редактор Первый');
  await seedBrowser(context, fixture, 'pupil', first);
  await page.goto(fixture.origin+'/');
  const banner = page.locator('[data-open-playground]');
  await banner.click();
  await page.getByRole('tab', {name:'solution.py (Python)', exact:true}).click();
  await page.locator('#pg-source').fill('print("мой черновик")');
  await page.locator('#pg-stdin').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-pg-back]').click();
  await expect(banner).toBeFocused();
  await page.reload(); await banner.click();
  await expect(page.locator('[data-pg-lang=python]')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#pg-source')).toHaveValue('print("мой черновик")');
  await expect(page.locator('#pg-stdin')).toHaveValue('');
  // Use the normal logout, keeping the first pupil's drafts on this device.
  await page.locator('#avaBtn').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#logoutBtn').click();
  await expect(page.locator('#loginModal')).toBeVisible();
  const other = await registerPupil(context, 'Редактор Второй');
  expect(other.sid).not.toBe(first.sid);
  await seedBrowser(context, fixture, 'pupil', other);
  await page.goto(fixture.origin+'/'); await banner.click();
  await page.getByRole('tab', {name:'solution.py (Python)', exact:true}).click();
  await expect(page.locator('#pg-source')).not.toHaveValue('print("мой черновик")');
});

for (const [theme, width] of [['light', 1366], ['dark', 320]]) {
  test('editor tabs, syntax and console in ' + theme + ' theme at ' + width + 'px', async ({page,context}, testInfo) => {
    await page.setViewportSize({width,height:820});
    await seedBrowser(context, fixture);
    await context.addInitScript(theme => {
      if (window === window.top) localStorage.setItem('egeTrainer.theme', theme);
    }, theme);
    await page.goto(fixture.origin + '/');
    await page.locator('[data-open-playground]').click();
    const root = page.locator('.code-playground');
    const source = root.locator('#pg-source'), paint = root.locator('.pg-highlight');
    const cpp = root.getByRole('tab', {name:'main.cpp (C++)'}), python = root.getByRole('tab', {name:'solution.py (Python)'});
    const input = root.getByRole('tab', {name:'Ввод', exact:true}), output = root.getByRole('tab', {name:'Вывод', exact:true});
    await expect(cpp).toHaveAttribute('aria-selected','true');
    await expect(paint.locator('.hl-dec')).toHaveText('#include');
    await expect(paint.locator('.hl-str').first()).toHaveText('<iostream>');
    expect(await paint.locator('.hl-kw').first().evaluate(e => getComputedStyle(e).color))
      .not.toBe(await paint.evaluate(e => getComputedStyle(e).color));
    const editor = await root.locator('#pg-editor').boundingBox(), dock = await root.locator('.pg-dock-bar').boundingBox();
    expect(dock.y).toBeGreaterThanOrEqual(editor.y + editor.height - 1);
    expect(Math.abs(dock.width - editor.width)).toBeLessThan(2);
    const lastTab = await python.boundingBox(), run = await root.locator('[data-pg-run]').boundingBox();
    expect(run.x >= lastTab.x + lastTab.width - 1 || run.y >= lastTab.y + lastTab.height - 1).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const image = 'editor-' + theme + '-' + width + '.png';
    const path = testInfo.outputPath(image);
    await root.screenshot({path});
    await testInfo.attach(image, {contentType:'image/png', path});

    const snippet = '/* пример\nкомментария */\nint main() {\n  auto text = R"eg(<b>\nтекст)eg";\n}';
    await source.fill(snippet);
    await expect(paint.locator('.hl-com')).toHaveText('/* пример\nкомментария */', {useInnerText:false});
    await expect(paint.locator('.hl-str')).toHaveText('R"eg(<b>\nтекст)eg"');
    expect(await paint.textContent()).toBe(snippet + '\n');
    await expect(paint.locator('b')).toHaveCount(0);
    await source.press('Control+Home');
    await source.press('ArrowDown');
    await expect(root.locator('.pg-position')).toHaveText('Стр 2, стлб 1');

    await cpp.press('ArrowRight');
    await expect(python).toBeFocused();
    await expect(source).toHaveAccessibleName('Исходный код Python');
    await expect(paint.locator('.hl-bi').last()).toHaveText('print');
    await python.press('Home');
    await expect(source).toHaveValue(snippet);
    await expect(root.locator('.pg-position')).toHaveText('Стр 2, стлб 1');

    await input.press('End');
    await expect(output).toBeFocused();
    await expect(root.locator('#pg-stdin')).toBeHidden();
    await expect(root.locator('.pg-output')).toBeVisible();
    await root.getByRole('button', {name:'Свернуть консоль'}).click();
    await expect(root.locator('.pg-output')).toBeHidden();
    await input.click();
    await expect(root.locator('#pg-stdin')).toBeVisible();
  });
}
