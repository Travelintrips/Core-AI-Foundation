/**
 * portfolio.ts — Service Showcase: Portfolio, Reviews, FAQ & Live AI Preview
 *
 * Purely additive to the existing service-catalog. Never touches pricing
 * engine, queue/dispatcher, event bus internals, human tasks, client
 * review, marketplace, or the creative AI pipeline — it only reads from
 * ai_services for context and, on "continue", hands off to the existing
 * catalog request flow.
 *
 * GET  /ai/portfolio/services/:serviceId/showcase   (bundle: portfolios+reviews+faqs+related)
 * GET  /ai/portfolio/services/:serviceId/portfolios
 * POST /ai/portfolio/services/:serviceId/portfolios
 * PATCH/DEL /ai/portfolio/portfolios/:id
 * POST /ai/portfolio/portfolios/:id/view
 * GET/POST /ai/portfolio/services/:serviceId/reviews
 * PATCH/DEL /ai/portfolio/reviews/:id
 * GET/POST /ai/portfolio/services/:serviceId/faqs
 * PATCH/DEL /ai/portfolio/faqs/:id
 * POST /ai/portfolio/preview                 (start a live preview generation)
 * GET  /ai/portfolio/preview/:id             (poll status)
 * POST /ai/portfolio/preview/:id/continue    (seed concept into the request flow, no regeneration)
 * GET  /ai/portfolio/analytics               (funnel + top performers)
 */
import { Router } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  aiServicePortfoliosTable,
  portfolioReviewsTable,
  aiServiceFaqsTable,
  aiLivePreviewsTable,
  aiServicesTable,
  aiEventsTable,
  insertAiServicePortfolioSchema,
  insertPortfolioReviewSchema,
  insertAiServiceFaqSchema,
  insertAiLivePreviewSchema,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import {
  MAX_PREVIEWS_PER_SESSION,
  countPreviewsForSession,
  generateLivePreview,
} from "../services/livePreviewService.js";

const router = Router();

function parseId(raw: string | undefined, res: import("express").Response): number | null {
  const id = parseInt(raw ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

// ── Showcase bundle (one call for the whole service-detail page) ──────────────

router.get("/ai/portfolio/services/:serviceId/showcase", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;

  const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, serviceId)).limit(1);
  if (!service) { res.status(404).json({ error: "Service not found" }); return; }

  const [portfolios, reviews, faqs] = await Promise.all([
    db.select().from(aiServicePortfoliosTable)
      .where(and(eq(aiServicePortfoliosTable.serviceId, serviceId), eq(aiServicePortfoliosTable.status, "published")))
      .orderBy(desc(aiServicePortfoliosTable.featured), aiServicePortfoliosTable.displayOrder),
    db.select().from(portfolioReviewsTable)
      .where(and(eq(portfolioReviewsTable.serviceId, serviceId), eq(portfolioReviewsTable.status, "published")))
      .orderBy(desc(portfolioReviewsTable.featured), desc(portfolioReviewsTable.createdAt)),
    db.select().from(aiServiceFaqsTable)
      .where(and(eq(aiServiceFaqsTable.serviceId, serviceId), eq(aiServiceFaqsTable.status, "published")))
      .orderBy(aiServiceFaqsTable.displayOrder),
  ]);

  // Related services: same category, excluding this one
  const related = service.categoryId
    ? await db.select().from(aiServicesTable)
        .where(and(eq(aiServicesTable.categoryId, service.categoryId), eq(aiServicesTable.status, "active")))
        .limit(7)
    : [];

  const avgRating = reviews.length
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
    : null;

  res.json({
    service,
    portfolios,
    reviews,
    faqs,
    relatedServices: related.filter((s) => s.id !== serviceId).slice(0, 6),
    stats: {
      totalProjects: portfolios.reduce((sum, p) => sum + p.completedProjects, 0),
      avgRating,
      reviewCount: reviews.length,
    },
  });
});

// ── Portfolios ─────────────────────────────────────────────────────────────────

router.get("/ai/portfolio/services/:serviceId/portfolios", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;
  const rows = await db.select().from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.serviceId, serviceId))
    .orderBy(desc(aiServicePortfoliosTable.featured), aiServicePortfoliosTable.displayOrder);
  res.json(rows);
});

