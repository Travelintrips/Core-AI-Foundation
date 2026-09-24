const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_PUBLISH_FILES = 40;
const MAX_TOTAL_CONTENT_BYTES = 1_500_000;

export class GitHubPublisherError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "INVALID_REPOSITORY"
      | "AUTH_REQUIRED"
      | "STALE_HEAD"
      | "INVALID_TREE"
      | "BRANCH_EXISTS"
      | "API_FAILED",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitHubPublisherError";
  }
}

export interface GitHubRepositoryCoordinates {
  owner: string;
  repo: string;
}

export interface GitHubPublishFile {
  path: string;
  content: string;
}

export interface PublishVerifiedPatchInput {
  repository: string;
  baseBranch: string;
  expectedBaseSha: string;
  taskNumber: string;
  taskId: string;
  projectName: string;
  patchSha256: string;
  files: GitHubPublishFile[];
  sandboxVerification?: {
    status: "PASSED";
    commands: string[];
    image: string | null;
  };
}

export interface GitHubPublishResult {
  repository: string;
  baseBranch: string;
  baseSha: string;
  branch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

export interface GitHubApiClient {
  request<T = Record<string, unknown>>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T>;
}

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

function requiredString(
  value: unknown,
  description: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GitHubPublisherError(
      `GitHub response is missing ${description}`,
      "API_FAILED",
    );
  }
  return value.trim();
}

function requiredNumber(
  value: unknown,
  description: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GitHubPublisherError(
      `GitHub response is missing ${description}`,
      "API_FAILED",
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function refPath(branch: string): string {
  return branch
    .split("/")
    .map(encodeSegment)
    .join("/");
}

export function parseGitHubRepository(repository: string): GitHubRepositoryCoordinates {
  const trimmed = repository.trim();
  let owner = "";
  let repo = "";

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    [owner, repo] = trimmed.split("/");
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new GitHubPublisherError(
        "Commit approval requires a GitHub owner/repository or HTTPS github.com URL.",
        "INVALID_REPOSITORY",
      );
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.username ||
      parsed.password
    ) {
      throw new GitHubPublisherError(
        "Commit approval only publishes to HTTPS github.com repositories without embedded credentials.",
        "INVALID_REPOSITORY",
      );
    }
    const parts = parsed.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .split("/");
    if (parts.length !== 2) {
      throw new GitHubPublisherError(
        "GitHub repository URL must identify exactly one owner/repository.",
        "INVALID_REPOSITORY",
      );
    }
    [owner, repo] = parts;
  }

  if (
    !/^[A-Za-z0-9_.-]+$/.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/.test(repo)
  ) {
    throw new GitHubPublisherError(
      "GitHub owner or repository contains unsupported characters.",
      "INVALID_REPOSITORY",
    );
  }

  return { owner, repo };
}

export function buildCodingBranchName(taskNumber: string, taskId: string): string {
  const slug = taskNumber
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .replace(/\.\.+/g, ".")
    .slice(0, 48) || "task";
  const id = taskId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "00000000";
  return `ai-coding/${slug}-${id}`;
}

export function createGitHubApiClient(
  token: string,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): GitHubApiClient {
  const cleanToken = token.trim();
  if (!cleanToken) {
    throw new GitHubPublisherError(
      "AI_CODING_GITHUB_TOKEN is not configured.",
      "AUTH_REQUIRED",
    );
  }

  return {
    async request<T>(
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      path: string,
      body?: Record<string, unknown>,
    ): Promise<T> {
      if (!path.startsWith("/")) {
        throw new GitHubPublisherError("GitHub API path is invalid.", "API_FAILED");
      }
      const response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${cleanToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "assistx-local-coding-commit-gate",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const raw = await response.text();
      let payload: unknown = {};
      if (raw.trim()) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = { message: raw.slice(0, 500) };
        }
      }
      if (!response.ok) {
        const record = asRecord(payload);
        const detail =
          typeof record.message === "string"
            ? record.message.slice(0, 500)
            : `GitHub API returned HTTP ${response.status}`;
        const kind =
          response.status === 401 || response.status === 403
            ? "AUTH_REQUIRED"
            : response.status === 422 && /reference already exists/i.test(detail)
              ? "BRANCH_EXISTS"
              : "API_FAILED";
        throw new GitHubPublisherError(detail, kind, response.status);
      }
      return payload as T;
    },
  };
}

