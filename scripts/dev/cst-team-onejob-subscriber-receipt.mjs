/**
 * CST-DEV one-job completion: pure, fail-closed evidence check for a separately
 * signed subscriber receipt. This DOES NOT register a subscriber, contact a
 * database, dispatch a job, modify an event, or certify independent QA/Final ACK.
 *
 * A public key carried by a receipt must NEVER become its own trust root.
 * The trusted public key and SHA256 pin arrive separately from reviewed custody.
 */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";

export const CST_DEV_PROJECT = "xssrfshdrtdfupgqwfdw";
export const SUBSCRIBER_RECEIPT_TYPE = "CST_DEV_JOB_COMPLETED_SUBSCRIBER_RECEIPT";
export const SUBSCRIBER_RECEIPT_VERSION = 1;
const REQUEST = /^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const WORKER = /^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const SUBSCRIBER = /^cst-dev-onejob-subscriber-[0-9]{8}-[a-f0-9]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const FIELDS = Object.freeze([
  "version","type","project","companyId","eventId","jobId",
  "jobCode","requestId","workerId","correlationId","subscriberId",
  "deliveryState","receivedAt","nonce",
]);
const isObject = x => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const safeId = x => Number.isSafeInteger(x) && x > 0;
const exactKeys = (obj,fields) =>
  isObject(obj) && Object.keys(obj).length === fields.length &&
  fields.every(k => Object.prototype.hasOwnProperty.call(obj,k));
const validIso = text => typeof text === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(text) &&
  !Number.isNaN(Date.parse(text)) && new Date(text).toISOString() === text;

function checkedReceiptPayload(value) {
  if (!exactKeys(value,FIELDS) ||
      value.version !== SUBSCRIBER_RECEIPT_VERSION ||
      value.type !== SUBSCRIBER_RECEIPT_TYPE ||
      value.project !== CST_DEV_PROJECT || value.companyId !== "1" ||
      !UUID.test(value.eventId) || !safeId(value.jobId) ||
      typeof value.jobCode !== "string" || value.jobCode.length < 3 ||
      value.jobCode.length > 128 || !REQUEST.test(value.requestId) ||
      !safeId(value.workerId) || !UUID.test(value.correlationId) ||
      !SUBSCRIBER.test(value.subscriberId) ||
      value.deliveryState !== "delivered" ||
      !validIso(value.receivedAt) || !HEX32.test(value.nonce)) {
    throw Error("CST_ONEJOB_SUBSCRIBER_RECEIPT_PAYLOAD_INVALID");
  }
  // Fixed field ordering excludes any caller-selected JSON serialization.
  return Buffer.from(JSON.stringify(FIELDS.reduce((o,k) => {
    o[k] = value[k]; return o;
  },{})), "utf8");
}

/** Used by synthetic tests or a future independent signer only.
 * Does not create keys, sign a receipt, or read private material.
 */
export function serializeCstDevSubscriberReceipt(value) {
  return checkedReceiptPayload(value);
}

