import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { bindingFingerprint, assistantChallenge, localBindings, resolveWorkBinding, execute, workerId,
  BoundClaimLease, executeBoundClaim, BOUND_HELPER_MAX_RUN_MS, BOUND_LEASE_MARGIN_MS } from "./dell-wake-executor.mjs";

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
      assistantResponseHash: createHash("sha256").update("Unit-test-only assistant receipt").digest("hex"),
      assistantResponseText: "Unit-test-only assistant receipt", observedAt: "2026-10-20T00:00:00.000Z",
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

test("two explicit legacy owners retain one GPT01 destination while GPT02 is disabled", () => {
  const secondLegacy = { ...legacy, ownerChannel: "ai-engine-oauth:" + "e".repeat(64) };
  const config = pairings();
  delete config.legacyBinding;
  config.legacyBindings = [structuredClone(legacy), secondLegacy];
  config.bindings[0].enabled = false;
  for (const target of [legacy, secondLegacy]) {
    const job = work(target);
    const selected = resolveWorkBinding(job, config);
    assert.equal(selected.metadata.conversationId, target.ownerChannel);
    assert.equal(selected.browserProfile, "openclaw");
    assert.equal(selected.conversationId, conversation);
    assert.equal(selected.attestationVersion, 1);
    assert.equal(selected.wakeBinding, undefined);
  }
  assert.notEqual(work(legacy).metadata.assistantAttestationChallenge,
    work(secondLegacy).metadata.assistantAttestationChallenge);
  assert.throws(() => resolveWorkBinding(work(), config), /not enabled/);
  assert.throws(() => resolveWorkBinding(work({ ...legacy, ownerChannel: ownerTwo }), config), /not enabled/);
  config.legacyBindings[1].enabled = false;
  assert.throws(() => resolveWorkBinding(work(secondLegacy), config), /not enabled/);
  assert.equal(resolveWorkBinding(work(legacy), config).browserProfile, "openclaw");
});

test("plural legacy registry rejects ambiguity, duplicate owners and multiple destinations", () => {
  const second = { ...legacy, ownerChannel: "ai-engine-oauth:" + "e".repeat(64) };
  for (const entries of [[], null, {}, [legacy, legacy], [legacy, { ...second, targetConversationId: conversationTwo }],
    [legacy, { ...second, browserProfile: "another-profile" }], [legacy, { ...second, accountAlias: "GPT02" }]]) {
    const config = pairings();
    delete config.legacyBinding;
    config.legacyBindings = entries;
    assert.throws(() => localBindings(config));
  }
  assert.throws(() => localBindings({ ...pairings(), legacyBindings: [second] }), /Ambiguous/);
  const collision = pairings();
  delete collision.legacyBinding;
  collision.legacyBindings = [legacy, { ...second, ownerChannel: ownerTwo }];
  assert.throws(() => localBindings(collision), /Conflicting/);
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
    assert.equal(observed.options.timeout, target.accountAlias === "GPT01" ? 180_000 : 240_000);
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

test("bound receipts preserve exact text and reject truncated or mismatched display text", () => {
  const job = work();
  const receipt = receiptFor(job);
  const exact = "  Native final text\n";
  receipt.assistantResponseText = exact;
  receipt.attestation.assistantResponseText = exact;
  receipt.attestation.assistantResponseHash = createHash("sha256").update(exact).digest("hex");
  const accepted = execute(job, runtime(() => ({ status: 0, stdout: JSON.stringify(receipt) })));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.message, exact);
  assert.equal(accepted.details.assistantResponseText, exact);
  for (const change of [
    r => { r.assistantResponseText = exact.trim(); },
    r => { r.attestation.assistantResponseText = exact.trim(); },
    r => { r.attestation.assistantResponseHash = "0".repeat(64); },
    r => { r.assistantResponseText = r.attestation.assistantResponseText = "a".repeat(4001); },
    r => { r.assistantResponseText = r.attestation.assistantResponseText = "\u{1f680}".repeat(2001); },
  ]) {
    const altered = structuredClone(receipt);
    change(altered);
    assert.equal(execute(job, runtime(() => ({ status: 0, stdout: JSON.stringify(altered) }))).ok, false);
  }
  const legacyJob = work(legacy);
  const legacyReceipt = receiptFor(legacyJob);
  legacyReceipt.assistantResponseText = exact;
  assert.equal(execute(legacyJob, runtime(() => ({ status: 0, stdout: JSON.stringify(legacyReceipt) }))).message, exact.trim());
});

class ManualClock {
  value = 1000;
  serial = 0;
  timers = new Map();
  now = () => this.value;
  wall = () => 1_790_000_000_000 + this.value;
  setTimer = (fn, delay) => {
    const id = ++this.serial;
    this.timers.set(id, { at: this.value + delay, fn });
    return id;
  };
  clearTimer = id => this.timers.delete(id);
  async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  async advance(ms) {
    const target = this.value + ms;
    await this.flush();
    while (true) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.value = next[1].at;
      next[1].fn();
      await this.flush();
    }
    this.value = target;
    await this.flush();
  }
}

