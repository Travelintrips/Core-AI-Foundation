# Issue159 — per-task database authorization decision gate (15 Nov 2026)

**Draft decision only. NO APPLY, NO DEPLOY, NO PROD, NO credential or signer activation.**

## What is established

- Existing verifier is active and authenticates to a private lineage reader Unix socket as UID 995 / GID 999. The socket rejects unauthorized peer UID and its directory/socket modes are 0750/0660. This proves peer custody, not database single-task isolation.
- Existing `dev_gpt02_lineage_login` inherits from `dev_gpt02_lineage_reader`. All five underlying lineage tables have column-level SELECT grants, although `has_table_privilege(...,'SELECT')` returns false. The correct inventory uses `has_any_column_privilege`.
- Current lineage RLS allows multiple tasks in company `default` (threshold `task_id>139`). The receipt policy uses `USING (true)`. Therefore a holder of the dedicated database login may enumerate same-company records outside a specific verified command even if the normal socket query uses exact bound parameters.
- Existing issuer reader has strict native role/TLS/transaction identity checks, including `no_privileged_routines=true`; granting it EXECUTE on a SECURITY DEFINER read function makes this guard fail. A synthetic fixed-capability SECURITY DEFINER proof is not a deployable replacement.
- The dedicated lineage reader is already deployed, and the installed runtime source was brought into this PR byte-for-byte. Do not build a parallel service.

## Decision

**No live grant/policy change should be made yet.** A safe solution must distinguish *application-level exact lookup* from *database-enforced isolation after credential compromise*. The two are not interchangeable.

A viable candidate for independent design review is a **separate, time-bounded database identity for each exact authorized task/attempt**, with row policies bound to immutable task/company/command/attempt (and relevant receipt/fence IDs), no ability to choose scope via caller-controlled GUC, no role membership escalation, no privileged routines, and no broad inherited reader grants. It would require a reviewed credential issuance and revocation path, preventing overlapping authority and preserving the existing source/claim verification. This is a candidate, NOT approval to provision per-task roles.

A second possible candidate is a privately authenticated server-owned read broker which makes the exact claimed task binding authoritative while denying general reader credentials direct table visibility. Any privileged code must receive an independent review, must not bypass FORCE RLS casually, and must not disable the original native privilege guard.

## Required pre-merge evidence

1. Independent security review of the proposed trust boundary, including how the task claim is authenticated *before* any DB read and how credentials cannot be reused for another task.
2. Disposable PG tests with **two legitimate tasks from the same company**, wrong command, attempt, receipt/fence, expired lease, missing/swap approval, and a direct DB enumeration attempt from the credential itself.
3. Native reader contract tests for TLS, pinned role, one session, no privileged routines, no write grants, no replay, and exact existing signed evidence/digest shape.
4. Explicit rollback and credential invalidation proof that leaves the role(s) locked and zero sessions.
5. A separately authorized live DEV-only one-shot authentication proof only AFTER the above are PASS. Such a proof does not authorize signer, dispatch, or Final ACK.

## Status

Existing source tests: PASS. Existing socket custody tests: PASS. Scoped synthetic capability test: PASS for its synthetic model but incompatible with the current issuer role guard. **Actual database-enforced one-task security: NOT PROVEN.** E2E Final ACK: NO_GO.

No change to active DEV roles, RLS, service, credentials, signer, dispatch or PROD was made when authoring this decision.

## Disposable signed-scope issuance and relock evidence — 15 Nov 2026

Synthetic test source: scripts/dev/test_gpt02_issue159_signed_scoped_issuance_pg.py.

- Reuses four-root synthetic signed packet, mock persisted readback, and exact five-table RLS. A disposable network-isolated PostgreSQL 16 database models a privileged issuance actor. No live accounts, roles, credentials or records are touched.
- One atomic transaction records a scope/packet/command-unique issuance ledger and enables a generated synthetic LOGIN with CONNECTION LIMIT 1. Simultaneous replay requests produce only one committed issuance. A different scope cannot reuse the same command.
- Native one-task PostgreSQL login proves original canonical SQL works, other task and writes fail, and the credential cannot read the issuance ledger. After use, SELECT/USAGE are revoked, the role becomes NOLOGIN with CONNECTION LIMIT 0 and password NULL, an active backend is terminated, zero sessions remain, and new LOGIN fails.
- These results prove synthetic mechanism feasibility, NOT live authentication, real credential custody, approval-to-issuance authority or release.

### Blocking conditions for any operational activation

1. One connection is NOT one read. A compromised password may be reused sequentially before revocation, and an active session may issue repeated SELECTs. A pinned one-shot broker must execute a single approved read, close it, then force backend termination. The database must independently fence issuance and consumption.
2. The source candidate has credentialIssuancePermitted=false and releaseDecision=NO_GO. Neither a hash nor a caller-supplied proof authorizes role creation. Require fresh, persisted, independently verified Super Admin approval, four independent signed roots, exact five-table lineage, and approved one-use issuance transaction.
3. The active lineage reader pins the existing shared database identity in both DSN and connection user checks. Never swap a per-task password into that unit or weaken the identity guard. A separately reviewed compatible path must preserve the active service until cutover PASS.
4. Scoped credentials must not inherit dev_gpt02_lineage_login's broad column SELECT or RLS task-threshold / unconditional policies. Test direct SQL enumeration from the credential, not just the application's bound query.
5. Lease expiry, revocation, crash after granting, concurrent issuance, partial rollback and stale active sessions must all fail closed to NOLOGIN, password NULL and zero sessions. Signer, dispatch, DELL and PROD remain untouched.

Outcome: SYNTHETIC ISSUANCE PASS; LIVE CREDENTIAL ISSUANCE NO_GO; FINAL ACK NO_GO.


## Database-enforced expiry if one-shot broker crashes — 15 Nov 2026

Source: scripts/dev/test_gpt02_issue159_signed_scope_expiry_pg.py.

The source-only test combines the already-verified synthetic signed-scope
candidate with exact five-table RLS predicates and a **fixed absolute
expiration instant** (never a client-controlled session GUC). That instant is
the EARLIER of the synthetic signed lease expiry and a short operational
window. Native PostgreSQL LOGIN can read the single approved task before
that instant. With the role deliberately left LOGIN-enabled (simulated broker
crash), **new** SELECTs on each of five lineage tables and on the canonical
joined lineage query return zero rows after expiry. An attempted session
task/expiry GUC override does not bypass those fixed policies. Cleanup then
revokes SELECT/USAGE, sets NOLOGIN/CONNECTION LIMIT 0/PASSWORD NULL, and
denies another LOGIN. All changes occur in a network-isolated disposable
PG16 container, never in CST-DEV or PROD.

This is a second line of defense, NOT one-read authorization. A SELECT
statement that started before TTL expiry may still run until its separate
statement timeout, and an unexpired credential can still be reused for
sequential connections. The operational broker must own the credential,
perform a single bounded original lineage SELECT under a pinned identity,
then revoke and terminate the backend. Independent cleanup/watchdog,
credential custody, exact signed approval persistence, true one-use
issuance/consumption, and production-compatible role lifecycle remain
unimplemented; do not activate the source-only candidate. RELEASE NO_GO.


## Schema-grounded exact-task RLS proposal — 15 Nov 2026

A direct READ-ONLY inventory of CST-DEV pg_catalog and information_schema
confirmed that all five lineage tables use FORCE RLS, and all existing
policies target named roles (not PUBLIC). The active
dev_gpt02_lineage_login has LOGIN=true, INHERIT=true and CONNECTION LIMIT -1:
it remains unsuitable for per-task credential use, and its inherited
column-level grants must not be repurposed.

New SOURCE-ONLY file:
scripts/dev/gpt02_issue159_scoped_policy_proposal.py.

