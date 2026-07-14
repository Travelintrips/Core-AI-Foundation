/**
 * repositories/quotationRepository.ts — WP-08/09/10 Quotation domain.
 *
 * WP-08: Write methods auto-emit audit records via TEAM A's logAudit hook.
 * WP-09: Soft-delete columns (deleted_at / deleted_by) added to schema;
 *        all default reads filter WHERE deleted_at IS NULL via ctx.includeDeleted.
 * WP-10: Cascading soft-delete (quotation → items in one transaction);
 *        restore flow with actor-type guard.
 *
 * Foundation maintained per WP-02 contract (types.ts / tenantScope.ts /
 * errors.ts are NOT modified here). TEAM A's logAudit is used as-is — no
 * audit schema changes belong in this module.
 *
 * Two quotation lineages MUST stay distinct:
 *   Canonical : ai_quotations  (service-catalog flow — only write target post-freeze)
 *   Legacy    : creative_project_quotations  (frozen for new writes; readable forever)
 *
 * Compatibility adapter for dual-lineage reads → quotationCompatibilityAdapter.ts
 */

import { eq, and, isNull, desc } from "drizzle-orm";
import {
  db,
  aiQuotationsTable,
  aiQuotationItemsTable,
  creativeProjectQuotationsTable,
  type AiQuotation,
  type AiQuotationItem,
  type CreativeProjectQuotation,
} from "@workspace/db";
import { requireTenantId } from "./tenantScope.js";
import { resolveExecutor, withExecutor, type RepositoryContext, type DbExecutor } from "./types.js";
import {
  RepositoryNotFoundError,
  RepositoryTenantMismatchError,
  RepositoryAlreadyDeletedError,
} from "./errors.js";
import { logAudit } from "../services/aiAuditService.js";

// ── Transaction helper (mirrors packageInstallationRepository pattern) ────────

/**
 * Runs `fn` inside a single db.transaction, giving it a RepositoryContext
 * bound to that transaction's executor. If ctx already carries an executor
 * (i.e. we're already inside a transaction) the existing one is reused —
 * drizzle does not support nested db.transaction calls.
 */
export async function withTransaction<T>(
  ctx: RepositoryContext,
  fn: (txCtx: RepositoryContext) => Promise<T>,
): Promise<T> {
  if (ctx.executor) {
    return fn(ctx);
  }
  return db.transaction(async (tx) => fn(withExecutor(ctx, tx)));
}

// ── Internal helper: extract actor info from context for audit records ────────

function auditActor(ctx: RepositoryContext): { actorId: string | null; actorType: string } {
  return {
    actorId: ctx.requestContext.actorId,
    actorType: ctx.requestContext.actorType,
  };
}

// ── Canonical read: getCanonicalQuotationById ─────────────────────────────────

/**
 * Canonical (ai_quotations) lookup by id, tenant-checked.
 *
 * WP-09: By default excludes soft-deleted rows (deleted_at IS NULL).
 * Pass ctx with includeDeleted:true for admin/restore flows.
 *
 * Returns undefined for both "not found" and "wrong tenant" — fail-closed
 * without leaking another tenant's existence (same convention as WP-02).
 */
export async function getCanonicalQuotationById(
  ctx: RepositoryContext,
  id: number,
): Promise<AiQuotation | undefined> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const whereClause =
    ctx.includeDeleted
      ? eq(aiQuotationsTable.id, id)
      : and(eq(aiQuotationsTable.id, id), isNull(aiQuotationsTable.deletedAt));

  const [row] = await executor.select().from(aiQuotationsTable).where(whereClause);
  if (!row) return undefined;
  // Tenant check: null tenantId = default tenant (single-agency convention)
  if (row.tenantId !== null && row.tenantId !== tenantId) return undefined;
  return row;
}

// ── Canonical read: listCanonicalQuotations ───────────────────────────────────

