import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { transaction: mocks.transaction } }));
import {
  canRecordDevAuthenticatedMcpRead,
  recordDevAuthenticatedMcpRead,
} from "./devAuthenticatedMcpReadHeartbeat.js";

const channel = "ai-engine-oauth:" + "a".repeat(64);
describe("authenticated DEV MCP event-read heartbeat", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENV", "development");
    mocks.execute.mockReset().mockResolvedValue({ rows: [{ client_id: "chatgpt:" + channel }] });
    mocks.transaction.mockReset().mockImplementation(async (callback) =>
      callback({ execute: mocks.execute }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("only accepts a server-derived OAuth owner and DEV environment", () => {
    expect(canRecordDevAuthenticatedMcpRead({
      environment: "development", identityKind: "oauth", conversationId: channel,
    })).toBe(true);
    for (const input of [
      { environment: "production", identityKind: "oauth", conversationId: channel },
      { environment: "development", identityKind: "legacy", conversationId: channel },
      { environment: "development", identityKind: "oauth", conversationId: "somebody-else" },
      { environment: "development", identityKind: "oauth", conversationId: "ai-engine-oauth:" + "g".repeat(64) },
    ]) expect(canRecordDevAuthenticatedMcpRead(input)).toBe(false);
  });
  it("never touches DEV database outside DEV or with an invalid OAuth channel", async () => {
    vi.stubEnv("APP_ENV", "production");
    expect(await recordDevAuthenticatedMcpRead(channel)).toBe(false);
    vi.stubEnv("APP_ENV", "development");
    expect(await recordDevAuthenticatedMcpRead("client-supplied-name")).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("records an existing owner-scoped read without subscription renewal or ACK", async () => {
    expect(await recordDevAuthenticatedMcpRead(channel)).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    const sqlFragments = mocks.execute.mock.calls.map(x => String(x[0]?.queryChunks ?? ""));
    expect(sqlFragments.join(" ")).toContain("ai_coding_bridge_presence");
    expect(sqlFragments.join(" ")).toContain("lastAuthenticatedMcpReadAt");
    expect(sqlFragments.join(" ")).not.toContain("acknowledged_at");
    expect(sqlFragments.join(" ")).not.toContain("lease_expires_at =");
  });
  it("reports false when no previously authenticated subscription is updated", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    expect(await recordDevAuthenticatedMcpRead(channel)).toBe(false);
  });
});
