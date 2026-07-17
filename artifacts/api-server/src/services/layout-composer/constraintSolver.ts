// ============================================================
// TEAM 12 — Constraint Solver
// Iterative constraint propagation engine.
// Deterministic: same input always produces same output.
// ============================================================

import type {
  LayoutElement,
  LayoutCanvas,
  LayoutZone,
  Constraint,
  LayoutOperation,
  LayoutPlan,
  ConstraintViolation,
  ConstraintPriority,
  FixedPositionParams,
  FixedSizeParams,
  AlignToElementParams,
  MinMaxParams,
  AspectRatioParams,
  SpacingParams,
  PaddingParams,
  HierarchyParams,
  TextFitParams,
  ZoneParams,
  TextStyle,
} from "../../types/layout-composer/index.js";

import {
  alignElements,
  alignToElement,
  distributeElements,
  applyOperation,
  move,
  resize,
  place,
} from "./layoutOperations.js";

import {
  findAllCollisions,
  resolveCollision,
  clampToRect,
} from "./collisionDetection.js";

import { clampToSafeZone, innerRect } from "./safeZones.js";
import { checkTextFit, shrinkFontToFit, expandHeightToFit } from "./textFitting.js";
import { findZoneById, clampElementsToZones } from "./zoneLayouts.js";

import { LAYOUT_LIMITS } from "./constants.js";

const MAX_ITERATIONS = LAYOUT_LIMITS.MAX_ITERATIONS;
const PRIORITY_ORDER: ConstraintPriority[] = ["hard", "soft", "hint"];
const EPSILON = 0.5; // sub-pixel change threshold for convergence

// ── Internal state ────────────────────────────────────────────

function cloneElements(elements: LayoutElement[]): LayoutElement[] {
  return elements.map((e) => ({ ...e, textStyle: e.textStyle ? { ...e.textStyle } : undefined }));
}

function elementById(state: LayoutElement[], id: string): LayoutElement | undefined {
  return state.find((e) => e.id === id);
}

function elementsByIds(state: LayoutElement[], ids: string[]): LayoutElement[] {
  return ids.map((id) => elementById(state, id)).filter(Boolean) as LayoutElement[];
}

function applyDelta(
  state: LayoutElement[],
  id: string,
  delta: Partial<LayoutElement>
): LayoutElement[] {
  return state.map((e) => (e.id === id ? { ...e, ...delta } : e));
}

function hasChanged(op: LayoutOperation): boolean {
  const before = op.before as Record<string, unknown>;
  const after = op.after as Record<string, unknown>;
  for (const key of Object.keys(after)) {
    const b = before[key] as number | undefined;
    const a = after[key] as number | undefined;
    if (typeof a === "number" && typeof b === "number") {
      if (Math.abs(a - b) > EPSILON) return true;
    } else if (a !== b) {
      return true;
    }
  }
  return false;
}

// ── Constraint handlers ───────────────────────────────────────

