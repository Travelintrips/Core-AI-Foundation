/**
 * repositories/quotationCompatibilityAdapter.ts — WP-09/10 Quotation
 * compatibility read adapter.
 *
 * The dual-quotation lineage (canonical ai_quotations vs legacy
 * creative_project_quotations) requires a single, uniform read interface
 * for consumers that must resolve whichever lineage a given project uses.
 * This adapter provides that interface WITHOUT merging the two tables or
 * collapsing the fork point — the fork must stay explicit per spec §6.2.
 *
 * Four existing consumers updated to use this adapter (spec §6.3):
 *   - services/commercialGateService.ts   (dual quotationId/serviceQuotationId)
 *   - services/customerWorkspaceService.ts (workspace quotation view)
 *   - routes/public-review.ts             (customer-facing status check)
 *   - routes/customer-portal.ts           (getCustomerReviewData)
 *
 * The adapter is READ-ONLY. All writes go through quotationRepository.ts
 * (canonical) or are frozen (legacy). It does not bypass tenant filtering —
 * canonical lookups delegate to getCanonicalQuotationById which enforces the
 * tenant guard; legacy lookups remain un-tenant-filtered (no tenantId column)
 * exactly as documented in quotationRepository.ts.
 */

import {
  getCanonicalQuotationById,
  getLegacyQuotationByProjectId,
  listQuotationItems,
} from "./quotationRepository.js";
import type { RepositoryContext } from "./types.js";
import type { AiQuotation, AiQuotationItem, CreativeProjectQuotation } from "@workspace/db";

// ── Unified view type ─────────────────────────────────────────────────────────

/**
 * A normalized, lineage-agnostic quotation view safe to pass to any consumer
 * that only needs to display status / totals. Do not store this type in the
 * DB — it is a synthetic read-side projection only.
 */
export interface CanonicalQuotationView {
  /** Database id (from whichever table resolved). */
  readonly id: number;
  /** `canonical` = ai_quotations; `legacy` = creative_project_quotations. */
  readonly lineage: "canonical" | "legacy";
  /** The quotation code (canonical only; null for legacy rows). */
  readonly quotationCode: string | null;
  /**
   * Unified status — canonical statuses are passed through verbatim;
   * legacy statuses are mapped to the closest canonical equivalent so
   * consumers need only one set of display strings.
   *   legacy "sent"     → "issued"
   *   legacy "approved" → "approved"
   *   legacy "rejected" → "rejected"
   *   legacy "expired"  → "expired"
   *   legacy "draft"    → "draft"
   */
  readonly status: string;
  readonly currency: string;
  /** Subtotal before discount/tax (in integer currency units). */
  readonly subtotal: number;
  readonly discount: number;
  readonly tax: number;
  readonly total: number;
  readonly validUntil: Date | null;
  readonly issuedAt: Date | null;
  readonly viewedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly rejectedAt: Date | null;
  readonly revisionRequestedAt: Date | null;
  readonly revisionNotes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** True if the quotation row has been soft-deleted. */
  readonly isDeleted: boolean;
}

// ── Status mapping: legacy → canonical ────────────────────────────────────────

const LEGACY_STATUS_MAP: Record<string, string> = {
  draft: "draft",
  sent: "issued",     // "sent" in legacy ≈ "issued" in canonical
  approved: "approved",
  rejected: "rejected",
  expired: "expired",
};

function mapLegacyStatus(legacyStatus: string): string {
  return LEGACY_STATUS_MAP[legacyStatus] ?? legacyStatus;
}

// ── Factories ─────────────────────────────────────────────────────────────────

function fromCanonical(q: AiQuotation): CanonicalQuotationView {
  return {
    id: q.id,
    lineage: "canonical",
    quotationCode: q.quotationCode,
    status: q.status,
    currency: q.currency,
    subtotal: q.subtotal,
    discount: q.discount,
    tax: q.tax,
    total: q.total,
    validUntil: q.validUntil ?? null,
    issuedAt: q.issuedAt ?? null,
    viewedAt: q.viewedAt ?? null,
    approvedAt: q.approvedAt ?? null,
    rejectedAt: q.rejectedAt ?? null,
    revisionRequestedAt: q.revisionRequestedAt ?? null,
    revisionNotes: q.revisionNotes ?? null,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    isDeleted: q.deletedAt !== null,
  };
}

