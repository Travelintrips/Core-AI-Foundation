# GPT02 DEV — single integrated E2E completion package

**Created:** 2026-11-09. **Repos:** Core-AI-Foundation PR #1660 and AI-Task-Hub PR #155. **Scope:** DEV only, preserve all running features, PROD unchanged, no unapproved replay/recovery of Task #135.

## One target / one decision

**Target:** a *new authorized test task* in AI Task Center receives an accountable PIC and audited operator admission; Core verifies independent signed provenance and atomically claims its unique attempt, nonce and grant; exactly one DELL worker executes the command; progress and final native ACK feed the same task dashboard; recoveries are fenced, observable and safe. Only this real end-to-end path plus authenticated browser/DB/worker tests can support final PASS.

**Existing task #135 is forensic evidence, not a successful test candidate.** Its prior execution and Core command are terminal FAILED. A direct Command ID reference match exists, but Core Task ID, signed attestation, PIC, native ACK are missing. Neither manual replay nor automatic retry of the failed attempt is authorized.

## Workstreams — designed together, implemented behind independent gates

| Workstream | Implementation contract | Required proof | Current state |
|---|---|---|---|
| A. Hub DB identity + tenant | Move Hub DEV off highly privileged PostgreSQL `postgres`; classify all SQL paths, 93+ tables, 90 sequences, dynamic SQL/functions, and RLS; preserve app behavior | Scoped login never CREATEROLE, BYPASSRLS, global read/write or evidence owner/writer; same authenticated tenant E2E and rollback | **BLOCKED**: 93 scanned tables RLS enabled, 2 with policies, Hub still postgres |
| B. Evidence store + writer | Append-only claim/nonce linked by deferred FK; owner and writer NOLOGIN; dedicated issuer login with separate credential and INSERT-only rights | Live separate-login privilege/readback, immutable and replay safeguards, isolated privilege checks | Schema/NOLOGIN roles **installed**; separate writer LOGIN not available, Hub role-admin residual risk |
| C. Operator admission | Super Admin session, accountable owner, PIC membership in same tenant, signed review/approval and scoped nonce | Real logged-in browser E2E and immutable audit, fail closed on forged actors | Code and synthetic tests only; no new real authorized task proof |
| D. Independent attestor + issuer | Core/Hub native command IDs bound to one attempt and immutable attestation; signed origin verified independently; atomic issuer identity and nonce | Signed native provenance verifiable without relying solely on shared DB; no replay, rollback and concurrency proof | Synthetic Ed25519+PG test PASS; operational attestor/issuer **NO-GO** |
| E. DELL worker lifecycle | Event-driven task/attempt/command dispatch, lease/fencing, heartbeat, progress, native final ACK; safe recovery | At-most-once per attempt under crash/restart and parallel workers; native ACK and progress visible | DELL OpenClaw processes observed, not proof of worker ACK; grant/lease schemas absent |
| F. Monitoring + final acceptance | One existing AI Task Center task detail with accountable PIC, diagnostic reasons, progress, blockers, human escalation and retry controls | Authenticated Hub UI + API + Core + DELL+DB observations all agree for **new** task, no PROD regression | Read-only lineage panel deployed DEV; actual native final path **NO-GO** |

Dependencies: A+B underpin C+D; C+D gate E; E provides proof for F. UI, monitoring and worker tests can be prepared in parallel, but no release can bypass A→D. Complete changes must be reviewed and tested as a set, not asserted PASS from individual unit tests.

## DELL wake executor observation — 2026-11-09

- The DELL machine is online and has OpenClaw-related Node processes, but that is **not a native task completion receipt**.
- Windows Scheduled Task `AI Core DELL Wake Executor DEV` is reported `Running`, with `MultipleInstances=IgnoreNew` and `ExecutionTimeLimit=PT0S` (no bounded task time). Attempts triggered every five minutes produced Task Scheduler operational **Event 322 Warning** repeatedly between 15:13 and 15:48 WIB on Nov 9.
- Last scheduler result `0x800710E0` maps via Windows `net helpmsg 4320` to *“The operator or administrator has refused the request.”* With `IgnoreNew`, this is consistent with subsequent triggers not being admitted while a prior instance remains running; do not assert a definitive root cause without process/job linkage.
- `GPT02 DEV Local Health Monitor` returned `0` on its last observed run, but this only attests monitor execution, **not the executor's command ACK**.
- Safe worker workstream therefore includes checking whether a lingering executor instance owns a valid lease, measuring bounded lifetime/heartbeat, and ensuring at-most-once worker admission. **Do not kill or restart the running task without verifying ownership and in-flight command state; do not replay failed Task #135.**
- Neither the unified SQL acceptance script nor Windows process existence can prove a signed native final ACK. This remains a release blocker.

## One unified live acceptance

The repository now contains `scripts/dev/gpt02-unified-e2e-acceptance-readonly.cjs`.

On the authorized VPS:

```bash
GPT02_UNIFIED_INVENTORY_MODE=DEV_VPS_READONLY \
  GPT02_AUDIT_TASK_ID=135 \
  GPT02_AUDIT_COMMAND_ID=83db99f5-cbda-4e60-be71-3090fb411bbb \
  node scripts/dev/gpt02-unified-e2e-acceptance-readonly.cjs
```

Exit code **3** is expected for incomplete E2E evidence (NO_GO). Exit **2** means the audit could not run or selector invalid. The command is read-only, executes bounded SQL inside the existing Core and Hub DEV service containers, reads service health, and does not access native credentials or create worker commands. The task/command selectors may be replaced by IDs from a separately authorized new test.

The report groups actual completed checks and blockers. **It never substitutes database booleans for independent native signature verification**, and explicitly withholds issuer, dispatch, recovery, completion authorization. It does not claim DELL native ACK from merely seeing OpenClaw processes.

Initial 2026-11-09 readback of Task #135: **7 of 18 release checks satisfied**, 11 incomplete. Key blockers: Hub still uses `postgres`, grant/lease schema missing, PIC not present, Core Task ID absent, failed Core command, attestation false, final ACK false, independent native authorization/DELL ACK missing. The 7/18 is a technical gate census, **not overall completion percentage**.

## Single deployment and rollback policy

- Keep Core CI watcher ownership of Core DEV image, never manually race it. AI Task Hub DEV is separately deployed and requires a bounded, image/config-diff/rollback procedure.
- Treat RLS, tenant boundaries, ordinary task lifecycle, scheduler, webhook and WhatsApp integration as mandatory regressions—not dispensable GPT02 scope.
- All new command issuance requires an authorized, new attempt; Task #135 remains untouched. No unreviewed retry or recovery.
- No PROD modification, no broad grants, no bypass of RLS, no reusing `postgres` for operational issuer and no PASS claim without independent native final ACK.
- Advance deployment only after per-workstream isolation tests and one real authenticated E2E test on DEV. A failed stage stops only affected deployment; do not repeat already evidenced unrelated audits.

## Reporting rule

Report only: **completed work**, **remaining release blockers**, **next implementation bundle**, **specific native evidence**, and final GO/NO-GO. Avoid introducing a new PR per test. Use the two existing draft PRs as the shared execution record. Do not ask user to repeatedly reply “lanjut” simply to move between predefined phases.
