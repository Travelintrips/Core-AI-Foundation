/**
 * Agent 12 — JSON Architect AI
 *
 * Assembles the output of Teams 1 (Discovery), 2 (Design), and 3 (Components)
 * into a valid DesignTemplate using the canonical schema.
 *
 * Responsibilities:
 *   - Map componentPlan entries to DesignElements (positions, sizes, bindings)
 *   - Apply typography and color palette from DesignTeamOutput
 *   - Mount variable declarations from DiscoveryTeamOutput
 *   - If structural mapping is ambiguous, use AI (with retry) to fill gaps
 *   - NEVER make creative decisions; only structural assembly
 *
 * AI dependency injection: pass a custom modelProvider in options to stub in tests.
 */

import { randomUUID } from "crypto";
import { getProviderApiKey } from "../../../aiSecretService.js";
import { recordCost } from "../../../costService.js";
import { logger } from "../../../../lib/logger.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION, DESIGN_LIMITS } from "../../../../types/designTemplate.js";
import type { DesignTemplate, DesignElement, TemplateVariable } from "../../../../types/designTemplate.js";
import type {
  AgentOutput,
  AgentExecutionMetadata,
  EngineeringTeamInput,
  ModelProvider,
} from "../../types/engineering.types.js";

const AGENT_ID      = "json-architect-ai";
const AGENT_NAME    = "JSON Architect AI";
const AGENT_VERSION = "1.0.0";
const MAX_RETRIES   = 3;

// ── Size presets (mirrors templateAiService) ──────────────────────────────────
const SIZE_PRESETS: Record<string, { width: number; height: number }> = {
  "instagram-square":    { width: 1080, height: 1080 },
  "instagram-portrait":  { width: 1080, height: 1350 },
  "instagram-landscape": { width: 1080, height:  566 },
  "a4":                  { width: 2480, height: 3508 },
};

