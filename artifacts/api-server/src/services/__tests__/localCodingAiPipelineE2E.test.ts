import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovedAiHandoffLease } from "../localCodingAiHandoffService.js";
import {
  CONSTRAINED_MODEL_CAPABILITIES,
  createConstrainedModelInvocationAdapter,
  type ConstrainedModelProvider,
} from "../localCodingAiModelAdapterService.js";
import { computeAiHandoffPackageHash } from "../localCodingAiProposalPolicyService.js";
import {
  invokeConstrainedAiProposal,
  validateAndApplyAiProposal,
} from "../localCodingAiExecutionGateService.js";
import { verifyChangedFilesStatically } from "../localCodingVerificationService.js";

const execFileAsync = promisify(execFile);
const cleanupPaths: string[] = [];

async function git(root: string, args: string[], trim = true): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return trim ? stdout.trim() : stdout;
}

async function createRepositoryFixture(
  initial = "export const value = 1;\n",
): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "coding-ai-e2e-"));
  cleanupPaths.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "AI E2E Test"]);
  await writeFile(join(root, "example.ts"), initial, "utf8");
  await git(root, ["add", "example.ts"]);
  await git(root, ["commit", "-m", "fixture"]);
  return { root, head: await git(root, ["rev-parse", "HEAD"]) };
}

function leaseFixture(head: string): ApprovedAiHandoffLease {
  const patchSha = createHash("sha256")
    .update("deterministic-local-patch-that-needs-ai", "utf8")
    .digest("hex");
  const pkg: ApprovedAiHandoffLease["package"] = {
    version: 1,
    task: {
      id: "11111111-1111-4111-8111-111111111111",
      projectName: "AI coding e2e",
      instruction: "Change the exported value from one to two.",
    },
    repository: {
      repository: "Travelintrips/Core-AI-Foundation",
      branch: "main",
      baseHeadSha: head,
    },
    reason: "Deterministic recovery exhausted.",
    allowedFiles: ["example.ts"],
    diagnostics: [{
      command: "pnpm typecheck",
      kind: "typescript",
      file: "example.ts",
      line: 1,
      column: 14,
      code: "TS2322",
      symbol: "value",
      message: "Bounded fixture diagnostic.",
    }],
    snippets: [{
      file: "example.ts",
      startLine: 1,
      endLine: 1,
      content: "export const value = 1;",
      reason: "diagnostic",
    }],
    symbols: [],
    dependencies: [],
    relatedTests: [],
    recentCommits: [],
    verificationCommands: ["pnpm typecheck"],
    currentPatch: {
      sha256: patchSha,
      excerpt: "diff --git a/example.ts b/example.ts",
      truncated: false,
    },
    policy: {
      readOnlyContext: true,
      repositoryAccess: false,
      networkAccess: false,
      shellAccess: false,
      secretAccess: false,
      sourceWrite: false,
      commitPushMerge: false,
      modelInvoked: false,
      requiresExplicitApprovalBeforeModel: true,
      allowedFilesOnly: true,
    },
  };

  return {
    package: pkg,
    packageHash: computeAiHandoffPackageHash(pkg),
    approvedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function proposalJson(
  lease: ApprovedAiHandoffLease,
  overrides: {
    file?: string;
    oldText?: string;
    newText?: string;
  } = {},
): string {
  return JSON.stringify({
    version: 1,
    taskId: lease.package.task.id,
    packageHash: lease.packageHash,
    baseHeadSha: lease.package.repository.baseHeadSha,
    currentPatchSha256: lease.package.currentPatch.sha256,
    allowedFiles: lease.package.allowedFiles,
    capabilities: {
      shellCommand: false,
      networkRequest: false,
      commit: false,
      push: false,
      merge: false,
      secretAccess: false,
      envAccess: false,
    },
    proposal: {
      summary: "Apply one bounded deterministic edit.",
      rationale: "The approved handoff contains the exact source line.",
      operations: [{
        type: "replace_text",
        file: overrides.file ?? "example.ts",
        oldText: overrides.oldText ?? "export const value = 1;",
        newText: overrides.newText ?? "export const value = 2;",
        expectedOccurrences: 1,
      }],
    },
  });
}

function fakeProvider(output: string): {
  provider: ConstrainedModelProvider;
  invoke: ReturnType<typeof vi.fn>;
} {
  const invoke = vi.fn(async () => ({
    output: { type: "text" as const, text: output },
    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
  }));
  return {
    invoke,
    provider: {
      provider: "fake",
      model: "proposal-v1",
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
      invoke,
    },
  };
}

async function runProposal(
  lease: ApprovedAiHandoffLease,
  output: string,
) {
  const fake = fakeProvider(output);
  const result = await invokeConstrainedAiProposal({
    lease,
    adapter: createConstrainedModelInvocationAdapter(fake.provider),
    target: { provider: "fake", model: "proposal-v1" },
    requestId: randomUUID(),
    timeoutMs: 5_000,
    maxOutputTokens: 512,
  });
  return { ...result, invoke: fake.invoke };
}

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (path) await rm(path, { recursive: true, force: true });
  }
});

