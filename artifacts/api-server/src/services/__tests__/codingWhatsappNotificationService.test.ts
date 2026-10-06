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

import {
  notifyCodingBridgeResponse,
  sendCodingApprovalRequest,
  sendCodingApprovalResult,
  waitForCodingWhatsappDelivery,
} from "../codingWhatsappNotificationService.js";

describe("coding WhatsApp human-review-only policy", () => {
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

  it.each(["CHECKPOINT", "BLOCKER", "COMPLETED", "FAILED"] as const)(
    "does not send %s lifecycle notifications to admin WhatsApp",
    async (kind) => {
      const result = await notifyCodingBridgeResponse({
        responseId: "11111111-1111-4111-8111-111111111111",
        commandId: "22222222-2222-4222-8222-222222222222",
        taskId: "33333333-3333-4333-8333-333333333333",
        kind,
        message: `Lifecycle ${kind}`,
        checkpoint: { eventType: kind },
        eventTimestamp: "2026-10-06T07:18:00.000Z",
      });

      expect(result).toEqual({
        status: "skipped",
        reason: "human_review_only_policy",
        configured: { baseUrl: true, apiKey: true, to: true },
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );

  it("sends only the critical approval request with familiar Indonesian copy", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({ messageId: "msg-approval" }),
    });

    const result = await sendCodingApprovalRequest({
      approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      taskId: "33333333-3333-4333-8333-333333333333",
      actionType: "SECURITY_CHANGE",
      summary: "Perubahan ini menyentuh akses admin production.",
      token: "AbCdEfGhIjKlMnOpQr",
      expiresAt: "2026-10-06T08:00:00.000Z",
    });

    expect(result).toEqual({
      status: "queued",
      gatewayStatus: 202,
      messageId: "msg-approval",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://wa.example.test/v1/messages");
    expect(request.headers).toMatchObject({
      "idempotency-key": "ai-core-approval-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    const body = JSON.parse(String(request.body));
    expect(body.type).toBe("text");
    expect(body.text).toContain("Min, butuh keputusan dulu nih");
    expect(body.text).toContain("kategori kritis");
    expect(body.text).toContain("Task: CWS-TEST");
    expect(body.text).toContain("Project: Core AI");
    expect(body.text).toContain("Yang mau dijalanin: Perubahan keamanan atau hak akses");
    expect(body.text).toContain("Kenapa perlu dicek: Perubahan ini menyentuh akses admin production.");
    expect(body.text).toContain("Batas keputusan: 2026-10-06 15:00:00 WIB");
    expect(body.text).toContain("pilih APPROVE");
    expect(body.text).toContain("pilih REJECT");
    expect(body.text).toContain("https://aicore.example.test/api/a/AbCdEfGhIjKlMnOpQr");
  });

  it.each(["REJECTED", "EXECUTING", "COMPLETED", "FAILED"] as const)(
    "does not send approval result status %s",
    async (status) => {
      const result = await sendCodingApprovalResult({
        approvalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        taskId: "33333333-3333-4333-8333-333333333333",
        actionType: "SECURITY_CHANGE",
        status,
        message: "Update approval.",
      });

      expect(result).toEqual({
        status: "skipped",
        reason: "approval_result_notifications_disabled",
        configured: { baseUrl: true, apiKey: true, to: true },
      });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("surfaces the durable gateway error when a critical approval delivery fails", async () => {
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
});
