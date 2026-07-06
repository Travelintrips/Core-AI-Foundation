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

## User preferences
