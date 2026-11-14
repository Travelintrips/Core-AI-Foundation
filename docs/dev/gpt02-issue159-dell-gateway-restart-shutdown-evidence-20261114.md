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

## Strictly read-only prerequisites before a separately approved recovery

1. Recover the DELL remote connection; independently check process IDs, Scheduled Task state, port `18789` listener, and the intended Gateway owner/state. No retry loops that write state.
2. Review the stability bundle's **nonsecret diagnostics** locally on DELL; redact all tokens, credentials, user identifiers and paths before attaching summaries.
3. Read-only inventory of active Gateway/Node processes, shared-state owner/generation, Codex plugin lifecycle, outstanding calls and current `gateway.cmd` launch context. Confirm whether shutdown is still in progress or any separate Gateway process is active before considering a restart.
4. Preserve a verified backup/recovery plan for state and credential stores through the platform's supported mechanism. Separately review operational maintenance window, restart safety, and owner authorization. **This document does not grant such authorization.**
5. Only after controlled recovery, verify live Gateway reachability and fresh runtime status. Then separately verify authentic `gpt02-dev` provider principal and `openai/gpt-5.5` route without changing provider or importing credentials by default.
6. Reassess Issue159 fresh owner/PIC/Core Super Admin authorization and one-use fence only once all independent preconditions pass. No replay of old Task #166. Same-command signed Final ACK remains a separate E2E requirement.

## Proposed claim admission contract remains dormant

Source-only PR #1754 already requires independently owned read-only `inspectGatewayReachability()`, `inspectOpenClawModelStatus()`, and `inspectGatewayCredential()` evidence, matching exact worker/agent/provider/owner/target/proof and a recent Gateway status. Green synthetic CI **does not** mean an actual DELL reader or dispatcher is installed or the live system is healthy.

**Decision: SOURCE/CI PASS if independently green on current HEAD; DELL live Gateway/credential/E2E = NO_GO.** Draft/unmerged/undeployed; PROD untouched.
