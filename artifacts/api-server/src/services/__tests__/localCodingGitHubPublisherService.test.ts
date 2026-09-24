import { describe, expect, it, vi } from "vitest";
import {
  buildCodingBranchName,
  GitHubPublisherError,
  parseGitHubRepository,
  publishVerifiedPatchToGitHub,
  type GitHubApiClient,
} from "../localCodingGitHubPublisherService.js";

const baseSha = "a".repeat(40);
const movedSha = "b".repeat(40);
const commitSha = "c".repeat(40);
const patchSha = "d".repeat(64);

function input() {
  return {
    repository: "Travelintrips/Core-AI-Foundation",
    baseBranch: "main",
    expectedBaseSha: baseSha,
    taskNumber: "CWS-TEST123",
    taskId: "11111111-1111-4111-8111-111111111111",
    projectName: "Fix deterministic matching",
    patchSha256: patchSha,
    files: [{
      path: "src/sample.ts",
      content: "export const value = 2;\n",
    }],
  };
}

describe("Local Coding GitHub publisher", () => {
  it("normalizes GitHub repository coordinates and deterministic task branches", () => {
    expect(parseGitHubRepository("Travelintrips/Core-AI-Foundation")).toEqual({
      owner: "Travelintrips",
      repo: "Core-AI-Foundation",
    });
    expect(parseGitHubRepository("https://github.com/Travelintrips/Core-AI-Foundation.git")).toEqual({
      owner: "Travelintrips",
      repo: "Core-AI-Foundation",
    });
    expect(buildCodingBranchName("CWS-TEST123", "11111111-1111-4111-8111-111111111111"))
      .toBe("ai-coding/cws-test123-11111111");
    expect(() => parseGitHubRepository("https://gitlab.com/owner/repo"))
      .toThrow(/github\.com/i);
  });

  it("creates blobs, a commit, a task branch, and a pull request without touching base branch", async () => {
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const client: GitHubApiClient = {
      request: vi.fn(async (method, path, body) => {
        calls.push({ method, path, body });
        if (method === "GET" && path.includes("/branches/")) {
          return { commit: { sha: baseSha } };
        }
        if (method === "GET" && path.includes("/git/commits/")) {
          return { tree: { sha: "tree-base" } };
        }
        if (method === "GET" && path.includes("/git/trees/tree-base")) {
          return {
            truncated: false,
            tree: [{ path: "src/sample.ts", mode: "100644", type: "blob" }],
          };
        }
        if (method === "POST" && path.endsWith("/git/blobs")) {
          return { sha: "blob-new" };
        }
        if (method === "POST" && path.endsWith("/git/trees")) {
          return { sha: "tree-new" };
        }
        if (method === "POST" && path.endsWith("/git/commits")) {
          return { sha: commitSha };
        }
        if (method === "POST" && path.endsWith("/git/refs")) {
          return { ref: "refs/heads/ai-coding/cws-test123-11111111" };
        }
        if (method === "POST" && path.endsWith("/pulls")) {
          return {
            number: 43,
            html_url: "https://github.com/Travelintrips/Core-AI-Foundation/pull/43",
          };
        }
        throw new Error("Unexpected GitHub call: " + method + " " + path);
      }) as GitHubApiClient["request"],
    };

    const result = await publishVerifiedPatchToGitHub(input(), client);

    expect(result).toMatchObject({
      baseSha,
      branch: "ai-coding/cws-test123-11111111",
      commitSha,
      pullRequestNumber: 43,
    });
    const refCall = calls.find((call) => call.method === "POST" && call.path.endsWith("/git/refs"));
    expect(refCall?.body).toEqual({
      ref: "refs/heads/ai-coding/cws-test123-11111111",
      sha: commitSha,
    });
    const prCall = calls.find((call) => call.method === "POST" && call.path.endsWith("/pulls"));
    expect(prCall?.body).toMatchObject({
      head: "ai-coding/cws-test123-11111111",
      base: "main",
    });
    expect(calls.some((call) => call.method === "PATCH" && call.path.includes("/branches/main"))).toBe(false);
  });

  it("fails before writing anything when the base branch is already stale", async () => {
    const calls: string[] = [];
    const client: GitHubApiClient = {
      request: vi.fn(async (method, path) => {
        calls.push(method + " " + path);
        return { commit: { sha: movedSha } };
      }) as GitHubApiClient["request"],
    };

    await expect(publishVerifiedPatchToGitHub(input(), client)).rejects.toMatchObject({
      kind: "STALE_HEAD",
    });
    expect(calls).toHaveLength(1);
  });

  it("rechecks base HEAD after constructing the commit and refuses branch creation if it moved", async () => {
    let branchReads = 0;
    const calls: Array<{ method: string; path: string }> = [];
    const client: GitHubApiClient = {
      request: vi.fn(async (method, path) => {
        calls.push({ method, path });
        if (method === "GET" && path.includes("/branches/")) {
          branchReads += 1;
          return { commit: { sha: branchReads === 1 ? baseSha : movedSha } };
        }
        if (method === "GET" && path.includes("/git/commits/")) {
          return { tree: { sha: "tree-base" } };
        }
        if (method === "GET" && path.includes("/git/trees/tree-base")) {
          return {
            truncated: false,
            tree: [{ path: "src/sample.ts", mode: "100644", type: "blob" }],
          };
        }
        if (method === "POST" && path.endsWith("/git/blobs")) return { sha: "blob-new" };
        if (method === "POST" && path.endsWith("/git/trees")) return { sha: "tree-new" };
        if (method === "POST" && path.endsWith("/git/commits")) return { sha: commitSha };
        throw new Error("Unexpected call");
      }) as GitHubApiClient["request"],
    };

    await expect(publishVerifiedPatchToGitHub(input(), client)).rejects.toMatchObject({
      kind: "STALE_HEAD",
    });
    expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/git/refs"))).toBe(false);
    expect(calls.some((call) => call.method === "POST" && call.path.endsWith("/pulls"))).toBe(false);
  });

  it("deletes the task branch when pull request creation fails", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const client: GitHubApiClient = {
      request: vi.fn(async (method, path) => {
        calls.push({ method, path });
        if (method === "GET" && path.includes("/branches/")) {
          return { commit: { sha: baseSha } };
        }
        if (method === "GET" && path.includes("/git/commits/")) {
          return { tree: { sha: "tree-base" } };
        }
        if (method === "GET" && path.includes("/git/trees/tree-base")) {
          return {
            truncated: false,
            tree: [{ path: "src/sample.ts", mode: "100755", type: "blob" }],
          };
        }
        if (method === "POST" && path.endsWith("/git/blobs")) return { sha: "blob-new" };
        if (method === "POST" && path.endsWith("/git/trees")) return { sha: "tree-new" };
        if (method === "POST" && path.endsWith("/git/commits")) return { sha: commitSha };
        if (method === "POST" && path.endsWith("/git/refs")) return {};
        if (method === "POST" && path.endsWith("/pulls")) {
          throw new GitHubPublisherError("PR rejected", "API_FAILED", 422);
        }
        if (method === "DELETE" && path.includes("/git/refs/heads/")) return {};
        throw new Error("Unexpected call");
      }) as GitHubApiClient["request"],
    };

    await expect(publishVerifiedPatchToGitHub(input(), client)).rejects.toThrow("PR rejected");
    expect(calls.some((call) =>
      call.method === "DELETE" &&
      call.path.includes("/git/refs/heads/ai-coding/cws-test123-11111111")
    )).toBe(true);
  });
});
