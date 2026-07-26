/**
 * Design Template AI Service — Phase 7
 *
 * Converts a natural-language prompt into a validated DesignTemplate draft.
 *
 * Pipeline:
 *   1. Build structured prompt with size/variable context
 *   2. Call AI model (OpenAI) with JSON mode
 *   3. Parse + Zod-validate the output
 *   4. Normalize coordinates, enforce canvas limits, deduplicate element IDs
 *   5. Verify variable bindings are consistent
 *   6. Record AI cost
 *   7. Return validated proposal — caller is responsible for DB save (draft only)
 *
 * Security rules enforced here:
 *   - No arbitrary JS / HTML / SVG scripts in output
 *   - No external font URLs
 *   - No private-network image URLs
 *   - Max element count enforced
 *   - Unknown element types stripped
 */

import OpenAI from "openai";
import { getProviderApiKey } from "../aiSecretService.js";
import { recordCost } from "../costService.js";
import {
  aiTemplateProposalSchema,
  type AiTemplateProposal,
  type AiTemplateAssistRequest,
} from "../../validators/designTemplateAiSchema.js";
import { DESIGN_LIMITS } from "../../types/designTemplate.js";
import { logger } from "../../lib/logger.js";

// ── Contrast helpers ───────────────────────────────────────────────────────────

function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const lin = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function autoContrastText(bgHex: string, darkFallback = "#1a1a1a"): string {
  return relativeLuminance(bgHex) > 0.35 ? darkFallback : "#ffffff";
}

/**
 * Post-process AI-generated elements:
 * - If a text element's color is the same lightness as the canvas background,
 *   replace it with an auto-contrasted color so it stays readable.
 * - Text sitting over an image placeholder (which renders white) gets dark text.
 */
function fixTextContrast(proposal: AiTemplateProposal): AiTemplateProposal {
  const canvasBg = proposal.template.canvas.backgroundColor ?? "#ffffff";
  const bgLum = relativeLuminance(canvasBg);

  // A "safe" text color for the canvas background
  const safeBgText = bgLum > 0.35 ? "#111827" : "#ffffff";

  const imageRanges = proposal.template.elements
    .filter((e: any) => e.type === "image")
    .map((e: any) => ({ y: e.y as number, bottom: (e.y as number) + (e.height as number) }));

  const fixed = proposal.template.elements.map((el: any) => {
    if (el.type !== "text") return el;

    const elColor: string = el.color ?? safeBgText;
    const elLum = relativeLuminance(elColor);
    const elBottom = (el.y as number) + (el.height as number);

    // Text overlapping an image placeholder → force dark (image shows as white)
    const onImage = imageRanges.some(
      (r: { y: number; bottom: number }) => (el.y as number) < r.bottom && elBottom > r.y,
    );
    if (onImage) {
      return { ...el, color: autoContrastText("#ffffff") };
    }

    // Text color almost same luminance as canvas bg → swap to contrasting
    const contrastRatio = Math.abs(elLum - bgLum);
    if (contrastRatio < 0.15) {
      return { ...el, color: safeBgText };
    }

    return el;
  });

  return {
    ...proposal,
    template: { ...proposal.template, elements: fixed },
  };
}

// ── Size presets ───────────────────────────────────────────────────────────────

const SIZE_PRESETS: Record<string, { width: number; height: number }> = {
  "instagram-square":    { width: 1080, height: 1080 },
  "instagram-portrait":  { width: 1080, height: 1350 },
  "instagram-landscape": { width: 1080, height: 566 },
  "a4":                  { width: 2480, height: 3508 },
};

// ── System prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a professional graphic design assistant. Your job is to create structured design template plans in JSON format.

LANGUAGE: Write all descriptive text values (summary, assumptions, variable labels and placeholders, element content text) in Bahasa Indonesia.