router.post("/ai/portfolio/services/:serviceId/portfolios", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;
  const parsed = insertAiServicePortfolioSchema.safeParse({ ...req.body, serviceId });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(aiServicePortfoliosTable).values(parsed.data).returning();
  await logAudit("portfolio", "create_portfolio", String(row.id), "ai_service_portfolio", "success", { title: row.title });
  res.status(201).json(row);
});

router.patch("/ai/portfolio/portfolios/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertAiServicePortfolioSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(aiServicePortfoliosTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiServicePortfoliosTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Portfolio not found" }); return; }
  await logAudit("portfolio", "update_portfolio", String(id), "ai_service_portfolio", "success", parsed.data);
  res.json(row);
});

router.delete("/ai/portfolio/portfolios/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, id));
  await logAudit("portfolio", "delete_portfolio", String(id), "ai_service_portfolio", "success");
  res.status(204).send();
});

router.post("/ai/portfolio/portfolios/:id/view", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const [row] = await db.update(aiServicePortfoliosTable)
    .set({ views: sql`${aiServicePortfoliosTable.views} + 1` })
    .where(eq(aiServicePortfoliosTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Portfolio not found" }); return; }
  await publishSafe({ eventType: "portfolio_view", sourceModule: "portfolio", sourceId: String(id), payload: { serviceId: row.serviceId } });
  res.json({ views: row.views });
});

// ── Reviews ────────────────────────────────────────────────────────────────────

router.get("/ai/portfolio/services/:serviceId/reviews", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;
  const rows = await db.select().from(portfolioReviewsTable)
    .where(eq(portfolioReviewsTable.serviceId, serviceId))
    .orderBy(desc(portfolioReviewsTable.featured), desc(portfolioReviewsTable.createdAt));
  res.json(rows);
});

router.post("/ai/portfolio/services/:serviceId/reviews", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;
  const parsed = insertPortfolioReviewSchema.safeParse({ ...req.body, serviceId });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(portfolioReviewsTable).values(parsed.data).returning();
  await logAudit("portfolio", "create_review", String(row.id), "portfolio_review", "success", { company: row.company });
  res.status(201).json(row);
});

router.patch("/ai/portfolio/reviews/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertPortfolioReviewSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(portfolioReviewsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(portfolioReviewsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Review not found" }); return; }
  res.json(row);
});

router.delete("/ai/portfolio/reviews/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(portfolioReviewsTable).where(eq(portfolioReviewsTable.id, id));
  res.status(204).send();
});

// ── FAQs ───────────────────────────────────────────────────────────────────────

router.get("/ai/portfolio/services/:serviceId/faqs", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;
  const rows = await db.select().from(aiServiceFaqsTable)
    .where(eq(aiServiceFaqsTable.serviceId, serviceId))
    .orderBy(aiServiceFaqsTable.displayOrder);
  res.json(rows);
});

router.post("/ai/portfolio/services/:serviceId/faqs", async (req, res): Promise<void> => {
  const serviceId = parseId(req.params.serviceId, res);
  if (serviceId === null) return;
  const parsed = insertAiServiceFaqSchema.safeParse({ ...req.body, serviceId });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(aiServiceFaqsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.patch("/ai/portfolio/faqs/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const parsed = insertAiServiceFaqSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(aiServiceFaqsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(aiServiceFaqsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "FAQ not found" }); return; }
  res.json(row);
});

router.delete("/ai/portfolio/faqs/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  await db.delete(aiServiceFaqsTable).where(eq(aiServiceFaqsTable.id, id));
  res.status(204).send();
});

// ── Live AI Preview ────────────────────────────────────────────────────────────

router.post("/ai/portfolio/preview", async (req, res): Promise<void> => {
  const parsed = insertAiLivePreviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const usedCount = await countPreviewsForSession(parsed.data.sessionId);
  if (usedCount >= MAX_PREVIEWS_PER_SESSION) {
    res.status(429).json({
      error: "Preview limit reached",
      message: `You've used your ${MAX_PREVIEWS_PER_SESSION} free AI previews. Continue with a concept above or contact us to start your project.`,
      limit: MAX_PREVIEWS_PER_SESSION,
      used: usedCount,
    });
    return;
  }

  const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, parsed.data.serviceId)).limit(1);
  if (!service) { res.status(404).json({ error: "Service not found" }); return; }

  const [row] = await db.insert(aiLivePreviewsTable).values(parsed.data).returning();
  await logAudit("live-preview", "preview_requested", String(row.id), "ai_live_preview", "success", { serviceId: row.serviceId });

  // Fire-and-forget: generate in the background, client polls GET /:id
  generateLivePreview(row.id, parsed.data).catch(() => {});

  res.status(202).json({ id: row.id, status: row.status, remaining: MAX_PREVIEWS_PER_SESSION - usedCount - 1 });
});

