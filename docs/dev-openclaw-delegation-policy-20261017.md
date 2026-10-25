# DEV-only OpenClaw delegated execution policy
Status: authorized delegation policy; enforce access controls in underlying services; this document does not grant credentials.
Primary executor: OpenClaw Dell via AI Core. Fallback: OpenClaw Z Fold4 only after live device pairing and health verification.
Target: Travelintrips/Core-AI-Foundation Issue #1318 and PR #1319. Scope restricted to DEV.
ALLOW without repeated human prompts: read-only diagnosis, log inspection, GitHub DEV branches/PRs, CI, isolated tests, post-CI DEV release that stays within existing scoped credentials and passes gates, non-destructive recovery.
CONDITIONAL: narrow DEV database migrations require reviewed migration and owner-scoped policy and passing negative tests; preserve least privilege, RLS, and rollback.
REQUIRE direct human approval: PROD changes, secrets rotation or disclosure, IAM escalation, security gate bypass, deletion of non-test data, external account OAuth approval, device pairing requiring user confirmation, irreversible actions.
No automatic approval of OS or provider security prompts. Never use an agent to simulate human approval or circumvent access controls.
Report only verified job completed / full channel read and ACK; callback into ChatGPT browser session is a separate gate and cannot be assumed.
Every job: include request ID, actor, DEV environment, GitHub SHA, timestamp, action, result, links to CI and evidence; retry transient failures with capped attempts; on failures use Resource-First SOP; escalate only genuine blocked approvals.
Guardrails: PROD remains untouched; no blanket GRANT, no BYPASSRLS, no hard-coded credentials; no worker coding via AI Core, code changes via GitHub.
Deployment state is not considered ACTIVE until actual orchestration, device-specific authorizations, callback transport, and E2E tests verify it.