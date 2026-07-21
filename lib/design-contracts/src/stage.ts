/**
 * stage.ts — DesignStageDefinition
 *
 * Defines a single stage within a design workflow. Stage definitions are
 * declared by domain plugins via DesignPluginManifest.workflowRef and
 * registered at plugin load time. The core engine resolves the DAG from
 * dependencies; it does NOT hardcode any stage names.
 *
 * Stage IDs must be stable across versions. Rename = breaking change.
 */

import { z } from "zod";

// ── Stage categories (domain-agnostic) ────────────────────────────────────────

export const DESIGN_STAGE_CATEGORIES = [
  "brief",
  "research",
  "concept",
  "moodboard",
  "sketch",
  "technical",
  "material",
  "visualization",
  "specification",
  "export",
  "review",
  "presentation",
  "custom",
] as const;

export type DesignStageCategory = (typeof DESIGN_STAGE_CATEGORIES)[number];

// ── Artifact types a stage may produce ───────────────────────────────────────

export const DESIGN_ARTIFACT_TYPES = [
  "image",
  "vector",
  "document_pdf",
  "document_pptx",
  "structured_data",
  "3d_model",
  "video",
  "archive",
  "text",
  "custom",
] as const;

export type DesignArtifactType = (typeof DESIGN_ARTIFACT_TYPES)[number];

// ── Completion policy ─────────────────────────────────────────────────────────

export const COMPLETION_POLICIES = [
  /** Stage is done when at least one artifact is produced. */
  "any_artifact",
  /** Stage is done when all declared required capabilities have produced artifacts. */
  "all_capabilities",
  /** Stage is done when the client explicitly approves. */
  "client_approval",
  /** Stage is done when all sub-stages (if any) are complete. */
  "all_substages",
  /** Custom completion logic defined by the plugin. */
  "plugin_defined",
] as const;

export type CompletionPolicy = (typeof COMPLETION_POLICIES)[number];

// ── DesignStageDefinition ─────────────────────────────────────────────────────

export const DesignStageDefinitionSchema = z.object({
  /**
   * Stable, unique stage identifier within this plugin's workflow.
   * Format recommendation: "<pluginId>:<snake_case_name>" (e.g. "fashion:moodboard").
   * The core engine treats this as an opaque string — it is the plugin's
   * responsibility to keep it stable across versions.
   */
  stageId: z.string().min(1).max(150),
  /** Human-readable title (localisation handled by consumer). */
  title: z.string().min(1).max(200),
  /** Broad category used by the core engine for analytics and routing. */
  category: z.enum(DESIGN_STAGE_CATEGORIES),
  /**
   * stageIds of stages that MUST be completed before this stage can start.
   * The core engine validates this DAG; circular deps are rejected.
   */
  dependencies: z.array(z.string()).default([]),
  /**
   * Capability IDs (from DesignCapabilityContract.capabilityId) this stage
   * invokes. The engine resolves and validates each capability before starting.
   */
  requiredCapabilities: z.array(z.string()).default([]),
  /** Artifact types this stage may produce. At least one must be declared. */
  supportedArtifactTypes: z.array(z.enum(DESIGN_ARTIFACT_TYPES)).min(1),
  /** Determines when this stage transitions to "complete". */
  completionPolicy: z.enum(COMPLETION_POLICIES).default("any_artifact"),
  /**
   * If true, this stage can be skipped by the client or plugin without
   * blocking downstream stages.
   */
  optional: z.boolean().default(false),
  /**
   * If true, this stage can be executed multiple times (revision loops,
   * iterative rendering). The engine tracks each execution as a separate run.
   */
  repeatable: z.boolean().default(false),
  /** Display order within the workflow UI (ascending). Ties resolved by stageId. */
  displayOrder: z.number().int().nonnegative().optional(),
  /** Plugin-specific metadata; opaque to the core engine. */
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type DesignStageDefinition = z.infer<typeof DesignStageDefinitionSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates that a set of stage definitions forms a valid DAG (no cycles).
 * Returns the list of detected cycles, or an empty array if the DAG is valid.
 */
export function detectStageCycles(stages: DesignStageDefinition[]): string[][] {
  const idSet = new Set(stages.map((s) => s.stageId));
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: string[][] = [];
  const adj = new Map(stages.map((s) => [s.stageId, s.dependencies]));

  function dfs(id: string, path: string[]): void {
    if (stack.has(id)) {
      const cycleStart = path.indexOf(id);
      cycles.push(path.slice(cycleStart));
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    stack.add(id);
    for (const dep of adj.get(id) ?? []) {
      if (idSet.has(dep)) dfs(dep, [...path, id]);
    }
    stack.delete(id);
  }

  for (const stage of stages) dfs(stage.stageId, []);
  return cycles;
}
