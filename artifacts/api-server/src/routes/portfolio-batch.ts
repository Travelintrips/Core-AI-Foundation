/**
 * portfolio-batch.ts — Admin Portfolio Management (Sprint P2)
 *
 * Generation Batches:
 *   POST   /ai/portfolio/batch              — create batch
 *   GET    /ai/portfolio/batch              — list batches
 *   GET    /ai/portfolio/batch/:id          — batch detail
 *   POST   /ai/portfolio/batch/:id/start    — start batch
 *   POST   /ai/portfolio/batch/:id/cancel   — cancel running batch
 *
 * Review Queue:
 *   GET    /ai/portfolio/review-queue       — portfolios awaiting review
 *   POST   /ai/portfolio/portfolios/:id/approve — approve (set published)
 *   POST   /ai/portfolio/portfolios/:id/reject  — reject (set archived)
 *   PATCH  /ai/portfolio/portfolios/:id/publish-status — set arbitrary status
 *
 * Portfolio Permissions (project-to-portfolio):
 *   GET    /ai/portfolio/permissions        — list permissions
 *   POST   /ai/portfolio/permissions        — request permission for a project
 *   PATCH  /ai/portfolio/permissions/:id    — update status (approve/reject/revoke)
 *
 * All routes are admin-access (same auth level as existing /ai/ routes).
 */
import { Router } from "express";
import { eq, and, desc, or } from "drizzle-orm";
import {
  db,
  aiPortfolioGenerationBatchesTable,
  aiPortfolioPermissionsTable,
  aiServicePortfoliosTable,
  aiPortfolioAssetsTable,
  aiJobsTable,
  insertAiPortfolioGenerationBatchSchema,
  insertAiPortfolioPermissionSchema,
} from "@workspace/db";
import { sql, inArray } from "drizzle-orm";
import { logAudit } from "../services/aiAuditService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import {
  createGenerationBatch,
  startBatch,
  cancelBatch,
  approvePortfolio,
  rejectPortfolio,
  seedDemoPortfolios,
  checkPublicationGuard,
  PUBLICATION_MIN_ASSETS,
  PUBLICATION_MIN_QC,
  type BatchConfig,
} from "../services/demoPortfolioGeneratorService.js";

const LIFECYCLE_JOB_TYPES = ["archive_asset", "optimize_asset", "generate_thumbnail"] as const;

const router = Router();

function parseId(raw: string | undefined, res: import("express").Response): number | null {
  const id = parseInt(raw ?? "", 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return null; }
  return id;
}

// ── Generation Batches ────────────────────────────────────────────────────────

router.post("/ai/portfolio/batch", async (req, res): Promise<void> => {
  const {
    serviceId, industry, style, packageLevel = "standard",
    requestedCount = 3, maxCost, autoPublish = false, qcThreshold = 70, createdBy,
  } = req.body as BatchConfig;

  if (!industry || !style) { res.status(400).json({ error: "industry and style are required" }); return; }
  if (requestedCount < 1 || requestedCount > 10) { res.status(400).json({ error: "requestedCount must be 1–10" }); return; }

  const batch = await createGenerationBatch({ serviceId, industry, style, packageLevel, requestedCount, maxCost, autoPublish, qcThreshold, createdBy });
  res.status(201).json(batch);
});

