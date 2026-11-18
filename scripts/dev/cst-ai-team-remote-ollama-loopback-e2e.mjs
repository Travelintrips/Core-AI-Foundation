/** Optional DEV-only E2E: real local Ollama model + synthetic loopback API.
 * Run from repository root with Node >=22 and Ollama model qwen2.5:3b.
 * Never registers a real AI Core worker, exposes a public port, or writes to DB.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PORT = 18444;
const TEST_ONLY_ENROLLMENT = "SYNTHETIC-LOCAL-ONLY-CST-DEV-E2E-20261118";
const WORKER_TOKEN = randomBytes(32).toString("hex");
const JOB_ID = 421;
const MODEL = "qwen2.5:3b";
const EXPECTED = "CST_DEV_OUTBOUND_READY";
const start = Date.now();
let registered = 0;
let claimed = 0;
let completed = 0;
let heartbeats = 0;
let workerLog = "";
let finalized = false;
let report = null;
let doneResolve, doneReject;
const done = new Promise((resolveDone, rejectDone) => {
  doneResolve = resolveDone; doneReject = rejectDone;
});
const json = (res, status, value) => {
  const data = JSON.stringify(value);
  res.writeHead(status, {"content-type":"application/json","cache-control":"no-store"});
  res.end(data);
};
const authorizedWorker = req => req.headers["x-ollama-worker-token"] === WORKER_TOKEN;
async function collect(req) {
  let text="";
  for await (const b of req) {
    text+=b.toString("utf8");
    if (text.length>65536) throw Error("REQUEST_TOO_LARGE");
  }
  return text ? JSON.parse(text) : {};
}
const server = http.createServer(async (req,res) => {
  try {
    if (!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
      json(res,403,{error:"LOCALHOST_ONLY"}); return;
    }
    if (req.method !== "POST") { json(res,405,{error:"POST_ONLY"});return; }
    const body=await collect(req);
    const u=req.url;
    if (u==="/api/ai/ollama-workers/register") {
      if (req.headers["x-ollama-enrollment-secret"]!==TEST_ONLY_ENROLLMENT ||
          body.modelId!==MODEL || body.workerName!=="cst-dev-synthetic-dell") {
        json(res,401,{error:"TEST_ONLY_IDENTITY_MISMATCH"});return;
      }
      registered+=1;
      json(res,201,{workerId:777,heartbeatToken:WORKER_TOKEN,
        leaseExpiresAt:new Date(Date.now()+90000).toISOString(),
        modelId:MODEL,runtimeKind:"ollama_remote_pull"});
      return;
    }
    if (!authorizedWorker(req)) {json(res,401,{error:"TEST_ONLY_WORKER_AUTH_REQUIRED"});return;}
    if (u==="/api/ai/ollama-workers/777/heartbeat") {
      heartbeats++;
      json(res,200,{ok:true,leaseExpiresAt:new Date(Date.now()+90000).toISOString()});
      return;
    }
    if (u==="/api/ai/ollama-workers/777/claim") {
      if (claimed===0) {
        claimed+=1;
        json(res,200,{jobId:JOB_ID,jobCode:"LOCAL-SYNTHETIC-CODING-TEST",
          jobType:"ollama_model_invocation",
          payload:{modelId:MODEL,input:JSON.stringify({
            version:1,system:"Return exactly the uppercase token "+EXPECTED+" and nothing else.",
            user:"Produce the required test token now."
          }),responseFormat:{type:"text"},maxOutputTokens:24}});
      } else res.writeHead(204).end();
      return;
    }
    if (u==="/api/ai/ollama-workers/777/jobs/"+JOB_ID+"/complete") {
      completed++;
      const result=body.result||{};
      const answer=String(result.output?.text||"").trim();
      report={status:answer===EXPECTED?"PASS":"MODEL_OUTPUT_MISMATCH",
        model:MODEL,workerId:777,jobId:JOB_ID,registered,claimed,completed,
        heartbeats,answer,outputTokens:result.usage?.outputTokens??null,
        durationSec:Math.round((Date.now()-start)/1000),evidence:"synthetic_loopback_api_and_real_ollama_inference",
        environment:"DELL_LOCAL_ONLY",externalCore:false,companyDbWrites:false,
        publicPortsOpened:false,attestationVerified:false,finalAckVerified:false};
      json(res,200,{jobId:JOB_ID,status:"COMPLETED"});
      finalized=true;
      doneResolve(report);
      return;
    }
    if (u==="/api/ai/ollama-workers/777/jobs/"+JOB_ID+"/retry") {
      json(res,200,{status:"FAILED"});
      doneReject(Error("REMOTE_WORKER_REPORTED_FAILURE"));
      return;
    }
    json(res,404,{error:"UNKNOWN_TEST_ROUTE"});
  } catch(e) {
    json(res,400,{error:"MOCK_INVALID_REQUEST"});
    doneReject(e);
  }
});
let child=null, timeout=null;
try {
  await new Promise((resolveStart,rejectStart)=>{
    server.once("error",rejectStart);
    server.listen(PORT,"127.0.0.1",resolveStart);
  });
  const env={...process.env,
    APP_ENV:"development",NODE_ENV:"development",
    CST_TEAM_OUTBOUND_DEV_ONLY:"true",CST_TEAM_SYNTHETIC_LOOPBACK_TEST:"true",
    AICORE_REMOTE_URL:"http://127.0.0.1:"+PORT,
    OLLAMA_REMOTE_ENROLLMENT_SECRET:TEST_ONLY_ENROLLMENT,
    OLLAMA_BASE_URL:"http://127.0.0.1:11434/v1",
    OLLAMA_WORKER_MODEL:MODEL,OLLAMA_WORKER_NAME:"cst-dev-synthetic-dell",
    OLLAMA_WORKER_NODE_ID:"cst-dev-synthetic-dell",
    OLLAMA_WORKER_MAX_CONCURRENCY:"1",OLLAMA_REMOTE_POLL_MS:"1500",
    OLLAMA_REMOTE_KEEP_ALIVE:"0s",
    OLLAMA_REMOTE_INVOCATION_TIMEOUT_MS:"50000",
    GCP_GPU_AUTO_STOP_ENABLED:"false"
  };
  if (env.AICORE_REMOTE_URL!=="http://127.0.0.1:18444")
    throw Error("REMOTE_ENDPOINT_IS_NOT_LOCAL");
  child=spawn(process.execPath,["--experimental-strip-types",resolve("artifacts/api-server/src/scripts/remoteOllamaWorker.ts")],
    {cwd:process.cwd(),env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  for (const stream of [child.stdout,child.stderr]) stream.on("data",buf=>{
    workerLog+=(buf.toString("utf8")).slice(0,800);
    workerLog=workerLog.slice(-2600);
  });
  const exited=new Promise((_,rejectExit)=>{
    child.once("error",rejectExit);
    child.once("exit",code=>{if (!finalized) rejectExit(Error("WORKER_EXITED_"+code));});
  });
  const deadline=new Promise((_,rejectTimeout)=>{
    timeout=setTimeout(()=>rejectTimeout(Error("MODEL_E2E_TIMEOUT_100S")),100000);
  });
  report=await Promise.race([done,exited,deadline]);
  if(report.status!=="PASS")throw Error("MODEL_OUTPUT_MISMATCH");
  console.log("OUTBOUND_WORKER_LOOPBACK_E2E_PASS",JSON.stringify(report));
} catch(error) {
  report={status:"FAIL",error:String(error?.message||error).slice(0,200),
    registered,claimed,completed,heartbeats,durationSec:Math.round((Date.now()-start)/1000),
    workerLogTail:workerLog.slice(-750),
    syntheticLoopback:true,externalCore:false,publicPortsOpened:false};
  console.log("OUTBOUND_WORKER_LOOPBACK_E2E_FAIL",JSON.stringify(report));
  process.exitCode=1;
} finally {
  if(timeout)clearTimeout(timeout);
  if(child && !child.killed)child.kill();
  await new Promise(resolveClose=>server.close(resolveClose));
  await writeFile(resolve("local-outbound-e2e-proof.json"),JSON.stringify(report,null,2),"utf8");
}
