import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  fetch: vi.fn(),
}));

const selectBuilder = {
  from: vi.fn(() => selectBuilder),
  where: vi.fn(() => selectBuilder),
  limit: mocks.limit,
};

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mocks.execute,
    select: mocks.select,
  },
  aiCodingTasksTable: {
    id: "tasks.id",
    taskNumber: "tasks.taskNumber",
    projectName: "tasks.projectName",
    repository: "tasks.repository",
    branch: "tasks.branch",
    resultSummary: "tasks.resultSummary",
  },
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { notifyCodingBridgeResponse, waitForCodingWhatsappDelivery } from "../codingWhatsappNotificationService.js";

describe("coding WhatsApp lifecycle notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CST_WA_GATEWAY_URL = "https://wa.example.test";
    process.env.CST_WA_GATEWAY_API_KEY = "secret";
    process.env.AI_CODING_WA_NOTIFY_TO = "628123456789";
    process.env.AI_CORE_PUBLIC_API_URL = "https://aicore.example.test";

    mocks.select.mockReturnValue(selectBuilder);
    mocks.limit.mockResolvedValue([
      {
        taskNumber: "CWS-TEST",
        projectName: "Core AI",
        repository: "Travelintrips/Core-AI-Foundation",
        branch: "main",
        resultSummary: "Selesai.",
      },
    ]);
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("uses a stable task/status idempotency key and persisted WIB timestamp", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ messageId: "msg-1" }),
    });

    const result = await notifyCodingBridgeResponse({
      responseId: "11111111-1111-4111-8111-111111111111",
      commandId: "22222222-2222-4222-8222-222222222222",
      taskId: "33333333-3333-4333-8333-333333333333",
      kind: "COMPLETED",
      message: "Coding task selesai.",
      checkpoint: { eventType: "COMPLETED" },
      eventTimestamp: "2026-10-06T07:18:00.000Z",
    });

    expect(result).toMatchObject({
      status: "queued",
      messageId: "msg-1",
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://wa.example.test/v1/messages");
    expect(request.headers).toMatchObject({
      "idempotency-key":
        "ai-core-coding-33333333-3333-4333-8333-333333333333-completed",
    });

    const body = JSON.parse(String(request.body));
    expect(body.clientMessageId).toBe(
      "ai-core-coding-33333333-3333-4333-8333-333333333333-completed",
    );
    expect(body.text).toContain("Timestamp: 2026-10-06 14:18:00 WIB");
  });

  it("surfaces the durable gateway error when delivery fails", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: "failed",
        error: "WhatsApp device primary-01 is not online",
      }),
    });

    const result = await waitForCodingWhatsappDelivery("msg-failed", {
      timeoutMs: 1_000,
      pollIntervalMs: 250,
    });

    expect(result).toEqual({
      status: "failed",
      messageId: "msg-failed",
      reason: "WhatsApp device primary-01 is not online",
    });
  });

  it("suppresses a lifecycle notification already delivered for the same task/status", async () => {
    mocks.execute.mockResolvedValue({
      rows: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          message_id: "msg-existing",
        },
      ],
    });

    const result = await notifyCodingBridgeResponse({
      responseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      taskId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      kind: "BLOCKER",
      message: "Masih terblokir.",
      checkpoint: { eventType: "BLOCKED" },
      eventTimestamp: "2026-10-06T07:18:00.000Z",
    });

    expect(result).toEqual({
      status: "skipped",
      reason: "duplicate_lifecycle_notification",
      configured: { baseUrl: true, apiKey: true, to: true },
      duplicateOfResponseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      duplicateMessageId: "msg-existing",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
