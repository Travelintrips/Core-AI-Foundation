import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { CustomerJob } from "./customerJobResolver.js";
import type { TrustedCustomerScope } from "./verifiedCustomerJobProgress.js";

/**
 * DB-side scope enforcement. IDs are supplied only by verified auth context.
 * This adapter is read-only and never fabricates progress/checkpoint values.
 */
export async function listScopedCustomerJobs(scope: TrustedCustomerScope): Promise<CustomerJob[]> {
  if (!/^\d+$/.test(scope.customerId) || !scope.companyId?.trim()) {
    throw new Error("Valid verified customer identity required");
  }
  const customerId = Number(scope.customerId);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error("Invalid verified customer ID");
  }
  const result = await db.execute(sql`
    SELECT id, company_id, customer_id, title, description, category, status, updated_at
    FROM ai_platform.ai_tasks
    WHERE company_id = ${scope.companyId} AND customer_id = ${customerId}
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 200
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    companyId: String(row.company_id),
    customerId: String(row.customer_id),
    title: String(row.title ?? ""),
    description: row.description == null ? null : String(row.description),
    category: row.category == null ? null : String(row.category),
    status: String(row.status ?? "unknown"),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
    progressPercent: null,
    checkpoint: null,
  }));
}
