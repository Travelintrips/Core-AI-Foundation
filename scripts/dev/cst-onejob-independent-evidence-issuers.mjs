/**
 * INDEPENDENT QA evidence issuer + PRE_ADMISSION append-only writer.
 * CST-DEV one-job candidate ONLY. No private key, credentials, network or
 * auto-dispatch exists here. The signer MUST be a distinct externally
 * custodied Ed25519 signing interface, not the inspected Core AI process.
 *
 * Actual host must independently collect source/image/network evidence and
 * root-pin its QA trust. The byte manifest alone does NOT prove independence.
 */
import {createHash,randomBytes} from "node:crypto";
import {QA_DOMAIN,qaCanonicalBytes,reviewSignedIndependentQaReceipt}
  from "../../artifacts/api-server/src/lib/cstOneJobIndependentQaVerifier.ts";

export const PROJECT="xssrfshdrtdfupgqwfdw";
export const QA_LOGIN="cst_onejob_qa_receipt_login";
export const QA_ROLE="cst_onejob_qa_receipt_writer";
const HEX40=/^[a-f0-9]{40}$/,HEX64=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const QAID=/^cst-independent-qa-[a-z0-9_-]{8,80}$/;
const SUB=/^cst-onejob-subscriber-[a-z0-9_-]{4,64}$/;
const sha=x=>createHash("sha256").update(x).digest("hex");
const sameKeys=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
  Object.keys(x).sort().join(",")===keys.slice().sort().join(",");
