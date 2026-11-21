/**
 * Read-only one-job approval recovery classification.
 * A missing row under scoped RLS never proves the previous POST failed.
 * No result authorizes another approval, enqueue, signing or dispatch.
 */
type Row=Record<string,unknown>;
const obj=(value:unknown):value is Row=>
 value!==null&&typeof value==="object"&&!Array.isArray(value);
const SHA40=/^[0-9a-f]{40}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[0-9a-f]{20}$/;
const JOB_CODE=/^OLLAMA-[A-F0-9]{8}$/;

export function reviewCstOneJobStageRecovery(input:{
 approval:unknown;job:unknown;expectedSourceSha:string;nowMs?:number
}){
 const now=input.nowMs??Date.now();
 const none={
  state:"NOT_VISIBLE" as const,jobId:null,jobCode:null,
  expiresAt:null,approvalReadbackVerified:false,jobReadbackVerified:false,
  automaticRetryAllowed:false,dispatchPermitted:false,
  releaseDecision:"NO_GO" as const,
 };
 if(input.approval===null||input.approval===undefined)return none;
 const a=input.approval;
 if(!obj(a)||!Number.isSafeInteger(Number(a.job_id))||
    Number(a.job_id)<=482||a.status!=="APPROVED"||
    a.company_id!=="1"||a.model_id!=="qwen2.5:3b"||
    !SHA40.test(String(a.source_sha??""))||
    !REQUEST.test(String(a.request_id??""))||
    typeof a.expires_at!=="string"||
    !Number.isFinite(Date.parse(a.expires_at))||
    !Number.isFinite(now))
    return {...none,state:"UNVERIFIED_ROW" as const};
 const expired=now>=Date.parse(a.expires_at);
 const sourceMatch=a.source_sha===input.expectedSourceSha;
 const j=input.job;
 const joined=obj(j)&&Number(j.id)===Number(a.job_id)&&
    j.status==="waiting"&&j.job_type==="ollama_model_invocation"&&
    j.request_id===a.request_id&&j.model_id==="qwen2.5:3b"&&
    JOB_CODE.test(String(j.job_code??""));
 const state=expired?"EXPIRED":!sourceMatch?"SOURCE_MISMATCH":
    !joined?"JOB_NOT_VISIBLE":"WAITING_VERIFIED";
 return {
  state,
  jobId:Number(a.job_id),jobCode:joined?String(j.job_code):null,
  expiresAt:a.expires_at,
  approvalReadbackVerified:true,
  jobReadbackVerified:Boolean(joined),
  automaticRetryAllowed:false,dispatchPermitted:false,
  releaseDecision:"NO_GO" as const,
 };
}
