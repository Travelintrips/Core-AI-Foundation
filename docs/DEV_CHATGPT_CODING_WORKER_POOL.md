# AI Task — DEV ChatGPT coding worker pool

## Objective

AI Core is the single task owner. GPT-01 coordinates; GPT-02 and subsequent
individually authorized ChatGPT browser accounts can accept **new** coding jobs
when an eligible executor is idle. A worker already coding must not be
interrupted. Testing on the same change must go to a different account.

The initial implementation is a **fail-closed admission planner**, not an
automatic activation of ChatGPT accounts, new VPS Node workers, a cron loop,
or an executor that can claim tasks. The planner
`planDevChatGptCodingWorker()` returns a candidate only after its caller
supplies verified runtime evidence. It does **not** reserve the worker, send a
browser instruction, modify a DB row or grant permissions. A future server
dispatch must atomically recheck all evidence, lock the job and chosen
executor, then use the existing owner-scoped wake/attestation protocol.

## Why GPT-03 cannot be enabled merely by naming an email account

The current DEV DELL account-binding protocol pins each additional alias to
the dedicated worker `openclaw-dell-chatgpt-wake-dev`. The local registry
has at least one explicitly enabled additional GPT-02 binding. It **does not
prove** that a second GPT-03 account owns an authenticated, browser-controlled
session with a signed end-to-end ACK. The same dedicated DELL executor processes
claims **sequentially**, even if distinct profiles are configured.

A second account on the same serial executor can be **queued**, but cannot be
advertised as a parallel coding capacity. Real parallel GPT-02/GPT-03 coding
requires a second independently authorized executor with its own worker ID,
lease, browser profile and capacity, or a separately reviewed executor
implementation with safe per-profile concurrent claims. Never reuse the
DELL worker ID simultaneously across two consumer processes.

## Input and selection contract

- Job is approved for **DEV** and unclaimed (`QUEUED` or
  `WAITING_FOR_WORKER`); held project/file locks make it wait.
- Account alias, browser profile and executor identity are unique. GPT-01
  never joins the coding worker pool.
- Each candidate needs an explicit `coding`/`testing` capability, an enabled
  binding, an attested account-specific session, a verified destination receipt,
  a fresh heartbeat, an unexpired lease and a free execution slot.
- **Executor identity** is distinct from **ChatGPT account identity**. One busy
  serial executor blocks all browser profiles attached to it.
- If GPT-02 is busy and independently verified GPT-03 is idle on a **different
  executor**, the planner returns GPT-03 as an eligible candidate.
- If there is no verified independent slot, return `WAIT` and retain the
  original job. Do not fall back to an unrelated GPT account or provider.
- A candidate is not a reservation: the persistent claim must use an atomic
  database transaction, fencing token, idempotency key and project/file lock.
  No auto-replay of browser submissions or committed changes after timeouts.
- Never equate CI PASS or a browser echo with job success. Require a signed
  account-specific response and the correlated durable MCP callback / ACK.

## Activation prerequisites

1. Record the exact GPT-02 account/browser binding and distinguish it from
   the owner account. Verify that a real assistant response was signed and
   acknowledged using the existing V2 attestation protocol.
2. Provision and separately authorize GPT-03's own ChatGPT login, OAuth owner,
   conversation, OpenClaw profile and **independent execution capacity**.
   A user-supplied email alone cannot establish this tuple.
3. Review DEV server binding policy, DELL executor allowlist, security/owner
   authorization and RLS migration in the existing draft PRs before enabling
   any new identity. Do not apply grants by implication.
4. Integrate the planner into the authorized, transactional coding-task claim
   path. Commit a durable correlation ID and lease before dispatch.
5. Run bounded two-job DEV E2E: GPT-02 claims job A; GPT-03 claims unrelated
   job B; independent GPT performs QA; verify no duplicate writes or
   cross-account receipts. Test loss of lease, stale heartbeat, disconnected
   browser, blocked project lock, explicit cancel and safe recovery.
6. Deploy only on the canonical VPS DEV domain `dev.cstlogistic.co.id`
   after green CI and exact live SHA verification. PROD stays unchanged.

## Status boundary

**Component unit-test PASS != autonomous multi-account dispatch PASS.**
Until the prerequisites hold, the correct runtime outcome for a second
coding request is `WAITING_FOR_WORKER`, not `COMPLETED`.
