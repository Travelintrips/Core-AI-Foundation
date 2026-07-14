/**
 * imageBatchEntitlementService.ts — Phase 5 Creative Asset Batch Engine
 *
 * Resolves how many images (and of what shape) a project is actually
 * entitled to, in this priority order:
 *   1. Service-request pricing snapshot override (custom quotation deliverables
 *      explicitly negotiated for this order — the most authoritative source).
 *   2. The purchased package's `limits_json[batchType]` (real, structured
 *      entitlement configured on the catalog package).
 *   3. The batch definition's hardcoded catalog fallback (legacy orders that
 *      predate structured entitlement data, or projects created outside the
 *      service catalog).
 *
 * Quantity is NEVER inferred from a package *name* string — only from
 * structured data (snapshot override, limits_json, or the definition's fixed
 * fallback constant).
 */

import { eq } from "drizzle-orm";
import {
  db,
  aiServiceRequestsTable,
  aiServicePackagesTable,
  type CreativeProject,
} from "@workspace/db";
import type { BatchEntitlement, EntitlementGroup, EntitlementSource, ImageBatchType } from "./imageBatchTypes.js";

function normalizeGroups(raw: unknown): EntitlementGroup[] | null {
  if (!Array.isArray(raw)) return null;
  const groups: EntitlementGroup[] = [];
  for (const g of raw) {
    if (!g || typeof g !== "object") continue;
    const rec = g as Record<string, unknown>;
    if (typeof rec["key"] !== "string" || typeof rec["label"] !== "string") continue;
    const count = typeof rec["count"] === "number" && rec["count"] > 0 ? Math.floor(rec["count"]) : 1;
    groups.push({
      key: rec["key"],
      label: rec["label"],
      count,
      aspectRatio: typeof rec["aspectRatio"] === "string" ? rec["aspectRatio"] : undefined,
      platform: typeof rec["platform"] === "string" ? rec["platform"] : undefined,
    });
  }
  return groups.length > 0 ? groups : null;
}

function normalizeEntitlement(
  batchType: ImageBatchType,
  raw: Record<string, unknown>,
  source: EntitlementSource,
): BatchEntitlement | null {
  const groups = normalizeGroups(raw["groups"]);
  if (!groups) return null;
  const totalItems = groups.reduce((sum, g) => sum + g.count, 0);
  return {
    batchType,
    groups,
    totalItems,
    zipRequired: raw["zipRequired"] !== false, // default true unless explicitly disabled
    source,
  };
}

/**
 * Resolve the real entitlement for a project + batch type. Falls back
 * gracefully through the priority chain described above; never throws.
 */
export async function resolveBatchEntitlement(
  project: Pick<CreativeProject, "sourceType" | "serviceRequestId">,
  batchType: ImageBatchType,
  catalogFallback: Omit<BatchEntitlement, "source">,
): Promise<BatchEntitlement> {
  const fallback: BatchEntitlement = { ...catalogFallback, source: "catalog_fallback" };

  if (project.sourceType !== "service_catalog" || !project.serviceRequestId) {
    return fallback;
  }

  const [request] = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, project.serviceRequestId));

  if (!request) return fallback;

  // 1. Pricing snapshot override — custom quotation deliverables negotiated at order time.
  const snapshot = (request.pricingSnapshotJson ?? {}) as Record<string, unknown>;
  const overrideRaw = snapshot["imageBatchEntitlement"];
  if (overrideRaw && typeof overrideRaw === "object") {
    const overrideRec = overrideRaw as Record<string, unknown>;
    if (overrideRec["batchType"] === batchType) {
      const normalized = normalizeEntitlement(batchType, overrideRec, "service_request_snapshot");
      if (normalized) return normalized;
    }
  }

  // 2. Package limits_json — structured entitlement configured on the purchased package.
  if (request.packageId) {
    const [pkg] = await db
      .select()
      .from(aiServicePackagesTable)
      .where(eq(aiServicePackagesTable.id, request.packageId));
    const limits = (pkg?.limitsJson ?? {}) as Record<string, unknown>;
    const batchLimits = limits[batchType];
    if (batchLimits && typeof batchLimits === "object") {
      const normalized = normalizeEntitlement(batchType, batchLimits as Record<string, unknown>, "package_limits");
      if (normalized) return normalized;
    }
  }

  // 3. Catalog fallback (legacy / no structured data available).
  return fallback;
}
