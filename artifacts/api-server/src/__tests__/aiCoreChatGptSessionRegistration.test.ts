import { describe, expect, it } from "vitest";
import { planChatGptSessionRegistration } from "../services/aiCoreChatGptSessionRegistrationService.js";
const one = {
  accountAlias: "GPT01", jobAlias: "JOB01",
  conversationId: "6ad4a482-5368-83ec-a520-43a4b08d38a6",
  conversationUrl: "https://chatgpt.com/c/6ad4a482-5368-83ec-a520-43a4b08d38a6",
  sessionAttested: true,
};
const two = {
  ...one, jobAlias: "JOB02", conversationId: "6ad35019-a2f8-83ec-98f5-820a469b5b33",
  conversationUrl: "https://chatgpt.com/c/6ad35019-a2f8-83ec-98f5-820a469b5b33",
};
describe("ChatGPT job session registration", () => {
  it("plans first verified binding and idempotent registration", () => {
    expect(planChatGptSessionRegistration({ candidate: one, existingForJob: null, existingForConversation: null }).action).toBe("INSERT");
    expect(planChatGptSessionRegistration({ candidate: one, existingForJob: one, existingForConversation: one }).action).toBe("EXISTS");
  });
  it("prevents sharing one conversation across jobs", () => {
    expect(planChatGptSessionRegistration({ candidate: { ...one, jobAlias: "JOB02" }, existingForJob: null, existingForConversation: one })).toEqual({ action: "BLOCK", reason: "CONVERSATION_ALREADY_ASSIGNED" });
  });
  it("prevents rebinding an existing job", () => {
    expect(planChatGptSessionRegistration({ candidate: two, existingForJob: one, existingForConversation: null })).toEqual({ action: "BLOCK", reason: "BINDING_CONFLICT" });
  });
  it("rejects unverified browser session", () => {
    expect(planChatGptSessionRegistration({ candidate: { ...one, sessionAttested: false }, existingForJob: null, existingForConversation: null })).toEqual({ action: "BLOCK", reason: "UNVERIFIED_SESSION" });
  });
});
