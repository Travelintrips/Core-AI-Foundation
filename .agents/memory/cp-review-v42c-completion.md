---
name: V4.2C Customer Review Experience — completion notes
description: Hard-won fixes from finishing the CP review flow (cp-review.ts) end-to-end verification — OpenAPI, fixture drift, watermark security, filesUnlocked type bug
---

# V4.2C — Customer Review Experience completion notes

## OpenAPI shared `responses` block can go missing silently
If a path spec references `$ref: '#/components/responses/NotFound'` etc. but `components.responses` was never
defined in `openapi.yaml`, orval codegen and the workspace-check validator fail with an unhelpful ref-resolution
error. Grep for `components:\n  responses:` before assuming the paths themselves are broken.

## Fixture scripts silently drift from the real Drizzle schema
`tsx` does not typecheck — a fixture/seed script can insert a field that doesn't exist on the table (e.g. a
`reviewToken: null` alongside the real `reviewTokenHash`) and it will NOT throw at runtime; drizzle just ignores
unknown keys when building the insert. The seed appears to succeed. Bugs like this only surface later during
`pnpm run typecheck` / `tsc --build`. **How to apply:** after writing or editing a fixture script, run
`tsc -p tsconfig.json --noEmit` on that package before trusting the seed, not just `tsx script.ts`.

## Watermark/lock endpoints must fail closed, never fall back to the clean file
A `try { serve watermarked PDF } catch { redirect to the original clean source URL }` pattern is a
confidentiality bypass: any transient failure in the watermarking step (fetch timeout, bad source URL, lib
error) silently serves the full-resolution unwatermarked file to a client who hasn't paid/been approved.
**Fix pattern:** on watermark failure, return 502/503 with an error — never redirect/serve the unlocked asset.

## `created_project_id` on ai_service_requests is TEXT (the project UUID), not the row id
It's tempting to join via `(SELECT id FROM creative_projects WHERE project_id = $1)` but that compares
`text = integer` and Postgres throws `operator does not exist`. Compare `createdProjectId` directly against the
project UUID string. Also: `creativeProjectsTable.filesUnlocked` is the actual canonical unlock flag (see
customer-workspace.md) — check that first, and treat any service-request status lookup as a fallback only.

## pdf-lib install vs. externalize are two different failure modes
Adding a package to `build.mjs`'s esbuild `external` list only stops esbuild from bundling it — it does NOT
install it. If `package.json` lists a dependency but `pnpm install` was never re-run after adding it (e.g. after
a git import), `node_modules/<pkg>` won't exist and the built server crashes at runtime with
`ERR_MODULE_NOT_FOUND` even though the build step itself succeeds. Always run `pnpm install` and confirm
`node_modules/.pnpm/<pkg>*` exists, separately from the externals-list fix.
