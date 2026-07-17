/**
 * patternAdapter.ts — Team 09 Domain Adapter
 *
 * Adapts the generic template service pattern (GalleryFilter, CRUD, status lifecycle)
 * to the Pattern Library domain. Encapsulates domain rules specific to
 * motifs, textures, repeat behaviors, licensing, and material compatibility.
 *
 * Pure functions — no DB calls. Called by patternService before persistence.
 * Mirrors templateService.GalleryFilter for a consistent filtering API.
 */

// ── GalleryFilter — mirrors templateService.GalleryFilter (pattern domain) ────

export interface PatternGalleryFilter {
  domain?:    string;
  category?:  string;
  style?:     string;
  status?:    string;
  colorizable?: boolean;
  tags?:      string[];
  sortBy?:    "name" | "created_at" | "updated_at" | "domain";
  search?:    string;
  limit?:     number;
  offset?:    number;
}

// ── Public visibility constant ────────────────────────────────────────────────

/** Status values visible to unauthenticated / public callers. */
export const PUBLIC_STATUSES = ["published", "approved"] as const;

export type PublicStatus = typeof PUBLIC_STATUSES[number];

/** Returns true if the given status is publicly visible. */
export function isPublicStatus(status: string): status is PublicStatus {
  return (PUBLIC_STATUSES as readonly string[]).includes(status);
}

// ── MotifAdapter — Cultural metadata rules for traditional motifs ──────────────

/** Domains that carry traditional / indigenous cultural weight and require extra metadata. */
const TRADITIONAL_DOMAINS = ["batik-inspired", "textile"] as const;

/** Protected traditional design terms that require additional human review. */
const PROTECTED_TRADITIONAL_TERMS = ["parang", "truntum", "sidomukti", "sido asih", "kawung"];

export const MotifAdapter = {
  isTraditional(domain: string): boolean {
    return (TRADITIONAL_DOMAINS as readonly string[]).includes(domain);
  },

  /**
   * Validates that traditional motifs carry proper cultural metadata.
   * Batik-inspired requires cultural_origin and a substantive cultural_notes disclaimer.
   */
  validateCulturalMetadata(
    domain: string,
    input: { cultural_origin?: string | null; cultural_notes?: string | null },
  ): void {
    if (domain === "batik-inspired") {
      if (!input.cultural_origin?.trim()) {
        throw new MotifCulturalError(
          "batik-inspired patterns require cultural_origin (e.g. 'Central Java, Indonesia').",
        );
      }
      if (input.cultural_notes && input.cultural_notes.trim().length < 20) {
        throw new MotifCulturalError(
          "cultural_notes must include a substantive disclaimer (minimum 20 characters).",
        );
      }
    }
  },

  /**
   * True if the pattern name references a protected traditional design name
   * that would require additional human review before publishing.
   */
  requiresAdditionalReview(name: string, cultural_origin: string | null | undefined): boolean {
    const lc = name.toLowerCase();
    return PROTECTED_TRADITIONAL_TERMS.some((t) => lc.includes(t)) && !cultural_origin;
  },
};

export class MotifCulturalError extends Error {
  readonly code = "CULTURAL_METADATA_REQUIRED";
  constructor(message: string) { super(message); this.name = "MotifCulturalError"; }
}

// ── TextureAdapter — Material compatibility rules ──────────────────────────────

type ApplicationMaterial = "fabric" | "paper" | "digital" | "print" | "ceramic" | "wood" | "metal" | "interior";

/** Known-compatible materials per domain. Patterns outside this list can still declare
 *  compatibility via design_pattern_compat records — this is the *default* set. */
const TEXTURE_MATERIAL_MATRIX: Record<string, ApplicationMaterial[]> = {
  marble:           ["interior", "ceramic", "print"],
  wood:             ["interior", "fabric", "print"],
  stone:            ["interior", "ceramic", "print"],
  metal:            ["interior", "digital", "print"],
  fabric:           ["fabric", "print", "paper"],
  textile:          ["fabric", "print"],
  floral:           ["fabric", "paper", "print", "digital"],
  geometric:        ["fabric", "paper", "digital", "print", "ceramic"],
  abstract:         ["fabric", "paper", "digital", "print"],
  wave:             ["fabric", "paper", "digital", "print"],
  leaf:             ["fabric", "paper", "print", "digital"],
  "batik-inspired": ["fabric", "paper", "print"],
  packaging:        ["paper", "print"],
  corporate:        ["paper", "digital", "print"],
  luxury:           ["fabric", "paper", "print", "ceramic"],
  interior:         ["interior", "ceramic", "fabric"],
};

export const TextureAdapter = {
  /** Returns the default compatible materials for a domain. Falls back to [digital, print]. */
  getCompatibleMaterials(domain: string): ApplicationMaterial[] {
    return TEXTURE_MATERIAL_MATRIX[domain] ?? ["digital", "print"];
  },

  /** True if this domain is documented as compatible with the given material by default. */
  isCompatible(domain: string, material: ApplicationMaterial): boolean {
    return this.getCompatibleMaterials(domain).includes(material);
  },
};

