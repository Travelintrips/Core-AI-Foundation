# Material v5.0.1 Baseline Snapshot

**Snapshot date:** 2026-07-27  
**Repository:** `Travelintrips/Core-AI-Foundation`  
**Scope:** Static baseline of the repository as it exists now. This document does not start Phase 6, apply migrations, or assert production state.

## 1. Release identity and git state

| Item | Current evidence |
|---|---|
| Current branch | `main` |
| `HEAD` | `b5fd8edd7a6efe35940c9a09443c3070a2dcf118` |
| `origin/main` | `b5fd8edd7a6efe35940c9a09443c3070a2dcf118` |
| Ahead / behind | 0 ahead, 0 behind — exactly synchronized |
| Local `material-v5.0.1` tag | **Present.** Annotated tag created at `b5fd8edd7a6efe35940c9a09443c3070a2dcf118` during this normalization task. |
| Remote `material-v5.0.1` tag | **Not verified — authentication blocked.** `git ls-remote --tags origin` returned "Invalid username or token. Password authentication is not supported for Git operations." Remote tag state cannot be independently confirmed from this workspace. |
| Phase 6 branch | No local `phase6/*` branch and no visible `origin/phase6/*` or `gitsafe-backup/phase6/*` branch |
| Older release references | Existing reports refer to `material-v5.0.0` and older commits; those references are historical, not current release proof |

`HEAD` and `origin/main` are now identical. The local annotated tag `material-v5.0.1` points to the synchronized main SHA. The tag cannot be pushed to origin due to GitHub authentication failure; remote tag state remains unverified.

## 2. Repository cleanliness

The working tree is clean except for one untracked user-upload artifact:

```text
attached_assets/Pasted-FINAL-TASK-REPOSITORY-BASELINE-NORMALIZATION-Repository_1785157898002.txt
```

This file is a user-supplied instruction upload and is intentionally excluded from all commits. No application code, migration, or business logic was modified. The only changes in this normalization task are: (1) this baseline document update and (2) creation of the local annotated tag `material-v5.0.1`.

## 3. Architecture inventory

The repository is a pnpm workspace with these registered artifacts:

| Area | Location | Role |
|---|---|---|
| Customer portal | `artifacts/customer-portal` | React 19 + Vite customer-facing web application at `/` |
| Admin platform | `artifacts/ai-platform` | React 19 + Vite internal portal at `/admin/` |
| API server | `artifacts/api-server` | Express 5 + TypeScript/esbuild API at `/api` |
| Canvas sandbox | `artifacts/mockup-sandbox` | Vite component preview server at `/__mockup` |
| Shared libraries | `lib/*` | Database schema, generated API clients/schemas, design workflow and shared UI packages |
| Workspace scripts | `scripts` | Verification, migration, security and operational scripts |

The API uses Supabase/PostgreSQL in the `ai_platform` schema, Drizzle schema definitions under `lib/db/src/schema`, Supabase object storage for assets, and provider integrations for AI generation. The API startup process also starts the dispatcher, scheduler, and provider-health alert service in development.

## 4. Material domain inventory

### Canonical material library

- `lib/db/src/schema/material-library.ts` defines `material_categories` and `materials`.
- `artifacts/api-server/src/domains/material-library/` contains the catalog repository/service/seed implementation.
- `artifacts/api-server/src/services/material-library/` contains the universal material service, assignment service, category registry, plugin contract, types, and related tests.
- The Phase 1 catalog migration is `artifacts/api-server/src/migrations/20260725_material_library.sql`.
- Startup calls `ensureMaterialLibraryTables()` and conditionally seeds an empty/below-baseline catalog.

### Material intelligence

- `artifacts/api-server/src/domains/material-intelligence/` contains aliases, normalization, caching, search, similarity, suggestions, and analytics.
- The intelligence router provides search, suggestions, similar-material lookup, and analytics.
- Existing tests cover material intelligence, catalog behavior, prompts, seed behavior, service behavior, and analytics authorization.

### Controlled material import and review

- `artifacts/api-server/src/services/materialImportService.ts` implements staging, review transitions, duplicate resolution, import, retry, and audit behavior.
- `artifacts/api-server/src/routes/material-import.ts` mounts the controlled review API under `/api/ai/material-import/*`.
- The Phase 5 migration creates `material_import_staging` and `material_import_audit`.
- Startup calls `verifyMaterialImportTables()` non-blockingly.
- Internal review requires a valid internal session and one of `owner`, `admin`, `manager`, or `internal_staff`.

### Asset domain

