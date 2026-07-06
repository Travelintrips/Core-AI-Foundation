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
lib/
  api-spec/        # OpenAPI definition (source of truth)
  api-client-react/ # Generated React Query hooks
  api-zod/         # Generated Zod schemas
  db/              # Drizzle schema + DB client
scripts/           # Dev automation scripts
```

## Notes

- AI execution (orchestrator/workflows) and analytics are currently simulated — no external AI API keys required
- `SESSION_SECRET` env var is pre-configured
- pnpm-workspace.yaml enforces a 1-day `minimumReleaseAge` for npm packages (supply-chain safety)

## User preferences
