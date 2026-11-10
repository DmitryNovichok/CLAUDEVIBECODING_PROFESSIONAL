import {inspectCircuit,verifyBlink} from './circuit-check.js';
import {verifyExperiment} from './year-check.js';
// Course data and pure validation. No page state or fabricated progress.
export const modules=[
 {title:'Первые сигналы',subtitle:'Знакомимся с платой и собираем первую цепь',icon:'spark',color:'mint',skill:'Основы электроники'},
 {title:'От сигнала к действию',subtitle:'Учимся читать кнопки и управлять яркостью',icon:'sliders',color:'blue',skill:'Входы и выходы'},
 {title:'Устройства вокруг нас',subtitle:'Подключаем механизмы, экраны и датчики',icon:'chip',color:'peach',skill:'Работа с модулями'},
 {title:'Собственные проекты',subtitle:'Объединяем знания в работающие устройства',icon:'rocket',color:'lilac',skill:'Создатель проектов'}
];
const part=(type,id,left,top,attrs={})=>({type:'wokwi-'+type,id,left,top,attrs});
const wire=(a,b,color='#3ba889')=>[a,b,color,[]];
const pot=()=>part('potentiometer','pot',420,260,{value:'512'}),led=(id='led',pin=13)=>part('led',id,420,100,{color:'green'}),res=(id='r')=>part('resistor',id,430,190,{value:'220'});
const ledW=(pin=13,id='led',r='r')=>[wire('uno:'+pin,r+':1'),wire(r+':2',id+':A'),wire(id+':C','uno:GND.1','#607577')];
const potW=()=>[wire('uno:A0','pot:SIG','#d59a48'),wire('uno:5V','pot:VCC','#ce7062'),wire('uno:GND.2','pot:GND','#607577')];
const button=()=>part('pushbutton','button',430,330,{color:'green'}),buttonW=()=>[wire('uno:2','button:1.l'),wire('uno:GND.1','button:2.l','#607577')];
const servo=()=>part('servo','servo',430,90),servoW=()=>[wire('uno:9','servo:PWM'),wire('uno:5V','servo:V+','#ce7062'),wire('uno:GND.2','servo:GND','#607577')];
const lcd=()=>part('lcd1602','lcd',350,70),lcdW=()=>[['12','RS'],['11','E'],['5','D4'],['4','D5'],['3','D6'],['2','D7'],['5V','VDD'],['GND.2','VSS'],['GND.2','RW']].map(([a,b])=>wire('uno:'+a,'lcd:'+b));
const dht=()=>part('dht22','dht',420,300,{temperature:'22',humidity:'50'}),dhtW=()=>[wire('uno:7','dht:SDA'),wire('uno:5V','dht:VCC','#ce7062'),wire('uno:GND.2','dht:GND','#607577')];
function lesson(id,module,title,minutes,desc,concept,paragraphs,question,options,answer,task,hint,code,solution,parts=[],connections=[],required=connections,rule='') {return {id,module,title,minutes,desc,concept,paragraphs,question,options,answer,task,hint,code,solution,parts,connections,required,rule};}
export const lessons=[
lesson('first-light',0,'Первый свет',8,'Зажгите встроенный светодиод и познакомьтесь с Arduino.','Плата выполняет ваши команды',[
'Микроконтроллер — небольшой компьютер, который читает сигналы и управляет устройствами. Arduino Uno — плата с микроконтроллером и удобными контактами для подключения.',
'В скетче две главные функции. setup() выполняется один раз при запуске. loop() повторяется, пока работает программа.',
'Светодиод L уже подключён к выводу 13 на плате. pinMode(13, OUTPUT) делает вывод выходом, а digitalWrite(13, HIGH) подаёт высокий логический уровень. LOW выключает светодиод. Здесь не нужны внешние провода.'
],'Какая функция выполняется один раз после запуска?',['loop()','setup()','digitalWrite()'],1,
'В setup() замените LOW на HIGH. Запустите симуляцию и убедитесь, что светодиод L загорелся.','OUTPUT задаёт направление сигнала, HIGH — его уровень. Нужна строка digitalWrite(13, HIGH);.',
`void setup() {\n  pinMode(13, OUTPUT);\n  // TODO: включите светодиод\n  digitalWrite(13, LOW);\n}\n\nvoid loop() {\n}\n`,
`void setup() {\n  pinMode(13, OUTPUT);\n  digitalWrite(13, HIGH);\n}\nvoid loop() {}\n`,[],[],[],'light'),
lesson('blink',0,'Свет в ритме',10,'Превратите постоянный свет в мигающий сигнал.','Время тоже часть программы',[
'delay(500) приостанавливает выполнение на 500 миллисекунд, то есть на половину секунды. 1000 миллисекунд — одна секунда.',
'Чтобы получить мигание, включите светодиод, подождите, выключите его и снова подождите. Поместите эти команды в loop(), чтобы они повторялись.',
'Одинаковые паузы дают равномерное мигание. Если убрать паузу после LOW, выключенное состояние станет слишком коротким для наблюдения.'
],'Сколько миллисекунд в половине секунды?',['50','500','5000'],1,
'Дополните loop(): после первой паузы выключите LED и добавьте вторую паузу 500 мс. Дождитесь двух полных циклов.','Последовательность: HIGH → delay(500) → LOW → delay(500).',
`void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  // TODO: выключите LED и подождите\n}\n`,
`void setup() { pinMode(13, OUTPUT); }\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n`,[],[],[],'blink'),
lesson('external-led',0,'Соберите свою цепь',15,'Подключите внешний светодиод через резистор.','Сигналу нужен замкнутый путь',[
'У светодиода два вывода: анод A и катод C. Анод подключают к сигналу через резистор, катод — к GND, общему проводу схемы.',
'На настоящей плате резистор ограничивает ток и защищает светодиод. Здесь используем 220 Ом. Симулятор проверяет соединения, но не рассчитывает физический ток.',
'Нажмите на первый вывод, затем на второй — появится провод. Соедините 13 → r:1, r:2 → led:A и led:C → GND. Названия выводов видны при наведении.'
],'Зачем нужен резистор последовательно со светодиодом?',['Чтобы ограничить ток','Чтобы хранить программу','Чтобы измерять время'],0,
'Три компонента уже на столе. Добавьте три провода по таблице и запустите программу. Светодиод должен мигать.','Для удаления лишнего провода дважды щёлкните по нему. Контакты A и C нельзя менять местами.',
`void setup() { pinMode(13, OUTPUT); }\nvoid loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n`,null,[led(),res()],[],ledW(),'external'),
lesson('button',1,'Кнопка принимает решение',15,'Управляйте светом одним нажатием.','Входы связывают код с миром',[
'digitalRead(2) читает уровень на входе 2. Режим INPUT_PULLUP подключает внутреннюю подтяжку: отпущенная кнопка даёт HIGH.',
'При нажатии кнопка соединяет вход с GND. Поэтому нажатие в этой схеме соответствует LOW. Это нормально: логика зависит от подключения.',
'Во время симуляции удерживайте зелёную кнопку мышью. Встроенный светодиод должен гореть только при нажатии. Между чтениями достаточно небольшой паузы.'
],'Какой уровень на входе при нажатии кнопки с INPUT_PULLUP, соединённой с GND?',['HIGH','LOW','Всегда 512'],1,
'Соедините кнопку с выводом 2 и GND. Замените HIGH на LOW в сравнении. Нажмите и отпустите кнопку во время симуляции.','Правильное условие: digitalRead(2) == LOW. Проверьте оба состояния кнопки.',
`void setup() {\n  pinMode(2, INPUT_PULLUP);\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  // TODO: свет должен гореть при нажатии\n  digitalWrite(13, digitalRead(2) == HIGH);\n  delay(20);\n}\n`,
`void setup() { pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }\nvoid loop() {\n  digitalWrite(13, digitalRead(2) == LOW);\n  delay(20);\n}\n`,[button()],[],buttonW(),'button'),
lesson('analog',1,'Мир между нулём и единицей',15,'Измерьте положение ручки потенциометра.','Аналоговый сигнал — это диапазон',[
'Цифровой вход различает два состояния. Аналоговый вход Arduino Uno возвращает целое число от 0 до 1023, соответствующее напряжению на входе.',
'Потенциометр — регулируемый делитель напряжения. VCC подключён к 5V, GND — к общему проводу, SIG — к A0.',
'Serial.println(value) отправляет значение в монитор порта. Запустите программу, дважды щёлкните по потенциометру и изменяйте его значение ползунком.'
],'Какой диапазон возвращает analogRead() на Arduino Uno?',['0–1','0–255','0–1023'],2,
'Вместо константы 0 прочитайте A0. Запустите симуляцию и установите не менее трёх разных значений потенциометра.','Используйте int value = analogRead(A0);. После изменения ручки подождите следующий вывод в Serial.',
`void setup() { Serial.begin(9600); }\nvoid loop() {\n  int value = 0; // TODO: прочитайте A0\n  Serial.println(value);\n  delay(200);\n}\n`,
`void setup() { Serial.begin(9600); }\nvoid loop() {\n  int value = analogRead(A0);\n  Serial.println(value);\n  delay(200);\n}\n`,[pot()],potW(),potW(),'analog'),
lesson('dimmer',1,'Диммер своими руками',20,'Сделайте яркость светодиода управляемой.','Преобразуйте измерение в действие',[
'analogWrite() задаёт скважность PWM: быстрые включения и выключения управляют средней яркостью светодиода. Это не настоящий аналоговый выход.',
'Вход analogRead() использует шкалу 0–1023, а analogWrite() — 0–255. Функция map(value, 0, 1023, 0, 255) переводит число из одной шкалы в другую.',
'На Arduino Uno вывод 9 поддерживает PWM. Поворачивайте потенциометр и наблюдайте за яркостью внешнего светодиода.'
],'Почему перед analogWrite() мы используем map()?',['Чтобы перевести 0–1023 в 0–255','Чтобы запустить Serial','Чтобы отключить резистор'],0,
'Вычислите brightness через map() вместо нуля. Проверьте низкую, среднюю и высокую яркость.','analogWrite(9, brightness); уже есть. Изменить нужно только вычисление brightness.',
`void setup() { pinMode(9, OUTPUT); }\nvoid loop() {\n  int value = analogRead(A0);\n  int brightness = 0; // TODO: преобразуйте диапазон\n  analogWrite(9, brightness);\n  delay(50);\n}\n`,
`void setup() { pinMode(9, OUTPUT); }\nvoid loop() {\n  int value = analogRead(A0);\n  int brightness = map(value, 0, 1023, 0, 255);\n  analogWrite(9, brightness);\n  delay(50);\n}\n`,[pot(),led(),res()],[...potW(),...ledW(9)],undefined,'pwm'),
lesson('servo',2,'Поверните механизм',20,'Управляйте углом сервопривода ручкой.','Сервопривод удерживает заданный угол',[
'Сервопривод получает управляющий сигнал и устанавливает вал в заданное положение. В этом занятии используем диапазон от 0 до 180 градусов.',
'Библиотека Servo даёт два основных действия: attach(9) выбирает вывод, write(angle) задаёт угол. Питание V+ и GND подключаются отдельно.',
'Снова используем map(), но теперь переводим 0–1023 в 0–180. Учебная модель воспроизводит API Servo; электрическая нагрузка двигателя здесь не рассчитывается.'
],'Что задаёт servo.write(90)?',['Скорость 90 об/мин','Угол 90 градусов','Задержку 90 мс'],1,
'Замените постоянный угол на значение, вычисленное из A0. Проверьте положения около 0°, 90° и 180°.','int angle = map(analogRead(A0), 0, 1023, 0, 180);',
`#include <Servo.h>\nServo motor;\nvoid setup() { motor.attach(9); }\nvoid loop() {\n  int angle = 90; // TODO: прочитайте потенциометр\n  motor.write(angle);\n  delay(50);\n}\n`,
`#include <Servo.h>\nServo motor;\nvoid setup() { motor.attach(9); }\nvoid loop() {\n  int angle = map(analogRead(A0), 0, 1023, 0, 180);\n  motor.write(angle);\n  delay(50);\n}\n`,[pot(),servo()],[...potW(),...servoW()],undefined,'servo'),
lesson('display',2,'Устройство говорит с вами',20,'Выведите сообщение на двухстрочный дисплей.','Экран делает состояние понятным',[
'LCD 1602 содержит две строки по 16 символов. LiquidCrystal lcd(12, 11, 5, 4, 3, 2) связывает библиотеку с шестью сигнальными выводами дисплея.',
'После lcd.begin(16, 2) можно выводить текст через lcd.print(). Координаты lcd.setCursor(column, row) начинаются с нуля: вторая строка — row = 1.',
'Для этого дисплея используйте латиницу. В первой строке выведите MICROLAB, во второй — READY. Не забудьте кавычки вокруг текста.'
],'Как перейти в начало второй строки LCD?',['setCursor(1, 0)','setCursor(0, 1)','setCursor(16, 2)'],1,
'Замените оба сообщения: первая строка MICROLAB, вторая READY. Запустите и проверьте дисплей.','lcd.setCursor(0, 1); переключает вывод на вторую строку.',
`#include <LiquidCrystal.h>\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\nvoid setup() {\n  lcd.begin(16, 2);\n  lcd.print("HELLO"); // TODO\n  lcd.setCursor(0, 1);\n  lcd.print("..."); // TODO\n}\nvoid loop() {}\n`,
`#include <LiquidCrystal.h>\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\nvoid setup() {\n  lcd.begin(16, 2);\n  lcd.print("MICROLAB");\n  lcd.setCursor(0, 1);\n  lcd.print("READY");\n}\nvoid loop() {}\n`,[lcd()],lcdW(),undefined,'lcd'),
lesson('climate',2,'Температура под контролем',20,'Включайте предупреждение при перегреве.','Порог превращает измерение в решение',[
'DHT22 измеряет температуру и влажность. В учебной модели значения меняются в свойствах датчика: дважды щёлкните по нему.',
'readTemperature() возвращает температуру в градусах Цельсия. Условие temperature > 28 должно включать встроенный LED при превышении порога.',
'Проверяйте программу с обеих сторон порога: сначала 22 °C, затем 32 °C. Один удачный запуск ещё не доказывает, что условие работает правильно.'
],'Что должно произойти при 32 °C, если порог — 28 °C?',['LED должен включиться','LED должен выключиться','Температура станет нулём'],0,
'Включите LED при temperature > 28. Запустите программу и измените температуру с 22 до 32 °C в свойствах DHT22.','digitalWrite(13, temperature > 28); возвращает HIGH или LOW из сравнения.',
`#include <DHT.h>\nDHT sensor(7, DHT22);\nvoid setup() {\n  sensor.begin();\n  Serial.begin(9600);\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  float temperature = sensor.readTemperature();\n  Serial.println(temperature);\n  digitalWrite(13, LOW); // TODO: добавьте условие\n  delay(300);\n}\n`,
`#include <DHT.h>\nDHT sensor(7, DHT22);\nvoid setup() { sensor.begin(); Serial.begin(9600); pinMode(13, OUTPUT); }\nvoid loop() {\n  float temperature = sensor.readTemperature();\n  Serial.println(temperature);\n  digitalWrite(13, temperature > 28);\n  delay(300);\n}\n`,[dht()],dhtW(),undefined,'climate'),
lesson('traffic',3,'Городской светофор',25,'Соберите последовательность из трёх сигналов.','Проект 01 · автомат состояний',[
'У светофора есть состояния: красный, зелёный и жёлтый. В каждом состоянии включён только один нужный сигнал.',
'Красный подключён к 10, жёлтый — к 9, зелёный — к 8. Перед включением следующего сигнала выключайте предыдущий.',
'Задайте красному и зелёному по 1000 мс, жёлтому — 500 мс. После жёлтого цикл возвращается к красному. Одновременные красный и зелёный недопустимы.'
],'Что нужно сделать перед переключением с зелёного на жёлтый?',['Выключить зелёный','Включить красный вместе с зелёным','Удалить delay()'],0,
'Дополните цикл: красный → зелёный → жёлтый. Каждый сигнал должен загораться отдельно. Наблюдайте полный цикл.','После каждой паузы выключайте соответствующий вывод. Используйте 10, 8, 9 именно в таком порядке.',
`void setup() {\n  pinMode(10, OUTPUT);\n  pinMode(9, OUTPUT);\n  pinMode(8, OUTPUT);\n}\nvoid loop() {\n  digitalWrite(10, HIGH);\n  delay(1000);\n  digitalWrite(10, LOW);\n  // TODO: зелёный, затем жёлтый\n}\n`,
`void setup() { pinMode(10, OUTPUT); pinMode(9, OUTPUT); pinMode(8, OUTPUT); }\nvoid loop() {\n  digitalWrite(10, HIGH); delay(1000); digitalWrite(10, LOW);\n  digitalWrite(8, HIGH); delay(1000); digitalWrite(8, LOW);\n  digitalWrite(9, HIGH); delay(500); digitalWrite(9, LOW);\n}\n`,[part('led','red',420,90,{color:'red'}),part('led','yellow',490,90,{color:'yellow'}),part('led','green',560,90,{color:'green'}),res('r1'),part('resistor','r2',490,190,{value:'220'}),part('resistor','r3',560,230,{value:'220'})],[...ledW(10,'red','r1'),...ledW(9,'yellow','r2'),...ledW(8,'green','r3')],undefined,'traffic'),
lesson('barrier',3,'Умный шлагбаум',25,'Объедините кнопку, сервопривод и индикацию.','Проект 02 · управление механизмом',[
'Система состоит из входа, логики и выхода: кнопка сообщает о нажатии, программа принимает решение, сервопривод открывает шлагбаум.',
'При нажатой кнопке задайте 90° и включите встроенный LED. При отпущенной верните 0° и выключите LED.',
'Читаем INPUT_PULLUP, поэтому условие открытия — digitalRead(2) == LOW. Проверяем открытие и закрытие, а не только одно положение.'
],'Какой путь сигнала соответствует работе шлагбаума?',['Кнопка → программа → сервопривод','Сервопривод → резистор → USB','LCD → память → кнопка'],0,
'В ветке if задайте угол 90° и включите LED. В else — угол 0° и LOW. Нажмите и отпустите кнопку.','У motor.write() угол в градусах. Используйте digitalWrite(13, HIGH) только в ветке открытия.',
`#include <Servo.h>\nServo motor;\nvoid setup() {\n  motor.attach(9);\n  pinMode(2, INPUT_PULLUP);\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  if (digitalRead(2) == LOW) {\n    // TODO: открыть шлагбаум\n  } else {\n    // TODO: закрыть шлагбаум\n  }\n  delay(50);\n}\n`,
`#include <Servo.h>\nServo motor;\nvoid setup() { motor.attach(9); pinMode(2, INPUT_PULLUP); pinMode(13, OUTPUT); }\nvoid loop() {\n  if (digitalRead(2) == LOW) { motor.write(90); digitalWrite(13, HIGH); }\n  else { motor.write(0); digitalWrite(13, LOW); }\n  delay(50);\n}\n`,[button(),servo()],[...buttonW(),...servoW()],undefined,'barrier'),
lesson('weather',3,'Ваша мини-метеостанция',30,'Соберите итоговый проект: измерения, экран и предупреждение.','Проект 03 · от датчика до интерфейса',[
'В итоговом проекте DHT22 измеряет температуру и влажность, LCD показывает оба значения, а встроенный LED предупреждает о температуре выше 28 °C.',
'Сначала получите temperature и humidity. Выведите Temp: и число на первой строке, Hum: и число — на второй. lcd.clear() перед обновлением удалит остатки старых символов.',
'Проверьте проект при 22 °C / 50% и 32 °C / 70%. Экран должен показывать изменения, а LED — реагировать на порог. Теперь вы управляете целой системой.'
],'Зачем очищать LCD перед выводом более короткого значения?',['Чтобы удалить остатки старых символов','Чтобы перезапустить Arduino','Чтобы измерить влажность'],0,
'Замените обе константы измерениями датчика. Добавьте предупреждение при температуре выше 28 °C. Проверьте два набора значений.','sensor.readTemperature() и sensor.readHumidity() получают измерения. Изменяйте значения в свойствах DHT22 во время запуска.',
`#include <DHT.h>\n#include <LiquidCrystal.h>\nDHT sensor(7, DHT22);\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\nvoid setup() {\n  sensor.begin();\n  lcd.begin(16, 2);\n  pinMode(13, OUTPUT);\n}\nvoid loop() {\n  float temperature = 0; // TODO\n  float humidity = 0; // TODO\n  lcd.clear();\n  lcd.print("Temp: "); lcd.print(temperature);\n  lcd.setCursor(0, 1);\n  lcd.print("Hum: "); lcd.print(humidity);\n  digitalWrite(13, LOW); // TODO\n  delay(500);\n}\n`,
`#include <DHT.h>\n#include <LiquidCrystal.h>\nDHT sensor(7, DHT22);\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\nvoid setup() { sensor.begin(); lcd.begin(16, 2); pinMode(13, OUTPUT); }\nvoid loop() {\n  float temperature = sensor.readTemperature();\n  float humidity = sensor.readHumidity();\n  lcd.clear();\n  lcd.print("Temp: "); lcd.print(temperature);\n  lcd.setCursor(0, 1);\n  lcd.print("Hum: "); lcd.print(humidity);\n  digitalWrite(13, temperature > 28);\n  delay(500);\n}\n`,[lcd(),dht()],[...lcdW(),...dhtW()],undefined,'weather')
];
export function starter(l){return {name:l.title,code:l.code,libraries:[],lessonId:l.id,diagram:{version:1,author:'MicroLab Academy',parts:[part('arduino-uno','uno',60,210),...structuredClone(l.parts)],connections:structuredClone(l.connections)}};}
export function checkCircuit(l,p){return inspectCircuit(starter(l).diagram.parts,l.required,p.diagram);}
export function checkRuntime(l,p,t,running,advancedCheck){
 const circuit=checkCircuit(l,p);if(!circuit.ok)return {ok:false,message:'Сначала соберите схему: '+circuit.missing.slice(0,2).join(', ')};
 if(!running||!t.started)return {ok:false,message:'Запустите симуляцию кнопкой ▶, выполните задание и нажмите «Проверить».'};
 if(t.signature!==JSON.stringify({code:p.code,diagram:{...p.diagram,parts:p.diagram.parts.map(x=>({...x,attrs:{...x.attrs,value:undefined,temperature:undefined,humidity:undefined,distance:undefined}}))}}))return {ok:false,message:'Схема или код изменились. Перезапустите симуляцию, чтобы проверить новую версию.'};
 if(t.error)return {ok:false,message:'Исправьте ошибку программы: '+t.error};
 const vals=n=>t.pins[n]||[],has=(n,v)=>vals(n).some(x=>Math.abs(x-v)<.03),flips=n=>vals(n).filter((v,i,a)=>i&&v!==a[i-1]).length,events=type=>t.events.filter(x=>x.type===type),paired=(sample,pin,want)=>t.samples.some(s=>sample(s)&&Math.abs((s.outputs[pin]??-10)-want)<.03);
 let ok=false,message='';
 if(l.rule==='year')return verifyExperiment(l,t);
 if(l.rule.startsWith('hs-')){const ok=!!advancedCheck?.(l.rule,t);return {ok,message:ok?'Испытания пройдены.':l.task};}
 switch(l.rule){
 case 'light':ok=t.modes[13]===1&&has(13,1);message='Светодиод ещё не включён. Установите OUTPUT и запишите HIGH на вывод 13.';break;
 case 'blink':case 'external':return verifyBlink(t.edges);
 case 'button':ok=t.modes[2]===2&&paired(s=>s.buttons.button===true,13,1)&&paired(s=>s.buttons.button===false,13,0);message='Удержите кнопку, затем отпустите. LED должен гореть при нажатии и гаснуть после отпускания.';break;
 case 'analog':{const nums=t.serial.trim().split(/\s+/).map(Number).filter(Number.isFinite);const matches=(t.analog[14]||[]).filter(v=>nums.includes(v));ok=new Set(matches).size>=3;message='Выведите analogRead(A0) в Serial и проверьте три разных положения ручки.';break;}
 case 'pwm':ok=[0,512,1023].every(raw=>t.samples.some(s=>Math.abs(s.adc-raw)<25&&Math.abs((s.outputs[9]??-1)-s.adc/1023)<.04));message='Проверьте яркость около 0%, 50% и 100%. Убедитесь, что вывод 9 получает значение через map().';break;
 case 'servo':{const a=events('servo').filter(e=>e.pin===9).map(e=>e.value);ok=[0,512,1023].every(raw=>t.samples.some(s=>Math.abs(s.adc-raw)<25&&Math.abs(s.servo-s.adc*180/1023)<5));message='Установите ручку в начало, середину и конец. Углы должны быть около 0°, 90° и 180°.';break;}
 case 'lcd':ok=events('lcd').some(e=>{const rows=e.text.split('\n');return rows[0].trim()==='MICROLAB'&&rows[1]?.trim()==='READY'});message='На первой строке должен быть MICROLAB, на второй — READY. Проверьте setCursor(0, 1).';break;
 case 'climate':ok=paired(s=>s.temperatures.dht<=28,13,0)&&paired(s=>s.temperatures.dht>28,13,1);message='Проверьте 22 °C и 32 °C: LED должен реагировать на порог 28 °C.';break;
 case 'traffic':{const seq=t.frames.map(f=>f[10]===1?'r':f[8]===1?'g':f[9]===1?'y':'').filter((x,i,a)=>x&&x!==a[i-1]).join('');ok=seq.includes('rgy')&&!t.frames.some(f=>f[10]===1&&f[8]===1);message='Дождитесь последовательности красный → зелёный → жёлтый. Красный и зелёный не должны гореть вместе.';break;}
 case 'barrier':ok=t.samples.some(s=>s.buttons.button&&s.servo===90&&s.outputs[13]===1)&&t.samples.some(s=>!s.buttons.button&&s.servo===0&&s.outputs[13]===0);message='Удержите и отпустите кнопку. Проверяются угол 90°/0° и синхронное включение/выключение LED.';break;
 case 'weather':{const seen=t.samples.filter(s=>s.lcd.includes('Temp: '+s.temperatures.dht)&&s.lcd.includes('Hum: '+s.humidities.dht));ok=seen.some(s=>s.temperatures.dht<=28&&s.outputs[13]===0)&&seen.some(s=>s.temperatures.dht>28&&s.outputs[13]===1)&&new Set(seen.map(s=>s.humidities.dht)).size>=2;message='Проверьте 22 °C / 50% и 32 °C / 70%. На LCD должны меняться оба измерения, а LED — реагировать на температуру.';break;}
 }
 return {ok,message:ok?'Результат подтверждён симуляцией. Отличная работа!':message};
}
export const STEP_POINTS={theory:10,circuit:20,run:70};
export function stats(progress,route=lessons){let points=0,steps=0;const completed=route.filter(l=>['theory','circuit','run'].every(s=>progress[l.id]?.[s]));for(const l of route)for(const [s,xp]of Object.entries(STEP_POINTS))if(progress[l.id]?.[s]){points+=xp;steps++}return {points,steps,completed:completed.length,percent:Math.round(steps/(route.length*3)*100),level:completed.length===route.length?'Создатель':completed.length>=9?'Конструктор':completed.length>=6?'Практик':completed.length>=3?'Исследователь':'Новичок'};}
export function unlocked(index,progress,route=lessons){if(index<0||index>=route.length)return false;
 const previous=progress[route[index].id];
 return index===0||!!(previous?.theory||previous?.circuit||previous?.run||previous?.homework)||['theory','circuit','run'].every(s=>progress[route[index-1].id]?.[s]);}
