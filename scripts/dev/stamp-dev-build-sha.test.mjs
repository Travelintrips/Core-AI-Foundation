import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const executable = fileURLToPath(new URL("./stamp-dev-build-sha.mjs", import.meta.url));
const oldSha = "c26921475bf947614dd27f8e3e94720931942877";
const approvedSha = "9fabedcd4c10644d589e880cb62f583561c89a1c";
function rehearsal(inputSha, initialMarker = oldSha) {
  const dir = mkdtempSync(join(tmpdir(), "cst-qa-sha-"));
  try {
    writeFileSync(join(dir, ".cst-build-sha"), `${initialMarker}\n`);
    const env = { ...process.env, GITHUB_SHA: inputSha };
    const result = spawnSync(process.execPath, [executable], { cwd: dir, env, encoding: "utf8", timeout: 4000 });
    assert.equal(result.status, 0, result.stderr);
    return { out: result.stdout.trim(), marker: existsSync(join(dir, ".cst-build-sha"))
      ? readFileSync(join(dir, ".cst-build-sha"), "utf8") : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("trusted full commit replaces stale Docker context marker", () => {
  const r = rehearsal(approvedSha);
  assert.equal(r.marker, `${approvedSha}\n`);
  assert.match(r.out, /CST_DEV_BUILD_SHA_STAMPED/);
});
test("upper-case 40-hex commit normalizes to lowercase", () => {
  assert.equal(rehearsal(approvedSha.toUpperCase()).marker, `${approvedSha}\n`);
});
test("missing or invalid commit erases the prior build marker", () => {
  for (const invalid of ["", "unknown", approvedSha.slice(0, 8), "0".repeat(40), "this-is-not-a-sha"]) {
    const r = rehearsal(invalid);
    assert.equal(r.marker, null);
    assert.match(r.out, /CST_DEV_BUILD_SHA_UNVERIFIED_MARKER_REMOVED/);
  }
});
test("DEV Dockerfile stamps source after COPY and before build, runtime inherits marker", () => {
  const docker = readFileSync(new URL("../../deploy/hostinger-dev/Dockerfile", import.meta.url), "utf8");
  const copy = docker.indexOf("COPY . .");
  const stamp = docker.indexOf("RUN node scripts/dev/stamp-dev-build-sha.mjs");
  const build = docker.indexOf("RUN pnpm run build");
  const runtimeCopy = docker.indexOf("COPY --from=build /workspace /app");
  assert.ok(copy >= 0 && stamp > copy && build > stamp && runtimeCopy > build);
  assert.match(docker, /ARG GITHUB_SHA=unknown/);
  assert.match(docker, /ENV GITHUB_SHA=\\$GITHUB_SHA/);
  const ignore = readFileSync(new URL("../../deploy/hostinger-dev/Dockerfile.dockerignore", import.meta.url), "utf8");
  assert.match(ignore, /^\\.cst-build-sha$/m);
});
