// A null pin list selects the bundled Wokwi artwork. Explicit pin lists are
// editor symbols: their shape is schematic, not a physical footprint.
const entries=[];
function add(group,type,name,pins=null,description='Размещение и соединения на схеме',support='visual'){
 entries.push({type,name,category:group,pins:pins===null?null:pins.split(' ').filter(Boolean),description,support});
}
const board='Платы', sensor='Датчики', module='Модули',basic='Базовые',logic='Логика',display='Индикация';
function native(group,rows){
 for(const [type,name,description,support] of rows)add(group,'wokwi-'+type,name,null,description,support);
}
native(board,[['franzininho','Franzininho AVR'],['nano-rp2040-connect','Arduino Nano RP2040 Connect']]);
native(sensor,[['big-sound-sensor','Большой датчик звука'],['small-sound-sensor','Малый датчик звука'],['gas-sensor','MQ-2 · датчик газа'],['flame-sensor','Датчик пламени'],['heart-beat-sensor','Датчик пульса'],['tilt-switch','Датчик наклона'],['hx711','HX711 · тензодатчик'],['ds1307','DS1307 · часы реального времени']]);
native(module,[['biaxial-stepper','Двухосевой шаговый двигатель'],['ir-receiver','ИК-приёмник'],['ir-remote','ИК-пульт'],['ks2e-m-dc5','Реле DPDT'],['microsd-card','Карта microSD · SPI']]);
native(basic,[['analog-joystick','Аналоговый джойстик','Два аналоговых канала и контакт нажатия','api'],['dip-switch-8','DIP-переключатель ×8','Восемь независимых контактов','full'],['ky-040','KY-040 · энкодер'],['pushbutton-6mm','Кнопка 6 мм','Замыкание контактов при нажатии','full'],['rotary-dialer','Дисковый номеронабиратель'],['slide-potentiometer','Ползунковый потенциометр','Аналоговый сигнал 0–1023','full']]);
native(display,[['ili9341','TFT ILI9341'],['lcd2004','LCD 2004'],['led-bar-graph','Шкала из 10 светодиодов','Десять независимых пар анод/катод','full'],['led-ring','Кольцо NeoPixel'],['neopixel','Светодиод NeoPixel'],['neopixel-matrix','Матрица NeoPixel']]);
const indexed=(prefix,count,start=0)=>Array.from({length:count},(_,i)=>prefix+(i+start)).join(' ');
const pico=indexed('GP',23)+' GP26 GP27 GP28 '+indexed('GND.',8,1)+' VBUS VSYS 3V3 3V3_EN ADC_VREF RUN';
for(const [type,name,pins] of [
 ['board-pi-pico-w','Raspberry Pi Pico W',pico],['board-pi-pico-2','Raspberry Pi Pico 2',pico],['board-pi-pico-2w','Raspberry Pi Pico 2 W',pico],
 ['wokwi-attiny85','ATtiny85','PB5 PB3 PB4 GND PB0 PB1 PB2 VCC'],
 ['board-st-nucleo-c031c6','STM32 Nucleo C031C6',indexed('D',16)+' '+indexed('A',6)+' GND 3V3 5V'],
 ['board-st-nucleo-l031k6','STM32 Nucleo L031K6',indexed('D',14)+' '+indexed('A',8)+' GND 3V3 5V'],
 ['board-stm32-bluepill','STM32 Blue Pill',indexed('A',16)+' '+indexed('B',16)+' C13 C14 C15 GND 3V3 5V'],
 ['board-franzininho-wifi','Franzininho WiFi','0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 GND 3V3'],
 ['board-esp-mosaico','ESP Mosaico','0.1 0.2 1.1 1.2 TX0 RX0 USJ_DN USJ_DP 3V3.1 3V3.2 GND.1 GND.2'],
 ]) add(board,type,name,pins,'Условное обозначение · выводы для проектирования схемы');
