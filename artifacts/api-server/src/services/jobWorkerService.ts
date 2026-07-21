/**
 * Job Worker Service — Phase 5 Job Queue / Phase 5.2 Distributed Worker Cluster
 *
 * claimJob()    — atomically claim the next available job (SELECT FOR UPDATE SKIP LOCKED)
 *                 Phase 5.2: capability-aware + lease-validated claiming
 * executeJob()  — dispatch a claimed job to the appropriate handler
 * completeJob() — mark job completed, update worker metrics
 * retryJob()    — schedule retry (immediate | exponential | manual)
 * cancelJob()   — mark job cancelled
 * heartbeat()   — update worker last_heartbeat
 * releaseJob()  — release without completing (requeue)
 */

import { eq, and, inArray, desc, sql } from "drizzle-orm";
import {
  db, aiJobsTable, aiWorkersTable, aiModelsTable, aiProvidersTable, aiPortfolioAssetsTable,
  creativeProjectsTable, creativeProjectStepsTable, creativeAiAssetsTable,
} from "@workspace/db";
import type { AiJob, AiWorker } from "@workspace/db";
import { createHash } from "crypto";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { executeAI } from "./aiExecutionService.js";
import { finalizeWorkflowCost } from "./observabilityService.js";
import { routeToModel } from "./aiModelRouter.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { archiveReplicateAsset, optimizeArchivedAsset, generateAssetThumbnail } from "./portfolioStorageService.js";
import { maybeFinalizePortfolioPublish } from "./demoPortfolioGeneratorService.js";
import { logger } from "../lib/logger.js";
import { WorkerNotImplementedError } from "./jobCompletionGuard.js";
import { createSystemContext } from "../security/requestContext.js";
import { DEFAULT_TENANT_ID } from "../security/tenantResolution.js";
import type { RequestContext } from "../security/requestContext.js";
import { resolveProjectDocumentType } from "./creativeProjectDocumentType.js";
import {
  executeGenericPdfExportJob,
  getSupportedDocumentTypes,
} from "./creativeDocumentWorkerService.js";
import { initDocumentRegistry } from "./creativeDocumentRegistry.js";
import { initPresentationRegistry } from "./presentation/creativePresentationRegistry.js";
import { getSupportedPresentationTypes, executeGenericPresentationExportJob } from "./presentation/creativePresentationWorkerService.js";
import { resolveProjectPresentationType } from "./creativeProjectPresentationType.js";
import { initImageBatchRegistry } from "./image-batch/imageBatchRegistryInit.js";
import { getSupportedImageBatchTypes } from "./image-batch/creativeImageBatchRegistry.js";
import { executeGenericImageBatchExportJob } from "./image-batch/creativeImageBatchWorkerService.js";
import { resolveProjectImageBatchType } from "./creativeProjectImageBatchType.js";
import { executeZipDeliveryJob } from "./zipDeliveryService.js";
import { initExportFormatRegistry } from "./export-workspace/exportFormatRegistry.js";

// Register all document type definitions at module load time.
initDocumentRegistry();
initPresentationRegistry();
initImageBatchRegistry();
// Team 17: Register export format definitions.
try { initExportFormatRegistry(); } catch { /* already initialised */ }

// ── WP-06: Worker context factory ────────────────────────────────────────────

/**
 * Build a RequestContext for a worker executing a specific job.
 * The tenantId is extracted from the job's `_tenantId` payload field
 * (stamped by enqueue() — never from unverified client input).
 * Falls back to DEFAULT_TENANT_ID for legacy jobs that predate WP-06.
 */
export function buildWorkerContext(job: AiJob): RequestContext {
  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof payload["_tenantId"] === "string" && payload["_tenantId"].length > 0
      ? payload["_tenantId"]
      : DEFAULT_TENANT_ID;

  return createSystemContext({
    tenantId,
    actorType: "worker",
    source: "worker",
    requestId: `job-${job.id}-${job.jobCode ?? ""}`,
    correlationId: `job-${job.id}`,
    metadata: {
      jobId: job.id,
      jobType: job.jobType ?? "",
      jobCode: job.jobCode ?? "",
    },
  });
}

// ── Real AI execution helpers ───────────────────────────────────────────────