// ── Layout strategies → position helpers ──────────────────────────────────────
function computeElementPosition(
  purpose: string,
  index: number,
  total: number,
  canvasW: number,
  canvasH: number,
  suggestedPos?: { x: number; y: number },
  suggestedSize?: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (suggestedPos && suggestedSize) {
    return { ...suggestedPos, ...suggestedSize };
  }
  const margin = Math.round(canvasW * 0.05);
  const usableW = canvasW - margin * 2;

  const defaults: Record<string, { x: number; y: number; width: number; height: number }> = {
    background:  { x: 0, y: 0, width: canvasW, height: canvasH },
    heading:     { x: margin, y: Math.round(canvasH * 0.20), width: usableW, height: Math.round(canvasH * 0.12) },
    subheading:  { x: margin, y: Math.round(canvasH * 0.34), width: usableW, height: Math.round(canvasH * 0.08) },
    body:        { x: margin, y: Math.round(canvasH * 0.44), width: usableW, height: Math.round(canvasH * 0.20) },
    cta:         { x: margin, y: Math.round(canvasH * 0.68), width: Math.round(usableW * 0.45), height: Math.round(canvasH * 0.08) },
    image:       { x: margin, y: Math.round(canvasH * 0.08), width: usableW, height: Math.round(canvasH * 0.30) },
    logo:        { x: margin, y: Math.round(canvasH * 0.03), width: Math.round(usableW * 0.25), height: Math.round(canvasH * 0.08) },
    decoration:  { x: 0, y: Math.round(canvasH * 0.85), width: canvasW, height: Math.round(canvasH * 0.15) },
    divider:     { x: margin, y: Math.round(canvasH * 0.42), width: usableW, height: 2 },
    qrcode:      { x: Math.round(canvasW * 0.70), y: Math.round(canvasH * 0.70), width: Math.round(canvasW * 0.20), height: Math.round(canvasW * 0.20) },
  };

  // Generic fallback: stack elements vertically
  const fallback = defaults[purpose] ?? {
    x: margin,
    y: Math.round(canvasH * (0.1 + index * (0.8 / Math.max(total, 1)))),
    width: usableW,
    height: Math.round(canvasH * 0.08),
  };
  return fallback;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

/**
 * Compute relative luminance (0=black, 1=white) for a hex color.
 * Returns 0.5 for any unparseable value (neutral).
 */
function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const linearize = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** Return "#ffffff" or "#1a1a1a" whichever contrasts better against the given background. */
function autoContrastText(bgHex: string, altDark = "#1a1a1a"): string {
  return relativeLuminance(bgHex) > 0.35 ? altDark : "#ffffff";
}

// ── Deterministic assembly ────────────────────────────────────────────────────

function assembleTemplate(
  input: EngineeringTeamInput,
  templateId: string,
  tenantId: string,
  actorId: string,
): DesignTemplate {
  const { discovery, design, components } = input;

  // Canvas size
  const preset = discovery.recommendedSizePreset ? SIZE_PRESETS[discovery.recommendedSizePreset] : null;
  const canvasW = Math.min(discovery.canvasWidth ?? preset?.width  ?? 1080, DESIGN_LIMITS.MAX_CANVAS_WIDTH);
  const canvasH = Math.min(discovery.canvasHeight ?? preset?.height ?? 1080, DESIGN_LIMITS.MAX_CANVAS_HEIGHT);

  const now = new Date().toISOString();

  // Variables from discovery
  const variables: TemplateVariable[] = discovery.requiredVariables
    .slice(0, DESIGN_LIMITS.MAX_VARIABLE_COUNT)
    .map((v) => ({
      key: v.key,
      label: v.label,
      type: v.type as TemplateVariable["type"],
      required: v.required,
      defaultValue: v.defaultValue,
    }));

  const variableKeys = new Set(variables.map((v) => v.key));
  // Build a lookup of defaultValue per variable key so bindings can carry a fallback
  const variableDefaultMap = new Map<string, string>(
    variables
      .filter((v) => v.defaultValue !== undefined && v.defaultValue !== null)
      .map((v) => [v.key, String(v.defaultValue)]),
  );
  const total = components.componentPlan.length;

  // Elements from component plan
  const seenIds = new Set<string>();
  const elements: DesignElement[] = components.componentPlan
    .slice(0, DESIGN_LIMITS.MAX_ELEMENT_COUNT)
    .map((comp, idx): DesignElement => {
      // Deduplicate IDs
      let id = comp.id.replace(/[^a-zA-Z0-9_\-]/g, "-").slice(0, 64) || `el-${idx}`;
      if (seenIds.has(id)) id = `${id}-${idx}`;
      seenIds.add(id);

      const pos = computeElementPosition(
        comp.purpose, idx, total, canvasW, canvasH,
        comp.suggestedPosition, comp.suggestedSize,
      );
      const zIndex = comp.zIndexHint ?? idx;

      // Base element fields
      const base = { id, x: pos.x, y: pos.y, width: pos.width, height: pos.height, zIndex };

      // Map by type
      switch (comp.componentType) {
        case "text": {
          const hasBinding = comp.variableKey && variableKeys.has(comp.variableKey);
          const isHeading = comp.purpose === "heading" || comp.purpose === "cta";
          const typo = isHeading ? design.typography.heading : design.typography.body;
          // Resolve fallback: prefer explicit defaultValue, then suggestedContent, then purpose label
          const fallbackText = hasBinding
            ? (variableDefaultMap.get(comp.variableKey!) ?? comp.suggestedContent ?? comp.purpose)
            : undefined;
          return {
            ...base,
            type: "text",
            name: comp.purpose,
            content: hasBinding
              ? { binding: { variableKey: comp.variableKey!, fallback: fallbackText } }
              : (comp.suggestedContent ?? comp.purpose),
            fontFamily: typo.fontFamily,
            fontSize: typo.fontSize,
            fontWeight: typo.fontWeight,
            color: design.colorPalette.text,
            textAlign: isHeading ? "center" : "left",
          };
        }

        case "image":
          return {
            ...base,
            type: "image",
            name: comp.purpose,
            ...(comp.variableKey && variableKeys.has(comp.variableKey)
              ? { src: { binding: { variableKey: comp.variableKey, fallback: variableDefaultMap.get(comp.variableKey) } } }
              : {}),
            objectFit: "cover",
          };

        case "shape": {
          const deco = design.decorativeElements?.find(
            (d) => d.role === (comp.purpose === "background" ? "background" : "accent"),
          );
          return {
            ...base,
            type: "shape",
            name: comp.purpose,
            shape: deco?.shape ?? "rectangle",
            fill: deco?.color ?? design.colorPalette.background,
          };
        }

        case "qrcode":
          return {
            ...base,
            type: "qrcode",
            name: comp.purpose,
            content: comp.variableKey && variableKeys.has(comp.variableKey)
              ? { binding: { variableKey: comp.variableKey, fallback: variableDefaultMap.get(comp.variableKey) ?? comp.suggestedContent ?? "https://example.com" } }
              : (comp.suggestedContent ?? "https://example.com"),
            fgColor: design.colorPalette.primary,
            bgColor: "#FFFFFF",
          };

        case "line":
          return {
            ...base,
            type: "line",
            name: comp.purpose,
            stroke: design.colorPalette.secondary ?? design.colorPalette.primary,
            strokeWidth: 2,
          };

        default:
          // Unknown type — emit as shape placeholder
          return {
            ...base,
            type: "shape",
            name: comp.purpose ?? "unknown",
            shape: "rectangle",
            fill: design.colorPalette.secondary ?? "#CCCCCC",
          };
      }
    });

  // ── Post-process: fix text colors for contrast ─────────────────────────────
  //
  // Problem: ALL text gets colorPalette.text (e.g. #ffffff for dark themes).
  // But image placeholder elements render as a white rectangle — white text
  // on white image = invisible. Fix by computing proper contrast color based
  // on what each text element is visually sitting on:
  //   1. Text overlapping an image element → use autoContrast (dark on white image)
  //   2. Text NOT overlapping any image → use colorPalette.text (correct for bg)

  // Build image Y-ranges for overlap detection
  const imageRanges = elements
    .filter((e) => e.type === "image")
    .map((e) => ({ y: e.y, bottom: e.y + e.height }));

  // The effective background behind non-image text is the canvas background
  const bgLum = relativeLuminance(design.colorPalette.background);
  const bgTextColor = bgLum > 0.35
    ? autoContrastText(design.colorPalette.background, design.colorPalette.primary ?? "#1a1a1a")
    : design.colorPalette.text; // dark bg → white text (already correct)

  const finalElements = elements.map((el) => {
    if (el.type !== "text") return el;
    const textEl = el as { y: number; height: number; color?: string; [k: string]: unknown };
    const elBottom = textEl.y + textEl.height;

    // Check overlap with any image placeholder
    const onImage = imageRanges.some(
      (r) => textEl.y < r.bottom && elBottom > r.y,
    );

    if (onImage) {
      // Image placeholder renders as white — use dark contrasting color
      return { ...el, color: autoContrastText("#ffffff", design.colorPalette.primary ?? "#1a1a1a") };
    }

    // Not on image — ensure the text color actually contrasts with the background
    return { ...el, color: bgTextColor };
  });

  return {
    schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
    id: templateId,
    tenantId,
    name: design.templateName,
    description: design.description,
    category: design.category,
    canvas: {
      width: canvasW,
      height: canvasH,
      unit: "px",
      backgroundColor: design.colorPalette.background,
    },
    elements: finalElements,
    variables,
    metadata: {
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  };
}

// ── AI-assisted repair (for badly underspecified inputs) ──────────────────────

async function buildDefaultProvider(): Promise<ModelProvider | null> {
  const apiKey = getProviderApiKey("openai");
  if (!apiKey) return null;

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });

  return {
    async chat({ model, systemPrompt, userPrompt, maxTokens = 2048 }) {
      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        temperature: 0.3, // low temperature — structural, not creative
        max_tokens: maxTokens,
      });
      return {
        content:      completion.choices[0]?.message?.content ?? "",
        inputTokens:  completion.usage?.prompt_tokens  ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      };
    },
  };
}

