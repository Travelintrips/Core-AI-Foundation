/**
 * services/design-versioning/designVersionService.ts — Team 09
 *
 * Domain service for the Design Version History & Revision System.
 *
 * Responsibilities:
 *  - Idempotent version creation (same idempotencyKey → same row)
 *  - Monotonic version numbering with advisory-lock concurrency guard
 *  - Immutability enforcement for approved versions
 *  - Atomic promote / restore operations
 *  - JSON diff between any two versions of the same entity
 *  - Additive review link
 *  - Audit trail via logAudit
 *
 * Multi-tenant: every operation takes a RepositoryContext; tenantId is
 * resolved from the authenticated request context — never trusted from
 * the client payload.
 */
import * as crypto from "crypto";
import { db, type AiEntityVersion } from "@workspace/db";
import { logAudit } from "../aiAuditService.js";
import { diffJson, type JsonDiffResult } from "./jsonDiff.js";
import * as repo from "./designVersionRepository.js";
import type { RepositoryContext } from "../../repositories/types.js";
import { requireTenantId } from "../../repositories/tenantScope.js";
import {
  VERSIONABLE_ENTITY_TYPES,
  VERSION_ACTOR_TYPES,
  REVISION_REASONS,
  type VersionableEntityType,
  type VersionActorType,
  type RevisionReason,
} from "@workspace/db";

// ── Custom errors ─────────────────────────────────────────────────────────────

export class VersionImmutableError extends Error {
  constructor(id: number) {
    super(`Version ${id} is approved and immutable — create a new version instead`);
    this.name = "VersionImmutableError";
  }
}

export class VersionNotFoundError extends Error {
  constructor(id: number) {
    super(`Version ${id} not found or not accessible in this tenant`);
    this.name = "VersionNotFoundError";
  }
}

export class VersionEntityTypeMismatchError extends Error {
  constructor(idA: number, idB: number) {
    super(`Versions ${idA} and ${idB} belong to different entities — cannot diff across entities`);
    this.name = "VersionEntityTypeMismatchError";
  }
}

