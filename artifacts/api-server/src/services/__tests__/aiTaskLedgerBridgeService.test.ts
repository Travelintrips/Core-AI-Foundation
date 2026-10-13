import { describe, expect, it, vi } from "vitest";
import {
  ledgerBridgeEnabled,
  ledgerRequestUrl,
  registerAiTaskLedgerJob,
  validateLedgerJob,
} from "../aiTaskLedgerBridgeService.js";

const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  AI_TASK_LEDGER_SYNC_ENABLED: "true",
  AI_TASK_BRIDGE_TOKEN: "test-secret-must-be-at-least-32-characters-long",
  AI_TASK_LEDGER_URL: "https://ai-task.cstlogistic.co.id",
};
const task = { externalId: "coding-task:task-123", title: "AI Core coding task CWS-123", sessionId: "session-1" };
const response = (status: number, data: unknown) =>
  ({ status, json: async () => data }) as Response;
const accepted = (created: boolean) =>
  ({ accepted: true, created, task: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    source: "AI_CORE",
    external_id: task.externalId,
    status: "QUEUED",
  } });

describe("AI Task passive ledger bridge", () => {
  it("is off by default and never issues a network request", async () => {
    const fetcher = vi.fn();
    expect(ledgerBridgeEnabled({})).toBe(false);
    const result = await registerAiTaskLedgerJob(task, {}, fetcher as unknown as typeof fetch);
    expect(result).toEqual({ synced: false, reason: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects invalid external IDs and oversized titles", () => {
    expect(validateLedgerJob({ ...task, externalId: " " })).toBe(false);
    expect(validateLedgerJob({ ...task, title: "x".repeat(301) })).toBe(false);
    expect(validateLedgerJob(task)).toBe(true);
  });

  it("only permits the real production destination over HTTPS", () => {
    expect(ledgerRequestUrl(env)).toBe("https://ai-task.cstlogistic.co.id/api/bridge/jobs");
    expect(ledgerRequestUrl({ ...env, AI_TASK_LEDGER_URL: "https://evil.example/" })).toBeNull();
    expect(ledgerRequestUrl({ ...env, AI_TASK_LEDGER_URL: "http://ai-task.cstlogistic.co.id/" })).toBeNull();
    expect(ledgerRequestUrl({ ...env, AI_TASK_LEDGER_URL: "https://ai-task.cstlogistic.co.id/?token=foo" })).toBeNull();
    expect(ledgerRequestUrl({ ...env, AI_TASK_LEDGER_URL: "https://dev-ai-task.cstlogistic.co.id/" })).toBeNull();
  });

  it("does not send requests without an authenticating token", async () => {
    const fetcher = vi.fn();
    expect(await registerAiTaskLedgerJob(task, { ...env, AI_TASK_BRIDGE_TOKEN: "" }, fetcher as unknown as typeof fetch))
      .toEqual({ synced: false, reason: "unconfigured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("registers the task with stable idempotency and never requests dispatch", async () => {
    const fetcher = vi.fn(async () => response(201, accepted(true)));
    const result = await registerAiTaskLedgerJob(task, env, fetcher as unknown as typeof fetch);
    expect(result).toMatchObject({ synced: true, created: true });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ai-task.cstlogistic.co.id/api/bridge/jobs");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toMatchObject({
      source: "AI_CORE", externalId: task.externalId, idempotencyKey: task.externalId,
      sessionId: task.sessionId,
    });
  });

  it("treats idempotent replay as success", async () => {
    const fetcher = vi.fn(async () => response(200, accepted(false)));
    expect(await registerAiTaskLedgerJob(task, env, fetcher as unknown as typeof fetch))
      .toMatchObject({ synced: true, created: false });
  });

  it("fails safely on network errors, HTTP errors and inconsistent receipts", async () => {
    const network = vi.fn(async () => { throw new Error("fake secret debug"); });
    const badStatus = vi.fn(async () => response(403, { error: "forbidden" }));
    const wrongTask = vi.fn(async () => response(201, { accepted: true, created: true, task: { source: "AI_CORE", external_id: "wrong", id: "not-trusted" } }));
    expect(await registerAiTaskLedgerJob(task, env, network as unknown as typeof fetch))
      .toEqual({ synced: false, reason: "network_error" });
    expect(await registerAiTaskLedgerJob(task, env, badStatus as unknown as typeof fetch))
      .toEqual({ synced: false, reason: "remote_error" });
    expect(await registerAiTaskLedgerJob(task, env, wrongTask as unknown as typeof fetch))
      .toEqual({ synced: false, reason: "remote_error" });
  });
});
