# GPT02 CST-DEV — independent close-only fallback (source candidate)

**Status: DRAFT / UNMERGED / NOT INSTALLED / NOT ARMED.** This code is for review and isolated tests only. It does not authorize an actual Owner Ledger HTTP404 test.

## Why a second recovery path

The existing, approved GPT02 boot/restore guards from PR #1851 already enforce a closed `HTTP503` gate. The separate bounded primary guard timer is designed to close the Owner Ledger at **no later than 90 seconds**, if correctly armed and functioning. However, it is a transient systemd timer; it cannot be treated as reboot-persistent. The active, root-owned Nginx vhost is:

`/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id` — SHA256 `496dac900c7228ddbebeb06151d17693de5bcf744fc8a0426d5eb3739dbcab3f` during the safe baseline check.

**Important real-host discrepancy:** `/etc/nginx/sites-available/dev-ai-task.cstlogistic.co.id` was a *different* regular file on the observed VPS, SHA256 `6d604cfaeea8a17f0c0a91de14feae5efe6248ce939cc761999f99ac603c9ca4`. The existing restore guard defaults to `sites-available` unless `--active` is explicitly supplied. An operator who relies on that default could restore **the wrong file**. This candidate therefore passes **both `--active /etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id` and `--backup /etc/nginx/dev-ai-task.gpt02-1782-guard-backup.conf`** to the existing root guard, every time.

## Scope and fail-closed behavior

The new script `scripts/vps/gpt02_1782_close_only_fallback.py` reuses the installed restore guard at `/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py`, whose root:root `0700` file and SHA256 `e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448` are verified before loading its pure canonical Nginx checker and exact open→closed converter.

It has exactly two modes:

- `--check` (default **not** implicit): read only, always exit 2. It verifies trusted root files and whether the canonical active Nginx vhost is closed with no backup, closed with a matching backup, or *exactly* restorable when an approved backup exists. It does **not** run `curl`, restore Nginx, or invoke systemd.
- `--close-only`: available only to root with a separate systemd `INVOCATION_ID` and explicit `GPT02_CLOSE_ONLY_RECOVERY_ENABLED=true`. It can **only call the installed `--restore` guard**, using the full fixed `--active` and `--backup` paths. If the Nginx file is already canonical closed and there is **no** backup, it makes **no changes**. On either path it must verify the final file is canonical closed and the effective local TLS response is **HTTP503 JSON** with `Cache-Control: no-store`. Incomplete or untrusted backup, unexpected edits, wrong file owner/mode, changed guard SHA, failed guard reload, invalid HTTPS result, or missing invocation policy all BLOCK.
  
The fallback **cannot** open Nginx, create or extend PostgreSQL reader leases, read Owner business rows, mint credentials, sign, dispatch, stop/restart or resume a shared DEV deployment watcher, or claim a real Owner-ledger negative HTTP404 E2E. Its signed proof and database validity are outside scope.

The candidate includes `gpt02-1782-close-only-fallback.service` and `.timer` as dormant source examples under `deploy/ai-coding-standalone-dev/`. **Neither file has an `[Install]` section.** If a later Owner separately authorizes installation, a systemd operator must explicitly stage and start them in addition to the original primary rollback timer **before** an approved live window. The fallback timer is **secondary at 110 seconds**. It must **never** be mistaken for the required ≤90-second maximum opening timer. An untrustworthy or failed primary rollback can expose a window past its authorized limit, so **do not open the gate merely because fallback code exists**. A successful CI test proves only source behavior, not armed systemd reliability.

## Open risks requiring separate review

1. A fallback cannot reconstruct a missing trusted backup when the active Nginx site is open. It fails and requires independent recovery; it never accepts arbitrary edits.
2. The existing root restore guard leaves the protected backup for later audit. This source **does not delete backups or cancel timers**.
3. The source does not verify PostgreSQL reader expiry or session count. The independent DB check must still prove expired dedicated reader and **0 sessions** before any watcher resume. Until then, the watcher must remain paused if an authorized operator paused it.
4. Its systemd timer is transient and not reboot-persistent; the already-installed Nginx boot precheck remains a distinct barrier. A design claiming guaranteed crash/reboot recovery requires more than this candidate.
5. The independent systemd close-only operation could overlap with the original restore if armed without coordination; test the race and systemd ordering before any live use.
6. An existing Core DEV watcher/release may restart the upstream; coordinate a verified freeze and eventual safe resumption. The source-only flock review in [PR #1853](https://github.com/Travelintrips/Core-AI-Foundation/pull/1853) does not replace a deploy freeze.

## Acceptance gates for future live Owner test

A separately approved one-use CST-DEV authorization must name the Owner foreign-challenge negative E2E, a fresh signed Owner session ready at the browser, a genuine native reader+DBA proof with a ≤7 minute reader lease if reauthorized, a reviewed freeze of shared deployments, the existing independent **≤90-second primary rollback**, the close-only fallback if separately approved/installed and race-tested, verified HTTP404 JSON/no-store and guaranteed return to HTTP503, reader expired/zero sessions, and restoration of the deployment timer only after these conditions. **Task190, RLS, Phase B, signing, dispatch and PROD remain out of scope.**

Proof tracker: [Issue #1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850). Existing merged [PR #1851](https://github.com/Travelintrips/Core-AI-Foundation/pull/1851) is authoritative for root boot/restore guard behavior.
