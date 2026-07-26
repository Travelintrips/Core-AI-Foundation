# Material Catalog Import Engine — Phase 4A
## Universal Catalog Import — Architecture & Implementation Report

**Branch:** `feature/material-phase4-universal-catalog-import`
**Base:** `main`
**Date:** 2026-07-26

---

## 1. Objective

Build one universal catalog ingestion engine that imports material catalogs from multiple file and web sources using a single, provider-independent pipeline. All output lands in a staging area only — no data enters the canonical Material Library automatically.

---

## 2. Architecture

```
Catalog Source (PDF / Website / CSV / Excel / JSON / XML / API)
        │
        ▼
Catalog Discovery (adapter selection by sourceType)
        │
        ▼
Document / Page Extractor (source-specific CatalogAdapter)
        │
        ▼
AI Material Extractor (OpenAI GPT-4o-mini, batch extraction)
        │
        ▼
Staging Normalizer (maps to UniversalMaterialSchema)
        │
        ▼
Duplicate Detection (existing catalogDuplicateDetector — reused)
        │
        ▼
Staging Library (material_catalog_staging table)
        │
        ▼
Admin Preview UI ← STOP. No write to Material Library.
```

---

## 3. Source Adapters

All adapters implement the `CatalogAdapter` interface (`domains/universal-catalog-import/types.ts`):

```typescript
interface CatalogAdapter {
  readonly sourceType: AdapterSourceType;
  readonly displayName: string;
  readonly supportedMimeTypes: string[];
  extract(input: AdapterInput): Promise<AdapterResult>;
}
```

| Adapter | File | Status | Notes |
|---|---|---|---|
| **PDF** | `adapters/pdfAdapter.ts` | ✅ Complete | Text extraction via `pdf-parse`; image-only page detection; catalog version detection; page batching |
| **Website** | `adapters/websiteAdapter.ts` | ✅ Complete | robots.txt check; JSON-LD; embedded JSON; sitemap product URLs; semantic HTML fallback; hard stops (login, CAPTCHA, anti-bot) |
| **CSV** | `adapters/csvAdapter.ts` | ✅ Complete | Auto-delimiter detection (comma/semicolon/tab/pipe); RFC-compliant via `csv-parse` |
| **Excel** | `adapters/excelAdapter.ts` | ✅ Complete | `.xlsx` and `.xls` via `xlsx` (SheetJS); multi-sheet warning |
| **JSON** | `adapters/jsonAdapter.ts` | ✅ Complete | Array, `{items:[]}`, `{products:[]}`, `{data:[]}`, single-object patterns |
| **XML** | `adapters/xmlAdapter.ts` | ✅ Complete | 10 common XML envelope paths tried; attribute flattening; `fast-xml-parser` |
| **API** | `adapters/apiAdapter.ts` | ⏳ Foundation stub | Returns `LIVE_SOURCE_BLOCKED` until Phase 5 prerequisites cleared |

---

## 4. Universal Material Schema

All sources normalize to the same schema (`universalMaterialSchema.ts`):

```
brand, collection, series, productCode, productName, variant,
category, subcategory, materialType, description,
colors[], finish[], texture, pattern,
dimensions, workingSize, thickness, numberOfFaces, peiRating, shadeVariation,
technicalSpecifications, application[], certifications[],
thumbnailReference, previewReferences[],
sourceType, sourceName, sourceVersion, sourceUrl, sourcePage, sourceMetadata
```

Rules enforced by Zod schema:
- `sourceType` and `sourceName` are always required
- `peiRating` is 0–5 integer
- `sourceUrl` must be a valid URL if provided
- No field is fabricated — the AI extractor is instructed to omit unknown fields

---

## 5. AI Material Extraction

File: `aiMaterialExtractor.ts`

- Uses **GPT-4o-mini** at temperature 0 (deterministic)
- Batches raw items (5 per call) to stay within token limits
- Explicit instruction: never fabricate values, return null for unknown fields
- Falls back gracefully when `OPENAI_API_KEY` is absent (logs warning, returns empty)
- Input truncated to 8,000 chars per batch to prevent oversized requests
- `rawItemToText()` converts structured records (CSV/Excel rows) to readable key:value text

---

## 6. Duplicate Detection

The existing `catalogDuplicateDetector.ts` (Phase 3) is reused without modification.

Adapter: `stagingNormalizer.ts` → `toExternalCatalogItem()` maps a `UniversalMaterial` to the `ExternalCatalogItem` shape expected by the detector.

Four detection strategies (in priority order):
1. `providerId + externalId` → `exact_duplicate`
2. `brand + productCode` (same code, different ID) → `conflicting_identity`
3. `normalized brand + normalized productName` → `possible_duplicate`
4. `sourceUrl` exact match → `exact_duplicate`

Status derivation:
- `new` → `normalized`
- `exact_duplicate` / `conflicting_identity` → `duplicate`
- `possible_duplicate` → `needs_review`
- validation errors present → `needs_review` (or `draft` if also invalid)

---

## 7. Staging Library

### Database Tables

**`ai_platform.material_catalog_import_jobs`**
- Tracks each import attempt: source type, status, counts, checksums
- Idempotency: same checksum/idempotency key returns the existing job

**`ai_platform.material_catalog_staging`**
- Stores all extracted items with full normalized fields + raw data
- References `import_job_id` (CASCADE DELETE)
- Status: `draft | extracted | normalized | duplicate | approved | rejected | needs_review`
- HARD RULE: zero reads/writes to `ai_platform.materials` (canonical table)

