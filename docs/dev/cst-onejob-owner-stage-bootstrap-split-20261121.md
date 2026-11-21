# CST-DEV — separate Super Admin WAITING bootstrap from signed job execution

**Candidate source only / NO-GO for service deployment, 21 Nov 2026.**

## Verified bootstrap deadlock on existing VPS
The current root-owned unit /etc/systemd/system/cst-onejob-owner-stage.service
is inactive, has RefuseManualStart=yes, and requires both
/etc/cst-onejob-dev/operator-trust/release-public.pem and
/etc/cst-onejob-dev/approved-public/owner-stage.json. Its Docker launch
uses --network none. Those files do not exist, and a network-none
container cannot authenticate to Supabase. The public Nginx preview
forbids the Owner approval POST with HTTP 403.

The app's one-click code, on the other hand, is designed to create
the exact Owner-approved WAITING job + approval ID + candidate root
audit FIRST. The independent job-specific Operations authorization and
QA PRE receipt require those IDs, so making approved job-release files
a prerequisite for WAITING is circular.

## Split the two gates without relaxing either

**Gate A / WAITING-only technical bootstrap (new source candidate):**
- Use the same existing Core authenticated internal owner JWT cookie.
  The API requires role owner, current database active Owner, a session
  issued within 20 minutes, exact same-origin HTTPS POST JSON and
  exact one-job request body with the public candidate fingerprint.
  This is the only human business click; no second account, password,
  AAL2, or KMS is needed.
- Run a separate role-scoped backend on an approved fixed-egress DEV
  network with a localhost-only port. Load the EXISTING Core session
  signing secret by a systemd-encrypted credential, not a new issuer.
  The public-stage source is pinned to its exact image source stamp.
- Reuse the existing encrypted dedicated CST-DEV stage database URL,
  pinned Supabase CA and staging login with NOINHERIT and connlimit=1.
  Temporarily enable that role for a short, auditable test/approval
  window with automatic relock. The public source/worker config is a
  root-owned technically approved QA receipt, not a new Owner decision.
- No Operations release-public key, signer authorization, admission
  function, signed QA receipt or worker is required to create WAITING.
- In one transaction the Owner session creates exactly one WAITING job,
  one Owner approval and one immutable audit tying the same Owner to
  the candidate root fingerprint. The stage role is relocked promptly.
  Without the signed technical gates, WAITING remains nonclaimable.

**Gate B / separately authorized operational execution (existing):**
- Only after genuine Owner job ID, approval ID, and matching authenticated
  audit readback exist may independent Operations custody authorize/pin
  the public root, issue one job-specific Ed25519 authorization and
  short-lived stage-specific technical permits. The existing QA PRE,
  one-use signed admission capability, subscriber ACK, four agent
  attestations and reviewer Final ACK remain mandatory.
- A matching public candidate fingerprint is not in itself root trust.
  Ops source pin remains null/None until separately attested,
  then the signed release installer must verify its immutable source.
- Never switch a generic queue endpoint to QUEUED or claim E2E PASS
  based on a stage-only bootstrap, source CI, QA fixtures or the Owner
  click alone.

## Current candidate source and explicit remaining implementation gates

New source-only artifacts:
- deploy/cst-onejob-vps/owner-stage-bootstrap/
  cst-onejob-owner-stage-bootstrap.service.CANDIDATE
- deploy/cst-onejob-vps/owner-stage-bootstrap/entrypoint-stage-only.sh
- deploy/cst-onejob-vps/owner-stage-bootstrap/
  cst-onejob-owner-stage-routing.nginx.CANDIDATE
- scripts/dev/cst-onejob-owner-stage-bootstrap-split.test.mjs

These are **not active service files**. Current root-owned
cst-onejob-owner-stage.service and public Nginx denial are unchanged.
The immutable image d3cd194b is a VERIFIED SOURCE CANDIDATE only and
must be restamped/reviewed against the CURRENT PR SHA during cutover.

To promote Gate A, developer QA still must:
1. Review/build exact source image and provision a fixed-egress network
   with verified DNS/TLS and default-deny ports; never use --network host
   or broad internet access.
