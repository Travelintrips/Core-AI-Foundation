/**
 * Deterministic, fail-closed parsing for ChatGPT browser wake commands.
 * Parsing alone NEVER authorizes browser access or dispatches a job.
 * Caller MUST resolve an authenticated account/session binding and worker scope.
 */
export type ChatGptWakeCommand = {
  accountAlias: string;
  jobAlias: string | null;
  instruction: string;
};

const WAKE_COMMAND = /^\*(GPT[0-9]{2,4})(?:-(JOB[0-9]{3,12}))?\s+([^\r\n]+)$/i;
const FORBIDDEN_INSTRUCTION = /[\u0000-\u001f\u007f]/;

export function parseChatGptWakeCommand(message: string): ChatGptWakeCommand | null {
  const input = message.trim();
  const match = WAKE_COMMAND.exec(input);
  if (!match) return null;
  const instruction = match[3]?.trim() ?? "";
  if (!instruction || instruction.length > 2000 || FORBIDDEN_INSTRUCTION.test(instruction)) return null;
  return {
    accountAlias: match[1]!.toUpperCase(),
    jobAlias: match[2]?.toUpperCase() ?? null,
    instruction,
  };
}

export type WakeDispatchPreflight =
  | { ok: true; accountId: string; conversationId: string; workerId: string }
  | { ok: false; reason: "ACCOUNT_NOT_BOUND" | "SESSION_NOT_BOUND" | "SESSION_NOT_VERIFIED" | "WORKER_NOT_AUTHORIZED" };

export function verifyWakeDispatchBinding(input: {
  accountId?: string | null;
  conversationId?: string | null;
  sessionVerified: boolean;
  workerId?: string | null;
  workerAuthorized: boolean;
}): WakeDispatchPreflight {
  if (!input.accountId) return { ok: false, reason: "ACCOUNT_NOT_BOUND" };
  if (!input.conversationId) return { ok: false, reason: "SESSION_NOT_BOUND" };
  if (!input.sessionVerified) return { ok: false, reason: "SESSION_NOT_VERIFIED" };
  if (!input.workerId || !input.workerAuthorized) return { ok: false, reason: "WORKER_NOT_AUTHORIZED" };
  return { ok: true, accountId: input.accountId, conversationId: input.conversationId, workerId: input.workerId };
}
