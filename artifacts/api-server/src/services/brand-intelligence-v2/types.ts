/**
 * Brand Intelligence 2.0 — Type Definitions (Team 5)
 *
 * All inference must carry confidence + source evidence.
 * No invented data — low confidence when inputs are sparse.
 */

// ── Sub-profiles ──────────────────────────────────────────────────────────────

export interface VisualLanguageProfile {
  gridSystem: "12-column" | "8pt-grid" | "fluid" | "asymmetric" | "unknown";
  motionPrinciple: "minimal" | "purposeful" | "expressive" | "none" | "unknown";
  contrastStyle: "high-contrast" | "soft" | "monochromatic" | "mixed" | "unknown";
  borderStyle: "sharp" | "rounded" | "pill" | "borderless" | "mixed" | "unknown";
  shadowStyle: "flat" | "soft-shadow" | "dramatic" | "layered" | "unknown";
}

export interface ToneWritingStyleProfile {
  formalityLevel: 1 | 2 | 3 | 4 | 5; // 1 = very casual, 5 = very formal
  formalityLabel: string;
  vocabularyComplexity:
    | "simple"
    | "accessible"
    | "professional"
    | "technical"
    | "academic";
  sentenceStructure: "short-punchy" | "balanced" | "flowing" | "complex";
  ctaStyle: "directive" | "inviting" | "urgent" | "inspirational";
  emotionalRegister: "warm" | "neutral" | "authoritative" | "playful";
  proofTone: "data-driven" | "testimonial" | "narrative" | "aspirational";
  avoidWords: string[];
}

export interface ColorPsychologyEntry {
  color: string; // hex (exact value)
  colorMask: string; // e.g. "#3B****" — safe for public display
  role: "primary" | "secondary" | "accent" | "neutral";
  emotions: string[];
  associations: string[];
  recommendedUsage: string;
  confidence: number; // 0–1
}

export interface TypographyProfile {
  scaleRatioLabel: string; // "Major Third (1.25)"
  scaleRatio: number;
  weightUsage: {
    primary: string; // "700 Bold"
    secondary: string; // "400 Regular"
    accent: string; // "500 Medium"
  };
  lineHeightStyle: "tight" | "normal" | "loose";
  letterSpacingStyle: "tight" | "normal" | "wide";
  fontPairingRationale: string;
  accessibilityScore: number; // 0–100
}

export interface PhotographyStyleDetailed {
  shotTypes: string[]; // ["close-up", "wide-angle", "lifestyle"]
  lightingMood: "studio" | "natural" | "dramatic" | "soft-box" | "mixed";
  colorGrading: "warm" | "cool" | "desaturated" | "vivid" | "natural";
  subjectFocus: "product" | "people" | "environment" | "abstract" | "mixed";
  depthOfField: "shallow" | "deep" | "medium";
  humanPresence: "none" | "minimal" | "featured" | "central";
}

export interface IllustrationStyleDetailed {
  complexity: "minimal" | "moderate" | "detailed" | "intricate";
  strokeWeight: "hairline" | "thin" | "medium" | "bold";
  colorUsage:
    | "monochrome"
    | "duotone"
    | "limited-palette"
    | "full-color";
  culturalReferences: string[];
  dimensionality: "flat" | "isometric" | "3d" | "mixed";
  textureUsage: "none" | "subtle" | "prominent";
}

export interface MaterialStyleInterior {
  materials: string[];
  styleFamily: string; // "Japandi" | "Scandinavian" | "Industrial" | etc.
  lightingApproach:
    | "warm-ambient"
    | "cool-focused"
    | "layered"
    | "natural-forward";
  spacePhilosophy: "maximalist" | "minimalist" | "functional" | "expressive";
  texturePreference: "smooth" | "textured" | "mixed" | "raw";
  colorPalette: string[];
}

export interface MotifStyleFashion {
  patterns: string[]; // ["geometric", "solid", "abstract"]
  silhouette: "structured" | "relaxed" | "fitted" | "oversized" | "draped";
  textiles: string[];
  culturalReferences: string[];
  colorway:
    | "monochromatic"
    | "complementary"
    | "analogous"
    | "neutral"
    | "bold";
  occasions: string[];
}

// ── Creative Memory ───────────────────────────────────────────────────────────

