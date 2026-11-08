# GPT02 DEV — native recovery fencing proof contract (not deployed to DELL)

## Why this exists

The DELL live SSE listener currently invokes the ordinary wake executor, which
uses a generic claim token and a separate native process/job-object lease. That
lease is NOT the database recovery fencing token. A recovery command must not
reach any native/browser action through that path. The generic claim UUID/
metadata quarantine is in DEV, but it is only one layer.

This module adds a *standalone* signed proof verifier intended for a future
recovery-specific native execution path. It is **not imported by or installed
into the running DELL listener/executor**.

## Server-to-native envelope

The server must independently sign exactly this v1 canonical payload with an
Ed25519 private key under controlled server custody. **Neither the ordinary
worker nor a job prompt may supply the trusted public key or sign the proof.**

The native runner must pin the independently provisioned 32-byte raw Ed25519
public key and the expected reservation, parent command, child command,
Human Review, Job, worker, and verified artifact SHA-256.

All fields are required and extra keys are denied. Integers must be genuine
JSON integers, not booleans, floats or numeric strings.

```json
{
  "proof": {
    "protocol": "ai-core-gpt02-recovery-fence/v1",
    "reservationId": "22aa961d-ac1e-4e12-a2c8-28ed07ff97cc",
    "parentCommandId": "83db99f5-cbda-4e60-be71-3090fb411bbb",
    "childCommandId": "41aa961d-ac1e-4e12-a2c8-28ed07ff97cc",
    "humanReviewId": 6,
    "jobId": 135,
    "workerId": "gpt02-dell-worker",
    "artifactSha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "fencingToken": 1,
    "sequence": 0,
    "issuedAtUtcMs": 1700000000000,
    "expiresAtUtcMs": 1700000030000
  },
  "signature": "<base64-encoded 64-byte Ed25519 signature>"
}
```

The example identifiers and SHA are only synthetic test inputs.
The signed bytes are UTF-8:
`ai-core-gpt02-recovery-fence/v1\n` +
`json.dumps(proof, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)`.
Do not use ad hoc JavaScript JSON serialization for this signature without
cross-language golden-vector verification.

Lifetime at most 120 seconds, and proof must have an acceptable wall-clock
timestamp. After acceptance, convert remaining lifetime into a monotonic
deadline. Re-check before **every** native action. The first proof must have
sequence 0. Every renewal must use the **same** fencing token and next
sequence, while the previous proof is still live. A different fencing token
belongs to a **new native process**, never a takeover of an existing session.
Malformed, stale, expired, mismatched, or invalidly signed proofs cause terminal
denial. Native process termination must ultimately use the existing Windows
Job Object / watchdog containment; this module alone does not terminate.

## Required server implementation before E2E

1. Implement an **authorized atomic issuer** with fresh review/parent lock,
   complete history exclusion and unique candidate/link insert in one DB
   transaction. There is currently no supported issuer route.
2. Expose a separately authenticated, DEV-only recovery worker claim endpoint.
   It must verify that the command UUID is the issued child, and atomically
   acquire its recovery lease/fencing token, not an ordinary bridge token.
3. Sign proof only for the current persisted lease owner/token and validated
   parent-child, binding the exact native worker and artifact SHA.
4. For each heartbeat/renewal, verify the current unexpired lease and signed
   native session before returning a next-sequence proof. Reject stale workers.
5. Native runner must verify the pinned issuer signature and frame before all
   operations, in addition to the existing ordinary native lease. Never allow
   direct generic wake fallback. Return signed native ACK/result and verify it
   independently on the server.
6. Enforce fail-closed cleanup/release and audit. Prove end-to-end with an
   isolated worker and loss/replay/token takeover scenarios before enabling
   recovery flags.

**Current status:** proof verifier and synthetic tests are ready; no issuer
private key/config, no server signing endpoint, no native DELL integration,
no permission to dispatch or close Job 135. DEV and PROD remain unchanged.