function applyConstraint(
  constraint: Constraint,
  state: LayoutElement[],
  canvas: LayoutCanvas,
  zones: LayoutZone[],
  iteration: number
): { state: LayoutElement[]; ops: LayoutOperation[] } {
  const ops: LayoutOperation[] = [];
  let current = state;

  const elements = elementsByIds(current, constraint.elementIds);
  if (elements.length === 0) return { state: current, ops };

  const p = constraint.params as Record<string, unknown> | undefined;

  switch (constraint.type) {
    // ── Fixed position ──────────────────────────────────────
    case "fixed_position": {
      const params = p as unknown as unknown as FixedPositionParams;
      for (const el of elements) {
        if (el.locked) continue;
        if (Math.abs(el.x - params.x) > EPSILON || Math.abs(el.y - params.y) > EPSILON) {
          const op = place(el, params.x, params.y, constraint.id, iteration);
          if (hasChanged(op)) {
            ops.push(op);
            current = applyDelta(current, el.id, op.after);
          }
        }
      }
      break;
    }

    // ── Fixed size ──────────────────────────────────────────
    case "fixed_size": {
      const params = p as unknown as FixedSizeParams;
      for (const el of elements) {
        if (el.locked) continue;
        const w = params.width;
        const h = params.height;
        if (Math.abs(el.width - w) > EPSILON || Math.abs(el.height - h) > EPSILON) {
          const op = resize(el, w, h, constraint.id, "Fixed size", iteration);
          if (hasChanged(op)) {
            ops.push(op);
            current = applyDelta(current, el.id, op.after);
          }
        }
      }
      break;
    }

    // ── Min/max width & height ──────────────────────────────
    case "min_width": {
      const { value } = p as unknown as MinMaxParams;
      for (const el of elements) {
        if (el.locked || el.width >= value) continue;
        const op = resize(el, value, el.height, constraint.id, `min_width=${value}`, iteration);
        if (hasChanged(op)) { ops.push(op); current = applyDelta(current, el.id, op.after); }
      }
      break;
    }
    case "max_width": {
      const { value } = p as unknown as MinMaxParams;
      for (const el of elements) {
        if (el.locked || el.width <= value) continue;
        const op = resize(el, value, el.height, constraint.id, `max_width=${value}`, iteration);
        if (hasChanged(op)) { ops.push(op); current = applyDelta(current, el.id, op.after); }
      }
      break;
    }
    case "min_height": {
      const { value } = p as unknown as MinMaxParams;
      for (const el of elements) {
        if (el.locked || el.height >= value) continue;
        const op = resize(el, el.width, value, constraint.id, `min_height=${value}`, iteration);
        if (hasChanged(op)) { ops.push(op); current = applyDelta(current, el.id, op.after); }
      }
      break;
    }
    case "max_height": {
      const { value } = p as unknown as MinMaxParams;
      for (const el of elements) {
        if (el.locked || el.height <= value) continue;
        const op = resize(el, el.width, value, constraint.id, `max_height=${value}`, iteration);
        if (hasChanged(op)) { ops.push(op); current = applyDelta(current, el.id, op.after); }
      }
      break;
    }

    // ── Aspect ratio ────────────────────────────────────────
    case "aspect_ratio": {
      const { ratio } = p as unknown as AspectRatioParams;
      for (const el of elements) {
        if (el.locked) continue;
        const currentRatio = el.width / el.height;
        if (Math.abs(currentRatio - ratio) < 0.01) continue;
        // Preserve width, adjust height
        const newHeight = Math.round(el.width / ratio);
        const op = resize(el, el.width, newHeight, constraint.id, `aspect_ratio=${ratio}`, iteration);
        if (hasChanged(op)) { ops.push(op); current = applyDelta(current, el.id, op.after); }
      }
      break;
    }

    // ── Align constraints ───────────────────────────────────
    case "align_left":
    case "align_right":
    case "align_top":
    case "align_bottom":
    case "align_center_x":
    case "align_center_y": {
      const edgeMap = {
        align_left: "left", align_right: "right", align_top: "top",
        align_bottom: "bottom", align_center_x: "centerX", align_center_y: "centerY",
      } as const;
      const edge = edgeMap[constraint.type];
      const freshEls = elementsByIds(current, constraint.elementIds);
      const newOps = alignElements(freshEls, edge, constraint.id, iteration).filter(hasChanged);
      for (const op of newOps) {
        ops.push(op);
        current = applyDelta(current, op.elementId, op.after);
      }
      break;
    }

    // ── Align to specific element ───────────────────────────
    case "align_to_element": {
      const params = p as unknown as AlignToElementParams;
      const target = elementById(current, params.targetId);
      if (!target) break;
      const freshEls = elementsByIds(current, constraint.elementIds).filter(
        (e) => e.id !== params.targetId
      );
      const newOps = alignToElement(freshEls, target, params.edge, constraint.id, iteration).filter(hasChanged);
      for (const op of newOps) {
        ops.push(op);
        current = applyDelta(current, op.elementId, op.after);
      }
      break;
    }

    // ── Distribute ──────────────────────────────────────────
    case "distribute_horizontal":
    case "distribute_vertical": {
      const axis = constraint.type === "distribute_horizontal" ? "horizontal" : "vertical";
      const gap = (p as unknown as SpacingParams)?.gap;
      const freshEls = elementsByIds(current, constraint.elementIds);
      const newOps = distributeElements(freshEls, axis, constraint.id, gap, iteration).filter(hasChanged);
      for (const op of newOps) {
        ops.push(op);
        current = applyDelta(current, op.elementId, op.after);
      }
      break;
    }

    // ── Spacing ─────────────────────────────────────────────
    case "spacing_min":
    case "spacing_exact": {
      const { gap, axis = "both" } = p as unknown as SpacingParams;
      const freshEls = elementsByIds(current, constraint.elementIds);
      for (let i = 0; i < freshEls.length; i++) {
        for (let j = i + 1; j < freshEls.length; j++) {
          const a = elementById(current, freshEls[i].id)!;
          const b = elementById(current, freshEls[j].id)!;
          if (a.locked && b.locked) continue;

          if (axis === "horizontal" || axis === "both") {
            const gapRight = b.x - (a.x + a.width);
            const gapLeft = a.x - (b.x + b.width);
            const actualGap = Math.max(gapRight, gapLeft);
            if (actualGap < gap) {
              const push = (gap - actualGap) / 2;
              const aIsLeft = a.x < b.x;
              if (!a.locked) {
                const op = move(a, aIsLeft ? -push : push, 0, constraint.id, `spacing_min h`, iteration);
                if (hasChanged(op)) { ops.push(op); current = applyDelta(current, a.id, op.after); }
              }
              if (!b.locked) {
                const bEl = elementById(current, b.id)!;
                const op = move(bEl, aIsLeft ? push : -push, 0, constraint.id, `spacing_min h`, iteration);
                if (hasChanged(op)) { ops.push(op); current = applyDelta(current, b.id, op.after); }
              }
            }
          }
          if (axis === "vertical" || axis === "both") {
            const gapBelow = b.y - (a.y + a.height);
            const gapAbove = a.y - (b.y + b.height);
            const actualGap = Math.max(gapBelow, gapAbove);
            if (actualGap < gap) {
              const push = (gap - actualGap) / 2;
              const aIsAbove = a.y < b.y;
              if (!a.locked) {
                const aEl = elementById(current, a.id)!;
                const op = move(aEl, 0, aIsAbove ? -push : push, constraint.id, `spacing_min v`, iteration);
                if (hasChanged(op)) { ops.push(op); current = applyDelta(current, a.id, op.after); }
              }
              if (!b.locked) {
                const bEl = elementById(current, b.id)!;
                const op = move(bEl, 0, aIsAbove ? push : -push, constraint.id, `spacing_min v`, iteration);
                if (hasChanged(op)) { ops.push(op); current = applyDelta(current, b.id, op.after); }
              }
            }
          }
        }
      }
      break;
    }

    // ── Padding (container inner content area) ──────────────
    case "padding": {
      const { containerId, padding } = p as unknown as PaddingParams;
      const container = elementById(current, containerId);
      if (!container) break;
      const inner = innerRect(container, padding);
      const children = elementsByIds(current, constraint.elementIds);
      for (const child of children) {
        if (child.locked) continue;
        const clamped = clampToRect(child, inner);
        const didChange =
          Math.abs(clamped.x - child.x) > EPSILON ||
          Math.abs(clamped.y - child.y) > EPSILON ||
          Math.abs(clamped.width - child.width) > EPSILON ||
          Math.abs(clamped.height - child.height) > EPSILON;
        if (didChange) {
          const op: LayoutOperation = {
            type: "clamp",
            elementId: child.id,
            constraintId: constraint.id,
            before: { x: child.x, y: child.y, width: child.width, height: child.height },
            after: clamped,
            reason: `Clamp to container padding`,
            iteration,
          };
          ops.push(op);
          current = applyDelta(current, child.id, clamped);
        }
      }
      break;
    }

    // ── Hierarchy (z-index ordering) ────────────────────────
    case "hierarchy_above":
    case "hierarchy_below": {
      const { referenceId } = p as unknown as HierarchyParams;
      const reference = elementById(current, referenceId);
      if (!reference) break;
      const refZ = reference.zIndex ?? 0;
      for (const el of elements) {
        if (el.locked) continue;
        const elZ = el.zIndex ?? 0;
        const needsAbove = constraint.type === "hierarchy_above" && elZ <= refZ;
        const needsBelow = constraint.type === "hierarchy_below" && elZ >= refZ;
        if (needsAbove || needsBelow) {
          const newZ = constraint.type === "hierarchy_above" ? refZ + 1 : refZ - 1;
          const op: LayoutOperation = {
            type: "reorder",
            elementId: el.id,
            constraintId: constraint.id,
            before: { zIndex: elZ },
            after: { zIndex: newZ },
            reason: `${constraint.type} reference=${referenceId}`,
            iteration,
          };
          ops.push(op);
          current = applyDelta(current, el.id, { zIndex: newZ });
        }
      }
      break;
    }

    // ── Text fitting ────────────────────────────────────────
    case "text_fit": {
      const tfParams = (p ?? {}) as unknown as TextFitParams;
      for (const el of elements) {
        if (el.locked || el.type !== "text" || !el.textStyle || !el.content) continue;
        const freshEl = elementById(current, el.id)!;
        const result = checkTextFit(freshEl);
        if (result.fits) continue;

        if (tfParams.autoResize && !tfParams.shrinkOnly) {
          // Expand height to fit
          const newHeight = expandHeightToFit(freshEl);
          if (newHeight && Math.abs(newHeight - freshEl.height) > EPSILON) {
            const op = resize(freshEl, freshEl.width, newHeight, constraint.id, "Expand height for text", iteration);
            ops.push(op);
            current = applyDelta(current, el.id, op.after);
          }
        } else if (tfParams.shrinkOnly || tfParams.autoResize) {
          // Shrink font to fit
          const minFont = tfParams.minFontSize ?? 8;
          const newFont = shrinkFontToFit(freshEl, minFont);
          const ts = freshEl.textStyle!;
          if (newFont !== undefined && newFont !== ts.fontSize) {
            const op: LayoutOperation = {
              type: "text_reflow",
              elementId: el.id,
              constraintId: constraint.id,
              before: { textStyle: { ...ts } as TextStyle },
              after: { textStyle: { ...ts, fontSize: newFont } as TextStyle },
              reason: `Shrink font ${ts.fontSize}→${newFont} to fit`,
              iteration,
            };
            ops.push(op);
            current = applyDelta(current, el.id, { textStyle: { ...ts, fontSize: newFont } as TextStyle });
          }
        }
      }
      break;
    }

    case "text_min_size": {
      const { value } = p as unknown as MinMaxParams;
      for (const el of elements) {
        if (el.locked || !el.textStyle) continue;
        const freshEl = elementById(current, el.id)!;
        if ((freshEl.textStyle?.fontSize ?? 0) < value) {
          const op: LayoutOperation = {
            type: "text_reflow",
            elementId: el.id,
            constraintId: constraint.id,
            before: { textStyle: freshEl.textStyle },
            after: { textStyle: { ...freshEl.textStyle!, fontSize: value } as TextStyle },
            reason: `text_min_size=${value}`,
            iteration,
          };
          ops.push(op);
          current = applyDelta(current, el.id, op.after);
        }
      }
      break;
    }

    case "text_max_size": {
      const { value } = p as unknown as MinMaxParams;
      for (const el of elements) {
        if (el.locked || !el.textStyle) continue;
        const freshEl = elementById(current, el.id)!;
        if ((freshEl.textStyle?.fontSize ?? 0) > value) {
          const op: LayoutOperation = {
            type: "text_reflow",
            elementId: el.id,
            constraintId: constraint.id,
            before: { textStyle: freshEl.textStyle },
            after: { textStyle: { ...freshEl.textStyle!, fontSize: value } as TextStyle },
            reason: `text_max_size=${value}`,
            iteration,
          };
          ops.push(op);
          current = applyDelta(current, el.id, op.after);
        }
      }
      break;
    }

    // ── Collision detection & resolution ────────────────────
    case "no_collision": {
      const freshEls = elementsByIds(current, constraint.elementIds);
      const pairs = findAllCollisions(freshEls);
      for (const pair of pairs) {
        const a = elementById(current, pair.elementA)!;
        const b = elementById(current, pair.elementB)!;
        const adjustments = resolveCollision(a, b);
        for (const [id, { dx, dy }] of Object.entries(adjustments)) {
          if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) continue;
          const el = elementById(current, id)!;
          const op: LayoutOperation = {
            type: "push_apart",
            elementId: id,
            constraintId: constraint.id,
            before: { x: el.x, y: el.y },
            after: { x: Math.round(el.x + dx), y: Math.round(el.y + dy) },
            reason: `Collision with ${id === pair.elementA ? pair.elementB : pair.elementA}`,
            iteration,
          };
          if (hasChanged(op)) {
            ops.push(op);
            current = applyDelta(current, id, op.after);
          }
        }
      }
      break;
    }

    // ── Safe zone ───────────────────────────────────────────
    case "safe_zone": {
      for (const el of elements) {
        if (el.locked) continue;
        const freshEl = elementById(current, el.id)!;
        const { changed, ...clamped } = clampToSafeZone(freshEl, canvas);
        if (changed) {
          const op: LayoutOperation = {
            type: "clamp",
            elementId: el.id,
            constraintId: constraint.id,
            before: { x: freshEl.x, y: freshEl.y, width: freshEl.width, height: freshEl.height },
            after: clamped,
            reason: "Clamp to safe zone",
            iteration,
          };
          ops.push(op);
          current = applyDelta(current, el.id, clamped);
        }
      }
      break;
    }

    // ── Room / garment zones ────────────────────────────────
    case "room_zone":
    case "garment_panel": {
      const freshEls = elementsByIds(current, constraint.elementIds);
      const { elements: clamped, changed } = clampElementsToZones(freshEls, zones);
      for (const id of changed) {
        const before = elementById(current, id)!;
        const after = clamped.find((e) => e.id === id)!;
        const op: LayoutOperation = {
          type: "zone_assign",
          elementId: id,
          constraintId: constraint.id,
          before: { x: before.x, y: before.y, width: before.width, height: before.height },
          after: { x: after.x, y: after.y, width: after.width, height: after.height },
          reason: `Clamp to zone "${before.zone}"`,
          iteration,
        };
        if (hasChanged(op)) {
          ops.push(op);
          current = applyDelta(current, id, op.after);
        }
      }
      break;
    }

    // ── Responsive — no-op in main solve (applied via variant) ─
    case "responsive":
      break;

    default:
      break;
  }

  return { state: current, ops };
}

