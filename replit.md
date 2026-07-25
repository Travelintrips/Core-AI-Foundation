# Creative AI Studio

A pnpm monorepo powering an AI-driven creative services platform for **CST Logistic / PT Cahaya Sejati Teknologi**.

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