router.get("/ai/portfolio/preview/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const [row] = await db.select().from(aiLivePreviewsTable).where(eq(aiLivePreviewsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Preview not found" }); return; }
  res.json(row);
});

router.get("/ai/portfolio/preview/session/:sessionId/count", async (req, res): Promise<void> => {
  const used = await countPreviewsForSession(req.params.sessionId);
  res.json({ used, limit: MAX_PREVIEWS_PER_SESSION, remaining: Math.max(0, MAX_PREVIEWS_PER_SESSION - used) });
});

// "Continue With This Concept" — never regenerates. Just marks which concept
// was chosen and hands the exact stored concept + brief fields back to the
// client so it can seed the existing /ai/catalog request+brief flow.
router.post("/ai/portfolio/preview/:id/continue", async (req, res): Promise<void> => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const concept = req.body?.concept === "B" ? "B" : req.body?.concept === "A" ? "A" : null;
  if (!concept) { res.status(400).json({ error: "concept must be 'A' or 'B'" }); return; }

  const [row] = await db.select().from(aiLivePreviewsTable).where(eq(aiLivePreviewsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Preview not found" }); return; }
  if (row.status !== "ready") { res.status(409).json({ error: `Preview is not ready (status: ${row.status})` }); return; }

  const [updated] = await db.update(aiLivePreviewsTable)
    .set({ selectedConcept: concept, status: "converted", updatedAt: new Date() })
    .where(eq(aiLivePreviewsTable.id, id)).returning();

  await logAudit("live-preview", "preview_continued", String(id), "ai_live_preview", "success", { concept });
  await publishSafe({ eventType: "preview_to_checkout", sourceModule: "live-preview", sourceId: String(id), payload: { serviceId: row.serviceId, concept } });

  res.json({
    previewId: updated.id,
    serviceId: updated.serviceId,
    selectedConcept: concept,
    conceptData: concept === "A" ? updated.conceptA : updated.conceptB,
    seed: {
      brandName: updated.companyName,
      businessType: updated.industry,
      stylePreference: updated.style,
      notes: `Seeded from Live AI Preview (concept ${concept}): ${updated.shortDescription ?? ""}`.trim(),
    },
  });
});

// ── Analytics ──────────────────────────────────────────────────────────────────

router.get("/ai/portfolio/analytics", async (_req, res): Promise<void> => {
  const funnelEventTypes = ["portfolio_view", "preview_generated", "preview_to_checkout"];
  const eventCounts = await db
    .select({ eventType: aiEventsTable.eventType, n: sql<number>`count(*)::int` })
    .from(aiEventsTable)
    .where(inArray(aiEventsTable.eventType, funnelEventTypes))
    .groupBy(aiEventsTable.eventType);

  const countsByType: Record<string, number> = {};
  for (const row of eventCounts) countsByType[row.eventType] = row.n;

  const [previewStats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      converted: sql<number>`count(*) filter (where ${aiLivePreviewsTable.status} = 'converted')::int`,
      failed: sql<number>`count(*) filter (where ${aiLivePreviewsTable.status} = 'failed')::int`,
    })
    .from(aiLivePreviewsTable);

  const topPortfolios = await db
    .select()
    .from(aiServicePortfoliosTable)
    .orderBy(desc(aiServicePortfoliosTable.views))
    .limit(10);

  res.json({
    funnel: {
      portfolioViews: countsByType["portfolio_view"] ?? 0,
      previewsGenerated: countsByType["preview_generated"] ?? 0,
      previewToCheckout: countsByType["preview_to_checkout"] ?? 0,
    },
    previews: previewStats ?? { total: 0, converted: 0, failed: 0 },
    topPortfolios,
  });
});

export default router;
