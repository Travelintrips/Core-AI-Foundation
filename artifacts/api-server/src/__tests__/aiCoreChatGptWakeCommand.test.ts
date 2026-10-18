import { describe, expect, it } from "vitest";
import { parseChatGptWakeCommand, verifyWakeDispatchBinding } from "../services/aiCoreChatGptWakeCommandService.js";

describe("ChatGPT wake command parser", () => {
  it("parses account and job aliases", () => {
    expect(parseChatGptWakeCommand("*gpt01-job005 lanjutkan")).toEqual({
      accountAlias: "GPT01", jobAlias: "JOB005", instruction: "lanjutkan",
    });
    expect(parseChatGptWakeCommand("*GPT02 cek")).toEqual({
      accountAlias: "GPT02", jobAlias: null, instruction: "cek",
    });
  });
  it("rejects malformed or multiline instructions", () => {
    for (const text of ["*GPT01", "*GPT1 cek", "*GPT01-JOB5 cek", "*GPT01 cek\nother", "*GPT01 \u0000"]) {
      expect(parseChatGptWakeCommand(text)).toBeNull();
    }
  });
  it("fails closed when session or worker is unverified", () => {
    const base = { accountId: "account", conversationId: "conversation", sessionVerified: true, workerId: "worker", workerAuthorized: true };
    expect(verifyWakeDispatchBinding(base).ok).toBe(true);
    expect(verifyWakeDispatchBinding({ ...base, sessionVerified: false })).toEqual({ ok: false, reason: "SESSION_NOT_VERIFIED" });
    expect(verifyWakeDispatchBinding({ ...base, workerAuthorized: false })).toEqual({ ok: false, reason: "WORKER_NOT_AUTHORIZED" });
    expect(verifyWakeDispatchBinding({ ...base, conversationId: null })).toEqual({ ok: false, reason: "SESSION_NOT_BOUND" });
  });
});
