import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
  buildAiPatchApplierProposal,
  buildAiProposalBinding,
  buildAiProposalPolicyEnvelope,
  invokeConstrainedAiProposal,
  validateAndApplyAiProposal,
} from "../localCodingAiExecutionGateService.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout.trim();
}

async function repositoryFixture(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(join(tmpdir(), "ai-execution-gate-"));
  cleanup.push(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "AI Gate Test"]);
  await writeFile(join(root, "example.ts"), "export const value = 1;\n", "utf8");
  await git(root, ["add", "example.ts"]);
  await git(root, ["commit", "-m", "fixture"]);
  return { root, head: await git(root, ["rev-parse", "HEAD"]) };
}

function leaseFixture(head: string): ApprovedAiHandoffLease {
  const patchSha = createHash("sha256").update("failing-local-patch", "utf8").digest("hex");
  const pkg: ApprovedAiHandoffLease["package"] = {
    version: 1,
    task: {
      id: "11111111-1111-4111-8111-111111111111",
      projectName: "AI execution gate test",
      instruction: "Change the exported value from one to two.",
    },
    repository: {
      repository: "Travelintrips/Core-AI-Foundation",
      branch: "main",
      baseHeadSha: head,
    },
    reason: "Deterministic recovery exhausted.",
    allowedFiles: ["example.ts"],
    diagnostics: [],
    snippets: [{
      file: "example.ts",
      startLine: 1,
      endLine: 1,
      content: "export const value = 1;",
      reason: "focus",
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

function proposalJson(lease: ApprovedAiHandoffLease): string {
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
      summary: "Update the bounded constant.",
      rationale: "The bounded snippet shows the exact deterministic edit.",
      operations: [{
        type: "replace_text",
        file: "example.ts",
        oldText: "export const value = 1;",
        newText: "export const value = 2;",
        expectedOccurrences: 1,
      }],
    },
  });
}

afterEach(async () => {
  while (cleanup.length > 0) {
    const root = cleanup.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("Local Coding AI Execution Gate integration", () => {
  it("runs prompt -> constrained adapter -> Contract V1 -> policy -> deterministic patch without scripts", async () => {
    const { root, head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const invoke = vi.fn(async () => ({
      output: { type: "text" as const, text: proposalJson(lease) },
      usage: { inputTokens: 100, outputTokens: 80, totalTokens: 180 },
    }));
    const provider: ConstrainedModelProvider = {
      provider: "fake",
      model: "proposal-v1",
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
      invoke,
    };
    const adapter = createConstrainedModelInvocationAdapter(provider);

    const modelResult = await invokeConstrainedAiProposal({
      lease,
      adapter,
      target: { provider: "fake", model: "proposal-v1" },
      requestId: "execution-test-1",
      timeoutMs: 5_000,
      maxOutputTokens: 512,
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    const providerRequest = invoke.mock.calls[0]?.[0];
    expect(providerRequest?.capabilities).toEqual(CONSTRAINED_MODEL_CAPABILITIES);
    expect(providerRequest?.input).toContain(lease.packageHash);
    expect(modelResult.proposal.taskId).toBe(lease.package.task.id);

    const candidate = await validateAndApplyAiProposal({
      lease,
      proposal: modelResult.proposal,
      repositoryRoot: root,
      currentRepositoryHeadSha: head,
    });

    expect(candidate.applyResult.status).toBe("APPLIED");
    expect(candidate.applyResult.scriptsExecuted).toBe(false);
    expect(candidate.applyResult.networkUsed).toBe(false);
    expect(candidate.applyResult.commitCreated).toBe(false);
    expect(candidate.applyResult.pushed).toBe(false);
    expect(candidate.applyResult.patchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(root, "example.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    expect(await git(root, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("bridges Contract V1 operations into policy and patch applier formats deterministically", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const proposal = JSON.parse(proposalJson(lease));
    proposal.proposal.operations = [
      {
        type: "insert_before",
        file: "example.ts",
        anchor: "export const value = 1;",
        content: "// before\n",
        expectedOccurrences: 1,
      },
      {
        type: "insert_after",
        file: "example.ts",
        anchor: "export const value = 1;",
        content: "\n// after",
        expectedOccurrences: 1,
      },
    ];

    const binding = buildAiProposalBinding(lease);
    expect(binding.allowedFiles).toEqual(["example.ts"]);

    const policyEnvelope = buildAiProposalPolicyEnvelope(proposal, lease);
    expect(policyEnvelope).not.toHaveProperty("capabilities");
    expect(policyEnvelope.operations).toEqual([
      expect.objectContaining({ kind: "patch_file", path: "example.ts" }),
      expect.objectContaining({ kind: "patch_file", path: "example.ts" }),
    ]);

    expect(buildAiPatchApplierProposal(proposal)).toEqual({
      operations: [
        {
          kind: "replace_text",
          path: "example.ts",
          search: "export const value = 1;",
          replacement: "// before\nexport const value = 1;",
          expectedOccurrences: 1,
        },
        {
          kind: "replace_text",
          path: "example.ts",
          search: "export const value = 1;",
          replacement: "export const value = 1;\n// after",
          expectedOccurrences: 1,
        },
      ],
    });
  });

  it("fails closed when the model returns fenced JSON instead of raw Contract V1 JSON", async () => {
    const { head } = await repositoryFixture();
    const lease = leaseFixture(head);
    const fence = String.fromCharCode(96).repeat(3);
    const provider: ConstrainedModelProvider = {
      provider: "fake",
      model: "proposal-v1",
      capabilities: CONSTRAINED_MODEL_CAPABILITIES,
      async invoke() {
        return {
          output: {
            type: "text",
            text: fence + "json\n" + proposalJson(lease) + "\n" + fence,
          },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
    };

    await expect(
      invokeConstrainedAiProposal({
        lease,
        adapter: createConstrainedModelInvocationAdapter(provider),
        target: { provider: "fake", model: "proposal-v1" },
        requestId: "execution-test-invalid-json",
        timeoutMs: 5_000,
        maxOutputTokens: 512,
      }),
    ).rejects.toMatchObject({ kind: "INVALID_PROPOSAL" });
  });
});
