---
name: service-catalog-commercial-flow
description: Status lifecycle rules, conversion service dual-path, and admin/OpenAPI enum patterns for the service-catalog commercial flow
---

## Status lifecycle (ServiceRequestStatus enum in OpenAPI)

draft → brief_in_progress → brief_completed → pricing_calculated → quotation_ready → waiting_customer_approval → approved → waiting_commercial_gate → converted_to_project / rejected / expired / cancelled

**Key rules:**
- Request is created with `status: "draft"` (NOT "quoted")
- `start-brief` PATCH endpoint advances `draft → brief_in_progress`; idempotent — non-draft non-terminal returns current status
- `issueQuotation` sets service_request to `quotation_ready` (NOT waiting_customer_approval)
- `markViewed` advances quotation `issued → viewed` AND (CAS-gated) service_request `quotation_ready → waiting_customer_approval`
- `rejectByToken` sets service_request to `rejected` (NOT cancelled)

**Why:** Separating "quotation_ready" (admin-side) from "waiting_customer_approval" (after customer first opens the link) gives admins a clear indicator of whether the customer has seen the offer.

## Conversion service dual path (convertServiceRequestToProject)

Two branches based on `gate.quotationId` vs `gate.serviceQuotationId`:
- Legacy: `gate.quotationId` → load `creativeProjectQuotationsTable`, find existing `creative_projects` row
- Service-catalog: `gate.serviceQuotationId` → load `aiQuotationsTable`, find or CREATE `creative_projects` row

**How to apply:** When service-catalog gate fires, `creative_projects` row doesn't exist yet — the conversion service creates it from `request.briefJson`. Fields: `sourceType:"service_catalog"`, `serviceRequestId`, `serviceQuotationId`, `brandName=companyName||customerName`, `businessType=briefJson.companyIndustry`, `targetMarket=briefJson.audienceDemographics`, `goal=briefJson.primaryGoal`.

**Why:** Legacy flow creates creative_project at project-creation time; catalog flow creates it at conversion time from brief data.

## OpenAPI enum pattern for status fields

When a `type: string` status field is used in both GET and PATCH schemas, replace with `$ref: '#/components/schemas/ServiceRequestStatus'`. Admin frontend must cast `Select.onValueChange` result with `v as ServiceRequestStatus` (not a plain string). REQUEST_STATUSES array in catalog-admin must use the full enum set — legacy statuses like "reviewing", "accepted" cause data integrity issues.

## Funnel analytics cohort rules

- `averageQuotationValue` counts only requests at `quotation_ready` or later (not all requests — draft totals are $0)
- `funnelCounts.newRequests` includes legacy `"quoted"` status for backward compat with old records
- `averageTimeToApprovalDays` uses `updatedAt` as proxy for approval timestamp (approximate but acceptable)