router.get("/ai/portfolio/batch", async (req, res): Promise<void> => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  const rows = await db
    .select()
    .from(aiPortfolioGenerationBatchesTable)
    .orderBy(desc(aiPortfolioGenerationBatchesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

router.get("/ai/portfolio/batch/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const [row] = await db
    .select()
    .from(aiPortfolioGenerationBatchesTable)
    .where(eq(aiPortfolioGenerationBatchesTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Batch not found" }); return; }
  res.json(row);
});

router.post("/ai/portfolio/batch/:id/start", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    await startBatch(id);
    res.json({ ok: true, message: `Batch ${id} started` });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Failed to start batch" });
  }
});

router.post("/ai/portfolio/batch/:id/cancel", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await cancelBatch(id);
  res.json({ ok: true, message: `Batch ${id} cancelled` });
});

// ── Review Queue ──────────────────────────────────────────────────────────────

router.get("/ai/portfolio/review-queue", async (req, res): Promise<void> => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));

  // Portfolios in draft/review status (awaiting admin decision)
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(
      or(
        eq(aiServicePortfoliosTable.status, "draft"),
      ),
    )
    .orderBy(desc(aiServicePortfoliosTable.createdAt))
    .limit(limit);

  res.json(rows);
});

router.post("/ai/portfolio/portfolios/:id/reject", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const row = await rejectPortfolio(id, req.body?.reason as string | undefined);
    res.json(row);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
});

router.patch("/ai/portfolio/portfolios/:id/publish-status", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const { publishStatus } = req.body as { publishStatus?: string };
  const ALLOWED = ["draft", "review", "pending_archive", "published", "hidden", "archived", "needs_repair"] as const;
  if (!publishStatus || !ALLOWED.includes(publishStatus as typeof ALLOWED[number])) {
    res.status(400).json({ error: `publishStatus must be one of: ${ALLOWED.join(", ")}` });
    return;
  }

  // Sprint P3: setting published directly also requires the publication guard
  if (publishStatus === "published") {
    const guard = await checkPublicationGuard(id);
    if (!guard.ok) {
      res.status(409).json({ error: "Publication guard failed", reasons: guard.reasons });
      return;
    }
  }

  const newStatus = publishStatus === "published" ? "published" : publishStatus === "hidden" ? "hidden" : "draft";
  const [row] = await db
    .update(aiServicePortfoliosTable)
    .set({ publishStatus, status: newStatus, updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Portfolio not found" }); return; }
  await logAudit("portfolio-admin", "publish_status_changed", String(id), "ai_service_portfolio", "success", { publishStatus });
  res.json(row);
});

// Sprint P3: use 409 (conflict) for guard failures so the UI can distinguish them
router.post("/ai/portfolio/portfolios/:id/approve", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const row = await approvePortfolio(id, req.body?.approvedBy as string | undefined);
    res.json(row);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Not found";
    const isGuardFailure = msg.startsWith("Publication guard failed");
    res.status(isGuardFailure ? 409 : 404).json({ error: msg });
  }
});

// ── Sprint P3: Batch Cost Estimate ───────────────────────────────────────────

/**
 * Estimate cost, asset count, and storage for a batch BEFORE starting it.
 * MUST be registered before /batch/:id routes to avoid :id capturing "estimate".
 */
