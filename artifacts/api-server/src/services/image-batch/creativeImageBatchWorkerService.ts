/**
 * creativeImageBatchWorkerService.ts — Phase 5 Creative Asset Batch Engine
 *
 * Generic orchestrator that handles ALL image-batch-producing services via
 * an ImageBatchDefinition registry (mirrors creativeDocumentWorkerService.ts
 * for pdf_export). Reuses imageDesignerService.generateNamedAssetSet for the
 * actual provider call / overlay / QC / persistence — this file only adds
 * batch semantics on top: entitlement resolution, per-item duplicate
 * detection + technical validation, batch completion validation, and ZIP
 * export.
 *
 * Pipeline for job type `image_batch_export`:
 *   1. Load creative project + resolve ImageBatchDefinition
 *   2. Resolve real entitlement (snapshot -> package limits -> catalog fallback)
 *   3. Build item specs from entitlement (buildItems)
 *   4. Skip items already completed (idempotent retry); generate the rest
 *      via generateNamedAssetSet
 *   5. Per generated item: technical validation (dimensions/buffer) +
 *      perceptual duplicate check against already-accepted items; one
 *      regeneration attempt if rejected as a true duplicate
 *   6. Persist each item as a creative_ai_assets row
 *   7. validateBatch() — every required group must have a completed item or
 *      the job throws (caller/dispatcher will retry; after retries are
 *      exhausted the project is flagged failed, mirroring pdf/pptx workers)
 *   8. Build + upload the ZIP export, persist as an "archive" asset
 *
 * Error codes: BATCH_DEFINITION_NOT_FOUND, BATCH_INCOMPLETE, BATCH_ZIP_FAILED
 */

import { eq } from "drizzle-orm";
import { db, creativeProjectsTable, creativeAiAssetsTable, type AiJob, type CreativeProject } from "@workspace/db";
import { logAudit } from "../aiAuditService.js";
import { logger } from "../../lib/logger.js";
import { WorkerNotImplementedError } from "../jobCompletionGuard.js";
import { generateNamedAssetSet, type NamedAssetRole } from "../imageDesignerService.js";
import { uploadToSupabase, getSupabasePublicUrl, storageObjectExists } from "../../lib/supabaseStorage.js";
import { getImageBatchDefinition } from "./creativeImageBatchRegistry.js";
import { resolveBatchEntitlement } from "./imageBatchEntitlementService.js";
import { computePerceptualHash, checkAgainstExisting } from "./imageDuplicateDetectionService.js";
import { persistBatchItem, persistBatchZip, listBatchAssets } from "./imageBatchAssetService.js";
import { buildBatchZip } from "./imageBatchExportService.js";
import type { GeneratedImageBatchItem, ImageBatchType, BatchEntitlement, ImageBatchItemSpec } from "./imageBatchTypes.js";

export class ImageBatchWorkerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ImageBatchWorkerError";
  }
}

interface ImageBatchExportPayload {
  projectId?: number;
  batchType?: string;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** Minimal technical validation: buffer non-empty and image-decodable. */
async function validateTechnical(buffer: Buffer): Promise<boolean> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buffer).metadata();
    return !!(meta.width && meta.height && meta.width > 0 && meta.height > 0);
  } catch {
    return false;
  }
}

async function releaseProjectIfWaiting(project: CreativeProject): Promise<void> {
  if (project.status === "generating_document" || project.status === "generating") {
    await db.update(creativeProjectsTable).set({ status: "completed" }).where(eq(creativeProjectsTable.id, project.id));
  }
}

/** Flag a project as failed after exhausted retries — mirrors the pdf/pptx worker pattern. */
export async function markProjectImageBatchFailed(projectDbId: number, errorMessage: string): Promise<void> {
  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, projectDbId));
  if (!project) return;
  await logAudit("image-batch-engine", "batch_export_failed", project.projectId, "creative_project", "failure", {
    error: errorMessage,
  }).catch(() => {});
}

