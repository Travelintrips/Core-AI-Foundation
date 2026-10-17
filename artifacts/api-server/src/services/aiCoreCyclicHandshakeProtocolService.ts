import { z } from "zod";

const id = z.string().min(1).max(160);
const isoTime = z.string().datetime({ offset: true });

/** DEV-only handshake and continuation protocol. Transport MUST authenticate caller. */
export const cyclicHandshakeSchema = z.object({
  protocol: z.literal("ai-core-cycle/dev-v1"),
  session_id: id,
  job_id: id,
  event_id: id,
  at: isoTime,
  device_id: z.string().regex(/^zfold4-[a-zA-Z0-9_-]{3,48}$/),
  environment: z.literal("DEV"),
  last_ack_event_id: id.nullable(),
}).strict();

export const cyclicResultSchema = z.object({
  protocol: z.literal("ai-core-cycle/dev-v1"),
  session_id: id,
  job_id: id,
  event_id: id,
  device_id: z.string().regex(/^zfold4-[a-zA-Z0-9_-]{3,48}$/),
  environment: z.literal("DEV"),
  receipt_status: z.enum(["RECEIVED_UNVERIFIED", "VERIFIED", "REJECTED"]),
  callback_verified: z.boolean(),
  ack_verified: z.boolean(),
  evidence_refs: z.array(id),
}).strict();

export type CyclicHandshake = z.infer<typeof cyclicHandshakeSchema>;
export type CyclicResult = z.infer<typeof cyclicResultSchema>;

export function planRoutineSop(handshake: CyclicHandshake) {
  return {
    protocol: "ai-core-cycle/dev-v1" as const,
    session_id: handshake.session_id,
    job_id: handshake.job_id,
    event_id: handshake.event_id,
    device_id: handshake.device_id,
    environment: "DEV" as const,
    sop_id: "ROUTINE_ZFOLD4_JOB_V1" as const,
    steps: ["claim_assigned_job", "perform_authorized_actions", "submit_signed_result", "await_verified_callback", "report_to_ai_core", "resume_with_cursor"] as const,
    requires_pairing: true,
    dispatch_authorized: false, // only trusted server-side authorization can enable dispatch
    source_changes_via: "github-direct-only" as const,
  };
}

export function canContinueCycle(handshake: CyclicHandshake, result: CyclicResult): boolean {
  return result.environment === "DEV" &&
    handshake.session_id === result.session_id &&
    handshake.job_id === result.job_id &&
    handshake.device_id === result.device_id &&
    result.receipt_status === "VERIFIED" &&
    result.callback_verified && result.ack_verified &&
    result.evidence_refs.length > 0 &&
    handshake.last_ack_event_id === result.event_id;
}
