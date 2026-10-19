import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
vi.mock("@workspace/db", () => ({ db: { transaction: vi.fn() } }));
import {
  DevContinuityWatchRepository, devContinuityWakeEventId,
  type DevContinuityTransactionRunner, type DevContinuityWatch,
} from "../devContinuityWatchRepository.js";
import { DEV_CONTINUITY_WORKER, type DevContinuityWakeResult } from "../devContinuityWakeEvents.js";
import { DEV_ASSISTANT_ATTESTATION_ALGORITHM, DEV_ASSISTANT_ATTESTATION_KEY_ID, DEV_ASSISTANT_ATTESTATION_VERSION, deriveDevAssistantChallenge, devAssistantAttestationPayload, type DevAssistantAttestation } from "../devAssistantAttestation.js";

const owner = "ai-engine-oauth:" + "a".repeat(64);
const other = "ai-engine-oauth:" + "b".repeat(64);
const target = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const initial = Date.parse("2026-10-18T12:00:00.000Z");
const input = { ownerChannel: owner, targetConversationId: target, jobId: "33333333-3333-4333-8333-333333333333", checkpointSha: "c".repeat(40), idleSeconds: 60, ttlSeconds: 3600 };
const attestationKey = generateKeyPairSync("ed25519");
const attestationPublicKeyDerBase64 = attestationKey.publicKey.export({ format: "der", type: "spki" }).toString("base64");
type Row = { id: string; external_command_id: string; source: string; command_type: string;
  metadata_json: { conversationId: string; assignedClientId: string; devContinuity: DevContinuityWatch; [key: string]: unknown }; status: string };

/** Transactional adapter exercises the public state machine without contacting a database. */
function store() {
  let rows: Row[] = [];
  const children: Record<string, unknown>[] = [];
  const statements: Array<{ text: string; params: unknown[] }> = [];
  let serial = 0;
  let previous = Promise.resolve();
  const dialect = new PgDialect();
  const transaction: DevContinuityTransactionRunner = async operation => {
    let unlock!: () => void;
    const before = previous;
    previous = new Promise<void>(resolve => { unlock = resolve; });
    await before;
    const snapshot = structuredClone(rows);
    let channel: string | null = null;
    try {
      return await operation({ execute: async (query: SQL) => {
        const compiled = dialect.sqlToQuery(query);
        const text = compiled.sql.replace(/\s+/g, " ").trim();
        const params = compiled.params;
        statements.push({ text, params });
        if (text.includes("set_config")) { channel = String(params[0]); return { rows: [] }; }
        if (!channel) throw new Error("Missing transaction-local owner context");
        if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
        const scoped = rows.filter(row => row.source === "ai-core" && row.command_type === "DEV_CONTINUITY_WATCH" &&
          row.metadata_json.conversationId === channel && row.metadata_json.assignedClientId === DEV_CONTINUITY_WORKER);
        if (text.startsWith("SELECT COUNT")) {
          return { rows: [{ active_count: scoped.filter(row => row.metadata_json.devContinuity.active &&
            Date.parse(row.metadata_json.devContinuity.expiresAt) > Date.parse(String(params[2]))).length }] };
        }
        if (text.startsWith("INSERT INTO")) {
          const external = String(params[0]);
          if (rows.some(row => row.source === "ai-core" && row.external_command_id === external)) return { rows: [] };
          const row: Row = { id: "00000000-0000-4000-8000-" + String(++serial).padStart(12, "0"),
            external_command_id: external, source: "ai-core", command_type: "DEV_CONTINUITY_WATCH",
            metadata_json: JSON.parse(String(params[2])), status: "RECEIVED" };
          rows.push(row);
          return { rows: [structuredClone(row)] };
        }
        if (text.startsWith("UPDATE")) {
          const row = scoped.find(row => row.id === params[3] && row.metadata_json.conversationId === params[4] &&
            row.metadata_json.devContinuity.jobId === params[6] && String(row.metadata_json.devContinuity.revision) === params[7]);
          if (!row) return { rows: [] };
          row.metadata_json.devContinuity = JSON.parse(String(params[0]));
          row.status = String(params[1]);
          return { rows: [structuredClone(row)] };
        }
        if (text.startsWith("SELECT child.id")) {
          const found = children.filter(value => {
            const meta = value["metadata_json"] as Row["metadata_json"];
            const bind = meta.devContinuity as unknown as Record<string, unknown>;
            return value["source"] === "ai-core" && value["command_type"] === "EXTERNAL_AGENT_WORK" &&
              meta.conversationId === params[0] && (meta.assignedClientId === params[1] || meta.assignedClientId === params[2]) &&
              meta["completedBy"] === meta.assignedClientId &&
              bind["parentWatchCommandId"] === params[3] && bind["jobId"] === params[4] && bind["eventId"] === params[5];
          });
          return { rows: structuredClone(found.slice(0, 1)) };
        }
        if (text.startsWith("SELECT id, metadata_json")) {
          if (text.includes("external_command_id =")) return { rows: structuredClone(scoped.filter(row => row.external_command_id === params[0] &&
            row.metadata_json.conversationId === params[1] && row.metadata_json.devContinuity.jobId === params[3])) };
          const at = Date.parse(String(params[2]));
          const selected = scoped.filter(row => row.metadata_json.devContinuity.active).sort((a, b) =>
            Number(Date.parse(a.metadata_json.devContinuity.expiresAt) <= at) - Number(Date.parse(b.metadata_json.devContinuity.expiresAt) <= at) ||
            Date.parse(a.metadata_json.devContinuity.deadlineAt) - Date.parse(b.metadata_json.devContinuity.deadlineAt));
          return { rows: structuredClone(selected.slice(0, Number(params[3]))) };
        }
        throw new Error("Unexpected repository query");
      } });
    } catch (error) { rows = snapshot; throw error; } finally { unlock(); }
  };
  return { repository: new DevContinuityWatchRepository(transaction), statements, children, rows: () => structuredClone(rows) };
}

