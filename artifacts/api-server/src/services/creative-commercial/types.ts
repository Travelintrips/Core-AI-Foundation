/**
 * creative-commercial/types.ts — Team 03
 *
 * Shared types for the Creative AI Commercial Automation domain.
 * All money values are integers (smallest currency unit, e.g. IDR).
 * Recommendations are read-only by default; financial actions are
 * approval-required and go through cc_pending_approvals.
 */

// ── Recommendation types ──────────────────────────────────────────────────────

export type RecommendationType =
  | "package_upgrade"       // upsell to a higher tier package
  | "cross_sell"            // complementary service recommendation
  | "coupon_recovery"       // coupon for abandoned/at-risk customers
  | "bundle"                // creative service bundle
  | "repeat_order"          // re-order a completed service
  | "abandoned_checkout";   // recover incomplete checkout flow

export type RecommendationStatus = "pending" | "viewed" | "accepted" | "dismissed" | "expired";

export interface Recommendation {
  id: string;                            // deterministic: type:customerId:contextKey
  type: RecommendationType;
  customerProfileId: number;
  title: string;
  description: string;
  reasonCode: string;                    // machine-readable reason
  score: number;                         // 0–100 relevance score
  payload: RecommendationPayload;
  cooldownUntil: Date;                   // next eligible time for same rec
  requiresApproval: boolean;             // true for financial actions
  createdAt: Date;
}

export interface RecommendationPayload {
  serviceId?: number;
  packageId?: number;
  bundleItems?: BundleItem[];
  couponId?: number;
  couponCode?: string;
  discountAmount?: number;
  originalAmount?: number;
  savingsAmount?: number;
  promotionId?: number;
  serviceRequestId?: number;
  ctaLabel?: string;
  ctaUrl?: string;
  metadata?: Record<string, unknown>;
}

// ── Bundle types ──────────────────────────────────────────────────────────────

export interface BundleItem {
  serviceId: number;
  serviceCode: string;
  serviceName: string;
  packageId?: number;
  packageName?: string;
  unitPrice: number;
}

export interface ServiceBundle {
  bundleCode: string;
  bundleName: string;
  description: string;
  items: BundleItem[];
  totalListPrice: number;
  bundlePrice: number;
  savingsAmount: number;
  savingsPercent: number;
  targetSegments: string[];
  requiresApproval: boolean;
}

// ── Funnel projection types ───────────────────────────────────────────────────

export type FunnelStage =
  | "visitor"
  | "page_view"
  | "service_view"
  | "checkout_started"
  | "submitted"
  | "quoted"
  | "payment_verified"
  | "completed";

export interface FunnelStageData {
  stage: FunnelStage;
  count: number;
  conversionRate: number;        // rate into NEXT stage, 0–1
  dropOffRate: number;           // 1 - conversionRate
  avgTimeToNextStageHours?: number;
}

export interface FunnelProjection {
  periodDays: number;
  historicalFrom: Date;
  historicalTo: Date;
  projectedFrom: Date;
  projectedTo: Date;
  stages: FunnelStageData[];
  projectedRevenue: number;
  projectedOrders: number;
  bySource: Record<string, { visitors: number; conversions: number; revenue: number }>;
}

// ── Attribution types ─────────────────────────────────────────────────────────

export type TouchpointType =
  | "organic"
  | "paid_search"
  | "social"
  | "email"
  | "affiliate"
  | "referral"
  | "direct"
  | "other";

export interface AttributionTouchpoint {
  id: number;
  customerProfileId: number;
  serviceRequestId?: number;
  touchpointType: TouchpointType;
  source: string;
  medium?: string;
  campaign?: string;
  weight: number;                // 0–1, attribution weight
  occurredAt: Date;
}

export interface AttributionSummary {
  customerProfileId: number;
  serviceRequestId?: number;
  totalTouchpoints: number;
  firstTouch: AttributionTouchpoint | null;
  lastTouch: AttributionTouchpoint | null;
  multiTouchWeighted: Record<string, number>;  // source → weighted revenue share (0–1)
  conversionValue: number;
}

// ── Cooldown / idempotency types ──────────────────────────────────────────────

export interface CooldownEntry {
  customerProfileId: number;
  recType: RecommendationType;
  contextKey: string;
  cooldownUntil: Date;
  createdAt: Date;
}

export const COOLDOWN_HOURS: Record<RecommendationType, number> = {
  package_upgrade:      168,  // 7 days
  cross_sell:           72,   // 3 days
  coupon_recovery:      48,   // 2 days
  bundle:               120,  // 5 days
  repeat_order:         336,  // 14 days
  abandoned_checkout:   24,   // 1 day
};

// ── Pending approval types ────────────────────────────────────────────────────

export type ApprovalActionType =
  | "issue_bundle_discount"
  | "issue_recovery_coupon"
  | "apply_vip_bundle_price"
  | "issue_repeat_order_discount";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface PendingApproval {
  id: number;
  customerProfileId: number;
  actionType: ApprovalActionType;
  actionPayload: Record<string, unknown>;
  requestedBy: string;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}
