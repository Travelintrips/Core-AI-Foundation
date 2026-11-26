/**
 * CST-DEV Company-1 model pilot: *non-authorizing* independent Owner approval
 * receipt checker. Pure function; no DB client, session, network, signing key,
 * job creation, dispatch or Final ACK.
 *
 * A row in cst_onejob_owner_approvals only records an Owner id. It cannot
 * prove the Owner was authenticated or personally approved a new job.
 */
import {createHash, createPublicKey, verify} from "node:crypto";

const PROJECT = "xssrfshdrtdfupgqwfdw";
const PURPOSE = "CST_DEV_ONEJOB_MODEL";
const TYPE = "CST_DEV_ONEJOB_OWNER_ATTESTATION";
const REQUEST = /^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER = /^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const SHA = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keys = Object.freeze([
  "version","type","project","purpose","companyId","approvalId",
  "ownerUserId","jobId","jobCode","requestId","modelId","workerName",
  "sourceSha","approvedAt","expiresAt","authChallengeSha256","nonce",
]);
const hasExact = (v,fields) => v && typeof v==="object" &&
  !Array.isArray(v) && Object.keys(v).length===fields.length &&
  fields.every(x=>Object.hasOwn(v,x));
const positiveInt = v => Number.isSafeInteger(v) && v>0;
const iso = s => typeof s==="string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString()===s;
function encode(value){
  if(!hasExact(value,keys) ||
    value.version!==1 || value.type!==TYPE || value.project!==PROJECT ||
    value.purpose!==PURPOSE || value.companyId!=="1" ||
    !UUID.test(value.approvalId) || !positiveInt(value.ownerUserId) ||
    !positiveInt(value.jobId) || value.jobId===482 ||
    typeof value.jobCode!=="string" ||
    !/^OLLAMA-[A-F0-9]{8}$/.test(value.jobCode) ||
    !REQUEST.test(value.requestId) || value.modelId!=="qwen2.5:3b" ||
    !WORKER.test(value.workerName) || !SHA.test(value.sourceSha) ||
    !iso(value.approvedAt) || !iso(value.expiresAt) ||
    !HEX64.test(value.authChallengeSha256) || !HEX64.test(value.nonce))
    throw Error("CST_OWNER_APPROVAL_SIGNED_PAYLOAD_INVALID");
  return Buffer.from(JSON.stringify(Object.fromEntries(
    keys.map(k=>[k,value[k]]))),"utf8");
}
export function serializeOneJobOwnerApprovalReceipt(payload){return encode(payload);}

/** Deliberately never authorizes a real Owner session.
 *
 * Real authority requires an authenticated Owner session issued by a
 * separately trusted app, verified independently of the stage writer. The
 * signature used here establishes only syntactic/cryptographic consistency.
 */
export function projectIndependentOneJobOwnerApproval(input,trusted,now=new Date()){
  const blocks=[];
  const require=(x,label)=>{if(x!==true)blocks.push(label);};
  const db=input?.approval,job=input?.job,owner=input?.owner,receipt=input?.receipt;
  const payload=receipt?.payload;
  require(positiveInt(job?.id)&&job.id!==482 &&
    /^OLLAMA-[A-F0-9]{8}$/.test(job?.jobCode) &&
    job?.jobType==="ollama_model_invocation" &&
    job?.requiredCapability==="ollama_inference" &&
    job?.status==="queued" &&
    REQUEST.test(job?.requestId)&&job?.modelId==="qwen2.5:3b",
    "FRESH_QUEUED_MODEL_JOB_NOT_VERIFIED");
  require(db?.purpose===PURPOSE && db?.status==="APPROVED" &&
    db?.companyId==="1" && db?.modelId==="qwen2.5:3b" &&
    UUID.test(db?.id) && positiveInt(db?.approvedByUserId) &&
    positiveInt(db?.jobId)&&db.jobId===job?.id &&
    db?.requestId===job?.requestId&&
    WORKER.test(db?.workerName)&&SHA.test(db?.sourceSha) &&
    db?.consumedAt==null &&
    iso(db?.approvedAt)&&iso(db?.expiresAt),
    "PERSISTED_APPROVAL_ROW_SCOPE_INVALID");
  require(owner?.id===db?.approvedByUserId &&
    owner?.role==="owner" && owner?.status==="active" &&
    owner?.accountType==="internal",
    "OWNER_ACCOUNT_CATALOG_NOT_MATCHED");
  const t=now instanceof Date?now.getTime():NaN;
  const start=Date.parse(db?.approvedAt),end=Date.parse(db?.expiresAt);
  require(Number.isFinite(t) && Number.isFinite(start) &&
    Number.isFinite(end) && end>start && end-start<=30*60_000 &&
    start<=t+30_000 && t<end,
    "APPROVAL_EXPIRED_OR_REPLAYED");
  require(hasExact(payload,keys) &&
    payload?.version===1 && payload?.type===TYPE &&
    payload?.project===PROJECT && payload?.purpose===PURPOSE &&
    payload?.companyId==="1" && payload?.modelId==="qwen2.5:3b" &&
    payload?.approvalId===db?.id &&
    payload?.ownerUserId===db?.approvedByUserId &&
    payload?.jobId===job?.id && payload?.jobCode===job?.jobCode &&
    payload?.requestId===db?.requestId &&
    payload?.workerName===db?.workerName &&
    payload?.sourceSha===db?.sourceSha &&
    payload?.approvedAt===db?.approvedAt &&
    payload?.expiresAt===db?.expiresAt &&
    payload?.modelId===db?.modelId,
    "SIGNED_APPROVAL_DB_JOB_LINEAGE_MISMATCH");
  let key=null,validPin=false;
  try {
    key=createPublicKey(trusted?.publicKeyPem);
    const hash=createHash("sha256").update(
      key.export({type:"spki",format:"der"})).digest("hex");
    validPin=key.asymmetricKeyType==="ed25519" &&
      HEX64.test(trusted?.publicKeySha256) &&
      trusted.publicKeySha256===hash &&
      trusted.ownerUserId===db?.approvedByUserId &&
      trusted.project===PROJECT;
  }catch{}
  require(validPin,"INDEPENDENT_OWNER_TRUST_ROOT_NOT_PINNED");
  let validSig=false;
  try{
    const sig=receipt?.signatureBase64;
    if(!validPin || typeof sig!=="string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(sig))throw Error("BAD_SIG");
    const bytes=Buffer.from(sig,"base64");
    if(bytes.length!==64||bytes.toString("base64")!==sig)
      throw Error("INVALID_SIG_ENCODING");
    validSig=verify(null,encode(payload),key,bytes);
  }catch{}
  require(validSig,"INDEPENDENT_OWNER_SIGNATURE_NOT_VERIFIED");
  return {
    check:"CST_DEV_ONE_JOB_OWNER_APPROVAL",
    mode:"SIGNED_APPROVAL_LINEAGE_ONLY_NOT_OWNER_SESSION_AUTH",
    signedApprovalLineageConsistent:blocks.length===0,
    blockers:blocks,
    ownerSessionAuthenticatorDeployed:false,
    ownerAuthenticatedSessionVerified:false,
    independentOwnerApprovalAttested:false,
    pilotAdmissionReady:false,
    subscriberDeliveryVerified:false,
    independentFinalAckVerified:false,
    sideEffects:"NONE",
  };
}
