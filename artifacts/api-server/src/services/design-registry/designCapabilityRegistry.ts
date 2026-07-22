/**
 * designCapabilityRegistry.ts — Central registry for Universal Design Platform capabilities.
 *
 * A "design capability" maps a (domain, stage, action) tuple to:
 *   - an execution kind (ai_text, ai_image, render, …)
 *   - input/output schema IDs (validated against DesignSchemaRegistry)
 *   - optional reference to an existing ai_capabilities.skill (for router reuse)
 *   - guardrail overrides, renderer/export dependencies, cost observability flag
 *
 * Registering the same capability ID twice throws RegistrationCollisionError.
 *
 * Usage:
 *   import { globalCapabilityRegistry } from "./index.js";
 *   globalCapabilityRegistry.register({ id: "design:fashion:brief:analyze", ... });
 */

import type { DesignCapabilityEntry, WorkflowStage, ExecutionKind } from "./types.js";

// ── Errors ────────────────────────────────────────────────────────────────────

export class RegistrationCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationCollisionError";
  }
}

export class UnknownCapabilityError extends Error {
  constructor(id: string) {
    super(`Capability "${id}" is not registered in the DesignCapabilityRegistry`);
    this.name = "UnknownCapabilityError";
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class DesignCapabilityRegistry {
  private readonly _capabilities = new Map<string, DesignCapabilityEntry>();

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a capability entry.
   * @throws RegistrationCollisionError if the id is already registered.
   */
  register(entry: DesignCapabilityEntry): void {
    if (this._capabilities.has(entry.id)) {
      throw new RegistrationCollisionError(
        `Capability collision: "${entry.id}" is already registered. ` +
          `Use a different ID or de-register the existing entry first.`,
      );
    }
    this._capabilities.set(entry.id, entry);
  }

  // ── Retrieval ────────────────────────────────────────────────────────────────

  /** Returns the capability entry for the given ID, or undefined if not registered. */
  get(id: string): DesignCapabilityEntry | undefined {
    return this._capabilities.get(id);
  }

  /** Returns all registered capability entries (insertion order). */
  list(): DesignCapabilityEntry[] {
    return [...this._capabilities.values()];
  }

  /**
   * Returns all capabilities applicable to a given workflow stage.
   * Optionally filtered by execution kind.
   */
  listByStage(stage: WorkflowStage, executionKind?: ExecutionKind): DesignCapabilityEntry[] {
    return this.list().filter(
      (c) =>
        c.stageApplicability.includes(stage) &&
        (executionKind === undefined || c.executionKind === executionKind),
    );
  }

  /**
   * Returns all capabilities for a given domain.
   */
  listByDomain(domain: string): DesignCapabilityEntry[] {
    return this.list().filter((c) => c.domain === domain);
  }

  /**
   * Returns all capabilities that reference a given existing AI capability skill.
   * Useful when the model router resolves a skill and you want the design wrapper.
   */
  findByAiCapabilityRef(skill: string): DesignCapabilityEntry[] {
    return this.list().filter((c) => c.aiCapabilityRef === skill);
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────────

  /** Total number of registered capabilities. */
  get size(): number {
    return this._capabilities.size;
  }

  /** Remove all entries. Intended for test isolation. */
  clear(): void {
    this._capabilities.clear();
  }
}
