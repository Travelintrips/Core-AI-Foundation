import {
  autonomousJobCommandSchema,
  autonomousJobResultSchema,
  validateAutonomousJobTransition,
  type AutonomousJobCommand,
  type AutonomousJobResult,
  type AutonomousJobStatus,
} from "./aiCoreAutonomousJobProtocolService.js";

/**
 * Storage-neutral dispatch coordinator. The caller MUST provide a transactional,
 * persistent implementation of this interface before using it in production.
 * In-memory storage is intentionally not provided.
 */
export interface AutonomousJobStore {
  enqueueOnce(command: AutonomousJobCommand): Promise<"inserted" | "duplicate">;
  getStatus(jobId: string): Promise<AutonomousJobStatus | null>;
  applyResultOnce(
    result: AutonomousJobResult,
    expectedPreviousStatus: AutonomousJobStatus,
    requiredEvidenceKinds: readonly string[],
  ): Promise<"applied" | "duplicate" | "conflict">;
}

export class AutonomousJobCoordinator {
  constructor(
    private readonly store: AutonomousJobStore,
    private readonly requiredEvidenceKinds: readonly string[] = ["ci", "deployment", "e2e"],
  ) {}

  async submit(input: unknown) {
    const command = autonomousJobCommandSchema.parse(input);
    return {
      job_id: command.job_id,
      event_id: command.event_id,
      result: await this.store.enqueueOnce(command),
    };
  }

  async receive(input: unknown) {
    const result = autonomousJobResultSchema.parse(input);
    const previous = await this.store.getStatus(result.job_id);
    if (previous === null) {
      return { accepted: false, reason: "unknown_job" } as const;
    }
    const decision = validateAutonomousJobTransition(
      previous, result.status, result, this.requiredEvidenceKinds,
    );
    if (!decision.allowed) {
      return { accepted: false, reason: decision.reason } as const;
    }
    const applied = await this.store.applyResultOnce(result, previous, this.requiredEvidenceKinds);
    return {
      accepted: applied === "applied" || applied === "duplicate",
      reason: applied,
    } as const;
  }
}
