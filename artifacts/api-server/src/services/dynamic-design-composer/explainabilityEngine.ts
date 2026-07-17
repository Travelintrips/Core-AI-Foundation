/**
 * Team 13 — Dynamic Design Composition Engine
 * Explainability Engine
 *
 * Generates human-readable "why" explanations for every decision:
 *  - why layout chosen
 *  - why pattern chosen
 *  - why colors chosen
 *  - why components added
 *  - why alternatives rejected
 *
 * Pure deterministic functions — no side effects.
 */

import type {
  BlueprintInput,
  LayoutPlanInput,
  ComponentInput,
  PatternInput,
  PaletteInput,
  TypographyInput,
  DecorationInput,
  MaterialInput,
  MotifInput,
  BrandDnaInput,
  FallbackRecord,
  DecisionExplanation,
  ExplainabilityReport,
} from "./types.js";

// ── Layout explanation ────────────────────────────────────────────────────────

export function explainLayout(
  layout: LayoutPlanInput,
  blueprint: BlueprintInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "layoutPlan");
  const overriddenFallback = fallbacks.find((f) => f.field === "layoutPlan.strategy");

  const strategyReasons: Record<LayoutPlanInput["strategy"], string> = {
    "hero-content": "The hero-content strategy establishes a strong visual anchor at the top, directing user attention before presenting supporting content — ideal for professional and corporate contexts.",
    "grid": "A grid strategy distributes content evenly across the canvas, maximising information density while maintaining visual order — best for portfolios and product showcases.",
    "asymmetric": "Asymmetric layouts create visual dynamism and tension, guiding the eye in a non-linear path — suited for bold, innovative, and creative brands.",
    "magazine": "Magazine layout replicates editorial density with varied column widths and focal points — appropriate for content-rich, media-driven designs.",
    "editorial": "Editorial layouts use generous whitespace and strong typographic hierarchy — the hallmark of luxury, premium, and minimalist brands.",
    "minimal": "A minimal layout strips away visual noise, letting content breathe — selected for brands where clarity and restraint are paramount.",
    "card-grid": "Card-grid layouts organise discrete content units into a scannable matrix — perfect for product listings, team profiles, and feature comparisons.",
    "split": "A split layout divides the canvas into two narrative lanes, creating contrast between ideas or between a visual and its explanation.",
    "full-bleed": "Full-bleed maximises visual impact by extending content to the canvas edges — chosen when a bold, immersive first impression is required.",
    "sidebar": "A sidebar layout dedicates a persistent navigation or context column alongside main content — ideal for document-heavy or application-like experiences.",
  };

  const brandSignal = brandDna?.brandPersonality?.length
    ? `Brand personality [${brandDna.brandPersonality.join(", ")}] guided this choice. Brand layout style: "${brandDna.layoutStyle ?? "not specified"}".`
    : null;

  const alternativesRejected = buildLayoutAlternatives(layout.strategy, brandDna);

  return {
    chosen: `${layout.strategy} (${layout.name})`,
    why: strategyReasons[layout.strategy] +
      (blueprint.medium === "print"
        ? " The print medium further reinforces this choice — print audiences expect structured, hierarchical reading paths."
        : "") +
      (isFallback ? " (Applied as default — no layout was provided in the request.)" : ""),
    brandSignal: overriddenFallback
      ? `Derived from Brand DNA layoutStyle: "${overriddenFallback.fallbackValue}"`
      : brandSignal,
    alternativesRejected,
    overridden: !!overriddenFallback,
    originalInput: overriddenFallback ? String(overriddenFallback.originalValue ?? "none") : undefined,
  };
}

