import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  state: vi.fn(),
}));

vi.mock("../externalAgentRegistryService.js", () => ({
  EXTERNAL_AGENT_POLICY_VERSION: "test-policy",
  getExternalAgentRule: () => ({
    role: "bounded_orchestration_agent",
    capabilities: ["tools:bounded"],
    permissions: {},
  }),
  getExternalAgentRegistrySnapshot: vi.fn().mockResolvedValue([
    { clientId: "openclaw-vps-main", eligible: true },
  ]),
}));

vi.mock("../localCodingControlBridgeService.js", () => ({
  submitCodingBridgeCommand: mocks.submit,
  getCodingBridgeCommandExecutionState: mocks.state,
}));

describe("external agent conversation lifecycle binding", () => {
  it("preserves ChatGPT conversation metadata on the durable bridge command", async () => {
    mocks.submit.mockResolvedValue({
      created: true,
      command: {
        id: "11111111-1111-4111-8111-111111111111",
        externalCommandId: "ai-core-agent-test",
        status: "RECEIVED",
      },
    });

    const { dispatchExternalAgentWork } = await import("../externalAgentDispatchService.js");
    await dispatchExternalAgentWork({
      clientId: "gcp-openclaw-main",
      instruction: "cek",
      source: "ai-core-chat",
      metadata: {
        conversationId: "conversation-a",
        repository: "Travelintrips/Core-AI-Foundation",
        projectName: "Core AI Foundation",
        branch: "main",
      },
    });

    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      source: "ai-core-chat",
      commandType: "EXTERNAL_AGENT_WORK",
      assignedClientId: "openclaw-vps-main",
      metadata: expect.objectContaining({
        conversationId: "conversation-a",
        repository: "Travelintrips/Core-AI-Foundation",
        projectName: "Core AI Foundation",
        branch: "main",
        executionBoundary: "role-scoped",
      }),
    }));
  });

  it("keeps the AI Core chat route wired to conversation metadata", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../routes/ai-core-chat.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      '...(input.conversationId ? { conversationId: input.conversationId } : {})',
    );
    expect(source).toContain(
      'metadata: {\n      ...(input.conversationId ? { conversationId: input.conversationId } : {})',
    );
    expect(source).toContain('"chat-no-tools"');
    expect(source).toContain('"pc-tools"');
    expect(source).toContain("[AI_CORE_CHAT_NO_TOOLS]");
  });
});
