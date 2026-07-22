/**
 * Universal Design Layer System — Public API
 *
 * Import from this barrel, not from internal modules.
 *
 * Team 13 — feat(design-workspace): add universal layer system
 */

// Types
export type {
  LayerCapability,
  LayerMutation,
  LayerNode,
  LayerNodeType,
  LayerPatch,
  LayerProviderAdapter,
  LayerSelection,
  LayerTree,
  LayerTreeValidationError,
  LayerTreeValidationErrorCode,
  LayerTreeValidationResult,
  FlatLayerNode,
} from "./types";

// State
export type { LayerSystemAction, LayerSystemState } from "./state";
export {
  effectiveTree,
  INITIAL_LAYER_SYSTEM_STATE,
} from "./state";

// Reducer
export { layerSystemReducer } from "./reducer";

// Pure utilities
export {
  buildLayerTree,
  calculateSelectionAfterDelete,
  deriveEffectiveLock,
  deriveEffectiveVisibility,
  detectLayerCycles,
  findAncestors,
  findDescendants,
  findLayer,
  flattenLayerTree,
  guardMutation,
  moveLayer,
  normalizeLayerOrder,
  reorderLayer,
  validateLayerTree,
} from "./utils";
