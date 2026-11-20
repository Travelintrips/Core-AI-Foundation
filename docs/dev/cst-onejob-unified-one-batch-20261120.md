# CST-DEV One-Job — Unified single-batch candidate (20 November 2026)

**Scope:** Supabase CST-DEV `xssrfshdrtdfupgqwfdw`, Company 1, one NEW qwen2.5:3b job. **Release: NO_GO** until real E2E proof. **Historical #482: read-only; no replay. PROD excluded.**

## One canonical business action

- Reuse **one** Owner login session and **one explicit confirmation** through `POST /ai/dev/onejob/owner-approve-and-stage`, subject to existing active-Owner DB readback, same-origin HTTPS, signed numeric-identity JWT issued within 20 minutes, an exact intent, and disabled dispatch.
- The dedicated, bounded writer creates one `WAITING` job, one approval ledger entry, and one audit **atomically**. The Company-1 partial unique index forbids a second active approval; the pilot request index forbids duplicate request IDs.
- Owner business approval is NOT independent technical QA. A signed approval event or an Owner ID in the database alone does not authorize queue transition, broker access or Final ACK.
- Do **not** use the alternative pre-staging machine role or separate post-WAITING Owner-intent route from the still-draft Core #1765 branch. Those are intentionally absent here, avoiding a second Owner action or job.
- Existing OTP/session systems remain unchanged. Do not request passwords, TOTP or new account setup.

## Reused security and subscriber components

The package integrates the already-developed strict Supabase CA pin and Unix socket transport, non-root one-session peer-credential broker, host-gateway and nftables ACL probes, disposable PostgreSQL TLS denial, one-event subscriber consumer, signed delivery receipt verifier, subscriber-specific RLS and rollback fixtures. None of these source/QA components is permitted to enable shared DEV, PROD, or GPT02 dispatch by itself.

AI Task Hub PR #202 remains a **separate** DEV-only monitor and four-agent signed evidence verifier candidate. Its synthetic 4/4 result is never real signed independent operation or Final ACK.

## One exact acceptance command

```bash
node scripts/dev/cst-onejob-onepass-acceptance.mjs --offline
```

The CI workflow first installs the isolated pinned broker-signature test dependency. This single command executes **44 GitHub-compatible** offline checks: Owner/atomic/broker/final-ACK, network, UNIX peer, pinned CA, subscriber receipt and isolated scoped-RLS. The additional functional PG16 subscriber round-trip and root-required broker namespace test are **VPS-only** (reported as `remainingVpsIsolatedQa`, not silently counted as PASS). All tests use synthetic or disposable data and are forbidden from creating a real CST-DEV job or touching PROD. The report must always say `releaseDecision: NO_GO`, even when `offlineResult: PASS`.

## Required real E2E evidence before declaring PASS

1. Independently authorized dedicated CST-DEV login/secret custody and role/readback, with actual TLS/DNS/ACL proof, no shared-runtime fallback.
2. Approved isolated runtime image from the exact source SHA, independently captured image provenance and real broker/subscriber process health.
3. One actual authenticated Owner action and exactly one NEW WAITING job; approved one-use WAITING→QUEUED transition, executed model and durable job.completed event/publisher audit.
4. One actual separately signed durable subscriber receipt read back from CST-DEV.
5. Four genuinely independent agent attestations and one independent FINAL ACK bound to the same approval/job/source/event/receipt, not operator-typed status.
6. Rollback/relock after success or failure, with duplicate/replay rejection and existing shared DEV healthy. No PROD change.

If **any** evidence item is missing, `CST_DEV_ONEJOB_REAL_E2E_PASS` must not be reported; keep **NO_GO** and identify the missing item. Do not merge, deploy or issue credentials solely on CI success.
