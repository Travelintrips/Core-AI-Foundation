// ============================================================
// TEAM 12 — Layout Composer Facade
// Public API for the constraint-based layout domain
// ============================================================

import { randomUUID } from "crypto";
import type {
  LayoutRequest,
  LayoutPlan,
  ValidateRequest,
  ValidateResult,
  SupportedOperation,
  ConstraintViolation,
} from "../../types/layout-composer/index.js";

import { solve } from "./constraintSolver.js";
import { checkTextFit } from "./textFitting.js";
import { findAllCollisions } from "./collisionDetection.js";
import { isInSafeZone } from "./safeZones.js";
import { validateRoomZones, validateGarmentPanels } from "./zoneLayouts.js";
import {
  STANDARD_BREAKPOINTS,
  buildBreakpointRequest,
  detectBreakpoint,
} from "./responsiveVariants.js";

// ── Solve ──────────────────────────────────────────────────────

/**
 * Run the constraint solver and return a complete LayoutPlan.
 * Deterministic: same request always produces same plan.
 */
export async function composeLayout(request: LayoutRequest): Promise<LayoutPlan> {
  const id = request.id ?? randomUUID();

  const plan = solve({
    id,
    canvas: request.canvas,
    elements: request.elements,
    constraints: request.constraints,
    zones: request.zones,
    maxIterations: request.maxIterations,
  });

  // Optionally produce responsive variants
  if (request.includeResponsive) {
    const currentBp = detectBreakpoint(request.canvas.width);
    const otherBps = STANDARD_BREAKPOINTS.filter((bp) => bp.name !== currentBp.name);

    const variants: Record<string, LayoutPlan> = {};
    for (const bp of otherBps) {
      const variantReq = buildBreakpointRequest(request, bp);
      const variantPlan = solve({
        id: `${id}-${bp.name}`,
        canvas: variantReq.canvas,
        elements: variantReq.elements,
        constraints: variantReq.constraints,
        zones: variantReq.zones,
        maxIterations: request.maxIterations,
      });
      variants[bp.name] = variantPlan;
    }

    return { ...plan, responsiveVariants: variants };
  }

  return plan;
}

// ── Validate only (no solving) ─────────────────────────────────

/**
 * Validate the current state of elements against constraints WITHOUT solving.
 * Returns violations found in the as-given positions.
 */
export function validateLayout(request: ValidateRequest): ValidateResult {
  const { canvas, elements, constraints, zones = [] } = request;
  const violations: ConstraintViolation[] = [];
  const warnings: string[] = [];

  // Text fit checks
  for (const el of elements) {
    if (el.type === "text" && el.textStyle && el.content) {
      const result = checkTextFit(el);
      if (!result.fits) {
        violations.push({
          constraintId: "text_fit_check",
          constraintType: "text_fit",
          elementIds: [el.id],
          message: `Text overflows by ${result.overflow.toFixed(1)}px in "${el.id}"`,
          severity: "warning",
          detail: result as unknown as Record<string, unknown>,
        });
      }
    }
  }

  // Collision checks (all elements, not just constrained ones)
  const collisions = findAllCollisions(elements);
  for (const col of collisions) {
    violations.push({
      constraintId: "collision_check",
      constraintType: "no_collision",
      elementIds: [col.elementA, col.elementB],
      message: `Elements "${col.elementA}" and "${col.elementB}" overlap`,
      severity: "warning",
      detail: col as unknown as Record<string, unknown>,
    });
  }

  // Safe zone checks
  if (canvas.safeZone || canvas.padding) {
    for (const el of elements) {
      if (!isInSafeZone(el, canvas)) {
        violations.push({
          constraintId: "safe_zone_check",
          constraintType: "safe_zone",
          elementIds: [el.id],
          message: `Element "${el.id}" is outside safe zone`,
          severity: "warning",
        });
      }
    }
  }

  // Room zone checks
  if (zones.some((z) => z.category === "room")) {
    const roomViolations = validateRoomZones(elements, zones);
    violations.push(...roomViolations);
  }

  // Garment panel checks
  if (zones.some((z) => z.category === "garment")) {
    const garmentViolations = validateGarmentPanels(elements, zones);
    violations.push(...garmentViolations);
  }

  // Constraint-declared checks
  for (const c of constraints) {
    const involved = elements.filter((e) => c.elementIds.includes(e.id));
    if (involved.length < c.elementIds.length) {
      warnings.push(`Constraint "${c.id}" references missing elements`);
    }
  }

  return {
    valid: violations.filter((v) => v.severity === "error").length === 0,
    violations,
    warnings,
  };
}

// ── Operation plan (dry-run with operation list only) ──────────

/**
 * Generate the operation plan without running validation.
 * Returns only the operations list — useful for previewing what the solver will do.
 */
export async function generateOperationPlan(
  request: LayoutRequest
): Promise<Pick<LayoutPlan, "id" | "operations" | "iterations" | "converged">> {
  const plan = await composeLayout(request);
  return {
    id: plan.id,
    operations: plan.operations,
    iterations: plan.iterations,
    converged: plan.converged,
  };
}

// ── Supported operations ───────────────────────────────────────

export function getSupportedOperations(): SupportedOperation[] {
  return [
    { type: "place",        description: "Set element absolute position (x, y)" },
    { type: "move",         description: "Shift element by (dx, dy)" },
    { type: "resize",       description: "Set element dimensions (width, height)" },
    { type: "align",        description: "Align elements to shared edge or axis" },
    { type: "distribute",   description: "Distribute elements evenly along an axis" },
    { type: "reorder",      description: "Adjust z-index for hierarchy constraints" },
    { type: "text_reflow",  description: "Adjust font size or element size for text fit" },
    { type: "clamp",        description: "Clamp element within safe zone or padded container" },
    { type: "push_apart",   description: "Push overlapping elements apart (collision resolution)" },
    { type: "zone_assign",  description: "Clamp element to its assigned room or garment zone" },
  ];
}
