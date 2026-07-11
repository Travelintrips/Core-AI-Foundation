---
name: Phase 2.5 Commercial Layer
description: Sprint P2.5 rules — Sales Funnel, Promotions, Coupons, Referrals, Affiliates, Health Scores, A/B Tests
---

## Tables (all in ai_platform schema)
- `ai_sales_funnel_events`, `ai_promotions`, `ai_coupons`, `ai_coupon_usages`
- `ai_referrals`, `ai_affiliates`, `ai_affiliate_clicks`, `ai_affiliate_conversions`
- `ai_customer_health_scores`, `ai_ab_tests`, `ai_ab_variants`
- DDL: `scripts/migrations/p25-commercial-layer.sql`

## Commercial Analytics column rules
- `ai_invoices` uses `amount` (not `total_amount`) for revenue queries
- `creative_projects` has no `client_email` — use `brand_name` as repeat-customer proxy
- `ai_service_requests` has `total` column for order value

## Health Score service
- `calculateHealthScore(customerProfileId)` uses `onConflictDoUpdate` with target `customerProfileId`
- Scoring: payment 30%, activity 20%, repeat order 25%, review 15%, response time 10%
- `db.execute` results: always cast via `(result as { rows?: T[] }).rows ?? []`

## salesManagerService
- `aiServicesTable` uses `serviceName` (not `name`) — must use `svc.serviceName` everywhere
- Insights: use `brand_name` from creative_projects for repeat-order detection

## Route mounting
- All 7 new routers registered in `artifacts/api-server/src/routes/index.ts`
- Paths: /ai/funnel/*, /ai/promotions/*, /ai/coupons/*, /ai/referrals/*, /ai/affiliates/*, /ai/customer-health/*, /ai/commercial-analytics, /ai/ab-tests/*

## Frontend pages (ai-platform admin)
- `/commercial` → commercial.tsx (KPIs + funnel + insights)
- `/promotions` → promotions.tsx (CRUD)
- `/coupons` → coupons.tsx (CRUD + activate/pause)
- `/affiliates` → affiliates.tsx (CRUD + stats)
- `/referrals` → referrals.tsx (generate + convert)
- `/health-scores` → health-scores.tsx (list + recalculate)
- All use direct `fetch` with `apiHeaders(): HeadersInit` — NOT the generated orval hooks

**Why:** Generated hooks aren't needed since these pages manage their own fetch patterns and TypeScript complains about the `{}` return type of the headers helper unless typed as `HeadersInit`.

## OpenAPI
- 269 operations after Sprint P2.5 additions
- New tags: SalesFunnel, Promotions, Coupons, Referrals, Affiliates, CustomerHealth, CommercialAnalytics, AbTests
