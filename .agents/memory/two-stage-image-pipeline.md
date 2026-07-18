---
name: Two-Stage Image Preview Pipeline
description: Two-stage image generation pipeline: Preview → Customer Selection → Final Render with QC.
---

## Overview
The image generation pipeline was changed from single-stage to two-stage:
1. **Preview** — cheap FLUX Schnell concepts (no QC), customer selects one
2. **Final** — tier-based quality render with full QC

## Key design decisions

**render_stage column on creative_ai_assets** — 'legacy' | 'preview' | 'final'. All pre-existing rows default to 'legacy' for full backward compatibility. No separate tables needed.

**creative_render_sessions table** — new table tracking the lifecycle of one preview-to-final cycle per project. A project can have multiple sessions.

**Status flow:**
`planning → preview_generating → preview_ready → waiting_customer → concept_selected → final_generating → quality_check → completed`

**Package tiers (final render only):**
- standard   → FLUX Schnell, quality=80
- premium    → FLUX Dev, quality=90
- enterprise → FLUX Dev, quality=95
- preview always: FLUX Schnell, quality=70 (no QC)

**QC runs ONLY on final images, never on previews.**

## Files added
- `integration/migrations/preview-pipeline.sql` — DDL (already applied to dev DB)
- `lib/db/src/schema/creative-render-sessions.ts` — new Drizzle schema
- `lib/api-zod/src/image-preview-pipeline.ts` — Zod schemas (exported from index)
- `artifacts/api-server/src/services/imagePreviewService.ts` — full pipeline service
- `artifacts/api-server/src/routes/image-preview-pipeline.ts` — 7 REST endpoints
- `artifacts/customer-portal/src/pages/workspace/creative-preview.tsx` — concept selection UI
- `artifacts/api-server/src/services/__tests__/imagePreviewService.test.ts` — 17 tests

## API endpoints (all live)
- `POST /creative-ai/projects/:id/sessions` — create session + start preview
- `GET  /creative-ai/projects/:id/sessions` — list sessions
- `GET  /creative-ai/sessions/:sessionId` — session + concepts + finals
- `POST /creative-ai/sessions/:sessionId/select-concept` — customer selects
- `POST /creative-ai/sessions/:sessionId/generate-final` — start final render
- `POST /creative-ai/sessions/:sessionId/more-previews` — more concepts
- `GET  /creative-ai/analytics/preview-pipeline` — analytics

## Customer portal route
`/creative-preview/:sessionId` → `pages/workspace/creative-preview.tsx`

## Why vi.importActual for backward-compat tests
The file-level `vi.mock("@workspace/db")` in the test suite intercepts the DB module for all imports in scope. Backward-compatibility tests that check the real Drizzle table structure must use `vi.importActual` to bypass the mock.

## Production migration
Apply `integration/migrations/preview-pipeline.sql` to prod Supabase before deploying:
`psql $SUPABASE_PROD_DATABASE_URL -f integration/migrations/preview-pipeline.sql`
