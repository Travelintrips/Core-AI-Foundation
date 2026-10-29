/**
 * Isolated DEV callback gate. Never imports an HTTP route or sends a model turn.
 * All ports are injected and MUST use trusted server-side storage and authenticated
 * providers. A callback receipt is not proof of a ChatGPT web identity.
 */
import { verifyGatewayCallbackEvidence, verifyPersistedFinalAck } from "./dev-gpt02-gateway-ai-core-verifier.mjs";
import { BridgeViolation } from "./dev-gpt02-gateway-bridge.mjs";
const fail = code => { throw new BridgeViolation(code); };
export async function acceptGatewayCallback({ receipt, eventId, trusted, ledger }) {
  if (!trusted || !ledger || !eventId || !receipt || receipt.eventId !== eventId) fail("GATEWAY_CALLBACK_INVALID");
  // Every trusted input below comes from server-side registry/DB, not callback body.
  const record = await trusted.loadEvent(eventId);
  if (!record || record.devOnly !== true || record.eventId !== eventId) fail("GATEWAY_TRUSTED_EVENT_MISSING");
  const binding = await trusted.loadBinding(record.workerId);
  if (!binding || binding.workerId !== record.workerId) fail("GATEWAY_TRUSTED_BINDING_MISSING");
  const identity = await trusted.inspectGatewayCredential(binding.gatewayAgentId);
  const publicKey = await trusted.loadPinnedSigningKey(binding.signingKeyId);
  if (!publicKey) fail("GATEWAY_PINNED_KEY_MISSING");
  const evidence = verifyGatewayCallbackEvidence({
    receipt, expected: record, binding, identity, publicKey,
  });
  // Atomic compare-and-set, unique by eventId and commandId. Must never run
  // an external callback twice after a lost response.
  // The implementation of this port MUST use a DB transaction with a unique
  // eventId+commandId constraint and immutable receipt fingerprint. On replay,
  // it may return the prior matching row, but must never create another effect.
  const saved = await ledger.acceptVerifiedEvidence(evidence, receipt);
  if (!saved || saved.eventId !== eventId || saved.commandId !== record.commandId ||
    saved.attestationVerified !== true ||
    saved.runId !== record.runId || saved.sessionKey !== record.sessionKey ||
    saved.assistantResponseHash !== record.assistantResponseHash ||
    saved.signingKeyId !== record.signingKeyId) fail("GATEWAY_CALLBACK_PERSISTENCE_UNVERIFIED");
  // No fabricated ACK: only the separately committed server result qualifies.
  const ack = await ledger.readFinalAck(eventId);
  if (!ack) return { status: "CALLBACK_ACCEPTED", finalAckVerified: false };
  return { status: "FINAL_ACK", ...verifyPersistedFinalAck({ ack, evidence, expected: record }) };
}
