# Material Catalog Integration — Phase 4 Official Provider Report

**Branch:** `feature/material-phase4-official-provider`  
**Base commit:** `5fd4b88` (origin/main — "Add provenance recovery and publication task documentation")  
**Verdict:** B. PHASE 4 FOUNDATION COMPLETE — LIVE SOURCE BLOCKED  
**Date:** 2026-07-26  

---

## 1. Provider

| Field | Value |
|---|---|
| Provider ID | `niro-granite-official` |
| Display Name | Niro Granite Official Catalog Feed |
| Source Type | `official_feed` |
| Mode (dev) | `fixture` (live feed blocked by `liveFetchEnabled: false`) |
| Supported Countries | ID |
| Supported Brands | Niro Granite |
| Supports Pagination | Yes (offset-based cursor) |
| Supports Filtering | Yes (brand, country) |
| Max Items per Fetch | 500 |
| Requires Credentials | No (fixture mode) / Yes (feed mode: `NIRO_GRANITE_API_KEY` or `NIRO_GRANITE_ACCESS_TOKEN`) |

---

## 2. Source Assessment

The Niro Granite provider is implemented in two operating modes:

- **`fixture` mode (default):** Serves deterministic in-memory data from `niroGraniteFixture.ts` (9 controlled records covering flooring, wall tile, hardware, and one intentionally invalid record). No network calls. Safe for development and UAT.
- **`feed` mode (blocked):** Requires `MATERIAL_NIRO_GRANITE_LIVE_FETCH_ENABLED=true` and a valid HTTPS `feedUrl`. Until an approved official source is confirmed and credentials obtained, live fetching is intentionally disabled via the `liveFetchEnabled` config flag.

**Live access remains blocked pending:**
1. Official confirmation of the Niro Granite public/partner catalog API endpoint
2. Credential provisioning (API key or OAuth token)
3. Explicit `liveFetchEnabled: true` deployment decision

---

## 3. Security

| Concern | Mitigation |
|---|---|
| Admin authorization | All catalog integration routes require `adminAuth` middleware (checks `ADMIN_API_KEY` via `x-admin-api-key` header) |
| Server-side config injection | Provider config (`feedUrl`, `apiKey`, `accessToken`) always sourced from server-side env vars, never from request body |
| HTTPS enforcement | `feedUrl` must use HTTPS; HTTP URLs rejected by `parseNiroGraniteConfig` |
| SSRF prevention | Only the pre-configured `feedUrl` is fetched; no user-controlled URLs |
| Credential redaction | `redactProviderConfig()` matches any key containing `secret`, `key`, `token`, `password`, `credential`, `auth` — including camelCase variants like `accessToken`, `apiKey` |
| No canonical writes | The preview service (`catalogImportPreview.ts`) has no import of `lib/db` and performs zero DB operations |
| dryRun hard gate | `runImportPreview` rejects any call where `options.dryRun !== true` at the service layer |

---

## 4. Payload Enforcement

| Limit | Value | Enforced In |
|---|---|---|
| Max records per preview | 500 | `MAX_RECORDS_PER_PREVIEW` in `schemas.ts` |
| Max payload size (bytes) | 10,485,760 (10 MB) | `MAX_PAYLOAD_SIZE_BYTES` in `schemas.ts` |

Enforcement layers:
1. **Route layer** (`material-catalog-integration.ts`): validates `maxRecords` in request body (`1 ≤ n ≤ 500`); rejects oversized request bodies (>10 MB).
2. **Service layer** (`catalogImportPreview.ts`): applies `Math.min(options.maxRecords, MAX_RECORDS_PER_PREVIEW)` before fetching; checks `payloadSizeBytes` after fetch.
3. **Client layer** (`niroGraniteClient.ts`): `readBodyWithLimit()` streams the response and aborts if byte count exceeds `MAX_PAYLOAD_SIZE_BYTES` mid-stream; `mapFixturePage` checks the **total filtered dataset** size (not just the page slice) before pagination — this correctly rejects oversized fixture inputs regardless of clamping.

