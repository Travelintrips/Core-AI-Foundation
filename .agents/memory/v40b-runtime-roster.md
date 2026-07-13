---
name: V4.0B runtime roster verification
description: How the customer workspace runtime-roster feature is verified end to end, and environment gotchas that block its typecheck/build.
---

- Source of truth stays `creative_project_steps` (via `creativeWorkflowRunner`); `ai_employees`/`ai_departments` are metadata-enrichment only, joined by a hardcoded role-name → slug map. `ai_jobs`/`ai_workers`/dispatcher must stay unrelated/inactive for this feature.
- Ownership/tenant isolation is enforced by deriving `clientEmail` server-side from the hashed dashboard token, then filtering the project list by that email *before* the project-detail/runtime lookup ever sees `projectNumber` — never trust a client-supplied project id directly.
- `artifacts/api-server` typecheck depends on `lib/db`'s composite TS project being built (`npx tsc -b` from repo root) — its package.json has no `build` script and runtime resolution uses `src/index.ts` directly via package.json `exports`, so a stale/missing `lib/db/dist/*.d.ts` throws cascading TS6305 "not built from source" errors across nearly every service file that look unrelated to whatever you're actually changing. Rebuild project references first before trusting a large typecheck error list.
- No test runner existed in `api-server` (no vitest anywhere in the monorepo) — added a minimal `vitest` config there to unit-test read-only service logic (e.g. `runtimeRosterService`) by mocking `@workspace/db`'s chained query builder as a thenable object queue, since Drizzle's builder resolves lazily on `await`.
