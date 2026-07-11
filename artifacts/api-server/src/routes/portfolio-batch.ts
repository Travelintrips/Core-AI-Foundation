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
  insertAiPortfolioGenerationBatchSchema,
  insertAiPortfolioPermissionSchema,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import {
  createGenerationBatch,
  startBatch,
  cancelBatch,
  approvePortfolio,
  rejectPortfolio,
  type BatchConfig,
} from "../services/demoPortfolioGeneratorService.js";

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

router.post("/ai/portfolio/portfolios/:id/approve", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const row = await approvePortfolio(id, req.body?.approvedBy as string | undefined);
    res.json(row);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : "Not found" });
  }
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
  const ALLOWED = ["draft", "review", "published", "hidden", "archived"] as const;
  if (!publishStatus || !ALLOWED.includes(publishStatus as typeof ALLOWED[number])) {
    res.status(400).json({ error: `publishStatus must be one of: ${ALLOWED.join(", ")}` });
    return;
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
