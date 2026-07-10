---
name: service-catalog-quotation-flow
description: ai_quotations table, service-catalog vs legacy commercial gate flow, nullable quotationId, customer portal funnel pages
---

## Tables
- `ai_platform.ai_quotations` — new quotation table for service-catalog flow (vs legacy `creative_project_quotations`). Status machine: draft→issued→viewed→approved/rejected/revision_requested. `review_token_hash` stores SHA-256, plaintext returned once at issue.
- `ai_platform.ai_quotation_items` — normalized line items (not JSONB).
- DDL saved at `artifacts/api-server/src/scripts/ddl-quotations.sql` and already run.

## Schema changes on existing tables
- `ai_commercial_gates.quotation_id` — made NULLABLE (was NOT NULL). Old code calling `checkAndMaybeConvert(gate.quotationId)` must null-guard first.
- `ai_commercial_gates.service_quotation_id` — new FK to `ai_quotations.id` for service-catalog gates.
- `creative_projects.source_type` — new col, default `'direct'`; also `service_request_id` and `service_quotation_id`.

## Two separate flows
- **Legacy flow** (`creative_project_quotations`): `checkAndMaybeConvert(quotationId)` — gate has `quotationId` set, `serviceQuotationId` null.
- **Service-catalog flow** (`ai_quotations`): `checkAndMaybeConvertByServiceQuotation(serviceQuotationId)` — gate has `serviceQuotationId` set, `quotationId` null.
Both trigger `convertServiceRequestToProject()` which is idempotent.

## Routes
- Admin: `GET/POST /api/ai/quotations`, `PUT /api/ai/quotations/:id/items`, `POST /api/ai/quotations/:id/issue`
- Public (no admin auth, uses /public prefix): `GET /api/public/quotations/:token`, `POST /api/public/quotations/:token/approve|request-change|reject`
- Public catalog: `GET /api/public/catalog/requests/:requestId` (customer-safe fields only), `PUT /api/public/catalog/requests/:requestId/brief` (sets `brief_completed` status)

## Customer portal pages
- `/request-service/:requestId/brief` — 7-step wizard, localStorage autosave, `PUT /brief` on submit, then redirect to `/pricing`
- `/request-service/:requestId/pricing` — shows estimated price from service request
- `/request-service/:requestId/quotation?token=<reviewToken>` — approve/request-change/reject on `ai_quotations`
- `/request-service/:requestId/approval` — post-approval commercial gate status

## Admin funnel page
- `/service-requests` in ai-platform — groups all `ai_service_requests` by status stage, collapsible lanes, auto-refreshes every 30s.

## Key rule: nullable quotationId guard
Any code in `commercialGates.ts` that calls `checkAndMaybeConvert(gate.quotationId)` must null-check first because `quotationId` is now nullable.

**Why:** Making `quotationId` nullable was needed to support the service-catalog flow where a gate is linked to `serviceQuotationId` instead.
