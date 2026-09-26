import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_PATCH_APPLIER_LIMITS, applyAiProposalPatch, type ApprovedAiPatchHandoffContext } from "../localCodingAiPatchApplierService.js";

const roots: string[] = [];
async function put(root: string, file: string, content: string) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), content, "utf8"); }
function git(root: string, args: string[]) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
async function workspace(extra: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "ai-patch-")); roots.push(root);
  await put(root, "src/sample.ts", 'export const oldName = 1;\nexport function sample() {\n  return oldName;\n}\nexport const label = "oldName";\n');
  await put(root, "package.json", '{"name":"fixture","config":{"enabled":false}}\n');
  for (const [file, content] of Object.entries(extra)) await put(root, file, content);
  execFileSync("git", ["init", "-b", "main"], { cwd: root }); execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root }); execFileSync("git", ["config", "user.name", "CI"], { cwd: root }); execFileSync("git", ["add", "."], { cwd: root }); execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  return root;
}
function context(root: string, allowedFiles: string[]): ApprovedAiPatchHandoffContext { return { isolatedWorkspace: true, expectedHeadSha: git(root, ["rev-parse", "HEAD"]), allowedFiles }; }
const replace = (path = "src/sample.ts") => ({ operations: [{ kind: "replace_text", path, search: "oldName = 1", replacement: "oldName = 2", expectedOccurrences: 1 }] });

