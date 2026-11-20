/**
 * One-shot independent PULL subscriber for a committed CST-DEV completion.
 *
 * This does not trust a webhook HTTP 200 or caller-provided event JSON.
 * The subscriber uses its separately custodied DEV database identity to read
 * the actual event/job/approval/audit row and to write a one-use signed ACK.
 * It must run outside the inspected Core AI service with an externally
 * custodied subscriber Ed25519 signer and pinned public trust.
 *
 * Source code is default-off: no CLI, daemon, credentials, passwords, key
 * generation, webhook URL, role grants or migrations. No PROD access.
 */
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {ACK_DOMAIN,subscriberAckCanonicalBytes,reviewSignedSubscriberAck}
  from "./cst-onejob-subscriber-ack-review.mjs";

export const PROJECT="xssrfshdrtdfupgqwfdw";
export const SUBSCRIBER_LOGIN="cst_onejob_subscriber_login";
export const SUBSCRIBER_ROLE="cst_onejob_subscriber_writer";
const U=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SUB=/^cst-onejob-subscriber-[a-z0-9_-]{4,64}$/;
const WORKER=/^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$/;
const sha=x=>createHash("sha256").update(x).digest("hex");

export const SUBSCRIBER_SOURCE_SQL=[
 "SELECT",
 "jsonb_build_object('id',a.id,'jobId',a.job_id,",
 "'companyId',a.company_id,'status',a.status,",
 "'modelId',a.model_id,'requestId',a.request_id,"+
 "'workerName',a.worker_name) approval,",
 "jsonb_build_object('id',j.id,'status',j.status,'jobType',j.job_type,",
 "'requestId',j.payload_json->>'requestId',",
 "'modelId',j.payload_json->>'modelId',",
 "'resultJson',j.result_json) job,",
 "jsonb_build_object('id',w.id,'workerName',w.worker_name,",
 "'providerSlug',w.provider_slug,'modelId',w.model_id,",
 "'runtimeKind',w.runtime_kind) worker,",
 "jsonb_build_object('eventId',e.event_id,'eventType',e.event_type,",
 "'sourceModule',e.source_module,'sourceId',e.source_id,",
 "'correlationId',e.correlation_id,'status',e.status,",
 "'payloadJson',e.payload_json) event,",
 "jsonb_build_object('module',al.module,'action',al.action,",
 "'resourceId',al.resource_id,'status',al.status,",
 "'details',al.details) event_audit",
 "FROM ai_platform.ai_jobs j",
 "JOIN ai_platform.cst_onejob_owner_approvals a ON a.job_id=j.id",
 "JOIN ai_platform.ai_events e ON e.source_id=j.id::text",
 "AND e.event_id=$2",
 "JOIN ai_platform.ai_workers w ON w.id::text=e.payload_json->>'workerId'",
 "AND w.worker_name=a.worker_name AND w.provider_slug='ollama'",
 "AND w.model_id=a.model_id AND w.runtime_kind='ollama_remote_pull'",
 "JOIN ai_platform.ai_audit_logs al ON al.resource_id=e.event_id",
 "AND al.module='event-bus' AND al.action='event_published'",
 "WHERE j.id=$1"
].join(" ");

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v!==null&&typeof v==="object")
    return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
  return v;
}
export function independentlyObservedEventBytes(e){
  // Exact format of the existing eventHandlerRegistry call_webhook body.
  // The PULL subscriber constructs it from its OWN authoritative DB read,
  // not from HTTP input supplied by the inspected service.
  return Buffer.from(JSON.stringify({
    eventId:e.eventId,eventType:e.eventType,sourceModule:e.sourceModule,
    correlationId:e.correlationId,payload:stable(e.payloadJson)
  }),"utf8");
}
export function reviewSubscriberSource(facts,jobId,eventId){
  const a=facts?.approval,j=facts?.job,e=facts?.event,log=facts?.event_audit;
  const w=facts?.worker;
  const good=Boolean(a&&j&&e&&log&&
    Number.isSafeInteger(jobId)&&jobId>0&&jobId!==482&&
    U.test(eventId)&&U.test(a.id)&&
    a.jobId===jobId&&a.companyId==="1"&&a.status==="CONSUMED"&&
    a.modelId==="qwen2.5:3b"&&WORKER.test(a.workerName||"")&&
    Number.isSafeInteger(w?.id)&&w.id>0&&
    w.workerName===a.workerName&&w.providerSlug==="ollama"&&
    w.modelId===a.modelId&&w.runtimeKind==="ollama_remote_pull"&&
    j.id===jobId&&
    j.status==="completed"&&j.jobType==="ollama_model_invocation"&&
    j.modelId===a.modelId&&j.requestId===a.requestId&&
    j.resultJson?.output?.type==="text"&&
    j.resultJson.output.text==="CST_DEV_ONEJOB_PROBE_OK"&&
    e.eventId===eventId&&U.test(e.correlationId||"")&&
    e.eventType==="job.completed"&&e.sourceModule==="job-engine"&&
    e.sourceId===String(jobId)&&
    ["published","processing","processed"].includes(e.status)&&
    e.payloadJson?.jobId===jobId&&e.payloadJson?.workerId===w.id&&
    e.payloadJson?.jobType==="ollama_model_invocation"&&
    log.module==="event-bus"&&log.action==="event_published"&&
    log.resourceId===eventId&&log.status==="success"&&
    log.details?.eventType===e.eventType&&
    log.details?.sourceModule===e.sourceModule&&
    log.details?.correlationId===e.correlationId);
  return good?{status:"AUTHORITATIVE_COMPLETION_OBSERVED"}:
    {status:"DENIED",reason:"SUBSCRIBER_UNTRUSTED_EVENT_SOURCE"};
}
export async function pullAndAcknowledgeOneJobCompletion({
  client,jobId,eventId,expectedSubscriberId,pinnedTrust,signBytes
}){
  if(!Number.isSafeInteger(jobId)||jobId<=0||jobId===482||
     !U.test(eventId||"")||!SUB.test(expectedSubscriberId||"")||
     pinnedTrust?.use!=="CST_DEV_ONEJOB_SUBSCRIBER_PUBLIC_PIN"||
     pinnedTrust?.project!==PROJECT||
     pinnedTrust?.subscriberId!==expectedSubscriberId||
     typeof signBytes!=="function")
    throw Error("PINNED_INDEPENDENT_SUBSCRIBER_REQUIRED");
  let started=false;
  try{
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");started=true;
    await client.query("SET TRANSACTION READ WRITE");
    await client.query("SET LOCAL ROLE "+SUBSCRIBER_ROLE);
    const ident=await client.query(
      "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    if(ident.rows?.length!==1||
       ident.rows[0].role_name!==SUBSCRIBER_ROLE||
       ident.rows[0].login_name!==SUBSCRIBER_LOGIN||
       ident.rows[0].db!=="postgres")
      throw Error("SUBSCRIBER_DEDICATED_DB_IDENTITY_REQUIRED");
    const observed=await client.query(SUBSCRIBER_SOURCE_SQL,[jobId,eventId]);
    if(observed.rows?.length!==1||
       reviewSubscriberSource(observed.rows[0],jobId,eventId).status!==
         "AUTHORITATIVE_COMPLETION_OBSERVED")
      throw Error("SUBSCRIBER_COMPLETION_NOT_INDEPENDENTLY_OBSERVED");
    const facts=observed.rows[0],e=facts.event;
    const deliveryBytes=independentlyObservedEventBytes(e);
    if(deliveryBytes.length<1||deliveryBytes.length>65536)
      throw Error("SUBSCRIBER_EVENT_BYTES_OVERSIZE");
    const now=new Date().toISOString(),deliveryId=randomUUID();
    const claims={
      domain:ACK_DOMAIN,project:PROJECT,companyId:"1",
      jobId,approvalId:facts.approval.id,eventId,deliveryId,
      subscriberId:expectedSubscriberId,correlationId:e.correlationId,
      deliveryDigest:sha(deliveryBytes),
      nonce:randomBytes(32).toString("hex"),acknowledgedAt:now,
      expiresAt:new Date(Date.parse(now)+3*60*1000).toISOString()
    };
    const signatureBase64=await signBytes(subscriberAckCanonicalBytes(claims));
    const signedAck={claims,signatureBase64,
      publicKeyFingerprint:pinnedTrust.fingerprint};
    const validated=reviewSignedSubscriberAck({
      signedAck,pinnedTrust,deliveredBytes:deliveryBytes,nowIso:now,
      expected:{jobId,approvalId:claims.approvalId,eventId,deliveryId,
        subscriberId:expectedSubscriberId,correlationId:claims.correlationId,
        deliveryDigest:claims.deliveryDigest}
    });
    if(validated.status!=="CRYPTOGRAPHIC_SUBSCRIBER_ACK_VALID")
      throw Error("SUBSCRIBER_EXTERNAL_SIGNATURE_UNTRUSTED");
    const inserted=await client.query(
      "INSERT INTO cst_onejob_private.subscriber_delivery_receipts "+
      "(approval_id,job_id,event_id,delivery_id,subscriber_id,correlation_id,"+
      "delivery_digest,status,ack_nonce,ack_signature_base64,"+
      "ack_issuer_fingerprint,received_at,ack_expires_at) "+
      "VALUES($1::uuid,$2::int,$3::uuid,$4::uuid,$5,$6::uuid,$7,"+
      "'ACKNOWLEDGED',$8,$9,$10,$11::timestamptz,$12::timestamptz) RETURNING id",
      [claims.approvalId,jobId,eventId,deliveryId,expectedSubscriberId,
       claims.correlationId,claims.deliveryDigest,claims.nonce,
       signatureBase64,pinnedTrust.fingerprint,now,claims.expiresAt]
    );
    if(inserted.rows?.length!==1)
      throw Error("SUBSCRIBER_SIGNED_ACK_NOT_STORED");
    await client.query(
      "INSERT INTO ai_platform.ai_audit_logs "+
      "(module,action,resource_type,resource_id,status,details) "+
      "VALUES('cst-onejob','independent_subscriber_ack','ai_event',"+
      "$1,'success',jsonb_build_object('jobId',$2::integer,"+
      "'deliveryId',$3::text,'signatureDigest',$4::text))",
      [eventId,jobId,deliveryId,validated.receiptDigest]
    );
    await client.query("COMMIT");started=false;
    return {status:"SUBSCRIBER_ACK_PERSISTED",jobId,eventId,deliveryId,
      signedAck,deliveryBytes,
      queueTransitionAuthorized:false,dispatchPermitted:false,finalAckIssued:false};
  }catch(error){
    if(started)try{await client.query("ROLLBACK")}catch{}
    throw error;
  }
}

