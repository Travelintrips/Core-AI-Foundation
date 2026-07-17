/**
 * Brand Intelligence 2.0 — Deterministic Extractors (Team 5)
 *
 * Pure functions only. No side effects. No randomness. No LLM calls.
 * Same inputs → same outputs always.
 * Evidence arrays track exactly which input fields drove each inference.
 */
import type {
  BrandDnaAdapterInput,
  VisualLanguageProfile,
  ToneWritingStyleProfile,
  ColorPsychologyEntry,
  TypographyProfile,
  PhotographyStyleDetailed,
  IllustrationStyleDetailed,
  MaterialStyleInterior,
  MotifStyleFashion,
  CreativeMemoryEntry,
  CreativeMemoryStored,
  DimensionConfidenceEntry,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function lower(s: string): string {
  return (s ?? "").toLowerCase().trim();
}

function hasPersonality(input: BrandDnaAdapterInput, ...traits: string[]): boolean {
  return traits.some((t) =>
    input.brandPersonality.some((p) => lower(p).includes(lower(t))),
  );
}

function maskHex(hex: string): string {
  const h = hex.replace("#", "").toUpperCase();
  if (h.length < 6) return "#??????";
  return `#${h.slice(0, 2)}****`;
}

// ── Visual Language ───────────────────────────────────────────────────────────

export function extractVisualLanguage(input: BrandDnaAdapterInput): {
  profile: VisualLanguageProfile;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];

  // Grid system
  let gridSystem: VisualLanguageProfile["gridSystem"] = "unknown";
  const layout = lower(input.layoutStyle);
  const spacing = lower(input.spacingStyle);
  if (layout.includes("corporate") || layout.includes("e-commerce")) {
    gridSystem = "12-column";
    evidence.push("layoutStyle");
  } else if (layout.includes("editorial") || layout.includes("landing")) {
    gridSystem = "fluid";
    evidence.push("layoutStyle");
  } else if (layout.includes("minimal") || spacing.includes("compact")) {
    gridSystem = "8pt-grid";
    evidence.push("layoutStyle", "spacingStyle");
  } else if (hasPersonality(input, "Asymmetric", "Experimental")) {
    gridSystem = "asymmetric";
    evidence.push("brandPersonality");
  } else if (spacing.includes("compact")) {
    gridSystem = "8pt-grid";
    evidence.push("spacingStyle");
  } else {
    gaps.push("layoutStyle");
  }

  // Motion principle
  let motionPrinciple: VisualLanguageProfile["motionPrinciple"] = "unknown";
  const risk = lower(input.riskProfile);
  if (risk.includes("conservative")) {
    motionPrinciple = "minimal";
    evidence.push("riskProfile");
  } else if (risk.includes("innovative")) {
    motionPrinciple = hasPersonality(input, "Energetic", "Dynamic")
      ? "expressive"
      : "purposeful";
    evidence.push("riskProfile", "brandPersonality");
  } else if (risk.includes("moderate")) {
    motionPrinciple = "purposeful";
    evidence.push("riskProfile");
  } else {
    gaps.push("riskProfile");
  }

  // Contrast style
  let contrastStyle: VisualLanguageProfile["contrastStyle"] = "unknown";
  const density = lower(input.visualDensity);
  if (density.includes("dense")) {
    contrastStyle = "high-contrast";
    evidence.push("visualDensity");
  } else if (density.includes("airy")) {
    contrastStyle = "soft";
    evidence.push("visualDensity");
  } else if (density.includes("balanced")) {
    contrastStyle = "mixed";
    evidence.push("visualDensity");
  } else if (hasPersonality(input, "Monochromatic", "Minimalist")) {
    contrastStyle = "monochromatic";
    evidence.push("brandPersonality");
  } else {
    gaps.push("visualDensity");
  }

  // Border style
  let borderStyle: VisualLanguageProfile["borderStyle"] = "unknown";
  if (hasPersonality(input, "Corporate", "Industrial", "Technical")) {
    borderStyle = "sharp";
    evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Luxury", "Elegant", "Premium")) {
    borderStyle = "rounded";
    evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Friendly", "Playful", "Fun")) {
    borderStyle = "pill";
    evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Minimalist", "Modern")) {
    borderStyle = "borderless";
    evidence.push("brandPersonality");
  } else if (input.brandPersonality.length > 0) {
    borderStyle = "mixed";
    evidence.push("brandPersonality");
  } else {
    gaps.push("brandPersonality");
  }

  // Shadow style
  let shadowStyle: VisualLanguageProfile["shadowStyle"] = "unknown";
  if (risk.includes("conservative") || hasPersonality(input, "Minimal", "Flat")) {
    shadowStyle = "flat";
    evidence.push("riskProfile");
  } else if (risk.includes("innovative") || hasPersonality(input, "Modern", "Tech")) {
    shadowStyle = "layered";
    evidence.push("riskProfile");
  } else if (hasPersonality(input, "Luxury", "Premium")) {
    shadowStyle = "dramatic";
    evidence.push("brandPersonality");
  } else if (risk.includes("moderate")) {
    shadowStyle = "soft-shadow";
    evidence.push("riskProfile");
  } else {
    gaps.push("riskProfile");
  }

  const evidenceUniq = [...new Set(evidence)];
  const score = evidenceUniq.length > 0
    ? Math.min(0.3 + evidenceUniq.length * 0.12, 0.95)
    : 0.1;

  return {
    profile: { gridSystem, motionPrinciple, contrastStyle, borderStyle, shadowStyle },
    confidence: { score: parseFloat(score.toFixed(3)), evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}

// ── Tone & Writing Style ──────────────────────────────────────────────────────

const FORMALITY_LABELS: Record<number, string> = {
  1: "Very Casual",
  2: "Casual",
  3: "Balanced",
  4: "Professional",
  5: "Very Formal",
};

export function extractToneWritingStyle(input: BrandDnaAdapterInput): {
  profile: ToneWritingStyleProfile;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];
  const voice = lower(input.brandVoice);
  const writing = lower(input.writingStyle);
  const industry = lower(input.industry);
  const psychographics = input.targetAudience.psychographics.map(lower).join(" ");

  // Formality level
  let formalityLevel: 1 | 2 | 3 | 4 | 5 = 3;
  if (voice.includes("very formal") || voice.includes("executive")) {
    formalityLevel = 5; evidence.push("brandVoice");
  } else if (voice.includes("formal") || voice.includes("professional")) {
    formalityLevel = 4; evidence.push("brandVoice");
  } else if (voice.includes("casual") || voice.includes("conversational")) {
    formalityLevel = 2; evidence.push("brandVoice");
  } else if (voice.includes("very casual") || voice.includes("playful")) {
    formalityLevel = 1; evidence.push("brandVoice");
  } else if (voice) {
    formalityLevel = 3; evidence.push("brandVoice");
  } else {
    gaps.push("brandVoice");
  }

  // Vocabulary complexity
  let vocabularyComplexity: ToneWritingStyleProfile["vocabularyComplexity"] = "professional";
  if (writing.includes("technical") || industry.includes("tech") || industry.includes("engineer")) {
    vocabularyComplexity = "technical"; evidence.push("writingStyle", "industry");
  } else if (writing.includes("academic") || industry.includes("research")) {
    vocabularyComplexity = "academic"; evidence.push("writingStyle");
  } else if (writing.includes("simple") || writing.includes("clear") || formalityLevel <= 2) {
    vocabularyComplexity = "accessible"; evidence.push("writingStyle");
  } else if (writing.includes("corporate") || formalityLevel >= 4) {
    vocabularyComplexity = "professional"; evidence.push("writingStyle");
  } else {
    gaps.push("writingStyle");
  }

  // Sentence structure
  let sentenceStructure: ToneWritingStyleProfile["sentenceStructure"] = "balanced";
  if (writing.includes("editorial") || writing.includes("narrative")) {
    sentenceStructure = "flowing"; evidence.push("writingStyle");
  } else if (writing.includes("headline") || writing.includes("punchy")) {
    sentenceStructure = "short-punchy"; evidence.push("writingStyle");
  } else if (vocabularyComplexity === "academic" || vocabularyComplexity === "technical") {
    sentenceStructure = "complex"; evidence.push("vocabularyComplexity");
  } else {
    sentenceStructure = "balanced";
  }

  // CTA style
  let ctaStyle: ToneWritingStyleProfile["ctaStyle"] = "inviting";
  const risk = lower(input.riskProfile);
  if (risk.includes("innovative") || hasPersonality(input, "Energetic", "Bold")) {
    ctaStyle = "directive"; evidence.push("riskProfile");
  } else if (risk.includes("conservative") || hasPersonality(input, "Trustworthy", "Reliable")) {
    ctaStyle = "inviting"; evidence.push("riskProfile");
  } else if (hasPersonality(input, "Inspirational", "Visionary")) {
    ctaStyle = "inspirational"; evidence.push("brandPersonality");
  } else if (industry.includes("retail") || industry.includes("e-commerce")) {
    ctaStyle = "urgent"; evidence.push("industry");
  }

  // Emotional register
  let emotionalRegister: ToneWritingStyleProfile["emotionalRegister"] = "neutral";
  if (psychographics.includes("emotion") || psychographics.includes("aspir") || hasPersonality(input, "Warm", "Empathetic")) {
    emotionalRegister = "warm"; evidence.push("targetAudience.psychographics");
  } else if (formalityLevel >= 4 && !hasPersonality(input, "Friendly")) {
    emotionalRegister = "authoritative"; evidence.push("formalityLevel");
  } else if (hasPersonality(input, "Playful", "Fun", "Youthful")) {
    emotionalRegister = "playful"; evidence.push("brandPersonality");
  }

  // Proof tone
  let proofTone: ToneWritingStyleProfile["proofTone"] = "narrative";
  if (industry.includes("tech") || industry.includes("consul") || industry.includes("finance")) {
    proofTone = "data-driven"; evidence.push("industry");
  } else if (industry.includes("luxury") || industry.includes("fashion") || industry.includes("lifestyle")) {
    proofTone = "aspirational"; evidence.push("industry");
  } else if (hasPersonality(input, "Community", "Social")) {
    proofTone = "testimonial"; evidence.push("brandPersonality");
  } else {
    proofTone = "narrative";
  }

  // Avoid words (inferred from formality + personality)
  const avoidWords: string[] = [];
  if (formalityLevel >= 4) avoidWords.push("awesome", "guys", "super", "literally");
  if (hasPersonality(input, "Luxury", "Premium")) avoidWords.push("cheap", "budget", "discount");
  if (hasPersonality(input, "Technical")) avoidWords.push("easy", "simple", "basic");

  const evidenceUniq = [...new Set(evidence)];
  const score = evidenceUniq.length > 0
    ? Math.min(0.25 + evidenceUniq.length * 0.1, 0.9)
    : 0.1;

  return {
    profile: {
      formalityLevel,
      formalityLabel: FORMALITY_LABELS[formalityLevel],
      vocabularyComplexity,
      sentenceStructure,
      ctaStyle,
      emotionalRegister,
      proofTone,
      avoidWords,
    },
    confidence: { score: parseFloat(score.toFixed(3)), evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}

// ── Color Psychology (detailed) ───────────────────────────────────────────────

const COLOR_EMOTION_MAP: Array<{
  test: (r: number, g: number, b: number) => boolean;
  emotions: string[];
  associations: string[];
  recommendedUsage: string;
}> = [
  {
    test: (r, g, b) => b > r + 30 && b > g + 30,
    emotions: ["Trust", "Calm", "Stability"],
    associations: ["Reliability", "Professionalism", "Technology"],
    recommendedUsage: "Primary brand color for credibility and trust-building",
  },
  {
    test: (r, g, b) => r > 180 && g < 100 && b < 100,
    emotions: ["Energy", "Passion", "Urgency"],
    associations: ["Action", "Power", "Excitement"],
    recommendedUsage: "Call-to-action accents and high-emphasis moments",
  },
  {
    test: (r, g, b) => g > r + 30 && g > b + 30,
    emotions: ["Growth", "Balance", "Harmony"],
    associations: ["Nature", "Health", "Sustainability"],
    recommendedUsage: "Secondary emphasis and environmental storytelling",
  },
  {
    test: (r, g, b) => r > 150 && g > 150 && b < 80,
    emotions: ["Optimism", "Creativity", "Warmth"],
    associations: ["Energy", "Friendliness", "Innovation"],
    recommendedUsage: "Highlight and accent for approachable interactions",
  },
  {
    test: (r, g, b) => r < 60 && g < 60 && b < 60,
    emotions: ["Sophistication", "Authority", "Elegance"],
    associations: ["Luxury", "Power", "Exclusivity"],
    recommendedUsage: "Premium backgrounds and high-contrast type",
  },
  {
    test: (r, g, b) => r > 200 && g > 200 && b > 200,
    emotions: ["Clarity", "Openness", "Purity"],
    associations: ["Cleanliness", "Space", "Simplicity"],
    recommendedUsage: "Backgrounds and whitespace to create breathing room",
  },
  {
    test: (r, g, b) => r > 120 && g > 70 && b < 50 && r > g,
    emotions: ["Stability", "Warmth", "Reliability"],
    associations: ["Craftsmanship", "Heritage", "Grounding"],
    recommendedUsage: "Supporting tones for warmth and approachability",
  },
  {
    test: (r, g, b) => r > 150 && b > 150 && g < 120,
    emotions: ["Creativity", "Royalty", "Mystery"],
    associations: ["Luxury", "Imagination", "Spirituality"],
    recommendedUsage: "Premium accents and creative emphasis",
  },
];

function analyzeHex(hex: string): {
  emotions: string[];
  associations: string[];
  recommendedUsage: string;
} {
  const h = hex.replace("#", "").toLowerCase();
  if (!h || h.length < 6) {
    return { emotions: ["Neutral"], associations: ["Versatility"], recommendedUsage: "General purpose color" };
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  for (const entry of COLOR_EMOTION_MAP) {
    if (entry.test(r, g, b)) {
      return { emotions: entry.emotions, associations: entry.associations, recommendedUsage: entry.recommendedUsage };
    }
  }
  return { emotions: ["Neutral"], associations: ["Versatility"], recommendedUsage: "Supplementary brand color" };
}

export function extractColorPsychologyDetailed(input: BrandDnaAdapterInput): {
  entries: ColorPsychologyEntry[];
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];
  const entries: ColorPsychologyEntry[] = [];

  const { primary, secondary, accent, palette } = input.detectedColors;

  if (!primary && palette.length === 0) {
    gaps.push("detectedColors");
    return {
      entries: [],
      confidence: { score: 0.05, evidence: [], gaps: ["detectedColors"] },
    };
  }

  evidence.push("detectedColors");

  const roleMap: Array<[string | null, ColorPsychologyEntry["role"]]> = [
    [primary, "primary"],
    [secondary, "secondary"],
    [accent, "accent"],
  ];

  for (const [color, role] of roleMap) {
    if (!color) continue;
    const analysis = analyzeHex(color);
    entries.push({
      color,
      colorMask: maskHex(color),
      role,
      ...analysis,
      confidence: 0.75,
    });
  }

  // Additional palette colors as neutral
  const named = new Set([primary, secondary, accent].filter(Boolean) as string[]);
  for (const color of palette.filter((c) => !named.has(c)).slice(0, 4)) {
    const analysis = analyzeHex(color);
    entries.push({
      color,
      colorMask: maskHex(color),
      role: "neutral",
      ...analysis,
      confidence: 0.55,
    });
  }

  const score = entries.length >= 3 ? 0.8 : entries.length === 2 ? 0.6 : 0.4;
  return {
    entries,
    confidence: { score, evidence, gaps },
  };
}

// ── Typography Profile ────────────────────────────────────────────────────────

const TYPOGRAPHY_SCALES: Record<string, { label: string; ratio: number }> = {
  geometric: { label: "Major Third (1.25)", ratio: 1.25 },
  humanist: { label: "Perfect Fourth (1.333)", ratio: 1.333 },
  modern: { label: "Major Third (1.25)", ratio: 1.25 },
  transitional: { label: "Perfect Fourth (1.333)", ratio: 1.333 },
  display: { label: "Golden Ratio (1.618)", ratio: 1.618 },
  slab: { label: "Minor Third (1.2)", ratio: 1.2 },
};

export function extractTypographyProfile(input: BrandDnaAdapterInput): {
  profile: TypographyProfile;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];

  const typoStyle = lower(input.detectedTypography.style);
  const density = lower(input.visualDensity);
  const voice = lower(input.brandVoice);

  // Scale ratio
  let scaleInfo = { label: "Major Third (1.25)", ratio: 1.25 };
  for (const [key, val] of Object.entries(TYPOGRAPHY_SCALES)) {
    if (typoStyle.includes(key)) { scaleInfo = val; evidence.push("detectedTypography.style"); break; }
  }
  if (!typoStyle) gaps.push("detectedTypography.style");

  // Weight usage
  const hasHeading = !!input.detectedTypography.heading;
  const hasBody = !!input.detectedTypography.body;
  if (hasHeading || hasBody) evidence.push("detectedTypography");
  else gaps.push("detectedTypography.heading", "detectedTypography.body");

  const weightUsage = {
    primary: hasPersonality(input, "Luxury", "Editorial") ? "300 Light" : "700 Bold",
    secondary: "400 Regular",
    accent: hasPersonality(input, "Corporate", "Technical") ? "600 SemiBold" : "500 Medium",
  };

  // Line height
  let lineHeightStyle: TypographyProfile["lineHeightStyle"] = "normal";
  if (density.includes("dense") || density.includes("compact")) {
    lineHeightStyle = "tight"; evidence.push("visualDensity");
  } else if (density.includes("airy") || lower(input.spacingStyle).includes("generous")) {
    lineHeightStyle = "loose"; evidence.push("visualDensity", "spacingStyle");
  }

  // Letter spacing
  let letterSpacingStyle: TypographyProfile["letterSpacingStyle"] = "normal";
  if (voice.includes("formal") || hasPersonality(input, "Luxury", "Premium")) {
    letterSpacingStyle = "wide"; evidence.push("brandVoice");
  } else if (hasPersonality(input, "Technical", "Industrial")) {
    letterSpacingStyle = "tight"; evidence.push("brandPersonality");
  }

  // Font pairing rationale
  const heading = input.detectedTypography.heading ?? "Sans-serif";
  const body = input.detectedTypography.body ?? "System UI";
  const pairingRationale = `${heading} for headings creates ${
    hasPersonality(input, "Luxury") ? "elegant contrast" : "clear hierarchy"
  } against ${body} body text, reinforcing ${input.brandPersonality.slice(0, 2).join(" and ")} brand tone.`;

  // Accessibility score: heuristic based on contrast style + line height
  let accessibilityScore = 60;
  if (lower(input.visualDensity).includes("airy")) accessibilityScore += 15;
  if (letterSpacingStyle === "wide") accessibilityScore += 10;
  if (lineHeightStyle === "loose") accessibilityScore += 10;
  if (scaleInfo.ratio >= 1.333) accessibilityScore += 5;
  accessibilityScore = Math.min(accessibilityScore, 100);

  const evidenceUniq = [...new Set(evidence)];
  const score = evidenceUniq.length >= 3 ? 0.75 : evidenceUniq.length >= 1 ? 0.5 : 0.15;

  return {
    profile: {
      scaleRatioLabel: scaleInfo.label,
      scaleRatio: scaleInfo.ratio,
      weightUsage,
      lineHeightStyle,
      letterSpacingStyle,
      fontPairingRationale: pairingRationale,
      accessibilityScore,
    },
    confidence: { score, evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}

// ── Photography Style (detailed) ──────────────────────────────────────────────

export function extractPhotographyDetailed(input: BrandDnaAdapterInput): {
  profile: PhotographyStyleDetailed;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];
  const style = lower(input.photographyStyle);
  const industry = lower(input.industry);
  const risk = lower(input.riskProfile);

  if (!style) gaps.push("photographyStyle");
  else evidence.push("photographyStyle");

  // Shot types
  const shotTypes: string[] = [];
  if (style.includes("product") || industry.includes("retail") || industry.includes("e-commerce")) {
    shotTypes.push("product", "close-up"); evidence.push("industry");
  }
  if (style.includes("lifestyle") || style.includes("editorial")) {
    shotTypes.push("lifestyle", "wide-angle");
  }
  if (style.includes("portrait") || hasPersonality(input, "Friendly", "Community")) {
    shotTypes.push("portrait"); evidence.push("brandPersonality");
  }
  if (shotTypes.length === 0) shotTypes.push("wide-angle");

  // Lighting mood
  let lightingMood: PhotographyStyleDetailed["lightingMood"] = "natural";
  if (style.includes("studio") || hasPersonality(input, "Corporate", "Professional")) {
    lightingMood = "studio"; evidence.push("photographyStyle");
  } else if (risk.includes("innovative") || hasPersonality(input, "Energetic")) {
    lightingMood = "dramatic"; evidence.push("riskProfile");
  } else if (hasPersonality(input, "Friendly", "Warm")) {
    lightingMood = "soft-box"; evidence.push("brandPersonality");
  }

  // Color grading
  let colorGrading: PhotographyStyleDetailed["colorGrading"] = "natural";
  if (hasPersonality(input, "Luxury", "Premium") || risk.includes("conservative")) {
    colorGrading = "desaturated"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Energetic", "Youthful")) {
    colorGrading = "vivid"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Warm", "Friendly")) {
    colorGrading = "warm"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Tech", "Corporate", "Modern")) {
    colorGrading = "cool"; evidence.push("brandPersonality");
  }

  // Subject focus
  let subjectFocus: PhotographyStyleDetailed["subjectFocus"] = "mixed";
  if (industry.includes("tech") || industry.includes("software")) {
    subjectFocus = "abstract"; evidence.push("industry");
  } else if (industry.includes("retail") || industry.includes("product")) {
    subjectFocus = "product"; evidence.push("industry");
  } else if (industry.includes("consult") || industry.includes("service")) {
    subjectFocus = "people"; evidence.push("industry");
  } else if (industry.includes("real estate") || industry.includes("hospitality")) {
    subjectFocus = "environment"; evidence.push("industry");
  }

  // Depth of field
  const depthOfField: PhotographyStyleDetailed["depthOfField"] =
    style.includes("portrait") || hasPersonality(input, "Luxury") ? "shallow" :
    subjectFocus === "environment" ? "deep" : "medium";

  // Human presence
  let humanPresence: PhotographyStyleDetailed["humanPresence"] = "minimal";
  if (hasPersonality(input, "Community", "Social", "People-first")) {
    humanPresence = "central"; evidence.push("brandPersonality");
  } else if (industry.includes("service") || industry.includes("consult")) {
    humanPresence = "featured"; evidence.push("industry");
  } else if (subjectFocus === "product" || subjectFocus === "abstract") {
    humanPresence = "none";
  }

  const evidenceUniq = [...new Set(evidence)];
  const score = style ? Math.min(0.4 + evidenceUniq.length * 0.08, 0.85) : 0.15;

  return {
    profile: { shotTypes: [...new Set(shotTypes)], lightingMood, colorGrading, subjectFocus, depthOfField, humanPresence },
    confidence: { score: parseFloat(score.toFixed(3)), evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}

// ── Illustration Style (detailed) ─────────────────────────────────────────────

export function extractIllustrationDetailed(input: BrandDnaAdapterInput): {
  profile: IllustrationStyleDetailed;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];
  const style = lower(input.illustrationStyle);
  const risk = lower(input.riskProfile);

  if (!style) gaps.push("illustrationStyle");
  else evidence.push("illustrationStyle");

  // Dimensionality
  let dimensionality: IllustrationStyleDetailed["dimensionality"] = "flat";
  if (style.includes("3d") || style.includes("three")) {
    dimensionality = "3d";
  } else if (style.includes("isometric") || style.includes("iso")) {
    dimensionality = "isometric";
  } else if (style.includes("mixed")) {
    dimensionality = "mixed";
  } else if (style.includes("flat") || !style) {
    dimensionality = "flat";
  }

  // Complexity
  let complexity: IllustrationStyleDetailed["complexity"] = "minimal";
  if (risk.includes("innovative") || hasPersonality(input, "Creative", "Artistic")) {
    complexity = "detailed"; evidence.push("riskProfile");
  } else if (risk.includes("conservative") || hasPersonality(input, "Corporate", "Minimal")) {
    complexity = "minimal"; evidence.push("riskProfile");
  } else {
    complexity = "moderate";
  }

  // Stroke weight
  let strokeWeight: IllustrationStyleDetailed["strokeWeight"] = "medium";
  if (hasPersonality(input, "Luxury", "Elegant", "Premium")) {
    strokeWeight = "hairline"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Bold", "Energetic")) {
    strokeWeight = "bold"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Minimal")) {
    strokeWeight = "thin"; evidence.push("brandPersonality");
  }

  // Color usage
  let colorUsage: IllustrationStyleDetailed["colorUsage"] = "limited-palette";
  if (risk.includes("conservative") || hasPersonality(input, "Corporate", "Minimal")) {
    colorUsage = "monochrome"; evidence.push("riskProfile");
  } else if (hasPersonality(input, "Luxury")) {
    colorUsage = "duotone"; evidence.push("brandPersonality");
  } else if (risk.includes("innovative")) {
    colorUsage = "full-color"; evidence.push("riskProfile");
  }

  // Cultural references
  const culturalReferences: string[] = [];
  const industry = lower(input.industry);
  if (industry.includes("fashion") || industry.includes("lifestyle")) culturalReferences.push("Contemporary Indonesian");
  if (industry.includes("heritage") || industry.includes("traditional")) culturalReferences.push("Batik-inspired");
  if (hasPersonality(input, "Global", "International")) culturalReferences.push("Universal");

  // Texture usage
  const textureUsage: IllustrationStyleDetailed["textureUsage"] =
    hasPersonality(input, "Organic", "Artisan", "Handcrafted") ? "prominent" :
    hasPersonality(input, "Modern", "Tech") ? "none" : "subtle";

  const evidenceUniq = [...new Set(evidence)];
  const score = style ? Math.min(0.35 + evidenceUniq.length * 0.1, 0.8) : 0.12;

  return {
    profile: { complexity, strokeWeight, colorUsage, culturalReferences, dimensionality, textureUsage },
    confidence: { score: parseFloat(score.toFixed(3)), evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}

// ── Material & Style (Interior) ───────────────────────────────────────────────

const INTERIOR_STYLE_MAP: Array<{
  test: (p: BrandDnaAdapterInput) => boolean;
  styleFamily: string;
  materials: string[];
  lightingApproach: MaterialStyleInterior["lightingApproach"];
  spacePhilosophy: MaterialStyleInterior["spacePhilosophy"];
  texturePreference: MaterialStyleInterior["texturePreference"];
}> = [
  {
    test: (p) => hasPersonality(p, "Luxury", "Premium", "Elegant"),
    styleFamily: "Luxury Contemporary",
    materials: ["Italian marble", "brushed brass", "glass", "velvet", "leather"],
    lightingApproach: "layered",
    spacePhilosophy: "expressive",
    texturePreference: "smooth",
  },
  {
    test: (p) => hasPersonality(p, "Minimalist", "Modern") && hasPersonality(p, "Warm"),
    styleFamily: "Japandi",
    materials: ["light oak", "bamboo", "linen", "concrete", "natural stone"],
    lightingApproach: "natural-forward",
    spacePhilosophy: "minimalist",
    texturePreference: "textured",
  },
  {
    test: (p) => hasPersonality(p, "Minimalist", "Clean", "Nordic"),
    styleFamily: "Scandinavian",
    materials: ["white pine", "birch", "wool", "ceramic", "glass"],
    lightingApproach: "natural-forward",
    spacePhilosophy: "minimalist",
    texturePreference: "smooth",
  },
  {
    test: (p) => hasPersonality(p, "Industrial", "Urban", "Technical"),
    styleFamily: "Industrial",
    materials: ["concrete", "exposed brick", "raw steel", "reclaimed wood", "glass"],
    lightingApproach: "cool-focused",
    spacePhilosophy: "functional",
    texturePreference: "raw",
  },
  {
    test: (p) => hasPersonality(p, "Corporate", "Professional", "Conservative"),
    styleFamily: "Modern Corporate",
    materials: ["tempered glass", "polished steel", "engineered wood", "carpet tile"],
    lightingApproach: "cool-focused",
    spacePhilosophy: "functional",
    texturePreference: "smooth",
  },
  {
    test: (p) => hasPersonality(p, "Friendly", "Playful", "Creative"),
    styleFamily: "Eclectic Contemporary",
    materials: ["plywood", "color-block fabric", "terrazzo", "acrylic"],
    lightingApproach: "warm-ambient",
    spacePhilosophy: "expressive",
    texturePreference: "mixed",
  },
];

export function extractMaterialStyleInterior(input: BrandDnaAdapterInput): {
  profile: MaterialStyleInterior;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];

  let matched = INTERIOR_STYLE_MAP.find((entry) => entry.test(input));
  if (!matched) {
    matched = {
      styleFamily: "Contemporary",
      materials: ["wood", "glass", "metal"],
      lightingApproach: "warm-ambient",
      spacePhilosophy: "functional",
      texturePreference: "mixed",
    } as typeof INTERIOR_STYLE_MAP[0];
    gaps.push("brandPersonality");
  } else {
    evidence.push("brandPersonality");
    if (input.industry) evidence.push("industry");
  }

  // Color palette from brand colors (muted/desaturated for interior application)
  const colorPalette = input.detectedColors.palette.slice(0, 3);
  if (colorPalette.length > 0) evidence.push("detectedColors");

  const score = evidence.length >= 2 ? 0.65 : evidence.length === 1 ? 0.45 : 0.2;

  return {
    profile: {
      materials: matched.materials,
      styleFamily: matched.styleFamily,
      lightingApproach: matched.lightingApproach,
      spacePhilosophy: matched.spacePhilosophy,
      texturePreference: matched.texturePreference,
      colorPalette,
    },
    confidence: { score, evidence: [...new Set(evidence)], gaps: [...new Set(gaps)] },
  };
}

// ── Motif & Style (Fashion) ───────────────────────────────────────────────────

export function extractMotifStyleFashion(input: BrandDnaAdapterInput): {
  profile: MotifStyleFashion;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];
  const industry = lower(input.industry);

  // Patterns
  const patterns: string[] = [];
  if (hasPersonality(input, "Corporate", "Professional", "Structured")) {
    patterns.push("solid", "fine stripe"); evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Creative", "Artistic", "Energetic")) {
    patterns.push("abstract", "graphic"); evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Luxury", "Premium")) {
    patterns.push("subtle texture", "tonal"); evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Friendly", "Playful")) {
    patterns.push("geometric", "block color"); evidence.push("brandPersonality");
  } else {
    patterns.push("solid");
    gaps.push("brandPersonality");
  }

  // Silhouette
  let silhouette: MotifStyleFashion["silhouette"] = "relaxed";
  if (hasPersonality(input, "Corporate", "Professional") || lower(input.brandVoice).includes("formal")) {
    silhouette = "structured"; evidence.push("brandVoice");
  } else if (hasPersonality(input, "Luxury", "Elegant")) {
    silhouette = "fitted"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Casual", "Playful")) {
    silhouette = "relaxed";
  } else if (hasPersonality(input, "Avant-garde", "Fashion-forward")) {
    silhouette = "oversized";
  }

  // Textiles
  const textiles: string[] = [];
  if (hasPersonality(input, "Luxury", "Premium")) {
    textiles.push("silk", "wool crepe", "cashmere"); evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Sustainable", "Eco", "Natural")) {
    textiles.push("organic cotton", "linen", "bamboo"); evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Corporate", "Professional")) {
    textiles.push("wool blend", "cotton poplin", "ponte"); evidence.push("brandPersonality");
  } else {
    textiles.push("cotton", "polyester blend");
  }

  // Cultural references
  const culturalReferences: string[] = [];
  if (industry.includes("fashion") || industry.includes("lifestyle")) {
    culturalReferences.push("Contemporary Indonesian", "Southeast Asian");
  }

  // Colorway
  let colorway: MotifStyleFashion["colorway"] = "neutral";
  const palette = input.detectedColors.palette;
  if (palette.length <= 1) {
    colorway = "monochromatic";
  } else if (hasPersonality(input, "Luxury", "Premium")) {
    colorway = "neutral"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Energetic", "Bold")) {
    colorway = "complementary"; evidence.push("brandPersonality");
  } else if (hasPersonality(input, "Minimalist")) {
    colorway = "analogous"; evidence.push("brandPersonality");
  }

  // Occasions
  const occasions: string[] = [];
  if (hasPersonality(input, "Corporate", "Professional") || lower(input.brandVoice).includes("formal")) {
    occasions.push("business formal", "boardroom"); evidence.push("brandVoice");
  }
  if (hasPersonality(input, "Luxury")) occasions.push("gala", "premium social");
  if (hasPersonality(input, "Casual", "Friendly")) occasions.push("smart casual", "social");
  if (occasions.length === 0) occasions.push("business casual");

  const evidenceUniq = [...new Set(evidence)];
  const score = evidenceUniq.length >= 2 ? 0.6 : evidenceUniq.length === 1 ? 0.4 : 0.15;

  return {
    profile: {
      patterns: [...new Set(patterns)],
      silhouette,
      textiles,
      culturalReferences,
      colorway,
      occasions,
    },
    confidence: { score: parseFloat(score.toFixed(3)), evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}

// ── Creative Memory ───────────────────────────────────────────────────────────

export function extractCreativeMemory(input: BrandDnaAdapterInput): {
  stored: CreativeMemoryStored;
  confidence: DimensionConfidenceEntry;
} {
  const evidence: string[] = [];
  const gaps: string[] = [];

  if (input.memories.length === 0 && input.projectHistory.length === 0) {
    gaps.push("memories", "projectHistory");
    return {
      stored: { keyInsights: [], crossProjectLearnings: [], preferencePatterns: [], avoidPatterns: [] },
      confidence: { score: 0.05, evidence: [], gaps },
    };
  }

  // Key insights from memories
  const keyInsights = input.memories.map((m) => ({
    key: m.key,
    insight: m.value,
    source: (m.source as CreativeMemoryEntry["source"]) ?? "memory",
    confidence: m.confidence ?? 0.5,
    addedAt: m.updatedAt ?? new Date().toISOString(),
  }));
  if (keyInsights.length > 0) evidence.push("memories");

  // Cross-project learnings from project history
  const completedProjects = input.projectHistory.filter(
    (p) => p.status === "completed" || p.status === "delivered",
  );
  const crossProjectLearnings: string[] = [];
  if (completedProjects.length > 0) {
    crossProjectLearnings.push(
      `Delivered ${completedProjects.length} completed project(s) under brand "${
        completedProjects[0]?.brandName ?? "unknown"
      }"`,
    );
    evidence.push("projectHistory");
  }
  if (input.projectHistory.length > completedProjects.length) {
    crossProjectLearnings.push(
      `${input.projectHistory.length - completedProjects.length} project(s) in active/review phases`,
    );
  }

  // Preference patterns from memory keys
  const frequencyMap = new Map<string, number>();
  for (const m of input.memories) {
    const category = m.category ?? "general";
    frequencyMap.set(category, (frequencyMap.get(category) ?? 0) + 1);
  }
  const preferencePatterns = [...frequencyMap.entries()].map(([pattern, frequency]) => ({
    pattern,
    frequency,
    confidence: Math.min(0.3 + frequency * 0.15, 0.9),
  }));

  // Avoid patterns
  const avoidPatterns: string[] = [];
  const avoidMemory = input.memories.find((m) => m.key.includes("avoid") || m.key.includes("not_use"));
  if (avoidMemory) avoidPatterns.push(avoidMemory.value);

  const evidenceUniq = [...new Set(evidence)];
  const score = evidenceUniq.length >= 2 ? 0.8 : evidenceUniq.length === 1 ? 0.55 : 0.1;

  return {
    stored: { keyInsights, crossProjectLearnings, preferencePatterns, avoidPatterns },
    confidence: { score: parseFloat(score.toFixed(3)), evidence: evidenceUniq, gaps: [...new Set(gaps)] },
  };
}
