---
name: pdfkit esbuild externals rule
description: pdfkit (and its fontkit dependency) cannot be bundled by esbuild in this project's ESM build — must be marked external
---

## Rule
Add `"pdfkit"` to the `external` array in `artifacts/api-server/build.mjs` whenever pdfkit is used.

## Why
pdfkit depends on fontkit, which is compiled with `@swc/helpers` as a peer. esbuild bundles fontkit inline but leaves `@swc/helpers` as a runtime require (because `@swc/*` is also in the externals list). At runtime, node can't resolve `@swc/helpers/cjs/_define_property.cjs` because pnpm doesn't symlink it to the workspace root `node_modules/@swc/` — it's only in the virtual store.

Externalizing `pdfkit` causes esbuild to emit a `require('pdfkit')` call instead. The banner's `globalThis.require = createRequire(import.meta.url)` handles this, and pdfkit's own node_modules tree correctly includes the @swc/helpers symlink.

## How to apply
When any new package with complex CJS transitive deps is added, check if it bundles cleanly. If you see `Cannot find module '@swc/helpers/...'` or similar, add the top-level package to the externals list in `build.mjs` rather than patching individual transitive deps.