export interface CreativeMemoryEntry {
  key: string;
  insight: string;
  source:
    | "project_history"
    | "brand_kit"
    | "memory"
    | "user_input"
    | "inferred";
  confidence: number; // 0–1
  addedAt: string; // ISO timestamp
}

export interface CreativeMemoryStored {
  keyInsights: CreativeMemoryEntry[];
  crossProjectLearnings: string[];
  preferencePatterns: Array<{
    pattern: string;
    frequency: number; // how many times observed
    confidence: number;
  }>;
  avoidPatterns: string[];
}

// ── Confidence Engine ─────────────────────────────────────────────────────────

export interface DimensionConfidenceEntry {
  score: number; // 0–1
  evidence: string[]; // which input fields drove this inference
  gaps: string[]; // what data is missing
}

export interface DimensionConfidence {
  visualLanguage: DimensionConfidenceEntry;
  toneWriting: DimensionConfidenceEntry;
  colorPsychology: DimensionConfidenceEntry;
  typography: DimensionConfidenceEntry;
  photography: DimensionConfidenceEntry;
  illustration: DimensionConfidenceEntry;
  interior: DimensionConfidenceEntry;
  fashion: DimensionConfidenceEntry;
  creativeMemory: DimensionConfidenceEntry;
  overall: number; // weighted average
}

// ── Recommendation Explanations ───────────────────────────────────────────────

export interface RecommendationExplanation {
  id: string;
  dimension: string;
  recommendation: string;
  evidence: string[];
  confidence: number;
  priority: "critical" | "high" | "medium" | "low";
  expectedImpact: string;
  missingData: string[];
}

// ── Full V2 view ──────────────────────────────────────────────────────────────

export interface BrandIntelligenceV2 {
  clientId: string;
  visualLanguage: VisualLanguageProfile;
  toneWritingStyle: ToneWritingStyleProfile;
  colorPsychologyDetailed: ColorPsychologyEntry[];
  typographyProfile: TypographyProfile;
  photographyStyleDetailed: PhotographyStyleDetailed;
  illustrationStyleDetailed: IllustrationStyleDetailed;
  materialStyleInterior: MaterialStyleInterior;
  motifStyleFashion: MotifStyleFashion;
  creativeMemory: CreativeMemoryStored;
  dimensionConfidence: DimensionConfidence;
  recommendationExplanations: RecommendationExplanation[];
  sourceBrandDnaVersion: string;
  sourceAnalyzedAt: string | null;
  analysisVersion: "v2";
  analyzedAt: string;
}

// Public-safe view — exact hex colors redacted, avoidWords stripped
export type BrandIntelligenceV2Public = Omit<
  BrandIntelligenceV2,
  "clientId" | "colorPsychologyDetailed" | "toneWritingStyle" | "creativeMemory"
> & {
  toneWritingStyle: Omit<ToneWritingStyleProfile, "avoidWords">;
  colorPsychologyDetailed: Array<Omit<ColorPsychologyEntry, "color">>;
  creativeMemory: Omit<CreativeMemoryStored, "avoidPatterns">;
};

// ── Adapter input shape ───────────────────────────────────────────────────────

export interface BrandDnaAdapterInput {
  clientId: string;
  brandPersonality: string[];
  brandVoice: string;
  writingStyle: string;
  photographyStyle: string;
  illustrationStyle: string;
  iconStyle: string;
  layoutStyle: string;
  visualDensity: string;
  spacingStyle: string;
  detectedColors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    palette: string[];
  };
  colorPsychology: string[];
  detectedTypography: {
    heading: string | null;
    body: string | null;
    style: string;
  };
  targetAudience: {
    primary: string;
    secondary: string;
    demographics: string[];
    psychographics: string[];
  };
  industry: string;
  riskProfile: string;
  completenessScore: number;
  consistencyScore: number;
  confidenceScore: number;
  dataSourcesSummary: {
    brandKitSlots: number;
    assetCount: number;
    projectCount: number;
    memoryCount: number;
  };
  memories: Array<{
    key: string;
    value: string;
    category: string;
    source: string;
    confidence: number;
    updatedAt?: string;
  }>;
  projectHistory: Array<{
    projectId: string;
    brandName: string;
    status: string;
    createdAt?: string;
  }>;
}