It produces deterministic *review-only* PostgreSQL 16 DDL from the
four-signature/post-lineage NO_GO candidate. The generated role starts
NOLOGIN/NOINHERIT/NOBYPASSRLS/CONNECTION LIMIT 0 with no password, and each
of five forced-RLS tables receives a dedicated role-specific policy bound to
the exact task/company/command/attempt/approval digest, approved link,
receipt, fence, lease and an immutable absolute expiry. Column-level SELECT
GRANTs cover only original canonical lineage query and policy columns.
The renderer rejects role overrides, changed task/tenant, bad hash binding,
malformed UUID, expired candidate and non-NO_GO candidate. Its executable
entrypoint deliberately refuses all CLI/live apply; the function RETURNS
SQL only and never connects to Supabase or issues credentials.

Disposable fixture test:
scripts/dev/test_gpt02_issue159_scoped_policy_proposal.py.

The fixture adds missing real-schema column names to the existing synthetic
five-table PostgreSQL seed. It validates rendered SQL and native canonical
query using column SELECT privileges, denies other task and ungranted
columns/write, verifies NOLOGIN and no inherited membership, and refuses
repeat CREATE ROLE/POLICY. This does not prove a real-live role would have
the correct owner/GRANT privileges, nor does it authorize live application.

Required before a live-DEV trial: independent security review of credential
issuer, store owner/CREATEROLE custody, native one-shot broker integration,
durable exact-scope issuance and cleanup ledger, real SSL verify-full role
pin, watchdog, task approval that is fresh and owner-authorized, and
NOLOGIN/password NULL/zero-session rollback. The existing shared lineage
runtime must remain unchanged until a separately reviewed cutover passes.
No signer/dispatch/DELL/PROD activation.


## Actual CST-DEV table-owner custody and migration preflight — 15 Nov 2026

READ-ONLY Supabase project xssrfshdrtdfupgqwfdw inspection found:

- PostgreSQL 17.0.6, role postgres has CREATEROLE and is NOT superuser.
- All five GPT02 lineage tables and schema gpt02_private are owned by
  gpt02_store_owner (NOLOGIN), with forced RLS.
- postgres has gpt02_store_owner ADMIN OPTION but does NOT have SET option.
  The installed current shared reader remains unchanged.
- No policy on the five tables is granted to PUBLIC.

The earlier disposable test used PostgreSQL bootstrap superuser and missed
the table-owner boundary. This is now addressed in the SAME source-only
renderer scripts/dev/gpt02_issue159_scoped_policy_proposal.py, reusing the
review-only custody technique in the existing positive permit proposal:

1. Fail closed on unexpected current_user, missing CREATEROLE/ADMIN OPTION,
   already-active owner SET permission, incorrect schema/table owner,
   or any missing FORCE RLS.
2. BEGIN; CREATE the per-task role NOLOGIN/NOINHERIT/NOBYPASSRLS/CONN LIMIT 0.
3. Temporarily grant gpt02_store_owner TO postgres WITH SET TRUE;
   SET ROLE gpt02_store_owner; GRANT only column SELECT and schema USAGE,
   CREATE POLICY for exactly the signed task on five tables.
4. RESET ROLE; regrant owner membership WITH SET FALSE; assert SET is false;
   COMMIT. Any error rolls back the new role, temporary elevation, GRANTs
   and policies together.

Disposable PostgreSQL test now creates a separate non-superuser CREATEROLE
migrator called postgres and an independent NOLOGIN owner. It proves
missing ADMIN OPTION denies before DDL, both successful temporary elevation
and restoration, deliberately injected exception AFTER SET ROLE causes
transaction-wide rollback (NO new role and NO owner SET), five-table query
and direct enumeration, column-only SELECT and no unwanted inheritance.
Result PASS, exit code 0. The existing GitHub Actions job runs this test.

The EXISTING read-only script
scripts/dev/gpt02_issue159_exact_task_release_gate.READONLY.sql was
extended with owner-custody inventory. Running ONLY its new read-only SELECT
directly on CST-DEV gave:
PASS_OWNER_CUSTODY_PREFLIGHT_NO_LIVE_PERMISSION,
owned_forced_tables=5, owner_set_now=false, has_admin_option=true,
expected_schema_owner=true, no_public_policies=true,
limited_migrator=true, and credential_release=NO_GO_NO_SIGNED_ONE_USE_LIVE_ISSUER.

This means the owner-custody migration is structurally feasible and does not
require making the reader an administrator. It does NOT authorize applying
the Draft DDL or enabling LOGIN. Independent security approval, a real
one-use credential broker, signed persisted Super Admin approval and
rollback/credential invalidation are still REQUIRED before live DEV changes.
Do not activate signers, dispatch, DELL or PROD.


## One-shot broker review contract — 15 Nov 2026

New UNINSTALLED source-only module:
deploy/ai-coding-standalone-dev/gpt02_issue159_one_shot_reader_broker.py.
It is not a new service, route, credential manager or PostgreSQL writer.
There is deliberately no CLI, DSN secret, private signing key, privilege
DDL, worker client, signer call or deploy instructions. It reuses the
existing pinned four-signature/verifier persisted lineage handoff and the
exact bounded read-only canonical lineage query. Before querying a
supervisor-supplied connection, the library checks the expected derived
per-task pooler username, exact CST-DEV pooler host/port, database, read-only
transaction behavior, and libpq effective sslmode=verify-full with a
configured sslrootcert. It then validates the original signed receipt and
fence using the existing trusted-lineage contract, and *always* requests
relock in a finally block, even after connection-open failure, wrong identity,
query timeout or invalid row. A returned review-only answer contains NO
database data, credential, grant, dispatch or authorization.

Offline synthetic tests:
scripts/dev/test_gpt02_issue159_one_shot_reader_broker.py.
The test suite verifies exactly one original bound SELECT call,
wrong native username/database/host/port/transaction/TLS denial, missing
or forged lineage row, expired issuer lease, query/open failures, and
missing or wrong relock evidence. Source-only test returns NO_GO throughout.
Existing GitHub Actions Draft workflow executes these tests.

BLOCKING SECURITY LIMITATION: The supervisor interface is a TEST/REVIEW
dependency only, not a currently implemented trusted credential/role owner.
Its reported cleanup shape is *not independently authenticated by this
library*, cannot be treated as a native database attestation, and does not
confer permissions. A real service must implement separately reviewed
privileged issue-once/consume-once ledger, actual trusted PostgreSQL
role/TLS/SSL-root custody, cleanup verification querying pg_authid and
pg_stat_activity through its owner identity, crash watchdog, and rate-bounded
one-query execution. Existing shared lineage reader's fixed role identity
must not be weakened. None of these operational components is installed
or enabled by this Draft.


## Native PostgreSQL post-read relock attestation — 15 Nov 2026

The earlier one-shot broker only checked a supervisor-supplied cleanup
response shape; that could be forged and is **not** native DB evidence.
The one-shot review contract now requires a SECOND, separately authenticated
CST-DEV PostgreSQL admin connection after the supervisor's relock operation.
New source-only module:
deploy/ai-coding-standalone-dev/gpt02_issue159_native_relock_attestation.py.

The attestor pins the admin pooler user postgres.xssrfshdrtdfupgqwfdw,
database postgres, Supabase CST-DEV pooler host/port, libpq verify-full TLS
and configured sslrootcert, with autocommit=false. It derives the exact
scope-bound task role from the signed candidate; an expired candidate
remains valid ONLY to check cleanup, not to issue fresh credentials.
Its one bounded read-only SQL query checks pg_roles, pg_authid,
pg_auth_members, pg_stat_activity and effective private schema/five-table
privileges. The selected pg_authid value is ONLY the boolean
rolpassword IS NULL, NEVER password/hash data. Required positive evidence:
the exact expected DB session_user/current_user='postgres', the exact role,
NOLOGIN, connlimit=0, password NULL, NOINHERIT, NO privileged role flags,
no role membership, no active sessions, no schema USAGE, and no table/column
SELECT across the five lineage tables. Any missing, ambiguous, inaccessible
or inconsistent result fails closed. It returns no authorization.

