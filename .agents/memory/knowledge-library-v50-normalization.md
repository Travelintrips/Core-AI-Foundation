---
name: knowledge-library-v50-normalization
description: Phase 2-8 remediation for Template Knowledge Library V5.0 — canonical normalizer, legacy normalization, backfill, matching engine, production guard
---

## Canonical Normalizer (utils/canonicalNormalizer.ts)
- `normalizeStyle(value)` and `normalizeIndustry(value)` → canonical key or null (never silent fallback)
- `isCanonicalStyle`/`isCanonicalIndustry` correct logic: `normalizeX(trimmed) === trimmed`
  **Bug**: comparing `toKey(v) === toKey(v)` always matches because both sides lowercase identically
- 36 style aliases, 43+ industry aliases including Indonesian (teknologi→technology, properti→real_estate), abbreviations (F&B→food_beverage), synonyms (Professional→corporate, Creative→contemporary, Natural→organic, Promotional→bold)
- "Classic"→"classic" IS a valid canonical pass-through (exists in ai_style_knowledge)
- "Export"/"Trading"/"Legal" → "consulting" (no canonical "trading" key exists in ai_industry_knowledge)
- Duplicate INDUSTRY_ALIAS_MAP key: `properti` (unquoted) AND `"properti"` (quoted) — same JS key, esbuild warns; remove the quoted duplicate

**Why:** Legacy templates imported with Title Case styles (Modern, Professional) and Indonesian/abbreviated industries (Teknologi, F&B) that don't match canonical snake_case keys in knowledge tables — normalizer bridges them.

## Backfill Generator (data/legacyTemplateBackfillGenerator.ts)
- `generateLegacyPayload(template)`: full InsertAiTemplateKnowledge from template metadata + STYLE_CONFIGS + INDUSTRY_CONTEXT
- `generateLegacyPayloads([])`: in-memory dedup; deterministic; idempotent
- `findUnresolvedValues([])`: audit tool — report templates with unmappable style/industry
- Slug format: `legacy-${templateCode.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`
- LEGACY_CATEGORY_OUTPUT/SECTIONS handle categories outside seeder enums (Annual Report, Banner, etc.)

## Seed Endpoint Phases (routes/seedKnowledge.ts)
- Phase 6 (`?parts=normalize`): dry-run via `?dry=true`; live run wraps in transaction; row-by-row conditional `.set()` — no type casts, use three separate if/else if branches for style-only, industry-only, both
- Phase 7 (`?parts=backfill`): ON CONFLICT DO NOTHING; reports unresolved values; 50-row batches
- Import: only `eq, sql` from drizzle-orm (not, inArray, isNotNull are unused in this route)

## Matching Engine (services/templateKnowledgeMatchingService.ts)
- Normalizer wired at top of `findBestTemplates()`: `normalizeIndustry(v) ?? v` and `normalizeStyle(v) ?? v` on input before any scoring

## Production Guard (index.ts)
- NODE_ENV=production + no SUPABASE_PROD_DATABASE_URL + no SUPABASE_DATABASE_URL → `process.exit(1)`
- Legacy alias SUPABASE_DATABASE_URL: allow but log warning

## StyleKnowledgeSeed typecheck fix
- luxury_editorial had `spacingStyle: "dramatic"` which is not in `"generous"|"balanced"|"compact"|"airy"` → change to `"generous"`

## Final database state
- ai_templates: 1610, ai_template_knowledge: 1610
- gap: 0, orphans: 0, unknown_styles: 0, unknown_industries: 0, duplicates: 0, null_payload: 0

## Test count
- 62/62 new tests pass (canonicalNormalizer.test.ts)
- Full suite: 3427/3436 (9 pre-existing failures in design-blueprints + designComponentSecurity — adminAuthWithExceptions mock not exported, pre-dates this work, tracked as Task #2)
