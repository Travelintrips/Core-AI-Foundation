// ============================================================
// TEAM 12 — Constraint Pre-Validation (P2)
// Validates inputs BEFORE passing to the solver.
// Fast-fail: catches structural errors that would cause the
// solver to waste iterations or produce misleading results.
// ============================================================

import type { LayoutElement, Constraint } from "../../types/layout-composer/index.js";
import { LAYOUT_LIMITS } from "./constants.js";

export interface PrevalidationError {
  field: string;
  message: string;
}

export interface PrevalidationResult {
  valid: boolean;
  errors: PrevalidationError[];
}

// ── Nesting depth / cycle detection ──────────────────────────

interface DepthResult {
  maxDepth: number;
  hasCycle: boolean;
  cycleIds: string[];
}

function computeNestingDepth(elements: LayoutElement[]): DepthResult {
  const childMap = new Map<string, string[]>();
  for (const el of elements) {
    if (el.children && el.children.length > 0) {
      childMap.set(el.id, el.children);
    }
  }

  const depthCache = new Map<string, number>();
  const visiting = new Set<string>(); // currently in DFS stack
  const cycleIds: string[] = [];

  function dfs(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    if (visiting.has(id)) {
      cycleIds.push(id);
      return Infinity; // cycle detected
    }

    visiting.add(id);
    const children = childMap.get(id) ?? [];
    let maxChild = 0;
    for (const child of children) {
      const childDepth = dfs(child);
      if (childDepth === Infinity) {
        visiting.delete(id);
        return Infinity;
      }
      maxChild = Math.max(maxChild, childDepth);
    }
    visiting.delete(id);

    const depth = 1 + maxChild;
    depthCache.set(id, depth);
    return depth;
  }

  let maxDepth = 0;
  for (const el of elements) {
    const d = dfs(el.id);
    if (d === Infinity) {
      return { maxDepth: Infinity, hasCycle: true, cycleIds };
    }
    maxDepth = Math.max(maxDepth, d);
  }

  return { maxDepth, hasCycle: false, cycleIds: [] };
}

// ── Main pre-validation ───────────────────────────────────────

/**
 * Pre-validate elements and constraints before entering the solver.
 * Returns a list of structural errors; an empty list means input is valid.
 *
 * Checks:
 * 1. All constraint elementIds reference known elements.
 * 2. Constraint ids are unique.
 * 3. No cyclic parent-child (children[]) references.
 * 4. Nesting depth does not exceed MAX_NESTING_DEPTH.
 * 5. No constraint references the same element on both sides of an
 *    align_to_element / spacing constraint in a way that is self-referential.
 */
export function prevalidateRequest(
  elements: LayoutElement[],
  constraints: Constraint[],
): PrevalidationResult {
  const errors: PrevalidationError[] = [];
  const elementIdSet = new Set(elements.map((e) => e.id));

  // ── 1. Constraint elementIds reference existing elements ──
  for (const c of constraints) {
    if (!Array.isArray(c.elementIds) || c.elementIds.length === 0) {
      errors.push({
        field: `constraints[id=${c.id}].elementIds`,
        message: `Constraint "${c.id}" has no elementIds`,
      });
      continue;
    }
    for (const eid of c.elementIds) {
      if (!elementIdSet.has(eid)) {
        errors.push({
          field: `constraints[id=${c.id}].elementIds`,
          message: `Constraint "${c.id}" references unknown element "${eid}"`,
        });
      }
    }
  }

  // ── 2. Constraint ids are unique ──────────────────────────
  const cIdSeen = new Set<string>();
  for (const c of constraints) {
    if (cIdSeen.has(c.id)) {
      errors.push({
        field: "constraints",
        message: `Duplicate constraint id "${c.id}"`,
      });
    }
    cIdSeen.add(c.id);
  }

  // ── 3 & 4. Nesting depth and cycle detection ──────────────
  if (elements.some((e) => e.children && e.children.length > 0)) {
    const { maxDepth, hasCycle, cycleIds } = computeNestingDepth(elements);

    if (hasCycle) {
      errors.push({
        field: "elements",
        message: `Cyclic parent-child reference detected involving element(s): ${cycleIds.join(", ")}`,
      });
    } else if (maxDepth > LAYOUT_LIMITS.MAX_NESTING_DEPTH) {
      errors.push({
        field: "elements",
        message: `Element nesting depth ${maxDepth} exceeds maximum allowed depth ${LAYOUT_LIMITS.MAX_NESTING_DEPTH}`,
      });
    }
  }

  // ── 5. Self-referential align/spacing constraints ─────────
  for (const c of constraints) {
    if (
      (c.type === "align_to_element" || c.type === "spacing_min" || c.type === "spacing_exact") &&
      c.elementIds.length >= 2 &&
      c.elementIds[0] === c.elementIds[1]
    ) {
      errors.push({
        field: `constraints[id=${c.id}]`,
        message: `Constraint "${c.id}" of type "${c.type}" references the same element on both sides`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
