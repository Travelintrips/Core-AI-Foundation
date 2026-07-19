/**
 * ebookDocumentMapper.ts — Team 16: Presentation & Document Creative Services
 *
 * Maps a creative project's workflow outputs into an Ebook PDF.
 *
 * Anti-fabrication rules:
 *   - Research statistics, third-party citations → NEVER invented
 *   - Chapter content sourced from AI copywriting + brand strategy outputs
 *   - Table of contents is generated from actual included chapters
 *
 * Minimum page count: 8 (essential), 12 (professional)
 */

import type { CreativeProject } from "@workspace/db";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../../../services/creativeDocumentService.js";
import type { DocumentDefinition } from "../../../services/creativeDocumentWorkerService.js";
// CreativeDocumentType will include "ebook" once the integration team applies schemaExportsRequested
import type { CreativeDocumentType } from "../../../services/creativeProjectDocumentType.js";
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

export interface EbookContent {
  positioning:          string;
  competitiveAdvantage: string;
  brandValues:          string[];
  toneOfVoice:          string;
  bodyLong:             string;
  bodyShort:            string;
  tagline:              string;
  callToAction:         string;
  // Colors
  primaryColor:         string;
  secondaryColor:       string;
  accentColor:          string;
}

// ── Content normaliser ────────────────────────────────────────────────────────