async function readBranchSha(
  client: GitHubApiClient,
  owner: string,
  repo: string,
  branch: string,
): Promise<string> {
  const payload = asRecord(await client.request(
    "GET",
    `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/branches/${encodeSegment(branch)}`,
  ));
  return requiredString(asRecord(payload.commit).sha, "branch commit SHA").toLowerCase();
}

function validateInput(input: PublishVerifiedPatchInput): void {
  if (!/^[0-9a-f]{40}$/i.test(input.expectedBaseSha)) {
    throw new GitHubPublisherError("Expected base SHA is invalid.", "STALE_HEAD");
  }
  if (!/^[0-9a-f]{64}$/i.test(input.patchSha256)) {
    throw new GitHubPublisherError("Approved patch digest is invalid.", "INVALID_TREE");
  }
  if (input.files.length === 0 || input.files.length > MAX_PUBLISH_FILES) {
    throw new GitHubPublisherError(
      `Commit gate requires 1-${MAX_PUBLISH_FILES} changed files.`,
      "INVALID_TREE",
    );
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  for (const file of input.files) {
    if (!file.path || file.path.startsWith("/") || file.path.includes("..")) {
      throw new GitHubPublisherError(`Unsafe publish path: ${file.path}`, "INVALID_TREE");
    }
    if (seen.has(file.path)) {
      throw new GitHubPublisherError(`Duplicate publish path: ${file.path}`, "INVALID_TREE");
    }
    seen.add(file.path);
    totalBytes += Buffer.byteLength(file.content, "utf8");
  }
  if (totalBytes > MAX_TOTAL_CONTENT_BYTES) {
    throw new GitHubPublisherError(
      `Changed file content exceeds ${MAX_TOTAL_CONTENT_BYTES} bytes.`,
      "INVALID_TREE",
    );
  }
}

export async function publishVerifiedPatchToGitHub(
  input: PublishVerifiedPatchInput,
  client: GitHubApiClient,
): Promise<GitHubPublishResult> {
  validateInput(input);
  const { owner, repo } = parseGitHubRepository(input.repository);
  const repositoryPath = `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`;
  const expectedBaseSha = input.expectedBaseSha.toLowerCase();
  const currentBaseSha = await readBranchSha(
    client,
    owner,
    repo,
    input.baseBranch,
  );
  if (currentBaseSha !== expectedBaseSha) {
    throw new GitHubPublisherError(
      `Base branch moved from ${expectedBaseSha} to ${currentBaseSha}; rerun Local Coding Engine before commit approval.`,
      "STALE_HEAD",
    );
  }

  const baseCommit = asRecord(await client.request(
    "GET",
    `${repositoryPath}/git/commits/${expectedBaseSha}`,
  ));
  const baseTreeSha = requiredString(asRecord(baseCommit.tree).sha, "base tree SHA");

  const treePayload = asRecord(await client.request(
    "GET",
    `${repositoryPath}/git/trees/${baseTreeSha}?recursive=1`,
  ));
  if (treePayload.truncated === true) {
    throw new GitHubPublisherError(
      "GitHub base tree response was truncated; commit gate refuses to guess file modes.",
      "INVALID_TREE",
    );
  }
  const baseEntries = new Map<string, { mode: string; type: string }>();
  if (Array.isArray(treePayload.tree)) {
    for (const item of treePayload.tree) {
      const entry = asRecord(item);
      const path = typeof entry.path === "string" ? entry.path : "";
      const mode = typeof entry.mode === "string" ? entry.mode : "";
      const type = typeof entry.type === "string" ? entry.type : "";
      if (path) baseEntries.set(path, { mode, type });
    }
  }

  const treeEntries: Array<Record<string, unknown>> = [];
  for (const file of input.files) {
    const baseEntry = baseEntries.get(file.path);
    if (
      !baseEntry ||
      baseEntry.type !== "blob" ||
      !["100644", "100755"].includes(baseEntry.mode)
    ) {
      throw new GitHubPublisherError(
        `Commit gate could not preserve the base file mode for ${file.path}.`,
        "INVALID_TREE",
      );
    }
    const blob = asRecord(await client.request(
      "POST",
      `${repositoryPath}/git/blobs`,
      {
        content: file.content,
        encoding: "utf-8",
      },
    ));
    treeEntries.push({
      path: file.path,
      mode: baseEntry.mode,
      type: "blob",
      sha: requiredString(blob.sha, `blob SHA for ${file.path}`),
    });
  }

  const createdTree = asRecord(await client.request(
    "POST",
    `${repositoryPath}/git/trees`,
    {
      base_tree: baseTreeSha,
      tree: treeEntries,
    },
  ));
  const createdTreeSha = requiredString(createdTree.sha, "created tree SHA");

  const project = input.projectName.replace(/\s+/g, " ").trim().slice(0, 60) || "local patch";
  const commitMessage = `coding(${input.taskNumber}): ${project}`;
  const createdCommit = asRecord(await client.request(
    "POST",
    `${repositoryPath}/git/commits`,
    {
      message: commitMessage,
      tree: createdTreeSha,
      parents: [expectedBaseSha],
    },
  ));
  const commitSha = requiredString(createdCommit.sha, "created commit SHA").toLowerCase();

  const finalBaseSha = await readBranchSha(
    client,
    owner,
    repo,
    input.baseBranch,
  );
  if (finalBaseSha !== expectedBaseSha) {
    throw new GitHubPublisherError(
      `Base branch moved from ${expectedBaseSha} to ${finalBaseSha} while the commit was being prepared.`,
      "STALE_HEAD",
    );
  }

  const branch = buildCodingBranchName(input.taskNumber, input.taskId);
  let refCreated = false;
  try {
    await client.request(
      "POST",
      `${repositoryPath}/git/refs`,
      {
        ref: `refs/heads/${branch}`,
        sha: commitSha,
      },
    );
    refCreated = true;

    const prTitle = `[${input.taskNumber}] ${project}`;
    const pullRequest = asRecord(await client.request(
      "POST",
      `${repositoryPath}/pulls`,
      {
        title: prTitle,
        head: branch,
        base: input.baseBranch,
        body: [
          "Deterministic Local Coding Engine patch.",
          "",
          `Task: ${input.taskNumber}`,
          `Base SHA: ${expectedBaseSha}`,
          `Patch SHA-256: ${input.patchSha256.toLowerCase()}`,
          "Static verification: PASSED",
          input.sandboxVerification?.status === "PASSED"
            ? "Sandbox verification: PASSED"
            : "Sandbox verification: NOT RECORDED",
          ...(input.sandboxVerification?.status === "PASSED"
            ? [
                "Sandbox network: DISABLED",
                "Sandbox image: " + (input.sandboxVerification.image ?? "configured runtime"),
                "Repository commands: " +
                  (input.sandboxVerification.commands.length > 0
                    ? input.sandboxVerification.commands.join(", ")
                    : "none discovered"),
              ]
            : []),
          "",
          "This pull request was created by an explicit commit approval gate. It is not auto-merged.",
        ].join("\n"),
      },
    ));

    return {
      repository: `${owner}/${repo}`,
      baseBranch: input.baseBranch,
      baseSha: expectedBaseSha,
      branch,
      commitSha,
      pullRequestNumber: requiredNumber(pullRequest.number, "pull request number"),
      pullRequestUrl: requiredString(pullRequest.html_url, "pull request URL"),
    };
  } catch (error) {
    if (refCreated) {
      await client.request(
        "DELETE",
        `${repositoryPath}/git/refs/heads/${refPath(branch)}`,
      ).catch(() => undefined);
    }
    throw error;
  }
}

export async function rollbackPublishedPullRequest(
  result: GitHubPublishResult,
  client: GitHubApiClient,
): Promise<void> {
  const { owner, repo } = parseGitHubRepository(result.repository);
  const repositoryPath = `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`;
  await client.request(
    "PATCH",
    `${repositoryPath}/pulls/${result.pullRequestNumber}`,
    { state: "closed" },
  ).catch(() => undefined);
  await client.request(
    "DELETE",
    `${repositoryPath}/git/refs/heads/${refPath(result.branch)}`,
  ).catch(() => undefined);
}