const cleanTime=(x)=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const parseEvidence=bytes=>{
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>65536)
    throw Error("INDEPENDENT_QA_BYTES_REQUIRED");
  try{return JSON.parse(bytes.toString("utf8"))}
  catch{throw Error("INDEPENDENT_QA_BYTES_NOT_JSON")}
};
function checkBinding(b){
  if(!b||b.project!==PROJECT||b.companyId!=="1"||
     !UUID.test(b.approvalId||"")||!Number.isSafeInteger(b.jobId)||
     b.jobId<=0||b.jobId===482||!REQUEST.test(b.requestId||"")||
     !WORKER.test(b.workerName||"")||!HEX40.test(b.sourceSha||"")||
     !/^sha256:[a-f0-9]{64}$/.test(b.imageId||""))
    throw Error("QA_BINDING_NOT_SCOPED");
}
function verifyIndependentCapture(stage,b,evidence,now){
  if(stage==="PRE_ADMISSION"){
    const keys=["scope","project","approvalId","jobId","workerName",
      "sourceSha","imageId","checks","capturedAt"];
    const ck=["isolatedNetwork","scopedDevRole","eventAuditPath",
      "subscriberPath","independentQaAvailable"];
    if(!sameKeys(evidence,keys)||!sameKeys(evidence.checks,ck)||
       evidence.scope!=="CST_DEV_ONEJOB_PRE_ADMISSION"||
       evidence.project!==PROJECT||evidence.approvalId!==b.approvalId||
       evidence.jobId!==b.jobId||evidence.workerName!==b.workerName||
       evidence.sourceSha!==b.sourceSha||evidence.imageId!==b.imageId||
       !ck.every(k=>evidence.checks[k]===true)||
       !cleanTime(evidence.capturedAt)||
       Date.parse(evidence.capturedAt)>now||
       Date.parse(evidence.capturedAt)<now-5*60*1000)
      throw Error("QA_PRE_CAPTURE_NOT_INDEPENDENTLY_ATTESTED");
  }else if(stage==="POST_EXECUTION"){
    const keys=["eventId","jobId","subscriberId","deliveryId","responseDigest"];
    if(!sameKeys(evidence,keys)||!b.postBinding||
       !UUID.test(evidence.eventId||"")||!UUID.test(evidence.deliveryId||"")||
       !SUB.test(evidence.subscriberId||"")||
       !HEX64.test(evidence.responseDigest||"")||
       evidence.eventId!==b.postBinding.eventId||
       evidence.deliveryId!==b.postBinding.deliveryId||
       evidence.subscriberId!==b.postBinding.subscriberId||
       evidence.jobId!==b.jobId)
      throw Error("QA_POST_SOURCE_NOT_CORRELATED");
  }else throw Error("QA_STAGE_NOT_ALLOWED");
}
export async function signIndependentQaEvidence({
  stage,binding,evidenceBytes,pinnedTrust,signBytes,nowIso
}){
  checkBinding(binding);
  const now=nowIso??new Date().toISOString(),stamp=Date.parse(now);
  if(!Number.isFinite(stamp)||Math.abs(Date.now()-stamp)>60000)
    throw Error("QA_CLOCK_NOT_CURRENT");
  const evidence=parseEvidence(evidenceBytes);
  verifyIndependentCapture(stage,binding,evidence,stamp);
  if(pinnedTrust?.use!=="CST_DEV_ONEJOB_QA_PUBLIC_PIN"||
     pinnedTrust.project!==PROJECT||!QAID.test(pinnedTrust.verifierId||"")||
     typeof signBytes!=="function")throw Error("QA_CUSTODIED_SIGNER_REQUIRED");
  const claims={
    domain:QA_DOMAIN,stage,project:PROJECT,companyId:"1",
    approvalId:binding.approvalId,jobId:binding.jobId,
    requestId:binding.requestId,workerName:binding.workerName,
    sourceSha:binding.sourceSha,imageId:binding.imageId,
    verifierId:pinnedTrust.verifierId,
    nonce:randomBytes(32).toString("hex"),verifiedAt:now,
    expiresAt:new Date(stamp+3*60*1000).toISOString(),
    evidenceDigest:sha(evidenceBytes)
  };
  const signatureBase64=await signBytes(qaCanonicalBytes(claims));
  const signedReceipt={claims,signatureBase64,
    publicKeyFingerprint:pinnedTrust.fingerprint};
  const checked=reviewSignedIndependentQaReceipt(signedReceipt,{
    project:PROJECT,approvalId:claims.approvalId,jobId:claims.jobId,
    requestId:claims.requestId,workerName:claims.workerName,
    sourceSha:claims.sourceSha,imageId:claims.imageId,stage,
    verifierId:pinnedTrust.verifierId,publicKeyPem:pinnedTrust.publicKeyPem,
    trustedFingerprint:pinnedTrust.fingerprint,nowIso:now
  });
  if(checked.status!=="CRYPTOGRAPHIC_BINDING_VALID")
    throw Error("QA_EXTERNAL_SIGNATURE_NOT_VERIFIED");
  return {status:"QA_EVIDENCE_SIGNED_ONLY",signedReceipt,
    canonicalDigest:checked.canonicalDigest,
    queueTransitionAuthorized:false,dispatchPermitted:false,finalAckIssued:false};
}
export const PRE_QA_SOURCE_SQL=[
 "SELECT",
 "jsonb_build_object('id',a.id,'jobId',a.job_id,'purpose',a.purpose,",
 "'status',a.status,'companyId',a.company_id,'modelId',a.model_id,",
 "'requestId',a.request_id,'workerName',a.worker_name,'sourceSha',a.source_sha,",
 "'approvedAt',a.approved_at,'expiresAt',a.expires_at) approval,",
 "jsonb_build_object('id',j.id,'status',j.status,'jobType',j.job_type,",
 "'capability',j.required_capability,'maxRetry',j.max_retry,",
 "'requestId',j.payload_json->>'requestId',",
 "'modelId',j.payload_json->>'modelId') job",
 "FROM ai_platform.cst_onejob_owner_approvals a",
 "JOIN ai_platform.ai_jobs j ON j.id=a.job_id",
 "JOIN ai_platform.internal_users u ON u.id=a.approved_by_user_id",
 "AND u.role='owner' AND u.status='active' AND u.account_type='internal'",
 "WHERE j.id=$1"
].join(" ");
export async function persistIndependentPreAdmission({
  client,jobId,imageId,evidenceBytes,pinnedTrust,signBytes
}){
  if(!Number.isSafeInteger(jobId)||jobId<=0||jobId===482||
     !/^sha256:[a-f0-9]{64}$/.test(imageId||""))
    throw Error("QA_NEW_JOB_IMAGE_REQUIRED");
  let started=false;
  try{
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");started=true;
    await client.query("SET TRANSACTION READ WRITE");
    await client.query("SET LOCAL ROLE "+QA_ROLE);
    const auth=await client.query(
      "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    if(auth.rows?.length!==1||
       auth.rows[0].role_name!==QA_ROLE||
       auth.rows[0].login_name!==QA_LOGIN||
       auth.rows[0].db!=="postgres")
      throw Error("INDEPENDENT_QA_DB_IDENTITY_NOT_VERIFIED");
    const read=await client.query(PRE_QA_SOURCE_SQL,[jobId]);
    if(read.rows?.length!==1)throw Error("QA_APPROVAL_OR_OWNER_NOT_READABLE");
    const {approval:a,job:j}=read.rows[0];
    const now=Date.now();
    if(a?.purpose!=="CST_DEV_ONEJOB_MODEL"||a.status!=="APPROVED"||
       a.companyId!=="1"||a.modelId!=="qwen2.5:3b"||
       a.jobId!==jobId||!cleanTime(a.approvedAt)||
       !cleanTime(a.expiresAt)||Date.parse(a.approvedAt)>now||
       Date.parse(a.expiresAt)<=now||
       j?.id!==jobId||j.status!=="waiting"||
       j.jobType!=="ollama_model_invocation"||
       j.capability!=="ollama_inference"||j.maxRetry!==0||
       j.requestId!==a.requestId||j.modelId!==a.modelId)
      throw Error("QA_AUTHORITATIVE_WAITING_BINDING_INVALID");
    const binding={project:PROJECT,companyId:"1",
      approvalId:a.id,jobId,requestId:a.requestId,
      workerName:a.workerName,sourceSha:a.sourceSha,imageId};
    const issued=await signIndependentQaEvidence({
      stage:"PRE_ADMISSION",binding,evidenceBytes,pinnedTrust,signBytes
    });
    const c=issued.signedReceipt.claims;
    const inserted=await client.query(
      "INSERT INTO cst_onejob_private.verified_admission_receipts "+
      "(approval_id,job_id,company_id,request_id,worker_name,image_source_sha,image_id,"+
      "isolated_network_verified,scoped_dev_role_verified,event_audit_path_verified,"+
      "subscriber_path_verified,independent_qa_available,nonce,proof_digest,verifier_id,"+
      "verified_at,expires_at) "+
      "VALUES($1::uuid,$2::int,'1',$3,$4,$5,$6,true,true,true,true,true,$7,$8,$9,"+
      "$10::timestamptz,$11::timestamptz) RETURNING id",
      [c.approvalId,jobId,c.requestId,c.workerName,c.sourceSha,c.imageId,
       c.nonce,issued.canonicalDigest,c.verifierId,c.verifiedAt,c.expiresAt]
    );
    if(inserted.rows?.length!==1)throw Error("QA_RECEIPT_NOT_PERSISTED");
    await client.query(
      "INSERT INTO ai_platform.ai_audit_logs "+
      "(module,action,resource_type,resource_id,status,details) "+
      "VALUES('cst-onejob','independent_pre_admission_qa','ai_job',$1,'success',"+
      "jsonb_build_object('receiptId',$2::text,'evidenceDigest',$3::text))",
      [String(jobId),String(inserted.rows[0].id),c.evidenceDigest]
    );
    await client.query("COMMIT");started=false;
    return {status:"QA_PRE_ADMISSION_PERSISTED_NO_ADMISSION",
      jobId,receiptId:inserted.rows[0].id,
      signedReceipt:issued.signedReceipt,
      queueTransitionAuthorized:false,dispatchPermitted:false,finalAckIssued:false};
  }catch(error){
    if(started)try{await client.query("ROLLBACK")}catch{}
    throw error;
  }
}
