/**
 * validators.ts — Team 29: Architecture & Landscape Design Plugin
 *
 * PURE module: no DB calls, no side effects.
 * Safe to call from routes, service, and tests without any mocking.
 *
 * Validates:
 *   - Brief input fields (required fields, type constraints)
 *   - Site constraints (numeric bounds, logical consistency)
 *   - Artifact label honesty (no forbidden professional claims)
 *   - Workflow step ordering
 */

import {
  ARCHITECTURE_ARTIFACT_TYPES,
  ARCHITECTURE_PROJECT_TYPES,
  ARCHITECTURE_WORKFLOW_STEPS,
  FORBIDDEN_ARTIFACT_LABELS,
  type ArchitectureArtifactType,
  type ArchitectureWorkflowStep,
  type ForbiddenArtifactLabel,
} from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface HonestyCheckResult {
  honest: boolean;
  reason: string | null;
  /** Which forbidden label was detected, if any. */
  forbiddenLabel: ForbiddenArtifactLabel | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief validation
// ─────────────────────────────────────────────────────────────────────────────

export interface BriefInput {
  projectType?: string;
  clientName?: string;
  clientEmail?: string;
  projectTitle?: string;
  siteLocation?: string;
  siteAreaM2?: number | string | null;
  builtAreaM2?: number | string | null;
  climate?: string;
  userDescription?: string;
  program?: string[];
  constraints?: string[];
  regulationReferences?: string[];
  stylePreference?: string;
  materialPreferences?: string[];
  landscapeRequirements?: string;
  sustainabilityGoals?: string;
  accessibilityRequirements?: string;
  additionalNotes?: string;
}

export function validateBrief(input: BriefInput): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // ── Required fields ────────────────────────────────────────────────────────

  if (!input.projectType || String(input.projectType).trim() === "") {
    errors.push({
      field: "projectType",
      code: "required",
      message: "Project type is required.",
    });
  } else if (
    !(ARCHITECTURE_PROJECT_TYPES as readonly string[]).includes(input.projectType)
  ) {
    errors.push({
      field: "projectType",
      code: "invalid_project_type",
      message: `Invalid project type '${input.projectType}'. Must be one of: ${ARCHITECTURE_PROJECT_TYPES.join(", ")}.`,
    });
  }

  if (!input.clientName || String(input.clientName).trim() === "") {
    errors.push({
      field: "clientName",
      code: "required",
      message: "Client name is required.",
    });
  }

  if (!input.clientEmail || String(input.clientEmail).trim() === "") {
    errors.push({
      field: "clientEmail",
      code: "required",
      message: "Client email is required.",
    });
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.clientEmail)) {
    errors.push({
      field: "clientEmail",
      code: "invalid_email",
      message: "Client email is not a valid email address.",
    });
  }

  if (!input.projectTitle || String(input.projectTitle).trim() === "") {
    errors.push({
      field: "projectTitle",
      code: "required",
      message: "Project title is required.",
    });
  }

  // ── Numeric bounds ─────────────────────────────────────────────────────────

  if (input.siteAreaM2 !== undefined && input.siteAreaM2 !== null) {
    const val = Number(input.siteAreaM2);
    if (isNaN(val) || val <= 0) {
      errors.push({
        field: "siteAreaM2",
        code: "invalid_area",
        message: "Site area must be a positive number (m²).",
      });
    } else if (val > 10_000_000) {
      errors.push({
        field: "siteAreaM2",
        code: "area_too_large",
        message: "Site area exceeds the maximum supported value (10,000,000 m²).",
      });
    }
  }

  if (input.builtAreaM2 !== undefined && input.builtAreaM2 !== null) {
    const val = Number(input.builtAreaM2);
    if (isNaN(val) || val <= 0) {
      errors.push({
        field: "builtAreaM2",
        code: "invalid_area",
        message: "Built area must be a positive number (m²).",
      });
    }

    // Built area cannot exceed site area
    if (
      input.siteAreaM2 !== undefined &&
      input.siteAreaM2 !== null &&
      !isNaN(val)
    ) {
      const siteVal = Number(input.siteAreaM2);
      if (!isNaN(siteVal) && val > siteVal) {
        errors.push({
          field: "builtAreaM2",
          code: "built_exceeds_site",
          message: `Built area (${val} m²) cannot exceed site area (${siteVal} m²).`,
        });
      }
    }
  }

  // ── Advisory warnings ─────────────────────────────────────────────────────

  if (!input.siteLocation || String(input.siteLocation).trim() === "") {
    warnings.push({
      field: "siteLocation",
      code: "missing_site_location",
      message:
        "Site location is not specified. Site context analysis will be limited.",
    });
  }

  if (!input.program || input.program.length === 0) {
    warnings.push({
      field: "program",
      code: "missing_program",
      message:
        "No program elements provided. A spatial program is important for concept development.",
    });
  }

  if (input.program && input.program.length > 50) {
    warnings.push({
      field: "program",
      code: "program_too_long",
      message: `Program has ${input.program.length} elements — consider grouping into categories for clarity.`,
    });
  }

  if (!input.climate) {
    warnings.push({
      field: "climate",
      code: "missing_climate",
      message:
        "Climate zone not specified. This affects material and landscape direction recommendations.",
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Site constraints validation
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteConstraintsInput {
  buildingHeightLimitM?: number | null;
  floorAreaRatio?: number | null;
  setbackFrontM?: number | null;
  setbackSideM?: number | null;
  setbackRearM?: number | null;
  plotCoveragePercent?: number | null;
  siteAreaM2?: number | null;
}

export function validateSiteConstraints(
  input: SiteConstraintsInput,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // ── Building height ────────────────────────────────────────────────────────
  if (input.buildingHeightLimitM !== undefined && input.buildingHeightLimitM !== null) {
    const h = Number(input.buildingHeightLimitM);
    if (isNaN(h) || h <= 0) {
      errors.push({
        field: "buildingHeightLimitM",
        code: "invalid_height",
        message: "Building height limit must be a positive number (m).",
      });
    } else if (h > 1000) {
      errors.push({
        field: "buildingHeightLimitM",
        code: "height_exceeds_max",
        message: "Building height limit exceeds 1000 m — this is beyond practical architectural scope.",
      });
    }
  }

  // ── Floor area ratio ───────────────────────────────────────────────────────
  if (input.floorAreaRatio !== undefined && input.floorAreaRatio !== null) {
    const far = Number(input.floorAreaRatio);
    if (isNaN(far) || far < 0) {
      errors.push({
        field: "floorAreaRatio",
        code: "invalid_far",
        message: "Floor area ratio must be zero or a positive number.",
      });
    } else if (far > 20) {
      warnings.push({
        field: "floorAreaRatio",
        code: "high_far",
        message: `Floor area ratio of ${far} is very high — verify this matches local regulation.`,
      });
    }
  }

  // ── Setbacks ──────────────────────────────────────────────────────────────
  const setbacks: Array<[keyof SiteConstraintsInput, string]> = [
    ["setbackFrontM", "Front setback"],
    ["setbackSideM", "Side setback"],
    ["setbackRearM", "Rear setback"],
  ];
  for (const [field, label] of setbacks) {
    const raw = input[field];
    if (raw !== undefined && raw !== null) {
      const val = Number(raw);
      if (isNaN(val) || val < 0) {
        errors.push({
          field,
          code: "invalid_setback",
          message: `${label} must be zero or a positive number (m).`,
        });
      } else if (val > 100) {
        warnings.push({
          field,
          code: "large_setback",
          message: `${label} of ${val} m is unusually large — verify with local regulation.`,
        });
      }
    }
  }

  // ── Plot coverage ─────────────────────────────────────────────────────────
  if (input.plotCoveragePercent !== undefined && input.plotCoveragePercent !== null) {
    const pc = Number(input.plotCoveragePercent);
    if (isNaN(pc) || pc < 0 || pc > 100) {
      errors.push({
        field: "plotCoveragePercent",
        code: "invalid_coverage",
        message: "Plot coverage must be between 0 and 100 percent.",
      });
    } else if (pc > 90) {
      warnings.push({
        field: "plotCoveragePercent",
        code: "high_coverage",
        message: `Plot coverage of ${pc}% leaves very little open space — landscape and drainage may be severely constrained.`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact type validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks whether an artifact type string is one of the registered types.
 */
export function isValidArtifactType(
  artifactType: string,
): artifactType is ArchitectureArtifactType {
  return (ARCHITECTURE_ARTIFACT_TYPES as readonly string[]).includes(artifactType);
}

/**
 * Honesty check — ensures artifact labels do not make claims that require
 * professional validation the system does not perform.
 *
 * Rule: labels must not contain any of the FORBIDDEN_ARTIFACT_LABELS strings
 * (case-insensitive substring match).
 */
export function checkArtifactHonesty(
  artifactType: string,
  artifactLabel: string,
): HonestyCheckResult {
  const labelLower = artifactLabel.toLowerCase();

  for (const forbidden of FORBIDDEN_ARTIFACT_LABELS) {
    if (labelLower.includes(forbidden.toLowerCase())) {
      return {
        honest: false,
        reason: `Artifact label "${artifactLabel}" contains "${forbidden}" which implies professional certification or engineering validation that this plugin does not provide. Use "preview" or "direction" language instead.`,
        forbiddenLabel: forbidden,
      };
    }
  }

  // Additional check: artifact_plan_preview and architecture_elevation_preview
  // must include "preview" somewhere in their label when generated by this plugin.
  const previewTypes: ArchitectureArtifactType[] = [
    "architecture_plan_preview",
    "architecture_elevation_preview",
  ];
  if (
    isValidArtifactType(artifactType) &&
    previewTypes.includes(artifactType as ArchitectureArtifactType) &&
    !labelLower.includes("preview") &&
    !labelLower.includes("draft") &&
    !labelLower.includes("concept") &&
    !labelLower.includes("direction")
  ) {
    return {
      honest: false,
      reason: `Artifact type '${artifactType}' must use preview/draft/concept/direction language in its label. Current label "${artifactLabel}" does not signal its non-certified nature.`,
      forbiddenLabel: null,
    };
  }

  return { honest: true, reason: null, forbiddenLabel: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow step validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a step string is a known workflow step.
 */
export function isValidWorkflowStep(
  step: string,
): step is ArchitectureWorkflowStep {
  return (ARCHITECTURE_WORKFLOW_STEPS as readonly string[]).includes(step);
}

/**
 * Returns the 0-based index of a workflow step, or -1 if not found.
 */
export function workflowStepIndex(step: ArchitectureWorkflowStep): number {
  return ARCHITECTURE_WORKFLOW_STEPS.indexOf(step);
}

/**
 * Returns the next workflow step, or null if at the last step.
 */
export function nextWorkflowStep(
  current: ArchitectureWorkflowStep,
): ArchitectureWorkflowStep | null {
  const idx = workflowStepIndex(current);
  if (idx < 0 || idx >= ARCHITECTURE_WORKFLOW_STEPS.length - 1) return null;
  return ARCHITECTURE_WORKFLOW_STEPS[idx + 1]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Honesty disclaimer (for client-facing output)
// ─────────────────────────────────────────────────────────────────────────────

export const ARCHITECTURE_PREVIEW_DISCLAIMER =
  "All outputs from this plugin are design previews and concept directions intended for early-stage communication only. They are NOT construction drawings, structural calculations, permit-ready drawings, or certified landscape plans. Engage a licensed architect, structural engineer, or landscape architect for professional deliverables.";

// ─────────────────────────────────────────────────────────────────────────────
// No BIM/GIS/CAD engine guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capability boundary declaration.
 * Any code attempting to call BIM/GIS/structural engine must check this first.
 * This plugin intentionally excludes those capabilities.
 */
export const PLUGIN_CAPABILITY_BOUNDARY = {
  hasBimEngine: false,
  hasGisEngine: false,
  hasCadEngine: false,
  hasStructuralCalculation: false,
  hasPermitDocumentGeneration: false,
  hasCertifiedLandscapePlanning: false,
} as const;

export type PluginCapabilityBoundary = typeof PLUGIN_CAPABILITY_BOUNDARY;
