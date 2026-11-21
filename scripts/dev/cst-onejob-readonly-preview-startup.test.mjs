import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {skipWorkspaceSchemaEnsureForOneJobPreview as gate}
  from "../../artifacts/api-server/src/lib/cstOneJobReadonlyPreviewGate.ts";

const baseline=Object.freeze({
  APP_ENV:"development",
  NODE_ENV:"development",
  CST_DEV_ONEJOB_READONLY_PREVIEW:"true",
  AI_DEV_BACKGROUND_RUNTIME_ENABLED:"false",
  AI_DISPATCHER_ENABLED:"false",
  OLLAMA_WORKER_RUNTIME_ENABLED:"false",
  AI_SCHEDULER_ENABLED:"false",
  AI_CORE_DEV_CONTINUITY_ENABLED:"false",
  CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:"false",
  CST_DEV_ONEJOB_BROKER_ENABLED:"false",
  AI_DEV_SAFE_WORKERS_ENABLED:"false",
  SUPABASE_URL_DEV:"https://xssrfshdrtdfupgqwfdw.supabase.co",
});
const source=readFileSync(new URL("../../artifacts/api-server/src/routes/review-workspace.ts",import.meta.url),"utf8");

test("ordinary DEV and existing PROD preserve normal schema initialization",()=>{
  assert.equal(gate({}),false);
  assert.equal(gate({CST_DEV_ONEJOB_READONLY_PREVIEW:"false"}),false);
  assert.match(source,/if \(!skipWorkspaceSchemaEnsureForOneJobPreview\(\)\)\s*\{\s*ensureWorkspaceMetaTable\(\)/);
});
test("only exact single-host feature-OFF DEV preview skips import-time DDL",()=>{
  assert.equal(gate({...baseline}),true);
  assert.match(source,/skipWorkspaceSchemaEnsureForOneJobPreview/);
});
test("all malformed or incomplete preview configurations fail closed",()=>{
  const deny=[
    ...Object.keys(baseline).filter(x=>x!=="CST_DEV_ONEJOB_READONLY_PREVIEW").map(key=>({...baseline,[key]:""})),
    ...["production","prod","staging"].map(mode=>({...baseline,APP_ENV:mode})),
    ...["production","test"].map(mode=>({...baseline,NODE_ENV:mode})),
    ...["true","yes","1"].map(v=>({...baseline,AI_DISPATCHER_ENABLED:v})),
    ...["true","yes"].map(v=>({...baseline,CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED:v})),
    ...["true","yes"].map(v=>({...baseline,CST_DEV_ONEJOB_BROKER_ENABLED:v})),
    ...["true","yes"].map(v=>({...baseline,AI_DEV_SAFE_WORKERS_ENABLED:v})),
    ...["true","yes"].map(v=>({...baseline,AI_CORE_DEV_CONTINUITY_ENABLED:v})),
    ...["true","yes"].map(v=>({...baseline,OLLAMA_WORKER_RUNTIME_ENABLED:v})),
    ...["true","yes"].map(v=>({...baseline,AI_DEV_BACKGROUND_RUNTIME_ENABLED:v})),
    { ...baseline, SUPABASE_PROD_DATABASE_URL:"postgresql://should-not-be-used" },
    { ...baseline, SUPABASE_DATABASE_URL:"postgresql://should-not-be-used" },
    { ...baseline, SUPABASE_SERVICE_ROLE_KEY:"test" },
    { ...baseline, SUPABASE_URL_DEV:"https://nzdweipzckfszczzqtuw.supabase.co" },
  ];
  for (const config of deny)assert.throws(()=>gate(config),/ONEJOB_PREVIEW_UNSAFE_RUNTIME_DENIED/);
});
test("typos cannot silently enable a preview or trigger schema writes",()=>{
  for(const value of ["TRUE","yes","1","on","TRUE "])
    assert.throws(()=>gate({...baseline,CST_DEV_ONEJOB_READONLY_PREVIEW:value}),/ONEJOB_PREVIEW_INVALID_BOOLEAN/);
});
test("read-only preview never grants owner consent or dispatch itself",()=>{
  const raw=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobReadonlyPreviewGate.ts",import.meta.url),"utf8");
  assert.doesNotMatch(raw,/CREATE\s+ROLE|INSERT\s+INTO|UPDATE\s+ai_platform|GRANT\s+ALL|launch|execSync/);
  assert.match(raw,/CST_DEV_ONEJOB_OWNER_APPROVAL_ENABLED/);
  assert.match(raw,/CST_DEV_ONEJOB_BROKER_ENABLED/);
});
