---
name: api-server zod import rule
description: Do not import zod/v4 directly in api-server routes
---

`zod/v4` is NOT declared as a dependency in `artifacts/api-server/package.json` and will cause TS2307 errors.

**Why:** The api-server uses `@workspace/api-zod` generated schemas for all validation. Those schemas already use zod internally. Adding a direct zod import in routes would require adding the dependency and creates confusion.

**How to apply:** In any api-server route file, never `import { z } from "zod/v4"`. Instead, use schemas already exported from `@workspace/api-zod` (e.g., `CreatePromptVersionBody`, `ListPromptVersionsParams`, etc.). The generated schemas cover all params, bodies, and responses needed.
