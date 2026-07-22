/**
 * Universal Design Layer System — State Shape
 *
 * Separates:
 * - canonical layer tree (source of truth from adapter)
 * - UI-only expanded state
 * - selection
 * - pending mutations (in-flight)
 * - optimistic tree
 * - conflict/error state
 *
 * No React elements are stored in the tree.
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

import type { LayerMutation, LayerSelection, LayerTree } from "./types";

// ── State ─────────────────────────────────────────────────────────────────────

export type LayerSystemState = {
  /**
   * Canonical layer tree — last confirmed state from the adapter/backend.
   * null until the first successful load.
   */
  tree: LayerTree | null;

  /**
   * Loading status.
   * - "idle": no load in progress
   * - "loading": initial load in progress
   * - "refreshing": subsequent refresh in progress (tree is non-null)
   * - "mutating": a mutation is being applied
   */
  status: "idle" | "loading" | "refreshing" | "mutating";

  /** Top-level error message. null when healthy. */
  error: string | null;

  /**
   * Set of node IDs that are expanded in the UI tree.
   * This is UI-only state — never persisted.
   */
  expandedIds: Set<string>;

  /** Current workspace selection. */
  selection: LayerSelection;

  /**
   * Mutations that have been dispatched but not yet confirmed by the adapter.
   * Applied optimistically to derive `optimisticTree`.
   */
  pendingMutations: LayerMutation[];

  /**
   * Optimistic view = canonical tree + pending mutations applied locally.
   * Used for immediate UI feedback before the adapter responds.
   * null when there are no pending mutations (show `tree` directly).
   */
  optimisticTree: LayerTree | null;

  /**
   * Mutations that were rejected by the adapter, with their error messages.
   * Cleared when the user acknowledges or a successful mutation supersedes them.
   */
  conflicts: Array<{ mutation: LayerMutation; error: string }>;
};

export const INITIAL_LAYER_SYSTEM_STATE: LayerSystemState = {
  tree: null,
  status: "idle",
  error: null,
  expandedIds: new Set(),
  selection: { selectedIds: [], primaryId: null },
  pendingMutations: [],
  optimisticTree: null,
  conflicts: [],
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type LayerSystemAction =
  /** Begin loading the tree for an artifact. */
  | { type: "LOAD_START" }
  /** Tree successfully loaded from adapter. */
  | { type: "LOAD_SUCCESS"; tree: LayerTree }
  /** Load failed. */
  | { type: "LOAD_ERROR"; error: string }

  /** Toggle expanded state for a node. */
  | { type: "TOGGLE_EXPAND"; id: string }
  /** Expand all nodes at once. */
  | { type: "EXPAND_ALL" }
  /** Collapse all nodes. */
  | { type: "COLLAPSE_ALL" }
  /** Set exactly which node IDs are expanded. */
  | { type: "SET_EXPANDED"; ids: string[] }

  /** Sync selection from workspace (Team 11 boundary). */
  | { type: "SYNC_SELECTION"; selection: LayerSelection }

  /**
   * Queue a mutation optimistically. The caller is responsible for also
   * calling the adapter and then dispatching MUTATION_COMMIT or MUTATION_REJECT.
   */
  | { type: "MUTATION_QUEUE"; mutation: LayerMutation; optimisticTree: LayerTree }
  /** Adapter confirmed the mutation — replace canonical tree. */
  | { type: "MUTATION_COMMIT"; mutation: LayerMutation; confirmedTree: LayerTree }
  /** Adapter rejected the mutation — revert optimistic state. */
  | { type: "MUTATION_REJECT"; mutation: LayerMutation; error: string }

  /** Dismiss all conflicts. */
  | { type: "CLEAR_CONFLICTS" };

// ── Effective tree helper ─────────────────────────────────────────────────────

/**
 * Returns the tree the UI should render: optimistic if available, else canonical.
 */
export function effectiveTree(state: LayerSystemState): LayerTree | null {
  return state.optimisticTree ?? state.tree;
}
