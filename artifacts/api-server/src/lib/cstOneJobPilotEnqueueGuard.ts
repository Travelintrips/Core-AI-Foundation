/**
 * Fail closed for the reserved Company-1 one-job pilot namespace.
 * General job enqueue must never turn a typed requestId into proof of Owner approval.
 * A future dedicated authenticated one-use approval transaction owns this namespace.
 */
export const CST_ONEJOB_RESERVED_REQUEST_PREFIX = "cst-ai-team-company1-dev:pilot-";
const PILOT_REQUEST_PREFIX = CST_ONEJOB_RESERVED_REQUEST_PREFIX;

export function isReservedOneJobPilotRequest(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const requestId = (payload as Record<string, unknown>)["requestId"];
  return typeof requestId === "string" && requestId.startsWith(PILOT_REQUEST_PREFIX);
}
