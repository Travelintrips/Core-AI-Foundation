/**
 * portfolio-public.ts — Public (no-auth) Portfolio API
 *
 * GET  /api/public/portfolio            — paginated list with filters
 * GET  /api/public/portfolio/filters    — available filter options
 * GET  /api/public/portfolio/:slug      — portfolio detail by slug or id
 * POST /api/public/portfolio/:id/view   — increment view counter
 * POST /api/public/portfolio/:id/click  — increment click counter
 * GET  /api/public/portfolio/:id/related — related portfolio recommendations
 *
 * Security:
 *  - No auth required (fully public)
 *  - storage_path / qcScore / trademarkRisk / internalMetadata NEVER returned
 *  - Pagination bounded to max 50 items
 */
import { Router } from "express";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import {
  db,
  aiServicePortfoliosTable,
  aiServicesTable,
  type AiServicePortfolio,
} from "@workspace/db";
import { publishSafe } from "../services/aiEventBusService.js";
import { getPortfolioRecommendations } from "../services/portfolioRecommendationService.js";

const router = Router();

const SORT_OPTIONS = ["featured", "popular", "latest", "rating"] as const;
type SortOption = typeof SORT_OPTIONS[number];

// ── Public DTO — strips internal fields ──────────────────────────────────────

function toPublicDto(p: AiServicePortfolio) {
  const ext = p as Record<string, unknown>;
  return {
    id: p.id,
    serviceId: p.serviceId,
    slug: ext["slug"] ?? null,
    portfolioCode: ext["portfolioCode"] ?? null,
    title: p.title,
    shortDescription: ext["shortDescription"] ?? p.description ?? null,
    industry: p.industry,
    businessType: ext["businessType"] ?? null,
    style: p.style,
    colorTags: p.colorTags,
    primaryColor: ext["primaryColor"] ?? null,
    secondaryColor: ext["secondaryColor"] ?? null,
    businessSize: p.businessSize,
    packageLabel: p.packageLabel,
    packageLevel: ext["packageLevel"] ?? null,
    coverImage: p.coverImage,
    galleryJson: p.galleryJson,
    beforeImage: p.beforeImage,
    afterImage: p.afterImage,
    deliverablesJson: p.deliverablesJson,
    toolsUsedJson: p.toolsUsedJson,
    workflowJson: p.workflowJson,
    deliveryTime: p.deliveryTime,
    deliveryDays: ext["deliveryDays"] ?? null,
    rating: p.rating,
    views: p.views,
    totalClicks: ext["totalClicks"] ?? 0,
    completedProjects: p.completedProjects,
    featured: p.featured,
    isDemo: ext["isDemo"] ?? false,
    displayOrder: p.displayOrder,
    createdAt: p.createdAt,
    // NEVER return: storagePath, metadataJson, qcScore, trademarkRisk, tenantId, sourceProjectId
  };
}

// ── GET /api/public/portfolio ─────────────────────────────────────────────────

