import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";

export function buildColorDesignerPrompt(input: DiscoveryTeamOutput): string {
  const { brandStrategy } = input;
  const brandColors = brandStrategy.existingBrandColors ?? {};
  const preferredColors = brandStrategy.preferredColors ?? [];

  return `You are Color Designer AI. Produce a complete ColorSpec for this project.

LANGUAGE: Write all descriptive text values in Bahasa Indonesia.

PROJECT: ${input.creativeBrief.projectName}
BRAND: ${brandStrategy.brandName}
STYLE: ${brandStrategy.styleDirection}
MOOD: ${brandStrategy.mood}
TARGET EMOTION: ${brandStrategy.targetEmotion ?? "not specified"}
BRAND PERSONALITY: ${brandStrategy.brandPersonality.join(", ")}
${brandColors.primary ? `EXISTING PRIMARY COLOR: ${brandColors.primary}` : ""}
${brandColors.secondary ? `EXISTING SECONDARY COLOR: ${brandColors.secondary}` : ""}
${brandColors.accent ? `EXISTING ACCENT COLOR: ${brandColors.accent}` : ""}
${preferredColors.length > 0 ? `PREFERRED COLORS: ${preferredColors.join(", ")}` : ""}

RULES:
- ALL hex colors must be exactly 6-digit hex format: #RRGGBB
- Respect existing brand colors if provided (keep them as primary/secondary/accent)
- contrastChecks MUST include at minimum: textPrimary on background, textPrimary on surface
- Compute contrast ratio using WCAG 2.1 formula; set passed:true if ratio ≥ 4.5
- Do not use more than 2 gradients — less is more
- Do not use more than 2 shadow definitions
- Shadows opacity must be 0–1

Return ONLY a JSON object — no markdown, no explanation:
{
  "tokens": {
    "background": "#RRGGBB",
    "surface": "#RRGGBB",
    "primary": "#RRGGBB",
    "secondary": "#RRGGBB",
    "accent": "#RRGGBB",
    "textPrimary": "#RRGGBB",
    "textSecondary": "#RRGGBB",
    "border": "#RRGGBB",
    "success": "#RRGGBB" (optional),
    "warning": "#RRGGBB" (optional),
    "danger": "#RRGGBB" (optional)
  },
  "gradients": [{ "id": string, "type": "linear"|"radial", "colors": [hex], "stops": [0..1], "angle"?: number }],
  "shadows": [{ "id": string, "offsetX": number, "offsetY": number, "blur": number, "opacity": number }],
  "contrastChecks": [{ "foreground": hex, "background": hex, "ratio": number, "passed": boolean }]
}`;
}
