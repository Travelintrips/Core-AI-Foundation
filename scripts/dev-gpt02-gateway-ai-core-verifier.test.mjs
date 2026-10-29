import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { verifyGatewayCallbackEvidence, verifyPersistedFinalAck } from "./dev-gpt02-gateway-ai-core-verifier.mjs";

const digest = x => createHash("sha256").update(x).digest("hex");
const uuid = "12345678-1234-4234-8234-123456789abc";
function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const binding = {
    accountAlias: "GPT02", workerId: "openclaw-dell-chatgpt-wake-dev",
    ownerChannel: "ai-engine-oauth:" + "a".repeat(64),
    targetConversationId: uuid, gatewayAgentId: "gpt02-dell-dev",
    provider: "openai", principalFingerprint: "b".repeat(64),
    credentialStatus: "VERIFIED",
    proofSource: "authorized-provider-identity-check", proofId: uuid,
    signingKeyId: "dev-gateway-key-1",
  };
  const expected = {
    devOnly: true, workerId: binding.workerId, ownerChannel: binding.ownerChannel,
    targetConversationId: binding.targetConversationId, gatewayAgentId: binding.gatewayAgentId,
    trustedProofId: binding.proofId, signingKeyId: binding.signingKeyId,
    commandId: uuid, eventId: "c".repeat(64), challenge: "d".repeat(64),
    correlationId: "ai-task:test:1:abcdefgh",
    runId: uuid, sessionKey: "agent:gpt02-dell-dev:ai-task-dev-test",
    assistantMessageId: uuid,
  };
  const text = "Synthetic test result [AI_CORE_ATTEST_ACK:" + expected.challenge + "]";
  expected.assistantResponseHash = digest(text);
  const receipt = {
    version: 1, transport: "openclaw-gateway", accountAlias: "GPT02",
    workerId: binding.workerId, provider: binding.provider,
    principalFingerprint: binding.principalFingerprint,
    commandId: expected.commandId, eventId: expected.eventId,
    challenge: expected.challenge, correlationId: expected.correlationId,
    runId: expected.runId, sessionKey: expected.sessionKey,
    assistantMessageId: expected.assistantMessageId,
    assistantResponseHash: expected.assistantResponseHash,
    assistantResponseText: text,
  };
  const canonical = [
    "dev-gateway-assistant-attestation/v1", receipt.workerId,
    binding.ownerChannel, receipt.commandId, receipt.eventId,
    receipt.challenge, receipt.correlationId, receipt.principalFingerprint,
    receipt.runId, receipt.sessionKey, receipt.assistantMessageId,
    receipt.assistantResponseHash,
  ].join("\n");
  receipt.signature = sign(null, Buffer.from(canonical), privateKey).toString("base64");
  const identity = {
    authenticated: true, source: "gateway-credential-store",
    provider: binding.provider, gatewayAgentId: binding.gatewayAgentId,
    principalFingerprint: binding.principalFingerprint,
  };
  return { binding, expected, receipt, publicKey, identity };
}
const check = x => verifyGatewayCallbackEvidence(x);
test("synthetic correctly bound signed receipt verifies (not live E2E)", () => {
  assert.equal(check(fixture()).verified, true);
});
for (const [name, mutate] of [
  ["wrong event", f => { f.receipt.eventId = "f".repeat(64); }],
  ["wrong run", f => { f.receipt.runId = "f".repeat(36); }],
  ["wrong session", f => { f.receipt.sessionKey = "different"; }],
  ["wrong command", f => { f.receipt.commandId = "f".repeat(36); }],
  ["wrong challenge", f => { f.receipt.challenge = "f".repeat(64); }],
  ["wrong principal", f => { f.identity.principalFingerprint = "f".repeat(64); }],
  ["wrong provider", f => { f.identity.provider = "another"; }],
  ["untrusted binding", f => { f.expected.trustedProofId = "bad"; }],
  ["altered text", f => { f.receipt.assistantResponseText += "tampered"; }],
  ["altered signature", f => { f.receipt.signature = "AAAA"; }],
  ["wrong expected message", f => { f.expected.assistantMessageId = "other"; }],
  ["not dev", f => { f.expected.devOnly = false; }],
  ["wrong pinned signing key", f => { f.binding.signingKeyId = "another-key"; }],
]) {
  test("rejects " + name, () => {
    const f = fixture(); mutate(f);
    assert.throws(() => check(f));
  });
}
test("Final ACK requires separate verified persisted server outcome", () => {
  const f = fixture(), evidence = check(f);
  assert.throws(() => verifyPersistedFinalAck({
    evidence, expected: f.expected,
    ack: { state: "COMPLETED", attestationVerified: true, eventId: f.expected.eventId, commandId: f.expected.commandId },
  }));
  const ack = {
    state: "COMPLETED", attestationVerified: true, transport: "openclaw-gateway",
    eventId: f.expected.eventId, commandId: f.expected.commandId, ackId: uuid,
    runId: f.expected.runId, sessionKey: f.expected.sessionKey,
    assistantResponseHash: f.expected.assistantResponseHash, signingKeyId: f.expected.signingKeyId,
  };
  assert.equal(verifyPersistedFinalAck({ evidence, expected: f.expected, ack }).finalAckVerified, true);
});

test("Final ACK rejects mismatched run, session, response hash, signing key", () => {
  const f = fixture(), evidence = check(f);
  const ack = {state:"COMPLETED",attestationVerified:true,transport:"openclaw-gateway",
    eventId:f.expected.eventId,commandId:f.expected.commandId,ackId:uuid,
    runId:f.expected.runId,sessionKey:f.expected.sessionKey,
    assistantResponseHash:f.expected.assistantResponseHash,signingKeyId:f.expected.signingKeyId};
  for (const key of ["runId","sessionKey","assistantResponseHash","signingKeyId"]) {
    assert.throws(() => verifyPersistedFinalAck({ack:{...ack,[key]:"incorrect"},evidence,expected:f.expected}),/GATEWAY_FINAL_ACK_NOT_VERIFIED/);
  }
});
