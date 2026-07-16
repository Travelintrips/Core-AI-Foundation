/**
 * AI Template Assistant — POST /ai/design-templates/ai-assist
 *
 * Accepts a natural-language prompt, calls OpenAI to generate a structured
 * DesignTemplate JSON proposal, validates it with the existing Zod schema,
 * applies safety checks, saves it as a draft version, and returns the result.
 *
 * Rules:
 *  - AI is called ONCE per request (not per-row).
 *  - All AI output passes Zod validation before being saved.
 *  - Safety checks: no path traversal in IDs, no non-https URLs, no JS/HTML,
 *    no out-of-bounds coordinates, no duplicate element IDs.
 *  - Cost is recorded via costService.
 */

import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { resolveAuthenticatedTenantContext } from "../security/tenantResolution.js";
import { designTemplateJsonSchema } from "../validators/designTemplateSchema.js";
import { createTemplate, createVersion } from "../services/designTemplateService.js";
import { recordCost } from "../services/costService.js";
import { logger } from "../lib/logger.js";
import { DESIGN_LIMITS, DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";
import type { DesignTemplate, DesignElement } from "../types/designTemplate.js";

const router = Router();

// ── Size presets (static, no auth required) ───────────────────────────────────

/** GET /ai/design-templates/ai-assist/presets */
router.get("/ai/design-templates/ai-assist/presets", (_req, res) => {
  res.json({
    presets: [
      { id: "instagram-square",    label: "Instagram Square (1080×1080)",    width: 1080, height: 1080 },
      { id: "instagram-portrait",  label: "Instagram Portrait (1080×1350)",  width: 1080, height: 1350 },
      { id: "instagram-landscape", label: "Instagram Landscape (1080×566)",  width: 1080, height: 566  },
      { id: "facebook-post",       label: "Facebook Post (1200×630)",        width: 1200, height: 630  },
      { id: "twitter-post",        label: "Twitter/X Post (1200×675)",       width: 1200, height: 675  },
      { id: "a4",                  label: "A4 Document (2480×3508)",         width: 2480, height: 3508 },
      { id: "business-card",       label: "Business Card (1050×600)",        width: 1050, height: 600  },
      { id: "logo",                label: "Logo (800×800)",                  width: 800,  height: 800  },
      { id: "custom",              label: "Custom Size",                     width: null, height: null },
    ],
  });
});

// ── OpenAI client ─────────────────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey });
}

// ── Safety helpers ────────────────────────────────────────────────────────────

const PATH_TRAVERSAL_REGEX = /[<>:"/\\|?*\x00-\x1f]|\.\./;
const JS_HTML_REGEX = /<\s*(script|iframe|object|embed|link|style|meta|base|form|input|button|svg|img)[^>]*>|javascript:|data:text\/html|on\w+\s*=/i;

function collectElements(elements: DesignElement[]): DesignElement[] {
  const result: DesignElement[] = [];
  for (const el of elements) {
    result.push(el);
    if (el.type === "group" && el.children) {
      result.push(...collectElements(el.children as DesignElement[]));
    }
  }
  return result;
}

function applySafetyChecks(
  template: DesignTemplate,
): { safe: boolean; reason?: string } {
  const allElements = collectElements(template.elements as DesignElement[]);

  // 1. No duplicate element IDs
  const ids = allElements.map((e) => e.id);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) {
    return { safe: false, reason: "Duplicate element IDs detected" };
  }

  // 2. No path traversal/injection chars in element IDs
  for (const el of allElements) {
    if (PATH_TRAVERSAL_REGEX.test(el.id)) {
      return { safe: false, reason: `Element ID "${el.id}" contains unsafe characters` };
    }
  }

  // 3. No non-https URL assets (SSRF guard)
  for (const el of allElements) {
    if (el.type === "image") {
      const imgEl = el as typeof el & { src?: { type?: string; url?: string } };
      if (imgEl.src && "type" in imgEl.src && imgEl.src.type === "url") {
        const url = imgEl.src.url ?? "";
        if (url && !url.startsWith("https://")) {
          return { safe: false, reason: `Image element "${el.id}" uses non-https URL` };
        }
      }
    }
  }

  // 4. No JS/HTML in text content
  for (const el of allElements) {
    if (el.type === "text") {
      const textEl = el as typeof el & { content?: string | { binding: unknown } };
      if (typeof textEl.content === "string" && JS_HTML_REGEX.test(textEl.content)) {
        return { safe: false, reason: `Text element "${el.id}" contains unsafe HTML/JS content` };
      }
    }
  }

  // 5. Normalize out-of-bounds coordinates to canvas bounds
  for (const el of allElements) {
    if (el.x < 0) el.x = 0;
    if (el.y < 0) el.y = 0;
    if (el.x > template.canvas.width) el.x = template.canvas.width;
    if (el.y > template.canvas.height) el.y = template.canvas.height;
  }

  return { safe: true };
}

