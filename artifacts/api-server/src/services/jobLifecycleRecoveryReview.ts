/** Read-only, server-owned DEV recovery diagnostics. Never grants dispatch authority. */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { parseRecoveryPolicy } from "./handshakeSopConfiguration.js";
import { assessJobLifecycleReadiness } from "./jobLifecycleReadinessService.js";
import { evaluateRecoveryDecision } from "./jobLifecycleRecoveryGate.js";
import { reviewBlockerEvidence } from "./jobLifecycleBlockerEvidence.js";
import { getCodingCommandLifecycleEvidence } from "./codingCommandLifecycleEvidence.js";

const workerId = "openclaw-dell-chatgpt-wake-dev";
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const validDate=(v:unknown):Date|null=>{
  if(v===null||v===undefined)return null;
  const d=v instanceof Date?v:new Date(String(v));
  return Number.isFinite(d.getTime())?d:null;
};

export type RecoveryRuntimeFacts = {
  commandId:string; status:string; checkpointResponseId:string|null;
  checkpointAttested:boolean; nativeReceiverAckVerified:boolean; responseRows:readonly {id:string;kind:string;createdAt:Date|null;acknowledgedAt:Date|null}[];
  presence:{workerId:string;lastSeenAt:Date|null;leaseExpiresAt:Date|null;reportedHealth:string|null}|null;
  policy:unknown; serverFlag:boolean; now:Date;
  /** False if the database returned too many rows or an incomplete snapshot. */
  responseSnapshotComplete?:boolean;
};

/** No command-level resume authorization record or exclusive command lease is available.
 * A worker presence lease is liveness only; it is NOT a command-execution lease. */
export function assessReadonlyRecoveryFacts(facts:RecoveryRuntimeFacts) {
  const p=parseRecoveryPolicy(facts.policy);
  const rows=facts.responseRows.map(r=>({
    id:r.id,commandId:facts.commandId,kind:r.kind,createdAt:r.createdAt,acknowledgedAt:r.acknowledgedAt,
    checkpointAttested:r.id===facts.checkpointResponseId&&facts.checkpointAttested,
    receiverAckVerified:r.id===facts.checkpointResponseId&&facts.checkpointAttested&&facts.nativeReceiverAckVerified,
  }));
  const readiness=assessJobLifecycleReadiness(rows);
  const blockerEvidence=reviewBlockerEvidence(facts.commandId,rows);
  // Terminal commands may retain valid historical receipts. These are evidence,
  // never authority to reopen a FAILED/COMPLETED/CANCELLED command.
  const commandStatusReviewable=facts.status==="RECEIVED"||facts.status==="PROCESSING";
  const responseSnapshotComplete=facts.responseSnapshotComplete===true;
  const heartbeat=facts.presence?.workerId===workerId&&facts.presence.reportedHealth==="healthy"
    ?facts.presence.lastSeenAt:null;
  const workerHeartbeatFresh=Boolean(heartbeat&&p&&
    Number.isFinite(facts.now.getTime()) &&
    heartbeat.getTime()<=facts.now.getTime() &&
    facts.now.getTime()-heartbeat.getTime()<=p.heartbeatGraceMinutes*60_000);
  const presenceLeaseActive=Boolean(facts.presence?.workerId===workerId&&
    facts.presence.leaseExpiresAt&&facts.presence.leaseExpiresAt.getTime()>facts.now.getTime());
  const decision=evaluateRecoveryDecision({
    enabledByServer:facts.serverFlag,policy:p,readiness,
    authorizedCommandId:null,blockedCommandId:facts.commandId,
    expectedWorkerId:workerId,actualWorkerId:facts.presence?.workerId??null,
    workerHeartbeatAt:heartbeat,now:facts.now,
    // Explicit command-exclusive lease absent: never infer from presence lease.
    leaseValid:false,retriesAlreadyUsed:0,retryAfterAt:null,
    recoveryAlreadyInFlight:true,requiresHumanApproval:true,
  });
  return {
    commandId:facts.commandId,commandStatus:facts.status,
    phase:readiness.phase,checkpointResponseId:readiness.latestCheckpointResponseId,
    checkpointAttested:readiness.latestCheckpointAttested,
    receiverAckVerified:readiness.latestCheckpointReceiverAckVerified,
    blockingResponseId:readiness.blockingResponseId,
    blockerEvidenceValid:blockerEvidence.valid,
    blockerEvidenceReason:blockerEvidence.reason,
    commandStatusReviewable,
    responseSnapshotComplete,
    workerPresenceHealthy:workerHeartbeatFresh,
    workerPresenceLeaseActive:presenceLeaseActive,
    recoveryPolicyEnabled:p?.enabled===true,
    recoveryFeatureEnabled:facts.serverFlag,
    commandResumeAuthorizationVerified:false as const,
    commandExclusiveLeaseVerified:false as const,
    rateLimitClearanceVerified:false as const,
    retryBudgetVerified:false as const,
    eligibleForAuthorizedRecoveryReview:decision.eligibleForAuthorizedRecoveryReview&&blockerEvidence.valid&&
      commandStatusReviewable&&responseSnapshotComplete,
    reviewReason:!commandStatusReviewable?"TERMINAL_OR_UNKNOWN_COMMAND_STATUS":
      !responseSnapshotComplete?"INCOMPLETE_RESPONSE_SNAPSHOT":decision.reason,
    mayDispatchWorker:false as const,mayCloseJob:false as const,
  };
}

