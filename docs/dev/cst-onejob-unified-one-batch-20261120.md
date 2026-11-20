# CST-DEV One-Job — Unified single-batch candidate (20 November 2026)

**Scope:** Supabase CST-DEV `xssrfshdrtdfupgqwfdw`, Company 1, one NEW qwen2.5:3b job. **Release: NO_GO** until real E2E proof. **Historical #482: read-only; no replay. PROD excluded.**

## One canonical business action

- Reuse **one** Owner login session and **one explicit confirmation** through `POST /ai/dev/onejob/owner-approve-and-stage`, subject to existing active-Owner DB readback, same-origin HTTPS, signed numeric-identity JWT issued within 20 minutes, an exact intent, and disabled dispatch.
- The dedicated, bounded writer creates one `WAITING` job, one approval ledger entry, and one audit **atomically**. The Company-1 partial unique index forbids a second active approval; the pilot request index forbids duplicate request IDs.
- Owner business approval is NOT independent technical QA. A signed approval event or an Owner ID in the database alone does not authorize queue transition, broker access or Final ACK.
- Do **not** use the alternative pre-staging machine role or separate post-WAITING Owner-intent route from the still-draft Core #1765 branch. Those are intentionally absent here, avoiding a second Owner action or job.
- Existing OTP/session systems remain unchanged. Do not request passwords, TOTP or new account setup.

## Reused security and subscriber components

The package integrates the already-developed strict Supabase CA pin and Unix socket transport, non-root one-session peer-credential broker, host-gateway and nftables ACL probes, disposable PostgreSQL TLS denial, one-event subscriber consumer, signed delivery receipt verifier, subscriber-specific RLS and rollback fixtures. None of these source/QA components is permitted to enable shared DEV, PROD, or GPT02 dispatch by itself.

AI Task Hub PR #202 remains a **separate** DEV-only monitor and four-agent signed evidence verifier candidate. Its synthetic 4/4 result is never real signed independent operation or Final ACK.

## One exact acceptance command

```bash
node scripts/dev/cst-onejob-onepass-acceptance.mjs --offline
```

The CI workflow first installs the isolated pinned broker-signature test dependency. This single command executes all registered GitHub-compatible offline checks: Owner/atomic/broker/final-ACK, network, UNIX peer, pinned CA, subscriber receipt and isolated scoped-RLS. The additional functional PG16 subscriber round-trip and root-required broker namespace test are **VPS-only** (reported as `remainingVpsIsolatedQa`, not silently counted as PASS). All tests use synthetic or disposable data and are forbidden from creating a real CST-DEV job or touching PROD. The report must always say `releaseDecision: NO_GO`, even when `offlineResult: PASS`.

## Required real E2E evidence before declaring PASS

1. Independently authorized dedicated CST-DEV login/secret custody and role/readback, with actual TLS/DNS/ACL proof, no shared-runtime fallback.
2. Approved isolated runtime image from the exact source SHA, independently captured image provenance and real broker/subscriber process health.
3. One actual authenticated Owner action and exactly one NEW WAITING job; approved one-use WAITING→QUEUED transition, executed model and durable job.completed event/publisher audit.
4. One actual separately signed durable subscriber receipt read back from CST-DEV.
5. Four genuinely independent agent attestations and one independent FINAL ACK bound to the same approval/job/source/event/receipt, not operator-typed status.
6. Rollback/relock after success or failure, with duplicate/replay rejection and existing shared DEV healthy. No PROD change.

If **any** evidence item is missing, `CST_DEV_ONEJOB_REAL_E2E_PASS` must not be reported; keep **NO_GO** and identify the missing item. Do not merge, deploy or issue credentials solely on CI success.

## One Owner click is withheld until independent technical readiness

The integrated candidate adds a **DEV Owner-only** page `/dev-onejob` on `dev.cstlogistic.co.id`, reusing the existing email-link session. The one approval button is disabled by default. The backend's read-only `/api/ai/dev/onejob/owner-stage-readiness` checks the exact source marker, the dedicated staging login and role membership, and a separately issued Ed25519 preapproval readiness receipt.

The receipt is deposited **only by the independent QA custodian** under root-owned immutable paths `/etc/cst-onejob-qa/trust/public-root.json` and `/var/lib/cst-onejob-qa/preapproval-ready.json`. It is short-lived (maximum five minutes), pinned to exact CST-DEV project, Company 1, source SHA, worker name, container image digest, a change record, and independent attestations of the broker ACL, dedicated DB transport, armed subscriber, agent routes and Final-ACK issuer. The private QA key never belongs to Core AI. Any missing, stale, malformed, forged or mismatched proof denies staging.

The **atomic WAITING staging service independently rechecks this same proof** before attempting a write. The previous session-binding, RLS and single-active unique indexes remain mandatory. This signed technical readiness is **not** the Owner's business approval, not a queue permit, and does not authorize real-DEV dispatch.

All code remains Draft and default-OFF. No real trust key, stage credential, role LOGIN, broker/subscriber runtime, four-agent signer or actual Owner approval was installed or issued by these changes. Do not ask the Owner to click until approved operations has completed and independently verified all technical preparation.