function buildLayoutAlternatives(
  chosen: LayoutPlanInput["strategy"],
  brandDna: BrandDnaInput | undefined,
): DecisionExplanation["alternativesRejected"] {
  const all: Array<{ option: LayoutPlanInput["strategy"]; reason: string }> = [
    { option: "full-bleed", reason: "Would sacrifice content hierarchy for visual impact — unsuitable unless the brand is primarily image-driven." },
    { option: "grid", reason: "Grid distributes attention equally — rejected because the brand requires a clear focal hierarchy." },
    { option: "asymmetric", reason: "Asymmetric layouts require a bold, risk-tolerant brand personality to avoid appearing unpolished." },
    { option: "minimal", reason: "Minimal layouts are information-sparse — rejected for content-rich requirements." },
    { option: "sidebar", reason: "Sidebar layouts prioritise navigation depth over visual storytelling." },
    { option: "magazine", reason: "Magazine layouts require dense content supply to avoid appearing sparse." },
  ];
  return all
    .filter((a) => a.option !== chosen)
    .slice(0, 3)
    .map((a) => ({ option: a.option, reason: a.reason }));
}

// ── Palette explanation ───────────────────────────────────────────────────────

export function explainPalette(
  palette: PaletteInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "palette");
  const fromDna = fallbacks.find((f) => f.field === "palette" && f.fallbackSource === "brand-dna");

  const moodDescriptions: Record<PaletteInput["mood"], string> = {
    vibrant: "Vibrant palettes use high-saturation colours to create energy and excitement.",
    muted: "Muted palettes reduce saturation for a sophisticated, approachable feel.",
    monochrome: "Monochrome palettes use a single hue at varying lightness — the ultimate expression of restraint.",
    earthy: "Earthy palettes draw from terracotta, ochre, and sage — grounding and natural.",
    cool: "Cool palettes (blues, teals) convey trust, clarity, and professionalism.",
    warm: "Warm palettes (reds, oranges) evoke energy, warmth, and urgency.",
    neutral: "Neutral palettes provide a timeless, versatile backdrop that lets content lead.",
  };

  const brandSignal = brandDna
    ? [
        brandDna.brandPersonality?.length ? `Personality: [${brandDna.brandPersonality.join(", ")}]` : null,
        brandDna.industry ? `Industry: ${brandDna.industry}` : null,
        brandDna.detectedColors?.primary ? `Brand primary: ${brandDna.detectedColors.primary}` : null,
      ]
        .filter(Boolean)
        .join("; ") || null
    : null;

  return {
    chosen: `${palette.name} (mood: ${palette.mood})`,
    why:
      moodDescriptions[palette.mood] +
      ` Primary: ${palette.primary}, Secondary: ${palette.secondary}, Accent: ${palette.accent}.` +
      (fromDna ? ` Palette was derived from Brand DNA detected colours.` : "") +
      (isFallback && !fromDna ? " Default palette applied — no palette was provided." : ""),
    brandSignal,
    alternativesRejected: buildPaletteAlternatives(palette.mood, brandDna),
    overridden: !!fromDna,
    originalInput: fromDna ? String(fromDna.originalValue ?? "none") : undefined,
  };
}

function buildPaletteAlternatives(
  chosen: PaletteInput["mood"],
  _brandDna: BrandDnaInput | undefined,
): DecisionExplanation["alternativesRejected"] {
  const moods: PaletteInput["mood"][] = ["vibrant", "muted", "monochrome", "earthy", "cool", "warm", "neutral"];
  const reasons: Record<PaletteInput["mood"], string> = {
    vibrant: "High saturation would overwhelm content and conflict with a professional tone.",
    muted: "Muted palette risks appearing washed-out in digital contexts without strong typography.",
    monochrome: "Monochrome limits visual differentiation — buttons, alerts, and accents lose distinctiveness.",
    earthy: "Earthy tones are niche — strong industry alignment (agriculture, wellness) is required.",
    cool: "Cool palette suits trust-oriented brands but may feel impersonal for warm, human brands.",
    warm: "Warm palette creates urgency — inappropriate for brands requiring calm authority.",
    neutral: "Neutral palette is safe but may lack the distinctiveness a bold brand requires.",
  };
  return moods
    .filter((m) => m !== chosen)
    .slice(0, 3)
    .map((m) => ({ option: m, reason: reasons[m] }));
}

// ── Typography explanation ────────────────────────────────────────────────────

