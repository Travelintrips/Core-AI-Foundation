/**
 * DEV-only AI Core verifier for Gateway-native signed receipts.
 * NOT an HTTP route, NOT enabled in the running callback handler.
 * Caller MUST load binding and expected event from trusted server storage.
 * Never treat Gateway history or the GPT02 label as provider-account proof.
 */
import { verifyReceipt, validateTrustedBinding, BridgeViolation } from "./dev-gpt02-gateway-bridge.mjs";

function requireCondition(value, code) {
  if (!value) throw new BridgeViolation(code);
}
const FINGERPRINT = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Pure proof validation, with no callbacks, writes or synthetic ACKs.
 * identity must come from an independently authenticated Gateway credential
 * inspection, never from the callback request or history record.
 */
export function verifyGatewayCallbackEvidence({ receipt, expected, binding, identity, publicKey }) {
  validateTrustedBinding(binding);
  requireCondition(expected && typeof expected === "object" && expected.devOnly === true,
    "GATEWAY_DEV_EVENT_REQUIRED");
  requireCondition(identity?.authenticated === true &&
    identity.source === "gateway-credential-store" &&
    identity.provider === binding.provider &&
    identity.gatewayAgentId === binding.gatewayAgentId &&
    identity.principalFingerprint === binding.principalFingerprint &&
    FINGERPRINT.test(identity.principalFingerprint),
    "GATEWAY_PROVIDER_IDENTITY_UNVERIFIED");
  requireCondition(binding.proofSource === "authorized-provider-identity-check" &&
    UUID.test(binding.proofId) &&
    expected.trustedProofId === binding.proofId &&
    expected.ownerChannel === binding.ownerChannel &&
    expected.targetConversationId === binding.targetConversationId &&
    expected.gatewayAgentId === binding.gatewayAgentId,
    "GATEWAY_TRUSTED_BINDING_MISMATCH");
  requireCondition(receipt?.workerId === binding.workerId &&
    receipt?.principalFingerprint === binding.principalFingerprint &&
    receipt?.provider === binding.provider &&
    receipt?.accountAlias === binding.accountAlias &&
    receipt?.sessionKey === expected.sessionKey &&
    receipt?.runId === expected.runId &&
    receipt?.eventId === expected.eventId &&
    receipt?.commandId === expected.commandId &&
    receipt?.challenge === expected.challenge &&
    receipt?.correlationId === expected.correlationId,
    "GATEWAY_CALLBACK_CONTEXT_MISMATCH");
  // Public key must be pinned in AI Core trusted configuration; no
  // public key, credential fingerprint or binding from the request body.
  requireCondition(publicKey && expected.signingKeyId && expected.signingKeyId === binding.signingKeyId,
    "GATEWAY_SIGNING_KEY_NOT_PINNED");
  verifyReceipt(receipt, publicKey, {
    workerId: binding.workerId, ownerChannel: binding.ownerChannel,
    provider: binding.provider, commandId: expected.commandId,
    eventId: expected.eventId, challenge: expected.challenge,
    correlationId: expected.correlationId,
    principalFingerprint: binding.principalFingerprint,
    runId: expected.runId, sessionKey: expected.sessionKey,
    assistantMessageId: expected.assistantMessageId,
    assistantResponseHash: expected.assistantResponseHash,
  });
  requireCondition(receipt.assistantResponseText.split(
    "[AI_CORE_ATTEST_ACK:" + expected.challenge + "]").length === 2,
    "GATEWAY_ASSISTANT_CHALLENGE_MISMATCH");
  return Object.freeze({
    verified: true, transport: "openclaw-gateway",
    eventId: expected.eventId, commandId: expected.commandId,
    runId: expected.runId, sessionKey: expected.sessionKey,
    signingKeyId: expected.signingKeyId,
  });
}

/**
 * This is deliberately NOT a Final ACK issuer.
 * A separate authenticated AI Core server transaction must commit
 * the callback idempotently and return its own persisted finalization result.
 */
export function verifyPersistedFinalAck({ ack, evidence, expected }) {
  requireCondition(evidence?.verified === true && expected &&
    evidence.eventId === expected.eventId &&
    evidence.commandId === expected.commandId &&
    evidence.runId === expected.runId &&
    evidence.sessionKey === expected.sessionKey &&
    evidence.signingKeyId === expected.signingKeyId,
    "GATEWAY_CALLBACK_NOT_VERIFIED");
  requireCondition(ack?.state === "COMPLETED" &&
    ack?.attestationVerified === true &&
    ack?.eventId === expected.eventId &&
    ack?.commandId === expected.commandId &&
    ack?.runId === expected.runId &&
    ack?.sessionKey === expected.sessionKey &&
    ack?.assistantResponseHash === expected.assistantResponseHash &&
    ack?.signingKeyId === expected.signingKeyId &&
    ack?.transport === "openclaw-gateway" &&
    typeof ack.ackId === "string" && ack.ackId.length > 0,
    "GATEWAY_FINAL_ACK_NOT_VERIFIED");
  return Object.freeze({ finalAckVerified: true, ackId: ack.ackId });
}
