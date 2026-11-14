# Issue159 DELL Gateway restart / shutdown failure — read-only evidence (14 Nov 2026 WIB)

**Scope:** DEV DELL OpenClaw Gateway operational failure investigation only. Source-side issue #159 / Draft PR #1754; **NO APPLY, NO RESTART, NO AUTH CHANGE, NO DISPATCH, NO PROD**. No service or database state was modified. This is an evidence record, **not** approval to run recovery steps.

## Verified facts

The authorized DELL desktop was accessible for read-only inspection at the time of the commands below. The remote connection became unavailable later, before the stability bundle could be inspected; it is therefore **not** established that the DELL host itself is powered off, or that any running process has since restarted.

- OpenClaw Gateway check target on DELL: `ws://127.0.0.1:18789`. `openclaw gateway status --deep` reported `ECONNREFUSED`; independent `Get-NetTCPConnection -LocalPort 18789 -State Listen` reported **zero** listeners.
- Windows Task Scheduler `OpenClaw Gateway` state was **Ready**, not Running; last Task Scheduler info displayed last result **1** and last run `2026-11-13 17:46:01`. **Separately**, Task Scheduler Operational events **201/102** report an action completion on `2026-11-14 16:33:26` WIB with result decimal `2147942401` (hex `0x80070001`). The start and completion times are now reconciled by the stability-bundle process uptime (see below); the Scheduled Task last-run time is consistent with its **start**, while Events 201/102 are consistent with its **end**.
- The scheduled action points to an existing `gateway.cmd` under a local directory. Non-secret readback confirms its source references the expected `gateway-stable3-main` state, `openclaw.json` and port `18789`, **not** `openclaw-browser-cli-state`; task principal is local `user`, interactive, run level Limited. No secret-bearing lines or command arguments were published.
- The OpenClaw JSONL log `openclaw-2026-11-14.log` contains this local-time sequence (all WIB):
  - `16:32:41.972`: current shared-state lock invalidated / replaced (`no longer current; lock removed/replaced`).
  - `16:32:42.000`–`16:32:42.066`: admission restart-signal fencing; `Delivery recovery failed: AggregateError: Shared-state read and cleanup failed`; restart intent could not be read; `received SIGUSR2; restarting`.
  - `16:32:42.250` onwards: multiple `Agent database resource close failed` warnings; webchat disconnected with restart reason.
  - `16:32:48.925`–`16:32:48.929`: Codex plugin forced retirement after **5000 ms**, **one still-running call**, no retained consumers; resource cleanup pending.
  - `16:32:49.612`–`16:32:49.771`: gateway shutdown failed; prepared model/runtime and plugin generations could not all close cleanly; log reports `Plugin runtime still owns resources` and `Gateway shutdown did not complete cleanly`.
  - `16:32:49.859`: a stability bundle was written; filename observed: `openclaw-stability-2026-11-14T09-32-49-777Z-8532-gateway.restart_close_failed.json`. Later read-only inspection of **nonsecret structured fields only** found reason `gateway.restart_close_failed`, top-level keys `version,generatedAt,reason,process,host,error,evidence,snapshot`, an `AggregateError` with message `Gateway shutdown did not complete cleanly`, shutdown step `gateway-server-close`, **29 nested shutdown error entries**, and **248 diagnostic snapshot events**. Dominant nested error classes: `Prepared plugin resources failed to close` (9), `Plugin inspection resources could not all be disposed` (8), `Plugin runtime still owns resources` (5), and `Prepared plugin generation cleanup failed` (3). These entries can contain nested duplication and are **not 29 independent failures**. No raw stack, token, credential, event payload, or secret-bearing bundle content was exported.
  - `16:32:49.867`: failed to persist gateway boot outcome because shared-state lock had been replaced.
