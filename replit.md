# Creative AI Studio

AI-powered creative agency platform for CST Logistic. Customers submit creative briefs, AI agents execute the work, and results flow through a commercial approval pipeline.

## Architecture

pnpm monorepo with six artifacts:

| Artifact | Path | Preview | Description |
|---|---|---|---|
| Customer Portal | `artifacts/customer-portal` | `/` | Public-facing landing page + client workspace |
| AI Platform (Admin) | `artifacts/ai-platform` | `/admin/` | Internal staff/admin portal |
| API Server | `artifacts/api-server` | `/api` | Express + esbuild backend, Supabase DB |
| Cargo Rate Finder | `artifacts/cargo-finder` | `/cargo-finder/` | Standalone cargo rate calculator |
| Customer Mobile | `artifacts/customer-mobile` | `/mobile/` | Expo React Native app |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` | Design component preview server |

Shared libraries live in `lib/`: `api-spec`, `api-client-react`, `api-zod`, `db`, `design-components`, `design-workflow`.

## How to run (development)

```bash
# Install all workspace dependencies (run once after clone/import)
pnpm install

# Build shared TypeScript libraries (required before starting any service)
pnpm run typecheck:libs

# Start all services via the workflow buttons in the UI, or individually:
pnpm --filter @workspace/api-server run dev       # API on port 8080
pnpm --filter @workspace/ai-platform run dev      # Admin UI on port 20785
pnpm --filter @workspace/customer-portal run dev  # Portal on port 23434
pnpm --filter @workspace/cargo-finder run dev     # Cargo finder on port 20404
```

The API server reads secrets from `.env.development` in dev (`--env-file` flag).

## Environment / Secrets

Non-secret config is in `.replit` under `[userenv]`. Secrets required (see `.env.example` for full list):

- **Database**: `SUPABASE_DEV_DATABASE_URL`, `SUPABASE_DATABASE_URL` (prod)
- **AI Providers**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `REPLICATE_API_TOKEN`
- **Auth**: `ADMIN_API_KEY`, `VITE_ADMIN_API_KEY` (same value, frontend needs the VITE_ prefix), `SESSION_SECRET`
- **Email**: `SMTP_PASS`
- **WhatsApp**: `FONNTE_TOKEN`

In development, all secrets are read from `.env.development` (not committed to production).

## Key conventions

- Never import `zod` directly in `artifacts/api-server` routes — use `@workspace/api-zod` schemas only.
- Run `pnpm run typecheck:libs` (`tsc --build`) before `pnpm typecheck` or the api-server typecheck; lib types must be compiled first.
- Admin auth is a single global middleware mount (`adminAuthWithExceptions`) in `app.ts`, never per-route.
- Route files omit the app-level `/api` prefix — it's added at mount time.
- Database uses Supabase with `ai_platform` schema (not `public`); set `search_path` for raw SQL.

## User preferences

- Keep existing project structure and stack; do not restructure or migrate.
