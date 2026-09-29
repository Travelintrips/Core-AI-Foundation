# GitHub command trigger for AI Core

The AI Core Command Trigger workflow sends owner-authorized requests to the
existing AI Core coding API. It does not wake up an inactive ChatGPT conversation.

## Entry points

- workflow_dispatch: audit, submit, status, or stop.
- Owner-authored issue labeled ai-audit by the owner: read-only audit.
- Owner-authored issue labeled ai-task by the owner: bounded coding task.

Only Travelintrips on Travelintrips/Core-AI-Foundation may dispatch. Instructions
are JSON data, not shell commands. Third-party issues cannot start tasks.
The assistant can invoke this through the authenticated GitHub CLI; the owner
does not need to perform manual Git operations.

## Safety and authentication

Uses the existing ADMIN_API_KEY secret and production environment. No credential
is copied to source or printed. The API origin is fixed and redirects refused.
Full health and coding runtime readiness must pass before submission. A degraded
database or missing dependency blocks task creation. Default budget: 5 cycles;
maximum: 20. This bounds cycles, not currency cost; model budgets remain server-side.
A stable request_id reuses tasks; POST mutations are never automatically retried.
Existing autonomous tasks are not restarted or given fresh budgets by reruns.
Inspect status after an ambiguous network failure instead of blindly resubmitting.

Commit, push and PR are delegated to the existing autonomous runtime. Existing
merge and production approval gates remain enabled. Acceptance is not completion.
The workflow never calls approve-merge, force-pushes, or deploys directly.

## Direct assistant delivery

Use an isolated worktree, stage only task files, commit, push, create a PR, inspect
all CI checks, then merge only when authorized and green. Never reset unrelated
local changes. Existing CI Verify runs on PRs and main pushes. Hostinger performs
native deployment; Hostinger Production Verify checks the deployed commit.

## Verification

Run node --test scripts/ai-core-command.test.mjs. Tests cover authorization,
input bounds, read-only audits, readiness guards, idempotency, repository scope,
JSON transport, redirect refusal and no automatic mutation retries.
After merge, dispatch audit and label an owner-authored issue ai-audit to verify
the event path without starting a coding job. A successful audit run can still
report BLOCKED_RUNTIME_NOT_READY: inspect the JSON result, not only the run color.
