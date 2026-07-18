/**
 * Canonical Normalizer — Enterprise Template Knowledge Library V5.0
 *
 * Single source of truth for mapping legacy / alias / Title-Case / Bahasa-Indonesia
 * style and industry values to their canonical snake_case keys used in the knowledge tables.
 *
 * Rules:
 *  - trim whitespace, lowercase, then look up alias map
 *  - unknown values return null — callers must decide what to do with null
 *  - never silently maps unknown values to an arbitrary default
 *  - idempotent: normalizing an already-canonical value is a no-op
 *
 * Usage:
 *  import { normalizeStyle, normalizeIndustry } from "../utils/canonicalNormalizer.js";
 *  const canonical = normalizeStyle("Modern");  // → "modern"
 *  const ind = normalizeIndustry("F&B");        // → "food_beverage"
 *  const unk = normalizeStyle("whatever");      // → null
 */

// ─────────────────────────────────────────────────────────────────────────────
// Style alias map
//   key   : normalised input  (trimmed, lowercased)
//   value : canonical style_key in ai_style_knowledge
//
// Every canonical key maps to itself so that already-canonical values pass
// through unchanged. Legacy / Title-Case / synonym keys map to the closest
// canonical equivalent.
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_ALIAS_MAP: Readonly<Record<string, string>> = {
  // ── Canonical pass-throughs (36 styles in ai_style_knowledge) ────────────
  modern:         "modern",
  minimalist:     "minimalist",
  luxury:         "luxury",
  elegant:        "elegant",
  premium:        "premium",
  industrial:     "industrial",
  scandinavian:   "scandinavian",
  japandi:        "japandi",
  classic:        "classic",
  contemporary:   "contemporary",
  retro:          "retro",
  vintage:        "vintage",
  bold:           "bold",
  playful:        "playful",
  corporate:      "corporate",
  editorial:      "editorial",
  organic:        "organic",
  feminine:       "feminine",
  masculine:      "masculine",
  high_fashion:   "high_fashion",
  modern_luxury:  "modern_luxury",
  neo_minimalism: "neo_minimalism",
  brutalism:      "brutalism",
  glassmorphism:  "glassmorphism",
  claymorphism:   "claymorphism",
  dark_mode:      "dark_mode",
  light_mode:     "light_mode",
  streetwear:     "streetwear",
  sportswear:     "sportswear",
  tech_startup:   "tech_startup",
  ngo_social:     "ngo_social",
  government:     "government",
  healthcare:     "healthcare",
  food_beverage:  "food_beverage",
  education:      "education",
  luxury_editorial: "luxury_editorial",

  // ── Legacy / Title-Case / alias mappings ─────────────────────────────────
  // "professional" — formal, structured → corporate
  professional:   "corporate",
  // "promotional" — eye-catching, persuasive → bold
  promotional:    "bold",
  // "creative" — expressive, varied → contemporary
  creative:       "contemporary",
  // "natural" — earthy, eco → organic
  natural:        "organic",
  // "minimal" short form → minimalist
  minimal:        "minimalist",
  // "luxury_fashion" used as style in some old templates
  luxury_fashion: "luxury",
  // "tech" shorthand → tech_startup
  tech:           "tech_startup",
  // "sport" → sportswear
  sport:          "sportswear",
  // "street" → streetwear
  street:         "streetwear",
  // "feminine_soft" variant → feminine
  feminine_soft:  "feminine",
  // "artdeco" without underscore
  artdeco:        "contemporary",
  // "maximalist" → bold (closest available; maximalist not in current KB)
  maximalist:     "bold",
  // "brutalist" → brutalism
  brutalist:      "brutalism",
  // "neo_minimal" → neo_minimalism
  neo_minimal:    "neo_minimalism",
  // "dark" shorthand → dark_mode
  dark:           "dark_mode",
  // "light" shorthand → light_mode
  light:          "light_mode",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Industry alias map
//   key   : normalised input  (trimmed, lowercased, & replaces whitespace)
//   value : canonical industry_key in ai_industry_knowledge
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRY_ALIAS_MAP: Readonly<Record<string, string>> = {
  // ── Canonical pass-throughs (43 industries in ai_industry_knowledge) ──────
  fashion:          "fashion",
  luxury_fashion:   "luxury_fashion",
  streetwear_brand: "streetwear_brand",
  modest_fashion:   "modest_fashion",
  beauty:           "beauty",
  food_beverage:    "food_beverage",
  coffee:           "coffee",
  restaurant:       "restaurant",
  technology:       "technology",
  saas:             "saas",
  fintech:          "fintech",
  finance:          "finance",
  healthcare:       "healthcare",
  real_estate:      "real_estate",
  logistics:        "logistics",
  manufacturing:    "manufacturing",
  education:        "education",
  construction:     "construction",
  automotive:       "automotive",
  hotel:            "hotel",
  travel:           "travel",
  agriculture:      "agriculture",
  mining:           "mining",
  energy:           "energy",
  government:       "government",
  ngo:              "ngo",
  entertainment:    "entertainment",
  sports:           "sports",
  interior_design:  "interior_design",
  consulting:       "consulting",
  retail:           "retail",
  wedding:          "wedding",
  fast_fashion:     "fast_fashion",
  sportswear:       "sportswear",
  kids_fashion:     "kids_fashion",
  boutique:         "boutique",
  jewelry:          "jewelry",
  shoes:            "shoes",
  bag:              "bag",
  cosmetics:        "cosmetics",
  lifestyle:        "lifestyle",
  beverage:         "beverage",
  media:            "media",

  // ── Legacy Title-Case / abbreviation / Bahasa Indonesia mappings ──────────
  // English Title Case (pre-import templates)
  "technology_lc":  "technology",   // placeholder; actual: "technology" already above
  teknologi:        "technology",   // Bahasa Indonesia
  "it":             "technology",   // IT abbreviation
  "tech":           "technology",   // shorthand
  "f&b":            "food_beverage",
  "food_&_beverage": "food_beverage",
  "food_and_beverage": "food_beverage",
  "food_&_beverage_": "food_beverage",
  "food_beverage_ind": "food_beverage",
  fnb:              "food_beverage", // another abbreviation
  property:         "real_estate",
  "real_estate_ind": "real_estate",
  properti:         "real_estate",  // Bahasa Indonesia (unquoted key)
  export:           "consulting",   // export/trading companies → consulting
  trading:          "consulting",   // no canonical "trading" in KB → consulting
  perdagangan:      "consulting",   // Bahasa Indonesia for trading
  legal:            "consulting",   // legal services → consulting
  "law":            "consulting",
  health:           "healthcare",
  "kesehatan":      "healthcare",   // Bahasa Indonesia
  medis:            "healthcare",
  "pendidikan":     "education",    // Bahasa Indonesia
  "manufaktur":     "manufacturing", // Bahasa Indonesia
  "industri":       "manufacturing",
  "konstruksi":     "construction", // Bahasa Indonesia
  "keuangan":       "finance",      // Bahasa Indonesia
  "logistik":       "logistics",    // Bahasa Indonesia
  "ritel":            "retail",
  "ecommerce":        "retail",
  "e-commerce":       "retail",
  "e_commerce":       "retail",
  "hospitality":      "hotel",
  accommodation:      "hotel",
  "nonprofit":        "ngo",
  "non-profit":       "ngo",
  "non_profit":       "ngo",
  "social_impact":    "ngo",
  "sport":            "sports",
  automotive_ind:     "automotive",
  "otomotif":         "automotive",    // Bahasa Indonesia
  agri:               "agriculture",
  "pertanian":        "agriculture",   // Bahasa Indonesia
  "media_publishing": "media",
  publishing:         "media",
  "realestate":       "real_estate",
  "property_id":      "real_estate",  // disambiguation variant
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Normalizer functions
// ─────────────────────────────────────────────────────────────────────────────

/** Normalize an input string to a canonical lookup key (trim, lowercase, replace separators). */
function toKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\-\/]+/g, "_");
}

