/**
 * One-time authenticated Owner intent for ONE waiting Company-1 DEV job.
 * Pure in-memory, non-authorizing challenge. Route middleware must independently
 * validate the actual signed session, active Owner role, Origin and DB job.
 * Crash/restart loses unused challenge (fail closed); no DB/dispatch here.
 */
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const SHA=/^[a-f0-9]{40}$/;
const CODE=/^OLLAMA-[A-F0-9]{8}$/;
const NONCE=/^[a-f0-9]{48}$/;
const TTL=120_000;
const MAX_PENDING=32;
type Bound={
 ownerId:number;jobId:number;requestId:string;jobCode:string;
 workerName:string;sourceSha:string;
 tokenHash:string;expiresMs:number;nonceHash:string;
};
const pending=new Map<string,Bound>();
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const equal=(a:string,b:string)=>{
 if(a.length!==b.length)return false;
 return timingSafeEqual(Buffer.from(a,"utf8"),Buffer.from(b,"utf8"));
};
const goodId=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
function validate(i:{
 ownerId:number;jobId:number;requestId:string;jobCode:string;
 workerName:string;sourceSha:string;sessionToken:string;
},now:number) {
 if(!goodId(i.ownerId)||!goodId(i.jobId)||i.jobId===482||
    !REQUEST.test(i.requestId)||!WORKER.test(i.workerName)||
    !SHA.test(i.sourceSha)||!CODE.test(i.jobCode)||
    typeof i.sessionToken!=="string"||i.sessionToken.length<32||
    !Number.isFinite(now))throw Error("CST_ONEJOB_OWNER_CHALLENGE_SCOPE_INVALID");
}
function prune(now:number) {
 for(const [k,v] of pending){
  if(v.expiresMs<=now)pending.delete(k);
 }
}
export function issueOneJobOwnerIntentChallenge(input:{
 ownerId:number;jobId:number;requestId:string;jobCode:string;
 workerName:string;sourceSha:string;sessionToken:string;
},now=Date.now()){
 validate(input,now);
 prune(now);
 // One new challenge per Owner and job; do not let parallel tabs authorize
 // a stale challenge or grow an unbounded set of pending approvals.
 for(const [k,v] of pending){
  if(v.ownerId===input.ownerId && v.jobId===input.jobId)pending.delete(k);
 }
 if(pending.size>=MAX_PENDING)throw Error("CST_ONEJOB_OWNER_CHALLENGE_CAP_REACHED");
 const nonce=randomBytes(24).toString("hex");
 const nonceHash=hash(nonce);
 const expiry=now+TTL;
 pending.set(nonceHash,{
  ownerId:input.ownerId,jobId:input.jobId,requestId:input.requestId,
  jobCode:input.jobCode,workerName:input.workerName,sourceSha:input.sourceSha,
  tokenHash:hash(input.sessionToken),nonceHash,expiresMs:expiry,
 });
 return Object.freeze({
  mode:"ONE_TIME_OWNER_BROWSER_SESSION_INTENT_ONLY",
  challenge:nonce,expiresAt:new Date(expiry).toISOString(),
  jobId:input.jobId,requestId:input.requestId,sourceSha:input.sourceSha,
  independentOwnerApprovalAttested:false,dispatchPermitted:false,
 });
}
export function consumeOneJobOwnerIntentChallenge(input:{
 ownerId:number;jobId:number;requestId:string;jobCode:string;
 workerName:string;sourceSha:string;sessionToken:string;
 challenge:string;intent:string;sameOriginVerified:boolean;
 freshSignedSessionVerified:boolean;
},now=Date.now()){
 validate(input,now);
 if(!NONCE.test(input.challenge))throw Error("CST_ONEJOB_OWNER_CHALLENGE_MISSING");
 const key=hash(input.challenge),entry=pending.get(key);
 // A challenge is consumed on every confirmation attempt once located.
 if(entry)pending.delete(key);
 if(!entry||entry.expiresMs<=now||
    input.sameOriginVerified!==true||input.freshSignedSessionVerified!==true||
    input.intent!=="APPROVE_ONLY_ONE_CST_DEV_JOB"||
    entry.ownerId!==input.ownerId||entry.jobId!==input.jobId||
    entry.requestId!==input.requestId||entry.jobCode!==input.jobCode||
    entry.workerName!==input.workerName||entry.sourceSha!==input.sourceSha||
    !equal(entry.tokenHash,hash(input.sessionToken)))
   throw Error("CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED");
 const receiptSha256=hash([
  "CST_DEV_ONEJOB_OWNER_BROWSER_INTENT_V1",
  String(entry.ownerId),String(entry.jobId),entry.jobCode,entry.requestId,
  entry.workerName,entry.sourceSha,key,entry.tokenHash,
  String(entry.expiresMs),
 ].join("\n"));
 return Object.freeze({
  mode:"AUTHENTICATED_OWNER_SESSION_INTENT_NOT_INDEPENDENT_ATTESTATION",
  ownerId:entry.ownerId,jobId:entry.jobId,requestId:entry.requestId,
  sourceSha:entry.sourceSha,receiptSha256,
  sessionIntentCaptured:true,
  independentOwnerApprovalAttested:false,
  operationalAuthorityGranted:false,
  dispatchPermitted:false,
 });
}