/**
 * Read one committed completion from the independent subscriber's scoped role.
 * No untrusted webhook, wildcard subscription, polling loop or shared runtime.
 * Revalidation inside pullAndAcknowledgeOneJobCompletion closes the race
 * between this READ ONLY discovery and the subsequent one-shot ACK transaction.
 */
export const ONE_JOB_COMPLETION_SOURCE_SQL=[
  "SELECT e.event_id",
  "FROM ai_platform.ai_jobs j",
  "JOIN ai_platform.cst_onejob_owner_approvals a ON a.job_id=j.id",
  "JOIN ai_platform.ai_events e ON e.source_id=j.id::text",
  "JOIN ai_platform.ai_workers w ON w.id::text=e.payload_json->>'workerId'",
  "AND w.worker_name=a.worker_name AND w.provider_slug='ollama'",
  "AND w.model_id=a.model_id AND w.runtime_kind='ollama_remote_pull'",
  "WHERE j.id=$1 AND j.status='completed'",
  "AND j.job_type='ollama_model_invocation'",
  "AND j.payload_json->>'modelId'='qwen2.5:3b'",
  "AND j.payload_json->>'requestId' ~",
  "'^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'",
  "AND a.status='CONSUMED' AND a.company_id='1'",
  "AND a.consumed_at IS NOT NULL",
  "AND e.event_type='job.completed' AND e.source_module='job-engine'",
  "AND e.payload_json->>'jobId'=j.id::text",
  "AND e.payload_json->>'jobType'='ollama_model_invocation'",
  "AND e.status IN ('published','processing','processed')",
  "AND EXISTS (SELECT 1 FROM ai_platform.ai_audit_logs l",
  "WHERE l.resource_id=e.event_id AND l.module='event-bus'",
  "AND l.action='event_published' AND l.status='success')",
  "LIMIT 2"
].join(" ");