export class InvalidEntityTypeError extends Error {
  constructor(entityType: string) {
    super(
      `Invalid entity type: "${entityType}". Must be one of: ${VERSIONABLE_ENTITY_TYPES.join(", ")}`,
    );
    this.name = "InvalidEntityTypeError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function contentHash(content: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

function buildVersionLabel(versionNumber: number, reason?: string | null): string {
  const base = `v${versionNumber}`;
  if (!reason) return base;
  const labelMap: Record<string, string> = {
    client_revision:  "Client Revision",
    admin_correction: "Admin Correction",
    restore:          "Restored",
    import:           "Import",
  };
  const suffix = labelMap[reason];
  return suffix ? `${base} (${suffix})` : base;
}

// ── Create version ────────────────────────────────────────────────────────────

export interface CreateVersionInput {
  entityType: VersionableEntityType;
  entityId: string;
  contentSnapshot: Record<string, unknown>;
  revisionReason?: RevisionReason;
  reason?: string;
  actorId?: string;
  actorType?: VersionActorType;
  aiJobId?: string;
  aiModel?: string;
  parentVersionId?: number;
  idempotencyKey?: string;
  reviewId?: number;
}

/**
 * Create a new version for an entity.
 *
 * Idempotent: if idempotencyKey is provided and a version with the same key
 * already exists for the entity, the existing version is returned unchanged.
 *
 * Thread-safe: uses a PostgreSQL advisory lock inside a transaction to
 * guarantee monotonic version numbers under concurrent requests.
 */
export async function createVersion(
  input: CreateVersionInput,
  ctx: RepositoryContext,
): Promise<AiEntityVersion> {
  if (!VERSIONABLE_ENTITY_TYPES.includes(input.entityType)) {
    throw new InvalidEntityTypeError(input.entityType);
  }

  const tenantId = requireTenantId(ctx);
  const hash = contentHash(input.contentSnapshot);

  // ── Idempotency check ──────────────────────────────────────────────────────
  if (input.idempotencyKey) {
    const existing = await repo.findByIdempotencyKey(
      input.entityType,
      input.entityId,
      tenantId,
      input.idempotencyKey,
    );
    if (existing) return existing;
  }

  // ── Atomic insert with advisory lock ──────────────────────────────────────
  const version = await db.transaction(async (tx) => {
    const versionNumber = await repo.acquireNextVersionNumber(
      input.entityType,
      input.entityId,
      tenantId,
      tx,
    );

    return repo.insertVersionRecord(
      tenantId,
      {
        entityType:      input.entityType,
        entityId:        input.entityId,
        versionNumber,
        versionLabel:    buildVersionLabel(versionNumber, input.revisionReason),
        idempotencyKey:  input.idempotencyKey,
        contentHash:     hash,
        contentSnapshot: input.contentSnapshot,
        parentVersionId: input.parentVersionId,
        reason:          input.reason,
        revisionReason:  input.revisionReason,
        actorId:         input.actorId,
        actorType:       input.actorType ?? "system",
        aiJobId:         input.aiJobId,
        aiModel:         input.aiModel,
        reviewId:        input.reviewId,
      },
      tx as unknown as typeof db,
    );
  });

  await logAudit({
    module:       "design-versioning",
    action:       "version.created",
    resourceType: "ai_entity_version",
    resourceId:   String(version.id),
    status:       "success",
    tenantId,
    actorId:      input.actorId,
    actorType:    "internal_user",
    details: {
      entityType:    input.entityType,
      entityId:      input.entityId,
      versionNumber: version.versionNumber,
      revisionReason: input.revisionReason ?? null,
    },
  });

  return version;
}

// ── Approve version ────────────────────────────────────────────────────────────

export interface ApproveVersionInput {
  versionId: number;
  approvedBy: string;
}

/**
 * Mark a version as approved. Once approved, the version's content is
 * immutable — any mutation attempt throws VersionImmutableError.
 */
export async function approveVersion(
  input: ApproveVersionInput,
  ctx: RepositoryContext,
): Promise<AiEntityVersion> {
  const tenantId = requireTenantId(ctx);
  const existing = await repo.findVersionById(input.versionId, ctx);
  if (!existing) throw new VersionNotFoundError(input.versionId);
  if (existing.isApproved) throw new VersionImmutableError(input.versionId);

  const updated = await repo.approveVersionRecord(input.versionId, tenantId, input.approvedBy);

  await logAudit({
    module:       "design-versioning",
    action:       "version.approved",
    resourceType: "ai_entity_version",
    resourceId:   String(input.versionId),
    status:       "success",
    tenantId,
    actorId:      input.approvedBy,
    actorType:    "internal_user",
    details: {
      entityType:    existing.entityType,
      entityId:      existing.entityId,
      versionNumber: existing.versionNumber,
    },
  });

  return updated;
}

// ── Promote version ───────────────────────────────────────────────────────────

export interface PromoteVersionInput {
  versionId: number;
  actorId?: string;
}

/**
 * Atomically promote a version to "current". Clears the current flag on
 * all other versions of the same entity and sets it on the target.
 */
export async function promoteVersion(
  input: PromoteVersionInput,
  ctx: RepositoryContext,
): Promise<AiEntityVersion> {
  const tenantId = requireTenantId(ctx);
  const existing = await repo.findVersionById(input.versionId, ctx);
  if (!existing) throw new VersionNotFoundError(input.versionId);

  const promoted = await repo.promoteVersionRecord(
    input.versionId,
    existing.entityType,
    existing.entityId,
    tenantId,
  );

  await logAudit({
    module:       "design-versioning",
    action:       "version.promoted",
    resourceType: "ai_entity_version",
    resourceId:   String(input.versionId),
    status:       "success",
    tenantId,
    actorId:      input.actorId,
    actorType:    "internal_user",
    details: {
      entityType:    existing.entityType,
      entityId:      existing.entityId,
      versionNumber: existing.versionNumber,
    },
  });

  return promoted;
}

// ── Restore version ────────────────────────────────────────────────────────────

export interface RestoreVersionInput {
  fromVersionId: number;
  actorId?: string;
  reason?: string;
}

/**
 * Restore a previous version by creating a new version with the same
 * content. The restored version is NOT automatically approved or promoted —
 * those are explicit subsequent actions.
 *
 * The new version's parentVersionId points to the restored source, and its
 * revisionReason is 'restore'.
 */
export async function restoreVersion(
  input: RestoreVersionInput,
  ctx: RepositoryContext,
): Promise<AiEntityVersion> {
  const existing = await repo.findVersionById(input.fromVersionId, ctx);
  if (!existing) throw new VersionNotFoundError(input.fromVersionId);

  return createVersion(
    {
      entityType:      existing.entityType as VersionableEntityType,
      entityId:        existing.entityId,
      contentSnapshot: existing.contentSnapshot as Record<string, unknown>,
      revisionReason:  "restore",
      reason:          input.reason ?? `Restored from v${existing.versionNumber}`,
      actorId:         input.actorId,
      actorType:       "human",
      parentVersionId: existing.id,
    },
    ctx,
  );
}

// ── List & get ────────────────────────────────────────────────────────────────

export async function listVersions(
  entityType: string,
  entityId: string,
  ctx: RepositoryContext,
): Promise<AiEntityVersion[]> {
  if (!VERSIONABLE_ENTITY_TYPES.includes(entityType as VersionableEntityType)) {
    throw new InvalidEntityTypeError(entityType);
  }
  return repo.findVersionsByEntity(entityType, entityId, ctx);
}

export async function getVersion(
  versionId: number,
  ctx: RepositoryContext,
): Promise<AiEntityVersion> {
  const version = await repo.findVersionById(versionId, ctx);
  if (!version) throw new VersionNotFoundError(versionId);
  return version;
}

// ── Diff ──────────────────────────────────────────────────────────────────────

/**
 * Compute a structured JSON diff between two versions of the same entity.
 * Both versions must belong to the same entity and be accessible to the
 * caller's tenant context.
 */
export async function diffVersions(
  versionIdA: number,
  versionIdB: number,
  ctx: RepositoryContext,
): Promise<JsonDiffResult & { versionA: number; versionB: number }> {
  const [vA, vB] = await Promise.all([
    repo.findVersionById(versionIdA, ctx),
    repo.findVersionById(versionIdB, ctx),
  ]);

  if (!vA) throw new VersionNotFoundError(versionIdA);
  if (!vB) throw new VersionNotFoundError(versionIdB);

  if (vA.entityType !== vB.entityType || vA.entityId !== vB.entityId) {
    throw new VersionEntityTypeMismatchError(versionIdA, versionIdB);
  }

  const diff = diffJson(vA.contentSnapshot, vB.contentSnapshot);
  return { ...diff, versionA: vA.versionNumber, versionB: vB.versionNumber };
}

// ── Review link ───────────────────────────────────────────────────────────────

export interface LinkToReviewInput {
  versionId: number;
  reviewId: number;
}

/**
 * Additively link a version to a client review record.
 * Does not validate the reviewId FK — reviews may be cross-schema;
 * the link is advisory metadata only.
 */
export async function linkVersionToReview(
  input: LinkToReviewInput,
  ctx: RepositoryContext,
): Promise<AiEntityVersion> {
  const tenantId = requireTenantId(ctx);
  const existing = await repo.findVersionById(input.versionId, ctx);
  if (!existing) throw new VersionNotFoundError(input.versionId);

  const updated = await repo.linkVersionToReview(input.versionId, input.reviewId, tenantId);
  if (!updated) throw new VersionNotFoundError(input.versionId);

  await logAudit({
    module:       "design-versioning",
    action:       "version.review_linked",
    resourceType: "ai_entity_version",
    resourceId:   String(input.versionId),
    status:       "success",
    tenantId,
    details:      { reviewId: input.reviewId },
  });

  return updated;
}
