# GPT02-1782 — verified Nginx fail-closed boot baseline re-pin (CST-DEV)

**SOURCE-ONLY / NO LIVE MUTATION.** This document covers the shared Nginx startup guard after the AI Task DEV default-upstream cutover. It does not authorize an Owner-ledger GET window, new PostgreSQL reader lease, DBA receipt, signing, dispatch or any PROD/Task190 action.

## Observed facts and cryptographic comparison

- Existing root-owned boot script: `/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py`, SHA256 `7b83dbaf7adf114a2d72f932ff6eec2cfd24965f2b38880f29c0f2a09819ac46`, pinned Nginx baseline `e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed`.
- On **26 Nov 2026 at 17:05:43 UTC** another DEV cutover changed **exactly one upstream directive** in active Nginx vhost `/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id`:
  - `location / { proxy_pass http://127.0.0.1:18501;`
  - becomes `location / { proxy_pass http://127.0.0.1:18181;`
- Byte comparison between protected backup `/root/ai-task-dev-nginx-cutover-q0xs12ak/dev-ai-task.conf` and active vhost returned `EXACT_ONE_LINE_DEFAULT_UPSTREAM_CHANGE=True`, backup sha `e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed`, active sha `ff4a9c5c3a6399898b90c8990647c9430aee5251c84eb3fe38db92ddf0621d6d`.
- Both vhosts have exactly one closed `return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';` and exactly one `location ^~ /api/gpt02-owner-ledger/`; observed public GET is HTTP 503; `nginx -t` PASS.
- **Only the expected closed SHA** changes in the proposed replacement `scripts/vps/gpt02_1782_failclosed_boot_precheck.py`. The full exact SHA256 of this pin-only proposed script, derived in memory from the installed bytes, is `0c7a67958476235ab7ae27d359b9aa1e38bf3638e30162bd23e1502b9f6e3fd5`. The new script retains fail-closed denial of unknown config, only restores an exact gate→comment substitution from a trusted backup, and opens no network or database.
- Until authorized replacement, an `nginx.service` **restart/start** is expected to be blocked by the old boot hook's `BLOCK_CLOSED_BASELINE_DRIFT`. The currently running Nginx service has not been interrupted.

## Owner-authorized operations handoff

Do not use a generic deploy action or silently re-pin. An authorized root Hostinger operator with **new, explicit, exact-scope Owner approval for GPT02-1782 CST-DEV shared Nginx boot-pin correction** should:

1. Check current Nginx is still active/HTTP503, `nginx -t` valid, and live vhost SHA **exactly `ff4a9c...`**; check the old root-owned script SHA **exactly `7b83db...`**. Recheck the protected cutover backup `e34dde83...` and one-and-only single upstream substitution. If any value changed, STOP rather than repinning.
2. Verify the proposed GitHub source bytes have candidate SHA **exactly `0c7a679...`** and all offline tests PASS. Stage the replacement as a root-owned regular file mode `0700` in the same directory, never via a symlink, and maintain a sealed rollback copy of the **exact** original script SHA `7b83db...`. Perform a single atomic `os.replace` with fsync. This alters only the pre-start hook, **not** the live Nginx configuration or service.
3. Execute the *new* pre-start script **directly as a read-only check**, requiring `GPT02_BOOT_GATE=PASS_GATE_CLOSED`; verify `nginx -t`, one closed GPT02 gate, HTTP503, script new hash, no unexpected backup/timer. Do not restart/reload Nginx to test the hook. Keep exact hashes, output and time in the Issue #1782 audit trail.
4. On failure, restore the original script byte-for-byte via the authorized rollback procedure without restarting Nginx; explicitly mark startup **NO-GO** until repaired. Never remove the installed systemd drop-in or bypass a failed gate.
5. **Separate future work:** Old recovery and staged one-shot scripts still pin `e34dde83...`; they are **not ready** for another live Owner E2E window. Prepare and test a fresh, explicit-scope handoff against the new protected baseline only after new Owner one-shot authorization, fresh attestation and bounded reader/DBA prerequisites. No reuse of v9 proof.

Do **not** restore the old active vhost just to match its boot pin; doing so would undo a separately verified AI Task DEV upstream cutover. Do not replace the gate with a comment or allow plain unauthenticated GET as a shortcut.

## Verification

`python3 -B -m unittest discover -s scripts/vps -p test_gpt02_1782_failclosed_boot_precheck.py -v`

Expected behavior in disposable fixtures: exact trusted closed hash PASS; old baseline or unrelated change blocked; opened gate without backup blocked; invalid backup blocked; correct one-line gate opening restores exact closed bytes; symlink and mixed changes blocked.

Related: [GPT02 Issue #1782](https://github.com/Travelintrips/Core-AI-Foundation/issues/1782), [reader connectivity PR #1847](https://github.com/Travelintrips/Core-AI-Foundation/pull/1847).
