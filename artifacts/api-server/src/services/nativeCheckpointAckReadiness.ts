/** Passive native receiver proof verification for lifecycle readiness.
 * Signed evidence remains scoped to one command/response; never authorizes dispatch.
 */
import { createHash } from "node:crypto";
import { devAssistantPublicKeyForWorker } from "./devAssistantAttestation.js";
import { verifyNativeCheckpointAckEvidence, type NativeCheckpointAckEvidence } from "./nativeCheckpointAckVerifier.js";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function isPersistedNativeCheckpointAckVerified(input: {
  commandId: string;
  responseId: string;
  acknowledgedAt: Date | null;
  checkpointCreatedAt: Date | null;
  responseMetadata: unknown;
  commandMetadata: unknown;
  failedReply: string | null;
  issuerAttested: boolean;
  workerPublicKeyDerBase64?: string;
}): boolean {
  const { commandId, responseId, acknowledgedAt, checkpointCreatedAt,
    responseMetadata, commandMetadata, failedReply, issuerAttested } = input;
  if (!issuerAttested || !(acknowledgedAt instanceof Date) ||
      !(checkpointCreatedAt instanceof Date) || !record(responseMetadata) ||
      !record(commandMetadata) || typeof failedReply !== "string" ||
      !record(commandMetadata["wakeBinding"])) return false;
  const meta = responseMetadata, cmd = commandMetadata;
  const binding = cmd["wakeBinding"] as Record<string, unknown>;
  const proof = meta["nativeCheckpointAckEvidence"];
  const workerId = "openclaw-dell-chatgpt-wake-dev";
  if (!record(proof) || cmd["assignedClientId"] !== workerId ||
      cmd["completedBy"] !== workerId || cmd["capability"] !== "chatgpt:wake" ||
      cmd["devOnly"] !== true ||
      meta["nativeCheckpointAckCode"] !== "NATIVE_BROWSER_ACK_VERIFIED" ||
      meta["nativeCheckpointAckResponseId"] !== responseId ||
      meta["nativeCheckpointAckWorker"] !== workerId ||
      meta["nativeCheckpointAckEventId"] !== cmd["eventId"] ||
      meta["nativeCheckpointAckObservedAt"] !== proof["observedAt"] ||
      meta["nativeCheckpointAckSignature"] !== proof["signatureBase64"] ||
      binding["workerId"] !== workerId ||
      binding["ownerChannel"] !== cmd["conversationId"] ||
      binding["targetConversationId"] !== cmd["targetConversationId"]) return false;
  const evidence = proof as unknown as NativeCheckpointAckEvidence;
  return verifyNativeCheckpointAckEvidence(evidence, {
    commandId, responseId,
    eventId: String(cmd["eventId"] ?? ""),
    conversationId: String(cmd["conversationId"] ?? ""),
    workerId,
    browserProfile: String(binding["browserProfile"] ?? ""),
    bindingFingerprint: String(binding["bindingFingerprint"] ?? ""),
    originalTargetId: evidence.originalTargetId,
    readerTargetId: evidence.readerTargetId,
    replySha256: createHash("sha256").update(failedReply, "utf8").digest("hex"),
    checkpointCreatedAt,
    // A historical read-back should validate against the original ACK time.
    now: acknowledgedAt,
    workerPublicKeyDerBase64: input.workerPublicKeyDerBase64 ?? devAssistantPublicKeyForWorker(workerId),
    tokenOwner: workerId, devHost: true, browserObservationVerified: true,
  });
}
