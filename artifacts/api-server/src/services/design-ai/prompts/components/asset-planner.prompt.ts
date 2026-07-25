import type { ComponentPlan } from "../../types/component-plan.types.js";

export function buildAssetPlannerSystemPrompt(): string {
  return `You are an asset requirements planner for design templates.

Your job is to inspect a component plan and define placeholder asset requirements for every component whose contentSource is "asset" or "generated-placeholder". You do NOT generate images, logos, URLs, or any binary content.

LANGUAGE: Write all descriptive text values ("purpose", "placeholderLabel", and all "visualGuidance" strings) in Bahasa Indonesia yang jelas dan mudah dipahami.

RULES (non-negotiable):
1. Output ONLY valid JSON — no markdown, no code fences, no explanation text.
2. Never include image URLs, base64 strings, or external URLs.
3. Never call any image generation API.
4. Never save any file.
5. Only create assets for components with contentSource "asset" or "generated-placeholder".
6. Every asset "id" must be unique and semantic (e.g. "hero-logo", "product-photo-1").
7. "componentId" must reference a real component ID from the plan.
8. "type" must be one of: photo | logo | icon | background | illustration | qr.
9. "aspectRatio" must be in W:H format (e.g. "1:1", "16:9", "4:3").
10. "dimensions" must be positive integers.
11. "visualGuidance" should contain 2–4 human-readable upload tips.
12. Do not create duplicate asset IDs.

OUTPUT FORMAT:
{
  "assets": [
    {
      "id": "hero-logo",
      "type": "logo",
      "componentId": "brand-logo",
      "purpose": "Brand identity mark displayed in the hero section",
      "required": true,
      "placeholderLabel": "Brand Logo",
      "dimensions": { "width": 200, "height": 80 },
      "aspectRatio": "5:2",
      "fit": "contain",
      "cropFocus": "center",
      "acceptedMimeTypes": ["image/png", "image/svg+xml"],
      "visualGuidance": [
        "Use a PNG with transparent background",
        "Minimum 200px wide for sharp rendering",
        "Prefer dark logo variant for light backgrounds"
      ]
    }
  ]
}`;
}

export function buildAssetPlannerUserPrompt(componentPlan: ComponentPlan, canvasW: number, canvasH: number): string {
  const assetComponents = componentPlan.components.filter(
    (c) => c.contentSource === "asset" || c.contentSource === "generated-placeholder",
  );

  if (assetComponents.length === 0) {
    return `No components with contentSource "asset" or "generated-placeholder" were found.
Return an empty asset plan: { "assets": [] }`;
  }

  const componentList = assetComponents
    .map(
      (c) =>
        `  id="${c.id}" type="${c.type}" region={x:${c.region.x},y:${c.region.y},w:${c.region.width},h:${c.region.height}} required=${c.required}`,
    )
    .join("\n");

  return [
    `Canvas: ${canvasW}×${canvasH}px`,
    ``,
    `Components requiring assets (${assetComponents.length}):`,
    componentList,
    ``,
    `Define placeholder asset requirements for each component above. No URLs, no images. Output ONLY JSON.`,
  ].join("\n");
}
