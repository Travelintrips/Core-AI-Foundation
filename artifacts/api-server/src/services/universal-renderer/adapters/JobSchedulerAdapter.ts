/**
 * JobSchedulerAdapter — Universal Renderer Team 14
 *
 * Implements JobSchedulerPort by delegating to the existing queueManagerService.
 * Does NOT modify jobWorkerService.
 *
 * WP-06: stamps `_tenantId` into the payload before enqueue.
 */

import { enqueue } from "../../../services/queueManagerService.js";
import type { JobSchedulerPort, ScheduleJobInput, ScheduleJobOutput } from "../ports/JobSchedulerPort.js";
import { DEFAULT_TENANT_ID } from "../../../security/tenantResolution.js";

export class JobSchedulerAdapter implements JobSchedulerPort {
  async schedule(input: ScheduleJobInput): Promise<ScheduleJobOutput> {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;

    const job = await enqueue({
      jobType:  input.jobType,
      requiredCapability: input.requiredCapability,
      payloadJson: {
        ...input.payload,
        _tenantId:          tenantId,          // WP-06 tenant stamp
      },
      priority:      input.priority ?? 50,
      maxRetry:      input.maxRetry ?? 3,
      retryStrategy: input.retryStrategy ?? "exponential",
      tenantId,
    });

    return {
      jobId:   job.id,
      jobCode: job.jobCode,
    };
  }
}
