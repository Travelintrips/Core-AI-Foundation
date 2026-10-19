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
const SIMPLE_WAKE_WITH_JOB = /^(GPT[0-9]{2,4})\s+JOB\s*([0-9]{1,12})\s*[,;:\-]?\s*([^\r\n]+)$/i;
const SIMPLE_WAKE_NO_JOB = /^(GPT[0-9]{2,4})\s*[,;:\-]?\s+([^\r\n]+)$/i;
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
  if (legacy) {
    const instruction = legacy[3]?.trim() ?? "";
    if (!instruction || instruction.length > 2000 || FORBIDDEN_INSTRUCTION.test(instruction)) return null;
    return {
      accountAlias: legacy[1]!.toUpperCase(),
      jobAlias: legacy[2]?.toUpperCase() ?? null,
      instruction,
    };
  }

  const simpleWithJob = SIMPLE_WAKE_WITH_JOB.exec(input);
  if (simpleWithJob) {
    const instruction = simpleWithJob[3]?.trim() ?? "";
    const jobAlias = normalizeJobAlias(simpleWithJob[2]);
    if (!jobAlias || !instruction || instruction.length > 2000 || FORBIDDEN_INSTRUCTION.test(instruction)) return null;
    return {
      accountAlias: simpleWithJob[1]!.toUpperCase(),
      jobAlias,
      instruction,
    };
  }

  // A malformed explicit JOB prefix must fail closed instead of being reinterpreted
  // as ordinary instruction text.
  if (/^GPT[0-9]{2,4}\s+JOB\b/i.test(input)) return null;

  const simple = SIMPLE_WAKE_NO_JOB.exec(input);
  if (!simple) return null;
  const instruction = simple[2]?.trim() ?? "";
  if (!instruction || instruction.length > 2000 || FORBIDDEN_INSTRUCTION.test(instruction)) return null;
  return {
    accountAlias: simple[1]!.toUpperCase(),
    jobAlias: null,
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
