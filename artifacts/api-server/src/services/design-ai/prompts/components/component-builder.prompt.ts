import type { ComponentTeamInput } from "../../types/component-plan.types.js";

export function buildComponentBuilderSystemPrompt(): string {
  return `You are a senior UI/UX architect specialising in design template component planning.

Your job is to produce a structured JSON component plan — a list of logical, named components that populate a design canvas. You do NOT generate final Konva nodes, SVG, or rendered output.

RULES (non-negotiable):
1. Output ONLY valid JSON — no markdown, no code fences, no explanation text.
2. Every component ID must be unique, semantic, and stable (e.g. "hero-title", "product-image", "footer-phone").
3. IDs must match the pattern: starts with a letter, alphanumeric with - or _ only, max 64 chars.
4. Every component must reference a valid sectionId from the sections provided.
5. "contentSource" must be one of: static | variable | asset | generated-placeholder.
6. If contentSource is "variable", set "bindingKey" to the variable key this component should display.
7. "layerRole" must be one of: background | decoration | content | foreground.
8. Supported component types: logo, image_placeholder, title, subtitle, description, price, cta, qr_code, contact_information, footer, social_icon, badge, divider, background, shape.
9. Regions must not have negative width or height.
10. Do not invent section IDs not listed in the input.
11. Do not produce Konva node objects or SVG.

OUTPUT FORMAT:
{
  "components": [
    {
      "id": "hero-background",
      "sectionId": "hero",
      "type": "background",
      "role": "Full-canvas background for the hero section",
      "required": true,
      "contentSource": "asset",
      "region": { "x": 0, "y": 0, "width": 1080, "height": 400 },
      "layerRole": "background",
      "properties": { "opacity": 1 }
    }
  ]
}`;
}

export function buildComponentBuilderUserPrompt(input: ComponentTeamInput, canvasW: number, canvasH: number): string {
  const { discovery, design } = input;
  const sections = design.sections
    .sort((a, b) => a.order - b.order)
    .map((s) => `  - id="${s.id}" name="${s.name}" purpose="${s.purpose}"`)
    .join("\n");

  return [
    `Design brief:`,
    `  Category: ${discovery.category}`,
    discovery.industry ? `  Industry: ${discovery.industry}` : null,
    discovery.objective ? `  Objective: ${discovery.objective}` : null,
    discovery.brandName ? `  Brand: ${discovery.brandName}` : null,
    discovery.keyMessages?.length
      ? `  Key messages: ${discovery.keyMessages.slice(0, 5).join(", ")}`
      : null,
    ``,
    `Design specification:`,
    `  Style: ${design.style}`,
    `  Canvas: ${canvasW}×${canvasH}px`,
    design.colorPalette?.length ? `  Colors: ${design.colorPalette.join(", ")}` : null,
    design.fontPrimary ? `  Primary font: ${design.fontPrimary}` : null,
    ``,
    `Sections (use these sectionId values exactly):`,
    sections,
    ``,
    `Produce a component plan covering all sections. Use semantic, meaningful IDs. Output ONLY JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}
