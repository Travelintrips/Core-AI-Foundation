#!/usr/bin/env node
/**
 * Synthetic CRYPTO -> SCOPED DB WRITER -> ATOMIC NONCE+BINDING contract.
 * No network, no external signer, no DEV/PROD DB, no real approval or dispatch.
 * This is NOT a trusted runtime issuer or an attestation authority.
 */
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,randomUUID,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {attestationCanonicalBytes,verifyOfflineBindingAttestation} from './gpt02-binding-attestation-verifier.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const id='gpt02-crypto-atomic-'+process.pid;
const docker=(args,input,allowed=[0])=>{
 const p=spawnSync('docker',args,{encoding:'utf8',input,timeout:45000,maxBuffer:2*1024*1024});
 if(!allowed.includes(p.status))throw Error('SANDBOX_COMMAND_FAILED:'+args.slice(0,2).join(' ')+':'+String(p.stderr).slice(-360));
 return p;
};
const sql=(query,allowed=[0])=>docker(['exec','-i',id,'psql','-X','-v','ON_ERROR_STOP=1','-qAt','-U','postgres','-d','sandbox'],query,allowed);
const u=(x)=>"'"+x+"'";
const {publicKey,privateKey}=generateKeyPairSync('ed25519'); // memory-only sandbox key
const pub=publicKey.export({format:'der',type:'spki'}).toString('base64');
const now=Date.now();
const commandId=randomUUID(),receiverJobId=randomUUID(),attemptId=randomUUID();
const coreTaskId=randomUUID(),nonce=randomUUID();
const payload={
 attestationVersion:1,commandId,receiverJobId,attemptId,tenantId:'default',
 evidenceSha256:createHash('sha256').update('synthetic:cross-ledger:observations').digest('hex'),
 operatorUserId:301,issuedAt:new Date(now-2000).toISOString(),
 expiresAt:new Date(now+90000).toISOString(),nonce,
};
const signed=(p)=>({payload:p,signatureBase64:sign(null,attestationCanonicalBytes(p),privateKey).toString('base64')});
const expected={commandId,receiverJobId,attemptId,evidenceSha256:payload.evidenceSha256,
 operatorUserId:301,now,nonceUnused:true,trustedPublicKeyDerBase64:pub};
const row=(evidence,p)=>`
BEGIN;
SET LOCAL ROLE synthetic_claim_writer;
INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces
 (nonce,tenant_id,core_command_id,hub_execution_job_id,attempt_id,operator_user_id,
 evidence_sha256,attestation_sha256,issued_at,expires_at)
VALUES
 (${u(p.nonce)},'default',${u(p.commandId)},${u(p.receiverJobId)},${u(p.attemptId)},301,
 ${u(p.evidenceSha256)},${u(evidence)},${u(p.issuedAt)}::timestamptz,${u(p.expiresAt)}::timestamptz);
INSERT INTO ai_platform.dev_gpt02_task_attempt_binding_claims
 (id,tenant_id,core_command_id,core_coding_task_id,hub_execution_job_id,hub_ai_task_id,
 attempt_id,attempt_number,worker_id,assignee_namespace,assignee_id,owner_namespace,
 accountable_owner_id,evidence_sha256,evidence_source,operator_user_id,recorded_by,
 source_observed_at,receiver_observed_at)
VALUES
 (${u(randomUUID())},'default',${u(p.commandId)},${u(coreTaskId)},${u(p.receiverJobId)},135,
 ${u(p.attemptId)},1,'openclaw-dell-chatgpt-wake-dev',
 'ai_task_hub.public.ai_tasks.assigned_to_id',7,'ai_task_hub.accountable_owner',
 'synthetic-owner',${u(p.evidenceSha256)},'independent_dev_attestation',301,'internal:301',
 clock_timestamp(),clock_timestamp());
COMMIT;
`;
const state=()=>sql(`SET ROLE synthetic_readback;
SELECT (SELECT count(*) FROM ai_platform.dev_gpt02_binding_attestation_nonces),
(SELECT count(*) FROM ai_platform.dev_gpt02_task_attempt_binding_claims),
(SELECT bool_and(may_dispatch_worker=false AND may_issue_grant=false)
 FROM ai_platform.dev_gpt02_binding_attestation_nonces),
(SELECT bool_and(binding_verified=false AND may_dispatch_worker=false AND may_close_job=false)
 FROM ai_platform.dev_gpt02_task_attempt_binding_claims);`).stdout.trim().split('\n').at(-1);
