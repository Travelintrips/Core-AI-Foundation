import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runCleanupPhases,cleanupEvidence,RELOCK_TERMINATION_BUDGET} from '../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs';

const W_A = 'SELECT gpt02_relock_audit.relock_expired_phase_a() AS count';
const W_B = 'SELECT gpt02_relock_audit.relock_expired_phase_b() AS count';
const R_A = 'SELECT gpt02_relock_audit.relock_reader_phase_a() AS count';
const R_B = 'SELECT gpt02_relock_audit.relock_reader_phase_b() AS count';

class FakePG {
  constructor({reader=true,fail=null,count=0,writer=true}={}) {
    this.reader=reader;
    this.writer=writer;
    this.fail=fail;
    this.count=count;
    this.events=[];
    this.options=[];
  }
  async query(spec) {
    const sql=typeof spec==='string'?spec:spec.text;
    this.events.push(sql);
    this.options.push(spec);
    if (this.fail === sql) throw new Error('RELOCK_SYNTHETIC_QUERY_FAILED');
    if (sql.includes("to_regprocedure('gpt02_relock_audit.relock_expired_phase_a()')")) {
      return {rows:[{phase_a:this.writer,phase_b:this.writer}]};
    }
    if (sql.includes("to_regprocedure('gpt02_relock_audit.relock_reader_phase_a()')")) {
      return {rows:[{phase_a:this.reader,phase_b:this.reader}]};
    }
    if (![W_A,W_B,R_A,R_B].includes(sql)) throw new Error('UNEXPECTED_SQL');
    return {rows:[{count:this.count}]};
  }
}

test('one timer handles historical writer and new scoped reader in strictly committed phase order',async()=>{
  const pg=new FakePG();
  assert.deepEqual(await runCleanupPhases(pg),{
    readerInstalled:true,
    writerCounts:{phaseAWindowCount:0,phaseBCleanedWindowCount:0},
    readerCounts:{phaseAWindowCount:0,phaseBCleanedWindowCount:0},
  });
  const timeoutQueries=pg.options.filter(x=>typeof x==='object');
  assert.deepEqual(timeoutQueries.map(x=>x.query_timeout),[4500,15000,4500,15000]);
  assert.deepEqual(pg.events.filter(s=>[W_A,W_B,R_A,R_B].includes(s)),[W_A,W_B,R_A,R_B]);
});

test('no new reader functions does not interrupt original writer cleanup',async()=>{
  const pg=new FakePG({reader:false});
  assert.deepEqual(await runCleanupPhases(pg),{
    readerInstalled:false,
    writerCounts:{phaseAWindowCount:0,phaseBCleanedWindowCount:0},
    readerCounts:null,
  });
  assert.deepEqual(pg.events.filter(s=>[W_A,W_B,R_A,R_B].includes(s)),[W_A,W_B]);
});

test('missing a writer function denies immediately; no scoped cleanup is claimed',async()=>{
  const pg=new FakePG({writer:false});
  await assert.rejects(runCleanupPhases(pg),/RELOCK_PHASE_FUNCTIONS_NOT_INSTALLED/);
  assert.equal(pg.events.some(s=>s===R_A||s===W_A),false);
});

test('partially installed reader functions fail closed after preserving writer relock',async()=>{
  const pg=new FakePG();
  pg.query=async function(spec){
    const sql=typeof spec==='string'?spec:spec.text;
    this.events.push(sql);
    if(sql.includes("to_regprocedure('gpt02_relock_audit.relock_expired_phase_a()')"))
      return {rows:[{phase_a:true,phase_b:true}]};
    if(sql.includes("to_regprocedure('gpt02_relock_audit.relock_reader_phase_a()')"))
      return {rows:[{phase_a:true,phase_b:false}]};
    return {rows:[{count:0}]};
  };
  await assert.rejects(runCleanupPhases(pg),/RELOCK_READER_PARTIAL_INSTALL_DENIED/);
  assert.deepEqual(pg.events.filter(s=>[W_A,W_B,R_A,R_B].includes(s)),[W_A,W_B]);
});

