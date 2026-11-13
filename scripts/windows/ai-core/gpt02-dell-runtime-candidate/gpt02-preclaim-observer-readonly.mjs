import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'AI-Core');
const verdict={scope:'GPT02_DEV_PRECLAIM_OBSERVATION',scheduled:{allowed:false,reason:'UNAVAILABLE'},oneShot:{allowed:false,reason:'UNAVAILABLE'},bothClear:false,authorizesWorkerResume:false,changesMade:false};
try {
 if(!root)throw Error('ROOT_UNAVAILABLE');
 // The enabled Task Scheduler action runs dell-wake-event-listener.mjs, which imports
 // dell-wake-executor-once.mjs. Never require an unused legacy executor to pass.
 const scheduled=await import(pathToFileURL(path.join(root,'dell-wake-executor-once.mjs')).href);
 const oneShot=await import(pathToFileURL(path.join(root,'dell-wake-executor-once.mjs')).href);
 for(const [key,module] of [['scheduled',scheduled],['oneShot',oneShot]]){
  const value=module.nativeCapturePreclaimGate(root);
  verdict[key]={allowed:value?.allowed===true,reason:String(value?.reason??'UNKNOWN')};
 }
 verdict.bothClear=verdict.scheduled.allowed&&verdict.oneShot.allowed;
} catch(e) {verdict.errorCode='PRECLAIM_CHECK_FAILED';}
console.log(JSON.stringify(verdict));
