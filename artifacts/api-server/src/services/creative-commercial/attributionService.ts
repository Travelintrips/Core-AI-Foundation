/**
 * creative-commercial/attributionService.ts — Team 03
 *
 * Attribution read model for Creative AI commercial layer.
 *
 * Models supported:
 *   - First touch: 100% credit to first touchpoint
 *   - Last touch: 100% credit to last touchpoint
 *   - Linear multi-touch: equal weight across all touchpoints
 *   - Time-decay: recent touchpoints get exponentially more weight
 *
 * Reads from:
 *   - cc_attribution_touchpoints (team-03 table, via raw SQL)
 *   - sales_funnel_events (existing)
 *   - ai_affiliate_conversions (existing)
 *   - ai_service_requests (existing)
 *
 * No mutations to commercial source of truth — pure read model.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { AttributionSummary, AttributionTouchpoint, TouchpointType } from "./types.js";

type AttributionModel = "first_touch" | "last_touch" | "linear" | "time_decay";

// ── Read touchpoints from cc_attribution_touchpoints ─────────────────────────

type TouchpointRow = {
  id: number;
  customer_profile_id: number;
  service_request_id: number | null;
  touchpoint_type: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  weight: number;
  occurred_at: string;
} & Record<string, unknown>;

function mapTouchpoint(row: TouchpointRow): AttributionTouchpoint {
  return {
    id: row.id,
    customerProfileId: row.customer_profile_id,
    serviceRequestId: row.service_request_id ?? undefined,
    touchpointType: row.touchpoint_type as TouchpointType,
    source: row.source,
    medium: row.medium ?? undefined,
    campaign: row.campaign ?? undefined,
    weight: Number(row.weight),
    occurredAt: new Date(row.occurred_at),
  };
}

/**
 * Loads or synthesizes attribution touchpoints for a customer.
 * First checks cc_attribution_touchpoints; falls back to inferring
 * from sales_funnel_events UTM data.
 */
export async function getCustomerTouchpoints(
  customerProfileId: number,
  serviceRequestId?: number,
): Promise<AttributionTouchpoint[]> {
  // Try stored touchpoints first
  const stored = await db.execute<TouchpointRow>(sql`
    SELECT *
    FROM ai_platform.cc_attribution_touchpoints
    WHERE customer_profile_id = ${customerProfileId}
      ${serviceRequestId ? sql`AND (service_request_id = ${serviceRequestId} OR service_request_id IS NULL)` : sql``}
    ORDER BY occurred_at ASC
    LIMIT 200
  `);

  const storedRows = (stored as unknown as { rows: TouchpointRow[] }).rows ?? [];
  if (storedRows.length > 0) return storedRows.map(mapTouchpoint);

  // Fall back: infer from sales_funnel_events
  const events = await db.execute<{
    event_type: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    created_at: string;
  }>(sql`
    SELECT event_type, utm_source, utm_medium, utm_campaign, created_at
    FROM ai_platform.sales_funnel_events
    WHERE customer_id = ${customerProfileId}
    ORDER BY created_at ASC
    LIMIT 50
  `);

  const eventRows = (events as unknown as { rows: Array<{
    event_type: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    created_at: string;
  }> }).rows ?? [];

  return eventRows
    .filter((e) => e.utm_source)
    .map((e, idx) => ({
      id: -(idx + 1),  // synthetic negative ID
      customerProfileId,
      serviceRequestId,
      touchpointType: classifySource(e.utm_source ?? "direct", e.utm_medium),
      source: e.utm_source ?? "direct",
      medium: e.utm_medium ?? undefined,
      campaign: e.utm_campaign ?? undefined,
      weight: 0,  // will be calculated by model
      occurredAt: new Date(e.created_at),
    }));
}

/**
 * Calculates attribution summary for a customer/request using the
 * specified model.
 */
