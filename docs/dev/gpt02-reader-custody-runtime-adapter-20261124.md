# GPT02-1782: bind reader custody proofs to the current credential and protected mount

Scope: CST-DEV `xssrfshdrtdfupgqwfdw`, canonical worker `openclaw-vps-main`, service token name `openclaw-vps-dev-consumer`. This change supplies a verification adapter; it does not supply an issuer, credential, database grant or execution permission.

## Evidenced problem

The mounted `createLockedGpt02ReaderCustodyBroker()` in baseline `7853c975ca878e9a61a57faf114fa272773faff3` returns `false` for every worker attestation and every DBA custody receipt. Token metadata does not reach either decision. Thus manually populating `canonicalPrincipal`, `attestedBy` or `scope` would not repair the 403 and must not be used as proof of attestation.

During this work, PR #1813 merged as `e96ab86e1b58dbff33afc2b20b3336f83f4bf8ce` and supplied a first signed-proof adapter. This patch is reconciled onto that change: it strengthens the existing `gpt02ReaderCustodyVerifiedAdapter.ts`, keeps its configured factory, public-key environment names and proof mount paths, and uses one runtime adapter. The first adapter did not bind token generation, did not bind the DBA receipt to the worker proof or actual reader mount, and read files without descriptor ownership/symlink/size protection. Those are the remaining source defects addressed here.

The new envelopes use explicit **v2** audiences. Flat `GPT02_DEV_WORKER_ATTESTATION_V1` and `GPT02_DEV_OWNER_READER_ISSUER_RECEIPT_V1` proofs cannot establish current-token custody and are rejected; there is no automatic conversion, re-signing or permissive fallback. Existing public keys can be retained if their authorized provenance is verified, with the matching fingerprint settings and newly issued bound evidence. No live trust or evidence is rewritten by this source change.

An unfinished candidate at `/opt/gpt02-custody-attestation-20261124` contained a dedicated Ed25519 contract. Its UUID expression rejected valid credential IDs, and its file reader followed symlinks and bounded the size only after reading. That working tree is preserved. The implementation here retains the purpose-specific credential binding and wire format, fixes UUID validation, and completes the separate custody receipt path.

## Request path and observable outcomes

The existing application mount remains `/api/gpt02-reader-custody`. The runtime checks `APP_ENV=development`, rejects `NODE_ENV=production`, and validates the actual configured database pool against the fixed CST-DEV project. Request JSON, Host headers and worker metadata cannot select the project, principal, files or keys.

| Request | Required proof | Result |
| --- | --- | --- |
| `GET /attestation-request` | Existing active, unexpired `agent:presence` service token with exact name; verified DEV pool | An **unsigned** target + current credential ID + purpose-derived generation binding. All authorization, signer and dispatch flags are false. No file, password or token hash is returned. |
| `GET /status` | Same service token, trusted worker signature, active healthy canonical presence | 403 with a bounded reason when worker proof is missing/invalid; otherwise 200 with custody evidence or a pending DBA reason. |
| `POST /request` | Same worker authorization and one of the existing four coordination actions | 409 while custody evidence/mount is missing; 200 only when ready for a **separate** reader E2E check. This endpoint does not dispatch or persist a provisioning request. |

`GET /attestation-request` is a bootstrap packet for the authorized attestor, not a canonical-identity attestation. It cannot grant itself access to `/status`. No new service token is required, and no stored token hash needs to be disclosed. The existing authentication middleware derives the binding internally; reissuing the token under the same row ID changes the binding and invalidates both receipts.

All success responses distinguish custody evidence from actual reader E2E. `readerE2eVerified=false` remains explicit. No password, role change, signer, dispatch, relock or production action is implemented by this broker.

## Trusted inputs and exact locations

The authorized deployment operator pins public keys and their SHA-256 fingerprints in the existing DEV service environment. These are **public** SPKI DER bytes in canonical Base64; fingerprints are lowercase SHA-256 hex over the DER bytes. They are never accepted from worker requests.

| Purpose | Public key setting | Fingerprint setting |
| --- | --- | --- |
| Worker credential attestor | `GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_B64` | `GPT02_DEV_CUSTODY_ATTESTOR_PUBLIC_KEY_SPKI_SHA256` |
| Reader credential custodian | `GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_B64` | `GPT02_DEV_CUSTODY_ISSUER_PUBLIC_KEY_SPKI_SHA256` |

The two technical issuer keys must be distinct. This is a separation of machine capabilities, not a requirement for a second human approval. The existing Owner remains the business decision maker. A key is trusted only after the authorized operator establishes its actual issuer provenance; generating a local test key and pinning it to make this broker pass is not activation.

| Runtime file | Purpose |
| --- | --- |
| `/run/credentials/gpt02-reader-custody/worker-attestation.json` | Signed public worker attestation envelope |
| `/run/credentials/gpt02-reader-custody/issuer-receipt.json` | Signed public DBA custody receipt envelope |
| `/run/credentials/gpt02-owner-ledger-reader/reader.json` | Existing reader credential mount; inspected **only through descriptor metadata** by this broker |

