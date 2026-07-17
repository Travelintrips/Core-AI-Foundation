/**
 * nullWorkerPort — Stub WorkerPort for testing.
 *
 * Reports all capabilities as available so plan validation passes.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { WorkerPort, WorkerCapabilityInfo } from "../../../types/creative-workflow-v2/ports.js";

export class NullWorkerPort implements WorkerPort {
  private readonly _capabilities: string[];

  constructor(capabilities: string[] = ["llm_inference", "image_generation", "creative_text", "qc_review", "pdf_export", "creative_brief", "custom"]) {
    this._capabilities = capabilities;
  }

  getCapabilities(): string[] {
    return [...this._capabilities];
  }

  getCapacityInfo(): WorkerCapabilityInfo[] {
    return [
      {
        workerType: "null_worker",
        capabilities: this._capabilities,
        maxConcurrentJobs: 10,
        idleSlots: 10,
      },
    ];
  }

  isAvailable(): boolean {
    return true;
  }
}