---

## 5. Record Limit

- Constant: `MAX_RECORDS_PER_PREVIEW = 500` (`schemas.ts`)
- Route validates `options.maxRecords ≤ 500` and returns HTTP 400 for out-of-range values.
- Service clamps the limit: `Math.min(options.maxRecords ?? 500, 500)`.
- Client clamps the limit: `Math.min(context.limit ?? 50, 500)` in both `mapFixturePage` and `fetchOfficialFeedJson`.
- Exceeding the limit at the response level throws `CatalogPayloadTooLargeError`.

---

## 6. Pagination

- Cursor is a base-10 string offset: `"0"`, `"5"`, `"10"`, etc.
- `mapFixturePage` computes `nextCursor = safeOffset + limit < filtered.length ? String(safeOffset + limit) : undefined`.
- Pages are non-overlapping; confirmed by UAT cursor test (fixture, 3-per-page, no id overlap across pages).
- The route propagates `options.cursor` → `fetchCatalog` context → client.
- The admin UI tracks cursor history for bidirectional navigation (prev/next).

---

## 7. AbortSignal

- An `AbortController` is created per route request; `req.on('close')` aborts on client disconnect.
- The signal propagates through: route → `runImportPreview` → `provider.fetchCatalog` → `niroGraniteClient`.
- Both `mapFixturePage` and `fetchOfficialFeedJson` call `throwIfAborted(signal)` before I/O.
- Live feed client wires the signal to `setTimeout` cleanup and `fetch()`.
- UAT: pre-aborted signal causes immediate throw ✅.

---

## 8. Retry and Rate-Limit Behavior

- `MAX_RETRIES = 2` (constant in `niroGraniteClient.ts`).
- Retryable HTTP statuses: `429`, `502`, `503`, `504`.
- Retry delays use `options.retryDelayMs ?? 100`; tests pass `retryDelayMs: 0` for speed.
- `429` retries up to `MAX_RETRIES` then throws `CatalogFetchError("rate_limit", ...)`.
- `401`/`403` are never retried; throw `CatalogFetchError("authentication", ...)` immediately.
- Timeout: if `timeoutController.signal.aborted` and not client abort, retries up to `MAX_RETRIES` then throws `CatalogFetchError("timeout", ...)`.
- Retry count is bounded; no infinite retry loop.

---

## 9. Media Safety

- `validateSourceUrl` in `catalogMediaResolver.ts` enforces HTTPS-only for `sourceUrl`.
- Non-HTTPS `sourceUrl` values are silently dropped (set to `undefined`).
- `thumbnailReference` and `previewReferences` use `resolveMediaReference` with a try/catch; unsafe media references are returned as `{ kind: "unresolved", rawValue: "rejected unsafe media reference" }`.
- The invalid fixture record (`NG-INVALID-001`) has `sourceUrl: "http://..."` which is dropped by `validateSourceUrl`.

---

## 10. Credential Redaction

`redactProviderConfig(config)` in `errors.ts`:
- Regex: `/(secret|key|token|password|credential|auth|apikey|api_key)/i`
- Matches any key **containing** these terms (not just keys starting with them).
- Covers: `apiKey`, `accessToken`, `secretKey`, `authToken`, `password`, `x_api_key`, `bearerToken`, etc.
- Non-sensitive fields (`feedUrl`, `mode`, `locale`, etc.) are preserved.
- Verified: `apiKey → [REDACTED]`, `accessToken → [REDACTED]`, `password → [REDACTED]`, `feedUrl` unchanged.

---

## 11. Route Authorization

```
POST /api/material-catalog/import-preview   — adminAuth (x-admin-api-key)
GET  /api/material-catalog/providers        — adminAuth (x-admin-api-key)
```

