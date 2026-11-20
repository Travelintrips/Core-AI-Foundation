# CST AI Team — one-job DEV preflight (read-only)

This diagnostic is **not** a launcher, scheduler, credential provider or GPT02
approval mechanism. It refuses to claim pilot readiness until the **DEV-only**
blue-green candidate, database identity, fresh Company-1 model job and worker,
DNS route, enrollment guard and runtime source provenance are independently
observable. On any missing evidence it prints JSON `pilotAdmissionReady=false`,
exits **2**, and never creates jobs, roles, workers, signers or tokens.

Run on the authorized VPS from the exact checked-out Core PR source:

```bash
node scripts/dev/cst-team-onejob-readiness-gate.mjs core-ai-dev:cst-onejob-9fabedcd-qa
```

The optional image argument must be an exact tagged QA candidate; the probe
verifies its embedded source commit, or an ancestor whose intervening changes
have **no** differences in backend runtime or the bounded pilot RLS templates.
It checks the candidate container `cst-core-onejob-dev-candidate`, requiring
healthy status, identical image ID, non-host/non-production Docker network and
no ports bound publicly. The existing unified DEV endpoint
`dev.cstlogistic.co.id` must resolve, but its shared `/api/` Nginx route must
**remain on the existing healthy Core DEV container** during pilot preparation.
The candidate must use a dedicated `--internal` Docker bridge with IPv4
gateway mode `isolated`, no host-gateway address, **no published ports**, and
no IPv6 network. The diagnostic reads `/api/healthz` from the named candidate
via `docker exec` at its container-local `127.0.0.1:3000` (not from a host port)
and requires an exact source header (`x-cst-source-commit` or
`x-cst-commit-sha`) matching the image label. This is a prelaunch provenance check, not an authorization to dispatch.
Do not cut over the shared DEV `/api/` merely to make a readiness check pass. The retired `dev-aicore.cstlogistic.co.id` Nginx vhost
must remain HTTP 410 (quarantined since 31 October 2026). Never re-enable
that retired endpoint or substitute the PROD hostname merely for a pilot.

For database verification the probe executes a *SELECT-only* PostgreSQL
transaction **inside the existing DEV container or healthy candidate**. It
reads the already-connected DEV DSN only in that container, first rejects a
project mismatch, and prints no DSN/password/token. It requires exactly one
safe, valid, short-lived dedicated pilot role and a fresh, **queued** Company-1
`ollama_model_invocation` job, never historic job #482. Worker identity must be
new and match `cst-dev-dell-onejob-YYYYMMDD-8hex`; role enrollment and exact
single-job guards must be active. A role that is expired, privileged, absent,
or invisible due to RLS is **not** treated as ready.

The diagnostic intentionally cannot verify independent agent delivery or QA
Final ACK, and always reports `operationalE2EVerified=false`,
`subscriberReceiptVerified=false`, `independentFinalAckVerified=false` even
when all preflight inputs are valid. Being ready for a controlled single-job
pilot does **not** authorize PROD, signer activation or multi-agent release.

## First live preflight, 19 November 2026 WIB

Read-only probe on VPS returned `pilotAdmissionReady=false` / exit 2. The
candidate image was correctly built from Core source `9fabedcd`, but there
was no running blue-green candidate, no verified routing of the active
unified DEV host to that candidate, no dedicated one-job role, and no newly
queued Company-1 model pilot. The retired host remains HTTP 410. Existing Core DEV still uses the older image and job #482 remains
untouched. **No attempt to bypass these blockers should be made.**

Unit regression: `node --test scripts/dev/cst-team-onejob-readiness-gate.test.mjs`.

## Shared DEV API isolation update, 19 November 2026

The VPS Nginx config currently points the unified DEV `/api/` route at the
existing healthy Core DEV runtime on loopback 18082. An initial stricter gate
incorrectly required routing the shared API to the candidate before the pilot.
This requirement was removed: the gate now refuses a premature shared-route
change and requires a separate, healthy candidate loopback endpoint with source
provenance. The retired `dev-aicore` HTTP 410 quarantine remains mandatory.
No candidate launch or shared Nginx change was performed as part of this edit.

## Dedicated network membership (19 November 2026)

The candidate must run on a Docker bridge named `cst-core-onejob-dev-net` with **exactly one member**, `cst-core-onejob-dev-candidate`. The gate verifies this via Docker network inspection, rejecting shared worker, QA and production bridges. The new gateway-`isolated` candidate does **not** publish port 3000 to the host;
health is read inside the exact candidate container. Shared DEV Nginx continues
pointing to the existing healthy Core DEV port 18082. **A dedicated bridge alone does not restrict outbound destinations**: verify approved DEV database destinations and egress controls separately before creating an authenticated pilot role or allowing job execution.

Live read-only CST-DEV catalog check: database `postgres`; role anchors `dev_gpt02_relock_catalog_auditor` and `aicore_dev_runtime` exist; RLS enabled on jobs/workers/events/audit_logs, all four expected sequences exist, no `cst_team_model_pilot_%` roles or `cst_model_pilot_%` policies; historical completed job #482 is the only job matching the pilot request prefix. Therefore do **not** provision the short-lived login yet or reuse #482. No database mutations performed.

## Duplicate-job defense (19 November 2026)

Live CST-DEV indexes on `ai_platform.ai_jobs` have unique constraints for ID and `job_code`, **not** on `payload_json->>'requestId'`. A pilot RLS INSERT filter on requestId alone therefore cannot enforce exactly one job. The pilot role template no longer grants job INSERT (nor `ai_jobs_id_seq` usage). An authorized application workflow must first create one fresh, approved, queued Company-1 model job. The dedicated role may only read/update that exact request; attempts to INSERT even a duplicate request are denied by SQL privileges. The disposable PostgreSQL rehearsal now seeds the approved job as the owner, checks duplicate INSERT denial under the pilot role, and tests the original job-worker-event-audit flow plus full role/policy rollback. CI runs that isolated rehearsal with Docker `--network none`, without any CST-DEV or PROD database credentials.

Do not activate the role until an authorized fresh job exists and the runtime-specific identity/egress checks are independently established.

## 19 November 2026 — startup and exact-one-request audit

Isolated VPS boot attempts against candidate `9fabedcd` did not reach healthy status: the first small-memory boot hit V8 OOM; after raising the memory limit, the application correctly rejected missing/unverifiable Supabase DEV configuration. The failed containers and dedicated bridge were removed. Existing Core DEV remained healthy and Nginx routing unchanged. Do not bypass `assertDevelopmentDatabaseIsolation`, inject the old shared application DSN or assert runtime readiness from this test.

Read-only CST-DEV query confirms **zero queued** Company-1 pilot jobs. The readiness gate now requires exactly **one** database row per approved `requestId` (checked from the scoped connection), and Docker network inspection must prove `Internal=true`, `Driver=bridge` and exactly one candidate member. An externally routed bridge or duplicate matching job rejects admission. The original `9fabedcd` image predates the modified role SQL templates, so source equivalence must continue to fail until a fresh matching image is built and verified. This change is code-only: no DEV DB role/job creation, runtime activation, DNS/Nginx change, or PROD deployment.

## Database-wide requestId uniqueness prerequisite

