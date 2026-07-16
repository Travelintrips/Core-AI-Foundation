/**
 * fashionDesignDocumentMapper.ts — Fashion Design Brief PDF mapper.
 *
 * Normalizes the 5-agent Fashion Design pipeline outputs into a
 * CreativeDocumentSpec for PDF rendering.
 *
 * Minimum page count: 5
 */

import type { CreativeProject } from "@workspace/db";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../creativeDocumentService.js";
import type { DocumentDefinition } from "../creativeDocumentWorkerService.js";

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

interface FashionDesignContent {
  brandEssence:           string;
  brandValues:            string[];
  positioning:            string;
  targetProfile:          string;
  collectionNarrative:    string;
  collectionConceptTitle: string;
  collectionTheme:        string;
  colorPaletteStory:      string;
  keyShapes:              string[];
  heroFabrics:            string[];
  lookbookSetting:        string;
  collectionName:         string;
  collectionTagline:      string;
  collectionStatement:    string;
  lookbookIntro:          string;
  campaignHeadline:       string;
  socialLaunchPost:       string;
  trendLongevity:         string;
  commercialPotential:    string;
  marketStrengths:        string[];
  overallScore:           number;
  approved:               boolean;
  approvalNotes:          string;
}

function normalizeFashionContent(project: CreativeProject): FashionDesignContent {
  const result   = obj(project.result);
  const strategy = obj(result["fashionBrandStrategy"]);
  const creative = obj(result["fashionCreativeDirection"]);
  const copy     = obj(result["fashionCollectionCopy"]);
  const trend    = obj(result["fashionTrendAnalysis"]);
  const qc       = obj(result["fashionQcReview"]);

  const brandDna       = obj(strategy["brand_dna"]);
  const positioning    = obj(strategy["positioning"]);
  const targetCustomer = obj(strategy["target_customer"]);
  const collStrategy   = obj(strategy["collection_strategy"]);
  const concept        = obj(creative["collection_concept"]);
  const colorPalette   = obj(creative["color_palette"]);
  const silhouettes    = obj(creative["silhouette_direction"]);
  const fabrics        = obj(creative["fabric_material_direction"]);
  const lookbook       = obj(creative["lookbook_art_direction"]);
  const collectionName = obj(copy["collection_name"]);
  const campaignCopy   = obj(copy["campaign_copy"]);
  const socialCopy     = obj(copy["social_copy"]);
  const trendAlign     = obj(trend["trend_alignment"]);
  const marketFit      = obj(trend["market_fit_analysis"]);

  return {
    brandEssence:           str(brandDna["essence"]),
    brandValues:            strArr(brandDna["values"]),
    positioning:            str(positioning["statement"]),
    targetProfile:          str(targetCustomer["profile"]),
    collectionNarrative:    str(collStrategy["narrative"]),
    collectionConceptTitle: str(concept["title"]),
    collectionTheme:        str(concept["theme"]),
    colorPaletteStory:      str(colorPalette["palette_story"]),
    keyShapes:              strArr(silhouettes["key_shapes"]),
    heroFabrics:            strArr(fabrics["hero_fabrics"]),
    lookbookSetting:        str(lookbook["setting"]),
    collectionName:         str(collectionName["primary"]),
    collectionTagline:      str(copy["collection_tagline"]),
    collectionStatement:    str(copy["collection_statement"]),
    lookbookIntro:          str(copy["lookbook_intro"]),
    campaignHeadline:       str(campaignCopy["headline"]),
    socialLaunchPost:       str(socialCopy["launch_post"]),
    trendLongevity:         str(trendAlign["trend_longevity"]),
    commercialPotential:    str(marketFit["commercial_potential"]),
    marketStrengths:        strArr(trend["strengths"]),
    overallScore:           typeof qc["overall_score"] === "number" ? (qc["overall_score"] as number) : 0,
    approved:               qc["approved"] === true,
    approvalNotes:          str(qc["approval_notes"]),
  };
}