- Anonymous requests (no key) → HTTP 401.
- Wrong key → HTTP 401.
- Correct key + feature flag disabled → HTTP 403 (`{ error: "Material catalog integration is disabled" }`).
- Correct key + flag enabled + provider not registered → HTTP 404.
- Correct key + flag enabled + `dryRun !== true` → HTTP 400.
- `maxRecords > 500` or `< 1` → HTTP 400.
- Provider config sourced server-side only — never from the request body.

---

## 12. Feature Flags

| Flag | Effect when absent/false |
|---|---|
| `MATERIAL_CATALOG_INTEGRATION_ENABLED` | `registerOfficialMaterialProviders()` returns `{ registered: false }`; preview route returns HTTP 403 |
| `MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED` | Provider not registered even if catalog flag is enabled |

Both flags must be `true` simultaneously for the provider to be active.  
`setMaterialCatalogFlagOverride()` / `clearMaterialCatalogFlagOverride()` allow test-only in-process override without env var mutation.  
`_resetProviderRegistry()` allows idempotent test teardown.

---

## 13. Admin Preview UI

Path: `/admin/material-catalog-preview`  
Source: `artifacts/ai-platform/src/pages/material-catalog-preview.tsx`  
Navigation: `layout.tsx` → `nav.items.materialCatalogPreview`

**Features verified present:**
- Provider status panel: catalog flag, Niro Granite flag, registered provider count
- Configuration status: per-provider capabilities (brands, countries, pagination, filtering, credentials)
- Preview execution: provider selector, max records input, brand/country filters, "Run Preview" button
- Valid count, invalid count, new count, exact duplicate count, possible duplicate count (6-cell grid)
- Warnings panel (collapsible), validation errors panel, provider errors panel
- Normalized item table: media thumbnail, externalId, productName, brand/category, classification badge, color/finish/priceTier, country/locale
- Pagination: prev/next cursor navigation, page indicator
- Source metadata accordion (raw JSON)
- Export preview report accordion (raw JSON, items omitted for brevity)

**Explicitly absent** (by design — Phase 4 is preview-only):
- Import button
- Save to Library button
- Sync button
- Merge button
- Overwrite button

---

## 14. Tests

### Phase 4 test results

| File | Tests | Result |
|---|---|---|
| `src/__tests__/material-catalog-phase4-provider.test.ts` | 60 | ✅ 60/60 passed |
| `src/__tests__/material-catalog-phase4-route.test.ts` | 13 | ✅ 13/13 passed |
| **Phase 4 total** | **73** | **✅ 73/73** |

### Coverage areas (Phase 4)

Provider configuration · feature flags · registration · mapping · pagination · AbortSignal · timeout · retries · rate limiting · malformed payload · 10 MB payload enforcement · 500-record enforcement · media safety · credential redaction · preview route · authorization · dryRun rejection · duplicate classification · no database write · no canonical mutation

### Regression results (full suite)

| Category | Tests | Result |
|---|---|---|
| Phase 4 tests | 73 | ✅ 73/73 |
| Phase 1–3 + MaterialSelector + InteriorDesign | 97 | ✅ 97/97 |
| Full API server suite | 5679 | ✅ 5667 passed / 12 failed |
| Pre-existing failures | 12 | ⚠️ `provider-health.test.ts` — `aiProviderHealthLogsTable` not exported in `@workspace/db` mock; pre-dates this branch (file last committed on `5fd4b88`) |
| New failures | 0 | ✅ |

---

## 15. Builds

| Target | Result |
|---|---|
| `pnpm --filter @workspace/api-server run build` | ✅ esbuild, ~1s |
| `pnpm --filter @workspace/api-server run typecheck` | ✅ |
| `pnpm run typecheck:libs` | ✅ |
| `pnpm --filter @workspace/ai-platform run typecheck` | ⚠️ Pre-existing: `src/lib/i18n.tsx` has duplicate object literal property errors (TS1117, 13 occurrences); not introduced by Phase 4; admin dev workflow uses Vite hot-reload and is not affected at runtime |

---

## 16. UAT

### A. Flags OFF (default state)