export async function getDevCommandRecoveryReview(commandId:string) {
  const lifecycle=await getCodingCommandLifecycleEvidence(commandId);
  if(!lifecycle.found)return {found:false as const,commandId};
  const snapshot=await db.execute(sql`
    SELECT r.id,r.kind,r.created_at,r.acknowledged_at
    FROM ai_platform.ai_coding_bridge_responses r
    WHERE r.command_id=${commandId}::uuid
    ORDER BY r.created_at ASC,r.id ASC LIMIT 101
  `);
  const presence=await db.execute(sql`
    SELECT client_id,last_seen_at,lease_expires_at,metadata_json->>'reportedHealth' AS reported_health
    FROM ai_platform.ai_coding_bridge_presence
    WHERE client_id=${workerId} LIMIT 1
  `);
  const settings=await db.execute(sql`
    SELECT value FROM ai_platform.ai_settings WHERE key='handshake.sop2.policy.v1'
      AND is_secret IS FALSE LIMIT 1
  `);
  const parsedSetting=(()=>{
    const raw=settings.rows?.[0]?.["value"];
    if(typeof raw!=="string")return null;
    try{return JSON.parse(raw) as unknown}catch{return null}
  })();
  const pr=presence.rows?.[0];
  const facts:RecoveryRuntimeFacts={
    commandId,status:String(lifecycle.commandStatus),checkpointResponseId:lifecycle.checkpointResponseId,
    checkpointAttested:lifecycle.checkpointAttested===true,
    nativeReceiverAckVerified:lifecycle.nativeReceiverAckVerified===true,
    responseSnapshotComplete:lifecycle.responseSnapshotComplete===true&&
      lifecycle.responseIdentityValid===true&&(snapshot.rows??[]).length<101,
    // Do not silently discard malformed records: invalid IDs must fail closed.
    responseRows:(snapshot.rows??[]).map(r=>({id:typeof r["id"]==="string"?r["id"]:"",
      kind:typeof r["kind"]==="string"?r["kind"]:"UNKNOWN",createdAt:validDate(r["created_at"]),
        acknowledgedAt:validDate(r["acknowledged_at"])})),
    presence:pr?{workerId:String(pr["client_id"]),lastSeenAt:validDate(pr["last_seen_at"]),
      leaseExpiresAt:validDate(pr["lease_expires_at"]),reportedHealth:typeof pr["reported_health"]==="string"?pr["reported_health"]:null}:null,
    policy:isRecord(parsedSetting)?parsedSetting:null,
    // This flag can enable a *review*, never execution. OFF by default.
    serverFlag:process.env["AI_CORE_DEV_LIFECYCLE_RECOVERY_REVIEW_ENABLED"]==="true",
    now:new Date(),
  };
  return {found:true as const,...assessReadonlyRecoveryFacts(facts),
    // Source command's own task FK is a trace hint, NOT verified AI Task Center identity.
    sourceTaskId:typeof lifecycle.taskId==="string"&&lifecycle.taskId.length>0?
      lifecycle.taskId:null};
}
