/**
 * pitchDeckPresentationMapper.ts — Phase 4 Presentation Engine
 *
 * Maps a creative project's existing workflow outputs (brand strategy,
 * creative direction, copywriting) into a Pitch Deck CreativePresentationSpec.
 *
 * Anti-fabrication rules (same as the Document Engine):
 *  - Never invent financial figures, market-size numbers, team members, or
 *    traction metrics that are not present in the project's brief/outputs.
 *  - Slides that would require such data (metrics, financial chart, team,
 *    competitive comparison) are SKIPPED — not filled with placeholders —
 *    when the underlying data does not exist, and the skip is recorded in
 *    the generation report.
 *  - No new LLM call is made here: the pitch deck reuses the same 4-agent
 *    workflow output already generated for this project (brandStrategist,
 *    creativeDirector, copywriter), so its content is fact-consistent with
 *    every other deliverable for the same project.
 */

import type { CreativeProject } from "@workspace/db";
import type {
  CreativePresentationSpec,
  PresentationSlideSpec,
  PresentationTheme,
} from "../presentationTypes.js";
import { DEFAULT_PRESENTATION_THEME } from "../presentationTypes.js";
import type { PresentationDefinition } from "../creativePresentationWorkerService.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter(Boolean);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ── Content normaliser ────────────────────────────────────────────────────────

export interface PitchDeckContent {
  tagline: string;
  positioning: string;
  brandValues: string[];
  brandPersonality: string[];
  toneOfVoice: string;
  competitiveAdvantage: string;
  creativeConceptName: string;
  creativeConceptDesc: string;
  campaignConcept: string;
  colorPrimary: string;
  colorSecondary: string;
  colorAccent: string;
  headlineCopy: string;
  bodyCopyShort: string;
  bodyCopyLong: string;
  callToAction: string;
}

export function normalizePitchDeckContent(project: CreativeProject): { content: PitchDeckContent } {
  const result = obj(project.result);
  const bs = obj(result["brandStrategy"]);
  const cd = obj(result["creativeDirection"]);
  const copy = obj(result["copy"]);
  const concept = obj(cd["creative_concept"]);
  const colorDir = obj(cd["color_direction"]);
  const bodyCopy = obj(copy["body_copy"]);

  const content: PitchDeckContent = {
    tagline: str(copy["tagline"]),
    positioning: str(bs["positioning"]),
    brandValues: strArr(bs["brand_values"]),
    brandPersonality: strArr(bs["brand_personality"]),
    toneOfVoice: str(bs["tone_of_voice"]),
    competitiveAdvantage: str(bs["competitive_advantage"]),
    creativeConceptName: str(concept["name"]),
    creativeConceptDesc: str(concept["description"]),
    campaignConcept: str(cd["campaign_concept"]),
    colorPrimary: str(colorDir["primary"]),
    colorSecondary: str(colorDir["secondary"]),
    colorAccent: str(colorDir["accent"]),
    headlineCopy: str(copy["headline"]),
    bodyCopyShort: str(bodyCopy["short"]),
    bodyCopyLong: str(bodyCopy["long"]),
    callToAction: str(copy["call_to_action"]),
  };

  return { content };
}

// ── Spec builder ──────────────────────────────────────────────────────────────

