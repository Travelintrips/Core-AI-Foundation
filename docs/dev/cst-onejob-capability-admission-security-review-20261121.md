# CST-DEV one-job: non-bypassable admission capability — security review

**Decision: source-level feasibility PASS; operational NO-GO.**
This is a narrow addition to canonical Core Draft PR #1769, not a new admission engine.
Scope: Supabase **CST-DEV** project `xssrfshdrtdfupgqwfdw`, Company 1,
a **NEW** job, existing Owner approval and independently validated PRE receipt.
Do not deploy it, change LOGIN/grants, stage an Owner job or touch PROD.

## Reason the existing role cannot simply receive UPDATE
The existing `cst_onejob_private.admit_verified_onejob` is SECURITY INVOKER.
As observed in live CST-DEV, the broker has EXECUTE but no UPDATE/INSERT on
the necessary tables, so the transaction cannot complete. Adding direct
broker table DML would let a compromised broker bypass the application-side
Ed25519 verification and queue a job with raw SQL. This must remain denied.

## Disposable proof-of-concept (not deployable DDL)
The existing original invoker business routine is **preserved**. The
`cst-onejob-admission-capability.DISPOSABLE-ONLY.sql` fixture adds:
- `cst_onejob_admission_executor`: distinct NOLOGIN, NOBYPASSRLS, not
  a member of or assumable by the broker. A restricted function is owned
  by this role; the role is **not** the owner of application tables.
- `cst_onejob_broker_login` and `cst_onejob_admission_broker` have
  **function EXECUTE only**, plus schema USAGE. They have no direct table
  UPDATE, INSERT, executor membership, or access to the underlying
  invoker RPC. The wrapper checks the authenticated `session_user`
  and the expected `current_user`.
- `admit_verified_onejob_capability` uses SECURITY DEFINER strictly as
  a capability boundary, with pinned `search_path=pg_catalog` and NO
  dynamic SQL, before invoking the **same** original locked/atomic RPC.
  The executor has only the DML required for the single transaction.
- Explicit row policies restrict Company-1 admission, model, job, one-use
  receipt and audit/outbox; SOURCE test database has FORCE RLS and
  dedicated ownership. The QA receipt must be minted by an *independent*
  approved issuer; this wrapper **cannot itself verify Ed25519**.

The fixture checks the disposable database name and an explicit test-only
setting. Its demonstration LOGIN role exists **only in a network-none
throwaway PostgreSQL container** and never uses actual CST credentials.

## Test coverage (disposable PostgreSQL 16, network none)
The new `cst-onejob-admission-capability.disposable.test.mjs`:
- proves broker direct UPDATE, consumption INSERT, raw invoker function,
  session-user spoofing and executor role escalation are denied;
- proves bad nonce/digest fails, a simulated audit failure completely
  rolls back, only one concurrent admission succeeds, replay is denied;
- proves the same existing Owner approval / job / verified PRE receipt /
  ledger / outbox contract is used;
- cleans up the isolated Docker container and creates no DEV/PROD job.

These are **synthetic** source tests, NOT real credential, signer or E2E proof.

## Deployment review blockers — all mandatory
1. Formal, independent CST Security/Operations approval of the explicit
   SECURITY DEFINER boundary. Do **not** use SECURITY DEFINER simply to
   make a permission error disappear. An owner with superuser,
   BYPASSRLS, table ownership or CREATE privileges is not acceptable.
2. Compare this prototype with the **current live** roles, 6 private
   ledger tables, approval/job/audit schemas and effective RLS policies.
   Do not run the fixture against CST-DEV. Produce a separate reviewed
   migration with a named owner, scoped CREATE/EXECUTE grants, exact
   column privileges, explicit RLS intersections and rollback plan.
3. Verify independent QA issuer custody: broker cannot forge, alter or
   mint verified receipts; signer private keys inaccessible to broker
   or shared Core; signed proof bound to project/company/job/source/worker.
4. Test as real dedicated login (no shared service credential) through
   pinned-CA TLS transaction pooler; denial of direct SQL, wrong role,
   expired/forged/replayed approval, concurrency, rollback. Do not rely
   on GUC flags, app-side booleans or optional middleware for DB policy.
5. Before any runtime cutover, collect real one Owner action, one NEW
   WAITING job, real QA approval/readback, broker admission, model event,
   subscriber ACK, independent four-agent signatures and reviewer
   Final ACK, then relock and verify no unexpected job. PROD untouched.

**Until steps 1–5 are independently evidenced: `releaseDecision=NO_GO`.**


### 21 November 2026 — live RLS compatibility gap closed in disposable fixture

