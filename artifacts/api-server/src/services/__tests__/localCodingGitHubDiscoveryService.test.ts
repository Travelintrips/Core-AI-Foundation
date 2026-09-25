import { describe, expect, it, vi } from "vitest";
import {
  listAccessibleCodingRepositories,
  listCodingRepositoryBranches,
} from "../localCodingGitHubDiscoveryService.js";
import type { GitHubApiClient } from "../localCodingGitHubPublisherService.js";

function clientWith(handler: GitHubApiClient["request"]): GitHubApiClient {
  return { request: handler };
}

describe("local coding GitHub discovery", () => {
  it("lists repositories visible to the configured GitHub identity and filters by search", async () => {
    const request = vi.fn(async (_method: string, path: string) => {
      expect(path).toContain("/user/repos?");
      return [
        {
          full_name: "Travelintrips/Core-AI-Foundation",
          name: "Core-AI-Foundation",
          private: true,
          default_branch: "main",
          html_url: "https://github.com/Travelintrips/Core-AI-Foundation",
          updated_at: "2026-09-25T00:00:00Z",
          owner: { login: "Travelintrips" },
        },
        {
          full_name: "Travelintrips/Tenant-POS",
          name: "Tenant-POS",
          private: true,
          default_branch: "main",
          html_url: "https://github.com/Travelintrips/Tenant-POS",
          updated_at: "2026-09-24T00:00:00Z",
          owner: { login: "Travelintrips" },
        },
      ];
    }) as unknown as GitHubApiClient["request"];

    const result = await listAccessibleCodingRepositories({
      query: "core-ai",
      client: clientWith(request),
    });

    expect(result).toEqual([
      {
        fullName: "Travelintrips/Core-AI-Foundation",
        owner: "Travelintrips",
        name: "Core-AI-Foundation",
        private: true,
        defaultBranch: "main",
        htmlUrl: "https://github.com/Travelintrips/Core-AI-Foundation",
        updatedAt: "2026-09-25T00:00:00Z",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("deduplicates repository pages by full name", async () => {
    let call = 0;
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      full_name:
        index === 0
          ? "Travelintrips/Core-AI-Foundation"
          : `Travelintrips/repo-${index}`,
      name: index === 0 ? "Core-AI-Foundation" : `repo-${index}`,
      private: false,
      default_branch: "main",
      owner: { login: "Travelintrips" },
    }));
    const request = vi.fn(async () => {
      call += 1;
      return call === 1
        ? firstPage
        : [
            {
              full_name: "travelintrips/core-ai-foundation",
              name: "core-ai-foundation",
              private: false,
              default_branch: "main",
              owner: { login: "travelintrips" },
            },
          ];
    }) as unknown as GitHubApiClient["request"];

    const result = await listAccessibleCodingRepositories({
      client: clientWith(request),
    });

    expect(result.filter((item) => item.fullName.toLowerCase() === "travelintrips/core-ai-foundation")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("lists branches for the selected repository", async () => {
    const request = vi.fn(async (_method: string, path: string) => {
      expect(path).toBe(
        "/repos/Travelintrips/Core-AI-Foundation/branches?per_page=100&page=1",
      );
      return [
        {
          name: "main",
          protected: true,
          commit: { sha: "a".repeat(40) },
        },
        {
          name: "feat/repository-picker",
          protected: false,
          commit: { sha: "b".repeat(40) },
        },
      ];
    }) as unknown as GitHubApiClient["request"];

    const result = await listCodingRepositoryBranches(
      "Travelintrips/Core-AI-Foundation",
      { query: "main", client: clientWith(request) },
    );

    expect(result).toEqual([
      {
        name: "main",
        protected: true,
        commitSha: "a".repeat(40),
      },
    ]);
  });
});