All parents must be real root-owned directories, without group/other write permission. Files must be regular, root-owned, have one link, and have no group/other permission. Open uses `O_NOFOLLOW | O_NONBLOCK`; symlinks, FIFOs, directories, unsafe ownership or permissions are denied. Signed documents are at most 8,192 bytes and are read through a bounded descriptor with before/after consistency checks. The credential file must be present with a size from 1 to 4,096 bytes, but its contents are never read or hashed by this adapter.

Host-side encrypted storage remains `/etc/credstore.encrypted/gpt02-owner-ledger-reader.json`, as already specified in the reader handoff. Merely creating that host file does not make the container mount available. The legitimate custodian handles encryption, loading, exact-role TLS and column-limited SELECT verification through its authorized provisioning procedure. The broker neither decrypts files nor runs `systemd-creds` or SQL.

## Signature contract for the existing issuer integration

Each document has exactly two fields, `receipt` and `signature`. `signature` is an Ed25519 signature of UTF-8 `JSON.stringify(canonicalReceipt)` in canonical Base64url, without padding. No arbitrary extra fields or embedded keys are accepted. Incoming JSON property order is immaterial; the verifier reconstructs this signing order.

Worker receipt fields, in canonical order:

1. `audience`: `CST-DEV/GPT02/READER-CUSTODY/WORKER-ATTESTATION/v2`
2. `project`: `xssrfshdrtdfupgqwfdw`
3. `scope`: `GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV`
4. `principal`: `openclaw-vps-main`
5. `service`: `openclaw-vps-dev-consumer`
6. `credentialId`: exact authenticated service-token UUID from the unsigned packet
7. `credentialBinding`: exact purpose-derived binding from that packet
8. `issuer`: `CST_DEV_AGENT_CREDENTIAL_ADMIN`
9. `notBefore`: UTC Unix milliseconds
10. `expiresAt`: UTC Unix milliseconds, strictly after `notBefore`, at most 24 hours later

DBA receipt fields, in canonical order:

1. `audience`: `CST-DEV/GPT02/READER-CUSTODY/DBA-RECEIPT/v2`
2. `project`: `xssrfshdrtdfupgqwfdw`
3. `scope`: `GPT02_READER_CREDENTIAL_CUSTODY_CST_DEV`
4. `principal`: `openclaw-vps-main`
5. `readerRole`: `gpt02_owner_ledger_reader_dev`
6. `runtimeCredentialPath`: `/run/credentials/gpt02-owner-ledger-reader/reader.json`
7. `issuer`: `CST_DEV_READER_CREDENTIAL_CUSTODIAN`
8. `credentialId`: same authenticated credential UUID
9. `credentialBinding`: same generation binding
10. `workerAttestationSha256`: SHA-256 of the canonical worker receipt bytes, excluding its envelope
11. `receiptId`: unique custody-receipt UUID
12. `notBefore`: UTC Unix milliseconds
13. `expiresAt`: UTC Unix milliseconds

The DBA validity interval must be contained within the worker interval. The worker receipt and DBA receipt are checked again on each request. Removing a protected receipt revokes that evidence for subsequent requests; no grant is cached. A changed/renewed worker receipt requires a new matching DBA receipt. Repeated GETs are permissible because they only verify evidence and have no provisioning side effect. Existing token revocation/expiry stays enforced by authentication.

## Concrete remaining operational handoff

There is no custody-registration UI or authorized attestation/credential issuer endpoint in the inspected baseline. The existing `/ai/agent-runtime/credentials` management route creates/revokes service tokens; it is not an attestation issuer. This change does not invent an administrative panel or label a metadata update as authorization.

After the source change passes review and the established DEV release gates, the existing worker can retrieve `/api/gpt02-reader-custody/attestation-request`. The authorized credential administrator must verify that public packet against the canonical worker identity and produce the first signed document through its real issuer. The authorized reader custodian must provision the existing dedicated reader, install its encrypted storage and runtime mount, verify its limited TLS/SELECT identity, and supply the matching non-secret DBA receipt. The deployment operator installs only verified public trust and evidence. If those issuer capabilities do not exist, they remain a specific integration prerequisite; this verifier cannot create their authority.

Then check the same authenticated worker's `/status` and require the fixed receipt ID, verify a rotated/revoked credential or removed receipt is denied, and perform the separate real Super Admin request:

`GET /api/gpt02-owner-ledger/decision/:challengeId`

Use the original challenge and real signed Super Admin session. Do not create a replacement approval to make the result green. The dedicated reader must return a matching redacted decision receipt before Owner ledger E2E can pass. Final ACK, relock auditor and task execution retain their separate evidence requirements.

## Validation and rollback

The dedicated GitHub workflow exercises the actual mounted factory, real ephemeral Ed25519 signatures, token rotation, strict scope/time/key checks, protected file handling and denied actions. Tests use simulated filesystem/DB boundaries and never issue real credentials, query the live ledger or invoke relock. These are source/integration tests, not live Owner ledger E2E.

Until authorized trust/evidence is installed, the new factory stays closed with a specific missing-prerequisite reason. Runtime rollback is the established previous DEV image/configuration; receipt removal also closes the coordination check on the next request. No migration, timer, database role, key generation or production change accompanies this source patch.
