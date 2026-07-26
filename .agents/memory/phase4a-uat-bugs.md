---
name: Phase 4A UAT — bugs found and fixed
description: Four bugs fixed during Phase 4A controlled UAT of the universal catalog import pipeline; one PDF adapter issue remains open.
---

# Phase 4A UAT Bugs

## Fixed

1. **websiteAdapter.ts `isDisallowed()`** — empty `Disallow:` (allow-all) was incorrectly blocking crawls because `"".startsWith("")` is always true. Fix: guard with `if (disallowedPath && ...)`.

2. **stagingService.ts `bulkInsertStagingItems()`** — placeholder template had 29 `$N` entries but only 28 target columns. Fix: remove one extra `,$${paramIdx++}`.

3. **stagingNormalizer.ts `generateStagingId()`** — returned 16-char hex but DB `id` column is uuid. Fix: format as `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`.

4. **stagingService.ts `updateJobStatus()`** — `warnings`/`errors` were `JSON.stringify`'d before being passed to `TEXT[]` columns. Fix: pass arrays directly (no stringify).

## Open (Phase 5 items)

- **PDF adapter**: `origPdfParse is not a function` — CJS/ESM interop issue with pdf-parse. All PDF jobs fail. Fix: replace pdf-parse with pdfjs-dist or fix dynamic import.
- **Missing INSERT columns**: `colors`, `finish`, `texture`, `pattern`, `dimensions`, `pei_rating`, `shade_variation`, `thickness` are extracted in memory but not in the bulk INSERT. Staging DB shows empty for these fields.
- **`variant` not in items API response**: stored in DB but omitted from route response shape.

**Why:** These were first-run bugs in a new domain (`domains/universal-catalog-import/`) — the staging pipeline had never been exercised against a real DB before this UAT.
