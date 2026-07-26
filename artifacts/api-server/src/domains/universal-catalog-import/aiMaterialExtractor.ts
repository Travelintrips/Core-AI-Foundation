/**
 * Universal Catalog Import — AI Material Extractor
 * Uses OpenAI to extract structured universal material records from raw text/objects.
 * Never fabricates values — instructs the model to return null for unknown fields.
 * Operates in batch (multiple raw items → multiple materials in one call).
 */

import OpenAI from "openai";
import type { AIExtractionInput, AIExtractionResult } from "./types.js";
import type { UniversalMaterial } from "./types.js";

const MAX_BATCH_TEXT_CHARS = 8_000;

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });
  }
  return _openai;
}

const SYSTEM_PROMPT = `You are a material catalog data extractor for an interior design platform.
Extract structured building material records from raw catalog text or structured data.

Rules:
- Return ONLY a valid JSON array of material objects.
- Never fabricate values. If a field is unknown, omit it (do not guess).
- productName is the most important field — always extract it if present.
- Normalize colors to English (e.g., "Merah" → "Red", "Abu-abu" → "Gray").
- Normalize finish values: "polished", "matte", "glossy", "satin", "rustic", "natural", etc.
- Split variants (e.g., different sizes of the same product) into separate objects.
- For dimensions, use metric (mm or cm). Represent as {"length": ..., "width": ..., "unit": "mm"}.
- category should be one of: Flooring, Wall Tile, Ceiling, Hardware, Sanitary, Furniture, Lighting, Other.
- sourceType, sourceName are provided externally — do not include them in output.

Return this exact JSON structure per item:
{
  "brand": string | null,
  "collection": string | null,
  "series": string | null,
  "productCode": string | null,
  "productName": string,
  "variant": string | null,
  "category": string | null,
  "subcategory": string | null,
  "materialType": string | null,
  "description": string | null,
  "colors": string[] | null,
  "finish": string[] | null,
  "texture": string | null,
  "pattern": string | null,
  "dimensions": object | null,
  "workingSize": string | null,
  "thickness": string | null,
  "numberOfFaces": number | null,
  "peiRating": number | null,
  "shadeVariation": string | null,
  "technicalSpecifications": object | null,
  "application": string[] | null,
  "certifications": string[] | null,
  "thumbnailReference": string | null,
  "previewReferences": string[] | null
}

Return [] if no valid material data is found. Do not wrap in any other object.`;

