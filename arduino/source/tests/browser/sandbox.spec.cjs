// Imported by the repository's Playwright suite. Real opaque frame/worker under
// the production parent CSP; intentionally permissive synthetic account API.
const path=require('node:path');
const ROOT=path.resolve(__dirname,'../../../..');
const {test,expect}=require(path.join(ROOT,'tests/browser/node_modules/@playwright/test'));
const {build}=require('../../node_modules/esbuild');
const http=require('node:http');
const policyFor=require(path.join(ROOT,'tests/browser/csp-policy.cjs'));
let server,origin,policy,bundle,requests=[];
const sockets=new Set();
test.beforeAll(async()=>{
  bundle=(await build({entryPoints:[path.join(ROOT,'arduino/source/src/runtime.js')],bundle:true,format:'esm',minify:true,write:false})).outputFiles[0].text;
  server=http.createServer((req,res)=>{
    res.setHeader('Content-Security-Policy',policy);
    if(req.url==='/'){
      res.setHeader('Set-Cookie','principal=synthetic-private; Path=/; HttpOnly; SameSite=Lax');
      res.setHeader('Content-Type','text/html');
      return res.end('<!doctype html><script type="module">import{runEducational}from"/runtime.js";window.startSketch=code=>{window.events=[];window.engine=runEducational(code,{pin:(pin,value)=>events.push({type:"pin",pin,value}),serial:text=>events.push({type:"serial",text}),event:e=>events.push(e),error:message=>events.push({type:"error",message})});};</script>');
    }
    if(req.url==='/runtime.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle);}
    if(req.url.startsWith('/api/')){requests.push({method:req.method,url:req.url,cookie:req.headers.cookie});return res.end('principal-secret');}
    res.statusCode=404;res.end('missing');
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('upgrade',(req,socket)=>{requests.push({method:'WS',url:req.url});socket.destroy();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin='http://127.0.0.1:'+server.address().port;policy=policyFor(origin);
});
test.afterAll(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
test.beforeEach(async({page})=>{requests=[];await page.goto(origin);await page.waitForFunction(()=>typeof window.startSketch==='function');});

test('Arduino preserves digital/analog input, Serial, servo, LCD and tone through the narrow bridge',async({page})=>{
  await page.evaluate(()=>{
    startSketch('Servo arm;\nLiquidCrystal lcd(12,11,10,9,8,7);\nvoid setup(){pinMode(13,OUTPUT);arm.attach(3);arm.write(45);lcd.begin(16,2);lcd.print("HELLO");tone(4,440);Serial.println("ready");}\nvoid loop(){digitalWrite(13,digitalRead(2));Serial.println(analogRead(A0));if(Serial.available()){Serial.println(Serial.read());}delay(25);}');
    // Queue before the iframe finishes loading: the first useful inputs survive.
    engine.inputs({2:1},{14:321});engine.serial('Z');
  });
  await expect.poll(()=>page.evaluate(()=>events.filter(e=>e.type==='serial').map(e=>e.text).join(''))).toContain('321');
  await expect.poll(()=>page.evaluate(()=>events.filter(e=>e.type==='serial').map(e=>e.text).join(''))).toContain('90');
  const events=await page.evaluate(()=>window.events);
  expect(events).toContainEqual({type:'pin',pin:13,value:1});
  expect(events).toContainEqual({type:'servo',pin:3,value:45});
  expect(events).toContainEqual({type:'tone',pin:4,hz:440});
  expect(events.some(e=>e.type==='lcd'&&e.text.includes('HELLO'))).toBe(true);
  expect(events.filter(e=>e.type==='error')).toEqual([]);
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
  await page.evaluate(()=>engine.stop());
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('untrusted sketch cannot read/mutate account APIs or request parent-side fetch',async({page})=>{
  const target=JSON.stringify(origin+'/api/admin/private');
  const source=`void setup(){
    Serial.println(self.location.origin);
    fetch(${target},{credentials:"include"}).then(()=>Serial.println("LEAK GET")).catch(()=>Serial.println("blocked GET"));
    fetch(${target},{method:"POST",credentials:"include",mode:"no-cors",body:"attack"}).then(()=>Serial.println("LEAK POST")).catch(()=>Serial.println("blocked POST"));
    try{let x=new XMLHttpRequest();x.open("POST",${target},false);x.withCredentials=true;x.send("attack");Serial.println("LEAK XHR");}catch(e){Serial.println("blocked XHR");}
    try{importScripts(${target});Serial.println("LEAK script");}catch(e){Serial.println("blocked script");}
    try{let socket=new WebSocket(${JSON.stringify(origin.replace('http:','ws:')+'/api/together/ws')});socket.onopen=()=>Serial.println("LEAK WS");socket.onerror=()=>Serial.println("blocked WS");}catch(e){Serial.println("blocked WS");}
    try{Serial.println(parent.document.cookie);}catch(e){Serial.println("no parent document");}
    postMessage({type:"fetch",url:${target},credentials:"include"});
    postMessage({kind:"ready"});
    postMessage({type:"pin",pin:"__proto__",value:1});
    Serial.println("completed");
  } void loop(){delay(1000);}`;
  await page.evaluate(code=>startSketch(code),source);
  const text=()=>page.evaluate(()=>events.filter(e=>e.type==='serial').map(e=>e.text).join(''));
  await expect.poll(text).toContain('blocked POST');
  await expect.poll(text).toContain('blocked WS');
  const out=await text();
  for(const fragment of ['null','blocked GET','blocked XHR','blocked script','no parent document','completed'])expect(out).toContain(fragment);
  expect(out).not.toContain('LEAK');
  expect(requests).toEqual([]);
  expect(await page.evaluate(()=>events.filter(e=>e.type==='pin'||e.type==='fetch'))).toEqual([]);
  await page.evaluate(()=>engine.stop());
});

test('stopping an infinite sketch destroys its worker and a clean run can follow',async({page})=>{
  await page.evaluate(()=>startSketch('void setup(){Serial.println("running");while(true){}} void loop(){}'));
  await expect.poll(()=>page.evaluate(()=>events.some(e=>e.type==='serial'&&e.text.includes('running')))).toBe(true);
  await page.evaluate(()=>engine.stop());
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.evaluate(()=>startSketch('void setup(){Serial.println(42);} void loop(){delay(1000);}'));
  await expect.poll(()=>page.evaluate(()=>events.some(e=>e.type==='serial'&&e.text.includes('42')))).toBe(true);
  await page.evaluate(()=>engine.stop());
});

test('syntax errors still reach the UI and release the isolated frame',async({page})=>{
  await page.evaluate(()=>startSketch('void setup(){int n = ;} void loop(){delay(1);}'));
  await expect.poll(()=>page.evaluate(()=>events.filter(e=>e.type==='error').map(e=>e.message).join(''))).toContain('Синтаксическая ошибка');
  await expect(page.locator('iframe')).toHaveCount(0);
});
