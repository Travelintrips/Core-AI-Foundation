---
name: Phase 4 Template Library Integration
description: Rules and findings from cherry-picking feature/design-template-phase4-library into integration/design-template-phase4-repair
---

## Integration Branch
`integration/design-template-phase4-repair` — 4 commits on top of main

## Key Resolution Rules

### File-by-file decisions
- **design-templates.ts (api-server)**: ZIP 501 stub replaced with Phase 4's full `enqueueZipExport()` impl + GET poll endpoint. Phase 2 endpoints (preview, single-render batch flow) preserved untouched.
- **routes/index.ts**: Canonical router = `designTemplatesAiAssistRouter` from `./design-templates-ai-assist`. The old `./design-template-ai` file still exists but is NOT imported; removing that import was correct.
- **App.tsx**: Route order matters — `/ai-create` and `/:id/editor` must come BEFORE `/:id`. Both main's DesignRenderBatches routes AND phase4's DesignTemplates/DesignTemplateDetail routes are kept.
- **layout.tsx**: Dedup nav entries — only one `/design-templates` entry; keep `FileStack` icon (phase4); keep Bulk Render + AI Template Assistant from main.
- **design-templates.tsx (ai-platform)**: Take phase4's version (942 lines) — it exports both `DesignTemplatesPage` (default) and `DesignTemplateDetailPage` (named export needed by design-template-detail.tsx).
- **design-template-detail.tsx**: Take phase4's version (21-line wrapper importing DesignTemplateDetailPage from ./design-templates).
- **vitest.config.ts**: Keep `globals: false` explicit.
- **pnpm-lock.yaml**: Regenerate from baseline with `pnpm install --lockfile-only` then `pnpm install`.

### DB package rebuild
Running `tsc -b` in lib/db/ is required after adding a new schema file. lib/db uses TypeScript project references; api-server's tsconfig references lib/db and reads from dist/. Without rebuild, new schema types are invisible.

**Why:** `lib/db/tsconfig.json` has `"composite": true` + `"outDir": "dist"`. When a new schema file is added to lib/db/src/schema/, running `tsc -b` in lib/db generates new .d.ts files. Without it, `@workspace/db` won't export the new types.

**Side effect:** tsc -b rebuild of lib/db exposed pre-existing typecheck errors in creativeBrandIntelligenceService, creativeWorkflowRunner, brandKitEnterpriseService that were hidden by stale dist/. These are NOT new from Phase 4.

### Typecheck fixes required after cherry-pick
- `design-templates.ts`: `createVersion()` takes 1 object arg (not 4 positional). Fix: `createVersion({ templateId, tenantId, templateJson, changelog, createdBy })`.
- `design-templates.ts`: `getPreviewData()` returns `{ template, version, templateJson, sampleData }` — access `previewData.version.id` not `.versionId`.
- `design-templates.ts`: `PreviewResult` has no `renderDurationMs` (only `PipelineResult` does). Measure manually: `const t0 = Date.now(); ... const ms = Date.now() - t0`.
- `design-templates.ts`: width/height from `renderDataRowSchema` data record is `string|number|boolean|null`. Use typeof guard before passing to typed params.
- `outputEncoder.ts`: `"jpeg"` is not in `RenderFormat = "png"|"jpg"|"webp"|"pdf"`. Remove all `=== "jpeg"` comparisons; "jpg" is canonical.
- `design-template-ai.ts`: `createVersion` accepts only `CreateVersionInput` — no `canvasWidth`, `canvasHeight`, `variables`; rename `changeNote` → `changelog`.

### Package installation
Phase 4 adds: papaparse, xlsx, uuid (runtime); @types/uuid (devDep). Run `pnpm install` after updating package.json to make these available in Vite's dep optimizer.

## Final Verification Results
- Tests: 914/914 passing (39 test files)
- api-server typecheck: 0 new errors from Phase 4 (70 total = all pre-existing)
- ai-platform typecheck: 0 new errors (pre-existing = konva errors in design-editor/ from V4.5)
- Conflict markers: 0 remaining
- API server: starts cleanly (RUNNING)
- DDL migration: artifacts/api-server/src/migrations/20260716_design_render_zip_exports.sql

## DDL Required Before Production Use
Apply `20260716_design_render_zip_exports.sql` via psql/Supabase dashboard.
Never use drizzle-kit push (documented risk: drizzle-push-false-positive).

## Pre-existing Errors (NOT from Phase 4)
presentationRenderService (pptxgenjs types), zipDeliveryService (mimeType column),
creative-marketplace (Express 5 params string|string[]), v42d-zip-delivery (test type comparisons),
creativeBrandIntelligenceService/creativeWorkflowRunner (clientId/emailHash columns never in schema),
brandKitEnterprise/assetLibraryService (arity mismatches), scripts/ (pg module).
