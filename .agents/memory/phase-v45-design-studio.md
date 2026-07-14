---
name: phase-v45-design-studio
description: V4.5 AI Design Studio — canvas editor with layers, undo/redo, AI regenerate, version history, export
---

# V4.5 AI Design Studio

## Architecture
- **DB**: 2 new tables — `ai_design_projects`, `ai_design_versions` (hand-written DDL in `scripts/migrations/v4.5-design-studio.sql`)
- **Drizzle schema**: `lib/db/src/schema/ai-design-studio.ts` → exported in `index.ts`
- **API service**: `artifacts/api-server/src/services/designStudioService.ts`
- **API routes**: `artifacts/api-server/src/routes/design-studio.ts` → registered in `routes/index.ts`
- **Frontend**: `artifacts/ai-platform/src/pages/design-studio.tsx` (list), `design-studio-editor.tsx` (editor)
- **Components**: `artifacts/ai-platform/src/components/design-studio/` — canvas-area.tsx, layer-panel.tsx, properties-panel.tsx, toolbar.tsx, types.ts

## Route prefix rule (CRITICAL)
Routes in `design-studio.ts` use `/ai/design/...` NOT `/api/ai/design/...`.
`app.use("/api", router)` strips the `/api` prefix, so router paths must NOT include it.
The health route `router.get("/healthz")` confirms this pattern.

**Why:** Initial implementation used `/api/ai/design/...` and got 404. Fixed to `/ai/design/...` which returns 401 (auth required — route exists).

## OpenAPI insertions (line positions at time of writing)
- Tag added before `paths:` (line ~62)
- 14 new paths added before `components:` (line ~6708)
- Schemas block added before `End V4.3 schemas` comment

## Canvas state JSON structure
```typescript
{
  width: number; height: number; background: string;
  elements: DesignElement[];  // each has id, type, x, y, w, h, rotation, opacity, zIndex, locked, visible + type props
}
```
Stored as JSONB in `ai_design_versions.canvas_state`. `ai_design_projects.current_version_id` points to latest.

## Pre-existing typecheck failures (NOT introduced by V4.5)
- `src/services/presentation/presentationRenderService.ts` — PptxGenJS namespace type errors
- `src/services/templateService.ts` — previews_generated vs previewsGenerated
- `src/services/zipDeliveryService.ts` — mimeType missing

These fail `pnpm run verify` but are pre-existing. `pnpm run build:api` (esbuild) and ai-platform typecheck both pass clean.

## Known limitations
- DB tables not yet created (requires running `scripts/migrations/v4.5-design-studio.sql` against Supabase)
- PNG export is SVG-based (no headless browser/rasterization)
- DesignStudioEditor is exempt from the admin Layout wrapper (full-screen editor)
