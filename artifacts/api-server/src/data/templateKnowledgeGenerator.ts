/**
 * Template Knowledge Generator — Enterprise Template Knowledge Library V5.0
 *
 * Generates 1200+ template knowledge entries algorithmically by cross-joining
 * categories × industries × styles with full knowledge payloads.
 *
 * Run via: pnpm --filter @workspace/api-server run seed:knowledge
 */

import type { InsertAiTemplate } from "@workspace/db";

// ─────────────────────────────────────────────────────────────────────────────
// Core taxonomy
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "Graphic Design", "Company Profile", "Presentation", "Pitch Deck",
  "Packaging", "Interior", "Fashion", "Social Media",
  "Landing Page", "Website", "Brand Identity", "Marketing",
] as const;

type Category = typeof CATEGORIES[number];

// Each category supports specific output formats
const CATEGORY_OUTPUT: Record<Category, string[]> = {
  "Graphic Design":   ["pdf", "png", "svg"],
  "Company Profile":  ["pdf", "pptx"],
  "Presentation":     ["pdf", "pptx"],
  "Pitch Deck":       ["pdf", "pptx"],
  "Packaging":        ["pdf", "png", "svg"],
  "Interior":         ["pdf", "png"],
  "Fashion":          ["pdf", "png"],
  "Social Media":     ["png", "svg"],
  "Landing Page":     ["html", "png"],
  "Website":          ["html", "png"],
  "Brand Identity":   ["pdf", "png", "svg"],
  "Marketing":        ["pdf", "png", "social_media"],
};

// Default section orders per category
const CATEGORY_SECTIONS: Record<Category, string[]> = {
  "Graphic Design":   ["cover_page", "portfolio_gallery", "about_company", "contact_form"],
  "Company Profile":  ["cover_page", "executive_summary", "about_company", "mission_vision", "statistics_impact", "services_grid", "team_members", "timeline_history", "portfolio_gallery", "partners_clients", "awards_certifications", "testimonials", "contact_form", "footer_full"],
  "Presentation":     ["cover_page", "executive_summary", "about_company", "services_grid", "statistics_impact", "case_study", "team_members", "cta_primary"],
  "Pitch Deck":       ["cover_page", "executive_summary", "mission_vision", "statistics_impact", "features_list", "pricing_table", "team_members", "testimonials", "cta_primary"],
  "Packaging":        ["hero_full_bleed", "product_detail", "features_list"],
  "Interior":         ["hero_full_bleed", "portfolio_gallery", "about_company", "services_grid", "team_members", "testimonials", "contact_form"],
  "Fashion":          ["hero_full_bleed", "products_showcase", "about_company", "social_media_feed", "contact_form"],
  "Social Media":     ["hero_full_bleed", "product_detail", "cta_primary"],
  "Landing Page":     ["hero_split", "statistics_impact", "features_list", "testimonials", "pricing_table", "faq", "cta_primary", "footer_full"],
  "Website":          ["hero_full_bleed", "about_company", "services_grid", "portfolio_gallery", "testimonials", "team_members", "partners_clients", "cta_primary", "contact_form", "footer_full"],
  "Brand Identity":   ["cover_page", "about_company", "mission_vision", "portfolio_gallery", "partners_clients"],
  "Marketing":        ["hero_full_bleed", "statistics_impact", "features_list", "testimonials", "cta_primary"],
};

// ── Style configs ─────────────────────────────────────────────────────────────

interface StyleConfig {
  style: string;
  colorTheme: { primary: string; secondary: string; accent: string; background: string; text: string };
  typography: { heading: string; body: string; style: string };
  layout: string;
  designStyle: string;
  layoutStyle: string;
  spacingStyle: string;
  illustrationStyle: string;
  photographyStyle: string;
  iconStyle: string;
  heroLayout: string;
  gridSystem: string;
  whitespaceRules: string;
  personalities: string[];
  emotions: string[];
  archetypes: string[];
  voice: string;
  tone: string;
  artDirectionPrompt: string;
  imagePrompt: string;
  negativePrompt: string;
  checklist: string[];
  designRules: string[];
  prohibitedPatterns: string[];
}

