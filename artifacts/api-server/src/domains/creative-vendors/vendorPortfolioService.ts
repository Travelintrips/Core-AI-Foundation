/**
 * vendorPortfolioService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * FINDING: creative_vendor_portfolio_items duplicates ai_service_portfolios.
 *
 * CANONICAL SOURCE: ai_service_portfolios (existing platform table)
 *   - Managed by the Portfolio/Showcase domain
 *   - Supports: cover image, gallery, industry, style, AI generation linkage
 *   - Has its own moderation (generation_status, qc_score, etc.)
 *
 * INTEGRATION CONTRACT (for Team 24 architecture review):
 *   Option A (recommended): Add FK column creative_vendor_profile_id to
 *     ai_service_portfolios to associate portfolio items with vendor profiles.
 *     Query as: SELECT * FROM ai_service_portfolios WHERE creative_vendor_profile_id = ?
 *
 *   Option B: creative_portfolio_associations join table
 *     (ai_service_portfolios.id ↔ creative_vendor_profiles.id) if portfolios
 *     need to be shared across multiple vendor profiles.
 *
 * ALL FUNCTIONS IN THIS FILE THROW BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING.
 * Replace with real implementation once architecture review is complete.
 */

/** Sentinel thrown by all functions in this file pending architecture review. */
export class VendorCanonicalMappingBlockedError extends Error {
  readonly code = "BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING";
  readonly domain = "portfolio";
  readonly canonicalSource = "ai_service_portfolios";

  constructor(fn: string) {
    super(
      `${fn}: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING — ` +
        `creative vendor portfolio maps to ai_service_portfolios (existing). ` +
        `Pending architecture review of integration contract (Option A: FK column, ` +
        `Option B: join table). See vendorPortfolioService.ts header.`,
    );
    this.name = "VendorCanonicalMappingBlockedError";
  }
}

/** Stub — BLOCKED. Canonical: ai_service_portfolios. */
export async function listVendorPortfolioPublic(_vendorId: number): Promise<never> {
  throw new VendorCanonicalMappingBlockedError("listVendorPortfolioPublic");
}

/** Stub — BLOCKED. Canonical: ai_service_portfolios. */
export async function listVendorPortfolioAdmin(
  _profileId: number,
  _moderationStatus?: string,
  _page?: number,
  _pageSize?: number,
): Promise<never> {
  throw new VendorCanonicalMappingBlockedError("listVendorPortfolioAdmin");
}

/** Stub — BLOCKED. Canonical: ai_service_portfolios. */
export async function addPortfolioItem(
  _profileId: number,
  _input: unknown,
): Promise<never> {
  throw new VendorCanonicalMappingBlockedError("addPortfolioItem");
}

/** Stub — BLOCKED. Canonical: ai_service_portfolios. */
export async function approvePortfolioItem(
  _profileId: number,
  _itemId: number,
): Promise<never> {
  throw new VendorCanonicalMappingBlockedError("approvePortfolioItem");
}

/** Stub — BLOCKED. Canonical: ai_service_portfolios. */
export async function rejectPortfolioItem(
  _profileId: number,
  _itemId: number,
  _reason: string,
): Promise<never> {
  throw new VendorCanonicalMappingBlockedError("rejectPortfolioItem");
}
