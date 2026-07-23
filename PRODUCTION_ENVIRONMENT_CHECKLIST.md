# PRODUCTION_ENVIRONMENT_CHECKLIST.md

> Branch: production-readiness-remediation  
> Date: 2026-07-23  
> Status: Pre-staging — **do not promote to production until all REQUIRED items are ✅**

---

## Legend
- ✅ PASS — verified in this remediation
- ⚠️  WARN — acceptable with documented risk
- ❌ FAIL — must be fixed before production
- 🔒 REQUIRED — blocking condition

---

## 1. Secrets & Credentials

| Check | Status | Notes |
|-------|--------|-------|
| All secrets stored in Replit Secrets (not `.replit`) | ❌ 🔒 | `.replit` tracked with plaintext — see ROTATION_REQUIRED.md |
| Old credentials rotated after git exposure | ❌ 🔒 | Must rotate all 13 sensitive credentials |
| SESSION_SECRET set as Replit Secret | ✅ | Confirmed via viewEnvVars |
| No secrets in test fixtures or logs | ✅ | Verified via git grep |
| ADMIN_API_KEY set for production | ⚠️ | Currently in `.replit` shared env — must move to Secret |

---

## 2. Database

| Check | Status | Notes |
|-------|--------|-------|
| SUPABASE_PROD_DATABASE_URL set | ⚠️ | Set in `.replit` [userenv.production] — move to Secret |
| Production DB startup guard active | ✅ | `index.ts` fails closed if prod URL missing |
| ai_platform schema exists in prod | ✅ | Verified via live health check (`/api/healthz/full` → 200) |
| All migration tables present | ✅ | Live catalog verified: 38 services, 3 categories |
| signed_url_revocations table | ⚠️ | New — runs `ensureRevocationTable()` on startup |
| No destructive migration executed | ✅ | Only additive DDL in this remediation |
| Drizzle-kit push disabled for production | ✅ | Using hand-written DDL (drizzle-push-false-positive documented) |

---

## 3. Dispatcher & Scheduler

| Check | Status | Notes |
|-------|--------|-------|
| AI_DISPATCHER_ENABLED=true set for production | 🔒 Required | Must be set in production env |
| AI_SCHEDULER_ENABLED=true set for production | 🔒 Required | Must be set in production env |
| Dispatcher starts exactly once (guard active) | ✅ | `_starting/_running` flags in jobDispatcherService.ts |
| Scheduler starts exactly once (guard active) | ✅ | `_starting/_running` flags in aiSchedulerService.ts |
| Graceful shutdown (SIGTERM/SIGINT) | ✅ | Both services shut down in index.ts signal handlers |
| Dispatcher dev-always-on (no env var needed) | ✅ | `NODE_ENV !== production` bypasses env check |
| Scheduler dev-always-on | ✅ | Same |

---

## 4. API Server

| Check | Status | Notes |
|-------|--------|-------|
| PORT environment variable injected | ✅ | Managed by artifact workflow |
| Startup fails if PORT missing | ✅ | Explicit throw in index.ts |
| Health endpoint responds 200 | ✅ | `/api/healthz` confirmed |
| Full health endpoint passes all checks | ✅ | `/api/healthz/full` → `{database: ok, schema: ok, environment: ok}` |
| Admin routes protected by ADMIN_API_KEY | ✅ | Global adminAuthWithExceptions middleware |
| CORS origins configured | ✅ | ALLOWED_ORIGINS set |
| Helmet security headers active | ✅ | Applied in app.ts |
| Rate limiting active | ✅ | Applied in app.ts |
| SSRF guard on webhook/notification URLs | ✅ | Implemented per P0 sprint |

---

## 5. Signed URL & File Access

| Check | Status | Notes |
|-------|--------|-------|
| Signed URL generation uses HMAC-SHA256 | ✅ | signedUrlService.ts |
| Token includes expiry (default 1h) | ✅ | `exp` field in payload |
| Revocation survives process restart | ✅ (remediation) | signedUrlRevocationStore.ts adds DB persistence |
| Plaintext token never persisted to DB | ✅ | Only token_id (random nonce) stored, not full token |
| Duplicate revoke idempotent | ✅ | ON CONFLICT DO NOTHING in DB |

---

## 6. Tenant Isolation

| Check | Status | Notes |
|-------|--------|-------|
| RequestContext resolves tenant server-side | ✅ | security/tenantResolution.ts |
| Client-supplied tenantId rejected on mismatch | ✅ | Logged + blocked (tenant_mismatch_blocked) |
| creative_projects tenant_id column | ⚠️ | Column missing — scoped by projectId UUID only (capability token pattern) |
| All service_requests tenant-scoped | ✅ | Customer profile → tenant_id join |
| ai_quotations tenant-scoped | ✅ | Via service request join |

---

## 7. Email / SMTP

| Check | Status | Notes |
|-------|--------|-------|
| SMTP config from environment only | ✅ | emailService.ts reads env vars |
| No SMTP password in logs | ✅ | Only host/port/user logged |
| SMTP diagnostic endpoint available | ✅ (remediation) | GET /api/ai/admin/smtp/diagnostic |
| No customer email sent during tests | ✅ | emailService mocked in all tests |

---

## 8. Performance

| Check | Status | Notes |
|-------|--------|-------|
| In-memory cache size bounded | ✅ | cacheMaxBytes=100MB in design-renderer config |
| Asset scan limit enforced | ✅ | DUPLICATE_CANDIDATE_LIMIT prevents table scans |
| Remote asset download size bounded | ✅ | maxRemoteAssetBytes=10MB |

---

## 9. Payment Scope

| Check | Status | Notes |
|-------|--------|-------|
| No automated payment gateway code | ✅ | Midtrans/Xendit/Paylabs: no code found |
| Manual payment flow unchanged | ✅ | No modifications to payment routes |

**AUTOMATED PAYMENT GATEWAY EXCLUDED FROM SCOPE BY PRODUCT DECISION.**

---

## 10. Build & Deploy

| Check | Status | Notes |
|-------|--------|-------|
| pnpm install succeeds | ✅ | 784 packages resolved |
| lib/db typecheck clean | ✅ | tsc --build passes |
| API server build (esbuild) succeeds | ✅ | 7.6MB bundle, no errors |
| No migration executed at build time | ✅ | `ensureTable()` runs at runtime only |
| No secrets embedded in bundle | ✅ | Env vars read at runtime via process.env |

---

## Required Actions Before Production Promotion

1. ❌ Rotate all 13 credentials listed in ROTATION_REQUIRED.md
2. ❌ Store new values in Replit Secrets (not `.replit`)
3. ❌ Set `AI_DISPATCHER_ENABLED=true` in production environment
4. ❌ Set `AI_SCHEDULER_ENABLED=true` in production environment
5. ❌ Run `ensureRevocationTable()` migration on production DB (auto on first startup)
6. ⚠️  Consider `tenant_id` backfill for creative_projects if multi-tenant isolation is required
