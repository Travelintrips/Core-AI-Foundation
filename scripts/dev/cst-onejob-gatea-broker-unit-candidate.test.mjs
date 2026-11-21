import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../../deploy/cst-onejob-vps/owner-stage-bootstrap/cst-onejob-gatea-preapproval-broker.service.CANDIDATE",import.meta.url),"utf8");

test("no operational unit install and unavailable independent trust prerequisites",()=>{
 assert.doesNotMatch(source,/^\[Install\]$/m);
 assert.match(source,/ConditionPathExists=\/etc\/cst-onejob-dev\/gatea-authority\/independent-gatea-approval\.json/);
 assert.match(source,/ConditionPathExists=\/etc\/cst-onejob-dev\/gatea-authority\/signed-gatea-manifest\.json/);
 assert.match(source,/ConditionPathExists=\/etc\/cst-onejob-dev\/gatea-authority\/approved-gatea-public\.pem/);
 assert.match(source,/EnvironmentFile=\/etc\/cst-onejob-dev\/gatea-authority\/gatea-approved-public\.env/);
 assert.match(source,/--expected-source-sha \$\{CST_GATEA_PINNED_SOURCE_SHA\}/);
});
test("kernel network namespace and fixed stage runtime directory cannot silently use host networking",()=>{
 assert.match(source,/NetworkNamespacePath=\/run\/netns\/cst-onejob-gatea-reviewed/);
 assert.match(source,/ConditionPathExists=\/run\/netns\/cst-onejob-gatea-reviewed/);
 assert.match(source,/RuntimeDirectory=cst-onejob-stage-db/);
 assert.match(source,/RuntimeDirectoryPreserve=no/);
 assert.match(source,/ExecStartPre=\/usr\/bin\/chown 28500:28501 \/run\/cst-onejob-stage-db/);
 assert.match(source,/ExecStartPre=\/usr\/bin\/chmod 0750 \/run\/cst-onejob-stage-db/);
 assert.doesNotMatch(source,/--network host|\/usr\/sbin\/nft.*-f|iptables.*-A|--privileged|BYPASSRLS/);
});
test("one broker process has explicit non-root security and no automatic restart",()=>{
 assert.match(source,/ExecStart=\/usr\/bin\/setpriv --no-new-privs --bounding-set=-all --reuid=28500 --regid=28501 --clear-groups/);
 assert.match(source,/ExecCondition=\/usr\/bin\/python3 -B .*preapproval_stage_broker\.py validate/);
 assert.match(source,/ExecCondition=\/usr\/bin\/setpriv --no-new-privs --bounding-set=-all --reuid=28500 --regid=28501 --clear-groups .*preapproval_stage_broker\.py validate/);
 assert.equal([...source.matchAll(/^ExecCondition=.*preapproval_stage_broker\.py validate/gm)].length,2,"root and nonroot must independently validate");
 assert.match(source,/ExecStart=.*preapproval_stage_broker\.py run/);
 assert.match(source,/Restart=no/);
 assert.match(source,/KillMode=control-group/);
 assert.match(source,/ProtectSystem=strict/);
 assert.match(source,/NoNewPrivileges=yes/);
});
