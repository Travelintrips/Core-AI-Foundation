/**
 * Material Catalog Integration — Phase 3 Foundation
 * Pure catalog normalizer — no AI, no fuzzy matching, no Phase 2 imports.
 *
 * Converts raw provider records into normalized ExternalCatalogItem DTOs.
 * All transformations are deterministic.
 */

import type { ExternalCatalogItem, MediaReference, NormalizationResult } from "./types.js";
import { resolveMediaReference } from "./catalogMediaResolver.js";

// ── Vocabulary tables ─────────────────────────────────────────────────────────

const PRICE_TIER_MAP: Record<string, string> = {
  economy: "economy",
  eco: "economy",
  budget: "economy",
  low: "economy",
  standard: "standard",
  mid: "standard",
  medium: "standard",
  regular: "standard",
  premium: "premium",
  high: "premium",
  luxury: "luxury",
  exclusive: "luxury",
  ultra: "luxury",
};

const UNIT_MAP: Record<string, string> = {
  m2: "m²",
  "m²": "m²",
  "sq.m": "m²",
  sqm: "m²",
  "square meter": "m²",
  "square metre": "m²",
  m: "m",
  meter: "m",
  metre: "m",
  lm: "lm",
  "linear meter": "lm",
  "linear metre": "lm",
  pcs: "pcs",
  pieces: "pcs",
  piece: "pcs",
  unit: "pcs",
  sheet: "sheet",
  sheets: "sheet",
  roll: "roll",
  rolls: "roll",
  box: "box",
  boxes: "box",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  l: "L",
  liter: "L",
  litre: "L",
};

