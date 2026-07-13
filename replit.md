# AI Enterprise Platform

A full-stack AI agency management platform — pnpm monorepo with three live artifacts and a shared library layer.

## Architecture

| Artifact | Path | Preview | Port | Description |
|---|---|---|---|---|
| **API Server** | `artifacts/api-server` | `/api` | 8080 | Express + Node.js backend, Supabase/PostgreSQL, job engine, scheduler, event bus, worker cluster |
| **AI Platform** | `artifacts/ai-platform` | `/admin/` | 20785 | React/Vite admin dashboard — providers, agents, orchestration, analytics |
| **Customer Portal** | `artifacts/customer-portal` | `/` | 23434 | React/Vite client-facing portal — service catalog, submissions, workspace |
| **Mockup Sandbox** | `artifacts/mockup-sandbox` | `/__mockup` | 8081 | Vite dev server for UI component mockups on canvas |

## Shared Libraries

- `lib/api-spec` — OpenAPI spec + orval codegen
- `lib/api-client-react` — Generated React Query hooks
- `lib/api-zod` — Generated Zod validation schemas

## How to Run

All workflows are configured and start automatically. To manually restart:

```bash
# Install dependencies (only needed after fresh clone/import)
pnpm install

# Build api-server
pnpm --filter @workspace/api-server run build

# Run individual services
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ai-platform run dev
pnpm --filter @workspace/customer-portal run dev
```

## Environment & Secrets

All secrets are configured in the Replit environment (`.replit` `[userenv]` sections):

- **AI Providers**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `COHERE_API_KEY`, `REPLICATE_API_TOKEN`
- **Database (dev)**: `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV`
- **Database (prod)**: `SUPABASE_PROD_DATABASE_URL` / `SUPABASE_DATABASE_URL`
- **Supabase**: `SUPABASE_URL_DEV`, `SUPABASE_ANON_KEY_DEV`, `SUPABASE_SERVICE_ROLE_KEY_DEV` (and prod equivalents)
- **Email (SMTP)**: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_FROM`
- **Fonnte (WhatsApp)**: `FONNTE_TOKEN`
- **Admin auth**: `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` (same value, used by middleware + frontend)
- **Session**: `SESSION_SECRET`

Database uses a dedicated `ai_platform` schema in Supabase (not `public`). The environment is picked via `NODE_ENV`: development → dev credentials, production → prod credentials.

## Re-import Setup (2026-07-13)

After a GitHub re-import, artifacts and workflows were re-registered automatically once requested. `ADMIN_API_KEY`/`VITE_ADMIN_API_KEY` were missing (not part of the imported secrets) — generated a fresh random value and stored both as shared env vars (matching values, since `VITE_ADMIN_API_KEY` is bundled into the frontend anyway and isn't a true secret). All 4 services verified running: api-server (8080), ai-platform admin (20785, shows login gate as expected), customer-portal (23434, renders landing page), mockup-sandbox (8081).

## Key Technical Notes

- **GitHub re-import**: restores all artifacts/workflows automatically via `scripts/post-merge.sh`
- **Concatenated file bug**: GitHub imports can merge old+new versions of files end-to-end — fix by keeping v2 and removing v1 (affected `src/routes/storage.ts` and `src/lib/objectStorage.ts`)
- **Zod imports**: never import `zod` or `zod/v4` directly in `api-server` routes — use `@workspace/api-zod` schemas only
- **agentId**: DB column is `number`, API schema is `string|null` — always `parseInt(agentId, 10)` before querying
- **Seed**: run `pnpm --filter @workspace/api-server run seed` (or POST `/api/ai/seed/all`) to populate providers, models, and the Brand Strategist agent
- **drizzle-kit push**: proposes dropping the entire `ai_platform` schema even for additive changes — hand-write DDL for new tables instead

## User Preferences

- Keep the project's existing structure and stack
- Maintain the `ai_platform` Supabase schema (not `public`)
- Do not use `drizzle-kit push` for production migrations — hand-write DDL
