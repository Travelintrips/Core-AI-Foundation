# AI Platform Enterprise

An enterprise-grade control plane for managing AI infrastructure — providers, models, workflows, prompts, knowledge bases, memory, audit logs, analytics, and settings. All configuration is database-driven with no hardcoded values.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `PORT=20785 BASE_PATH=/ pnpm --filter @workspace/ai-platform run dev` — run the frontend (port 20785)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080)
- Frontend: React + Vite (port 20785)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Charts: Recharts
- UI: shadcn/ui + Tailwind
- Routing: wouter

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all endpoints)
- `lib/api-client-react/src/generated/api.ts` — Generated React Query hooks
- `lib/api-zod/src/generated/api.ts` — Generated Zod validation schemas
- `lib/db/src/schema/` — All 12 Drizzle schema files
- `artifacts/api-server/src/routes/` — Express route handlers (registry, orchestrator, workflows, prompts, knowledge, memory, audit, analytics, settings)
- `artifacts/ai-platform/src/pages/` — Frontend pages (9 pages)

## Database Tables

| Table | Purpose |
|-------|---------|
| `ai_providers` | AI provider registry (OpenAI, Anthropic, etc.) |
| `ai_models` | Model catalog per provider |
| `ai_orchestrator_sessions` | Orchestration session tracking |
| `ai_workflows` | Workflow definitions with steps |
| `ai_workflow_executions` | Execution history per workflow |
| `ai_prompts` | Prompt library |
| `ai_prompt_versions` | Version history per prompt |
| `ai_knowledge_bases` | Knowledge base registry |
| `ai_knowledge_documents` | Documents per knowledge base |
| `ai_memory` | Agent memory entries |
| `ai_audit_logs` | Immutable audit trail |
| `ai_settings` | Key-value platform config |

## Architecture decisions

- **Contract-first**: All API contracts defined in OpenAPI spec, never the reverse. Codegen produces hooks and validators.
- **Database-driven config**: All settings, provider credentials, and model configs stored in DB — no env var hardcoding for business logic.
- **Simulated execution**: Orchestrator and workflow execution are simulated (no real API calls). API keys are stored in `ai_settings` for when real execution is wired.
- **Audit logging inside route handlers**: Each route module writes audit logs using a shared `logAudit()` helper. No middleware-level audit.
- **react-icons/si constraint**: SiOpenai/SiAnthropic/SiGoogle do NOT exist in react-icons v5.4.0. Use SiReplicate, SiMistralai, or lucide-react Cpu icon with color variants for provider icons.

## Product

- **Dashboard** — Platform-wide telemetry (provider/model counts, token usage, charts, recent audit activity)
- **AI Registry** — Manage providers and models with CRUD; search, filter, status badges
- **Orchestrator** — Interactive playground for sending prompts to AI models, session tracking
- **Workflow Engine** — Multi-step AI chain definitions with status lifecycle (draft/active/paused/archived)
- **Executions** — Full history of workflow runs with status, duration, token usage
- **Prompt Library** — Prompt management with variable extraction and version history
- **Knowledge Base** — Document indexing by knowledge base with status tracking
- **Memory** — Agent memory entries filterable by type, agent, and session
- **Audit Log** — Immutable event log filterable by module and action
- **Settings** — Editable key-value platform configuration grouped by category

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Workflows require `PORT` and `BASE_PATH` env vars injected by the workflow runner — do not hardcode ports
- `zod/v4` is NOT available in `artifacts/api-server` — do not import it there; use `@workspace/api-zod` schemas instead
- `pnpm run typecheck:libs` must be run before api-server typecheck when db schema changes; otherwise db exports appear missing
- Analytics data is partially simulated (provider breakdown, token counts) since real provider API calls are not implemented
- Seeding via direct SQL bypasses audit log middleware — audit log entries only appear after real API usage

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- OpenAPI spec at `lib/api-spec/openapi.yaml` is the single source of truth — update it first, then run codegen
