import { describe, expect, it, vi } from "vitest";
import {
  mergeVerifiedPullRequest,
  verifyPublishedPullRequest,
} from "../localCodingGitHubPullRequestService.js";
import type { GitHubApiClient } from "../localCodingGitHubPublisherService.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function input() {
  return {
    repository: "Travelintrips/Core-AI-Foundation",
    pullRequestNumber: 77,
    baseBranch: "main",
    expectedBaseSha: baseSha,
    expectedHeadSha: headSha,
    expectedFiles: ["src/a.ts", "src/b.ts"],
  };
}

function passingClient(options: {
  baseSha?: string;
  headSha?: string;
  draft?: boolean;
  mergeable?: boolean | null;
  mergeableState?: string;
  checks?: Array<{ name: string; status: string; conclusion: string | null }>;
  statuses?: Array<Record<string, unknown>>;
  statusState?: string;
  files?: Array<{ filename: string; status: string }>;
} = {}): GitHubApiClient {
  return {
    request: vi.fn(async (method, path, body) => {
      if (method === "GET" && path.includes("/branches/")) {
        return { commit: { sha: options.baseSha ?? baseSha } };
      }
      if (method === "GET" && /\/pulls\/77$/.test(path)) {
        return {
          number: 77,
          state: "open",
          merged: false,
          draft: options.draft ?? false,
          mergeable: options.mergeable === undefined ? true : options.mergeable,
          mergeable_state: options.mergeableState ?? "clean",
          html_url: "https://github.com/Travelintrips/Core-AI-Foundation/pull/77",
          head: { sha: options.headSha ?? headSha },
          base: { ref: "main", sha: options.baseSha ?? baseSha },
        };
      }
      if (method === "GET" && path.includes("/pulls/77/files")) {
        return options.files ?? [
          { filename: "src/a.ts", status: "modified" },
          { filename: "src/b.ts", status: "modified" },
        ];
      }
      if (method === "GET" && path.includes("/check-runs")) {
        const checks = options.checks ?? [
          { name: "CI Verify", status: "completed", conclusion: "success" },
          { name: "PR Fast Verify", status: "completed", conclusion: "success" },
        ];
        return { total_count: checks.length, check_runs: checks };
      }
      if (method === "GET" && path.endsWith("/status")) {
        return {
          state: options.statusState ?? "success",
          statuses: options.statuses ?? [],
        };
      }
      if (method === "PUT" && path.endsWith("/pulls/77/merge")) {
        expect(body).toEqual({ sha: headSha, merge_method: "merge" });
        return { merged: true, sha: "c".repeat(40), message: "Pull Request successfully merged" };
      }
      throw new Error("Unexpected GitHub request: " + method + " " + path);
    }) as GitHubApiClient["request"],
  };
}

describe("Local Coding GitHub Pull Request verification", () => {
  it("passes only when PR identity, files, base and checks match the approved task", async () => {
    const client = passingClient();
    const result = await verifyPublishedPullRequest(input(), client);

    expect(result.status).toBe("PASSED");
    expect(result.changedFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(result.checks.map((check) => check.name)).toEqual([
      "CI Verify",
      "PR Fast Verify",
    ]);
  });

  it("fails closed when the base branch moved after coding verification", async () => {
    const client = passingClient({ baseSha: "d".repeat(40) });
    const result = await verifyPublishedPullRequest(input(), client);

    expect(result.status).toBe("STALE");
    expect(result.reason).toMatch(/Base branch moved/i);
  });

  it("rejects an altered PR head or changed-file set", async () => {
    const changedHead = await verifyPublishedPullRequest(
      input(),
      passingClient({ headSha: "e".repeat(40) }),
    );
    expect(changedHead.status).toBe("STALE");
    expect(changedHead.reason).toMatch(/head commit/i);

    const changedFiles = await verifyPublishedPullRequest(
      input(),
      passingClient({
        files: [
          { filename: "src/a.ts", status: "modified" },
          { filename: "src/other.ts", status: "modified" },
        ],
      }),
    );
    expect(changedFiles.status).toBe("STALE");
    expect(changedFiles.reason).toMatch(/files no longer match/i);
  });

  it("keeps merge fail-closed while checks are pending or absent", async () => {
    const pending = await verifyPublishedPullRequest(
      input(),
      passingClient({
        checks: [{ name: "CI Verify", status: "in_progress", conclusion: null }],
      }),
    );
    expect(pending.status).toBe("PENDING");

    const none = await verifyPublishedPullRequest(
      input(),
      passingClient({ checks: [], statuses: [] }),
    );
    expect(none.status).toBe("PENDING");
    expect(none.reason).toMatch(/No CI checks/i);
  });

  it("fails when a check run or commit status fails", async () => {
    const failedCheck = await verifyPublishedPullRequest(
      input(),
      passingClient({
        checks: [{ name: "CI Verify", status: "completed", conclusion: "failure" }],
      }),
    );
    expect(failedCheck.status).toBe("FAILED");

    const failedStatus = await verifyPublishedPullRequest(
      input(),
      passingClient({
        statuses: [{ context: "legacy-ci", state: "failure" }],
        statusState: "failure",
      }),
    );
    expect(failedStatus.status).toBe("FAILED");
  });

  it("treats draft or unresolved mergeability as pending", async () => {
    const draft = await verifyPublishedPullRequest(
      input(),
      passingClient({ draft: true }),
    );
    expect(draft.status).toBe("PENDING");

    const unknown = await verifyPublishedPullRequest(
      input(),
      passingClient({ mergeable: null }),
    );
    expect(unknown.status).toBe("PENDING");
  });

  it("re-verifies immediately before an explicit merge mutation", async () => {
    const client = passingClient();
    const result = await mergeVerifiedPullRequest(input(), client);

    expect(result).toMatchObject({
      merged: true,
      mergeCommitSha: "c".repeat(40),
      sourceCommitSha: headSha,
      baseSha,
    });
    expect(client.request).toHaveBeenCalledWith(
      "PUT",
      expect.stringContaining("/pulls/77/merge"),
      { sha: headSha, merge_method: "merge" },
    );
  });

  it("never sends a merge mutation when verification is stale", async () => {
    const client = passingClient({ baseSha: "f".repeat(40) });

    await expect(mergeVerifiedPullRequest(input(), client)).rejects.toMatchObject({
      kind: "STALE_HEAD",
    });
    expect((client.request as ReturnType<typeof vi.fn>).mock.calls.some(
      (call) => call[0] === "PUT",
    )).toBe(false);
  });
});
