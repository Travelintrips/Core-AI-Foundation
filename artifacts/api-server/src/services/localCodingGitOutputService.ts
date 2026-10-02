export function extractLocalCodingGitStdout(result: unknown): string {
  const raw =
    typeof result === "string" || Buffer.isBuffer(result)
      ? result
      : result instanceof Uint8Array
        ? result
        : (result as { stdout?: unknown } | null | undefined)?.stdout;

  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString("utf8");
  if (typeof raw === "string") return raw;

  throw new TypeError("Git command returned an unsupported stdout shape.");
}
