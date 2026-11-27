# GPT02 CST-DEV — v10 Owner Ledger negative window: inert safety preflight

**STATUS: SOURCE-ONLY / NO EXECUTOR / NO MERGE-TO-HOST INSTALL / E2E NO-GO.**

Scope: `Travelintrips/Core-AI-Foundation`, CST-DEV project `xssrfshdrtdfupgqwfdw`, VPS `srv1792369`, the already present Nginx `location ^~ /api/gpt02-owner-ledger/`. This work does not authorize a new live window or user action.

## Why v9 cannot be replayed

The installed shared Nginx vhost SHA256 is `496dac900c7228ddbebeb06151d17693de5bcf744fc8a0426d5eb3739dbcab3f`, not the original v9-pinned `e34dde83f676dec15d27b56241b830cbffe7cb3ba0b07e6699f011d48fb651ed`. The historical `/root/gpt02-1782-recovery/one-shot-window-v9-staged-safe-v2.py --check` **already returns** `BASELINE_NOT_EXACT` / exit 2, proving the old v9 executor is inappropriate. NEVER run its `--execute` option or alter its pinned digest to make it pass.

The Owner-authorized, installed PR #1851 boot and rollback guards now check the entire shared Nginx config with the *four precisely preverified unrelated upstream changes*; they do not authorize opening it. Boot source SHA256 `26ea880f87b4eed5dea9cda0bd907b03711262abe470cde65b6c2e8e4b4b0e32`, root restore guard SHA256 `e8e874d3d05de88f405d7584ede63a51539ad1e986aed2a2c620773ea2e92448`.

## Additional operational hazard: shared DEV deployments

`cst-vps-dev-ci-watcher.timer` is active on VPS; its systemd timer schedules `cst-vps-dev-ci-watcher.service` with `OnUnitInactiveSec=3min` and up to 30s randomized delay. It gates `develop` CI and calls `/usr/local/sbin/cst-vps-dev-release.py`, which can build and replace the running `core-ai-dev` container behind `127.0.0.1:18082`. It can therefore interrupt an Owner's real HTTP404 test even without editing the Nginx vhost file.

The release script holds `/run/lock/cst-vps-dev-release.lock`. A separate explicitly authorized shared-DEV freeze must ensure BOTH the timer is inactive and no deployment service/process is active, coordinated with other Nginx deployers, for the entire future bounded test. A follow-up verification must restore and confirm watcher scheduling; never leave the system permanently disabled. **This PR does not stop or start any timer, and does not modify this watcher or release code.**

## What the v10 inert script checks

