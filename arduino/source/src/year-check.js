export function inputLabel(kind,input){
 if(kind==='pulse'||kind==='externalPulse')return 'с начала импульса';
 if(kind==='pair')return 'A='+input[0]+', B='+input[1];
 if(kind==='gate')return 'кнопка '+input[0]+', A0='+input[1];
 if(kind==='button'||kind==='servoButton')return input?'кнопка нажата':'кнопка отпущена';
 if(kind==='screen'||kind==='climate')return input[0]+' °C, '+input[1]+'%';
 return 'A0 = '+input;
}
function inputMatches(kind,input,s){
 if(kind==='pair')return Number(s.buttons.button)===input[0]&&Number(s.buttons.second)===input[1];
 if(kind==='gate')return Number(s.buttons.button)===input[0]&&s.adc===input[1];
 if(kind==='button'||kind==='servoButton')return Number(s.buttons.button)===input;
 if(kind==='screen'||kind==='climate')return s.temperatures.dht===input[0]&&s.humidities.dht===input[1];
 return input===s.adc;
}
function actual(kind,s){
 if(kind==='adc')return s.serialLine===''?NaN:Number(s.serialLine);
 if(kind==='pwm')return Math.round((s.outputs[9]??-1)*255);
 if(['servo','gate','servoButton'].includes(kind))return s.servo;
 if(kind==='screen'||kind==='lcd')return s.lcd.slice(0,16).trim();
 if(kind==='signal'){const mask=[10,9,8].map(n=>s.outputs[n]===1);return mask.filter(Boolean).length===1?mask.indexOf(true)+1:0;}
 return s.outputs[13];
}
export function verifyExperiment(lesson,t){
 const {kind,cases,wave}=lesson.experiment;
 if(wave){
  const edges=(t.edges||[]).filter(e=>e.pin===13);
  // Require one entire pattern plus its next rising edge. Allow browser scheduling jitter.
  for(let i=0;i+wave.length<edges.length;i++)if(edges[i].value===1&&wave.every((ms,j)=>Math.abs(edges[i+j+1].at-edges[i+j].at-ms)<=Math.max(55,ms*.22)))return {ok:true,message:'Ритм подтверждён.'};
  return {ok:false,message:'Дождитесь полного цикла и проверьте длительность каждой вспышки и паузы.'};
 }
 let after=0;
 for(const [input,expected] of cases){
  const index=t.samples.findIndex((s,i)=>i>=after&&inputMatches(kind,input,s)&&actual(kind,s)===expected);
  if(index<0)return {ok:false,message:'Следующее испытание: '+inputLabel(kind,input)+'. Ожидается '+expected+'. Удерживайте вход около секунды.'};
  after=index+1;
 }
 return {ok:true,message:'Серия испытаний пройдена.'};
}
