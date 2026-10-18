/**
 * Pure job-to-conversation binding policy. Persistence and authenticated
 * ChatGPT session attestation must be provided by the calling control plane.
 */
export type ChatGptJobBinding = {
  accountAlias: string;
  jobAlias: string;
  conversationId: string;
  conversationUrl: string;
  sessionAttested: boolean;
};

export type ChatGptJobResolution =
  | { action: "REUSE"; binding: ChatGptJobBinding }
  | { action: "CREATE_NEW"; accountAlias: string; jobAlias: string }
  | { action: "BLOCK"; reason: "UNVERIFIED_SESSION" | "INVALID_CONVERSATION" | "BINDING_CONFLICT" };

const CONVERSATION_URL = /^https:\/\/chatgpt\.com\/c\/([a-zA-Z0-9-]{10,100})$/;

export function resolveChatGptJobConversation(input: {
  accountAlias: string;
  jobAlias: string;
  existing: ChatGptJobBinding | null;
}): ChatGptJobResolution {
  const { accountAlias, jobAlias, existing } = input;
  if (!existing) return { action: "CREATE_NEW", accountAlias, jobAlias };
  if (existing.accountAlias !== accountAlias || existing.jobAlias !== jobAlias) {
    return { action: "BLOCK", reason: "BINDING_CONFLICT" };
  }
  const match = CONVERSATION_URL.exec(existing.conversationUrl);
  if (!match || match[1] !== existing.conversationId) {
    return { action: "BLOCK", reason: "INVALID_CONVERSATION" };
  }
  if (!existing.sessionAttested) return { action: "BLOCK", reason: "UNVERIFIED_SESSION" };
  return { action: "REUSE", binding: existing };
}
