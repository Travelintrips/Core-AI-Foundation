# AI Enterprise Platform

A multi-artifact pnpm monorepo powering a creative-AI agency platform: service catalog, quotation flow, job engine, customer portal, design studio, and digital workforce.

## Architecture

| Artifact | Path | Preview | Purpose |
|---|---|---|---|
| **API Server** | `artifacts/api-server` | `/api` | Node.js/Express backend + Drizzle ORM + Supabase PostgreSQL |
| **Admin Dashboard** | `artifacts/ai-platform` | `/admin/` | React/Vite internal staff portal |
| **Customer Portal** | `artifacts/customer-portal` | `/` | React/Vite client-facing portal |
| **Mockup Sandbox** | `artifacts/mockup-sandbox` | `/__mockup` | Component preview server for canvas design work |

Shared libraries live in `lib/`: `lib/db` (Drizzle schema + pool), `lib/api-spec` (OpenAPI), `lib/api-zod` (generated Zod schemas), `lib/api-client-react` (generated React Query hooks).

## How to run

All workflows are managed by Replit. The run button starts the API Server by default.

### Manual workflow restart (shell)
```bash
# Install dependencies (first time or after imports)
pnpm install

# Build libs + API server
pnpm run build:workspace

# Dev (run from root; workflows handle this automatically)
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ai-platform run dev
pnpm --filter @workspace/customer-portal run dev
```

### Database
The app connects to **Supabase PostgreSQL** (schema: `ai_platform`).

Required secrets:
- `SUPABASE_DEV_DATABASE_URL` — used in development (NODE_ENV ≠ production)
- `SUPABASE_PROD_DATABASE_URL` — used in production deployments

Without these the API server will **not** connect to the database, though it will still start. Set them as Replit Secrets.

Seed the database after first connect:
```bash
pnpm --filter @workspace/api-server run seed
```

### Environment variables (already configured in Replit)
| Key | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI text/image generation |
| `ANTHROPIC_API_KEY` | Anthropic Claude generation |
| `GEMINI_API_KEY` | Google Gemini generation |
| `COHERE_API_KEY` | Cohere generation |
| `MISTRAL_API_KEY` | Mistral generation |
| `REPLICATE_API_TOKEN` | Replicate image generation |
| `ADMIN_API_KEY` / `VITE_ADMIN_API_KEY` | Admin API authentication (same value) |
| `SMTP_*` | Hostinger SMTP for transactional email |
| `FONNTE_TOKEN` | WhatsApp notification service |
| `ALLOWED_ORIGINS` | CORS allowlist for deployed URLs |
| `SESSION_SECRET` | Express session signing |

## Key scripts
```bash
pnpm run typecheck          # Full workspace typecheck
pnpm run build:generated    # Regenerate API client from OpenAPI spec
pnpm --filter @workspace/api-server run seed   # Seed providers, models, and base agent
pnpm --filter @workspace/api-server run test   # Backend tests
pnpm --filter @workspace/ai-platform run test  # Frontend tests
```

## User preferences
- Keep existing project structure — do not restructure or migrate to a different stack.
- Use `pnpm` only (preinstall guard rejects npm/yarn).
- Never import `zod` directly in `api-server` routes — use `@workspace/api-zod` schemas only.
- Always `parseInt(agentId, 10)` before DB queries (API schema is `string|null`, DB column is `number`).