- Customer asset library: `lib/db/src/schema/ai-asset-library.ts` and `artifacts/api-server/src/services/assetLibraryService.ts`.
- Asset intelligence: `lib/db/src/schema/ai-asset-intelligence.ts` and `artifacts/api-server/src/services/assetIntelligenceService.ts`.
- Universal asset browser: `artifacts/api-server/src/services/assetBrowserService.ts`.
- Asset intelligence v2: `artifacts/api-server/src/services/asset-intelligence-v2/` and `routes/asset-intelligence-v2/`.
- Asset download access is signed/token-based in the customer library routes.

## 5. Dependency graph

```text
Customer portal / Admin portal
        │
        ├── generated API client + shared UI libraries
        │
        └── Express API (/api)
                │
                ├── global rate limiting, security hardening, CORS/Helmet
                ├── admin API key/session exceptions
                ├── material catalog services
                │       ├── material categories/materials
                │       ├── material intelligence
                │       ├── material assignments/plugins
                │       └── controlled import/review/audit
                ├── asset library/browser/intelligence services
                ├── job queue and dispatcher
                ├── AI scheduler and event bus
                └── Supabase PostgreSQL (ai_platform) + Supabase Storage
```

The material library depends on the database schema and Supabase connection, while the controlled importer additionally depends on internal authentication and storage/asset processing. Material intelligence is additive beside the Phase 1 catalog router. Asset intelligence v2 is mounted by the current `routes/index.ts`, despite a stale source comment saying that Team 24 had not yet wired it.

## 6. Verified material and asset API endpoints

**Path convention:** `app.ts` mounts the aggregate router at `/api`; paths below are final mounted paths. “Verified” means the route declaration and mount were found in current source. It does not mean a live request or production deployment test was performed.

**Global authentication:** Unless an exception applies, `/api` is protected by `adminAuthWithExceptions`. Admin-key authentication accepts `Authorization: Bearer`, `x-admin-key`, or `x-admin-api-key`; an active internal session cookie is also accepted. Public customer routes use their own token/session guard.

### Material endpoints — 28

| # | Method | Final mounted path | Source router | Authentication | Authorization | Purpose | Evidence |
|---:|---|---|---|---|---|---|---|
| 1 | GET | `/api/ai/materials/categories` | `routes/material-library.ts` | Admin API key/session via global middleware | Platform/admin context from global admin gate | List universal material categories | Verified |
| 2 | GET | `/api/ai/materials/plugins` | `routes/material-library.ts` | Admin API key/session via global middleware | Platform/admin context from global admin gate | List registered material plugins | Verified |
| 3 | GET | `/api/ai/materials` | `routes/material-library.ts` | Admin API key/session via global middleware | Context synthesized by service; tenant query fallback exists in current code | Search/list universal materials | Verified |
| 4 | GET | `/api/ai/materials/:id` | `routes/material-library.ts` | Admin API key/session via global middleware | Context synthesized by service | Read one universal material | Verified |
| 5 | POST | `/api/ai/materials` | `routes/material-library.ts` | Admin API key/session via global middleware | Service context and platform-level input rules | Create a universal material | Verified |
| 6 | PATCH | `/api/ai/materials/:id` | `routes/material-library.ts` | Admin API key/session via global middleware | Service context and material access rules | Update a universal material | Verified |
| 7 | DELETE | `/api/ai/materials/:id` | `routes/material-library.ts` | Admin API key/session via global middleware | Service context and material access rules | Delete a universal material | Verified |
| 8 | GET | `/api/ai/materials/for-artifact/:artifactId/assignments` | `routes/material-library.ts` | Admin API key/session via global middleware | Global admin gate; assignment lookup is artifact-scoped | List assignments for an artifact | Verified |
| 9 | POST | `/api/ai/materials/assignments/validate` | `routes/material-library.ts` | Admin API key/session via global middleware | Service context and assignment validation | Dry-run material assignment validation | Verified |
| 10 | POST | `/api/ai/materials/assignments` | `routes/material-library.ts` | Admin API key/session via global middleware | Service context and assignment rules | Create a material assignment | Verified |
| 11 | GET | `/api/material-library/categories` | `routes/material-library-catalog.ts` | Public exception in `adminAuth.ts` | Catalog read; no inactive catalog access through this exception | List catalog categories | Verified |
| 12 | GET | `/api/material-library/brands` | `routes/material-library-catalog.ts` | Public exception in `adminAuth.ts` | Catalog read | List distinct brands | Verified |
| 13 | GET | `/api/material-library` | `routes/material-library-catalog.ts` | Public exception in `adminAuth.ts` | Catalog read; `status=inactive` has an in-route admin check when configured | Search/list catalog materials | Verified |
| 14 | GET | `/api/material-library/:id` | `routes/material-library-catalog.ts` | Public exception in `adminAuth.ts` | Catalog read | Read one catalog material | Verified |
| 15 | POST | `/api/material-library/seed` | `routes/material-library-catalog.ts` | Admin API key/session via global middleware | Admin-only seed operation | Trigger idempotent catalog seed | Verified |
| 16 | GET | `/api/material-library/search` | `routes/material-intelligence.ts` | Public GET exception in `adminAuth.ts` | Aggregate material search; no analytics authorization | Intelligent material search | Verified |
| 17 | GET | `/api/material-library/suggestions` | `routes/material-intelligence.ts` | Public GET exception in `adminAuth.ts` | Aggregate suggestion lookup | Material suggestions | Verified |
| 18 | GET | `/api/material-library/:id/similar` | `routes/material-intelligence.ts` | Public GET exception in `adminAuth.ts` | Aggregate similarity lookup | Find similar materials | Verified |
| 19 | GET | `/api/material-library/intelligence/analytics` | `routes/material-intelligence.ts` | Admin API key/session via global middleware | Admin-only aggregate operational analytics | Read material intelligence analytics | Verified |
| 20 | GET | `/api/ai/material-import/dashboard` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Read import dashboard | Verified |
| 21 | GET | `/api/ai/material-import/review` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | List staged materials for review | Verified |
| 22 | GET | `/api/ai/material-import/review/:id` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Read one staged material | Verified |
| 23 | POST | `/api/ai/material-import/staged` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Create a staged material | Verified |
| 24 | PATCH | `/api/ai/material-import/review/:id/status` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Transition a staged material | Verified |
| 25 | POST | `/api/ai/material-import/review/bulk` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Bulk transition staged materials | Verified |
| 26 | POST | `/api/ai/material-import/duplicates/:id/resolve` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Resolve a duplicate | Verified |
| 27 | POST | `/api/ai/material-import/import` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Import approved materials | Verified |
| 28 | POST | `/api/ai/material-import/review/:id/retry-asset` | `routes/material-import.ts`, mounted at `/ai/material-import` | Global admin gate plus internal session `requireAuth` | Active internal account with Phase 5 role | Retry staged asset processing | Verified |

