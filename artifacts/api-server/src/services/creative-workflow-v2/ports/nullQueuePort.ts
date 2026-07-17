/**
 * nullQueuePort — No-op QueuePort implementation for testing and local dev.
 *
 * Jobs are logged but never actually enqueued. Useful in unit tests where
 * the queue infrastructure is not available.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { QueuePort, EnqueueInput, EnqueueResult, QueueFilter } from "../../../types/creative-workflow-v2/ports.js";
import { randomUUID } from "crypto";

export class NullQueuePort implements QueuePort {
  private readonly log: Array<{ op: string; args: unknown }> = [];

  get calls(): ReadonlyArray<{ op: string; args: unknown }> {
    return this.log;
  }

  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const jobId   = randomUUID();
    const jobCode = `NULL-${jobId.slice(0, 8).toUpperCase()}`;
    this.log.push({ op: "enqueue", args: { jobId, jobCode, ...input } });
    return { jobId, jobCode };
  }

  async cancelJob(jobId: string, reason?: string): Promise<void> {
    this.log.push({ op: "cancelJob", args: { jobId, reason } });
  }

  async pauseJobs(filter: QueueFilter): Promise<number> {
    this.log.push({ op: "pauseJobs", args: filter });
    return 0;
  }

  async resumeJobs(filter: QueueFilter): Promise<number> {
    this.log.push({ op: "resumeJobs", args: filter });
    return 0;
  }
}
