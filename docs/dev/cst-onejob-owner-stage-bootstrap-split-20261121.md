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

## Stage-only relock primitive and crash retry QA

Source candidate cst_onejob_stage_relock_controller.py is an import-only
relock primitive. It uses only a dedicated stage role name, sets NOLOGIN,
terminates residual connections of that exact role, and verifies both the
catalog flags and zero sessions before PASS. It is idempotent after a crash
or duplicate invocation. A bad role scope, unkillable sessions or unavailable
catalog raises an error instead of returning PASS. It CANNOT enable LOGIN.

Disposable PostgreSQL16 regression proves a live synthetic role session
is terminated and fresh login rejected. Another synthetic role stays untouched.
No operational CLI, timer or Supabase credentials exist in this candidate.
A genuinely authorized independent controller, signed release/admission
lease, server-side durable deadline, secure admin database access, and
Supavisor transaction-pooler frontend drain still must be built and tested.
This is **not automatic live relock** and does not authorize deployment.

## Relock security drift containment (source-only)

A dedicated role catalog with unexpected BYPASSRLS, SUPERUSER, INHERIT or
connection-limit changes must never return PASS. Earlier code aborted before
NOLOGIN and pg_terminate_backend; that could leave an existing stage session
running if role privilege drift was observed. The revised import-only relock
primitive now always attempts NOLOGIN and scoped session termination after
confirming the *identity* of the expected role, then reports drift as an
error after checking zero sessions. Invalid or missing catalog remains
fail-closed before mutation. This does NOT connect to live CST-DEV.

The four pure mock-based security tests PASS. This is not yet an operational
controller or proof of transaction-pooler frontend drain. No PROD or shared
runtime mutation. VPS free space is critically low; do not run another full
Docker acceptance loop or build additional images for this source-only fix.

## Owner WAITING HTTP ingress via Unix socket

VPS Docker testing found that an internal=true bridge produced a
3000/tcp: null mapping despite published localhost port configuration.
The host could not reach it. Never open a general bridge as a shortcut.

This source-only candidate instead uses Docker network none, a systemd
runtime directory /run/cst-onejob-stage-http, owner UID 28502, nginx
GID 33, mode 2750, and Unix socket api.sock mode 0660. The proxy inside
the container dials only local loopback TCP 127.0.0.1:3000. The Nginx
candidate uses exact Unix socket proxy_pass locations, not a host port.
This HTTP socket is distinct from both PostgreSQL Gate A and Gate B.

Disposable VPS test runs the exact source supervisor and confirms:
no container network or published ports; HTTP access by nginx UID 33;
expected socket ownership; socket cleanup after container stop.
Parser QA for the candidate systemd and Nginx configs also passed.
No live service or auth route was changed. NO-GO until genuine
approved authority, session issuer, stage database and E2E are verified.

## Broker process termination and socket cleanup

The Gate-A source broker now traps SIGTERM and SIGINT, marks the session
as stopped, prevents any new upstream connection, interrupts ongoing
forwarding on a bounded selector poll, and unlinks its Unix socket in
finally. The old default SIGTERM path could strand a socket on disk
and block the next authorized one-session attempt.

A standalone disposable VPS test launches the real Gate-A listener under
UID 28500/GID 28501, uses a private /tmp AF_UNIX socket, sends SIGTERM,
and verifies a nonzero stop verdict with no leftover socket. Kernel
egress is **mocked only in the disposable test**, no real pooler or
signed authorization exists; this does NOT approve a live broker.
An in-memory socketpair test also verifies signal interruption of an
already-open synthetic forwarded connection and upstream closure.

## Gate-A socket ownership and unclean crash QA

A real non-root VPS test now checks two concurrent listener candidates.
A second process cannot bind to the first listener's AF_UNIX path, and
its failure must never remove the first socket. If the path is replaced
while the old broker is running, the old instance detects the inode
difference at shutdown and leaves the replacement intact.

An uncatchable SIGKILL is different from SIGTERM: its socket pathname
can remain stale. The second start MUST fail closed with SOCKET_OCCUPIED,
rather than blindly unlinking and impersonating an old session. A future
systemd-managed broker RuntimeDirectory and independently reviewed
pre-start stale socket recovery are still needed for automatic crash
recovery; that portion is not implemented or operationally PASS.


