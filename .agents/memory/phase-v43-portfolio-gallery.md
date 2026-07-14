---
name: V4.3 Portfolio Gallery & Live Preview
description: Route-mounting gotcha, workspace token facts, and ownership boundary from building the Team-1 portfolio gallery module alongside an existing Template Marketplace.
---

## Express route mounting: never include the app-level prefix in route paths
`app.ts` mounts the shared router as `app.use("/api", adminAuthWithExceptions, router)`. Every route
file registers paths **without** the `/api` prefix (e.g. `router.get("/public/portfolio-gallery/search", ...)`).
Adding `/api/...` inside a route file causes silent 404s (Express treats it as `/api/api/...`) even though
the file imports/builds/typechecks cleanly — this only surfaces at runtime. Always grep an existing sibling
route file's `router.get(` calls before writing a new one, don't infer the prefix from the OpenAPI spec paths.

## Migration scripts: reuse the shared `pool`, don't add `pg` as a dependency
`@workspace/db` already exports a shared `pool`. Hand-written DDL migration scripts should import it directly
rather than adding `pg` to the artifact's `package.json` — avoids a redundant dependency and a module-resolution
trap (a prior team's `migrate-v43.ts` did add raw `pg` and now fails typecheck with "Cannot find module 'pg'").

## `resolveWorkspaceSession` return shape
Returns `{ok:true, session}` or `{ok:false, status, error}` — not `{type, session?}`. `templates.ts` (another
team's file) has a latent bug using the wrong shape; don't copy it into new code, and don't fix it either since
it's outside this task's ownership.

## Ownership: `/portfolio-gallery` route name is taken
The customer-portal already has a page at `/portfolio-gallery` (backed by `/api/public/portfolio` and
`/api/public/templates/industry-showcase`) owned by the Template Marketplace team. A parallel "browse before
you buy" feature must pick a different route (used `/gallery`) — don't assume a plausible-sounding gallery
route name is free; grep `App.tsx` first.

## Dev-only faded/ghost heading text is a pre-existing app-wide quirk, not a bug to fix
Workspace pages' `<h1>`/`<h2>` (e.g. dashboard.tsx "Selamat datang kembali") render as very low-contrast
"ghost" text in screenshots — confirmed present on the pre-existing dashboard page too, not introduced by new
pages. Don't spend time chasing it as a regression; it's consistent across the whole customer-portal app.
