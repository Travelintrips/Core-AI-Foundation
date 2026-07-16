/**
 * Pipeline State — tracks per-stage status for the full 15-agent pipeline.
 *
 * Frontend-friendly labels are co-located here so the UI can show meaningful
 * progress text at each stage transition.
 */

import type { AgentName, PipelineStageState, PipelineStageStatus } from "../types/orchestrator.types.js";

export const STAGE_LABELS: Record<AgentName, string> = {
  "creative-director":   "Analyzing design goals",
  "requirement-analyst": "Extracting requirements",
  "brand-strategist":    "Defining brand direction",
  "layout-architect":    "Building layout",
  "composition-designer":"Balancing composition",
  "typography-designer": "Selecting typography",
  "color-designer":      "Creating color system",
  "decoration-designer": "Adding visual details",
  "component-builder":   "Planning components",
  "variable-designer":   "Preparing editable variables",
  "asset-planner":       "Planning image placeholders",
  "json-architect":      "Generating canvas template",
  "validator-initial":   "Validating design",
  "optimizer":           "Optimizing layout",
  "validator-final":     "Performing final validation",
  "art-director-qa":     "Performing final art direction review",
  "publish-gate":        "Ready to edit",
  "revision-router":     "Routing revision request",
};

export const ORDERED_STAGES: AgentName[] = [
  "creative-director",
  "requirement-analyst",
  "brand-strategist",
  "layout-architect",
  "composition-designer",
  "typography-designer",
  "color-designer",
  "decoration-designer",
  "component-builder",
  "variable-designer",
  "asset-planner",
  "json-architect",
  "validator-initial",
  "optimizer",
  "validator-final",
  "art-director-qa",
  "publish-gate",
  "revision-router",
];

export function initPipelineStages(): PipelineStageState[] {
  return ORDERED_STAGES.map(stageId => ({
    stageId,
    label: STAGE_LABELS[stageId],
    status: "pending" as PipelineStageStatus,
  }));
}

export function updateStage(
  stages: PipelineStageState[],
  stageId: AgentName,
  patch: Partial<Omit<PipelineStageState, "stageId" | "label">>,
): PipelineStageState[] {
  // Return a new array — never mutate in place
  return stages.map(s =>
    s.stageId === stageId ? { ...s, ...patch } : s,
  );
}

export function markStageRunning(
  stages: PipelineStageState[],
  stageId: AgentName,
): PipelineStageState[] {
  return updateStage(stages, stageId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });
}

export function markStageComplete(
  stages: PipelineStageState[],
  stageId: AgentName,
  status: "success" | "failed" | "skipped" | "needs_revision",
  opts: { latencyMs?: number; retryCount?: number; errorMessage?: string } = {},
): PipelineStageState[] {
  return updateStage(stages, stageId, {
    status,
    completedAt: new Date().toISOString(),
    ...opts,
  });
}
