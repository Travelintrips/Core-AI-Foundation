# Creative AI Studio — AI Platform

A full-stack AI platform built as a pnpm monorepo. Provides an admin dashboard, customer portal, job/workflow engine, design AI agents, and a cargo rate finder.

## Stack

- **Runtime**: Node.js 20, pnpm workspace
- **API**: Express (TypeScript, ESBuild), serves at `/api`
- **Admin UI**: React + Vite, serves at `/admin/`
- **Customer Portal**: React + Vite, serves at `/`
- **Cargo Finder**: React + Vite, serves at `/cargo-finder/`
- **Database**: Supabase (PostgreSQL, `ai_platform` schema), dev + prod instances
- **AI Providers**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate

## How to Run

All services start automatically via Replit workflows. In development:

| Service | Workflow name | URL |
|---|---|---|
| API Server | `artifacts/api-server: API Server` | `/api` |
| Admin Dashboard | `artifacts/ai-platform: web` | `/admin/` |
| Customer Portal | `artifacts/customer-portal: web` | `/` |
| Cargo Finder | `artifacts/cargo-finder: web` | `/cargo-finder/` |

## Key Environment Variables

Already configured in the Replit environment:

- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_PROD_DATABASE_URL` — database connections
- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` — admin authentication
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc. — AI providers
- `SMTP_*` — email via Hostinger
- `FONNTE_TOKEN` — WhatsApp notifications

## Shared Libraries (lib/)

- `lib/db` — Drizzle ORM schema + pool (Supabase)
- `lib/api-spec` — OpenAPI spec (`openapi.yaml`) — source of truth for all routes
- `lib/api-zod` — Generated Zod schemas from OpenAPI
- `lib/api-client-react` — Generated React Query hooks from OpenAPI
- `lib/design-components` — Shared UI components

## Useful Scripts

```bash
# Install all dependencies
pnpm install

# Seed the database (providers, models, agents)
pnpm --filter @workspace/api-server run seed

# Regenerate API client from OpenAPI spec
pnpm run build:generated

# Run all tests
pnpm -r --if-present run test

# Full typecheck
pnpm run typecheck
```

## User Preferences

- Keep existing project structure — do not restructure or migrate
- Use pnpm for all package management
- Never write secrets or credentials into `.replit` directly