Two independently executed tests:
- Offline synthetic test suite includes wrong admin pooler identity, missing
  verify-full TLS, false supervisor cleanup, still-present password, active
  session, remaining grants, missing role, mismatched SQL result, and denied
  catalog query. Source-level broker+lineage tests: 31/31 PASS.
- scripts/dev/test_gpt02_issue159_native_relock_catalog_pg.py uses a
  networkless postgres:16-alpine container, seeds real five-table policies,
  and runs the exact SQL AS A NON-SUPERUSER PostgreSQL login with explicit
  read-only pg_authid SELECT. The SQL detects leftover reader SELECT grants
  and an active reader/password before cleanup; after revocation, NOLOGIN,
  connlimit 0, password NULL and backend termination, all required catalog
  booleans become TRUE and fresh login fails. The container is deleted.

CST-DEV READ-ONLY permission inspection confirms its postgres role can
SELECT pg_catalog.pg_authid, pg_roles and pg_stat_activity (and has
pg_read_all_stats). No credential or password values were retrieved.

**Still not operational:** The trusted admin connection factory, the
privileged issuer/relocker, crash watchdog and signed one-use ledger are
not installed/connected to this Draft module. A supervisor can still be
faked in offline tests; in production it must be privately authenticated
and have its own credential and role custody. The service must also
re-check release conditions, zero sessions after relock, and fail closed
on any readback error. Do NOT apply SQL or activate real credentials,
signer, dispatch, DELL or PROD. Final ACK remains NO_GO.


### PostgreSQL 17 CST-DEV negative-control readback

The EXACT source READBACK_SQL from native_relock_attestation.py was executed
as a read-only SELECT on the live CST-DEV PostgreSQL 17 database against the
*existing locked* gpt02_issuer_evidence_reader role. This is a compatibility
and negative-control check ONLY, not a role mutation or one-shot issuance.

The readback returned native session_user=current_user='postgres'.
Existing issuer: no_login=true, connection_limit_zero=true,
password_null=true, no_inherit=true, no_privileged_role=true,
no_role_memberships=true, zero_active_sessions=true.
Crucially, schema_usage_revoked=false and five_table_read_revoked=false.
This is EXPECTED: the existing NOLOGIN issuer retains narrow SELECT/schema
grants and was not issued/revoked by this one-shot scoped-reader proposal.
Consequently the new full-relock attestation would correctly DENY a
purported cleanup PASS for that role. Do not revoke the issuer grants or
mistake that negative control for an active credential problem.

The independently reviewed future scoped reader must have both its LOGIN
disabled/password NULL and its own exact-task SELECT/USAGE fully revoked
before a native post-read cleanup attestation can PASS. Existing issuer
and shared lineage roles are intentionally left unchanged.


## Independent relock-admin credential custody preflight — 15 Nov 2026

VPS service metadata inspection found an **existing** encrypted
/etc/credstore.encrypted/gpt02-issue159-attestor-dsn (root:root mode 0600).
It is attached to the STATIC / INACTIVE
gpt02-issue159-attestor-record-once.service, not an independently scoped
catalog auditor. We did NOT open or decrypt the file. Independent read-only
CST-DEV catalog inspection found dev_gpt02_attestor_evidence is NOLOGIN,
connection limit 0, and cannot SELECT pg_catalog.pg_authid. This does NOT
prove the DSN's own login identity, and that credential MUST NOT be borrowed
or treated as permission to inspect/revoke reader role credentials.

New source-only metadata preflight:
scripts/dev/gpt02_issue159_relock_admin_custody.READONLY.py.

The preflight reads ONLY the file metadata of a dedicated review-proposed
gpt02-issue159-relock-catalog-auditor.service and its encrypted
gpt02-issue159-relock-catalog-dsn, plus the service unit TEXT itself.
It does NOT read/decrypt the credential contents or open a DB connection.
It requires a root-owned, non-writable/safe unit file, root-owned encrypted
credential 0600, exclusive pinned LoadCredentialEncrypted alias, a distinct
non-root service user, APP_ENV=development, NoNewPrivileges, ProtectSystem
and PrivateTmp. Any cross-role reuse of attestor/lineage/issuer/worker
credential names is denied. The preflight is NOT an installation plan:
even with all metadata correct it ALWAYS returns
credentialIssuancePermitted=false and releaseDecision=NO_GO.

Results: 9/9 offline metadata/cross-role/symlink/override tests PASS on
authorized VPS. The preflight also rejects duplicate effective User or
APP_ENV directives and unreviewed systemd drop-in overrides. The actual VPS
read-only
preflight returned DEDICATED_RELOCK_AUDITOR_NOT_PROVISIONED,
unitMetadataReady=false, encryptedCredentialMetadataReady=false,
credentialContentsRead=false and exit code 3 (expected NO_GO).
No unit/credential was installed, changed, or accessed for contents.

Before any new audit credential is provisioned, require independent
security review of whether a privileged catalog audit identity is needed,
whether the audit can be safely isolated from any application/broker signer,
and how PostgreSQL pg_authid and backend-termination privileges would be
restricted and revoked. None of the above authorizes live-DEV role
creation, migration, signer, dispatch, DELL or PROD activation.


## Minimal boolean-only native relock attestor alternative — 15 Nov 2026

PostgreSQL 17 documentation confirms pg_roles is publicly readable and
always masks rolpassword. Direct pg_authid SELECT is not an appropriate
privilege to grant to a new narrowly scoped auditor just to test whether
a scoped reader password is NULL: that catalog holds password hashes for
all database roles.

A new **DRAFT / NOT APPLY** SQL proposal at
docs/dev/gpt02-issue159-minimal-catalog-relock-auditor.PROPOSED.sql
models a safer alternative to distributing a postgres admin DSN.
The proposal creates its own private gpt02_relock_audit schema,
a dedicated dev_gpt02_relock_catalog_auditor role initially
NOLOGIN/NOINHERIT/NOBYPASSRLS/connection-limit 0, and one SQL function
scoped_reader_fully_locked(name). It RETURNS ONLY boolean. The function,
owned by a trusted non-superuser postgres migrator with pg_authid SELECT,
uses SECURITY DEFINER plus a pinned pg_catalog-only search path, no
dynamic SQL, a strict deterministic reader-role-name whitelist,
read-only checks of pg_authid/pg_roles/pg_auth_members/pg_stat_activity,
exact five-table forced RLS presence and the effective private SELECT
privileges. Function EXECUTE is revoked from PUBLIC and granted ONLY to
the new auditor; no existing issuer/lineage/service roles are granted it.
The function is an observation, NOT a credential-issuance authority.

SECURITY DEFINER is an explicit design tradeoff and MUST receive
independent privilege/security review. The earlier issuer reader forbids
privileged functions and remains untouched; do not grant this RPC to that
reader. The future auditor login/credential is NOT created or installed
by this PR. Do NOT apply the proposal in CST-DEV or PROD.

Disposable PG16 evidence:
scripts/dev/test_gpt02_issue159_minimal_catalog_auditor_pg.py
provisions a completely isolated networkless PostgreSQL instance,
a non-superuser postgres migrator, and a synthetic temporary auditor LOGIN
inside that disposable database ONLY. It proves the auditor cannot
directly read pg_authid hashes, select private lineage, alter roles,
or execute arbitrary privileged routines. Function returns false when
a signed scoped reader still holds SELECT, has a password, or has an active
session; after revocation, NOLOGIN/password NULL/connlimit0 and termination,
returns true. Only scoped task-role names may be queried. Exit code 0 PASS,
container automatically deleted.

