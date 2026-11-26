# GPT02 CST-DEV — Full-vhost Nginx boot guard with four verified upstream allowances

**REVIEW ONLY / NOT MERGED / NOT HOST INSTALLED.** This candidate preserves the original SHA-256 integrity check of the **entire shared Nginx vhost**. It does not replace the protection with an Owner-Ledger-only check. It permits precisely four previously verified, unrelated, already-controlled upstream substitutions, and no other byte change.

## Verified current-state evidence

Original approved closed vhost `/root/ai-task-dev-nginx-cutover-q0xs12ak/dev-ai-task.conf` has SHA256 **`e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed`**. Later cutovers on the shared AI Task DEV VPS produced exactly four single-line replacements, independently compared using `difflib`:

| Existing location block (unique marker) | Originally pinned | Verified cutover |
| --- | --- | --- |
| `location / {` | `proxy_pass http://127.0.0.1:18501;` | `proxy_pass http://127.0.0.1:18181;` |
| `location = /api/bridge/admin/jobs {` | `proxy_pass http://127.0.0.1:18296;` | `proxy_pass http://127.0.0.1:18181;` |
| `location = /api/bridge/admin/sessions {` | `proxy_pass http://127.0.0.1:18296;` | `proxy_pass http://127.0.0.1:18181;` |
| `location ^~ /api/bridge/admin/jobs/ {` | `proxy_pass http://127.0.0.1:18296;` | `proxy_pass http://127.0.0.1:18181;` |

The active vhost after both cutovers has SHA256 **`496dac900c7228ddbebeb06151d17693de5bcf744fc8a0426d5eb3739dbcab3f`**, the same byte length as the approved original, and the same exact GPT02 Owner Ledger location. The first cutover was logged at `2026-11-26T17:05:43Z`; the second at `17:51:29Z`, with GET401/POST403 checks on the bridge routes and GPT02 HTTP503 unaffected.

The installed prior boot precheck `/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py` currently expects the intermediate whole-file SHA `ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d`; therefore the still-active Nginx service reports `BLOCK_CLOSED_BASELINE_DRIFT` on the updated configuration. The gate itself remains HTTP503, but **do not restart Nginx** until the approved boot-start boundary is fixed.

## Candidate logic and why it preserves full-file integrity

`scripts/vps/gpt02_1782_failclosed_boot_precheck.py` now:

1. Reads the current regular active vhost and checks there is exactly one closed GPT02 Owner Ledger GET gate, exactly one Owner route declaration, and at least one dedicated `proxy_pass 18082`. Unexpected gate opening is blocked.
2. For each **of four fixed, unique location markers**, examines only that location's block and allows exactly one `proxy_pass`: either the old upstream or its one previously verified new upstream. All other directives inside these four blocks must be unchanged.
3. For comparison only, converts any approved new upstream back to the original *literal* upstream and computes SHA256 of the **entire canonicalized vhost**, requiring exact match to the original approved `e34dde83...` SHA. An unknown fifth route, server-level directive, duplicate location, method change, new Nginx `error_page`, header/authorization change, changed GPT02 block, new port or any other byte change fails the full-file hash.
4. **Paired restore-guard source** `scripts/vps/gpt02_owner_ledger_nginx_restore_guard.py` now imports the exact same `canonical_closed` function from the proposed boot precheck. For an armed test, it requires a root-owned `0600` backup of a canonical fully closed vhost. If an OPEN current vhost differs from the backup only by the exact GPT02 gate→comment substitution **and any subset of the four preverified proxy substitutions**, it restores the gate by changing the comment back to HTTP503 in the **current** file. Approved upstream cutovers are preserved instead of reverted. If any other byte changed, the guard REFUSES to overwrite it. An already-closed canonical vhost does not trigger a reload.

The protection is still whole-file integrity **with only four explicitly enumerated upstream differences**. This changes the prior total immutability of the four specified proxy values but does not remove protection of other Nginx routes. Unlike earlier Owner-block-only draft code, this candidate does **not** permit arbitrary unrelated edits.

## Rollback dependency and residual concurrency risk

