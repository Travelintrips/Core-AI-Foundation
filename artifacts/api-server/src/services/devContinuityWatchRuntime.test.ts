import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevContinuityWatchRuntime, type ContinuityWatch, type ContinuityResult } from "./devContinuityWatchRuntime.js";

const OWNER = "ai-engine-oauth:" + "a".repeat(64);
const JOB = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const BASE = Date.parse("2026-10-18T00:00:00.000Z");
const input = { ownerChannel: OWNER, targetConversationId: TARGET, jobId: JOB,
  checkpointSha: "c".repeat(40), idleSeconds: 60, ttlSeconds: 900 };
const result: ContinuityResult = { ownerChannel: OWNER, parentWatchCommandId: "parent", jobId: JOB,
  childCommandId: "child", eventId: "e".repeat(64), workerId: "openclaw-travelintrips-dev",
  status: "COMPLETED", details: { browserConfirmed: true } };

function fixture(initial?: Partial<ContinuityWatch>, asyncAllowed?: () => boolean | Promise<boolean>) {
  let watch: ContinuityWatch = {
    commandId: "parent", ...input, revision: 1, state: "RUNNING",
    deadlineAt: new Date(BASE + 60_000).toISOString(), expiresAt: new Date(BASE + 900_000).toISOString(),
    ...initial,
  };
  let allowed = true;
  let enabled = true;
  let listener: ((event: ContinuityResult) => void | Promise<void>) | undefined;
  const snapshot = () => ({ ...watch });
  const repo = {
    register: vi.fn(async () => snapshot()),
    get: vi.fn(async () => snapshot()),
    reconcile: vi.fn(async () => snapshot()),
    restore: vi.fn(async () => [] as ContinuityWatch[]),
    update: vi.fn(async (checkpoint: { state: string; expectedRevision: number }) => {
      if (checkpoint.expectedRevision !== watch.revision) throw new Error("REVISION_CONFLICT");
      watch = { ...watch, state: checkpoint.state, revision: watch.revision + 1,
        deadlineAt: new Date(Date.now() + 60_000).toISOString() };
      return snapshot();
    }),
    claim: vi.fn(async (_owner: string, _job: string, revision: number) => {
      if (Date.now() >= Date.parse(watch.expiresAt)) { watch.state = "EXPIRED"; return snapshot(); }
      if (revision !== watch.revision) return null;
      if (watch.state === "FIRING" && Date.now() < Date.parse(watch.claimLeaseUntil!)) return null;
      if (watch.state !== "RUNNING" && watch.state !== "FIRING") return null;
      watch = { ...watch, state: "FIRING", claimToken: "lease", wakeEventId: "e".repeat(64),
        claimLeaseUntil: new Date(Date.now() + 60_000).toISOString() };
      return snapshot();
    }),
    recordQueued: vi.fn(async () => { watch.state = "WAKE_QUEUED"; return snapshot(); }),
    recordResult: vi.fn(async () => { watch.state = "WAKE_CONFIRMED"; return snapshot(); }),
  };
  const queue = vi.fn(async () => ({ commandId: "child" }));
  const errors = vi.fn();
  const runtime = new DevContinuityWatchRuntime({ repository: repo, queue,
    enabled: () => enabled, allowed: () => asyncAllowed ? asyncAllowed() : allowed, owners: async () => [OWNER],
    subscribe: callback => { listener = callback; return () => { listener = undefined; }; },
    onError: errors,
  });
  return { runtime, repo, queue, errors, snapshot,
    setWatch: (value: Partial<ContinuityWatch>) => { watch = { ...watch, ...value }; },
    setAllowed: (value: boolean) => { allowed = value; },
    setEnabled: (value: boolean) => { enabled = value; },
    emit: async () => { await listener?.(result); },
  };
}