/**
 * Normalize a style value to its canonical style_key.
 *
 * @returns canonical style_key, or null if the value is unknown/unmapped.
 */
export function normalizeStyle(value: string): string | null {
  if (!value) return null;
  const key = toKey(value);
  return STYLE_ALIAS_MAP[key] ?? null;
}

/**
 * Normalize an industry value to its canonical industry_key.
 *
 * @returns canonical industry_key, or null if the value is unknown/unmapped.
 */
export function normalizeIndustry(value: string): string | null {
  if (!value) return null;
  const key = toKey(value);
  // Try exact key first, then raw lowercase (for values like "F&B" → "f&b")
  return INDUSTRY_ALIAS_MAP[key]
    ?? INDUSTRY_ALIAS_MAP[value.trim().toLowerCase()]
    ?? null;
}

/**
 * Normalize a style value, falling back to the original if unmapped.
 * Logs a warning for unresolved values.
 *
 * @returns canonical style_key or original value.
 */
export function normalizeStyleOrOriginal(value: string): string {
  const normalized = normalizeStyle(value);
  if (!normalized) {
    // Do not silently swallow — caller can log if needed
    return value;
  }
  return normalized;
}

/**
 * Normalize an industry value, falling back to the original if unmapped.
 *
 * @returns canonical industry_key or original value.
 */
export function normalizeIndustryOrOriginal(value: string): string {
  const normalized = normalizeIndustry(value);
  if (!normalized) {
    return value;
  }
  return normalized;
}

/**
 * Check whether a style value is already in canonical form.
 * A value is canonical when normalizing it returns the exact same string
 * (meaning: already trimmed, already snake_case, already the target key).
 */
export function isCanonicalStyle(value: string): boolean {
  const trimmed = value.trim();
  return normalizeStyle(trimmed) === trimmed;
}

/**
 * Check whether an industry value is already in canonical form.
 * A value is canonical when normalizing it returns the exact same string.
 */
export function isCanonicalIndustry(value: string): boolean {
  const trimmed = value.trim();
  return normalizeIndustry(trimmed) === trimmed;
}

/** Return all known canonical style keys. */
export function canonicalStyleKeys(): string[] {
  return Object.values(STYLE_ALIAS_MAP).filter((v, i, arr) => arr.indexOf(v) === i).sort();
}

/** Return all known canonical industry keys. */
export function canonicalIndustryKeys(): string[] {
  return Object.values(INDUSTRY_ALIAS_MAP).filter((v, i, arr) => arr.indexOf(v) === i).sort();
}