interface JobModelResolution {
  model: typeof aiModelsTable.$inferSelect;
  provider: typeof aiProvidersTable.$inferSelect;
}

/**
 * Resolve the model+provider to use for a job.
 * Honors an explicit `model` / `modelId` string in the payload (matched against
 * the registry's modelId column); otherwise auto-routes based on the prompt.
 */
async function resolveJobModel(
  payload: Record<string, unknown>,
  prompt: string,
): Promise<JobModelResolution | null> {
  const requestedModelId = coerceString(payload.modelId) ?? coerceString(payload.model);

  if (requestedModelId) {
    const [row] = await db
      .select({ model: aiModelsTable, provider: aiProvidersTable })
      .from(aiModelsTable)
      .leftJoin(aiProvidersTable, eq(aiModelsTable.providerId, aiProvidersTable.id))
      .where(eq(aiModelsTable.modelId, requestedModelId));

    if (row?.model && row.provider && row.model.isActive && row.provider.isActive && getProviderApiKey(row.provider.slug)) {
      return { model: row.model, provider: row.provider };
    }
    // Requested model unavailable — fall through to auto-routing.
  }

  const routed = await routeToModel(prompt);
  return routed ? { model: routed.model, provider: routed.provider } : null;
}

/** Coerce a possibly-untrusted JSON field to a finite number, or null. */
function coerceNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Coerce a possibly-untrusted JSON field to a non-empty string, or null. */
function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Execute a text/LLM-style job via the registered model/provider. */
async function executeTextJob(job: AiJob, dispatchedLabel: string): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson as Record<string, unknown>) ?? {};
  const prompt =
    coerceString(payload.prompt) ?? coerceString(payload.brief) ?? `${dispatchedLabel} for job #${job.id}`;
  const systemPrompt = coerceString(payload.systemPrompt);

  const resolved = await resolveJobModel(payload, prompt);
  if (!resolved) {
    throw new Error(
      "No active model with a configured API key is available for this job. Add a provider API key in Settings.",
    );
  }

  const output = await executeAI({
    prompt,
    systemPrompt,
    model: resolved.model,
    provider: resolved.provider,
    temperature: coerceNumber(payload.temperature),
    maxTokens: coerceNumber(payload.maxTokens),
    observability: {
      jobId:        job.id,
      agentName:    dispatchedLabel,
      providerName: resolved.provider.slug,
      modelName:    resolved.model.modelId,
      requestType:  "text",
    },
  });

  return {
    jobId: job.id,
    message: `${dispatchedLabel} completed`,
    modelUsed: resolved.model.modelId,
    providerUsed: resolved.provider.slug,
    content: output.content,
    tokensUsed: output.tokensUsed,
    latencyMs: output.latencyMs,
  };
}

/** Execute an image-generation job via the registered image-capable model (Replicate FLUX). */
async function executeImageJob(job: AiJob): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson as Record<string, unknown>) ?? {};
  const prompt = String(payload.prompt ?? `Image generation for job #${job.id}`);

  const isImageCapable = (r: JobModelResolution | null) =>
    !!r && ((r.model.capabilities as string[] | null)?.includes("image-generation") ?? false);

  // Prefer an explicit model; otherwise route using an image-biased prompt so the
  // router's task-type heuristics select an image-capable model (e.g. FLUX via Replicate).
  let resolved = await resolveJobModel(payload, prompt);
  if (!isImageCapable(resolved)) {
    const routed = await routeToModel(`generate image: ${prompt}`);
    resolved = routed ? { model: routed.model, provider: routed.provider } : null;
  }

  // Invariant: never execute an image_generation job against a non-image model —
  // that would silently return text in place of an image URL.
  if (!resolved || !isImageCapable(resolved)) {
    throw new Error(
      "No active image-generation model with a configured API key is available. Add a Replicate API key in Settings.",
    );
  }

  const finalResolved: JobModelResolution = resolved;

  const output = await executeAI({
    prompt,
    model: finalResolved.model,
    provider: finalResolved.provider,
    observability: {
      jobId:        job.id,
      agentName:    "image-generation",
      providerName: finalResolved.provider.slug,
      modelName:    finalResolved.model.modelId,
      requestType:  "image",
    },
  });

  return {
    jobId: job.id,
    message: "Image generation completed",
    modelUsed: finalResolved.model.modelId,
    providerUsed: finalResolved.provider.slug,
    imageUrl: output.content,
    latencyMs: output.latencyMs,
  };
}

