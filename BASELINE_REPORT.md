# Production Readiness Remediation — Baseline Report

**Generated:** 2026-07-23  
**Branch:** fix/production-readiness-remediation  
**Parent branch:** main  
**HEAD commit (baseline):** b5f5c11 — "Add production readiness review board assignment document"  

---

## Git State

| Item | Value |
|---|---|
| Branch | fix/production-readiness-remediation |
| HEAD | b5f5c11 |
| Working tree | Clean (only untracked attached_assets/) |
| Merge conflicts | None |
| Detached HEAD | No |

---

## Test Baseline

| Suite | Status | Count |
|---|---|---|
| Full regression | PASS | 5,378 / 5,378 |
| Test files | PASS | 178 / 178 |

---

## Build Baseline

| Artifact | Status | Notes |
|---|---|---|
| lib/db (tsc -b) | PASS | EXIT:0 — types built correctly |
| API Server (esbuild) | PASS | dist/index.mjs 7.6MB, running on port 8080 |
| Admin Portal (Vite) | PASS | Running on port 20785 /admin/ |
| Customer Portal (Vite) | PASS | Running on port 23434 / |
| Cargo Finder (Vite) | PASS | Running on port 20404 /cargo-finder/ |

---

## TypeScript Error Baseline

| Scope | Count | Notes |
|---|---|---|
| Total (api-server) | 125 | Before lib/db build |
| Non-test, after lib/db tsc -b | 102 | Remaining genuine errors |
| Test files only | ~23 | Intentional comparison errors in test fixtures |

### Error clusters (non-test):
| Pattern | Files | Count (approx) |
|---|---|---|
| `string \| string[]` not assignable to `string` | creative-marketplace.ts, asset-intelligence.ts, design-tokens/* | ~30 |
| TS7030 Not all code paths return | customs.ts (2 handlers) | 2 |
| ClusterStatus.nodes unknown[] | workerClusterService.ts | 1 |
| Pool used as type | scripts/migrateSchemaToProd.ts | 6 |
| Cannot find module 'pg' | scripts/ utility files | 2 |
| graphic-design tenantId missing | domains/graphic-design/service.ts | 1 |

---

## Active Workflows

| Workflow | Status |
|---|---|
| artifacts/api-server: API Server | RUNNING |
| artifacts/ai-platform: web | RUNNING |
| artifacts/customer-portal: web | RUNNING |
| artifacts/cargo-finder: web | RUNNING |
| artifacts/mockup-sandbox: Component Preview Server | RUNNING |

---

## Known Blockers (from Audit)

| ID | Severity | Description |
|---|---|---|
| RB-001 | CRITICAL | AI_DISPATCHER_ENABLED + AI_SCHEDULER_ENABLED missing from production env → **FIXED in this remediation** |
| RB-002 | CRITICAL | API keys in plaintext in .replit → **ROTATION_REQUIRED.md created** |
| RB-003 | HIGH | No automated payment gateway → **OUT OF SCOPE (product decision)** |
| RB-004 | HIGH | 125 TS errors in critical paths → **Being remediated** |
