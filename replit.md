# Creative AI Studio — Enterprise Platform

A full-stack AI-powered creative services platform built as a pnpm monorepo.

## Project overview

The platform enables clients to request creative AI services (branding, design, company profiles, etc.), manages the full commercial workflow (quotation → payment → AI generation → delivery), and provides an admin dashboard for operators.

## Architecture

| Artifact | Path | Preview Path | Description |
|---|---|---|---|
| API Server | `artifacts/api-server` | `/api` | Express + Drizzle ORM, connects to Supabase PostgreSQL |
| AI Platform (admin) | `artifacts/ai-platform` | `/admin/` | React + Vite admin dashboard |
| Customer Portal | `artifacts/customer-portal` | `/` | Client-facing React + Vite frontend |
| Cargo Rate Finder | `artifacts/cargo-finder` | `/cargo-finder/` | Standalone cargo rate calculator |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` | Design canvas / component previews |

## Running the project

All services start via their configured workflows. After a fresh clone or import:

```bash
pnpm install   # install all workspace dependencies
```

Then restart all workflows from the Replit interface.

## Key environment variables

All secrets are managed in Replit's environment secrets. The project needs:

- `SUPABASE_DATABASE_URL_DEV` / `SUPABASE_DEV_DATABASE_URL` — dev Supabase PostgreSQL (both names aliased)
- `SUPABASE_DATABASE_URL` / `SUPABASE_PROD_DATABASE_URL` — production Supabase PostgreSQL
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `REPLICATE_API_TOKEN`, `COHERE_API_KEY` — AI providers
- `ADMIN_API_KEY` + `VITE_ADMIN_API_KEY` — admin API authentication (same value)
- `SESSION_SECRET` — Express session signing
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `SMTP_FROM` — email (Hostinger)
- `FONNTE_TOKEN` — WhatsApp notifications

## Database

- **Provider**: Supabase PostgreSQL
- **Schema**: `ai_platform` (not `public`) — all raw SQL must set `search_path`
- **Dev/prod switching**: controlled by `NODE_ENV`
- To seed initial data: `pnpm --filter @workspace/api-server run seed`

## Tech stack

- **Runtime**: Node.js 20, pnpm workspaces
- **Backend**: Express 5, Drizzle ORM, Zod, Pino logging
- **Frontend**: React 18, Vite 7, TailwindCSS, shadcn/ui, Wouter (routing)
- **AI**: OpenAI, Anthropic, Google Gemini, Replicate, Mistral, Cohere
- **Storage**: Supabase Storage (S3-compatible)
- **Email**: Nodemailer via Hostinger SMTP
- **PDF**: PDFKit, pdf-lib
- **Build**: esbuild (api-server), Vite (frontends)

## User preferences

- Keep existing project structure — do not restructure or migrate
- Use pnpm for all package operations
- Never import zod directly in api-server routes — use `@workspace/api-zod` schemas only
- Admin auth is one global `adminAuthWithExceptions` mount in `app.ts`, never per-route
