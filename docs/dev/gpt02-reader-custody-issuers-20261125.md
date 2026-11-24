# GPT02-1782: operational custody issuers for CST-DEV

Target: `Travelintrips/Core-AI-Foundation`, `develop`, DEV project
`xssrfshdrtdfupgqwfdw`, canonical principal `openclaw-vps-main` and credential
name `openclaw-vps-dev-consumer`. Owner remains the only business approver.

This change supplies the missing worker-attestation issuance path and its
encrypted key-loading callsite. It does not treat the existing read-only Hub
Owner-link response, a coordinator appointment, a Task189 mandate, or Task190
evidence as permission to enroll a signing key or provision a database role.
Source/CI verification and live issuer activation are separate evidence stages.

## Worker attestation: existing Owner credential administration

The application mounts this endpoint through the existing `agent-runtime`
router:

`POST /api/ai/agent-runtime/credentials/:id/custody-attestation`

It accepts exactly `{ "expectedCredentialBinding": "<64 lowercase hex>" }`.
The credential ID and purpose-derived binding come from the existing unsigned
worker `/api/gpt02-reader-custody/attestation-request`. The public packet is a
request for an authorized issuer to evaluate, not an authorization by itself.
No bearer value, stored token hash, private key, SQL password, arbitrary path,
issuer, principal, or caller-chosen expiry is accepted or returned.

Issuance requires all of the following:

1. Literal `GPT02_DEV_CUSTODY_WORKER_ISSUER_ENABLED=true`, with both `APP_ENV`
   and `NODE_ENV` equal to `development`. The actual configured database pool
   must identify the fixed DEV project before session authentication queries
   the database.
2. Host `dev.cstlogistic.co.id`, Origin `https://dev.cstlogistic.co.id`, and JSON
   content. Forwarded headers do not choose an alternative target.
3. A real signed, unexpired internal session. This endpoint rejects reset,
   magic-login and other purpose-specific JWTs before the existing signature
   verifier. An active internal Owner whose password-change requirement has
   been completed is required. A worker bearer or an admin role is insufficient.
4. A transaction that rereads and share-locks the Owner and the exact active,
   unexpired service credential. Scope semantics match the existing custody
   broker: `agent:presence` or `*`. The server derives the generation binding
   from the stored token hash and compares it with the public request binding.
5. A protected, canonical Ed25519 private key whose derived public key equals
   the existing deployment-pinned attestor SPKI and SHA-256 fingerprint. If a
   DBA public key is configured, both of its public settings must be valid and
   its key must differ from the worker-attestor key.
6. A strict awaited `ai_audit_logs` insert and transaction commit. The general
   best-effort `logAudit()` function is not the issuance durability gate.

Success is HTTP 201 with exactly `{receipt, signature}`, accepted by the
unchanged V2 verifier. The lifetime is one hour, shortened by credential
expiry. The issuer checks validity after key loading, audit work and transaction
commit. A proof that expires during a wait is not returned as success.

The durable audit contains the authenticated Owner ID, credential ID, derived
binding, canonical public proof digest, public attestor fingerprint and validity
interval. It contains no bearer, stored token hash, private key or password.
Its issuance event records generated evidence; it does not assert successful
delivery to the client or installation of an active proof. A commit may succeed
before a subsequent expiry check denies delivery.

Every explicit authorized POST may produce a fresh envelope and audit event.
This route does not promise idempotent retries and does not publish or replace
the active worker/DBA pair. A later authorized worker-proof replacement changes
its canonical digest and requires a new matching DBA receipt. Revocation and
rotation remain enforced by the broker's current service-token authentication.

## Encrypted worker-key loading and release integration

The key loader extends the existing bounded reader loader with the single
fixed `--worker-attestor-key` profile. The default reader invocation is unchanged.
Neither profile accepts caller-provided paths or generates a key.

| Purpose | Fixed location |
| --- | --- |
| Separately provisioned encrypted key | `/etc/credstore.encrypted/gpt02-reader-custody-worker-attestor.pkcs8` |
| Static unit | `gpt02-reader-custody-worker-attestor-key-loader.service` |
| Authenticated systemd credential name | `private-key.pkcs8` |
| Decrypted unit input | `/run/credentials/gpt02-reader-custody-worker-attestor-key-loader.service/private-key.pkcs8` |
| Protected runtime input | `/run/credentials/gpt02-reader-custody-worker-attestor/private-key.pkcs8` |

The loader checks root identity, exact DEV environment and explicit opt-in
before opening the input. It accepts only the 48-byte canonical Ed25519 PKCS8
encoding, uses the existing descriptor-based protected directory walk and
bounded read, and publishes a complete file atomically with root ownership and
mode 0600 in a root-owned 0700 directory. It prints bounded result codes only.
The API separately checks that the private key matches the pinned public key.

The static, network-isolated unit has no installation target. Installing its
source and reloading systemd does not start or enable it. The reviewed DEV
release `start()` callsite validates the public configuration, starts this exact
loader only when the feature is explicitly enabled, then verifies metadata and
adds a read-only key-file bind for both canary and live containers. A quoted or
whitespace-padded new flag is rejected before loading: Docker and the release
wrapper must agree on the literal activation value.

Worker issuance is independent of the Owner-reader feature, the reader
credential, the TLS CA, and the not-yet-issued custody proof files. This avoids
requiring a DBA receipt before the worker attestor can issue its input. The
existing reader and custody mount checks remain in force for reader activation.
Existing issuer-reader socket mounts and release customizations must be
preserved when installing the host integration.

This key is a file bind. Authorized key replacement or revocation therefore
requires container recreation/removal of that mount; deleting the host file
alone does not revoke an already-mounted inode. Runtime issuer disablement and
public trust changes also require applying the container configuration. No
automatic enrollment, key rotation, systemd enablement or timer is added.

## Remaining live acceptance boundary

Installing this source does not establish live key provenance. An authorized
custodian must supply and enroll the actual purpose-specific keys and the
separately approved reader input. Ephemeral test keys must never be promoted to
live trust merely to obtain a PASS.

The dedicated reader role `gpt02_owner_ledger_reader_dev` is shared with the
existing Task190 consumer and has a one-connection limit. This work does not
reset that password, copy Task190's sealed material, terminate another
consumer, broaden OpenClaw's database rights, or grant root/postgres access.

Worker issuance proves only the current credential's canonical worker binding.
It does not by itself prove actual DBA custody, Owner-ledger E2E, final ACK,
relock, or execution permission. The actual DBA custodian must independently
check the approved reader input and its bounded TLS/read-only access before
issuing a matching V2 receipt. A separate live Super Admin request must still
return the matching redacted decision receipt for the original challenge.

## Verification and recovery

Unit/integration tests use ephemeral Ed25519 keys, synthetic database rows,
mocked transaction failures and protected-file fixtures. A positive issuance
must pass the real unchanged verifier. Denial tests cover Owner/session/origin,
DEV pool isolation, current credential generation, key provenance, strict audit
and commit failure, expiry during waits, and the absence of implicit activation
or active proof publication. Python tests exercise the actual release callsite
and both static loading profiles without reading live secrets or starting units.

Use normal CI and DEV release gates, record the actual deployed SHA and public
health response, and verify that inactive features remain inactive when no
approved key is configured. Preserve the previous release script and DEV image
for rollback. Restore host code only from the recorded exact backup; do not
overwrite unrelated installed release customizations with the tracked template.
