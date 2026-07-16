---
name: Team 19 — Packaging Design
description: Domain rules, invariants, and wiring for the packaging design feature (Team 19).
---

## Tables (in ai_platform schema)
- `packaging_design_orders` — main order record; UUID orderId for public tracking
- `packaging_design_variants` — per-order variant rows (sku, barcode, colorAccent, etc.)
- `packaging_design_validation_log` — append-only prepress validation history

## Service types (8)
box, pouch, bottle_label, jar_label, cup, sleeve, food_packaging, cosmetic_packaging

## REGULATED_SERVICE_TYPES (4)
bottle_label, jar_label, food_packaging, cosmetic_packaging
— require hasIngredientsBlock AND hasLegalBlock; validated at submit + prepress

## Critical invariant: print_ready guard
`status = "print_ready"` MUST NOT be set unless:
1. `prepressValidationJson` exists (validation has been run)
2. `prepressValidationJson.blockerCount === 0`
3. All active variants have `consistencyStatus === "consistent"`
Guard is enforced in `updateOrderStatus()` in packagingDesignService.ts — returns 409 on violation.

## Prepress validation checks (deterministic, no external calls)
bleed_check (≥3mm error), safe_area_check (≥3mm error), safe_area_layout_check,
barcode_type_check, barcode_variant_check, mandatory_info_check (regulated only),
variant_exists_check, color_mode_check (cmyk/pantone only), dimension_check (label/sleeve types),
panels_check (warning)

## Status flow
draft → submitted → in_review → design_in_progress → prepress_validation → print_ready → completed
Any state (except terminal) → cancelled; revision_requested ↔ design_in_progress

## Files
- Schema: lib/db/src/schema/packaging-design.ts (exported from schema/index.ts)
- DDL: integration/migrations/team-19.sql
- Service: artifacts/api-server/src/domains/packaging-design/packagingDesignService.ts
- Routes: artifacts/api-server/src/routes/packaging-design.ts (mounted via routes/index.ts)
- Customer UI: artifacts/customer-portal/src/pages/packaging-design/index.tsx
- Admin UI: artifacts/ai-platform/src/pages/packaging-design/index.tsx
- Tests: artifacts/api-server/src/__tests__/packaging-design.test.ts (44 tests)

## Routes
Admin (x-admin-api-key):  /api/ai/packaging-design/orders + /api/ai/packaging-design/variants/:vid
Public (no auth):         /api/public/packaging-design/submit + /api/public/packaging-design/orders/:orderId

## Express 5 params fix
req.params values are `string | string[]` — use `Array.isArray(raw) ? raw[0] : raw` pattern everywhere.

**Why:** intParam helper and direct orderId extraction both needed this; TypeScript TS2345 otherwise.
