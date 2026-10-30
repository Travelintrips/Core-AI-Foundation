/** Server-side GitHub CI evidence gate.
 * Inputs from workers are selectors only; the GitHub API response supplies the facts.
 * This gate alone is insufficient to authorize completion or WhatsApp: deployment,
 * production health and E2E must also be independently verified.
 */
export interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  head_repository?: { full_name?: string } | null;
  status: string;
  conclusion: string | null;
  event: string;
  html_url: string;
}
export interface CiVerificationInput {
  repository: string;
  commitSha: string;
  workflowRunId: number;
  expectedWorkflowName: string;
  allowedEvents?: readonly string[];
}
export type CiVerificationResult = {
  verified: boolean;
  reason: string;
  evidenceUrl: string | null;
};
export async function verifyTrustedCiRun(
  input: CiVerificationInput,
  fetchRun: (repository: string, runId: number) => Promise<GitHubWorkflowRun>,
): Promise<CiVerificationResult> {
  const fail = (reason: string): CiVerificationResult =>
    ({ verified: false, reason, evidenceUrl: null });
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)) return fail("INVALID_REPOSITORY");
  if (!/^[0-9a-f]{40}$/i.test(input.commitSha)) return fail("INVALID_SHA");
  if (!input.expectedWorkflowName?.trim()) return fail("CI_WORKFLOW_IDENTITY_REQUIRED");
  if (!Number.isSafeInteger(input.workflowRunId) || input.workflowRunId <= 0) return fail("INVALID_RUN_ID");
  let run: GitHubWorkflowRun;
  try { run = await fetchRun(input.repository, input.workflowRunId); }
  catch { return fail("GITHUB_LOOKUP_FAILED"); }
  if (run.id !== input.workflowRunId) return fail("RUN_ID_MISMATCH");
  if (run.name !== input.expectedWorkflowName) return fail("WORKFLOW_NAME_MISMATCH");
  if (input.allowedEvents?.length && !input.allowedEvents.includes(run.event)) return fail("WORKFLOW_EVENT_MISMATCH");
  if (run.head_repository?.full_name !== input.repository) return fail("REPOSITORY_MISMATCH");
  if (run.head_sha?.toLowerCase() !== input.commitSha.toLowerCase()) return fail("COMMIT_MISMATCH");
  if (run.status !== "completed" || run.conclusion !== "success") return fail("CI_NOT_SUCCESSFUL");
  const expectedUrl = `https://github.com/${input.repository}/actions/runs/${input.workflowRunId}`;
  if (run.html_url !== expectedUrl) return fail("EVIDENCE_URL_MISMATCH");
  return { verified: true, reason: "GITHUB_CI_VERIFIED", evidenceUrl: expectedUrl };
}

/** Production adapter: read fresh workflow evidence through the existing
 * authenticated GitHub API client. No worker metadata is trusted as proof.
 */
export async function verifyTrustedCiRunFromGitHub(
  input: CiVerificationInput,
  token: string,
): Promise<CiVerificationResult> {
  if (!token.trim()) {
    return { verified: false, reason: "GITHUB_AUTH_MISSING", evidenceUrl: null };
  }
  const { createGitHubApiClient } = await import("./localCodingGitHubPublisherService.js");
  const client = createGitHubApiClient(token);
  return verifyTrustedCiRun(input, (repo, runId) =>
    client.request<GitHubWorkflowRun>("GET",
      `/repos/${repo.split("/").map(encodeURIComponent).join("/")}/actions/runs/${runId}`));
}
