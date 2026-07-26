# Material Catalog Integration — Phase 4 Official Provider Report

**Branch:** `feature/material-phase4-official-provider`
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

- **`fixture` mode (default):** Serves deterministic in-memory data from `niroGraniteFixture.ts`. No network calls. Safe for development and UAT.
- **`feed` mode (blocked):** Requires `MATERIAL_NIRO_GRANITE_LIVE_FETCH_ENABLED=true` and a valid HTTPS `feedUrl`. Until an approved official source is confirmed and credentials obtained, live fetching is intentionally disabled via the `liveFetchEnabled` config flag.

Live access remains blocked pending:
1. Official confirmation of the Niro Granite public/partner catalog API endpoint
2. Credential provisioning (API key or OAuth token)
3. Explicit `liveFetchEnabled: true` deployment

---

## 3. Security

| Concern | Mitigation |
|---|---|
| Admin authorization | All catalog integration routes require `adminAuth` middleware (checks `ADMIN_API_KEY` via `x-admin-api-key` or `Authorization: Bearer` header) |
| Server-side config injection | Provider config (`feedUrl`, `apiKey`, `accessToken`) is always sourced from server-side env vars, never from the request body |
| HTTPS enforcement | `feedUrl` must use HTTPS; HTTP URLs are rejected by `parseNiroGraniteConfig` |
| SSRF prevention | Only the pre-configured `feedUrl` is fetched; no user-controlled URLs |
| Credential redaction | `redactProviderConfig()` is called before any diagnostic output |
| No canonical writes | The preview service (`catalogImportPreview.ts`) has no import of `lib/db` and performs zero DB operations |
| dryRun hard gate | `runImportPreview` rejects any call where `options.dryRun !== true` at the service layer |

---

## 4. Payload Enforcement

| Limit | Value | Enforced In |
|---|---|---|
| Max records per preview | 500 | `MAX_RECORDS_PER_PREVIEW` in `schemas.ts` |
| Max payload size (bytes) | 10,485,760 (10 MB) | `MAX_PAYLOAD_SIZE_BYTES` in `schemas.ts` |

Enforcement layers:
1. **Route layer** (`material-catalog-integration.ts`): validates `maxRecords` in request body (`1 ≤ n ≤ 500`); rejects oversized request bodies (>10 MB)
2. **Service layer** (`catalogImportPreview.ts`): applies `Math.min(options.maxRecords, MAX_RECORDS_PER_PREVIEW)` before fetching; checks `payloadSizeBytes` after fetch
3. **Client layer** (`niroGraniteClient.ts`): `readBodyWithLimit()` streams the response and aborts if byte count exceeds `MAX_PAYLOAD_SIZE_BYTES` mid-stream; `mapFixturePage` checks serialized fixture page size

---

## 5. Record Limit

- Constant: `MAX_RECORDS_PER_PREVIEW = 500` (`schemas.ts`)
- Route validates `options.maxRecords ≤ 500` and returns HTTP 400 for out-of-range values
- Service clamps the limit: `Math.min(options.maxRecords ?? 500, 500)`
- Client clamps the limit: `Math.min(context.limit ?? 50, 500)` in both `mapFixturePage` and `fetchOfficialFeedJson`
- Exceeding the limit at the response level throws `CatalogPayloadTooLargeError`

---

## 6. Preview Route

```
POST /api/material-catalog/import-preview
```

**Authentication:** `adminAuth` middleware (ADMIN_API_KEY required)

**Request body:**
```json
{
  "providerId": "niro-granite-official",
  "options": {
    "dryRun": true,
    "maxRecords": 50,
    "cursor": "optional-pagination-cursor",
    "brand": "optional-brand-filter",
    "country": "optional-country-filter"
  }
}
```

**Guarantees:**
- `dryRun` must be exactly `true` — any other value returns HTTP 400
- Zero database writes
- Zero canonical material mutations
- Returns a structured `ImportReport` in the response body
- AbortSignal propagated from client disconnect via `req.on('close')`
- Feature flag (`MATERIAL_CATALOG_INTEGRATION_ENABLED`) checked on every call — returns HTTP 403 if disabled

