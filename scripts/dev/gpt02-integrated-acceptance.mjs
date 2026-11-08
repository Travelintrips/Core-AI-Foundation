#!/usr/bin/env node
/**
 * GPT02 integration release acceptance, fail closed by default.
 * This reports both test-gate health and whether real end-to-end activation
 * could be authorized. CI expects test-gate PASS and release NO-GO until
 * separately evidenced real service/credentials/issuer/worker E2E exist.
 *
 * This script performs no DB access, deployments, credentials or worker calls.
 */
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const file=(name)=>readFileSync(resolve(root,name),'utf8');
const check=(id,reason,ok)=>({id,reason,ok:!!ok});
const gates=[
 check('REVIEW_API_FAIL_CLOSED','Signing HTTP route rejects unavailable trusted writer',
  file('artifacts/api-server/src/routes/dev-resume-operator-review.ts').includes('if(!isTrustedDevReviewWriterReady())')),
 check('PERSISTENCE_FAIL_CLOSED','Direct persistence invocation independently rejects unready writer',
  file('artifacts/api-server/src/services/jobLifecycleOperatorReviewPersistence.ts').includes('if(!isTrustedDevReviewWriterReady())')),
 check('WRITER_NOT_ACTIVATABLE','Actual readiness remains disabled even if signing flag is true',
  /export function isTrustedDevReviewWriterReady\(\):false\s*\{\s*return false;\s*\}/.test(file('artifacts/api-server/src/services/jobLifecycleReviewWriterReadiness.ts'))),
 check('REVIEW_RFC_NOT_DEPLOYABLE','Unsigned SQL migration unconditionally throws before any grant',
  /BEGIN;\s*(?:--[^\n]*\n\s*)+DO \$rfc_disabled\$/.test(file('docs/dev/gpt02-review-writer-rfc.proposed.sql')) &&
  file('docs/dev/gpt02-review-writer-rfc.proposed.sql').includes('GPT02_REVIEW_WRITER_RFC_UNSAFE_NOT_DEPLOYABLE')),
 check('CLAIM_RFC_NOT_DEPLOYABLE','Claim SQL denies dispatch until transactional authorization exists',
  file('docs/dev/gpt02-atomic-resume-claim.proposed.sql').includes('RESUME_DISPATCH_GUARD_NOT_IMPLEMENTED')),
 check('NO_FREEFORM_WRITER_RPC','Proposed verifier contract accepts proof only',
  file('artifacts/api-server/src/services/jobLifecycleReviewWriterServiceContract.ts').includes('Object.keys(request).sort().join(",")!=="proof"')),
 check('PRIVATE_TEST_ENV','Subprocess does not inherit parent secrets',
  !file('artifacts/api-server/src/scripts/devReviewProofIsolatedHarness.ts').includes('...process.env') &&
  file('artifacts/api-server/src/scripts/devReviewIsolatedVerifierChild.ts').includes('forbiddenParentEnv')),
 check('SIGNED_REVIEW_CONTRACT','Real Ed25519 verifier is invoked before test adapter',
  file('artifacts/api-server/src/services/jobLifecycleReviewWriterServiceContract.ts').indexOf('verifyOperatorApprovalProof(') <
  file('artifacts/api-server/src/services/jobLifecycleReviewWriterServiceContract.ts').indexOf('await dependencies.verifiedWriterAdapter(')),
 check('SYNTHETIC_DB_EVIDENCE','Isolated PostgreSQL negative tests exist',
  existsSync(resolve(root,'scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh'))),
 check('LEASE_RACE_CONTRACT','Isolated claim race/replay/fencing tests exist',
  existsSync(resolve(root,'scripts/dev/test-gpt02-resume-isolated-postgres.sh'))),
 check('GRANT_ISSUANCE_CONTRACT','Isolated grant issuance test exists',
  existsSync(resolve(root,'scripts/dev/test-gpt02-issuance-isolated-postgres.sh'))),
 check('ATTESTOR_TIME_BOUNDED_MAC','Synthetic MAC is bound to proof digest, audit ID, and short validity window',
  file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').includes('id+":"+digest+":"+epoch') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('TIME-BOUNDED MAC STALE AND FUTURE DENIED PASS')),
 check('ATTESTOR_MAC_SECOND_FACTOR_PROTOTYPE','Attestor SQL requires a separate keyed MAC, not only a DB login or audit digest',
  file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').includes('createHmac("sha256"') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('public.hmac(') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('PRE-ATTESTATION STOLEN CREDENTIAL WITHOUT MAC DENIED PASS') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('ATTESTATION MAC KEY NONDISCLOSURE BY ALL LOGINS PASS')),
 check('LEAST_PRIVILEGE_ATTESTOR_READBACK','Attestor readback uses scoped non-superuser audit reader and single snapshot',
  file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').includes('audit_reader_login') &&
  !file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').includes('"-U","postgres"') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('NON-SUPERUSER LEAST-PRIVILEGE AUDIT READER PASS')),
 check('INDEPENDENT_ATTESTOR_SUBPROCESS','A separate child independently reads audit, verifies Ed25519 before attestor SQL and denies forged audit',
  file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').includes('verifyOperatorApprovalProof({') &&
  file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').indexOf('verifyOperatorApprovalProof({') <
    file('artifacts/api-server/src/scripts/devReviewAttestorChild.ts').indexOf('attest_review(') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('INDEPENDENT PROCESS FORGED AUDIT ATTESTATION DENIED PASS')),
 check('CRYPTO_ATTESTATION_CHAIN_PROTOTYPE','Persisted audit Ed25519 reverified before separate role attestation and grant',
  file('artifacts/api-server/src/scripts/devReviewAuditProofCheck.ts').includes('verifyOperatorApprovalProof(') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('devReviewAuditProofCheck.ts') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('FORGED PERSISTED AUDIT ED25519 DENIED PASS') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('FORGED AUDIT ISSUANCE AND SELF-ATTESTATION DENIED PASS')),
 check('SAME_DATABASE_CHAIN_PROTOTYPE','One disposable PostgreSQL tests review audit to grant to single-winner fenced lease',
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('SAME-DB REVIEW AUDIT TO ONE-SHOT GRANT PASS') &&
  file('scripts/dev/test-gpt02-review-evidence-fencing-isolated-postgres.sh').includes('SAME-DB SINGLE WINNER LEASE AND FENCED RESULT PASS')),
 check('DEV_NONCE_BINDING_ATOMICITY_INERT','One-shot nonce and binding commit together, without authorization authority',
  file('docs/dev/gpt02-binding-attestation-nonces.proposed.sql').includes('may_dispatch_worker boolean NOT NULL DEFAULT false CHECK (may_dispatch_worker=false)') &&
  file('docs/dev/gpt02-binding-attestation-nonces.proposed.sql').includes('dev_gpt02_nonce_attempt_once UNIQUE(attempt_id)') &&
  file('scripts/dev/test-gpt02-binding-nonce-atomic-isolated-postgres.sh').includes('ATOMIC_NONCE_AND_BINDING_SINGLE_WINNER_PASS') &&
  file('scripts/dev/test-gpt02-binding-nonce-atomic-isolated-postgres.sh').includes('FAILED_BINDING_ROLLS_BACK_NONCE_PASS')),
 check('DEV_BINDING_CRYPTO_EVIDENCE_NOT_AUTHORITY','Signed binding proof cannot become grant, writer or dispatch authorization',
  file('scripts/dev/gpt02-binding-attestation-verifier.mjs').includes('VALID_SIGNATURE_BUT_NO_INDEPENDENT_RUNTIME_ATTESTOR') &&
  file('scripts/dev/gpt02-binding-attestation-verifier.mjs').includes('independentAttestationVerified:false') &&
  file('scripts/dev/gpt02-binding-attestation-verifier.test.mjs').includes('wrong key or edited payload fails')),
 check('DEV_BINDING_WRITER_FAIL_CLOSED','Binding writer preview cannot persist without independent attestor and session',
  file('scripts/dev/gpt02-binding-writer-preflight.mjs').includes('authorizedWriterReady=false') &&
  file('scripts/dev/gpt02-binding-writer-preflight.mjs').includes('independentAttestationVerified=false') &&
  file('scripts/dev/gpt02-binding-writer-preflight.mjs').includes('mayPersistBinding:false') &&
  file('scripts/dev/test-gpt02-task-attempt-binding-isolated-postgres.sh').includes('CONCURRENT_ONE_WINNER_ONE_DUPLICATE_DENIED_PASS')),
 check('DEV_BINDING_SCHEMA_DRIFT_GUARD','Independent catalog inspection rejects altered schema, trigger, grants and function spoofing',
  file('scripts/dev/gpt02-task-binding-schema-drift-guard.sql').includes('GPT02_BINDING_SCHEMA_DRIFT_GUARD_PASS') &&
  file('scripts/dev/gpt02-task-binding-schema-drift-guard.sql').includes('GPT02_BINDING_UNAUTHORIZED_WRITE_GRANT_DRIFT') &&
  file('scripts/dev/test-gpt02-task-attempt-binding-isolated-postgres.sh').includes('FUNCTION_COMMENT_SPOOF') &&
  file('scripts/dev/test-gpt02-task-attempt-binding-isolated-postgres.sh').includes('GPT02_DRIFT_PATCH_APPLIED')),
 check('DEV_BINDING_CLAIM_PROTOTYPE_INERT','Proposed task-attempt binding has strict uniqueness and cannot authorize execution',
  file('docs/dev/gpt02-task-attempt-binding.proposed.sql').includes('binding_verified boolean NOT NULL DEFAULT false CHECK (binding_verified=false)') &&
  file('docs/dev/gpt02-task-attempt-binding.proposed.sql').includes('may_dispatch_worker boolean NOT NULL DEFAULT false CHECK (may_dispatch_worker=false)') &&
  file('docs/dev/gpt02-task-attempt-binding.proposed.sql').includes('claim_attempt_once UNIQUE(attempt_id)') &&
  file('scripts/dev/test-gpt02-task-attempt-binding-isolated-postgres.sh').includes('DISPOSABLE_POSTGRES_BINDING_TEST_PASS')),
 check('DEV_TASK_NAMESPACE_AND_OWNERSHIP_GUARD','Core UUID tasks and AI Task integer tasks cannot prove ownership from matching values',
  file('scripts/dev/gpt02-task-lineage-ownership.mjs').includes('taskBindingVerified=false') &&
  file('scripts/dev/gpt02-task-lineage-ownership.mjs').includes('accountableOwnerVerified=false') &&
  file('scripts/dev/gpt02-task-lineage-ownership.test.mjs').includes('cannot self-certify cross-system linkage')),
 check('DEV_CROSS_LEDGER_LIVE_READONLY_ANALYZER','Independent DEV source and receiver snapshots cannot assert owner, ACK or completion',
  file('scripts/dev/gpt02-cross-ledger-readonly-evidence.mjs').includes("releaseDecision:'NO_GO'") &&
  file('scripts/dev/gpt02-cross-ledger-readonly-evidence.mjs').includes('ownerAndAssigneeVerified:false') &&
  file('scripts/dev/gpt02-cross-ledger-readonly-evidence.test.mjs').includes('failed command correlation does not authorize')),
 check('DEV_RECEIVER_PASSIVE_ORIGIN_REQUIRED','Receiver must explicitly attest passive ledger provenance, not an active execution record',
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('RECEIVER_NOT_PASSIVE_LEDGER') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('row["passiveLedger"]!==true') &&
  file('artifacts/api-server/src/services/__tests__/jobLifecycleAiTaskReadback.test.ts').includes('non-passive or omitted provenance')),
 check('DEV_RECEIVER_BOUNDED_JSON_STREAM','DEV ledger readback bounds streamed payload to 32 KiB and requires JSON',
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('MAX_LEDGER_BYTES=32*1024') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('response.body.getReader()') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('"Cache-Control":"no-store"') &&
  file('artifacts/api-server/src/services/__tests__/jobLifecycleAiTaskReadback.test.ts').includes('oversized, invalid-type, truncated and malformed')),
 check('DEV_RECEIVER_WORKER_CORRELATION','Passive receiver worker assignment mismatch cannot be mistaken for GPT02 worker evidence',
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('RECEIVER_WORKER_CORRELATION_MISMATCH') &&
  file('artifacts/api-server/src/services/__tests__/jobLifecycleAiTaskReadback.test.ts').includes('wrong worker attribution fails')),
 check('DEV_RECEIVER_CANNOT_CLAIM_EXECUTION_AUTHORITY','AI Task receiver is accepted only when explicit execution/grant/dispatch flags all deny authority',
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('RECEIVER_AUTHORITY_CONTRACT_MISMATCH') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('row["verifiedExecution"]!==false') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('row["mayIssueGrant"]!==false') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('row["mayDispatchWorker"]!==false')),
 check('DEV_AI_TASK_RECEIVER_READBACK_OPT_IN','AI Task bridge receiver GET is DEV-only, exact identity matched and cannot grant',
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('AI_TASK_LEDGER_READBACK_ENABLED') &&
  file('artifacts/api-server/src/services/jobLifecycleAiTaskReadback.ts').includes('RECEIVER_CORRELATION_MISMATCH') &&
  file('artifacts/api-server/src/services/jobLifecycleDevEvidenceSummary.ts').includes('releaseDecision:"NO_GO"')),
 check('AUTHENTICATED_DEV_EVIDENCE_SUMMARY','Real read-only DEV command evidence endpoint uses internal operator authentication and cannot grant',
  file('artifacts/api-server/src/routes/dev-resume-operator-review.ts').includes('/evidence-summary') &&
  file('artifacts/api-server/src/routes/dev-resume-operator-review.ts').includes('getDevCommandEvidenceSummary(commandId)') &&
  file('artifacts/api-server/src/services/jobLifecycleDevEvidenceSummary.ts').includes('getDevCommandRecoveryReview(commandId)') &&
  file('artifacts/api-server/src/services/jobLifecycleDevEvidenceSummary.ts').includes('releaseDecision:"NO_GO"')),
 check('REAL_DEV_EVIDENCE_CANNOT_BE_SELF_ATTESTED','Separate DEV E2E gate rejects self-authored approval and requires independent readback',
  file('scripts/dev/gpt02-live-evidence-gate.mjs').includes("'INDEPENDENT_LIVE_VERIFIER_NOT_IMPLEMENTED'") &&
  file('scripts/dev/gpt02-live-evidence-gate.mjs').includes("releaseDecision:'NO_GO'") &&
  file('scripts/dev/gpt02-live-evidence-gate.test.mjs').includes('self-attested success')),
 check('API_NO_GRANT_ESCALATION','Review contract cannot issue grant or dispatch work',
  file('artifacts/api-server/src/services/jobLifecycleReviewWriterServiceContract.ts').includes('mayIssueGrant:false') &&
  file('artifacts/api-server/src/services/jobLifecycleReviewWriterServiceContract.ts').includes('mayDispatchWorker:false')),
];
const blockers=[
 {id:'P0_TRUSTED_WRITER',reason:'Dedicated authenticated, tamper-resistant writer service and credential custody not deployed or verified'},
 {id:'P0_REAL_DB_TRANSACTION',reason:'Live schema-bound atomic command/evidence/ACK/BLOCKER checks and audit not proven on DEV'},
 {id:'P0_HUMAN_AUTH',reason:'Owner/admin approval attribution and signed operator session need independent E2E security review'},
 {id:'P0_GRANT_ISSUER',reason:'Authenticated grant issuance and claim procedure remain deliberately inert'},
 {id:'P0_FENCED_WORKER',reason:'Real worker native ACK, unique lease, retry/429 gates and fenced completion not proven'},
 {id:'P0_MONITORING',reason:'AI Task Center owner/progress/blocker timeline E2E correlation not verified'},
 {id:'P0_DEV_ACCEPTANCE',reason:'Real DEV deployment/readback and rollback rehearsal not executed'},
 {id:'P0_PROD_PROMOTION',reason:'PROD remains forbidden until audited DEV acceptance and explicit approval'},
];
const result={
 scope:'PR1660_SOURCE_AUDIT_ONLY',checkedAt:'2026-11-08',
 testGate: gates.every(x=>x.ok)?'PASS':'FAIL',
 releaseDecision:'NO_GO',
 noLiveChanges:true,
 checks:gates,
 unresolvedBlockers:blockers,
};
if(process.argv.includes('--json'))process.stdout.write(JSON.stringify(result,null,2)+'\n');
else{
 console.log('GPT02 INTEGRATED ACCEPTANCE — TEST GATE '+result.testGate+' / RELEASE '+result.releaseDecision);
 for(const item of gates)console.log((item.ok?'PASS ':'FAIL ')+item.id+' — '+item.reason);
 for(const b of blockers)console.log('BLOCKED '+b.id+' — '+b.reason);
}
if(result.testGate!=='PASS')process.exitCode=1;
if(process.argv.includes('--require-release-ready'))process.exitCode=2;
