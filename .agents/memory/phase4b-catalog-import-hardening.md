---
name: Phase 4B Catalog Import Hardening
description: Fix rules and invariants from the Phase 4B universal catalog import hardening sprint
---

## Rules

### PDF CJS/ESM interop
`pdf-parse` arrives as a CJS module at runtime (esbuild external). The callable function may be on `mod.default` (ESM wrapper) or on `mod` itself. Always guard:
```ts
const fn = typeof _mod.default === "function" ? _mod.default : (_mod as PdfParseFn);
```
Never assume `.default` is defined.

**Why:** Without the guard, `pdfParseFn` is `undefined` and every upload crashes with `TypeError: origPdfParse is not a function`.

### PDF closure-scoped accumulator
The page-text accumulator (`pages`) inside the PDF extractor must be scoped as `const pages = []` inside each `extract()` call, not as a module-level variable. Module-level mutable state is shared across concurrent extractions and causes data mixing.

### 41-column INSERT in bulkInsertStagingItems
All 41 columns must be in the INSERT. The 13 that were missing in Phase 4A: `colors`, `finish`, `texture`, `pattern`, `dimensions`, `working_size`, `thickness`, `number_of_faces`, `pei_rating`, `shade_variation`, `application`, `certifications`, `preview_references`.

Use `ON CONFLICT DO UPDATE SET col = EXCLUDED.col` (not `DO NOTHING`) so resume jobs refresh all fields.

### serializeItem() — complete field set
All 28+ UniversalMaterial fields must be included in every API response. Never cherry-pick fields manually in route handlers; always call the `serializeItem()` helper.

### Diff viewer — _aiExtracted carrier
AI-extracted partial material is attached by `catalogImportPipeline.ts` to `rawItem.sourceContext._aiExtracted` before calling the normalizer. The normalizer picks it up and writes it to `sourceMetadata.aiExtracted`. The diff endpoint reads all 4 stages (SOURCE/EXTRACTED/NORMALIZED/STAGED) from this single existing row — no new DB columns needed.

### Test environment — pdf-parse/csv-parse
These packages must be installed at the workspace root for vitest tests (esbuild externals are not visible to vitest's Node.js resolver). Install with:
`pnpm --filter @workspace/api-server add pdf-parse csv-parse`

In unit tests, mock pdf-parse with `vi.mock("pdf-parse", ...)` placed BEFORE any import that transitively loads `pdfAdapter.ts` (which has a top-level `await import("pdf-parse")`).

**Why:** Without the mock, the test file fails at module load time with `ERR_MODULE_NOT_FOUND`, not at test runtime.
