/**
 * presentationTypes.ts — Phase 4 Presentation Engine
 *
 * Structured specification types for the generic Presentation Engine.
 * Mirrors the pattern used by creativeDocumentService.ts's CreativeDocumentSpec,
 * but is intentionally a SEPARATE type tree — presentations are not documents.
 */

// ── Presentation type union ───────────────────────────────────────────────────

export type CreativePresentationType = "pitch_deck";

// ── Theme ──────────────────────────────────────────────────────────────────────

export interface PresentationTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  headingFont?: string;
  bodyFont?: string;
  logoAssetUrl?: string;
}

export const DEFAULT_PRESENTATION_THEME: PresentationTheme = {
  primaryColor: "#4338CA",
  secondaryColor: "#1E1B4B",
  accentColor: "#F59E0B",
  backgroundColor: "#FFFFFF",
  textColor: "#111827",
  mutedTextColor: "#6B7280",
};

// ── Metric / timeline / comparison / market sub-shapes ────────────────────────

export interface SlideMetric {
  label: string;
  value: string;
  note?: string;
}

export interface SlideTimelineItem {
  period: string;
  title: string;
  description?: string;
}

export interface SlideComparisonRow {
  label: string;
  us: string;
  competitor: string;
}

export interface SlideChartSpec {
  chartType: "bar" | "line" | "pie";
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
  isProjection?: boolean;
  sourceNote?: string;
}

export interface SlideImageSpec {
  buffer: Buffer | null;
  caption?: string;
  fit?: "contain" | "cover";
}

// ── Slide spec union ───────────────────────────────────────────────────────────

interface SlideBase {
  title?: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  image?: SlideImageSpec;
  logo?: SlideImageSpec;
  sourceNotes?: string;
  speakerNotes?: string;
}

export interface CoverSlide extends SlideBase {
  kind: "cover";
  title: string;
}
export interface SectionSlide extends SlideBase {
  kind: "section";
  title: string;
}
export interface ContentSlide extends SlideBase {
  kind: "content";
  title: string;
}
export interface ProblemSlide extends SlideBase {
  kind: "problem";
  title: string;
}
export interface SolutionSlide extends SlideBase {
  kind: "solution";
  title: string;
}
export interface MetricsSlide extends SlideBase {
  kind: "metrics";
  title: string;
  metrics: SlideMetric[];
}
export interface TimelineSlide extends SlideBase {
  kind: "timeline";
  title: string;
  items: SlideTimelineItem[];
}
export interface ComparisonSlide extends SlideBase {
  kind: "comparison";
  title: string;
  rows: SlideComparisonRow[];
}
export interface MarketSlide extends SlideBase {
  kind: "market";
  title: string;
  chart?: SlideChartSpec;
}
export interface TeamSlide extends SlideBase {
  kind: "team";
  title: string;
  members: Array<{ name: string; role: string; bio?: string }>;
}
export interface FinancialSlide extends SlideBase {
  kind: "financial";
  title: string;
  chart?: SlideChartSpec;
  metrics?: SlideMetric[];
}
export interface AskSlide extends SlideBase {
  kind: "ask";
  title: string;
}
export interface ClosingSlide extends SlideBase {
  kind: "closing";
  title: string;
}

export type PresentationSlideSpec =
  | CoverSlide
  | SectionSlide
  | ContentSlide
  | ProblemSlide
  | SolutionSlide
  | MetricsSlide
  | TimelineSlide
  | ComparisonSlide
  | MarketSlide
  | TeamSlide
  | FinancialSlide
  | AskSlide
  | ClosingSlide;

// ── Full spec ──────────────────────────────────────────────────────────────────

export interface CreativePresentationSpec {
  presentationType: CreativePresentationType;
  title: string;
  subtitle?: string;
  companyName?: string;
  theme: PresentationTheme;
  slides: PresentationSlideSpec[];
  metadata?: Record<string, unknown>;
}

// ── Generation report ──────────────────────────────────────────────────────────

export interface SlideGenerationNote {
  slideId: string;
  included: boolean;
  reason?: string;
}

export interface PresentationGenerationReport {
  presentationType: CreativePresentationType;
  slidesIncluded: string[];
  slidesSkipped: SlideGenerationNote[];
  continuationSlidesCreated: number;
  imagesEmbedded: number;
  imagesFailed: number;
}