class ControlledChild extends EventEmitter {
  constructor(onFrame = () => {}) {
    super();
    this.frames = [];
    this.kills = 0;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new Writable({ write: (chunk, encoding, callback) => {
      const frame = JSON.parse(chunk.toString("utf8"));
      this.frames.push(frame);
      onFrame(frame, this);
      callback();
    } });
  }
  finish(value, code = 0) {
    if (value !== undefined) this.stdout.write(Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)));
    this.stdout.end();
    this.stderr.end();
    this.exitCode = code;
    this.emit("exit", code);
    this.emit("close", code);
  }
  kill() { this.kills++; this.finish(undefined, 1); return true; }
}

function claimedWork() {
  const job = work();
  job.commandId = "77777777-7777-4777-8777-777777777777";
  job.claimToken = "88888888-8888-4888-8888-888888888888";
  job.metadata.claimToken = job.claimToken;
  return job;
}

function committedFor(job, payload) {
  const evidence = payload.status === "COMPLETED"
    ? { statusCode: "JOB_COMPLETED", deliveryCode: "DELIVERY_CONFIRMED", e2eCode: "E2E_VERIFIED" }
    : { statusCode: "FAILED", deliveryCode: "UNKNOWN_UNVERIFIED", e2eCode: "UNKNOWN_UNVERIFIED" };
  return { commandId: job.commandId, status: payload.status, ...evidence,
    response: { id: "99999999-9999-4999-8999-999999999999", commandId: job.commandId,
      kind: payload.status, message: payload.message.trim(),
      checkpointJson: { status: payload.status, clientId: workerId, ...evidence },
      metadataJson: { ...JSON.parse(JSON.stringify(payload.details)), ...evidence } } };
}

function boundRuntime(clock, child, http, presence = async () => ({})) {
  return { ...runtime(() => assert.fail("Bound jobs must not use spawnSync")),
    spawnBound: (python, args, options) => {
      assert.deepEqual(args, ["/test-only/helper.py", "--bound-lease-v1"]);
      child.options = options;
      return child;
    },
    request: (rt, route, payload, options) => route.endsWith("/heartbeat")
      ? presence(rt, route, payload, options) : http(rt, route, payload, options),
    monotonic: clock.now, wallClock: clock.wall,
    setTimer: clock.setTimer, clearTimer: clock.clearTimer,
  };
}