router.post("/ai/portfolio/batch/estimate", async (req, res): Promise<void> => {
  const { requestedCount = 1, industry = "generic" } = req.body as { requestedCount?: number; industry?: string };
  const count = Math.min(10, Math.max(1, parseInt(String(requestedCount), 10)));

  // Per-industry extra asset counts (mirrors INDUSTRY_EXTRA_ROLES in generator service)
  const INDUSTRY_EXTRAS: Record<string, number> = {
    coffee: 2, restaurant: 2, logistics: 3, mining: 3, trading: 3,
    palm_oil: 3, fashion: 2, medical: 3, property: 3, technology: 3,
  };
  const BASE_ASSETS = 6; // BASE_ASSET_ROLES.length
  const extraAssets = Math.min(INDUSTRY_EXTRAS[industry.toLowerCase()] ?? 0, 2); // capped by MAX_ASSETS_PER_PORTFOLIO
  const assetCount = BASE_ASSETS + extraAssets;

  const llmCostPerPortfolio = 0.022;       // 3 LLM steps × ~11K tokens × $0.002/1K
  const imageCostPerAsset = 0.015;         // Replicate FLUX per image
  const imageCostPerPortfolio = imageCostPerAsset * assetCount;
  const storageMbPerAsset = 1.5;           // ~1.5 MB WebP (optimized + thumb)
  const totalPerPortfolio = llmCostPerPortfolio + imageCostPerPortfolio;

  res.json({
    estimatedPortfolioCount: count,
    perPortfolio: {
      llmCostUsd: Number(llmCostPerPortfolio.toFixed(4)),
      imageCostUsd: Number(imageCostPerPortfolio.toFixed(4)),
      totalCostUsd: Number(totalPerPortfolio.toFixed(4)),
      assetCount,
      storageMb: Number((storageMbPerAsset * assetCount).toFixed(1)),
    },
    total: {
      minCostUsd: Number((totalPerPortfolio * count * 0.7).toFixed(4)),
      estimatedCostUsd: Number((totalPerPortfolio * count).toFixed(4)),
      maxCostUsd: Number((totalPerPortfolio * count * 1.5).toFixed(4)),
    },
    publishGuard: {
      minQcScore: PUBLICATION_MIN_QC,
      minAssets: PUBLICATION_MIN_ASSETS,
      replicateUrlsAllowed: false,
      coverImageRequired: true,
      trademarkRiskRequired: "low",
    },
    note: "Estimates only — actual cost depends on LLM token usage and image complexity.",
  });
});

// ── Sprint P3: Portfolio Audit & Repair ───────────────────────────────────────

/**
 * Audit published portfolios for broken or non-compliant entries.
 * Returns portfolios that fail the publication guard (wrong QC, Replicate URLs, etc.)
 */
router.get("/ai/portfolio/audit", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT
      p.id,
      p.title,
      p.publish_status,
      p.qc_score::text        AS qc_score,
      p.trademark_risk,
      p.cover_image,
      p.is_demo,
      COUNT(a.id)::int                                                              AS asset_count,
      COUNT(CASE WHEN a.status = 'archive_failed'               THEN 1 END)::int   AS failed_asset_count,
      COUNT(CASE WHEN a.preview_url LIKE '%replicate.delivery%' THEN 1 END)::int   AS replicate_url_count
    FROM ai_platform.ai_service_portfolios p
    LEFT JOIN ai_platform.ai_portfolio_assets a ON a.portfolio_id = p.id
    WHERE p.publish_status = 'published'
    GROUP BY p.id, p.title, p.publish_status, p.qc_score, p.trademark_risk, p.cover_image, p.is_demo
    HAVING (
      p.cover_image IS NULL
      OR p.cover_image LIKE '%replicate.delivery%'
      OR p.qc_score IS NULL
      OR p.qc_score::numeric < ${PUBLICATION_MIN_QC}
      OR p.trademark_risk != 'low'
      OR COUNT(a.id) < ${PUBLICATION_MIN_ASSETS}
      OR COUNT(CASE WHEN a.preview_url LIKE '%replicate.delivery%' THEN 1 END) > 0
    )
    ORDER BY p.created_at DESC
    LIMIT 200
  `);

  const broken = result.rows ?? [];
  res.json({ count: broken.length, minQcScore: PUBLICATION_MIN_QC, minAssets: PUBLICATION_MIN_ASSETS, broken });
});

/**
 * Bulk-mark broken published portfolios as needs_repair and remove from the
 * public gallery immediately. Safe to run repeatedly (idempotent).
 */
router.post("/ai/portfolio/audit/mark-needs-repair", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    WITH broken AS (
      SELECT p.id FROM ai_platform.ai_service_portfolios p
      LEFT JOIN ai_platform.ai_portfolio_assets a ON a.portfolio_id = p.id
      WHERE p.publish_status = 'published'
      GROUP BY p.id, p.cover_image, p.qc_score, p.trademark_risk
      HAVING (
        p.cover_image IS NULL
        OR p.cover_image LIKE '%replicate.delivery%'
        OR p.qc_score IS NULL
        OR p.qc_score::numeric < ${PUBLICATION_MIN_QC}
        OR p.trademark_risk != 'low'
        OR COUNT(a.id) < ${PUBLICATION_MIN_ASSETS}
        OR COUNT(CASE WHEN a.preview_url LIKE '%replicate.delivery%' THEN 1 END) > 0
      )
    )
    UPDATE ai_platform.ai_service_portfolios p
    SET publish_status = 'needs_repair', status = 'draft', updated_at = NOW()
    FROM broken WHERE p.id = broken.id
    RETURNING p.id
  `);

  const count = (result.rows ?? []).length;
  await logAudit("portfolio-admin", "bulk_needs_repair", "audit", "ai_service_portfolio", "success", { count });
  res.json({ ok: true, markedCount: count, message: `${count} portfolio(s) marked as needs_repair and removed from public gallery.` });
});

