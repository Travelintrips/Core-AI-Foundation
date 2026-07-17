---
name: Team 18 Fashion Design
description: Fashion & Apparel Design domain — tables, routes, service, pages, integration files, safety rules
---

# Team 18 — Fashion & Apparel Design

## Tables
- `ai_platform.fashion_design_orders` — order per customer, status flow: draft→blueprint_ready→generating→review→approved→delivered (also trademark_flagged, cancelled)
- `ai_platform.fashion_design_blueprints` — one per order (UNIQUE order_id), panel-by-panel spec

## Key files
- DB schema: `lib/db/src/schema/fashion-design.ts` (exported from schema/index.ts)
- Service: `artifacts/api-server/src/services/fashionDesignService.ts`
- Routes: `artifacts/api-server/src/routes/fashion-design.ts`
- Customer portal: `artifacts/customer-portal/src/pages/fashion-design/index.tsx`
- Admin panel: `artifacts/ai-platform/src/pages/fashion-design/index.tsx`
- Migration: `integration/migrations/team-18.sql` — already applied to dev DB
- OpenAPI: `integration/openapi/team-18.yaml`
- Manifest: `integration/manifests/team-18.json`
- Tests: `artifacts/api-server/src/domains/fashion-design/fashionDesign.test.ts` (28 tests)

## Safety rules enforced
- Panel constraints: per-panel min/max width & height validated on blueprint save
- Jersey number: must be numeric 0–99
- Motif repeat scale: 0–10
- Trademark blocklist: 50+ brand/club names blocked; flagged orders cannot be approved/delivered
- Production pattern guard: outputs are structural only, not manufacturing-ready

## Public route
`GET /api/ai/fashion-design/services` — added to PUBLIC_ROUTE_RULES in adminAuth.ts

## Integration notes
- Migration already applied to dev Supabase DB
- Prod DB (SUPABASE_PROD_DATABASE_URL) still needs migration applied via `psql "$SUPABASE_PROD_DATABASE_URL" -f integration/migrations/team-18.sql`
- AI image generation (flat-design, front-back-preview) returns null pending real pipeline connection