const STYLE_CONFIGS: Record<string, StyleConfig> = {
  modern: {
    style: "modern", colorTheme: { primary: "#0A1628", secondary: "#2563EB", accent: "#F59E0B", background: "#F9FAFB", text: "#111827" },
    typography: { heading: "Inter", body: "Inter", style: "geometric-sans" },
    layout: "two-column", designStyle: "modern", layoutStyle: "grid", spacingStyle: "balanced",
    illustrationStyle: "geometric", photographyStyle: "editorial", iconStyle: "outline",
    heroLayout: "split", gridSystem: "12-column", whitespaceRules: "balanced",
    personalities: ["innovative", "professional", "reliable"], emotions: ["confident", "trustworthy"],
    archetypes: ["Hero", "Ruler"], voice: "authoritative", tone: "professional",
    artDirectionPrompt: "Clean modern composition, sharp geometry, professional editorial photography, purposeful whitespace.",
    imagePrompt: "Modern professional environment, clean lines, natural lighting, minimal clutter",
    negativePrompt: "cluttered, vintage, ornate, handdrawn, neon",
    checklist: ["Check contrast ratios (4.5:1 min)", "Align all elements to 8px grid", "Verify font hierarchy", "Test on mobile viewport"],
    designRules: ["Maximum 3 type sizes per spread", "8px base grid unit", "Single accent color only"],
    prohibitedPatterns: ["Decorative borders", "Multiple competing colors", "Excessive gradients"],
  },
  minimalist: {
    style: "minimalist", colorTheme: { primary: "#1A1A1A", secondary: "#6B7280", accent: "#000000", background: "#FFFFFF", text: "#1A1A1A" },
    typography: { heading: "Helvetica Neue", body: "Helvetica Neue", style: "neutral-grotesque" },
    layout: "single-column", designStyle: "minimalist", layoutStyle: "single-column", spacingStyle: "generous",
    illustrationStyle: "none", photographyStyle: "editorial", iconStyle: "outline",
    heroLayout: "centered", gridSystem: "flexible", whitespaceRules: "generous",
    personalities: ["refined", "minimal", "precise"], emotions: ["calm", "focused"],
    archetypes: ["Sage", "Creator"], voice: "understated", tone: "refined",
    artDirectionPrompt: "Maximum whitespace, single focal point, pure typography. Nothing decorative.",
    imagePrompt: "Minimal, single subject, white background, clean studio lighting",
    negativePrompt: "busy, colorful, decorative, crowded, loud",
    checklist: ["Ensure generous margins (min 15%)", "Single typeface family only", "No decorative elements", "High contrast text"],
    designRules: ["One typeface, weight variation only", "Minimum 15% margin on all sides", "No decorative borders or rules"],
    prohibitedPatterns: ["Multiple fonts", "Decorative elements", "Gradients", "Patterns or textures"],
  },
  luxury: {
    style: "luxury", colorTheme: { primary: "#0D0D0D", secondary: "#4A0E1A", accent: "#C9A84C", background: "#F5F0E8", text: "#0D0D0D" },
    typography: { heading: "Cormorant Garamond", body: "Montserrat", style: "editorial-serif" },
    layout: "editorial", designStyle: "luxury", layoutStyle: "editorial", spacingStyle: "generous",
    illustrationStyle: "none", photographyStyle: "editorial", iconStyle: "none",
    heroLayout: "full-bleed", gridSystem: "editorial", whitespaceRules: "generous",
    personalities: ["prestigious", "exclusive", "sophisticated"], emotions: ["desire", "admiration"],
    archetypes: ["Ruler", "Lover"], voice: "exclusive", tone: "formal",
    artDirectionPrompt: "Editorial luxury photography, gold accents, rich textures, dark moody atmosphere.",
    imagePrompt: "Luxury editorial photography, dark moody lighting, gold metallic accents, high fashion aesthetic",
    negativePrompt: "stock photo, generic, flat, colorful, budget",
    checklist: ["Gold accent usage — maximum 20% of surface", "Verify serif at all sizes", "Check luxury feel vs competitors", "No stock photography"],
    designRules: ["Gold accent: maximum 20% of composition", "Only editorial photography", "Generous whitespace — luxury breathes"],
    prohibitedPatterns: ["Stock photos", "Clip art", "Multiple fonts", "Bright competing colors"],
  },
  elegant: {
    style: "elegant", colorTheme: { primary: "#C4A09A", secondary: "#9B9490", accent: "#E8D5B0", background: "#F0E6E2", text: "#2D2D2D" },
    typography: { heading: "Cormorant", body: "Lato", style: "romantic-serif" },
    layout: "editorial", designStyle: "elegant", layoutStyle: "editorial", spacingStyle: "airy",
    illustrationStyle: "organic", photographyStyle: "lifestyle", iconStyle: "outline",
    heroLayout: "editorial", gridSystem: "asymmetric", whitespaceRules: "generous",
    personalities: ["refined", "graceful", "romantic"], emotions: ["romantic", "graceful"],
    archetypes: ["Lover", "Creator"], voice: "warm", tone: "refined",
    artDirectionPrompt: "Soft natural light, romantic atmosphere, delicate elements, airy composition.",
    imagePrompt: "Soft romantic photography, blush tones, natural flowers, feminine styling",
    negativePrompt: "harsh, dark, industrial, heavy, masculine",
    checklist: ["Soft color application", "Graceful type spacing", "Natural photography only", "No harsh geometric elements"],
    designRules: ["Soft palette only", "Italic serif for key headings", "Floral/organic accents permitted"],
    prohibitedPatterns: ["Heavy typography", "Dark backgrounds", "Geometric harshness", "Industrial elements"],
  },
  corporate: {
    style: "corporate", colorTheme: { primary: "#1E40AF", secondary: "#374151", accent: "#10B981", background: "#F3F4F6", text: "#111827" },
    typography: { heading: "Inter", body: "Inter", style: "humanist-sans" },
    layout: "grid", designStyle: "corporate", layoutStyle: "structured-grid", spacingStyle: "balanced",
    illustrationStyle: "geometric", photographyStyle: "editorial", iconStyle: "outline",
    heroLayout: "split", gridSystem: "12-column", whitespaceRules: "balanced",
    personalities: ["professional", "reliable", "systematic"], emotions: ["trustworthy", "competent"],
    archetypes: ["Ruler", "Caregiver"], voice: "authoritative", tone: "formal",
    artDirectionPrompt: "Professional enterprise environment, diverse team, modern offices, data visualization.",
    imagePrompt: "Corporate professional photography, diverse business people, modern office, confident poses",
    negativePrompt: "casual, artsy, vintage, creative chaos, inconsistent",
    checklist: ["WCAG AA accessibility", "Consistent grid alignment", "Brand color compliance", "Professional photography only"],
    designRules: ["Strict grid adherence", "Single brand color + neutrals", "Professional photography mandatory"],
    prohibitedPatterns: ["Decorative elements", "Playful shapes", "Hand-drawn", "Extreme minimalism"],
  },
  bold: {
    style: "bold", colorTheme: { primary: "#DC2626", secondary: "#0A0A0A", accent: "#FDE047", background: "#FFFFFF", text: "#0A0A0A" },
    typography: { heading: "Bebas Neue", body: "Roboto", style: "condensed-display" },
    layout: "full-bleed", designStyle: "bold", layoutStyle: "poster", spacingStyle: "compact",
    illustrationStyle: "geometric", photographyStyle: "editorial", iconStyle: "filled",
    heroLayout: "full-bleed", gridSystem: "asymmetric", whitespaceRules: "compact",
    personalities: ["bold", "energetic", "direct"], emotions: ["energetic", "powerful"],
    archetypes: ["Hero", "Outlaw"], voice: "direct", tone: "energetic",
    artDirectionPrompt: "Maximum contrast, oversized type, high energy, strong diagonal lines.",
    imagePrompt: "High impact photography, strong color, dynamic action, bold composition",
    negativePrompt: "soft, pastel, delicate, minimal, quiet, muted",
    checklist: ["High contrast verified", "Type at bold/black weight", "Strong visual hierarchy", "Impact on first view"],
    designRules: ["Contrast ratio maximum", "Bold/black type weight only for headings", "No soft shadows"],
    prohibitedPatterns: ["Pastel colors", "Soft shadows", "Delicate typography", "Excessive whitespace"],
  },
  premium: {
    style: "premium", colorTheme: { primary: "#1B2A4A", secondary: "#8896A5", accent: "#B8963E", background: "#F8F6F2", text: "#1B2A4A" },
    typography: { heading: "Merriweather", body: "Open Sans", style: "authoritative-serif" },
    layout: "two-column", designStyle: "premium", layoutStyle: "structured", spacingStyle: "balanced",
    illustrationStyle: "geometric", photographyStyle: "editorial", iconStyle: "filled",
    heroLayout: "split", gridSystem: "12-column", whitespaceRules: "balanced",
    personalities: ["premium", "authoritative", "quality-focused"], emotions: ["trustworthy", "confident"],
    archetypes: ["Ruler", "Hero"], voice: "authoritative", tone: "formal",
    artDirectionPrompt: "Premium quality materials, confident composition, professional environment, subtle texture.",
    imagePrompt: "Premium professional photography, confident subjects, quality materials",
    negativePrompt: "cheap, generic, stock photo, playful, cartoonish",
    checklist: ["Gold accent at 15% max", "Premium photography only", "No stock images", "Typography weight contrast"],
    designRules: ["Gold/metallic accents sparingly", "Two-weight typography minimum", "Premium photography only"],
    prohibitedPatterns: ["Generic stock photos", "Flat icon sets", "Low-quality images"],
  },
  tech_startup: {
    style: "tech_startup", colorTheme: { primary: "#7C3AED", secondary: "#2563EB", accent: "#F59E0B", background: "#FFFFFF", text: "#0F172A" },
    typography: { heading: "Sora", body: "DM Sans", style: "friendly-geometric" },
    layout: "landing-page", designStyle: "tech_startup", layoutStyle: "landing", spacingStyle: "balanced",
    illustrationStyle: "geometric", photographyStyle: "lifestyle", iconStyle: "outline",
    heroLayout: "centered", gridSystem: "12-column", whitespaceRules: "balanced",
    personalities: ["innovative", "disruptive", "friendly"], emotions: ["innovative", "excited"],
    archetypes: ["Hero", "Magician"], voice: "conversational", tone: "confident",
    artDirectionPrompt: "Modern tech office, diverse team, laptop/device-forward, gradient accents.",
    imagePrompt: "Tech startup team, modern office, diverse people, laptops, collaboration, bright",
    negativePrompt: "traditional corporate, formal, dated, suit-and-tie",
    checklist: ["Mobile-first layout", "CTA visibility", "Fast visual hierarchy", "Social proof placement"],
    designRules: ["One primary gradient allowed", "Round corners (8px min)", "Device mockups welcome"],
    prohibitedPatterns: ["Corporate stiffness", "Traditional serif", "Formal boardroom", "Dark heavy style"],
  },
};

