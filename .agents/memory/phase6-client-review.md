---
name: Phase 6 Client Review Portal
description: Key implementation decisions, bugs fixed, and patterns for the client review / approval flow
---

# Phase 6 — Client Review Portal

## What was built
- `creative_ai_client_reviews` table: token hash, expiry, status lifecycle (not_shared → shared → viewed → approved/rejected/revision_requested; or expired/revoked)
- `creative_ai_client_comments` table: per-review comments with asset/step targeting
- Admin routes: create link, list reviews, revoke, list comments, analytics (in `routes/client-review.ts`)
- Public routes: GET review, POST comment/approve/reject/request-revision (in `routes/public.ts`)
- Frontend: public client review page at `/review/creative/:token` (no admin auth); `ClientReviewSection` embedded in creative-ai.tsx ProjectDetail

## Critical rule: never import zod in api-server routes
esbuild bundles api-server but `zod` is NOT a direct dep of `@workspace/api-server`. Importing `zod` or `zod/v4` directly causes build failures. Use manual validation (typeof checks, length bounds) or schemas from `@workspace/api-zod` only.

## State machine — terminal status guard
All public action endpoints (approve/reject/request-revision) must:
1. Check `TERMINAL_STATUSES.has(review.status)` → return 409 if already terminal
2. Use `AND status NOT IN (...)` in the DB UPDATE WHERE clause as a double-guard

**Why:** Without these guards, a client can flip decisions repeatedly and trigger duplicate notifications.

## GET-view downgrade protection
The `GET /public/creative-review/:token` route updates status from `shared` → `viewed` ONLY when `review.status === "shared"`. Never overwrite terminal statuses on first view.

```ts
const isFirstView = review.status === "shared" && !review.viewedAt;
```

**Why:** If the client views the link after approving (e.g. from browser history), the GET must not reset the status back to `viewed`.

## Public auth bypass
`/public` prefix is listed in `PUBLIC_PATH_PREFIXES` in `adminAuth.ts`. This exempts ALL future `/api/public/*` routes from admin key auth — use with care.

## Token URL on frontend
```ts
const publicBase = `${window.location.origin}${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/review/creative/`;
```
The token is plaintext only in the creation response (`ClientReviewWithToken.token`). After that, the hash is stored; the plaintext is gone.

## Wouter routing — public page outside admin Layout
In App.tsx, the public review page route is declared FIRST in a top-level `<Switch>` before the catch-all admin `<Route>`:
```tsx
<Switch>
  <Route path="/review/creative/:token" component={ClientReviewPage} />
  <Route component={AdminRouter} />  {/* wraps Layout + all admin routes */}
</Switch>
```
