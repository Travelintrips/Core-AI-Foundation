# CST-DEV — one Owner consent, stage-by-stage VPS signer permit V2

**21 November 2026: candidate source only; operational NO-GO.**
Draft Core AI PR #1769. This corrects the existing VPS design, not another
KMS, Owner click, signer key store, PROD rollout, or rebuild of PASS features.

## Root cause

The obsolete eight-role release required eight FINAL payload hashes at once,
within one 5-minute permit expiry. This is not feasible for sequential real
E2E: subscriber acknowledgement, POST QA, Core reconciliation, four agent
attestations and reviewer Final ACK depend on actual outputs from prior steps.
Fabricating future digests would falsely turn synthetic QA into real proof.

## Corrected contract: one job authorization, just-in-time technical permits

1. An independent Operations authority signs ONE job authorization for the
   original Owner-approved Company-1 CST-DEV job (job > historical #482):
   approval ID, change ID, source SHA, worker name, project, manifest hash,
   and all eight fixed Ed25519 signer public fingerprints. Max one-hour
   change window; no future payload hashes or preissued eight permits.
   An Operations signature alone does not prove the Owner DB approval.
2. For each actual stage, once independently captured payload bytes exist,
   an independent Operations custodian signs the same existing v1 permit:
   exact payload hash, signer/operator UID, role, purpose, job, approval,
   source, nonce and <=5-minute TTL. Nine technical signatures across eight
   existing signer roles, without any new Owner business clicks.
3. The existing Linux VPS signer source and crypto protocol stay unchanged:
   root-owned public pin, root-owned permit, payload byte hash, Ed25519,
   SO_PEERCRED operator identity and crash-durable one-use nonce.
   The former v1 full-batch CLI install mode now DENIES (source candidate
   only); its regression tests are retained.

## Nine stages, eight identities

| Step | Signer role | Purpose |
|---|---|---|
| 1 | qa-evidence | QA_PRE_ADMISSION |
| 2 | subscriber-ack | SUBSCRIBER_DELIVERY_ACK |
| 3 | qa-evidence | QA_POST_EXECUTION |
| 4 | core-reconciliation | CORE_RECONCILIATION |
| 5 | agent-coding | HUB_AGENT_CODING |
| 6 | agent-infrastructure | HUB_AGENT_INFRASTRUCTURE |
| 7 | agent-security | HUB_AGENT_SECURITY |
| 8 | agent-qa | HUB_AGENT_QA |
| 9 | reviewer | HUB_REVIEWER_FINAL_ACK |

QA is used twice: the second permit has its own exact payload and nonce and
may replace the old root-owned QA role file only after the first nonce was
recorded as consumed in the existing systemd durable signer ledger. That
record only proves the signer emitted a signature, not correct QA work.
Actual agent execution order and Final ACK require the existing independent
Hub receipts/reviewer verifier, NOT these stage permits alone.

## Candidate source and host paths

- deploy/cst-onejob-vps/cst_onejob_stage_release_v2.py verifies signed
  job authorization and exact per-stage permit by reusing the existing
  signer.validate_permit implementation.
- deploy/cst-onejob-vps/install_staged_release_v2.py exposes --read-only,
  --install-approved-job and --install-stage STAGE, using fixed root-owned
  files under /etc/cst-onejob-dev. Job installation writes ONLY public
  pins and signed authorization; stage installation consumes independently
  captured stage bytes and writes one role permit. No role login, service
  activation, DB mutation, dispatch or PROD code exists in the installer.
- scripts/dev/cst-onejob-operations-broker-release.mjs validates the same
  signed one-job authorization using byte-identical Python canonical JSON.
  scripts/dev/cst-onejob-trusted-admission-bridge.mjs binds signed PRE QA to
  the original job approval before attempting any database SQL.
- deploy/cst-onejob-vps/install_approved_release_batch.py retains read-only
  and isolated signature tests, but its deprecated v1 CLI installation
  path rejects any activation.

Root-owned incoming bytes alone do not establish independent source
provenance. External QA must validate them before Operations signing.

## Fail closed until independent authority exists

APPROVED_OPERATIONS_ROOT_FINGERPRINT remains None in Python and
APPROVED_OPS_ROOT_FINGERPRINT remains null in JS: no real public root is
approved or pinned. Genuine Operations key/signatures and an authenticated
Owner DB approval are absent. No self-signing, test key, environment flag,
root-owned placeholder, Google KMS, or direct table GRANT substitutes for
that authority. VPS is one shared-root failure domain; physical custody
independence is not proven by a local root-owned file.

The existing PostgreSQL admission capability remains REVIEW-ONLY, no
dedicated service LOGIN is enabled, and signer systemd units are OFF.
Before a controlled DEV rollout, Security/Operations must independently
approve the real root and exact source pins, signer/operator custody, and
reviewed admission capability, then validate genuine PRE QA, one job,
subscriber, four agent work records, Final ACK and relock. PROD untouched.

## Source-only evidence on disposable fixtures

- Staged Python v2 suite 11/11 PASS: nine sequential dynamic payloads;
  wrong signer/root/role/UID/source/nonce/expiry; QA second permit;
  root-custody missing; temp stage install/replay denial; v1 CLI denied.
- Original importer + nonce durability regression 20/20 PASS.
- JS broker + Operations verifier 15/15 PASS, including Python byte parity.
- VPS v2 --read-only: AWAITING_INDEPENDENT_AUTHORITY, rootPinned=false,
  stagePermitsIssued=0, releaseDecision=NO_GO.
- Signer private keys, DEV/PROD services, database credentials untouched.

**Synthetic source PASS does NOT constitute live Owner E2E or Final ACK.**


## Super Admin-only human authority (21 Nov 2026)

User decision: **Super Admin is the only human approver**. In the existing
Core AI internal-users schema, the one-job stage maps the privileged Super
Admin session to existing database role owner (not generic admin).
One authenticated click authorizes a single Company-1 WAITING job.
No extra human Security/Operations reviewer or second approval is required.

The actual Operations root signature, independently captured QA, per-stage
actual-payload technical signatures, and Hub reviewer evidence are still
required because a role name cannot replace cryptographic verification.
Those are programmatic separation-of-duties checks, not extra people.
Do not claim that one shared VPS root provides independent hardware
custody. See cst-onejob-single-super-admin-authority-20261121.md.

## Real one-click source binding (21 November 2026)

The dormant VPS Operations candidate has public fingerprint
65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b.
A single authenticated Core Super Admin click chooses it together with
one Company-1 WAITING job, and records the fingerprint in an immutable
transactional audit. The separate source pin APPROVED_OPERATIONS_ROOT_FINGERPRINT
is still None/NULL. No signed job authorization exists before a real job ID
and Owner approval ID. After actual signed QA PRE and independently checked
DB/audit readback exist, per-stage technical permits can be evaluated, not
preissued. No KMS, second person, self-approval or synthetic evidence.
