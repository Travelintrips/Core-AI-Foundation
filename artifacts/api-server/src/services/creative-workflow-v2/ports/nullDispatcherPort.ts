/**
 * nullDispatcherPort — No-op DispatcherPort for testing.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { DispatcherPort, DispatcherStatusSnapshot } from "../../../types/creative-workflow-v2/ports.js";

export class NullDispatcherPort implements DispatcherPort {
  getStatus(): DispatcherStatusSnapshot {
    return {
      enabled: true,
      running: true,
      workerCount: 3,
      idleWorkers: 3,
      busyWorkers: 0,
      queueLength: 0,
      runningJobs: 0,
      lastTick: null,
      lastHeartbeat: null,
    };
  }

  async tick(): Promise<{ claimed: number; completed: number; failed: number }> {
    return { claimed: 0, completed: 0, failed: 0 };
  }
}
