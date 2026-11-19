# AI Core / OpenClaw assistance contract

Purpose: ChatGPT owns coding tasks initiated in ChatGPT unless the owner explicitly delegates or transfers a job. AI Core may delegate authorized coding and non-coding continuation work to OpenClaw over the existing authenticated HTTP bridge using HANDSHAKE_CONTINUE, carrying the stable job ID, correlation ID, next step and Resource-First, Human-Last SOP. Coding initiated directly in authenticated AI Core Chat remains owned by AI Core. Delegation does not bypass worker scope, approval, CI or production gates.

## Command contract
Each request carries `commandId`, `sessionId`, `origin`, `targetDevice`, `operation`, `args`, `requestedScopes`, `expiresAt`, and `idempotencyKey`. Reject missing or expired IDs. Allow only known operations and explicit target devices. Do not treat free-form text as shell commands.

## Access and safety
- Use existing authorized OpenClaw device identity and scoped GitHub App credentials; never forward secrets to chat or logs.
- Permit read-only PC/GitHub inspection by default. Source edits, merges, deploys, privilege changes, destructive actions and credential changes must pass the existing policy gates and authorization.
- Do not bypass platform safety blocks, security approval gates, or user permissions.
- Apply per-command timeouts, allowlists, least privilege, audit logging and replay protection.

## Required callback evidence
Return `commandId`, `sessionId`, `workerId`, `startedAt`, `finishedAt`, `status`, `exitCode`, `stdoutDigest`, `auditId`, and `ackId`. A model-only answer or queued command is not evidence of execution. Persist terminal callback and delivery ACK. Correlate with the originating session.

## E2E acceptance
1. Dispatch read-only request to Travelintrips OpenClaw worker.
2. Confirm the device executed it and returned real output.
3. Verify correlation IDs and durable callback ACK.
4. Confirm denied operation is blocked and audited.
5. Do not report VERIFIED SUCCESS until every assertion passes.

This contract is a configuration specification; implementation and deployment are separate tasks.
