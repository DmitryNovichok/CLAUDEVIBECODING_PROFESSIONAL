// Evidence is attached only after a browser actually visits the rendered state.
// This is a targeted regression record, not a WCAG certificate or visual approval.
async function recordUI(page, testInfo, name) {
  const metrics = await page.evaluate(() => ({
    viewport:{width:innerWidth,height:innerHeight},
    documentWidth:document.documentElement.scrollWidth,
    focused:document.activeElement?.id || document.activeElement?.tagName,
    dialogs:[...document.querySelectorAll('dialog[open],[role=dialog]:not([hidden])')].map(el=>el.id),
    inputs:[...document.querySelectorAll('input,textarea,select')].filter(el=>el.getClientRects().length && !el.closest('[hidden]')).map(el=>({
      id:el.id,label:el.getAttribute('aria-label') || [...el.labels || []].map(x=>x.textContent.trim()).join(' '),
      describedBy:el.getAttribute('aria-describedby'),invalid:el.getAttribute('aria-invalid'),
    })),
  }));
  await testInfo.attach(name+'.png',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await testInfo.attach(name+'.aria.yml',{body:await page.locator('body').ariaSnapshot(),contentType:'text/yaml'});
  await testInfo.attach(name+'.json',{body:JSON.stringify({
    scope:'Automated targeted checks and captured browser evidence only',
    visualReview:'pending: screenshots require human review',
    accessibilityAudit:'partial: no claim of complete WCAG compliance',...metrics,
  },null,2),contentType:'application/json'});
}
module.exports={recordUI};