Migration file: `artifacts/api-server/src/migrations/20260726_material_catalog_staging.sql`

### Background Processing

| Feature | Implementation |
|---|---|
| Large file | Adapter returns all pages; pipeline processes in AI batches of 5 |
| Idempotency | SHA-256 checksum of file buffer → skips re-processing |
| Resume | `createOrResumeJob` returns existing job if same checksum |
| Retry | `MAX_RETRIES=2` in HTTP fetch (website adapter) |
| Progress | `processed_pages` / `total_pages` tracked in job row |
| Batch | `bulkInsertStagingItems` inserts in chunks of 50 |
| Checksum | `computeChecksum(buffer)` → 32-char hex (SHA-256) |

---

## 8. API Routes

All routes require admin authentication (`adminAuth` middleware).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/universal-catalog/adapters` | List available adapters and capabilities |
| `POST` | `/api/universal-catalog/preview` | Run import pipeline (multipart file upload or URL) |
| `GET` | `/api/universal-catalog/jobs/:jobId` | Get job status and counts |
| `GET` | `/api/universal-catalog/jobs/:jobId/items` | Get staged items (max 500) |

All responses include `_previewOnly: true` and `_noCanonicalWrite: true` flags.

**File upload:** `multipart/form-data`, field name `file`, 50 MB limit.
**URL import:** JSON body field `url` (HTTPS only, enforced).

---

## 9. Admin UI

Page: `artifacts/ai-platform/src/pages/catalog-import.tsx`
Route: `/catalog-import` in AdminRouter

Features:
- Source selector (PDF / Website / CSV / Excel / JSON / XML / API)
- File upload drop zone for file-based sources
- HTTPS URL input for website source
- Max items control (1–500)
- Advanced options: brand hint, category hint, skip AI toggle
- Extraction progress panel (raw count, normalized, new, review)
- Detected collections and products table (expandable rows)
- Detected variants shown as separate items
- Duplicate summary panel (exact / possible / conflicting / invalid counts)
- Warnings panel
- Errors panel
- **No Import button. No Save button.** Preview only.

---

## 10. Supported Brands

The engine is brand-agnostic by design. Tested with fixture data for:
Niro Granite, Roman, Granito, TOTO, Hafele, IKEA, Informa, Caesarstone, Silestone

No vendor-specific logic exists inside the core engine. Brand identity emerges from source data and AI normalization.

---

## 11. Limitations

1. **OCR**: Image-only PDF pages are flagged but not OCR'd. AI receives a hint; extraction quality depends on page context.
2. **Website scope**: Shallow crawl only (target page + sitemap product URLs up to 20). No deep spider.
3. **API adapter**: Stub only — live feed blocked pending Phase 5 prerequisites.
4. **AI extraction**: Requires `OPENAI_API_KEY`. Falls back to raw passthrough (skip AI mode) if absent.
5. **Staging persistence**: Items are stored in the DB staging table but never promoted to canonical materials by this engine.

---

## 12. Phase 5 Hand-off

Phase 5 ("Connect Niro Granite Live Official Feed") wires the `api` adapter to the existing `niroGraniteClient.ts` transport from Phase 4. Prerequisites needed before Phase 5 can begin:

- Official HTTPS feed URL (`MATERIAL_NIRO_GRANITE_FEED_URL`)
- API key or access token (`MATERIAL_NIRO_GRANITE_API_KEY` / `MATERIAL_NIRO_GRANITE_ACCESS_TOKEN`)
- Source owner authorization (written)
- Rate limits, update frequency, and media usage terms confirmed

---

## 13. Files Created

### Backend — New Domain
```
artifacts/api-server/src/domains/universal-catalog-import/
  index.ts
  types.ts
  universalMaterialSchema.ts
  catalogImportPipeline.ts
  aiMaterialExtractor.ts
  stagingNormalizer.ts
  stagingService.ts
  adapters/
    csvAdapter.ts
    excelAdapter.ts
    jsonAdapter.ts
    xmlAdapter.ts
    xmlAdapter.ts
    pdfAdapter.ts
    websiteAdapter.ts
    apiAdapter.ts
```

### Backend — Route & Migration
```
artifacts/api-server/src/routes/universal-catalog-import.ts
artifacts/api-server/src/migrations/20260726_material_catalog_staging.sql
```

### Frontend — Admin UI
```
artifacts/ai-platform/src/pages/catalog-import.tsx
```

### Test
```
artifacts/api-server/src/__tests__/universal-catalog-import.test.ts
```

### Documentation
```
docs/material-phase4a-universal-catalog-import.md  (this file)
```

### Modified (additive only)
```
artifacts/api-server/src/routes/index.ts  — added universal-catalog-import route
artifacts/ai-platform/src/App.tsx         — added /catalog-import route
artifacts/api-server/package.json         — added pdf-parse, csv-parse, multer, xlsx, fast-xml-parser
```

---

## 14. Not Modified

- Phase 1: `material-library/` — unchanged
- Phase 2: `material-intelligence/` — unchanged
- Phase 3: all Phase 3 catalog-integration files — unchanged
- Phase 4: `niroGraniteProvider` and related files — unchanged
- Canonical `materials` table — no schema changes
- Any production registration or startup activation

---

## Final Verdict

**Pending test results** — see test run output for final verdict.