- Earlier the same day, additional CLI `shared-state cleanup timed out` warnings and plugin `codex` data/settings upgrade-unfinished warnings were observed. They indicate context, **not** a proven single root cause or justification for repair.
- **Separate provider-auth blocker:** Correct Gateway-state `gpt02-dev` auth profiles exist but its selected `openai/gpt-5.5` Codex/model route was reported `missing-auth`. Gateway reachability and model-route authentication are independent gates. Do not solve one by pretending the other is fixed.

## Diagnosis and uncertainties

**Supported:** the Gateway entered a `SIGUSR2` restart sequence after shared-state read/lock invalidation and then failed to cleanly close Codex/plugin resources, followed by no port listener. **The stability bundle's reported uptime is 82,010,910 ms (22h 46m 50.910s)**. Subtracting that from its `2026-11-14 16:32:49.777 WIB` generation time estimates process start at `2026-11-13 17:45:58.867 WIB`, within roughly two seconds of Task Scheduler's recorded `2026-11-13 17:46:01` start. This strongly supports one long-running Gateway process ending at ~16:33, rather than a newly launched Task Scheduler run failing immediately.

**Not yet established:** who generated the signal; whether two Gateway processes competed for shared state; whether lock invalidation caused or merely coincided with failed shutdown; whether the stability bundle offers more detail; whether Task Scheduler `0x80070001` fully maps to the Gateway exit cause; whether the remote connection's brief interruption reflects anything about Gateway state. The DELL remote connection was later observed online again; this does **not** prove the local Gateway listener has resumed. In particular, **never delete/rename lock or database files** or force-kill processes as a first repair.

## Follow-up owner-lock and process census (read-only)

A targeted parse of the error path identified the **`openclaw-state-owners` ownership-lock directory** and a `state.<id>.lock` file. The original path was **absent** when checked later; the containing directory existed and held **five other `.lock` files** with last-modified metadata from 21 Oct 2026. Their contents were not read, and their mere existence does **not** prove active ownership or safe staleness. Do **not** remove, recreate, rename, or overwrite any lock as a workaround.

The stability-bundle PID (8532) was **not alive** at follow-up; independent process inventory found **seven** other `node.exe` processes, without evidence from name/command classification that any was the targeted Gateway, and there were still **zero** listeners on port 18789. These other Node processes may belong to unrelated services and must not be terminated as a group. Windows Scheduled Task `OpenClaw Gateway` remained in `Ready` state.

**Interpretation:** this is a lost/replaced **shared-state ownership** problem followed by unsuccessful Codex/plugin resource shutdown; it is not evidence that the GPT02 auth credential file or its SQLite database is corrupt. The source of the ownership-lock change and the source of `SIGUSR2` are still unknown.

## Strictly read-only prerequisites before a separately approved recovery

1. Recover the DELL remote connection; independently check process IDs, Scheduled Task state, port `18789` listener, and the intended Gateway owner/state. No retry loops that write state.
2. Review the stability bundle's **nonsecret diagnostics** locally on DELL; redact all tokens, credentials, user identifiers and paths before attaching summaries.
3. Read-only inventory of active Gateway/Node processes, shared-state owner/generation, Codex plugin lifecycle, outstanding calls and current `gateway.cmd` launch context. Confirm whether shutdown is still in progress or any separate Gateway process is active before considering a restart.
4. Preserve a verified backup/recovery plan for state and credential stores through the platform's supported mechanism. Separately review operational maintenance window, restart safety, and owner authorization. **This document does not grant such authorization.**
5. Only after controlled recovery, verify live Gateway reachability and fresh runtime status. Then separately verify authentic `gpt02-dev` provider principal and `openai/gpt-5.5` route without changing provider or importing credentials by default.
6. Reassess Issue159 fresh owner/PIC/Core Super Admin authorization and one-use fence only once all independent preconditions pass. No replay of old Task #166. Same-command signed Final ACK remains a separate E2E requirement.

## DEV Gateway recovery preflight — additional independent checks (14 Nov 2026, read-only)