export function projectCstDevSubscriberReceiptEvidence(input, trusted, now=new Date()) {
  const blockers=[];
  const requireProof=(ok,reason)=>{if(ok !== true)blockers.push(reason);};
  const job=input?.job, worker=input?.worker, event=input?.event;
  const audit=input?.eventPublishedAudit, envelope=input?.receipt;
  const payload=envelope?.payload;

  requireProof(safeId(job?.id) && job.id!==482 &&
    job.status==="completed" && job.jobType==="ollama_model_invocation" &&
    job.requiredCapability==="ollama_inference" &&
    REQUEST.test(job.payloadJson?.requestId) &&
    job.payloadJson?.modelId==="qwen2.5:3b" &&
    typeof job.jobCode==="string" && job.jobCode.length>=3,
    "ONE_NEW_COMPANY1_MODEL_JOB_NOT_VERIFIED");
  requireProof(safeId(worker?.id) && WORKER.test(worker?.workerName) &&
    worker?.providerSlug==="ollama" &&
    worker?.runtimeKind==="ollama_remote_pull" &&
    worker?.modelId==="qwen2.5:3b" &&
    worker?.leaseOwner==="ollama-remote:"+worker?.workerName,
    "ONE_BOUNDED_WORKER_NOT_VERIFIED");
  requireProof(UUID.test(event?.eventId) &&
    event?.eventType==="job.completed" &&
    event?.sourceModule==="job-engine" &&
    event?.sourceId===String(job?.id) &&
    ["published","processed"].includes(event?.status) &&
    UUID.test(event?.correlationId) &&
    validIso(event?.publishedAt) &&
    event?.payloadJson?.jobId===job?.id &&
    event?.payloadJson?.jobCode===job?.jobCode &&
    event?.payloadJson?.jobType==="ollama_model_invocation" &&
    event?.payloadJson?.workerId===worker?.id,
    "PERSISTED_JOB_COMPLETED_EVENT_NOT_VERIFIED");
  requireProof(audit?.module==="event-bus" &&
    audit?.action==="event_published" &&
    audit?.resourceId===event?.eventId &&
    audit?.resourceType==="ai_event" &&
    audit?.status==="success" &&
    audit?.details?.eventType==="job.completed" &&
    audit?.details?.sourceModule==="job-engine" &&
    audit?.details?.correlationId===event?.correlationId,
    "ATOMIC_EVENT_PUBLISHED_AUDIT_NOT_VERIFIED");
  requireProof(exactKeys(payload,FIELDS) &&
    payload?.eventId===event?.eventId &&
    payload?.jobId===job?.id && payload?.jobCode===job?.jobCode &&
    payload?.requestId===job?.payloadJson?.requestId &&
    payload?.workerId===worker?.id &&
    payload?.correlationId===event?.correlationId &&
    payload?.companyId==="1" &&
    payload?.project===CST_DEV_PROJECT &&
    payload?.subscriberId===trusted?.subscriberId &&
    payload?.subscriberId!==worker?.workerName,
    "INDEPENDENT_SUBSCRIBER_LINEAGE_MISMATCH");

  const published=Date.parse(event?.publishedAt);
  const received=Date.parse(payload?.receivedAt);
  const time=now instanceof Date ? now.getTime() : NaN;
  requireProof(validIso(payload?.receivedAt) &&
    Number.isFinite(published) && Number.isFinite(received) &&
    Number.isFinite(time) && received>=published &&
    received-published<=5*60_000 && received<=time+30_000 &&
    time-received<=30*60_000,
    "RECEIPT_TIME_OR_REPLAY_WINDOW_INVALID");

  let key=null, keyPinValid=false;
  try {
    key=createPublicKey(trusted?.publicKeyPem);
    const der=key.export({type:"spki",format:"der"});
    const pin=createHash("sha256").update(der).digest("hex");
    keyPinValid=key.asymmetricKeyType==="ed25519" &&
      HEX64.test(trusted?.publicKeySha256) &&
      trusted.publicKeySha256===pin &&
      SUBSCRIBER.test(trusted?.subscriberId);
  } catch {}
  requireProof(keyPinValid,"INDEPENDENT_SUBSCRIBER_TRUST_ROOT_NOT_PINNED");

  let signatureValid=false;
  try {
    const b64=envelope?.signatureBase64;
    if(!keyPinValid || typeof b64!=="string" ||
       !/^[A-Za-z0-9+/]+={0,2}$/.test(b64))throw Error("BAD_SIGNATURE");
    const sig=Buffer.from(b64,"base64");
    if(sig.length!==64 || sig.toString("base64")!==b64)throw Error("BAD_SIGNATURE_LENGTH");
    signatureValid=verifySignature(null,checkedReceiptPayload(payload),key,sig);
  } catch {}
  requireProof(signatureValid,"SIGNED_SUBSCRIBER_RECEIPT_NOT_VERIFIED");

  return {
    check:"CST_DEV_ONE_JOB_SUBSCRIBER_RECEIPT",
    mode:"SIGNED_RECEIPT_CRYPTOGRAPHIC_AND_LINEAGE_CHECK_ONLY",
    signedReceiptConsistent:blockers.length===0,
    blockers,
    // Even a valid isolated signature doesn't demonstrate that an authorized
    // live subscriber wrote one durable, unique receipt from a real DB session.
    durableReceiptReadbackVerified:false,
    authenticatedSubscriberSessionVerified:false,
    subscriberDeliveryVerified:false,
    operationalE2EVerified:false,
    independentQaVerified:false,
    independentFinalAckVerified:false,
    sideEffects:"NONE",
  };
}
