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

## Recovery if the future operator or browser disconnects — pure contract, NOT installed

The proposed reviewer now contains `assess_watcher_recovery_contract`, a **pure evidence predicate** with 8 additional offline regressions. It does **not** modify the watcher, schedule a recovery timer, reload Nginx, extend PostgreSQL, or supply a live attestation. A future independently authorized recovery operator must collect the following facts directly from the host before it can consider restarting a previously running CI watcher:

- The exact approved **closed** Nginx vhost was restored byte-for-byte and no unrelated directive changed.
- `nginx -t` succeeded and **the live loopback HTTPS endpoint** returned the exact HTTP503 JSON with `Cache-Control: no-store`, not just a closed file on disk.
- The independent gate rollback timer is inactive and its protected backup was cleaned only **after** the previous two facts were checked.
- The dedicated reader role is expired and an authoritative database query shows **exactly zero sessions**.
- The release service has finished and is idle, the watcher timer is currently inactive, and it was active before the test so that its earlier operating state can be restored deliberately.

For any missing, false, malformed, or merely truthy value the review returns **BLOCKED**, and even when all facts are supplied it returns only `recovery_review=CANDIDATE_ONLY`, `action=NO_HOST_OPERATION`, `watcher_resumed=false`. This closes a dangerous assumption: an automatic watcher resume after 90 seconds must **not** occur merely because the rollback timer elapsed. The independently supervised time-bounded recovery service, crash handling, and future systemd integration are still **unimplemented** and must be developed/reviewed before a real window can be called safe. Do not claim the source-only policy guarantees recovery if the operator process crashes.

## Existing Core DEV release lock — additional independent collision barrier (source-only)

Rather than create a new deploy lock, the existing `/usr/local/sbin/cst-vps-dev-release.py` already uses `fcntl.flock(LOCK_EX | LOCK_NB)` on `/run/lock/cst-vps-dev-release.lock` before proceeding with the release. The verified current root release-script SHA256 is `ad0063421453184a7d3a66d1dffd2de3b7e74dced081e232315425e9aff1c2c8`; its watcher script SHA256 is `5126bfd118e8352e979b5ab5c6929d8bf290dc6ef2e51c5076109d5f6f1b3dea`. The existing lock file was root:root, mode `0600`, regular, empty. Both code hashes **must be rechecked** if the installed watcher/release changes.

The new **source-only** `scripts/vps/gpt02_1782_release_lock_contract.py` validates those exact installed scripts without running/importing them; verifies a pre-existing root-owned/single-inode lock; and exposes a minimal **uninvoked** `acquire_existing_lock` building block for a future *authorized and independently supervised* operator. Offline tests prove its nonblocking exclusive lock prevents a **separate OS process** from taking the same release lock and is relinquished by close. Unknown source hash, changed lock inode, symlink, hardlink, owner/mode, nonempty file and contention fail closed.

**Important qualification:** This lock is only an **additional serialization barrier**, NOT a complete replacement for a coordinated pause of the timer. If the timer fires while another process holds the lock, the existing deploy service can exit with a lock error and mark its job failed. Other Nginx editors may not use this lock. A supervisor dying releases its Linux file lock immediately; a crash-safe independent recovery service and the already-reviewed 503 guard are still required. In particular, do not use `flock sleep 90` as proof that the watcher safely resumed or Owner HTTP404 E2E passed. There is **no** `--hold` / `--execute` CLI, no installed supervisor and no live lock acquisition in this PR.

## Separate future high-risk steps NOT implemented here

- An **explicit fresh one-use Owner authorization** for one named CST-DEV negative challenge HTTP404 test and a genuinely fresh signed Owner browser session at the time of the test, with Owner ready to click once.
- A current dedicated reader lease bounded independently to at most seven minutes if authorized, and a newly issued independent DBA receipt bound to a valid worker attestation. The old one-shot v9 approval and expired reader lease cannot be reused.
- A coordinated freeze of the **shared DEV CI watcher and any Nginx editors**. The watcher currently uses `/run/lock/cst-vps-dev-release.lock`; merely seeing its timer idle is not enough. Verify no active release and prevent restarts during the test. If any process dies, an independent recovery plan must preserve rollback and ensure the watcher eventually resumes only after public HTTP503 is proven.
- Independently arm and verify existing `gpt02-1782-owner-ledger-restore.timer` for **at most 90 seconds** BEFORE any permitted single-line gate change. Never run stale `one-shot-window-v9-staged-safe-v2.py --execute`; it pins an older full-vhost SHA and currently fails `BASELINE_NOT_EXACT`.
- Genuine signed Owner browser HTTP404 JSON with Cache-Control no-store on a foreign challenge (a fabricated curl 404 is not acceptable), followed by fail-closed HTTP503 and exact canonical bytes, role expired, 0 reader sessions and a restored deployment watcher.

The existing root guard's `--restore` leaves the protected window backup behind, so a later authorized operator must independently verify the closed vhost and active HTTP503 **before** any explicit backup cleanup. It must not erase an unknown backup to force a future attempt. The transient systemd rollback timer is not reboot-persistent; the startup boot guard is separate from reload protection.

**No PROD, Task190, Phase B, RLS, signer, dispatch, credential rotation, systemd toggle, Nginx reload or database mutation.** Track actual Owner Ledger negative E2E at [#1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850). Prior source: merged [#1851](https://github.com/Travelintrips/Core-AI-Foundation/pull/1851) and merged [#1852](https://github.com/Travelintrips/Core-AI-Foundation/pull/1852).

### PR #1855 compatibility update (27 November 2026)

The historical restore digest above refers to PR #1851. At that checkpoint, the installed close-only restore guard was PR #1855, verified SHA256 `64d22f49263fe44e80809b3ba61f4020bc8bd84509723e957065cb1fccabcf13`, with a 30-second timer, explicit 1-second accuracy and zero random delay. The audit and CI use the new exact digest; the previous guard is not accepted. This is source-only compatibility, not live Owner authorization. Keep the HTTP503 gate closed, no reader lease, timer arming or deployment changes. Historical evidence remains unchanged.

### PR #1858 installed compatibility update (27 November 2026)

The Owner authorized and the VPS transaction installed the exact reviewed PR #1858 source, SHA256 `3851912fcb62423b3f54630e901b6ffda8824009f8e4460a0fdb1ecbf5b486e9`. It is now merged to `develop` at `d0b0e1c31971e1039ca84e087aede097017d2a5a`. The fallback service and timer are static and inactive; no active timer, gate opening, reader renewal or deployment freeze was authorized. The earlier #1855 evidence is historical; current source-only audits must reject the previous digest. The 87-second calculation is a model only, not live closeout evidence. Keep HTTP503 and NO-GO for any actual Owner Ledger window. This source-only synchronization neither authorizes nor executes a live test.
