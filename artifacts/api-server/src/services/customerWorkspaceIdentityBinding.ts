import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { resolveWorkspaceSession } from "./customerWorkspaceService.js";
import type { VerifiedCustomerIdentity } from "./verifiedCustomerJobProgress.js";

/**
 * Resolve an existing, expiring Customer Workspace dashboard-token session to a
 * canonical company/customer membership. Fail closed on duplicate or missing
 * customers: matching email alone does not authorize choosing one tenant.
 * Token and email must never be taken as company/customer IDs.
 */
export async function resolveVerifiedCustomerIdentityFromWorkspaceToken(
  token: string,
): Promise<VerifiedCustomerIdentity | null> {
  if (!token || token.length > 1024) return null;
  const session = await resolveWorkspaceSession(token);
  if (!session.ok) return null;
  const email = session.session.clientEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  const matches = await db.execute(sql`
    SELECT c.id AS customer_id, c.company_id AS company_id
    FROM public.customers c
    INNER JOIN public.companies co ON co.id = c.company_id
    WHERE lower(trim(c.email)) = ${email}
      AND c.company_id IS NOT NULL
      AND co.is_active IS TRUE
    LIMIT 2
  `);
  // Never arbitrarily select a tenant if an email is shared across tenants.
  if (matches.rows.length !== 1) return null;
  const row = matches.rows[0];
  const customerId = Number(row.customer_id);
  const companyId = Number(row.company_id);
  if (!Number.isSafeInteger(customerId) || customerId <= 0 ||
      !Number.isSafeInteger(companyId) || companyId <= 0) return null;
  return {
    principalId: session.session.emailHash,
    customerId: String(customerId),
    companyId: String(companyId),
    verified: true,
  };
}
