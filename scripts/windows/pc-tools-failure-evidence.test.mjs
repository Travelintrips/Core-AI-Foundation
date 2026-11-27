import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pcToolsFailureEvidence,scopedPcToolsWork} from './pc-tools-failure-evidence.mjs';
const workerId='openclaw-pc-worker-dev';
const work={commandType:'EXTERNAL_AGENT_WORK',metadata:{assignedClientId:workerId,requiredCapability:'tools:bounded',openClawExecutionProfile:'pc-tools',executionBoundary:'role-scoped'}};
function check(run, reason) {
  const evidence=pcToolsFailureEvidence(work,workerId,run);
  assert.equal(evidence.details.reason,reason);
  assert.equal(evidence.details.executionOutcome,'UNKNOWN_UNVERIFIED');
  assert.equal(evidence.details.reconciliationRequired,true);
  assert.equal(evidence.details.retryAllowed,false);
  for(const key of ['verified','chatgptSubmitted','modelInvoked','verifiedAssistantReply','deliveryCode','e2eCode']) assert.equal(Object.hasOwn(evidence.details,key),false);
  assert.ok(!JSON.stringify(evidence).includes('fixture-secret'));
  return evidence;
}
test('tool timeout is classified before truncation; no output or secrets are serialized',()=>{
  check({status:1,stdout:'tool execution timeout fixture-secret '+ 'x'.repeat(6000)},'PC_TOOL_EXECUTION_TIMEOUT');
});
test('auth failure can be in stderr even when stdout exists',()=>{
  check({status:1,stdout:'partial output',stderr:'No auth profile configured fixture-secret'},'PC_AUTH_PROFILE_UNAVAILABLE');
});
test('process timeout, buffer overflow, start failure and signal remain unknown',()=>{
  for(const [run,reason] of [
    [{status:null,error:{code:'ETIMEDOUT',message:'fixture-secret'}},'PC_SUBPROCESS_TIMEOUT'],
    [{status:null,error:{code:'ENOBUFS'}},'PC_SUBPROCESS_OUTPUT_LIMIT'],
    [{status:null,error:{code:'ENOENT'}},'PC_SUBPROCESS_START_ERROR'],
    [{status:null,signal:'SIGTERM'},'PC_SUBPROCESS_SIGNAL'],
  ]) check(run,reason);
});
test('conflicting or unstructured failure cannot be mistaken for a verified result',()=>{
  check({status:1,stdout:'tool execution timeout',stderr:'auth profile not configured'},'PC_FAILURE_MULTIPLE_SIGNALS');
  check({status:1,stdout:'{"verified":true,"message":"fixture-secret"}'},'PC_SUBPROCESS_FAILED');
});
test('successful, foreign, GPT02 or wake paths stay outside this diagnostic projection',()=>{
  assert.equal(pcToolsFailureEvidence(work,workerId,{status:0}),null);
  assert.equal(pcToolsFailureEvidence(work,'foreign',{status:1}),null);
  for(const patch of [{assignedClientId:'other'},{requiredCapability:'chatgpt:wake'},{openClawExecutionProfile:'other'},{executionBoundary:'other'},{capability:'chatgpt:wake'},{explicitWorkerTarget:true},{assistantAttestationChallenge:'fixture'},{gpt02TaskId:190}]){
    assert.equal(scopedPcToolsWork({...work,metadata:{...work.metadata,...patch}},workerId),false);
  }
  assert.equal(pcToolsFailureEvidence({...work,commandType:'EVENT_BINDING'},workerId,{status:1}),null);
});
test('existing subprocess execution and result delivery stay intact; classifier is only on returned result',()=>{
  const source=readFileSync(new URL('./openclaw-pc-dev-consumer.mjs',import.meta.url),'utf8');
  const spawn=source.indexOf('const run=spawnSync(node,args,{windowsHide:true,encoding:');
  const classify=source.indexOf('const failureEvidence = pcToolsFailureEvidence(work, workerId, run);');
  const tail=source.indexOf("const output=String(run.stdout||run.stderr||run.error?.message||'').slice(-3000);",classify);
  assert.ok(spawn>=0 && classify>spawn && tail>classify);
  assert.equal(source.split('pcToolsFailureEvidence(work, workerId, run)').length-1,1);
  assert.match(source,/if \(failureEvidence\) \{\s*return \{ok:false/);
  assert.match(source,/status:answer.ok\?'COMPLETED':'FAILED'/);
});


test('PC DEV ping reports the current OS hostname, without making a model or E2E claim',()=>{
  const source=readFileSync(new URL('./openclaw-pc-dev-consumer.mjs',import.meta.url),'utf8');
  const line=source.split(/\r?\n/).find(l=>l.includes("message.toLowerCase()==='ping'"));
  assert.ok(line);
  assert.match(line,/os\.hostname\(\)/);
  assert.doesNotMatch(line,/DESKTOP-CPS76BH|verified|e2eCode|spawnSync/);
  const ping=new Function('message','os',line);
  for(const hostname of ['FIXTURE-PC','FIXTURE-RENAMED']){
    assert.deepEqual(ping('PING',{hostname:()=>hostname}),{ok:true,message:'pong from '+hostname,details:{runtime:'openclaw-pc2',mode:'ping'}});
  }
});
