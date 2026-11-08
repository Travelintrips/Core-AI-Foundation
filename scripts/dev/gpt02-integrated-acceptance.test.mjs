import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./gpt02-integrated-acceptance.mjs',import.meta.url));
function run(args=[]){
 return spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:10000});
}
test('source checks pass but explicitly deny real release',()=>{
 const result=run(['--json']);
 assert.equal(result.status,0,result.stderr);
 const status=JSON.parse(result.stdout);
 assert.equal(status.testGate,'PASS');
 assert.equal(status.releaseDecision,'NO_GO');
 assert.equal(status.noLiveChanges,true);
 assert.equal(status.checks.length,22);
 assert.ok(status.checks.every(g=>g.ok),JSON.stringify(status.checks));
 assert.equal(status.unresolvedBlockers.length,8);
 assert.ok(status.unresolvedBlockers.every(b=>b.id.startsWith('P0_')));
});
test('explicit release-ready mode fails until independent E2E evidence exists',()=>{
 const result=run(['--require-release-ready']);
 assert.equal(result.status,2);
 assert.match(result.stdout,/RELEASE NO_GO/);
});
