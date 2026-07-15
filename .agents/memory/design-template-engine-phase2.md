---
name: Design Template Engine — Phase 2 Renderer
description: Phase 2 render pipeline design decisions, file inventory, and constraints
---

# Design Template Engine — Phase 2: Core Renderer

## File Inventory (all new, in `artifacts/api-server/src/services/design-renderer/`)

| File | Purpose |
|---|---|
| `config.ts` | Centralises env vars (DESIGN_RENDER_CONCURRENCY, JPEG_QUALITY, rendererVersion) |
| `errors.ts` | RenderError class, stable RenderErrorCode enum, isRetryable(), sanitiseErrorMessage() |
| `renderWarnings.ts` | WarningAccumulator (non-fatal render events) |
| `fontRegistry.ts` | Safe font list for Replit/NixOS, resolveFont(), safeFontFamily() |
| `assetCache.ts` | In-memory batch asset cache with TTL + max-bytes eviction, normalised keys |
| `imageResolver.ts` | resolveAssetReference() — SSRF-guarded fetch, magic-byte MIME validation |
| `textLayout.ts` | wrapText(), layoutText() — character-width estimator (~15% safety margin), wrap/auto-shrink/truncate |
| `pdfRenderer.ts` | pngToPdf() — Strategy A: PNG buffer → single-page pdf-lib PDF (rasterised) |
| `elementRenderer.ts` | Per-element SVG: renderShape, renderText, renderImage, renderQrCode, renderLine, renderGroup (depth-limit 4), xmlEscape() |
| `svgBuilder.ts` | buildSvg() — resolves assets, evaluates visibility, assembles SVG string |
| `outputEncoder.ts` | encodeSvg() — Sharp pipeline for PNG/JPG/WebP/PDF, validateOutputDimensions(), mimeForFormat(), extForFormat() |
| `templateRenderer.ts` | renderTemplate() (production + upload) and renderTemplatePreview() (no storage) |
| `index.ts` | Barrel re-export |

## Key Design Decisions

### Single Render Route (POST /ai/design-templates/:id/render)
- **MUST create a canonical batch + render item before enqueueing** — batchId is NOT NULL on render items.
- Uses `createBatch()` with `items: [data]`, then retrieves the item by `batchId`.
- Enqueues `design_render_batch_dispatch` (not `design_render`) so the dispatch step sets item to processing before the individual render job runs.
- Idempotency: if a completed item with the same `inputHash` exists, returns cached result with `{ cached: true }` (no new job).

### Worker Job Payload Rule (Phase 2)
- `design_render` job payload: `{ tenantId, renderItemId, batchId? }` — minimal IDs only.
- Worker reads all render data from DB (source of truth). The old Phase 1 pattern (full data in payload) was a bug that Phase 2 fixes.

### ZIP Export
- POST `/ai/design-render-batches/:id/export-zip` returns **501 Not Implemented** and does NOT enqueue a job.
- Worker `executeDesignRenderZipExport` throws immediately with `{ retryable: false, code: "ZIP_NOT_IMPLEMENTED" }`.
- Phase 3 will implement real ZIP delivery.

### PDF Strategy
- Strategy A: render PNG at full resolution → embed in pdf-lib as single page.
- Documented as rasterised in metadata. No vector PDF output.
- pdf-lib must remain in esbuild externals list (pre-existing constraint from `pdfkit-esbuild-external.md`).

### Font Measurement
- Character-width estimator only (not pixel-exact). Documented ±15% safety margin.
- Text will not overflow outside boxes in practice because auto-shrink uses the same estimator consistently.

### QR Code
- `qrcode.toBuffer()` → PNG → base64 data URI embedded in `<image>` element.
- Avoids SVG-in-SVG problems with librsvg (Inkscape backend).

### Image Fallback
- Failed image loads emit `IMAGE_FALLBACK_USED` warning and render a grey placeholder rect.
- Render always completes — missing images never throw from buildSvg.

### Cancellation (Cooperative)
- Three check points: (1) before template load, (2) before Sharp render, (3) before marking completed.
- If cancelled after upload completes, the uploaded object is not deleted (acceptable per spec).

### Cache Key
- `computeInputHashWithMeta()` = SHA-256 of `baseHash::format|w|h|rendererVersion`.
- Bumping `rendererVersion` in `config.ts` invalidates all cached renders (intentional).

### Storage Path
- `design-renders/{tenantId}/{batchId}/{renderItemId}/{inputHash[0:16]}.{ext}`

### Atomic Item Claim
- `UPDATE WHERE status IN ('queued', 'processing') ... RETURNING` — increments `attemptCount`.
- Returns 0 rows → check if already completed (idempotent re-delivery).

## Test Suite
- `src/tests/designRenderer.test.ts` — 100+ test cases across all Phase 2 modules
- `src/tests/designRendererBenchmark.ts` — standalone benchmark (no network required)
- Phase 1 tests (`src/tests/designTemplate.test.ts`) preserved — all 712 tests pass

## Pre-Existing Typecheck Errors (NOT Phase 2)
- `presentationRenderService.ts`: PptxGenJS namespace issues (pptxgenjs v4 interop)
- `zipDeliveryService.ts`: mimeType property missing, arg count mismatch
- `creative-marketplace.ts`: Express 5 string|string[] params type
- `v42d-zip-delivery.test.ts`: status union comparison
All pre-dated Phase 2 and are tracked in existing memory files.

**Why:** All decisions documented here are non-obvious and would require re-discovery otherwise.
**How to apply:** Reference when implementing Phase 3 (ZIP export, real vector PDF, font embedding).
