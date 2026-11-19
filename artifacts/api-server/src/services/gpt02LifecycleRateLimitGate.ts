/**
 * Server-side DEV-only, read-only rate-limit/circuit/worker-health review.
 * Missing or malformed evidence blocks recovery. This never schedules retries.
 */
export type RateLimitEvidence = {
  workerHealthy: boolean | null;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN" | "UNKNOWN";
  lastHttpStatus: number | null;
  lastResponseAt: string | null;
  retryAfter: string | null;
  now: string;
};

export function assessGpt02RateLimitGate(input: RateLimitEvidence) {
  const deny = (reason: string, retryAt: string | null = null) => ({
    clearForFurtherReview: false as const, reason, retryAt,
    mayDispatchWorker: false as const, mayCloseJob: false as const,
  });
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return deny("INVALID_TIME");
  if (input.workerHealthy !== true) return deny("WORKER_HEALTH_NOT_VERIFIED");
  if (input.circuitState !== "CLOSED") return deny("CIRCUIT_NOT_CLOSED");
  if (!Number.isInteger(input.lastHttpStatus) || input.lastHttpStatus! < 100 ||
      input.lastHttpStatus! > 599 || typeof input.lastResponseAt !== "string")
    return deny("RATE_LIMIT_HISTORY_NOT_VERIFIED");
  const observed = Date.parse(input.lastResponseAt);
  if (!Number.isFinite(observed) || observed > now) return deny("RATE_LIMIT_HISTORY_NOT_VERIFIED");
  if (input.lastHttpStatus === 429) {
    if (typeof input.retryAfter !== "string" || !input.retryAfter.trim())
      return deny("RETRY_AFTER_NOT_VERIFIED");
    // HTTP Retry-After is either delta-seconds or a valid HTTP date.
    const raw = input.retryAfter.trim();
    let retryAt: number;
    if (/^[0-9]+$/.test(raw)) {
      const seconds = Number(raw);
      if (!Number.isSafeInteger(seconds) || seconds > 86400)
        return deny("RETRY_AFTER_NOT_VERIFIED");
      retryAt = observed + seconds * 1000;
    } else {
      if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /.test(raw))
        return deny("RETRY_AFTER_NOT_VERIFIED");
      retryAt = Date.parse(raw);
      if (!Number.isFinite(retryAt)) return deny("RETRY_AFTER_NOT_VERIFIED");
    }
    if (now < retryAt) return deny("RETRY_AFTER_ACTIVE", new Date(retryAt).toISOString());
    // A past Retry-After alone does NOT clear an OPEN or HALF_OPEN circuit;
    // this function also requires a separately verified CLOSED state.
  }
  return {clearForFurtherReview: true as const, reason: "RATE_LIMIT_REVIEW_CLEAR",
    retryAt: null, mayDispatchWorker: false as const, mayCloseJob: false as const};
}
