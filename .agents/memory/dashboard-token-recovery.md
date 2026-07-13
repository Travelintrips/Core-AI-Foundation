---
name: dashboard-token-recovery
description: Customer dashboardToken is hashed and non-recoverable — pages referencing "your dashboard" need a live re-issue action, not a stored link
---

The customer portal's dashboard access token (`customer_dashboard_tokens`) is stored only as a hash; the plaintext is returned once (at project submission) and can never be looked up again from a requestId or email alone.

**Why:** by design, for security — same pattern as review/quotation tokens elsewhere in this app.

**How to apply:** any page that tells a customer to "check your dashboard" (e.g. request-pricing/results "done" stage) cannot construct that link from request data. Use `POST /api/public/customer/request-access` with the customer's email — it issues a fresh token and returns `dashboardUrl` directly in the JSON response (no email round-trip needed), so a button can redirect immediately. See `DashboardAccessButton` in `artifacts/customer-portal/src/components/commercial/`.
