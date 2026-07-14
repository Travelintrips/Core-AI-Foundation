/**
 * repositories/retentionPolicy.ts — WP-05 retention policy types and the
 * platform-scoped purge runner.
 *
 * Design rules:
 *   - Purge is DESTRUCTIVE and IRREVERSIBLE. It may only be called from a
 *     platform-scoped context (requirePlatformScope must pass) with an
 *     explicit PlatformOperation on the RepositoryContext.
 *   - The runner is generic: it accepts a domain-specific `hardDelete`
 *     callback that performs the actual DELETE and returns a row count. This
 *     keeps each repository's DELETE statement visible and reviewable in its
 *     own file — no table name is embedded here.
 *   - Every purge is audited via TEAM A's `logAudit` hook both before
 *     execution (intent) and after (result). logAudit never throws, so an
 *     audit write failure does not block the purge — but it does log to
 *     console for monitoring.
 *   - Retention window is measured in calendar days (milliseconds arithmetic,
 *     not PG interval) for platform-independence.
 */
import { requirePlatformScope } from "./tenantScope.js";
import { logAudit } from "../services/aiAuditService.js";
import type { RepositoryContext } from "./types.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  /** Short machine-readable key, e.g. "marketplace_installation". */
  readonly resourceType: string;
  /**
   * Minimum age (calendar days) a soft-deleted record must have before it
   * is eligible for hard deletion. Rows with deleted_at < NOW() - windowDays
   * are purged.
   */
  readonly windowDays: number;
  /** Human-readable rationale for audit trails and policy reviews. */
  readonly description: string;
}

export interface PurgeResult {
  readonly resourceType: string;
  readonly windowDays: number;
  readonly cutoffDate: Date;
  readonly purgedCount: number;
  readonly executedAt: Date;
}

// ── Canonical retention windows ────────────────────────────────────────────────

/**
 * Canonical retention windows per domain. Do not change these values
 * without a deliberate policy review — they affect compliance obligations.
 */
export const RETENTION_POLICIES: Readonly<Record<string, RetentionPolicy>> = {
  marketplace_installation: {
    resourceType: "marketplace_installation",
    windowDays: 90,
    description:
      "Installed packages are retained 90 days after soft-delete to support reinstall history and billing reconciliation.",
  },
  service_request: {
    resourceType: "service_request",
    windowDays: 365,
    description:
      "Service requests are retained 365 days after soft-delete for billing/audit compliance and dispute resolution.",
  },
  creative_project: {
    resourceType: "creative_project",
    windowDays: 365,
    description:
      "Creative projects are retained 365 days after soft-delete for client access history and deliverable retrieval.",
  },
};

// ── Purge runner ───────────────────────────────────────────────────────────────

/**
 * Executes a purge for a single retention policy by delegating the actual
 * DELETE to a domain-provided `hardDelete` callback.
 *
 * @param ctx         Must be platform-scoped (scheduler sweep, admin purge)
 *                    with an explicit PlatformOperation declared.
 * @param policy      Which domain to purge and what the retention window is.
 * @param hardDelete  Callback that runs the domain-specific DELETE query and
 *                    returns the count of rows removed. Receives the cutoff
 *                    Date — only rows with deleted_at < cutoffDate are in scope.
 */
export async function runPurge(
  ctx: RepositoryContext,
  policy: RetentionPolicy,
  hardDelete: (cutoffDate: Date) => Promise<number>,
): Promise<PurgeResult> {
  const grant = requirePlatformScope(ctx);
  const cutoffDate = new Date(Date.now() - policy.windowDays * 86_400_000);
  const executedAt = new Date();

  // Pre-purge audit: record intent before any destructive work
  await logAudit("retentionPolicy", "purge_start", policy.resourceType, "retention_purge", "success", {
    platformOperation: grant.name,
    reason: grant.reason,
    windowDays: policy.windowDays,
    cutoffDate: cutoffDate.toISOString(),
  });

  let purgedCount = 0;
  try {
    purgedCount = await hardDelete(cutoffDate);
  } catch (err) {
    await logAudit("retentionPolicy", "purge_failed", policy.resourceType, "retention_purge", "failure", {
      platformOperation: grant.name,
      error: String(err),
    });
    throw err;
  }

  // Post-purge audit: record result
  await logAudit("retentionPolicy", "purge_complete", policy.resourceType, "retention_purge", "success", {
    platformOperation: grant.name,
    purgedCount,
    cutoffDate: cutoffDate.toISOString(),
  });

  return { resourceType: policy.resourceType, windowDays: policy.windowDays, cutoffDate, purgedCount, executedAt };
}
