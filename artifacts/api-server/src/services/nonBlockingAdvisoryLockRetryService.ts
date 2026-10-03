export interface AdvisoryAttemptResult<T> {
  acquired: boolean;
  value?: T;
}

export interface AdvisoryRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function advisoryLockAcquired(
  result: unknown,
  defaultWhenMissing = false,
): boolean {
  if (!result || typeof result !== "object") return defaultWhenMissing;
  const rows = (result as { rows?: Array<{ acquired?: unknown }> }).rows;
  if (!Array.isArray(rows) || rows.length === 0) return defaultWhenMissing;
  return rows[0]?.acquired === true;
}

export async function withNonBlockingAdvisoryRetry<T>(
  operation: () => Promise<AdvisoryAttemptResult<T>>,
  options: AdvisoryRetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(20, options.attempts ?? 8));
  const baseDelayMs = Math.max(5, Math.min(1_000, options.baseDelayMs ?? 25));
  const maxDelayMs = Math.max(baseDelayMs, Math.min(5_000, options.maxDelayMs ?? 250));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await operation();
    if (result.acquired) return result.value as T;

    if (attempt < attempts) {
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(delayMs);
    }
  }

  throw new Error("Database advisory lock remained busy after bounded retry.");
}