An RLS-scoped login cannot establish uniqueness across rows it cannot see. The
one-job gate therefore requires a **valid, ready unique PostgreSQL index**
`ai_jobs_company1_pilot_request_unique` that covers the exact
`cst-ai-team-company1-dev:pilot-%` requestId namespace independent of job
type. The narrow additive index DDL is staged at
`scripts/dev/cst-team-onejob-unique-request-index.sql` and **has not been
applied to CST-DEV**. The disposable PostgreSQL rehearsal runs this DDL and
tests that a privileged fixture owner cannot insert a second request with a
different job type. Current live CST-DEV duplicate audit found no duplicate
pilot requestId, but this alone does not substitute for an enforced index.

Preflight must report `PILOT_DB_UNIQUE_REQUEST_CONSTRAINT_MISSING` until a
separately reviewed, authorized DEV-only migration exists and PostgreSQL
catalog readback shows the index is `indisunique`, `indisvalid`, and
`indisready`. No PROD index is required or authorized by this work.

## Image provenance mismatch discovered in VPS QA image (19 November 2026)

A no-network, no-credential one-shot inspection of image
`core-ai-dev:cst-onejob-9fabedcd-qa` found **different** provenance:
the Docker image label `cst.qa.source_commit` was
`9fabedcd4c10644d589e880cb62f583561c89a1c`, but its embedded
`/app/.cst-build-sha` was the old Core DEV SHA
`c26921475bf947614dd27f8e3e94720931942877`.
The image must **not** be admitted for a one-job pilot. Its API health
header can legitimately report the embedded older SHA, which is why label
verification alone was insufficient.

The read-only gate now reads `/app/.cst-build-sha` only from an already
running isolated candidate and requires exactly the same 40-character SHA as
the image label. Missing, malformed, or stale marker fails with
`IMAGE_BUILD_SHA_MARKER_MISMATCH`. The new Dockerfile stamping logic must be
used in a **fresh candidate image** and independently verified before
introducing a short-lived CST-DEV database role. This change does not start
workers or authorize job execution.

## Portable prelaunch Docker provenance verification

The GitHub QA image job from exact commit `fb1a6f258c87335d038e40e10ee4a6503b8eddab`
passed label/embedded source-marker readback on the hosted runner, with no deploy.
That image was not uploaded to the VPS. Historical VPS candidates `9fabedcd`
and `f9c3b61f` both retain old internal marker `c2692147` and are ineligible.

Once an exact-source image has been transferred by an authorized immutable
artifact mechanism, run the new non-deploy check before any boot:

```bash
node scripts/dev/cst-team-onejob-image-provenance.mjs \
  core-ai-dev:cst-onejob-<source8>-qa <40-character-source-sha>
```

The command reads Docker labels and an embedded marker via a throwaway
`--network none --entrypoint cat` container. It will not start the Core
application, connect to a database, issue a credential or alter services.
Never tag an old image as a new source to pass this test.

VPS capacity during audit: filesystem free approximately 38 GiB; system swap
approximately 6053/6143 MiB used. Avoid resource-heavy source/image builds on
the shared VPS until capacity is demonstrably available; prefer an independently
built, immutable QA image artifact with cryptographic identity verification.
The GitHub workflow does not presently publish an artifact, so image transfer
is still a separate unresolved step. No production promotion is authorized.

## Verified Docker bridge host-gateway escape — 19 November 2026

A temporary `--internal` Docker bridge on the DEV VPS was tested against a
temporary listener bound **only to that bridge's host gateway**. An unprivileged
test container returned `HOST_GATEWAY_CONNECTION=CST_QA_HOST_GATEWAY`:
host gateway access still worked with `Internal=true`. The temporary listener,
container and network were removed. No real CST-DEV/PROD database or public
service was accessed, and the shared Core DEV runtime remains unchanged.

This reveals a release-safety gap in the original one-job admission check:
`Internal=true` and exact-one-container membership do not prove host service
isolation. The new `cst-team-host-gateway-probe.mjs` binds a random, short-lived
local-only TCP port at the candidate bridge gateway and asks **only**
`cst-core-onejob-dev-candidate` to perform a nonce challenge. If reachable
or the check fails, one-job admission is **blocked** with
`HOST_GATEWAY_ACCESS_NOT_BLOCKED_OR_UNVERIFIED`. Timeout and missing/ambiguous
Docker execution are also non-success. No database credential, RLS mutation,
signer, event or dispatch is involved in this negative test.

A denied gateway nonce is necessary but **not sufficient** for safe deployment:
verify IPv6/other routes and independent outbound ACL enforcement, plus successful
role-scoped read-only access to exactly CST-DEV through its approved transport.
Do not weaken the common `aicore_dev_runtime` role, grant host networking,
restore the retired DEV hostname or reuse historical job #482.

This narrow guard is proposed separately because the previous Core PR #1763
merged to `develop` at commit `858efc5a` before this follow-up was ready;
it is **not** approval for DEV execution or PROD promotion.

## Independent ACL and dedicated DEV database transport admission (19 November 2026)

**Critical fail-closed correction:** a successful randomized TCP denial at the
Docker host gateway does **not** demonstrate the absence of another reachable
host port, alternative host address, IPv6 route or outbound destination. A
valid, short-lived PostgreSQL login proves role authorization, not network
path confinement. Neither can substitute for the other.

The one-job readiness projector now requires two **separate positive proofs**:

- `candidateIndependentNetworkAclVerified`: an independently reviewed,
  candidate-identity-bound inspection and negative network challenge covering
  host input, forwarding, IPv4/IPv6, other attached networks and unapproved
  destinations, in addition to the existing random gateway listener challenge.
- `candidateDedicatedDevDbTransportVerified`: a dedicated, explicitly approved
  network route to **only** CST-DEV `xssrfshdrtdfupgqwfdw`, verified from the
  exact candidate with the short-lived, request-bound database identity and
  negative checks for unauthorized projects/destinations. Do not use shared
  `aicore_dev_runtime` credentials to satisfy this check.

**Both are intentionally `false` in the current live preflight entrypoint.**
No privileged firewall inspection, complete route attestation or approved
DB-only transport verifier has yet supplied the evidence. This is a deliberate
operational NO-GO: neither an environment variable, a local file supplied by
the candidate, an operator assertion, a Docker `--internal` flag, nor a
successful PostgreSQL SELECT can turn either into `true`.

Until a separately reviewed fail-closed evidence collector is implemented and
independently tested, the preflight must report
`CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED` and
`DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED`. The new code is **only a safety
barrier**: no firewall changes, Docker network changes, role/job creation,
event replay, signer activation, DEV shared-route cutover or PROD deployment.
Synthetic positive values in pure unit tests exercise the projector only;
they are **not** operational acceptance evidence.

## Gateway-isolated Docker sandbox experiment (19 November 2026)

Docker Engine 29.9.3 on the authorized DEV VPS supports a bridge created with
`--internal -o com.docker.network.bridge.gateway_mode_ipv4=isolated`.
This is stricter than an ordinary `--internal` bridge, which still has a
host-facing gateway address. Reference:
https://docs.docker.com/engine/network/port-publishing/#gateway-modes

A unique, disposable no-secret/no-database sandbox returned:

- Network `bridge`, `Internal=true`, IPv4 gateway mode `isolated`,
  and IPAM with a subnet but **no `Gateway` address**.
- A no-privilege Node HTTP test process gave **HTTP 200 from within its own
  namespace** through `127.0.0.1:3000`.
- `/proc/net/route` had **no IPv4 default route**.
- An outbound TCP probe to the running Core DEV private Docker address was
  denied with **`ENETUNREACH`**.
- Docker reported `PortBindings={}` and `3000/tcp: null` (no host-published
  port). The entire sandbox network and container were then removed.

