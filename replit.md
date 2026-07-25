# Creative AI Studio — AI Platform (CST Logistic)

## Project Overview

A pnpm monorepo powering an end-to-end AI creative services platform for CST Logistic (`aicore.cstlogistic.co.id`). Customers submit creative briefs (branding, packaging, fashion design, etc.), an AI pipeline generates deliverables, and an internal admin team reviews/approves them through a multi-stage commercial workflow.

## Architecture

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
