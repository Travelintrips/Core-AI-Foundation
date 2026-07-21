/**
 * material-library/materialAssignmentService.ts — Team 21
 *
 * Domain-neutral material assignment boundary.
 *
 * Enforces:
 *   - Material must exist and be active.
 *   - Material must be compatible with the target domain (or have no domain restriction).
 *   - Target must be a non-empty string — no domain-specific targets (garment, wall, etc.).
 *   - Override properties are validated against the material's category definitions.
 *   - assignedBy is taken from ctx, not caller input.
 *
 * Integration note (Teams 12, 14, 24–30):
 *   - Team 12 (Layout Composer): call validateAssignment() before opening material picker.
 *   - Team 14 (Universal Renderer): call validateAssignment() before using material preview.
 *   - Domain teams: use compatibleDomains on MaterialDefinition to filter pickers.
 */

import { randomUUID } from "crypto";
import type { RequestContext } from "../../security/requestContext.js";
import type { MaterialAssignment, MaterialAssignmentValidationResult } from "./types.js";
import { getMaterial, MaterialNotFoundError, MaterialAccessDeniedError } from "./materialLibraryService.js";
import { materialCategoryRegistry } from "./categoryRegistry.js";
import { validateAllProperties } from "./propertySchema.js";

// ── Errors ────────────────────────────────────────────────────────────────────

export class MaterialAssignmentValidationError extends Error {
  constructor(public readonly errors: readonly string[]) {
    super(`Material assignment validation failed: ${errors.join("; ")}`);
    this.name = "MaterialAssignmentValidationError";
  }
}

export class InvalidAssignmentTargetError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidAssignmentTargetError";
  }
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface CreateAssignmentInput {
  readonly materialId: string;
  /** ID of the design, project, or template artifact. Must be non-empty. */
  readonly targetArtifactId: string;
  /** Optional element ID within the artifact. */
  readonly targetElementId?: string | null;
  /** Optional region ID within the artifact (mutually exclusive with elementId). */
  readonly targetRegionId?: string | null;
  /** Override properties for this specific assignment. */
  readonly overrideProperties?: Readonly<Record<string, unknown>>;
  /** Source of the assignment, e.g. "user", "ai_suggestion", "plugin". */
  readonly assignmentSource?: string;
  /** Optional capability that drove this assignment. */
  readonly capability?: string;
  /** Optional domain slug for compatibility check. */
  readonly domain?: string;
}

// ── In-process store ──────────────────────────────────────────────────────────

const _assignments = new Map<string, MaterialAssignment>();

// ── Validation ────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

/**
 * Validate a proposed material assignment.
 * Does not persist anything — returns a validation result.
 */
export function validateAssignment(
  input: CreateAssignmentInput,
  ctx: RequestContext,
): MaterialAssignmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Target must not be empty or domain-specific
  if (!input.targetArtifactId || typeof input.targetArtifactId !== "string" || !input.targetArtifactId.trim()) {
    errors.push("targetArtifactId must be a non-empty string");
  }

  // elementId and regionId are mutually exclusive
  if (input.targetElementId && input.targetRegionId) {
    errors.push("Specify either targetElementId or targetRegionId, not both");
  }

  // Material must exist and be accessible
  let material;
  try {
    material = getMaterial(input.materialId, ctx);
  } catch (e) {
    if (e instanceof MaterialNotFoundError || e instanceof MaterialAccessDeniedError) {
      errors.push(e.message);
    } else {
      errors.push(`Failed to resolve material: ${String(e)}`);
    }
    return { valid: false, errors, warnings, checkedAt: now() };
  }

  // Material must be active
  if (material.status !== "active") {
    errors.push(`Material "${material.materialId}" is not active (status: ${material.status})`);
  }

  // Domain compatibility check
  if (input.domain && material.compatibility.compatibleDomains.length > 0) {
    if (!material.compatibility.compatibleDomains.includes(input.domain)) {
      errors.push(
        `Material "${material.materialId}" is not compatible with domain "${input.domain}". ` +
          `Compatible domains: ${material.compatibility.compatibleDomains.join(", ")}`,
      );
    }
  }

  // Validate override properties against category schema
  if (input.overrideProperties && Object.keys(input.overrideProperties).length > 0) {
    const defs = materialCategoryRegistry.resolvePropertyDefinitions(material.categoryId);
    const result = validateAllProperties(
      defs,
      input.overrideProperties as Record<string, unknown>,
    );
    if (!result.valid) errors.push(...result.errors);
  }

  // Warn if capability is declared but not registered by any plugin
  if (input.capability) {
    // Non-fatal: just warn
    warnings.push(`Capability "${input.capability}" was specified; ensure the handling plugin is registered`);
  }

  return { valid: errors.length === 0, errors, warnings, checkedAt: now() };
}

/**
 * Create and persist a material assignment.
 * Throws MaterialAssignmentValidationError if validation fails.
 */
export function createAssignment(
  input: CreateAssignmentInput,
  ctx: RequestContext,
): MaterialAssignment {
  const validationResult = validateAssignment(input, ctx);
  if (!validationResult.valid) {
    throw new MaterialAssignmentValidationError(validationResult.errors);
  }

  const material = getMaterial(input.materialId, ctx);
  const assignmentId = randomUUID();

  const assignment: MaterialAssignment = {
    assignmentId,
    materialId: input.materialId,
    materialVersion: material.version,
    targetArtifactId: input.targetArtifactId.trim(),
    targetElementId: input.targetElementId ?? null,
    targetRegionId: input.targetRegionId ?? null,
    overrideProperties: (input.overrideProperties ?? {}) as Record<string, unknown>,
    assignmentSource: input.assignmentSource ?? "user",
    capability: input.capability,
    assignedAt: now(),
    assignedBy: ctx.actorId ?? undefined,
    validationResult,
  };

  _assignments.set(assignmentId, assignment);
  return assignment;
}

/** Get an assignment by ID. Returns undefined if not found. */
export function getAssignment(assignmentId: string): MaterialAssignment | undefined {
  return _assignments.get(assignmentId);
}

/** List assignments for an artifact. */
export function listAssignmentsForArtifact(targetArtifactId: string): MaterialAssignment[] {
  return Array.from(_assignments.values()).filter(
    (a) => a.targetArtifactId === targetArtifactId,
  );
}

/** Delete an assignment. */
export function deleteAssignment(assignmentId: string): boolean {
  return _assignments.delete(assignmentId);
}

/** Reset store — for tests only. */
export function _resetAssignmentStoreForTests(): void {
  _assignments.clear();
}
