# GPT02 CST-DEV Owner Ledger — fresh public custody readiness (no v9 replay)

**Scope:** `xssrfshdrtdfupgqwfdw`, dedicated reader `gpt02_owner_ledger_reader_1782_dev`, Owner Ledger **negative E2E**. This file introduces a read-only public-proof checker using the existing v2 Ed25519 attestor and DBA issuer schema. It is **NOT** a new authorizer, issuer, credential loader, role/lease writer or Nginx gate opener.

## Background

- The original `readiness-v9-readonly.py` still pins the pre-cutover vhost SHA `e34dde83...` and a specific old worker digest/binding. It correctly reports a blocked result because both public receipts expired and the historical one-shot v9 consent was consumed. **Do not re-pin/re-use the old v9 one-shot executor**.
- The active closed vhost is SHA `ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d`; the installed fail-closed boot guard is SHA `0c7a67958476235ab7ae27d359b9aa1e38bf3638e30162bd23e1502b9f6e3fd5`, verified directly on Hostinger VPS 27 Nov 2026 with HTTP503.
- Direct PostgreSQL `:5432` TCP+TLS/CA+hostname verification recovered and PASS. This does **not** prove a live reader session; existing role's `rolvaliduntil` expired 26 Nov 2026 16:36:51Z, 0 sessions.
- GitHub Issue [#1782](https://github.com/Travelintrips/Core-AI-Foundation/issues/1782) was closed for its **OpenClaw scoped assignment/registration** acceptance; it is NOT the sign-off for the signed Owner foreign-challenge HTTP404 E2E.

## New source-only checker

`scripts/vps/gpt02_owner_ledger_fresh_readiness_readonly.py` deliberately has **no `--execute` mode**, performs no login, no mutation and no network requests. It reads only fixed root-owned public pinned keys, current public worker/DBA signed envelopes and current closed Nginx + boot script, checking:

- Exact CST-DEV audience, principal, scope, service, native reader and sealed runtime *path text*.
- Independently pinned, distinct Ed25519 public trust keys; canonical signature verification with exact v2 field order, no duplicate JSON keys, no foreign worker/issuer role/nonce/binding.
- Strict `notBefore`, `expiresAt`, maximum 24-hour signed window and **at least four minutes remaining** for both receipts; DBA receipt lifetime is nested inside the worker proof and matches worker credential ID, binding and SHA of signed canonical worker receipt.
- Exact current **closed** Nginx site hash, one GET-blocking HTTP503 gate and exact owner-ledger route, unchanged dedicated upstream; installed boot-hook SHA; no existing timed gate backup.
- A bounded JSON status with no signature, password, token, underlying exception, credential generation, ledger row, Owner identity or secret file path.

The result can report `PUBLIC_EVIDENCE_CURRENT_ONLY` when these limited conditions PASS. **It always reports `worker_token_authenticated=false`, `reader_login_verified=false`, `owner_fresh_one_use_authorization_verified=false`, `live_negative_http404_verified=false`, `live_e2e_ready=false` and `action=RETAIN_NGINX_503`.** Public evidence never grants permission to open the gate.

### Source-only CI validation

`python3 -B -m unittest discover -s scripts/vps -p test_gpt02_owner_ledger_fresh_readiness_readonly.py -v`, with `cryptography==41.0.7` matching the already installed VPS library. Synthetic Ed25519 keys and signed receipts are generated **only in-memory**; no real production/DEV credentials, database or network access.

## Actual operational blockers and sequence (separate Owner consent)

1. **Fresh one-use Owner authorization** for exactly the next CST-DEV GPT02-1782 native reader custody preflight and bounded negative Owner Ledger test. Do not reuse v9 authorization or a stale Owner browser identity result. This request does not authorize Task190, PROD, Phase B, signing, dispatch, table grants or general role changes.
2. New authorized worker public attestation with proper generation binding. The DBA custodian itself must authenticate the real dedicated reader and verify actual `session_user=current_user`, PostgreSQL backend TLS, role privileges, RLS, read-only, 14+10 column projections, ≤15-minute lease and its own signed receipt before the protected GET could ever be opened.
3. Verify existing signed Owner browser session and exactly one requested foreign challenge; review and prepare a separate modernized one-shot operator that pins the **current** closed vhost hash, independently arms rollback ≤90 seconds, performs the minimal approved GET test, then closes the gate to HTTP503, verifies original challenge unchanged and forces reader expiry.
4. The prior v9 operational scripts remain unmodified, and are intentionally **blocked**. No automated deploy, opening, role renewal or systemd execution is authorized by this source-only contribution.

**Status:** Owner Ledger negative E2E remains PARTIAL/NO-GO until genuine signed Owner HTTP404 JSON/no-store plus post-rollback HTTP503/expired reader are independently documented. Task190 remains NO-GO.
