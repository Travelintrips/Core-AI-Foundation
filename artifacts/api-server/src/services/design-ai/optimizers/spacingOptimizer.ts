/**
 * Spacing Optimizer — Bounds & Position Clamping
 *
 * Clamps elements that overflow the canvas back into bounds.
 * Does NOT change content, bindings, colors, or layout intent.
 * Records every change with before/after/reason.
 */

import type { DesignTemplate, DesignElement } from "../../../types/designTemplate.js";
import type { OptimizationChange } from "../types/engineering.types.js";

export interface SpacingOptimizerResult {
  elements: DesignElement[];
  changes: OptimizationChange[];
}

/** Minimum margin to keep elements visible (in px) */
const MIN_VISIBLE_PX = 8;

export function optimizeSpacing(template: DesignTemplate): SpacingOptimizerResult {
  const changes: OptimizationChange[] = [];
  const { width: cw, height: ch } = template.canvas;

  const elements = template.elements.map((el): DesignElement => {
    let changed = false;
    let x = el.x;
    let y = el.y;
    let width = el.width;
    let height = el.height;

    // Clamp negative/zero dimensions
    if (width <= 0) {
      const before = width;
      width = MIN_VISIBLE_PX;
      changed = true;
      changes.push({ type: "fix_negative_width", nodeId: el.id, before, after: width, reason: "Width was ≤ 0; clamped to minimum visible size." });
    }
    if (height <= 0) {
      const before = height;
      height = MIN_VISIBLE_PX;
      changed = true;
      changes.push({ type: "fix_negative_height", nodeId: el.id, before, after: height, reason: "Height was ≤ 0; clamped to minimum visible size." });
    }

    // Clamp element right edge inside canvas (but keep at least MIN_VISIBLE_PX visible)
    if (x >= cw) {
      const before = x;
      x = cw - MIN_VISIBLE_PX;
      changed = true;
      changes.push({ type: "clamp_x", nodeId: el.id, before, after: x, reason: `Element was entirely off the right edge (canvas width: ${cw}).` });
    }
    if (y >= ch) {
      const before = y;
      y = ch - MIN_VISIBLE_PX;
      changed = true;
      changes.push({ type: "clamp_y", nodeId: el.id, before, after: y, reason: `Element was entirely below canvas (canvas height: ${ch}).` });
    }

    // Clamp element left/top to keep at least MIN_VISIBLE_PX visible
    if (x + width < MIN_VISIBLE_PX) {
      const before = x;
      x = MIN_VISIBLE_PX - width;
      changed = true;
      changes.push({ type: "clamp_x_min", nodeId: el.id, before, after: x, reason: "Element was off the left edge with no visible area." });
    }
    if (y + height < MIN_VISIBLE_PX) {
      const before = y;
      y = MIN_VISIBLE_PX - height;
      changed = true;
      changes.push({ type: "clamp_y_min", nodeId: el.id, before, after: y, reason: "Element was off the top edge with no visible area." });
    }

    if (!changed) return el;

    return { ...el, x, y, width, height };
  });

  return { elements, changes };
}
