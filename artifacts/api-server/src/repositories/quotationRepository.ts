/**
 * repositories/quotationRepository.ts — WP-02 Quotation domain: FOUNDATION
 * ONLY. Per the WP-02 scope, this module does NOT migrate, cut over, or
 * dual-write anything in services/aiQuotationService.ts (the canonical
 * service-catalog flow, with its atomic CAS status transitions) or the
 * legacy `creative_project_quotations` flow. Both keep operating exactly as
 * they do today. This module exists so a future workpackage has an explicit,
 * reviewed read-access contract to build on — and so the two quotation
 * lineages stay visibly, deliberately separate instead of being merged.
 *
 * Two quotation lineages exist and MUST stay distinct (see
 * docs/blueprints and .agents/memory/dual-commercial-flow.md):
 *   - Canonical: `ai_quotations` (service-catalog flow). Has its own
 *     `tenantId` column (nullable — null means "default" tenant, matching
 *     the marketplace convention: see security/tenantResolution.ts).
 *   - Legacy: `creative_project_quotations` (one-quotation-per-project
 *     flow). Has NO tenantId column; it is scoped only by `projectId`,
 *     itself on a `creative_projects` row that also has no tenantId column
 *     yet. Do not invent a tenant filter for this table — that would be a
 *     schema-shape claim this repository has no authority to make. If a
 *     caller needs a tenant boundary here, it must join through the parent
 *     project the way the existing services already do, not through a
 *     column this repository fabricates.
 */
import { eq } from "drizzle-orm";
import { db, aiQuotationsTable, creativeProjectQuotationsTable, type AiQuotation, type CreativeProjectQuotation } from "@workspace/db";
import { requireTenantId } from "./tenantScope.js";
import { resolveExecutor, type RepositoryContext, type DbExecutor } from "./types.js";

/**
 * Canonical (ai_quotations) lookup by id, tenant-checked. Returns undefined
 * (not a thrown error) for both "not found" and "belongs to a different
 * tenant" — callers that need to distinguish those cases for audit/logging
 * purposes should query further; this keeps the default behavior
 * fail-closed without leaking existence of another tenant's row.
 *
 * A row with `tenantId: null` is treated as belonging to every tenant
 * context, matching the existing single-tenant "default" convention (see
 * tenantResolution.ts) — this is a read-only convenience, not a new access
 * rule, and must be revisited before real multi-tenancy ships.
 */
export async function getCanonicalQuotationById(ctx: RepositoryContext, id: number): Promise<AiQuotation | undefined> {
  const tenantId = requireTenantId(ctx);
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor.select().from(aiQuotationsTable).where(eq(aiQuotationsTable.id, id));
  if (!row) return undefined;
  if (row.tenantId !== null && row.tenantId !== tenantId) return undefined;
  return row;
}

/**
 * Legacy (creative_project_quotations) lookup by project id. No tenant
 * filtering — see module doc comment for why. This is a straight passthrough
 * so future callers have one named place to swap in a real tenant join once
 * creative_projects gains a tenantId column, instead of hand-rolling the
 * query again at each new call site.
 */
export async function getLegacyQuotationByProjectId(
  ctx: RepositoryContext,
  projectId: string,
): Promise<CreativeProjectQuotation | undefined> {
  const executor = resolveExecutor(ctx, db) as DbExecutor;
  const [row] = await executor.select().from(creativeProjectQuotationsTable).where(eq(creativeProjectQuotationsTable.projectId, projectId));
  return row;
}
