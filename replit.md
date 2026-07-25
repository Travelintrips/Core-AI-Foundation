
# Creative AI Studio

## Replit setup

This repository is configured as a pnpm workspace with artifact-owned workflows.
The customer portal is the primary preview at `/`; the internal dashboard is
available at `/admin/`, and the API is served at `/api`.

The post-merge setup is deterministic (`pnpm install --frozen-lockfile`) and
validates the shared libraries plus API bundle before workflows are reconciled.
For a fresh local setup, run:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
```

## Architecture
A pnpm monorepo powering an AI-driven creative services platform for **CST Logistic / PT Cahaya Sejati Teknologi**.
# Creative AI Studio — AI Platform (CST Logistic)

## Project Overview

A pnpm monorepo powering an end-to-end AI creative services platform for CST Logistic (`aicore.cstlogistic.co.id`). Customers submit creative briefs (branding, packaging, fashion design, etc.), an AI pipeline generates deliverables, and an internal admin team reviews/approves them through a multi-stage commercial workflow.

## Project overview

| Artifact | Preview path | Description |
|---|---|---|
| Customer Portal | `/` | Public-facing storefront + client workspace (Bahasa Indonesia / English) |
| AI Platform (Admin) | `/admin/` | Internal staff dashboard — owner, admin, manager roles |
| API Server | `/api` | REST API backend (Express + Drizzle + Supabase PostgreSQL) |
| Cargo Rate Finder | `/cargo-finder/` | Standalone cargo rate calculator tool |
| Customer Mobile | `/mobile/` | Expo React Native mobile app |
| Mockup Sandbox | `/__mockup` | Design component preview server (internal tooling) |

## Running the project

All 6 services start automatically via their registered workflows. No manual step needed.

- **Customer Portal** — port 23434
- **Admin Dashboard** — port 20785
- **API Server** — port 8080 (builds with esbuild then runs with Node)
- **Cargo Finder** — port 20404
- **Mobile** — Expo dev server (port from `$PORT`)
- **Mockup Sandbox** — port 8081

## Stack

- **Runtime**: Node 20, pnpm workspaces
- **Frontend**: React + Vite + Tailwind (all web apps)
- **Backend**: Express 5, Drizzle ORM, Zod validation
- **Database**: Supabase (PostgreSQL) — `ai_platform` schema
  - Dev DB: `SUPABASE_DATABASE_URL_DEV`
  - Prod DB: `SUPABASE_DATABASE_URL`
- **AI providers**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate
- **Mobile**: Expo / React Native
- **Email**: Nodemailer via Hostinger SMTP
- **WhatsApp notifications**: Fonnte

## Environment variables

All secrets are stored in `.replit` under `[userenv]`. Non-secret config (SMTP host, allowed origins, etc.) is in `[userenv.shared]`. Development Supabase credentials are under `[userenv.development]`, production under `[userenv.production]`.

See `.env.example` for the full list of variable names.

## Useful commands

```bash
# Install dependencies
pnpm install

# Type-check all packages
pnpm typecheck

# Build entire workspace
pnpm build:workspace

# Run API server in dev mode only
pnpm --filter @workspace/api-server run dev

# Run database seed (providers, models, agents)
pnpm --filter @workspace/api-server run seed
```

## Key directories

```
artifacts/
  ai-platform/      Admin dashboard (React + Vite)
  api-server/       REST API (Express + Drizzle)
  cargo-finder/     Cargo rate tool
  customer-mobile/  Expo mobile app
  customer-portal/  Customer-facing portal
  mockup-sandbox/   UI mockup dev server
lib/
  api-client-react/ React hooks (orval-generated from OpenAPI)
  api-zod/          Zod schemas (generated from OpenAPI)
  db/               Drizzle schema + shared DB pool
scripts/            Workspace health, migrations, security scan
```

## User preferences

- Keep the existing monorepo structure — do not restructure or migrate to a different stack.
- Use `pnpm` exclusively (yarn/npm are blocked by the preinstall script).
- Never put secrets in `.replit` plain-text — use Replit Secrets. (Note: current credentials are already in `.replit [userenv]` from the original project.)
| Artifact | Path | Preview | Port | Description |
|---|---|---|---|---|
| `api-server` | `artifacts/api-server` | `/api` | 8080 | Express + Drizzle ORM backend, Supabase (PostgreSQL) |
| `ai-platform` | `artifacts/ai-platform` | `/admin/` | 20785 | React/Vite internal admin dashboard |
| `customer-portal` | `artifacts/customer-portal` | `/` | 23434 | React/Vite public-facing customer portal |
| `cargo-finder` | `artifacts/cargo-finder` | `/cargo-finder/` | 20404 | Cargo rate finder tool |
| `customer-mobile` | `artifacts/customer-mobile` | `/mobile/` | — | Expo React Native mobile app |
| `mockup-sandbox` | `artifacts/mockup-sandbox` | `/__mockup` | 8081 | Component preview sandbox |

Shared libraries live in `lib/` (api-client-react, api-zod, db, etc.).

## How to Run

Dependencies are managed with pnpm. All workflows start automatically. To install:

```bash
pnpm install
```

Individual services:
```bash
# API server (builds then runs)
pnpm --filter @workspace/api-server run dev

# Admin frontend
pnpm --filter @workspace/ai-platform run dev

# Customer portal
pnpm --filter @workspace/customer-portal run dev

# Cargo finder
pnpm --filter @workspace/cargo-finder run dev

# Mobile (Expo)
pnpm --filter @workspace/customer-mobile run dev
```

## Database

Uses Supabase PostgreSQL in the `ai_platform` schema (not `public`).  
- **Dev**: `SUPABASE_DATABASE_URL_DEV` (configured in `.replit`)  
- **Prod**: `SUPABASE_DATABASE_URL` (configured in `.replit`)

Run migrations manually with hand-written DDL (do not use `drizzle-kit push` on existing environments — see memory notes).

Seed the database:
```bash
pnpm --filter @workspace/api-server run seed
```

## Key Environment Variables

Non-secret config is in `.replit` `[userenv]`. Secrets that still need to be set in Replit Secrets:
- `SMTP_PASS` — Hostinger email password
- `INITIAL_INTERNAL_ADMIN_EMAIL` — bootstrap admin email
- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_PROD_DATABASE_URL` (aliases, see memory)

Note: `OPENAI_API_KEY` in `.replit` is currently invalid — the OpenAI provider health check will show failures until a valid key is supplied.

## User Preferences

_None recorded yet._