export function buildPitchDeckSpec(
  project: CreativeProject,
  content: PitchDeckContent,
  logoBuffer: Buffer | null,
  inlineImages: Array<{ buffer: Buffer; caption?: string }>,
): { spec: CreativePresentationSpec; report: Record<string, unknown> } {
  const slides: PresentationSlideSpec[] = [];
  const included: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  function add(id: string, ...items: PresentationSlideSpec[]) {
    included.push(id);
    slides.push(...items);
  }
  function skip(id: string, reason: string) {
    skipped.push({ id, reason });
  }

  const theme: PresentationTheme = {
    ...DEFAULT_PRESENTATION_THEME,
    primaryColor: content.colorPrimary || DEFAULT_PRESENTATION_THEME.primaryColor,
    secondaryColor: content.colorSecondary || DEFAULT_PRESENTATION_THEME.secondaryColor,
    accentColor: content.colorAccent || DEFAULT_PRESENTATION_THEME.accentColor,
  };

  // 1. Cover
  add("cover", {
    kind: "cover",
    title: project.brandName,
    subtitle: content.tagline || content.headlineCopy || `${project.businessType} — Pitch Deck`,
    logo: logoBuffer ? { buffer: logoBuffer } : undefined,
    speakerNotes: "Open with a confident, concise framing of who we are and what we're pitching today.",
  });

  // 2. Problem (derived from goal + notes — the stated business challenge)
  const problemBullets: string[] = [];
  if (project.goal) problemBullets.push(project.goal);
  if (project.notes) problemBullets.push(project.notes);
  if (problemBullets.length > 0) {
    add("problem", {
      kind: "problem",
      title: "The Opportunity",
      body: `${project.targetMarket} needs a better way to engage with ${project.businessType.toLowerCase()} offerings.`,
      bullets: problemBullets,
    });
  } else {
    skip("problem", "No goal/notes provided in the brief to derive an opportunity statement");
  }

  // 3. Solution
  add("solution", {
    kind: "solution",
    title: "Our Solution",
    body: content.bodyCopyLong || content.positioning || undefined,
    bullets: content.bodyCopyLong ? undefined : [project.productOrService],
    image: inlineImages[0] ? { buffer: inlineImages[0]!.buffer, caption: inlineImages[0]!.caption } : undefined,
    speakerNotes: "Walk through how the product/service directly addresses the opportunity just described.",
  });

  // 4. Product / Offering
  add("product", {
    kind: "content",
    title: "What We Offer",
    body: content.bodyCopyShort || undefined,
    bullets: [project.productOrService, ...content.brandValues.slice(0, 4)],
  });

  // 5. Target Market
  add("market", {
    kind: "market",
    title: "Target Market",
    body: `${project.brandName} serves ${project.targetMarket}.`,
    bullets: content.brandPersonality.length > 0 ? content.brandPersonality : undefined,
  });

  // 6. Brand Positioning & Differentiation
  if (content.positioning || content.competitiveAdvantage) {
    add("positioning", {
      kind: "content",
      title: "Why We're Different",
      body: content.positioning || undefined,
      bullets: content.competitiveAdvantage ? [content.competitiveAdvantage] : undefined,
    });
  } else {
    skip("positioning", "No positioning or competitive advantage available from brand strategy output");
  }

  // 7. Creative Concept / Brand Story
  if (content.creativeConceptName || content.creativeConceptDesc || content.campaignConcept) {
    add("concept", {
      kind: "content",
      title: content.creativeConceptName || "Brand Concept",
      body: content.creativeConceptDesc || content.campaignConcept || undefined,
      speakerNotes: "This concept should tie the visual identity and messaging together in the audience's mind.",
    });
  } else {
    skip("concept", "No creative concept available from creative direction output");
  }

  // Metrics / financial-chart / team / competitive-comparison slides are
  // intentionally OMITTED — this project's workflow (brand strategist,
  // creative director, copywriter) does not produce traction metrics,
  // financial projections, a team roster, or verified competitor data.
  // Fabricating numbers for these slide kinds would violate the
  // Presentation Engine's anti-fabrication rule.
  skip("metrics", "No traction/metrics data available from this project's workflow outputs");
  skip("financial", "No financial projections available — never fabricated");
  skip("team", "No team roster data available for this project");
  skip("comparison", "No verified competitor data available — never fabricated");

  // 8. Call to Action / Ask
  add("ask", {
    kind: "ask",
    title: "Let's Work Together",
    body: content.callToAction || `Ready to bring ${project.brandName} to ${project.targetMarket}.`,
    bullets: [project.goal].filter(Boolean),
  });

  // 9. Closing
  add("closing", {
    kind: "closing",
    title: "Thank You",
    subtitle: content.tagline || project.brandName,
  });

  const spec: CreativePresentationSpec = {
    presentationType: "pitch_deck",
    title: `${project.brandName} — Pitch Deck`,
    subtitle: content.tagline || undefined,
    companyName: project.brandName,
    theme,
    slides,
    metadata: { businessType: project.businessType, targetMarket: project.targetMarket },
  };

  return {
    spec,
    report: {
      presentationType: "pitch_deck",
      slidesIncluded: included,
      slidesSkipped: skipped,
      logoEmbedded: logoBuffer !== null,
      inlineImagesUsed: Math.min(inlineImages.length, 1),
    },
  };
}

// ── PresentationDefinition export ─────────────────────────────────────────────

export const pitchDeckDefinition: PresentationDefinition = {
  presentationType: "pitch_deck",
  filenamePrefix: "pitch-deck",
  minimumSlideCount: 7,
  maximumSlideCount: 20,
  requiresLogo: false,
  maxInlineImages: 2,

  generateContent: async (project) => {
    const { content } = normalizePitchDeckContent(project);
    return { content: content as unknown as Record<string, unknown> };
  },

  buildSpec: (project, content, logoBuffer, inlineImages) =>
    buildPitchDeckSpec(project, content as unknown as PitchDeckContent, logoBuffer, inlineImages),
};
