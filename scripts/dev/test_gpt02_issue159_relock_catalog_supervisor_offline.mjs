import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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


// Run a COPY of the actual supervisor against an isolated in-process pg stub.
// No real network, Supabase credential, live role or installed VPS file is used.
function simulateSupervisorWithFakePg(scenario) {
  const base=mkdtempSync(join(tmpdir(),'gpt02-relock-fake-pg-'));
  try {
    const credRoot=join(base,'credentials');
    const unit=join(credRoot,'fixture.service');
    mkdirSync(unit,{recursive:true,mode:0o700});
    const certificate=join(base,'ca.pem');
    writeFileSync(certificate,'SYNTHETIC_CA_ONLY\n',{mode:0o600});
    writeFileSync(join(unit,'relock-catalog-dsn'),JSON.stringify({
      database:'postgres',
      host:'db.xssrfshdrtdfupgqwfdw.supabase.co',
      password:'X'.repeat(64),
      port:5432,
      projectRef:'xssrfshdrtdfupgqwfdw',
      sslMode:'verify-full',
      user:'dev_gpt02_relock_catalog_auditor',
    }),{mode:0o600});
    const original=readFileSync(fileURLToPath(new URL(
      '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs',
      import.meta.url
    )),'utf8');
    const replaceExact=(input,oldText,newText)=>{
      assert.equal(input.split(oldText).length,2,'pinned source fixture marker changed');
      return input.replace(oldText,newText);
    };
    let isolated=replaceExact(original,
      "const CERT = '/etc/gpt02-dev/supabase-root-ca-2021.crt';",
      'const CERT = '+JSON.stringify(certificate)+';');
    isolated=replaceExact(isolated,
      "directory?.startsWith('/run/credentials/')",
      'directory?.startsWith('+JSON.stringify(credRoot+'/')+')');
    isolated=replaceExact(isolated,
      "require('/opt/gpt02-reader-runtime/node_modules/pg')",
      "require('./synthetic-pg.cjs')");
    const entry=join(base,'relock-simulated.mjs');
    const stub=join(base,'synthetic-pg.cjs');
    const trace=join(base,'trace.jsonl');
    writeFileSync(entry,isolated,{mode:0o600});
    writeFileSync(stub,"'use strict';\nconst fs = require('node:fs');\nconst scenario = process.env.FAKE_SCENARIO || 'success';\nfunction record(type, extras = {}) {\n  fs.appendFileSync(process.env.FAKE_TRACE, JSON.stringify({type, ...extras}) + '\\n');\n}\nclass Client {\n  constructor(config) {\n    this.config=config;\n    record('constructor', {\n      host:config.host, user:config.user, database:config.database,\n      queryTimeout:config.query_timeout,\n      statementTimeout:config.statement_timeout,\n      connectionTimeout:config.connectionTimeoutMillis,\n    });\n  }\n  async connect() {record('connect');}\n  async query(query) {\n    const sql=typeof query==='string'?query:query.text;\n    const timeout=typeof query==='string'?this.config.query_timeout:query.query_timeout;\n    let kind='unexpected';\n    if (sql.includes('session_user::text'))kind='identity';\n    else if (sql.includes('to_regprocedure'))kind='prerequisites';\n    else if (sql.includes('relock_expired_phase_a() AS count'))kind='phaseA';\n    else if (sql.includes('relock_expired_phase_b() AS count'))kind='phaseB';\n    record('query',{kind, timeout});\n    if(kind==='identity')return {rows:[{\n      actor:scenario==='wrongIdentity'?'postgres':'dev_gpt02_relock_catalog_auditor',\n      database:'postgres'\n    }]};\n    if(kind==='prerequisites')return {rows:[{phase_a:true,phase_b:true}]};\n    if(kind==='phaseA'){\n      if(scenario==='invalidA')return {rows:[{count:'2'}]};\n      return {rows:[{count:2}]};\n    }\n    if(kind==='phaseB'){\n      if(scenario==='phaseBFailure')throw new Error('Synthetic DB termination failure');\n      if(scenario==='invalidB')return {rows:[{count:-1}]};\n      return {rows:[{count:2}]};\n    }\n    throw new Error('UNEXPECTED_QUERY');\n  }\n  async end() {record('end');}\n}\nmodule.exports={Client};\n",{mode:0o600});
    const child=spawnSync(process.execPath,[entry],{
      encoding:'utf8',timeout:8000,
      env:{...process.env, APP_ENV:'development',
        CREDENTIALS_DIRECTORY:unit,
        FAKE_TRACE:trace, FAKE_SCENARIO:scenario},
    });
    assert.equal(child.error,undefined);
    const traces=readFileSync(trace,'utf8').trim().split(/\r?\n/).filter(Boolean)
      .map(line=>JSON.parse(line));
    return {child,traces};
  } finally {
    rmSync(base,{recursive:true,force:true});
  }
}

