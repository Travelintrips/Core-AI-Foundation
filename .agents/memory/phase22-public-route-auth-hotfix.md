---
name: Phase 2.2 — public customer route auth hotfix
description: Which customer-facing endpoints were wrongly gated behind ADMIN_API_KEY, and the method-aware exemption pattern used to fix it without widening admin exposure.
---

## Symptom
Customer portal calls to service detail, quote calculator, create-request,
portfolio showcase, and live AI preview endpoints returned 401
"Unauthorized: invalid or missing admin API key" whenever `ADMIN_API_KEY` was
set, because `adminAuthWithExceptions` (artifacts/api-server/src/middleware/adminAuth.ts)
only exempted whole path prefixes (`/public`, `/ai/catalog/public`, health,
etc.), and these customer routes live on the *same* mount points as their
admin siblings:
- `GET /ai/catalog/services/:id`, `POST .../quote`, `POST .../request` share
  `/ai/catalog/services` with admin-only list/create/update/delete.
- `GET /ai/portfolio/services/:id/showcase`, `POST /ai/portfolio/preview*`,
  `POST /ai/portfolio/portfolios/:id/view` share `/ai/portfolio` with
  portfolio/review/FAQ management (admin-only).

## Fix pattern
Added a second, **method + exact-regex** exemption table (`PUBLIC_ROUTE_RULES`)
checked after the existing prefix table, instead of widening any prefix.
Each rule pins both HTTP method and an anchored regex (e.g.
`^/ai\/catalog\/services\/\d+$` for GET only) so sibling admin routes on the
same mount (PATCH/DELETE/list/create) stay behind the admin key.

**Why:** a prefix or substring exemption (`req.path.startsWith("/ai/catalog/services")`)
would have also exposed admin create/update/delete on the same path family —
exactly the anti-pattern to avoid per security review.

**How to apply:** when a new customer-facing endpoint is added under an
admin-protected mount, add one explicit `{method, pattern}` rule to
`PUBLIC_ROUTE_RULES` — never touch `PUBLIC_PATH_PREFIXES` for anything that
has an admin-only sibling on the same path. Regression coverage lives in
`artifacts/api-server/src/middleware/__tests__/adminAuth.test.ts`.
