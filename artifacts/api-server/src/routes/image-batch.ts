/**
 * image-batch.ts — Phase 5 Creative Asset Batch Engine (internal/admin routes)
 *
 * Manual validation (no zod) — matches the convention already used by
 * customer-workspace.ts / quotations.ts for routes outside the api-zod
 * codegen contract. Mounted under the normal (admin-authenticated) prefix,
 * not /public — see middleware/adminAuth.ts.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, creativeProjectsTable, creativeAiAssetsTable } from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import { enqueue } from "../services/queueManagerService.js";
import { resolveProjectImageBatchType } from "../services/creativeProjectImageBatchType.js";
import { getImageBatchDefinition, getSupportedImageBatchTypes } from "../services/image-batch/creativeImageBatchRegistry.js";
import { resolveBatchEntitlement } from "../services/image-batch/imageBatchEntitlementService.js";
import { listBatchAssets, groupAssetsForGallery } from "../services/image-batch/imageBatchAssetService.js";

const router = Router();

async function loadProjectAndBatchType(projectId: string) {
  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, projectId));
  if (!project) return { project: null, batchType: null };
  const batchType = await resolveProjectImageBatchType(project);
  return { project, batchType };
}

/** POST /creative-ai/projects/:id/image-batch/generate — enqueue (or re-enqueue) the batch export job */
router.post("/creative-ai/projects/:id/image-batch/generate", async (req, res): Promise<void> => {
  const projectId = String((req.params as { id: string }).id);
  const { project, batchType } = await loadProjectAndBatchType(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!batchType || !getSupportedImageBatchTypes().includes(batchType)) {
    res.status(422).json({ error: "This project does not map to a supported image batch type" });
    return;
  }

  const job = await enqueue({
    jobType: "image_batch_export",
    payloadJson: { projectId: project.id, batchType },
    priority: 60,
  });

  await logAudit("image-batch-engine", "batch_export_enqueued", project.projectId, "creative_project", "success", {
    batchType, jobId: job.id,
  }).catch(() => {});

  res.status(202).json({ message: "Image batch generation started", batchType, jobId: job.id });
});

/** GET /creative-ai/projects/:id/image-batch — grouped status for the admin production monitor */
router.get("/creative-ai/projects/:id/image-batch", async (req, res): Promise<void> => {
  const projectId = String((req.params as { id: string }).id);
  const { project, batchType } = await loadProjectAndBatchType(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!batchType) {
    res.status(422).json({ error: "This project does not map to a supported image batch type" });
    return;
  }

  const definition = getImageBatchDefinition(batchType);
  if (!definition) {
    res.status(422).json({ error: `No registered definition for batch type '${batchType}'` });
    return;
  }

  const entitlement = await resolveBatchEntitlement(project, batchType, definition.catalogFallback);
  const assets = await listBatchAssets(project.projectId, batchType);
  const groups = groupAssetsForGallery(assets);

  const [zipAsset] = (
    await db.select().from(creativeAiAssetsTable).where(eq(creativeAiAssetsTable.projectId, project.projectId))
  ).filter((a) => a.assetType === "archive" && a.category === `${batchType}_zip`);

  res.json({
    batchType,
    entitlement,
    groups: groups.map((g) => ({
      group: g.group,
      groupLabel: g.groupLabel,
      items: g.items.map((a) => {
        const meta = (a.metadata ?? {}) as Record<string, unknown>;
        return {
          id: a.id,
          status: a.status,
          imageUrl: a.imageUrl,
          qcScore: a.qcScore,
          qcNotes: a.qcNotes,
          cost: a.cost,
          itemKey: meta["itemKey"],
          itemStatus: meta["itemStatus"],
          duplicateScore: meta["duplicateScore"],
          duplicateOfItemKey: meta["duplicateOfItemKey"],
        };
      }),
    })),
    zip: zipAsset ? { id: zipAsset.id, imageUrl: zipAsset.imageUrl, status: zipAsset.status } : null,
  });
});

/** POST /creative-ai/projects/:id/image-batch/items/:itemKey/retry — clear one item and re-enqueue */
router.post("/creative-ai/projects/:id/image-batch/items/:itemKey/retry", async (req, res): Promise<void> => {
  const projectId = String((req.params as { id: string }).id);
  const itemKey = String((req.params as { itemKey: string }).itemKey);
  const { project, batchType } = await loadProjectAndBatchType(projectId);
  if (!project || !batchType) {
    res.status(404).json({ error: "Project or batch type not found" });
    return;
  }

  const assets = await listBatchAssets(project.projectId, batchType);
  const target = assets.find((a) => ((a.metadata ?? {}) as Record<string, unknown>)["itemKey"] === itemKey);
  if (!target) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  // Mark it as pending so the worker regenerates it; the ZIP asset is left
  // alone (it will be rebuilt once the item completes and the job re-runs).
  await db.update(creativeAiAssetsTable).set({ status: "pending" }).where(eq(creativeAiAssetsTable.id, target.id));

  const job = await enqueue({
    jobType: "image_batch_export",
    payloadJson: { projectId: project.id, batchType },
    priority: 70,
  });

  await logAudit("image-batch-engine", "batch_item_retry", project.projectId, "creative_project", "success", {
    batchType, itemKey, jobId: job.id,
  }).catch(() => {});

  res.status(202).json({ message: `Retry started for item '${itemKey}'`, jobId: job.id });
});

/** POST /creative-ai/projects/:id/image-batch/rebuild-zip — force a fresh ZIP even if items unchanged */
router.post("/creative-ai/projects/:id/image-batch/rebuild-zip", async (req, res): Promise<void> => {
  const projectId = String((req.params as { id: string }).id);
  const { project, batchType } = await loadProjectAndBatchType(projectId);
  if (!project || !batchType) {
    res.status(404).json({ error: "Project or batch type not found" });
    return;
  }

  await db
    .update(creativeAiAssetsTable)
    .set({ status: "pending" })
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, project.projectId),
        eq(creativeAiAssetsTable.assetType, "archive"),
        eq(creativeAiAssetsTable.category, `${batchType}_zip`),
      ),
    );

  const job = await enqueue({
    jobType: "image_batch_export",
    payloadJson: { projectId: project.id, batchType },
    priority: 70,
  });

  res.status(202).json({ message: "ZIP rebuild started", jobId: job.id });
});

export default router;
