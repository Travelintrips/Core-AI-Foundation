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

## Governing Rules

All development on this platform is governed by **`MASTER-00.md`** (V4.2 Multi-Team Implementation Master Rule). Every change must comply with these rules:

1. **Single Source of Truth** — no duplicate data stores; use the DB/registry/workflow that already owns the data.
2. **Backward Compatibility** — all existing endpoints, orders, projects, invoices, slugs, and `service_code` values must remain valid.
3. **Additive Only** — no renames of services, workflows, endpoints, or service codes without owner approval.
4. **Deterministic Logic** — AI must not decide pricing, eligibility, ranking, or visibility; AI may only assist with explanations.
5. **Team Isolation** — each team works only within its own scope; cross-team changes go through interfaces, not direct edits.
6. **Coding Standard** — all new files: small, readable, typed, documented, tested, single-responsibility. No 3000+ line files.
7. **Database Rules** — migrations additive only; no DROP TABLE / DROP COLUMN / DELETE / TRUNCATE / mass UPDATE without approval.
8. **API Rules** — no breaking changes; add a version or optional field instead of renaming.
9. **Frontend Rules** — no hardcoded services, pricing, recommendations, or visibility; display only, logic lives in the backend.
10. **Security Rules** — all public endpoints: validate, authorize, sanitize, rate-limit; never expose internal metadata, secrets, or tenant data.

See `MASTER-00.md` for the full authoritative text.

## User Preferences

- Keep existing monorepo structure (pnpm workspace)
- Do not restructure or migrate the stack
- All work must follow MASTER-00.md rules