test("bound helper uses exact JSONL lease protocol and excludes the HTTP claim secret", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  const requests = [];
  const child = new ControlledChild((frame, running) => {
    if (frame.protocol) running.finish(receiptFor(job));
  });
  const outcome = await executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
    requests.push({ route, payload });
    return route.endsWith("/renew") ? { renewed: true } : committedFor(job, payload);
  }));
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.answer.ok, true);
  assert.equal(child.options.windowsHide, true);
  assert.equal(child.options.shell, false);
  assert.deepEqual(child.options.stdio, ["pipe", "pipe", "pipe"]);
  const first = child.frames[0];
  assert.deepEqual(Object.keys(first).sort(), ["commandId", "instruction", "lease", "maxRunMs", "metadata", "protocol", "workerId"]);
  assert.equal(first.protocol, "ai-core-native-lease/v1");
  assert.equal(first.maxRunMs, 1_980_000);
  assert.equal(first.lease.sequence, 0);
  assert.equal(first.lease.validForMs, 300_000 - BOUND_LEASE_MARGIN_MS);
  assert.equal(first.lease.issuedAtUtcMs, clock.wall());
  assert.equal(first.metadata.claimToken, undefined);
  assert.equal(first.claimToken, undefined);
  assert.equal(child.options.env.AI_CORE_SCOPED_AGENT_TOKEN, undefined);
  assert.deepEqual(first.metadata.wakeBinding, job.metadata.wakeBinding);
  assert.equal(requests[0].payload.claimToken, job.claimToken);
  assert.equal(requests[1].payload.claimToken, job.claimToken);
  assert.equal(requests[1].payload.status, "COMPLETED");
  assert.equal(clock.timers.size, 0);
});

test("renewal validity starts at the HTTP request start and callbacks keep renewing after child exit", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let completeResult;
  let resultPayload;
  let renews = 0;
  const child = new ControlledChild();
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
    if (route.endsWith("/renew")) {
      renews++;
      if (renews === 1) clock.value += 20_000;
      return { renewed: true };
    }
    resultPayload = payload;
    return new Promise(resolve => { completeResult = resolve; });
  }));
  await clock.flush();
  assert.equal(child.frames[0].lease.validForMs, 255_000);
  child.finish(receiptFor(job));
  await clock.flush();
  await clock.advance(60_000);
  assert.equal(renews, 2, "result delivery still owns and renews the same claim");
  assert.equal(child.frames.length, 1, "no control writes after helper exit");
  completeResult(committedFor(job, resultPayload));
  const outcome = await pending;
  assert.equal(outcome.delivered, true);
  assert.equal(clock.timers.size, 0);
});

test("transient renewal errors do not extend ownership or overlap renewal requests", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let calls = 0;
  let outstanding = 0;
  let maximumOutstanding = 0;
  const rt = { monotonic: clock.now, wallClock: clock.wall, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    request: async () => {
      calls++; outstanding++; maximumOutstanding = Math.max(maximumOutstanding, outstanding);
      outstanding--;
      if (calls === 2) throw Object.assign(new Error("temporary"), { status: 503 });
      return { renewed: true };
    } };
  const lease = await new BoundClaimLease(job, rt).start();
  const original = lease.expiresAt;
  const grants = [];
  lease.onGrant = frame => grants.push(frame);
  await clock.advance(60_000);
  assert.equal(lease.expiresAt, original);
  assert.equal(grants.length, 0);
  await clock.advance(5_000);
  assert.equal(grants.length, 1);
  assert.equal(grants[0].sequence, 1);
  assert.equal(maximumOutstanding, 1);
  lease.stop();
});

test("a late renewed:true cannot revive an expired local lease", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let calls = 0;
  let late;
  const lease = await new BoundClaimLease(job, {
    monotonic: clock.now, wallClock: clock.wall, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    request: async () => ++calls === 1 ? { renewed: true } : new Promise(resolve => { late = resolve; }),
  }).start();
  let grants = 0;
  lease.onGrant = () => grants++;
  await clock.advance(60_000);
  await clock.advance(300_000);
  assert.equal(lease.failure, "lease_expired");
  late({ renewed: true });
  await clock.flush();
  assert.equal(lease.usable(), false);
  assert.equal(grants, 0);
  assert.equal(clock.timers.size, 0);
});