// ── Sprint P2.1.1 — Asset lifecycle background job handlers ───────────────────
// These run on the dedicated "storage_worker" so archiving/optimizing/
// thumbnailing never blocks (or is blocked by) image generation.

interface ArchiveAssetPayload {
  portfolioAssetId: number;
  sourceUrl: string;
  brandSlug: string;
  role: string;
}

/** archive_asset — download the Replicate delivery URL and persist it permanently. */
async function executeArchiveAssetJob(job: AiJob): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson as unknown as ArchiveAssetPayload) ?? ({} as ArchiveAssetPayload);
  const { portfolioAssetId, sourceUrl, brandSlug, role } = payload;
  if (!portfolioAssetId || !sourceUrl) {
    throw new Error("archive_asset job payload missing portfolioAssetId/sourceUrl");
  }

  // Sprint P3: look up portfolioId so we can use deterministic ID-based storage paths
  const [assetRow] = await db.select({ portfolioId: aiPortfolioAssetsTable.portfolioId })
    .from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId)).limit(1);

  await db.update(aiPortfolioAssetsTable)
    .set({ status: "archiving", archiveStatus: "running", archiveStartedAt: new Date() })
    .where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));
  publishSafe({ eventType: "asset.archiving", sourceModule: "asset-lifecycle", sourceId: String(portfolioAssetId), payload: { portfolioAssetId } });

  try {
    const result = await archiveReplicateAsset({
      sourceUrl,
      // Sprint P3: prefer ID-based path; fall back to legacy brandSlug/role for in-flight jobs
      portfolioId: assetRow?.portfolioId,
      assetId: portfolioAssetId,
      brandSlug,
      role,
    });

    await db.update(aiPortfolioAssetsTable)
      .set({
        status: "archived",
        archiveStatus: "completed",
        archiveCompletedAt: new Date(),
        archiveError: null,
        thumbnailUrl: result.permanentUrl,
        previewUrl: result.permanentUrl,
        storagePath: result.storagePath,
        storageProvider: result.storageProvider,
        storageBucket: result.storageBucket,
      })
      .where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));

    publishSafe({
      eventType: "asset.archived", sourceModule: "asset-lifecycle", sourceId: String(portfolioAssetId),
      payload: { portfolioAssetId, brandSlug, role, permanentUrl: result.permanentUrl, storagePath: result.storagePath },
    });

    return { portfolioAssetId, permanentUrl: result.permanentUrl, storagePath: result.storagePath };
  } catch (err) {
    const isFinalAttempt = job.retryCount >= job.maxRetry;
    await db.update(aiPortfolioAssetsTable)
      .set({
        archiveStatus: isFinalAttempt ? "failed" : "pending",
        status: isFinalAttempt ? "archive_failed" : "generated",
        archiveAttempts: sql`${aiPortfolioAssetsTable.archiveAttempts} + 1`,
        archiveError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));

    if (isFinalAttempt) {
      publishSafe({ eventType: "asset.archive_failed", sourceModule: "asset-lifecycle", sourceId: String(portfolioAssetId), payload: { portfolioAssetId, error: String(err) } });
      await maybeFinalizePortfolioPublish(portfolioAssetId).catch(() => undefined);
    }
    throw err;
  }
}

interface OptimizeAssetPayload {
  portfolioAssetId: number;
  storagePath: string;
  brandSlug: string;
  role: string;
}

