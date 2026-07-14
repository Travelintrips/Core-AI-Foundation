/**
 * companyProfileQcService.ts — Company Profile Full Sprint, Workstream 2 (P1.3)
 *
 * Post-generation Quality Control scoring for Company Profile documents.
 *
 * Deterministic, pure-function scoring — no LLM calls, no DB access.
 * Input: the generationReport stored in creative_ai_assets.metadata.
 * Output: qcScore (0–100), per-dimension breakdown, pass/fail, warnings.
 *
 * Dimensions (equal weights):
 *   1. sectionCoverage    — what fraction of expected core sections are present
 *   2. contactCompleteness — how complete the contact information is
 *   3. contentDepth        — bonus sections present (milestones, team, certs…)
 *   4. pageCountMet        — whether actual page count meets the package target
 *
 * QC gate: qcScore >= 60 → passed.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompanyProfileQcResult {
  qcScore: number;       // 0–100 (weighted average of dimensions)
  passed: boolean;       // qcScore >= QC_PASS_THRESHOLD
  dimensions: {
    sectionCoverage: number;       // 0–100 — core sections present / expected
    contactCompleteness: number;   // 0–100 — contact fields present
    contentDepth: number;          // 0–100 — bonus sections
    pageCountMet: boolean;         // actual pages >= target
  };
  sectionsPresent: string[];
  sectionsMissing: string[];
  warnings: string[];
}

/** Minimum score to pass QC (same threshold as brief readiness). */
export const QC_PASS_THRESHOLD = 60;

/**
 * Core sections that every Company Profile document MUST include.
 * These drive the sectionCoverage dimension.
 */
export const REQUIRED_SECTIONS = [
  "about",
  "vision-mission",
  "services",
  "contact",
] as const;

/**
 * Bonus sections that improve the contentDepth score.
 * Presence/absence affects score but doesn't fail QC on its own.
 */
export const BONUS_SECTIONS = [
  "core-values",
  "competitive-advantages",
  "industries",
  "operational",
  "milestones",
  "team",
  "certifications",
  "key-people",
  "org-structure",
  "clients-partners",
  "quality-assurance",
  "sustainability",
] as const;

/** Contact fields expected in the manifest/report. */
const CONTACT_FIELDS = ["email", "phone", "address", "website"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(present: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((present / total) * 100);
}

function extractSectionsIncluded(generationReport: Record<string, unknown>): string[] {
  const raw = generationReport["sectionsIncluded"];
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function extractContact(generationReport: Record<string, unknown>): Record<string, string> {
  // The report may store a flat contactInfo map (from the spec builder)
  const raw = generationReport["contactInfo"];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, string>;
  }
  // Fall back: detect contact info from sectionsIncluded — if "contact" is present
  // we can't verify individual fields, so return a partial object
  const sections = extractSectionsIncluded(generationReport);
  if (sections.includes("contact")) {
    return { _present: "true" };
  }
  return {};
}

// ── Main scoring function ─────────────────────────────────────────────────────

/**
 * Score a generated Company Profile document.
 *
 * @param generationReport  The MappingGenerationReport stored in asset metadata
 *                          (metadata.generationReport from creative_ai_assets).
 * @param pageCount         Actual PDF page count (from asset metadata).
 * @param pageTarget        Minimum page count expected for this package tier.
 */
export function scoreCompanyProfileDocument(
  generationReport: Record<string, unknown>,
  pageCount: number,
  pageTarget: number,
): CompanyProfileQcResult {
  const warnings: string[] = [];
  const sectionsPresent = extractSectionsIncluded(generationReport);
  const presentSet = new Set(sectionsPresent);

  // ── 1. Section coverage ──────────────────────────────────────────────────────
  const requiredPresent = REQUIRED_SECTIONS.filter((s) => presentSet.has(s));
  const sectionsMissing = (REQUIRED_SECTIONS as readonly string[]).filter((s) => !presentSet.has(s));
  const sectionCoverage = pct(requiredPresent.length, REQUIRED_SECTIONS.length);

  if (sectionsMissing.length > 0) {
    warnings.push(`Missing required sections: ${sectionsMissing.join(", ")}`);
  }

  // ── 2. Contact completeness ──────────────────────────────────────────────────
  const contactInfo = extractContact(generationReport);
  const hasContactSection = presentSet.has("contact");

  let contactCompleteness: number;
  if (Object.keys(contactInfo).length === 0 || !hasContactSection) {
    contactCompleteness = 0;
    warnings.push("Contact section is absent — no contact information in document");
  } else if ("_present" in contactInfo) {
    // Can only confirm the section exists, not individual fields
    contactCompleteness = 50;
  } else {
    const presentContactFields = CONTACT_FIELDS.filter(
      (f) => typeof contactInfo[f] === "string" && contactInfo[f].trim().length > 0,
    );
    contactCompleteness = pct(presentContactFields.length, CONTACT_FIELDS.length);
    if (presentContactFields.length < 2) {
      warnings.push("Contact section has fewer than 2 contact details");
    }
  }

  // ── 3. Content depth (bonus sections) ───────────────────────────────────────
  const bonusPresent = (BONUS_SECTIONS as readonly string[]).filter((s) => presentSet.has(s));
  // Score: 0 bonus = 0, full bonus = 100 (capped)
  const contentDepth = pct(bonusPresent.length, BONUS_SECTIONS.length);

  // ── 4. Page count met ───────────────────────────────────────────────────────
  const pageCountMet = pageCount >= pageTarget;
  if (!pageCountMet) {
    warnings.push(`Page count ${pageCount} is below package target of ${pageTarget}`);
  }

  // ── 5. Package level vs cpPageTarget mismatch ────────────────────────────────
  const reportedPageTarget = generationReport["pageTarget"];
  if (typeof reportedPageTarget === "number" && pageCount < reportedPageTarget) {
    if (!warnings.some((w) => w.startsWith("Page count"))) {
      warnings.push(`Page count ${pageCount} is below reported target of ${reportedPageTarget}`);
    }
  }

  // ── Compute overall score ────────────────────────────────────────────────────
  // Weights: sectionCoverage 40%, contactCompleteness 30%, contentDepth 20%,
  // pageCountMet 10% (binary: 100 or 0)
  const pageScore = pageCountMet ? 100 : 0;
  const qcScore = Math.round(
    sectionCoverage    * 0.40 +
    contactCompleteness * 0.30 +
    contentDepth       * 0.20 +
    pageScore          * 0.10,
  );

  return {
    qcScore,
    passed: qcScore >= QC_PASS_THRESHOLD,
    dimensions: {
      sectionCoverage,
      contactCompleteness,
      contentDepth,
      pageCountMet,
    },
    sectionsPresent,
    sectionsMissing,
    warnings,
  };
}

/**
 * Score a Company Profile document from its asset metadata blob.
 * Convenience wrapper for the catalog route.
 */
export function scoreFromAssetMetadata(
  metadata: Record<string, unknown>,
): CompanyProfileQcResult | null {
  const generationReport = metadata["generationReport"];
  if (!generationReport || typeof generationReport !== "object" || Array.isArray(generationReport)) {
    return null;
  }

  const pageCount = typeof metadata["pageCount"] === "number" ? metadata["pageCount"] : 0;
  const reportObj = generationReport as Record<string, unknown>;
  const pageTarget = typeof reportObj["pageTarget"] === "number" ? reportObj["pageTarget"] : 5;

  return scoreCompanyProfileDocument(reportObj, pageCount, pageTarget);
}
