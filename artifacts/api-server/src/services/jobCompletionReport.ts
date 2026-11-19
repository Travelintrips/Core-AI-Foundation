/** Evidence-gated, deterministic AI Core job completion report.
 * Never infer E2E PASS from an executor-completed status alone.
 */
export type CheckStatus = "pass" | "fail" | "pending";
export type EvidenceCheck = { name: string; status: CheckStatus; evidenceUrl?: string | null; detail?: string };
export type JobReportInput = {
  jobId: string; commandId?: string | null; correlationId?: string | null;
  title: string; worker?: string | null; status: string;
  startedAt?: string | null; completedAt?: string | null;
  commit?: string | null; environment?: string | null;
  checks: EvidenceCheck[];
};
export function buildJobCompletionReport(job: JobReportInput) {
  if (!job.jobId || !job.title || !Array.isArray(job.checks)) throw new Error("Invalid job report input");
  const names = ["CI", "deployment", "production health", "E2E"];
  // Require one unambiguous independently checkable HTTPS evidence reference per gate.
  // Caller-supplied evidence is a candidate only; server-side provenance verification
  // must happen before an actual notification is authorized.
  const validEvidence = (url: string | null | undefined) => {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && Boolean(parsed.hostname) &&
        !["localhost", "127.0.0.1", "example.invalid"].includes(parsed.hostname);
    } catch { return false; }
  };
  const verified = names.every(name => {
    const matches = job.checks.filter(c => c.name.toLowerCase() === name.toLowerCase());
    return matches.length === 1 && matches[0]?.status === "pass" &&
      validEvidence(matches[0].evidenceUrl);
  });
  // URLs only establish plausible references, NEVER independent provenance.
  // No trusted server-side verifier has authorized these candidate checks yet.
  const trustedProvenanceVerified = false;
  const e2ePass = trustedProvenanceVerified && job.status.toLowerCase() === "completed" && verified &&
    job.checks.length > 0 && job.checks.every(c => c.status === "pass");
  const finalStatus = e2ePass ? "E2E_PASS" : job.status.toLowerCase() === "completed" ? "COMPLETED_UNVERIFIED" :
    job.status.toUpperCase();
  return {
    schemaVersion: 1, jobId: job.jobId, commandId: job.commandId ?? null,
    correlationId: job.correlationId ?? null, title: job.title,
    worker: job.worker ?? null, environment: job.environment ?? null, commit: job.commit ?? null,
    startedAt: job.startedAt ?? null, completedAt: job.completedAt ?? null,
    status: finalStatus, checks: job.checks,
    notificationAuthorized: false, // Only a separate trusted DB verifier can authorize sending.
    totals: { pass: job.checks.filter(c => c.status === "pass").length,
      fail: job.checks.filter(c => c.status === "fail").length,
      pending: job.checks.filter(c => c.status === "pending").length },
    whatsappDedupKey: [job.jobId, job.commandId ?? "none", finalStatus].join(":")
  };
}
