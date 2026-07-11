---
name: service-request-status vocabulary and "completed" guard
description: Canonical ai_service_requests.status values and why "completed" must be guarded server-side, not just set by an admin button.
---

The real status vocabulary for `aiServiceRequestsTable.status` (service-catalog flow) is much larger than the DB column comment suggests: `draft, brief_in_progress, brief_completed, quoted, quotation_ready, waiting_customer_approval, approved, waiting_commercial_gate, ready_to_build, in_progress, orchestrating, waiting_review, completed, converted_to_project, revision_requested, rejected, expired, cancelled`. The authoritative list lives in the admin `NEXT_ACTIONS` map (artifacts/ai-platform/src/pages/service-requests.tsx) and the dashboard `statusLabel` map (artifacts/api-server/src/routes/customer-portal.ts) — check both before trusting a schema column comment.

Any customer-facing page that renders `request.status` (e.g. request-pricing.tsx) must keep its label map in sync with this full list, or unmapped statuses fall back to the raw backend string with a mismatched default description.

**Why:** The admin UI let staff manually click through `NEXT_ACTIONS` (including straight to "completed") with no server-side check that a quotation was ever approved or a project ever produced anything. This let a request reach `status: "completed"` with zero quotation, zero project, and zero deliverables — customers saw "Selesai" with nothing to show for it.

**How to apply:** `PATCH /ai/catalog/requests/:id/status` now rejects a transition to `"completed"` unless the request has a `createdProjectId` AND the linked `creativeProjectsTable` row itself has `status === "completed"`. Keep this guard if the status machine changes — "completed" must always mean real production finished, not just an admin click.
