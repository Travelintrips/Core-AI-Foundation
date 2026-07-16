---
name: Design Template Engine — Phase 1
description: Foundation rules, file locations, and key decisions for the Design Template Engine feature (Internal Design Template Engine spec).
---

# Design Template Engine — Phase 1 Foundation

## Key Rules

**Renderer decision**: SVG + Sharp (Phase 2). No Playwright. Phase 1 is foundation only.

**zod import**: Phase 1 added `"zod": "catalog:"` to `artifacts/api-server/package.json` so plain `import { z } from "zod"` works in api-server service/validator files. Route files still use `@workspace/api-zod` per the existing rule.

**Date formatter order**: In `designTemplateVariableService.ts`, replace "MMM" before "MM" — otherwise the "MM" in "MMM" gets replaced first and corrupts the month name output.

**Migration runner for dev**: Use `node --input-type=module` with `createRequire` resolving pg from `lib/db` node_modules. The scripts/tsx approach fails (top-level await in cjs mode). The production migration is handled by `scripts/src/migrate-prod.ts` (step id: `design-template-engine-phase1`).

**Tenant isolation**: All service functions take `tenantId: string` and call `assertTenantMatch()` from `designTemplateVariableService.ts`. The system is single-tenant in production (`"default"`).

**Published version immutability**: `publishVersion()` guards against re-publishing the same version (idempotent). The `PATCH /design-templates/:id` endpoint explicitly blocks setting `status: "published"` — must use `POST .../publish`.

**Batch fan-out pattern**: `design_render_batch_dispatch` job reads queued items and enqueues individual `design_render` jobs. Do NOT put all items in one job payload.

## New Files

- `lib/db/src/schema/design-template-engine.ts` — 4 Drizzle ORM table definitions
- `artifacts/api-server/src/types/designTemplate.ts` — full TS domain types + DESIGN_LIMITS constants
- `artifacts/api-server/src/validators/designTemplateSchema.ts` — zod schemas for template JSON + API requests
- `artifacts/api-server/src/services/designTemplateService.ts` — CRUD for templates + versions
- `artifacts/api-server/src/services/designRenderBatchService.ts` — batch lifecycle + progress sync
- `artifacts/api-server/src/services/designTemplateVariableService.ts` — variable resolver, formatters, validators, idempotency hash, tenant guard
- `artifacts/api-server/src/services/designRenderWorkerService.ts` — Phase 2 stub for 3 job types
- `artifacts/api-server/src/routes/design-templates.ts` — full REST API (13 endpoints)
- `artifacts/api-server/src/tests/designTemplate.test.ts` — 46 unit tests (all passing)

## Modified Files

- `lib/db/src/schema/index.ts` — added `export * from "./design-template-engine"`
- `artifacts/api-server/src/routes/index.ts` — added `designTemplatesRouter`
- `artifacts/api-server/src/services/jobWorkerService.ts` — 3 new case branches (design_render, design_render_batch_dispatch, design_render_zip_export)
- `scripts/src/migrate-prod.ts` — added step `design-template-engine-phase1` (4 tables + 5 indexes)
- `artifacts/api-server/package.json` — added `"zod": "catalog:"`

## Pre-existing Typecheck Errors (Not Introduced)

`workerClusterService.ts` and `zipDeliveryService.ts` had pre-existing typecheck errors before Phase 1. These are not new. Build still succeeds (esbuild, not tsc).

## Phase 2 Next Steps

SVG + Sharp renderer in `designRenderWorkerService.ts`:
- Replace `executeDesignRenderJob` stub with real SVG generation
- Add font registry
- Add image resolver with SSRF guard + local cache
- Add QR code generator (qrcode npm package)
- Add Sharp output (png/jpg/webp)
- Add pdf-lib integration for PDF output
