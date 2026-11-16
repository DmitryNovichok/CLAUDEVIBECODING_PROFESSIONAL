// Pure report transform, tested without launching a browser.
function summarize(report,run={}) {
  const cases=[];
  function walk(suite,parents=[]) {
    const titles=suite.title?[...parents,suite.title]:parents;
    for(const spec of suite.specs || []) for(const test of spec.tests || []) {
      const attempts=test.results || [],last=attempts.at(-1);
      const errors=attempts.flatMap(r=>[r.error,...(r.errors || [])]).filter(Boolean).map(e=>e.message || String(e));
      const browserLaunchFailure=errors.some(e=>/browserType\.launch|Executable doesn't exist|Failed to launch (?:browser|chromium)/.test(e));
      cases.push({title:[...titles,spec.title].join(' › '),file:spec.file,line:spec.line,
        status:!last?'not-run':last.status==='skipped'?'skipped':browserLaunchFailure?'blocked':last.status,
        playwrightOutcome:test.status, attempts:attempts.length, durationMs:attempts.reduce((s,r)=>s+(r.duration||0),0),
        errors:[...new Set(errors)],attachments:attempts.flatMap(r=>(r.attachments||[]).map(a=>({name:a.name,path:a.path,contentType:a.contentType}))),
      });
    }
    for(const child of suite.suites || []) walk(child,titles);
  }
  for(const suite of report?.suites || []) walk(suite);
  const counts={};for(const c of cases) counts[c.status]=(counts[c.status]||0)+1;
  return {schema:1,...run,execution:!report?'no-report':run.exitCode===0?'completed':'incomplete-or-failed',
    counts,cases,globalErrors:report?.errors || [],
    visualReview:'not-performed: screenshot capture is evidence, not visual approval',
    accessibilityScope:'targeted labels, error descriptions, focus, keyboard, contrast and viewport assertions only; not full WCAG certification',
    performanceScope:'synthetic profiles only; see performance attachments for environment and caveats'};
}
module.exports={summarize};
