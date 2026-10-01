export function normalizeExecFileStdout(result: unknown): string {
  const raw =
    typeof result === "string" ||
    Buffer.isBuffer(result) ||
    result instanceof Uint8Array
      ? result
      : (result as { stdout?: unknown } | null | undefined)?.stdout;

  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString("utf8");
  return typeof raw === "string" ? raw : "";
}
