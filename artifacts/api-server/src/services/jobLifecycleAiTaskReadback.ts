/** Read-only DEV AI Task receiver correlation; never issue grants or worker calls. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result={verified:boolean;reason:string;receiverJobId?:string;receiverStatus?:string;receiverProgress?:number};
const MAX_LEDGER_BYTES=32*1024;
/** Consume no more than 32 KiB of receiver JSON, even if Content-Length lies.
 * A real fetch Response supplies a readable stream; reject unavailable bodies.
 * Never trust this receiver as execution authority. */
async function readBoundedReceiverJson(response:Response):Promise<unknown>{
 const type=response.headers.get("content-type")?.toLowerCase().split(";")[0]?.trim();
 if(type!=="application/json")throw Error("LEDGER_NOT_JSON");
 const length=response.headers.get("content-length");
 if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>MAX_LEDGER_BYTES))
  throw Error("LEDGER_RESPONSE_TOO_LARGE");
 if(!response.body)throw Error("LEDGER_RESPONSE_STREAM_MISSING");
 const reader=response.body.getReader();
 const decoder=new TextDecoder("utf-8",{fatal:true});
 let bytes=0;
 let raw="";
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   bytes+=value.byteLength;
   if(bytes>MAX_LEDGER_BYTES)throw Error("LEDGER_RESPONSE_TOO_LARGE");
   raw+=decoder.decode(value,{stream:true});
  }
  raw+=decoder.decode();
  return JSON.parse(raw);
 }finally{reader.releaseLock();}
}
export async function readDevAiTaskJob(commandId:string,
 env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):Promise<Result>{
 const deny=(reason:string):Result=>({verified:false,reason});
 if(env["APP_ENV"]!=="development"||env["NODE_ENV"]==="production")return deny("DEV_ONLY");
 if(!uuid.test(commandId))return deny("INVALID_COMMAND_ID");
 if(env["AI_TASK_LEDGER_READBACK_ENABLED"]!=="true")return deny("READBACK_DISABLED");
 const url=env["AI_TASK_LEDGER_URL"]?.trim();
 const token=env["AI_TASK_BRIDGE_TOKEN"]?.trim();
 if(url!=="https://dev-ai-task.cstlogistic.co.id"&&url!=="https://dev-ai-task.cstlogistic.co.id/")
  return deny("DEV_RECEIVER_NOT_CONFIGURED");
 if(!token||token.length<32)return deny("BRIDGE_CREDENTIAL_MISSING");
 const externalId="bridge-command:"+commandId;
 try{
  const response=await fetcher("https://dev-ai-task.cstlogistic.co.id/api/bridge/jobs/by-external-id/"+
   encodeURIComponent(externalId),{
   method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json",
    "Cache-Control":"no-store"},
   redirect:"error",signal:AbortSignal.timeout(3000),
  });
  if(response.status===404)return deny("RECEIVER_JOB_NOT_FOUND");
  if(!response.ok)return deny("RECEIVER_READBACK_UNAVAILABLE");
  const payload:unknown=await readBoundedReceiverJson(response);
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return deny("RECEIVER_INVALID_RESPONSE");
  const row=payload as Record<string,unknown>;
  const timeline=row["timeline"];
  const meta=timeline&&typeof timeline==="object"&&!Array.isArray(timeline)?timeline as Record<string,unknown>:null;
  // AI-Task-Hub DEV PR #155 promises an observational GET only. Require
  // explicit negative authority flags, not just a plausible job identity.
  // An upgraded/misconfigured receiver that claims execution authority
  // is never accepted as a GPT02 approval or monitoring certificate.
  if(row["verifiedExecution"]!==false||row["mayIssueGrant"]!==false||
    row["mayDispatchWorker"]!==false)return deny("RECEIVER_AUTHORITY_CONTRACT_MISMATCH");
  // The passive ledger reconciler can supply the originally assigned
  // worker; conflicting assignment is not an acceptable correlation.
  // Absence of workerId means identity-only readback, NEVER an assignment proof.
  if(meta&&Object.hasOwn(meta,"workerId")&&
    meta["workerId"]!=="openclaw-dell-chatgpt-wake-dev")
   return deny("RECEIVER_WORKER_CORRELATION_MISMATCH");
  if(row["found"]!==true||row["readOnly"]!==true||row["source"]!=="AI_CORE"||
    row["external_id"]!==externalId||meta?.["commandId"]!==commandId||
    typeof row["id"]!=="string"||!uuid.test(row["id"])||
    typeof row["status"]!=="string"||row["status"].length>40)
   return deny("RECEIVER_CORRELATION_MISMATCH");
  const progress=row["progress"];
  return {verified:true,reason:"DEV_RECEIVER_IDENTITY_OBSERVED_NOT_EXECUTION_AUTHORITY",
   receiverJobId:row["id"],receiverStatus:row["status"],
   ...(typeof progress==="number"&&Number.isFinite(progress)&&progress>=0&&progress<=100?
    {receiverProgress:progress}:{})};
 }catch{return deny("RECEIVER_TRANSPORT_UNAVAILABLE");}
}
