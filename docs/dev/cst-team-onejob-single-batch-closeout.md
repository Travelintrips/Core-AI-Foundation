# CST-DEV One-Job — Single-Batch Completion Contract

**Version:** 2026-11-20. **Scope:** CST-DEV project `xssrfshdrtdfupgqwfdw`, Company 1, exactly one fresh `qwen2.5:3b` job. **PROD:** excluded. **Historical job #482:** read-only; never replay. **Status:** implementation/acceptance contract, NOT authority to execute.

## Why this is one batch, not another sequence of small PASS declarations

Release acceptance is the **intersection** of all controls below. Compile, typecheck,
mock broker, signed synthetic receipt or a successful standalone PostgreSQL test
can be PASS while the *release remains NO-GO*. There must be one shared implementation
baseline, a single integrated QA invocation, one evidence bundle and one final decision.
Do **not** rebuild the already-PASS event bus, model worker, Unix-socket adapter, RLS
templates, receipt verifier, reviewer or existing OTP login.

## Consolidated build inventory and dependencies

| Work package | Reuse already available | Remaining implementation — must be built together before live test | Gate |
| --- | --- | --- | --- |
| A. Owner approval | Owner/Super Admin DEV session, `cst_onejob_owner_approvals` schema and policies, signed receipt projection | A one-time authenticated Owner-session approval route, exact job-bound challenge, independently pinned signing/provenance and atomic idempotent approval. Existing RLS merely checks an Owner **ID**, not actual consent. If Super Admin delegated approval is allowed, review this explicitly; do not silently rewrite Owner-only RLS. No new password or TOTP. | A newly created Company-1 WAITING job and one independently verified fresh Owner approval |
| B. Staged job / writer | Two existing `NOLOGIN` stage roles, one-Company RLS and unique request constraint | Execute the **already-approved** staged job only through an authorized DEV server action; stage login stays `NOLOGIN` until authenticated authority exists. Disallow forged actor and second model job. | One `waiting` job, then **one** legal `queued` transition after all preflight checks |
| C. Broker + pooler | Existing socket client, accepted-FD `SO_PEERCRED`, pinned Supabase CA and nftables QA | Operational non-root broker with independent kernel peer inspection, startup-before-traffic ACL, fixed pooler destination, DNS rotation/revalidation, rollback/relock, no root-run shared Core DEV fallback, service supervisor and health evidence. **Operational entrypoint currently intentionally throws**. | Only exact CST-DEV pooler endpoint on TCP 6543; wrong peer/host/CA denied |
| D. Isolated model worker | Existing model execution/job engine, `cst-team-onejob-ephemeral-role-template.sql`, source marker | Dedicated bounded **temporary** DEV-only DB role under verified SCRAM/TLS/UDS; exact job+worker+Company-1 grants, non-root process, owner-bound approval, no shared `aicore_dev_runtime` credentials; safe TTL + automated relock. | One and only one fresh `qwen2.5:3b` run with atomic job/event/audit |
| E. Independent subscriber | Existing subscriber RLS/rollback templates, one-event consumer, canonical Ed25519 receipt checker, durable unique index | Real independently authenticated subscriber process in CST-DEV with external key custody and separate public-key pin; prove it is armed **before** model dispatch. Use scoped read and append-only audit only, not generic event-bus blanket UPDATE/SELECT. | One real durable signed `job.completed` receipt, unique under replay, separately read back from actual CST-DEV |
| F. Independent QA + four-agent ACK | AI Task Hub Draft PR #202 monitor, four public trust roots and isolated QA evidence | Implement actual independent agents' signed job-bound attestations and separate reviewer quorum, not operator-entered text; verify identities, nonces, receipt/event chain and four distinct keys, then Final ACK. Hub must not infer PASS from a synthetic callback or a DB label. | Four independent verifiable signer receipts and one Final ACK for the **same** new job |
| G. Rollback and recovery | Existing stage role cleanup and subscriber rollback templates, source/CI checks | One idempotent stop/rollback controller to revoke **only temporary** machine roles, stop candidate and broker, relock signer/dispatch, preserve immutable audit and leave active DEV unaffected. Test network failure, stale approval, replay, duplicate event, crash/restart, signer/DB timeout and partial rollback. | Re-run does not create a second job, receipt or grant; all cleanup readback PASS |