The read-only one-job gate now requires this isolated bridge topology,
no published ports, explicit in-container default-route and cross-network
negative proofs, and an in-container HTTP commit-header readback. A conventional
bridge that only sets `Internal=true` cannot satisfy the new admission shape,
even if an ephemeral host-gateway listener happened to be denied.

**This is network topology and diagnostic health evidence only, not full
independent ACL certification.** The two stricter release blockers continue
to be forced to `false` until independently verified:
`CANDIDATE_EGRESS_ACL_NOT_INDEPENDENTLY_VERIFIED` and
`DEDICATED_CST_DEV_DB_TRANSPORT_NOT_VERIFIED`.

In particular, no default route also means the candidate cannot speak directly
to the remote Supabase CST-DEV pooler, so an independently reviewed *dedicated
DEV-only database transport* is still needed. Do not add a general outbound
Docker network, host networking, shared DB login, or permissive firewall rule
merely to bypass these blockers. The pilot remains NO-GO, and this change
performs no PROD/DEV migration, signer activation, or job execution.

## IPv6 loopback reject entries and exact-name sandbox verification

The isolated-bridge sandbox exposed two `::/0` entries under interface
`lo` with flags `00200200` in `/proc/net/ipv6_route`, although the
container had no non-loopback IPv6 address and an outbound connection to
`2001:db8::1` returned `ENETUNREACH`. Treating every text `::/0` row as
a usable default route incorrectly rejected the otherwise isolated sandbox.

The in-container route probe now ignores **loopback-only reject entries**
while still failing closed for a default IPv6 route through a non-loopback
interface, any non-loopback IPv6 address, an IPv4 default route, or an
unreadable IPv6 routing table. The test executes the exact JavaScript
passed to `docker exec` with synthetic positive and negative route
tables, rather than repeating a separate parser implementation.

A temporary network **with the exact preflight network and candidate names**
(no database credentials, no signer or runtime dispatcher, only a dummy
Node HTTP service) independently verified:
`networkGatewayMode=isolated`, `noPublishedHostPorts=true`,
`candidateRoutesAbsent=true`, `candidateCoreCrossNetworkDenied=true`,
`gatewayProbeStatus=ISOLATED_GATEWAY_UNASSIGNED_NO_ROUTES`,
`pilotAdmissionReady=false`, `exit_code=2`, `sideEffects=NONE`.
The named container/network and temporary source checkout were removed.
The sandbox deliberately did not impersonate an approved source image or
database role; runtime provenance/transport/QA blockers remained active.

## Mock Unix socket transport feasibility (no real database)

Because the gateway-isolated candidate has no network default route,
a normal remote PostgreSQL TCP connection cannot be made directly.
A separate disposable feasibility check used a read-only bind mount of
a Unix-domain socket into the isolated container. A mock broker on the
VPS forwarded bytes **only** to a randomly bound local mock TCP server,
never to a public endpoint, Supabase, PROD, or any real credentials.

The isolated container returned:
`CONTAINER_DEFAULT_ROUTE=false`,
`UNIX_SOCKET_MOCK_ACK=MOCK_CST_DEV_ACK:PING_ONLY`,
`SINGLE_FIXED_UPSTREAM_SOCKET_MECHANISM_PASS`.
The temporary broker process, socket, container, and Docker network were
cleaned afterward.

This is **not** a real CST-DEV database transport PASS. Before any broker
could be deployed, its design must constrain upstream destination to
the CST-DEV project, prevent caller-supplied destinations, preserve
the existing DEV project-ref isolation guard, authenticate the
short-lived pilot identity, enforce TLS server verification where applicable,
restrict filesystem socket access, and prove unauthorized company/project,
IPv4/IPv6, and host-service traffic is denied. It must have a safe,
auditable rollback and must not inherit the shared application DB credentials.
The two independent ACL/transport admission fields remain `false` in code.

## Default-OFF CST-DEV model pilot Unix socket PostgreSQL transport

The production/ordinary-DEV `@workspace/db` connection logic is preserved.
The new small adapter in `lib/db/src/cstOneJobDevSocketTransport.ts` activates
**only** when `CST_TEAM_DEV_DB_SOCKET_TRANSPORT_ENABLED=true`, both
`APP_ENV` and `NODE_ENV` are `development`, the existing bounded model
claim gate is explicitly enabled, and the approved job and new bounded
worker identities are supplied. Otherwise the existing direct pool
configuration is unchanged.

Before creating a PostgreSQL socket, the adapter checks the **original**
connection string against:

- Exact project `xssrfshdrtdfupgqwfdw`, via canonical
  `SUPABASE_URL_DEV` and the username suffix.
- Exact pooler host `aws-1-ap-southeast-2.pooler.supabase.com`, port
  `6543`, database `postgres`, and a dedicated short-lived
  `cst_team_model_pilot_YYYYMMDD_8hex` role. Any other host, port, role,
  username, or connection-string query parameter is rejected.
- `ssl.rejectUnauthorized=true`; `PGSSLMODE`, `PGSSLKEY`, and
  `PGSSLCERT` overrides are rejected. Passwords never appear in output.
- A **fixed** local Unix socket destination
  `/run/cst-onejob-dev-db/pg-pooler.sock`. The application does not
  accept a caller-supplied host/socket path, and does not fall back to
  general TCP egress if the socket is unavailable.

The `pg` 8.22.0 driver derives TLS SNI from its configured PostgreSQL
hostname. A normal `host=/path/to/socket` connection would lose that
hostname. The transport instead keeps the original host for TLS
certificate validation and redirects only the low-level `Socket.connect`
call to the fixed Unix-domain socket via `stream()`.

**Offline verification:** `scripts/dev/cst-team-onejob-pg-socket.test.mjs`
exercises the exact adapter and the installed PostgreSQL driver with an
ephemeral local Unix socket and a server that accepts the PostgreSQL
`SSLRequest`, then inspects TLS `ClientHello` before closing. It verifies
the expected pooler hostname in SNI and refuses wrong projects, roles,
pooler ports, modes, unauthorized job/worker identities, and insecure TLS
options. No real database password, handshake completion, subscriber,
event or signer is involved. The existing PostgreSQL pool-size regression
must also remain PASS.

**Operational NO-GO:** this is an opt-in *client transport*, not a broker,
network ACL, trusted certificate validation against Supabase, real role
provisioning, or E2E execution. An independently secured fixed-destination
broker and its external firewall/ACL and credential isolation remain
unproven. `candidateIndependentNetworkAclVerified` and
`candidateDedicatedDevDbTransportVerified` remain forced to false in
the live one-job preflight. Do not launch the client using shared
`aicore_dev_runtime` credentials. Do not promote the PR, dispatch,
write CST-DEV jobs or touch PROD based on this offline proof.

## Offline-only fixed-destination broker contract (20 November 2026)

A live read-only inspection of the healthy existing `core-ai-dev` container
reported **`aws-1-ap-southeast-2.pooler.supabase.com:6543`**, not the
`aws-0` hostname originally written into the first socket adapter. The
client allowlist, negative tests and documentation were aligned to the
**one observed `aws-1` endpoint**. The old endpoint is rejected rather than
added as a fallback. No password, database DSN, or service credential was
copied or logged.

