# AI Platform Enterprise

An enterprise-grade control plane for managing AI infrastructure — providers, models, workflows, prompts, knowledge, memory, tokens, and executions. Built contract-first with a database-driven architecture.

## Stack

- **Monorepo:** pnpm workspaces
- **Runtime:** Node.js 24, TypeScript 5.9
- **Backend:** Express 5 (`artifacts/api-server`)
- **Frontend:** React + Vite + shadcn/ui + Tailwind CSS (`artifacts/ai-platform`)
- **Database:** PostgreSQL (Replit built-in) + Drizzle ORM
- **API contract:** OpenAPI (`lib/api-spec/openapi.yaml`) → Zod schemas + React Query hooks via Orval codegen

## How to run

Both services start automatically via their managed workflows:

- **Frontend** (`artifacts/ai-platform: web`) — React/Vite dev server on `$PORT`, served at `/`
- **API server** (`artifacts/api-server: API Server`) — Express on `$PORT`, served at `/api`

### Database

Schema is managed by Drizzle. To push schema changes to the dev database:

```bash
pnpm --filter @workspace/db run push
```

### Codegen

After modifying `lib/api-spec/openapi.yaml`, regenerate the React Query hooks and Zod schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```

### Build

```bash
pnpm run build
```

## Project structure

```
artifacts/
  api-server/      # Express backend
  ai-platform/     # React frontend
  mockup-sandbox/  # Component preview (canvas/design tool)
lib/
  api-spec/        # OpenAPI definition (source of truth)
  api-client-react/ # Generated React Query hooks
  api-zod/         # Generated Zod schemas
  db/              # Drizzle schema + DB client
scripts/           # Dev automation scripts
```

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string (auto-provided by Replit)
- `SESSION_SECRET` — Secret for session signing (set as Replit Secret)
- `ADMIN_API_KEY` — Admin API authentication key (optional; omitting fails-open in dev)
- `VITE_ADMIN_API_KEY` — Same value as ADMIN_API_KEY, exposed to frontend (see security note below)

## Notes

- AI execution (orchestrator/workflows) and analytics are currently simulated — no external AI API keys required
- pnpm-workspace.yaml enforces a 1-day `minimumReleaseAge` for npm packages (supply-chain safety)
- **Security note:** `VITE_ADMIN_API_KEY` embeds the admin credential in the browser bundle — this is a known issue to address before production deployment

## User preferences
