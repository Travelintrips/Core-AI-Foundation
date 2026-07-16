---
name: WP-12/13/14 Production Readiness
description: What was built, key invariants, and gotchas for the production readiness sprint.
---

## What was built (2026-07-14)

- **WP-12 RLS**: `scripts/migrations/rls-v12.sql` — Supabase RLS for tenant-scoped tables using `current_setting('app.current_tenant_id', true)`. Service-role bypasses RLS (BYPASSRLS); app-layer WP-00/01 is primary gate.
- **WP-12 Indexes**: `scripts/migrations/indexes-v12.sql` — 15 missing indexes on audit_logs, jobs, events, commercial_gates, etc. All `CREATE INDEX IF NOT EXISTS` — idempotent.
- **WP-12 Hardening**: `artifacts/api-server/src/middleware/securityHardening.ts` — 4 middleware: `blockUnknownMethods` (405), `addSecurityContext` (X-Request-Id + nosniff), `suspiciousRequestLogger` (log-only, no block), `requireJsonContentType` (415 for exotic types). Mounted in app.ts before rate limiter.
- **WP-13 Health**: `artifacts/api-server/src/routes/health.ts` — `/healthz` (liveness) + `/healthz/full` (readiness: DB + schema + env). Both mounted at `/api/healthz` and `/api/healthz/full`. Listed in adminAuth PUBLIC_PATH_PREFIXES.
- **WP-13 Metrics**: `artifacts/api-server/src/routes/metrics.ts` — `GET /ai/metrics` (admin protected) with JSON + `?format=prometheus`. Exports `requestCounterMiddleware` for request counting.
- **WP-13 Scripts**: `scripts/pre-deploy-check.sh` + `scripts/smoke-test.sh` (both chmod +x). Use `API_BASE_URL` + `ADMIN_API_KEY` env vars.
- **WP-14 Rollback**: `scripts/rollback-runbook.md` — decision matrix, checkpoint restore, RLS disable DDL, secrets rotation, post-rollback 10-point checklist.
- **WP-14 Tests**: 3 new test files, +34 tests. Final: 533/533 passing (26 files).

## Key invariants

- Health routes: live at `/api/healthz` and `/api/healthz/full`, NOT `/healthz` bare — mounted in routes/index.ts which is prefixed with `/api` in app.ts.
- Metrics route is at `/api/ai/metrics` — requires admin key (not in PUBLIC_PATH_PREFIXES).
- `requestCounterMiddleware` is mounted globally in app.ts (before rate limiter) so it counts all requests.
- RLS rollback: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` — does NOT drop policies; safe to re-enable later.
- `supertest` added as devDependency to api-server for the new test files.

**Why:**
- Production fail-closed for adminAuth was pre-existing and confirmed by new regression test — do not change the dev fail-open behaviour as it's intentional and documented.
- RLS uses `COALESCE(..., 'default')` so single-tenant setups (current state) work without any code changes — the default tenant slug is 'default'.