describe("Local Coding AI Patch Applier", () => {
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it("applies exact edits, emits unified patch/SHA256, and never runs scripts, network, commit, or push", async () => {
    const root = await workspace(); const head = git(root, ["rev-parse", "HEAD"]);
    const out = await applyAiProposalPatch(root, replace(), context(root, ["src/sample.ts"]));
    expect(out.status).toBe("APPLIED"); expect(out.patch).toContain("diff --git a/src/sample.ts b/src/sample.ts"); expect(out.patch).toContain("oldName = 2");
    expect(out.patchSha256).toMatch(/^[0-9a-f]{64}$/); expect(out.resultSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out).toMatchObject({ scriptsExecuted: false, networkUsed: false, commitCreated: false, pushed: false, rolledBack: false });
    expect(git(root, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("creates a new authorized file without shell, network, commit, or push", async () => {
    const root = await workspace({ "docs/.keep": "" });
    const out = await applyAiProposalPatch(
      root,
      {
        operations: [
          {
            kind: "create_file",
            path: "docs/ollama-local-smoke-test-8b.md",
            content:
              "Created to verify the local Ollama coding worker, multi-worker dispatcher, and planner authority lease.\n",
          },
        ],
      },
      context(root, ["docs/ollama-local-smoke-test-8b.md"]),
    );

    expect(out.status).toBe("APPLIED");
    expect(out.changedFiles).toEqual(["docs/ollama-local-smoke-test-8b.md"]);
    expect(out.patch).toContain("new file mode 100644");
    expect(out.patch).toContain("+++ b/docs/ollama-local-smoke-test-8b.md");
    expect(await readFile(join(root, "docs/ollama-local-smoke-test-8b.md"), "utf8")).toContain(
      "local Ollama coding worker",
    );
    expect(out).toMatchObject({
      scriptsExecuted: false,
      networkUsed: false,
      commitCreated: false,
      pushed: false,
      rolledBack: false,
    });
  });

  it("normalizes create-file trailing newline before patch and result hashing", async () => {
    const root = await workspace({ "docs/.keep": "" });
    const out = await applyAiProposalPatch(
      root,
      {
        operations: [
          {
            kind: "create_file",
            path: "docs/no-newline.md",
            content: "deterministic content without terminal newline",
          },
        ],
      },
      context(root, ["docs/no-newline.md"]),
    );

    expect(out.status).toBe("APPLIED");
    expect(await readFile(join(root, "docs/no-newline.md"), "utf8")).toBe(
      "deterministic content without terminal newline\n",
    );
    expect(out.patch).toContain("+deterministic content without terminal newline");
    expect(out.patch.endsWith("\n")).toBe(true);

    const replay = await workspace({ "docs/.keep": "" });
    const patchFile = join(replay, "candidate.patch");
    await writeFile(patchFile, out.patch, "utf8");
    execFileSync("git", ["apply", patchFile], { cwd: replay });

    const replayContent = await readFile(join(replay, "docs/no-newline.md"));
    const replayDigest = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256")
        .update(
          `docs/no-newline.md\0${createHash("sha256").update(replayContent).digest("hex")}`,
        )
        .digest("hex"),
    );
    expect(replayDigest).toBe(out.resultSha256);
  });

  it("fails closed for disallowed, traversal, absolute, sensitive, shell, and hidden command fields", async () => {
    const root = await workspace();
    expect(await applyAiProposalPatch(root, replace(), context(root, ["package.json"]))).toMatchObject({ status: "BLOCKED", code: "FILE_NOT_ALLOWED" });
    for (const proposal of [
      replace("../escape.ts"), replace("/tmp/escape.ts"), replace(".env"),
      { operations: [{ kind: "shell", path: "src/sample.ts", command: "rm -rf /" }] },
      { operations: [{ ...replace().operations[0], command: "git push" }] },
    ]) expect((await applyAiProposalPatch(root, proposal, context(root, ["src/sample.ts"]))).status).toBe("BLOCKED");
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });

  it("blocks symlink files and symlinked parent directories", async () => {
    const root = await workspace(); const outside = await mkdtemp(join(tmpdir(), "ai-patch-outside-")); roots.push(outside); await put(outside, "x.ts", "export const value = 1;\n");
    await symlink(join(outside, "x.ts"), join(root, "linked.ts")); await symlink(outside, join(root, "linked-dir")); execFileSync("git", ["add", "linked.ts", "linked-dir"], { cwd: root }); execFileSync("git", ["commit", "-m", "links"], { cwd: root });
    for (const path of ["linked.ts", "linked-dir/x.ts"]) {
      const out = await applyAiProposalPatch(root, { operations: [{ kind: "replace_text", path, search: "value = 1", replacement: "value = 2", expectedOccurrences: 1 }] }, context(root, [path]));
      expect(out).toMatchObject({ status: "BLOCKED", code: "SYMLINK_BLOCKED" });
    }
  });

  it("requires exact occurrences and rolls back deterministic/static failures", async () => {
    const root = await workspace(); const original = await readFile(join(root, "src/sample.ts"), "utf8");
    const mismatch = await applyAiProposalPatch(root, { operations: [{ ...replace().operations[0], expectedOccurrences: 2 }] }, context(root, ["src/sample.ts"]));
    expect(mismatch).toMatchObject({ status: "BLOCKED", code: "EXACT_MATCH_FAILED", rolledBack: true }); expect(await readFile(join(root, "src/sample.ts"), "utf8")).toBe(original);
    const syntax = await applyAiProposalPatch(root, { operations: [{ kind: "replace_text", path: "src/sample.ts", search: "return oldName;", replacement: "return {", expectedOccurrences: 1 }] }, context(root, ["src/sample.ts"]));
    expect(syntax).toMatchObject({ status: "FAILED", code: "STATIC_VERIFICATION_FAILED", rolledBack: true }); expect(await readFile(join(root, "src/sample.ts"), "utf8")).toBe(original);
  });

  it("supports bounded JSON set and compiler-backed TypeScript identifier replacement", async () => {
    const root = await workspace();
    const json = await applyAiProposalPatch(root, { operations: [{ kind: "json_set", path: "package.json", keyPath: ["config", "enabled"], value: true }] }, context(root, ["package.json"]));
    expect(json.status).toBe("APPLIED"); expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).config.enabled).toBe(true);
    execFileSync("git", ["checkout", "--", "package.json"], { cwd: root });
    const rejected = await applyAiProposalPatch(root, { operations: [{ kind: "typescript_replace_identifier_at_position", path: "src/sample.ts", line: 3, column: 10, from: "oldName", to: "newName", diagnosticCode: "TS1005" }] }, context(root, ["src/sample.ts"]));
    expect(rejected).toMatchObject({ status: "BLOCKED", code: "INVALID_PROPOSAL" });
    const applied = await applyAiProposalPatch(root, { operations: [{ kind: "typescript_replace_identifier_at_position", path: "src/sample.ts", line: 3, column: 10, from: "oldName", to: "newName", diagnosticCode: "TS2552" }] }, context(root, ["src/sample.ts"]));
    expect(applied.status).toBe("APPLIED"); const next = await readFile(join(root, "src/sample.ts"), "utf8"); expect(next).toContain("return newName;"); expect(next).toContain('label = "oldName"');
  });

  it("enforces file count, file size, clean worktree, and stale HEAD", async () => {
    const many: Record<string, string> = {}; const ops: Array<Record<string, unknown>> = []; const allowed: string[] = [];
    for (let i = 0; i <= AI_PATCH_APPLIER_LIMITS.maxChangedFiles; i++) { const file = `many/${i}.txt`; many[file] = `old-${i}\n`; allowed.push(file); ops.push({ kind: "replace_text", path: file, search: `old-${i}`, replacement: `new-${i}`, expectedOccurrences: 1 }); }
    const root = await workspace({ ...many, "large.txt": "x".repeat(AI_PATCH_APPLIER_LIMITS.maxEditableFileBytes + 1) });
    expect(await applyAiProposalPatch(root, { operations: ops }, context(root, allowed))).toMatchObject({ status: "BLOCKED", code: "TOO_MANY_FILES" });
    expect(await applyAiProposalPatch(root, { operations: [{ kind: "replace_text", path: "large.txt", search: "x", replacement: "y", expectedOccurrences: 1 }] }, context(root, ["large.txt"]))).toMatchObject({ status: "BLOCKED", code: "FILE_TOO_LARGE" });
    const stale = { ...context(root, ["src/sample.ts"]), expectedHeadSha: "a".repeat(40) }; expect(await applyAiProposalPatch(root, replace(), stale)).toMatchObject({ status: "BLOCKED", code: "STALE_HEAD" });
    await writeFile(join(root, "src/sample.ts"), "dirty\n", "utf8"); expect(await applyAiProposalPatch(root, replace(), context(root, ["src/sample.ts"]))).toMatchObject({ status: "BLOCKED", code: "WORKTREE_NOT_CLEAN" });
  });

  it("rolls back when the unified patch exceeds the hard patch-size bound", async () => {
    const root = await workspace({ "big/a.txt": "A\n", "big/b.txt": "B\n", "big/c.txt": "C\n" }); const replacement = "x".repeat(55_000);
    const operations = ["a", "b", "c"].map((name) => ({ kind: "replace_text", path: `big/${name}.txt`, search: name.toUpperCase(), replacement, expectedOccurrences: 1 }));
    const out = await applyAiProposalPatch(root, { operations }, context(root, ["big/a.txt", "big/b.txt", "big/c.txt"]));
    expect(out).toMatchObject({ status: "BLOCKED", code: "PATCH_TOO_LARGE", rolledBack: true });
    for (const name of ["a", "b", "c"]) expect(await readFile(join(root, `big/${name}.txt`), "utf8")).toBe(`${name.toUpperCase()}\n`);
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });
});
