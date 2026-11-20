import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkCodexCohort } from "./dev-gpt02-codex-cohort-check.mjs";

// Synthetic runtime-dependency and compiled-entry fields in this test.
// The host and plugin manifests are from immutable upstream Git checkouts.
// This is a metadata gate, NOT a real credential/plugin runtime test.
function fixture(root) {
  const host = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(root, "extensions/codex/package.json"), "utf8"));
  const runtimeDep = { version: plugin.dependencies["@openai/codex"] };
  return { host, plugin, runtimeDep, entryPresent: true };
}
const original = fixture("upstream-original");
const candidate = fixture("upstream-beta");
test("original DELL-version aligned cohort is accepted for inspection only",()=>{
  const result=checkCodexCohort(original);
  assert.equal(result.readyForIsolatedCohortTests,true,JSON.stringify(result.reasons));
  assert.equal(result.liveGatewayPermitted,false);
  assert.equal(result.dispatchPermitted,false);
  assert.equal(result.hostVersion,"2026.10.7");
});
test("pinned beta cohort is accepted for isolated tests only",()=>{
  const result=checkCodexCohort(candidate);
  assert.equal(result.readyForIsolatedCohortTests,true,JSON.stringify(result.reasons));
  assert.equal(result.liveGatewayPermitted,false);
  assert.equal(result.dispatchPermitted,false);
});
test("mixing DELL's old plugin with candidate host fails closed",()=>{
  const result=checkCodexCohort({...original,host:candidate.host});
  assert.equal(result.readyForIsolatedCohortTests,false);
  assert.ok(result.reasons.includes("CODEX_PLUGIN_VERSION_MISMATCH"));
  assert.ok(result.reasons.includes("CODEX_PLUGIN_BUILD_HOST_MISMATCH"));
});
test("mixing new plugin with old host fails closed",()=>{
  const result=checkCodexCohort({...candidate,host:original.host});
  assert.equal(result.readyForIsolatedCohortTests,false);
  assert.ok(result.reasons.includes("CODEX_PLUGIN_VERSION_MISMATCH"));
});
test("missing or substituted native Codex dependency is rejected",()=>{
  for(const runtimeDep of [{version:"0.160.0"},null,undefined,{version:"other"}]){
    const result=checkCodexCohort({...candidate,runtimeDep});
    assert.equal(result.readyForIsolatedCohortTests,false);
    assert.ok(result.reasons.includes("CODEX_RUNTIME_DEP_MISMATCH"));
  }
});
test("missing compiled plugin entry and mismatched plugin API are rejected",()=>{
  const missing=checkCodexCohort({...candidate,entryPresent:false});
  assert.ok(missing.reasons.includes("CODEX_COMPILED_ENTRY_MISSING"));
  const bad=checkCodexCohort({...candidate,plugin:{
    ...candidate.plugin,openclaw:{
      ...candidate.plugin.openclaw,
      compat:{pluginApi:">=2026.10.7"}
    }
  }});
  assert.ok(bad.reasons.includes("CODEX_PLUGIN_API_COHORT_UNVERIFIED"));
});
test("missing worker contract is rejected",()=>{
  const bad=checkCodexCohort({...candidate,plugin:{
    ...candidate.plugin,openclaw:{
      ...candidate.plugin.openclaw,
      build:{...candidate.plugin.openclaw.build,workerEntries:[]}
    }
  }});
  assert.ok(bad.reasons.includes("CODEX_WORKER_CONTRACT_UNVERIFIED"));
});
