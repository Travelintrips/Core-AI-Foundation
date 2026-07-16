# AI Enterprise Platform (Creative Studio)

A full-stack AI enterprise platform built as a pnpm monorepo. It powers a Creative Studio offering AI-driven business services (branding, marketing, company profiles, etc.) for Indonesian SME/enterprise clients.

## Architecture

| Artifact | Preview path | Description |
|---|---|---|
| `artifacts/api-server` | `/api` | Express + Node.js API server, Supabase PostgreSQL, esbuild-bundled |
| `artifacts/ai-platform` | `/admin/` | React + Vite admin dashboard for staff/owners |
| `artifacts/customer-portal` | `/` | React + Vite public-facing customer portal (Indonesian UI) |
| `artifacts/mockup-sandbox` | `/__mockup` | Vite dev server for isolated UI component previews |

Shared libraries live in `lib/` (api-client-react, api-zod, etc.).

## How to run

Dependencies are installed with `pnpm install` at the workspace root (installs all packages). Each service is started via its own workflow:

- **API Server** — `pnpm --filter @workspace/api-server run dev` (builds with esbuild then starts node)
- **AI Platform** — `pnpm --filter @workspace/ai-platform run dev`
- **Customer Portal** — `pnpm --filter @workspace/customer-portal run dev`

## Key environment variables (already set in .replit)

- `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` — admin authentication key
- `SUPABASE_DEV_DATABASE_URL` / `SUPABASE_DATABASE_URL_DEV` — Supabase dev database
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, etc. — AI provider keys
- `SMTP_*` — Hostinger email (info@cstlogistic.co.id)
- `FONNTE_TOKEN` — WhatsApp notifications

## Database

Supabase PostgreSQL in the `ai_platform` schema (not `public`). Dev/prod picked by `NODE_ENV`. Never use `drizzle-kit push` for additive migrations — hand-write DDL instead (see memory notes).

## User preferences
