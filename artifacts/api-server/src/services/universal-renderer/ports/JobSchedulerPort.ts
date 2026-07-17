/**
 * JobSchedulerPort — Universal Renderer Team 14
 *
 * Contract for enqueuing background render jobs without depending
 * directly on queueManagerService (allows test injection).
 *
 * Implementations stamp `_tenantId` into the payload as required by WP-06.
 */

export interface ScheduleJobInput {
  jobType: string;
  payload: Record<string, unknown>;
  /** 0–100, higher = more urgent. Default 50. */
  priority?: number;
  /** Capability string that must appear on the worker (e.g. "pdf_export"). */
  requiredCapability?: string;
  /** Server-resolved tenant ID (WP-06). Never from unverified client input. */
  tenantId?: string;
  maxRetry?: number;
  retryStrategy?: "immediate" | "exponential" | "manual";
}

export interface ScheduleJobOutput {
  jobId: number;
  jobCode: string;
}

export interface JobSchedulerPort {
  schedule(input: ScheduleJobInput): Promise<ScheduleJobOutput>;
}
