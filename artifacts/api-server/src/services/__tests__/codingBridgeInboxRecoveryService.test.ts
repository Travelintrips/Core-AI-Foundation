import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn() } }));
import {
  bridgeInboxRecoveryEnabled, createCodingBridgeInboxRecovery,
  inboxRecoveryAccessBlocked, type RecoverableBridgeResponse,
} from "../codingBridgeInboxRecoveryService.js";

const row: RecoverableBridgeResponse = {
  responseId: "response-1", commandId: "command-1", taskId: null,
  kind: "COMPLETED", message: "fixture result", checkpoint: {}, metadata: {},
};
function fixture(count = 1) {
  vi.useFakeTimers();
  const source = Array.from({ length: count }, (_, i) => ({ ...row, responseId: `response-${i}` }));
  const inbox = new Set<string>();
  const load = vi.fn(async (limit: number) => source.filter((r) => !inbox.has(r.responseId)).slice(0, limit));
  const project = vi.fn(async (r: RecoverableBridgeResponse) => { inbox.add(r.responseId); });
  const exists = vi.fn(async (id: string) => inbox.has(id));
  const report = vi.fn();
  const dependencies = { enabled: () => true, load, project, exists, report };
  return { source, inbox, load, project, exists, report, dependencies,
    runner: createCodingBridgeInboxRecovery(dependencies) };
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("DEV bridge Inbox crash recovery", () => {
  it("is opt-in and refuses production or disabled background runtime", () => {
    const env = { APP_ENV: "development", NODE_ENV: "test", AI_DEV_BRIDGE_INBOX_RECOVERY_ENABLED: "true" };
    expect(bridgeInboxRecoveryEnabled(env)).toBe(true);
    expect(bridgeInboxRecoveryEnabled({ ...env, NODE_ENV: "production" })).toBe(false);
    expect(bridgeInboxRecoveryEnabled({ ...env, APP_ENV: "production" })).toBe(false);
    expect(bridgeInboxRecoveryEnabled({ ...env, AI_DEV_BACKGROUND_RUNTIME_ENABLED: "false" })).toBe(false);
    expect(bridgeInboxRecoveryEnabled({ APP_ENV: "development" })).toBe(false);
  });
  it("recovers a source response left without an Inbox after commit", async () => {
    const f = fixture(); f.runner.start();
    expect(await f.runner.drain()).toMatchObject({ recovered: 1, failed: 0 });
    expect(f.inbox.size).toBe(1);
    expect(f.source).toHaveLength(1);
    expect(f.exists).toHaveBeenCalledWith("response-0");
    f.runner.stop();
  });
  it("does not duplicate the projection after runner recreation", async () => {
    const f = fixture(); f.runner.start(); await f.runner.drain(); f.runner.stop();
    const next = createCodingBridgeInboxRecovery(f.dependencies);
    next.start(); expect((await next.drain()).scanned).toBe(0); next.stop();
    expect(f.project).toHaveBeenCalledTimes(1);
    expect(f.source).toHaveLength(1);
  });
  it("recovers a lost insert response without inserting again", async () => {
    const f = fixture();
    f.project.mockImplementationOnce(async (r) => { f.inbox.add(r.responseId); throw new Error("connection lost after insert"); });
    f.runner.start(); expect((await f.runner.drain()).retained).toBe(true); f.runner.stop();
    const next = createCodingBridgeInboxRecovery(f.dependencies);
    next.start(); expect((await next.drain()).scanned).toBe(0); next.stop();
    expect(f.inbox.size).toBe(1);
    expect(f.project).toHaveBeenCalledTimes(1);
  });
  it("does not claim delivery when destination observation is absent", async () => {
    const f = fixture(); f.exists.mockResolvedValue(false); f.runner.start();
    expect(await f.runner.drain()).toMatchObject({ recovered: 0, failed: 1, retained: true });
    expect(f.report).not.toHaveBeenCalledWith(expect.objectContaining({ code: "INBOX_PROJECTION_VERIFIED" }));
    f.runner.stop();
  });
  it("retains the source on a transient failure and retries with backoff", async () => {
    const f = fixture(); f.project.mockRejectedValueOnce(new Error("temporary failure"));
    f.runner.start(); await f.runner.drain();
    expect(f.runner.status().scheduled).toBe(true);
    f.runner.wake();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(f.project).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.inbox.size).toBe(1);
    expect(f.source).toHaveLength(1); f.runner.stop();
  });
  it("does not retry access denial or conceal it as a network outage", async () => {
    const f = fixture(); f.load.mockRejectedValue({ cause: { code: "42501", message: "secret query omitted" } });
    f.runner.start(); await f.runner.drain(); f.runner.wake();
    await vi.advanceTimersByTimeAsync(500_000);
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.runner.status()).toMatchObject({ permissionBlocked: true, scheduled: false, retained: true });
    expect(f.report).toHaveBeenCalledWith(expect.objectContaining({ code: "INBOX_RECOVERY_ACCESS_BLOCKED" }));
    expect(JSON.stringify(f.report.mock.calls)).not.toContain("secret query"); f.runner.stop();
  });
  it("classifies nested authentication errors and cyclic causes safely", () => {
    expect(inboxRecoveryAccessBlocked({ cause: { code: "28P01" } })).toBe(true);
    expect(inboxRecoveryAccessBlocked({ code: "ECONNRESET" })).toBe(false);
    const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
    expect(inboxRecoveryAccessBlocked(cycle)).toBe(false);
  });
  it("stops automatic retries at the budget without deleting the source", async () => {
    const f = fixture(); f.project.mockRejectedValue(new Error("unavailable")); f.runner.start();
    for (let i = 0; i < 8; i += 1) await f.runner.drain();
    expect(f.runner.status()).toMatchObject({ consecutiveFailures: 8, scheduled: false, retained: true });
    expect(f.source).toHaveLength(1); expect(f.inbox.size).toBe(0);
    expect(f.report).toHaveBeenLastCalledWith(expect.objectContaining({ code: "INBOX_RECOVERY_RETAINED" })); f.runner.stop();
  });
  it("drains multiple batches, then stays idle without a polling timer", async () => {
    const f = fixture(10); f.runner.start(); await vi.runAllTimersAsync();
    expect(f.inbox.size).toBe(10); expect(f.load).toHaveBeenCalledTimes(2);
    expect(f.runner.status().scheduled).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000); expect(f.load).toHaveBeenCalledTimes(2); f.runner.stop();
  });
  it("keeps a wake received while a query is in flight", async () => {
    const f = fixture(0); let resolve!: (rows: RecoverableBridgeResponse[]) => void;
    f.load.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    f.runner.start(); const pending = f.runner.drain(); f.runner.wake(); resolve([]); await pending;
    expect(f.runner.status().scheduled).toBe(true);
    await vi.runAllTimersAsync(); expect(f.load).toHaveBeenCalledTimes(2); f.runner.stop();
  });
  it("stops scheduled work when shutdown is requested", async () => {
    const f = fixture(); f.runner.start(); f.runner.stop(); await vi.runAllTimersAsync();
    expect(f.load).not.toHaveBeenCalled();
  });
});
