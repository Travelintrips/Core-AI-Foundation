# DEV Control Center — phase 2 integration gates

The control plane module is NOT mounted to the production Express app. It requires a separately verified authentication provider, adapter, audit sink, and environment identity config.

## Controls implemented in isolated module
- Verified-session principal dependency, required role checks, CSRF token check, no-store headers.
- Read-only jobs + bounded events retrieval through injected adapter.
- Stop/restart/retry return **REQUESTED_NOT_COMPLETED**, with idempotency keys, and require a real adapter and audit sink.
- Production approval checks exact commit SHA, explicit confirmation, permission, independent DEV/PROD identity assertions, all required CI/security/target gates.
- Approval is persisted via adapter but does NOT trigger deployment. Requires separate gated release workflow.
- No credentials in frontend, no pretend worker completion, no automatically enabled controls.

## Remaining blockers before live
1. Confirm concrete auth middleware/session and attach `getPrincipal` to authenticated user with CSRF binding.
2. Bind adapter methods to AI Task/AI Core APIs; verify actual job correlation and worker event streaming.
3. Implement durable idempotency for job actions and approvals in backend; production-grade authorization per project, rate limiting, event/message secret redaction, and audited transaction semantics.
4. Discover and independently verify separate database IDs, credential IDs, namespace and storage bucket values from actual DEV and PROD infrastructure. Static config alone is insufficient.
5. Mount behind secured routes only after negative-case security tests and full CI.
6. Configure domain DNS/TLS and private ingress separately. No live DNS or production writes are part of this PR.

## Test
`node --test dev-control-center/control-plane.test.mjs` in a pnpm workspace with express installed/resolved for this module. CI may require separate module resolution configuration since this directory is not part of existing pnpm package workspaces.
