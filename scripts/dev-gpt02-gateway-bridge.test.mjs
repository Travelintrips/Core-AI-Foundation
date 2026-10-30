import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  BridgeViolation, dispatchOnce, reconcile, runKey,
  gatewaySessionKey, validateTrustedBinding, validateJob, verifyReceipt,
} from "./dev-gpt02-gateway-bridge.mjs";

const commandId = "86c0ad23-f85a-41bf-a582-13d165fcc9b8";
const runId = "11111111-2222-4333-8444-555555555555";
const messageId = "22222222-3333-4333-8444-555555555555";
const ackId = "33333333-4444-4333-8444-555555555555";
const owner = "ai-engine-oauth:" + "c".repeat(64);
const binding = {
  accountAlias: "GPT02",
  workerId: "openclaw-dell-chatgpt-wake-dev",
  ownerChannel: owner,
  targetConversationId: "6adc4295-e2ac-83ec-a1e1-2aea7d0c1326",
  gatewayAgentId: "gpt02-approved",
  provider: "openai",
  principalFingerprint: "d".repeat(64),
  credentialStatus: "VERIFIED",
  proofSource: "authorized-provider-identity-check",
  proofId: "44444444-5555-4333-8444-555555555555",
};
const work = {
  commandId, eventId: "a".repeat(64), challenge: "b".repeat(64),
  correlationId: "ai-task:task-118:1:unique-a06",
  accountAlias: "GPT02", workerId: binding.workerId,
  ownerChannel: owner, targetConversationId: binding.targetConversationId,
  devOnly: true, instruction: "Return the original verified response.",
};
const keys = generateKeyPairSync("ed25519");
const getReply = (b = binding, w = work) => ({
  status: "completed",
  runId, sessionKey: gatewaySessionKey(b, w), provider: b.provider,
  gatewayAgentId: b.gatewayAgentId, principalFingerprint: b.principalFingerprint,
  role: "assistant", final: true, messageId,
  text: "GPT02_DEV_TEST_ONLY [AI_CORE_ATTEST_ACK:" + w.challenge + "]",
});
function fixture({ b = binding, w = work, send = null, observe = null,
  lookup = null, submit = null, ack = null } = {}) {
  const data = new Map();
  const calls = { send: 0, lookup: 0, observe: 0, callback: 0, finalAck: 0, identity: 0 };
  const store = {
    async reserve(key, record) {
      if (data.has(key)) return { created: false, record: structuredClone(data.get(key)) };
      data.set(key, structuredClone(record));
      return { created: true, record: structuredClone(record) };
    },
    async transition(key, from, to, patch) {
      const row = data.get(key);
      if (!row || row.status !== from) throw new Error("CAS_STATE_CONFLICT");
      data.set(key, { ...row, ...patch, status: to });
    },
    async read(key) { return structuredClone(data.get(key)); },
  };
  const gateway = {
    async identity() {
      calls.identity++;
      return {
        authenticated: true, source: "gateway-credential-store",
        gatewayAgentId: b.gatewayAgentId, provider: b.provider,
        principalFingerprint: b.principalFingerprint,
      };
    },
    async send(command) {
      calls.send++;
      assert.equal(command.idempotencyKey, runKey(w, b));
      assert.equal(command.agentId, b.gatewayAgentId);
      assert.equal(command.sessionKey, gatewaySessionKey(b, w));
      assert.ok(command.text.includes("[AI_CORE_WAKE:" + w.eventId + "]"));
      return send ? send(command) : {
        accepted: true, runId, sessionKey: command.sessionKey,
      };
    },
    async lookup(key) {
      calls.lookup++;
      return lookup ? lookup(key) : {
        accepted: true, runId, sessionKey: gatewaySessionKey(b, w),
      };
    },
    async observe() {
      calls.observe++;
      return observe ? observe() : getReply(b, w);
    },
  };
  const callback = {
    async submit({ receipt }) {
      calls.callback++;
      assert.equal(receipt.eventId, w.eventId);
      assert.equal(receipt.signature.length, 88);
      return submit ? submit(receipt) : {
        accepted: true, commandId: w.commandId, eventId: w.eventId,
      };
    },
    async lookup(key) {
      calls.lookup++;
      return { accepted: true, eventId: w.eventId, commandId: w.commandId };
    },
    async readFinalAck() {
      calls.finalAck++;
      return ack ? ack() : {
        state: "COMPLETED", eventId: w.eventId, commandId: w.commandId,
        attestationVerified: true, ackId,
      };
    },
  };
  return { work: w, binding: b, gateway, callback, store, calls, data,
    privateKey: keys.privateKey, publicKey: keys.publicKey };
}
const dispatch = f => dispatchOnce(f);
const recover = f => reconcile(f);
function checkCode(code) {
  return e => e instanceof BridgeViolation && e.code === code;
}
test("one gateway turn, signed reply, authenticated callback and real ACK projection", async () => {
  const f = fixture();
  assert.equal((await dispatch(f)).status, "SUBMITTED");
  const status = await recover(f);
  assert.deepEqual(status, { status: "FINAL_ACK", finalAckVerified: true });
  assert.equal(f.calls.send, 1);
  assert.equal(f.calls.callback, 1);
  assert.equal(f.calls.finalAck, 1);
  const stored = await f.store.read(runKey(f.work, f.binding));
  assert.equal(stored.status, "FINAL_ACK");
  verifyReceipt(stored.receipt, f.publicKey, {
    ...f.work, ownerChannel: f.binding.ownerChannel, runId,
    sessionKey: gatewaySessionKey(f.binding, f.work),
    assistantMessageId: messageId,
    assistantResponseHash: stored.receipt.assistantResponseHash,
    principalFingerprint: f.binding.principalFingerprint,
    provider: f.binding.provider, workerId: f.binding.workerId,
  });
});
test("duplicate job dispatch cannot send twice", async () => {
  const f = fixture();
  await dispatch(f);
  const duplicate = await dispatch(f);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.status, "SUBMITTED");
  assert.equal(f.calls.send, 1);
});
test("unverified GPT02 provider is rejected before reservation", async () => {
  const f = fixture({ b: { ...binding, credentialStatus: "UNKNOWN" } });
  await assert.rejects(dispatch(f), checkCode("GATEWAY_PRINCIPAL_NOT_VERIFIED"));
  assert.equal(f.calls.send, 0);
});
test("provider ai-core is rejected to prevent circular execution", async () => {
  const f = fixture({ b: { ...binding, provider: "ai-core" } });
  await assert.rejects(dispatch(f), checkCode("GATEWAY_PRINCIPAL_NOT_VERIFIED"));
  assert.equal(f.calls.send, 0);
});
test("untrusted proof or missing evidence cannot be interpreted as GPT02", () => {
  assert.throws(() => validateTrustedBinding({ ...binding, proofSource: "caller-metadata" }),
    checkCode("GATEWAY_IDENTITY_EVIDENCE_MISSING"));
  assert.throws(() => validateTrustedBinding({ ...binding, proofId: "" }),
    checkCode("GATEWAY_IDENTITY_EVIDENCE_MISSING"));
});
test("caller owner or worker mismatch rejected", async () => {
  const f = fixture({ w: { ...work, ownerChannel: "ai-engine-oauth:" + "e".repeat(64) } });
  await assert.rejects(dispatch(f), checkCode("BOUND_WORKER_IDENTITY_MISMATCH"));
  assert.equal(f.calls.send, 0);
});
test("live credential mismatch rejected independently of caller fields", async () => {
  const f = fixture();
  f.gateway.identity = async () => ({
    authenticated: true, source: "gateway-credential-store",
    gatewayAgentId: "another-agent", provider: binding.provider,
    principalFingerprint: binding.principalFingerprint,
  });
  await assert.rejects(dispatch(f), checkCode("GATEWAY_CREDENTIAL_IDENTITY_MISMATCH"));
  assert.equal(f.calls.send, 0);
});
test("send timeout is ambiguous, never auto replay, lookup only", async () => {
  const f = fixture({ send: () => { throw new Error("NETWORK_LOST_AFTER_ACCEPT"); } });
  assert.equal((await dispatch(f)).status, "SUBMISSION_UNKNOWN");
  assert.equal((await dispatch(f)).deduplicated, true);
  assert.equal(f.calls.send, 1);
  const recovered = await recover(f);
  assert.equal(recovered.status, "FINAL_ACK");
  assert.equal(f.calls.send, 1);
  assert.equal(f.calls.lookup, 1);
});
test("unresolved submission stays blocked, no repeated send", async () => {
  const f = fixture({
    send: () => { throw new Error("AMBIGUOUS"); },
    lookup: () => null,
  });
  await dispatch(f);
  assert.equal((await recover(f)).status, "SUBMISSION_UNKNOWN");
  assert.equal(f.calls.send, 1);
  assert.equal(f.calls.callback, 0);
});
test("assistant marker must exist in final assistant reply, not the user prompt", async () => {
  const f = fixture({ observe: () => ({ ...getReply(), text: "No signed ACK." }) });
  await dispatch(f);
  await assert.rejects(recover(f), checkCode("MISSING_EXACT_ASSISTANT_ACK"));
  assert.equal(f.calls.callback, 0);
  assert.equal((await f.store.read(runKey(work, binding))).status, "SUBMITTED");
});
test("wrong model principal, run id or role never attested", async () => {
  for (const patch of [
    { principalFingerprint: "e".repeat(64) },
    { runId: "55555555-5555-4555-8555-555555555555" },
    { role: "user" }, { final: false },
  ]) {
    const f = fixture({ observe: () => ({ ...getReply(), ...patch }) });
    await dispatch(f);
    await assert.rejects(recover(f), checkCode("GATEWAY_REPLY_CONTEXT_INVALID"));
    assert.equal(f.calls.callback, 0);
  }
});
test("duplicate ACK in assistant response is not accepted", async () => {
  const f = fixture({ observe: () => {
    const r = getReply();
    r.text += " [AI_CORE_ATTEST_ACK:" + work.challenge + "]";
    return r;
  } });
  await dispatch(f);
  await assert.rejects(recover(f), checkCode("MISSING_EXACT_ASSISTANT_ACK"));
});
test("tampered signature never validates", async () => {
  const f = fixture();
  await dispatch(f);
  await recover(f);
  const stored = await f.store.read(runKey(work,binding));
  const expected = {
    ...work, ownerChannel: binding.ownerChannel, provider: binding.provider,
    workerId: binding.workerId, principalFingerprint: binding.principalFingerprint,
    runId, sessionKey: gatewaySessionKey(binding, work),
    assistantMessageId: messageId,
    assistantResponseHash: stored.receipt.assistantResponseHash,
  };
  assert.throws(() => verifyReceipt({
    ...stored.receipt,
    signature: (stored.receipt.signature.startsWith("A") ? "B" : "A") +
      stored.receipt.signature.slice(1),
  }, f.publicKey, expected), checkCode("ATTESTATION_SIGNATURE_INVALID"));
});
test("callback timeout requires lookup, never repeat callback", async () => {
  const f = fixture({ submit: () => { throw new Error("POST_TIMED_OUT"); } });
  await dispatch(f);
  assert.equal((await recover(f)).status, "CALLBACK_UNKNOWN");
  assert.equal(f.calls.callback, 1);
  assert.equal((await recover(f)).status, "FINAL_ACK");
  assert.equal(f.calls.callback, 1);
});
test("AI Core ACK must confirm attestation; callback receipt alone is not final", async () => {
  const f = fixture({ ack: () => ({
    state: "COMPLETED", commandId: work.commandId, eventId: work.eventId,
    attestationVerified: false, ackId,
  }) });
  await dispatch(f);
  assert.deepEqual(await recover(f), {
    status: "CALLBACK_ACCEPTED", finalAckVerified: false,
  });
  assert.equal((await f.store.read(runKey(work,binding))).status, "CALLBACK_ACCEPTED");
});
test("gateway still running cannot mark completed", async () => {
  const f = fixture({ observe: () => ({ status: "running" }) });
  await dispatch(f);
  assert.deepEqual(await recover(f), { status: "SUBMITTED" });
  assert.equal(f.calls.callback, 0);
});
test("no live system, old job or production activity is invoked by import", async () => {
  const f = fixture();
  assert.equal(f.data.size, 0);
  assert.equal(f.calls.send, 0);
  assert.equal(f.calls.callback, 0);
  assert.equal(f.calls.finalAck, 0);
});