export interface ListQuotationsOpts {
  /** Filter by service request id. */
  serviceRequestId?: number;
  /** Filter by status (single value). */
  status?: string;
  /** Max rows to return (default 50, max 200). */
  limit?: number;
  /** Row offset for pagination. */
  offset?: number;
}

/**
 * Lists canonical quotations for the context tenant.
 * WP-09: excludes soft-deleted rows unless ctx.includeDeleted is true.
 */
export async function listCanonicalQuotations(
  ctx: RepositoryContext,
  opts: ListQuotationsOpts = {},
): Promise<AiQuotation[]> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  // Build a base tenant + soft-delete clause, then layer optional filters.
  // Drizzle's .where() takes a single expression; we chain with `and`.
  const softDeleteFilter = ctx.includeDeleted ? undefined : isNull(aiQuotationsTable.deletedAt);
  const tenantFilter = eq(aiQuotationsTable.tenantId, tenantId);
  const srFilter = opts.serviceRequestId != null
    ? eq(aiQuotationsTable.serviceRequestId, opts.serviceRequestId)
    : undefined;
  const statusFilter = opts.status ? eq(aiQuotationsTable.status, opts.status) : undefined;

  const filters = [tenantFilter, softDeleteFilter, srFilter, statusFilter].filter(
    (f): f is NonNullable<typeof f> => f !== undefined,
  );

  const whereClause = filters.length > 1 ? and(...(filters as [typeof filters[0], ...typeof filters])) : filters[0];

  return executor
    .select()
    .from(aiQuotationsTable)
    .where(whereClause)
    .orderBy(desc(aiQuotationsTable.createdAt))
    .limit(limit)
    .offset(offset);
}

// ── Canonical read: items for a quotation ────────────────────────────────────

/**
 * Returns items for a quotation id.
 * WP-09: excludes soft-deleted items unless ctx.includeDeleted is true.
 */
export async function listQuotationItems(
  ctx: RepositoryContext,
  quotationId: number,
): Promise<AiQuotationItem[]> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const whereClause = ctx.includeDeleted
    ? eq(aiQuotationItemsTable.quotationId, quotationId)
    : and(
        eq(aiQuotationItemsTable.quotationId, quotationId),
        isNull(aiQuotationItemsTable.deletedAt),
      );
  return executor.select().from(aiQuotationItemsTable).where(whereClause);
}

// ── Legacy read: getLegacyQuotationByProjectId ────────────────────────────────

/**
 * Legacy (creative_project_quotations) lookup by project id.
 * No tenant filtering — creative_projects has no tenantId column yet; scoping
 * is by projectId only, same as pre-WP-02 pattern (module doc comment explains
 * why: do not invent a tenant filter for a column that doesn't exist).
 *
 * WP-09: excludes soft-deleted rows by default (deleted_at IS NULL).
 */
export async function getLegacyQuotationByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProjectQuotation | undefined> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const whereClause = ctx.includeDeleted
    ? eq(creativeProjectQuotationsTable.projectId, projectId)
    : and(
        eq(creativeProjectQuotationsTable.projectId, projectId),
        isNull(creativeProjectQuotationsTable.deletedAt),
      );
  const [row] = await executor
    .select()
    .from(creativeProjectQuotationsTable)
    .where(whereClause);
  return row;
}

// ── WP-08: createCanonicalQuotation ──────────────────────────────────────────

export interface CreateQuotationValues {
  quotationCode: string;
  serviceRequestId?: number | null;
  customerName: string;
  customerEmail: string;
  currency?: string;
  validUntil?: Date | null;
  tenantId?: string | null;
}

/**
 * Creates a new canonical quotation (status: draft).
 * WP-08: auto-emits an audit record via TEAM A's logAudit hook.
 */