- Task remains `Ready`, port 18789 has **0 listeners**, original Gateway process PID 8532 is absent, and 7 other Node processes are present. No evidence of an active *matching* Gateway in inspected process command-line classification; this alone does not prove no other process holds open SQLite handles.
- Task trigger: **at user logon**; `StartWhenAvailable=false`; `AllowDemandStart=true`; `MultipleInstances=IgnoreNew`; `RestartCount=3`, `RestartInterval=PT1M`, no execution time limit. Task Scheduler Operational log around 14 Nov 16:25–17:00 shows only Event 201 (action end, nonzero result) and 102 (task completion), **no observed restart attempt** in that window despite the settings. Do not infer a working automatic recovery policy from configured retries alone.
- Gateway launcher `gateway.cmd` contains 14 lines, sets the expected state/config and port variables, and invokes the bundled Node launcher; it exists. No launcher values, credentials or secret-bearing lines were emitted.
- Target ownership lock under `openclaw-state-owners` is absent; 5 other old owner-lock files (last modified 21 Oct) remain untouched. Their state/ownership is not proven.
- Local disk free: about **115.8 GiB**. No verified Gateway backup was identified at the common checked `gateway-stable3-main/{backup,backups,.backups,snapshots}` or `AI-Core/{backup,backups}` paths. This is **not proof that no backup exists elsewhere**.
- Correct Gateway-state `state/openclaw.sqlite` and `agents/gpt02-dev/agent/openclaw-agent.sqlite` each returned **`ok`** for `sqlite3 -readonly <path> 'PRAGMA quick_check;'`, exit code 0. This is a limited database consistency check, **not** a full `integrity_check`, a verified recovery copy, or a check of all other agent stores. The subsequent full-integrity attempt received no remote response; **do not count it as PASS**.
- Both the main database and relevant WAL were last modified around the 16:32 shutdown window. Later `-shm` timestamps were observed during diagnostics. A naive file-by-file copy of only a `.sqlite` database is therefore **not** an accepted backup method.

### Bounded recovery plan — prepared, NOT executed or authorized by this document

| Gate | Evidence required | On failure |
| --- | --- | --- |
| G0 — independent owner/single-instance preflight | DELL accessible; local Gateway listener and matching PID inspected; task owner, state path, open owner locks, existing queued call state inspected; no competing writer or unowned in-flight transaction | **STOP** without changing any process or lock |
| G1 — protected recovery snapshot | Create a local access-restricted backup with a **SQLite WAL-consistent backup mechanism** for each relevant live state/agent DB; capture required service configuration and credential-store metadata/contents only in operator-controlled encrypted custody; preserve directory ACLs; record manifest/checksums | **STOP**; no service launch |
| G2 — restore rehearsal | Independently open backed-up SQLite copies **outside active state**, run integrity checks and verify a bounded restore procedure; don't report recovery-ready based on file existence alone | **STOP**; retain original state |
| G3 — authorized one-time DEV service launch | Explicit maintenance approval, feature gates still no-dispatch, current owner-lock/PID recheck, then use the **existing** Windows Scheduled Task (not a second manual Gateway process). Never run uncontrolled concurrent launches | If it fails, **no automatic repeated manual retries**; collect sanitized logs and go to review |
| G4 — service health, no business effects | Port 18789 listening, `gateway status --deep` reachable on correct state, stable ownership/one Gateway PID, no resource-close errors; no worker send | Mark Gateway unhealthy; keep dispatch disabled |
| G5 — separately authenticated GPT02 route | Check the actual DELL `gpt02-dev` provider principal, selected `openai/gpt-5.5` model route, and authenticated credential-store inspector; do not silently switch provider/model or activate a saved inactive key | Keep Issue159 admission and E2E **NO_GO** |

