/**
 * design-lifecycle/designProjectPersistenceAdapter.ts — Team 08
 *
 * Persistence ports implementation that connects the Universal Design Engine
 * to the existing creative_projects / creative_project_steps / creative_ai_assets
 * / ai_events storage WITHOUT introducing a second project table.
 *
 * Tenant isolation note:
 *   creative_projects has no tenant_id column (as documented in
 *   creativeProjectRepository.ts). The projectId UUID acts as a capability
 *   token. All calls that reach this adapter should have already verified the
 *   projectId was obtained through a tenant-verified lookup. Cross-tenant
 *   enforcement is applied at the service request layer (ai_service_requests
 *   has tenant_id) before a projectId is issued to a caller.
 *
 * Idempotency:
 *   attachArtifact uses a metadata-stored idempotency key to prevent duplicate
 *   asset creation for the same generation request. The lifecycle_version column
 *   on creative_projects provides optimistic concurrency for status transitions.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiAssetsTable,
  aiEventsTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  resolveExecutor,
  withExecutor,
  type RepositoryContext,
  type DbExecutor,
} from "../../repositories/types.js";
import { withTransaction } from "../../repositories/creativeProjectRepository.js";
import { logAudit } from "../aiAuditService.js";
import { toDesignStage, toRawStatus } from "./lifecycleStatusMap.js";
import {
  LifecycleNotFoundError,
  LifecycleStaleVersionError,
  type DesignProjectView,
  type DesignStageRecord,
  type DesignArtifact,
  type LifecycleEventPayload,
  type DesignStage,
} from "./types.js";

// ── Load ──────────────────────────────────────────────────────────────────────

/**
 * Loads a creative project by its UUID and returns a design-layer view.
 * Excludes soft-deleted projects.
 * Throws LifecycleNotFoundError when the project does not exist.
 */
export async function loadProject(
  ctx: RepositoryContext,
  projectId: string,
): Promise<DesignProjectView> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  const [row] = await executor
    .select()
    .from(creativeProjectsTable)
    .where(
      and(
        eq(creativeProjectsTable.projectId, projectId),
        // Exclude soft-deleted rows
        eq(creativeProjectsTable.deletedAt, null as unknown as Date),
      ),
    );

  if (!row) throw new LifecycleNotFoundError(projectId);

  const meta = (row.lifecycleMetadata as Record<string, unknown> | null) ?? {};

  return {
    projectId: row.projectId,
    designStage: toDesignStage(row.status, meta),
    rawStatus: row.status,
    lifecycleVersion: (row.lifecycleVersion as number | null) ?? 0,
    designPluginId: (row.designPluginId as string | null) ?? null,
    lifecycleMetadata: meta,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Atomic status transition ──────────────────────────────────────────────────

/**
 * Atomically transitions creative_projects.status and increments lifecycle_version.
 * Uses optimistic concurrency: if expectedVersion is provided and does not match
 * the stored version, throws LifecycleStaleVersionError.
 *
 * Must be called inside a withTransaction block when combined with event appending.
 */
export async function transitionProjectStatus(
  ctx: RepositoryContext,
  projectId: string,
  toStage: DesignStage,
  opts: {
    expectedVersion?: number;
    actor?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<DesignProjectView> {
  return withTransaction(ctx, async (txCtx) => {
    const executor = resolveExecutor(txCtx, db) as DbExecutor;

    // Load current row inside the transaction to hold a consistent snapshot
    const [current] = await executor
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.projectId, projectId));

    if (!current) throw new LifecycleNotFoundError(projectId);

    const currentVersion = (current.lifecycleVersion as number | null) ?? 0;

    if (
      opts.expectedVersion !== undefined &&
      opts.expectedVersion !== currentVersion
    ) {
      throw new LifecycleStaleVersionError(projectId, opts.expectedVersion, currentVersion);
    }

    const existingMeta =
      (current.lifecycleMetadata as Record<string, unknown> | null) ?? {};
    const newMeta: Record<string, unknown> = {
      ...existingMeta,
      ...(opts.metadata ?? {}),
      designStage: toStage,       // always persist explicit stage for tie-breaking
      lastTransitionAt: new Date().toISOString(),
      lastTransitionActor: opts.actor ?? null,
    };

    const [updated] = await executor
      .update(creativeProjectsTable)
      .set({
        status: toRawStatus(toStage),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lifecycleVersion: currentVersion + 1 as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lifecycleMetadata: newMeta as any,
      })
      .where(eq(creativeProjectsTable.projectId, projectId))
      .returning();

    await logAudit(
      "designProjectPersistenceAdapter",
      "transition_status",
      projectId,
      "CreativeProject",
      "success",
      {
        toStage,
        toRawStatus: toRawStatus(toStage),
        newVersion: currentVersion + 1,
        tenantId: txCtx.requestContext.tenantId ?? "unknown",
      },
    );

    return {
      projectId: updated.projectId,
      designStage: toStage,
      rawStatus: updated.status,
      lifecycleVersion: (updated.lifecycleVersion as number | null) ?? currentVersion + 1,
      designPluginId: (updated.designPluginId as string | null) ?? null,
      lifecycleMetadata: newMeta,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });
}

// ── Stage (creative_project_steps) ────────────────────────────────────────────

/**
 * Resolves the integer DB id of a creative_project from its UUID.
 * Used to bridge creative_project_steps.project_id (FK to serial id).
 */
async function resolveDbId(
  executor: DbExecutor,
  projectId: string,
): Promise<number> {
  const [row] = await executor
    .select({ id: creativeProjectsTable.id })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId));
  if (!row) throw new LifecycleNotFoundError(projectId);
  return row.id;
}

