/**
 * proposalDocumentMapper.ts — Team 16: Presentation & Document Creative Services
 *
 * Maps a creative project's workflow outputs into a Proposal PDF.
 *
 * Anti-fabrication rules:
 *   - Pricing figures, legal terms, payment schedules → NEVER invented
 *   - Timeline estimates → only included if present in briefJson
 *   - All content sourced from project fields, briefJson, or AI workflow outputs
 *
 * Minimum page count: 4 (essential), 6 (professional), 8 (enterprise)
 */

import type { CreativeProject } from "@workspace/db";
import { db, aiServiceRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

export interface ProposalContent {
  positioning:          string;
  competitiveAdvantage: string;
  brandValues:          string[];
  toneOfVoice:          string;
  bodyShort:            string;
  bodyLong:             string;
  tagline:              string;
  // From briefJson (never fabricated)
  challenge:            string;
  timeline:             string;
  budgetNote:           string;
  teamNote:             string;
  // Computed
  primaryColor:         string;
  secondaryColor:       string;
  accentColor:          string;
}

// ── Content normaliser ────────────────────────────────────────────────────────

export function normalizeProposalContent(
  project: CreativeProject,
  briefJson?: Record<string, unknown>,
): { content: ProposalContent } {
  const result   = obj(project.result);
  const bs       = obj(result["brandStrategy"]);
  const cd       = obj(result["creativeDirection"]);
  const copy     = obj(result["copy"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);
  const brief    = briefJson ?? {};

  const content: ProposalContent = {
    positioning:          str(bs["positioning"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    brandValues:          strArr(bs["brand_values"]),
    toneOfVoice:          str(bs["tone_of_voice"]),
    bodyShort:            str(bodyCopy["short"]),
    bodyLong:             str(bodyCopy["long"]) || str(copy["body_copy"]),
    tagline:              str(copy["tagline"]),
    // From briefJson only — never fabricated
    challenge:            str(brief["challenge"]) || str(brief["problem"]),
    timeline:             str(brief["timeline"]) || str(brief["proposed_timeline"]),
    budgetNote:           str(brief["budget_note"]) || str(brief["budget_range"]),
    teamNote:             str(brief["team_note"]) || str(brief["team_description"]),
    // Colors
    primaryColor:         str(colorDir["primary"]),
    secondaryColor:       str(colorDir["secondary"]),
    accentColor:          str(colorDir["accent"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildProposalSpec(
  project: CreativeProject,
  content: ProposalContent,
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

  // ── Executive Summary ──────────────────────────────────────────────────────
  const execSummary = content.positioning
    || `${project.brandName} proposes to deliver ${project.productOrService} for ${project.targetMarket}.`;
  add("executive-summary",
    { type: "heading",   title: "Executive Summary" },
    { type: "paragraph", text: execSummary },
  );

  // ── Understanding Your Needs ───────────────────────────────────────────────
  if (content.challenge) {
    add("understanding",
      { type: "heading",   title: "Understanding Your Needs" },
      { type: "paragraph", text: content.challenge },
    );
  } else if (project.goal) {
    add("understanding",
      { type: "heading",   title: "Your Business Objective" },
      { type: "paragraph", text: project.goal },
    );
  } else {
    skip("understanding", "No challenge or goal field available");
  }

  // ── Scope of Work ──────────────────────────────────────────────────────────
  const scopeItems: string[] = [project.productOrService].filter(Boolean);
  if (content.brandValues.length > 0) scopeItems.push(...content.brandValues.slice(0, 3));
  add("scope",
    { type: "heading", title: "Scope of Work" },
    { type: "paragraph", text: `We will deliver: ${project.productOrService}` },
    { type: "bullets",   items: scopeItems },
  );

  // ── Our Approach ───────────────────────────────────────────────────────────
  if (content.bodyLong || content.bodyShort) {
    add("approach",
      { type: "heading",   title: "Our Approach & Methodology" },
      { type: "paragraph", text: content.bodyLong || content.bodyShort },
    );
    if (content.toneOfVoice) {
      sections.push({ type: "paragraph", text: `Communication approach: ${content.toneOfVoice}` });
    }
  } else {
    skip("approach", "No body copy available from copywriting output");
  }

  // ── Deliverables ───────────────────────────────────────────────────────────
  add("deliverables",
    { type: "heading", title: "Deliverables" },
    { type: "bullets", items: [project.productOrService, ...content.brandValues.slice(0, 2)] },
  );

  // ── Proposed Timeline (only if from brief — not fabricated) ────────────────
  if (content.timeline) {
    add("timeline",
      { type: "heading",   title: "Proposed Timeline" },
      { type: "paragraph", text: content.timeline },
    );
  } else {
    skip("timeline", "No timeline provided in brief — not fabricated");
  }

  // ── Investment Overview (budget note only — no fabricated figures) ─────────
  if (content.budgetNote) {
    add("investment",
      { type: "heading",   title: "Investment Overview" },
      { type: "paragraph", text: content.budgetNote },
    );
  } else {
    skip("investment", "No budget note in brief — pricing figures never fabricated");
  }

  // ── Why Choose Us ─────────────────────────────────────────────────────────
  if (content.competitiveAdvantage) {
    add("why-us",
      { type: "pageBreak" },
      { type: "heading",   title: "Why Choose Us" },
      { type: "paragraph", text: content.competitiveAdvantage },
    );
  } else {
    skip("why-us", "No competitive advantage in brand strategy output");
  }

  // ── Team ──────────────────────────────────────────────────────────────────
  if (content.teamNote) {
    add("team",
      { type: "heading",   title: "Our Team" },
      { type: "paragraph", text: content.teamNote },
    );
  } else {
    skip("team", "No team note in brief — team roster never fabricated");
  }

  // ── Next Steps ─────────────────────────────────────────────────────────────
  add("next-steps",
    { type: "heading",   title: "Next Steps" },
    { type: "paragraph", text: `To proceed with this proposal, please contact ${project.brandName}.` },
    { type: "bullets",   items: ["Review and approve this proposal", "Schedule a kick-off meeting", "Begin onboarding"] },
  );

  // ── Brand DNA theme override ────────────────────────────────────────────────
  const { theme: dnaTheme } = extractBrandDnaTheme(project, "proposal");
  const primaryColor   = (dnaTheme.primaryColor   ?? content.primaryColor)   || "#1a365d";
  const secondaryColor = (dnaTheme.secondaryColor ?? content.secondaryColor) || "#2d3748";
  const accentColor    = (dnaTheme.accentColor    ?? content.accentColor)    || "#c05621";

  const spec: CreativeDocumentSpec = {
    documentType: "proposal",
    title:        `${project.brandName} — Proposal`,
    subtitle:     content.tagline || project.goal || undefined,
    company:      { name: project.brandName },
    theme:        { primaryColor, secondaryColor, accentColor },
    cover: {
      title:       project.brandName,
      subtitle:    "Project Proposal",
      tagline:     content.tagline || undefined,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Project Proposal`,
      showPageNumber: true,
    },
    closing: {
      text: `Thank you for considering ${project.brandName}. We look forward to working with you.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "proposal",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
      fabricationGuard:   "no_pricing_figures_or_legal_terms",
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const proposalDefinition: DocumentDefinition = {
  documentType:     "proposal",
  filenamePrefix:   "proposal",
  minimumPageCount: 4,
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
    const { content } = normalizeProposalContent(project, briefJson);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildProposalSpec(
      project,
      content as unknown as ProposalContent,
      coverImageBuffer,
      inlineImages,
    ),
};
