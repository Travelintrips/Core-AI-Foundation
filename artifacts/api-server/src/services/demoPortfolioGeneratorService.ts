/**
 * demoPortfolioGeneratorService — AI-powered demo portfolio batch generation.
 *
 * Uses the existing AI OS (Brand Strategist / Creative Director / Copywriter via
 * intelligentRouter + executeAI, Image Designer + Image QC via imageDesignerService,
 * event bus, audit log) to produce fictional, safety-checked demo portfolios with
 * real generated assets.
 *
 * ALL demo portfolios:
 *   - use fictional brand names (not real companies), duplicate-name checked
 *   - are labeled "AI Demo Project"
 *   - carry trademark_risk scoring (high/medium risk → cannot auto-publish, goes to review)
 *   - require manual admin approval by default (autoPublish = false)
 *   - are subject to a max_cost budget guardrail per batch
 *   - have real generated assets (logo, palette, typography, mockup, social visuals,
 *     + industry-specific extras) stored in ai_portfolio_assets
 *
 * Does NOT create a new AI pipeline — reuses routeForAgent, executeAI,
 * aiEventBusService, aiAuditService, creativeAiService (Creative Director /
 * Copywriter prompt builders), and imageDesignerService's Replicate + QC primitives
 * via generateNamedAssetSet.
 */
import { eq, and, sql, ilike, inArray } from "drizzle-orm";
import {
  db,
  aiPortfolioGenerationBatchesTable,
  aiPortfolioAssetsTable,
  aiServicePortfoliosTable,
  aiServicesTable,
} from "@workspace/db";
import { routeForAgent } from "./intelligentRouter.js";
import { executeAI, type ExecutionInput } from "./aiExecutionService.js";
import { buildCreativeDirectorPrompt, buildCopywriterPrompt, parseJsonResponse, type CreativeBriefInput } from "./creativeAiService.js";
import { generateNamedAssetSet, type NamedAssetRole } from "./imageDesignerService.js";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

const WORKFLOW_STANDARD = [
  { step: "brief", label: "Brief" },
  { step: "brand-strategy", label: "Brand Strategy" },
  { step: "creative-direction", label: "Creative Direction" },
  { step: "copywriting", label: "Copywriting" },
  { step: "generation", label: "AI Image Generation" },
  { step: "qc", label: "Quality Check" },
  { step: "delivery", label: "Final Delivery" },
];

