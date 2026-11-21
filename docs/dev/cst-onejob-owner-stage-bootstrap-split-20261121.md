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