test("parallel duplicate dispatches share one durable reservation and only one send", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 12 }, () => dispatch(f)));
  assert.equal(f.calls.send, 1);
  assert.equal(results.filter(r => r.deduplicated).length, 11);
  assert.equal(results.filter(r => r.status === "SUBMITTED").length >= 1, true);
});
test("gateway completion with different session must not create receipt", async () => {
  const f = fixture({ observe: () => ({ ...getReply(), sessionKey: "agent:wrong:session" }) });
  await dispatch(f);
  await assert.rejects(recover(f), checkCode("GATEWAY_REPLY_CONTEXT_INVALID"));
  assert.equal(f.calls.callback, 0);
});
test("callback acceptance without exact commandId must remain unknown", async () => {
  const f = fixture({
    submit: () => ({
      accepted: true, commandId: "99999999-9999-4999-8999-999999999999",
      eventId: work.eventId,
    }),
  });
  await dispatch(f);
  assert.equal((await recover(f)).status, "CALLBACK_UNKNOWN");
  assert.equal(f.calls.callback, 1);
});
test("signed receipt content cannot change without hash verification failure", async () => {
  const f = fixture();
  await dispatch(f);
  await recover(f);
  const stored = await f.store.read(runKey(work,binding));
  const expected = {
    ...work, ownerChannel: binding.ownerChannel, provider: binding.provider,
    workerId: binding.workerId, principalFingerprint: binding.principalFingerprint,
    runId, sessionKey: gatewaySessionKey(binding, work),
    assistantMessageId: messageId,
    assistantResponseHash: stored.receipt.assistantResponseHash,
  };
  assert.throws(() => verifyReceipt({
    ...stored.receipt, assistantResponseText: "different",
  }, f.publicKey, expected), checkCode("ATTESTATION_CONTEXT_MISMATCH"));
});
test("final ACK on a different event or command is never marked complete", async () => {
  for (const ackPatch of [
    { eventId: "f".repeat(64) },
    { commandId: "99999999-9999-4999-8999-999999999999" },
    { state: "FAILED" },
  ]) {
    const f = fixture({ ack: () => ({
      state: "COMPLETED", eventId: work.eventId,
      commandId: work.commandId, attestationVerified: true,
      ackId, ...ackPatch,
    }) });
    await dispatch(f);
    assert.deepEqual(await recover(f), {
      status: "CALLBACK_ACCEPTED", finalAckVerified: false,
    });
  }
});