**Rollback:** preserve the originals. If a newly launched service fails, first verify there is no active writer and capture crash evidence. Do **not** automatically overwrite or delete any SQLite/WAL/SHM files, restore credentials, clear old locks, terminate unrelated Node processes, or restart repeatedly. A restore requires an independently verified snapshot, a quiescent state and a separately reviewed operator procedure. No PROD data or services are in scope.

**Execution state (updated):** G0 has partial read-only evidence. G1 and G2 have PARTIAL PASS for two protected SQLite snapshots, but full-system backup and operator-controlled restoration remain unverified. G3/G4/G5 **NOT** performed. This document explicitly does **not** approve service launch/restart.

## Protected local SQLite snapshot and restoration rehearsal — 14 Nov 2026

**Direct DELL evidence, not merely CI:** The actual Gateway remained offline (`OpenClaw Gateway` Scheduled Task `Ready`, last result 1; **0** listeners on 18789; no matching main Gateway process in the inspected Node process list). The local account held approximately 115.6 GiB free space. Independent `sqlite3 -readonly ... 'PRAGMA integrity_check;'` checks on **two** identified DEV SQLite databases both returned `ok`, exit code 0.

A new backup directory was created **on DELL only** under the local user's `AI-Core` area, outside active `gateway-stable3-main` state, with ACL inheritance disabled and **one FullControl rule for the current Windows user**. No file was uploaded or copied to GitHub or the assistant's container.

Two SQLite-consistent snapshots were created with Python `sqlite3.Connection.backup` **to memory**, including committed WAL state, then serialized to standalone rollback-mode SQLite snapshots. The WAL-mode header's two mode flags required normalization for in-memory standalone restore; the normalized snapshot was independently rechecked using SQLite `PRAGMA integrity_check`. Each snapshot was then encrypted using Windows **DPAPI CurrentUser** and written as a distinct `.sqlite.dpapi` file in the protected local directory. The script read the saved ciphertext back, decrypted it in memory, verified its SHA-256 equality against the snapshot, and ran SQLite integrity verification **again** on the recovered image.

| Scope | Encrypted backup | In-memory decrypt/restore/integrity | Result |
| --- | --- | --- | --- |
| `state/openclaw.sqlite` (Gateway shared state) | Created locally, ~5.28 MB | PASS | **PARTIAL G1/G2 PASS** |
| `agents/gpt02-dev/agent/openclaw-agent.sqlite` | Created locally, ~0.91 MB | PASS | **PARTIAL G1/G2 PASS** |

A local nonsecret manifest records which two files were backed up, byte counts and digests. The script emits status only; it neither queried credential records nor displayed tokens. **No plaintext database backup was written to disk**; source files, original WAL/SHM files, lock files and running processes were left untouched. The encrypted files can be recovered through the original Windows user's DPAPI context; they are **not portable** to a different Windows account or computer without separately managed recovery of that DPAPI identity.

**Required qualification:** These two snapshots are **not a complete Gateway disaster-recovery backup**. Full configuration, task launcher, remaining agents/plugins and credential-store file backups and a fully isolated end-to-end restore rehearsal have not been completed. An attempted local encrypted copy of config/credential files was blocked by the access safety gate *before executing*; subsequent read-only confirmation found none of those three proposed extra `.dpapi` files. Do not retry by bypassing that gate. The remainder requires an approved operator-controlled credential backup/recovery mechanism; do not put secrets into a PR, shell logs or ChatGPT.

**Gate status:** G0 read-only partial; **G1 partial (two encrypted DB snapshots only)**; **G2 partial (in-memory roundtrip/integrity for these two snapshots only)**; G3/G4/G5 **NOT performed**. These results do **not** authorize Gateway restart, restore, dispatch, credential activation, merge/deployment or PROD operations.

## OpenClaw official full-backup plan, checked without writing (14 Nov 2026)

The installed DELL OpenClaw CLI `2026.10.7` exposes the official `openclaw backup create` command with `--dry-run`, `--json`, `--no-include-workspace`, `--output`, and `--verify` options. Using **the correct running Gateway state/config paths**, and invoking the installed Node CLI entrypoint directly (not the browser-dev launcher, which overrides the state directory), this read-only preflight completed twice with exit code **0**.

