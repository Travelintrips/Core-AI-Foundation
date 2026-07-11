/**
 * Service Showcase seed data — Portfolio / Reviews / FAQs.
 * Purely additive; idempotent by (serviceId, title) / (serviceId, question).
 * Covers a spread of industries and styles so the showcase isn't empty for
 * the flagship creative services (logo, brand identity, packaging, social
 * media, company profile, pitch deck).
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
  const [created] = await db.insert(aiServicePortfoliosTable).values({ ...data, serviceId }).returning();
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
    { title: "Kopi Senja — Coffee Shop Logo", industry: "coffee", style: "minimalist", colorTags: ["#3B2314", "#D9A44A"], businessSize: "sme", packageLabel: "Standard Package", description: "A warm, minimalist mark for a neighborhood coffee shop — evokes an evening coffee ritual without leaning on cliché coffee-cup icons.", coverImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80", deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"], deliveryTime: "2 hari", rating: "4.80", completedProjects: 34, featured: true },
    { title: "Nusantara Freight — Logistics Mark", industry: "logistics", style: "corporate", colorTags: ["#0B3C5D", "#F2F2F2"], businessSize: "enterprise", packageLabel: "Pro Package", description: "A confident, corporate wordmark plus icon system for a growing freight operator, built to work across trucks, uniforms, and documents.", coverImage: "https://images.unsplash.com/photo-1519003722824-194d4455a60c?w=1200&q=80", deliverablesJson: ["png", "svg", "ai", "brand_guideline"], toolsUsedJson: ["Creative Director AI", "Designer AI"], deliveryTime: "2 hari", rating: "4.60", completedProjects: 21, featured: false },
    { title: "Bloom & Co — Fashion Boutique Logo", industry: "fashion", style: "elegant", colorTags: ["#C9A6A6", "#1A1A1A"], businessSize: "startup", packageLabel: "Standard Package", description: "An elegant script-and-serif combination mark for an emerging fashion label, designed to feel premium at boutique scale.", coverImage: "https://images.unsplash.com/photo-1445205170230-053b83016050?w=1200&q=80", deliverablesJson: ["png", "svg", "pdf"], toolsUsedJson: ["Creative Director AI", "Designer AI"], deliveryTime: "2 hari", rating: "4.90", completedProjects: 18, featured: true },
  ],
  "brand-identity": [
    { title: "Java Roastery — Full Identity System", industry: "coffee", style: "premium", colorTags: ["#2E1503", "#E8B84B", "#F5F0E6"], businessSize: "sme", packageLabel: "Pro Package", description: "Complete visual identity for a specialty coffee roastery: logo suite, packaging colorways, typography system, and a 20-page brand guideline.", coverImage: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80", deliverablesJson: ["brand_guideline", "png", "svg", "ai", "editable_source"], toolsUsedJson: ["Brand Strategist AI", "Creative Director AI", "Designer AI"], deliveryTime: "6 hari", rating: "4.85", completedProjects: 12, featured: true },
    { title: "MedFirst Clinic — Healthcare Brand System", industry: "medical", style: "corporate", colorTags: ["#155E75", "#FFFFFF"], businessSize: "sme", packageLabel: "Pro Package", description: "A trustworthy, clinical-yet-warm identity system for a multi-branch clinic network, tuned for signage, uniforms, and patient materials.", coverImage: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1200&q=80", deliverablesJson: ["brand_guideline", "png", "svg", "pdf"], toolsUsedJson: ["Brand Strategist AI", "Designer AI"], deliveryTime: "7 hari", rating: "4.70", completedProjects: 9, featured: false },
  ],
  "packaging-design": [
    { title: "Rempah Nusantara — Spice Packaging", industry: "retail", style: "bold", colorTags: ["#8C2F0B", "#F4C430"], businessSize: "sme", packageLabel: "Standard Package", description: "Bold, market-ready packaging concept for a heritage spice brand, designed to stand out on crowded retail shelves.", coverImage: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=1200&q=80", deliverablesJson: ["mockup", "pdf"], toolsUsedJson: ["Designer AI"], deliveryTime: "5 hari", rating: "4.75", completedProjects: 15, featured: true },
  ],
  "social-media-design": [
    { title: "Warung Sedap — Restaurant Content Set", industry: "restaurant", style: "modern", colorTags: ["#B3261E", "#FFF7E8"], businessSize: "sme", packageLabel: "Standard Package", description: "A month of on-brand social feed templates for a growing restaurant chain, built around appetite-driving food photography.", coverImage: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80", deliverablesJson: ["png", "pdf"], toolsUsedJson: ["Designer AI"], deliveryTime: "2 hari", rating: "4.65", completedProjects: 27, featured: false },
  ],
  "company-profile": [
    { title: "Cendana Construction — Company Profile", industry: "construction", style: "corporate", colorTags: ["#1F2A44", "#C9A227"], businessSize: "enterprise", packageLabel: "Pro Package", description: "A polished company profile document positioning a construction firm for institutional tenders and enterprise clients.", coverImage: "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=1200&q=80", deliverablesJson: ["pdf", "company_profile"], toolsUsedJson: ["Designer AI", "Copywriter AI"], deliveryTime: "5 hari", rating: "4.55", completedProjects: 8, featured: false },
  ],
  "pitch-deck": [
    { title: "Lumina EdTech — Seed Round Pitch Deck", industry: "education", style: "modern", colorTags: ["#4338CA", "#F5F5F7"], businessSize: "startup", packageLabel: "Pro Package", description: "Investor-ready pitch deck for an EdTech startup's seed round, combining data storytelling with a clean, modern visual system.", coverImage: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1200&q=80", deliverablesJson: ["pptx", "pdf", "presentation"], toolsUsedJson: ["Creative Director AI", "Copywriter AI"], deliveryTime: "6 hari", rating: "4.90", completedProjects: 11, featured: true },
  ],
};

const REVIEW_SEEDS: Record<string, Array<Omit<InsertPortfolioReview, "serviceId" | "portfolioId">>> = {
  "logo-design": [
    { rating: 5, review: "The AI actually nailed our vibe on the first pass — three genuinely different directions, not just color swaps.", company: "Kopi Senja", industry: "coffee", clientName: "Dinda R.", featured: true, status: "published" },
    { rating: 4, review: "Fast turnaround and the corporate direction was exactly what our fleet needed.", company: "Nusantara Freight", industry: "logistics", clientName: "Budi S.", featured: false, status: "published" },
  ],
  "brand-identity": [
    { rating: 5, review: "We got a full brand system in under a week — guideline, packaging colorways, everything. Saved us a month of back-and-forth with a traditional agency.", company: "Java Roastery", industry: "coffee", clientName: "Farah A.", featured: true, status: "published" },
  ],
  "pitch-deck": [
    { rating: 5, review: "Our investors specifically complimented the deck's clarity. Worth every rupiah.", company: "Lumina EdTech", industry: "education", clientName: "Rangga P.", featured: true, status: "published" },
  ],
};

const FAQ_SEEDS: Array<Omit<InsertAiServiceFaq, "serviceId">> = [
  { question: "Is the free Live AI Preview the final quality I'll receive?", answer: "No — the free preview is a low-resolution, watermarked concept meant to show direction and style, not a deliverable. Your final assets are produced at full resolution, without a watermark, after you start a project.", displayOrder: 1, status: "published" },
  { question: "Can I download or reuse the preview image?", answer: "The preview image can't be downloaded or used commercially — it's a taste of the AI's direction, capped at 2 free tries per visit. Choosing \"Continue With This Concept\" carries the exact concept into your project instead of a download.", displayOrder: 2, status: "published" },
  { question: "How many revisions are included?", answer: "Each package lists its included revision rounds. Additional revisions can be added for a small fee during the request flow.", displayOrder: 3, status: "published" },
  { question: "What if I don't like either preview concept?", answer: "You can regenerate up to your free preview limit, or start a project directly — our human-reviewed workflow explores further directions during the brief stage.", displayOrder: 4, status: "published" },
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
        displayOrder: i,
      });
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