## Ownership and no-surprise approval

All **code, fixtures, manifests, installation/rollback scripts and negative tests**
should be completed before asking the Owner to operate. The only necessary
human action is **one actual Owner/Super Admin approval via the existing DEV
session** for a *specific new job*. That action cannot be fabricated or inferred
from the chat message “lanjut”, a synthetic signature, a manually inserted Owner
ID, or a privileged developer query. No password/OTP is collected in chat.
If application session freshness cannot be independently verified, the owner
gate must remain **NO-GO**.

## One acceptance run, exact order (fail-closed)

1. **Offline batch — once:** exact PR HEAD regression tests; PostgreSQL 16
   network-none model/subscriber RLS and signed receipt; SCRAM wrong-password
   rejection, independent signer with `SO_PEERCRED`; CI build/typecheck; single
   machine-readable QA summary. No real DEV/PROD write.
2. **DEV deployment preflight:** demonstrate exact approved source, isolated
   candidate, operational broker started *after* audited ACL, strict
   hostname+CA and project-identified database; independent real database
   sessions and limited TTL. Check it cannot reach Core shared runtime, PROD,
   any other IP or host gateway.
3. **Owner authorization:** one authenticated fresh DEV Owner-session
   approval, independently verified/bound to source SHA, one WAITING job,
   Company 1, worker, request nonce and expiry. If missing, **do not queue**.
4. **One real DEV job:** subscriber is demonstrably armed; only then
   `waiting → queued → running → completed`, with job, event and atomic
   publisher audit tied to the one fresh request. Negative tests may use
   isolated DB snapshots — do not create extra real jobs.
5. **Independent consumer + QA:** one separately signed durable receipt
   read back under independent authority; four genuine independent agent
   signatures and Final ACK. Reject replay and cross-company evidence.
6. **Automatic cleanup:** revoke temporary login/role, close broker,
   roll back candidate, retain immutable receipt and test that existing
   Core DEV is still healthy, without changing PROD or historical #482.

## Exact PASS definition

Declare **CST_DEV_ONEJOB_REAL_E2E_PASS** only when a single evidence bundle
contains all of the following from the *same exact commit, new job and project*:
authenticated Owner session receipt; immutable waiting/approval/queue lineage;
one actual Company-1 model execution; exactly one `job.completed` publisher
audit; one externally signed persistent subscriber receipt with real DB
readback; four genuine independent signer attestations; Final ACK; negative
permission/duplicate tests; rollback proof; CI successful on the exact SHA;
and healthy shared DEV runtime. If **any** item is missing, output
`NO_GO` and specific blockers. A positive QA fixture is never real E2E.

## Current observed blocker summary (2026-11-20)

Core Draft PR #1765 and Hub Draft PR #202 contain passing mock/isolated
components. Core operational broker starter is locked; Hub external reviews
are operator-collected, not independent signed ACK. Live CST-DEV read-only
catalog showed two inert `NOLOGIN` staging roles, **no** Owner approval row,
**no** fresh waiting/queued Company-1 pilot job, **no** login pilot role,
**no** independent subscriber role/receipt, and no Final ACK.
Hence operational status is **NO_GO**. Do not modify those existing roles
or generate another mock-only “PASS” as if it were release authorization.

## Single-run interface

`CST_ONEJOB_DISPOSABLE_QA=true node scripts/dev/cst-team-onejob-batch-qa.mjs --offline-full`

Runs one offline regression package and produces a single JSON summary.
It intentionally never advances a real job or declares the operational
release PASS. The **future** live admission/execution command must be built
as part of packages A–G, bound to an actual approved Owner session and
independent attestation. Never expose a “run live” flag in this QA tool.
