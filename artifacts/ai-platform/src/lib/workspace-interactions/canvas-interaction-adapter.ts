/**
 * Canvas Interaction Adapter (Team 19)
 *
 * Narrow adapter bridging Team 19's interaction layer to an external canvas contract
 * (Team 11 canvas if available, or a local shim).
 *
 * Integration note: This adapter is intentionally minimal.
 * When Team 11's canvas contract is available, replace the `CanvasContract` shim
 * below with the import from @workspace/canvas-contract (or equivalent).
 * Do NOT duplicate viewport/rendering engine logic here.
 *
 * @integration-note Team 11: replace CanvasContract shim once their package is published.
 */

import type { BoundingBox, SnapPoint } from "./types";
import type { SelectableItem } from "./selection-manager";

// ── Local shim — replace with Team 11 import when available ──────────────────

/**
 * Minimal canvas contract shim.
 * Mirrors only the surface Team 19 needs; other methods are outside scope.
 */
export type CanvasContract = {
  /** Returns the bounding box of an element in canvas coordinates. */
  getElementBounds(id: string): BoundingBox | null;
  /** Returns all element IDs currently visible on the canvas. */
  getVisibleElementIds(): string[];
  /** Returns elements inside a rectangular selection box (canvas coordinates). */
  getElementsInBox(box: BoundingBox): string[];
  /** Returns metadata needed for selection rules (locked flag, hierarchy index). */
  getSelectableItem(id: string): SelectableItem | null;
  /** Returns all items for select-all or range operations. */
  getAllSelectableItems(): SelectableItem[];
  /** Returns snap points contributed by the canvas (guides, grid, bounds). */
  getCanvasSnapPoints(): SnapPoint[];
};

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * CanvasInteractionAdapter wraps a CanvasContract implementation.
 * Used by Team 19 hooks and command handlers to query canvas state
 * without coupling to any specific rendering engine or domain model.
 */
export class CanvasInteractionAdapter {
  constructor(private readonly canvas: CanvasContract) {}

  getBounds(id: string): BoundingBox | null {
    return this.canvas.getElementBounds(id);
  }

  getVisibleIds(): string[] {
    return this.canvas.getVisibleElementIds();
  }

  getIdsInBox(box: BoundingBox): string[] {
    return this.canvas.getElementsInBox(box);
  }

  getSelectableItem(id: string): SelectableItem | null {
    return this.canvas.getSelectableItem(id);
  }

  getAllSelectableItems(): SelectableItem[] {
    return this.canvas.getAllSelectableItems();
  }

  getSnapPoints(): SnapPoint[] {
    return this.canvas.getCanvasSnapPoints();
  }

  /**
   * Build snap point candidates from a set of element IDs plus canvas snap points.
   */
  buildSnapCandidates(elementIds: string[]): SnapPoint[] {
    const pts: SnapPoint[] = [...this.getSnapPoints()];
    for (const id of elementIds) {
      const bounds = this.getBounds(id);
      if (!bounds) continue;
      pts.push(
        { x: bounds.x, y: bounds.y, axis: "x", source: `${id}:left` },
        { x: bounds.x + bounds.width, y: bounds.y, axis: "x", source: `${id}:right` },
        { x: bounds.x, y: bounds.y, axis: "y", source: `${id}:top` },
        { x: bounds.x, y: bounds.y + bounds.height, axis: "y", source: `${id}:bottom` },
      );
    }
    return pts;
  }
}

/**
 * Build a no-op adapter for environments where no canvas is available
 * (e.g. unit tests or server-side rendering).
 */
export function createNullCanvasAdapter(): CanvasInteractionAdapter {
  const nullContract: CanvasContract = {
    getElementBounds: () => null,
    getVisibleElementIds: () => [],
    getElementsInBox: () => [],
    getSelectableItem: () => null,
    getAllSelectableItems: () => [],
    getCanvasSnapPoints: () => [],
  };
  return new CanvasInteractionAdapter(nullContract);
}
