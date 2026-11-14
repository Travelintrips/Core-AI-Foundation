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

**Execution state:** G0 has only partial read-only evidence, G1/G2 have **NOT** been performed or proven, G3/G4/G5 **NOT** performed. This document explicitly does **not** approve service launch/restart.

## Proposed claim admission contract remains dormant

Source-only PR #1754 already requires independently owned read-only `inspectGatewayReachability()`, `inspectOpenClawModelStatus()`, and `inspectGatewayCredential()` evidence, matching exact worker/agent/provider/owner/target/proof and a recent Gateway status. Green synthetic CI **does not** mean an actual DELL reader or dispatcher is installed or the live system is healthy.

**Decision: SOURCE/CI PASS if independently green on current HEAD; DELL live Gateway/credential/E2E = NO_GO.** Draft/unmerged/undeployed; PROD untouched.