/** optimize_asset — re-encode the archived original into a smaller WebP master. */
async function executeOptimizeAssetJob(job: AiJob): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson as unknown as OptimizeAssetPayload) ?? ({} as OptimizeAssetPayload);
  const { portfolioAssetId, storagePath, brandSlug, role } = payload;
  if (!portfolioAssetId || !storagePath) {
    throw new Error("optimize_asset job payload missing portfolioAssetId/storagePath");
  }

  // Sprint P3: look up portfolioId for deterministic ID-based storage paths
  const [assetRow] = await db.select({ portfolioId: aiPortfolioAssetsTable.portfolioId })
    .from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId)).limit(1);

  await db.update(aiPortfolioAssetsTable).set({ optimizationStatus: "running" }).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));

  try {
    const result = await optimizeArchivedAsset({
      sourceStoragePath: storagePath,
      portfolioId: assetRow?.portfolioId,
      assetId: portfolioAssetId,
      brandSlug,
      role,
    });

    await db.update(aiPortfolioAssetsTable)
      .set({
        status: "optimized",
        optimizationStatus: "completed",
        previewUrl: result.permanentUrl,
        width: result.width,
        height: result.height,
      })
      .where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));

    publishSafe({ eventType: "asset.optimized", sourceModule: "asset-lifecycle", sourceId: String(portfolioAssetId), payload: { portfolioAssetId, permanentUrl: result.permanentUrl } });
    await maybeFinalizePortfolioPublish(portfolioAssetId).catch(() => undefined);
    return { portfolioAssetId, permanentUrl: result.permanentUrl };
  } catch (err) {
    const isFinalAttempt = job.retryCount >= job.maxRetry;
    if (isFinalAttempt) {
      await db.update(aiPortfolioAssetsTable).set({ optimizationStatus: "failed" }).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));
    }
    throw err;
  }
}

interface ThumbnailPayload {
  portfolioAssetId: number;
  storagePath: string;
  brandSlug: string;
  role: string;
}

/** generate_thumbnail — create a small gallery-grid thumbnail from the archived original. */
async function executeGenerateThumbnailJob(job: AiJob): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson as unknown as ThumbnailPayload) ?? ({} as ThumbnailPayload);
  const { portfolioAssetId, storagePath, brandSlug, role } = payload;
  if (!portfolioAssetId || !storagePath) {
    throw new Error("generate_thumbnail job payload missing portfolioAssetId/storagePath");
  }

  // Sprint P3: look up portfolioId for deterministic ID-based storage paths
  const [assetRow] = await db.select({ portfolioId: aiPortfolioAssetsTable.portfolioId })
    .from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId)).limit(1);

  await db.update(aiPortfolioAssetsTable).set({ thumbnailStatus: "running" }).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));

  try {
    const result = await generateAssetThumbnail({
      sourceStoragePath: storagePath,
      portfolioId: assetRow?.portfolioId,
      assetId: portfolioAssetId,
      brandSlug,
      role,
    });

    await db.update(aiPortfolioAssetsTable)
      .set({ thumbnailStatus: "completed", thumbnailUrl: result.permanentUrl })
      .where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));

    publishSafe({ eventType: "asset.thumbnail_created", sourceModule: "asset-lifecycle", sourceId: String(portfolioAssetId), payload: { portfolioAssetId, permanentUrl: result.permanentUrl } });
    return { portfolioAssetId, permanentUrl: result.permanentUrl };
  } catch (err) {
    const isFinalAttempt = job.retryCount >= job.maxRetry;
    if (isFinalAttempt) {
      await db.update(aiPortfolioAssetsTable).set({ thumbnailStatus: "failed" }).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId));
      publishSafe({ eventType: "asset.thumbnail_created", sourceModule: "asset-lifecycle", sourceId: String(portfolioAssetId), payload: { portfolioAssetId, failed: true } });
    }
    throw err;
  }
}

// ── Retry delay helpers ───────────────────────────────────────────────────────

