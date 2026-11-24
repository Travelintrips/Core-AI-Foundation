import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const qa=read("scripts/dev/cst-onejob-stage-broker-rundir-restart-qa.sh");
const broker=read("scripts/dev/cst_onejob_preapproval_stage_broker.py");

test("synthetic runtime recovery is explicitly isolated and uses systemd cleanup",()=>{
  assert.match(qa,/cst-onejob-gatea-rundir-qa-/);
  assert.match(qa,/RuntimeDirectoryPreserve=no/);
  assert.match(qa,/RuntimeDirectoryMode=0700/);
  assert.match(qa,/systemctl kill --signal=SIGKILL/);
  assert.match(qa,/systemctl stop/);
  assert.match(qa,/--reuid=28500 --regid=28501 --clear-groups/);
  assert.match(qa,/QA_SIGKILL_RUNTIME_DIRECTORY_REMOVED_PASS/);
  assert.match(qa,/QA_NEW_UNIT_RESTART_SOCKET_PASS/);
});
test("QA cannot install or mutate any operational database or service",()=>{
  assert.doesNotMatch(qa,/\/etc\/systemd\/system|\/etc\/credstore|supabase\.com|ALTER ROLE|CREATE ROLE|docker|systemctl enable|systemctl daemon-reload/);
  assert.match(qa,/trap cleanup EXIT/);
  assert.match(qa,/mktemp \/tmp\//);
});
test("live broker still refuses any occupied socket rather than removing another process path",()=>{
  assert.match(broker,/deny\("SOCKET_OCCUPIED"\)/);
  assert.match(broker,/owned_socket=\(own\.st_dev,own\.st_ino\)/);
  assert.match(broker,/deny\("SOCKET_REPLACED_DURING_CLEANUP"\)/);
});
