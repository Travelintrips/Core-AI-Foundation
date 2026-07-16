/**
 * creative-commercial/bundlingService.ts — Team 03
 *
 * Creative service bundling: predefined bundle templates that combine
 * complementary services at a package discount.
 *
 * Bundles are catalog-level constructs, not pricing mutations.
 * The bundle PRICE is a recommendation only — actual pricing/discounting
 * must be approved by an admin before application.
 *
 * VIP/Enterprise bundles with >20% discount require approval.
 */

import { db, aiServicesTable, aiServicePackagesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { createPendingApproval } from "./approvalService.js";
import type { ServiceBundle, BundleItem } from "./types.js";

// ── Bundle definitions ────────────────────────────────────────────────────────
// Static catalog — operations team adds new bundles here.
// Prices are in IDR (integer). savingsPercent drives whether approval is needed.

const BUNDLE_CATALOG: Omit<ServiceBundle, "items" | "totalListPrice" | "bundlePrice" | "savingsAmount" | "savingsPercent">[] = [
  {
    bundleCode: "brand-launch-pack",
    bundleName: "Brand Launch Pack",
    description: "Paket lengkap peluncuran brand: identitas visual + profil perusahaan + media sosial.",
    targetSegments: ["new", "returning", "high_potential"],
    requiresApproval: false,
  },
  {
    bundleCode: "enterprise-brand-suite",
    bundleName: "Enterprise Brand Suite",
    description: "Suite enterprise: brand identity + website + annual report + company profile.",
    targetSegments: ["enterprise", "vip"],
    requiresApproval: true, // >20% discount — always approval-required
  },
  {
    bundleCode: "digital-presence-pack",
    bundleName: "Digital Presence Pack",
    description: "Paket digital: website design + SEO + social media kit + copywriting.",
    targetSegments: ["returning", "high_value", "vip"],
    requiresApproval: false,
  },
  {
    bundleCode: "content-machine-pack",
    bundleName: "Content Machine Pack",
    description: "Mesin konten: social media kit + content calendar + copywriting + infographic.",
    targetSegments: ["new", "returning", "high_potential"],
    requiresApproval: false,
  },
  {
    bundleCode: "product-launch-pack",
    bundleName: "Product Launch Pack",
    description: "Peluncuran produk: packaging design + label design + product photography + brand identity.",
    targetSegments: ["returning", "enterprise"],
    requiresApproval: false,
  },
];

// Service codes in each bundle — resolved to real IDs at runtime
const BUNDLE_SERVICE_CODES: Record<string, string[]> = {
  "brand-launch-pack":      ["brand-identity", "company-profile", "social-media-kit"],
  "enterprise-brand-suite": ["brand-identity", "website-design", "annual-report", "company-profile"],
  "digital-presence-pack":  ["website-design", "seo-optimization", "social-media-kit", "copywriting"],
  "content-machine-pack":   ["social-media-kit", "content-calendar", "copywriting"],
  "product-launch-pack":    ["packaging-design", "label-design", "brand-identity"],
};

// Bundle discount per code (0–1)
const BUNDLE_DISCOUNTS: Record<string, number> = {
  "brand-launch-pack":      0.10,
  "enterprise-brand-suite": 0.22,
  "digital-presence-pack":  0.12,
  "content-machine-pack":   0.08,
  "product-launch-pack":    0.10,
};

/**
 * Returns all bundles with real-time price calculation from the DB.
 * Filters by customer segment if provided.
 */
export async function getAvailableBundles(opts: {
  customerSegment?: string;
  filterOwned?: number[];  // serviceIds the customer already has
}): Promise<ServiceBundle[]> {
  const result: ServiceBundle[] = [];

  for (const def of BUNDLE_CATALOG) {
    // Segment filter
    if (
      opts.customerSegment &&
      def.targetSegments.length > 0 &&
      !def.targetSegments.includes(opts.customerSegment)
    ) continue;

    const serviceCodes = BUNDLE_SERVICE_CODES[def.bundleCode] ?? [];
    const services = await db
      .select()
      .from(aiServicesTable)
      .where(inArray(aiServicesTable.serviceCode, serviceCodes));

    if (services.length === 0) continue;

    // Exclude bundles where customer already owns most services
    if (opts.filterOwned && opts.filterOwned.length > 0) {
      const ownedCount = services.filter((s) => opts.filterOwned!.includes(s.id)).length;
      if (ownedCount >= services.length - 1) continue; // they own all but 1 — not worth bundling
    }

    const items: BundleItem[] = services.map((svc) => ({
      serviceId: svc.id,
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName,
      unitPrice: Math.round(Number(svc.startingPrice ?? 0)),
    }));

    const totalListPrice = items.reduce((sum, i) => sum + i.unitPrice, 0);
    const discount = BUNDLE_DISCOUNTS[def.bundleCode] ?? 0.10;
    const savingsAmount = Math.round(totalListPrice * discount);
    const bundlePrice = totalListPrice - savingsAmount;
    const savingsPercent = Math.round(discount * 100);

    result.push({
      ...def,
      items,
      totalListPrice,
      bundlePrice,
      savingsAmount,
      savingsPercent,
      requiresApproval: def.requiresApproval || savingsPercent > 20,
    });
  }

  return result;
}

/**
 * Returns a bundle recommendation for a specific customer context.
 * Based on: what they've viewed + segment.
 */
export async function getBundleRecommendation(opts: {
  customerProfileId: number;
  viewedServiceCode?: string;
  segment?: string;
}): Promise<ServiceBundle | null> {
  // Find owned services (join via customer_profiles since service_requests has customerEmail not customerProfileId)
  const ownedResult = await db.execute<{ service_id: number | null } & Record<string, unknown>>(sql`
    SELECT sr.service_id
    FROM ai_platform.ai_service_requests sr
    JOIN ai_platform.customer_profiles cp ON cp.client_email = sr.customer_email
    WHERE cp.id = ${opts.customerProfileId}
      AND sr.status IN ('completed', 'delivered', 'in_progress')
  `);
  const ownedIds = ((ownedResult as unknown as { rows: Array<{ service_id: number | null }> }).rows ?? [])
    .map((r) => r.service_id)
    .filter((id): id is number => id != null);

  const bundles = await getAvailableBundles({
    customerSegment: opts.segment,
    filterOwned: ownedIds,
  });

  if (bundles.length === 0) return null;

  // If viewing a specific service, prefer bundles that include it
  if (opts.viewedServiceCode) {
    const matching = bundles.find((b) =>
      b.items.some((i) => i.serviceCode === opts.viewedServiceCode),
    );
    if (matching) return matching;
  }

  // Otherwise return highest-savings bundle
  return bundles.sort((a, b) => b.savingsAmount - a.savingsAmount)[0] ?? null;
}

/**
 * Admin: request approval to apply a bundle discount for a specific customer.
 * Financial mutation — always goes through approval flow.
 */
export async function requestBundleDiscount(opts: {
  customerProfileId: number;
  bundleCode: string;
  requestedBy: string;
}): Promise<{ approvalId: number; bundle: ServiceBundle | null }> {
  const bundles = await getAvailableBundles({});
  const bundle = bundles.find((b) => b.bundleCode === opts.bundleCode) ?? null;

  if (!bundle) throw new Error(`Bundle ${opts.bundleCode} not found`);

  const approval = await createPendingApproval({
    customerProfileId: opts.customerProfileId,
    actionType: "issue_bundle_discount",
    actionPayload: {
      bundleCode: opts.bundleCode,
      bundleName: bundle.bundleName,
      bundlePrice: bundle.bundlePrice,
      savingsAmount: bundle.savingsAmount,
      savingsPercent: bundle.savingsPercent,
    },
    requestedBy: opts.requestedBy,
    expiresInHours: 48,
  });

  return { approvalId: approval.id, bundle };
}