// Fallback style config
function getStyleConfig(style: string): StyleConfig {
  return STYLE_CONFIGS[style] ?? STYLE_CONFIGS.modern;
}

// ── Industry + business context lookup ────────────────────────────────────────

const INDUSTRY_CONTEXT: Record<string, { businessType: string; market: string; persona: string; price: string }> = {
  fashion: { businessType: "D2C", market: "national", persona: "Fashion-forward professional, 25-40", price: "mid-market" },
  luxury_fashion: { businessType: "D2C", market: "global", persona: "HNWI, 30-60, quality-obsessed", price: "luxury" },
  technology: { businessType: "B2B", market: "global", persona: "Tech decision maker, 35-50", price: "premium" },
  saas: { businessType: "B2B", market: "global", persona: "SaaS buyer, 28-45", price: "mid-market" },
  fintech: { businessType: "B2C", market: "national", persona: "Digitally-native finance user, 25-40", price: "mid-market" },
  finance: { businessType: "B2C", market: "national", persona: "Wealth management client, 40-60", price: "premium" },
  healthcare: { businessType: "B2C", market: "local", persona: "Patient / caregiver, all ages", price: "mid-market" },
  beauty: { businessType: "D2C", market: "national", persona: "Beauty enthusiast, 20-40, female-skew", price: "mid-market" },
  food_beverage: { businessType: "B2C", market: "local", persona: "Quality-conscious diner, 25-50", price: "mid-market" },
  coffee: { businessType: "B2C", market: "local", persona: "Coffee enthusiast, 22-40", price: "mid-market" },
  restaurant: { businessType: "B2C", market: "local", persona: "Social diner, 25-55", price: "mid-market" },
  real_estate: { businessType: "B2C", market: "national", persona: "Property buyer, 28-55", price: "premium" },
  logistics: { businessType: "B2B", market: "national", persona: "Supply chain manager, 30-55", price: "mid-market" },
  manufacturing: { businessType: "B2B", market: "national", persona: "Procurement manager, 30-55", price: "mid-market" },
  education: { businessType: "B2C", market: "national", persona: "Student and parent, 5-50", price: "mid-market" },
  construction: { businessType: "B2B", market: "local", persona: "Property developer, 35-60", price: "mid-market" },
  automotive: { businessType: "B2C", market: "national", persona: "Car buyer, 25-60", price: "premium" },
  hotel: { businessType: "B2C", market: "global", persona: "Luxury traveler, 30-65", price: "premium" },
  travel: { businessType: "B2C", market: "global", persona: "Adventure traveler, 25-45", price: "mid-market" },
  agriculture: { businessType: "B2B", market: "national", persona: "Agribusiness operator, 30-60", price: "budget" },
  mining: { businessType: "B2B", market: "global", persona: "Mining executive, 35-60", price: "enterprise" },
  energy: { businessType: "B2B", market: "national", persona: "Energy sector leader, 35-60", price: "enterprise" },
  government: { businessType: "B2G", market: "national", persona: "Citizen / public official", price: "budget" },
  ngo: { businessType: "Nonprofit", market: "national", persona: "Donor / beneficiary", price: "budget" },
  entertainment: { businessType: "B2C", market: "global", persona: "Entertainment consumer, 15-55", price: "mid-market" },
  sports: { businessType: "B2C", market: "national", persona: "Sports fan / athlete, 15-50", price: "mid-market" },
  interior_design: { businessType: "B2C", market: "local", persona: "Homeowner, 28-55", price: "premium" },
  consulting: { businessType: "B2B", market: "national", persona: "C-suite executive, 38-60", price: "premium" },
  retail: { businessType: "B2C", market: "national", persona: "General consumer, 18-55", price: "mid-market" },
  wedding: { businessType: "B2C", market: "local", persona: "Engaged couple, 22-40", price: "premium" },
  modest_fashion: { businessType: "D2C", market: "national", persona: "Modest fashion shopper, 20-45", price: "mid-market" },
  streetwear_brand: { businessType: "D2C", market: "global", persona: "Urban youth, 16-30", price: "mid-market" },
};

