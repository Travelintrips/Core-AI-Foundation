/**
 * vendorRecommendationService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Recommendation compatibility scoring: score a vendor against a project request.
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * STATUS: KEPT — recommendation logic is a new concept with no existing counterpart.
 *   Updated to use creative_vendor_profiles + marketplace_creators JOIN (extension pattern).
 *
 * Score breakdown (0–100):
 *   Category match:  30 pts  (vendorType matches request)
 *   Area match:      25 pts  (province or remote-capable)
 *   Availability:    20 pts  (isAvailableNow + lead time fit)
 *   Rating:          15 pts  (normalised from marketplace_creators.avg_rating)
 *   Verification:    10 pts  (marketplace_creators.is_verified)
 *
 * PERFORMANCE:
 *   Service areas are batch-loaded (single query for all candidates) — no N+1.
 */
import { eq, and, inArray } from "drizzle-orm";
import {
  vendorDb,
  creativeVendorProfilesTable,
  vendorServiceAreasTable,
  VENDOR_TYPES,
} from "./schema.js";
import { marketplaceCreatorsTable } from "@workspace/db";
import { searchVendors, toPublicCard, type PublicVendorCard } from "./vendorService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendationRequest {
  vendorType: string;
  province?: string;
  city?: string;
  maxLeadTimeDays?: number;
  isRemoteOk?: boolean;
  limit?: number;
}

export interface ScoredVendor {
  vendor: PublicVendorCard;
  compatibilityScore: number;
  scoreBreakdown: {
    categoryMatch: number;
    areaMatch: number;
    availability: number;
    rating: number;
    verification: number;
  };
  matchReasons: string[];
}

type ServiceAreaRow = { profileId: number; province: string; city: string | null; isRemote: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Score a single vendor (synchronous — service areas pre-fetched)
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function scoreVendor(
  vendor: PublicVendorCard,
  req: RecommendationRequest,
  serviceAreas: ServiceAreaRow[],
): ScoredVendor {
  const breakdown = { categoryMatch: 0, areaMatch: 0, availability: 0, rating: 0, verification: 0 };
  const matchReasons: string[] = [];

  // Category match (30 pts)
  if (vendor.vendorType === req.vendorType) {
    breakdown.categoryMatch = 30;
    matchReasons.push(`Spesialisasi ${req.vendorType.replace(/_/g, " ")}`);
  }

  // Area match (25 pts)
  if (req.province) {
    const vendorProvince = vendor.province?.toLowerCase();
    const requestedProvince = req.province.toLowerCase();
    const servesProvince =
      vendorProvince === requestedProvince ||
      serviceAreas.some((a) => a.province.toLowerCase() === requestedProvince);
    const isRemoteCapable = serviceAreas.some((a) => a.isRemote);
    if (servesProvince) {
      breakdown.areaMatch = 25;
      matchReasons.push(`Melayani ${req.province}`);
    } else if (isRemoteCapable && req.isRemoteOk) {
      breakdown.areaMatch = 15;
      matchReasons.push("Dapat bekerja remote");
    }
  } else {
    breakdown.areaMatch = 25; // no area constraint — all eligible
  }

  // Availability (20 pts)
  if (vendor.isAvailableNow) {
    breakdown.availability += 10;
    matchReasons.push("Tersedia sekarang");
  }
  if (!req.maxLeadTimeDays || vendor.leadTimeDays <= req.maxLeadTimeDays) {
    breakdown.availability += 10;
    if (req.maxLeadTimeDays) {
      matchReasons.push(`Lead time ≤ ${req.maxLeadTimeDays} hari`);
    }
  }

  // Rating (15 pts) — normalised from marketplace_creators.avg_rating (0–5)
  const rating = parseFloat(vendor.avgRating ?? "0");
  breakdown.rating = clamp(Math.round((rating / 5) * 15), 0, 15);
  if (rating >= 4.0) matchReasons.push(`Rating tinggi (${rating.toFixed(1)})`);

  // Verification (10 pts) — from marketplace_creators.is_verified
  if (vendor.isVerified) {
    breakdown.verification = 10;
    matchReasons.push("Vendor terverifikasi");
  }

  const compatibilityScore =
    breakdown.categoryMatch +
    breakdown.areaMatch +
    breakdown.availability +
    breakdown.rating +
    breakdown.verification;

  return { vendor, compatibilityScore, scoreBreakdown: breakdown, matchReasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommend vendors — batch service area load (N+1 avoided)
// ─────────────────────────────────────────────────────────────────────────────

export async function recommendVendors(req: RecommendationRequest): Promise<ScoredVendor[]> {
  const safeLimit = Math.min(Math.max(1, req.limit ?? 10), 50);

  // Load approved vendors of the requested type (capped at 200 candidates)
  const { items } = await searchVendors({
    vendorType: VENDOR_TYPES.includes(req.vendorType as (typeof VENDOR_TYPES)[number])
      ? (req.vendorType as (typeof VENDOR_TYPES)[number])
      : undefined,
    pageSize: 200,
    sort: "rating",
  });

  if (items.length === 0) return [];

  // Batch-load service areas for all candidates (single query — no N+1)
  const profileIds = items.map((v) => v.profileId);
  const allServiceAreas = await vendorDb
    .select({
      profileId: vendorServiceAreasTable.profileId,
      province: vendorServiceAreasTable.province,
      city: vendorServiceAreasTable.city,
      isRemote: vendorServiceAreasTable.isRemote,
    })
    .from(vendorServiceAreasTable)
    .where(inArray(vendorServiceAreasTable.profileId, profileIds));

  // Build profileId → service areas map
  const serviceAreaMap = new Map<number, ServiceAreaRow[]>();
  for (const area of allServiceAreas) {
    const existing = serviceAreaMap.get(area.profileId) ?? [];
    existing.push({ profileId: area.profileId, province: area.province, city: area.city, isRemote: area.isRemote });
    serviceAreaMap.set(area.profileId, existing);
  }

  const scored = items.map((v) =>
    scoreVendor(v, req, serviceAreaMap.get(v.profileId) ?? []),
  );

  return scored
    .filter((s) => s.compatibilityScore > 0)
    .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
    .slice(0, safeLimit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Check compatibility of a single vendor
// ─────────────────────────────────────────────────────────────────────────────

export async function checkVendorCompatibility(
  vendorId: number,
  req: RecommendationRequest,
): Promise<ScoredVendor | null> {
  const [row] = await vendorDb
    .select({ creator: marketplaceCreatorsTable, profile: creativeVendorProfilesTable })
    .from(creativeVendorProfilesTable)
    .innerJoin(
      marketplaceCreatorsTable,
      eq(creativeVendorProfilesTable.creatorId, marketplaceCreatorsTable.id),
    )
    .where(
      and(
        eq(marketplaceCreatorsTable.id, vendorId),
        eq(creativeVendorProfilesTable.moderationStatus, "approved"),
        eq(marketplaceCreatorsTable.isActive, true),
      ),
    );
  if (!row) return null;

  const serviceAreas = await vendorDb
    .select({
      profileId: vendorServiceAreasTable.profileId,
      province: vendorServiceAreasTable.province,
      city: vendorServiceAreasTable.city,
      isRemote: vendorServiceAreasTable.isRemote,
    })
    .from(vendorServiceAreasTable)
    .where(eq(vendorServiceAreasTable.profileId, row.profile.id));

  return scoreVendor(toPublicCard(row.creator, row.profile), req, serviceAreas);
}
