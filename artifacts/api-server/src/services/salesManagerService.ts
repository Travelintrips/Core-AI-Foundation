/**
 * Sales Manager AI Service — Sprint P2.5
 * Rule-based intelligence for upsell, cross-sell, and AI insights.
 * Uses serviceName (not name) from ai_service_catalog.
 */
import { db, aiServicesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface UpsellRecommendation {
  serviceId: number;
  serviceName: string;
  reason: string;
  type: "upsell" | "cross_sell";
}

export interface AiInsight {
  category: string;
  message: string;
  score: number;
  action?: string;
}

// Cross-sell: industry keyword → list of service name keywords to recommend
const CROSS_SELL_RULES: Record<string, string[]> = {
  coffee: ["packaging", "menu", "social media", "website"],
  food:   ["packaging", "menu", "social media"],
  mining: ["company profile", "presentation", "website"],
  retail: ["logo", "social media", "packaging"],
  tech:   ["website", "presentation", "company profile"],
  startup:["logo", "pitch deck", "website"],
};

// Upsell: purchased service keyword → recommended add-on keywords
const UPSELL_RULES: Record<string, string[]> = {
  logo:         ["brand guideline", "presentation", "company profile", "packaging", "social media kit"],
  website:      ["social media", "company profile", "seo"],
  presentation: ["company profile", "pitch deck"],
  packaging:    ["logo", "social media"],
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export async function getRecommendations(opts: {
  industry?: string;
  purchasedServiceNames?: string[];
}): Promise<UpsellRecommendation[]> {
  const recommendations: UpsellRecommendation[] = [];
  const services = await db.select().from(aiServicesTable).where(sql`status = 'active'`);
  const { industry, purchasedServiceNames = [] } = opts;

  // Cross-sell based on industry
  if (industry) {
    const key = Object.keys(CROSS_SELL_RULES).find((k) => industry.toLowerCase().includes(k));
    if (key) {
      for (const svc of services) {
        const svcName = svc.serviceName.toLowerCase();
        const match = CROSS_SELL_RULES[key].find((t) => svcName.includes(t));
        const bought = purchasedServiceNames.some((p) => p.toLowerCase().includes(svcName));
        if (match && !bought) {
          recommendations.push({ serviceId: svc.id, serviceName: svc.serviceName, reason: `Popular for ${industry}`, type: "cross_sell" });
        }
      }
    }
  }

  // Upsell based on purchased services
  for (const purchased of purchasedServiceNames) {
    const key = Object.keys(UPSELL_RULES).find((k) => purchased.toLowerCase().includes(k));
    if (key) {
      for (const svc of services) {
        const svcName = svc.serviceName.toLowerCase();
        const match = UPSELL_RULES[key].find((t) => svcName.includes(t));
        const inList = purchasedServiceNames.some((p) => p.toLowerCase().includes(svcName));
        const alreadyRec = recommendations.some((r) => r.serviceId === svc.id);
        if (match && !inList && !alreadyRec) {
          recommendations.push({ serviceId: svc.id, serviceName: svc.serviceName, reason: `Complement to ${purchased}`, type: "upsell" });
        }
      }
    }
  }

  return recommendations.slice(0, 5);
}

export async function generateInsights(): Promise<AiInsight[]> {
  const insights: AiInsight[] = [];

  // Top portfolio
  const portfolioResult = await db.execute(sql`
    SELECT title, coalesce(views, 0) AS views
    FROM ai_platform.ai_service_portfolios
    ORDER BY views DESC NULLS LAST LIMIT 1
  `);
  type PortfolioRow = { title: string; views: string };
  const topPortfolio = rows<PortfolioRow>(portfolioResult)[0];
  if (topPortfolio) {
    insights.push({
      category: "Portfolio",
      message: `Portfolio "${topPortfolio.title}" memiliki views tertinggi sebanyak ${topPortfolio.views}x.`,
      score: 80,
      action: "Gunakan sebagai featured portfolio di landing page.",
    });
  }

  // Repeat service requests (grouped by brand_name as proxy for customer)
  const repeatResult = await db.execute(sql`
    SELECT brand_name, count(*)::int AS cnt
    FROM ai_platform.creative_projects
    GROUP BY brand_name ORDER BY cnt DESC LIMIT 1
  `);
  type RepeatRow = { brand_name: string; cnt: string };
  const topRepeat = rows<RepeatRow>(repeatResult)[0];
  if (topRepeat && parseInt(topRepeat.cnt, 10) > 1) {
    insights.push({
      category: "Retention",
      message: `Brand "${topRepeat.brand_name}" memiliki ${topRepeat.cnt} project. Tawarkan loyalty reward.`,
      score: 90,
      action: "Kirim coupon eksklusif ke top customer.",
    });
  }

  insights.push(
    {
      category: "Upsell",
      message: "Customer yang membeli Logo cenderung membutuhkan Brand Guideline dan Social Media Kit.",
      score: 75,
      action: "Aktifkan upsell prompt di workspace customer setelah project logo selesai.",
    },
    {
      category: "Cross-sell",
      message: "Industri F&B memiliki konversi cross-sell tertinggi untuk Packaging + Menu Design.",
      score: 70,
      action: "Buat bundle package khusus F&B.",
    },
    {
      category: "Funnel",
      message: "Drop-off terbesar terjadi di tahap Preview → Checkout. Optimalkan CTA di preview page.",
      score: 85,
      action: "A/B test CTA button di halaman preview.",
    },
  );

  return insights;
}
