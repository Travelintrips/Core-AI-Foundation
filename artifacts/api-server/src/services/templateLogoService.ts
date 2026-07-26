/**
 * templateLogoService.ts — Template-First Logo Rendering
 *
 * Strategi hemat biaya: sebelum generate logo via FLUX ($0.003–0.025/gambar),
 * coba render dari BuiltinTemplate terlebih dahulu.
 *
 * Flow:
 *   1. Cari template logo terbaik berdasarkan industri/style
 *   2. GPT-4o Mini mengisi slot teks (nama brand, tagline)   → ~$0.0005
 *   3. SVG renderer merender template → upload ke Supabase
 *
 * Total cost: ~$0.0005–0.002 per logo (vs $0.003–0.025 via FLUX)
 *
 * Fallback graceful: jika gagal, return null → pemanggil fallback ke FLUX.
 */

import {
  listBuiltinTemplates,
  type BuiltinTemplate,
  type BuiltinCanvasElement,
} from "../data/design-templates.js";
import { executeAI } from "./aiExecutionService.js";
import { recordCost } from "./costService.js";
import { logAudit } from "./aiAuditService.js";
import { renderTemplate } from "./design-renderer/templateRenderer.js";
import type {
  DesignTemplate,
  DesignElement,
  TextElement,
  ShapeElement,
  LineElement,
  ImageElement,
  DesignCanvas,
} from "../types/designTemplate.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";
import { getProviderApiKey } from "./aiSecretService.js";
import { logger } from "../lib/logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TemplateLogoResult {
  outputUrl: string;
  templateCode: string;
  templateName: string;
  costUsd: number;
  renderDurationMs: number;
  tokensUsed: number;
}

// ── Template Selection ────────────────────────────────────────────────────────

/**
 * Skor template berdasarkan kecocokan dengan brief — semakin tinggi semakin baik.
 */
function scoreTemplate(tpl: BuiltinTemplate, brief: Record<string, unknown>): number {
  let score = 0;
  const industry = String(brief.businessType ?? brief.industry ?? "").toLowerCase();
  const style = String(brief.stylePreference ?? "").toLowerCase();

  if (tpl.industry) {
    const tplInd = tpl.industry.toLowerCase();
    if (industry && tplInd.includes(industry)) score += 10;
    else if (industry && industry.includes(tplInd)) score += 8;
  } else {
    score += 2; // null industry = lintas industri, small base score
  }

  if (style && tpl.style.toLowerCase().includes(style)) score += 5;

  const briefText = `${industry} ${style}`;
  for (const tag of tpl.tags) {
    if (briefText.includes(tag)) score += 1;
  }

  return score;
}

function findBestLogoTemplate(brief: Record<string, unknown>): BuiltinTemplate | null {
  const logos = listBuiltinTemplates({ category: "Logo" });
  if (!logos.length) return null;

  const scored = logos
    .map((t) => ({ t, score: scoreTemplate(t, brief) }))
    .sort((a, b) => b.score - a.score);

  return scored[0].t;
}

// ── AI Slot Filler ────────────────────────────────────────────────────────────

/**
 * GPT-4o Mini mengisi slot teks (elemen yang tidak di-lock) di template.
 * Hanya elemen type "text" dengan locked=false yang diisi.
 */
async function fillTextSlots(
  template: BuiltinTemplate,
  brief: Record<string, unknown>,
): Promise<{ slots: Record<string, string>; tokensUsed: number; costUsd: number }> {
  const editable = template.canvasState.elements.filter(
    (el) => !el.locked && el.type === "text",
  );

  if (!editable.length) return { slots: {}, tokensUsed: 0, costUsd: 0 };

  const slotList = editable.map((el) => ({
    id: el.id,
    name: el.name,
    currentText: el.text ?? "",
    fontSize: el.fontSize,
  }));

  const systemPrompt = `You are a brand copywriter. Fill logo template text slots for a company.
Return ONLY a valid JSON object mapping element IDs to replacement text.
Rules:
- Keep text SHORT — it must fit inside the element visually
- Brand/company name: use the actual brand name, 1–4 words max
- Tagline: punchy, brand-appropriate, 4–8 words max  
- Do NOT add quotes, ellipsis, or extra punctuation
- Match the industry tone
- Write all text values (tagline, supporting text) in Bahasa Indonesia yang singkat dan profesional`;

  const userPrompt = `Company brief:
- Brand Name: ${String(brief.brandName ?? "Brand")}
- Industry: ${String(brief.businessType ?? brief.industry ?? "general")}
- Target Market: ${String(brief.targetMarket ?? "")}
- Goal: ${String(brief.goal ?? "")}
- Style: ${String(brief.stylePreference ?? "")}

Slots to fill:
${JSON.stringify(slotList, null, 2)}

Respond with JSON only: { "elementId": "replacement text", ... }`;

  const result = await executeAI({
    prompt: userPrompt,
    systemPrompt,
    model: { modelId: "gpt-4o-mini", maxOutputTokens: 300 },
    provider: { slug: "openai" },
    temperature: 0.4,
  });

  const costUsd =
    result.promptTokens * 0.00000015 + result.completionTokens * 0.0000006;

  let slots: Record<string, string> = {};
  try {
    const match = result.content.match(/\{[\s\S]*\}/);
    if (match) slots = JSON.parse(match[0]) as Record<string, string>;
  } catch {
    logger.warn("templateLogoService: could not parse AI slot response, using template defaults");
  }

  return { slots, tokensUsed: result.tokensUsed, costUsd };
}

// ── BuiltinTemplate → DesignTemplate Converter ───────────────────────────────

