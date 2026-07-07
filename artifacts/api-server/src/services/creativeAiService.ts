/**
 * creativeAiService — prompt builders for the 4-agent Creative Brief workflow.
 * Each function returns { systemPrompt, userPrompt } ready for executeAI().
 */

export interface CreativeBriefInput {
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  stylePreference?: string | null;
  goal: string;
  notes?: string | null;
}

function briefSummary(brief: CreativeBriefInput): string {
  return [
    `Brand: ${brief.brandName}`,
    `Business Type: ${brief.businessType}`,
    `Target Market: ${brief.targetMarket}`,
    `Product/Service: ${brief.productOrService}`,
    `Style Preference: ${brief.stylePreference || "Not specified"}`,
    `Goal: ${brief.goal}`,
    `Notes: ${brief.notes || "None"}`,
  ].join("\n");
}

// ── Step 1: Brand Strategist ──────────────────────────────────────────────────

export function buildBrandStrategistPrompt(brief: CreativeBriefInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: `You are an expert AI Brand Strategist. You define brand positioning, USP, target audience, and tone of voice based on creative briefs.

CRITICAL: Respond with valid JSON only. No markdown, no explanation. Use exactly these keys:
{
  "brand_positioning": "A clear, differentiated statement of how this brand is positioned in the market",
  "target_audience": {
    "primary": "Primary target segment (demographics + psychographics in 1-2 sentences)",
    "psychographic": "Key motivations, values, and lifestyle traits",
    "pain_points": ["pain point 1", "pain point 2", "pain point 3"]
  },
  "usp": "Single sentence unique selling proposition — what makes this brand distinctly valuable",
  "tone_of_voice": {
    "personality": "3-5 personality adjectives (e.g. Bold, Warm, Authoritative)",
    "style": "Communication style description (1-2 sentences)",
    "avoid": "What to avoid in brand communications"
  }
}`,
    userPrompt: `Analyze this creative brief and provide brand strategy:\n\n${briefSummary(brief)}`,
  };
}

// ── Step 2: Creative Director ─────────────────────────────────────────────────

export function buildCreativeDirectorPrompt(
  brief: CreativeBriefInput,
  brandStrategyOutput: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are an expert AI Creative Director. You translate brand strategy into creative direction: concept, colors, typography, and visual style.

CRITICAL: Respond with valid JSON only. No markdown, no explanation. Use exactly these keys:
{
  "creative_concept": {
    "name": "Concept name (2-4 words, evocative and memorable)",
    "description": "What this concept means and why it works for the brand (1-2 sentences)"
  },
  "color_direction": {
    "primary": "Color name + hex code (e.g. Deep Navy #1A2B4A)",
    "secondary": "Color name + hex code",
    "accent": "Color name + hex code",
    "rationale": "Why this palette fits the brand personality and audience"
  },
  "typography_direction": {
    "heading": "Font personality/style recommendation + why it fits (e.g. Geometric sans-serif — projects confidence)",
    "body": "Font personality/style recommendation + why it fits",
    "usage": "Key typography rules (hierarchy, weight, spacing)"
  },
  "visual_style": {
    "approach": "Photography or illustration approach (e.g. Clean lifestyle photography with natural light)",
    "mood": "Mood/atmosphere description (e.g. Aspirational yet approachable)",
    "composition": "Composition and layout principles (e.g. Generous white space, rule of thirds)"
  }
}`,
    userPrompt: `BRAND STRATEGY:\n${JSON.stringify(brandStrategyOutput, null, 2)}\n\nORIGINAL BRIEF:\n${briefSummary(brief)}\n\nProvide creative direction that brings this brand to life visually.`,
  };
}

// ── Step 3: Copywriter ────────────────────────────────────────────────────────

export function buildCopywriterPrompt(
  brief: CreativeBriefInput,
  brandStrategyOutput: Record<string, unknown>,
  creativeDirectorOutput: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are a world-class AI Copywriter specializing in brand voice and conversion-focused copy.

CRITICAL: Respond with valid JSON only. No markdown, no explanation. Use exactly these keys:
{
  "headline_options": [
    "Headline 1 (punchy, max 10 words)",
    "Headline 2 (different angle or emotion)",
    "Headline 3 (benefit-focused or question-based)"
  ],
  "caption_options": [
    "Caption 1 (1-2 sentences — brand voice, value proposition, engaging)",
    "Caption 2 (different tone or use case)",
    "Caption 3 (storytelling or social proof angle)"
  ],
  "cta_options": [
    "CTA 1 (max 5 words, action-oriented)",
    "CTA 2 (different urgency or benefit)",
    "CTA 3 (softer or discovery-focused)"
  ]
}`,
    userPrompt: `BRAND STRATEGY:\n${JSON.stringify(brandStrategyOutput, null, 2)}\n\nCREATIVE DIRECTION:\n${JSON.stringify(creativeDirectorOutput, null, 2)}\n\nORIGINAL BRIEF:\n${briefSummary(brief)}\n\nWrite compelling copy assets aligned with the brand voice and creative direction.`,
  };
}

// ── Step 4: Quality Control ───────────────────────────────────────────────────

export function buildQcPrompt(
  brief: CreativeBriefInput,
  brandStrategyOutput: Record<string, unknown>,
  creativeDirectorOutput: Record<string, unknown>,
  copywriterOutput: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: `You are an expert AI Quality Control Reviewer for brand strategy and creative work. Be objective and constructive — identify real issues, don't just rubber-stamp.

Status values: "pass" (meets standards), "warning" (minor concern), "fail" (significant problem)

CRITICAL: Respond with valid JSON only. No markdown, no explanation. Use exactly these keys:
{
  "qc_checklist": [
    {"item": "Brand Positioning Clarity", "status": "pass|warning|fail", "note": "Specific observation about this item"},
    {"item": "USP Distinctiveness", "status": "pass|warning|fail", "note": "Specific observation"},
    {"item": "Tone of Voice Consistency", "status": "pass|warning|fail", "note": "Specific observation"},
    {"item": "Creative Concept Alignment", "status": "pass|warning|fail", "note": "Specific observation"},
    {"item": "Copy Quality & Brand Voice", "status": "pass|warning|fail", "note": "Specific observation"},
    {"item": "Target Audience Fit", "status": "pass|warning|fail", "note": "Specific observation"},
    {"item": "Visual Direction Coherence", "status": "pass|warning|fail", "note": "Specific observation"}
  ],
  "overall_score": "excellent|good|needs_revision",
  "key_recommendations": [
    "Specific actionable recommendation 1",
    "Specific actionable recommendation 2",
    "Specific actionable recommendation 3"
  ]
}`,
    userPrompt: `Review the complete creative output for quality and consistency.\n\nORIGINAL BRIEF:\n${briefSummary(brief)}\n\nBRAND STRATEGY:\n${JSON.stringify(brandStrategyOutput, null, 2)}\n\nCREATIVE DIRECTION:\n${JSON.stringify(creativeDirectorOutput, null, 2)}\n\nCOPY:\n${JSON.stringify(copywriterOutput, null, 2)}`,
  };
}

/** Safely parse JSON from an AI response. Strips markdown code fences if present. */
export function parseJsonResponse(content: string): Record<string, unknown> {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}
