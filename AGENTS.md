# AI Core repository operating guidance

## User workflow preference
- Execute authorized work directly whenever the available GitHub, AI Core, terminal, or deployment tools permit it.
- Do not interrupt with routine confirmation or repeated questions. Ask the owner only for an unavoidable missing permission, credential setup, or decision that materially blocks safe execution.
- Escalate coding or infrastructure work to AI Core through an authenticated, available integration when appropriate. A GitHub issue is a tracking artifact, **not** proof that AI Core received or executed an instruction.
- Prefer final outcome reports instead of frequent progress narration. Never report production deployment, a test pass, or automatic failover as complete without evidence.
- These instructions apply to repo-maintenance agents reading this file; they do not modify unrelated ChatGPT sessions automatically.

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
