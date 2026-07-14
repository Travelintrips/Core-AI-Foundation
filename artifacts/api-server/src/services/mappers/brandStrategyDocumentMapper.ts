/**
 * brandStrategyDocumentMapper.ts — Phase 3 Creative Document Engine
 *
 * Normalizes the Brand Strategist + Copywriter + Creative Director workflow
 * outputs into a CreativeDocumentSpec for the Brand Strategy PDF.
 *
 * NO fabricated facts: all content comes directly from the AI pipeline
 * outputs stored in project.result. Missing sections are skipped cleanly.
 *
 * Minimum page count: 6
 */

import type { CreativeProject } from "@workspace/db";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../creativeDocumentService.js";
import type { DocumentDefinition } from "../creativeDocumentWorkerService.js";

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

// ── Content normaliser ────────────────────────────────────────────────────────

interface BrandStrategyContent {
  positioning:          string;
  brandValues:          string[];
  competitiveAdvantage: string;
  brandPersonality:     string[];
  keyMessages:          string[];
  toneOfVoice:          string;
  targetPrimary:        string;
  psychographics:       string[];
  painPoints:           string[];
  creativeConcept:      string;
  conceptRationale:     string;
  colorRationale:       string;
  typographyHeadline:   string;
  typographyBody:       string;
  imageryDirection:     string;
  campaignConcept:      string;
  colorPrimary:         string;
  colorSecondary:       string;
  colorAccent:          string;
  tagline:              string;
  primaryHeadline:      string;
  alternativeHeadlines: string[];
  bodyLong:             string;
}

