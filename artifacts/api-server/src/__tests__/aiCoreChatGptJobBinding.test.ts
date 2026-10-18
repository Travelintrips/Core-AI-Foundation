import { describe, expect, it } from "vitest";
import { resolveChatGptJobConversation } from "../services/aiCoreChatGptJobBindingService.js";

const existing = {
  accountAlias: "GPT01", jobAlias: "JOB001",
  conversationId: "6ad4a482-5368-83ec-a520-43a4b08d38a6",
  conversationUrl: "https://chatgpt.com/c/6ad4a482-5368-83ec-a520-43a4b08d38a6",
  sessionAttested: true,
};
describe("one job per conversation", () => {
  it("creates a new conversation when job has no binding", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB002", existing: null })).toEqual({
      action: "CREATE_NEW", accountAlias: "GPT01", jobAlias: "JOB002",
    });
  });
  it("reuses only its own verified session", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB001", existing })).toEqual({ action: "REUSE", binding: existing });
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB002", existing })).toEqual({ action: "BLOCK", reason: "BINDING_CONFLICT" });
  });
  it("blocks unattested or inconsistent conversation bindings", () => {
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB001", existing: { ...existing, sessionAttested: false } })).toEqual({ action: "BLOCK", reason: "UNVERIFIED_SESSION" });
    expect(resolveChatGptJobConversation({ accountAlias: "GPT01", jobAlias: "JOB001", existing: { ...existing, conversationId: "wrong" } })).toEqual({ action: "BLOCK", reason: "INVALID_CONVERSATION" });
  });
});
