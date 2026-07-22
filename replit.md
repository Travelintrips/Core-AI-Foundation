# AI Creative Studio — Enterprise Platform

A full-stack AI-powered creative services platform built as a pnpm monorepo.

## Architecture

| Artifact | Path | Preview | Description |
|---|---|---|---|
| **API Server** | `artifacts/api-server` | `/api` | Express + Drizzle ORM backend |
| **AI Platform (Admin)** | `artifacts/ai-platform` | `/admin/` | Internal staff portal |
| **Customer Portal** | `artifacts/customer-portal` | `/` | Public-facing Creative Studio site |
| **Cargo Rate Finder** | `artifacts/cargo-finder` | `/cargo-finder/` | Cargo pricing calculator |
| **Mockup Sandbox** | `artifacts/mockup-sandbox` | `/__mockup` | Component preview server |

## Shared Libraries (`lib/`)

- `lib/db` — Drizzle ORM schema + Supabase pool (schema: `ai_platform`)
- `lib/api-spec` — OpenAPI YAML spec + orval codegen
- `lib/api-client-react` — Generated React Query hooks
- `lib/api-zod` — Generated Zod validation schemas

## Running the Project

**Install dependencies:**
```bash
pnpm install
```

**Build generated code + API server (required after pulling new code):**
```bash
pnpm run build:generated   # regenerate API client + zod schemas
pnpm run build:api         # compile api-server
```

**Workflows (auto-managed by Replit):**
- Each artifact has its own workflow configured via `artifact.toml`
- Restart them from the Replit UI or via WorkflowsRestart after code changes

## Database

- **Dev:** Supabase project `xssrfshdrtdfupgqwfdw` (`SUPABASE_DEV_DATABASE_URL`)
- **Prod:** Supabase project `nzdweipzckfszczzqtuw` (`SUPABASE_PROD_DATABASE_URL`)
- Schema: `ai_platform` (search_path is set on every connection)
- Migrations: hand-written DDL (drizzle-kit push is NOT used — it proposes dropping the entire schema)

## Seeding

```bash
pnpm --filter @workspace/api-server run seed
# or via API: POST /api/ai/seed/all
```

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `SUPABASE_DEV_DATABASE_URL` | Dev database connection |
| `SUPABASE_PROD_DATABASE_URL` | Prod database connection |
| `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` | Backend + frontend admin auth |
| `SESSION_SECRET` | Express session signing |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. | AI provider keys |
| `SMTP_*` | Email (Hostinger SMTP) |

## User Preferences

- Keep the existing monorepo structure — do not migrate or restructure
- Use hand-written DDL for new DB tables (not drizzle-kit push)
- Never import `zod` directly in `api-server` routes — use `@workspace/api-zod` schemas
- Route files in api-server must omit the `/api` prefix (it's added by the app mount)
