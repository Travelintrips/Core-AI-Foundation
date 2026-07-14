/**
 * repositories/auditHook.ts — WP-03 Canonical Audit Log repository hook
 * (WP-08's "pilot domain auto-emission" requirement).
 *
 * This is intentionally a NEW module, not an addition to repositories/types.ts
 * or tenantScope.ts (both foundation files owned by WP-02 and out of scope
 * here). A domain repository calls `emitRepositoryAuditRecord` from inside
 * its own write methods (insert/update/delete) so every mutation produces
 * exactly one audit row, with tenantId/actorId/actorType derived from the
 * RepositoryContext's RequestContext — no manual per-call-site logAudit
 * bookkeeping required.
 *
 * Design notes:
 *   - Read-only queries never call this — only functions that mutate rows.
 *   - `ctx.auditMetadata` (the passthrough bag documented in types.ts) is
 *     merged into `details.meta` verbatim; it is caller-controlled so callers
 *     must not put secrets there (same rule as everywhere else `auditMetadata`
 *     is used).
 *   - Before/after row snapshots are diffed and redacted via
 *     services/audit/auditRedaction.ts before ever reaching `details` — a
 *     repository does not need to sanitize its own row shape.
 *   - Like logAudit, this never throws: a failed audit emission must not
 *     roll back or fail the write it is describing. Callers should invoke
 *     this AFTER a successful mutation (post-commit / post-return), not
 *     inside the same transaction as a compensating action.
 */
import { logAudit } from "../services/aiAuditService.js";
import { deriveAuditContext } from "../services/audit/auditTypes.js";
import { computeAuditDiff } from "../services/audit/auditRedaction.js";
import type { RepositoryContext } from "./types.js";

export type RepositoryAuditOperation = "create" | "update" | "delete";

export interface RepositoryAuditParams {
  /** Short machine-readable module/domain name, e.g. "marketplace". */
  readonly module: string;
  readonly operation: RepositoryAuditOperation;
  /** e.g. "package_installed", "package_upgraded" — kept human-scannable, not just the raw operation. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | number;
  readonly before?: Record<string, unknown> | null;
  readonly after?: Record<string, unknown> | null;
}

/**
 * Emits exactly one audit row for a repository mutation. Safe to call
 * unconditionally from every create/update/delete method on a migrated
 * domain repository — it never throws and never blocks the caller.
 */
export async function emitRepositoryAuditRecord(ctx: RepositoryContext, params: RepositoryAuditParams): Promise<void> {
  try {
    const auditContext = deriveAuditContext(ctx.requestContext);
    const diff = computeAuditDiff(params.before ?? undefined, params.after ?? undefined);
    const details: Record<string, unknown> = {
      operation: params.operation,
      requestId: ctx.requestContext.requestId,
      ...(diff ? { diff } : {}),
      ...(ctx.auditMetadata ? { meta: ctx.auditMetadata } : {}),
    };

    await logAudit(
      params.module,
      params.action,
      String(params.resourceId),
      params.resourceType,
      "success",
      details,
      auditContext,
    );
  } catch (err) {
    // logAudit already swallows its own errors; this catch only guards
    // against a bug in deriveAuditContext/computeAuditDiff themselves.
    console.error("[auditHook] Failed to emit repository audit record:", err);
  }
}