test("claim revocation kills the owned helper once and cannot submit a result or replay input", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let renews = 0;
  let results = 0;
  const child = new ControlledChild();
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route) => {
    if (route.endsWith("/result")) { results++; return { ok: true }; }
    if (++renews === 1) return { renewed: true };
    throw Object.assign(new Error("conflict"), { status: 409 });
  }));
  await clock.flush();
  await clock.advance(60_000);
  const outcome = await pending;
  assert.equal(child.kills, 1);
  assert.equal(child.frames.at(-1).type, "revoke");
  assert.equal(child.frames.at(-1).sequence, 1);
  assert.equal(results, 0);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.reconciliationRequired, true);
  assert.equal(clock.timers.size, 0);
});

test("successful renewals never extend the fixed helper runtime", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  const child = new ControlledChild();
  let reported;
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
    if (route.endsWith("/renew")) return { renewed: true };
    reported = payload;
    return committedFor(job, payload);
  }));
  await clock.flush();
  await clock.advance(BOUND_HELPER_MAX_RUN_MS);
  const outcome = await pending;
  assert.equal(child.kills, 1);
  assert.equal(outcome.delivered, true);
  assert.equal(reported.status, "FAILED");
  assert.equal(reported.details.reason, "helper_deadline_exceeded");
  assert.equal(reported.details.attestation, null);
  assert.equal(clock.timers.size, 0);
});

test("unconfirmed child termination halts the bound flow without result submission", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  const child = new ControlledChild();
  child.kill = () => { child.kills++; return false; };
  let renews = 0;
  let results = 0;
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route) => {
    if (route.endsWith("/result")) { results++; return { ok: true }; }
    if (++renews === 1) return { renewed: true };
    throw Object.assign(new Error("revoked"), { status: 403 });
  }));
  await clock.flush();
  await clock.advance(65_000);
  const outcome = await pending;
  assert.equal(outcome.reason, "helper_termination_unconfirmed");
  assert.equal(outcome.reconciliationRequired, true);
  assert.equal(results, 0);
  assert.equal(child.kills, 1);
  assert.equal(clock.timers.size, 0);
});

test("result delivery is bounded to eight attempts with no helper rerun", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let results = 0;
  const child = new ControlledChild((frame, running) => { if (frame.protocol) running.finish(receiptFor(job)); });
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route) => {
    if (route.endsWith("/renew")) return { renewed: true };
    results++;
    throw Object.assign(new Error("temporary"), { status: 502 });
  }));
  await clock.flush();
  await clock.advance(70_000);
  const outcome = await pending;
  assert.equal(results, 8);
  assert.equal(child.frames.filter(frame => frame.protocol).length, 1);
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.reconciliationRequired, true);
  assert.equal(clock.timers.size, 0);
});

test("a result409 is preserved as uncertain rather than retried as another job", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let results = 0;
  const child = new ControlledChild((frame, running) => { if (frame.protocol) running.finish(receiptFor(job)); });
  const outcome = await executeBoundClaim(job, boundRuntime(clock, child, async (rt, route) => {
    if (route.endsWith("/renew")) return { renewed: true };
    results++;
    throw Object.assign(new Error("conflict"), { status: 409 });
  }));
  assert.equal(results, 1);
  assert.equal(outcome.reconciliationRequired, true);
  assert.equal(outcome.answer.ok, true, "existing verified receipt is retained as evidence");
  assert.equal(outcome.reason, "result_delivery_unconfirmed");
});

test("unconfirmed initial renewals never launch the helper", async () => {
  for (const response of [{ renewed: false }, null, {}, { renewed: true, unexpected: true }]) {
    const clock = new ManualClock();
    const rt = boundRuntime(clock, new ControlledChild(), async () => response);
    rt.spawnBound = () => assert.fail("unconfirmed lease must not spawn");
    const outcome = await executeBoundClaim(claimedWork(), rt);
    assert.equal(outcome.delivered, false);
    assert.equal(outcome.reconciliationRequired, true);
    assert.equal(clock.timers.size, 0);
  }
});