test('full supervisor query sequence uses separate bounded phase calls',()=>{
  const {child,traces}=simulateSupervisorWithFakePg('success');
  assert.equal(child.status,0);
  assert.equal(child.stderr.trim(),'');
  const out=JSON.parse(child.stdout.trim());
  assert.equal(out.phaseAWindowCount,2);
  assert.equal(out.phaseBCleanedWindowCount,2);
  assert.equal(out.connectedSessionTerminationProven,false);
  assert.equal(out.authorizationGranted,false);
  assert.equal(out.signingPermitted,false);
  assert.equal(out.dispatchPermitted,false);
  assert.equal(out.releaseDecision,'NO_GO');
  const names=traces.filter(x=>x.type==='query').map(x=>x.kind);
  assert.deepEqual(names,['identity','prerequisites','phaseA','phaseB']);
  assert.equal(traces.find(x=>x.type==='constructor').host,
    'db.xssrfshdrtdfupgqwfdw.supabase.co');
  assert.deepEqual(traces.filter(x=>x.type==='query').map(x=>x.timeout),
    [2500,2500,4500,15000]);
  assert.equal(traces.at(-1).type,'end');
});

test('Phase B database failure cannot be reported as cleanup success',()=>{
  const {child,traces}=simulateSupervisorWithFakePg('phaseBFailure');
  assert.equal(child.status,3);
  assert.equal(child.stdout.trim(),'');
  const out=JSON.parse(child.stderr.trim());
  assert.equal(out.releaseDecision,'NO_GO');
  assert.equal(out.signingPermitted,false);
  assert.equal(out.reason,'RELOCK_DATABASE_OR_CUSTODY_UNAVAILABLE');
  assert.deepEqual(traces.filter(x=>x.type==='query').map(x=>x.kind),
    ['identity','prerequisites','phaseA','phaseB']);
  assert.equal(traces.at(-1).type,'end');
});

test('malformed Phase A count is rejected before Phase B is called',()=>{
  const {child,traces}=simulateSupervisorWithFakePg('invalidA');
  assert.equal(child.status,3);
  assert.equal(child.stdout.trim(),'');
  assert.equal(JSON.parse(child.stderr.trim()).releaseDecision,'NO_GO');
  assert.deepEqual(traces.filter(x=>x.type==='query').map(x=>x.kind),
    ['identity','prerequisites','phaseA']);
  assert.equal(traces.at(-1).type,'end');
});

test('wrong native identity rejects both phases',()=>{
  const {child,traces}=simulateSupervisorWithFakePg('wrongIdentity');
  assert.equal(child.status,3);
  assert.equal(child.stdout.trim(),'');
  assert.equal(JSON.parse(child.stderr.trim()).reason,
    'RELOCK_NATIVE_DATABASE_IDENTITY_INVALID');
  assert.deepEqual(traces.filter(x=>x.type==='query').map(x=>x.kind),
    ['identity']);
  assert.equal(traces.at(-1).type,'end');
});
