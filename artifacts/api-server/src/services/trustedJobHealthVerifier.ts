/** Read-only probe of an operator-configured release endpoint.
 * This is only a health signal, not independent deployment or E2E proof.
 * The caller must supply the URL from server configuration, never a worker.
 */
export interface HealthProbeInput {
  configuredReleaseUrl: string;
  expectedCommitSha: string;
}
export async function probeTrustedReleaseHealth(
  input: HealthProbeInput,
  fetchRelease: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
) {
  const failed = (reason: string) => ({ verified: false, reason, evidenceId: null as string | null });
  if (!/^[a-f0-9]{40}$/i.test(input.expectedCommitSha)) return failed("INVALID_SHA");
  let url: URL;
  try { url = new URL(input.configuredReleaseUrl); } catch { return failed("INVALID_URL"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      !url.hostname || !url.pathname.endsWith("/api/healthz")) return failed("INVALID_URL");
  try {
    const response = await fetchRelease(url.toString());
    if (!response.ok || response.status !== 200) return failed("HEALTH_HTTP_ERROR");
    const body = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return failed("INVALID_HEALTH_BODY");
    const record = body as Record<string, unknown>;
    if (record["status"] !== "ok" || record["commitSha"] !== input.expectedCommitSha) {
      return failed("HEALTH_COMMIT_MISMATCH");
    }
    return { verified: true, reason: "HEALTH_SHA_MATCHED", evidenceId: url.toString() };
  } catch { return failed("HEALTH_UNREACHABLE"); }
}
