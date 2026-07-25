/**
 * Agent 6 — Typography Designer AI
 *
 * Responsibility: font pairing, size scale, line height, letter spacing,
 * weight, hierarchy, readability — using only fonts in the platform registry.
 *
 * Output: TypographySpec
 */

import { executeAI as defaultExecuteAI } from "../../../aiExecutionService.js";
import type { ExecuteAIFn } from "../../utils/agentRunner.js";
import { runAgent } from "../../utils/agentRunner.js";
import type {
  AgentOutput,
  LayoutSpec,
  ModelConfig,
  TypographySpec,
} from "../../types/design.types.js";
import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import { typographySpecSchema } from "../../schemas/design/typography.schema.js";
import { buildTypographyDesignerPrompt } from "../../prompts/design/typography-designer.prompt.js";
import { resolveFont, PLATFORM_FALLBACK } from "../../../design-renderer/fontRegistry.js";

const AGENT_ID      = "design-ai-typography-designer-v1";
const AGENT_NAME    = "Typography Designer AI";
const AGENT_VERSION = "1.0.0";

/**
 * Validate a font family against the platform registry.
 * Returns a warning string if the font is unregistered, or null if it passes.
 */
function checkFont(font: string, context: string): string | null {
  const resolved = resolveFont(font);
  if (resolved.isFallback) {
    return `${context}: "${font}" is not in the platform registry — will fall back to "${PLATFORM_FALLBACK}".`;
  }
  return null;
}

export async function runTypographyDesigner(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
  modelConfig: ModelConfig,
  deps?: { executeAI?: ExecuteAIFn },
): Promise<AgentOutput<TypographySpec>> {
  const executeAI = deps?.executeAI ?? defaultExecuteAI;

  const result = await runAgent<TypographySpec>({
    agentId: AGENT_ID,
    agentName: AGENT_NAME,
    agentVersion: AGENT_VERSION,
    systemPrompt:
      "You are Typography Designer AI. Respond with ONLY valid JSON matching the TypographySpec schema — no markdown fences, no explanation. Write all descriptive text values (readabilityRules) in Bahasa Indonesia.",
    userPrompt: buildTypographyDesignerPrompt(input, layout),
    schema: typographySpecSchema,
    modelConfig,
    executeAI,
  });

  // Post-processing: validate all fonts against the platform registry
  if (result.status === "success" && result.data) {
    const warnings: string[] = [];

    // Check fontPairing
    const pairing = result.data.fontPairing;
    const pairingChecks: [string, string][] = [
      [pairing.headingFont, "fontPairing.headingFont"],
      [pairing.bodyFont, "fontPairing.bodyFont"],
    ];
    if (pairing.accentFont) {
      pairingChecks.push([pairing.accentFont, "fontPairing.accentFont"]);
    }
    for (const [font, ctx] of pairingChecks) {
      const warn = checkFont(font, ctx);
      if (warn) warnings.push(warn);
    }

    // Check each style's fontFamily
    for (const [styleName, style] of Object.entries(result.data.styles)) {
      if (style) {
        const warn = checkFont(style.fontFamily, `styles.${styleName}.fontFamily`);
        if (warn) warnings.push(warn);
      }
    }

    result.warnings.push(...warnings);
  }

  return result;
}
