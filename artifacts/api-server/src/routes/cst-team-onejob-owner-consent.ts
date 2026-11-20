/**
 * One-tap Owner session-intent capture for CST-DEV one-job ONLY.
 *
 * It does NOT create a job, mark DB approval APPROVED, grant DB roles,
 * dispatch, or issue Final ACK. The existing authenticated DEV backend must
 * separately stage a WAITING job before showing this one-tap confirmation;
 * independent signer/session review is still required afterward.
 *
 * Default-OFF: no changes to existing auth, Core DEV or PROD routes.
 */
import {Router,type Request,type Response} from "express";
import jwt from "jsonwebtoken";
import {eq} from "drizzle-orm";
import {db,aiJobsTable,aiAuditLogsTable} from "@workspace/db";
import {requireAuth,requireInternalRole,requirePasswordChanged} from "../middleware/internalAuth.js";
import {SESSION_COOKIE_NAME} from "../services/internalAuthService.js";
import {
 issueOneJobOwnerIntentChallenge,consumeOneJobOwnerIntentChallenge,
} from "../lib/cstOneJobOwnerSessionConsent.js";

const router=Router();
const PROJECT="xssrfshdrtdfupgqwfdw";
const HOST="dev.cstlogistic.co.id";
const SRC=/^[0-9a-f]{40}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const ACTIVE_LIMIT_MS=20*60_000;

function devEnabled():boolean {
 if(process.env.NODE_ENV!=="development"||
    process.env.APP_ENV!=="development"||
    process.env.CST_TEAM_ONEJOB_OWNER_CONSENT_ENABLED!=="true"||
    process.env.SUPABASE_URL_DEV!=="https://"+PROJECT+".supabase.co"||
    Boolean(process.env.SUPABASE_PROD_DATABASE_URL))return false;
 const raw=process.env.SUPABASE_DEV_DATABASE_URL||
   process.env.SUPABASE_DATABASE_URL_DEV||"";
 try{
  const url=new URL(raw),user=decodeURIComponent(url.username);
  return ["postgres:","postgresql:"].includes(url.protocol) &&
   url.hostname==="aws-1-ap-southeast-2.pooler.supabase.com" &&
   url.port==="6543" && url.pathname==="/postgres" &&
   user.endsWith("."+PROJECT) && url.search==="" && url.hash==="";
 }catch{return false}
}
function freshOwnerSession(req:Request):string|null {
 const u=req.internalUser;
 if(!u || u.role!=="owner" || u.status!=="active" ||
    u.accountType!=="internal" || u.mustChangePassword)return null;
 const token=(req.cookies as Record<string,string>|undefined)?.[SESSION_COOKIE_NAME];
 const secret=process.env.SESSION_SECRET;
 if(typeof token!=="string" || typeof secret!=="string"||
    secret.length<32)return null;
 try{
  const claims=jwt.verify(token,secret,{
   algorithms:["HS256"],maxAge:"20m"
  });
  if(typeof claims!=="object" || claims===null ||
     claims.sub!==u.id || typeof claims.iat!=="number" ||
     typeof claims.exp!=="number" ||
     ("purpose" in claims))return null;
  const age=Date.now()-claims.iat*1000;
  return age>=0&&age<=ACTIVE_LIMIT_MS?token:null;
 }catch{return null}
}
function sameTrustedBrowserOrigin(req:Request):boolean {
 const origin=req.get("origin")||"";
 const host=req.get("host")||"";
 try{
  const u=new URL(origin);
  return host===HOST && u.protocol==="https:" &&
    u.hostname===HOST && u.port==="" &&
    u.pathname==="/" && u.search==="" && u.hash==="";
 }catch{return false}
}
async function scope(jobId:number) {
 if(!Number.isSafeInteger(jobId)||jobId<=0||jobId===482)return null;
 const sourceSha=process.env.CST_TEAM_ONEJOB_OWNER_SOURCE_SHA||"";
 const workerName=process.env.CST_TEAM_ONEJOB_OWNER_WORKER_NAME||"";
 if(!SRC.test(sourceSha)||!WORKER.test(workerName))return null;
 const [job]=await db.select({
  id:aiJobsTable.id,jobCode:aiJobsTable.jobCode,
  status:aiJobsTable.status,jobType:aiJobsTable.jobType,
  requiredCapability:aiJobsTable.requiredCapability,
  payloadJson:aiJobsTable.payloadJson,
 }).from(aiJobsTable).where(eq(aiJobsTable.id,jobId)).limit(1);
 const p=job?.payloadJson;
 if(!job||job.status!=="waiting"||job.jobType!=="ollama_model_invocation"||
    job.requiredCapability!=="ollama_inference"||
    !p||typeof p!=="object"||Array.isArray(p) ||
    !REQUEST.test(String((p as Record<string,unknown>).requestId??""))||
    (p as Record<string,unknown>).modelId!=="qwen2.5:3b" ||
    !/^OLLAMA-[A-F0-9]{8}$/.test(job.jobCode))return null;
 return {ownerSourceSha:sourceSha,workerName,jobId:job.id,
  jobCode:job.jobCode,requestId:String((p as Record<string,unknown>).requestId)};
}
const guards=[requireAuth,requireInternalRole("owner"),requirePasswordChanged];

