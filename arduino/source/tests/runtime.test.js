import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHex,runAVR,translate,workerBody,runPico} from '../src/runtime.js';
import {examples} from '../src/catalog.js';
function record(bytes,address=0,type=0){const a=[bytes.length,address>>8,address&255,type,...bytes];return ':'+[...a,(-a.reduce((a,b)=>a+b,0))&255].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()}
const hex=record([0x25,0x9a,0x2d,0x9a,0xff,0xcf])+'\n:00000001FF';
assert.equal(parseHex(hex)[0],0x9a25);
assert.throws(()=>parseHex(hex.replace('25','24')),/контрольной/);
assert.throws(()=>parseHex(':00000001FF'),/Пустая/);
const pins=[];const avr=runAVR(hex,{pin:(p,v)=>pins.push([p,v]),serial:()=>{}});avr.stop();assert.ok(pins.some(([p,v])=>p===13&&v===1),'real AVR instruction must drive PB5/D13 high');
assert.throws(()=>runPico(new ArrayBuffer(100),{}),/512/);
for(const e of examples){const events=[];const context={postMessage:x=>events.push(x),setTimeout:()=>0,Date,Math};vm.runInNewContext(workerBody(e.code),context);await new Promise(r=>setTimeout(r,5));assert.ok(!events.some(x=>x.type==='error'),`${e.title}: ${JSON.stringify(events)}`);if(e.title.includes('LCD'))assert.ok(events.some(x=>x.type==='lcd'&&x.text.includes('Hello, MicroLab!')));}
const text='void setup(){Serial.println("https://hello int value delay()");} void loop(){delay(1);}';assert.ok(translate(text).includes('"https://hello int value delay()"'));
assert.throws(()=>translate('#include <WiFi.h>\nvoid setup(){} void loop(){}'),/не поддерживается/);
const control='void setup(){for(int i=0;i<3;i++){digitalWrite(i,HIGH);}} void loop(){delay(1);}';const events=[];vm.runInNewContext(workerBody(control),{postMessage:x=>events.push(x),setTimeout:()=>0,Date,Math});await new Promise(r=>setTimeout(r,5));assert.equal(events.filter(x=>x.type==='pin').length,3);
console.log('PASS: Intel HEX validation, real AVR GPIO, UF2 validation, all example sketches, LCD output, loops, strings and unsupported includes.');
