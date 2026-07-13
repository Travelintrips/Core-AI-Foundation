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

A second re-import wiped `node_modules` and artifact/workflow registration again. Fix: `pnpm install`, then `pnpm run build:generated` (orval codegen + libs typecheck) and `pnpm run build:api` (esbuild bundle) before restarting workflows — otherwise `vite: not found` / `Cannot find package 'esbuild'` errors on first boot. All 4 services re-verified running afterward.

## Key Technical Notes
## Database

- **Development:** Supabase project `xssrfshdrtdfupgqwfdw` (ap-southeast-2)
- **Production:** Supabase project `nzdweipzckfszczzqtuw` (ap-southeast-2)
- Schema lives in `ai_platform` (not `public`) — always set `search_path` for raw SQL
- Use hand-written DDL for new tables (drizzle-kit push proposes dropping the whole schema)

## User Preferences

- Keep existing project structure and stack — do not restructure
- Use pnpm for all package management
