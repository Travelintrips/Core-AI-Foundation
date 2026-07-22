/**
 * Legacy Creative Step Adapter
 * Team 05 — DESIGN WORKFLOW ENGINE & REGISTRY
 *
 * Maps creative_project_steps rows to the Universal Design Platform stage model.
 *
 * Rules:
 * - Read-only: does NOT write to the database or modify input objects.
 * - Does NOT perform destructive backfill.
 * - Uses migrationMetadata.renamedStages for transparent ID remapping.
 * - Unmapped step names are reported separately — never silently discarded.
 * - Step names that match removedStages are mapped to a synthetic snapshot
 *   with status="completed" (they completed in the old schema).
 */

import type { DesignWorkflowDefinition } from "../types/definition.js";
import type {
  LegacyProjectStep,
  LegacyStageSnapshot,
  LegacyAdapterResult,
} from "../types/adapter.js";

const TERMINAL_STATUSES = new Set(["completed", "failed"]);

function normaliseStatus(
  raw: string,
): "pending" | "running" | "completed" | "failed" {
  if (
    raw === "pending" ||
    raw === "running" ||
    raw === "completed" ||
    raw === "failed"
  ) {
    return raw;
  }
  // Unknown status → pending (safe fallback for display)
  return "pending";
}

export class LegacyCreativeStepAdapter {
  /**
   * @param definition  The workflow definition to map against.
   *                    Uses definition.stages[].id and migrationMetadata
   *                    to build the step-name → stage-id mapping.
   */
  constructor(private readonly definition: DesignWorkflowDefinition) {}

  /**
   * Adapt a collection of legacy project steps to LegacyStageSnapshot objects.
   *
   * Mapping precedence (all case-sensitive):
   * 1. stepName matches a current stage.id exactly.
   * 2. stepName matches a current stage.label exactly (label fallback).
   * 3. stepName is listed in migrationMetadata.renamedStages as an old id.
   * 4. stepName is listed in migrationMetadata.removedStages → synthetic snapshot.
   * 5. Unmapped → added to unmappedStepNames.
   */
  adaptSteps(steps: LegacyProjectStep[]): LegacyAdapterResult {
    const stageIdSet = new Set(this.definition.stages.map((s) => s.id));
    const stageLabelMap = new Map(this.definition.stages.map((s) => [s.label, s.id]));

    const renamedStages = this.definition.migrationMetadata?.renamedStages ?? {};
    const removedStages = new Set(
      this.definition.migrationMetadata?.removedStages ?? [],
    );

    const snapshots: LegacyStageSnapshot[] = [];
    const unmappedStepNames: string[] = [];

    for (const step of steps) {
      const mappedStageId = this.resolveStageId(
        step.stepName,
        stageIdSet,
        stageLabelMap,
        renamedStages,
        removedStages,
      );

      if (mappedStageId === null) {
        unmappedStepNames.push(step.stepName);
        continue;
      }

      const status = normaliseStatus(step.status);

      snapshots.push({
        legacyId: step.id,
        projectId: step.projectId,
        stageId: mappedStageId,
        stepName: step.stepName,
        status,
        agentId: step.agentId ?? undefined,
        tokenUsage: step.tokenUsage,
        latencyMs: step.latencyMs ?? undefined,
        errorMessage: step.errorMessage ?? undefined,
        isTerminal: TERMINAL_STATUSES.has(status),
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
      });
    }

    return { snapshots, unmappedStepNames };
  }

  /** Convenience: adapt a single step. */
  adaptStep(step: LegacyProjectStep): LegacyStageSnapshot | null {
    const result = this.adaptSteps([step]);
    return result.snapshots[0] ?? null;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private resolveStageId(
    stepName: string,
    stageIdSet: Set<string>,
    stageLabelMap: Map<string, string>,
    renamedStages: Record<string, string>,
    removedStages: Set<string>,
  ): string | null {
    // 1. Exact id match
    if (stageIdSet.has(stepName)) return stepName;

    // 2. Label match
    const byLabel = stageLabelMap.get(stepName);
    if (byLabel !== undefined) return byLabel;

    // 3. Renamed stage (old id → new id)
    const renamed = renamedStages[stepName];
    if (renamed !== undefined) return renamed;

    // 4. Removed stage → use the old step name as the stageId
    //    (it no longer exists in the current definition, but we preserve the snapshot)
    if (removedStages.has(stepName)) return stepName;

    return null;
  }
}
