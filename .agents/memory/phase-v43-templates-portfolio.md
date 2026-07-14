---
name: V4.3 Template Marketplace & Portfolio Gallery
description: Rules and gotchas from finishing the V4.3 template marketplace + portfolio gallery wiring (backend routes, OpenAPI, migrations, and the "use template" conversion flow).
---

## Express 5 route params typed as `string | string[]` when a middleware array is used
When a route handler is registered as `router.get(path, someMiddleware, handler)` and the path has a
`:param`, TS sometimes widens `req.params.<name>` to `string | string[]` (Express 5's `ParamsDictionary`
allows both) instead of narrowing to the literal `{ id: string }` inferred from the path template.
This only shows up on routes that pass an extra handler before the final one — plain
`router.get("/x/:id", handler)` infers correctly.

**Why:** `@types/express-serve-static-core` v5's `ParamsDictionary` is `{ [key: string]: string | string[] }`.
Passing a generic (non-route-typed) middleware in the handler chain makes TS fall back to that wider type
instead of the path-literal-inferred one.

**How to apply:** Cast at the call site — `parseInt(req.params.id as string, 10)` — rather than changing the
middleware's type. Don't try to "fix" the middleware's `Request` type; it's not the root cause.

## Backend route handler return-type convention
This codebase's Express routes are typed `async (req, res): Promise<void> => { ... }` and every early exit
after `res.status().json()` uses a bare `return;` (not `return res.status(...)`). Match this exactly when adding
new route files or the file won't typecheck against sibling files' patterns (see `portfolio.ts` as the reference).

## Migration scripts must use the shared `@workspace/db` pool
New one-off migration scripts (`migrate-v*.ts`) must import the shared `pool` export from `@workspace/db`,
not `pg` directly — `pg` isn't a declared dependency of `api-server` and raw `SUPABASE_DEV/PROD_DATABASE_URL`
env access bypasses the project's NODE_ENV-based dev/prod picking logic. Copy the pattern from an existing
`migrate-v42e.ts`-style script.

## "Use Template" → draft service request flow
The template gallery's "Use This Template" CTA does not create a request directly — there's no
dedicated "draft from template" backend endpoint. Instead it follows the same pattern already used by
the "Continue With This Concept" live-preview flow: stash context in `sessionStorage` (key
`template-selection-seed` mirrors the existing `live-preview-seed`), navigate to `/services?templateId=&templateCategory=`,
have `services.tsx` pre-select the matching category and show a dismissible banner, and have
`service-detail.tsx` consume-and-clear the seed to prefill the contact/notes field. The actual draft
`service_request` row is only created once the existing `useRequestService` mutation runs (same as any
other service selection) — there is intentionally no separate "draft" concept for templates.
