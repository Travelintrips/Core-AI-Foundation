# AI Core repository operating guidance

**Canonical communication SOP:** [AI Core ↔ ChatGPT ↔ OpenClaw SOP](docs/SOP_AI_CORE_CHATGPT_OPENCLAW_COMMUNICATION.md). Read before dispatching jobs, reporting callback receipt, or claiming E2E verification. Specialized authority/protocol documents remain references; this Markdown is not executable enforcement.


## Owner policy: ChatGPT primary coding, AI Core Chat authorized offline fallback (2026-10-11)
- **Primary:** ChatGPT performs task planning, code changes, tests, PRs, CI and authorized deployments through GitHub.
- **Fallback:** when ChatGPT is independently confirmed unavailable and Boss submits or explicitly continues the coding task in authenticated AI Core Chat, AI Core may plan and execute coding through its *approved controlled coding lane*, not unrestricted shell/agent privileges. The fallback request must identify the existing job/correlation ID where available.
- **Do not infer ChatGPT offline from silence, a delayed response, or an absent browser tab.** Require an explicit owner-requested takeover or authenticated availability failure/lease expiry with a durable fenced handoff. If evidence is insufficient, offer takeover confirmation rather than starting duplicate work.
- **Handoff requires exclusive ownership:** persist one durable job ID, owner, generation/fencing token, checkpoint, last verified commit and known side effects; revoke/expire the previous lease before taking work. Reject old writers, duplicate callbacks, and side-effect replays.
- **Return:** when ChatGPT reconnects, read the persisted checkpoint and accept ownership only through the same atomic handoff. Never automatically run two coders in parallel on the same job.
- Keep CI, branch protection, security checks, deployment authorization, and human critical approvals. No automatic bypass of production DB migration, destructive DB change, security change, payment or irreversible actions.
- **Implementation distinction:** existing AI Core Chat HTTP JSON, SSE and MCP coding-denial gates may still reject source-changing requests. This owner policy supersedes the prior blanket prohibition **as a desired policy**, but is *not runtime enablement*. The code must be changed and validated on all three boundaries before claiming fallback works; until then return an accurate policy/capability limitation rather than falsely reporting coding execution. Only allow fallback when authenticated authorization and exclusive job ownership are implemented.
- See [canonical SOP](docs/SOP_AI_CORE_CHATGPT_OPENCLAW_COMMUNICATION.md) for exact handoff, evidence and test gates.

## User workflow preference
## Default job routing (owner directive, 2026-10-09)
- Address the owner as **Boss** in user-facing reports.
- ChatGPT is the primary coding executor via authorized GitHub tools; AI Core Chat is the bounded fallback only for verified ChatGPT unavailability and explicit authorized takeover under the canonical SOP.
- Provide a non-binding initial estimate where useful; revise it as new blockers become known. Do not promise background work without an actual scheduled task.
- If access to SSH, VPS, Hostinger, GCP, credentials, or production verification blocks GitHub execution, immediately escalate only that blocked portion to AI Core using an authenticated and available MCP tool, with blocker, exact scope, and verification requirements. Creating a GitHub issue is NOT an AI Core command.
- If escalation fails, try other authorized routes and clearly report unresolved blockers. Verify results before claiming completion.
- Auto-merge and deploy only when CI, security, branch protections and required deployment gates pass and the change is pre-authorized. Never skip critical approval/security gates.
- Reserve Ollama for requested image/video rendering when configured and appropriate, not routine coding tasks.
- This Markdown governs agents that read the repository; it cannot itself enforce account-wide ChatGPT settings or other chat sessions.

- Execute authorized work directly whenever the available GitHub, AI Core, terminal, or deployment tools permit it.
- Do not interrupt with routine confirmation or repeated questions. Ask the owner only for an unavoidable missing permission, credential setup, or decision that materially blocks safe execution.
- Escalate coding or infrastructure work to AI Core through an authenticated, available integration when appropriate. A GitHub issue is a tracking artifact, **not** proof that AI Core received or executed an instruction.
- Prefer final outcome reports instead of frequent progress narration. Never report production deployment, a test pass, or automatic failover as complete without evidence.
- These instructions apply to repo-maintenance agents reading this file; they do not modify unrelated ChatGPT sessions automatically.

## AI Core ↔ ChatGPT authority and notification rules
- Follow [the audited command authority and notification matrix](docs/AI_CORE_CHATGPT_COMMAND_AUTHORITY_AUDIT.md) for read-only checks, GitHub-direct coding, explicitly requested orchestrator jobs, OpenClaw PC commands, critical approvals, and terminal reports.
- An AI Core/OpenClaw message, MCP event, log, or diagnostic ACK is not itself user authorization for a new action. Verify authenticated scope and task correlation before mutations.
- Do not claim AI Core → OpenClaw → this ChatGPT session → AI Core is working until a real callback and receipt are verified; an `echo ACK` is not a round-trip test.
- Report to Boss only verified terminal results, material failures/blockers, security incidents, and required critical decisions; deduplicate notifications by task and event.
- This policy is a repository instruction for agents that read it, not a globally installed ChatGPT memory or background subscription.

