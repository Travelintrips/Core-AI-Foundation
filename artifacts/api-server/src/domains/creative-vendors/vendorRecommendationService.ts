/**
 * vendorRecommendationService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Recommendation compatibility scoring: score a vendor against a project request.
 *
 * Score breakdown (0-100):
 *   - Category match:    30 pts (primary type match)
 *   - Area match:        25 pts (province or remote-capable)
 *   - Availability:      20 pts (isAvailableNow + lead time fit)
 *   - Rating:            15 pts (normalized 0-5 → 0-15)
 *   - Verification:      10 pts (verified badge)
 *
 * PERFORMANCE:
 *   Service areas are batch-loaded (single query for all candidates) to avoid
 *   N+1 DB calls. Previously: 1 query per vendor. Now: 1 query for all vendors.
 */
import { eq, and, inArray } from "drizzle-orm";
import {
  vendorDb,
  vendorsTable,
  vendorServiceAreasTable,
  VENDOR_TYPES,
} from "./schema.js";
import { searchVendors, toPublicCard, type PublicVendorCard } from "./vendorService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RecommendationRequest {
  vendorType: string;
  province?: string;
  city?: string;
  maxLeadTimeDays?: number;
  isRemoteOk?: boolean; // requester can work with remote vendor
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

type ServiceAreaRow = { province: string; city: string | null; isRemote: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

// ─────────────────────────────────────────────────────────────────────────────
// Score a single vendor (synchronous — service areas pre-fetched)
// ─────────────────────────────────────────────────────────────────────────────

function scoreVendor(
  vendor: PublicVendorCard,
  req: RecommendationRequest,
  serviceAreas: ServiceAreaRow[],
): ScoredVendor {
  const breakdown = {
    categoryMatch: 0,
    areaMatch: 0,
    availability: 0,
    rating: 0,
    verification: 0,
  };
  const matchReasons: string[] = [];

  // ── Category match (30 pts) ──────────────────────────────────────────────
  if (vendor.vendorType === req.vendorType) {
    breakdown.categoryMatch = 30;
    matchReasons.push(`Spesialisasi ${req.vendorType.replace(/_/g, " ")}`);
  }

  // ── Area match (25 pts) ──────────────────────────────────────────────────
  if (req.province) {
    const vendorProvince = vendor.province?.toLowerCase();
    const requestedProvince = req.province.toLowerCase();

    const servesProvince =
      vendorProvince === requestedProvince ||
      serviceAreas.some(
        (a) => a.province.toLowerCase() === requestedProvince,
      );
    const isRemoteCapable = serviceAreas.some((a) => a.isRemote);

    if (servesProvince) {
      breakdown.areaMatch = 25;
      matchReasons.push(`Melayani ${req.province}`);
    } else if (isRemoteCapable && req.isRemoteOk) {
      breakdown.areaMatch = 15;
      matchReasons.push("Dapat bekerja remote");
    }
    // else: no area points
  } else {
    // No area constraint — full points (all vendors eligible)
    breakdown.areaMatch = 25;
  }

  // ── Availability (20 pts) ────────────────────────────────────────────────
  if (vendor.isAvailableNow) {
    breakdown.availability += 10;
    matchReasons.push("Tersedia sekarang");
  }
  if (!req.maxLeadTimeDays || vendor.leadTimeDays <= req.maxLeadTimeDays) {
    breakdown.availability += 10;
    if (req.maxLeadTimeDays) {
      matchReasons.push(`Lead time ${vendor.leadTimeDays} hari`);
    }
  }

  // ── Rating (15 pts) ──────────────────────────────────────────────────────
  const avgRating = parseFloat(vendor.avgRating ?? "0");
  // 5 stars → 15 pts, 0 stars → 0 pts
  breakdown.rating = clamp(Math.round((avgRating / 5) * 15), 0, 15);
  if (avgRating >= 4.5) matchReasons.push(`Rating ${avgRating.toFixed(1)} ⭐`);

  // ── Verification (10 pts) ────────────────────────────────────────────────
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

  return {
    vendor,
    compatibilityScore: clamp(compatibilityScore, 0, 100),
    scoreBreakdown: breakdown,
    matchReasons,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recommend vendors for a project
//
// Performance: batch-loads service areas for all candidate vendors in a
// single query (avoids N+1: was previously 1 DB call per vendor).
// ─────────────────────────────────────────────────────────────────────────────

export async function recommendVendors(
  req: RecommendationRequest,
): Promise<ScoredVendor[]> {
  const { vendorType, province, maxLeadTimeDays, limit = 10 } = req;
  const safeLimit = Math.min(Math.max(1, limit), 20);

  // Pull a wider pool then score + rank
  const { items } = await searchVendors({
    vendorType: VENDOR_TYPES.includes(vendorType as (typeof VENDOR_TYPES)[number])
      ? (vendorType as (typeof VENDOR_TYPES)[number])
      : undefined,
    province,
    maxLeadTimeDays,
    pageSize: 50,
  });

  if (items.length === 0) return [];

  // Batch-load service areas for all candidate vendor IDs (single query)
  const vendorIds = items.map((v) => v.id);
  const allServiceAreas = vendorIds.length > 0
    ? await vendorDb
        .select({
          vendorId: vendorServiceAreasTable.vendorId,
          province: vendorServiceAreasTable.province,
          city: vendorServiceAreasTable.city,
          isRemote: vendorServiceAreasTable.isRemote,
        })
        .from(vendorServiceAreasTable)
        .where(inArray(vendorServiceAreasTable.vendorId, vendorIds))
    : [];

  // Build a Map<vendorId, ServiceAreaRow[]> for O(1) lookup
  const serviceAreaMap = new Map<number, ServiceAreaRow[]>();
  for (const area of allServiceAreas) {
    const existing = serviceAreaMap.get(area.vendorId) ?? [];
    existing.push({ province: area.province, city: area.city, isRemote: area.isRemote });
    serviceAreaMap.set(area.vendorId, existing);
  }

  // Score all candidates (now synchronous — no DB calls inside)
  const scored = items.map((v) =>
    scoreVendor(v, req, serviceAreaMap.get(v.id) ?? []),
  );

  return scored
    .filter((s) => s.compatibilityScore > 0)
    .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
    .slice(0, safeLimit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Check if a single vendor is compatible with a request
// ─────────────────────────────────────────────────────────────────────────────

export async function checkVendorCompatibility(
  vendorId: number,
  req: RecommendationRequest,
): Promise<ScoredVendor | null> {
  const [v] = await vendorDb
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.id, vendorId),
        eq(vendorsTable.moderationStatus, "approved"),
        eq(vendorsTable.status, "active"),
      ),
    );
  if (!v) return null;

  // Load service areas for this specific vendor
  const serviceAreas = await vendorDb
    .select({
      vendorId: vendorServiceAreasTable.vendorId,
      province: vendorServiceAreasTable.province,
      city: vendorServiceAreasTable.city,
      isRemote: vendorServiceAreasTable.isRemote,
    })
    .from(vendorServiceAreasTable)
    .where(eq(vendorServiceAreasTable.vendorId, vendorId));

  return scoreVendor(toPublicCard(v), req, serviceAreas);
}