export function explainTypography(
  typography: TypographyInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "typography");
  const fromDna = fallbacks.find(
    (f) => f.field === "typography" && f.fallbackSource === "brand-dna",
  );

  const styleDescriptions: Record<TypographyInput["style"], string> = {
    "serif": "Serif fonts carry authority, tradition, and editorial gravitas — chosen for brands seeking timeless credibility.",
    "sans-serif": "Sans-serif fonts convey modernity, clarity, and accessibility — the most versatile choice for digital-first brands.",
    "display": "Display fonts make a dramatic headline statement — reserved for brands where typographic personality is a key differentiator.",
    "monospace": "Monospace fonts signal technical precision and developer-oriented audiences.",
    "mixed": "Mixed type pairing creates typographic contrast — a bold display heading with a legible body font.",
  };

  return {
    chosen: `${typography.name} (${typography.headingFont} / ${typography.bodyFont}, ${typography.style})`,
    why:
      styleDescriptions[typography.style] +
      ` Base size ${typography.baseSize}px with ${typography.scaleRatio}× modular scale produces a clear visual hierarchy.` +
      (fromDna ? " Fonts derived from Brand DNA typography data." : "") +
      (isFallback && !fromDna ? " Default typography applied — none was provided." : ""),
    brandSignal: brandDna?.detectedTypography
      ? `Brand DNA typography: heading=${brandDna.detectedTypography.heading ?? "?"}, body=${brandDna.detectedTypography.body ?? "?"}`
      : null,
    alternativesRejected: [
      { option: "Display + Serif", reason: "Display headings with serif body create tonal inconsistency unless the brand is explicitly editorial." },
      { option: "Monospace throughout", reason: "Full monospace is restrictive — suits developer tools but limits expressive range for general brands." },
      { option: "Serif + Serif", reason: "All-serif pairing requires precise weight differentiation to avoid heading and body blending together." },
    ],
    overridden: !!fromDna,
    originalInput: fromDna ? String(fromDna.originalValue ?? "none") : undefined,
  };
}

// ── Pattern explanation ───────────────────────────────────────────────────────

export function explainPattern(
  pattern: PatternInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "pattern");

  const typeDescriptions: Record<PatternInput["type"], string> = {
    geometric: "Geometric patterns convey precision, structure, and modernity — aligned with technical and professional brands.",
    organic: "Organic patterns use natural curves and irregular shapes — aligned with health, wellness, and nature brands.",
    abstract: "Abstract patterns are brand-agnostic — they add visual interest without carrying specific semantic weight.",
    textile: "Textile patterns evoke craft, heritage, and tactility — suited for fashion, home goods, and artisanal brands.",
    "dot-matrix": "Dot-matrix patterns are subtle and technical — popular in fintech and SaaS product designs.",
    stripe: "Stripe patterns are classic and structured — they reinforce grid-based layouts without competing with content.",
    wave: "Wave patterns suggest flow, movement, and dynamism — used in technology and lifestyle brands.",
    circuit: "Circuit patterns signal electronics, technology, and innovation — specific to tech-industry contexts.",
    botanical: "Botanical patterns evoke nature, growth, and organic vitality — suited for wellness and sustainability brands.",
    none: "No pattern applied — the design relies entirely on layout structure, colour, and typography for visual interest. This maximises content legibility and is the correct choice when content is data-dense.",
  };

  return {
    chosen: `${pattern.name} (type: ${pattern.type}, intensity: ${pattern.intensity})`,
    why:
      typeDescriptions[pattern.type] +
      (pattern.type !== "none"
        ? ` Applied at ${Math.round(pattern.intensity * 100)}% intensity in the ${pattern.placement} layer.`
        : "") +
      (isFallback ? " Default (none) applied — no pattern was provided." : ""),
    brandSignal: brandDna?.illustrationStyle
      ? `Brand DNA illustration style "${brandDna.illustrationStyle}" informed the pattern choice.`
      : null,
    alternativesRejected: [
      { option: "circuit", reason: "Circuit patterns are too domain-specific unless the brand is explicitly technology-focused." },
      { option: "botanical", reason: "Botanical patterns signal natural/organic brands — inappropriate without nature-oriented brand signals." },
      { option: "textile", reason: "Textile patterns imply craft heritage — reserved for artisanal or fashion brands." },
    ].filter((a) => a.option !== pattern.type),
    overridden: false,
  };
}

