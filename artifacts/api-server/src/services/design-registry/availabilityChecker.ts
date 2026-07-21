/**
 * availabilityChecker.ts — Checks whether a design capability is available
 * at runtime without making direct AI provider calls.
 *
 * Availability means:
 *   1. The capability is registered.
 *   2. If the execution kind requires a worker type, at least one worker of
 *      that type is currently registered in the cluster.
 *
 * Worker type information is obtained via the WorkerAvailabilityPort interface
 * (dependency injection) — never by querying a provider API directly.
 *
 * Execution kinds that are platform-managed (pure, human_review, composite)
 * are always considered available at the execution layer; the caller is
 * responsible for any platform-level gating.
 */

import type {
  ExecutionKind,
  WorkerAvailabilityPort,
  CapabilityAvailabilityResult,
} from "./types.js";
import type { DesignCapabilityRegistry } from "./designCapabilityRegistry.js";

// ── Worker-type mapping ───────────────────────────────────────────────────────

/**
 * Maps each ExecutionKind to the cluster worker type it requires.
 * null means the execution is platform-managed and needs no worker check.
 */
const EXECUTION_KIND_TO_WORKER_TYPE: Record<ExecutionKind, string | null> = {
  pure:          null, // deterministic, no worker
  human_review:  null, // platform-gated, no worker
  composite:     null, // multi-step; individual steps own their own checks
  ai_text:       "text_worker",
  document:      "text_worker",
  presentation:  "text_worker",
  ai_image:      "image_worker",
  render:        "image_worker",
  export:        "storage_worker",
};

// ── Checker ───────────────────────────────────────────────────────────────────

export class CapabilityAvailabilityChecker {
  constructor(
    private readonly capabilities: DesignCapabilityRegistry,
    private readonly workerPort: WorkerAvailabilityPort,
  ) {}

  /**
   * Check availability of a registered capability.
   *
   * Returns { available: true } when the capability is registered and any
   * required worker type has at least one registered instance.
   *
   * Returns { available: false, reason } with a human-readable explanation
   * when the capability is not registered or its worker type is unavailable.
   */
  async check(capabilityId: string): Promise<CapabilityAvailabilityResult> {
    const capability = this.capabilities.get(capabilityId);

    if (!capability) {
      return {
        available: false,
        capabilityId,
        reason:
          `Capability "${capabilityId}" is not registered. ` +
          `Register it via globalCapabilityRegistry.register() before checking availability.`,
      };
    }

    const workerType = EXECUTION_KIND_TO_WORKER_TYPE[capability.executionKind];

    // Platform-managed execution kinds are always available at the worker layer
    if (workerType === null) {
      return {
        available: true,
        capabilityId,
        reason:
          `Capability "${capabilityId}" uses executionKind "${capability.executionKind}" ` +
          `which is platform-managed — no worker check required.`,
      };
    }

    // Ask the port for current worker types (no direct provider call)
    let registeredTypes: string[];
    try {
      registeredTypes = await this.workerPort.getRegisteredWorkerTypes();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        capabilityId,
        workerType,
        reason:
          `Worker availability check failed for capability "${capabilityId}" ` +
          `(workerType="${workerType}"): ${message}`,
      };
    }

    if (registeredTypes.includes(workerType)) {
      return {
        available: true,
        capabilityId,
        workerType,
        reason:
          `Capability "${capabilityId}" is available — worker type "${workerType}" ` +
          `has at least one registered instance (executionKind="${capability.executionKind}").`,
      };
    }

    return {
      available: false,
      capabilityId,
      workerType,
      reason:
        `Capability "${capabilityId}" is NOT available — no workers of type "${workerType}" ` +
        `are currently registered in the cluster ` +
        `(executionKind="${capability.executionKind}"). ` +
        `Registered types: [${registeredTypes.join(", ")}].`,
    };
  }

  /**
   * Check availability for multiple capabilities in parallel.
   */
  async checkMany(
    capabilityIds: string[],
  ): Promise<CapabilityAvailabilityResult[]> {
    return Promise.all(capabilityIds.map((id) => this.check(id)));
  }
}

// ── Production adapter ────────────────────────────────────────────────────────

/**
 * WorkerAvailabilityPort implementation for production use.
 * Reads the list of registered workers from the cluster service.
 *
 * Import and pass this to CapabilityAvailabilityChecker in app.ts / startup.
 * Do NOT call this from tests — use a mock WorkerAvailabilityPort instead.
 */
export async function createProductionWorkerPort(): Promise<WorkerAvailabilityPort> {
  // Dynamic import to avoid pulling DB dependencies into test bundles
  const { getWorkerCapacity } = await import("../workerClusterService.js");

  return {
    async getRegisteredWorkerTypes(): Promise<string[]> {
      const workers = await getWorkerCapacity();
      // Deduplicate worker types across all registered workers
      return [...new Set(workers.map((w) => w.workerType))];
    },
  };
}