function exponentialBackoffMs(retryCount: number): number {
  // 30s, 2min, 8min, 30min … capped at 30 min
  return Math.min(30 * 60_000, 30_000 * Math.pow(4, retryCount));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next available queued job for a worker.
 *
 * Phase 5.2 additions:
 *  - Validates worker lease before claiming (workers without valid lease are skipped)
 *  - Respects max_concurrent_jobs per worker
 *  - Filters jobs by required_capability — only workers whose capabilities array
 *    includes the job's required_capability (or the job has no required_capability) are eligible
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED so multiple workers never take the same job.
 */
export async function claimJob(workerId: number): Promise<AiJob | null> {
  // ── Pre-flight: validate worker lease and capacity ───────────────────────
  const [worker] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.id, workerId));

  if (!worker) return null;

  // Reject stale/offline workers
  if (worker.status === "offline" || worker.status === "stale") return null;

  // Lease check: if a lease is configured, it must be valid
  if (worker.leaseExpiresAt !== null && worker.leaseExpiresAt < new Date()) {
    return null; // lease expired — worker is stale
  }

  // Capacity check: respect max_concurrent_jobs
  if (worker.runningJobs >= worker.maxConcurrentJobs) return null;

  // Capabilities for this worker (Phase 5.2 capability routing)
  const capabilities = (worker.capabilities as string[] | null) ?? [];
  // Serialise as a JSON string for the JSONB ? operator in PostgreSQL
  const capJson = JSON.stringify(capabilities);

  return db.transaction(async (tx) => {
    // Find the highest-priority available job and lock it.
    // Also promotes due 'retrying' jobs (next_retry_at has elapsed).
    //
    // Phase 5.2: adds required_capability filter —
    //   (required_capability IS NULL)                          → any worker can claim
    //   OR ($capJson::jsonb ? required_capability)             → worker has the capability
    const rawResult = await tx.execute(sql`
      SELECT * FROM ai_jobs
      WHERE (
        (status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= NOW()))
        OR
        (status = 'retrying' AND next_retry_at IS NOT NULL AND next_retry_at <= NOW())
      )
      AND (
        required_capability IS NULL
        OR ${capJson}::jsonb ? required_capability
      )
      ORDER BY priority_score DESC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const rows = (rawResult as unknown as { rows: Record<string, unknown>[] }).rows ?? [];
    const [job] = rows;

    if (!job) return null;

    const jobRow = job as unknown as AiJob;

    // Claim: accepts both 'queued' and 'retrying'
    const [claimed] = await tx
      .update(aiJobsTable)
      .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(aiJobsTable.id, jobRow.id),
          inArray(aiJobsTable.status, ["queued", "retrying"]),
        ),
      )
      .returning();

    if (!claimed) {
      // Race condition — another worker won; return null
      return null;
    }

    // Update worker occupancy
    await tx
      .update(aiWorkersTable)
      .set({
        status:        "busy",
        currentJob:    claimed.id,
        runningJobs:   sql`running_jobs + 1`,
        lastHeartbeat: new Date(),
        updatedAt:     new Date(),
      })
      .where(eq(aiWorkersTable.id, workerId));

    return claimed;
  });
}

/**
 * Dispatch a running job to the appropriate handler.
 * Extend this switch to add new job types as the platform grows.
 */
export async function executeJob(job: AiJob, workerId: number): Promise<Record<string, unknown>> {
  // WP-06 — Build a RequestContext for this job so downstream handlers have
  // a structured, tenant-scoped identity without DB round-trips.
  const workerCtx = buildWorkerContext(job);
  process.stdout.write(`###EXECJOB### jobId=${job.id} jobType=${JSON.stringify(job.jobType)} typeof=${typeof job.jobType}\n`);
  logger.info(
    { jobId: job.id, jobType: job.jobType, tenantId: workerCtx.tenantId, actorType: workerCtx.actorType },
    "[executeJob] dispatching",
  );
  switch (job.jobType) {
    case "llm_inference":
      return executeTextJob(job, "LLM inference");

    case "creative_brief":
      return executeTextJob(job, "Creative brief workflow");

    case "creative_text":
      return executeTextJob(job, "Creative text generation");

    case "qc_review":
      return executeTextJob(job, "QC review");

    case "image_generation":
      return executeImageJob(job);

    case "image_qc":
      throw new WorkerNotImplementedError("image_qc");

    // ── Sprint P2.1.1 — background asset lifecycle jobs ──────────────────────
    case "archive_asset":
      return executeArchiveAssetJob(job);

    case "optimize_asset":
      return executeOptimizeAssetJob(job);

    case "generate_thumbnail":
      return executeGenerateThumbnailJob(job);

    case "pdf_export": {
      const pdfProjectId = (job.payloadJson as { projectId?: number } | null)?.projectId;
      const [pdfProject] = typeof pdfProjectId === "number"
        ? await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, pdfProjectId))
        : [];
      const documentType = pdfProject ? await resolveProjectDocumentType(pdfProject) : null;
      if (documentType && getSupportedDocumentTypes().includes(documentType)) {
        return executeGenericPdfExportJob(job, documentType);
      }
      throw new WorkerNotImplementedError(`pdf_export for document type '${documentType ?? "unknown"}'`);
    }

    case "pptx_export": {
      const pptxProjectId = (job.payloadJson as { projectId?: number } | null)?.projectId;
      const [pptxProject] = typeof pptxProjectId === "number"
        ? await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, pptxProjectId))
        : [];
      const presentationType = pptxProject ? await resolveProjectPresentationType(pptxProject) : null;
      if (presentationType && getSupportedPresentationTypes().includes(presentationType)) {
        return executeGenericPresentationExportJob(job, presentationType);
      }
      throw new WorkerNotImplementedError(`pptx_export for presentation type '${presentationType ?? "unknown"}'`);
    }

    case "image_batch_export": {
      const batchProjectId = (job.payloadJson as { projectId?: number } | null)?.projectId;
      const [batchProject] = typeof batchProjectId === "number"
        ? await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, batchProjectId))
        : [];
      const batchType = batchProject ? await resolveProjectImageBatchType(batchProject) : null;
      if (batchType && getSupportedImageBatchTypes().includes(batchType)) {
        return executeGenericImageBatchExportJob(job, batchType);
      }
      throw new WorkerNotImplementedError(`image_batch_export for batch type '${batchType ?? "unknown"}'`);
    }

    case "generate_project_zip": {
      const zipPayload = job.payloadJson as { projectId?: string; deliveryId?: number } | null;
      const zipProjectId = zipPayload?.projectId ?? "";
      const zipDeliveryId = zipPayload?.deliveryId ?? 0;
      if (!zipProjectId || !zipDeliveryId) {
        throw new WorkerNotImplementedError("generate_project_zip: missing projectId or deliveryId in payload");
      }
      const zipResult = await executeZipDeliveryJob(zipDeliveryId, zipProjectId);
      if (!zipResult.ok) {
        // Non-fatal: log but don't throw — project stays completed
        logger.warn({ jobId: job.id, zipProjectId, error: zipResult.error }, "[executeJob] ZIP generation failed (non-fatal)");
      }
      return { message: "ZIP delivery job executed", projectId: zipProjectId, deliveryId: zipDeliveryId, ok: zipResult.ok };
    }

    case "csv_export":
      throw new WorkerNotImplementedError("csv_export");

    case "analytics":
      throw new WorkerNotImplementedError("analytics");

    case "cleanup":
      throw new WorkerNotImplementedError("cleanup");

    case "noop":
      // Used for seed / testing
      return { message: "No-op job executed", jobId: job.id };

    case "design_render": {
      const { executeDesignRenderJob } = await import("./designRenderWorkerService.js");
      return executeDesignRenderJob(job, workerId);
    }

    case "design_render_batch_dispatch": {
      const { executeDesignRenderBatchDispatch } = await import("./designRenderWorkerService.js");
      return executeDesignRenderBatchDispatch(job, workerId);
    }

    case "design_render_zip_export": {
      const { executeZipExportJob } = await import("./designZipExportService.js");
      const zipPayload = job.payloadJson as { exportId?: number; tenantId?: string; batchId?: number } | null;
      const zipExportId = zipPayload?.exportId;
      const zipTenantId = zipPayload?.tenantId;
      const zipBatchId = zipPayload?.batchId;
      if (!zipExportId || !zipTenantId || !zipBatchId) {
        throw new Error("design_render_zip_export: payload missing exportId, tenantId, or batchId");
      }
      return executeZipExportJob(zipExportId, zipTenantId, zipBatchId);
    }

    // ── Team 17: Universal Design Export Workspace ───────────────────────────
    case "export_workspace_job": {
      const { executeExportWorkspaceJob } = await import("./export-workspace/exportWorkspaceService.js");
      return executeExportWorkspaceJob(job);
    }

    default:
      return { message: `Job type '${job.jobType}' dispatched`, jobId: job.id };
  }
}

