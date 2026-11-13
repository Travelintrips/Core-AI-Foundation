// Read-only observer: the scheduled DEV listener imports the existing one-shot executor.
// Neither a GET to ChatGPT nor a job claim is performed here.
import path from "node:path";
import {fileURLToPath} from "node:url";
import {nativeCapturePreclaimGate,operationalResumeGate} from "./dell-wake-executor-once.mjs";
const root=path.dirname(fileURLToPath(import.meta.url));
const worker="openclaw-dell-chatgpt-wake-dev";
const deny={scope:"GPT02_DEV_CURRENT_LISTENER_GATE_OBSERVATION",preclaimAllowed:false,
  resumeAllowed:false,cacheArchitectureVerified:false,reason:"GATE_UNVERIFIED",
  authorizesDispatch:false,changesMade:false};
try{
  const capture=nativeCapturePreclaimGate(root,worker);
  const resume=operationalResumeGate(root,worker);
  const cache= capture?.allowed===true&&capture.reason==="LOCAL_CACHE_READBACK_VERIFIED" &&
    resume?.allowed===true&&resume.reason==="DEV_LOCAL_CACHE_READBACK_ARCHITECTURE_CLEAR";
  console.log(JSON.stringify({scope:deny.scope,preclaimAllowed:capture?.allowed===true,
    resumeAllowed:resume?.allowed===true,cacheArchitectureVerified:cache,
    reason:cache?"CURRENT_CACHE_WORKER_GATES_MATCH":"CURRENT_WORKER_GATES_NOT_BOTH_CACHE_VERIFIED",
    authorizesDispatch:false,changesMade:false}));
}catch{
 console.log(JSON.stringify(deny));
 process.exitCode=1;
}
