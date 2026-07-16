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

// ── AI output repair — fix common GPT mistakes before Zod validation ──────────

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff",
  green: "#008000", yellow: "#ffff00", orange: "#ffa500", purple: "#800080",
  pink: "#ffc0cb", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  gold: "#ffd700", navy: "#000080", teal: "#008080", cyan: "#00ffff",
  magenta: "#ff00ff", lime: "#00ff00", brown: "#a52a2a", beige: "#f5f5dc",
  ivory: "#fffff0", cream: "#fffdd0", transparent: "#00000000", none: "#00000000",
};

function repairColor(val: unknown): unknown {
  if (typeof val !== "string") return val;
  const lower = val.trim().toLowerCase();
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  // already valid hex or rgb — return as-is
  return val;
}

function repairFontFamily(val: unknown): unknown {
  if (typeof val !== "string") return val;
  // Strip fallbacks: "Open Sans, sans-serif" → "Open Sans"
  const primary = val.split(",")[0].trim();
  // Strip quotes if wrapped
  return primary.replace(/^['"]|['"]$/g, "");
}

function repairVariableKey(val: unknown): unknown {
  if (typeof val !== "string") return val;
  // Replace hyphens with underscores, strip other invalid chars
  return val.replace(/-/g, "_").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
}

function coerceToNumber(val: unknown): number | unknown {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // "10px" → 10, "1.5em" → 1.5, "50%" → 50
    const n = parseFloat(val);
    if (!isNaN(n)) return n;
  }
  return val;
}

function repairElement(el: Record<string, unknown>): Record<string, unknown> {
  const colorFields = ["color", "stroke", "fgColor", "bgColor"];
  for (const f of colorFields) {
    if (f in el) el[f] = repairColor(el[f]);
  }
  if ("fontFamily" in el) el["fontFamily"] = repairFontFamily(el["fontFamily"]);
  // fontWeight: coerce string numbers to number
  if (typeof el["fontWeight"] === "string" && /^\d+$/.test(el["fontWeight"] as string)) {
    el["fontWeight"] = parseInt(el["fontWeight"] as string, 10);
  }
  // Numeric fields that AI commonly returns as strings ("10px", "50%", etc.)
  for (const f of ["borderRadius", "fontSize", "lineHeight", "letterSpacing", "strokeWidth", "opacity", "rotation"]) {
    if (f in el) el[f] = coerceToNumber(el[f]);
  }
  // fill: repair if it's a string color
  if (typeof el["fill"] === "string") el["fill"] = repairColor(el["fill"]);
  // border color
  if (el["border"] && typeof el["border"] === "object") {
    const b = el["border"] as Record<string, unknown>;
    if ("color" in b) b["color"] = repairColor(b["color"]);
  }
  // shadow color
  if (el["shadow"] && typeof el["shadow"] === "object") {
    const s = el["shadow"] as Record<string, unknown>;
    if ("color" in s) s["color"] = repairColor(s["color"]);
  }
  // content: repair variable binding key
  if (el["content"] && typeof el["content"] === "object") {
    const c = el["content"] as Record<string, unknown>;
    if (c["binding"] && typeof c["binding"] === "object") {
      const b = c["binding"] as Record<string, unknown>;
      if ("variableKey" in b) b["variableKey"] = repairVariableKey(b["variableKey"]);
    }
  }
  // zIndex: must be a non-negative integer
  if (typeof el["zIndex"] !== "number") el["zIndex"] = 0;
  else el["zIndex"] = Math.max(0, Math.min(10000, Math.round(el["zIndex"] as number)));
  // Recurse into group children
  if (Array.isArray(el["children"])) {
    el["children"] = (el["children"] as unknown[]).map((c) =>
      c && typeof c === "object" ? repairElement(c as Record<string, unknown>) : c
    );
  }
  return el;
}

function repairAiOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;

  // Canvas backgroundColor
  if (obj["canvas"] && typeof obj["canvas"] === "object") {
    const canvas = obj["canvas"] as Record<string, unknown>;
    if ("backgroundColor" in canvas) canvas["backgroundColor"] = repairColor(canvas["backgroundColor"]);
    // Ensure unit is "px"
    canvas["unit"] = "px";
  }

  // Elements
  if (Array.isArray(obj["elements"])) {
    obj["elements"] = (obj["elements"] as unknown[]).map((el) =>
      el && typeof el === "object" ? repairElement(el as Record<string, unknown>) : el
    );
  }

  // Variables: repair keys
  if (Array.isArray(obj["variables"])) {
    obj["variables"] = (obj["variables"] as unknown[]).map((v) => {
      if (!v || typeof v !== "object") return v;
      const varObj = { ...(v as Record<string, unknown>) };
      if ("key" in varObj) varObj["key"] = repairVariableKey(varObj["key"]);
      return varObj;
    });
  }

  // Metadata defaults
  if (!obj["metadata"] || typeof obj["metadata"] !== "object") {
    obj["metadata"] = {};
  }
  const meta = obj["metadata"] as Record<string, unknown>;
  if (!meta["createdBy"]) meta["createdBy"] = "ai-assist";
  if (!meta["createdAt"]) meta["createdAt"] = new Date().toISOString();
  if (!meta["updatedAt"]) meta["updatedAt"] = new Date().toISOString();
  if (typeof meta["version"] !== "number") meta["version"] = 1;

  return obj;
}

