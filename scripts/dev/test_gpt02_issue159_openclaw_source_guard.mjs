#!/usr/bin/env node
// Source-feature evidence only. Does not invoke OpenClaw, run a gateway, or
// grant GPT02 dispatch. Upstream tests execute separately on disposable CI.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [stableDir, betaDir, originalDir] = process.argv.slice(2);
assert.ok(stableDir && betaDir && originalDir,
  "REQUIRE_PINNED_STABLE_BETA_AND_ORIGINAL_CHECKOUT_DIRECTORIES");
const originalCommit = "157d8c2bc3ea2fa183afdc11088e69690bf8e64e";
const stableCommit = "847611dcaa3bf0e2783335f961dd1fd0580e4d9f";
const betaCommit = "c0f42f648144b25b8945b9c56329eb13eb6d7754";
const head = (dir) => execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], {
  encoding: "utf8", timeout: 10000,
}).trim();
assert.equal(head(originalDir), originalCommit, "ORIGINAL_CHECKOUT_SHA_MISMATCH");
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
const originalCodex = JSON.parse(source(originalDir, "extensions/codex/package.json"));
const betaCodex = JSON.parse(source(betaDir, "extensions/codex/package.json"));
assert.equal(originalCodex.version, "2026.10.7");
assert.equal(betaCodex.version, "2026.11.5-beta.2");
assert.equal(originalCodex.openclaw.compat.pluginApi, ">=2026.10.7");
assert.equal(betaCodex.openclaw.compat.pluginApi, ">=2026.11.5-beta.2");
assert.equal(originalCodex.openclaw.build.openclawVersion, "2026.10.7");
assert.equal(betaCodex.openclaw.build.openclawVersion, "2026.11.5-beta.2");
assert.equal(originalCodex.dependencies["@openai/codex"], "0.160.0");
assert.equal(betaCodex.dependencies["@openai/codex"], "0.164.0");
assert.equal(originalCodex.openclaw.build.workerEntries.length, 1);
assert.equal(betaCodex.openclaw.build.workerEntries.length, 2);
for (const path of [
  "extensions/codex/src/app-server/auth-requirement-matrix.test.ts",
  "extensions/codex/src/app-server/auth-profile-selection.test.ts",
  "extensions/codex/src/app-server/auth-profile-runtime-contract.test.ts",
  "extensions/codex/src/app-server/connection-health.test.ts",
  "extensions/codex/src/app-server/client-shutdown.test.ts",
]) source(betaDir, path);

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
console.log("ORIGINAL_DELL_CODEX_PLUGIN_API_2026_10_7_CONFIRMED");
console.log("BETA_CODEX_PLUGIN_API_2026_11_5_BETA_2_REQUIRED");
console.log("CROSS_VERSION_CODEX_PLUGIN_COMPATIBILITY_NOT_PROVEN");
console.log("STABLE_WATCHDOG_EQUIVALENCE_NOT_PROVEN");
console.log("BETA_STATIC_GUARD_FOUND_RUNTIME_TESTS_SEPARATE");
console.log("NO_LIVE_STATE_NO_CREDENTIALS_NO_DISPATCH_NO_DEPLOY");
