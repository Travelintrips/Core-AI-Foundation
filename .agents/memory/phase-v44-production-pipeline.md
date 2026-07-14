---
name: phase-v44-production-pipeline
description: V4.4 Creative Production Pipeline — design decisions, migration notes, known pre-existing verify failures
---

## V4.4 Production Pipeline

### Tables created (via migrate-v44.ts)
- `ai_platform.ai_production_pipelines` — one per run, runId UUID, projectId FK
- `ai_platform.ai_pipeline_stages` — one per stage per run, FK to pipeline id

### Migration pattern
- DO NOT use `new Pool({connectionString})` from 'pg' in migrate-v*.ts scripts — api-server doesn't list pg as a direct dep; ESM module resolution fails.
- Use `import { pool } from "@workspace/db"` and call `pool.connect()` instead.
- End migration with `process.exit(0)` inside the finally block (not `pool.end()`) since the pool is shared.

### 7 pipeline stages (in order)
1. creative_director — runs/warm-starts brief workflow (runCreativeBriefWorkflow)
2. copywriter — warm-starts from creative_project_steps "Copy Production"
3. designer — runs/warm-starts imageDesignerPipeline
4. presentation — enqueues pptx_export job; skips if resolveProjectPresentationType returns null
5. qa — warm-starts from creative_project_steps "Quality Control"
6. renderer — enqueues pdf_export job; skips if resolveProjectDocumentType returns null
7. customer_review — sets project.status = 'waiting_client_review'

### Route order sensitivity
The static monitoring route `GET /creative-ai/production-pipeline/monitoring` MUST be registered before `GET /creative-ai/production-pipeline/:runId` to avoid param capture.

### Generated schema naming (orval convention for these endpoints)
- startProductionPipeline → StartProductionPipelineBody + StartProductionPipelineResponse
- getPipelineMonitoringStats → GetPipelineMonitoringStatsResponse (no params)
- getProductionPipeline → GetProductionPipelineParams + GetProductionPipelineResponse
- listProductionPipelineStages → ListProductionPipelineStagesParams + ListProductionPipelineStagesResponse
- retryPipelineStage → RetryPipelineStageParams + RetryPipelineStageBody + RetryPipelineStageResponse
- cancelProductionPipeline → CancelProductionPipelineParams + CancelProductionPipelineResponse
- listProjectPipelineRuns → ListProjectPipelineRunsParams + ListProjectPipelineRunsResponse

### Pre-existing typecheck failures (NOT V4.4)
`pnpm run verify` fails on pre-existing errors in these files (confirmed in git HEAD before V4.4):
- presentationRenderService.ts — PptxGenJS namespace type errors
- templateService.ts(349) — `previews_generated` vs camelCase `previewsGenerated`
- zipDeliveryService.ts — mimeType property and argument count errors

**Why:** These are pre-existing issues from prior phases, not caused by V4.4 additions.

### Admin UI page
`/production-pipeline` uses `useQuery`/`useMutation` from @tanstack/react-query with manual `apiFetch` calls (avoids generated hook dependency; self-contained). Uses `import.meta.env.BASE_URL` for API prefix construction.
