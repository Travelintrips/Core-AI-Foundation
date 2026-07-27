# Production Smoke Test Checklist
## Core AI Foundation — material-v5.0.0

**Environment:** Production (`https://aicore.cstlogistic.co.id`)
**Release:** `material-v5.0.0` (commit `b5335e3`)
**Prepared:** 2026-07-27
**Executed by:** _______________
**Execution date:** _______________

> **Instructions:**
> - Mark each item: ✅ PASS / ❌ FAIL / ⚠️ UNKNOWN
> - Do not mark UNKNOWN items as PASS
> - Record exact observed result — do not paraphrase
> - Stop and escalate on any FAIL in a Critical section

---

## Section 1 — Infrastructure

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 1.1 | GET `/api/healthz` | HTTP 200 | — | ⚠️ UNKNOWN — production not deployed |
| 1.2 | GET `/api/healthz/full` | `{"database":"ok","schema":"ok","environment":"ok"}` | — | ⚠️ UNKNOWN |
| 1.3 | Scheduler startup log | `[scheduler] Started` in logs | — | ⚠️ UNKNOWN |
| 1.4 | Worker cluster startup | 3 workers registered (dispatcher-1/2/3) | — | ⚠️ UNKNOWN |
| 1.5 | Dispatcher running | `[dispatcher] Started` in logs | — | ⚠️ UNKNOWN |
| 1.6 | Supabase storage bucket | `ai-assets` bucket exists and accessible | — | ⚠️ UNKNOWN |

---

## Section 2 — Authentication & Authorization

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 2.1 | GET `/api/internal/auth/me` (no credentials) | HTTP 401 | — | ⚠️ UNKNOWN |
| 2.2 | POST `/api/internal/auth/login` (valid credentials) | HTTP 200, session cookie set | — | ⚠️ UNKNOWN |
| 2.3 | GET `/api/internal/auth/me` (with valid session) | HTTP 200, user object returned | — | ⚠️ UNKNOWN |
| 2.4 | Admin API endpoint without `x-admin-api-key` header | HTTP 401 | — | ⚠️ UNKNOWN |
| 2.5 | Admin API endpoint with correct `ADMIN_API_KEY` | HTTP 200 | — | ⚠️ UNKNOWN |
| 2.6 | Customer workspace with invalid token | HTTP 404 | — | ⚠️ UNKNOWN |
| 2.7 | Customer workspace with valid token | HTTP 200, workspace data returned | — | ⚠️ UNKNOWN |

---

## Section 3 — Public Catalog

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 3.1 | GET `/api/ai/catalog/public` | HTTP 200, ≥ 3 categories, ≥ 38 services | — | ⚠️ UNKNOWN |
| 3.2 | Customer portal home page renders | HTTP 200, "Creative Studio" in body | — | ⚠️ UNKNOWN |
| 3.3 | Admin portal sign-in page renders | HTTP 200, sign-in form present | — | ⚠️ UNKNOWN |

---

## Section 4 — Material Search (Admin)

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 4.1 | POST `/api/material-library/search` `{"query":"marble"}` | HTTP 200, results array with ≥ 1 item | — | ⚠️ UNKNOWN |
| 4.2 | POST `/api/material-library/search` `{"query":"marmer"}` (Indonesian alias) | HTTP 200, resolves to marble results | — | ⚠️ UNKNOWN |
| 4.3 | POST `/api/material-library/search` `{"query":"zzzznotfound"}` | HTTP 200, empty results array | — | ⚠️ UNKNOWN |
| 4.4 | GET `/api/material-library/categories` | HTTP 200, 13 categories returned | — | ⚠️ UNKNOWN |
| 4.5 | GET `/api/material-library/brands` | HTTP 200, brand list returned | — | ⚠️ UNKNOWN |
| 4.6 | GET `/api/material-library/:id/similar` (valid material ID) | HTTP 200, similar materials array | — | ⚠️ UNKNOWN |

---

## Section 5 — Material Import (Admin)

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 5.1 | GET `/api/ai/material-import/dashboard` | HTTP 200, import statistics | — | ⚠️ UNKNOWN |
| 5.2 | GET `/api/ai/material-import/staged` | HTTP 200, staged records list (5 imported, 1 rejected in dev) | — | ⚠️ UNKNOWN |
| 5.3 | Admin review queue page loads in admin portal | Page renders with staged records table | — | ⚠️ UNKNOWN |
| 5.4 | Unauthenticated access to import dashboard | HTTP 401 | — | ⚠️ UNKNOWN |

---