The new `scripts/dev/cst-team-onejob-fixed-db-broker.mjs` contains a fixed,
read-only destination contract for `aws-1`, port 6543 and project
`xssrfshdrtdfupgqwfdw`, plus a **test-only**, local Unix-socket byte
forwarder. This broker module has no listening side effects when imported.
The operational entrypoint unconditionally throws
`CST_ONEJOB_BROKER_INDEPENDENT_ACL_AND_DB_TRANSPORT_NOT_VERIFIED` even if
an environment flag is set. It is NOT installed as a VPS service.

The offline harness checks a fresh, canonical socket path inside a
non-world/group-writable parent directory, rejects occupied paths and
symlinks without unlinking someone else's socket, chmods a newly owned
socket to `0600`, permits **one active client**, and closes on a refused
upstream. It never interprets client bytes as a destination, accepts an
upstream address from a client, terminates TLS, logs SQL or passwords,
or falls back to an unrestricted TCP connection.

A separate integrated test starts a local mock TCP PostgreSQL listener,
then forwards bytes via the harness and Unix socket to the real installed
`pg` 8.22.0 client. The mock accepts PostgreSQL `SSLRequest`, inspects
the ensuing TLS `ClientHello` for exact `aws-1` SNI, then deliberately
disconnects before any authentication. The tests have **no Supabase,
PROD, or external network dependency**. An absent broker still fails with
no public-TCP fallback, as proven by the existing client-side test.

The production-ready broker is **not implemented or authorized** by this
offline harness. Remaining prerequisites include independently reviewed
upstream-only egress ACL, DNS and certificate authentication failure
checks against actual Supabase, deployment identity and filesystem GID
policy for the candidate's read-only mount, broker restarts/cleanup,
short-lived RLS pilot login and role revocation, rate/session limits under
actual job load, receipt-based subscriber delivery and independent QA
Final ACK. The live preflight continues to return NO-GO for the independent
ACL and real CST-DEV transport fields.

## Docker-offline full client/broker test and TLS failure proof (20 Nov 2026)

The live VPS Core DEV DB connection was inspected **without displaying
credentials**: it uses `aws-1-ap-southeast-2.pooler.supabase.com:6543`.
All new source, broker, and client tests require exactly `aws-1`, rejecting
`aws-0` as an unauthorized fallback.

Two independent offline end-to-end checks were exercised:

1. An **ephemeral** host-side broker built from the exact PR source forwarded
   a PostgreSQL `SSLRequest` from a Docker client started with
   `--network none`, through a read-only mounted Unix socket, to a local
   mock database. Docker reported no default route; the mock received
   TLS ClientHello with the correct `aws-1` SNI and disconnected before
   database credentials. No Supabase host was contacted.
2. The installed `pg` 8.22.0 client used the same broker path while the
   mock upstream presented a temporary **self-signed, wrong-hostname TLS
   certificate** generated by OpenSSL. The client rejected the handshake with
   `DEPTH_ZERO_SELF_SIGNED_CERT`. The negative test is repeatable from
   `scripts/dev/cst-team-onejob-broker-tls-negative.test.mjs`, with no
   actual database connection, passwords, or certificate file retained.

The broker tests also reject concurrent clients and insecure filesystem
paths, and its operational starter remains permanently blocked in this
Draft. These are **offline transport and TLS implementation proofs only**.
A real environment still needs independently verified peer identity on
the Unix socket, host-bound egress restrictions to an approved pooler
destination, DNS/TLS certificate review, a fresh Company-1 job with
dedicated short-lived RLS role and explicit Super Admin authorization,
subscriber delivery receipt, and independent QA/Final ACK. The one-job
readiness gate continues to return `pilotAdmissionReady=false`.

No runtime broker, host firewall change, live DB login, signer, worker,
existing Core DEV container, job #482, or PROD resource was changed.

## Non-root Unix socket filesystem identity gate — 20 Nov 2026

A password-free readback of the already-running Core DEV container found
UID `0` (Docker `Config.User` empty), even though it drops Linux
capabilities. A mock socket with mode `0600` does **not** establish that
the intended independent one-job worker, rather than the existing Core
runtime, owns the connection.

On the authorized VPS an ephemeral Linux/Docker permission challenge used
no persistent Linux users and no database access:

- Test broker UID `28500`, dedicated socket GID `28501`, socket
  `0660` and parent directory `0750`.
- A separate non-root candidate UID `28502`, GID `28501`, on a
  no-network, no-new-privileges, cap-drop-all, read-only container read
  a synthetic `MOCK_ACK` through a read-only mounted pathname socket.
- A different candidate UID/GID `28503:28504` was **denied `EACCES`**
  by the kernel. All temporary test containers and socket files were
  destroyed; no real broker daemon was launched.

The new pure read-only
`scripts/dev/cst-team-onejob-unix-peer-boundary.mjs` and negative tests
require **distinct numeric non-root broker and worker UIDs**, one
dedicated shared GID, exact immutable socket path, a `0750`
broker-owned parent, a `0660` broker-owned socket, a read-only exact
bind mount, no privilege escalation, drop-all capabilities and no
host PID/network mode. A positive projection means filesystem DAC
metadata is consistent **only**; synthetic test inputs cannot authorize
an actual runtime.

Linux pathname socket permission checks and kernel `SO_PEERCRED`
are distinct controls (see `unix(7)`):
https://man7.org/linux/man-pages/man7/unix.7.html

For that reason the operational one-job preflight now holds two independent
flags FALSE until a deployed broker can prove them from the actual
candidate and accepted kernel peer, respectively:

- `BROKER_UNIX_FILESYSTEM_IDENTITY_NOT_VERIFIED`
- `BROKER_KERNEL_PEER_CREDENTIALS_NOT_VERIFIED`

**Do not** turn either flag on based on file modes alone, the mock ACK,
an environment variable, or an untrusted client-provided UID. The
dedicated egress ACL, real CST-DEV database transport, RLS role,
new approved job, subscriber receipt and independent Final ACK are
still separate NO-GO release requirements. Existing Core DEV remains
untouched; this work does not require an additional Owner login.

## Supabase pooler CA pinning and verified no-login TLS handshake — 20 Nov 2026

The VPS's default Node.js trust store does not include the Supabase
PostgreSQL pooler's private certificate authority. An HTTPS-independent
read-only TLS handshake to the active `aws-1-ap-southeast-2.pooler.supabase.com:6543`
endpoint received a certificate for `*.pooler.supabase.com`, issued by
`Supabase Intermediate 2021 CA`, but strict verification without its
root returned `SELF_SIGNED_CERT_IN_CHAIN`. **Do not** work around this
using `rejectUnauthorized=false`, disabling PostgreSQL SSL verification,
or importing a certificate taken from the unauthenticated server into
the operating system's global trust store.

Supabase's official documentation directs operators to download the
project's server root CA in Dashboard → Database Settings → SSL
Configuration for `verify-full` use. An offline, public-CA feasibility
check used a publicly distributed Supabase Root 2021 CA and independently
checked its SHA-256 X.509 fingerprint:

`807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`

With this CA supplied **only to the test client's TLS trust context**,
OpenSSL returned `Verification: OK`, and Node.js returned
`authorized=true`, `hostnameValid=true`, TLSv1.3. These were
TLS-only handshakes. **No PostgreSQL StartupMessage, credentials, jobs,
SQL or other database transactions were transmitted.** The temporary
download was deleted after each probe. This is proof of the public pooler
TLS trust-chain behavior, **not** proof that a live session would belong
to the CST-DEV project.

The Draft-only `lib/db/src/cstOneJobPinnedSupabaseCa.ts` now requires
the exact pinned root fingerprint, a valid self-signed CA certificate and
a regular, non-symlink, non-writable certificate file. The default
read-only mount path for an eventual candidate is fixed:

