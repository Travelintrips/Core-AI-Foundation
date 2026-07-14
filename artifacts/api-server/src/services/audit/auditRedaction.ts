/**
 * services/audit/auditRedaction.ts — WP-03 Canonical Audit Log redaction.
 *
 * Repository writes may pass full before/after row snapshots into the audit
 * hook (see repositories/auditHook.ts). Some columns (API keys, tokens,
 * prompts, hashed secrets) must never land in `ai_audit_logs.details`, since
 * that table is read by an admin UI (routes/audit.ts) with a much broader
 * viewer base than the row's own access-control boundary. This module is the
 * single point where that redaction happens, so every audit emission path
 * shares one denylist instead of each call site re-implementing it.
 */

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|api[_-]?key|credential|authorization|prompt|dashboardtoken|reviewtoken|hash)/i;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 4;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Deep-clones `value`, replacing any value whose key matches the sensitive
 * pattern with a fixed redaction marker. Bounded recursion depth protects
 * against accidentally serializing a huge or cyclic object into an audit row.
 */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeForAudit(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Best-effort shallow diff between a before/after row snapshot: only keys
 * present on `after` whose (sanitized, JSON-stable) value changed are
 * included, plus any key removed entirely. Never throws — an audit diff
 * failure must not fail the underlying write.
 */
export function computeAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  try {
    if (!before && !after) return null;
    // Diff the RAW values first (so a change to a sensitive field is still
    // detected as a change), then redact only the changed keys before they
    // leave this function — a secret's value never appears in the output,
    // but the fact that it changed still does.
    const b = before ?? {};
    const a = after ?? {};
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const key of keys) {
      const bv = b[key];
      const av = a[key];
      if (JSON.stringify(bv) !== JSON.stringify(av)) {
        changedBefore[key] = bv;
        changedAfter[key] = av;
      }
    }
    if (Object.keys(changedAfter).length === 0 && Object.keys(changedBefore).length === 0) return null;
    return {
      before: sanitizeForAudit(changedBefore) as Record<string, unknown>,
      after: sanitizeForAudit(changedAfter) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
