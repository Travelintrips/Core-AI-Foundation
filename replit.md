# Creative AI Studio — AI Enterprise Platform

A full-stack AI enterprise platform for managing creative projects, client portals, and AI-powered service delivery.

## Stack

- **Monorepo**: pnpm workspace
- **Frontend (Admin)**: React + Vite (`artifacts/ai-platform`) → preview path `/admin/`
- **Frontend (Customer)**: React + Vite (`artifacts/customer-portal`) → preview path `/`
- **Backend**: Express + TypeScript + esbuild (`artifacts/api-server`) → preview path `/api`
- **Database**: Supabase (PostgreSQL, `ai_platform` schema)
- **Storage**: Supabase object storage (bucket: `ai-assets`)
- **AI Providers**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate

## How to Run

All workflows are configured and start automatically. Dependencies install with:

```bash
pnpm install
```

Workflows:
- `artifacts/api-server: API Server` — Express API, port from `$PORT`, path `/api`
- `artifacts/ai-platform: web` — Admin dashboard, path `/admin/`
- `artifacts/customer-portal: web` — Customer-facing portal, path `/`
- `artifacts/mockup-sandbox: Component Preview Server` — Component preview sandbox, path `/__mockup`

## Environment Secrets Required

| Secret | Purpose |
|--------|---------|
| `SUPABASE_DATABASE_URL_DEV` | Dev database connection string |
| `SUPABASE_PROD_DATABASE_URL` | Production database connection string |
| `ADMIN_API_KEY` | Admin API authentication key |
| `VITE_ADMIN_API_KEY` | Same value as above, used by Vite frontend |
| `SESSION_SECRET` | Express session signing |
| `OPENAI_API_KEY` | OpenAI integration |
| `ANTHROPIC_API_KEY` | Anthropic Claude integration |
| `GEMINI_API_KEY` | Google Gemini integration |
| `MISTRAL_API_KEY` | Mistral AI integration |
| `COHERE_API_KEY` | Cohere integration |
| `REPLICATE_API_TOKEN` | Replicate image generation |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email via Hostinger SMTP |
| `FONNTE_TOKEN` | WhatsApp notifications via Fonnte |

## Key Architecture Notes

- Admin auth: `ADMIN_API_KEY` header checked globally via `adminAuthWithExceptions` middleware in `app.ts`
- DB schema lives in the `ai_platform` Supabase schema (not `public`); set `search_path` for raw SQL
- `drizzle-kit push` can falsely propose dropping the entire schema — use hand-written DDL for migrations
- API routes omit the `/api` prefix (the proxy adds it); route files use paths like `/ai/...`
- esbuild bundles the API server — any new native modules must be added to the externals list in `build.mjs`
- orval codegen generates client hooks from the OpenAPI spec in `lib/api-spec/`

## User Preferences
