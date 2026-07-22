/**
 * Team 28 — Furniture & Product Design Plugin — Validation
 *
 * Pure-logic validators for brief fields and workflow step progression.
 * No I/O, no database calls — safe to call from tests and service layer.
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

import {
  PD_PRODUCT_CATEGORIES,
  PD_PROJECT_STATUSES,
  PD_WORKFLOW_STEPS,
  type PdProductCategory,
  type PdProjectStatus,
  type PdWorkflowStep,
} from "./schema.js";
import {
  MATERIAL_KEYS,
  COMPONENT_CATEGORIES,
  ARTIFACT_TYPE_KEYS,
  UNSUPPORTED_CAPABILITIES,
  type MaterialKey,
  type ComponentCategory,
  type ProductArtifactType,
} from "./plugin-manifest.js";

// ── Brief validation ──────────────────────────────────────────────────────────

export interface BriefValidationInput {
  productCategory: string;
  targetUser: string;
  environment: string;
  primaryFunction: string;
  widthMm?: number | null;
  depthMm?: number | null;
  heightMm?: number | null;
  weightKg?: number | null;
  primaryMaterials?: string[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface BriefValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export function validateBrief(input: BriefValidationInput): BriefValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Required text fields
  if (!input.productCategory || !input.productCategory.trim()) {
    errors.push({ field: "productCategory", message: "Product category is required." });
  } else if (!(PD_PRODUCT_CATEGORIES as readonly string[]).includes(input.productCategory)) {
    errors.push({
      field: "productCategory",
      message: `Invalid product category "${input.productCategory}". Valid: ${PD_PRODUCT_CATEGORIES.join(", ")}.`,
    });
  }

  if (!input.targetUser || !input.targetUser.trim()) {
    errors.push({ field: "targetUser", message: "Target user description is required." });
  } else if (input.targetUser.length > 1000) {
    errors.push({ field: "targetUser", message: "Target user description must be ≤ 1000 characters." });
  }

  if (!input.environment || !input.environment.trim()) {
    errors.push({ field: "environment", message: "Environment description is required." });
  } else if (input.environment.length > 500) {
    errors.push({ field: "environment", message: "Environment description must be ≤ 500 characters." });
  }

  if (!input.primaryFunction || !input.primaryFunction.trim()) {
    errors.push({ field: "primaryFunction", message: "Primary function is required." });
  } else if (input.primaryFunction.length > 1000) {
    errors.push({ field: "primaryFunction", message: "Primary function must be ≤ 1000 characters." });
  }

  // Dimensional constraints
  if (input.widthMm !== null && input.widthMm !== undefined) {
    if (input.widthMm <= 0) errors.push({ field: "widthMm", message: "Width must be > 0 mm." });
    if (input.widthMm > 20000) errors.push({ field: "widthMm", message: "Width must be ≤ 20 000 mm." });
  }
  if (input.depthMm !== null && input.depthMm !== undefined) {
    if (input.depthMm <= 0) errors.push({ field: "depthMm", message: "Depth must be > 0 mm." });
    if (input.depthMm > 20000) errors.push({ field: "depthMm", message: "Depth must be ≤ 20 000 mm." });
  }
  if (input.heightMm !== null && input.heightMm !== undefined) {
    if (input.heightMm <= 0) errors.push({ field: "heightMm", message: "Height must be > 0 mm." });
    if (input.heightMm > 10000) errors.push({ field: "heightMm", message: "Height must be ≤ 10 000 mm." });
    if (input.heightMm > 0 && input.heightMm < 100) {
      warnings.push("Height < 100 mm — verify this is correct for a furniture/product item.");
    }
  }
  if (input.weightKg !== null && input.weightKg !== undefined) {
    if (input.weightKg <= 0) errors.push({ field: "weightKg", message: "Weight must be > 0 kg." });
    if (input.weightKg > 5000) errors.push({ field: "weightKg", message: "Weight must be ≤ 5000 kg." });
  }

  // Materials
  if (input.primaryMaterials && input.primaryMaterials.length > 0) {
    for (const mat of input.primaryMaterials) {
      if (!(MATERIAL_KEYS as readonly string[]).includes(mat)) {
        errors.push({
          field: "primaryMaterials",
          message: `Unknown material key "${mat}". Valid: ${MATERIAL_KEYS.join(", ")}.`,
        });
      }
    }
  }

  // Ergonomic warning for seating without height
  if (
    input.productCategory === "seating" &&
    (input.heightMm === null || input.heightMm === undefined)
  ) {
    warnings.push("Seating products should specify seat height for ergonomic validation.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Workflow step progression ─────────────────────────────────────────────────

const STEP_ORDER = PD_WORKFLOW_STEPS as readonly PdWorkflowStep[];

/**
 * Returns the next workflow step after the given step, or null at the end.
 */
