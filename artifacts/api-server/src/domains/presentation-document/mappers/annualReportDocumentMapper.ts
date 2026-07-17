/**
 * annualReportDocumentMapper.ts — Team 16: Presentation & Document Creative Services
 *
 * Maps a creative project's workflow outputs into an Annual Report PDF.
 *
 * Anti-fabrication rules:
 *   - Revenue, EBITDA, dividend figures → NEVER invented
 *   - Audit opinions, financial statements → NEVER included without brief data
 *   - Operational highlights only from project fields + briefJson
 *
 * Minimum page count: 8
 */

import type { CreativeProject } from "@workspace/db";
import { db, aiServiceRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../../../services/creativeDocumentService.js";
import type { DocumentDefinition } from "../../../services/creativeDocumentWorkerService.js";
// CreativeDocumentType will include "annual_report" once the integration team applies schemaExportsRequested
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

export interface AnnualReportContent {
  positioning:          string;
  competitiveAdvantage: string;
  brandValues:          string[];
  bodyLong:             string;
  tagline:              string;
  // From briefJson only — never fabricated
  leadershipMessage:    string;
  highlights:           string[];
  esgNote:              string;
  teamNote:             string;
  outlookNote:          string;
  // Colors
  primaryColor:         string;
  secondaryColor:       string;
  accentColor:          string;
}

// ── Content normaliser ────────────────────────────────────────────────────────

export function normalizeAnnualReportContent(
  project: CreativeProject,
  briefJson?: Record<string, unknown>,
): { content: AnnualReportContent } {
  const result   = obj(project.result);
  const bs       = obj(result["brandStrategy"]);
  const cd       = obj(result["creativeDirection"]);
  const copy     = obj(result["copy"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);
  const brief    = briefJson ?? {};

  const content: AnnualReportContent = {
    positioning:          str(bs["positioning"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    brandValues:          strArr(bs["brand_values"]),
    bodyLong:             str(bodyCopy["long"]) || str(copy["body_copy"]),
    tagline:              str(copy["tagline"]),
    // Brief-only fields (no fabrication)
    leadershipMessage:    str(brief["leadership_message"]) || str(brief["chairman_letter"]),
    highlights:           strArr(brief["highlights"]) || strArr(brief["key_achievements"]),
    esgNote:              str(brief["esg"]) || str(brief["sustainability"]),
    teamNote:             str(brief["team"]) || str(brief["people"]),
    outlookNote:          str(brief["outlook"]) || str(brief["strategy"]),
    // Colors
    primaryColor:         str(colorDir["primary"]),
    secondaryColor:       str(colorDir["secondary"]),
    accentColor:          str(colorDir["accent"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildAnnualReportSpec(
  project: CreativeProject,
  content: AnnualReportContent,
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

  // ── Letter from Leadership ─────────────────────────────────────────────────
  const leaderText = content.leadershipMessage
    || content.positioning
    || `${project.brandName} continues to lead in ${project.businessType}.`;
  add("chairman-letter",
    { type: "heading",   title: "Letter from Leadership" },
    { type: "paragraph", text: leaderText },
  );
  if (content.tagline) {
    sections.push({ type: "quote", text: content.tagline, attribution: "Leadership" });
  }

  // ── Year in Review ────────────────────────────────────────────────────────
  add("year-in-review",
    { type: "heading",   title: "Year in Review" },
    { type: "paragraph", text: project.goal || `${project.brandName} made significant strides this year.` },
  );

  // ── Key Highlights ────────────────────────────────────────────────────────
  if (content.highlights.length > 0) {
    add("highlights",
      { type: "heading", title: "Key Highlights" },
      { type: "bullets", items: content.highlights },
    );
  } else if (content.brandValues.length > 0) {
    add("highlights",
      { type: "heading", title: "Strategic Pillars" },
      { type: "bullets", items: content.brandValues },
    );
  } else {
    skip("highlights", "No highlights in brief and no brand values in strategy output");
  }

  // ── Operations & Initiatives ──────────────────────────────────────────────
  add("operations",
    { type: "pageBreak" },
    { type: "heading",   title: "Operations & Initiatives" },
    { type: "paragraph", text: `${project.brandName} delivers ${project.productOrService} to ${project.targetMarket}.` },
  );
  if (content.bodyLong) {
    sections.push({ type: "paragraph", text: content.bodyLong });
  }
  if (content.competitiveAdvantage) {
    sections.push({ type: "paragraph", text: content.competitiveAdvantage });
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

  // ── Our People ────────────────────────────────────────────────────────────
  if (content.teamNote) {
    add("people",
      { type: "heading",   title: "Our People" },
      { type: "paragraph", text: content.teamNote },
    );
  } else {
    skip("people", "No team note in brief — team roster never fabricated");
  }

  // ── Sustainability & ESG ───────────────────────────────────────────────────
  if (content.esgNote) {
    add("sustainability",
      { type: "heading",   title: "Sustainability & ESG" },
      { type: "paragraph", text: content.esgNote },
    );
  } else {
    skip("sustainability", "No ESG note in brief");
  }

  // ── Outlook & Strategy ─────────────────────────────────────────────────────
  const outlookText = content.outlookNote || content.positioning
    || `${project.brandName} remains committed to serving ${project.targetMarket}.`;
  add("outlook",
    { type: "pageBreak" },
    { type: "heading",   title: "Outlook & Strategy" },
    { type: "paragraph", text: outlookText },
  );

  // Financial figures are NEVER included — this is an anti-fabrication guard
  skip("financials", "Financial figures never fabricated — omitted per anti-fabrication policy");

  // ── Brand DNA theme ────────────────────────────────────────────────────────
  const { theme: dnaTheme } = extractBrandDnaTheme(project, "annual_report");
  const primaryColor   = (dnaTheme.primaryColor   ?? content.primaryColor)   || "#1a365d";
  const secondaryColor = (dnaTheme.secondaryColor ?? content.secondaryColor) || "#2c5282";
  const accentColor    = (dnaTheme.accentColor    ?? content.accentColor)    || "#2b6cb0";

  const spec: CreativeDocumentSpec = {
    documentType: "annual_report",
    title:        `${project.brandName} — Annual Report`,
    subtitle:     content.tagline || undefined,
    company:      { name: project.brandName },
    theme:        { primaryColor, secondaryColor, accentColor },
    cover: {
      title:       project.brandName,
      subtitle:    "Annual Report",
      tagline:     content.tagline || undefined,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Annual Report`,
      showPageNumber: true,
    },
    closing: {
      text: `${project.brandName} — Committed to excellence for ${project.targetMarket}.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "annual_report",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
      fabricationGuard:   "no_financial_figures_or_audit_opinions",
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const annualReportDefinition: DocumentDefinition = {
  documentType:     "annual_report" as unknown as CreativeDocumentType,
  filenamePrefix:   "annual-report",
  minimumPageCount: 8,
  requiresLogo:     false,
  maxInlineImages:  2,

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
    const { content } = normalizeAnnualReportContent(project, briefJson);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildAnnualReportSpec(
      project,
      content as unknown as AnnualReportContent,
      coverImageBuffer,
      inlineImages,
    ),
};
