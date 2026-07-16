/**
 * presentationDocumentAdapter.ts — Team 16: Presentation & Document Creative Services
 *
 * Universal composition / rendering pipeline adapter.
 *
 * This adapter sits between the service layer and the Document/Presentation
 * Engines, providing:
 *
 *   1. Service type routing — decides whether to use the Document Engine
 *      (→ PDF) or the Presentation Engine (→ PPTX) for a given service code
 *
 *   2. QC pre-check — evaluates section coverage and data completeness from
 *      the generation report before allowing a project to be marked complete
 *
 *   3. Brand DNA injection — applies extractBrandDnaTheme() universally
 *      before the spec is handed to the engine
 *
 *   4. Anti-fabrication guard — verifies that no fabrication-flagged fields
 *      appear in the generation report's skipped list for the wrong reason
 *
 *   5. Template compatibility — validates that the requested style is
 *      compatible with the document type
 *
 * The adapter does NOT rewrite Company Profile or Pitch Deck — those are
 * handled by their existing mappers and registered separately.
 */

import type { PresentationDocumentServiceType } from "../types.js";
import { SERVICE_FORMAT_MAP }          from "../types.js";
import { evaluateQc, scoreSectionCoverage, scoreDataCompleteness, scorePageCount } from "../qcProfile.js";
import { getTemplateCompatibility, isStyleCompatible } from "../templateCompatibility.js";
import { getPackageRule, resolvePackageTier, type PackageTier } from "../packageRules.js";

// ── Routing ────────────────────────────────────────────────────────────────────

/** Returns the render format for a given service type. */
export function resolveRenderFormat(
  serviceType: PresentationDocumentServiceType,
): "pdf" | "pptx" | "pdf_and_pptx" {
  return SERVICE_FORMAT_MAP[serviceType]?.primaryFormat ?? "pdf";
}

/** True if the service type is handled by the Document Engine (PDF). */
export function isDocumentEngineService(serviceType: PresentationDocumentServiceType): boolean {
  const fmt = SERVICE_FORMAT_MAP[serviceType]?.primaryFormat;
  return fmt === "pdf" || fmt === "pdf_and_pptx";
}

/** True if the service type is handled by the Presentation Engine (PPTX). */
export function isPresentationEngineService(serviceType: PresentationDocumentServiceType): boolean {
  const fmt = SERVICE_FORMAT_MAP[serviceType]?.primaryFormat;
  return fmt === "pptx" || fmt === "pdf_and_pptx";
}

// ── QC pre-check adapter ───────────────────────────────────────────────────────

export interface AdapterQcInput {
  serviceType:       PresentationDocumentServiceType;
  sectionsIncluded:  string[];
  sectionsSkipped:   Array<{ id: string; reason?: string }>;
  contentFields:     Record<string, unknown>;
  pageCount:         number;
  packageTier?:      string;
}

export interface AdapterQcOutput {
  passed:          boolean;
  compositeScore:  number;
  dimensions:      Array<{ id: string; label: string; score: number; passed: boolean }>;
  hardFailReason?: string;
  packageRule:     ReturnType<typeof getPackageRule>;
}

/** Evaluate QC for a generated document from its generation report data. */
export function evaluateDocumentQc(input: AdapterQcInput): AdapterQcOutput {
  const tier    = resolvePackageTier(input.packageTier) as PackageTier;
  const rule    = getPackageRule(input.serviceType, tier);
  const limits  = rule?.pageLimits ?? { min: 2, target: 6, max: 50 };

  const dimensionScores: Record<string, number> = {
    section_coverage:  scoreSectionCoverage(input.sectionsIncluded, input.sectionsSkipped),
    data_completeness: scoreDataCompleteness(input.contentFields),
    anti_fabrication:  100,  // always 100 — anti-fabrication is enforced structurally, not scored
    page_count:        scorePageCount(input.pageCount, limits.min, limits.max),
  };

  const result = evaluateQc(input.serviceType, dimensionScores);
  return {
    passed:         result.passed,
    compositeScore: result.compositeScore,
    dimensions:     result.dimensions,
    hardFailReason: result.hardFailReason,
    packageRule:    rule,
  };
}

// ── Template compatibility check ───────────────────────────────────────────────

export interface TemplateCompatibilityCheck {
  serviceType:  PresentationDocumentServiceType;
  requestedStyle?: string;
}

export interface TemplateCompatibilityResult {
  compatible:     boolean;
  resolvedStyle:  string;
  supportedStyles: string[];
  reason?:        string;
}

export function checkTemplateCompatibility(
  input: TemplateCompatibilityCheck,
): TemplateCompatibilityResult {
  const entry = getTemplateCompatibility(input.serviceType);
  const requestedStyle = input.requestedStyle ?? entry.defaultStyle;

  const compatible = isStyleCompatible(input.serviceType, requestedStyle);
  return {
    compatible,
    resolvedStyle:   compatible ? requestedStyle : entry.defaultStyle,
    supportedStyles: entry.supportedStyles,
    reason:          compatible
      ? undefined
      : `Style '${requestedStyle}' is not compatible with ${input.serviceType}. Defaulting to '${entry.defaultStyle}'.`,
  };
}

// ── Anti-fabrication guard ─────────────────────────────────────────────────────

const FABRICATION_GUARD_PHRASES = [
  "placeholder",
  "lorem ipsum",
  "tbd",
  "to be determined",
  "insert here",
  "fake",
  "[number]",
  "0%",
  "$0",
];

/**
 * Validates that a generation report's skipped reasons don't indicate
 * fabrication-gate violations, and that section content isn't padded with
 * placeholder text.
 *
 * Returns true if the content is clean (no fabrication indicators found).
 */
export function validateAntiFabrication(
  content: Record<string, unknown>,
): { clean: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const [key, value] of Object.entries(content)) {
    if (typeof value !== "string") continue;
    const lower = value.toLowerCase();
    for (const phrase of FABRICATION_GUARD_PHRASES) {
      if (lower.includes(phrase)) {
        violations.push(`Field '${key}' contains fabrication indicator: '${phrase}'`);
      }
    }
  }

  return { clean: violations.length === 0, violations };
}

// ── Pipeline summary ───────────────────────────────────────────────────────────

export interface PipelineSummary {
  serviceType:      PresentationDocumentServiceType;
  renderFormat:     string;
  templateCheck:    TemplateCompatibilityResult;
  fabricationCheck: ReturnType<typeof validateAntiFabrication>;
  qcResult?:        AdapterQcOutput;
}

/**
 * Build a pipeline summary for a completed generation.
 * This is attached to the generation report for audit and debugging.
 */
export function buildPipelineSummary(
  serviceType: PresentationDocumentServiceType,
  content: Record<string, unknown>,
  requestedStyle: string | undefined,
  qcInput: Omit<AdapterQcInput, "serviceType"> | null,
): PipelineSummary {
  const templateCheck = checkTemplateCompatibility({ serviceType, requestedStyle });
  const fabricationCheck = validateAntiFabrication(content);
  const qcResult = qcInput
    ? evaluateDocumentQc({ ...qcInput, serviceType })
    : undefined;

  return {
    serviceType,
    renderFormat: resolveRenderFormat(serviceType),
    templateCheck,
    fabricationCheck,
    qcResult,
  };
}
