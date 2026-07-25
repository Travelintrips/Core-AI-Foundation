/**
 * creativeAiService.ts — Prompt builders and response parser for the
 * Creative Brief 4-agent pipeline.
 *
 * Agents (in order):
 *   1. Brand Strategist    — brand values, positioning, audience
 *   2. Creative Director   — visual identity, concept, art direction
 *   3. Copywriter          — tagline, headline, body copy, CTAs
 *   4. Quality Control     — review, scoring, approval decision
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface CreativeBriefInput {
  brandName:        string;
  businessType:     string;
  targetMarket:     string;
  productOrService: string;
  stylePreference:  string;
  goal:             string;
  notes?:           string | null;
}

// ── Language helper ───────────────────────────────────────────────────────────

/**
 * Extracts [OUTPUT_LANGUAGE:xx] from notes and returns a language instruction
 * string suitable for injection into system prompts.
 * Default: Bahasa Indonesia (matching the product's primary audience).
 */
export function extractLanguageInstruction(notes?: string | null): string {
  const match = notes?.match(/\[OUTPUT_LANGUAGE:(id|en)\]/);
  const lang = match?.[1] ?? "id";
  if (lang === "en") {
    return "You MUST write ALL content values inside the JSON (strings, lists, descriptions, copy, recommendations, etc.) in English.";
  }
  return "Anda WAJIB menulis SEMUA nilai konten di dalam JSON (string, daftar, deskripsi, copywriting, rekomendasi, dll.) dalam Bahasa Indonesia yang baik, benar, dan profesional.";
}

// ── Brand Strategist ──────────────────────────────────────────────────────────

export function buildBrandStrategistPrompt(
  brief: CreativeBriefInput,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are an expert Brand Strategist with 20+ years of experience building iconic brands across Southeast Asia and globally. You craft precise, actionable brand strategies grounded in market research and consumer psychology. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Develop a comprehensive brand strategy for the following brief:

BRAND NAME: ${brief.brandName}
BUSINESS TYPE: ${brief.businessType}
TARGET MARKET: ${brief.targetMarket}
PRODUCT / SERVICE: ${brief.productOrService}
STYLE PREFERENCE: ${brief.stylePreference}
GOAL: ${brief.goal}
${brief.notes ? `NOTES: ${brief.notes}` : ""}

Return a JSON object with these fields:
{
  "brand_values": ["value1", "value2", "value3"],
  "positioning": "one-sentence positioning statement",
  "target_audience": {
    "primary": "description",
    "psychographics": ["trait1", "trait2"],
    "pain_points": ["pain1", "pain2"]
  },
  "competitive_advantage": "what sets the brand apart",
  "brand_personality": ["trait1", "trait2", "trait3"],
  "key_messages": ["message1", "message2", "message3"],
  "tone_of_voice": "description of brand voice"
}`;

  return { systemPrompt, userPrompt };
}

// ── Creative Director ─────────────────────────────────────────────────────────

export function buildCreativeDirectorPrompt(
  brief: CreativeBriefInput,
  brandStrategy: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a world-class Creative Director specialising in brand identity, visual storytelling, and integrated campaigns. You translate brand strategy into compelling creative direction. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Create a detailed creative direction brief based on this brand strategy:

BRIEF OVERVIEW:
- Brand: ${brief.brandName} (${brief.businessType})
- Goal: ${brief.goal}
- Style: ${brief.stylePreference}

BRAND STRATEGY SUMMARY:
${JSON.stringify(brandStrategy, null, 2)}

Return a JSON object with these fields:
{
  "creative_concept": {
    "name": "concept name",
    "description": "concept description",
    "rationale": "why this concept fits the brand"
  },
  "visual_style": {
    "approach": "photographic | illustrative | typographic | mixed",
    "mood": "description of overall mood",
    "references": ["reference1", "reference2"]
  },
  "color_direction": {
    "primary": "#hexcolor",
    "secondary": "#hexcolor",
    "accent": "#hexcolor",
    "rationale": "why these colors work for the brand"
  },
  "typography": {
    "headline_style": "bold geometric | serif | script | etc",
    "body_style": "clean sans-serif | etc",
    "hierarchy": "description of text hierarchy"
  },
  "imagery_direction": "detailed description of image style and subject matter",
  "campaign_concept": "overarching campaign idea in 2-3 sentences"
}`;

  return { systemPrompt, userPrompt };
}

