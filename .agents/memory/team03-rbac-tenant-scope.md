---
name: team03-rbac-tenant-scope
description: Tenant scoping pattern for aggregate read endpoints in the creative-commercial domain.
---

## Rule
Aggregate endpoints (attribution reports, funnel projections) that read across all customers MUST accept a `tenantId` query param and filter results to that tenant's customers when provided.

## Pattern
`sales_funnel_events` has `customer_id` (INTEGER) but no `tenant_id`. Filter via subquery:
```sql
AND customer_id IN (
  SELECT id FROM ai_platform.customer_profiles WHERE tenant_id = $tenantId
)
```
For service-request joins, join through `customer_profiles` on `client_email = customer_email`.

## Why
Audit rule: "Filter attribution/funnel data berdasarkan scope user/tenant/customer yang sah. Jangan izinkan query lintas tenant."
Since `adminAuth` is a single-key super-admin (no tenant extraction), scope must be passed explicitly.

## How to apply
- Aggregate service functions: accept `tenantId?: string | null` parameter.
- Routes: read `req.query.tenantId` (string or undefined); pass through to service.
- Omitting tenantId = platform-wide view (super-admin only — document in route comment).
- Per-customer endpoints (`:customerProfileId`) are already scoped — no additional filter needed.