Direct read-only catalog review of CST-DEV confirmed that
`ai_platform.internal_users` has **RLS enabled**, has no policy
for the proposed `cst_onejob_admission_executor`, and already
exposes `password_hash` as a separate column. The earlier
disposable test never enabled RLS on this table, which could create
a false PASS when admission checks the active Owner relationship.

The fixture now simulates enabled/FORCE RLS and grants exactly
`SELECT(id,account_type,role,status)` with an executor-only
`USING (account_type='internal' AND role='owner' AND status='active')`
policy. Negative tests drop the policy, change Owner to Admin,
and mark the Owner inactive: each scenario denies admission with
no queue, receipt, audit or outbox mutation. A separate negative
check proves executor cannot read `password_hash`. This is a
**source/fixture change only**, not a migration on the live Owner table.
The actual production privilege policy remains subject to independent
security review.


## QA-signed receipt and PostgreSQL issuer separation — 21 November 2026
The PostgreSQL16 `--network none` acceptance fixture now reuses the actual
`signIndependentQaEvidence` cryptographic code (ephemeral in-memory test-only
Ed25519 key) before a PRE receipt is issued. A forged signature is rejected
**before** any DB writer operation; the verified canonical digest and nonce
then enter the disposable DB through a **different** NOLOGIN QA writer role.

Negative readbacks prove the broker cannot INSERT QA PRE receipts, SELECT the
QA nonce/digest from the receipt table, modify the original job directly,
impersonate the executor or mint a consumption ledger. The QA writer itself
cannot UPDATE a PRE receipt. Without a QA row, a guessed nonce/digest cannot
admit the job. When the simulated QA-issued row exists, the original atomic
admission function still rejects bad nonces, audit rollback failures and replay;
one of two concurrent attempts succeeds. All containers are removed.

**Security boundary, not an operational claim:** The database does **not**
verify Ed25519 signatures itself. It relies on independently authenticated,
limited, protected QA writer access and signed-proof validation **before**
the append-only PRE receipt is created. This fixture imitates that separation
with synthetic keys, not real independent key custody or a real Supabase login.
Neither a boolean evidence field nor the nonce/digest by itself proves a
signature. If custody of the QA writer is compromised, the DB cannot distinguish
a fabricated row from an authorized one. Security review must explicitly
accept or harden that trust model before approving any change to live DEV.
Operational release remains `NO_GO`; this document is NOT a migration.


## Broker adapter compatibility repair — source-only (21 November 2026)

The original broker adapter issued SELECT ... FOR UPDATE directly against
Owner approval, job and PRE receipt tables. Live CST-DEV broker and dedicated
login roles have **no SELECT** on those tables, and **no UPDATE** on jobs.
The original query cannot succeed without unsafe additional grants. Those
grants are explicitly **not** added.

The revised candidate divides responsibilities without rebuilding previous
Owner, receipt or job provisioning:

1. **Before ANY database query**, the independent broker checks the
   pre-pinned QA Ed25519 public key/fingerprint, full canonical PRE_ADMISSION
   signature, project/Company-1/job/source pin, short expiry and actual
   independently captured evidence bytes (not only a claimed digest).
   Invalid input causes **zero database queries**.
2. One dedicated TLS-pinned broker transaction checks session_user and
   transaction-local role, then calls only
   cst_onejob_private.admit_verified_onejob_capability(job_id, nonce, digest).
   Broker does **not** SELECT, lock, UPDATE or INSERT underlying tables.
3. A separately reviewed database capability must lock the real approval,
   job and PRE receipt, verify fresh Owner approval and independently QA-issued
   nonce/digest, and atomically consume/queue/audit/outbox, with rollback
   on errors and replay denial. No capability is installed by this adapter.
4. Signature checking by the application is **not** a database grant.
   This database does not itself validate Ed25519: security depends on the
   separately custodied, authenticated, append-only QA writer and signed
   proof being unavailable to untrusted principals. This boundary requires
   independent Security/Operations review.
5. Root-owned broker-release.json configuration is **not** evidence of
   externally signed Operations authorization. Before any operational rollout,
   bind admission to the real cryptographically validated one-job release
   batch, live Owner database approval, exact code SHA, and independent custody.
   File ownership, CI PASS or synthetic receipt cannot replace authorization.

### Bounded local evidence

- Trusted admission adapter source tests: **5/5 PASS**; fake signature,
  wrong identity and failed capability do not produce a commit.
- Integrated independent QA-to-broker-to-subscriber source tests:
  **5/5 PASS**; includes network-none PostgreSQL rehearsal.
- Disposable PostgreSQL16 admission capability tests: **3/3 PASS**;
  includes RLS/no raw broker DML, rollback, replay and concurrency.

