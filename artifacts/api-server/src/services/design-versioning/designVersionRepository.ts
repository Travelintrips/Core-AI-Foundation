/**
 * services/design-versioning/designVersionRepository.ts — Team 09
 *
 * Database access layer for ai_entity_versions.
 *
 * Rules:
 *  - Every query is explicitly tenant-scoped via requireTenantId().
 *  - Soft-deleted rows are excluded from all reads unless includeDeleted=true.
 *  - No raw tenant values from client requests — callers must pass a
 *    RepositoryContext with a resolved tenantId.
 *  - Approved versions are immutable — service layer enforces this;
 *    the repository only provides the primitives.
 */
import { eq, and, desc, sql as rawSql, isNull } from "drizzle-orm";
import { db, aiEntityVersionsTable, type AiEntityVersion } from "@workspace/db";
import { requireTenantId } from "../../repositories/tenantScope.js";
import { softDeleteGuard } from "../../repositories/softDelete.js";
import type { RepositoryContext } from "../../repositories/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateVersionRecord {
  entityType: string;
  entityId: string;
  versionNumber: number;
  versionLabel?: string | null;
  idempotencyKey?: string | null;
  contentHash: string;
  contentSnapshot: unknown;
  parentVersionId?: number | null;
  reason?: string | null;
  revisionReason?: string | null;
  actorId?: string | null;
  actorType: string;
  aiJobId?: string | null;
  aiModel?: string | null;
  reviewId?: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function activeGuard(ctx: RepositoryContext) {
  return softDeleteGuard(aiEntityVersionsTable.deletedAt, ctx);
}

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * List all active versions for an entity, newest first.
 */
export async function findVersionsByEntity(
  entityType: string,
  entityId: string,
  ctx: RepositoryContext,
): Promise<AiEntityVersion[]> {
  const tenantId = requireTenantId(ctx);
  return db
    .select()
    .from(aiEntityVersionsTable)
    .where(
      and(
        eq(aiEntityVersionsTable.entityType, entityType),
        eq(aiEntityVersionsTable.entityId, entityId),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        activeGuard(ctx),
      ),
    )
    .orderBy(desc(aiEntityVersionsTable.versionNumber));
}

/**
 * Get a single version by id — tenant-scoped to prevent IDOR.
 */
