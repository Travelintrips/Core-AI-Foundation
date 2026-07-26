/**
 * Universal Catalog Import — JSON Adapter
 * Handles JSON arrays, objects, and nested structures.
 * Supports arrays of products, {items: []}, {products: []}, {data: []}, etc.
 */

import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

export class JsonAdapter implements CatalogAdapter {
  readonly sourceType = "json" as const;
  readonly displayName = "JSON File";
  readonly supportedMimeTypes = ["application/json", "text/json"];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    let text: string;
    if (input.buffer) {
      text = input.buffer.toString("utf-8");
    } else if (input.url) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(input.url, {
            signal: controller.signal,
            headers: { accept: "application/json" },
          });
          if (!res.ok) {
            return { rawItems: [], warnings, errors: [`HTTP ${res.status} fetching JSON URL`], sourceMetadata: {} };
          }
          text = await res.text();
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { rawItems: [], warnings, errors: [`Fetch error: ${msg}`], sourceMetadata: {} };
      }
    } else {
      return { rawItems: [], warnings, errors: ["No buffer or URL provided"], sourceMetadata: {} };
    }

    if (!text.trim()) {
      return { rawItems: [], warnings: ["JSON input is empty"], errors, sourceMetadata: {} };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { rawItems: [], warnings, errors: [`JSON parse error: ${msg}`], sourceMetadata: {} };
    }

    const { items, path } = extractItemArray(parsed);
    if (items.length === 0) {
      warnings.push("No item array found in JSON. Expected array or {items/products/data: []}");
    }
    if (path) {
      warnings.push(`Items extracted from JSON path: '${path}'`);
    }

    const rawItems: RawExtractedItem[] = items.map((item, idx) => ({
      raw: typeof item === "object" && item !== null ? (item as Record<string, unknown>) : { value: item },
      sourceContext: { row: idx, elementType: "json_item" },
    }));

    return {
      rawItems,
      warnings,
      errors,
      sourceMetadata: {
        extractedPath: path ?? "root",
        totalItems: items.length,
        filename: input.filename ?? input.url,
      },
    };
  }
}

function extractItemArray(parsed: unknown): { items: unknown[]; path?: string } {
  if (Array.isArray(parsed)) {
    return { items: parsed };
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    // Common envelope keys
    for (const key of ["items", "products", "data", "materials", "catalog", "records", "results"]) {
      if (Array.isArray(obj[key])) {
        return { items: obj[key] as unknown[], path: key };
      }
    }
    // If top-level object has product-like keys, wrap it
    if (obj["productCode"] || obj["productName"] || obj["brand"]) {
      return { items: [obj] };
    }
  }
  return { items: [] };
}

export const jsonAdapter = new JsonAdapter();
