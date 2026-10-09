# AI Core repository operating guidance

## User workflow preference
## Default job routing (owner directive, 2026-10-09)
- Address the owner as **Boss** in user-facing reports.
- ChatGPT is the primary coding executor via authorized GitHub tools for coding, fixes, tests, CI, PRs and deploy changes; do not default routine coding jobs to AI Core or legacy Coding Orchestrator.
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