The uninstalled source-only one-shot broker contract now calls
attest_boolean_relock() using a proposed separately encrypted low-privilege
auditor connection instead of requiring a broad admin connection. The
broker source regression explicitly forbids fallback to
open_trusted_admin_connection/attest_native_relock. Offline unit tests
30/30 PASS. The old broad catalog readback source is retained only for
backward regression, NOT selected by the new one-shot broker.

Remaining gates: review SEC DEFINER function, determine exact approved
isolated auditor credential custody (the existing attestor/issuer/lineage
secrets MUST NOT be reused), implement privileged one-use role issuer and
independent watchdog with durable atomic ledger, and perform a separately
authorized one-shot live DEV test with fresh Super Admin approval. Signer,
dispatch, DELL, PROD and Final ACK remain NO_GO.


## Security review — indirect privilege paths after scoped relock (16 Nov 2026)

An adversarial network-isolated PostgreSQL 16 test found TWO FALSE-POSITIVE
cleanup attestations in the original minimal boolean function, even after
direct private-table SELECT and schema USAGE had been revoked:

1. The revoked reader could still execute a separately granted
   SECURITY DEFINER routine in public schema, owned by a privileged
   administrator, and read BOTH same-company synthetic tasks. The original
   boolean audit returned TRUE despite that indirect path.
2. The revoked reader could still SELECT an owner-privileged default VIEW
   in public schema that exposed private rows without requiring the reader
   to hold direct base-table grants. Again the original boolean returned TRUE.

Fixed ONLY in the Draft proposal
docs/dev/gpt02-issue159-minimal-catalog-relock-auditor.PROPOSED.sql:

- Check pg_proc/pg_namespace for any effective EXECUTE on reachable
  non-system SECURITY DEFINER routines, including privileges inherited
  from PUBLIC. If present, return FALSE.
- Check pg_class/pg_namespace for reachable non-security-invoker owner VIEWs
  and materialized views where the role has effective SELECT, including
  PUBLIC and column-level grants. If present, return FALSE.
- Preserve the distinction that a PostgreSQL 15+ security_invoker=true
  view enforces the invoker's own base-table privileges, so its mere
  presence is not the same owner-privilege bypass.
- Only the boolean audit's SQL predicates and the disposable test changed;
  no live grant, view, routine, role, RLS or service was touched.

The new adversarial PG16 fixture proves false results for callable
privileged routines, PUBLIC EXECUTE, owner views, PUBLIC SELECT on owner
views, and materialized copies. It also proves the audit returns TRUE
again only after those rights are revoked, and does not falsely reject a
security_invoker view when base-table access is denied. The exact committed
source test passed end-to-end with exit 0. This is an independently useful
security finding, NOT an independent production security sign-off.

These are deliberately **conservative** restrictions. In CST-DEV, unrelated
PUBLIC function/view grants may exist and would make a newly scoped role
remain NO_GO until reviewed; do NOT weaken the check or revoke unrelated
production grants just to force a PASS. Other grant mechanisms, including
new grants after the audit instant and code paths outside PostgreSQL, still
require a separate full privilege review.

Read-only CST-DEV catalog risk inventory additionally found one non-system
schema with PUBLIC USAGE, zero user-defined SECURITY DEFINER functions both
PUBLIC-executable and reachable through that schema, and zero owner-view or
materialized-view objects both PUBLIC-selectable and reachable through it.
That is a narrowly scoped PUBLIC-ACL snapshot, not a claim that future
per-task identities have no other indirect grant paths; per-role privileges
and new schema changes must be audited again at release.

The minimum viable live role remains unavailable until the entire privileged
issuer/cleanup/watchdog model, role provenance, timestamp validity,
credential custody, and external owner-approved task are independently
reviewed. Never treat a synthetic TRUE as deployment authorization.


## One-read consumption fence before any connection — 16 Nov 2026

The prior review-only broker derived the correct scoped reader role but
immediately attempted a reader connection after the signed/persisted
verifier readback. This left an application-level replay gap: repeated
attempts during the short signed lease could enter the read function again,
even if the separate credential-ISSUANCE ledger was unique.

The EXISTING uninstalled broker source now REQUIRES a
supervisor.consume_scope_once(candidate) call BEFORE
open_one_scoped_connection. The response shape must bind all of:
scopeSha256, verifiedPacketSha256, role, commandId, attemptId,
receiptId, fenceId, consumedExactlyOnce=true and releaseDecision=NO_GO.
Any failed, replayed, missing, mismatched or ambiguous consumption blocks
the query and goes through the cleanup/relock path. These are review-only
interface checks; the supervisor is still unimplemented and its own
receipt is NOT independent proof of a native PostgreSQL ledger commit.

Offline broker regression added concurrency/replay/fail-close tests using
the existing signed fixtures and an in-memory synthetic supervisor:
35/35 unittests PASS. In the EXISTING
scripts/dev/test_gpt02_issue159_signed_scoped_issuance_pg.py test,
a second immutable 'reader_read_consumptions' table was added to the
networkless disposable PG16 fixture. A unique tuple derived from the
already-issued packet/scope/command/attempt is inserted atomically in a
transaction under a scoped advisory lock; simultaneous duplicate
consumption attempts yield one success, one duplicate rejection.
A failed query AFTER consuming does NOT restore the read budget; replay
remains denied. The reader LOGIN has no read/write access to either
issuance or consumption ledger. Exact committed test passed, exit code 0.

CRITICAL LIMITATION DEMONSTRATED: A holder of the temporarily enabled
reader PASSWORD can still open a new connection and read the same
approved row again before the role is actually locked. The test
intentionally reproduces this risk and labels it
EXPECTED_RISK_DIRECT_PASSWORD_CAN_REQUERY_BEFORE_RELOCK_NO_GO.
A consumption ledger limits the TRUSTED BROKER, not a compromised
unrevoked PostgreSQL credential.

Operational release needs the real, privately authenticated issuer/
consumer, independently verifiable database consumption before any read,
short fixed RLS TTL, one-query connection custody, immediate revoke and
terminate, crash watchdog and auditable cleanup. Existing post-read
native boolean audit only proves relock at one instant, not an
anti-replay issuance grant. No live credentials/roles/services were
created or changed. Draft NO_GO for live issuance, signer, dispatch,
DELL, PROD and Final ACK.


## Fresh-challenge native persisted-consumption readback — 16 Nov 2026

Previous tests proved one immutable issuance row and exactly one committed
consumption row (including concurrency and rollback). They did NOT
independently prove that the supervisor's consumption receipt was COMMITTED
before the reader was opened. Worse, an auditor that merely checks whether
an OLD matching consumption row exists could return TRUE on a second
request during the short issuer lease, even if a supervisor lied about
consuming it again.

Incremental SOURCE-ONLY files in Draft PR #1754:

- docs/dev/gpt02-issue159-one-read-consumption-attestation.PROPOSED.sql
  extends the existing *proposed* private gpt02_relock_audit namespace with
  immutable, privately owned issuance+consumption ledgers. Exact signed
  packet/scope/role/task/command/attempt/receipt/fence values are bound
  by unique constraints. The one-read consumption must include a NEW
  64-character high-entropy read_challenge; there can be only ONE
  consumption per signed scope. The minimal auditor gets EXECUTE on ONE
  additional SECURITY DEFINER boolean function, never SELECT on ledger
  tables. That function returns TRUE only for a COMMITTED, fresh, exact
  issuer+consumption row and exact challenge before signed expiry.
  SECURITY DEFINER and owner-bound issuance must receive INDEPENDENT
  security review. The SQL is NOT applied and creates no live login.