/**
 * Mark a job as completed and update worker metrics.
 */
export async function completeJob(
  jobId: number,
  workerId: number,
  result: Record<string, unknown>,
  actualCost?: number,
): Promise<AiJob> {
  const now = new Date();

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  const actualDuration = job?.startedAt
    ? now.getTime() - job.startedAt.getTime()
    : null;

  const [completed] = await db
    .update(aiJobsTable)
    .set({
      status:          "completed",
      completedAt:     now,
      resultJson:      result,
      actualCost:      actualCost != null ? String(actualCost) : null,
      actualDuration:  actualDuration,
      updatedAt:       now,
    })
    .where(eq(aiJobsTable.id, jobId))
    .returning();

  // Update worker — rolling latency average
  const [worker] = await db
    .select()
    .from(aiWorkersTable)
    .where(eq(aiWorkersTable.id, workerId));

  const prevAvg = worker?.averageLatency != null ? Number(worker.averageLatency) : null;
  const newAvg = prevAvg != null && actualDuration != null
    ? Math.round((prevAvg + actualDuration) / 2)
    : actualDuration;

  await db
    .update(aiWorkersTable)
    .set({
      status:          "idle",
      currentJob:      null,
      runningJobs:     sql`GREATEST(running_jobs - 1, 0)`,
      completedToday:  sql`completed_today + 1`,
      averageLatency:  newAvg != null ? String(newAvg) : null,
      lastHeartbeat:   now,
      updatedAt:       now,
    })
    .where(eq(aiWorkersTable.id, workerId));

  await logAudit("job-engine", "job_completed", String(jobId), "ai_job", "success", {
    actualDuration,
    actualCost,
    workerId,
  });

  publishSafe({
    eventType:    "job.completed",
    sourceModule: "job-engine",
    sourceId:     String(jobId),
    payload:      { jobId, workerId, jobCode: completed!.jobCode, jobType: completed!.jobType, actualDuration, actualCost },
  });

  return completed!;
}

