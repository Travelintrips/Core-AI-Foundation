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
  db: { execute: mocks.execute, select: mocks.select },
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
  logger: { info: vi.fn(), warn: vi.fn() },
}));
import { notifyCodingBridgeResponse } from "../codingWhatsappNotificationService.js";

const base = {
  responseId: "11111111-1111-4111-8111-111111111111",
  commandId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  kind: "COMPLETED" as const,
  message: "Task completed",
};

describe("verified COMPLETED WhatsApp rollout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_CODING_WA_VERIFIED_COMPLETED_ENABLED = "true";
    process.env.CST_WA_GATEWAY_URL = "https://wa.example.test";
    process.env.CST_WA_GATEWAY_API_KEY = "test";
    process.env.AI_CODING_WA_NOTIFY_TO = "628123456789";
    mocks.select.mockReturnValue(selectBuilder);
    mocks.limit.mockResolvedValue([{ taskNumber: "CWS-TEST", projectName: "Core AI", repository: "Travelintrips/Core-AI-Foundation", branch: "main", resultSummary: "OK" }]);
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.fetch.mockResolvedValue({ ok: true, status: 202, json: async () => ({ messageId: "test-msg" }) });
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("rejects a partial-green completion", async () => {
    const result = await notifyCodingBridgeResponse({
      ...base,
      metadata: { verifiedCompletion: { requiredChecksPassed: true, merged: true, deployed: false, productionE2ePassed: false } },
    });
    expect(result).toMatchObject({ status: "skipped", reason: "trusted_completion_verifier_unavailable" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a status string without an attestation", async () => {
    const result = await notifyCodingBridgeResponse(base);
    expect(result).toMatchObject({ status: "skipped", reason: "trusted_completion_verifier_unavailable" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects forged fully green completion metadata without trusted evidence", async () => {
    const result = await notifyCodingBridgeResponse({
      ...base,
      metadata: { verifiedCompletion: { requiredChecksPassed: true, merged: true, deployed: true, productionE2ePassed: true } },
    });
    expect(result).toMatchObject({ status: "skipped", reason: "trusted_completion_verifier_unavailable" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
