import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validateCredentials,
  validateResult,
  cleanupEvidence,
  RELOCK_TERMINATION_BUDGET,
  main
} from '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs';

const VALID=Object.freeze({
  database:'postgres',
  host:'db.xssrfshdrtdfupgqwfdw.supabase.co',
  password:'X'.repeat(64),
  port:5432,
  projectRef:'xssrfshdrtdfupgqwfdw',
  sslMode:'verify-full',
  user:'dev_gpt02_relock_catalog_auditor'
});

test('original existing credential schema is pinned',()=>{
  assert.equal(validateCredentials({...VALID}),true);
});
test('cross-project, untrusted host, and wrong role all denied',()=>{
  for(const change of [
    {projectRef:'nzdweipzckfszczzqtuw'},
    {host:'db.example.org'},
    {user:'postgres'},
    {sslMode:'disable'},
    {port:6432},
  ])assert.throws(()=>validateCredentials({...VALID,...change}),/RELOCK_/);
});
test('extra, missing, short and malformed credential fields fail',()=>{
  for(const candidate of [
    {...VALID,debug:true},
    {...VALID,password:'short'},
    {...VALID,password:null},
    {...VALID,host:undefined},
    null,[],{}
  ])assert.throws(()=>validateCredentials(candidate),/RELOCK_/);
});
test('phase results allow bounded integer counts only',()=>{
  for(const n of [0,1,3,1000])assert.equal(validateResult(n,'PHASE_A'),n);
  for(const n of [-1,1001,2.4,NaN,Infinity, '1', null, undefined]){
    assert.throws(()=>validateResult(n,'PHASE_B'),/RELOCK_/);
  }
});
test('never connects if not in explicit DEV mode',async()=>{
  const before=process.env.APP_ENV;
  const beforeCred=process.env.CREDENTIALS_DIRECTORY;
  try{
    process.env.APP_ENV='production';
    delete process.env.CREDENTIALS_DIRECTORY;
    assert.equal(await main(),3);
  }finally{
    if(before===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=before;
    if(beforeCred===undefined)delete process.env.CREDENTIALS_DIRECTORY;
    else process.env.CREDENTIALS_DIRECTORY=beforeCred;
  }
});
test('no systemd credential context means NO-GO, no connection',async()=>{
  const before=process.env.APP_ENV;
  const beforeCred=process.env.CREDENTIALS_DIRECTORY;
  try{
    process.env.APP_ENV='development';
    delete process.env.CREDENTIALS_DIRECTORY;
    assert.equal(await main(),3);
  }finally{
    if(before===undefined)delete process.env.APP_ENV;
    else process.env.APP_ENV=before;
    if(beforeCred===undefined)delete process.env.CREDENTIALS_DIRECTORY;
    else process.env.CREDENTIALS_DIRECTORY=beforeCred;
  }
});

function runNoCredentialCli(overrides) {
  const supervisor=fileURLToPath(new URL(
    '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs',
    import.meta.url
  ));
  const child=spawnSync(process.execPath,[supervisor],{
    encoding:'utf8',timeout:5000,
    env:{...process.env,APP_ENV:'development',CREDENTIALS_DIRECTORY:'',...overrides}
  });
  assert.equal(child.error,undefined);
  assert.equal(child.status,3,'skipped or denied work must not return success');
  assert.equal(child.stdout.trim(),'','no success-style report on denial');
  const lines=child.stderr.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length,1,'exactly one structured denial report');
  const verdict=JSON.parse(lines[0]);
  assert.equal(verdict.environment,'DEV');
  assert.equal(verdict.independentSupervisor,true);
  assert.equal(verdict.authorizationGranted,false);
  assert.equal(verdict.signingPermitted,false);
  assert.equal(verdict.dispatchPermitted,false);
  assert.equal(verdict.releaseDecision,'NO_GO');
  return verdict.reason;
}

test('supervisor CLI never reports skipped credential context as success',()=>{
  assert.equal(runNoCredentialCli({}),
    'RELOCK_SYSTEMD_CREDENTIALS_REQUIRED');
});

test('supervisor CLI rejects PROD even when an apparent credential directory is supplied',()=>{
  assert.equal(runNoCredentialCli({
    APP_ENV:'production',
    CREDENTIALS_DIRECTORY:'/run/credentials/synthetic.unit'
  }),'RELOCK_EXPLICIT_DEV_MODE_REQUIRED');
});

