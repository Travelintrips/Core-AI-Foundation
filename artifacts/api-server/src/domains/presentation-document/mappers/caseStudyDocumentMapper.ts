/**
 * caseStudyDocumentMapper.ts — Team 16: Presentation & Document Creative Services
 *
 * Maps a creative project's workflow outputs into a Case Study PDF.
 *
 * Anti-fabrication rules:
 *   - Quantified results (ROI %, cost savings, revenue impact) → NEVER invented
 *   - Client names and testimonials → only from briefJson, never generated
 *   - Outcomes section skipped if no data is present (not padded)
 *
 * Minimum page count: 2 (essential), 4 (professional)
 */

import type { CreativeProject } from "@workspace/db";
import { db, aiServiceRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "../../../services/creativeDocumentService.js";
import type { DocumentDefinition } from "../../../services/creativeDocumentWorkerService.js";
// CreativeDocumentType will include "case_study" once the integration team applies schemaExportsRequested
import type { CreativeDocumentType } from "../../../services/creativeProjectDocumentType.js";
import { extractBrandDnaTheme } from "../brandDnaAdapter.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

// ── Content interface ─────────────────────────────────────────────────────────

export interface CaseStudyContent {
  positioning:          string;
  competitiveAdvantage: string;
  bodyLong:             string;
  bodyShort:            string;
  tagline:              string;
  callToAction:         string;
  // Brief-only — never fabricated
  clientBackground:     string;
  challenge:            string;
  solution:             string;
  outcomes:             string;
  testimonial:          string;
  // Colors
  primaryColor:         string;
  secondaryColor:       string;
  accentColor:          string;
}

// ── Content normaliser ────────────────────────────────────────────────────────

export function normalizeCaseStudyContent(
  project: CreativeProject,
  briefJson?: Record<string, unknown>,
): { content: CaseStudyContent } {
  const result   = obj(project.result);
  const bs       = obj(result["brandStrategy"]);
  const cd       = obj(result["creativeDirection"]);
  const copy     = obj(result["copy"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);
  const brief    = briefJson ?? {};

  const content: CaseStudyContent = {
    positioning:          str(bs["positioning"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    bodyLong:             str(bodyCopy["long"]) || str(copy["body_copy"]),
    bodyShort:            str(bodyCopy["short"]),
    tagline:              str(copy["tagline"]),
    callToAction:         str(copy["call_to_action"]),
    // Brief-only (never fabricated)
    clientBackground:     str(brief["client_background"]) || str(brief["client"]),
    challenge:            str(brief["challenge"]) || str(brief["problem"]),
    solution:             str(brief["solution"]) || str(brief["approach"]),
    outcomes:             str(brief["outcomes"]) || str(brief["results"]),
    testimonial:          str(brief["testimonial"]) || str(brief["client_quote"]),
    // Colors
    primaryColor:         str(colorDir["primary"]),
    secondaryColor:       str(colorDir["secondary"]),
    accentColor:          str(colorDir["accent"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildCaseStudySpec(
  project: CreativeProject,
  content: CaseStudyContent,
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

  // ── Executive Summary ──────────────────────────────────────────────────────
  const summary = content.positioning
    || `${project.brandName} helped ${project.targetMarket} achieve their goal of: ${project.goal}.`;
  add("executive-summary",
    { type: "heading",   title: "Executive Summary" },
    { type: "paragraph", text: summary },
  );

  // ── Client Background ──────────────────────────────────────────────────────
  if (content.clientBackground) {
    add("client-background",
      { type: "heading",   title: "Client Background" },
      { type: "paragraph", text: content.clientBackground },
    );
  } else {
    add("client-background",
      { type: "heading",   title: "About the Client" },
      { type: "paragraph", text: `The client operates in ${project.businessType} and serves ${project.targetMarket}.` },
    );
  }

  // ── The Challenge ──────────────────────────────────────────────────────────
  const challengeText = content.challenge || project.goal;
  add("challenge",
    { type: "heading",   title: "The Challenge" },
    { type: "paragraph", text: challengeText },
  );
  if (project.notes) {
    sections.push({ type: "paragraph", text: project.notes });
  }

  // ── Our Solution ──────────────────────────────────────────────────────────
  const solutionText = content.solution || content.bodyLong || content.bodyShort
    || `${project.brandName} delivered ${project.productOrService}.`;
  add("solution",
    { type: "heading",   title: "Our Solution" },
    { type: "paragraph", text: solutionText },
  );

  // ── Approach & Implementation ─────────────────────────────────────────────
  if (content.competitiveAdvantage || content.bodyLong) {
    add("approach",
      { type: "heading",   title: "Approach & Implementation" },
      { type: "paragraph", text: content.competitiveAdvantage || content.bodyLong },
    );
  } else {
    skip("approach", "No competitive advantage or body copy for approach section");
  }

  // ── Inline image ──────────────────────────────────────────────────────────
  if (inlineImages[0]) {
    sections.push({
      type:        "image",
      imageUrl:    "",
      imageBuffer: inlineImages[0].buffer,
      caption:     inlineImages[0].caption ?? "Project deliverable",
    });
  }

  // ── Results & Outcomes (brief-only — no quantified figures fabricated) ─────
  if (content.outcomes) {
    add("outcomes",
      { type: "heading",   title: "Results & Outcomes" },
      { type: "paragraph", text: content.outcomes },
    );
  } else {
    skip("outcomes", "No outcomes data in brief — quantified results never fabricated");
  }

  // ── Client Testimonial (brief-only) ───────────────────────────────────────
  if (content.testimonial) {
    add("testimonial",
      { type: "heading", title: "Client Perspective" },
      { type: "quote",   text: content.testimonial },
    );
  } else {
    skip("testimonial", "No testimonial in brief — client quotes never fabricated");
  }

  // ── Key Takeaways ─────────────────────────────────────────────────────────
  add("conclusion",
    { type: "pageBreak" },
    { type: "heading",   title: "Key Takeaways" },
    { type: "paragraph", text: `This engagement demonstrates ${project.brandName}'s expertise in ${project.productOrService}.` },
  );

  // ── CTA ───────────────────────────────────────────────────────────────────
  const ctaText = content.callToAction
    || `Ready to achieve similar results? Partner with ${project.brandName}.`;
  add("cta",
    { type: "heading",   title: "Work With Us" },
    { type: "paragraph", text: ctaText },
  );

  // ── Brand DNA theme ────────────────────────────────────────────────────────
  const { theme: dnaTheme } = extractBrandDnaTheme(project, "case_study");
  const primaryColor   = (dnaTheme.primaryColor   ?? content.primaryColor)   || "#1a365d";
  const secondaryColor = (dnaTheme.secondaryColor ?? content.secondaryColor) || "#2d3748";
  const accentColor    = (dnaTheme.accentColor    ?? content.accentColor)    || "#38a169";

  const spec: CreativeDocumentSpec = {
    documentType: "case_study",
    title:        `${project.brandName} — Case Study`,
    subtitle:     content.tagline || undefined,
    company:      { name: project.brandName },
    theme:        { primaryColor, secondaryColor, accentColor },
    cover: {
      title:       project.brandName,
      subtitle:    "Case Study",
      tagline:     content.tagline || undefined,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Case Study`,
      showPageNumber: true,
    },
    closing: {
      text: `${project.brandName} — Helping ${project.targetMarket} achieve their goals.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "case_study",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
      inlineImagesUsed:   inlineImages.length > 0 ? 1 : 0,
      fabricationGuard:   "no_quantified_results_or_client_names",
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const caseStudyDefinition: DocumentDefinition = {
  documentType:     "case_study" as unknown as CreativeDocumentType,
  filenamePrefix:   "case-study",
  minimumPageCount: 2,
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
    const { content } = normalizeCaseStudyContent(project, briefJson);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildCaseStudySpec(
      project,
      content as unknown as CaseStudyContent,
      coverImageBuffer,
      inlineImages,
    ),
};
