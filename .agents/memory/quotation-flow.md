---
name: Quotation (penawaran) flow
description: How the price-quotation gate works between project submission and AI generation start
---

Added a "penawaran" (price quotation) commercial-approval layer between client brief submission and
AI generation: staff draft/send a quotation (line items, discount, tax, total) from the AI Platform
admin UI; the client approves/rejects it from the customer portal using the *same* review token
already issued at submission (no new token system introduced).

**Why:** investigation showed customer-portal-submitted projects were never actually started —
`runCreativeBriefWorkflow` was only invoked from the admin-created `/creative-ai/brief` route, never
from the public submission path. Tying workflow start to quotation approval gives that dangling
"pending forever" project a real, intentional trigger instead of leaving it broken.

**How to apply:** any public token-gated status transition (approve/reject/etc.) that can be called
concurrently must use an atomic compare-and-set `UPDATE ... WHERE status = 'sent'` (check `saved`
returned, not a prior `SELECT`) — a read-then-write pattern lets concurrent requests double-trigger
side effects (e.g. starting the AI workflow twice). See `artifacts/api-server/src/routes/quotations.ts`.
