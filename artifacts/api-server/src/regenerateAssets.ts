/**
 * One-off script: regenerate failed image assets across demo portfolios.
 * Run: tsx --tsconfig tsconfig.json src/regenerateAssets.ts <maxAssets> [portfolioId]
 *
 * Reuses the exact same generateNamedAssetSet pipeline (Replicate + text overlay +
 * QC + object-storage persistence) used by demoPortfolioGeneratorService, but only
 * targets assets currently in a "failed" generation state. Processes up to
 * <maxAssets> assets (across all portfolios needing it, unless a portfolioId is
 * given) then exits — call repeatedly to drain the backlog within tool timeouts.
 * Rebuilds each affected portfolio's cover/gallery after every successful asset,
 * so partial progress is always safe even if the process is killed mid-run.
 */
import { eq } from "drizzle-orm";
import { db, aiServicePortfoliosTable, aiPortfolioAssetsTable } from "@workspace/db";
import { generateNamedAssetSet, type NamedAssetRole } from "./services/imageDesignerService.js";

const ROLE_DEFS: Record<string, NamedAssetRole> = {
  logo_concept: { role: "logo_concept", label: "Logo Concept", aspectRatio: "1:1", noText: true,
    promptHint: "A clean, modern abstract logo mark/icon on a plain background, professional branding presentation, no wordmark or lettering — icon only",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  color_palette: { role: "color_palette", label: "Color Palette", aspectRatio: "16:9", noText: true,
    promptHint: "A stylish brand color palette board showing primary and secondary colors as clean geometric swatches, minimal graphic design layout",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  typography_direction: { role: "typography_direction", label: "Typography Direction", aspectRatio: "16:9", noText: true,
    promptHint: "An elegant abstract background texture suited for a typography showcase, soft gradients or minimal geometric shapes, no lettering",
    overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  main_brand_mockup: { role: "main_brand_mockup", label: "Main Brand Mockup", aspectRatio: "3:2", noText: true,
    promptHint: "A realistic brand identity application mockup (blank stationery, signage, or product) shown in a real-world setting, no text or lettering on any surface",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  social_visual_1: { role: "social_visual_1", label: "Social Media Visual 1", aspectRatio: "1:1", noText: true,
    promptHint: "A polished social media post visual promoting the brand, lifestyle photography style, no text overlays",
    overlay: { kind: "brandTagline", anchor: "bottom", theme: "dark" } },
  social_visual_2: { role: "social_visual_2", label: "Social Media Visual 2", aspectRatio: "1:1", noText: true,
    promptHint: "A second distinct social media post visual for the brand, different composition and angle from the first, no text overlays",
    overlay: { kind: "brandName", anchor: "top", theme: "dark" } },
  landing_page_hero: { role: "landing_page_hero", label: "Landing Page Hero", aspectRatio: "16:9", noText: true,
    promptHint: "A modern SaaS landing page hero section mockup, technology product design, blank UI panels with no text",
    overlay: { kind: "brandName", anchor: "top", theme: "dark" } },
  dashboard_mockup: { role: "dashboard_mockup", label: "Dashboard Mockup", aspectRatio: "16:9", noText: true,
    promptHint: "A modern software dashboard UI mockup, technology product design, blank UI panels/charts with no text or labels",
    overlay: { kind: "brandName", anchor: "top", theme: "dark" } },
  packaging_mockup: { role: "packaging_mockup", label: "Cup/Packaging Mockup", aspectRatio: "3:2", noText: true,
    promptHint: "A branded coffee cup and packaging mockup, product photography, blank cup surface with no text",
    overlay: { kind: "brandName", anchor: "center", theme: "light" } },
  menu_mockup: { role: "menu_mockup", label: "Menu Mockup", aspectRatio: "3:2", noText: true,
    promptHint: "A café interior background suited for a menu board display, elegant food & beverage setting, no text or lettering anywhere",
    overlay: { kind: "menu", anchor: "center", theme: "dark" } },
  company_profile_cover: { role: "company_profile_cover", label: "Company Profile Cover", aspectRatio: "3:2", noText: true,
    promptHint: "A corporate company profile document cover design, professional",
    overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  presentation_cover: { role: "presentation_cover", label: "Presentation Cover", aspectRatio: "16:9", noText: true,
    promptHint: "A corporate presentation title slide cover design",
    overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  corporate_social_post: { role: "corporate_social_post", label: "Corporate Social Post", aspectRatio: "1:1", noText: true,
    promptHint: "A professional corporate social media post visual, no text overlays",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  packaging_tag_mockup: { role: "packaging_tag_mockup", label: "Packaging/Tag Mockup", aspectRatio: "3:2", noText: true,
    promptHint: "A fashion brand packaging and hang-tag mockup, product photography, blank surfaces with no text",
    overlay: { kind: "brandName", anchor: "center", theme: "light" } },
  apparel_mockup: { role: "apparel_mockup", label: "Apparel Mockup", aspectRatio: "3:2", noText: true,
    promptHint: "A branded apparel mockup on a garment, fashion product photography, blank garment with no text or print",
    overlay: { kind: "brandName", anchor: "center", theme: "light" } },
  clinic_signage: { role: "clinic_signage", label: "Clinic Signage", aspectRatio: "3:2", noText: true,
    promptHint: "A modern medical clinic signage mockup, professional healthcare branding, blank signage panel with no text",
    overlay: { kind: "brandName", anchor: "center", theme: "light" } },
  social_post: { role: "social_post", label: "Social Post", aspectRatio: "1:1", noText: true,
    promptHint: "A professional healthcare social media post visual, no text overlays",
    overlay: { kind: "brandTagline", anchor: "bottom", theme: "dark" } },
  brochure_cover: { role: "brochure_cover", label: "Brochure Cover", aspectRatio: "3:2", noText: true,
    promptHint: "A medical clinic brochure cover design, clean healthcare graphic design",
    overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  brochure: { role: "brochure", label: "Brochure", aspectRatio: "3:2", noText: true,
    promptHint: "A real estate property brochure cover design, premium property marketing",
    overlay: { kind: "brandTagline", anchor: "center", theme: "dark" } },
  banner: { role: "banner", label: "Banner", aspectRatio: "16:9", noText: true,
    promptHint: "A real estate marketing banner design, premium property visual",
    overlay: { kind: "brandName", anchor: "bottom", theme: "dark" } },
  social_ad: { role: "social_ad", label: "Social Ad", aspectRatio: "1:1", noText: true,
    promptHint: "A real estate social media advertisement visual, no text overlays",
    overlay: { kind: "brandTagline", anchor: "bottom", theme: "dark" } },
};

async function rebuildGallery(portfolioId: number) {
  const [portfolio] = await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, portfolioId)).limit(1);
  if (!portfolio) return;
  const allAssets = await db.select().from(aiPortfolioAssetsTable)
    .where(eq(aiPortfolioAssetsTable.portfolioId, portfolioId))
    .orderBy(aiPortfolioAssetsTable.displayOrder);
  const usable = allAssets.filter((a) => a.previewUrl);
  const mainMockup = usable.find((a) => a.assetRole === "main_brand_mockup") ?? usable[0];
  const coverImage = mainMockup?.previewUrl ?? null;
  const galleryJson = usable.map((a) => ({ role: a.assetRole, label: a.title, url: a.previewUrl, thumbnailUrl: a.thumbnailUrl, altText: a.altText }));
  const failedCount = allAssets.filter((a) => (a.metadataJson as { status?: string } | null)?.status === "failed").length;
  const meta = (portfolio.metadataJson as Record<string, unknown>) ?? {};
  const newMeta = { ...meta, assetSummary: { ...(meta["assetSummary"] as Record<string, unknown> ?? {}), failed: failedCount, completed: allAssets.length - failedCount } };
  await db.update(aiServicePortfoliosTable).set({ coverImage, galleryJson, metadataJson: newMeta, updatedAt: new Date() } as Record<string, unknown>)
    .where(eq(aiServicePortfoliosTable.id, portfolioId));
  return failedCount;
}

async function main() {
  const maxAssets = parseInt(process.argv[2] ?? "3", 10);
  const onlyPortfolioId = process.argv[3] ? parseInt(process.argv[3], 10) : null;

  const portfolios = onlyPortfolioId
    ? await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, onlyPortfolioId))
    : await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.isDemo, true));

  let processed = 0;
  for (const portfolio of portfolios) {
    if (processed >= maxAssets) break;
    const assets = await db.select().from(aiPortfolioAssetsTable).where(eq(aiPortfolioAssetsTable.portfolioId, portfolio.id));
    const failed = assets.filter((a) => (a.metadataJson as { status?: string } | null)?.status === "failed" && ROLE_DEFS[a.assetRole]);
    if (!failed.length) continue;

    const meta = (portfolio.metadataJson as Record<string, unknown>) ?? {};
    const creativeDirection = (meta["creativeDirection"] as Record<string, unknown>) ?? {};
    const brandName = String(meta["brandName"] ?? portfolio.title);
    const imageBrief: Record<string, unknown> = {
      brandName,
      businessType: portfolio.businessType ?? portfolio.industry,
      stylePreference: portfolio.style,
      goal: "Showcase a high-quality fictional brand identity for the public demo portfolio gallery",
      visualStyle: (creativeDirection as { visual_style?: unknown }).visual_style,
      colorDirection: (creativeDirection as { color_direction?: unknown }).color_direction,
      tagline: String(meta["tagline"] ?? ""),
      industry: portfolio.industry,
    };

    const budget = Math.min(failed.length, maxAssets - processed);
    const targets = failed.slice(0, budget);
    const roles = targets.map((a) => ROLE_DEFS[a.assetRole]!);

    console.log(`[portfolio ${portfolio.id}] ${brandName}: regenerating ${roles.map((r) => r.role).join(", ")}`);
    const generated = await generateNamedAssetSet(imageBrief, roles, { maxRetryPerAsset: 2 });

    for (const result of generated) {
      const asset = targets.find((a) => a.assetRole === result.role);
      if (!asset) continue;
      await db.update(aiPortfolioAssetsTable).set({
        thumbnailUrl: result.imageUrl,
        previewUrl: result.imageUrl,
        mimeType: result.status === "completed" ? "image/webp" : null,
        altText: result.status === "completed" ? `${result.label} — ${brandName} (AI Demo Project)` : null,
        metadataJson: { status: result.status, qcScore: result.qcScore, qcNotes: result.qcNotes, cost: result.cost, retries: result.retries, prompt: result.prompt },
        updatedAt: new Date(),
      } as Record<string, unknown>).where(eq(aiPortfolioAssetsTable.id, asset.id));
      console.log(`  ${result.role}: ${result.status} (qc=${result.qcScore})`);
      processed++;
    }

    const remaining = await rebuildGallery(portfolio.id);
    console.log(`  [portfolio ${portfolio.id}] remaining failed: ${remaining}`);
  }

  console.log(`Processed ${processed} asset(s) this run.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
