/**
 * Bounds Validator — Canvas Overflow & Element Out-of-Bounds
 *
 * Checks whether elements are positioned within the canvas area.
 * An element is "out of bounds" if its bounding box has no intersection
 * with the canvas rectangle. Partial overlap is a warning; full overflow is an error.
 *
 * Deterministic — no AI calls.
 */

import type { DesignTemplate } from "../../../types/designTemplate.js";
import type { ValidationIssue } from "../types/engineering.types.js";

export function runBoundsValidator(template: DesignTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { width: cw, height: ch } = template.canvas;

  for (const el of template.elements) {
    const right  = el.x + el.width;
    const bottom = el.y + el.height;

    // Fully outside (no intersection with canvas)
    const fullyOutside =
      el.x >= cw || el.y >= ch || right <= 0 || bottom <= 0;

    if (fullyOutside) {
      issues.push({
        code: "ELEMENT_OUT_OF_BOUNDS",
        severity: "error",
        nodeId: el.id,
        message: `Element "${el.id}" (x:${el.x}, y:${el.y}, w:${el.width}, h:${el.height}) is entirely outside the ${cw}×${ch} canvas.`,
        suggestedFix: "Move the element so it overlaps the canvas area.",
      });
      continue;
    }

    // Partially outside (canvas overflow)
    const partiallyOutside =
      el.x < 0 || el.y < 0 || right > cw || bottom > ch;

    if (partiallyOutside) {
      issues.push({
        code: "CANVAS_OVERFLOW",
        severity: "warning",
        nodeId: el.id,
        message: `Element "${el.id}" extends beyond the ${cw}×${ch} canvas boundary (x:${el.x}, y:${el.y}, right:${right}, bottom:${bottom}).`,
        suggestedFix: "Resize or reposition so the element stays within canvas bounds.",
      });
    }
  }

  return issues;
}
