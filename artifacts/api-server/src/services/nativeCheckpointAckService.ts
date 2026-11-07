import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { devAssistantPublicKeyForWorker } from "./devAssistantAttestation.js";
import { verifyDevSopCheckpointReceipt } from "./devSopCheckpointIssuer.js";
import { verifyNativeCheckpointAckEvidence, type NativeCheckpointAckEvidence } from "./nativeCheckpointAckVerifier.js";
import { verifyNativeCheckpointReaderOwnership, type NativeReaderRecord, type NativeReaderTab } from "./nativeCheckpointReaderOwnership.js";

const isObj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** No automatic worker action; one audited ACK transaction, strictly DEV-only. */
export async function acknowledgeNativeCheckpoint(input: {
  commandId: string;
  responseId: string;
  tokenOwner: string;
  evidence: NativeCheckpointAckEvidence;
  readerRecord: NativeReaderRecord;
  tabs: NativeReaderTab[];
  requestHostname: string;
  enabled: boolean;
}): Promise<{ acknowledged: boolean; code: string }> {
  if (!input.enabled) return { acknowledged: false, code: "NATIVE_ACK_FEATURE_OFF" };
  if (input.requestHostname !== "dev.cstlogistic.co.id") return { acknowledged: false, code: "DEV_ONLY" };
  if (input.tokenOwner !== "openclaw-dell-chatgpt-wake-dev") return { acknowledged: false, code: "WORKER_DENIED" };
  if (input.commandId !== input.evidence.commandId || input.responseId !== input.evidence.responseId)
    return { acknowledged: false, code: "TARGET_MISMATCH" };
  return db.transaction(async tx => {
    const result = await tx.execute(sql`
      SELECT c.id AS command_id, c.status, c.metadata_json AS command_metadata,
        r.id AS response_id, r.kind, r.checkpoint_json, r.metadata_json AS response_metadata,
        r.created_at AS checkpoint_created_at, r.acknowledged_at,
        (SELECT terminal.message FROM ai_platform.ai_coding_bridge_responses terminal
          WHERE terminal.command_id = c.id AND terminal.kind = 'FAILED'
          ORDER BY terminal.created_at DESC LIMIT 1) AS native_reply
      FROM ai_platform.ai_coding_bridge_responses r
      JOIN ai_platform.ai_coding_bridge_commands c ON c.id = r.command_id
      WHERE c.id = ${input.commandId}::uuid AND r.id = ${input.responseId}::uuid
      FOR UPDATE OF c, r
    `);
    const row = result.rows?.[0];
    if (!row || row["kind"] !== "CHECKPOINT" || row["status"] !== "FAILED" ||
      row["acknowledged_at"] !== null || !isObj(row["command_metadata"]) ||
      !isObj(row["response_metadata"])) return {acknowledged:false,code:"CHECKPOINT_NOT_ELIGIBLE"};
    const command = row["command_metadata"];
    const metadata = row["response_metadata"];
    const binding = command["wakeBinding"];
    if (!isObj(binding) || command["assignedClientId"] !== input.tokenOwner ||
      command["completedBy"] !== input.tokenOwner ||
      command["capability"] !== "chatgpt:wake" ||
      command["devOnly"] !== true ||
      typeof command["conversationId"] !== "string" ||
      typeof command["eventId"] !== "string" ||
      typeof command["targetConversationId"] !== "string" ||
      typeof row["native_reply"] !== "string") return {acknowledged:false,code:"COMMAND_PROOF_INVALID"};
    const issuerValid = verifyDevSopCheckpointReceipt({
      receipt: metadata["checkpointReceipt"], responseMetadata: metadata,
      checkpoint: row["checkpoint_json"], commandId: input.commandId,
      issuerPrivateKeyDerBase64: process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"],
    });
    if (!issuerValid) return {acknowledged:false,code:"ISSUER_SIGNATURE_INVALID"};
    const browserValid = verifyNativeCheckpointReaderOwnership({
      record:input.readerRecord, expectedEventId: String(command["eventId"]),
      expectedConversationId:String(command["targetConversationId"]),
      expectedReaderId:input.evidence.readerTargetId,
      expectedOriginalId:input.evidence.originalTargetId, tabs:input.tabs,
    });
    const workerKey = devAssistantPublicKeyForWorker(input.tokenOwner);
    const nativeValid = verifyNativeCheckpointAckEvidence(input.evidence, {
      commandId:input.commandId, responseId:input.responseId,
      eventId:String(command["eventId"]), conversationId:String(command["conversationId"]),
      workerId:input.tokenOwner,
      browserProfile:String(binding["browserProfile"] ?? ""),
      bindingFingerprint:String(binding["bindingFingerprint"] ?? ""),
      readerTargetId:input.evidence.readerTargetId, originalTargetId:input.evidence.originalTargetId,
      replySha256:createHash("sha256").update(row["native_reply"] as string,"utf8").digest("hex"),
      checkpointCreatedAt:new Date(String(row["checkpoint_created_at"])), now:new Date(),
      workerPublicKeyDerBase64:workerKey, tokenOwner:input.tokenOwner,
      devHost:true,browserObservationVerified:browserValid,
    });
    if (!nativeValid) return {acknowledged:false,code:"NATIVE_RECEIPT_NOT_VERIFIED"};
    const wrote = await tx.execute(sql`
      UPDATE ai_platform.ai_coding_bridge_responses SET acknowledged_at=NOW()
      WHERE id=${input.responseId}::uuid AND command_id=${input.commandId}::uuid
        AND kind='CHECKPOINT' AND acknowledged_at IS NULL
      RETURNING id,acknowledged_at
    `);
    if (wrote.rows?.length !== 1) throw new Error("NATIVE_ACK_CONCURRENT_UPDATE");
    await tx.execute(sql`
      UPDATE ai_platform.ai_coding_bridge_commands
      SET metadata_json = metadata_json || jsonb_build_object(
        'nativeCheckpointAckResponseId', ${input.responseId},
        'nativeCheckpointAckWorker', ${input.tokenOwner},
        'nativeCheckpointAckEventId', ${input.evidence.eventId},
        'nativeCheckpointAckObservedAt', ${input.evidence.observedAt},
        'nativeCheckpointAckSignature', ${input.evidence.signatureBase64},
        'nativeCheckpointAckEvidence', ${JSON.stringify(input.evidence)}::jsonb,
        'nativeCheckpointAckCode', 'NATIVE_BROWSER_ACK_VERIFIED'
      ), updated_at=NOW()
      WHERE id=${input.commandId}::uuid
    `);
    return {acknowledged:true,code:"NATIVE_BROWSER_ACK_VERIFIED"};
  });
}

