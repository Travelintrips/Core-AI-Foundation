import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import type { ColorSpec, CompositionSpec, LayoutSpec } from "../../types/design.types.js";

export function buildDecorationDesignerPrompt(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
  composition: CompositionSpec,
  colors: ColorSpec,
): string {
  const sectionIds = layout.sections.map((s) => s.id).join(", ");
  const highDensity = composition.densityMap
    .filter((d) => d.density === "high")
    .map((d) => d.sectionId)
    .join(", ");

  return `You are Decoration Designer AI. Add tasteful visual decorations to the design.

PROJECT: ${input.creativeBrief.projectName}
STYLE: ${input.brandStrategy.styleDirection}
CANVAS: ${layout.canvas.width}×${layout.canvas.height}px
SECTION IDs: ${sectionIds}
FOCAL POINT: ${composition.focalPoint.sectionId}
BALANCE: ${composition.balance}
HIGH-DENSITY SECTIONS (avoid cluttering): ${highDensity || "none"}
PRIMARY COLOR: ${colors.tokens.primary}
ACCENT COLOR: ${colors.tokens.accent}
BACKGROUND: ${colors.tokens.background}

RULES:
- Do NOT place decorations that overlap the focalPoint section's core content area
- Do NOT clutter high-density sections: ${highDensity || "none"}
- Each decoration needs a unique id (e.g. "deco-1", "bg-circle-1")
- geometry and style are free-form objects describing shape/position/color
- decorativeOnly:true for all purely visual elements (shapes, patterns, dividers)
- decorativeOnly:false only if the decoration carries semantic meaning (e.g. a badge with a label)
- targetSectionId must be one of: ${sectionIds} (or omit for canvas-level)
- 0 decorations is valid if the style demands minimal design
- Maximum 6 decorations total

Return ONLY a JSON object — no markdown, no explanation:
{
  "decorations": [
    {
      "id": string,
      "type": "shape"|"divider"|"frame"|"badge"|"pattern"|"background-accent",
      "targetSectionId"?: string,
      "geometry": { ...freeform coordinates/dimensions },
      "style": { ...freeform fill/stroke/opacity },
      "purpose": string,
      "decorativeOnly": boolean
    }
  ]
}`;
}
