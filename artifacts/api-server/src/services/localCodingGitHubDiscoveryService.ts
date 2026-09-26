import {
  createGitHubApiClient,
  GitHubPublisherError,
  parseGitHubRepository,
  type GitHubApiClient,
} from "./localCodingGitHubPublisherService.js";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_REPOSITORY_PAGES = 10;
const PER_PAGE = 100;
const MAX_BRANCHES = 200;
const DEFAULT_PUBLIC_OWNERS = ["Travelintrips"];

export type CodingGitHubDiscoveryMode = "authenticated" | "public";

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

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

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

function normalizeQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().slice(0, 200);
}

export function getCodingGitHubDiscoveryMode(
  env: NodeJS.ProcessEnv = process.env,
): CodingGitHubDiscoveryMode {
  return env["AI_CODING_GITHUB_TOKEN"]?.trim()
    ? "authenticated"
    : "public";
}

export function getCodingGitHubPublicOwners(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = (env["AI_CODING_GITHUB_PUBLIC_OWNERS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9_.-]+$/.test(value));

  return configured.length > 0 ? [...new Set(configured)] : DEFAULT_PUBLIC_OWNERS;
}

function createPublicDiscoveryClient(
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): GitHubApiClient {
  return {
    async request<T>(
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      path: string,
    ): Promise<T> {
      if (method !== "GET" || !path.startsWith("/")) {
        throw new GitHubPublisherError(
          "Public GitHub discovery is read-only.",
          "API_FAILED",
        );
      }

      const response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "assistx-coding-repository-discovery",
        },
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
        const detail =
          typeof asRecord(payload).message === "string"
            ? String(asRecord(payload).message).slice(0, 500)
            : `GitHub API returned HTTP ${response.status}`;
        throw new GitHubPublisherError(
          detail,
          response.status === 403 ? "AUTH_REQUIRED" : "API_FAILED",
          response.status,
        );
      }

      return payload as T;
    },
  };
}

function resolveDiscoveryClient(
  env: NodeJS.ProcessEnv,
  client?: GitHubApiClient,
): {
  client: GitHubApiClient;
  mode: CodingGitHubDiscoveryMode;
} {
  if (client) {
    return { client, mode: "authenticated" };
  }

  const token = env["AI_CODING_GITHUB_TOKEN"]?.trim() ?? "";
  if (token) {
    return {
      client: createGitHubApiClient(token),
      mode: "authenticated",
    };
  }

  return {
    client: createPublicDiscoveryClient(),
    mode: "public",
  };
}

function pushRepository(
  collected: CodingGitHubRepository[],
  value: unknown,
): void {
  const repo = asRecord(value);
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

  collected.push({
    fullName,
    owner,
    name,
    private: repo.private === true,
    defaultBranch,
    htmlUrl:
      optionalString(repo.html_url) ?? `https://github.com/${fullName}`,
    updatedAt: optionalString(repo.updated_at),
  });
}

async function collectAuthenticatedRepositories(
  client: GitHubApiClient,
  collected: CodingGitHubRepository[],
): Promise<void> {
  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const payload = await client.request<unknown[]>(
      "GET",
      `/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`,
    );
    const rows = Array.isArray(payload) ? payload : [];
    rows.forEach((item) => pushRepository(collected, item));
    if (rows.length < PER_PAGE) break;
  }
}

async function collectPublicOwnerRepositories(
  client: GitHubApiClient,
  owner: string,
  collected: CodingGitHubRepository[],
): Promise<void> {
  const account = asRecord(
    await client.request("GET", `/users/${encodeURIComponent(owner)}`),
  );
  const isOrganization =
    typeof account.type === "string" &&
    account.type.toLowerCase() === "organization";

  for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
    const path = isOrganization
      ? `/orgs/${encodeURIComponent(owner)}/repos?type=public&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`
      : `/users/${encodeURIComponent(owner)}/repos?type=owner&sort=updated&direction=desc&per_page=${PER_PAGE}&page=${page}`;
    const payload = await client.request<unknown[]>("GET", path);
    const rows = Array.isArray(payload) ? payload : [];
    rows.forEach((item) => pushRepository(collected, item));
    if (rows.length < PER_PAGE) break;
  }
}

export async function listAccessibleCodingRepositories(
  options: {
    query?: string;
    client?: GitHubApiClient;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CodingGitHubRepository[]> {
  const env = options.env ?? process.env;
  const resolved = resolveDiscoveryClient(env, options.client);
  const query = normalizeQuery(options.query);
  const collected: CodingGitHubRepository[] = [];

  if (resolved.mode === "authenticated") {
    await collectAuthenticatedRepositories(resolved.client, collected);
  } else {
    for (const owner of getCodingGitHubPublicOwners(env)) {
      await collectPublicOwnerRepositories(
        resolved.client,
        owner,
        collected,
      );
    }
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


export async function getAccessibleCodingRepository(
  repository: string,
  options: {
    client?: GitHubApiClient;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CodingGitHubRepository> {
  const env = options.env ?? process.env;
  const resolved = resolveDiscoveryClient(env, options.client);
  const { owner, repo } = parseGitHubRepository(repository);

  if (
    resolved.mode === "public" &&
    !getCodingGitHubPublicOwners(env).some(
      (allowedOwner) => allowedOwner.toLowerCase() === owner.toLowerCase(),
    )
  ) {
    throw new GitHubPublisherError(
      "Private or external repository lookup requires AI_CODING_GITHUB_TOKEN.",
      "AUTH_REQUIRED",
      403,
    );
  }

  const payload = await resolved.client.request<unknown>(
    "GET",
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
  );

  const collected: CodingGitHubRepository[] = [];
  pushRepository(collected, payload);
  const match = collected[0];
  if (!match) {
    throw new GitHubPublisherError(
      `Repository ${repository} was not returned by GitHub.`,
      "API_FAILED",
      404,
    );
  }
  return match;
}

export async function listCodingRepositoryBranches(
  repository: string,
  options: {
    query?: string;
    client?: GitHubApiClient;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CodingGitHubBranch[]> {
  const env = options.env ?? process.env;
  const resolved = resolveDiscoveryClient(env, options.client);
  const query = normalizeQuery(options.query);
  const { owner, repo } = parseGitHubRepository(repository);

  if (
    resolved.mode === "public" &&
    !getCodingGitHubPublicOwners(env).some(
      (allowedOwner) => allowedOwner.toLowerCase() === owner.toLowerCase(),
    )
  ) {
    throw new GitHubPublisherError(
      "Private or external repository branch discovery requires AI_CODING_GITHUB_TOKEN.",
      "AUTH_REQUIRED",
      403,
    );
  }

  const items: CodingGitHubBranch[] = [];
  for (let page = 1; page <= 2; page += 1) {
    const payload = await resolved.client.request<unknown[]>(
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
