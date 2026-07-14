/**
 * creativeConsultationDocumentMapper.ts — Phase 3 Creative Document Engine
 *
 * Synthesizes all workflow outputs (brand strategy, creative direction,
 * copy, QC review) into a structured Creative Consultation PDF.
 *
 * The consultation document captures the complete creative process:
 * context, findings, recommendations, priority actions, and next steps.
 *
 * NO raw JSON pasted. All content is structured and human-readable.
 * Minimum page count: 3.
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

interface ConsultationContent {
  positioning:          string;
  brandValues:          string[];
  competitiveAdvantage: string;
  brandPersonality:     string[];
  toneOfVoice:          string;
  creativeConcept:      string;
  conceptDescription:   string;
  campaignConcept:      string;
  imageryDirection:     string;
  tagline:              string;
  primaryHeadline:      string;
  overallScore:         number | null;
  brandConsistency:     string;
  messagingClarity:     string;
  audienceAlignment:    string;
  strengths:            string[];
  recommendations:      string[];
  criticalIssues:       string[];
  approved:             boolean | null;
  approvalNotes:        string;
}

export function normalizeConsultationContent(
  project: CreativeProject,
): { content: ConsultationContent } {
  const result = obj(project.result);
  const bs     = obj(result["brandStrategy"]);
  const cd     = obj(result["creativeDirection"]);
  const cw     = obj(result["copy"]);
  const qc     = obj(result["qcReview"]);

  const concept  = obj(cd["creative_concept"]);
  const headline = obj(cw["headline"]);

  const scoreRaw = qc["overall_score"];
  const overallScore = (typeof scoreRaw === "number" && Number.isFinite(scoreRaw))
    ? scoreRaw : null;

  const approvedRaw = qc["approved"];
  const approved = typeof approvedRaw === "boolean" ? approvedRaw : null;

  const content: ConsultationContent = {
    positioning:          str(bs["positioning"]),
    brandValues:          strArr(bs["brand_values"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    brandPersonality:     strArr(bs["brand_personality"]),
    toneOfVoice:          str(bs["tone_of_voice"]),
    creativeConcept:      str(concept["name"]) || str(concept["description"]),
    conceptDescription:   str(concept["rationale"]),
    campaignConcept:      str(cd["campaign_concept"]),
    imageryDirection:     str(cd["imagery_direction"]),
    tagline:              str(cw["tagline"]),
    primaryHeadline:      str(headline["primary"]),
    overallScore,
    brandConsistency:     str(qc["brand_consistency"]),
    messagingClarity:     str(qc["messaging_clarity"]),
    audienceAlignment:    str(qc["target_audience_alignment"]),
    strengths:            strArr(qc["strengths"]),
    recommendations:      strArr(qc["recommendations"]),
    criticalIssues:       strArr(qc["critical_issues"]),
    approved,
    approvalNotes:        str(qc["approval_notes"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildCreativeConsultationSpec(
  project: CreativeProject,
  content: ConsultationContent,
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

  // Consultation Objective
  add("objective",
    { type: "heading",   title: "Consultation Objective" },
    { type: "paragraph", text: project.goal },
  );

  // Client Context
  add("client-context",
    { type: "heading",   title: "Client Context" },
    { type: "paragraph", text: `${project.brandName} is a ${project.businessType} serving ${project.targetMarket}.` },
    { type: "paragraph", text: `Products & Services: ${project.productOrService}` },
  );

  // Findings — from brand strategy + QC
  const findings: string[] = [];
  if (content.positioning)          findings.push(`Positioning: ${content.positioning}`);
  if (content.competitiveAdvantage) findings.push(`Competitive Advantage: ${content.competitiveAdvantage}`);
  if (content.brandValues.length > 0) findings.push(`Core Values: ${content.brandValues.join(", ")}`);

  if (findings.length > 0) {
    add("findings",
      { type: "heading", title: "Key Findings" },
      { type: "bullets", items: findings },
    );
  } else skip("findings", "No findings from brand strategy output");

  // QC Score summary
  if (content.overallScore !== null) {
    const scoreItems: string[] = [
      `Overall Score: ${content.overallScore}/100`,
    ];
    if (content.brandConsistency)  scoreItems.push(`Brand Consistency: ${content.brandConsistency}`);
    if (content.messagingClarity)  scoreItems.push(`Messaging Clarity: ${content.messagingClarity}`);
    if (content.audienceAlignment) scoreItems.push(`Audience Alignment: ${content.audienceAlignment}`);
    if (content.approved !== null) scoreItems.push(`Approved: ${content.approved ? "Yes" : "Pending revision"}`);
    add("qc-score",
      { type: "heading",   title: "Quality Review Summary" },
      { type: "keyMetrics", items: [
        { label: "Overall Score", value: `${content.overallScore}/100` },
        { label: "Status",        value: content.approved ? "Approved" : "Needs Review" },
      ]},
    );
  } else skip("qc-score", "No QC score available");

  // Strengths → Opportunities
  if (content.strengths.length > 0) {
    add("strengths",
      { type: "heading", title: "Strengths & Opportunities" },
      { type: "bullets", items: content.strengths },
    );
  } else skip("strengths", "No strengths from QC output");

  // Creative Direction findings
  if (content.creativeConcept) {
    add("creative-direction",
      { type: "heading",   title: "Creative Direction" },
      { type: "paragraph", text: content.creativeConcept },
    );
    if (content.conceptDescription) {
      sections.push({ type: "paragraph", text: content.conceptDescription });
    }
    if (content.campaignConcept) {
      sections.push({ type: "quote", text: content.campaignConcept });
    }
  } else skip("creative-direction", "No creative concept in output");

  // Recommendations
  if (content.recommendations.length > 0) {
    add("recommendations",
      { type: "pageBreak" },
      { type: "heading", title: "Recommendations" },
      { type: "bullets", items: content.recommendations },
    );
  } else skip("recommendations", "No recommendations from QC");

  // Priority Actions
  const priorityActions: string[] = [];
  if (content.tagline)         priorityActions.push(`Finalize brand tagline: "${content.tagline}"`);
  if (content.primaryHeadline) priorityActions.push(`Deploy primary headline: "${content.primaryHeadline}"`);
  if (content.toneOfVoice)     priorityActions.push(`Apply tone of voice: ${content.toneOfVoice}`);
  if (content.imageryDirection) priorityActions.push(`Execute imagery direction: ${content.imageryDirection}`);

  if (priorityActions.length > 0) {
    add("priority-actions",
      { type: "heading", title: "Priority Actions" },
      { type: "bullets", items: priorityActions },
    );
  } else skip("priority-actions", "No priority actions could be derived");

  // Risks and Considerations
  if (content.criticalIssues.length > 0) {
    add("risks",
      { type: "heading", title: "Risks & Considerations" },
      { type: "bullets", items: content.criticalIssues },
    );
  } else skip("risks", "No critical issues from QC");

  // Brand personality as implementation guide
  if (content.brandPersonality.length > 0) {
    add("implementation-steps",
      { type: "heading", title: "Implementation Steps" },
      { type: "paragraph", text: "Apply these brand personality traits consistently across all touchpoints:" },
      { type: "bullets",   items: content.brandPersonality },
    );
  } else skip("implementation-steps", "No brand personality traits");

  // Next Steps
  add("next-steps",
    { type: "heading", title: "Next Steps" },
    { type: "bullets", items: [
      "Review and align on brand positioning statement",
      "Roll out brand voice guidelines to all content creators",
      "Apply creative direction to upcoming campaigns",
      "Schedule follow-up consultation to review execution",
    ]},
  );

  // Approval notes as closing note
  if (content.approvalNotes) {
    add("approval-notes",
      { type: "heading", title: "Consultant Notes" },
      { type: "paragraph", text: content.approvalNotes },
    );
  }

  const spec: CreativeDocumentSpec = {
    documentType: "creative_consultation",
    title:        `${project.brandName} — Creative Consultation`,
    subtitle:     content.positioning || undefined,
    company:      { name: project.brandName },
    theme: {
      primaryColor:   "#1e3a5f",
      secondaryColor: "#2c3e50",
      accentColor:    "#d35400",
    },
    cover: {
      title:       project.brandName,
      tagline:     "Creative Consultation Report",
      subtitle:    project.businessType,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Creative Consultation`,
      showPageNumber: true,
    },
    closing: {
      text: `This consultation report consolidates findings and recommendations for ${project.brandName}'s creative direction.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "creative_consultation",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const creativeConsultationDefinition: DocumentDefinition = {
  documentType:     "creative_consultation",
  filenamePrefix:   "creative-consultation",
  minimumPageCount: 3,
  requiresLogo:     false,
  maxInlineImages:  1,

  generateContent: async (project) => {
    const { content } = normalizeConsultationContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildCreativeConsultationSpec(
      project,
      content as unknown as ConsultationContent,
      coverImageBuffer,
      inlineImages,
    ),
};
