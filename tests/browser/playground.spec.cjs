const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');

let fixture;
test.use({reducedMotion:'reduce'});
test.beforeAll(async () => { fixture = await startFixture(); });
test.afterAll(async () => { await fixture?.stop(); });

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
  await page.getByLabel('Добавить файл').setInputFiles({name:'17.txt',mimeType:'text/plain',buffer:Buffer.from('5 8 13')});
  await source.press('Control+Enter');
  await expect(output).toHaveText('3', {timeout:90000});
  await expect(status).toHaveText('Программа завершена.');
  await page.getByRole('button', {name:'Python', exact:true}).click();
  await input.fill('4'); await source.fill('print(int(input()) + sum(map(int, open("17.txt").read().split())))');
  await run.click();
  await expect(output).toHaveText('30', {timeout:90000});
  await page.getByRole('button', {name:'C++', exact:true}).click();
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
  await seedBrowser(context, fixture);
  await page.goto(fixture.origin+'/');
  const banner = page.locator('[data-open-playground]');
  await banner.click();
  await page.getByRole('button', {name:'Python', exact:true}).click();
  await page.locator('#pg-source').fill('print("мой черновик")');
  await page.locator('#pg-stdin').fill('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-pg-back]').click();
  await expect(banner).toBeFocused();
  await page.reload(); await banner.click();
  await expect(page.locator('[data-pg-lang=python]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#pg-source')).toHaveValue('print("мой черновик")');
  await expect(page.locator('#pg-stdin')).toHaveValue('');
  // Use the normal logout, keeping the first pupil's drafts on this device.
  await page.locator('#avaBtn').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#logoutBtn').click();
  await expect(page.locator('#loginModal')).toBeVisible();
  const invite = fixture.teachers.find(t => t.email_ok && t.moderation === 'approved').cookie;
  const response = await context.request.post(fixture.origin + '/api/login', {
    headers: {Origin: fixture.origin},
    data: {mode:'register', consent:true, name:'Редактор Второй', code:invite, new_password:'synthetic-account-password'},
  });
  expect(response.status()).toBe(200);
  const other = await response.json();
  expect(other.sid).not.toBe(fixture.student.sid);
  await seedBrowser(context, fixture, 'pupil', other);
  await page.goto(fixture.origin+'/'); await banner.click();
  await page.getByRole('button', {name:'Python', exact:true}).click();
  await expect(page.locator('#pg-source')).not.toHaveValue('print("мой черновик")');
});
