---
name: Phase 5 Image Designer
description: Design rules and gotchas for the AI Image Designer pipeline (creative_ai_assets table, imageDesignerService, image routes)
---

## Orval naming collision rule
When adding schemas to lib/api-spec/openapi.yaml, **never name a component schema the same as the operation request-body alias Orval generates**. Example: a schema named `UpdateAssetStatusBody` collides with Orval's generated const of the same name in api.ts; rename the schema to `AssetStatusUpdate` or similar. The collision produces a TS2308 "already exported a member" error during `pnpm codegen`.

**Why:** Orval exports both a Zod const (from the operation) and a TS interface (from the component schema), and `lib/api-zod/src/index.ts` re-exports both via `export *`.

**How to apply:** Whenever you add a new `PATCH`/`PUT` component schema, check that its name differs from the `<OperationId>Body` pattern Orval would generate for the corresponding operation's request body.

## logAudit status literals
`logAudit()` only accepts `"success" | "failure"` — there is no `"warning"` variant. Use `"failure"` for skipped/capped/degraded events and include a `reason` in the details payload.

## Asset lifecycle: insert before generation, update after
The `creative_ai_assets` table rows must be inserted with status `generating` **before** calling the Replicate API, then updated to `completed`/`failed` when the provider responds. Inserting only at the end means:
- The concurrency guard (route checks for `status = 'generating'` rows) sees nothing and allows duplicate pipeline runs
- The frontend polling loop shows an empty grid while generation is in progress

**How to apply:** In imageDesignerService, after prompts are generated, bulk-insert all asset rows as `generating`, capture their DB IDs, then update each row in-place using those IDs as generation/QC completes.

## Replicate FLUX.1 Schnell model identifier
Use `black-forest-labs/flux-schnell` (with the models/predictions path: `POST /v1/models/{modelId}/predictions`). Supports `Prefer: wait` header for sync mode. Falls back to polling at 2.5s intervals if prediction is not yet `succeeded`.

## getProviderApiKey helper
Located in `artifacts/api-server/src/services/aiSecretService.ts`. Call as `getProviderApiKey("replicate")` — returns the REPLICATE_API_TOKEN secret or null. Never check `process.env` directly; the helper normalises provider slug → env var name.