- deploy/ai-coding-standalone-dev/gpt02_issue159_native_relock_attestation.py
  adds attest_persisted_read_consumption(), using the existing pinned
  low-privilege auditor identity and a bounded READ-ONLY parametrized SQL
  call, not a privileged postgres admin credential.
- The EXISTING uninstalled one-shot review broker generates a fresh
  cryptographically random 256-bit challenge for EACH invocation,
  passes it to consume_scope_once(candidate,challenge), validates its
  self-reported echo, and queries the independent native auditor with
  that same challenge BEFORE attempting a reader connection.
  A prior successful consumption cannot validate a fresh second
  challenge because the ledger's scope PRIMARY KEY is already used.
  Missing/false/malformed audit or DB exception enters mandatory relock;
  the broker still never issues credentials/signs/dispatches.
- scripts/dev/test_gpt02_issue159_independent_read_consumption_pg.py
  runs the original signed task fixture and both proposed migrations in a
  networkless disposable PG16, as a non-superuser migrator. Tests a
  dedicated low-privilege audit login without direct ledger/task/pg_authid
  access; issuance-only or uncommitted consumption is FALSE; two
  simultaneous consumption attempts produce exactly one COMMIT;
  wrong task/command/attempt/receipt/fence/packet/challenge is FALSE;
  previously committed consumption is FALSE for a fresh challenge;
  ledger UPDATE/DELETE/TRUNCATE are blocked.
  Native test PASS, exit0 and container removed.
- scripts/dev/test_gpt02_issue159_one_shot_reader_broker.py asserts exact
  consume -> native persisted readback -> bounded lineage read -> relock ->
  native relock audit order; forged supervisor claims, old/fake audit
  results, bad TLS or connection identity, query timeout, unknown commit,
  and missing auditor all fail closed. 40/40 offline unittests PASS.
- The existing GitHub Actions positive-permit Draft workflow runs both
  new and prior tests. No separate deploy workflow was introduced.

CRITICAL LIMITATIONS: the proposed ledger has no real owner-reviewed
privileged broker/writer; native readback is evidence of a committed row,
NOT proof that the signer approved this NEW operation unless the existing
pinned verifier and Super Admin readback are genuine. A database owner could
still ALTER its own DDL; immutable triggers cannot replace owner custody,
independent change audit or backups. The one-time challenge does not stop
a compromised unrevoked PostgreSQL password from bypassing the broker
until relock; fixed short RLS TTL, credential custody, backend termination
and independent crash watchdog are still mandatory. The audited boolean is
a point-in-time check, not a permanently enforceable release token.

No CST-DEV/PROD database schema, real role, role password, service or
signer/dispatch/DELL path has been modified. The PR remains Draft and
LIVE_CREDENTIAL_ISSUANCE=NO_GO, FINAL_ACK=NO_GO.


## Restricted, native one-read consumption writer — 16 Nov 2026

The prior Draft had a VERIFIED committed-consumption boolean readback but
no source adapter implementing the database WRITE/CONSUME side. Relying on
a broad postgres owner connection in the broker would cross the owner
custody boundary and expose private ledger write privileges.

An additional SOURCE-ONLY SQL extension,
docs/dev/gpt02-issue159-one-read-consumer-rpc.PROPOSED.sql, now proposes
the dedicated role dev_gpt02_reader_claim_consumer, which starts
NOLOGIN/NOINHERIT/NOBYPASSRLS/connection-limit 0 and has ZERO direct
SELECT/INSERT/UPDATE/DELETE on the private ledger or access to the
five original lineage tables. The only privilege is USAGE on the
private auditor schema and EXECUTE on one SECURITY DEFINER function
consume_reader_once(name,text,text,uuid,uuid,uuid,uuid,text), not exposed
to PUBLIC, issuer/lineage, or the low-privilege relock auditor.
The function rejects wrong session_user, malformed names/hashes/challenges,
wrong signed packet/scope/command/attempt/receipt/fence, and expired
issuance. INSERT ... ON CONFLICT DO NOTHING on the exact one-read PK
returns TRUE only for the first committed claim. No dynamic SQL,
credential grant, signer or dispatch side effect.

The EXISTING uninstalled broker now also provides
consume_once_via_pinned_connection(connection,candidate,challenge), an
injectable fixed-query adapter using a separately supplied consumer
connection. It pins the native consumer pooler username, database,
host/port, libpq verify-full/CA and autocommit=false; verifies signed
scope/hash, lease, and challenge; executes only SET TRANSACTION READ WRITE,
SET LOCAL statement_timeout, and one fixed parameterized
consume_reader_once RPC; and returns an inert receipt ONLY AFTER a
definite successful connection.commit(). FALSE/NULL/duplicate DB result,
unverified TLS, query failure and uncertain commit fail closed with
rollback attempts. The main broker STILL independently queries the
low-privilege auditor's committed ledger via fresh challenge BEFORE any
reader SELECT, and relocks/audits afterward.

The EXISTING networkless PG16 test now additionally executes this
consumer proposal using a disposable non-superuser migrator and
temporary consumer LOGIN (test only): it proves actual native two-session
concurrency yields EXACTLY ONE TRUE and one FALSE, forged/expired/no
issuance denied, direct ledger/pg_authid/private table reads and ALTER
ROLE denied, unexpected postgres session_user denied, and both consumer
and auditor returned to NOLOGIN/password NULL afterward. It retains
the signed task/nonce/receipt lineage fixture and immutable ledger/false
replay checks. The existing offline broker tests now cover this adapter:
47/47 PASS, including commit-unknown and precise query binding. No new
workflow was created; the existing Draft CI triggers on this SQL path
and runs both relevant original suites.

Important unresolved boundary: a trusted service/owner must still create
an issuance row from genuine persisted Super Admin approval and securely
supply the dedicated consumer TLS connection. No consumer service or
credential exists on CST-DEV, no unit is installed, and the proposed
SECURITY DEFINER must receive separate independent privilege review before
any schema/role/RPC is deployed. A committed one-use ledger does not
prevent direct password reuse before the scoped reader is relocked;
a short fixed RLS TTL, private credential, backend termination,
fail-closed native relock and crash watchdog remain mandatory. All
source work remains PR Draft, LIVE_ISSUANCE=NO_GO and FINAL_ACK=NO_GO.

## Verified approval-to-ledger issuance review — 16 Nov 2026

The source-only `scripts/dev/gpt02_issue159_scoped_policy_proposal.py`
now includes `review_issuance_bindings_from_authenticated_signed_packet(packet)`.
It calls the **existing** pinned four-root verifier / persisted Super Admin
approval and exact-lineage readers through
`inspect_postlineage_scoped_reader_candidate`; it does not trust a caller's
role, clock, packet hash, expiry, approval flag or signature roots. The
resulting fixed field set matches the nine signed identifiers in the
`reader_issuances` proposal plus an absolute, proposed expiry derived from
the signed packet. The preview expiry is the earlier of the signed
approval/link/issuer lease and 15 seconds after the trusted local review
clock; it must have at least 3.5 seconds remaining.

This is strictly a **review-only binding proposal**. It returns
`ownerIssuanceCommitted=false`, `databaseWritePerformed=false`,
`credentialIssuancePermitted=false` and `releaseDecision=NO_GO`.
It contains no INSERT, transaction writer, DSN, credential, new service,
signer activation or dispatch. It cannot replace the independent
authenticated PostgreSQL writer or validate a committed ledger row.

An eventual owner-reviewed service must still enforce the signed expiry
**inside the same database transaction as INSERT**, including a DB-clock
lifetime limit and exactly-once uniqueness; reject changed, expired or
revoked approval/lineage; use an independently protected least-privilege
credential; and prove the committed row via the existing independent
auditor before allowing one bounded reader transaction. The 15-second
source review bound is **not a database constraint today**. A privileged
owner can still bypass or alter source-only checks; a SECURITY DEFINER
and ownership review is mandatory before any live SQL apply.

