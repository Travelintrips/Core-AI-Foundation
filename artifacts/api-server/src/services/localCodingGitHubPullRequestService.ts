import {
  GitHubPublisherError,
  parseGitHubRepository,
  type GitHubApiClient,
} from "./localCodingGitHubPublisherService.js";

const MAX_PR_FILES = 100;
const MAX_CHECK_RUNS = 100;

export interface PullRequestCheckSummary {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface PullRequestVerificationInput {
  repository: string;
  pullRequestNumber: number;
  baseBranch: string;
  expectedBaseSha: string;
  expectedHeadSha: string;
  expectedFiles: string[];
}

export interface PullRequestVerificationResult {
  status: "PASSED" | "PENDING" | "FAILED" | "STALE";
  reason: string;
  pullRequestNumber: number;
  pullRequestUrl: string | null;
  baseBranch: string;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  checks: PullRequestCheckSummary[];
  combinedStatus: string | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  draft: boolean;
}

export interface PullRequestMergeResult {
  merged: true;
  mergeCommitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string | null;
  sourceCommitSha: string;
  baseSha: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeSha(value: string): string {
  return value.trim().toLowerCase();
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function sameFiles(left: string[], right: string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function validateInput(input: PullRequestVerificationInput): void {
  if (!Number.isInteger(input.pullRequestNumber) || input.pullRequestNumber <= 0) {
    throw new GitHubPublisherError("Pull request number is invalid.", "API_FAILED");
  }
  if (!/^[0-9a-f]{40}$/i.test(input.expectedBaseSha)) {
    throw new GitHubPublisherError("Expected PR base SHA is invalid.", "STALE_HEAD");
  }
  if (!/^[0-9a-f]{40}$/i.test(input.expectedHeadSha)) {
    throw new GitHubPublisherError("Expected PR head SHA is invalid.", "INVALID_TREE");
  }
  if (
    input.expectedFiles.length === 0 ||
    input.expectedFiles.length > MAX_PR_FILES ||
    input.expectedFiles.some((file) => !file || file.startsWith("/") || file.includes(".."))
  ) {
    throw new GitHubPublisherError("Expected PR changed-file set is invalid.", "INVALID_TREE");
  }
}

function verificationResult(
  base: Omit<PullRequestVerificationResult, "status" | "reason">,
  status: PullRequestVerificationResult["status"],
  reason: string,
): PullRequestVerificationResult {
  return { ...base, status, reason };
}

export async function verifyPublishedPullRequest(
  input: PullRequestVerificationInput,
  client: GitHubApiClient,
): Promise<PullRequestVerificationResult> {
  validateInput(input);
  const { owner, repo } = parseGitHubRepository(input.repository);
  const repositoryPath = `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`;
  const expectedBaseSha = normalizeSha(input.expectedBaseSha);
  const expectedHeadSha = normalizeSha(input.expectedHeadSha);

  const branchPayload = asRecord(await client.request(
    "GET",
    `${repositoryPath}/branches/${encodeSegment(input.baseBranch)}`,
  ));
  const currentBaseSha = normalizeSha(stringValue(asRecord(branchPayload.commit).sha));
  if (!/^[0-9a-f]{40}$/.test(currentBaseSha)) {
    throw new GitHubPublisherError("GitHub response is missing the base branch SHA.", "API_FAILED");
  }

  const pr = asRecord(await client.request(
    "GET",
    `${repositoryPath}/pulls/${input.pullRequestNumber}`,
  ));
  const prHeadSha = normalizeSha(stringValue(asRecord(pr.head).sha));
  const prBase = asRecord(pr.base);
  const prBaseRef = stringValue(prBase.ref);
  const prBaseSha = normalizeSha(stringValue(prBase.sha));
  const state = stringValue(pr.state);
  const merged = pr.merged === true;
  const draft = pr.draft === true;
  const mergeable = booleanOrNull(pr.mergeable);
  const mergeableState = stringValue(pr.mergeable_state) || null;
  const pullRequestUrl = stringValue(pr.html_url) || null;

  const baseSnapshot = {
    pullRequestNumber: input.pullRequestNumber,
    pullRequestUrl,
    baseBranch: prBaseRef || input.baseBranch,
    baseSha: currentBaseSha,
    headSha: prHeadSha,
    changedFiles: [] as string[],
    checks: [] as PullRequestCheckSummary[],
    combinedStatus: null as string | null,
    mergeable,
    mergeableState,
    draft,
  };

  if (merged) {
    return verificationResult(baseSnapshot, "FAILED", "Pull request is already merged.");
  }
  if (state !== "open") {
    return verificationResult(baseSnapshot, "FAILED", `Pull request state is ${state || "unknown"}, not open.`);
  }
  if (draft) {
    return verificationResult(baseSnapshot, "PENDING", "Pull request is still a draft.");
  }
  if (prBaseRef !== input.baseBranch) {
    return verificationResult(baseSnapshot, "STALE", "Pull request base branch no longer matches the approved target branch.");
  }
  if (prHeadSha !== expectedHeadSha) {
    return verificationResult(baseSnapshot, "STALE", "Pull request head commit no longer matches the approved coding commit.");
  }
  if (
    currentBaseSha !== expectedBaseSha ||
    (prBaseSha && prBaseSha !== expectedBaseSha)
  ) {
    return verificationResult(baseSnapshot, "STALE", "Base branch moved after local coding verification; the task must be re-run before merge.");
  }

  const filesPayload = await client.request<unknown[]>(
    "GET",
    `${repositoryPath}/pulls/${input.pullRequestNumber}/files?per_page=${MAX_PR_FILES}`,
  );
  const files = Array.isArray(filesPayload) ? filesPayload : [];
  if (files.length >= MAX_PR_FILES) {
    return verificationResult(baseSnapshot, "FAILED", "Pull request file list reached the safety page limit.");
  }

  const changedFiles: string[] = [];
  for (const item of files) {
    const file = asRecord(item);
    const filename = stringValue(file.filename);
    const status = stringValue(file.status);
    if (!filename || status !== "modified") {
      return verificationResult(
        { ...baseSnapshot, changedFiles },
        "FAILED",
        "Pull request contains an unsupported added, deleted, renamed, or invalid file.",
      );
    }
    changedFiles.push(filename);
  }
  const withFiles = { ...baseSnapshot, changedFiles: [...new Set(changedFiles)].sort() };
  if (!sameFiles(withFiles.changedFiles, input.expectedFiles)) {
    return verificationResult(
      withFiles,
      "STALE",
      "Pull request files no longer match the approved deterministic change set.",
    );
  }

  const checksPayload = asRecord(await client.request(
    "GET",
    `${repositoryPath}/commits/${expectedHeadSha}/check-runs?per_page=${MAX_CHECK_RUNS}&filter=latest`,
  ));
  const totalCount = numberValue(checksPayload.total_count) ?? 0;
  const rawCheckRuns = Array.isArray(checksPayload.check_runs) ? checksPayload.check_runs : [];
  if (totalCount > rawCheckRuns.length || totalCount > MAX_CHECK_RUNS) {
    return verificationResult(withFiles, "FAILED", "GitHub check-run response was truncated; merge gate refuses incomplete CI evidence.");
  }

  const checks: PullRequestCheckSummary[] = rawCheckRuns.map((item) => {
    const check = asRecord(item);
    return {
      name: stringValue(check.name) || "unnamed-check",
      status: stringValue(check.status) || "unknown",
      conclusion: typeof check.conclusion === "string" ? check.conclusion : null,
    };
  });

  const statusPayload = asRecord(await client.request(
    "GET",
    `${repositoryPath}/commits/${expectedHeadSha}/status`,
  ));
  const rawStatuses = Array.isArray(statusPayload.statuses) ? statusPayload.statuses : [];
  const combinedStatus = rawStatuses.length > 0 ? stringValue(statusPayload.state) || "pending" : null;
  const withChecks = { ...withFiles, checks, combinedStatus };

  if (checks.length === 0 && rawStatuses.length === 0) {
    return verificationResult(
      withChecks,
      "PENDING",
      "No CI checks or commit statuses are available yet; merge remains fail-closed.",
    );
  }

  const pendingCheck = checks.find((check) => check.status !== "completed");
  if (pendingCheck || combinedStatus === "pending") {
    return verificationResult(withChecks, "PENDING", "GitHub CI checks are still running.");
  }

  const allowedConclusions = new Set(["success", "neutral", "skipped"]);
  const failedCheck = checks.find(
    (check) => !check.conclusion || !allowedConclusions.has(check.conclusion),
  );
  if (failedCheck || (combinedStatus && combinedStatus !== "success")) {
    return verificationResult(withChecks, "FAILED", "One or more GitHub CI checks did not pass.");
  }

  if (mergeable === null) {
    return verificationResult(withChecks, "PENDING", "GitHub has not finished computing pull request mergeability.");
  }
  if (mergeable === false || mergeableState === "dirty") {
    return verificationResult(withChecks, "FAILED", "Pull request is not cleanly mergeable.");
  }

  return verificationResult(
    withChecks,
    "PASSED",
    "Pull request head, base, changed files, and GitHub CI checks match the approved coding task.",
  );
}

export async function mergeVerifiedPullRequest(
  input: PullRequestVerificationInput,
  client: GitHubApiClient,
): Promise<PullRequestMergeResult> {
  const verification = await verifyPublishedPullRequest(input, client);
  if (verification.status !== "PASSED") {
    throw new GitHubPublisherError(
      `Pull request merge gate is not ready: ${verification.reason}`,
      verification.status === "STALE" ? "STALE_HEAD" : "API_FAILED",
    );
  }

  const { owner, repo } = parseGitHubRepository(input.repository);
  const repositoryPath = `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`;
  const payload = asRecord(await client.request(
    "PUT",
    `${repositoryPath}/pulls/${input.pullRequestNumber}/merge`,
    {
      sha: normalizeSha(input.expectedHeadSha),
      merge_method: "merge",
    },
  ));

  if (payload.merged !== true) {
    throw new GitHubPublisherError(
      stringValue(payload.message) || "GitHub did not merge the pull request.",
      "API_FAILED",
    );
  }
  const mergeCommitSha = normalizeSha(stringValue(payload.sha));
  if (!/^[0-9a-f]{40}$/.test(mergeCommitSha)) {
    throw new GitHubPublisherError("GitHub merge response is missing a valid merge commit SHA.", "API_FAILED");
  }

  return {
    merged: true,
    mergeCommitSha,
    pullRequestNumber: input.pullRequestNumber,
    pullRequestUrl: verification.pullRequestUrl,
    sourceCommitSha: normalizeSha(input.expectedHeadSha),
    baseSha: normalizeSha(input.expectedBaseSha),
  };
}
