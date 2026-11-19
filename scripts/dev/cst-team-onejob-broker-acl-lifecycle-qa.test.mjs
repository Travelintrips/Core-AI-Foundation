import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source=readFileSync(new URL("./cst-team-onejob-broker-acl-lifecycle-qa.sh",import.meta.url),"utf8");

test("disposable broker/ACL QA runner passes shell syntax",()=>{
  const shell=spawnSync("bash",["-n"],{input:source,encoding:"utf8",timeout:2000});
  assert.equal(shell.status,0,shell.stderr);
});
test("QA runner installs and positively audits namespace ACL BEFORE mock broker start",()=>{
  const acl=source.indexOf('nsenter --target "$PID" --net nft -f "$DIR/rules.nft"');
  const kernelRead=source.indexOf("KERNEL_QA_ALLOW_DENY_EVIDENCE_PASS");
  const broker=source.indexOf("MOCK_BROKER_STARTED_AFTER_ACL=true");
  const allowDenied=source.indexOf('nsenter --target "$PID" --net /usr/bin/node -e "$CLIENT" "$IP_DENY" DENY');
  assert.ok(acl>0 && kernelRead>acl && broker>kernelRead && allowDenied>acl);
  assert.match(source,/--audit-kernel-qa "\$IP_ALLOW"/);
  assert.match(source,/\[\[ -z "\$\(nsenter/); // No unchecked unrelated pre-existing tables.
});
test("exact offline-only mock: no actual Supabase upstream or operational broker",()=>{
  assert.match(source,/--entrypoint node node:22-alpine/);
  assert.match(source,/listen\(6543,"0\.0\.0\.0"\)/);
  assert.match(source,/dialMock:\(\)=>connect\(\{host:mockIp,port:6543\}\)/);
  assert.doesNotMatch(source,/aws-[01]-ap-southeast/);
  assert.doesNotMatch(source,/supabase\.co|nzdweipzckfszczzqtuw|xssrfshdrtdfupgqwfdw/);
  assert.doesNotMatch(source,/startOperationalCstDevBroker|SUPABASE_.*PASSWORD|service_role/);
  assert.doesNotMatch(source,/docker\s+run[^\n]*--network\s+host/);
});
test("QA process uses separate namespace and non-root broker/client identities",()=>{
  assert.match(source,/readlink "\/proc\/\$PID\/ns\/net"/);
  assert.match(source,/--cap-drop ALL --security-opt no-new-privileges/);
  assert.match(source,/setpriv --no-new-privs --bounding-set=-all --reuid=28500 --regid=28501 --clear-groups/);
  assert.match(source,/peerIdentity:\{uid:28502,gid:28501\}/);
  assert.match(source,/setpriv --reuid=28503 --regid=28501 --clear-groups/);
  assert.match(source,/setpriv --reuid=28502 --regid=28501 --clear-groups/);
  assert.match(source,/KERNEL_PEER_DENIED_BEFORE_UPSTREAM=true/);
  assert.match(source,/APPROVED_PEER_FORWARDED_EXACTLY_ONCE=true/);
});
test("QA always cleans local mock containers/networks/socket on failure",()=>{
  assert.match(source,/trap cleanup EXIT/);
  assert.match(source,/docker rm -f "\$name"/);
  assert.match(source,/docker network rm "\$NET"/);
  assert.match(source,/rm -rf "\$DIR"/);
  assert.match(source,/NO_SUPABASE_OR_DB_CREDENTIALS_NO_HOST_FIREWALL_CHANGES/);
});
