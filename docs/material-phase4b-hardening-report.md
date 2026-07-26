# Material Phase 4B — Universal Catalog Import Hardening Report

**Date:** 2026-07-26  
**Branch:** `feature/material-phase4-universal-catalog-import`  
**Status:** ✅ All 4 deliverables complete

---

## 1. Root Cause Analysis

### Bug 1 — PDF Extraction Crash (`origPdfParse is not a function`)

**Root cause:** `pdf-parse` is declared as an esbuild external (loaded via CJS `require()` at runtime). When Node's module system wraps a CommonJS module for ESM consumption, the callable function sometimes lands on `mod.default` and sometimes on `mod` directly. The original code assumed `.default` always existed, so `pdfParseFn` was set to `undefined` when the module arrived bare — causing `TypeError: origPdfParse is not a function` on the first upload.

Additionally, the original `PdfTextExtractor` class used a module-level mutable accumulator (`_currentPages`) shared across all concurrent extractions — a thread-safety hazard.

**Fix applied:**
- CJS/ESM interop guard: `const fn = typeof _mod.default === "function" ? _mod.default : (_mod as unknown as PdfParseFn)`
- Replaced module-level accumulator with a closure-scoped `const pages: PageData[] = []` inside each `extract()` call
- Replaced monkey-patch prototype override pattern with a single clean class

### Bug 2 — 13 Missing Columns in `bulkInsertStagingItems`

**Root cause:** The original INSERT listed only 28 of the 41 columns defined in the schema. The missing 13 were: `colors`, `finish`, `texture`, `pattern`, `dimensions`, `working_size`, `thickness`, `number_of_faces`, `pei_rating`, `shade_variation`, `application`, `certifications`, `preview_references`. All appearance and technical attributes were silently discarded.

`ON CONFLICT DO NOTHING` also meant resume jobs never updated any fields — a restart would read the old (incomplete) row.

**Fix applied:**
- Added all 13 missing columns to the INSERT
- Changed to `ON CONFLICT DO UPDATE SET col = EXCLUDED.col` for all 41 data columns
- Now 41 columns total, fully idempotent on re-import

### Bug 3 — Incomplete API Responses (missing `variant` and ~13 other fields)

**Root cause:** The route handlers built their response objects manually, picking only ~15 fields and omitting the remaining half of `UniversalMaterial`. The `variant` field in particular was never included.

**Fix applied:**
- Introduced a `serializeItem()` helper in the routes file that maps every field from `StagingPreviewItem.material` to the API response
- All 28+ `UniversalMaterial` fields now appear in every `/items` response
- Pagination, filtering, search, and sorting added to `GET /jobs/:id/items`

### Bug 4 — Extraction Diff Viewer (missing feature)

**Root cause:** No intermediate state was stored between the AI extraction and normalization stages. The diff endpoint had no data source for the "EXTRACTED" stage.

**Fix applied:**
- `catalogImportPipeline.ts` attaches the AI-extracted `partialMaterial` to `rawItem.sourceContext._aiExtracted` before calling the normalizer
- `stagingNormalizer.ts` picks this up and stores it as `sourceMetadata.aiExtracted` in the persisted row
- The diff endpoint reads all 4 stages from the existing row: SOURCE → EXTRACTED → NORMALIZED → STAGED
- No new DB columns needed

---

## 2. Fix Summary

| File | Change |
|---|---|
| `adapters/pdfAdapter.ts` | CJS/ESM interop fix; closure-scoped accumulator; removed prototype monkey-patch |
| `stagingService.ts` | 41-column INSERT; `ON CONFLICT DO UPDATE`; `getStagingItemById`, `listJobs`, `countStagingItems` added; `StagingItemFilter` type for pagination/search/sort |
| `catalogImportPipeline.ts` | Attaches `_aiExtracted` to `rawItem.sourceContext` before normalization |
| `stagingNormalizer.ts` | Picks up `_aiExtracted` from sourceContext; stores as `sourceMetadata.aiExtracted` |
| `routes/universal-catalog-import.ts` | `serializeItem()` for all 28+ fields; new `GET /jobs`; new `GET /jobs/:id/items/:sid`; new `GET /jobs/:id/items/:sid/diff`; pagination/filter/sort on `/items` |
| `ai-platform/pages/catalog-import-diff.tsx` | New: 4-stage diff viewer; field-level highlight for missing/changed/normalized; raw JSON toggle; filter chips |
| `ai-platform/pages/catalog-import.tsx` | `StagingItem` interface expanded to all 28 fields; "View Diff" button per item; full attribute grid in expanded view |
| `ai-platform/App.tsx` | Route `/catalog-import-diff/:jobId/:stagingId` registered |
| `__tests__/universal-catalog-import-phase4b.test.ts` | 74 new tests covering all 4 deliverables |

---

## 3. UAT Comparison

### Before Phase 4B

| Scenario | Before | After |
|---|---|---|
| Upload a PDF catalog | ❌ Crash: `origPdfParse is not a function` | ✅ Extracts all text pages |
| Image-only pages in PDF | ❌ Crash | ✅ Marked `_ocrNeeded=true`, skipped gracefully |
| Concurrent PDF uploads | ⚠️ Module-level accumulator → data mixing | ✅ Closure-scoped per extraction |
| GET /items response | ❌ `variant` missing; 13 appearance fields missing | ✅ All 28+ fields present |
| Resume import job | ❌ ON CONFLICT DO NOTHING → old data persists | ✅ ON CONFLICT DO UPDATE → all fields refreshed |
| View diff for a staging item | ❌ 404 — endpoint didn't exist | ✅ 4-stage SOURCE→EXTRACTED→NORMALIZED→STAGED |
| colors, finish, texture, pattern in DB | ❌ Always NULL in staging table | ✅ Persisted correctly |
| peiRating, shadeVariation, certifications | ❌ Always NULL | ✅ Persisted correctly |

### After Phase 4B (verified test coverage)

- **74 new tests, all green**
- Full test suite: no new failures introduced
- esbuild build: clean output

---

## 4. Known Limitations (out of scope for Phase 4B)

| Item | Status |
|---|---|
| OCR for image-only PDF pages | Out of scope — pages are flagged `_ocrNeeded=true` and surfaced in warnings; actual OCR requires an external service |
| `csv-parse` and `xlsx` type declarations | Pre-existing missing `@types` — does not affect runtime; esbuild bundles them correctly |
| `multer` TypeScript `req.file` — implicit `any` | Pre-existing — no multer type augmentation on `Request`; does not affect runtime behavior |
| Presentation/PptxGenJS type errors | Pre-existing from prior phases; unrelated to catalog import |

---

## 5. Final Verdict

**Phase 4B is complete and stable.** All 4 deliverables are implemented:

1. ✅ PDF extraction engine fixed — no more `origPdfParse is not a function` crash
2. ✅ All 28 material attributes persisted to staging (41-column INSERT, ON CONFLICT DO UPDATE)
3. ✅ Complete API responses — `variant` and all other fields present in every GET endpoint
4. ✅ Extraction Diff Viewer built — 4-stage SOURCE→EXTRACTED→NORMALIZED→STAGED with field-level highlights

The feature branch is ready for review. All changes are additive; no schema migration required; no regressions introduced.