/**
 * Repair a single portfolio: re-generate all images using the existing brand concept,
 * upload to Supabase Storage. Portfolio is taken out of published state during repair.
 */
router.post("/ai/portfolio/portfolios/:id/repair", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  try {
    // Take portfolio out of published state before repairing
    await db.execute(sql`
      UPDATE ai_platform.ai_service_portfolios
      SET publish_status = 'review', status = 'draft', generation_status = 'generating', updated_at = NOW()
      WHERE id = ${id}
    `);
    const { regeneratePortfolioImages } = await import("../services/demoPortfolioGeneratorService.js");
    const result = await regeneratePortfolioImages(id);
    await logAudit("portfolio-admin", "portfolio_repaired", String(id), "ai_service_portfolio", "success", { count: result.count });
    res.json({ ok: true, ...result, message: `Repair queued for portfolio ${id}` });
  } catch (err) {
    req.log.error({ err }, "[portfolio-admin] repair portfolio failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to repair portfolio" });
  }
});

/**
 * Bulk repair: re-generate images for all portfolios in needs_repair status.
 * Requires explicit confirmation to prevent accidental bulk operations.
 * Safety cap: max 20 portfolios per call (fire-and-forget, runs in background).
 */
router.post("/ai/portfolio/repair-all", async (req, res): Promise<void> => {
  const { confirm } = req.body as { confirm?: boolean };
  if (!confirm) {
    res.status(400).json({ error: "Must confirm bulk repair by sending { \"confirm\": true }" });
    return;
  }

  const portfolios = await db
    .select({ id: aiServicePortfoliosTable.id })
    .from(aiServicePortfoliosTable)
    .where(sql`${aiServicePortfoliosTable.publishStatus} = 'needs_repair'`)
    .limit(20); // safety cap

  if (portfolios.length === 0) {
    res.json({ ok: true, triggered: 0, message: "No portfolios need repair" });
    return;
  }

  const { regeneratePortfolioImages } = await import("../services/demoPortfolioGeneratorService.js");

  let triggered = 0;
  for (const p of portfolios) {
    // Mark as generating before firing repair
    await db.execute(sql`
      UPDATE ai_platform.ai_service_portfolios
      SET publish_status = 'review', status = 'draft', generation_status = 'generating', updated_at = NOW()
      WHERE id = ${p.id}
    `);
    regeneratePortfolioImages(p.id).catch((err: unknown) => {
      console.error(`[portfolio-repair-all] portfolio ${p.id} repair failed:`, err);
    });
    triggered++;
  }

  await logAudit("portfolio-admin", "bulk_repair_triggered", "repair-all", "ai_service_portfolio", "success", { count: triggered });
  res.json({
    ok: true,
    triggered,
    message: `Repair triggered for ${triggered} portfolio(s). Monitor progress in the Archive Queue tab.`,
  });
});

// ── Asset Lifecycle / Background Archiving (Sprint P2.1.1) ─────────────────────

/**
 * Monitoring: archive-queue health. Counts by job type × job status, plus
 * per-asset lifecycle-stage counts and average archive duration.
 */