describe("durable DEV progress deadline runtime", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(BASE); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("registers passively and lets the elapsed deadline create exactly one child", async () => {
    const f = fixture();
    await f.runtime.register(input);
    expect(f.queue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.queue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.repo.claim).toHaveBeenCalledWith(OWNER, JOB, 1, new Date(BASE + 60_000));
    expect(f.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      watchCommandId: "parent", eventId: "e".repeat(64), checkpointRevision: 1,
      jobId: JOB, correlationId: JOB, expiresAt: new Date(BASE + 900_000).toISOString(),
    }));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(f.queue).toHaveBeenCalledTimes(1);
    f.runtime.stop();
  });

  it("a new checkpoint cancels the previous progress deadline", async () => {
    const f = fixture(); await f.runtime.register(input);
    await vi.advanceTimersByTimeAsync(30_000);
    await f.runtime.update({ ...input, expectedRevision: 1, state: "RUNNING" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.queue).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.queue).toHaveBeenCalledTimes(1);
    expect(f.repo.claim).toHaveBeenCalledWith(OWNER, JOB, 2, new Date(BASE + 90_000));
  });

  it.each(["WAITING_CI", "WAITING_APPROVAL"] as const)("does not mistake %s for stalled work", async state => {
    const f = fixture(); await f.runtime.register(input);
    await f.runtime.update({ ...input, expectedRevision: 1, state });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(f.queue).not.toHaveBeenCalled(); expect(f.snapshot().state).toBe("EXPIRED");
  });

  it.each(["COMPLETED", "CANCELLED"] as const)("removes the deadline after %s", async state => {
    const f = fixture(); await f.runtime.register(input);
    await f.runtime.update({ ...input, expectedRevision: 1, state });
    await vi.advanceTimersByTimeAsync(900_000);
    expect(f.queue).not.toHaveBeenCalled(); expect(f.repo.claim).not.toHaveBeenCalled();
  });

  it("revalidates pairing permission and the kill switch at deadline", async () => {
    const denied = fixture(); await denied.runtime.register(input); denied.setAllowed(false);
    const disabled = fixture(); await disabled.runtime.register(input); disabled.setEnabled(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(denied.queue).not.toHaveBeenCalled(); expect(disabled.queue).not.toHaveBeenCalled();
  });

  it("a different replica winning the claim does not create another event", async () => {
    const f = fixture(); await f.runtime.register(input);
    f.repo.claim.mockImplementationOnce(async () => { f.setWatch({ state: "WAKE_QUEUED" }); return null; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.queue).not.toHaveBeenCalled(); expect(f.repo.get).toHaveBeenCalledOnce();
  });

  it("reuses a persisted event after an ambiguous queue failure and lease expiry", async () => {
    const f = fixture(); f.queue.mockRejectedValueOnce(new Error("network response lost"));
    await f.runtime.register(input);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.queue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.queue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.queue).toHaveBeenCalledTimes(2);
    expect(f.queue.mock.calls[0]).toEqual(f.queue.mock.calls[1]);
    expect(f.snapshot().state).toBe("WAKE_QUEUED");
  });

  it("restores one bounded durable deadline after process restart", async () => {
    const f = fixture(); f.repo.restore.mockResolvedValueOnce([f.snapshot()]);
    await f.runtime.start(); await f.runtime.start();
    expect(f.repo.restore).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.queue).toHaveBeenCalledTimes(1);
  });

  it("awaits authenticated callback persistence and retries a transient failure without resending", async () => {
    const f = fixture(); await f.runtime.register(input); await vi.advanceTimersByTimeAsync(60_000);
    f.repo.recordResult.mockRejectedValueOnce(new Error("temporary DB failure"));
    await f.emit(); expect(f.snapshot().state).toBe("WAKE_QUEUED");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.snapshot().state).toBe("WAKE_CONFIRMED");
    expect(f.queue).toHaveBeenCalledTimes(1); expect(f.repo.recordResult).toHaveBeenCalledTimes(2);
  });

  it("reconciles committed worker evidence on status and before a new checkpoint", async () => {
    const f = fixture(); await f.runtime.register(input); await vi.advanceTimersByTimeAsync(60_000);
    f.repo.reconcile.mockImplementation(async () => { f.setWatch({ state: "WAKE_CONFIRMED" }); return f.snapshot(); });
    expect((await f.runtime.get(OWNER, JOB))?.state).toBe("WAKE_CONFIRMED");
    await f.runtime.update({ ...input, expectedRevision: 1, state: "COMPLETED" });
    expect(f.repo.reconcile).toHaveBeenCalledTimes(2); expect(f.queue).toHaveBeenCalledTimes(1);
  });

  it("expires a queued watch without queuing a replacement", async () => {
    const f = fixture(); await f.runtime.register(input);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(f.snapshot().state).toBe("EXPIRED"); expect(f.queue).toHaveBeenCalledTimes(1);
  });

  it("shutdown cancels timers and event listeners", async () => {
    const f = fixture(); await f.runtime.register(input); f.runtime.stop();
    await vi.advanceTimersByTimeAsync(900_000); await f.emit();
    expect(f.queue).not.toHaveBeenCalled(); expect(f.repo.recordResult).not.toHaveBeenCalled();
  });
  it("awaits an asynchronous exact-binding denial before registering a watch", async () => {
    const f = fixture(undefined, async () => false);
    await expect(f.runtime.register(input)).rejects.toThrow("DEV_CONTINUITY_DENIED");
    expect(f.repo.register).not.toHaveBeenCalled();
    expect(f.queue).not.toHaveBeenCalled();
  });

  it("does not rearm after shutdown while the binding lookup is pending", async () => {
    let release!: (value: boolean) => void;
    let checking!: () => void;
    const reached = new Promise<void>(resolve => { checking = resolve; });
    const allowed = new Promise<boolean>(resolve => { release = resolve; });
    const f = fixture(undefined, () => { checking(); return allowed; });
    f.repo.restore.mockResolvedValueOnce([f.snapshot()]);
    const starting = f.runtime.start();
    await reached;
    f.runtime.stop();
    release(true);
    await starting;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(900_000);
    expect(f.queue).not.toHaveBeenCalled();
  });

});