// ── Violation checker ─────────────────────────────────────────

function checkViolations(
  constraints: Constraint[],
  state: LayoutElement[],
  canvas: LayoutCanvas,
  zones: LayoutZone[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const c of constraints) {
    const elements = elementsByIds(state, c.elementIds);
    const p = c.params as Record<string, unknown> | undefined;

    switch (c.type) {
      case "fixed_position": {
        const { x, y } = p as unknown as FixedPositionParams;
        for (const el of elements) {
          if (Math.abs(el.x - x) > EPSILON || Math.abs(el.y - y) > EPSILON) {
            violations.push({
              constraintId: c.id,
              constraintType: c.type,
              elementIds: [el.id],
              message: `Element "${el.id}" is at (${el.x},${el.y}), expected (${x},${y})`,
              severity: c.priority === "hard" ? "error" : "warning",
            });
          }
        }
        break;
      }
      case "min_width": {
        const { value } = p as unknown as MinMaxParams;
        for (const el of elements) {
          if (el.width < value) {
            violations.push({ constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Element "${el.id}" width ${el.width} < min ${value}`, severity: "error" });
          }
        }
        break;
      }
      case "max_width": {
        const { value } = p as unknown as MinMaxParams;
        for (const el of elements) {
          if (el.width > value) {
            violations.push({ constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Element "${el.id}" width ${el.width} > max ${value}`, severity: "error" });
          }
        }
        break;
      }
      case "min_height": {
        const { value } = p as unknown as MinMaxParams;
        for (const el of elements) {
          if (el.height < value) {
            violations.push({ constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Element "${el.id}" height ${el.height} < min ${value}`, severity: "error" });
          }
        }
        break;
      }
      case "max_height": {
        const { value } = p as unknown as MinMaxParams;
        for (const el of elements) {
          if (el.height > value) {
            violations.push({ constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Element "${el.id}" height ${el.height} > max ${value}`, severity: "error" });
          }
        }
        break;
      }
      case "no_collision": {
        const pairs = findAllCollisions(elements);
        for (const pair of pairs) {
          violations.push({
            constraintId: c.id, constraintType: c.type,
            elementIds: [pair.elementA, pair.elementB],
            message: `Elements "${pair.elementA}" and "${pair.elementB}" overlap by ${pair.overlapArea.toFixed(1)}px²`,
            severity: c.priority === "hard" ? "error" : "warning",
            detail: pair as unknown as Record<string, unknown>,
          });
        }
        break;
      }
      case "safe_zone": {
        for (const el of elements) {
          const { changed } = clampToSafeZone(el, canvas);
          if (changed) {
            violations.push({
              constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Element "${el.id}" extends outside safe zone`,
              severity: c.priority === "hard" ? "error" : "warning",
            });
          }
        }
        break;
      }
      case "text_fit": {
        for (const el of elements) {
          if (!el.textStyle || !el.content) continue;
          const result = checkTextFit(el);
          if (!result.fits) {
            violations.push({
              constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Text in "${el.id}" overflows by ${result.overflow.toFixed(1)}px (needs ${result.linesRequired} lines, has ${result.linesAvailable})`,
              severity: "warning",
              detail: result as unknown as Record<string, unknown>,
            });
          }
        }
        break;
      }
      case "room_zone":
      case "garment_panel": {
        for (const el of elements) {
          if (!el.zone) continue;
          const zone = findZoneById(zones, el.zone);
          if (!zone) {
            violations.push({ constraintId: c.id, constraintType: c.type, elementIds: [el.id],
              message: `Zone "${el.zone}" not found`, severity: "error" });
          }
        }
        break;
      }
    }
  }

  return violations;
}

