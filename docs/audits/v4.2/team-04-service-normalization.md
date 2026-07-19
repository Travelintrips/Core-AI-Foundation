# Team 04 — Service Normalization Audit (V4.2E)

## Canonical Service Identity

| Field | DB column | Role |
|---|---|---|
| `id` | `ai_services.id` | **Numeric primary key** — database-authoritative. Use for `/services/:id` route navigation. Never fabricated or derived. |
| `service_code` | `ai_services.service_code` | **Machine-stable business code** — preferred for external references and goal mappings. Never used as identity for DB rows. |
| `service_name` | `ai_services.service_name` | **Mutable display label** — may be renamed without breaking any FK. Never used as identity. |
| slug | `ai_services.slug` (if present) | Route-friendly public identifier. Not the numeric PK. |

Rule: `serviceName` is NOT identity. It may change. Systems must key on `serviceId` or `serviceCode`.

## Goal Service Contract (Phase 6 fix)

`GET /api/ai/goals/:slug/services` returns:

```json
{
  "goal": { "slug": "...", "name": "...", ... },
  "services": [
    {
      "serviceId": 42,
      "serviceCode": "branding_logo_standard",
      "serviceName": "Branding & Logo",
      "shortDescription": "...",
      "startingPrice": "5000000",
      "currency": "IDR",
      "estimatedDelivery": "7-10 business days",
      "relevanceScore": 90,
      "isPrimary": true,
      "displayOrder": 0
    }
  ]
}
```

`serviceId` is now included. Team 03 must use `serviceId` (numeric) for `/services/:id` navigation.
`serviceCode` remains the stable machine identifier for business logic.

## Commercial Policy Integration (Phase 8)

Team 04 does NOT duplicate Team 01's `commercialEligibilityPolicy.ts` rules.

The `listServicesForGoal` SQL and `listEligibleServicesForCollection` repository function
both enforce all four Team 01 eligibility conditions:

| Condition | SQL column |
|---|---|
| Service active | `s.status = 'active'` |
| Category public | `c.visibility = 'public'` |
| Category commercial ready | `c.commercial_status = 'commercial_ready'` |
| Category active | `c.status = 'active'` |

Services that fail any condition are excluded from public responses.

## Files Changed

| File | Reason |
|---|---|
| `artifacts/api-server/src/goals/types.ts` | Added `serviceId: number` to `GoalServiceStub` |
| `artifacts/api-server/src/goals/goalRepository.ts` | Fixed `listServicesForGoal` SQL to select `s.id`, join categories, apply full commercial eligibility |
| `lib/db/src/schema/ai-service-normalization.ts` | New: 5-table normalization schema (canonical concepts, mappings, aliases, collections, members) |
| `lib/db/src/schema/index.ts` | Added export for `ai-service-normalization` |
| `artifacts/api-server/src/repositories/serviceNormalizationRepository.ts` | New: all DB access for normalization tables |
| `artifacts/api-server/src/services/serviceNormalizationService.ts` | New: business rules, domain errors, validation |
| `artifacts/api-server/src/routes/service-normalization.ts` | New: 15 admin + 2 public routes |
| `artifacts/api-server/src/routes/index.ts` | Mounted serviceNormalizationRouter |
| `artifacts/api-server/src/middleware/adminAuth.ts` | Added `/ai/solution-collections` to PUBLIC_PATH_PREFIXES |
| `artifacts/api-server/src/migrations/20260719_service_normalization.sql` | Additive, idempotent, repeat-safe DDL |
| `artifacts/api-server/src/repositories/__tests__/serviceNormalization.test.ts` | 28 test cases covering all Phase 13 requirements |
| `docs/audits/v4.2/team-04-service-normalization.md` | This document |

## Migration Safety

- All `CREATE TABLE IF NOT EXISTS` — idempotent, repeat-safe
- Purely additive — zero existing tables modified or dropped
- No destructive backfills, no hardcoded production IDs
- ON DELETE RESTRICT throughout (no cascade)
- Wrapped in a single transaction
- Ordering: must run after core schema, Team 01, and Team 02 migrations

## Security

- No auth weakening — write routes remain under ADMIN_API_KEY
- No client-authoritative pricing — all pricing from DB columns only
- No internal-only service leakage — `commercial_status='commercial_ready'` + `visibility='public'` guard
- No fake IDs — serviceId always comes from `ai_services.id` via JOIN
- No secrets in source

## Contract Note for Team 03

Use `serviceId` (numeric) from `GET /api/ai/goals/:slug/services` for navigation to `/services/:id`.
`serviceCode` remains available as the stable business identifier.