/**
 * Schedule a retry or mark the job failed if max retries exceeded.
 */
export async function retryJob(
  jobId: number,
  workerId: number,
  errorMessage: string,
): Promise<AiJob> {
  const now = new Date();

  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(eq(aiJobsTable.id, jobId));

  if (!job) throw new Error(`Job ${jobId} not found`);

  const newRetryCount = job.retryCount + 1;
  const exhausted     = newRetryCount > job.maxRetry;

  let update: Parameters<typeof db.update<typeof aiJobsTable>>[0] extends infer T ? object : object;

  if (exhausted) {
    update = {
      status:       "failed",
      errorMessage,
      retryCount:   newRetryCount,
      completedAt:  now,
      updatedAt:    now,
    };

    if (job.jobType === "pdf_export") {
      const pdfProjectId = (job.payloadJson as { projectId?: number } | null)?.projectId;
      if (typeof pdfProjectId === "number") {
        const { markProjectDocumentFailed } = await import("./companyProfilePdfWorkerService.js");
        await markProjectDocumentFailed(pdfProjectId, errorMessage).catch((err) => {
          logger.warn({ err, pdfProjectId }, "[jobWorker] Failed to flag project as failed after exhausted pdf_export retries");
        });
      }
    }

    if (job.jobType === "image_batch_export") {
      const batchProjectId = (job.payloadJson as { projectId?: number } | null)?.projectId;
      if (typeof batchProjectId === "number") {
        const { markProjectImageBatchFailed } = await import("./image-batch/creativeImageBatchWorkerService.js");
        await markProjectImageBatchFailed(batchProjectId, errorMessage).catch((err) => {
          logger.warn({ err, batchProjectId }, "[jobWorker] Failed to flag project as failed after exhausted image_batch_export retries");
        });
      }
    }

    if (job.jobType === "pptx_export") {
      const pptxProjectId = (job.payloadJson as { projectId?: number } | null)?.projectId;
      if (typeof pptxProjectId === "number") {
        const { markProjectPresentationFailed } = await import("./presentation/creativePresentationWorkerService.js");
        await markProjectPresentationFailed(pptxProjectId, errorMessage).catch((err) => {
          logger.warn({ err, pptxProjectId }, "[jobWorker] Failed to flag project as failed after exhausted pptx_export retries");
        });
      }
    }
  } else {
    let nextRetryAt: Date | null = null;
    if (job.retryStrategy === "exponential") {
      nextRetryAt = new Date(now.getTime() + exponentialBackoffMs(newRetryCount - 1));
    } else if (job.retryStrategy === "immediate") {
      nextRetryAt = now;
    }
    // "manual" → stays in "retrying" with no nextRetryAt

    update = {
      status:       "retrying",
      errorMessage,
      retryCount:   newRetryCount,
      nextRetryAt:  nextRetryAt,
      startedAt:    null,
      updatedAt:    now,
    };
  }

  const [updated] = await db
    .update(aiJobsTable)
    .set(update as Parameters<typeof db.update>[0] extends infer T ? object : object)
    .where(eq(aiJobsTable.id, jobId))
    .returning();

  // Release worker
  await db
    .update(aiWorkersTable)
    .set({
      status:       "idle",
      currentJob:   null,
      runningJobs:  sql`GREATEST(running_jobs - 1, 0)`,
      failedToday:  sql`failed_today + 1`,
      lastHeartbeat: now,
      updatedAt:    now,
    })
    .where(eq(aiWorkersTable.id, workerId));

  await logAudit(
    "job-engine",
    exhausted ? "job_failed" : "job_retrying",
    String(jobId),
    "ai_job",
    exhausted ? "failure" : "success",
    { errorMessage, retryCount: newRetryCount, maxRetry: job.maxRetry, exhausted },
  );

  publishSafe({
    eventType:    exhausted ? "job.failed" : "job.retrying",
    sourceModule: "job-engine",
    sourceId:     String(jobId),
    payload:      { jobId, workerId, errorMessage, retryCount: newRetryCount, exhausted, jobCode: updated!.jobCode, jobType: updated!.jobType },
  });

  return updated!;
}

