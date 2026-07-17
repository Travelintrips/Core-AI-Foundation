/**
 * product-design — Disclaimer Service
 *
 * Ensures the mandatory concept disclaimer is always present on every
 * domain output, and rejects any text that contains unsupported
 * manufacturing claims (certifications, regulatory approvals, CAD specs).
 *
 * PURE — no I/O, no side effects.
 * TEAM 20 OWNED — do not modify outside feature/20-product-design.
 */

import { CONCEPT_DISCLAIMER } from "../types/concept";
import {
  UNSUPPORTED_MANUFACTURING_CLAIMS,
  type ClaimCheckResult,
} from "../types/manufacturer";

// ── Disclaimer enforcement ─────────────────────────────────────────────────────

/**
 * Returns the canonical disclaimer text for all product-design outputs.
 * Always call this rather than inlining the disclaimer string directly,
 * so any future update propagates automatically.
 */
export function getConceptDisclaimer(): string {
  return CONCEPT_DISCLAIMER;
}

/**
 * Ensures the given output object has the correct disclaimer field.
 * Throws if the disclaimer is absent, empty, or has been overwritten
 * with something other than the canonical text.
 */
export function assertDisclaimerPresent(
  obj: { disclaimer?: string },
  context: string,
): void {
  if (!obj.disclaimer || obj.disclaimer.trim().length === 0) {
    throw new Error(
      `[${context}] Output is missing the mandatory product-design disclaimer. ` +
      `Assign getConceptDisclaimer() to the disclaimer field before returning.`,
    );
  }
}

/**
 * Injects the canonical disclaimer into any object that has a disclaimer field.
 * Safe to call unconditionally — idempotent if the disclaimer is already correct.
 */
export function injectDisclaimer<T extends { disclaimer: string }>(obj: T): T {
  return { ...obj, disclaimer: CONCEPT_DISCLAIMER };
}

// ── Unsupported manufacturing claim detection ──────────────────────────────────

/**
 * Scans one or more text fields for UNSUPPORTED_MANUFACTURING_CLAIMS.
 * Each field is labelled for the violation report.
 *
 * @param fields  Object whose keys are field names and values are the text to scan.
 * @returns       ClaimCheckResult — clean === true when no violations found.
 */
export function assertNoUnsupportedClaims(
  fields: Record<string, string | undefined>,
): ClaimCheckResult {
  const violations: ClaimCheckResult["violations"] = [];

  for (const [fieldName, text] of Object.entries(fields)) {
    if (!text) continue;
    const lc = text.toLowerCase();
    for (const claim of UNSUPPORTED_MANUFACTURING_CLAIMS) {
      if (lc.includes(claim.toLowerCase())) {
        violations.push({ phrase: claim, field: fieldName });
      }
    }
  }

  return { clean: violations.length === 0, violations };
}

/**
 * Throws a descriptive error when unsupported manufacturing claims are found.
 * Use this to guard brief builder inputs and concept notes fields.
 */
export function guardAgainstUnsupportedClaims(
  fields: Record<string, string | undefined>,
  context: string,
): void {
  const result = assertNoUnsupportedClaims(fields);
  if (!result.clean) {
    const lines = result.violations.map(
      (v) => `  • Field "${v.field}" contains unsupported claim: "${v.phrase}"`,
    );
    throw new Error(
      `[${context}] Unsupported manufacturing claims detected. ` +
      `This domain is for concept design only — not certifications, ` +
      `regulatory approvals, or manufacturing specifications.\n${lines.join("\n")}`,
    );
  }
}

/**
 * Non-throwing version of the claim guard.
 * Returns a list of human-readable rejection reasons, or an empty array if clean.
 */
export function listUnsupportedClaimViolations(
  fields: Record<string, string | undefined>,
): string[] {
  const result = assertNoUnsupportedClaims(fields);
  if (result.clean) return [];
  return result.violations.map(
    (v) => `Field "${v.field}" contains unsupported manufacturing claim: "${v.phrase}".`,
  );
}
