/**
 * Generic work bridge cannot claim or mint Issue238 disposable QA authority.
 * A dedicated Owner-scoped issuance path (not implemented here) must establish
 * original work provenance and enforce the one-use signed QA permit.
 */
import { sql } from "drizzle-orm";

export const ISSUE238_QA_MARKER = "issue238QaPurpose";

export function isReservedIssue238GenericMetadata(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, ISSUE238_QA_MARKER);
}

// Every generic claim, including explicitly targeted UUIDs and stale reclaims,
// skips reserved QA work. Existing ordinary work remains unaffected.
export function genericClaimNotIssue238QaSql() {
  return sql`NOT (metadata_json ? ${ISSUE238_QA_MARKER}::text)`;
}