// ── Component explanations ────────────────────────────────────────────────────

export function explainComponents(
  components: ComponentInput[],
  layout: LayoutPlanInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): Array<DecisionExplanation & { componentType: string }> {
  const isFallback = fallbacks.some((f) => f.field === "components");

  const componentReasons: Partial<Record<ComponentInput["type"], string>> = {
    header: "A header is universally required to establish brand identity, navigation, and context at the top of the composition.",
    footer: "A footer provides essential navigation, legal, and contact information — expected by users on all professional designs.",
    hero: "A hero section is the primary value proposition canvas — it anchors the layout and communicates the brand's core message in the first viewport.",
    cta: "A call-to-action component is the conversion mechanism — every composition with a business goal requires at least one clear action point.",
    testimonial: "Testimonials build social proof — added because the brand context implies trust-building is a commercial priority.",
    "feature-grid": "Feature grids efficiently communicate product or service differentiation — added to support a multi-value-proposition layout.",
    "pricing-table": "Pricing tables reduce purchase friction by making options immediately comparable.",
    "stat-block": "Stat blocks anchor credibility with quantifiable evidence — particularly effective for B2B and enterprise brands.",
    "image-gallery": "An image gallery was included to showcase visual assets — relevant where photography or portfolio content is a brand signal.",
    timeline: "A timeline communicates process, history, or transformation — selected for brands with a compelling narrative arc.",
    form: "A form is the primary lead-capture or enquiry mechanism.",
    nav: "Navigation provides persistent orientation within the design.",
    divider: "Dividers separate content sections cleanly without adding visual weight.",
    quote: "Pull quotes amplify editorial authority and provide typographic focal points.",
    "icon-row": "Icon rows provide a compact, scannable summary of features or values.",
    accordion: "Accordions manage content density — showing progressive disclosure for FAQs or detailed specifications.",
    "tab-group": "Tab groups allow parallel content sets to share the same layout zone efficiently.",
  };

  return components.map((c) => ({
    componentType: c.type,
    chosen: `${c.type} (zone: ${c.zone ?? "auto"}, variant: ${c.variant ?? "standard"})`,
    why:
      (componentReasons[c.type] ?? `${c.type} component was included as specified in the composition request.`) +
      (isFallback && c.required ? " Included as a required default component." : ""),
    brandSignal: brandDna?.brandVoice
      ? `Brand voice "${brandDna.brandVoice}" influenced component variant selection.`
      : null,
    alternativesRejected: buildComponentAlternatives(c.type, layout.strategy),
    overridden: false,
  }));
}

function buildComponentAlternatives(
  type: ComponentInput["type"],
  strategy: LayoutPlanInput["strategy"],
): DecisionExplanation["alternativesRejected"] {
  const alternativeMap: Partial<Record<ComponentInput["type"], string[]>> = {
    hero: ["full-bleed-video", "carousel-hero", "split-screen-hero"],
    cta: ["inline-cta", "sticky-cta", "modal-cta"],
    "feature-grid": ["feature-list", "comparison-table", "icon-cards"],
    testimonial: ["video-testimonial", "star-rating", "case-study-block"],
  };
  const alts = alternativeMap[type] ?? [];
  return alts.slice(0, 2).map((alt) => ({
    option: alt,
    reason: `${alt} was considered but rejected — the "${strategy}" layout strategy does not provide sufficient space or structural support for this variant.`,
  }));
}

// ── Decoration explanation ────────────────────────────────────────────────────