function getIndustryContext(industry: string) {
  return INDUSTRY_CONTEXT[industry] ?? { businessType: "B2C", market: "national", persona: "General audience", price: "mid-market" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Matrix: 100+ templates per category
// We define the exact industry×style matrix for each category.
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateSpec {
  category: Category;
  industry: string;
  style: string;
  name: string;
  subCategory?: string;
}

function generateCode(category: string, industry: string, style: string, index: number): string {
  const cat = category.replace(/[^A-Z]/gi, "").substring(0, 3).toUpperCase();
  const ind = industry.replace(/[^A-Z]/gi, "").substring(0, 3).toUpperCase();
  const sty = style.replace(/[^A-Z]/gi, "").substring(0, 3).toUpperCase();
  return `${cat}-${ind}-${sty}-${String(index).padStart(3, "0")}`;
}

function generateSlug(category: string, industry: string, style: string, index: number): string {
  const base = `${category}-${industry}-${style}-${index}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-");
  return base;
}

function buildTemplate(spec: TemplateSpec, index: number): InsertAiTemplate {
  const sc = getStyleConfig(spec.style);
  const ic = getIndustryContext(spec.industry);
  const sections = CATEGORY_SECTIONS[spec.category] ?? [];
  const outputs = CATEGORY_OUTPUT[spec.category] ?? ["pdf"];

  const templateCode = generateCode(spec.category, spec.industry, spec.style, index);

  return {
    templateCode,
    name: spec.name,
    description: `${spec.style.charAt(0).toUpperCase() + spec.style.slice(1)} ${spec.category} template optimized for the ${spec.industry.replace(/_/g, " ")} industry.`,
    category: spec.category,
    style: spec.style,
    industry: spec.industry,
    colorTheme: sc.colorTheme,
    typography: sc.typography,
    layout: sc.layout,
    supportedPackages: ["starter", "standard", "professional", "enterprise"],
    brandDnaTags: {
      personalities: sc.personalities,
      voices: [sc.voice],
      audiences: [ic.persona],
      industries: [spec.industry],
    },
    previewImages: { thumbnail: "", hero: "", gallery: [] },
    editable: true,
    isPremium: ["luxury", "high_fashion", "modern_luxury"].includes(spec.style),
    version: "1.0",
    status: "published",
    featured: false,
    sortOrder: index,
    views: 0,
    selections: 0,
    previewsGenerated: 0,
    conversions: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate 100+ templates per category
// ─────────────────────────────────────────────────────────────────────────────

const COMPANY_PROFILE_SPECS: Omit<TemplateSpec, "category">[] = [
  // Technology
  { industry: "technology", style: "modern", name: "Tech Enterprise Company Profile — Modern" },
  { industry: "technology", style: "corporate", name: "Technology Corporation Profile — Corporate" },
  { industry: "technology", style: "premium", name: "Tech Leader Company Profile — Premium" },
  { industry: "saas", style: "tech_startup", name: "SaaS Company Profile — Startup" },
  { industry: "saas", style: "modern", name: "SaaS Platform Company Profile — Modern" },
  { industry: "fintech", style: "modern", name: "Fintech Company Profile — Modern" },
  { industry: "fintech", style: "corporate", name: "Fintech Corporation Profile — Corporate" },
  // Finance
  { industry: "finance", style: "premium", name: "Financial Institution Profile — Premium" },
  { industry: "finance", style: "classic", name: "Bank & Finance Profile — Classic" },
  { industry: "finance", style: "corporate", name: "Finance Corporation Profile — Corporate" },
  { industry: "consulting", style: "premium", name: "Consulting Firm Profile — Premium" },
  { industry: "consulting", style: "corporate", name: "Management Consulting Profile — Corporate" },
  // Fashion
  { industry: "fashion", style: "editorial", name: "Fashion House Company Profile — Editorial" },
  { industry: "luxury_fashion", style: "luxury", name: "Luxury Fashion Brand Profile — Luxury" },
  { industry: "luxury_fashion", style: "modern_luxury", name: "Luxury Fashion Profile — Modern Luxury" },
  { industry: "modest_fashion", style: "elegant", name: "Modest Fashion Brand Profile — Elegant" },
  { industry: "streetwear_brand", style: "bold", name: "Streetwear Brand Profile — Bold" },
  { industry: "streetwear_brand", style: "streetwear", name: "Streetwear Company Profile — Urban" },
  // Beauty
  { industry: "beauty", style: "elegant", name: "Beauty Brand Company Profile — Elegant" },
  { industry: "beauty", style: "minimalist", name: "Clean Beauty Profile — Minimalist" },
  { industry: "beauty", style: "modern_luxury", name: "Luxury Beauty Company Profile" },
  // Food & Beverage
  { industry: "food_beverage", style: "modern", name: "F&B Company Profile — Modern" },
  { industry: "coffee", style: "retro", name: "Specialty Coffee Brand Profile — Retro" },
  { industry: "coffee", style: "scandinavian", name: "Coffee Company Profile — Scandinavian" },
  { industry: "restaurant", style: "elegant", name: "Fine Dining Restaurant Profile — Elegant" },
  { industry: "restaurant", style: "industrial", name: "Restaurant Group Profile — Industrial" },
  // Healthcare
  { industry: "healthcare", style: "modern", name: "Healthcare Company Profile — Modern" },
  { industry: "healthcare", style: "corporate", name: "Medical Group Company Profile — Corporate" },
  // Real Estate
  { industry: "real_estate", style: "premium", name: "Real Estate Developer Profile — Premium" },
  { industry: "real_estate", style: "modern", name: "Property Developer Profile — Modern" },
  { industry: "real_estate", style: "luxury", name: "Luxury Real Estate Profile — Luxury" },
  // Logistics
  { industry: "logistics", style: "corporate", name: "Logistics Company Profile — Corporate" },
  { industry: "logistics", style: "modern", name: "Logistics & Supply Chain Profile — Modern" },
  { industry: "logistics", style: "industrial", name: "Freight Company Profile — Industrial" },
  // Manufacturing
  { industry: "manufacturing", style: "corporate", name: "Manufacturing Company Profile — Corporate" },
  { industry: "manufacturing", style: "industrial", name: "Industrial Manufacturer Profile — Industrial" },
  { industry: "manufacturing", style: "premium", name: "Precision Manufacturing Profile — Premium" },
  // Construction
  { industry: "construction", style: "corporate", name: "Construction Company Profile — Corporate" },
  { industry: "construction", style: "bold", name: "Construction Group Profile — Bold" },
  { industry: "construction", style: "modern", name: "Modern Construction Profile" },
  // Automotive
  { industry: "automotive", style: "premium", name: "Automotive Brand Profile — Premium" },
  { industry: "automotive", style: "masculine", name: "Automotive Company Profile — Bold Masculine" },
  { industry: "automotive", style: "modern", name: "Auto Manufacturer Profile — Modern" },
  // Hotel & Travel
  { industry: "hotel", style: "luxury", name: "Luxury Hotel Company Profile — Luxury" },
  { industry: "hotel", style: "elegant", name: "Boutique Hotel Profile — Elegant" },
  { industry: "travel", style: "modern", name: "Travel Agency Company Profile — Modern" },
  { industry: "travel", style: "bold", name: "Adventure Tourism Profile — Bold" },
  // Agriculture
  { industry: "agriculture", style: "organic", name: "Agribusiness Company Profile — Organic" },
  { industry: "agriculture", style: "modern", name: "Modern Agriculture Profile" },
  // Energy & Mining
  { industry: "energy", style: "corporate", name: "Energy Company Profile — Corporate" },
  { industry: "energy", style: "industrial", name: "Energy Group Profile — Industrial" },
  { industry: "mining", style: "industrial", name: "Mining Company Profile — Industrial" },
  { industry: "mining", style: "corporate", name: "Mining Corporation Profile — Corporate" },
  // Government & NGO
  { industry: "government", style: "government", name: "Government Agency Profile — Formal" },
  { industry: "government", style: "corporate", name: "Public Institution Profile — Corporate" },
  { industry: "ngo", style: "ngo_social", name: "NGO Organization Profile — Social" },
  { industry: "ngo", style: "organic", name: "Nonprofit Profile — Organic" },
  // Education
  { industry: "education", style: "modern", name: "Educational Institution Profile — Modern" },
  { industry: "education", style: "corporate", name: "University Profile — Corporate" },
  // Entertainment & Sports
  { industry: "entertainment", style: "bold", name: "Entertainment Company Profile — Bold" },
  { industry: "sports", style: "bold", name: "Sports Organization Profile — Bold" },
  // Interior Design
  { industry: "interior_design", style: "japandi", name: "Interior Design Studio Profile — Japandi" },
  { industry: "interior_design", style: "minimalist", name: "Interior Studio Profile — Minimalist" },
  // Wedding
  { industry: "wedding", style: "elegant", name: "Wedding Agency Profile — Elegant" },
  { industry: "wedding", style: "luxury", name: "Luxury Wedding Planner Profile — Luxury" },
  // Retail
  { industry: "retail", style: "modern", name: "Retail Company Profile — Modern" },
  { industry: "retail", style: "corporate", name: "Retail Corporation Profile — Corporate" },
  // Additional to reach 100+
  { industry: "technology", style: "glassmorphism", name: "Tech Innovation Profile — Glassmorphism" },
  { industry: "beauty", style: "feminine", name: "Beauty Brand Profile — Feminine" },
  { industry: "food_beverage", style: "organic", name: "Organic Food Brand Profile" },
  { industry: "healthcare", style: "healthcare", name: "Medical Center Profile — Healthcare" },
  { industry: "finance", style: "premium", name: "Investment Firm Profile — Premium" },
  { industry: "consulting", style: "modern", name: "Strategy Consulting Profile — Modern" },
  { industry: "real_estate", style: "modern_luxury", name: "Premium Real Estate Profile" },
  { industry: "hotel", style: "scandinavian", name: "Design Hotel Profile — Scandinavian" },
  { industry: "fashion", style: "minimalist", name: "Fashion Brand Profile — Minimalist" },
  { industry: "technology", style: "dark_mode", name: "Tech Company Profile — Dark Mode" },
  { industry: "education", style: "playful", name: "EdTech Company Profile — Playful" },
  { industry: "ngo", style: "modern", name: "Social Enterprise Profile — Modern" },
  { industry: "sports", style: "sportswear", name: "Sports Brand Profile — Athletic" },
  { industry: "manufacturing", style: "premium", name: "High-Precision Manufacturing Profile" },
  { industry: "logistics", style: "premium", name: "Premium Logistics Profile" },
  { industry: "energy", style: "modern", name: "Renewable Energy Profile — Modern" },
  { industry: "construction", style: "premium", name: "Premium Construction Profile" },
  { industry: "automotive", style: "luxury", name: "Luxury Automotive Profile" },
  { industry: "retail", style: "bold", name: "Retail Brand Profile — Bold" },
  { industry: "wedding", style: "feminine", name: "Bridal Studio Profile — Feminine" },
  { industry: "beauty", style: "editorial", name: "Editorial Beauty Brand Profile" },
  { industry: "coffee", style: "vintage", name: "Heritage Coffee Brand Profile — Vintage" },
  { industry: "restaurant", style: "luxury", name: "Luxury Restaurant Profile" },
  { industry: "interior_design", style: "luxury", name: "Luxury Interior Studio Profile" },
  { industry: "interior_design", style: "modern", name: "Interior Design Firm Profile — Modern" },
  { industry: "travel", style: "organic", name: "Sustainable Tourism Profile" },
  { industry: "agriculture", style: "corporate", name: "Agricultural Corporation Profile" },
  { industry: "streetwear_brand", style: "dark_mode", name: "Streetwear Brand Profile — Dark" },
  { industry: "modest_fashion", style: "modern", name: "Modest Fashion Brand Profile — Modern" },
];

// Generate all specs for all 12 categories
function generateAllSpecs(): TemplateSpec[] {
  const all: TemplateSpec[] = [];

  // Company Profile
  COMPANY_PROFILE_SPECS.forEach(s => all.push({ ...s, category: "Company Profile" }));

  // Pitch Deck — 100+ entries using similar industry coverage
  const pitchIndustries = [
    "saas", "fintech", "technology", "healthcare", "education", "food_beverage",
    "real_estate", "fashion", "beauty", "logistics", "manufacturing", "energy",
    "entertainment", "sports", "agriculture", "hotel", "retail", "ngo",
    "consulting", "construction", "automotive", "travel",
  ];
  const pitchStyles = ["tech_startup", "modern", "corporate", "premium", "bold", "minimalist"];
  pitchIndustries.forEach((ind, i) => {
    pitchStyles.forEach((sty, j) => {
      if (i * pitchStyles.length + j < 120) {
        const names: Record<string, string> = {
          tech_startup: "Startup Pitch Deck",
          modern: "Modern Pitch Deck",
          corporate: "Corporate Investor Deck",
          premium: "Premium Investor Presentation",
          bold: "Bold Pitch Deck",
          minimalist: "Minimal Pitch Deck",
        };
        all.push({ category: "Pitch Deck", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} — ${names[sty] ?? "Pitch Deck"}` });
      }
    });
  });

  // Presentation — 100+
  const presIndustries = ["technology", "finance", "healthcare", "education", "logistics", "manufacturing", "consulting", "government", "energy", "retail", "hotel", "ngo"];
  const presStyles = ["corporate", "modern", "premium", "minimalist", "bold", "elegant", "scandinavian", "tech_startup", "dark_mode"];
  presIndustries.forEach((ind, i) => {
    presStyles.forEach((sty, j) => {
      if (i * presStyles.length + j < 110) {
        all.push({ category: "Presentation", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Business Presentation — ${sty}` });
      }
    });
  });

  // Graphic Design — 100+
  const gdIndustries = ["fashion", "beauty", "food_beverage", "coffee", "technology", "entertainment", "sports", "luxury_fashion", "wedding", "travel", "retail", "ngo"];
  const gdStyles = ["modern", "minimalist", "luxury", "bold", "editorial", "retro", "vintage", "elegant", "corporate", "contemporary"];
  gdIndustries.forEach((ind, i) => {
    gdStyles.forEach((sty, j) => {
      if (i * gdStyles.length + j < 110) {
        all.push({ category: "Graphic Design", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Graphic Design — ${sty}` });
      }
    });
  });

  // Brand Identity — 100+
  const biIndustries = ["fashion", "luxury_fashion", "beauty", "food_beverage", "technology", "saas", "healthcare", "education", "sports", "entertainment", "hotel", "retail", "ngo", "consulting"];
  const biStyles = ["modern", "minimalist", "luxury", "elegant", "bold", "corporate", "organic", "retro", "contemporary", "tech_startup"];
  biIndustries.forEach((ind, i) => {
    biStyles.forEach((sty, j) => {
      if (i * biStyles.length + j < 120) {
        all.push({ category: "Brand Identity", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Brand Identity System — ${sty}` });
      }
    });
  });

  // Social Media — 100+
  const smIndustries = ["fashion", "beauty", "food_beverage", "coffee", "technology", "saas", "sports", "entertainment", "travel", "retail", "education", "luxury_fashion"];
  const smStyles = ["modern", "bold", "editorial", "playful", "minimalist", "contemporary", "glassmorphism", "dark_mode", "luxury", "retro"];
  smIndustries.forEach((ind, i) => {
    smStyles.forEach((sty, j) => {
      if (i * smStyles.length + j < 110) {
        all.push({ category: "Social Media", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Social Media Kit — ${sty}` });
      }
    });
  });

  // Landing Page — 100+
  const lpIndustries = ["saas", "technology", "fintech", "healthcare", "education", "food_beverage", "retail", "consulting", "real_estate", "hotel", "beauty", "sports"];
  const lpStyles = ["tech_startup", "modern", "corporate", "bold", "minimalist", "premium", "light_mode", "glassmorphism", "organic"];
  lpIndustries.forEach((ind, i) => {
    lpStyles.forEach((sty, j) => {
      if (i * lpStyles.length + j < 110) {
        all.push({ category: "Landing Page", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Landing Page — ${sty}` });
      }
    });
  });

  // Website — 100+
  const webIndustries = ["technology", "saas", "fashion", "beauty", "food_beverage", "healthcare", "education", "hotel", "retail", "consulting", "interior_design", "ngo"];
  const webStyles = ["modern", "minimalist", "corporate", "tech_startup", "elegant", "bold", "organic", "premium", "dark_mode", "light_mode"];
  webIndustries.forEach((ind, i) => {
    webStyles.forEach((sty, j) => {
      if (i * webStyles.length + j < 110) {
        all.push({ category: "Website", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Website — ${sty}` });
      }
    });
  });

  // Marketing — 100+
  const mkIndustries = ["fashion", "beauty", "food_beverage", "technology", "healthcare", "education", "retail", "entertainment", "hotel", "sports", "consulting", "real_estate"];
  const mkStyles = ["bold", "modern", "editorial", "minimalist", "corporate", "playful", "elegant", "retro", "contemporary"];
  mkIndustries.forEach((ind, i) => {
    mkStyles.forEach((sty, j) => {
      if (i * mkStyles.length + j < 110) {
        all.push({ category: "Marketing", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Marketing Material — ${sty}` });
      }
    });
  });

  // Packaging — 100+
  const pkgIndustries = ["food_beverage", "beauty", "coffee", "fashion", "luxury_fashion", "retail", "agriculture", "healthcare", "entertainment"];
  const pkgStyles = ["modern", "minimalist", "luxury", "bold", "organic", "retro", "vintage", "elegant", "playful", "corporate"];
  pkgIndustries.forEach((ind, i) => {
    pkgStyles.forEach((sty, j) => {
      if (i * pkgStyles.length + j < 110) {
        all.push({ category: "Packaging", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Packaging Design — ${sty}` });
      }
    });
  });

  // Interior — 100+
  const intIndustries = ["hotel", "restaurant", "retail", "technology", "healthcare", "education", "luxury_fashion", "beauty", "finance", "interior_design", "real_estate"];
  const intStyles = ["japandi", "minimalist", "luxury", "modern", "scandinavian", "industrial", "elegant", "contemporary", "neo_minimalism", "modern_luxury"];
  intIndustries.forEach((ind, i) => {
    intStyles.forEach((sty, j) => {
      if (i * intStyles.length + j < 110) {
        all.push({ category: "Interior", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Interior Concept — ${sty}` });
      }
    });
  });

  // Fashion — 100+
  const fashIndustries = ["fashion", "luxury_fashion", "modest_fashion", "streetwear_brand", "beauty", "hotel", "sports", "wedding", "interior_design", "entertainment"];
  const fashStyles = ["editorial", "luxury", "minimalist", "bold", "elegant", "high_fashion", "modern_luxury", "feminine", "streetwear", "sportswear"];
  fashIndustries.forEach((ind, i) => {
    fashStyles.forEach((sty, j) => {
      if (i * fashStyles.length + j < 110) {
        all.push({ category: "Fashion", industry: ind, style: sty, name: `${ind.replace(/_/g, " ")} Fashion Design — ${sty}` });
      }
    });
  });

  return all;
}

export function generateTemplateKnowledge(): InsertAiTemplate[] {
  const specs = generateAllSpecs();
  return specs.map((spec, index) => buildTemplate(spec, index + 1));
}

export function getTemplateCount(): number {
  return generateAllSpecs().length;
}
