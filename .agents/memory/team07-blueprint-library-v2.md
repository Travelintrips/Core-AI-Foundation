---
name: team07-blueprint-library-v2
description: Team 07 Universal Design Blueprint Library — P0/P1/P2 remediation decisions and invariants
---

## Storage architecture
- IBlueprintRepository port at `repository/IBlueprintRepository.ts`
- DbBlueprintRepository = production; InMemoryBlueprintRepository = test stub ONLY
- Service module singleton created with `new DbBlueprintRepository()` — never in-memory in production
- `createBlueprintService(repo)` factory exported for test injection

## Status vocabulary
Four statuses: `draft | active | published | deprecated`
- `published` = public-facing; returned by the public listing endpoint (no auth)
- `active` = admin-only internal use
- `draft` = WIP, admin-only
- `deprecated` = retired, admin-only
- `PUBLIC_BLUEPRINT_STATUSES = ["published"]` — canonical allowlist in types.ts

## Auth pattern (P0 rule)
- `router.use(adminAuth)` covers everything registered after it
- Every mutation route ADDITIONALLY has explicit `adminAuth` as second arg
- `GET /ai/design-blueprints/public` registered BEFORE `router.use(adminAuth)` — intentionally public; filters to `status=published` only
- Express 5 params: always use `String(req.params["id"])` — not destructuring `{ id }` — to avoid `string | string[]` TS2345 errors

## Boundary with existing design-template-engine
- existing engine = renderable templates (SVG/Sharp, batch renders, ZIP)
- Team 07 = structural blueprints (domain contracts, no rendering)
- Blueprints upstream of templates; namespaces never overlap
- documented in integration/manifests/team-07.json `boundary` field

**Why:** Audit P2 required explicit boundary documentation; prevents future teams from building a third registry.

## Built-in blueprint IDs
- Format: `bp-<domain>-v<N>` (e.g. `bp-graphic-design-v1`)
- Custom blueprints: `bp-custom-<uuid>` — prefix guards against IDOR collision
- Built-ins never touch DB; always returned from code (blueprints/*.ts)

## DbBlueprintRepository read degradation
- If migration not yet applied (table missing), reads return empty — built-ins still work
- Write operations propagate errors — never silently drop data