export async function discoverOneJobCompletion({client,jobId}){
  if(!Number.isSafeInteger(jobId)||jobId<=0||jobId===482)
    throw Error("INDEPENDENT_SUBSCRIBER_JOB_ID_REQUIRED");
  let started=false;
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY");
    started=true;
    await client.query("SET LOCAL ROLE "+SUBSCRIBER_ROLE);
    const identity=await client.query(
      "SELECT current_user AS role_name,session_user AS login_name,current_database() AS db");
    if(identity.rows?.length!==1||
       identity.rows[0].role_name!==SUBSCRIBER_ROLE||
       identity.rows[0].login_name!==SUBSCRIBER_LOGIN||
       identity.rows[0].db!=="postgres")
      throw Error("INDEPENDENT_SUBSCRIBER_IDENTITY_INVALID");
    const result=await client.query(ONE_JOB_COMPLETION_SOURCE_SQL,[jobId]);
    if(result.rows?.length!==1||!U.test(result.rows[0]?.event_id||""))
      throw Error("ONE_UNIQUE_COMPLETION_EVENT_REQUIRED");
    await client.query("COMMIT");started=false;
    return {status:"ONE_EVENT_SELECTED_READ_ONLY",
      jobId,eventId:result.rows[0].event_id,
      subscriberAckIssued:false,dispatchPermitted:false};
  }catch(error){
    if(started)try{await client.query("ROLLBACK")}catch{}
    throw error;
  }
}

/** An actual one-shot handoff: no background daemon or new event subscription. */
export async function pullExactlyOneCstJobCompletion(options){
  const selected=await discoverOneJobCompletion({
    client:options.client,jobId:options.jobId
  });
  return pullAndAcknowledgeOneJobCompletion({
    ...options,eventId:selected.eventId
  });
}