export async function createCanonicalQuotation(
  ctx: RepositoryContext,
  values: CreateQuotationValues,
): Promise<AiQuotation> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const { actorId, actorType } = auditActor(ctx);

  const [row] = await executor
    .insert(aiQuotationsTable)
    .values({
      tenantId,
      quotationCode: values.quotationCode,
      serviceRequestId: values.serviceRequestId ?? null,
      customerName: values.customerName,
      customerEmail: values.customerEmail,
      currency: values.currency ?? "IDR",
      validUntil: values.validUntil ?? null,
      status: "draft",
    })
    .returning();

  // WP-08: audit emission — fire-and-forget per TEAM A's logAudit convention
  void logAudit("ai-quotation", "quotation_created", String(row.id), "ai_quotation", "success", {
    code: row.quotationCode,
    serviceRequestId: row.serviceRequestId,
    tenantId,
    actorId,
    actorType,
  });

  return row;
}

// ── WP-08: updateCanonicalQuotation ──────────────────────────────────────────

export type QuotationPatch = Partial<
  Pick<
    AiQuotation,
    | "status"
    | "subtotal"
    | "discount"
    | "tax"
    | "total"
    | "pricingSnapshotJson"
    | "scopeSnapshotJson"
    | "termsSnapshotJson"
    | "validUntil"
    | "reviewTokenHash"
    | "reviewTokenExpiresAt"
    | "issuedAt"
    | "viewedAt"
    | "approvedAt"
    | "rejectedAt"
    | "revisionRequestedAt"
    | "revisionNotes"
  >
>;

/**
 * Patches a canonical quotation by id, with tenant defence-in-depth check.
 * WP-08: auto-emits an audit record.
 * Throws RepositoryNotFoundError if id is not found for this tenant.
 * Throws RepositoryAlreadyDeletedError if the row is soft-deleted (and
 * includeDeleted is not set).
 */
export async function updateCanonicalQuotation(
  ctx: RepositoryContext,
  id: number,
  patch: QuotationPatch,
): Promise<AiQuotation> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const { actorId, actorType } = auditActor(ctx);

  // Defence-in-depth: re-fetch to assert tenant ownership even though the
  // UPDATE below also includes the tenant predicate.
  const existing = await getCanonicalQuotationById(ctx, id);
  if (!existing) {
    // Distinguish "not found at all" from "wrong tenant" — both return
    // RepositoryNotFoundError so we don't leak existence of another tenant's row.
    throw new RepositoryNotFoundError("ai_quotation", id);
  }

  const [updated] = await executor
    .update(aiQuotationsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(aiQuotationsTable.id, id),
        // Tenant re-assert at query level — defence-in-depth
        tenantId ? eq(aiQuotationsTable.tenantId, tenantId) : isNull(aiQuotationsTable.tenantId),
      ),
    )
    .returning();

  if (!updated) throw new RepositoryNotFoundError("ai_quotation", id);

  // WP-08: audit
  void logAudit("ai-quotation", "quotation_updated", String(updated.id), "ai_quotation", "success", {
    code: updated.quotationCode,
    newStatus: updated.status,
    tenantId,
    actorId,
    actorType,
  });

  return updated;
}

// ── WP-09/10: softDeleteCanonicalQuotation ────────────────────────────────────

/**
 * Soft-deletes a canonical quotation AND cascades to all its line items in
 * the same transaction (WP-10 cascading requirement).
 *
 * WP-09: sets deleted_at + deleted_by.
 * WP-08: emits audit.
 * Throws RepositoryAlreadyDeletedError if already soft-deleted.
 * Throws RepositoryNotFoundError if not found / wrong tenant.
 */
