import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";
import type { LayoutSpec } from "../../types/design.types.js";

export function buildCompositionDesignerPrompt(
  input: DiscoveryTeamOutput,
  layout: LayoutSpec,
): string {
  const sectionIds = layout.sections.map((s) => s.id).join(", ");
  const { brandStrategy, requirementAnalysis } = input;

  return `You are Composition Designer AI. Given the layout spec, determine how visual weight, focal point, and eye flow should be arranged.

LANGUAGE: Write all descriptive text values (focalPoint.reason, relationships.relationship) in Bahasa Indonesia.

PROJECT: ${input.creativeBrief.projectName}
BRAND STYLE: ${brandStrategy.styleDirection} / ${brandStrategy.mood}
CANVAS: ${layout.canvas.width}×${layout.canvas.height}px
SECTION IDs: ${sectionIds}
CONTENT DENSITY: ${requirementAnalysis.contentDensity}
HAS HERO IMAGE: ${requirementAnalysis.hasHeroImage}
HAS CTA: ${requirementAnalysis.hasCta}

RULES:
- focalPoint.sectionId must be one of: ${sectionIds}
- eyeFlow must reference valid section ids in reading order
- visualWeight must list EVERY section id; weights 0–100
- spacingScale must be an ascending array of at least 4 values (px)
- densityMap must list EVERY section id
- balance must be "symmetrical", "asymmetrical", or "radial"

Return ONLY a JSON object matching this schema — no markdown, no explanation:
{
  "focalPoint": { "sectionId": string, "reason": string },
  "eyeFlow": [section ids in visual reading sequence],
  "balance": "symmetrical"|"asymmetrical"|"radial",
  "visualWeight": [{ "sectionId": string, "weight": number (0–100) }],
  "spacingScale": [ascending numbers in px],
  "relationships": [{ "fromSectionId": string, "toSectionId": string, "relationship": string }],
  "densityMap": [{ "sectionId": string, "density": "low"|"medium"|"high" }]
}`;
}
