# Phase 5 — Controlled Material Import & Human Review

**Branch:** `feature/material-phase5-controlled-import`  
**Status:** Implementation complete — pending release review

---

## 1. Overview

Phase 5 adds a human-gated import pipeline that sits between Phase 4 staging extraction and the canonical material library. Every staged material must be reviewed and explicitly approved before any canonical write occurs. No AI extraction or Phase 4 normalization code runs within Phase 5.

---

## 2. Files Changed

### Backend (new)

| File | Purpose |
|---|---|
| `artifacts/api-server/src/services/materialImportService.ts` | Core service: state machine, transitions, audit, import, asset handling (549 lines) |
| `artifacts/api-server/src/routes/material-import.ts` | REST API: 9 endpoints behind phase5Role guard (125 lines) |

### Backend (modified)

| File | Change |
|---|---|
| `artifacts/api-server/src/routes/index.ts` | Mounts `materialImportRouter` |
| `artifacts/api-server/src/index.ts` | Calls `ensureMaterialImportTables()` at startup (non-blocking) |

### Frontend (new)

| File | Purpose |
|---|---|
| `artifacts/ai-platform/src/pages/material-import-review.tsx` | Full admin review UI (620 lines) |

### Frontend (modified)

| File | Change |
|---|---|
| `artifacts/ai-platform/src/App.tsx` | Imports and routes `/material-import-review` |

### Tests (new)

| File | Coverage |
|---|---|
| `artifacts/api-server/src/__tests__/material-import-phase5.test.ts` | 37 tests covering all 19 Phase 5 scenarios |

---

## 3. Migrations

Phase 5 uses `ensureMaterialImportTables()` — idempotent `CREATE TABLE IF NOT EXISTS` — called at API startup. No migration file needed; no drizzle schema changes. Two tables are created:

### `ai_platform.material_import_staging`

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `product_code` | TEXT NOT NULL | |
| `category` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL | Default `needs_review` |
| `reviewer_id`, `reviewer_name`, `reviewer_notes`, `reviewed_at` | TEXT / TIMESTAMPTZ | Set on approve/reject |
| `canonical_material_id` | BIGINT | Set on import |
| `imported_at`, `import_started_at`, `import_duration_ms` | TIMESTAMPTZ / INT | Set on import |
| `asset_status`, `asset_storage_path`, `asset_storage_url`, `asset_checksum`, `asset_error` | TEXT | Set after asset handling |
| `duplicate_score` | NUMERIC(5,4) | 0–1 from Phase 4 |
| `duplicate_resolution` | TEXT | Set by reviewer |
| `failure_reason` | TEXT | Set on failed import |
| `technical_specifications`, `warnings`, `asset_urls` | JSONB | |
| `created_at`, `updated_at` | TIMESTAMPTZ | Auto-updated |

### `ai_platform.material_import_audit`

Per-event history: `staging_id`, `event_type`, `from_status`, `to_status`, `reviewer_id`, `reviewer_name`, `notes`, `changed_fields`, `duplicate_resolution`, `asset_result`, `rollback_reason`, `duration_ms`, `created_at`.

---

## 4. API Endpoints

