export async function withCodingWorkspaceReadRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, options.attempts ?? 3));
  const delayMs = Math.max(0, Math.min(2_000, options.delayMs ?? 150));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Coding Workspace read failed"));
}
