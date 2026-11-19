# GPT02 DEV — Node/Python native recovery fence canonical bytes

This source contains a **pure formatter**, not a signer, issuer, API route,
lease grant, or worker-dispatch authorization.

The existing Windows native validator (PR #1684) expects Ed25519 signatures
over the bytes:

    UTF8("ai-core-gpt02-recovery-fence/v1\n")
    + UTF8(Python json.dumps(proof, sort_keys=True, ensure_ascii=False,
                            separators=(",", ":"), allow_nan=False))

The Node formatter validates exactly 12 fields, lowercase UUIDs, SHA256,
strict bounded integers, TTL ≤120 seconds and ASCII worker IDs. It rejects
unsafe JS integer values (notably PostgreSQL bigint beyond MAX_SAFE_INTEGER)
rather than rounding a fencing token. No signer is exported and no signing
keys are deployed.

Golden-vector test uses a publicly known SYNTHETIC test key derived from bytes
00..1f and an independently generated Python signature, verified in Node.js
with Ed25519. Tampering with the child, token, worker, artifact or any other
signed field invalidates verification. The test key is NOT a production
credential and must never be configured as an issuer key.

The future signer must use its own server-custodied key, a server-controlled
pinned-public-key rollout mechanism on DELL, and a *fresh* read-only verified
issuer+lease+lineage check immediately before each signature/renewal. Until
server-signed current-lease proofs and a running DELL native validator are
proven, keep GPT02 recovery flags OFF and the legacy worker on the ordinary
(non-recovery) path.

This is strictly an interoperability prerequisite, not a Job 135 E2E PASS.
