/**
 * creative-commercial/packageRecommendationService.ts — Team 03
 *
 * Recommends service packages to a customer based on:
 *   - Their current segment (new/returning/vip/enterprise/at_risk/…)
 *   - Past service requests (what they've bought)
 *   - Health score (engagement + payment behavior)
 *   - Current service context (if they're viewing a specific service)
 *
 * Recommendation-only by default. No price changes are made here.
 * Results include a score (0–100) and machine-readable reasonCode.
 */

import { db, aiServicesTable, aiServicePackagesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { checkCooldown, recordRecommendation } from "./cooldownService.js";
import type { Recommendation } from "./types.js";

interface CustomerContext {
  customerProfileId: number;
  currentServiceId?: number;
  currentPackageId?: number;
  orderAmountHint?: number;   // estimated order value for this session
  segment?: string;
  healthScore?: number;
}

interface ServiceRow {
  id: number;
  serviceCode: string;
  serviceName: string;
  startingPrice: string | null;
  serviceFlow: string;
}

interface PackageRow {
  id: number;
  serviceId: number;
  packageName: string;
  packageCode: string;
  packageType: string;
  packageLevel: string;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  oneTimePrice: string | null;
  setupFee: string | null;
  displayOrder: number;
  [key: string]: unknown;
}

interface ServiceRequestRow {
  serviceId: number | null;
  packageId: number | null;
}

/**
 * Returns package upgrade recommendations for a customer.
 * Filtered by cooldown — won't re-recommend within 7 days.
 */
export async function getPackageRecommendations(
  ctx: CustomerContext,
): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];

  // 1. Load packages for the current service (upsell within same service)
  if (ctx.currentServiceId) {
    const packages = await db
      .select()
      .from(aiServicePackagesTable)
      .where(eq(aiServicePackagesTable.serviceId, ctx.currentServiceId))
      .orderBy(aiServicePackagesTable.displayOrder);

    // Find the "next tier up" from what they're currently on
    const currentIdx = ctx.currentPackageId
      ? packages.findIndex((p) => p.id === ctx.currentPackageId)
      : -1;

    const nextPackages = currentIdx >= 0
      ? packages.slice(currentIdx + 1, currentIdx + 2)  // one level up
      : packages.slice(0, 1);                            // start with base

    for (const pkg of nextPackages) {
      const contextKey = `pkg:${pkg.id}`;
      const cooldown = await checkCooldown({
        customerProfileId: ctx.customerProfileId,
        recType: "package_upgrade",
        contextKey,
      });
      if (cooldown.blocked) continue;

      const price = Number(pkg.oneTimePrice ?? pkg.monthlyPrice ?? 0);
      const score = scorePackageUpgrade(ctx, price);

      recommendations.push({
        id: `package_upgrade:${ctx.customerProfileId}:${contextKey}`,
        type: "package_upgrade",
        customerProfileId: ctx.customerProfileId,
        title: `Upgrade to ${pkg.packageName}`,
        description: buildUpgradeDescription(pkg as unknown as PackageRow, ctx),
        reasonCode: "next_tier_available",
        score,
        payload: {
          serviceId: ctx.currentServiceId,
          packageId: pkg.id,
          originalAmount: ctx.orderAmountHint,
          ctaLabel: "Lihat Paket",
        },
        cooldownUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        requiresApproval: false,
        createdAt: new Date(),
      });
    }
  }

  // 2. Re-engagement: recommend a service they've used before at higher volume
  // aiServiceRequestsTable has customerEmail not customerProfileId — join via raw SQL
  const pastRequestsResult = await db.execute<{ service_id: number | null; package_id: number | null } & Record<string, unknown>>(sql`
    SELECT sr.service_id, sr.package_id
    FROM ai_platform.ai_service_requests sr
    JOIN ai_platform.customer_profiles cp ON cp.client_email = sr.customer_email
    WHERE cp.id = ${ctx.customerProfileId}
      AND sr.status IN ('completed', 'delivered')
    ORDER BY sr.created_at DESC
    LIMIT 5
  `);
  const pastRequests = ((pastRequestsResult as unknown as { rows: Array<{ service_id: number | null; package_id: number | null }> }).rows ?? []).map((r) => ({
    serviceId: r.service_id,
    packageId: r.package_id,
  })) as ServiceRequestRow[];

  const usedServiceIds = [...new Set(pastRequests.map((r) => r.serviceId).filter((id): id is number => id != null))];

  if (usedServiceIds.length > 0 && !ctx.currentServiceId) {
    const services = await db
      .select()
      .from(aiServicesTable)
      .where(inArray(aiServicesTable.id, usedServiceIds)) as ServiceRow[];

    for (const svc of services.slice(0, 2)) {
      const contextKey = `repeat:svc:${svc.id}`;
      const cooldown = await checkCooldown({
        customerProfileId: ctx.customerProfileId,
        recType: "package_upgrade",
        contextKey,
      });
      if (cooldown.blocked) continue;

      recommendations.push({
        id: `package_upgrade:${ctx.customerProfileId}:${contextKey}`,
        type: "package_upgrade",
        customerProfileId: ctx.customerProfileId,
        title: `Lanjutkan dengan ${svc.serviceName}`,
        description: `Anda telah menggunakan layanan ini sebelumnya — pertimbangkan paket premium untuk hasil yang lebih optimal.`,
        reasonCode: "repeat_service_upsell",
        score: 65 + (ctx.healthScore ?? 50) * 0.2,
        payload: {
          serviceId: svc.id,
          ctaLabel: "Lihat Paket",
        },
        cooldownUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        requiresApproval: false,
        createdAt: new Date(),
      });
    }
  }

  // Record delivered recommendations (non-blocked ones)
  await Promise.all(
    recommendations.map((r) =>
      recordRecommendation({
        customerProfileId: ctx.customerProfileId,
        recType: r.type,
        contextKey: r.id.split(":").slice(2).join(":"),
        payloadJson: r.payload as Record<string, unknown>,
      }),
    ),
  );

  return recommendations.sort((a, b) => b.score - a.score);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scorePackageUpgrade(ctx: CustomerContext, packagePrice: number): number {
  let score = 50;
  if (ctx.segment === "vip" || ctx.segment === "enterprise") score += 25;
  if (ctx.segment === "returning") score += 10;
  if ((ctx.healthScore ?? 50) >= 75) score += 15;
  if (ctx.orderAmountHint && packagePrice <= ctx.orderAmountHint * 1.5) score += 10;
  return Math.min(score, 100);
}

function buildUpgradeDescription(pkg: PackageRow, ctx: CustomerContext): string {
  const segmentHint =
    ctx.segment === "vip" ? "Sebagai pelanggan VIP, " :
    ctx.segment === "enterprise" ? "Untuk kebutuhan enterprise, " :
    "";
  return `${segmentHint}${pkg.packageName} menawarkan lebih banyak fitur dan kapasitas untuk proyek Anda.`;
}
