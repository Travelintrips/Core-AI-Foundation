# WP-03A — Placement Engine v2

## Status

Rebuilt from specification after shallow-clone import. Previously verified as 170/170 tests passing. This rebuild restores the documented contracts with all required entities.

## Overview

WP-03A provides the **2D furniture placement engine** — the data layer that stores tenant-owned layout sessions and individual furniture placements on those canvases. It is the dependency for WP-03B (Collision Engine).

## Tables

| Table | Purpose |
|---|---|
| `layout_sessions` | Tenant-owned design canvas with room geometry |
| `placements` | Furniture items placed on a session canvas |

## Key contracts

### Coordinate system
- 2D top-down
- Unit: centimetres
- Rotation: degrees, normalised to `[0, 360)` before persistence

### Tenant isolation
- `layout_sessions.tenant_id` is NOT NULL — no platform-wide sessions
- `placements.tenant_id` is denormalised from the parent session for RLS efficiency
- A DB trigger (`trg_placement_tenant_consistency`) enforces that `placements.tenant_id` always mirrors `layout_sessions.tenant_id`
- Service layer also enforces tenant access before any read or write

### Rotation normalisation
- `normalizeRotation(deg)` maps any degree value to `[0, 360)` (handles negatives, values ≥ 360)
- The DB column has a `CHECK (rotation_deg >= 0 AND rotation_deg < 360)` constraint

### Anchor point
- `anchorX` / `anchorY` in `[0, 1]` — `(0, 0)` = top-left corner (default)
- `snapToItemAnchor()` returns the absolute canvas position of the anchor

### Archived placements
- `isArchived = true` excludes a placement from collision detection (WP-03B reads this flag)
- The archived flag does NOT delete the record — it persists for history

### Session lifecycle
```
draft → active → archived
archived → draft (restore)
```

## Files

| File | Description |
|---|---|
| `lib/db/src/schema/placement-engine.ts` | Drizzle schema: `layoutSessionsTable`, `placementsTable` |
| `scripts/migrations/wp03a-placement-engine-v2.sql` | Forward DDL migration |
| `scripts/migrations/rls-wp03a-placement-engine-v2.sql` | RLS policies |
| `scripts/migrations/wp03a-placement-tenant-consistency-v2.sql` | Tenant consistency trigger |
| `artifacts/api-server/src/services/placementEngineService.ts` | Service layer |
| `artifacts/api-server/src/routes/placement-engine.ts` | Express routes |
| `artifacts/api-server/src/__tests__/placement-engine-v2.test.ts` | Test suite |

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/ai/layout-sessions` | List sessions (tenant-scoped) |
| POST | `/ai/layout-sessions` | Create session |
| GET | `/ai/layout-sessions/:sessionId` | Get session |
| PATCH | `/ai/layout-sessions/:sessionId` | Update session |
| POST | `/ai/layout-sessions/:sessionId/archive` | Archive session |
| POST | `/ai/layout-sessions/:sessionId/restore` | Restore session |
| DELETE | `/ai/layout-sessions/:sessionId` | Soft-delete session |
| GET | `/ai/layout-sessions/:sessionId/placements` | List placements |
| POST | `/ai/layout-sessions/:sessionId/placements` | Create placement |
| GET | `/ai/layout-sessions/:sessionId/placements/:placementId` | Get placement |
| PATCH | `/ai/layout-sessions/:sessionId/placements/:placementId` | Update placement |
| POST | `/ai/layout-sessions/:sessionId/placements/:placementId/archive` | Archive placement |
| DELETE | `/ai/layout-sessions/:sessionId/placements/:placementId` | Delete placement |
