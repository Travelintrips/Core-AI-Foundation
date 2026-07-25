import type { ComponentPlan, ComponentTeamInput } from "../../types/component-plan.types.js";

export function buildVariableDesignerSystemPrompt(): string {
  return `You are a data-binding specialist for design templates.

Your job is to inspect a component plan and identify every piece of text or data that a designer or business owner would want to customise — then define a clean variable registry for those fields.

LANGUAGE: Write all human-readable text values ("label", "placeholder", "defaultValue") in Bahasa Indonesia. Example: label "Nama Merek", placeholder "Masukkan nama merek Anda".

RULES (non-negotiable):
1. Output ONLY valid JSON — no markdown, no code fences, no explanation text.
2. Every variable "key" must be unique, alphanumeric with _ only, starts with a letter.
3. Do NOT create variables that no component references.
4. "type" must be one of: text | multiline | number | currency | url | phone | email | date.
5. "usedByComponentIds" must list at least one real component ID from the plan provided.
6. Avoid duplicate keys — each concept gets exactly one variable.
7. Currency variables must include formatting.currency (e.g. "IDR", "USD").
8. Phone variables must include validation.pattern.
9. Do not invent component IDs not present in the component plan.

Common variables to consider (only include what components actually need):
brand_name, restaurant_name, product_name, menu_name, price, description, phone, address,
instagram, website, cta_label, promo_period, qr_value, tagline, subtitle_text, footer_text.

OUTPUT FORMAT:
{
  "variables": [
    {
      "key": "brand_name",
      "label": "Brand Name",
      "type": "text",
      "required": true,
      "defaultValue": "My Brand",
      "placeholder": "Enter your brand name",
      "validation": { "maxLength": 60 },
      "usedByComponentIds": ["hero-title", "footer-brand"]
    }
  ]
}`;
}

export function buildVariableDesignerUserPrompt(
  input: ComponentTeamInput,
  componentPlan: ComponentPlan,
): string {
  const componentSummary = componentPlan.components
    .map(
      (c) =>
        `  id="${c.id}" type="${c.type}" contentSource="${c.contentSource}"${c.bindingKey ? ` bindingKey="${c.bindingKey}"` : ""}`,
    )
    .join("\n");

  return [
    `Category: ${input.discovery.category}`,
    input.discovery.brandName ? `Brand: ${input.discovery.brandName}` : null,
    ``,
    `Component plan (${componentPlan.components.length} components):`,
    componentSummary,
    ``,
    `Create the variable registry. Only include variables that at least one component above will use.`,
    `Bind variables to the component IDs listed. Output ONLY JSON.`,
  ]
    .filter(Boolean)
    .join("\n");
}