`/run/cst-onejob-dev-db/ca/prod-ca-2021.crt`

An unauthorized, missing, modified, symlinked or writable CA file rejects
one-job transport activation. `lib/db/src/cstOneJobDevSocketTransport.ts`
passes the pinned CA explicitly as `ssl.ca` with
`rejectUnauthorized=true`; it does **not** change TLS defaults for
ordinary Core DEV or PROD. A public CA test fixture in
`scripts/dev/fixtures/supabase-root-2021-public-qa.crt` is used only by
offline regression tests; its presence in the checkout does **not**
automatically make it the trusted runtime source.

**Remaining release boundary:** a separately authenticated broker, verified
non-root Unix peer identity, independently reviewed egress ACL, a real
short-lived CST-DEV-only RLS login and a fresh approved Company-1 job
are still required. The preflight continues to fail closed, and no
operational broker, role, subscriber, signer or PROD service was changed.

## Accepted-FD SO_PEERCRED broker boundary — 20 Nov 2026

**New minimal extension, not a replacement for the previously PASS broker:**
`startOfflineMockBroker` now accepts an optional, explicit
`peerIdentity={uid,gid}` only in offline QA. With this option:

1. The exact AF_UNIX accepted socket is paused and inherited as file
   descriptor 3 by a short-lived `/usr/bin/python3 -I` child process.
   Its script is `scripts/dev/cst_team_onejob_peercred.py`.
2. Python calls `getsockopt(SOL_SOCKET, SO_PEERCRED)` on that inherited
   socket, verifies the non-root UID and GID against the *independently
   supplied* expected identity, and prints only a bounded constant verdict.
   Client-supplied bytes cannot claim another UID/GID.
3. **Only** a successful Python process exit plus the exact success
   marker permits the Node broker to call its existing `dialMock()`.
   Any mismatch, unexpected output, failure to spawn, verifier timeout,
   client disconnect, or invalid expected UID/GID closes the connection
   without opening an upstream connection.
4. The older mock-only code path remains for the already-PASS isolated
   TLS and protocol tests. It is **never** an operational entrypoint;
   `startOperationalCstDevBroker()` still unconditionally throws
   `INDEPENDENT_ACL_AND_DB_TRANSPORT_NOT_VERIFIED`. A user-supplied
   environment variable cannot enable the operational broker.

On the authorized VPS, a pinned-source integration test ran an actual
broker socket with `0660` permissions, owner/group `28500:28501`
and a parent directory `0750`, without creating Linux accounts.
A client with UID/GID `28503:28501` could reach the socket but was
**rejected by SO_PEERCRED before any mock upstream dial**. A separate
client `28502:28501` passed and received the mock upstream ACK, while
`28504:28505` was denied by pathname DAC (`EACCES`).
The broker/mock upstream and test paths were cleaned. All test results
remain synthetic and no PostgreSQL credentials or events were used.

The GitHub CI test on an unprivileged runner exercises the negative UID
mismatch and all original broker regressions. The positive distinct-UID
case is exercised on the authorized Linux VPS as root in **disposable
test-only processes**; this does not change the UID of live Core DEV,
and it does not make its current root-run container an approved pilot.

**Operational limits remain NO-GO:** a real broker is not installed,
the accepted-peer check is not bound to a deployed one-job container
identity, and there is no independently enforced fixed-pooler egress ACL
or real role-scoped CST-DEV database transport. The live preflight's
separate Unix filesystem/kernel peer flags and ACL/DB transport flags
remain false, as do subscriber receipt and independent Final ACK.

## Kernel nftables destination ACL: real TLS-only proof and reproducible QA auditor

A new read-only, **QA-only** source module
`scripts/dev/cst-team-onejob-nft-egress-qa.mjs` describes the minimum
destination-scoped outbound policy. It **never runs nftables, modifies a
firewall, launches a broker, or authorizes a pilot**. An explicit
`--audit-kernel-qa <trusted-test-IPv4>` command accepts JSON read back from
Linux `nft -j list table inet cst_onejob_egress_qa` and verifies the
actual kernel rule shape:

- `inet`/`output` chain, filter priority `0`, **policy drop**;
- exactly **one** IPv4 destination + TCP destination port `6543` accept;
- exactly one unconditional terminal **drop** rule;
- no additional chain, IPv6 exception, host-address exception, alternative
  destination, broader port or `ct established` bypass;
- packet counters must show both permitted and denied traffic.

The CLI requires `--audit-kernel-qa` to avoid a dynamic-import edge case
that would otherwise wait for stdin. Its output explicitly records
`qaNamespacePolicyVerified`, while permanently leaving
`operationalAuthority`, `realDevDatabaseTransportVerified`,
`independentOperationalEgressAclVerified` and tenant attestation **false**.
A user-selected expected IP is not an authenticated DNS proof.

On the authorized VPS a disposable non-root, cap-drop-all QA namespace
received `nft` rules from outside its namespace, without host firewall
changes. A test with two separate local mock servers on TCP 6543 showed
an allowed ACK from the permitted IP, denial of the other IP, and an
exact-source kernel JSON readback:
`qaNamespacePolicyVerified=true`, `allowPackets=4`,
`denyPackets=2`, `operationalAuthority=false`.
The test source was pinned to Core PR #1765, all 8 QA policy/unit tests
PASS, and all temporary networks/containers/worktrees were deleted.

A **separate** disposable namespace tested a real **TLS-only**
connection to the active
`aws-1-ap-southeast-2.pooler.supabase.com:6543` endpoint.
The outbound nftables policy was installed from the VPS host into the
non-root QA namespace **before any network probe**. It allowed only
one externally resolved pooler IPv4 and TCP port 6543. TLS 1.3
completed with the fingerprint-verified public Supabase CA:
`authorized=true`, `hostnameVerified=true`.
Attempts to reach the other pooler IPv4 at the same port and the
Docker host gateway were blocked by kernel default drop.
The kernel counters were `10` accepted, `4` denied. No PostgreSQL
StartupMessage, username, password, SQL, job or RLS mutation was sent.

**Important limits:** the real TLS probe did not originate from the
operational broker, and the test namespace was idle before ACL
installation. This does NOT establish a race-free production broker
lifecycle, an independently attested DNS resolution or fixed
destination set through IP rotation, nor project identity in
Supavisor's shared infrastructure. No real broker or pilot candidate
is approved. Future operation must prove an independent namespace,
ACL installed and validated **before broker traffic starts**, pinned
pooler identity/CA, non-root accepted-peer `SO_PEERCRED`, and an actual
dedicated short-lived RLS login to **only CST-DEV**. Job receipt and
independent Final ACK remain separate release gates. PROD remains
untouched and job #482 is never replayed.

**Filter-priority correction:** the first disposable rules used priority
`-100`, which is commonly assigned to destination NAT. The source policy
and exact JSON auditor now require output **filter priority `0`**,
so ordinary destination NAT is evaluated first. Priorities with the same
numeric value can have undefined ordering, so this still requires
independent namespace-wide policy inspection before operational use.
Source: https://www.netfilter.org/projects/nftables/manpage.html

## Combined pre-traffic ACL + accepted-peer broker lifecycle (QA only)

The separate nftables and Unix `SO_PEERCRED` proofs have now been combined
into one **disposable mock-only** regression workflow:
`scripts/dev/cst-team-onejob-broker-acl-lifecycle-qa.sh`. This script is
**not** a deployer and never opens a connection to Supabase.