The existing isolated regression suite tests the signed task/command/
attempt/receipt/fence/role/packet binding, the 15-second or shorter expiry,
denial for modified signed claims, substituted public roots and expired
leases, and perpetual NO_GO flags. On the exact Draft head
`449c5bc441b818c61fb81f7e440a930dd2f1e738`, the source suite
passed 8/8 tests (exit code 0) on a temporary checkout of authorized
VPS `srv1792369`. No CST-DEV/PROD roles, RLS, service or credentials
were changed. Final live issuance and Final ACK remain NO_GO.

## PostgreSQL-clock issuance proof — 16 Nov 2026

Issue159's source-only signed issuance review preview is now followed by
an **additive, still UNAPPLIED** PostgreSQL database-clock proposal:
`docs/dev/gpt02-issue159-reader-issuance-server-clock.PROPOSED.sql`.
It depends on the existing private one-read ledger proposal and REQUIRES
both ledger tables to be empty when installed. It creates no new LOGIN,
owner writer, signer, dispatch path, credential, service or DELL command.

The proposal adds a SECURITY INVOKER BEFORE INSERT trigger to the existing
`gpt02_relock_audit.reader_issuances` table. PostgreSQL writes `issued_at`
from its own `clock_timestamp()`, replacing any caller-supplied value.
The trigger refuses an expiry no more than 3.5 seconds ahead, more than
15 seconds ahead, or NULL. A validated CHECK constraint also requires
`expires_at` to be strictly between `issued_at+3.5s` and `issued_at+15s`.
It has no new EXECUTE or table-DML grants to the auditor or consumer.
This is server-clock **TTL enforcement**, NOT proof of a signed approval.

The independent networkless PostgreSQL16 test
`scripts/dev/test_gpt02_issue159_issuance_server_clock_pg.py` reuses the
previous pinned four-root signed-packet verifier and inert preview with a
SYNTHETIC authenticated persisted-approval readback. It constructs a
fresh signed fixture only **after** database readiness, uses a
non-superuser owner to apply proposed SQL in the disposable DB,
asserts rejection of forged `issued_at` / 60-second / expired / too-short /
NULL expiry, injects a precommit rollback, commits exactly one private
issuance, rejects a second INSERT for the same scope, and invokes the
existing low-privilege consume/audit boolean RPC with a fresh challenge.
Test-only auditor/consumer LOGINs return to NOLOGIN/PASSWORD NULL.
Final exact checkout at `c9b2cc7f899fcf34d2d17421527193b7e08b03ee`
exited 0 with the expected PASS markers on VPS `srv1792369`;
the test fixture is networkless and automatically removed.

**Unresolved critical trust boundary:** the DATABASE cannot independently
verify four Ed25519 signatures or that a real logged-in Super Admin
approved this exact command. The signed packet/readback is verified
UPSTREAM, and the positive fixture simulates that readback; a privileged
database owner could still INSERT arbitrary scope data or modify the DDL.
No reviewed privileged issuance RPC, independent real approval-to-INSERT
atomic enforcement, credential custody, watchdog or live scoped role exists.
A 15-second DB TTL does not stop reuse of a leaked password during those
15 seconds, so an exclusive supervisor + active-session termination remain
mandatory. Approval revocation and DB-clock check at issuance must be
independently reviewed before any live DEV apply. This is NOT authority
to merge/enable signer or dispatch; LIVE ISSUANCE and Final ACK stay NO_GO.

## Persisted approval recheck and non-atomic expiry gap — 16 Nov 2026

The operational approval evidence path reuses the EXISTING four-signature
verifier, its `verify-approved-packet` readback and the private SQLite
approval-intent reader. A successful signed packet alone is NOT enough:
the verifier must requery the persisted Super Admin approval on each call.

An exact-head, source-only regression on the authorized VPS
(`073e58bfb145ea7e1336088d94150d79e8197a5f`) has added three real
temporary SQLite + private Unix-socket tests to the existing
`scripts/dev/test_gpt02_issue159_writer_broker_runtime.py`: an unchanged
validly signed packet is REJECTED after its persisted approval expires,
after the mapped Super Admin becomes disabled between two requests,
and after deletion of the persisted approval row. All 3/3 tests PASS,
exit code 0. These are synthetic stores and ephemeral keys; no live
Super Admin approval was created or modified.

A direct READ-ONLY inventory of the actual DEV approval store on
`srv1792369` returned `approvalStoreReadable=true`,
`unexpiredApprovalIntents=0`, `pendingClaimsFilePresent=false`,
`reason=NO_UNEXPIRED_PERSISTED_APPROVAL`, and `releaseDecision=NO_GO`.
The inventory script deliberately exits 3 for NO_GO. This is a current
operational blocker, not a request to mint a temporary approval.

**Open security boundary:** the SQLite approval readback currently
proves its expiry only at the time of the verifier request; the
separately proposed PostgreSQL issuance INSERT is not atomic with that
SQLite lookup. The readback response does not yet provide an independently
bound persisted-approval `expiresAt` for constraining the proposed
PostgreSQL ledger TTL. The signed-packet lease and 15-second DB-clock
maximum are necessary but do NOT close this cross-database
time-of-check/time-of-use and post-approval revocation window.

Before any live issuance, independently review a verified, fresh approval
expiry/readback binding, revocation semantics, a restricted and
credential-protected owner writer that rechecks immediately before
INSERT, the exact DB-clock expiry limit, and guaranteed reader relock
plus independent watchdog. Until then the approved packet remains only
NO_GO review evidence. This PR stays Draft; no CST-DEV roles, credentials,
ledger tables or service configuration are activated and PROD/DELL dispatch
remains unchanged.

## Fresh persisted SQLite expiry carried into inert ledger preview — 16 Nov 2026

The existing read-only `gpt02_issue159_approval_intent_reader.py` now
returns `decision.expiresAt` from the same uniquely matched SQLite approval
row used for the Super Admin, task, command, attempt and claim-digest
evidence. The existing private writer/verifier reader validates that the
expiry is a strict integer, later than the observation, later than recorded
time, and at most 300 seconds after it. It returns the expiry as **read-only
evidence**; it does not grant signing or issuance authority.

The SOURCE-ONLY `review_issuance_bindings_from_authenticated_signed_packet`
now performs an additional **fresh** persisted-approval socket lookup AFTER
its pinned four-signature and lineage candidate verification, then caps
the proposed one-read expiry at the earliest of:

- The signed approval/link/issuer lease.
- The expiry stored in the matching, currently-enabled Super Admin's
  SQLite approval row.
- The review-time +15-second ceiling.

The reviewer rejects missing, malformed, stale, implausible or insufficient
remaining approval time instead of silently extending the expiry. Caller
override of keys, clock, approval digest, role or expiry is still unavailable.
The result remains `ownerIssuanceCommitted=false`,
`credentialIssuancePermitted=false`, `databaseWritePerformed=false` and
`releaseDecision=NO_GO`.

Evidence in the existing Draft test suite:

- Native SQLite reader test checks that returned `expiresAt` matches the
  actual approval row, with no new write surface.
- Private Unix socket readback test rejects an omitted or forged 600-second
  expiry even if other claimed approval flags are true.
- Source-only test clamps the inert issuance TTL to a stricter stored expiry
  and rejects missing, expired, too-short or implausibly future readbacks.
- An E2E synthetic SQLite + actual private Unix socket test reuses a fresh
  ephemeral four-signed packet, returns a shorter persisted expiry, verifies
  the resulting TTL is no later than that expiry, and confirms a later
  revocation is observed by the next readback.
- The earlier disposable PostgreSQL-16 TTL/rollback/one-use proof is retained;
  its signed approval reader is explicitly simulated and marked as such.

