import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  limit: vi.fn(),
  appendCodingBridgeResponse: vi.fn(),
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
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
  },
  aiCodingBridgeCommandsTable: {
    id: "commands.id",
    taskId: "commands.taskId",
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

vi.mock("../localCodingControlBridgeService.js", () => ({
  appendCodingBridgeResponse: mocks.appendCodingBridgeResponse,
}));

import { reportCodingTaskTerminalTransition } from "../codingTaskTerminalReportingService.js";

describe("coding task terminal reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.select.mockReturnValue(builder);
  });

  it("emits a COMPLETED bridge response for a bound task exactly once", async () => {
    mocks.limit
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
  });

  it("does nothing when the task has no lifecycle binding", async () => {
    mocks.limit.mockResolvedValueOnce([]);

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
      .mockResolvedValueOnce([{ id: "command-1" }])
      .mockResolvedValueOnce([])
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
