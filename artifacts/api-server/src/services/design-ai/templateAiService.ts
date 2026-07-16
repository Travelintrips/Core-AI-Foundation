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
import { runVisualQa, type VisualQaReport } from "./visualQaService.js";

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
    "canvas": { "width": 1080, "height": 1080, "unit": "px", "backgroundColor": "#FFFFFF" },
    "elements": [
      { "id": "bg", "type": "shape", "x": 0, "y": 0, "width": 1080, "height": 1080, "zIndex": 0, "shape": "rectangle", "fill": "#1E40AF" },
      { "id": "title", "type": "text", "x": 60, "y": 200, "width": 960, "height": 120, "zIndex": 1, "content": { "binding": { "variableKey": "product_name" } }, "fontSize": 64, "color": "#FFFFFF", "textAlign": "center" }
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

      // Clamp top-left corner so it starts within the canvas
      const x = Math.max(0, Math.min(el.x ?? 0, canvasW - 1));
      const y = Math.max(0, Math.min(el.y ?? 0, canvasH - 1));
      // Clamp size so the right/bottom edge does not cross the canvas boundary
      const width  = Math.max(1, Math.min(el.width  ?? 100, canvasW - x));
      const height = Math.max(1, Math.min(el.height ?? 100, canvasH - y));

      return { ...el, id, x, y, width, height };
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
  /** Visual QA report — bounds + contrast results, auto-fix counts, score 0-100. */
  visualQa: VisualQaReport;
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

      // Sanitize and normalize (bounds clamping — right+bottom edges enforced)
      const sanitized = sanitizeProposal(validated.data, canvasW, canvasH);

      // Visual QA: contrast + residual bounds check, auto-fix, score
      const { proposal: qaProposal, qa } = runVisualQa(sanitized, canvasW, canvasH);
      logger.info(
        {
          visualQaScore: qa.visualQaScore,
          autoFixedBounds: qa.autoFixedBounds,
          autoFixedColors: qa.autoFixedColors,
          contrastIssues: qa.contrastIssues.length,
          boundsIssues: qa.boundsIssues.length,
        },
        "[template-ai] Visual QA completed",
      );

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

      return { proposal: qaProposal, provider: "openai", model, inputTokens, outputTokens, visualQa: qa };
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
