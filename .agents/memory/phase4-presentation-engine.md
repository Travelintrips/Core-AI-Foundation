---
name: Phase 4 Presentation Engine
description: Gotchas building the pptxgenjs-based Presentation Engine (pitch decks) — import interop, PDFKit auto-pagination, and the honest-fallback PDF preview pattern.
---

## pptxgenjs default export interop
`pptxgenjs` ships a CJS build. Under `tsx`/some ESM interop modes, `import PptxGenJS from "pptxgenjs"` can resolve to `{ default: PptxGenJS }` instead of the constructor itself — `new PptxGenJS()` then throws `PptxGenJS is not a constructor`, even though the same code works fine in the esbuild-bundled production server.
**Fix:** normalize at the import site: `const Ctor = (Imported as any).default ?? Imported;` and construct with `Ctor`. Always sanity-check any new pptxgenjs render path by running it once through `tsx` directly (not just through the bundled build), since the two module systems can disagree.

## PDFKit auto-pagination silently doubles page count
When manually laying out "one PDF page per logical unit" (e.g. one page per slide) with PDFKit, placing ANY text — even with explicit x/y — past the page's printable boundary (`pageHeight - bottomMargin`) makes PDFKit silently start a new page to hold the overflow. This desyncs `bufferedPageRange().count` from the intended page count without throwing.
**Fix:** compute the printable bottom explicitly and keep every element (including footers/page numbers) strictly above it; track a running `y` cursor and truncate content with an explicit "+N more" indicator rather than letting PDFKit auto-paginate. Assert `pageCount === expectedCount` after render as a regression guard.

## Honest fallback for PPTX→PDF preview
No LibreOffice/`soffice` binary is available in this environment, so true PPTX→PDF conversion is impossible. The correct pattern is a PDF rendered directly from the same structured slide spec (via PDFKit) — clearly tagged `conversionStrategy: "spec_rendered"` vs `"binary_conversion"` in metadata — never claiming a real conversion happened. `isPdfConversionAvailable()` checks for `soffice` at runtime (cached) so a real converter could be preferred later without touching callers.

## Anti-fabrication slide skipping
For presentation types built from the existing 4-agent creative workflow (brand strategist/creative director/copywriter) — which produces no financials, team roster, or verified competitor data — slide kinds that need that data (metrics, financial, team, comparison) must be SKIPPED, not filled with placeholders. Record skips with a reason in the generation report; don't force an arbitrary minimum slide count by fabricating content.
