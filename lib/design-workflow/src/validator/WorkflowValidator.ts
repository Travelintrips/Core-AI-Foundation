/**
 * Design Workflow Validator
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Validates a DesignWorkflowDefinition before it can be registered or activated.
 *
 * Rejection rules (all enforced):
 * 1.  Duplicate stage ID
 * 2.  Missing dependency (stage depends on a non-existent stage)
 * 3.  Circular dependency (DFS-based cycle detection)
 * 4.  Unreachable required stage (no path from any entry stage)
 * 5.  Unknown capability (when knownCapabilities are provided)
 * 6.  Invalid artifact requirement (empty artifactType)
 * 7.  Terminal stage with invalid outgoing reference (self-loop)
 * 8.  Incompatible version (version > 1 missing migrationMetadata,
 *     or migrationMetadata.compatibleFromVersion > version)
 */

import type {
  DesignWorkflowDefinition,
  StageDefinition,
} from "../types/definition.js";

// ── Result Types ──────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  /** Stage id(s) involved, if applicable. */
  stageIds?: string[];
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** Convenience: only error-level issues. */
  errors: ValidationIssue[];
  /** Convenience: only warning-level issues. */
  warnings: ValidationIssue[];
}

// ── Validator Options ─────────────────────────────────────────────────────────

export interface ValidatorOptions {
  /**
   * Set of capability tokens the platform has registered.
   * If provided, stages referencing unknown capabilities are flagged as errors.
   * If absent, capability validation is skipped.
   */
  knownCapabilities?: ReadonlySet<string>;
}

// ── Internal DAG Types ────────────────────────────────────────────────────────

type AdjacencyMap = Map<string, string[]>;

// ── Cycle Detection (three-colour DFS) ───────────────────────────────────────

function detectCycleDFS(
  nodes: string[],
  adjacency: AdjacencyMap,
): string[] | null {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, 0 | 1 | 2>();
  for (const n of nodes) colour.set(n, WHITE);
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    colour.set(node, GREY);
    stack.push(node);
    for (const neighbour of adjacency.get(node) ?? []) {
      const c = colour.get(neighbour);
      if (c === GREY) {
        const start = stack.indexOf(neighbour);
        return [...stack.slice(start), neighbour];
      }
      if (c === WHITE) {
        const result = dfs(neighbour);
        if (result !== null) return result;
      }
    }
    stack.pop();
    colour.set(node, BLACK);
    return null;
  }

  for (const node of nodes) {
    if (colour.get(node) === WHITE) {
      const cycle = dfs(node);
      if (cycle !== null) return cycle;
    }
  }
  return null;
}

// ── Validator ─────────────────────────────────────────────────────────────────

export class WorkflowValidator {
  constructor(private readonly options: ValidatorOptions = {}) {}

