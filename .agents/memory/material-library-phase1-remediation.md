---
name: Material Library Phase 1 remediation
description: Durable lessons from route isolation and canonical seed-data validation for the material catalog
---

Relative Express routers with generic `/:id` handlers must be mounted under the domain prefix declared by their route contract. Mounting them at the shared API root can intercept unrelated endpoints before the intended router and produce misleading validation or database errors.

**Why:** The catalog endpoint was initially diagnosed as a query-parser failure, but the request was intercepted by earlier unprefixed design routers. Prefixing the owning mounts restored the catalog route without changing its parser or tests.

**How to apply:** When a route returns an unexpected error, inspect the live route stack and verify each router mount prefix before editing request validation.

Seed helper signatures that accept many positional strings can silently shift fields when a record omits one value; runtime integrity tests should validate canonical enums and record shape, not only record counts.

**Why:** Three Ceiling records passed keyword arrays into `priceTier` because omitted positional fields shifted the arguments. The resulting data looked syntactically valid to TypeScript but failed the canonical tier contract.

**How to apply:** Keep seed calls fully shaped and validate enum fields, unique codes, categories, and total counts directly from the assembled seed array.