/**
 * Cancel a job (terminal state).
 */
export async function cancelJob(jobId: number, workerId?: number): Promise<AiJob> {
  const now = new Date();

  const [cancelled] = await db
    .update(aiJobsTable)
    .set({ status: "cancelled", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(aiJobsTable.id, jobId),
        inArray(aiJobsTable.status, ["queued", "waiting", "retrying", "running"]),
      ),
    )
    .returning();

  if (!cancelled) throw new Error(`Job ${jobId} cannot be cancelled in its current state`);

  // Release worker if the job was running
  if (workerId && cancelled.status === "cancelled") {
    await db
      .update(aiWorkersTable)
      .set({
        status:      "idle",
        currentJob:  null,
        runningJobs: sql`GREATEST(running_jobs - 1, 0)`,
        updatedAt:   now,
      })
      .where(eq(aiWorkersTable.id, workerId));
  }

  await logAudit("job-engine", "job_cancelled", String(jobId), "ai_job", "success", { workerId });

  publishSafe({
    eventType:    "job.failed",
    sourceModule: "job-engine",
    sourceId:     String(jobId),
    payload:      { jobId, workerId, reason: "cancelled", jobCode: cancelled.jobCode, jobType: cancelled.jobType },
  });

  return cancelled;
}

/**
 * Update a worker's last_heartbeat (called by heartbeat route).
 */
export async function heartbeat(workerId: number): Promise<AiWorker> {
  const now = new Date();

  const [worker] = await db
    .update(aiWorkersTable)
    .set({
      lastHeartbeat: now,
      status:        sql`CASE WHEN status = 'offline' THEN 'idle' ELSE status END`,
      updatedAt:     now,
    })
    .where(eq(aiWorkersTable.id, workerId))
    .returning();

  if (!worker) throw new Error(`Worker ${workerId} not found`);
  return worker;
}

/**
 * Release a running job back to queued (worker is aborting without completing).
 */
export async function releaseJob(jobId: number, workerId: number): Promise<AiJob> {
  const now = new Date();

  const [released] = await db
    .update(aiJobsTable)
    .set({ status: "queued", startedAt: null, updatedAt: now })
    .where(
      and(
        eq(aiJobsTable.id, jobId),
        eq(aiJobsTable.status, "running"),
      ),
    )
    .returning();

  if (!released) throw new Error(`Job ${jobId} is not running`);

  await db
    .update(aiWorkersTable)
    .set({
      status:       "idle",
      currentJob:   null,
      runningJobs:  sql`GREATEST(running_jobs - 1, 0)`,
      lastHeartbeat: now,
      updatedAt:    now,
    })
    .where(eq(aiWorkersTable.id, workerId));

  await logAudit("job-engine", "job_released", String(jobId), "ai_job", "success", { workerId });

  return released;
}
