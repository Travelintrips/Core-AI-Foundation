# Changelog

All notable changes to this project are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [5.0.0] — 2026-07-26

**Tag:** `material-v5.0.0`
**Commit:** `b5335e3`
**Title:** Controlled Import & Human Review

### Summary

Material Phase 5 introduces a production-grade, human-in-the-loop import pipeline for the material library. All externally sourced material data (from OCR extraction, supplier sheets, or bulk uploads) now passes through a staged review queue before reaching the canonical `materials` table. Duplicate detection, four resolution strategies, and a complete audit trail are included.

### Added

#### Import Pipeline
- `material_import_staging` table — holds pending import records with status, duplicate score, and asset URLs
- `material_import_audit` table — immutable log of every status transition and reviewer action
- `materialImportService.ts` — state machine managing the full import lifecycle (`pending` → `reviewing` → `approved` / `rejected`)
- `POST /ai/material-import/review` — admin endpoint to approve, reject, or merge staged records
- `POST /ai/material-import/staged` — list staged records with filtering and pagination
- `GET /ai/material-import/dashboard` — import statistics for the admin dashboard

#### Duplicate Resolution
- Four strategies: `keep_existing`, `replace_existing`, `merge`, `create_new`
- Duplicate score computed at staging time using `material_code` + brand + category matching
- Merge strategy produces a new canonical record combining fields from both records with admin override

#### Admin Review UI
- Review queue page in admin panel (`/admin/`) with approve / reject / merge controls per staged record
- Diff view showing incoming vs existing record for duplicate candidates
- Audit trail panel showing full status history per record

#### Testing
- 37 focused Phase 5 import pipeline tests
- Auth guard tests for all new admin endpoints
- Hardening report: all 4 duplicate-resolution paths verified end-to-end

### Changed

- `materialImportRouter` scoped to `/ai/material-import` prefix (post-release fix — was incorrectly mounted globally)
- i18n translation files deduplicated (post-release fix — duplicate keys caused runtime warnings)

### Security

- All import endpoints require admin API key authentication
- Staged records are tenant-isolated — cross-tenant access blocked at query level
- Asset URLs validated before storage path assignment (SSRF guard)
- Reviewer identity logged in `material_import_audit` for every action

### Migration

Two new migration files applied in order:

1. `artifacts/api-server/src/migrations/20260725_material_library.sql` — canonical material tables
2. `artifacts/api-server/src/migrations/20260726_material_import_phase5.sql` — staging and audit tables

All tables created in the `ai_platform` schema (not `public`). Migrations are additive — no existing data modified.

### Testing

| Suite | Count | Result |
|---|---|---|
| Phase 5 focused (import pipeline) | 37 | ✅ All passed |
| Material library total | ~188 | ✅ All passed |
| Full regression | 5,378 | ✅ 0% error rate |

### Known Limitations

- Active Replit deployment was not registered at release time; production smoke test (privileged) was not completed
- PluginManifest fragmentation noted as post-release technical debt
- Material recommendation engine (Phase 2/3 intelligence) remains feature-flag gated (`false` by default in production)
- CHANGELOG was not created at tag time (back-filled in retrospective phase)

---

## [4.x] — Prior Phases

See `docs/release-history.md` for complete pre-Phase-5 release history.

---

[5.0.0]: https://github.com/Travelintrips/Core-AI-Foundation/releases/tag/material-v5.0.0