## OpenClaw failover safety
- OpenAI/AI Core remains the conversation and policy control plane; OpenClaw is an execution worker.
- Use separate worker IDs for PC and VPS. Do not start two executors with the same client ID.
- Healthy worker routing applies to *new* jobs; reassigning in-flight work requires durable fencing, lease handling, and idempotency. Never replay payment, financial, deployment, or WhatsApp side effects merely because a lease expired.
- Keep critical action approval gates intact, and do not share Tenant POS WA Gateway credentials with AI Core or Fleet.
- Do not touch the existing WA Gateway production Compose deployment at /opt/cst-wa-gateway while setting up the isolated worker stack.
- Do not print or commit secrets. Deploy only with authorized protected environments, and verify actual health, offline handoff, and rollback.

## Completion criteria
- CI green, live target host verified, health checks green, PC offline failover tested, result persisted, and no duplicate execution observed.
- When a step cannot be completed because no authorized server connector exists, record the exact blocking capability; do not imply completion.

## Evidence-qualified status codes and AI learning (owner directive, 2026-10-10)
Use a stable **stage + evidence** code before every lifecycle status in logs, AI Core/OpenClaw replies, WhatsApp, Workspace, and ChatGPT reports. An unqualified `COMPLETED` is never sufficient proof of delivery or acceptance. Existing DB statuses may remain unchanged for backward compatibility; do not silently redefine them or claim the UI/backend enforces these labels without implementation.

| Code | Meaning | Minimum proof |
| --- | --- | --- |
| `CMD_RECEIVED` | Command accepted | Durable command ID |
| `CMD_ACK` | Queued/acknowledged | Queue receipt; NOT execution |
| `JOB_CLAIMED` | Worker accepted lease | command ID, assigned worker ID, claim timestamp |
| `JOB_RUNNING` | Work execution in progress | Worker heartbeat/progress |
| `JOB_COMPLETED` | Worker process finished | Exit result; NOT output validation, delivery, or deployment |
| `RESULT_VERIFIED` | Requested outcome validated | Target-specific expected outputs, exit code, independent verification |
| `DELIVERY_SUBMITTED` | Delivery attempted/submitted | Transport or browser submission receipt; NOT arrival |
| `DELIVERY_CONFIRMED` | Message arrived at destination | Correlated delivery receipt / destination observation |
| `CALLBACK_RECEIVED` | Authenticated callback ingested | Correlated inbound callback event |
| `E2E_VERIFIED` | Full round trip verified | Matching command ID, worker, result, destination receipt, callback and correlation ID |
| `MERGED_VERIFIED` | Code merged | PR merge commit and branch |
| `DEPLOYED_VERIFIED` | Production deployed | Successful deployment run and target/build identity |
| `BLOCKED`, `FAILED`, `TIMED_OUT`, `CANCELLED` | Distinct terminal / waiting outcomes | Concrete stage, cause, and recovery owner |
| `NEEDS_HUMAN_APPROVAL` | Critical approval genuinely required | Exact critical action and approval scope |
| `UNKNOWN_UNVERIFIED` | Evidence missing/contradictory | Missing receipt or unresolved discrepancy |

### Ambiguous command vocabulary
- `cek/periksa` = inspect/read-only; never assume authority to mutate.
- `uji/test` = test-only, bounded and non-destructive unless scope explicitly authorizes side effects.
- `perbaiki` = fix the evidenced defect with approved scope and CI/security gates; not blanket authorization for unrelated production actions.
- `lanjut` = continue the last explicitly authorized task, not a new unrestricted task.
- `selesai/berhasil/completed` = **ask what stage?** Report the precise code above; a completed worker subprocess is not a completed business workflow.
- `sudah dikirim` = `DELIVERY_SUBMITTED` unless independently acknowledged at destination.
- `sudah diterima` = `DELIVERY_CONFIRMED` only with a correlated receipt, never based solely on a model's narrative.
- `aktif/online` = heartbeat or process liveness only; not proof queue claims or end-to-end success.
- `siap/review/approval` = differentiate technical readiness from a true human-critical gate.
- `merge/deploy` = separate actions and proofs; green CI alone does not mean deployed.

### Learning and correction protocol
For every false positive, ambiguity, or failed E2E, record a safe, redacted structured case: `caseId`, `commandId`, intended task/stage, observed code, expected code, evidence reference, root cause (or unknown), fix PR, CI, production verification and regression-test reference. Mark `LEARNING_CANDIDATE` until an authorized maintainer verifies the correction; only then mark `LEARNING_VERIFIED`. Feed verified cases into deterministic checks, test fixtures and agent reference documents. Do NOT train/fine-tune models automatically from unverified agent outputs, private tokens, or sensitive transcripts. Use idempotency and correlation IDs to suppress duplicates.

**Known case:** A browser agent returned `browserConfirmed: true` and the queue recorded `COMPLETED` while `sourceReplyDeliveryState: missing` and `replayInvalid: true`. Classify it as `JOB_COMPLETED + UNKNOWN_UNVERIFIED`, not `DELIVERY_CONFIRMED` or `E2E_VERIFIED`. Require a real destination receipt and callback before claiming full success.
