/** Read-only DEV command lifecycle snapshot, including commands with no AI Task ID.
 * This never authorizes dispatch, job closure, or outbound notifications.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyDevSopCheckpointReceipt } from "./devSopCheckpointIssuer.js";
import { isPersistedNativeCheckpointAckVerified } from "./nativeCheckpointAckReadiness.js";

const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export async function getCodingCommandLifecycleEvidence(commandId:string) {
  const result=await db.execute(sql`
    SELECT c.id AS command_id, c.status AS command_status, c.task_id AS command_task_id,
      c.metadata_json AS command_metadata, r.id AS response_id, r.command_id AS response_command_id, r.kind,
      r.created_at, r.acknowledged_at, r.metadata_json AS response_metadata,
      r.checkpoint_json, r.message
    FROM ai_platform.ai_coding_bridge_commands c
    LEFT JOIN ai_platform.ai_coding_bridge_responses r ON r.command_id=c.id
    WHERE c.id=${commandId}::uuid AND c.metadata_json->>'devOnly'='true'
      AND c.metadata_json->>'capability'='chatgpt:wake'
    ORDER BY r.created_at ASC, r.id ASC LIMIT 101
  `);
  const rows=result.rows??[];
  if(!rows.length)return {found:false as const,commandId};
  // The 101st row proves evidence exceeds the bounded readback; do not verify
  // a checkpoint against a possibly truncated command history.
  const responseSnapshotComplete=rows.length<101;
  // The database owns response-command association. Never grant even review-level
  // attestation when identities are missing, duplicated or inconsistent.
  const identities=rows.filter(r=>r["response_id"]!==null);
  const responseIdentityValid=rows.every(r=>r["command_id"]===commandId)&&
    identities.every(r=>typeof r["response_id"]==="string"&&
      r["response_command_id"]===commandId&&typeof r["kind"]==="string")&&
    new Set(identities.map(r=>r["response_id"])).size===identities.length;
  const cmd=rows[0]!["command_metadata"];
  if(!obj(cmd)||cmd["assignedClientId"]!=="openclaw-dell-chatgpt-wake-dev")
    return {found:false as const,commandId};
  const failedReply=[...rows].reverse().find(r=>r["kind"]==="FAILED"&&typeof r["message"]==="string")?.["message"];
  const checkpoint=[...rows].reverse().find(r=>r["kind"]==="CHECKPOINT");
  const metadata=checkpoint?.["response_metadata"];
  const cpId=typeof checkpoint?.["response_id"]==="string"?checkpoint["response_id"]:null;
  const ackAt=checkpoint?.["acknowledged_at"]?new Date(String(checkpoint["acknowledged_at"])):null;
  const createdAt=checkpoint?.["created_at"]?new Date(String(checkpoint["created_at"])):null;
  const issuerAttested=Boolean(responseSnapshotComplete&&responseIdentityValid&&cpId&&obj(metadata)&&verifyDevSopCheckpointReceipt({
    receipt:metadata["checkpointReceipt"],responseMetadata:metadata,
    checkpoint:checkpoint?.["checkpoint_json"],commandId,
    issuerPrivateKeyDerBase64:process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"],
  }));
  const nativeReceiverVerified=Boolean(responseSnapshotComplete&&responseIdentityValid&&cpId&&isPersistedNativeCheckpointAckVerified({
    commandId,responseId:String(cpId),acknowledgedAt:ackAt,checkpointCreatedAt:createdAt,
    responseMetadata:metadata,commandMetadata:cmd,
    failedReply:typeof failedReply==="string"?failedReply:null,issuerAttested,
  }));
  // We deliberately do not interpret the command's FAILED status as a
  // successful completed lifecycle. A PAUSED checkpoint is evidence only.
  const status=!responseSnapshotComplete?"RESPONSE_HISTORY_INCOMPLETE_REVIEW_REQUIRED":
    !responseIdentityValid?"RESPONSE_IDENTITY_INVALID_REVIEW_REQUIRED":
    nativeReceiverVerified?"CHECKPOINT_ACKNOWLEDGED_REVIEW_REQUIRED":
    cpId?"CHECKPOINT_PENDING_VERIFICATION":String(rows[0]?.["command_status"]??"UNKNOWN");
  return {found:true as const,commandId,
    taskId:rows[0]?.["command_task_id"]??null,
    commandStatus:rows[0]?.["command_status"]??"UNKNOWN",
    status,checkpointResponseId:cpId,
    responseSnapshotComplete,responseIdentityValid,
    checkpointAttested:issuerAttested,
    nativeReceiverAckVerified:nativeReceiverVerified,
    checkpointAcknowledged:!!ackAt,
    recoveryAuthorizationVerified:false,
    workerHealthVerified:false,leaseVerified:false,
    mayAutoResume:false as const,mayAutoClose:false as const,
    verifiedCompleted:false,notificationAuthorized:false as const,
  };
}