test('confirmed PID termination budgets exceed the actual PostgreSQL waits',()=>{
  const sql=readFileSync(fileURLToPath(new URL(
    '../../docs/dev/gpt02_issue159_fixed_writer_relock.REVIEW_ONLY.sql',
    import.meta.url
  )),'utf8');
  const match=sql.match(/pg_terminate_backend\(pid_row\.pid,\s*(\d+)\)/);
  assert.ok(match,'exact PostgreSQL confirmed termination timeout must exist');
  const confirmedWaitMs=Number(match[1]);
  const budget=RELOCK_TERMINATION_BUDGET;
  assert.equal(budget.roleSlots,3,'all three fixed scoped roles must be covered');
  assert.equal(confirmedWaitMs,budget.perBackendWaitMs);
  assert.ok(budget.statementTimeoutMs >
    budget.roleSlots*confirmedWaitMs,
    'SQL must outlast all three bounded PID waits');
  assert.ok(budget.queryTimeoutMs>budget.statementTimeoutMs,
    'client query must not cancel server before its SQL deadline');

  const drop=readFileSync(fileURLToPath(new URL(
    '../../deploy/ai-coding-standalone-dev/' +
      'gpt02-issue159-relock-catalog-auditor.service.d/10-node-jitless.conf',
    import.meta.url
  )),'utf8');
  const timeout=drop.match(/^TimeoutStartSec=(\d+)s$/m);
  assert.ok(timeout,'systemd must explicitly accommodate confirmed backend waits');
  assert.equal(Number(timeout[1])*1000,budget.systemdStartTimeoutMs);
  assert.equal(budget.preflightQueryTimeoutMs,2500);
  assert.equal(budget.phaseAQueryTimeoutMs,4500);
  assert.equal(budget.connectionTimeoutMs,4000);
  assert.ok(budget.preflightQueryTimeoutMs < budget.phaseAQueryTimeoutMs,
    'preflight must fail quickly rather than consume Phase B budget');
  assert.ok(budget.phaseAQueryTimeoutMs < budget.queryTimeoutMs,
    'Phase B must have the longest query budget');
  const totalBound = budget.connectionTimeoutMs +
    2*budget.preflightQueryTimeoutMs +
    budget.phaseAQueryTimeoutMs + budget.queryTimeoutMs;
  assert.ok(budget.systemdStartTimeoutMs > totalBound+3000,
    'oneshot must exceed the complete sequential worst-case query budget');

  assert.match(drop,/ExecStart=\/usr\/bin\/node --jitless --no-experimental-fetch /);
});

test('cleanup catalog counts never confer positive authority or live-disconnect proof',()=>{
  for(const [a,b] of [[0,0],[1,1],[0,1],[3,3]]) {
    const out=cleanupEvidence(a,b);
    assert.deepEqual(Object.keys(out).sort(),[
      'authorizationGranted','connectedSessionTerminationProven',
      'dispatchPermitted','environment','independentSupervisor',
      'phaseAWindowCount','phaseBCleanedWindowCount','reason',
      'releaseDecision','signingPermitted'
    ].sort());
    assert.equal(out.environment,'DEV');
    assert.equal(out.reason,'RELOCK_CLEANUP_ONLY');
    assert.equal(out.phaseAWindowCount,a);
    assert.equal(out.phaseBCleanedWindowCount,b);
    assert.equal(out.connectedSessionTerminationProven,false);
    assert.equal(out.authorizationGranted,false);
    assert.equal(out.signingPermitted,false);
    assert.equal(out.dispatchPermitted,false);
    assert.equal(out.releaseDecision,'NO_GO');
  }
  for(const invalid of [-1,1001,2.1,NaN,Infinity,null,undefined,'3',true]) {
    assert.throws(()=>cleanupEvidence(invalid,0),/RELOCK_/);
    assert.throws(()=>cleanupEvidence(0,invalid),/RELOCK_/);
  }
});

test('per-query deadlines preserve the order: identity then Phase A then Phase B',()=>{
  const source=readFileSync(fileURLToPath(new URL(
    '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs',
    import.meta.url
  )),'utf8');
  assert.match(source,/query_timeout:\s*RELOCK_TERMINATION_BUDGET\.preflightQueryTimeoutMs/);
  assert.match(source,/query_timeout:\s*RELOCK_TERMINATION_BUDGET\.phaseAQueryTimeoutMs/);
  assert.match(source,/query_timeout:\s*RELOCK_TERMINATION_BUDGET\.queryTimeoutMs/);
  const validateA=source.indexOf('const phaseAWindows = validateResult(');
  const phaseB=source.indexOf('gpt02_relock_audit.relock_expired_phase_b() AS count');
  const log=source.indexOf("JSON.stringify(cleanupEvidence(");
  assert.ok(validateA>0 && validateA<phaseB && phaseB<log,
    'Phase A must be validated before Phase B and non-authority report');
});