export async function calculateAttribution(opts: {
  customerProfileId: number;
  serviceRequestId?: number;
  model?: AttributionModel;
  conversionValue?: number;
}): Promise<AttributionSummary> {
  const model = opts.model ?? "linear";
  const touchpoints = await getCustomerTouchpoints(
    opts.customerProfileId,
    opts.serviceRequestId,
  );

  if (touchpoints.length === 0) {
    return {
      customerProfileId: opts.customerProfileId,
      serviceRequestId: opts.serviceRequestId,
      totalTouchpoints: 0,
      firstTouch: null,
      lastTouch: null,
      multiTouchWeighted: {},
      conversionValue: opts.conversionValue ?? 0,
    };
  }

  const weights = calculateWeights(touchpoints, model);

  // Apply weights and aggregate by source
  const multiTouchWeighted: Record<string, number> = {};
  for (let i = 0; i < touchpoints.length; i++) {
    const tp = touchpoints[i];
    const w = weights[i] ?? 0;
    multiTouchWeighted[tp.source] = (multiTouchWeighted[tp.source] ?? 0) + w;
  }

  return {
    customerProfileId: opts.customerProfileId,
    serviceRequestId: opts.serviceRequestId,
    totalTouchpoints: touchpoints.length,
    firstTouch: touchpoints[0] ?? null,
    lastTouch: touchpoints[touchpoints.length - 1] ?? null,
    multiTouchWeighted,
    conversionValue: opts.conversionValue ?? 0,
  };
}

/**
 * Bulk attribution report: aggregates across all service requests in a period.
 *
 * RBAC / Tenant scope:
 *   - tenantId: when provided, restricts results to customers belonging to that
 *     tenant via customer_profiles.tenant_id. Pass null or omit for platform-wide
 *     (super-admin) view — only callers with platform-level privilege should omit.
 *   - Per-customer endpoints (getCustomerTouchpoints / calculateAttribution) are
 *     already scoped by customerProfileId and need no additional filter here.
 */
