/**
 * Service Showcase seed data — Portfolio / Reviews / FAQs.
 * Purely additive; idempotent by (serviceId, title) / (serviceId, question).
 * Covers 10+ industries and all major service types.
 */
import { eq, and } from "drizzle-orm";
import {
  db,
  aiServicesTable,
  aiServicePortfoliosTable,
  portfolioReviewsTable,
  aiServiceFaqsTable,
  type InsertAiServicePortfolio,
  type InsertPortfolioReview,
  type InsertAiServiceFaq,
} from "@workspace/db";

async function upsertPortfolio(serviceId: number, data: Omit<InsertAiServicePortfolio, "serviceId">) {
  const [existing] = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(eq(aiServicePortfoliosTable.serviceId, serviceId), eq(aiServicePortfoliosTable.title, data.title)));
  if (existing) {
    const [updated] = await db
      .update(aiServicePortfoliosTable)
      .set({ ...data, serviceId, updatedAt: new Date() })
      .where(eq(aiServicePortfoliosTable.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db.insert(aiServicePortfoliosTable).values({ ...data, serviceId } as InsertAiServicePortfolio).returning();
  return created!;
}

async function upsertReview(serviceId: number, data: Omit<InsertPortfolioReview, "serviceId">) {
  const [existing] = await db
    .select()
    .from(portfolioReviewsTable)
    .where(and(eq(portfolioReviewsTable.serviceId, serviceId), eq(portfolioReviewsTable.company, data.company)));
  if (existing) return existing;
  const [created] = await db.insert(portfolioReviewsTable).values({ ...data, serviceId }).returning();
  return created!;
}

async function upsertFaq(serviceId: number, data: Omit<InsertAiServiceFaq, "serviceId">) {
  const [existing] = await db
    .select()
    .from(aiServiceFaqsTable)
    .where(and(eq(aiServiceFaqsTable.serviceId, serviceId), eq(aiServiceFaqsTable.question, data.question)));
  if (existing) return existing;
  const [created] = await db.insert(aiServiceFaqsTable).values({ ...data, serviceId }).returning();
  return created!;
}

const WORKFLOW_STANDARD = [
  { step: "brief", label: "Brief" },
  { step: "brand-strategy", label: "Brand Strategy" },
  { step: "creative-direction", label: "Creative Direction" },
  { step: "generation", label: "AI Generation" },
  { step: "qc", label: "Quality Check" },
  { step: "client-review", label: "Client Review" },
  { step: "delivery", label: "Final Delivery" },
];

interface PortfolioSeed {
  title: string;
  industry: string;
  style: string;
  colorTags: string[];
  businessSize: string;
  packageLabel: string;
  description: string;
  shortDescription?: string;
  coverImage: string;
  deliverablesJson: string[];
  toolsUsedJson: string[];
  deliveryTime: string;
  rating: string;
  completedProjects: number;
  featured: boolean;
}

const PORTFOLIO_SEEDS: Record<string, PortfolioSeed[]> = {
  "logo-design": [
    // Coffee
    {
      title: "Kopi Senja — Coffee Shop Logo",
      industry: "coffee", style: "minimalist",
      colorTags: ["#3B2314", "#D9A44A"], businessSize: "sme", packageLabel: "Standard Package",
      shortDescription: "A warm, minimalist mark for a neighborhood coffee shop — evokes an evening coffee ritual without leaning on cliché icons.",
      description: "A warm, minimalist mark for a neighborhood coffee shop — evokes an evening coffee ritual without leaning on cliché coffee-cup icons.",
      coverImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80",
      deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.80", completedProjects: 34, featured: true,
    },
    // Logistics
    {
      title: "Nusantara Freight — Logistics Mark",
      industry: "logistics", style: "corporate",
      colorTags: ["#0B3C5D", "#F2F2F2"], businessSize: "enterprise", packageLabel: "Pro Package",
      shortDescription: "A confident, corporate wordmark plus icon system for a growing freight operator, built for trucks, uniforms, and documents.",
      description: "A confident, corporate wordmark plus icon system for a growing freight operator, built to work across trucks, uniforms, and documents.",
      coverImage: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=1200&q=80",
      deliverablesJson: ["png", "svg", "ai", "brand_guideline"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.60", completedProjects: 21, featured: false,
    },
    // Fashion
    {
      title: "Bloom & Co — Fashion Boutique Logo",
      industry: "fashion", style: "elegant",
      colorTags: ["#C9A6A6", "#1A1A1A"], businessSize: "startup", packageLabel: "Standard Package",
      shortDescription: "An elegant script-and-serif combination mark for an emerging fashion label, designed to feel premium at boutique scale.",
      description: "An elegant script-and-serif combination mark for an emerging fashion label, designed to feel premium at boutique scale.",
      coverImage: "https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&q=80",
      deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.90", completedProjects: 18, featured: true,
    },
    // Restaurant
    {
      title: "Warung Pagi — Street Food Logo",
      industry: "restaurant", style: "bold",
      colorTags: ["#C0392B", "#F7DC6F"], businessSize: "sme", packageLabel: "Starter Package",
      shortDescription: "A bold, appetite-driving mark for a beloved street-food warung — vibrant colors and confident typography.",
      description: "A bold, appetite-driving mark for a beloved street-food warung, using vibrant color and confident typography to stand out on signage and food packaging.",
      coverImage: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
      deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.75", completedProjects: 29, featured: false,
    },
    // Mining
    {
      title: "Batubara Prima — Mining Corporation Mark",
      industry: "mining", style: "industrial",
      colorTags: ["#2C3E50", "#F39C12"], businessSize: "enterprise", packageLabel: "Pro Package",
      shortDescription: "A strong, industrial identity mark for a coal mining corporation — built for heavy industry trust and institutional credibility.",
      description: "A strong, industrial identity mark for a coal mining corporation, built to communicate trust and scale for institutional clients, government tenders, and B2B contexts.",
      coverImage: "https://images.unsplash.com/photo-1578323851345-5504e3aa5e96?w=1200&q=80",
      deliverablesJson: ["png", "svg", "ai", "brand_guideline"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "3 hari", rating: "4.55", completedProjects: 7, featured: false,
    },
    // Property
    {
      title: "Lestari Properti — Real Estate Logo",
      industry: "property", style: "premium",
      colorTags: ["#1A1A2E", "#C9A75A"], businessSize: "sme", packageLabel: "Standard Package",
      shortDescription: "A premium, aspirational mark for a property developer — gold on deep navy conveys luxury and reliability.",
      description: "A premium, aspirational mark for a property developer focused on landed housing and boutique apartments, with gold-on-navy palette signaling luxury and financial reliability.",
      coverImage: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80",
      deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.80", completedProjects: 14, featured: true,
    },
    // Technology
    {
      title: "Cerdas.AI — Tech Startup Logo",
      industry: "technology", style: "modern",
      colorTags: ["#6C63FF", "#F5F5F7"], businessSize: "startup", packageLabel: "Standard Package",
      shortDescription: "A clean, modern logomark for an AI productivity startup — geometric precision meets approachable energy.",
      description: "A clean, modern logomark for an AI productivity startup, combining geometric precision with approachable brand energy. Designed to scale from app icon to conference stage backdrop.",
      coverImage: "https://images.unsplash.com/photo-1581090464777-f3220bbe1b8b?w=1200&q=80",
      deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.85", completedProjects: 22, featured: true,
    },
    // Trading
    {
      title: "Sinar Dagang — Export-Import Mark",
      industry: "trading", style: "corporate",
      colorTags: ["#1B4F72", "#F0B27A"], businessSize: "sme", packageLabel: "Standard Package",
      shortDescription: "A professional corporate mark for an export-import trading house operating across Southeast Asia.",
      description: "A professional, internationally-legible corporate mark for an export-import trading house operating across Southeast Asia, with document and letterhead applications.",
      coverImage: "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=1200&q=80",
      deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"],
      deliveryTime: "2 hari", rating: "4.65", completedProjects: 11, featured: false,
    },
  ],
  "brand-identity": [
    // Coffee premium
    {
      title: "Java Roastery — Full Identity System",
      industry: "coffee", style: "premium",
      colorTags: ["#2E1503", "#E8B84B", "#F5F0E6"], businessSize: "sme", packageLabel: "Pro Package",
      shortDescription: "Complete visual identity for a specialty coffee roastery: logo suite, packaging colorways, typography, and a 20-page brand guideline.",
      description: "Complete visual identity for a specialty coffee roastery: logo suite, packaging colorways, typography system, and a 20-page brand guideline.",
      coverImage: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80",
      deliverablesJson: ["brand_guideline", "png", "svg", "ai", "editable_source"], toolsUsedJson: ["Brand Strategist AI", "Creative Director AI", "Designer AI"],
      deliveryTime: "6 hari", rating: "4.85", completedProjects: 12, featured: true,
    },
    // Medical
    {
      title: "MedFirst Clinic — Healthcare Brand System",
      industry: "medical", style: "corporate",
      colorTags: ["#155E75", "#FFFFFF"], businessSize: "sme", packageLabel: "Pro Package",
      shortDescription: "A trustworthy, clinical-yet-warm identity system for a multi-branch clinic network, tuned for signage, uniforms, and patient materials.",
      description: "A trustworthy, clinical-yet-warm identity system for a multi-branch clinic network, tuned for signage, uniforms, and patient materials.",
      coverImage: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80",
      deliverablesJson: ["brand_guideline", "png", "svg", "pdf"], toolsUsedJson: ["Brand Strategist AI", "Designer AI"],
      deliveryTime: "7 hari", rating: "4.70", completedProjects: 9, featured: false,
    },
    // Palm Oil
    {
      title: "Sawit Hijau — Agribusiness Brand",
      industry: "palm-oil", style: "natural",
      colorTags: ["#2D6A4F", "#F4A261"], businessSize: "enterprise", packageLabel: "Pro Package",
      shortDescription: "A nature-forward brand identity for a sustainable palm oil producer, positioning the company for export markets and ESG investors.",
      description: "A nature-forward brand identity for a sustainable palm oil producer, positioning the company for export markets and ESG investors. Includes full brand guideline with sustainability narrative.",
      coverImage: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80",
      deliverablesJson: ["brand_guideline", "png", "svg", "pdf"], toolsUsedJson: ["Brand Strategist AI", "Creative Director AI", "Designer AI"],
      deliveryTime: "7 hari", rating: "4.75", completedProjects: 5, featured: true,
    },
    // Hotel
    {
      title: "Nuansa Bali — Boutique Hotel Identity",
      industry: "hotel", style: "luxury",
      colorTags: ["#4A2C2A", "#C9A75A", "#F8F3EE"], businessSize: "sme", packageLabel: "Pro Package",
      shortDescription: "A warm, luxury identity for a boutique Balinese hotel — traditional motifs reinterpreted for the international premium traveler.",
      description: "A warm, luxury identity for a boutique Balinese hotel, reinterpreting traditional local motifs for the international premium traveler. Applied across signage, collateral, and digital.",
      coverImage: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1200&q=80",
      deliverablesJson: ["brand_guideline", "png", "svg", "pdf"], toolsUsedJson: ["Brand Strategist AI", "Creative Director AI", "Designer AI"],
      deliveryTime: "8 hari", rating: "4.90", completedProjects: 7, featured: true,
    },
    // Construction
    {
      title: "Mega Konstruksi — Construction Brand",
      industry: "construction", style: "industrial",
      colorTags: ["#212121", "#FFC107"], businessSize: "enterprise", packageLabel: "Pro Package",
      shortDescription: "A bold industrial brand system for a major construction company — engineered for institutional credibility and site visibility.",
      description: "A bold industrial brand system for a major construction company covering vehicle livery, site signage, safety vests, tender documentation, and digital presence.",
      coverImage: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80",
      deliverablesJson: ["brand_guideline", "png", "svg", "ai"], toolsUsedJson: ["Brand Strategist AI", "Designer AI"],
      deliveryTime: "7 hari", rating: "4.60", completedProjects: 6, featured: false,
    },
  ],
  "packaging-design": [
    {
      title: "Rempah Nusantara — Spice Packaging",
      industry: "retail", style: "bold",
      colorTags: ["#8C2F0B", "#F4C430"], businessSize: "sme", packageLabel: "Standard Package",
      shortDescription: "Bold, market-ready packaging for a heritage spice brand, designed to stand out on crowded retail shelves.",
      description: "Bold, market-ready packaging concept for a heritage spice brand, designed to stand out on crowded retail shelves.",
      coverImage: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=1200&q=80",
      deliverablesJson: ["mockup", "pdf"], toolsUsedJson: ["Designer AI"],
      deliveryTime: "5 hari", rating: "4.75", completedProjects: 15, featured: true,
    },
    {
      title: "Kecantikan Alam — Natural Beauty Packaging",
      industry: "beauty", style: "minimal",
      colorTags: ["#D4B483", "#F5F5F0", "#4A3728"], businessSize: "startup", packageLabel: "Standard Package",
      shortDescription: "Clean, nature-inspired packaging for a natural skincare line — muted earth tones and minimal layout communicate purity.",
      description: "Clean, nature-inspired packaging for a natural skincare line, using muted earth tones and minimal layout to communicate purity, sustainability, and premium quality.",
      coverImage: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80",
      deliverablesJson: ["mockup", "pdf", "editable_source"], toolsUsedJson: ["Designer AI", "Creative Director AI"],
      deliveryTime: "5 hari", rating: "4.85", completedProjects: 9, featured: true,
    },
    {
      title: "Bumi Coffee — Specialty Bag Packaging",
      industry: "coffee", style: "premium",
      colorTags: ["#1C0F08", "#C8923A", "#F0EAE0"], businessSize: "sme", packageLabel: "Pro Package",
      shortDescription: "Premium specialty coffee bag packaging — kraft paper meets foil stamp in a design that commands shelf presence.",
      description: "Premium specialty coffee bag packaging combining kraft paper texture, foil stamp, and sophisticated typography for a specialty roaster positioning against international competitors.",
      coverImage: "https://images.unsplash.com/photo-1611854779393-1b2da9d400fe?w=1200&q=80",
      deliverablesJson: ["mockup", "pdf", "editable_source"], toolsUsedJson: ["Designer AI", "Creative Director AI"],
      deliveryTime: "6 hari", rating: "4.80", completedProjects: 11, featured: false,
    },
  ],
  "social-media-design": [
    {
      title: "Warung Sedap — Restaurant Content Set",
      industry: "restaurant", style: "modern",
      colorTags: ["#B3261E", "#FFF7E8"], businessSize: "sme", packageLabel: "Standard Package",
      shortDescription: "A month of on-brand social feed templates for a growing restaurant chain, built around appetite-driving food photography.",
      description: "A month of on-brand social feed templates for a growing restaurant chain, built around appetite-driving food photography.",
      coverImage: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
      deliverablesJson: ["png", "pdf"], toolsUsedJson: ["Designer AI"],
      deliveryTime: "2 hari", rating: "4.65", completedProjects: 27, featured: false,
    },
    {
      title: "TechStart ID — Social Media Kit",
      industry: "technology", style: "modern",
      colorTags: ["#6C63FF", "#00D9A6"], businessSize: "startup", packageLabel: "Standard Package",
      shortDescription: "A dynamic, modern social media content kit for a B2B SaaS startup — designed for LinkedIn, Instagram, and Twitter.",
      description: "A dynamic, modern social media content kit for a B2B SaaS startup, covering post templates, story templates, event announcements, and product launch assets for LinkedIn, Instagram, and Twitter.",
      coverImage: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=1200&q=80",
      deliverablesJson: ["png", "pdf", "editable_source"], toolsUsedJson: ["Designer AI", "Copywriter AI"],
      deliveryTime: "3 hari", rating: "4.80", completedProjects: 19, featured: true,
    },
    {
      title: "Lestari Hotel — Travel Content Series",
      industry: "hotel", style: "luxury",
      colorTags: ["#4A2C2A", "#C9A75A"], businessSize: "sme", packageLabel: "Pro Package",
      shortDescription: "A luxury travel content series for a boutique hotel — evocative, aspirational templates that drive direct bookings.",
      description: "A luxury travel content series for a boutique hotel, creating evocative, aspirational templates for Instagram and Facebook that drive direct bookings over OTA channels.",
      coverImage: "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=80",
      deliverablesJson: ["png", "pdf"], toolsUsedJson: ["Designer AI"],
      deliveryTime: "3 hari", rating: "4.75", completedProjects: 8, featured: false,
    },
  ],
  "company-profile": [
    {
      title: "Cendana Construction — Company Profile",
      industry: "construction", style: "corporate",
      colorTags: ["#1F2A44", "#C9A227"], businessSize: "enterprise", packageLabel: "Pro Package",
      shortDescription: "A polished company profile document positioning a construction firm for institutional tenders and enterprise clients.",
      description: "A polished company profile document positioning a construction firm for institutional tenders and enterprise clients.",
      coverImage: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=1200&q=80",
      deliverablesJson: ["pdf", "company_profile"], toolsUsedJson: ["Designer AI", "Copywriter AI"],
      deliveryTime: "5 hari", rating: "4.55", completedProjects: 8, featured: false,
    },
    {
      title: "Sawit Makmur Group — Palm Oil Corporate Profile",
      industry: "palm-oil", style: "corporate",
      colorTags: ["#1A4731", "#F5A623"], businessSize: "enterprise", packageLabel: "Pro Package",
      shortDescription: "A comprehensive corporate profile for a large palm oil group, covering plantation operations, sustainability, and export credentials.",
      description: "A comprehensive corporate profile for a large palm oil group, covering plantation operations, sustainability commitments, export credentials, and investor relations. Designed for government and international buyer audiences.",
      coverImage: "https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1200&q=80",
      deliverablesJson: ["pdf", "company_profile", "editable_source"], toolsUsedJson: ["Designer AI", "Copywriter AI"],
      deliveryTime: "6 hari", rating: "4.70", completedProjects: 5, featured: false,
    },
    {
      title: "Maju Bersama Trading — Export-Import Profile",
      industry: "trading", style: "professional",
      colorTags: ["#1B4F72", "#EAECEE"], businessSize: "sme", packageLabel: "Standard Package",
      shortDescription: "A clean, professional company profile for an export-import trading house — designed for overseas buyer confidence.",
      description: "A clean, professional company profile for an export-import trading house, designed to build overseas buyer confidence across product lines, certifications, and logistics capabilities.",
      coverImage: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1200&q=80",
      deliverablesJson: ["pdf", "company_profile"], toolsUsedJson: ["Designer AI", "Copywriter AI"],
      deliveryTime: "5 hari", rating: "4.60", completedProjects: 9, featured: false,
    },
  ],
  "pitch-deck": [
    {
      title: "Lumina EdTech — Seed Round Pitch Deck",
      industry: "education", style: "modern",
      colorTags: ["#4338CA", "#F5F5F7"], businessSize: "startup", packageLabel: "Pro Package",
      shortDescription: "Investor-ready pitch deck for an EdTech startup's seed round, combining data storytelling with a clean, modern visual system.",
      description: "Investor-ready pitch deck for an EdTech startup's seed round, combining data storytelling with a clean, modern visual system.",
      coverImage: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1200&q=80",
      deliverablesJson: ["pptx", "pdf", "presentation"], toolsUsedJson: ["Creative Director AI", "Copywriter AI"],
      deliveryTime: "6 hari", rating: "4.90", completedProjects: 11, featured: true,
    },
    {
      title: "GreenMine — Mining Startup Series A",
      industry: "mining", style: "corporate",
      colorTags: ["#2C3E50", "#27AE60"], businessSize: "startup", packageLabel: "Pro Package",
      shortDescription: "A Series A pitch deck for a green mining technology startup, positioning ESG leadership alongside commercial traction.",
      description: "A Series A pitch deck for a green mining technology startup, positioning ESG leadership alongside commercial traction. Designed for international mining fund audiences with data-led narrative.",
      coverImage: "https://images.unsplash.com/photo-1609904604440-a2f226f7b6e1?w=1200&q=80",
      deliverablesJson: ["pptx", "pdf", "presentation"], toolsUsedJson: ["Creative Director AI", "Copywriter AI"],
      deliveryTime: "7 hari", rating: "4.80", completedProjects: 6, featured: false,
    },
    {
      title: "Properti Digital — PropTech Pitch",
      industry: "property", style: "modern",
      colorTags: ["#2C3E50", "#E74C3C"], businessSize: "startup", packageLabel: "Standard Package",
      shortDescription: "A compelling pitch deck for a PropTech startup disrupting the Indonesian secondary property market.",
      description: "A compelling pitch deck for a PropTech startup disrupting the Indonesian secondary property market, combining market data visualization, product demo storyboards, and a clear path to monetization.",
      coverImage: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80",
      deliverablesJson: ["pptx", "pdf"], toolsUsedJson: ["Creative Director AI", "Copywriter AI"],
      deliveryTime: "6 hari", rating: "4.70", completedProjects: 8, featured: false,
    },
  ],
};

const REVIEW_SEEDS: Record<string, Array<Omit<InsertPortfolioReview, "serviceId" | "portfolioId">>> = {
  "logo-design": [
    { rating: 5, review: "The AI actually nailed our vibe on the first pass — three genuinely different directions, not just color swaps.", company: "Kopi Senja", industry: "coffee", clientName: "Dinda R.", featured: true, status: "published" },
    { rating: 4, review: "Fast turnaround and the corporate direction was exactly what our fleet needed.", company: "Nusantara Freight", industry: "logistics", clientName: "Budi S.", featured: false, status: "published" },
    { rating: 5, review: "We got our logo in 2 days and it perfectly captures the luxury feel we were going for.", company: "Lestari Properti", industry: "property", clientName: "Hendra K.", featured: true, status: "published" },
    { rating: 5, review: "Cerdas logo went viral on LinkedIn. The geometric icon is instantly recognizable at small sizes — something our previous logo never achieved.", company: "Cerdas.AI", industry: "technology", clientName: "Arif M.", featured: true, status: "published" },
  ],
  "brand-identity": [
    { rating: 5, review: "We got a full brand system in under a week — guideline, packaging colorways, everything. Saved us a month of back-and-forth with a traditional agency.", company: "Java Roastery", industry: "coffee", clientName: "Farah A.", featured: true, status: "published" },
    { rating: 5, review: "Our international buyers took the brand seriously immediately. The ESG narrative in the guideline especially impressed Dutch and German clients.", company: "Sawit Hijau", industry: "palm-oil", clientName: "Pak Suryanto", featured: true, status: "published" },
    { rating: 5, review: "Guests now recognize our hotel brand from social media before they arrive. The identity travels beautifully across digital and physical touchpoints.", company: "Nuansa Bali", industry: "hotel", clientName: "Ni Wayan A.", featured: false, status: "published" },
  ],
  "packaging-design": [
    { rating: 5, review: "Our spice sales on Tokopedia went up 40% within the first month after the new packaging launched.", company: "Rempah Nusantara", industry: "retail", clientName: "Ibu Sari", featured: true, status: "published" },
    { rating: 5, review: "The kraft + foil stamp combination looked even better in physical print than in the mockup. Our roastery finally looks like it belongs on specialty cafe shelves.", company: "Bumi Coffee", industry: "coffee", clientName: "Rangga W.", featured: false, status: "published" },
  ],
  "pitch-deck": [
    { rating: 5, review: "Our investors specifically complimented the deck's clarity. Worth every rupiah.", company: "Lumina EdTech", industry: "education", clientName: "Rangga P.", featured: true, status: "published" },
    { rating: 5, review: "The GreenMine deck helped us close our Series A in 6 weeks. The narrative was exactly what ESG-focused mining funds want to hear.", company: "GreenMine", industry: "mining", clientName: "David T.", featured: true, status: "published" },
  ],
  "company-profile": [
    { rating: 4, review: "We've already used the profile in 3 government tender submissions. The QA and construction track record sections gave us a professional edge.", company: "Cendana Construction", industry: "construction", clientName: "Bpk. Wijaya", featured: false, status: "published" },
  ],
};

const FAQ_SEEDS: Array<Omit<InsertAiServiceFaq, "serviceId">> = [
  { question: "Is the free Live AI Preview the final quality I'll receive?", answer: "No — the free preview is a low-resolution, watermarked concept meant to show direction and style, not a deliverable. Your final assets are produced at full resolution, without a watermark, after you start a project.", displayOrder: 1, status: "published" },
  { question: "Can I download or reuse the preview image?", answer: "The preview image can't be downloaded or used commercially — it's a taste of the AI's direction, capped at 2 free tries per visit. Choosing \"Continue With This Concept\" carries the exact concept into your project instead of a download.", displayOrder: 2, status: "published" },
  { question: "How many revisions are included?", answer: "Each package lists its included revision rounds. Additional revisions can be added for a small fee during the request flow.", displayOrder: 3, status: "published" },
  { question: "What if I don't like either preview concept?", answer: "You can regenerate up to your free preview limit, or start a project directly — our human-reviewed workflow explores further directions during the brief stage.", displayOrder: 4, status: "published" },
  { question: "Can I see portfolios from my industry before ordering?", answer: "Yes — visit our Portfolio Gallery to browse real AI-generated work across 10+ industries and styles. Filter by industry, style, and package to find examples closest to your brief.", displayOrder: 5, status: "published" },
  { question: "What file formats do I receive?", answer: "Depends on your package and service. Logo and brand packages include PNG (transparent background), SVG (vector), and PDF. Pro packages also include editable source files (AI/PSD/Figma). Company profiles and pitch decks include PDF, with editable source on Pro.", displayOrder: 6, status: "published" },
];

export async function seedPortfolioShowcase() {
  console.log("\n🖼️  Seeding Service Showcase (Portfolio / Reviews / FAQ)...");

  const services = await db.select().from(aiServicesTable);
  const byCode = new Map(services.map((s) => [s.serviceCode, s]));

  let portfolioCount = 0;
  let reviewCount = 0;
  let faqCount = 0;

  for (const [serviceCode, items] of Object.entries(PORTFOLIO_SEEDS)) {
    const service = byCode.get(serviceCode);
    if (!service) continue;

    const createdByTitle = new Map<string, { id: number }>();
    for (const [i, item] of items.entries()) {
      const row = await upsertPortfolio(service.id, {
        title: item.title,
        industry: item.industry,
        style: item.style,
        colorTags: item.colorTags,
        businessSize: item.businessSize,
        packageLabel: item.packageLabel,
        shortDescription: item.shortDescription ?? item.description.substring(0, 120),
        description: item.description,
        coverImage: item.coverImage,
        galleryJson: [{ type: "image", url: item.coverImage, caption: item.title }],
        deliverablesJson: item.deliverablesJson,
        toolsUsedJson: item.toolsUsedJson,
        workflowJson: WORKFLOW_STANDARD,
        deliveryTime: item.deliveryTime,
        rating: item.rating,
        completedProjects: item.completedProjects,
        featured: item.featured,
        status: "published",
        publishStatus: "published",
        displayOrder: i,
        isDemo: false,
        trademarkRisk: "low",
      } as InsertAiServicePortfolio & Record<string, unknown>);
      createdByTitle.set(item.title, row);
      portfolioCount += 1;
    }

    const reviews = REVIEW_SEEDS[serviceCode] ?? [];
    for (const r of reviews) {
      const portfolioMatch = [...createdByTitle.entries()].find(([title]) => title.includes(r.company))?.[1];
      await upsertReview(service.id, { ...r, portfolioId: portfolioMatch?.id ?? null });
      reviewCount += 1;
    }

    for (const f of FAQ_SEEDS) {
      await upsertFaq(service.id, f);
      faqCount += 1;
    }
  }

  console.log(`✅ Service Showcase seeded: ${portfolioCount} portfolio items, ${reviewCount} reviews, ${faqCount} FAQ entries`);
}
