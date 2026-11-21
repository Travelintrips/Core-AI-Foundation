import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const stage=read("artifacts/api-server/src/lib/cstOneJobStagingDatabase.ts");
const candidateUnit=read("deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-bootstrap.service.CANDIDATE");
const postBroker=read("scripts/dev/cst_team_onejob_operational_broker.py");

test("Gate A dedicated stage socket cannot be confused with Gate B admission socket",()=>{
 assert.match(stage,/CST_ONEJOB_OWNER_STAGE_SOCKET_PATH="\/run\/cst-onejob-stage-db\/pg-pooler\.sock"/);
 assert.match(stage,/makeOneJobUnixSocketStream\(CST_ONEJOB_OWNER_STAGE_SOCKET_PATH\)/);
 assert.match(candidateUnit,/ExecCondition=\/usr\/bin\/test -S \/run\/cst-onejob-stage-db\/pg-pooler\.sock/);
 assert.match(candidateUnit,/src=\/run\/cst-onejob-stage-db\/pg-pooler\.sock/);
 assert.doesNotMatch(candidateUnit,/src=\/run\/cst-onejob-dev-db\/pg-pooler\.sock/);
 assert.match(postBroker,/SOCKET="\/run\/cst-onejob-dev-db\/pg-pooler\.sock"/);
});

test("post-approval broker remains signed job bound and one-session, never pre-approval stage",()=>{
 for(const field of ["jobId","ownerApprovalSha256","subscriberArmedSha256","sourceSha","networkNamespaceInode"])
  assert.ok(postBroker.includes('"'+field+'"'),field);
 assert.match(postBroker,/if value\["brokerUid"\]==value\["workerUid"\]/);
 assert.match(postBroker,/if not v.accepted:/);
 assert.match(postBroker,/CST_ONEJOB_BROKER_ONE_SESSION_CLOSED/);
 assert.match(postBroker,/return\n\s*fail\("NO_APPROVED_SESSION_BEFORE_EXPIRY"\)/);
});

test("Gate A remains candidate until dedicated pre-job broker and signed session custody verified",()=>{
 assert.match(candidateUnit,/ConditionPathExists=\/etc\/cst-onejob-dev\/bootstrap-verified\/owner-stage-runtime-ready\.json/);
 assert.match(candidateUnit,/owner-stage-socket-acl-reviewed\.json/);
 assert.match(candidateUnit,/LoadCredentialEncrypted=session-secret:/);
 assert.match(candidateUnit,/AI_DISPATCHER_ENABLED=false/);
 assert.match(candidateUnit,/OLLAMA_WORKER_RUNTIME_ENABLED=false/);
 assert.doesNotMatch(candidateUnit,/\[Install\]/);
});