export function getNextStep(current: PdWorkflowStep): PdWorkflowStep | null {
  const idx = STEP_ORDER.indexOf(current);
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1] ?? null;
}

/**
 * Validates that a transition from `from` to `to` is legal (forward only,
 * or same step for updates).
 */
export function validateStepTransition(
  from: PdWorkflowStep,
  to: PdWorkflowStep,
): { valid: boolean; reason?: string } {
  const fromIdx = STEP_ORDER.indexOf(from);
  const toIdx = STEP_ORDER.indexOf(to);

  if (fromIdx === -1) return { valid: false, reason: `Unknown step "${from}".` };
  if (toIdx === -1) return { valid: false, reason: `Unknown step "${to}".` };
  if (toIdx < fromIdx) {
    return {
      valid: false,
      reason: `Cannot go back from "${from}" to "${to}". Workflow is forward-only. Use review notes for corrections.`,
    };
  }
  return { valid: true };
}

/**
 * Status transition guard — maps workflow steps to allowed project statuses.
 * Prevents skipping the review gate before export.
 */
export function validateStatusTransition(
  from: PdProjectStatus,
  to: PdProjectStatus,
): { valid: boolean; reason?: string } {
  // Terminal states cannot be escaped except by admin override
  if (from === "cancelled") {
    return { valid: false, reason: "Cancelled projects cannot be reactivated." };
  }
  if (from === "exported" && to !== "exported") {
    return { valid: false, reason: "Exported projects are read-only." };
  }

  // Must pass through "reviewing" before "approved" or "exported"
  const requiresReview: PdProjectStatus[] = ["approved", "exported"];
  if (requiresReview.includes(to)) {
    const reviewIdx = (PD_PROJECT_STATUSES as readonly string[]).indexOf("reviewing");
    const fromIdx = (PD_PROJECT_STATUSES as readonly string[]).indexOf(from);
    if (fromIdx < reviewIdx) {
      return {
        valid: false,
        reason: `Cannot transition to "${to}" before reaching "reviewing" status.`,
      };
    }
  }

  return { valid: true };
}

// ── Artifact type guard ───────────────────────────────────────────────────────

export function validateArtifactType(type: string): type is ProductArtifactType {
  return (ARTIFACT_TYPE_KEYS as readonly string[]).includes(type);
}

// ── Component category guard ──────────────────────────────────────────────────

export function validateComponentCategory(cat: string): cat is ComponentCategory {
  return (COMPONENT_CATEGORIES as readonly string[]).includes(cat);
}

// ── Material guard ────────────────────────────────────────────────────────────

export function validateMaterialKey(key: string): key is MaterialKey {
  return (MATERIAL_KEYS as readonly string[]).includes(key);
}

// ── Product category guard ────────────────────────────────────────────────────

export function validateProductCategory(cat: string): cat is PdProductCategory {
  return (PD_PRODUCT_CATEGORIES as readonly string[]).includes(cat);
}

// ── No-CAD guard (hard cap) ───────────────────────────────────────────────────

/**
 * Throws if `capability` is in the plugin's UNSUPPORTED_CAPABILITIES list.
 * Call at any entry point that might attempt unsupported operations.
 */
export function assertNoCadRuntime(capability: string): void {
  if ((UNSUPPORTED_CAPABILITIES as readonly string[]).includes(capability)) {
    throw new Error(
      `[furniture-product-design] Unsupported capability: "${capability}". ` +
      `This plugin does not provide CAD, parametric modelling, or simulation engines.`
    );
  }
}

// ── Technical view metadata ───────────────────────────────────────────────────

export interface TechnicalViewMetadata {
  views: Array<"front" | "side" | "top" | "section" | "detail">;
  unit: "mm";
  scale?: string;         // e.g. "1:10"
  annotations: string[];
}

export function validateTechnicalViewMetadata(meta: TechnicalViewMetadata): BriefValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (!meta.views || meta.views.length === 0) {
    errors.push({ field: "views", message: "At least one orthographic view is required." });
  }

  const validViews = ["front", "side", "top", "section", "detail"] as const;
  for (const v of meta.views ?? []) {
    if (!(validViews as readonly string[]).includes(v)) {
      errors.push({ field: "views", message: `Unknown view type "${v}".` });
    }
  }

  if (meta.unit !== "mm") {
    errors.push({ field: "unit", message: `Unit must be "mm". Received: "${meta.unit}".` });
  }

  if (meta.scale && !/^\d+:\d+$/.test(meta.scale)) {
    warnings.push(`Scale "${meta.scale}" does not match expected pattern (e.g. "1:10").`);
  }

  if (!meta.annotations || meta.annotations.length === 0) {
    warnings.push("Technical view has no dimension annotations — consider adding key measurements.");
  }

  return { valid: errors.length === 0, errors, warnings };
}