function buildFashionDesignSpec(
  project: CreativeProject,
  rawContent: Record<string, unknown>,
  coverImageBuffer: Buffer | null,
  _inlineImages: Array<{ buffer: Buffer; caption?: string }>,
): { spec: CreativeDocumentSpec; report: Record<string, unknown> } {
  const content = rawContent as unknown as FashionDesignContent;
  const sections: CreativeDocumentSection[] = [];
  const included: string[] = [];
  const skipped:  string[] = [];

  function add(id: string, ...items: CreativeDocumentSection[]) { sections.push(...items); included.push(id); }
  function skip(id: string) { skipped.push(id); }

  // Brand DNA
  if (content.brandEssence || content.brandValues.length) {
    add("brand-dna",
      { type: "heading",   title: "Brand DNA" },
      { type: "paragraph", text: content.brandEssence },
      ...(content.brandValues.length ? [{ type: "bullets" as const, items: content.brandValues }] : []),
      ...(content.positioning ? [{ type: "paragraph" as const, text: `Positioning: ${content.positioning}` }] : []),
    );
  } else skip("brand-dna");

  // Target Customer
  if (content.targetProfile) {
    add("target-customer",
      { type: "heading",   title: "Target Customer" },
      { type: "paragraph", text: content.targetProfile },
    );
  } else skip("target-customer");

  // Collection Concept
  if (content.collectionConceptTitle || content.collectionTheme) {
    add("collection-concept",
      { type: "heading",   title: content.collectionConceptTitle || "Collection Concept" },
      ...(content.collectionTheme ? [{ type: "paragraph" as const, text: content.collectionTheme }] : []),
      ...(content.collectionNarrative ? [{ type: "paragraph" as const, text: content.collectionNarrative }] : []),
    );
  } else skip("collection-concept");

  // Collection Identity
  if (content.collectionName || content.collectionTagline) {
    add("collection-identity",
      { type: "heading", title: "Collection Identity" },
      ...(content.collectionName ? [{ type: "paragraph" as const, text: `Collection: ${content.collectionName}` }] : []),
      ...(content.collectionTagline ? [{ type: "quote" as const, text: content.collectionTagline, attribution: project.brandName }] : []),
      ...(content.collectionStatement ? [{ type: "paragraph" as const, text: content.collectionStatement }] : []),
    );
  } else skip("collection-identity");

  // Design Direction
  const designItems: string[] = [
    content.colorPaletteStory ? `Color Story: ${content.colorPaletteStory}` : "",
    content.heroFabrics.length ? `Hero Fabrics: ${content.heroFabrics.join(", ")}` : "",
    content.lookbookSetting ? `Lookbook Setting: ${content.lookbookSetting}` : "",
  ].filter(Boolean);
  if (designItems.length || content.keyShapes.length) {
    add("design-direction",
      { type: "heading", title: "Design Direction" },
      ...(designItems.map((t) => ({ type: "paragraph" as const, text: t }))),
      ...(content.keyShapes.length ? [{ type: "bullets" as const, items: content.keyShapes }] : []),
    );
  } else skip("design-direction");

  // Lookbook Copy
  if (content.lookbookIntro) {
    add("lookbook-copy",
      { type: "heading",   title: "Lookbook" },
      { type: "paragraph", text: content.lookbookIntro },
    );
  } else skip("lookbook-copy");

  // Campaign
  if (content.campaignHeadline) {
    add("campaign",
      { type: "heading",   title: "Campaign" },
      { type: "quote",     text: content.campaignHeadline, attribution: "Campaign Headline" },
      ...(content.socialLaunchPost ? [{ type: "paragraph" as const, text: content.socialLaunchPost }] : []),
    );
  } else skip("campaign");

  // Market Intelligence
  if (content.marketStrengths.length || content.trendLongevity) {
    add("market-intelligence",
      { type: "heading", title: "Market Intelligence" },
      ...(content.trendLongevity ? [{ type: "paragraph" as const, text: `Trend Cycle: ${content.trendLongevity}` }] : []),
      ...(content.commercialPotential ? [{ type: "paragraph" as const, text: `Commercial Potential: ${content.commercialPotential}` }] : []),
      ...(content.marketStrengths.length ? [{ type: "bullets" as const, items: content.marketStrengths }] : []),
    );
  } else skip("market-intelligence");

  const spec: CreativeDocumentSpec = {
    documentType: "fashion_design",
    title:        `${project.brandName} — Fashion Design Brief`,
    cover: {
      title:       project.brandName,
      tagline:     content.collectionTagline || content.collectionTheme,
      subtitle:    content.collectionName || "Fashion Design Brief",
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Fashion Design Brief`,
      showPageNumber: true,
    },
    closing: {
      text: `This fashion design brief was crafted to guide the creative direction and market positioning of ${project.brandName}'s collection.`,
    },
  };

  return {
    spec,
    report: {
      documentType:     "fashion_design",
      sectionsIncluded: included,
      sectionsSkipped:  skipped,
      overallScore:     content.overallScore,
      approved:         content.approved,
    },
  };
}

export const fashionDesignDefinition: DocumentDefinition = {
  documentType:     "fashion_design",
  filenamePrefix:   "fashion-design-brief",
  minimumPageCount: 5,
  requiresLogo:     false,
  maxInlineImages:  3,

  generateContent: async (project) => {
    const content = normalizeFashionContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: buildFashionDesignSpec,
};
