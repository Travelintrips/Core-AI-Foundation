# AI Enterprise Platform

A full-stack AI enterprise platform built as a pnpm monorepo. Supports multi-provider AI dispatch, a customer creative studio portal, job scheduling, event bus, human task center, and quotation/invoicing flows.

## Architecture

| Artifact | URL | Description |
|---|---|---|
| `artifacts/customer-portal` | `/` (port 23434) | Customer-facing Creative AI Studio portal |
| `artifacts/ai-platform` | `/admin/` (port 20785) | Internal staff admin panel |
| `artifacts/api-server` | `/api` (port 8080) | Express + Drizzle ORM backend |
| `artifacts/mockup-sandbox` | `/__mockup` | UI component preview sandbox |

### Shared libraries (`lib/`)
- `@workspace/api-spec` — OpenAPI spec + codegen (orval)
- `@workspace/api-client-react` — Generated React Query hooks
- `@workspace/api-zod` — Generated Zod schemas
- `@workspace/db` — Drizzle ORM schema + Supabase client

## How to run

All workflows start automatically. To restart manually:

```bash
# Install dependencies (run once after import)
pnpm install

# Build shared libraries & API server
pnpm run build:generated   # codegen from OpenAPI spec
pnpm run build:libs        # TypeScript project references
pnpm run build:api         # esbuild api-server → dist/

# Seed the database (first run)
pnpm --filter @workspace/api-server run seed
```

## Environment Variables

All API keys and Supabase credentials are configured in `.replit` under `[userenv]`.

**Required secrets (set in Replit Secrets):**
- `SESSION_SECRET` — JWT signing secret for internal sessions ✅ set
- `ADMIN_API_KEY` — Master key for admin API endpoints (⚠️ not set — admin panel API calls will return 401)
- `VITE_ADMIN_API_KEY` — Same value as ADMIN_API_KEY, exposed to the frontend

**Optional secrets:**
- `INITIAL_INTERNAL_ADMIN_EMAIL` / `INITIAL_INTERNAL_ADMIN_PASSWORD` — Used by seed script to create first admin user

## Re-import Setup (2026-07-13)

