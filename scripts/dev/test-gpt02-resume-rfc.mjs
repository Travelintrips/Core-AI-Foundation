import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const sql = readFileSync(new URL("../../docs/dev/gpt02-atomic-resume-claim.proposed.sql",import.meta.url),"utf8");
test("GPT02 resume SQL is an inert RFC with explicit fail-closed guard",()=>{
 assert.match(sql,/RAISE EXCEPTION 'RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED' USING ERRCODE = '0A000'/);
 const functionBody = sql.split("CREATE OR REPLACE FUNCTION ai_platform.dev_gpt02_claim_resume")[1];
 assert.ok(functionBody,"claim function must be present");
 assert.ok(functionBody.indexOf("RAISE EXCEPTION 'RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED'") < functionBody.indexOf("INSERT INTO ai_platform.dev_gpt02_resume_command_leases"),"guard must precede lease mutation");
 assert.ok(functionBody.indexOf("RAISE EXCEPTION 'RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED'") < functionBody.indexOf("UPDATE ai_platform.dev_gpt02_resume_grants"),"guard must precede grant consumption");
});
test("GPT02 draft grant/lease tables deny publicly exposed access",()=>{
 for(const table of ["dev_gpt02_resume_grants","dev_gpt02_resume_command_leases"]){
  assert.match(sql,new RegExp("ALTER TABLE ai_platform\\."+table+" ENABLE ROW LEVEL SECURITY;"));
  assert.match(sql,new RegExp("REVOKE ALL ON ai_platform\\."+table+" FROM PUBLIC, anon, authenticated;"));
 }
 assert.match(sql,/REVOKE ALL ON FUNCTION ai_platform.dev_gpt02_claim_resume\(uuid,uuid,uuid,uuid,text,integer\) FROM PUBLIC;/);
 assert.match(sql,/SECURITY INVOKER/);
});
test("GPT02 draft cannot be mistaken for a live migration or E2E proof",()=>{
 assert.match(sql,/NOT APPLIED/);
 assert.match(sql,/production migration is forbidden/);
 assert.match(sql,/REFERENCES ai_platform\.ai_coding_bridge_commands\(id\)/);
 assert.match(sql,/REFERENCES ai_platform\.ai_coding_bridge_responses\(id\)/);
});
