# AI Platform Enterprise

A full-stack AI management platform with a React dashboard frontend and Express API backend, connected to a PostgreSQL database.

## Stack

- **Frontend**: React + Vite + TypeScript, Tailwind CSS, shadcn/ui components (`artifacts/ai-platform`)
- **Backend**: Express 5 + TypeScript, built with esbuild (`artifacts/api-server`)
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **API Contract**: OpenAPI spec + Zod schemas + generated React Query client (`lib/api-spec`, `lib/api-zod`, `lib/api-client-react`)
- **Package manager**: pnpm workspace

## How to run

Both services start automatically via their configured workflows:

- **Frontend** (`artifacts/ai-platform: web`): `PORT=20785 BASE_PATH=/ pnpm --filter @workspace/ai-platform run dev`
- **API Server** (`artifacts/api-server: API Server`): `PORT=8080 pnpm --filter @workspace/api-server run dev`

The API server builds with esbuild then starts from `dist/index.mjs`. The frontend is a Vite dev server.

## Database

Uses Replit's built-in PostgreSQL. Schema is managed with Drizzle Kit.

To push schema changes to the database:
```
pnpm --filter @workspace/db exec drizzle-kit push
```

## Environment variables

- `DATABASE_URL` — PostgreSQL connection string (auto-provided by Replit)
- `SESSION_SECRET` — Secret for session signing
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