try {
 docker(['run','-d','--network','none','--name',id,'--tmpfs','/var/lib/postgresql/data:rw,size=256m',
  '--shm-size','64m','-e','POSTGRES_PASSWORD=synthetic','-e','POSTGRES_DB=sandbox','postgres:16-alpine']);
 let ready=false;
 for(let i=0;i<45;i++){
  if(docker(['exec',id,'psql','-X','-qAt','-U','postgres','-d','sandbox','-c','SELECT 1'],undefined,[0,1,2]).stdout.trim()==='1'){ready=true;break;}
  // deterministic synchronous bounded sleep without Node timers / host networking
  spawnSync('sleep',['0.3']);
 }
 assert.ok(ready,'SANDBOX_DB_NOT_READY');
 for(const p of ['docs/dev/gpt02-task-attempt-binding.proposed.sql',
   'docs/dev/gpt02-binding-attestation-nonces.proposed.sql'])
  sql(readFileSync(resolve(root,p),'utf8'));
 sql(`
 CREATE ROLE synthetic_claim_writer NOLOGIN;
 CREATE ROLE synthetic_readback NOLOGIN;
 GRANT USAGE ON SCHEMA ai_platform TO synthetic_claim_writer,synthetic_readback;
 GRANT INSERT ON ai_platform.dev_gpt02_binding_attestation_nonces,
  ai_platform.dev_gpt02_task_attempt_binding_claims TO synthetic_claim_writer;
 GRANT SELECT ON ai_platform.dev_gpt02_binding_attestation_nonces,
  ai_platform.dev_gpt02_task_attempt_binding_claims TO synthetic_readback;
 `);
 const submit=(proof,ctx)=>{
  const v=verifyOfflineBindingAttestation(proof,ctx);
  if(!v.signatureValid)return {accepted:false,reason:v.reason};
  const hash=createHash('sha256').update(proof.signatureBase64).digest('hex');
  const stored=sql(row(hash,proof.payload),[0,1,2,3]);
  return {accepted:stored.status===0,reason:stored.status===0?'SYNTHETIC_STORED':String(stored.stderr).slice(-200)};
 };
 const original=signed(payload);
 assert.equal(submit(original,expected).accepted,true);
 assert.equal(state(),'1|1|t|t','POST_COMMIT_RELATIONAL_READBACK_MISMATCH');
 console.log('CRYPTO_SIGNATURE_AND_ATOMIC_BINDING_WRITE_PASS');
 const replay=submit(original,expected);
 assert.equal(replay.accepted,false,'NONCE_REPLAY_MUST_DENY');
 assert.equal(state(),'1|1|t|t');
 console.log('NONCE_REPLAY_DENIED_PASS');
 const tampered={...payload,evidenceSha256:'0'.repeat(64)};
 assert.equal(submit({...original,payload:tampered},expected).accepted,false);
 assert.equal(submit(original,{...expected,operatorUserId:302}).accepted,false);
 assert.equal(submit(original,{...expected,nonceUnused:false}).accepted,false);
 assert.equal(submit(original,{...expected,trustedPublicKeyDerBase64:
  generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64')}).accepted,false);
 assert.equal(state(),'1|1|t|t');
 console.log('TAMPER_ROLE_NONCE_KEY_FAIL_CLOSED_PASS');
 // A new valid signature may not duplicate the same attempt even with a new nonce.
 const other={...payload,nonce:randomUUID()};
 assert.equal(submit(signed(other),expected).accepted,false);
 assert.equal(state(),'1|1|t|t');
 console.log('ATTEMPT_REPLAY_ATOMIC_ROLLBACK_PASS');
 const denied=sql(`SET ROLE synthetic_readback;
 INSERT INTO ai_platform.dev_gpt02_binding_attestation_nonces(nonce)
 VALUES(gen_random_uuid());`,[0,1,2,3]);
 assert.notEqual(denied.status,0,'READ_ONLY_ROLE_MUST_NOT_WRITE');
 assert.match(denied.stderr,/permission denied/);
 assert.equal(state(),'1|1|t|t');
 console.log('READER_WRITE_DENIED_PASS');
 console.log('SYNTHETIC_CRYPTO_ATOMIC_CLAIM_5_OF_5_PASS_NO_RUNTIME_AUTHORITY');
}finally{
 docker(['rm','-f',id],undefined,[0,1]);
}