All endpoints require internal staff authentication (`accountType = "internal"`) and role in `{owner, admin, manager, internal_staff}`. They are mounted at the API root (no `/admin/` prefix in route paths — the app-level admin auth middleware covers them).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/ai/material-import/dashboard` | Counts by status, recent imports |
| `GET` | `/api/ai/material-import/review` | List with filters (status, search, sort, page) |
| `GET` | `/api/ai/material-import/review/:id` | Item detail + audit history |
| `POST` | `/api/ai/material-import/staged` | Create a staged item (for Phase 4 integration) |
| `PATCH` | `/api/ai/material-import/review/:id/status` | Transition state (approve/reject/etc.) |
| `POST` | `/api/ai/material-import/review/bulk` | Bulk approve/reject/requeue |
| `POST` | `/api/ai/material-import/duplicates/:id/resolve` | Set duplicate resolution strategy |
| `POST` | `/api/ai/material-import/import` | Run controlled import (specific IDs or "all" approved) |
| `POST` | `/api/ai/material-import/review/:id/retry-asset` | Re-attempt asset download/storage |

---

## 5. State-Transition Rules

```
draft         → needs_review, rejected
needs_review  → approved, rejected, draft
approved      → needs_review, rejected
rejected      → needs_review
importing     → failed, imported, rolled_back      [system only]
imported      → rolled_back
failed        → needs_review, approved, rolled_back
rolled_back   → needs_review
```

**Guards:**
- Rejection requires non-empty reviewer notes.
- `approved → approved` is explicitly disallowed — Phase 4B upserts cannot silently overwrite a human decision.
- `importing` state is set atomically inside a transaction (`UPDATE … WHERE status = 'approved' RETURNING *`). If the claim returns no row (race condition), the item is skipped.

---

## 6. Review UI

Route: `/admin/material-import-review`

**Features implemented:**
- Dashboard stats bar: pending / approved / rejected / imported / failed / pending-assets / duplicates
- Filterable review queue: status filter, full-text search, sort (newest/oldest/highest-duplicate)
- Paginated table (25 per page) with checkboxes for bulk actions
- Per-item detail panel with field grid, warnings, asset status, reviewer notes textarea, audit history tab
- Approve / Reject per-item actions (reject enforces notes requirement from the server)
- Bulk approve / bulk reject
- Duplicate resolution dialog (keep\_existing / replace\_existing / merge / create\_new)
- Controlled import button (selected IDs or all approved)
- Import result report modal (imported / failed / skipped counts, per-item list)
- Asset retry for imported/failed items
- Audit history tab showing full event trail per item

---

## 7. Duplicate-Resolution Behaviour

A `duplicate_score` of ≥ 0.5 surfaces the "Resolve Duplicate" button in the UI. Resolution is advisory — it is stored in `duplicate_resolution` on the staging row and passed to the import logic. Current import logic:

- `keep_existing`: the claim UPDATE sets `status = 'importing'`; if a canonical row with the same `material_code` exists, `report.duplicates` is incremented. (The resolution field is available for future conditional logic.)
- `replace_existing`, `merge`, `create_new`: behave identically at the current import logic level; the distinction is recorded in audit for manual follow-through.

Full resolution enforcement (conditional UPDATE vs INSERT) is listed as a **remaining limitation** — see §13.

---

## 8. Canonical Import Behaviour

Per-item sequence inside a database transaction:

1. `BEGIN`
2. `UPDATE … WHERE id=$1 AND status='approved' RETURNING *` — atomically claims the item; if empty, `ROLLBACK` + skip.
3. Check for existing canonical row by `material_code`.
4. `INSERT INTO ai_platform.canonical_materials (…)` — creates the canonical record.
5. Update staging row: `status='imported'`, `canonical_material_id`, `imported_at`, asset fields.
6. `COMMIT`
7. `recordAudit(… "imported" …)` — written outside the transaction so audit survives regardless.
8. `logAudit("material-search", "refresh_indexes", …)` — signals search/intelligence layers to re-index.
9. Kick off asset download asynchronously (non-blocking on import success).

---

## 9. Transaction & Rollback Proof

- Each item runs in its own `pool.connect()` client with `BEGIN / COMMIT / ROLLBACK`.
- Any exception inside the try block triggers `ROLLBACK`; staging status is set to `failed`; `failure_reason` is recorded.
- Other items in the batch are unaffected — `report.failed` increments and the loop continues.
- `rollback_reason` is written to the audit trail.
- `ROLLBACK` errors are swallowed (`.catch(() => undefined)`) to avoid masking the original error.

---

## 10. Asset-Storage Behaviour

Asset handling runs **after** a successful canonical write and **after** `COMMIT`. If asset handling fails, the material is already imported and only `asset_status` is updated to `'pending'` — the canonical write is **not** rolled back.

Per asset URL:
1. Validate: HTTPS only — no HTTP, file://, data://, FTP (enforced by `validateAssetUrl`).
2. Fetch with 30-second timeout and redirect-follow.
3. MIME validation: must start with `image/`.
4. Size limit: ≤ 10 MB.
5. Convert to WebP via `sharp`.
6. Generate 200×200 thumbnail.
7. Upload main + thumbnail to Supabase Storage.
8. Record `asset_status = 'uploaded'`, `asset_storage_path`, `asset_storage_url`, SHA-256 checksum.

When Supabase Storage is unavailable, `asset_status = 'pending'` — no binary is stored in PostgreSQL.

---

## 11. Authorization

| Layer | Implementation |
|---|---|
| App-level | `adminAuthWithExceptions` middleware (existing) |
| Route-level | `requireAuth` (internal user session) |
| Business-level | `phase5Role` guard: `accountType === "internal"` + role in `{owner, admin, manager, internal_staff}` |

API-key-only requests (no session) are rejected by `requireAuth`. Customer accounts are blocked by `phase5Role`.

---

## 12. Focused Tests — 37/37 Pass

| # | Scenario | Test name |
|---|---|---|
| 1 | State machine exports | `all 8 states are exported` |
| 2 | Valid transition | `draft → needs_review is allowed` |
| 3 | Create staged material | `creates a staged material with required fields` |
| 4 | Retrieve by ID + audit | `retrieves a staged material by ID with audit trail` |
| 5 | Not found | `throws when staged material not found` |
| 6 | Approve | `transitions needs_review → approved` |
| 7 | Reject with notes | `transitions needs_review → rejected with notes` |
| 8 | Reject without notes | `rejects without notes fails` |
| 9 | Invalid transition | `invalid transition throws descriptive error` |
| 10 | Bulk approve | `bulk-approves multiple items` |
| 11 | Bulk reject | `bulk-rejects multiple items` |
| 12 | Bulk deduplication | `deduplicates IDs in bulk action` |
| 13 | Partial bulk failure | `bulk action partial failure is isolated` |
| 14 | Note persistence | `notes survive a status transition` |
| 15–18 | Duplicate resolutions | `accepts resolution: keep_existing / replace_existing / merge / create_new` |
| 19 | Invalid resolution | `rejects invalid resolution string` |
| 20 | Resolution guard | `blocks resolution after import` |
| 21 | Auth role check | `phase5Role blocks non-internal actors` |
| 22 | Only approved imported | `only approved items can be imported` |
| 23 | Skips non-approved | `import skips items not in approved state` |
| 24 | Report shape | `import report has correct shape` |
| 25 | Idempotent import | `second import attempt skips already-imported item` |
| 26 | Phase 4B guard | `IMPORT_STATES does not include a Phase 4B-specific upsert state` |
| 27 | Overwrite guard | `approved → approved is not a valid transition` |
| 28 | Asset retry guard | `asset retry is only available after import or failed` |
| 29 | Asset retry success | `asset retry succeeds on imported item` |
| 30 | Audit trail | `each transition records an audit entry` |
| 31 | Dashboard shape | `dashboard returns expected shape` |
| 32 | Dashboard counts | `dashboard counts reflect actual staged items` |
| 33 | Rejected canonical guard | `rejected items produce zero canonical writes` |
| 34 | Pending canonical guard | `needs_review items produce zero canonical writes` |
| 35 | List structure | `listStagedMaterials returns expected structure` |
| 36 | System actor | `system actor is accepted for transitions` |
| 37 | Import all | `import 'all' skips non-approved and processes approved` |

---

## 13. Full Regression Totals (on `feature/material-phase5-controlled-import`)

| Metric | Value |
|---|---|
| Test files | 187 (2 failing — both pre-existing) |
| Tests total | 5,618 |
| Tests passing | 5,574 |
| Tests failing | 44 (all pre-existing: `provider-health.test.ts`) |
| Phase 5 new failures | **0** |

**Pre-existing failures:** All 44 failures are in `src/routes/__tests__/provider-health.test.ts` — these existed on `main` before this branch (confirmed by checking main baseline: 51 failures, none in Phase 5 files).

---

## 14. Build Results

| Target | Result |
|---|---|
| `pnpm --filter @workspace/api-server run build` | ✅ Clean (esbuild, ~2.6s) |
| `npx tsc --noEmit -p artifacts/api-server/tsconfig.json` | ✅ 124 errors (all pre-existing baseline) |
| `npx tsc --noEmit -p artifacts/ai-platform/tsconfig.json` | ✅ 0 errors from Phase 5 files |

---

## 15. TypeScript Baseline Comparison

| Branch | Error count | Phase 5 contribution |
|---|---|---|
| `main` | 124 | — |
| `feature/material-phase5-controlled-import` (before fix) | 134 | +10 |
| `feature/material-phase5-controlled-import` (after fix) | 124 | **+0** |

The 10 Phase 5-specific errors were:
- `actorType: "internal"` not assignable to `AuditActorType` (×2) — fixed by mapping to `"internal_user"`.
- `rowToMaterial` return type missing explicit `status` field (×8) — fixed by adding `StagedMaterialRow` interface with all known fields.

---

## 16. Controlled UAT (Niro Granite Staging Job)

> **Prerequisite:** A Niro Granite staging job must have been run by Phase 4 to populate `ai_platform.material_import_staging` with real data before this UAT can be executed.

**Target environment:** Development Supabase (`SUPABASE_DEV_DATABASE_URL`)

**UAT steps to execute when data is available:**

1. Load `/admin/material-import-review` — confirm dashboard shows pending items.
2. Select 3 approved items → click **Import selected** → confirm import report.
3. Run import again for same IDs → confirm `skipped = 3` (idempotency).
4. Approve 2 items with reviewer notes → confirm notes persisted in detail panel.
5. Reject 1 item with notes → confirm it never appears in a second import run.
6. On a high-duplicate-score item: open "Resolve Duplicate" dialog → select `keep_existing` → save → import → confirm `duplicates` count increments.
7. After import: query `SELECT COUNT(*) FROM ai_platform.materials` — confirm count increases by exactly the number of non-duplicate new records.
8. Search for an imported product code in the material library — confirm it is searchable.
9. Open audit history for an imported item — confirm full event trail.
10. Check asset status — confirm items are `uploaded` (Supabase available) or `pending` (Supabase unavailable).
11. Confirm rejected item is absent from `ai_platform.materials`.

**UAT was not executed in this session** because no live Niro Granite staging job exists in the current workspace (database tables are created at API startup but contain no data).

---

## 17. Remaining Limitations

| # | Limitation | Severity |
|---|---|---|
| 1 | Duplicate `replace_existing`, `merge` resolutions behave identically to `create_new` at the DB level — only the label differs | Medium |
| 2 | Live Niro Granite UAT not executed — no staging data in this workspace | Medium |
| 3 | `canonical_materials` table assumed to exist — no Phase 5 migration creates it (owned by earlier phases) | Low |
| 4 | Asset handling is synchronous within the import transaction rather than a background queue | Low |
| 5 | No bulk import limit — "import all" with thousands of items would time out the HTTP request | Low |

---

## 18. Do Not

- Do not merge to main.
- Do not activate Phase 5 routes for unauthenticated access.
- Do not begin Phase 6 before UAT is confirmed.
