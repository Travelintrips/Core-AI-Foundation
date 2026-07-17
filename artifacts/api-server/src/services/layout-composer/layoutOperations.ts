// ============================================================
// TEAM 12 — Layout Operations
// High-level operation builders for place, move, resize,
// align, distribute — used by both API and solver
// ============================================================

import type {
  LayoutElement,
  LayoutOperation,
  OperationType,
} from "../../types/layout-composer/index.js";

// ── Helpers ───────────────────────────────────────────────────

function op(
  type: OperationType,
  elementId: string,
  constraintId: string,
  before: Partial<LayoutElement>,
  after: Partial<LayoutElement>,
  reason: string,
  iteration = 0
): LayoutOperation {
  return { type, elementId, constraintId, before, after, reason, iteration };
}

function elementById(elements: LayoutElement[], id: string): LayoutElement | undefined {
  return elements.find((e) => e.id === id);
}

// ── Place ─────────────────────────────────────────────────────

export function place(
  el: LayoutElement,
  x: number,
  y: number,
  constraintId: string,
  iteration = 0
): LayoutOperation {
  return op(
    "place",
    el.id,
    constraintId,
    { x: el.x, y: el.y },
    { x, y },
    `Place element at (${x}, ${y})`,
    iteration
  );
}

// ── Move ──────────────────────────────────────────────────────

export function move(
  el: LayoutElement,
  dx: number,
  dy: number,
  constraintId: string,
  reason = "move",
  iteration = 0
): LayoutOperation {
  return op(
    "move",
    el.id,
    constraintId,
    { x: el.x, y: el.y },
    { x: el.x + dx, y: el.y + dy },
    reason,
    iteration
  );
}

// ── Resize ────────────────────────────────────────────────────

export function resize(
  el: LayoutElement,
  width: number,
  height: number,
  constraintId: string,
  reason = "resize",
  iteration = 0
): LayoutOperation {
  return op(
    "resize",
    el.id,
    constraintId,
    { width: el.width, height: el.height },
    { width, height },
    reason,
    iteration
  );
}

// ── Align ─────────────────────────────────────────────────────

export type AlignEdge = "left" | "right" | "top" | "bottom" | "centerX" | "centerY";

/**
 * Align all elements to a common edge/axis.
 * Reference value is computed from the set of elements themselves.
 */
export function alignElements(
  elements: LayoutElement[],
  edge: AlignEdge,
  constraintId: string,
  iteration = 0
): LayoutOperation[] {
  if (elements.length < 2) return [];

  const ops: LayoutOperation[] = [];

  let refValue: number;
  switch (edge) {
    case "left":      refValue = Math.min(...elements.map((e) => e.x)); break;
    case "right":     refValue = Math.max(...elements.map((e) => e.x + e.width)); break;
    case "top":       refValue = Math.min(...elements.map((e) => e.y)); break;
    case "bottom":    refValue = Math.max(...elements.map((e) => e.y + e.height)); break;
    case "centerX":   refValue = elements.reduce((s, e) => s + e.x + e.width / 2, 0) / elements.length; break;
    case "centerY":   refValue = elements.reduce((s, e) => s + e.y + e.height / 2, 0) / elements.length; break;
  }

  for (const el of elements) {
    if (el.locked) continue;

    let newX = el.x;
    let newY = el.y;

    switch (edge) {
      case "left":    newX = refValue; break;
      case "right":   newX = refValue - el.width; break;
      case "top":     newY = refValue; break;
      case "bottom":  newY = refValue - el.height; break;
      case "centerX": newX = refValue - el.width / 2; break;
      case "centerY": newY = refValue - el.height / 2; break;
    }

    if (newX !== el.x || newY !== el.y) {
      ops.push(
        op(
          "align",
          el.id,
          constraintId,
          { x: el.x, y: el.y },
          { x: Math.round(newX), y: Math.round(newY) },
          `Align ${edge} to ${Math.round(refValue)}`,
          iteration
        )
      );
    }
  }

  return ops;
}

