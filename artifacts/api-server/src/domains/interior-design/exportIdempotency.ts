/**
 * Canonical request identity for Interior Design exports.
 *
 * The idempotency key identifies one request within a tenant/project/source
 * version scope. Format and selected sections are part of that request's
 * immutable signature, so reusing a key for a different request is a conflict
 * rather than a second package.
 */

export const CANONICAL_EXPORT_SECTIONS = [
  "specification",
  "materials",
  "furniture",
  "moodboard",
] as const;

export function canonicalizeExportSections(sections: readonly string[]): string[] {
  const requested = new Set(sections);
  return CANONICAL_EXPORT_SECTIONS.filter((section) => requested.has(section));
}

export function isSameExportRequest(
  existing: { format: string; includedSections: unknown },
  requested: { format: string; includedSections: readonly string[] },
): boolean {
  const existingSections = Array.isArray(existing.includedSections)
    ? existing.includedSections.filter((section): section is string => typeof section === "string")
    : [];

  return existing.format === requested.format
    && JSON.stringify(canonicalizeExportSections(existingSections))
      === JSON.stringify(canonicalizeExportSections(requested.includedSections));
}