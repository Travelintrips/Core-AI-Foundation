/**
 * design-lifecycle/lifecycleTransitions.ts — Team 08
 *
 * Defines the allowed lifecycle transitions for Universal Design projects
 * and provides a guard function used by the lifecycle service before any
 * status update is persisted.
 *
 * RULES:
 *  1. ALLOWED_TRANSITIONS is the single source of truth. Any transition not
 *     listed is invalid and will be rejected.
 *  2. Terminal stages (completed, cancelled) have no outgoing transitions.
 *  3. 'failed' allows a retry transition back to 'generating'.
 *  4. guardTransition throws a typed error — callers never need to check the
 *     return value; a successful return means the transition is valid.
 */

import type { DesignStage } from "./types.js";
import {
  LifecycleInvalidTransitionError,
  LifecycleTerminalStateError,
} from "./types.js";
import { isTerminal } from "./lifecycleStatusMap.js";

// ── Allowed transition graph ──────────────────────────────────────────────────

/**
 * Adjacency list of valid stage transitions.
 *
 * Design intent:
 *  - Forward-only by default; exceptions documented inline.
 *  - 'failed' → 'generating' enables a clean retry without returning to 'draft'.
 *  - 'revision_requested' → 'generating' re-enters generation after changes.
 *  - 'approved' → 'generating' covers partial regeneration of individual assets.
 *  - 'brief_in_progress' → 'draft' enables brief resets.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<DesignStage, ReadonlyArray<DesignStage>>> = {
  draft: [
    "brief_in_progress",
    "cancelled",
  ],
  brief_in_progress: [
    "ready",
    "draft",       // brief reset
    "cancelled",
  ],
  ready: [
    "active",
    "cancelled",
  ],
  active: [
    "waiting_for_input",
    "generating",
    "failed",
    "cancelled",
  ],
  waiting_for_input: [
    "active",      // client responded, resume work
    "cancelled",
  ],
  generating: [
    "in_review",
    "failed",
    "cancelled",
  ],
  in_review: [
    "revision_requested",
    "approved",
    "failed",
  ],
  revision_requested: [
    "generating",  // re-enter generation after addressing revision
    "cancelled",
  ],
  approved: [
    "completed",
    "generating",  // partial re-generation of individual assets
  ],
  completed: [],   // terminal
  failed: [
    "generating",  // retry
    "cancelled",
  ],
  cancelled: [],   // terminal
} as const;

// ── Guard ─────────────────────────────────────────────────────────────────────

/**
 * Asserts that transitioning from `from` to `to` is permitted.
 *
 * Throws:
 *  - LifecycleTerminalStateError  when `from` is a terminal stage.
 *  - LifecycleInvalidTransitionError  when the edge (from → to) is not listed.
 *
 * A noop transition (from === to) is always invalid unless the caller
 * explicitly passes allowNoop=true, in which case this returns early.
 */
export function guardTransition(
  from: DesignStage,
  to: DesignStage,
  { allowNoop = false }: { allowNoop?: boolean } = {},
): void {
  if (from === to) {
    if (allowNoop) return;
    throw new LifecycleInvalidTransitionError(from, to);
  }

  if (isTerminal(from)) {
    throw new LifecycleTerminalStateError(from);
  }

  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new LifecycleInvalidTransitionError(from, to);
  }
}

/**
 * Returns true if transitioning from `from` to `to` is valid.
 * Non-throwing convenience wrapper around guardTransition.
 */
export function isValidTransition(from: DesignStage, to: DesignStage): boolean {
  try {
    guardTransition(from, to);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns all stages reachable from `from` in a single transition.
 * Returns an empty array for terminal stages.
 */
export function allowedNext(from: DesignStage): ReadonlyArray<DesignStage> {
  return ALLOWED_TRANSITIONS[from];
}