test('a failing writer phase cannot starve independently approved scoped relock',async()=>{
  const pg=new FakePG({fail:W_A});
  await assert.rejects(runCleanupPhases(pg),/RELOCK_SYNTHETIC_QUERY_FAILED/);
  assert.equal(pg.events.includes(W_B),false); // must not run B without committed A
  assert.deepEqual(pg.events.filter(s=>[R_A,R_B].includes(s)),[R_A,R_B]);
});

test('a failing scoped Phase A never launches Phase B or claims cleanup',async()=>{
  const pg=new FakePG({fail:R_A});
  await assert.rejects(runCleanupPhases(pg),/RELOCK_SYNTHETIC_QUERY_FAILED/);
  assert.equal(pg.events.includes(R_B),false);
  assert.deepEqual(pg.events.filter(s=>[W_A,W_B].includes(s)),[W_A,W_B]);
});

test('invalid cleanup row shape/count does not become a positive result',async()=>{
  for(const count of ['1',-1,1001,null]){
    const pg=new FakePG({count});
    await assert.rejects(runCleanupPhases(pg),/RELOCK_WRITER_A_RESULT_NOT_BOUNDED_INTEGER/);
    assert.equal(pg.events.includes(W_B),false);
  }
});

test('relock unit stays one bounded, encrypted-custody, disabled-by-default service',()=>{
  const root=new URL('../../deploy/ai-coding-standalone-dev/',import.meta.url);
  const unit=readFileSync(new URL('gpt02-issue159-relock-catalog-auditor.service',root),'utf8');
  const timer=readFileSync(new URL('gpt02-issue159-relock-catalog-auditor.timer',root),'utf8');
  assert.match(unit,/^LoadCredentialEncrypted=relock-catalog-dsn:/m);
  assert.match(unit,/^DynamicUser=yes$/m);
  assert.match(unit,/^TimeoutStartSec=45s$/m);
  assert.doesNotMatch(unit,/^\[Install\]$/m);
  assert.match(timer,/^OnUnitInactiveSec=5s$/m);
  assert.doesNotMatch(unit,/^EnvironmentFile=/m);
});

test('source-only cleanup never becomes a signer, credential issuer or dispatch route',()=>{
  const url=new URL('../../deploy/ai-coding-standalone-dev/gpt02_issue159_relock_catalog_supervisor.mjs',import.meta.url);
  const source=readFileSync(url,'utf8');
  for(const forbidden of ['ALTER ROLE ','CREATE ROLE ','DELETE FROM ','INSERT INTO ','dispatchWorker(', 'authorizationGranted: true','dispatchPermitted: true']){
    assert.equal(source.includes(forbidden),false,forbidden);
  }
  assert.match(source,/releaseDecision: 'NO_GO'/);
});

// Preserve the stronger timeout/custody budget already installed on VPS
// rather than accidentally replacing it with short test fixture defaults.
test('deployed writer cleanup evidence and timeout budget remain intact',()=>{
  assert.deepEqual(RELOCK_TERMINATION_BUDGET,{
    roleSlots:3,perBackendWaitMs:3000,connectionTimeoutMs:4000,
    preflightQueryTimeoutMs:2500,phaseAQueryTimeoutMs:4500,
    statementTimeoutMs:12000,queryTimeoutMs:15000,
    systemdStartTimeoutMs:45000,
  });
  const evidence=cleanupEvidence(1,1);
  assert.equal(evidence.phaseAWindowCount,1);
  assert.equal(evidence.phaseBCleanedWindowCount,1);
  assert.equal(evidence.connectedSessionTerminationProven,false);
  assert.equal(evidence.authorizationGranted,false);
  assert.equal(evidence.signingPermitted,false);
  assert.equal(evidence.dispatchPermitted,false);
  assert.equal(evidence.releaseDecision,'NO_GO');
});