function convertElement(
  el: BuiltinCanvasElement,
  overrideText?: string,
): DesignElement {
  const base = {
    id: el.id,
    name: el.name,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    opacity: el.opacity,
    visible: el.visible,
    locked: el.locked,
    zIndex: el.zIndex,
  };

  switch (el.type) {
    case "text": {
      const fontWeight = el.fontWeight;
      let resolvedWeight: TextElement["fontWeight"] = "normal";
      if (fontWeight === "bold" || fontWeight === "normal") {
        resolvedWeight = fontWeight;
      } else if (fontWeight !== undefined) {
        const n = parseInt(String(fontWeight), 10);
        if (!isNaN(n)) resolvedWeight = n as TextElement["fontWeight"];
      }

      const textEl: TextElement = {
        ...base,
        type: "text",
        content: overrideText ?? el.text ?? "",
        fontFamily: el.fontFamily ?? "Inter",
        fontSize: el.fontSize ?? 16,
        fontWeight: resolvedWeight,
        color: el.color ?? "#000000",
        textAlign: (el.textAlign as TextElement["textAlign"]) ?? "left",
      };
      return textEl;
    }

    case "circle": {
      const shapeEl: ShapeElement = {
        ...base,
        type: "shape",
        shape: "circle",
        fill: el.fill ?? "#000000",
      };
      return shapeEl;
    }

    case "line": {
      const lineEl: LineElement = {
        ...base,
        type: "line",
        stroke: el.stroke ?? el.fill ?? "#000000",
        strokeWidth: el.strokeWidth ?? 1,
      };
      return lineEl;
    }

    case "image": {
      const imgEl: ImageElement = {
        ...base,
        type: "image",
        objectFit: (el.objectFit as ImageElement["objectFit"]) ?? "cover",
        ...(el.src ? { src: { type: "url" as const, url: el.src } } : {}),
      };
      return imgEl;
    }

    // rect, frame, and unknown types → shape
    default: {
      const hasRadius = (el.borderRadius ?? 0) > 0;
      const shapeEl: ShapeElement = {
        ...base,
        type: "shape",
        shape: hasRadius ? "rounded-rectangle" : "rectangle",
        fill: el.fill ?? "transparent",
        borderRadius: el.borderRadius,
        ...(el.stroke
          ? { border: { width: el.strokeWidth ?? 1, color: el.stroke } }
          : {}),
      };
      return shapeEl;
    }
  }
}

function builtinToDesignTemplate(
  builtin: BuiltinTemplate,
  slots: Record<string, string>,
  tenantId: string,
): DesignTemplate {
  const canvas: DesignCanvas = {
    width: builtin.canvasWidth,
    height: builtin.canvasHeight,
    unit: "px",
    backgroundColor: builtin.canvasState.background,
  };

  const elements: DesignElement[] = builtin.canvasState.elements.map((el) =>
    convertElement(
      el,
      el.type === "text" && !el.locked ? (slots[el.id] ?? undefined) : undefined,
    ),
  );

  const now = new Date().toISOString();
  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: `builtin-${builtin.templateCode}`,
    tenantId,
    name: builtin.name,
    description: builtin.description,
    category: builtin.category,
    canvas,
    elements,
    variables: [], // semua konten sudah static (diisi AI)
    metadata: {
      createdBy: "system",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Coba render logo dari template bawaan.
 * Return null jika tidak ada template cocok atau render gagal (fallback ke FLUX).
 */
export async function tryTemplateLogoRender(
  brief: Record<string, unknown>,
  projectUuid: string,
  tenantId = "default",
): Promise<TemplateLogoResult | null> {
  // Butuh OpenAI untuk slot filling
  if (!getProviderApiKey("openai")) return null;

  try {
    const template = findBestLogoTemplate(brief);
    if (!template) {
      logger.info(
        { projectUuid },
        "templateLogoService: tidak ada template logo tersedia, lanjut ke FLUX",
      );
      return null;
    }

    logger.info(
      { projectUuid, templateCode: template.templateCode },
      "templateLogoService: template ditemukan, mulai render",
    );

    // Step 1: AI isi slot teks
    const { slots, tokensUsed, costUsd } = await fillTextSlots(template, brief);

    // Step 2: Konversi ke DesignTemplate
    const designTemplate = builtinToDesignTemplate(template, slots, tenantId);

    // Step 3: Render SVG → PNG → upload Supabase
    const renderStart = Date.now();
    const rendered = await renderTemplate({
      template: designTemplate,
      templateVersionId: 0, // builtin = tidak ada DB version
      data: {},             // semua konten sudah di-embed dalam elemen
      format: "png",
      tenantId,
      batchId: `logo-${projectUuid}`,
      renderItemId: `tpl-${template.templateCode}`,
    });
    const renderDurationMs = Date.now() - renderStart;

    // Catat biaya
    await recordCost({
      projectId: projectUuid,
      agentSlug: "template-slot-filler",
      provider: "openai",
      model: "gpt-4o-mini",
      inputTokens: Math.floor(tokensUsed * 0.6),
      outputTokens: Math.floor(tokensUsed * 0.4),
      latencyMs: renderDurationMs,
      status: "success",
    });

    await logAudit(
      "creative-ai",
      "template_logo_rendered",
      projectUuid,
      "creative_project",
      "success",
      { templateCode: template.templateCode, costUsd, renderDurationMs },
    );

    logger.info(
      { projectUuid, templateCode: template.templateCode, costUsd, renderDurationMs },
      "templateLogoService: berhasil render logo dari template",
    );

    return {
      outputUrl: rendered.outputUrl,
      templateCode: template.templateCode,
      templateName: template.name,
      costUsd,
      renderDurationMs,
      tokensUsed,
    };
  } catch (err) {
    logger.warn(
      { projectUuid, err: String(err) },
      "templateLogoService: render gagal, fallback ke FLUX",
    );
    return null; // fallback graceful
  }
}
