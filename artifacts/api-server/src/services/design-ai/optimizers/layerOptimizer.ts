/**
 * Layer Optimizer — Z-Index Normalization
 *
 * Re-assigns zIndex values to eliminate duplicates and create a clean
 * 0, 1, 2, … sequence while preserving the original relative order.
 * Does NOT change positions, sizes, content, or bindings.
 */

import type { DesignElement } from "../../../types/designTemplate.js";
import type { OptimizationChange } from "../types/engineering.types.js";

export interface LayerOptimizerResult {
  elements: DesignElement[];
  changes: OptimizationChange[];
}

export function optimizeLayers(elements: DesignElement[]): LayerOptimizerResult {
  const changes: OptimizationChange[] = [];

  // Sort by current zIndex, then by original array order for ties
  const indexed = elements.map((el, idx) => ({ el, idx }));
  indexed.sort((a, b) => a.el.zIndex !== b.el.zIndex ? a.el.zIndex - b.el.zIndex : a.idx - b.idx);

  const result: DesignElement[] = [];
  for (let newZ = 0; newZ < indexed.length; newZ++) {
    const { el } = indexed[newZ];
    if (el.zIndex !== newZ) {
      changes.push({
        type: "normalize_z_index",
        nodeId: el.id,
        before: el.zIndex,
        after: newZ,
        reason: `Normalized z-index from ${el.zIndex} to ${newZ} to eliminate duplicates and gaps.`,
      });
      result.push({ ...el, zIndex: newZ });
    } else {
      result.push(el);
    }
  }

  // Restore original array order (sorted by original idx)
  const restored = [...result].sort((a, b) => {
    const idxA = indexed.find((x) => x.el.id === a.id)?.idx ?? 0;
    const idxB = indexed.find((x) => x.el.id === b.id)?.idx ?? 0;
    return idxA - idxB;
  });

  return { elements: restored, changes };
}
