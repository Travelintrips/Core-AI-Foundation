---
name: Phase 4 Enterprise Multi-Agent Intelligence
description: Services, DB tables, and routes added in Phase 4 — memory, capability matrix, cost intelligence, feedback loop, analytics
---

## Phase 4 Summary

### New DB Tables (pushed)
- `ai_capabilities` — capability matrix per skill/provider/model/agent; scores: accuracy, speed, cost (0–100)
- `ai_client_memory` — long-term brand preferences per clientId+key; unique constraint on (clientId, key)
- `ai_cost_records` — per-request cost tracking; totalTokens, estimatedCostUsd, latencyMs, retryCount
- `ai_feedback` — human feedback on creative project steps; action enum: approve|reject|needs_revision|human_edit

### New Services (artifacts/api-server/src/services/)
- `memoryService.ts` — read/write all 4 memory tiers (global, project, agent via ai_memory; client via ai_client_memory)
- `memoryResolver.ts` — builds `AgentExecutionContext` before each step; exports `formatContextForPrompt()` for prompt injection
- `capabilityService.ts` — queries ai_capabilities with scoring via `computeCapabilityScore()`
- `intelligentRouter.ts` — multi-factor model scoring (capability + priority + latency + cost + context fit); falls back to aiModelRouter when no matrix entries
- `costService.ts` — records per-request costs; exports `getDailyCosts()`, `getAgentCostStats()`, `getProviderCostStats()`

### Workflow Runner (Phase 4 upgrade)
- Now calls `resolveAgentContext()` before each step (reads all 4 memory tiers in parallel)
- Uses `routeForAgent()` for intelligent model selection
- Records cost per step via `recordCost()` (non-blocking)
- Appends memory context to system prompt via `formatContextForPrompt()`
- **Critical fix**: sets project status to `"failed"` when anyFailed=true (was always "completed" before)

### New Routes
- `GET/POST /capabilities` — capability matrix CRUD
- `GET /capabilities/skill/:skill` — filter by skill
- `PATCH/DELETE /capabilities/:id`
- `GET/POST /client-memory/:clientId` — client long-term memory
- `DELETE /client-memory/:clientId/:key`
- `GET/POST /creative-ai/projects/:id/feedback` — human feedback
- `GET /ai/analytics/agent-stats` — real agent performance (from cost records + feedback)
- `GET /ai/analytics/costs` — cost analytics (daily, by provider, by agent)

### Analytics fixes
- `/ai/analytics/overview` — uses real token counts from ai_cost_records
- `/ai/analytics/usage` — now uses real cost records data (no more random values)
- `/ai/analytics/provider-breakdown` — prefers cost records, falls back to provider list
- `parseDays()` helper clamps days 1–365 to prevent SQL injection via raw interval

### Frontend (artifacts/ai-platform/src/)
- `pages/analytics.tsx` — new page with KPI cards, AreaChart, PieChart, BarChart (recharts), agent performance table
- `pages/creative-ai.tsx` — added FeedbackBar component on each completed step (approve/reject/rate/comment)
- `components/layout.tsx` — added Analytics nav item
- `App.tsx` — added /analytics route

### OpenAPI / Codegen
- `lib/api-spec/openapi.yaml` — added ~600 lines: tags, paths, schemas for capabilities/client-memory/feedback/analytics
- Run `pnpm --filter @workspace/api-spec run codegen` to regenerate after openapi.yaml changes
- Generated hook names differ from schema names: CreateCapabilityBody, UpdateCapabilityBody, UpsertClientMemoryBody, SubmitProjectFeedbackBody

**Why:** ai_capabilities enables capability-based routing without hardcoded heuristics; cost records enable real analytics; client memory enables cross-session brand preference learning.

**How to apply:** When adding new routes in api-server, never import zod/v4 directly — use generated schemas from @workspace/api-zod.