// ── RepeatBehaviorAdapter — Repeat behavior validation rules ──────────────────

export const RepeatBehaviorAdapter = {
  /**
   * Validates repeat behavior against category.
   * - half-drop/brick are not suited to decoration category.
   * - no-repeat is not suited to textures (textures need tiling).
   */
  validate(repeat_behavior: string, category: string): void {
    if (repeat_behavior === "half-drop" && category === "decoration") {
      throw new RepeatBehaviorError(
        "half-drop repeat is not suitable for decoration; use pattern or motif category.",
      );
    }
    if (repeat_behavior === "no-repeat" && category === "texture") {
      throw new RepeatBehaviorError(
        "no-repeat is not suitable for textures; use tile, half-drop, mirror, or brick.",
      );
    }
  },

  /** Suggested scale values per repeat behavior for guidance in the UI. */
  suggestedScales(repeat_behavior: string): string[] {
    switch (repeat_behavior) {
      case "tile":      return ["sm", "md", "lg"];
      case "half-drop": return ["sm", "md", "lg", "xl"];
      case "mirror":    return ["md", "lg", "xl"];
      case "brick":     return ["sm", "md", "lg"];
      case "no-repeat": return ["xl", "full-bleed"];
      default:          return ["md"];
    }
  },
};

export class RepeatBehaviorError extends Error {
  readonly code = "REPEAT_BEHAVIOR_INVALID";
  constructor(message: string) { super(message); this.name = "RepeatBehaviorError"; }
}

// ── LicensingAdapter — Trademark guard + license field requirements ────────────

/**
 * Rudimentary trademark blocklist.
 * Extend as needed; final review is always done by a human legal reviewer.
 */
export const BLOCKED_TRADEMARK_TERMS = [
  "louis vuitton", "lv", "gucci", "hermes", "hermès", "chanel", "burberry",
  "prada", "versace", "fendi", "dior", "balenciaga", "supreme",
];

export const LicensingAdapter = {
  BLOCKED_TERMS: BLOCKED_TRADEMARK_TERMS,

  /**
   * Validates licensing compliance before any pattern is persisted.
   * Throws LicensingError if compliance fails.
   *
   * Rules:
   * 1. Non-original source_type requires a license identifier.
   * 2. batik-inspired domain requires cultural_origin.
   * 3. No trademark brand names in slug or name.
   */
  assertCompliance(input: {
    name?:           string;
    slug?:           string;
    source_type?:    string;
    license?:        string | null;
    domain?:         string;
    cultural_origin?: string | null;
  }): void {
    const { source_type, license, domain, cultural_origin, name = "", slug = "" } = input;

    // public-domain is inherently license-free; only other non-original types require a license
    if (source_type && source_type !== "original" && source_type !== "public-domain" && !license) {
      throw new LicensingError(
        `Patterns with source_type "${source_type}" must include a license identifier.`,
      );
    }

    if (domain === "batik-inspired" && !cultural_origin) {
      throw new LicensingError(
        "batik-inspired patterns must include cultural_origin (e.g. 'Central Java, Indonesia').",
      );
    }

    const lower = `${name} ${slug}`.toLowerCase();
    for (const term of BLOCKED_TRADEMARK_TERMS) {
      if (lower.includes(term)) {
        throw new LicensingError(
          `Pattern name/slug contains a potentially trademarked term: "${term}". ` +
          "Remove brand references or obtain a valid license.",
        );
      }
    }
  },

  /**
   * True if the pattern's license situation is safe for public display.
   * Original and public-domain patterns are always safe.
   * Others require an explicit license field.
   */
  isPublicSafe(source_type: string, license: string | null): boolean {
    return source_type === "original" || source_type === "public-domain" || license !== null;
  },
};

export class LicensingError extends Error {
  readonly code = "LICENSING_VIOLATION";
  constructor(message: string) { super(message); this.name = "LicensingError"; }
}

// ── MaterialCompatAdapter — Application context / print context rules ─────────

const MIN_DPI_BY_CONTEXT: Record<string, number> = {
  print:      300,
  signage:    150,
  embroidery: 200,
  fabric:     150,
  web:        72,
  digital:    72,
  interior:   96,
  ceramic:    300,
  packaging:  150,
};

export const MaterialCompatAdapter = {
  KNOWN_CONTEXTS: Object.keys(MIN_DPI_BY_CONTEXT),

  /** Recommended minimum DPI for a given application context. */
  suggestMinDPI(context: string): number {
    return MIN_DPI_BY_CONTEXT[context] ?? 72;
  },

  /** Recommended max scale token for a context. High-DPI contexts get xl. */
  suggestMaxScale(context: string): string {
    return ["print", "ceramic", "signage", "embroidery"].includes(context) ? "xl" : "lg";
  },

  /** True if the context string is a known application context. */
  isKnownContext(context: string): boolean {
    return context in MIN_DPI_BY_CONTEXT;
  },
};