export function explainDecoration(
  decoration: DecorationInput,
  material: MaterialInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "decoration");

  return {
    chosen: `${decoration.name} (radius: ${decoration.borderRadius}, shadow: ${decoration.shadowDepth}, border: ${decoration.borderStyle})`,
    why:
      `Border radius "${decoration.borderRadius}" sets the tactile personality of the design — ` +
      (decoration.borderRadius === "none"
        ? "sharp corners communicate rigour and precision."
        : decoration.borderRadius === "pill" || decoration.borderRadius === "large"
        ? "rounded corners convey friendliness and approachability."
        : "moderate rounding balances approachability with professionalism.") +
      ` Shadow depth "${decoration.shadowDepth}" creates ${decoration.shadowDepth === "none" ? "a flat, print-like surface hierarchy." : "spatial depth that guides the user's attention across elevation layers."}` +
      (isFallback ? " Default decoration applied — none was provided." : ""),
    brandSignal: brandDna?.brandPersonality?.length
      ? `Brand personality [${brandDna.brandPersonality.join(", ")}] shaped the decoration choices.`
      : null,
    alternativesRejected: [
      {
        option: `border: thick + material: ${material.surface}`,
        reason: `Thick borders conflict with the ${material.surface} surface — they negate the intended material effect.`,
      },
      {
        option: "dramatic shadow on flat elevation",
        reason: "Dramatic shadows on a flat-elevation surface create contradictory depth signals.",
      },
    ],
    overridden: false,
  };
}

// ── Material explanation ──────────────────────────────────────────────────────

export function explainMaterial(
  material: MaterialInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "material");

  const surfaceDescriptions: Record<MaterialInput["surface"], string> = {
    flat: "Flat material is the most universally legible — zero visual noise, maximum content clarity.",
    glass: "Glass creates a frosted, layered depth effect — suited for modern, technology-forward brands.",
    neumorphic: "Neumorphic surfaces use inset/outset shadows to simulate soft tactility — distinctive but requires careful implementation.",
    material: "Material Design's elevation system uses systematic shadows to communicate UI hierarchy.",
    frosted: "Frosted surfaces blur content behind them, creating a translucency depth effect.",
    metallic: "Metallic surfaces convey premium, technological precision — suited for luxury or high-tech brands.",
    matte: "Matte surfaces absorb light rather than reflecting it — a grounded, serious quality.",
    paper: "Paper surfaces evoke print heritage and tactile warmth — effective for publishing and editorial contexts.",
    fabric: "Fabric surfaces convey craft, texture, and artisanal quality.",
  };

  return {
    chosen: `${material.name} (surface: ${material.surface}, texture: ${material.texture}, elevation: ${material.elevation})`,
    why:
      surfaceDescriptions[material.surface] +
      ` Texture "${material.texture}" adds ${material.texture === "smooth" ? "a clean, digital-native feel." : "subtle surface character without competing with content."}` +
      (isFallback ? " Default material applied." : ""),
    brandSignal: brandDna?.riskProfile
      ? `Brand risk profile "${brandDna.riskProfile}" informed material choice (conservative → flat/matte, innovative → glass/metallic).`
      : null,
    alternativesRejected: [
      { option: "neumorphic", reason: "Neumorphic surfaces require a monochromatic palette and careful shadow calibration — fragile outside ideal conditions." },
      { option: "glass + dense pattern", reason: "Glass surfaces over dense patterns create visual ambiguity — rejected by compatibility rules." },
    ].filter((a) => !a.option.startsWith(material.surface)),
    overridden: false,
  };
}

// ── Motif explanation ─────────────────────────────────────────────────────────