/** Independent persisted DB read-back. This never creates or modifies an ACK. */
export async function readNativeCheckpointAck(input: {
  commandId: string; responseId: string; tokenOwner: string; requestHostname: string;
}): Promise<{ nativeAckVerified: boolean; responseId: string; commandId: string; acknowledgedAt: string | null; code: string }> {
  const denied={nativeAckVerified:false,responseId:input.responseId,commandId:input.commandId,
    acknowledgedAt:null,code:"NATIVE_ACK_READBACK_NOT_VERIFIED"};
  if (input.requestHostname !== "dev.cstlogistic.co.id" ||
      input.tokenOwner !== "openclaw-dell-chatgpt-wake-dev") return denied;
  const result=await db.execute(sql`
    SELECT c.metadata_json AS command_metadata,
      r.acknowledged_at, r.created_at, r.kind, r.metadata_json AS response_metadata,
      r.checkpoint_json, (SELECT terminal.message
        FROM ai_platform.ai_coding_bridge_responses terminal
        WHERE terminal.command_id=c.id AND terminal.kind='FAILED'
        ORDER BY terminal.created_at DESC LIMIT 1) AS native_reply
    FROM ai_platform.ai_coding_bridge_commands c
    JOIN ai_platform.ai_coding_bridge_responses r ON r.command_id=c.id
    WHERE c.id=${input.commandId}::uuid AND r.id=${input.responseId}::uuid
  `);
  const row=result.rows?.[0];
  if (!row || row["kind"]!=="CHECKPOINT" || !row["acknowledged_at"] ||
      !isObj(row["command_metadata"]) || !isObj(row["response_metadata"])) return denied;
  const cmd=row["command_metadata"];
  const proof=cmd["nativeCheckpointAckEvidence"];
  const binding=cmd["wakeBinding"];
  if(!isObj(proof)||!isObj(binding)||
     cmd["assignedClientId"]!==input.tokenOwner||
     cmd["nativeCheckpointAckResponseId"]!==input.responseId||
     cmd["nativeCheckpointAckWorker"]!==input.tokenOwner||
     cmd["nativeCheckpointAckEventId"]!==cmd["eventId"]||
     cmd["nativeCheckpointAckCode"]!=="NATIVE_BROWSER_ACK_VERIFIED"||
     typeof row["native_reply"]!=="string" ||
     !verifyDevSopCheckpointReceipt({receipt:row["response_metadata"]["checkpointReceipt"],
       responseMetadata:row["response_metadata"],checkpoint:row["checkpoint_json"],
       commandId:input.commandId,
       issuerPrivateKeyDerBase64:process.env["AI_CORE_DEV_CHECKPOINT_PRIVATE_KEY_PKCS8_DER_B64"]}))return denied;
  const evidence=proof as unknown as NativeCheckpointAckEvidence;
  const verified=verifyNativeCheckpointAckEvidence(evidence,{
    commandId:input.commandId,responseId:input.responseId,
    eventId:String(cmd["eventId"]),conversationId:String(cmd["conversationId"]),
    workerId:input.tokenOwner,browserProfile:String(binding["browserProfile"]??""),
    bindingFingerprint:String(binding["bindingFingerprint"]??""),
    originalTargetId:evidence.originalTargetId,readerTargetId:evidence.readerTargetId,
    replySha256:createHash("sha256").update(row["native_reply"] as string).digest("hex"),
    checkpointCreatedAt:new Date(String(row["created_at"])),
    // Read-back can happen later; validate proof against original ACK time.
    now:new Date(String(row["acknowledged_at"])),
    workerPublicKeyDerBase64:devAssistantPublicKeyForWorker(input.tokenOwner),
    tokenOwner:input.tokenOwner,devHost:true,browserObservationVerified:true,
  });
  if(!verified)return denied;
  const ack=new Date(String(row["acknowledged_at"]));
  return {nativeAckVerified:true,responseId:input.responseId,commandId:input.commandId,
    acknowledgedAt:ack.toISOString(),code:"NATIVE_BROWSER_ACK_VERIFIED"};
}
