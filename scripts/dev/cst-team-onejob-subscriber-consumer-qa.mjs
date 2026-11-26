/**
 * One-event independent subscriber adapter — DEV isolated QA only.
 *
 * No worker dispatch, event UPDATE, subscription list access, or signer
 * custody. Database session, approved job binding and signer callback must
 * be supplied independently. Importing this module has zero side effects.
 * Not registered as an operational broker/subscriber entrypoint.
 */
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import {
  CST_DEV_PROJECT, SUBSCRIBER_RECEIPT_TYPE,
  serializeCstDevSubscriberReceipt,
} from "./cst-team-onejob-subscriber-receipt.mjs";

const ROLE=/^cst_team_onejob_subscriber_[0-9]{8}_[a-f0-9]{8}$/;
const SID=/^cst-dev-onejob-subscriber-[0-9]{8}-[a-f0-9]{8}$/;
const REQUEST=/^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
function deny(reason){throw Error("CST_SUBSCRIBER_"+reason)}
function iso(value){
  if(value instanceof Date) return value.toISOString();
  if(typeof value==="string" && !Number.isNaN(Date.parse(value)))
    return new Date(value).toISOString();
  deny("EVENT_TIME_UNVERIFIED");
}
/** Inputs are scoped job metadata from a SEPARATE authorized workflow, not
 * arbitrary destination fields accepted from the received event.
 */
export async function consumeOneCstDevCompletionOnce({
  client, scope, trustedSubscriber, signPayload, now=new Date(),
}) {
  if(typeof client?.query!=="function" || typeof signPayload!=="function" ||
     !scope || !trustedSubscriber || !(now instanceof Date) ||
     !Number.isFinite(now.getTime())) deny("INPUT_NOT_AUTHORIZED");
  const {jobId,jobCode,workerId,requestId}=scope;
  if(!Number.isSafeInteger(jobId) || jobId<=0 || jobId===482 ||
     !Number.isSafeInteger(workerId) || workerId<=0 ||
     typeof jobCode!=="string" || jobCode.length<3 || jobCode.length>128 ||
     !REQUEST.test(requestId)) deny("JOB_SCOPE_INVALID");

  const {roleName,subscriberId,publicKeyPem,publicKeySha256}=trustedSubscriber;
  let pub;
  try {
    pub=createPublicKey(publicKeyPem);
    const pin=createHash("sha256").update(
      pub.export({type:"spki",format:"der"})).digest("hex");
    if(!ROLE.test(roleName)||!SID.test(subscriberId) ||
       pub.asymmetricKeyType!=="ed25519" ||
       !HEX.test(publicKeySha256) || publicKeySha256!==pin)
       deny("INDEPENDENT_TRUST_ROOT_INVALID");
  } catch {deny("INDEPENDENT_TRUST_ROOT_INVALID")}

  // Query #1: session identity, not an application-supplied UID/username.
  const session=await client.query("SELECT current_user AS authenticated_role");
  if(session?.rows?.length!==1 || session.rows[0].authenticated_role!==roleName)
    deny("AUTHENTICATED_DB_ROLE_MISMATCH");

  // Query #2: only the exact job is visible, subject to the role's own RLS.
  // A widened SELECT returning several events must fail closed.
  const res=await client.query(
    "SELECT event_id,event_type,source_module,source_id,status,correlation_id,"+
    "payload_json,published_at FROM ai_platform.ai_events "+
    "WHERE event_type='job.completed' AND source_module='job-engine' "+
    "AND source_id=$1 ORDER BY event_id LIMIT 2",
    [String(jobId)]);
  if(res?.rows?.length!==1)deny("EXACT_ONE_PUBLISHED_EVENT_NOT_VISIBLE");
  const e=res.rows[0],p=e.payload_json;
  if(!UUID.test(e.event_id) || !UUID.test(e.correlation_id) ||
     e.event_type!=="job.completed" || e.source_module!=="job-engine" ||
     e.source_id!==String(jobId) || e.status!=="published" ||
     p?.jobId!==jobId || p?.workerId!==workerId ||
     p?.jobCode!==jobCode || p?.jobType!=="ollama_model_invocation" ||
     (p?.requestId!==undefined && p.requestId!==requestId))
     deny("EVENT_LINEAGE_INVALID");
  const published=Date.parse(iso(e.published_at));
  const received=now.getTime();
  if(published>received || received-published>5*60_000)
    deny("EVENT_DELIVERY_WINDOW_CLOSED");

  const payload=Object.freeze({
    version:1,type:SUBSCRIBER_RECEIPT_TYPE,
    project:CST_DEV_PROJECT,companyId:"1",
    eventId:e.event_id,jobId,jobCode,requestId,workerId,
    correlationId:e.correlation_id,subscriberId,
    deliveryState:"delivered",receivedAt:now.toISOString(),
    nonce:randomBytes(16).toString("hex"),
  });
  const bytes=serializeCstDevSubscriberReceipt(payload);
  // Only a separately authorized custodian can implement signPayload.
  // A self-declared public key or signature returned by the event is ignored.
  const signed=await signPayload(Buffer.from(bytes));
  if(typeof signed!=="string" ||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(signed))deny("SIGNATURE_INVALID");
  const sig=Buffer.from(signed,"base64");
  if(sig.length!==64 || sig.toString("base64")!==signed ||
     !verify(null,bytes,pub,sig))deny("SIGNATURE_NOT_FROM_TRUSTED_SUBSCRIBER");

  // Query #3: INSERT only. No audit SELECT/UPDATE, no ai_jobs,
  // ai_event_subscriptions, webhook, event status mutation or replay.
  // PostgreSQL RLS and the partial unique index enforce exactly one receipt.
  const details={payload,signatureBase64:signed,publicKeySha256};
  let written;
  try {
    written=await client.query(
      "INSERT INTO ai_platform.ai_audit_logs ("+
      "module,action,resource_id,resource_type,status,actor_id,actor_type,"+
      "tenant_id,details) VALUES ("+
      "'cst-team-model-subscriber','job_completed_received',$1,"+
      "'ai_event','success',$2,'independent-subscriber','1',$3::jsonb)",
      [e.event_id,subscriberId,JSON.stringify(details)]);
  } catch(error){
    if(error?.code==="23505")deny("DUPLICATE_RECEIPT_REJECTED");
    throw error;
  }
  if(written?.rowCount!==1)deny("AUDIT_RECEIPT_INSERT_NOT_CONFIRMED");
  return Object.freeze({
    mode:"DISPOSABLE_SUBSCRIBER_RLS_INSERT_ONLY",
    claimedInsertCount:1,eventId:e.event_id,jobId,
    // Only an independent, privileged reader can establish durability,
    // verified account custody, and signed independent QA/Final ACK.
    authenticatedSubscriberSessionVerified:false,
    durableReceiptReadbackVerified:false,
    subscriberDeliveryVerified:false,
    independentFinalAckVerified:false,
    operationalE2EVerified:false,
  });
}
