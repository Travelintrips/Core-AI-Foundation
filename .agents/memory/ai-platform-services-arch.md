---
name: AI Platform service architecture
description: Modular services layout and key gotchas in the api-server
---

## Services in artifacts/api-server/src/services/
- `aiAuditService.ts` — logAudit(); never throws, catches internally
- `aiSecretService.ts` — getProviderApiKey(slug), maskSecretValue(), isSecretKey(); reads env vars only, never DB
- `aiModelService.ts` — getActiveModel(id), getAllActiveModels(); filters inactive models and providers
- `aiModelRouter.ts` — routeToModel(prompt) auto-routes by task-type keyword detection + capability score + cost; getFallbackModels(excludeId)
- `aiExecutionService.ts` — executeAI(input); dispatches to OpenAI (npm package), Anthropic (fetch), Gemini (fetch), Replicate (fetch + poll)

## Critical gotcha: agentId type mismatch
`agentId` in `OrchestratorExecuteBody` (from OpenAPI schema) is `string | null | undefined`, but `aiAgentsTable.id` is a number (PgSerial). Always convert: `const agentDbId = agentId != null ? parseInt(agentId, 10) : null` and guard `!Number.isNaN(agentDbId)` before using in Drizzle where clause.

## OpenAI model params
- o-series models (o1, o3, o4-mini, etc.): no `temperature`, use `max_completion_tokens`
- GPT-4o and others: use `temperature` + `max_completion_tokens`
- Detection: `/^o\d/i.test(modelId)`

**Why:** Type mismatch caused TS error TS2769 in orchestrator route. Pattern now documented to avoid repeat.