On the authorized VPS it:

1. Starts two local mock TCP servers on port `6543` plus a non-root
   **idle** Docker namespace holder, with no real broker running.
2. Inspects the namespace to exclude unrelated pre-existing tables
   (Docker may create its normal private `ip nat` table), installs the
   existing one-IP `nftables` output policy with priority 0 and default
   DROP **before** starting the broker, and proves one mock destination
   allowed while a different destination is blocked.
3. Reads the real kernel JSON counters using the already-PASS strict
   `--audit-kernel-qa` source. Only a positive namespace QA result
   allows the next **mock** process to start.
4. Launches the existing `startOfflineMockBroker` in that already-filtered
   network namespace as an independent UID/GID `28500:28501` with
   `setpriv --no-new-privs --bounding-set=-all`. The broker's accepted
   Unix socket uses the existing FD3 `SO_PEERCRED` verifier and a
   separate approved test client `28502:28501`.
5. Proves the wrong test UID `28503:28501` is denied with
   `ECONNRESET` or no ACK **without increasing the upstream mock's
   connection counter**; the authorized test UID receives exactly
   one mock ACK and increments the mock connection counter by one.
6. Cleans up the mock process, Docker containers, transient bridge,
   Unix socket and QA directory regardless of success/failure.
   The separate Git detached QA worktree is removed by the outer test.

**Observed result on VPS:** `ACL_INSTALLED_BEFORE_BROKER_START=true`,
`KERNEL_QA_ALLOW_DENY_EVIDENCE_PASS`,
`MOCK_BROKER_STARTED_AFTER_ACL=true`,
`KERNEL_PEER_DENIED_BEFORE_UPSTREAM=true`,
`APPROVED_PEER_FORWARDED_EXACTLY_ONCE=true`,
and `CST_DEV_MOCK_BROKER_ACL_PEERCRED_INTEGRATION_PASS`.

When the QA runner creates a temporary Docker bridge, Docker itself can
add/remove transient host NAT/forwarding rules as part of normal network
creation. The test does **not** edit any permanent host firewall policy,
existing Nginx routing, Core DEV runtime, Supabase role or PROD service.
The QA namespace's nftables table is destroyed on cleanup.

**This remains a mock bridge, not the operational broker.** Successful
combined QA does not establish the true Supabase tenant identity,
DNS/IP-rotation handling, independent host-level ACL attestation,
a production-safe no-traffic-before-ACL deployment controller, a real
short-lived CST-DEV-only RLS role, database credentials, or delivered
subscriber/QA receipts. The broker's operational starter continues to
throw, the live one-job preflight's independent release flags remain
false, and no job can be run based on this result.

A dedicated CI regression now checks that the script remains
syntax-valid, contains only mock endpoints, enforces ACL installation
and readback before startup, uses distinct non-root broker/client
identities, and cleans all local resources. The **privileged**
namespace integration itself is run only in controlled VPS QA, never as
an unreviewed deployment or GitHub runner background service.

## Inert staging roles and strict TLS in the preflight catalog

**20 Nov 2026, read-only CST-DEV catalog:** existing role names
`cst_team_model_pilot_stage_login` and `cst_team_model_pilot_writer`
are both `NOLOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`,
without direct `ai_platform` table privileges or active sessions.
The staged role has a restricted membership in the inert writer role.
These were created outside this PR workflow; **do not delete or duplicate
them** merely to make a count equal to one.

The former preflight gate counted every name beginning
`cst_team_model_pilot_` and required exactly one role total.
That would have failed permanently once a new one-job login was
approved while the two safe NOLOGIN scaffolds remained. The read-only
catalog query now distinguishes the only login allowed for this job
from **0–2 known safe scaffolds**, requiring:

- An authenticated short-lived login whose name and lifetime match
  exactly the intended bounded pilot pattern, without privilege
  escalation or RLS bypass;
- Zero unexpected additional prefixed roles, unsafe scaffolds or
  extra active logins. A count of `1 login + 2 verified scaffolds`
  is admissible **only after all other release gates are satisfied**;
- `0 login + 2 NOLOGIN scaffolds` remains **NO-GO**, never an
  implicit permission to submit or execute a job.

The read-only gate also no longer connects to PostgreSQL with
`ssl.rejectUnauthorized=false`. Any SQL diagnostic it initiates
requires the exact fingerprint-pinned Supabase Root 2021 CA at
`/run/cst-onejob-dev-db/ca/prod-ca-2021.crt`,
a regular non-symlink, non-writable file, and an authenticated
strict TLS context with `rejectUnauthorized=true`.

Without a properly provisioned candidate/CA, the current shared Core
DEV container reports `DEV_TRUSTED_CA_NOT_VERIFIED` instead of
falling back to insecure database access. This makes the report
**NO-GO**, while catalog facts can still be independently verified by
the connected Supabase DEV read-only tool. No new role, subscriber,
job or credential was provisioned in these checks.

**Exact-head tests:** 23 focused Node tests PASS including safe
scaffold coexistence, extra/unsafe role rejection and strict TLS
source guards. A real VPS read-only preflight exited 2 with
`pilotAdmissionReady=false`, `sideEffects=NONE`.
The test checkout and temporary report were cleaned afterward.

## Read-only preflight now uses the exact one-job socket adapter — 20 Nov 2026

**Root cause closed in Draft source:** the prelaunch diagnostic in
`scripts/dev/cst-team-onejob-readiness-gate.mjs` previously constructed
`new pg.Client({connectionString:raw,...})` with a *direct TCP*
transport. But the approved candidate topology has no general IP
route and must reach PostgreSQL through the one-job Unix socket broker.
A secure broker could therefore have been running correctly while
preflight still failed with an unrouteable direct connection.

The diagnostic now imports the **existing**, already tested
`/app/lib/db/src/cstOneJobDevSocketTransport.ts` using Node 22
`--experimental-strip-types`. It retains the exact project-bound
pooler hostname `aws-1-ap-southeast-2.pooler.supabase.com:6543`,
dedicated `cst_team_model_pilot_YYYYMMDD_8hex.xssrfshdrtdfupgqwfdw`
DB username, approved Company-1 job identity and matching worker name;
it also requires the fingerprint-pinned Root 2021 CA with verified
`rejectUnauthorized=true` and passes `...socketOptions` to the real
`pg.Client` object.

The diagnostic **never** silently falls back to direct TCP if the
module, socket, bound job identity or CA is missing:
`DEV_PILOT_SOCKET_TRANSPORT_NOT_VERIFIED` is an explicit NO-GO
observation. It also never queries the existing shared Core DEV
container as a substitute when the exact candidate is not running:
`CANDIDATE_NOT_RUNNING` is reported instead.

**Independent VPS offline integration, pinned to source commit
`791a4cbd`:** a no-network, read-only, non-root container reused the
existing Core DEV QA image solely as a runtime dependency bundle,
mounting the *exact* new TypeScript adapter, its pinned CA and the exact
read-only diagnostic code extracted from the current PR source.
A fixed local Unix socket mock received a PostgreSQL SSLRequest and
a TLS ClientHello with **aws-1 SNI**, then intentionally disconnected
*before any database authentication*. The diagnostic reported a
controlled read error; the test required absence of any successful
database read, real password, PostgreSQL StartupMessage, SQL, or
external TCP network. It **PASSed**, and the mock process, temporary
socket, container and source checkout were removed. The remaining
original unit regressions passed 12/12.