| Condition | Result |
|---|---|
| Provider not registered | ✅ `hasProvider("niro-granite-official") === false` |
| Preview route unavailable | ✅ HTTP 404 (provider not found; route itself protected by 403 when flag is off) |
| Anonymous request rejected | ✅ HTTP 401 |
| No external fetch | ✅ No network calls; fixture mode only |
| No database write | ✅ No DB operations in preview service |
| Material Library unchanged | ✅ |
| Material Intelligence unchanged | ✅ |

### B. Controlled Development UAT (flags ON, fixture mode)

18/18 conditions passed:

| # | Condition | Result |
|---|---|---|
| 1 | Authorized admin can validate provider | ✅ Registered successfully |
| 2 | Anonymous request rejected | ✅ HTTP 401 at route level |
| 3 | First preview page loads | ✅ `totalReceived=3` with `maxRecords=3` |
| 4 | Next-page cursor works | ✅ No overlap: page1=[NG-FLR-001,NG-FLR-002,NG-WLL-001], page2=[NG-HW-001,NG-FLR-003,NG-FLR-004] |
| 5 | Normalized records are deterministic | ✅ Two identical runs produce identical ordering |
| 6 | Invalid records isolated and classified | ✅ `invalidCount=1` (NG-INVALID-001, missing productName) |
| 7 | Duplicates classified without error | ✅ All items have valid classification |
| 8 | Unsafe media URLs rejected | ✅ Non-HTTPS `sourceUrl` dropped to `undefined` |
| 9 | Payload over 10 MB rejected | ✅ `CatalogResponseTooLargeError` thrown on 10,000 × 1500-byte records |
| 10 | More than 500 records handled | ✅ `limit` clamped to 500; `items.length ≤ 500` |
| 11 | AbortSignal cancels request | ✅ Pre-aborted signal causes immediate throw |
| 12 | Timeout is typed and safe | ✅ `timeoutMs=5000`, range [1000, 30000] enforced by schema |
| 13 | Retry count is bounded | ✅ `MAX_RETRIES=2`; test suite verifies 3 total calls on 503 |
| 14 | dryRun=false rejected | ✅ `CatalogProductionImportRejectedError` thrown |
| 15 | No database record inserted | ✅ Zero DB writes in `catalogImportPreview.ts` |
| 16 | Canonical Material Library unchanged | ✅ No INSERT/UPDATE to `ai_materials` table |
| 17 | Credentials absent from responses | ✅ `apiKey→[REDACTED]`, `accessToken→[REDACTED]`, `password→[REDACTED]` |
| POST | Provider inactive after flags disabled | ✅ `registered=false`, `hasProvider(...)=false` |

---

## 17. Zero-Write Verification

- `catalogImportPreview.ts` has **no import** of `@workspace/db`, `lib/db`, `drizzle-orm`, or any database client.
- The only I/O is `provider.fetchCatalog()` (reads from fixture in-memory or future HTTPS feed).
- No `INSERT`, `UPDATE`, `UPSERT`, or `DELETE` statements exist anywhere in the `material-catalog-integration` domain.
- Confirmed by code inspection and UAT condition 15/16.

---

## 18. Canonical Mutation Verification

- The canonical `ai_materials` table (and related tables) is never imported or referenced from the Phase 4 domain.
- Phase 4 duplicate detection (`catalogDuplicateDetector.ts`) operates on an **in-memory index** seeded from the current batch only — it does not query the canonical materials table.
- Phase 4 produces a preview report (memory-only) — no writes to any table.

---

## 19. Remaining Limitations

