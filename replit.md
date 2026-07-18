# Creative AI Studio — Enterprise Platform

An enterprise AI platform for creative and logistics business operations. Built as a pnpm monorepo with four services.

## Architecture

| Service | Path | URL |
|---|---|---|
| **Customer Portal** | `artifacts/customer-portal` | `/` — public-facing landing page & client workspace |
| **AI Platform (Admin)** | `artifacts/ai-platform` | `/admin/` — internal staff dashboard |
| **API Server** | `artifacts/api-server` | `/api` — Express/Node.js backend |
| **Mockup Sandbox** | `artifacts/mockup-sandbox` | `/__mockup` — design component preview |

## Stack

- **Frontend:** React + Vite + Tailwind CSS (TypeScript)
- **Backend:** Express.js + Drizzle ORM (TypeScript, built with esbuild)
- **Database:** Supabase (PostgreSQL) — separate dev and prod instances
- **AI Providers:** OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate
- **Storage:** Supabase Storage (object storage)

## Running the Project

All four services start automatically via their configured workflows. No manual steps needed.

To install dependencies after pulling new changes:
```bash
pnpm install
```

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `SUPABASE_DEV_DATABASE_URL` | Dev database (development env) |
| `SUPABASE_PROD_DATABASE_URL` | Prod database (production env) |
| `ADMIN_API_KEY` + `VITE_ADMIN_API_KEY` | Admin dashboard authentication |
| `OPENAI_API_KEY` | OpenAI (and other AI provider keys also set) |
| `SESSION_SECRET` | Express session signing |

## Admin Login

The internal admin portal (`/admin/`) uses email/password auth.  
Default dev credentials are set in `INITIAL_INTERNAL_ADMIN_EMAIL` / `INITIAL_INTERNAL_ADMIN_PASSWORD`.

To seed the database (providers, models, agents):
```bash
pnpm --filter @workspace/api-server run seed
```

## User Preferences

- Keep existing monorepo structure (pnpm workspace)
- Do not restructure or migrate the stack