**Still NO-GO for production or real E2E:** this is a network-none
source path verification, not a real CST-DEV login or RLS role proof.
CST-DEV retains 2 safe NOLOGIN scaffolds, 0 active pilot logins,
0 pilot RLS policies, 0 active completion subscribers and 0 approved
new model job. No operational broker or candidate was deployed, no
signer/dispatch authority or PROD connection changed, and job #482
was not replayed. An independent subscriber delivery/receipt path
must be implemented and reviewed before claiming E2E PASS.

**Additional observed boundary:** the current
`aiEventBusService.dispatch()` selects active
`ai_event_subscriptions`, invokes a configured handler, and for
nonempty delivery attempts updates the source `ai_events` status
and writes an audit. The dedicated one-job role template intentionally
does **not** grant subscription reads, event updates or generic
handler audit writes. Accordingly, event+audit atomic persistence
must NOT be represented as subscriber delivery. A separately
authorized, scoped **independent subscriber/receipt process** is
needed rather than granting the pilot worker blanket event-bus rights.

## Signed independent subscriber receipt gate (contract-only)

The scoped Core one-job worker may atomically persist one
`ai_platform.ai_events` `job.completed` row plus its corresponding
`event_published` audit. This **does not** imply a subscriber received
the event. The existing generic `aiEventBusService.dispatch()`
queries `ai_event_subscriptions` and can UPDATE event status, audit
generic handlers, create other jobs or call webhooks, depending on
subscription configuration. The deliberately restricted pilot role
has **no** corresponding broad subscription SELECT, event UPDATE or
handler-dispatch privileges and must not be granted these merely to
make a post-commit callback pass.

The separate `scripts/dev/cst-team-onejob-subscriber-receipt.mjs`
is a **pure, read-only cryptographic evidence projector**, not a
subscriber process. It checks a receipt only when all of the
following data are consistent:

- One **fresh** completed Company-1 model job, never historical job
  #482; the canonical `cst-ai-team-company1-dev:pilot-...` requestId,
  `qwen2.5:3b` model and exact `ollama_inference` capability.
- Its bounded, separate Ollama worker and persisted
  `job.completed` event, with source id, event UUID, job code,
  worker id and correlation id matching the job; plus the existing
  matching atomic `event_published` audit.
- A separately supplied independent subscriber identity and pinned
  Ed25519 public-key fingerprint; the receipt must be exactly the
  versioned `CST_DEV_JOB_COMPLETED_SUBSCRIBER_RECEIPT` envelope for
  CST-DEV project `xssrfshdrtdfupgqwfdw`, Company 1, that one
  event/job/worker, with a canonical signed payload, an independent
  subscriber id and a bounded receive timestamp. Unknown fields,
  unsigned/malformed/replayed receipts, stale/future timestamps,
  incorrect project/Company/job/worker/correlation and a mismatched
  public key or signature fail closed.

No private signing key is generated, distributed or saved by the
projector. Unit tests use **ephemeral in-memory Ed25519 test keys**.
An untrusted receipt may never supply its own accepted trust root.

**Crucial distinction:** `signedReceiptConsistent=true` means the
given *synthetic or externally supplied* objects have consistent
lineage and a valid signature under an independently pinned public
key. This does **not** establish that a real subscriber authenticated
to CST-DEV, durably committed one unique ACK, or that another system
independently read that ACK. Therefore the projector deliberately
returns these values **false even for a positive unit test**:
`durableReceiptReadbackVerified`,
`authenticatedSubscriberSessionVerified`,
`subscriberDeliveryVerified`, `operationalE2EVerified`,
`independentQaVerified`, and `independentFinalAckVerified`.

For operational E2E, an independently approved consumer must later:
(1) authenticate as a **different dedicated, least-privilege CST-DEV
subscriber identity**, (2) read only the approved, already committed
`job.completed` event under RLS, (3) process exactly that event
and persist an **idempotent, immutable** receipt bound to its
event_id and subscriber id, (4) have the true independent
subscription/DB session and pinned verification key read back by a
separate reviewer, and (5) supply independent QA and four-agent
Final ACK as distinct later authority steps.

Do **not** activate the generic event bus from the restricted pilot
role; do **not** equate generic `processed` status or
`event_published` audit with subscriber receipt. No
`ai_event_subscriptions` row, receipt table, database role, signer,
job, PROD object or existing API route is modified by this change.
Live CST-DEV still reports zero active completion subscribers,
zero dedicated login roles and no new queued model job. Keep
PR #1765 Draft / operational NO-GO until genuine delivery evidence.

## Independent subscriber receipt RLS in network-none PostgreSQL

**Separate role/template only, NOT applied to CST-DEV.**
`scripts/dev/cst-team-onejob-independent-subscriber-role-template.sql`
and its matching rollback template stage an **independent**
`cst_team_onejob_subscriber_YYYYMMDD_8hex` login, intentionally
outside the pilot model-worker role prefix. Its issuance is blocked
unless one **new, approved queued** Company-1 Ollama job exists and
the trusted CST-DEV connection/project, subscriber identity,
independent public-key fingerprint and short expiry are reviewed.

The template grants only:
- `SELECT` on `ai_platform.ai_events` with RLS restricting
  `job.completed` to one exact job id and worker id;
- `INSERT` on the append-only `ai_platform.ai_audit_logs` table
  with RLS requiring one exact independent subscriber and bounded
  receipt payload for that event, Company 1 and CST-DEV;
- `USAGE` of only the existing audit log sequence, plus database
  `CONNECT` and schema `USAGE`.

It does **not** grant `SELECT` on `ai_jobs` or
`ai_event_subscriptions`, does not modify `ai_events`,
does not dispatch model jobs, and has no access to the protected
GPT02 signers. The original one-job model role's privileges remain
unchanged.

A dedicated **partial unique index** on
`ai_audit_logs(resource_id,actor_id)` for only the
`cst-team-model-subscriber/job_completed_received` success action
prevents duplicate receipt audit rows. Index existence and
definition are verified; on subsequent isolated subscriber role
rotations the same index is reused, not rebuilt. Rollback
disables the temporary subscriber login, terminates only its own
sessions, removes its RLS policies and grants, and retains all
historical audit receipt rows and the uniqueness index.

**Verified on the authorized VPS, with an entirely disposable
`postgres:16-alpine` server using `--network none`:**
`scripts/dev/cst-team-onejob-independent-subscriber-role-rehearsal.py`
successfully created the restricted role for a synthetic approved
Company-1 job, showed only its authorized completion event was
visible, denied unrelated events and wrong-company receipts,
accepted exactly one audit receipt, rejected a duplicate,
and revoked the role while preserving its audit record.
A **second** synthetic job/subscriber identity was then
successfully provisioned and revoked against the same retained
unique index. This proof never contacted a Supabase endpoint,
created a real credential, or touched PROD. It is wired into
Core CI alongside the already-PASS one-job worker RLS rehearsal.

**Important distinction:** the disposable SQL test intentionally
checks the signature field's format and the public-key pin's
value, **not Ed25519 signature authenticity**. Signature and
job/worker/event lineage must be validated through the separate
`cst-team-onejob-subscriber-receipt.mjs` pure projector
using a public key pinned by an independent custodian.
Only a real authorized subscriber read/ACK, durable role-bound
receipt readback, and independent QA can later raise delivery
evidence above the current `NO-GO` status. An approved real
Company-1 job and its subscriber credentials/receipt do not yet
exist; neither the templates nor this rehearsal create them.

