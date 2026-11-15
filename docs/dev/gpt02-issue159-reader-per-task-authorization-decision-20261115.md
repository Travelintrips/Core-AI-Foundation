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

The minimum viable live role remains unavailable until the entire privileged
issuer/cleanup/watchdog model, role provenance, timestamp validity,
credential custody, and external owner-approved task are independently
reviewed. Never treat a synthetic TRUE as deployment authorization.