## Section 6 — Duplicate Resolution

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 6.1 | `keep_existing` resolution path available in review UI | Option present in review UI | — | ⚠️ UNKNOWN |
| 6.2 | `replace_existing` resolution path available | Option present in review UI | — | ⚠️ UNKNOWN |
| 6.3 | `merge` resolution path available | Option present with field-level diff | — | ⚠️ UNKNOWN |
| 6.4 | `create_new` resolution path available | Option present in review UI | — | ⚠️ UNKNOWN |
| 6.5 | POST `/api/ai/material-import/review` with valid payload | HTTP 200, staging record status updated | — | ⚠️ UNKNOWN |

---

## Section 7 — Asset Upload

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 7.1 | Supabase `ai-assets` bucket accessible (production) | Bucket exists, write test succeeds | — | ⚠️ UNKNOWN |
| 7.2 | Asset URL in staged record resolves (HTTP 200) | Asset URL is reachable | — | ⚠️ UNKNOWN |
| 7.3 | SSRF guard — URL with private IP rejected | HTTP 400 / validation error | — | ⚠️ UNKNOWN |

---

## Section 8 — Audit Trail

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 8.1 | `material_import_audit` table populated | Rows present for completed import actions | — | ⚠️ UNKNOWN |
| 8.2 | Audit record contains reviewer identity | `reviewer_id` / `editor_id` field populated | — | ⚠️ UNKNOWN |
| 8.3 | Audit record contains timestamp | `created_at` / `actioned_at` present | — | ⚠️ UNKNOWN |
| 8.4 | Audit log is append-only (no delete endpoint) | No DELETE route exists for audit records | — | ⚠️ UNKNOWN |

---

## Section 9 — Material Intelligence

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 9.1 | Material suggestion endpoint returns results | POST `/api/material-library/suggestions` → ≥ 1 result | — | ⚠️ UNKNOWN |
| 9.2 | Feature flag status | `DESIGN_AI_MULTI_AGENT_ENABLED` — confirm value in production | — | ⚠️ UNKNOWN |
| 9.3 | Analytics endpoint (admin) | GET `/api/material-library/analytics` → HTTP 200 | — | ⚠️ UNKNOWN |
| 9.4 | Cold search latency | First request < 200 ms | — | ⚠️ UNKNOWN |

---

## Section 10 — Scheduler & Workers

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 10.1 | AI Queue Center accessible in admin portal | Page loads, dispatcher status shown | — | ⚠️ UNKNOWN |
| 10.2 | Dispatcher running | Status: Running | — | ⚠️ UNKNOWN |
| 10.3 | Worker count | 3 workers online (dispatcher-1/2/3) | — | ⚠️ UNKNOWN |
| 10.4 | No stuck jobs in `running` state | 0 jobs with status=running and age > 30 min | — | ⚠️ UNKNOWN |
| 10.5 | Failed job count | 0 failed jobs (or known/expected failures documented) | — | ⚠️ UNKNOWN |

---

## Section 11 — AI Provider Health

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 11.1 | OpenAI provider health | No 401 errors in health-alerts log | — | ⚠️ UNKNOWN |
| 11.2 | Anthropic provider health | No 401/auth errors in logs | — | ⚠️ UNKNOWN |
| 11.3 | Gemini provider health | No auth errors in logs | — | ⚠️ UNKNOWN |
| 11.4 | Provider registry accessible | GET `/api/ai/providers` → HTTP 200 | — | ⚠️ UNKNOWN |

---

## Section 12 — Rollback Verification

| # | Test | Expected Result | Observed Result | Status |
|---|---|---|---|---|
| 12.1 | PITR enabled on production Supabase | Dashboard confirms PITR active | — | ⚠️ UNKNOWN |
| 12.2 | Pre-migration row counts documented | `docs/audits/migration-*-result.md` exists | — | ⚠️ UNKNOWN |
| 12.3 | Rollback engineer identified | Name: _______________ | — | ⚠️ UNKNOWN |
| 12.4 | Rollback DDL reviewed | See `docs/production-migration-runbook.md` Section 9 | — | ⚠️ UNKNOWN |

---

## Summary

**Total tests:** 48
**PASS:** 0
**FAIL:** 0
**UNKNOWN:** 48 (production not deployed at time of preparation)

**Overall status:** ⚠️ CANNOT EXECUTE — production deployment is not registered. All items are UNKNOWN pending active deployment.

**Prerequisite:** Register Replit production deployment for `aicore.cstlogistic.co.id` before executing this checklist.

**Prepared by:** Engineering Team
**Execution date:** _______________ (to be completed after deployment registration)