test("same event with different command ID cannot create a second Gateway submission", async () => {
  const f = fixture();
  await dispatch(f);
  const changed = {
    ...work, commandId: "77777777-7777-4777-8777-777777777777",
  };
  assert.equal(runKey(changed, binding), runKey(work, binding));
  await assert.rejects(dispatch({ ...f, work: changed }),
    checkCode("EVENT_REUSE_CONTEXT_MISMATCH"));
  assert.equal(f.calls.send, 1);
});
test("same event with changed challenge, correlation or payload is refused", async () => {
  for (const patch of [
    { challenge: "f".repeat(64) },
    { correlationId: "ai-task:task-118:1:mutated-a06" },
    { instruction: "A different prompt must not reuse the same send." },
  ]) {
    const f = fixture();
    await dispatch(f);
    await assert.rejects(dispatch({ ...f, work: { ...work, ...patch } }),
      checkCode("EVENT_REUSE_CONTEXT_MISMATCH"));
    assert.equal(f.calls.send, 1);
  }
});
test("reconciliation cannot convert an original send into a new task", async () => {
  const f = fixture();
  await dispatch(f);
  await assert.rejects(recover({
    ...f, work: { ...work, instruction: "Unauthorized replacement instructions" },
  }), checkCode("RECONCILIATION_CONTEXT_MISMATCH"));
  assert.equal(f.calls.send, 1);
  assert.equal(f.calls.callback, 0);
});

test("credential rotation cannot create a second delivery for the same event", async () => {
  const f = fixture();
  await dispatch(f);
  const changed = {
    ...binding, principalFingerprint: "e".repeat(64),
    proofId: "88888888-8888-4888-8888-888888888888",
  };
  const gateway = {
    ...f.gateway,
    async identity() {
      return {
        authenticated: true, source: "gateway-credential-store",
        gatewayAgentId: changed.gatewayAgentId, provider: changed.provider,
        principalFingerprint: changed.principalFingerprint,
      };
    },
  };
  assert.equal(runKey(f.work, binding), runKey(f.work, changed));
  await assert.rejects(dispatch({ ...f, binding: changed, gateway }),
    checkCode("EVENT_REUSE_CONTEXT_MISMATCH"));
  assert.equal(f.calls.send, 1);
});