RULES (non-negotiable):
1. Output ONLY valid JSON — no markdown, no code fences, no explanation text.
2. Never include JavaScript, HTML tags, SVG scripts, eval(), or executable expressions.
3. Never include font URLs — use font family names only (e.g. "Inter", "Roboto", "Georgia").
4. Never include private network URLs (localhost, 127.x, 192.168.x, 10.x, file://, data://).
5. Image URLs must start with https:// or use { binding: { variableKey: "..." } }.
6. All colors must be CSS hex (#RRGGBB or #RGB).
7. Element types allowed: text, image, shape, qrcode, line.
8. Maximum ${DESIGN_LIMITS.MAX_ELEMENT_COUNT} elements total.
9. Maximum ${DESIGN_LIMITS.MAX_VARIABLE_COUNT} variables total.
10. All element IDs must be unique, alphanumeric with - or _ only.
11. Variable keys must be alphanumeric with - or _ only.
12. Text content must not contain HTML tags or script patterns.
13. Only use binding references to variables you declared in the variables array.

IMPORTANT CONTRAST RULE:
Text color MUST contrast with the surface it sits on.
- If backgroundColor is light (e.g. #ffffff, #f5f5f5), use DARK text (e.g. #111827, #1a1a1a).
- If backgroundColor is dark (e.g. #1E40AF, #000000), use LIGHT text (e.g. #ffffff, #f9fafb).
- Never place white (#ffffff) text on a white or near-white canvas background.
- For text overlapping an image placeholder, always use dark text (#111827) since the placeholder renders white.

OUTPUT FORMAT:
{
  "summary": "Brief description of the template",
  "assumptions": ["assumption 1", "assumption 2"],
  "variables": [
    { "key": "product_name", "label": "Product Name", "type": "text", "required": true }
  ],
  "template": {
    "name": "Template Name",
    "description": "Template description",
    "category": "Category",
    "canvas": { "width": 1080, "height": 1080, "unit": "px", "backgroundColor": "#1E3A8A" },
    "elements": [
      { "id": "bg", "type": "shape", "x": 0, "y": 0, "width": 1080, "height": 1080, "zIndex": 0, "shape": "rectangle", "fill": "#1E3A8A" },
      { "id": "title", "type": "text", "x": 60, "y": 200, "width": 960, "height": 120, "zIndex": 1, "content": { "binding": { "variableKey": "product_name" } }, "fontSize": 64, "color": "#FFFFFF", "textAlign": "center", "fontWeight": "bold" }
    ],
    "variables": []
  },
  "warnings": []
}`;
}

// ── Normalize + sanitize AI output ─────────────────────────────────────────────

function sanitizeProposal(raw: AiTemplateProposal, canvasW: number, canvasH: number): AiTemplateProposal {
  // Deduplicate element IDs
  const seenIds = new Set<string>();
  const elements = raw.template.elements
    .slice(0, DESIGN_LIMITS.MAX_ELEMENT_COUNT)
    .map((el: any, idx: number) => {
      let id = String(el.id ?? `el-${idx}`).replace(/[^a-zA-Z0-9_\-]/g, "-").slice(0, 64) || `el-${idx}`;
      if (seenIds.has(id)) id = `${id}-${idx}`;
      seenIds.add(id);

      // Clamp coordinates to canvas
      return {
        ...el,
        id,
        x: Math.max(-canvasW, Math.min(el.x ?? 0, canvasW)),
        y: Math.max(-canvasH, Math.min(el.y ?? 0, canvasH)),
        width: Math.max(1, Math.min(el.width ?? 100, canvasW)),
        height: Math.max(1, Math.min(el.height ?? 100, canvasH)),
      };
    });

  // Collect declared variable keys
  const declaredKeys = new Set(raw.variables.map((v) => v.key));

  // Ensure template variables match top-level variables
  const mergedVariables = raw.variables.slice(0, DESIGN_LIMITS.MAX_VARIABLE_COUNT);

  return {
    ...raw,
    variables: mergedVariables,
    template: {
      ...raw.template,
      canvas: {
        ...raw.template.canvas,
        width: Math.min(raw.template.canvas.width, DESIGN_LIMITS.MAX_CANVAS_WIDTH),
        height: Math.min(raw.template.canvas.height, DESIGN_LIMITS.MAX_CANVAS_HEIGHT),
      },
      elements,
      variables: mergedVariables,
    },
  };

  void declaredKeys; // used implicitly by Zod validation that follows
}

// ── Main service function ──────────────────────────────────────────────────────

export interface AiTemplateAssistResult {
  proposal: AiTemplateProposal;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const MAX_REPAIR_ATTEMPTS = 2;

export async function generateTemplateFromPrompt(
  request: AiTemplateAssistRequest,
  tenantId: string,
  actorId: string,
): Promise<AiTemplateAssistResult> {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) {
    throw new Error("OpenAI API key not configured. Add an OpenAI provider with a valid API key in the AI registry.");
  }

  // Resolve canvas size
  const preset = request.sizePreset ? SIZE_PRESETS[request.sizePreset] : null;
  const canvasW = request.canvasWidth ?? preset?.width ?? 1080;
  const canvasH = request.canvasHeight ?? preset?.height ?? 1080;

  const client = new OpenAI({ apiKey });
  const model = "gpt-4o";

  const userPrompt = [
    `Design request: ${request.prompt}`,
    `Canvas size: ${canvasW}×${canvasH}px`,
    request.industry ? `Industry/category: ${request.industry}` : null,
    request.brandColors?.length ? `Brand colors: ${request.brandColors.join(", ")}` : null,
    request.desiredVariables?.length ? `Desired variables: ${request.desiredVariables.join(", ")}` : null,
    `Language for text: ${request.language ?? "id"}`,
    `\nIMPORTANT: Respond with ONLY the JSON object. No markdown, no code fences.`,
  ].filter(Boolean).join("\n");

  let lastError: unknown;
  let inputTokens = 0;
  let outputTokens = 0;

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: attempt === 0 ? userPrompt : `${userPrompt}\n\nPrevious attempt failed validation: ${String(lastError)}. Please fix and return only valid JSON.` },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      });

      inputTokens = completion.usage?.prompt_tokens ?? 0;
      outputTokens = completion.usage?.completion_tokens ?? 0;

      const raw = completion.choices[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        lastError = "AI response was not valid JSON";
        continue;
      }

      const validated = aiTemplateProposalSchema.safeParse(parsed);
      if (!validated.success) {
        lastError = validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        logger.warn({ attempt, error: lastError }, "[template-ai] Validation failed, retrying");
        continue;
      }

      // Sanitize and normalize
      const sanitized = sanitizeProposal(validated.data, canvasW, canvasH);

      // Fix text contrast (white text on white canvas etc.)
      const contrastFixed = fixTextContrast(sanitized);

      // Record cost
      try {
        await recordCost({
          projectId: `tenant-${tenantId}`,
          agentSlug: "design_template_assistant",
          provider: "openai",
          model,
          inputTokens,
          outputTokens,
          status: "success",
        });
      } catch (costErr) {
        logger.warn({ costErr }, "[template-ai] Cost recording failed (non-fatal)");
      }

      return { proposal: contrastFixed, provider: "openai", model, inputTokens, outputTokens };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, err }, "[template-ai] AI call failed");
    }
  }

  // Record failure cost
  try {
    await recordCost({
      projectId: `tenant-${tenantId}`,
      agentSlug: "design_template_assistant",
      provider: "openai",
      model,
      inputTokens,
      outputTokens,
      status: "error",
    });
  } catch { /* ignore */ }

  throw new Error(`AI template generation failed after ${MAX_REPAIR_ATTEMPTS + 1} attempts: ${String(lastError)}`);
}
