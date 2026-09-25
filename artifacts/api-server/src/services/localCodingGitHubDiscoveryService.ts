import {
  createGitHubApiClient,
  GitHubPublisherError,
  parseGitHubRepository,
  type GitHubApiClient,
} from "./localCodingGitHubPublisherService.js";

const MAX_REPOSITORY_PAGES = 10;
const PER_PAGE = 100;
const MAX_BRANCHES = 200;

export interface CodingGitHubRepository {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  updatedAt: string | null;
}

export interface CodingGitHubBranch {
  name: string;
  protected: boolean;
  commitSha: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GitHubPublisherError(
      `GitHub response is missing ${label}`,
      "API_FAILED",
    );
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createConfiguredClient(): GitHubApiClient {
  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim() ?? "";
  return createGitHubApiClient(token);
}

function normalizeQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().slice(0, 200);
}

export async function listAccessibleCodingRepositories(
  options: {
    query?: string;
    client?: GitHubApiClient;
  } = {},
): Promise<CodingGitHubRepository[]> {
  const client = options.client ?? createConfiguredClient();
  const query = normalizeQuery(options.query);
  const collected: CodingGitHubRepository[] = [];

  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const payload = await client.request<unknown[]>(
      "GET",
      `/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    const rows = Array.isArray(payload) ? payload : [];

    for (const item of rows) {
      const repo = asRecord(item);
      const ownerRecord = asRecord(repo.owner);
      const fullName = requiredString(repo.full_name, "repository full_name");
      const owner =
        optionalString(ownerRecord.login) ?? fullName.split("/")[0] ?? "";
      const name =
        optionalString(repo.name) ?? fullName.split("/").slice(1).join("/");
      const defaultBranch = requiredString(
        repo.default_branch,
        `default branch for ${fullName}`,
      );
      const htmlUrl =
        optionalString(repo.html_url) ?? `https://github.com/${fullName}`;
      const updatedAt = optionalString(repo.updated_at);

      collected.push({
        fullName,
        owner,
        name,
        private: repo.private === true,
        defaultBranch,
        htmlUrl,
        updatedAt,
      });
    }

    if (rows.length < PER_PAGE) break;
  }

  const unique = Array.from(
    new Map(
      collected.map((item) => [item.fullName.toLowerCase(), item] as const),
    ).values(),
  );

  const filtered = query
    ? unique.filter((item) =>
        [item.fullName, item.owner, item.name].some((value) =>
          value.toLowerCase().includes(query),
        ),
      )
    : unique;

  return filtered.slice(0, 250);
}

export async function listCodingRepositoryBranches(
  repository: string,
  options: {
    query?: string;
    client?: GitHubApiClient;
  } = {},
): Promise<CodingGitHubBranch[]> {
  const client = options.client ?? createConfiguredClient();
  const query = normalizeQuery(options.query);
  const { owner, repo } = parseGitHubRepository(repository);
  const items: CodingGitHubBranch[] = [];

  for (let page = 1; page <= 2; page += 1) {
    const payload = await client.request<unknown[]>(
      "GET",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`,
    );
    const rows = Array.isArray(payload) ? payload : [];

    for (const item of rows) {
      const branch = asRecord(item);
      const commit = asRecord(branch.commit);
      const name = requiredString(branch.name, "branch name");
      const commitSha = requiredString(commit.sha, `commit SHA for ${name}`);
      items.push({
        name,
        protected: branch.protected === true,
        commitSha,
      });
    }

    if (rows.length < 100 || items.length >= MAX_BRANCHES) break;
  }

  const filtered = query
    ? items.filter((item) => item.name.toLowerCase().includes(query))
    : items;

  return filtered
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_BRANCHES);
}