Direct tests passed on an exact fresh checkout of commit
`c25d765f2daeaec5f2f2087060d3abe500c5980d` on
`srv1792369`: 10/10 source tests PASS, exit code 0; the previous exact
checkout also passed 17/17 narrower source tests and the networkless PG16
issuance/consumption suite. No live approval, ledger, database role,
credential, signer, dispatch, DELL or PROD was changed.

**Critical NO_GO boundary remains:** SQLite and PostgreSQL do NOT share an
atomic transaction. A later approval revocation after the fresh socket
readback but before PostgreSQL INSERT cannot be ruled out by this preview
or the DB-clock 15-second constraint. The PostgreSQL ledger currently
enforces its own TTL, NOT the independently authenticated origin of
the SQLite approval expiry. A trusted owner-reviewed issuer still needs
a revocation-consistent protocol, a real persisted Super Admin approval,
dedicated credentials and an independent watchdog. Do NOT interpret this
source-only clamp as permission to enable operational issuance.

## Cross-store approval revocation TOCTOU — actual negative control, 16 Nov 2026

This section documents a **verified gap**, not a successful security
authorization or an operational fix. A SOURCE-ONLY test was added to the
existing `scripts/dev/test_gpt02_issue159_issuance_server_clock_pg.py`,
reusing the previously approved synthetic signed packet and non-superuser
owner/PG16 fixture. After a verified *real* SQLite approval readback, the
test disables the matching Super Admin in its temporary SQLite store.
The canonical SQLite reader correctly returns
`persistedTrustedReadProven=false`. The test then uses the separate
PostgreSQL owner connection to attempt the previously reviewed issuance
INSERT. Because the private PostgreSQL ledger has no synchronously
maintained SQLite revocation fence, the INSERT **still succeeds** while
the transaction is open. The negative test immediately performs
`ROLLBACK`, checks that the ledger contains zero rows, and prints
`EXPECTED_GAP_SQLITE_REVOKED_BUT_PG_INSERT_ACCEPTS_NO_GO`. This marker
indicates a vulnerability reproduced **in an isolated fixture**, not
that a live reader permission was granted or any live database was
exposed. No operational account, credential or approval is used.

To make the risk visible to future caller integrations, the inert
`review_issuance_bindings_from_authenticated_signed_packet` result now
contains `crossStoreAtomicityProven=false` and
`revocationAtIssuanceProven=false` in addition to
`ownerIssuanceCommitted=false` and `releaseDecision=NO_GO`.
Existing reviewer tests assert these flags explicitly. The current
SQL-only 15-second TTL, signatures, challenge ledger, native relock,
fresh readback and retry denial are necessary but **not sufficient**.

An independent release/security review must select and implement an
authoritative, **linearizable revocation/issuance boundary** before
any live change. Acceptable designs could centralize active approval,
revocation state and one-use issuance in one strongly consistent
PostgreSQL transaction (with role/identity proof verified externally)
or introduce a fully reviewed cross-store coordinator whose revocation
and issuance operations cannot interleave without durable fencing.
A read-only SQLite probe followed by PostgreSQL INSERT, a best-effort
mirror, or a short TTL alone is NOT such a boundary.

Mandatory fail-closed acceptance scenarios before removing NO_GO:
- Revocation committed before issuance: issuance denied, no PG row.
- Revocation races between final evidence check and PG COMMIT: either
  issuance is serialized behind the authority or later consumption is
  durably fenced and refused, including after crashes/retries.
- Revocation committed after issuance but before one-reader consumption:
  consumer cannot open a scoped reader even when issuance was once valid.
- No owner or consumer secret escapes, no accidental extra reader query,
  no signer/worker/DELL path, and all existing no-dispatch CI remains PASS.

**Current disposition:** no cross-store authority/coordinator exists.
The test is intentionally rollback-only. This PR must remain Draft,
LIVE ISSUANCE=NO_GO, SIGNERS/DISPATCH OFF, FINAL ACK=NO_GO; do not
activate any DEV/PROD role or modify operational approval state.

## Canonical PostgreSQL fence serialization model — 16 Nov 2026

This section documents a **source-only proposal and disposable PG16 model**,
not a production architecture decision, permission to migrate live SQLite
approval state, or an operational credential issuer.

An additive, NOT-APPLIED SQL proposal lives in
`docs/dev/gpt02-issue159-canonical-approval-fence.PROPOSED.sql`.
It depends on the pre-existing private issuance/consumption ledgers,
server-clock TTL trigger and bounded consumer RPC. The proposal creates a
new private PostgreSQL `reader_approval_fences` canonical-authority model
with FORCE RLS and owner-only access. One-way revocation rejects
reactivation, rebinding and deletion. The issuance and consumption INSERT
triggers take a PostgreSQL `FOR SHARE` row lock on the same authority
entry, checking exact scope/packet/role/task/company/command/attempt/
receipt/fence, active revocation status and expiry. A concurrent UPDATE
revocation obtains a conflicting row lock and is serialized against
issuance/consumption. No new LOGIN, worker, signer, dispatch, private key,
credential factory or live service is created.

The corresponding disposable test
`scripts/dev/test_gpt02_issue159_canonical_approval_fence_pg.py`
runs only on a network-isolated PG16 fixture with a non-superuser owner.
It verifies:

- A committed revocation BEFORE issuance denies a new ledger row.
- A native PostgreSQL revocation that holds a row lock while a separate
  issuer tries INSERT serializes correctly: the waiting issuer fails
  after revocation commits, leaving no issuance.
- A signed synthetic candidate can be issued to the private ledger,
  then revocation BEFORE one-read consumption prevents that claim.
- An active canonical approval permits exactly one normal private
  consumption, with no direct consumer access to the authority ledger.
- Reactivation, role/task rebinding and delete attempts fail closed.
- The existing **unmodified boolean persisted-consumption auditor can
  still report TRUE for an already committed claim AFTER canonical
  approval is revoked**. The expected negative-control marker is
  `EXPECTED_GAP_COMMITTED_CLAIM_AUDIT_STALE_AFTER_REVOKE_NO_GO`.

These tests were executed on authorized VPS `srv1792369` from a
separate checkout (tested head `95984c4c39ed18c8f26e8801f642c8bae8a01869`):
all assertions completed with exit code 0, including the explicitly
EXPECTED GAP. The tests do NOT access the live CST-DEV approval store,
issue live reader passwords, or authorize a Final ACK.

**Why this does not resolve the live blocker:** current operational
approval decisions still originate in a separate SQLite database.
Populating a proposed PostgreSQL canonical table as an asynchronous
copy would create split-brain approval/revocation authority and would
NOT close the confirmed cross-store race. Only a reviewed, controlled
authority migration/cutover (or equivalently strong cross-store fencing
protocol) could make the new table authoritative. The present
PostgreSQL consumed-ledger auditor also remains stale after later
revocation, so last-mile reader admission cannot rely on its historical
TRUE alone. Any final reader must prove the approval is current and
hold an appropriate fence until the one bounded read completes; active
session termination, RLS read-time revocation, crash/watchdog cleanup
and post-consumption revocation must be tested. This is not an
automatic promise of instantaneous termination of already-running SQL.

Before any live DEV apply, require external independent security review
of all SECURITY DEFINER routines and owner DDL, approval provenance,
explicit source-of-truth/cutover and rollback, durable revocation sequence,
a least-privilege reader/consumer/fence credential custody plan,
independent watchdog, exact task/attempt, and full Final ACK E2E.
Do not use the real `postgres`, shared lineage or attestor credential
as a shortcut. PR remains DRAFT, LIVE ISSUANCE=NO_GO,
SIGNER/DISPATCH=OFF, FINAL ACK=NO_GO and PROD unchanged.

