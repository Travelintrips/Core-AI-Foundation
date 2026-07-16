/**
 * Alignment Optimizer — Edge & Center Snapping
 *
 * Snaps elements that are very close to the canvas edge or center to
 * exact alignment. Threshold: ≤ 4px from an alignment guide.
 *
 * Safe operations only:
 *  - Snap near-zero x/y to 0 (flush to edge).
 *  - Snap near-right/bottom to canvas edge.
 *  - Snap near-horizontal/vertical center to exact center.
 *
 * Does NOT change size, content, bindings, or z-index.
 */

import type { DesignTemplate, DesignElement } from "../../../types/designTemplate.js";
import type { OptimizationChange } from "../types/engineering.types.js";

const SNAP_THRESHOLD = 4; // px

export interface AlignmentOptimizerResult {
  elements: DesignElement[];
  changes: OptimizationChange[];
}

export function optimizeAlignment(template: DesignTemplate): AlignmentOptimizerResult {
  const changes: OptimizationChange[] = [];
  const { width: cw, height: ch } = template.canvas;
  const centerX = cw / 2;
  const centerY = ch / 2;

  const elements = template.elements.map((el): DesignElement => {
    let x = el.x;
    let y = el.y;
    const snapActions: Array<{ field: string; before: number; after: number; guide: string }> = [];

    // Snap near-left edge to 0
    if (x > 0 && x <= SNAP_THRESHOLD) {
      snapActions.push({ field: "x", before: x, after: 0, guide: "left edge" });
      x = 0;
    }
    // Snap near-top edge to 0
    if (y > 0 && y <= SNAP_THRESHOLD) {
      snapActions.push({ field: "y", before: y, after: 0, guide: "top edge" });
      y = 0;
    }
    // Snap near-right edge (x + width close to cw)
    if (Math.abs(x + el.width - cw) <= SNAP_THRESHOLD && x + el.width !== cw) {
      const before = x;
      x = cw - el.width;
      snapActions.push({ field: "x", before, after: x, guide: "right edge" });
    }
    // Snap near-bottom edge
    if (Math.abs(y + el.height - ch) <= SNAP_THRESHOLD && y + el.height !== ch) {
      const before = y;
      y = ch - el.height;
      snapActions.push({ field: "y", before, after: y, guide: "bottom edge" });
    }
    // Snap near horizontal center
    const elCenterX = el.x + el.width / 2;
    if (Math.abs(elCenterX - centerX) <= SNAP_THRESHOLD && elCenterX !== centerX) {
      const before = x;
      x = centerX - el.width / 2;
      snapActions.push({ field: "x", before, after: x, guide: "horizontal center" });
    }
    // Snap near vertical center
    const elCenterY = el.y + el.height / 2;
    if (Math.abs(elCenterY - centerY) <= SNAP_THRESHOLD && elCenterY !== centerY) {
      const before = y;
      y = centerY - el.height / 2;
      snapActions.push({ field: "y", before, after: y, guide: "vertical center" });
    }

    if (snapActions.length === 0) return el;

    for (const snap of snapActions) {
      changes.push({
        type: "snap_alignment",
        nodeId: el.id,
        before: { [snap.field]: snap.before },
        after: { [snap.field]: snap.after },
        reason: `Snapped element "${el.id}" ${snap.field} to ${snap.guide} (was ${snap.before}px, threshold ${SNAP_THRESHOLD}px).`,
      });
    }

    return { ...el, x, y };
  });

  return { elements, changes };
}