## systemd-managed broker socket restart rehearsal

Real systemd v255 on VPS was used with two disposable root launcher services,
unique /run RuntimeDirectory, RuntimeDirectoryPreserve=no, and non-root
broker process UID 28500 / GID 28501 (via setpriv). Test A bound a synthetic
PostgreSQL socket mode 0660. After systemctl kill --signal=SIGKILL, systemd
removed the entire dedicated runtime directory. Test B recreated the same
directory and socket without stale-path cleanup, and graceful stop removed it.

IMPORTANT: systemd User=28500 FAILED with status 217/USER because the
numeric UID has no installed NSS passwd entry. The QA instead gave the
transient systemd root wrapper ownership of the runtime folder, then dropped
privilege for the synthetic socket process. This is not a live identity or
credential provisioning step; no OS accounts were installed.

This proves systemd cleanup semantics only. It does NOT create an approved
real broker unit, signed technical permit, kernel egress ACL, JIT database
controller, or Supavisor drain proof. Until those independent prerequisites
exist, operational Gate A remains NO-GO, with no automatic recovery claimed.

## Gate A broker systemd source-only candidate, not installed

The new cst-onejob-gatea-preapproval-broker.service.CANDIDATE source template
requires independently provided and reviewed technical trust material,
signed exact-scope staging permit, and independently reviewed network
namespace at /run/netns/cst-onejob-gatea-reviewed. The unit does not
generate trust material or network policy. It uses systemd RuntimeDirectory
with preserve=no and the proven root-wrapper-to-setpriv UID28500/GID28501
pattern; direct User=28500 failed under systemd 255 because the numeric
UID lacks an NSS account.

ExecCondition validates the technical manifest, pinned public key and
source commitment before privilege drop; the same validation is repeated
by the nonroot broker on run. The broker verifies real kernel nftables
default-drop policy and peer credentials before a single connection.
No Install section, Restart=no, no live service installation.

IMPORTANT: a receipt file existing is not proof of independent approval.
Independent authority, key custody, source pin, network ACL, and JIT
database LOGIN/relock remain required. Candidate is deliberately
unstartable on this VPS. No source PASS confers release permission.

## Gate A real kernel policy — disposable namespace QA

On VPS, a separately isolated Docker namespace was given an nftables
output policy allowing one mock destination on TCP 6543 and denying
a second mock destination. The test observed the permitted and denied
packets and the actual Gate-A Python kernel policy inspector returned PASS.
The work did not authenticate to Supabase or change the host firewall.
The script is listed as VPS-only QA rather than GitHub CI; it must not
be treated as a signed Operations release or a real pooler ACL.

## Signed public manifest must be readable by actual broker identity

The Gate-A unit previously validated root-owned manifest/key as root in
ExecCondition and then attempted to read the same files as UID 28500.
A root-only directory or mode 0600 manifest passes root but fails at
nonroot broker start. Candidate now has a second ExecCondition using the
same exact nonroot UID/GID as ExecStart and validating the same signed
source-pinned manifest. Root-owned PUBLIC key/manifest should use 0644
with root-owned traversable directories (0755). These are public
verification materials, NOT secret signing keys or database credentials.

Isolated test generates a fresh disposable Ed25519 key and scope manifest;
validates as root and 28500 with public readable ACL; then proves 0600
manifest or 0700 parent fail specifically for UID 28500 while root
continues to validate. The synthetic private key never becomes an
approved Operations authority. No actual trust root or role LOGIN is
created, installed or enabled.

## Gate A signed public trust file race hardening

Gate-A manifest/public-key reader is now a scoped helper using O_NOFOLLOW
for the open file descriptor, followed by fstat on that same descriptor.
It verifies root ownership, regular-file type, size, and no group/world
write permissions, plus a root-owned non-writable parent directory.
This replaces the risky two-step lstat-then-open pattern *only for Gate A*;
Gate B remains untouched. A symlink, writable trust directory/file,
empty file, or changed file length is a hard failure. Synthetic tests
include direct manifest signing/validation with UID28500, as before.
This is source security hardening, not creation of a real Operations key.