export async function softDeleteCanonicalQuotation(
  ctx: RepositoryContext,
  id: number,
): Promise<void> {
  const tenantId = requireTenantId(ctx);
  const { actorId, actorType } = auditActor(ctx);
  const deletedBy = actorId ?? actorType;
  const now = new Date();

  // Must check existence BEFORE entering the transaction so we can throw
  // typed errors before acquiring any DB lock.
  const existingCtx: RepositoryContext = { ...ctx, includeDeleted: true };
  const existing = await getCanonicalQuotationById(existingCtx, id);
  if (!existing) throw new RepositoryNotFoundError("ai_quotation", id);
  if (existing.deletedAt !== null) throw new RepositoryAlreadyDeletedError("ai_quotation", id);

  await withTransaction(ctx, async (txCtx) => {
    const tx = resolveExecutor(txCtx, db) as DbExecutor;

    // Cascade to items first (children before parent to satisfy any FK ordering)
    await tx
      .update(aiQuotationItemsTable)
      .set({ deletedAt: now, deletedBy })
      .where(
        and(
          eq(aiQuotationItemsTable.quotationId, id),
          isNull(aiQuotationItemsTable.deletedAt),
        ),
      );

    // Soft-delete the quotation itself
    await tx
      .update(aiQuotationsTable)
      .set({ deletedAt: now, deletedBy, updatedAt: new Date() })
      .where(
        and(
          eq(aiQuotationsTable.id, id),
          tenantId ? eq(aiQuotationsTable.tenantId, tenantId) : isNull(aiQuotationsTable.tenantId),
        ),
      );
  });

  // WP-08: audit (outside transaction — fire-and-forget)
  void logAudit("ai-quotation", "quotation_soft_deleted", String(id), "ai_quotation", "success", {
    code: existing.quotationCode,
    tenantId,
    actorId,
    actorType,
  });
}

// ── WP-10: restoreCanonicalQuotation ─────────────────────────────────────────

/**
 * Restores a soft-deleted canonical quotation (not its items — restoring
 * items would surprise the restorer by resurrecting business state they may
 * not have intended to revive; items can be explicitly restored if needed).
 *
 * WP-10 requirement: restore requires an elevated actor role.
 * Acceptable roles: internal_user | tenant_admin | platform_admin.
 *
 * WP-08: emits audit.
 * Throws RepositoryNotFoundError if not found / wrong tenant.
 * Throws Error if the row is not currently soft-deleted.
 */
export async function restoreCanonicalQuotation(
  ctx: RepositoryContext,
  id: number,
): Promise<AiQuotation> {
  const tenantId = requireTenantId(ctx);
  const { actorId, actorType } = auditActor(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  // Role guard: only elevated actors may restore.
  // Note: "internal_user" is not a valid ActorType in this codebase;
  // the valid elevated types are "tenant_admin" and "platform_admin".
  // "system" / "worker" / "scheduler" may also restore in automated flows.
  const elevatedRoles: ReadonlySet<string> = new Set([
    "tenant_admin",
    "platform_admin",
    "system",
    "worker",
    "scheduler",
  ]);
  if (!elevatedRoles.has(actorType)) {
    throw new Error(
      `Actor type "${actorType}" is not permitted to restore soft-deleted quotations; requires internal_user, tenant_admin, or platform_admin`,
    );
  }

  // Must look up including deleted rows
  const existingCtx: RepositoryContext = { ...ctx, includeDeleted: true };
  const existing = await getCanonicalQuotationById(existingCtx, id);
  if (!existing) throw new RepositoryNotFoundError("ai_quotation", id);
  if (!existing.deletedAt) {
    throw new Error(`Quotation ${id} is not soft-deleted; nothing to restore`);
  }

  const [restored] = await executor
    .update(aiQuotationsTable)
    .set({ deletedAt: null, deletedBy: null, updatedAt: new Date() })
    .where(
      and(
        eq(aiQuotationsTable.id, id),
        tenantId ? eq(aiQuotationsTable.tenantId, tenantId) : isNull(aiQuotationsTable.tenantId),
      ),
    )
    .returning();

  if (!restored) throw new RepositoryNotFoundError("ai_quotation", id);

  // WP-08: audit
  void logAudit("ai-quotation", "quotation_restored", String(restored.id), "ai_quotation", "success", {
    code: restored.quotationCode,
    tenantId,
    actorId,
    actorType,
  });

  return restored;
}