The new rollback guard **depends on the newly reviewed boot module providing `canonical_closed`**. They must be installed together under an authorized, pinned-SHA, root-only handoff, before any test. In the real VPS, systemd calls `/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py` (**hyphen name**) and the restore timer calls `/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py`. The GitHub source helper is named `gpt02_1782_failclosed_boot_precheck.py` (**underscores**) and is **not installed** under that name. The candidate therefore loads the existing *hyphen-named* root boot path directly, checks `root:root`, mode `0700`, regular file, no symlink, fixed SHA256 **`26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32`**, and only then compiles those exact read bytes. No additional boot module copy is needed. Any mismatch blocks at import time, without calling Nginx or the database.

The paired **proposed** root script SHA256 values are: boot `26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32`; restore `e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448` (both verified from GitHub source bytes on the VPS). Installed **old** script SHA256 values remain boot `0c7a67958476235ab7ae27d359b9aa1e38bf3638e30162bd23e1502b9f6e3fd5` and restore `29730033a3844c3d519d09975f15d855898b158c6453a91adc1356b813ad6d4a`. A read-only simulation using the candidate restore source and real root file path returned `ROOT_RESTORE_WITH_OLD_BOOT=BLOCKED` / `BOOT_MODULE_SHA_NOT_APPROVED` as required. Do **not** deploy the restore candidate alone; an old installed boot script cannot satisfy the new hash pin. The historic v9 one-shot recovery has its own old SHA restrictions and cannot be used as the new executable, even after these two source changes.

After a successful file restoration or when the file is already closed, the rollback guard **runs Nginx syntax validation and reload** to reconcile possibly stale worker state, then uses a local loopback HTTPS GET without credentials to require **HTTP/1.1 503, JSON `GPT02_LEDGER_READER_NOT_PROVISIONED`, and `Cache-Control: no-store`**. If the public check fails, it reports `PUBLIC_GATE_NOT_VERIFIED_503` and does **not** claim rollback PASS. This avoids declaring success from closed file bytes when old Nginx workers might still serve an open route.

The rollback guard also performs a pre-write readback to detect ordinary concurrent edits. It is **not a cross-process filesystem compare-and-swap**, so a race can still occur between the last read and the atomic replacement. Accordingly, **freeze shared Nginx edits throughout any separately approved ≤90-second Owner E2E window**, and require the independently armed timer, verified rollback response HTTP503, exact closed vhost SHA, and expired reader/zero sessions afterward. If an unknown edit causes rollback refusal, consider it an incident and keep E2E NO-GO; never declare success simply because the timer ran.

Dedicated CI executes **11 boot-hook tests and 20 rollback tests** with synthetic data, including all 16 allowlisted proxy combinations, denial of arbitrary changes, refusal to overwrite a non-allowlisted concurrent edit, rejection of false success when active HTTPS is not the exact 503 JSON/no-store contract, and the exact Hostinger hyphen-named boot-path/byte-SHA loader contract. No real Nginx or host credentials are used.

## Test and operational acceptance

CI must PASS on an isolated runner with synthetic fixtures; check **all 16 combinations** of the four approved upstream choices for both startup and bounded restore, while any other modification is denied, including a server-level return 200 or `error_page 503`, duplicate Owner route, altered method, unknown port, two proxy directives in one block, unsafe backup, and any non-allowlisted edit after arming. No real data, secrets, PostgreSQL login, service restart or Nginx reload is needed for CI.

Even after CI PASS and a read-only in-memory check against the actual current Nginx bytes, **do not merge, install or restart** based only on a generic `lanjut`. Installing this revised integrity contract must be expressly authorized by the Owner and performed as a strict atomic root-only script replacement with pinned prior/new source SHA256, rollback copy, no Nginx restart/reload, and a direct `GPT02_BOOT_GATE=PASS_GATE_CLOSED` postcheck.

This is **independent of the expired v9 one-use Owner approval**, the dedicated reader lease, signed DBA custody, and the actual Owner Ledger foreign-challenge HTTP404 negative E2E. No Task190, Phase B, RLS, signing, dispatch or PROD changes are allowed.

Tracking: [GPT02 Owner Ledger E2E #1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850), [fresh public-readiness draft #1849](https://github.com/Travelintrips/Core-AI-Foundation/pull/1849), [former boot-pin source #1848](https://github.com/Travelintrips/Core-AI-Foundation/pull/1848).
