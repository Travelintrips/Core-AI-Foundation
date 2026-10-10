import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classifyAiCoreChatDispatch } from "../aiCoreChatIntentService.js";

const chat = readFileSync(new URL("../../routes/ai-core-chat.ts", import.meta.url), "utf8");
const mcp = readFileSync(new URL("../../routes/ai-core-mcp.ts", import.meta.url), "utf8");

describe("owner-authorized AI Core Chat coding lane", () => {
  it("recognizes coding intent without imposing an unconditional ban", () => {
    const decision = classifyAiCoreChatDispatch("Perbaiki kode login dan update repository");
    expect(["GITHUB_DIRECT_REQUIRED", "CONTROL_PLANE"]).toContain(decision.kind);
    expect(chat).not.toContain("isAiCoreCodingCommandBlocked(parsed.data.message)");
    expect(mcp).not.toContain("isAiCoreCodingCommandBlocked(command.instruction)");
  });
  it("routes direct coding to tracked control-plane tasks", () => {
    expect(chat).toContain('if (decision.kind === "GITHUB_DIRECT_REQUIRED") {\n    return { ...(await startAgentTask(');
    expect(chat).toContain('rawDispatch.kind === "GITHUB_DIRECT_REQUIRED"\n            ? await startAgentTask(effectiveInput)');
    expect(chat).toContain("if (!input.projectName || !input.repository || !input.branch)");
  });
  it("preserves agent and MCP confirmation gates", () => {
    expect(chat).toContain('reason: "missing_execution_prefix"');
    expect(mcp).toContain("if (!effectiveConfirmed)");
  });
});
