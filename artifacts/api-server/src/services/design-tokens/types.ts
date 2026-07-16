// Team 10 — Typography & Color Palette Engine
// All types local to this domain. No edits to shared barrels.

export type FontCategory = "serif" | "sans-serif" | "display" | "monospace" | "handwriting";
export type FontMood =
  | "professional"
  | "playful"
  | "elegant"
  | "modern"
  | "traditional"
  | "bold"
  | "minimal"
  | "friendly";
export type FontLicense = "open" | "commercial" | "custom";
export type WcagLevel = "AA" | "AAA" | "fail";
export type PaletteStyle =
  | "monochromatic"
  | "complementary"
  | "triadic"
  | "analogous"
  | "split-complementary"
  | "tetradic"
  | "custom";

export type TypographyRoleName =
  | "display"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "subtitle"
  | "body"
  | "bodySmall"
  | "caption"
  | "label"
  | "overline"
  | "code";

export type SemanticColorRole =
  | "primary"
  | "primaryDark"
  | "primaryLight"
  | "secondary"
  | "secondaryDark"
  | "secondaryLight"
  | "accent"
  | "background"
  | "surface"
  | "surfaceAlt"
  | "textPrimary"
  | "textSecondary"
  | "textDisabled"
  | "error"
  | "warning"
  | "success"
  | "info"
  | "border"
  | "divider";

export type Industry =
  | "technology"
  | "finance"
  | "healthcare"
  | "education"
  | "creative"
  | "retail"
  | "hospitality"
  | "legal"
  | "nonprofit"
  | "media"
  | "logistics"
  | "manufacturing"
  | "real_estate"
  | "food_beverage"
  | "fashion"
  | "automotive"
  | "general";

// ── Font Pair ────────────────────────────────────────────────────────────────

export interface FontPairRow {
  id: number;
  name: string;
  slug: string;
  displayFont: string;
  bodyFont: string;
  accentFont: string | null;
  category: FontCategory;
  mood: FontMood[];
  industries: Industry[];
  displayFontWeight: string;
  bodyFontWeight: string;
  license: FontLicense;
  pairingRationale: string | null;
  sampleHeading: string;
  sampleBody: string;
  googleFontsUrl: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TypographyRoleRow {
  id: number;
  pairId: number;
  role: TypographyRoleName;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: number;
  textTransform: string | null;
  createdAt: Date;
}

export interface CreateFontPairInput {
  name: string;
  displayFont: string;
  bodyFont: string;
  accentFont?: string;
  category: FontCategory;
  mood: FontMood[];
  industries: Industry[];
  displayFontWeight?: string;
  bodyFontWeight?: string;
  license?: FontLicense;
  pairingRationale?: string;
  sampleHeading?: string;
  sampleBody?: string;
  googleFontsUrl?: string;
}

export interface UpsertTypographyRoleInput {
  role: TypographyRoleName;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  letterSpacing: number;
  textTransform?: string;
}

// ── Color Palette ────────────────────────────────────────────────────────────

export interface ColorPaletteRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  style: PaletteStyle;
  mood: FontMood[];
  industries: Industry[];
  colors: string[];
  printSafe: boolean;
  accessible: boolean;
  wcagLevel: WcagLevel;
  tags: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SemanticColorRoleRow {
  id: number;
  paletteId: number;
  role: SemanticColorRole;
  hexColor: string;
  hslColor: string;
  rgbColor: string;
  cmykColor: string | null;
  printSafeHex: string | null;
  contrastOnWhite: number;
  contrastOnBlack: number;
  wcagAAOnWhite: boolean;
  wcagAAOnBlack: boolean;
  wcagAAAOnWhite: boolean;
  wcagAAAOnBlack: boolean;
  createdAt: Date;
}

export interface CreateColorPaletteInput {
  name: string;
  description?: string;
  style: PaletteStyle;
  mood: FontMood[];
  industries: Industry[];
  colors: string[];
  tags?: string[];
}

export interface UpsertSemanticRoleInput {
  role: SemanticColorRole;
  hexColor: string;
}

// ── Contrast ──────────────────────────────────────────────────────────────────

export interface ContrastResult {
  hex1: string;
  hex2: string;
  ratio: number;
  ratioFormatted: string;
  wcagAA: boolean;
  wcagAALarge: boolean;
  wcagAAA: boolean;
  wcagAAALarge: boolean;
  level: WcagLevel;
}

// ── Print Safe ───────────────────────────────────────────────────────────────

export interface CmykColor {
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface PrintSafeResult {
  originalHex: string;
  cmyk: CmykColor;
  isPrintSafe: boolean;
  printSafeHex: string;
  deltaE: number;
  note: string | null;
}

export interface PrintPaletteResult {
  paletteId: number;
  results: PrintSafeResult[];
  allPrintSafe: boolean;
}

// ── Industry Recommendation ───────────────────────────────────────────────────

export interface IndustryRecommendation {
  industry: Industry;
  recommendedFontPairSlugs: string[];
  recommendedPaletteSlugs: string[];
  rationale: string;
  primaryMood: FontMood;
  avoidMoods: FontMood[];
  colorNotes: string;
  typographyNotes: string;
}

// ── Brand DNA Compatibility ───────────────────────────────────────────────────

export interface BrandDnaInput {
  clientId: string;
  brandPersonality: string[];
  detectedColors: { primary: string | null; palette: string[] };
  confidenceScore: number;
}

export interface CompatibilityScore {
  id: number;
  name: string;
  slug: string;
  score: number;
  reasons: string[];
  warnings: string[];
}
