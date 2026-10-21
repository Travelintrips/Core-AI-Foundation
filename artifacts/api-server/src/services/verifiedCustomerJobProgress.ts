import { resolveCustomerJob, type CustomerJob, type JobMatchResult } from "./customerJobResolver.js";

/**
 * Authenticate before calling. This adapter deliberately accepts only a trusted
 * server-side identity, not a body/header-supplied customer_id or company_id.
 * Both identifiers must have been verified against the same membership.
 */
export type VerifiedCustomerIdentity = Readonly<{
  principalId: string;
  customerId: string;
  companyId: string;
  verified: true;
}>;

export type TrustedCustomerScope = Readonly<{ customerId: string; companyId: string }>;

export async function resolveVerifiedCustomerJobProgress(input: {
  message: string;
  identity: VerifiedCustomerIdentity | null;
  // Repository implementation MUST apply the same company/customer predicates
  // in SQL, not rely only on the resolver's in-memory filtering.
  listJobsForCustomer: (scope: TrustedCustomerScope) => Promise<readonly CustomerJob[]>;
}): Promise<JobMatchResult> {
  const { identity, message, listJobsForCustomer } = input;
  if (!identity || identity.verified !== true || !identity.principalId?.trim()
      || !identity.customerId?.trim() || !identity.companyId?.trim()) {
    throw new Error("Verified customer session and tenant membership required");
  }
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("Message required");
  }
  const scope = Object.freeze({ customerId: identity.customerId, companyId: identity.companyId });
  const jobs = await listJobsForCustomer(scope);
  return resolveCustomerJob(message, jobs, scope);
}
