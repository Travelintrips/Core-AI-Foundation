#!/usr/bin/env node
// Source-feature evidence only. Does not invoke OpenClaw, run a gateway, or
// grant GPT02 dispatch. Upstream tests execute separately on disposable CI.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [stableDir, betaDir] = process.argv.slice(2);
assert.ok(stableDir && betaDir, "PASS_STABLE_AND_BETA_CHECKOUT_DIRECTORIES");
const stableCommit = "847611dcaa3bf0e2783335f961dd1fd0580e4d9f";
const betaCommit = "c0f42f648144b25b8945b9c56329eb13eb6d7754";
const head = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
  encoding: "utf8", timeout: 10000,
}).trim();
assert.equal(head(stableDir), stableCommit, "STABLE_CHECKOUT_SHA_MISMATCH");
assert.equal(head(betaDir), betaCommit, "BETA_CHECKOUT_SHA_MISMATCH");

function source(dir, path) {
  const p = join(dir, path);
  assert.ok(existsSync(p), "MISSING_UPSTREAM_SOURCE_" + path);
  return readFileSync(p, "utf8");
}
function feature(dir, path, marker, label) {
  assert.ok(source(dir, path).includes(marker), label);
}
const stablePackage = JSON.parse(source(stableDir, "package.json"));
const betaPackage = JSON.parse(source(betaDir, "package.json"));
assert.equal(stablePackage.version, "2026.11.3");
assert.equal(betaPackage.version, "2026.11.5-beta.2");

const lockFile = "src/infra/gateway-lock-payload.ts";
const pluginFile = "src/plugins/plugin-cache.ts";
const loopFile = "src/cli/gateway-cli/run-loop.ts";
const cleanupFile = "src/cli/gateway-cli/run-loop-cleanup.ts";
for (const dir of [stableDir, betaDir]) {
  feature(dir, lockFile,
    "Windows boot observations can disagree within one boot.",
    "WINDOWS_LIVE_OWNER_IDENTITY_GUARD_ABSENT");
  feature(dir, pluginFile, "resource.dispose(undefined, options)",
    "PLUGIN_RETIREMENT_DISPOSAL_OPTIONS_ABSENT");
}
feature(stableDir, loopFile, "if (!forcedExitStarted) {",
  "EXPECTED_STABLE_BASELINE_GUARD_ABSENT");
assert.ok(
  !source(stableDir, loopFile).includes("cleanup.canClearRequestWatchdogs()"),
  "STABLE_BASELINE_UNEXPECTEDLY_HAS_BETA_GUARD_REVIEW_REQUIRED",
);
feature(betaDir, loopFile,
  "if (!forcedExitStarted && cleanup.canClearRequestWatchdogs()) {",
  "BETA_FAILED_SHUTDOWN_WATCHDOG_GUARD_ABSENT");
feature(betaDir, cleanupFile,
  "!resourcesRetained && (!ownsProcessLifecycle || !cleanupFailed)",
  "BETA_RETAINED_RESOURCE_GUARD_ABSENT");

for (const path of [
  "src/infra/gateway-lock.namespace.test.ts",
  "src/plugins/loader.instance-cleanup.test.ts",
  "src/cli/gateway-cli/run-loop.restart-liveness.process.test.ts",
]) source(betaDir, path);
console.log("PINNED_UPSTREAM_SOURCE_FEATURE_CHECK_PASS");
console.log("STABLE_WATCHDOG_EQUIVALENCE_NOT_PROVEN");
console.log("BETA_STATIC_GUARD_FOUND_RUNTIME_TESTS_SEPARATE");
console.log("NO_LIVE_STATE_NO_CREDENTIALS_NO_DISPATCH_NO_DEPLOY");