// ── Main agent entry point ────────────────────────────────────────────────────

export interface JsonArchitectAgentOptions {
  tenantId: string;
  actorId: string;
  templateId?: string;
  /** Inject a custom model provider (use in tests to avoid live API calls) */
  modelProvider?: ModelProvider;
}

export async function runJsonArchitectAgent(
  input: EngineeringTeamInput,
  opts: JsonArchitectAgentOptions,
): Promise<AgentOutput<DesignTemplate>> {
  const startedAt = new Date().toISOString();
  const startMs   = Date.now();
  const templateId = opts.templateId ?? `tmpl-${randomUUID()}`;
  const warnings: string[] = [];
  const errors: string[]   = [];
  let retryCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const meta = (): AgentExecutionMetadata => ({
    agentId:      AGENT_ID,
    agentName:    AGENT_NAME,
    agentVersion: AGENT_VERSION,
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs:   Date.now() - startMs,
    retryCount,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  });

  // ── Step 1: Deterministic assembly ────────────────────────────────────────
  let template: DesignTemplate;
  try {
    template = assembleTemplate(input, templateId, opts.tenantId, opts.actorId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, `[${AGENT_ID}] Deterministic assembly failed`);
    return { status: "failed", data: null, warnings, errors: [msg], metadata: meta() };
  }

  // ── Step 2: Check if AI repair is needed (component plan was too sparse) ──
  const needsAiRepair = input.components.componentPlan.length === 0;
  if (!needsAiRepair) {
    logger.info({ templateId, elements: template.elements.length }, `[${AGENT_ID}] Assembly complete`);
    return { status: "success", data: template, warnings, errors, metadata: meta() };
  }

  // ── Step 3: AI-assisted generation for empty component plans ──────────────
  warnings.push("Component plan was empty — using AI to generate structural layout.");

  const provider = opts.modelProvider ?? await buildDefaultProvider();
  if (!provider) {
    errors.push("No AI provider configured (OpenAI key missing) and component plan is empty. Cannot generate template.");
    return { status: "failed", data: null, warnings, errors, metadata: meta() };
  }

  const systemPrompt = `You are a structural JSON assembler. Convert a design brief into a DesignTemplate JSON.
Output ONLY valid JSON matching this exact structure:
{
  "elements": [...],
  "variables": [...]
}
Use only types: text, image, shape, qrcode, line.
All IDs must be unique alphanumeric strings.
All colors must be hex (#RRGGBB).
Do NOT add creative content — use placeholder text matching the purpose.`;

  const userPrompt = `Brief: ${input.discovery.briefSummary}
Canvas: ${template.canvas.width}x${template.canvas.height}px
Goals: ${input.discovery.communicationGoals.join(", ")}
Required variables: ${input.discovery.requiredVariables.map((v) => v.key).join(", ")}
Background color: ${input.design.colorPalette.background}
Primary color: ${input.design.colorPalette.primary}
Text color: ${input.design.colorPalette.text}
Heading font: ${input.design.typography.heading.fontFamily} ${input.design.typography.heading.fontSize}px
Layout: ${input.design.layoutStrategy}
Generate elements and variables arrays only.`;

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) retryCount++;
    try {
      const response = await provider.chat({
        model: "gpt-4o",
        systemPrompt,
        userPrompt: attempt === 0 ? userPrompt : `${userPrompt}\n\nPrevious attempt failed: ${String(lastError)}. Fix and return valid JSON.`,
        maxTokens: 2048,
      });

      inputTokens  += response.inputTokens;
      outputTokens += response.outputTokens;

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.content);
      } catch {
        lastError = "AI response was not valid JSON";
        continue;
      }

      const p = parsed as any;
      if (Array.isArray(p.elements)) {
        template = { ...template, elements: p.elements, variables: p.variables ?? template.variables };
        break;
      }
      lastError = "AI response missing 'elements' array";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ attempt, err }, `[${AGENT_ID}] AI call failed`);
    }
  }

  if (lastError && template.elements.length === 0) {
    errors.push(`AI repair failed after ${MAX_RETRIES} attempts: ${String(lastError)}`);
    try {
      await recordCost({ projectId: `tenant-${opts.tenantId}`, agentSlug: AGENT_ID, provider: "openai", model: "gpt-4o", inputTokens, outputTokens, status: "error" });
    } catch { /* non-fatal */ }
    return { status: "failed", data: null, warnings, errors, metadata: meta() };
  }

  try {
    await recordCost({ projectId: `tenant-${opts.tenantId}`, agentSlug: AGENT_ID, provider: "openai", model: "gpt-4o", inputTokens, outputTokens, status: "success" });
  } catch { /* non-fatal */ }

  return { status: "success", data: template, warnings, errors, metadata: meta() };
}
