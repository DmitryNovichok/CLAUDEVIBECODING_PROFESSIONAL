import {CPU, avrInstruction, AVRIOPort, portBConfig, portCConfig, portDConfig, AVRTimer, timer0Config, timer1Config, timer2Config, AVRUSART, usart0Config, AVRADC, adcConfig} from 'avr8js';
import {Simulator, USBCDC} from 'rp2040js';
import {bootromB1} from './bootrom.js';
export function parseHex(text) {
 const data=new Uint8Array(32768);let base=0,total=0,eof=false;
 for(const line of text.trim().split(/\r?\n/)){if(!line.trim())continue;if(!/^:[0-9a-f]+$/i.test(line))throw Error('Некорректная запись Intel HEX');const bytes=line.slice(1).match(/../g).map(x=>parseInt(x,16));if(bytes.length!==bytes[0]+5||bytes.reduce((a,b)=>a+b,0)%256)throw Error('Ошибка контрольной суммы HEX');const [len,hi,lo,type]=bytes;let addr=base+(hi<<8|lo);if(type===0){if(addr+len>data.length)throw Error('Прошивка превышает 32 КБ ATmega328P');data.set(bytes.slice(4,4+len),addr);total+=len;}else if(type===1)eof=true;else if(type===4)base=(bytes[4]<<8|bytes[5])*65536;else if(type===2)base=(bytes[4]<<8|bytes[5])*16;}
 if(!total||!eof)throw Error('Пустая или незавершённая HEX-прошивка');return new Uint16Array(data.buffer);
}
export function runAVR(hex, callbacks){
 const cpu=new CPU(parseHex(hex));const ports=[new AVRIOPort(cpu,portDConfig),new AVRIOPort(cpu,portBConfig),new AVRIOPort(cpu,portCConfig)];
 new AVRTimer(cpu,timer0Config);new AVRTimer(cpu,timer1Config);new AVRTimer(cpu,timer2Config);const adc=new AVRADC(cpu,adcConfig);const serial=new AVRUSART(cpu,usart0Config,16000000);
 ports.forEach((port,index)=>port.addListener(value=>{for(let bit=0;bit<8;bit++)callbacks.pin(index===0?bit:index===1?bit+8:bit+14,(value>>bit)&1);}));
 const decoder=new TextDecoder();serial.onByteTransmit=b=>callbacks.serial(decoder.decode(new Uint8Array([b]),{stream:true}));let timer,stopped=false;const queue=[];
 function tick(){if(stopped)return;const target=cpu.cycles+160000;while(cpu.cycles<target){avrInstruction(cpu);cpu.tick();}if(queue.length&&serial.writeByte(queue[0]))queue.shift();timer=setTimeout(tick,0);}tick();
 return {stop(){stopped=true;clearTimeout(timer)},input(pin,val){let i=pin<8?0:pin<14?1:2;ports[i]?.setPin(pin-(i===0?0:i===1?8:14),!!val);},analog(pin,value){adc.channelValues[pin]=value/1023*5;},serial(s){queue.push(...Array.from(s,x=>x.charCodeAt(0)));},cpu};
}
export function runPico(buffer,callbacks){
 if(buffer.byteLength%512)throw Error('Некорректный UF2: размер блока 512 байт');const sim=new Simulator();const rp=sim.rp2040;rp.loadBootrom(bootromB1);let loaded=0;
 for(let o=0;o<buffer.byteLength;o+=512){const d=new DataView(buffer,o,512);if(d.getUint32(0,true)!==0x0a324655||d.getUint32(4,true)!==0x9e5d5157||d.getUint32(508,true)!==0x0ab16f30)throw Error('Некорректная UF2-прошивка');const addr=d.getUint32(12,true),len=d.getUint32(16,true);if(len>476)throw Error('Некорректный размер UF2');if(addr>=0x10000000&&addr+len<=0x10000000+rp.flash.length){rp.flash.set(new Uint8Array(buffer,o+32,len),addr-0x10000000);loaded+=len;}}
 if(!loaded)throw Error('В UF2 нет flash-данных RP2040');rp.gpio.forEach((pin,i)=>pin.addListener(v=>callbacks.pin(i,v===1?1:0)));const decoder=new TextDecoder();rp.uart[0].onByte=b=>callbacks.serial(decoder.decode(new Uint8Array([b]),{stream:true}));const usb=new USBCDC(rp.usbCtrl);usb.onSerialData=data=>callbacks.serial(new TextDecoder().decode(data));sim.execute();return {stop(){sim.stop()},input(pin,v){rp.gpio[pin]?.setInputValue(!!v)},analog(){},serial(s){for(const byte of new TextEncoder().encode(s))usb.sendSerialByte(byte)}};
}
export function translate(source){
 const allowed=['Servo.h','LiquidCrystal.h','DHT.h'];
 source=source.replace(/^\s*#include\s*[<"]([^>"]+)[>"]\s*$/gm,(_,name)=>{if(!allowed.includes(name))throw Error(`Библиотека ${name} не поддерживается учебным режимом. Используйте компиляцию или HEX.`);return '';});
 const strings=[];source=source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,t=>{if(t.startsWith('/'))return '';strings.push(t);return '__STR_'+(strings.length-1)+'__';});
 source=source.replace(/^\s*#define\s+(\w+)\s+(.+)$/gm,'const $1 = $2;');
 const names=[];source=source.replace(/\b(?:void|int|float|double|bool|long|unsigned\s+long|String)\s+(\w+)\s*\(([^)]*)\)\s*\{/g,(_,name,args)=>{names.push(name);return `async function ${name}(${args.replace(/\b(?:const\s+)?(?:unsigned\s+)?(?:int|float|double|bool|long|byte|char|String)\s+/g,'')}) {`;});
 source=source.replace(/\bServo\s+(\w+)\s*;/g,'let $1 = new Servo();').replace(/\b(LiquidCrystal|DHT)\s+(\w+)\s*\(([^;]*)\)\s*;/g,'let $2 = new $1($3);');
 source=source.replace(/\bconst\s+(?:unsigned\s+)?(?:long|int|float|double|bool|byte|char|String)\s+/g,'const ').replace(/\b(?:unsigned\s+)?(?:long|int|float|double|bool|byte|char|String)\s+(?=[A-Za-z_]\w*\s*(?:=|;|,|\[))/g,'let ');
 source=source.replace(/\b(\d+)(?:UL|ul|U|u|L|l|f)\b/g,'$1').replace(/\b(let|const)\s+(\w+)\s*\[\s*\]\s*=\s*\{([^}]*)\}/g,'$1 $2 = [$3]');
 for(const name of ['delay','delayMicroseconds','pulseIn',...names])source=source.replace(new RegExp(`(?<!function )\\b${name}\\s*\\(`,'g'),`await ${name}(`);
 if(!names.includes('setup')||!names.includes('loop'))throw Error('Нужны функции void setup() и void loop().');
 return source.replace(/__STR_(\d+)__/g,(_,i)=>strings[Number(i)]);
}
export function workerBody(source){return `
let inputs={},analogs={},modes={},written={},triggered={},start=Date.now();
const HIGH=1,LOW=0,OUTPUT=1,INPUT=0,INPUT_PULLUP=2,LED_BUILTIN=13,A0=14,A1=15,A2=16,A3=17,A4=18,A5=19,DHT22=22,DHT11=11;
const emit=(type,data)=>postMessage({type,...data});
const delay=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms))),delayMicroseconds=us=>delay(us/1000);
const pinMode=(p,m)=>{modes[p]=m;emit('mode',{pin:p,value:m});};
const digitalWrite=(p,v)=>{if(written[p]===1&&!v)triggered[p]=Date.now();written[p]=v?1:0;emit('pin',{pin:p,value:v?1:0});};
const analogWrite=(p,v)=>emit('pin',{pin:p,value:Math.max(0,Math.min(255,v))/255});
const digitalRead=p=>inputs[p]??(modes[p]===INPUT_PULLUP?1:0),analogRead=p=>analogs[p]??0;
const pulseIn=async(p,level,timeout=1000000)=>{const duration=analogs['pulse'+p],trigger=analogs['trigger'+p];if(level!==HIGH||!duration||duration>timeout||triggered[trigger]===undefined||modes[trigger]!==OUTPUT||Date.now()-triggered[trigger]>100)return 0;delete triggered[trigger];await delay(duration/1000);return duration;};
const millis=()=>Date.now()-start,micros=()=>1000*millis(),map=(v,a,b,c,d)=>Math.trunc((v-a)*(d-c)/(b-a)+c),constrain=(v,a,b)=>Math.min(b,Math.max(a,v)),random=(a,b)=>b===undefined?Math.floor(Math.random()*a):a+Math.floor(Math.random()*(b-a));
const min=Math.min,max=Math.max,abs=Math.abs,sqrt=Math.sqrt,pow=Math.pow,round=Math.round,sin=Math.sin,cos=Math.cos,PI=Math.PI;
let rx='';const Serial={begin(){},print:(v='')=>emit('serial',{text:String(v)}),println:(v='')=>emit('serial',{text:String(v)+'\\n'}),available:()=>rx.length,read:()=>{const c=rx.charCodeAt(0);rx=rx.slice(1);return Number.isNaN(c)?-1:c;}};
class Servo{attach(p){this.pin=p}write(v){emit('servo',{pin:this.pin,value:v})}detach(){}}
class LiquidCrystal{constructor(...pins){this.pins=pins;this.x=0;this.y=0;this.rows=['                ','                ']}begin(){}setCursor(x,y){this.x=x;this.y=y}clear(){this.rows=['                ','                '];this.x=0;this.y=0;this.send()}print(v){for(const c of String(v)){if(this.x<16&&this.y<2){this.rows[this.y]=this.rows[this.y].slice(0,this.x)+c+this.rows[this.y].slice(this.x+1);this.x++}}this.send()}send(){emit('lcd',{pins:this.pins,text:this.rows.join('\\n')})}}
class DHT{constructor(p,t){this.pin=p}begin(){}readTemperature(){return analogs['temp'+this.pin]??NaN}readHumidity(){return analogs['humidity'+this.pin]??NaN}}
function tone(pin,hz){emit('tone',{pin,hz})}function noTone(pin){emit('tone',{pin,hz:0})}
onmessage=e=>{if(e.data.type==='inputs'){inputs=e.data.digital;analogs=e.data.analog}if(e.data.type==='serial')rx+=e.data.text;};
(async()=>{try{${translate(source)}\nawait setup();while(true){await loop();await delay(1)}}catch(e){emit('error',{message:e.message})}})();`}
const ERRORS = [
  [/^(\w+) is not defined$/, 'Неизвестное имя «$1». Проверьте написание или объявите переменную.'],
  [/^Cannot access '(\w+)' before initialization$/, 'Переменная «$1» используется до объявления.'],
  [/^Assignment to constant variable\.?$/, 'Нельзя изменить константу.'],
  [/^Identifier '(\w+)' has already been declared$/, 'Имя «$1» объявлено дважды.'],
  [/^(.+) is not a function$/, '«$1» не является функцией или не поддерживается учебным режимом.'],
  [/^Cannot read properties of (undefined|null) \(reading '(.+)'\)$/, 'Обращение к «$2» у несуществующего значения.'],
  [/^Unexpected token '?(.+?)'?$/, 'Синтаксическая ошибка рядом с «$1».'],
  [/^Unexpected identifier '?(.+?)'?$/, 'Синтаксическая ошибка: неожиданное имя «$1». Возможно, пропущена «;».'],
  [/^Unexpected end of input$/, 'Код обрывается: проверьте закрывающие скобки «}».'],
  [/^missing \) after argument list$/, 'Пропущена закрывающая скобка «)».'],
  [/^Invalid or unexpected token$/, 'Недопустимый символ в коде.'],
  [/^Unexpected number$/, 'Синтаксическая ошибка: неожиданное число.'],
  [/^Unexpected string$/, 'Синтаксическая ошибка: неожиданная строка.']
];
export function humanError(message) {
  const text = String(message).replace(/^Uncaught\s+/, '').replace(/^(SyntaxError|ReferenceError|TypeError|RangeError|Error):\s*/, '');
  for (const [re, ru] of ERRORS) if (re.test(text)) return text.replace(re, ru);
  return text;
}

export function runEducational(source,callbacks){
 let body;
 try { body=workerBody(source); new Function(body); }
 catch(e){ throw Object.assign(Error(humanError(e.message)),{line:e.line}); }
 const url=URL.createObjectURL(new Blob([body],{type:'text/javascript'}));
 const w=new Worker(url);URL.revokeObjectURL(url);
 w.onmessage=e=>{const d=e.data;if(d.type==='pin')callbacks.pin(d.pin,d.value);else if(d.type==='serial')callbacks.serial(d.text);else if(d.type==='error')callbacks.error(humanError(d.message));else callbacks.event(d)};
 w.onerror=e=>{e.preventDefault?.();callbacks.error(humanError(e.message||'Ошибка выполнения'));};
 return {stop(){w.terminate()},inputs(digital,analog){w.postMessage({type:'inputs',digital,analog})},serial(text){w.postMessage({type:'serial',text})}};
}