export async function getAttributionReport(opts: {
  periodDays?: number;
  model?: AttributionModel;
  /** Restrict to a specific tenant. null/undefined = platform-wide (admin only). */
  tenantId?: string | null;
}): Promise<{
  model: AttributionModel;
  periodDays: number;
  bySource: Record<string, {
    touchpoints: number;
    conversions: number;
    weightedConversions: number;
    revenue: number;
  }>;
  topChannels: Array<{ source: string; weightedShare: number }>;
}> {
  const periodDays = opts.periodDays ?? 30;
  const model = opts.model ?? "linear";

  // Build tenant scope filter — restricts customer_id to the tenant's customers.
  // When tenantId is not provided, no filter is applied (platform-wide view).
  const tenantFilter = opts.tenantId != null
    ? sql`AND customer_id IN (
        SELECT id FROM ai_platform.customer_profiles WHERE tenant_id = ${opts.tenantId}
      )`
    : sql``;

  const result = await db.execute<{
    utm_source: string | null;
    customer_id: number | null;
    event_count: number;
  }>(sql`
    SELECT
      coalesce(utm_source, 'direct') AS utm_source,
      customer_id,
      count(*) AS event_count
    FROM ai_platform.sales_funnel_events
    WHERE created_at >= now() - ${periodDays} * interval '1 day'
      ${tenantFilter}
    GROUP BY coalesce(utm_source, 'direct'), customer_id
    HAVING customer_id IS NOT NULL
  `);

  const rows = (result as unknown as { rows: Array<{
    utm_source: string;
    customer_id: number;
    event_count: string;
  }> }).rows ?? [];

  const bySource: Record<string, { touchpoints: number; conversions: number; weightedConversions: number; revenue: number }> = {};

  for (const row of rows) {
    const src = row.utm_source;
    if (!bySource[src]) {
      bySource[src] = { touchpoints: 0, conversions: 0, weightedConversions: 0, revenue: 0 };
    }
    bySource[src].touchpoints += Number(row.event_count);
  }

  // Enrich with conversion data
  const convResult = await db.execute<{
    utm_source: string | null;
    conversion_count: number;
  }>(sql`
    SELECT
      coalesce(sfe.utm_source, 'direct') AS utm_source,
      count(DISTINCT sr.id) AS conversion_count
    FROM ai_platform.ai_service_requests sr
    JOIN ai_platform.sales_funnel_events sfe ON sfe.customer_id::int = (
      SELECT id FROM ai_platform.customer_profiles WHERE client_email = sr.customer_email LIMIT 1
    )
    WHERE sr.created_at >= now() - ${periodDays} * interval '1 day'
      AND sr.status IN ('completed', 'delivered')
      ${opts.tenantId != null ? sql`AND (
        SELECT id FROM ai_platform.customer_profiles WHERE client_email = sr.customer_email LIMIT 1
      ) IN (SELECT id FROM ai_platform.customer_profiles WHERE tenant_id = ${opts.tenantId})` : sql``}
    GROUP BY coalesce(sfe.utm_source, 'direct')
  `);

  for (const row of (convResult as unknown as { rows: Array<{
    utm_source: string;
    conversion_count: string;
  }> }).rows ?? []) {
    const src = row.utm_source;
    if (bySource[src]) {
      bySource[src].conversions = Number(row.conversion_count);
      bySource[src].weightedConversions = model === "first_touch" || model === "last_touch"
        ? bySource[src].conversions
        : bySource[src].conversions; // simplified — full linear weighting needs per-customer touch chains
    }
  }

  const totalWeighted = Object.values(bySource).reduce((s, v) => s + v.weightedConversions, 0);
  const topChannels = Object.entries(bySource)
    .map(([source, data]) => ({
      source,
      weightedShare: totalWeighted > 0 ? Math.round((data.weightedConversions / totalWeighted) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.weightedShare - a.weightedShare)
    .slice(0, 5);

  return { model, periodDays, bySource, topChannels };
}

/** Records a new attribution touchpoint (called by event handlers). */
export async function recordTouchpoint(opts: {
  customerProfileId: number;
  serviceRequestId?: number;
  touchpointType: TouchpointType;
  source: string;
  medium?: string;
  campaign?: string;
  occurredAt?: Date;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO ai_platform.cc_attribution_touchpoints
      (customer_profile_id, service_request_id, touchpoint_type, source, medium, campaign, weight, occurred_at)
    VALUES (
      ${opts.customerProfileId},
      ${opts.serviceRequestId ?? null},
      ${opts.touchpointType},
      ${opts.source},
      ${opts.medium ?? null},
      ${opts.campaign ?? null},
      0,
      ${(opts.occurredAt ?? new Date()).toISOString()}
    )
  `);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function calculateWeights(touchpoints: AttributionTouchpoint[], model: AttributionModel): number[] {
  const n = touchpoints.length;
  if (n === 0) return [];

  if (model === "first_touch") {
    return touchpoints.map((_, i) => (i === 0 ? 1 : 0));
  }

  if (model === "last_touch") {
    return touchpoints.map((_, i) => (i === n - 1 ? 1 : 0));
  }

  if (model === "linear") {
    return touchpoints.map(() => 1 / n);
  }

  if (model === "time_decay") {
    // More recent = higher weight. Use 2^(position/n) normalized.
    const raw = touchpoints.map((_, i) => Math.pow(2, i / n));
    const total = raw.reduce((s, v) => s + v, 0);
    return raw.map((v) => v / total);
  }

  return touchpoints.map(() => 1 / n);
}

function classifySource(source: string, medium: string | null): TouchpointType {
  if (source === "direct" || source === "") return "direct";
  if (["google", "bing", "yahoo"].includes(source.toLowerCase())) {
    return medium === "cpc" ? "paid_search" : "organic";
  }
  if (["facebook", "instagram", "twitter", "linkedin", "tiktok"].includes(source.toLowerCase())) {
    return "social";
  }
  if (medium === "email") return "email";
  if (medium === "affiliate") return "affiliate";
  if (medium === "referral") return "referral";
  return "other";
}