router.get("/ai/portfolio/archive-queue/stats", async (_req, res): Promise<void> => {
  const jobRows = await db
    .select({ jobType: aiJobsTable.jobType, status: aiJobsTable.status, count: sql<number>`count(*)::int` })
    .from(aiJobsTable)
    .where(inArray(aiJobsTable.jobType, [...LIFECYCLE_JOB_TYPES]))
    .groupBy(aiJobsTable.jobType, aiJobsTable.status);

  const assetStatusRows = await db
    .select({ status: aiPortfolioAssetsTable.status, count: sql<number>`count(*)::int` })
    .from(aiPortfolioAssetsTable)
    .groupBy(aiPortfolioAssetsTable.status);

  const [avgDuration] = await db
    .select({
      avgSeconds: sql<number>`avg(extract(epoch from (archive_completed_at - archive_started_at)))::float`,
    })
    .from(aiPortfolioAssetsTable)
    .where(sql`${aiPortfolioAssetsTable.archiveCompletedAt} IS NOT NULL AND ${aiPortfolioAssetsTable.archiveStartedAt} IS NOT NULL`);

  const byJobType: Record<string, Record<string, number>> = {};
  for (const r of jobRows) {
    byJobType[r.jobType] ??= {};
    byJobType[r.jobType]![r.status] = r.count;
  }

  const byAssetStatus: Record<string, number> = {};
  for (const r of assetStatusRows) byAssetStatus[r.status] = r.count;

  res.json({
    jobsByTypeAndStatus: byJobType,
    assetsByLifecycleStatus: byAssetStatus,
    avgArchiveDurationSeconds: avgDuration?.avgSeconds ?? null,
  });
});

/** List assets for a portfolio with full lifecycle detail (admin monitoring). */
router.get("/ai/portfolio/portfolios/:id/assets", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const rows = await db
    .select()
    .from(aiPortfolioAssetsTable)
    .where(eq(aiPortfolioAssetsTable.portfolioId, id))
    .orderBy(aiPortfolioAssetsTable.displayOrder);
  res.json(rows);
});

/** Manually retry a failed archive/optimize/thumbnail stage for one asset. */
router.post("/ai/portfolio/assets/:id/retry-archive", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const [asset] = await db.select().from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.id, id)).limit(1);
  if (!asset) { res.status(404).json({ error: "Asset not found" }); return; }

  const [portfolio] = await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, asset.portfolioId)).limit(1);
  const brandSlug = (portfolio?.metadataJson as Record<string, unknown> | null)?.["brandSlug"] as string | undefined;
  if (!brandSlug) { res.status(500).json({ error: "Portfolio brandSlug missing — cannot retry" }); return; }

  if (asset.status === "archive_failed" || asset.archiveStatus === "failed") {
    await db.update(aiPortfolioAssetsTable)
      .set({ status: "generated", archiveStatus: "pending", archiveError: null })
      .where(eq(aiPortfolioAssetsTable.id, id));
    publishSafe({
      eventType: "asset.generated", sourceModule: "portfolio-admin", sourceId: String(id),
      payload: { portfolioAssetId: id, sourceUrl: asset.sourceUrl, brandSlug, role: asset.assetRole, portfolioId: asset.portfolioId },
    });
  } else if (asset.optimizationStatus === "failed" || asset.thumbnailStatus === "failed") {
    if (asset.optimizationStatus === "failed") {
      await db.update(aiPortfolioAssetsTable).set({ optimizationStatus: "pending" }).where(eq(aiPortfolioAssetsTable.id, id));
      publishSafe({ eventType: "asset.archived", sourceModule: "portfolio-admin", sourceId: String(id), payload: { portfolioAssetId: id, storagePath: asset.storagePath, brandSlug, role: asset.assetRole } });
    }
    if (asset.thumbnailStatus === "failed") {
      await db.update(aiPortfolioAssetsTable).set({ thumbnailStatus: "pending" }).where(eq(aiPortfolioAssetsTable.id, id));
      publishSafe({ eventType: "asset.archived", sourceModule: "portfolio-admin", sourceId: String(id), payload: { portfolioAssetId: id, storagePath: asset.storagePath, brandSlug, role: asset.assetRole } });
    }
  } else {
    res.status(409).json({ error: "Asset is not in a failed state — nothing to retry" });
    return;
  }

  await logAudit("portfolio-admin", "asset_archive_retry", String(id), "ai_portfolio_asset", "success", {});
  res.json({ ok: true, message: `Retry re-queued for asset ${id}` });
});

