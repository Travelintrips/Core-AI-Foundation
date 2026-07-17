/**
 * Universal Template Matching — Public Input / Output Types
 *
 * These are the shapes the API layer and callers use. They are deliberately
 * decoupled from the Blueprint port model so the API contract is stable even
 * if internal data structures change.
 */

// ── Input ────────────────────────────────────────────────────────────────────

/**
 * Brand DNA snapshot supplied by the caller.
 * All fields are optional — the engine grades confidence based on richness.
 */
export interface BriefBrandDna {
  personalities?: string[];    // e.g. ["professional", "innovative"]
  voice?: string;              // e.g. "formal"
  writingStyle?: string;       // e.g. "concise"
  primaryColorHex?: string;    // e.g. "#1a2b3c"
  headingFont?: string;
  bodyFont?: string;
  typographyStyle?: string;    // "serif" | "sans-serif" | "display"
  colorPsychology?: string[];  // e.g. ["trust", "growth"]
}

/**
 * Full input to the Universal Template Matching engine.
 *
 * At minimum, one of serviceType, domain, or category must be provided.
 * All other fields are optional — the engine degrades gracefully and
 * reports lower confidence when fewer signals are supplied.
 */
export interface MatchInput {
  /** Service code. e.g. "CP" (Company Profile), "PITCH", "BRANDING" */
  serviceType?: string;
  /** Domain tag. e.g. "creative", "marketing", "legal", "logistics" */
  domain?: string;
  /** Explicit category override. e.g. "Company Profile", "Pitch Deck" */
  category?: string;
  /** Free-text brief. Tokenised into keywords for overlap scoring. */
  brief?: string;
  /** Brand DNA snapshot. */
  brandDna?: BriefBrandDna;
  /** Industry. e.g. "logistics", "technology", "retail" */
  industry?: string;
  /** Target audience descriptors. e.g. ["enterprise", "B2B"] */
  audience?: string[];
  /** Required output formats. e.g. ["pdf", "pptx"] */
  output?: string[];
  /** Package tier. e.g. "starter", "standard", "professional", "enterprise" */
  package?: string;
  /** Style preferences. e.g. ["modern", "minimalist"] */
  style?: string[];
  /**
   * Hard constraints that a blueprint must satisfy.
   * e.g. ["bilingual", "print-ready", "dark-mode"]
   * A blueprint explicitly listing a constraint as unsupported is rejected.
   */
  constraints?: string[];
  /** Limit top recommendations returned (default 5, max 20). */
  limit?: number;
}

// ── Score Breakdown ───────────────────────────────────────────────────────────

/** Per-dimension scoring result. */
export interface ScoreDimension {
  /** Scoring dimension label. */
  dimension: string;
  /** Points awarded. */
  awarded: number;
  /** Maximum possible for this dimension. */
  maximum: number;
  /** Whether this dimension contributed to the score. */
  matched: boolean;
  /** Human-readable explanation of what matched (or why not). */
  explanation: string;
}

/** Full score breakdown for one blueprint candidate. */
export interface ScoreBreakdown {
  dimensions: ScoreDimension[];
  /** Sum of awarded points across all dimensions. */
  totalScore: number;
  /** Max possible score given the inputs provided (used to compute confidence). */
  maxPossibleScore: number;
}

// ── Output ───────────────────────────────────────────────────────────────────

/** A single ranked recommendation. */
export interface MatchRecommendation {
  /** Blueprint identifier. */
  blueprintId: string;
  /** Blueprint display name. */
  blueprintName: string;
  /** Category / type. */
  category: string;
  /** Normalised score 0–100. */
  score: number;
  /** Confidence in the recommendation 0–1. Reflects input richness. */
  confidence: number;
  /** Top reasons this blueprint was recommended (human-readable). */
  reasons: string[];
  /** Full per-dimension breakdown. */
  breakdown: ScoreBreakdown;
  /** Styles this blueprint supports. */
  styles: string[];
  /** Output formats this blueprint supports. */
  outputFormats: string[];
  /** Whether this is an admin-featured blueprint. */
  featured: boolean;
}

/** A blueprint that was evaluated but rejected, with the reason. */
export interface RejectedBlueprint {
  blueprintId: string;
  blueprintName: string;
  rejectionReason: string;
  /** Score it would have had before constraint rejection (diagnostic). */
  rawScoreBeforeRejection: number;
}

/** The complete matching result. */
export interface MatchResult {
  /** Top recommendation (highest score). null if no compatible blueprint found. */
  topRecommendation: MatchRecommendation | null;
  /** Ranked alternatives (excluding top, up to limit-1). */
  alternatives: MatchRecommendation[];
  /** Blueprints that were evaluated but hard-rejected due to constraints. */
  rejected: RejectedBlueprint[];
  /**
   * Overall confidence 0–1 in the result set.
   * Derived from: input richness × top-score normalisation.
   */
  confidence: number;
  /**
   * Human-readable summary of the matching result.
   * Explains why the top recommendation was chosen, or why nothing matched.
   */
  explanation: string;
  /** Number of blueprint candidates evaluated. */
  candidatesEvaluated: number;
  /** Input signals actually used (non-empty fields). */
  signalsUsed: string[];
  /** Signals not provided — more detail would increase confidence. */
  signalsMissing: string[];
}
