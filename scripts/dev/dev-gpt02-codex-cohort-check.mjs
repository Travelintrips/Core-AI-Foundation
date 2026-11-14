#!/usr/bin/env node
// Read-only conservative ABI preflight for GPT02 Codex plugin cohort.
// This never loads a plugin, connects to a Gateway, reads a credential,
// alters a Windows service, writes state or authorizes Issue159 dispatch.
import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export function checkCodexCohort({ host, plugin, runtimeDep, entryPresent }) {
  const reasons = [];
  const hostVersion = host?.version;
  const pluginVersion = plugin?.version;
  const pluginConfig = plugin?.openclaw;
  const apiRange = pluginConfig?.compat?.pluginApi;
  const builtFor = pluginConfig?.build?.openclawVersion;
  const depSpec = plugin?.dependencies?.["@openai/codex"];
  const depVersion = runtimeDep?.version;
  if (host?.name !== "openclaw" || typeof hostVersion !== "string") {
    reasons.push("HOST_PACKAGE_UNVERIFIED");
  }
  if (plugin?.name !== "@openclaw/codex" || typeof pluginVersion !== "string") {
    reasons.push("CODEX_PACKAGE_UNVERIFIED");
  }
  // Fail closed on a mixed old/new core-plugin pair even if a broad
  // semver peer range technically allows it. Compatibility needs a
  // separate signed release-cohort and runtime proof, not an assumption.
  if (hostVersion !== pluginVersion) reasons.push("CODEX_PLUGIN_VERSION_MISMATCH");
  if (hostVersion !== builtFor) reasons.push("CODEX_PLUGIN_BUILD_HOST_MISMATCH");
  if (apiRange !== `>=${hostVersion}`) reasons.push("CODEX_PLUGIN_API_COHORT_UNVERIFIED");
  if (typeof depSpec !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(depSpec)) {
    reasons.push("CODEX_RUNTIME_DEP_NOT_EXACTLY_PINNED");
  }
  if (depSpec !== depVersion) reasons.push("CODEX_RUNTIME_DEP_MISMATCH");
  if (pluginConfig?.extensions?.includes("./index.ts") !== true) {
    reasons.push("CODEX_EXTENSION_ENTRY_UNVERIFIED");
  }
  if (!Array.isArray(pluginConfig?.build?.workerEntries) ||
      pluginConfig.build.workerEntries.length === 0) {
    reasons.push("CODEX_WORKER_CONTRACT_UNVERIFIED");
  }
  if (entryPresent !== true) reasons.push("CODEX_COMPILED_ENTRY_MISSING");
  return Object.freeze({
    readyForIsolatedCohortTests: reasons.length === 0,
    hostVersion: typeof hostVersion === "string" ? hostVersion : "unknown",
    pluginVersion: typeof pluginVersion === "string" ? pluginVersion : "unknown",
    runtimeDepVersion: typeof depVersion === "string" ? depVersion : "unknown",
    reasons: Object.freeze(reasons),
    // Does NOT attest live provider authentication, service health, or
    // restoration/upgrade eligibility even when metadata is aligned.
    liveGatewayPermitted: false,
    dispatchPermitted: false,
  });
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
export function inspectInstalledCodexCohort(hostPackagePath, pluginRoot) {
  const host = loadJson(hostPackagePath);
  const plugin = loadJson(join(pluginRoot, "package.json"));
  const runtimeDep = loadJson(join(pluginRoot,
    "node_modules", "@openai", "codex", "package.json"));
  let entryPresent = false;
  try {
    entryPresent = statSync(join(pluginRoot, "dist", "index.js")).isFile();
  } catch {
    // fail closed
  }
  return checkCodexCohort({ host, plugin, runtimeDep, entryPresent });
}

const main = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (main) {
  try {
    if (process.argv.length !== 4) throw new Error("ARGUMENTS_REQUIRED");
    const result = inspectInstalledCodexCohort(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
    if (!result.readyForIsolatedCohortTests) process.exitCode = 1;
  } catch {
    // Never print paths, file content, account identifiers or secrets.
    console.log(JSON.stringify({
      readyForIsolatedCohortTests: false,
      reasons: ["CODEX_COHORT_PREFLIGHT_UNREADABLE"],
      liveGatewayPermitted: false,
      dispatchPermitted: false,
    }));
    process.exitCode = 1;
  }
}
