/**
 * design-lifecycle/lifecycleStatusMap.ts — Team 08
 *
 * Documented, deterministic mapping between Universal Design Platform stages
 * (DesignStage) and the raw creative_projects.status string stored in the DB.
 *
 * RULES:
 *  1. Every DesignStage maps to exactly ONE existing creative_projects.status
 *     value (or one additive value for 'cancelled' which is new but safe as
 *     creative_projects.status is an open text column).
 *  2. The mapping is a pure function — no DB access, no side effects.
 *  3. Multiple DesignStages may share the same raw status when they are
 *     distinguished by lifecycle_metadata.designStage (e.g. draft vs
 *     brief_in_progress both map to 'pending').
 *  4. reverseMap resolves the canonical DesignStage for a raw status. Where
 *     multiple stages share a raw status, the lifecycle_metadata.designStage
 *     field acts as the tie-breaker.
 */

import type { DesignStage } from "./types.js";

// ── Forward map: DesignStage → creative_projects.status ──────────────────────

/**
 * Maps each DesignStage to the raw creative_projects.status value that will
 * be written to the DB during a lifecycle transition.
 *
 * Canonical source of truth — update this when existing statuses change.
 */
export const DESIGN_STAGE_TO_STATUS: Readonly<Record<DesignStage, string>> = {
  draft:              "pending",              // default on create; brief not started
  brief_in_progress:  "pending",              // same raw status; distinguished by metadata
  ready:              "ready_to_build",        // brief complete, queued
  active:             "building",             // workers running
  waiting_for_input:  "waiting_client_review", // blocked on client
  generating:         "running",              // AI generation active
  in_review:          "internal_review",       // QC / internal sign-off
  revision_requested: "revision",             // client requested changes
  approved:           "approved",             // signed off
  completed:          "completed",            // all deliverables done
  failed:             "failed",               // unrecoverable error
  cancelled:          "cancelled",            // explicitly cancelled (additive value)
} as const;

// ── Reverse map: raw status → canonical DesignStage ──────────────────────────

/**
 * Primary reverse lookup — used when creative_projects.status is read and must
 * be resolved to a DesignStage WITHOUT lifecycle_metadata context.
 *
 * For statuses shared by multiple stages (pending → draft/brief_in_progress),
 * this returns the "lower" stage. The lifecycle service uses lifecycle_metadata
 * to refine the result when the metadata is available.
 */
export const STATUS_TO_DESIGN_STAGE: Readonly<Record<string, DesignStage>> = {
  // Legacy statuses (mapped to nearest equivalent)
  pending:                "draft",
  running:                "generating",
  completed:              "completed",
  failed:                 "failed",

  // Dual Commercial Flow statuses — map to nearest design equivalent
  waiting_payment:            "draft",
  deposit_paid:               "draft",
  waiting_payment_verification: "draft",
  payment_verified:           "ready",
  waiting_remaining_payment:  "approved",
  remaining_paid:             "approved",
  ready_to_build:             "ready",
  building:                   "active",
  internal_review:            "in_review",
  waiting_client_review:      "waiting_for_input",
  revision:                   "revision_requested",
  approved:                   "approved",

  // Document / Presentation Engine intermediate statuses
  generating_document:     "generating",
  generating_presentation: "generating",

  // Additive (Team 08)
  cancelled: "cancelled",
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the raw creative_projects.status for a given DesignStage.
 * Pure function — never throws for a valid DesignStage.
 */
export function toRawStatus(stage: DesignStage): string {
  return DESIGN_STAGE_TO_STATUS[stage];
}

/**
 * Resolves the DesignStage for a raw creative_projects.status string.
 * Uses lifecycle_metadata.designStage as the tie-breaker for statuses that
 * map to multiple stages (e.g. 'pending' → draft vs brief_in_progress).
 *
 * Returns 'draft' for any unknown raw status so legacy projects degrade
 * gracefully without throwing.
 */
export function toDesignStage(
  rawStatus: string,
  lifecycleMetadata?: Record<string, unknown> | null,
): DesignStage {
  // Prefer the explicit design stage stored in metadata (most authoritative)
  if (lifecycleMetadata?.designStage) {
    const explicit = lifecycleMetadata.designStage as string;
    if (isDesignStage(explicit)) return explicit;
  }

  return STATUS_TO_DESIGN_STAGE[rawStatus] ?? "draft";
}

/** Type guard — returns true when s is a known DesignStage. */
export function isDesignStage(s: string): s is DesignStage {
  return s in DESIGN_STAGE_TO_STATUS;
}

/** All terminal stages — no further transitions allowed. */
export const TERMINAL_STAGES: ReadonlySet<DesignStage> = new Set<DesignStage>([
  "completed",
  "cancelled",
]);

export function isTerminal(stage: DesignStage): boolean {
  return TERMINAL_STAGES.has(stage);
}
