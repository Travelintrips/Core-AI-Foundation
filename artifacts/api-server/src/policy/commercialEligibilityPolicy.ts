/**
 * commercialEligibilityPolicy.ts — V4.2B Commercial Eligibility Guard
 *
 * Canonical, single source of truth for deciding which categories, services,
 * and packages are eligible to be seen or ordered by customers on the public
 * catalog. All backend routes MUST use these functions instead of inline
 * visibility/status comparisons.
 *
 * Rules (ALL must be true for a customer to see/order a service):
 *   Category  : visibility = 'public'
 *             AND commercial_status = 'commercial_ready'
 *             AND status = 'active'
 *   Service   : status = 'active'
 *   Package   : status = 'active'
 *
 * Design principles (per MASTER-00.md § TEAM-01):
 *   Pure       — no side effects, no database calls, no Express dependencies
 *   Reusable   — import freely in routes, middleware, tests
 *   Typed      — explicit input interfaces, no implicit any
 *   Testable   — deterministic output given deterministic input
 *   Deterministic — AI must never influence these decisions
 *   Documented — every export has a JSDoc description
 */

// ── Canonical eligibility constants ──────────────────────────────────────────

/** The only category visibility value that is eligible for customer display. */
export const ELIGIBLE_VISIBILITY = "public" as const;

/** The only commercial_status value that unlocks customer ordering. */
export const ELIGIBLE_COMMERCIAL_STATUS = "commercial_ready" as const;

/** The only status value that is eligible for both categories and services. */
export const ELIGIBLE_STATUS = "active" as const;

// ── Input interfaces ──────────────────────────────────────────────────────────

/** Minimal shape needed to evaluate a category's eligibility. */
export interface CategoryEligibilityInput {
  /** ai_service_categories.visibility — "public" | "internal" | "disabled" */
  visibility: string;
  /** ai_service_categories.commercial_status — "commercial_ready" | "internal_only" | "beta" | "disabled" */
  commercialStatus: string;
  /** ai_service_categories.status — "active" | "draft" | "archived" */
  status: string;
}

/** Minimal shape needed to evaluate a service's eligibility (includes its parent category). */
export interface ServiceEligibilityInput {
  /** ai_services.status — "active" | "draft" | "archived" */
  status: string;
  /** Denormalized from the service's parent category */
  categoryVisibility: string;
  categoryCommercialStatus: string;
  categoryStatus: string;
}

/** Minimal shape needed to evaluate a package's eligibility. */
export interface PackageEligibilityInput {
  /** ai_service_packages.status — "active" | "draft" | "archived" */
  status: string;
}

// ── Category eligibility ──────────────────────────────────────────────────────

/**
 * Returns true when the category may be displayed to customers and used for
 * ordering. All three conditions must hold simultaneously — no shortcuts.
 *
 * This is the canonical definition that fixes the V4.2A bug where 18 categories
 * with visibility='public' but commercial_status='internal_only' were leaking
 * into the customer-facing catalog.
 */
export function isCategoryCommerciallyEligible(
  cat: CategoryEligibilityInput,
): boolean {
  return (
    cat.status           === ELIGIBLE_STATUS            &&
    cat.visibility       === ELIGIBLE_VISIBILITY        &&
    cat.commercialStatus === ELIGIBLE_COMMERCIAL_STATUS
  );
}

/**
 * Returns a human-readable reason the category is NOT eligible, or null if it
 * is eligible. Checks in priority order so the most actionable reason is first.
 * Useful for test assertions and admin-facing diagnostics.
 */
export function getCategoryIneligibilityReason(
  cat: CategoryEligibilityInput,
): string | null {
  if (cat.status !== ELIGIBLE_STATUS) {
    return `category status is "${cat.status}" (must be "${ELIGIBLE_STATUS}")`;
  }
  if (cat.visibility !== ELIGIBLE_VISIBILITY) {
    return `category visibility is "${cat.visibility}" (must be "${ELIGIBLE_VISIBILITY}")`;
  }
  if (cat.commercialStatus !== ELIGIBLE_COMMERCIAL_STATUS) {
    return `category commercial_status is "${cat.commercialStatus}" (must be "${ELIGIBLE_COMMERCIAL_STATUS}")`;
  }
  return null;
}

// ── Service eligibility ───────────────────────────────────────────────────────

/**
 * Returns true when the service may be displayed to customers and used for
 * ordering. Both the service's own status AND its parent category must pass
 * their respective eligibility checks.
 */
export function isServiceCommerciallyEligible(
  svc: ServiceEligibilityInput,
): boolean {
  return (
    svc.status === ELIGIBLE_STATUS &&
    isCategoryCommerciallyEligible({
      status:           svc.categoryStatus,
      visibility:       svc.categoryVisibility,
      commercialStatus: svc.categoryCommercialStatus,
    })
  );
}

/**
 * Returns a human-readable reason the service is NOT eligible, or null if it
 * is. Checks service-level conditions first, then delegates to the category
 * check for the more precise reason.
 */
export function getServiceIneligibilityReason(
  svc: ServiceEligibilityInput,
): string | null {
  if (svc.status !== ELIGIBLE_STATUS) {
    return `service status is "${svc.status}" (must be "${ELIGIBLE_STATUS}")`;
  }
  return getCategoryIneligibilityReason({
    status:           svc.categoryStatus,
    visibility:       svc.categoryVisibility,
    commercialStatus: svc.categoryCommercialStatus,
  });
}

// ── Package eligibility ───────────────────────────────────────────────────────

/**
 * Returns true when the package may be displayed to customers.
 * Package eligibility is independent of its parent service's category — a
 * package on an ineligible service is never reachable from the public catalog.
 */
export function isPackageCommerciallyEligible(
  pkg: PackageEligibilityInput,
): boolean {
  return pkg.status === ELIGIBLE_STATUS;
}
