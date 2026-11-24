import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const root=new URL("../../",import.meta.url);
const load=p=>readFileSync(new URL(p,root),"utf8");
const unit=load("deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-bootstrap.service.CANDIDATE");
const nginx=load("deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-owner-stage-routing.nginx.CANDIDATE");
const entry=load("deploy/cst-onejob-vps/owner-stage-bootstrap/entrypoint-stage-only.sh");
const supervisor=load("deploy/cst-onejob-vps/owner-stage-bootstrap/stage-http-unix-supervisor.cjs");

test("staging container has no external bridge, host port, or elevated network capability",()=>{
 assert.match(unit,/--network none --user 28502:28501 --group-add 33/);
 assert.match(unit,/--read-only --cap-drop ALL --security-opt no-new-privileges:true/);
 assert.doesNotMatch(unit,/--network host|--network cst-onejob-owner-stage-egress|--publish|--privileged|--cap-add/);
 assert.match(unit,/--mount type=bind,src=\/run\/cst-onejob-stage-http,dst=\/run\/cst-onejob-stage-http/);
 assert.match(unit,/RuntimeDirectory=cst-onejob-stage-credentials cst-onejob-stage-http/);
 assert.match(unit,/ExecStartPre=\/usr\/bin\/chown 28502:33 \/run\/cst-onejob-stage-http/);
 assert.match(unit,/ExecStartPre=\/usr\/bin\/chmod 2750 \/run\/cst-onejob-stage-http/);
});

test("nginx candidate uses exact bounded routes over Unix socket, not a TCP bind",()=>{
 const routes=["owner-stage-readiness","owner-stage-status","owner-approve-and-stage"];
 for(const route of routes){
  assert.match(nginx,new RegExp("location = /api/ai/dev/onejob/"+route));
  assert.match(nginx,new RegExp("proxy_pass http://unix:/run/cst-onejob-stage-http/api\\.sock:/api/ai/dev/onejob/"+route));
 }
 assert.doesNotMatch(nginx,/127\.0\.0\.1:18583|proxy_pass http:\/\/[^u]/);
 assert.match(nginx,/limit_except POST \{ deny all; \}/);
 assert.match(nginx,/location \^~ \/api\/ai\/dev\/onejob\/owner-approve-and-stage\//);
});

test("fixed-only Unix supervisor enforces stage identity and local TCP backend",()=>{
 for(const part of ["const UID = 28502","GID = 28501","NGINX_GROUP = 33",
  "process.getgroups","SOCKET_PATH_ALREADY_EXISTS","SOCKET_PARENT_UNTRUSTED",
  'host:"127.0.0.1",port:3000',"fs.chmodSync(SOCKET,0o660)"])
  assert.ok(supervisor.includes(part),part);
 assert.doesNotMatch(supervisor,/process\.env\.(HOST|PORT|SOCKET_PATH)|0\.0\.0\.0|child_process\.exec\(/);
 assert.match(supervisor,/spawn\(process\.execPath,\["scripts\/hostinger-start\.cjs"\]/);
 assert.match(entry,/exec node \/run\/cst-stage-http-supervisor\.cjs/);
 assert.doesNotMatch(entry,/exec node scripts\/hostinger-start\.cjs/);
});

test("HTTP socket is separate from PostgreSQL Gate-A and Gate-B sockets",()=>{
 const db=load("artifacts/api-server/src/lib/cstOneJobStagingDatabase.ts");
 assert.match(db,/\/run\/cst-onejob-stage-db\/pg-pooler\.sock/);
 assert.doesNotMatch(db,/cst-onejob-stage-http/);
 assert.doesNotMatch(supervisor,/pg-pooler|6543|SUPABASE/);
});
