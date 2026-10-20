import test from "node:test";
import assert from "node:assert/strict";
import { bindingFingerprint, assistantChallenge, localBindings, resolveWorkBinding, execute, workerId } from "./dell-wake-executor.mjs";

const owner = "ai-engine-oauth:" + "a".repeat(64);
const ownerTwo = "ai-engine-oauth:" + "d".repeat(64);
const conversation = "6ad3a9a6-97e4-83ec-af32-a0a5d580b649";
const conversationTwo = "22222222-2222-4222-8222-222222222222";
const eventId = "b".repeat(64);
const legacy = {
  version: 1, accountAlias: "GPT01", ownerChannel: owner, targetConversationId: conversation,
  workerId, browserProfile: "openclaw", enabled: true,
};
const binding = {
  version: 1, accountAlias: "GPT02", ownerChannel: ownerTwo, targetConversationId: conversationTwo,
  workerId, browserProfile: "travelincars-dev",
};
binding.bindingFingerprint = bindingFingerprint(binding);

function pairings() {
  return { enabled: true, allowedConversationIds: [conversation],
    legacyBinding: structuredClone(legacy), bindings: [{ ...binding, enabled: true }] };
}
function work(target = binding) {
  const metadata = {
    assignedClientId: workerId, conversationId: target.ownerChannel,
    targetConversationId: target.targetConversationId, eventId,
    capability: "chatgpt:wake", explicitWorkerTarget: true,
    source: "authorized-dev-browser-wake", devOnly: true,
    ...(target.accountAlias !== "GPT01" ? { wakeBinding: { ...target } } : {}),
  };
  metadata.assistantAttestationChallenge = assistantChallenge(metadata, metadata.wakeBinding?.bindingFingerprint);
  return {
    commandType: "EXTERNAL_AGENT_WORK",
    instruction: "DEV_CHATGPT_WAKE_V1 conversation=" + metadata.targetConversationId +
      " event=" + eventId + " challenge=" + metadata.assistantAttestationChallenge,
    metadata,
  };
}
function receiptFor(job) {
  const metadata = job.metadata;
  const bound = metadata.wakeBinding;
  const profile = bound?.browserProfile || "openclaw";
  return {
    ok: true, verifiedAssistantReply: true, browserPairingVerified: true,
    chatgptSubmitted: true, browserConfirmed: true,
    conversationId: metadata.targetConversationId, eventId,
    challenge: metadata.assistantAttestationChallenge,
    browserProfile: profile, assistantResponseText: "Unit-test-only assistant receipt",
    ...(bound ? { bindingFingerprint: bound.bindingFingerprint } : {}),
    attestation: {
      version: bound ? 2 : 1, algorithm: "Ed25519",
      keyId: workerId + "-ed25519-v1", workerId,
      conversationId: metadata.targetConversationId, eventId,
      challenge: metadata.assistantAttestationChallenge,
      assistantMessageId: "44444444-4444-4444-8444-444444444444",
      assistantResponseHash: "f".repeat(64), observedAt: "2026-10-20T00:00:00.000Z",
      signature: Buffer.alloc(64).toString("base64"),
      ...(bound ? { bindingFingerprint: bound.bindingFingerprint, browserProfile: profile } : {}),
    },
  };
}
function runtime(spawn, config = pairings()) {
  return { root: "/test-only/AI-Core", helper: "/test-only/helper.py", python: "python-test-only",
    readPairings: () => config, spawn };
}

test("canonical binding/challenge vectors match the cross-language protocol", () => {
  assert.equal(bindingFingerprint(binding), "4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1");
  const metadata = work().metadata;
  assert.equal(assistantChallenge(metadata, binding.bindingFingerprint),
    "2a4c9bcdf77cb321930750a835f29cd065d70c1ea8b20f8a4c302853b6267a2a");
  assert.equal(assistantChallenge({ ...metadata, watchCommandId: "55555555-5555-4555-8555-555555555555",
    jobId: "66666666-6666-4666-8666-666666666666", checkpointRevision: 7 }, binding.bindingFingerprint),
  "79960f0819bca525e9f2930fc13b4c94b538c06fc0860686b4d051f84d53feec");
});

test("GPT01 keeps its explicit legacy tuple and v1 attestation", () => {
  const result = resolveWorkBinding(work(legacy), pairings());
  assert.equal(result.browserProfile, "openclaw");
  assert.equal(result.attestationVersion, 1);
  assert.equal(result.wakeBinding, undefined);
});

test("legacy allowlist alone cannot authorize any DELL account", () => {
  for (const job of [work(legacy), work()]) {
    assert.throws(() => resolveWorkBinding(job, { enabled: true,
      allowedConversationIds: [conversation, conversationTwo] }), /Exact local/);
  }
});

test("new account cannot fall back to legacy when wakeBinding is missing or invalid", () => {
  for (const value of [undefined, null, {}, []]) {
    const job = work();
    if (value === undefined) delete job.metadata.wakeBinding;
    else job.metadata.wakeBinding = value;
    assert.throws(() => resolveWorkBinding(job, pairings()));
  }
});

