/**
 * qcProfile.ts — Team 16: Presentation & Document Creative Services
 *
 * QC scoring profiles for each service type. Each profile defines:
 *   - The dimensions that contribute to the overall quality score
 *   - Minimum dimension thresholds that must be met for delivery
 *   - The minimum composite score required to pass QC (default: 80/100)
 *
 * QC is evaluated at the generation-report level — no new LLM call is made.
 * Scores reflect data completeness + section coverage, not subjective quality.
 */

import type { PresentationDocumentServiceType } from "./types.js";

// ── QC dimension ──────────────────────────────────────────────────────────────

export interface QcDimension {
  id:          string;
  label:       string;
  weight:      number;   // 0–1, must sum to 1 across all dimensions in a profile
  /** Minimum value (0–100) for this dimension to avoid a QC hard-fail. */
  minValue:    number;
}

export interface QcProfile {
  serviceType:        PresentationDocumentServiceType;
  passingScore:       number;   // 0–100 (composite)
  dimensions:         QcDimension[];
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export const QC_PROFILES: QcProfile[] = [
  {
    serviceType: "proposal",
    passingScore: 75,
    dimensions: [
      { id: "section_coverage",  label: "Section Coverage",        weight: 0.30, minValue: 60 },
      { id: "data_completeness", label: "Data Completeness",       weight: 0.35, minValue: 60 },
      { id: "anti_fabrication",  label: "Anti-Fabrication",        weight: 0.25, minValue: 100 },
      { id: "page_count",        label: "Page Count Within Limits", weight: 0.10, minValue: 60 },
    ],
  },
  {
    serviceType: "product_catalog",
    passingScore: 75,
    dimensions: [
      { id: "section_coverage",  label: "Section Coverage",        weight: 0.25, minValue: 60 },
      { id: "data_completeness", label: "Data Completeness",       weight: 0.40, minValue: 70 },
      { id: "anti_fabrication",  label: "Anti-Fabrication",        weight: 0.25, minValue: 100 },
      { id: "page_count",        label: "Page Count Within Limits", weight: 0.10, minValue: 60 },
    ],
  },
  {
    serviceType: "annual_report",
    passingScore: 80,
    dimensions: [
      { id: "section_coverage",  label: "Section Coverage",        weight: 0.30, minValue: 70 },
      { id: "data_completeness", label: "Data Completeness",       weight: 0.30, minValue: 70 },
      { id: "anti_fabrication",  label: "Anti-Fabrication",        weight: 0.30, minValue: 100 },
      { id: "page_count",        label: "Page Count Within Limits", weight: 0.10, minValue: 70 },
    ],
  },
  {
    serviceType: "whitepaper",
    passingScore: 80,
    dimensions: [
      { id: "section_coverage",  label: "Section Coverage",        weight: 0.30, minValue: 70 },
      { id: "data_completeness", label: "Data Completeness",       weight: 0.30, minValue: 60 },
      { id: "anti_fabrication",  label: "Anti-Fabrication",        weight: 0.30, minValue: 100 },
      { id: "page_count",        label: "Page Count Within Limits", weight: 0.10, minValue: 60 },
    ],
  },
  {
    serviceType: "case_study",
    passingScore: 75,
    dimensions: [
      { id: "section_coverage",  label: "Section Coverage",        weight: 0.30, minValue: 60 },
      { id: "data_completeness", label: "Data Completeness",       weight: 0.35, minValue: 60 },
      { id: "anti_fabrication",  label: "Anti-Fabrication",        weight: 0.25, minValue: 100 },
      { id: "page_count",        label: "Page Count Within Limits", weight: 0.10, minValue: 60 },
    ],
  },
  {
    serviceType: "ebook",
    passingScore: 75,
    dimensions: [
      { id: "section_coverage",  label: "Section Coverage",        weight: 0.30, minValue: 60 },
      { id: "data_completeness", label: "Data Completeness",       weight: 0.35, minValue: 60 },
      { id: "anti_fabrication",  label: "Anti-Fabrication",        weight: 0.25, minValue: 100 },
      { id: "page_count",        label: "Page Count Within Limits", weight: 0.10, minValue: 60 },
    ],
  },
];

// ── QC evaluation ─────────────────────────────────────────────────────────────

export interface QcDimensionResult {
  id:        string;
  label:     string;
  score:     number;   // 0–100
  weight:    number;
  minValue:  number;
  passed:    boolean;
}

export interface QcResult {
  serviceType:      PresentationDocumentServiceType;
  compositeScore:   number;    // weighted sum
  passed:           boolean;
  dimensions:       QcDimensionResult[];
  hardFailReason?:  string;    // set when any dimension is below minValue
}

/**
 * Evaluate a QC result from generation-report data.
 *
 * @param serviceType   The service being evaluated.
 * @param dimensionScores  Map of dimension ID → 0–100 score.
 */
export function evaluateQc(
  serviceType: PresentationDocumentServiceType,
  dimensionScores: Partial<Record<string, number>>,
): QcResult {
  const profile = QC_PROFILES.find((p) => p.serviceType === serviceType);
  if (!profile) {
    // No profile means no QC gating — pass by default
    return {
      serviceType,
      compositeScore: 100,
      passed: true,
      dimensions: [],
    };
  }

  const dimensionResults: QcDimensionResult[] = profile.dimensions.map((dim) => {
    const score = dimensionScores[dim.id] ?? 0;
    return {
      id:       dim.id,
      label:    dim.label,
      score,
      weight:   dim.weight,
      minValue: dim.minValue,
      passed:   score >= dim.minValue,
    };
  });

  const compositeScore = Math.round(
    dimensionResults.reduce((sum, d) => sum + d.score * d.weight, 0),
  );

  const hardFailDimension = dimensionResults.find((d) => !d.passed);
  const passed = compositeScore >= profile.passingScore && !hardFailDimension;

  return {
    serviceType,
    compositeScore,
    passed,
    dimensions: dimensionResults,
    hardFailReason: hardFailDimension
      ? `Dimension '${hardFailDimension.label}' scored ${hardFailDimension.score} < required ${hardFailDimension.minValue}`
      : undefined,
  };
}

/**
 * Compute a section_coverage score from generation report lists.
 * score = (included / total) * 100
 */
export function scoreSectionCoverage(included: string[], skipped: Array<{ id: string }>): number {
  const total = included.length + skipped.length;
  if (total === 0) return 0;
  return Math.round((included.length / total) * 100);
}

/**
 * Compute a data_completeness score from content fields.
 * score = (non-empty fields / total fields) * 100
 */
export function scoreDataCompleteness(content: Record<string, unknown>): number {
  const values = Object.values(content);
  if (values.length === 0) return 0;
  const nonEmpty = values.filter((v) => {
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
  return Math.round((nonEmpty.length / values.length) * 100);
}

/**
 * Compute a page_count score based on whether the page count lands within
 * [min, max] for the package tier. Full score if within range.
 */
export function scorePageCount(pageCount: number, min: number, max: number): number {
  if (pageCount >= min && pageCount <= max) return 100;
  if (pageCount < min) return Math.round((pageCount / min) * 80);  // partial if short
  return 90;  // slightly over max is okay, slight deduction
}
