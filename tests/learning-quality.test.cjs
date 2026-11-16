const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function evidence(log) {
  const src=fs.readFileSync('src/app/03-forecast-course.js','utf8');
  const ctx=vm.createContext({P:{log},DAY:86400000,Date,Set});
  vm.runInContext(src.slice(src.indexOf('  const forecastEligible'),src.indexOf('  /**\n   * Вероятности')),ctx);
  return JSON.parse(JSON.stringify(vm.runInContext('forecastEvidence(40*DAY)',ctx)));
}
test('forecast evidence excludes assisted/repeated/self-check/future and reports stale topics',()=>{
  const day=86400000;
  const d=evidence([
    {v:'independent',n:1,t:35*day},
    {v:'independent',n:2,t:day},
    {v:'independent',n:3,t:35*day,r:1},
    {v:'hinted',n:4,t:35*day},
    {v:'together',n:5,t:35*day,w:1},
    {v:'self_check',n:6,t:35*day},
    {n:7,t:35*day},
    {v:'independent',n:8,t:41*day},
  ]);
  assert.equal(d.count,2); assert.equal(d.recent,1); assert.equal(d.excluded,5);
  assert.equal(d.latest,35*day); assert.equal(d.missing.length,26);
  assert.ok(!d.missing.includes(1)); assert.ok(d.missing.includes(2));
});
test('new learner has no fabricated evidence or latest response date',()=>{
  const d=evidence([]);assert.equal(d.count,0);assert.equal(d.latest,0);assert.equal(d.missing.length,27);
});
