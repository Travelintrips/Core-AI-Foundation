/**
 * Agent 7 — Color Designer AI
 *
 * Responsibility: color tokens, gradients, shadows, contrast checks.
 * Respects BrandStrategy and verifies WCAG 2.1 contrast.
 *
 * Output: ColorSpec
 */

import { executeAI as defaultExecuteAI } from "../../../aiExecutionService.js";
import type { ExecuteAIFn } from "../../utils/agentRunner.js";
import { runAgent } from "../../utils/agentRunner.js";
import type {
  AgentOutput,
  ColorSpec,
  LayoutSpec,
  ModelConfig,
  TypographySpec,
} from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import { colorSpecSchema } from "../../schemas/design/color.schema.js";
import { buildColorDesignerPrompt } from "../../prompts/design/color-designer.prompt.js";

const AGENT_ID      = "design-ai-color-designer-v1";
const AGENT_NAME    = "Color Designer AI";
const AGENT_VERSION = "1.0.0";

// ─── WCAG 2.1 contrast utilities ─────────────────────────────────────────────

function hexToLinear(channel: number): number {
  const sRGB = channel / 255;
  return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
}

/** Compute relative luminance for a 6-digit hex color (#RRGGBB). */
export function relativeLuminance(hex: string): number {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * hexToLinear(r) + 0.7152 * hexToLinear(g) + 0.0722 * hexToLinear(b);
}

/** Compute WCAG 2.1 contrast ratio between two hex colors. */
export function wcagContrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export async function runColorDesigner(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
  typography: TypographySpec,
  modelConfig: ModelConfig,
  deps?: { executeAI?: ExecuteAIFn },
): Promise<AgentOutput<ColorSpec>> {
  const executeAI = deps?.executeAI ?? defaultExecuteAI;

  // Include layout & typography in context but the prompt is brand-focused
  void layout;
  void typography;

  const result = await runAgent<ColorSpec>({
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    systemPrompt:
      "You are Color Designer AI. Respond with ONLY valid JSON matching the ColorSpec schema — no markdown fences, no explanation. Write all descriptive text values in Bahasa Indonesia.",
    userPrompt: buildColorDesignerPrompt(input),
    schema: colorSpecSchema,
    modelConfig,
    executeAI,
  });

  // Post-processing: warn on failed contrast checks
  if (result.status === "success" && result.data) {
    for (const check of result.data.contrastChecks) {
      if (!check.passed) {
        result.warnings.push(
          `Contrast check failed: ${check.foreground} on ${check.background} = ${check.ratio}:1 ` +
            `(WCAG AA normal text requires 4.5:1).`,
        );
      }
    }
  }

  return result;
}
