/**
 * productCatalogDocumentMapper.ts — Team 16: Presentation & Document Creative Services
 *
 * Maps a creative project's workflow outputs into a Product Catalog PDF.
 *
 * Anti-fabrication rules:
 *   - Prices, stock levels, availability dates → NEVER invented
 *   - Product descriptions sourced from AI copywriting output or project brief
 *   - Brand values used as feature bullets (never random marketing claims)
 *
 * Minimum page count: 4
 */

import type { CreativeProject } from "@workspace/db";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../../../services/creativeDocumentService.js";
import type { DocumentDefinition } from "../../../services/creativeDocumentWorkerService.js";
import { extractBrandDnaTheme } from "../brandDnaAdapter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Content interface ─────────────────────────────────────────────────────────

export interface ProductCatalogContent {
  about:                string;
  tagline:              string;
  brandValues:          string[];
  competitiveAdvantage: string;
  bodyShort:            string;
  bodyLong:             string;
  callToAction:         string;
  // Colors
  primaryColor:         string;
  secondaryColor:       string;
  accentColor:          string;
}

// ── Content normaliser ────────────────────────────────────────────────────────

export function normalizeProductCatalogContent(project: CreativeProject): { content: ProductCatalogContent } {
  const result   = obj(project.result);
  const bs       = obj(result["brandStrategy"]);
  const cd       = obj(result["creativeDirection"]);
  const copy     = obj(result["copy"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);

  const content: ProductCatalogContent = {
    about:                str(bs["positioning"]) || str(result["about"]),
    tagline:              str(copy["tagline"]),
    brandValues:          strArr(bs["brand_values"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    bodyShort:            str(bodyCopy["short"]),
    bodyLong:             str(bodyCopy["long"]) || str(copy["body_copy"]),
    callToAction:         str(copy["call_to_action"]),
    primaryColor:         str(colorDir["primary"]),
    secondaryColor:       str(colorDir["secondary"]),
    accentColor:          str(colorDir["accent"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildProductCatalogSpec(
  project: CreativeProject,
  content: ProductCatalogContent,
  coverImageBuffer: Buffer | null,
  inlineImages: Array<{ buffer: Buffer; caption?: string }>,
): { spec: CreativeDocumentSpec; report: Record<string, unknown> } {
  const sections: CreativeDocumentSection[] = [];
  const included: string[] = [];
  const skipped:  Array<{ id: string; reason: string }> = [];

  function add(id: string, ...items: CreativeDocumentSection[]) {
    included.push(id);
    sections.push(...items);
  }
  function skip(id: string, reason: string) {
    skipped.push({ id, reason });
  }

  // ── Brand Introduction ─────────────────────────────────────────────────────
  const aboutText = content.about || `${project.brandName} is a ${project.businessType} serving ${project.targetMarket}.`;
  add("brand-intro",
    { type: "heading",   title: "About Us" },
    { type: "paragraph", text: aboutText },
  );
  if (content.tagline) {
    sections.push({ type: "quote", text: content.tagline, attribution: project.brandName });
  }

  // ── Product / Service Category Overview ────────────────────────────────────
  add("categories",
    { type: "heading",   title: "Our Products & Services" },
    { type: "paragraph", text: project.productOrService },
  );

  // ── Featured Products / Services ───────────────────────────────────────────
  if (content.bodyLong || content.bodyShort) {
    add("products",
      { type: "heading",   title: "Featured Offerings" },
      { type: "paragraph", text: content.bodyLong || content.bodyShort },
    );
  } else {
    skip("products", "No detailed copy in workflow output");
  }

  // ── Inline product images ──────────────────────────────────────────────────
  for (const img of inlineImages.slice(0, 2)) {
    if (img.buffer.length > 0) {
      sections.push({
        type:        "image",
        imageUrl:    "",
        imageBuffer: img.buffer,
        caption:     img.caption,
      });
    }
  }

  // ── Key Features & Benefits ────────────────────────────────────────────────
  if (content.brandValues.length > 0) {
    add("features",
      { type: "heading", title: "Key Features & Benefits" },
      { type: "bullets", items: content.brandValues },
    );
  } else {
    skip("features", "No brand values in strategy output");
  }

  // ── Why We Stand Out ──────────────────────────────────────────────────────
  if (content.competitiveAdvantage) {
    add("differentiators",
      { type: "heading",   title: "Why We Stand Out" },
      { type: "paragraph", text: content.competitiveAdvantage },
    );
  } else {
    skip("differentiators", "No competitive advantage in strategy output");
  }

  // ── Target Market ─────────────────────────────────────────────────────────
  add("market",
    { type: "heading",   title: "Who We Serve" },
    { type: "paragraph", text: `${project.brandName} serves ${project.targetMarket}.` },
  );

  // ── How to Order ──────────────────────────────────────────────────────────
  const ctaText = content.callToAction
    || `Contact ${project.brandName} to place an order or request a quote.`;
  add("ordering",
    { type: "pageBreak" },
    { type: "heading",   title: "How to Get Started" },
    { type: "paragraph", text: ctaText },
    { type: "bullets",   items: ["Contact our team", "Get a personalised quote", "Begin your project"] },
  );

  // ── Contact ────────────────────────────────────────────────────────────────
  add("contact",
    { type: "heading",   title: "Get in Touch" },
    { type: "paragraph", text: `We look forward to working with you. Reach out to ${project.brandName} today.` },
  );

  // ── Brand DNA theme ────────────────────────────────────────────────────────
  const { theme: dnaTheme } = extractBrandDnaTheme(project, "product_catalog");
  const primaryColor   = (dnaTheme.primaryColor   ?? content.primaryColor)   || "#0f172a";
  const secondaryColor = (dnaTheme.secondaryColor ?? content.secondaryColor) || "#1e293b";
  const accentColor    = (dnaTheme.accentColor    ?? content.accentColor)    || "#f97316";

  const spec: CreativeDocumentSpec = {
    documentType: "product_catalog",
    title:        `${project.brandName} — Product Catalog`,
    subtitle:     content.tagline || undefined,
    company:      { name: project.brandName },
    theme:        { primaryColor, secondaryColor, accentColor },
    cover: {
      title:       project.brandName,
      subtitle:    "Product & Service Catalog",
      tagline:     content.tagline || undefined,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Product Catalog`,
      showPageNumber: true,
    },
    closing: {
      text: `${project.brandName} — Transforming ${project.targetMarket} with ${project.businessType} excellence.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "product_catalog",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
      inlineImagesUsed:   Math.min(inlineImages.length, 2),
      fabricationGuard:   "no_prices_or_stock_levels",
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const productCatalogDefinition: DocumentDefinition = {
  documentType:     "product_catalog",
  filenamePrefix:   "product-catalog",
  minimumPageCount: 4,
  requiresLogo:     false,
  maxInlineImages:  2,

  generateContent: async (project) => {
    const { content } = normalizeProductCatalogContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildProductCatalogSpec(
      project,
      content as unknown as ProductCatalogContent,
      coverImageBuffer,
      inlineImages,
    ),
};