export function normalizeEbookContent(project: CreativeProject): { content: EbookContent } {
  const result   = obj(project.result);
  const bs       = obj(result["brandStrategy"]);
  const cd       = obj(result["creativeDirection"]);
  const copy     = obj(result["copy"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);

  const content: EbookContent = {
    positioning:          str(bs["positioning"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    brandValues:          strArr(bs["brand_values"]),
    toneOfVoice:          str(bs["tone_of_voice"]),
    bodyLong:             str(bodyCopy["long"]) || str(copy["body_copy"]),
    bodyShort:            str(bodyCopy["short"]),
    tagline:              str(copy["tagline"]),
    callToAction:         str(copy["call_to_action"]),
    primaryColor:         str(colorDir["primary"]),
    secondaryColor:       str(colorDir["secondary"]),
    accentColor:          str(colorDir["accent"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildEbookSpec(
  project: CreativeProject,
  content: EbookContent,
  coverImageBuffer: Buffer | null,
  inlineImages: Array<{ buffer: Buffer; caption?: string }>,
): { spec: CreativeDocumentSpec; report: Record<string, unknown> } {
  const sections:       CreativeDocumentSection[] = [];
  const included:       string[] = [];
  const skipped:        Array<{ id: string; reason: string }> = [];
  const chaptersInToc:  string[] = [];

  function add(id: string, ...items: CreativeDocumentSection[]) {
    included.push(id);
    sections.push(...items);
  }
  function addChapter(id: string, title: string, ...items: CreativeDocumentSection[]) {
    chaptersInToc.push(title);
    add(id, ...items);
  }
  function skip(id: string, reason: string) {
    skipped.push({ id, reason });
  }

  // ── Preface ────────────────────────────────────────────────────────────────
  if (content.bodyShort || project.goal) {
    add("preface",
      { type: "heading",   title: "Preface" },
      { type: "paragraph", text: content.bodyShort || `This ebook explores: ${project.goal}` },
    );
  }

  // ── Table of Contents (built after chapters below) ─────────────────────────
  // We insert a placeholder ToC position; the actual ToC list is added after
  // chapter IDs are known. For the document engine, we emit bullets.
  const tocIndex = sections.length;

  // ── Chapter 1: The Landscape ───────────────────────────────────────────────
  addChapter("chapter-1", "Chapter 1: The Landscape",
    { type: "pageBreak" },
    { type: "heading",   title: "Chapter 1: The Landscape" },
    { type: "paragraph", text: content.positioning || `The current state of ${project.businessType} in ${project.targetMarket}.` },
  );

  // ── Chapter 2: The Challenge ───────────────────────────────────────────────
  addChapter("chapter-2", "Chapter 2: The Challenge",
    { type: "pageBreak" },
    { type: "heading",   title: "Chapter 2: The Challenge" },
    { type: "paragraph", text: project.goal || `The core challenge facing ${project.targetMarket}.` },
  );
  if (project.notes) {
    sections.push({ type: "paragraph", text: project.notes });
  }

  // ── Chapter 3: The Solution ────────────────────────────────────────────────
  addChapter("chapter-3", "Chapter 3: The Solution",
    { type: "pageBreak" },
    { type: "heading",   title: "Chapter 3: The Solution" },
    { type: "paragraph", text: `${project.brandName} addresses this challenge through: ${project.productOrService}` },
  );
  if (content.bodyLong) {
    sections.push({ type: "paragraph", text: content.bodyLong });
  }

  // ── Chapter 4: Getting Started ─────────────────────────────────────────────
  if (content.brandValues.length > 0 || content.competitiveAdvantage) {
    addChapter("chapter-4", "Chapter 4: Getting Started",
      { type: "pageBreak" },
      { type: "heading",   title: "Chapter 4: Getting Started" },
    );
    if (content.brandValues.length > 0) {
      sections.push({ type: "bullets", items: content.brandValues });
    }
    if (content.competitiveAdvantage) {
      sections.push({ type: "paragraph", text: content.competitiveAdvantage });
    }
  } else {
    skip("chapter-4", "No brand values or competitive advantage in strategy output");
  }

  // ── Chapter 5: Best Practices ─────────────────────────────────────────────
  if (content.toneOfVoice && content.brandValues.length > 2) {
    addChapter("chapter-5", "Chapter 5: Best Practices",
      { type: "pageBreak" },
      { type: "heading",   title: "Chapter 5: Best Practices" },
      { type: "paragraph", text: content.toneOfVoice },
      { type: "bullets",   items: content.brandValues.slice(0, 5) },
    );
  } else {
    skip("chapter-5", "Insufficient brand values for best practices chapter");
  }

  // ── Inline image ──────────────────────────────────────────────────────────
  if (inlineImages[0]) {
    sections.push({
      type:        "image",
      imageUrl:    "",
      imageBuffer: inlineImages[0].buffer,
      caption:     inlineImages[0].caption,
    });
  }

  // ── Conclusion ─────────────────────────────────────────────────────────────
  addChapter("conclusion", "Conclusion",
    { type: "pageBreak" },
    { type: "heading",   title: "Conclusion & Next Steps" },
    { type: "paragraph", text: `${project.brandName} is committed to helping ${project.targetMarket} succeed through ${project.productOrService}.` },
  );
  if (content.callToAction) {
    sections.push({ type: "paragraph", text: content.callToAction });
  }

  // ── About the Company ──────────────────────────────────────────────────────
  add("about",
    { type: "pageBreak" },
    { type: "heading",   title: "About the Company" },
    { type: "paragraph", text: `${project.brandName} is a ${project.businessType} dedicated to ${project.targetMarket}.` },
    content.tagline
      ? { type: "quote", text: content.tagline, attribution: project.brandName }
      : { type: "paragraph", text: `For more information, visit ${project.brandName}.` },
  );

  // ── Insert Table of Contents before Chapter 1 ─────────────────────────────
  const tocSection: CreativeDocumentSection = { type: "bullets", items: chaptersInToc };
  sections.splice(tocIndex, 0,
    { type: "heading", title: "Table of Contents" } as CreativeDocumentSection,
    tocSection,
    { type: "pageBreak" } as CreativeDocumentSection,
  );
  included.splice(included.indexOf("chapter-1"), 0, "toc");

  // ── Brand DNA theme ────────────────────────────────────────────────────────
  const { theme: dnaTheme } = extractBrandDnaTheme(project, "ebook");
  const primaryColor   = (dnaTheme.primaryColor   ?? content.primaryColor)   || "#2d3748";
  const secondaryColor = (dnaTheme.secondaryColor ?? content.secondaryColor) || "#4a5568";
  const accentColor    = (dnaTheme.accentColor    ?? content.accentColor)    || "#e53e3e";

  const spec: CreativeDocumentSpec = {
    documentType: "ebook",
    title:        `${project.brandName} — Ebook`,
    subtitle:     content.tagline || project.goal || undefined,
    company:      { name: project.brandName },
    theme:        { primaryColor, secondaryColor, accentColor },
    cover: {
      title:       project.brandName,
      subtitle:    "The Complete Guide",
      tagline:     content.tagline || undefined,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName}`,
      showPageNumber: true,
    },
    closing: {
      text: `Thank you for reading. ${project.brandName} — empowering ${project.targetMarket}.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "ebook",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      chaptersInToc,
      coverImageIncluded: !!coverImageBuffer,
      fabricationGuard:   "no_statistics_or_third_party_citations",
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const ebookDefinition: DocumentDefinition = {
  documentType:     "ebook" as CreativeDocumentType,
  filenamePrefix:   "ebook",
  minimumPageCount: 8,
  requiresLogo:     false,
  maxInlineImages:  2,

  generateContent: async (project) => {
    const { content } = normalizeEbookContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildEbookSpec(
      project,
      content as unknown as EbookContent,
      coverImageBuffer,
      inlineImages,
    ),
};
