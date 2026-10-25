import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ inbox: vi.fn(), mcp: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: {}, PostgresPool: vi.fn(), resolveDatabaseUrl: vi.fn() }));
vi.mock("../aiCoreChatInboxService.js", () => ({ enqueueAiCoreChatInboxMessage: mocks.inbox }));
vi.mock("../aiCoreMcpEventWebhookService.js", () => ({ enqueueAiCoreMcpBridgeLifecycleEvent: mocks.mcp }));
vi.mock("../../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { assertDevReplayTarget, projectDevBridgeResponse } from "../../scripts/devBridgeFanoutReplayWorker.js";
import { replayErrorCode, replayOne, type DevBridgeFanoutReplayStore, type ReplayClaim } from "../devBridgeFanoutReplayStore.js";
const env = { APP_ENV: "development", NODE_ENV: "development", AI_DEV_BRIDGE_FANOUT_REPLAY_ENABLED: "true", SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co" };
const url = "postgresql://worker.xssrfshdrtdfupgqwfdw:unused@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";
const claim: ReplayClaim = { responseId: "r", commandId: "c", claimToken: "lease", attempts: 1,
  sink: "CHAT_INBOX", taskId: null, kind: "COMPLETED", message: "OK", checkpoint: {}, metadata: {}, createdAt: new Date() };

describe("DEV replay boundary", () => {
  it("accepts only the explicitly enabled verified DEV target", () => expect(() => assertDevReplayTarget(env, url)).not.toThrow());
  it.each([
    { APP_ENV: "production" }, { NODE_ENV: "production" },
    { AI_DEV_BRIDGE_FANOUT_REPLAY_ENABLED: "false" }, { SUPABASE_URL_DEV: "https://other.supabase.co" },
  ])("rejects disabled or production configuration %j", (change) => {
    expect(() => assertDevReplayTarget({ ...env, ...change }, url)).toThrow();
  });
  it.each(["postgresql://postgres:pw@127.0.0.1/db", url.replace("worker.xssrfshdrtdfupgqwfdw", "worker.other"), "https://example.com/db"])("rejects non-DEV database %s", (target) => {
    expect(() => assertDevReplayTarget(env, target)).toThrow();
  });
});

describe("projection is separate from callback delivery and ACK", () => {
  it("uses the existing idempotent Inbox projection", async () => {
    await projectDevBridgeResponse(claim);
    expect(mocks.inbox).toHaveBeenCalledWith(claim);
  });
  it("uses the existing stable MCP event key", async () => {
    await projectDevBridgeResponse({ ...claim, sink: "MCP_EVENT_QUEUE" });
    expect(mocks.mcp).toHaveBeenCalledWith(expect.objectContaining({ responseId: "r" }));
  });
  it("retains failed projections for durable retry, never marks them projected", async () => {
    const store = { claim: vi.fn().mockResolvedValue(claim), projected: vi.fn(), failed: vi.fn() };
    const error = new Error("sensitive upstream detail");
    expect(await replayOne(store as unknown as DevBridgeFanoutReplayStore, async () => { throw error; })).toBe("RETRY");
    expect(store.failed).toHaveBeenCalledWith(claim, error);
    expect(store.projected).not.toHaveBeenCalled();
  });
  it("does not acknowledge stale lease ownership as projected", async () => {
    const store = { claim: vi.fn().mockResolvedValue(claim), projected: vi.fn().mockResolvedValue(false), failed: vi.fn() };
    expect(await replayOne(store as unknown as DevBridgeFanoutReplayStore, async () => undefined)).toBe("RETRY");
  });
  it("redacts errors instead of persisting upstream text or credentials", () => {
    expect(replayErrorCode(new Error("postgresql://user:secret@host"))).toBe("PROJECTION_FAILED");
    expect(replayErrorCode({ code: "08006" })).toBe("08006");
    expect(replayErrorCode({ code: "secret with spaces" })).toBe("PROJECTION_FAILED");
  });
});
