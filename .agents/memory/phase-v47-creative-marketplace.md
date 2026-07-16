---
name: Phase V4.7 Creative Marketplace
description: Rules and gotchas for the V4.7 creative asset marketplace implementation
---

## Key facts

- Route prefix: `/ai/creative-marketplace/*` (admin), `/public/creative-marketplace/*` (public), `/public/customer/workspace/:token/creative-marketplace/*` (workspace)
- Public paths bypass adminAuth via the existing `/public` prefix in PUBLIC_PATH_PREFIXES — no manual exceptions needed
- DB tables: `marketplace_creators`, `marketplace_assets`, `marketplace_favorites`, `marketplace_ratings`, `marketplace_downloads` (all in `ai_platform` schema)
- Migration: `src/migrate-v47.ts` — already run against dev DB
- Workspace session resolved via `resolveWorkspaceSession(token)` from customerWorkspaceService; use `session.clientEmail` (not `customerEmail`)
- Service file: `src/services/creativeMarketplaceService.ts`
- Route file: `src/routes/creative-marketplace.ts`

## OpenAPI naming

- All V4.7 schemas prefixed `Creative` to avoid collision with existing skills marketplace (`/ai/marketplace/*`) which owns `MarketplaceAnalytics` etc.
- Schema names: `CreativeMarketplaceAsset`, `CreativeMarketplaceCreator`, `CreativeMarketplaceAnalytics`, etc.
- operationId for analytics: `getCreativeMarketplaceAnalytics`

**Why:** The existing skills marketplace (Phase 8) uses generic `Marketplace*` names in OpenAPI; reusing them causes orval `already exported a member` collision. Always use `Creative` prefix for V4.7 schemas.

## Frontend

- Admin page: `artifacts/ai-platform/src/pages/creative-marketplace.tsx` at route `/creative-marketplace`
- Admin sidebar: "Creative" section in `layout.tsx`, uses `Store` icon (already imported)
- Customer portal page: `artifacts/customer-portal/src/pages/asset-marketplace.tsx` at route `/marketplace`
- Customer portal uses public API (no auth headers) — workspace favorites/downloads need the `/workspace/:token/` routes
