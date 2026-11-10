import {inputLabel} from './year-check.js';
export {inputLabel} from './year-check.js';
// Each experiment specifies an observable input/output contract and a reference sketch.
import {lessons as foundations} from './course.js';
const byId=Object.fromEntries(foundations.map(lesson=>[lesson.id,lesson]));
const kit={
 pulse:['first-light'],externalPulse:['external-led'],button:['button'],pair:['button'],
 adc:['analog'],adcLamp:['analog'],pwm:['dimmer'],servo:['servo'],servoButton:['barrier'],
 lcd:['display','analog'],climate:['climate'],screen:['weather'],signal:['traffic','analog'],
 gate:['barrier','analog']
};
const usesPot=new Set(['adc','adcLamp','pwm','servo','lcd','signal','gate']);
function circuit(kind){
 const parts=new Map(),wires=new Map();
 for(const id of kit[kind]){
  for(const part of byId[id].parts)parts.set(part.id,structuredClone(part));
  for(const wire of byId[id].required)wires.set(wire.slice(0,2).join(' '),structuredClone(wire));
 }
 if(kind==='pair'){
  parts.set('second',{...parts.get('button'),id:'second',left:565,attrs:{color:'blue'}});
  wires.set('second-in',['uno:3','second:1.l','#5086ae',[]]);
  wires.set('second-gnd',['uno:GND.2','second:2.l','#66736c',[]]);
 }
 if(kind==='signal')parts.get('pot').top=360;
 if(kind==='lcd'){parts.get('pot').left=465;parts.get('pot').top=270;}
 return {parts:[...parts.values()],connections:[...wires.values()],required:[...wires.values()]};
}
const buttonKinds=new Set(['button','pair','servoButton','gate']);
function sketch(kind,logic,state=''){
 const headers=[],setup=[],reads=[];let write='';
 if(usesPot.has(kind))reads.push('int raw = analogRead(A0);');
 if(buttonKinds.has(kind)){setup.push('pinMode(2, INPUT_PULLUP);');reads.push('bool pressed = digitalRead(2) == LOW;')}
 if(kind==='pair'){setup.push('pinMode(3, INPUT_PULLUP);');reads.push('bool other = digitalRead(3) == LOW;')}
 if(['servo','servoButton','gate'].includes(kind)){headers.push('#include <Servo.h>','Servo motor;');setup.push('motor.attach(9);');write='motor.write(value);'}
 if(['lcd','screen'].includes(kind)){headers.push('#include <LiquidCrystal.h>','LiquidCrystal lcd(12, 11, 5, 4, 3, 2);');setup.push('lcd.begin(16, 2);');}
 if(['screen','climate'].includes(kind)){headers.push('#include <DHT.h>','DHT sensor(7, DHT22);');setup.push('sensor.begin();');reads.push('float temp = sensor.readTemperature();','float hum = sensor.readHumidity();');}
 if(['button','pair','adcLamp','climate'].includes(kind)){setup.push('pinMode(13, OUTPUT);');write='digitalWrite(13, value);';}
 if(kind==='adc'){setup.push('Serial.begin(9600);');write='Serial.println(value);';}
 if(kind==='pwm'){setup.push('pinMode(9, OUTPUT);');write='analogWrite(9, value);';}
 if(kind==='signal'){setup.push(...[10,9,8].map(n=>'pinMode('+n+', OUTPUT);'));write='digitalWrite(10, value == 1);\n  digitalWrite(9, value == 2);\n  digitalWrite(8, value == 3);';}
 if(['lcd','screen'].includes(kind))write='lcd.clear();\n  lcd.print(value);';
 if(kind.endsWith('Pulse')||kind==='pulse'){setup.push('pinMode(13, OUTPUT);');return [...headers,state,'void setup() {',...setup.map(x=>'  '+x),'}','void loop() {','  '+logic,'}'].filter(Boolean).join('\n');}
 const declaration=['lcd','screen'].includes(kind)?'String value = "";':'int value = 0;';
 return [...headers,state,'void setup() {',...setup.map(x=>'  '+x),'}','void loop() {',...reads.map(x=>'  '+x),'  '+declaration,'  '+logic,'  '+write,'  delay(80);','}'].filter(Boolean).join('\n');
}
const outputLabels={adc:'число в Serial Monitor',pwm:'значение ШИМ на D9 (0–255)',servo:'угол привода в градусах',servoButton:'угол привода в градусах',gate:'угол привода в градусах',lcd:'первая строка LCD',screen:'первая строка LCD',signal:'сигнал (1 — красный, 2 — жёлтый, 3 — зелёный)'};
export function experiment(id,kind,title,goal,theory,example,analysis,logic,cases,homework,state=''){
 const isWave=kind==='pulse'||kind==='externalPulse';
 const wave=isWave?cases:null;
 const output=outputLabels[kind]||'состояние LED (0 — погашен, 1 — горит)';
 const testText=isWave?'Длительности включений и пауз по порядку: '+wave.join(', ')+' мс.':cases.map(([i,e])=>inputLabel(kind,i)+' → '+e).join('; ');
 const question=isWave?'Сколько миллисекунд занимает один полный цикл?':'Спрогнозируйте '+output+' при испытании №'+Math.min(2,cases.length)+'.';
 const answer=isWave?String(wave.reduce((a,b)=>a+b,0)):String(cases[Math.min(1,cases.length-1)][1]);
 const others=isWave?[String(wave[0]),String(Number(answer)*2)]:[...new Set(cases.map(x=>String(x[1])))].filter(x=>x!==answer);
 if(others.length<2)others.push('Результат зависит только от предыдущей строки кода');
 const options=[answer,...others.filter(x=>x!==answer).slice(0,2)];
 const position=Array.from(id).reduce((n,c)=>n+c.charCodeAt(0),0)%options.length;options.push(...options.splice(0,position));
 const task=goal+' '+testText+(isWave?'':' Пройдите испытания по порядку, удерживая вход около секунды.');
 const inputHelp=kind==='pair'?'Для сочетания кнопок откройте свойства двойным щелчком и зафиксируйте одну из кнопок.':isWave?'Запустите программу и наблюдайте повторение.':'Дважды щёлкните по компоненту, чтобы задать точное значение, либо удерживайте кнопку.';
 return {...circuit(kind),id,title,minutes:45,desc:goal,concept:title,paragraphs:[theory,analysis],question,options,answer:options.indexOf(answer),task,hint:inputHelp,
 notes:[example,analysis,'До запуска предскажите результаты. '+inputHelp+' Проверьте сценарии: '+testText,goal,homework],
 rule:'year',experiment:{kind,cases:isWave?[]:cases,wave},code:sketch(kind,isWave?'// Добавьте импульсы и паузы\n  delay(100);':'// Рассчитайте value для текущего входа',state),solution:sketch(kind,logic,state)};
}
export function pulse(id,title,goal,theory,pattern,homework,external=false){
 const logic=pattern.map((ms,i)=>'digitalWrite(13, '+(i%2?'LOW':'HIGH')+'); delay('+ms+');').join('\n  ');
 return experiment(id,external?'externalPulse':'pulse',title,goal,theory,'delay('+pattern[0]+');','Один период заканчивается перед следующим таким же фронтом. Сложите длительности всех фаз.',logic,pattern,homework);
}
