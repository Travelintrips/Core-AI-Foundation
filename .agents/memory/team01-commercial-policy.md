---
name: Team 01 Commercial Policy (V4.2B)
description: CommercialEligibilityPolicy implementation — canonical eligibility guard for public catalog and ordering
---

# Rule
All public-facing catalog routes must use `CommercialEligibilityPolicy` from
`artifacts/api-server/src/policy/commercialEligibilityPolicy.ts`.
Never write inline `visibility === "public"` checks in route files.

**Eligible category**: `visibility='public'` AND `commercial_status='commercial_ready'` AND `status='active'`
**Eligible service**: service `status='active'` + its category passes the above
**Eligible package**: `status='active'`

# Why
V4.2A bug: `GET /ai/catalog/public` only filtered by `visibility='public'`, leaking
18 categories with `commercial_status='internal_only'`. The old
`assertServiceIsPubliclyRequestable` had the same gap — it only checked visibility,
not commercial_status or status.

# How to apply
- New public catalog or service endpoints: import and call `isServiceCommerciallyEligible` /
  `isCategoryCommerciallyEligible` from the policy module. Never re-derive the rules inline.
- The policy file is pure (no DB, no Express). The DB join + policy call pattern is in
  `assertServiceIsCommerciallyEligible` inside `catalog.ts` — follow that pattern.
- Tests live at `src/policy/__tests__/commercialEligibilityPolicy.test.ts` (30 tests, all pure).