Sanitized plan readback: `dryRun=true`, `includeWorkspace=false`, **2 asset entries**, **5 agent roots**, **28 skipped entries**, `skippedVolatileCount=0`. The excluded entries were **not** reviewed as a full restore coverage audit; `verified=false` is expected on a dry run because **no archive was created**. No source paths, user account IDs, file payloads or credentials were copied into the PR.

The official OpenClaw backup documentation states that full backup archives can include auth profiles, channel/provider credentials and agent state, and require owner-only access and encryption. It also explicitly warns against raw copies of live `.sqlite`, `-wal`, `-shm`, or `-journal` files. The supported path is `backup create`, optional `--verify`, and restoration into a **fresh** target, not replacing live state. References: https://docs.openclaw.ai/install/backups and https://docs.openclaw.ai/cli/backup .

**No native backup create was executed** in this stage: a full archive can contain sensitive credentials, and the local encrypted-credential-copy attempt was already denied by the access safety gate. A new archive must be created and safeguarded through a separately approved operator-controlled, encrypted backup destination, followed by native verification and staged restore inspection. The safe CLI dry-run is useful planning evidence only, and does not clear G1/G2 for full-system recovery.

## 18:14 WIB independent G0/G1 read-only reconfirmation (14 Nov 2026)

- DELL remote command execution was available again at 18:14 WIB. Gateway listener `127.0.0.1:18789`: **0**; Windows task `OpenClaw Gateway`: **Ready** (not running). No restart was attempted.
- Against the **actual Gateway state**, `state/openclaw.sqlite` and `agents/gpt02-dev/agent/openclaw-agent.sqlite` both returned `PRAGMA integrity_check: ok` under `sqlite3 -readonly`, exit 0. This is a fresh **source database** integrity check, independent of the earlier DPAPI snapshot roundtrip; it does not prove complete backup coverage or all plugin stores.
- The installed official `openclaw backup create --dry-run --json --no-include-workspace` again completed with exit code 0 on the correct state/config. It reports `dryRun=true`, **2 assets**, **5 agent roots**, **28 skipped entries**, with skipped-entry reasons **23 `regenerable`** and **5 `covered`**. This reason census was derived from JSON fields only: no source paths, account identities, contents or credentials were reported.
- The dry-run's `skippedVolatileCount=0` and its planned coverage do **not** certify recovery of secrets or credentials. No archive was written or verified, and no restore was executed. The previously created two user-bound DPAPI SQLite snapshots remain partial G1/G2 evidence; no additional copy or credential access was performed.

**Decision:** The additional diagnostic evidence strengthens the **read-only prerequisites** but does not clear the full encrypted archive, portable credential-custody, isolated restore and owner-approved maintenance gates. G3/G4/G5 remain **NO_GO**. Do not repurpose a source/CI green check as permission to launch the Gateway.

## Upstream source correlation and update-owner preflight (14 Nov 2026)

This is a **read-only candidate remediation assessment**, not proof that a particular upstream bug caused the DELL incident and **not** permission to update or restart. The active installed package identified on DELL is **OpenClaw 2026.10.7**, with core source rooted under `staged-update-2026.10.7/node_modules/openclaw`. Its package metadata requires Node `>=24.22.1 <25 || >=26.12.1`; the locally used Node was `24.22.1`. The staged installation has a parent-level `package-lock.json` but no visible core/package-root package-manager ownership marker, and the existing CLI's `openclaw update --dry-run --json` reported **`status=skipped`, `mode=unknown`, `reason=unmanaged-package-install`**, exit code 0. An exit code of 0 here **does not** indicate an eligible update. No package was downloaded, installed, activated, configured or restarted.

