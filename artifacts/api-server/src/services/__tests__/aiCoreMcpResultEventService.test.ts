import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ submit: vi.fn(), append: vi.fn() }));
vi.mock("../localCodingControlBridgeService.js", () => ({
  submitCodingBridgeCommand: bridge.submit,
  appendCodingBridgeResponse: bridge.append,
}));
import { recordAiCoreMcpTerminalResult } from "../aiCoreMcpResultEventService.js";

describe("MCP terminal result events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.submit.mockResolvedValue({ command: { id: "binding-id" } });
    bridge.append.mockResolvedValue({ id: "response-id" });
  });

  it("binds a synchronous answer to the originating conversation", async () => {
    await recordAiCoreMcpTerminalResult({ conversationId: "conversation-a", instruction: "ping", payload: { kind: "answer", route: "LOCAL", reply: "OK" } });
    expect(bridge.submit).toHaveBeenCalledWith(expect.objectContaining({
      commandType: "EVENT_BINDING", metadata: { conversationId: "conversation-a", passiveEventBinding: true },
    }));
    expect(bridge.append).toHaveBeenCalledWith(expect.objectContaining({ commandId: "binding-id", kind: "COMPLETED", message: "OK" }));
  });

  it("publishes the actual worker failure instead of successful completion", async () => {
    await recordAiCoreMcpTerminalResult({ conversationId: "conversation-a", instruction: "run tests", payload: { kind: "agent_execution", execution: { status: "FAILED" }, reply: "worker failed", jobId: 2832 } });
    expect(bridge.append).toHaveBeenCalledWith(expect.objectContaining({ kind: "FAILED", checkpoint: { eventType: "FAILED", status: "FAILED" } }));
  });

  it.each([
    { kind: "agent", taskId: "task-id", status: "ANALYZING" },
    { kind: "external_agent", commandId: "command-id" },
    { kind: "multi_agent", tasks: [] },
    { kind: "agent_execution", status: "RUNNING" },
  ])("does not report queued work as complete: %j", async (payload) => {
    await recordAiCoreMcpTerminalResult({ conversationId: "conversation-a", instruction: "work", payload });
    expect(bridge.append).not.toHaveBeenCalled();
  });

  it("does not publish a NO_LLM answer as success", async () => {
    await recordAiCoreMcpTerminalResult({ conversationId: "conversation-a", instruction: "ping", payload: { kind: "answer", route: "NO_LLM", reply: "unavailable" } });
    expect(bridge.append).toHaveBeenCalledWith(expect.objectContaining({ kind: "FAILED" }));
  });

  it("leaves commands without a conversation unbound", async () => {
    await recordAiCoreMcpTerminalResult({ instruction: "ping", payload: { kind: "answer" } });
    expect(bridge.submit).not.toHaveBeenCalled();
  });
});
