# Release History

**Repository:** Travelintrips/Core-AI-Foundation

This file records all completed releases. For detailed changes see `CHANGELOG.md` (Phase 5+) and individual phase documentation in `docs/`.

---

## material-v5.0.0 — 2026-07-26

**Tag commit:** `b5335e3`
**Current main:** `d330d84` (includes two post-release hotfixes)
**Report:** `docs/material-phase5-retrospective.md`

### Summary
Controlled Import & Human Review pipeline for the material library. Staged review queue, four duplicate resolution strategies, audit trail, and admin review UI.

### Major Changes
- `material_import_staging` + `material_import_audit` tables
- `materialImportService.ts` state machine
- Admin review queue UI with approve / reject / merge
- 37 focused import tests; 5,378 total regression tests pass

### Migration
- `20260725_material_library.sql` — canonical material tables
- `20260726_material_import_phase5.sql` — staging and audit tables (additive)

### Regression Status
- ✅ DEV PASS — 5,378/5,378 regression tests, 0% error rate
- ✅ Phase 5 hardening Verdict B — all 4 duplicate paths verified
- ✅ Enterprise UAT Verdict B — 98 Phase 3 foundation tests passed

### Post-release Hotfixes
| Commit | Fix |
|---|---|
| `66d0f2a` | i18n duplicate keys resolved; go-live review document added |
| `d330d84` | `materialImportRouter` scoped to `/ai/material-import` prefix |

### Known Issues at Release
- No active Replit deployment registered; privileged production smoke test not completed
- PluginManifest fragmentation (post-release tech debt)

---

## Phase 4 — Intelligence & OCR Layer (pre-v5)

**Approximate date:** Early–mid July 2026
**Report:** `docs/integration-material-intelligence-v2-final-report.md`, `docs/phase2-material-intelligence-validation-report.md`

### Summary
Material intelligence layer: vector/similarity search, auto-suggestions, usage analytics, and Indonesian alias resolution (e.g. `marmer` → `marble`). OCR extraction pipeline (Phase 4A) feeding raw material data into the import queue consumed by Phase 5.

### Major Changes
- `material-intelligence.ts` routes: `/material-library/search`, `/suggestions`, `/:id/similar`
- `materialAssignmentService.ts` — linking materials to project artifacts
- Indonesian language alias resolver
- Phase 3 foundation feature-flag gating (production default: `false`)

### Migration
Additive only — no schema breaking changes.

### Regression Status
- ✅ Phase 3 foundation: 98 tests passed (Verdict B — enterprise UAT)
- ✅ Cold search latency < 200 ms; warm latency < 1 ms

---

## Phase 3 — Foundation Hardening (pre-v5)

**Approximate date:** Early July 2026
**Report:** `docs/material-intelligence-v2-enterprise-uat-report.md`

### Summary
Hardening of the core material library (CRUD, category registry, assignment). Performance optimisation: N+1 elimination in `listDesignProjects` (42 → 4 DB round-trips). UI optimisations in `LayerPanel` using `React.memo`. Six new DB indexes applied.

### Major Changes
- `material-library.ts` routes — full CRUD and assignments
- `material-library-catalog.ts` — consumer catalog (search, brands, seeding)
- `materialLibraryService.ts` — core service layer
- 6 new database indexes
- `React.memo` applied to high-render-count components

### Migration
- `20260725_material_library.sql` foundations (canonical `materials` + `material_categories` tables)

### Regression Status
- ✅ RELEASE_CANDIDATE_REPORT_V1 — all critical gates PASS
- ✅ 5,300 tests passed across Teams 01–39 integration

---

## Phase 2 — Material Intelligence Validation (pre-v5)

**Approximate date:** Late June – early July 2026
**Report:** `docs/phase2-material-intelligence-validation-report.md`

### Summary
End-to-end validation of material intelligence endpoints against the development Supabase database. Routing bug resolved (stale API process restart). Performance verified.

### Regression Status
- ✅ Routing bug resolved
- ✅ All intelligence endpoints returning correct results

---

## Phase 1 — Core Material Library (pre-v5)

**Approximate date:** June 2026

### Summary
Initial material registry implementation. Category hierarchy, CRUD endpoints, basic search. First migration establishing `material_categories` and `materials` tables.

### Regression Status
- ✅ Passed (see `a26c1f5` — resume phase 1 remediation commit)

---

## Platform Foundation (Pre-Material Phases)

The following platform capabilities were built before the material library work began. They underpin all material library phases and are referenced as stable dependencies.

| Capability | Status |
|---|---|
| API server (Express + Drizzle ORM + Supabase) | ✅ Stable |
| AI job queue & worker cluster (Phase 5.2) | ✅ Stable |
| Admin portal (`/admin/`) | ✅ Stable |
| Customer portal (`/`) | ✅ Stable |
| Production pipeline (5-stage) | ✅ Stable |
| AI provider registry (OpenAI, Anthropic, Gemini, Mistral, Cohere) | ✅ Stable |
| Event bus & audit log | ✅ Stable |
| Quotation & commercial flow | ✅ Stable |
| Object storage (Supabase S3-compatible) | ✅ Stable |
| Session auth (admin) + token auth (customer portal) | ✅ Stable |