**Also available:**
```
GET /api/material-catalog/providers
```
Returns feature flag states and registered provider list (admin-only, no side effects).

---

## 7. Admin Preview UI

Path: `/admin/material-catalog-preview`  
Source: `artifacts/ai-platform/src/pages/material-catalog-preview.tsx`

**Features:**
- Provider status panel (both feature flags, registered providers, capabilities)
- Config validation display
- Preview execution controls (provider, maxRecords, brand filter, country filter)
- Results: status badge, counts (received / valid / invalid / new / exact dup / possible dup)
- Warnings and errors accordion
- Normalized item table with thumbnail preview, classification badges, media URLs
- Pagination (next/prev via cursor)
- Source metadata panel
- Raw export report (JSON, collapsible)

**Explicitly absent** (by design): Import, Save, Sync, Overwrite, Merge buttons.

---

## 8. Tests

### Phase 4 test files

| File | Coverage |
|---|---|
| `tests/niroGraniteProvider.test.ts` | Config validation, mapping, pagination, fixture client, AbortSignal, live feed client (timeout/retry/rate-limit/auth/malformed/oversized), feature flags, registration, duplicate detection, media validation, dryRun rejection, record limits |
| `tests/materialCatalogRouteAuth.test.ts` | adminAuth middleware (allow/reject), feature flag gate, dryRun=false rejection (route logic), payload size constants |

### Pre-existing Phase 1–3 test files (regression)

| File | Domain |
|---|---|
| `tests/catalogImportPreview.test.ts` | Preview service (dryRun, oversized, error handling) |
| `tests/catalogProvider.test.ts` | Mock provider contract and behavior |
| `tests/providerRegistry.test.ts` | Provider registry lifecycle |
| `tests/catalogDuplicateDetector.test.ts` | Duplicate detection |
| `tests/catalogNormalizer.test.ts` | Normalization |
| `tests/catalogImportService.test.ts` | Import service |

---

## 9. Builds

All builds verified clean:
- `pnpm --filter @workspace/api-server run build` — ✅
- `pnpm --filter @workspace/ai-platform run typecheck` — ✅ (Vite dev hot-reload active)
- `pnpm run typecheck:libs` — ✅

---

## 10. UAT

### A. Flags OFF (default)

- `MATERIAL_CATALOG_INTEGRATION_ENABLED` not set → `false`
- `MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED` not set → `false`
- `registerOfficialMaterialProviders()` returns `{ registered: false, reason: "MATERIAL_CATALOG_INTEGRATION_ENABLED is false." }`
- `GET /api/material-catalog/providers` returns `{ catalogEnabled: false, niroGraniteEnabled: false, registeredProviders: [], totalRegistered: 0 }`
- `POST /api/material-catalog/import-preview` returns HTTP 403 with `{ error: "Material catalog integration is disabled" }`
- Material Library unchanged ✅
- Material Intelligence unchanged ✅

### B. Development preview (flags ON, fixture mode)

Set temporarily for dev UAT:
```
MATERIAL_CATALOG_INTEGRATION_ENABLED=true
MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED=true
```

Verified:
- Provider validation passes (fixture mode) ✅
- Provider registered in registry ✅
- Preview route returns structured ImportReport ✅
- Pagination works (cursor-based offset) ✅
- Duplicate detection classifies items ✅
- Normalized output matches ExternalCatalogItem schema ✅
- AbortSignal propagated to provider ✅
- Timeout enforced by provider client (configurable via `MATERIAL_NIRO_GRANITE_TIMEOUT_MS`) ✅
- Invalid credentials handled (fixture mode bypasses; feed mode rejects with CatalogFetchError(authentication)) ✅
- Payload limit enforced (>10 MB → CatalogResponseTooLargeError) ✅
- Record limit enforced (>500 → CatalogPayloadTooLargeError) ✅
- No DB writes confirmed (no DB import in catalogImportPreview.ts) ✅
- No canonical material mutations ✅

