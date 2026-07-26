/**
 * Universal Catalog Import — XML Adapter
 * Parses XML catalogs using fast-xml-parser.
 * Handles product feeds, catalog exports, and generic XML structures.
 */

import { XMLParser } from "fast-xml-parser";
import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  allowBooleanAttributes: true,
};

// Common XML envelope paths for product data
const PRODUCT_PATHS = [
  "catalog.products.product",
  "catalog.items.item",
  "feed.products.product",
  "feed.items.item",
  "root.products.product",
  "products.product",
  "items.item",
  "catalog.product",
  "feed.product",
  "root.product",
  "product",
  "item",
];

export class XmlAdapter implements CatalogAdapter {
  readonly sourceType = "xml" as const;
  readonly displayName = "XML File";
  readonly supportedMimeTypes = ["application/xml", "text/xml", "application/rss+xml"];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!input.buffer) {
      return { rawItems: [], warnings, errors: ["No file buffer provided for XML adapter"], sourceMetadata: {} };
    }

    const text = input.buffer.toString("utf-8");
    if (!text.trim()) {
      return { rawItems: [], warnings: ["XML file is empty"], errors, sourceMetadata: {} };
    }

    let parsed: Record<string, unknown>;
    try {
      const parser = new XMLParser(PARSER_OPTIONS);
      parsed = parser.parse(text) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { rawItems: [], warnings, errors: [`XML parse error: ${msg}`], sourceMetadata: {} };
    }

    const { items, resolvedPath } = findProductItems(parsed);

    if (items.length === 0) {
      warnings.push(
        "Could not locate product array in XML. Tried paths: " + PRODUCT_PATHS.join(", "),
      );
    } else {
      warnings.push(`XML items found at path: '${resolvedPath}'`);
    }

    const rawItems: RawExtractedItem[] = items.map((item, idx) => ({
      raw: flattenXmlItem(item),
      sourceContext: { row: idx, elementType: "xml_element" },
    }));

    return {
      rawItems,
      warnings,
      errors,
      sourceMetadata: {
        resolvedPath,
        totalItems: items.length,
        rootKeys: Object.keys(parsed),
        filename: input.filename,
      },
    };
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function findProductItems(parsed: Record<string, unknown>): {
  items: Record<string, unknown>[];
  resolvedPath: string;
} {
  for (const path of PRODUCT_PATHS) {
    const value = getNestedValue(parsed, path);
    if (Array.isArray(value) && value.length > 0) {
      return { items: value as Record<string, unknown>[], resolvedPath: path };
    }
    // Single item (not array)
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { items: [value as Record<string, unknown>], resolvedPath: path };
    }
  }
  return { items: [], resolvedPath: "" };
}

/** Flatten XML item — convert text node / attribute patterns to simple key:value */
function flattenXmlItem(item: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      // Text node wrapper: { "#text": "value" }
      if ("#text" in nested) {
        flat[key] = nested["#text"];
      } else {
        // Recurse one level
        for (const [nk, nv] of Object.entries(nested)) {
          flat[nk.startsWith("@_") ? nk.slice(2) : `${key}_${nk}`] = nv;
        }
      }
    } else {
      flat[key.startsWith("@_") ? key.slice(2) : key] = value;
    }
  }
  return flat;
}

export const xmlAdapter = new XmlAdapter();
