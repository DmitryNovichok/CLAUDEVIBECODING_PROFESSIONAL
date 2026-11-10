import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {catalog} from '../src/catalog.js';
import {gates} from '../src/parts-library.js';
import {externalIO,evaluateNet} from '../src/io-parts.js';
const types=new Set(catalog.map(c=>c.type));
assert.equal(types.size,catalog.length);
const dir='node_modules/@wokwi/elements/dist/esm/';
for(const file of readdirSync(dir).filter(f=>f.endsWith('-element.js'))){
 const source=readFileSync(dir+file,'utf8');
 for(const [,tag] of source.matchAll(/customElement\('([^']+)'/g))assert.ok(types.has(tag),tag);
}
const expected={not:[1,0],and:[0,0,0,1],or:[0,1,1,1],xor:[0,1,1,0],nand:[1,1,1,0],mux:[0,0,0,1,1,0,1,1]};
for(const [type,table] of Object.entries(expected)){
 const part={type:'microlab-'+type};
 const parts=new Map([['gate',part]]);
 const pins=gates[type].pins.split(' ').slice(0,-1);
 for(const [bits,result] of table.entries()){
  const base=net=>{const pin=[...net][0].split(':')[1],idx=pins.indexOf(pin);return idx===-1?null:(bits>>(pins.length-idx-1))&1};
  assert.equal(evaluateNet(new Set(['gate:Y']),base,parts,pin=>new Set([pin])),result,type+' '+bits);
 }
}
const cyclic=new Map([['g',{type:'microlab-not'}]]);
assert.equal(evaluateNet(new Set(['g:Y']),()=>null,cyclic,()=>new Set(['g:Y'])),null);
assert.deepEqual(externalIO({type:'wokwi-photoresistor-sensor',attrs:{value:987}},'AO',{}),{analog:987});
assert.deepEqual(externalIO({type:'wokwi-pir-motion-sensor',attrs:{digital:'1'}},'OUT',{}),{digital:1});
console.log('PASS: full Elements registry, unique parts, gate truth tables, feedback loop and sensor input levels.');