router.get("/cst-team-onejob/owner/intent",...guards,async(req:Request,res:Response)=>{
 if(!devEnabled()){res.sendStatus(404);return;}
 const cookie=freshOwnerSession(req);
 if(!cookie){res.status(401).json({error:"FRESH_OWNER_SESSION_REQUIRED"});return;}
 const id=Number(req.query["jobId"]);
 try{
  const s=await scope(id);
  if(!s){res.status(409).json({error:"ONE_NEW_WAITING_COMPANY1_JOB_REQUIRED"});return;}
  const challenge=issueOneJobOwnerIntentChallenge({
   ownerId:req.internalUser!.id,jobId:s.jobId,jobCode:s.jobCode,
   requestId:s.requestId,sourceSha:s.ownerSourceSha,
   workerName:s.workerName,sessionToken:cookie,
  });
  res.setHeader("Cache-Control","no-store");
  res.json({...challenge,modelId:"qwen2.5:3b",companyId:"1",
    actionLabel:"Setujui satu job CST-DEV ini",
    independentOwnerApprovalAttested:false,
    dispatchPermitted:false});
 }catch{
  res.status(503).json({error:"ONEJOB_OWNER_CHALLENGE_UNAVAILABLE"});
 }
});

router.post("/cst-team-onejob/owner/intent",...guards,async(req:Request,res:Response)=>{
 if(!devEnabled()){res.sendStatus(404);return;}
 if(!sameTrustedBrowserOrigin(req)){
  res.status(403).json({error:"SAME_ORIGIN_OWNER_CONFIRMATION_REQUIRED"});return;
 }
 const cookie=freshOwnerSession(req);
 if(!cookie){res.status(401).json({error:"FRESH_OWNER_SESSION_REQUIRED"});return;}
 const body=req.body;
 if(!body||typeof body!=="object"||Array.isArray(body)||
    Object.keys(body).sort().join(",")!=="challenge,intent,jobId"||
    typeof body.challenge!=="string"||
    body.intent!=="APPROVE_ONLY_ONE_CST_DEV_JOB"||
    !Number.isSafeInteger(body.jobId)||body.jobId===482||
    body.jobId<=0){
  res.status(400).json({error:"ONE_JOB_OWNER_INTENT_BODY_INVALID"});return;
 }
 try{
  // Re-read the exact WAITING job after session/origin verification. The
  // one-time challenge is consumed before any attempted audit insertion.
  const s=await scope(body.jobId);
  if(!s){res.status(409).json({error:"ONE_NEW_WAITING_COMPANY1_JOB_REQUIRED"});return;}
  const captured=consumeOneJobOwnerIntentChallenge({
   ownerId:req.internalUser!.id,jobId:s.jobId,jobCode:s.jobCode,
   requestId:s.requestId,sourceSha:s.ownerSourceSha,
   workerName:s.workerName,sessionToken:cookie,
   challenge:body.challenge,intent:body.intent,
   sameOriginVerified:true,freshSignedSessionVerified:true,
  });
  // Existing shared app role may INSERT general audit, but it does not have
  // approval-table privileges. Do NOT attempt to INSERT into that table
  // or elevate a role here; independent signer/authorized writer follows.
  const [audit]=await db.insert(aiAuditLogsTable).values({
   module:"cst-onejob-owner-intent",
   action:"authenticated_owner_session_confirmation",
   resourceId:String(s.jobId),
   resourceType:"ai_job",status:"success",
   tenantId:"1",actorId:String(req.internalUser!.id),
   details:{
    purpose:"CST_DEV_ONEJOB_MODEL",project:PROJECT,companyId:"1",
    modelId:"qwen2.5:3b",requestId:s.requestId,
    sourceSha:s.ownerSourceSha,workerName:s.workerName,
    sessionIntentHash:captured.receiptSha256,
    independentlyAttested:false,dispatchPermitted:false,
   },
  }).returning({id:aiAuditLogsTable.id});
  if(!audit || !Number.isSafeInteger(audit.id)){
   res.status(503).json({error:"OWNER_INTENT_AUDIT_NOT_PERSISTED"});return;
  }
  res.setHeader("Cache-Control","no-store");
  res.status(202).json({
   status:"OWNER_INTENT_RECORDED_PENDING_INDEPENDENT_ATTESTATION",
   auditId:audit.id,jobId:s.jobId,
   independentOwnerApprovalAttested:false,dispatchPermitted:false,
  });
 }catch{
  res.status(503).json({error:"OWNER_INTENT_NOT_RECORDED_OR_JOB_CHANGED"});
 }
});
export default router;
