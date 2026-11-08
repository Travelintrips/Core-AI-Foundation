/** Read-only DEV AI Task receiver correlation; never issue grants or worker calls. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result={verified:boolean;reason:string;receiverJobId?:string;receiverStatus?:string;receiverProgress?:number};
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
   method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},
   redirect:"error",signal:AbortSignal.timeout(3000),
  });
  if(response.status===404)return deny("RECEIVER_JOB_NOT_FOUND");
  if(!response.ok)return deny("RECEIVER_READBACK_UNAVAILABLE");
  const payload:unknown=await response.json();
  if(!payload||typeof payload!=="object"||Array.isArray(payload))return deny("RECEIVER_INVALID_RESPONSE");
  const row=payload as Record<string,unknown>;
  const timeline=row["timeline"];
  const meta=timeline&&typeof timeline==="object"&&!Array.isArray(timeline)?timeline as Record<string,unknown>:null;
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
