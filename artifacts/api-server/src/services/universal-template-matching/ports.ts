/**
 * Universal Template Matching — Port Interfaces (Dependency Inversion Layer)
 *
 * The scoring engine NEVER imports from @workspace/db or queries domain tables
 * directly. Instead it reads data through these ports. Adapters (adapters.ts)
 * implement the ports using whatever backing store is appropriate.
 *
 * This pattern allows the engine to be tested with in-memory fakes and
 * extended to new domains without changing the scoring logic.
 */

// ── Blueprint ────────────────────────────────────────────────────────────────

/**
 * A Blueprint is the abstract representation of a template/design that the
 * scoring engine can evaluate. It carries enough metadata for all scoring
 * dimensions but hides the underlying DB row shape.
 */
export interface Blueprint {
  /** Stable identifier (e.g. template code or UUID) */
  id: string;
  /** Human-readable name */
  name: string;
  /** High-level category: "Company Profile" | "Pitch Deck" | "Social Post" | ... */
  category: string;
  /**
   * Service type codes this blueprint supports.
   * e.g. ["CP", "BRANDING"] — empty = universal.
   */
  serviceTypes: string[];
  /**
   * Domain tags. e.g. ["creative", "marketing", "legal"].
   * Empty = cross-domain.
   */
  domains: string[];
  /** Industries this blueprint is optimised for. Empty = cross-industry. */
  industries: string[];
  /** Target audience descriptors. e.g. ["B2B", "enterprise", "SME"] */
  audiences: string[];
  /** Style descriptors. e.g. ["modern", "minimalist", "bold"] */
  styles: string[];
  /** Output formats supported. e.g. ["pdf", "pptx", "png"] */
  outputFormats: string[];
  /** Package tiers supported. e.g. ["starter", "standard", "professional", "enterprise"] */
  supportedPackages: string[];
  /** Brand personality tags. e.g. ["professional", "innovative"] */
  personalities: string[];
  /** Brand voice tags. e.g. ["formal", "conversational"] */
  voices: string[];
  /** Primary color family hex (first 2 chars used for hue comparison). null = no preference. */
  primaryColorHex: string | null;
  /** Whether this blueprint is currently available for selection. */
  published: boolean;
  /** Admin-curated quality signal (boosts score slightly). */
  featured: boolean;
  /** Usage count — higher = more proven. Used for tiebreaking. */
  usageCount: number;
  /** Hard constraints this blueprint CANNOT satisfy. */
  unsupportedConstraints: string[];
  /** Free-text keywords extracted from description for brief matching. */
  keywords: string[];
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * A Component is a reusable building block (header, footer, chart, callout, etc.)
 * that can be composed into a Blueprint. Components are read to enrich the
 * blueprint's scoring context — e.g. checking if required components exist.
 */
export interface Component {
  id: string;
  name: string;
  componentType: string; // "header" | "footer" | "chart" | "hero" | "callout" | ...
  compatibleCategories: string[];
  compatibleStyles: string[];
  outputFormats: string[];
}

// ── Pattern ───────────────────────────────────────────────────────────────────

/**
 * A Pattern is a validated design/content convention (layout grid, writing
 * structure, visual rhythm) associated with a service type or domain.
 * Patterns inform scoring by confirming a blueprint follows best practice.
 */
export interface Pattern {
  id: string;
  name: string;
  patternType: string; // "layout" | "content-structure" | "visual-rhythm" | ...
  applicableServiceTypes: string[];
  applicableDomains: string[];
  recommendedStyles: string[];
}

// ── Token Library ─────────────────────────────────────────────────────────────

/**
 * A Token Library entry carries brand design tokens (colors, typography, spacing)
 * associated with an industry or style family. Used to validate color/typography
 * alignment between a brief's Brand DNA and a blueprint's visual system.
 */
export interface TokenLibraryEntry {
  id: string;
  industry: string;
  style: string;
  primaryColorFamily: string; // 2-char hex prefix, e.g. "1a"
  secondaryColorFamily: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  typographyStyle: string; // "serif" | "sans-serif" | "display" | "monospace"
}

// ── Port Interfaces ───────────────────────────────────────────────────────────

/** Provides Blueprint candidates for scoring. */
export interface BlueprintPort {
  /**
   * List published blueprints optionally filtered by category or service type.
   * Must return only published (non-archived) blueprints.
   * @param limit Max candidates to return (default 200).
   */
  listCandidates(opts?: {
    category?: string;
    serviceType?: string;
    limit?: number;
  }): Promise<Blueprint[]>;

  /** Get a single blueprint by ID. Returns null if not found/unpublished. */
  getById(id: string): Promise<Blueprint | null>;
}

/** Provides Component metadata for scoring enrichment. */
export interface ComponentPort {
  /** List components compatible with a given category. */
  listByCategory(category: string): Promise<Component[]>;
}

/** Provides Pattern metadata for scoring enrichment. */
export interface PatternPort {
  /** List patterns applicable to a given service type. */
  listByServiceType(serviceType: string): Promise<Pattern[]>;
}

/** Provides Token Library entries for color/typography scoring. */
export interface TokenLibraryPort {
  /** Get token entry for an industry+style combination. Returns null if unknown. */
  getEntry(industry: string, style: string): Promise<TokenLibraryEntry | null>;
  /** List all token entries for an industry (all styles). */
  listByIndustry(industry: string): Promise<TokenLibraryEntry[]>;
}

// ── Dependency Container ──────────────────────────────────────────────────────

/** All ports the matching engine depends on, injected at construction time. */
export interface MatchingDeps {
  blueprints: BlueprintPort;
  components: ComponentPort;
  patterns: PatternPort;
  tokenLibrary: TokenLibraryPort;
}