// ── AI system prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(canvasWidth: number, canvasHeight: number): string {
  return `You are a design template generator. Generate a valid DesignTemplate JSON object based on the user's prompt.

CRITICAL RULES:
1. Return ONLY valid JSON — no markdown fences, no code blocks, no comments, no explanations.
2. Do NOT include any JavaScript expressions, eval(), or executable code anywhere.
3. Do NOT include HTML or script tags in any text content.
4. All element IDs must be safe alphanumeric identifiers (a-z, A-Z, 0-9, underscore, hyphen only). No duplicates.
5. All image URLs must start with https:// — no http://, javascript:, data: URIs.
6. Element coordinates must be within canvas bounds (0 to ${canvasWidth} width, 0 to ${canvasHeight} height).
7. The schemaVersion must be exactly "${DESIGN_TEMPLATE_SCHEMA_VERSION}".
8. Canvas unit must be "px".
9. Elements max: ${DESIGN_LIMITS.MAX_ELEMENT_COUNT}. Variables max: ${DESIGN_LIMITS.MAX_VARIABLE_COUNT}.

Required JSON structure:
{
  "schemaVersion": "${DESIGN_TEMPLATE_SCHEMA_VERSION}",
  "id": "<string>",
  "tenantId": "<string>",
  "name": "<string>",
  "description": "<string>",
  "category": "<string>",
  "canvas": { "width": ${canvasWidth}, "height": ${canvasHeight}, "unit": "px", "backgroundColor": "#ffffff" },
  "elements": [...],
  "variables": [...],
  "metadata": { "createdBy": "ai-assist", "createdAt": "<ISO date>", "updatedAt": "<ISO date>", "version": 1 }
}

Variable binding in elements uses: { "binding": { "variableKey": "key_name" } }
Element types: text, image, shape, qrcode, line, icon, group.
Each element requires: id, type, x, y, width, height, zIndex.`;
}

// ── Request schema ────────────────────────────────────────────────────────────

const aiAssistRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  tenantId: z.string().optional(), // ignored — resolved from auth context
  category: z.string().max(100).optional(),
  targetFormat: z.string().max(50).optional(),
  canvasWidth: z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_WIDTH).optional().default(1200),
  canvasHeight: z.number().int().positive().max(DESIGN_LIMITS.MAX_CANVAS_HEIGHT).optional().default(628),
});

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/ai/design-templates/ai-assist", async (req, res) => {
  try {
    const ctx = resolveAuthenticatedTenantContext(req);

    const body = aiAssistRequestSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ error: "Validation failed", issues: body.error.issues });
    }

    const { prompt, category, targetFormat, canvasWidth, canvasHeight } = body.data;

    // ── Call OpenAI ───────────────────────────────────────────────────────────
    const openai = getOpenAIClient();
    const systemPrompt = buildSystemPrompt(canvasWidth, canvasHeight);
    const userMessage = [
      `Create a design template with these requirements:`,
      `Prompt: ${prompt}`,
      category ? `Category: ${category}` : null,
      targetFormat ? `Target format: ${targetFormat}` : null,
      `Canvas size: ${canvasWidth}x${canvasHeight}px`,
      `Tenant ID: ${ctx.tenantId}`,
      `Use ISO 8601 timestamps for createdAt/updatedAt.`,
    ]
      .filter(Boolean)
      .join("\n");

    const startMs = Date.now();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const latencyMs = Date.now() - startMs;
    const rawContent = completion.choices[0]?.message?.content ?? "";
    const usage = completion.usage;

    // ── Record cost ───────────────────────────────────────────────────────────
    await recordCost({
      projectId: `ai-assist-${ctx.tenantId}`,
      agentSlug: "design-template-ai-assist",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      latencyMs,
      status: "success",
    }).catch((costErr) => {
      logger.warn({ costErr }, "[ai-assist] Failed to record cost — continuing");
    });

    // ── Parse AI response ─────────────────────────────────────────────────────
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      logger.error({ rawContent: rawContent.slice(0, 500) }, "[ai-assist] AI returned non-JSON");
      return res.status(422).json({
        error: "AI returned non-JSON response",
        detail: "The AI model did not produce valid JSON. Please try again.",
      });
    }

    // Inject tenantId from auth context (never trust AI output for this)
    if (parsed && typeof parsed === "object") {
      (parsed as Record<string, unknown>)["tenantId"] = ctx.tenantId;
    }

    // ── Zod validation ────────────────────────────────────────────────────────
    const zodResult = designTemplateJsonSchema.safeParse(parsed);
    if (!zodResult.success) {
      logger.warn({ issues: zodResult.error.issues }, "[ai-assist] AI output failed Zod validation");
      return res.status(422).json({
        error: "AI-generated template failed schema validation",
        issues: zodResult.error.issues,
      });
    }

    const templateJson = zodResult.data as unknown as DesignTemplate;

    // ── Safety checks ─────────────────────────────────────────────────────────
    const safetyResult = applySafetyChecks(templateJson);
    if (!safetyResult.safe) {
      logger.warn({ reason: safetyResult.reason }, "[ai-assist] AI output failed safety checks");
      return res.status(422).json({
        error: "AI-generated template failed safety checks",
        detail: safetyResult.reason,
      });
    }

    // ── Save as draft template + version ──────────────────────────────────────
    const actorId = req.internalUser ? String((req as any).internalUser.id) : "ai-system";

    const draftTemplate = await createTemplate({
      tenantId: ctx.tenantId,
      name: templateJson.name,
      description: templateJson.description,
      category: templateJson.category ?? category,
      createdBy: actorId,
    });

    const draftVersion = await createVersion({
      templateId: draftTemplate.id,
      tenantId: ctx.tenantId,
      templateJson: {
        ...templateJson,
        id: String(draftTemplate.id),
        tenantId: ctx.tenantId,
      },
      changelog: `AI-generated from prompt: ${prompt.slice(0, 100)}`,
      createdBy: actorId,
    });

    return res.status(201).json({
      draftVersionId: draftVersion!.id,
      templateId: draftTemplate.id,
      templateJson: {
        ...templateJson,
        id: String(draftTemplate.id),
        tenantId: ctx.tenantId,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err }, "[ai-assist] Route error");
    return res.status(500).json({ error: msg });
  }
});

export default router;
