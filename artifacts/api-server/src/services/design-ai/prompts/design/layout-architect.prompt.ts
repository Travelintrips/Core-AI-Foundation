import type { DiscoveryTeamOutput } from "../../types/discovery-contract.types.js";

export function buildLayoutArchitectPrompt(
  input: DiscoveryTeamOutput,
  canvas: { width: number; height: number },
): string {
  const { creativeBrief, requirementAnalysis } = input;
  const sections = [
    ...requirementAnalysis.requiredSections,
    ...requirementAnalysis.optionalSections,
  ].slice(0, 12);

  return `You are Layout Architect AI. Your task is to produce a LayoutSpec JSON for the following design project.

PROJECT: ${creativeBrief.projectName}
CANVAS: ${canvas.width}×${canvas.height}px
PROJECT TYPE: ${creativeBrief.projectType}
CONTENT DENSITY: ${requirementAnalysis.contentDensity}
LAYOUT COMPLEXITY: ${requirementAnalysis.layoutComplexity}
SECTIONS REQUIRED: ${requirementAnalysis.requiredSections.join(", ")}
SECTIONS OPTIONAL: ${requirementAnalysis.optionalSections.join(", ")}
ESTIMATED SECTION COUNT: ${requirementAnalysis.estimatedSectionCount}
HAS HERO IMAGE: ${requirementAnalysis.hasHeroImage}
HAS CTA: ${requirementAnalysis.hasCta}
${creativeBrief.additionalNotes ? `NOTES: ${creativeBrief.additionalNotes}` : ""}

RULES:
- All section regions MUST fit within the canvas (x+width ≤ ${canvas.width}, y+height ≤ ${canvas.height}).
- Sections must not overlap.
- Use logical pixel coordinates (no fractions needed).
- Safe area = canvas minus margins.
- Assign priority 1–10 (10 = most important); CTA ≥ 9, hero ≥ 8.
- Reading order must list every section id in top-to-bottom, left-to-right order.
- whitespaceRules must have at least 2 rules.

Return ONLY a JSON object matching this schema — no markdown, no explanation:
{
  "canvas": { "width": number, "height": number },
  "grid": {
    "columns": number,
    "gutter": number,
    "margin": { "top": number, "right": number, "bottom": number, "left": number }
  },
  "safeArea": { "x": number, "y": number, "width": number, "height": number },
  "sections": [
    {
      "id": string,
      "name": string,
      "order": number,
      "region": { "x": number, "y": number, "width": number, "height": number },
      "alignment": "left"|"center"|"right",
      "priority": number (1–10)
    }
  ],
  "readingOrder": [section ids in order],
  "whitespaceRules": [string]
}

Design for sections: ${sections.join(", ")}`;
}
