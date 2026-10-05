import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submitCodingBridgeCommand: vi.fn(),
}));

vi.mock("../localCodingControlBridgeService.js", () => ({
  submitCodingBridgeCommand: mocks.submitCodingBridgeCommand,
}));

import {
  AI_CORE_TERMINAL_REPORT_EVENT_TYPES,
  bindAiCoreTaskLifecycleReporting,
} from "../aiCoreTaskLifecycleBindingService.js";

describe("AI Core task lifecycle reporting binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submitCodingBridgeCommand.mockResolvedValue({
      command: { id: "bridge-command" },
      created: true,
    });
  });

  it("binds terminal reporting even when no conversation id is available", async () => {
    await bindAiCoreTaskLifecycleReporting({
      taskId: "11111111-1111-4111-8111-111111111111",
    });

    expect(mocks.submitCodingBridgeCommand).toHaveBeenCalledWith({
      externalCommandId:
        "ai-core-task-lifecycle:11111111-1111-4111-8111-111111111111",
      instruction: "Passive lifecycle reporting binding for AI Core task.",
      taskId: "11111111-1111-4111-8111-111111111111",
      source: "ai-core-task-lifecycle",
      commandType: "EVENT_BINDING",
      metadata: {
        passiveEventBinding: true,
        eventTypes: [...AI_CORE_TERMINAL_REPORT_EVENT_TYPES],
      },
    });
  });

  it("keeps the conversation id when the task came from a persistent chat", async () => {
    await bindAiCoreTaskLifecycleReporting({
      taskId: "22222222-2222-4222-8222-222222222222",
      conversationId: "conversation-42",
    });

    expect(mocks.submitCodingBridgeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          conversationId: "conversation-42",
          passiveEventBinding: true,
          eventTypes: [
            "COMPLETED",
            "FAILED",
            "BLOCKED",
            "MERGED",
            "DEPLOYED",
          ],
        },
      }),
    );
  });
});
