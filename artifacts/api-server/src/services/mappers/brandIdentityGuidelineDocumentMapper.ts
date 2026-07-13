/**
 * brandIdentityGuidelineDocumentMapper.ts — Phase 3 Creative Document Engine
 *
 * Maps brand strategy + creative direction outputs + visual assets into a
 * Brand Identity Guideline PDF.
 *
 * Key rules:
 *  - Requires at least one valid logo/image asset (enforced by executeGenericPdfExportJob).
 *  - Optional mockup/visual assets are included if available; skipped with a
 *    note in the generation report if missing — never uses placeholders.
 *  - Color and typography come from the AI creative direction output.
 *  - All assets must belong to the project (ownership enforced in image download).
 *  - Minimum page count: 6.
 *  - At least one logo image must be embedded.
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

interface BrandIdentityContent {
  positioning:         string;
  brandValues:         string[];
  brandPersonality:    string[];
  toneOfVoice:         string;
  competitiveAdv:      string;
  creativeConcept:     string;
  conceptRationale:    string;
  campaignConcept:     string;
  colorPrimary:        string;
  colorSecondary:      string;
  colorAccent:         string;
  colorRationale:      string;
  typographyHeadline:  string;
  typographyBody:      string;
  typographyHierarchy: string;
  imageryDirection:    string;
  visualApproach:      string;
  visualMood:          string;
}

export function normalizeBrandIdentityContent(
  project: CreativeProject,
): { content: BrandIdentityContent } {
  const result    = obj(project.result);
  const bs        = obj(result["brandStrategy"]);
  const cd        = obj(result["creativeDirection"]);
  const concept   = obj(cd["creative_concept"]);
  const colorDir  = obj(cd["color_direction"]);
  const typography = obj(cd["typography"]);
  const visualStyle = obj(cd["visual_style"]);

  const content: BrandIdentityContent = {
    positioning:         str(bs["positioning"]),
    brandValues:         strArr(bs["brand_values"]),
    brandPersonality:    strArr(bs["brand_personality"]),
    toneOfVoice:         str(bs["tone_of_voice"]),
    competitiveAdv:      str(bs["competitive_advantage"]),
    creativeConcept:     str(concept["name"]) || str(concept["description"]),
    conceptRationale:    str(concept["rationale"]),
    campaignConcept:     str(cd["campaign_concept"]),
    colorPrimary:        str(colorDir["primary"]),
    colorSecondary:      str(colorDir["secondary"]),
    colorAccent:         str(colorDir["accent"]),
    colorRationale:      str(colorDir["rationale"]),
    typographyHeadline:  str(typography["headline_style"]),
    typographyBody:      str(typography["body_style"]),
    typographyHierarchy: str(typography["hierarchy"]),
    imageryDirection:    str(cd["imagery_direction"]),
    visualApproach:      str(visualStyle["approach"]),
    visualMood:          str(visualStyle["mood"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildBrandIdentityGuidelineSpec(
  project: CreativeProject,
  content: BrandIdentityContent,
  coverImageBuffer: Buffer | null,      // Treated as primary logo
  inlineImages: Array<{ buffer: Buffer; caption?: string }>,  // Mockups / supporting assets
): { spec: CreativeDocumentSpec; report: Record<string, unknown> } {
  const sections: CreativeDocumentSection[] = [];
  const included: string[] = [];
  const skipped:  Array<{ id: string; reason: string }> = [];

  // The cover image IS the logo for brand identity documents
  const hasLogo = coverImageBuffer !== null;

  function add(id: string, ...items: CreativeDocumentSection[]) {
    included.push(id);
    sections.push(...items);
  }
  function skip(id: string, reason: string) {
    skipped.push({ id, reason });
  }

  // Brand Overview
  add("brand-overview",
    { type: "heading",   title: "Brand Overview" },
    { type: "paragraph", text: `${project.brandName} is a ${project.businessType} serving ${project.targetMarket}.` },
    { type: "paragraph", text: `Products & Services: ${project.productOrService}` },
  );

  // Brand Story
  if (content.positioning) {
    add("brand-story",
      { type: "heading", title: "Brand Story & Positioning" },
      { type: "quote",   text: content.positioning, attribution: project.brandName },
    );
    if (content.competitiveAdv) {
      sections.push({ type: "paragraph", text: content.competitiveAdv });
    }
  } else skip("brand-story", "No positioning statement available");

  // Brand Values
  if (content.brandValues.length >= 2) {
    add("brand-values",
      { type: "heading", title: "Brand Values" },
      { type: "bullets", items: content.brandValues },
    );
  } else skip("brand-values", "Fewer than 2 brand values");

  // ── Logo Section ────────────────────────────────────────────────────────────

  if (hasLogo && coverImageBuffer) {
    add("logo-primary",
      { type: "pageBreak" },
      { type: "heading", title: "Logo — Primary Version" },
      { type: "image",
        imageUrl:    "",
        imageBuffer: coverImageBuffer,
        caption:     `${project.brandName} Primary Logo`,
        alt:         `${project.brandName} logo`,
      },
    );
  } else {
    skip("logo-primary", "No logo asset available — skipped");
  }

  // Logo Usage Rules (always included as guidance)
  add("logo-usage",
    { type: "heading", title: "Logo Usage Guidelines" },
    { type: "bullets", items: [
      "Always use the logo on approved background colors only",
      "Maintain minimum clear space equal to the logo height on all sides",
      "Never distort, rotate, or change logo proportions",
      "Never place the logo on busy or clashing backgrounds",
      "Always use the highest-resolution file format available",
    ]},
  );

  // ── Color Palette ────────────────────────────────────────────────────────────

  const colorItems: string[] = [];
  if (content.colorPrimary)   colorItems.push(`Primary Color: ${content.colorPrimary}`);
  if (content.colorSecondary) colorItems.push(`Secondary Color: ${content.colorSecondary}`);
  if (content.colorAccent)    colorItems.push(`Accent Color: ${content.colorAccent}`);

  if (colorItems.length > 0) {
    add("color-palette",
      { type: "pageBreak" },
      { type: "heading", title: "Color Palette" },
      { type: "bullets", items: colorItems },
    );
    if (content.colorRationale) {
      sections.push({ type: "paragraph", text: content.colorRationale });
    }
  } else skip("color-palette", "No color direction in creative direction output");

  // Color Usage Rules
  add("color-usage",
    { type: "heading", title: "Color Usage Rules" },
    { type: "bullets", items: [
      `Use the primary color for main backgrounds and primary actions`,
      `Use the secondary color for supporting elements and typography`,
      `Use the accent color sparingly for emphasis and CTAs only`,
      `Maintain sufficient contrast for accessibility (WCAG AA minimum)`,
    ]},
  );

  // ── Typography ───────────────────────────────────────────────────────────────

  const typoItems: string[] = [];
  if (content.typographyHeadline) typoItems.push(`Headlines: ${content.typographyHeadline}`);
  if (content.typographyBody)     typoItems.push(`Body Text: ${content.typographyBody}`);
  if (content.typographyHierarchy) typoItems.push(`Hierarchy: ${content.typographyHierarchy}`);

  if (typoItems.length > 0) {
    add("typography",
      { type: "heading", title: "Typography System" },
      { type: "bullets", items: typoItems },
    );
  } else skip("typography", "No typography direction in creative output");

  // ── Brand Voice ──────────────────────────────────────────────────────────────

  if (content.toneOfVoice || content.brandPersonality.length > 0) {
    add("brand-voice",
      { type: "pageBreak" },
      { type: "heading", title: "Brand Voice" },
    );
    if (content.toneOfVoice) {
      sections.push({ type: "paragraph", text: content.toneOfVoice });
    }
    if (content.brandPersonality.length > 0) {
      sections.push(
        { type: "heading", title: "Brand Personality Traits" },
        { type: "bullets", items: content.brandPersonality },
      );
    }
  } else skip("brand-voice", "No tone or personality in strategy output");

  // ── Photography & Imagery Direction ─────────────────────────────────────────

  if (content.imageryDirection || content.visualMood || content.visualApproach) {
    const imageryItems: string[] = [];
    if (content.visualApproach)   imageryItems.push(`Visual Style: ${content.visualApproach}`);
    if (content.visualMood)       imageryItems.push(`Mood: ${content.visualMood}`);

    add("imagery-direction",
      { type: "heading", title: "Photography & Imagery Direction" },
    );
    if (imageryItems.length > 0) {
      sections.push({ type: "bullets", items: imageryItems });
    }
    if (content.imageryDirection) {
      sections.push({ type: "paragraph", text: content.imageryDirection });
    }
  } else skip("imagery-direction", "No imagery direction in creative output");

  // ── Creative Concept / Applications ─────────────────────────────────────────

  if (content.creativeConcept || content.campaignConcept) {
    add("applications",
      { type: "heading", title: "Applications & Campaign Concept" },
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
  } else skip("applications", "No creative concept available");

  // ── Optional Mockups ─────────────────────────────────────────────────────────

  const mockupImages = inlineImages.filter((img) => img.buffer.length > 0);
  if (mockupImages.length > 0) {
    add("mockups",
      { type: "pageBreak" },
      { type: "heading", title: "Brand Applications & Mockups" },
    );
    for (let i = 0; i < Math.min(mockupImages.length, 3); i++) {
      const img = mockupImages[i];
      if (img) {
        sections.push({
          type:        "image",
          imageUrl:    "",
          imageBuffer: img.buffer,
          caption:     img.caption ?? `${project.brandName} — Application ${i + 1}`,
        });
      }
    }
  } else {
    skip("mockups", "No optional mockup images available — section omitted as per spec");
  }

  const primaryColor = content.colorPrimary || "#1a1a2e";
  const spec: CreativeDocumentSpec = {
    documentType: "brand_identity_guideline",
    title:        `${project.brandName} — Brand Identity Guidelines`,
    subtitle:     content.positioning || "Visual Identity System",
    company:      { name: project.brandName },
    theme: {
      primaryColor,
      secondaryColor: content.colorSecondary || "#16213e",
      accentColor:    content.colorAccent    || "#e94560",
    },
    cover: {
      title:       project.brandName,
      tagline:     "Brand Identity Guidelines",
      subtitle:    "Visual Identity System",
      imageBuffer: coverImageBuffer,  // logo as cover image
    },
    sections,
    footer: {
      text:           `${project.brandName} — Brand Identity Guidelines`,
      showPageNumber: true,
    },
    closing: {
      text: `These guidelines define the ${project.brandName} visual identity system. Apply them consistently across all brand touchpoints.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "brand_identity_guideline",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: hasLogo,
      logoEmbedded:       hasLogo,
      mockupsIncluded:    mockupImages.length,
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const brandIdentityGuidelineDefinition: DocumentDefinition = {
  documentType:     "brand_identity_guideline",
  filenamePrefix:   "brand-identity-guideline",
  minimumPageCount: 6,
  requiresLogo:     true,  // ← enforced: job fails if no logo asset exists
  maxInlineImages:  3,     // logo (index 0) + up to 3 mockups (indices 1-3)

  generateContent: async (project) => {
    const { content } = normalizeBrandIdentityContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildBrandIdentityGuidelineSpec(
      project,
      content as unknown as BrandIdentityContent,
      coverImageBuffer,
      inlineImages,
    ),
};