describe("Full constrained AI coding pipeline E2E", () => {
  it("runs bounded model -> Contract V1 -> policy -> isolated patch -> clean review clone without committing", async () => {
    const executionRepo = await createRepositoryFixture();
    const lease = leaseFixture(executionRepo.head);

    const model = await runProposal(lease, proposalJson(lease));
    expect(model.invoke).toHaveBeenCalledTimes(1);
    expect(model.metadata.attempts).toBe(1);
    expect(model.metadata.fallbackUsed).toBe(false);
    expect(model.metadata.capabilities).toEqual(CONSTRAINED_MODEL_CAPABILITIES);

    const candidate = await validateAndApplyAiProposal({
      lease,
      proposal: model.proposal,
      repositoryRoot: executionRepo.root,
      currentRepositoryHeadSha: executionRepo.head,
    });

    expect(candidate.applyResult).toMatchObject({
      status: "APPLIED",
      changedFiles: ["example.ts"],
      scriptsExecuted: false,
      networkUsed: false,
      commitCreated: false,
      pushed: false,
      rolledBack: false,
    });
    expect(candidate.applyResult.patchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await git(executionRepo.root, ["rev-parse", "HEAD"])).toBe(
      executionRepo.head,
    );
    expect(await readFile(join(executionRepo.root, "example.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );

    const reviewRepo = await createRepositoryFixture();
    expect(reviewRepo.head).toBe(executionRepo.head);

    const patchPath = join(tmpdir(), `coding-ai-e2e-${randomUUID()}.diff`);
    cleanupPaths.push(patchPath);
    await writeFile(patchPath, candidate.applyResult.patch, "utf8");

    await git(reviewRepo.root, [
      "apply",
      "--check",
      "--whitespace=error-all",
      patchPath,
    ]);
    await git(reviewRepo.root, ["apply", "--whitespace=nowarn", patchPath]);

    expect(await verifyChangedFilesStatically(reviewRepo.root, ["example.ts"]))
      .toEqual([]);
    expect(await readFile(join(reviewRepo.root, "example.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await git(reviewRepo.root, ["rev-parse", "HEAD"])).toBe(reviewRepo.head);
    expect(await git(reviewRepo.root, ["diff", "--name-only", "--"])).toBe(
      "example.ts",
    );
  });

  it("fails closed on fenced or malformed model JSON before policy or patch application", async () => {
    const repo = await createRepositoryFixture();
    const lease = leaseFixture(repo.head);
    const fence = String.fromCharCode(96).repeat(3);

    await expect(
      runProposal(lease, `${fence}json\n${proposalJson(lease)}\n${fence}`),
    ).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });

    await expect(
      runProposal(lease, "{not-valid-json"),
    ).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });

    expect(await readFile(join(repo.root, "example.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await git(repo.root, ["status", "--porcelain=v1"])).toBe("");
  });

  it("fails closed when the proposal targets a file outside approved allowedFiles", async () => {
    const repo = await createRepositoryFixture();
    const lease = leaseFixture(repo.head);

    await expect(
      runProposal(
        lease,
        proposalJson(lease, { file: "not-approved.ts" }),
      ),
    ).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });

    expect(await git(repo.root, ["status", "--porcelain=v1"])).toBe("");
  });

  it("fails closed when repository HEAD changes after approval", async () => {
    const repo = await createRepositoryFixture();
    const lease = leaseFixture(repo.head);
    const model = await runProposal(lease, proposalJson(lease));

    await writeFile(
      join(repo.root, "example.ts"),
      "export const value = 1;\nexport const other = true;\n",
      "utf8",
    );
    await git(repo.root, ["add", "example.ts"]);
    await git(repo.root, ["commit", "-m", "concurrent change"]);
    const changedHead = await git(repo.root, ["rev-parse", "HEAD"]);
    expect(changedHead).not.toBe(lease.package.repository.baseHeadSha);

    await expect(
      validateAndApplyAiProposal({
        lease,
        proposal: model.proposal,
        repositoryRoot: repo.root,
        currentRepositoryHeadSha: changedHead,
      }),
    ).rejects.toMatchObject({ kind: "POLICY_REJECTED" });

    expect(await git(repo.root, ["rev-parse", "HEAD"])).toBe(changedHead);
  });

  it("rolls back and fails closed when exact source text drift makes the approved proposal stale", async () => {
    const repo = await createRepositoryFixture();
    const lease = leaseFixture(repo.head);
    const model = await runProposal(
      lease,
      proposalJson(lease, {
        oldText: "export const value = 999;",
        newText: "export const value = 2;",
      }),
    );

    await expect(
      validateAndApplyAiProposal({
        lease,
        proposal: model.proposal,
        repositoryRoot: repo.root,
        currentRepositoryHeadSha: repo.head,
      }),
    ).rejects.toMatchObject({ kind: "APPLY_FAILED" });

    expect(await readFile(join(repo.root, "example.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    expect(await git(repo.root, ["status", "--porcelain=v1"])).toBe("");
  });
});