test("mismatched owner, target, worker, profile, or fingerprint never starts Python", () => {
  const mutations = [
    job => { job.metadata.conversationId = owner; },
    job => { job.metadata.wakeBinding.ownerChannel = owner; },
    job => { job.metadata.wakeBinding.targetConversationId = conversation; },
    job => { job.metadata.wakeBinding.workerId = "openclaw-travelintrips-dev"; },
    job => { job.metadata.wakeBinding.browserProfile = "openclaw"; },
    job => { job.metadata.wakeBinding.bindingFingerprint = "0".repeat(64); },
    job => { job.metadata.assignedClientId = "other-worker"; },
    job => { job.metadata.devOnly = false; },
    job => { job.metadata.explicitWorkerTarget = false; },
    job => { job.instruction += " && delete files"; },
    job => { job.instruction += " task=aGVsbG8"; },
    job => { job.instruction = job.instruction.replace("_V1 ", "_V2 "); },
    job => { job.commandType = "OTHER"; },
  ];
  for (const mutate of mutations) {
    const job = work();
    mutate(job);
    const result = execute(job, runtime(() => assert.fail("Python must not run")));
    assert.equal(result.ok, false);
    assert.equal(result.details.reason, "binding_mismatch");
  }
});

test("disabled, changed, malformed and conflicting local registry is fail-closed", () => {
  const configurations = [];
  for (const field of ["enabled", "ownerChannel", "targetConversationId", "browserProfile"]) {
    const config = pairings();
    config.bindings[0][field] = { enabled: false, ownerChannel: owner,
      targetConversationId: conversation, browserProfile: "changed-profile" }[field];
    delete config.bindings[0].bindingFingerprint;
    configurations.push(config);
  }
  const duplicate = pairings();
  duplicate.bindings.push({ ...binding, accountAlias: "GPT03", ownerChannel: "ai-engine-oauth:" + "e".repeat(64),
    targetConversationId: "33333333-3333-4333-8333-333333333333", browserProfile: "TRAVELINCARS-DEV", enabled: false });
  delete duplicate.bindings[1].bindingFingerprint;
  configurations.push(duplicate, { ...pairings(), bindings: {} });
  for (const field of ["accountAlias", "ownerChannel", "targetConversationId", "browserProfile"]) {
    const invalid = pairings();
    delete invalid.bindings[0].bindingFingerprint;
    invalid.bindings[0][field] += "\n";
    configurations.push(invalid);
  }
  for (const config of configurations) {
    assert.throws(() => resolveWorkBinding(work(), config));
  }
  const aliasConflict = pairings();
  aliasConflict.bindings[0].accountAlias = "GPT01";
  assert.throws(() => localBindings(aliasConflict));
});

test("helper receives the exact selected profile and full metadata", () => {
  for (const target of [legacy, binding]) {
    const job = work(target);
    let observed;
    const result = execute(job, runtime((python, args, options) => {
      observed = { python, args, options };
      return { status: 0, stdout: JSON.stringify(receiptFor(job)) };
    }));
    assert.equal(result.ok, true);
    assert.equal(observed.options.env.AI_CORE_DEV_WAKE_BROWSER_PROFILE, target.browserProfile);
    assert.deepEqual(JSON.parse(observed.options.input).metadata, job.metadata);
    assert.equal(result.details.browserProfile, target.browserProfile);
  }
});

test("helper success flags do not substitute for matching signed binding fields", () => {
  const mutations = [
    receipt => { receipt.attestation.version = 1; },
    receipt => { receipt.browserProfile = "openclaw"; },
    receipt => { receipt.attestation.browserProfile = "openclaw"; },
    receipt => { receipt.bindingFingerprint = "0".repeat(64); },
    receipt => { receipt.attestation.bindingFingerprint = "0".repeat(64); },
    receipt => { receipt.attestation.workerId = "other-worker"; },
    receipt => { receipt.attestation.conversationId = conversation; },
    receipt => { receipt.attestation.challenge = "0".repeat(64); },
    receipt => { receipt.attestation.signature = ""; },
    receipt => { receipt.browserConfirmed = false; },
  ];
  for (const mutate of mutations) {
    const job = work();
    const receipt = receiptFor(job);
    mutate(receipt);
    const result = execute(job, runtime(() => ({ status: 0, stdout: JSON.stringify(receipt) })));
    assert.equal(result.ok, false);
    assert.equal(result.details.verified, false);
  }
  const legacyJob = work(legacy);
  const legacyReceipt = receiptFor(legacyJob);
  legacyReceipt.attestation.browserProfile = "openclaw";
  assert.equal(execute(legacyJob, runtime(() => ({ status: 0, stdout: JSON.stringify(legacyReceipt) }))).ok, false);
});

test("challenge tampering and incomplete continuity context are rejected before Python", () => {
  const job = work();
  job.metadata.checkpointRevision = 1;
  assert.equal(execute(job, runtime(() => assert.fail("must not spawn"))).ok, false);
  const changed = work();
  changed.metadata.assistantAttestationChallenge = "c".repeat(64);
  changed.instruction = changed.instruction.replace(/challenge=[a-f0-9]{64}/, "challenge=" + "c".repeat(64));
  assert.throws(() => resolveWorkBinding(changed, pairings()), /challenge/);
});