test("invalid bound stdout and excessive output cannot produce a successful attestation", async () => {
  for (const output of [Buffer.from([0xff]), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)]) {
    const job = claimedWork();
    const clock = new ManualClock();
    let reported;
    const child = new ControlledChild((frame, running) => {
      if (frame.protocol) {
        running.stdout.write(output);
        if (!running.kills) running.finish(undefined);
      }
    });
    const outcome = await executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
      if (route.endsWith("/renew")) return { renewed: true };
      reported = payload;
      return committedFor(job, payload);
    }));
    assert.equal(outcome.delivered, true);
    assert.equal(reported.status, "FAILED");
    assert.equal(reported.details.attestation, null);
    assert.equal(reported.details.verifiedAssistantReply, false);
    assert.equal(clock.timers.size, 0);
  }
});

test("a 2xx callback must prove the same durable command and exact submitted result", async () => {
  const alterations = [
    () => null,
    () => ({}),
    () => ({ ok: true }),
    value => ({ ...value, commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    value => ({ ...value, status: "FAILED" }),
    value => { value.response.id = "not-a-response-uuid"; return value; },
    value => { value.response.commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; return value; },
    value => { value.response.checkpointJson.clientId = "another-worker"; return value; },
    value => { value.response.metadataJson.assistantResponseText += " altered"; return value; },
    value => { value.response.metadataJson.attestation.signature = "not-the-submitted-signature"; return value; },
    value => { value.response.metadataJson.deliveryCode = "UNKNOWN_UNVERIFIED"; return value; },
    value => { value.response.message += " altered"; return value; },
  ];
  for (const alter of alterations) {
    const job = claimedWork();
    const clock = new ManualClock();
    let results = 0;
    const child = new ControlledChild((frame, running) => { if (frame.protocol) running.finish(receiptFor(job)); });
    const outcome = await executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
      if (route.endsWith("/renew")) return { renewed: true };
      results++;
      return alter(committedFor(job, payload));
    }));
    assert.equal(outcome.delivered, false);
    assert.equal(outcome.reconciliationRequired, true);
    assert.equal(outcome.reason, "result_receipt_mismatch");
    assert.equal(outcome.answer.ok, true, "the local receipt remains evidence, not a claimed server commit");
    assert.equal(results, 1, "a malformed success must not trigger another delivery or native attempt");
    assert.equal(child.frames.filter(frame => frame.protocol).length, 1);
    assert.equal(clock.timers.size, 0);
  }
});

test("only a matching committed result resolves the result-success and renew409 race", async () => {
  for (const matchesCommit of [true, false]) {
    const job = claimedWork();
    const clock = new ManualClock();
    let renews = 0;
    let results = 0;
    let resultPayload;
    let completeResult;
    const child = new ControlledChild();
    const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
      if (route.endsWith("/renew")) {
        if (++renews === 1) return { renewed: true };
        throw Object.assign(new Error("result already committed"), { status: 409 });
      }
      results++;
      resultPayload = payload;
      return new Promise(resolve => { completeResult = resolve; });
    }));
    await clock.flush();
    child.finish(receiptFor(job));
    await clock.flush();
    await clock.advance(60_000);
    assert.equal(renews, 2);
    const response = committedFor(job, resultPayload);
    if (!matchesCommit) response.response.commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    completeResult(response);
    const outcome = await pending;
    assert.equal(outcome.delivered, matchesCommit);
    assert.equal(outcome.reconciliationRequired, !matchesCommit);
    assert.equal(child.kills, 0, "an exited helper must not be targeted again");
    assert.equal(results, 1);
    assert.equal(clock.timers.size, 0);
  }
});