export async function extractMaterialsWithAI(
  input: AIExtractionInput,
): Promise<AIExtractionResult> {
  const warnings: string[] = [];

  if (!process.env["OPENAI_API_KEY"]) {
    warnings.push("OPENAI_API_KEY not set — AI extraction skipped, using raw data passthrough");
    return { materials: [], confidence: 0, warnings };
  }

  // Truncate input to safe size
  let rawText = input.rawText;
  if (rawText.length > MAX_BATCH_TEXT_CHARS) {
    rawText = rawText.slice(0, MAX_BATCH_TEXT_CHARS);
    warnings.push(`Input truncated to ${MAX_BATCH_TEXT_CHARS} chars for AI extraction`);
  }

  const userMessage = buildUserMessage(input, rawText);

  let responseText: string;
  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });
    responseText = completion.choices[0]?.message?.content ?? "[]";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`AI extraction API error: ${msg}`);
    return { materials: [], confidence: 0, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Model returned non-JSON despite json_object mode — try to extract array
    const arrMatch = responseText.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { parsed = JSON.parse(arrMatch[0]); } catch { /* ignore */ }
    }
    if (!parsed) {
      warnings.push("AI returned non-JSON response — skipping");
      return { materials: [], confidence: 0, warnings };
    }
  }

  // The model may return { items: [...] } or [...] directly
  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["items"])) {
    items = (parsed as Record<string, unknown>)["items"] as unknown[];
  } else {
    items = [];
    warnings.push("AI returned unexpected JSON structure — no items extracted");
  }

  const materials: Partial<UniversalMaterial>[] = items
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const raw = item as Record<string, unknown>;
      const mat: Partial<UniversalMaterial> = {};

      if (raw["brand"] && typeof raw["brand"] === "string") mat.brand = raw["brand"];
      if (raw["collection"] && typeof raw["collection"] === "string") mat.collection = raw["collection"];
      if (raw["series"] && typeof raw["series"] === "string") mat.series = raw["series"];
      if (raw["productCode"] && typeof raw["productCode"] === "string") mat.productCode = raw["productCode"];
      if (raw["productName"] && typeof raw["productName"] === "string") mat.productName = raw["productName"];
      if (raw["variant"] && typeof raw["variant"] === "string") mat.variant = raw["variant"];
      if (raw["category"] && typeof raw["category"] === "string") mat.category = raw["category"];
      if (raw["subcategory"] && typeof raw["subcategory"] === "string") mat.subcategory = raw["subcategory"];
      if (raw["materialType"] && typeof raw["materialType"] === "string") mat.materialType = raw["materialType"];
      if (raw["description"] && typeof raw["description"] === "string") mat.description = raw["description"];
      if (Array.isArray(raw["colors"])) mat.colors = raw["colors"].map(String);
      if (Array.isArray(raw["finish"])) mat.finish = raw["finish"].map(String);
      if (raw["texture"] && typeof raw["texture"] === "string") mat.texture = raw["texture"];
      if (raw["pattern"] && typeof raw["pattern"] === "string") mat.pattern = raw["pattern"];
      if (raw["dimensions"] && typeof raw["dimensions"] === "object") mat.dimensions = raw["dimensions"] as Record<string, unknown>;
      if (raw["workingSize"] && typeof raw["workingSize"] === "string") mat.workingSize = raw["workingSize"];
      if (raw["thickness"] && typeof raw["thickness"] === "string") mat.thickness = raw["thickness"];
      if (typeof raw["numberOfFaces"] === "number") mat.numberOfFaces = raw["numberOfFaces"];
      if (typeof raw["peiRating"] === "number") mat.peiRating = raw["peiRating"];
      if (raw["shadeVariation"] && typeof raw["shadeVariation"] === "string") mat.shadeVariation = raw["shadeVariation"];
      if (raw["technicalSpecifications"] && typeof raw["technicalSpecifications"] === "object") mat.technicalSpecifications = raw["technicalSpecifications"] as Record<string, unknown>;
      if (Array.isArray(raw["application"])) mat.application = raw["application"].map(String);
      if (Array.isArray(raw["certifications"])) mat.certifications = raw["certifications"].map(String);
      if (raw["thumbnailReference"] && typeof raw["thumbnailReference"] === "string") mat.thumbnailReference = raw["thumbnailReference"];
      if (Array.isArray(raw["previewReferences"])) mat.previewReferences = raw["previewReferences"].map(String);

      return mat;
    });

  return {
    materials,
    confidence: materials.length > 0 ? 0.85 : 0,
    warnings,
  };
}

function buildUserMessage(input: AIExtractionInput, rawText: string): string {
  const lines: string[] = [`Source: ${input.sourceType} — ${input.sourceName}`];
  if (input.sourcePage) lines.push(`Page: ${input.sourcePage}`);
  if (input.hints?.brand) lines.push(`Brand hint: ${input.hints.brand}`);
  if (input.hints?.category) lines.push(`Category hint: ${input.hints.category}`);
  lines.push("", "Raw content:", rawText);
  return lines.join("\n");
}

/**
 * Convert a raw extracted item (Record | string) to a text string for AI processing.
 * Structured data (from CSV/Excel/JSON/XML) is serialized as key:value pairs.
 */
export function rawItemToText(raw: Record<string, unknown> | string): string {
  if (typeof raw === "string") return raw;
  // For structured data, format as readable key:value
  const lines: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue; // internal meta keys
    const val = Array.isArray(value) ? value.join(", ") : String(value ?? "");
    if (val.trim()) lines.push(`${key}: ${val}`);
  }
  return lines.join("\n");
}
