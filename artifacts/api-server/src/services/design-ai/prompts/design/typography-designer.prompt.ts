import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import type { LayoutSpec } from "../../types/design.types.js";

/** Platform-safe fonts — must stay in sync with design-renderer/fontRegistry.ts */
const REGISTRY_FONTS = [
  "Arial", "Helvetica", "sans-serif", "serif", "monospace",
  "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono",
  "Liberation Sans", "Liberation Serif", "Liberation Mono",
  "Noto Sans", "Noto Serif", "Ubuntu", "Cantarell",
  "FreeSans", "FreeSerif", "FreeMono",
];

export function buildTypographyDesignerPrompt(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
): string {
  const { brandStrategy } = input;
  const preferredFonts = brandStrategy.preferredFonts ?? [];

  return `You are Typography Designer AI. Select fonts exclusively from the registry and produce a complete TypographySpec.

PROJECT: ${input.creativeBrief.projectName}
STYLE DIRECTION: ${brandStrategy.styleDirection}
MOOD: ${brandStrategy.mood}
BRAND PERSONALITY: ${brandStrategy.brandPersonality.join(", ")}
CANVAS: ${layout.canvas.width}×${layout.canvas.height}px
${preferredFonts.length > 0 ? `PREFERRED FONTS (brand hint): ${preferredFonts.join(", ")}` : ""}

AVAILABLE FONTS (use ONLY these):
${REGISTRY_FONTS.join(", ")}

RULES:
- All fontFamily values MUST be from the list above. Do NOT invent or guess fonts.
- fontWeight must be a number (e.g. 400, 700) or CSS keyword ("bold", "normal").
- lineHeight must be a unitless multiplier (e.g. 1.5).
- letterSpacing is in em (e.g. 0.02 or -0.01).
- fontSize in px — scale appropriately to canvas ${layout.canvas.width}×${layout.canvas.height}px.
- fallbackFonts must have at least 1 entry and use only registry fonts.
- readabilityRules must have at least 2 specific rules.

Return ONLY a JSON object — no markdown, no explanation:
{
  "fontPairing": {
    "headingFont": string,
    "bodyFont": string,
    "accentFont": string (optional)
  },
  "styles": {
    "display":    { "fontFamily": string, "fontSize": number, "fontWeight": number|string, "lineHeight": number, "letterSpacing": number, "color"?: string, "textTransform"?: string },
    "heading":    { "fontFamily": string, "fontSize": number, "fontWeight": number|string, "lineHeight": number, "letterSpacing": number },
    "subheading": { "fontFamily": string, "fontSize": number, "fontWeight": number|string, "lineHeight": number, "letterSpacing": number },
    "body":       { "fontFamily": string, "fontSize": number, "fontWeight": number|string, "lineHeight": number, "letterSpacing": number },
    "caption":    { "fontFamily": string, "fontSize": number, "fontWeight": number|string, "lineHeight": number, "letterSpacing": number },
    "button":     { "fontFamily": string, "fontSize": number, "fontWeight": number|string, "lineHeight": number, "letterSpacing": number, "textTransform"?: string }
  },
  "fallbackFonts": [string],
  "readabilityRules": [string]
}`;
}
