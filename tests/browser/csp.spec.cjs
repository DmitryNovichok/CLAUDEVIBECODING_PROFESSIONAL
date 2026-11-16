// Enforced browser checks. Run in a normal Chromium-capable CI host; no flags
// disable the browser/OS sandbox and no production endpoint is contacted.
const {test, expect} = require('@playwright/test');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const policyFor = require('./csp-policy.cjs');
const ROOT = path.resolve(__dirname, '../..');
let server, foreign, origin, foreignOrigin, policy, foreignRequests = 0, wsRequests = 0;
const sockets = new Set();
test.beforeAll(async () => {
  foreign = http.createServer((req,res) => {foreignRequests++;res.end('window.foreignRan=true');});
  foreign.on('upgrade', (req,socket) => {foreignRequests++;socket.destroy();});
  server = http.createServer((req,res) => {
    res.setHeader('Content-Security-Policy', policy);
    const send = (body,type) => {res.setHeader('Content-Type',type);res.end(body);};
    if(req.url === '/') return send('<!doctype html><script>window.violations=[];addEventListener("securitypolicyviolation",e=>violations.push({directive:e.effectiveDirective,url:e.blockedURI}));window.inlineRan=true;</script><script src="/probe.js"></script><h1>CSP fixture</h1>', 'text/html');
    if(req.url === '/probe.js') return send(`
      window.localRan=true;
      // Execute this probe as a real page script: DevTools evaluation can bypass
      // the eval restriction and must only read the recorded result below.
      window.executionProbeReady=(async()=>{
        let evaluated=false;
        try { new Function('return 42')(); evaluated=true; } catch (_) {}
        const binary=new Uint8Array([0,97,115,109,1,0,0,0]);
        const wasm=await WebAssembly.instantiate(binary);
        return {evaluated,wasm:!!wasm.instance};
      })();
    `, 'text/javascript');
    if(req.url === '/api/ping') return send('ok', 'text/plain');
    if(req.url === '/font.woff2') {
      const folder=path.join(ROOT,'vendor/fonts');
      const name=fs.readdirSync(folder).find(n=>n.endsWith('.woff2'));
      return send(fs.readFileSync(path.join(folder,name)), 'font/woff2');
    }
    res.statusCode=404;send('missing','text/plain');
  });
  server.on('upgrade',(req,socket)=>{
    if(req.url !== '/api/together/ws') return socket.destroy();
    wsRequests++;
    const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    socket.on('data',()=>socket.end(Buffer.from([0x88,0])));
  });
  for(const s of [server,foreign]) s.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await Promise.all([new Promise(r=>server.listen(0,'127.0.0.1',r)),new Promise(r=>foreign.listen(0,'127.0.0.1',r))]);
  origin='http://127.0.0.1:'+server.address().port;
  foreignOrigin='http://127.0.0.1:'+foreign.address().port;
  policy=policyFor(origin);
});
test.afterAll(async()=>{
  for(const socket of sockets)socket.destroy();
  await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>foreign.close(r))]);
});
test.beforeEach(async({page})=>{foreignRequests=0;wsRequests=0;await page.goto(origin);});

test('unknown script and fetch origins are blocked before contacting the other server',async({page})=>{
  const result=await page.evaluate(async foreign=>{
    const script=await new Promise(resolve=>{
      const s=document.createElement('script');s.src=foreign+'/attack.js';s.onload=()=>resolve(true);s.onerror=()=>resolve(false);document.head.appendChild(s);
    });
    let connected=false;try{await fetch(foreign+'/collect');connected=true;}catch(_){}
    return {script,connected,foreignRan:!!window.foreignRan,localRan:window.localRan,inlineRan:window.inlineRan};
  },foreignOrigin);
  expect(result).toEqual({script:false,connected:false,foreignRan:false,localRan:true,inlineRan:true});
  expect(foreignRequests).toBe(0);
  await expect.poll(()=>page.evaluate(()=>violations.filter(v=>v.directive==='script-src-elem'||v.directive==='connect-src').length)).toBeGreaterThanOrEqual(2);
});

test('only the pinned Pyodide directory is allowed on the shared CDN',async({page})=>{
  let allowedRequests=0,otherRequests=0;
  await page.route('https://cdn.jsdelivr.net/**',route=>{
    if(route.request().url().includes('/pyodide/v0.28.3/full/'))allowedRequests++;else otherRequests++;
    return route.fulfill({contentType:'text/javascript',body:'window.pinnedProbe=(window.pinnedProbe||0)+1;'});
  });
  const results=await page.evaluate(async()=>{
    const load=src=>new Promise(resolve=>{const s=document.createElement('script');s.src=src;s.onload=()=>resolve(true);s.onerror=()=>resolve(false);document.head.appendChild(s);});
    return [await load('https://cdn.jsdelivr.net/pyodide/v0.28.3/full/csp-probe.js'),
      await load('https://cdn.jsdelivr.net/npm/unreviewed/csp-probe.js'),
      await load('https://cdn.jsdelivr.net/pyodide/v0.29.0/full/csp-probe.js')];
  });
  expect(results).toEqual([true,false,false]);
  expect(allowedRequests).toBe(1);expect(otherRequests).toBe(0);
  expect(await page.evaluate(()=>window.pinnedProbe)).toBe(1);
});

test('same-site HTTP and WebSocket work; foreign WebSocket and JavaScript eval do not',async({page})=>{
  const result=await page.evaluate(async({origin,foreignOrigin})=>{
    const ws=address=>new Promise(resolve=>{const socket=new WebSocket(address);socket.onopen=()=>{socket.close();resolve(true);};socket.onerror=()=>resolve(false);});
    const {evaluated,wasm}=await window.executionProbeReady;
    return {http:await(await fetch('/api/ping')).text(),ws:await ws(origin.replace('http:','ws:')+'/api/together/ws'),
      foreign:await ws(foreignOrigin.replace('http:','ws:')+'/api/together/ws'),evaluated,wasm};
  },{origin,foreignOrigin});
  expect(result).toEqual({http:'ok',ws:true,foreign:false,evaluated:false,wasm:true});
  expect(wsRequests).toBe(1);expect(foreignRequests).toBe(0);
  await expect.poll(()=>page.evaluate(()=>violations.some(v=>v.directive==='script-src'&&v.url==='eval'))).toBe(true);
});

test('local fonts, blob images and blob workers remain functional',async({page})=>{
  const result=await page.evaluate(async()=>{
    const font=await new FontFace('CspFixture','url(/font.woff2)').load();document.fonts.add(font);
    const imageURL=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'],{type:'image/svg+xml'}));
    const image=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.width);img.onerror=()=>resolve(0);img.src=imageURL;});URL.revokeObjectURL(imageURL);
    const workerURL=URL.createObjectURL(new Blob(['postMessage(42)'],{type:'text/javascript'}));
    const worker=await new Promise((resolve,reject)=>{const w=new Worker(workerURL);w.onmessage=e=>{w.terminate();resolve(e.data);};w.onerror=reject;});URL.revokeObjectURL(workerURL);
    return {font:font.status,image,worker};
  });
  expect(result).toEqual({font:'loaded',image:2,worker:42});
});