## Gate A authorization failure reporting — systemd semantics

Actual transient systemd tests showed ExecCondition exit nonzero can cause
the stage to be skipped while systemd reports successful/clean completion.
This hides invalid signed permits behind a misleading success-looking state.
The source-only Gate A unit now uses ExecStartPre for both root and
UID28500 signed manifest validation. Nonzero validation errors must
fail the start rather than skip it. Missing independent trust material is
still checked with ConditionPathExists; no operational unit is installed.
The active staging service and DEV database are unchanged.


## JIT stage LOGIN positive-path source candidate (2026-11-22)

The earlier Gate-A acceptance only proved NOLOGIN relock and crash cleanup;
there was no source-controlled positive LOGIN lease. New import-only
`scripts/dev/cst_onejob_stage_jit_open_controller.py` reuses existing
Gate-A Ed25519 manifest verification and relock_once. It rejects a wrong
project/source, expired lease, active old sessions and incorrect role flags.
A verified scoped lease can open the exact stage login with a PostgreSQL
VALID UNTIL not later than the signed 10-minute limit; the action runs once,
then the existing NOLOGIN + terminate-backends reader is always called.
An unsafe pre-existing login/session is first contained, never reused.
No other role or shared Core pool is modified.

Unit tests verify positive, denial, exception and relock failure behavior.
The PostgreSQL16 disposable test proves a real LOGIN, one session, forced
NOLOGIN, zero residual sessions, and denial of new login on a container
with network=none. Its permit is mocked for QA; it is NOT a real Operations
signature. This module has NO CLI, database credentials or operational
runner and returns NO_GO even on a passing test.

**Still blocking live rollout:** authorized admin DB credential custody,
independently signed technical manifest, pinned trusted key, namespace/ACL,
a single-flight launcher, and a separate crash/SIGKILL relock watchdog.
Python try/finally cannot guarantee cleanup after SIGKILL or host failure.
No service is installed, no real stage role is opened, and DEV/PROD
operational state remains unchanged.

## Missing technical authority must be an assertion failure

Systemd v255 test on the VPS proved `ConditionPathExists` missing paths
can skip startup, while `AssertPathExists` causes the start job to fail
with `AssertResult=no`. It is important not to rely on `Result` alone,
which can still show `success` for an assertion-prevented job. All eight
Gate-A independent trust/source/namespace path preconditions now use
`AssertPathExists` in the uninstalled candidate. Signed manifest content
validation continues to use `ExecStartPre`, where any bad signature
produces a failed start. Neither change confers operational approval.

## Gate A signed nonce must be atomically single-use before JIT LOGIN

The signed JIT-open candidate now REQUIRES an independent `reserve_nonce`
callback before issuing `ALTER ROLE ... LOGIN`. The callback receives the
verified project, 32-character hex signed nonce, pinned source and lease
expiry and must return the boolean `True` only after an atomic durable
reservation. Failure, duplicate, missing nonce or any non-True result
denies the stage before LOGIN. A successful stage consumes its nonce even
if the action later fails; a retry must use a separately authorized permit.

Source test includes replay and denied reservation. PostgreSQL 16 in a
Docker network-none container proves a unique-indexed nonce cannot be
reused through a new database connection after successful relock. The
real Operations manifest verification is still MOCKED in disposable QA;
actual multi-process durable storage and authorized broker JIT custody
are not provided by this source, and source PASS cannot enable LOGIN.
An independent SIGKILL relock watchdog and Supavisor frontend draining
remain required before any live DEV approval.


## Reuse existing durable signer nonce primitive for Gate A (source only)

The existing VPS signer `consume_nonce` already has Linux O_EXCL,
file+directory fsync and fail-closed replay tests. New Gate-A source-only
adapter `scripts/dev/cst_onejob_stage_nonce_adapter.py` reuses that
exact primitive with a domain-separated digest for the *project+signed
nonce*. It requires a separate persistent, owner-only Gate-A directory:
the working signer ledgers are never modified. The same signed nonce is
rejected across distinct Gate-A source releases.