## Distinguish Core reconciliation from real four-agent FINAL ACK

The previously named `FINAL_ACK_COMMITTED` Core candidate could commit a
post-execution signed receipt before AI Task Hub independently verified all
four agent attestations and reviewer. This must **not** claim final release.
The Core proposal now uses the `cst-onejob-core-reconciliation/v1` signing
domain and `core_signed_reconciliations` ledger. A committed Core receipt
reports `CORE_RECONCILIATION_COMMITTED` and `finalAckIssued=false`.
Only the separate Hub 4+1 verifier can validate the later, independent Final
ACK, and real E2E remains NO-GO until signer custody, authentic DB readback,
Owner session, and relock evidence are verified. No new Owner action is added.

## Existing QA + subscriber issuer sources recovered into the canonical PR

The canonical Draft Core PR #1769 now **reuses**, instead of rebuilding, the independent PRE/POST QA evidence issuance and append-only PRE receipt writer, one-shot independently signed PULL subscriber ACK writer, and least-privilege role proposal previously developed in historical PR #1767. The corresponding disposable integration fixture checks fail-closed source lineage and PostgreSQL 16 RLS/INSERT-only permissions. It deliberately ends before Core reconciliation and Hub Final ACK, which have their own new-domain verifiers and separate independent four-agent + reviewer evidence.

All restored components remain **default-OFF, not deployed**, require externally authorized credentials, independently custodied signers, reviewed migrations and a real independent supervisor before they can touch CST-DEV. No source test may claim a live or independent Final ACK; the integrated acceptance runner continues to return `releaseDecision: NO_GO` despite offline PASS. Do not activate `cst_onejob_qa_receipt_writer` or `cst_onejob_subscriber_writer` by merging source alone. Historical #482, PROD and healthy shared Core AI DEV remain untouched.


## Independent subscriber: one-shot operational adapter (default OFF)

The reusable, independently verified one-event PULL + signed durable ACK
writer is now wrapped by
`scripts/dev/cst-onejob-independent-subscriber-one-shot.mjs`.
This adapter is a **runnable source candidate**, NOT an installed daemon,
credential provisioner, signing service, Supabase migration or activation.
No connection is attempted unless the specific mode, job ID and complete
fail-closed DEV environment are presented.

It reuses the **same** pinned Supabase public CA, exact transaction-pooler
host/port 6543, and project-qualified role controls as staging and broker.
The dedicated `cst_onejob_subscriber_login` remains unprovisioned: the
source allowlist is not a PostgreSQL GRANT/LOGIN and must not grant
the existing shared `aicore_dev_runtime` access. QA receipt and Core
reconciliation identities are separately allowed in the TLS adapter for
their later independent processes, not merged into a shared credential.

### Operator-controlled inputs

These become usable **only after** the previously blocked bootstrap receives
its original official security approval.

- Isolated Linux non-root process with `APP_ENV=development`,
  `NODE_ENV=development`, no shared/PROD database variables, both
  dispatchers OFF and the one-job subscriber flag explicitly enabled
- Reviewed, exact CST-DEV source SHA and approved worker name, one new
  Owner-approved Company-1 job; never historical #482
- Authorized dedicated `CST_DEV_ONEJOB_SUBSCRIBER_DATABASE_URL` supplied
  exclusively by the **approved** secrets custodian: URL values must never
  be printed, placed in a repository, pasted into chat, or reused from PROD
- Root-owned release `/etc/cst-onejob-qa/approval/subscriber-release.json`
  with `version=1`, purpose `CST_DEV_ONEJOB_SIGNED_SUBSCRIBER`,
  exact project/Company 1/job/source SHA/worker/subscriber ID, **dedicated
  operator UID distinct from the signer UID**, trust fingerprint and change
  record; its life is at most five minutes
- Separately root-pinned public key at
  `/etc/cst-onejob-subscriber/trust/public-root.json`, with a real
  independent Ed25519 private key held **only** by a separately approved
  signer service, whose Unix socket is
  `/run/cst-onejob-subscriber/sign.sock`. The CLI validates its OS
  ownership and verifies the returned signature with the pinned public key
- An independent operations supervisor to invoke **once** for this exact
  job, collect authenticated readback and enforce relock/rollback afterward

A root-owned release manifest alone is **not** proof of independent QA,
signer custody, or human Owner consent. The CLI is not permitted to
create it. A successful one-shot subscriber result has status
`SUBSCRIBER_ACK_PERSISTED_NOT_FINAL_ACK` and explicitly reports
`releaseDecision=NO_GO`, `finalAckIssued=false`,
`independentFinalAckVerified=false`. It never queues or dispatches.
The real independent QA issuer and separate 4+1 Hub signer/reviewer
must still be provisioned and supervised by the approved operator.

The source tests include missing release/credential, wrong project/worker,
shared or production DB variables, expired release, wrong signer key and
same-OS-identity rejection; they do not touch CST-DEV or PROD. This closes
a **source wiring gap only**; no operational E2E is implied.