/**
 * Align elements to a specific target element's edge.
 */
export function alignToElement(
  elements: LayoutElement[],
  target: LayoutElement,
  edge: AlignEdge,
  constraintId: string,
  iteration = 0
): LayoutOperation[] {
  if (!target) return [];
  return alignElements([...elements, target], edge, constraintId, iteration).filter(
    (o) => o.elementId !== target.id
  );
}

// ── Distribute ────────────────────────────────────────────────

/**
 * Distribute elements evenly along an axis.
 * The two outermost elements stay fixed; inner ones are repositioned.
 */
export function distributeElements(
  elements: LayoutElement[],
  axis: "horizontal" | "vertical",
  constraintId: string,
  gap?: number,
  iteration = 0
): LayoutOperation[] {
  if (elements.length < 3 && gap === undefined) return [];
  if (elements.length < 2) return [];

  const ops: LayoutOperation[] = [];

  if (axis === "horizontal") {
    const sorted = [...elements].sort((a, b) => a.x - b.x);

    if (gap !== undefined) {
      // Distribute with a fixed gap
      let cursor = sorted[0].x + sorted[0].width + gap;
      for (let i = 1; i < sorted.length; i++) {
        const el = sorted[i];
        if (!el.locked && Math.round(el.x) !== Math.round(cursor)) {
          ops.push(
            op("distribute", el.id, constraintId,
              { x: el.x }, { x: Math.round(cursor) },
              `Distribute horizontal with gap=${gap}`, iteration)
          );
        }
        cursor += el.width + gap;
      }
    } else {
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = (last.x + last.width) - first.x;
      const totalElementWidth = sorted.reduce((s, e) => s + e.width, 0);
      const spacing = (totalSpan - totalElementWidth) / (sorted.length - 1);

      let cursor = first.x;
      for (const el of sorted) {
        if (!el.locked && Math.round(el.x) !== Math.round(cursor)) {
          ops.push(
            op("distribute", el.id, constraintId,
              { x: el.x }, { x: Math.round(cursor) },
              `Distribute horizontal spacing=${Math.round(spacing)}`, iteration)
          );
        }
        cursor += el.width + spacing;
      }
    }
  } else {
    const sorted = [...elements].sort((a, b) => a.y - b.y);

    if (gap !== undefined) {
      let cursor = sorted[0].y + sorted[0].height + gap;
      for (let i = 1; i < sorted.length; i++) {
        const el = sorted[i];
        if (!el.locked && Math.round(el.y) !== Math.round(cursor)) {
          ops.push(
            op("distribute", el.id, constraintId,
              { y: el.y }, { y: Math.round(cursor) },
              `Distribute vertical with gap=${gap}`, iteration)
          );
        }
        cursor += el.height + gap;
      }
    } else {
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan = (last.y + last.height) - first.y;
      const totalElementHeight = sorted.reduce((s, e) => s + e.height, 0);
      const spacing = (totalSpan - totalElementHeight) / (sorted.length - 1);

      let cursor = first.y;
      for (const el of sorted) {
        if (!el.locked && Math.round(el.y) !== Math.round(cursor)) {
          ops.push(
            op("distribute", el.id, constraintId,
              { y: el.y }, { y: Math.round(cursor) },
              `Distribute vertical spacing=${Math.round(spacing)}`, iteration)
          );
        }
        cursor += el.height + spacing;
      }
    }
  }

  return ops;
}

// ── Apply operation to element state ─────────────────────────

/**
 * Apply a LayoutOperation's `after` delta to an element array.
 * Returns the updated array (immutable).
 */
export function applyOperation(
  elements: LayoutElement[],
  operation: LayoutOperation
): LayoutElement[] {
  return elements.map((el) => {
    if (el.id !== operation.elementId) return el;
    return { ...el, ...operation.after };
  });
}

/** Apply a list of operations sequentially */
export function applyOperations(
  elements: LayoutElement[],
  operations: LayoutOperation[]
): LayoutElement[] {
  return operations.reduce(applyOperation, elements);
}
