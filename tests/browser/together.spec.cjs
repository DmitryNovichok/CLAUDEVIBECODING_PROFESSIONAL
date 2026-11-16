const {test,expect}=require('@playwright/test');
const {startFixture,seedBrowser}=require('./fixture.cjs');
const {recordUI}=require('./ui-evidence.cjs');
let fixture;
test.beforeAll(async()=>{fixture=await startFixture();});
test.afterAll(async()=>{await fixture?.stop();});
async function clients(browser,width=1366) {
  const teacherContext=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  const pupilContext=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await seedBrowser(teacherContext,fixture,'teacher');
  await seedBrowser(pupilContext,fixture,'pupil',fixture.participants[0]);
  const teacher=await teacherContext.newPage(),pupil=await pupilContext.newPage();
  // Each test gets a fresh real session; one scenario's readonly flag cannot affect another.
  const created=await teacherContext.request.post(fixture.origin+'/api/admin/together/new',{data:{students:fixture.participants.map(p=>p.sid),mode:'code'}});
  expect(created.status()).toBe(200);const id=(await created.json()).id;
  await Promise.all([teacher.goto(fixture.origin+'/together?id='+id+'&as=t'),pupil.goto(fixture.origin+'/together?id='+id)]);
  for(const page of [teacher,pupil]) {
    await expect(page.locator('#tgOver')).toBeHidden();
    if(width<=760) await page.locator('#tgTabs [data-tab=code]').click();
    await expect(page.locator('#tgTa')).toBeEditable();
  }
  return {teacher,pupil,teacherContext,pupilContext,close:()=>Promise.all([teacherContext.close(),pupilContext.close()])};
}
for(const width of [320,375,1366]) {
  test(`Together synchronizes two roles, readonly and reconnect at ${width}px`,async({browser},info)=>{
    const c=await clients(browser,width),{teacher,pupil}=c;
    try {
      const text='print("Учебный пример 🦊")';
      await teacher.locator('#tgTa').fill(text);await expect(pupil.locator('#tgTa')).toHaveValue(text);
      await pupil.locator('#tgTa').fill(text+'\nprint(2)');await expect(teacher.locator('#tgTa')).toHaveValue(text+'\nprint(2)');
      await teacher.locator('#tgRo').click();
      await expect(pupil.locator('#tgTa')).toHaveJSProperty('readOnly',true);
      await expect(pupil.locator('#tgRoBan')).toBeVisible();
      await expect(teacher.locator('#tgTa')).toBeEditable();
      await teacher.locator('#tgRo').click();await expect(pupil.locator('#tgTa')).toBeEditable();
      await pupil.reload();await expect(pupil.locator('#tgOver')).toBeHidden();
      if(width<=760) await pupil.locator('#tgTabs [data-tab=code]').click();
      await expect(pupil.locator('#tgTa')).toHaveValue(text+'\nprint(2)');
      for(const [role,page] of [['teacher',teacher],['pupil',pupil]]) {
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        for (const selector of ['#pyEmacs', '#pyFontDown', '#pyFontUp']) {
          const bounds = await page.locator(selector).boundingBox();
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
        await expect(page.locator('#tgTa')).toBeInViewport();
        await recordUI(page,info,'together-'+role+'-'+width);
      }
    } finally {await c.close();}
  });
}
test('Together task picker and invitation dialogs trap focus and restore their trigger',async({browser},info)=>{
  const c=await clients(browser),{teacher,pupil}=c;
  try {
    // Searching changes only this synthetic lesson; no production bank or participant.
    await teacher.locator('#tgPick').click();
    await expect(teacher.getByRole('dialog',{name:'Задание для сеанса'})).toBeVisible();
    await expect(teacher.getByLabel('Найти задание по номеру или id')).toBeFocused();
    for(let i=0;i<14;i++) {
      await teacher.keyboard.press(i<3?'Shift+Tab':'Tab');
      expect(await teacher.evaluate(()=>!!document.activeElement.closest('#tgPickM'))).toBe(true);
    }
    await teacher.keyboard.press('Escape');await expect(teacher.locator('#tgPick')).toBeFocused();
    await teacher.locator('#tgPick').click();
    // Explicitly choose the recent-task search after the empty fixture's auto-fallback.
    await teacher.locator('#tgPickChips [data-kind=recent]').click();
    await teacher.locator('#tgPickQ').fill('5');
    const choice=teacher.locator('#tgPickL [data-task="'+fixture.teacherTask+'"]');
    await expect(choice).toBeVisible();await choice.focus();await teacher.keyboard.press('Enter');
    await expect(teacher.locator('#tgPickM')).toBeHidden();await expect(teacher.locator('#tgPick')).toBeFocused();
    await expect(pupil.locator('#tgCond')).toContainText('Пять');
    await teacher.locator('#tgInvite').click();
    await expect(teacher.getByRole('dialog',{name:'Позвать в сеанс'})).toBeVisible();
    await expect(teacher.getByLabel('Найти ученика по имени')).toBeFocused();
    for(let i=0;i<14;i++) {
      await teacher.keyboard.press(i<3?'Shift+Tab':'Tab');
      expect(await teacher.evaluate(()=>!!document.activeElement.closest('#tgInvM'))).toBe(true);
    }
    await recordUI(teacher,info,'invitation-dialog');
    await teacher.keyboard.press('Escape');await expect(teacher.locator('#tgInvite')).toBeFocused();
    const splitter=teacher.getByRole('separator',{name:'Ширина условия'});
    await splitter.focus();const before=await teacher.locator('#tgTask').evaluate(el=>el.getBoundingClientRect().width);
    await teacher.keyboard.press('ArrowRight');
    await expect.poll(()=>teacher.locator('#tgTask').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(before);
    await expect(splitter).toBeFocused();await expect(splitter).toHaveAttribute('aria-valuenow',/\d+/);
    await teacher.keyboard.press('Enter');
  } finally {await c.close();}
});
test('Together broadcasts the isolated Python execution result to both roles',async({browser},info)=>{
  const c=await clients(browser),{teacher,pupil}=c;
  try {
    await teacher.locator('#tgTa').fill('print(6 * 7)');await expect(pupil.locator('#tgTa')).toHaveValue('print(6 * 7)');
    await teacher.locator('#tgRun').click();
    for(const page of [teacher,pupil]) await expect(page.locator('#tgOut')).toContainText('42',{timeout:90000});
    await recordUI(pupil,info,'shared-python-output');
  } finally {await c.close();}
});