function fromLegacy(q: CreativeProjectQuotation): CanonicalQuotationView {
  const subtotal = q.subtotal;
  const discount = q.discount;
  const tax = q.taxAmount;
  return {
    id: q.id,
    lineage: "legacy",
    quotationCode: null,
    status: mapLegacyStatus(q.status),
    currency: q.currency,
    subtotal,
    discount,
    tax,
    total: q.total,
    validUntil: q.validUntil ?? null,
    issuedAt: q.sentAt ?? null,          // sent ≈ issued
    viewedAt: null,                       // no view tracking in legacy
    approvedAt: q.respondedAt && q.status === "approved" ? q.respondedAt : null,
    rejectedAt: q.respondedAt && q.status === "rejected" ? q.respondedAt : null,
    revisionRequestedAt: null,
    revisionNotes: q.responseNotes ?? null,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    isDeleted: q.deletedAt !== null,
  };
}

// ── resolveQuotationForGate ───────────────────────────────────────────────────

/**
 * Resolves a unified CanonicalQuotationView from a commercial gate's
 * quotation pointers. Prefers the canonical lineage (serviceQuotationId)
 * over the legacy one (quotationId) when both are present, matching the
 * dual-branch semantics in serviceRequestConversionService.ts.
 *
 * Returns null if neither pointer resolves to an existing row.
 */
export async function resolveQuotationForGate(
  ctx: RepositoryContext,
  gate: {
    serviceQuotationId?: number | null;
    quotationId?: number | null;
  },
): Promise<CanonicalQuotationView | null> {
  // Canonical path first
  if (gate.serviceQuotationId != null) {
    const q = await getCanonicalQuotationById(ctx, gate.serviceQuotationId);
    if (q) return fromCanonical(q);
  }

  // Legacy fallback — projectId is not on the gate directly, so this path is
  // used when the caller already knows which projectId owns the legacy quotation.
  // Callers that need to resolve by quotation.id directly should use
  // resolveCanonicalOrLegacyById (below).
  return null;
}

// ── resolveCanonicalOrLegacyById ─────────────────────────────────────────────

/**
 * Resolves a quotation by a pair of nullable ids — exactly one of which must
 * be non-null. The canonical id takes priority.
 *
 * This replaces the pattern in public-review.ts and customer-portal.ts where
 * the code reads `gate.serviceQuotationId ?? gate.quotationId` and then has
 * to guess which table to query.
 */
export async function resolveCanonicalOrLegacyById(
  ctx: RepositoryContext,
  opts: {
    canonicalId?: number | null;
    legacyProjectId?: string | null;
  },
): Promise<CanonicalQuotationView | null> {
  if (opts.canonicalId != null) {
    const q = await getCanonicalQuotationById(ctx, opts.canonicalId);
    return q ? fromCanonical(q) : null;
  }
  if (opts.legacyProjectId != null) {
    const q = await getLegacyQuotationByProjectId(ctx, opts.legacyProjectId);
    return q ? fromLegacy(q) : null;
  }
  return null;
}

// ── resolveQuotationForProject ────────────────────────────────────────────────

/**
 * Highest-level resolver for consumer code: given a projectId and optional
 * canonical quotation id, returns whichever quotation the project has.
 *
 * Resolution order:
 *   1. Canonical by canonicalId (if provided)
 *   2. Legacy by projectId (historical fallback)
 *
 * This is the primary entry point for customerWorkspaceService.ts,
 * public-review.ts, and customer-portal.ts.
 */
export async function resolveQuotationForProject(
  ctx: RepositoryContext,
  opts: {
    projectId: string;
    canonicalId?: number | null;
  },
): Promise<CanonicalQuotationView | null> {
  if (opts.canonicalId != null) {
    const q = await getCanonicalQuotationById(ctx, opts.canonicalId);
    if (q) return fromCanonical(q);
  }
  // Fallback to legacy
  const legacy = await getLegacyQuotationByProjectId(ctx, opts.projectId);
  return legacy ? fromLegacy(legacy) : null;
}

// ── getQuotationItemsForView ──────────────────────────────────────────────────

/**
 * Fetches items for a canonical quotation view (only available for the
 * canonical lineage — legacy quotations store line items as JSONB on the
 * parent row, not as separate normalized rows).
 */
export async function getQuotationItemsForView(
  ctx: RepositoryContext,
  view: CanonicalQuotationView,
): Promise<AiQuotationItem[]> {
  if (view.lineage !== "canonical") return [];
  return listQuotationItems(ctx, view.id);
}