`scripts/vps/gpt02_1782_negative_window_v10_readonly.py` uses the previously merged public-only Ed25519 proof verifier `gpt02_owner_ledger_fresh_readiness_readonly.inspect` (PR #1849) to check exact signed worker/DBA receipt freshness, signed binding, SHA-pinned boot and full-vhost canonical integrity, unique closed HTTP503 gate, DBA preparation OFF and absence of an active gate backup. It independently pins the installed root restore guard as root:root `0700` and exact SHA256.

It observes only `systemctl show --property=ActiveState --value` for the CI watcher timer, CI watcher service, and GPT02 restore timer. It rejects any unrecognized state, error, or missing proof. **It performs no DB login, no credential inspection, no systemctl change and no Nginx modification.**

The result always contains:

- `ready_to_arm=false`, `live_e2e_ready=false`, `readiness=BLOCKED`, `action=RETAIN_NGINX_503`.
- `live_reader_login_verified=false`, `fresh_one_use_owner_authorization_verified=false`, `signed_owner_browser_freshness_verified=false`, `negative_http404_verified=false`.

These are **non-inferable facts**. A valid previous Google Owner identity display or public Ed25519 proof cannot make a new live Owner session or fresh Owner authorization true.

## Current read-only evidence (27 Nov 2026 ~02:35 WIB)

- New boot precheck: `GPT02_BOOT_GATE=PASS_GATE_CLOSED`.
- Nginx `nginx -t` PASS and Owner Ledger GET **HTTP503**; active master PID 970; no armed GPT02 rollback timer or rollback backup.
- Dedicated reader `gpt02_owner_ledger_reader_1782_dev` valid-until `2026-11-26T19:23:57.649742Z` (already expired), `CONNLIMIT1`, non-super/non-BYPASS, 0 sessions.
- Existing worker attestation expires at `2026-11-26T20:19:30.012Z`; most recent DBA receipt expires at `2026-11-26T19:39:46.535Z`. **These are independently expiring receipts**, not permission to extend reader or open Nginx.
- Core DEV watcher timer active; release service idle in the last read-only observation.
- Owner page `https://dev-ai-task.cstlogistic.co.id/gpt02-owner-approval` displays the **Uji penolakan challenge lain** button but still **BELUM PASS**. A previously verified Google Owner link is not necessarily a fresh signed session at the instant of a future test.

## Preconditions of any future separately authorized E2E

The existing human Owner must approve ONE exact current CST-DEV negative HTTP404 test. Before any opening, review the v10 operator source and pin current host SHA, confirm the signed Owner browser is ready and can click once, the dedicated reader's current short lease and independent DBA receipt are valid together, and every unattended DEV deployer is temporarily frozen. Arm and verify the independent root systemd **≤90-second rollback timer before the exact one-line gate change**. Confirm no-bearer GET denied and a real Owner-signed foreign-challenge HTTP404 JSON/no-store (not a fake curl HTTP404). Then **always** verify Nginx re-closed to HTTP503, exact approved canonical vhost, reader role expired and 0 sessions, and watcher re-enabled. On unexpected outcome, fail closed and declare E2E NO-GO.

Do not affect Task190, Phase B, RLS, password custody, signing, dispatch or PROD. A generic `lanjut` is not authorization for the high-stakes step.

Related tracking: [#1850](https://github.com/Travelintrips/Core-AI-Foundation/issues/1850) and prior [PR #1851](https://github.com/Travelintrips/Core-AI-Foundation/pull/1851), [PR #1849](https://github.com/Travelintrips/Core-AI-Foundation/pull/1849).

### PR #1855 compatibility update (27 November 2026)

The historical restore digest above refers to PR #1851. At that checkpoint, the installed close-only restore guard was PR #1855, verified SHA256 `64d22f49263fe44e80809b3ba61f4020bc8bd84509723e957065cb1fccabcf13`, with a 30-second timer, explicit 1-second accuracy and zero random delay. The audit and CI use the new exact digest; the previous guard is not accepted. This is source-only compatibility, not live Owner authorization. Keep the HTTP503 gate closed, no reader lease, timer arming or deployment changes. Historical evidence remains unchanged.

### PR #1858 installed compatibility update (27 November 2026)

The Owner authorized and the VPS transaction installed the exact reviewed PR #1858 source, SHA256 `3851912fcb62423b3f54630e901b6ffda8824009f8e4460a0fdb1ecbf5b486e9`. At that checkpoint it was merged to `develop` at `d0b0e1c31971e1039ca84e087aede097017d2a5a`. The fallback service and timer are static and inactive; no active timer, gate opening, reader renewal or deployment freeze was authorized. The earlier #1855 evidence is historical; current source-only audits must reject the previous digest. The 87-second calculation is a model only, not live closeout evidence. Keep HTTP503 and NO-GO for any actual Owner Ledger window. This source-only synchronization neither authorizes nor executes a live test.

### PR #1859 installed compatibility update (27 November 2026)

The Owner-authorized PR #1859 guard installation has passed, and the exact reviewed source is merged at `882daefcb8cb0aa8dd435db12e04fcd7b4740d63`. Current boot SHA256 `bff267b4cc76cca990f0cc03af30b3fa76604ce4e97e3340726ffce20e1c0bf4`, restore SHA256 `d9756ebc6eabac279cdd1459e7da7b1b66465442f120d1914da0bda8fede1ee4`, closed active vhost SHA256 `1d8b8fd3492845c6fd0586d0fc43ff9fb366f5f62772eb4d968c84e0c3b31846` (49,527 bytes). The exact two approved PR252 frontend snapshots retain the byte-identical Owner Ledger block. Source-only diagnostics must match the installed current guard, not the historical #1858 digest. Boot PASS_GATE_CLOSED and HTTP503; fallback static/inactive. No restart, reload, opening, timer, reader renewal, custody publication or Owner E2E authorized by this update. Prior evidence remains historical.
