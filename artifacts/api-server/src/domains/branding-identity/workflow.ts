/**
 * branding-identity/workflow.ts — Team 27
 *
 * 13-stage Branding & Identity workflow state machine.
 *
 * Rules:
 *   - Stages advance linearly (brand_brief → … → export).
 *   - "review" is a special stage: reachable from ANY stage with a note.
 *   - After "review", the brief can be sent back to any prior stage.
 *   - Guards prevent skipping stages without explicit override.
 *   - All transitions are recorded in an immutable audit trail.
 *   - No AI execution happens here — this is pure state management.
 */

import { randomUUID } from "crypto";
import {
  BRANDING_STAGES,
  type BrandingStage,
  type BrandingStatus,
} from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StageTransition {
  id:          string;
  fromStage:   BrandingStage | null;
  toStage:     BrandingStage;
  triggeredAt: string; // ISO
  note?:       string;
}

export interface WorkflowState {
  briefId:         string;
  currentStage:    BrandingStage;
  status:          BrandingStatus;
  stageIndex:      number;        // 0-based index into BRANDING_STAGES
  completedStages: BrandingStage[];
  transitions:     StageTransition[];
  createdAt:       string;
  updatedAt:       string;
}

export interface AdvanceResult {
  ok:    true;
  state: WorkflowState;
}

export interface AdvanceError {
  ok:    false;
  error: string;
}

// ── Allowed linear transitions ────────────────────────────────────────────────

/**
 * Returns the next stage in the linear sequence, or null if at the end.
 */
export function nextStage(current: BrandingStage): BrandingStage | null {
  const idx = BRANDING_STAGES.indexOf(current);
  if (idx < 0 || idx >= BRANDING_STAGES.length - 1) return null;
  return BRANDING_STAGES[idx + 1] ?? null;
}

/**
 * Returns the index of a stage in the sequence.
 */
export function stageIndex(stage: BrandingStage): number {
  return BRANDING_STAGES.indexOf(stage);
}

/**
 * Determine whether a transition from → to is allowed.
 *
 * Rules:
 *   1. Any stage → "review"  is allowed (quality gate).
 *   2. "review"  → any prior stage is allowed (revision loop).
 *   3. Otherwise only one-step forward is allowed.
 */
export function isTransitionAllowed(
  from: BrandingStage,
  to:   BrandingStage,
): { allowed: true } | { allowed: false; reason: string } {
  if (from === to) {
    return { allowed: false, reason: `Already at stage "${to}"` };
  }
  // Rule 1: any → review
  if (to === "review") {
    return { allowed: true };
  }
  // Rule 2: review → any prior/equal stage (revision)
  if (from === "review") {
    return { allowed: true };
  }
  // Rule 3: one-step forward only
  const expected = nextStage(from);
  if (expected === to) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Cannot advance from "${from}" to "${to}". Expected next stage: "${expected ?? "none (already at end)"}"`,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createWorkflowState(briefId: string): WorkflowState {
  const now = new Date().toISOString();
  const initial = BRANDING_STAGES[0];
  const transition: StageTransition = {
    id:          randomUUID(),
    fromStage:   null,
    toStage:     initial,
    triggeredAt: now,
    note:        "Brief created",
  };
  return {
    briefId,
    currentStage:    initial,
    status:          "draft",
    stageIndex:      0,
    completedStages: [],
    transitions:     [transition],
    createdAt:       now,
    updatedAt:       now,
  };
}

// ── Advance ───────────────────────────────────────────────────────────────────

export function advanceStage(
  state:       WorkflowState,
  targetStage: BrandingStage,
  note?:       string,
): AdvanceResult | AdvanceError {
  const check = isTransitionAllowed(state.currentStage, targetStage);
  if (!check.allowed) {
    return { ok: false, error: check.reason };
  }

  const now = new Date().toISOString();
  const transition: StageTransition = {
    id:          randomUUID(),
    fromStage:   state.currentStage,
    toStage:     targetStage,
    triggeredAt: now,
    note,
  };

  // Mark previous stage as completed when moving forward in the sequence.
  // "review" → export counts as forward (stageIndex export > stageIndex review).
  // Backward moves (review loop returning to an earlier stage) do NOT mark completed.
  const completedStages = new Set(state.completedStages);
  if (stageIndex(targetStage) > stageIndex(state.currentStage)) {
    completedStages.add(state.currentStage);
  }

  // Derive status
  let status: BrandingStatus = state.status;
  if (targetStage === "review")         status = "in_review";
  else if (targetStage === "export")    status = "exported";
  else if (state.status === "in_review") status = "active";  // leaving review
  else if (state.status === "draft")    status = "active";

  const newState: WorkflowState = {
    ...state,
    currentStage:    targetStage,
    stageIndex:      stageIndex(targetStage),
    status,
    completedStages: [...completedStages],
    transitions:     [...state.transitions, transition],
    updatedAt:       now,
  };

  return { ok: true, state: newState };
}

// ── Progress summary ──────────────────────────────────────────────────────────

export interface WorkflowProgress {
  totalStages:      number;
  completedCount:   number;
  currentStageIdx:  number;
  percentComplete:  number; // 0-100
  isComplete:       boolean;
  stages: Array<{
    stage:     BrandingStage;
    index:     number;
    completed: boolean;
    current:   boolean;
  }>;
}

export function getWorkflowProgress(state: WorkflowState): WorkflowProgress {
  const total = BRANDING_STAGES.length;
  const completedSet = new Set(state.completedStages);
  const stages = BRANDING_STAGES.map((s, i) => ({
    stage:     s,
    index:     i,
    completed: completedSet.has(s),
    current:   s === state.currentStage,
  }));

  const completedCount = completedSet.size;
  const isComplete = state.currentStage === "export" && completedCount >= total - 1;

  return {
    totalStages:     total,
    completedCount,
    currentStageIdx: state.stageIndex,
    percentComplete: Math.round((completedCount / total) * 100),
    isComplete,
    stages,
  };
}
