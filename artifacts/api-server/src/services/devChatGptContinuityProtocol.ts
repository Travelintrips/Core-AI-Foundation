/** Pure wire parsing only. Safe to import in the isolated OAuth gateway. */
export type DevContinuityCheckpointState =
  | "RUNNING" | "WAITING_CI" | "WAITING_APPROVAL" | "COMPLETED" | "CANCELLED";

export type DevChatGptContinuityCommand =
  | {
      kind: "register";
      targetConversationId: string;
      jobId: string;
      checkpointSha: string;
      idleSeconds: number;
      ttlSeconds: number;
    }
  | {
      kind: "checkpoint";
      jobId: string;
      expectedRevision: number;
      checkpointSha: string;
      state: DevContinuityCheckpointState;
    }
  | { kind: "status"; jobId: string };

const UUID = "([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})";
const REGISTER = new RegExp(
  "^DEV_CHATGPT_WATCH_V1 conversation=" + UUID + " job=" + UUID +
  " checkpoint=([0-9a-f]{40}) idle=([1-9][0-9]{0,3}) ttl=([1-9][0-9]{0,4})$", "i",
);
const CHECKPOINT = new RegExp(
  "^DEV_CHATGPT_CHECKPOINT_V1 job=" + UUID +
  " revision=([1-9][0-9]{0,15}) checkpoint=([0-9a-f]{40})" +
  " state=(RUNNING|WAITING_CI|WAITING_APPROVAL|COMPLETED|CANCELLED)$", "i",
);
const STATUS = new RegExp("^DEV_CHATGPT_WATCH_STATUS_V1 job=" + UUID + "$", "i");

export function isDevChatGptContinuityMessage(instruction: string): boolean {
  return /^DEV_CHATGPT_(?:WATCH|CHECKPOINT)(?:\b|_)/i.test(instruction);
}

export function parseDevChatGptContinuityCommand(
  instruction: string,
): DevChatGptContinuityCommand | null {
  // No multiline payload, appended instruction, coercion, or natural-language exception.
  if (/[\r\n]/.test(instruction)) return null;
  const registration = REGISTER.exec(instruction);
  if (registration) {
    const idleSeconds = Number(registration[4]);
    const ttlSeconds = Number(registration[5]);
    if (idleSeconds < 60 || idleSeconds > 3600 || ttlSeconds <= idleSeconds || ttlSeconds > 86400) return null;
    return {
      kind: "register", targetConversationId: registration[1]!.toLowerCase(),
      jobId: registration[2]!.toLowerCase(), checkpointSha: registration[3]!.toLowerCase(),
      idleSeconds, ttlSeconds,
    };
  }
  const checkpoint = CHECKPOINT.exec(instruction);
  if (checkpoint) {
    const expectedRevision = Number(checkpoint[2]);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return null;
    return {
      kind: "checkpoint", jobId: checkpoint[1]!.toLowerCase(), expectedRevision,
      checkpointSha: checkpoint[3]!.toLowerCase(),
      state: checkpoint[4]!.toUpperCase() as DevContinuityCheckpointState,
    };
  }
  const status = STATUS.exec(instruction);
  return status ? { kind: "status", jobId: status[1]!.toLowerCase() } : null;
}