export function normalizeBrandStrategyContent(
  project: CreativeProject,
): { content: BrandStrategyContent } {
  const result = obj(project.result);
  const bs  = obj(result["brandStrategy"]);
  const cd  = obj(result["creativeDirection"]);
  const cw  = obj(result["copy"]);
  const qc  = obj(result["qcReview"]);

  const audience    = obj(bs["target_audience"]);
  const concept     = obj(cd["creative_concept"]);
  const visualStyle = obj(cd["visual_style"]);
  const colorDir    = obj(cd["color_direction"]);
  const typography  = obj(cd["typography"]);
  const headline    = obj(cw["headline"]);
  const bodyCopy    = obj(cw["body_copy"]);

  // Messaging pillars: deduplicate from key_messages and QC strengths
  const pillarsRaw = strArr(bs["key_messages"]).concat(strArr(qc["strengths"]));
  const pillarsSeen = new Set<string>();
  const pillars = pillarsRaw.filter((p) => {
    if (pillarsSeen.has(p)) return false;
    pillarsSeen.add(p);
    return true;
  });

  const content: BrandStrategyContent = {
    positioning:          str(bs["positioning"]),
    brandValues:          strArr(bs["brand_values"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    brandPersonality:     strArr(bs["brand_personality"]),
    keyMessages:          pillars,
    toneOfVoice:          str(bs["tone_of_voice"]),
    targetPrimary:        str(audience["primary"]),
    psychographics:       strArr(audience["psychographics"]),
    painPoints:           strArr(audience["pain_points"]),
    creativeConcept:      str(concept["name"]) || str(concept["description"]),
    conceptRationale:     str(concept["rationale"]),
    colorRationale:       str(colorDir["rationale"]),
    typographyHeadline:   str(typography["headline_style"]),
    typographyBody:       str(typography["body_style"]),
    imageryDirection:     str(cd["imagery_direction"]),
    campaignConcept:      str(cd["campaign_concept"]),
    colorPrimary:         str(colorDir["primary"]),
    colorSecondary:       str(colorDir["secondary"]),
    colorAccent:          str(colorDir["accent"]),
    tagline:              str(cw["tagline"]),
    primaryHeadline:      str(headline["primary"]),
    alternativeHeadlines: strArr(headline["alternatives"]),
    bodyLong:             str(bodyCopy["long"]) || str(bodyCopy["short"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildBrandStrategySpec(
  project: CreativeProject,
  content: BrandStrategyContent,
  coverImageBuffer: Buffer | null,
  _inlineImages: Array<{ buffer: Buffer; caption?: string }>,
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

  // Executive Summary
  if (content.positioning) {
    add("executive-summary",
      { type: "heading",   title: "Executive Summary" },
      { type: "paragraph", text: `${project.brandName} is positioned as: ${content.positioning}` },
    );
  } else skip("executive-summary", "No positioning statement available");

  // Business Context
  const bizContext = [project.businessType, project.productOrService].filter(Boolean).join(" — ");
  add("business-context",
    { type: "heading",   title: "Business Context" },
    { type: "paragraph", text: bizContext },
    { type: "paragraph", text: `Goal: ${project.goal}` },
  );

  // Brand Overview
  if (content.brandValues.length >= 2) {
    add("brand-values",
      { type: "heading", title: "Brand Values" },
      { type: "bullets", items: content.brandValues },
    );
  } else skip("brand-values", "Fewer than 2 brand values");

  // Market Context
  if (content.competitiveAdvantage) {
    add("competitive-advantage",
      { type: "heading",   title: "Competitive Advantage" },
      { type: "paragraph", text: content.competitiveAdvantage },
    );
  } else skip("competitive-advantage", "No competitive advantage in output");

  // Target Audience
  if (content.targetPrimary) {
    add("target-audience",
      { type: "heading",   title: "Target Audience", subtitle: "Primary" },
      { type: "paragraph", text: content.targetPrimary },
    );
    if (content.psychographics.length > 0) {
      sections.push({ type: "bullets", items: content.psychographics });
    }
  } else skip("target-audience", "No primary audience description");

  // Audience Needs and Pain Points
  if (content.painPoints.length > 0) {
    add("pain-points",
      { type: "heading", title: "Audience Needs & Pain Points" },
      { type: "bullets", items: content.painPoints },
    );
  } else skip("pain-points", "No pain points in output");

  // Brand Positioning
  if (content.positioning) {
    add("positioning",
      { type: "pageBreak" },
      { type: "heading", title: "Brand Positioning" },
      { type: "quote",   text: content.positioning, attribution: project.brandName },
    );
  }

  // Brand Personality & Archetype
  if (content.brandPersonality.length >= 2) {
    add("brand-personality",
      { type: "heading", title: "Brand Personality" },
      { type: "bullets", items: content.brandPersonality },
    );
  } else skip("brand-personality", "Fewer than 2 personality traits");

  // Tone of Voice
  if (content.toneOfVoice) {
    add("tone-of-voice",
      { type: "heading",   title: "Tone of Voice" },
      { type: "paragraph", text: content.toneOfVoice },
    );
  } else skip("tone-of-voice", "No tone of voice in output");

  // Messaging Pillars
  if (content.keyMessages.length >= 2) {
    add("messaging-pillars",
      { type: "heading", title: "Messaging Pillars & Key Messages" },
      { type: "bullets", items: content.keyMessages },
    );
  } else skip("messaging-pillars", "Fewer than 2 key messages");

  // Value Proposition (tagline + headline)
  if (content.tagline || content.primaryHeadline) {
    const items: CreativeDocumentSection[] = [
      { type: "heading", title: "Value Proposition" },
    ];
    if (content.tagline) {
      items.push({ type: "quote", text: content.tagline, attribution: "Brand Tagline" });
    }
    if (content.primaryHeadline) {
      items.push({ type: "paragraph", text: content.primaryHeadline });
    }
    if (content.alternativeHeadlines.length > 0) {
      items.push({ type: "bullets", items: content.alternativeHeadlines });
    }
    add("value-proposition", ...items);
  } else skip("value-proposition", "No tagline or headline");

  // Creative Concept / Campaign Direction
  if (content.creativeConcept || content.campaignConcept) {
    add("campaign-concept",
      { type: "pageBreak" },
      { type: "heading", title: "Campaign Concept & Creative Direction" },
    );
    if (content.creativeConcept) {
      sections.push({ type: "paragraph", text: content.creativeConcept });
    }
    if (content.conceptRationale) {
      sections.push({ type: "paragraph", text: content.conceptRationale });
    }
    if (content.campaignConcept) {
      sections.push({ type: "quote", text: content.campaignConcept });
    }
  } else skip("campaign-concept", "No creative concept in output");

  // Imagery Direction
  if (content.imageryDirection) {
    add("imagery-direction",
      { type: "heading",   title: "Photography & Imagery Direction" },
      { type: "paragraph", text: content.imageryDirection },
    );
  } else skip("imagery-direction", "No imagery direction");

  // Color palette (visual summary)
  const colorItems: string[] = [];
  if (content.colorPrimary)   colorItems.push(`Primary: ${content.colorPrimary}`);
  if (content.colorSecondary) colorItems.push(`Secondary: ${content.colorSecondary}`);
  if (content.colorAccent)    colorItems.push(`Accent: ${content.colorAccent}`);
  if (content.colorRationale) colorItems.push(`Rationale: ${content.colorRationale}`);
  if (colorItems.length > 0) {
    add("color-direction",
      { type: "heading", title: "Color Direction" },
      { type: "bullets", items: colorItems },
    );
  } else skip("color-direction", "No color direction in output");

  // Typography
  if (content.typographyHeadline || content.typographyBody) {
    const typoItems: string[] = [];
    if (content.typographyHeadline) typoItems.push(`Headline: ${content.typographyHeadline}`);
    if (content.typographyBody)     typoItems.push(`Body: ${content.typographyBody}`);
    add("typography",
      { type: "heading", title: "Typography Direction" },
      { type: "bullets", items: typoItems },
    );
  } else skip("typography", "No typography direction");

  // Implementation priorities (target market + goal)
  add("implementation",
    { type: "pageBreak" },
    { type: "heading",   title: "Implementation Priorities" },
    { type: "paragraph", text: `Target Market: ${project.targetMarket}` },
    { type: "paragraph", text: `Strategic Goal: ${project.goal}` },
  );

  // Long-form copy as appendix
  if (content.bodyLong) {
    add("brand-copy",
      { type: "heading",   title: "Brand Description" },
      { type: "paragraph", text: content.bodyLong },
    );
  }

  // Build spec
  const primaryColor = content.colorPrimary || "#1a365d";
  const spec: CreativeDocumentSpec = {
    documentType: "brand_strategy",
    title:        `${project.brandName} — Brand Strategy`,
    subtitle:     content.tagline || content.positioning || undefined,
    company:      { name: project.brandName },
    theme: {
      primaryColor,
      secondaryColor: content.colorSecondary || "#2d3748",
      accentColor:    content.colorAccent    || "#c05621",
    },
    cover: {
      title:       project.brandName,
      tagline:     content.tagline || content.positioning,
      subtitle:    "Brand Strategy Document",
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Brand Strategy`,
      showPageNumber: true,
    },
    closing: {
      text: `This brand strategy was developed to guide ${project.brandName}'s positioning and communications.`,
    },
  };

  return {
    spec,
    report: {
      documentType:     "brand_strategy",
      sectionsIncluded: included,
      sectionsSkipped:  skipped,
      coverImageIncluded: !!coverImageBuffer,
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const brandStrategyDefinition: DocumentDefinition = {
  documentType:     "brand_strategy",
  filenamePrefix:   "brand-strategy",
  minimumPageCount: 6,
  requiresLogo:     false,
  maxInlineImages:  2,

  generateContent: async (project) => {
    const { content } = normalizeBrandStrategyContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildBrandStrategySpec(
      project,
      content as unknown as BrandStrategyContent,
      coverImageBuffer,
      inlineImages,
    ),
};
