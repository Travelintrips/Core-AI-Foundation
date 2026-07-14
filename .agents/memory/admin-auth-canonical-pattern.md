---
name: Admin auth canonical pattern
description: How admin-key protection actually works across api-server routes — a single global gate, not per-route middleware.
---

`app.ts` mounts `adminAuthWithExceptions` (from `middleware/adminAuth.ts`) **once**, globally, on the whole `/api` router: `app.use("/api", adminAuthWithExceptions, router)`. Every router (`marketplace.ts`, `catalog.ts`, `cp-review.ts`, `aiQuotations.ts`, etc.) relies solely on this global gate — none of them apply their own per-route admin middleware. Public/customer-facing exceptions are carved out centrally in `adminAuth.ts`'s `PUBLIC_PATH_PREFIXES` / `PUBLIC_ROUTE_RULES`, not per-router.

**Why:** `routes/templates.ts` once imported a `requireAdminApiKey` function that never existed anywhere in the codebase (confirmed via full git history search — it was broken from the first commit that added the file, not a rename/removal). This broke `build:api` until removed. It was dead weight: the routes were already protected by the global gate.

**How to apply:** if you add a new admin route file, do NOT add your own per-route auth middleware — it isn't the convention and risks reintroducing a similarly broken/inconsistent pattern. Only touch `PUBLIC_PATH_PREFIXES`/`PUBLIC_ROUTE_RULES` in `adminAuth.ts` if a route needs a public exception to the global gate.
