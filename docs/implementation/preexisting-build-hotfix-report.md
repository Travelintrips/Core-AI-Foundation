# Pre-existing Build Blocker Hotfix — `requireAdminApiKey` Import

Date: 2026-07-14

## Scope

This is a standalone hotfix, separate from WP-02/WP-03. It touches exactly one file
(`artifacts/api-server/src/routes/templates.ts`) to unblock the api-server build. It does
**not** touch tenant isolation, the repository foundation, quotation logic, audit logging,
soft delete, or any endpoint's business behavior.

## 1. Root Cause

`routes/templates.ts` imported a named export `requireAdminApiKey` from
`middleware/adminAuth.ts` that has **never existed** in that module — verified by
searching the full git history (`git log --all -S "requireAdminApiKey"`) for any commit
that ever defined, exported, or renamed such a symbol. No history hit exists. The very
first commit that added `templates.ts` already contained this broken import.

`middleware/adminAuth.ts` only ever exported two functions: `adminAuth` (the raw
session-or-API-key check) and `adminAuthWithExceptions` (the same check, with an
explicit allow-list of public customer-facing paths/routes). `requireAdminApiKey` is not a
renamed/moved version of either — it was simply never implemented. This was not "code that
went obsolete"; it was a broken import from day one that never surfaced because
`templates.ts` was never built/run in CI until now (it's a Phase 4.3 feature added after
the last known-good full build).

Confirming this is genuinely dead weight, not a missing capability: the api-server's actual
auth architecture (`app.ts`) already mounts `adminAuthWithExceptions` **globally** on the
whole `/api` router:

```ts
app.use("/api", adminAuthWithExceptions, router);
```

Every other router in the project (`marketplace.ts`, `catalog.ts`, `cp-review.ts`,
`aiQuotations.ts`, etc.) relies solely on this global gate and applies **no** per-route auth
middleware of its own. `templates.ts` was the only router attempting to layer a second,
route-level admin check on top of the already-global one, using a function that was never
implemented.

## 2. Audit of Related Symbols

Searched the whole project (`artifacts/api-server/src`) for:
- `requireAdminApiKey` — only ever referenced in `routes/templates.ts` (11 call sites,
  1 import). No definition anywhere.
- "admin api key middleware" / "admin auth middleware" concepts — the only real
  implementations are `adminAuth` and `adminAuthWithExceptions` in `middleware/adminAuth.ts`.
- No alias, wrapper, or re-export of either function exists under any other name.
- No other router file references `requireAdminApiKey` or any equivalent per-route admin
  middleware — confirming `templates.ts`'s per-route middleware call was the only place in
  the codebase attempting this pattern.

## 3. Canonical Implementation

The canonical, already-in-use mechanism for admin-gating `/api/*` routes is the single
global `adminAuthWithExceptions` middleware mounted once in `app.ts`. Routes do not need
(and, per the existing convention across every other router, do not use) their own
per-route admin middleware. None of the ten `templates.ts` admin routes
(`/api/ai/templates`, `/stats`, `/evolution`, `/industry-showcase`, `/:id`, `/:id/publish`,
`/:id/archive`, `/:id/event`) appear in `adminAuthWithExceptions`'s public exception lists
(`PUBLIC_PATH_PREFIXES` / `PUBLIC_ROUTE_RULES`), so they remain admin-key-protected exactly
as before — protection now comes from the pre-existing global gate alone, matching every
other admin router in the project.

## 4. Fix Applied

`artifacts/api-server/src/routes/templates.ts`:
- Removed the broken import: `import { requireAdminApiKey } from "../middleware/adminAuth.js";`
- Removed the `requireAdminApiKey` middleware argument from all 10 route registrations
  that used it (`stats`, `evolution`, `industry-showcase`, list, get-by-id, create, update,
  publish, archive, event).
- No other code in the file changed. The 6 public routes and 3 customer-workspace routes in
  this file were already unauthenticated by design and are untouched.

This is not "reverting to the old API to go green" — no old/legacy API was restored.
`requireAdminApiKey` never existed as a working implementation to revert to; the fix removes
a dead reference to a nonexistent function and relies on the canonical, already-proven
global middleware that every other admin route in the codebase already depends on.

## 5. Files Changed

- `artifacts/api-server/src/routes/templates.ts` (only file changed)

## 6. Build Result

`pnpm run build:api` — **succeeds** (was previously failing on this exact import).
Log: `/tmp/hotfix_build.log`.

## 7. Typecheck Result

`tsc -p artifacts/api-server/tsconfig.json --noEmit`: **96 errors** (down from the 97
pre-existing baseline). Diffed line-by-line against the prior baseline
(`/tmp/wp02_typecheck.log`): the only change is the removed `requireAdminApiKey` import
error; every other error is identical in file/code/message, shifted by exactly one line
(because one import line was removed). No new errors introduced. The remaining 96 errors
are the same pre-existing, unrelated issues documented in the WP-02 report (asset-library,
brand-kit-enterprise, brand-intelligence, template-service/matching, zip-delivery,
migrate-v43, seedTemplates, and a handful of `templates.ts`'s own pre-existing type issues
unrelated to this import, e.g. `TS7030`/`TS2339` on `SessionResult` — left untouched as
out of scope for this hotfix).

## 8. Startup Result

Restarted the `artifacts/api-server: API Server` workflow. It now builds and boots cleanly:
`Server listening` on port 8080, scheduler and dispatcher/cluster workers start up with no
errors, no import/module-resolution errors in the log.

## 9. Smoke Test Result

- `pnpm --filter @workspace/api-server run test`: **499/499 tests passed**, 23 files — no
  regressions.
- Live HTTP checks against the running server:
  - `GET /api/ai/templates` with no admin key → `401 Unauthorized` (correct — still
    protected, exactly as before the fix, just via the global gate instead of a broken
    per-route check).
  - `GET /api/ai/templates` with a wrong admin key → `401 Unauthorized` with the expected
    error body (`{"error":"Unauthorized: invalid or missing admin API key"}`).
  - `GET /api/ai/templates/stats` — same 401 gating confirmed.
- No import errors, no crash-on-boot, no route-registration errors anywhere in the startup
  log.

## Out of Scope (intentionally not touched)

Tenant isolation, repository foundation (WP-02), quotation logic, audit logging, soft
delete, and business behavior of any endpoint. This hotfix is a single-file, single-symbol
fix with no behavior change to any route's response codes or payloads.