test("output overflow and stream errors after exit cannot accept a retained JSON prefix", async () => {
  for (const fault of ["overflow", "stream_error"]) {
    const job = claimedWork();
    const clock = new ManualClock();
    let reported;
    const child = new ControlledChild((frame, running) => {
      if (!frame.protocol) return;
      running.exitCode = 0;
      running.emit("exit", 0);
      running.stdout.write(JSON.stringify(receiptFor(job)));
      if (fault === "overflow") running.stdout.write(Buffer.alloc(2 * 1024 * 1024, 0x61));
      else running.stdout.emit("error", new Error("test-only drain failure"));
      running.stdout.end();
      running.stderr.end();
      running.emit("close", 0);
    });
    const outcome = await executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
      if (route.endsWith("/renew")) return { renewed: true };
      reported = payload;
      return committedFor(job, payload);
    }));
    assert.equal(outcome.delivered, true, "the confirmed failure can still be delivered");
    assert.equal(reported.status, "FAILED");
    assert.equal(reported.details.reason, fault === "overflow" ? "helper_output_limit" : "helper_output_unavailable");
    assert.equal(reported.details.attestation, null);
    assert.equal(reported.details.verifiedAssistantReply, false);
    assert.equal(child.kills, 0);
    assert.equal(clock.timers.size, 0);
  }
});

test("presence follows the verified grant write and stops after confirmed result delivery", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  const events = [];
  let pulses = 0;
  const child = new ControlledChild(frame => events.push(frame.protocol ? "initial-write" : "renewal-write"));
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route, payload) => {
    if (route.endsWith("/renew")) { events.push("verified-renewal"); return { renewed: true }; }
    return committedFor(job, payload);
  }, async (rt, route, payload, options) => {
    pulses++;
    events.push("presence");
    assert.ok(route.endsWith("/" + workerId + "/heartbeat"));
    assert.deepEqual(payload, { health: "healthy", version: "dell-wake-executor-3",
      details: { activeJobs: 1, availableSlots: 0 } });
    assert.equal(options.signal.aborted, false);
    if (pulses === 1) throw Object.assign(new Error("presence unavailable"), { status: 503 });
    return {};
  }));
  await clock.flush();
  await new Promise(setImmediate);
  assert.deepEqual(events, ["verified-renewal", "initial-write", "presence"]);
  await clock.advance(60_000);
  await new Promise(setImmediate);
  assert.deepEqual(events, ["verified-renewal", "initial-write", "presence",
    "verified-renewal", "renewal-write", "presence"]);
  child.finish(receiptFor(job));
  const outcome = await pending;
  assert.equal(outcome.delivered, true, "presence failure cannot veto valid command ownership");
  await clock.advance(120_000);
  await new Promise(setImmediate);
  assert.equal(pulses, 2);
  assert.equal(clock.timers.size, 0);
});

test("a stalled presence request cannot overlap, block renewal grants, or delay lease expiry", async () => {
  const job = claimedWork();
  const clock = new ManualClock();
  let renews = 0;
  let pulses = 0;
  let aborts = 0;
  const child = new ControlledChild();
  const pending = executeBoundClaim(job, boundRuntime(clock, child, async (rt, route) => {
    assert.ok(route.endsWith("/renew"));
    if (++renews <= 2) return { renewed: true };
    return new Promise(() => {}); // old acknowledged lease must still expire
  }, async (rt, route, payload, options) => {
    pulses++;
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => {
      aborts++;
      reject(new Error("test-only presence aborted"));
    }, { once: true }));
  }));
  await clock.flush();
  await new Promise(setImmediate);
  await clock.advance(60_000);
  await new Promise(setImmediate);
  assert.equal(child.frames.at(-1).sequence, 1);
  assert.equal(child.frames.at(-1).type, "lease");
  assert.equal(pulses, 1, "an outstanding presence pulse must not overlap another");
  await clock.advance(275_000);
  const outcome = await pending;
  assert.equal(outcome.delivered, false);
  assert.equal(outcome.reason, "lease_expired");
  assert.equal(child.kills, 1);
  assert.equal(aborts, 1);
  assert.equal(clock.timers.size, 0);
});

