import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  limit: vi.fn(),
  appendCodingBridgeResponse: vi.fn(),
  dispatchExternalAgentWork: vi.fn(),
}));

const builder = {
  from: vi.fn(() => builder),
  where: vi.fn(() => builder),
  orderBy: vi.fn(() => builder),
  limit: mocks.limit,
};

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...conditions: unknown[]) => conditions),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
  },
  aiCodingTasksTable: {
    id: "tasks.id",
    status: "tasks.status",
  },
  aiCodingBridgeCommandsTable: {
    id: "commands.id",
    taskId: "commands.taskId",
    source: "commands.source",
    commandType: "commands.commandType",
    metadataJson: "commands.metadataJson",
    createdAt: "commands.createdAt",
  },
  aiCodingBridgeResponsesTable: {
    id: "responses.id",
    commandId: "responses.commandId",
    taskId: "responses.taskId",
    kind: "responses.kind",
    createdAt: "responses.createdAt",
  },
}));

vi.mock("../externalAgentDispatchService.js", () => ({
  OPENCLAW_AGENT_CLIENT_ID: "gcp-openclaw-main",
  dispatchExternalAgentWork: mocks.dispatchExternalAgentWork,
}));

vi.mock("../localCodingControlBridgeService.js", () => ({
  appendCodingBridgeResponse: mocks.appendCodingBridgeResponse,
}));

import {
  canonicalTerminalEventStatus,
  reportCodingTaskTerminalTransition,
} from "../codingTaskTerminalReportingService.js";

describe("coding task terminal reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue(builder);
  });


  it("uses the persisted terminal task status as the canonical event status", () => {
    expect(canonicalTerminalEventStatus("BLOCKED", "FAILED")).toBe("FAILED");
    expect(canonicalTerminalEventStatus("FAILED", "COMPLETED")).toBe("COMPLETED");
    expect(canonicalTerminalEventStatus("BLOCKED", "PENDING")).toBe("BLOCKED");
  });

  it("does not emit BLOCKED when the persisted task is already FAILED", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "FAILED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([]);
    mocks.appendCodingBridgeResponse.mockResolvedValue({ id: "response-failed" });

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "BLOCKED",
      message: "Task membutuhkan tindak lanjut.",
      source: "test-mismatch",
    });

    expect(result).toEqual({ reported: true, responseId: "response-failed" });
    expect(mocks.appendCodingBridgeResponse).toHaveBeenCalledWith({
      commandId: "command-1",
      taskId: "11111111-1111-4111-8111-111111111111",
      kind: "FAILED",
      message: "Task membutuhkan tindak lanjut.",
      checkpoint: {
        eventType: "FAILED",
        status: "FAILED",
        source: "test-mismatch",
      },
    });
  });

  it("emits a COMPLETED bridge response for a bound task exactly once", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([]);
    mocks.appendCodingBridgeResponse.mockResolvedValue({
      id: "response-1",
    });

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "COMPLETED",
      message: "Task selesai.",
      source: "test",
    });

    expect(result).toEqual({ reported: true, responseId: "response-1" });
    expect(mocks.appendCodingBridgeResponse).toHaveBeenCalledWith({
      commandId: "command-1",
      taskId: "11111111-1111-4111-8111-111111111111",
      kind: "COMPLETED",
      message: "Task selesai.",
      checkpoint: {
        eventType: "COMPLETED",
        status: "COMPLETED",
        source: "test",
      },
    });
    expect(builder.orderBy).toHaveBeenCalledWith(
      expect.objectContaining({
        values: ["commands.source", "commands.commandType"],
      }),
      "commands.createdAt",
    );
  });

  it("queues one OpenClaw wake for a conversation-bound terminal event", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([{
        id: "command-1",
        metadataJson: { conversationId: "conversation-a" },
      }])
      .mockResolvedValueOnce([]);
    mocks.appendCodingBridgeResponse.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
    });
    mocks.dispatchExternalAgentWork.mockResolvedValue({
      created: true,
      command: { id: "external-1" },
    });

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "COMPLETED",
      message: "Task selesai.",
      source: "test-wake",
    });

    expect(result).toEqual({
      reported: true,
      responseId: "22222222-2222-4222-8222-222222222222",
    });
    expect(mocks.dispatchExternalAgentWork).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchExternalAgentWork).toHaveBeenCalledWith({
      clientId: "gcp-openclaw-main",
      instruction: expect.stringContaining(
        "AI_CORE_WAKE:22222222-2222-4222-8222-222222222222",
      ),
      taskId: "11111111-1111-4111-8111-111111111111",
      source: "ai-core-chatgpt-wake",
      metadata: {
        conversationId: "conversation-a",
        sourceResponseId: "22222222-2222-4222-8222-222222222222",
        eventType: "COMPLETED",
        openClawChatgptWake: true,
        source: "test-wake",
      },
    });
  });

  it("emits a BLOCKED bridge response for a recoverable conflict exactly once", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "BLOCKED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([]);
    mocks.appendCodingBridgeResponse.mockResolvedValue({
      id: "response-blocked",
    });

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "BLOCKED",
      message: "Task menunggu konflik file selesai.",
      source: "coding-orchestrator-active-change-conflict",
    });

    expect(result).toEqual({ reported: true, responseId: "response-blocked" });
    expect(mocks.appendCodingBridgeResponse).toHaveBeenCalledWith({
      commandId: "command-1",
      taskId: "11111111-1111-4111-8111-111111111111",
      kind: "BLOCKER",
      message: "Task menunggu konflik file selesai.",
      checkpoint: {
        eventType: "BLOCKED",
        status: "BLOCKED",
        source: "coding-orchestrator-active-change-conflict",
      },
    });
  });

  it("does nothing when the task has no lifecycle binding", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([]);

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "COMPLETED",
      message: "Task selesai.",
    });

    expect(result).toEqual({ reported: false, reason: "NO_BINDING" });
    expect(mocks.appendCodingBridgeResponse).not.toHaveBeenCalled();
  });

  it("retries a transient database failure before persisting the terminal response", async () => {
    mocks.limit
      .mockRejectedValueOnce(new Error("temporary database error"))
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([]);
    mocks.appendCodingBridgeResponse.mockResolvedValue({
      id: "response-1",
    });

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "COMPLETED",
      message: "Task selesai.",
    });

    expect(result).toEqual({ reported: true, responseId: "response-1" });
    expect(mocks.appendCodingBridgeResponse).toHaveBeenCalledTimes(1);
  });

  it("repairs an ambiguous append without creating a duplicate response", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([{ id: "response-existing" }]);
    mocks.appendCodingBridgeResponse.mockRejectedValueOnce(
      new Error("connection dropped after persistence"),
    );

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "COMPLETED",
      message: "Task selesai.",
    });

    expect(result).toEqual({
      reported: false,
      reason: "ALREADY_REPORTED",
      responseId: "response-existing",
    });
    expect(mocks.appendCodingBridgeResponse).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a terminal response already persisted", async () => {
    mocks.limit
      .mockResolvedValueOnce([{ status: "COMPLETED" }])
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([{ id: "response-existing" }]);

    const result = await reportCodingTaskTerminalTransition({
      taskId: "11111111-1111-4111-8111-111111111111",
      status: "COMPLETED",
      message: "Task selesai.",
    });

    expect(result).toEqual({
      reported: false,
      reason: "ALREADY_REPORTED",
      responseId: "response-existing",
    });
    expect(mocks.appendCodingBridgeResponse).not.toHaveBeenCalled();
  });
});
