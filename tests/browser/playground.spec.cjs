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

for (const [theme, width] of [['light', 1366], ['dark', 1366], ['dark', 320]]) {
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
    const explorer = root.getByRole('button', {name:'Проводник', exact:true}), sidebar = root.locator('#pg-explorer');
    await expect(explorer).toHaveAttribute('aria-expanded', String(width > 700));
    if (width > 700) {
      await expect(sidebar).toBeVisible();
      await expect(sidebar.getByRole('button', {name:'main.cpp'})).toHaveAttribute('aria-current','true');
      const files = await sidebar.boundingBox(), sourceBox = await source.boundingBox();
      expect(files.x + files.width).toBeLessThanOrEqual(sourceBox.x);
    } else {
      await expect(sidebar).toBeHidden();
    }
    expect(await page.evaluate(async () => {
      const faces = await document.fonts.load('16px "Egeshka Codicons"', '\ueaf0');
      return faces.length === 1 && faces[0].status === 'loaded';
    })).toBe(true);
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

test('explorer, cross-file search and VS Code shortcuts use the actual drafts', async ({page,context}) => {
  await page.setViewportSize({width:1366,height:820});
  await seedBrowser(context, fixture);
  await page.goto(fixture.origin + '/'); await page.locator('[data-open-playground]').click();
  const root = page.locator('.code-playground'), code = root.locator('#pg-source'), sidebar = root.locator('.pg-sidebar');
  const explorer = root.getByRole('button', {name:'Проводник',exact:true}), search = root.getByRole('button', {name:'Поиск',exact:true});
  const needle = 'vec[0].x';
  const cppCode = '// начало\n'.repeat(70) + ' '.repeat(250) + 'VEC[0].x++;\n';
  await code.fill(cppCode);
  await sidebar.getByRole('button', {name:'solution.py',exact:true}).click();
  await expect(code).toBeFocused();
  await code.fill("print('vec[0].x', 'vec[0].x')\n");
  await expect(root.locator('.pg-current-file')).toHaveText('solution.py');

  await code.press('Control+Shift+f');
  const query = sidebar.getByRole('searchbox'), count = sidebar.locator('.pg-search-count');
  await expect(query).toBeFocused(); await query.fill(needle);
  await expect(count).toHaveText('3 совпадения');
  await expect(sidebar.locator('[data-pg-hit=python]')).toHaveCount(2);
  await sidebar.locator('[data-pg-hit=cpp]').click();
  await expect(code).toHaveValue(cppCode);
  await expect(code).toBeFocused();
  expect(await code.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('VEC[0].x');
  await expect.poll(() => code.evaluate(el => el.scrollTop > 0 && el.scrollLeft > 0)).toBe(true);

  await code.press('Control+b'); await expect(sidebar).toBeHidden();
  await code.press('Control+b'); await expect(search).toHaveAttribute('aria-expanded','true');
  await expect(query).toHaveValue(needle);
  await sidebar.locator('[data-pg-hit=python]').last().click();
  expect(await code.evaluate(el => el.selectionStart === el.value.lastIndexOf('vec[0].x'))).toBe(true);
  await query.fill('несуществующий фрагмент'); await expect(count).toHaveText('Совпадений нет');
  await code.fill('a = 2\n'.repeat(38));
  await query.fill('a'); await expect(count).toHaveText('38 совпадений');
  await sidebar.getByRole('button',{name:'Показать ещё'}).click();
  await expect(sidebar.locator('[data-pg-hit=python]')).toHaveCount(38);
  await root.locator('[data-pg-reveal]').click();
  await expect(explorer).toHaveAttribute('aria-expanded','true');
  await expect(sidebar.getByRole('button',{name:'solution.py'})).toBeFocused();
  await code.press('Control+j'); await expect(root.locator('#pg-dock-content')).toBeHidden();
  await code.press('Control+j'); await expect(root.locator('#pg-dock-content')).toBeVisible();

  await page.setViewportSize({width:320,height:820});
  await expect(sidebar).toBeHidden(); await explorer.click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button',{name:'main.cpp'}).click();
  await expect(sidebar).toBeHidden(); await expect(code).toBeFocused();
  await search.click(); await query.fill(needle); await sidebar.locator('[data-pg-hit=cpp]').click();
  await expect(sidebar).toBeHidden();
  expect(await code.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('VEC[0].x');
  await search.click(); await query.press('Escape');
  await expect(code).toBeFocused(); await expect(sidebar).toBeHidden();
  await page.setViewportSize({width:1366,height:820});
  await expect(explorer).toHaveAttribute('aria-expanded','true');
});

test('Tab and Shift+Tab edit the selected code lines in both playground languages', async ({page, context}) => {
  await seedBrowser(context, fixture);
  await page.goto(fixture.origin + '/');
  await page.locator('.hub-tiles + [data-open-playground]').click();
  const source = page.locator('#pg-source');
  for (const lang of ['cpp', 'python']) {
    await page.locator('[data-pg-lang="' + lang + '"]').click();
    await source.fill('x');
    await source.press('End');
    await source.press('Tab');
    await expect(source).toBeFocused();
    await expect(source).toHaveValue('x    ');

    await source.fill('one\ntwo\nthree');
    await source.evaluate(el => el.setSelectionRange(0, 8, 'backward'));
    await source.press('Tab');
    await expect(source).toHaveValue('    one\n    two\nthree');
    expect(await source.evaluate(el => [el.selectionStart, el.selectionEnd, el.selectionDirection])).toEqual([0, 16, 'backward']);
    await source.press('Shift+Tab');
    await expect(source).toHaveValue('one\ntwo\nthree');
    await source.fill('  first\n\tsecond\nthird');
    await source.evaluate(el => el.setSelectionRange(1, 15));
    await source.press('Shift+Tab');
    await expect(source).toHaveValue('first\nsecond\nthird');
    await source.evaluate(el => el.setSelectionRange(0, 0));
    await source.press('Tab');
    await source.press('Shift+Tab');
    await expect(source).toHaveValue('first\nsecond\nthird');
    await source.press('Escape');
    await expect(page.locator('[data-pg-run]')).toBeFocused();
  }
  await page.locator('[data-pg-lang="cpp"]').click();
  await expect(source).toHaveValue('first\nsecond\nthird');
  const stdin = page.locator('#pg-stdin');
  await page.getByRole('tab', {name: 'Ввод', exact: true}).click();
  await stdin.fill('abc');
  await stdin.press('Tab');
  await expect(stdin).not.toBeFocused();
  await expect(stdin).toHaveValue('abc');
});
