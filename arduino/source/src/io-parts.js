import {gates} from './parts-library.js';
export const pots=new Set(['wokwi-potentiometer','wokwi-slide-potentiometer']);
export const buttons=new Set(['wokwi-pushbutton','wokwi-pushbutton-6mm']);
// Pin names from the installed Wokwi Elements models. The adjustable signal
// represents the sensor output, not its physical environment.
export const signals={
 'wokwi-pir-motion-sensor':{digital:'OUT'},'wokwi-tilt-switch':{digital:'OUT'},
 'wokwi-heart-beat-sensor':{analog:'OUT'},'wokwi-ntc-temperature-sensor':{analog:'OUT'},
 'wokwi-photoresistor-sensor':{analog:'AO',digital:'DO'},
 'wokwi-gas-sensor':{analog:'AOUT',digital:'DOUT'},'wokwi-big-sound-sensor':{analog:'AOUT',digital:'DOUT'},
 'wokwi-small-sound-sensor':{analog:'AOUT',digital:'DOUT'},'wokwi-flame-sensor':{analog:'AOUT',digital:'DOUT'}
};
export function externalIO(part,pin,el){
 if(!el)return;
 if(pots.has(part.type)&&pin==='SIG')return {analog:Number(el.value)};
 if(part.type==='wokwi-analog-joystick'){
  if(pin==='SEL')return {digital:el.pressed?0:1};
  if(pin==='HORZ'||pin==='VERT')return {analog:Math.round((1+(pin==='HORZ'?el.xValue:el.yValue))*511.5)};
 }
 const signal=signals[part.type];
 if(signal&&pin===signal.analog)return {analog:Math.min(1023,Math.max(0,Number(part.attrs.value)||0))};
 if(signal&&pin===signal.digital)return {digital:part.attrs.digital==='1'?1:0};
}
export function evaluateNet(net,base,parts,reach,visited=new Set()){
 const fixed=base(net);if(fixed!==null)return fixed;
 for(const ref of net){
  const [id,pin]=ref.split(':'),p=parts.get(id);
  if(!p||pin!=='Y'||visited.has(id))continue;
  const g=gates[p.type.replace(/^microlab-/,'')];if(!g)continue;
  const path=new Set(visited).add(id);
  const inputs=g.pins.split(' ').slice(0,-1).map(n=>evaluateNet(reach(id+':'+n),base,parts,reach,path));
  if(inputs.every(v=>v!==null))return Number(g.evaluate(inputs.map(v=>v>=0.5)));
 }
 return null;
}
