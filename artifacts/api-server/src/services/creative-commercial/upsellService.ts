/**
 * creative-commercial/upsellService.ts — Team 03
 *
 * Cross-sell: recommends complementary services based on what the customer
 * has purchased or is currently viewing.
 *
 * Complement map is defined statically and can be extended without code changes
 * by operators (future: move to DB config). Reads from ai_services and
 * customer history. No financial mutations — read-only recommendations.
 */

import { db, aiServicesTable, aiServiceCategoriesTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { checkCooldown, recordRecommendation } from "./cooldownService.js";
import type { Recommendation } from "./types.js";

// ── Complement map (serviceCode → complementary serviceCodes) ─────────────────
// Keeps recommendation logic in data, not nested conditionals.

const COMPLEMENT_MAP: Record<string, string[]> = {
  "brand-identity":    ["social-media-kit", "website-design", "brand-guidelines"],
  "social-media-kit":  ["content-calendar", "brand-identity", "copywriting"],
  "website-design":    ["seo-optimization", "content-writing", "brand-identity"],
  "company-profile":   ["brand-identity", "social-media-kit", "annual-report"],
  "annual-report":     ["company-profile", "infographic-design", "data-visualization"],
  "logo-design":       ["brand-identity", "business-card", "letterhead"],
  "copywriting":       ["social-media-kit", "content-calendar", "seo-optimization"],
  "seo-optimization":  ["website-design", "copywriting", "content-writing"],
  "packaging-design":  ["brand-identity", "product-photography", "label-design"],
  "video-production":  ["social-media-kit", "motion-graphics", "copywriting"],
};

interface ServiceRow {
  id: number;
  serviceCode: string;
  serviceName: string;
  startingPrice: string | null;
  shortDescription: string | null;
  serviceFlow: string;
}

interface CustomerContext {
  customerProfileId: number;
  currentServiceCode?: string;
  currentServiceId?: number;
  segment?: string;
  healthScore?: number;
}

/**
 * Returns cross-sell recommendations for a customer.
 * Will not recommend services they've already purchased.
 * Respects cooldown (72h per service pair).
 */
export async function getCrossSellRecommendations(
  ctx: CustomerContext,
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];

  // 1. Determine complement targets
  const targetCodes = ctx.currentServiceCode
    ? (COMPLEMENT_MAP[ctx.currentServiceCode] ?? [])
    : [];

  if (targetCodes.length === 0) return [];

  // 2. Load services by code
  const allServices = await db
    .select()
    .from(aiServicesTable)
    .where(inArray(aiServicesTable.serviceCode, targetCodes)) as ServiceRow[];

  // 3. Exclude already-purchased services
  // aiServiceRequestsTable has customerEmail not customerProfileId — join via raw SQL
  const purchasedResult = await db.execute<{ service_id: number | null } & Record<string, unknown>>(sql`
    SELECT sr.service_id
    FROM ai_platform.ai_service_requests sr
    JOIN ai_platform.customer_profiles cp ON cp.client_email = sr.customer_email
    WHERE cp.id = ${ctx.customerProfileId}
      AND sr.status IN ('completed', 'delivered', 'in_progress')
  `);
  const purchasedRows = ((purchasedResult as unknown as { rows: Array<{ service_id: number | null }> }).rows ?? []);
  const purchasedIds = new Set(purchasedRows.map((r) => r.service_id).filter((id): id is number => id != null));

  const eligibleServices = allServices.filter((s) => !purchasedIds.has(s.id));

  // 4. Score and filter by cooldown
  for (const svc of eligibleServices) {
    const contextKey = `xsell:${ctx.currentServiceCode ?? ""}:${svc.serviceCode}`;
    const cooldown = await checkCooldown({
      customerProfileId: ctx.customerProfileId,
      recType: "cross_sell",
      contextKey,
    });
    if (cooldown.blocked) continue;

    const score = scoreCrossSell(ctx, svc, targetCodes.indexOf(svc.serviceCode));
    const price = Number(svc.startingPrice ?? 0);

    recommendations.push({
      id: `cross_sell:${ctx.customerProfileId}:${contextKey}`,
      type: "cross_sell",
      customerProfileId: ctx.customerProfileId,
      title: `Lengkapi dengan ${svc.serviceName}`,
      description: buildCrossSellDescription(svc, ctx.currentServiceCode),
      reasonCode: "service_complement",
      score,
      payload: {
        serviceId: svc.id,
        originalAmount: price,
        ctaLabel: "Lihat Layanan",
        metadata: { complementOf: ctx.currentServiceCode },
      },
      cooldownUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
      requiresApproval: false,
      createdAt: new Date(),
    });
  }

  // Record deliveries
  await Promise.all(
    recommendations.map((r) =>
      recordRecommendation({
        customerProfileId: ctx.customerProfileId,
        recType: "cross_sell",
        contextKey: r.id.split(":").slice(2).join(":"),
        payloadJson: r.payload as Record<string, unknown>,
      }),
    ),
  );

  return recommendations.sort((a, b) => b.score - a.score).slice(0, 3);
}

/**
 * Returns all services that could complement a given set of owned services.
 * Used for catalog discovery, not personalized (no cooldown).
 */
export async function getComplementCatalog(
  serviceCodes: string[],
): Promise<{ serviceCode: string; complements: ServiceRow[] }[]> {
  const result: { serviceCode: string; complements: ServiceRow[] }[] = [];

  for (const code of serviceCodes) {
    const targets = COMPLEMENT_MAP[code] ?? [];
    if (targets.length === 0) continue;

    const services = await db
      .select()
      .from(aiServicesTable)
      .where(inArray(aiServicesTable.serviceCode, targets)) as ServiceRow[];

    result.push({ serviceCode: code, complements: services });
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreCrossSell(ctx: CustomerContext, svc: ServiceRow, rankPosition: number): number {
  let score = 80 - rankPosition * 10;
  if (ctx.segment === "vip" || ctx.segment === "enterprise") score += 10;
  if ((ctx.healthScore ?? 50) >= 75) score += 8;
  return Math.max(10, Math.min(score, 100));
}

function buildCrossSellDescription(svc: ServiceRow, currentCode?: string): string {
  if (svc.shortDescription) return svc.shortDescription;
  return currentCode
    ? `${svc.serviceName} adalah pelengkap ideal untuk memperkuat hasil dari layanan sebelumnya.`
    : `${svc.serviceName} cocok untuk bisnis yang ingin meningkatkan kehadiran brand secara menyeluruh.`;
}
