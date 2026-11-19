# Independent QA Verifier — CST-DEV one-job (proposed only)

This is a **separate QA process/identity** from the Owner, the Core AI API,
the worker on DELL, and the GPT02 signers. It is an automatic verifier, not a
second human approval. The authenticated Owner approves once.

## Trust boundary

1. Pre-admission QA observes candidate image SHA, digest, loopback/network
   isolation, scoped CST-DEV connection, exact approved waiting job, and
   independent event/audit/subscriber test path. It does not trust a JSON
   boolean furnished by the API under test. Evidence must originate from
   independently read sources, with immutable digest and exact job binding.
2. QA signs the canonical **PRE_ADMISSION** receipt using an independently
   custodied Ed25519 private key. Only a separately provisioned pinned public
   key and fingerprint are passed to the pure verifier. No key material is
   present in this PR; synthetic ephemeral keys exist *only in unit tests*.
3. The verifier checks detached signature, exact DEV project
   `xssrfshdrtdfupgqwfdw`, approval/job/requestId, model worker name, image
   SHA/image ID, verifier identity, nonce, stage, TTL at most five minutes and
   evidence digest. The domain `cst-onejob-independent-qa/v1` prevents
   reuse as GPT02 signer evidence.
4. A valid signature is **not** authorization to queue. A reviewed independent
   issuer and transactional broker must confirm the signature, current
   admission facts, one-time nonce, receipt row uniqueness and consumption
   under row locks, then update job and approval with audit in a single
   database transaction. Those capabilities **are not implemented**.
5. After completion, separate independently observed job status, event
   persistence, audit row, subscriber receipt and actual model response
   are verified. A `POST_EXECUTION` receipt is signed in its own stage.
   It cannot substitute for `PRE_ADMISSION` or Final ACK. Final ACK is
   issued only after an authorized reconciliation path verifies it.

## Status and non-goals

The code in `cstOneJobIndependentQaVerifier.ts` is a **pure, read-only**
signature and scope verifier. It issues no signatures, keys, permits,
roles, credentials, job transitions or dispatch. Return
`CRYPTOGRAPHIC_BINDING_VALID` is not `OPERATIONAL_PASS`.
Keys must never be copied from the GPT02 four-signer custody domains or from
the Core AI process under test.

The proposed SQL receipt ledger has forced RLS and no writable policy. The
admission broker still unconditionally denies transition. No live CST-DEV
migration, Docker service, API route, signer or PROD change is authorized by
this document. No second Owner/Admin approval is required.

## Pinned public-root filesystem custody (host preflight only)

The generic offline QA test CLI takes a trust manifest as a test input and
cannot, by itself, prove that file's administrator-controlled origin. For a
future independent host deployment use
`scripts/dev/cst-onejob-independent-qa-host-preflight.mjs`, which accepts
**only** a signed receipt and expected binding; the public trust root path
is fixed to `/etc/cst-onejob-qa/trust/public-root.json`.

The host custody preflight rejects a trust path symlink, checks
`/etc`, `/etc/cst-onejob-qa`, and its `trust` directory are root-owned,
not group/other-writable and not symlinks, and opens the root-owned public
key file with `O_NOFOLLOW`. It validates that same file descriptor's type,
owner, permissions, link count and size and checks the Ed25519 SPKI fingerprint.
The CLI never accepts a caller-supplied public key location. These guards
are reviewed as code and simulated in CI only; no filesystem provisioning,
private key, service account, trust-root approval or deployment is performed.

A successful host preflight remains `CRYPTOGRAPHIC_BINDING_VALID`,
**not** `OPERATIONAL_QA_PASS`, a one-use receipt consumption or Final ACK.
The trust file's content and fingerprint must be independently approved
before installation. Only the public key belongs on the verification host;
the signing private key must remain in separate QA custody. A new
operator-controlled execution agent must not be considered independent merely
because it runs as another process on the same writable host.
