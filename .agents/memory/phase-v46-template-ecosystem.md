---
name: phase-v46-template-ecosystem
description: V4.6 Template Engine — Theme Engine, Layout Engine, Registry, Versioning, Mappings (13 categories)
---

# V4.6 Template Ecosystem

## What was built
- **Theme Engine**: `ai_template_themes` table (themeKey, name, category, tokens_json JSONB); 8 default themes seeded; `themeEngineService.ts` + CRUD routes at `/ai/engine/themes/*`
- **Layout Engine**: `ai_template_layouts` table (layoutKey, name, category, layout_type, structure_json JSONB); 8 default layouts seeded; `layoutEngineService.ts` + routes at `/ai/engine/layouts/*`
- **Template Registry**: `ai_template_registry` table (templateKey, name, category, status, current_version_id); 13 seed entries (one per category); `templateRegistryService.ts` + routes at `/ai/engine/registry/*`
- **Versioning**: `ai_template_versions` table (template_id→registry, version_number, theme_id, layout_id, layout_spec_json, theme_overrides_json, changelog, published_at); createVersion / publishVersion / rollbackToVersion / compareVersions
- **Brand/Industry/Package Mappings**: 3 tables; replace-all PUT semantics; weight-based recommendation scoring
- **Public endpoints**: `/public/engine/categories`, `/public/engine/themes`, `/public/engine/layouts`, `/public/engine/recommend` (POST)
- **Admin UI**: `artifacts/ai-platform/src/pages/template-engine.tsx` — 4 tabs (Overview, Theme Engine, Layout Engine, Registry); nav added to layout.tsx

## 13 canonical categories (TEMPLATE_CATEGORIES in themeEngineService.ts)
Company Profile, Proposal, Pitch Deck, Brochure, Catalog, Flyer, Banner, Presentation, Website, Landing Page, Whitepaper, Case Study, Annual Report

## Key rules / gotchas

**DB column mismatch**: `ai_template_layouts` in DB did NOT have `layout_type` column — had to ALTER TABLE ADD COLUMN before seeding worked. Always audit DB columns before writing Drizzle schema.

**Registry raw SQL returns snake_case**: `listRegistryTemplates` uses raw SQL (for JOIN with versions/themes/layouts) — response fields are snake_case (`template_key`, `theme_name`, `layout_name`) not camelCase. Drizzle ORM select returns camelCase. Keep this distinction.

**numeric vs integer weight**: Mapping tables use `numeric` for weight column in DB; Drizzle `integer` works (PG casts implicitly) but returned type may be string from the driver.

**apiFetch URL prefix**: Admin platform pages must use `/api/ai/engine/...` paths (not `/ai/engine/...`) because BASE_URL is `/admin/` and the API is on a separate port/path. apiFetch is defined inline per page (no shared `@/lib/api` module exists — importing it breaks the build).

**Route files**: `artifacts/api-server/src/routes/template-engine.ts` — paths are `/ai/engine/*` (no `/api` prefix — router is mounted at `/api` in app.ts). Registered in `routes/index.ts` as `router.use(templateEngineRouter)`.

**Seed endpoint**: `POST /api/ai/engine/seed` — idempotent; seeds 8 themes, 8 layouts, 13 registry templates. Must be called after first deploy.

**Drizzle schema**: New tables added to `lib/db/src/schema/ai-templates.ts` (already exported via schema/index.ts `export * from "./ai-templates"`).

**Why:** DB tables already existed from a prior migration; the Drizzle schema + services + routes + UI were missing entirely.
