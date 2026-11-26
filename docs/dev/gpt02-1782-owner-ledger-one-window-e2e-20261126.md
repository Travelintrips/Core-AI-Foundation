# GPT02-1782 CST-DEV — coordinated Owner Ledger positive E2E runbook

**Scope:** `xssrfshdrtdfupgqwfdw` / `dev-ai-task.cstlogistic.co.id` only. **State:** source-only preparation, **NOT** proof of E2E success or authorization to change privileges. No PROD, Phase B, RLS, Task190, signer, or dispatch.

## Why this exists

The reader, independent DBA probe, and negative HTTP tests passed in earlier one-time windows, but the browser Owner's positive GET was never observed before the reader login lease expired. The existing AI-Task-Hub browser code already obtains the signed Hub token in the browser and submits a same-origin GET; it must **not** be exported to chat, shell history, GitHub, or a separate proxy.

The VPS formerly loaded a legacy duplicate Nginx virtual host from `sites-enabled`, now archived outside that directory; retain that fix. The canonical Nginx location deliberately returns 503 until a tightly bounded authenticated trial. A 200 `text/html` from a wrong Host is a SPA fallback, **not** a successful ledger read.

## Preflight: only read-only probes

1. Verify exact DEV project and role `gpt02_owner_ledger_reader_1782_dev`; `rolvaliduntil` must be strictly in the future; `rolconnlimit=1`, superuser/BYPASSRLS=false and membership count=0. Do not extend the role on a generic “lanjut.”
2. Independently verify current signed worker attestation and DBA receipt with pinned Ed25519 public keys, credential generation, canonical digest, scope, principal `openclaw-vps-main`, project, and expiry. A successful historical systemd oneshot does not imply a currently valid receipt.
3. Verify `core-ai-dev` healthy with its dedicated IPv6 network, credential read-only mount, pinned TLS CA, and dedicated reader feature. Verify the two scoped RLS policies and column-only grants without altering them.
4. Verify canonical Nginx `nginx -t`, no duplicate `dev-ai-task` vhost, public GET is still 503, direct backend no-bearer GET is 401. Confirm backup and functional rollback. Keep Task190 gate/socket unchanged.
5. Owner logs into `https://dev-ai-task.cstlogistic.co.id/gpt02-owner-approval` using `admcst001@gmail.com`, presses **Verifikasi sesi & tautan Owner**, and confirms `googleSessionVerified=true`, link `active/matched`. A stale existing UI result does not prove the session is still fresh at execution time.

## Single bounded execution window (separate explicit Owner authorization required)

**Do not start the role lease unless the genuine Owner is ready to click the existing read-only button in the same window.** User approval of a previous one-time lease does not carry forward.

1. Capture PRE evidence and backup canonical DEV Nginx file outside `sites-enabled`, hash it. Prepare automatic rollback **before** making the temporary change, with an independent expiry/watchdog so it still restores the gate if the operator/browser disconnects.
2. With fresh explicit one-use authorization, renew **only** the dedicated reader role for a bounded window of at most 15 minutes and never past its signed worker validity. Reconfirm role attributes, absence of parent memberships, and no unrelated sessions.
3. Use the existing guarded `/usr/local/sbin/gpt02-reader-custodian-start.py` once, with its one-shot preparation flag restored to `false` in a `finally` path. Verify independent signed DBA receipt and current expiry, exact worker digest and reader principal.
4. Temporarily remove only the exact `return 503` from canonical `location ^~ /api/gpt02-owner-ledger/`; preserve allowed methods, upstream `127.0.0.1:18082`, trusted Host, Authorization forwarding, no cookies, and all unrelated locations. `nginx -t` then reload; the watchdog is armed already.
5. Immediately perform public negative checks: no bearer **401 JSON**, malformed challenge **400 JSON**, foreign Origin **404 JSON**, cookie **404 JSON**, POST **denied** (Nginx may return **403**), and wrong Host must never yield ledger JSON. Never count a SPA `200 text/html` as PASS.
6. Owner immediately presses **Baca keputusan challenge asli** in the verified browser session. The existing UI calls `readOriginalOwnerLedger()`, `getStoredToken()`, `credentials:omit`, redirects disabled, GET-only. No token or cookie is copied to logs/tools/chat.
7. Record **positive E2E PASS only** if the real browser sees an HTTP **200 application/json** with exact challenge `9c4f21e1-48af-4f7f-9830-931b84e3e846`, `scope=GPT02_RELOCK_CST_DEV`, `status=CONSUMED`, `decision=APPROVED`, manifest SHA256 and decidedAt valid, `readOnly=true`, `executionPermitted=false`, `signingPermitted=false`, `dispatchPermitted=false`, and `releaseDecision=NO_GO`. The UI's validated rendering is useful evidence; no sensitive bearer evidence may be captured.
8. Test wrong identity and cross-challenge denial using only legitimate test identities or existing fixtures; do **not** manufacture a signed session, substitute claims, or query unrelated ledger rows.
9. **Always restore the Nginx 503 gate in `finally`** unless the Owner separately approves permanent DEV exposure after all PASS checks and a reviewed safe release. Verify byte-identical rollback, `nginx -t`, reload, public GET=503, and preservation of unrelated services. On any unexpected result: fail closed and report PARTIAL, not PASS.

## Evidence record

Log the DEV SHA/image, exact dates/timezones, role valid-until, worker and DBA receipt fingerprints (public digests only), canonical Nginx backup hash, public negative status and MIME type, and Owner-visible positive receipt fields **without token**. A receipt alone never authorizes Task190 execution, signing, dispatch, or ACK.

## Current known status (26 Nov 2026, ~01:40 WIB)

- Previous authorized role lease ended **01:30:53 WIB** and DBA receipt ended **01:34:06 WIB**.
- Latest worker attestation previously checked as valid until **02:13:42 WIB**, subject to fresh verification when a window begins.
- No positive authenticated HTTP 200 read yet. Nginx remains fail-closed 503.
- This document does not authorize a new lease, execute changes, or certify E2E PASS.