Disposable tests verify root/nonroot compatible directory ownership,
mode/symlink rejection, file+directory fsync failure (record stays
consumed), four competing processes with exactly one success, replay
after process exit, and integration as the JIT controller's callback.
This changes no signer code and creates no operational database table,
role, key, or service. No production credential or signed authority is
present. The actual approved systemd StateDirectory, single-flight
session controller and independent SIGKILL/host-restart relock runner
remain operational NO-GO prerequisites.

## Gate-A JIT heartbeat watchdog policy (source candidate, no daemon)

Source-only cst_onejob_stage_watchdog_candidate.py requires independent
trusted SQL and durable lease readers, a pinned source SHA and UTC clock.
A lease must have the correct CST-DEV project/source, unique signed nonce,
ACTIVE state, valid <=10-minute grant, and heartbeat newer than 15 seconds.
Missing/expired/stale lease, orphaned stage session or privilege drift
triggers the already-tested NOLOGIN-and-session-termination primitive.
A valid lease yields OBSERVATION_ONLY and never grants operational GO.

Ten unit tests prove heartbeat timeout, wrong project/source, missing lease,
multi-session containment, security drift, and fail-closed on DB errors.
A disposable PostgreSQL 16 container with --network none demonstrates an
open dedicated stage role, live session and durable SQL heartbeat row:
the stale heartbeat leads to NOLOGIN, 0 sessions and denial of new login.
No connected CST-DEV database, PROD or real credentials were used.

IMPORTANT: This QA invokes the watchdog policy explicitly; it DOES NOT
prove an independent persistent service, crash/SIGKILL restart, outage
recovery, authoritative DB clock, real admin SQL custody, nor Supavisor
frontend draining. Those are still required for operational GO. The
watchdog has no CLI that can connect to Supabase or activate LOGIN.

## Watchdog lease read failure and separate launcher SIGKILL QA

Watchdog policy previously raised immediately when a durable lease reader
threw an exception. A still reachable administrative connection could then
leave an open LOGIN role unchanged. Gate-A source policy now attempts the
existing fail-closed relock (NOLOGIN, targeted session termination, readback)
before rethrowing the lease reader error. The original error never yields
PASS; if relock itself fails, that failure is also propagated explicitly.

An isolated PostgreSQL16 network-none test now launches a separate
synthetic JIT process which actually runs LOGIN and creates a long
PostgreSQL session. The JIT process is SIGKILLed; an established session
is independently observed to survive the killed process. A new Python
watchdog process uses a fresh admin SQL callback and persisted SQL
heartbeat row to relock the role and end that orphaned session. New login
is denied and an unrelated role remains unchanged.

This is process-isolation QA, NOT a persistent watchdog systemd service,
VM host crash recovery, actual approved DB custody, or Supavisor frontend
drain proof. A DB/network outage can prevent relock; continue NO-GO.


## Gate A single-flight protection for independently signed permits (source-only)

Signed nonce replay prevention does NOT prevent two different valid permits
from racing on the same stage LOGIN. The JIT positive-path source now
requires an `acquire_single_flight` exclusive context callback. The lock
covers the original baseline query, durable nonce reservation, temporary
LOGIN, stage action and forced relock/readback. Without the callback,
source fails closed before any SQL.

`scripts/dev/cst_onejob_stage_single_flight.py` supplies an OS `flock`
adapter on a separate non-symlink, owner-only 0700 state directory and
0600 singleton file. It uses O_NOFOLLOW, fstat identity/link-count
verification, nonblocking kernel flock and finally release; no account,
credential, network, signer, or service is created. Four real Linux
processes competing for the same lock yield exactly one winner. A
distinct-valid-nonce attempt while another launcher holds the lock
cannot even issue its first SQL read or reserve its nonce.

SIGKILL automatically releases a kernel lock. That is NOT proof of safe
DB relock or a permanent watchdog; the next eligible launch must also
perform the existing NOLOGIN baseline/readback, and an independent
watchdog must contain stale sessions before operational GO. No signed
Operations authority, secret custody or reviewed namespace is installed.


## Watchdog credential delivery simplified with native systemd DynamicUser (source only)

The first watchdog unit candidate used numeric `User=28502` without a
passwd/NSS entry, causing `217/USER`. A later root-wrapper/`setpriv`
candidate fixed the process identity but still could not prove access to
root-delivered `LoadCredential` after dropping UID. No root-run Python or
manual copying of database credentials should be needed.

