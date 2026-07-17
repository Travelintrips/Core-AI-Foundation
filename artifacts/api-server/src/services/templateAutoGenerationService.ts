/**
 * Template Auto-Generation Service — Enterprise Template Knowledge Library V5.0
 *
 * Called when matching score < 70. Uses AI to:
 * 1. Analyze the gap between input and best available template
 * 2. Generate a complete new Template Knowledge specification
 * 3. Queue it for admin review (status: pending_review)
 * 4. Return the draft for immediate display
 */

import { db, aiGeneratedTemplatesTable, aiStyleKnowledgeTable, aiIndustryKnowledgeTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { InsertAiGeneratedTemplate } from "@workspace/db";
import type { KnowledgeMatchInput, KnowledgeMatchResult } from "./templateKnowledgeMatchingService.js";

// ─────────────────────────────────────────────────────────────────────────────
// AI call helper — uses the platform's configured AI providers
// ─────────────────────────────────────────────────────────────────────────────

async function callAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert creative director and brand strategist. You generate structured template knowledge specifications in JSON format. Always respond with valid JSON only — no markdown, no explanation.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI call failed: ${response.status} — ${text}`);
  }

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");
  return content;
}

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge generation prompt builder
// ─────────────────────────────────────────────────────────────────────────────

function buildGenerationPrompt(input: KnowledgeMatchInput, nearest: KnowledgeMatchResult | undefined, gap: string): string {
  return `Generate a complete Template Knowledge specification for:

Industry: ${input.industry ?? "General"}
Category: ${input.category ?? "Company Profile"}
Style: ${input.preferredStyle ?? "Modern"}
Target Audience: ${input.targetAudience ?? "Business professionals"}
Brand Personalities: ${(input.brandPersonalities ?? []).join(", ") || "professional, trustworthy"}
Business Type: ${input.businessType ?? "B2B"}
Price Positioning: ${input.pricePositioning ?? "mid-market"}
Keywords: ${(input.keywords ?? []).join(", ") || "none provided"}

Nearest existing template: ${nearest?.template?.name ?? "none"}
Gap to address: ${gap}

Generate a JSON object with this exact structure:
{
  "name": "Template display name",
  "description": "1-2 sentence description",
  "businessContext": {
    "businessType": "B2B|B2C|D2C|Enterprise|SME|Startup",
    "market": "local|national|regional|global",
    "targetAudience": "audience description",
    "customerPersona": "specific persona with age/psychographics",
    "pricePositioning": "budget|mid-market|premium|luxury"
  },
  "brandDna": {
    "personalities": ["word1", "word2", "word3"],
    "emotions": ["emotion1", "emotion2"],
    "archetypes": ["Archetype1", "Archetype2"],
    "voice": "brand voice description",
    "tone": "formal|professional|conversational|inspirational|friendly",
    "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
  },
  "visualDna": {
    "designStyle": "style name",
    "layoutStyle": "editorial|grid|asymmetric|single-column|two-column",
    "spacingStyle": "compact|balanced|airy|generous",
    "illustrationStyle": "none|geometric|organic|realistic",
    "photographyStyle": "editorial|lifestyle|product|documentary",
    "iconStyle": "none|outline|filled|duotone"
  },
  "colorSystem": {
    "primary": "#hexcode",
    "secondary": "#hexcode",
    "accent": "#hexcode",
    "neutral": "#hexcode",
    "background": "#hexcode",
    "contrastRules": "contrast rule description",
    "accessibilityScore": "AA|AAA"
  },
  "typography": {
    "headingFont": "Font Name",
    "bodyFont": "Font Name",
    "fontMood": "mood description",
    "hierarchyRules": "hierarchy rule description"
  },
  "composition": {
    "heroLayout": "full-bleed|split|centered|editorial",
    "sectionOrder": ["section1", "section2", "section3", "section4", "section5"],
    "gridSystem": "12-column|8-column|masonry|editorial",
    "whitespaceRules": "generous|balanced|compact"
  },
  "outputSupport": {
    "pdf": true,
    "pptx": false,
    "png": true,
    "svg": false,
    "html": false,
    "socialMedia": false
  },
  "promptGuidance": {
    "systemPrompt": "System-level AI direction for this template",
    "designerPrompt": "Design direction for the creative",
    "artDirectionPrompt": "Art direction for visual assets",
    "imagePrompt": "Image generation prompt",
    "negativePrompt": "What to avoid in image generation"
  },
  "qualityRules": {
    "checklist": ["check1", "check2", "check3", "check4"],
    "designRules": ["rule1", "rule2", "rule3"],
    "prohibitedPatterns": ["pattern1", "pattern2"]
  }
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Code generator for the new template
// ─────────────────────────────────────────────────────────────────────────────

function generateTemplateCode(industry: string, style: string, category: string): string {
  const cat = category.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase();
  const ind = industry.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase();
  const sty = style.replace(/[^A-Za-z]/g, "").substring(0, 3).toUpperCase();
  const timestamp = Date.now().toString(36).toUpperCase();
  return `${cat}-${ind}-${sty}-GEN-${timestamp}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main generation function
// ─────────────────────────────────────────────────────────────────────────────

export interface GenerationResult {
  generatedTemplateCode: string;
  knowledge: Record<string, unknown>;
  gapExplanation: string;
  status: "pending_review";
  message: string;
}

export async function generateHybridTemplate(
  input: KnowledgeMatchInput,
  triggerScore: number,
  nearest: KnowledgeMatchResult | undefined,
  clientId?: string,
): Promise<GenerationResult> {
  const gap = nearest?.gapExplanation ?? "No close template found for this combination.";
  const generatedTemplateCode = generateTemplateCode(
    input.industry ?? "GEN",
    input.preferredStyle ?? "MOD",
    input.category ?? "CP",
  );

  // Generate knowledge via AI
  let knowledge: Record<string, unknown>;
  try {
    const prompt = buildGenerationPrompt(input, nearest, gap);
    const aiResponse = await callAI(prompt);
    // Strip markdown if present
    const cleaned = aiResponse.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    knowledge = JSON.parse(cleaned) as Record<string, unknown>;
  } catch (err) {
    // Fallback to rule-based generation if AI fails
    knowledge = generateFallbackKnowledge(input);
  }

  // Save to queue
  const record: InsertAiGeneratedTemplate = {
    requestedForClientId: clientId,
    triggerMatchScore: triggerScore,
    triggerInput: input as Record<string, unknown>,
    gapExplanation: gap,
    generatedTemplateCode,
    generatedKnowledge: knowledge,
    status: "pending_review",
  };

  await db.insert(aiGeneratedTemplatesTable).values(record).onConflictDoNothing();

  return {
    generatedTemplateCode,
    knowledge,
    gapExplanation: gap,
    status: "pending_review",
    message: `A new template knowledge specification has been generated and queued for admin review. Code: ${generatedTemplateCode}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback rule-based knowledge generation (if AI is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

function generateFallbackKnowledge(input: KnowledgeMatchInput): Record<string, unknown> {
  const styleDefaults: Record<string, { primary: string; heading: string; body: string }> = {
    modern: { primary: "#1E40AF", heading: "Inter", body: "Inter" },
    luxury: { primary: "#C9A84C", heading: "Cormorant Garamond", body: "Montserrat" },
    minimalist: { primary: "#1A1A1A", heading: "Helvetica Neue", body: "Helvetica Neue" },
    corporate: { primary: "#1E40AF", heading: "Inter", body: "Open Sans" },
    bold: { primary: "#DC2626", heading: "Bebas Neue", body: "Roboto" },
    elegant: { primary: "#C4A09A", heading: "Cormorant", body: "Lato" },
    organic: { primary: "#7C9A7E", heading: "Playfair Display", body: "Lora" },
  };

  const style = input.preferredStyle ?? "modern";
  const sd = styleDefaults[style] ?? styleDefaults.modern!;

  return {
    name: `${input.industry ?? "General"} ${input.category ?? "Template"} — ${style}`,
    description: `AI-generated template for ${input.industry ?? "general"} industry in ${style} style.`,
    businessContext: {
      businessType: input.businessType ?? "B2B",
      market: "national",
      targetAudience: input.targetAudience ?? "Business professionals",
      customerPersona: input.targetAudience ?? "Professional buyer, 30-50",
      pricePositioning: input.pricePositioning ?? "mid-market",
    },
    brandDna: {
      personalities: input.brandPersonalities ?? ["professional", "reliable"],
      emotions: ["confident", "trustworthy"],
      archetypes: ["Hero", "Ruler"],
      voice: "authoritative",
      tone: "professional",
      keywords: input.keywords ?? [input.industry ?? "business", "quality", "excellence"],
    },
    colorSystem: {
      primary: sd.primary,
      secondary: "#374151",
      accent: "#F59E0B",
      neutral: "#9CA3AF",
      background: "#FFFFFF",
      contrastRules: "4.5:1 minimum WCAG AA",
      accessibilityScore: "AA",
    },
    typography: {
      headingFont: sd.heading,
      bodyFont: sd.body,
      fontMood: "professional and clean",
      hierarchyRules: "Bold headings, regular body, clear size hierarchy",
    },
    composition: {
      heroLayout: "split",
      sectionOrder: ["cover_page", "about_company", "services_grid", "statistics_impact", "testimonials", "contact_form"],
      gridSystem: "12-column",
      whitespaceRules: "balanced",
    },
    outputSupport: { pdf: true, pptx: true, png: true, svg: false, html: false, socialMedia: false },
    promptGuidance: {
      systemPrompt: `You are a professional ${style} designer creating content for the ${input.industry ?? "business"} industry.`,
      designerPrompt: `Apply ${style} design principles. Target audience: ${input.targetAudience ?? "business professionals"}.`,
      artDirectionPrompt: `${style} composition, professional photography, clear hierarchy.`,
      imagePrompt: `Professional ${input.industry ?? "business"} environment, ${style} aesthetic, high quality`,
      negativePrompt: "amateur, cluttered, stock photo, inconsistent",
    },
    qualityRules: {
      checklist: ["WCAG AA contrast check", "Typography hierarchy verified", "Brand consistency", "Mobile responsiveness"],
      designRules: [`${style} style guidelines applied`, "Maximum 3 accent uses", "Consistent spacing system"],
      prohibitedPatterns: ["Mismatched styles", "Low-quality images", "Inconsistent typography"],
    },
    _generated: "fallback",
    _generatedAt: new Date().toISOString(),
  };
}
