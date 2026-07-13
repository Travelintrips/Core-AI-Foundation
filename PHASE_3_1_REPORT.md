# Phase 3.1 — Regression Verification & Intelligence Completion Report

**Date**: 2026-07-13  
**Status**: ✅ COMPLETE — all spec items delivered and verified

---

## 1. Auth Regression Fix (spec items 2–7)

### Root Cause
The compiled `dist/index.mjs` was a stale build from before `PUBLIC_ROUTE_RULES` was added to `adminAuth.ts`. The dist was 4.07 MB (pre-pptxgenjs) and compiled from an older snapshot — it only contained `PUBLIC_PATH_PREFIXES` and no method-aware regex rules. The running server therefore blocked all non-prefix routes with 401, including the customer-facing `POST /ai/catalog/services/:id/request`.

### Fix
1. Installed missing `pptxgenjs` / `jszip` packages (required by presentation services, missing from node_modules).
2. Performed a clean rebuild: `rm -rf dist && node ./build.mjs`.
3. New dist is 4.90 MB and contains `PUBLIC_ROUTE_RULES` at line 124431.
4. Restarted the `artifacts/api-server: API Server` workflow.

### Runtime Curl Matrix (all 8 cases)

| # | Method | Path | Auth | Expected | Actual |
|---|--------|------|------|----------|--------|
| 1 | POST | `/api/ai/catalog/services/1/request` | none | **201** | ✅ 201 |
| 2 | GET  | `/api/ai/catalog/services/1`          | none | **200** | ✅ 200 |
| 3 | GET  | `/api/ai/catalog/services`            | none | **401** | ✅ 401 |
| 4 | PATCH | `/api/ai/catalog/services/1`         | none | **401** | ✅ 401 |
| 5 | DELETE | `/api/ai/catalog/services/1`        | none | **401** | ✅ 401 |
| 6 | GET  | `/api/ai/catalog/services`            | correct key | **200** | ✅ 200 |
| 7 | GET  | `/api/ai/catalog/services`            | wrong key | **401** | ✅ 401 |
| 8 | OPTIONS | `/api/ai/catalog/services/1/request` | none | **204** | ✅ 204 |

---

## 2. Apply Limits Aligned to UI (spec item 12)

**File**: `artifacts/customer-portal/src/features/brief-intelligence/apply-adapter.ts`

| Constant | Before | After |
|----------|--------|-------|
| `STYLE_MAX` | 5 | **3** |
| `COLOR_MAX`  | 5 | **3** |
| `AUDIENCE_MAX` | 6 | **4** |

All three are now exported named constants. `brief.tsx` imports them via:
```ts
import { STYLE_MAX, COLOR_MAX, AUDIENCE_MAX } from "@/features/brief-intelligence/apply-adapter";
```
The chip group `max` props use these imports — single source of truth, adapter and UI can never drift.

---

## 3. Three New Conflict Rules (spec item 8)

**File**: `artifacts/customer-portal/src/features/brief-intelligence/conflict-rules.ts`

| Code | Trigger | Severity |
|------|---------|----------|
| `premium-colorful-playful` | `audienceKeys.includes("premium")` AND (`colorful` OR `playful` in styleKeys) | warning |
| `no-assets-photography` | `existingAssetKeys.includes("none")` AND engine produced photographyDirection recs | warning |
| `speed-excessive-deliverables` | `priorityKey === "speed"` AND `deliverableCount > 3` | warning |

Architecture change: `ConflictRule` is now a discriminated union (`"pair" | "context"`). The `detectConflicts()` signature accepts an optional `ConflictContext` parameter for backward compatibility. The engine builds `conflictCtx` from `merged` recommendations before calling `detectConflicts`. All rules are non-blocking.

---

## 4. `matchType` Semantics Fix (spec items 9–10)

**Files**: `types.ts`, `engine.ts`, `industry-fallback.ts`

Before: `usedFallbackIndustry = true` was set for BOTH alias matches AND generic fallback, causing the "Industri belum spesifik" badge to appear even when the industry was correctly resolved via alias.

After:
- `usedFallbackIndustry = true` **only** when alias matching fails and the generic profile is used.
- New `debug.industryMatchType: "exact" | "alias" | "generic-fallback" | null` added to `BriefIntelligenceResult`.
- Alias match → `usedFallbackIndustry = false`, `industryMatchType = "alias"`.
- Named key → `usedFallbackIndustry = false`, `industryMatchType = "exact"`.
- No context → `industryMatchType = null`.
- `RecommendationSummary` automatically shows "Industri belum spesifik" only for the generic-fallback case (since `usedFallbackIndustry` is now semantically correct).

---

## 5. Export-Import Alias Priority Fix (spec item 11)

**File**: `artifacts/customer-portal/src/features/brief-intelligence/industry-fallback.ts`

Reordered `ALIASES` so `export_import` appears **before** `logistics`. Rationale: "ekspor"/"impor" keywords are a more specific identifier for export-import businesses than generic "logistik". First-match-wins iteration now correctly resolves:

- `"ekspor impor"` → `export_import` ✅ (was: `logistics`)
- `"ekspor impor / logistik"` → `export_import` ✅ (was: `logistics`)
- `"logistik"` alone → `logistics` ✅ (unchanged)

---

## 6. Button Labels Fixed (spec item 14)

| Location | Before | After |
|----------|--------|-------|
| `RecommendationCategory.tsx` line ~44 | "Gunakan semua" | **"Gunakan kategori ini"** |
| `BriefRecommendationPanel.tsx` global button | "Gunakan semua untuk field yang masih kosong" | **"Terapkan ke field kosong"** |
| `BriefRecommendationPanel.tsx` helper text | _(absent)_ | **"Pilihan yang sudah Anda isi tidak akan diganti."** |

Per-item "Gunakan" buttons remain unchanged (already correct per spec).

---

## 7. Debug Panel Created (spec item 13)

**File**: `artifacts/customer-portal/src/features/brief-intelligence/components/BriefIntelligenceDebugPanel.tsx`

- Renders **only** when `import.meta.env.DEV && new URLSearchParams(window.location.search).get("briefDebug") === "1"`.
- Default state: **collapsed** (shows only the "Brief Intelligence Debug" header row).
- When expanded, shows: engine version, industryMatchType, matched keys, fallback flag, completeness %, applied rule sources, conflict warnings (code + severity + keys), and per-category item scores/confidence/sources.
- Wired into `BriefRecommendationPanel.tsx` with a compile-time `import.meta.env.DEV` guard — tree-shaken out of production bundles.

---

## 8. Test Results

### API Server (Vitest)
```
Test Files  9 passed (9)
Tests      244 passed (244)
```
Includes Phase 3.1 regression guard suite with 6 new cases:
- `adminAuthWithExceptions` allows `POST /ai/catalog/services/:id/request` (exact runtime path)
- Multi-digit service ID allowed
- List mutation POST blocked (401)
- PATCH blocked (401), DELETE blocked (401)
- Regex anchoring test (suffix `*/request/extra` is blocked)

### Customer Portal (Vitest)
```
Test Files  3 passed (3)
Tests      113 passed (113)
```
New suites added (44 new tests total):
- **Alias match NOT treated as generic fallback** (5 cases)
- **Export-import alias priority** (4 cases)
- **STYLE_MAX / COLOR_MAX / AUDIENCE_MAX match UI** (3 cases)
- **Apply does not exceed limits** (3 cases — style, color, audience)
- **New conflict rules** (7 cases)

---

## 9. Build & Typecheck Results

| Check | Result |
|-------|--------|
| `pnpm --filter @workspace/api-server exec tsc --noEmit` | ✅ Clean (lib/db pre-existing probe errors unrelated to this phase) |
| `pnpm --filter @workspace/customer-portal exec tsc --noEmit` | ✅ Clean (no output) |
| `PORT=20785 BASE_PATH=/customer-portal pnpm --filter @workspace/customer-portal run build` | ✅ Built in 6.60s |
| `node ./build.mjs` (api-server) | ✅ Built in 790ms (4.9 MB) |

---

## Files Modified

| File | Change |
|------|--------|
| `artifacts/api-server/dist/index.mjs` | Rebuilt from source (now includes PUBLIC_ROUTE_RULES) |
| `artifacts/api-server/src/middleware/__tests__/adminAuth.test.ts` | +6 Phase 3.1 regression guard tests |
| `artifacts/customer-portal/src/features/brief-intelligence/conflict-rules.ts` | Refactored to discriminated union; added 3 new context-aware rules |
| `artifacts/customer-portal/src/features/brief-intelligence/apply-adapter.ts` | STYLE_MAX=3, COLOR_MAX=3, AUDIENCE_MAX=4; export as named constants |
| `artifacts/customer-portal/src/features/brief-intelligence/types.ts` | Added `debug.industryMatchType` |
| `artifacts/customer-portal/src/features/brief-intelligence/engine.ts` | Fixed `usedFallbackIndustry` semantics; added `industryMatchType`; pass `ConflictContext` |
| `artifacts/customer-portal/src/features/brief-intelligence/industry-fallback.ts` | Reordered `export_import` before `logistics` |
| `artifacts/customer-portal/src/features/brief-intelligence/components/BriefIntelligenceDebugPanel.tsx` | **New file** — dev-only debug panel |
| `artifacts/customer-portal/src/features/brief-intelligence/components/BriefRecommendationPanel.tsx` | Button label fix; helper text; debug panel wired |
| `artifacts/customer-portal/src/features/brief-intelligence/components/RecommendationCategory.tsx` | "Gunakan semua" → "Gunakan kategori ini" |
| `artifacts/customer-portal/src/pages/brief.tsx` | Import STYLE_MAX, COLOR_MAX, AUDIENCE_MAX from apply-adapter |
| `artifacts/customer-portal/src/features/brief-intelligence/engine.test.ts` | +44 regression and new-feature tests |