The new **uninstalled** watchdog unit uses `DynamicUser=yes` with
`User=cst-onejob-gatea-watchdog`: systemd creates an ephemeral, non-login
service identity and makes its own `LoadCredential=watchdog-db:...`
readable by that identity. Both signed public manifest validation and
the hypothetical relock-only runner execute as that same non-root identity.
No persistent Linux user, external KMS, root process wrapper or additional
human approval is introduced.

On VPS, the disposable test
`scripts/dev/cst-onejob-gatea-watchdog-dynamic-credential.disposable.sh`
ran a transient protected systemd service with a **synthetic credential**
(mode 0600 at its root-only source): the dynamic UID was non-root, the
systemd-delivered copy was readable, and no permanent passwd entry remained.
A second negative startup test with a deliberately absent synthetic
credential source is denied rather than silently launching. The tests did
not read or transfer actual passwords or access Supabase. The source-only
unit parser and static policy suite pass.

This establishes **credential delivery mechanics only**. A narrowly scoped,
independently authorized watchdog administrative credential does not yet
exist on this VPS, nor do the signed Gate-A permit/public root, reviewed
watchdog network namespace, real watchdog runner, startup release decision,
Supavisor drain or host power-loss relock proof. Do not install or start
the candidate; operational decision remains NO-GO.


## Dedicated Gate-A persisted lease — minimal PostgreSQL16 candidate (source only)

Read-only CST-DEV catalog inspection confirmed no existing dedicated Gate-A
stage lease table. The unrelated GPT02 recovery leases are deliberately
**not reused or changed**. The new proposed file
`docs/dev/cst-onejob-gatea-stage-lease.PROPOSED.sql` is NOT a live
migration or authorization receipt. It only defines one fixed-project
lease slot in `ai_platform.cst_gatea_stage_leases`; its primary key
prevents concurrent rows for the same CST-DEV project. Constraints require
a 32-hex signed nonce, 40-hex pinned source, bounded <=10-minute expiry,
heartbeat within the lease, and state ACTIVE/CLOSED.

RLS is enabled and **forced**, public privileges revoked and **no RLS
policies, GRANTs, LOGIN roles, passwords, functions, signers or schedulers**
are created. The proposal fails without an explicit local migration review
marker or if a table of the same name already exists. The marker is
*only a safety check in QA*, not proof of approved deployment.

A read-only `scripts/dev/cst_onejob_gatea_lease_reader.py` retrieves
exactly the project lease and UTC database clock through a separately
supplied trusted query callback. Bad scope, malformed timestamps, duplicate
rows or database failures are not converted to a valid lease. It has no
network, credential reader or CLI. The watchdog's existing fail-closed
policy must consume the clock and lease snapshot; the module itself does
not issue relock SQL.

`scripts/dev/cst-onejob-gatea-lease-store.disposable.py` verified the
actual DDL on isolated PostgreSQL16 with Docker `--network none`:
unapproved DDL denied, RLS forced, no policies, accidental reader GRANT
still returned zero rows, unauthorized UPDATE denied, wrong project/nonce
or >10-minute lease denied, one lease per project, database UTC clock
readback, and stale heartbeat -> targeted role NOLOGIN + session termination
with zero residual sessions. A separate import-only reader suite covers
malformed SQL results and no-secret/no-network behavior.

**Operational NO-GO remains** until real release authority reviews the
migration, issues a narrowly scoped lease reader/writer policy, separately
provisions the watchdog relock-only administrative credential and network
ACL, and tests the actual CST-DEV runtime after a crash and Supavisor
drain. Do not apply this proposal to PROD or directly to CST-DEV yet.


## Gate A lease ACL: separate NOLOGIN read and write groups (source-only)