**Prelaunch gating:** the read-only `projectOneJobGate` additionally
requires `candidateIndependentSubscriberArmed===true` before it can
report that a new job is eligible for admission. The current live
preflight **hardcodes this observation to false**; no environment
flag, synthetic Ed25519 test receipt, stage role or operator label
can set it. A future separate, independently reviewed readiness
collector must prove the scoped consumer/role, key custody and
persistence path before a real newly approved job starts.
The blocker is `INDEPENDENT_ONEJOB_SUBSCRIBER_NOT_ARMED`.
This prevents publishing a new event into a system with no
ready receipt consumer, without modifying the already-PASS event bus.

## Functional isolated subscriber: actual PG16 RLS SELECT, signed INSERT and independent readback

**20 Nov 2026 — a real database round-trip, but NOT live CST-DEV.**
The model job completion event bus, worker RLS, independent subscriber
RLS and signed receipt verification remain separate components;
previous PASS features were reused rather than replaced.

A minimal, import-inert `cst-team-onejob-subscriber-consumer-qa.mjs`
does precisely three database operations for a separately bound
Company-1 job: (1) verify PostgreSQL `current_user` equals the
approved bounded subscriber role; (2) `SELECT` at most two matching
`job.completed` events through that role's RLS, requiring exactly
one fresh event with matching job/worker/correlation identity;
(3) after an **external signing callback** produces an Ed25519
signature verified against an independently supplied public-key pin,
`INSERT` exactly one `job_completed_received` row into the existing
append-only `ai_audit_logs`. The consumer does **not** import a
private key, connect to Supabase on its own, dispatch a worker,
list subscriptions, query jobs, UPDATE events, or create tables.
A duplicate unique-index violation is a **DENIED** result, not a
successful receipt.

The following test-only components demonstrate the path:
- `scripts/dev/cst-team-onejob-subscriber-functional-rls-qa.py`
- `scripts/dev/cst-team-onejob-subscriber-functional-client-qa.mjs`
- `scripts/dev/cst-team-onejob-subscriber-functional-review-qa.mjs`

An independently repeated exact-source VPS QA used a disposable
`postgres:16-alpine` server and a separate Core Node container,
**both started with `--network none`**. They shared only the
temporary PostgreSQL Unix socket directory; there was no IP route
to Supabase or PROD. The test server deliberately used
`POSTGRES_HOST_AUTH_METHOD=trust` for **local-only fixture
authentication**, not a real pooler or approved CST-DEV login.
The fixture used the existing subscriber role/RLS template against
synthetic Company-1 job #483 (never actual job #482) plus an
unrelated Company-3 event.

Test-only Ed25519 keys were generated ephemerally; the private key
was readable only by the non-root subscriber QA client, while the
independent reviewer received the public key from a **separate
fixture path, never the receipt row**.

**Observed functional PASS:** exact PostgreSQL role verified;
one authorized event visible; signed `ai_audit_logs` INSERT
returned one row; a second delivery was denied by the existing
partial unique index; a different process performed a privileged
fixture readback and validated the persisted signature, job,
event, worker and publisher audit through the pure receipt
projector. The temporary subscriber role was revoked using the
existing rollback template, while the signed audit record and
immutable unique index were preserved. All test processes,
source checkout, keys, socket mounts and disposable DB were
deleted. The independent reviewer intentionally retained
`subscriberDeliveryVerified=false` and
`independentFinalAckVerified=false`: synthetic key custody and
a local trust-authenticated PG16 fixture are **not** a live receipt
or four-agent Final ACK.

**Release boundary remains unchanged:** the operational subscriber
is still **NOT INSTALLED**, no actual CST-DEV subscriber identity,
scoped role, secret-custody mechanism, event, ACK or job exists;
no real pooler session was authenticated. A live release requires
independent signer/key custody and explicit Owner/Super Admin
approval for a newly created Company-1 job, strict project+TLS
verification, independently controlled broker/ACL, an actual
RLS-authenticated subscriber connection and persisted receipt
with a separate real readback and QA/Final ACK. Existing
Core DEV, GPT02 signers, job #482 and PROD were untouched.

## Offline subscriber auth strengthened: SCRAM and separate SO_PEERCRED signer

**20 November 2026, isolated VPS QA only.** The earlier disposable
PostgreSQL functional receipt test used a local `trust` authentication
fixture and temporarily made a synthetic Ed25519 private key readable
inside the subscriber test container. Neither arrangement could prove
separation of machine credentials from the subscriber signing key.

The same **previously passing functional flow** is now strengthened,
without rebuilding its event-bus, one-event RLS, immutable receipt
index, or rollback logic:

- Disposable `postgres:16-alpine` starts with **SCRAM-SHA-256**
  local/host authentication, an automatically generated temporary
  database admin password, and a **separate randomly generated
  subscriber password**. Only the subscriber QA container can read
  its own short-lived password file (mode `0400`). A deliberately
  wrong password is rejected with PostgreSQL `28P01` **before**
  the correct subscriber role is allowed to read its one RLS event.
- The original subscriber QA client **no longer imports or mounts
  any Ed25519 private key**. It has only the public key and a
  separate Unix socket to an isolated test signer.
- `scripts/dev/cst_team_onejob_signer_sidecar_qa.py` is an explicit
  QA-only Python+OpenSSL signer process, running as separate
  UID/GID `28510:28501`, in the disposable PG16
  **network-none namespace**. Its private key exists only in a
  signer-owned `0700` directory, readable as `0400` by the
  signer UID, **never mounted** to the subscriber container.
  It checks kernel `SO_PEERCRED` on each accepted Unix connection
  for the expected subscriber UID/GID `28502:28501`, validates
  the fixed synthetic Company-1 event/worker/receipt fields and
  freshness, and signs at most **two** bounded, canonical payloads.
  An unrelated UID with the socket group is rejected before signing.
- Subscriber and PostgreSQL QA containers still use `--network none`.
  Signer runs in that same isolated network namespace, and no
  live pooler/PROD/owner passwords are used. The existing consumer
  still performs only `current_user` verification, one RLS-scoped
  event SELECT, one append-only audit INSERT, and duplicate denial.
  A separately invoked fixture reviewer still reads the persisted
  receipt and verifies the Ed25519 signature from a public key
  provisioned outside the receipt data.

**Actual VPS proof:** first an independent SCRAM smoke test rejected
a wrong password with `28P01` and accepted the correct machine role.
Then the exact-source functional PG16+Node+separate-signer test
returned `PASS`: `subscriberRoleVerifiedUnderDisposableScramAuth=true`,
`independentSyntheticSignerSoPeercredRejectsWrongUid=true`,
`signerNetworkNoneAndSeparateNonRootUid=true`,
`subscriberNeverMountedEd25519PrivateKey=true`,
`signedReceiptInsertedOnce=true`,
`duplicateReceiptRejected=true`, and
`cryptographicSignatureVerifiedFromIndependentFixtureReadback=true`.
Unit/regression testing preserved the existing consumer's negative
and no-side-effect guards. All temporary credentials, private keys,
processes, sockets, containers and worktrees were cleaned.

**No operational promotion:** this does not establish real Supabase
CST-DEV pooler role authentication, an owner-approved new job,
the independent signer key custody in production, actual subscriber
delivery, four independently attested workers, or signed Final ACK.
The signer process is a **test-only fixture service**, not a new
production signer, GPT02 issuer, or task dispatcher. The one-job
release gate, `subscriberDeliveryVerified` and
`independentFinalAckVerified` remain **false / NO-GO**.
