/**
 * Universal Design Layer System — Reducer
 *
 * Pure reducer over LayerSystemState. No side-effects.
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

import { flattenLayerTree } from "./utils";
import {
  INITIAL_LAYER_SYSTEM_STATE,
  type LayerSystemAction,
  type LayerSystemState,
} from "./state";

export function layerSystemReducer(
  state: LayerSystemState = INITIAL_LAYER_SYSTEM_STATE,
  action: LayerSystemAction,
): LayerSystemState {
  switch (action.type) {
    // ── Loading ──────────────────────────────────────────────────────────────

    case "LOAD_START":
      return {
        ...state,
        status: state.tree ? "refreshing" : "loading",
        error: null,
      };

    case "LOAD_SUCCESS":
      return {
        ...state,
        status: "idle",
        error: null,
        tree: action.tree,
        optimisticTree: null,
        pendingMutations: [],
      };

    case "LOAD_ERROR":
      return {
        ...state,
        status: "idle",
        error: action.error,
      };

    // ── Expand / collapse ────────────────────────────────────────────────────

    case "TOGGLE_EXPAND": {
      const next = new Set(state.expandedIds);
      if (next.has(action.id)) {
        next.delete(action.id);
      } else {
        next.add(action.id);
      }
      return { ...state, expandedIds: next };
    }

    case "SET_EXPANDED":
      return { ...state, expandedIds: new Set(action.ids) };

    case "EXPAND_ALL": {
      const tree = state.optimisticTree ?? state.tree;
      if (!tree) return state;
      const all = flattenLayerTree(tree)
        .filter((n) => n.children.length > 0)
        .map((n) => n.id);
      return { ...state, expandedIds: new Set(all) };
    }

    case "COLLAPSE_ALL":
      return { ...state, expandedIds: new Set() };

    // ── Selection ────────────────────────────────────────────────────────────

    case "SYNC_SELECTION":
      return { ...state, selection: action.selection };

    // ── Mutations ────────────────────────────────────────────────────────────

    case "MUTATION_QUEUE":
      return {
        ...state,
        status: "mutating",
        pendingMutations: [...state.pendingMutations, action.mutation],
        optimisticTree: action.optimisticTree,
        // Eagerly update selection for "select" mutations
        selection:
          action.mutation.op === "select"
            ? {
                selectedIds: action.mutation.ids,
                primaryId: action.mutation.primary ?? action.mutation.ids[0] ?? null,
              }
            : state.selection,
      };

    case "MUTATION_COMMIT": {
      const remaining = state.pendingMutations.filter((m) => m !== action.mutation);
      return {
        ...state,
        status: remaining.length > 0 ? "mutating" : "idle",
        tree: action.confirmedTree,
        optimisticTree: remaining.length > 0 ? action.confirmedTree : null,
        pendingMutations: remaining,
      };
    }

    case "MUTATION_REJECT": {
      const remaining = state.pendingMutations.filter((m) => m !== action.mutation);
      return {
        ...state,
        status: remaining.length > 0 ? "mutating" : "idle",
        optimisticTree: remaining.length > 0 ? state.tree : null,
        pendingMutations: remaining,
        conflicts: [...state.conflicts, { mutation: action.mutation, error: action.error }],
      };
    }

    // ── Conflicts ────────────────────────────────────────────────────────────

    case "CLEAR_CONFLICTS":
      return { ...state, conflicts: [] };

    default:
      return state;
  }
}
