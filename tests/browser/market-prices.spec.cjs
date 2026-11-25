const {test, expect} = require('@playwright/test');
const {startFixture, seedBrowser} = require('./fixture.cjs');

let fixture;
test.beforeAll(async () => { fixture = await startFixture({market:true}); });
test.afterAll(async () => { await fixture?.stop(); });

test('a pupil sees the settled gift price and uses the existing bid toward the buyout', async ({page, context}, testInfo) => {
  const {origin, market} = fixture;
  await seedBrowser(context, fixture);
  await page.goto(origin + '/');
  await page.locator('[data-hub-go="coins"]').click();
  await page.locator('.bx-tabs [data-bx-tab="market"]').click();
  await page.locator('[data-bx-mk="' + market.lot + '"]').click();
  const history = page.getByRole('region', {name:'Продажи за 30 дней'});
  await expect(history).toContainText('Продаж этого вида за 30 дней нет');
  await page.getByRole('button', {name:/Сделать ставку/}).click();
  const buy = page.getByRole('button', {name:/Купить сразу/});
  await expect(buy).toContainText('доплатить');
  await expect(buy).toBeEnabled();
  page.once('dialog', dialog => dialog.accept());
  await buy.click();
  const owned = page.locator('[data-bx-mine="' + market.lot + '"]');
  await owned.click();
  await expect(history).toContainText('Последняя продажа ' + market.price + ' ₿');
  await expect(history).toContainText('1 сделка');
  await expect(history).not.toContainText('%');
  const wallet = await (await context.request.get(origin + '/api/gifts')).json();
  expect(wallet.coins).toBe(0);

  await page.reload();
  await page.setViewportSize({width:375,height:850});
  await page.locator('[data-hub-go="coins"]').click();
  await page.locator('.bx-tabs [data-bx-tab="mine"]').click();
  await page.locator('[data-bx-mine="' + market.guitar + '"]').click();
  await expect(history).toContainText('+50%');
  await expect(history.locator('svg circle')).toHaveCount(3);
  await history.getByText('Цены по дням', {exact:true}).press('Enter');
  await expect(history.getByRole('table')).toBeVisible();
  await expect(history.getByRole('row').nth(1)).toContainText('190 ₿');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const photo = testInfo.outputPath('market-prices.png');
  await history.screenshot({path:photo});
  await testInfo.attach('market-prices.png', {path:photo, contentType:'image/png'});
});
