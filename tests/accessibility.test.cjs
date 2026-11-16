const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {summarize}=require('./browser/summarize.cjs');
function loginPage(file) {
  const nodes={},labels=[{hidden:false},{hidden:false}];
  for(const id of ['appView','loginView','admLogin','admPassword','admCode','admCodeBack','admCodeNote','admLoginErr','admLoginForm','admForgot']) nodes[id]={
    value:'',hidden:id==='admCode',required:false,disabled:false,textContent:'',attrs:{},listeners:{},
    addEventListener(type,handler){this.listeners[type]=handler;},focus(){nodes.focused=id;},
    setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
    querySelector(){return {disabled:false};},
  };
  const state={status:403,data:{error:'Неверный логин или пароль'}},sent=[];
  const $=selector=>nodes[selector.slice(1)];
  const ctx={$,document:{querySelector:$,querySelectorAll:()=>labels},URLSearchParams,
    location:{protocol:'http:',search:'',pathname:'/admin',reload(){}},history:{replaceState(){}},
    setTimeout:fn=>fn(),prompt:()=>'',fetch:async(url,opts)=>{sent.push(JSON.parse(opts.body));return{status:state.status,ok:state.status<400,json:async()=>state.data};},
  };
  let code=fs.readFileSync(file,'utf8');
  if(file==='admin.js') code=code.slice(code.indexOf('  let codeTicket = null;'),code.indexOf("  $('#admForgot').addEventListener"));
  vm.runInNewContext(code,ctx);
  return {nodes,state,labels,sent,submit:()=>nodes.admLoginForm.listeners.submit({preventDefault(){},target:nodes.admLoginForm})};
}
for(const file of ['admin-login.js','admin.js']) {
  test(file+': credential/code errors have invalid fields, transport failures do not',async()=>{
    const p=loginPage(file);p.nodes.admLogin.value='fixture@example.invalid';p.nodes.admPassword.value='synthetic-password';
    await p.submit();assert.equal(p.nodes.admLogin.attrs['aria-invalid'],'true');assert.equal(p.nodes.admPassword.attrs['aria-invalid'],'true');
    assert.equal(p.nodes.admCode.attrs['aria-invalid'],undefined);
    p.nodes.admPassword.listeners.input();assert.equal(p.nodes.admLoginErr.textContent,'');assert.equal(p.nodes.admLogin.attrs['aria-invalid'],undefined);
    p.state.status=503;p.state.data={error:'Нет связи с почтовым сервером'};await p.submit();
    assert.equal(p.nodes.admPassword.attrs['aria-invalid'],undefined);assert.match(p.nodes.admLoginErr.textContent,/почтовым/);
    p.state.status=200;p.state.data={need_code:true,ticket:'synthetic',backup_only:true};await p.submit();
    assert.equal(p.nodes.admCode.hidden,false);assert.equal(p.nodes.focused,'admCode');assert.match(p.nodes.admCodeNote.textContent,/недоступна/);
    p.nodes.admCode.value='1234abcd-1234abcd-1234abcd-1234abcd';p.state.status=403;p.state.data={error:'Неверный код'};await p.submit();
    assert.equal(p.nodes.admCode.attrs['aria-invalid'],'true');assert.equal(p.nodes.admLogin.attrs['aria-invalid'],undefined);
    assert.deepEqual(p.sent.at(-1),{ticket:'synthetic',code:p.nodes.admCode.value});
    p.nodes.admCodeBack.listeners.click();assert.equal(p.nodes.admCode.hidden,true);assert.equal(p.nodes.admCode.attrs['aria-invalid'],undefined);
  });
}
test('graph keyboard activation dispatches the existing action, with Space prevented from scrolling',()=>{
  const source=fs.readFileSync('src/app/12j-labs.js','utf8');
  const start=source.indexOf("  trainerEl.addEventListener('keydown', e => {");
  const end=source.indexOf('\n  new MutationObserver',start);let handler;
  vm.runInNewContext(source.slice(start,end),{trainerEl:{addEventListener(type,fn){handler=fn;}},labActive:()=>true,LAB:{view:'tasks'},MouseEvent:class {constructor(type,opts){this.type=type;this.bubbles=opts.bubbles;}}});
  for(const key of ['Enter',' ']) {
    let prevented=false,event=null;
    handler({key,preventDefault(){prevented=true;},target:{closest:()=>({dispatchEvent(e){event=e;}})}});
    assert.equal(prevented,true);assert.equal(event.type,'click');assert.equal(event.bubbles,true);
  }
});
test('browser report distinguishes blocked, skipped, not-run and actual passed results',()=>{
  const report={suites:[{title:'Fixture',specs:[
    {title:'blocked',tests:[{status:'unexpected',results:[{status:'failed',error:{message:'browserType.launch: OS blocked'}}]}]},
    {title:'skipped',tests:[{results:[{status:'skipped'}]}]},
    {title:'pending',tests:[{results:[]}]},
    {title:'works',tests:[{status:'expected',results:[{status:'passed',duration:5,attachments:[{name:'ui.png',path:'ui.png'}]}]}]},
  ]}]};
  const result=summarize(report,{exitCode:1});
  assert.deepEqual(result.counts,{blocked:1,skipped:1,'not-run':1,passed:1});
  assert.equal(result.execution,'incomplete-or-failed');assert.match(result.visualReview,/not-performed/);
  assert.equal(summarize(null,{exitCode:1}).execution,'no-report');
});
