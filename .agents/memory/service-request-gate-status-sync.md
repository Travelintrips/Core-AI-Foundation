---
name: Service request status vs. commercial gate desync
description: Root cause and fix pattern for backend service-request status racing ahead of an unverified commercial gate, causing customer portal and admin to disagree.
---

## Symptom
Admin funnel (service-requests.tsx STAGES) shows a request far along (e.g.
`waiting_review`), but the customer-facing portal still shows "Verifikasi
Komersial: pending" — the two surfaces look inconsistent.

## Root cause
`PATCH /ai/catalog/requests/:id/status` (artifacts/api-server/src/routes/catalog.ts)
accepted any status value unconditionally and just wrote it — nothing stopped
a caller (e.g. admin NEXT_ACTIONS buttons, or a test script) from jumping the
request straight from `waiting_commercial_gate` to `ready_to_build` /
`in_progress` / `waiting_review` while the linked `ai_commercial_gates` row
was still `pending`. Separately, the customer portal's public quotation
endpoint (`GET /public/quotations/:token`) never returned the real service
request status or gate status at all — the frontend stepper inferred
everything from `quotation.status === "approved"`, so it couldn't reflect
either the stuck gate or the fact production had (invalidly) proceeded.

**Why this matters:** the two systems were disagreeing for *different*
reasons — the backend status column was wrong (skipped a gate check), and the
frontend was blind to the real status (hardcoded inference) — so fixing only
one side would leave the other misleading.

## Fix pattern
- Guard the generic status-transition endpoint: for any status that comes
  after `waiting_commercial_gate` in the pipeline, look up the request's
  quotation → commercial gate, and reject (409) unless `gateIsCleared()`
  (verified/waived). Also guard `completed`/`converted_to_project` behind an
  actual linked `creativeProjectsTable` row with `status === "completed"`.
- Have the public/customer-facing read endpoints return the *real* backend
  fields (service request status, gate status) instead of letting the
  frontend infer stage from a single approved/not-approved boolean.

## How to apply
Anytime a new terminal/intermediate status is added to the service-request
pipeline, re-check both: (1) whether the generic PATCH status endpoint needs
a new guard clause for it, and (2) whether customer-facing stepper components
consume real status fields rather than re-deriving with their own hardcoded
mapping.
