import {wireNets} from './circuit-check.js';
export const powerPins={
  'wokwi-servo':['V+','GND'],'wokwi-lcd1602':['VDD','VSS'],
  'wokwi-dht22':['VCC','GND'],'wokwi-hc-sr04':['VCC','GND'],
  'wokwi-potentiometer':['VCC','GND'],'wokwi-slide-potentiometer':['VCC','GND'],
  'wokwi-analog-joystick':['VCC','GND'],'wokwi-pir-motion-sensor':['VCC','GND'],
  'wokwi-photoresistor-sensor':['VCC','GND'],'wokwi-ntc-temperature-sensor':['VCC','GND']
};
export function powered(part,board,connected){
  const pins=powerPins[part.type];if(!pins)return true;if(!board)return false;
  return ['5V','3V3','3.3V','VBUS','VSYS'].some(v=>connected(part.id+':'+pins[0],board.id+':'+v))&&connected(part.id+':'+pins[1],board.id+':GND');
}
export function powerCheck(diagram,board){
  const connected=wireNets(diagram);
  const short=!!board&&['5V','3V3','3.3V','VBUS','VSYS'].some(v=>connected(board.id+':'+v,board.id+':GND'));
  return {short,unpowered:diagram.parts.filter(p=>!powered(p,board,connected)).map(p=>p.id)};
}
export const echoDuration=distance=>Math.round(Math.max(2,Math.min(400,Number(distance)||100))*58);