// ── Main solver ───────────────────────────────────────────────

// Wall-clock budget sourced from centralized domain limits.
const SOLVER_DEADLINE_MS = LAYOUT_LIMITS.SOLVER_DEADLINE_MS;

export interface SolverInput {
  id?: string;
  canvas: LayoutCanvas;
  elements: LayoutElement[];
  constraints: Constraint[];
  zones?: LayoutZone[];
  maxIterations?: number;
  /** Wall-clock budget in ms. Solver aborts early if exceeded. Default 5 000. */
  deadlineMs?: number;
}

export function solve(input: SolverInput): LayoutPlan {
  const {
    canvas,
    zones = [],
    maxIterations = MAX_ITERATIONS,
    deadlineMs = SOLVER_DEADLINE_MS,
  } = input;

  // Sort constraints: hard → soft → hint, then by order within tier
  const sorted = [...input.constraints].sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority);
    const pb = PRIORITY_ORDER.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    return (a.order ?? 0) - (b.order ?? 0);
  });

  let state = cloneElements(input.elements);
  const allOps: LayoutOperation[] = [];
  let iterations = 0;
  let converged = false;
  let timedOut = false;

  const deadline = Date.now() + deadlineMs;

  for (let iter = 1; iter <= maxIterations; iter++) {
    // P0 resource cap: abort if wall-clock budget exceeded
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }

    iterations = iter;
    let anyChange = false;

    for (const constraint of sorted) {
      const { state: newState, ops } = applyConstraint(constraint, state, canvas, zones, iter);
      if (ops.length > 0) {
        allOps.push(...ops);
        state = newState;
        anyChange = true;
      }
    }

    if (!anyChange) {
      converged = true;
      break;
    }
  }

  const violations = checkViolations(sorted, state, canvas, zones);
  const hardCount = sorted.filter((c) => c.priority === "hard").length;
  const hardViolations = violations.filter((v) => v.severity === "error").length;
  const satisfactionScore =
    sorted.length === 0
      ? 1
      : Math.max(0, 1 - hardViolations / Math.max(1, hardCount));

  return {
    id: input.id ?? `plan-${Date.now()}`,
    operations: allOps,
    elements: state,
    violations,
    satisfactionScore,
    iterations,
    converged,
    deterministic: true,
    solvedAt: new Date().toISOString(),
  };
}
