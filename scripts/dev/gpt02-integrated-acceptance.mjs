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