function callback(watch: DevContinuityWatch, overrides: Partial<DevContinuityWakeResult> = {}): DevContinuityWakeResult {
  const expected = { ownerChannel: owner, targetConversationId: target, eventId: watch.wakeEventId!,
    watchCommandId: watch.commandId, jobId: watch.jobId, checkpointRevision: watch.revision, workerId: DEV_CONTINUITY_WORKER };
  const unsigned = {
    version: DEV_ASSISTANT_ATTESTATION_VERSION,
    algorithm: DEV_ASSISTANT_ATTESTATION_ALGORITHM,
    keyId: DEV_ASSISTANT_ATTESTATION_KEY_ID,
    workerId: DEV_CONTINUITY_WORKER,
    conversationId: target,
    eventId: watch.wakeEventId!,
    challenge: deriveDevAssistantChallenge(expected),
    assistantMessageId: "44444444-4444-4444-8444-444444444444",
    assistantResponseHash: "c".repeat(64),
    observedAt: new Date(Date.parse(watch.triggeredAt ?? watch.lastProgressAt) + 100).toISOString(),
  } as Omit<DevAssistantAttestation, "signature">;
  const attestation = { ...unsigned,
    signature: sign(null, Buffer.from(devAssistantAttestationPayload(unsigned), "utf8"), attestationKey.privateKey).toString("base64") };
  return { parentWatchCommandId: watch.commandId, ownerChannel: owner, eventId: watch.wakeEventId!, jobId: watch.jobId,
    childCommandId: childId, workerId: DEV_CONTINUITY_WORKER, status: "COMPLETED",
    details: { browserConfirmed: true, browserPairingVerified: true, chatgptSubmitted: true, verifiedAssistantReply: true,
      exitCode: 0, conversationId: target, eventId: watch.wakeEventId, evidenceFingerprint: "f".repeat(64), attestation }, ...overrides };
}