async function generateBatchItems(
  brief: Record<string, unknown>,
  specs: ImageBatchItemSpec[],
  storagePathPrefix: string,
  existingHashes: Array<{ itemKey: string; hash: string }>,
): Promise<GeneratedImageBatchItem[]> {
  const roles: NamedAssetRole[] = specs.map((s) => s.role);
  const generated = await generateNamedAssetSet(brief, roles, { storagePathPrefix });

  const results: GeneratedImageBatchItem[] = [];
  const localHashes = [...existingHashes];

  for (let i = 0; i < generated.length; i++) {
    const asset = generated[i]!;
    const spec = specs[i]!;

    if (asset.status !== "completed" || !asset.imageUrl) {
      results.push({ ...asset, itemKey: spec.itemKey, group: spec.group, groupLabel: spec.groupLabel, platform: spec.platform, itemStatus: "failed" });
      continue;
    }

    const buffer = await fetchBuffer(asset.imageUrl);
    if (!buffer || !(await validateTechnical(buffer))) {
      results.push({
        ...asset, itemKey: spec.itemKey, group: spec.group, groupLabel: spec.groupLabel, platform: spec.platform,
        itemStatus: "failed", qcNotes: `${asset.qcNotes} (technical validation failed: unreadable image buffer)`,
      });
      continue;
    }

    const hash = await computePerceptualHash(buffer);
    const dup = checkAgainstExisting(hash, localHashes);

    if (dup.isDuplicate) {
      // One regeneration attempt for this single item before accepting/rejecting.
      const retryGen = await generateNamedAssetSet(brief, [spec.role], { storagePathPrefix, maxQualityRetryPerAsset: 0 });
      const retryAsset = retryGen[0];
      const retryBuffer = retryAsset?.imageUrl ? await fetchBuffer(retryAsset.imageUrl) : null;
      const retryHash = retryBuffer ? await computePerceptualHash(retryBuffer) : null;
      const retryDup = retryHash ? checkAgainstExisting(retryHash, localHashes) : null;

      if (retryAsset?.status === "completed" && retryAsset.imageUrl && retryHash && retryDup && !retryDup.isDuplicate) {
        localHashes.push({ itemKey: spec.itemKey, hash: retryHash });
        results.push({
          ...retryAsset, itemKey: spec.itemKey, group: spec.group, groupLabel: spec.groupLabel, platform: spec.platform,
          itemStatus: "completed", perceptualHash: retryHash, duplicateScore: retryDup.maxSimilarity, duplicateOfItemKey: retryDup.matchedItemKey ?? undefined,
        });
      } else {
        results.push({
          ...asset, itemKey: spec.itemKey, group: spec.group, groupLabel: spec.groupLabel, platform: spec.platform,
          itemStatus: "duplicate_rejected", perceptualHash: hash, duplicateScore: dup.maxSimilarity, duplicateOfItemKey: dup.matchedItemKey ?? undefined,
          qcNotes: `${asset.qcNotes} (rejected: ${(dup.maxSimilarity * 100).toFixed(0)}% visually identical to ${dup.matchedItemKey})`,
        });
      }
      continue;
    }

    localHashes.push({ itemKey: spec.itemKey, hash });
    results.push({
      ...asset, itemKey: spec.itemKey, group: spec.group, groupLabel: spec.groupLabel, platform: spec.platform,
      itemStatus: "completed", perceptualHash: hash,
      duplicateScore: dup.isNearDuplicate ? dup.maxSimilarity : undefined,
      duplicateOfItemKey: dup.isNearDuplicate ? (dup.matchedItemKey ?? undefined) : undefined,
    });
  }

  return results;
}