After a GitHub re-import, artifacts and workflows were re-registered automatically once requested. `ADMIN_API_KEY`/`VITE_ADMIN_API_KEY` were missing (not part of the imported secrets) — generated a fresh random value and stored both as shared env vars (matching values, since `VITE_ADMIN_API_KEY` is bundled into the frontend anyway and isn't a true secret). All 4 services verified running: api-server (8080), ai-platform admin (20785, shows login gate as expected), customer-portal (23434, renders landing page), mockup-sandbox (8081).

Note: artifact/workflow registration lives outside git, so it does not survive re-imports even though the code and secrets are unaffected. If a future re-import shows "no workflows configured" again, just ask to re-register — it does not need a fresh setup from scratch.
Re-verified again the same day after another re-import wiped artifact/workflow registration (registration doesn't survive git-based re-imports even though `artifact.toml` files stay on disk). Ran post-merge setup to restore all 4 artifacts/workflows; all secrets were already present, all services came back up clean with no code changes needed.
A second re-import wiped `node_modules` and artifact/workflow registration again. Fix: `pnpm install`, then `pnpm run build:generated` (orval codegen + libs typecheck) and `pnpm run build:api` (esbuild bundle) before restarting workflows — otherwise `vite: not found` / `Cannot find package 'esbuild'` errors on first boot. All 4 services re-verified running afterward.
A third re-import (2026-07-14) again wiped artifact/workflow registration only; `runPostMergeSetup()` re-registered all 4 artifacts/workflows in one pass with no code changes. All secrets (including `ADMIN_API_KEY`/`VITE_ADMIN_API_KEY`) were already present. Verified: customer-portal renders landing page, ai-platform shows the expected staff login gate, api-server returns 401 (expected without an admin key) on an authenticated route.
A fourth re-import (2026-07-14) wiped artifact/workflow registration and `node_modules`. Additionally, `artifacts/api-server/src/routes/templates.ts` had 10 concatenated route stubs (old unclosed v1 lines immediately followed by v2 handler bodies) causing a build failure. Fix: `pnpm install`, fix the concatenated stubs in templates.ts, `pnpm run build:generated`, `pnpm run build:api`, restart all 4 workflows. All services verified running after fix.
Re-verified again 2026-07-14: another re-import wiped `node_modules` + registration. Same fix (`pnpm install` → `build:generated` → `build:api` → restart workflows) resolved it; all secrets already present in `.replit`, no code changes needed. All 4 services confirmed up: api-server (8080, dispatcher/scheduler/cluster workers started), customer-portal (23434, landing page renders), ai-platform admin (20785, shows login gate as expected), mockup-sandbox (8081).
Re-verified a further time 2026-07-14 (same day, another re-import): identical symptoms (artifacts/workflows re-registered automatically, `node_modules` missing). Same fix applied (`pnpm install` → `build:generated` → `build:api` → restart all 4 workflows) with no code changes. All secrets (including `ADMIN_API_KEY`/`VITE_ADMIN_API_KEY`) already present in `.replit`. All 4 services confirmed running and rendering correctly via screenshots.
Re-verified once more 2026-07-14 (second pass same day): same wipe pattern (node_modules + artifact/workflow registration gone), same fix applied successfully. All 4 services re-confirmed running via screenshots: customer-portal landing page renders correctly (Indonesian copy, dashboard mockup), ai-platform shows the expected staff login gate (401 on API calls pre-login is expected, not a bug).
Re-verified again 2026-07-14 (second import): same pattern — `node_modules` + artifact/workflow registration wiped. Same fix applied (`pnpm install` → `build:generated` → `build:api` → `runPostMergeSetup`) — all 4 services back up clean, no code changes needed.
Re-verified once more later on 2026-07-14 after yet another re-import: identical wipe/fix cycle (`pnpm install` → `build:generated` → `build:api` → restart 4 workflows), no code changes needed, all secrets already present. All 4 services confirmed up via screenshot: customer-portal landing page rendered, ai-platform admin showed login gate as expected, api-server logs showed scheduler/dispatcher/cluster workers started, mockup-sandbox vite server ready.
Re-verified 2026-07-14 (latest): same wipe/fix cycle. One new code fix required: `LayoutTemplate` icon was missing from lucide-react import in `artifacts/ai-platform/src/components/layout.tsx` (caused runtime crash). Also added `requireAdminApiKey` export alias to `artifacts/api-server/src/middleware/adminAuth.ts` (api build was failing). After fixes: all 4 services confirmed up — customer-portal landing page renders, ai-platform shows staff login gate, api-server running, mockup-sandbox vite ready.

Re-verified a further time 2026-07-14 (same day, later re-import): identical symptom (`node_modules` + registration wiped), identical fix applied, all 4 services confirmed running again with no code changes.
Re-verified again 2026-07-14 (latest re-import): same wipe pattern. Additional fix needed: `artifacts/api-server/src/routes/templates.ts` had the concatenated-file bug (stale v1 route openers interleaved with v2 openers causing esbuild parse error). Removed the 10 stale lines (had `requireAdminApiKey` per-route). Then standard fix applied; all 4 services confirmed up.
Re-verified again 2026-07-14: same wipe pattern. Additionally found concatenation bug in `artifacts/api-server/src/routes/templates.ts` — GitHub import had merged stale v1 route openers before each of the 10 admin routes; removed the stale lines. Fix: `pnpm install` → `build:generated` → `build:api` → restart 4 workflows. All 4 services confirmed up, customer-portal landing page renders correctly.
Re-verified again 2026-07-14: same wipe pattern. `artifacts/api-server/src/routes/templates.ts` had concatenated-routes bug reintroduced (orphaned v1 route openings + wrong `/api/ai/templates/...` path prefix on v2 admin lines). Fixed by stripping v1 orphan lines and correcting paths to `/ai/templates/...` before `build:api`. All 4 services confirmed up via screenshots afterward.
Re-verified a further time 2026-07-14 (same day, later re-import): identical symptom (`node_modules` + registration wiped), identical fix applied, all 4 services confirmed running again. Also fixed two code bugs uncovered during this import: (1) `templates.ts` imported `requireAdminApiKey` from `adminAuth.ts` but the export is named `adminAuth` — aliased on import; (2) `layout.tsx` used `LayoutTemplate` icon from lucide-react without importing it — added to import list.

## Phase V4.5 — AI Design Studio (2026-07-14)

Added a full Canva-like editor to the admin panel:
- **Routes**: `GET/POST /api/ai/design/projects`, `GET/PATCH /api/ai/design/projects/:id`, canvas CRUD, version history, export, AI regenerate
- **DB**: `ai_design_projects` + `ai_design_versions` tables — run `scripts/migrations/v4.5-design-studio.sql` to create them
- **Frontend**: `/design-studio` (project list) and `/design-studio/:id` (canvas editor with layers, drag/resize, undo/redo, grid, alignment, zoom, compare, AI regenerate, export)
- **Nav**: Added "Creative > Design Studio" section to the admin sidebar

Re-verified once more 2026-07-14 (later re-import): same wipe pattern, same fix, but this time two genuine code bugs surfaced (not present in earlier re-imports) and were fixed: (1) `templates.ts` imported a non-existent `requireAdminApiKey` export from `adminAuth.ts` — added it as an alias for `adminAuth`. (2) `ai-platform`'s `layout.tsx` referenced the `LayoutTemplate` lucide-react icon without importing it — added to the import list. All 4 services re-verified running via screenshot after the fixes.

## Key Technical Notes
## Database

- **Development:** Supabase project `xssrfshdrtdfupgqwfdw` (ap-southeast-2)
- **Production:** Supabase project `nzdweipzckfszczzqtuw` (ap-southeast-2)
- Schema lives in `ai_platform` (not `public`) — always set `search_path` for raw SQL
- Use hand-written DDL for new tables (drizzle-kit push proposes dropping the whole schema)

## User Preferences

- Keep existing project structure and stack — do not restructure
- Use pnpm for all package management
