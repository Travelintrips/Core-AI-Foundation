import { describe, expect, it } from "vitest";
import { resolveChatGptJobConversation } from "../services/aiCoreChatGptJobBindingService.js";

/**
 * Regression fence for the planned GPT01/JOB01 routing.
 * These tests do not assert a browser session has actually been created.
 */
describe("GPT alias session separation", () => {
  const session = {
    accountAlias: "GPT01", jobAlias: "JOB01",
    conversationId: "6ad4a482-5368-83ec-a520-43a4b08d38a6",
    conversationUrl: "https://chatgpt.com/c/6ad4a482-5368-83ec-a520-43a4b08d38a6",
    sessionAttested: true,
  };
  it("keeps JOB01 bound to its own conversation", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB01", existing: session })).toEqual({ action: "REUSE", binding: session });
  });
  it("rejects reusing JOB01 conversation for JOB02", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB02", existing: session })).toEqual({ action: "BLOCK", reason: "BINDING_CONFLICT" });
  });
  it("requires new conversation allocation when JOB02 has no binding", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB02", existing: null })).toEqual({ action: "CREATE_NEW", accountAlias: "GPT01", jobAlias: "JOB02" });
  });
  it("rejects cross-account reuse even when job alias matches", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT02", jobAlias: "JOB01", existing: session })).toEqual({ action: "BLOCK", reason: "BINDING_CONFLICT" });
  });
});