router.get("/public/portfolio", async (req, res): Promise<void> => {
  const industry = typeof req.query.industry === "string" ? req.query.industry : undefined;
  const style = typeof req.query.style === "string" ? req.query.style : undefined;
  const serviceId = req.query.serviceId ? parseInt(String(req.query.serviceId), 10) : undefined;
  const featured = req.query.featured === "true" ? true : req.query.featured === "false" ? false : undefined;

  const rawSort = String(req.query.sort ?? "featured");
  const sort: SortOption = (SORT_OPTIONS as readonly string[]).includes(rawSort)
    ? (rawSort as SortOption)
    : "featured";

  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10)));
  const offset = (page - 1) * pageSize;

  const conditions = [eq(aiServicePortfoliosTable.status, "published")];
  if (industry) conditions.push(eq(aiServicePortfoliosTable.industry, industry));
  if (style) conditions.push(eq(aiServicePortfoliosTable.style, style));
  if (serviceId && !Number.isNaN(serviceId)) conditions.push(eq(aiServicePortfoliosTable.serviceId, serviceId));
  if (featured !== undefined) conditions.push(eq(aiServicePortfoliosTable.featured, featured));

  const whereClause = and(...conditions);

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiServicePortfoliosTable)
    .where(whereClause);
  const total = countRow?.n ?? 0;

  // Build order
  let rows: AiServicePortfolio[];
  if (sort === "popular") {
    rows = await db.select().from(aiServicePortfoliosTable).where(whereClause).orderBy(desc(aiServicePortfoliosTable.views)).limit(pageSize).offset(offset);
  } else if (sort === "latest") {
    rows = await db.select().from(aiServicePortfoliosTable).where(whereClause).orderBy(desc(aiServicePortfoliosTable.createdAt)).limit(pageSize).offset(offset);
  } else if (sort === "rating") {
    rows = await db.select().from(aiServicePortfoliosTable).where(whereClause).orderBy(desc(aiServicePortfoliosTable.rating)).limit(pageSize).offset(offset);
  } else {
    // featured: featured first, then displayOrder asc, then views desc
    rows = await db.select().from(aiServicePortfoliosTable).where(whereClause)
      .orderBy(desc(aiServicePortfoliosTable.featured), asc(aiServicePortfoliosTable.displayOrder), desc(aiServicePortfoliosTable.views))
      .limit(pageSize).offset(offset);
  }

  res.json({
    items: rows.map(toPublicDto),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

// ── GET /api/public/portfolio/filters ─────────────────────────────────────────
// MUST be registered BEFORE /:slug to avoid /filters being caught as slug

router.get("/public/portfolio/filters", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.status, "published"));

  const industries = [...new Set(rows.map((r) => r.industry))].sort();
  const styles = [...new Set(rows.map((r) => r.style))].sort();
  const serviceIds = [...new Set(rows.map((r) => r.serviceId))];
  const allServices = serviceIds.length
    ? await db.select().from(aiServicesTable).where(inArray(aiServicesTable.id, serviceIds))
    : [];
  const services = allServices.map((s) => ({ id: s.id, name: s.name, serviceCode: (s as Record<string, unknown>)["serviceCode"] ?? null }));

  res.json({ industries, styles, services });
});

// ── GET /api/public/portfolio/:slug ───────────────────────────────────────────

router.get("/public/portfolio/:slug", async (req, res): Promise<void> => {
  const slug = req.params.slug;
  if (!slug) { res.status(400).json({ error: "slug required" }); return; }

  // Fetch all published, find by slug or numeric id
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.status, "published"))
    .limit(200);

  const numericId = parseInt(slug, 10);
  const row = rows.find((r) => (r as Record<string, unknown>)["slug"] === slug)
    ?? (Number.isFinite(numericId) ? rows.find((r) => r.id === numericId) : undefined);

  if (!row) { res.status(404).json({ error: "Portfolio not found" }); return; }

  const [service] = await db
    .select({ id: aiServicesTable.id, name: aiServicesTable.name, serviceCode: aiServicesTable.serviceCode })
    .from(aiServicesTable).where(eq(aiServicesTable.id, row.serviceId)).limit(1);

  res.json({ ...toPublicDto(row), service });
});

// ── POST /api/public/portfolio/:id/view ──────────────────────────────────────

router.post("/public/portfolio/:id/view", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .update(aiServicePortfoliosTable)
    .set({ views: sql`${aiServicePortfoliosTable.views} + 1` })
    .where(and(eq(aiServicePortfoliosTable.id, id), eq(aiServicePortfoliosTable.status, "published")))
    .returning({ views: aiServicePortfoliosTable.views });

  if (!row) { res.status(404).json({ error: "Portfolio not found" }); return; }

  await publishSafe({ eventType: "portfolio.viewed", sourceModule: "portfolio-public", sourceId: String(id), payload: { portfolioId: id } });
  res.json({ views: row.views });
});

// ── POST /api/public/portfolio/:id/click ─────────────────────────────────────

router.post("/public/portfolio/:id/click", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // totalClicks is a new column — use raw SQL increment to avoid TS type issue
  await db.execute(sql`UPDATE ai_service_portfolios SET total_clicks = COALESCE(total_clicks,0) + 1, updated_at = NOW() WHERE id = ${id}`);

  await publishSafe({ eventType: "portfolio.cta_clicked", sourceModule: "portfolio-public", sourceId: String(id), payload: { portfolioId: id } });
  res.json({ ok: true });
});

// ── GET /api/public/portfolio/:id/related ────────────────────────────────────

router.get("/public/portfolio/:id/related", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const limit = Math.min(12, Math.max(1, parseInt(String(req.query.limit ?? "6"), 10)));
  const recommendations = await getPortfolioRecommendations({ viewedPortfolioId: id, limit });
  res.json(recommendations.map(toPublicDto));
});

export default router;
