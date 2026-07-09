---
name: Customer Portal
description: Customer-facing Creative AI Studio portal at /studio/ — architecture, token handling, dashboard navigation fix
---

## Token handling in customer portal routes

**Rule:** When creating customer-submitted reviews, always set `reviewTokenPlain` in `creative_ai_client_reviews` at insert time — this is the only way the dashboard endpoint can surface a usable review link back to the customer. The hash is used for validation; the plain is used for dashboard navigation.

**Why:** SHA-256 hashes stored in `review_token_hash` are one-way. Without `review_token_plain`, `GET /public/customer/dashboard/:token` can only return empty `reviewToken`/`reviewUrl` fields, breaking dashboard project card navigation.

**How to apply:** In `customer-portal.ts` submit route, include `reviewTokenPlain: reviewToken` in the `creativeAiClientReviewsTable` insert. Admin-created review flows leave `reviewTokenPlain` null.

## Dashboard token flow

`POST /public/customer/request-access` always issues a fresh token (deletes+replaces existing hash in `customer_dashboard_tokens` for that email hash). The plaintext token is returned directly — no email delivery in this environment. This is intentional and documented.

## URL construction

`buildBaseUrl()` in `customer-portal.ts` checks `REPLIT_DEV_DOMAIN` env var first; falls back to `x-forwarded-host` headers. This ensures URLs in API responses point to the real Replit proxy domain, not `localhost:8080`.

## Route mounting

Customer portal routes are in `artifacts/api-server/src/routes/customer-portal.ts`, mounted in `routes/index.ts`. Routes use `/public/customer/*` prefix which is in `PUBLIC_PATH_PREFIXES` in `adminAuth.ts` — no admin key needed.