// ── Copywriter ────────────────────────────────────────────────────────────────

export function buildCopywriterPrompt(
  brief: CreativeBriefInput,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are an award-winning Copywriter and Brand Voice specialist. You craft copy that converts, inspires, and stays true to the brand's personality. Your words sell without feeling like a sales pitch. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Write compelling brand copy for this campaign:

BRAND: ${brief.brandName}
TARGET: ${brief.targetMarket}
GOAL: ${brief.goal}
STYLE: ${brief.stylePreference}

BRAND STRATEGY: ${JSON.stringify(brandStrategy, null, 2)}
CREATIVE DIRECTION: ${JSON.stringify(creativeDirection, null, 2)}

Return a JSON object with these fields:
{
  "tagline": "short memorable brand tagline (max 6 words)",
  "headline": {
    "primary": "main campaign headline",
    "alternatives": ["alt1", "alt2"]
  },
  "body_copy": {
    "short": "50-word version",
    "long": "150-word version"
  },
  "cta": {
    "primary": "main call to action",
    "secondary": "secondary CTA"
  },
  "social_captions": [
    { "platform": "Instagram", "caption": "caption with hashtags" },
    { "platform": "LinkedIn",  "caption": "professional caption" },
    { "platform": "Twitter",   "caption": "short punchy caption" }
  ],
  "email_subject_lines": ["subject1", "subject2", "subject3"],
  "tone_notes": "notes on the brand voice applied in this copy"
}`;

  return { systemPrompt, userPrompt };
}

// ── Quality Control ───────────────────────────────────────────────────────────

export function buildQcPrompt(
  brief: CreativeBriefInput,
  brandStrategy: Record<string, unknown>,
  creativeDirection: Record<string, unknown>,
  copyOutput: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const langInstruction = extractLanguageInstruction(brief.notes);
  const systemPrompt = `You are a rigorous Quality Control specialist and Brand Guardian. You review all creative outputs against brand strategy, brief requirements, and industry best practices. You provide constructive feedback and a clear approval decision. Always respond in valid JSON. ${langInstruction}`;

  const userPrompt = `Review all outputs from the Creative Brief pipeline:

ORIGINAL BRIEF:
- Brand: ${brief.brandName} (${brief.businessType})
- Target: ${brief.targetMarket}
- Goal: ${brief.goal}
- Style: ${brief.stylePreference}

BRAND STRATEGY: ${JSON.stringify(brandStrategy, null, 2)}
CREATIVE DIRECTION: ${JSON.stringify(creativeDirection, null, 2)}
COPY OUTPUTS: ${JSON.stringify(copyOutput, null, 2)}

Evaluate and return a JSON object:
{
  "overall_score": 0-100,
  "brand_consistency": "Strong | Good | Needs Improvement | Poor",
  "messaging_clarity": "Clear and compelling | Adequate | Unclear",
  "target_audience_alignment": "Excellent fit | Good fit | Misaligned",
  "creativity_score": 0-100,
  "strategic_alignment": 0-100,
  "strengths": ["strength1", "strength2", "strength3"],
  "recommendations": ["improvement1", "improvement2"],
  "critical_issues": [],
  "approved": true,
  "approval_notes": "brief summary of review decision"
}`;

  return { systemPrompt, userPrompt };
}

// ── Response parser ───────────────────────────────────────────────────────────

/**
 * Extracts the first valid JSON object from an AI text response.
 * Handles markdown code fences and leading/trailing noise.
 */
export function parseJsonResponse(text: string): Record<string, unknown> {
  // Strip markdown code fences
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Find the first { ... } block
  const start = cleaned.indexOf("{");
  const end   = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in AI response: ${text.slice(0, 200)}`);
  }
  cleaned = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse AI JSON response: ${cleaned.slice(0, 200)}`);
  }
}