const FINISH_NORMALIZATIONS: Record<string, string> = {
  matte: "matte",
  mat: "matte",
  flat: "matte",
  gloss: "gloss",
  glossy: "gloss",
  "high-gloss": "gloss",
  "hi-gloss": "gloss",
  satin: "satin",
  semi_gloss: "semi-gloss",
  "semi-gloss": "semi-gloss",
  semigloss: "semi-gloss",
  velvet: "velvet",
  velvety: "velvet",
  textured: "textured",
  rough: "textured",
  polished: "polished",
  brushed: "brushed",
  honed: "honed",
  natural: "natural",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBrand(brand: unknown): string | undefined {
  const s = trimOrUndefined(brand);
  if (!s) return undefined;
  // Title-case: capitalize first letter of each word
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeCategory(category: unknown): string | undefined {
  const s = trimOrUndefined(category);
  if (!s) return undefined;
  // Lowercase with spaces normalized
  return s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePriceTier(priceTier: unknown): string | undefined {
  const s = trimOrUndefined(priceTier);
  if (!s) return undefined;
  return PRICE_TIER_MAP[s.toLowerCase()] ?? s.toLowerCase();
}

function normalizeUnit(unit: unknown): string | undefined {
  const s = trimOrUndefined(unit);
  if (!s) return undefined;
  return UNIT_MAP[s.toLowerCase()] ?? s;
}

function normalizeColorArray(colors: unknown): string[] | undefined {
  if (!Array.isArray(colors)) {
    // Accept a comma-separated string as a fallback
    if (typeof colors === "string" && colors.trim()) {
      return colors
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c.length > 0);
    }
    return undefined;
  }
  const result = colors
    .map((c) => (typeof c === "string" ? c.trim().toLowerCase() : undefined))
    .filter((c): c is string => Boolean(c));
  return result.length > 0 ? result : undefined;
}

function normalizeFinishArray(finishes: unknown): string[] | undefined {
  if (!Array.isArray(finishes)) return undefined;
  const result = finishes
    .map((f) => {
      if (typeof f !== "string") return undefined;
      const trimmed = f.trim().toLowerCase();
      return FINISH_NORMALIZATIONS[trimmed] ?? trimmed;
    })
    .filter((f): f is string => Boolean(f));
  return result.length > 0 ? result : undefined;
}

function sanitizeMetadata(meta: unknown): Record<string, unknown> | undefined {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    const key = String(k).trim();
    if (!key) continue;
    // Only allow primitive or plain-object values; drop functions, symbols, etc.
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      safe[key] = v;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      safe[key] = sanitizeMetadata(v) ?? null;
    } else if (Array.isArray(v)) {
      safe[key] = v.filter(
        (el) =>
          el === null ||
          typeof el === "string" ||
          typeof el === "number" ||
          typeof el === "boolean",
      );
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function normalizeMediaRef(raw: unknown): MediaReference | undefined {
  if (!raw) return undefined;
  try {
    return resolveMediaReference(raw);
  } catch {
    return { kind: "unresolved", rawValue: String(raw) };
  }
}

// ── Public normalizer ─────────────────────────────────────────────────────────

/**
 * Normalize a raw provider record into an ExternalCatalogItem.
 * Returns normalization warnings alongside the item; never throws on bad data.
 */
export function normalizeExternalItem(raw: unknown): NormalizationResult {
  const warnings: string[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("Input is not an object — cannot normalize");
    return {
      item: {
        externalId: "",
        providerId: "",
        productName: "(invalid)",
      } as ExternalCatalogItem,
      warnings,
    };
  }

  const r = raw as Record<string, unknown>;

  const externalId = trimOrUndefined(r["externalId"]);
  if (!externalId) warnings.push("externalId is missing or blank");

  const productName = trimOrUndefined(r["productName"]);
  if (!productName) warnings.push("productName is missing or blank");

  const rawBrand = trimOrUndefined(r["brand"]);
  const normalizedBrand = normalizeBrand(rawBrand);
  if (rawBrand && rawBrand !== normalizedBrand) {
    warnings.push(`brand casing normalized: '${rawBrand}' → '${normalizedBrand}'`);
  }

  const rawCategory = trimOrUndefined(r["category"]);
  const normalizedCategory = normalizeCategory(rawCategory);

  const rawPriceTier = trimOrUndefined(r["priceTier"]);
  const normalizedPriceTier = normalizePriceTier(rawPriceTier);
  if (rawPriceTier && rawPriceTier !== normalizedPriceTier) {
    warnings.push(`priceTier normalized: '${rawPriceTier}' → '${normalizedPriceTier}'`);
  }

  const rawUnit = trimOrUndefined(r["unit"]);
  const normalizedUnit = normalizeUnit(rawUnit);
  if (rawUnit && rawUnit !== normalizedUnit) {
    warnings.push(`unit normalized: '${rawUnit}' → '${normalizedUnit}'`);
  }

  const colors = normalizeColorArray(r["color"]);
  const finishes = normalizeFinishArray(r["finish"]);
  const metadata = sanitizeMetadata(r["sourceMetadata"]);
  const technicalData = sanitizeMetadata(r["technicalData"]);
  const dimensions = sanitizeMetadata(r["dimensions"]);

  const thumbnailRef = normalizeMediaRef(r["thumbnailReference"]);
  const previewRefs = Array.isArray(r["previewReferences"])
    ? (r["previewReferences"] as unknown[])
        .map(normalizeMediaRef)
        .filter((ref): ref is MediaReference => ref !== undefined)
    : undefined;

  const sourceUpdatedAt =
    r["sourceUpdatedAt"] instanceof Date
      ? r["sourceUpdatedAt"]
      : typeof r["sourceUpdatedAt"] === "string"
        ? new Date(r["sourceUpdatedAt"])
        : undefined;

  const certifications = Array.isArray(r["certifications"])
    ? (r["certifications"] as unknown[])
        .map((c) => trimOrUndefined(c))
        .filter((c): c is string => Boolean(c))
    : undefined;

  const item: ExternalCatalogItem = {
    externalId: externalId ?? "",
    providerId: trimOrUndefined(r["providerId"]) ?? "",
    sourceUrl: trimOrUndefined(r["sourceUrl"]),
    brand: normalizedBrand,
    productCode: trimOrUndefined(r["productCode"]),
    productName: productName ?? "(unknown)",
    category: normalizedCategory,
    subcategory: trimOrUndefined(r["subcategory"]),
    materialType: trimOrUndefined(r["materialType"]),
    description: trimOrUndefined(r["description"]),
    color: colors,
    finish: finishes,
    texture: trimOrUndefined(r["texture"]),
    pattern: trimOrUndefined(r["pattern"]),
    priceTier: normalizedPriceTier,
    unit: normalizedUnit,
    dimensions: dimensions,
    technicalData: technicalData,
    certifications,
    thumbnailReference: thumbnailRef,
    previewReferences: previewRefs && previewRefs.length > 0 ? previewRefs : undefined,
    country: trimOrUndefined(r["country"]),
    locale: trimOrUndefined(r["locale"]),
    sourceUpdatedAt,
    sourceMetadata: metadata,
  };

  return { item, warnings };
}
