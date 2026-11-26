# GPT02 CST-DEV — Scoped Nginx Owner Ledger boot guard (review-only)

## Why another source candidate is necessary

On 26 Nov 2026 17:05:43 UTC, an independently controlled AI Task DEV release changed the shared Nginx default upstream `18501 → 18181`, while GPT02 Owner Ledger remained HTTP503. The first boot guard pinned a full-vhost SHA, requiring a one-off Owner-approved re-pin (merged PR #1848, installed SHA `0c7a679...`).

On **26 Nov 2026 17:51:29 UTC**, a second legitimate AI Task DEV bridge cutover changed exactly **three unrelated read-only admin routes** `18296 → 18181`. Journal evidence says `BRIDGE_READ_ONLY_ROUTE_CUTOVER_PASS` with authenticated GET 401, denied POST 403, preserved GPT02 Owner Ledger 503. Current vhost SHA changed from `ff4a9c5c... → 496dac900c7228ddbebeb06151d17693de5bcf744fc8a0426d5eb3739dbcab3f`, so the installed old whole-file guard returned `BLOCK_CLOSED_BASELINE_DRIFT` even though GPT02 remained closed.

A byte-level comparison of the **full 1,015-byte GPT02 Owner Ledger location block** before and after the second cutover proved the block was **exactly identical**, with SHA256 **`cdbd857bddb84579257182e746281f7e5f12eb1052bab1df64cc101e01a16319`**. Two `server_name dev-ai-task.cstlogistic.co.id;` directives were unchanged.

## Proposed change — trade-off made explicit

In the **existing** `scripts/vps/gpt02_1782_failclosed_boot_precheck.py`, replace whole-file pinning with a **byte-exact, closed-GPT02-location-only pin**:

- Require exactly one `location ^~ /api/gpt02-owner-ledger/ {`, exactly one mention of that URI (to reject additional exact/prefix route overrides), exactly one closed HTTP503 gate, no rollback-arming comment, exactly two current server-name directives and one known delimiter marking the adjacent Owner approval block.
- Require the protected block to have exactly **1,015 bytes**, exact SHA256 **`cdbd857b...`**, one dedicated `proxy_pass http://127.0.0.1:18082;` and the original byte-for-byte GET-only, `no-store`, auth forwarding and other controls.
- Retain a hard **FAIL-CLOSED** on any unknown mutation within the protected block, extra Owner Ledger routing, missing block, symlink or invalid backup.
- Preserve the existing exact, byte-for-byte gate→comment rollback rule: only restore the immediate armed backup if the **entire current vhost** equals that backup with precisely the one approved line substituted. Any intervening unrelated deployment during a 90-second open window causes refusal to overwrite and requires the independent rollback/incident process.

**Security trade-off:** Other sections of the shared AI Task DEV vhost are no longer authenticated by this GPT02-specific boot precheck. The Nginx built-in syntax check, independent route owners, and their existing release checks remain responsible for those other sections. This is an intentional *narrowing* of the GPT02 guard's integrity boundary, not a byte-for-byte equivalent to whole-file SHA pinning. **Explicit Owner authorization is required before replacing the live guard.** Do not interpret the source code PR or a generic `lanjut` as permission to change this security boundary.

The alternate draft pooler PR #1847 remains unnecessary while direct PostgreSQL TLS/CA works; do not merge it for this issue.

## Offline acceptance and operational gate

Test via isolated synthetic fixture: known closed GPT02 location PASS, unrelated default and bridge upstream changes PASS, missing/duplicate exact location or altering any protected byte BLOCK, invalid backup BLOCK, authorized rollback restores exact backup, any extra change after arming BLOCK, symlinks BLOCK. Run `nginx -t` and validate actual route semantics in the authorized host handoff; **do not restart Nginx during source testing**.

Before any future live host installation: explicit Owner decision for the changed integrity boundary; approved PR + all CI PASS; fresh read-only host checks of exact protected block SHA, no duplicate routes, exact logged cutover diffs, HTTP503, boot guard original SHA, trusted rollback backup. Install only the approved script atomically with fsync/rollback, then execute it in read-only preflight mode; **no Nginx reload/restart or gate opening**. Separate genuine signed Owner negative E2E requires its own new one-use approval, fresh attestation and DBA reader lease; no v9 replay, no PROD, Task190, Phase B, RLS, signing or dispatch.

Tracks [Owner Ledger E2E #1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850); [merged boot-pin source PR #1848](https://github.com/Travelintrips/Core-AI-Foundation/pull/1848).