2. Capture a private encrypted copy of the already-existing DEV Core
   SESSION_SECRET for the stage-only unit (no logs or generated issuer),
   prove it matches the existing cookie issuer, and install a root-only
   public source/worker identity receipt. No credentials are supplied
   by the Owner in chat.
3. Prove bounded stage PostgreSQL login and an automatic NOLOGIN relock
   with zero residual sessions. Existing read-only real connection
   tests have passed, but a productionized scoped JIT lease is not
   yet installed in the new service.
4. Test the exact backend with the existing authenticated Owner session
   through a rollback-protected canary, and verify anonymous 401,
   non-owner 403, stale JWT 403, wrong origin 403, one-use POST, no
   duplicate on network response loss, and all signer/dispatch OFF.
5. Replace ONLY exact Nginx Owner readiness/status/approval routes in
   one atomic DEV promotion after those proofs. Preserve prior
   routes/hashes and rollback. Do not ask Owner to click an absent or
   disabled button.

The candidate entrypoint has source-stamp, fixed public fingerprint,
private DB credential, same Core session credential, CA and worker/
dispatch-off guards. The functional Owner approval feature is true
ONLY INSIDE THIS UNINSTALLED SOURCE CANDIDATE. It must not be exposed
to public Nginx before the numbered security gates pass.

All existing DEV/PROD transactional features, eight signer units,
review-only admission capability and existing public preview remain
unchanged. Operator root/Final ACK/real E2E remain NO-GO.

## Gate-A/Gate-B broker lifecycle separation (source-only)

The existing operational broker scripts/dev/cst_team_onejob_operational_broker.py
is Gate B, and cannot bootstrap a Gate-A Owner WAITING transaction. It demands
jobId, ownerApprovalSha256, subscriberArmedSha256 in a signed manifest and
forwards one PostgreSQL session, then exits. Those identifiers only exist
after genuine Owner staging, and cannot be fabricated ahead of time.

Gate A candidate socket is now /run/cst-onejob-stage-db/pg-pooler.sock.
Gate B socket remains /run/cst-onejob-dev-db/pg-pooler.sock.
Source QA asserts separate paths and fail-closed transport.

A distinct, reviewed, pre-job stage-only broker with scoped egress,
non-root peer identity, bounded LOGIN lease and automatic NOLOGIN relock
is STILL MISSING. Also missing: verified Core session-secret custody and
actual signed Super Admin test. Source-only PASS is NOT operational GO.
No signed Gate-B permit is a substitute; keep signers/dispatch/PROD OFF.

## Gate A technical broker source candidate (not installed)

scripts/dev/cst_onejob_preapproval_stage_broker.py is a new independent
Gate-A pre-approval transport candidate. It accepts a **technical** Ed25519
manifest with scope PREAPPROVAL_STAGE_ONLY, not an Owner/QA job-specific
manifest, checks a separately pinned public key, exact source SHA, fixed
CST-DEV transaction pooler destination, peer UID/GID, current Linux network
namespace and already installed default-deny kernel egress rules. Signed
leases are at most 10 minutes; it forwards one connection then exits.
No database URL/secret, approval, role alteration, or dispatcher is created.

Critically, **source tests are not operational permission**. No trusted
technical public key, signed Gate-A manifest, root-owned source receipt,
reviewed kernel ACL or real non-root staging peer have been installed.
Current candidate bootstrap Docker container defaults to root while this
broker mandates an explicitly non-root stage peer; switching container user
without a reviewed encrypted-credential delivery mechanism would break
credential access. This identity/custody mismatch remains a hard NO-GO
gate. Do not use Gate-B signed job permits for Gate A.

## Systemd parser validation

The original candidate used an unsupported ConditionPathIsSocket directive;
systemd silently ignored that condition. It is replaced by the supported
ExecCondition=/usr/bin/test -S /run/cst-onejob-stage-db/pg-pooler.sock
in the source-only unit. Systemd parser review and absence handling must
pass before any installation. No unit was installed or started.

## Gate-A non-root staging client and systemd credential handoff

Source-only stage-credential-handoff.py prepares the two existing systemd
decrypted credentials in a fresh private /run (tmpfs) directory, UID 28502,
GID 28501, directory 0700 and files 0400. It rejects symlinks, stale paths,
unsafe source permissions and unexpected cleanup targets, and never logs
credential bytes. ExecStopPost removes only the managed temporary copies.