export async function findVersionById(
  id: number,
  ctx: RepositoryContext,
): Promise<AiEntityVersion | null> {
  const tenantId = requireTenantId(ctx);
  const [row] = await db
    .select()
    .from(aiEntityVersionsTable)
    .where(
      and(
        eq(aiEntityVersionsTable.id, id),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        activeGuard(ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Find a version by idempotency key — for deduplication on create.
 */
export async function findByIdempotencyKey(
  entityType: string,
  entityId: string,
  tenantId: string,
  idempotencyKey: string,
): Promise<AiEntityVersion | null> {
  const [row] = await db
    .select()
    .from(aiEntityVersionsTable)
    .where(
      and(
        eq(aiEntityVersionsTable.entityType, entityType),
        eq(aiEntityVersionsTable.entityId, entityId),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        eq(aiEntityVersionsTable.idempotencyKey, idempotencyKey),
        isNull(aiEntityVersionsTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Get the current (promoted) version for an entity.
 */
export async function findCurrentVersion(
  entityType: string,
  entityId: string,
  ctx: RepositoryContext,
): Promise<AiEntityVersion | null> {
  const tenantId = requireTenantId(ctx);
  const [row] = await db
    .select()
    .from(aiEntityVersionsTable)
    .where(
      and(
        eq(aiEntityVersionsTable.entityType, entityType),
        eq(aiEntityVersionsTable.entityId, entityId),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        eq(aiEntityVersionsTable.isCurrent, true),
        activeGuard(ctx),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Get the approved version for an entity (there should be at most one).
 */
export async function findApprovedVersion(
  entityType: string,
  entityId: string,
  ctx: RepositoryContext,
): Promise<AiEntityVersion | null> {
  const tenantId = requireTenantId(ctx);
  const [row] = await db
    .select()
    .from(aiEntityVersionsTable)
    .where(
      and(
        eq(aiEntityVersionsTable.entityType, entityType),
        eq(aiEntityVersionsTable.entityId, entityId),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        eq(aiEntityVersionsTable.isApproved, true),
        activeGuard(ctx),
      ),
    )
    .orderBy(desc(aiEntityVersionsTable.versionNumber))
    .limit(1);
  return row ?? null;
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Insert a new version record. Version number must already be computed by
 * the service (inside a transaction with advisory lock).
 */
export async function insertVersionRecord(
  tenantId: string,
  record: CreateVersionRecord,
  tx?: typeof db,
): Promise<AiEntityVersion> {
  const executor = tx ?? db;
  const [row] = await executor
    .insert(aiEntityVersionsTable)
    .values({
      entityType:     record.entityType,
      entityId:       record.entityId,
      tenantId,
      versionNumber:  record.versionNumber,
      versionLabel:   record.versionLabel ?? null,
      idempotencyKey: record.idempotencyKey ?? null,
      contentHash:    record.contentHash,
      contentSnapshot: record.contentSnapshot as Record<string, unknown>,
      parentVersionId: record.parentVersionId ?? null,
      reason:          record.reason ?? null,
      revisionReason:  record.revisionReason ?? null,
      actorId:         record.actorId ?? null,
      actorType:       record.actorType,
      aiJobId:         record.aiJobId ?? null,
      aiModel:         record.aiModel ?? null,
      reviewId:        record.reviewId ?? null,
      isApproved:      false,
      isCurrent:       false,
    })
    .returning();
  return row;
}

/**
 * Approve a version — sets is_approved + approved metadata.
 * Caller (service) must verify the version is not already approved.
 */
export async function approveVersionRecord(
  id: number,
  tenantId: string,
  approvedBy: string,
  tx?: typeof db,
): Promise<AiEntityVersion> {
  const executor = tx ?? db;
  const [row] = await executor
    .update(aiEntityVersionsTable)
    .set({
      isApproved: true,
      approvedAt: new Date(),
      approvedBy,
    })
    .where(
      and(
        eq(aiEntityVersionsTable.id, id),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        isNull(aiEntityVersionsTable.deletedAt),
      ),
    )
    .returning();
  return row;
}

/**
 * Atomically promote a version to current:
 *   1. Clear is_current on all other versions of the entity.
 *   2. Set is_current on the target version.
 * Runs inside a transaction.
 */
export async function promoteVersionRecord(
  id: number,
  entityType: string,
  entityId: string,
  tenantId: string,
): Promise<AiEntityVersion> {
  return db.transaction(async (tx) => {
    // Clear existing current pointer
    await tx
      .update(aiEntityVersionsTable)
      .set({ isCurrent: false })
      .where(
        and(
          eq(aiEntityVersionsTable.entityType, entityType),
          eq(aiEntityVersionsTable.entityId, entityId),
          eq(aiEntityVersionsTable.tenantId, tenantId),
          eq(aiEntityVersionsTable.isCurrent, true),
        ),
      );

    // Set the new current
    const [row] = await tx
      .update(aiEntityVersionsTable)
      .set({ isCurrent: true })
      .where(
        and(
          eq(aiEntityVersionsTable.id, id),
          eq(aiEntityVersionsTable.tenantId, tenantId),
          isNull(aiEntityVersionsTable.deletedAt),
        ),
      )
      .returning();

    return row;
  });
}

/**
 * Soft-delete (tombstone) a version. Approved versions cannot be
 * hard-deleted; this is enforced at the service layer.
 */
export async function softDeleteVersionRecord(
  id: number,
  tenantId: string,
): Promise<AiEntityVersion | null> {
  const [row] = await db
    .update(aiEntityVersionsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(aiEntityVersionsTable.id, id),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        isNull(aiEntityVersionsTable.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Link a version to a client review record (additive, nullable).
 */
export async function linkVersionToReview(
  id: number,
  reviewId: number,
  tenantId: string,
): Promise<AiEntityVersion | null> {
  const [row] = await db
    .update(aiEntityVersionsTable)
    .set({ reviewId })
    .where(
      and(
        eq(aiEntityVersionsTable.id, id),
        eq(aiEntityVersionsTable.tenantId, tenantId),
        isNull(aiEntityVersionsTable.deletedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Compute the next version number for an entity using an advisory lock
 * inside a transaction to prevent concurrent race conditions.
 * Returns the new version number; caller must insert inside the same tx.
 */
export async function acquireNextVersionNumber(
  entityType: string,
  entityId: string,
  tenantId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<number> {
  // Use a deterministic integer advisory lock key derived from entity identity.
  // pg_advisory_xact_lock is released automatically when the transaction ends.
  const lockKey = `${entityType}::${entityId}::${tenantId}`;
  await tx.execute(rawSql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

  const result = await tx.execute(
    rawSql`
      SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
      FROM ai_platform.ai_entity_versions
      WHERE entity_type = ${entityType}
        AND entity_id   = ${entityId}
        AND tenant_id   = ${tenantId}
        AND deleted_at  IS NULL
    `,
  );

  const row = (result as unknown as { rows: Array<{ next_version: number }> }).rows[0];
  return Number(row?.next_version ?? 1);
}
