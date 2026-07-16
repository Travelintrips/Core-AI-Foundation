# AI Enterprise Platform (Creative Studio)

A full-stack AI enterprise platform for managing creative AI services, customer projects, and document generation. Built as a pnpm monorepo with three runnable artifacts.

## Stack

- **Runtime**: Node.js 20, pnpm workspaces
- **Database**: Supabase PostgreSQL (`ai_platform` schema)
- **API**: Express + Drizzle ORM + Zod validation (OpenAPI spec-driven)
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **AI providers**: OpenAI, Anthropic, Gemini, Mistral, Cohere, Replicate
- **Storage**: Supabase Object Storage (`ai-assets` bucket)

## Artifacts

| Artifact | Path | Dev URL |
|---|---|---|
| Customer Portal (Creative Studio) | `artifacts/customer-portal` | `/` |
| Admin Panel (Internal AI Portal) | `artifacts/ai-platform` | `/admin/` |
| API Server | `artifacts/api-server` | `/api/` |
| Mockup Sandbox | `artifacts/mockup-sandbox` | `/__mockup` |

## Running the Project

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure required secrets

The following must be set as Replit Secrets before the API server will start:

| Secret key | Description |
|---|---|
| `SESSION_SECRET` | Express session signing key |
| `ADMIN_API_KEY` + `VITE_ADMIN_API_KEY` | Admin route auth (same value, set both) |
| `SUPABASE_DEV_DATABASE_URL` | Dev Supabase connection string |
| `SUPABASE_PROD_DATABASE_URL` | Prod Supabase connection string |
| `OPENAI_API_KEY` | OpenAI provider |
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `GEMINI_API_KEY` | Google Gemini provider |
| `REPLICATE_API_TOKEN` | Replicate image generation |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email (Hostinger SMTP) |

Also required as plain env vars (not secrets):
- `INITIAL_INTERNAL_ADMIN_EMAIL` — email for the first admin account (dev only)
- `INITIAL_INTERNAL_ADMIN_PASSWORD` — password for the first admin account (dev only)
- `ALLOWED_ORIGINS` — comma-separated list of allowed CORS origins

### 3. Start workflows

All three workflows start automatically via Replit:
- `artifacts/api-server: API Server` — builds then starts on `$PORT`
- `artifacts/ai-platform: web` — Vite dev server at `/admin/`
- `artifacts/customer-portal: web` — Vite dev server at `/`

To start manually: use the **Run** button or restart individual workflows from the Replit UI.

### 4. Verify health

```bash
curl http://localhost:$PORT/api/healthz
# → { "status": "ok" }
```

Admin panel should show a login screen at `/admin/`. Customer portal shows the Creative Studio landing page at `/`.

### 5. Seed the database (first run only)

```bash
pnpm --filter @workspace/api-server run seed
```

This is idempotent — safe to re-run. Seeds AI providers, models, and a default agent.

For the initial internal admin user, run:

```bash
pnpm --filter @workspace/api-server run seed:internal-admin
```

Admin credentials are controlled by the `INITIAL_INTERNAL_ADMIN_EMAIL` and `INITIAL_INTERNAL_ADMIN_PASSWORD` environment variables — never hardcode them here.

## Shared Libraries

Located under `lib/`:
- `lib/db` — Drizzle schema + pool — **run `tsc -b` here before typechecking api-server**
- `lib/api-spec` — OpenAPI spec + Orval codegen
- `lib/api-zod` — Generated Zod schemas — use these in api-server routes; never import `zod/v4` directly
- `lib/api-client-react` — Generated React Query hooks for frontends

## Key Scripts

```bash
pnpm run typecheck:libs                             # typecheck shared libs (run before api-server)
pnpm --filter @workspace/api-server run typecheck  # typecheck api-server
pnpm run build:generated                           # regenerate API client from OpenAPI spec
pnpm --filter @workspace/api-server run seed       # seed providers/models/agents
pnpm --filter @workspace/api-server run test       # run api-server tests
```

## Architecture Notes

- API routes must never import `zod/v4` directly — use `@workspace/api-zod` schemas only
- Admin route auth is a single global middleware in `artifacts/api-server/src/app.ts` (`adminAuthWithExceptions`) — never add per-route auth middleware
- DB queries that take an `agentId` from the API schema receive it as `string|null` — always `parseInt(agentId, 10)` before querying
- The worker cluster (text/image/storage workers) registers in-memory at startup; a clean restart recovers via the startup-resume logic in `app.ts`

## User Preferences

- Keep the existing monorepo structure and stack
- Do not restructure or migrate to a different framework
