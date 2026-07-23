# BASELINE_REPORT.md

> Branch: production-readiness-remediation  
> Base commit: b5f5c11 (main)  
> Date: 2026-07-23

---

## Test Baseline

| Metric | Value |
|--------|-------|
| Test files | 178 |
| Tests passed | 5,378 |
| Tests failed | 0 |
| Tests skipped | 0 |
| Duration | ~39.6s |
| Runner | vitest (pnpm --filter @workspace/api-server run test) |

Baseline confirmed by running `pnpm -r --if-present run test` on `b5f5c11` immediately after project import.

---

## TypeScript Baseline

| Metric | Value |
|--------|-------|
| lib/db typecheck | PASS (0 errors) |
| api-server typecheck (all files) | 125 pre-existing errors |
| Critical path errors (non-test files) | ~35 errors across 8 route/service files |
| Errors in test files only | ~90 errors |

### Pre-existing Critical Path Errors (baseline — not introduced by remediation)

| File | Error Type | Count |
|------|-----------|-------|
| `routes/creative-marketplace.ts` | `string \| string[]` not assignable to `string` | 19 |
| `routes/customs.ts` | TS7030 not all code paths return | 2 |
| `routes/asset-intelligence-v2/index.ts` | `string \| string[]` | 3 |
| `routes/asset-intelligence.ts` | `string \| string[]` | 1 |
| `routes/design-tokens/colorPalettesRouter.ts` | `string \| string[]` + type mismatch | 5 |
| `routes/design-tokens/fontPairsRouter.ts` | `string \| string[]` + type mismatch | 7 |
| `routes/dynamic-design-composer/index.ts` | `string \| string[]` | 1 |
| `domains/graphic-design/service.ts` | Missing required `tenantId` arg | 1 |
| `scripts/checkProdCategories.ts` | Cannot find module 'pg' | 1 |
| `scripts/fixMissingTables.ts` | Implicit any (pg) | 1 |

---

## Build Baseline

| Artifact | Status | Bundle Size |
|----------|--------|------------|
| lib/db | ✅ PASS | — |
| api-server (esbuild) | ✅ PASS | 7.6MB |
| ai-platform (vite dev) | ✅ PASS | — |
| customer-portal (vite dev) | ✅ PASS | — |
| cargo-finder (vite dev) | ✅ PASS | — |

---

## Runtime Baseline

All 5 workflow services running on branch creation:
- `artifacts/api-server: API Server` — port 8080, `/api/healthz` → 200 OK
- `artifacts/ai-platform: web` — port 20785, vite dev
- `artifacts/customer-portal: web` — port 23434, vite dev
- `artifacts/cargo-finder: web` — port 20404, vite dev
- `artifacts/mockup-sandbox: Component Preview Server` — port 8081, vite dev

---

## Security Baseline

| Item | Status |
|------|--------|
| `.replit` tracked with plaintext secrets | **EXPOSED** — 13 sensitive credentials |
| Secrets in test fixtures | Not found (only mock values like `sk-proj-secretkey123456`) |
| Secrets in reports | Not found |
| SESSION_SECRET | Properly in Replit Secrets ✅ |
