# GPT02-1782 CST-DEV — exact one-line Nginx gate reversibility (v10 source-only)

**Status: SOURCE-ONLY / ONE-LINE SIMULATION / E2E NO-GO.**

This is a non-executable precursor to a separately approved, reviewed live operator; it is **not** permission to open an Owner Ledger endpoint. The existing boot and restore guards **must remain installed unchanged**.

## Evidence and source of truth

The installed root boot precheck `/usr/local/sbin/gpt02-1782-failclosed-boot-precheck.py` pins canonical full-vhost integrity. The installed rollback guard `/usr/local/sbin/gpt02_owner_ledger_nginx_restore_guard.py` is SHA256 `e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448`. This review opens only that PINNED guard **in memory**, under a non-main module name, after verifying the root:root 0700 file, no symlink or hardlink, exact SHA and stable before/after descriptor metadata. The guard itself loads the pinned boot source. Neither command-line entry point runs.

A real read-only host review of the current active Nginx vhost `/etc/nginx/sites-enabled/dev-ai-task.cstlogistic.co.id` must prove:

1. The original **entire** closed vhost is accepted by the installed `canonical_closed` rule with only the four previously approved unrelated upstream changes.
2. Exactly **one** `return 503 '{"error":"GPT02_LEDGER_READER_NOT_PROVISIONED"}';` exists in the dedicated Owner Ledger location, and **zero** temporary open comments exist.
3. Transform in memory: replace that exact gate with `# GPT02-1782 bounded Owner GET test: automatic rollback armed` exactly once, without changing any other bytes.
4. Pass those opened bytes into the **existing** guard's `permitted_open_to_closed` function. It must return the **exact original bytes**, including the unrelated upstream changes. Any unexpected edit, duplicated gate, opened baseline, invalid guard or byte mismatch means BLOCKED.
5. Output only public hashes and boolean pass/fail markers, never the Nginx source, signed browser tokens, JWTs, SQL credentials, private keys or Owner Ledger records.

## Mandatory shared DEV release status, reuse existing v10 checker

The gate-byte simulation now also imports the **already merged PR #1852** inert `gpt02_1782_negative_window_v10_readonly` policy at runtime. Instead of copying or relaxing any readiness checks, it invokes that module's existing `public_inspect`, `read_unit_state`, `root_guard_verified` and `evaluate`. In addition to exact-byte reversibility, a usable report must include:

- `dev_ci_watcher_paused_snapshot` and `dev_ci_watcher_service_idle_snapshot`, requiring the timer **inactive** and service **inactive**. Any active, activating, failed or unknown service state means NO-GO.
- `public_custody_current_snapshot` and `rollback_timer_idle_snapshot`, disallowing stale/mismatched DBA proof, missing Nginx integrity, or a prior armed rollback.
- `v10_unresolved`, with only bounded static uppercase blocker codes. The report **rejects any forged `ready_to_arm=true`, `live_e2e_ready=true` or action other than `RETAIN_NGINX_503`**.

Even if all those observations pass, a point-in-time `systemctl show` snapshot **does not reserve or freeze** a future 90-second deployment window; a future separately approved operator must still stop the watcher, obtain the existing release lock and arrange independent recovery before it opens anything. This diagnostic NEVER does those operations. It always emits `ready_to_open=false`, `live_e2e_ready=false` and exits 2.

Command for a future separately authorized operator reviewer (after candidate source is reviewed/approved and installed, but **not** as part of this PR):

```bash
/usr/bin/python3 /usr/local/sbin/gpt02_1782_exact_gate_reversibility_readonly.py --check
```

The checker **always exits 2**, even when `byte_reversibility=PASS`, with `ready_to_open=false`, `live_e2e_ready=false`, `action=RETAIN_NGINX_503`. There is **no `--execute` mode**, no root vhost write, no `nginx -t` or reload, no systemd operation and no database role operation. This PR is kept draft to avoid a normal Core DEV deployment triggered by changes under `scripts/vps/` in the existing CI watcher. The already merged v10 module must be available in the reviewer environment; if not, its absence is BLOCKED, not substituted with a weaker check.

## Separate future high-risk steps NOT implemented here

- An **explicit fresh one-use Owner authorization** for one named CST-DEV negative challenge HTTP404 test and a genuinely fresh signed Owner browser session at the time of the test, with Owner ready to click once.
- A current dedicated reader lease bounded independently to at most seven minutes if authorized, and a newly issued independent DBA receipt bound to a valid worker attestation. The old one-shot v9 approval and expired reader lease cannot be reused.
- A coordinated freeze of the **shared DEV CI watcher and any Nginx editors**. The watcher currently uses `/run/lock/cst-vps-dev-release.lock`; merely seeing its timer idle is not enough. Verify no active release and prevent restarts during the test. If any process dies, an independent recovery plan must preserve rollback and ensure the watcher eventually resumes only after public HTTP503 is proven.
- Independently arm and verify existing `gpt02-1782-owner-ledger-restore.timer` for **at most 90 seconds** BEFORE any permitted single-line gate change. Never run stale `one-shot-window-v9-staged-safe-v2.py --execute`; it pins an older full-vhost SHA and currently fails `BASELINE_NOT_EXACT`.
- Genuine signed Owner browser HTTP404 JSON with Cache-Control no-store on a foreign challenge (a fabricated curl 404 is not acceptable), followed by fail-closed HTTP503 and exact canonical bytes, role expired, 0 reader sessions and a restored deployment watcher.

The existing root guard's `--restore` leaves the protected window backup behind, so a later authorized operator must independently verify the closed vhost and active HTTP503 **before** any explicit backup cleanup. It must not erase an unknown backup to force a future attempt. The transient systemd rollback timer is not reboot-persistent; the startup boot guard is separate from reload protection.

**No PROD, Task190, Phase B, RLS, signer, dispatch, credential rotation, systemd toggle, Nginx reload or database mutation.** Track actual Owner Ledger negative E2E at [#1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850). Prior source: merged [#1851](https://github.com/Travelintrips/Core-AI-Foundation/pull/1851) and merged [#1852](https://github.com/Travelintrips/Core-AI-Foundation/pull/1852).