Candidate Docker client now runs --user 28502:28501. The host systemd
wrapper remains root only for Docker and encrypted credential staging.
Gate-A broker runs as distinct UID 28500/GID 28501 and checks SO_PEERCRED.

Synthetic systemd credential ownership and handoff tests PASS. No real
credentials were accessed. Actual unit credential lifecycle, non-root Docker
mount accessibility, session issuer custody, network egress, JIT LOGIN/relock
and real Owner approval remain NO-GO until independently tested.

## Isolated Owner-session reader: NO second shared Core database pool

The bootstrap source previously imported the ordinary requireAuth,
requireInternalRole(owner), and requirePasswordChanged helpers.
Those helpers query getInternalUserById through the shared Core database
pool. The isolated stage unit injects only the dedicated encrypted DB
credential, not the shared runtime DB. Thus the first signed Owner
request would otherwise require broad DB access or fail unnecessarily.

The three canonical DEV onejob paths now use only
requireCstOneJobStageOwner, a dedicated stage-only middleware.
Ordinary Core AI login, roles, sessions and other routes are unchanged.

Before any DB access this verifies the EXISTING internal_session cookie
signature with exact HS256 and the EXISTING Core SESSION_SECRET. It
rejects magic/reset tokens, role claims, nonnumeric user IDs and
expired, forged or anonymous cookies. It does not issue a new session.
The separate stage feature/environment gate remains fail-closed.

After cryptographic verification the dedicated stage connection uses
SET TRANSACTION READ ONLY and SET LOCAL ROLE
cst_team_model_pilot_writer, validates the exact PostgreSQL stage
session/current role and database, then RLS-selects only the signed
user's id,role,status,account_type,must_change_password. Only a
currently active internal Owner with must_change_password=false can
proceed to the existing readiness, recovery or stage handler. The
POST independently requires a fresh (20-minute) Core cookie and exact
same-origin intent, then rechecks Owner and job indexes in the atomic
WAITING-only transaction. No extra Owner action is added.

Only one missing column SELECT grant is required:
must_change_password on the existing ai_platform.internal_users
table for the already-provisioned NOLOGIN writer. The candidate
cst-onejob-stage-owner-password-state-read.CSTDEV-ONLY.sql verifies
exact roles, session count, enabled RLS with table owner postgres and zero approvals before
installing; it does NOT allow email, password_hash, UPDATE, DELETE or
LOGIN. The rollback is denied after any genuine Owner approval/session.

A PG16 Docker network-none test exercises the EXACT grant/revoke,
source tests cover JWT claim shape, three route bindings, missing
Owner, wrong role, suspended users, password-change pending and
no shared-pool fallback. The live stage remains NOLOGIN and its
public Nginx route stays read-only until the existing Core session
credential, bounded DB lease and fixed-egress network are safely
provisioned, and all end-to-end authorizations are independently
verified. No KMS, second human Owner consent, or PROD changes.

## Gate A session hard stop

Gate A no longer reuses Gate B's rolling-idle-only PostgreSQL forwarder.
A separate forward_stage_with_lease function projects the signed manifest
expiry to a monotonic deadline and terminates even under continuous traffic.
Idle timeout and byte cap still apply. QA uses synthetic AF_UNIX socket pairs.
This does not authorize real broker, database LOGIN, egress or dispatcher.

## Isolated JIT relock proof, not permission to open the real role

A source-only PostgreSQL 16 network-none test proves that a synthetic
dedicated stage role can temporarily LOGIN with CONNECTION LIMIT 1, but
merely setting NOLOGIN does NOT disconnect established sessions.
Correct relock includes NOLOGIN, targeted pg_terminate_backend for
that exact role, readback of zero residual role sessions, and denial
of any fresh login. Shared Core and real CST-DEV remain untouched.

A privileged time-bounded operational JIT controller with independently
approved custody, automatic failure cleanup/relock, durable deadline,
and Owner binding remains unimplemented. Zero backend sessions also
does not independently verify Supavisor transaction-pooler frontends.
Do not enable CST-DEV LOGIN from this isolated fixture proof.