/**
 * Lists all creative_project_steps for a project by UUID.
 */
export async function listStages(
  ctx: RepositoryContext,
  projectId: string,
): Promise<DesignStageRecord[]> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const dbId = await resolveDbId(executor, projectId);

  const rows = await executor
    .select()
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, dbId));

  return rows.map((r) => ({
    id: r.id,
    projectId,
    stepName: r.stepName,
    status: r.status as DesignStageRecord["status"],
    input: (r.input as Record<string, unknown> | null) ?? null,
    output: (r.output as Record<string, unknown> | null) ?? null,
    provider: r.provider,
    model: r.model,
    errorMessage: r.errorMessage,
  }));
}

/**
 * Saves (upserts) a stage record. If id is present, updates; otherwise inserts.
 */
export async function saveStage(
  ctx: RepositoryContext,
  stage: DesignStageRecord,
): Promise<DesignStageRecord> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const dbId = await resolveDbId(executor, stage.projectId);

  if (stage.id !== undefined) {
    const [updated] = await executor
      .update(creativeProjectStepsTable)
      .set({
        stepName: stage.stepName,
        status: stage.status,
        input: stage.input ?? null,
        output: stage.output ?? null,
        provider: stage.provider ?? null,
        model: stage.model ?? null,
        errorMessage: stage.errorMessage ?? null,
      })
      .where(eq(creativeProjectStepsTable.id, stage.id))
      .returning();
    return { ...stage, id: updated.id };
  }

  const [inserted] = await executor
    .insert(creativeProjectStepsTable)
    .values({
      projectId: dbId,
      stepName: stage.stepName,
      status: stage.status,
      input: stage.input ?? null,
      output: stage.output ?? null,
      provider: stage.provider ?? null,
      model: stage.model ?? null,
      errorMessage: stage.errorMessage ?? null,
    })
    .returning();

  return { ...stage, id: inserted.id };
}

// ── Artifacts (creative_ai_assets) ────────────────────────────────────────────

/**
 * Lists all creative_ai_assets for a project by UUID.
 */