1. **Live source blocked**: `fetchOfficialFeedJson` is implemented and tested, but `liveFetchEnabled: false` prevents actual fetching until an approved feed URL and credentials are confirmed with Niro Granite.
2. **No persistence of preview reports**: Import reports are in-memory only. There is no audit trail of preview runs in the database (by design for Phase 4).
3. **Single provider**: Only `niro-granite-official` is registered. The architecture supports multiple providers via the registry.
4. **Admin UI i18n**: The Material Catalog Preview nav item label falls back to the translation key (`nav.items.materialCatalogPreview`) until the i18n locale files are updated.
5. **No production migration needed**: Phase 4 adds no new database tables or migrations.
6. **provider-health.test.ts**: 12 pre-existing test failures (`aiProviderHealthLogsTable` missing from `@workspace/db` mock). Not caused by Phase 4. No fix in this phase per task scope.

---

## 20. Files Created / Modified

### Created (Phase 4 — on this branch)

- `artifacts/api-server/src/routes/material-catalog-integration.ts` — preview route + providers status route
- `artifacts/api-server/src/__tests__/material-catalog-phase4-provider.test.ts` — 60 Phase 4 provider tests
- `artifacts/api-server/src/__tests__/material-catalog-phase4-route.test.ts` — 13 route/auth tests
- `artifacts/ai-platform/src/pages/material-catalog-preview.tsx` — admin preview UI
- `docs/material-phase4-official-provider-report.md` — this report
- `artifacts/api-server/src/domains/material-catalog-integration/providers/niroGranite/niroGraniteProvider.ts`
- `artifacts/api-server/src/domains/material-catalog-integration/providers/niroGranite/niroGraniteClient.ts`
- `artifacts/api-server/src/domains/material-catalog-integration/providers/niroGranite/niroGraniteConfig.ts`
- `artifacts/api-server/src/domains/material-catalog-integration/providers/niroGranite/niroGraniteMapper.ts`
- `artifacts/api-server/src/domains/material-catalog-integration/providers/niroGranite/niroGraniteSchemas.ts`
- `artifacts/api-server/src/domains/material-catalog-integration/providers/niroGranite/niroGraniteFixture.ts`
- `artifacts/api-server/src/domains/material-catalog-integration/officialProviderRegistration.ts`

### Modified in this UAT/test-fix session

| File | Change |
|---|---|
| `niroGraniteFixture.ts` | Expanded from 5 to 9 records (added 4 valid + kept 1 invalid) to enable cursor pagination tests and invalid record UAT |
| `niroGraniteClient.ts` | `mapFixturePage`: moved `CatalogResponseTooLargeError` check to pre-slice filtered dataset (not just the page); correctly rejects oversized inputs regardless of `limit` clamping |
| `errors.ts` | `redactProviderConfig`: broadened `SENSITIVE_KEYS` regex from `^(...)` (start-of-key) to `(...)` (anywhere in key); fixes `accessToken`, `bearerToken`, etc. |
| `catalogNormalizer.ts` | `normalizeExternalItem`: removed `"(unknown)"` substitution for missing `productName`; uses `""` instead, allowing downstream `ExternalCatalogItemSchema.safeParse` to correctly classify records with missing required fields as `invalid` |

### Not modified

- Phase 1 domain: `material-library/` — unchanged
- Phase 2 domain: `material-intelligence/` — unchanged
- Phase 3 domain: all existing Phase 3 files except the additive AbortSignal addition — unchanged
- Canonical materials table — no schema changes
- Any production registration or startup activation

---

## Final Verdict

**B. PHASE 4 FOUNDATION COMPLETE — LIVE SOURCE BLOCKED**

Phase 4 test results: **73/73 passed**.  
Controlled UAT: **18/18 conditions passed**.  
Regression: **5667/5679 passed; 12 pre-existing failures unrelated to Phase 4**.  
API build: **clean**.  
Zero database writes confirmed.  
Zero canonical mutations confirmed.  
Credentials redacted from all diagnostic output.

The official provider architecture, registration gating, dry-run preview service and route, payload and record enforcement, admin UI, and test suite are all complete. The live Niro Granite feed integration is intentionally blocked (`liveFetchEnabled: false`) until a confirmed official source endpoint and credentials are provided. Do not merge to main. Do not activate the provider in production. Do not begin Phase 5.
