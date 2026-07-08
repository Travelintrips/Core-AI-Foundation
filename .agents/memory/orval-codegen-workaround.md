---
name: orval codegen workaround
description: orval 8.18.0 cannot load local YAML files via TS config due to @scalar/json-magic bug; workaround and fix notes.
---

# orval 8.18.0 Codegen Workaround

## Rule
Never run `pnpm --filter @workspace/api-spec run codegen` directly — it silently fails with "Failed to resolve input: Please provide a valid string value or pass a loader to process the input" because orval 8.18.0 uses `@scalar/json-magic` which has no file-system loader plugin registered.

## Workaround
Create a temporary `.mjs` config that pre-parses the YAML with `js-yaml` and passes the object directly as `input.target`:

```js
import { load } from "/home/runner/workspace/node_modules/.pnpm/js-yaml@4.2.0/node_modules/js-yaml/index.js";
const specObject = load(readFileSync(specPath, "utf-8"));
// then pass specObject as input.target in the orval config
```

Then run: `cd lib/api-spec && node_modules/.bin/orval --config /tmp/orval.config.mjs`

**Why:** `@scalar/json-magic` bundles a `resolveContents` function that requires loader plugins to read files, but orval does not register any. Passing a pre-parsed JS object bypasses the string-resolution path entirely.

**How to apply:** Any time the OpenAPI spec changes and codegen needs to be re-run.

## Also Note
The imported openapi.yaml had concatenated duplicate YAML keys (old+new versions of dispatcher routes merged end-to-end from GitHub import). Fixed by parsing with `yaml@2.9.0` (strict: false, uniqueKeys: false) and reserializing.