  validate(
    definition: DesignWorkflowDefinition,
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const { stages } = definition;

    // ── 1. Duplicate stage IDs ───────────────────────────────────────────────
    const seenIds = new Set<string>();
    const duplicates: string[] = [];
    for (const stage of stages) {
      if (seenIds.has(stage.id)) {
        duplicates.push(stage.id);
      } else {
        seenIds.add(stage.id);
      }
    }
    for (const id of duplicates) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_STAGE_ID",
        message: `Stage id "${id}" appears more than once in this workflow.`,
        stageIds: [id],
      });
    }

    const stageIdSet = seenIds; // all unique IDs (duplicates counted once)

    // ── 2. Missing dependencies ──────────────────────────────────────────────
    for (const stage of stages) {
      for (const depId of stage.dependencies) {
        if (!stageIdSet.has(depId)) {
          issues.push({
            severity: "error",
            code: "MISSING_DEPENDENCY",
            message: `Stage "${stage.id}" depends on "${depId}" which is not defined in this workflow.`,
            stageIds: [stage.id, depId],
          });
        }
        // Self-loop check (also covers "terminal stage with invalid outgoing dependency")
        if (depId === stage.id) {
          issues.push({
            severity: "error",
            code: "SELF_LOOP",
            message: `Stage "${stage.id}" lists itself as a dependency (self-loop).`,
            stageIds: [stage.id],
          });
        }
      }
    }

    // Only proceed with graph checks if no structural errors so far
    const structuralErrors = issues.filter(
      (i) =>
        i.severity === "error" &&
        (i.code === "DUPLICATE_STAGE_ID" ||
          i.code === "MISSING_DEPENDENCY" ||
          i.code === "SELF_LOOP"),
    );

    if (structuralErrors.length === 0) {
      // ── 3. Build adjacency: dependency edges (dep → stage, i.e. dep must finish first)
      // For cycle detection we model edges as: from dependency → to dependent.
      const adjacency: AdjacencyMap = new Map();
      for (const stage of stages) adjacency.set(stage.id, []);
      for (const stage of stages) {
        for (const depId of stage.dependencies) {
          adjacency.get(depId)!.push(stage.id);
        }
      }

      // ── 3. Circular dependency ───────────────────────────────────────────
      const cycle = detectCycleDFS([...stageIdSet], adjacency);
      if (cycle !== null) {
        issues.push({
          severity: "error",
          code: "CIRCULAR_DEPENDENCY",
          message: `Circular dependency detected: ${cycle.join(" → ")}.`,
          stageIds: cycle,
        });
      } else {
        // ── 4. Unreachable required stages ─────────────────────────────────
        // Entry stages = stages with no dependencies
        const entryStages = stages.filter(
          (s) => s.dependencies.length === 0,
        );

        if (entryStages.length === 0 && stages.length > 0) {
          issues.push({
            severity: "error",
            code: "NO_ENTRY_STAGE",
            message:
              "No entry stage found — every stage has at least one dependency. This implies a cycle.",
          });
        } else {
          // BFS to find all reachable stages
          const reachable = new Set<string>();
          const queue = entryStages.map((s) => s.id);
          while (queue.length > 0) {
            const id = queue.shift()!;
            if (reachable.has(id)) continue;
            reachable.add(id);
            for (const successor of adjacency.get(id) ?? []) {
              if (!reachable.has(successor)) queue.push(successor);
            }
          }
          for (const stage of stages) {
            if (!stage.optional && !reachable.has(stage.id)) {
              issues.push({
                severity: "error",
                code: "UNREACHABLE_REQUIRED_STAGE",
                message: `Required stage "${stage.id}" is not reachable from any entry stage.`,
                stageIds: [stage.id],
              });
            }
          }
        }
      }
    }

    // ── 5. Unknown capability ────────────────────────────────────────────────
    if (this.options.knownCapabilities) {
      for (const stage of stages) {
        if (!this.options.knownCapabilities.has(stage.requiredCapability)) {
          issues.push({
            severity: "error",
            code: "UNKNOWN_CAPABILITY",
            message: `Stage "${stage.id}" requires capability "${stage.requiredCapability}" which is not registered.`,
            stageIds: [stage.id],
          });
        }
      }
    }

    // ── 6. Invalid artifact requirements ─────────────────────────────────────
    for (const stage of stages) {
      for (const artifact of stage.artifactOutputs ?? []) {
        if (!artifact.artifactType || artifact.artifactType.trim() === "") {
          issues.push({
            severity: "error",
            code: "INVALID_ARTIFACT_TYPE",
            message: `Stage "${stage.id}" has an artifact output with an empty artifactType.`,
            stageIds: [stage.id],
          });
        }
      }
    }

    // ── 7. Terminal stage validation ─────────────────────────────────────────
    // A terminal stage has no outgoing edges (nothing depends on it).
    // Warn if it is also optional — it might be silently skipped at the end.
    const dependedOn = new Set<string>();
    for (const stage of stages) {
      for (const dep of stage.dependencies) dependedOn.add(dep);
    }
    for (const stage of stages) {
      if (!dependedOn.has(stage.id) && stage.optional) {
        issues.push({
          severity: "warning",
          code: "OPTIONAL_TERMINAL_STAGE",
          message: `Terminal stage "${stage.id}" is optional. Ensure the completion policy accounts for it being skipped.`,
          stageIds: [stage.id],
        });
      }
    }

    // ── 8. Version compatibility ─────────────────────────────────────────────
    if (definition.version > 1 && !definition.migrationMetadata) {
      issues.push({
        severity: "error",
        code: "MISSING_MIGRATION_METADATA",
        message: `Workflow version ${definition.version} must include migrationMetadata.`,
      });
    }
    if (
      definition.migrationMetadata &&
      definition.migrationMetadata.compatibleFromVersion > definition.version
    ) {
      issues.push({
        severity: "error",
        code: "INVALID_MIGRATION_METADATA",
        message:
          `migrationMetadata.compatibleFromVersion (${definition.migrationMetadata.compatibleFromVersion}) ` +
          `cannot exceed the workflow version (${definition.version}).`,
      });
    }

    // ── requiredCapabilities cross-check ─────────────────────────────────────
    const stageCapabilities = new Set(
      stages.map((s) => s.requiredCapability),
    );
    for (const cap of stageCapabilities) {
      if (!definition.requiredCapabilities.includes(cap)) {
        issues.push({
          severity: "error",
          code: "CAPABILITY_NOT_DECLARED",
          message:
            `Capability "${cap}" is used by a stage but not listed in requiredCapabilities.`,
        });
      }
    }

    // ── Completion policy stage references ──────────────────────────────────
    const policy = definition.completionPolicy;
    if (policy.type === "any_of" || policy.type === "all_of") {
      for (const sid of policy.stageIds) {
        if (!stageIdSet.has(sid)) {
          issues.push({
            severity: "error",
            code: "COMPLETION_POLICY_UNKNOWN_STAGE",
            message:
              `Completion policy references unknown stage "${sid}".`,
            stageIds: [sid],
          });
        }
      }
    }

    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    return {
      valid: errors.length === 0,
      issues,
      errors,
      warnings,
    };
  }

  /**
   * Convenience: throw if the definition is invalid.
   * Useful for registration-time guard.
   */
  assertValid(definition: DesignWorkflowDefinition): void {
    const result = this.validate(definition);
    if (!result.valid) {
      const messages = result.errors.map((e) => `[${e.code}] ${e.message}`).join("\n");
      throw new Error(
        `Workflow "${definition.workflowId}" v${definition.version} failed validation:\n${messages}`,
      );
    }
  }
}