describe("passive DEV continuity persistence", () => {
  beforeEach(() => { vi.stubEnv("APP_ENV", "development"); vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AI_CORE_DEV_ASSISTANT_ATTESTATION_PUBLIC_KEY_DER_B64", attestationPublicKeyDerBase64); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("registers concurrently once without resetting expiry, revision or progress", async () => {
    const test = store();
    const [a, b] = await Promise.all([test.repository.register(input, initial), test.repository.register(input, initial + 1000)]);
    expect(a).toEqual(b); expect(test.rows()).toHaveLength(1);
    const advanced = await test.repository.update({ ownerChannel: owner, jobId: input.jobId, expectedRevision: 1 }, initial + 2000);
    expect(await test.repository.register(input, initial + 3000)).toEqual(advanced);
    expect(test.statements.some(query => /notify|pg_notify|INSERT INTO.*responses/.test(query.text))).toBe(false);
  });

  it("isolates owner reads/writes and applies local owner context on every transaction", async () => {
    const test = store(); await test.repository.register(input, initial);
    expect(await test.repository.get(other, input.jobId)).toBeNull();
    await expect(test.repository.update({ ownerChannel: other, jobId: input.jobId, expectedRevision: 1 }, initial)).rejects.toMatchObject({ code: "WATCH_NOT_FOUND" });
    for (const statement of test.statements.filter(item => item.text.startsWith("SELECT id") || item.text.startsWith("UPDATE") || item.text.startsWith("SELECT COUNT"))) {
      expect(statement.text).toContain("source = 'ai-core'");
      expect(statement.text).toContain("command_type = 'DEV_CONTINUITY_WATCH'");
      expect(statement.text).toContain("'conversationId'");
      expect(statement.text).toContain("'assignedClientId'");
    }
  });

  it("caps active watches at 32 under concurrent registrations", async () => {
    const test = store();
    await Promise.all(Array.from({ length: 32 }, (_, n) => test.repository.register({ ...input, jobId: "job-" + n }, initial)));
    await expect(test.repository.register({ ...input, jobId: "job-overflow" }, initial)).rejects.toMatchObject({ code: "WATCH_LIMIT" });
    expect(test.rows()).toHaveLength(32);
  });

  it("claims only a due revision, fences old leases and reuses the identical event on recovery", async () => {
    const { repository } = store(); await repository.register(input, initial);
    expect(await repository.claim(owner, input.jobId, 1, initial + 59_999)).toBeNull();
    expect(await repository.claim(owner, input.jobId, 2, initial + 60_000)).toBeNull();
    const first = (await repository.claim(owner, input.jobId, 1, initial + 60_000))!;
    expect(first).toMatchObject({ state: "FIRING", wakeCount: 1, wakeEventId: devContinuityWakeEventId(owner, input.jobId, 1) });
    expect(first.evidence["trigger"]).toBe("PROGRESS_DEADLINE_EXPIRED");
    expect(await repository.claim(owner, input.jobId, 1, initial + 60_001)).toBeNull();
    const reclaimed = (await repository.claim(owner, input.jobId, 1, initial + 120_000))!;
    expect(reclaimed.wakeEventId).toBe(first.wakeEventId); expect(reclaimed.wakeCount).toBe(1);
    expect(reclaimed.claimToken).not.toBe(first.claimToken);
    await expect(repository.recordQueued({ ownerChannel: owner, jobId: input.jobId, eventId: first.wakeEventId!,
      claimToken: first.claimToken!, wakeCommandId: childId }, initial + 120_001)).rejects.toMatchObject({ code: "CLAIM_CONFLICT" });
  });

  it.each(["WAITING_CI", "WAITING_APPROVAL"] as const)("does not wake %s and expires it without dispatch", async state => {
    const { repository } = store(); await repository.register(input, initial);
    const paused = await repository.update({ ownerChannel: owner, jobId: input.jobId, expectedRevision: 1, state }, initial + 1000);
    expect(await repository.claim(owner, input.jobId, 1, initial + 120_000)).toBeNull();
    expect(await repository.claim(owner, input.jobId, paused.revision, initial + 120_000)).toBeNull();
    expect(await repository.claim(owner, input.jobId, paused.revision, initial + 3_600_000)).toMatchObject({ state: "EXPIRED", active: false, wakeCount: 0 });
  });

  it("rejects progress while dispatch is in flight and never reopens a terminal watch", async () => {
    const { repository } = store(); await repository.register(input, initial);
    await repository.claim(owner, input.jobId, 1, initial + 60_000);
    await expect(repository.update({ ownerChannel: owner, jobId: input.jobId, expectedRevision: 1 }, initial + 60_001)).rejects.toMatchObject({ code: "WAKE_IN_FLIGHT" });
    await repository.register({ ...input, jobId: "terminal" }, initial);
    await repository.update({ ownerChannel: owner, jobId: "terminal", expectedRevision: 1, state: "COMPLETED" }, initial + 1000);
    await expect(repository.update({ ownerChannel: owner, jobId: "terminal", expectedRevision: 2 }, initial + 2000)).rejects.toMatchObject({ code: "TERMINAL_WATCH" });
    expect(await repository.register({ ...input, jobId: "terminal" }, initial + 2000)).toMatchObject({ state: "COMPLETED", revision: 2 });
  });

  it("records browser delivery separately from assistant reply, including callback-before-queue receipt", async () => {
    const { repository } = store(); await repository.register(input, initial);
    const claimed = (await repository.claim(owner, input.jobId, 1, initial + 60_000))!;
    expect(await repository.recordResult(callback(claimed, { parentWatchCommandId: target }), initial + 60_100)).toBeNull();
    const result = await repository.recordResult(callback(claimed), initial + 60_200);
    expect(result).toMatchObject({ state: "WAKE_CONFIRMED", wakeCount: 1,
      evidence: { resultCode: "DELIVERY_CONFIRMED", verifiedAssistantReply: true } });
    expect(await repository.recordQueued({ ownerChannel: owner, jobId: input.jobId, claimToken: claimed.claimToken!,
      eventId: claimed.wakeEventId!, wakeCommandId: childId }, initial + 60_300)).toEqual(result);
  });

  it.each(["COMPLETED", "CANCELLED"] as const)("retains the validated current wake evidence when closing as %s", async state => {
    const { repository } = store(); await repository.register(input, initial);
    const claimed = (await repository.claim(owner, input.jobId, 1, initial + 60_000))!;
    const confirmed = (await repository.recordResult(callback(claimed), initial + 60_200))!;
    const closed = await repository.update({ ownerChannel: owner, jobId: input.jobId,
      expectedRevision: confirmed.revision, state }, initial + 60_300);
    expect(closed).toMatchObject({ state, active: false, wakeEventId: confirmed.wakeEventId,
      wakeCommandId: childId, triggeredAt: confirmed.triggeredAt, wakeCount: 1,
      evidence: { ...confirmed.evidence, evidenceFingerprint: "f".repeat(64),
        progressRecordedAt: new Date(initial + 60_300).toISOString() } });
    expect(await repository.get(owner, input.jobId)).toEqual(closed);
    expect(await repository.claim(owner, input.jobId, closed.revision, initial + 180_000)).toBeNull();
  });

  it("preserves the three-wake lifetime budget across authenticated progress revisions", async () => {
    const { repository } = store(); let watch = await repository.register(input, initial);
    for (let cycle = 0; cycle < 3; cycle++) {
      const at = initial + (cycle + 1) * 61_000;
      watch = (await repository.claim(owner, input.jobId, watch.revision, at))!;
      expect(watch.wakeCount).toBe(cycle + 1);
      watch = (await repository.recordResult(callback(watch), at + 100))!;
      watch = await repository.update({ ownerChannel: owner, jobId: input.jobId, expectedRevision: watch.revision }, at + 200);
    }
    const blocked = await repository.claim(owner, input.jobId, watch.revision, initial + 244_000);
    expect(blocked).toMatchObject({ state: "BLOCKED", wakeCount: 3, active: false, evidence: { failureReason: "WAKE_BUDGET_EXHAUSTED" } });
  });

  it("recovers an authenticated durable child callback without queueing a replacement", async () => {
    const test = store(); await test.repository.register(input, initial);
    const watch = (await test.repository.claim(owner, input.jobId, 1, initial + 60_000))!;
    await test.repository.recordQueued({ ownerChannel: owner, jobId: input.jobId, claimToken: watch.claimToken!, eventId: watch.wakeEventId!, wakeCommandId: childId }, initial + 60_100);
    const event = callback(watch);
    test.children.push({ id: childId, source: "ai-core", command_type: "EXTERNAL_AGENT_WORK", status: "COMPLETED",
      metadata_json: { conversationId: owner, assignedClientId: DEV_CONTINUITY_WORKER, completedBy: DEV_CONTINUITY_WORKER,
        capability: "chatgpt:wake", explicitWorkerTarget: true, eventId: watch.wakeEventId,
        devContinuity: { parentWatchCommandId: watch.commandId, ownerChannel: owner, jobId: watch.jobId, eventId: watch.wakeEventId } },
      result_details: event.details });
    expect(await test.repository.reconcile(other, input.jobId, initial + 70_000)).toBeNull();
    expect(await test.repository.reconcile(owner, input.jobId, initial + 70_000)).toMatchObject({ state: "WAKE_CONFIRMED", wakeCommandId: childId, wakeCount: 1 });
    expect(test.rows()).toHaveLength(1);
  });

  it("blocks incomplete callback evidence and rejects PROD before querying", async () => {
    const test = store(); await test.repository.register(input, initial);
    const watch = (await test.repository.claim(owner, input.jobId, 1, initial + 60_000))!;
    expect(await test.repository.recordResult(callback(watch, { details: { chatgptSubmitted: true } }), initial + 60_100)).toMatchObject({ state: "BLOCKED", evidence: { failureReason: "BROWSER_EVIDENCE_INCOMPLETE" } });
    vi.stubEnv("NODE_ENV", "production"); const count = test.statements.length;
    await expect(test.repository.get(owner, input.jobId)).rejects.toMatchObject({ code: "DEV_ONLY" });
    expect(test.statements).toHaveLength(count);
  });
});