export async function listArtifacts(
  ctx: RepositoryContext,
  projectId: string,
): Promise<DesignArtifact[]> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const rows = await executor
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, projectId));

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    assetType: r.assetType,
    provider: r.provider,
    model: r.model,
    prompt: r.prompt,
    imageUrl: r.imageUrl,
    storagePath: r.storagePath,
    status: r.status as DesignArtifact["status"],
    category: r.category,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    idempotencyKey:
      ((r.metadata as Record<string, unknown> | null)?.idempotencyKey as string | null) ??
      null,
  }));
}

/**
 * Attaches an artifact to a project, idempotently.
 * If an asset with the same idempotencyKey already exists for this project,
 * returns the existing record rather than creating a duplicate.
 */
export async function attachArtifact(
  ctx: RepositoryContext,
  artifact: DesignArtifact,
): Promise<DesignArtifact> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  // Idempotency check: scan existing assets for the same key
  if (artifact.idempotencyKey) {
    const existing = await executor
      .select()
      .from(creativeAiAssetsTable)
      .where(eq(creativeAiAssetsTable.projectId, artifact.projectId));

    const duplicate = existing.find(
      (r) =>
        ((r.metadata as Record<string, unknown> | null)?.idempotencyKey as string | null) ===
        artifact.idempotencyKey,
    );

    if (duplicate) {
      return {
        id: duplicate.id,
        projectId: duplicate.projectId,
        assetType: duplicate.assetType,
        provider: duplicate.provider,
        model: duplicate.model,
        prompt: duplicate.prompt,
        imageUrl: duplicate.imageUrl,
        storagePath: duplicate.storagePath,
        status: duplicate.status as DesignArtifact["status"],
        category: duplicate.category,
        metadata: (duplicate.metadata as Record<string, unknown> | null) ?? null,
        idempotencyKey: artifact.idempotencyKey,
      };
    }
  }

  const meta: Record<string, unknown> = {
    ...(artifact.metadata ?? {}),
    ...(artifact.idempotencyKey ? { idempotencyKey: artifact.idempotencyKey } : {}),
  };

  const [inserted] = await executor
    .insert(creativeAiAssetsTable)
    .values({
      projectId: artifact.projectId,
      assetType: artifact.assetType,
      provider: artifact.provider,
      model: artifact.model,
      prompt: artifact.prompt,
      imageUrl: artifact.imageUrl ?? null,
      storagePath: artifact.storagePath ?? null,
      status: artifact.status,
      category: artifact.category ?? null,
      metadata: meta,
    })
    .returning();

  return {
    id: inserted.id,
    projectId: inserted.projectId,
    assetType: inserted.assetType,
    provider: inserted.provider,
    model: inserted.model,
    prompt: inserted.prompt,
    imageUrl: inserted.imageUrl,
    storagePath: inserted.storagePath,
    status: inserted.status as DesignArtifact["status"],
    category: inserted.category,
    metadata: (inserted.metadata as Record<string, unknown> | null) ?? null,
    idempotencyKey: artifact.idempotencyKey ?? null,
  };
}

// ── Events (ai_events) ────────────────────────────────────────────────────────

/**
 * Appends a lifecycle event to ai_events.
 * Must be called inside withTransaction to ensure atomicity with the
 * status transition that triggered the event.
 */
export async function appendLifecycleEvent(
  ctx: RepositoryContext,
  payload: LifecycleEventPayload,
): Promise<void> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;

  await executor.insert(aiEventsTable).values({
    eventId: randomUUID(),
    eventType: "design_lifecycle.transitioned",
    sourceModule: "design-lifecycle",
    sourceId: payload.projectId,
    correlationId: payload.projectId,
    causationId: null,
    payloadJson: {
      projectId: payload.projectId,
      fromStage: payload.fromStage ?? null,
      toStage: payload.toStage,
      actor: payload.actor ?? null,
      reason: payload.reason ?? null,
      ...(payload.metadata ?? {}),
    },
    metadataJson: {
      tenantId: ctx.requestContext.tenantId ?? "unknown",
    },
    status: "published",
    publishedAt: new Date(),
  });
}