### Asset endpoints — 44

| # | Method | Final mounted path | Source router | Authentication | Authorization | Purpose | Evidence |
|---:|---|---|---|---|---|---|---|
| 29 | GET | `/api/ai/asset-browser/sources` | `routes/asset-browser.ts` | Admin API key/session via global middleware | Admin asset-browser context | List asset sources | Verified |
| 30 | GET | `/api/ai/asset-browser/assets` | `routes/asset-browser.ts` | Admin API key/session via global middleware | Platform admin may query cross-tenant; filters are validated in router | List/search/filter assets | Verified |
| 31 | GET | `/api/ai/asset-browser/assets/:id` | `routes/asset-browser.ts` | Admin API key/session via global middleware | Admin asset access; optional email hash filter | Read one asset-browser item | Verified |
| 32 | PATCH | `/api/ai/asset-browser/assets/:id/archive` | `routes/asset-browser.ts` | Admin API key/session via global middleware | Admin asset archive/restore | Archive or restore an asset | Verified |
| 33 | POST | `/api/ai/asset-intelligence/analyze` | `routes/asset-intelligence.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Analyze an asset | Verified |
| 34 | POST | `/api/ai/asset-intelligence/analyze/:assetId` | `routes/asset-intelligence.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Analyze an identified asset | Verified |
| 35 | GET | `/api/ai/asset-intelligence/:assetId` | `routes/asset-intelligence.ts` | Admin API key/session via global middleware | Admin-only because no public exception is configured | Read asset intelligence | Verified |
| 36 | GET | `/api/ai/asset-intelligence/duplicates/:clientId` | `routes/asset-intelligence.ts` | Admin API key/session via global middleware | Admin-only because no public exception is configured | Read duplicate report | Verified |
| 37 | GET | `/api/ai/asset-intelligence/client/:clientId` | `routes/asset-intelligence.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | List client asset intelligence | Verified |
| 38 | GET | `/api/public/customer/workspace/:token/asset-intelligence` | `routes/asset-intelligence.ts` | Workspace token | `resolveWorkspaceSession`; client is derived from token | Read customer asset intelligence and duplicates | Verified |
| 39 | POST | `/api/public/customer/workspace/:token/asset-intelligence/analyze/:assetId` | `routes/asset-intelligence.ts` | Workspace token | `resolveWorkspaceSession`; client is derived from token | Analyze a customer workspace asset | Verified |
| 40 | GET | `/api/public/customer/workspace/:token/assets` | `routes/asset-library.ts` | Workspace token | Token-derived email hash/tenant scope | List/search customer assets | Verified |
| 41 | GET | `/api/public/customer/workspace/:token/assets/:id` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Read one customer asset | Verified |
| 42 | GET | `/api/public/customer/workspace/:token/assets/:id/history` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Read asset version history | Verified |
| 43 | POST | `/api/public/customer/workspace/:token/assets` | `routes/asset-library.ts` | Workspace token | Token-derived customer ownership | Create an asset-library item | Verified |
| 44 | POST | `/api/public/customer/workspace/:token/assets/:id/replace` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Replace an asset with a new version | Verified |
| 45 | PATCH | `/api/public/customer/workspace/:token/assets/:id/rename` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Rename an asset | Verified |
| 46 | POST | `/api/public/customer/workspace/:token/assets/:id/favorite` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Toggle favorite state | Verified |
| 47 | POST | `/api/public/customer/workspace/:token/assets/:id/archive` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Archive an asset | Verified |
| 48 | PATCH | `/api/public/customer/workspace/:token/assets/:id/tags` | `routes/asset-library.ts` | Workspace token | Token-derived ownership | Replace asset tags | Verified |
| 49 | POST | `/api/public/customer/workspace/:token/assets/:id/sign` | `routes/asset-library.ts` | Workspace token | Token-derived ownership; signed download generated server-side | Create signed asset download access | Verified |
| 50 | POST | `/api/public/customer/workspace/:token/assets/promote/:sourceAssetId` | `routes/asset-library.ts` | Workspace token | Token-derived ownership of source asset | Promote a creative asset into the library | Verified |
| 51 | GET | `/api/ai/asset-library/stats` | `routes/asset-library.ts` | Admin API key/session via global middleware | Admin asset-library statistics | Read admin asset-library stats | Verified |
| 52 | POST | `/api/ai/asset-intelligence/v2/analyze/:assetId` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Run v2 analysis | Verified |
| 53 | POST | `/api/ai/asset-intelligence/v2/analyze-batch` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Run v2 batch analysis | Verified |
| 54 | GET | `/api/ai/asset-intelligence/v2/client/:clientId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | List v2 intelligence for a client | Verified |
| 55 | GET | `/api/ai/asset-intelligence/v2/duplicates/:clientId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Read v2 duplicate report | Verified |
| 56 | GET | `/api/ai/asset-intelligence/v2/similar/:assetId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Find similar assets in v2 | Verified |
| 57 | GET | `/api/ai/asset-intelligence/v2/:assetId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Read v2 intelligence | Verified |
| 58 | GET | `/api/ai/asset-intelligence/v2/version-chains/:clientId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | List version chains | Verified |
| 59 | GET | `/api/ai/asset-intelligence/v2/version-chain/:chainId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Read one version chain | Verified |
| 60 | POST | `/api/ai/asset-intelligence/v2/version-chains/auto-group` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Auto-group asset versions | Verified |
| 61 | POST | `/api/ai/asset-intelligence/v2/version-chains` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Create a version chain | Verified |
| 62 | POST | `/api/ai/asset-intelligence/v2/version-chains/:chainId/members` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Add a chain member | Verified |
| 63 | GET | `/api/ai/asset-intelligence/v2/licensing/:assetId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Read licensing metadata | Verified |
| 64 | PUT | `/api/ai/asset-intelligence/v2/licensing/:assetId` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Upsert licensing metadata | Verified |
| 65 | GET | `/api/ai/asset-intelligence/v2/safety/:assetId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Read asset safety result | Verified |
| 66 | GET | `/api/ai/asset-intelligence/v2/safety-report/:clientId` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | List unsafe assets for a client | Verified |
| 67 | GET | `/api/ai/asset-intelligence/v2/knowledge-tags` | `routes/asset-intelligence-v2/index.ts` | Admin API key/session via global middleware | Admin-only; no public GET exception | Read the v2 knowledge-tag taxonomy | Verified |
| 68 | POST | `/api/ai/asset-intelligence/v2/tags/normalize` | `routes/asset-intelligence-v2/index.ts` | Global admin gate plus explicit `adminAuth` | Admin API key or active internal session | Normalize tags and infer asset type | Verified |
| 69 | GET | `/api/public/customer/workspace/:token/asset-intelligence/v2` | `routes/asset-intelligence-v2/index.ts` | Workspace token | Token-derived customer scope; sensitive licensing fields redacted | List customer v2 intelligence | Verified |
| 70 | GET | `/api/public/customer/workspace/:token/asset-intelligence/v2/:assetId` | `routes/asset-intelligence-v2/index.ts` | Workspace token | Token-derived ownership check; licensing redacted | Read customer v2 intelligence | Verified |
| 71 | GET | `/api/public/customer/workspace/:token/asset-intelligence/v2/:assetId/similar` | `routes/asset-intelligence-v2/index.ts` | Workspace token | Token-derived customer scope | Find similar customer assets | Verified |
| 72 | GET | `/api/public/customer/workspace/:token/asset-intelligence/v2/:assetId/licensing` | `routes/asset-intelligence-v2/index.ts` | Workspace token | Token-derived customer scope; always redacted | Read redacted licensing metadata | Verified |

**Endpoint total:** 72 current declarations: 28 material/import and 44 asset/asset-intelligence. The endpoint count is source-derived, not a production smoke-test count.

## 7. Worker inventory

The current dispatcher registers three workers per running API process in `jobDispatcherService.ts`:

| Runtime worker name | Worker type | Main capabilities | Source evidence |
|---|---|---|---|
| `dispatcher-1` | `text_worker` | LLM inference, creative text, QC review, creative brief | `DISPATCHER_WORKERS`, `ensureWorkers()` |
| `dispatcher-2` | `image_worker` | Image generation/QC/upscale plus export, system, noop and custom capabilities | `DISPATCHER_WORKERS`, `ensureWorkers()` |
| `dispatcher-3` | `storage_worker` | Archive asset, optimize asset, generate thumbnail | `DISPATCHER_WORKERS`, `ensureWorkers()` |

The universal renderer is a dispatcher job handler, not a fourth registered worker. Startup logs from the current running API confirm worker registrations for `text_worker`, `image_worker`, and `storage_worker`.

## 8. Scheduler and poller inventory

Three named background services are started by current API startup:

1. **Job dispatcher** — development auto-start; polls jobs every 5 seconds and renews worker leases every 10 seconds.
2. **AI scheduler** — development auto-start; default schedule poll interval is 10 seconds. It handles cron, interval, one-time, event-follow-up, and deadline-reminder triggers.
3. **Provider health alert poller** — started at API startup; default provider health setting is every 5 minutes, with email/webhook delivery and SSRF validation for webhook URLs.

Startup also runs a one-shot incomplete-design-batch recovery scan when the dispatcher starts. Therefore:

- **Named scheduler/poller services:** 3.
- **Recurring runtime loops/timers identified in source:** 4 (dispatcher poll, dispatcher heartbeat, AI scheduler poll, provider-health poll).
- **One-shot startup recovery:** 1.

## 9. Database and RLS inventory

### Database

- Application database is Supabase PostgreSQL in schema `ai_platform`; the source uses shared Drizzle schema definitions and raw SQL with the project’s schema conventions.
- Material tables in current schema/migrations: `material_categories`, `materials`, `material_import_staging`, `material_import_audit`.
- Asset-related tables include `ai_asset_library`, `ai_asset_intelligence`, `ai_brand_kit_assets`, `ai_portfolio_assets`, `creative_ai_assets`, and marketplace asset tables.
- Supabase Storage bucket initialization for `ai-assets` is performed at API startup.
- Current startup logs show the development API connected to its configured Supabase storage/database environment and seeded material baseline behavior; this is not production evidence.

### RLS

- `scripts/migrations/rls-v12.sql` is the existing WP-12 RLS source.
- `scripts/migrations/rls-v13.sql` contains WP-13 RLS DDL for `material_import_staging` and `material_import_audit`.
- Static source evidence shows the Phase 5 table migration itself does not enable RLS.
- No direct `pg_policies` or production database query was performed for this baseline. The existing approval report explicitly states that direct database verification was unavailable from its environment.
- **RLS status:** not independently verified as applied in development or production. The existence of `rls-v13.sql` is migration-source evidence only.

## 10. Complete migration source inventory

The following inventory includes SQL migration sources in the repository’s migration directories plus named standalone migration/DDL sources. Presence of a file does not prove that it has been applied to any database.

### API migration directory — 9 files

| File | Classification |
|---|---|
| `artifacts/api-server/src/migrations/20260716_design_render_zip_exports.sql` | Unrelated |
| `artifacts/api-server/src/migrations/20260719_goal_taxonomy.sql` | Unrelated |
| `artifacts/api-server/src/migrations/20260719_service_normalization.sql` | Unrelated |
| `artifacts/api-server/src/migrations/20260721_ai_entity_versions.sql` | Unrelated |
| `artifacts/api-server/src/migrations/20260724_provider_health_logs.sql` | Unrelated |
| `artifacts/api-server/src/migrations/20260724_provider_health_tracking.sql` | Unrelated |
| `artifacts/api-server/src/migrations/20260725_material_library.sql` | Phase 5 material catalog |
| `artifacts/api-server/src/migrations/20260726_material_import_phase5.sql` | Phase 5 controlled material import |
| `artifacts/api-server/src/migrations/perf_team37_indexes.sql` | WP-13/security/performance hardening |

### Scripts migration directory — 18 SQL files

| File | Classification |
|---|---|
| `scripts/migrations/design-cost-attribution.sql` | Unrelated |
| `scripts/migrations/design-cost-attribution-v2.sql` | Unrelated |
| `scripts/migrations/indexes-v12.sql` | WP-13/security hardening |
| `scripts/migrations/p-cp-sprint-brief-guard.sql` | Unrelated |
| `scripts/migrations/p1-1-customer-workspace/migration.sql` | Unrelated |
| `scripts/migrations/p1-1-customer-workspace/preflight.sql` | Unrelated |
| `scripts/migrations/p25-commercial-layer.sql` | Unrelated |
| `scripts/migrations/p7-internal-rbac/migration.sql` | WP-13/security hardening |
| `scripts/migrations/p7-internal-rbac/preflight.sql` | WP-13/security hardening |
| `scripts/migrations/phase3a-design-batch.sql` | Unrelated |
| `scripts/migrations/rls-v12.sql` | WP-13/security hardening |
| `scripts/migrations/rls-v13.sql` | WP-13/security hardening; material import RLS |
| `scripts/migrations/seed-ai-sales-manager.sql` | Unrelated |
| `scripts/migrations/team08-design-lifecycle-additive.sql` | Unrelated |
| `scripts/migrations/v36-design-studio-tenant-isolation.sql` | WP-13/security hardening |
| `scripts/migrations/v4.2i-analytics.sql` | Unrelated |
| `scripts/migrations/v4.5-design-studio.sql` | Unrelated |
| `scripts/migrations/wp04-wp05-soft-delete.sql` | WP-13/security hardening |

The same directory also contains migration documentation (`README.md` and `rollback_notes.md` files); these are documentation sources, not executable migration files.

### Integration migration directory — 27 SQL files

| Files | Classification |
|---|---|
| `integration/migrations/preview-pipeline.sql`, `team-01.sql`, `team-02.sql`, `team-03.sql`, `team-04.sql`, `team-05.sql`, `team-06.sql`, `team-07.sql`, `team-08.sql`, `team-09.sql`, `team-10.sql`, `team-11.sql`, `team-12.sql`, `team-14.sql`, `team-15.sql`, `team-17.sql`, `team-17-concept-drafts.sql`, `team-17-concept-drafts-v2.sql`, `team-18.sql`, `team-18-revision.sql`, `team-19.sql`, `team-20.sql`, `team-21.sql`, `team-22.sql`, `team-28.sql`, `team-29.sql` | Unrelated to the current material-v5.0.1 baseline |
| `integration/migrations/tkl-v50.sql` | Unrelated; V5.0 template knowledge library |

`integration/migrations/team-21.sql` is material-domain historical integration input, but it is not the current authoritative Phase 5 migration; the authoritative current Phase 5 files are the two dated API migrations above.

### Other migration/DDL sources

| File | Classification |
|---|---|
| `lib/db/migrations/add-observability-tables.sql` | Unrelated |
| `docs/team-05-analytics-migration.sql` | Unrelated |
| `lib/db/src/scripts/migration_prod.sql` | Consolidated historical production DDL; application status not proven |
| `artifacts/api-server/src/scripts/ddl-asset-lifecycle.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-audit-log-tenant-actor.sql` | WP-13/security hardening DDL |
| `artifacts/api-server/src/scripts/ddl-automation.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-commercial-flow.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-cp-review.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-customer-workspace.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-portfolio-p2.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-portfolio-p3.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-quotations.sql` | Unrelated DDL |
| `artifacts/api-server/src/scripts/ddl-wp09-quotation-soft-delete.sql` | WP-13/security hardening DDL |
| `scripts/ddl-v42d.sql` | Unrelated DDL |

**Migration file count:** 55 executable `.sql` files in the four migration directories (`9 + 18 + 27 + 1`). Including the separately maintained `docs/team-05-analytics-migration.sql`, the migration/DDL source inventory contains 56 SQL files before the named standalone DDL files above. No application or production application claim is made.

## 11. Security baseline

Current source contains the following security controls:

- `adminAuthWithExceptions` is mounted once globally at `/api`; it combines admin API key and active internal session access with explicit public exceptions.
- Global rate limiting is mounted at `/api` (200 requests per IP per 15 minutes), with stricter route-level limits in selected sensitive flows.
- Helmet/security-hardening middleware, CORS, unknown-method blocking, request IDs, suspicious-request logging, and request counters are enabled in `app.ts`.
- Internal material review requires a valid session, active internal account, and an allowed Phase 5 role; role is read from the database rather than trusted from client input.
- Workspace asset routes resolve the session from a token and derive ownership server-side.
- Signed download access is used for customer asset downloads.
- SSRF validation is applied to provider-health webhook URLs.
- Tenant resolution and request-context security modules exist and have tests.
- The repository’s security documentation requires secrets in Replit Secrets rather than tracked configuration.

Security observations:

- The universal material router’s current `getContext()` implementation still falls back to a `tenantId` query parameter and synthesizes a system context. This is a source-level documentation/implementation conflict with the canonical tenant-resolution rule and should be treated as a review item.
- `material_import_staging` and `material_import_audit` have an RLS source migration, but applied database state is not verified.
- Development/admin middleware behavior can fail open when `ADMIN_API_KEY` is absent and `NODE_ENV=development`; production behavior is fail-closed.

## 12. Test and regression inventory

Current file-level inventory:

- 194 API-server test/spec files under `artifacts/api-server/src`.
- 30 test/spec files across the customer portal, admin platform, shared libraries, and scripts.
- 224 test/spec files total by file count; this is not a count of individual test cases.
- Material/asset-specific test files currently include:
  - `routes/__tests__/material-intelligence-analytics-auth.test.ts`
  - `services/material-library/__tests__/materialLibrary.test.ts`
  - `__tests__/asset-browser.test.ts`
  - `__tests__/material-import-phase5.test.ts`
  - `__tests__/material-intelligence.test.ts`
  - `__tests__/material-library-catalog.test.ts`
  - `__tests__/material-library-prompt.test.ts`
  - `__tests__/material-library-seed.test.ts`
  - `__tests__/team06-asset-intelligence-v2.test.ts`
  - `__tests__/v42d-asset-library.test.ts`
  - five material catalog integration tests under `domains/material-catalog-integration/tests/`

Existing source and reports show coverage for authentication, material catalog/intelligence, import transitions, asset browser, asset library, and asset intelligence v2. A complete current test run is not claimed in this baseline.

## 13. Measured versus unmeasured performance

### Measured/current runtime evidence

- The development API started successfully during the workspace setup and registered three dispatcher workers.
- The development API health endpoint returned HTTP 200 during setup.
- Vite customer/admin/canvas workflows started successfully during setup.
- Source-defined intervals are documented in Section 8.
- `perf_team37_indexes.sql` exists as a performance/index migration source.

### Not measured or not proven

- No production latency, throughput, error-rate, or capacity measurement was performed.
- No production smoke test was performed.
- No production deployment registration was verified.
- No load test or sustained worker throughput test was performed.
- No database query-plan or index effectiveness measurement was performed.
- No claim is made about migration execution time or production performance.

## 14. Documentation inventory

Relevant current documentation includes:

- `docs/material-phase5-retrospective.md` — Phase 5 retrospective.
- `docs/material-phase6-backlog.md` — Phase 6 planning backlog, explicitly marked backlog-only.
- `docs/phase6-readiness-gate-report.md` — prior readiness assessment.
- `docs/phase6-entry-checklist.md` — entry checklist with an RLS observation.
- `docs/phase6-entry-approval-report.md` — historical approval report and static RLS analysis.
- `docs/phase6-readiness-gate-report.md` and `docs/production-migration-runbook.md` — migration and operational procedures.
- `docs/production-smoke-test-checklist.md` — checklist, not evidence that a smoke test ran.
- `docs/release-history.md`, `RELEASE_CANDIDATE_REPORT_V1.md`, `FINAL_RELEASE_REPORT.md`, and other root reports — historical release/integration material.
- `CHANGELOG.md` — present in the repository.

The new file `docs/baselines/material-v5.0.1-baseline.md` is the current snapshot requested by this task.

## 15. Known limitations and documentation conflicts

1. Local annotated tag `material-v5.0.1` is now present at `b5fd8edd7a6efe35940c9a09443c3070a2dcf118`. Remote tag state cannot be verified — GitHub authentication failed (`git ls-remote --tags origin` returned "Invalid username or token"). Tag push is blocked; remote presence is unconfirmed.
2. `HEAD` and `origin/main` are now identical at `b5fd8edd7a6efe35940c9a09443c3070a2dcf118` (0 ahead, 0 behind). Older reports describe earlier commits/releases and are not current release proof.
3. No production deployment, privileged production smoke test, production migration application, or production performance result is evidenced here.
4. RLS migration source exists for the Phase 5 import tables, but applied RLS state is not independently verified.
5. `asset-intelligence-v2/index.ts` says the router is “not mounted yet,” while current `routes/index.ts` mounts it. Current mount source wins; the comment is stale.
6. `material-library-catalog.ts` describes routes as “under /api, mounted at /material-library,” while the actual current router is mounted at the aggregate router root and declares `/material-library/*`; final paths in Section 6 follow source mounts.
7. The universal material router comments that it is awaiting full auth wiring, and its current context helper accepts a query tenant fallback. This conflicts with the repository’s canonical tenant-resolution/security guidance.
8. Existing reports use terms such as “applied,” “released,” or “approved” based on their historical evidence. Those terms are not carried forward as current production facts.
9. The final migration inventory has multiple historical/integration/DDL sources and no single machine-readable applied-migration ledger was established by this task.

## 16. Approved Phase 6 scope

The existing backlog and entry-approval documents describe the following approved planning scope:

- M1: Room Design Template Library.
- M2: Production deployment registration and privileged smoke test.
- M3: Furniture Library, sequenced after M1.
- M4: PluginManifest fragmentation resolution.
- M5: i18n duplicate-key CI check.
- M6: Router-prefix integration test.
- S1: Enable and monitor the material recommendation engine after production deployment verification.
- S2: AI Design Composer after M1, M3, and M2.
- S3: Production migration verification documentation.
- S4: Bulk material review pagination.
- S5: CHANGELOG process discipline.
- C3: OCR confidence threshold UI.
- C4: Material usage analytics dashboard.

Multi-room composition, room rendering, customer-facing material explorer, supplier integration, and AR preview are documented as deferred/future items. This section records the previously documented planning scope only; no Phase 6 work was started, no Phase 6 branch exists, and no Phase 6 implementation is included in this baseline.

## 17. Repository health score

**Health score: 78/100 — conditional baseline health.**

| Dimension | Score | Basis |
|---|---:|---|
| Source organization and architecture | 18/20 | Clear workspace/artifact boundaries and material/asset domain separation |
| Material/asset API coverage | 18/20 | 72 current route declarations with explicit source and auth patterns |
| Runtime workers and operations | 14/15 | Dispatcher, scheduler, health polling, recovery, and worker lease code are present |
| Test/regression evidence | 13/15 | Broad file-level coverage, including material/import/asset tests; no complete run claimed |
| Security controls | 9/15 | Strong middleware and token controls, offset by the material context tenant fallback and unverified RLS application |
| Release/database evidence | 6/15 | Tag, production deployment, production smoke test, applied migrations, and performance state are not proven |

The score is an engineering assessment of repository evidence, not a production readiness certification.

## 18. Phase 6 entry status

**Status: NOT STARTED — baseline only.**

The repository contains Phase 6 planning and approval documents, but this task did not create a Phase 6 branch, implement Phase 6 code, apply Phase 6 migrations, or verify production gates. Entry remains conditional on at least:

- a proven release/tag identity;
- verified active production deployment and privileged smoke test;
- controlled migration application evidence;
- direct RLS verification for the Phase 5 import tables;
- resolution or explicit acceptance of the material-router tenant-context conflict.

## Final report

- **File created:** `docs/baselines/material-v5.0.1-baseline.md`
- **Endpoint count:** 72 (28 material/import, 44 asset)
- **Worker count:** 3 registered dispatcher workers
- **Scheduler/poller count:** 3 named services; 4 recurring loops/timers
- **Migration file count:** 55 SQL files in migration directories; 56 including `docs/team-05-analytics-migration.sql`; additional standalone DDL sources are listed separately
- **Repository health score:** 78/100, conditional baseline health
- **HEAD SHA:** `b5fd8edd7a6efe35940c9a09443c3070a2dcf118`
- **origin/main SHA:** `b5fd8edd7a6efe35940c9a09443c3070a2dcf118` (identical — 0 ahead, 0 behind)
- **Git status:** clean; one untracked user-upload instruction artifact excluded from all commits; no application code or migrations changed
- **Local tag status:** `material-v5.0.1` annotated tag **present** at `b5fd8edd7a6efe35940c9a09443c3070a2dcf118`
- **Remote tag status:** **unverifiable** — GitHub authentication blocked; tag push not possible from this workspace
- **Baseline document tracked status:** tracked and committed
- **No Phase 6 branch created; no application code changed**
- **Remaining observations:** production/deployment/migration/performance state is unverified; RLS application is unverified; material tenant-context and stale route comments need follow-up; remote tag push requires GitHub credential configuration

**Verdict: NORMALIZED WITH LOCAL ARTIFACT OBSERVATIONS**