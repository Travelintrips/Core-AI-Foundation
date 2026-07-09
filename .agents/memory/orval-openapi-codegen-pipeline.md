---
name: Orval/OpenAPI codegen pipeline quirks
description: Why orval codegen from lib/api-spec/openapi.yaml failed and how it was made to run reliably
---

# Orval/OpenAPI codegen pipeline

`lib/api-spec` generates `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`
from `lib/api-spec/openapi.yaml` via orval. In this pnpm-isolated monorepo, running
`orval --config ./orval.config.ts` directly is unreliable:

- jiti (orval's TS config loader) copies the config to `/tmp` before executing it, so
  `__dirname` inside `orval.config.ts` resolves to `/tmp`, not the config's real directory.
  **Fix:** derive paths from `process.cwd()` instead of `__dirname`.
- orval's YAML file-loader path (`@scalar/json-magic`) can fail to resolve its own
  plugin modules under pnpm's strict isolation, and gives an unhelpful
  "Failed to resolve input" error.
  **Fix:** bypass the file-loader entirely — pre-parse the YAML with `js-yaml` in a
  plain Node script (`lib/api-spec/generate.mjs`) and pass the parsed object directly
  to orval's `generate()` API instead of pointing `input.target` at the file path.
- `js-yaml` throws on duplicate mapping keys (fails loud), which is actually useful:
  it surfaces YAML files with duplicate keys from bad merges/imports that orval's own
  loader might otherwise silently mishandle.

**Generated code as source, not build artifact:** `lib/api-client-react/src/index.ts`
and `lib/api-zod/src/index.ts` import directly from `./generated/*` at the TS source
level (no separate codegen build step wired into `pnpm install`/dev). Because of that,
the `src/generated/` directories must be committed to git — leaving them untracked/
gitignored breaks fresh clones and CI since nothing regenerates them automatically.

**Zod schema naming convention:** orval's zod client names exports after the
operationId + `Body`/`Params`/`Response` (e.g. `CreateJobBody`, `PauseQueueBody`), not
`<Name>Schema`. A shared `$ref` schema referenced by multiple operations (e.g. one
`QueueFilterBody` schema used by both pause and resume) gets generated as **separate،
per-operation** zod objects (`PauseQueueBody`, `ResumeQueueBody`), not one shared export,
even though the OpenAPI spec only defines it once.
