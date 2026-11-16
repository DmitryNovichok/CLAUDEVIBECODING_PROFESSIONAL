// Contract fixture, not a browser security emulator. It runs the trusted frame
// bootstrap and the real JS parser so message routing/lifecycle can be tested.
import vm from 'node:vm';
import {resolveObjectURL} from 'node:buffer';

export function sandboxHarness({autoLoad=true, workerFails=false}={}) {
  const frames=[], workers=[], messages=[], parent={}, timers=new Map();
  let timerId=0;
  class Port {
    closed=false; onmessage=null;
    start(){}
    postMessage(data){
      if(this.closed)return;
      const copy=structuredClone(data), other=this.other;
      queueMicrotask(()=>{if(!other.closed)other.onmessage?.({data:copy});});
    }
    close(){this.closed=true;}
  }
  class Channel {constructor(){this.port1=new Port();this.port2=new Port();this.port1.other=this.port2;this.port2.other=this.port1;}}
  class Worker {
    stopped=false; inputs=[];
    constructor(url){
      if(workerFails)throw Error('Worker unavailable');
      workers.push(this);
      const blob=resolveObjectURL(url);
      queueMicrotask(async()=>{
        this.source=await blob.text();
        try{new vm.Script(this.source);}
        catch(error){if(!this.stopped)this.onerror?.({message:error.name+': '+error.message,preventDefault(){}});}
      });
    }
    postMessage(data){if(!this.stopped)this.inputs.push(structuredClone(data));}
    terminate(){this.stopped=true;}
    emit(data){if(!this.stopped)this.onmessage?.({data});}
  }
  const document={body:{appendChild(frame){
    frames.push(frame);
    const listeners=new Map();
    frame.listeners=listeners;
    const context=vm.createContext({parent,Blob,URL,Worker,Date,
      addEventListener:(type,fn)=>listeners.set(type,fn),
      removeEventListener:(type)=>listeners.delete(type)});
    const script=frame.srcdoc.match(/<script>([\s\S]*)<\/script>/)[1];
    vm.runInContext(script,context);
    frame.contentWindow={postMessage(data,target,ports){messages.push({data,target});listeners.get('message')?.({source:parent,data,ports});}};
    if(autoLoad)queueMicrotask(()=>frame.onload?.());
  }},createElement(tag){
    if(tag!=='iframe')throw Error('Only an iframe may be created');
    return {attributes:{},setAttribute(k,v){this.attributes[k]=v;},remove(){this.removed=true;this.listeners?.get('unload')?.();}};
  }};
  return {frames,workers,messages,timers,environment:{document,MessageChannel:Channel,
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}}};
}

export function installSandboxHarness(options){
  const harness=sandboxHarness(options), old={};
  for(const [key,value]of Object.entries(harness.environment)){old[key]=globalThis[key];globalThis[key]=value;}
  return {...harness,restore(){for(const[key,value]of Object.entries(old))globalThis[key]=value;}};
}
