/**
 * Brand Intelligence 2.0 — Confidence Engine (Team 5)
 *
 * Aggregates per-dimension confidence entries into a unified
 * DimensionConfidence object with weighted overall score.
 * Generates recommendation explanations keyed to confidence gaps.
 *
 * Pure functions. Deterministic. No side effects.
 */
import type {
  DimensionConfidence,
  DimensionConfidenceEntry,
  RecommendationExplanation,
} from "./types.js";

// Dimension weights (must sum to 1.0)
const WEIGHTS: Record<keyof Omit<DimensionConfidence, "overall">, number> = {
  visualLanguage: 0.15,
  toneWriting: 0.15,
  colorPsychology: 0.15,
  typography: 0.10,
  photography: 0.10,
  illustration: 0.10,
  interior: 0.10,
  fashion: 0.10,
  creativeMemory: 0.05,
};

export function computeDimensionConfidence(entries: {
  visualLanguage: DimensionConfidenceEntry;
  toneWriting: DimensionConfidenceEntry;
  colorPsychology: DimensionConfidenceEntry;
  typography: DimensionConfidenceEntry;
  photography: DimensionConfidenceEntry;
  illustration: DimensionConfidenceEntry;
  interior: DimensionConfidenceEntry;
  fashion: DimensionConfidenceEntry;
  creativeMemory: DimensionConfidenceEntry;
}): DimensionConfidence {
  let overall = 0;
  const dims = entries as Record<string, DimensionConfidenceEntry>;
  for (const [dim, weight] of Object.entries(WEIGHTS)) {
    overall += (dims[dim]?.score ?? 0) * weight;
  }

  return {
    ...entries,
    overall: parseFloat(overall.toFixed(3)),
  };
}

// ── Recommendation Explanations ───────────────────────────────────────────────

interface DimSpec {
  key: keyof Omit<DimensionConfidence, "overall">;
  label: string;
  criticalThreshold: number;
  highThreshold: number;
  recommendations: {
    condition: (entry: DimensionConfidenceEntry) => boolean;
    recommendation: string;
    expectedImpact: string;
  }[];
}

const DIMENSION_SPECS: DimSpec[] = [
  {
    key: "visualLanguage",
    label: "Visual Language",
    criticalThreshold: 0.2,
    highThreshold: 0.5,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("layoutStyle"),
        recommendation: "Define a layout style (Corporate, Minimal, Editorial) in the Brand Kit to unlock grid system inference.",
        expectedImpact: "Enables consistent grid system and spacing application across all creatives.",
      },
      {
        condition: (e) => e.gaps.includes("riskProfile"),
        recommendation: "Set brand risk profile (Conservative / Moderate / Innovative) to determine motion and shadow principles.",
        expectedImpact: "Aligns digital motion design and visual depth with brand personality.",
      },
    ],
  },
  {
    key: "toneWriting",
    label: "Tone & Writing Style",
    criticalThreshold: 0.2,
    highThreshold: 0.5,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("brandVoice"),
        recommendation: "Add a Brand Voice entry (e.g., 'Formal', 'Conversational') to the brand memory.",
        expectedImpact: "Unlocks formality calibration for all copy generated under this brand.",
      },
      {
        condition: (e) => e.gaps.includes("writingStyle"),
        recommendation: "Define writing style preference (Corporate, Editorial, Technical, Narrative).",
        expectedImpact: "Improves sentence structure and vocabulary complexity inference.",
      },
    ],
  },
  {
    key: "colorPsychology",
    label: "Color Psychology",
    criticalThreshold: 0.15,
    highThreshold: 0.4,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("detectedColors"),
        recommendation: "Upload brand color palette to the Brand Kit (primary, secondary, accent).",
        expectedImpact: "Enables per-color psychological analysis and usage guidance across all creatives.",
      },
    ],
  },
  {
    key: "typography",
    label: "Typography Profile",
    criticalThreshold: 0.2,
    highThreshold: 0.5,
    recommendations: [
      {
        condition: (e) =>
          e.gaps.includes("detectedTypography.heading") || e.gaps.includes("detectedTypography.body"),
        recommendation: "Upload brand fonts (heading and body typefaces) to the Brand Kit.",
        expectedImpact: "Enables scale ratio, weight usage, and accessibility score computation.",
      },
      {
        condition: (e) => e.gaps.includes("detectedTypography.style"),
        recommendation: "Tag typography style (Geometric, Humanist, Slab, Modern) in brand memory.",
        expectedImpact: "Improves typographic scale ratio and pairing rationale accuracy.",
      },
    ],
  },
  {
    key: "photography",
    label: "Photography Style",
    criticalThreshold: 0.2,
    highThreshold: 0.4,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("photographyStyle"),
        recommendation: "Define photography style (Studio, Lifestyle, Editorial, Product) in Brand Kit.",
        expectedImpact: "Enables shot type, lighting mood, and color grading guidance for photo briefs.",
      },
    ],
  },
  {
    key: "illustration",
    label: "Illustration Style",
    criticalThreshold: 0.2,
    highThreshold: 0.4,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("illustrationStyle"),
        recommendation: "Define illustration style (Flat, Isometric, 3D, Hand-drawn) in Brand Kit.",
        expectedImpact: "Enables complexity, stroke weight, and dimensionality guidance for design briefs.",
      },
    ],
  },
  {
    key: "interior",
    label: "Interior Material & Style",
    criticalThreshold: 0.15,
    highThreshold: 0.35,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("brandPersonality"),
        recommendation: "Complete brand personality tags (at least 2–3 traits) to infer interior style family.",
        expectedImpact: "Unlocks material palette and space philosophy for interior and spatial applications.",
      },
    ],
  },
  {
    key: "fashion",
    label: "Fashion Motif & Style",
    criticalThreshold: 0.15,
    highThreshold: 0.35,
    recommendations: [
      {
        condition: (e) => e.gaps.includes("brandPersonality"),
        recommendation: "Complete brand personality tags to infer fashion silhouette, patterns, and textiles.",
        expectedImpact: "Enables merchandise, uniform, and lifestyle product style guidance.",
      },
    ],
  },
  {
    key: "creativeMemory",
    label: "Creative Memory",
    criticalThreshold: 0.1,
    highThreshold: 0.3,
    recommendations: [
      {
        condition: (e) =>
          e.gaps.includes("memories") || e.gaps.includes("projectHistory"),
        recommendation: "Complete at least one project under this brand to build cross-project creative memory.",
        expectedImpact: "Enables preference pattern learning and avoidance pattern tracking across engagements.",
      },
    ],
  },
];

export function generateRecommendationExplanations(
  confidence: DimensionConfidence,
): RecommendationExplanation[] {
  const explanations: RecommendationExplanation[] = [];
  let idCounter = 1;

  for (const spec of DIMENSION_SPECS) {
    const entry = confidence[spec.key];
    if (!entry) continue;

    for (const rec of spec.recommendations) {
      if (!rec.condition(entry)) continue;

      const priority: RecommendationExplanation["priority"] =
        entry.score < spec.criticalThreshold
          ? "critical"
          : entry.score < spec.highThreshold
          ? "high"
          : "medium";

      explanations.push({
        id: `rec-${String(idCounter++).padStart(3, "0")}`,
        dimension: spec.label,
        recommendation: rec.recommendation,
        evidence: entry.evidence,
        confidence: entry.score,
        priority,
        expectedImpact: rec.expectedImpact,
        missingData: entry.gaps,
      });
    }
  }

  // Sort: critical → high → medium → low
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  explanations.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  return explanations;
}