All these tests are disposable/synthetic: no real Owner session, signed
Operations release, activated signer or live E2E. On CST-DEV, broker/login
remain NOLOGIN, raw DML remains denied, and the scoped capability wrapper
is **not installed**. A live admission attempt would fail closed.
PR stays DRAFT. No runtime deployment, dispatch, signer enable, PROD change
or operational PASS claim is authorized.


## Cryptographic Operations release at broker boundary — source-only (21 November 2026)

The previously root-owned, **unsigned** broker-release.json is no longer
an acceptable runtime authority. The trusted admission bridge now reads
only the **existing canonical Operations release importer inputs**:
- /etc/cst-onejob-dev/operator-trust/release-public.pem, independently
  controlled Ed25519 public root;
- /etc/cst-onejob-dev/inbox/signed-release-batch.json, one Company-1 DEV
  job and eight role-scoped Ed25519 permits from that same root;
- /etc/passwd, read-only, for independently matching the eight signer
  and eight operator OS UIDs.

The new verifier checks the complete canonical Python importer envelope
and each permit signature, exact issuer, public manifest SHA and all eight
dormant signer fingerprints already present on the actual VPS, 5-minute
expiry, unique nonces, job/approval/company/worker/source binding.
Only then can the broker read the independent QA signed PRE receipt, whose
project/job/approval/worker/SHA must match the Operations batch. This gate
does not synthesize Owner approval or turn signer/dispatch on.

**Critical custody safeguard:** APPROVED_OPS_ROOT_FINGERPRINT is
deliberately null. An independent approved Operations Ed25519 PUBLIC root
must be reviewed and pinned in a separate authorized immutable code change;
it cannot come from an environment flag or a root-created placeholder.
Until then, broker activation is **impossible** even if someone puts a
root-owned file in the expected path.

VPS fixture source tests exercise seven negative/positive cases using only
ephemeral in-memory test keys, including Python JSON canonicalization parity,
invalid signature, eight-role mismatch, source mismatch, UUID/job binding,
missing role, replayed nonce, wrong host UID, stale and future permits,
and no plain-release fallback. Tests are **synthetic only**.
There is no independent root, signed release or real Owner job on CST-DEV.
Deployment, database capability grants, LOGIN, signer and dispatch remain OFF.

Separate Security/Operations reviewer must still approve the non-bypassable
DB capability, RLS intersection, real root custody and actual release
before any live one-job E2E. The read-only filesystem status does not
constitute an Operations signature.


## Live-schema-matched candidate and guarded rollback — source-only (21 November 2026)

Prepared exact-source **review-only** artifacts:
- docs/dev/cst-onejob-admission-capability.REVIEW-ONLY.sql
- docs/dev/cst-onejob-admission-capability.ROLLBACK-REVIEW-ONLY.sql
- scripts/dev/cst-onejob-capability-review-live-schema.disposable.test.mjs

Both SQL files start with a transaction and explicit unconditional
RAISE EXCEPTION review guard. **Do not remove these guards** without
an independent signed Security/Operations authorization, exact PR commit
pin, real role-custody review and an explicit isolated DEV release plan.
Neither file is installed on Supabase CST-DEV.

The candidate preserves live Owner staging and existing broker roles
and memberships; it creates **only one distinct NOLOGIN executor**.
It checks both existing broker roles are NOLOGIN/limit-0, app schemas and
RLS enabled, original atomic SQL is SECURITY INVOKER, and direct broker
SELECT/UPDATE remain forbidden. It intentionally does not change
table ownership, enable/force RLS on existing app tables, create
passwords, grant broker raw DML, or change PROD.

Live catalog inspection confirmed the source table columns, existing
Company-1 Owner/QA/receipt ledgers, original invoker function, the
required RLS baseline, and existing NOLOGIN broker pair. The underlying
receipt-consumption ID is GENERATED ALWAYS AS IDENTITY on live
PostgreSQL 17, so the existing atomic RPC correctly omits that ID.
The network-none PG16 functional rehearsal uses a disposable serial ID
and does not claim full PG17 live-runtime equivalence.

The source test first **executes both guarded SQL files and proves they
refuse ALL changes**, then strips the guard **inside an isolated PG16
container only**. Its live-schema-shaped fixture tests guarded
capability installation, zero raw broker SELECT/UPDATE, distinct executor
NOLOGIN/no-membership, missing PRE receipt denial, invalid nonce,
one allowed WAITING→QUEUED transition with consumed Owner/QA receipt
and audit/outbox, replay rejection, clean pre-admission rollback and
explicit refusal to rollback a consumed job. Result **2/2 PASS**.

The candidate does not verify QA Ed25519 inside PostgreSQL; independent
QA custody and verified signer release remain mandatory before any
broker database credential is activated. In no case is a green source
test an authorization to apply this migration. Operational NO-GO.
