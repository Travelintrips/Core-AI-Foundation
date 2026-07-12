---
name: Concatenated file fix pattern
description: Files in this project were imported from GitHub with two versions concatenated together — how to identify and fix them.
---

# Concatenated file fix pattern

**Why:** The GitHub import merged an older and newer version of several files end-to-end, resulting in parse errors ("Unexpected *", duplicate declarations, conflicting star exports).

## How to identify

- esbuild reports `Unexpected "*"` at a line that is mid-file — orphaned JSDoc comment missing `/**`
- TypeScript/Babel reports duplicate identifier declarations in a single import block
- A file has two `export default function X` or two function definitions with the same name
- Runtime error: "conflicting star exports for name '...'" from a library index

## Fix pattern

1. **Concatenated TS/TSX files**: The second version is always more complete. Use `{ echo "/**"; tail -n +<LINE> file.ts; } > /tmp/fixed.ts && mv /tmp/fixed.ts file.ts` to keep only the second version.
2. **Duplicate imports in TSX**: Use `node` to slice line arrays — skip the duplicate range, reassemble.
3. **Library conflicting star exports**: Remove `export * from "./hand-written-module"` from the library index when a generated file covers the same names.
4. **index.ts with dual auto-start blocks**: Remove the old block that references now-deleted exports; keep the new one.

## Files that were fixed

- `artifacts/api-server/src/services/jobDispatcherService.ts` — kept v2 (lines 392–865 of original)
- `artifacts/api-server/src/routes/dispatcher.ts` — kept v2 (lines 45–119 of original)
- `artifacts/api-server/src/index.ts` — removed old import + old auto-start block
- `artifacts/ai-platform/src/pages/queue.tsx` — removed concatenated v1 DispatcherPanel function + stale no-props call site + leftover JSX elements in header (Bot, duplicate spans that caused premature `</div>`)
- `lib/api-client-react/src/index.ts` — removed `export * from "./dispatcher"` (conflicts with generated)
- `lib/api-spec/openapi.yaml` — removed duplicate YAML keys in 4 dispatcher paths + DispatcherStatus schema (yaml parser throws "Map keys must be unique")
- `artifacts/customer-portal/src/App.tsx` — old direct-import block (v1) concatenated after new lazy-import block (v2); also a stray `<Switch>...</Switch>` from an old Router() spliced mid-`NotFound()` after its closing `</div>`. Kept lazy/Suspense version, merged the one route (`workspace/:token/settings`) that only existed in v1 into the real `Router()`.
- `artifacts/api-server/src/services/aiExecutionService.ts` — `executeAI`'s catch block had an old duplicate unreachable `switch(slug)` block spliced in right after `throw err;`, eating the catch's closing brace and causing "Unexpected end of file". Deleted the duplicate switch, kept the catch block's `throw err; }`.

**Orval codegen note:** `orval.config.ts` could not be loaded by jiti in this environment; replaced with `orval.config.mjs` (ESM with `import.meta.url`). Codegen script in `lib/api-spec/package.json` now points to `.mjs`.

**Why (durable lesson):** If more files show similar parse errors after future imports, check for the concatenation pattern first — it's the root cause, not a code bug. YAML files are also susceptible — use the yaml parser to detect duplicate-key errors.

**Recurrence note (2026-07-12):** The exact same `App.tsx` duplicate-lazy-import bug reappeared ~30 min after being fixed. Root cause: this repo has an external git remote (`origin/main`) that an outside process/author keeps committing to (commit messages like "10", "26", theme-restyle commits), and those commits still contain the old concatenation bug — a local uncommitted fix gets silently overwritten next time the workspace syncs from git. When you fix a concatenated file here, also check `git log -1` / `git status` after — if the tree is "clean" and matches a fresh remote commit that reintroduces the bug, the fix needs to be re-applied (and ideally committed) rather than assumed permanent.
