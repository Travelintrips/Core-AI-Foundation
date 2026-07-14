# Creative AI Studio — AI Enterprise Platform

An enterprise-grade AI service platform for creative and business document production. Clients submit service requests through the customer portal; the admin team manages them through the internal admin dashboard; AI workers process jobs (text, image, document generation) in the background.

## Architecture

This is a **pnpm monorepo** with three live artifacts and shared libraries:

| Artifact | Preview Path | Description |
|---|---|---|
| `artifacts/customer-portal` | `/` | Customer-facing landing page + client workspace portal |
| `artifacts/ai-platform` | `/admin/` | Internal admin dashboard (staff/owner only) |
| `artifacts/api-server` | `/api` | Express + Drizzle ORM backend API |
| `artifacts/mockup-sandbox` | `/__mockup` | Design canvas preview server |

### Shared Libraries (`lib/`)
- `lib/db` — Drizzle ORM schema + Supabase DB client
- `lib/api-spec` — OpenAPI spec + orval codegen
- `lib/api-client-react` — Generated React Query hooks
- `lib/api-zod` — Generated Zod validation schemas

## How to Run

All services start automatically via Replit workflows. To restart manually:

```bash
# Build libs first (required before api-server build)
pnpm run typecheck:libs

# Build & start API server
pnpm --filter @workspace/api-server run dev

# Start frontends (each in separate terminal)
pnpm --filter @workspace/customer-portal run dev
pnpm --filter @workspace/ai-platform run dev
```

## Key Environment Variables

All set via Replit userenv (`.replit`) and Secrets:
- `SUPABASE_DEV_DATABASE_URL` — Supabase PostgreSQL (dev)
- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` — Admin authentication key
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. — AI provider keys
- `SMTP_*` — Email (Hostinger SMTP)

## Database

Supabase PostgreSQL with a dedicated `ai_platform` schema. Dev and prod use separate Supabase projects. To seed:

```bash
pnpm --filter @workspace/api-server run seed
```

## Tech Stack

- **Frontend**: React 19 + Vite + TailwindCSS + shadcn/ui + Wouter + TanStack Query
- **Backend**: Express 5 + Drizzle ORM + Supabase + pino logging
- **AI**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate
- **Storage**: Supabase Storage (S3-compatible)
- **Auth**: Custom JWT-based admin auth + customer token system

## User Preferences

- Keep existing monorepo structure — do not migrate or restructure without asking
- Use `pnpm` — never npm or yarn
- Do not use `drizzle-kit push` for new tables (proposes dropping schema); write DDL by hand instead
- Import from `@workspace/api-zod` in api-server routes — never import `zod/v4` directly
