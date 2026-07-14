---
name: V4.2E Creative Asset Intelligence
description: Brand DNA Engine, Asset Intelligence, Creative Director — DB tables, services, routes, UI pages, tests, OpenAPI schemas, codegen
---

## What was built
- **DB tables**: `ai_brand_dna`, `ai_asset_intelligence` — hand-written DDL via `migrate-v42e.ts`; `pnpm migrate:v42e` applied to Supabase dev DB (2026-07-14)
- **Services**: `creativeBrandIntelligenceService.ts` + `assetIntelligenceService.ts` — rule-based, no external AI calls
- **Routes**: `brand-intelligence.ts` + `asset-intelligence.ts` under `/ai/brand-intelligence/*` (admin) and `/public/customer/workspace/:token/brand-intelligence/*` (public)
- **OpenAPI schemas**: all new schemas inserted before `# ── End V4.2D schemas` marker (BrandDnaView, BrandRecommendationList, BrandConsistencyReport, CreativeMemoryView, CreativeDirectorRecommendation, AdminBrandIntelligenceStats, WorkspaceBrandIntelligenceDashboard, AssetIntelligenceView, AssetIntelligenceList, DuplicateReport, WorkspaceAssetIntelligenceDashboard, AnalyzeBrandInput, AnalyzeAssetInput, plus sub-schemas)
- **Codegen**: ran `pnpm run build:generated` — all passing
- **Admin UI**: `artifacts/ai-platform/src/pages/creative-intelligence.tsx` — uses local `apiFetch` with `VITE_ADMIN_API_KEY` (same pattern as all other admin pages; no `useAdminApi` hook exists)
- **Customer portal UI**: `artifacts/customer-portal/src/pages/workspace/brand-intelligence.tsx` — uses `customFetch` + `/api/public/customer/workspace/:token/` base (same pattern as use-workspace.ts)
- **Routes wired**: customer-portal App.tsx `/workspace/:token/brand-intelligence`, admin App.tsx `/creative-intelligence`
- **Nav**: workspace-layout.tsx sidebar (Brain icon), admin layout.tsx sidebar
- **Tests**: 21 unit tests in `creativeBrandIntelligenceService.test.ts` — all 424 tests pass

## Key rules
- Admin pages: use local `apiFetch` with `import.meta.env.VITE_ADMIN_API_KEY` — NO shared `useAdminApi` hook
- Customer portal API base: `const base = (token) => \`/api/public/customer/workspace/\${token}\`` — NO `getApiUrl` / `lib/api`
- `WorkspaceLayout` takes `{ token, children }` only — no `activeSection` prop
- New DB tables: always hand-write DDL + `migrate:vXX` script; never use drizzle-kit push
