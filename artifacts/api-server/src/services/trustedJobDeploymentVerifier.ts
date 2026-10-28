/** Local deployment attestation gate. Values must come from an authorized
 * runtime inspector, not worker claims or a supplied image tag.
 */
export interface RuntimeImageEvidence {
  imageId: string;
  labels: Record<string, string> | null;
  embeddedBuildSha?: string | null;
  running: boolean;
  healthy: boolean;
}
export async function verifyTrustedDeployment(
  expectedCommitSha: string,
  inspect: () => Promise<RuntimeImageEvidence>,
) {
  const reject = (reason: string) => ({
    verified: false, reason, commitSha: null as string | null,
    evidenceId: null as string | null,
  });
  if (!/^[0-9a-f]{40}$/i.test(expectedCommitSha)) return reject("INVALID_COMMIT");
  let runtime: RuntimeImageEvidence;
  try { runtime = await inspect(); }
  catch { return reject("INSPECTION_FAILED"); }
  if (!runtime.running || !runtime.healthy) return reject("RUNTIME_UNHEALTHY");
  if (!/^sha256:[0-9a-f]{64}$/i.test(runtime.imageId)) return reject("IMAGE_ID_MISSING");
  // The protected DEV deploy runner writes /app/.cst-build-sha and validates it
  // before swap. Read via a trusted container inspector, not worker metadata.
  const labeled = runtime.labels?.["org.opencontainers.image.revision"];
  const embedded = runtime.embeddedBuildSha;
  if (labeled && embedded && labeled.toLowerCase() !== embedded.toLowerCase()) return reject("REVISION_CONFLICT");
  const actual = labeled || embedded;
  if (!actual || !/^[0-9a-f]{40}$/i.test(actual)) return reject("IMAGE_REVISION_MISSING");
  if (actual.toLowerCase() !== expectedCommitSha.toLowerCase()) return reject("COMMIT_MISMATCH");
  return { verified: true, reason: "RUNTIME_REVISION_MATCHED",
    commitSha: actual, evidenceId: runtime.imageId };
}
