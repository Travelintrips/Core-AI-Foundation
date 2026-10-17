# DEV MCP coding-task write authorization

Issue: #1318. This file is a security-gated implementation plan, NOT an executable migration.

## Verified DEV database state
- ai_platform.ai_coding_tasks and ai_platform.ai_coding_runs: RLS enabled.
- aicore_dev_runtime has SELECT but lacks INSERT and UPDATE table privileges.
- Existing role-specific UPDATE policies use USING(true) WITH CHECK(true).
- AI Core startAgentTask() inserts coding tasks and runs and updates task status.

## Safe implementation prerequisites
1. Derive principal and OAuth event channel ONLY from validated MCP OAuth identity, not from client-provided conversationId.
2. Introduce task ownership or a scoped command-to-task association. Store identity and scope with each new task and run.
3. For task creation, validate the repository/branch allowed by the DEV role and use server-side checks. Prefer a narrowly scoped database function or dedicated service to broad table grants.
4. Replace permissive UPDATE policies. Enforce ownership in USING and WITH CHECK, including operations by background workers with separately scoped identities.
5. Permit the minimum necessary INSERT/UPDATE columns only after corresponding RLS policies and application propagation are available. Do not grant database role ownership, BYPASSRLS, or blanket schema access.
6. Test: authorized task/run creation; other-principal read/update denied; anonymous/unbound creation denied; non-DEV repository/branch denied; legitimate worker completion succeeds; rollback on partial failure; no PROD access.
7. Deploy DEV application and migration as one gated release and observe exact errors; run bounded terminal DEV event -> MCP read -> MCP ACK, record durable proof.

## Important scope clarification
The four startup failures concerning ai_jobs, ai_workers, ai_settings, design_render_items are not evidence that all four are part of the MCP command HTTP 503. Diagnose the failing route separately.
