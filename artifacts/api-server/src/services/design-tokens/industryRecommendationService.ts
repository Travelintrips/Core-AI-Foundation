// Team 10 — Industry & Style Recommendation Service
// Static knowledge base — no DB required.

import type { Industry, FontMood, IndustryRecommendation } from "./types.js";

// ── Static Recommendation Knowledge Base ─────────────────────────────────────

const INDUSTRY_RECOMMENDATIONS: Record<Industry, IndustryRecommendation> = {
  technology: {
    industry: "technology",
    recommendedFontPairSlugs: ["inter-source-serif", "roboto-lora", "space-grotesk-merriweather"],
    recommendedPaletteSlugs: ["tech-blue-slate", "neon-dark", "ocean-minimal"],
    rationale: "Technology brands demand clean, modern typography with strong readability at small sizes. Sans-serif display fonts paired with serif body fonts communicate precision and trust.",
    primaryMood: "modern",
    avoidMoods: ["traditional", "handwriting"],
    colorNotes: "Blues, teals, and high-contrast monochromatics dominate. Avoid warm reds that signal danger.",
    typographyNotes: "Tight letter-spacing for headings (−0.02em), generous line-height for body (1.7), monospace for code snippets.",
  },
  finance: {
    industry: "finance",
    recommendedFontPairSlugs: ["playfair-open-sans", "cormorant-raleway", "eb-garamond-nunito"],
    recommendedPaletteSlugs: ["navy-gold-classic", "dark-green-cream", "slate-silver"],
    rationale: "Finance demands authority and trust. Classic serif display fonts with clean sans-serif body copy communicate stability and professionalism.",
    primaryMood: "professional",
    avoidMoods: ["playful", "bold", "friendly"],
    colorNotes: "Navy, deep green, and gold convey wealth and stability. Avoid trendy neons or bright saturated palettes.",
    typographyNotes: "Conservative sizing, generous white space, strong heading hierarchy. Avoid decorative fonts entirely.",
  },
  healthcare: {
    industry: "healthcare",
    recommendedFontPairSlugs: ["nunito-source-sans", "lato-pt-serif", "poppins-open-sans"],
    recommendedPaletteSlugs: ["medical-blue-white", "calm-teal-mint", "soft-purple-grey"],
    rationale: "Healthcare requires approachability combined with clinical precision. Rounded sans-serifs for headings soften the professional edge, while body serif fonts aid reading long-form content.",
    primaryMood: "friendly",
    avoidMoods: ["bold", "display", "traditional"],
    colorNotes: "Soft blues, teals, and greens. Avoid aggressive reds (emergency connotation) unless for call-to-action only.",
    typographyNotes: "Large body font sizes (17-18px base), high line-height (1.8) for accessibility, avoid all-caps.",
  },
  education: {
    industry: "education",
    recommendedFontPairSlugs: ["merriweather-open-sans", "georgia-lato", "crimson-text-raleway"],
    recommendedPaletteSlugs: ["academic-burgundy-cream", "school-blue-yellow", "forest-green-warm"],
    rationale: "Education benefits from classic, trustworthy typography that signals authority without alienating learners. Readable serif body fonts and structured hierarchy aid comprehension.",
    primaryMood: "traditional",
    avoidMoods: ["minimal", "bold"],
    colorNotes: "Warm neutrals with accent primaries. Institutional blues and greens are universally trusted.",
    typographyNotes: "Strong visual hierarchy essential for structured content. Generous body size, clear heading levels.",
  },
  creative: {
    industry: "creative",
    recommendedFontPairSlugs: ["clash-display-dm-sans", "editorial-new-inter", "syne-bricolage"],
    recommendedPaletteSlugs: ["bold-creative-pop", "monochrome-editorial", "sunset-vibrant"],
    rationale: "Creative agencies and studios can push boundaries. Display and experimental typefaces for headings paired with highly readable sans-serifs demonstrate design sophistication.",
    primaryMood: "bold",
    avoidMoods: ["traditional", "professional"],
    colorNotes: "Bold, saturated palettes with unexpected combinations. Monochromatic with one vivid accent also works well.",
    typographyNotes: "Oversized display text, unconventional tracking, mixing weights dramatically within headings.",
  },
  retail: {
    industry: "retail",
    recommendedFontPairSlugs: ["gilroy-georgia", "poppins-garamond", "dm-sans-playfair"],
    recommendedPaletteSlugs: ["warm-retail-orange", "fashion-blush-charcoal", "clean-white-accent"],
    rationale: "Retail needs to balance aspirational aesthetics with practical readability for product descriptions and CTAs.",
    primaryMood: "friendly",
    avoidMoods: ["minimal", "monospace"],
    colorNotes: "Warm neutrals and accent colours that highlight CTAs. Seasonal palette adaptability is key.",
    typographyNotes: "Product names in medium weight, prices need visual prominence, body copy kept short and scannable.",
  },
  hospitality: {
    industry: "hospitality",
    recommendedFontPairSlugs: ["cormorant-raleway", "playfair-lato", "libre-baskerville-open-sans"],
    recommendedPaletteSlugs: ["luxury-gold-ivory", "resort-teal-sand", "warm-earth-cream"],
    rationale: "Hospitality brands need to evoke warmth, luxury, and welcome. Elegant serif display fonts with generous spacing communicate quality.",
    primaryMood: "elegant",
    avoidMoods: ["bold", "monospace", "modern"],
    colorNotes: "Warm earth tones, golds, and ivories. Jewel tones for luxury tier. Avoid cold blues.",
    typographyNotes: "Generous tracking on headings, italic accents, warm grey body text rather than pure black.",
  },
  legal: {
    industry: "legal",
    recommendedFontPairSlugs: ["times-new-roman-arial", "garamond-helvetica", "georgia-trebuchet"],
    recommendedPaletteSlugs: ["legal-navy-grey", "dark-charcoal-cream", "classic-burgundy-white"],
    rationale: "Legal practice demands maximum credibility. Classic serif fonts for body and display signal authority, tradition, and precision.",
    primaryMood: "traditional",
    avoidMoods: ["playful", "bold", "friendly"],
    colorNotes: "Deep navy, charcoal, burgundy on white. No bright colours — they undermine gravitas.",
    typographyNotes: "Document-grade spacing, no display or decorative fonts, consistent and rigid hierarchy.",
  },
  nonprofit: {
    industry: "nonprofit",
    recommendedFontPairSlugs: ["source-sans-source-serif", "nunito-merriweather", "karla-lora"],
    recommendedPaletteSlugs: ["hope-green-warm-yellow", "community-blue-orange", "compassion-purple-teal"],
    rationale: "Nonprofits need approachability, warmth, and emotional resonance. Humanist sans-serifs with warm serif body fonts strike the right balance.",
    primaryMood: "friendly",
    avoidMoods: ["minimal", "bold"],
    colorNotes: "Warm, optimistic palettes. Green for environmental causes, orange for community. Avoid corporate blues.",
    typographyNotes: "Accessibility first — large base size, high contrast, generous spacing, no decorative fonts.",
  },
  media: {
    industry: "media",
    recommendedFontPairSlugs: ["neue-haas-grotesk-tiempos", "publico-helvetica", "nyt-franklin-imperial"],
    recommendedPaletteSlugs: ["editorial-black-white", "news-ink-print", "media-dark-accent"],
    rationale: "Media and publishing demand excellent readability at scale with strong editorial identity. Contrast between display and body fonts creates clear hierarchy.",
    primaryMood: "professional",
    avoidMoods: ["playful", "handwriting"],
    colorNotes: "High contrast monochromatic with a single accent colour for section identity. Print-safe palette essential.",
    typographyNotes: "Column-optimised line length, tight but readable body leading, display fonts with strong editorial character.",
  },
  logistics: {
    industry: "logistics",
    recommendedFontPairSlugs: ["roboto-roboto-slab", "barlow-source-serif", "inter-lora"],
    recommendedPaletteSlugs: ["logistics-orange-navy", "industrial-grey-blue", "freight-dark-amber"],
    rationale: "Logistics and supply chain require clarity, trust, and functional communication. Clean sans-serif pairs with strong hierarchy work best.",
    primaryMood: "professional",
    avoidMoods: ["elegant", "playful", "handwriting"],
    colorNotes: "Strong oranges and navy communicate reliability and action. Industrial greys for secondary information.",
    typographyNotes: "Dense information needs structured hierarchy. Tabular figures for numbers, clear label styles.",
  },
  manufacturing: {
    industry: "manufacturing",
    recommendedFontPairSlugs: ["barlow-condensed-barlow", "oswald-source-sans", "industry-open-sans"],
    recommendedPaletteSlugs: ["industrial-dark-orange", "steel-blue-grey", "safety-yellow-dark"],
    rationale: "Manufacturing brands communicate strength, precision, and reliability. Condensed sans-serif fonts convey industrial efficiency.",
    primaryMood: "bold",
    avoidMoods: ["elegant", "playful", "handwriting"],
    colorNotes: "Strong industrial colours — steel blues, safety oranges, dark greys. High contrast for signage readability.",
    typographyNotes: "Condensed styles for headers save space in technical documents. Heavy weight hierarchy.",
  },
  real_estate: {
    industry: "real_estate",
    recommendedFontPairSlugs: ["playfair-display-raleway", "didot-proxima-nova", "cormorant-nunito"],
    recommendedPaletteSlugs: ["luxury-real-estate-navy", "modern-property-slate", "warm-home-cream"],
    rationale: "Real estate sells aspirational living. Elegant display fonts combined with clean body text communicate quality and taste.",
    primaryMood: "elegant",
    avoidMoods: ["playful", "bold", "monospace"],
    colorNotes: "Navy and gold for luxury tier, warm neutrals for residential, cool greys for commercial.",
    typographyNotes: "Property names in elegant serif, specifications in clean sans-serif, generous white space.",
  },
  food_beverage: {
    industry: "food_beverage",
    recommendedFontPairSlugs: ["poppins-playfair", "quicksand-lora", "lobster-open-sans"],
    recommendedPaletteSlugs: ["food-warm-appetising", "craft-earthy-brown", "fresh-green-white"],
    rationale: "Food and beverage needs to evoke appetite appeal and brand personality, whether artisanal craft or fresh-healthy.",
    primaryMood: "friendly",
    avoidMoods: ["minimal", "monospace"],
    colorNotes: "Warm reds, oranges, and browns stimulate appetite. Greens and whites for healthy brands. Avoid cold colours.",
    typographyNotes: "Handwriting accents for artisanal, clean sans for fast-casual, elegant serif for fine dining.",
  },
  fashion: {
    industry: "fashion",
    recommendedFontPairSlugs: ["editorial-neue-didot", "bodoni-helvetica", "vogue-futura"],
    recommendedPaletteSlugs: ["fashion-editorial-bw", "luxury-blush-gold", "street-bold-mono"],
    rationale: "Fashion demands strong aesthetic identity. Editorial display fonts with extreme weight contrast create the visual tension that drives fashion imagery.",
    primaryMood: "elegant",
    avoidMoods: ["friendly", "traditional"],
    colorNotes: "Monochromatics for high fashion, saturated bold palettes for streetwear, pastels for lifestyle.",
    typographyNotes: "Extreme size contrast, ultra-light or ultra-bold weights, generous tracking on all-caps headings.",
  },
  automotive: {
    industry: "automotive",
    recommendedFontPairSlugs: ["gotham-sabon", "din-georgia", "helvetica-neue-chronicle"],
    recommendedPaletteSlugs: ["automotive-dark-silver", "sport-red-black", "ev-clean-white-blue"],
    rationale: "Automotive combines engineering precision with aspirational appeal. Clean, engineered sans-serifs communicate reliability; pairing with a confident serif adds aspiration.",
    primaryMood: "modern",
    avoidMoods: ["handwriting", "playful"],
    colorNotes: "Chrome silvers and blacks for premium, bold reds for sport, clean whites and blues for electric.",
    typographyNotes: "Technical specifications in tabular figures, model names benefit from slight tracking, bold CTA weight.",
  },
  general: {
    industry: "general",
    recommendedFontPairSlugs: ["inter-merriweather", "poppins-lora", "nunito-source-serif"],
    recommendedPaletteSlugs: ["neutral-balanced", "clean-minimal-blue", "warm-professional"],
    rationale: "A balanced, versatile combination that works across most contexts without over-committing to a specific personality.",
    primaryMood: "professional",
    avoidMoods: [],
    colorNotes: "Neutral palettes with a single accent colour. High contrast for accessibility.",
    typographyNotes: "Clear hierarchy, readable body size (16-18px), good line-height. Safe, adaptable choices.",
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

export function getIndustryRecommendation(
  industry: Industry
): IndustryRecommendation {
  return INDUSTRY_RECOMMENDATIONS[industry] ?? INDUSTRY_RECOMMENDATIONS.general;
}

export function getRecommendationByMood(
  mood: FontMood
): IndustryRecommendation[] {
  return Object.values(INDUSTRY_RECOMMENDATIONS).filter(
    (r) => r.primaryMood === mood
  );
}

export function listAllIndustries(): Industry[] {
  return Object.keys(INDUSTRY_RECOMMENDATIONS) as Industry[];
}

export function rankFontPairForIndustry(
  pairMoods: FontMood[],
  pairIndustries: Industry[],
  targetIndustry: Industry
): { score: number; reasons: string[] } {
  const rec = getIndustryRecommendation(targetIndustry);
  let score = 0;
  const reasons: string[] = [];

  if (pairIndustries.includes(targetIndustry)) {
    score += 50;
    reasons.push(`Explicitly tagged for ${targetIndustry}`);
  }

  for (const mood of pairMoods) {
    if (mood === rec.primaryMood) {
      score += 30;
      reasons.push(`Primary mood '${mood}' matches industry recommendation`);
    }
    if (rec.avoidMoods.includes(mood)) {
      score -= 20;
      reasons.push(`Mood '${mood}' is discouraged for ${targetIndustry}`);
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export function rankPaletteForIndustry(
  paletteMoods: FontMood[],
  paletteIndustries: Industry[],
  targetIndustry: Industry
): { score: number; reasons: string[] } {
  return rankFontPairForIndustry(paletteMoods, paletteIndustries, targetIndustry);
}