function makeBatchCode(): string {
  return `BATCH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

// ── Asset role configuration (Sprint P2.1) ─────────────────────────────────────

// Sprint P2.1 text-legibility fix: any role that needs a real brand name, tagline,
// or menu copy visible now generates a text-free background (noText) and has real
// vector text composited on top afterward (overlay) — see lib/textOverlay.ts. This
// replaces relying on the diffusion model to spell anything correctly.
const BASE_ASSET_ROLES: NamedAssetRole[] = [
  { role: "logo_concept", label: "Logo Concept", aspectRatio: "1:1", noText: true,
    promptHint: "A clean, modern abstract logo mark/icon on a plain background, professional branding presentation, no wordmark or lettering — icon only",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  { role: "color_palette", label: "Color Palette", aspectRatio: "16:9", noText: true,
    promptHint: "A stylish brand color palette board showing primary and secondary colors as clean geometric swatches, minimal graphic design layout",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  { role: "typography_direction", label: "Typography Direction", aspectRatio: "16:9", noText: true,
    promptHint: "An elegant abstract background texture suited for a typography showcase, soft gradients or minimal geometric shapes, no lettering",
    overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  { role: "main_brand_mockup", label: "Main Brand Mockup", aspectRatio: "3:2", noText: true,
    promptHint: "A realistic brand identity application mockup (blank stationery, signage, or product) shown in a real-world setting, no text or lettering on any surface",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  { role: "social_visual_1", label: "Social Media Visual 1", aspectRatio: "1:1", noText: true,
    promptHint: "A polished social media post visual promoting the brand, lifestyle photography style, no text overlays",
    overlay: { kind: "brandTagline", anchor: "bottom", theme: "dark" } },
  { role: "social_visual_2", label: "Social Media Visual 2", aspectRatio: "1:1", noText: true,
    promptHint: "A second distinct social media post visual for the brand, different composition and angle from the first, no text overlays",
    overlay: { kind: "brandName", anchor: "top", theme: "dark" } },
];

const INDUSTRY_EXTRA_ROLES: Record<string, NamedAssetRole[]> = {
  coffee: [
    { role: "packaging_mockup", label: "Cup/Packaging Mockup", aspectRatio: "3:2", noText: true, promptHint: "A branded coffee cup and packaging mockup, product photography, blank cup surface with no text",
      overlay: { kind: "brandName", anchor: "center", theme: "light" } },
    { role: "menu_mockup", label: "Menu Mockup", aspectRatio: "3:2", noText: true, promptHint: "A café interior background suited for a menu board display, elegant food & beverage setting, no text or lettering anywhere",
      overlay: { kind: "menu", anchor: "center", theme: "dark" } },
  ],
  restaurant: [
    { role: "packaging_mockup", label: "Packaging Mockup", aspectRatio: "3:2", noText: true, promptHint: "Branded food packaging/takeaway box mockup, product photography, blank surface with no text",
      overlay: { kind: "brandName", anchor: "center", theme: "light" } },
    { role: "menu_mockup", label: "Menu Mockup", aspectRatio: "3:2", noText: true, promptHint: "A restaurant interior background suited for a menu board display, appetizing food setting, no text or lettering anywhere",
      overlay: { kind: "menu", anchor: "center", theme: "dark" } },
  ],
  logistics: [
    { role: "company_profile_cover", label: "Company Profile Cover", aspectRatio: "3:2", noText: true, promptHint: "A corporate company profile document cover design, logistics industry, professional",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "presentation_cover", label: "Presentation Cover", aspectRatio: "16:9", noText: true, promptHint: "A corporate presentation title slide cover design, logistics industry",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "corporate_social_post", label: "Corporate Social Post", aspectRatio: "1:1", noText: true, promptHint: "A professional corporate social media post visual, logistics industry, no text overlays",
      overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  ],
  mining: [
    { role: "company_profile_cover", label: "Company Profile Cover", aspectRatio: "3:2", noText: true, promptHint: "A corporate company profile document cover design, mining industry, industrial professional",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "presentation_cover", label: "Presentation Cover", aspectRatio: "16:9", noText: true, promptHint: "A corporate presentation title slide cover design, mining industry",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "corporate_social_post", label: "Corporate Social Post", aspectRatio: "1:1", noText: true, promptHint: "A professional corporate social media post visual, mining industry, no text overlays",
      overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  ],
  trading: [
    { role: "company_profile_cover", label: "Company Profile Cover", aspectRatio: "3:2", noText: true, promptHint: "A corporate company profile document cover design, trading industry, professional",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "presentation_cover", label: "Presentation Cover", aspectRatio: "16:9", noText: true, promptHint: "A corporate presentation title slide cover design, trading industry",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "corporate_social_post", label: "Corporate Social Post", aspectRatio: "1:1", noText: true, promptHint: "A professional corporate social media post visual, trading industry, no text overlays",
      overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  ],
  palm_oil: [
    { role: "company_profile_cover", label: "Company Profile Cover", aspectRatio: "3:2", noText: true, promptHint: "A corporate company profile document cover design, palm oil plantation industry, professional natural tones",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "presentation_cover", label: "Presentation Cover", aspectRatio: "16:9", noText: true, promptHint: "A corporate presentation title slide cover design, palm oil industry",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "corporate_social_post", label: "Corporate Social Post", aspectRatio: "1:1", noText: true, promptHint: "A professional corporate social media post visual, palm oil industry, no text overlays",
      overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  ],
  fashion: [
    { role: "packaging_tag_mockup", label: "Packaging/Tag Mockup", aspectRatio: "3:2", noText: true, promptHint: "A fashion brand packaging and hang-tag mockup, product photography, blank surfaces with no text",
      overlay: { kind: "brandName", anchor: "center", theme: "light" } },
    { role: "apparel_mockup", label: "Apparel Mockup", aspectRatio: "3:2", noText: true, promptHint: "A branded apparel mockup on a garment, fashion product photography, blank garment with no text or print",
      overlay: { kind: "brandName", anchor: "center", theme: "light" } },
  ],
  medical: [
    { role: "clinic_signage", label: "Clinic Signage", aspectRatio: "3:2", noText: true, promptHint: "A modern medical clinic signage mockup, professional healthcare branding, blank signage panel with no text",
      overlay: { kind: "brandName", anchor: "center", theme: "light" } },
    { role: "social_post", label: "Social Post", aspectRatio: "1:1", noText: true, promptHint: "A professional healthcare social media post visual, no text overlays",
      overlay: { kind: "brandTagline", anchor: "bottom", theme: "dark" } },
    { role: "brochure_cover", label: "Brochure Cover", aspectRatio: "3:2", noText: true, promptHint: "A medical clinic brochure cover design, clean healthcare graphic design",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  ],
  property: [
    { role: "brochure", label: "Brochure", aspectRatio: "3:2", noText: true, promptHint: "A real estate property brochure cover design, premium property marketing",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
    { role: "banner", label: "Banner", aspectRatio: "16:9", noText: true, promptHint: "A real estate marketing banner design, premium property visual",
      overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
    { role: "social_ad", label: "Social Ad", aspectRatio: "1:1", noText: true, promptHint: "A real estate social media advertisement visual, no text overlays",
      overlay: { kind: "brandTagline", anchor: "bottom", theme: "dark" } },
  ],
  technology: [
    { role: "landing_page_hero", label: "Landing Page Hero", aspectRatio: "16:9", noText: true, promptHint: "A modern SaaS landing page hero section mockup, technology product design, blank UI panels with no text",
      overlay: { kind: "brandName", anchor: "top", theme: "dark" } },
    { role: "dashboard_mockup", label: "Dashboard Mockup", aspectRatio: "16:9", noText: true, promptHint: "A modern software dashboard UI mockup, technology product design, blank UI panels/charts with no text or labels",
      overlay: { kind: "brandName", anchor: "top", theme: "dark" } },
    { role: "presentation_cover", label: "Presentation Cover", aspectRatio: "16:9", noText: true, promptHint: "A technology company pitch deck presentation cover design",
      overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  ],
};

const MAX_ASSETS_PER_PORTFOLIO = 8;

function buildAssetRoles(industry: string): NamedAssetRole[] {
  const extras = INDUSTRY_EXTRA_ROLES[industry.toLowerCase()] ?? [];
  const budget = Math.max(0, MAX_ASSETS_PER_PORTFOLIO - BASE_ASSET_ROLES.length);
  return [...BASE_ASSET_ROLES, ...extras.slice(0, budget)];
}

// ── Duplicate brand-name check ─────────────────────────────────────────────────

async function isDuplicateBrandName(brandName: string): Promise<boolean> {
  const normalized = brandName.trim().toLowerCase();
  if (!normalized) return false;
  const rows = await db
    .select({ id: aiServicePortfoliosTable.id })
    .from(aiServicePortfoliosTable)
    .where(
      sql`(${aiServicePortfoliosTable.metadataJson}->>'brandName') ILIKE ${normalized} OR ${aiServicePortfoliosTable.title} ILIKE ${`%${normalized}%`}`,
    )
    .limit(1);
  return rows.length > 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BatchConfig {
  serviceId?: number;
  industry: string;
  style: string;
  packageLevel?: string;
  requestedCount?: number;
  maxCost?: number;
  autoPublish?: boolean;
  qcThreshold?: number;
  createdBy?: string;
}

export async function createGenerationBatch(config: BatchConfig) {
  const [batch] = await db
    .insert(aiPortfolioGenerationBatchesTable)
    .values({
      batchCode: makeBatchCode(),
      serviceId: config.serviceId ?? null,
      industry: config.industry,
      style: config.style,
      packageLevel: config.packageLevel ?? "standard",
      requestedCount: Math.min(config.requestedCount ?? 3, 10),
      maxCost: config.maxCost != null ? String(config.maxCost) : null,
      autoPublish: config.autoPublish ?? false,
      qcThreshold: config.qcThreshold ?? 70,
      status: "draft",
      createdBy: config.createdBy ?? "admin",
    })
    .returning();

  await logAudit("portfolio-generator", "batch_created", String(batch!.id), "ai_portfolio_generation_batch", "success", { batchCode: batch!.batchCode });
  return batch!;
}

export async function startBatch(batchId: number): Promise<void> {
  const [batch] = await db
    .select()
    .from(aiPortfolioGenerationBatchesTable)
    .where(eq(aiPortfolioGenerationBatchesTable.id, batchId))
    .limit(1);

  if (!batch) throw new Error(`Batch ${batchId} not found`);
  if (!["draft", "failed", "partially_failed"].includes(batch.status)) {
    throw new Error(`Batch ${batchId} cannot be started (status: ${batch.status})`);
  }

  await db
    .update(aiPortfolioGenerationBatchesTable)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiPortfolioGenerationBatchesTable.id, batchId));

  await logAudit("portfolio-generator", "batch_started", String(batchId), "ai_portfolio_generation_batch", "success");

  // Fire-and-forget
  runBatch(batch).catch(async (err) => {
    console.error(`[portfolio-generator] Batch ${batchId} error:`, err);
    await db
      .update(aiPortfolioGenerationBatchesTable)
      .set({ status: "failed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(aiPortfolioGenerationBatchesTable.id, batchId));
  });
}

export async function cancelBatch(batchId: number): Promise<void> {
  await db
    .update(aiPortfolioGenerationBatchesTable)
    .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(aiPortfolioGenerationBatchesTable.id, batchId),
      eq(aiPortfolioGenerationBatchesTable.status, "running"),
    ));
  await logAudit("portfolio-generator", "batch_cancelled", String(batchId), "ai_portfolio_generation_batch", "success");
}

/** Terminal per-asset states — archiving has finished one way or another. */
const ASSET_TERMINAL_STATES = ["archived", "optimized", "archive_failed"];

/**
 * Rebuild a portfolio's coverImage/galleryJson from its ai_portfolio_assets rows
 * — the ONLY source of permanent storage URLs. Never writes a Replicate URL.
 */
async function rebuildGalleryFromAssets(portfolioId: number): Promise<{ coverImage: string | null; galleryJson: Array<Record<string, unknown>> }> {
  const assets = await db
    .select()
    .from(aiPortfolioAssetsTable)
    .where(eq(aiPortfolioAssetsTable.portfolioId, portfolioId))
    .orderBy(aiPortfolioAssetsTable.displayOrder);

  const usable = assets.filter((a) => a.status !== "archive_failed" && a.previewUrl && !a.previewUrl.includes("replicate.delivery"));
  const mainMockup = usable.find((a) => a.assetRole === "main_brand_mockup") ?? usable[0];

  return {
    coverImage: mainMockup?.previewUrl ?? null,
    galleryJson: usable.map((a) => ({ role: a.assetRole, label: a.title, url: a.previewUrl, thumbnailUrl: a.thumbnailUrl, altText: a.altText })),
  };
}

// ── Sprint P3 — Publication Guard ─────────────────────────────────────────────

/** Minimum assets required before a portfolio may be published. */
export const PUBLICATION_MIN_ASSETS = 6;
/** Hard QC floor — stricter than the per-batch qcThreshold (which gates auto-publish routing). */
export const PUBLICATION_MIN_QC = 80;

/**
 * Server-side state machine guard.
 * Every path to publish_status = 'published' MUST pass through this check.
 * Returns reasons array; ok=true means the portfolio is safe to publish.
 */
export async function checkPublicationGuard(
  portfolioId: number,
): Promise<{ ok: boolean; reasons: string[] }> {
  const [portfolio] = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .limit(1);
  if (!portfolio) return { ok: false, reasons: ["Portfolio not found"] };

  const p = portfolio as Record<string, unknown>;
  const qcScore = p["qcScore"] ? parseFloat(String(p["qcScore"])) : null;
  const reasons: string[] = [];

  // QC gate
  if (qcScore === null) reasons.push("QC score is missing");
  else if (qcScore < PUBLICATION_MIN_QC) reasons.push(`QC score (${qcScore}) is below minimum ${PUBLICATION_MIN_QC}`);

  // Trademark safety gate
  if (p["trademarkRisk"] !== "low") reasons.push(`Trademark risk is "${p["trademarkRisk"] ?? "unknown"}" — must be "low"`);

  // Cover gate
  if (!portfolio.coverImage) reasons.push("Cover image is missing");
  else if (portfolio.coverImage.includes("replicate.delivery")) {
    reasons.push("Cover image is still a temporary Replicate URL — archiving not complete");
  }

  // Asset count + terminal state gates
  const assets = await db
    .select()
    .from(aiPortfolioAssetsTable)
    .where(eq(aiPortfolioAssetsTable.portfolioId, portfolioId));

  if (assets.length < PUBLICATION_MIN_ASSETS) {
    reasons.push(`Insufficient assets: ${assets.length}/${PUBLICATION_MIN_ASSETS} minimum required`);
  }
  const stillArchiving = assets.some((a) => !ASSET_TERMINAL_STATES.includes(a.status));
  if (stillArchiving) reasons.push("One or more assets are still being archived");

  const replicateAssets = assets.filter((a) => a.previewUrl?.includes("replicate.delivery"));
  if (replicateAssets.length > 0) {
    reasons.push(`${replicateAssets.length} asset(s) are still serving temporary Replicate URLs`);
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Called after every archive_asset / optimize_asset job completion (success or
 * terminal failure). If ALL assets for the portfolio have reached a terminal
 * archiving state, rebuilds the gallery from permanent URLs and — for
 * portfolios that were auto-publish-eligible — flips publishStatus to
 * "published". This guarantees the public Gallery NEVER serves a Replicate
 * temporary URL, even though generation and archiving are decoupled.
 *
 * Sprint P3: also gates auto-publish on cover URL being permanent (not Replicate),
 * and updates generation_status throughout.
 */
export async function maybeFinalizePortfolioPublish(portfolioAssetId: number): Promise<void> {
  const [asset] = await db.select({ portfolioId: aiPortfolioAssetsTable.portfolioId })
    .from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.id, portfolioAssetId)).limit(1);
  if (!asset) return;
  const portfolioId = asset.portfolioId;

  const siblings = await db.select({ status: aiPortfolioAssetsTable.status })
    .from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.portfolioId, portfolioId));
  const allTerminal = siblings.every((s) => ASSET_TERMINAL_STATES.includes(s.status));
  if (!allTerminal) return;

  const [portfolio] = await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, portfolioId)).limit(1);
  if (!portfolio) return;

  const { coverImage, galleryJson } = await rebuildGalleryFromAssets(portfolioId);
  const meta = (portfolio.metadataJson as Record<string, unknown> | null) ?? {};

  // Sprint P3: also require cover to be a permanent URL before auto-publishing
  const shouldAutoPublish =
    meta["pendingAutoPublish"] === true &&
    portfolio.publishStatus === "pending_archive" &&
    coverImage !== null &&
    !coverImage.includes("replicate.delivery");

  const newGenerationStatus = shouldAutoPublish ? "published"
    : coverImage ? "archived"
    : "incomplete";

  await db.update(aiServicePortfoliosTable)
    .set({
      coverImage, galleryJson,
      publishStatus: shouldAutoPublish ? "published" : portfolio.publishStatus,
      status: shouldAutoPublish ? "published" : portfolio.status,
      generationStatus: newGenerationStatus,
      updatedAt: new Date(),
    } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, portfolioId));

  await logAudit("portfolio-generator", "portfolio_archiving_finalized", String(portfolioId), "ai_service_portfolio", "success", { autoPublished: shouldAutoPublish });

  if (shouldAutoPublish) {
    await publishSafe({ eventType: "portfolio_approved", sourceModule: "portfolio-generator", sourceId: String(portfolioId), payload: { autoPublished: true } });
  }
}

/**
 * Admin-triggered approval: enforces the Sprint P3 publication guard.
 * Hard QC threshold = 80 (regardless of the batch qcThreshold which only
 * governs auto-publish routing during generation).
 */
export async function approvePortfolio(portfolioId: number, approvedBy?: string) {
  // Sprint P3: hard publication guard
  const guard = await checkPublicationGuard(portfolioId);
  if (!guard.ok) {
    throw new Error(`Publication guard failed:\n• ${guard.reasons.join("\n• ")}`);
  }

  const { coverImage, galleryJson } = await rebuildGalleryFromAssets(portfolioId);

  const [row] = await db
    .update(aiServicePortfoliosTable)
    .set({
      publishStatus: "published",
      status: "published",
      coverImage,
      galleryJson,
      generationStatus: "published",
      updatedAt: new Date(),
    } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .returning();

  if (!row) throw new Error(`Portfolio ${portfolioId} not found`);
  await logAudit("portfolio-generator", "portfolio_approved", String(portfolioId), "ai_service_portfolio", "success", { approvedBy });
  await publishSafe({ eventType: "portfolio_approved", sourceModule: "portfolio-generator", sourceId: String(portfolioId), payload: { approvedBy } });
  return row;
}

// ── Demo seed configs ─────────────────────────────────────────────────────────

const DEMO_SEED_CONFIGS: { industry: string; style: string }[] = [
  { industry: "coffee",     style: "minimalist" },
  { industry: "fashion",    style: "elegant"    },
  { industry: "technology", style: "modern"     },
  { industry: "food",       style: "vibrant"    },
  { industry: "healthcare", style: "clean"      },
  { industry: "logistics",  style: "corporate"  },
  { industry: "beauty",     style: "luxury"     },
  { industry: "education",  style: "friendly"   },
];

/**
 * Wipe all existing demo portfolios (isDemo = true) and their assets, then
 * create + immediately start one generation batch per DEMO_SEED_CONFIGS entry.
 * All batches: autoPublish=true, qcThreshold=60.
 * Images upload via persistImageBuffer → Supabase — no expiring URLs.
 */
export async function seedDemoPortfolios(): Promise<{ batchIds: number[]; cleanedUp: number }> {
  // Step 1: delete stale demo portfolios and their assets
  const existingDemos = await db
    .select({ id: aiServicePortfoliosTable.id })
    .from(aiServicePortfoliosTable)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq((aiServicePortfoliosTable as any).isDemo, true));

  let cleanedUp = 0;
  if (existingDemos.length > 0) {
    const ids = existingDemos.map((r) => r.id);
    await db.delete(aiPortfolioAssetsTable).where(inArray(aiPortfolioAssetsTable.portfolioId, ids));
    await db.delete(aiServicePortfoliosTable).where(inArray(aiServicePortfoliosTable.id, ids));
    cleanedUp = ids.length;
  }

  // Step 2: create one batch per config
  const batchIds: number[] = [];
  for (const cfg of DEMO_SEED_CONFIGS) {
    const batch = await createGenerationBatch({
      industry: cfg.industry,
      style: cfg.style,
      packageLevel: "standard",
      requestedCount: 1,
      autoPublish: true,
      qcThreshold: 60,
      createdBy: "seed-script",
    });
    batchIds.push(batch.id);
  }

  // Step 3: start all batches fire-and-forget
  for (const batchId of batchIds) {
    startBatch(batchId).catch((err: unknown) => {
      console.error(`[seed-demos] batch ${batchId} start failed:`, err);
    });
  }

  await logAudit(
    "portfolio-admin", "seed_demos_triggered", "seed", "system", "success",
    { batchCount: batchIds.length, cleanedUp },
  );

  return { batchIds, cleanedUp };
}

/**
 * Re-generate all images for an existing portfolio and upload them directly
 * to Supabase Storage. Reuses the brand concept already stored in
 * metadataJson — skips all LLM steps (Brand Strategist / Creative Director /
 * Copywriter). Only runs image generation + QC + Supabase upload.
 *
 * Deletes old ai_portfolio_assets rows and replaces them with fresh ones
 * whose previewUrl already points to Supabase CDN.
 */
export async function regeneratePortfolioImages(
  portfolioId: number
): Promise<{ count: number; cost: number }> {
  const [portfolio] = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .limit(1);
  if (!portfolio) throw new Error(`Portfolio ${portfolioId} not found`);

  const meta = (portfolio.metadataJson ?? {}) as Record<string, unknown>;
  const brandName = String(meta["brandName"] ?? portfolio.title ?? "Demo Brand");
  const brandSlug = String(
    meta["brandSlug"] ??
      brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40)
  );

  const imageBrief: Record<string, unknown> = {
    brandName,
    businessType: String(meta["businessType"] ?? portfolio.industry ?? ""),
    targetMarket: String(meta["targetMarket"] ?? portfolio.industry ?? ""),
    stylePreference: portfolio.style,
    goal: "Showcase a high-quality fictional brand identity for the public demo portfolio gallery",
    visualStyle: (meta["creativeDirection"] as Record<string, unknown> | null)?.[
      "visual_style"
    ],
    colorDirection: (meta["creativeDirection"] as Record<string, unknown> | null)?.[
      "color_direction"
    ],
    tagline: String(
      (meta["copy"] as Record<string, unknown> | null)?.["tagline"] ??
        meta["tagline"] ??
        ""
    ),
    industry: portfolio.industry,
  };

  const assetRoles = buildAssetRoles(portfolio.industry ?? "");
  const generatedAssets = await generateNamedAssetSet(imageBrief, assetRoles, {
    maxRetryPerAsset: 2,
  });
  const totalCost = generatedAssets.reduce((sum, a) => sum + a.cost, 0);

  // Remove stale assets, replace with fresh ones
  await db
    .delete(aiPortfolioAssetsTable)
    .where(eq(aiPortfolioAssetsTable.portfolioId, portfolioId));

  const completedAssets = generatedAssets.filter((a) => a.status === "completed");

  if (generatedAssets.length) {
    await db.insert(aiPortfolioAssetsTable).values(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generatedAssets.map((a: any, i: number) => {
        const inSupabase = Boolean(
          a.imageUrl && String(a.imageUrl).includes("supabase.co")
        );
        return {
          portfolioId,
          assetType: "image",
          assetRole: a.role,
          assetPurpose: "demo_portfolio" as const, // Sprint P3: explicit asset_purpose
          title: a.label,
          altText:
            a.status === "completed"
              ? `${a.label} — ${brandName} (AI Demo Project)`
              : null,
          thumbnailUrl: a.imageUrl,
          previewUrl: a.imageUrl,
          sourceUrl: a.sourceProviderUrl ?? a.imageUrl,
          storagePath: null,
          mimeType: a.status === "completed" ? "image/webp" : null,
          // Mark as optimized (already in Supabase) or generated (needs archive job)
          status: inSupabase ? "optimized" : "generated",
          archiveStatus: inSupabase ? "completed" : "pending",
          displayOrder: i,
          downloadable: false,
          watermarkRequired: false,
          metadataJson: {
            status: a.status,
            qcScore: a.qcScore,
            qcNotes: a.qcNotes,
            cost: a.cost,
            retries: a.retries,
            prompt: a.prompt,
            regenerated: true,
          },
        };
      })
    );
  }

  // Update portfolio cover image to the new Supabase URL
  const mainMockup =
    completedAssets.find((a) => a.role === "main_brand_mockup") ?? completedAssets[0];
  if (mainMockup?.imageUrl) {
    await db
      .update(aiServicePortfoliosTable)
      .set({ coverImage: mainMockup.imageUrl })
      .where(eq(aiServicePortfoliosTable.id, portfolioId));
  }

  // For any assets that fell back to Replicate URL (persistImageBuffer failed),
  // fire archive events so the background storage_worker picks them up.
  const newAssets = await db
    .select()
    .from(aiPortfolioAssetsTable)
    .where(eq(aiPortfolioAssetsTable.portfolioId, portfolioId));

  for (const asset of newAssets) {
    if (asset.status === "generated" && asset.sourceUrl) {
      publishSafe({
        eventType: "asset.generated",
        sourceModule: "portfolio-admin",
        sourceId: String(asset.id),
        payload: {
          portfolioAssetId: asset.id,
          sourceUrl: asset.sourceUrl,
          brandSlug,
          role: asset.assetRole,
          portfolioId,
        },
      });
    }
  }

  await logAudit(
    "portfolio-admin",
    "portfolio_images_regenerated",
    String(portfolioId),
    "ai_service_portfolio",
    "success",
    { count: completedAssets.length, cost: totalCost }
  );

  return { count: completedAssets.length, cost: totalCost };
}

export async function rejectPortfolio(portfolioId: number, reason?: string) {
  const [row] = await db
    .update(aiServicePortfoliosTable)
    .set({ publishStatus: "archived", status: "hidden", updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .returning();

  if (!row) throw new Error(`Portfolio ${portfolioId} not found`);
  await logAudit("portfolio-generator", "portfolio_rejected", String(portfolioId), "ai_service_portfolio", "failure", { reason });
  return row;
}

// ── Internal batch runner ─────────────────────────────────────────────────────

async function runBatch(batch: typeof aiPortfolioGenerationBatchesTable.$inferSelect): Promise<void> {
  let actualCost = parseFloat(batch.actualCost ?? "0");
  const maxCost = batch.maxCost ? parseFloat(batch.maxCost) : Infinity;

  for (let i = 0; i < batch.requestedCount; i++) {
    // Check if cancelled externally
    const [current] = await db
      .select({ status: aiPortfolioGenerationBatchesTable.status })
      .from(aiPortfolioGenerationBatchesTable)
      .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id))
      .limit(1);
    if (current?.status === "cancelled") return;

    // Budget guardrail (use estimated cost — ExecutionOutput has no cost field)
    if (actualCost >= maxCost) {
      await db
        .update(aiPortfolioGenerationBatchesTable)
        .set({ status: "blocked_by_budget", actualCost: String(actualCost), updatedAt: new Date() })
        .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));
      await logAudit("portfolio-generator", "batch_blocked_budget", String(batch.id), "ai_portfolio_generation_batch", "failure", { actualCost, maxCost });
      return;
    }

    try {
      const estimatedCost = await generateOneDemoPortfolio({
        industry: batch.industry, style: batch.style, packageLevel: batch.packageLevel,
        serviceId: batch.serviceId ?? undefined, autoPublish: batch.autoPublish,
        qcThreshold: batch.qcThreshold, batchId: batch.id,
      });
      actualCost += estimatedCost;
      await db
        .update(aiPortfolioGenerationBatchesTable)
        .set({ generatedCount: sql`${aiPortfolioGenerationBatchesTable.generatedCount} + 1`, actualCost: String(actualCost), updatedAt: new Date() })
        .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));
    } catch (err) {
      console.error("[portfolio-batch] portfolio generation failed", { batchId: batch.id, industry: batch.industry, err });
      await db
        .update(aiPortfolioGenerationBatchesTable)
        .set({ failedCount: sql`${aiPortfolioGenerationBatchesTable.failedCount} + 1`, updatedAt: new Date() })
        .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));
    }
  }

  const [final] = await db
    .select()
    .from(aiPortfolioGenerationBatchesTable)
    .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id))
    .limit(1);

  const finalStatus = !final || final.generatedCount === 0 ? "failed"
    : final.failedCount > 0 ? "partially_failed" : "review";

  await db
    .update(aiPortfolioGenerationBatchesTable)
    .set({ status: finalStatus, completedAt: new Date(), updatedAt: new Date() })
    .where(eq(aiPortfolioGenerationBatchesTable.id, batch.id));

  await publishSafe({ eventType: "portfolio_batch_completed", sourceModule: "portfolio-generator", sourceId: String(batch.id), payload: { batchId: batch.id, status: finalStatus, actualCost } });
}

interface SingleGenConfig {
  industry: string;
  style: string;
  packageLevel: string;
  serviceId?: number;
  autoPublish: boolean;
  qcThreshold: number;
  batchId: number;
  maxRetryPerAsset?: number;
}

function tokenCost(tokensUsed: number): number {
  // heuristic: ~$0.002 per 1K tokens for GPT-4o-mini class LLM steps
  return (tokensUsed / 1000) * 0.002;
}

async function runLlmStep(
  agentSlug: string,
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
  maxTokens: number,
): Promise<{ output: Record<string, unknown>; cost: number }> {
  const routing = await routeForAgent(agentSlug, { prompt: `portfolio-demo-${agentSlug}`, requiredContextTokens: 900 });
  if (!routing) throw new Error(`No active AI model for ${agentSlug}`);

  const execInput: ExecutionInput = {
    prompt: userPrompt,
    systemPrompt,
    model: routing.selected.model,
    provider: routing.selected.provider,
    temperature,
    maxTokens,
  };

  const result = await executeAI(execInput);
  const output = parseJsonResponse(result.content) as Record<string, unknown>;
  return { output, cost: tokenCost(result.tokensUsed) };
}

/** Generates one demo portfolio end-to-end: Brand Strategist -> Creative Director ->
 *  Copywriter -> Image Designer (real assets) -> Image QC -> insert + gate for review.
 *  Returns the actual cost incurred (LLM steps + image generation). */
async function generateOneDemoPortfolio(config: SingleGenConfig): Promise<number> {
  let totalCost = 0;

  // ── Step 1: Brand Strategist (with duplicate-name avoidance, up to 3 attempts) ──
  let concept: Record<string, unknown> = {};
  let brandName = `Demo ${config.industry}`;
  const avoidNames: string[] = [];

  for (let attempt = 0; attempt < 3; attempt++) {
    const avoidClause = avoidNames.length
      ? `\nThe following brand names are already in use — you MUST pick a different fictional name: ${avoidNames.join(", ")}.`
      : "";

    const userPrompt = `Create a fictional brand concept (for demo portfolio purposes only, NOT a real company) for:
Industry: ${config.industry}
Visual style: ${config.style}
Package: ${config.packageLevel}

Rules: fictional Indonesian-sounding name, must NOT resemble any real trademark or existing company.${avoidClause}

Return ONLY JSON (no markdown):
{"brandName":"string","tagline":"string","shortDescription":"string (max 60 words)","fullDescription":"string (max 180 words)","businessType":"string","targetMarket":"string","primaryColor":"#hex","secondaryColor":"#hex","trademarkRisk":"low|medium|high"}`;

    const step = await runLlmStep(
      "brand-strategist",
      "You are a senior Brand Strategist creating fictional demo brand concepts for an AI creative agency portfolio showcase. Output strict JSON only — no markdown, no commentary. Anda WAJIB menulis SEMUA nilai teks (tagline, shortDescription, fullDescription, businessType, targetMarket) dalam Bahasa Indonesia yang baik dan profesional.",
      userPrompt, 0.85, 800,
    );
    totalCost += step.cost;
    concept = step.output;
    brandName = String(concept["brandName"] ?? brandName);

    if (!(await isDuplicateBrandName(brandName))) break;
    avoidNames.push(brandName);
  }

  const duplicateNameUnresolved = avoidNames.includes(brandName) || (await isDuplicateBrandName(brandName));
  let trademarkRisk = ["low", "medium", "high"].includes(String(concept["trademarkRisk"]))
    ? String(concept["trademarkRisk"]) : "medium";
  if (duplicateNameUnresolved) trademarkRisk = trademarkRisk === "low" ? "medium" : trademarkRisk;

  const brief: CreativeBriefInput = {
    brandName,
    businessType: String(concept["businessType"] ?? config.industry),
    targetMarket: String(concept["targetMarket"] ?? "Indonesian SME / consumer market"),
    productOrService: String(concept["shortDescription"] ?? config.industry),
    stylePreference: config.style,
    goal: "Showcase a high-quality fictional brand identity for the public demo portfolio gallery",
    notes: "This is a synthetic AI Demo Project — not a real client. Avoid any resemblance to real trademarks or logos.",
  };

  // ── Step 2: Creative Director ──────────────────────────────────────────────
  const cdPrompt = buildCreativeDirectorPrompt(brief, concept);
  const cdStep = await runLlmStep("creative-director", cdPrompt.systemPrompt, cdPrompt.userPrompt, 0.8, 900);
  totalCost += cdStep.cost;
  const creativeDirection = cdStep.output;

  // ── Step 3: Copywriter ──────────────────────────────────────────────────────
  const cwPrompt = buildCopywriterPrompt(brief, concept, creativeDirection);
  const cwStep = await runLlmStep("copywriter", cwPrompt.systemPrompt, cwPrompt.userPrompt, 0.8, 900);
  totalCost += cwStep.cost;
  const copy = cwStep.output;

  // ── Step 4+5: Image Designer + Image QC (real generated assets) ────────────
  const assetRoles = buildAssetRoles(config.industry);
  const imageBrief: Record<string, unknown> = {
    brandName, businessType: brief.businessType, targetMarket: brief.targetMarket,
    stylePreference: config.style, goal: brief.goal,
    visualStyle: (creativeDirection as { visual_style?: unknown }).visual_style,
    colorDirection: (creativeDirection as { color_direction?: unknown }).color_direction,
    // Used by the text-overlay system so any legible on-image text is real vector
    // text baked in after generation, never left to the diffusion model to render.
    tagline: String((copy as { tagline?: unknown }).tagline ?? concept["tagline"] ?? ""),
    industry: config.industry,
  };
  const generatedAssets = await generateNamedAssetSet(imageBrief, assetRoles, { maxRetryPerAsset: config.maxRetryPerAsset ?? 2 });
  totalCost += generatedAssets.reduce((sum, a) => sum + a.cost, 0);

  const completedAssets = generatedAssets.filter((a) => a.status === "completed");
  const failedAssets = generatedAssets.filter((a) => a.status === "failed");
  const allRequiredAssetsPresent = failedAssets.length === 0;
  const avgQcScore = completedAssets.length
    ? Math.round(completedAssets.reduce((sum, a) => sum + a.qcScore, 0) / completedAssets.length)
    : 0;

  const canAutoPublish =
    config.autoPublish &&
    avgQcScore >= config.qcThreshold &&
    trademarkRisk === "low" &&
    allRequiredAssetsPresent;

  let serviceId = config.serviceId;
  if (!serviceId) {
    const [svc] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.status, "active")).limit(1);
    serviceId = svc?.id;
  }
  if (!serviceId) throw new Error("No active service for portfolio");

  const portfolioCode = `DEMO-${config.industry.toUpperCase().replace(/\s+/g, "-")}-${Date.now().toString(36).toUpperCase()}`;
  const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40);
  const slug = `${config.industry.toLowerCase()}-${brandSlug}-${Date.now().toString(36)}`.substring(0, 100);

  // Insert immediately with the Replicate URLs — they are ONLY ever a transient
  // placeholder inside this one DB row until the background archive_asset jobs
  // finish and maybeFinalizePortfolioPublish() rewrites coverImage/galleryJson
  // with permanent storage URLs. The Gallery/public API MUST NEVER serve this
  // row while publishStatus is "published" and assets aren't archived yet —
  // that's why auto-publish-eligible portfolios get the interim
  // "pending_archive" status instead of "published" here.
  const completedForGallery = completedAssets;
  const mainMockup = completedForGallery.find((a) => a.role === "main_brand_mockup") ?? completedForGallery[0];

  const publishStatus = !allRequiredAssetsPresent
    ? "review" // any failed asset always forces manual review, regardless of autoPublish
    : canAutoPublish ? "pending_archive" : "review";

  // Sprint P3: generation_status tracks the pipeline stage for Portfolio Center UI
  const generationStatus = !allRequiredAssetsPresent ? "incomplete"
    : publishStatus === "pending_archive" ? "archiving"
    : "qc_review";

  const insertValues: Record<string, unknown> = {
    serviceId,
    title: `${brandName} — ${config.style} ${config.industry}`,
    industry: config.industry,
    style: config.style,
    shortDescription: String(concept["shortDescription"] ?? ""),
    description: String(concept["fullDescription"] ?? ""),
    businessType: String(concept["businessType"] ?? config.industry),
    primaryColor: String(concept["primaryColor"] ?? "#1A1A1A"),
    secondaryColor: String(concept["secondaryColor"] ?? "#F5F5F5"),
    packageLevel: config.packageLevel,
    portfolioCode, slug,
    isDemo: true, trademarkRisk,
    qcScore: String(avgQcScore),
    generationStatus, // Sprint P3
    // Transient placeholder — overwritten with permanent storage URLs by
    // maybeFinalizePortfolioPublish() once archiving completes.
    coverImage: mainMockup?.imageUrl ?? null,
    galleryJson: completedForGallery.map((a) => ({ role: a.role, label: a.label, url: a.imageUrl, altText: `${a.label} — ${brandName} (${config.industry}, ${config.style} style, AI Demo Project)` })),
    publishStatus,
    status: "draft",
    featured: false,
    deliverablesJson: Array.isArray(concept["deliverables"]) ? concept["deliverables"] : generatedAssets.map((a) => a.label),
    toolsUsedJson: ["Brand Strategist AI", "Creative Director AI", "Copywriter AI", "Image Designer AI (FLUX.1)", "Image QC AI"],
    workflowJson: WORKFLOW_STANDARD,
    metadataJson: {
      batchId: config.batchId,
      generated: new Date().toISOString(),
      disclaimer: "AI Demo Project — Conceptual example only. Not a real client.",
      synthetic: true,
      brandName,
      brandSlug,
      tagline: concept["tagline"] ?? null,
      copy,
      creativeDirection,
      duplicateNameCheck: duplicateNameUnresolved ? "unresolved_after_retries" : "ok",
      assetSummary: { requested: assetRoles.length, completed: completedAssets.length, failed: failedAssets.length },
      pendingAutoPublish: publishStatus === "pending_archive",
    },
    completedProjects: 0, displayOrder: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [portfolio] = await db.insert(aiServicePortfoliosTable).values(insertValues as any).returning();
  const portfolioId = portfolio!.id;

  // Insert structured asset registry rows immediately — generation is DONE the
  // moment these rows exist. Archiving/optimizing/thumbnailing happen entirely
  // in the background via the existing job queue (Sprint P2.1.1); this insert
  // never waits on storage I/O.
  if (generatedAssets.length) {
    await db.insert(aiPortfolioAssetsTable).values(
      generatedAssets.map((a, i) => ({
        portfolioId,
        assetType: "image",
        assetRole: a.role,
        assetPurpose: "demo_portfolio" as const, // Sprint P3: explicit asset_purpose
        title: a.label,
        altText: a.status === "completed" ? `${a.label} — ${brandName} (AI Demo Project)` : null,
        thumbnailUrl: a.imageUrl,
        previewUrl: a.imageUrl,
        sourceUrl: a.imageUrl,
        storagePath: null,
        mimeType: a.status === "completed" ? "image/webp" : null,
        displayOrder: i,
        downloadable: false,
        watermarkRequired: false,
        metadataJson: { status: a.status, qcScore: a.qcScore, qcNotes: a.qcNotes, cost: a.cost, retries: a.retries, prompt: a.prompt },
      })),
    );
  }

  await logAudit(
    "portfolio-generator",
    avgQcScore >= config.qcThreshold && allRequiredAssetsPresent ? "portfolio_qc_passed" : "portfolio_qc_failed",
    String(portfolio!.id), "ai_service_portfolio",
    avgQcScore >= config.qcThreshold && allRequiredAssetsPresent ? "success" : "failure",
    { qcScore: avgQcScore, trademarkRisk, failedAssets: failedAssets.length, duplicateNameUnresolved },
  );

  await publishSafe({
    eventType: allRequiredAssetsPresent ? "portfolio_qc_passed" : "portfolio_qc_failed",
    sourceModule: "portfolio-generator", sourceId: String(portfolio!.id),
    payload: { batchId: config.batchId, qcScore: avgQcScore, failedAssets: failedAssets.length },
  });
  await publishSafe({ eventType: "portfolio_generated", sourceModule: "portfolio-generator", sourceId: String(portfolio!.id), payload: { batchId: config.batchId, qcScore: avgQcScore } });

  return totalCost;
}
