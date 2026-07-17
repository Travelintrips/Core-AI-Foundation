/**
 * whitepaperDocumentMapper.ts — Team 16: Presentation & Document Creative Services
 *
 * Maps a creative project's workflow outputs into a Whitepaper PDF.
 *
 * Anti-fabrication rules:
 *   - Statistics, survey data, third-party citations → NEVER invented
 *   - "Key findings" come from brand strategy outputs + project goal
 *   - Research data only included if present in briefJson
 *
 * Minimum page count: 6
 */

import type { CreativeProject } from "@workspace/db";
import { db, aiServiceRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../../../services/creativeDocumentService.js";
import type { DocumentDefinition } from "../../../services/creativeDocumentWorkerService.js";
// CreativeDocumentType will include "whitepaper" once the integration team applies schemaExportsRequested
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

export interface WhitepaperContent {
  positioning:          string;
  competitiveAdvantage: string;
  brandValues:          string[];
  toneOfVoice:          string;
  bodyLong:             string;
  bodyShort:            string;
  tagline:              string;
  // Brief-only (no fabrication)
  abstract:             string;
  researchFindings:     string;
  // Colors
  primaryColor:         string;
  secondaryColor:       string;
  accentColor:          string;
}

// ── Content normaliser ────────────────────────────────────────────────────────

export function normalizeWhitepaperContent(
  project: CreativeProject,
  briefJson?: Record<string, unknown>,
): { content: WhitepaperContent } {
  const result   = obj(project.result);
  const bs       = obj(result["brandStrategy"]);
  const cd       = obj(result["creativeDirection"]);
  const copy     = obj(result["copy"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);
  const brief    = briefJson ?? {};

  const content: WhitepaperContent = {
    positioning:          str(bs["positioning"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    brandValues:          strArr(bs["brand_values"]),
    toneOfVoice:          str(bs["tone_of_voice"]),
    bodyLong:             str(bodyCopy["long"]) || str(copy["body_copy"]),
    bodyShort:            str(bodyCopy["short"]),
    tagline:              str(copy["tagline"]),
    // Brief-only fields
    abstract:             str(brief["abstract"]) || str(brief["summary"]),
    researchFindings:     str(brief["findings"]) || str(brief["research"]),
    // Colors
    primaryColor:         str(colorDir["primary"]),
    secondaryColor:       str(colorDir["secondary"]),
    accentColor:          str(colorDir["accent"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildWhitepaperSpec(
  project: CreativeProject,
  content: WhitepaperContent,
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

  // ── Abstract ───────────────────────────────────────────────────────────────
  const abstractText = content.abstract
    || content.positioning
    || `This paper explores how ${project.brandName} addresses challenges in ${project.targetMarket}.`;
  add("abstract",
    { type: "heading",   title: "Abstract" },
    { type: "paragraph", text: abstractText },
  );

  // ── Introduction ───────────────────────────────────────────────────────────
  const introText = content.bodyLong || content.bodyShort
    || `${project.brandName} presents this whitepaper to explore ${project.goal}.`;
  add("introduction",
    { type: "heading",   title: "Introduction" },
    { type: "paragraph", text: introText },
  );

  // ── Problem Statement ──────────────────────────────────────────────────────
  add("problem",
    { type: "heading",   title: "Problem Statement" },
    { type: "paragraph", text: project.goal || `The challenge facing ${project.targetMarket} today.` },
  );
  if (project.notes) {
    sections.push({ type: "paragraph", text: project.notes });
  }

  // ── Analysis & Context ─────────────────────────────────────────────────────
  if (content.toneOfVoice || content.competitiveAdvantage) {
    add("analysis",
      { type: "heading",   title: "Market Context" },
    );
    if (content.competitiveAdvantage) {
      sections.push({ type: "paragraph", text: content.competitiveAdvantage });
    }
    if (content.toneOfVoice) {
      sections.push({ type: "paragraph", text: content.toneOfVoice });
    }
  } else {
    skip("analysis", "No competitive advantage or tone of voice in strategy output");
  }

  // ── Framework / Approach ──────────────────────────────────────────────────
  if (content.brandValues.length >= 2) {
    add("framework",
      { type: "heading", title: "Our Framework" },
      { type: "bullets", items: content.brandValues },
    );
  } else {
    skip("framework", "Fewer than 2 brand values in strategy output");
  }

  // ── Key Findings ─────────────────────────────────────────────────────────
  // findings section requires actual research data from the brief — never use
  // positioning as a substitute (that would fabricate the findings section)
  if (content.researchFindings) {
    add("findings",
      { type: "pageBreak" },
      { type: "heading",   title: "Key Findings" },
      { type: "paragraph", text: content.researchFindings },
    );
  } else {
    skip("findings", "No research findings in brief — statistics never fabricated");
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  add("recommendations",
    { type: "heading",   title: "Recommendations" },
    { type: "paragraph", text: `Based on our analysis, we recommend that ${project.targetMarket} consider the following approach:` },
    { type: "bullets",   items: [project.productOrService, ...(content.brandValues.slice(0, 3))] },
  );

  // ── Conclusion ─────────────────────────────────────────────────────────────
  add("conclusion",
    { type: "heading",   title: "Conclusion" },
    { type: "paragraph", text: `${project.brandName} continues to be a trusted partner for ${project.targetMarket}, delivering ${project.productOrService} with excellence.` },
  );

  // ── About ─────────────────────────────────────────────────────────────────
  add("about",
    { type: "heading",   title: "About the Author" },
    { type: "paragraph", text: `${project.brandName} is a ${project.businessType} organization dedicated to ${project.targetMarket}.` },
    content.tagline
      ? { type: "quote", text: content.tagline, attribution: project.brandName }
      : { type: "paragraph", text: `Learn more about how ${project.brandName} can help your organization.` },
  );

  // ── Brand DNA theme ────────────────────────────────────────────────────────
  const { theme: dnaTheme } = extractBrandDnaTheme(project, "whitepaper");
  const primaryColor   = (dnaTheme.primaryColor   ?? content.primaryColor)   || "#1a202c";
  const secondaryColor = (dnaTheme.secondaryColor ?? content.secondaryColor) || "#2d3748";
  const accentColor    = (dnaTheme.accentColor    ?? content.accentColor)    || "#3182ce";

  const spec: CreativeDocumentSpec = {
    documentType: "whitepaper",
    title:        `${project.brandName} — Whitepaper`,
    subtitle:     content.tagline || project.goal || undefined,
    company:      { name: project.brandName },
    theme:        { primaryColor, secondaryColor, accentColor },
    cover: {
      title:       project.brandName,
      subtitle:    "Industry Whitepaper",
      tagline:     content.tagline || undefined,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Whitepaper`,
      showPageNumber: true,
    },
    closing: {
      text: `For inquiries, contact ${project.brandName}. This whitepaper is intended for ${project.targetMarket}.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "whitepaper",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
      fabricationGuard:   "no_statistics_or_third_party_citations",
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const whitepaperDefinition: DocumentDefinition = {
  documentType:     "whitepaper" as unknown as CreativeDocumentType,
  filenamePrefix:   "whitepaper",
  minimumPageCount: 6,
  requiresLogo:     false,
  maxInlineImages:  1,

  generateContent: async (project) => {
    let briefJson: Record<string, unknown> = {};
    if (project.serviceRequestId) {
      const [sr] = await db
        .select({ briefJson: aiServiceRequestsTable.briefJson })
        .from(aiServiceRequestsTable)
        .where(eq(aiServiceRequestsTable.id, project.serviceRequestId))
        .limit(1);
      if (sr?.briefJson) briefJson = sr.briefJson as Record<string, unknown>;
    }
    const { content } = normalizeWhitepaperContent(project, briefJson);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildWhitepaperSpec(
      project,
      content as unknown as WhitepaperContent,
      coverImageBuffer,
      inlineImages,
    ),
};
