import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runLocalVerificationLoop,
  verifyChangedFilesStatically,
} from "../localCodingVerificationService.js";

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "local-verification-test-"));
  workspaces.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  return root;
}

describe("Local Coding Verification", () => {
  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("statically validates changed TypeScript and JSON without executing repository scripts", async () => {
    const root = await workspace();
    await writeFile(join(root, "src", "ok.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(root, "package.json"), '{"name":"fixture"}\n', "utf8");

    const issues = await verifyChangedFilesStatically(root, ["src/ok.ts", "package.json"]);

    expect(issues).toEqual([]);
  });

  it("reports syntax errors, invalid JSON, and conflict markers with file context", async () => {
    const root = await workspace();
    await writeFile(join(root, "src", "broken.ts"), "export function broken( {\n", "utf8");
    await writeFile(join(root, "broken.json"), '{"name":}\n', "utf8");
    await writeFile(
      join(root, "src", "conflict.ts"),
      "<<<<<<< HEAD\nexport const a = 1;\n=======\nexport const a = 2;\n>>>>>>> other\n",
      "utf8",
    );

    const issues = await verifyChangedFilesStatically(
      root,
      ["src/broken.ts", "broken.json", "src/conflict.ts"],
    );

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: "src/broken.ts", kind: "syntax" }),
      expect.objectContaining({ file: "broken.json", kind: "json_parse" }),
      expect.objectContaining({ file: "src/conflict.ts", kind: "conflict_marker", line: 1 }),
    ]));
  });

  it("retries once after a registered deterministic JSON formatting fix", async () => {
    const root = await workspace();
    await writeFile(join(root, "package.json"), '{"name":"fixture","scripts":{"lint":"eslint ."}}', "utf8");
    let calls = 0;

    const result = await runLocalVerificationLoop(root, ["package.json"], {
      commands: ["pnpm lint"],
      trustedScripts: true,
      maxAttempts: 2,
      executor: async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error("formatting required"), {
            code: 1,
            stderr: "formatting required",
          });
        }
        return { stdout: "ok", stderr: "" };
      },
    });

    expect(result.status).toBe("PASSED");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.passed).toBe(false);
    expect(result.attempts[1]?.passed).toBe(true);
    expect(result.autoFixes).toEqual(["json_format:package.json"]);
    expect(result.commandResults.map((item) => item.status)).toEqual(["FAILED", "PASSED"]);
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(
      '{\n  "name": "fixture",\n  "scripts": {\n    "lint": "eslint ."\n  }\n}\n',
    );
  });

  it("does not run discovered scripts unless explicitly trusted", async () => {
    const root = await workspace();
    await writeFile(join(root, "src", "ok.ts"), "export const value = 1;\n", "utf8");
    let invoked = false;

    const result = await runLocalVerificationLoop(root, ["src/ok.ts"], {
      commands: ["pnpm test", "pnpm typecheck"],
      executor: async () => {
        invoked = true;
        return { stdout: "unexpected", stderr: "" };
      },
    });

    expect(result.status).toBe("PASSED");
    expect(result.scriptsExecuted).toBe(false);
    expect(result.scriptsSkipped).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/not explicitly trusted/i);
    expect(invoked).toBe(false);
  });

  it("fails closed for non-allowlisted commands even when script execution is trusted", async () => {
    const root = await workspace();
    await writeFile(join(root, "src", "ok.ts"), "export const value = 1;\n", "utf8");

    const result = await runLocalVerificationLoop(root, ["src/ok.ts"], {
      commands: ["pnpm exec bash -lc whoami"],
      trustedScripts: true,
      executor: async () => ({ stdout: "must not run", stderr: "" }),
    });

    expect(result.status).toBe("FAILED");
    expect(result.commandResults[0]?.status).toBe("BLOCKED");
    expect(result.attempts).toHaveLength(1);
  });
});
