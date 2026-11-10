import {extraParts} from './parts-library.js';
import {signals} from './io-parts.js';
export const catalog=[
['wokwi-arduino-uno','Arduino Uno','Платы','ATmega328P · HEX + Arduino API','full'],['wokwi-arduino-nano','Arduino Nano','Платы','ATmega328P · HEX + Arduino API','full'],['wokwi-pi-pico','Raspberry Pi Pico','Платы','RP2040 · UF2, экспериментально','experimental'],['wokwi-esp32-devkit-v1','ESP32 DevKit','Платы','Только схема · эмулятор не подключён','visual'],['wokwi-arduino-mega','Arduino Mega','Платы','Только схема · эмулятор не подключён','visual'],
['wokwi-led','Светодиод','Базовые','GPIO · цифровой выход / PWM','full'],['wokwi-resistor','Резистор','Базовые','Связность цепи · без расчёта тока','full'],['wokwi-pushbutton','Кнопка','Базовые','GPIO · нажмите при симуляции','full'],['wokwi-potentiometer','Потенциометр','Базовые','Аналоговый вход 0–1023','full'],['wokwi-slide-switch','Переключатель','Базовые','GPIO · два положения','full'],['wokwi-servo','Сервопривод','Модули','Servo API · учебный режим','api'],['wokwi-buzzer','Зуммер','Модули','tone() · учебный режим','api'],['wokwi-lcd1602','LCD 1602','Модули','LiquidCrystal API · учебный режим','api'],['wokwi-dht22','DHT22','Датчики','DHT API · учебный режим','api'],['wokwi-hc-sr04','HC-SR04','Датчики','pulseIn · расстояние 2–400 см · учебный режим','api'],['wokwi-pir-motion-sensor','PIR датчик','Датчики','В этой версии — только схема','visual'],['wokwi-ssd1306','OLED SSD1306','Модули','В этой версии — только схема','visual'],['wokwi-rgb-led','RGB светодиод','Базовые','В этой версии — только схема','visual'],['wokwi-mpu6050','MPU6050','Датчики','В этой версии — только схема','visual'],['wokwi-ntc-temperature-sensor','NTC термистор','Датчики','В этой версии — только схема','visual'],['wokwi-photoresistor-sensor','Фоторезистор','Датчики','В этой версии — только схема','visual'],['wokwi-7segment','7-сегментный дисплей','Модули','В этой версии — только схема','visual'],['wokwi-membrane-keypad','Клавиатура 4×4','Модули','В этой версии — только схема','visual'],['wokwi-stepper-motor','Шаговый двигатель','Модули','В этой версии — только схема','visual']
].map(([type,name,category,description,support])=>({type,name,category,description,support})).concat(extraParts);
for(const item of catalog){
 if(item.type==="wokwi-clock-generator"){item.support="api";item.description="Цифровой тактовый сигнал 0,1–10 Гц · учебная частота";}
 if(item.type==="wokwi-7segment"){item.support="api";item.description="Управление сегментами по уровням GPIO";}
 if(signals[item.type]){item.support="api";item.description="Учебная модель · задайте выход датчика в свойствах";}
 if(item.type==="wokwi-rgb-led"){item.support="api";item.description="Три цифровых канала или PWM · общий катод или анод";}
}
export const blink=`// Первый эксперимент: мигание светодиода\n// Измените delay(), чтобы изменить частоту.\n\nvoid setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.begin(9600);\n  Serial.println("MicroLab готов к работе!");\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  Serial.println("LED: ON");\n  delay(1000);\n\n  digitalWrite(LED_BUILTIN, LOW);\n  Serial.println("LED: OFF");\n  delay(1000);\n}\n`;
export const examples=[{title:'Blink — первый запуск',desc:'Встроенный светодиод Arduino и Serial Monitor',icon:'✦',code:blink,parts:[],connections:[]},{title:'Светодиод и резистор',desc:'Собранная цепь: D13 → резистор → LED → GND',icon:'◉',code:blink,parts:[{type:'wokwi-led',id:'led1',top:160,left:510,attrs:{color:'red'}},{type:'wokwi-resistor',id:'r1',top:270,left:450,attrs:{value:'220'}}],connections:[['uno:13','r1:1','#56d4a1',[]],['r1:2','led1:A','#56d4a1',[]],['led1:C','uno:GND.1','#697a8d',[]]]},{title:'Кнопка и светодиод',desc:'INPUT_PULLUP: удерживайте кнопку для включения LED',icon:'⊙',code:`void setup() {\n  pinMode(2, INPUT_PULLUP);\n  pinMode(13, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(13, digitalRead(2) == LOW);\n  delay(10);\n}\n`,parts:[{type:'wokwi-pushbutton',id:'btn1',top:200,left:510,attrs:{color:'green'}}],connections:[['uno:2','btn1:1.l','#56d4a1',[]],['uno:GND.1','btn1:2.l','#697a8d',[]]]},{title:'Аналоговый сигнал',desc:'Поворачивайте потенциометр и наблюдайте значения',icon:'◴',code:`void setup() {\n  Serial.begin(9600);\n  pinMode(9, OUTPUT);\n}\n\nvoid loop() {\n  int value = analogRead(A0);\n  Serial.println(value);\n  analogWrite(9, map(value, 0, 1023, 0, 255));\n  delay(200);\n}\n`,parts:[{type:'wokwi-potentiometer',id:'pot1',top:180,left:510,attrs:{value:'512'}}],connections:[['uno:A0','pot1:SIG','#e9bd65',[]],['uno:5V','pot1:VCC','#e17874',[]],['uno:GND.1','pot1:GND','#697a8d',[]]]},{title:'LCD: Hello, world!',desc:'LiquidCrystal в учебном режиме · шесть сигнальных линий',icon:'▤',code:`#include <LiquidCrystal.h>\nLiquidCrystal lcd(12, 11, 5, 4, 3, 2);\n\nvoid setup() {\n  lcd.begin(16, 2);\n  lcd.print("Hello, MicroLab!");\n}\n\nvoid loop() {\n  lcd.setCursor(0, 1);\n  lcd.print(round(millis() / 1000));\n  delay(1000);\n}\n`,parts:[{type:'wokwi-lcd1602',id:'lcd1',top:100,left:430,attrs:{}}],connections:[['uno:12','lcd1:RS','#56d4a1',[]],['uno:11','lcd1:E','#56d4a1',[]],['uno:5','lcd1:D4','#56d4a1',[]],['uno:4','lcd1:D5','#56d4a1',[]],['uno:3','lcd1:D6','#56d4a1',[]],['uno:2','lcd1:D7','#56d4a1',[]],['uno:5V','lcd1:VDD','red',[]],['uno:GND.1','lcd1:VSS','black',[]],['uno:GND.1','lcd1:RW','black',[]]]}];

