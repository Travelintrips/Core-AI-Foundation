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
const SIMPLE_WAKE_COMMAND = /^(GPT[0-9]{2,4})(?:\s+JOB\s*0*([0-9]{1,12}))?\s*[,;:\-]?\s+([^\r\n]+)$/i;
const FORBIDDEN_INSTRUCTION = /[\u0000-\u001f\u007f]/;

function normalizeJobAlias(value: string | undefined): string | null {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) return null;
  return "JOB" + String(numeric).padStart(3, "0");
}

export function parseChatGptWakeCommand(message: string): ChatGptWakeCommand | null {
  const input = message.trim();
  const legacy = WAKE_COMMAND.exec(input);
  const simple = legacy ? null : SIMPLE_WAKE_COMMAND.exec(input);
  const match = legacy ?? simple;
  if (!match) return null;
  const instruction = match[3]?.trim() ?? "";
  if (!instruction || instruction.length > 2000 || FORBIDDEN_INSTRUCTION.test(instruction)) return null;
  const jobAlias = legacy
    ? match[2]?.toUpperCase() ?? null
    : normalizeJobAlias(match[2]);
  if (!legacy && match[2] && !jobAlias) return null;
  return {
    accountAlias: match[1]!.toUpperCase(),
    jobAlias,
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