for(const variant of ['s2','s3','c3','c5','c6','c61','h2','p4','s31']){
 // The generic symbol exposes only power until a specific board layout is defined.
 add(board,'microlab-esp32-'+variant,'ESP32-'+variant.toUpperCase(),'3V3 GND','Справочное обозначение семейства · только выводы питания');
}
for(const [group,type,name,pins] of [
 [sensor,'board-bmp180','BMP180 · барометр','VCC 3.3V GND SCL SDA'],[sensor,'board-mfrc522','MFRC522 · RFID','3.3V RST GND IRQ MISO MOSI SCK SDA'],[sensor,'wokwi-ds18b20','DS18B20 · термометр','VCC DQ GND'],
 [module,'wokwi-a4988','A4988 · драйвер двигателя','ENABLE MS1 MS2 MS3 RESET SLEEP STEP DIR VMOT GND.1 2B 2A 1A 1B VDD GND.2'],
 [display,'board-grove-oled-sh1107','Grove OLED SH1107','SCL SDA VCC GND'],[display,'board-ssd1306','OLED SSD1306 · I²C','GND VCC SCL SDA'],
 [display,'wokwi-led-matrix','Адресная матрица WS2812','DIN VDD VSS DOUT'],[display,'wokwi-led-strip','Лента WS2812','VDD DIN VSS VDD.2 DOUT VSS.2'],
 [display,'wokwi-nokia-5110-screen','Nokia 5110 · LCD','RST CE DC DIN CLK VCC BL GND'],[display,'wokwi-max7219-matrix','Матрица MAX7219','VCC GND DIN CS CLK DOUT'],[display,'wokwi-tm1637-7segment','TM1637 · четыре цифры','CLK DIO VCC GND'],[display,'wokwi-tv','Экран PAL','IN SYNC GND'],
 [display,'microlab-epaper-290','Электронная бумага 2,9″','VCC GND DIN CLK CS DC RST BUSY'],[display,'microlab-ili9341-touch','ILI9341 с сенсорной панелью','VCC GND CS RST DC MOSI SCK MISO SDA SCL'],[display,'microlab-neopixel-meter','Измеритель NeoPixel','DIN GND'],
 [logic,'wokwi-74hc165','74HC165 · регистр ввода',indexed('D',8)+' PL CP CE Q7 Q7_N DS GND VCC'],[logic,'wokwi-74hc595','74HC595 · регистр вывода','DS SHCP STCP OE '+indexed('Q',8)+' Q7S MR GND VCC'],[logic,'wokwi-nlsf595','NLSF595 · драйвер LED','SI SCK RCK OE QA QB QC QD QE QF QG QH SQH SCLR GND VCC'],
 [module,'wokwi-clock-generator','Генератор тактов','CLK'],[module,'wokwi-logic-analyzer','Логический анализатор',indexed('D',8)+' GND'],[module,'wokwi-relay-module','Релейный модуль','VCC GND IN NC COM NO'],[module,'wokwi-wifi-ap','Точка доступа Wi-Fi',''],[basic,'wokwi-text','Текст на схеме',''],
 [logic,'microlab-d-flipflop','D-триггер','D CLK Q QN'],[logic,'microlab-dsr-flipflop','DSR-триггер','D CLK S R Q QN']
 ])add(group,type,name,pins);
export const gates={
 not:{pins:'A Y',evaluate:([a])=>!a},and:{pins:'A B Y',evaluate:([a,b])=>a&&b},
 or:{pins:'A B Y',evaluate:([a,b])=>a||b},xor:{pins:'A B Y',evaluate:([a,b])=>a!==b},
 nand:{pins:'A B Y',evaluate:([a,b])=>!(a&&b)},mux:{pins:'A B S Y',evaluate:([a,b,s])=>s?b:a}
};
for(const [key,g] of Object.entries(gates))add(logic,'microlab-'+key,key.toUpperCase(),g.pins,'Комбинационная логика · цифровые входы и выход','api');
export const breadboards={'wokwi-breadboard':63,'wokwi-breadboard-half':30,'wokwi-breadboard-mini':17};
for(const [key,n] of Object.entries(breadboards))add(basic,key,'Макетная плата · '+n+' × 10','','Две группы по пять связанных контактов в каждом ряду','full');
export const extraParts=entries;
export function symbolElement(part,definition){
 const el=document.createElement('div');
 const count=breadboards[part.type];
 if(count){
  el.className='breadboard-symbol';el.style.width=(count*10+12)+'px';el.style.height=(count===17?130:162)+'px';el.pinInfo=[];
  for(let row=1;row<=count;row++)for(const [i,letter] of [...'abcdefghij'].entries()){
   const x=10+(row-1)*10,y=(count===17?18:33)+i*9+(i>=5?14:0);
   const hole=document.createElement('i');hole.style.left=x+'px';hole.style.top=y+'px';el.append(hole);
   el.pinInfo.push({name:row+ (i<5?'t':'b')+'.'+letter,x,y});
  }
  if(count!==17)for(const [name,y] of [['tp',7],['tn',18],['bp',144],['bn',155]])for(let i=1;i<=Math.floor(count/6)*5;i++){
   const x=10+(i-1+Math.floor((i-1)/5))*10;
   const hole=document.createElement('i');hole.style.left=x+'px';hole.style.top=y+'px';el.append(hole);el.pinInfo.push({name:name+'.'+i,x,y});
  }
  return el;
 }
 el.className='part-symbol';const pins=definition.pins,half=Math.ceil(pins.length/2),width=146,height=Math.max(62,half*15+38);
 el.style.width=width+'px';el.style.height=height+'px';
 const title=document.createElement('b');title.textContent=part.type==='wokwi-text'?part.attrs?.text||'Текст':definition.name;el.append(title);
 el.pinInfo=pins.map((name,i)=>{const left=i<half,x=left?0:width,y=36+(i%half)*15;const tag=document.createElement('small');tag.style[left?'left':'right']='5px';tag.style.top=(y-6)+'px';tag.textContent=name;el.append(tag);return {name,x,y}});
 return el;
}
