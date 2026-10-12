import test from 'node:test';
import assert from 'node:assert/strict';
import {tick} from './connection-watchdog-adapter.mjs';
const now=1_000_000;
const job={jobId:'j1',commitSha:'sha',checkpointSha:'sha',status:'RUNNING',lastProgressAt:now-180000,connectionHealthy:true,runnerAuthenticated:true,runnerHealthy:true,checkpointVerified:true,resumeAttempts:0};
function deps(){const claims=new Set(),finished=[];let calls=0;return {store:{async claim(key){if(claims.has(key))return false;claims.add(key);return true},async finish(key,v){finished.push([key,v])}},runner:{async resume(){calls++;return 'ok'}},get calls(){return calls},finished};}
test('verified stalled job resumes once',async()=>{const d=deps();assert.equal((await tick({jobs:[job],...d,now}))[0].action,'RESUMED');assert.equal(d.calls,1)});
test('duplicate ticks do not resume twice',async()=>{const d=deps();await tick({jobs:[job],...d,now});assert.equal((await tick({jobs:[job],...d,now}))[0].action,'NONE');assert.equal(d.calls,1)});
test('human approval never resumed',async()=>{const d=deps();await tick({jobs:[{...job,approvalPending:true}],...d,now});assert.equal(d.calls,0)});
test('missing checkpoint never resumed',async()=>{const d=deps();await tick({jobs:[{...job,checkpointVerified:false}],...d,now});assert.equal(d.calls,0)});
test('fail closed without durable store',async()=>await assert.rejects(tick({jobs:[job],runner:{resume(){}},now}),/durable claim/));
test('fail closed without authenticated runner adapter',async()=>await assert.rejects(tick({jobs:[job],store:{claim(){},finish(){}},now}),/authenticated runner/));
test('runner failure recorded without automatic claim release',async()=>{const d=deps();d.runner.resume=async()=>{throw Error('offline')};assert.equal((await tick({jobs:[job],...d,now}))[0].action,'ERROR');assert.equal(d.finished[0][1].status,'ERROR');assert.equal((await tick({jobs:[job],...d,now}))[0].action,'NONE')});