After UAT:
- Both flags cleared/unset → provider inactive ✅
- Restart → provider not registered ✅

---

## 11. Remaining Limitations

1. **Live source blocked**: `fetchOfficialFeedJson` is implemented and tested, but `liveFetchEnabled: false` prevents actual fetching until an approved feed URL and credentials are confirmed with Niro Granite.
2. **No persistence of preview reports**: Import reports are in-memory only. There is no audit trail of preview runs in the database (by design for Phase 4).
3. **Single provider**: Only `niro-granite-official` is registered. The architecture supports multiple providers via the registry.
4. **Admin UI i18n**: The Material Catalog Preview nav item label falls back to the translation key (`nav.items.materialCatalogPreview`) until the i18n locale files are updated.
5. **No production migration needed**: Phase 4 adds no new database tables or migrations.

---

## 12. Phase 5 Recommendations

1. **Confirm official feed access**: Obtain Niro Granite API credentials and confirm the HTTPS feed endpoint. Set `MATERIAL_NIRO_GRANITE_LIVE_FETCH_ENABLED=true` + `MATERIAL_NIRO_GRANITE_FEED_URL=<url>` only in dev first.
2. **Preview report persistence**: Add an `ai_catalog_preview_runs` table to store preview run metadata (not items) for audit trail. Items should remain in-memory only.
3. **Controlled import workflow**: Build an admin-gated, multi-step "approve and import" flow that writes valid new items to the canonical `ai_materials` table after explicit human review.
4. **Additional providers**: Extend the provider registry with other Indonesian material suppliers (Essenzo, Roman Ceramics, etc.) using the same `MaterialCatalogProvider` interface.
5. **i18n completion**: Add `nav.items.materialCatalogPreview` to Indonesian and English locale files.
6. **Scheduled sync**: Add a scheduler trigger that calls the preview route on a daily cadence and alerts on unexpected changes (new items, sudden large invalid counts).

---

## 13. Files Created / Modified

### Created (Phase 4)

- `artifacts/api-server/src/routes/material-catalog-integration.ts` — preview route + providers status route
- `artifacts/api-server/src/domains/material-catalog-integration/tests/niroGraniteProvider.test.ts` — 60+ Phase 4 tests
- `artifacts/api-server/src/domains/material-catalog-integration/tests/materialCatalogRouteAuth.test.ts` — admin auth + route validation tests
- `artifacts/ai-platform/src/pages/material-catalog-preview.tsx` — admin preview UI
- `docs/material-phase4-official-provider-report.md` — this report

### Modified (strictly additive)

- `artifacts/api-server/src/domains/material-catalog-integration/catalogImportPreview.ts` — added optional `abortSignal?: AbortSignal` to `RunImportPreviewParams`; threaded to `fetchCatalog` call
- `artifacts/api-server/src/routes/index.ts` — import + `router.use()` for `materialCatalogIntegrationRouter`
- `artifacts/ai-platform/src/App.tsx` — import + route for `MaterialCatalogPreview`
- `artifacts/ai-platform/src/components/layout.tsx` — nav item for `/material-catalog-preview`

### Not modified

- Phase 1 domain: `material-library/` — unchanged
- Phase 2 domain: `material-intelligence/` — unchanged
- Phase 3 domain: all existing Phase 3 files except the additive AbortSignal addition — unchanged
- Canonical materials table — no schema changes
- Any production registration or startup activation

---

## Final Verdict

**B. PHASE 4 FOUNDATION COMPLETE — LIVE SOURCE BLOCKED**

The official provider architecture, registration gating, dry-run preview service and route, payload and record enforcement, admin UI, and test suite are all complete. The live Niro Granite feed integration is intentionally blocked (`liveFetchEnabled: false`) until a confirmed official source endpoint and credentials are provided. No production deployment or Phase 5 work should begin until live source access is validated.
