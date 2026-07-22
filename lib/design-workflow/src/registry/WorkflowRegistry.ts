/**
 * Design Workflow Registry
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * In-memory registry for DesignWorkflowDefinition instances.
 *
 * Rules:
 * - Duplicate (workflowId + version) pairs are rejected.
 * - Resolution is explicit: callers provide typed criteria; ambiguous matches throw.
 * - Every resolution includes a machine-readable explanation of why the workflow
 *   was chosen (explainability requirement).
 * - No silent string-fuzzy matching.
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";
import type {
  WorkflowQuery,
  ResolvedWorkflow,
  RegistryEntry,
} from "../types/registry.js";

export class WorkflowRegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DUPLICATE_VERSION"
      | "NOT_FOUND"
      | "AMBIGUOUS_QUERY"
      | "EMPTY_QUERY"
      | "VERSION_MISMATCH",
  ) {
    super(message);
    this.name = "WorkflowRegistryError";
  }
}

export class WorkflowRegistry {
  /**
   * Keyed by "<workflowId>@<version>" for O(1) duplicate detection.
   */
  private readonly entries = new Map<string, RegistryEntry>();

  private static entryKey(workflowId: string, version: number): string {
    return `${workflowId}@${version}`;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  /**
   * Register a workflow definition.
   * Throws WorkflowRegistryError("DUPLICATE_VERSION") if the same
   * workflowId + version pair is already registered.
   */
  register(definition: DesignWorkflowDefinition): void {
    const key = WorkflowRegistry.entryKey(
      definition.workflowId,
      definition.version,
    );
    if (this.entries.has(key)) {
      throw new WorkflowRegistryError(
        `Workflow "${definition.workflowId}" version ${definition.version} is already registered. ` +
          `Increment the version to register a new revision.`,
        "DUPLICATE_VERSION",
      );
    }
    this.entries.set(key, {
      definition,
      registeredAt: new Date(),
      pluginId: definition.pluginId,
    });
  }

  /**
   * Remove a specific version from the registry.
   * Throws WorkflowRegistryError("NOT_FOUND") if the entry does not exist.
   */
  unregister(workflowId: string, version: number): void {
    const key = WorkflowRegistry.entryKey(workflowId, version);
    if (!this.entries.has(key)) {
      throw new WorkflowRegistryError(
        `Workflow "${workflowId}" version ${version} is not registered.`,
        "NOT_FOUND",
      );
    }
    this.entries.delete(key);
  }

  // ── Resolution ──────────────────────────────────────────────────────────────

  /**
   * Resolve a workflow definition from the registry.
   *
   * Resolution rules (applied in priority order):
   * 1. workflowId + version → exact lookup, O(1).
   * 2. workflowId only → highest registered version.
   * 3. pluginId + serviceType → single match required (throws on ambiguity).
   * 4. pluginId only → single match required (throws on ambiguity).
   * 5. serviceType only → single match required (throws on ambiguity).
   *
   * Throws WorkflowRegistryError:
   * - "EMPTY_QUERY" if no query criteria are provided.
   * - "NOT_FOUND" if no matching workflow exists.
   * - "AMBIGUOUS_QUERY" if multiple workflows match and no tiebreaker is given.
   * - "VERSION_MISMATCH" if a specific version is requested but only other versions exist.
   */
  resolve(query: WorkflowQuery): ResolvedWorkflow {
    const { workflowId, version, pluginId, serviceType } = query;

    if (!workflowId && !pluginId && !serviceType) {
      throw new WorkflowRegistryError(
        "WorkflowQuery must specify at least one of: workflowId, pluginId, serviceType.",
        "EMPTY_QUERY",
      );
    }

    // ── Fast path: exact workflowId + version ─────────────────────────────────
    if (workflowId && version !== undefined) {
      const key = WorkflowRegistry.entryKey(workflowId, version);
      const entry = this.entries.get(key);
      if (!entry) {
        // Check if the workflowId exists at all (better error message)
        const anyVersion = this.findAllByWorkflowId(workflowId);
        if (anyVersion.length > 0) {
          throw new WorkflowRegistryError(
            `Workflow "${workflowId}" version ${version} is not registered. ` +
              `Available versions: ${anyVersion.map((e) => e.definition.version).join(", ")}.`,
            "VERSION_MISMATCH",
          );
        }
        throw new WorkflowRegistryError(
          `Workflow "${workflowId}" is not registered.`,
          "NOT_FOUND",
        );
      }
      return {
        definition: entry.definition,
        explanation: {
          workflowId: entry.definition.workflowId,
          version: entry.definition.version,
          reason: `Exact match on workflowId "${workflowId}" version ${version}.`,
          matchedCriteria: ["workflowId", "version"],
          relaxedCriteria: [pluginId ? "" : "pluginId", serviceType ? "" : "serviceType"].filter(Boolean),
        },
      };
    }

    // ── workflowId only → latest version ────────────────────────────────────
    if (workflowId && version === undefined) {
      const matches = this.findAllByWorkflowId(workflowId);
      if (matches.length === 0) {
        throw new WorkflowRegistryError(
          `Workflow "${workflowId}" is not registered.`,
          "NOT_FOUND",
        );
      }
      // Latest version
      const entry = matches.sort(
        (a, b) => b.definition.version - a.definition.version,
      )[0]!;
      return {
        definition: entry.definition,
        explanation: {
          workflowId: entry.definition.workflowId,
          version: entry.definition.version,
          reason: `Latest version of workflow "${workflowId}" (version ${entry.definition.version}).`,
          matchedCriteria: ["workflowId"],
          relaxedCriteria: ["version", pluginId ? "" : "pluginId", serviceType ? "" : "serviceType"].filter(Boolean),
        },
      };
    }

    // ── Filter by pluginId and/or serviceType ────────────────────────────────
    const matchedCriteria: string[] = [];
    const relaxedCriteria: string[] = ["workflowId", "version"];

    let candidates = [...this.entries.values()];

    if (pluginId) {
      candidates = candidates.filter(
        (e) => e.definition.pluginId === pluginId,
      );
      matchedCriteria.push("pluginId");
    } else {
      relaxedCriteria.push("pluginId");
    }

    if (serviceType) {
      candidates = candidates.filter((e) =>
        e.definition.supportedServiceTypes.includes(serviceType),
      );
      matchedCriteria.push("serviceType");
    } else {
      relaxedCriteria.push("serviceType");
    }

    // If version requested, filter to that version
    if (version !== undefined) {
      const versionFiltered = candidates.filter(
        (e) => e.definition.version === version,
      );
      if (versionFiltered.length === 0 && candidates.length > 0) {
        const available = [
          ...new Set(candidates.map((e) => e.definition.version)),
        ].sort((a, b) => a - b);
        throw new WorkflowRegistryError(
          `Version ${version} not found for the given query. Available versions: ${available.join(", ")}.`,
          "VERSION_MISMATCH",
        );
      }
      candidates = versionFiltered;
      matchedCriteria.push("version");
    }

    if (candidates.length === 0) {
      throw new WorkflowRegistryError(
        `No workflow found matching query: ${JSON.stringify(query)}.`,
        "NOT_FOUND",
      );
    }

    // For each unique workflowId, keep only the latest version
    const latestByWorkflowId = new Map<string, RegistryEntry>();
    for (const entry of candidates) {
      const existing = latestByWorkflowId.get(entry.definition.workflowId);
      if (
        !existing ||
        entry.definition.version > existing.definition.version
      ) {
        latestByWorkflowId.set(entry.definition.workflowId, entry);
      }
    }
    const deduplicated = [...latestByWorkflowId.values()];

    if (deduplicated.length > 1) {
      const ids = deduplicated.map(
        (e) => `"${e.definition.workflowId}" v${e.definition.version}`,
      );
      throw new WorkflowRegistryError(
        `Ambiguous query — ${deduplicated.length} workflows match: ${ids.join(", ")}. ` +
          `Provide workflowId to disambiguate.`,
        "AMBIGUOUS_QUERY",
      );
    }

    const entry = deduplicated[0]!;
    return {
      definition: entry.definition,
      explanation: {
        workflowId: entry.definition.workflowId,
        version: entry.definition.version,
        reason: `Matched by ${matchedCriteria.join(" + ")}; selected latest version ${entry.definition.version}.`,
        matchedCriteria,
        relaxedCriteria,
      },
    };
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /** List all registered entries (all versions). */
  list(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Return all registered versions of a workflow, sorted ascending.
   * Returns an empty array if the workflowId is unknown.
   */
  getVersions(workflowId: string): number[] {
    return this.findAllByWorkflowId(workflowId)
      .map((e) => e.definition.version)
      .sort((a, b) => a - b);
  }

  /** Return the count of registered definitions (all versions). */
  get size(): number {
    return this.entries.size;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private findAllByWorkflowId(workflowId: string): RegistryEntry[] {
    const result: RegistryEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.definition.workflowId === workflowId) {
        result.push(entry);
      }
    }
    return result;
  }
}
