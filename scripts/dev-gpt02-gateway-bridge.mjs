/**
 * Experimental DEV-only gateway-native GPT02 transport.
 * This file is NOT wired to the running worker. No browser, CDP, DOM or HTTP code.
 * Ports are injected so dispatch, recovery and auth can be tested independently.
 * Never interpret a caller-supplied account alias as proof of an authenticated model.
 */
import { createHash, sign, verify } from "node:crypto";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const OWNER = /^ai-engine-oauth:[a-f0-9]{64}$/;
const WORKER = "openclaw-dell-chatgpt-wake-dev";
const VALID_STATES = new Set([
  "RESERVED", "SUBMITTED", "SUBMISSION_UNKNOWN", "REPLY_VERIFIED",
  "CALLBACK_UNKNOWN", "CALLBACK_ACCEPTED", "FINAL_ACK", "REJECTED",
]);

export class BridgeViolation extends Error {
  constructor(code) {
    super(code);
    this.name = "BridgeViolation";
    this.code = code;
  }
}
function ensure(ok, code) {
  if (!ok) throw new BridgeViolation(code);
}
function hash(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
export function validateTrustedBinding(binding) {
  // Must be read from a trusted worker registry, never accepted from work metadata.
  ensure(binding && typeof binding === "object", "UNVERIFIED_GPT02_BINDING");
  ensure(binding.accountAlias === "GPT02" && binding.workerId === WORKER &&
    OWNER.test(binding.ownerChannel) && UUID.test(binding.targetConversationId),
  "UNVERIFIED_GPT02_BINDING");
  ensure(typeof binding.gatewayAgentId === "string" &&
    /^[a-z][a-z0-9-]{1,62}$/.test(binding.gatewayAgentId) &&
    typeof binding.provider === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(binding.provider) &&
    binding.provider !== "ai-core" && DIGEST.test(binding.principalFingerprint) &&
    binding.credentialStatus === "VERIFIED", "GATEWAY_PRINCIPAL_NOT_VERIFIED");
  // The old browser account is NOT automatically the agent principal.
  ensure(binding.proofSource === "authorized-provider-identity-check" &&
    typeof binding.proofId === "string" && UUID.test(binding.proofId),
  "GATEWAY_IDENTITY_EVIDENCE_MISSING");
  return binding;
}
export function validateJob(work, binding) {
  ensure(work && typeof work === "object" &&
    work.commandId && UUID.test(work.commandId) && DIGEST.test(work.eventId) &&
    DIGEST.test(work.challenge) &&
    typeof work.correlationId === "string" &&
    /^ai-task:[A-Za-z0-9_-]{1,100}:[1-9][0-9]*:[A-Za-z0-9_-]{8,80}$/.test(work.correlationId) &&
    typeof work.instruction === "string" &&
    work.instruction.length >= 1 && work.instruction.length <= 4096,
  "INVALID_DEV_WORK");
  ensure(work.devOnly === true && work.workerId === WORKER &&
    work.accountAlias === "GPT02" &&
    work.ownerChannel === binding.ownerChannel &&
    work.targetConversationId === binding.targetConversationId,
  "BOUND_WORKER_IDENTITY_MISMATCH");
  return work;
}
export function runKey(work, binding) {
  // One physical event has one transport key even if an upstream bug
  // generates a new commandId for an existing event. The ledger rejects
  // mismatched metadata rather than silently creating another send.
  return hash(["dev-gateway-turn/v1", binding.workerId, work.eventId].join("|"));
}
export function gatewaySessionKey(binding, work) {
  return "agent:" + binding.gatewayAgentId + ":ai-task-dev-" + runKey(work, binding).slice(0, 40);
}
function assertPrincipal(heard, binding) {
  ensure(heard?.authenticated === true &&
    heard.source === "gateway-credential-store" &&
    heard.gatewayAgentId === binding.gatewayAgentId &&
    heard.provider === binding.provider &&
    heard.principalFingerprint === binding.principalFingerprint,
  "GATEWAY_CREDENTIAL_IDENTITY_MISMATCH");
}
function trustedRequest(work, binding) {
  const ack = "[AI_CORE_ATTEST_ACK:" + work.challenge + "]";
  return [
    "[AI_CORE_WAKE:" + work.eventId + "]",
    "[AI_CORE_ATTEST:" + work.challenge + "]",
    work.instruction,
    "On your final response, include the exact token " + ack + " once.",
  ].join(" ");
}
function assertReply(observed, stored, work, binding) {
  ensure(observed && observed.status === "completed" &&
    observed.runId === stored.runId &&
    observed.sessionKey === stored.sessionKey &&
    observed.provider === binding.provider &&
    observed.gatewayAgentId === binding.gatewayAgentId &&
    observed.principalFingerprint === binding.principalFingerprint &&
    observed.role === "assistant" &&
    observed.final === true && UUID.test(observed.messageId) &&
    typeof observed.text === "string" && observed.text.length > 0 &&
    observed.text.length <= 4000, "GATEWAY_REPLY_CONTEXT_INVALID");
  const ack = "[AI_CORE_ATTEST_ACK:" + work.challenge + "]";
  ensure(observed.text.split(ack).length === 2, "MISSING_EXACT_ASSISTANT_ACK");
  ensure(!observed.text.includes("[AI_CORE_WAKE:"), "ASSISTANT_REPLY_CONTAINS_USER_MARKER");
  return observed;
}
function signedReceipt(work, binding, stored, observed, privateKey) {
  ensure(privateKey, "WORKER_SIGNING_KEY_UNAVAILABLE");
  const responseHash = hash(observed.text);
  const canonical = [
    "dev-gateway-assistant-attestation/v1", binding.workerId,
    binding.ownerChannel, work.commandId, work.eventId, work.challenge,
    work.correlationId, binding.principalFingerprint, stored.runId,
    stored.sessionKey, observed.messageId, responseHash,
  ].join("\n");
  return {
    version: 1, transport: "openclaw-gateway",
    workerId: binding.workerId, commandId: work.commandId,
    eventId: work.eventId, correlationId: work.correlationId,
    challenge: work.challenge, accountAlias: "GPT02",
    provider: binding.provider, principalFingerprint: binding.principalFingerprint,
    runId: stored.runId, sessionKey: stored.sessionKey,
    assistantMessageId: observed.messageId,
    assistantResponseHash: responseHash,
    assistantResponseText: observed.text,
    signature: sign(null, Buffer.from(canonical), privateKey).toString("base64"),
  };
}
export function verifyReceipt(receipt, publicKey, expected) {
  ensure(receipt && expected && publicKey, "ATTESTATION_INVALID");
  const keys = ["workerId", "commandId", "eventId", "challenge",
    "correlationId", "principalFingerprint", "runId", "sessionKey",
    "assistantMessageId", "assistantResponseHash"];
  ensure(receipt.version === 1 && receipt.transport === "openclaw-gateway" &&
    receipt.accountAlias === "GPT02" &&
    expected.provider === receipt.provider &&
    keys.every(key => receipt[key] === expected[key]) &&
    typeof receipt.assistantResponseText === "string" &&
    receipt.assistantResponseText.length > 0 &&
    receipt.assistantResponseText.length <= 4000 &&
    hash(receipt.assistantResponseText) === receipt.assistantResponseHash &&
    typeof receipt.signature === "string", "ATTESTATION_CONTEXT_MISMATCH");
  const canonical = [
    "dev-gateway-assistant-attestation/v1", receipt.workerId,
    expected.ownerChannel, receipt.commandId, receipt.eventId,
    receipt.challenge, receipt.correlationId, receipt.principalFingerprint,
    receipt.runId, receipt.sessionKey, receipt.assistantMessageId,
    receipt.assistantResponseHash,
  ].join("\n");
  ensure(verify(null, Buffer.from(canonical), publicKey,
    Buffer.from(receipt.signature, "base64")), "ATTESTATION_SIGNATURE_INVALID");
  return true;
}
function validateState(state) {
  ensure(state && VALID_STATES.has(state.status), "INVALID_BRIDGE_STATE");
  return state;
}
/**
 * The durable store must atomically reserve an event before any gateway call.
 * A subsequent invocation NEVER redispatches existing RESERVED/UNKNOWN events.
 */
export async function dispatchOnce({ work, binding, gateway, store }) {
  validateTrustedBinding(binding);
  validateJob(work, binding);
  // Auth must be independently checked by the Gateway adapter, not the work payload.
  assertPrincipal(await gateway.identity(), binding);
  const key = runKey(work, binding);
  const sessionKey = gatewaySessionKey(binding, work);
  const request = trustedRequest(work, binding);
  const requestHash = hash(request);
  const reservation = await store.reserve(key, {
    status: "RESERVED", key, commandId: work.commandId,
    eventId: work.eventId, challenge: work.challenge,
    correlationId: work.correlationId, requestHash,
    ownerChannel: binding.ownerChannel,
    targetConversationId: binding.targetConversationId,
    principalFingerprint: binding.principalFingerprint,
    gatewayAgentId: binding.gatewayAgentId, provider: binding.provider,
    sessionKey, runId: null,
  });
  ensure(reservation?.record, "DURABLE_RESERVATION_UNAVAILABLE");
  const reserved = validateState(reservation.record);
  ensure(reserved.commandId === work.commandId &&
    reserved.eventId === work.eventId &&
    reserved.challenge === work.challenge &&
    reserved.correlationId === work.correlationId &&
    reserved.requestHash === requestHash &&
    reserved.ownerChannel === binding.ownerChannel &&
    reserved.targetConversationId === binding.targetConversationId &&
    reserved.principalFingerprint === binding.principalFingerprint &&
    reserved.gatewayAgentId === binding.gatewayAgentId &&
    reserved.provider === binding.provider &&
    reserved.sessionKey === sessionKey,
  "EVENT_REUSE_CONTEXT_MISMATCH");
  if (!reservation.created) {
    return { status: reserved.status, deduplicated: true, key };
  }
  try {
    const response = await gateway.send({
      sessionKey, idempotencyKey: key,
      agentId: binding.gatewayAgentId,
      text: request,
    });
    ensure(response?.accepted === true && UUID.test(response.runId) &&
      response.sessionKey === sessionKey, "GATEWAY_ACCEPTANCE_UNVERIFIED");
    await store.transition(key, "RESERVED", "SUBMITTED", { runId: response.runId });
    return { status: "SUBMITTED", key, runId: response.runId };
  } catch {
    // A send could have been accepted before the connection died.
    await store.transition(key, "RESERVED", "SUBMISSION_UNKNOWN", {});
    return { status: "SUBMISSION_UNKNOWN", key, requiresReconciliation: true };
  }
}
/** Read-only recovery for an existing idempotency key; NEVER calls send(). */
export async function reconcile({ work, binding, gateway, store, callback, privateKey }) {
  validateTrustedBinding(binding);
  validateJob(work, binding);
  assertPrincipal(await gateway.identity(), binding);
  const key = runKey(work, binding);
  let existing = validateState(await store.read(key));
  ensure(existing.commandId === work.commandId &&
    existing.eventId === work.eventId &&
    existing.challenge === work.challenge &&
    existing.correlationId === work.correlationId &&
    existing.requestHash === hash(trustedRequest(work, binding)) &&
    existing.ownerChannel === binding.ownerChannel &&
    existing.targetConversationId === binding.targetConversationId &&
    existing.principalFingerprint === binding.principalFingerprint &&
    existing.gatewayAgentId === binding.gatewayAgentId &&
    existing.provider === binding.provider &&
    existing.sessionKey === gatewaySessionKey(binding, work),
  "RECONCILIATION_CONTEXT_MISMATCH");
  if (existing.status === "RESERVED" || existing.status === "SUBMISSION_UNKNOWN") {
    const found = await gateway.lookup(key); // official read-only idempotency lookup
    if (!found || found.accepted !== true || !UUID.test(found.runId) ||
      found.sessionKey !== existing.sessionKey) {
      return { status: "SUBMISSION_UNKNOWN", requiresReconciliation: true };
    }
    await store.transition(key, existing.status, "SUBMITTED", { runId: found.runId });
    existing = validateState(await store.read(key));
  }
  if (existing.status === "SUBMITTED") {
    const result = await gateway.observe({
      runId: existing.runId, sessionKey: existing.sessionKey,
    });
    if (result?.status === "running") return { status: "SUBMITTED" };
    assertReply(result, existing, work, binding);
    const receipt = signedReceipt(work, binding, existing, result, privateKey);
    await store.transition(key, "SUBMITTED", "REPLY_VERIFIED", { receipt });
    existing = validateState(await store.read(key));
  }
  if (existing.status === "REPLY_VERIFIED") {
    // Commit the ambiguity barrier BEFORE any external callback. On a crash or
    // lost response, later calls may only query callback.lookup(), never re-send.
    await store.transition(key, "REPLY_VERIFIED", "CALLBACK_UNKNOWN", {});
    try {
      const answer = await callback.submit({ key, receipt: existing.receipt });
      if (answer?.accepted === true && answer.eventId === work.eventId &&
        answer.commandId === work.commandId) {
        await store.transition(key, "CALLBACK_UNKNOWN", "CALLBACK_ACCEPTED", {});
      } else {
        return { status: "CALLBACK_UNKNOWN", requiresReconciliation: true };
      }
    } catch {
      return { status: "CALLBACK_UNKNOWN", requiresReconciliation: true };
    }
    existing = validateState(await store.read(key));
  }
  if (existing.status === "CALLBACK_UNKNOWN") {
    const looked = await callback.lookup(key); // read only, no callback replay
    if (looked?.accepted !== true || looked.eventId !== work.eventId ||
      looked.commandId !== work.commandId) {
      return { status: "CALLBACK_UNKNOWN", requiresReconciliation: true };
    }
    await store.transition(key, "CALLBACK_UNKNOWN", "CALLBACK_ACCEPTED", {});
    existing = validateState(await store.read(key));
  }
  if (existing.status === "CALLBACK_ACCEPTED") {
    const ack = await callback.readFinalAck(key); // separate server-side ACK check
    if (ack?.state !== "COMPLETED" || ack.eventId !== work.eventId ||
      ack.commandId !== work.commandId ||
      ack.attestationVerified !== true) {
      return { status: "CALLBACK_ACCEPTED", finalAckVerified: false };
    }
    await store.transition(key, "CALLBACK_ACCEPTED", "FINAL_ACK", { ackId: ack.ackId });
    return { status: "FINAL_ACK", finalAckVerified: true };
  }
  return { status: existing.status, finalAckVerified: existing.status === "FINAL_ACK" };
}
