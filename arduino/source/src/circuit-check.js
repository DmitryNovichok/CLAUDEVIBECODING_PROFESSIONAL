// Conductive equivalence, not the order or segmentation of drawn wires.
export function wireNets(diagram) {
  const parents=new Map(), find=x=>{if(!parents.has(x))parents.set(x,x);let root=x;while(parents.get(root)!==root)root=parents.get(root);return root;};
  const join=(a,b)=>parents.set(find(a),find(b));
  for(const [a,b] of diagram.connections)join(a,b);
  for(const part of diagram.parts){
    const aliases=new Map();
    for(const ref of [...parents.keys()].filter(x=>x.startsWith(part.id+':'))){
      const pin=ref.slice(part.id.length+1);let group=pin;
      if (/^wokwi-(arduino-|pi-pico)/.test(part.type)&&/^GND(?:\.\d+)?$/.test(pin))group='GND';
      if (/^wokwi-pushbutton/.test(part.type))group=pin.split('.')[0];
      if (/^wokwi-breadboard/.test(part.type)) {
        const row=pin.match(/^(\d+[tb])\.[a-e]$/), rail=pin.match(/^([tbn][pn])\.\d+$/);
        if(row)group=row[1];if(rail)group=rail[1];
      }
      if(aliases.has(group))join(ref,aliases.get(group));else aliases.set(group,ref);
    }
  }
  // Canonical GND references need to exist even if only another GND is wired.
  for(const part of diagram.parts)if(/^wokwi-(arduino-|pi-pico)/.test(part.type)){
    for(let i=1;i<=8;i++)join(part.id+':GND',part.id+':GND.'+i);
  }
  return (a,b)=>find(a)===find(b);
}
export function inspectCircuit(expected, required, diagram) {
  const connected=wireNets(diagram),mapping={},used=new Set();let attempts=0,best=required.map(([a,b])=>a+' → '+b);
  const candidates=expected.map(p=>diagram.parts.filter(x=>x.type===p.type && (p.type!=='wokwi-led'||!p.attrs?.color||!x.attrs?.color||x.attrs.color===p.attrs.color)).sort((a,b)=>Number(b.id===p.id)-Number(a.id===p.id)));
  if(candidates.some(x=>!x.length))return {ok:false,missing:expected.filter((_,i)=>!candidates[i].length).map(x=>x.id)};
  const translate=ref=>{const i=ref.indexOf(':');return mapping[ref.slice(0,i)]+ref.slice(i);};
  function search(index){
    if(++attempts>20000)return false;
    if(index===expected.length){
      const missing=required.filter(([a,b])=>!connected(translate(a),translate(b))).map(([a,b])=>a+' → '+b);
      if(missing.length<=best.length)best=missing;
      return !missing.length;
    }
    for(const p of candidates[index])if(!used.has(p.id)){mapping[expected[index].id]=p.id;used.add(p.id);if(search(index+1))return true;used.delete(p.id);}
    return false;
  }
  return {ok:search(0),missing:best};
}

export function verifyBlink(edges, on=500, off=500) {
  const e=(edges||[]).filter(x=>x.pin===13);
  const pattern=[on,off,on,off], tolerance=ms=>Math.max(60,ms*.25);
  for(let i=0;i+4<e.length;i++)if(e[i].value===1&&pattern.every((ms,j)=>e[i+j].value===(j%2?0:1)&&Math.abs(e[i+j+1].at-e[i+j].at-ms)<=tolerance(ms)))return {ok:true,message:'Два полных цикла подтверждены.'};
  const recent=e.slice(-5), duration=recent.length>1?Math.round(recent[1].at-recent[0].at):null;
  return {ok:false,message:`Нужны два повторения: ${on} мс света и ${off} мс паузы.${duration===null?' Запустите программу и подождите.':' Последний измеренный интервал: '+duration+' мс. Проверьте delay() и расположение команд в loop().'}`};
}
