import { createHash, timingSafeEqual } from "node:crypto";
import type { ChatGptWakeCommand } from "./aiCoreChatGptWakeCommandService.js";

export type WakeJobState =
  | "PENDING" | "DISPATCHED" | "MESSAGE_SENT" | "RESPONSE_RECEIVED"
  | "ACK_VERIFIED" | "COMPLETED" | "FAILED";

export type WakeJobIdentity = {
  jobId: string;
  accountId: string;
  conversationId: string;
  workerId: string;
  instruction: string;
  command: ChatGptWakeCommand;
};

export type WakeCallbackEvidence = {
  jobId: string;
  accountId: string;
  conversationId: string;
  workerId: string;
  messageSentAt: string;
  responseReceivedAt: string;
  responseText: string;
  acknowledgedJobId: string;
};

export function wakeIdempotencyKey(identity: WakeJobIdentity): string {
  return createHash("sha256").update(JSON.stringify([
    identity.jobId, identity.accountId, identity.conversationId,
    identity.workerId, identity.instruction,
  ])).digest("hex");
}

function sameIdentity(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * ACK is only verified after a trusted, authenticated callback transport has
 * validated the worker credentials. This function does not authenticate transport.
 * Never infer success from an LLM-generated ACK string alone.
 */
export function verifyWakeCallback(
  identity: WakeJobIdentity,
  callback: WakeCallbackEvidence,
  authenticatedWorkerId: string | null,
): { ok: true; state: "ACK_VERIFIED" } | { ok: false; state: "FAILED"; reason: string } {
  if (!authenticatedWorkerId || !sameIdentity(identity.workerId, authenticatedWorkerId)) {
    return { ok: false, state: "FAILED", reason: "UNAUTHENTICATED_WORKER" };
  }
  if (!sameIdentity(identity.jobId, callback.jobId) ||
      !sameIdentity(identity.jobId, callback.acknowledgedJobId) ||
      !sameIdentity(identity.accountId, callback.accountId) ||
      !sameIdentity(identity.conversationId, callback.conversationId) ||
      !sameIdentity(identity.workerId, callback.workerId)) {
    return { ok: false, state: "FAILED", reason: "CALLBACK_BINDING_MISMATCH" };
  }
  const sentAt = Date.parse(callback.messageSentAt);
  const receivedAt = Date.parse(callback.responseReceivedAt);
  if (!Number.isFinite(sentAt) || !Number.isFinite(receivedAt) || receivedAt < sentAt) {
    return { ok: false, state: "FAILED", reason: "INVALID_CALLBACK_TIMELINE" };
  }
  if (!callback.responseText.trim()) {
    return { ok: false, state: "FAILED", reason: "EMPTY_RESPONSE" };
  }
  return { ok: true, state: "ACK_VERIFIED" };
}