The previously proposed one-row Gate-A lease table intentionally had no
policy, so the source watchdog could not read it under a narrow runtime role.
A second **unapplied** SQL proposal,
`docs/dev/cst-onejob-gatea-lease-access.PROPOSED.sql`, adds only the
minimal fixed-project policies and per-column privileges:
`cst_gatea_watchdog_lease_reader` may SELECT the seven lease fields;
`cst_gatea_stage_lease_writer` may insert/refresh an exact-project lease
and cannot DELETE, TRUNCATE or read unrelated tables. Both must already
exist as NOLOGIN, NOINHERIT, NOBYPASSRLS, nonsuperuser roles. This migration
does NOT create roles, login credentials, membership, keys, admin relock
rights, policies on other tables, or HTTP/Data API access.

The separate `scripts/dev/cst-onejob-gatea-lease-acl.disposable.py`
executes both proposed migrations only on PostgreSQL16 Docker `--network
none`. It proves missing/LOGIN roles fail preflight, SELECT-only reader
cannot INSERT/UPDATE, writer cannot DELETE or exceed bounded lease
constraints, FORCE RLS remains active, anon/authenticated/shared Core
roles have zero table privileges, and the exact source lease reader
successfully reads its fields and UTC DB clock as the limited reader role.

**This is necessary data ACL, NOT relock authority.** Actual watchdog
role administration, a genuine signed Gate-A technical permit and a
source-approved live lease writer remain separate NO-GO prerequisites.
Do not install these proposals on connected CST-DEV or PROD as QA evidence.


## Narrowed Gate-A lease heartbeat UPDATE grant (source-only)

Security review found the draft lease writer could update nonce,
source_sha, issued_at and expires_at after insertion, potentially
extending a lease by rewriting its original 10-minute time window.
The source ACL now permits UPDATE **only of heartbeat_at**, and only
while state=ACTIVE and the original lease has not expired. Signed
nonce/source/issuance/expiry and state are immutable for this role;
a fresh authorization/lease requires a separate reviewed operation,
not a heartbeat update. PostgreSQL 16 disposable QA verifies all six
forbidden UPDATE columns and bounded heartbeat behavior.

No table, role, policy or grant in connected CST-DEV is changed by
this source correction; the operational gate remains NO-GO.


## Atomic NOLOGIN lease principals and reversible CST-DEV ACL (source-only)

To avoid a split role-and-grant installation, the exact hardened lease
ACL is packaged with the two no-login group definitions in one guarded
transaction at
`docs/dev/cst-onejob-gatea-lease-acl-provision.CSTDEV-ONLY.sql`.
It verifies the empty exact-seven-column lease table and constraints,
forced RLS, no existing policies/roles, and the stage LOGIN still locked.
Neither group can authenticate or inherit rights, and **no memberships
or passwords** are created. The stage writer can INSERT one exact-project
lease and UPDATE **only heartbeat_at** while the initial signed lease
remains ACTIVE and unexpired. It cannot alter nonce/source/issuance/expiry
or state after insertion. The watchdog reader is SELECT-only.

`docs/dev/cst-onejob-gatea-lease-acl-rollback.CSTDEV-ONLY.sql`
removes the four specific policies, column grants and the two new
NOLOGIN groups, but **never** removes the existing lease table.
Rollback refuses if a lease row, role membership/session, unexpected
policy or permission drift exists; it must not revoke an in-use release.

The disposable `scripts/dev/cst-onejob-gatea-lease-provision.disposable.py`
applies source SQL on PostgreSQL16 network-none, proves transaction
ROLLBACK leaves no principal or policy, installs roles/ACL, denies a
duplicate application, rejects rollback with a lease row present, and
then safely rolls back once empty. This source-only proof does not
constitute a signed operational Gate-A approval or authorize the
migration in a live database by itself.


## Coexistence with separately reviewed relock-only Gate A policy

During the controlled DEV migration rehearsal an independent watchdog
actor installed the fixed-project read policy
`cst_gatea_watchdog_exact_lease_read` for existing NOLOGIN role
`cst_gatea_watchdog_relock`. The ACL installation now admits **only**
that exact known SELECT policy, verifying its role, project predicate,
and permission flags. Unknown/broader policies continue to fail closed.

The guarded rollback removes **only** the four lease reader/writer ACL
policies and two principals created by this change. If the relock-only
policy was present before installation it remains untouched afterward.
PostgreSQL disposable QA verifies the safe coexistence, an unexpected
policy denial, and preservation on rollback. No live policies are
altered by this source-only reconciliation.
