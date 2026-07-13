/**
 * copywritingDocumentMapper.ts — Phase 3 Creative Document Engine
 *
 * Normalizes the Copywriter + Brand Strategist workflow outputs into a
 * CreativeDocumentSpec for the Copywriting PDF.
 *
 * Copywriting documents can be shorter than strategy documents.
 * Minimum page count: 2. Empty sections are skipped — no padding.
 *
 * NO fabricated facts: all content comes from AI pipeline outputs.
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

// ── Social caption type ───────────────────────────────────────────────────────

interface SocialCaption {
  platform: string;
  caption:  string;
}
function isSocialCaption(v: unknown): v is SocialCaption {
  return !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>)["platform"] === "string" &&
    typeof (v as Record<string, unknown>)["caption"]  === "string";
}

// ── Content normaliser ────────────────────────────────────────────────────────

interface CopywritingContent {
  tagline:              string;
  primaryHeadline:      string;
  alternativeHeadlines: string[];
  bodyShort:            string;
  bodyLong:             string;
  primaryCta:           string;
  secondaryCta:         string;
  socialCaptions:       SocialCaption[];
  emailSubjectLines:    string[];
  toneNotes:            string;
  positioning:          string;
  toneOfVoice:          string;
}

export function normalizeCopywritingContent(
  project: CreativeProject,
): { content: CopywritingContent } {
  const result    = obj(project.result);
  const cw        = obj(result["copy"]);
  const bs        = obj(result["brandStrategy"]);
  const headline  = obj(cw["headline"]);
  const bodyCopy  = obj(cw["body_copy"]);
  const cta       = obj(cw["cta"]);

  const rawCaptions = Array.isArray(cw["social_captions"]) ? cw["social_captions"] : [];
  const socialCaptions: SocialCaption[] = rawCaptions.filter(isSocialCaption).map((c) => ({
    platform: str(c.platform),
    caption:  str(c.caption),
  })).filter((c) => c.platform && c.caption);

  const content: CopywritingContent = {
    tagline:              str(cw["tagline"]),
    primaryHeadline:      str(headline["primary"]),
    alternativeHeadlines: strArr(headline["alternatives"]),
    bodyShort:            str(bodyCopy["short"]),
    bodyLong:             str(bodyCopy["long"]),
    primaryCta:           str(cta["primary"]),
    secondaryCta:         str(cta["secondary"]),
    socialCaptions,
    emailSubjectLines:    strArr(cw["email_subject_lines"]),
    toneNotes:            str(cw["tone_notes"]),
    positioning:          str(bs["positioning"]),
    toneOfVoice:          str(bs["tone_of_voice"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildCopywritingSpec(
  project: CreativeProject,
  content: CopywritingContent,
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

  // Creative Brief
  add("brief",
    { type: "heading",   title: "Creative Brief" },
    { type: "paragraph", text: `Brand: ${project.brandName} — ${project.businessType}` },
    { type: "paragraph", text: `Goal: ${project.goal}` },
  );

  // Objective / Target Audience
  add("objective",
    { type: "heading",   title: "Objective & Target Audience" },
    { type: "paragraph", text: project.targetMarket },
  );

  // Tone and Style
  if (content.toneOfVoice || content.toneNotes) {
    const toneText = [content.toneOfVoice, content.toneNotes].filter(Boolean).join("\n\n");
    add("tone",
      { type: "heading",   title: "Tone of Voice & Style" },
      { type: "paragraph", text: toneText },
    );
  } else skip("tone", "No tone of voice in output");

  // Core Message / Positioning
  if (content.positioning) {
    add("core-message",
      { type: "heading", title: "Core Message" },
      { type: "quote",   text: content.positioning, attribution: project.brandName },
    );
  } else skip("core-message", "No positioning in brand strategy output");

  // Headline Options
  const headlineItems: string[] = [];
  if (content.primaryHeadline)           headlineItems.push(content.primaryHeadline);
  headlineItems.push(...content.alternativeHeadlines);
  if (headlineItems.length > 0) {
    add("headlines",
      { type: "heading", title: "Headline Options" },
      { type: "bullets", items: headlineItems },
    );
  } else skip("headlines", "No headline options in copy output");

  // Tagline
  if (content.tagline) {
    add("tagline",
      { type: "heading", title: "Brand Tagline" },
      { type: "quote",   text: content.tagline, attribution: project.brandName },
    );
  } else skip("tagline", "No tagline generated");

  // Main Copy (long-form)
  if (content.bodyLong) {
    add("main-copy",
      { type: "heading",   title: "Main Copy (Long-form)" },
      { type: "paragraph", text: content.bodyLong },
    );
  } else if (content.bodyShort) {
    add("main-copy",
      { type: "heading",   title: "Main Copy" },
      { type: "paragraph", text: content.bodyShort },
    );
  } else skip("main-copy", "No body copy in output");

  // Short copy variant
  if (content.bodyShort && content.bodyLong) {
    add("short-copy",
      { type: "heading",   title: "Short-form Variant" },
      { type: "paragraph", text: content.bodyShort },
    );
  }

  // CTA Options
  const ctaItems: string[] = [];
  if (content.primaryCta)   ctaItems.push(`Primary: ${content.primaryCta}`);
  if (content.secondaryCta) ctaItems.push(`Secondary: ${content.secondaryCta}`);
  if (ctaItems.length > 0) {
    add("cta",
      { type: "heading", title: "Call to Action Options" },
      { type: "bullets", items: ctaItems },
    );
  } else skip("cta", "No CTA options in output");

  // Channel Variations (social captions)
  if (content.socialCaptions.length > 0) {
    add("channel-variations",
      { type: "pageBreak" },
      { type: "heading", title: "Channel Variations" },
    );
    for (const cap of content.socialCaptions) {
      sections.push(
        { type: "heading",   title: cap.platform, subtitle: "Social Caption" },
        { type: "paragraph", text: cap.caption },
      );
    }
  } else skip("channel-variations", "No social captions generated");

  // Email subject lines
  if (content.emailSubjectLines.length > 0) {
    add("email-subjects",
      { type: "heading", title: "Email Subject Lines" },
      { type: "bullets", items: content.emailSubjectLines },
    );
  } else skip("email-subjects", "No email subject lines");

  // Final Recommended Copy
  const finalCopy = content.bodyLong || content.bodyShort;
  if (finalCopy) {
    add("final-copy",
      { type: "pageBreak" },
      { type: "heading",   title: "Final Recommended Copy" },
      { type: "quote",     text: finalCopy },
    );
  }

  const spec: CreativeDocumentSpec = {
    documentType: "copywriting",
    title:        `${project.brandName} — Copywriting Package`,
    subtitle:     content.tagline || undefined,
    company:      { name: project.brandName },
    theme: {
      primaryColor:   "#2b4c7e",
      secondaryColor: "#1a2a4a",
      accentColor:    "#e07c39",
    },
    cover: {
      title:       project.brandName,
      tagline:     content.tagline || `Copywriting Package`,
      subtitle:    "Creative Copy Document",
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text:           `${project.brandName} — Copywriting`,
      showPageNumber: true,
    },
    closing: {
      text: `These copies were crafted to communicate ${project.brandName}'s value clearly and compellingly.`,
    },
  };

  return {
    spec,
    report: {
      documentType:       "copywriting",
      sectionsIncluded:   included,
      sectionsSkipped:    skipped,
      coverImageIncluded: !!coverImageBuffer,
    },
  };
}

// ── DocumentDefinition export ─────────────────────────────────────────────────

export const copywritingDefinition: DocumentDefinition = {
  documentType:     "copywriting",
  filenamePrefix:   "copywriting",
  minimumPageCount: 2,
  requiresLogo:     false,
  maxInlineImages:  1,

  generateContent: async (project) => {
    const { content } = normalizeCopywritingContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, coverImageBuffer, inlineImages) =>
    buildCopywritingSpec(
      project,
      content as unknown as CopywritingContent,
      coverImageBuffer,
      inlineImages,
    ),
};