/**
 * Seed demo portfolios: wipe existing demos, then start 8 diverse generation
 * batches (coffee/minimalist … education/friendly). All autoPublish=true.
 * Images upload directly to Supabase — no expiring URLs.
 */
router.post("/ai/portfolio/seed-demos", async (req, res): Promise<void> => {
  try {
    const result = await seedDemoPortfolios();
    res.json({
      ok: true,
      message: `Cleaned up ${result.cleanedUp} old demo portfolio(s). Started ${result.batchIds.length} generation batches — portfolios will appear in ~5–10 min each.`,
      ...result,
    });
  } catch (err) {
    req.log?.error?.({ err }, "[portfolio-admin] seed-demos failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to seed demos" });
  }
});

/** Re-generate all images for a portfolio (reuses existing brand concept, uploads to Supabase). */
router.post("/ai/portfolio/portfolios/:id/regenerate-images", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const { regeneratePortfolioImages } = await import("../services/demoPortfolioGeneratorService.js");
    const result = await regeneratePortfolioImages(id);
    res.json({ ok: true, ...result });
  } catch (err) {
    req.log.error({ err }, "[portfolio-admin] regenerate-images failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to regenerate images" });
  }
});

// ── Portfolio Permissions ─────────────────────────────────────────────────────

router.get("/ai/portfolio/permissions", async (req, res): Promise<void> => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));
  const rows = await db
    .select()
    .from(aiPortfolioPermissionsTable)
    .orderBy(desc(aiPortfolioPermissionsTable.createdAt))
    .limit(limit);
  res.json(rows);
});

router.post("/ai/portfolio/permissions", async (req, res): Promise<void> => {
  const parsed = insertAiPortfolioPermissionSchema.safeParse({
    ...req.body,
    permissionStatus: "pending",
    requestedAt: new Date(),
  });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [row] = await db.insert(aiPortfolioPermissionsTable).values(parsed.data).returning();
  await logAudit("portfolio-permissions", "permission_requested", String(row!.id), "ai_portfolio_permission", "success", { projectId: row!.projectId });
  res.status(201).json(row);
});

router.patch("/ai/portfolio/permissions/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const { permissionStatus, notes, approvedBy } = req.body as {
    permissionStatus?: string;
    notes?: string;
    approvedBy?: string;
  };

  const ALLOWED = ["pending", "approved", "rejected", "revoked"] as const;
  if (!permissionStatus || !ALLOWED.includes(permissionStatus as typeof ALLOWED[number])) {
    res.status(400).json({ error: `permissionStatus must be one of: ${ALLOWED.join(", ")}` });
    return;
  }

  const now = new Date();
  const update: Record<string, unknown> = { permissionStatus, notes, approvedBy, updatedAt: now };
  if (permissionStatus === "approved") update["approvedAt"] = now;
  if (permissionStatus === "rejected") update["rejectedAt"] = now;

  const [row] = await db
    .update(aiPortfolioPermissionsTable)
    .set(update)
    .where(eq(aiPortfolioPermissionsTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Permission not found" }); return; }
  await logAudit("portfolio-permissions", `permission_${permissionStatus}`, String(id), "ai_portfolio_permission", "success", { approvedBy });
  res.json(row);
});

export default router;
