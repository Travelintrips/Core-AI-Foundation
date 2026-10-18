import { describe, expect, it } from "vitest";
import { verifyWakeCallback, wakeIdempotencyKey, type WakeJobIdentity } from "../services/aiCoreChatGptWakeAckService.js";

const identity: WakeJobIdentity = {
  jobId: "job-001", accountId: "account-001", conversationId: "chat-001",
  workerId: "worker-001", instruction: "cek",
  command: { accountAlias: "GPT01", jobAlias: null, instruction: "cek" },
};
const callback = {
  jobId: "job-001", accountId: "account-001", conversationId: "chat-001",
  workerId: "worker-001", acknowledgedJobId: "job-001",
  messageSentAt: "2026-10-18T10:00:00Z", responseReceivedAt: "2026-10-18T10:00:01Z",
  responseText: "ACK",
};
describe("wake callback verification", () => {
  it("accepts a correlated authenticated callback", () => {
    expect(verifyWakeCallback(identity, callback, "worker-001")).toEqual({ ok: true, state: "ACK_VERIFIED" });
  });
  it("rejects unverified worker and mismatched job or session", () => {
    expect(verifyWakeCallback(identity, callback, null).ok).toBe(false);
    expect(verifyWakeCallback(identity, { ...callback, acknowledgedJobId: "other" }, "worker-001").ok).toBe(false);
    expect(verifyWakeCallback(identity, { ...callback, conversationId: "other" }, "worker-001").ok).toBe(false);
  });
  it("rejects empty response and reversed timeline", () => {
    expect(verifyWakeCallback(identity, { ...callback, responseText: " " }, "worker-001").ok).toBe(false);
    expect(verifyWakeCallback(identity, { ...callback, responseReceivedAt: "2026-10-17T10:00:00Z" }, "worker-001").ok).toBe(false);
  });
  it("uses a stable key bound to job and session", () => {
    expect(wakeIdempotencyKey(identity)).toBe(wakeIdempotencyKey(identity));
    expect(wakeIdempotencyKey(identity)).not.toBe(wakeIdempotencyKey({ ...identity, jobId: "other" }));
  });
});
