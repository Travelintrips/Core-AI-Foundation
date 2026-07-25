# Creative AI Studio

A full-stack monorepo for an AI-powered creative services platform used by CST Logistic.

## Architecture

This is a pnpm workspace monorepo with six artifacts:

| Artifact | Preview Path | Description |
|---|---|---|
| `artifacts/api-server` | `/api` | Express + Drizzle ORM backend (Node 20) |
| `artifacts/ai-platform` | `/admin/` | React + Vite admin dashboard (staff/internal) |
| `artifacts/customer-portal` | `/` | React + Vite customer-facing portal |
| `artifacts/cargo-finder` | `/cargo-finder/` | React + Vite cargo rate finder |
| `artifacts/customer-mobile` | `/mobile/` | Expo React Native mobile app |
| `artifacts/mockup-sandbox` | `/__mockup` | Vite component preview server (design tooling) |

Shared libraries live in `lib/`: `api-spec`, `api-zod`, `api-client-react`, `db`, `design-components`, `design-workflow`.

## How to Run

All workflows are configured and start automatically. Each service binds to the `PORT` env var assigned by Replit.

**Development workflow commands:**
- API server: `pnpm --filter @workspace/api-server run dev` (builds then starts on port 8080)
- Admin frontend: `pnpm --filter @workspace/ai-platform run dev`
- Customer portal: `pnpm --filter @workspace/customer-portal run dev`
- Cargo finder: `pnpm --filter @workspace/cargo-finder run dev`
- Mobile: `pnpm --filter @workspace/customer-mobile run dev`

**Build all shared libs before API server:**
```bash
pnpm run build:generated   # codegen from OpenAPI spec
pnpm run build:libs        # TypeScript project references
pnpm run build:api         # esbuild bundle
```

## Database

- **Development**: Supabase project `xssrfshdrtdfupgqwfdw` (ap-southeast-2)
- **Production**: Supabase project `nzdweipzckfszczzqtuw` (ap-southeast-2)
- Schema lives in `lib/db/src/schema/` (Drizzle ORM)
- All tables are in the `ai_platform` schema (not `public`)

Seed the database: `pnpm --filter @workspace/api-server run seed`

## Authentication

- **Admin/staff**: email + password login at `/admin/` — initial password in `INITIAL_INTERNAL_ADMIN_PASSWORD`
- **API auth**: `ADMIN_API_KEY` header for internal service-to-service calls
- **Customer portal**: token-based (reviewToken / dashboardToken issued per request)

## Environment

All secrets are stored in `.replit` under `[userenv]` sections and in `.env.development` for local dev. See `.env.example` for the full list of required variables.

Key non-secret config in `.replit [userenv.shared]`:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM`
- `ALLOWED_ORIGINS`
- `ADMIN_API_KEY`, `VITE_ADMIN_API_KEY`

## User Preferences

- Keep existing project structure and stack — do not restructure or migrate.
- Use `pnpm` only (preinstall hook blocks npm/yarn).
- Never commit secrets or credentials into `.replit` or any tracked file.
- New tables must be hand-written DDL (do not use `drizzle-kit push` — it proposes dropping the entire `ai_platform` schema).