// ── AI system prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(canvasWidth: number, canvasHeight: number): string {
  return `You are a design template generator. Generate a valid DesignTemplate JSON object.

RETURN ONLY RAW JSON — no markdown fences, no \`\`\`json, no explanations, no comments.

══ STRICT FIELD RULES (validation will REJECT violations) ══

COLOR fields (backgroundColor, color, fill, stroke, fgColor, bgColor, border.color, shadow.color):
  ✅ ONLY these formats: "#RGB", "#RRGGBB", "#RRGGBBAA", "rgb(r,g,b)", "rgba(r,g,b,a)"
  ❌ NEVER: "white", "black", "blue", "transparent", "none", CSS named colors
  Examples: "#ffffff" not "white", "#000000" not "black", "#0000ff" not "blue"

FONT FAMILY (fontFamily):
  ✅ Single font name only, letters/digits/spaces/underscores/hyphens: "Open Sans", "Roboto", "Arial"
  ❌ NEVER include fallbacks or commas: "Open Sans, sans-serif" → INVALID
  Safe choices: "Roboto", "Open Sans", "Montserrat", "Lato", "Playfair Display", "Arial", "Georgia"

VARIABLE KEYS (variables[].key AND variableBinding.variableKey):
  ✅ Letters, digits, underscores only. Must start with letter or underscore.
  ❌ NEVER use hyphens in keys: "company_name" ✅ vs "company-name" ❌
  ❌ NEVER use spaces: "company name" ❌

FONT WEIGHT (fontWeight): number 100–900 OR string "bold" or "normal" only.
  ✅ 400, 700, "bold", "normal"  ❌ "semibold", "600px", "medium"

ELEMENT IDs: alphanumeric + underscore + hyphen, no spaces, no dots, no slashes. Must be unique.

ICON NAMES (iconName): alphanumeric + underscore + hyphen only.

══ REQUIRED JSON STRUCTURE ══

{
  "schemaVersion": "${DESIGN_TEMPLATE_SCHEMA_VERSION}",
  "id": "tpl-001",
  "tenantId": "TENANT_PLACEHOLDER",
  "name": "<descriptive name>",
  "description": "<optional description>",
  "category": "<category>",
  "canvas": {
    "width": ${canvasWidth},
    "height": ${canvasHeight},
    "unit": "px",
    "backgroundColor": "#ffffff"
  },
  "elements": [
    {
      "id": "bg-rect",
      "type": "shape",
      "shape": "rectangle",
      "x": 0, "y": 0,
      "width": ${canvasWidth}, "height": ${canvasHeight},
      "zIndex": 0,
      "fill": "#1a1a2e"
    },
    {
      "id": "title-text",
      "type": "text",
      "x": 60, "y": 80,
      "width": ${Math.round(canvasWidth * 0.8)}, "height": 80,
      "zIndex": 1,
      "content": { "binding": { "variableKey": "company_name" } },
      "fontSize": 48,
      "fontFamily": "Montserrat",
      "fontWeight": 700,
      "color": "#ffffff",
      "textAlign": "center"
    }
  ],
  "variables": [
    {
      "key": "company_name",
      "label": "Company Name",
      "type": "text",
      "required": true,
      "defaultValue": "Your Company"
    }
  ],
  "metadata": {
    "createdBy": "ai-assist",
    "createdAt": "${new Date().toISOString()}",
    "updatedAt": "${new Date().toISOString()}",
    "version": 1
  }
}

══ ELEMENT TYPES ══
- "text": content (string or binding), fontFamily, fontSize, fontWeight, color, textAlign, lineHeight
- "shape": shape ("rectangle"|"circle"|"rounded-rectangle"), fill (color or gradient), border, shadow
- "image": src (omit for placeholder — AI cannot supply real images), objectFit, borderRadius
- "line": stroke (color), strokeWidth
- "icon": iconName (alphanumeric_hyphen only), color
- "group": children (array of elements)

Canvas: ${canvasWidth}×${canvasHeight}px. Max ${DESIGN_LIMITS.MAX_ELEMENT_COUNT} elements, ${DESIGN_LIMITS.MAX_VARIABLE_COUNT} variables.
All coordinates must be within canvas bounds. zIndex is a non-negative integer.`;
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

    // ── Repair common AI mistakes before validation ────────────────────────────
    parsed = repairAiOutput(parsed);

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

    const finalTemplateJson = {
      ...templateJson,
      id: String(draftTemplate.id),
      tenantId: ctx.tenantId,
    };

    const draftVersion = await createVersion({
      templateId: draftTemplate.id,
      tenantId: ctx.tenantId,
      templateJson: finalTemplateJson,
      changelog: `AI-generated from prompt: ${prompt.slice(0, 100)}`,
      createdBy: actorId,
    });

    // Build response shape that satisfies BOTH frontend pages:
    //   - design-template-ai-assist.tsx  → draftVersionId, templateId, templateJson
    //   - design-template-ai-create.tsx  → proposal{template,summary,...}, templateId, versionId, draftSaved, aiMeta
    return res.status(201).json({
      // ── legacy shape (design-template-ai-assist.tsx) ──
      draftVersionId: draftVersion!.id,
      templateId: draftTemplate.id,
      templateJson: finalTemplateJson,
      // ── Phase-7 shape (design-template-ai-create.tsx) ──
      versionId: draftVersion!.id,
      draftSaved: true,
      proposal: {
        template: finalTemplateJson,
        summary: `${finalTemplateJson.name} — ${(finalTemplateJson.elements as unknown[]).length} elements, ${(finalTemplateJson.variables as unknown[]).length} variables`,
        assumptions: [
          `Canvas size: ${finalTemplateJson.canvas.width}×${finalTemplateJson.canvas.height}px`,
          `Category: ${finalTemplateJson.category ?? "general"}`,
        ],
        variables: (finalTemplateJson.variables as Array<{ key: string; label: string; type: string; required?: boolean }>),
        warnings: [],
      },
      aiMeta: {
        model: "gpt-4o",
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        latencyMs,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err }, "[ai-assist] Route error");
    return res.status(500).json({ error: msg });
  }
});

export default router;