Relevant OpenClaw upstream source has three independently merged repairs **later than the installed 2026.10.7**:
- [#175118, merged 18 Oct 2026](https://github.com/openclaw/openclaw/pull/175118): a second OpenClaw process could steal a still-live Windows Gateway state lock when boot observations disagreed; process PID/start identity is now preserved.
- [#181270, merged 23 Oct 2026](https://github.com/openclaw/openclaw/pull/181270): a forced-retirement timeout could cause later Gateway shutdown to fail even after plugin disposal eventually settled.
- [#186811, merged 28 Oct 2026](https://github.com/openclaw/openclaw/pull/186811): old Gateway shutdown after an agent database ownership lock was replaced could leave native/plugin resources and exit handling stuck. **The fix must be running in the old Gateway before it enters shutdown**; installing a new candidate cannot retroactively repair an old process.

The current [OpenClaw v2026.11.3 release notes](https://github.com/openclaw/openclaw/blob/main/docs/releases/2026.11.3.md) expressly include protection for a running Windows Gateway losing a lock when boot information disagrees. This makes a *controlled newer release* a credible repair candidate; compatibility for this particular staged installation, SDK plugins, credential custody and its Windows launcher **has not been tested**.

**Windows power-event correlation:** Windows System logs during the original Gateway uptime (13 Nov 17:46–14 Nov 16:33 WIB) contain 21 transition events, including `Kernel-Power` 506/507 and explicit sleep/resume 42/107 around 13 Nov 22:48–22:49, with subsequent transitions until 14 Nov 13:45. These events are consistent with upstream reports involving boot/sleep state, but neither proves a boot-identity mismatch at 16:32 nor identifies the process that replaced the lock. In the same broader period, multiple OpenClaw CLI diagnostic operations were performed; because upstream #175118 describes **a second process** as a possible claimant, treat direct CLI use against a live shared Gateway state as a potential contributing boundary and **avoid concurrent state-owning diagnostics** until an independent operator review establishes safe concurrency. This is temporal/source correlation, not a causal attribution.

### Safe upgrade route — NOT yet authorized/executed

1. Determine the actual **owner of the staged package + Windows task launcher**, rather than assuming shell `openclaw` or global npm controls the serving installation. A global npm install could create a second, unused OpenClaw path without changing the service's executable. Inspect installed package ownership and startup root before selecting a repair method.
2. Preserve the existing package, launchers, config, plugin cohort, all relevant agent databases, private credential store, and current Task Scheduler XML via an **operator-controlled encrypted** backup with a demonstrably restorable target. Earlier credential/config copy attempts were blocked by access controls; **do not bypass that gate or publish credentials in CI/PR**. The already-created two DPAPI SQLite snapshots are partial only.
3. Perform a **separate staged candidate compatibility assessment** for the proposed supported version and all core/runtime plugins, including Codex data/settings migration. Do not equate an upstream fix with a verified safe replacement on this computer.
4. After explicit maintenance authorization, use the **actual installation owner's supported package replacement method** and existing Scheduled Task. Do not run a second Gateway, blindly restart the old broken process, or change the model/provider for a green status. Preserve exact current configuration and route, with rollback held behind backup/restore validation.
5. Verify successful one-Gateway startup, shared-state ownership, 18789 listener, Codex cleanup readiness and no deferred migrations. Then separately establish authenticated `gpt02-dev` OpenAI model route; Issue159 dispatch/Final ACK remains NO_GO until a newly authorized task and full E2E evidence.

**Gate result:** Identified three upstream candidate fixes and a specific installed-updater blocker; **no native upgrade action is permitted yet**. Full recovery archive, credential custody and isolated restore remain unverified. The old Gateway's lock owner change is not conclusively attributed to any particular process or diagnostic command.

## Exact source-to-release comparison: OpenClaw v2026.11.3 is not automatically qualified

**Important correction to the earlier broad upgrade recommendation.** The public OpenClaw `v2026.11.3` package is a stable published release (10 Nov 2026), and [its package metadata](https://github.com/openclaw/openclaw/blob/v2026.11.3/package.json) declares Node `>=24.16.0 <25 || >=26.1.0`; DELL Node `24.22.1` meets this **engine requirement only**. The installed DELL OpenClaw remains `2026.10.7`.

A direct **read-only GitHub source comparison** with the three merged upstream PRs identified earlier gives a narrower result:

| Original fix | Exact source feature in official `v2026.11.3` tag | Assessment |
| --- | --- | --- |
| [#175118](https://github.com/openclaw/openclaw/pull/175118) — live Windows owner-lock identity | `src/infra/gateway-lock-payload.ts` contains the Windows PID/process-start comment and same-namespace handling from the PR | **Source marker found**; still requires Windows runtime regression |
| [#181270](https://github.com/openclaw/openclaw/pull/181270) — plugin forced-retirement cleanup | `src/plugins/plugin-cache.ts` has `waitForSettlement` option and forwards it to resource disposal, matching the PR patch | **Source marker found**; still requires Codex/plugin runtime regression |
| [#186811](https://github.com/openclaw/openclaw/pull/186811) — retained request watchdog on failed Gateway close | The PR patch changes `run-loop.ts` guard to `!forcedExitStarted && !(params.ownsProcessLifecycle && cleanup.failed)` and keeps request watchdogs when cleanup fails. However [`v2026.11.3/src/cli/gateway-cli/run-loop.ts`](https://github.com/openclaw/openclaw/blob/v2026.11.3/src/cli/gateway-cli/run-loop.ts) still contains the narrower `if (!forcedExitStarted)` guard at the analogous finalizer and the PR's exact watchdog guard is absent in the release-tag source | **Equivalent fix NOT proven in this release**; possible refactor must be independently reviewed |

These are **source-level comparisons**, not E2E/Windows runtime tests. A PR marked merged in the upstream repository does **not** by itself prove that the exact target release contains equivalent functionality; release branches/tags and merged commits may differ. Conversely, absence of one exact source guard cannot by itself prove the released binary has the identical flaw if another equivalent guard was introduced elsewhere. **Both cases require release-specific verification.**

### Mandatory additional upgrade acceptance gate (G2R — candidate source equivalence)

Before a package replacement is proposed on DELL:

1. Identify a signed, published candidate version whose **actual release tag or package artifact**, not just main-branch PR history, is verified to retain Windows owner-lock identity, await plugin disposal safely, and preserve a bounded shutdown hard-exit watchdog **when `cleanup.failed`**.
2. Confirm the actual package bytes/version and installed core/Codex plugin versions in an **isolated staging area** with NO access to DELL live state, tokens, credentials, shared SQLite, active Gateway port or owner locks. Run lifecycle regressions for `SIGUSR2`, failed close, forced retirement and single-owner locking. Do not treat `openclaw update --dry-run` exit 0 as an install success when it returns `unmanaged-package-install`.
3. Preserve the actual Windows Scheduled Task launcher binding and one-Gateway-instance policy; write a reviewed atomic replace/rollback sequence *only after* full operator-owned encrypted backup and isolated restore rehearsal pass. Do not use global `npm install` as a surrogate for the custom staged package.
4. Require an independent code/security approval and controlled DEV-only maintenance authorization before changing launcher, package, plugin, service, credential or process state.

**Decision:** `v2026.11.3` is an **unqualified candidate**, not a proven fix for this DELL shutdown. G2R **NO_GO** until equivalence and isolated lifecycle tests pass. This qualification corrects any earlier implication that merging PR #186811 automatically made v2026.11.3 safe to deploy.

## Source-only comparison with v2026.11.5-beta.2 (not an installation recommendation)

Read-only GitHub release inspection on 14 Nov 2026 identified [`v2026.11.5-beta.2`](https://github.com/openclaw/openclaw/releases/tag/v2026.11.5-beta.2), **published as a prerelease on 12 Nov**. The most recent **non-prerelease** version in the checked release list remains `v2026.11.3`. The beta [package metadata](https://github.com/openclaw/openclaw/blob/v2026.11.5-beta.2/package.json) accepts DELL's Node `24.22.1` (engine `>=24.16.0 <25 || >=26.1.0`), but this is only a dependency version gate.

In the beta release's **actual tag source**:
- `src/infra/gateway-lock-payload.ts` has the Windows boot-observation identity guard.
- `src/plugins/plugin-cache.ts` retains the `waitForSettlement`/resource disposal option.
- [`src/cli/gateway-cli/run-loop.ts`](https://github.com/openclaw/openclaw/blob/v2026.11.5-beta.2/src/cli/gateway-cli/run-loop.ts) now gates watchdog removal with `!forcedExitStarted && cleanup.canClearRequestWatchdogs()`, unlike stable `v2026.11.3` where that location only tests `!forcedExitStarted`.
- [`src/cli/gateway-cli/run-loop-cleanup.ts`](https://github.com/openclaw/openclaw/blob/v2026.11.5-beta.2/src/cli/gateway-cli/run-loop-cleanup.ts) defines `canClearRequestWatchdogs()` as `!resourcesRetained && (!ownsProcessLifecycle || !cleanupFailed)`, which **appears to retain the watchdog** when a process-owned Gateway shutdown fails or resources remain held. This is a plausible source-level semantic equivalent to the targeted watchdog retention requirement.

**Qualification:** The beta passes only this **static source-feature inspection**. It has not been installed, run on Windows DELL, tested with the existing Codex plugin, or subjected to `SIGUSR2`/lock conflict/restore tests. This is **NOT** an approved live DEV release. Prefer a subsequent fully reviewed stable release containing the equivalent guard; otherwise, only an independently approved isolated beta/candidate test environment can assess it. Never change the active Gateway launcher or credential store based on these source markers alone.

## Scheduled-task interference check (read-only)

The DELL Task Scheduler contains `AI Core OpenClaw Repair DEV` (Ready, last observed execution 22 Oct), `GPT02 DEV Local Health Monitor` (five-minute timer), and `AI Core DELL Wake Executor DEV` (Running) **in addition to** `OpenClaw Gateway` (Ready/offline). This confirms that unrelated Node processes and worker services must not be indiscriminately terminated.

In the 14 Nov 16:20–16:40 WIB Windows Task Scheduler event window, the local health monitor executed at 16:20, 16:25, 16:30, and 16:35; the Gateway terminated at 16:33. The monitor's VBS wrapper points to a 162-line `gpt02-dev-monitor-readonly.ps1`; a static PowerShell AST parse found no parse errors, and its named command calls were read/formatting-oriented (`Get-CimInstance`, `Get-ScheduledTask`, `Get-Content`, JSON conversions, etc.). There were five dynamic Node invocations, with no literal `openclaw.mjs`, `gateway.cmd`, process-termination or Scheduled-Task-start command in the examined script. **This does not conclusively establish that all dynamic invocations are side-effect-free or identify the ownership-lock actor.** It does reduce the likelihood of a simple scheduled `Start-ScheduledTask`/restart loop in the monitor. Do not disable it without separately reviewing its owner and dependencies.

## Proposed claim admission contract remains dormant

Source-only PR #1754 already requires independently owned read-only `inspectGatewayReachability()`, `inspectOpenClawModelStatus()`, and `inspectGatewayCredential()` evidence, matching exact worker/agent/provider/owner/target/proof and a recent Gateway status. Green synthetic CI **does not** mean an actual DELL reader or dispatcher is installed or the live system is healthy.

**Decision: SOURCE/CI PASS if independently green on current HEAD; DELL live Gateway/credential/E2E = NO_GO.** Draft/unmerged/undeployed; PROD untouched.
