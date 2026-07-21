/**
 * design-lifecycle/designProjectLifecycleService.ts — Team 08
 *
 * Application service that orchestrates Universal Design Platform lifecycle
 * operations over the existing creative_projects persistence layer.
 *
 * This service is the ONLY entry point for lifecycle transitions. It:
 *  1. Validates the requested transition via guardTransition.
 *  2. Checks optimistic concurrency (expectedVersion).
 *  3. Atomically writes the new status + increments lifecycle_version.
 *  4. Appends a lifecycle event inside the same transaction.
 *  5. Returns the updated DesignProjectView.
 *
 * The service does NOT touch:
 *  - Payment/commercial gates (those remain in their existing services).
 *  - AI job engine or worker dispatch.
 *  - Brief wizard logic or quotation lifecycle.
 *  - Client review semantics (those remain in clientReviewService).
 *  - UI or route definitions.
 */

import { withTransaction } from "../../repositories/creativeProjectRepository.js";
import type { RepositoryContext } from "../../repositories/types.js";
import { guardTransition } from "./lifecycleTransitions.js";
import { toDesignStage } from "./lifecycleStatusMap.js";
import {
  loadProject,
  transitionProjectStatus,
  appendLifecycleEvent,
  listArtifacts,
  attachArtifact,
  listStages,
  saveStage,
} from "./designProjectPersistenceAdapter.js";
import {
  LifecycleNotFoundError,
  type DesignProjectView,
  type DesignStage,
  type DesignArtifact,
  type DesignStageRecord,
  type TransitionOptions,
} from "./types.js";

export type { DesignProjectView, DesignStage, DesignArtifact, DesignStageRecord };

// ── Read operations ───────────────────────────────────────────────────────────

/**
 * Loads a project and returns its current design-layer view.
 * Throws LifecycleNotFoundError when projectId does not exist.
 */
export async function getProject(
  ctx: RepositoryContext,
  projectId: string,
): Promise<DesignProjectView> {
  return loadProject(ctx, projectId);
}

/**
 * Returns all stage records (creative_project_steps) for the project.
 */
export async function getStages(
  ctx: RepositoryContext,
  projectId: string,
): Promise<DesignStageRecord[]> {
  return listStages(ctx, projectId);
}

/**
 * Returns all attached artifacts (creative_ai_assets) for the project.
 */
export async function getArtifacts(
  ctx: RepositoryContext,
  projectId: string,
): Promise<DesignArtifact[]> {
  return listArtifacts(ctx, projectId);
}

// ── Lifecycle transition ──────────────────────────────────────────────────────

/**
 * Transitions a project to the requested DesignStage.
 *
 * Guarantees:
 *  - Transition is validated before any DB write.
 *  - Status update and event append are atomic.
 *  - Optimistic concurrency is enforced when opts.expectedVersion is provided.
 *  - Duplicate noop transitions are rejected unless opts.allowNoop is true.
 *
 * @param ctx     - Repository context (carries tenant/auth info).
 * @param projectId - The canonical project UUID.
 * @param toStage   - The target DesignStage.
 * @param opts    - Optional concurrency, actor, reason, and metadata overrides.
 * @returns       The updated DesignProjectView.
 */
export async function transitionLifecycle(
  ctx: RepositoryContext,
  projectId: string,
  toStage: DesignStage,
  opts: TransitionOptions = {},
): Promise<DesignProjectView> {
  // 1. Load current state
  const current = await loadProject(ctx, projectId);
  const fromStage = current.designStage;

  // 2. Validate transition (throws on invalid or terminal-state violation)
  guardTransition(fromStage, toStage, { allowNoop: opts.allowNoop ?? false });

  // 3. Atomic: update status + append event in one transaction
  return withTransaction(ctx, async (txCtx) => {
    const updated = await transitionProjectStatus(txCtx, projectId, toStage, {
      expectedVersion: opts.expectedVersion,
      actor: opts.actor,
      metadata: opts.metadata,
    });

    await appendLifecycleEvent(txCtx, {
      projectId,
      fromStage,
      toStage,
      actor: opts.actor,
      reason: opts.reason,
      metadata: opts.metadata,
    });

    return updated;
  });
}

// ── Stage management ──────────────────────────────────────────────────────────

/**
 * Saves (creates or updates) a stage record for this project.
 */
export async function upsertStage(
  ctx: RepositoryContext,
  stage: DesignStageRecord,
): Promise<DesignStageRecord> {
  return saveStage(ctx, stage);
}

// ── Artifact management ───────────────────────────────────────────────────────

/**
 * Attaches an artifact to a project.
 * Idempotent: if an artifact with the same idempotencyKey already exists for
 * this project, returns the existing record without creating a duplicate.
 */
export async function attachProjectArtifact(
  ctx: RepositoryContext,
  projectId: string,
  artifact: Omit<DesignArtifact, "projectId">,
): Promise<DesignArtifact> {
  // Verify project exists before attaching
  const project = await loadProject(ctx, projectId);
  if (!project) throw new LifecycleNotFoundError(projectId);

  return attachArtifact(ctx, { ...artifact, projectId });
}

// ── Legacy project mapping ────────────────────────────────────────────────────

/**
 * Maps a legacy creative_projects record (with any raw status string) to a
 * DesignProjectView without requiring lifecycle_metadata to be populated.
 * Useful for displaying legacy projects that were created before Team 08.
 *
 * NOTE: This is a pure mapping function — it does NOT write to the DB.
 * The lifecycle_metadata.designStage field will be absent for legacy records;
 * toDesignStage falls back to STATUS_TO_DESIGN_STAGE lookup gracefully.
 */
export function mapLegacyProject(raw: {
  projectId: string;
  status: string;
  lifecycleVersion?: number | null;
  designPluginId?: string | null;
  lifecycleMetadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}): DesignProjectView {
  const meta = raw.lifecycleMetadata ?? {};
  return {
    projectId: raw.projectId,
    designStage: toDesignStage(raw.status, meta),
    rawStatus: raw.status,
    lifecycleVersion: raw.lifecycleVersion ?? 0,
    designPluginId: raw.designPluginId ?? null,
    lifecycleMetadata: meta,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