export async function executeGenericImageBatchExportJob(
  job: AiJob,
  batchType: ImageBatchType,
): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson ?? {}) as ImageBatchExportPayload;
  const projectDbId = payload.projectId;
  if (typeof projectDbId !== "number") {
    throw new Error("image_batch_export job payload is missing a numeric 'projectId'");
  }

  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, projectDbId));
  if (!project) throw new Error(`image_batch_export: creative project ${projectDbId} not found`);

  const definition = getImageBatchDefinition(batchType);
  if (!definition) {
    throw new WorkerNotImplementedError(`image_batch_export for batch type '${batchType}' (no registered definition)`);
  }

  // Idempotency: a completed ZIP for this project+batch already exists and is still reachable.
  const [existingZip] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, project.projectId));
  const zipCategory = `${batchType}_zip`;
  const existingZipAsset = (
    await db.select().from(creativeAiAssetsTable).where(eq(creativeAiAssetsTable.projectId, project.projectId))
  ).find((a) => a.assetType === "archive" && a.category === zipCategory && a.status === "completed");
  if (existingZipAsset?.storagePath && (await storageObjectExists(existingZipAsset.storagePath))) {
    await releaseProjectIfWaiting(project);
    const meta = (existingZipAsset.metadata ?? {}) as Record<string, unknown>;
    return {
      jobId: job.id, assetId: existingZipAsset.id, projectId: project.projectId, batchType,
      storagePath: existingZipAsset.storagePath,
      permanentUrl: existingZipAsset.imageUrl ?? getSupabasePublicUrl(existingZipAsset.storagePath),
      itemCount: meta["itemCount"] ?? null, reused: true,
    };
  }
  void existingZip;

  const entitlement: BatchEntitlement = await resolveBatchEntitlement(project, batchType, definition.catalogFallback);
  const brief: Record<string, unknown> = {
    brandName: project.brandName,
    businessType: project.businessType,
    industry: project.businessType,
    stylePreference: project.stylePreference ?? "",
    colorPreference: project.colorPreference ?? "",
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    tagline: project.productOrService ?? project.goal ?? "",
  };
  const allSpecs = definition.buildItems(entitlement, brief);

  // Skip items already completed (idempotent partial regeneration on retry).
  const alreadyPersisted = await listBatchAssets(project.projectId, batchType);
  const alreadyCompletedKeys = new Set(
    alreadyPersisted
      .filter((a) => a.status === "completed")
      .map((a) => ((a.metadata ?? {}) as Record<string, unknown>)["itemKey"] as string),
  );
  const specsToGenerate = allSpecs.filter((s) => !alreadyCompletedKeys.has(s.itemKey));

  const existingHashes = alreadyPersisted
    .filter((a) => a.status === "completed")
    .map((a) => ({
      itemKey: ((a.metadata ?? {}) as Record<string, unknown>)["itemKey"] as string,
      hash: ((a.metadata ?? {}) as Record<string, unknown>)["perceptualHash"] as string,
    }))
    .filter((h) => !!h.hash);

  const newlyGenerated = specsToGenerate.length > 0
    ? await generateBatchItems(brief, specsToGenerate, `creative-assets/${project.projectId}/${batchType}`, existingHashes)
    : [];

  for (const item of newlyGenerated) {
    await persistBatchItem(project.projectId, batchType, entitlement.source, item);
  }

  const finalAssets = await listBatchAssets(project.projectId, batchType);
  const finalItems: GeneratedImageBatchItem[] = finalAssets.map((a) => {
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    return {
      role: "", label: "", prompt: a.prompt ?? "", imageUrl: a.imageUrl, status: a.status === "completed" ? "completed" : "failed",
      qcScore: Number(a.qcScore ?? 0), qcNotes: a.qcNotes ?? "", cost: Number(a.cost ?? 0), retries: 0,
      itemKey: meta["itemKey"] as string, group: meta["group"] as string, groupLabel: meta["groupLabel"] as string,
      platform: (meta["platform"] as string) ?? undefined, itemStatus: (meta["itemStatus"] as GeneratedImageBatchItem["itemStatus"]) ?? "failed",
    };
  });

  const validation = definition.validateBatch(finalItems, entitlement);
  if (!validation.ok) {
    throw new ImageBatchWorkerError(
      "BATCH_INCOMPLETE",
      `Image batch '${batchType}' for project ${project.projectId} is missing required groups: ${validation.missingGroups.join(", ")} ` +
        `(${validation.completedCount}/${validation.requiredCount} completed)`,
    );
  }

  // Build ZIP from the completed items — download final persisted bytes once more.
  const zipInputs: Array<{ item: GeneratedImageBatchItem; buffer: Buffer }> = [];
  for (const item of finalItems.filter((i) => i.itemStatus === "completed")) {
    const buffer = item.imageUrl ? await fetchBuffer(item.imageUrl) : null;
    if (buffer) zipInputs.push({ item, buffer });
  }

  if (zipInputs.length === 0) {
    throw new ImageBatchWorkerError("BATCH_ZIP_FAILED", `No downloadable completed items for project ${project.projectId} batch ${batchType}`);
  }

  const zipBuffer = await buildBatchZip(definition, { projectNumber: project.projectId, batchType, items: zipInputs });
  const storagePath = `creative-assets/${project.projectId}/${batchType}/export-${Date.now()}.zip`;
  const permanentUrl = await uploadToSupabase(storagePath, zipBuffer, "application/zip");
  if (!permanentUrl) {
    throw new ImageBatchWorkerError("BATCH_ZIP_FAILED", `Failed to upload ZIP export for project ${project.projectId} batch ${batchType}`);
  }

  const zipAsset = await persistBatchZip(project.projectId, batchType, storagePath, permanentUrl, zipInputs.length, zipBuffer.length);
  await releaseProjectIfWaiting(project);

  await logAudit("image-batch-engine", "batch_export_completed", project.projectId, "creative_project", "success", {
    batchType, itemCount: zipInputs.length, entitlementSource: entitlement.source,
  }).catch(() => {});

  return {
    jobId: job.id, assetId: zipAsset.id, projectId: project.projectId, batchType,
    storagePath, permanentUrl, itemCount: zipInputs.length, entitlementSource: entitlement.source,
  };
}
