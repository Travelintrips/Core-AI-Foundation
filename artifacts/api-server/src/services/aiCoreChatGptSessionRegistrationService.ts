/**
 * Persistence-facing registration policy for one account/job -> one ChatGPT
 * conversation. Callers must persist atomically using a unique constraint on
 * (accountAlias, jobAlias) and (accountAlias, conversationId).
 * This module never grants browser access or attests a session by itself.
 */
import { resolveChatGptJobConversation, type ChatGptJobBinding } from "./aiCoreChatGptJobBindingService.js";

export type SessionRegistrationResult =
  | { action: "INSERT"; binding: ChatGptJobBinding }
  | { action: "EXISTS"; binding: ChatGptJobBinding }
  | { action: "BLOCK"; reason: "UNVERIFIED_SESSION" | "INVALID_CONVERSATION" | "BINDING_CONFLICT" | "CONVERSATION_ALREADY_ASSIGNED" };

export function planChatGptSessionRegistration(input: {
  candidate: ChatGptJobBinding;
  existingForJob: ChatGptJobBinding | null;
  existingForConversation: ChatGptJobBinding | null;
}): SessionRegistrationResult {
  const { candidate, existingForJob, existingForConversation } = input;
  if (!candidate.sessionAttested) return { action: "BLOCK", reason: "UNVERIFIED_SESSION" };
  const validity = resolveChatGptJobConversation({
    accountAlias: candidate.accountAlias, jobAlias: candidate.jobAlias, existing: candidate,
  });
  if (validity.action === "BLOCK") return validity;
  if (existingForConversation &&
      (existingForConversation.accountAlias !== candidate.accountAlias ||
       existingForConversation.jobAlias !== candidate.jobAlias)) {
    return { action: "BLOCK", reason: "CONVERSATION_ALREADY_ASSIGNED" };
  }
  if (existingForJob) {
    const same = existingForJob.accountAlias === candidate.accountAlias &&
      existingForJob.jobAlias === candidate.jobAlias &&
      existingForJob.conversationId === candidate.conversationId &&
      existingForJob.conversationUrl === candidate.conversationUrl &&
      existingForJob.sessionAttested;
    return same ? { action: "EXISTS", binding: existingForJob } :
      { action: "BLOCK", reason: "BINDING_CONFLICT" };
  }
  return { action: "INSERT", binding: candidate };
}
