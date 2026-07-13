---
name: Commercial status badge coverage
description: getCommercialStatusMeta in the customer portal must cover every raw status string across quotation/service-request/payment tables, not just the ones seen in one flow
---

## Status map must be built from all source tables, not one flow's type definitions

**Rule:** The canonical commercial-status label map (`getCommercialStatusMeta` /
`CommercialStatusBadge` in `artifacts/customer-portal/src/components/commercial/`)
must include every literal status string actually stored in
`ai_quotations.status` (`draft`/`issued`/`viewed`/`approved`/`rejected`/…),
`ai_service_requests.status`, and payment-schedule/invoice statuses — not just
the narrower status union declared in one hook's TypeScript type (e.g.
`use-customer.ts`'s `PublicQuotation.status: sent|approved|rejected|expired`
does not match the DB's actual `issued`/`viewed` values used elsewhere).

**Why:** Trusting one hook's TS type as the source of truth left `issued`
mis-mapped to "Awaiting Payment" (should be "Awaiting Approval") and `viewed`
completely unmapped (silently fell back to an unstyled raw-string badge) —
only caught by generating live test data and screenshotting the actual page,
not by reading the type definitions.

**How to apply:** Before wiring a shared status-badge component into a page,
grep the DB schema/enum and the route handlers that set `.status = "..."`
for every literal string that can reach that column, and cross-check the
label map covers all of them — don't rely on one consumer's narrowed type.

## Getting a plaintext review token for manual/screenshot testing

Quotation/review tokens are stored only as SHA-256 hashes
(`review_token_hash`) — the plaintext is returned exactly once, in the
`POST /api/ai/quotations/:id/issue` (or equivalent `.../send`) response body,
and is otherwise unrecoverable from the DB. To manually test or screenshot a
token-gated customer page, create a fresh draft quotation for an existing
service request via the admin API, add items, call the issue endpoint, and
use the `reviewToken` from that response — don't try to query the DB for an
existing token.