examples.push({
 title:'Логический инвертор на макетной плате',icon:'¬',
 desc:'Выход D8 проходит через NOT и дорожку макетной платы обратно на вход D2.',
 code:`void setup() {
  pinMode(8, OUTPUT);
  pinMode(2, INPUT);
  Serial.begin(9600);
}
void loop() {
  digitalWrite(8, LOW);
  delay(200);
  Serial.print("D8=0 D2="); Serial.println(digitalRead(2));
  digitalWrite(8, HIGH);
  delay(200);
  Serial.print("D8=1 D2="); Serial.println(digitalRead(2));
}`,
 parts:[{type:'microlab-not',id:'gate',left:390,top:105,attrs:{}},
        {type:'wokwi-breadboard-mini',id:'bb',left:350,top:250,attrs:{}}],
 connections:[['uno:8','gate:A','#44936e',[]],['gate:Y','bb:2t.a','#b87939',[]],['bb:2t.e','uno:2','#447cb0',[]]]
});

examples.push({title:'Дальномер HC-SR04',desc:'Задайте расстояние в свойствах датчика. Нужны питание, TRIG и ECHO.',icon:'↔',
 code:`void setup() { pinMode(2, OUTPUT); pinMode(3, INPUT); Serial.begin(9600); }
void loop() {
  digitalWrite(2, LOW); delayMicroseconds(2);
  digitalWrite(2, HIGH); delayMicroseconds(10);
  digitalWrite(2, LOW);
  long duration = pulseIn(3, HIGH, 30000);
  Serial.println(duration / 58.0);
  delay(300);
}`,parts:[{type:'wokwi-hc-sr04',id:'sonar',left:450,top:170,attrs:{distance:'100'}}],connections:[['uno:5V','sonar:VCC','red',[]],['uno:GND.1','sonar:GND','black',[]],['uno:2','sonar:TRIG','green',[]],['uno:3','sonar:ECHO','blue',[]]]});
