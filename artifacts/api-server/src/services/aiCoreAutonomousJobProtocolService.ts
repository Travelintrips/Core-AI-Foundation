import { z } from "zod";

export const autonomousCommandNames = [
  "JOB_START", "JOB_CONTINUE", "JOB_FIX", "JOB_VERIFY",
  "JOB_DELEGATE", "JOB_STATUS", "JOB_CANCEL",
] as const;

const eventId = z.string().min(1).max(160);
const jobId = z.string().min(1).max(160);

export const autonomousJobCommandSchema = z.object({
  protocol: z.literal("ai-core-autonomous/v1"),
  job_id: jobId,
  event_id: eventId,
  command: z.enum(autonomousCommandNames),
  created_at: z.string().datetime({ offset: true }),
  scope: z.object({
    repository: z.string().min(1),
    branch: z.string().min(1),
    environment: z.string().min(1),
    approved_actions: z.array(z.string()).default([]),
  }),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().min(1).max(20),
}).strict().refine((value) => value.attempt <= value.max_attempts, {
  message: "attempt must not exceed max_attempts",
});

export const autonomousJobResultSchema = z.object({
  protocol: z.literal("ai-core-autonomous/v1"),
  job_id: jobId,
  event_id: eventId,
  status: z.enum(["QUEUED", "RUNNING", "VERIFYING", "RETRYING", "BLOCKED", "COMPLETED", "CANCELLED"]),
  step: z.string().min(1),
  result: z.string().min(1),
  evidence: z.array(z.object({
    kind: z.string().min(1),
    ref: z.string().min(1),
    observed_at: z.string().datetime({ offset: true }),
  }).strict()),
  error: z.string().nullable(),
  next_action: z.enum(autonomousCommandNames).nullable(),
  attempt: z.number().int().min(0),
  requires_boss_approval: z.boolean(),
}).strict();

export type AutonomousJobCommand = z.infer<typeof autonomousJobCommandSchema>;
export type AutonomousJobResult = z.infer<typeof autonomousJobResultSchema>;

export function canMarkAutonomousJobCompleted(
  result: AutonomousJobResult,
  requiredEvidenceKinds: readonly string[],
): boolean {
  return result.status === "COMPLETED" &&
    result.error === null &&
    !result.requires_boss_approval &&
    requiredEvidenceKinds.every((kind) => result.evidence.some((item) => item.kind === kind));
}

export const autonomousJobTransitions = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["VERIFYING", "RETRYING", "BLOCKED", "CANCELLED"],
  VERIFYING: ["COMPLETED", "RETRYING", "BLOCKED", "CANCELLED"],
  RETRYING: ["RUNNING", "BLOCKED", "CANCELLED"],
  BLOCKED: [],
  COMPLETED: [],
  CANCELLED: [],
} as const;

export type AutonomousJobStatus = keyof typeof autonomousJobTransitions;

export function validateAutonomousJobTransition(
  previous: AutonomousJobStatus,
  next: AutonomousJobStatus,
  result: AutonomousJobResult,
  requiredEvidenceKinds: readonly string[],
): { allowed: boolean; reason: string } {
  if (result.status !== next) {
    return { allowed: false, reason: "result_status_mismatch" };
  }
  const allowedNext = autonomousJobTransitions[previous] as readonly AutonomousJobStatus[];
  if (!allowedNext.includes(next)) {
    return { allowed: false, reason: "invalid_transition" };
  }
  if (next === "COMPLETED" && !canMarkAutonomousJobCompleted(result, requiredEvidenceKinds)) {
    return { allowed: false, reason: "missing_completion_evidence" };
  }
  if (next === "RETRYING" && result.next_action !== "JOB_FIX") {
    return { allowed: false, reason: "retry_requires_fix_action" };
  }
  if (next === "BLOCKED" && !result.error) {
    return { allowed: false, reason: "blocked_requires_error" };
  }
  return { allowed: true, reason: "ok" };
}