## Canonical final reader guard — 16 Nov 2026

This is a **NOT-APPLIED, SOURCE-ONLY security proposal**. It extends the
existing canonical PostgreSQL approval/revocation model, which itself
is only a disposable alternative to the still-active SQLite approval
source. It does NOT authorize any live source-of-truth cutover, reader
password, new service, signer, dispatch, or Final ACK.

An additive `docs/dev/gpt02-issue159-canonical-reader-guard.PROPOSED.sql`
defines dormant role `dev_gpt02_reader_admission_guard` (NOLOGIN,
NOINHERIT, NOBYPASSRLS, CONNECTION LIMIT 0) with only a narrow EXECUTE
grant on `canonical_reader_current_guard`, plus no direct table SELECT.
The SECURITY DEFINER boolean function verifies native `session_user`,
the exact scoped role/packet/command/attempt/receipt/fence and fresh
challenge, a genuinely committed one-read consumption ledger row, and
an **unrevoked, unexpired canonical PostgreSQL approval**. Critically,
it takes `FOR SHARE OF f` on the canonical approval row.

A TRUE result is useful **only while the caller holds an explicit
READ WRITE PostgreSQL transaction open** across the ONE bounded reader
query; in autocommit mode the row lock is released immediately and
the result has NO admission authority. A separate, reviewed supervisor
must keep that exact guard transaction open until the reader query and
session terminate; limit statement and idle-in-transaction timeouts;
and handle crash cleanup and relock. The source proposal has no
supervisor, reader-connection adapter, credential issuer or callback.

Native, networkless PostgreSQL16 tests were added to the existing
`scripts/dev/test_gpt02_issue159_canonical_approval_fence_pg.py`,
using a test-only temporary LOGIN for the guard. They prove:

- A correctly consumed claim with current approval returns TRUE via
  the new native guard; the same committed historical consumption returns
  FALSE through the new guard after approval revocation, even while the
  **unmodified historical auditor still returns TRUE**. The original
  auditor is not redefined or silently weakened.
- A wrong native PostgreSQL `session_user` cannot execute the guard.
- A guard `BEGIN ... canonical_reader_current_guard(...) ... pg_sleep ...
  ROLLBACK` holds a native `FOR SHARE` lock during the simulated,
  bounded operation. A competing revocation UPDATE times out rather than
  committing while the lock is held; after guard rollback, revocation
  commits, and a new guard read returns FALSE.
- Guard role returns to NOLOGIN/PASSWORD NULL in the isolated fixture;
  neither the auditor nor consumer receives EXECUTE on the new guard.
- Existing one-time consumption, TTL, row-level RLS and immutable
  issuance ledger tests remain intact.

**Scope limitation of the positive concurrency test:** `pg_sleep` is
only a bounded-read *proxy*. This test does not run an actual scoped
five-table reader SELECT while retaining a trusted guard transaction,
and does not demonstrate crash/timeout termination of an already-running
read. It also cannot guarantee immediate revocation during a query:
the revoke correctly WAITs for the row lock to release. Any release
policy must make that timing and rollback expectation explicit.

**Mandatory remaining NO_GO conditions:** migration of real approvals
away from the active SQLite source must be independently designed
with proof against split-brain/replay and a rollback plan. The
SECURITY DEFINER guard itself requires independent source, ownership,
ACL and transaction-lifetime review. A trusted supervisor must prove
one guard for one reader SQL, exclusive credential custody, no leaked
password, active reader session termination and watchdog on crash,
stale guard/replay denial, and final E2E signed attestation. None of
these are made operational by this Draft.

Direct isolated PG16 run at commit
`2371030308f7dc515c235d0fb0fd11a5ab9164e1` on `srv1792369`
completed exit code 0 with markers
`PASS_CANONICAL_GUARD_CURRENT_APPROVAL_DENIES_STALE_AUDIT`,
`PASS_GUARDED_TRANSACTION_BLOCKS_REVOKE_UNTIL_BOUND_READ_DONE`,
and `PASS_GUARD_RECHECK_DENIES_AFTER_BOUNDED_READ_REVOKED`.
This is regression evidence, NOT release approval. PR remains Draft;
LIVE ISSUANCE, signer/dispatch and Final ACK stay NO_GO.

## Actual five-table guarded reader proof and password-reuse blocker — 16 Nov 2026

The existing Draft `scripts/dev/test_gpt02_issue159_canonical_approval_fence_pg.py`
has been extended to use the **ORIGINAL five-table lineage SQL** from
`gpt02_issue159_lineage_readback_contract.TRUSTED_LINEAGE_SQL` and the
already-tested `FIVE_TABLE_FIXTURE`/signed Task170 scope. The fixture
contains two same-company tasks and explicit PostgreSQL FORCE RLS
policies for `approvals`, `operator_links`, `receipts`,
`core_identity_receipts`, and `post_consumption_fences`. No
replacement query, changed signed packet, or new source of credentials
was introduced.

Two separate native PostgreSQL connections are used in a single
network-isolated disposable PG16 database: an authenticated, transaction
holding `canonical_reader_current_guard` that locks the exact canonical
approval `FOR SHARE`, and a separate task-scoped NOINHERIT reader that
executes **exactly one bounded SELECT containing the original five-table
JOIN**. The SELECT includes a test-only `pg_sleep(4.0)` expression to
expose the concurrency window; a separately authenticated revocation
UPDATE receives a statement timeout rather than committing while the
guard transaction is held. After the query finishes and the guard
releases the lock, revocation commits and a new guard returns FALSE.
A test-only cleanup transaction revokes SELECT/USAGE, sets the task
role NOLOGIN/CONNECTION LIMIT 0/PASSWORD NULL, terminates its sessions,
and verifies a new login using the prior password fails.

**CRITICAL EXPECTED SECURITY GAP:** Even though the new canonical guard
correctly returned FALSE after revocation, a DIRECT second connection
with the still-live scoped reader password successfully ran the same
original five-table lineage query BEFORE relock. The regression prints
`EXPECTED_GAP_DIRECT_PASSWORD_REQUERY_BEFORE_RELOCK_NO_GO`.
The separate guard transaction alone **does not gate the native task
reader's SQL**. The test's final successful relock is not proof of
exclusive credential custody or absence of a reuse window. This is
a release blocker; do not interpret the synthetic successful guarded
read or historic audit TRUE as operational permission.

An initial test attempted to find `pg_sleep` in the tail of
`pg_stat_activity.query`, but PostgreSQL truncates the text of long
queries. The test now identifies its native reader connection through
a dedicated test-only `PGAPPNAME`, while retaining the unchanged
five-table SQL and RLS. Direct run at head
`0a16b2fc1e7c4d511f24aad52f6d3fe8604aae91` on
VPS `srv1792369`: PASS with exit code 0, including
`PASS_ONE_REAL_FIVE_TABLE_LINEAGE_SELECT_UNDER_HELD_GUARD`,
`PASS_DISPOSABLE_FIVE_TABLE_READER_RELOCKED_NO_REUSE`, and the
above explicit EXPECTED GAP marker. All fixture containers are
removed on exit. This is SOURCE-ONLY, not a test using real
CST-DEV approvals or task rows.

Before any live issuance, a separately reviewed single owner/supervisor
must prove **one credential, one allowed SELECT, no extra sessions,
immediate native relock on success/failure/crash, and durable revocation
for orphaned connections**. A row-locking guard and a voluntary client
check do not supply these properties by themselves. Verify that a
compromised direct reader login cannot bypass live revocation under
the final design (e.g. a reviewed revocation-aware DB RLS fence plus
independent watchdog), without creating callable privileged backdoors.
The current SQLite approval source is NOT migrated to the canonical
PostgreSQL model. NO GO for live reader, signers, DELL dispatch, and
Final ACK; PR remains Draft.

