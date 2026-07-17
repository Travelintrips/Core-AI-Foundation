---
name: Team 14 Universal Rendering Engine — Remediation rules
description: P0/P1/P2 audit fixes for the universal renderer adapter; durable constraints for future work on this service.
---

## Key rules and findings

### P0 — SSRF (ssrfFetchValidator.ts)
- `validateExternalUrl` from `ssrfGuard.ts` does NOT handle bracketed IPv6 (e.g. `[::1]`)
  because `URL.hostname` returns `"[::1]"` with brackets, but the regex is `/^::1$/`.
  Team 14 adds a supplementary `BRACKETED_IPV6_PRIVATE` pattern array in `validateAssetUrl()`.
- All SVG external URL refs (href/xlink:href/src/CSS url()) must pass through
  `scanSvgForBlockedUrls()` before any render; http:// is rejected outright.
- `secureFetch()` is the ONLY approved fetch path in Team 14 — never bare `fetch()`.
- Redirect SSRF: each hop is re-validated with `validateAssetUrl` before following.

### P1 — Resource limits (resourceLimits.ts)
- `UNIVERSAL_RENDER_LIMITS` is the single source of truth — no magic numbers elsewhere.
- MAX_SVG_BYTES = 5 MB, MAX_PAYLOAD_BYTES = 10 MB, MAX_CANVAS_PIXELS = 8192*8192,
  MAX_ASSET_COUNT = 50, MAX_RENDER_DURATION_MS = 60 000 ms.
- Route enforces payload limit from Content-Length header AND serialised body size.
- Canvas dimension violations are a hard error (`CANVAS_LIMIT_EXCEEDED`), not a silent clamp.

### P1 — Idempotency (idempotencyService.ts)
- `computeRenderHash(req)` = SHA-256 of `{ svgContent, canvasWidth, canvasHeight, sorted(formats), previewMode }`.
  Metadata.title / storagePrefix intentionally EXCLUDED (affect labelling, not pixel output).
- In-memory LRU cache: TTL = 5 min, max = 1000 entries, FIFO eviction on cap.
- universalRendererService.render() checks cache BEFORE rendering, records AFTER success.
- `cached: true` flag returned on cache hit for monitoring/logging.
- DB-level idempotency (content_hash column in ai_universal_renders) requires Team 24 migration
  — declared in integration/manifests/team-14.json as a dependency.

### P1 — Duplication (thumbnailService.ts)
- SVG→WebP thumbnail delegates to `encodeSvg(svg, "webp", w, h, { outputWidth, outputHeight })`
  from `services/design-renderer/outputEncoder.ts` — NOT a duplicate Sharp pipeline.
- Buffer→WebP still uses Sharp directly (no encodeSvg equivalent).
- Import path: `../design-renderer/outputEncoder.js` (NOT `../../design-renderer/...`).

### P1 — Render timeout
- `_doRender()` is wrapped in `Promise.race([render, renderTimeout(60_000)])`.
- Timeout throws `RenderError("RENDER_TIMEOUT", ...)`.

### Correct import paths
- ssrfGuard: `../../middleware/ssrfGuard.js` (from services/universal-renderer/)
- outputEncoder: `../design-renderer/outputEncoder.js` (from services/universal-renderer/)

### Test count
- Commit 7341b3c: 1254/1254 tests passing.
- New test files: ssrfFetchValidator.test.ts (26), idempotencyService.test.ts (11),
  resourceLimits.test.ts (13), universalRendererService.test.ts (52 total).