export function explainMotif(
  motif: MotifInput,
  brandDna: BrandDnaInput | undefined,
  fallbacks: FallbackRecord[],
): DecisionExplanation {
  const isFallback = fallbacks.some((f) => f.field === "motif");

  const themeDescriptions: Record<MotifInput["theme"], string> = {
    nature: "Nature motifs ground the design in organic, living systems — resonant for wellness, sustainability, and agricultural brands.",
    technology: "Technology motifs (circuits, data, networks) signal innovation and digital mastery.",
    human: "Human motifs (faces, hands, silhouettes) build empathy and emotional connection.",
    abstract: "Abstract motifs provide visual interest without semantic weight — the most versatile choice.",
    geometric: "Geometric motifs reinforce structure, order, and systematic thinking.",
    cultural: "Cultural motifs anchor the design to a specific heritage or geographic identity.",
    industrial: "Industrial motifs evoke manufacturing, strength, and precision — suited for logistics, engineering, and construction.",
    luxury: "Luxury motifs (filigree, refined ornament) signal craftsmanship and exclusivity.",
    playful: "Playful motifs (bold shapes, unexpected pairings) create joy and energy.",
    scientific: "Scientific motifs (molecules, diagrams, formulae) signal expertise and rigour.",
    none: "No motif applied — the design achieves visual identity through layout, colour, and typography alone.",
  };

  return {
    chosen: `${motif.name} (theme: ${motif.theme}, repetition: ${motif.repetition}, scale: ${motif.scale})`,
    why:
      themeDescriptions[motif.theme] +
      (motif.theme !== "none"
        ? ` Applied with ${motif.repetition} repetition at ${motif.scale} scale, colour-treated as ${motif.colorTreatment}.`
        : "") +
      (isFallback ? " Motif derived from industry context or applied as default." : ""),
    brandSignal: brandDna?.industry
      ? `Industry "${brandDna.industry}" suggested this motif theme.`
      : brandDna?.brandPersonality?.length
      ? `Brand personality ${JSON.stringify(brandDna.brandPersonality)} shaped the motif choice.`
      : null,
    alternativesRejected: [
      { option: "cultural", reason: "Cultural motifs require explicit geographic or heritage brand signals — not present in the input." },
      { option: "luxury", reason: "Luxury motifs require a brand voice and palette that signals premium positioning." },
      { option: "playful", reason: "Playful motifs conflict with a professional or corporate brand personality." },
    ].filter((a) => a.option !== motif.theme).slice(0, 3),
    overridden: false,
  };
}

// ── Composition rationale ─────────────────────────────────────────────────────

export function buildCompositionRationale(
  layout: LayoutPlanInput,
  palette: PaletteInput,
  typography: TypographyInput,
  material: MaterialInput,
  brandDna: BrandDnaInput | undefined,
): string {
  const personality = brandDna?.brandPersonality?.join(", ") ?? "unspecified";
  const industry = brandDna?.industry ?? "general";
  return (
    `This composition was assembled deterministically for a ${industry} brand with ${personality} personality traits. ` +
    `The ${layout.strategy} layout strategy creates a ${layout.emphasis}-emphasis reading path across ${layout.sectionCount} sections. ` +
    `A ${palette.mood} palette paired with ${typography.style} typography establishes the brand's tonal register. ` +
    `The ${material.surface} material surface ensures ${material.surface === "flat" ? "maximum legibility and universal compatibility" : "a distinctive visual personality"} ` +
    `appropriate for ${layout.hasSidebar ? "an application-like" : "a content-forward"} digital experience.`
  );
}

// ── Main report builder ───────────────────────────────────────────────────────

export function buildExplainabilityReport(params: {
  blueprint: BlueprintInput;
  layout: LayoutPlanInput;
  palette: PaletteInput;
  typography: TypographyInput;
  pattern: PatternInput;
  components: ComponentInput[];
  decoration: DecorationInput;
  material: MaterialInput;
  motif: MotifInput;
  brandDna: BrandDnaInput | undefined;
  fallbacks: FallbackRecord[];
}): ExplainabilityReport {
  const {
    blueprint, layout, palette, typography, pattern, components,
    decoration, material, motif, brandDna, fallbacks,
  } = params;

  return {
    layout: explainLayout(layout, blueprint, brandDna, fallbacks),
    palette: explainPalette(palette, brandDna, fallbacks),
    typography: explainTypography(typography, brandDna, fallbacks),
    pattern: explainPattern(pattern, brandDna, fallbacks),
    components: explainComponents(components, layout, brandDna, fallbacks),
    decoration: explainDecoration(decoration, material, brandDna, fallbacks),
    material: explainMaterial(material, brandDna, fallbacks),
    motif: explainMotif(motif, brandDna, fallbacks),
    compositionRationale: buildCompositionRationale(layout, palette, typography, material, brandDna),
  };
}
